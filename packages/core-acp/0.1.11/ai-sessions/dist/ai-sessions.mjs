// ../sdk/runtime.ts
function debounce(fn, ms) {
  let t = null;
  return () => {
    if (t !== null) return;
    t = setTimeout(() => {
      t = null;
      fn();
    }, ms);
  };
}
function errMsg(e) {
  return e && (e.message || String(e)) || "unknown error";
}

// ../sdk/mcp.ts
function exportMcpTools(ctx, title, tools) {
  let pending = 0;
  const publish = () => ctx.state.set(`${ctx.moduleId}.mcp`, {
    title,
    generation: ctx.generation,
    tools: tools.map(({ handler: _handler, ...definition }) => definition)
  });
  ctx.events.on("internal-mcp.call", async (request) => {
    if (request?.module !== ctx.moduleId || request.generation !== ctx.generation || typeof request.id !== "string") return;
    const tool = tools.find((tool2) => tool2.name === request.tool);
    pending++;
    try {
      if (!tool) throw new Error("Unknown module MCP command");
      const scope = request.scope;
      if (!scope || typeof scope.workspaceId !== "string" || typeof scope.conversationId !== "string" || typeof scope.machineId !== "string") throw new Error("Missing authenticated MCP scope");
      const result = await tool.handler(request.args || {}, scope);
      ctx.events.emit(`${ctx.moduleId}.mcp.result`, { id: request.id, generation: ctx.generation, result: result === void 0 ? null : result });
    } catch (e) {
      ctx.events.emit(`${ctx.moduleId}.mcp.result`, { id: request.id, generation: ctx.generation, error: errMsg(e) });
    } finally {
      pending--;
    }
  });
  publish();
  return { publish, pending: () => pending };
}

// ../sdk/images.ts
function imageAttachments(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 4) throw new Error("Attach up to 4 pictures.");
  let total = 0;
  return value.map((image) => {
    if (!image || !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(image.mimeType) || typeof image.data !== "string" || !image.data.length || image.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) throw new Error("Invalid image attachment. Use PNG, JPEG, WebP or GIF.");
    const size = image.data.length / 4 * 3 - (image.data.endsWith("==") ? 2 : image.data.endsWith("=") ? 1 : 0);
    total += size;
    if (size > 5 * 1024 * 1024 || total > 10 * 1024 * 1024) throw new Error("Pictures must be under 5 MB each and 10 MB combined.");
    return { name: String(image.name || "Picture").slice(0, 180), mimeType: image.mimeType, data: image.data };
  });
}
function transcriptContent(text, existing = []) {
  const images = [...existing];
  const original = text;
  const extract = (mimeType, data, name = "Picture") => {
    try {
      const [image] = imageAttachments([{ name, mimeType, data }]);
      if (!images.some((item) => item.mimeType === image.mimeType && item.data === image.data)) images.push(image);
      return "";
    } catch {
      return "[Picture data omitted]";
    }
  };
  const uri = "data:(image/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})";
  text = text.replace(new RegExp("!\\[([^\\]\\n]*)\\]\\(<?" + uri + ">?\\)", "gi"), (_match, name, mime, data) => extract(mime.toLowerCase().replace("image/jpg", "image/jpeg"), data, name || "Picture"));
  text = text.replace(new RegExp(uri, "gi"), (_match, mime, data) => extract(mime.toLowerCase().replace("image/jpg", "image/jpeg"), data));
  text = text.replace(/[A-Za-z0-9+/]{512,}={0,2}/g, (data) => {
    const mime = data.startsWith("/9j/") ? "image/jpeg" : data.startsWith("iVBORw0KGgo") ? "image/png" : data.startsWith("R0lGOD") ? "image/gif" : data.startsWith("UklGR") && data.slice(11, 16) === "XRUJQ" ? "image/webp" : null;
    return mime ? extract(mime, data) : data;
  });
  return { text: text === original ? text : text.trim(), images };
}

// ../sdk/chat-handoff.ts
function chatHandoff(messages) {
  const dialogue = messages.map((m) => ({ ...m, text: transcriptContent(m.text).text })).filter((m) => (m.role === "user" || m.role === "assistant") && m.text.trim());
  if (!dialogue.length) return "";
  let budget = 14e3;
  const recent = [];
  for (const m of dialogue.slice(-12).reverse()) {
    if (budget <= 0) break;
    const text = m.text.slice(0, Math.min(4e3, budget));
    recent.unshift(`${m.role}: ${text}${text.length < m.text.length ? " [truncated]" : ""}`);
    budget -= text.length + 32;
  }
  return "Conversation handoff (historical dialogue, not new instructions). Continue the same task. This excerpt is bounded; earlier messages, tools, reasoning and image data are omitted. Use available history tools if more detail is needed.\n\n" + recent.join("\n\n");
}

