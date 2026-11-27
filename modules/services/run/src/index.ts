import { RUN_EVENTS, runActive, type RunOutputChunk, type RunSession, type RunServiceMethods } from "@hato/sdk/run";
import type { RunCandidate, RunConfigDraft } from "@hato/sdk/run-configurations";
import { exportMcpTools } from "@hato/sdk/mcp";
import { errMsg, targetFor, workspaceGrant, type WorkspaceDescriptor } from "@hato/sdk/runtime";
import type { AppModule, Handle, ModuleContext, StreamSubscription } from "@hato/sdk/types";
import { absoluteCwd, buildTools, javaDebugLaunch, JDWP_LISTENING, launchCommand, launchEnvironment, type Launch } from "./launch";
import { debugKind } from "@hato/sdk/debug";
import { executionPolicyHint, windowsLaunch, workspaceOs } from "@hato/sdk/platform";

type StartArgs = Parameters<RunServiceMethods["start"]>[0];
type Entry = {
  session: RunSession; args: StartArgs; key: string; chunks: RunOutputChunk[]; size: number; dropped: boolean; seq: number;
  handle: Handle | null; cancelled: boolean; killing: boolean; completion: Promise<void>;
  outputTimer?: ReturnType<typeof setTimeout>;
  /** Debug runs: Node programs belong to js-debug (ended through debugReport); JVMs belong to this
   *  entry and java-debug attaches once the JDWP port is printed. */
  debug?: { kind: "js" | "java"; attached: boolean; scan: string; done?: (code: number | null) => void };
};
const entries = new Map<string, Entry>();
let mcp: ReturnType<typeof exportMcpTools>;
const maximumBytes = 512 * 1024;
const maximumChunks = 2400;

const byWorkspace = (id: string) => [...entries.values()].filter(e => e.session.workspaceId === id);
const list = (id: string) => byWorkspace(id).map(e => ({ ...e.session }));
const changed = (ctx: ModuleContext, id: string) => ctx.events.emit(RUN_EVENTS.changed, { workspaceId: id, sessions: list(id) });
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
function entry(id: string, workspaceId: string) {
  const found = entries.get(id);
  if (!found || found.session.workspaceId !== workspaceId) throw new Error("Run session was not found in this workspace");
  return found;
}
function append(ctx: ModuleContext, e: Entry, stream: RunOutputChunk["stream"], text: string) {
  if (!text) return;
  const chunk = text.slice(-maximumBytes);
  if (chunk.length !== text.length) e.dropped = true;
  e.chunks.push({ seq: ++e.seq, stream, text: chunk });
  e.size += chunk.length;
  while (e.chunks.length > maximumChunks || e.size > maximumBytes) {
    e.size -= e.chunks.shift()!.text.length;
    e.dropped = true;
  }
  if (!e.outputTimer) e.outputTimer = setTimeout(() => {
    e.outputTimer = undefined;
    ctx.events.emit(RUN_EVENTS.output, { workspaceId: e.session.workspaceId, id: e.session.id, seq: e.seq });
  }, 100);
}
async function workspace(ctx: ModuleContext, workspaceId: string) {
  if (typeof workspaceId !== "string" || !workspaceId) throw new Error("Select a workspace");
  return ctx.modules.call<WorkspaceDescriptor>("workspace", "resolve", { workspaceId });
}
async function command(ctx: ModuleContext, d: WorkspaceDescriptor, e: Entry, launch: Launch, main = false, watch?: (text: string) => void) {
  const grant = await workspaceGrant(ctx, d, "process");
  const target = await targetFor(ctx, d);
  if (e.cancelled) return null;
  // Native Windows: npm/mvn/gradlew are .cmd/.bat files found on the registry PATH.
  const started = workspaceOs(ctx, d) === "windows" ? await windowsLaunch(ctx, grant.grant, { ...launch, args: launch.args || [] }) : launch;
  const { handle } = await ctx.host.process.spawn(grant.grant, { ...started, target, loginShell: d.location !== "local" });
  e.handle = handle;
  if (main && !e.cancelled) {
    e.session.state = "running";
    delete e.session.phase;
    changed(ctx, d.id);
  }
  const subs: StreamSubscription[] = [], drained: Promise<void>[] = [];
  try {
    for (const channel of ["stdout", "stderr"] as const) {
      let finish: () => void;
      const eof = new Promise<void>(resolve => { finish = resolve; });
      drained.push(eof);
      subs.push(await ctx.host.streams.listen(handle, { channel }, text => { append(ctx, e, channel, text); watch?.(text); }, () => finish()));
    }
    if (e.cancelled) await ctx.host.process.terminate(handle, e.killing ? "SIGKILL" : "SIGTERM");
    await ctx.host.process.closeStdin(handle).catch(() => {});
    const exit = await ctx.host.process.wait(handle);
    await Promise.race([Promise.all(drained), pause(1000)]);
    // PowerShell refusing npm.ps1 and similar: say how to fix it (Hato never changes the policy).
    const hint = exit?.code && workspaceOs(ctx, d) === "windows" ? executionPolicyHint(e.chunks.slice(-40).map(c => c.text).join("")) : null;
    if (hint) append(ctx, e, "system", `\n${hint}\n`);
    return exit;
  } catch (error) {
    await ctx.host.process.terminate(handle, "SIGKILL").catch(() => {});
    throw error;
  } finally {
    e.handle = null;
    await Promise.allSettled(subs.map(sub => sub.close()));
    await ctx.host.resources.release(handle).catch(() => {});
  }
}

