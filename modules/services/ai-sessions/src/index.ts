// ai-sessions: conversations per workspace, transcript projection of ACP updates, persistence of
// cached history, and the requested approval policy. Policy here only decides *agent* permission
// requests; module patch/build/activate approvals are enforced by the kernel regardless.
import { exportMcpTools } from "@hato/sdk/mcp";
import { chatHandoff } from "@hato/sdk/chat-handoff";
import { acpServer, transportOf } from "@hato/sdk/mcp-servers";
import { lastProgressMarker, PROGRESS_MARKER_INSTRUCTION, type AgentMcp, type AgentProgress } from "@hato/sdk/persistent-agents";
import { reasoningMarkdown } from "@hato/sdk/reasoning";
import { imageAttachments, transcriptContent } from "@hato/sdk/images";
import { messageWindow } from "@hato/sdk/chat-window";
import type { AppModule, ChatMessage, ModuleContext, ImageAttachment, WorkingConversation } from "@hato/sdk/types";
import { debounce, errMsg } from "@hato/sdk/runtime";

type Policy = "ask" | "auto-low" | "autopilot";
interface Msg { sequence?: number; id: string; kind: string; payload: any }
interface Conv {
  row: any;
  messages: Msg[];
  loaded: boolean;
  hasOlder: boolean;
  oldestSequence: number | null;
  historyLoading: boolean;
  historyError: string | null;
  current: { assistant: string | null; thought: string | null; assistantMessageId: string | null; thoughtMessageId: string | null; assistantSessionId: string | null; thoughtSessionId: string | null };
  tools: Map<string, string>;
  providerMessages: Map<string, string>;
  closedMessages: Set<string>;
  replay: any[];
  replayKeys: Map<string, number>;
  dirty: Set<string>;
  live: any;
  busy: boolean;
  steering: { text: string; images: ImageAttachment[] }[];
  submitting: boolean;
}

const projections = new Map<string, Promise<void>>();
function projectInOrder(id: string, task: () => Promise<void>) {
  const next = (projections.get(id) || Promise.resolve()).catch(() => {}).then(task);
  projections.set(id, next);
  void next.finally(() => { if (projections.get(id) === next) projections.delete(id); }).catch(() => {});
  return next;
}

const convs = new Map<string, Conv>();
const loading = new Map<string, Promise<Conv>>();
const deleting = new Set<string>();
const historyLoads = new Map<string, Promise<any>>();
const connections = new Map<string, Promise<any>>();
const providerOperations = new Set<string>();
const HISTORY_PAGE = 80;
const WORKING_LIMIT = 50;
const LOW_RISK_KINDS = new Set(["read", "search", "think", "fetch"]);
let notify: () => void = () => {};
let busySignature = "";
let workingSignature = "";
let historyMcp: ReturnType<typeof exportMcpTools>;
/** Publish the count and display projection of the same active turns. */
function publishActivity(ctx: ModuleContext) {
  const busy: Record<string, number> = {};
  const working: WorkingConversation[] = [];
  for (const c of convs.values()) {
    if (!(c.busy || c.submitting || c.steering.length)) continue;
    const { id, title, workspaceId } = c.row;
    busy[workspaceId] = (busy[workspaceId] || 0) + 1;
    const status = c.live?.status === "starting" || c.row.status === "connecting" ? "starting" : "busy";
    working.push({ id, title, workspaceId, status });
  }
  const sig = JSON.stringify(Object.entries(busy).sort());
  if (sig !== busySignature) {
    busySignature = sig;
    ctx.state.set("ai-sessions.busy", busy);
  }
  const entries = working.sort((a, b) => a.id.localeCompare(b.id)).slice(0, WORKING_LIMIT);
  const workingSig = JSON.stringify(entries);
  if (workingSig !== workingSignature) {
    workingSignature = workingSig;
    ctx.state.set("ai-sessions.working", entries);
  }
}
let flushSoon: () => void = () => {};

async function load(ctx: ModuleContext, id: string): Promise<Conv> {
  if (deleting.has(id)) throw new Error("This chat is being deleted");
  const known = convs.get(id);
  if (known?.loaded) return known;
  const pending = loading.get(id);
  if (pending) return pending;
  const task = loadConversation(ctx, id);
  loading.set(id, task);
  try { return await task; } finally { loading.delete(id); }
}

async function loadConversation(ctx: ModuleContext, id: string): Promise<Conv> {
  let c = convs.get(id);
  if (c && c.loaded) return c;
  const row = await ctx.modules.call("persistence", "conversations.get", { id });
  if (!row) throw new Error(`unknown conversation ${id}`);
  const msgs = await ctx.modules.call("persistence", "messages.list", { conversationId: id, limit: HISTORY_PAGE + 1 });
  const page = msgs.slice(-HISTORY_PAGE);
  c = { row, messages: page.map((m: any) => ({ id: m.id, sequence: m.sequence, kind: m.kind, payload: m.payload })), loaded: true, hasOlder: msgs.length > HISTORY_PAGE, oldestSequence: page[0]?.sequence ?? null, historyLoading: false, historyError: null,
    current: { assistant: null, thought: null, assistantMessageId: null, thoughtMessageId: null, assistantSessionId: null, thoughtSessionId: null }, tools: new Map(), providerMessages: new Map(), closedMessages: new Set(), replay: [], replayKeys: new Map(), dirty: new Set(), live: null, busy: false, steering: [], submitting: false };
  for (const m of c.messages) {
    if (m.kind === "tool" && m.payload.toolCallId) c.tools.set(providerMessageKey(m.payload.toolCallId, m.payload.providerSessionId), m.id);
    if (typeof m.payload.providerMessageId === "string" && m.payload.providerMessageId) {
      const key = providerMessageKey(m.payload.providerMessageId, m.payload.providerSessionId, m.kind);
      c.providerMessages.set(key, m.id);
      c.closedMessages.add(key);
    }
  }
  try { c.live = await ctx.modules.call("acp", "state", { conversationId: id }); } catch { c.live = null; }
  if (c.live) c.busy = c.live.status === "busy";
  convs.set(id, c);
  return c;
}

function add(c: Conv, kind: string, payload: any): Msg {
  const m = { id: crypto.randomUUID(), kind, payload };
  c.messages.push(m);
  c.dirty.add(m.id);
  return m;
}
const byId = (c: Conv, id: string | null) => (id ? c.messages.find((m) => m.id === id) : undefined);

