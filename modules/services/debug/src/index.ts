// Debug sessions over DAP (js-debug for Node/TypeScript, java-debug inside JDT LS for Java), project
// breakpoints, and the agent tools. The run service owns processes and the console; it hands debug
// launches here and receives output/state through `run.debugReport`.
import type { AppModule, ModuleContext } from "@hato/sdk/types";
import { errMsg, targetFor, workspaceGrant, type WorkspaceDescriptor } from "@hato/sdk/runtime";
import { isAbsolutePath, pythonCandidates, slashPath, workspaceOs } from "@hato/sdk/platform";
import { exportMcpTools } from "@hato/sdk/mcp";
import { DEBUG_EVENTS, DEBUG_TYPES, type Breakpoint, type BreakpointStatus, type DebugFrame, type DebugSessionInfo, type DebugThread, type DebugVariable, type ExceptionBreakpoints } from "@hato/sdk/debug";
import { Relay, type DapMessage } from "./dap";
import { ADAPTERS, INSTALL_MARKER, INSTALL_SCRIPT, type AdapterId } from "./install";

const debugTypes = [...DEBUG_TYPES.js, ...DEBUG_TYPES.java];

interface Conn { id: number; caps: any; parent: number | null; ready: boolean; threads: Map<number, DebugThread> }
interface Session {
  info: DebugSessionInfo; d: WorkspaceDescriptor; relay: Relay | null; conns: Map<number, Conn>;
  nextConn: number; ended: boolean; exitCode: number | null; finish: (code: number | null) => void; done: Promise<number | null>;
  runTo: { conn: number; path: string; line: number } | null; launched: boolean;
}
const sessions = new Map<string, Session>();
const breakpoints = new Map<string, Breakpoint[]>();
const exceptions = new Map<string, ExceptionBreakpoints>();
const loaded = new Map<string, Promise<void>>();
const breakpointWrites = new Map<string, Promise<void>>();
let mcp: ReturnType<typeof exportMcpTools> | undefined;

// ---------- helpers ----------
const abs = (d: WorkspaceDescriptor, rel: string) => isAbsolutePath(rel) ? rel : `${d.rootAbsolutePath.replace(/\/$/, "")}/${rel}`;
/** Adapters on Windows report `C:\x\a.ts` (any drive-letter case); the root is `C:/x`. */
function rel(d: WorkspaceDescriptor, path: string | undefined | null): string | null {
  if (!path) return null;
  const root = d.rootAbsolutePath.replace(/\/$/, "") + "/";
  if (/^[A-Za-z]:[\\/]/.test(path)) {
    const p = slashPath(path);
    return p.toLowerCase().startsWith(root.toLowerCase()) ? p.slice(root.length) : p;
  }
  return path.startsWith(root) ? path.slice(root.length) : path;
}
export const pythonFor = (ctx: ModuleContext, d: WorkspaceDescriptor) => pythonCandidates(workspaceOs(ctx, d))[0].executable;
async function workspace(ctx: ModuleContext, workspaceId: string): Promise<WorkspaceDescriptor> {
  if (typeof workspaceId !== "string" || !workspaceId) throw new Error("Select a workspace");
  return ctx.modules.call("workspace", "resolve", { workspaceId });
}
const summaries = (workspaceId: string) => [...sessions.values()].filter(s => s.info.workspaceId === workspaceId).map(s => {
  const conn = s.info.stopped ? s.conns.get(s.info.stopped.conn) : undefined;
  return conn ? { ...s.info, supports: { ...s.info.supports, setVariable: !!conn.caps?.supportsSetVariable } } : { ...s.info };
});
const changed = (ctx: ModuleContext, workspaceId: string) => ctx.events.emit(DEBUG_EVENTS.changed, { workspaceId, sessions: summaries(workspaceId) });
function session(id: string, workspaceId: string) {
  const s = sessions.get(id);
  if (!s || s.info.workspaceId !== workspaceId) throw new Error("Debug session was not found in this workspace");
  return s;
}
const report = (ctx: ModuleContext, s: Session, update: object) =>
  ctx.modules.call("run", "debugReport", { workspaceId: s.info.workspaceId, id: s.info.id, ...update }).catch(() => {});
const output = (ctx: ModuleContext, s: Session, stream: "stdout" | "stderr" | "system", text: string) => report(ctx, s, { output: { stream, text } });

