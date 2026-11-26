import { referenceUpdates } from "./context";
// Workflow execution on the daemon. Semantics follow HatoPad's flow runner: follow connections
// pass output on, converging follows join (all/any), path connections are routes chosen by an AI
// Agent (or a Yes/No Prompt), and use connections make blocks tools of AI Agents and Chatboxes.
import type { ModuleContext, Handle, ImageAttachment } from "@hato/sdk/types";
import { errMsg } from "@hato/sdk/runtime";
import { acpServer, transportOf } from "@hato/sdk/mcp-servers";
import type { AgentProfile } from "@hato/sdk/persistent-agents";
import {
  type WorkflowBlock, type WorkflowBlockState, type WorkflowDefinition, type WorkflowEdge, type WorkflowRun, type WorkflowRunEnv,
  capabilityMcpServer, edgeType, isAgentBlock, isCapabilityBlock, isInternalMcp, isStartBlock, isTriggerBlock, isEventSource, preview, renderPrompt,
} from "@hato/sdk/workflows";
import { appAction, runScript } from "./procs";
import { issueEndpoint, revokeWhere } from "./mcp";
import { armFileTrigger, armHttpTrigger, armSocketTrigger, applyTriggerPatch, renderTriggerOutput, type ArmedTrigger } from "./triggers";

export interface Exec {
  run: WorkflowRun; env: WorkflowRunEnv; def: WorkflowDefinition;
  mcpCalls: Map<string, { blockId: string; edgeId: string; callId: string; title: string; status: string }>;
  outputs: Map<string, string>; busy: Set<string>;
  mcpUpdateErrors: Map<string, string>;
  queuedPrompts: Map<string, string[]>;
  providerTurns: Map<string, string>;
  pendingProviderEvents: Map<string, ProviderTurnEvent[]>;
  timers: Map<string, ReturnType<typeof setTimeout>>;
  /** One-shot delay overrides (ms) for the next arming of a Timer, set by an agent's tool call. */
  delays: Map<string, number>;
  triggers: Map<string, ArmedTrigger>;
  triggerWaiters: Map<string, Set<(output: string) => void>>;
  /** FIFO inputs per target block waiting on queue connections while the target is busy. */
  queues: Map<string, { edgeId: string; input: string; ancestors: string[] }[]>;
  /** Text Input blocks holding the run open while they wait for typed text. */
  inputs: Set<string>;
  answers: Map<string, { pauseId: string; resolve: (v: string) => void; reject: (e: Error) => void }>;
  background: Set<Promise<unknown>>; loops: Map<string, number>; steps: number;
  joins: Map<string, { resolved: Set<string>; active: Set<string>; outputs: Map<string, string>; fired: boolean }>;
  fetched: Map<string, number>; meetingWaiters: Map<string, Set<() => void>>; participantStatuses: Map<string, string>;
  procs: Set<Handle>; cancelled: boolean; flowFailed?: string; driving: boolean; deadline?: ReturnType<typeof setTimeout>;
}

let ctx: ModuleContext;
let persist: (run: WorkflowRun) => void;
let trackAutonomousClaudeTurns = true;
export const execs = new Map<string, Exec>();
export function initEngine(c: ModuleContext, save: (run: WorkflowRun) => void) { ctx = c; persist = save; }
export function setAutonomousClaudeTurns(enabled: boolean) { trackAutonomousClaudeTurns = enabled; }

const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const block = (x: Exec, id: string) => { const b = x.def.blocks.find(b => b.id === id); if (!b) throw new Error(`Unknown block '${id}'`); return b; };
export const stateOf = (x: Exec, id: string) => { let s = x.run.blocks.find(s => s.blockId === id); if (!s) { s = { blockId: id, status: "idle", runs: 0, log: [] }; x.run.blocks.push(s); } return s; };
const outputLimit = (x: Exec) => x.def.settings?.outputLimitChars ?? 200_000;
function log(s: WorkflowBlockState, kind: WorkflowBlockState["log"][number]["kind"], text: string) {
  s.log.push({ at: now(), kind, text: text.length > 4000 ? text.slice(0, 4000) + "…" : text });
  if (s.log.length > 200) s.log.splice(0, s.log.length - 200);
}
export function touch(x: Exec) {
  publishMeetingStatusChanges(x);
  if (x.run.status === "running" || x.run.status === "waiting") {
    const active = x.run.blocks.some(s => s.status === "running");
    const paused = x.run.blocks.some(s => ["awaiting_user_input", "awaiting_permission", "waiting_timer", "waiting_trigger", "waiting_input"].includes(s.status));
    x.run.status = active ? "running" : paused ? "waiting" : "running";
  }
  persist(x.run);
}
export function transfer(x: Exec, edgeId: string, phase: "send" | "return" | "flow", payload: unknown, callId = crypto.randomUUID(), action?: string, error = false) {
  const events = x.run.transfers ??= [];
  const text = typeof payload === "string" ? payload : JSON.stringify(payload) || "";
  events.push({ seq: (events[events.length - 1]?.seq ?? 0) + 1, callId, edgeId, phase, at: now(), action, chars: text.length, ...(error ? { error: true } : {}) });
  if (events.length > 1000) events.splice(0, events.length - 1000);
  touch(x);
  return callId;
}
/** Attribute provider MCP events only to a server explicitly connected to this agent. */
export function recordMcpActivity(x: Exec, callerId: string, sessionId: string, u: any) {
  if (stateOf(x, callerId).sessionId !== sessionId || !u.toolCallId) return;
  const key = `${sessionId}:${u.toolCallId}`;
  let call = x.mcpCalls.get(key);
  if (!call) {
    const raw = u.rawInput || {};
    const server = raw.server || raw.server_name || raw.mcpServer || u._meta?.mcpServer;
    const title = String(u.title || raw.tool || raw.name || "");
    const names = [u.title, raw.tool, raw.name].filter((name): name is string => typeof name === "string");
    const candidates = toolTargets(x, callerId).filter(b => b.type === "mcp").filter(b => {
      const config = x.env.mcpServers.find(m => m.id === capabilityMcpServer(b));
      return config && [config.id, config.name].some(name => server === name || names.some(tool => tool.startsWith(`mcp__${name}__`) || tool.startsWith(`mcp.${name}.`)));
    });
    // Ambiguous or unqualified native tools must never light up an unrelated MCP block.
    if (candidates.length !== 1) return;
    const target = candidates[0];
    const edge = x.def.edges.find(e => e.from === callerId && e.to === target.id && edgeType(e) === "use")
      || x.def.edges.find(e => e.from === callerId && e.to === target.id && block(x, callerId).type === "chatbox");
    if (!edge) return;
    const callId = transfer(x, edge.id, "send", raw.arguments || raw, undefined, title);
    call = { blockId: target.id, edgeId: edge.id, callId, title: title || String(raw.tool || "MCP tool"), status: "" };
    x.mcpCalls.set(key, call);
    const st = stateOf(x, target.id);
    st.runs++; st.startedAt = now(); st.completedAt = undefined; st.error = undefined;
    log(st, "tool", `${callerId} · ${call.title} · ${callId}\n${preview(JSON.stringify(raw.arguments || raw), 3000)}`);
  }
  const status = String(u.status || "in_progress");
  if (call.status === status || ["completed", "failed"].includes(call.status)) return;
  call.status = status;
  const st = stateOf(x, call.blockId);
  if (["completed", "failed"].includes(status)) {
    const result = (u.content || []).map((item: any) => item.content?.text || item.text || "").join("\n");
    log(st, status === "failed" ? "error" : "response", `${call.title} · ${status} · ${call.callId}\n${result}`);
    transfer(x, call.edgeId, "return", result, call.callId, call.title, status === "failed");
    if (status === "failed") st.error = preview(result || `${call.title} failed`, 1000);
    st.completedAt = now();
  }
  const pending = [...x.mcpCalls.values()].some(c => c.blockId === call!.blockId && !["completed", "failed"].includes(c.status));
  st.status = pending ? "running" : st.error ? "failed" : "succeeded";
  // Retain bounded terminal identities so duplicate provider updates are harmless.
  if (x.mcpCalls.size > 200) for (const [id, old] of x.mcpCalls) {
    if (x.mcpCalls.size <= 200) break;
    if (["completed", "failed"].includes(old.status)) x.mcpCalls.delete(id);
  }
  touch(x);
}

function assertActive(x: Exec) { if (x.cancelled) throw new Error("Workflow run was cancelled"); }

export function newExec(run: WorkflowRun, env: WorkflowRunEnv): Exec {
  const x: Exec = {
    run, env, def: run.definition, mcpCalls: new Map(), outputs: new Map(), busy: new Set(), timers: new Map(), delays: new Map(),
    triggers: new Map(), triggerWaiters: new Map(), queues: new Map(), inputs: new Set(), answers: new Map(), background: new Set(),
    mcpUpdateErrors: new Map(), queuedPrompts: new Map(), providerTurns: new Map(), pendingProviderEvents: new Map(),
    loops: new Map(), steps: 0, joins: new Map(), fetched: new Map(), meetingWaiters: new Map(), participantStatuses: new Map(run.blocks.map(s => [s.blockId, s.status])), procs: new Set(), cancelled: false, driving: false,
  };
  for (const s of run.blocks) if (s.output !== undefined) x.outputs.set(s.blockId, s.output);
  execs.set(run.id, x);
  return x;
}

