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
        const detail = d ? typeof d === "string" ? d : typeof d.message === "string" ? d.message : JSON.stringify(d) : "";
        const e = new Error((msg.error.message || "JSON-RPC error") + (detail && !String(msg.error.message).includes(detail) ? `: ${detail.slice(0, 600)}` : ""));
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

// ../sdk/library.ts
var LIBRARY_PREFIX = "library:";
var isLibraryRef = (path) => typeof path === "string" && path.startsWith(LIBRARY_PREFIX);
function textDigest(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36) + ":" + text.length.toString(36);
}

// ../sdk/persistent-agents.ts
function agentProgress(args) {
  const n = Number(args?.percent);
  if (!Number.isFinite(n)) throw new Error("percent must be a number from 0 to 100");
  const note = typeof args?.note === "string" ? args.note.trim().slice(0, 80) : "";
  return { percent: Math.round(Math.max(0, Math.min(100, n))), ...note ? { note } : {}, at: Date.now() };
}
var REPORT_PROGRESS_TOOL = {
  name: "report_progress",
  description: "Report roughly how much of the current user request is done (0–100) and optionally a few words on the current step. Hato shows it as a progress bar in its sidebar; it never appears in the chat. Call it when you start (e.g. 5), after major milestones, and with 100 when you finish. Cheap: never wait for or mention it.",
  inputSchema: { type: "object", properties: { percent: { type: "number", minimum: 0, maximum: 100 }, note: { type: "string", maxLength: 80, description: "Current step, a few words" } }, required: ["percent"], additionalProperties: false },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
};
var PROGRESS_INSTRUCTION = "Progress: while working on a request, call the report_progress tool with your rough percent done (start ≈5, major milestones, 100 when finished). It feeds Hato's sidebar only — don't mention it in replies.";

