// ../sdk/provider-mcp.ts
var CONFIG_ENV = "HATO_MCP_LAUNCH_CONFIG";
var MCP_LAUNCH_WRAPPER = `
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
let dir;
const cleanup=()=>{if(dir){try{fs.rmSync(dir,{recursive:true,force:true});}catch{}dir=undefined;}};
process.on('exit',cleanup);
try {
 const config=process.env.${CONFIG_ENV};delete process.env.${CONFIG_ENV};
 if(!config)throw new Error('missing configuration');
 const [command,flag,...args]=process.argv.slice(1);
 dir=fs.mkdtempSync(path.join(os.tmpdir(),'hato-mcp-'));fs.chmodSync(dir,0o700);
 const file=path.join(dir,'servers.json');fs.writeFileSync(file,config,{mode:0o600});
 const child=cp.spawn(command,[...args,flag,'@'+file],{stdio:'inherit',env:process.env});
 for(const signal of ['SIGTERM','SIGINT','SIGHUP'])process.on(signal,()=>child.kill(signal));
 child.on('error',()=>{cleanup();process.stderr.write('Hato MCP launcher could not start the provider\\n');process.exit(1);});
 child.on('exit',code=>{cleanup();process.exit(code===null?1:code);});
} catch {cleanup();process.stderr.write('Hato MCP launcher could not prepare the private configuration\\n');process.exit(1);}
`;
function providerMcpLaunch(options, executable, args, env, servers, nodeExecutable = "node") {
  const stdio = options ? servers.filter((server) => (server.type || server.transport || "stdio") === "stdio") : [];
  if (!options || !stdio.length) return { executable, args, env, sessionServers: servers, wrapped: false };
  if (!/^--[a-z][a-z0-9-]*$/i.test(options.flag)) throw new Error("Invalid provider MCP launch flag");
  const configs = /* @__PURE__ */ Object.create(null);
  for (const server of stdio) {
    if (typeof server.name !== "string" || typeof server.command !== "string" || !Array.isArray(server.args)) throw new Error("Invalid stdio MCP server");
    if (Object.prototype.hasOwnProperty.call(configs, server.name)) throw new Error(`Duplicate MCP server name: ${server.name}`);
    configs[server.name] = {
      type: options.stdioType || "local",
      command: server.command,
      args: server.args,
      env: Object.fromEntries((server.env || []).map((pair) => [pair.name, pair.value])),
      ...options.tools ? { tools: options.tools } : {}
    };
  }
  return {
    executable: nodeExecutable,
    args: ["-e", MCP_LAUNCH_WRAPPER, "--", executable, options.flag, ...args],
    env: { ...env, [CONFIG_ENV]: JSON.stringify({ mcpServers: configs }) },
    sessionServers: servers.filter((server) => !stdio.includes(server)),
    wrapped: true
  };
}

// ../sdk/persistent-agents.ts
function agentProgress(args) {
  const n = Number(args?.percent);
  if (!Number.isFinite(n)) throw new Error("percent must be a number from 0 to 100");
  const note = typeof args?.note === "string" ? args.note.trim().slice(0, 80) : "";
  return { percent: Math.round(Math.max(0, Math.min(100, n))), ...note ? { note } : {}, at: Date.now() };
}
var MARKER = /<!--\s*hato-progress\s+(\d{1,3}(?:\.\d+)?)\s*%?\s*(?:\|\s*([^>]*?))?\s*-->/gi;
function lastProgressMarker(text) {
  let last = null;
  for (const m of String(text || "").matchAll(MARKER)) last = m;
  return last ? agentProgress({ percent: Number(last[1]), note: last[2] || "" }) : null;
}
function scanProgressChunk(tail, chunk) {
  const text = tail + chunk;
  return { progress: lastProgressMarker(text), tail: text.slice(-240) };
}

// ../sdk/acp-subagents.ts
var validId = (id) => typeof id === "string" && id.length > 0 && id.length <= 4096;
var own = (children, id) => Object.prototype.hasOwnProperty.call(children, id);
var label = (v) => typeof v === "string" ? v.slice(0, 200) : void 0;
var hasWorkingSubagents = (children) => Object.values(children || {}).some((c) => c.state === "running" || c.state === "requires_action");
var knownSubagent = (children, id) => validId(id) && own(children, id);
function disconnectSubagents(children) {
  return Object.fromEntries(Object.entries(children || {}).map(([id, c]) => [id, { ...c, state: "unknown", stopReason: void 0, progress: void 0, progressTail: void 0 }]));
}
var LEGACY_STATES = { created: "running", busy: "running", waiting: "requires_action", completed: "idle", done: "idle", error: "idle", failed: "idle", interrupted: "idle" };
var LEGACY_STOPS = { completed: "end_turn", done: "end_turn", error: "error", failed: "error", interrupted: "cancelled" };
var OPENCODE_CHILD_UPDATE = "opencode/session/child_update";
var OPENCODE_CHILD_OPT_IN = { "opencode/child-session-updates": true };
function openCodeChildUpdate(params) {
  const root = params?.rootSessionId, id = params?.childSessionId;
  if (!validId(root) || !validId(id)) return null;
  const tag = { id, parentID: params.parentSessionId, depth: params.depth, ...typeof params.title === "string" ? { title: params.title } : {} };
  if (params.type === "status" && typeof params.status === "string")
    return { sessionId: root, update: { sessionUpdate: "_hato_child_status", _meta: { "opencode/child-session": { ...tag, status: params.status } } } };
  if (params.type === "update" && params.update && typeof params.update === "object" && !Array.isArray(params.update)) {
    const u = params.update, meta = u._meta && typeof u._meta === "object" ? u._meta : {};
    return { sessionId: root, update: { ...u, _meta: { ...meta, "opencode/child-session": { ...tag, ...meta["opencode/child-session"] } } } };
  }
  return null;
}
function updateSubagents(children, rootId, params, replayed = false) {
  const parent = params?.sessionId;
  if (!validId(parent) || parent !== rootId && !knownSubagent(children, parent)) return false;
  const u = params.update || {};
  if (typeof u !== "object" || Array.isArray(u)) return false;
  const meta = u._meta?.["opencode/child-session"] || params._meta?.["opencode/child-session"];
  const legacy = meta && typeof meta === "object" && !Array.isArray(meta) ? meta : null;
  if (u.sessionUpdate === "subagent_update" || legacy) {
    const patch = legacy || u, id = legacy ? patch.id : patch.sessionId;
    if (!validId(id) || id === rootId || id === parent || !own(children, id) && Object.keys(children).length >= 200) return false;
    if (own(children, id) && children[id].parentId !== parent) return false;
    const child2 = own(children, id) ? { ...children[id] } : { id, parentId: parent, state: "unknown" };
    for (const key of ["title", "description"]) if (key in patch) child2[key] = label(patch[key]);
    if (legacy && "name" in patch && !("title" in patch)) child2.title = label(patch.name);
    if ("state" in patch || legacy && "status" in patch) {
      const state = patch.state ?? patch.status;
      const value = typeof state === "string" ? state : state?.state;
      const next = legacy ? LEGACY_STATES[value] || value : value;
      child2.state = !replayed && ["running", "requires_action", "idle"].includes(next) ? next : "unknown";
      child2.stopReason = replayed ? void 0 : label(state?.stopReason) || (legacy ? LEGACY_STOPS[value] : void 0);
      if (child2.state === "running" && children[id]?.state !== "running") {
        child2.progress = void 0;
        child2.progressTail = void 0;
      }
    }
    Object.defineProperty(children, id, { value: child2, enumerable: true, writable: true, configurable: true });
    return true;
  }
  if (!knownSubagent(children, parent)) return false;
  const child = { ...children[parent] };
  if (u.sessionUpdate === "session_info_update" && "title" in u) child.sessionTitle = label(u.title);
  else if (u.sessionUpdate === "state_update") {
    child.state = !replayed && ["running", "requires_action", "idle"].includes(u.state) ? u.state : "unknown";
    child.stopReason = replayed ? void 0 : label(u.stopReason);
  } else if (!replayed && ["tool_call", "tool_call_update"].includes(u.sessionUpdate) && u.title) child.activity = label(u.title);
  else if (!replayed && u.sessionUpdate === "agent_message_chunk" && u.content?.type === "text") {
    const scan = scanProgressChunk(child.progressTail || "", String(u.content.text || ""));
    child.progressTail = scan.tail;
    if (scan.progress) child.progress = scan.progress;
  }
  children[parent] = child;
  return true;
}