// ---------------------------------------------------------------- graph helpers

const flowEdge = (e: WorkflowEdge) => edgeType(e) !== "use";
const joinEdge = (e: WorkflowEdge) => edgeType(e) !== "use" && edgeType(e) !== "queue";
function reaches(x: Exec, from: string, to: string) {
  const seen = new Set<string>(), stack = [from];
  while (stack.length) {
    const c = stack.pop()!;
    if (c === to) return true;
    if (seen.has(c)) continue;
    seen.add(c);
    for (const e of x.def.edges) if (e.from === c && flowEdge(e)) stack.push(e.to);
  }
  return false;
}
/** Connections that close a cycle are loop returns, not join inputs. */
const forwardEdge = (x: Exec, e: WorkflowEdge) => !e.loop && flowEdge(e) && !reaches(x, e.to, e.from);
/** Whether the run's own flow can reach a block. Blocks that only run when an agent calls them
 *  (e.g. a Timer used as a tool) and armed triggers fire as independent events and are never join inputs. */
const flowDriven = (x: Exec, id: string) => defaultRoots(x).some(r => r === id || reaches(x, r, id));
/** Blocks a caller may use: use connections, and every outgoing connection of a Chatbox. */
export function toolTargets(x: Exec, callerId: string): WorkflowBlock[] {
  const caller = block(x, callerId);
  const ids = x.def.edges.filter(e => e.from === callerId && (edgeType(e) === "use" || caller.type === "chatbox")).map(e => e.to);
  return [...new Set(ids)].map(id => block(x, id));
}

function joinInput(x: Exec, target: string, active: WorkflowEdge[], outputs: Map<string, string>) {
  return active.map(e => `## ${block(x, e.from).label} (${e.from})\n${preview(outputs.get(e.from) ?? "", Math.floor(20_000 / active.length))}`).join("\n\n");
}

function resolveEdge(x: Exec, e: WorkflowEdge, active: boolean, output: string, path: string[], visited = new Set<string>()): Promise<unknown>[] {
  if (active) transfer(x, e.id, "flow", output);
  const target = e.to;
  const incoming = x.def.edges.filter(i => i.to === target && joinEdge(i) && forwardEdge(x, i) && flowDriven(x, i.from));
  const outgoing = () => x.def.edges.filter(o => o.from === target && joinEdge(o) && forwardEdge(x, o));
  if (incoming.length < 2) {
    if (active) return [invoke(x, target, output, path)];
    if (visited.has(target)) return [];
    visited.add(target);
    return outgoing().flatMap(n => resolveEdge(x, n, false, "", [...path, target], visited));
  }
  let entry = x.joins.get(target);
  if (!entry) { entry = { resolved: new Set(), active: new Set(), outputs: new Map(), fired: false }; x.joins.set(target, entry); }
  entry.resolved.add(e.id);
  if (active) { entry.active.add(e.id); entry.outputs.set(e.from, output); }
  const complete = incoming.every(i => entry!.resolved.has(i.id));
  const results: Promise<unknown>[] = [];
  if (!entry.fired && entry.active.size > 0 && (complete || block(x, target).join === "any")) {
    entry.fired = true;
    const activeEdges = incoming.filter(i => entry!.active.has(i.id));
    const input = activeEdges.length === 1 ? entry.outputs.get(activeEdges[0].from)! : joinInput(x, target, activeEdges, entry.outputs);
    results.push(invoke(x, target, input, path));
  }
  if (complete) {
    x.joins.delete(target);
    if (!entry.fired && !visited.has(target)) {
      visited.add(target);
      for (const n of outgoing()) results.push(...resolveEdge(x, n, false, "", [...path, target], visited));
    }
  }
  return results;
}

// ---------------------------------------------------------------- invocation

/** Run one block and, unless it is a Chatbox or a tool call that returns to its caller, its followers.
 *  `viaTool` marks a block invoked by an agent; its failure is reported to that agent, not the run. */
export async function invoke(x: Exec, id: string, input: string, ancestors: string[] = [], viaTool = false, images?: ImageAttachment[]): Promise<string> {
  assertActive(x);
  if (x.busy.has(id)) throw new Error("This block is already active; recursive or concurrent calls are not allowed");
  if (++x.steps > (x.def.settings?.maxSteps ?? 1000)) throw new Error("Workflow exceeded its block execution limit");
  const b = block(x, id), s = stateOf(x, id);
  x.busy.add(id);
  Object.assign(s, { status: "running", startedAt: now(), completedAt: undefined, error: undefined, selectedRoute: undefined, input: preview(input, 20_000), runs: s.runs + 1 });
  touch(x);
  let output = input;
  try {
    const rendered = () => renderPrompt(b.prompt, input, x.outputs);
    switch (b.type) {
      case "start_button": case "text": output = rendered(); break;
      case "start_input": output = input; break;
      case "markdown": output = b.prompt.trim() ? rendered() : input; break;
      case "skill": output = b.skillId ? await loadSkill(x, b) : rendered(); break;
      case "meeting": output = JSON.stringify(meetingTail(s, 20)); break;
      case "terminal_control": case "task_controls": case "mcp": case "browser": output = `${b.label} adds tools to connected agents.`; break;
      case "script": output = await script(x, b, s, input); break;
      case "run_app": output = JSON.stringify(await appAction(ctx, x.env.root, b.app!.name, b.command || "", b.app?.action || "start", b.app?.lines || 100)); break;
      case "text_input": output = b.prompt.trim() ? rendered() : input; break;
      case "http_trigger": case "socket_trigger": case "file_trigger": {
        // Reached by a connection or tool call: (re)arm the trigger and return without followers.
        const armed = await armTrigger(x, b);
        return JSON.stringify({ armed: true, endpoint: armed.endpoint });
      }
      case "timer": {
        armTimer(x, b, s, input);
        x.busy.delete(id);
        return `Timer armed for ${s.waitingUntil}`;
      }
      case "user_prompt": case "yes_no_prompt": {
        const question = rendered().trim() || input;
        let answer = await ask(x, b, s, question);
        if (b.type === "yes_no_prompt") { answer = /^(y|yes|true)$/i.test(answer.trim()) ? "yes" : "no"; s.selectedRoute = answer; }
        output = answer;
        break;
      }
      case "ai": case "chatbox": output = await agent(x, b, s, input, images); break;
      default: throw new Error(`Unsupported block type '${b.type}'`);
    }
    assertActive(x);
    completeBlock(x, s, output);
  } catch (e) {
    const message = errMsg(e);
    Object.assign(s, { status: x.cancelled ? "cancelled" : "failed", error: message, completedAt: now(), question: undefined, pauseId: undefined, permissionId: undefined });
    log(s, "error", message);
    if (!viaTool && !x.cancelled) x.flowFailed ??= `${b.label}: ${message}`;
    touch(x);
    throw e;
  } finally { releaseBlock(x, id); }
  if (b.type !== "chatbox") await followers(x, b, s, output, ancestors);
  return output;
}

function completeBlock(x: Exec, s: WorkflowBlockState, output: string) {
  log(s, "response", output);
  s.output = output.slice(-outputLimit(x));
  x.outputs.set(s.blockId, output);
  Object.assign(s, { status: "succeeded", completedAt: now(), question: undefined, pauseId: undefined, permissionId: undefined });
  touch(x);
}

function releaseBlock(x: Exec, id: string) {
  x.busy.delete(id);
  const pending = x.pendingProviderEvents.get(id);
  x.pendingProviderEvents.delete(id);
  for (const event of pending ?? []) recordProviderTurn(x, event);
  if (x.busy.has(id)) return;
  const queued = x.queuedPrompts.get(id);
  x.queuedPrompts.delete(id);
  if (queued?.length && !x.cancelled && x.def.blocks.some(b => b.id === id)) {
    track(x, invoke(x, id, queued.join("\n\n"), [], true));
  }
  drainQueue(x, id);
}

// ---------------------------------------------------------------- queue connections

const DEFAULT_QUEUE_LIMIT = 100;
const queueLimit = (e: WorkflowEdge) => Math.min(Math.max(e.queueLimit ?? DEFAULT_QUEUE_LIMIT, 1), 10_000);
const waitingOn = (x: Exec, e: WorkflowEdge) => (x.queues.get(e.to) || []).filter(i => i.edgeId === e.id).length;
/** Whether every queue connection leaving `from` can take one more item right now. */
export function queuesHaveRoom(x: Exec, from: string) {
  return x.def.edges.every(e => e.from !== from || edgeType(e) !== "queue" || waitingOn(x, e) < queueLimit(e));
}
function setDepth(x: Exec, id: string) {
  const s = x.run.blocks.find(s => s.blockId === id); if (!s) return;
  const n = x.queues.get(id)?.length || 0;
  if (n) s.queueDepth = n; else delete s.queueDepth;
}

