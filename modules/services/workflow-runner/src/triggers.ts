// Workflow trigger blocks: HTTP Trigger, Socket Trigger (TCP loopback / Unix socket) and
// File/Pipe Edited Trigger. All triggers in a workflow are armed when the run starts; if any
// trigger cannot be armed (e.g. port already in use, missing file/pipe, invalid path), the run
// fails immediately with an error. Connected agents can also inspect, reconfigure, arm, disarm
// or wait on trigger blocks through workflow_use_block.
import type { Handle, ModuleContext, StreamSubscription } from "@hato/sdk/types";
import { hostOs, isAbsolutePath, slashPath } from "@hato/sdk/platform";
import { errMsg } from "@hato/sdk/runtime";
import {
  normalizeTriggerConfig, renderPrompt, type WorkflowBlock, type WorkflowBlockState, type WorkflowTriggerConfig,
} from "@hato/sdk/workflows";
import { createWindowsFile, runScript } from "./procs";

export interface ArmedTrigger {
  blockId: string;
  type: "http_trigger" | "socket_trigger" | "file_trigger";
  endpoint: string;
  port?: number;
  path?: string;
  disarm: () => Promise<void>;
}

/** Tracks ports and Unix socket paths bound across active runs in this daemon process. */
const activePorts = new Map<number, string>();
const activeUnixSockets = new Map<string, string>();

const HTTP_STATUS_TEXT: Record<number, string> = {
  200: "OK", 201: "Created", 202: "Accepted", 204: "No Content",
  400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found",
  405: "Method Not Allowed", 413: "Payload Too Large", 431: "Request Header Fields Too Large",
  500: "Internal Server Error", 503: "Service Unavailable",
};

function httpResponse(status: number, body: string, contentType?: string): string {
  const statusText = HTTP_STATUS_TEXT[status] || "OK";
  const trimmed = body.trim();
  const type = contentType || (trimmed.startsWith("{") || trimmed.startsWith("[") ? "application/json; charset=utf-8" : "text/plain; charset=utf-8");
  const bytes = new TextEncoder().encode(body).length;
  return `HTTP/1.1 ${status} ${statusText}\r\nContent-Type: ${type}\r\nContent-Length: ${bytes}\r\nConnection: close\r\n\r\n${body}`;
}

function parseQuery(queryStr: string): Record<string, string> {
  const query: Record<string, string> = {};
  if (!queryStr) return query;
  for (const part of queryStr.split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    try {
      const k = decodeURIComponent(eq >= 0 ? part.slice(0, eq) : part);
      const v = eq >= 0 ? decodeURIComponent(part.slice(eq + 1)) : "";
      query[k] = v;
    } catch {
      const k = eq >= 0 ? part.slice(0, eq) : part;
      const v = eq >= 0 ? part.slice(eq + 1) : "";
      query[k] = v;
    }
  }
  return query;
}

/** Time a helper process (Unix socket server, FIFO reader) has to report `ready`. */
const READY_TIMEOUT_MS = 5000;

const UNIX_SOCKET_HELPER = `
const net = require("node:net"), fs = require("node:fs");
const [sockPath, framing = "line", reply = ""] = process.argv.slice(1);
const server = net.createServer(conn => {
  conn.setEncoding("utf8");
  let buf = "";
  const emit = text => {
    if (!text) return;
    process.stdout.write("data " + JSON.stringify(text) + "\\n");
    if (reply) conn.write(reply.endsWith("\\n") ? reply : reply + "\\n");
  };
  conn.on("data", chunk => {
    if (framing === "message") { emit(chunk); return; }
    buf += chunk;
    if (framing === "eof") return;
    let i;
    while ((i = buf.indexOf("\\n")) >= 0) {
      const line = buf.slice(0, i).replace(/\\r$/, "");
      buf = buf.slice(i + 1);
      emit(line);
    }
  });
  conn.on("end", () => { if (buf) { emit(buf.replace(/\\r?\\n$/, "")); buf = ""; } });
  conn.on("error", () => {});
});
server.on("error", e => { process.stderr.write((e.code ? e.code + ": " : "") + (e.message || String(e)) + "\\n"); process.exit(1); });
server.listen(sockPath, () => { process.stdout.write("ready\\n"); });
const clean = () => { try { server.close(); fs.unlinkSync(sockPath); } catch {} process.exit(0); };
process.on("SIGTERM", clean);
process.on("SIGINT", clean);
`;