let flushing: Promise<void> = Promise.resolve();
function flush(ctx: ModuleContext): Promise<void> {
  const next = flushing.catch(() => {}).then(() => flushMessages(ctx));
  flushing = next;
  return next;
}
async function flushMessages(ctx: ModuleContext) {
  for (const c of convs.values()) {
    if (!c.dirty.size) continue;
    const ids = Array.from(c.dirty);
    for (const id of ids) {
      c.dirty.delete(id);
      const m = byId(c, id);
      if (m) await ctx.modules.call("persistence", "messages.upsert", { id: m.id, conversationId: c.row.id, kind: m.kind, payload: m.payload }).catch((e) => { c.dirty.add(id); ctx.log.warn("persist message", errMsg(e)); throw e; });
    }
  }
}

function textOf(content: any): string {
  if (!content) return "";
  if (Array.isArray(content)) return content.map(textOf).filter(Boolean).join("\n");
  if (content.type === "text") return content.text || "";
  if (content.type === "content") return textOf(content.content);
  if (content.type === "diff") return `diff ${content.path}${content.newText ? ` (+${String(content.newText).split("\n").length} lines)` : ""}`;
  if (content.type === "terminal") return `terminal ${content.terminalId}`;
  if (content.type === "resource_link") return content.uri || "";
  return "";
}

/** conversationId → progress from reply markers, published at `ai-sessions.progress`. */
const progress = new Map<string, AgentProgress>();
/** Conversations told about reply markers in the current provider connection. */
const markerPrompted = new Set<string>();
let progressChanged: () => void = () => {};

const messageIdOf = (u: any): string | null => typeof u?.messageId === "string" && u.messageId ? u.messageId : null;
const providerMessageKey = (messageId: string, sessionId: unknown, kind = "") => `${typeof sessionId === "string" ? sessionId : ""}\u0000${kind}\u0000${messageId}`;
const sameImages = (a: ImageAttachment[] = [], b: ImageAttachment[] = []) => a.length === b.length && a.every((image, i) => image.data === b[i]?.data && image.mimeType === b[i]?.mimeType);

function closeCurrent(c: Conv, retire = true) {
  if(retire)for(const key of c.providerMessages.keys())c.closedMessages.add(key);
  if (retire && c.current.assistantMessageId) c.closedMessages.add(providerMessageKey(c.current.assistantMessageId, c.current.assistantSessionId, "assistant"));
  if (retire && c.current.thoughtMessageId) c.closedMessages.add(providerMessageKey(c.current.thoughtMessageId, c.current.thoughtSessionId, "thought"));
  c.current = { assistant: null, thought: null, assistantMessageId: null, thoughtMessageId: null, assistantSessionId: null, thoughtSessionId: null };
}

function tagProviderMessage(c: Conv, m: Msg, u: any) {
  const messageId = messageIdOf(u);
  if (messageId) {
    m.payload.providerMessageId = messageId;
    c.providerMessages.set(providerMessageKey(messageId, u.providerSessionId, m.kind), m.id);
  }
  if (typeof u?.providerSessionId === "string" && u.providerSessionId) m.payload.providerSessionId = u.providerSessionId;
  c.dirty.add(m.id);
}

function replayImages(content: any): ImageAttachment[] {
  const blocks = Array.isArray(content) ? content : [content];
  const images: ImageAttachment[] = [];
  for (const block of blocks) if (block?.type === "image") {
    try { images.push(...imageAttachments([{ name: "Picture", mimeType: block.mimeType, data: block.data }])); }
    catch { /* Unsupported image blocks must never become display text. */ }
  }
  return images;
}

function stageReplay(c: Conv, u: any, providerSessionId: string) {
  const scoped = { ...u, providerSessionId };
  if (["agent_message_chunk", "agent_thought_chunk", "user_message_chunk"].includes(u.sessionUpdate)) {
    const kind = u.sessionUpdate === "agent_message_chunk" ? "assistant" : u.sessionUpdate === "agent_thought_chunk" ? "thought" : "user";
    const messageId = messageIdOf(u);
    const lastIndex = c.replay.length - 1, last = c.replay[lastIndex];
    let index = messageId ? c.replayKeys.get(`${providerSessionId}:${kind}:${messageId}`) : last?.kind === kind && !messageIdOf(last.update) ? lastIndex : undefined;
    if (index === undefined) {
      index = c.replay.length;
      const key = messageId ? `${providerSessionId}:${kind}:${messageId}` : `anonymous:${index}`;
      c.replayKeys.set(key, index);
      c.replay.push({ kind, update: scoped, text: "", images: [] });
    }
    const entry = c.replay[index];
    entry.text += textOf(u.content);
    if (kind === "user") entry.images.push(...replayImages(u.content));
    return;
  }
  if (u.sessionUpdate === "tool_call" || u.sessionUpdate === "tool_call_update") {
    const key = `${providerSessionId}:tool:${u.toolCallId || c.replay.length}`;
    const index = c.replayKeys.get(key);
    if (index === undefined) {
      c.replayKeys.set(key, c.replay.length);
      c.replay.push({ kind: "tool", update: { ...scoped, sessionUpdate: "tool_call" } });
    } else Object.assign(c.replay[index].update, scoped, { sessionUpdate: "tool_call" });
    return;
  }
  if (u.sessionUpdate === "plan") {
    c.replay.push({ kind: "plan", update: { ...scoped, replayed: true } });
  }
}

async function commitReplay(ctx: ModuleContext, c: Conv) {
  if (!c.replay.length) return;
  const replay = c.replay; c.replay = []; c.replayKeys = new Map();
  try {
  await historyLoads.get(c.row.id)?.catch(() => {});
  await flush(ctx);
  const temp: Conv = { ...c, messages: [], dirty: new Set(), tools: new Map(), providerMessages: new Map(), closedMessages: new Set(), current: { assistant: null, thought: null, assistantMessageId: null, thoughtMessageId: null, assistantSessionId: null, thoughtSessionId: null } };
  for (const entry of replay) {
    closeCurrent(temp, false);
    const update = ["user", "assistant", "thought"].includes(entry.kind) ? { ...entry.update, content: [...(entry.text ? [{ type: "text", text: entry.text }] : []), ...entry.images] } : entry.update;
    project(temp, { ...update, replayed: true });
  }
  const result = await ctx.modules.call("persistence", "messages.reconcileReplay", { conversationId: c.row.id, messages: temp.messages, limit: Math.max(HISTORY_PAGE, c.messages.length) });
  c.messages = result.messages; c.hasOlder = result.hasOlder; c.oldestSequence = c.messages[0]?.sequence ?? null;
  c.tools.clear(); c.providerMessages.clear();
  for (const m of c.messages) {
    if (m.kind === "tool" && m.payload.toolCallId) c.tools.set(providerMessageKey(m.payload.toolCallId, m.payload.providerSessionId), m.id);
    if (m.payload.providerMessageId) { const key = providerMessageKey(m.payload.providerMessageId, m.payload.providerSessionId, m.kind); c.providerMessages.set(key, m.id); c.closedMessages.add(key); }
  }
  closeCurrent(c);
  } catch(error) { c.replay=[...replay,...c.replay]; throw error; }
}