/** A queue connection: run the target now when it is free and nothing is waiting, else append to
 *  its FIFO. Returns the started run, true when queued, or false when the queue is full. */
function enqueue(x: Exec, e: WorkflowEdge, input: string, ancestors: string[]): Promise<unknown> | boolean {
  const q = x.queues.get(e.to) || [];
  if (!x.busy.has(e.to) && !q.length) { transfer(x, e.id, "flow", input); return invoke(x, e.to, input, ancestors); }
  const from = block(x, e.from), to = block(x, e.to);
  if (waitingOn(x, e) >= queueLimit(e)) {
    log(stateOf(x, e.from), "error", `Queue to '${to.label}' is full (${queueLimit(e)} waiting); dropped an item`);
    touch(x);
    return false;
  }
  q.push({ edgeId: e.id, input, ancestors });
  x.queues.set(e.to, q);
  setDepth(x, e.to);
  log(stateOf(x, e.to), "lifecycle", `Queued input from '${from.label}' (${q.length} waiting)`);
  touch(x);
  return true;
}

/** Feed the next waiting item to a block that has become free. */
function drainQueue(x: Exec, id: string) {
  if (x.cancelled || x.busy.has(id)) return;
  const q = x.queues.get(id), item = q?.shift();
  if (!q || !item) return;
  if (!q.length) x.queues.delete(id);
  setDepth(x, id);
  if (!x.def.blocks.some(b => b.id === id) || !x.def.edges.some(e => e.id === item.edgeId)) { drainQueue(x, id); return; }
  transfer(x, item.edgeId, "flow", item.input);
  // Failures are recorded on the block and the run by invoke itself.
  track(x, invoke(x, id, item.input, item.ancestors).catch(() => {}));
}

export type ProviderTurnEvent = {
  sessionId: string;
  workflow: { runId: string; blockId: string };
  turnId: string;
} & ({ phase: "started" } | { phase: "finished"; state: string; output: string; error?: string });

export function recordProviderTurn(x: Exec, event: ProviderTurnEvent) {
  const id = event.workflow.blockId;
  const b = x.def.blocks.find(b => b.id === id && isAgentBlock(b));
  const s = x.run.blocks.find(b => b.blockId === id);
  if (!s || s.sessionId !== event.sessionId) return;
  const active = x.providerTurns.get(id);
  // The adapter can start a wakeup immediately after replying to a workflow prompt, before its
  // result has been picked up by the workflow. Replay those events after the owned turn settles.
  if (x.busy.has(id) && !active) {
    const events = x.pendingProviderEvents.get(id) ?? [];
    events.push(event);
    x.pendingProviderEvents.set(id, events);
    return;
  }
  if (event.phase === "started") {
    if (!b || x.cancelled || active) return;
    x.providerTurns.set(id, event.turnId);
    x.busy.add(id);
    if (x.run.status !== "running" && x.run.status !== "waiting") {
      x.run.status = "running";
      x.run.completedAt = undefined;
    }
    Object.assign(s, { status: "running", startedAt: now(), completedAt: undefined, error: undefined,
      selectedRoute: undefined, runs: s.runs + 1 });
    touch(x);
    return;
  }
  if (active !== event.turnId) return;
  x.providerTurns.delete(id);
  if (x.cancelled || event.state !== "completed") {
    const status = x.cancelled || event.state === "stopped" ? "cancelled" : "failed";
    const error = event.error || (status === "failed" ? "Provider turn failed" : undefined);
    Object.assign(s, { status, error, completedAt: now(), permissionId: undefined });
    if (error) log(s, "error", error);
    touch(x);
  } else {
    if (b?.type === "chatbox" && event.output) {
      s.chat = [...(s.chat || []), { id: crypto.randomUUID(), role: "assistant" as const, text: event.output, at: now() }].slice(-200);
    }
    completeBlock(x, s, event.output);
  }
  const completed = s.status === "succeeded";
  releaseBlock(x, id);
  if (b?.type === "ai" && completed) track(x, followers(x, b, s, event.output, []));
  settle(x);
}

async function followers(x: Exec, b: WorkflowBlock, s: WorkflowBlockState, output: string, ancestors: string[]) {
  const id = b.id, out = x.def.edges.filter(e => e.from === id && flowEdge(e));
  const pending: Promise<unknown>[] = [];
  for (const e of out.filter(e => edgeType(e) === "queue")) {
    const started = enqueue(x, e, output, [...ancestors, id]);
    if (started instanceof Promise) pending.push(started);
  }
  for (const e of out.filter(e => edgeType(e) === "path" && e.label !== s.selectedRoute && forwardEdge(x, e)))
    pending.push(...resolveEdge(x, e, false, "", [...ancestors, id]));
  for (const e of out.filter(e => edgeType(e) === "follow" || (edgeType(e) === "path" && e.label === s.selectedRoute))) {
    if (x.busy.has(e.to)) {
      const target = block(x, e.to);
      // A block used as a tool returns its result to the waiting caller; a drawn connection
      // back to that caller must not also inject it into the caller's active turn.
      if (ancestors.includes(e.to) || !isAgentBlock(target) || !stateOf(x, e.to).sessionId) {
        log(s, "lifecycle", `Skipped connection to active block '${target.label}'`); continue;
      }
      // Any other upstream activity (a fired timer, a parallel branch) steers the running session.
      transfer(x, e.id, "flow", output, undefined, "steer");
      log(s, "lifecycle", `Steered output into active block '${target.label}'`);
      pending.push(steer(x, e.to, output));
      continue;
    }
    const back = ancestors.includes(e.to) || e.to === id || !forwardEdge(x, e);
    if (back) {
      const count = (x.loops.get(e.id) ?? 0) + 1, limit = x.def.settings?.maxLoopCount ?? 100;
      if (count > limit) throw new Error(`Workflow loop '${e.label || e.id}' reached its limit of ${limit} iterations`);
      x.loops.set(e.id, count);
      transfer(x, e.id, "flow", output);
      pending.push(invoke(x, e.to, output, [...ancestors, id]));
    } else pending.push(...resolveEdge(x, e, true, output, [...ancestors, id]));
  }
  const settled = await Promise.allSettled(pending);
  const failed = settled.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed) throw failed.reason;
}

// ---------------------------------------------------------------- block types

async function loadSkill(x: Exec, b: WorkflowBlock) {
  const g = await ctx.host.capabilities.request({ kind: "fs", root: x.env.root, target: { kind: "local" } });
  try {
    const file = await ctx.host.fs.read(g.grant, b.skillId!, 256 * 1024);
    if (file.binary || file.truncated) throw new Error(`Skill file is binary or too large: ${b.skillId}`);
    const dir = b.skillId!.includes("/") ? b.skillId!.slice(0, b.skillId!.lastIndexOf("/")) : ".";
    return JSON.stringify({ skill: { name: b.label, path: b.skillId, baseDirectory: `${x.env.root.replace(/\/$/, "")}/${dir}`, content: file.text || "" } });
  } finally { await ctx.host.capabilities.release(g.grant); }
}

async function script(x: Exec, b: WorkflowBlock, s: WorkflowBlockState, input: string) {
  log(s, "prompt", input);
  const timeoutMs = Math.min(Math.max((b.timeoutSeconds ?? 1800) * 1000, 1000), 86_400_000);
  let current: Handle | null = null;
  const r = await runScript(ctx, x.env.root, b.command || "", input, { timeoutMs, track: h => { if (current) x.procs.delete(current); current = h; if (h) x.procs.add(h); } });
  assertActive(x);
  if (r.code !== 0) throw new Error(`Script exited with ${r.code ?? "a signal"}${r.stderr.trim() ? `: ${preview(r.stderr.trim(), 4000)}` : r.stdout.trim() ? `: ${preview(r.stdout.trim(), 4000)}` : ""}`);
  return r.stdout + (r.stderr.trim() ? `\n[stderr]\n${r.stderr}` : "");
}

function armTimer(x: Exec, b: WorkflowBlock, s: WorkflowBlockState, input: string) {
  const old = x.timers.get(b.id); if (old) clearTimeout(old);
  const override = x.delays.get(b.id); x.delays.delete(b.id);
  const ms = Math.max(0, override ?? (b.seconds ?? 0) * 1000);
  Object.assign(s, { status: "waiting_timer", waitingUntil: new Date(Date.now() + ms).toISOString(), pauseId: crypto.randomUUID() });
  log(s, "lifecycle", `Timer armed for ${s.waitingUntil}`);
  touch(x);
  x.timers.set(b.id, setTimeout(() => {
    x.timers.delete(b.id);
    if (x.cancelled) return;
    x.steps = 0;
    s.output = input; x.outputs.set(b.id, input);
    Object.assign(s, { status: "succeeded", completedAt: now(), waitingUntil: undefined, pauseId: undefined });
    log(s, "lifecycle", "Timer fired; starting followers");
    touch(x);
    track(x, followers(x, b, s, input, []).catch(e => { x.flowFailed ??= `${b.label}: ${errMsg(e)}`; }));
  }, ms));
}