const FIFO_PIPE_HELPER = `
const fs = require("node:fs");
const [pipePath, framing = "message"] = process.argv.slice(1);
try {
  const st = fs.statSync(pipePath);
  if (!st.isFIFO()) { process.stderr.write("'" + pipePath + "' is not a named pipe (FIFO)\\n"); process.exit(2); }
  const fd = fs.openSync(pipePath, fs.constants.O_RDWR);
  const stream = fs.createReadStream(null, { fd, encoding: "utf8" });
  process.stdout.write("ready\\n");
  let buf = "";
  stream.on("data", chunk => {
    if (framing !== "line") {
      const text = String(chunk).replace(/\\r?\\n$/, "");
      if (text) process.stdout.write("data " + JSON.stringify(text) + "\\n");
      return;
    }
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\\n")) >= 0) {
      const line = buf.slice(0, i).replace(/\\r$/, "");
      buf = buf.slice(i + 1);
      if (line) process.stdout.write("data " + JSON.stringify(line) + "\\n");
    }
  });
  stream.on("error", e => { process.stderr.write((e.message || String(e)) + "\\n"); process.exit(1); });
} catch (e) {
  process.stderr.write((e.code ? e.code + ": " : "") + (e.message || String(e)) + "\\n");
  process.exit(1);
}
`;

export interface TriggerHostExec {
  run: { id: string; status: string };
  env: { root: string };
  outputs: Map<string, string>;
  triggers: Map<string, ArmedTrigger>;
  triggerWaiters: Map<string, Set<(output: string) => void>>;
  cancelled: boolean;
}