function project(c: Conv, u: any) {
  switch (u.sessionUpdate) {
    case "agent_message_chunk": {
      const messageId = messageIdOf(u), providerKey = messageId ? providerMessageKey(messageId, u.providerSessionId, "assistant") : null;
      if (providerKey && c.closedMessages.has(providerKey)) break;
      if (messageId && c.current.assistantMessageId && providerMessageKey(c.current.assistantMessageId, c.current.assistantSessionId, "assistant") !== providerKey) {
        c.closedMessages.add(providerMessageKey(c.current.assistantMessageId, c.current.assistantSessionId, "assistant")); c.current.assistant = null;
      }
      let m = providerKey ? byId(c, c.providerMessages.get(providerKey) || null) : byId(c, c.current.assistant);
      if (!m) { m = add(c, "assistant", { text: "" }); c.current.assistant = m.id; }
      c.current.assistantMessageId = messageId; c.current.assistantSessionId = typeof u.providerSessionId === "string" ? u.providerSessionId : null;
      tagProviderMessage(c, m, u);
      m.payload.text += textOf(u.content);
      // Chats without Hato's tools report progress as a reply marker (sidebar only; transcripts strip it).
      const reported = lastProgressMarker(m.payload.text.slice(-4000));
      const known = progress.get(c.row.id);
      if (!u.replayed && reported && (known?.percent !== reported.percent || known?.note !== reported.note)) { progress.set(c.row.id, reported); progressChanged(); }
      c.dirty.add(m.id);
      c.current.thought = null; c.current.thoughtMessageId = null; c.current.thoughtSessionId = null;
      break;
    }
    case "agent_thought_chunk": {
      const messageId = messageIdOf(u), providerKey = messageId ? providerMessageKey(messageId, u.providerSessionId, "thought") : null;
      if (providerKey && c.closedMessages.has(providerKey)) break;
      if (messageId && c.current.thoughtMessageId && providerMessageKey(c.current.thoughtMessageId, c.current.thoughtSessionId, "thought") !== providerKey) {
        c.closedMessages.add(providerMessageKey(c.current.thoughtMessageId, c.current.thoughtSessionId, "thought")); c.current.thought = null;
      }
      let m = providerKey ? byId(c, c.providerMessages.get(providerKey) || null) : byId(c, c.current.thought);
      if (!m) { m = add(c, "thought", { text: "" }); c.current.thought = m.id; }
      c.current.thoughtMessageId = messageId; c.current.thoughtSessionId = typeof u.providerSessionId === "string" ? u.providerSessionId : null;
      tagProviderMessage(c, m, u);
      m.payload.text += textOf(u.content);
      c.dirty.add(m.id);
      break;
    }
    case "user_message_chunk": {
      const text = textOf(u.content), images = replayImages(u.content), messageId = messageIdOf(u);
      const key = messageId ? providerMessageKey(messageId, u.providerSessionId, "user") : null;
      if (key && c.closedMessages.has(key)) break;
      const known = key ? byId(c, c.providerMessages.get(key) || null) : undefined;
      if (known) { known.payload.text += text; known.payload.images = [...(known.payload.images || []), ...images]; c.dirty.add(known.id); break; }
      const last = c.messages[c.messages.length - 1];
      if (last?.kind === "user" && (last.payload.text === text || last.payload.outgoingText === text) && sameImages(last.payload.images || [], images)) { tagProviderMessage(c, last, u); if (key) c.closedMessages.add(key); break; }
      closeCurrent(c);
      tagProviderMessage(c, add(c, "user", { text, images, replayed: true }), u);
      break;
    }
    case "tool_call": {
      if (u.toolCallId && c.tools.has(providerMessageKey(u.toolCallId, u.providerSessionId))) { project(c, { ...u, sessionUpdate: "tool_call_update" }); break; }
      closeCurrent(c, false);
      const m = add(c, "tool", { toolCallId: u.toolCallId, title: u.title || u.kind || "tool", kind: u.kind, status: u.status || "pending", text: textOf(u.content) });
      tagProviderMessage(c, m, u);
      if (u.toolCallId) c.tools.set(providerMessageKey(u.toolCallId, u.providerSessionId), m.id);
      break;
    }
    case "tool_call_update": {
      const m = byId(c, c.tools.get(providerMessageKey(u.toolCallId, u.providerSessionId)) || null);
      if (!m) { project(c, { ...u, sessionUpdate: "tool_call" }); break; }
      tagProviderMessage(c, m, u);
      if (u.status) m.payload.status = u.status;
      if (u.title) m.payload.title = u.title;
      const t = textOf(u.content);
      if (t) m.payload.text = t.slice(0, 4000);
      c.dirty.add(m.id);
      break;
    }
    case "plan": {
      closeCurrent(c, false);
      const text = (u.entries || []).map((e: any) => `${e.status === "completed" ? "✓" : e.status === "in_progress" ? "→" : "·"} ${e.content}`).join("\n");
      const last = c.messages[c.messages.length - 1];
      if (last && last.kind === "plan" && !u.replayed) { last.payload.text = text; c.dirty.add(last.id); } else tagProviderMessage(c, add(c, "plan", { text }), u);
      break;
    }
    case "_hato_notice": add(c, "system", { text: u.text }); break;
    default: break; // config/mode/commands/usage updates are reflected through acp state
  }
}

function toChat(m: Msg): ChatMessage {
  const p = m.payload || {};
  const display = transcriptContent(String(p.text || ""), p.images || []);
  switch (m.kind) {
    case "user": return { key: m.id, role: "user", text: display.text, images: display.images };
    case "assistant": return { key: m.id, role: "assistant", text: display.text, images: display.images };
    case "thought": return { key: m.id, role: "thought", text: reasoningMarkdown(display.text) };
    case "tool": return { key: m.id, role: "tool", title: p.title, status: p.status, text: display.text.slice(0, 1500) };
    case "plan": return { key: m.id, role: "plan", text: display.text };
    case "error": return { key: m.id, role: "error", text: display.text };
    default: return { key: m.id, role: "system", text: display.text };
  }
}

async function update(ctx: ModuleContext, id: string, fields: any) {
  await ctx.modules.call("persistence", "conversations.update", { id, fields });
  const c = convs.get(id);
  if (c) c.row = { ...c.row, ...fields };
}