/** Delay in ms for a Timer armed by an agent: `seconds` or an absolute ISO `at`, else the block's
 *  own seconds. Bounded by the run's maximum duration so a timer cannot outlive its run. */
export function timerDelay(x: Exec, a: { seconds?: unknown; at?: unknown }): number | undefined {
  const max = x.def.settings?.maxRunDurationMs ?? 24 * 3600_000;
  let ms: number | undefined;
  if (a.at !== undefined && a.at !== null && a.at !== "") {
    const t = Date.parse(String(a.at));
    if (!Number.isFinite(t)) throw new Error("Timer 'at' must be an ISO 8601 date-time");
    ms = t - Date.now();
  } else if (a.seconds !== undefined && a.seconds !== null && a.seconds !== "") {
    const n = Number(a.seconds);
    if (!Number.isFinite(n) || n < 0) throw new Error("Timer 'seconds' must be a non-negative number");
    ms = n * 1000;
  }
  if (ms === undefined) return undefined;
  if (ms > max) throw new Error(`Timer delay exceeds the run's maximum duration of ${Math.round(max / 1000)} seconds`);
  return Math.max(0, ms);
}

/** Status or cancellation of a Timer without re-arming it. */
export function timerAction(x: Exec, id: string, action: "status" | "cancel") {
  const s = stateOf(x, id), armed = x.timers.has(id);
  if (action === "cancel" && armed) {
    clearTimeout(x.timers.get(id)!); x.timers.delete(id);
    Object.assign(s, { status: "cancelled", completedAt: now(), waitingUntil: undefined, pauseId: undefined });
    log(s, "lifecycle", "Timer cancelled by an agent");
    touch(x);
    return { status: "cancelled" };
  }
  return { status: armed ? "armed" : s.status, ...(armed ? { firesAt: s.waitingUntil } : {}) };
}

// ---------------------------------------------------------------- text input

/** Make Text Input blocks available: those with keepOpen (default) hold the run open. */
export function openTextInputs(x: Exec, blocks = x.def.blocks) {
  for (const b of blocks.filter(b => b.type === "text_input")) {
    const s = stateOf(x, b.id);
    if (b.keepOpen === false) { x.inputs.delete(b.id); if (s.status === "waiting_input") Object.assign(s, { status: "idle" }); continue; }
    x.inputs.add(b.id);
    if (s.status !== "running") Object.assign(s, { status: "waiting_input", error: undefined, completedAt: undefined });
  }
  touch(x);
}

/** Text typed into a Text Input block: becomes its output and runs its connections. */
export function sendText(x: Exec, blockId: string, text: string) {
  const b = block(x, blockId);
  if (b.type !== "text_input") throw new Error("Only Text Input blocks accept typed text");
  if (x.cancelled) throw new Error("This run was cancelled; start a new run to send text");
  const value = String(text).slice(0, 200_000);
  if (!value.trim()) throw new Error("Text is empty");
  if (x.run.status !== "running" && x.run.status !== "waiting") { x.run.status = "running"; x.run.completedAt = undefined; x.run.error = undefined; x.flowFailed = undefined; }
  const s = stateOf(x, blockId);
  let output = value;
  try { if (b.prompt.trim()) output = renderPrompt(b.prompt, value, x.outputs); } catch (e) { log(s, "error", `Template: ${errMsg(e)}`); }
  x.steps = 0;
  s.runs++; s.input = preview(value, 20_000);
  s.output = output.slice(-outputLimit(x)); x.outputs.set(blockId, output);
  log(s, "prompt", value);
  Object.assign(s, { status: b.keepOpen === false ? "succeeded" : "waiting_input", completedAt: now(), error: undefined });
  touch(x);
  track(x, followers(x, b, s, output, []).catch(e => { x.flowFailed ??= `${b.label}: ${errMsg(e)}`; }));
  return { accepted: true };
}

// ---------------------------------------------------------------- triggers

const TRIGGER_ACTIONS = ["status", "configure", "arm", "start", "disarm", "stop", "cancel", "wait", "fetch"];

/** Bind a trigger block (HTTP listener, socket, file watch or pipe reader). Re-arming replaces it.
 *  Throws when the trigger cannot be armed (port in use, missing file, …). */
export async function armTrigger(x: Exec, b: WorkflowBlock) {
  assertActive(x);
  await disarmTrigger(x, b.id);
  let fired = 0;
  const arm = b.type === "http_trigger" ? armHttpTrigger : b.type === "socket_trigger" ? armSocketTrigger : armFileTrigger;
  const armed = await arm(ctx, x, b, (raw, templateInput) => {
    const accepted = fireTrigger(x, b.id, raw, templateInput, fired + 1);
    if (accepted) fired++;
    return accepted;
  });
  if (x.cancelled) { await armed.disarm().catch(() => {}); throw new Error("Workflow run was cancelled"); }
  x.triggers.set(b.id, armed);
  const s = stateOf(x, b.id);
  Object.assign(s, { status: "waiting_trigger", triggerEndpoint: armed.endpoint, error: undefined, completedAt: undefined, pauseId: crypto.randomUUID() });
  log(s, "lifecycle", `Trigger armed on ${armed.endpoint}`);
  touch(x);
  return armed;
}

/** Release a trigger's listener/watch. A waiting trigger becomes `status` (default cancelled). */
export async function disarmTrigger(x: Exec, id: string, status: "cancelled" | "succeeded" = "cancelled") {
  const armed = x.triggers.get(id);
  if (!armed) return false;
  x.triggers.delete(id);
  await armed.disarm().catch(e => ctx.log.warn("workflow trigger disarm", errMsg(e)));
  const s = x.run.blocks.find(s => s.blockId === id);
  if (s && s.status === "waiting_trigger") Object.assign(s, { status, completedAt: now(), triggerEndpoint: undefined, pauseId: undefined });
  for (const wake of [...(x.triggerWaiters.get(id) || [])]) wake("");
  touch(x);
  return true;
}

/** Release every listener, socket helper, pipe reader and file watch of all runs, and clear
 *  timers. Called when the runtime is deactivated (reload, runtime replacement, shutdown) so
 *  ports and processes are not left bound after this generation is gone. Run records are not
 *  changed: the next runtime marks open runs as interrupted. Bounded so deactivation cannot hang. */
export async function releaseAllTriggers(timeoutMs = 3000) {
  const pending: Promise<unknown>[] = [];
  for (const x of execs.values()) {
    for (const t of x.timers.values()) clearTimeout(t);
    x.timers.clear();
    for (const [id, armed] of [...x.triggers]) {
      x.triggers.delete(id);
      pending.push(armed.disarm().catch(e => ctx?.log.warn("workflow trigger release", errMsg(e))));
    }
  }
  if (!pending.length) return 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([Promise.allSettled(pending), new Promise(r => { timer = setTimeout(r, timeoutMs); })]).finally(() => clearTimeout(timer));
  return pending.length;
}

/** Arm every trigger block when a run starts. On the first failure, every armed trigger is
 *  released, the failing block is marked failed and the run's failure message is returned. */
export async function armTriggers(x: Exec): Promise<string | undefined> {
  for (const b of x.def.blocks.filter(isTriggerBlock)) {
    try { await armTrigger(x, b); }
    catch (e) {
      const message = `Cannot arm trigger '${b.label}': ${errMsg(e)}`;
      const s = stateOf(x, b.id);
      Object.assign(s, { status: "failed", error: message, completedAt: now(), triggerEndpoint: undefined, pauseId: undefined });
      log(s, "error", message);
      for (const id of [...x.triggers.keys()]) await disarmTrigger(x, id);
      x.flowFailed ??= message;
      touch(x);
      return message;
    }
  }
  return undefined;
}

/** Deliver one trigger event. Returns false when it was rejected (run inactive or a queue full). */
function fireTrigger(x: Exec, id: string, raw: string, templateInput: string, count: number): boolean {
  const b = x.def.blocks.find(b => b.id === id);
  if (x.cancelled || !b || !x.triggers.has(id)) return false;
  const s = stateOf(x, id);
  if (!queuesHaveRoom(x, id)) { log(s, "error", "Event rejected: a queue connection is full"); touch(x); return false; }
  let output = raw;
  try { output = renderTriggerOutput(x, b, raw, templateInput); } catch (e) { log(s, "error", `Trigger template: ${errMsg(e)}`); }
  x.steps = 0;
  s.runs++; s.input = preview(raw, 20_000);
  s.output = output.slice(-outputLimit(x)); x.outputs.set(id, output);
  log(s, "response", output);
  const limit = b.trigger?.continuous ? Infinity : Math.max(1, b.trigger?.maxEvents ?? 1);
  for (const wake of [...(x.triggerWaiters.get(id) || [])]) wake(output);
  if (count >= limit) {
    const armed = x.triggers.get(id)!;
    x.triggers.delete(id);
    Object.assign(s, { status: "succeeded", completedAt: now(), triggerEndpoint: undefined, pauseId: undefined });
    log(s, "lifecycle", `Trigger fired (${count}); disarmed`);
    track(x, armed.disarm());
  } else {
    s.completedAt = now();
    log(s, "lifecycle", `Trigger fired (${count}); still armed`);
  }
  touch(x);
  track(x, followers(x, b, s, output, []).catch(e => { x.flowFailed ??= `${b.label}: ${errMsg(e)}`; }));
  return true;
}

