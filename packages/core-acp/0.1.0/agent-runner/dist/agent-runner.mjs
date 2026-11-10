// sdk/runtime.ts
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
function rpcError(code, message2, data) {
  const e = new Error(message2);
  e.rpcCode = code;
  e.data = data;
  return e;
}
function errMsg(e) {
  return e && (e.message || String(e)) || "unknown error";
}

// sdk/persistent-agents.ts
function modelChoices(state) {
  const option = state.configOptions?.find((o) => o.category === "model");
  if (option) {
    const flatten = (options) => options.flatMap((o) => Array.isArray(o.options) ? flatten(o.options) : [o]);
    return flatten(option.options || []).map((o) => ({ id: String(o.value), label: o.name || String(o.value), configId: option.id }));
  }
  return (state.models?.availableModels || []).map((m) => ({ id: m.modelId, label: m.name || m.modelId, configId: "__model" }));
}
function relativeAgentPath(value) {
  if (typeof value !== "string" || !value || value.startsWith("/") || value.includes("\\") || value.split("/").some((p) => p === ".." || !p)) throw new Error("Expected a workspace-relative instruction path");
  return value;
}

// sdk/workflow-provider-options.ts
function advertisedChoices(session2) {
  const thought = session2.configOptions?.find((o) => o.category === "thought_level" && o.type !== "boolean");
  const flatten = (items) => items.flatMap((o) => Array.isArray(o.options) ? flatten(o.options) : [o]);
  return {
    models: modelChoices(session2).map((m) => ({ value: m.id, label: m.label })),
    reasoning: thought ? flatten(thought.options || []).filter((o) => typeof o.value === "string").map((o) => ({ value: o.value, label: o.name || o.value })) : [],
    reasoningId: thought?.id
  };
}