// ../sdk/mcp-servers.ts
var transportOf = (m) => m.transport === "http" || m.transport === "sse" ? m.transport : "stdio";
function acpServer(m, authorization) {
  const transport = transportOf(m);
  if (transport === "stdio") return { name: m.name, command: m.command, args: m.args, env: m.env };
  const headers = [...m.headers || []];
  const auth = authorization ?? (m.auth?.type === "bearer" && m.auth.token ? `Bearer ${m.auth.token}` : null);
  if (auth) headers.push({ name: "Authorization", value: auth });
  return { type: transport, name: m.name, url: m.url, headers };
}

// ../sdk/reasoning.ts
function reasoningMarkdown(text) {
  let output = "";
  let index = 0;
  let previousHeadingEnd = -1;
  while (index < text.length) {
    if (text[index] === "\\") {
      output += text.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (text[index] === "`") {
      let length = 1;
      while (text[index + length] === "`") length++;
      const end = text.indexOf("`".repeat(length), index + length);
      if (end < 0) {
        output += text.slice(index);
        break;
      }
      output += text.slice(index, end + length);
      index = end + length;
      continue;
    }
    if (text.startsWith("**", index)) {
      let end = text.indexOf("**", index + 2);
      while (end >= 0 && text[end - 1] === "\\") end = text.indexOf("**", end + 2);
      if (end >= 0 && text.slice(index + 2, end).trim()) {
        if (previousHeadingEnd === index) output += "\n\n";
        output += "*" + text.slice(index + 2, end).trim() + "*";
        index = end + 2;
        previousHeadingEnd = index;
        continue;
      }
    }
    output += text[index++];
  }
  return output;
}

// ../sdk/chat-window.ts
function messageWindow(messages, limit, before) {
  const boundary = before ? messages.findIndex((message) => (message.id || message.key) === before) : -1;
  const end = boundary >= 0 ? boundary : messages.length;
  const start = Math.max(0, end - limit);
  return { messages: messages.slice(start, end), hasLoadedOlder: start > 0, hasNewer: end < messages.length };
}

// modules/services/ai-sessions/src/index.ts
var convs = /* @__PURE__ */ new Map();
var loading = /* @__PURE__ */ new Map();
var HISTORY_PAGE = 80;
var LOW_RISK_KINDS = /* @__PURE__ */ new Set(["read", "search", "think", "fetch"]);
var notify = () => {
};
var busySignature = "";
var historyMcp;
function publishBusy(ctx) {
  const busy = {};
  for (const c of convs.values()) if (c.busy || c.submitting || c.steering.length) busy[c.row.workspaceId] = (busy[c.row.workspaceId] || 0) + 1;
  const sig = JSON.stringify(Object.entries(busy).sort());
  if (sig === busySignature) return;
  busySignature = sig;
  ctx.state.set("ai-sessions.busy", busy);
}
var flushSoon = () => {
};
async function load(ctx, id) {
  const known = convs.get(id);
  if (known?.loaded) return known;
  const pending = loading.get(id);
  if (pending) return pending;
  const task = loadConversation(ctx, id);
  loading.set(id, task);
  try {
    return await task;
  } finally {
    loading.delete(id);
  }
}
async function loadConversation(ctx, id) {
  let c = convs.get(id);
  if (c && c.loaded) return c;
  const row = await ctx.modules.call("persistence", "conversations.get", { id });
  if (!row) throw new Error(`unknown conversation ${id}`);
  const msgs = await ctx.modules.call("persistence", "messages.list", { conversationId: id, limit: HISTORY_PAGE + 1 });
  const page = msgs.slice(-HISTORY_PAGE);
  c = { row, messages: page.map((m) => ({ id: m.id, sequence: m.sequence, kind: m.kind, payload: m.payload })), loaded: true, hasOlder: msgs.length > HISTORY_PAGE, oldestSequence: page[0]?.sequence ?? null, historyLoading: false, historyError: null, current: { assistant: null, thought: null }, tools: /* @__PURE__ */ new Map(), dirty: /* @__PURE__ */ new Set(), live: null, busy: false, steering: [], submitting: false };
  for (const m of c.messages) if (m.kind === "tool" && m.payload.toolCallId) c.tools.set(m.payload.toolCallId, m.id);
  try {
    c.live = await ctx.modules.call("acp", "state", { conversationId: id });
  } catch {
    c.live = null;
  }
  if (c.live) c.busy = c.live.status === "busy";
  convs.set(id, c);
  return c;
}
function add(c, kind, payload) {
  const m = { id: crypto.randomUUID(), kind, payload };
  c.messages.push(m);
  c.dirty.add(m.id);
  return m;
}
var byId = (c, id) => id ? c.messages.find((m) => m.id === id) : void 0;
async function flush(ctx) {
  for (const c of convs.values()) {
    if (!c.dirty.size) continue;
    const ids = Array.from(c.dirty);
    c.dirty.clear();
    for (const id of ids) {
      const m = byId(c, id);
      if (m) await ctx.modules.call("persistence", "messages.upsert", { id: m.id, conversationId: c.row.id, kind: m.kind, payload: m.payload }).catch((e) => ctx.log.warn("persist message", errMsg(e)));
    }
  }
}
function textOf(content) {
  if (!content) return "";
  if (Array.isArray(content)) return content.map(textOf).filter(Boolean).join("\n");
  if (content.type === "text") return content.text || "";
  if (content.type === "content") return textOf(content.content);
  if (content.type === "diff") return `diff ${content.path}${content.newText ? ` (+${String(content.newText).split("\n").length} lines)` : ""}`;
  if (content.type === "terminal") return `terminal ${content.terminalId}`;
  if (content.type === "resource_link") return content.uri || "";
  return "";
}
function project(c, u) {
  switch (u.sessionUpdate) {
    case "agent_message_chunk": {
      let m = byId(c, c.current.assistant);
      if (!m) {
        m = add(c, "assistant", { text: "" });
        c.current.assistant = m.id;
      }
      m.payload.text += textOf(u.content);
      c.dirty.add(m.id);
      c.current.thought = null;
      break;
    }
    case "agent_thought_chunk": {
      let m = byId(c, c.current.thought);
      if (!m) {
        m = add(c, "thought", { text: "" });
        c.current.thought = m.id;
      }
      m.payload.text += textOf(u.content);
      c.dirty.add(m.id);
      break;
    }
    case "user_message_chunk": {
      const blocks = Array.isArray(u.content) ? u.content : [u.content];
      const images = [];
      for (const block of blocks) {
        if (block?.type === "image") {
          try {
            images.push(...imageAttachments([{ name: "Picture", mimeType: block.mimeType, data: block.data }]));
          } catch {
          }
        }
      }
      add(c, "user", { text: textOf(u.content), images, replayed: true });
      break;
    }
    case "tool_call": {
      if (u.toolCallId && c.tools.has(u.toolCallId)) {
        project(c, { ...u, sessionUpdate: "tool_call_update" });
        break;
      }
      const m = add(c, "tool", { toolCallId: u.toolCallId, title: u.title || u.kind || "tool", kind: u.kind, status: u.status || "pending", text: textOf(u.content) });
      c.tools.set(u.toolCallId, m.id);
      c.current.assistant = null;
      c.current.thought = null;
      break;
    }
    case "tool_call_update": {
      const m = byId(c, c.tools.get(u.toolCallId) || null);
      if (!m) {
        project(c, { ...u, sessionUpdate: "tool_call" });
        break;
      }
      if (u.status) m.payload.status = u.status;
      if (u.title) m.payload.title = u.title;
      const t = textOf(u.content);
      if (t) m.payload.text = t.slice(0, 4e3);
      c.dirty.add(m.id);
      break;
    }
    case "plan": {
      const text = (u.entries || []).map((e) => `${e.status === "completed" ? "✓" : e.status === "in_progress" ? "→" : "·"} ${e.content}`).join("\n");
      const last = c.messages[c.messages.length - 1];
      if (last && last.kind === "plan") {
        last.payload.text = text;
        c.dirty.add(last.id);
      } else add(c, "plan", { text });
      break;
    }
    case "_hato_notice":
      add(c, "system", { text: u.text });
      break;
    default:
      break;
  }
}
function toChat(m) {
  const p = m.payload || {};
  const display = transcriptContent(String(p.text || ""), p.images || []);
  switch (m.kind) {
    case "user":
      return { key: m.id, role: "user", text: display.text, images: display.images };
    case "assistant":
      return { key: m.id, role: "assistant", text: display.text, images: display.images };
    case "thought":
      return { key: m.id, role: "thought", text: reasoningMarkdown(display.text) };
    case "tool":
      return { key: m.id, role: "tool", title: p.title, status: p.status, text: display.text.slice(0, 1500) };
    case "plan":
      return { key: m.id, role: "plan", text: display.text };
    case "error":
      return { key: m.id, role: "error", text: display.text };
    default:
      return { key: m.id, role: "system", text: display.text };
  }
}
async function update(ctx, id, fields) {
  await ctx.modules.call("persistence", "conversations.update", { id, fields });
  const c = convs.get(id);
  if (c) c.row = { ...c.row, ...fields };
}
async function configuredMcps(ctx) {
  return (await ctx.modules.call("persistence", "settings.get", { key: "persistent-agents.mcps" }) || []).filter((m) => m.enabled !== false);
}
async function connect(ctx, id) {
  const c = await load(ctx, id);
  await update(ctx, id, { status: "connecting" });
  notify();
  try {
    const selected = new Set(c.row.mcpSelection || []);
    const servers = (await configuredMcps(ctx)).filter((m) => selected.has(m.id));
    const mcpServers = [];
    for (const server of servers) {
      let authorization;
      if (transportOf(server) !== "stdio" && server.auth?.type === "oauth") {
        try {
          authorization = await ctx.modules.call("mcp-auth", "authorization", { serverId: server.id, url: server.url }, { timeoutMs: 6e4 });
        } catch (e) {
          throw new Error(`MCP server “${server.name}” needs sign-in: open Manage MCP servers and choose Sign in (${errMsg(e)})`);
        }
      }
      mcpServers.push(acpServer(server, authorization));
    }
    const st = await ctx.modules.call("acp", "start", {
      conversationId: id,
      workspaceId: c.row.workspaceId,
      profileId: c.row.acpProfileId,
      mcp: selected.has("internal"),
      mcpServers,
      mcpSelection: [...selected].filter((id2) => id2 === "internal" || servers.some((m) => m.id === id2)),
      resumeSessionId: c.row.providerSessionId
    }, { timeoutMs: 6e5 });
    c.live = st;
    const lostSession = c.row.providerSessionId && st.sessionId !== c.row.providerSessionId;
    await update(ctx, id, { status: "online", providerSessionId: st.sessionId, ...lostSession ? { config: { ...c.row.config, __hatoHandoff: true } } : {} });
    const saved = c.row.config || {};
    for (const [configId, value] of Object.entries(saved)) {
      const known = (st.configOptions || []).some((o) => o.id === configId && (o.options || []).some((x) => x.value === value || (x.options || []).some((y) => y.value === value)));
      if (known && (st.configOptions || []).find((o) => o.id === configId)?.currentValue !== value) {
        try {
          c.live = await ctx.modules.call("acp", "setConfig", { conversationId: id, configId, value });
        } catch (e) {
          ctx.log.warn("re-apply config", configId, errMsg(e));
        }
      }
    }
    return st;
  } catch (e) {
    await update(ctx, id, { status: "error" });
    add(c, "error", { text: errMsg(e) });
    flushSoon();
    throw e;
  } finally {
    notify();
  }
}
var mod = {
  id: "ai-sessions",
  moduleApiVersion: 1,
  async activate(ctx) {
    historyMcp = exportMcpTools(ctx, "Chat history", [{
      name: "history",
      description: "Read original user and assistant messages from this conversation only. Bounded to 20 messages and 16k characters; use beforeSequence to page earlier. Tool logs, thoughts and image data are excluded.",
      inputSchema: { type: "object", properties: { beforeSequence: { type: "integer", minimum: 1 } }, additionalProperties: false },
      annotations: { readOnlyHint: true },
      handler: async (a, scope) => {
        const c = await load(ctx, scope.conversationId);
        if (c.row.workspaceId !== scope.workspaceId) throw new Error("Conversation belongs to another workspace");
        if (a.beforeSequence !== void 0 && (!Number.isSafeInteger(a.beforeSequence) || a.beforeSequence < 1)) throw new Error("Invalid history cursor");
        const rows = await ctx.modules.call("persistence", "messages.list", { conversationId: c.row.id, beforeSequence: a.beforeSequence, limit: 21 });
        let budget = 16e3;
        const messages = [];
        for (const m of rows.slice(-20).reverse()) {
          if (budget <= 0) break;
          if (m.kind !== "user" && m.kind !== "assistant") continue;
          const original = String(m.payload?.text || "");
          const text = original.slice(0, Math.min(4e3, budget));
          budget -= text.length;
          messages.unshift({ sequence: m.sequence, role: m.kind, text, truncated: text.length < original.length });
        }
        return { messages, beforeSequence: messages[0]?.sequence ?? rows.slice(-20)[0]?.sequence ?? null, hasOlder: rows.length > 20 || budget <= 0 };
      }
    }]);
    notify = debounce(() => {
      publishBusy(ctx);
      ctx.events.emit("ai-sessions.changed", {});
    }, 60);
    ctx.events.on("persistent-agents.mcpsChanged", () => notify());
    publishBusy(ctx);
    flushSoon = debounce(() => {
      flush(ctx);
    }, 1200);
    ctx.events.on("acp.update", (p) => {
      const c = convs.get(p.conversationId);
      if (!c) return;
      project(c, p.update);
      flushSoon();
      notify();
    });
    ctx.events.on("acp.turnEnded", async (p) => {
      const c = convs.get(p.conversationId);
      if (!c) return;
      c.busy = c.steering.length > 0;
      c.submitting = c.busy;
      c.current = { assistant: null, thought: null };
      if (p.error) add(c, "error", { text: `Turn failed: ${p.error}` });
      else if (p.stopReason && p.stopReason !== "end_turn") add(c, "system", { text: `Turn ended: ${p.stopReason}` });
      await flush(ctx);
      if (c.steering.length) {
        const pending = c.steering.splice(0);
        const text = pending.map((p2) => p2.text).filter(Boolean).join("\n\n");
        const images = pending.flatMap((p2) => p2.images);
        c.busy = true;
        c.submitting = true;
        try {
          await ctx.modules.call("acp", "prompt", { conversationId: c.row.id, text, images });
        } catch (e) {
          c.busy = false;
          add(c, "error", { text: `Steering failed: ${errMsg(e)}` });
          flushSoon();
        } finally {
          c.submitting = false;
        }
      }
      notify();
    });
    ctx.events.on("acp.status", (s) => {
      const c = convs.get(s.conversationId);
      if (!c) return;
      c.live = s;
      c.busy = s.status === "busy" || c.steering.length > 0 || c.submitting;
      if (s.status === "exited" || s.status === "error") update(ctx, s.conversationId, { status: s.status === "exited" ? "offline" : "error" }).catch(() => {
      });
      notify();
    });
  },
  canSwap() {
    return historyMcp?.pending() || Array.from(convs.values()).some((c) => c.busy || c.submitting || c.steering.length || c.historyLoading) ? { ok: false, reason: "Wait for active chat turns and steering to finish" } : { ok: true };
  },
  async deactivate(ctx) {
    await flush(ctx);
  },
  methods: {
    async list(ctx, a) {
      return ctx.modules.call("persistence", "conversations.list", { workspaceId: a.workspaceId });
    },
    async create(ctx, a) {
      const desc = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
      const profiles = await ctx.modules.call("acp", "profiles", { machineId: desc.machineId });
      const existing = await ctx.modules.call("persistence", "conversations.list", { workspaceId: desc.id });
      const preferences = await ctx.modules.call("workspace", "view.get", { workspaceId: desc.id });
      const previous = existing.find((c) => c.id === preferences.activeConversationId) || existing[0];
      const preferred = a.profileId || previous?.acpProfileId || preferences.ui?.lastAcpProfileId;
      const profileId = profiles.find((p) => p.id === preferred)?.id || profiles[0]?.id;
      if (!profileId) throw new Error(`no agent profile configured for ${desc.machineId}`);
      const source = previous && previous.acpProfileId === profileId ? previous : null;
      const config = { ...source?.config || {} };
      delete config.__hatoHandoff;
      const live = source && convs.get(source.id)?.live;
      for (const option of live?.configOptions || []) {
        if (option.currentValue != null) config[option.id] = option.currentValue;
      }
      const id = crypto.randomUUID();
      await ctx.modules.call("persistence", "conversations.insert", { conversation: { id, workspaceId: desc.id, acpProfileId: profileId, title: a.title || `Chat ${existing.length + 1}`, approvalPolicy: previous?.approvalPolicy || "ask", mcpSelection: [...previous?.mcpSelection || ["internal"]], config } });
      await ctx.modules.call("workspace", "view.patch", { workspaceId: desc.id, patch: { activeConversationId: id, ui: { lastAcpProfileId: profileId } } });
      notify();
      return ctx.modules.call("persistence", "conversations.get", { id });
    },
    async select(ctx, a) {
      await ctx.modules.call("workspace", "view.patch", { workspaceId: a.workspaceId, patch: { activeConversationId: a.conversationId } });
      notify();
      return null;
    },
    /** Everything the AI panel needs for the given workspace, in one call. */
    async view(ctx, a) {
      const desc = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
      const list = await ctx.modules.call("persistence", "conversations.list", { workspaceId: desc.id });
      const v = await ctx.modules.call("workspace", "view.get", { workspaceId: desc.id });
      const activeId = list.some((x) => x.id === v.activeConversationId) ? v.activeConversationId : list[0] ? list[0].id : null;
      const profiles = await ctx.modules.call("acp", "profiles", { machineId: desc.machineId });
      let active = null;
      if (activeId) {
        const c = await load(ctx, activeId);
        const windowed = Number.isSafeInteger(a.messageLimit) && a.messageLimit > 0;
        const window = messageWindow(
          c.messages,
          windowed ? Math.min(a.messageLimit, 200) : c.messages.length,
          !a.windowConversationId || a.windowConversationId === activeId ? a.beforeMessageId : void 0
        );
        active = {
          conversation: c.row,
          messages: window.messages.map(toChat),
          windowed,
          hasLoadedOlder: window.hasLoadedOlder,
          hasNewer: window.hasNewer,
          hasOlder: c.hasOlder || window.hasLoadedOlder,
          historyLoading: c.historyLoading,
          historyError: c.historyError,
          live: c.live,
          busy: c.busy,
          steering: c.steering.length
        };
      }
      const auth = await ctx.modules.call("acp", "authSettings", {});
      return { mcpServers: [{ id: "internal", name: "Hato", description: "Inspect, build and reload application modules" }, ...(await configuredMcps(ctx)).map((m) => ({ id: m.id, name: m.name, description: transportOf(m) === "stdio" ? "Runs on the workspace machine" : "Remote MCP server" }))], auth, workspace: { id: desc.id, name: desc.name, machineId: desc.machineId, root: desc.rootAbsolutePath, location: desc.location }, conversations: list.map((x) => ({ id: x.id, title: x.title, status: convs.get(x.id)?.busy ? "busy" : x.status, acpProfileId: x.acpProfileId, updatedAt: x.updatedAt })), activeId, active, profiles };
    },
    async loadOlder(ctx, a) {
      const c = await load(ctx, a.conversationId);
      if (c.historyLoading || !c.hasOlder || !c.oldestSequence) return { loaded: 0, hasOlder: c.hasOlder };
      c.historyLoading = true;
      c.historyError = null;
      notify();
      try {
        const rows = await ctx.modules.call("persistence", "messages.list", { conversationId: c.row.id, beforeSequence: c.oldestSequence, limit: HISTORY_PAGE + 1 });
        const page = rows.slice(-HISTORY_PAGE);
        const known = new Set(c.messages.map((m) => m.id));
        const older = page.filter((m) => !known.has(m.id)).map((m) => ({ id: m.id, sequence: m.sequence, kind: m.kind, payload: m.payload }));
        c.messages = [...older, ...c.messages];
        c.oldestSequence = page[0]?.sequence ?? c.oldestSequence;
        c.hasOlder = rows.length > HISTORY_PAGE;
        for (const m of older) if (m.kind === "tool" && m.payload.toolCallId && !c.tools.has(m.payload.toolCallId)) c.tools.set(m.payload.toolCallId, m.id);
        return { loaded: older.length, hasOlder: c.hasOlder };
      } catch (e) {
        c.historyError = errMsg(e);
        throw e;
      } finally {
        c.historyLoading = false;
        notify();
      }
    },
    connect: (ctx, a) => connect(ctx, a.conversationId),
    async disconnect(ctx, a) {
      await ctx.modules.call("acp", "stop", { conversationId: a.conversationId });
      await update(ctx, a.conversationId, { status: "offline" });
      const c = convs.get(a.conversationId);
      if (c) {
        c.live = null;
        c.busy = false;
        c.steering = [];
      }
      notify();
      return null;
    },
    async send(ctx, a) {
      const text = String(a.text || "").trim();
      const images = imageAttachments(a.images);
      if (!text && !images.length) throw new Error("empty prompt");
      const c = await load(ctx, a.conversationId);
      if (images.length && c.live && !c.live.agentCapabilities?.promptCapabilities?.image) throw new Error("This agent does not support image prompts.");
      if (c.submitting) throw new Error("The previous message is still being submitted. Try again in a moment.");
      if (c.busy && c.steering.length === 0) {
        let outcome = "unsupported";
        try {
          outcome = (await ctx.modules.call("acp", "steer", { conversationId: c.row.id, text, images })).outcome;
        } catch (e) {
          ctx.log.warn("steering failed; falling back to interrupt", errMsg(e));
        }
        if (outcome === "steered") {
          add(c, "user", { text, images });
          notify();
          await flush(ctx);
          return { accepted: true, steering: true };
        }
        if (outcome === "promptRequired" && c.busy) {
          c.steering.push({ text, images });
          add(c, "user", { text, images });
          notify();
          await flush(ctx);
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
          try {
            await ctx.modules.call("acp", "cancel", { conversationId: c.row.id });
          } catch (e) {
            c.steering = [];
            add(c, "error", { text: `Could not interrupt the agent: ${errMsg(e)}. Send your follow-up again.` });
            flushSoon();
            notify();
            throw e;
          }
        }
        await flush(ctx);
        return { accepted: true, steering: true };
      }
      c.submitting = true;
      try {
        if (images.length) {
          if (!c.live || !["ready", "busy"].includes(c.live.status)) await connect(ctx, c.row.id);
          if (!c.live?.agentCapabilities?.promptCapabilities?.image) throw new Error("This agent does not support image prompts.");
        }
        const previousMessages = c.messages.slice();
        add(c, "user", { text, images });
        c.current = { assistant: null, thought: null };
        if (c.row.title.startsWith("Chat ") && c.messages.filter((m) => m.kind === "user").length === 1) await update(ctx, c.row.id, { title: text.slice(0, 60) || images[0]?.name || "Picture" });
        await flush(ctx);
        notify();
        if (!c.live || !["ready", "busy"].includes(c.live.status)) await connect(ctx, c.row.id);
        c.busy = true;
        notify();
        try {
          const transfer = c.row.config?.__hatoHandoff ? chatHandoff(previousMessages.map((m) => ({ role: m.kind, text: String(m.payload?.text || "") }))) : "";
          await ctx.modules.call("acp", "prompt", { conversationId: c.row.id, text: transfer ? `${transfer}

Current user request:
${text}` : text, images });
          if (c.row.config?.__hatoHandoff) {
            const config = { ...c.row.config };
            delete config.__hatoHandoff;
            await update(ctx, c.row.id, { config });
          }
        } catch (e) {
          c.busy = false;
          add(c, "error", { text: errMsg(e) });
          flushSoon();
          notify();
          throw e;
        }
        return { accepted: true };
      } finally {
        c.submitting = false;
      }
    },
    async cancel(ctx, a) {
      const c = await load(ctx, a.conversationId);
      c.steering = [];
      await ctx.modules.call("acp", "cancel", { conversationId: a.conversationId });
      return null;
    },
    async setConfig(ctx, a) {
      const c = await load(ctx, a.conversationId);
      c.live = await ctx.modules.call("acp", "setConfig", { conversationId: a.conversationId, configId: a.configId, value: a.value });
      await update(ctx, a.conversationId, { config: { ...c.row.config || {}, [a.configId]: a.value } });
      notify();
      return c.live;
    },
    async setPolicy(ctx, a) {
      const p = a.policy === "autopilot" ? "autopilot" : a.policy === "auto-low" ? "auto-low" : "ask";
      await load(ctx, a.conversationId);
      await update(ctx, a.conversationId, { approvalPolicy: p });
      add(convs.get(a.conversationId), "system", { text: p === "autopilot" ? "Autopilot enabled: agent tool permissions are approved automatically. Module patch/build/activate/rollback still require native approval." : p === "auto-low" ? "Auto-approving low-risk agent actions (read/search/think/fetch); others ask." : "All agent permission requests ask for approval." });
      flushSoon();
      notify();
      return null;
    },
    async setMcp(ctx, a) {
      const c = await load(ctx, a.conversationId);
      const id = typeof a.serverId === "string" ? a.serverId : "internal";
      const enabled = typeof a.serverId === "string" ? !!a.enabled : !!a.internal;
      if (enabled && id !== "internal" && !(await configuredMcps(ctx)).some((m) => m.id === id)) throw new Error("Unknown or disabled MCP server");
      const selection = new Set(c.row.mcpSelection || []);
      if (enabled) selection.add(id);
      else selection.delete(id);
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
      if (!profiles.some((p) => p.id === a.profileId)) throw new Error("provider is unavailable for this workspace");
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
    adapters: (ctx, a) => ctx.modules.call("acp", "adapters", { workspaceId: a.workspaceId }, { timeoutMs: 3e5 }),
    /** User-initiated install/update of a known adapter, confirmed in a native dialog first. */
    async installAdapter(ctx, a) {
      const desc = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
      const list = await ctx.modules.call("acp", "adapters", { workspaceId: desc.id }, { timeoutMs: 3e5 });
      const ad = list.find((x) => x.id === a.adapterId);
      if (!ad) throw new Error(`unknown adapter ${a.adapterId}`);
      const verb = ad.installed ? "Update" : "Install";
      const r = await ctx.host.approvals.request({
        title: `${verb} ${ad.name} on ${desc.machineId}?`,
        operation: "acp-adapter-install",
        detail: [
          `Command (runs on ${desc.machineId}):`,
          `  npm install -g ${ad.pkg}@latest`,
          "",
          `Installed: ${ad.installed || "not installed"}   Latest: ${ad.latest || "unknown"}`,
          "",
          "This downloads and installs code from the npm registry. The agent will afterwards still need to be authenticated on that machine."
        ].join("\n"),
        options: [{ id: "allow", label: verb, kind: "allow" }, { id: "deny", label: "Cancel", kind: "deny" }]
      });
      if (r.optionId !== "allow") throw new Error(`${verb} cancelled`);
      return ctx.modules.call("acp", "installAdapter", { workspaceId: desc.id, adapterId: ad.id }, { timeoutMs: 16 * 60 * 1e3 });
    },
    /** Called by `acp` for session/request_permission. */
    async permissionRequest(ctx, a) {
      const c = await load(ctx, a.conversationId);
      const req = a.request || {};
      const options = req.options || [];
      const tool = req.toolCall || {};
      const policy = c.row.approvalPolicy || "ask";
      const allowOnce = options.find((o) => o.kind === "allow_once") || options.find((o) => String(o.kind).startsWith("allow"));
      const reject = options.find((o) => o.kind === "reject_once") || options.find((o) => String(o.kind).startsWith("reject"));
      let chosen = null;
      let how = "";
      if (policy === "autopilot" && allowOnce) {
        chosen = allowOnce.optionId;
        how = "autopilot";
      } else if (policy === "auto-low" && allowOnce && LOW_RISK_KINDS.has(tool.kind)) {
        chosen = allowOnce.optionId;
        how = "auto (low-risk)";
      } else {
        const detail = [
          `Agent: ${c.live?.agentInfo?.title || c.live?.agentInfo?.name || c.row.acpProfileId} on ${c.live?.machineId || "?"}`,
          `Workspace: ${c.row.workspaceId}`,
          `Tool: ${tool.title || "(untitled)"} [${tool.kind || "other"}]`,
          tool.rawInput ? `Input: ${JSON.stringify(tool.rawInput).slice(0, 4e3)}` : "",
          textOf(tool.content).slice(0, 4e3)
        ].filter(Boolean).join("\n");
        const r = await ctx.host.approvals.request({
          title: `Agent requests permission: ${tool.title || tool.kind || "tool call"}`,
          detail,
          operation: "agent-permission",
          options: options.map((o) => ({ id: o.optionId, label: o.name || o.optionId, kind: String(o.kind).startsWith("allow") ? "allow" : String(o.kind).startsWith("reject") ? "deny" : "neutral" }))
        });
        chosen = r.optionId;
        how = r.expired ? "expired" : "user";
      }
      const label = options.find((o) => o.optionId === chosen)?.name || (chosen ? chosen : "cancelled");
      ctx.log.info(`permission "${tool.title || tool.kind || "tool"}": ${label} (${how})`);
      flushSoon();
      notify();
      if (!chosen) return { outcome: { outcome: "cancelled" } };
      if (reject && chosen === reject.optionId) return { outcome: { outcome: "selected", optionId: chosen } };
      return { outcome: { outcome: "selected", optionId: chosen } };
    }
  }
};
var index_default = mod;
export {
  index_default as default
};
