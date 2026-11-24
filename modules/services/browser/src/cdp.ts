// Chrome DevTools Protocol client over the kernel's `net.websocket` primitive. One browser-level
// connection carries every tab through flattened target sessions (`sessionId`).
import type { ModuleContext, StreamSubscription } from "@hato/sdk/types";

type Listener = (params: any, sessionId?: string) => void;

export class CdpError extends Error { constructor(message: string, public code?: number) { super(message); } }

export class Cdp {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; method: string; timer: number }>();
  private listeners = new Map<string, Set<Listener>>();
  private buffer = "";
  private sub: StreamSubscription | null = null;
  /** Host ops run concurrently; chain writes so messages (e.g. press then release) stay ordered. */
  private writes: Promise<unknown> = Promise.resolve();
  closed = false;
  onClose: (reason: string) => void = () => {};

  private constructor(private ctx: ModuleContext, readonly handle: string) {}

  static async connect(ctx: ModuleContext, url: string): Promise<Cdp> {
    const { handle } = await ctx.host.net.websocket(url, { timeoutMs: 15_000 });
    const cdp = new Cdp(ctx, handle);
    cdp.sub = await ctx.host.streams.listen(handle, { highWaterMark: 32 << 20 }, chunk => cdp.data(chunk), err => cdp.end(err ? err.message : "connection closed"));
    return cdp;
  }

  private data(chunk: string) {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      let frame: any;
      try { frame = JSON.parse(line); } catch { continue; }
      if (typeof frame.t !== "string") continue;
      let msg: any;
      try { msg = JSON.parse(frame.t); } catch { continue; }
      this.dispatch(msg);
    }
  }

  private dispatch(msg: any) {
    if (typeof msg.id === "number") {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new CdpError(`${p.method}: ${msg.error.message || "failed"}`, msg.error.code));
      else p.resolve(msg.result || {});
      return;
    }
    if (typeof msg.method !== "string") return;
    for (const key of [msg.method, "*"]) {
      const set = this.listeners.get(key);
      if (set) for (const l of [...set]) {
        try { key === "*" ? l({ method: msg.method, params: msg.params }, msg.sessionId) : l(msg.params || {}, msg.sessionId); }
        catch (e) { this.ctx.log.warn("CDP listener", msg.method, String(e)); }
      }
    }
  }

  private end(reason: string) {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new CdpError(`${p.method}: ${reason}`)); }
    this.pending.clear();
    this.onClose(reason);
  }

  send<T = any>(method: string, params: any = {}, sessionId?: string, timeoutMs = 30_000): Promise<T> {
    if (this.closed) return Promise.reject(new CdpError(`${method}: browser connection is closed`));
    const id = this.nextId++;
    const body = JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params });
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new CdpError(`${method}: timed out`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, method, timer });
      this.writes = this.writes.then(() => this.ctx.host.net.write(this.handle, body)).catch(e => {
        const p = this.pending.get(id);
        if (p) { this.pending.delete(id); clearTimeout(p.timer); p.reject(e); }
      });
    });
  }

  on(method: string, listener: Listener): () => void {
    let set = this.listeners.get(method);
    if (!set) { set = new Set(); this.listeners.set(method, set); }
    set.add(listener);
    return () => set!.delete(listener);
  }

  async close() {
    this.end("closed");
    try { await this.sub?.close(); } catch {}
    try { await this.ctx.host.net.close(this.handle); } catch {}
  }
}