// ../sdk/acp-protocol.ts
function acpSystemPrompt(agentCapabilities, trustedInstructions) {
  if (!agentCapabilities?.sessionCapabilities?.systemPrompt || typeof trustedInstructions !== "string") return null;
  const text = trustedInstructions.trim();
  if (!text) return null;
  let bytes = 0;
  for (const character of text) {
    const point = character.codePointAt(0);
    bytes += point <= 127 ? 1 : point <= 2047 ? 2 : point <= 65535 ? 3 : 4;
  }
  if (bytes > 128 * 1024) throw new Error("Trusted ACP systemPrompt exceeds the 128 KiB instruction budget");
  return { mode: "append", content: [{ type: "text", text }] };
}
function authMethods(value, terminal) {
  const seen = /* @__PURE__ */ new Set();
  return (Array.isArray(value) ? value : []).filter((m) => {
    if (!m || typeof m.id !== "string" || !m.id || m.id.length > 1024 || seen.has(m.id)) return false;
    const isTerminal = m.type === "terminal" || !!m._meta?.["terminal-auth"];
    if (isTerminal && !terminal || m.type != null && !["agent", "terminal"].includes(m.type)) return false;
    seen.add(m.id);
    return true;
  }).slice(0, 64).map((m) => ({ ...m, name: typeof m.name === "string" ? m.name.slice(0, 4096) : m.id, description: typeof m.description === "string" ? m.description.slice(0, 16384) : void 0 }));
}
function sessionPage(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.sessions)) throw new Error("Invalid session/list response");
  const seen = /* @__PURE__ */ new Set();
  const sessions = value.sessions.filter((s) => s && typeof s.sessionId === "string" && s.sessionId.length > 0 && s.sessionId.length <= 4096 && !seen.has(s.sessionId) && (seen.add(s.sessionId), true)).slice(0, 500).map((s) => ({ sessionId: s.sessionId, ...typeof s.title === "string" ? { title: s.title.slice(0, 4096) } : {}, ...typeof s.cwd === "string" ? { cwd: s.cwd.slice(0, 4096) } : {}, ...typeof s.updatedAt === "string" ? { updatedAt: s.updatedAt.slice(0, 128) } : {} }));
  return { sessions, nextCursor: typeof value.nextCursor === "string" && value.nextCursor.length > 0 && value.nextCursor.length <= 16384 ? value.nextCursor : null };
}
function terminalAuthEnvironment(base, value, removed = []) {
  if (value != null && (typeof value !== "object" || Array.isArray(value))) throw new Error("Invalid authentication environment");
  const entries = Object.entries(value || {});
  if (entries.length > 64) throw new Error("Too many authentication environment variables");
  const blocked = /^(?:PATH|PATHEXT|HOME|USERPROFILE|COMSPEC|SHELL|ENV|BASH_ENV|ZDOTDIR|IFS|CDPATH|GLOBIGNORE|LD_.*|DYLD_.*|NODE_.*|PYTHON.*|RUBY.*|PERL.*|_?JAVA_.*|JDK_.*|CLASSPATH|DOTNET_.*|MONO.*|GCONV_PATH|LOCPATH|OPENSSL_.*|BUNDLE_.*|GEM_.*|GIT_.*|.*_PROXY|ALL_PROXY|NO_PROXY|SSL_.*|CURL_.*|REQUESTS_.*|AWS_.*|AZURE_.*|GOOGLE_.*)$/i;
  const env = { ...base };
  for (const [key, raw] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || ["__proto__", "constructor", "prototype"].includes(key) || blocked.test(key) || removed.some((k) => k.toUpperCase() === key.toUpperCase()) || typeof raw !== "string" || raw.includes("\0") || raw.length > 16384) throw new Error(`Unsafe authentication environment variable '${key}'`);
    env[key] = raw;
  }
  for (const key of removed) delete env[key];
  return { env, keys: entries.map(([key]) => key) };
}