// ---------- breakpoints (persisted per workspace) ----------
async function loadBreakpoints(ctx: ModuleContext, workspaceId: string) {
  if (!loaded.has(workspaceId)) loaded.set(workspaceId, (async () => {
    const saved = await ctx.modules.call("persistence", "settings.get", { key: `debug.breakpoints.${workspaceId}` });
    const list = Array.isArray(saved?.breakpoints) ? saved.breakpoints : [];
    breakpoints.set(workspaceId, list.filter((b: any) => typeof b?.path === "string" && Number.isInteger(b?.line) && b.line >= 0).slice(0, 2000)
      .map((b: any) => ({ id: String(b.id || crypto.randomUUID()), path: b.path, line: b.line, enabled: b.enabled !== false,
        ...(typeof b.condition === "string" && b.condition ? { condition: b.condition } : {}),
        ...(typeof b.hitCondition === "string" && b.hitCondition ? { hitCondition: b.hitCondition } : {}),
        ...(typeof b.logMessage === "string" && b.logMessage ? { logMessage: b.logMessage } : {}) })));
    exceptions.set(workspaceId, { uncaught: saved?.exceptions?.uncaught !== false, caught: !!saved?.exceptions?.caught });
  })().catch(error => {
    loaded.delete(workspaceId);
    throw error;
  }));
  await loaded.get(workspaceId);
  return breakpoints.get(workspaceId)!;
}
async function saveBreakpoints(ctx: ModuleContext, workspaceId: string, list: Breakpoint[], ex = exceptions.get(workspaceId)!) {
  await ctx.modules.call("persistence", "settings.set", { key: `debug.breakpoints.${workspaceId}`, value: { breakpoints: list, exceptions: ex } });
  breakpoints.set(workspaceId, list);
  exceptions.set(workspaceId, ex);
  ctx.events.emit(DEBUG_EVENTS.breakpoints, { workspaceId, breakpoints: list, exceptions: ex });
}
function cleanText(value: unknown, max = 500) { return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined; }

/** Send every enabled breakpoint of `paths` (all when omitted) to each ready connection. */
async function syncBreakpoints(ctx: ModuleContext, s: Session, paths?: string[]) {
  if (!s.relay || s.ended) return;
  const list = await loadBreakpoints(ctx, s.info.workspaceId);
  const files = paths ? [...new Set(paths)] : [...new Set(list.map(b => b.path))];
  const statuses = new Map(s.info.breakpoints.map(b => [b.id, b]));
  for (const conn of s.conns.values()) {
    if (!conn.ready || !s.relay.open.has(conn.id)) continue;
    // js-debug's parent session only spawns children; breakpoints belong to the child targets.
    if (s.info.kind === "js" && conn.parent === null && s.conns.size > 1) continue;
    for (const path of files) {
      const bps = list.filter(b => b.path === path && b.enabled);
      const extra = s.runTo && s.runTo.path === path && !bps.some(b => b.line === s.runTo!.line) ? [{ line: s.runTo.line }] : [];
      try {
        const body = await s.relay.request(conn.id, "setBreakpoints", { source: { path: abs(s.d, path), name: path.split("/").pop() },
          breakpoints: [...bps.map(b => ({ line: b.line + 1, ...(b.condition ? { condition: b.condition } : {}), ...(b.hitCondition ? { hitCondition: b.hitCondition } : {}), ...(b.logMessage ? { logMessage: b.logMessage } : {}) })),
            ...extra.map(e => ({ line: e.line + 1 }))], sourceModified: false });
        (body?.breakpoints || []).slice(0, bps.length).forEach((r: any, i: number) =>
          statuses.set(bps[i].id, { id: bps[i].id, verified: !!r.verified, ...(r.line ? { line: r.line - 1 } : {}), ...(r.message ? { message: String(r.message).slice(0, 300) } : {}) }));
      } catch (e) { for (const b of bps) statuses.set(b.id, { id: b.id, verified: false, message: errMsg(e) }); }
    }
    const ex = exceptions.get(s.info.workspaceId)!;
    const filters = (conn.caps?.exceptionBreakpointFilters || []).map((f: any) => f.filter as string);
    const wanted = filters.filter((f: string) => (ex.uncaught && /uncaught/i.test(f)) || (ex.caught && /^(all|caught)/i.test(f)));
    if (filters.length) await s.relay.request(conn.id, "setExceptionBreakpoints", { filters: wanted }).catch(() => {});
  }
  s.info.breakpoints = [...statuses.values()];
  changed(ctx, s.info.workspaceId);
}
const allSessions = (workspaceId: string) => [...sessions.values()].filter(s => s.info.workspaceId === workspaceId && !s.ended);

// ---------- adapters ----------
async function adapters(ctx: ModuleContext, d: WorkspaceDescriptor, names: AdapterId[], install: boolean): Promise<Record<string, string | null>> {
  const grant = await workspaceGrant(ctx, d, "process");
  const request = { action: install ? "install" : "check", adapters: Object.fromEntries(names.map(n => [n, ADAPTERS[n]])) };
  const r = await ctx.host.process.run(grant.grant, { target: await targetFor(ctx, d), executable: pythonFor(ctx, d), args: ["-c", INSTALL_SCRIPT, JSON.stringify(request)],
    cwd: d.rootAbsolutePath, env: {}, loginShell: d.location !== "local" }, { timeoutMs: install ? 10 * 60 * 1000 : 60000, limitBytes: 65536 });
  const line = (r.stdout || "").split("\n").find(l => l.startsWith(INSTALL_MARKER));
  if (!line) throw new Error(`Python 3 is required on ${d.machineId} to install the debugger. ${(r.stderr || "").slice(-500)}`);
  const result = JSON.parse(line.slice(INSTALL_MARKER.length));
  if (result.error) throw new Error(`Could not install the debugger: ${result.error}`);
  return result;
}
async function adapterPath(ctx: ModuleContext, s: Session, name: AdapterId) {
  let found = (await adapters(ctx, s.d, [name], false))[name];
  if (!found) {
    void output(ctx, s, "system", `Installing ${name} ${ADAPTERS[name].version} for this machine…\n`);
    found = (await adapters(ctx, s.d, [name], true))[name];
  }
  if (!found) throw new Error(`${name} is not installed`);
  return found;
}

