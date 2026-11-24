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

// ../sdk/context-usage.ts
function reportedUsage(value) {
  return value && typeof value.used === "number" && Number.isFinite(value.used) && value.used >= 0 && typeof value.size === "number" && Number.isFinite(value.size) && value.size >= 0 ? { used: value.used, size: value.size } : null;
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
var conns = /* @__PURE__ */ new Map();
var limits = {};
var probes = /* @__PURE__ */ new Map();
function publishLimits(ctx) {
  ctx.state.set("acp.limits", limits);
}
function setLimits(ctx, provider, snap) {
  limits = { ...limits, [provider]: snap };
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
  const g = await workspaceGrant(ctx, desc, "process");
  const env = { ...profile.envRefs || {} };
  if (det.pathEnv) env.PATH = det.pathEnv;
  const envRemove = await environmentPolicy(ctx, profile);
  for (const key of envRemove) delete env[key];
  const proc = await ctx.host.process.spawn(g.grant, {
    target: await targetFor(ctx, desc),
    executable: desc.location !== "local" ? profile.executable : det.path,
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
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
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
  const servers = [...a.mcpServers || []];
  let state = { enabled: !!a.mcp, status: a.mcp ? "pending" : "disabled" };
  if (a.mcp) {
    try {
      const ep = await ctx.modules.call("internal-mcp", "endpoint", { conversationId: a.conversationId, workspaceId: desc.id }, { timeoutMs: 3e5 });
      servers.push(ep.server);
      state = { enabled: true, status: `internal MCP via ${ep.transport}` };
    } catch (e) {
      state = { enabled: true, status: `unavailable: ${errMsg(e)}` };
      ctx.log.warn("internal MCP unavailable for", a.conversationId, errMsg(e));
    }
  }
  return { servers, state };
}
async function start(ctx, a) {
  const existing = conns.get(a.conversationId);
  if (existing && (existing.status === "ready" || existing.status === "busy" || existing.status === "starting")) return publicState(existing);
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
    const configuredMcp = preparedMcp || await sessionMcp(ctx, a, desc);
    const mcpServers = configuredMcp.servers;
    c.mcp = configuredMcp.state;
    const sessionServers = launch.wrapped ? launch.sessionServers : mcpServers;
    const caps = c.agentCapabilities.mcpCapabilities || {};
    for (const server of sessionServers) {
      if (server.type === "http" && !caps.http) throw new Error(`Agent does not support HTTP MCP server “${server.name}”`);
      if (server.type === "sse" && !caps.sse) throw new Error(`Agent does not support SSE MCP server “${server.name}”`);
    }
    c.mcp.selection = (a.mcpSelection || (a.mcp ? ["internal"] : [])).filter((id) => id !== "internal" || mcpServers.some((s) => s.name === "hato-internal"));
    let res;
    if (a.resumeSessionId && c.agentCapabilities.loadSession) {
      try {
        c.loadingHistory = true;
        res = await withTimeout(c.peer.request("session/load", { sessionId: a.resumeSessionId, cwd: c.cwd, mcpServers: sessionServers }), 12e4, "session/load");
        c.sessionId = a.resumeSessionId;
      } catch (e) {
        ctx.log.warn("session/load failed; starting a new session", errMsg(e));
        ctx.events.emit("acp.update", { conversationId: c.conversationId, update: { sessionUpdate: "_hato_notice", text: `Could not resume the previous agent session (${errMsg(e)}); started a new one. A bounded dialogue handoff will accompany the next prompt.` } });
      } finally {
        c.loadingHistory = false;
      }
    }
    if (!c.sessionId) {
      res = await withTimeout(c.peer.request("session/new", { cwd: c.cwd, mcpServers: sessionServers }), 12e4, "session/new");
      c.sessionId = res.sessionId;
    }
    c.configOptions = res && Array.isArray(res.configOptions) ? res.configOptions : null;
    c.modes = res && res.modes ? res.modes : null;
    c.models = res && res.models ? res.models : null;
    c.status = "ready";
  } catch (e) {
    c.status = "error";
    const auth = c.authMethods && c.authMethods.length && /auth/i.test(errMsg(e));
    c.error = auth ? `Agent requires authentication on ${c.machineId} (${c.authMethods.map((m) => m.name || m.id).join(", ")}). Authenticate the adapter there then reconnect. Details: ${errMsg(e)}` : errMsg(e);
    emitStatus(ctx, c);
    await ctx.host.process.terminate(c.proc).catch(() => {
    });
    if (a.mcp) await ctx.modules.call("internal-mcp", "revoke", { conversationId: a.conversationId }).catch(() => {
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
      if (c.loadingHistory && ["user_message_chunk", "agent_message_chunk", "agent_thought_chunk", "tool_call", "tool_call_update", "plan"].includes(u.sessionUpdate)) return;
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
            if (next) setLimits(ctx, providerId, next);
          }).catch((e) => ctx.log.warn("Provider usage update:", errMsg(e)));
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
    if (prev?.limits) limits = { ...prev.limits };
    for (const k of Object.keys(limits)) if (limits[k]?.loading) limits[k] = { ...limits[k], loading: false };
    publishLimits(ctx);
    if (prev && Array.isArray(prev.conns)) {
      const available = await profiles(ctx);
      for (const s of prev.conns) {
        const p = available.find((p2) => p2.id === s.profileId);
        const c = { ...s, providerId: s.providerId || p?.provider, providerModule: s.providerModule || p?.providerModule, peer: null };
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
    return { limits, conns: Array.from(conns.values()).map((c) => ({ ...publicState(c), proc: c.proc, providerId: c.providerId, providerModule: c.providerModule, stderrTail: c.stderrTail, nextId: c.peer ? c.peer.nextRequestId : 1, partial: c.peer ? c.peer.partial : "" })) };
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
      const provider = String(a?.provider || "");
      await providerById(ctx, provider);
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
var index_default = mod;
export {
  index_default as default,
  detect,
  providerSessionLimits
};