// ../sdk/agent-providers.ts
function agentProviders(plugins, enabledOnly = true) {
  const out = [], seen = /* @__PURE__ */ new Set(), profiles2 = /* @__PURE__ */ new Set();
  for (const plugin of plugins) {
    if (enabledOnly && !plugin.enabled) continue;
    const definitions = plugin.contributes?.agentProviders;
    if (!Array.isArray(definitions)) continue;
    for (const raw of definitions) {
      if (!raw || typeof raw.id !== "string" || seen.has(raw.id) || typeof raw.name !== "string" || typeof raw.profile?.id !== "string" || profiles2.has(raw.profile.id) || typeof raw.profile?.name !== "string" || typeof raw.profile?.executable !== "string" || !Array.isArray(raw.profile.args) || !raw.profile.args.every((v) => typeof v === "string") || typeof raw.adapter?.pkg !== "string" || !/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(raw.adapter.pkg) || typeof raw.adapter?.bin !== "string") continue;
      if (raw.auth && (typeof raw.auth.key !== "string" || typeof raw.auth.field !== "string" || typeof raw.auth.label !== "string" || typeof raw.auth.default !== "boolean" || !Array.isArray(raw.auth.envRemove) || !raw.auth.envRemove.every((key) => typeof key === "string"))) continue;
      profiles2.add(raw.profile.id);
      seen.add(raw.id);
      out.push({ ...raw, module: plugin.id });
    }
  }
  return out;
}
async function providerProfiles(ctx) {
  const { plugins } = await ctx.host.plugins.list();
  const available = agentProviders(plugins);
  const saved = await ctx.modules.call("persistence", "acpProfiles.list");
  const rows = saved.filter((p) => !p.provider || p.provider === "custom" || available.some((d) => d.id === p.provider));
  for (const definition of available) {
    if (!rows.some((p) => p.id === definition.profile.id)) rows.push({
      ...definition.profile,
      provider: definition.id,
      machineId: "*",
      enabled: true,
      envRefs: {}
    });
  }
  return rows.map((p) => {
    const definition = available.find((d) => d.id === p.provider);
    return { ...p, providerModule: definition?.module, mcpLaunch: definition?.mcpLaunch, authOption: definition?.auth };
  });
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

// ../sdk/context-usage.ts
function reportedUsage(value) {
  if (!value || typeof value.used !== "number" || !Number.isFinite(value.used) || value.used < 0 || typeof value.size !== "number" || !Number.isFinite(value.size) || value.size < 0) return null;
  const cost = value.cost && typeof value.cost === "object" && !Array.isArray(value.cost) && typeof value.cost.amount === "number" && Number.isFinite(value.cost.amount) && value.cost.amount >= 0 && typeof value.cost.currency === "string" && value.cost.currency.trim() ? { amount: value.cost.amount, currency: value.cost.currency } : void 0;
  return { used: value.used, size: value.size, ...cost ? { cost } : {} };
}

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
async function daemonTargetFor(ctx, desc) {
  switch (desc.location) {
    case "local":
      return { kind: "local" };
    case "ssh":
      return { kind: "ssh", connection: (await sshConnect(ctx, desc)).connection };
    case "cloud": {
      if (!desc.cloudHostId) throw new Error("Cloud workspace is missing its host.");
      const target = await ctx.modules.call("cloud", "target", {
        hostId: desc.cloudHostId,
        machineId: desc.machineId
      }, { timeoutMs: 62e4 });
      if (target?.kind !== "cloud" || !target.connection) throw new Error("Invalid Cloud daemon route.");
      return target;
    }
    default:
      throw new Error("Unsupported workspace location.");
  }
}
async function targetFor(ctx, desc) {
  if (desc.location === "local") return { kind: "local" };
  if (desc.location === "cloud") return daemonTargetFor(ctx, desc);
  const c = await sshConnect(ctx, desc);
  return { kind: "ssh", connection: c.connection, machineId: c.machineId };
}
async function workspaceGrant(ctx, desc, kind, root) {
  const r = root || desc.rootAbsolutePath;
  const cloud = desc.location === "cloud" ? await targetFor(ctx, desc) : null;
  const key = kind + "|" + desc.machineId + "|" + r + "|" + (cloud?.kind === "cloud" ? cloud.connection : "");
  let p = grantCache.get(key);
  if (!p) {
    p = (async () => {
      const target = cloud ?? await targetFor(ctx, desc);
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

// modules/services/acp/src/index.ts
var PROTOCOL_VERSION = 1;
async function providers(ctx) {
  return agentProviders((await ctx.host.plugins.list()).plugins);
}
async function providerById(ctx, id) {
  const found = (await providers(ctx)).find((p) => p.id === id);
  if (!found) throw new Error(`Provider '${id}' is unavailable. Install or enable its plugin in Marketplace.`);
  return found;
}
async function providerSessionLimits(ctx, providerId, update, previous) {
  const definition = (await providers(ctx)).find((p) => p.id === providerId);
  if (!definition?.usageCommand) return null;
  return ctx.modules.call(definition.module, "sessionLimits", { update, previous });
}
async function environmentPolicy(ctx, profile) {
  const auth = (await providers(ctx)).find((p) => p.id === profile.provider)?.auth;
  if (!auth) return [];
  const saved = await ctx.modules.call("persistence", "settings.get", { key: auth.key });
  return (saved == null ? auth.default : !!saved) ? auth.envRemove : [];
}
var CLIENT_CAPABILITIES = {
  subagents: {},
  fs: { readTextFile: false, writeTextFile: false },
  terminal: false,
  elicitation: { form: {} },
  session: { configOptions: { boolean: {} } }
};
function additionalDirectories(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error("additionalDirectories must be an array");
  const out = /* @__PURE__ */ new Set();
  for (const entry of value) {
    if (typeof entry !== "string" || !/^(?:\/|[A-Za-z]:[\\/])/.test(entry) || /[*?]/.test(entry)) {
      throw new Error("additionalDirectories entries must be absolute paths without wildcards");
    }
    out.add(entry);
  }
  return [...out];
}
function terminalAuthMethod(method) {
  const legacy = method?._meta?.["terminal-auth"];
  return method?.type === "terminal" || legacy ? {
    ...legacy,
    ...method,
    args: Array.isArray(method.args) ? method.args : Array.isArray(legacy?.args) ? legacy.args : void 0,
    env: method.env && typeof method.env === "object" ? method.env : legacy?.env
  } : null;
}
function supportsAdditionalDirectories(c) {
  return !!c.agentCapabilities?.sessionCapabilities?.additionalDirectories;
}
function requireAdditionalDirectories(c, dirs) {
  if (dirs.length && !supportsAdditionalDirectories(c)) {
    throw new Error("This agent does not support additionalDirectories; remove the additional workspace roots or choose an agent that advertises sessionCapabilities.additionalDirectories");
  }
}
function sessionMatches(c, params) {
  return !params?.sessionId || params.sessionId === c.sessionId || knownSubagent(c.childSessions, params.sessionId) || c.loadingHistory === true && params.sessionId === c.loadingSessionId;
}
function promptBlocks(a, c) {
  const raw = Array.isArray(a.prompt) ? a.prompt : Array.isArray(a.content) ? a.content : null;
  if (raw) {
    if (!raw.length) throw new Error("empty prompt");
    return raw.map((block) => {
      if (!block || typeof block !== "object") throw new Error("Invalid ACP prompt block");
      switch (block.type) {
        case "text":
          if (typeof block.text !== "string") throw new Error("Invalid text prompt block");
          return block;
        case "image":
          if (!c.agentCapabilities?.promptCapabilities?.image) throw new Error("This agent does not support image prompts");
          if (typeof block.data !== "string" || typeof block.mimeType !== "string") throw new Error("Image blocks require data and mimeType");
          return block;
        case "resource":
          if (!c.agentCapabilities?.promptCapabilities?.embeddedContext) throw new Error("This agent does not support embedded context");
          if (!block.resource || typeof block.resource.uri !== "string" || typeof block.resource.text !== "string" && typeof block.resource.blob !== "string") throw new Error("Embedded resource requires nested resource uri and text or blob");
          if (typeof block.resource.blob === "string" && typeof block.resource.mimeType !== "string") throw new Error("Blob resources require mimeType");
          return block;
        case "resource_link":
          if (typeof block.uri !== "string" || typeof block.name !== "string") throw new Error("Resource links require uri and name");
          return block;
        case "audio":
          if (!c.agentCapabilities?.promptCapabilities?.audio) throw new Error("This agent does not support audio prompts");
          if (typeof block.data !== "string" || typeof block.mimeType !== "string") throw new Error("Audio blocks require data and mimeType");
          return block;
        default:
          throw new Error(`Unsupported ACP prompt block '${String(block.type)}'`);
      }
    });
  }
  const images = imageAttachments(a.images);
  if (images.length && !c.agentCapabilities?.promptCapabilities?.image) throw new Error("This agent does not support image prompts. Choose an agent with image support.");
  const blocks = a.text ? [{ type: "text", text: String(a.text) }] : [];
  blocks.push(...images.map((image) => ({ type: "image", mimeType: image.mimeType, data: image.data })));
  if (!blocks.length) throw new Error("empty prompt");
  return blocks;
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
var conns = /* @__PURE__ */ new Map();
var startups = /* @__PURE__ */ new Map();
var operations = /* @__PURE__ */ new Map();
function sessionNotFound(error) {
  return error?.rpcCode === -32002;
}
function requireSessionId(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 4096) throw new Error("A nonempty sessionId is required");
  return value;
}
async function start(ctx, a) {
  const pending = startups.get(a.conversationId);
  if (pending) return pending;
  if (operations.has(a.conversationId)) throw new Error("A provider operation is already running");
  const task = startConnection(ctx, a);
  startups.set(a.conversationId, task);
  try {
    return await task;
  } finally {
    startups.delete(a.conversationId);
  }
}
var limits = {};
var limitScopes = {};
var probes = /* @__PURE__ */ new Map();
var probeKey = (provider, workspaceId) => `${provider}\0${workspaceId}`;
function publishLimits(ctx) {
  ctx.state.set("acp.limits", limits);
}
function setLimits(ctx, provider, snap, workspaceId) {
  limits = { ...limits, [provider]: snap };
  if (workspaceId) limitScopes = { ...limitScopes, [provider]: workspaceId };
  publishLimits(ctx);
}
async function probeLimits(ctx, providerId, workspaceId) {
  const definition = await providerById(ctx, providerId);
  if (!definition.usageCommand) throw new Error("This provider does not offer usage checks");
  const desc = await ctx.modules.call("workspace", "resolve", { workspaceId });
  const all = await profiles(ctx);
  const profile = all.find((p) => p.enabled && p.provider === providerId && (p.machineId === desc.machineId || p.machineId === "*"));
  if (!profile) throw new Error(`no enabled ${providerId} agent profile for ${desc.machineId}`);
  const det = await detect(ctx, desc, profile.executable);
  if (!det.found) throw new Error(`${profile.executable} was not found on ${desc.machineId}`);
  const env = { ...profile.envRefs || {} };
  if (det.pathEnv) env.PATH = det.pathEnv;
  const envRemove = await environmentPolicy(ctx, profile);
  for (const key of envRemove) delete env[key];
  const execution = { workspaceId, executablePath: desc.location === "local" ? det.path : profile.executable, env, envRemove, cwd: desc.rootAbsolutePath };
  if (definition.usageCommand.startsWith("module:")) {
    return ctx.modules.call(definition.module, definition.usageCommand.slice(7), execution);
  }
  const g = await workspaceGrant(ctx, desc, "process");
  const proc = await ctx.host.process.spawn(g.grant, {
    target: await targetFor(ctx, desc),
    executable: execution.executablePath,
    args: profile.args || [],
    cwd: desc.rootAbsolutePath,
    env,
    envRemove,
    loginShell: desc.location !== "local"
  });
  const peer = new JsonRpcPeer((line) => ctx.host.process.write(proc.handle, line + "\n"), 1);
  let text = "";
  const updates = [];
  peer.onNotification = (method, params) => {
    const u = method === "session/update" ? params?.update : null;
    if (u?.sessionUpdate === "agent_message_chunk" && u.content?.type === "text") text += u.content.text;
    if (u?.sessionUpdate === "usage_update") updates.push(u);
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
      clientCapabilities: CLIENT_CAPABILITIES,
      clientInfo: { name: "hato", title: "Hato usage meter", version: "0.1.0" }
    }), 6e4, "initialize");
    const session = await withTimeout(peer.request("session/new", { cwd: desc.rootAbsolutePath, mcpServers: [] }), 12e4, "session/new");
    await withTimeout(peer.request("session/prompt", { sessionId: session.sessionId, prompt: [{ type: "text", text: definition.usageCommand }] }), 9e4, definition.usageCommand);
  } finally {
    for (const sub of subs) await sub.close().catch(() => {
    });
    await ctx.host.process.closeStdin(proc.handle).catch(() => {
    });
    await ctx.host.process.terminate(proc.handle).catch(() => {
    });
  }
  const snap = await ctx.modules.call(definition.module, "parseLimits", { text, updates });
  if (!snap.windows.length) snap.error = /not logged in|API key/i.test(text) ? `${definition.name} is not using a subscription login; plan limits are unavailable` : "the agent reported no plan limits";
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
    sessionClosed: !!c.sessionClosed,
    additionalDirectories: c.additionalDirectories,
    agentInfo: c.agentInfo,
    agentCapabilities: c.agentCapabilities,
    authMethods: c.authMethods,
    authProcess: c.authProcess || null,
    configOptions: c.configOptions,
    modes: c.modes,
    models: c.models,
    commands: c.commands,
    usage: c.usage || null,
    turnUsage: c.turnUsage || null,
    sessionInfo: c.sessionInfo || null,
    childSessions: c.childSessions,
    compaction: c.compaction || null,
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
  return providerProfiles(ctx);
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
  if (executable.startsWith("/") && desc.location === "local") {
    const r2 = await ctx.host.process.run(g.grant, { target, executable: "test", args: ["-x", executable], cwd: desc.rootAbsolutePath }, { timeoutMs: 15e3 });
    return { found: r2.code === 0, path: executable, pathEnv: null };
  }
  if (desc.location !== "local") {
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
  const shell = globalThis.process?.env?.SHELL || "/bin/sh";
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
  const npm = desc.location !== "local" ? "npm" : det.path;
  const run = (args, timeoutMs) => ctx.host.process.run(g.grant, {
    target,
    executable: npm,
    args,
    cwd: desc.rootAbsolutePath,
    env,
    loginShell: desc.location !== "local"
  }, { timeoutMs, limitBytes: 1 << 20 });
  const userPrefix = async () => {
    const script = 'g=$("$1" prefix -g) || exit 1; m="$g/lib/node_modules"; if [ -w "$m" ] || { [ ! -e "$m" ] && [ -w "$g" ]; }; then printf "\\n__HATO_PREFIX__=\\n"; else printf "\\n__HATO_PREFIX__=%s\\n" "$HOME/.local"; fi';
    const r = await ctx.host.process.run(g.grant, { target, executable: "sh", args: ["-c", script, "hato-npm-prefix", npm], cwd: desc.rootAbsolutePath, env, loginShell: desc.location !== "local" }, { timeoutMs: 3e4 });
    const m = /^__HATO_PREFIX__=(.*)$/m.exec(r.stdout);
    return r.code === 0 && m && m[1].trim() ? m[1].trim() : null;
  };
  return { ok: true, error: "", run, userPrefix };
}
var installArgs = (pkg, prefix) => ["install", "-g", ...prefix ? ["--prefix", prefix] : [], `${pkg}@latest`];
var installedVersion = (stdout, pkg) => {
  try {
    return JSON.parse(stdout || "{}").dependencies?.[pkg]?.version || null;
  } catch {
    return null;
  }
};
async function authSettings(ctx) {
  const values = {};
  for (const p of await providers(ctx)) if (p.auth) {
    const v = await ctx.modules.call("persistence", "settings.get", { key: p.auth.key });
    values[p.auth.field] = v == null ? p.auth.default : !!v;
  }
  return values;
}
async function sessionMcp(ctx, a, desc) {
  const selection = Array.isArray(a.mcpSelection) ? new Set(a.mcpSelection) : null;
  const servers = (a.mcpServers || []).filter((server) => !selection || selection.has(server.id) || selection.has(server.name));
  const wantInternal = !!a.mcp && (!selection || selection.has("internal"));
  let state = { enabled: false, status: "disabled", selection: [...selection || []] };
  if (wantInternal) {
    try {
      const ep = await ctx.modules.call("internal-mcp", "endpoint", { conversationId: a.conversationId, workspaceId: desc.id }, { timeoutMs: 3e5 });
      servers.push(ep.server);
      state = { enabled: true, status: `internal MCP via ${ep.transport}`, selection: [...selection || ["internal"]] };
    } catch (e) {
      state = { enabled: true, status: `unavailable: ${errMsg(e)}`, selection: [...selection || ["internal"]] };
      ctx.log.warn("internal MCP unavailable for", a.conversationId, errMsg(e));
    }
  } else if (servers.length) {
    state.enabled = true;
    state.status = `${servers.length} external MCP server${servers.length === 1 ? "" : "s"}`;
  }
  return { servers, state };
}
async function startConnection(ctx, a) {
  const existing = conns.get(a.conversationId);
  if (existing && (existing.status === "ready" && existing.sessionId && !existing.sessionClosed || existing.status === "busy" || existing.status === "starting")) return publicState(existing);
  if (existing) {
    existing.stopping = true;
    await ctx.host.process.closeStdin(existing.proc).catch(() => {
    });
    await ctx.host.process.terminate(existing.proc).catch(() => {
    });
    conns.delete(a.conversationId);
    await ctx.modules.call("internal-mcp", "revoke", { conversationId: a.conversationId }).catch(() => {
    });
  }
  const desc = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
  const profile = await resolveProfile(ctx, a.profileId, desc.machineId);
  const det = await detect(ctx, desc, profile.executable);
  if (!det.found) {
    throw new Error(`ACP adapter '${profile.executable}' was not found on ${desc.machineId}. Use Manage agents to install and authenticate it on that machine, or point the profile to an absolute path. Hato never installs agents automatically.`);
  }
  const g = await workspaceGrant(ctx, desc, "process");
  const env = { ...profile.envRefs || {} };
  if (det.pathEnv) env.PATH = det.pathEnv;
  const envRemove = await environmentPolicy(ctx, profile);
  for (const key of envRemove) delete env[key];
  const dirs = additionalDirectories(a.additionalDirectories);
  const preparedMcp = profile.mcpLaunch ? await sessionMcp(ctx, a, desc) : null;
  let launch = providerMcpLaunch(void 0, desc.location !== "local" ? profile.executable : det.path, profile.args || [], env, preparedMcp?.servers || []);
  let spawned;
  try {
    launch = providerMcpLaunch(profile.mcpLaunch, launch.executable, profile.args || [], env, preparedMcp?.servers || []);
    if (launch.wrapped) {
      const node = await detect(ctx, desc, "node");
      if (!node.found) throw new Error("Node.js is required on the workspace machine for this provider's MCP launcher");
      launch = {
        ...launch,
        executable: desc.location !== "local" ? "node" : node.path,
        env: { ...launch.env, ...node.pathEnv ? { PATH: [node.pathEnv, launch.env.PATH].filter(Boolean).join(desc.location !== "local" || ctx.host.env.info().platform !== "windows" ? ":" : ";") } : {} }
      };
    }
    spawned = await ctx.host.process.spawn(g.grant, {
      target: await targetFor(ctx, desc),
      executable: launch.executable,
      args: launch.args,
      cwd: desc.rootAbsolutePath,
      env: launch.env,
      envRemove,
      loginShell: desc.location !== "local"
    });
  } catch (e) {
    if (preparedMcp && a.mcp) await ctx.modules.call("internal-mcp", "revoke", { conversationId: a.conversationId }).catch(() => {
    });
    throw e;
  }
  const c = {
    conversationId: a.conversationId,
    workspaceId: desc.id,
    machineId: desc.machineId,
    cwd: desc.rootAbsolutePath,
    profileId: profile.id,
    providerId: profile.provider,
    providerModule: profile.providerModule,
    profile,
    env,
    envRemove,
    proc: spawned.handle,
    pid: spawned.pid,
    peer: null,
    sessionId: null,
    sessionClosed: false,
    additionalDirectories: dirs,
    systemPrompt: typeof a.systemPrompt === "string" ? a.systemPrompt : null,
    agentInfo: null,
    agentCapabilities: null,
    steering: false,
    authMethods: [],
    authProcess: null,
    configOptions: null,
    modes: null,
    models: null,
    commands: [],
    usage: null,
    turnUsage: null,
    sessionInfo: null,
    childSessions: {},
    compaction: null,
    status: "starting",
    error: null,
    stderrTail: "",
    activeTurn: null,
    pendingPermissions: /* @__PURE__ */ new Map(),
    pendingElicitations: /* @__PURE__ */ new Map(),
    mcp: { enabled: !!a.mcp, status: a.mcp ? "pending" : "disabled" },
    mcpServers: [],
    executablePath: det.path,
    startedAt: Date.now()
  };
  conns.set(c.conversationId, c);
  await wire(ctx, c, 1);
  emitStatus(ctx, c);
  try {
    const init = await sessionRequest(ctx, c, "initialize", {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { ...CLIENT_CAPABILITIES, _meta: { ...OPENCODE_CHILD_OPT_IN }, ...ctx.host.env.info().hostFeatures?.includes("pty.spawn") ? { auth: { terminal: true }, _meta: { ...OPENCODE_CHILD_OPT_IN, "terminal-auth": true } } : {} },
      clientInfo: { name: "hato", title: "Hato", version: "0.1.0" }
    }, 6e4);
    c.agentInfo = init.agentInfo || null;
    c.agentCapabilities = init.agentCapabilities || {};
    c.steering = init._meta?.steering?.supported === true;
    c.authMethods = authMethods(init.authMethods, !!ctx.host.env.info().hostFeatures?.includes("pty.spawn"));
    if (init.protocolVersion !== PROTOCOL_VERSION) throw new Error(`agent negotiated unsupported ACP protocol version ${init.protocolVersion}`);
    const configuredMcp = preparedMcp || await sessionMcp(ctx, a, desc);
    const mcpServers = configuredMcp.servers;
    c.mcp = configuredMcp.state;
    const sessionServers = launch.wrapped ? launch.sessionServers : mcpServers;
    c.mcpServers = sessionServers;
    const caps = c.agentCapabilities.mcpCapabilities || {};
    for (const server of sessionServers) {
      if (server.type === "http" && !caps.http) throw new Error(`Agent does not support HTTP MCP server “${server.name}”`);
      if (server.type === "sse" && !caps.sse) throw new Error(`Agent does not support SSE MCP server “${server.name}”`);
    }
    requireAdditionalDirectories(c, c.additionalDirectories);
    const systemPrompt = acpSystemPrompt(c.agentCapabilities, c.systemPrompt);
    const lifecycle = { cwd: c.cwd, mcpServers: sessionServers, ...c.additionalDirectories.length ? { additionalDirectories: c.additionalDirectories } : {}, ...systemPrompt ? { systemPrompt } : {} };
    let res;
    if (a.forkSessionId) {
      if (!c.agentCapabilities.sessionCapabilities?.fork) throw new Error("This agent does not support session forking");
      res = await sessionRequest(ctx, c, "session/fork", { ...lifecycle, sessionId: String(a.forkSessionId) }, 12e4);
      validateSessionResult(res);
      c.sessionId = requireSessionId(res?.sessionId);
    } else if (a.resumeSessionId) {
      const sessionId = String(a.resumeSessionId);
      const canResume = !!c.agentCapabilities.sessionCapabilities?.resume;
      const canLoad = !!c.agentCapabilities.loadSession;
      const copilot = c.profile?.provider === "copilot" || c.providerId === "copilot";
      const preferred = a.resumeMode === "load" || copilot && canLoad ? ["session/load", "session/resume"] : ["session/resume", "session/load"];
      const methods = preferred.filter((method, index) => (method === "session/resume" ? canResume : canLoad) && preferred.indexOf(method) === index);
      let lastError = "the agent advertises neither session/resume nor session/load";
      for (const method of methods) {
        let success = false;
        try {
          c.loadingHistory = method === "session/load";
          c.loadingSessionId = sessionId;
          res = await sessionRequest(ctx, c, method, { ...lifecycle, sessionId }, 12e4);
          validateSessionResult(res, sessionId);
          c.sessionId = sessionId;
          success = true;
          lastError = null;
          break;
        } catch (e) {
          if (!sessionNotFound(e)) throw e;
          lastError = errMsg(e);
          ctx.log.warn(`${method} failed${methods.indexOf(method) < methods.length - 1 ? "; trying the other resume method" : "; starting a new session"}`, lastError);
        } finally {
          c.loadingHistory = false;
          c.loadingSessionId = null;
          if (method === "session/load") ctx.events.emit("acp.replayEnded", { conversationId: c.conversationId, sessionId, success });
        }
      }
      if (!c.sessionId) ctx.events.emit("acp.update", { conversationId: c.conversationId, update: { sessionUpdate: "_hato_notice", text: `Could not resume the previous agent session (${lastError}); started a new one. A bounded dialogue handoff will accompany the next prompt.` } });
    }
    if (!c.sessionId) {
      res = await sessionRequest(ctx, c, "session/new", lifecycle, 12e4);
      validateSessionResult(res);
      c.sessionId = requireSessionId(res?.sessionId);
    }
    c.sessionClosed = false;
    c.configOptions = res && Array.isArray(res.configOptions) ? res.configOptions : null;
    c.modes = res && res.modes ? res.modes : null;
    c.models = res && res.models ? res.models : null;
    c.status = "ready";
  } catch (e) {
    c.status = "error";
    const auth = c.authMethods && c.authMethods.length && /auth/i.test(errMsg(e));
    c.error = auth ? `Agent requires authentication on ${c.machineId} (${c.authMethods.map((m) => m.name || m.id).join(", ")}). Authenticate the adapter there then reconnect. Details: ${errMsg(e)}` : errMsg(e);
    const message = c.error;
    emitStatus(ctx, c);
    if (!auth) await ctx.host.process.terminate(c.proc).catch(() => {
    });
    if (a.mcp) await ctx.modules.call("internal-mcp", "revoke", { conversationId: a.conversationId }).catch(() => {
    });
    throw new Error(message);
  }
  emitStatus(ctx, c);
  return publicState(c);
}
async function sessionRequest(ctx, c, method, params, ms) {
  const id = c.peer.nextRequestId;
  try {
    return await withTimeout(c.peer.request(method, params), ms, method);
  } catch (error) {
    if (/timed out/.test(errMsg(error))) {
      c.peer.cancelRequest(id, `${method} timed out`);
      c.status = "error";
      c.error = `${method} timed out; reconnect before continuing`;
      c.sessionClosed = true;
      emitStatus(ctx, c);
    }
    throw error;
  }
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
async function withReplay(ctx, c, sessionId, request) {
  c.childSessions = disconnectSubagents(c.childSessions);
  c.loadingHistory = true;
  c.loadingSessionId = sessionId;
  let success = false;
  try {
    const result = await request();
    success = true;
    return result;
  } finally {
    c.loadingHistory = false;
    c.loadingSessionId = null;
    ctx.events.emit("acp.replayEnded", { conversationId: c.conversationId, sessionId, success });
  }
}
function finishTurn(ctx, c, result) {
  if (!c.activeTurn) return;
  if (c.activeTurn.timer) clearTimeout(c.activeTurn.timer);
  c.activeTurn = null;
  if (c.stopping || c.status === "exited") return;
  if (c.status === "busy") c.status = "ready";
  if (result.usage) c.turnUsage = result.usage;
  if (result.error) c.error = result.error;
  emitStatus(ctx, c);
  ctx.events.emit("acp.turnEnded", {
    conversationId: c.conversationId,
    ...result.error ? { error: result.error } : { stopReason: result.stopReason },
    ...result.usage ? { usage: result.usage } : {}
  });
}
async function cancelInternal(ctx, c) {
  if (c.activeTurn) c.activeTurn.cancelled = true;
  for (const resolve of c.pendingPermissions.values()) resolve({ outcome: { outcome: "cancelled" } });
  c.pendingPermissions.clear();
  for (const pending of c.pendingElicitations.values()) {
    clearTimeout(pending.timer);
    pending.resolve({ action: "cancel" });
  }
  c.pendingElicitations.clear();
  if (c.sessionId) await c.peer.notify("session/cancel", { sessionId: c.sessionId }).catch(() => {
  });
}
async function wire(ctx, c, nextId, partial = "") {
  c.peer = new JsonRpcPeer((line) => ctx.host.process.write(c.proc, line + "\n"), nextId);
  c.peer.restore(partial);
  c.peer.onNotification = function onNotification(method, params) {
    if (method === "$/cancel_request") {
      void cancelInternal(ctx, c);
      return;
    }
    if (method === OPENCODE_CHILD_UPDATE || method === `_${OPENCODE_CHILD_UPDATE}`) {
      const update = params?.rootSessionId === (c.loadingSessionId || c.sessionId) ? openCodeChildUpdate(params) : null;
      if (update) onNotification("session/update", update);
      return;
    }
    if (method === "elicitation/complete") {
      ctx.events.emit("acp.elicitationComplete", { conversationId: c.conversationId, ...params });
      return;
    }
    if (method === "session/update" && params && params.update) {
      if (!sessionMatches(c, params)) {
        ctx.log.warn(`ignored ACP update for foreign session ${String(params.sessionId)}`);
        return;
      }
      const u = params.update;
      const childUpdate = knownSubagent(c.childSessions, params.sessionId);
      if (updateSubagents(c.childSessions, c.loadingSessionId || c.sessionId, params, c.loadingHistory === true)) {
        emitStatus(ctx, c);
      }
      if (childUpdate || u.sessionUpdate === "subagent_update" || u.sessionUpdate === "_hato_child_status") return;
      if (u.sessionUpdate === "config_option_update" && Array.isArray(u.configOptions)) {
        c.configOptions = u.configOptions;
        emitStatus(ctx, c);
      } else if (u.sessionUpdate === "current_mode_update" && c.modes) {
        c.modes = { ...c.modes, currentModeId: u.currentModeId };
        emitStatus(ctx, c);
      } else if (u.sessionUpdate === "usage_update") {
        c.usage = reportedUsage(u);
        emitStatus(ctx, c);
        if (c.providerModule && c.providerId) {
          const providerId = c.providerId;
          void providerSessionLimits(ctx, providerId, u, limits[providerId] || null).then((next) => {
            if (next) setLimits(ctx, providerId, next, c.workspaceId);
          }).catch((e) => ctx.log.warn("Provider usage update:", errMsg(e)));
        }
      } else if (u.sessionUpdate === "available_commands_update") {
        c.commands = u.availableCommands || [];
        emitStatus(ctx, c);
      } else if (u.sessionUpdate === "session_info_update") {
        c.sessionInfo = u;
        const marker = u._meta?.["opencode/compaction"] || params._meta?.["opencode/compaction"];
        if (marker) c.compaction = marker;
        emitStatus(ctx, c);
      } else if (u.sessionUpdate === "compaction_update" || u.sessionUpdate === "compaction_summary_chunk") {
        c.compaction = u;
        emitStatus(ctx, c);
      }
      ctx.events.emit("acp.update", { conversationId: c.conversationId, sessionId: params.sessionId, update: u, replayed: c.loadingHistory === true });
      return;
    }
    ctx.events.emit("acp.notification", { conversationId: c.conversationId, method, params });
  };
  c.peer.onRequest = async (method, params, id) => {
    if (!sessionMatches(c, params)) throw rpcError(-32602, "ACP request targets a different session");
    if (method === "session/request_permission") {
      const pending = deferred();
      c.pendingPermissions.set(id, pending.resolve);
      try {
        return await Promise.race([
          ctx.modules.call("ai-sessions", "permissionRequest", { conversationId: c.conversationId, request: params }, { timeoutMs: 30 * 60 * 1e3 }),
          pending.promise
        ]);
      } finally {
        c.pendingPermissions.delete(id);
      }
    }
    if (method === "elicitation/create") {
      if (params?.mode !== "form") throw rpcError(-32602, "Only form elicitation is supported");
      if (!params.requestedSchema || typeof params.requestedSchema !== "object" || Array.isArray(params.requestedSchema)) throw rpcError(-32602, "Form elicitation requires an object requestedSchema");
      const pending = deferred();
      const timer = setTimeout(() => {
        c.pendingElicitations.delete(id);
        pending.resolve({ action: "cancel" });
      }, 30 * 60 * 1e3);
      c.pendingElicitations.set(id, { params, resolve: pending.resolve, reject: pending.reject, timer });
      ctx.events.emit("acp.elicitation", { conversationId: c.conversationId, requestId: id, request: params });
      try {
        return await pending.promise;
      } finally {
        clearTimeout(timer);
        c.pendingElicitations.delete(id);
        ctx.events.emit("acp.elicitationComplete", { conversationId: c.conversationId, requestId: id });
      }
    }
    throw rpcError(-32601, `method not supported by client: ${method}`);
  };
  c.peer.onProtocolError = (err, line) => ctx.log.warn(`ACP protocol error (${c.conversationId}): ${err}: ${line.slice(0, 200)}`);
  await ctx.host.streams.listen(c.proc, { channel: "stdout" }, (chunk) => c.peer.feed(chunk), (err) => {
    const wasBusy = c.status === "busy";
    c.status = "exited";
    c.childSessions = disconnectSubagents(c.childSessions);
    if (c.activeTurn?.timer) clearTimeout(c.activeTurn.timer);
    c.activeTurn = null;
    for (const resolve of c.pendingPermissions.values()) resolve({ outcome: { outcome: "cancelled" } });
    c.pendingPermissions.clear();
    for (const pending of c.pendingElicitations.values()) {
      clearTimeout(pending.timer);
      pending.resolve({ action: "cancel" });
    }
    c.pendingElicitations.clear();
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
function lifecycleParams(c) {
  requireAdditionalDirectories(c, c.additionalDirectories);
  const systemPrompt = acpSystemPrompt(c.agentCapabilities, c.systemPrompt);
  return { cwd: c.cwd, mcpServers: c.mcpServers, ...c.additionalDirectories.length ? { additionalDirectories: c.additionalDirectories } : {}, ...systemPrompt ? { systemPrompt } : {} };
}
function updateAdditionalDirectories(c, value) {
  const dirs = additionalDirectories(value ?? c.additionalDirectories);
  requireAdditionalDirectories(c, dirs);
  c.additionalDirectories = dirs;
}
function requireIdleSession(c) {
  if (c.status === "busy" || c.status === "starting" || hasWorkingSubagents(c.childSessions) || c.activeTurn || c.loadingHistory || c.authProcess) {
    throw new Error("Wait for the active agent turn, session load, or authentication to finish before changing provider sessions");
  }
}
function validateSessionResult(res, expected) {
  if (!res || typeof res !== "object" || Array.isArray(res) || res.sessionId != null && expected && res.sessionId !== expected) throw new Error("Invalid session setup response");
  requireSessionId(expected || res.sessionId);
  if (res.configOptions != null && !Array.isArray(res.configOptions)) throw new Error("Invalid session setup response: configOptions");
  return res;
}
function applySessionResult(ctx, c, res, sessionId) {
  validateSessionResult(res, sessionId);
  c.sessionId = requireSessionId(sessionId || res.sessionId);
  const children = {};
  const include = (parentId) => {
    for (const child of Object.values(c.childSessions)) if (child.parentId === parentId && !knownSubagent(children, child.id)) {
      Object.defineProperty(children, child.id, { value: child, enumerable: true, writable: true, configurable: true });
      include(child.id);
    }
  };
  include(c.sessionId);
  c.childSessions = children;
  c.sessionClosed = false;
  c.configOptions = res && Array.isArray(res.configOptions) ? res.configOptions : null;
  c.modes = res && res.modes ? res.modes : null;
  c.models = res && res.models ? res.models : null;
  c.commands = [];
  c.usage = null;
  c.turnUsage = null;
  c.sessionInfo = null;
  c.compaction = null;
  emitStatus(ctx, c);
}
var mod = {
  id: "acp",
  moduleApiVersion: 1,
  async activate(ctx, prev) {
    if (prev?.limits) limits = { ...prev.limits };
    if (prev?.limitScopes) limitScopes = { ...prev.limitScopes };
    for (const k of Object.keys(limits)) if (limits[k]?.loading) limits[k] = { ...limits[k], loading: false };
    publishLimits(ctx);
    if (prev && Array.isArray(prev.conns)) {
      const available = await profiles(ctx);
      for (const s of prev.conns) {
        const p = available.find((p2) => p2.id === s.profileId);
        const c = {
          ...s,
          providerId: s.providerId || p?.provider,
          providerModule: s.providerModule || p?.providerModule,
          peer: null,
          pendingPermissions: /* @__PURE__ */ new Map(),
          pendingElicitations: /* @__PURE__ */ new Map(),
          activeTurn: null,
          childSessions: s.childSessions || {},
          additionalDirectories: s.additionalDirectories || []
        };
        conns.set(c.conversationId, c);
        if (c.status === "ready" || c.status === "busy") await wire(ctx, c, s.nextId, s.partial);
      }
      ctx.log.info(`re-attached ${prev.conns.length} ACP connection(s) after hot swap`);
    }
  },
  /** Defer swaps while a prompt turn or an agent request is in flight (parser state would be lost). */
  canSwap() {
    if (startups.size || operations.size) return { ok: false, reason: "An ACP operation is running" };
    if (probes.size) return { ok: false, reason: "a usage-limit probe is running" };
    for (const c of conns.values()) {
      if (c.status === "busy" || c.status === "starting" || hasWorkingSubagents(c.childSessions) || c.authProcess || c.pendingPermissions.size || c.pendingElicitations.size || c.peer && c.peer.pendingCount > 0) return { ok: false, reason: `ACP session ${c.conversationId} is busy` };
    }
    return { ok: true };
  },
  snapshot() {
    return { limits, limitScopes, conns: Array.from(conns.values()).map((c) => ({ ...publicState(c), proc: c.proc, providerId: c.providerId, providerModule: c.providerModule, profile: c.profile, env: c.env, envRemove: c.envRemove, systemPrompt: c.systemPrompt, mcpServers: c.mcpServers, stderrTail: c.stderrTail, nextId: c.peer ? c.peer.nextRequestId : 1, partial: c.peer ? c.peer.partial : "" })) };
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
      for (const p of await providers(ctx)) if (p.auth && typeof a[p.auth.field] === "boolean") {
        await ctx.modules.call("persistence", "settings.set", { key: p.auth.key, value: a[p.auth.field] });
      }
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
      if (!c || c.status !== "ready" || !c.sessionId || c.sessionClosed) throw new Error(`agent session is ${c ? c.status : "not started"}`);
      if (operations.has(a.conversationId) || startups.has(a.conversationId)) throw new Error("A provider operation is already running");
      if (c.activeTurn) throw new Error("A prompt is already running for this session");
      const blocks = promptBlocks(a, c);
      const timeoutMs = Number.isFinite(a.timeoutMs) ? Math.max(1e3, Math.min(30 * 60 * 1e3, Number(a.timeoutMs))) : 30 * 60 * 1e3;
      c.status = "busy";
      c.error = null;
      c.turnUsage = null;
      const turn = c.activeTurn = { cancelled: false, timer: void 0 };
      emitStatus(ctx, c);
      const requestId = c.peer.nextRequestId;
      c.activeTurn.timer = setTimeout(() => {
        if (c.activeTurn !== turn) return;
        c.peer.cancelRequest(requestId, "Prompt timed out");
        void cancelInternal(ctx, c);
        finishTurn(ctx, c, { error: `prompt timed out after ${timeoutMs} ms` });
      }, timeoutMs);
      c.peer.request("session/prompt", { sessionId: c.sessionId, prompt: blocks }).then(
        (r) => {
          if (c.activeTurn === turn) finishTurn(ctx, c, { stopReason: r && r.stopReason, usage: r && r.usage });
        },
        (e) => {
          if (c.activeTurn === turn) finishTurn(ctx, c, { error: errMsg(e) });
        }
      );
      return { accepted: true };
    },
    /** Inject a message into the running turn without interrupting it.
     *  Returns `steered`, `promptRequired` (the turn already ended) or `unsupported`. */
    async steer(ctx, a) {
      const c = conns.get(a.conversationId);
      if (!c || !c.sessionId || !c.steering || operations.has(a.conversationId) || startups.has(a.conversationId)) return { outcome: "unsupported" };
      const blocks = promptBlocks(a, c);
      const r = await sessionRequest(ctx, c, "_session/steering", { sessionId: c.sessionId, prompt: blocks, _meta: { steering: { idleBehavior: "promptRequired" } } }, 3e4);
      return { outcome: r?.outcome === "promptRequired" ? "promptRequired" : "steered" };
    },
    async cancel(ctx, a) {
      const c = conns.get(a.conversationId);
      if (!c || !c.sessionId) return null;
      await cancelInternal(ctx, c);
      return null;
    },
    /** Respond to a form elicitation previously emitted as `acp.elicitation`. */
    respondElicitation(ctx, a) {
      const c = conns.get(a.conversationId);
      const pending = c?.pendingElicitations.get(a.requestId);
      if (!pending) throw new Error("Unknown or completed elicitation request");
      const action = a.response?.action;
      if (!["accept", "decline", "cancel"].includes(action)) throw new Error("Elicitation response action must be accept, decline, or cancel");
      if (action === "accept" && a.response.content != null && (typeof a.response.content !== "object" || Array.isArray(a.response.content))) throw new Error("Accepted elicitation content must be an object");
      clearTimeout(pending.timer);
      pending.resolve(a.response);
      c.pendingElicitations.delete(a.requestId);
      return null;
    },
    /** ACP session lifecycle surface. These methods intentionally return raw protocol data so
     * a future Hato UI can build session browsers and management controls without another adapter. */
    async listSessions(ctx, a) {
      const c = conns.get(a.conversationId);
      if (!c) throw new Error("agent session not started");
      if (!c.agentCapabilities.sessionCapabilities?.list) throw new Error("This agent does not support session listing");
      const params = { cwd: c.cwd };
      if (a.cursor != null) params.cursor = String(a.cursor);
      return sessionPage(await sessionRequest(ctx, c, "session/list", params, 6e4));
    },
    async newSession(ctx, a) {
      const c = conns.get(a.conversationId);
      if (!c) throw new Error("agent session not started");
      requireIdleSession(c);
      updateAdditionalDirectories(c, a.additionalDirectories ?? c.additionalDirectories);
      const res = await sessionRequest(ctx, c, "session/new", lifecycleParams(c), 12e4);
      applySessionResult(ctx, c, res);
      return publicState(c);
    },
    async resumeSession(ctx, a) {
      const c = conns.get(a.conversationId);
      if (!c) throw new Error("agent session not started");
      requireIdleSession(c);
      if (!c.agentCapabilities.sessionCapabilities?.resume) throw new Error("This agent does not support session resume");
      updateAdditionalDirectories(c, a.additionalDirectories ?? c.additionalDirectories);
      const res = await sessionRequest(ctx, c, "session/resume", { ...lifecycleParams(c), sessionId: requireSessionId(a.sessionId) }, 12e4);
      applySessionResult(ctx, c, res, requireSessionId(a.sessionId));
      return publicState(c);
    },
    async loadSession(ctx, a) {
      const c = conns.get(a.conversationId);
      if (!c) throw new Error("agent session not started");
      requireIdleSession(c);
      if (!c.agentCapabilities.loadSession) throw new Error("This agent does not support session loading");
      updateAdditionalDirectories(c, a.additionalDirectories ?? c.additionalDirectories);
      const sessionId = requireSessionId(a.sessionId);
      const res = await withReplay(ctx, c, sessionId, async () => validateSessionResult(await sessionRequest(ctx, c, "session/load", { ...lifecycleParams(c), sessionId }, 12e4), sessionId));
      applySessionResult(ctx, c, res, requireSessionId(a.sessionId));
      return publicState(c);
    },
    async forkSession(ctx, a) {
      const c = conns.get(a.conversationId);
      if (!c) throw new Error("agent session not started");
      requireIdleSession(c);
      if (!c.agentCapabilities.sessionCapabilities?.fork) throw new Error("This agent does not support session forking");
      updateAdditionalDirectories(c, a.additionalDirectories ?? c.additionalDirectories);
      const res = await sessionRequest(ctx, c, "session/fork", { ...lifecycleParams(c), sessionId: requireSessionId(a.sessionId) }, 12e4);
      applySessionResult(ctx, c, res);
      return publicState(c);
    },
    async closeSession(ctx, a) {
      const c = conns.get(a.conversationId);
      if (!c || !c.sessionId) throw new Error("agent session not started");
      requireIdleSession(c);
      if (!c.agentCapabilities.sessionCapabilities?.close) throw new Error("This agent does not support session close");
      await sessionRequest(ctx, c, "session/close", { sessionId: c.sessionId }, 6e4).catch((e) => {
        if (!sessionNotFound(e)) throw e;
      });
      c.sessionClosed = true;
      emitStatus(ctx, c);
      return publicState(c);
    },
    async deleteSession(ctx, a) {
      const c = conns.get(a.conversationId);
      if (!c) throw new Error("agent session not started");
      requireIdleSession(c);
      if (!c.agentCapabilities.sessionCapabilities?.delete) throw new Error("This agent does not support session deletion");
      const sessionId = requireSessionId(a.sessionId ?? c.sessionId);
      if (!sessionId) throw new Error("sessionId is required");
      await sessionRequest(ctx, c, "session/delete", { sessionId }, 6e4).catch((e) => {
        if (!sessionNotFound(e)) throw e;
      });
      if (sessionId === c.sessionId) {
        c.sessionId = null;
        c.sessionClosed = true;
        emitStatus(ctx, c);
      }
      return null;
    },
    async authenticate(ctx, a) {
      const c = conns.get(a.conversationId);
      if (!c) throw new Error("agent session not started");
      if (c.authProcess) throw new Error("An authentication process is already running");
      const method = c.authMethods.find((entry) => entry.id === a.methodId);
      if (!method) throw new Error(`Unknown authentication method '${String(a.methodId)}'`);
      const terminal = terminalAuthMethod(method);
      if (terminal) {
        if (!ctx.host.env.info().hostFeatures?.includes("pty.spawn")) throw new Error("This host needs an update for interactive authentication");
        if (!a.confirmToken) {
          const desc = await ctx.modules.call("workspace", "resolve", { workspaceId: c.workspaceId });
          const profile = c.profile || await resolveProfile(ctx, c.profileId, desc.machineId);
          const configured = terminalAuthEnvironment(c.env || profile.envRefs || {}, terminal.env, c.envRemove || []);
          const extra = terminal.args ?? (method._meta?.["terminal-auth"] ? ["--login"] : []);
          if (!Array.isArray(extra) || extra.length > 128 || extra.some((v) => typeof v !== "string" || v.includes("\0") || v.length > 16384)) throw new Error("Invalid authentication arguments");
          const launch = providerMcpLaunch(profile.mcpLaunch, desc.location === "local" ? c.executablePath : profile.executable, profile.args || [], configured.env, []);
          const token = crypto.randomUUID();
          c.authPlan = { token, methodId: method.id, desc, launch, args: [...launch.args, ...extra], envKeys: configured.keys, expires: Date.now() + 3e5 };
          return { outcome: "prepared", confirmToken: token, methodId: method.id, label: method.name || method.id, command: launch.executable, args: c.authPlan.args, envKeys: configured.keys, display: [launch.executable, ...c.authPlan.args.map((a2) => JSON.stringify(a2))].join(" ") };
        }
        const plan = c.authPlan;
        if (!plan || plan.token !== a.confirmToken || plan.methodId !== method.id || plan.expires < Date.now()) throw new Error("Authentication launch expired; choose the method again");
        c.authPlan = null;
        const g = await workspaceGrant(ctx, plan.desc, "process");
        const pty = await ctx.host.pty.spawn(g.grant, { target: await targetFor(ctx, plan.desc), executable: plan.launch.executable, args: plan.args, cwd: plan.desc.rootAbsolutePath, env: plan.launch.env, envRemove: c.envRemove || [], loginShell: plan.desc.location !== "local", columns: 100, rows: 24 });
        const attemptId = crypto.randomUUID();
        c.authProcess = { kind: "pty", attemptId, handle: pty.handle, pid: 0, methodId: method.id, command: plan.launch.executable, args: plan.args, envKeys: plan.envKeys, cwd: plan.desc.rootAbsolutePath, machineId: plan.desc.machineId, label: method.name || method.id, startedAt: Date.now() };
        emitStatus(ctx, c);
        let cursor = 0;
        const poll = async () => {
          if (c.authProcess?.attemptId !== attemptId) return;
          try {
            const output = await ctx.host.pty.read(pty.handle, { cursor, limitBytes: 16384 });
            if (c.authProcess?.attemptId !== attemptId) return;
            cursor = output.cursor;
            if (output.text) ctx.events.emit("acp.authOutput", { conversationId: c.conversationId, methodId: method.id, attemptId, data: output.text });
            if (output.exit) {
              c.authProcess = null;
              emitStatus(ctx, c);
              const code = /^exited with code (\d+)$/.exec(output.exit)?.[1];
              ctx.events.emit("acp.authCompleted", { conversationId: c.conversationId, methodId: method.id, attemptId, code: code === void 0 ? null : Number(code), signal: null });
              await ctx.host.pty.close(pty.handle).catch(() => {
              });
              return;
            }
            setTimeout(() => void poll(), 250);
          } catch {
            if (c.authProcess?.attemptId === attemptId) {
              c.authProcess = null;
              emitStatus(ctx, c);
              ctx.events.emit("acp.authCompleted", { conversationId: c.conversationId, methodId: method.id, attemptId, code: null, signal: null });
            }
          }
        };
        setTimeout(() => void poll(), 250);
        return { outcome: "terminal", ...c.authProcess, display: [plan.launch.executable, ...plan.args.map((a2) => JSON.stringify(a2))].join(" ") };
      }
      await sessionRequest(ctx, c, "authenticate", { methodId: method.id }, 12e4);
      c.error = null;
      emitStatus(ctx, c);
      return { outcome: "authenticated", methodId: method.id };
    },
    async authInput(ctx, a) {
      const c = conns.get(a.conversationId);
      if (!c?.authProcess) throw new Error("No terminal authentication is running");
      if (a.attemptId !== c.authProcess.attemptId) throw new Error("Stale authentication input");
      await ctx.host.pty.write(c.authProcess.handle, String(a.data || ""));
      return null;
    },
    async cancelAuth(ctx, a) {
      const c = conns.get(a.conversationId);
      const auth = c?.authProcess;
      if (!auth) return null;
      if (a.attemptId !== auth.attemptId) throw new Error("Stale authentication cancellation");
      await ctx.host.pty.close(auth.handle).catch(() => {
      });
      if (c.authProcess?.handle === auth.handle) c.authProcess = null;
      emitStatus(ctx, c);
      ctx.events.emit("acp.authCompleted", { conversationId: c.conversationId, methodId: auth.methodId, attemptId: auth.attemptId, code: null, signal: null, cancelled: true });
      return null;
    },
    /** Change a negotiated session setting. Uses configOptions when advertised; legacy modes/models otherwise. */
    async setConfig(ctx, a) {
      const c = conns.get(a.conversationId);
      if (!c || !c.sessionId) throw new Error("agent session not started");
      const changesModel = a.configId === "__model" || c.configOptions?.some((o) => o.id === a.configId && o.category === "model");
      if (c.configOptions && c.configOptions.some((o) => o.id === a.configId)) {
        const option = c.configOptions.find((o) => o.id === a.configId);
        let value = a.value;
        if (option?.type === "boolean") {
          if (typeof value !== "boolean") throw new Error(`Setting '${a.configId}' requires a boolean value`);
        } else if (typeof value !== "string") {
          throw new Error(`Setting '${a.configId}' requires a string value`);
        }
        const r = await c.peer.request("session/set_config_option", {
          sessionId: c.sessionId,
          configId: a.configId,
          ...option?.type === "boolean" ? { type: "boolean", value } : { value }
        });
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
      if (c.activeTurn?.timer) clearTimeout(c.activeTurn.timer);
      c.activeTurn = null;
      for (const resolve of c.pendingPermissions.values()) resolve({ outcome: { outcome: "cancelled" } });
      c.pendingPermissions.clear();
      for (const pending of c.pendingElicitations.values()) {
        clearTimeout(pending.timer);
        pending.resolve({ action: "cancel" });
      }
      c.pendingElicitations.clear();
      const auth = c.authProcess;
      if (auth) await ctx.host.pty.close(auth.handle).catch(() => {
      });
      c.authProcess = null;
      if (auth) ctx.events.emit("acp.authCompleted", { conversationId: c.conversationId, methodId: auth.methodId, attemptId: auth.attemptId, code: null, signal: null, cancelled: true });
      await ctx.host.process.closeStdin(c.proc).catch(() => {
      });
      await ctx.host.process.terminate(c.proc).catch(() => {
      });
      c.status = "exited";
      c.childSessions = disconnectSubagents(c.childSessions);
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
      const provider = String(a?.provider || "");
      await providerById(ctx, provider);
      const workspaceId = a?.workspaceId ? String(a.workspaceId) : null;
      const cur = limits[provider];
      const maxAge = Number.isFinite(a?.maxAgeMs) ? Number(a.maxAgeMs) : 6e4;
      if (!workspaceId || !a.force && cur && !cur.error && limitScopes[provider] === workspaceId && Date.now() - cur.updatedAt < maxAge) return cur;
      const key = probeKey(provider, workspaceId);
      let p = probes.get(key);
      if (!p) {
        setLimits(ctx, provider, { ...cur || { provider, windows: [], plan: null, updatedAt: 0, source: "probe", error: null }, loading: true }, workspaceId);
        p = probeLimits(ctx, provider, workspaceId).catch((e) => ({ ...limits[provider] || { provider, windows: [], plan: null, source: "probe" }, updatedAt: Date.now(), error: errMsg(e) }));
        probes.set(key, p);
        p.then((snap) => {
          probes.delete(key);
          setLimits(ctx, provider, { ...snap, loading: false }, workspaceId);
        });
      }
      return p;
    },
    /** Installed/latest versions of the known adapters on the workspace's machine. */
    async adapters(ctx, a) {
      const desc = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
      const definitions = await providers(ctx);
      if (!definitions.length) return [];
      const npm = await npmRunner(ctx, desc);
      const prefix = npm.ok ? await npm.userPrefix().catch(() => null) : null;
      const out = [];
      for (const definition of definitions) {
        const ad = { id: definition.id, name: definition.profile.name, ...definition.adapter };
        const row = {
          id: ad.id,
          name: ad.name,
          pkg: ad.pkg,
          bin: ad.bin,
          machineId: desc.machineId,
          installed: null,
          latest: null,
          path: null,
          error: null,
          prefix,
          installCommand: "npm " + installArgs(ad.pkg, prefix).join(" ")
        };
        try {
          if (!npm.ok) throw new Error(npm.error);
          if (prefix) row.installed = installedVersion((await npm.run(["ls", "-g", "--prefix", prefix, "--depth=0", "--json", ad.pkg], 6e4)).stdout, ad.pkg);
          if (!row.installed) row.installed = installedVersion((await npm.run(["ls", "-g", "--depth=0", "--json", ad.pkg], 6e4)).stdout, ad.pkg);
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
      const definition = await providerById(ctx, String(a.adapterId));
      const ad = { id: definition.id, ...definition.adapter };
      const desc = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
      const npm = await npmRunner(ctx, desc);
      if (!npm.ok) throw new Error(npm.error);
      const prefix = await npm.userPrefix();
      const args = installArgs(ad.pkg, prefix);
      const r = await npm.run(args, 15 * 60 * 1e3);
      const tail = (r.stderr + "\n" + r.stdout).trim().split("\n").slice(-12).join("\n");
      ctx.events.emit("acp.adaptersChanged", { machineId: desc.machineId, adapterId: ad.id });
      if (r.code !== 0) throw new Error(`npm ${args.join(" ")} failed on ${desc.machineId} (exit ${r.code}):
${tail}`);
      let note = null;
      if (prefix) {
        const d = await detect(ctx, desc, ad.bin);
        if (!d.found || !d.path.startsWith(prefix + "/bin/")) note = `npm's global folder is not writable, so ${ad.bin} was installed to ${prefix}/bin. Add it to the front of PATH on ${desc.machineId} (e.g. in ~/.profile: export PATH="$HOME/.local/bin:$PATH")${d.found ? `; ${d.path} is used now` : ""}.`;
      }
      return { ok: true, adapterId: ad.id, machineId: desc.machineId, output: tail, prefix, note };
    }
  }
};
for (const name of ["newSession", "resumeSession", "loadSession", "forkSession", "closeSession", "deleteSession", "setConfig", "authenticate", "stop"]) {
  const original = mod.methods[name];
  mod.methods[name] = async (ctx, a, meta) => {
    const id = a.conversationId;
    if (startups.has(id) || operations.has(id)) throw new Error("A provider operation is already running");
    const c = conns.get(id);
    if (c && name !== "stop") {
      requireIdleSession(c);
      if (name !== "authenticate" && c.status !== "ready") throw new Error("Reconnect the agent before changing its session");
    }
    const previousDirectories = c?.additionalDirectories;
    operations.set(id, name);
    try {
      return await original(ctx, a, meta);
    } catch (e) {
      if (c && /Invalid session setup response/.test(errMsg(e))) {
        c.status = "error";
        c.sessionClosed = true;
        c.error = errMsg(e);
        emitStatus(ctx, c);
      }
      if (c && previousDirectories) c.additionalDirectories = previousDirectories;
      throw e;
    } finally {
      operations.delete(id);
    }
  };
}
var index_default = mod;
export {
  index_default as default,
  detect,
  providerSessionLimits
};
