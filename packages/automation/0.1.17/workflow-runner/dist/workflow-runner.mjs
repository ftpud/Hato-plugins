// ../sdk/sha256.ts
var K = new Uint32Array([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);

// ../sdk/runtime.ts
var JsonRpcPeer = class {
  constructor(send, startId = 1) {
    this.send = send;
    this.buf = "";
    this.nextId = 1;
    this.pending = /* @__PURE__ */ new Map();
    this.onRequest = async (m) => {
      throw rpcError(-32601, "Method not found: " + m);
    };
    this.onNotification = () => {
    };
    this.onProtocolError = () => {
    };
    this.nextId = startId;
  }
  get pendingCount() {
    return this.pending.size;
  }
  get nextRequestId() {
    return this.nextId;
  }
  get partial() {
    return this.buf;
  }
  restore(partial) {
    this.buf = partial;
  }
  feed(chunk) {
    this.buf += chunk;
    let i;
    while ((i = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch (e) {
        this.onProtocolError("invalid JSON", line);
        continue;
      }
      this.handle(msg, line);
    }
  }
  handle(msg, line) {
    if (msg && msg.method && msg.id !== void 0 && msg.id !== null) {
      const id = msg.id;
      this.onRequest(msg.method, msg.params, id).then(
        (result) => this.send(JSON.stringify({ jsonrpc: "2.0", id, result: result === void 0 ? null : result })),
        (err) => this.send(JSON.stringify({ jsonrpc: "2.0", id, error: { code: err && typeof err.rpcCode === "number" ? err.rpcCode : -32603, message: err && err.message || String(err), data: err && err.data } }))
      ).catch(() => {
      });
    } else if (msg && msg.method) {
      try {
        this.onNotification(msg.method, msg.params);
      } catch (e) {
        this.onProtocolError(String(e), line);
      }
    } else if (msg && (msg.result !== void 0 || msg.error !== void 0) && msg.id !== void 0) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) {
        const d = msg.error.data;
        const detail2 = d ? typeof d === "string" ? d : typeof d.message === "string" ? d.message : JSON.stringify(d) : "";
        const e = new Error((msg.error.message || "JSON-RPC error") + (detail2 && !String(msg.error.message).includes(detail2) ? `: ${detail2.slice(0, 600)}` : ""));
        e.rpcCode = msg.error.code;
        e.data = msg.error.data;
        p.reject(e);
      } else p.resolve(msg.result);
    } else {
      this.onProtocolError("unrecognized message", line);
    }
  }
  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.send(JSON.stringify({ jsonrpc: "2.0", id, method, params })).catch((e) => {
        this.pending.delete(id);
        reject(e);
      });
    });
  }
  cancelRequest(id, reason = "Request cancelled") {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    pending.reject(Object.assign(new Error(reason), { code: "ECANCELLED" }));
    void this.notify("$/cancel_request", { requestId: id }).catch(() => {
    });
  }
  notify(method, params) {
    return this.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
  }
  failAll(reason) {
    for (const [id, p] of this.pending) {
      const e = new Error(reason);
      e.code = "ECLOSED";
      p.reject(e);
      this.pending.delete(id);
    }
  }
};
function rpcError(code, message, data) {
  const e = new Error(message);
  e.rpcCode = code;
  e.data = data;
  return e;
}
function errMsg(e) {
  return e && (e.message || String(e)) || "unknown error";
}

// ../sdk/workflows.ts
var WORKFLOW_RUNNER_VERSION = "13";
var WORKFLOW_BLOCKS = [
  { type: "start_button", label: "Start button", summary: "Starts the run with its prompt as the input.", fields: ["prompt"], tool: false },
  { type: "start_input", label: "Start with text", summary: "Starts the run with text typed when it is run.", fields: [], tool: false },
  { type: "http_trigger", label: "HTTP Trigger", summary: "Listens on a loopback HTTP endpoint; armed on workflow start and passes matching requests to followers.", fields: ["trigger", "prompt"], tool: true },
  { type: "socket_trigger", label: "Socket Trigger", summary: "Listens on a loopback TCP port or Unix socket; armed on workflow start and passes incoming messages to followers.", fields: ["trigger", "prompt"], tool: true },
  { type: "file_trigger", label: "File/Pipe Trigger", summary: "Watches a workspace file or named pipe (FIFO); armed on workflow start and passes edits or pipe data to followers.", fields: ["trigger", "prompt"], tool: true },
  { type: "text_input", label: "Text Input", summary: "Type text into a running workflow at any time; each Send passes it to connected blocks.", fields: ["prompt", "description", "keepOpen"], tool: false },
  { type: "ai", label: "AI Agent", summary: "A background agent session that runs its prompt template and returns its final answer.", fields: ["prompt", "profileId", "model", "reasoning", "autopilot", "agentFile"], tool: true },
  { type: "chatbox", label: "Chatbox", summary: "A persistent conversation; every outgoing connection is a tool it can call.", fields: ["prompt", "profileId", "model", "reasoning", "autopilot", "agentFile"], tool: true },
  { type: "skill", label: "SKILL", summary: "Reusable instructions, custom or loaded from a workspace SKILL.md.", fields: ["description", "prompt", "skillId"], tool: true },
  { type: "text", label: "Fixed text", summary: "Fixed text (supports templates) passed on or returned to the caller.", fields: ["prompt"], tool: true },
  { type: "markdown", label: "Markdown document", summary: "Renders its template, or its input, as a Markdown document.", fields: ["prompt"], tool: true },
  { type: "script", label: "Script execution", summary: "Runs a shell command in the workspace; stdin and $HATO_WORKFLOW_INPUT receive the input.", fields: ["command", "timeoutSeconds"], tool: true },
  { type: "run_app", label: "Run App", summary: "Starts, checks, kills or tails a named long-lived app.", fields: ["command", "app"], tool: true },
  { type: "timer", label: "Timer", summary: "Waits, then passes its input to follow connections. Used as a tool it arms and returns at once.", fields: ["seconds"], tool: true },
  { type: "user_prompt", label: "User Prompt", summary: "Asks the user a question and returns the typed answer.", fields: ["prompt"], tool: true },
  { type: "yes_no_prompt", label: "Yes/No Prompt", summary: 'Asks the user and returns "yes" or "no" (also selects a yes/no path).', fields: ["prompt"], tool: true },
  { type: "meeting", label: "Meeting", summary: "A shared, attributed discussion between connected agents.", fields: ["description"], tool: true },
  { type: "terminal_control", label: "Terminal Control", summary: "Gives connected agents the workspace terminal tools (list, read, write).", fields: [], tool: true },
  { type: "task_controls", label: "Task controls", summary: "Gives connected agents the Git task tools (list, create, start agent).", fields: [], tool: true },
  { type: "mcp", label: "MCP server", summary: "Attaches a configured or built-in Hato MCP server to connected agents.", fields: ["mcp"], tool: true },
  { type: "browser", label: "Browser", summary: "Gives connected agents a persistent browser session (pages, clicks, typing, screenshots, network), shown live on the block.", fields: ["browser"], tool: true }
];
var INTERNAL_MCP_SERVERS = [
  { id: "internal-remote-mcp", name: "Hato · workspace tools (agents, terminals, tasks)", command: "", args: [], env: [] },
  { id: "internal-local-mcp", name: "Hato · desktop tools (desktop must be open)", command: "", args: [], env: [] }
];
var isInternalMcp = (id) => INTERNAL_MCP_SERVERS.some((m) => m.id === id);
var blockInfo = (type) => WORKFLOW_BLOCKS.find((b) => b.type === type);
var AGENT_TYPES = /* @__PURE__ */ new Set(["ai", "chatbox"]);
var isAgentBlock = (b) => AGENT_TYPES.has(b.type);
var isCapabilityBlock = (b) => b.type === "terminal_control" || b.type === "task_controls" || b.type === "mcp" || b.type === "browser";
var capabilityMcpServer = (b) => b.type === "mcp" ? b.mcp?.serverId : b.type === "browser" ? "internal-local-mcp" : void 0;
var isStartBlock = (b) => b.type === "start_button" || b.type === "start_input";
var TRIGGER_TYPES = /* @__PURE__ */ new Set(["http_trigger", "socket_trigger", "file_trigger"]);
var isTriggerBlock = (b) => TRIGGER_TYPES.has(b.type);
var isEventSource = (b) => TRIGGER_TYPES.has(b.type) || b.type === "text_input";
var edgeType = (e) => e.type || "follow";
var ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
var now = () => (/* @__PURE__ */ new Date()).toISOString();
var clip = (v, n) => typeof v === "string" ? v.slice(0, n) : "";
var num = (v) => typeof v === "number" && Number.isFinite(v) ? v : void 0;
var TRIGGER_TYPE_ALIASES = {
  file_pipe_trigger: "file_trigger",
  file_edited_trigger: "file_trigger",
  pipe_trigger: "file_trigger"
};
function normalizeTriggerConfig(raw) {
  if (!raw || typeof raw !== "object") return void 0;
  const src = raw.trigger && typeof raw.trigger === "object" ? { ...raw, ...raw.trigger } : raw;
  const t = {};
  if (num(src.port) !== void 0) t.port = Math.round(num(src.port));
  if (typeof src.path === "string" && src.path.trim()) t.path = clip(src.path.trim(), 500);
  if (typeof src.method === "string" && src.method.trim()) t.method = clip(src.method.trim().toUpperCase(), 20);
  const sc = num(src.statusCode ?? src.status_code);
  if (sc !== void 0) t.statusCode = Math.round(sc);
  const rb = src.responseBody ?? src.response_body;
  if (typeof rb === "string") t.responseBody = clip(rb, 64e3);
  if (typeof src.secret === "string" && src.secret) t.secret = clip(src.secret, 400);
  if (src.protocol === "tcp" || src.protocol === "unix") t.protocol = src.protocol;
  if (src.framing === "line" || src.framing === "message" || src.framing === "eof") t.framing = src.framing;
  if (src.mode === "auto" || src.mode === "file" || src.mode === "pipe") t.mode = src.mode;
  const cim = src.createIfMissing ?? src.create_if_missing;
  if (typeof cim === "boolean") t.createIfMissing = cim;
  if (typeof src.continuous === "boolean") t.continuous = src.continuous;
  const me = num(src.maxEvents ?? src.max_events);
  if (me !== void 0) t.maxEvents = Math.round(me);
  return Object.keys(t).length ? t : void 0;
}
function normalizeDefinition(raw, fallback) {
  if (!raw || typeof raw !== "object") throw new Error("A workflow definition must be a JSON object");
  if (raw.blocks !== void 0 && !Array.isArray(raw.blocks)) throw new Error("blocks must be an array");
  if (raw.edges !== void 0 && !Array.isArray(raw.edges)) throw new Error("edges must be an array");
  if ((raw.blocks?.length || 0) > 300 || (raw.edges?.length || 0) > 1e3) throw new Error("A workflow is limited to 300 blocks and 1000 connections");
  const blocks = (raw.blocks || []).map((b, i) => {
    const rawType = String(b?.type || "");
    const type = TRIGGER_TYPE_ALIASES[rawType] || rawType;
    const block2 = {
      id: clip(b?.id, 80) || `block-${i + 1}`,
      type,
      label: clip(b?.label, 200),
      prompt: clip(b?.prompt, 2e5),
      position: { x: Math.round(num(b?.position?.x) ?? 40 + i % 5 * 260), y: Math.round(num(b?.position?.y) ?? 40 + Math.floor(i / 5) * 170) }
    };
    if (typeof b?.description === "string") block2.description = clip(b.description, 4e3);
    if (typeof b?.command === "string") block2.command = clip(b.command, 64e3);
    if (num(b?.timeoutSeconds) !== void 0) block2.timeoutSeconds = num(b.timeoutSeconds);
    if (num(b?.seconds) !== void 0) block2.seconds = num(b.seconds);
    if (b?.app && typeof b.app === "object") block2.app = {
      name: clip(b.app.name, 80),
      ...Array.isArray(b.app.actions) ? { actions: b.app.actions.filter((a) => ["start", "status", "kill", "tail"].includes(a)) } : {},
      ...["start", "status", "kill", "tail"].includes(b.app.action) ? { action: b.app.action } : {},
      ...num(b.app.lines) ? { lines: num(b.app.lines) } : {}
    };
    for (const k of ["profileId", "provider", "model", "reasoning", "agentFile", "skillId"]) if (typeof b?.[k] === "string" && b[k]) block2[k] = clip(b[k], 400);
    if (!block2.agentFile && b?.agent && b.agent.scope === "workspace" && typeof b.agent.name === "string") block2.agentFile = `.agents/agents/${clip(b.agent.name, 180)}`;
    if (typeof b?.autopilot === "boolean") block2.autopilot = b.autopilot;
    if (b?.mcp && typeof b.mcp.serverId === "string") block2.mcp = { serverId: clip(b.mcp.serverId, 120) };
    if (b?.browser && typeof b.browser.sessionId === "string") block2.browser = { sessionId: clip(b.browser.sessionId, 80), ...typeof b.browser.name === "string" ? { name: clip(b.browser.name, 80) } : {} };
    if (isTriggerBlock(block2)) {
      const trigger = normalizeTriggerConfig(b);
      if (trigger) block2.trigger = trigger;
    }
    if (block2.type === "text_input" && typeof b?.keepOpen === "boolean") block2.keepOpen = b.keepOpen;
    if (b?.join === "any" || b?.join === "all") block2.join = b.join;
    if (b?.inputSchema && typeof b.inputSchema === "object") block2.inputSchema = b.inputSchema;
    if (b?.outputSchema && typeof b.outputSchema === "object") block2.outputSchema = b.outputSchema;
    return block2;
  });
  const edges = (raw.edges || []).map((e, i) => {
    const edge = { id: clip(e?.id, 120) || `edge-${i + 1}`, from: clip(e?.from, 80), to: clip(e?.to, 80) };
    if (["follow", "use", "path", "queue"].includes(e?.type)) edge.type = e.type;
    if (num(e?.queueLimit) !== void 0) edge.queueLimit = Math.round(num(e.queueLimit));
    if (typeof e?.label === "string" && e.label) edge.label = clip(e.label, 80);
    if (e?.loop === true) edge.loop = true;
    if (num(e?.timeoutMs)) edge.timeoutMs = num(e.timeoutMs);
    return edge;
  });
  const settings = {};
  for (const k of ["maxLoopCount", "maxSteps", "outputLimitChars", "promptLimitChars", "maxRunDurationMs"]) if (num(raw.settings?.[k]) !== void 0) settings[k] = num(raw.settings[k]);
  return {
    id: clip(raw.id, 80) || fallback?.id || crypto.randomUUID(),
    name: clip(raw.name, 200).trim() || fallback?.name || "Untitled workflow",
    ...typeof raw.description === "string" ? { description: clip(raw.description, 4e3) } : {},
    version: num(raw.version) ?? fallback?.version ?? 1,
    createdAt: clip(raw.createdAt, 40) || fallback?.createdAt || now(),
    updatedAt: now(),
    ...Object.keys(settings).length ? { settings } : {},
    blocks,
    edges
  };
}
var reaches = (edges, from, to) => {
  const seen = /* @__PURE__ */ new Set(), stack = [from];
  while (stack.length) {
    const c = stack.pop();
    if (c === to) return true;
    if (seen.has(c)) continue;
    seen.add(c);
    for (const e of edges) if (e.from === c && edgeType(e) !== "use") stack.push(e.to);
  }
  return false;
};
function validateWorkflow(def, available) {
  const issues = [];
  const err = (code, message, extra = {}) => issues.push({ code, message, severity: "error", ...extra });
  const warn = (code, message, extra = {}) => issues.push({ code, message, severity: "warning", ...extra });
  if (!def.blocks.length) err("empty", "Add at least one block before running this workflow");
  const ids = /* @__PURE__ */ new Set();
  for (const b of def.blocks) {
    const name = b.label || b.id;
    if (!ID.test(b.id)) err("invalid-id", `Block ID '${b.id}' must start with a letter or digit and use letters, digits, _ or -`, { blockId: b.id });
    if (ids.has(b.id)) err("duplicate-id", `Block ID '${b.id}' is duplicated`, { blockId: b.id });
    ids.add(b.id);
    const info = blockInfo(b.type);
    if (!info) {
      err("unsupported-type", `Block '${name}' has unsupported type '${b.type}'`, { blockId: b.id });
      continue;
    }
    if (!b.label.trim()) err("empty-label", "Every block needs a name", { blockId: b.id });
    if (["ai", "start_button", "user_prompt", "yes_no_prompt"].includes(b.type) && !b.prompt.trim()) err("empty-prompt", `Block '${name}' needs a prompt`, { blockId: b.id });
    if (b.type === "skill" && !b.skillId && !b.prompt.trim()) err("empty-prompt", `Skill '${name}' needs instructions or an existing skill`, { blockId: b.id });
    if (b.type === "skill" && !b.description?.trim()) warn("skill-description", `Skill '${name}' should describe when to use it`, { blockId: b.id });
    if (b.type === "skill" && b.skillId && (b.skillId.startsWith("/") || b.skillId.split("/").includes("..") || !b.skillId.endsWith(".md")))
      err("invalid-skill", `Skill '${name}' must reference a workspace-relative SKILL.md file`, { blockId: b.id });
    if ((b.type === "script" || b.type === "run_app") && !b.command?.trim()) err("empty-command", `Block '${name}' needs a shell command`, { blockId: b.id });
    if (b.type === "script" && b.timeoutSeconds !== void 0 && !(b.timeoutSeconds >= 1 && b.timeoutSeconds <= 86400)) err("invalid-timeout", `Script '${name}' timeout must be 1–86400 seconds`, { blockId: b.id });
    if (b.type === "run_app" && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(b.app?.name || "")) err("invalid-app", `Run App '${name}' needs an app name (letters, digits, . _ -)`, { blockId: b.id });
    if (b.type === "timer" && !(Number.isInteger(b.seconds) && b.seconds >= 0 && b.seconds <= 7 * 86400)) err("invalid-timer", `Timer '${name}' needs whole seconds from 0 to 604800`, { blockId: b.id });
    if (b.type === "mcp" && !b.mcp?.serverId) err("invalid-mcp", `MCP block '${name}' needs a configured server`, { blockId: b.id });
    if (b.type === "mcp" && b.mcp?.serverId && available?.mcps && !available.mcps.some((m) => m.id === b.mcp.serverId)) warn("unavailable-mcp", `MCP server for '${name}' is not configured or enabled`, { blockId: b.id });
    if (b.type === "browser" && !b.browser?.sessionId) err("invalid-browser", `Browser block '${name}' needs a browser session`, { blockId: b.id });
    if (b.type === "browser" && available?.mcps && !available.mcps.some((m) => m.id === "internal-local-mcp")) warn("unavailable-browser", `Browser block '${name}' needs the Hato desktop tools, which this workspace cannot reach`, { blockId: b.id });
    if (b.type === "http_trigger") {
      const p = b.trigger?.port;
      if (p !== void 0 && p !== 0 && !(Number.isInteger(p) && p >= 1024 && p <= 65535)) err("invalid-trigger", `HTTP Trigger '${name}' port must be 0 (auto) or 1024–65535`, { blockId: b.id });
      const sc = b.trigger?.statusCode;
      if (sc !== void 0 && !(Number.isInteger(sc) && sc >= 100 && sc <= 599)) err("invalid-trigger", `HTTP Trigger '${name}' status code must be 100–599`, { blockId: b.id });
      if (b.trigger?.path && !b.trigger.path.startsWith("/")) err("invalid-trigger", `HTTP Trigger '${name}' path must start with /`, { blockId: b.id });
    }
    if (b.type === "socket_trigger") {
      const proto = b.trigger?.protocol || (b.trigger?.path && !b.trigger?.port ? "unix" : "tcp");
      if (proto === "unix") {
        if (!b.trigger?.path?.trim()) err("invalid-trigger", `Socket Trigger '${name}' needs a Unix socket path`, { blockId: b.id });
        else if (b.trigger.path.split("/").includes("..")) err("invalid-trigger", `Socket Trigger '${name}' path cannot contain '..'`, { blockId: b.id });
      } else {
        const p = b.trigger?.port;
        if (p !== void 0 && p !== 0 && !(Number.isInteger(p) && p >= 1024 && p <= 65535)) err("invalid-trigger", `Socket Trigger '${name}' port must be 0 (auto) or 1024–65535`, { blockId: b.id });
      }
    }
    if (b.type === "file_trigger") {
      if (!b.trigger?.path?.trim()) err("invalid-trigger", `File/Pipe Trigger '${name}' needs a file or pipe path`, { blockId: b.id });
      else if (b.trigger.path.startsWith("/") || b.trigger.path.split("/").includes("..")) err("invalid-trigger", `File/Pipe Trigger '${name}' path must be workspace-relative`, { blockId: b.id });
    }
    if (isAgentBlock(b) && available?.profiles) {
      const ok = b.profileId ? available.profiles.some((p) => p.id === b.profileId) : b.provider ? available.profiles.some((p) => p.provider === b.provider) : available.profiles.length > 0;
      if (!ok) err("unavailable-provider", `No enabled AI provider matches '${name}' on this machine`, { blockId: b.id });
    }
    if (isAgentBlock(b) && b.agentFile && (b.agentFile.startsWith("/") || b.agentFile.split("/").includes(".."))) err("invalid-agent", `Agent file of '${name}' must be workspace-relative`, { blockId: b.id });
  }
  const edgeIds = /* @__PURE__ */ new Set(), pairs = /* @__PURE__ */ new Set();
  for (const e of def.edges) {
    if (edgeIds.has(e.id)) err("duplicate-edge-id", `Connection ID '${e.id}' is duplicated`, { edgeId: e.id });
    edgeIds.add(e.id);
    const from = def.blocks.find((b) => b.id === e.from), to = def.blocks.find((b) => b.id === e.to);
    if (!from || !to) {
      err("missing-endpoint", `Connection '${e.id}' references a missing block`, { edgeId: e.id });
      continue;
    }
    if (e.from === e.to) err("self-edge", `Block '${from.label}' cannot connect to itself`, { edgeId: e.id });
    const pair = `${e.from}>${e.to}>${edgeType(e)}>${e.label || ""}`;
    if (pairs.has(pair)) err("duplicate-edge", `Duplicate connection from '${from.label}' to '${to.label}'`, { edgeId: e.id });
    pairs.add(pair);
    const t = edgeType(e);
    if (t === "use" && !isAgentBlock(from)) err("invalid-use", `Only AI Agent and Chatbox blocks can use '${to.label}' as a tool`, { edgeId: e.id });
    if (t === "use" && isStartBlock(to)) err("invalid-use", "Start blocks cannot be used as tools", { edgeId: e.id });
    if (t === "path" && from.type !== "ai" && from.type !== "yes_no_prompt") err("route-label", `Paths start at an AI Agent or Yes/No Prompt ('${from.label}')`, { edgeId: e.id });
    if (t === "path" && !e.label?.trim()) err("route-label", `Path from '${from.label}' needs a route name`, { edgeId: e.id });
    if (t === "path" && from.type === "yes_no_prompt" && e.label && !["yes", "no"].includes(e.label)) err("route-label", "Yes/No paths are named yes or no", { edgeId: e.id });
    if (t !== "use" && from.type !== "chatbox" && isCapabilityBlock(to)) err("invalid-capability", `'${to.label}' adds tools to agents; connect it with a Use connection`, { edgeId: e.id });
    if (t !== "use" && isStartBlock(to)) err("invalid-follow", "Start blocks cannot have incoming connections", { edgeId: e.id });
    if (to.type === "text_input") err("invalid-follow", `Text Input '${to.label}' is typed into by the user and cannot have incoming connections`, { edgeId: e.id });
    if (t === "queue" && e.queueLimit !== void 0 && !(Number.isInteger(e.queueLimit) && e.queueLimit >= 1 && e.queueLimit <= 1e4)) err("invalid-queue", `Queue '${from.label}' → '${to.label}' limit must be 1–10000`, { edgeId: e.id });
    if (t === "queue" && isTriggerBlock(to)) err("invalid-queue", `Triggers cannot receive queue connections ('${to.label}')`, { edgeId: e.id });
    if (t !== "use" && from.type === "chatbox") warn("chatbox-follow", `Chatbox '${from.label}' exposes every outgoing connection as a tool; follow connections do not run automatically`, { edgeId: e.id });
    if (t !== "use" && !e.loop && reaches(def.edges.filter((x) => x.id !== e.id), e.to, e.from) && !["timer", "user_prompt", "yes_no_prompt"].includes(from.type) && !isTriggerBlock(from) && !isAgentBlock(to))
      warn("cycle", `Connection '${from.label}' → '${to.label}' closes a cycle; mark it as a loop if intended`, { edgeId: e.id });
  }
  return issues;
}
var blockingIssues = (issues) => issues.filter((i) => i.severity !== "warning");
function preview(text, limit) {
  if (text.length <= limit) return text;
  const head = Math.floor(limit * 0.6), tail = limit - head;
  return `${text.slice(0, head)}
…[${text.length - limit} characters omitted; use workflow_block_output to page]…
${text.slice(-tail)}`;
}
function renderPrompt(template, input, outputs, limits = { reference: 8e3, total: 2e4 }) {
  const get = (id) => outputs instanceof Map ? outputs.get(id) : outputs[id];
  let budget = limits.total;
  return template.replace(/\{\{\s*(input|blocks\.([A-Za-z0-9_-]+)\.output)\s*\}\}/g, (_m, all, id) => {
    if (all === "input") return input;
    const value = get(id) ?? "";
    const text = preview(value, Math.max(200, Math.min(limits.reference, budget)));
    budget = Math.max(0, budget - text.length);
    return text;
  });
}
var WORKFLOW_REFERENCE = String.raw`# Hato workflows: blocks and connections

Workflows are JSON graphs of blocks joined by connections. They run on the workspace
machine's daemon (hatod), so a run continues when the desktop disconnects. Saving a
workflow never starts it; the user runs it from the Workflows panel.

## Definition

~~~json
{"id":"review","name":"Review changes","blocks":[
  {"id":"start","type":"start_button","label":"Start","prompt":"Review the current changes","position":{"x":40,"y":80}},
  {"id":"status","type":"script","label":"Git status","prompt":"","command":"git status --short","position":{"x":300,"y":260}},
  {"id":"reviewer","type":"ai","label":"Reviewer","prompt":"{{input}}\nUse the status block, then report findings.","position":{"x":300,"y":80}}],
 "edges":[{"id":"e1","from":"start","to":"reviewer","type":"follow"},
  {"id":"e2","from":"reviewer","to":"status","type":"use"}]}
~~~

Keep block and connection IDs stable when editing (letters, digits, _ and -). Positions are
designer coordinates in pixels; place new blocks about 260 px apart horizontally.

## Connections

- follow (default): when the source finishes, the target runs with the source's output as input.
  Several follows from one block run in parallel. Converging follows join: the target waits for
  all active branches (join "all", default) or runs on the first one (join "any").
- use: the target becomes a tool of the source AI Agent or Chatbox, called with workflow_use_block.
- path: a named route (label). An AI Agent with paths must call workflow_choose_path before it
  finishes; only matching path connections run. Yes/No Prompts select the "yes" or "no" path.
- queue: like follow, but when the target is still busy the source's output waits in a FIFO and
  runs as soon as the target is free, one item at a time (use it after triggers, timers or loops
  that may fire faster than the target finishes). queueLimit caps waiting items per connection
  (default 100, max 10000); when full the item is rejected (an HTTP Trigger answers 503). Queue
  connections do not take part in joins.
- loop: true marks a follow/path that intentionally returns to an earlier block (bounded by
  settings.maxLoopCount, default 100).

## Templates

Prompts may contain {{input}} (the block's input) and {{blocks.ID.output}} (another block's latest
output, previewed to 8,000 characters). AI prompts without {{input}} get the input appended.

## Blocks

| type | fields | behavior |
| --- | --- | --- |
| start_button | prompt | Starts a run; its prompt becomes the input. |
| start_input | — | Starts a run with text typed by the user. |
| http_trigger | trigger {port?, path?, method?, statusCode?, responseBody?, secret?, continuous?, maxEvents?}, prompt (optional template) | Armed on workflow start on 127.0.0.1:port (0/omitted picks a free port). Fails the run on start if the port cannot be bound. Matching HTTP requests pass request JSON (or rendered prompt) to followers. |
| socket_trigger | trigger {protocol? ("tcp" \| "unix"), port?, path?, framing? ("line" \| "message" \| "eof"), responseBody?, continuous?, maxEvents?}, prompt (optional template) | Armed on workflow start on a loopback TCP port or Unix socket path. Fails the run on start if binding fails. Incoming socket messages pass to followers. |
| file_trigger | trigger {path, mode? ("auto" \| "file" \| "pipe"), framing? ("message" \| "line"), createIfMissing?, continuous?, maxEvents?}, prompt (optional template) | Armed on workflow start watching a workspace file or named pipe (FIFO). Fails the run on start if the target cannot be watched or opened. File edits or pipe writes pass to followers. |
| text_input | prompt (optional template; {{input}} is the typed text), description (hint shown by the text box), keepOpen (default true) | Available throughout a run: each text the user sends (designer/run view, or the send_text tool) passes to its follow/queue connections. With keepOpen the run stays waiting until cancelled; otherwise sending reopens a finished run. Blocks added by a hot update become available immediately. |
| ai | prompt, profileId or provider, model, reasoning, autopilot, agentFile | Background agent session. Returns its final answer. Keeps its context for later invocations in the run. |
| chatbox | prompt (session guidance), profileId, model, reasoning, autopilot | Persistent conversation the user chats with. All outgoing connections are its tools. |
| skill | description, prompt or skillId (workspace SKILL.md path) | Instructions loaded on demand by connected agents. |
| text | prompt | Returns its rendered text. |
| markdown | prompt (optional) | Renders its template or its input as a Markdown document. |
| script | command, timeoutSeconds (default 1800) | sh -lc in the workspace root. stdin and $HATO_WORKFLOW_INPUT receive the input. Non-zero exit fails. |
| run_app | command, app {name, actions} | Named long-lived app: start, status, kill, tail. Survives between runs until killed. |
| timer | seconds | Waits, then follows run with its input. As a tool it arms and returns at once; reusing it re-arms. |
| user_prompt | prompt | Asks the user; returns the typed answer. |
| yes_no_prompt | prompt | Asks the user; returns "yes" or "no". |
| meeting | description | Shared transcript: publish, tail, diff, wait, status, shake. Participant work/idle/permission/error status changes are posted automatically and wake room waiters. |
| terminal_control | — | Connected agents call workflow_use_block with action list/read/write; read/write take key, read accepts cursor, write takes text. Requests/results are logged on the block. |
| task_controls | — | Use it to give an agent Git task tools (tasks_list/create/start_agent; desktop open). |
| mcp | mcp {serverId} | Use it to attach a configured MCP server to an agent. |
| browser | browser {sessionId, name?} | Use it to let connected agents drive a Browser panel session (desktop open; the session must allow agents). Agents call the desktop browser commands with that session. |

AI providers: profileId is an ACP profile id from the catalog (workflows__catalog). A block may
instead name a provider (claude, codex, gemini, …); the first enabled matching profile is used.

## Agent tools inside a run

- workflow_connections: list connected tools.
- workflow_use_block {block_id, input?, action?, lines?, timeout_seconds?}: run or control a connected block.
  AI/Chatbox actions: (omitted) run and wait, start, status, tail, steer. Run App: start, status,
  kill, tail. Triggers (http_trigger, socket_trigger, file_trigger): status, configure/arm/start
  (accepts port, path, method, status_code, response_body, secret, protocol, framing, mode,
  create_if_missing, continuous, max_events), disarm/stop/cancel, wait, fetch. Meeting: publish
  {message}, tail, diff (default), wait, status, shake {peer_block_id, message} (a specific
  nonempty message is required).
  Any data block: fetch returns output not yet fetched by this caller.
- workflow_block_output {block_id, offset?, limit?}: page through retained output.
- workflow_block_messages {block_id, count?}: recent messages of a connected agent.
- workflow_choose_path {path}: choose a route before finishing.

## Self-configuration

Use workflows__list, workflows__read, workflows__write and workflows__validate (desktop MCP) or the
configurator's workflows_* tools. Read before writing and pass the returned revision as
expected_revision (null to create). Check returned validation issues. Never start runs unasked.
`;