/** workflow_use_block on a trigger: status, configure, arm/start, disarm/stop/cancel, wait. */
export async function useTrigger(x: Exec, id: string, a: any) {
  const b = block(x, id), action = typeof a.action === "string" && a.action ? a.action : "status";
  if (!TRIGGER_ACTIONS.includes(action)) throw new Error(`Trigger '${b.label}' takes action ${TRIGGER_ACTIONS.join(", ")}`);
  const status = () => {
    const s = stateOf(x, id), armed = x.triggers.get(id);
    return { trigger: { type: b.type, armed: !!armed, status: s.status, ...(armed ? { endpoint: armed.endpoint } : {}),
      config: { ...(b.trigger || {}), ...(b.trigger?.secret ? { secret: "(set)" } : {}) }, events: s.runs, ...(s.error ? { error: s.error } : {}),
      ...(s.output !== undefined ? { lastEvent: preview(s.output, 4000) } : {}) } };
  };
  if (action === "status") return status();
  if (action === "disarm" || action === "stop" || action === "cancel") {
    const was = await disarmTrigger(x, id);
    log(stateOf(x, id), "lifecycle", was ? "Trigger disarmed by an agent" : "Disarm requested; trigger was not armed");
    return status();
  }
  if (action === "configure" || action === "arm" || action === "start") {
    const patch = { ...a }; delete patch.action; delete patch.block_id; delete patch.input; delete patch.timeout_seconds;
    const wasArmed = x.triggers.has(id);
    if (Object.keys(patch).length) {
      applyTriggerPatch(b, patch);
      log(stateOf(x, id), "lifecycle", `Trigger reconfigured by an agent`);
      touch(x);
    }
    if (action !== "configure" || wasArmed) await armTrigger(x, b);
    return status();
  }
  if (action === "wait") {
    const timeout = Math.min(Math.max(Number(a.timeout_seconds) || 300, 1), 86_400) * 1000;
    if (!x.triggers.has(id)) return { ...status(), waited: "not_armed" };
    const output = await new Promise<string | null>(resolve => {
      const set = x.triggerWaiters.get(id) || new Set<(o: string) => void>();
      x.triggerWaiters.set(id, set);
      const done = (v: string | null) => { set.delete(wake); if (!set.size) x.triggerWaiters.delete(id); clearTimeout(t); resolve(v); };
      const wake = (o: string) => done(o);
      const t = setTimeout(() => done(null), timeout);
      set.add(wake);
    });
    assertActive(x);
    return output === null ? { ...status(), waited: "timed_out" } : { ...status(), waited: "fired", event: preview(output, 20_000) };
  }
  return status();
}

async function ask(x: Exec, b: WorkflowBlock, s: WorkflowBlockState, question: string): Promise<string> {
  const pauseId = crypto.randomUUID();
  Object.assign(s, { status: "awaiting_user_input", question, pauseId });
  log(s, "prompt", question);
  touch(x);
  return new Promise<string>((resolve, reject) => x.answers.set(b.id, { pauseId, resolve, reject }));
}

export function answer(x: Exec, blockId: string, pauseId: string, text: string) {
  const pending = x.answers.get(blockId);
  if (!pending || pending.pauseId !== pauseId) throw new Error("This question is no longer waiting for an answer");
  x.answers.delete(blockId);
  pending.resolve(String(text).slice(0, 100_000));
}

/** Background work (tool-started blocks, fired timers, chat turns). A run whose flow already
 *  finished is settled again when its last background task ends. */
export function track<T>(x: Exec, p: Promise<T>) {
  x.background.add(p);
  void p.catch(() => {}).finally(() => { x.background.delete(p); if (!x.driving) settle(x); });
  return p;
}

// ---------------------------------------------------------------- agents

function pickProfile(x: Exec, b: WorkflowBlock): AgentProfile {
  const ps = x.env.profiles;
  const p = (b.profileId && ps.find(p => p.id === b.profileId)) || (b.provider && ps.find(p => p.provider === b.provider)) || (!b.profileId && !b.provider && (ps.find(p => p.id === x.env.defaultProfileId) || ps[0]));
  if (!p) throw new Error(`No enabled AI provider for '${b.label}' on this machine${b.provider ? ` (${b.provider})` : ""}`);
  return p;
}

export function toolCatalogue(x: Exec, b: WorkflowBlock, startupFailures?: Record<string, string>) {
  const attached = attachedMcpIds(stateOf(x, b.id).sessionConfig);
  return toolTargets(x, b.id).map(t => {
    const serverId = capabilityMcpServer(t) || "";
    const configuredName = x.env.mcpConfigs?.[serverId]?.name || x.env.mcpServers.find(m => m.id === serverId)?.name || "";
    const startupFailure = startupFailures?.[serverId] || startupFailures?.[configuredName] ||
      startupFailures?.[configuredName.replace(/\p{White_Space}/gu, "_")];
    const pending = (t.type === "mcp" || t.type === "browser") && (!attached.has(serverId) || !!startupFailure);
    return {
      block_id: t.id, name: t.label, type: t.type, ...(t.description ? { description: t.description } : {}),
      invocation: (t.type === "mcp" || t.type === "browser") && !pending ? "provider_mcp_tools" : t.type === "task_controls" ? "workspace_task_tools" : "workflow_use_block",
      status: pending ? "pending_restart" : stateOf(x, t.id).status,
      ...(t.type === "mcp" ? { server_id: serverId, server_name: x.env.mcpServers.find(m => m.id === serverId)?.name,
        ...(pending ? { reason: startupFailure || x.mcpUpdateErrors.get(b.id) || "This server has not been attached to the provider session. Hato applies MCP changes before the next turn." }
          : { usage: "Discover and call this server's tools through the provider MCP tools. workflow_use_block only describes the connection; it does not call the MCP server." }) } : {}),
      ...(t.type === "task_controls" ? { usage: "Use workspace tasks_list, tasks_create, tasks_start_agent and tasks_reconcile tools." } : {}),
      ...(t.type === "browser" ? { browser_session: t.browser?.sessionId, ...(pending ? { reason: startupFailure || x.mcpUpdateErrors.get(b.id) || "The Hato desktop tools are not attached yet. Hato applies MCP changes before the next turn." }
        : { usage: `Use the Hato desktop browser commands with session "${t.browser?.sessionId}"${t.browser?.name ? ` (${t.browser.name})` : ""}: browser_navigate, browser_text, browser_elements, browser_click, browser_type, browser_key, browser_scroll, browser_screenshot (quality low to look around), browser_network.` }) } : {}),
      ...(t.type === "run_app" ? { actions: t.app?.actions?.length ? t.app.actions : ["start", "status", "kill", "tail"] } : {}),
      ...(t.type === "terminal_control" ? { actions: ["list", "read", "write"] } : {}),
      ...(isTriggerBlock(t) ? { actions: TRIGGER_ACTIONS, ...(x.triggers.get(t.id) ? { endpoint: x.triggers.get(t.id)!.endpoint } : {}) } : {}),
      ...(t.type === "timer" ? { seconds: t.seconds } : {}),
    };
  });
}

export async function sessionToolCatalogue(x: Exec, b: WorkflowBlock) {
  const id = stateOf(x, b.id).sessionId;
  const view = id && toolTargets(x, b.id).some(t => capabilityMcpServer(t)) ? await agentCall("view", { id, limit: 1 }) : null;
  return toolCatalogue(x, b, view?.mcpStartupFailures);
}