// ---------- DAP event handling ----------
async function initialize(ctx: ModuleContext, s: Session, conn: Conn, adapterID: string) {
  conn.caps = await s.relay!.request(conn.id, "initialize", { clientID: "hato", clientName: "Hato", adapterID, locale: "en",
    linesStartAt1: true, columnsStartAt1: true, pathFormat: "path", supportsVariableType: true, supportsVariablePaging: true,
    supportsRunInTerminalRequest: false, supportsStartDebuggingRequest: true, supportsInvalidatedEvent: true, supportsProgressReporting: false }) || {};
  if (conn.parent === null) s.info.supports = {
    restartFrame: !!conn.caps.supportsRestartFrame, stepInTargets: !!conn.caps.supportsStepInTargetsRequest, setVariable: !!conn.caps.supportsSetVariable,
    hitConditions: !!conn.caps.supportsHitConditionalBreakpoints, logPoints: !!conn.caps.supportsLogPoints,
    conditionalBreakpoints: !!conn.caps.supportsConditionalBreakpoints, hotCodeReplace: s.info.kind === "java",
  };
}

async function onEvent(ctx: ModuleContext, s: Session, connId: number, msg: DapMessage) {
  const conn = s.conns.get(connId);
  const b = msg.body || {};
  switch (msg.event) {
    case "initialized":
      if (!conn) return;
      conn.ready = true;
      await syncBreakpoints(ctx, s);
      await s.relay!.request(connId, "configurationDone", {}).catch(e => output(ctx, s, "system", `configurationDone: ${errMsg(e)}\n`));
      if (s.info.state === "starting") { s.info.state = "running"; changed(ctx, s.info.workspaceId); void report(ctx, s, { state: "running" }); }
      break;
    case "output": {
      const category = b.category === "stderr" ? "stderr" : b.category === "console" || b.category === "important" ? "system" : b.category === "telemetry" ? null : "stdout";
      if (category && typeof b.output === "string") void output(ctx, s, category, b.output);
      break;
    }
    case "stopped": await stopped(ctx, s, connId, b); break;
    case "continued":
      if (s.info.stopped && (b.allThreadsContinued !== false || s.info.stopped.threadId === b.threadId)) resumed(ctx, s);
      break;
    case "thread":
      if (conn && b.reason === "exited") conn.threads.delete(b.threadId);
      break;
    case "breakpoint": {
      const bp = b.breakpoint;
      if (bp?.id !== undefined) changed(ctx, s.info.workspaceId);
      break;
    }
    case "exited": if (conn?.parent !== null || s.info.kind === "java") s.exitCode = typeof b.exitCode === "number" ? b.exitCode : s.exitCode; break;
    case "terminated":
      if (conn && conn.parent !== null) { s.conns.delete(connId); void s.relay?.close(connId); if (![...s.conns.values()].some(c => c.parent !== null)) await end(ctx, s); }
      else await end(ctx, s);
      break;
  }
}
async function onRequest(ctx: ModuleContext, s: Session, connId: number, msg: DapMessage) {
  if (msg.command === "startDebugging") {
    void s.relay!.respond(connId, msg, {});
    const child: Conn = { id: s.nextConn++, caps: {}, parent: connId, ready: false, threads: new Map() };
    s.conns.set(child.id, child);
    try {
      await s.relay!.connect(child.id);
      await initialize(ctx, s, child, "pwa-node");
      const request = msg.arguments?.request === "attach" ? "attach" : "launch";
      void s.relay!.request(child.id, request, msg.arguments?.configuration || {}, 120000).catch(e => output(ctx, s, "system", `${errMsg(e)}\n`));
    } catch (e) { void output(ctx, s, "system", `Could not attach to a child process: ${errMsg(e)}\n`); }
    return;
  }
  void s.relay!.respond(connId, msg, {}, `${msg.command} is not supported by Hato`);
}

