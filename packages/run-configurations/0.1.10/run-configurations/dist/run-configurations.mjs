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
async function withWorkspace(ctx, desc, fn) {
  try {
    return await fn();
  } catch (e) {
    if (desc.location === "ssh" && e && (e.code === "ENOTCONN" || e.code === "ESTALE" || e.code === "EBADF")) {
      forgetSsh(desc.machineId);
      return await fn();
    }
    throw e;
  }
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
      const scope2 = request.scope;
      if (!scope2 || typeof scope2.workspaceId !== "string" || typeof scope2.conversationId !== "string" || typeof scope2.machineId !== "string") throw new Error("Missing authenticated MCP scope");
      const result = await tool.handler(request.args || {}, scope2);
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

// modules/services/run-configurations/src/config.ts
var envName = /^[A-Za-z_][A-Za-z0-9_]*$/;
var mask = "••••••";
function string(value, field, max = 2048) {
  if (typeof value !== "string" || value.length > max || value.includes("\0")) throw new Error(`Invalid ${field}`);
  return value;
}
function required(value, field, max) {
  const text = string(value, field, max).trim();
  if (!text) throw new Error(`Enter ${field}`);
  return text;
}
function relativePath(value, field, rootAllowed = false) {
  const path = required(value, field).replace(/^\.\//, "");
  if (path === "." && rootAllowed) return path;
  if (!path || /^(?:\/|[A-Za-z]:)|[\\\r\n]/.test(path) || path.split("/").some((p) => !p || p === "." || p === "..")) {
    throw new Error(`${field} must be relative to the workspace`);
  }
  return path;
}
function array(value, label, limit = 100) {
  if (!Array.isArray(value) || value.length > limit) throw new Error(`Invalid ${label}`);
  return value;
}
var args = (value) => array(value, "arguments").map((v) => string(v, "argument", 8192));
function environment(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid environment variables");
  const entries = Object.entries(value);
  if (entries.length > 200) throw new Error("Too many inline environment variables");
  return Object.fromEntries(entries.map(([key, val]) => {
    if (!envName.test(key) || key.length > 128) throw new Error("Invalid environment variable name");
    return [key, string(val, "environment variable value", 8192)];
  }));
}
function normalizeConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Provide a run configuration");
  return {
    name: required(value.name, "a configuration name", 120),
    type: required(value.type, "a configuration type", 80),
    target: required(value.target, "a target"),
    cwd: relativePath(value.cwd ?? ".", "Working directory", true),
    args: args(value.args ?? []),
    runtimeArgs: args(value.runtimeArgs ?? []),
    runtime: string(value.runtime ?? "", "runtime").trim(),
    shared: value.shared === true,
    env: environment(value.env ?? {}),
    envFiles: array(value.envFiles ?? [], "environment files", 20).map((p) => relativePath(p, "Environment file")),
    profiles: array(value.profiles ?? [], "profiles", 40).map((p) => required(p, "profile", 120)),
    beforeLaunch: array(value.beforeLaunch ?? [], "before-launch steps", 30).map((step) => ({
      kind: ["build", "npm", "configuration", "command"].find((kind) => kind === step?.kind) ?? "command",
      executable: required(step?.executable, "a before-launch executable"),
      args: args(step.args ?? []),
      cwd: step.cwd ? relativePath(step.cwd, "Before-launch working directory", true) : ""
    }))
  };
}
function parseEnv(text, path) {
  const entries = [];
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;
    const assignment = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!assignment) throw new Error(`${path}:${i + 1} must contain a KEY=value assignment`);
    const [, key, raw] = assignment;
    const quote = raw[0];
    if (quote !== '"' && quote !== "'" && quote !== "`") {
      entries.push([key, raw.split("#", 1)[0].trimEnd()]);
      continue;
    }
    const start = i;
    let value = raw.slice(1), end = -1, index = 0;
    while (i < lines.length) {
      while (index < value.length) {
        if (quote === '"' && value[index] === "\\") {
          index += 2;
          continue;
        }
        if (value[index] === quote) {
          end = index;
          break;
        }
        index++;
      }
      if (end >= 0 || i + 1 >= lines.length) break;
      value += "\n" + lines[++i];
    }
    if (end < 0 || !/^\s*(?:#.*)?$/.test(value.slice(end + 1))) throw new Error(`${path}:${start + 1} has an invalid quoted value`);
    const content = value.slice(0, end);
    entries.push([key, quote === '"' ? content.replace(/\\([nrt"\\])/g, (_, c) => ({ n: "\n", r: "\r", t: "	", '"': '"', "\\": "\\" })[c]) : content]);
  }
  return entries;
}

// modules/services/run-configurations/src/workspace-files.ts
var excluded = /* @__PURE__ */ new Set(["node_modules", "target", "build", "dist", "out", "coverage", "vendor"]);
var sourceFile = /(^|\/)package\.json$|\.java$/;
var candidateFile = /(^|\/)(pom\.xml|build\.gradle(?:\.kts)?)$|\.[cm]?[jt]sx?$/;
function readText(ctx, d, path, max) {
  return withWorkspace(ctx, d, async () => {
    const grant = await workspaceGrant(ctx, d, "fs");
    const r = await ctx.host.fs.read(grant.grant, path, max);
    if (r.binary || r.truncated || typeof r.text !== "string") throw new Error(`${path} must be a text file smaller than ${max / 1024} KiB`);
    return r.text;
  });
}
function scanRunFiles(ctx, d) {
  return withWorkspace(ctx, d, async () => {
    const grant = await workspaceGrant(ctx, d, "fs");
    const dirs = ["."], paths = [], toRead = [];
    let limited = false;
    for (let i = 0; i < dirs.length && i < 300; i += 12) {
      const batch = dirs.slice(i, i + 12);
      const listing = await Promise.all(batch.map((path) => ctx.host.fs.list(grant.grant, path).catch((e) => {
        if (path === "." || e.code === "ENOTCONN" || e.code === "ESTALE") throw e;
        limited = true;
        return { entries: [] };
      })));
      for (const [index, result] of listing.entries()) {
        const dir = batch[index];
        for (const entry of result.entries) {
          if (entry.name.startsWith(".")) continue;
          const path = dir === "." ? entry.name : `${dir}/${entry.name}`;
          if (entry.kind === "dir" && !excluded.has(entry.name)) {
            if (dirs.length < 300) dirs.push(path);
            else limited = true;
          } else if (entry.kind === "file") {
            if (sourceFile.test(path)) {
              if (toRead.length < 450) toRead.push(path);
              else limited = true;
            }
            if (candidateFile.test(path)) {
              if (paths.length < 3e3) paths.push(path);
              else limited = true;
            }
          }
        }
      }
      i -= 12 - batch.length;
    }
    const sources = [];
    for (let i = 0; i < toRead.length; i += 12) {
      const batch = await Promise.all(toRead.slice(i, i + 12).map(async (path) => {
        const r = await ctx.host.fs.read(grant.grant, path, 128 * 1024).catch((e) => {
          if (e.code === "ENOTCONN" || e.code === "ESTALE") throw e;
          return null;
        });
        return r && !r.binary && !r.truncated && typeof r.text === "string" ? { path, text: r.text } : null;
      }));
      for (const source of batch) if (source) sources.push(source);
      else limited = true;
    }
    return { sources, paths, limited };
  });
}
async function resolveEnvironment(ctx, d, a, allowMissing = false) {
  const values = /* @__PURE__ */ new Map();
  const missing = [];
  const files = a.envFiles ?? [];
  if (!Array.isArray(files) || files.length > 20) throw new Error("Choose up to 20 environment files");
  for (const candidate of files) {
    const path = relativePath(candidate, "Environment file");
    try {
      for (const [name, value] of parseEnv(await readText(ctx, d, path, 128 * 1024), path)) values.set(name, { name, source: path, value });
    } catch (e) {
      if (!allowMissing || e.code !== "ENOENT") throw e;
      missing.push(path);
    }
  }
  for (const [name, value] of Object.entries(environment(a.env ?? {}))) values.set(name, { name, source: "Inline", value });
  return { values: [...values.values()], missing };
}
async function environmentPreview(ctx, d, a, reveal) {
  const { values, missing } = await resolveEnvironment(ctx, d, a, true);
  return { missing, rows: values.sort((a2, b) => a2.name.localeCompare(b.name)).map((row) => ({
    ...row,
    value: reveal || !/SECRET|TOKEN|PASSWORD|KEY/i.test(row.name) ? row.value : mask
  })) };
}

// modules/services/run-configurations/src/index.ts
var providers = ["language-java", "language-typescript"];
var sharePath = ".hato/run.json";
var setting = "run-configurations";
var mcp;
var writing = 0;
var markersVersion = 0;
var projectWrites = /* @__PURE__ */ new Map();
async function workspace(ctx, id) {
  if (!id || typeof id !== "string") throw new Error("Select a project or task workspace");
  return ctx.modules.call("workspace", "resolve", { workspaceId: id });
}
async function runTypes(ctx) {
  const { plugins } = await ctx.host.plugins.list();
  const modules = providers.filter((id) => plugins.some((p) => p.id === id && p.enabled && p.active));
  const typed = await Promise.all(modules.map(async (id) => ({
    id,
    types: await ctx.modules.call(id, "runConfigurations.types", {}).catch(() => [])
  })));
  return typed.filter((p) => p.types.length > 0);
}
var scope = (d) => `workspace:project:${d.projectId}:root`;
async function load(ctx, d) {
  const saved = await ctx.modules.call("persistence", "scoped.get", { scope: scope(d), key: setting });
  return { items: Array.isArray(saved?.value) ? saved.value : [], rev: saved?.rev ?? 0 };
}
async function save(ctx, d, items, expectedRev) {
  if (items.length > 100) throw new Error("A project can have up to 100 run configurations");
  await ctx.modules.call("persistence", "scoped.set", { scope: scope(d), key: setting, value: items, expectedRev });
  ctx.events.emit("run-configurations.changed", { workspaceId: d.id, projectId: d.projectId });
}
function find(items, id) {
  const entry = items.find((item) => item.id === id);
  if (!entry) throw new Error("Run configuration was not found in this project");
  return entry;
}
function redact(config) {
  return { ...config, env: Object.fromEntries(Object.keys(config.env).map((key) => [key, mask])) };
}
function requireRevision(config, rev) {
  if (rev !== config.revision) throw new Error("Configuration changed. Reload it before saving or deleting.");
}
async function detect(ctx, d) {
  const active = await runTypes(ctx);
  if (!active.length) return { candidates: [], limited: false, warnings: ["Enable an updated Java or JavaScript & TypeScript plugin to detect launch targets."] };
  const { limited, ...files } = await scanRunFiles(ctx, d);
  const replies = await Promise.all(active.map(async ({ id, types }) => {
    const allowed = new Set(types.map((type) => type.id));
    const sources = files.sources.filter((f) => id === "language-java" ? f.path.endsWith(".java") : f.path.endsWith("package.json"));
    try {
      const result = await ctx.modules.call(id, "runConfigurations.detect", { sources, paths: files.paths }, { timeoutMs: 6e4 });
      return { candidates: result.filter((c) => allowed.has(c.type)), warning: "" };
    } catch (e) {
      return { candidates: [], warning: `${id}: ${errMsg(e)}` };
    }
  }));
  const candidates = /* @__PURE__ */ new Map();
  for (const c of replies.flatMap((r) => r.candidates)) candidates.set(JSON.stringify([c.type, c.cwd, c.target]), c);
  return {
    candidates: [...candidates.values()].slice(0, 200),
    limited: limited || candidates.size > 200,
    warnings: replies.map((r) => r.warning).filter(Boolean)
  };
}
async function publishMarkers(ctx, current) {
  const version = ++markersVersion;
  ctx.state.set("run-configurations.gutter", null);
  if (!current || !/(?:\.java|(?:^|\/)package\.json)$/.test(current.path)) return;
  try {
    const path = relativePath(current.path, "Source file");
    const d = await workspace(ctx, current.workspaceId);
    const provider = path.endsWith(".java") ? "language-java" : "language-typescript";
    if (!(await runTypes(ctx)).some((p) => p.id === provider)) return;
    const source = await readText(ctx, d, path, 128 * 1024);
    const paths = [path];
    if (provider === "language-java") {
      const dirs = path.split("/").slice(0, -1);
      const grant = await workspaceGrant(ctx, d, "fs");
      for (let count = 0; count <= dirs.length; count++) {
        const parent = dirs.slice(0, count).join("/") || ".";
        const result = await ctx.host.fs.list(grant.grant, parent).catch(() => null);
        for (const entry of result?.entries ?? []) if (["pom.xml", "build.gradle", "build.gradle.kts"].includes(entry.name)) {
          paths.push(parent === "." ? entry.name : `${parent}/${entry.name}`);
        }
      }
    }
    const candidates = await ctx.modules.call(provider, "runConfigurations.detect", { sources: [{ path, text: source }], paths });
    if (version !== markersVersion) return;
    ctx.state.set("run-configurations.gutter", { ...current, candidates: candidates.filter((c) => c.file === path && c.type !== "node") });
  } catch (e) {
    ctx.log.debug("run gutter detection", errMsg(e));
  }
}
async function operation(ctx, d, op, a, privateValues = false) {
  if (op === "detect") return detect(ctx, d);
  const { items, rev } = await load(ctx, d);
  if (op === "list") return items.map(redact);
  if (op === "get") {
    const config2 = find(items, a.id);
    return privateValues ? config2 : redact(config2);
  }
  if (op === "delete") {
    const config2 = find(items, a.id);
    requireRevision(config2, a.revision);
    if (config2.shared) await updateShare(ctx, d, config2.name);
    await save(ctx, d, items.filter((c) => c.id !== config2.id), rev);
    return { deleted: config2.id };
  }
  const prev = op === "update" ? find(items, a.id) : null;
  if (prev) requireRevision(prev, a.revision);
  if (!a.config || typeof a.config !== "object" || Array.isArray(a.config)) throw new Error("Provide configuration fields");
  const draft2 = normalizeConfig({ ...prev, ...a.config });
  if (!privateValues && Object.values(a.config.env ?? {}).includes(mask)) throw new Error("Omit env to preserve the stored values, or provide replacement values");
  if (draft2.type !== prev?.type && !(await runTypes(ctx)).some((p) => p.types.some((type) => type.id === draft2.type))) throw new Error("Enable the language plugin for this configuration type");
  if (items.some((item) => item.id !== prev?.id && item.name.toLowerCase() === draft2.name.toLowerCase())) throw new Error("A run configuration already uses that name");
  const config = { ...draft2, id: prev?.id ?? crypto.randomUUID(), revision: (prev?.revision ?? 0) + 1 };
  if (config.shared || prev?.shared) await updateShare(ctx, d, prev?.shared ? prev.name : void 0, config.shared ? config : void 0);
  await save(ctx, d, prev ? items.map((c) => c.id === prev.id ? config : c) : [...items, config], rev);
  return privateValues ? config : redact(config);
}
function dispatch(ctx, d, op, a, privateValues = false) {
  if (op === "list" || op === "get" || op === "detect") return operation(ctx, d, op, a, privateValues);
  return writeProject(d.projectId, () => operation(ctx, d, op, a, privateValues));
}
function writeProject(projectId, work) {
  const next = (projectWrites.get(projectId) ?? Promise.resolve()).then(work);
  const tail = next.catch(() => {
  });
  projectWrites.set(projectId, tail);
  void tail.finally(() => {
    if (projectWrites.get(projectId) === tail) projectWrites.delete(projectId);
  });
  return next;
}
async function tracked(op) {
  writing++;
  try {
    return await op();
  } finally {
    writing--;
  }
}
async function readShare(ctx, d) {
  const raw = JSON.parse(await readText(ctx, d, sharePath, 256 * 1024));
  if (raw?.version !== 1 || !Array.isArray(raw.configurations) || raw.configurations.length > 100) throw new Error("Unsupported .hato/run.json format");
  return raw.configurations.map(normalizeConfig);
}
async function updateShare(ctx, d, oldName, config) {
  const shared = await readShare(ctx, d).catch((e) => {
    if (e.code === "ENOENT") return [];
    throw e;
  });
  const collision = config && shared.some((c) => c.name === config.name && c.name !== oldName);
  if (collision) throw new Error("A shared configuration already has this name. Import or rename it first.");
  const next = shared.filter((c) => c.name !== oldName);
  if (config) next.push({ ...config, env: {} });
  await writeShare(ctx, d, next, true, true);
}
async function writeShare(ctx, d, items, replace, preservePublishedEnv = false) {
  const json = { version: 1, configurations: items.map((config) => {
    const { id: _id, revision: _rev, env, shared: _shared, ...rest } = config;
    return { ...rest, ...preservePublishedEnv && Object.keys(env).length ? { env } : {} };
  }) };
  const text = JSON.stringify(json, null, 2) + "\n";
  if (text.length > 120 * 1024) throw new Error("The exported configuration file is too large");
  return withWorkspace(ctx, d, async () => {
    const grant = await ctx.host.capabilities.request({
      kind: "fs",
      root: d.rootAbsolutePath,
      target: await targetFor(ctx, d),
      write: true,
      purpose: "Export run configurations"
    });
    try {
      if (!replace) {
        const existing = await ctx.host.fs.stat(grant.grant, sharePath).catch((e) => {
          if (e.code === "ENOENT") return null;
          throw e;
        });
        if (existing) throw new Error("A shared file already exists. Import it or confirm replacement.");
      }
      await ctx.host.fs.mkdir(grant.grant, ".hato");
      await ctx.host.fs.writeAtomic(grant.grant, sharePath, text, { reason: "Export project run configurations" });
      return { count: items.length };
    } finally {
      await ctx.host.capabilities.release(grant.grant);
    }
  });
}
var string2 = { type: "string" };
var revision = { type: "integer", minimum: 1 };
var strings = { type: "array", items: string2 };
var draft = { type: "object", additionalProperties: false, properties: {
  name: string2,
  type: string2,
  target: string2,
  args: strings,
  runtimeArgs: strings,
  cwd: string2,
  env: { type: "object", additionalProperties: string2 },
  envFiles: strings,
  profiles: strings,
  runtime: string2,
  shared: { type: "boolean" },
  beforeLaunch: { type: "array", items: { type: "object", properties: { kind: { enum: ["build", "npm", "configuration", "command"] }, executable: string2, args: strings, cwd: string2 }, required: ["executable"], additionalProperties: false } }
} };
var definitions = [
  ["list", "List run configurations for the authenticated project, with inline environment values masked.", {}, []],
  ["get", "Read a run configuration in this project, with inline environment values masked.", { id: string2 }, ["id"]],
  ["create", "Create a run configuration in this project. Provide name, type and target.", { config: { ...draft, required: ["name", "type", "target"] } }, ["config"]],
  ["update", "Update fields on a run configuration using its current revision. Omit env to preserve its values.", { id: string2, revision, config: draft }, ["id", "revision", "config"]],
  ["delete", "Delete a run configuration by ID and current revision.", { id: string2, revision }, ["id", "revision"]],
  ["detect", "Detect runnable Java and JavaScript/TypeScript targets in this workspace. This only reads workspace files.", {}, []]
];
var mod = {
  id: "run-configurations",
  moduleApiVersion: 1,
  activate(ctx) {
    const refreshMarkers = () => void publishMarkers(ctx, ctx.state.get("viewer.runSource") || null);
    ctx.state.watch("viewer.runSource", refreshMarkers);
    ctx.events.on("kernel.modules.changed", refreshMarkers);
    ctx.events.on("files.changed", (e) => {
      if (e.workspaceId === ctx.state.get("viewer.runSource")?.workspaceId) refreshMarkers();
    });
    refreshMarkers();
    mcp = exportMcpTools(ctx, "Run configurations", definitions.map(([op, description, properties, required2]) => ({
      name: `run_configs_${op}`,
      description,
      inputSchema: { type: "object", properties, required: required2, additionalProperties: false },
      annotations: { readOnlyHint: op === "list" || op === "get" || op === "detect", destructiveHint: op === "delete" },
      timeoutMs: op === "detect" ? 12e4 : void 0,
      handler: async (a, session) => tracked(async () => {
        const d = await workspace(ctx, session.workspaceId);
        if (d.machineId !== session.machineId) throw new Error("MCP workspace machine does not match its authenticated scope");
        return dispatch(ctx, d, op, a);
      })
    })));
  },
  canSwap: () => ({ ok: writing === 0 && !mcp?.pending(), reason: "Run configuration operation in progress" }),
  methods: {
    types: async (ctx) => (await runTypes(ctx)).flatMap((p) => p.types),
    ...Object.fromEntries(definitions.map(([op]) => [op, (ctx, a, meta) => tracked(async () => dispatch(ctx, await workspace(ctx, a.workspaceId), op, a, meta.caller === "run-configurations-panel"))])),
    environment: async (ctx, a, meta) => environmentPreview(ctx, await workspace(ctx, a.workspaceId), a, meta.caller === "run-configurations-panel" && a.reveal === true),
    async directories(ctx, a) {
      const d = await workspace(ctx, a.workspaceId);
      const cwd = relativePath(a.cwd || ".", "Working directory", true);
      const g = await workspaceGrant(ctx, d, "fs");
      const { entries } = await ctx.host.fs.list(g.grant, cwd);
      return { cwd, dirs: entries.filter((e) => e.kind === "dir" && !e.name.startsWith(".")).slice(0, 160).map((e) => cwd === "." ? e.name : `${cwd}/${e.name}`) };
    },
    async hints(ctx, a) {
      const d = await workspace(ctx, a.workspaceId);
      const cwd = relativePath(a.cwd || ".", "Working directory", true);
      const profiles = /* @__PURE__ */ new Set();
      const runtimes = [];
      const at = (name) => cwd === "." ? name : `${cwd}/${name}`;
      if (a.type === "spring-boot" || a.type === "java-maven") {
        const g = await workspaceGrant(ctx, d, "fs");
        for (const dir of [cwd, at("src/main/resources"), at("src/test/resources")]) {
          const listed = await ctx.host.fs.list(g.grant, dir).catch(() => null);
          for (const entry of listed?.entries ?? []) {
            const name = /^application-(.+)\.(?:properties|ya?ml)$/.exec(entry.name)?.[1];
            if (name && a.type === "spring-boot") profiles.add(name);
          }
        }
        if (a.type === "java-maven") {
          const pom = await readText(ctx, d, at("pom.xml"), 128 * 1024).catch(() => "");
          for (const match of pom.matchAll(/<profile>\s*<id>([^<]+)<\/id>/g)) profiles.add(match[1].trim());
        }
      }
      const java = /^(java-|junit$|spring-boot$)/.test(a.type || "");
      const version = await withWorkspace(ctx, d, async () => {
        const grant = await workspaceGrant(ctx, d, "process");
        return ctx.host.process.run(grant.grant, {
          target: await targetFor(ctx, d),
          cwd: d.rootAbsolutePath,
          executable: java ? "java" : "node",
          args: java ? ["-XshowSettings:properties", "-version"] : ["--version"],
          loginShell: d.location !== "local"
        }, { timeoutMs: 4e3, limitBytes: 32 * 1024 });
      }).catch(() => null);
      if (version?.code === 0) {
        const executable = java ? /^\s*java\.home\s*=\s*(.+)$/m.exec(version.stderr)?.[1]?.trim() : "node";
        if (executable) runtimes.push(executable);
      }
      return { profiles: [...profiles].filter(Boolean).slice(0, 50), runtimes };
    },
    async resolveLaunch(ctx, a, meta) {
      if (meta.caller !== "run") throw new Error("Only the run service can resolve launch values");
      const d = await workspace(ctx, a.workspaceId);
      const { items } = await load(ctx, d);
      const candidate = a.candidate;
      const config = a.configId ? items.find((c) => c.name === a.configId) || find(items, a.configId) : normalizeConfig({ name: candidate?.name, type: candidate?.type, target: candidate?.target, cwd: candidate?.cwd });
      const { values } = await resolveEnvironment(ctx, d, config);
      return { ...config, env: Object.fromEntries(values.map((v) => [v.name, v.value])) };
    },
    async reorder(ctx, a) {
      const d = await workspace(ctx, a.workspaceId);
      return tracked(() => writeProject(d.projectId, async () => {
        const { items, rev } = await load(ctx, d);
        if (!Array.isArray(a.ids) || a.ids.length !== items.length || new Set(a.ids).size !== items.length) throw new Error("Provide each configuration ID once");
        await save(ctx, d, a.ids.map((id) => find(items, id)), rev);
      }));
    },
    async importShared(ctx, a) {
      const d = await workspace(ctx, a.workspaceId);
      return tracked(() => writeProject(d.projectId, async () => {
        const imported = await readShare(ctx, d);
        const { items, rev } = await load(ctx, d);
        const names = new Set(items.map((c) => c.name.toLowerCase()));
        const additions = [];
        for (const draft2 of imported) {
          if (names.has(draft2.name.toLowerCase())) continue;
          names.add(draft2.name.toLowerCase());
          additions.push({ ...draft2, shared: true, id: crypto.randomUUID(), revision: 1 });
        }
        if (additions.length) await save(ctx, d, [...items, ...additions], rev);
        return { added: additions.length, skipped: imported.length - additions.length };
      }));
    },
    exportShared: (ctx, a) => tracked(async () => {
      const d = await workspace(ctx, a.workspaceId);
      return writeProject(d.projectId, async () => {
        const { items } = await load(ctx, d);
        if (!items.length) throw new Error("Create a run configuration before exporting");
        return writeShare(ctx, d, items, a.replace === true);
      });
    })
  }
};
var index_default = mod;
export {
  index_default as default
};