function instructions(x: Exec, b: WorkflowBlock) {
  const tools = toolCatalogue(x, b);
  const paths = b.type === "chatbox" ? [] : x.def.edges.filter(e => e.from === b.id && edgeType(e) === "path").map(e => e.label);
  const caps = toolTargets(x, b.id).filter(isCapabilityBlock).map(t => t.type);
  return [
    `You are the "${b.label}" block of the Hato workflow "${x.run.workflowName}". Each workflow block keeps its own session and context.`,
    tools.length ? `Connected workflow blocks and capabilities: ${JSON.stringify(tools)}.` : "No workflow blocks are connected to you as tools.",
    "Call workflow_connections to discover your connected blocks and their invocation methods before deciding which tools to use. Check the connected capabilities before claiming you lack access. Blocks with invocation workflow_use_block accept block_id and input; provider_mcp_tools means use that MCP server's advertised tools directly.",
    caps.includes("mcp") ? "Use workflow_connections to check which MCP servers are attached, then inspect their advertised tools. If your provider loads tools lazily, use its tool discovery/search facility. Report any pending reason or discovery error for a server you need." : "",
    tools.length ? "For connected AI Agents and Chatboxes: omit action to run and wait, start launches in the background, status checks state, tail reads recent messages (lines 1–50) and steer sends input to a running session. A timed_out result means the block keeps working; check it with status or workflow_block_messages. Run App blocks take action start, status, kill or tail. Meetings automatically publish participant status changes (started activity, idle, permission wait, error or stop) as room messages. Use diff or wait to receive them without status polling. Publishing does not consume your unread cursor or invoke other agents. Meetings take publish (message), tail, diff, wait, status and shake (peer_block_id and an explicit message, required). Skill blocks return instructions to apply in your own session. Trigger blocks (HTTP, socket, file/pipe) are armed when the run starts and start their followers when an event arrives; take action status, configure (port, path, method, status_code, response_body, secret, protocol, framing, mode, create_if_missing, continuous, max_events; re-arms if armed), arm, disarm, wait (timeout_seconds) or fetch. Timers arm and return at once; pass seconds (delay) or at (ISO 8601 time) to choose when they fire, else the block's seconds apply. Re-arming replaces the pending timer; action status shows when it fires and cancel disarms it. When a timer fires, its follow connections receive the input you gave them, steering agents that are busy. User Prompt and Yes/No Prompt blocks wait for the user's answer. action \"fetch\" returns output you have not seen yet. Use workflow_block_output to page through long outputs. Keep requests and reports concise." : "",
    caps.includes("terminal_control") ? "Terminal Control: always call workflow_use_block with the connected Terminal Control block_id and action list, read or write. read/write take key; read accepts cursor; write takes text. These calls are logged on the block. Do not use direct workspace terminals_* tools. Reuse existing terminals; do not start agents in terminals." : "",
    caps.includes("browser") ? "Browser: drive the connected browser session only through the browser commands with its session id. Look before acting (browser_screenshot quality low, browser_text or browser_elements), click and type by element ref, and verify the result. The user watches the session live and may also interact with it." : "",
    caps.includes("task_controls") ? "Task controls: use the workspace tasks_list, tasks_create, tasks_start_agent and tasks_reconcile tools (they need the Hato desktop open)." : "",
    paths.length ? `Available paths: ${JSON.stringify(paths)}. Call workflow_choose_path with one of them before you finish; your final answer is passed to the chosen path.` : "",
    b.type === "chatbox" ? "You are a chat with the user. Use your connected tools when they help answer." : "Your final message is this block's output.",
  ].filter(Boolean).join("\n");
}

async function agentCall(method: string, args: any, timeoutMs = 60_000) { return ctx.modules.call<any>("agent-runner", method, args, { timeoutMs }); }

/** Session-level configuration of an agent block: provider, model and the MCP servers of its
 *  connected MCP and Task controls blocks. `signature` detects hot updates that need a reconnect. */
function sessionConfig(x: Exec, b: WorkflowBlock) {
  const profile = pickProfile(x, b);
  const targets = toolTargets(x, b.id);
  const mcpIds = [...new Set(targets.map(t => capabilityMcpServer(t)).filter(Boolean))].sort();
  // Workspace tools are issued by the agent runtime itself (as for Task controls).
  const workspaceTools = mcpIds.includes("internal-remote-mcp");
  const extra = mcpIds.filter(id => id !== "internal-remote-mcp").map(id => x.env.mcpServers.find(m => m.id === id)).filter(Boolean).map((m: any) => {
    const prepared = x.env.mcpConfigs?.[m.id];
    if (prepared) return { id: m.id, ...prepared };
    if (isInternalMcp(m.id)) throw new Error(`“${m.name}” is issued when the workflow is saved or a run starts. Save the workflow (or start a new run) to connect it.`);
    if (transportOf(m) !== "stdio" && m.auth?.type === "oauth") throw new Error(`MCP server “${m.name}” needs fresh authorization. Start a new workflow run to reconnect it.`);
    return { id: m.id, ...acpServer(m) };
  });
  const workspaceMcp = (workspaceTools || targets.some(t => t.type === "task_controls")) && !!x.env.daemon;
  const name = `${x.run.workflowName} · ${b.label}`.slice(0, 120), model = b.model || "", agentFile = b.agentFile || null;
  const trackAutonomous = profile.provider === "claude" ? trackAutonomousClaudeTurns : undefined;
  const signature = JSON.stringify([profile.id, model, agentFile, extra.map(m => m.id).sort(), workspaceMcp,
    ...(trackAutonomous === undefined ? [] : [trackAutonomous])]);
  return { profile, name, model, agentFile, extra, workspaceMcp, trackAutonomous, signature };
}
function attachedMcpIds(signature?: string): Set<string> {
  const [, , , ids, workspaceMcp] = JSON.parse(signature ?? "[]");
  return new Set([...(ids ?? []), ...(workspaceMcp ? ["internal-remote-mcp"] : [])]);
}
const tokenOf = (endpoint: any) => endpoint.env.find((v: any) => v.name === "HATO_MCP_TOKEN")?.value;

async function createSession(x: Exec, b: WorkflowBlock, s: WorkflowBlockState) {
  if (b.reasoning && !(await agentCall("health", {}).catch(() => null))?.reasoning) throw new Error("Reasoning needs the updated agent runtime. Stop saved background agents before upgrading their runtime, then retry.");
  const c = sessionConfig(x, b);
  const endpoint = await issueEndpoint(ctx, { kind: "run", runId: x.run.id, blockId: b.id });
  const id = crypto.randomUUID();
  const spec = {
    id, name: c.name, workspaceId: x.env.workspaceId, workspaceName: x.env.workspaceName, root: x.env.root, machineId: x.env.machineId,
    profile: c.profile, model: c.model, reasoning: b.reasoning || "", agentFile: c.agentFile, skills: [], mcps: [endpoint, ...c.extra], claudeSubscription: x.env.claudeSubscription,
    workspaceMcp: c.workspaceMcp, daemon: x.env.daemon, trackAutonomousClaudeTurns: c.trackAutonomous,
    autopilot: !!b.autopilot, workflow: { runId: x.run.id, blockId: b.id },
  };
  try { await agentCall("create", { spec }, 240_000); }
  catch (e) { await revokeWhere(ctx, sc => sc.kind === "run" && sc.token === tokenOf(endpoint)); throw e; }
  s.sessionConfig = c.signature;
  return id;
}

/** Reconnect at the turn boundary. A failed addition may use the previous session, but a failed
 *  removal must never start another turn with the disconnected tools. */
async function reconfigure(x: Exec, b: WorkflowBlock, s: WorkflowBlockState) {
  if (!s.sessionConfig) {
    const { session } = await agentCall("view", { id: s.sessionId, limit: 1 });
    s.sessionConfig = JSON.stringify([session.profile?.id, session.model || "", session.agentFile || null,
      (session.mcps || []).map((m: any) => m.id).filter((id: string) => id !== "hato-workflow").sort(), !!session.workspaceMcp]);
  }
  const targets = toolTargets(x, b.id);
  const desired = new Set(targets.map(t => capabilityMcpServer(t)).filter(Boolean));
  if (targets.some(t => t.type === "task_controls") && x.env.daemon) desired.add("internal-remote-mcp");
  const removing = [...attachedMcpIds(s.sessionConfig)].some(id => !desired.has(id));
  let token: string | undefined;
  try {
    const c = sessionConfig(x, b);
    if (s.sessionConfig === c.signature) { x.mcpUpdateErrors.delete(b.id); return; }
    const endpoint = await issueEndpoint(ctx, { kind: "run", runId: x.run.id, blockId: b.id });
    token = tokenOf(endpoint);
    await agentCall("update", { id: s.sessionId, patch: { name: c.name, profile: c.profile, model: c.model, agentFile: c.agentFile, skills: [], mcps: [endpoint, ...c.extra], workspaceMcp: c.workspaceMcp, trackAutonomousClaudeTurns: c.trackAutonomous } }, 240_000);
    s.sessionConfig = c.signature;
  } catch (e) {
    if (token) await revokeWhere(ctx, sc => sc.kind === "run" && sc.token === token);
    const reason = errMsg(e);
    x.mcpUpdateErrors.set(b.id, reason);
    log(s, "error", `Hot update not applied: ${reason}`);
    if (removing) throw new Error(`Could not remove disconnected MCP tools: ${reason}`);
    return;
  }
  await revokeWhere(ctx, sc => sc.kind === "run" && sc.runId === x.run.id && sc.blockId === b.id && sc.token !== token);
  x.mcpUpdateErrors.delete(b.id);
  log(s, "lifecycle", "Session reconnected with the updated workflow configuration");
  touch(x);
}

const seqOf = (m: any) => Number(String(m?.key || "").replace("agent-msg-", "")) || 0;