async function configuredMcps(ctx: ModuleContext): Promise<AgentMcp[]> {
  return (await ctx.modules.call("persistence", "settings.get", { key: "persistent-agents.mcps" }) || []).filter((m: AgentMcp) => m.enabled !== false);
}

async function connect(ctx: ModuleContext, id: string) {
  if(connections.has(id))return connections.get(id);
  if(providerOperations.has(id))throw new Error("A provider operation is running");
  const task=connectConversation(ctx,id);connections.set(id,task);
  try{return await task;}finally{connections.delete(id);}
}
async function connectConversation(ctx: ModuleContext, id: string) {
  markerPrompted.delete(id); // a new provider connection hasn't seen the marker instruction
  const c = await load(ctx, id);
  await update(ctx, id, { status: "connecting" });
  notify();
  try {
    const selected = new Set<string>(c.row.mcpSelection || []);
    const servers = (await configuredMcps(ctx)).filter(m => selected.has(m.id));
    const mcpServers: any[] = [];
    for (const server of servers) {
      let authorization: string | undefined;
      if (transportOf(server) !== "stdio" && server.auth?.type === "oauth") {
        try { authorization = await ctx.modules.call("mcp-auth", "authorization", { serverId: server.id, url: server.url }, { timeoutMs: 60000 }); }
        catch (e) { throw new Error(`MCP server “${server.name}” needs sign-in: open Manage MCP servers and choose Sign in (${errMsg(e)})`); }
      }
      mcpServers.push(acpServer(server, authorization));
    }
    const st = await ctx.modules.call("acp", "start", {
      conversationId: id, workspaceId: c.row.workspaceId, profileId: c.row.acpProfileId,
      mcp: selected.has("internal"), mcpServers, mcpSelection: [...selected].filter(id => id === "internal" || servers.some(m => m.id === id)), resumeSessionId: c.row.providerSessionId,
      systemPrompt: selected.has("internal") ? "" : PROGRESS_MARKER_INSTRUCTION,
    }, { timeoutMs: 600000 });
    c.live = st;
    const lostSession = c.row.providerSessionId && st.sessionId !== c.row.providerSessionId;
    await update(ctx, id, { status: "online", providerSessionId: st.sessionId, ...(lostSession ? { config: { ...c.row.config, __hatoHandoff: true } } : {}) });
    // Re-apply remembered selections (model/mode/reasoning) when the agent advertises them.
    const saved = c.row.config || {};
    for (const [configId, value] of Object.entries(saved)) {
      const known = (st.configOptions || []).some((o: any) => o.id === configId && (o.options || []).some((x: any) => x.value === value || (x.options || []).some((y: any) => y.value === value)));
      if (known && (st.configOptions || []).find((o: any) => o.id === configId)?.currentValue !== value) {
        try { c.live = await ctx.modules.call("acp", "setConfig", { conversationId: id, configId, value }); } catch (e) { ctx.log.warn("re-apply config", configId, errMsg(e)); }
      }
    }
    return st;
  } catch (e) {
    await update(ctx, id, { status: "error" });
    add(c, "error", { text: errMsg(e) });
    flushSoon();
    throw e;
  } finally { notify(); }
}

async function reconnectAfterAuth(ctx: ModuleContext, id: string) {
  const c = convs.get(id);
  if (!c || c.busy || c.submitting || c.steering.length || c.row.status === "connecting") throw new Error("Finish the active turn before reconnecting after authentication");
  await ctx.modules.call("acp", "stop", { conversationId: id });
  c.live = null; c.busy = false;
  return connect(ctx, id);
}

async function providerSessionMutation(ctx: ModuleContext, a: any, method: string) {
  const id=a.conversationId;
  if(providerOperations.has(id)||connections.has(id))throw new Error("A provider operation is running");
  providerOperations.add(id);
  try{return await mutateProviderSession(ctx,a,method);}finally{providerOperations.delete(id);}
}
async function mutateProviderSession(ctx: ModuleContext, a: any, method: string) {
  const c = await load(ctx, a.conversationId);
  if (c.busy || c.submitting || c.steering.length || c.row.status === "connecting" || c.live?.status === "starting" || c.live?.authProcess) {
    throw new Error("Finish the active turn, session load, or authentication before changing provider sessions");
  }
  closeCurrent(c); c.replay = []; c.replayKeys = new Map();
  const result = await ctx.modules.call("acp", method, { ...a, conversationId: c.row.id }, { timeoutMs: 150000 });
  c.live = result || await ctx.modules.call("acp", "state", { conversationId: c.row.id });
  const sessionId = c.live?.sessionClosed ? null : c.live?.sessionId || null;
  await update(ctx, c.row.id, { providerSessionId: sessionId, status: c.live?.sessionClosed ? "offline" : "online", ...(c.live?.sessionClosed || method === "newSession" ? { config: { ...c.row.config, __hatoHandoff: true } } : {}) });
  notify();
  return c.live;
}

async function loadOlderPage(ctx: ModuleContext, c: Conv) {
      if (c.historyLoading || !c.hasOlder || !c.oldestSequence) return { loaded: 0, hasOlder: c.hasOlder };
      c.historyLoading = true; c.historyError = null; notify();
      try {
        const rows = await ctx.modules.call("persistence", "messages.list", { conversationId: c.row.id, beforeSequence: c.oldestSequence, limit: HISTORY_PAGE + 1 });
        const page = rows.slice(-HISTORY_PAGE);
        const known = new Set(c.messages.map((m) => m.id));
        const older: Msg[] = page.filter((m: any) => !known.has(m.id)).map((m: any) => ({ id: m.id, sequence: m.sequence, kind: m.kind, payload: m.payload }));
        c.messages = [...older, ...c.messages];
        c.oldestSequence = page[0]?.sequence ?? c.oldestSequence;
        c.hasOlder = rows.length > HISTORY_PAGE;
        for (const m of older) {
          if (m.kind === "tool" && m.payload.toolCallId && !c.tools.has(providerMessageKey(m.payload.toolCallId,m.payload.providerSessionId))) c.tools.set(providerMessageKey(m.payload.toolCallId, m.payload.providerSessionId), m.id);
          if (typeof m.payload.providerMessageId === "string" && m.payload.providerMessageId) {
            const key = providerMessageKey(m.payload.providerMessageId, m.payload.providerSessionId, m.kind);
            c.providerMessages.set(key, m.id);
            c.closedMessages.add(key);
          }
        }
        return { loaded: older.length, hasOlder: c.hasOlder };
      } catch (e) { c.historyError = errMsg(e); throw e; }
      finally { c.historyLoading = false; notify(); }
}