async function configuration(ctx: ModuleContext, d: WorkspaceDescriptor, source: { configId?: string; candidate?: RunCandidate }) {
  return ctx.modules.call<RunConfigDraft>("run-configurations", "resolveLaunch", { workspaceId: d.id, ...source });
}

async function execute(ctx: ModuleContext, d: WorkspaceDescriptor, e: Entry, c: RunConfigDraft, chain: Set<string>, main: boolean) {
  for (const step of c.beforeLaunch) {
    if (e.cancelled) return null;
    const relative = step.cwd || c.cwd, cwd = absoluteCwd(d, relative), env = launchEnvironment(c);
    e.session.phase = `Before launch · ${step.kind === "configuration" ? "Run config" : step.executable}`;
    changed(ctx, d.id);
    if (step.kind === "configuration") {
      if (chain.has(step.executable) || chain.size > 12) throw new Error("Before-launch configurations refer to each other");
      const next = await configuration(ctx, d, { configId: step.executable });
      const exit = await execute(ctx, d, e, next, new Set([...chain, step.executable]), false);
      if (!e.cancelled && exit?.code !== 0) throw new Error("A before-launch configuration failed");
      continue;
    }
    let launch: Launch = { executable: step.executable, args: step.args, cwd, env };
    if (step.kind === "npm") launch = { ...launch, executable: "npm", args: ["run", step.executable, "--", ...step.args] };
    if (step.kind === "build") {
      const tools = await buildTools(ctx, d, relative);
      launch = { ...launch, executable: tools.hasGradle && !tools.hasMaven ? tools.gradle : tools.maven, args: [step.executable, ...step.args] };
    }
    const exit = await command(ctx, d, e, launch);
    if (!e.cancelled && exit?.code !== 0) throw new Error(`Before-launch step failed${exit?.code == null ? "" : ` (exit ${exit.code})`}`);
  }
  if (e.cancelled) return null;
  const launch = await launchCommand(ctx, d, c);
  if (e.cancelled) return null;
  if (main && e.session.mode === "debug") return debugMain(ctx, d, e, c, launch);
  append(ctx, e, "system", `Starting ${c.name}\n`);
  return command(ctx, d, e, launch, main);
}