// ../sdk/workflow-templates.ts
function multiAgentSetup() {
  const agents = [
    { id: "researcher", label: "Researcher", role: "Investigate the goal, relevant code and constraints. Return concrete findings and recommended steps. Inspect without editing files." },
    { id: "implementer", label: "Implementer", role: "Implement the assigned part of the goal, following workspace instructions. Coordinate ownership before editing. Validate changes and report what changed and any remaining issues." },
    { id: "reviewer", label: "Reviewer", role: "Review the supplied plan or implementation against the user's goal. Inspect without editing files. Report bugs, missing coverage and concrete recommendations; distinguish verified facts from assumptions." }
  ];
  return {
    blocks: [
      { id: "start", type: "start_input", label: "Start with a prompt", prompt: "", position: { x: 32, y: 220 } },
      {
        id: "coordinator",
        type: "ai",
        label: "Coordinator",
        position: { x: 310, y: 220 },
        prompt: `Coordinate this goal: {{input}}
You have three connected agents (researcher, implementer, reviewer) and a shared Meeting block (meeting).
1. Publish the goal and a short plan to meeting with workflow_use_block, action publish.
2. Delegate concrete tasks through workflow_use_block to researcher, then implementer when changes are requested, and reviewer. Include the original goal and relevant findings in each task. Researcher and reviewer inspect without editing; implementer owns edits. For a question-only goal, ask implementer for a proposed solution without editing.
3. Read meeting messages with action diff as you work. Every agent can see participant activity notices there. To wake a specific participant, use action shake with that participant's block ID in peer_block_id and a specific message. Use the connected agents' returned results to track completion; do not wait indefinitely for optional messages.
4. Resolve review findings with the implementer as needed. Publish the final outcome to meeting, then return a concise report of results, validation and remaining issues. Do not claim unperformed checks.`
      },
      ...agents.map((agent2, index) => ({
        id: agent2.id,
        type: "ai",
        label: agent2.label,
        prompt: `${agent2.role}
Task: {{input}}
Use the connected meeting block through workflow_use_block to read the team's messages (action diff), publish relevant findings (action publish, message), and coordinate handoffs. Status notices are announced automatically. If waking a teammate with action shake, supply peer_block_id and a specific message. Publish your result to the room and return it to the coordinator. Finish your invocation when your assigned work is complete.`,
        position: { x: 620, y: 40 + index * 180 }
      })),
      { id: "meeting", type: "meeting", label: "Team meeting", prompt: "", position: { x: 940, y: 220 } },
      { id: "report", type: "markdown", label: "Team report", prompt: "{{input}}", position: { x: 310, y: 580 } }
    ],
    edges: [
      { id: "start-team", from: "start", to: "coordinator", type: "follow" },
      ...agents.map((agent2) => ({ id: `delegate-${agent2.id}`, from: "coordinator", to: agent2.id, type: "use" })),
      ...["coordinator", ...agents.map((agent2) => agent2.id)].map((id) => ({ id: `meeting-${id}`, from: id, to: "meeting", type: "use" })),
      { id: "team-report", from: "coordinator", to: "report", type: "follow" }
    ]
  };
}
var WORKFLOW_TEMPLATES = [
  { id: "blank", name: "Blank workflow", description: "Start from an empty canvas.", graph: () => ({ blocks: [], edges: [] }) },
  { id: "multi-agent-setup", name: "Multi-agent setup", description: "Start with a prompt, coordinate three specialist agents in a shared meeting, and produce a report.", graph: multiAgentSetup }
];

