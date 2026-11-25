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
function reportedUsage(value) {
  if (!value || typeof value.used !== "number" || !Number.isFinite(value.used) || value.used < 0 || typeof value.size !== "number" || !Number.isFinite(value.size) || value.size < 0) return null;
  return { used: value.used, size: value.size, ...typeof value.cost === "number" && Number.isFinite(value.cost) && value.cost >= 0 ? { cost: value.cost } : {} };
}
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
  fs: { readTextFile: false, writeTextFile: false },
  terminal: false,
  auth: { terminal: true },
  _meta: { "terminal-auth": true },
  elicitation: { form: {} },
  session: { compaction: {} }
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
function sessionMatches(c, params) {
  return !params?.sessionId || params.sessionId === c.sessionId;
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
          if (typeof block.data !== "string" && typeof block.uri !== "string") throw new Error("Image blocks require data or uri");
          return block;
        case "resource":
          if (typeof block.text !== "string" && typeof block.blob !== "string") throw new Error("Resource blocks require text or blob");
          if (typeof block.blob === "string" && typeof block.mimeType !== "string") throw new Error("Blob resources require mimeType");
          return block;
        case "resource_link":
          if (typeof block.uri !== "string") throw new Error("Resource links require uri");
          return block;
        case "audio":
          if (!c.agentCapabilities?.promptCapabilities?.audio) throw new Error("This agent does not support audio prompts");
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
async function start(ctx, a) {
  const existing = conns.get(a.conversationId);
  if (existing && (existing.status === "ready" || existing.status === "busy" || existing.status === "starting")) return publicState(existing);
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
    const init = await withTimeout(c.peer.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: CLIENT_CAPABILITIES,
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
    c.mcpServers = sessionServers;
    const caps = c.agentCapabilities.mcpCapabilities || {};
    for (const server of sessionServers) {
      if (server.type === "http" && !caps.http) throw new Error(`Agent does not support HTTP MCP server “${server.name}”`);
      if (server.type === "sse" && !caps.sse) throw new Error(`Agent does not support SSE MCP server “${server.name}”`);
    }
    const lifecycle = { cwd: c.cwd, mcpServers: sessionServers, ...c.additionalDirectories.length ? { additionalDirectories: c.additionalDirectories } : {} };
    let res;
    if (a.forkSessionId) {
      if (!c.agentCapabilities.sessionCapabilities?.fork) throw new Error("This agent does not support session forking");
      res = await withTimeout(c.peer.request("session/fork", { ...lifecycle, sessionId: String(a.forkSessionId) }), 12e4, "session/fork");
      c.sessionId = res.sessionId;
    } else if (a.resumeSessionId) {
      const sessionId = String(a.resumeSessionId);
      const method = a.resumeMode === "resume" && c.agentCapabilities.sessionCapabilities?.resume ? "session/resume" : c.agentCapabilities.loadSession ? "session/load" : c.agentCapabilities.sessionCapabilities?.resume ? "session/resume" : null;
      if (method) {
        try {
          c.loadingHistory = true;
          res = await withTimeout(c.peer.request(method, { ...lifecycle, sessionId }), 12e4, method);
          c.sessionId = sessionId;
        } catch (e) {
          ctx.log.warn(`${method} failed; starting a new session`, errMsg(e));
          ctx.events.emit("acp.update", { conversationId: c.conversationId, update: { sessionUpdate: "_hato_notice", text: `Could not resume the previous agent session (${errMsg(e)}); started a new one. A bounded dialogue handoff will accompany the next prompt.` } });
        } finally {
          c.loadingHistory = false;
        }
      }
    }
    if (!c.sessionId) {
      res = await withTimeout(c.peer.request("session/new", lifecycle), 12e4, "session/new");
      c.sessionId = res.sessionId;
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
    emitStatus(ctx, c);
    if (!auth) await ctx.host.process.terminate(c.proc).catch(() => {
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
  c.peer.onNotification = (method, params) => {
    if (method === "$/cancel_request") {
      void cancelInternal(ctx, c);
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
      const child = u._meta?.["opencode/child-session"] || params._meta?.["opencode/child-session"];
      if (child?.id) {
        c.childSessions = { ...c.childSessions, [child.id]: child };
        emitStatus(ctx, c);
      }
      ctx.events.emit("acp.update", { conversationId: c.conversationId, sessionId: params.sessionId, update: u });
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
      }
    }
    throw rpcError(-32601, `method not supported by client: ${method}`);
  };
  c.peer.onProtocolError = (err, line) => ctx.log.warn(`ACP protocol error (${c.conversationId}): ${err}: ${line.slice(0, 200)}`);
  await ctx.host.streams.listen(c.proc, { channel: "stdout" }, (chunk) => c.peer.feed(chunk), (err) => {
    const wasBusy = c.status === "busy";
    c.status = "exited";
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
  return { cwd: c.cwd, mcpServers: c.mcpServers, ...c.additionalDirectories.length ? { additionalDirectories: c.additionalDirectories } : {} };
}
function applySessionResult(ctx, c, res, sessionId) {
  c.sessionId = sessionId || res?.sessionId || null;
  c.sessionClosed = false;
  c.configOptions = res && Array.isArray(res.configOptions) ? res.configOptions : null;
  c.modes = res && res.modes ? res.modes : null;
  c.models = res && res.models ? res.models : null;
  c.usage = null;
  c.turnUsage = null;
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
    if (probes.size) return { ok: false, reason: "a usage-limit probe is running" };
    for (const c of conns.values()) {
      if (c.status === "busy" || c.status === "starting" || c.authProcess || c.pendingPermissions.size || c.pendingElicitations.size || c.peer && c.peer.pendingCount > 0) return { ok: false, reason: `ACP session ${c.conversationId} is busy` };
    }
    return { ok: true };
  },
  snapshot() {
    return { limits, limitScopes, conns: Array.from(conns.values()).map((c) => ({ ...publicState(c), proc: c.proc, providerId: c.providerId, providerModule: c.providerModule, profile: c.profile, env: c.env, envRemove: c.envRemove, mcpServers: c.mcpServers, stderrTail: c.stderrTail, nextId: c.peer ? c.peer.nextRequestId : 1, partial: c.peer ? c.peer.partial : "" })) };
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
      if (c.activeTurn) throw new Error("A prompt is already running for this session");
      const blocks = promptBlocks(a, c);
      const timeoutMs = Number.isFinite(a.timeoutMs) ? Math.max(1e3, Math.min(30 * 60 * 1e3, Number(a.timeoutMs))) : 30 * 60 * 1e3;
      c.status = "busy";
      c.error = null;
      c.turnUsage = null;
      c.activeTurn = { cancelled: false };
      emitStatus(ctx, c);
      c.activeTurn.timer = setTimeout(() => {
        if (!c.activeTurn) return;
        void cancelInternal(ctx, c);
        finishTurn(ctx, c, { error: `prompt timed out after ${timeoutMs} ms` });
      }, timeoutMs);
      c.peer.request("session/prompt", { sessionId: c.sessionId, prompt: blocks }).then(
        (r) => finishTurn(ctx, c, { stopReason: r && r.stopReason, usage: r && r.usage }),
        (e) => finishTurn(ctx, c, { error: errMsg(e) })
      );
      return { accepted: true };
    },
    /** Inject a message into the running turn without interrupting it.
     *  Returns `steered`, `promptRequired` (the turn already ended) or `unsupported`. */
    async steer(ctx, a) {
      const c = conns.get(a.conversationId);
      if (!c || !c.sessionId || !c.steering) return { outcome: "unsupported" };
      const blocks = promptBlocks(a, c);
      const r = await withTimeout(c.peer.request("_session/steering", { sessionId: c.sessionId, prompt: blocks, _meta: { steering: { idleBehavior: "promptRequired" } } }), 3e4, "steering");
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
      if (Number.isSafeInteger(a.limit) && a.limit > 0) params.limit = Math.min(100, a.limit);
      return withTimeout(c.peer.request("session/list", params), 6e4, "session/list");
    },
    async newSession(ctx, a) {
      const c = conns.get(a.conversationId);
      if (!c) throw new Error("agent session not started");
      const dirs = additionalDirectories(a.additionalDirectories ?? c.additionalDirectories);
      c.additionalDirectories = dirs;
      const res = await withTimeout(c.peer.request("session/new", lifecycleParams(c)), 12e4, "session/new");
      applySessionResult(ctx, c, res);
      return publicState(c);
    },
    async resumeSession(ctx, a) {
      const c = conns.get(a.conversationId);
      if (!c) throw new Error("agent session not started");
      if (!c.agentCapabilities.sessionCapabilities?.resume) throw new Error("This agent does not support session resume");
      const dirs = additionalDirectories(a.additionalDirectories ?? c.additionalDirectories);
      c.additionalDirectories = dirs;
      const res = await withTimeout(c.peer.request("session/resume", { ...lifecycleParams(c), sessionId: String(a.sessionId) }), 12e4, "session/resume");
      applySessionResult(ctx, c, res, String(a.sessionId));
      return publicState(c);
    },
    async loadSession(ctx, a) {
      const c = conns.get(a.conversationId);
      if (!c) throw new Error("agent session not started");
      if (!c.agentCapabilities.loadSession) throw new Error("This agent does not support session loading");
      const dirs = additionalDirectories(a.additionalDirectories ?? c.additionalDirectories);
      c.additionalDirectories = dirs;
      const res = await withTimeout(c.peer.request("session/load", { ...lifecycleParams(c), sessionId: String(a.sessionId) }), 12e4, "session/load");
      applySessionResult(ctx, c, res, String(a.sessionId));
      return publicState(c);
    },
    async forkSession(ctx, a) {
      const c = conns.get(a.conversationId);
      if (!c) throw new Error("agent session not started");
      if (!c.agentCapabilities.sessionCapabilities?.fork) throw new Error("This agent does not support session forking");
      const dirs = additionalDirectories(a.additionalDirectories ?? c.additionalDirectories);
      c.additionalDirectories = dirs;
      const res = await withTimeout(c.peer.request("session/fork", { ...lifecycleParams(c), sessionId: String(a.sessionId) }), 12e4, "session/fork");
      applySessionResult(ctx, c, res);
      return publicState(c);
    },
    async closeSession(ctx, a) {
      const c = conns.get(a.conversationId);
      if (!c || !c.sessionId) throw new Error("agent session not started");
      if (!c.agentCapabilities.sessionCapabilities?.close) throw new Error("This agent does not support session close");
      await withTimeout(c.peer.request("session/close", { sessionId: c.sessionId }), 6e4, "session/close");
      c.sessionClosed = true;
      emitStatus(ctx, c);
      return publicState(c);
    },
    async deleteSession(ctx, a) {
      const c = conns.get(a.conversationId);
      if (!c) throw new Error("agent session not started");
      if (!c.agentCapabilities.sessionCapabilities?.delete) throw new Error("This agent does not support session deletion");
      const sessionId = String(a.sessionId || c.sessionId || "");
      if (!sessionId) throw new Error("sessionId is required");
      await withTimeout(c.peer.request("session/delete", { sessionId }), 6e4, "session/delete");
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
      const method = c.authMethods.find((entry) => entry.id === a.methodId);
      if (!method) throw new Error(`Unknown authentication method '${String(a.methodId)}'`);
      const terminal = method._meta?.["terminal-auth"];
      if (terminal || a.terminal) {
        const desc = await ctx.modules.call("workspace", "resolve", { workspaceId: c.workspaceId });
        const profile = c.profile || await resolveProfile(ctx, c.profileId, desc.machineId);
        const command = typeof terminal?.command === "string" ? terminal.command : desc.location === "local" ? c.executablePath : profile.executable;
        const args = Array.isArray(terminal?.args) ? terminal.args.map(String) : [...profile.args || [], "--login"];
        const g = await workspaceGrant(ctx, desc, "process");
        const proc = await ctx.host.process.spawn(g.grant, {
          target: await targetFor(ctx, desc),
          executable: command,
          args,
          cwd: desc.rootAbsolutePath,
          env: c.env || { ...profile.envRefs || {} },
          envRemove: c.envRemove || [],
          loginShell: desc.location !== "local"
        });
        c.authProcess = { handle: proc.handle, pid: proc.pid, methodId: method.id };
        emitStatus(ctx, c);
        const subOut = await ctx.host.streams.listen(proc.handle, { channel: "stdout" }, (chunk) => ctx.events.emit("acp.authOutput", { conversationId: c.conversationId, methodId: method.id, channel: "stdout", data: chunk }));
        const subErr = await ctx.host.streams.listen(proc.handle, { channel: "stderr" }, (chunk) => ctx.events.emit("acp.authOutput", { conversationId: c.conversationId, methodId: method.id, channel: "stderr", data: chunk }));
        void ctx.host.process.wait(proc.handle).then((result) => {
          void subOut.close().catch(() => {
          });
          void subErr.close().catch(() => {
          });
          if (c.authProcess?.handle === proc.handle) c.authProcess = null;
          emitStatus(ctx, c);
          ctx.events.emit("acp.authCompleted", { conversationId: c.conversationId, methodId: method.id, code: result?.code ?? null, signal: result?.signal ?? null });
        }).catch(() => {
        });
        return { outcome: "terminal", pid: proc.pid, command, args, label: terminal?.label || method.name || method.id };
      }
      await withTimeout(c.peer.request("authenticate", { methodId: method.id }), 12e4, "authenticate");
      c.error = null;
      emitStatus(ctx, c);
      return { outcome: "authenticated", methodId: method.id };
    },
    async authInput(ctx, a) {
      const c = conns.get(a.conversationId);
      if (!c?.authProcess) throw new Error("No terminal authentication is running");
      await ctx.host.process.write(c.authProcess.handle, String(a.data || ""));
      return null;
    },
    async cancelAuth(ctx, a) {
      const c = conns.get(a.conversationId);
      const auth = c?.authProcess;
      if (!auth) return null;
      await ctx.host.process.closeStdin(auth.handle).catch(() => {
      });
      await ctx.host.process.terminate(auth.handle).catch(() => {
      });
      if (c.authProcess?.handle === auth.handle) c.authProcess = null;
      emitStatus(ctx, c);
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
        const r = await c.peer.request("session/set_config_option", { sessionId: c.sessionId, configId: a.configId, value });
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
      if (auth) await ctx.host.process.terminate(auth.handle).catch(() => {
      });
      c.authProcess = null;
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
var index_default = mod;
export {
  index_default as default,
  detect,
  providerSessionLimits
};