export async function armHttpTrigger(
  ctx: ModuleContext,
  x: TriggerHostExec,
  b: WorkflowBlock,
  onFire: (rawOutput: string, templateInput: string) => boolean | void,
): Promise<ArmedTrigger> {
  const t: WorkflowTriggerConfig = b.trigger || {};
  const requestedPort = t.port ?? 0;
  if (requestedPort !== 0 && (!Number.isInteger(requestedPort) || requestedPort < 1024 || requestedPort > 65535)) {
    throw new Error(`HTTP Trigger '${b.label}' port must be 0 (auto) or 1024–65535`);
  }
  const ownerKey = `${x.run.id}:${b.id}`;
  if (requestedPort !== 0 && activePorts.has(requestedPort) && activePorts.get(requestedPort) !== ownerKey) {
    throw new Error(`EADDRINUSE: port ${requestedPort} is already in use`);
  }
  const rawPath = (t.path ?? "").trim();
  if (rawPath && !rawPath.startsWith("/")) {
    throw new Error(`HTTP Trigger '${b.label}' path '${rawPath}' must start with /`);
  }
  const matchPath = rawPath || "/";
  const method = (t.method || "ANY").toUpperCase();
  const statusCode = t.statusCode ?? 200;
  if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
    throw new Error(`HTTP Trigger '${b.label}' status code must be 100–599`);
  }

  const listener = await ctx.host.net.listenLoopback({ port: requestedPort });
  if (requestedPort !== 0 && activePorts.has(listener.port) && activePorts.get(listener.port) !== ownerKey) {
    await ctx.host.net.close(listener.handle).catch(() => {});
    throw new Error(`EADDRINUSE: port ${listener.port} is already in use`);
  }
  activePorts.set(listener.port, ownerKey);

  let closed = false;
  let pending = "";
  const conns = new Map<string, StreamSubscription>();

  const closeConn = async (connHandle: string) => {
    const sub = conns.get(connHandle);
    conns.delete(connHandle);
    await sub?.close().catch(() => {});
    await ctx.host.net.close(connHandle).catch(() => {});
  };

  const handleConn = async (connHandle: string) => {
    if (closed) { await ctx.host.net.close(connHandle).catch(() => {}); return; }
    let buf = "";
    let handled = false;
    const processBuffer = async (ended: boolean) => {
      if (handled || closed) return;
      let sep = buf.indexOf("\r\n\r\n"), sepLen = 4;
      if (sep < 0) { sep = buf.indexOf("\n\n"); sepLen = 2; }
      if (sep < 0) {
        if (buf.length > 65_536) {
          handled = true;
          await ctx.host.net.write(connHandle, httpResponse(431, "Request Header Fields Too Large")).catch(() => {});
          await closeConn(connHandle);
          return;
        }
        if (!ended || !buf.trim()) return;
        sep = buf.length; sepLen = 0;
      }
      const rawHead = buf.slice(0, sep);
      const rawBody = buf.slice(sep + sepLen);
      const lines = rawHead.split(/\r?\n/);
      const reqMatch = lines[0]?.trim().match(/^([A-Za-z]+)\s+(\S+)(?:\s+HTTP\/[\d.]+)?$/);
      if (!reqMatch) {
        handled = true;
        await ctx.host.net.write(connHandle, httpResponse(400, "Bad Request")).catch(() => {});
        await closeConn(connHandle);
        return;
      }
      const headers: Record<string, string> = {};
      for (const line of lines.slice(1)) {
        const idx = line.indexOf(":");
        if (idx > 0) {
          const k = line.slice(0, idx).trim().toLowerCase();
          const v = line.slice(idx + 1).trim();
          headers[k] = headers[k] ? `${headers[k]}, ${v}` : v;
        }
      }
      const contentLen = Number(headers["content-length"]);
      const bodyBytes = new TextEncoder().encode(rawBody).length;
      if (Number.isFinite(contentLen) && contentLen > 0 && bodyBytes < contentLen && !ended) {
        if (bodyBytes > 512_000) {
          handled = true;
          await ctx.host.net.write(connHandle, httpResponse(413, "Payload Too Large")).catch(() => {});
          await closeConn(connHandle);
        }
        return;
      }
      handled = true;
      const reqMethod = reqMatch[1].toUpperCase();
      const reqTarget = reqMatch[2];
      const qIdx = reqTarget.indexOf("?");
      const pathname = qIdx >= 0 ? reqTarget.slice(0, qIdx) : reqTarget;
      const queryStr = qIdx >= 0 ? reqTarget.slice(qIdx + 1) : "";

      const pathMatches = !rawPath || rawPath === "/*"
        ? true
        : matchPath.endsWith("/*")
        ? pathname === matchPath.slice(0, -2) || pathname.startsWith(matchPath.slice(0, -1))
        : pathname === matchPath;
      if (!pathMatches) {
        await ctx.host.net.write(connHandle, httpResponse(404, "Not Found")).catch(() => {});
        await closeConn(connHandle);
        return;
      }
      if (method !== "ANY" && method !== "*" && reqMethod !== method) {
        await ctx.host.net.write(connHandle, httpResponse(405, "Method Not Allowed")).catch(() => {});
        await closeConn(connHandle);
        return;
      }
      if (t.secret) {
        const auth = headers["authorization"] || "";
        const token = headers["x-hato-token"] || (auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : auth);
        if (token !== t.secret) {
          await ctx.host.net.write(connHandle, httpResponse(401, "Unauthorized")).catch(() => {});
          await closeConn(connHandle);
          return;
        }
      }
      const bodySlice = Number.isFinite(contentLen) && contentLen >= 0 ? rawBody.slice(0, contentLen) : rawBody;
      let parsedBody: unknown = bodySlice;
      if (bodySlice.trim()) {
        try { parsedBody = JSON.parse(bodySlice); } catch {}
      }
      const query = parseQuery(queryStr);
      const event = {
        trigger: "http",
        method: reqMethod,
        path: pathname,
        ...(Object.keys(query).length ? { query } : {}),
        headers,
        body: parsedBody,
        rawBody: bodySlice,
      };
      const jsonPayload = JSON.stringify(event);
      const accepted = onFire(jsonPayload, bodySlice || jsonPayload) !== false;
      const respBody = !accepted ? JSON.stringify({ ok: false, error: "Workflow is busy; the trigger queue is full" })
        : t.responseBody !== undefined && t.responseBody !== "" ? t.responseBody
        : JSON.stringify({ ok: true, blockId: b.id, runId: x.run.id });
      await ctx.host.net.write(connHandle, httpResponse(accepted ? statusCode : 503, respBody)).catch(() => {});
      await closeConn(connHandle);
    };

    const sub = await ctx.host.streams.listen(
      connHandle,
      {},
      chunk => { buf += chunk; void processBuffer(false); },
      () => { void processBuffer(true).finally(() => closeConn(connHandle)); },
    );
    conns.set(connHandle, sub);
  };

  let listenerSub: StreamSubscription | null = null;
  try {
    listenerSub = await ctx.host.streams.listen(listener.handle, {}, chunk => {
      if (closed) return;
      pending += chunk;
      let i;
      while ((i = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, i); pending = pending.slice(i + 1);
        try {
          const e = JSON.parse(line);
          if (e.connection) void handleConn(String(e.connection));
        } catch {}
      }
    });
  } catch (e) {
    activePorts.delete(listener.port);
    await ctx.host.net.close(listener.handle).catch(() => {});
    throw e;
  }

  const endpoint = `http://127.0.0.1:${listener.port}${matchPath}`;
  return {
    blockId: b.id,
    type: "http_trigger",
    endpoint,
    port: listener.port,
    path: matchPath,
    async disarm() {
      if (closed) return;
      closed = true;
      if (activePorts.get(listener.port) === ownerKey) activePorts.delete(listener.port);
      await listenerSub?.close().catch(() => {});
      for (const h of [...conns.keys()]) await closeConn(h);
      await ctx.host.net.close(listener.handle).catch(() => {});
    },
  };
}