const mod: AppModule = {
  id: "ai-sessions",
  moduleApiVersion: 1,
  async activate(ctx) {
    progressChanged = debounce(() => ctx.state.set("ai-sessions.progress", Object.fromEntries(progress) as any), 150);
    historyMcp = exportMcpTools(ctx, "Chat history", [{
      name: "history", description: "Read original user and assistant messages from this conversation only. Bounded to 20 messages and 16k characters; use beforeSequence to page earlier. Tool logs, thoughts and image data are excluded.",
      inputSchema: { type: "object", properties: { beforeSequence: { type: "integer", minimum: 1 } }, additionalProperties: false }, annotations: { readOnlyHint: true },
      handler: async (a, scope) => {
        const c = await load(ctx, scope.conversationId);
        if (c.row.workspaceId !== scope.workspaceId) throw new Error("Conversation belongs to another workspace");
        if (a.beforeSequence !== undefined && (!Number.isSafeInteger(a.beforeSequence) || a.beforeSequence < 1)) throw new Error("Invalid history cursor");
        const rows = await ctx.modules.call("persistence", "messages.list", { conversationId: c.row.id, beforeSequence: a.beforeSequence, limit: 21 });
        let budget = 16000;
        const messages: any[] = [];
        for (const m of rows.slice(-20).reverse()) {
          if (budget <= 0) break;
          if (m.kind !== "user" && m.kind !== "assistant") continue;
          const original = String(m.payload?.text || "");
          const text = original.slice(0, Math.min(4000, budget)); budget -= text.length;
          messages.unshift({ sequence: m.sequence, role: m.kind, text, truncated: text.length < original.length });
        }
        return { messages, beforeSequence: messages[0]?.sequence ?? rows.slice(-20)[0]?.sequence ?? null, hasOlder: rows.length > 20 || budget <= 0 };
      },
    }]);
    notify = debounce(() => { publishActivity(ctx); ctx.events.emit("ai-sessions.changed", {}); }, 60);
    ctx.events.on("persistent-agents.mcpsChanged", () => notify());
    publishActivity(ctx);
    flushSoon = debounce(() => { void flush(ctx).catch(e => ctx.log.warn("persist messages",errMsg(e))); }, 1200);
    ctx.events.on("acp.update", (p: any) => projectInOrder(p.conversationId, async () => {
      const c = convs.get(p.conversationId);
      if (!c) return;
      const update = { ...p.update, providerSessionId: p.sessionId || c.row.providerSessionId || "" };
      if (p.replayed) stageReplay(c, update, update.providerSessionId);
      else { await commitReplay(ctx, c); project(c, update); }
      flushSoon();
      notify();
    }));
    ctx.events.on("acp.replayEnded", (p: any) => projectInOrder(p.conversationId, async () => {
      const c = convs.get(p.conversationId);
      if (!c) return;
      if (p.success === false) { c.replay = []; c.replayKeys = new Map(); }
      else await commitReplay(ctx, c);
      flushSoon();
      notify();
    }));
    ctx.events.on("acp.turnEnded", async (p: any) => {
      const c = convs.get(p.conversationId);
      if (!c) return;
      await projections.get(p.conversationId);
      c.busy = c.steering.length > 0;
      c.submitting = c.busy;
      closeCurrent(c);
      if (p.error) add(c, "error", { text: `Turn failed: ${p.error}` });
      else if (p.stopReason && p.stopReason !== "end_turn") add(c, "system", { text: `Turn ended: ${p.stopReason}` });
      await flush(ctx);
      if (c.steering.length) {
        const pending = c.steering.splice(0);
        const text = pending.map((p) => p.text).filter(Boolean).join("\n\n");
        const images = pending.flatMap((p) => p.images);
        c.busy = true;
        c.submitting = true;
        try { await ctx.modules.call("acp", "prompt", { conversationId: c.row.id, text, images }); }
        catch (e) { c.busy = false; add(c, "error", { text: `Steering failed: ${errMsg(e)}` }); flushSoon(); }
        finally { c.submitting = false; }
      }
      notify();
    });
    ctx.events.on("acp.status", (s: any) => {
      const c = convs.get(s.conversationId);
      if (!c) return;
      c.live = s;
      if (s.sessionId && s.sessionId !== c.row.providerSessionId) update(ctx, s.conversationId, { providerSessionId: s.sessionId }).catch(() => {});
      c.busy = s.status === "busy" || c.steering.length > 0 || c.submitting;
      if (s.status === "exited" || s.status === "error") update(ctx, s.conversationId, { status: s.status === "exited" ? "offline" : "error" }).catch(() => {});
      notify();
    });
    ctx.events.on("acp.authCompleted", async (p: any) => {
      if (p.cancelled || p.code !== 0 || p.signal != null) return;
      const c = convs.get(p.conversationId);
      if (!c || c.busy || c.submitting || c.steering.length || c.row.status === "connecting") return;
      add(c, "system", { text: "Authentication completed; reconnecting the agent…" });
      flushSoon(); notify();
      try { await reconnectAfterAuth(ctx, c.row.id); }
      catch (e) { await update(ctx, c.row.id, { status: "error" }); add(c, "error", { text: `Authentication succeeded but reconnect failed: ${errMsg(e)}` }); flushSoon(); notify(); }
    });
  },
  canSwap() {
    return (connections.size || providerOperations.size || projections.size || historyMcp?.pending() || Array.from(convs.values()).some((c) => c.busy || c.submitting || c.steering.length || c.historyLoading || c.replay.length))
      ? { ok: false, reason: "Wait for active chat turns and steering to finish" } : { ok: true };
  },
  async deactivate(ctx) { await flush(ctx); },
  methods: {
    async list(ctx, a) { return ctx.modules.call("persistence", "conversations.list", { workspaceId: a.workspaceId }); },

    async remove(ctx, a) {
      const row = await ctx.modules.call("persistence", "conversations.get", { id: a.conversationId });
      if (!row || row.workspaceId !== a.workspaceId) throw new Error("Chat does not belong to this workspace");
      const c = await load(ctx, row.id);
      if (deleting.has(row.id)) throw new Error("This chat is being deleted");
      if (c.busy || c.submitting || c.steering.length || c.historyLoading || c.row.status === "connecting" || c.live?.status === "starting") throw new Error("Finish or stop this chat before deleting it");
      deleting.add(row.id);
      try {
        await ctx.modules.call("acp", "stop", { conversationId: row.id });
        c.live = null;
        await update(ctx, row.id, { status: "offline" });
        await flush(ctx);
        await ctx.modules.call("persistence", "conversations.remove", { id: row.id, workspaceId: row.workspaceId });
        convs.delete(row.id);
        progress.delete(row.id);
        markerPrompted.delete(row.id);
        ctx.state.set("ai-sessions.progress", Object.fromEntries(progress));
        notify();
        return null;
      } finally { deleting.delete(row.id); }
    },

    async create(ctx, a) {
      const desc = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
      const profiles = await ctx.modules.call("acp", "profiles", { machineId: desc.machineId });
      const existing = await ctx.modules.call("persistence", "conversations.list", { workspaceId: desc.id });
      const preferences = await ctx.modules.call("workspace", "view.get", { workspaceId: desc.id });
      const previous = existing.find((c: any) => c.id === preferences.activeConversationId) || existing[0];
      const preferred = a.profileId || previous?.acpProfileId || preferences.ui?.lastAcpProfileId;
      const profileId = profiles.find((p: any) => p.id === preferred)?.id || profiles[0]?.id;
      if (!profileId) throw new Error(`no agent profile configured for ${desc.machineId}`);
      // Configuration belongs to the provider; never carry provider session identity or history.
      const source = previous && previous.acpProfileId === profileId ? previous : null;
      const config = { ...(source?.config || {}) };
      delete config.__hatoHandoff;
      const live = source && convs.get(source.id)?.live;
      for (const option of live?.configOptions || []) {
        if (option.currentValue != null) config[option.id] = option.currentValue;
      }
      const id = crypto.randomUUID();
      await ctx.modules.call("persistence", "conversations.insert", { conversation: { id, workspaceId: desc.id, acpProfileId: profileId, title: a.title || `Chat ${existing.length + 1}`, approvalPolicy: previous?.approvalPolicy || "ask", mcpSelection: [...(previous?.mcpSelection || ["internal"])], config } });
      await ctx.modules.call("workspace", "view.patch", { workspaceId: desc.id, patch: { activeConversationId: id, ui: { lastAcpProfileId: profileId } } });
      notify();
      return ctx.modules.call("persistence", "conversations.get", { id });
    },

    async select(ctx, a) {
      await ctx.modules.call("workspace", "view.patch", { workspaceId: a.workspaceId, patch: { activeConversationId: a.conversationId } });
      notify();
      return null;
    },

    /** Tools an MCP server offers to desktop chats: Hato's own from internal-mcp, remote servers over HTTP. */
    async mcpTools(ctx, a) {
      const id = String(a.serverId || "");
      if (id === "internal") return { tools: await ctx.modules.call("internal-mcp", "tools", {}) };
      const server = (await configuredMcps(ctx)).find(m => m.id === id);
      if (!server) throw new Error("Unknown MCP server");
      if (transportOf(server) === "stdio") throw new Error("Local (command) servers start on the agent's machine when it connects; their tools can't be listed from here yet.");
      return ctx.modules.call("mcp-auth", "listTools", { serverId: server.id, url: server.url, transport: server.transport, headers: server.headers, auth: server.auth }, { timeoutMs: 90000 });
    },
    /** Everything the AI panel needs for the given workspace, in one call. */
    async view(ctx, a) {
      await Promise.all([...projections.values()]);
      const desc = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
      const list = await ctx.modules.call("persistence", "conversations.list", { workspaceId: desc.id });
      const v = await ctx.modules.call("workspace", "view.get", { workspaceId: desc.id });
      const activeId = list.some((x: any) => x.id === v.activeConversationId) ? v.activeConversationId : list[0] ? list[0].id : null;
      const profiles = await ctx.modules.call("acp", "profiles", { machineId: desc.machineId });
      let active: any = null;
      if (activeId) {
        const c = await load(ctx, activeId);
        const windowed = Number.isSafeInteger(a.messageLimit) && a.messageLimit > 0;
        const window = messageWindow(c.messages, windowed ? Math.min(a.messageLimit, 200) : c.messages.length,
          !a.windowConversationId || a.windowConversationId === activeId ? a.beforeMessageId : undefined);
        active = { conversation: c.row, messages: window.messages.map(toChat), windowed,
          hasLoadedOlder: window.hasLoadedOlder, hasNewer: window.hasNewer, hasOlder: c.hasOlder || window.hasLoadedOlder, historyLoading: c.historyLoading, historyError: c.historyError, live: c.live, busy: c.busy, steering: c.steering.length };
      }
      const auth = await ctx.modules.call("acp", "authSettings", {});
      return { mcpServers: [{ id: "internal", name: "Hato", description: "Inspect, build and reload application modules" }, ...(await configuredMcps(ctx)).map(m => ({ id: m.id, name: m.name, description: transportOf(m) === "stdio" ? "Runs on the workspace machine" : "Remote MCP server" }))], auth, workspace: { id: desc.id, name: desc.name, machineId: desc.machineId, root: desc.rootAbsolutePath, location: desc.location }, conversations: list.map((x: any) => ({ id: x.id, title: x.title, status: convs.get(x.id)?.busy ? "busy" : x.status, acpProfileId: x.acpProfileId, updatedAt: x.updatedAt })), activeId, active, profiles };
    },

    async loadOlder(ctx, a) {
      const c = await load(ctx, a.conversationId);
      await projections.get(c.row.id);
      if(c.historyLoading)return {loaded:0,hasOlder:c.hasOlder};
      const task=loadOlderPage(ctx,c);historyLoads.set(c.row.id,task);
      try{return await task;}finally{if(historyLoads.get(c.row.id)===task)historyLoads.delete(c.row.id);}
    },

    connect: (ctx, a) => connect(ctx, a.conversationId),

    async disconnect(ctx, a) {
      await ctx.modules.call("acp", "stop", { conversationId: a.conversationId });
      await update(ctx, a.conversationId, { status: "offline" });
      const c = convs.get(a.conversationId);
      if (c) { c.live = null; c.busy = false; c.steering = []; }
      notify();
      return null;
    },

    async send(ctx, a) {
      if(providerOperations.has(a.conversationId))throw new Error("A provider operation is running");
      await projections.get(a.conversationId);
      const text = String(a.text || "").trim();
      const images = imageAttachments(a.images);
      if (!text && !images.length) throw new Error("empty prompt");
      const c = await load(ctx, a.conversationId);
      if (images.length && c.live && !c.live.agentCapabilities?.promptCapabilities?.image) throw new Error("This agent does not support image prompts.");
      if (c.submitting) throw new Error("The previous message is still being submitted. Try again in a moment.");
      if (c.busy && c.steering.length === 0) {
        // Preferred: inject into the running turn (ACP `_session/steering`), no interruption.
        let outcome = "unsupported";
        try { outcome = (await ctx.modules.call("acp", "steer", { conversationId: c.row.id, text, images })).outcome; }
        catch (e) { ctx.log.warn("steering failed; falling back to interrupt", errMsg(e)); }
        if (outcome === "steered") { add(c, "user", { text, images }); notify(); await flush(ctx); return { accepted: true, steering: true }; }
        if (outcome === "promptRequired" && c.busy) {
          // The turn is finishing; send this as the next prompt when it ends (no cancel needed).
          c.steering.push({ text, images }); add(c, "user", { text, images }); notify(); await flush(ctx);
          return { accepted: true, steering: true };
        }
      }
      if (c.busy) {
        const first = c.steering.length === 0;
        imageAttachments([...c.steering.flatMap((p) => p.images), ...images]);
        c.steering.push({ text, images });
        add(c, "user", { text, images });
        notify();
        if (first) {
          try { await ctx.modules.call("acp", "cancel", { conversationId: c.row.id }); }
          catch (e) {
            c.steering = [];
            add(c, "error", { text: `Could not interrupt the agent: ${errMsg(e)}. Send your follow-up again.` });
            flushSoon(); notify(); throw e;
          }
        }
        await flush(ctx);
        return { accepted: true, steering: true };
      }
      c.submitting = true;
      try {
        if (images.length) {
          if (!c.live || (!["ready", "busy"].includes(c.live.status) || c.live.sessionClosed || !c.live.sessionId)) await connect(ctx, c.row.id);
          if (!c.live?.agentCapabilities?.promptCapabilities?.image) throw new Error("This agent does not support image prompts.");
        }
        const previousMessages = c.messages.slice();
        const userRow = add(c, "user", { text, images });
        closeCurrent(c);
        if (c.row.title.startsWith("Chat ") && c.messages.filter((m) => m.kind === "user").length === 1) await update(ctx, c.row.id, { title: text.slice(0, 60) || images[0]?.name || "Picture" });
        await flush(ctx);
        notify();
        if (!c.live || (!["ready", "busy"].includes(c.live.status) || c.live.sessionClosed || !c.live.sessionId)) await connect(ctx, c.row.id);
        c.busy = true;
        notify();
        try {
          const transfer = c.row.config?.__hatoHandoff ? chatHandoff(previousMessages.map(m => ({ role: m.kind, text: String(m.payload?.text || "") }))) : "";
          // Without Hato's tools (no report_progress), ask once per provider connection for reply markers.
          const marker = !(c.row.mcpSelection || []).includes("internal") && !c.live?.agentCapabilities?.sessionCapabilities?.systemPrompt && !markerPrompted.has(c.row.id) ? PROGRESS_MARKER_INSTRUCTION : "";
          if (marker) markerPrompted.add(c.row.id);
          if (progress.delete(c.row.id)) progressChanged();
          const body = transfer ? `${transfer}\n\nCurrent user request:\n${text}` : text;
          const outgoingText = marker ? `${marker}\n\n${body}` : body;
          userRow.payload.outgoingText = outgoingText; c.dirty.add(userRow.id); await flush(ctx);
          await ctx.modules.call("acp", "prompt", { conversationId: c.row.id, text: outgoingText, images });
          if (c.row.config?.__hatoHandoff) {
            const config = { ...c.row.config }; delete config.__hatoHandoff;
            await update(ctx, c.row.id, { config });
          }
        }
        catch (e) { c.busy = false; add(c, "error", { text: errMsg(e) }); flushSoon(); notify(); throw e; }
        return { accepted: true };
      } finally { c.submitting = false; }
    },

    async cancel(ctx, a) { const c = await load(ctx, a.conversationId); c.steering = []; await ctx.modules.call("acp", "cancel", { conversationId: a.conversationId }); return null; },

    async setConfig(ctx, a) {
      const c = await load(ctx, a.conversationId);
      c.live = await ctx.modules.call("acp", "setConfig", { conversationId: a.conversationId, configId: a.configId, value: a.value });
      await update(ctx, a.conversationId, { config: { ...(c.row.config || {}), [a.configId]: a.value } });
      notify();
      return c.live;
    },

    async setPolicy(ctx, a) {
      const p: Policy = a.policy === "autopilot" ? "autopilot" : a.policy === "auto-low" ? "auto-low" : "ask";
      await load(ctx, a.conversationId);
      await update(ctx, a.conversationId, { approvalPolicy: p });
      add(convs.get(a.conversationId)!, "system", { text: p === "autopilot" ? "Autopilot enabled: agent tool permissions are approved automatically. Module patch/build/activate/rollback still require native approval." : p === "auto-low" ? "Auto-approving low-risk agent actions (read/search/think/fetch); others ask." : "All agent permission requests ask for approval." });
      flushSoon(); notify();
      return null;
    },

    async setMcp(ctx, a) {
      const c = await load(ctx, a.conversationId);
      const id = typeof a.serverId === "string" ? a.serverId : "internal";
      const enabled = typeof a.serverId === "string" ? !!a.enabled : !!a.internal;
      if (enabled && id !== "internal" && !(await configuredMcps(ctx)).some(m => m.id === id)) throw new Error("Unknown or disabled MCP server");
      const selection = new Set<string>(c.row.mcpSelection || []);
      if (enabled) selection.add(id); else selection.delete(id);
      await update(ctx, a.conversationId, { mcpSelection: [...selection] });
      notify();
      return { reconnectRequired: true };
    },

    async setProfile(ctx, a) {
      const c = await load(ctx, a.conversationId);
      if (c.row.acpProfileId === a.profileId) return null;
      if (c.busy || c.submitting || c.steering.length || c.row.status === "connecting" || c.live?.status === "starting" || c.live?.status === "busy") {
        throw new Error("Wait for the agent to finish or stop its turn before switching providers.");
      }
      const desc = await ctx.modules.call("workspace", "resolve", { workspaceId: c.row.workspaceId });
      const profiles = await ctx.modules.call("acp", "profiles", { machineId: desc.machineId });
      if (!profiles.some((p: any) => p.id === a.profileId)) throw new Error("provider is unavailable for this workspace");
      // Profile discovery yields; a turn may have started in the meantime.
      if (c.busy || c.submitting || c.steering.length || c.row.status === "connecting" || c.live?.status === "starting" || c.live?.status === "busy") {
        throw new Error("Wait for the agent to finish or stop its turn before switching providers.");
      }
      if (c.live && ["ready", "busy"].includes(c.live.status)) await ctx.modules.call("acp", "stop", { conversationId: a.conversationId });
      c.live = null;
      c.busy = false;
      await ctx.modules.call("workspace", "view.patch", { workspaceId: c.row.workspaceId, patch: { ui: { lastAcpProfileId: a.profileId } } });
      await update(ctx, a.conversationId, { acpProfileId: a.profileId, providerSessionId: null, status: "offline", config: { __hatoHandoff: true } });
      notify();
      return null;
    },

    providerSessions: (ctx, a) => ctx.modules.call("acp", "listSessions", { conversationId: a.conversationId, cursor: a.cursor }, { timeoutMs: 90000 }),
    newProviderSession: (ctx, a) => providerSessionMutation(ctx, a, "newSession"),
    resumeProviderSession: (ctx, a) => providerSessionMutation(ctx, a, "resumeSession"),
    loadProviderSession: (ctx, a) => providerSessionMutation(ctx, a, "loadSession"),
    forkProviderSession: (ctx, a) => providerSessionMutation(ctx, a, "forkSession"),
    closeProviderSession: (ctx, a) => providerSessionMutation(ctx, a, "closeSession"),
    deleteProviderSession: (ctx, a) => providerSessionMutation(ctx, a, "deleteSession"),

    async authenticate(ctx, a) {
      const c = await load(ctx, a.conversationId);
      const result = await ctx.modules.call("acp", "authenticate", { conversationId: c.row.id, methodId: a.methodId, confirmToken: a.confirmToken }, { timeoutMs: 150000 });
      c.live = await ctx.modules.call("acp", "state", { conversationId: c.row.id });
      notify();
      if (result?.outcome === "authenticated") await reconnectAfterAuth(ctx, c.row.id);
      return result;
    },
    async authInput(ctx, a) {
      await load(ctx, a.conversationId);
      return ctx.modules.call("acp", "authInput", { conversationId: a.conversationId, data: String(a.data || ""), attemptId: a.attemptId });
    },
    async cancelAuth(ctx, a) {
      await load(ctx, a.conversationId);
      const result = await ctx.modules.call("acp", "cancelAuth", { conversationId: a.conversationId, attemptId: a.attemptId });
      const c = convs.get(a.conversationId);
      if (c) c.live = await ctx.modules.call("acp", "state", { conversationId: a.conversationId });
      notify();
      return result;
    },
    async respondElicitation(ctx, a) {
      const c = await load(ctx, a.conversationId);
      return ctx.modules.call("acp", "respondElicitation", { conversationId: c.row.id, requestId: a.requestId, response: a.response });
    },

    adapters: (ctx, a) => ctx.modules.call("acp", "adapters", { workspaceId: a.workspaceId }, { timeoutMs: 300000 }),

    /** User-initiated install/update of a known adapter, confirmed in a native dialog first. */
    async installAdapter(ctx, a) {
      const desc = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
      const list: any[] = await ctx.modules.call("acp", "adapters", { workspaceId: desc.id }, { timeoutMs: 300000 });
      const ad = list.find((x) => x.id === a.adapterId);
      if (!ad) throw new Error(`unknown adapter ${a.adapterId}`);
      const verb = ad.installed ? "Update" : "Install";
      const r = await ctx.host.approvals.request({
        title: `${verb} ${ad.name} on ${desc.machineId}?`,
        operation: "acp-adapter-install",
        detail: [
          `Command (runs on ${desc.machineId}):`, `  ${ad.installCommand || `npm install -g ${ad.pkg}@latest`}`, "",
          ...(ad.prefix ? [`npm's global folder is not writable by this user, so the adapter is installed for this user only (${ad.prefix}/bin). No root access is used.`, ""] : []),
          `Installed: ${ad.installed || "not installed"}   Latest: ${ad.latest || "unknown"}`, "",
          "This downloads and installs code from the npm registry. The agent will afterwards still need to be authenticated on that machine.",
        ].join("\n"),
        options: [{ id: "allow", label: verb, kind: "allow" }, { id: "deny", label: "Cancel", kind: "deny" }],
      });
      if (r.optionId !== "allow") throw new Error(`${verb} cancelled`);
      return ctx.modules.call("acp", "installAdapter", { workspaceId: desc.id, adapterId: ad.id }, { timeoutMs: 16 * 60 * 1000 });
    },

    /** Called by `acp` for session/request_permission. */
    async permissionRequest(ctx, a) {
      const c = await load(ctx, a.conversationId);
      const req = a.request || {};
      const options: any[] = req.options || [];
      const tool = req.toolCall || {};
      const policy: Policy = c.row.approvalPolicy || "ask";
      const allowOnce = options.find((o) => o.kind === "allow_once") || options.find((o) => String(o.kind).startsWith("allow"));
      const reject = options.find((o) => o.kind === "reject_once") || options.find((o) => String(o.kind).startsWith("reject"));
      let chosen: string | null = null;
      let how = "";
      if (policy === "autopilot" && allowOnce) { chosen = allowOnce.optionId; how = "autopilot"; }
      else if (policy === "auto-low" && allowOnce && LOW_RISK_KINDS.has(tool.kind)) { chosen = allowOnce.optionId; how = "auto (low-risk)"; }
      else {
        const detail = [`Agent: ${c.live?.agentInfo?.title || c.live?.agentInfo?.name || c.row.acpProfileId} on ${c.live?.machineId || "?"}`, `Workspace: ${c.row.workspaceId}`, `Tool: ${tool.title || "(untitled)"} [${tool.kind || "other"}]`,
          tool.rawInput ? `Input: ${JSON.stringify(tool.rawInput).slice(0, 4000)}` : "", textOf(tool.content).slice(0, 4000)].filter(Boolean).join("\n");
        const r = await ctx.host.approvals.request({
          title: `Agent requests permission: ${tool.title || tool.kind || "tool call"}`, detail, operation: "agent-permission",
          options: options.map((o) => ({ id: o.optionId, label: o.name || o.optionId, kind: String(o.kind).startsWith("allow") ? "allow" : String(o.kind).startsWith("reject") ? "deny" : "neutral" })),
        });
        chosen = r.optionId; how = r.expired ? "expired" : "user";
      }
      const label = options.find((o) => o.optionId === chosen)?.name || (chosen ? chosen : "cancelled");
      ctx.log.info(`permission "${tool.title || tool.kind || "tool"}": ${label} (${how})`);
      flushSoon(); notify();
      if (!chosen) return { outcome: { outcome: "cancelled" } };
      if (reject && chosen === reject.optionId) return { outcome: { outcome: "selected", optionId: chosen } };
      return { outcome: { outcome: "selected", optionId: chosen } };
    },
  },
};
export default mod;
