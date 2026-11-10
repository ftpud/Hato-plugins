// sdk/context-usage.ts
function reportedUsage(value) {
  return value && typeof value.used === "number" && Number.isFinite(value.used) && value.used >= 0 && typeof value.size === "number" && Number.isFinite(value.size) && value.size >= 0 ? { used: value.used, size: value.size } : null;
}

// sdk/images.ts
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

// sdk/usage-limits.ts
var clean = (s) => s.replace(/\\([\\`*_[\]<>|])/g, "$1").replace(/\*\*/g, "").trim();
var slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "limit";
function parseClaudeUsage(markdown) {
  const windows = [];
  for (const line of markdown.split("\n")) {
    const m = /^\*\*(.+?)\*\*\s+—\s+\*\*(\d+(?:\.\d+)?)%\*\*(?:\s+·\s+Resets\s+(.+))?\s*$/.exec(line.trim());
    if (!m) continue;
    const label = clean(m[1]);
    windows.push({ id: claudeWindowId(label), label: shortLabel(label), usedPercent: Number(m[2]), resetsAt: parseDate(m[3]), resetsText: m[3] ? clean(m[3]) : null });
  }
  const plan = /^>\s*(Claude .+ subscription usage)\s*$/m.exec(markdown);
  return { windows, plan: plan ? clean(plan[1]).replace(/ usage$/, "") : null };
}
function claudeWindowId(label) {
  const l = label.toLowerCase();
  if (l.startsWith("5-hour")) return "five_hour";
  if (l === "weekly · all models") return "seven_day";
  return slug(label);
}
function shortLabel(label) {
  return label.replace(/^5-hour limit$/i, "5h").replace(/^Weekly · all models$/i, "Wk").replace(/^Weekly · /i, "Wk · ");
}
function parseDate(text) {
  if (!text) return null;
  const t = Date.parse(clean(text).replace(/\s+[A-Z]{2,5}$/, ""));
  return Number.isFinite(t) ? t : null;
}
function parseCodexStatus(markdown) {
  const windows = [];
  for (const line of markdown.split("\n")) {
    const m = /^\*\*(.+?):\*\*\s+(\d+(?:\.\d+)?)% left(?:\s+\((?:resets\s+)?([^)]*)\))?/.exec(line.trim());
    if (!m) continue;
    const label = clean(m[1]);
    if (/spend limit/i.test(label)) continue;
    const short = label.replace(/^codex\s+/i, "").replace(/\s*limit$/i, "") || label;
    windows.push({ id: slug(label), label: /^(7d|weekly|week)$/i.test(short) ? "Wk" : short, usedPercent: Math.max(0, 100 - Number(m[2])), resetsAt: null, resetsText: m[3] ? clean(m[3]) : null });
  }
  const account = /^\*\*Account:\*\*\s+(.+)$/m.exec(markdown);
  return { windows, plan: account ? clean(account[1]).replace(/\s*\([^)]*@[^)]*\)\s*$/, "") : null };
}
function applyClaudeRateLimit(prev, info, now = Date.now()) {
  if (!info || typeof info !== "object" || typeof info.utilization !== "number" || !Number.isFinite(info.utilization)) return prev;
  const type = typeof info.rateLimitType === "string" ? info.rateLimitType : "five_hour";
  const labels = { five_hour: "5h", seven_day: "Wk", seven_day_opus: "Wk · Opus", seven_day_sonnet: "Wk · Sonnet", overage: "Extra usage" };
  const win = {
    id: type,
    label: labels[type] || type.replace(/_/g, " "),
    usedPercent: Math.round(info.utilization * 1e3) / 10,
    resetsAt: typeof info.resetsAt === "number" && info.resetsAt > 0 ? info.resetsAt * 1e3 : null,
    resetsText: null
  };
  const windows = [...(prev?.windows || []).filter((w) => w.id !== win.id), win];
  const order = ["five_hour", "seven_day"];
  windows.sort((a, b) => (order.indexOf(a.id) + 1 || 99) - (order.indexOf(b.id) + 1 || 99));
  return { provider: "claude", windows, plan: prev?.plan ?? null, updatedAt: now, source: "session", error: null };
}

// sdk/runtime.ts
var grantCache = /* @__PURE__ */ new Map();
var sshCache = /* @__PURE__ */ new Map();
function sshProfileSpec(ssh) {
  return { profileId: ssh.profileId, host: ssh.host, port: ssh.port, user: ssh.user, identityFile: ssh.identityFile ?? null, transport: ssh.transport ?? "ssh", ...ssh.auth ? { auth: ssh.auth } : {} };
}
function sshConnect(ctx, desc) {
  if (desc.location !== "ssh" || !desc.ssh) throw new Error("not an SSH workspace");
  const key = desc.machineId;
  let p = sshCache.get(key);
  if (!p) {
    p = ctx.host.ssh.connect(sshProfileSpec(desc.ssh));
    sshCache.set(key, p);
    p.catch(() => sshCache.delete(key));
  }
  return p;
}
function forgetSsh(machineId) {
  sshCache.delete(machineId);
  for (const k of Array.from(grantCache.keys())) if (k.includes("|" + machineId + "|")) grantCache.delete(k);
}
async function targetFor(ctx, desc) {
  if (desc.location === "local") return { kind: "local" };
  const c = await sshConnect(ctx, desc);
  return { kind: "ssh", connection: c.connection, machineId: c.machineId };
}
async function workspaceGrant(ctx, desc, kind, root) {
  const r = root || desc.rootAbsolutePath;
  const key = kind + "|" + desc.machineId + "|" + r;
  let p = grantCache.get(key);
  if (!p) {
    p = (async () => {
      const target = await targetFor(ctx, desc);
      return ctx.host.capabilities.request({ kind, root: r, target });
    })();
    grantCache.set(key, p);
    p.catch(() => grantCache.delete(key));
  }
  try {
    return await p;
  } catch (e) {
    if (e && (e.code === "ENOTCONN" || e.code === "EBADF")) forgetSsh(desc.machineId);
    throw e;
  }
}
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

// modules/services/acp/src/index.ts
var PROTOCOL_VERSION = 1;
var DEFAULT_PROFILES = [
  { id: "codex", machineId: "*", provider: "codex", name: "Codex (codex-acp)", executable: "codex-acp", args: [], envRefs: {}, enabled: true },
  { id: "claude", machineId: "*", provider: "claude", name: "Claude (claude-agent-acp)", executable: "claude-agent-acp", args: [], envRefs: {}, enabled: true }
];
var ADAPTERS = [
  { id: "claude", name: "Claude (claude-agent-acp)", pkg: "@agentclientprotocol/claude-agent-acp", bin: "claude-agent-acp" },
  { id: "codex", name: "Codex (codex-acp)", pkg: "@agentclientprotocol/codex-acp", bin: "codex-acp" }
];
var conns = /* @__PURE__ */ new Map();
var LIMIT_COMMAND = { claude: "/usage", codex: "/status" };
var limits = { claude: null, codex: null };
var probes = /* @__PURE__ */ new Map();
function publishLimits(ctx) {
  ctx.state.set("acp.limits", limits);
}
function setLimits(ctx, provider, snap) {
  limits = { ...limits, [provider]: snap };
  publishLimits(ctx);
}
async function probeLimits(ctx, provider, workspaceId) {
  const desc = await ctx.modules.call("workspace", "resolve", { workspaceId });
  const all = await profiles(ctx);
  const profile = all.find((p) => p.enabled && p.provider === provider && (p.machineId === desc.machineId || p.machineId === "*"));
  if (!profile) throw new Error(`no enabled ${provider} agent profile for ${desc.machineId}`);
  const det = await detect(ctx, desc, profile.executable);
  if (!det.found) throw new Error(`${profile.executable} was not found on ${desc.machineId}`);
  const g = await workspaceGrant(ctx, desc, "process");
  const env = { ...profile.envRefs || {} };
  if (det.pathEnv) env.PATH = det.pathEnv;
  const envRemove = [];
  if (provider === "claude" && (await authSettings(ctx)).claudeSubscription) for (const k of CLAUDE_API_VARS) {
    envRemove.push(k);
    delete env[k];
  }
  const proc = await ctx.host.process.spawn(g.grant, {
    target: await targetFor(ctx, desc),
    executable: desc.location === "ssh" ? profile.executable : det.path,
    args: profile.args || [],
    cwd: desc.rootAbsolutePath,
    env,
    envRemove,
    loginShell: desc.location === "ssh"
  });
  const peer = new JsonRpcPeer((line) => ctx.host.process.write(proc.handle, line + "\n"), 1);
  let text = "", rateLimit = null;
  peer.onNotification = (method, params) => {
    const u = method === "session/update" ? params?.update : null;
    if (u?.sessionUpdate === "agent_message_chunk" && u.content?.type === "text") text += u.content.text;
    if (u?.sessionUpdate === "usage_update" && u._meta?.["_claude/rateLimit"]) rateLimit = u._meta["_claude/rateLimit"];
  };
  peer.onRequest = async (method) => {
    if (method === "session/request_permission") return { outcome: { outcome: "cancelled" } };
    throw rpcError(-32601, `method not supported by client: ${method}`);
  };
  const subs = [
    await ctx.host.streams.listen(proc.handle, { channel: "stdout" }, (chunk) => peer.feed(chunk), () => peer.failAll("agent process exited"))
  ];
  try {
    await withTimeout(peer.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: "hato", title: "Hato usage meter", version: "0.1.0" }
    }), 6e4, "initialize");
    const session = await withTimeout(peer.request("session/new", { cwd: desc.rootAbsolutePath, mcpServers: [] }), 12e4, "session/new");
    await withTimeout(peer.request("session/prompt", { sessionId: session.sessionId, prompt: [{ type: "text", text: LIMIT_COMMAND[provider] }] }), 9e4, LIMIT_COMMAND[provider]);
  } finally {
    for (const sub of subs) await sub.close().catch(() => {
    });
    await ctx.host.process.closeStdin(proc.handle).catch(() => {
    });
    await ctx.host.process.terminate(proc.handle).catch(() => {
    });
  }
  const parsed = provider === "claude" ? parseClaudeUsage(text) : parseCodexStatus(text);
  let snap = { provider, windows: parsed.windows, plan: parsed.plan, updatedAt: Date.now(), source: "probe", error: null };
  if (!snap.windows.length && rateLimit) snap = { ...applyClaudeRateLimit(null, rateLimit), source: "probe" };
  if (!snap.windows.length) snap.error = /not logged in|API key/i.test(text) ? `${provider} is not using a subscription login; plan limits are unavailable` : "the agent reported no plan limits";
  return snap;
}
function publicState(c) {
  if (!c) return null;
  return {
    conversationId: c.conversationId,
    workspaceId: c.workspaceId,
    machineId: c.machineId,
    cwd: c.cwd,
    profileId: c.profileId,
    pid: c.pid,
    sessionId: c.sessionId,
    agentInfo: c.agentInfo,
    agentCapabilities: c.agentCapabilities,
    authMethods: c.authMethods,
    configOptions: c.configOptions,
    modes: c.modes,
    models: c.models,
    commands: c.commands,
    usage: c.usage || null,
    status: c.status,
    error: c.error,
    stderrTail: c.stderrTail.slice(-2e3),
    mcp: c.mcp,
    executablePath: c.executablePath,
    startedAt: c.startedAt
  };
}
function emitStatus(ctx, c) {
  ctx.events.emit("acp.status", publicState(c));
}
async function profiles(ctx) {
  const rows = await ctx.modules.call("persistence", "acpProfiles.list");
  return rows;
}
async function resolveProfile(ctx, id, machineId) {
  const all = await profiles(ctx);
  const p = all.find((x) => x.id === id && x.enabled && (x.machineId === machineId || x.machineId === "*"));
  if (!p) throw new Error(`agent profile '${id}' is not configured for ${machineId}`);
  return p;
}
async function detect(ctx, desc, executable) {
  const g = await workspaceGrant(ctx, desc, "process");
  const target = await targetFor(ctx, desc);
  if (executable.startsWith("/") && desc.location !== "ssh") {
    const r2 = await ctx.host.process.run(g.grant, { target, executable: "test", args: ["-x", executable], cwd: desc.rootAbsolutePath }, { timeoutMs: 15e3 });
    return { found: r2.code === 0, path: executable, pathEnv: null };
  }
  if (desc.location === "ssh") {
    const probe = async (pathEnv3) => {
      const r3 = await ctx.host.process.run(g.grant, { target, executable: "sh", args: ["-c", 'p=$(command -v -- "$1") || exit; printf "\\n__HATO_EXEC__=%s\\n" "$p"', "hato-detect", executable], cwd: desc.rootAbsolutePath, loginShell: true, ...pathEnv3 ? { env: { PATH: pathEnv3 } } : {} }, { timeoutMs: 2e4 });
      const path = /^__HATO_EXEC__=(.+)$/m.exec(r3.stdout)?.[1] || "";
      return { found: r3.code === 0 && !!path, path, pathEnv: pathEnv3 };
    };
    const login = await probe(null);
    if (login.found) return login;
    const r2 = await ctx.host.process.run(g.grant, { target, executable: "sh", args: ["-c", 'exec "${SHELL:-/bin/sh}" -ic "$1"', "hato-shell-path", `exec /bin/sh -c 'printf "\\n__HATO_PATH__=%s\\n" "$PATH"'`], cwd: desc.rootAbsolutePath, loginShell: true }, { timeoutMs: 2e4 });
    const pathEnv2 = /^__HATO_PATH__=(.+)$/m.exec(r2.stdout)?.[1] || null;
    if (!pathEnv2 || r2.code !== 0) return login;
    const interactive = await probe(pathEnv2);
    return interactive.found ? interactive : login;
  }
  const shell = "/bin/zsh";
  const r = await ctx.host.process.run(g.grant, { target, executable: shell, args: ["-lc", 'command -v -- "$1"; printf "\\n__PATH__=%s" "$PATH"', "hato-detect", executable], cwd: desc.rootAbsolutePath }, { timeoutMs: 2e4 });
  const pathEnv = (/__PATH__=(.*)$/m.exec(r.stdout) || [])[1] || null;
  const found = r.stdout.split("\n").map((l) => l.trim()).find((l) => l.startsWith("/")) || "";
  return { found: !!found, path: found, pathEnv };
}
async function npmRunner(ctx, desc) {
  const det = await detect(ctx, desc, "npm");
  if (!det.found) return { ok: false, error: `npm was not found in the login or interactive shell PATH on ${desc.machineId}; check that Node.js and npm are available for this user`, run: null };
  const g = await workspaceGrant(ctx, desc, "process");
  const target = await targetFor(ctx, desc);
  const env = {};
  if (det.pathEnv) env.PATH = det.pathEnv;
  const run = (args, timeoutMs) => ctx.host.process.run(g.grant, {
    target,
    executable: desc.location === "ssh" ? "npm" : det.path,
    args,
    cwd: desc.rootAbsolutePath,
    env,
    loginShell: desc.location === "ssh"
  }, { timeoutMs, limitBytes: 1 << 20 });
  return { ok: true, error: "", run };
}
var CLAUDE_API_VARS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];
async function authSettings(ctx) {
  const v = await ctx.modules.call("persistence", "settings.get", { key: "acp.claude.useSubscription" });
  return { claudeSubscription: v === null || v === void 0 ? true : !!v };
}
async function start(ctx, a) {
  const existing = conns.get(a.conversationId);
  if (existing && (existing.status === "ready" || existing.status === "busy" || existing.status === "starting")) return publicState(existing);
  const desc = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
  const profile = await resolveProfile(ctx, a.profileId, desc.machineId);
  const det = await detect(ctx, desc, profile.executable);
  if (!det.found) {
    throw new Error(`ACP adapter '${profile.executable}' was not found on ${desc.machineId}. Install and authenticate it on that machine (e.g. npm i -g @agentclientprotocol/codex-acp or @agentclientprotocol/claude-agent-acp), or point the profile to an absolute path. Hato never installs agents automatically.`);
  }
  const g = await workspaceGrant(ctx, desc, "process");
  const env = { ...profile.envRefs || {} };
  if (det.pathEnv) env.PATH = det.pathEnv;
  const auth = await authSettings(ctx);
  const envRemove = [];
  if (profile.provider === "claude" && auth.claudeSubscription) {
    for (const k of CLAUDE_API_VARS) {
      envRemove.push(k);
      delete env[k];
    }
  }
  const spawned = await ctx.host.process.spawn(g.grant, {
    target: await targetFor(ctx, desc),
    executable: desc.location === "ssh" ? profile.executable : det.path,
    args: profile.args || [],
    cwd: desc.rootAbsolutePath,
    env,
    envRemove,
    loginShell: desc.location === "ssh"
  });
  const c = {
    conversationId: a.conversationId,
    workspaceId: desc.id,
    machineId: desc.machineId,
    cwd: desc.rootAbsolutePath,
    profileId: profile.id,
    proc: spawned.handle,
    pid: spawned.pid,
    peer: null,
    sessionId: null,
    agentInfo: null,
    agentCapabilities: null,
    steering: false,
    authMethods: [],
    configOptions: null,
    modes: null,
    models: null,
    commands: [],
    usage: null,
    status: "starting",
    error: null,
    stderrTail: "",
    mcp: { enabled: !!a.mcp, status: a.mcp ? "pending" : "disabled" },
    executablePath: det.path,
    startedAt: Date.now()
  };
  conns.set(c.conversationId, c);
  await wire(ctx, c, 1);
  emitStatus(ctx, c);
  try {
    const init = await withTimeout(c.peer.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: "hato", title: "Hato", version: "0.1.0" }
    }), 6e4, "initialize");
    c.agentInfo = init.agentInfo || null;
    c.agentCapabilities = init.agentCapabilities || {};
    c.steering = init._meta?.steering?.supported === true;
    c.authMethods = init.authMethods || [];
    if (init.protocolVersion !== PROTOCOL_VERSION) throw new Error(`agent negotiated unsupported ACP protocol version ${init.protocolVersion}`);
    let mcpServers = [...a.mcpServers || []];
    if (a.mcp) {
      try {
        const ep = await ctx.modules.call("internal-mcp", "endpoint", { conversationId: c.conversationId, workspaceId: desc.id }, { timeoutMs: 3e5 });
        mcpServers.push(ep.server);
        c.mcp = { enabled: true, status: `internal MCP via ${ep.transport}` };
      } catch (e) {
        c.mcp = { enabled: true, status: `unavailable: ${errMsg(e)}` };
        ctx.log.warn("internal MCP unavailable for", c.conversationId, errMsg(e));
      }
    }
    const caps = c.agentCapabilities.mcpCapabilities || {};
    for (const server of mcpServers) {
      if (server.type === "http" && !caps.http) throw new Error(`Agent does not support HTTP MCP server “${server.name}”`);
      if (server.type === "sse" && !caps.sse) throw new Error(`Agent does not support SSE MCP server “${server.name}”`);
    }
    c.mcp.selection = (a.mcpSelection || (a.mcp ? ["internal"] : [])).filter((id) => id !== "internal" || mcpServers.some((s) => s.name === "hato-internal"));
    let res;
    if (a.resumeSessionId && c.agentCapabilities.loadSession) {
      try {
        res = await withTimeout(c.peer.request("session/load", { sessionId: a.resumeSessionId, cwd: c.cwd, mcpServers }), 12e4, "session/load");
        c.sessionId = a.resumeSessionId;
      } catch (e) {
        ctx.log.warn("session/load failed; starting a new session", errMsg(e));
        ctx.events.emit("acp.update", { conversationId: c.conversationId, update: { sessionUpdate: "_hato_notice", text: `Could not resume the previous agent session (${errMsg(e)}); started a new one. Cached history remains visible.` } });
      }
    }
    if (!c.sessionId) {
      res = await withTimeout(c.peer.request("session/new", { cwd: c.cwd, mcpServers }), 12e4, "session/new");
      c.sessionId = res.sessionId;
    }
    c.configOptions = res && Array.isArray(res.configOptions) ? res.configOptions : null;
    c.modes = res && res.modes ? res.modes : null;
    c.models = res && res.models ? res.models : null;
    c.status = "ready";
  } catch (e) {
    c.status = "error";
    const auth2 = c.authMethods && c.authMethods.length && /auth/i.test(errMsg(e));
    c.error = auth2 ? `Agent requires authentication on ${c.machineId} (${c.authMethods.map((m) => m.name || m.id).join(", ")}). Authenticate the adapter there (e.g. 'codex login'), then reconnect. Details: ${errMsg(e)}` : errMsg(e);
    emitStatus(ctx, c);
    await ctx.host.process.terminate(c.proc).catch(() => {
    });
    throw new Error(c.error);
  }
  emitStatus(ctx, c);
  return publicState(c);
}
function withTimeout(p, ms, what) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }, (e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}
async function wire(ctx, c, nextId, partial = "") {
  c.peer = new JsonRpcPeer((line) => ctx.host.process.write(c.proc, line + "\n"), nextId);
  c.peer.restore(partial);
  c.peer.onNotification = (method, params) => {
    if (method === "session/update" && params && params.update) {
      const u = params.update;
      if (u.sessionUpdate === "config_option_update" && Array.isArray(u.configOptions)) {
        c.configOptions = u.configOptions;
        emitStatus(ctx, c);
      } else if (u.sessionUpdate === "current_mode_update" && c.modes) {
        c.modes = { ...c.modes, currentModeId: u.currentModeId };
        emitStatus(ctx, c);
      } else if (u.sessionUpdate === "usage_update") {
        c.usage = reportedUsage(u);
        emitStatus(ctx, c);
        const rl = u._meta?.["_claude/rateLimit"];
        if (rl) {
          const next = applyClaudeRateLimit(limits.claude, rl);
          if (next) setLimits(ctx, "claude", { ...next, plan: limits.claude?.plan ?? null });
        }
      } else if (u.sessionUpdate === "available_commands_update") {
        c.commands = u.availableCommands || [];
      }
      ctx.events.emit("acp.update", { conversationId: c.conversationId, update: u });
    }
  };
  c.peer.onRequest = async (method, params) => {
    if (method === "session/request_permission") {
      return ctx.modules.call("ai-sessions", "permissionRequest", { conversationId: c.conversationId, request: params }, { timeoutMs: 30 * 60 * 1e3 });
    }
    throw rpcError(-32601, `method not supported by client: ${method}`);
  };
  c.peer.onProtocolError = (err, line) => ctx.log.warn(`ACP protocol error (${c.conversationId}): ${err}: ${line.slice(0, 200)}`);
  await ctx.host.streams.listen(c.proc, { channel: "stdout" }, (chunk) => c.peer.feed(chunk), (err) => {
    const wasBusy = c.status === "busy";
    c.status = "exited";
    if (c.stopping) {
      c.peer.failAll("agent stopped");
      return;
    }
    c.error = c.error || (err ? errMsg(err) : "agent process exited");
    c.peer.failAll("agent process exited");
    ctx.host.process.wait(c.proc).then((x) => {
      if (x) c.error = `agent process exited (code ${x.code}${x.signal ? ", signal " + x.signal : ""})${c.stderrTail ? ": " + c.stderrTail.trim().split("\n").slice(-3).join(" | ") : ""}`;
      emitStatus(ctx, c);
    }).catch(() => emitStatus(ctx, c));
    if (wasBusy) ctx.events.emit("acp.turnEnded", { conversationId: c.conversationId, error: "agent process exited" });
  });
  await ctx.host.streams.listen(c.proc, { channel: "stderr" }, (chunk) => {
    c.stderrTail = (c.stderrTail + chunk).slice(-8e3);
  });
}
var mod = {
  id: "acp",
  moduleApiVersion: 1,
  async activate(ctx, prev) {
    const existing = await profiles(ctx);
    for (const p of DEFAULT_PROFILES) if (!existing.some((x) => x.id === p.id)) await ctx.modules.call("persistence", "acpProfiles.upsert", { profile: p });
    if (prev?.limits) limits = { claude: prev.limits.claude || null, codex: prev.limits.codex || null };
    for (const k of Object.keys(limits)) if (limits[k]?.loading) limits[k] = { ...limits[k], loading: false };
    publishLimits(ctx);
    if (prev && Array.isArray(prev.conns)) {
      for (const s of prev.conns) {
        const c = { ...s, peer: null };
        conns.set(c.conversationId, c);
        if (c.status === "ready" || c.status === "busy") await wire(ctx, c, s.nextId, s.partial);
      }
      ctx.log.info(`re-attached ${prev.conns.length} ACP connection(s) after hot swap`);
    }
  },
  /** Defer swaps while a prompt turn or an agent request is in flight (parser state would be lost). */
  canSwap() {
    if (probes.size) return { ok: false, reason: "a usage-limit probe is running" };
    for (const c of conns.values()) {
      if (c.status === "busy" || c.status === "starting" || c.peer && c.peer.pendingCount > 0) return { ok: false, reason: `ACP session ${c.conversationId} is busy` };
    }
    return { ok: true };
  },
  snapshot() {
    return { limits, conns: Array.from(conns.values()).map((c) => ({ ...publicState(c), proc: c.proc, stderrTail: c.stderrTail, nextId: c.peer ? c.peer.nextRequestId : 1, partial: c.peer ? c.peer.partial : "" })) };
  },
  methods: {
    profiles: async (ctx, a) => {
      const all = await profiles(ctx);
      return a && a.machineId ? all.filter((p) => p.machineId === "*" || p.machineId === a.machineId) : all;
    },
    saveProfile: async (ctx, a) => {
      await ctx.modules.call("persistence", "acpProfiles.upsert", { profile: a.profile });
      return null;
    },
    authSettings: (ctx) => authSettings(ctx),
    async setAuthSettings(ctx, a) {
      if (typeof a.claudeSubscription === "boolean") await ctx.modules.call("persistence", "settings.set", { key: "acp.claude.useSubscription", value: a.claudeSubscription });
      ctx.events.emit("acp.authChanged", await authSettings(ctx));
      return authSettings(ctx);
    },
    detect: async (ctx, a) => {
      const desc = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
      const p = await resolveProfile(ctx, a.profileId, desc.machineId);
      const d = await detect(ctx, desc, p.executable);
      return { ...d, machineId: desc.machineId, executable: p.executable, pathEnv: void 0 };
    },
    start: (ctx, a) => start(ctx, a),
    state: (_ctx, a) => publicState(conns.get(a.conversationId)),
    async prompt(ctx, a) {
      const c = conns.get(a.conversationId);
      if (!c || c.status !== "ready") throw new Error(`agent session is ${c ? c.status : "not started"}`);
      const images = imageAttachments(a.images);
      if (images.length && !c.agentCapabilities?.promptCapabilities?.image) throw new Error("This agent does not support image prompts. Choose an agent with image support.");
      const blocks = a.text ? [{ type: "text", text: String(a.text) }] : [];
      blocks.push(...images.map((image) => ({ type: "image", mimeType: image.mimeType, data: image.data })));
      if (!blocks.length) throw new Error("empty prompt");
      c.status = "busy";
      emitStatus(ctx, c);
      c.peer.request("session/prompt", { sessionId: c.sessionId, prompt: blocks }).then(
        (r) => {
          if (c.stopping || c.status === "exited") return;
          if (c.status === "busy") c.status = "ready";
          emitStatus(ctx, c);
          ctx.events.emit("acp.turnEnded", { conversationId: c.conversationId, stopReason: r && r.stopReason });
        },
        (e) => {
          if (c.stopping || c.status === "exited") return;
          if (c.status === "busy") c.status = "ready";
          c.error = errMsg(e);
          emitStatus(ctx, c);
          ctx.events.emit("acp.turnEnded", { conversationId: c.conversationId, error: errMsg(e) });
        }
      );
      return { accepted: true };
    },
    /** Inject a message into the running turn without interrupting it.
     *  Returns `steered`, `promptRequired` (the turn already ended) or `unsupported`. */
    async steer(ctx, a) {
      const c = conns.get(a.conversationId);
      if (!c || !c.sessionId || !c.steering) return { outcome: "unsupported" };
      const images = imageAttachments(a.images);
      if (images.length && !c.agentCapabilities?.promptCapabilities?.image) throw new Error("This agent does not support image prompts. Choose an agent with image support.");
      const blocks = a.text ? [{ type: "text", text: String(a.text) }] : [];
      blocks.push(...images.map((image) => ({ type: "image", mimeType: image.mimeType, data: image.data })));
      if (!blocks.length) throw new Error("empty prompt");
      const r = await withTimeout(c.peer.request("_session/steering", { sessionId: c.sessionId, prompt: blocks, _meta: { steering: { idleBehavior: "promptRequired" } } }), 3e4, "steering");
      return { outcome: r?.outcome === "promptRequired" ? "promptRequired" : "steered" };
    },
    async cancel(ctx, a) {
      const c = conns.get(a.conversationId);
      if (!c || !c.sessionId) return null;
      await c.peer.notify("session/cancel", { sessionId: c.sessionId });
      return null;
    },
    /** Change a negotiated session setting. Uses configOptions when advertised; legacy modes/models otherwise. */
    async setConfig(ctx, a) {
      const c = conns.get(a.conversationId);
      if (!c || !c.sessionId) throw new Error("agent session not started");
      const changesModel = a.configId === "__model" || c.configOptions?.some((o) => o.id === a.configId && o.category === "model");
      if (c.configOptions && c.configOptions.some((o) => o.id === a.configId)) {
        const r = await c.peer.request("session/set_config_option", { sessionId: c.sessionId, configId: a.configId, value: a.value });
        if (r && Array.isArray(r.configOptions)) c.configOptions = r.configOptions;
      } else if (a.configId === "__mode" && c.modes) {
        await c.peer.request("session/set_mode", { sessionId: c.sessionId, modeId: a.value });
        c.modes = { ...c.modes, currentModeId: a.value };
      } else if (a.configId === "__model" && c.models) {
        await c.peer.request("session/set_model", { sessionId: c.sessionId, modelId: a.value });
        c.models = { ...c.models, currentModelId: a.value };
      } else {
        throw new Error(`agent does not advertise setting '${a.configId}'`);
      }
      if (changesModel) c.usage = null;
      emitStatus(ctx, c);
      return publicState(c);
    },
    async stop(ctx, a) {
      const c = conns.get(a.conversationId);
      if (!c) return null;
      c.stopping = true;
      await ctx.host.process.closeStdin(c.proc).catch(() => {
      });
      await ctx.host.process.terminate(c.proc).catch(() => {
      });
      c.status = "exited";
      emitStatus(ctx, c);
      conns.delete(a.conversationId);
      await ctx.modules.call("internal-mcp", "revoke", { conversationId: a.conversationId }).catch(() => {
      });
      return null;
    },
    list: () => Array.from(conns.values()).map(publicState),
    /** Latest plan usage limits, refreshed through a hidden ACP session when older than `maxAgeMs`
     *  (default 60 s) or when `force`. Concurrent refreshes share one probe. */
    async limits(ctx, a) {
      const provider = a?.provider === "codex" ? "codex" : "claude";
      const cur = limits[provider];
      const maxAge = Number.isFinite(a?.maxAgeMs) ? Number(a.maxAgeMs) : 6e4;
      if (!a?.workspaceId || !a.force && cur && !cur.error && Date.now() - cur.updatedAt < maxAge) return cur;
      let p = probes.get(provider);
      if (!p) {
        setLimits(ctx, provider, { ...cur || { provider, windows: [], plan: null, updatedAt: 0, source: "probe", error: null }, loading: true });
        p = probeLimits(ctx, provider, String(a.workspaceId)).catch((e) => ({ ...limits[provider] || { provider, windows: [], plan: null, source: "probe" }, updatedAt: Date.now(), error: errMsg(e) }));
        probes.set(provider, p);
        p.then((snap) => {
          probes.delete(provider);
          setLimits(ctx, provider, { ...snap, loading: false });
        });
      }
      return p;
    },
    /** Installed/latest versions of the known adapters on the workspace's machine. */
    async adapters(ctx, a) {
      const desc = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
      const npm = await npmRunner(ctx, desc);
      const out = [];
      for (const ad of ADAPTERS) {
        const row = { id: ad.id, name: ad.name, pkg: ad.pkg, bin: ad.bin, machineId: desc.machineId, installed: null, latest: null, path: null, error: null };
        try {
          if (!npm.ok) throw new Error(npm.error);
          const ls = await npm.run(["ls", "-g", "--depth=0", "--json", ad.pkg], 6e4);
          try {
            row.installed = JSON.parse(ls.stdout || "{}").dependencies?.[ad.pkg]?.version || null;
          } catch {
            row.installed = null;
          }
          const view = await npm.run(["view", ad.pkg, "version"], 6e4);
          row.latest = view.code === 0 ? view.stdout.trim().split("\n").pop() || null : null;
          if (view.code !== 0) row.error = `cannot reach npm registry: ${view.stderr.trim().split("\n").pop()}`;
          const d = await detect(ctx, desc, ad.bin);
          row.path = d.found ? d.path : null;
        } catch (e) {
          row.error = errMsg(e);
        }
        out.push(row);
      }
      return out;
    },
    /** Install/update one known adapter with `npm install -g <pkg>@latest` on the workspace machine.
     *  Only accepted from ai-sessions, which obtains the user's approval first. */
    async installAdapter(ctx, a, meta) {
      if (meta.caller !== "ai-sessions") throw new Error("adapter installation must be requested through ai-sessions (approval required)");
      const ad = ADAPTERS.find((x) => x.id === a.adapterId);
      if (!ad) throw new Error(`unknown adapter ${a.adapterId}`);
      const desc = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
      const npm = await npmRunner(ctx, desc);
      if (!npm.ok) throw new Error(npm.error);
      const r = await npm.run(["install", "-g", `${ad.pkg}@latest`], 15 * 60 * 1e3);
      const tail = (r.stderr + "\n" + r.stdout).trim().split("\n").slice(-12).join("\n");
      ctx.events.emit("acp.adaptersChanged", { machineId: desc.machineId, adapterId: ad.id });
      if (r.code !== 0) throw new Error(`npm install -g ${ad.pkg}@latest failed on ${desc.machineId} (exit ${r.code}):
${tail}`);
      return { ok: true, adapterId: ad.id, machineId: desc.machineId, output: tail };
    }
  }
};
var index_default = mod;
export {
  ADAPTERS,
  index_default as default,
  detect
};