// modules/services/workflow-runner/src/context.ts
function referenceUpdates(prompt, outputs, previous = {}) {
  const values = {};
  const changed = [];
  let budget = 16e3;
  const refs = [...new Set([...prompt.matchAll(/\{\{\s*blocks\.([A-Za-z0-9_-]+)\.output\s*\}\}/g)].map((m) => m[1]))];
  for (const ref of refs) {
    if (budget <= 0) break;
    const raw = outputs.get(ref) ?? "";
    const value = raw.slice(0, Math.min(4e3, budget));
    budget -= value.length + ref.length + 4;
    values[ref] = value;
    if (previous[ref] !== value) changed.push(`${ref}: ${value}`);
  }
  return { values, text: changed.length ? `

Workflow context updates:
${changed.join("\n")}` : "" };
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

// modules/services/workflow-runner/src/procs.ts
var shell = (ctx2) => ctx2.host.env.info().platform === "macos" ? "/bin/zsh" : "/bin/sh";
async function runScript(ctx2, root, command, input, opts) {
  const grant = await ctx2.host.capabilities.request({ kind: "process", root, target: { kind: "local" } });
  let handle;
  try {
    const env = { HATO_WORKFLOW_INPUT: input, HATOPAD_WORKFLOW_INPUT: input, TERM: "dumb" };
    handle = (await ctx2.host.process.spawn(grant.grant, { target: { kind: "local" }, executable: shell(ctx2), args: ["-lc", command], cwd: root, env })).handle;
  } finally {
    await ctx2.host.capabilities.release(grant.grant);
  }
  opts.track(handle);
  let stdout = "", stderr = "";
  const subs = [
    await ctx2.host.streams.listen(handle, { channel: "stdout" }, (c) => {
      stdout = (stdout + c).slice(-4e5);
    }),
    await ctx2.host.streams.listen(handle, { channel: "stderr" }, (c) => {
      stderr = (stderr + c).slice(-4e4);
    })
  ];
  const timer = setTimeout(() => {
    stderr += `
Script timed out after ${Math.round(opts.timeoutMs / 1e3)} s`;
    void ctx2.host.process.terminate(handle, "SIGKILL").catch(() => {
    });
  }, opts.timeoutMs);
  try {
    await ctx2.host.process.write(handle, input).catch(() => {
    });
    await ctx2.host.process.closeStdin(handle).catch(() => {
    });
    const exit = await ctx2.host.process.wait(handle);
    await new Promise((r) => setTimeout(r, 50));
    return { code: exit?.code ?? null, stdout, stderr };
  } finally {
    clearTimeout(timer);
    opts.track(null);
    for (const s of subs) await s.close().catch(() => {
    });
    await ctx2.host.resources.release(handle).catch(() => {
    });
  }
}
var apps = /* @__PURE__ */ new Map();
var key = (root, name) => `${root}\0${name}`;
var APP_BUFFER = 512 * 1024;
var runningApps = () => [...apps.values()].filter((a) => a.status !== "exited").length;
var listApps = (root) => [...apps.values()].filter((a) => a.root === root).map((a) => appState(a));
function appState(a, name = "", lines = 0) {
  if (!a) return { name, status: "not_found", output: "" };
  const out = lines > 0 ? a.output.split("\n").slice(-Math.min(lines, 1e4) - 1).join("\n") : void 0;
  return { name: a.name, status: a.status, pid: a.pid, exitCode: a.exitCode, startedAt: a.startedAt, command: a.command, ...out !== void 0 ? { output: out } : {} };
}
async function appAction(ctx2, root, name, command, action, lines = 100) {
  const k = key(root, name), current = apps.get(k);
  if (action === "status") return appState(current, name);
  if (action === "tail") return appState(current, name, lines);
  if (action === "kill") {
    if (!current || current.status === "exited" || !current.handle) return appState(current, name);
    const h2 = current.handle;
    await ctx2.host.process.terminate(h2, "SIGTERM").catch(() => {
    });
    setTimeout(() => {
      if (current.status !== "exited") void ctx2.host.process.terminate(h2, "SIGKILL").catch(() => {
      });
    }, 3e3);
    for (let i = 0; i < 40 && current.status !== "exited"; i++) await new Promise((r) => setTimeout(r, 100));
    return appState(current, name);
  }
  if (action !== "start") throw new Error(`Unknown Run App action '${action}'`);
  if (current && current.status !== "exited") return { ...appState(current, name), note: "Already running" };
  const app = { name, root, command, handle: null, status: "starting", output: "", startedAt: (/* @__PURE__ */ new Date()).toISOString() };
  apps.set(k, app);
  const grant = await ctx2.host.capabilities.request({ kind: "process", root, target: { kind: "local" } });
  try {
    const spawned = await ctx2.host.process.spawn(grant.grant, { target: { kind: "local" }, executable: shell(ctx2), args: ["-lc", command], cwd: root, env: { TERM: "dumb" } });
    app.handle = spawned.handle;
    app.pid = spawned.pid;
    app.status = "running";
  } catch (e) {
    app.status = "exited";
    app.output = errMsg(e);
    throw e;
  } finally {
    await ctx2.host.capabilities.release(grant.grant);
  }
  const append = (c) => {
    app.output = (app.output + c).slice(-APP_BUFFER);
  };
  const h = app.handle;
  await ctx2.host.streams.listen(h, { channel: "stdout" }, append);
  await ctx2.host.streams.listen(h, { channel: "stderr" }, append);
  void ctx2.host.process.wait(h).then((exit) => {
    app.status = "exited";
    app.exitCode = exit?.code ?? null;
    void ctx2.host.resources.release(h).catch(() => {
    });
  }).catch(() => {
    app.status = "exited";
  });
  await ctx2.host.process.closeStdin(h).catch(() => {
  });
  return appState(app, name);
}
async function killAllApps(ctx2) {
  for (const a of apps.values()) if (a.handle && a.status !== "exited") await ctx2.host.process.terminate(a.handle, "SIGKILL").catch(() => {
  });
}

// modules/services/workflow-runner/src/mcp.ts
var db;
var listener = null;
var scopes = /* @__PURE__ */ new Map();
var connections = /* @__PURE__ */ new Map();
var proxy = `const net=require('node:net'),fs=require('node:fs');let p=process.env.HATO_MCP_PORT;try{p=fs.readFileSync(process.env.HATO_MCP_PORT_FILE,'utf8').trim()||p}catch{}const s=net.connect({host:'127.0.0.1',port:Number(p)},()=>{s.write(JSON.stringify({token:process.env.HATO_MCP_TOKEN})+'\\n');process.stdin.pipe(s)});s.pipe(process.stdout);s.on('error',e=>{console.error(e.message);process.exit(1)});s.on('close',()=>process.exit(0));process.stdin.on('end',()=>s.end());`;
var handler;
var portDir = null;
var PORT_FILE = "workflow-runner.port";
async function initMcp(ctx2, database, h) {
  db = database;
  handler = h;
  await ctx2.host.db.exec(db, "CREATE TABLE IF NOT EXISTS scopes(token TEXT PRIMARY KEY, data TEXT NOT NULL)");
  for (const r of await ctx2.host.db.query(db, "SELECT data FROM scopes")) {
    const s = JSON.parse(r.data);
    scopes.set(s.token, s);
  }
  portDir = ctx2.host.env.info().sharedDir || null;
  if (scopes.size && portDir) await listen(ctx2).catch((e) => ctx2.log.warn("workflow MCP listener", errMsg(e)));
}
async function writePort(ctx2) {
  if (!portDir || !listener) return;
  portWritten = false;
  const g = await ctx2.host.capabilities.request({ kind: "fs", root: portDir, target: { kind: "local" }, write: true });
  try {
    await ctx2.host.fs.writeAtomic(g.grant, PORT_FILE, String(listener.port), { reason: "workflow MCP port" });
  } finally {
    await ctx2.host.capabilities.release(g.grant);
  }
  portWritten = true;
}
var portWritten = false;
async function listen(ctx2) {
  if (listener) return listener;
  listener = await ctx2.host.net.listenLoopback();
  let pending = "";
  await ctx2.host.streams.listen(listener.handle, {}, (chunk) => {
    pending += chunk;
    let i;
    while ((i = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, i);
      pending = pending.slice(i + 1);
      try {
        const e = JSON.parse(line);
        if (e.connection) void connection(ctx2, e.connection);
      } catch {
      }
    }
  });
  await writePort(ctx2).catch((e) => ctx2.log.warn("workflow MCP port file", errMsg(e)));
  return listener;
}
async function connection(ctx2, handle) {
  const c = { token: null, buffer: "", peer: null };
  connections.set(handle, c);
  await ctx2.host.streams.listen(handle, {}, (chunk) => {
    if (c.peer) {
      c.peer.feed(chunk);
      return;
    }
    c.buffer += chunk;
    const i = c.buffer.indexOf("\n");
    if (i < 0) {
      if (c.buffer.length > 4096) void ctx2.host.net.close(handle);
      return;
    }
    let token;
    try {
      token = JSON.parse(c.buffer.slice(0, i)).token;
    } catch {
    }
    if (typeof token !== "string" || !scopes.has(token)) {
      void ctx2.host.net.close(handle);
      return;
    }
    c.token = token;
    c.peer = new JsonRpcPeer((line) => ctx2.host.net.write(handle, line + "\n"));
    c.peer.onRequest = async (method, params) => {
      const s = scopes.get(c.token);
      if (!s) throw rpcError(-32001, "Workflow MCP access revoked");
      if (method === "initialize") return { protocolVersion: ["2024-11-05", "2025-03-26", "2025-06-18"].includes(params?.protocolVersion) ? params.protocolVersion : "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "hato-workflow", version: "0.1.0" } };
      if (method === "ping") return {};
      if (method === "tools/list") return { tools: handler.list(s) };
      if (method === "tools/call") {
        try {
          const value = await handler.call(s, String(params?.name || ""), params?.arguments || {});
          return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }] };
        } catch (e) {
          return { content: [{ type: "text", text: errMsg(e) }], isError: true };
        }
      }
      throw rpcError(-32601, "Unknown MCP method");
    };
    const rest = c.buffer.slice(i + 1);
    c.buffer = "";
    if (rest) c.peer.feed(rest);
  }, () => {
    connections.delete(handle);
    void ctx2.host.net.close(handle).catch(() => {
    });
  });
}
async function issueEndpoint(ctx2, scope) {
  const token = crypto.randomUUID() + crypto.randomUUID();
  const s = { ...scope, token };
  scopes.set(token, s);
  await ctx2.host.db.exec(db, "INSERT INTO scopes(token,data) VALUES(?,?)", [token, JSON.stringify(s)]);
  const l = await listen(ctx2);
  return { id: "hato-workflow", name: "hato-workflow", command: "node", args: ["-e", proxy], env: [{ name: "HATO_MCP_PORT", value: String(l.port) }, ...portDir && portWritten ? [{ name: "HATO_MCP_PORT_FILE", value: `${portDir.replace(/\/$/, "")}/${PORT_FILE}` }] : [], { name: "HATO_MCP_TOKEN", value: token }] };
}
async function revokeWhere(ctx2, match) {
  for (const [t, s] of [...scopes]) if (match(s)) {
    scopes.delete(t);
    await ctx2.host.db.exec(db, "DELETE FROM scopes WHERE token=?", [t]);
    for (const [h, c] of connections) if (c.token === t) await ctx2.host.net.close(h).catch(() => {
    });
  }
}