export async function armSocketTrigger(
  ctx: ModuleContext,
  x: TriggerHostExec,
  b: WorkflowBlock,
  onFire: (rawOutput: string, templateInput: string) => boolean | void,
): Promise<ArmedTrigger> {
  const t: WorkflowTriggerConfig = b.trigger || {};
  const protocol = t.protocol || (t.path && !t.port ? "unix" : "tcp");
  const framing = t.framing || "line";
  const ownerKey = `${x.run.id}:${b.id}`;

  if (protocol === "unix") {
    const rawPath = (t.path || "").trim();
    if (!rawPath) throw new Error(`Socket Trigger '${b.label}' needs a Unix socket path`);
    if (slashPath(rawPath).split("/").includes("..")) throw new Error(`Socket Trigger '${b.label}' path cannot contain '..'`);
    const resolvedPath = isAbsolutePath(rawPath) ? rawPath : `${x.env.root.replace(/\/$/, "")}/${rawPath}`;
    if (activeUnixSockets.has(resolvedPath) && activeUnixSockets.get(resolvedPath) !== ownerKey) {
      throw new Error(`EADDRINUSE: Unix socket '${rawPath}' is already in use`);
    }
    const grant = await ctx.host.capabilities.request({ kind: "process", root: x.env.root, target: { kind: "local" } });
    let handle: Handle;
    try {
      handle = (await ctx.host.process.spawn(grant.grant, {
        target: { kind: "local" },
        executable: "node",
        args: ["-e", UNIX_SOCKET_HELPER, resolvedPath, framing, t.responseBody || ""],
        cwd: x.env.root,
        env: { TERM: "dumb" },
      })).handle;
    } finally {
      await ctx.host.capabilities.release(grant.grant).catch(() => {});
    }

    let closed = false;
    let outBuf = "";
    let errBuf = "";
    let readyResolve: (() => void) | null = null;
    let readyReject: ((e: Error) => void) | null = null;
    const readyPromise = new Promise<void>((res, rej) => { readyResolve = res; readyReject = rej; });

    const outSub = await ctx.host.streams.listen(handle, { channel: "stdout" }, chunk => {
      if (closed) return;
      outBuf += chunk;
      let i;
      while ((i = outBuf.indexOf("\n")) >= 0) {
        const line = outBuf.slice(0, i).replace(/\r$/, "");
        outBuf = outBuf.slice(i + 1);
        if (line === "ready") { readyResolve?.(); readyResolve = null; readyReject = null; continue; }
        if (line.startsWith("data ")) {
          try {
            const payload = String(JSON.parse(line.slice(5)));
            onFire(payload, payload);
          } catch {}
        } else if (line) {
          onFire(line, line);
        }
      }
    });
    const errSub = await ctx.host.streams.listen(handle, { channel: "stderr" }, chunk => {
      errBuf = (errBuf + chunk).slice(-8000);
      if (readyReject && /EADDRINUSE|ENOENT|EACCES|EPERM|Error/i.test(errBuf)) {
        const rej = readyReject; readyReject = null; readyResolve = null;
        rej(new Error(errBuf.trim()));
      }
    });

    // The helper reports `ready` once listening; an error or no answer fails the arming.
    const timeout = setTimeout(() => { readyReject?.(new Error(`Unix socket helper did not start${errBuf.trim() ? `: ${errBuf.trim()}` : ""}`)); readyResolve = null; readyReject = null; }, READY_TIMEOUT_MS);
    try {
      await readyPromise;
    } catch (e) {
      clearTimeout(timeout);
      closed = true;
      await outSub.close().catch(() => {});
      await errSub.close().catch(() => {});
      await ctx.host.process.terminate(handle, "SIGKILL").catch(() => {});
      await ctx.host.resources.release(handle).catch(() => {});
      throw e;
    }
    clearTimeout(timeout);
    activeUnixSockets.set(resolvedPath, ownerKey);

    return {
      blockId: b.id,
      type: "socket_trigger",
      endpoint: `unix:${rawPath}`,
      path: rawPath,
      async disarm() {
        if (closed) return;
        closed = true;
        if (activeUnixSockets.get(resolvedPath) === ownerKey) activeUnixSockets.delete(resolvedPath);
        await outSub.close().catch(() => {});
        await errSub.close().catch(() => {});
        await ctx.host.process.terminate(handle, "SIGTERM").catch(() => {});
        await ctx.host.resources.release(handle).catch(() => {});
      },
    };
  }

  // TCP loopback socket trigger
  const requestedPort = t.port ?? 0;
  if (requestedPort !== 0 && (!Number.isInteger(requestedPort) || requestedPort < 1024 || requestedPort > 65535)) {
    throw new Error(`Socket Trigger '${b.label}' port must be 0 (auto) or 1024–65535`);
  }
  if (requestedPort !== 0 && activePorts.has(requestedPort) && activePorts.get(requestedPort) !== ownerKey) {
    throw new Error(`EADDRINUSE: port ${requestedPort} is already in use`);
  }

  const listener = await ctx.host.net.listenLoopback({ port: requestedPort });
  if (requestedPort !== 0 && activePorts.has(listener.port) && activePorts.get(listener.port) !== ownerKey) {
    await ctx.host.net.close(listener.handle).catch(() => {});
    throw new Error(`EADDRINUSE: port ${listener.port} is already in use`);
  }
  activePorts.set(listener.port, ownerKey);

  let closed = false;
  let pending = "";
  const conns = new Map<string, StreamSubscription>();

  const closeConn = async (connHandle: string) => {
    const sub = conns.get(connHandle);
    conns.delete(connHandle);
    await sub?.close().catch(() => {});
    await ctx.host.net.close(connHandle).catch(() => {});
  };

  const handleConn = async (connHandle: string) => {
    if (closed) { await ctx.host.net.close(connHandle).catch(() => {}); return; }
    let buf = "";
    const deliver = async (msg: string) => {
      if (closed || !msg) return;
      if (onFire(msg, msg) === false) return;
      if (t.responseBody) {
        const reply = t.responseBody.endsWith("\n") ? t.responseBody : `${t.responseBody}\n`;
        await ctx.host.net.write(connHandle, reply).catch(() => {});
      }
    };
    const sub = await ctx.host.streams.listen(
      connHandle,
      {},
      chunk => {
        if (closed) return;
        if (framing === "message") {
          const text = chunk.replace(/\r?\n$/, "");
          if (text) void deliver(text);
          return;
        }
        buf += chunk;
        if (framing === "eof") return;
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).replace(/\r$/, "");
          buf = buf.slice(i + 1);
          if (line) void deliver(line);
        }
      },
      () => {
        if (!closed && buf.length > 0) {
          const rest = buf.replace(/\r?\n$/, "");
          buf = "";
          if (rest) void deliver(rest);
        }
        void closeConn(connHandle);
      },
    );
    conns.set(connHandle, sub);
  };

  let listenerSub: StreamSubscription | null = null;
  try {
    listenerSub = await ctx.host.streams.listen(listener.handle, {}, chunk => {
      if (closed) return;
      pending += chunk;
      let i;
      while ((i = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, i); pending = pending.slice(i + 1);
        try {
          const e = JSON.parse(line);
          if (e.connection) void handleConn(String(e.connection));
        } catch {}
      }
    });
  } catch (e) {
    activePorts.delete(listener.port);
    await ctx.host.net.close(listener.handle).catch(() => {});
    throw e;
  }

  return {
    blockId: b.id,
    type: "socket_trigger",
    endpoint: `tcp://127.0.0.1:${listener.port}`,
    port: listener.port,
    async disarm() {
      if (closed) return;
      closed = true;
      if (activePorts.get(listener.port) === ownerKey) activePorts.delete(listener.port);
      await listenerSub?.close().catch(() => {});
      for (const h of [...conns.keys()]) await closeConn(h);
      await ctx.host.net.close(listener.handle).catch(() => {});
    },
  };
}