// modules/services/internal-remote-mcp/src/index.ts
var db;
var listener = null;
var scopes = /* @__PURE__ */ new Map();
var connections = /* @__PURE__ */ new Map();
var proxy = `const net=require('node:net');const s=net.connect({host:'127.0.0.1',port:Number(process.env.HATO_MCP_PORT)},()=>{s.write(JSON.stringify({token:process.env.HATO_MCP_TOKEN})+'\\n');process.stdin.pipe(s)});s.pipe(process.stdout);s.on('error',e=>{console.error(e.message);process.exit(1)});s.on('close',()=>process.exit(0));process.stdin.on('end',()=>s.end());`;
var object = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
var AGENT = { type: "object", description: "Background agent to start in the task", properties: { name: { type: "string", maxLength: 120 }, prompt: { type: "string", description: "First prompt for the agent" }, model: { type: "string", description: "Model id; defaults to this agent's model" } }, required: ["prompt"], additionalProperties: false };
var tools = [
  REPORT_PROGRESS_TOOL,
  { name: "agents_create", description: "Create a background worker inheriting this agent’s provider, workspace, instructions, MCP and skill permissions", inputSchema: object({ name: { type: "string" }, text: { type: "string" }, model: { type: "string" } }, ["name"]) },
  { name: "agents_stop", description: "Stop a background agent process", inputSchema: object({ id: { type: "string" } }, ["id"]) },
  { name: "agents_list", description: "List background agents in this workspace", inputSchema: object({}) },
  { name: "agents_history", description: "Read agent dialogue, capped at 20 messages and 16k characters. Images and reasoning are excluded. includeTools adds tool summaries; before pages earlier.", inputSchema: object({ id: { type: "string" }, before: { type: "number" }, includeTools: { type: "boolean" } }, ["id"]) },
  { name: "agents_prompt", description: "Prompt or steer a background agent in this workspace", inputSchema: object({ id: { type: "string" }, text: { type: "string" }, steer: { type: "boolean" } }, ["id", "text"]) },
  { name: "agents_cancel", description: "Cancel a background agent turn", inputSchema: object({ id: { type: "string" } }, ["id"]) },
  { name: "terminals_list", description: "List terminals belonging to this workspace", inputSchema: object({}) },
  { name: "terminals_read", description: "Read bounded terminal output", inputSchema: object({ key: { type: "string" }, cursor: { type: "number" } }, ["key"]) },
  { name: "terminals_write", description: "Write input to a workspace terminal, including commands ending with a newline", inputSchema: object({ key: { type: "string" }, text: { type: "string" } }, ["key", "text"]) },
  { name: "tasks_list", description: "List the Git tasks (branch + linked worktree) of this workspace's project. Requires the Hato desktop to be open.", inputSchema: object({}) },
  { name: "tasks_create", description: "Create a Git task in this workspace's project, optionally starting a background agent in it with a prompt. Needs the user's approval in the Hato desktop unless this agent runs on autopilot. With `branch`, an existing local branch is checked out, a branch on exactly one remote is tracked, otherwise a new branch is created from HEAD; without it a task/<name>-<id> branch is generated. The new agent inherits this agent's provider, model, instructions, skills, MCP servers and autopilot.", inputSchema: object({ name: { type: "string", maxLength: 100 }, branch: { type: "string", maxLength: 200 }, agent: AGENT }) },
  { name: "tasks_start_agent", description: "Start a background agent with a prompt in an existing Git task of this project (task ids come from tasks_list). Needs the user's approval in the Hato desktop unless this agent runs on autopilot. The agent inherits this agent's provider, model, instructions, skills, MCP servers and autopilot.", inputSchema: object({ taskId: { type: "string" }, agent: AGENT }, ["taskId", "agent"]) },
  { name: "tasks_reconcile", description: "Refresh task statuses for this workspace's project against `git worktree list`. Never deletes anything. Requires the Hato desktop to be open.", inputSchema: object({}) },
  { name: "skills_list", description: "List this agent's instruction file and selected skills with the current fingerprint of each text. Compare with the [fingerprint] of the copy in your context; re-read any that differ or that you no longer have.", inputSchema: object({}), annotations: { readOnlyHint: true } },
  { name: "skills_read", description: "Read the current text of this agent's instruction file or a selected skill (path from skills_list), with its fingerprint", inputSchema: object({ path: { type: "string" } }, ["path"]), annotations: { readOnlyHint: true } }
];
async function ctl(ctx, scope, op, args = {}) {
  if (!scope.daemon) throw new Error("No daemon for this endpoint");
  const grant = await ctx.host.capabilities.request({ kind: "process", root: scope.root });
  try {
    const r = await ctx.host.process.run(grant.grant, { executable: scope.daemon.bin, args: ["daemon", "ctl", "--dir", scope.daemon.dir], cwd: scope.root }, { stdin: JSON.stringify({ op, args }) + "\n", timeoutMs: 3e4 });
    if (r.code !== 0) throw new Error(r.stderr || "Daemon control failed");
    const v = JSON.parse(r.stdout);
    if (!v.ok) throw new Error(v.error?.message || "Daemon request failed");
    return v.value;
  } finally {
    await ctx.host.capabilities.release(grant.grant);
  }
}
async function agentCall(ctx, s, method, args) {
  return s.daemon ? ctx.modules.call("agent-runner", method, args) : ctx.modules.call("persistent-agents", method, { ...args, workspaceId: s.workspaceId });
}
var TASK_OPS = { tasks_list: "list", tasks_create: "create", tasks_reconcile: "reconcile", tasks_start_agent: "startAgent" };
var TASK_TIMEOUT_MS = 10 * 60 * 1e3;
var CLAIM_RETRY_MS = 60 * 1e3;
var taskRequests = /* @__PURE__ */ new Map();
function agentArg(a) {
  if (a == null) return void 0;
  if (typeof a !== "object" || typeof a.prompt !== "string" || !a.prompt.trim()) throw new Error("agent.prompt is required");
  if (a.prompt.length > 128 * 1024) throw new Error("agent.prompt is too large");
  return { name: typeof a.name === "string" ? a.name.slice(0, 120) : "", prompt: a.prompt, model: typeof a.model === "string" ? a.model.slice(0, 200) : "" };
}
function taskArgs(op, a) {
  if (op === "startAgent") {
    if (typeof a.taskId !== "string" || !a.taskId) throw new Error("taskId is required");
    const agent = agentArg(a.agent);
    if (!agent) throw new Error("agent is required");
    return { taskId: a.taskId, agent };
  }
  if (op !== "create") return {};
  const name = typeof a.name === "string" ? a.name.trim().slice(0, 100) : "", branch = typeof a.branch === "string" ? a.branch.trim().slice(0, 200) : "";
  if (!name && !branch) throw new Error("Provide a task name or a branch");
  return { name, branch, agent: agentArg(a.agent) };
}
function queueTask(s, op, args) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      taskRequests.delete(id);
      reject(new Error("The Hato desktop did not handle this request in time (is it open and was the request approved?)"));
    }, TASK_TIMEOUT_MS);
    taskRequests.set(id, { id, sessionId: s.sessionId, workspaceId: s.workspaceId, op, args, createdAt: Date.now(), claimedAt: null, resolve, reject, timer });
  });
}
function finishTask(id, outcome) {
  const r = taskRequests.get(id);
  if (!r) return false;
  taskRequests.delete(id);
  clearTimeout(r.timer);
  if (typeof outcome.error === "string") r.reject(new Error(outcome.error));
  else r.resolve(outcome.value ?? null);
  return true;
}
async function call(ctx, s, name, a) {
  if (name === "report_progress") return ctx.modules.call("agent-runner", "setProgress", { sessionId: s.sessionId, ...agentProgress(a) });
  if (TASK_OPS[name]) {
    const op = TASK_OPS[name], args = taskArgs(op, a);
    if (!s.daemon) return ctx.modules.call("persistent-agents", "taskRequest", { sessionId: s.sessionId, workspaceId: s.workspaceId, op, args }, { timeoutMs: TASK_TIMEOUT_MS });
    return queueTask(s, op, args);
  }
  if (name.startsWith("agents_")) {
    const list = await agentCall(ctx, s, "list", {});
    const permitted = list.filter((r) => r.workspaceId === s.workspaceId && r.root === s.root);
    if (name === "agents_list") return permitted;
    if (name === "agents_create") {
      if (!permitted.some((r) => r.id === s.sessionId)) throw new Error("This endpoint is not attached to a background agent");
      return agentCall(ctx, s, "fork", { parentId: s.sessionId, name: a.name, text: a.text, model: a.model });
    }
    if (!permitted.some((r) => r.id === a.id)) throw new Error("Agent is outside this workspace");
    if (name === "agents_history") {
      const view = await agentCall(ctx, s, "view", { id: a.id, before: a.before, limit: 20 });
      let budget = 16e3;
      const messages = [];
      for (const m of [...view.messages].reverse()) {
        if (budget <= 0) break;
        if (m.role !== "user" && m.role !== "assistant" && !(a.includeTools === true && m.role === "tool")) continue;
        const text = String(m.text || "").slice(0, Math.min(4e3, budget));
        budget -= text.length;
        messages.unshift({ key: m.key, role: m.role, text, truncated: text.length < String(m.text || "").length });
      }
      const first = messages[0]?.key || view.messages[0]?.key;
      return { id: a.id, messages, before: first ? Number(String(first).replace("agent-msg-", "")) : view.before, hasOlder: view.before !== null || budget <= 0 };
    }
    if (name === "agents_prompt") return agentCall(ctx, s, "send", { id: a.id, text: a.text, steer: a.steer });
    if (name === "agents_cancel") return agentCall(ctx, s, "cancel", { id: a.id });
    if (name === "agents_stop") return agentCall(ctx, s, "stop", { id: a.id });
  }
  if (name.startsWith("terminals_")) {
    if (!s.daemon) {
      const map = { terminals_list: "list_tabs", terminals_read: "tail", terminals_write: "send" };
      return ctx.modules.call("terminals", "workspaceControl", { tool: map[name], args: { ...a, tab: a.key }, scope: { workspaceId: s.workspaceId, conversationId: s.sessionId, machineId: "local" } });
    }
    const list = await ctl(ctx, s, "resources.list");
    const allowed = (list.ptys || []).filter((p) => p.cwd === s.root || p.cwd.startsWith(s.root.replace(/\/$/, "") + "/"));
    if (name === "terminals_list") return allowed;
    if (!allowed.some((p) => p.key === a.key)) throw new Error("Terminal is outside this workspace");
    return ctl(ctx, s, name === "terminals_read" ? "pty.read" : "pty.write", { key: a.key, cursor: a.cursor, limitBytes: 65536, text: a.text });
  }
  if (name === "skills_list") {
    const out = [];
    for (const path of s.skills) {
      try {
        out.push({ path, fingerprint: textDigest(await skillText(ctx, s, path)) });
      } catch (e) {
        out.push({ path, error: errMsg(e) });
      }
    }
    return out;
  }
  if (name === "skills_read") {
    if (!s.skills.includes(a.path)) throw new Error("Skill is not enabled for this session");
    const text = await skillText(ctx, s, a.path);
    return { path: a.path, fingerprint: textDigest(text), text };
  }
  throw new Error("Unknown workspace tool");
}
async function skillText(ctx, s, path) {
  if (isLibraryRef(path)) {
    const text = s.inline?.[path];
    if (text === void 0) throw new Error("Library skill text is unavailable; reselect the skill");
    return text;
  }
  const g = await ctx.host.capabilities.request({ kind: "fs", root: s.root });
  try {
    const f = await ctx.host.fs.read(g.grant, path, 128 * 1024);
    if (f.binary || f.truncated) throw new Error("Skill file is binary or too large");
    return f.text || "";
  } finally {
    await ctx.host.capabilities.release(g.grant);
  }
}
var inflight = 0;
function attachPeer(ctx, handle, c) {
  c.peer = new JsonRpcPeer((line) => ctx.host.net.write(handle, line + "\n"));
  c.peer.onRequest = async (method, params) => {
    const s = scopes.get(c.token);
    if (!s) throw rpcError(-32001, "MCP access revoked");
    if (method === "initialize") return { protocolVersion: ["2024-11-05", "2025-03-26", "2025-06-18"].includes(params?.protocolVersion) ? params.protocolVersion : "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "internal-remote-mcp", version: "0.1.0" }, instructions: PROGRESS_INSTRUCTION };
    if (method === "ping") return {};
    if (method === "tools/list") return { tools };
    if (method === "tools/call") {
      inflight++;
      try {
        const value = await call(ctx, s, params.name, params.arguments || {});
        return { content: [{ type: "text", text: JSON.stringify(value) }] };
      } catch (e) {
        return { content: [{ type: "text", text: errMsg(e) }], isError: true };
      } finally {
        inflight--;
      }
    }
    throw rpcError(-32601, "Unknown MCP method");
  };
}
async function connection(ctx, handle, token = null) {
  const c = { token, buffer: "", peer: null };
  connections.set(handle, c);
  if (token) attachPeer(ctx, handle, c);
  await ctx.host.streams.listen(handle, {}, (chunk) => {
    if (c.peer) {
      c.peer.feed(chunk);
      return;
    }
    c.buffer += chunk;
    const i = c.buffer.indexOf("\n");
    if (i < 0) {
      if (c.buffer.length > 4096) void ctx.host.net.close(handle);
      return;
    }
    let first;
    try {
      first = JSON.parse(c.buffer.slice(0, i)).token;
    } catch {
    }
    if (typeof first !== "string" || !scopes.has(first)) {
      void ctx.host.net.close(handle);
      return;
    }
    c.token = first;
    attachPeer(ctx, handle, c);
    const rest = c.buffer.slice(i + 1);
    c.buffer = "";
    if (rest) c.peer.feed(rest);
  }, () => {
    connections.delete(handle);
    void ctx.host.net.close(handle).catch(() => {
    });
  });
}
async function listen(ctx) {
  if (listener) return listener;
  listener = await ctx.host.net.listenLoopback();
  await acceptLoop(ctx);
  return listener;
}
async function acceptLoop(ctx) {
  let pending = "";
  await ctx.host.streams.listen(listener.handle, {}, (chunk) => {
    pending += chunk;
    let i;
    while ((i = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, i);
      pending = pending.slice(i + 1);
      try {
        const e = JSON.parse(line);
        if (e.connection) void connection(ctx, e.connection);
      } catch {
      }
    }
  });
}
var mod = {
  id: "internal-remote-mcp",
  moduleApiVersion: 1,
  async activate(ctx, prev) {
    db = await ctx.host.db.openNamespace("internal-remote-mcp");
    await ctx.host.db.exec(db, "CREATE TABLE IF NOT EXISTS scopes(token TEXT PRIMARY KEY,data TEXT NOT NULL)");
    for (const r of await ctx.host.db.query(db, "SELECT data FROM scopes")) {
      const s = JSON.parse(r.data);
      scopes.set(s.token, s);
    }
    if (prev?.listener) {
      listener = prev.listener;
      await acceptLoop(ctx);
      for (const c of prev.conns || []) await connection(ctx, c.handle, c.token);
    }
  },
  snapshot: () => ({ listener, conns: [...connections].filter(([, c]) => c.token).map(([handle, c]) => ({ handle, token: c.token })) }),
  // Endpoints survive swaps (above); only running tool calls and pending task approvals hold one back.
  canSwap: () => ({ ok: inflight === 0 && taskRequests.size === 0, reason: "A workspace tool call or task request is in progress" }),
  methods: {
    /** Static workspace tool catalog (same list served by tools/list). */
    tools: () => tools.map((t) => ({ name: String(t.name), title: t.title || void 0, description: String(t.description || ""), readOnly: !!t.annotations?.readOnlyHint, destructive: !!t.annotations?.destructiveHint })),
    /** Desktop gateway (over the daemon link): take unclaimed task requests. A claim that was not resolved is offered again later. */
    async claimTaskRequests(ctx, _a, meta) {
      if (meta.caller !== "daemon-client") throw new Error("Only the desktop gateway handles task requests");
      const now = Date.now(), out = [];
      for (const r of taskRequests.values()) if (r.claimedAt === null || now - r.claimedAt > CLAIM_RETRY_MS) {
        r.claimedAt = now;
        out.push({ id: r.id, sessionId: r.sessionId, workspaceId: r.workspaceId, op: r.op, args: r.args, createdAt: r.createdAt });
      }
      return out;
    },
    async resolveTaskRequest(ctx, a, meta) {
      if (meta.caller !== "daemon-client") throw new Error("Only the desktop gateway handles task requests");
      return finishTask(String(a.id), { value: a.value, error: typeof a.error === "string" ? a.error : void 0 });
    },
    async endpoint(ctx, a, meta) {
      if (!["agent-runner", "persistent-agents", "daemon-client"].includes(meta.caller)) throw new Error("Only the session controller can issue workspace endpoints");
      let root = String(a.root || "");
      if (!a.daemon) {
        const d = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
        if (d.location !== "local") throw new Error("Standalone endpoint requires a local workspace");
        root = d.rootAbsolutePath;
      }
      const g = await ctx.host.capabilities.request({ kind: "fs", root });
      await ctx.host.capabilities.release(g.grant);
      const scope = { sessionId: String(a.sessionId), workspaceId: String(a.workspaceId), root: g.root, skills: Array.isArray(a.skills) ? a.skills : [], inline: a.inline && typeof a.inline === "object" ? a.inline : {}, daemon: a.daemon, token: crypto.randomUUID() + crypto.randomUUID() };
      scopes.set(scope.token, scope);
      await ctx.host.db.exec(db, "INSERT INTO scopes(token,data) VALUES(?,?)", [scope.token, JSON.stringify(scope)]);
      const l = await listen(ctx);
      return { id: "internal-remote-mcp", name: "internal-remote-mcp", command: "node", args: ["-e", proxy], env: [{ name: "HATO_MCP_PORT", value: String(l.port) }, { name: "HATO_MCP_TOKEN", value: scope.token }] };
    },
    /** Replace Library text for a session's endpoints after a Library edit (no reconnect needed). */
    async updateInline(ctx, a, meta) {
      if (!["agent-runner", "persistent-agents", "daemon-client"].includes(meta.caller)) throw new Error("Only session controllers update endpoints");
      for (const [t, s] of scopes) if (s.sessionId === a.sessionId) {
        const next = { ...s.inline || {} };
        for (const [k, v] of Object.entries(a.inline || {})) if (s.skills.includes(k) && typeof v === "string") next[k] = v;
        s.inline = next;
        await ctx.host.db.exec(db, "UPDATE scopes SET data=? WHERE token=?", [JSON.stringify(s), t]);
      }
      return null;
    },
    async revoke(ctx, a, meta) {
      if (!["agent-runner", "persistent-agents", "daemon-client"].includes(meta.caller)) throw new Error("Only session controllers revoke endpoints");
      for (const r of [...taskRequests.values()]) if (r.sessionId === a.sessionId) finishTask(r.id, { error: "Agent endpoint was revoked" });
      for (const [t, s] of scopes) if (s.sessionId === a.sessionId) {
        scopes.delete(t);
        await ctx.host.db.exec(db, "DELETE FROM scopes WHERE token=?", [t]);
        for (const [h, c] of connections) if (c.token === t) await ctx.host.net.close(h).catch(() => {
        });
      }
      return null;
    }
  }
};
var index_default = mod;
export {
  index_default as default
};