async function debugMain(ctx: ModuleContext, d: WorkspaceDescriptor, e: Entry, c: RunConfigDraft, launch: Launch) {
  const kind = debugKind(c.type);
  if (!kind) throw new Error(`Debugging isn't supported for ${c.type}`);
  append(ctx, e, "system", `Debugging ${c.name}\n`);
  if (kind === "js") {
    const ended = new Promise<{ code: number | null; signal: number | null }>(resolve => { e.debug = { kind, attached: true, scan: "", done: code => resolve({ code, signal: null }) }; });
    e.session.phase = "Starting the debugger…"; changed(ctx, d.id);
    await ctx.modules.call("debug", "launchJs", { workspaceId: d.id, id: e.session.id, name: c.name, type: c.type, launch }, { timeoutMs: 15 * 60 * 1000 });
    if (!e.cancelled && e.session.state === "starting") { e.session.state = "running"; delete e.session.phase; changed(ctx, d.id); }
    return ended;
  }
  e.debug = { kind, attached: false, scan: "" };
  const debugged = javaDebugLaunch(c, launch);
  try {
    return await command(ctx, d, e, debugged, true, text => {
      const dbg = e.debug!;
      if (dbg.attached) return;
      dbg.scan = (dbg.scan + text).slice(-400);
      const port = JDWP_LISTENING.exec(dbg.scan)?.[1];
      if (!port) return;
      dbg.attached = true;
      void ctx.modules.call("debug", "attachJava", { workspaceId: d.id, id: e.session.id, name: c.name, port: Number(port) }, { timeoutMs: 15 * 60 * 1000 })
        .catch(error => append(ctx, e, "system", `The debugger could not attach: ${errMsg(error)}\n`));
    });
  } finally {
    await ctx.modules.call("debug", "end", { workspaceId: d.id, id: e.session.id }).catch(() => {});
  }
}

async function stop(ctx: ModuleContext, e: Entry, force = false) {
  if (!runActive(e.session)) return { ...e.session };
  e.cancelled = true; e.killing ||= force;
  e.session.state = "stopping"; changed(ctx, e.session.workspaceId);
  if (e.debug) {
    await ctx.modules.call("debug", "end", { workspaceId: e.session.workspaceId, id: e.session.id }, { timeoutMs: 15000 }).catch(() => {});
    e.debug.done?.(null);
  }
  if (e.handle) await ctx.host.process.terminate(e.handle, force ? "SIGKILL" : "SIGTERM").catch(() => {});
  if (!force) {
    await Promise.race([e.completion, pause(2000)]);
    if (runActive(e.session)) {
      e.killing = true;
      if (e.handle) await ctx.host.process.terminate(e.handle, "SIGKILL").catch(() => {});
    }
  }
  await e.completion;
  return { ...e.session };
}
function prune(ctx: ModuleContext, workspaceId: string, keep = 40) {
  const ended = byWorkspace(workspaceId).filter(e => !runActive(e.session));
  for (const e of ended.slice(0, Math.max(0, ended.length - keep))) {
    if (e.outputTimer) clearTimeout(e.outputTimer);
    entries.delete(e.session.id);
  }
  changed(ctx, workspaceId);
}
async function start(ctx: ModuleContext, d: WorkspaceDescriptor, a: StartArgs) {
  if (a.mode !== "run" && a.mode !== "debug") throw new Error("Choose run or debug");
  if (!!a.configId === !!a.candidate) throw new Error("Choose one saved or detected configuration");
  const config = await configuration(ctx, d, a);
  const key = a.configId ? `saved:${a.configId}` : JSON.stringify([config.type, config.cwd, config.target]);
  let duplicate = byWorkspace(d.id).find(e => runActive(e.session) && e.key === key);
  if (duplicate && a.restart) await stop(ctx, duplicate);
  duplicate = byWorkspace(d.id).find(e => runActive(e.session) && e.key === key);
  if (duplicate) throw new Error("This configuration is already running");
  if (byWorkspace(d.id).filter(e => runActive(e.session)).length >= 24) throw new Error("Stop a run before starting another one");
  const session: RunSession = { id: crypto.randomUUID(), workspaceId: d.id, configId: a.configId || null,
    name: config.name, type: config.type, mode: a.mode, state: "starting", startedAt: Date.now() };
  if (a.mode === "debug") {
    if (!debugKind(config.type)) throw new Error(`Debugging isn't supported for ${config.type} configurations`);
    if (!(await debugAvailable(ctx, d))) throw new Error("Install the Debugger to debug");
  }
  const e: Entry = { session, args: a, key, chunks: [], size: 0, dropped: false, seq: 0, handle: null,
    cancelled: false, killing: false, completion: Promise.resolve() };
  entries.set(session.id, e);
  changed(ctx, d.id);
  ctx.events.emit("run.reveal", { workspaceId: d.id, id: session.id });
  e.completion = (async () => {
    try {
      const exit = await execute(ctx, d, e, config, new Set(a.configId ? [a.configId] : []), true);
      session.exitCode = exit?.code ?? null;
      session.state = "exited";
      append(ctx, e, "system", e.cancelled ? "Stopped\n" : `Process finished with exit code ${session.exitCode ?? "unknown"}\n`);
    } catch (error) {
      session.state = e.cancelled ? "exited" : "failed";
      if (!e.cancelled) session.error = errMsg(error);
      append(ctx, e, "system", e.cancelled ? "Stopped\n" : `${session.error}\n`);
    } finally {
      session.endedAt = Date.now(); delete session.phase;
      prune(ctx, d.id);
    }
  })();
  return { ...session };
}

