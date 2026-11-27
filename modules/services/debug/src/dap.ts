// DAP client over the relay process (see relay.ts): request/response per connection, events and
// reverse requests. One relay serves an adapter and all of its (child) session connections.
import type { Handle, ModuleContext, StreamSubscription } from "@hato/sdk/types";
import { errMsg, targetFor, workspaceGrant, type WorkspaceDescriptor } from "@hato/sdk/runtime";
import { RELAY_SCRIPT } from "./relay";

export interface DapMessage { seq: number; type: "request" | "response" | "event"; command?: string; event?: string; request_seq?: number; success?: boolean; message?: string; body?: any; arguments?: any }
export interface RelayHandlers {
  event(conn: number, msg: DapMessage): void;
  request(conn: number, msg: DapMessage): void;
  closed(conn: number, error?: string): void;
  log(text: string): void;
  exit(error?: string): void;
}
export type RelayConfig = { spawn: { command: string[]; cwd?: string; env?: Record<string, string>; portPattern: string } } | { connect: { port: number } };

export class Relay {
  private seq = 1;
  private buffer = "";
  private pending = new Map<string, { resolve: (m: DapMessage) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private opening = new Map<number, { resolve: () => void; reject: (e: Error) => void }>();
  private subs: StreamSubscription[] = [];
  private ready!: { resolve: (port: number) => void; reject: (e: Error) => void };
  readonly open = new Set<number>();
  alive = true;
  private constructor(private ctx: ModuleContext, private handle: Handle, private handlers: RelayHandlers) {}

  static async start(ctx: ModuleContext, d: WorkspaceDescriptor, config: RelayConfig, handlers: RelayHandlers): Promise<Relay> {
    const grant = await workspaceGrant(ctx, d, "process");
    const { handle } = await ctx.host.process.spawn(grant.grant, {
      target: await targetFor(ctx, d), executable: ctx.host?.env?.info?.().platform === "windows" && d.location === "local" ? "python" : "python3", args: ["-c", RELAY_SCRIPT, JSON.stringify(config)],
      cwd: d.rootAbsolutePath, env: {}, loginShell: d.location !== "local",
    });
    const relay = new Relay(ctx, handle, handlers);
    const ready = new Promise<number>((resolve, reject) => { relay.ready = { resolve, reject }; });
    relay.subs.push(await ctx.host.streams.listen(handle, { channel: "stdout" }, chunk => relay.feed(chunk), error => relay.ended(error ? errMsg(error) : undefined)));
    relay.subs.push(await ctx.host.streams.listen(handle, { channel: "stderr" }, chunk => handlers.log(chunk)));
    const timer = setTimeout(() => relay.ready.reject(new Error("The debug adapter did not start within 60 seconds")), 60000);
    try { await ready; } catch (e) { await relay.dispose(); throw e; } finally { clearTimeout(timer); }
    return relay;
  }

  private feed(chunk: string) {
    this.buffer += chunk;
    let i: number;
    while ((i = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, i); this.buffer = this.buffer.slice(i + 1);
      if (!line.trim()) continue;
      let ev: any;
      try { ev = JSON.parse(line); } catch { this.handlers.log(line); continue; }
      switch (ev.ev) {
        case "ready": this.ready.resolve(ev.port); break;
        case "fatal": this.ready.reject(new Error(ev.text)); this.handlers.log(ev.text); break;
        case "log": this.handlers.log(String(ev.text)); break;
        case "opened": this.open.add(ev.id); this.opening.get(ev.id)?.resolve(); this.opening.delete(ev.id); break;
        case "closed": this.connectionClosed(ev.id, ev.error); break;
        case "msg": this.message(ev.id, ev.msg); break;
      }
    }
  }
  private message(conn: number, msg: DapMessage) {
    if (msg.type === "response") {
      const key = `${conn}:${msg.request_seq}`, p = this.pending.get(key);
      if (!p) return;
      this.pending.delete(key); clearTimeout(p.timer);
      if (msg.success) p.resolve(msg); else p.reject(new Error(msg.body?.error?.format || msg.message || `${msg.command} failed`));
    } else if (msg.type === "event") this.handlers.event(conn, msg);
    else if (msg.type === "request") this.handlers.request(conn, msg);
  }
  private connectionClosed(conn: number, error?: string) {
    this.open.delete(conn);
    const o = this.opening.get(conn);
    if (o) { this.opening.delete(conn); o.reject(new Error(error || "Could not connect to the debug adapter")); }
    for (const [key, p] of this.pending) if (key.startsWith(`${conn}:`)) { this.pending.delete(key); clearTimeout(p.timer); p.reject(new Error(error || "Debug connection closed")); }
    this.handlers.closed(conn, error);
  }
  private ended(error?: string) {
    if (!this.alive) return;
    this.alive = false;
    this.ready?.reject(new Error(error || "The debug adapter relay exited"));
    for (const conn of [...this.open]) this.connectionClosed(conn, error || "Debug adapter exited");
    this.handlers.exit(error);
  }
  private write(obj: object) {
    if (!this.alive) throw new Error("The debug adapter is not running");
    return this.ctx.host.process.write(this.handle, JSON.stringify(obj) + "\n");
  }

  connect(conn: number): Promise<void> {
    const opened = new Promise<void>((resolve, reject) => this.opening.set(conn, { resolve, reject }));
    void this.write({ op: "open", id: conn }).catch(e => this.connectionClosed(conn, errMsg(e)));
    return opened;
  }
  request<T = any>(conn: number, command: string, args?: object, timeoutMs = 30000): Promise<T> {
    const seq = this.seq++, key = `${conn}:${seq}`;
    return new Promise<DapMessage>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(key); reject(new Error(`${command} timed out`)); }, timeoutMs);
      this.pending.set(key, { resolve, reject, timer });
      this.write({ op: "send", id: conn, msg: { seq, type: "request", command, arguments: args ?? {} } }).catch(e => {
        this.pending.delete(key); clearTimeout(timer); reject(e);
      });
    }).then(m => m.body as T);
  }
  respond(conn: number, req: DapMessage, body: object = {}, error?: string) {
    return this.write({ op: "send", id: conn, msg: { seq: this.seq++, type: "response", request_seq: req.seq, command: req.command,
      success: !error, ...(error ? { message: error } : {}), body } }).catch(() => {});
  }
  close(conn: number) { return this.write({ op: "close", id: conn }).catch(() => {}); }
  async dispose() {
    this.alive = false;
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error("Debug session ended")); }
    this.pending.clear();
    await this.ctx.host.process.closeStdin(this.handle).catch(() => {});
    await new Promise(r => setTimeout(r, 300));
    await this.ctx.host.process.terminate(this.handle, "SIGTERM").catch(() => {});
    await Promise.allSettled(this.subs.map(s => s.close()));
    await this.ctx.host.resources.release(this.handle).catch(() => {});
  }
}