async function stopped(ctx: ModuleContext, s: Session, connId: number, b: any) {
  const threadId = typeof b.threadId === "number" ? b.threadId : [...(s.conns.get(connId)?.threads.keys() || [])][0];
  let frame: any = null;
  try {
    const trace = await s.relay!.request(connId, "stackTrace", { threadId, startFrame: 0, levels: 20 });
    // Prefer the first frame with a file (skip native/library frames without sources).
    frame = (trace?.stackFrames || []).find((f: any) => f.source?.path && f.presentationHint !== "subtle") || trace?.stackFrames?.[0] || null;
  } catch {}
  if (s.runTo) { const r = s.runTo; s.runTo = null; await syncBreakpoints(ctx, s, [r.path]); }
  s.info.state = "paused";
  s.info.stopped = { conn: connId, threadId, reason: String(b.reason || "pause"), ...(b.description || b.text ? { description: String(b.text || b.description).slice(0, 300) } : {}),
    path: rel(s.d, frame?.source?.path), line: Math.max(0, (frame?.line || 1) - 1), frameId: frame?.id ?? 0 };
  changed(ctx, s.info.workspaceId);
  void report(ctx, s, { state: "paused", pausedAt: s.info.stopped.path ? { path: s.info.stopped.path, line: s.info.stopped.line, reason: s.info.stopped.reason } : undefined });
}
function resumed(ctx: ModuleContext, s: Session) {
  delete s.info.stopped;
  s.info.state = "running";
  changed(ctx, s.info.workspaceId);
  void report(ctx, s, { state: "running" });
}
async function end(ctx: ModuleContext, s: Session) {
  if (s.ended) return;
  s.ended = true; s.info.state = "ended"; delete s.info.stopped;
  changed(ctx, s.info.workspaceId);
  const relay = s.relay; s.relay = null;
  if (relay) {
    for (const conn of [...relay.open]) await relay.request(conn, "disconnect", { terminateDebuggee: true }, 3000).catch(() => {});
    await relay.dispose();
  }
  s.finish(s.exitCode);
  // Node sessions own their program: the run session ends with them. Java runs end with their JVM.
  void report(ctx, s, { ended: true, exitCode: s.exitCode });
  setTimeout(() => { if (sessions.get(s.info.id) === s) { sessions.delete(s.info.id); changed(ctx, s.info.workspaceId); } }, 60000);
}

function newSession(ctx: ModuleContext, d: WorkspaceDescriptor, id: string, name: string, kind: "js" | "java"): Session {
  const old = sessions.get(id);
  if (old && !old.ended) throw new Error("This run is already being debugged");
  let finish!: (code: number | null) => void;
  const done = new Promise<number | null>(r => { finish = r; });
  const s: Session = { info: { id, workspaceId: d.id, name, kind, state: "starting", breakpoints: [],
    supports: { restartFrame: false, stepInTargets: false, setVariable: false, hitConditions: false, logPoints: false, conditionalBreakpoints: false, hotCodeReplace: false } },
    d, relay: null, conns: new Map(), nextConn: 1, ended: false, exitCode: null, finish, done, runTo: null, launched: false };
  sessions.set(id, s);
  changed(ctx, d.id);
  return s;
}
const handlers = (ctx: ModuleContext, s: Session) => ({
  event: (conn: number, msg: DapMessage) => void onEvent(ctx, s, conn, msg).catch(e => ctx.log.warn(`debug event: ${errMsg(e)}`)),
  request: (conn: number, msg: DapMessage) => void onRequest(ctx, s, conn, msg),
  closed: (conn: number) => { const c = s.conns.get(conn); if (c && c.parent === null && !s.ended) void end(ctx, s); },
  log: (text: string) => { if (/error|exception/i.test(text)) ctx.log.warn(`debug adapter: ${text.slice(0, 500)}`); },
  exit: () => { if (!s.ended) void end(ctx, s); },
});

// ---------- launch / attach (called by the run service) ----------
interface LaunchArgs { workspaceId: string; id: string; name: string; type: string; launch: { executable: string; args: string[]; cwd: string; env: Record<string, string> } }
/** Node/TypeScript: js-debug launches the program. The end is reported through `run.debugReport`. */
async function launchJs(ctx: ModuleContext, a: LaunchArgs) {
  const d = await workspace(ctx, a.workspaceId);
  const s = newSession(ctx, d, a.id, a.name, "js");
  try {
    const server = await adapterPath(ctx, s, "js-debug");
    const node = /node(\.exe)?$/i.test(a.launch.executable) ? a.launch.executable : "node";
    s.relay = await Relay.start(ctx, d, { spawn: { command: [node, server, "0", "127.0.0.1"], cwd: a.launch.cwd, portPattern: ":(\\d+)\\s*$" } }, handlers(ctx, s));
    const root: Conn = { id: s.nextConn++, caps: {}, parent: null, ready: false, threads: new Map() };
    s.conns.set(root.id, root);
    await s.relay.connect(root.id);
    await initialize(ctx, s, root, "pwa-node");
    void s.relay.request(root.id, "launch", { type: "pwa-node", request: "launch", name: a.name, cwd: a.launch.cwd, env: a.launch.env,
      runtimeExecutable: a.launch.executable, runtimeArgs: a.launch.args, console: "internalConsole", outputCapture: "std",
      skipFiles: ["<node_internals>/**"], sourceMaps: true, autoAttachChildProcesses: true }, 120000)
      .catch(e => { void output(ctx, s, "system", `${errMsg(e)}\n`); void end(ctx, s); });
  } catch (e) { void output(ctx, s, "system", `${errMsg(e)}\n`); await end(ctx, s); throw e; }
  return { started: true };
}
/** Java: the run service started the JVM with a JDWP agent; attach java-debug (inside JDT LS) to it. */
async function attachJava(ctx: ModuleContext, a: { workspaceId: string; id: string; name: string; port: number }) {
  const d = await workspace(ctx, a.workspaceId);
  const s = newSession(ctx, d, a.id, a.name, "java");
  try {
    const jar = await adapterPath(ctx, s, "java-debug");
    const r = await ctx.modules.call("language-service", "bundles.set", { workspaceId: d.id, serverId: "jdtls", bundles: [jar] });
    if (r?.changed) void output(ctx, s, "system", "Restarting the Java language server with the debugger…\n");
    let port: number;
    try { port = await ctx.modules.call("language-service", "executeCommand", { workspaceId: d.id, serverId: "jdtls", command: "vscode.java.startDebugSession", arguments: [], timeoutMs: 180000 }, { timeoutMs: 190000 }); }
    catch (e) { throw new Error(`Java debugging needs the Java language server for this project (Language tools → Java project). ${errMsg(e)}`); }
    if (!Number.isInteger(port)) throw new Error("The Java language server did not start the debugger");
    s.relay = await Relay.start(ctx, d, { connect: { port } }, handlers(ctx, s));
    const root: Conn = { id: s.nextConn++, caps: {}, parent: null, ready: false, threads: new Map() };
    s.conns.set(root.id, root);
    await s.relay.connect(root.id);
    await initialize(ctx, s, root, "java");
    await s.relay.request(root.id, "attach", { type: "java", request: "attach", name: a.name, hostName: "127.0.0.1", port: a.port, timeout: 30000 }, 60000);
  } catch (e) { void output(ctx, s, "system", `${errMsg(e)}\n`); await end(ctx, s); throw e; }
  return { attached: true };
}