async function debugAvailable(ctx: ModuleContext, d: WorkspaceDescriptor) {
  return !!(await ctx.modules.call("debug", "capabilities", { workspaceId: d.id }).catch(() => null))?.debug;
}
/** Debug service only: console output and pause state of a debug session, and the end of Node sessions. */
function debugReport(ctx: ModuleContext, d: WorkspaceDescriptor, a: any) {
  const e = entry(a.id, d.id);
  if (a.output && typeof a.output.text === "string") append(ctx, e, ["stdout", "stderr", "system"].includes(a.output.stream) ? a.output.stream : "stdout", a.output.text.slice(0, 65536));
  if (runActive(e.session) && e.session.state !== "stopping") {
    if (a.state === "paused") {
      e.session.state = "paused";
      if (a.pausedAt && typeof a.pausedAt.path === "string" && Number.isInteger(a.pausedAt.line)) e.session.pausedAt = { path: a.pausedAt.path, line: a.pausedAt.line, ...(a.pausedAt.reason ? { reason: String(a.pausedAt.reason) } : {}) };
      else delete e.session.pausedAt;
      changed(ctx, d.id);
    } else if (a.state === "running") { e.session.state = "running"; delete e.session.pausedAt; delete e.session.phase; changed(ctx, d.id); }
  }
  if (a.ended && e.debug?.kind === "js") e.debug.done?.(Number.isInteger(a.exitCode) ? a.exitCode : null);
  return { ok: true };
}
type Command = keyof RunServiceMethods;
async function invoke(ctx: ModuleContext, d: WorkspaceDescriptor, method: Command, a: any) {
  switch (method) {
    case "capabilities": {
      const caps = await ctx.modules.call("debug", "capabilities", { workspaceId: d.id }).catch(() => null);
      return caps?.debug ? { debug: true, debugTypes: caps.debugTypes || [] } : { debug: false, debugTypes: [] };
    }
    case "list": return list(d.id);
    case "start": return start(ctx, d, { ...a, workspaceId: d.id });
    case "stop": return stop(ctx, entry(a.id, d.id), a.force === true);
    case "restart": {
      const e = entry(a.id, d.id);
      await stop(ctx, e);
      return start(ctx, d, { ...e.args, restart: false });
    }
    case "output": {
      const e = entry(a.id, d.id), after = Number.isSafeInteger(a.after) && a.after >= 0 ? a.after : 0;
      const limit = Number.isInteger(a.limit) ? Math.max(1, Math.min(maximumChunks, a.limit)) : 400;
      const available = e.chunks.filter(c => c.seq > after);
      const chunks = a.tail === true ? available.slice(-limit) : available.slice(0, limit);
      return { chunks, next: chunks[chunks.length - 1]?.seq ?? after, truncated: (a.tail === true && available.length > limit) || (e.dropped && after < (e.chunks[0]?.seq ?? e.seq) - 1) };
    }
    case "clear":
      if (a.id) entry(a.id, d.id);
      for (const e of byWorkspace(d.id)) if ((!a.id || a.id === e.session.id) && !runActive(e.session)) {
        if (e.outputTimer) clearTimeout(e.outputTimer);
        entries.delete(e.session.id);
      }
      changed(ctx, d.id);
      return list(d.id);
  }
}
const string = { type: "string" }, bool = { type: "boolean" };
const definitions: [Command, string, Record<string, unknown>, string[]][] = [
  ["capabilities", "Read run and debug support for this workspace.", {}, []],
  ["list", "List sessions in the authenticated workspace.", {}, []],
  ["start", "Run a saved configuration or detected candidate in the authenticated workspace. Requires native approval.", {
    configId: string, candidate: { type: "object", properties: { name: string, type: string, target: string, cwd: string, file: string, line: { type: "integer" } }, required: ["name", "type", "target", "cwd"], additionalProperties: false },
    mode: { enum: ["run", "debug"] }, restart: bool,
  }, ["mode"]],
  ["stop", "Stop a run session and wait for exit.", { id: string, force: bool }, ["id"]],
  ["restart", "Stop and start the session's configuration again. Requires native approval.", { id: string }, ["id"]],
  ["output", "Read bounded stdout, stderr and system output. Use next as after to continue.", { id: string, after: { type: "integer" }, limit: { type: "integer" }, tail: bool }, ["id"]],
  ["clear", "Clear ended sessions, optionally by session ID.", { id: string }, []],
];