// modules/services/workflow-runner/src/triggers.ts
var activePorts = /* @__PURE__ */ new Map();
var activeUnixSockets = /* @__PURE__ */ new Map();
var HTTP_STATUS_TEXT = {
  200: "OK",
  201: "Created",
  202: "Accepted",
  204: "No Content",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  413: "Payload Too Large",
  431: "Request Header Fields Too Large",
  500: "Internal Server Error",
  503: "Service Unavailable"
};
function httpResponse(status, body, contentType) {
  const statusText = HTTP_STATUS_TEXT[status] || "OK";
  const trimmed = body.trim();
  const type = contentType || (trimmed.startsWith("{") || trimmed.startsWith("[") ? "application/json; charset=utf-8" : "text/plain; charset=utf-8");
  const bytes = new TextEncoder().encode(body).length;
  return `HTTP/1.1 ${status} ${statusText}\r
Content-Type: ${type}\r
Content-Length: ${bytes}\r
Connection: close\r
\r
${body}`;
}
function parseQuery(queryStr) {
  const query = {};
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
var READY_TIMEOUT_MS = 5e3;
var UNIX_SOCKET_HELPER = `
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
var FIFO_PIPE_HELPER = `
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
async function armHttpTrigger(ctx2, x, b, onFire) {
  const t = b.trigger || {};
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
  const listener2 = await ctx2.host.net.listenLoopback({ port: requestedPort });
  if (requestedPort !== 0 && activePorts.has(listener2.port) && activePorts.get(listener2.port) !== ownerKey) {
    await ctx2.host.net.close(listener2.handle).catch(() => {
    });
    throw new Error(`EADDRINUSE: port ${listener2.port} is already in use`);
  }
  activePorts.set(listener2.port, ownerKey);
  let closed = false;
  let pending = "";
  const conns = /* @__PURE__ */ new Map();
  const closeConn = async (connHandle) => {
    const sub = conns.get(connHandle);
    conns.delete(connHandle);
    await sub?.close().catch(() => {
    });
    await ctx2.host.net.close(connHandle).catch(() => {
    });
  };
  const handleConn = async (connHandle) => {
    if (closed) {
      await ctx2.host.net.close(connHandle).catch(() => {
      });
      return;
    }
    let buf = "";
    let handled = false;
    const processBuffer = async (ended) => {
      if (handled || closed) return;
      let sep = buf.indexOf("\r\n\r\n"), sepLen = 4;
      if (sep < 0) {
        sep = buf.indexOf("\n\n");
        sepLen = 2;
      }
      if (sep < 0) {
        if (buf.length > 65536) {
          handled = true;
          await ctx2.host.net.write(connHandle, httpResponse(431, "Request Header Fields Too Large")).catch(() => {
          });
          await closeConn(connHandle);
          return;
        }
        if (!ended || !buf.trim()) return;
        sep = buf.length;
        sepLen = 0;
      }
      const rawHead = buf.slice(0, sep);
      const rawBody = buf.slice(sep + sepLen);
      const lines = rawHead.split(/\r?\n/);
      const reqMatch = lines[0]?.trim().match(/^([A-Za-z]+)\s+(\S+)(?:\s+HTTP\/[\d.]+)?$/);
      if (!reqMatch) {
        handled = true;
        await ctx2.host.net.write(connHandle, httpResponse(400, "Bad Request")).catch(() => {
        });
        await closeConn(connHandle);
        return;
      }
      const headers = {};
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
        if (bodyBytes > 512e3) {
          handled = true;
          await ctx2.host.net.write(connHandle, httpResponse(413, "Payload Too Large")).catch(() => {
          });
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
      const pathMatches = !rawPath || rawPath === "/*" ? true : matchPath.endsWith("/*") ? pathname === matchPath.slice(0, -2) || pathname.startsWith(matchPath.slice(0, -1)) : pathname === matchPath;
      if (!pathMatches) {
        await ctx2.host.net.write(connHandle, httpResponse(404, "Not Found")).catch(() => {
        });
        await closeConn(connHandle);
        return;
      }
      if (method !== "ANY" && method !== "*" && reqMethod !== method) {
        await ctx2.host.net.write(connHandle, httpResponse(405, "Method Not Allowed")).catch(() => {
        });
        await closeConn(connHandle);
        return;
      }
      if (t.secret) {
        const auth = headers["authorization"] || "";
        const token = headers["x-hato-token"] || (auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : auth);
        if (token !== t.secret) {
          await ctx2.host.net.write(connHandle, httpResponse(401, "Unauthorized")).catch(() => {
          });
          await closeConn(connHandle);
          return;
        }
      }
      const bodySlice = Number.isFinite(contentLen) && contentLen >= 0 ? rawBody.slice(0, contentLen) : rawBody;
      let parsedBody = bodySlice;
      if (bodySlice.trim()) {
        try {
          parsedBody = JSON.parse(bodySlice);
        } catch {
        }
      }
      const query = parseQuery(queryStr);
      const event = {
        trigger: "http",
        method: reqMethod,
        path: pathname,
        ...Object.keys(query).length ? { query } : {},
        headers,
        body: parsedBody,
        rawBody: bodySlice
      };
      const jsonPayload = JSON.stringify(event);
      const accepted = onFire(jsonPayload, bodySlice || jsonPayload) !== false;
      const respBody = !accepted ? JSON.stringify({ ok: false, error: "Workflow is busy; the trigger queue is full" }) : t.responseBody !== void 0 && t.responseBody !== "" ? t.responseBody : JSON.stringify({ ok: true, blockId: b.id, runId: x.run.id });
      await ctx2.host.net.write(connHandle, httpResponse(accepted ? statusCode : 503, respBody)).catch(() => {
      });
      await closeConn(connHandle);
    };
    const sub = await ctx2.host.streams.listen(
      connHandle,
      {},
      (chunk) => {
        buf += chunk;
        void processBuffer(false);
      },
      () => {
        void processBuffer(true).finally(() => closeConn(connHandle));
      }
    );
    conns.set(connHandle, sub);
  };
  let listenerSub = null;
  try {
    listenerSub = await ctx2.host.streams.listen(listener2.handle, {}, (chunk) => {
      if (closed) return;
      pending += chunk;
      let i;
      while ((i = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, i);
        pending = pending.slice(i + 1);
        try {
          const e = JSON.parse(line);
          if (e.connection) void handleConn(String(e.connection));
        } catch {
        }
      }
    });
  } catch (e) {
    activePorts.delete(listener2.port);
    await ctx2.host.net.close(listener2.handle).catch(() => {
    });
    throw e;
  }
  const endpoint = `http://127.0.0.1:${listener2.port}${matchPath}`;
  return {
    blockId: b.id,
    type: "http_trigger",
    endpoint,
    port: listener2.port,
    path: matchPath,
    async disarm() {
      if (closed) return;
      closed = true;
      if (activePorts.get(listener2.port) === ownerKey) activePorts.delete(listener2.port);
      await listenerSub?.close().catch(() => {
      });
      for (const h of [...conns.keys()]) await closeConn(h);
      await ctx2.host.net.close(listener2.handle).catch(() => {
      });
    }
  };
}
async function armSocketTrigger(ctx2, x, b, onFire) {
  const t = b.trigger || {};
  const protocol = t.protocol || (t.path && !t.port ? "unix" : "tcp");
  const framing = t.framing || "line";
  const ownerKey = `${x.run.id}:${b.id}`;
  if (protocol === "unix") {
    const rawPath = (t.path || "").trim();
    if (!rawPath) throw new Error(`Socket Trigger '${b.label}' needs a Unix socket path`);
    if (rawPath.split("/").includes("..")) throw new Error(`Socket Trigger '${b.label}' path cannot contain '..'`);
    const resolvedPath = rawPath.startsWith("/") ? rawPath : `${x.env.root.replace(/\/$/, "")}/${rawPath}`;
    if (activeUnixSockets.has(resolvedPath) && activeUnixSockets.get(resolvedPath) !== ownerKey) {
      throw new Error(`EADDRINUSE: Unix socket '${rawPath}' is already in use`);
    }
    const grant = await ctx2.host.capabilities.request({ kind: "process", root: x.env.root, target: { kind: "local" } });
    let handle;
    try {
      handle = (await ctx2.host.process.spawn(grant.grant, {
        target: { kind: "local" },
        executable: "node",
        args: ["-e", UNIX_SOCKET_HELPER, resolvedPath, framing, t.responseBody || ""],
        cwd: x.env.root,
        env: { TERM: "dumb" }
      })).handle;
    } finally {
      await ctx2.host.capabilities.release(grant.grant).catch(() => {
      });
    }
    let closed2 = false;
    let outBuf = "";
    let errBuf = "";
    let readyResolve = null;
    let readyReject = null;
    const readyPromise = new Promise((res, rej) => {
      readyResolve = res;
      readyReject = rej;
    });
    const outSub = await ctx2.host.streams.listen(handle, { channel: "stdout" }, (chunk) => {
      if (closed2) return;
      outBuf += chunk;
      let i;
      while ((i = outBuf.indexOf("\n")) >= 0) {
        const line = outBuf.slice(0, i).replace(/\r$/, "");
        outBuf = outBuf.slice(i + 1);
        if (line === "ready") {
          readyResolve?.();
          readyResolve = null;
          readyReject = null;
          continue;
        }
        if (line.startsWith("data ")) {
          try {
            const payload = String(JSON.parse(line.slice(5)));
            onFire(payload, payload);
          } catch {
          }
        } else if (line) {
          onFire(line, line);
        }
      }
    });
    const errSub = await ctx2.host.streams.listen(handle, { channel: "stderr" }, (chunk) => {
      errBuf = (errBuf + chunk).slice(-8e3);
      if (readyReject && /EADDRINUSE|ENOENT|EACCES|EPERM|Error/i.test(errBuf)) {
        const rej = readyReject;
        readyReject = null;
        readyResolve = null;
        rej(new Error(errBuf.trim()));
      }
    });
    const timeout = setTimeout(() => {
      readyReject?.(new Error(`Unix socket helper did not start${errBuf.trim() ? `: ${errBuf.trim()}` : ""}`));
      readyResolve = null;
      readyReject = null;
    }, READY_TIMEOUT_MS);
    try {
      await readyPromise;
    } catch (e) {
      clearTimeout(timeout);
      closed2 = true;
      await outSub.close().catch(() => {
      });
      await errSub.close().catch(() => {
      });
      await ctx2.host.process.terminate(handle, "SIGKILL").catch(() => {
      });
      await ctx2.host.resources.release(handle).catch(() => {
      });
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
        if (closed2) return;
        closed2 = true;
        if (activeUnixSockets.get(resolvedPath) === ownerKey) activeUnixSockets.delete(resolvedPath);
        await outSub.close().catch(() => {
        });
        await errSub.close().catch(() => {
        });
        await ctx2.host.process.terminate(handle, "SIGTERM").catch(() => {
        });
        await ctx2.host.resources.release(handle).catch(() => {
        });
      }
    };
  }
  const requestedPort = t.port ?? 0;
  if (requestedPort !== 0 && (!Number.isInteger(requestedPort) || requestedPort < 1024 || requestedPort > 65535)) {
    throw new Error(`Socket Trigger '${b.label}' port must be 0 (auto) or 1024–65535`);
  }
  if (requestedPort !== 0 && activePorts.has(requestedPort) && activePorts.get(requestedPort) !== ownerKey) {
    throw new Error(`EADDRINUSE: port ${requestedPort} is already in use`);
  }
  const listener2 = await ctx2.host.net.listenLoopback({ port: requestedPort });
  if (requestedPort !== 0 && activePorts.has(listener2.port) && activePorts.get(listener2.port) !== ownerKey) {
    await ctx2.host.net.close(listener2.handle).catch(() => {
    });
    throw new Error(`EADDRINUSE: port ${listener2.port} is already in use`);
  }
  activePorts.set(listener2.port, ownerKey);
  let closed = false;
  let pending = "";
  const conns = /* @__PURE__ */ new Map();
  const closeConn = async (connHandle) => {
    const sub = conns.get(connHandle);
    conns.delete(connHandle);
    await sub?.close().catch(() => {
    });
    await ctx2.host.net.close(connHandle).catch(() => {
    });
  };
  const handleConn = async (connHandle) => {
    if (closed) {
      await ctx2.host.net.close(connHandle).catch(() => {
      });
      return;
    }
    let buf = "";
    const deliver = async (msg) => {
      if (closed || !msg) return;
      if (onFire(msg, msg) === false) return;
      if (t.responseBody) {
        const reply = t.responseBody.endsWith("\n") ? t.responseBody : `${t.responseBody}
`;
        await ctx2.host.net.write(connHandle, reply).catch(() => {
        });
      }
    };
    const sub = await ctx2.host.streams.listen(
      connHandle,
      {},
      (chunk) => {
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
      }
    );
    conns.set(connHandle, sub);
  };
  let listenerSub = null;
  try {
    listenerSub = await ctx2.host.streams.listen(listener2.handle, {}, (chunk) => {
      if (closed) return;
      pending += chunk;
      let i;
      while ((i = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, i);
        pending = pending.slice(i + 1);
        try {
          const e = JSON.parse(line);
          if (e.connection) void handleConn(String(e.connection));
        } catch {
        }
      }
    });
  } catch (e) {
    activePorts.delete(listener2.port);
    await ctx2.host.net.close(listener2.handle).catch(() => {
    });
    throw e;
  }
  return {
    blockId: b.id,
    type: "socket_trigger",
    endpoint: `tcp://127.0.0.1:${listener2.port}`,
    port: listener2.port,
    async disarm() {
      if (closed) return;
      closed = true;
      if (activePorts.get(listener2.port) === ownerKey) activePorts.delete(listener2.port);
      await listenerSub?.close().catch(() => {
      });
      for (const h of [...conns.keys()]) await closeConn(h);
      await ctx2.host.net.close(listener2.handle).catch(() => {
      });
    }
  };
}
async function armFileTrigger(ctx2, x, b, onFire) {
  const t = b.trigger || {};
  const rawPath = (t.path || "").trim();
  if (!rawPath) throw new Error(`File/Pipe Trigger '${b.label}' needs a file or pipe path`);
  if (rawPath.startsWith("/") || rawPath.split("/").includes("..")) {
    throw new Error(`File/Pipe Trigger '${b.label}' path '${rawPath}' must be workspace-relative`);
  }
  const mode = t.mode || "auto";
  const framing = t.framing || "message";
  const createIfMissing = !!t.createIfMissing;
  const grant = await ctx2.host.capabilities.request({ kind: "fs", root: x.env.root, target: { kind: "local" } });
  const quoted = `'${rawPath.replace(/'/g, `'\\''`)}'`;
  const create = async (command, what) => {
    const mk = await runScript(ctx2, x.env.root, `mkdir -p -- "$(dirname -- ${quoted})" && ${command} -- ${quoted}`, "", { timeoutMs: 5e3, track: () => {
    } });
    if (mk.code !== 0) throw new Error(`Cannot create ${what} '${rawPath}': ${(mk.stderr || mk.stdout).trim() || `exit ${mk.code}`}`);
  };
  let stat;
  try {
    if (typeof ctx2.host.fs.stat === "function") {
      stat = await ctx2.host.fs.stat(grant.grant, rawPath);
    } else {
      const r = await ctx2.host.fs.read(grant.grant, rawPath, 256 * 1024);
      stat = { kind: "file", size: r.size ?? (r.text?.length || 0), mtime: null, text: r.text };
    }
  } catch (e) {
    if (!createIfMissing) {
      await ctx2.host.capabilities.release(grant.grant).catch(() => {
      });
      throw new Error(`File or pipe '${rawPath}' cannot be armed: ${errMsg(e)}`);
    }
    try {
      if (mode === "pipe") await create("mkfifo", "named pipe");
      else await create("touch", "file");
      stat = await ctx2.host.fs.stat(grant.grant, rawPath);
    } catch (createErr) {
      await ctx2.host.capabilities.release(grant.grant).catch(() => {
      });
      throw createErr instanceof Error && createErr.message.startsWith("Cannot create") ? createErr : new Error(`Cannot create '${rawPath}': ${errMsg(createErr)}`);
    }
  }
  if (stat?.kind === "dir") {
    await ctx2.host.capabilities.release(grant.grant).catch(() => {
    });
    throw new Error(`'${rawPath}' is a directory; File/Pipe Trigger requires a file or named pipe`);
  }
  if (mode === "file" && stat?.kind && stat.kind !== "file") {
    await ctx2.host.capabilities.release(grant.grant).catch(() => {
    });
    throw new Error(`'${rawPath}' is not a regular file`);
  }
  if (mode === "pipe" && stat?.kind === "file") {
    await ctx2.host.capabilities.release(grant.grant).catch(() => {
    });
    throw new Error(`'${rawPath}' is a regular file, not a named pipe (FIFO)`);
  }
  const isPipe = mode === "pipe" || mode === "auto" && stat?.kind === "other";
  if (isPipe) {
    await ctx2.host.capabilities.release(grant.grant).catch(() => {
    });
    const resolvedPipe = `${x.env.root.replace(/\/$/, "")}/${rawPath}`;
    const procGrant = await ctx2.host.capabilities.request({ kind: "process", root: x.env.root, target: { kind: "local" } });
    let handle;
    try {
      handle = (await ctx2.host.process.spawn(procGrant.grant, {
        target: { kind: "local" },
        executable: "node",
        args: ["-e", FIFO_PIPE_HELPER, resolvedPipe, framing],
        cwd: x.env.root,
        env: { TERM: "dumb" }
      })).handle;
    } finally {
      await ctx2.host.capabilities.release(procGrant.grant).catch(() => {
      });
    }
    let closed2 = false;
    let outBuf = "";
    let errBuf = "";
    let readyResolve = null;
    let readyReject = null;
    const readyPromise = new Promise((res, rej) => {
      readyResolve = res;
      readyReject = rej;
    });
    const outSub = await ctx2.host.streams.listen(handle, { channel: "stdout" }, (chunk) => {
      if (closed2) return;
      outBuf += chunk;
      let i;
      while ((i = outBuf.indexOf("\n")) >= 0) {
        const line = outBuf.slice(0, i).replace(/\r$/, "");
        outBuf = outBuf.slice(i + 1);
        if (line === "ready") {
          readyResolve?.();
          readyResolve = null;
          readyReject = null;
          continue;
        }
        if (line.startsWith("data ")) {
          try {
            const payload = String(JSON.parse(line.slice(5)));
            onFire(payload, payload);
          } catch {
          }
        } else if (line) {
          onFire(line, line);
        }
      }
    });
    const errSub = await ctx2.host.streams.listen(handle, { channel: "stderr" }, (chunk) => {
      errBuf = (errBuf + chunk).slice(-8e3);
      if (readyReject && errBuf.trim()) {
        const rej = readyReject;
        readyReject = null;
        readyResolve = null;
        rej(new Error(errBuf.trim()));
      }
    });
    const timeout = setTimeout(() => {
      readyReject?.(new Error(`Pipe reader did not start${errBuf.trim() ? `: ${errBuf.trim()}` : ""}`));
      readyResolve = null;
      readyReject = null;
    }, READY_TIMEOUT_MS);
    try {
      await readyPromise;
    } catch (e) {
      clearTimeout(timeout);
      closed2 = true;
      await outSub.close().catch(() => {
      });
      await errSub.close().catch(() => {
      });
      await ctx2.host.process.terminate(handle, "SIGKILL").catch(() => {
      });
      await ctx2.host.resources.release(handle).catch(() => {
      });
      throw e;
    }
    clearTimeout(timeout);
    return {
      blockId: b.id,
      type: "file_trigger",
      endpoint: `pipe:${rawPath}`,
      path: rawPath,
      async disarm() {
        if (closed2) return;
        closed2 = true;
        await outSub.close().catch(() => {
        });
        await errSub.close().catch(() => {
        });
        await ctx2.host.process.terminate(handle, "SIGKILL").catch(() => {
        });
        await ctx2.host.resources.release(handle).catch(() => {
        });
      }
    };
  }
  let lastText = "";
  try {
    if (stat?.text !== void 0) {
      lastText = stat.text;
    } else {
      const initial = await ctx2.host.fs.read(grant.grant, rawPath, 256 * 1024);
      lastText = initial.text ?? initial.base64 ?? "";
    }
  } catch (e) {
    await ctx2.host.capabilities.release(grant.grant).catch(() => {
    });
    throw new Error(`Cannot read file '${rawPath}': ${errMsg(e)}`);
  }
  if (typeof ctx2.host.fs.watch !== "function") {
    await ctx2.host.capabilities.release(grant.grant).catch(() => {
    });
    throw new Error(`File watching is not available for '${rawPath}'`);
  }
  let watchHandle;
  try {
    watchHandle = (await ctx2.host.fs.watch(grant.grant, rawPath, { recursive: false })).handle;
  } catch (e) {
    await ctx2.host.capabilities.release(grant.grant).catch(() => {
    });
    throw new Error(`Cannot watch file '${rawPath}': ${errMsg(e)}`);
  }
  let closed = false;
  let watchBuf = "";
  let reading = false;
  let pendingRead = false;
  const checkFileChange = async () => {
    if (closed) return;
    if (reading) {
      pendingRead = true;
      return;
    }
    reading = true;
    try {
      do {
        pendingRead = false;
        const current = await ctx2.host.fs.read(grant.grant, rawPath, 256 * 1024);
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
    } finally {
      reading = false;
    }
  };
  let sub = null;
  try {
    sub = await ctx2.host.streams.listen(watchHandle, { channel: "stdout" }, (chunk) => {
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
    await ctx2.host.resources.release(watchHandle).catch(() => {
    });
    await ctx2.host.capabilities.release(grant.grant).catch(() => {
    });
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
      await sub?.close().catch(() => {
      });
      await ctx2.host.resources.release(watchHandle).catch(() => {
      });
      await ctx2.host.capabilities.release(grant.grant).catch(() => {
      });
    }
  };
}
function applyTriggerPatch(b, patch) {
  const next = normalizeTriggerConfig({ ...b.trigger || {}, ...patch }) || {};
  b.trigger = next;
  if (typeof patch?.prompt === "string") b.prompt = patch.prompt.slice(0, 2e5);
  return next;
}
function renderTriggerOutput(x, b, rawOutput, templateInput) {
  return b.prompt.trim() ? renderPrompt(b.prompt, templateInput, x.outputs) : rawOutput;
}

// modules/services/workflow-runner/src/engine.ts
var ctx;
var persist;
var trackAutonomousClaudeTurns = true;
var execs = /* @__PURE__ */ new Map();
function initEngine(c, save2) {
  ctx = c;
  persist = save2;
}
function setAutonomousClaudeTurns(enabled) {
  trackAutonomousClaudeTurns = enabled;
}
var now2 = () => (/* @__PURE__ */ new Date()).toISOString();
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
var block = (x, id) => {
  const b = x.def.blocks.find((b2) => b2.id === id);
  if (!b) throw new Error(`Unknown block '${id}'`);
  return b;
};
var stateOf = (x, id) => {
  let s = x.run.blocks.find((s2) => s2.blockId === id);
  if (!s) {
    s = { blockId: id, status: "idle", runs: 0, log: [] };
    x.run.blocks.push(s);
  }
  return s;
};
var outputLimit = (x) => x.def.settings?.outputLimitChars ?? 2e5;
function log(s, kind, text) {
  s.log.push({ at: now2(), kind, text: text.length > 4e3 ? text.slice(0, 4e3) + "…" : text });
  if (s.log.length > 200) s.log.splice(0, s.log.length - 200);
}
function touch(x) {
  publishMeetingStatusChanges(x);
  if (x.run.status === "running" || x.run.status === "waiting") {
    const active = x.run.blocks.some((s) => s.status === "running");
    const paused = x.run.blocks.some((s) => ["awaiting_user_input", "awaiting_permission", "waiting_timer", "waiting_trigger", "waiting_input"].includes(s.status));
    x.run.status = active ? "running" : paused ? "waiting" : "running";
  }
  persist(x.run);
}
function transfer(x, edgeId, phase, payload, callId = crypto.randomUUID(), action, error = false) {
  var _a;
  const events = (_a = x.run).transfers ?? (_a.transfers = []);
  const text = typeof payload === "string" ? payload : JSON.stringify(payload) || "";
  events.push({ seq: (events[events.length - 1]?.seq ?? 0) + 1, callId, edgeId, phase, at: now2(), action, chars: text.length, ...error ? { error: true } : {} });
  if (events.length > 1e3) events.splice(0, events.length - 1e3);
  touch(x);
  return callId;
}
function recordMcpActivity(x, callerId, sessionId, u) {
  if (stateOf(x, callerId).sessionId !== sessionId || !u.toolCallId) return;
  const key2 = `${sessionId}:${u.toolCallId}`;
  let call = x.mcpCalls.get(key2);
  if (!call) {
    const raw = u.rawInput || {};
    const server = raw.server || raw.server_name || raw.mcpServer || u._meta?.mcpServer;
    const title = String(u.title || raw.tool || raw.name || "");
    const names = [u.title, raw.tool, raw.name].filter((name) => typeof name === "string");
    const candidates = toolTargets(x, callerId).filter((b) => b.type === "mcp").filter((b) => {
      const config = x.env.mcpServers.find((m) => m.id === capabilityMcpServer(b));
      return config && [config.id, config.name].some((name) => server === name || names.some((tool) => tool.startsWith(`mcp__${name}__`) || tool.startsWith(`mcp.${name}.`)));
    });
    if (candidates.length !== 1) return;
    const target = candidates[0];
    const edge = x.def.edges.find((e) => e.from === callerId && e.to === target.id && edgeType(e) === "use") || x.def.edges.find((e) => e.from === callerId && e.to === target.id && block(x, callerId).type === "chatbox");
    if (!edge) return;
    const callId = transfer(x, edge.id, "send", raw.arguments || raw, void 0, title);
    call = { blockId: target.id, edgeId: edge.id, callId, title: title || String(raw.tool || "MCP tool"), status: "" };
    x.mcpCalls.set(key2, call);
    const st2 = stateOf(x, target.id);
    st2.runs++;
    st2.startedAt = now2();
    st2.completedAt = void 0;
    st2.error = void 0;
    log(st2, "tool", `${callerId} · ${call.title} · ${callId}
${preview(JSON.stringify(raw.arguments || raw), 3e3)}`);
  }
  const status = String(u.status || "in_progress");
  if (call.status === status || ["completed", "failed"].includes(call.status)) return;
  call.status = status;
  const st = stateOf(x, call.blockId);
  if (["completed", "failed"].includes(status)) {
    const result = (u.content || []).map((item) => item.content?.text || item.text || "").join("\n");
    log(st, status === "failed" ? "error" : "response", `${call.title} · ${status} · ${call.callId}
${result}`);
    transfer(x, call.edgeId, "return", result, call.callId, call.title, status === "failed");
    if (status === "failed") st.error = preview(result || `${call.title} failed`, 1e3);
    st.completedAt = now2();
  }
  const pending = [...x.mcpCalls.values()].some((c) => c.blockId === call.blockId && !["completed", "failed"].includes(c.status));
  st.status = pending ? "running" : st.error ? "failed" : "succeeded";
  if (x.mcpCalls.size > 200) for (const [id, old] of x.mcpCalls) {
    if (x.mcpCalls.size <= 200) break;
    if (["completed", "failed"].includes(old.status)) x.mcpCalls.delete(id);
  }
  touch(x);
}
function assertActive(x) {
  if (x.cancelled) throw new Error("Workflow run was cancelled");
}
function newExec(run, env) {
  const x = {
    run,
    env,
    def: run.definition,
    mcpCalls: /* @__PURE__ */ new Map(),
    outputs: /* @__PURE__ */ new Map(),
    busy: /* @__PURE__ */ new Set(),
    timers: /* @__PURE__ */ new Map(),
    delays: /* @__PURE__ */ new Map(),
    triggers: /* @__PURE__ */ new Map(),
    triggerWaiters: /* @__PURE__ */ new Map(),
    queues: /* @__PURE__ */ new Map(),
    inputs: /* @__PURE__ */ new Set(),
    answers: /* @__PURE__ */ new Map(),
    background: /* @__PURE__ */ new Set(),
    mcpUpdateErrors: /* @__PURE__ */ new Map(),
    queuedPrompts: /* @__PURE__ */ new Map(),
    providerTurns: /* @__PURE__ */ new Map(),
    pendingProviderEvents: /* @__PURE__ */ new Map(),
    loops: /* @__PURE__ */ new Map(),
    steps: 0,
    joins: /* @__PURE__ */ new Map(),
    fetched: /* @__PURE__ */ new Map(),
    meetingWaiters: /* @__PURE__ */ new Map(),
    participantStatuses: new Map(run.blocks.map((s) => [s.blockId, s.status])),
    procs: /* @__PURE__ */ new Set(),
    cancelled: false,
    driving: false
  };
  for (const s of run.blocks) if (s.output !== void 0) x.outputs.set(s.blockId, s.output);
  execs.set(run.id, x);
  return x;
}
var flowEdge = (e) => edgeType(e) !== "use";
var joinEdge = (e) => edgeType(e) !== "use" && edgeType(e) !== "queue";
function reaches2(x, from, to) {
  const seen = /* @__PURE__ */ new Set(), stack = [from];
  while (stack.length) {
    const c = stack.pop();
    if (c === to) return true;
    if (seen.has(c)) continue;
    seen.add(c);
    for (const e of x.def.edges) if (e.from === c && flowEdge(e)) stack.push(e.to);
  }
  return false;
}
var forwardEdge = (x, e) => !e.loop && flowEdge(e) && !reaches2(x, e.to, e.from);
var flowDriven = (x, id) => defaultRoots(x).some((r) => r === id || reaches2(x, r, id));
function toolTargets(x, callerId) {
  const caller = block(x, callerId);
  const ids = x.def.edges.filter((e) => e.from === callerId && (edgeType(e) === "use" || caller.type === "chatbox")).map((e) => e.to);
  return [...new Set(ids)].map((id) => block(x, id));
}
function joinInput(x, target, active, outputs) {
  return active.map((e) => `## ${block(x, e.from).label} (${e.from})
${preview(outputs.get(e.from) ?? "", Math.floor(2e4 / active.length))}`).join("\n\n");
}
function resolveEdge(x, e, active, output, path, visited = /* @__PURE__ */ new Set()) {
  if (active) transfer(x, e.id, "flow", output);
  const target = e.to;
  const incoming = x.def.edges.filter((i) => i.to === target && joinEdge(i) && forwardEdge(x, i) && flowDriven(x, i.from));
  const outgoing = () => x.def.edges.filter((o) => o.from === target && joinEdge(o) && forwardEdge(x, o));
  if (incoming.length < 2) {
    if (active) return [invoke(x, target, output, path)];
    if (visited.has(target)) return [];
    visited.add(target);
    return outgoing().flatMap((n) => resolveEdge(x, n, false, "", [...path, target], visited));
  }
  let entry = x.joins.get(target);
  if (!entry) {
    entry = { resolved: /* @__PURE__ */ new Set(), active: /* @__PURE__ */ new Set(), outputs: /* @__PURE__ */ new Map(), fired: false };
    x.joins.set(target, entry);
  }
  entry.resolved.add(e.id);
  if (active) {
    entry.active.add(e.id);
    entry.outputs.set(e.from, output);
  }
  const complete = incoming.every((i) => entry.resolved.has(i.id));
  const results = [];
  if (!entry.fired && entry.active.size > 0 && (complete || block(x, target).join === "any")) {
    entry.fired = true;
    const activeEdges = incoming.filter((i) => entry.active.has(i.id));
    const input = activeEdges.length === 1 ? entry.outputs.get(activeEdges[0].from) : joinInput(x, target, activeEdges, entry.outputs);
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
async function invoke(x, id, input, ancestors = [], viaTool = false, images) {
  assertActive(x);
  if (x.busy.has(id)) throw new Error("This block is already active; recursive or concurrent calls are not allowed");
  if (++x.steps > (x.def.settings?.maxSteps ?? 1e3)) throw new Error("Workflow exceeded its block execution limit");
  const b = block(x, id), s = stateOf(x, id);
  x.busy.add(id);
  Object.assign(s, { status: "running", startedAt: now2(), completedAt: void 0, error: void 0, selectedRoute: void 0, input: preview(input, 2e4), runs: s.runs + 1 });
  touch(x);
  let output = input;
  try {
    const rendered = () => renderPrompt(b.prompt, input, x.outputs);
    switch (b.type) {
      case "start_button":
      case "text":
        output = rendered();
        break;
      case "start_input":
        output = input;
        break;
      case "markdown":
        output = b.prompt.trim() ? rendered() : input;
        break;
      case "skill":
        output = b.skillId ? await loadSkill(x, b) : rendered();
        break;
      case "meeting":
        output = JSON.stringify(meetingTail(s, 20));
        break;
      case "terminal_control":
      case "task_controls":
      case "mcp":
      case "browser":
        output = `${b.label} adds tools to connected agents.`;
        break;
      case "script":
        output = await script(x, b, s, input);
        break;
      case "run_app":
        output = JSON.stringify(await appAction(ctx, x.env.root, b.app.name, b.command || "", b.app?.action || "start", b.app?.lines || 100));
        break;
      case "text_input":
        output = b.prompt.trim() ? rendered() : input;
        break;
      case "http_trigger":
      case "socket_trigger":
      case "file_trigger": {
        const armed = await armTrigger(x, b);
        return JSON.stringify({ armed: true, endpoint: armed.endpoint });
      }
      case "timer": {
        armTimer(x, b, s, input);
        x.busy.delete(id);
        return `Timer armed for ${s.waitingUntil}`;
      }
      case "user_prompt":
      case "yes_no_prompt": {
        const question = rendered().trim() || input;
        let answer2 = await ask(x, b, s, question);
        if (b.type === "yes_no_prompt") {
          answer2 = /^(y|yes|true)$/i.test(answer2.trim()) ? "yes" : "no";
          s.selectedRoute = answer2;
        }
        output = answer2;
        break;
      }
      case "ai":
      case "chatbox":
        output = await agent(x, b, s, input, images);
        break;
      default:
        throw new Error(`Unsupported block type '${b.type}'`);
    }
    assertActive(x);
    completeBlock(x, s, output);
  } catch (e) {
    const message = errMsg(e);
    Object.assign(s, { status: x.cancelled ? "cancelled" : "failed", error: message, completedAt: now2(), question: void 0, pauseId: void 0, permissionId: void 0 });
    log(s, "error", message);
    if (!viaTool && !x.cancelled) x.flowFailed ?? (x.flowFailed = `${b.label}: ${message}`);
    touch(x);
    throw e;
  } finally {
    releaseBlock(x, id);
  }
  if (b.type !== "chatbox") await followers(x, b, s, output, ancestors);
  return output;
}
function completeBlock(x, s, output) {
  log(s, "response", output);
  s.output = output.slice(-outputLimit(x));
  x.outputs.set(s.blockId, output);
  Object.assign(s, { status: "succeeded", completedAt: now2(), question: void 0, pauseId: void 0, permissionId: void 0 });
  touch(x);
}
function releaseBlock(x, id) {
  x.busy.delete(id);
  const pending = x.pendingProviderEvents.get(id);
  x.pendingProviderEvents.delete(id);
  for (const event of pending ?? []) recordProviderTurn(x, event);
  if (x.busy.has(id)) return;
  const queued = x.queuedPrompts.get(id);
  x.queuedPrompts.delete(id);
  if (queued?.length && !x.cancelled && x.def.blocks.some((b) => b.id === id)) {
    track(x, invoke(x, id, queued.join("\n\n"), [], true));
  }
  drainQueue(x, id);
}
var DEFAULT_QUEUE_LIMIT = 100;
var queueLimit = (e) => Math.min(Math.max(e.queueLimit ?? DEFAULT_QUEUE_LIMIT, 1), 1e4);
var waitingOn = (x, e) => (x.queues.get(e.to) || []).filter((i) => i.edgeId === e.id).length;
function queuesHaveRoom(x, from) {
  return x.def.edges.every((e) => e.from !== from || edgeType(e) !== "queue" || waitingOn(x, e) < queueLimit(e));
}
function setDepth(x, id) {
  const s = x.run.blocks.find((s2) => s2.blockId === id);
  if (!s) return;
  const n = x.queues.get(id)?.length || 0;
  if (n) s.queueDepth = n;
  else delete s.queueDepth;
}
function enqueue(x, e, input, ancestors) {
  const q = x.queues.get(e.to) || [];
  if (!x.busy.has(e.to) && !q.length) {
    transfer(x, e.id, "flow", input);
    return invoke(x, e.to, input, ancestors);
  }
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
function drainQueue(x, id) {
  if (x.cancelled || x.busy.has(id)) return;
  const q = x.queues.get(id), item = q?.shift();
  if (!q || !item) return;
  if (!q.length) x.queues.delete(id);
  setDepth(x, id);
  if (!x.def.blocks.some((b) => b.id === id) || !x.def.edges.some((e) => e.id === item.edgeId)) {
    drainQueue(x, id);
    return;
  }
  transfer(x, item.edgeId, "flow", item.input);
  track(x, invoke(x, id, item.input, item.ancestors).catch(() => {
  }));
}
function recordProviderTurn(x, event) {
  const id = event.workflow.blockId;
  const b = x.def.blocks.find((b2) => b2.id === id && isAgentBlock(b2));
  const s = x.run.blocks.find((b2) => b2.blockId === id);
  if (!s || s.sessionId !== event.sessionId) return;
  const active = x.providerTurns.get(id);
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
      x.run.completedAt = void 0;
    }
    Object.assign(s, {
      status: "running",
      startedAt: now2(),
      completedAt: void 0,
      error: void 0,
      selectedRoute: void 0,
      runs: s.runs + 1
    });
    touch(x);
    return;
  }
  if (active !== event.turnId) return;
  x.providerTurns.delete(id);
  if (x.cancelled || event.state !== "completed") {
    const status = x.cancelled || event.state === "stopped" ? "cancelled" : "failed";
    const error = event.error || (status === "failed" ? "Provider turn failed" : void 0);
    Object.assign(s, { status, error, completedAt: now2(), permissionId: void 0 });
    if (error) log(s, "error", error);
    touch(x);
  } else {
    if (b?.type === "chatbox" && event.output) {
      s.chat = [...s.chat || [], { id: crypto.randomUUID(), role: "assistant", text: event.output, at: now2() }].slice(-200);
    }
    completeBlock(x, s, event.output);
  }
  const completed = s.status === "succeeded";
  releaseBlock(x, id);
  if (b?.type === "ai" && completed) track(x, followers(x, b, s, event.output, []));
  settle(x);
}
async function followers(x, b, s, output, ancestors) {
  const id = b.id, out = x.def.edges.filter((e) => e.from === id && flowEdge(e));
  const pending = [];
  for (const e of out.filter((e2) => edgeType(e2) === "queue")) {
    const started = enqueue(x, e, output, [...ancestors, id]);
    if (started instanceof Promise) pending.push(started);
  }
  for (const e of out.filter((e2) => edgeType(e2) === "path" && e2.label !== s.selectedRoute && forwardEdge(x, e2)))
    pending.push(...resolveEdge(x, e, false, "", [...ancestors, id]));
  for (const e of out.filter((e2) => edgeType(e2) === "follow" || edgeType(e2) === "path" && e2.label === s.selectedRoute)) {
    if (x.busy.has(e.to)) {
      const target = block(x, e.to);
      if (ancestors.includes(e.to) || !isAgentBlock(target) || !stateOf(x, e.to).sessionId) {
        log(s, "lifecycle", `Skipped connection to active block '${target.label}'`);
        continue;
      }
      transfer(x, e.id, "flow", output, void 0, "steer");
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
  const failed = settled.find((r) => r.status === "rejected");
  if (failed) throw failed.reason;
}
async function loadSkill(x, b) {
  const g = await ctx.host.capabilities.request({ kind: "fs", root: x.env.root, target: { kind: "local" } });
  try {
    const file = await ctx.host.fs.read(g.grant, b.skillId, 256 * 1024);
    if (file.binary || file.truncated) throw new Error(`Skill file is binary or too large: ${b.skillId}`);
    const dir = b.skillId.includes("/") ? b.skillId.slice(0, b.skillId.lastIndexOf("/")) : ".";
    return JSON.stringify({ skill: { name: b.label, path: b.skillId, baseDirectory: `${x.env.root.replace(/\/$/, "")}/${dir}`, content: file.text || "" } });
  } finally {
    await ctx.host.capabilities.release(g.grant);
  }
}
async function script(x, b, s, input) {
  log(s, "prompt", input);
  const timeoutMs = Math.min(Math.max((b.timeoutSeconds ?? 1800) * 1e3, 1e3), 864e5);
  let current = null;
  const r = await runScript(ctx, x.env.root, b.command || "", input, { timeoutMs, track: (h) => {
    if (current) x.procs.delete(current);
    current = h;
    if (h) x.procs.add(h);
  } });
  assertActive(x);
  if (r.code !== 0) throw new Error(`Script exited with ${r.code ?? "a signal"}${r.stderr.trim() ? `: ${preview(r.stderr.trim(), 4e3)}` : r.stdout.trim() ? `: ${preview(r.stdout.trim(), 4e3)}` : ""}`);
  return r.stdout + (r.stderr.trim() ? `
[stderr]
${r.stderr}` : "");
}
function armTimer(x, b, s, input) {
  const old = x.timers.get(b.id);
  if (old) clearTimeout(old);
  const override = x.delays.get(b.id);
  x.delays.delete(b.id);
  const ms = Math.max(0, override ?? (b.seconds ?? 0) * 1e3);
  Object.assign(s, { status: "waiting_timer", waitingUntil: new Date(Date.now() + ms).toISOString(), pauseId: crypto.randomUUID() });
  log(s, "lifecycle", `Timer armed for ${s.waitingUntil}`);
  touch(x);
  x.timers.set(b.id, setTimeout(() => {
    x.timers.delete(b.id);
    if (x.cancelled) return;
    x.steps = 0;
    s.output = input;
    x.outputs.set(b.id, input);
    Object.assign(s, { status: "succeeded", completedAt: now2(), waitingUntil: void 0, pauseId: void 0 });
    log(s, "lifecycle", "Timer fired; starting followers");
    touch(x);
    track(x, followers(x, b, s, input, []).catch((e) => {
      x.flowFailed ?? (x.flowFailed = `${b.label}: ${errMsg(e)}`);
    }));
  }, ms));
}
function timerDelay(x, a) {
  const max = x.def.settings?.maxRunDurationMs ?? 24 * 36e5;
  let ms;
  if (a.at !== void 0 && a.at !== null && a.at !== "") {
    const t = Date.parse(String(a.at));
    if (!Number.isFinite(t)) throw new Error("Timer 'at' must be an ISO 8601 date-time");
    ms = t - Date.now();
  } else if (a.seconds !== void 0 && a.seconds !== null && a.seconds !== "") {
    const n = Number(a.seconds);
    if (!Number.isFinite(n) || n < 0) throw new Error("Timer 'seconds' must be a non-negative number");
    ms = n * 1e3;
  }
  if (ms === void 0) return void 0;
  if (ms > max) throw new Error(`Timer delay exceeds the run's maximum duration of ${Math.round(max / 1e3)} seconds`);
  return Math.max(0, ms);
}
function timerAction(x, id, action) {
  const s = stateOf(x, id), armed = x.timers.has(id);
  if (action === "cancel" && armed) {
    clearTimeout(x.timers.get(id));
    x.timers.delete(id);
    Object.assign(s, { status: "cancelled", completedAt: now2(), waitingUntil: void 0, pauseId: void 0 });
    log(s, "lifecycle", "Timer cancelled by an agent");
    touch(x);
    return { status: "cancelled" };
  }
  return { status: armed ? "armed" : s.status, ...armed ? { firesAt: s.waitingUntil } : {} };
}
function openTextInputs(x, blocks = x.def.blocks) {
  for (const b of blocks.filter((b2) => b2.type === "text_input")) {
    const s = stateOf(x, b.id);
    if (b.keepOpen === false) {
      x.inputs.delete(b.id);
      if (s.status === "waiting_input") Object.assign(s, { status: "idle" });
      continue;
    }
    x.inputs.add(b.id);
    if (s.status !== "running") Object.assign(s, { status: "waiting_input", error: void 0, completedAt: void 0 });
  }
  touch(x);
}
function sendText(x, blockId, text) {
  const b = block(x, blockId);
  if (b.type !== "text_input") throw new Error("Only Text Input blocks accept typed text");
  if (x.cancelled) throw new Error("This run was cancelled; start a new run to send text");
  const value = String(text).slice(0, 2e5);
  if (!value.trim()) throw new Error("Text is empty");
  if (x.run.status !== "running" && x.run.status !== "waiting") {
    x.run.status = "running";
    x.run.completedAt = void 0;
    x.run.error = void 0;
    x.flowFailed = void 0;
  }
  const s = stateOf(x, blockId);
  let output = value;
  try {
    if (b.prompt.trim()) output = renderPrompt(b.prompt, value, x.outputs);
  } catch (e) {
    log(s, "error", `Template: ${errMsg(e)}`);
  }
  x.steps = 0;
  s.runs++;
  s.input = preview(value, 2e4);
  s.output = output.slice(-outputLimit(x));
  x.outputs.set(blockId, output);
  log(s, "prompt", value);
  Object.assign(s, { status: b.keepOpen === false ? "succeeded" : "waiting_input", completedAt: now2(), error: void 0 });
  touch(x);
  track(x, followers(x, b, s, output, []).catch((e) => {
    x.flowFailed ?? (x.flowFailed = `${b.label}: ${errMsg(e)}`);
  }));
  return { accepted: true };
}
var TRIGGER_ACTIONS = ["status", "configure", "arm", "start", "disarm", "stop", "cancel", "wait", "fetch"];
async function armTrigger(x, b) {
  assertActive(x);
  await disarmTrigger(x, b.id);
  let fired = 0;
  const arm = b.type === "http_trigger" ? armHttpTrigger : b.type === "socket_trigger" ? armSocketTrigger : armFileTrigger;
  const armed = await arm(ctx, x, b, (raw, templateInput) => {
    const accepted = fireTrigger(x, b.id, raw, templateInput, fired + 1);
    if (accepted) fired++;
    return accepted;
  });
  if (x.cancelled) {
    await armed.disarm().catch(() => {
    });
    throw new Error("Workflow run was cancelled");
  }
  x.triggers.set(b.id, armed);
  const s = stateOf(x, b.id);
  Object.assign(s, { status: "waiting_trigger", triggerEndpoint: armed.endpoint, error: void 0, completedAt: void 0, pauseId: crypto.randomUUID() });
  log(s, "lifecycle", `Trigger armed on ${armed.endpoint}`);
  touch(x);
  return armed;
}
async function disarmTrigger(x, id, status = "cancelled") {
  const armed = x.triggers.get(id);
  if (!armed) return false;
  x.triggers.delete(id);
  await armed.disarm().catch((e) => ctx.log.warn("workflow trigger disarm", errMsg(e)));
  const s = x.run.blocks.find((s2) => s2.blockId === id);
  if (s && s.status === "waiting_trigger") Object.assign(s, { status, completedAt: now2(), triggerEndpoint: void 0, pauseId: void 0 });
  for (const wake of [...x.triggerWaiters.get(id) || []]) wake("");
  touch(x);
  return true;
}
async function releaseAllTriggers(timeoutMs = 3e3) {
  const pending = [];
  for (const x of execs.values()) {
    for (const t of x.timers.values()) clearTimeout(t);
    x.timers.clear();
    for (const [id, armed] of [...x.triggers]) {
      x.triggers.delete(id);
      pending.push(armed.disarm().catch((e) => ctx?.log.warn("workflow trigger release", errMsg(e))));
    }
  }
  if (!pending.length) return 0;
  let timer;
  await Promise.race([Promise.allSettled(pending), new Promise((r) => {
    timer = setTimeout(r, timeoutMs);
  })]).finally(() => clearTimeout(timer));
  return pending.length;
}
async function armTriggers(x) {
  for (const b of x.def.blocks.filter(isTriggerBlock)) {
    try {
      await armTrigger(x, b);
    } catch (e) {
      const message = `Cannot arm trigger '${b.label}': ${errMsg(e)}`;
      const s = stateOf(x, b.id);
      Object.assign(s, { status: "failed", error: message, completedAt: now2(), triggerEndpoint: void 0, pauseId: void 0 });
      log(s, "error", message);
      for (const id of [...x.triggers.keys()]) await disarmTrigger(x, id);
      x.flowFailed ?? (x.flowFailed = message);
      touch(x);
      return message;
    }
  }
  return void 0;
}
function fireTrigger(x, id, raw, templateInput, count) {
  const b = x.def.blocks.find((b2) => b2.id === id);
  if (x.cancelled || !b || !x.triggers.has(id)) return false;
  const s = stateOf(x, id);
  if (!queuesHaveRoom(x, id)) {
    log(s, "error", "Event rejected: a queue connection is full");
    touch(x);
    return false;
  }
  let output = raw;
  try {
    output = renderTriggerOutput(x, b, raw, templateInput);
  } catch (e) {
    log(s, "error", `Trigger template: ${errMsg(e)}`);
  }
  x.steps = 0;
  s.runs++;
  s.input = preview(raw, 2e4);
  s.output = output.slice(-outputLimit(x));
  x.outputs.set(id, output);
  log(s, "response", output);
  const limit = b.trigger?.continuous ? Infinity : Math.max(1, b.trigger?.maxEvents ?? 1);
  for (const wake of [...x.triggerWaiters.get(id) || []]) wake(output);
  if (count >= limit) {
    const armed = x.triggers.get(id);
    x.triggers.delete(id);
    Object.assign(s, { status: "succeeded", completedAt: now2(), triggerEndpoint: void 0, pauseId: void 0 });
    log(s, "lifecycle", `Trigger fired (${count}); disarmed`);
    track(x, armed.disarm());
  } else {
    s.completedAt = now2();
    log(s, "lifecycle", `Trigger fired (${count}); still armed`);
  }
  touch(x);
  track(x, followers(x, b, s, output, []).catch((e) => {
    x.flowFailed ?? (x.flowFailed = `${b.label}: ${errMsg(e)}`);
  }));
  return true;
}
async function useTrigger(x, id, a) {
  const b = block(x, id), action = typeof a.action === "string" && a.action ? a.action : "status";
  if (!TRIGGER_ACTIONS.includes(action)) throw new Error(`Trigger '${b.label}' takes action ${TRIGGER_ACTIONS.join(", ")}`);
  const status = () => {
    const s = stateOf(x, id), armed = x.triggers.get(id);
    return { trigger: {
      type: b.type,
      armed: !!armed,
      status: s.status,
      ...armed ? { endpoint: armed.endpoint } : {},
      config: { ...b.trigger || {}, ...b.trigger?.secret ? { secret: "(set)" } : {} },
      events: s.runs,
      ...s.error ? { error: s.error } : {},
      ...s.output !== void 0 ? { lastEvent: preview(s.output, 4e3) } : {}
    } };
  };
  if (action === "status") return status();
  if (action === "disarm" || action === "stop" || action === "cancel") {
    const was = await disarmTrigger(x, id);
    log(stateOf(x, id), "lifecycle", was ? "Trigger disarmed by an agent" : "Disarm requested; trigger was not armed");
    return status();
  }
  if (action === "configure" || action === "arm" || action === "start") {
    const patch = { ...a };
    delete patch.action;
    delete patch.block_id;
    delete patch.input;
    delete patch.timeout_seconds;
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
    const timeout = Math.min(Math.max(Number(a.timeout_seconds) || 300, 1), 86400) * 1e3;
    if (!x.triggers.has(id)) return { ...status(), waited: "not_armed" };
    const output = await new Promise((resolve) => {
      const set = x.triggerWaiters.get(id) || /* @__PURE__ */ new Set();
      x.triggerWaiters.set(id, set);
      const done = (v) => {
        set.delete(wake);
        if (!set.size) x.triggerWaiters.delete(id);
        clearTimeout(t);
        resolve(v);
      };
      const wake = (o) => done(o);
      const t = setTimeout(() => done(null), timeout);
      set.add(wake);
    });
    assertActive(x);
    return output === null ? { ...status(), waited: "timed_out" } : { ...status(), waited: "fired", event: preview(output, 2e4) };
  }
  return status();
}
async function ask(x, b, s, question) {
  const pauseId = crypto.randomUUID();
  Object.assign(s, { status: "awaiting_user_input", question, pauseId });
  log(s, "prompt", question);
  touch(x);
  return new Promise((resolve, reject) => x.answers.set(b.id, { pauseId, resolve, reject }));
}
function answer(x, blockId, pauseId, text) {
  const pending = x.answers.get(blockId);
  if (!pending || pending.pauseId !== pauseId) throw new Error("This question is no longer waiting for an answer");
  x.answers.delete(blockId);
  pending.resolve(String(text).slice(0, 1e5));
}
function track(x, p) {
  x.background.add(p);
  void p.catch(() => {
  }).finally(() => {
    x.background.delete(p);
    if (!x.driving) settle(x);
  });
  return p;
}
function pickProfile(x, b) {
  const ps = x.env.profiles;
  const p = b.profileId && ps.find((p2) => p2.id === b.profileId) || b.provider && ps.find((p2) => p2.provider === b.provider) || !b.profileId && !b.provider && (ps.find((p2) => p2.id === x.env.defaultProfileId) || ps[0]);
  if (!p) throw new Error(`No enabled AI provider for '${b.label}' on this machine${b.provider ? ` (${b.provider})` : ""}`);
  return p;
}
function toolCatalogue(x, b, startupFailures) {
  const attached = attachedMcpIds(stateOf(x, b.id).sessionConfig);
  return toolTargets(x, b.id).map((t) => {
    const serverId = capabilityMcpServer(t) || "";
    const configuredName = x.env.mcpConfigs?.[serverId]?.name || x.env.mcpServers.find((m) => m.id === serverId)?.name || "";
    const startupFailure = startupFailures?.[serverId] || startupFailures?.[configuredName] || startupFailures?.[configuredName.replace(/\p{White_Space}/gu, "_")];
    const pending = (t.type === "mcp" || t.type === "browser") && (!attached.has(serverId) || !!startupFailure);
    return {
      block_id: t.id,
      name: t.label,
      type: t.type,
      ...t.description ? { description: t.description } : {},
      invocation: (t.type === "mcp" || t.type === "browser") && !pending ? "provider_mcp_tools" : t.type === "task_controls" ? "workspace_task_tools" : "workflow_use_block",
      status: pending ? "pending_restart" : stateOf(x, t.id).status,
      ...t.type === "mcp" ? {
        server_id: serverId,
        server_name: x.env.mcpServers.find((m) => m.id === serverId)?.name,
        ...pending ? { reason: startupFailure || x.mcpUpdateErrors.get(b.id) || "This server has not been attached to the provider session. Hato applies MCP changes before the next turn." } : { usage: "Discover and call this server's tools through the provider MCP tools. workflow_use_block only describes the connection; it does not call the MCP server." }
      } : {},
      ...t.type === "task_controls" ? { usage: "Use workspace tasks_list, tasks_create, tasks_start_agent and tasks_reconcile tools." } : {},
      ...t.type === "browser" ? { browser_session: t.browser?.sessionId, ...pending ? { reason: startupFailure || x.mcpUpdateErrors.get(b.id) || "The Hato desktop tools are not attached yet. Hato applies MCP changes before the next turn." } : { usage: `Use the Hato desktop browser commands with session "${t.browser?.sessionId}"${t.browser?.name ? ` (${t.browser.name})` : ""}: browser_navigate, browser_text, browser_elements, browser_click, browser_type, browser_key, browser_scroll, browser_screenshot (quality low to look around), browser_network.` } } : {},
      ...t.type === "run_app" ? { actions: t.app?.actions?.length ? t.app.actions : ["start", "status", "kill", "tail"] } : {},
      ...t.type === "terminal_control" ? { actions: ["list", "read", "write"] } : {},
      ...isTriggerBlock(t) ? { actions: TRIGGER_ACTIONS, ...x.triggers.get(t.id) ? { endpoint: x.triggers.get(t.id).endpoint } : {} } : {},
      ...t.type === "timer" ? { seconds: t.seconds } : {}
    };
  });
}
async function sessionToolCatalogue(x, b) {
  const id = stateOf(x, b.id).sessionId;
  const view = id && toolTargets(x, b.id).some((t) => capabilityMcpServer(t)) ? await agentCall("view", { id, limit: 1 }) : null;
  return toolCatalogue(x, b, view?.mcpStartupFailures);
}
function instructions(x, b) {
  const tools = toolCatalogue(x, b);
  const paths = b.type === "chatbox" ? [] : x.def.edges.filter((e) => e.from === b.id && edgeType(e) === "path").map((e) => e.label);
  const caps = toolTargets(x, b.id).filter(isCapabilityBlock).map((t) => t.type);
  return [
    `You are the "${b.label}" block of the Hato workflow "${x.run.workflowName}". Each workflow block keeps its own session and context.`,
    tools.length ? `Connected workflow blocks and capabilities: ${JSON.stringify(tools)}.` : "No workflow blocks are connected to you as tools.",
    "Call workflow_connections to discover your connected blocks and their invocation methods before deciding which tools to use. Check the connected capabilities before claiming you lack access. Blocks with invocation workflow_use_block accept block_id and input; provider_mcp_tools means use that MCP server's advertised tools directly.",
    caps.includes("mcp") ? "Use workflow_connections to check which MCP servers are attached, then inspect their advertised tools. If your provider loads tools lazily, use its tool discovery/search facility. Report any pending reason or discovery error for a server you need." : "",
    tools.length ? `For connected AI Agents and Chatboxes: omit action to run and wait, start launches in the background, status checks state, tail reads recent messages (lines 1–50) and steer sends input to a running session. A timed_out result means the block keeps working; check it with status or workflow_block_messages. Run App blocks take action start, status, kill or tail. Meetings automatically publish participant status changes (started activity, idle, permission wait, error or stop) as room messages. Use diff or wait to receive them without status polling. Publishing does not consume your unread cursor or invoke other agents. Meetings take publish (message), tail, diff, wait, status and shake (peer_block_id and an explicit message, required). Skill blocks return instructions to apply in your own session. Trigger blocks (HTTP, socket, file/pipe) are armed when the run starts and start their followers when an event arrives; take action status, configure (port, path, method, status_code, response_body, secret, protocol, framing, mode, create_if_missing, continuous, max_events; re-arms if armed), arm, disarm, wait (timeout_seconds) or fetch. Timers arm and return at once; pass seconds (delay) or at (ISO 8601 time) to choose when they fire, else the block's seconds apply. Re-arming replaces the pending timer; action status shows when it fires and cancel disarms it. When a timer fires, its follow connections receive the input you gave them, steering agents that are busy. User Prompt and Yes/No Prompt blocks wait for the user's answer. action "fetch" returns output you have not seen yet. Use workflow_block_output to page through long outputs. Keep requests and reports concise.` : "",
    caps.includes("terminal_control") ? "Terminal Control: always call workflow_use_block with the connected Terminal Control block_id and action list, read or write. read/write take key; read accepts cursor; write takes text. These calls are logged on the block. Do not use direct workspace terminals_* tools. Reuse existing terminals; do not start agents in terminals." : "",
    caps.includes("browser") ? "Browser: drive the connected browser session only through the browser commands with its session id. Look before acting (browser_screenshot quality low, browser_text or browser_elements), click and type by element ref, and verify the result. The user watches the session live and may also interact with it." : "",
    caps.includes("task_controls") ? "Task controls: use the workspace tasks_list, tasks_create, tasks_start_agent and tasks_reconcile tools (they need the Hato desktop open)." : "",
    paths.length ? `Available paths: ${JSON.stringify(paths)}. Call workflow_choose_path with one of them before you finish; your final answer is passed to the chosen path.` : "",
    b.type === "chatbox" ? "You are a chat with the user. Use your connected tools when they help answer." : "Your final message is this block's output."
  ].filter(Boolean).join("\n");
}
async function agentCall(method, args, timeoutMs = 6e4) {
  return ctx.modules.call("agent-runner", method, args, { timeoutMs });
}
function sessionConfig(x, b) {
  const profile = pickProfile(x, b);
  const targets = toolTargets(x, b.id);
  const mcpIds = [...new Set(targets.map((t) => capabilityMcpServer(t)).filter(Boolean))].sort();
  const workspaceTools = mcpIds.includes("internal-remote-mcp");
  const extra = mcpIds.filter((id) => id !== "internal-remote-mcp").map((id) => x.env.mcpServers.find((m) => m.id === id)).filter(Boolean).map((m) => {
    const prepared = x.env.mcpConfigs?.[m.id];
    if (prepared) return { id: m.id, ...prepared };
    if (isInternalMcp(m.id)) throw new Error(`“${m.name}” is issued when the workflow is saved or a run starts. Save the workflow (or start a new run) to connect it.`);
    if (transportOf(m) !== "stdio" && m.auth?.type === "oauth") throw new Error(`MCP server “${m.name}” needs fresh authorization. Start a new workflow run to reconnect it.`);
    return { id: m.id, ...acpServer(m) };
  });
  const workspaceMcp = (workspaceTools || targets.some((t) => t.type === "task_controls")) && !!x.env.daemon;
  const name = `${x.run.workflowName} · ${b.label}`.slice(0, 120), model = b.model || "", agentFile = b.agentFile || null;
  const trackAutonomous = profile.provider === "claude" ? trackAutonomousClaudeTurns : void 0;
  const signature = JSON.stringify([
    profile.id,
    model,
    agentFile,
    extra.map((m) => m.id).sort(),
    workspaceMcp,
    ...trackAutonomous === void 0 ? [] : [trackAutonomous]
  ]);
  return { profile, name, model, agentFile, extra, workspaceMcp, trackAutonomous, signature };
}
function attachedMcpIds(signature) {
  const [, , , ids, workspaceMcp] = JSON.parse(signature ?? "[]");
  return /* @__PURE__ */ new Set([...ids ?? [], ...workspaceMcp ? ["internal-remote-mcp"] : []]);
}
var tokenOf = (endpoint) => endpoint.env.find((v) => v.name === "HATO_MCP_TOKEN")?.value;
async function createSession(x, b, s) {
  if (b.reasoning && !(await agentCall("health", {}).catch(() => null))?.reasoning) throw new Error("Reasoning needs the updated agent runtime. Stop saved background agents before upgrading their runtime, then retry.");
  const c = sessionConfig(x, b);
  const endpoint = await issueEndpoint(ctx, { kind: "run", runId: x.run.id, blockId: b.id });
  const id = crypto.randomUUID();
  const spec = {
    id,
    name: c.name,
    workspaceId: x.env.workspaceId,
    workspaceName: x.env.workspaceName,
    root: x.env.root,
    machineId: x.env.machineId,
    profile: c.profile,
    model: c.model,
    reasoning: b.reasoning || "",
    agentFile: c.agentFile,
    skills: [],
    mcps: [endpoint, ...c.extra],
    claudeSubscription: x.env.claudeSubscription,
    workspaceMcp: c.workspaceMcp,
    daemon: x.env.daemon,
    trackAutonomousClaudeTurns: c.trackAutonomous,
    autopilot: !!b.autopilot,
    workflow: { runId: x.run.id, blockId: b.id }
  };
  try {
    await agentCall("create", { spec }, 24e4);
  } catch (e) {
    await revokeWhere(ctx, (sc) => sc.kind === "run" && sc.token === tokenOf(endpoint));
    throw e;
  }
  s.sessionConfig = c.signature;
  return id;
}
async function reconfigure(x, b, s) {
  if (!s.sessionConfig) {
    const { session } = await agentCall("view", { id: s.sessionId, limit: 1 });
    s.sessionConfig = JSON.stringify([
      session.profile?.id,
      session.model || "",
      session.agentFile || null,
      (session.mcps || []).map((m) => m.id).filter((id) => id !== "hato-workflow").sort(),
      !!session.workspaceMcp
    ]);
  }
  const targets = toolTargets(x, b.id);
  const desired = new Set(targets.map((t) => capabilityMcpServer(t)).filter(Boolean));
  if (targets.some((t) => t.type === "task_controls") && x.env.daemon) desired.add("internal-remote-mcp");
  const removing = [...attachedMcpIds(s.sessionConfig)].some((id) => !desired.has(id));
  let token;
  try {
    const c = sessionConfig(x, b);
    if (s.sessionConfig === c.signature) {
      x.mcpUpdateErrors.delete(b.id);
      return;
    }
    const endpoint = await issueEndpoint(ctx, { kind: "run", runId: x.run.id, blockId: b.id });
    token = tokenOf(endpoint);
    await agentCall("update", { id: s.sessionId, patch: { name: c.name, profile: c.profile, model: c.model, agentFile: c.agentFile, skills: [], mcps: [endpoint, ...c.extra], workspaceMcp: c.workspaceMcp, trackAutonomousClaudeTurns: c.trackAutonomous } }, 24e4);
    s.sessionConfig = c.signature;
  } catch (e) {
    if (token) await revokeWhere(ctx, (sc) => sc.kind === "run" && sc.token === token);
    const reason = errMsg(e);
    x.mcpUpdateErrors.set(b.id, reason);
    log(s, "error", `Hot update not applied: ${reason}`);
    if (removing) throw new Error(`Could not remove disconnected MCP tools: ${reason}`);
    return;
  }
  await revokeWhere(ctx, (sc) => sc.kind === "run" && sc.runId === x.run.id && sc.blockId === b.id && sc.token !== token);
  x.mcpUpdateErrors.delete(b.id);
  log(s, "lifecycle", "Session reconnected with the updated workflow configuration");
  touch(x);
}
var seqOf = (m) => Number(String(m?.key || "").replace("agent-msg-", "")) || 0;
async function turn(x, s, text, images) {
  const id = s.sessionId;
  const before = await agentCall("view", { id, limit: 1 });
  const mark = Math.max(0, ...before.messages.map(seqOf));
  if (["busy", "waiting", "starting"].includes(before.session.status)) throw new Error("This block's agent is busy; use steer or wait for it to finish");
  const sent = await agentCall("send", { id, text, images }, 24e4);
  for (; ; ) {
    await sleep(800);
    if (x.cancelled) {
      await agentCall("cancel", { id }).catch(() => {
      });
      throw new Error("Workflow run was cancelled");
    }
    const v = await agentCall("view", { id, limit: 80 });
    const status = v.session.status;
    if (status === "waiting" && s.status !== "awaiting_permission") {
      s.status = "awaiting_permission";
      s.permissionId = v.permissions[0]?.id;
      touch(x);
    } else if (status !== "waiting" && s.status === "awaiting_permission") {
      s.status = "running";
      s.permissionId = void 0;
      touch(x);
    }
    const after = v.messages.filter((m) => seqOf(m) > mark && (sent.turn === void 0 || m.turn === sent.turn));
    const failure = after.find((m) => m.role === "error");
    if (failure) throw new Error(failure.text || "The agent turn failed");
    if (["interrupted", "stopped", "error"].includes(status)) throw new Error(v.session.error || `Agent ${status}`);
    if (after.some((m) => m.role === "system" && String(m.text).startsWith("Turn ended"))) {
      if (after.some((m) => m.role === "system" && /cancel/i.test(String(m.text)))) log(s, "lifecycle", "Turn was cancelled");
      const answer2 = [...after].reverse().find((m) => m.role === "assistant" && String(m.text || "").trim());
      return answer2 ? String(answer2.text).trim() : "";
    }
  }
}
async function agent(x, b, s, input, images) {
  const fresh = !s.sessionId;
  if (fresh) {
    s.sessionId = await createSession(x, b, s);
    touch(x);
  } else await reconfigure(x, b, s);
  const limit = x.def.settings?.promptLimitChars ?? 2e5;
  const clipped = preview(input, 2e4);
  let text;
  const references = referenceUpdates(b.prompt, x.outputs, s.referenceContext && s.referenceContext.sessionId === s.sessionId ? s.referenceContext.values : {});
  const promptChanged = !fresh && s.appliedPrompt !== void 0 && s.appliedPrompt !== b.prompt;
  s.appliedPrompt = b.prompt;
  if (b.type === "chatbox") {
    text = fresh ? `${instructions(x, b)}

Session guidance:
${renderPrompt(b.prompt, "", x.outputs)}

User message:
${clipped}` : promptChanged ? `Updated session guidance (the workflow was edited):
${renderPrompt(b.prompt, "", x.outputs)}

User message:
${clipped}` : clipped + references.text;
    s.chat = [...s.chat || [], { id: crypto.randomUUID(), role: "user", text: clipped, at: now2() }].slice(-200);
  } else {
    const template = /\{\{\s*input\s*\}\}/.test(b.prompt) ? b.prompt : `${b.prompt}

Input:
{{input}}`;
    const body = fresh || promptChanged || /\{\{/.test(b.prompt) ? renderPrompt(template, clipped, x.outputs) : clipped;
    text = fresh ? `${instructions(x, b)}

${body}` : body;
  }
  if (text.length > limit) text = preview(text, limit);
  s.prompt = preview(text, 2e4);
  log(s, "prompt", text);
  touch(x);
  const out = await turn(x, s, text, images);
  if (b.type === "chatbox") s.referenceContext = { sessionId: s.sessionId, values: references.values };
  if (b.type === "chatbox") s.chat = [...s.chat || [], { id: crypto.randomUUID(), role: "assistant", text: out, at: now2() }].slice(-200);
  const paths = b.type === "chatbox" ? [] : x.def.edges.filter((e) => e.from === b.id && edgeType(e) === "path");
  if (paths.length && !s.selectedRoute) throw new Error(`${b.label} finished without choosing a path (workflow_choose_path)`);
  return out;
}
async function steer(x, id, text) {
  const s = stateOf(x, id);
  const input = preview(text, 2e4);
  let configChanged = true;
  try {
    configChanged = sessionConfig(x, block(x, id)).signature !== s.sessionConfig;
  } catch {
  }
  if (s.sessionId && !configChanged) {
    const result = await agentCall("send", { id: s.sessionId, text: input, steer: true, currentTurnOnly: true }, 6e4);
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
async function messages(x, id, count) {
  const s = stateOf(x, id);
  if (!s.sessionId) return { status: s.status, messages: [] };
  const v = await agentCall("view", { id: s.sessionId, limit: Math.min(Math.max(count, 1), 50) });
  return { status: s.status, agentStatus: v.session.status, messages: v.messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, title: m.title, text: preview(String(m.text || ""), 2e3) })) };
}
var STATUS_DESCRIPTIONS = {
  running: "started activity",
  succeeded: "is idle",
  failed: "stopped with an error",
  cancelled: "was stopped",
  awaiting_permission: "is waiting for permission",
  awaiting_user_input: "is waiting for input",
  waiting_input: "is ready for text",
  waiting_timer: "is waiting for a timer",
  waiting_trigger: "is waiting for a trigger",
  queued: "is queued"
};
function notifyMeeting(x, roomId) {
  for (const wake of [...x.meetingWaiters.get(roomId) || []]) wake();
}
function appendMeetingMessage(x, roomId, participantId, text, status) {
  const s = stateOf(x, roomId), m = meeting(s), author = block(x, participantId).label;
  m.messages.push({ seq: ++m.seq, blockId: participantId, author, text, at: now2(), ...status ? { kind: "status", participantStatus: status } : {} });
  if (m.messages.length > 1e3) m.messages.splice(0, m.messages.length - 1e3);
  const output = m.messages.map((msg) => `[${msg.seq}] ${msg.author}: ${msg.text}`).join("\n\n").slice(-outputLimit(x));
  s.output = output;
  x.outputs.set(roomId, output);
  if (status) log(s, "lifecycle", text);
  notifyMeeting(x, roomId);
  return m.seq;
}
function publishMeetingStatusChanges(x) {
  for (const participant of x.def.blocks.filter(isAgentBlock)) {
    const s = stateOf(x, participant.id), before = x.participantStatuses.get(participant.id);
    x.participantStatuses.set(participant.id, s.status);
    if (before === s.status || before === void 0 && s.status !== "running") continue;
    const description = STATUS_DESCRIPTIONS[s.status];
    if (!description) continue;
    for (const room of toolTargets(x, participant.id).filter((b) => b.type === "meeting")) {
      appendMeetingMessage(x, room.id, participant.id, `[Status] ${participant.label.slice(0, 200)} ${description}.`, s.status);
    }
  }
}
function meeting(s) {
  return s.meeting ?? (s.meeting = { seq: 0, messages: [], cursors: {} });
}
function meetingTail(s, lines) {
  const m = meeting(s);
  return { messages: m.messages.slice(-Math.min(Math.max(lines, 1), 50)), latestSequence: m.seq };
}
async function useMeeting(x, meetingId, caller, a) {
  const s = stateOf(x, meetingId), m = meeting(s), action = a.action || "diff";
  const lines = Math.min(Math.max(Number(a.lines) || 20, 1), 50);
  const diff = (status) => {
    const from = typeof a.after === "number" ? a.after : m.cursors[caller] ?? 0;
    const unread = m.messages.filter((msg) => msg.seq > from), page = unread.slice(0, lines);
    const cursor = page.length ? page[page.length - 1].seq : from;
    if (typeof a.after !== "number") m.cursors[caller] = Math.max(m.cursors[caller] ?? 0, cursor);
    touch(x);
    return { meeting: { ...status ? { status } : {}, messages: page, cursor, latestSequence: m.seq, hasMore: unread.length > page.length } };
  };
  if (action === "publish") {
    const text = String(a.message ?? a.input ?? "").slice(0, 1e4);
    if (!text.trim()) throw new Error("A meeting message is required");
    const published = appendMeetingMessage(x, meetingId, caller, text);
    touch(x);
    return { meeting: { published } };
  }
  if (action === "tail" || action === "fetch") return { meeting: meetingTail(s, lines) };
  if (action === "diff") return diff();
  if (action === "status") {
    const peers = x.def.edges.filter((e) => e.to === meetingId && edgeType(e) === "use").map((e) => block(x, e.from));
    return { meeting: { peers: peers.map((p) => ({ block_id: p.id, name: p.label, type: p.type, online: x.busy.has(p.id), block_status: stateOf(x, p.id).status, hasSession: !!stateOf(x, p.id).sessionId, self: p.id === caller })) } };
  }
  if (action === "wait") {
    const from = typeof a.after === "number" ? a.after : m.cursors[caller] ?? 0;
    if (m.messages.some((msg) => msg.seq > from)) return diff("updated");
    const timeout = Math.min(Math.max(Number(a.timeout_seconds) || 300, 1), 86400) * 1e3;
    const updated = await new Promise((resolve) => {
      const listeners = x.meetingWaiters.get(meetingId) || /* @__PURE__ */ new Set();
      x.meetingWaiters.set(meetingId, listeners);
      const done = (v) => {
        listeners.delete(wake);
        if (!listeners.size) x.meetingWaiters.delete(meetingId);
        clearTimeout(t);
        resolve(v);
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
    if (!x.def.edges.some((e) => e.from === peer && e.to === meetingId && edgeType(e) === "use") || peer === caller) throw new Error("Shake a different agent connected to this meeting");
    const message = a.message ?? a.input;
    if (typeof message !== "string" || !message.trim() || message.length > 1e4) throw new Error("Meeting shake needs a specific message of 1 to 10000 characters");
    if (x.busy.has(peer)) {
      await steer(x, peer, message);
      return { meeting: { shake: { blockId: peer, delivery: "steered" } } };
    }
    track(x, invoke(x, peer, message, [], true).catch(() => {
    }));
    return { meeting: { shake: { blockId: peer, delivery: "started" } } };
  }
  throw new Error(`Unknown meeting action '${action}'`);
}
async function drive(x, entries) {
  x.driving = true;
  const maxMs = x.def.settings?.maxRunDurationMs ?? 24 * 36e5;
  x.deadline = setTimeout(() => {
    x.flowFailed ?? (x.flowFailed = "The workflow reached its maximum run duration");
    void cancel(x, "The workflow reached its maximum run duration");
  }, maxMs);
  x.deadline.unref?.();
  try {
    const roots = entries ?? defaultRoots(x);
    for (const id of roots) {
      try {
        await invoke(x, id, x.run.input);
      } catch (e) {
        if (x.cancelled) break;
        x.flowFailed ?? (x.flowFailed = errMsg(e));
        break;
      }
    }
    while (!x.cancelled && (x.timers.size || x.triggers.size || x.inputs.size || x.background.size)) {
      if (x.background.size) await Promise.race([Promise.allSettled([...x.background]), sleep(500)]);
      else await sleep(250);
    }
  } finally {
    x.driving = false;
    settle(x);
  }
}
function defaultRoots(x) {
  if (x.run.startBlockId) return isEventSource(block(x, x.run.startBlockId)) ? [] : [x.run.startBlockId];
  const starts = x.def.blocks.filter(isStartBlock);
  if (starts.length) return starts.map((b) => b.id);
  return x.def.blocks.filter((b) => !x.def.edges.some((e) => e.to === b.id) && !isCapabilityBlock(b) && !(b.type === "chatbox" && !x.run.input.trim()) && !["meeting", "skill"].includes(b.type) && !isEventSource(b)).map((b) => b.id);
}
function adoptDefinition(x, def) {
  const ids = new Set(def.blocks.map((b) => b.id));
  let disarmed = false;
  for (const [id, t] of [...x.timers]) if (!ids.has(id)) {
    clearTimeout(t);
    x.timers.delete(id);
    disarmed = true;
  }
  for (const id of [...x.joins.keys()]) if (!ids.has(id)) x.joins.delete(id);
  const rearm = [];
  for (const id of [...x.triggers.keys()]) {
    const next = def.blocks.find((b) => b.id === id), prev = x.def.blocks.find((b) => b.id === id);
    if (!next || !isTriggerBlock(next)) {
      void disarmTrigger(x, id);
      disarmed = true;
    } else if (JSON.stringify(next.trigger || {}) !== JSON.stringify(prev?.trigger || {}) || next.type !== prev?.type) rearm.push(next);
  }
  const queueEdges = new Set(def.edges.filter((e) => edgeType(e) === "queue").map((e) => e.id));
  for (const [id, q] of [...x.queues]) {
    const kept = ids.has(id) ? q.filter((i) => queueEdges.has(i.edgeId)) : [];
    if (kept.length) x.queues.set(id, kept);
    else x.queues.delete(id);
    setDepth(x, id);
  }
  for (const id of [...x.inputs]) if (!def.blocks.some((b) => b.id === id && b.type === "text_input")) {
    x.inputs.delete(id);
    disarmed = true;
  }
  x.def = def;
  x.run.definition = def;
  x.run.workflowName = def.name;
  x.run.blocks = x.run.blocks.filter((s) => ids.has(s.blockId) || x.busy.has(s.blockId) || x.answers.has(s.blockId));
  for (const b of def.blocks) stateOf(x, b.id);
  if (!x.cancelled && (x.run.status === "running" || x.run.status === "waiting")) openTextInputs(x);
  for (const b of rearm) track(x, armTrigger(x, b).catch((e) => {
    const s = stateOf(x, b.id), message = `Cannot re-arm trigger '${b.label}': ${errMsg(e)}`;
    Object.assign(s, { status: "failed", error: message, completedAt: now2(), triggerEndpoint: void 0 });
    log(s, "error", message);
    touch(x);
  }));
  if (disarmed) settle(x);
  else touch(x);
}
function settle(x) {
  for (const id of [...x.queues.keys()]) drainQueue(x, id);
  if (x.driving || x.busy.size || x.timers.size || x.triggers.size || x.inputs.size || x.background.size || x.answers.size) {
    touch(x);
    return;
  }
  if (x.deadline) clearTimeout(x.deadline);
  if (x.run.status === "running" || x.run.status === "waiting") {
    x.run.status = x.cancelled ? "cancelled" : x.flowFailed ? "failed" : "succeeded";
    x.run.error = x.cancelled ? x.run.error : x.flowFailed;
    x.run.completedAt = now2();
  }
  for (const s of x.run.blocks) if (s.status === "queued") s.status = "skipped";
  persist(x.run);
}
async function cancel(x, reason = "Cancelled by the user") {
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
  for (const h of x.procs) await ctx.host.process.terminate(h, "SIGKILL").catch(() => {
  });
  for (const s of x.run.blocks) {
    if (s.sessionId && (s.status === "running" || s.status === "awaiting_permission")) await agentCall("cancel", { id: s.sessionId }).catch(() => {
    });
    if (["running", "waiting_timer", "waiting_trigger", "waiting_input", "awaiting_user_input", "awaiting_permission", "queued"].includes(s.status)) {
      s.status = "cancelled";
      s.completedAt = now2();
    }
  }
  x.run.status = "cancelled";
  x.run.error = reason;
  x.run.completedAt = now2();
  touch(x);
}
function chat(x, blockId, text) {
  const b = block(x, blockId);
  if (b.type !== "chatbox") throw new Error("Only Chatbox blocks accept chat messages");
  return promptBlock(x, blockId, text);
}
function promptBlock(x, blockId, text, images) {
  if (x.cancelled) throw new Error("This run was cancelled; start a new run to chat");
  if (x.busy.has(blockId)) {
    if (images?.length) throw new Error("Wait for the agent to finish its turn before sending pictures");
    return steer(x, blockId, text);
  }
  if (x.run.status !== "running" && x.run.status !== "waiting") {
    x.run.status = "running";
    x.run.completedAt = void 0;
  }
  track(x, invoke(x, blockId, text, [], true, images));
  touch(x);
  return Promise.resolve({ accepted: true });
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

// modules/services/workflow-runner/src/terminal.ts
async function ctl(ctx2, env, op, args = {}) {
  if (!env.daemon) throw new Error("Terminal Control requires the workspace daemon");
  const grant = await ctx2.host.capabilities.request({ kind: "process", root: env.root });
  try {
    const r = await ctx2.host.process.run(grant.grant, {
      executable: env.daemon.bin,
      args: ["daemon", "ctl", "--dir", env.daemon.dir],
      cwd: env.root
    }, { stdin: JSON.stringify({ op, args }) + "\n", timeoutMs: 3e4 });
    if (r.code !== 0) throw new Error(r.stderr || "Daemon control failed");
    const result = JSON.parse(r.stdout);
    if (!result.ok) throw new Error(result.error?.message || "Daemon request failed");
    return result.value;
  } finally {
    await ctx2.host.capabilities.release(grant.grant);
  }
}
async function terminalAction(ctx2, env, action, a) {
  if (!["list", "read", "write"].includes(action)) throw new Error("Terminal Control actions: list, read, write");
  const list = await ctl(ctx2, env, "resources.list");
  const root = env.root.replace(/\/$/, "");
  const allowed = (list.ptys || []).filter((p) => p.cwd === env.root || p.cwd.startsWith(root + "/"));
  if (action === "list") return allowed;
  if (!allowed.some((p) => p.key === a.key)) throw new Error("Terminal is outside this workspace");
  return ctl(ctx2, env, action === "read" ? "pty.read" : "pty.write", {
    key: a.key,
    cursor: a.cursor,
    limitBytes: 65536,
    text: String(a.text ?? a.input ?? "")
  });
}

// modules/services/workflow-runner/src/index.ts
var db2;
var now3 = () => (/* @__PURE__ */ new Date()).toISOString();
var GATEWAY = /* @__PURE__ */ new Set(["daemon-client", "workflows"]);
var gateway = (meta) => {
  if (!GATEWAY.has(meta?.caller)) throw new Error("Only the Hato workflow gateway may call this method");
};
var ctxRef;
var dirty = /* @__PURE__ */ new Map();
var flushTimer = null;
function save(run) {
  dirty.set(run.id, run);
  if (!flushTimer) flushTimer = setTimeout(() => {
    void flush();
  }, 250);
}
async function flush() {
  flushTimer = null;
  const runs = [...dirty.values()];
  dirty.clear();
  for (const run of runs) await ctxRef.host.db.exec(db2, "UPDATE runs SET data=? WHERE id=?", [JSON.stringify(run), run.id]).catch((e) => ctxRef.log.error("workflow run save", errMsg(e)));
}
async function loadRun(id) {
  const r = (await ctxRef.host.db.query(db2, "SELECT data, env FROM runs WHERE id=?", [id]))[0];
  return r ? { run: dirty.get(id) || JSON.parse(r.data), env: JSON.parse(r.env) } : null;
}
async function execFor(id) {
  const live = execs.get(id);
  if (live) return live;
  const stored = await loadRun(id);
  if (!stored) throw new Error("Workflow run not found");
  return execs.get(id) || newExec(stored.run, stored.env);
}
async function definition(projectId, id) {
  const r = (await ctxRef.host.db.query(db2, "SELECT data, revision FROM definitions WHERE id=? AND project=?", [id, projectId]))[0];
  if (!r) throw new Error(`Workflow '${id}' not found`);
  return { definition: JSON.parse(r.data), revision: Number(r.revision) };
}
async function saveDefinition(projectId, raw, expected, available, mcpEnv) {
  const def = normalizeDefinition(raw);
  const current = (await ctxRef.host.db.query(db2, "SELECT revision, data, project FROM definitions WHERE id=?", [def.id]))[0];
  if (current && current.project !== projectId) throw new Error("This workflow id belongs to another project; choose a new id");
  if (expected === null && current) throw new Error(`Workflow '${def.id}' already exists (revision ${current.revision}); read it and pass its revision`);
  if (typeof expected === "number" && (!current || Number(current.revision) !== expected)) throw new Error(`Revision conflict: workflow '${def.id}' is at revision ${current ? current.revision : "none"}; reload and reconcile`);
  if (current) {
    const prev = JSON.parse(current.data);
    def.createdAt = prev.createdAt || def.createdAt;
    def.version = (prev.version || 1) + 1;
  }
  const revision = current ? Number(current.revision) + 1 : 1;
  await ctxRef.host.db.exec(
    db2,
    "INSERT INTO definitions(id,project,revision,data) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, data=excluded.data",
    [def.id, projectId, revision, JSON.stringify(def)]
  );
  const issues = validateWorkflow(def, available);
  const updatedRuns = blockingIssues(issues).length ? 0 : await updateRuns(projectId, def, mcpEnv);
  return { id: def.id, revision, definition: def, issues, updatedRuns };
}
async function updateRuns(projectId, def, mcpEnv) {
  const rows = await ctxRef.host.db.query(db2, "SELECT id FROM runs WHERE project=? AND workflow=?", [projectId, def.id]);
  const withMcp = (env) => mcpEnv && Array.isArray(mcpEnv.mcpServers) ? Object.assign(env, { mcpServers: mcpEnv.mcpServers, mcpConfigs: { ...env.mcpConfigs, ...mcpEnv.mcpConfigs } }) : env;
  let count = 0;
  for (const { id } of rows) {
    const live = execs.get(id);
    if (live) {
      withMcp(live.env);
      adoptDefinition(live, def);
      if (mcpEnv) await ctxRef.host.db.exec(db2, "UPDATE runs SET env=? WHERE id=?", [JSON.stringify(live.env), id]);
      count++;
      continue;
    }
    const stored = await loadRun(id);
    if (!stored) continue;
    if (mcpEnv) await ctxRef.host.db.exec(db2, "UPDATE runs SET env=? WHERE id=?", [JSON.stringify(withMcp(stored.env)), id]);
    const run = stored.run, ids = new Set(def.blocks.map((b) => b.id));
    run.definition = def;
    run.workflowName = def.name;
    run.blocks = run.blocks.filter((s) => ids.has(s.blockId));
    for (const b of def.blocks) if (!run.blocks.some((s) => s.blockId === b.id)) run.blocks.push({ blockId: b.id, status: "idle", runs: 0, log: [] });
    save(run);
    count++;
  }
  return count;
}
async function listDefinitions(projectId) {
  const rows = await ctxRef.host.db.query(db2, "SELECT data, revision FROM definitions WHERE project=? ORDER BY id", [projectId]);
  return rows.map((r) => {
    const d = JSON.parse(r.data);
    return { id: d.id, name: d.name, description: d.description, revision: Number(r.revision), updatedAt: d.updatedAt, blocks: d.blocks.length };
  }).sort((a, b) => a.name.localeCompare(b.name));
}
var summary = (run) => ({ id: run.id, workflowId: run.workflowId, workflowName: run.workflowName, status: run.status, createdAt: run.createdAt, completedAt: run.completedAt, error: run.error, input: preview(run.input, 300) });
function detail(run) {
  return { ...run, blocks: run.blocks.map((s) => ({ ...s, output: s.output === void 0 ? void 0 : preview(s.output, 16e3), outputChars: s.output?.length ?? 0, prompt: s.prompt === void 0 ? void 0 : preview(s.prompt, 8e3), log: s.log.slice(-40), chat: s.chat?.slice(-60), meeting: s.meeting ? { ...s.meeting, messages: s.meeting.messages.slice(-60) } : void 0 })) };
}
var object = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
var RUN_TOOLS = [
  { name: "workflow_connections", description: "Discover connected workflow blocks and capabilities, including MCP server names, invocation methods, and allowed actions. Call before choosing tools or claiming a capability is unavailable.", inputSchema: object({}) },
  {
    name: "workflow_use_block",
    description: "Run or control a connected workflow block. Pass block_id and input; action selects start/status/tail/steer (AI Agent, Chatbox), start/status/kill/tail (Run App), start/status/cancel (Timer; seconds or at sets the delay), publish/tail/diff/wait/status/shake (Meeting; shake requires peer_block_id and a specific message), list/read/write (Terminal Control, key/cursor/text), status/configure/arm/disarm/wait (HTTP, Socket and File/Pipe Triggers; configure and arm accept port, path, method, status_code, response_body, secret, protocol, framing, mode, create_if_missing, continuous, max_events), or fetch (unseen output of any data block).",
    inputSchema: object({
      block_id: { type: "string" },
      input: { type: "string" },
      action: { type: "string" },
      lines: { type: "number" },
      timeout_seconds: { type: "number" },
      seconds: { type: "number" },
      at: { type: "string" },
      message: { type: "string" },
      peer_block_id: { type: "string" },
      key: { type: "string" },
      cursor: { type: "number" },
      text: { type: "string" },
      after: { type: "number" },
      port: { type: "number" },
      path: { type: "string" },
      method: { type: "string" },
      status_code: { type: "number" },
      response_body: { type: "string" },
      secret: { type: "string" },
      protocol: { type: "string", enum: ["tcp", "unix"] },
      framing: { type: "string", enum: ["line", "message", "eof"] },
      mode: { type: "string", enum: ["auto", "file", "pipe"] },
      create_if_missing: { type: "boolean" },
      continuous: { type: "boolean" },
      max_events: { type: "number" }
    }, ["block_id"])
  },
  { name: "workflow_block_output", description: "Read retained output of a connected block in pages without running it.", inputSchema: object({ block_id: { type: "string" }, offset: { type: "number" }, limit: { type: "number" } }, ["block_id"]) },
  { name: "workflow_block_messages", description: "Read recent messages of a connected AI Agent or Chatbox without starting a turn.", inputSchema: object({ block_id: { type: "string" }, count: { type: "number" } }, ["block_id"]) },
  { name: "workflow_choose_path", description: "Choose the outgoing path your output is passed to. Call before finishing when paths are available.", inputSchema: object({ path: { type: "string" } }, ["path"]) }
];
var CONFIG_TOOLS = [
  { name: "workflows_reference", description: "Read the workflow format reference: block types, connections, templates and tools.", inputSchema: object({}) },
  { name: "workflows_list", description: "List this project's workflows with their revisions.", inputSchema: object({}) },
  { name: "workflows_read", description: 'Read a workflow definition and its revision. Use id "new" for a starter definition, or template_id to start from a template.', inputSchema: object({ id: { type: "string" }, template_id: { type: "string" } }, ["id"]) },
  {
    name: "workflows_write",
    description: "Create or replace a workflow. content is the complete JSON definition (string or object). expected_revision is the revision you read, or null to create. Returns the revision and validation issues. Never starts a run.",
    inputSchema: object({ content: {}, expected_revision: { type: ["number", "null"] } }, ["content", "expected_revision"])
  },
  { name: "workflows_validate", description: "Validate a workflow definition without saving it.", inputSchema: object({ content: {} }, ["content"]) }
];
var parseContent = (c) => {
  if (typeof c !== "string") return c;
  try {
    return JSON.parse(c);
  } catch (e) {
    throw new Error(`content is not valid JSON: ${errMsg(e)}`);
  }
};
function starter(templateId) {
  const t = WORKFLOW_TEMPLATES.find((t2) => t2.id === (templateId || "blank"));
  if (!t) throw new Error(`Unknown template; use one of ${WORKFLOW_TEMPLATES.map((t2) => t2.id).join(", ")}`);
  return normalizeDefinition({ id: `workflow-${crypto.randomUUID().slice(0, 8)}`, name: t.id === "blank" ? "New workflow" : t.name, ...t.graph() });
}
async function configTool(s, name, a) {
  const available = { profiles: s.profiles, mcps: s.mcps };
  if (name === "workflows_reference") return WORKFLOW_REFERENCE + `

Templates: ${WORKFLOW_TEMPLATES.map((t) => `${t.id} (${t.description})`).join("; ")}.
Providers on this machine: ${JSON.stringify(s.profiles)}.`;
  if (name === "workflows_list") return listDefinitions(s.projectId);
  if (name === "workflows_read") {
    if (a.id === "new") return { revision: null, definition: starter(a.template_id) };
    const d = await definition(s.projectId, String(a.id));
    return { ...d, issues: validateWorkflow(d.definition, available) };
  }
  if (name === "workflows_validate") return { issues: validateWorkflow(normalizeDefinition(parseContent(a.content)), available) };
  if (name === "workflows_write") {
    const r = await saveDefinition(s.projectId, parseContent(a.content), a.expected_revision === null ? null : Number(a.expected_revision), available);
    ctxRef.events.emit("workflow-runner.changed", { projectId: s.projectId, workflowId: r.id });
    return { id: r.id, revision: r.revision, issues: r.issues };
  }
  throw new Error("Unknown configuration tool");
}
async function runTool(s, name, a) {
  if (!["workflow_use_block", "workflow_block_output", "workflow_block_messages"].includes(name)) return runToolBody(s, name, a);
  const x = await execFor(s.runId);
  const target = toolTargets(x, s.blockId).find((t) => t.id === String(a.block_id || ""));
  if (!target) return runToolBody(s, name, a);
  const edge = x.def.edges.find((e) => e.from === s.blockId && e.to === target.id && edgeType(e) === "use") || x.def.edges.find((e) => e.from === s.blockId && e.to === target.id);
  if (!edge) return runToolBody(s, name, a);
  const action = `${name}:${a.action || "call"}`;
  const callId = transfer(x, edge.id, "send", a, void 0, action);
  const logTarget = (kind, value) => {
    const st = stateOf(x, target.id);
    const text = typeof value === "string" ? value : JSON.stringify(value);
    st.log.push({ at: now3(), kind, text: `${s.blockId} · ${action} · ${callId}
${preview(text || "", 4e3)}` });
    if (st.log.length > 200) st.log.splice(0, st.log.length - 200);
    touch(x);
  };
  logTarget("tool", a);
  try {
    const result = await runToolBody(s, name, a);
    logTarget("response", result);
    transfer(x, edge.id, "return", result, callId, action);
    return result;
  } catch (error) {
    logTarget("error", errMsg(error));
    transfer(x, edge.id, "return", errMsg(error), callId, action, true);
    throw error;
  }
}
async function runToolBody(s, name, a) {
  const x = await execFor(s.runId), caller = s.blockId;
  const targets = toolTargets(x, caller);
  const target = () => {
    const t2 = targets.find((t3) => t3.id === String(a.block_id || ""));
    if (!t2) throw new Error(`Block '${a.block_id}' is not connected to you; call workflow_connections`);
    return t2;
  };
  const record = (text) => {
    const st = stateOf(x, caller);
    st.log.push({ at: now3(), kind: "tool", text: text.slice(0, 500) });
    if (st.log.length > 200) st.log.shift();
  };
  const catalogue = () => sessionToolCatalogue(x, x.def.blocks.find((b) => b.id === caller));
  if (name === "workflow_connections") return catalogue();
  if (name === "workflow_choose_path") {
    const paths = x.def.edges.filter((e) => e.from === caller && edgeType(e) === "path").map((e) => e.label);
    if (!paths.includes(String(a.path))) throw new Error(`Unknown path; choose one of ${JSON.stringify(paths)}`);
    stateOf(x, caller).selectedRoute = String(a.path);
    record(`chose path ${a.path}`);
    touch(x);
    return { selected: a.path };
  }
  if (name === "workflow_block_output") {
    const t2 = target(), out = x.outputs.get(t2.id) ?? "";
    const offset = Math.max(0, Number(a.offset) || 0), limit = Math.min(Math.max(Number(a.limit) || 8e3, 1), 8e3);
    const text = out.slice(offset, offset + limit);
    return { block_id: t2.id, offset, text, total: out.length, ...offset + text.length < out.length ? { nextOffset: offset + text.length } : {} };
  }
  if (name === "workflow_block_messages") {
    const t2 = target();
    if (!isAgentBlock(t2)) throw new Error("Only AI Agent and Chatbox blocks have messages");
    return messages(x, t2.id, Number(a.count) || 6);
  }
  if (name !== "workflow_use_block") throw new Error("Unknown workflow tool");
  const t = target(), action = typeof a.action === "string" && a.action ? a.action : void 0;
  const input = String(a.input ?? a.message ?? "");
  record(`${action || "use"} ${t.label}`);
  if (t.type === "mcp" || t.type === "browser") return (await catalogue()).find((entry) => entry.block_id === t.id);
  if (action === "fetch") {
    if (t.type === "meeting") return useMeeting(x, t.id, caller, { action: "diff" });
    const k = `${caller}>${t.id}`, out = x.outputs.get(t.id) ?? "", seen = x.fetched.get(k) ?? 0;
    const from = seen > out.length ? 0 : seen, text = out.slice(from, from + 8e3);
    x.fetched.set(k, from + text.length);
    return text ? { text, hasMore: from + text.length < out.length } : { unchanged: true };
  }
  if (t.type === "meeting") return useMeeting(x, t.id, caller, { ...a, action: action || "diff" });
  if (isTriggerBlock(t)) return useTrigger(x, t.id, a);
  if (t.type === "terminal_control") {
    const value = await terminalAction(ctxRef, x.env, action || "list", a);
    const st = stateOf(x, t.id);
    st.output = JSON.stringify(value);
    st.runs++;
    st.status = "succeeded";
    touch(x);
    return value;
  }
  if (isCapabilityBlock(t)) return { note: `${t.label} is not callable: it adds tools to your session.` };
  if (t.type === "run_app") {
    const allowed = t.app?.actions?.length ? t.app.actions : ["start", "status", "kill", "tail"];
    const act = action || t.app?.action || "start";
    if (!allowed.includes(act)) throw new Error(`Run App '${t.label}' allows ${allowed.join(", ")}`);
    const app = await appAction(ctxRef, x.env.root, t.app.name, t.command || "", act, Math.min(Math.max(Number(a.lines) || t.app?.lines || 100, 1), 1e4));
    const st = stateOf(x, t.id);
    st.output = JSON.stringify(app);
    x.outputs.set(t.id, st.output);
    st.status = "succeeded";
    st.runs++;
    touch(x);
    return { app };
  }
  if (t.type === "timer") {
    if (action === "status" || action === "cancel") return timerAction(x, t.id, action);
    if (action && action !== "start") throw new Error(`Timer '${t.label}' takes action start (default), status or cancel`);
    const ms = timerDelay(x, a);
    if (ms !== void 0) x.delays.set(t.id, ms);
  }
  const edge = x.def.edges.find((e) => e.from === caller && e.to === t.id);
  const timeoutMs = Math.min(Math.max((Number(a.timeout_seconds) || (edge?.timeoutMs ?? 3e5) / 1e3) * 1e3, 1e3), 864e5);
  if (isAgentBlock(t)) {
    const st = stateOf(x, t.id);
    if (action === "status") return { status: st.status, hasSession: !!st.sessionId, output: st.output === void 0 ? void 0 : preview(st.output, 4e3), error: st.error };
    if (action === "tail") return messages(x, t.id, Math.min(Math.max(Number(a.lines) || 6, 1), 50));
    if (action === "steer" && x.busy.has(t.id)) return steer(x, t.id, input);
    if (action === "start" || action === "steer") {
      track(x, invoke(x, t.id, input, [caller], true));
      return { status: "started" };
    }
  }
  if (t.type === "user_prompt" || t.type === "yes_no_prompt") return { answer: await invoke(x, t.id, input, [caller], true) };
  const run = invoke(x, t.id, input, [caller], true);
  let timer;
  const outcome = await Promise.race([run.then((output) => ({ output })), new Promise((r) => {
    timer = setTimeout(() => r({ timedOut: true }), timeoutMs);
  })]).finally(() => clearTimeout(timer));
  if ("timedOut" in outcome) {
    track(x, run);
    return { status: "timed_out", note: "The block keeps working; check it with action status or workflow_block_messages." };
  }
  return { status: "succeeded", output: preview(outcome.output, 2e4) };
}
var mod = {
  id: "workflow-runner",
  moduleApiVersion: 1,
  async activate(ctx2) {
    ctxRef = ctx2;
    db2 = await ctx2.host.db.openNamespace("workflow-runner");
    await ctx2.host.db.exec(db2, "CREATE TABLE IF NOT EXISTS definitions(id TEXT PRIMARY KEY, project TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL); CREATE INDEX IF NOT EXISTS definitions_project ON definitions(project); CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, project TEXT NOT NULL, workflow TEXT NOT NULL, created TEXT NOT NULL, data TEXT NOT NULL, env TEXT NOT NULL); CREATE INDEX IF NOT EXISTS runs_workflow ON runs(project, workflow, created)");
    initEngine(ctx2, save);
    ctx2.events.on("agent-runner.toolActivity", async (event) => {
      if (!event.workflow?.runId || !event.workflow?.blockId) return;
      try {
        recordMcpActivity(await execFor(event.workflow.runId), event.workflow.blockId, event.sessionId, event.update);
      } catch (e) {
        ctx2.log.warn("MCP activity trace", errMsg(e));
      }
    });
    ctx2.events.on("agent-runner.providerTurn", async (event) => {
      try {
        recordProviderTurn(await execFor(event.workflow.runId), event);
      } catch (e) {
        ctx2.log.warn("Workflow provider turn", errMsg(e));
      }
    });
    await initMcp(ctx2, db2, {
      list: (s) => s.kind === "run" ? RUN_TOOLS : CONFIG_TOOLS,
      call: (s, name, args) => s.kind === "run" ? runTool(s, name, args) : configTool(s, name, args)
    });
    for (const r of await ctx2.host.db.query(db2, "SELECT id, data FROM runs")) {
      const run = JSON.parse(r.data);
      if (run.status !== "running" && run.status !== "waiting") continue;
      run.status = "failed";
      run.error = "Interrupted: the workflow runtime restarted. Sessions and outputs remain for inspection.";
      run.completedAt = now3();
      for (const s of run.blocks) if (["running", "waiting_timer", "waiting_trigger", "waiting_input", "awaiting_user_input", "awaiting_permission", "queued"].includes(s.status)) {
        s.status = "failed";
        s.error = "Interrupted by a runtime restart";
      }
      await ctx2.host.db.exec(db2, "UPDATE runs SET data=? WHERE id=?", [JSON.stringify(run), run.id]);
    }
  },
  canSwap: () => {
    const active = [...execs.values()].filter((x) => x.driving || x.busy.size || x.timers.size || x.triggers.size || x.inputs.size || x.answers.size || x.background.size).length;
    return { ok: active === 0 && runningApps() === 0, reason: "Workflow runs or Run App processes are active" };
  },
  async deactivate(ctx2) {
    const released = await releaseAllTriggers();
    if (released) ctx2.log.info(`released ${released} armed workflow trigger${released === 1 ? "" : "s"}`);
    if (flushTimer) clearTimeout(flushTimer);
    await flush();
  },
  methods: {
    health: () => ({ ok: true, version: WORKFLOW_RUNNER_VERSION, workflowTurnBoundaries: true, active: [...execs.values()].filter((x) => x.driving || x.busy.size || x.timers.size || x.triggers.size || x.inputs.size || x.answers.size).length, apps: runningApps() }),
    setPreferences(_ctx, a, meta) {
      gateway(meta);
      setAutonomousClaudeTurns(a.trackAutonomousClaudeTurns !== false);
      return null;
    },
    async list(_ctx, a) {
      return listDefinitions(String(a.projectId));
    },
    async get(_ctx, a) {
      return definition(String(a.projectId), String(a.id));
    },
    async save(_ctx, a, meta) {
      gateway(meta);
      return saveDefinition(String(a.projectId), a.definition, a.expectedRevision === void 0 ? void 0 : a.expectedRevision, a.available, a.mcpEnv);
    },
    async remove(ctx2, a, meta) {
      gateway(meta);
      const active = [...execs.values()].some((x) => x.run.workflowId === a.id && x.run.projectId === a.projectId && (x.driving || x.busy.size));
      if (active) throw new Error("Cancel this workflow's active runs before deleting it");
      await ctx2.host.db.exec(db2, "DELETE FROM definitions WHERE id=? AND project=?", [String(a.id), String(a.projectId)]);
      return null;
    },
    templates: () => WORKFLOW_TEMPLATES.map((t) => ({ id: t.id, name: t.name, description: t.description })),
    starter: (_ctx, a) => starter(a.templateId),
    async start(ctx2, a, meta) {
      gateway(meta);
      const env = a.env;
      if (!env?.root?.startsWith("/") || !env.workspaceId || !Array.isArray(env.profiles)) throw new Error("Invalid workflow run environment");
      const { definition: def } = await definition(String(a.projectId), String(a.workflowId));
      const issues = blockingIssues(validateWorkflow(def, { profiles: env.profiles, mcps: env.mcpServers }));
      if (issues.length) throw new Error(`Fix the workflow first: ${issues.slice(0, 3).map((i) => i.message).join("; ")}`);
      if (a.startBlockId && !def.blocks.some((b) => b.id === a.startBlockId)) throw new Error("Unknown start block");
      const run = {
        id: crypto.randomUUID(),
        workflowId: def.id,
        workflowName: def.name,
        projectId: String(a.projectId),
        workspaceId: env.workspaceId,
        status: "running",
        input: String(a.input ?? "").slice(0, 2e5),
        ...a.startBlockId ? { startBlockId: String(a.startBlockId) } : {},
        createdAt: now3(),
        definition: def,
        blocks: def.blocks.map((b) => ({ blockId: b.id, status: "idle", runs: 0, log: [] }))
      };
      await ctx2.host.db.exec(db2, "INSERT INTO runs(id,project,workflow,created,data,env) VALUES(?,?,?,?,?,?)", [run.id, run.projectId, run.workflowId, run.createdAt, JSON.stringify(run), JSON.stringify(env)]);
      const old = await ctx2.host.db.query(db2, "SELECT id FROM runs WHERE project=? AND workflow=? ORDER BY created DESC LIMIT -1 OFFSET 30", [run.projectId, run.workflowId]);
      for (const r of old) if (!execs.get(r.id)?.driving) {
        execs.delete(r.id);
        await ctx2.host.db.exec(db2, "DELETE FROM runs WHERE id=?", [r.id]);
        await revokeWhere(ctx2, (s) => s.kind === "run" && s.runId === r.id);
      }
      const x = newExec(run, env);
      const failure = await armTriggers(x);
      if (failure) {
        settle(x);
        throw new Error(`Workflow run failed to start: ${failure}`);
      }
      openTextInputs(x);
      void drive(x).catch((e) => ctx2.log.error("workflow drive", errMsg(e)));
      return summary(run);
    },
    /** Open runs with what they are doing and what waits on the user (polled by the desktop rail). */
    active: () => [...execs.values()].filter((x) => !x.cancelled && (x.run.status === "running" || x.run.status === "waiting")).slice(0, 30).map((x) => ({
      runId: x.run.id,
      workflowId: x.run.workflowId,
      name: x.run.workflowName,
      projectId: x.run.projectId,
      workspaceId: x.run.workspaceId,
      status: x.run.status,
      createdAt: x.run.createdAt,
      running: x.run.blocks.filter((s) => s.status === "running").length,
      armed: x.triggers.size,
      inputs: x.inputs.size,
      attention: x.run.blocks.filter((s) => s.status === "awaiting_user_input" || s.status === "awaiting_permission").map((s) => ({
        blockId: s.blockId,
        label: x.def.blocks.find((b) => b.id === s.blockId)?.label || s.blockId,
        kind: s.status === "awaiting_permission" ? "permission" : "question",
        ...s.question ? { text: s.question.slice(0, 300) } : {}
      }))
    })),
    async runs(ctx2, a) {
      const rows = a.workflowId ? await ctx2.host.db.query(db2, "SELECT data FROM runs WHERE project=? AND workflow=? ORDER BY created DESC LIMIT 30", [String(a.projectId), String(a.workflowId)]) : await ctx2.host.db.query(db2, "SELECT data FROM runs WHERE project=? ORDER BY created DESC LIMIT 50", [String(a.projectId)]);
      return rows.map((r) => {
        const run = JSON.parse(r.data);
        return summary(execs.get(run.id)?.run || dirty.get(run.id) || run);
      });
    },
    async run(_ctx, a) {
      const live = execs.get(String(a.id))?.run;
      if (live) return detail(live);
      const stored = await loadRun(String(a.id));
      if (!stored) throw new Error("Workflow run not found");
      return detail(stored.run);
    },
    async blockOutput(_ctx, a) {
      const x = await execFor(String(a.runId)), out = stateOf(x, String(a.blockId)).output ?? "";
      const offset = Math.max(0, Number(a.offset) || 0), limit = Math.min(Math.max(Number(a.limit) || 64e3, 1), 2e5);
      return { text: out.slice(offset, offset + limit), total: out.length };
    },
    async cancel(_ctx, a, meta) {
      gateway(meta);
      const x = await execFor(String(a.id));
      await cancel(x);
      return summary(x.run);
    },
    async answer(_ctx, a, meta) {
      gateway(meta);
      const x = await execFor(String(a.runId));
      answer(x, String(a.blockId), String(a.pauseId), String(a.answer ?? ""));
      return null;
    },
    async sendText(_ctx, a, meta) {
      gateway(meta);
      return sendText(await execFor(String(a.runId)), String(a.blockId), String(a.text ?? ""));
    },
    async chat(_ctx, a, meta) {
      gateway(meta);
      const text = String(a.text || "").trim();
      if (!text) throw new Error("Message is empty");
      return chat(await execFor(String(a.runId)), String(a.blockId), text);
    },
    async promptSession(_ctx, a, meta) {
      gateway(meta);
      const x = await execFor(String(a.runId)), blockId = String(a.blockId);
      const b = x.def.blocks.find((b2) => b2.id === blockId);
      if (x.env.workspaceId !== a.workspaceId || !b || !isAgentBlock(b) || stateOf(x, blockId).sessionId !== a.id)
        throw new Error("Unknown workflow block session");
      const text = String(a.text || "").trim(), images = imageAttachments(a.images);
      if (!text && !images.length) throw new Error("Message is empty");
      return promptBlock(x, blockId, text, images);
    },
    /** Delete a finished run; returns its agent session ids for the gateway to remove. */
    async removeRun(ctx2, a, meta) {
      gateway(meta);
      const x = execs.get(String(a.id));
      if (x && (x.driving || x.busy.size || x.timers.size || x.triggers.size || x.inputs.size || x.answers.size || x.background.size)) throw new Error("Cancel the run before deleting it");
      const stored = await loadRun(String(a.id));
      if (!stored) return { sessions: [] };
      execs.delete(String(a.id));
      dirty.delete(String(a.id));
      await ctx2.host.db.exec(db2, "DELETE FROM runs WHERE id=?", [String(a.id)]);
      await revokeWhere(ctx2, (s) => s.kind === "run" && s.runId === a.id);
      return { sessions: stored.run.blocks.map((s) => s.sessionId).filter(Boolean) };
    },
    apps: (_ctx, a) => listApps(String(a.root)),
    async appAction(ctx2, a, meta) {
      gateway(meta);
      return appAction(ctx2, String(a.root), String(a.name), "", String(a.action), Number(a.lines) || 200);
    },
    /** Workflow MCP endpoint for a configurator agent created by the gateway. */
    async configEndpoint(ctx2, a, meta) {
      gateway(meta);
      return issueEndpoint(ctx2, { kind: "config", projectId: String(a.projectId), sessionId: String(a.sessionId), profiles: (a.profiles || []).map((p) => ({ id: String(p.id), provider: p.provider })), mcps: (a.mcps || []).map((m) => ({ id: String(m.id) })) });
    },
    async revokeConfig(ctx2, a, meta) {
      gateway(meta);
      await revokeWhere(ctx2, (s) => s.kind === "config" && s.sessionId === a.sessionId);
      return null;
    },
    async shutdownApps(ctx2, _a, meta) {
      gateway(meta);
      await killAllApps(ctx2);
      return null;
    }
  }
};
var index_default = mod;
export {
  index_default as default
};