// ---------- inspection & control ----------
function focus(s: Session, a: { conn?: number; threadId?: number }) {
  const conn = Number.isInteger(a.conn) ? a.conn! : s.info.stopped?.conn ?? [...s.conns.values()].find(c => c.parent !== null)?.id ?? 1;
  if (!s.relay || s.ended) throw new Error("The debug session has ended");
  return { conn, threadId: Number.isInteger(a.threadId) ? a.threadId! : s.info.stopped?.threadId };
}
async function threads(s: Session): Promise<DebugThread[]> {
  const out: DebugThread[] = [];
  for (const conn of s.conns.values()) {
    if (!s.relay?.open.has(conn.id) || (s.info.kind === "js" && conn.parent === null && s.conns.size > 1)) continue;
    const body = await s.relay.request(conn.id, "threads", {}).catch(() => null);
    for (const t of body?.threads || []) {
      const thread = { conn: conn.id, id: t.id, name: String(t.name), stopped: s.info.stopped?.conn === conn.id && s.info.stopped.threadId === t.id };
      conn.threads.set(t.id, thread); out.push(thread);
    }
  }
  return out;
}
async function stack(s: Session, a: any): Promise<DebugFrame[]> {
  const { conn, threadId } = focus(s, a);
  if (threadId === undefined) throw new Error("No thread is paused");
  const body = await s.relay!.request(conn, "stackTrace", { threadId, startFrame: Math.max(0, a.start | 0), levels: Math.min(200, Math.max(1, a.levels | 0 || 50)) });
  return (body?.stackFrames || []).map((f: any) => ({ conn, id: f.id, name: String(f.name), path: rel(s.d, f.source?.path), source: String(f.source?.name || f.source?.path?.split("/").pop() || ""),
    line: Math.max(0, (f.line || 1) - 1), column: Math.max(0, (f.column || 1) - 1),
    library: f.presentationHint === "subtle" || f.source?.presentationHint === "deemphasize" || !f.source?.path || /node_modules|<node_internals>/.test(f.source?.path || "") }));
}
const variable = (v: any): DebugVariable => ({
  name: String(v.name),
  value: String(v.value ?? v.result ?? ""),
  variablesReference: Number.isInteger(v.variablesReference) ? v.variablesReference : 0,
  type: v.type,
  evaluateName: v.evaluateName,
  namedVariables: v.namedVariables,
  indexedVariables: v.indexedVariables,
  presentationHint: v.presentationHint,
  memoryReference: v.memoryReference,
});

async function control(ctx: ModuleContext, s: Session, action: string, a: any) {
  const { conn, threadId } = focus(s, a);
  const thread = threadId ?? [...(s.conns.get(conn)?.threads.keys() || [])][0] ?? 0;
  switch (action) {
    case "continue": await s.relay!.request(conn, "continue", { threadId: thread }); resumed(ctx, s); break;
    case "pause": await s.relay!.request(conn, "pause", { threadId: thread }); break;
    case "over": await s.relay!.request(conn, "next", { threadId: thread }); resumed(ctx, s); break;
    case "into": await s.relay!.request(conn, "stepIn", { threadId: thread, ...(Number.isInteger(a.targetId) ? { targetId: a.targetId } : {}) }); resumed(ctx, s); break;
    case "out": await s.relay!.request(conn, "stepOut", { threadId: thread }); resumed(ctx, s); break;
    case "restartFrame":
      if (!s.info.supports.restartFrame) throw new Error("This debugger cannot restart frames");
      await s.relay!.request(conn, "restartFrame", { frameId: a.frameId ?? s.info.stopped?.frameId }); break;
    default: throw new Error(`Unknown action ${action}`);
  }
  return { ...s.info };
}