// sdk/agent-executable.ts
async function agentExecutable(ctx, grant, root, executable) {
  for (const mode of ["-lc", "-ic"]) {
    const probe = `exec /bin/sh -c 'p=$(command -v -- "$1") || exit; printf "\\n__HATO_EXEC__=%s\\n__HATO_PATH__=%s\\n" "$p" "$PATH"' hato-agent-detect `;
    const quote = (s) => "'" + s.replace(/'/g, "'\\''") + "'";
    const result = await ctx.host.process.run(grant, {
      target: { kind: "local" },
      executable: "/bin/sh",
      args: ["-c", 'exec "${SHELL:-/bin/sh}" "$1" "$2"', "hato-agent-shell", mode, probe + quote(executable)],
      cwd: root
    }, { timeoutMs: 2e4 });
    const path = /^__HATO_EXEC__=(.+)$/m.exec(result.stdout)?.[1];
    const pathEnv = /^__HATO_PATH__=(.+)$/m.exec(result.stdout)?.[1];
    if (result.code === 0 && path && pathEnv) return { path, pathEnv };
  }
  throw new Error(`ACP adapter '${executable}' was not found in the daemon user's login or interactive shell PATH. Install it for that user on this machine or configure an absolute executable path.`);
}

// modules/services/agent-runner/src/index.ts
var db;
var sessions = /* @__PURE__ */ new Map();
var live = /* @__PURE__ */ new Map();
var locks = /* @__PURE__ */ new Map();
var now = () => (/* @__PURE__ */ new Date()).toISOString();
var writes = Promise.resolve();
function serialize(id, f) {
  const p = (locks.get(id) || Promise.resolve()).catch(() => {
  }).then(f);
  locks.set(id, p);
  void p.finally(() => {
    if (locks.get(id) === p) locks.delete(id);
  }).catch(() => {
  });
  return p;
}
function enqueue(f) {
  const p = writes.catch(() => {
  }).then(f);
  writes = p;
  return p;
}
function persist(ctx, s) {
  s.updatedAt = now();
  s.revision++;
  const json = JSON.stringify(s);
  return enqueue(() => ctx.host.db.exec(db, "INSERT INTO sessions(id, data) VALUES(?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data", [s.id, json]));
}
function message(ctx, s, role, text, title, status) {
  s.revision++;
  const turn = live.get(s.id)?.turn || 0;
  return enqueue(async () => {
    if (role === "assistant" || role === "thought") {
      const last = (await ctx.host.db.query(db, "SELECT seq,role,turn FROM messages WHERE session_id=? ORDER BY seq DESC LIMIT 1", [s.id]))[0];
      if (last?.role === role && last.turn === turn) return ctx.host.db.exec(db, "UPDATE messages SET text=text||? WHERE seq=?", [text, last.seq]);
    }
    return ctx.host.db.exec(db, "INSERT INTO messages(session_id, role, text, title, status, turn) VALUES(?,?,?,?,?,?)", [s.id, role, text, title || null, status || null, turn]);
  });
}
function publicSession(s) {
  return { ...s, profile: { ...s.profile, envRefs: {} }, mcps: s.mcps.map((m) => ({ ...m, env: [], ...Array.isArray(m.headers) ? { headers: m.headers.map((h) => ({ name: h.name, value: "" })) } : {} })) };
}
function session(id) {
  const s = sessions.get(String(id));
  if (!s) throw new Error("Unknown persistent agent");
  return s;
}
async function request(c, method, args, ms = 12e4) {
  let timer;
  try {
    return await Promise.race([c.peer.request(method, args), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${method} timed out`)), ms);
    })]);
  } finally {
    clearTimeout(timer);
  }
}
async function config(ctx, c, id, value) {
  if (c.session.status !== "ready") throw new Error("Agent must be idle to change model");
  if (id === "__model") {
    await request(c, "session/set_model", { sessionId: c.session.sessionId, modelId: value });
    c.session.models = { ...c.session.models, currentModelId: value };
  } else {
    const r = await request(c, "session/set_config_option", { sessionId: c.session.sessionId, configId: id, value });
    if (r.configOptions) c.session.configOptions = r.configOptions;
  }
  c.session.model = value;
  await persist(ctx, c.session);
}
function update(ctx, c, u) {
  const kind = u.sessionUpdate;
  if (kind === "agent_message_chunk" || kind === "agent_thought_chunk") {
    if (u.content?.type === "text") void message(ctx, c.session, kind === "agent_thought_chunk" ? "thought" : "assistant", String(u.content.text || "")).catch((e) => ctx.log.error(errMsg(e)));
  } else if (kind === "tool_call" || kind === "tool_call_update") {
    if (c.session.workflow) ctx.events.emit("agent-runner.toolActivity", { sessionId: c.session.id, workflow: c.session.workflow, update: u });
    const text = (u.content || []).map((x) => x.content?.text || x.text || "").join("\n");
    const titles = c.toolTitles ?? (c.toolTitles = /* @__PURE__ */ new Map());
    if (u.toolCallId && u.title) titles.set(u.toolCallId, u.title);
    const title = u.title || titles.get(u.toolCallId) || u.toolCallId || "Tool";
    if (titles.size > 500) titles.delete(titles.keys().next().value);
    void message(ctx, c.session, "tool", text, title, u.status).catch((e) => ctx.log.error(errMsg(e)));
  } else if (kind === "plan") {
    void message(ctx, c.session, "plan", (u.entries || []).map((e) => `- ${e.content} (${e.status})`).join("\n")).catch((e) => ctx.log.error(errMsg(e)));
  } else if (kind === "config_option_update") {
    c.session.configOptions = u.configOptions || [];
    void persist(ctx, c.session);
  }
}
async function readContext(ctx, s) {
  if (!s.agentFile && !s.skills.length) return "";
  const grant = await ctx.host.capabilities.request({ kind: "fs", root: s.root, target: { kind: "local" } });
  try {
    const parts = [];
    for (const path of [s.agentFile, ...s.skills].filter(Boolean)) {
      relativeAgentPath(path);
      const file = await ctx.host.fs.read(grant.grant, path, 128 * 1024);
      if (file.binary || file.truncated) throw new Error(`Instruction file is binary or too large: ${path}`);
      parts.push(`Instructions from ${path}:
${file.text || ""}`);
    }
    return parts.join("\n\n");
  } finally {
    await ctx.host.capabilities.release(grant.grant);
  }
}
async function stop(ctx, id) {
  const s = session(id), c = live.get(id);
  if (c) {
    c.stopping = true;
    c.queued = [];
    for (const p of c.permissions.values()) p.resolve({ outcome: { outcome: "cancelled" } });
    c.permissions.clear();
    await ctx.host.process.closeStdin(c.process).catch(() => {
    });
    await ctx.host.resources.release(c.process).catch(() => {
    });
    for (const sub of c.subscriptions) await sub.close().catch(() => {
    });
    c.peer.failAll("Agent stopped");
    live.delete(id);
  }
  await ctx.modules.call("internal-remote-mcp", "revoke", { sessionId: s.id }).catch(() => {
  });
  await ctx.host.db.exec(db, "UPDATE sessions SET queue_json='[]' WHERE id=?", [id]);
  await ctx.host.db.exec(db, "UPDATE permissions SET resolved=1 WHERE session_id=?", [id]);
  s.status = "stopped";
  await persist(ctx, s);
  return s;
}
async function start(ctx, s) {
  if (live.has(s.id)) return live.get(s.id);
  s.status = "starting";
  s.error = null;
  await persist(ctx, s);
  let c;
  try {
    const context = await readContext(ctx, s);
    const grant = await ctx.host.capabilities.request({ kind: "process", root: s.root, target: { kind: "local" } });
    let spawned;
    try {
      const env = { ...s.profile.envRefs || {} };
      const envRemove = s.profile.provider === "claude" && s.claudeSubscription ? ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"] : [];
      envRemove.forEach((k) => delete env[k]);
      const resolved = await agentExecutable(ctx, grant.grant, s.root, s.profile.executable);
      spawned = await ctx.host.process.spawn(grant.grant, {
        target: { kind: "local" },
        executable: ctx.host.env.info().platform === "macos" ? "/bin/zsh" : "/bin/sh",
        args: ["-lc", envRemove.length ? 'exec /usr/bin/env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN "$@"' : 'exec /usr/bin/env "$@"', "hato-agent", `PATH=${resolved.pathEnv}`, resolved.path, ...s.profile.args],
        cwd: s.root,
        env,
        envRemove
      });
    } finally {
      await ctx.host.capabilities.release(grant.grant);
    }
    c = { session: s, process: spawned.handle, peer: null, subscriptions: [], permissions: /* @__PURE__ */ new Map(), queued: [], cancelSent: false, stopping: false, context, firstPrompt: !s.contextSent, turn: Date.now(), stderr: "", steering: false };
    const connection = c;
    c.peer = new JsonRpcPeer((line) => ctx.host.process.write(connection.process, line + "\n"));
    live.set(s.id, c);
    c.peer.onNotification = (method, params) => {
      if (method === "session/update" && params?.sessionId === s.sessionId) update(ctx, connection, params.update || {});
    };
    c.peer.onRequest = async (method, params) => {
      if (method !== "session/request_permission") throw rpcError(-32601, "Unsupported agent request");
      if (params.sessionId !== s.sessionId) throw rpcError(-32602, "Wrong session");
      const tool = params.toolCall || {}, options = params.options || [];
      const allowOnce = options.find((o) => o.kind === "allow_once") || options.find((o) => String(o.kind).startsWith("allow"));
      if (s.autopilot && allowOnce) {
        ctx.log.info(`autopilot approved "${tool.title || tool.kind || "tool"}" for ${s.name}`);
        return { outcome: { outcome: "selected", optionId: allowOnce.optionId } };
      }
      const id = crypto.randomUUID();
      const value = { id, request: params, createdAt: now() };
      await ctx.host.db.exec(db, "INSERT INTO permissions(id,session_id,data) VALUES(?,?,?)", [id, s.id, JSON.stringify(value)]);
      s.status = "waiting";
      await persist(ctx, s);
      return new Promise((resolve) => connection.permissions.set(id, { value, resolve }));
    };
    c.subscriptions.push(await ctx.host.streams.listen(c.process, { channel: "stdout" }, (chunk) => connection.peer.feed(chunk), (error) => {
      if (connection.stopping) return;
      s.status = "interrupted";
      s.error = error ? errMsg(error) : `Agent exited${connection.stderr ? ": " + connection.stderr.slice(-600) : ""}`;
      connection.peer.failAll(s.error);
      live.delete(s.id);
      for (const p of connection.permissions.values()) p.resolve({ outcome: { outcome: "cancelled" } });
      void persist(ctx, s);
    }));
    c.subscriptions.push(await ctx.host.streams.listen(c.process, { channel: "stderr" }, (chunk) => {
      connection.stderr = (connection.stderr + chunk).slice(-4e3);
    }));
    const init = await request(c, "initialize", { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: "hato-agents", version: "0.1.0" } });
    if (init.protocolVersion !== 1) throw new Error("Unsupported ACP version");
    c.steering = init._meta?.steering?.supported === true;
    const caps = init.agentCapabilities?.mcpCapabilities || {};
    for (const m of s.mcps) if ((m.type === "http" || m.type === "sse") && !caps[m.type]) throw new Error(`${s.profile.name} cannot connect to ${m.type.toUpperCase()} MCP server “${m.name}”. Use a provider that supports it${m.type === "sse" ? " or switch the server to Streamable HTTP" : ""}.`);
    let mcpServers = s.mcps.map(({ id, ...server }) => server);
    if (s.workspaceMcp) {
      await ctx.modules.call("internal-remote-mcp", "revoke", { sessionId: s.id });
      const server = await ctx.modules.call("internal-remote-mcp", "endpoint", { sessionId: s.id, workspaceId: s.workspaceId, root: s.root, skills: s.skills, daemon: s.daemon });
      const { id, ...config2 } = server;
      mcpServers = [...mcpServers, config2];
    }
    let result;
    if (s.sessionId) {
      if (!init.agentCapabilities?.loadSession) throw new Error("Provider cannot reload this session; create a new agent to avoid losing its context");
      result = await request(c, "session/load", { sessionId: s.sessionId, cwd: s.root, mcpServers });
    } else {
      result = await request(c, "session/new", { cwd: s.root, mcpServers });
      if (typeof result.sessionId !== "string" || !result.sessionId) throw new Error("Provider did not return a session id");
      s.sessionId = result.sessionId;
    }
    s.configOptions = result.configOptions || [];
    s.models = result.models || null;
    s.status = "ready";
    if (s.model) {
      const choice = modelChoices(s).find((m) => m.id === s.model);
      if (!choice) throw new Error(`Provider does not advertise model ${s.model}`);
      await config(ctx, c, choice.configId, choice.id);
    }
    if (s.reasoning) {
      const choices = advertisedChoices(s);
      if (!choices.reasoningId || !choices.reasoning.some((o) => o.value === s.reasoning)) throw new Error(`Provider does not advertise reasoning ${s.reasoning} for this model`);
      const configured = await request(c, "session/set_config_option", { sessionId: s.sessionId, configId: choices.reasoningId, value: s.reasoning });
      if (configured.configOptions) s.configOptions = configured.configOptions;
    }
    await persist(ctx, s);
    return c;
  } catch (e) {
    if (c) {
      await stop(ctx, s.id);
    }
    s.status = "error";
    s.error = errMsg(e);
    await persist(ctx, s);
    throw e;
  }
}
async function prompt(ctx, c, text) {
  const s = c.session;
  if (s.status !== "ready") throw new Error("Agent is not idle");
  c.turn = Date.now();
  c.cancelSent = false;
  s.status = "busy";
  s.error = null;
  await message(ctx, s, "user", text);
  await persist(ctx, s);
  const context = c.firstPrompt ? c.context : "";
  c.firstPrompt = false;
  s.contextSent = true;
  await persist(ctx, s);
  void c.peer.request("session/prompt", { sessionId: s.sessionId, prompt: [{ type: "text", text: context ? `${context}

User request:
${text}` : text }] }).then(async (r) => {
    await enqueue(() => ctx.host.db.exec(db, "UPDATE permissions SET resolved=1 WHERE session_id=?", [s.id]));
    for (const pending of c.permissions.values()) pending.resolve({ outcome: { outcome: "cancelled" } });
    c.permissions.clear();
    if (c.stopping || live.get(s.id) !== c) return;
    s.status = "ready";
    await message(ctx, s, "system", `Turn ended: ${r.stopReason || "complete"}`);
    await persist(ctx, s);
    if (c.queued.length) {
      const next = c.queued.join("\n\n");
      c.queued = [];
      await ctx.host.db.exec(db, "UPDATE sessions SET queue_json='[]' WHERE id=?", [s.id]);
      await prompt(ctx, c, next);
    }
  }, async (e) => {
    if (c.stopping) return;
    if (live.get(s.id) !== c) return;
    s.status = "ready";
    s.error = errMsg(e);
    await message(ctx, s, "error", s.error);
    await persist(ctx, s);
  }).catch((e) => ctx.log.error(errMsg(e)));
  return { accepted: true };
}
var mod = {
  id: "agent-runner",
  moduleApiVersion: 1,
  async activate(ctx) {
    db = await ctx.host.db.openNamespace("agent-runner");
    await ctx.host.db.exec(db, "CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, data TEXT NOT NULL, queue_json TEXT NOT NULL DEFAULT '[]'); CREATE TABLE IF NOT EXISTS messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,session_id TEXT NOT NULL,role TEXT NOT NULL,text TEXT NOT NULL,title TEXT,status TEXT,turn INTEGER); CREATE INDEX IF NOT EXISTS messages_session ON messages(session_id,seq); CREATE TABLE IF NOT EXISTS permissions(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,data TEXT NOT NULL,resolved INTEGER NOT NULL DEFAULT 0)");
    for (const row of await ctx.host.db.query(db, "SELECT data FROM sessions")) {
      const s = JSON.parse(row.data);
      if (["starting", "ready", "busy", "waiting"].includes(s.status)) {
        s.status = "interrupted";
        s.error = "Runtime restarted; reconnect to resume. An interrupted turn is never replayed automatically.";
        await persist(ctx, s);
      }
      sessions.set(s.id, s);
    }
    await ctx.host.db.exec(db, "UPDATE permissions SET resolved=1 WHERE resolved=0");
  },
  canSwap: () => ({ ok: live.size === 0, reason: "Stop persistent agents before replacing their runtime" }),
  methods: {
    health: () => ({ ok: true, reasoning: true, mcpActivity: true, toolTitles: true, connected: live.size }),
    async fork(ctx, a, meta) {
      if (!["internal-remote-mcp", "daemon-client"].includes(meta.caller)) throw new Error("Only workspace controllers can create child agents");
      const parent = session(a.parentId);
      const spec = { ...parent, id: crypto.randomUUID(), name: String(a.name || "Background worker").slice(0, 120), model: String(a.model || parent.model), sessionId: null, contextSent: false, status: "starting", error: null, createdAt: now(), updatedAt: now(), revision: 0, configOptions: [], models: null };
      sessions.set(spec.id, spec);
      await persist(ctx, spec);
      const c = await serialize(spec.id, () => start(ctx, spec));
      if (a.text) await prompt(ctx, c, String(a.text));
      return publicSession(spec);
    },
    list: () => [...sessions.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(publicSession),
    async create(ctx, a) {
      const spec = a.spec;
      if (!spec || typeof spec.id !== "string" || !spec.name?.trim() || !spec.root?.startsWith("/") || !spec.profile?.executable || !Array.isArray(spec.profile.args) || !Array.isArray(spec.skills) || !Array.isArray(spec.mcps)) throw new Error("Invalid agent configuration");
      if (sessions.has(spec.id)) throw new Error("Agent already exists");
      const s = { ...spec, status: "starting", sessionId: null, createdAt: now(), updatedAt: now(), error: null, configOptions: [], models: null, revision: 0 };
      sessions.set(s.id, s);
      await persist(ctx, s);
      await serialize(s.id, () => start(ctx, s));
      return publicSession(s);
    },
    async view(ctx, a) {
      const s = session(a.id);
      await writes;
      const limit = Math.min(Math.max(Number(a.limit) || 100, 1), 200);
      const rows = await ctx.host.db.query(db, "SELECT * FROM messages WHERE session_id=? AND seq < ? ORDER BY seq DESC LIMIT ?", [s.id, Number(a.before) || Number.MAX_SAFE_INTEGER, limit + 1]);
      const older = rows.length > limit;
      if (older) rows.pop();
      rows.reverse();
      const messages = [];
      for (const r of rows) {
        const last = messages[messages.length - 1];
        if (last && (r.role === "assistant" || r.role === "thought") && last.role === r.role && last.turn === r.turn) last.text += r.text;
        else messages.push({ key: `agent-msg-${r.seq}`, role: r.role, text: r.text, title: r.title, status: r.status, ...{ turn: r.turn } });
      }
      const permissions = await ctx.host.db.query(db, "SELECT data FROM permissions WHERE session_id=? AND resolved=0 ORDER BY rowid", [s.id]);
      const queue = await ctx.host.db.query(db, "SELECT queue_json FROM sessions WHERE id=?", [s.id]);
      return { session: publicSession(s), messages, before: older ? rows[0].seq : null, permissions: permissions.map((p) => JSON.parse(p.data)), queued: JSON.parse(queue[0]?.queue_json || "[]") };
    },
    send: (ctx, a) => serialize(String(a.id), async () => {
      const s = session(a.id), text = String(a.text || "").trim();
      if (!text || text.length > 128 * 1024) throw new Error("Prompt is empty or too large");
      const c = await start(ctx, s);
      if (s.status === "busy" || s.status === "waiting") {
        if (a.steer !== true) throw new Error("Agent is busy; use Steer");
        let interrupt = !c.steering;
        if (c.steering && !c.queued.length) {
          let outcome = "unsupported";
          try {
            const r = await request(c, "_session/steering", { sessionId: s.sessionId, prompt: [{ type: "text", text }], _meta: { steering: { idleBehavior: "promptRequired" } } }, 3e4);
            outcome = r?.outcome === "promptRequired" ? "promptRequired" : "steered";
          } catch (e) {
            ctx.log.warn("steering failed; falling back to interrupt", errMsg(e));
            interrupt = true;
          }
          if (outcome === "steered") {
            await message(ctx, s, "user", text);
            await persist(ctx, s);
            return { steered: true };
          }
          if (outcome === "promptRequired") {
            if (s.status === "ready") return prompt(ctx, c, text);
            c.queued.push(text);
            await ctx.host.db.exec(db, "UPDATE sessions SET queue_json=? WHERE id=?", [JSON.stringify(c.queued), s.id]);
            return { queued: true };
          }
        }
        c.queued.push(text);
        await ctx.host.db.exec(db, "UPDATE sessions SET queue_json=? WHERE id=?", [JSON.stringify(c.queued), s.id]);
        if (interrupt && !c.cancelSent) {
          c.cancelSent = true;
          for (const p of c.permissions.values()) p.resolve({ outcome: { outcome: "cancelled" } });
          c.permissions.clear();
          await ctx.host.db.exec(db, "UPDATE permissions SET resolved=1 WHERE session_id=?", [s.id]);
          await c.peer.notify("session/cancel", { sessionId: s.sessionId });
        }
        return { queued: true };
      }
      return prompt(ctx, c, text);
    }),
    reconnect: (ctx, a) => serialize(String(a.id), async () => {
      const s = session(a.id);
      const auth = a.authorization && typeof a.authorization === "object" ? a.authorization : {};
      s.mcps = s.mcps.map((m) => typeof auth[m.id] === "string" && Array.isArray(m.headers) ? { ...m, headers: [...m.headers.filter((h) => String(h.name).toLowerCase() !== "authorization"), { name: "Authorization", value: auth[m.id] }] } : m);
      await start(ctx, s);
      return s;
    }),
    stop: (ctx, a) => serialize(String(a.id), () => stop(ctx, String(a.id))),
    async cancel(ctx, a) {
      const c = live.get(String(a.id));
      if (c) {
        for (const p of c.permissions.values()) p.resolve({ outcome: { outcome: "cancelled" } });
        c.permissions.clear();
        await ctx.host.db.exec(db, "UPDATE permissions SET resolved=1 WHERE session_id=?", [c.session.id]);
        await c.peer.notify("session/cancel", { sessionId: c.session.sessionId });
      }
      return null;
    },
    setModel: (ctx, a) => serialize(String(a.id), async () => {
      const c = live.get(String(a.id));
      if (!c) throw new Error("Reconnect agent first");
      const choice = modelChoices(c.session).find((m) => m.id === a.model);
      if (!choice) throw new Error("Unknown model");
      await config(ctx, c, choice.configId, choice.id);
      return c.session;
    }),
    async setAutopilot(ctx, a, meta) {
      if (meta.caller !== "daemon-client") throw new Error("Only the desktop gateway changes autopilot");
      const s = session(a.id), enabled = a.enabled === true;
      if (!!s.autopilot !== enabled) {
        s.autopilot = enabled;
        await persist(ctx, s);
        await message(ctx, s, "system", enabled ? "Autopilot enabled: tool permissions are approved automatically, including Git task creation (which still needs the desktop open)." : "Autopilot disabled: permission requests wait for review.");
        const c = live.get(s.id);
        if (enabled && c) for (const p of [...c.permissions.values()]) {
          const options = p.value.request.options || [];
          const allowOnce = options.find((o) => o.kind === "allow_once") || options.find((o) => String(o.kind).startsWith("allow"));
          if (!allowOnce) continue;
          await ctx.host.db.exec(db, "UPDATE permissions SET resolved=1 WHERE id=?", [p.value.id]);
          c.permissions.delete(p.value.id);
          p.resolve({ outcome: { outcome: "selected", optionId: allowOnce.optionId } });
        }
        if (c && c.session.status === "waiting" && !c.permissions.size) {
          c.session.status = "busy";
          await persist(ctx, c.session);
        }
      }
      return publicSession(s);
    },
    /** Change an agent's configuration. Anything besides the name restarts a connected agent; a new
     *  provider also starts a new provider session. Instructions are re-sent on the next prompt. */
    update: (ctx, a, meta) => serialize(String(a.id), async () => {
      if (meta.caller !== "daemon-client") throw new Error("Only the desktop gateway edits agents");
      const s = session(a.id), p = a.patch || {};
      const name = String(p.name || "").trim().slice(0, 120);
      if (!name) throw new Error("Agent name is required");
      if (p.profile !== void 0 && (!p.profile?.executable || !Array.isArray(p.profile.args) || !Array.isArray(p.skills) || !Array.isArray(p.mcps))) throw new Error("Invalid agent configuration");
      const configChanged = p.profile !== void 0 && JSON.stringify([s.profile, s.model, s.agentFile, s.skills, s.mcps, !!s.workspaceMcp]) !== JSON.stringify([p.profile, String(p.model || ""), p.agentFile || null, p.skills, p.mcps, !!p.workspaceMcp]);
      if (configChanged && ["busy", "waiting", "starting"].includes(s.status)) throw new Error("Wait for the agent to finish its turn, or cancel it, before changing its configuration");
      const wasLive = live.has(s.id);
      if (configChanged && wasLive) await stop(ctx, s.id);
      const newProvider = configChanged && s.profile.id !== p.profile.id;
      s.name = name;
      if (configChanged) {
        Object.assign(s, { profile: p.profile, model: String(p.model || ""), agentFile: p.agentFile || null, skills: p.skills, mcps: p.mcps, workspaceMcp: !!p.workspaceMcp, contextSent: false });
        if (newProvider) {
          s.sessionId = null;
          s.configOptions = [];
          s.models = null;
          s.reasoning = "";
        }
      }
      await persist(ctx, s);
      if (configChanged && wasLive) await start(ctx, s);
      return publicSession(s);
    }),
    /** Drop the conversation: history, pending permissions and queued steering, then a fresh provider session. */
    clear: (ctx, a, meta) => serialize(String(a.id), async () => {
      if (meta.caller !== "daemon-client") throw new Error("Only the desktop gateway clears agents");
      const s = session(a.id);
      if (["busy", "waiting", "starting"].includes(s.status)) throw new Error("Cancel the running turn before clearing the session");
      const wasLive = live.has(s.id);
      if (wasLive) await stop(ctx, s.id);
      await writes;
      await ctx.host.db.exec(db, "DELETE FROM messages WHERE session_id=?", [s.id]);
      await ctx.host.db.exec(db, "DELETE FROM permissions WHERE session_id=?", [s.id]);
      Object.assign(s, { sessionId: null, contextSent: false, error: null, configOptions: [], models: null });
      await persist(ctx, s);
      if (wasLive) await start(ctx, s);
      return publicSession(s);
    }),
    /** Stop the agent and delete it with its history. */
    remove: (ctx, a, meta) => serialize(String(a.id), async () => {
      if (meta.caller !== "daemon-client") throw new Error("Only the desktop gateway removes agents");
      const s = session(a.id);
      await stop(ctx, s.id);
      await writes;
      sessions.delete(s.id);
      await ctx.host.db.exec(db, "DELETE FROM messages WHERE session_id=?", [s.id]);
      await ctx.host.db.exec(db, "DELETE FROM permissions WHERE session_id=?", [s.id]);
      await ctx.host.db.exec(db, "DELETE FROM sessions WHERE id=?", [s.id]);
      return null;
    }),
    async permission(ctx, a) {
      const c = live.get(String(a.id)), p = c?.permissions.get(String(a.permissionId));
      if (!c || !p) throw new Error("Permission request is no longer active");
      const option = p.value.request.options?.find((o) => o.optionId === a.optionId);
      if (!option) throw new Error("Invalid permission option");
      await ctx.host.db.exec(db, "UPDATE permissions SET resolved=1 WHERE id=?", [p.value.id]);
      c.permissions.delete(p.value.id);
      c.session.status = c.permissions.size ? "waiting" : "busy";
      await persist(ctx, c.session);
      p.resolve({ outcome: { outcome: "selected", optionId: option.optionId } });
      return null;
    }
  }
};
var index_default = mod;
export {
  index_default as default
};