/** One prompt in a block's session; resolves with the turn's final assistant message. */
async function turn(x: Exec, s: WorkflowBlockState, text: string, images?: ImageAttachment[]): Promise<string> {
  const id = s.sessionId!;
  const before = await agentCall("view", { id, limit: 1 });
  const mark = Math.max(0, ...before.messages.map(seqOf));
  if (["busy", "waiting", "starting"].includes(before.session.status)) throw new Error("This block's agent is busy; use steer or wait for it to finish");
  const sent = await agentCall("send", { id, text, images }, 240_000);
  for (;;) {
    await sleep(800);
    if (x.cancelled) { await agentCall("cancel", { id }).catch(() => {}); throw new Error("Workflow run was cancelled"); }
    const v = await agentCall("view", { id, limit: 80 });
    const status = v.session.status;
    if (status === "waiting" && s.status !== "awaiting_permission") { s.status = "awaiting_permission"; s.permissionId = v.permissions[0]?.id; touch(x); }
    else if (status !== "waiting" && s.status === "awaiting_permission") { s.status = "running"; s.permissionId = undefined; touch(x); }
    const after = v.messages.filter((m: any) => seqOf(m) > mark && (sent.turn === undefined || m.turn === sent.turn));
    const failure = after.find((m: any) => m.role === "error");
    if (failure) throw new Error(failure.text || "The agent turn failed");
    if (["interrupted", "stopped", "error"].includes(status)) throw new Error(v.session.error || `Agent ${status}`);
    if (after.some((m: any) => m.role === "system" && String(m.text).startsWith("Turn ended"))) {
      if (after.some((m: any) => m.role === "system" && /cancel/i.test(String(m.text)))) log(s, "lifecycle", "Turn was cancelled");
      const answer = [...after].reverse().find((m: any) => m.role === "assistant" && String(m.text || "").trim());
      return answer ? String(answer.text).trim() : "";
    }
  }
}