// ---------- public operations (UI methods and MCP tools share these) ----------
type Op = "capabilities" | "sessions" | "threads" | "stack" | "scopes" | "variables" | "evaluate" | "setVariable" | "stepInTargets"
  | "continue" | "pause" | "stepOver" | "stepInto" | "stepOut" | "restartFrame" | "runToLine" | "stop"
  | "breakpointsList" | "breakpointsSet" | "breakpointsRemove" | "breakpointsToggle" | "exceptionsSet" | "install";
function dispatch(ctx: ModuleContext, d: WorkspaceDescriptor, op: Op, a: any) {
  if (op !== "breakpointsSet" && op !== "breakpointsRemove" && op !== "breakpointsToggle" && op !== "exceptionsSet") {
    return operation(ctx, d, op, a);
  }
  const result = (breakpointWrites.get(d.id) ?? Promise.resolve()).then(() => operation(ctx, d, op, a));
  const settled = result.then(() => {}, () => {});
  breakpointWrites.set(d.id, settled);
  void settled.then(() => { if (breakpointWrites.get(d.id) === settled) breakpointWrites.delete(d.id); });
  return result;
}
async function operation(ctx: ModuleContext, d: WorkspaceDescriptor, op: Op, a: any): Promise<any> {
  switch (op) {
    case "capabilities": return { debug: true, debugTypes: debugTypes };
    case "sessions": return summaries(d.id);
    case "threads": return threads(session(a.id, d.id));
    case "stack": return stack(session(a.id, d.id), a);
    case "scopes": {
      const s = session(a.id, d.id), { conn } = focus(s, a);
      const body = await s.relay!.request(conn, "scopes", { frameId: a.frameId ?? s.info.stopped?.frameId });
      return (body?.scopes || []).map((x: any) => ({ name: String(x.name), variablesReference: x.variablesReference | 0, expensive: !!x.expensive }));
    }
    case "variables": {
      const s = session(a.id, d.id), { conn } = focus(s, a);
      if (!Number.isInteger(a.variablesReference) || a.variablesReference <= 0) throw new Error("variablesReference is required");
      const body = await s.relay!.request(conn, "variables", { variablesReference: a.variablesReference,
        ...(a.filter === "indexed" || a.filter === "named" ? { filter: a.filter } : {}),
        // A positive count selects java-debug's array-only path, which rejects plain objects
        // and out-of-bounds slices. Only send paging arguments for explicit indexed requests.
        ...(a.filter === "indexed" && Number.isInteger(a.start) && a.start >= 0 ? { start: a.start } : {}),
        ...(a.filter === "indexed" && Number.isInteger(a.count) && a.count > 0 ? { count: Math.min(a.count, 500) } : {}) });
      return (body?.variables || []).slice(0, 500).map(variable);
    }
    case "evaluate": {
      const s = session(a.id, d.id), { conn } = focus(s, a);
      if (typeof a.expression !== "string" || !a.expression.trim() || a.expression.length > 10000) throw new Error("Enter an expression");
      const context = ["watch", "repl", "hover", "clipboard"].includes(a.context) ? a.context : "repl";
      const body = await s.relay!.request(conn, "evaluate", { expression: a.expression, context, ...(Number.isInteger(a.frameId ?? s.info.stopped?.frameId) ? { frameId: a.frameId ?? s.info.stopped?.frameId } : {}) }, 60000);
      return variable({ ...body, name: a.expression });
    }
    case "setVariable": {
      const s = session(a.id, d.id), { conn } = focus(s, a);
      if (!s.conns.get(conn)?.caps?.supportsSetVariable) throw new Error("This debugger cannot change values");
      const body = await s.relay!.request(conn, "setVariable", { variablesReference: a.variablesReference, name: String(a.name), value: String(a.value) });
      return variable({ ...body, name: a.name });
    }
    case "stepInTargets": {
      const s = session(a.id, d.id), { conn } = focus(s, a);
      if (!s.info.supports.stepInTargets) return [];
      const body = await s.relay!.request(conn, "stepInTargets", { frameId: a.frameId ?? s.info.stopped?.frameId });
      return (body?.targets || []).map((t: any) => ({ id: t.id, label: String(t.label) }));
    }
    case "continue": return control(ctx, session(a.id, d.id), "continue", a);
    case "pause": return control(ctx, session(a.id, d.id), "pause", a);
    case "stepOver": return control(ctx, session(a.id, d.id), "over", a);
    case "stepInto": return control(ctx, session(a.id, d.id), "into", a);
    case "stepOut": return control(ctx, session(a.id, d.id), "out", a);
    case "restartFrame": return control(ctx, session(a.id, d.id), "restartFrame", a);
    case "runToLine": {
      const s = session(a.id, d.id), { conn } = focus(s, a);
      if (typeof a.path !== "string" || !Number.isInteger(a.line) || a.line < 0) throw new Error("path and line are required");
      s.runTo = { conn, path: rel(d, a.path)!, line: a.line };
      await syncBreakpoints(ctx, s, [s.runTo.path]);
      return control(ctx, s, "continue", a);
    }
    case "stop": {
      const s = session(a.id, d.id);
      await end(ctx, s); return { ...s.info };
    }
    case "breakpointsList": return { breakpoints: await loadBreakpoints(ctx, d.id), exceptions: exceptions.get(d.id),
      status: allSessions(d.id).flatMap(s => s.info.breakpoints) };
    case "breakpointsSet": {
      const list = (await loadBreakpoints(ctx, d.id)).map(bp => ({ ...bp }));
      const path = typeof a.path === "string" ? rel(d, a.path.replace(/^\.\//, "")) : null;
      if (!path || isAbsolutePath(path) || slashPath(path).split("/").includes("..")) throw new Error("Use a workspace-relative file path");
      if (!Number.isInteger(a.line) || a.line < 0) throw new Error("line must be a zero-based line number");
      let bp = list.find(b => (a.breakpointId && b.id === a.breakpointId) || (b.path === path && b.line === a.line));
      if (!bp) { if (list.length >= 2000) throw new Error("Too many breakpoints"); bp = { id: crypto.randomUUID(), path, line: a.line, enabled: true }; list.push(bp); }
      bp.path = path; bp.line = a.line;
      if ("enabled" in a) bp.enabled = a.enabled !== false;
      for (const key of ["condition", "hitCondition", "logMessage"] as const) if (key in a) { const v = cleanText(a[key]); if (v) bp[key] = v; else delete bp[key]; }
      await saveBreakpoints(ctx, d.id, list);
      for (const s of allSessions(d.id)) await syncBreakpoints(ctx, s, [path]);
      return bp;
    }
    case "breakpointsRemove": {
      const list = await loadBreakpoints(ctx, d.id);
      const gone = list.filter(b => a.breakpointId ? b.id === a.breakpointId : a.all === true || (b.path === rel(d, a.path) && (a.line === undefined || b.line === a.line)));
      await saveBreakpoints(ctx, d.id, list.filter(b => !gone.includes(b)));
      for (const s of allSessions(d.id)) await syncBreakpoints(ctx, s, [...new Set(gone.map(b => b.path))]);
      return { removed: gone.length };
    }
    case "breakpointsToggle": {
      const list = await loadBreakpoints(ctx, d.id);
      const path = typeof a.path === "string" ? rel(d, a.path.replace(/^\.\//, "")) : null;
      const at = list.find(b => b.path === path && b.line === a.line);
      if (at) return operation(ctx, d, "breakpointsRemove", { breakpointId: at.id });
      return operation(ctx, d, "breakpointsSet", { path, line: a.line });
    }
    case "exceptionsSet": {
      const list = await loadBreakpoints(ctx, d.id);
      const ex = { ...exceptions.get(d.id)! };
      if (typeof a.uncaught === "boolean") ex.uncaught = a.uncaught;
      if (typeof a.caught === "boolean") ex.caught = a.caught;
      await saveBreakpoints(ctx, d.id, list, ex);
      for (const s of allSessions(d.id)) await syncBreakpoints(ctx, s, []);
      return ex;
    }
    case "install": return adapters(ctx, d, Array.isArray(a.adapters) && a.adapters.length ? a.adapters : ["js-debug", "java-debug"], true);
  }
}

// ---------- MCP ----------
const str = { type: "string" }, int = { type: "integer" }, bool = { type: "boolean" };
const sid = { id: { ...str, description: "Debug session ID (from debug_sessions)" } };
const where = { conn: { ...int, description: "Adapter connection (from threads/stack); defaults to the paused one" }, threadId: int };
const tools: [string, Op, string, Record<string, unknown>, string[], "read" | "control" | "approve"][] = [
  ["debug_sessions", "sessions", "List debug sessions, their state, paused location and breakpoint verification.", {}, [], "read"],
  ["debug_threads", "threads", "List threads of a debug session.", sid, ["id"], "read"],
  ["debug_stack", "stack", "Read the call stack of the paused (or given) thread. Lines are zero-based.", { ...sid, ...where, start: int, levels: int }, ["id"], "read"],
  ["debug_scopes", "scopes", "List variable scopes of a frame (default: the paused frame).", { ...sid, conn: int, frameId: int }, ["id"], "read"],
  ["debug_variables", "variables", "Expand a variablesReference from scopes, variables or evaluate.", { ...sid, conn: int, variablesReference: int, filter: { type: "string", enum: ["indexed", "named"] }, start: int, count: int }, ["id", "variablesReference"], "read"],
  ["debug_evaluate", "evaluate", "Evaluate an expression in the paused frame. Can run code in the program; requires approval.", { ...sid, conn: int, frameId: int, expression: str }, ["id", "expression"], "approve"],
  ["debug_set_variable", "setVariable", "Change a variable's value; requires approval.", { ...sid, conn: int, variablesReference: int, name: str, value: str }, ["id", "variablesReference", "name", "value"], "approve"],
  ["debug_continue", "continue", "Resume execution.", { ...sid, ...where }, ["id"], "control"],
  ["debug_pause", "pause", "Pause execution.", { ...sid, ...where }, ["id"], "control"],
  ["debug_step_over", "stepOver", "Step over the current line.", { ...sid, ...where }, ["id"], "control"],
  ["debug_step_into", "stepInto", "Step into the call on the current line (targetId from stepInTargets to choose one).", { ...sid, ...where, targetId: int }, ["id"], "control"],
  ["debug_step_out", "stepOut", "Step out of the current function.", { ...sid, ...where }, ["id"], "control"],
  ["debug_run_to_line", "runToLine", "Continue until a workspace-relative path and zero-based line.", { ...sid, ...where, path: str, line: int }, ["id", "path", "line"], "control"],
  ["debug_stop", "stop", "Stop debugging and terminate the program.", sid, ["id"], "control"],
  ["breakpoints_list", "breakpointsList", "List project breakpoints (zero-based lines), exception settings and verification.", {}, [], "read"],
  ["breakpoints_set", "breakpointsSet", "Add or update a breakpoint at a workspace-relative path and zero-based line. Empty condition/hitCondition/logMessage clears it.", { path: str, line: int, condition: str, hitCondition: str, logMessage: str, enabled: bool }, ["path", "line"], "control"],
  ["breakpoints_remove", "breakpointsRemove", "Remove a breakpoint by breakpointId, by path (and line), or all with all=true.", { breakpointId: str, path: str, line: int, all: bool }, [], "control"],
  ["breakpoints_toggle", "breakpointsToggle", "Toggle a breakpoint at a path and zero-based line.", { path: str, line: int }, ["path", "line"], "control"],
  ["breakpoints_exceptions", "exceptionsSet", "Pause on uncaught and/or caught exceptions.", { uncaught: bool, caught: bool }, [], "control"],
];

const mod: AppModule = {
  id: "debug", moduleApiVersion: 1,
  activate(ctx) {
    mcp = exportMcpTools(ctx, "Debugger", tools.map(([name, op, description, properties, required, kind]) => ({
      name, description, inputSchema: { type: "object", properties, required, additionalProperties: false },
      annotations: { readOnlyHint: kind === "read", destructiveHint: op === "stop" || op === "breakpointsRemove" },
      timeoutMs: 90000,
      handler: async (a, scope) => {
        const d = await workspace(ctx, scope.workspaceId);
        if (d.machineId !== scope.machineId) throw new Error("MCP machine scope does not match this workspace");
        if (kind === "approve") {
          const r = await ctx.host.approvals.request({ operation: `debug.${op}`, title: op === "evaluate" ? "Allow this agent to evaluate code in the debugged program?" : "Allow this agent to change a value in the debugged program?",
            detail: `${d.name}\n${String(a.expression ?? `${a.name} = ${a.value}`).slice(0, 400)}`, timeoutMs: 120000 });
          if (r.optionId !== "allow") throw new Error("Approval was denied or expired");
        }
        return dispatch(ctx, d, op, a);
      },
    })));
  },
  canSwap: () => ({ ok: !mcp?.pending() && ![...sessions.values()].some(s => !s.ended), reason: "A debug session is active" }),
  async deactivate(ctx) { for (const s of sessions.values()) if (!s.ended) await end(ctx, s).catch(() => {}); },
  methods: {
    ...Object.fromEntries(tools.map(([, op]) => [op, async (ctx: ModuleContext, a: any) => dispatch(ctx, await workspace(ctx, a.workspaceId), op, a)])),
    capabilities: () => ({ debug: true, debugTypes: debugTypes }),
    install: async (ctx, a) => operation(ctx, await workspace(ctx, a.workspaceId), "install", a),
    scopes: async (ctx, a) => operation(ctx, await workspace(ctx, a.workspaceId), "scopes", a),
    stepInTargets: async (ctx, a) => operation(ctx, await workspace(ctx, a.workspaceId), "stepInTargets", a),
    restartFrame: async (ctx, a) => operation(ctx, await workspace(ctx, a.workspaceId), "restartFrame", a),
    /** Run service only: Node/TS launch through js-debug, resolving when the program ends. */
    async launchJs(ctx, a, meta) { if (meta?.caller !== "run") throw new Error("Only the run service starts debug launches"); return launchJs(ctx, a); },
    /** Run service only: attach to a JVM it started with a JDWP agent on `port`. */
    async attachJava(ctx, a, meta) { if (meta?.caller !== "run") throw new Error("Only the run service starts debug launches"); return attachJava(ctx, a); },
    /** Run service only: its process ended or the user stopped the run. */
    async end(ctx, a, meta) {
      if (meta?.caller !== "run") throw new Error("Only the run service ends debug sessions");
      const s = sessions.get(a.id); if (s) { if (Number.isInteger(a.exitCode)) s.exitCode = a.exitCode; await end(ctx, s); }
      return { ended: true };
    },
  },
};
export default mod;