export async function armFileTrigger(
  ctx: ModuleContext,
  x: TriggerHostExec,
  b: WorkflowBlock,
  onFire: (rawOutput: string, templateInput: string) => boolean | void,
): Promise<ArmedTrigger> {
  const t: WorkflowTriggerConfig = b.trigger || {};
  const rawPath = (t.path || "").trim();
  if (!rawPath) throw new Error(`File/Pipe Trigger '${b.label}' needs a file or pipe path`);
  if (isAbsolutePath(rawPath) || slashPath(rawPath).split("/").includes("..")) {
    throw new Error(`File/Pipe Trigger '${b.label}' path '${rawPath}' must be workspace-relative`);
  }
  const mode = t.mode || "auto";
  const framing = t.framing || "message";
  const createIfMissing = !!t.createIfMissing;

  // Read-only access suffices for watching; a missing file or pipe is created with the runner's
  // process scope (like Script blocks) so arming never needs an interactive write approval.
  const grant = await ctx.host.capabilities.request({ kind: "fs", root: x.env.root, target: { kind: "local" } });
  const quoted = `'${rawPath.replace(/'/g, `'\\''`)}'`;
  const create = async (command: string, what: string) => {
    // Native Windows has no mkfifo or POSIX shell: files are created directly, pipes are refused.
    const windows = hostOs(ctx) === "windows";
    if (windows && command === "mkfifo") throw new Error(`Named pipes are not available on native Windows; use a file trigger`);
    const mk = windows ? await createWindowsFile(ctx, x.env.root, rawPath)
      : await runScript(ctx, x.env.root, `mkdir -p -- "$(dirname -- ${quoted})" && ${command} -- ${quoted}`, "", { timeoutMs: 5000, track: () => {} });
    if (mk.code !== 0) throw new Error(`Cannot create ${what} '${rawPath}': ${(mk.stderr || mk.stdout).trim() || `exit ${mk.code}`}`);
  };

  let stat: { kind?: string; size?: number; mtime?: number | null; text?: string } | undefined;
  try {
    if (typeof ctx.host.fs.stat === "function") {
      stat = await ctx.host.fs.stat(grant.grant, rawPath);
    } else {
      const r = await ctx.host.fs.read(grant.grant, rawPath, 256 * 1024);
      stat = { kind: "file", size: r.size ?? (r.text?.length || 0), mtime: null, text: r.text };
    }
  } catch (e) {
    if (!createIfMissing) {
      await ctx.host.capabilities.release(grant.grant).catch(() => {});
      throw new Error(`File or pipe '${rawPath}' cannot be armed: ${errMsg(e)}`);
    }
    try {
      if (mode === "pipe") await create("mkfifo", "named pipe");
      else await create("touch", "file");
      stat = await ctx.host.fs.stat(grant.grant, rawPath);
    } catch (createErr) {
      await ctx.host.capabilities.release(grant.grant).catch(() => {});
      throw createErr instanceof Error && createErr.message.startsWith("Cannot create") ? createErr : new Error(`Cannot create '${rawPath}': ${errMsg(createErr)}`);
    }
  }

  if (stat?.kind === "dir") {
    await ctx.host.capabilities.release(grant.grant).catch(() => {});
    throw new Error(`'${rawPath}' is a directory; File/Pipe Trigger requires a file or named pipe`);
  }
  if (mode === "file" && stat?.kind && stat.kind !== "file") {
    await ctx.host.capabilities.release(grant.grant).catch(() => {});
    throw new Error(`'${rawPath}' is not a regular file`);
  }
  if (mode === "pipe" && stat?.kind === "file") {
    await ctx.host.capabilities.release(grant.grant).catch(() => {});
    throw new Error(`'${rawPath}' is a regular file, not a named pipe (FIFO)`);
  }

  const isPipe = mode === "pipe" || (mode === "auto" && stat?.kind === "other");

  if (isPipe) {
    await ctx.host.capabilities.release(grant.grant).catch(() => {});
    const resolvedPipe = `${x.env.root.replace(/\/$/, "")}/${rawPath}`;
    const procGrant = await ctx.host.capabilities.request({ kind: "process", root: x.env.root, target: { kind: "local" } });
    let handle: Handle;
    try {
      handle = (await ctx.host.process.spawn(procGrant.grant, {
        target: { kind: "local" },
        executable: "node",
        args: ["-e", FIFO_PIPE_HELPER, resolvedPipe, framing],
        cwd: x.env.root,
        env: { TERM: "dumb" },
      })).handle;
    } finally {
      await ctx.host.capabilities.release(procGrant.grant).catch(() => {});
    }

    let closed = false;
    let outBuf = "";
    let errBuf = "";
    let readyResolve: (() => void) | null = null;
    let readyReject: ((e: Error) => void) | null = null;
    const readyPromise = new Promise<void>((res, rej) => { readyResolve = res; readyReject = rej; });

    const outSub = await ctx.host.streams.listen(handle, { channel: "stdout" }, chunk => {
      if (closed) return;
      outBuf += chunk;
      let i;
      while ((i = outBuf.indexOf("\n")) >= 0) {
        const line = outBuf.slice(0, i).replace(/\r$/, "");
        outBuf = outBuf.slice(i + 1);
        if (line === "ready") { readyResolve?.(); readyResolve = null; readyReject = null; continue; }
        if (line.startsWith("data ")) {
          try {
            const payload = String(JSON.parse(line.slice(5)));
            onFire(payload, payload);
          } catch {}
        } else if (line) {
          onFire(line, line);
        }
      }
    });
    const errSub = await ctx.host.streams.listen(handle, { channel: "stderr" }, chunk => {
      errBuf = (errBuf + chunk).slice(-8000);
      if (readyReject && errBuf.trim()) {
        const rej = readyReject; readyReject = null; readyResolve = null;
        rej(new Error(errBuf.trim()));
      }
    });

    const timeout = setTimeout(() => { readyReject?.(new Error(`Pipe reader did not start${errBuf.trim() ? `: ${errBuf.trim()}` : ""}`)); readyResolve = null; readyReject = null; }, READY_TIMEOUT_MS);
    try {
      await readyPromise;
    } catch (e) {
      clearTimeout(timeout);
      closed = true;
      await outSub.close().catch(() => {});
      await errSub.close().catch(() => {});
      await ctx.host.process.terminate(handle, "SIGKILL").catch(() => {});
      await ctx.host.resources.release(handle).catch(() => {});
      throw e;
    }
    clearTimeout(timeout);

    return {
      blockId: b.id,
      type: "file_trigger",
      endpoint: `pipe:${rawPath}`,
      path: rawPath,
      async disarm() {
        if (closed) return;
        closed = true;
        await outSub.close().catch(() => {});
        await errSub.close().catch(() => {});
        await ctx.host.process.terminate(handle, "SIGKILL").catch(() => {});
        await ctx.host.resources.release(handle).catch(() => {});
      },
    };
  }

  // Regular file watching
  let lastText = "";
  try {
    if (stat?.text !== undefined) {
      lastText = stat.text;
    } else {
      const initial = await ctx.host.fs.read(grant.grant, rawPath, 256 * 1024);
      lastText = initial.text ?? initial.base64 ?? "";
    }
  } catch (e) {
    await ctx.host.capabilities.release(grant.grant).catch(() => {});
    throw new Error(`Cannot read file '${rawPath}': ${errMsg(e)}`);
  }

  if (typeof ctx.host.fs.watch !== "function") {
    await ctx.host.capabilities.release(grant.grant).catch(() => {});
    throw new Error(`File watching is not available for '${rawPath}'`);
  }

  let watchHandle: Handle;
  try {
    watchHandle = (await ctx.host.fs.watch(grant.grant, rawPath, { recursive: false })).handle;
  } catch (e) {
    await ctx.host.capabilities.release(grant.grant).catch(() => {});
    throw new Error(`Cannot watch file '${rawPath}': ${errMsg(e)}`);
  }

  let closed = false;
  let watchBuf = "";
  let reading = false;
  let pendingRead = false;

  const checkFileChange = async () => {
    if (closed) return;
    if (reading) { pendingRead = true; return; }
    reading = true;
    try {
      do {
        pendingRead = false;
        const current = await ctx.host.fs.read(grant.grant, rawPath, 256 * 1024);
        if (closed) return;
        const text = current.text ?? current.base64 ?? "";
        if (framing === "line") {
          const delta = text.startsWith(lastText) ? text.slice(lastText.length) : text;
          lastText = text;
          for (const line of delta.split(/\r?\n/)) {
            if (line.length > 0) onFire(line, line);
          }
        } else {
          lastText = text;
          onFire(text, text);
        }
      } while (pendingRead && !closed);
    } catch {
      // File temporarily unavailable during atomic replace; next watch event will read it.
    } finally {
      reading = false;
    }
  };

  let sub: StreamSubscription | null = null;
  try {
    sub = await ctx.host.streams.listen(watchHandle, { channel: "stdout" }, chunk => {
      if (closed) return;
      watchBuf += chunk;
      let i;
      let sawChange = false;
      while ((i = watchBuf.indexOf("\n")) >= 0) {
        const line = watchBuf.slice(0, i).trim();
        watchBuf = watchBuf.slice(i + 1);
        if (!line || line === "ready" || line.startsWith("warning ")) continue;
        sawChange = true;
      }
      if (sawChange) void checkFileChange();
    });
  } catch (e) {
    await ctx.host.resources.release(watchHandle).catch(() => {});
    await ctx.host.capabilities.release(grant.grant).catch(() => {});
    throw e;
  }

  return {
    blockId: b.id,
    type: "file_trigger",
    endpoint: `file:${rawPath}`,
    path: rawPath,
    async disarm() {
      if (closed) return;
      closed = true;
      await sub?.close().catch(() => {});
      await ctx.host.resources.release(watchHandle).catch(() => {});
      await ctx.host.capabilities.release(grant.grant).catch(() => {});
    },
  };
}

/** Merge tool-supplied configuration parameters into a trigger block's configuration. */
export function applyTriggerPatch(b: WorkflowBlock, patch: any): WorkflowTriggerConfig {
  const next = normalizeTriggerConfig({ ...(b.trigger || {}), ...patch }) || {};
  b.trigger = next;
  if (typeof patch?.prompt === "string") b.prompt = patch.prompt.slice(0, 200_000);
  return next;
}

export function renderTriggerOutput(x: TriggerHostExec, b: WorkflowBlock, rawOutput: string, templateInput: string): string {
  return b.prompt.trim() ? renderPrompt(b.prompt, templateInput, x.outputs) : rawOutput;
}