async function agent(x: Exec, b: WorkflowBlock, s: WorkflowBlockState, input: string, images?: ImageAttachment[]) {
  const fresh = !s.sessionId;
  if (fresh) { s.sessionId = await createSession(x, b, s); touch(x); }
  else await reconfigure(x, b, s);
  const limit = x.def.settings?.promptLimitChars ?? 200_000;
  const clipped = preview(input, 20_000);
  let text: string;
  const references = referenceUpdates(b.prompt, x.outputs, s.referenceContext && s.referenceContext.sessionId === s.sessionId ? s.referenceContext.values : {});
  // A prompt changed by a hot update since this session last received it is delivered once more.
  const promptChanged = !fresh && s.appliedPrompt !== undefined && s.appliedPrompt !== b.prompt;
  s.appliedPrompt = b.prompt;
  if (b.type === "chatbox") {
    text = fresh ? `${instructions(x, b)}\n\nSession guidance:\n${renderPrompt(b.prompt, "", x.outputs)}\n\nUser message:\n${clipped}`
      : promptChanged ? `Updated session guidance (the workflow was edited):\n${renderPrompt(b.prompt, "", x.outputs)}\n\nUser message:\n${clipped}`
      : clipped + references.text;
    s.chat = [...(s.chat || []), { id: crypto.randomUUID(), role: "user" as const, text: clipped, at: now() }].slice(-200);
  } else {
    const template = /\{\{\s*input\s*\}\}/.test(b.prompt) ? b.prompt : `${b.prompt}\n\nInput:\n{{input}}`;
    const body = fresh || promptChanged || /\{\{/.test(b.prompt) ? renderPrompt(template, clipped, x.outputs) : clipped;
    text = fresh ? `${instructions(x, b)}\n\n${body}` : body;
  }
  if (text.length > limit) text = preview(text, limit);
  s.prompt = preview(text, 20_000);
  log(s, "prompt", text);
  touch(x);
  const out = await turn(x, s, text, images);
  if (b.type === "chatbox") s.referenceContext = { sessionId: s.sessionId!, values: references.values };
  if (b.type === "chatbox") s.chat = [...(s.chat || []), { id: crypto.randomUUID(), role: "assistant" as const, text: out, at: now() }].slice(-200);
  const paths = b.type === "chatbox" ? [] : x.def.edges.filter(e => e.from === b.id && edgeType(e) === "path");
  if (paths.length && !s.selectedRoute) throw new Error(`${b.label} finished without choosing a path (workflow_choose_path)`);
  return out;
}

export async function steer(x: Exec, id: string, text: string) {
  const s = stateOf(x, id);
  const input = preview(text, 20_000);
  let configChanged = true;
  try { configChanged = sessionConfig(x, block(x, id)).signature !== s.sessionConfig; }
  catch { /* Let the next workflow turn report a configuration error. */ }
  if (s.sessionId && !configChanged) {
    const result = await agentCall("send", { id: s.sessionId, text: input, steer: true, currentTurnOnly: true }, 60_000);
    if (!result.promptRequired) return result;
  }
  if (!x.busy.has(id)) {
    track(x, invoke(x, id, input, [], true));
    return { accepted: true };
  }
  const queued = x.queuedPrompts.get(id) ?? [];
  queued.push(input);
  x.queuedPrompts.set(id, queued);
  return { queued: true };
}
export async function messages(x: Exec, id: string, count: number) {
  const s = stateOf(x, id);
  if (!s.sessionId) return { status: s.status, messages: [] };
  const v = await agentCall("view", { id: s.sessionId, limit: Math.min(Math.max(count, 1), 50) });
  return { status: s.status, agentStatus: v.session.status, messages: v.messages.filter((m: any) => m.role !== "system").map((m: any) => ({ role: m.role, title: m.title, text: preview(String(m.text || ""), 2000) })) };
}

// ---------------------------------------------------------------- meetings

const STATUS_DESCRIPTIONS: Record<string, string> = {
  running: "started activity", succeeded: "is idle", failed: "stopped with an error",
  cancelled: "was stopped", awaiting_permission: "is waiting for permission",
  awaiting_user_input: "is waiting for input", waiting_input: "is ready for text", waiting_timer: "is waiting for a timer", waiting_trigger: "is waiting for a trigger", queued: "is queued",
};
function notifyMeeting(x: Exec, roomId: string) {
  for (const wake of [...(x.meetingWaiters.get(roomId) || [])]) wake();
}
/** Append without consuming any reader's cursor. Publishing is not reading. No recursive touch. */
function appendMeetingMessage(x: Exec, roomId: string, participantId: string, text: string, status?: WorkflowBlockState["status"]) {
  const s = stateOf(x, roomId), m = meeting(s), author = block(x, participantId).label;
  m.messages.push({ seq: ++m.seq, blockId: participantId, author, text, at: now(), ...(status ? { kind: "status" as const, participantStatus: status } : {}) });
  if (m.messages.length > 1000) m.messages.splice(0, m.messages.length - 1000);
  const output = m.messages.map(msg => `[${msg.seq}] ${msg.author}: ${msg.text}`).join("\n\n").slice(-outputLimit(x));
  s.output = output; x.outputs.set(roomId, output);
  if (status) log(s, "lifecycle", text);
  notifyMeeting(x, roomId);
  return m.seq;
}
function publishMeetingStatusChanges(x: Exec) {
  for (const participant of x.def.blocks.filter(isAgentBlock)) {
    const s = stateOf(x, participant.id), before = x.participantStatuses.get(participant.id);
    x.participantStatuses.set(participant.id, s.status);
    if (before === s.status || (before === undefined && s.status !== "running")) continue;
    const description = STATUS_DESCRIPTIONS[s.status]; if (!description) continue;
    // toolTargets includes all outgoing Chatbox edges and deduplicates repeated room links.
    for (const room of toolTargets(x, participant.id).filter(b => b.type === "meeting")) {
      appendMeetingMessage(x, room.id, participant.id, `[Status] ${participant.label.slice(0, 200)} ${description}.`, s.status);
    }
  }
}

function meeting(s: WorkflowBlockState) { return s.meeting ??= { seq: 0, messages: [], cursors: {} }; }
function meetingTail(s: WorkflowBlockState, lines: number) {
  const m = meeting(s);
  return { messages: m.messages.slice(-Math.min(Math.max(lines, 1), 50)), latestSequence: m.seq };
}
export async function useMeeting(x: Exec, meetingId: string, caller: string, a: any) {
  const s = stateOf(x, meetingId), m = meeting(s), action = a.action || "diff";
  const lines = Math.min(Math.max(Number(a.lines) || 20, 1), 50);
  const diff = (status?: string) => {
    const from = typeof a.after === "number" ? a.after : m.cursors[caller] ?? 0;
    const unread = m.messages.filter(msg => msg.seq > from), page = unread.slice(0, lines);
    const cursor = page.length ? page[page.length - 1].seq : from;
    if (typeof a.after !== "number") m.cursors[caller] = Math.max(m.cursors[caller] ?? 0, cursor);
    touch(x);
    return { meeting: { ...(status ? { status } : {}), messages: page, cursor, latestSequence: m.seq, hasMore: unread.length > page.length } };
  };
  if (action === "publish") {
    const text = String(a.message ?? a.input ?? "").slice(0, 10_000);
    if (!text.trim()) throw new Error("A meeting message is required");
    const published = appendMeetingMessage(x, meetingId, caller, text);
    touch(x);
    return { meeting: { published } };
  }
  if (action === "tail" || action === "fetch") return { meeting: meetingTail(s, lines) };
  if (action === "diff") return diff();
  if (action === "status") {
    const peers = x.def.edges.filter(e => e.to === meetingId && edgeType(e) === "use").map(e => block(x, e.from));
    return { meeting: { peers: peers.map(p => ({ block_id: p.id, name: p.label, type: p.type, online: x.busy.has(p.id), block_status: stateOf(x, p.id).status, hasSession: !!stateOf(x, p.id).sessionId, self: p.id === caller })) } };
  }
  if (action === "wait") {
    const from = typeof a.after === "number" ? a.after : m.cursors[caller] ?? 0;
    if (m.messages.some(msg => msg.seq > from)) return diff("updated");
    const timeout = Math.min(Math.max(Number(a.timeout_seconds) || 300, 1), 86_400) * 1000;
    const updated = await new Promise<boolean>(resolve => {
      const listeners = x.meetingWaiters.get(meetingId) || new Set<() => void>();
      x.meetingWaiters.set(meetingId, listeners);
      const done = (v: boolean) => {
        listeners.delete(wake);
        if (!listeners.size) x.meetingWaiters.delete(meetingId);
        clearTimeout(t); resolve(v);
      };
      const wake = () => done(true);
      const t = setTimeout(() => done(false), timeout);
      listeners.add(wake);
    });
    assertActive(x);
    return diff(updated ? "updated" : "timed_out");
  }
  if (action === "shake") {
    const peer = String(a.peer_block_id || "");
    if (!x.def.edges.some(e => e.from === peer && e.to === meetingId && edgeType(e) === "use") || peer === caller) throw new Error("Shake a different agent connected to this meeting");
    const message = a.message ?? a.input;
    if (typeof message !== "string" || !message.trim() || message.length > 10_000) throw new Error("Meeting shake needs a specific message of 1 to 10000 characters");
    if (x.busy.has(peer)) { await steer(x, peer, message); return { meeting: { shake: { blockId: peer, delivery: "steered" } } }; }
    track(x, invoke(x, peer, message, [], true).catch(() => {}));
    return { meeting: { shake: { blockId: peer, delivery: "started" } } };
  }
  throw new Error(`Unknown meeting action '${action}'`);
}

// ---------------------------------------------------------------- run lifecycle

export async function drive(x: Exec, entries?: string[]) {
  x.driving = true;
  const maxMs = x.def.settings?.maxRunDurationMs ?? 24 * 3600_000;
  x.deadline = setTimeout(() => { x.flowFailed ??= "The workflow reached its maximum run duration"; void cancel(x, "The workflow reached its maximum run duration"); }, maxMs);
  (x.deadline as any).unref?.();
  try {
    const roots = entries ?? defaultRoots(x);
    for (const id of roots) {
      try { await invoke(x, id, x.run.input); }
      catch (e) { if (x.cancelled) break; x.flowFailed ??= errMsg(e); break; }
    }
    // Timers and background tool work keep the run open.
    while (!x.cancelled && (x.timers.size || x.triggers.size || x.inputs.size || x.background.size)) {
      if (x.background.size) await Promise.race([Promise.allSettled([...x.background]), sleep(500)]);
      else await sleep(250);
    }
  } finally { x.driving = false; settle(x); }
}

export function defaultRoots(x: Exec) {
  if (x.run.startBlockId) return isEventSource(block(x, x.run.startBlockId)) ? [] : [x.run.startBlockId];
  const starts = x.def.blocks.filter(isStartBlock);
  if (starts.length) return starts.map(b => b.id);
  return x.def.blocks.filter(b => !x.def.edges.some(e => e.to === b.id) && !isCapabilityBlock(b) && !(b.type === "chatbox" && !x.run.input.trim()) && !["meeting", "skill"].includes(b.type) && !isEventSource(b)).map(b => b.id);
}

/** Adopt a saved revision of the run's workflow (hot update). The graph, prompts, settings and
 *  connections apply from the next step; running agent sessions keep their provider, model and
 *  session-level MCP servers. Timers of removed blocks are disarmed; active removed blocks finish. */
export function adoptDefinition(x: Exec, def: WorkflowDefinition) {
  const ids = new Set(def.blocks.map(b => b.id));
  let disarmed = false;
  for (const [id, t] of [...x.timers]) if (!ids.has(id)) { clearTimeout(t); x.timers.delete(id); disarmed = true; }
  for (const id of [...x.joins.keys()]) if (!ids.has(id)) x.joins.delete(id);
  // Triggers of removed blocks are released; a changed trigger configuration re-arms its listener.
  const rearm: WorkflowBlock[] = [];
  for (const id of [...x.triggers.keys()]) {
    const next = def.blocks.find(b => b.id === id), prev = x.def.blocks.find(b => b.id === id);
    if (!next || !isTriggerBlock(next)) { void disarmTrigger(x, id); disarmed = true; }
    else if (JSON.stringify(next.trigger || {}) !== JSON.stringify(prev?.trigger || {}) || next.type !== prev?.type) rearm.push(next);
  }
  // Waiting items of removed blocks or connections (or connections no longer queues) are dropped.
  const queueEdges = new Set(def.edges.filter(e => edgeType(e) === "queue").map(e => e.id));
  for (const [id, q] of [...x.queues]) {
    const kept = ids.has(id) ? q.filter(i => queueEdges.has(i.edgeId)) : [];
    if (kept.length) x.queues.set(id, kept); else x.queues.delete(id);
    setDepth(x, id);
  }
  for (const id of [...x.inputs]) if (!def.blocks.some(b => b.id === id && b.type === "text_input")) { x.inputs.delete(id); disarmed = true; }
  x.def = def; x.run.definition = def; x.run.workflowName = def.name;
  x.run.blocks = x.run.blocks.filter(s => ids.has(s.blockId) || x.busy.has(s.blockId) || x.answers.has(s.blockId));
  for (const b of def.blocks) stateOf(x, b.id);
  // Text Inputs added or changed while the run is active are available at once.
  if (!x.cancelled && (x.run.status === "running" || x.run.status === "waiting")) openTextInputs(x);
  for (const b of rearm) track(x, armTrigger(x, b).catch(e => {
    const s = stateOf(x, b.id), message = `Cannot re-arm trigger '${b.label}': ${errMsg(e)}`;
    Object.assign(s, { status: "failed", error: message, completedAt: now(), triggerEndpoint: undefined });
    log(s, "error", message); touch(x);
  }));
  if (disarmed) settle(x); else touch(x);
}

/** Close the run once nothing is active. A Chatbox remains available for later user turns. */
export function settle(x: Exec) {
  for (const id of [...x.queues.keys()]) drainQueue(x, id);
  if (x.driving || x.busy.size || x.timers.size || x.triggers.size || x.inputs.size || x.background.size || x.answers.size) { touch(x); return; }
  if (x.deadline) clearTimeout(x.deadline);
  if (x.run.status === "running" || x.run.status === "waiting") {
    x.run.status = x.cancelled ? "cancelled" : x.flowFailed ? "failed" : "succeeded";
    x.run.error = x.cancelled ? x.run.error : x.flowFailed;
    x.run.completedAt = now();
  }
  for (const s of x.run.blocks) if (s.status === "queued") s.status = "skipped";
  persist(x.run);
}

export async function cancel(x: Exec, reason = "Cancelled by the user") {
  x.cancelled = true;
  for (const t of x.timers.values()) clearTimeout(t);
  x.timers.clear();
  for (const id of [...x.triggers.keys()]) await disarmTrigger(x, id);
  x.queues.clear();
  x.inputs.clear();
  for (const s of x.run.blocks) delete s.queueDepth;
  for (const set of [...x.triggerWaiters.values()]) for (const wake of [...set]) wake("");
  for (const p of x.answers.values()) p.reject(new Error("Workflow run was cancelled"));
  x.answers.clear();
  for (const listeners of [...x.meetingWaiters.values()]) for (const wake of [...listeners]) wake();
  for (const h of x.procs) await ctx.host.process.terminate(h, "SIGKILL").catch(() => {});
  for (const s of x.run.blocks) {
    if (s.sessionId && (s.status === "running" || s.status === "awaiting_permission")) await agentCall("cancel", { id: s.sessionId }).catch(() => {});
    if (["running", "waiting_timer", "waiting_trigger", "waiting_input", "awaiting_user_input", "awaiting_permission", "queued"].includes(s.status)) { s.status = "cancelled"; s.completedAt = now(); }
  }
  x.run.status = "cancelled"; x.run.error = reason; x.run.completedAt = now();
  touch(x);
}

/** A Chatbox user turn, also on a finished run (its sessions and frozen graph are reused). */
export function chat(x: Exec, blockId: string, text: string) {
  const b = block(x, blockId);
  if (b.type !== "chatbox") throw new Error("Only Chatbox blocks accept chat messages");
  return promptBlock(x, blockId, text);
}

export function promptBlock(x: Exec, blockId: string, text: string, images?: ImageAttachment[]) {
  if (x.cancelled) throw new Error("This run was cancelled; start a new run to chat");
  if (x.busy.has(blockId)) {
    if (images?.length) throw new Error("Wait for the agent to finish its turn before sending pictures");
    return steer(x, blockId, text);
  }
  if (x.run.status !== "running" && x.run.status !== "waiting") { x.run.status = "running"; x.run.completedAt = undefined; }
  track(x, invoke(x, blockId, text, [], true, images));
  touch(x);
  return Promise.resolve({ accepted: true });
}

export { isAgentBlock };