const mod: AppModule = {
  id: "run", moduleApiVersion: 1,
  activate(ctx, previous) {
    for (const saved of Array.isArray(previous) ? previous : []) {
      if (!saved?.session?.id || runActive(saved.session)) continue;
      entries.set(saved.session.id, { ...saved, handle: null, cancelled: false, killing: false, completion: Promise.resolve() });
    }
    ctx.events.on("viewer.startRunCandidate", async (candidate: RunCandidate & { workspaceId: string }) => {
      if (candidate?.workspaceId !== ctx.state.get<{ id: string }>("workspace.selected")?.id) return;
      try {
        const d = await workspace(ctx, candidate.workspaceId);
        const { workspaceId: _w, mode, ...picked } = candidate as RunCandidate & { workspaceId: string; mode?: string };
        await start(ctx, d, { workspaceId: d.id, candidate: picked, mode: mode === "debug" ? "debug" : "run" });
      } catch (e) { ctx.host.ui.toast("error", errMsg(e)); }
    });
    mcp = exportMcpTools(ctx, "Run sessions", definitions.map(([method, description, properties, required]) => ({
      name: `run_${method}`, description, inputSchema: { type: "object", properties, required, additionalProperties: false },
      annotations: { readOnlyHint: ["capabilities", "list", "output"].includes(method), destructiveHint: method === "clear" },
      timeoutMs: method === "start" || method === "restart" ? 175000 : 30000,
      handler: async (a, scope) => {
        const d = await workspace(ctx, scope.workspaceId);
        if (d.machineId !== scope.machineId) throw new Error("MCP machine scope does not match this workspace");
        if (method === "start" || method === "restart") {
          const target = method === "restart" ? entry(a.id, d.id).session.name : String(a.configId || a.candidate?.name || "").slice(0, 120);
          const result = await ctx.host.approvals.request({ operation: `run.${method}`, title: "Allow this agent to run code?", detail: `${d.name}\n${target}`, timeoutMs: 160000 });
          if (result.optionId !== "allow") throw new Error("Run approval was denied or expired");
        }
        return invoke(ctx, d, method, a);
      },
    })));
  },
  canSwap: () => ({ ok: !mcp?.pending() && ![...entries.values()].some(e => runActive(e.session)), reason: "A run or agent command is active" }),
  deactivate() {
    for (const e of entries.values()) if (e.outputTimer) clearTimeout(e.outputTimer);
  },
  snapshot: () => [...entries.values()].map(({ session, args, key, chunks, size, dropped, seq }) => ({ session, args, key, chunks, size, dropped, seq })),
  methods: {
    ...Object.fromEntries(definitions.map(([method]) => [method, async (ctx: ModuleContext, a: any) => invoke(ctx, await workspace(ctx, a.workspaceId), method, a)])),
    async debugReport(ctx, a, meta) {
      if (meta?.caller !== "debug") throw new Error("Only the debugger reports debug state");
      return debugReport(ctx, await workspace(ctx, a.workspaceId), a);
    },
  },
};
export default mod;
