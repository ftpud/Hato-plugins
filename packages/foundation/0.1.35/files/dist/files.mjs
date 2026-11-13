// ../sdk/file-presentation.ts
var escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function filePresentationRules(plugins, state) {
  const rules = [];
  for (const plugin of [...plugins].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!plugin.enabled || !plugin.active) continue;
    const contribution = state?.(`${plugin.id}.filePresentation`) ?? plugin.contributes?.filePresentation;
    if (!Array.isArray(contribution?.rules)) continue;
    for (const rule of contribution.rules) {
      if (!rule || typeof rule.id !== "string" || typeof rule.pathPattern !== "string") continue;
      try {
        if (rule.contentPattern) new RegExp(rule.contentPattern.replace(/\$FILE_STEM/g, "File"), "m");
        rules.push({ rule, path: new RegExp(rule.pathPattern) });
      } catch {
      }
    }
  }
  return rules.sort((a, b) => (Number.isFinite(a.rule.priority) ? a.rule.priority : 0) - (Number.isFinite(b.rule.priority) ? b.rule.priority : 0));
}
function presentationSource(text) {
  return text.replace(
    /\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\r\n]*|"""[\s\S]*?(?:"""|$)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g,
    (part) => part.replace(/[^\r\n]/g, " ")
  );
}
function matchingFileRules(rules, entry) {
  return rules.filter(({ rule, path }) => (!rule.kind || rule.kind === entry.kind) && path.test(entry.path));
}
function presentFile(rules, entry, text) {
  const result = {};
  const stem = entry.path.split("/").pop().replace(/\.[^.]+$/, "");
  let source;
  for (const { rule } of matchingFileRules(rules, entry)) {
    if (rule.contentPattern) {
      if (text === void 0) continue;
      source ?? (source = presentationSource(text));
      if (!new RegExp(rule.contentPattern.replace(/\$FILE_STEM/g, escapeRegex(stem)), "m").test(source)) continue;
    }
    for (const key of ["iconSvg", "iconColor", "background", "description"])
      if (typeof rule[key] === "string") result[key] = rule[key];
  }
  return result;
}

// ../sdk/languages.ts
function relativeFile(path) {
  if (!path || /^[\\/]|^[a-z]:/i.test(path) || path.includes("\0")) throw new Error("Expected a workspace-relative file");
  const parts = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (part === "..") {
      if (!parts.length) throw new Error("File escapes the workspace");
      parts.pop();
    } else if (part && part !== ".") parts.push(part);
  }
  if (!parts.length) throw new Error("Expected a file");
  return parts.join("/");
}

// ../sdk/runtime.ts
var grantCache = /* @__PURE__ */ new Map();
var sshCache = /* @__PURE__ */ new Map();
function sshProfileSpec(ssh) {
  return { profileId: ssh.profileId, host: ssh.host, port: ssh.port, user: ssh.user, identityFile: ssh.identityFile ?? null, transport: ssh.transport ?? "ssh", ...ssh.auth ? { auth: ssh.auth } : {} };
}
function sshConnect(ctx, desc2) {
  if (desc2.location !== "ssh" || !desc2.ssh) throw new Error("not an SSH workspace");
  const key = desc2.machineId;
  let p = sshCache.get(key);
  if (!p) {
    p = ctx.host.ssh.connect(sshProfileSpec(desc2.ssh));
    sshCache.set(key, p);
    p.catch(() => sshCache.delete(key));
  }
  return p;
}
function forgetSsh(machineId) {
  sshCache.delete(machineId);
  for (const k of Array.from(grantCache.keys())) if (k.includes("|" + machineId + "|")) grantCache.delete(k);
}
async function targetFor(ctx, desc2) {
  if (desc2.location === "local") return { kind: "local" };
  const c = await sshConnect(ctx, desc2);
  return { kind: "ssh", connection: c.connection, machineId: c.machineId };
}
async function workspaceGrant(ctx, desc2, kind, root) {
  const r = root || desc2.rootAbsolutePath;
  const key = kind + "|" + desc2.machineId + "|" + r;
  let p = grantCache.get(key);
  if (!p) {
    p = (async () => {
      const target = await targetFor(ctx, desc2);
      return ctx.host.capabilities.request({ kind, root: r, target });
    })();
    grantCache.set(key, p);
    p.catch(() => grantCache.delete(key));
  }
  try {
    return await p;
  } catch (e) {
    if (e && (e.code === "ENOTCONN" || e.code === "EBADF")) forgetSsh(desc2.machineId);
    throw e;
  }
}
async function withWorkspace(ctx, desc2, fn) {
  try {
    return await fn();
  } catch (e) {
    if (desc2.location === "ssh" && e && (e.code === "ENOTCONN" || e.code === "ESTALE" || e.code === "EBADF")) {
      forgetSsh(desc2.machineId);
      return await fn();
    }
    throw e;
  }
}
function errMsg(e) {
  return e && (e.message || String(e)) || "unknown error";
}
function langFromPath(p) {
  const name = p.split("/").pop() || "";
  const lower = name.toLowerCase();
  if (lower === "makefile") return "make";
  if (lower === "dockerfile") return "bash";
  if (lower === "cmakelists.txt") return "cmake";
  const ext = lower.includes(".") ? lower.split(".").pop() : "";
  const map = {
    ts: "typescript",
    mts: "typescript",
    cts: "typescript",
    tsx: "tsx",
    js: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    jsx: "javascript",
    rs: "rust",
    py: "python",
    rb: "ruby",
    go: "go",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    c: "c",
    h: "c",
    cc: "cpp",
    cpp: "cpp",
    hpp: "cpp",
    cs: "csharp",
    php: "php",
    json: "json",
    toml: "toml",
    yaml: "yaml",
    yml: "yaml",
    md: "markdown",
    html: "html",
    htm: "html",
    css: "css",
    scss: "css",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    sql: "sql",
    lua: "lua",
    zig: "zig",
    ex: "elixir",
    exs: "elixir",
    proto: "proto",
    graphql: "graphql",
    scala: "scala",
    svelte: "svelte"
  };
  return map[ext] || "text";
}

// modules/services/files/src/presentation.ts
var FilePresentations = class {
  constructor(ctx) {
    this.ctx = ctx;
    this.rules = [];
    this.cache = /* @__PURE__ */ new Map();
    this.stops = [];
    this.revision = 0;
    this.stopped = false;
    this.providerStops = [];
  }
  async activate() {
    this.stops.push(this.ctx.events.on("kernel.modules.changed", () => {
      void this.load();
    }));
    this.stops.push(this.ctx.events.on("files.changed", () => this.clear()));
    await this.load();
  }
  dispose() {
    this.stopped = true;
    this.revision++;
    for (const stop of [...this.stops, ...this.providerStops]) if (typeof stop === "function") stop();
  }
  clear() {
    this.cache.clear();
    this.ctx.events.emit("files.presentationChanged", {});
  }
  async load() {
    const revision = ++this.revision;
    try {
      const { plugins } = await this.ctx.host.plugins.list();
      if (revision !== this.revision || this.stopped) return;
      for (const stop of this.providerStops) if (typeof stop === "function") stop();
      this.providerStops = plugins.filter((p) => p.enabled && p.active).map((p) => this.ctx.state.watch(`${p.id}.filePresentation`, () => {
        void this.load();
      }));
      this.rules = filePresentationRules(plugins, (key) => this.ctx.state.get(key));
      this.ctx.state.set("files.presentationRuleCount", this.rules.length);
      this.clear();
    } catch {
    }
  }
  async get(workspace, requested) {
    const entries = requested.slice(0, 64).map((entry) => ({ path: relativeFile(String(entry.path)), kind: entry.kind === "dir" ? "dir" : "file" }));
    const result = {};
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(4, entries.length) }, async () => {
      while (cursor < entries.length) {
        const entry = entries[cursor++], key = `${workspace.id}|${entry.kind}|${entry.path}`;
        let pending = this.cache.get(key);
        if (!pending) {
          const rules = this.rules;
          pending = (async () => {
            if (!matchingFileRules(rules, entry).some(({ rule }) => rule.contentPattern)) return presentFile(rules, entry);
            try {
              return await withWorkspace(this.ctx, workspace, async () => {
                const grant = await workspaceGrant(this.ctx, workspace, "fs");
                const read = await this.ctx.host.fs.read(grant.grant, entry.path, 32768);
                return presentFile(rules, entry, read.binary ? void 0 : read.text);
              });
            } catch {
              return presentFile(rules, entry);
            }
          })();
          this.cache.set(key, pending);
          if (this.cache.size > 6e3) this.cache.delete(this.cache.keys().next().value);
        }
        result[entry.path] = await pending;
      }
    }));
    return result;
  }
};

// ../sdk/file-watch.ts
function fileWatch(ctx, changed, options = {}) {
  let generation = 0, stopped = false;
  let close = null;
  let retry = null;
  let delay = 1e3;
  async function select(ws, root, selection2 = {}) {
    const mine = ++generation;
    if (retry) clearTimeout(retry);
    retry = null;
    const previous = close;
    close = null;
    await previous?.();
    if (!ws || stopped || mine !== generation) return;
    let handle = null, subscription = null;
    const dispose = async () => {
      await subscription?.close().catch(() => {
      });
      if (handle) await ctx.host.resources.release(handle).catch(() => {
      });
    };
    const failed = (error) => {
      if (mine !== generation || stopped) return;
      ctx.log.warn(`File watcher: ${errMsg(error)}`);
      retry = setTimeout(() => {
        void select(ws, root, selection2);
      }, delay);
      delay = Math.min(delay * 2, 3e4);
    };
    try {
      const grant = await workspaceGrant(ctx, ws, "fs", root);
      if (mine !== generation || stopped) return;
      ({ handle } = await ctx.host.fs.watch(grant.grant, ".", selection2.exclude?.length ? { exclude: selection2.exclude } : void 0));
      if (mine !== generation || stopped) {
        await dispose();
        return;
      }
      close = dispose;
      subscription = await ctx.host.streams.listen(handle, { channel: "stdout" }, (chunk) => {
        if (mine !== generation || stopped) return;
        delay = 1e3;
        const lines = String(chunk ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
        for (const l of lines) if (l.startsWith("warning ")) options.warning?.(ws.id, l.slice(8));
        if (!lines.length || lines.some((l) => !l.startsWith("warning "))) changed(ws.id);
      }, (error) => failed(error || new Error("notification stream closed")));
      if (mine !== generation || stopped) await dispose();
    } catch (error) {
      await dispose();
      failed(error);
    }
  }
  return {
    select,
    async stop() {
      stopped = true;
      generation++;
      if (retry) clearTimeout(retry);
      retry = null;
      const previous = close;
      close = null;
      await previous?.();
    }
  };
}

// modules/services/files/src/gitignore.ts
async function run(ctx, d, executable, args, stdin, limitBytes = 4 << 20, timeoutMs = 3e4) {
  return withWorkspace(ctx, d, async () => {
    const g = await workspaceGrant(ctx, d, "process");
    return ctx.host.process.run(
      g.grant,
      { target: await targetFor(ctx, d), executable, args, cwd: d.rootAbsolutePath, loginShell: d.location === "ssh" },
      { timeoutMs, limitBytes, ...stdin !== void 0 ? { stdin } : {} }
    );
  });
}
var git = (ctx, d, args, stdin, limit, timeout) => run(ctx, d, "git", ["--no-optional-locks", "-c", "core.quotepath=false", ...args], stdin, limit, timeout);
async function ignoredAmong(ctx, d, entries) {
  const out = new Set(entries.filter((e) => e.relativePath === ".git" || e.relativePath.endsWith("/.git")).map((e) => e.relativePath));
  const ask = entries.filter((e) => !out.has(e.relativePath));
  if (!ask.length) return out;
  const byQuery = new Map(ask.map((e) => [e.kind === "dir" ? e.relativePath + "/" : e.relativePath, e.relativePath]));
  const r = await git(ctx, d, ["check-ignore", "-z", "--stdin"], [...byQuery.keys()].join("\0") + "\0").catch(() => null);
  if (!r || r.code !== 0 && r.code !== 1) return out;
  for (const p of r.stdout.split("\0")) {
    const rel = byQuery.get(p);
    if (rel) out.add(rel);
  }
  return out;
}
var ignoredCache = /* @__PURE__ */ new Map();
var invalidateIgnored = (d) => ignoredCache.delete(`${d.id}|${d.rootAbsolutePath}`);
function ignoredSet(ctx, d) {
  const key = `${d.id}|${d.rootAbsolutePath}`;
  const hit = ignoredCache.get(key);
  if (hit && Date.now() - hit.time < 3e4) return hit.pending;
  const pending = (async () => {
    const r = await git(ctx, d, ["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"], void 0, 8 << 20).catch(() => null);
    if (!r || r.code !== 0) return null;
    const dirs = [], files = /* @__PURE__ */ new Set();
    for (const p of r.stdout.split("\0")) if (p) p.endsWith("/") ? dirs.push(p) : files.add(p);
    return { dirs, files };
  })();
  ignoredCache.set(key, { time: Date.now(), pending });
  pending.catch(() => ignoredCache.delete(key));
  return pending;
}
function isIgnored(set, path) {
  if (path === ".git" || path.startsWith(".git/") || path.includes("/.git/") || path.endsWith("/.git")) return true;
  if (!set) return false;
  return set.files.has(path) || set.dirs.some((dir) => path === dir.slice(0, -1) || path.startsWith(dir));
}
async function grepFiles(ctx, d, query, includeIgnored, maxMatches = 500) {
  const limit = 3 << 20;
  let r = await git(ctx, d, ["grep", "-z", "-n", "-I", "-i", "-F", "--no-color", "--untracked", ...includeIgnored ? ["--no-exclude-standard"] : [], "-e", query], void 0, limit, 6e4).catch(() => null);
  let viaGit = true;
  if (!r || r.code === 128 || r.code !== 0 && r.code !== 1) {
    viaGit = false;
    r = await run(ctx, d, "grep", ["-r", "-n", "-I", "-i", "-F", "--null", "--exclude-dir=.git", "-e", query, "--", "."], void 0, limit, 6e4);
    if (r.code !== 0 && r.code !== 1) throw new Error(`Search failed: ${(r.stderr || r.stdout).trim().slice(0, 300) || `exit ${r.code}`}`);
  }
  const files = /* @__PURE__ */ new Map();
  let count = 0, truncated = !!r.truncated;
  for (const raw of r.stdout.split("\n")) {
    if (!raw) continue;
    const a = raw.indexOf("\0");
    if (a < 0) continue;
    let path = raw.slice(0, a), rest = raw.slice(a + 1), line, text;
    const b = viaGit ? rest.indexOf("\0") : rest.indexOf(":");
    if (b < 0) continue;
    line = Number(rest.slice(0, b));
    text = rest.slice(b + 1);
    if (!Number.isFinite(line)) continue;
    if (path.startsWith("./")) path = path.slice(2);
    if (count >= maxMatches) {
      truncated = true;
      break;
    }
    let f = files.get(path);
    if (!f) {
      f = { relativePath: path, matches: [] };
      files.set(path, f);
    }
    f.matches.push({ line, text: text.trim().slice(0, 240) });
    count++;
  }
  return { files: [...files.values()], matchCount: count, fileCount: files.size, truncated, engine: viaGit ? "git grep" : "grep" };
}

// modules/services/files/src/search.ts
var indexes = /* @__PURE__ */ new Map();
var rootKey = (desc2) => `${desc2.id}|${desc2.machineId}|${desc2.rootAbsolutePath}|`;
function invalidateSearch(desc2) {
  for (const [key, index] of indexes) if (key.startsWith(rootKey(desc2))) index.dirty = true;
}
function stopSearchIndexes() {
  for (const index of indexes.values()) index.cancelled = true;
  indexes.clear();
}
function publish(ctx, desc2, index, force = false) {
  if (!index.cancelled && (force || Date.now() - index.notified >= 1e3)) {
    index.notified = Date.now();
    ctx.events.emit("files.indexed", { workspaceId: desc2.id, indexing: index.indexing });
  }
}
function add(index, entry) {
  if (index.byPath.has(entry.relativePath)) return;
  index.byPath.set(entry.relativePath, entry);
  index.entries.push(entry);
}
function addPath(index, path) {
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part === ".git")) return;
  let relativePath = "";
  for (let i = 0; i < parts.length; i++) {
    relativePath += (i ? "/" : "") + parts[i];
    add(index, { name: parts[i], kind: i === parts.length - 1 ? "file" : "dir", relativePath, size: 0 });
  }
}
async function gitIndex(ctx, desc2, index) {
  try {
    const grant = await workspaceGrant(ctx, desc2, "process");
    const target = await targetFor(ctx, desc2);
    const run2 = (args) => ctx.host.process.run(grant.grant, {
      target,
      executable: "git",
      args: ["--no-optional-locks", "ls-files", "-z", ...args],
      cwd: desc2.rootAbsolutePath,
      loginShell: desc2.location === "ssh"
    }, { timeoutMs: 3e4, limitBytes: 32 << 20 });
    const [files, deleted] = await Promise.all([run2(["--cached", "--others", "--exclude-standard", "--stage"]), run2(["--deleted"])]);
    if (index.cancelled) return true;
    if (files.code !== 0 || deleted.code !== 0 || files.truncated || deleted.truncated) return false;
    const missing = new Set(deleted.stdout.split("\0"));
    const paths = files.stdout.split("\0").filter(Boolean).map((record) => {
      const staged = /^(\d{6}) [a-f0-9]+ \d\t([\s\S]*)$/.exec(record);
      return { mode: staged?.[1], path: staged ? staged[2] : record };
    });
    if (paths.some((item) => item.mode === "160000")) return false;
    for (let i = 0; i < paths.length; i++) {
      if (index.cancelled) return true;
      if (!missing.has(paths[i].path)) addPath(index, paths[i].path);
      if (i % 4096 === 4095) {
        publish(ctx, desc2, index);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    return true;
  } catch {
    return false;
  }
}
async function scan(ctx, desc2, index, hideIgnored) {
  await withWorkspace(ctx, desc2, async () => {
    if (hideIgnored && await gitIndex(ctx, desc2, index)) return;
    const ignored = hideIgnored ? await ignoredSet(ctx, desc2) : null;
    const grant = await workspaceGrant(ctx, desc2, "fs");
    const queue = ["."], deferred = [];
    let cursor = 0;
    while (!index.cancelled && (cursor < queue.length || deferred.length)) {
      if (cursor === queue.length) queue.push(...deferred.splice(0, 4));
      const dirs = queue.slice(cursor, cursor + 4);
      cursor += dirs.length;
      const batches = await Promise.all(dirs.map(async (dir) => {
        try {
          return { dir, entries: (await ctx.host.fs.list(grant.grant, dir)).entries };
        } catch (error) {
          if (dir === "." || ["ENOTCONN", "ESTALE", "EBADF"].includes(error?.code)) throw error;
          index.skipped++;
          return { dir, entries: [] };
        }
      }));
      if (index.cancelled) return;
      for (const batch of batches) for (const entry of batch.entries) {
        if (entry.name === ".DS_Store" || entry.name === ".git") continue;
        const relativePath = batch.dir === "." ? entry.name : `${batch.dir}/${entry.name}`;
        if (hideIgnored && isIgnored(ignored, relativePath)) continue;
        add(index, { name: entry.name, kind: entry.kind, size: entry.size, relativePath });
        if (entry.kind === "dir" && !entry.symlink) {
          (["node_modules", "vendor", "target", ".cache"].includes(entry.name) ? deferred : queue).push(relativePath);
        }
      }
      publish(ctx, desc2, index);
    }
  });
}
function start(ctx, desc2, hideIgnored, key) {
  const previous = indexes.get(key);
  const index = { previous: previous?.previous || previous?.byPath, entries: [], byPath: /* @__PURE__ */ new Map(), pending: Promise.resolve(), indexing: true, cancelled: false, dirty: false, skipped: 0, notified: Date.now() };
  indexes.set(key, index);
  index.pending = scan(ctx, desc2, index, hideIgnored).catch((error) => {
    index.error = error;
  }).finally(() => {
    index.indexing = false;
    if (!index.error) index.previous = void 0;
    publish(ctx, desc2, index, true);
  });
  return index;
}
async function searchFiles(ctx, desc2, query, refresh = false, hideIgnored = false) {
  const key = rootKey(desc2) + (hideIgnored ? "visible" : "all");
  let index = indexes.get(key);
  if (refresh && index) index.dirty = true;
  if (!index || index.dirty && !index.indexing) index = start(ctx, desc2, hideIgnored, key);
  indexes.delete(key);
  indexes.set(key, index);
  while (indexes.size > 6) {
    const oldest = indexes.keys().next().value;
    indexes.get(oldest).cancelled = true;
    indexes.delete(oldest);
  }
  let timer;
  await Promise.race([index.pending, new Promise((resolve) => {
    timer = setTimeout(resolve, 100);
  })]);
  if (timer) clearTimeout(timer);
  if (index.error && !index.entries.length && !index.previous?.size) throw index.error;
  const entries = index.previous ? new Map([...index.previous, ...index.byPath]) : index.byPath;
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  let matchCount = 0;
  const visible = /* @__PURE__ */ new Map();
  for (const entry of entries.values()) {
    if (!words.every((word) => entry.relativePath.toLowerCase().includes(word))) continue;
    if (++matchCount > 1e3) continue;
    visible.set(entry.relativePath, entry);
    let parent = entry.relativePath;
    while (parent.includes("/")) {
      parent = parent.slice(0, parent.lastIndexOf("/"));
      const ancestor = entries.get(parent);
      if (ancestor) visible.set(parent, ancestor);
    }
  }
  return {
    entries: [...visible.values()],
    matchCount,
    indexedCount: index.entries.length,
    indexing: index.indexing || index.dirty,
    partial: index.indexing || index.dirty || !!index.error || index.skipped > 0 || matchCount > 1e3,
    skipped: index.skipped
  };
}

// modules/services/files/src/skills.ts
function metadata(text, key) {
  const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1];
  if (!header) return "";
  const lines = header.split(/\r?\n/);
  const index = lines.findIndex((line) => line.startsWith(key + ":"));
  if (index < 0) return "";
  const value = lines[index].slice(key.length + 1).trim();
  if (/^[>|][-+]?\s*$/.test(value)) {
    const continuation = [];
    for (const line of lines.slice(index + 1)) {
      if (line && !/^\s/.test(line)) break;
      continuation.push(line.trim());
    }
    return continuation.join(" ").trim();
  }
  return value.replace(/^(["'])([\s\S]*)\1$/, "$2");
}
async function workspaceSkills(ctx, desc2) {
  return withWorkspace(ctx, desc2, async () => {
    const grant = await workspaceGrant(ctx, desc2, "fs");
    let entries;
    try {
      entries = (await ctx.host.fs.list(grant.grant, ".agents/skills")).entries;
    } catch (e) {
      if (["ENOENT", "ENOTDIR"].includes(e?.code)) return [];
      throw e;
    }
    const skills = [];
    for (const entry of entries.filter((e) => ["dir", "symlink"].includes(e.kind)).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = `.agents/skills/${entry.name}/SKILL.md`;
      try {
        const file = await ctx.host.fs.read(grant.grant, path, 64 * 1024);
        if (file.binary || !file.text || file.truncated) continue;
        skills.push({ name: metadata(file.text, "name") || entry.name, description: metadata(file.text, "description"), path });
      } catch (e) {
        if (!["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(e?.code)) throw e;
      }
    }
    return skills;
  });
}

// ../sdk/settings-order.ts
var SPACER_PREFIX = "@spacer:";
function parseOrder(value, allowed, allowSpacers = false) {
  if (typeof value !== "string") throw new Error("Invalid item order");
  const items = JSON.parse(value);
  if (!Array.isArray(items) || items.length > allowed.length + 24) throw new Error("Invalid item order");
  const seen = /* @__PURE__ */ new Set();
  let gaps = 0;
  for (const item of items) {
    if (typeof item !== "string" || seen.has(item)) throw new Error("Duplicate or invalid item");
    seen.add(item);
    if (!allowed.includes(item) && !(allowSpacers && item.startsWith(SPACER_PREFIX) && /^@spacer:[a-zA-Z0-9_-]{1,80}$/.test(item) && ++gaps <= 24)) throw new Error("Unknown item");
  }
  if (!allowed.every((id) => seen.has(id))) throw new Error("Order must retain all current items");
  return items;
}

// ../sdk/ui-controls.ts
var HEX = /^#[0-9a-fA-F]{6}$/;
function validControlValue(field, value) {
  if (typeof value !== "string") return false;
  if (value === "") return !!field.allowDefault;
  if (field.type === "color") return HEX.test(value);
  const n = Number(value);
  return Number.isFinite(n) && n >= field.min && n <= field.max;
}

// ../sdk/settings.ts
function exportSettings(ctx, getSections, onChange, options = {}) {
  const publish2 = (error = null) => {
    const value = { sections: getSections(), error, ...options.reset ? { resetLabel: options.reset.label } : {} };
    ctx.state.set(`${ctx.moduleId}.settings`, value);
  };
  let queue = Promise.resolve();
  ctx.events.on("settings.change", (edit) => {
    if (edit?.module !== ctx.moduleId) return;
    queue = queue.then(async () => {
      try {
        const section = getSections().find((s) => s.key === edit.section);
        const field = section?.fields.find((f) => f.key === edit.key);
        if (!field || field.type === "action") throw new Error("Setting is no longer available");
        if (field.type === "order") parseOrder(edit.value, field.items.map((i) => i.id), field.allowSpacers);
        else if (field.type === "color" || field.type === "range") {
          if (!validControlValue(field, edit.value)) throw new Error(field.type === "color" ? "Enter a color as #RRGGBB" : `Choose a value from ${field.min} to ${field.max}`);
        } else if (field.type === "toggle" ? typeof edit.value !== "boolean" : typeof edit.value !== "string" || field.type === "select" && !field.options.some((o) => o.value === edit.value)) {
          throw new Error("Invalid setting value");
        }
        await onChange(section.key, field.key, edit.value);
        publish2();
      } catch (e) {
        publish2(e instanceof Error ? e.message : String(e));
      }
      if (options.invalidate !== false) ctx.ui.invalidate();
    });
  });
  if (options.action) ctx.events.on("settings.action", (event) => {
    if (event?.module !== ctx.moduleId) return;
    const run2 = async () => {
      try {
        const section = getSections().find((s) => s.key === event.section);
        const field = section?.fields.find((f) => f.key === event.key);
        if (!field || field.type !== "action" || field.disabled) throw new Error("Action is not available");
        await options.action(section.key, field.key);
        publish2();
      } catch (error) {
        publish2(error instanceof Error ? error.message : String(error));
      }
      if (options.invalidate !== false) ctx.ui.invalidate();
    };
    void run2();
  });
  if (options.reset) ctx.events.on("settings.reset", (event) => {
    if (event?.module !== ctx.moduleId || !options.reset) return;
    queue = queue.then(async () => {
      try {
        await options.reset.run();
        publish2();
      } catch (e) {
        publish2(e instanceof Error ? e.message : String(e));
      }
      if (options.invalidate !== false) ctx.ui.invalidate();
    });
  });
  publish2();
  return publish2;
}

// modules/services/files/src/watch-excludes.ts
var DEFAULT_EXCLUDES = [
  ".git",
  "node_modules",
  "__pycache__",
  ".venv",
  ".gradle",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  ".tox",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".terraform",
  ".dart_tool"
];
var MAX_EXCLUDES = 1500;
function valid(p) {
  return !!p && p.length <= 512 && !p.startsWith("-") && !p.startsWith("!") && !/[\u0000-\u001f]/.test(p) && !p.split("/").includes("..");
}
function parseExtra(text) {
  return text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean).map((s) => s.startsWith("/") && !s.slice(1).includes("/") ? s.slice(1) + "/" : s.replace(/^\/+/, "")).filter(valid);
}
async function watchExcludes(ctx, d, prefs2) {
  const out = /* @__PURE__ */ new Set();
  if (prefs2.defaults) DEFAULT_EXCLUDES.forEach((n) => out.add(n));
  for (const p of parseExtra(prefs2.extra)) out.add(p);
  if (prefs2.gitignored) {
    const ignored = await ignoredSet(ctx, d).catch(() => null);
    for (const dir of ignored?.dirs || []) {
      if (out.size >= MAX_EXCLUDES) break;
      if (valid(dir)) out.add(dir.endsWith("/") ? dir : dir + "/");
    }
  }
  return [...out];
}
async function loadPreferences(ctx) {
  const saved = await ctx.modules.call("persistence", "settings.get", { key: "files.watch" }).catch(() => null);
  return {
    defaults: typeof saved?.defaults === "boolean" ? saved.defaults : true,
    gitignored: typeof saved?.gitignored === "boolean" ? saved.gitignored : true,
    extra: typeof saved?.extra === "string" ? saved.extra : ""
  };
}

// modules/services/files/src/index.ts
var MAX_VIEW_BYTES = 2 * 1024 * 1024;
var docCache = /* @__PURE__ */ new Map();
async function desc(ctx, workspaceId) {
  return ctx.modules.call("workspace", "resolve", { workspaceId });
}
function cleanRel(rel) {
  const r = typeof rel === "string" && rel.length ? rel : ".";
  if (r.startsWith("/")) throw new Error("paths must be workspace-relative");
  const parts = [];
  for (const p of r.split("/")) {
    if (p === "" || p === ".") continue;
    if (p === "..") {
      if (!parts.length) throw new Error("path escapes the workspace root");
      parts.pop();
      continue;
    }
    parts.push(p);
  }
  return parts.length ? parts.join("/") : ".";
}
var writeGrants = /* @__PURE__ */ new Map();
function writeGrant(ctx, d) {
  const key = `${d.machineId}|${d.rootAbsolutePath}`;
  let p = writeGrants.get(key);
  if (!p) {
    p = (async () => ctx.host.capabilities.request({ kind: "fs", root: d.rootAbsolutePath, target: await targetFor(ctx, d), write: true, purpose: "Save files edited in the source editor." }))();
    writeGrants.set(key, p);
    p.catch(() => writeGrants.delete(key));
  }
  return p;
}
var watcher = null;
var changeTimer = null;
var selected = null;
var selection = 0;
var prefs = { defaults: true, gitignored: true, extra: "" };
var watching = null;
var RECHECK_MS = 15e3;
var recheckTimer = null;
async function startWatcher(ctx, d, force = false) {
  if (!d) {
    watching = null;
    await watcher?.select(null);
    return;
  }
  const key = `${d.id}|${d.machineId}|${d.rootAbsolutePath}`;
  const exclude = await watchExcludes(ctx, d, prefs).catch((e) => {
    ctx.log.warn(`Watch exclusions: ${errMsg(e)}`);
    return [];
  });
  if (selected?.id !== d.id) return;
  const same = watching?.key === key && watching.exclude.length === exclude.length && watching.exclude.every((x, i) => x === exclude[i]);
  if (same && !force) {
    watching.at = Date.now();
    return;
  }
  watching = { key, exclude, at: Date.now() };
  ctx.state.set("files.watch", { workspaceId: d.id, warning: null, excluded: exclude.length });
  await watcher?.select(d, void 0, { exclude });
}
function recheckExclusions(ctx) {
  if (!prefs.gitignored || recheckTimer || !selected) return;
  const wait = Math.max(0, RECHECK_MS - (Date.now() - (watching?.at ?? 0)));
  recheckTimer = setTimeout(() => {
    recheckTimer = null;
    void startWatcher(ctx, selected).catch((e) => ctx.log.warn(`File watcher: ${errMsg(e)}`));
  }, wait);
}
async function watchSelected(ctx) {
  const mine = ++selection;
  const ws = ctx.state.get("workspace.selected");
  try {
    const next = ws?.id ? await desc(ctx, ws.id) : null;
    if (mine !== selection) return;
    if (selected?.id === next?.id && selected?.machineId === next?.machineId && selected?.rootAbsolutePath === next?.rootAbsolutePath) return;
    selected = next;
    await startWatcher(ctx, next);
    if (next) {
      invalidateSearch(next);
      invalidateIgnored(next);
      void searchFiles(ctx, next, "", false, true).catch((e) => ctx.log.warn(`File index: ${errMsg(e)}`));
    }
  } catch (e) {
    ctx.log.warn(`File watcher: ${errMsg(e)}`);
  }
}
var skillsVersion = 0;
async function publishSkills(ctx) {
  const version = ++skillsVersion;
  const workspace = ctx.state.get("workspace.selected");
  const workspaceId = workspace?.id || null;
  ctx.state.set("files.skills", { workspaceId, skills: [], loading: !!workspaceId, error: null });
  if (!workspaceId) return;
  try {
    const skills = await workspaceSkills(ctx, await desc(ctx, workspaceId));
    if (version === skillsVersion) ctx.state.set("files.skills", { workspaceId, skills, loading: false, error: null });
  } catch (e) {
    if (version === skillsVersion) ctx.state.set("files.skills", { workspaceId, skills: [], loading: false, error: errMsg(e) });
  }
}
var presentations = null;
var mod = {
  id: "files",
  moduleApiVersion: 1,
  async activate(ctx) {
    presentations = new FilePresentations(ctx);
    await presentations.activate();
    ctx.events.on("git.changed", (event) => {
      if (!event.worktreeChanged || event.workspaceId !== selected?.id || !selected) return;
      invalidateSearch(selected);
      invalidateIgnored(selected);
      docCache.clear();
      ctx.events.emit("files.changed", { workspaceId: selected.id });
      void publishSkills(ctx);
    });
    prefs = await loadPreferences(ctx);
    exportSettings(ctx, () => [{ key: "files-watch", title: "File watching", fields: [
      {
        key: "defaults",
        label: "Skip dependency and cache folders",
        type: "toggle",
        value: prefs.defaults,
        description: `Changes inside ${DEFAULT_EXCLUDES.filter((n) => n !== ".git").slice(0, 5).join(", ")} and similar folders do not refresh the explorer or Git status.`
      },
      {
        key: "gitignored",
        label: "Skip folders Git ignores",
        type: "toggle",
        value: prefs.gitignored,
        description: "Build output and other ignored folders (from .gitignore) are not watched. Use Refresh to see new files there."
      },
      {
        key: "extra",
        label: "Also skip",
        type: "text",
        value: prefs.extra,
        placeholder: "out, generated, /tmp",
        description: "Folder names (any depth, * and ? allowed) or paths from the project root with /, separated by commas."
      }
    ] }], async (_section, key, value) => {
      if (key === "extra" ? typeof value !== "string" : !["defaults", "gitignored"].includes(key) || typeof value !== "boolean") throw new Error("Invalid file watching setting");
      const next = { ...prefs, [key]: value };
      await ctx.modules.call("persistence", "settings.set", { key: "files.watch", value: next });
      prefs = next;
      if (selected) {
        invalidateIgnored(selected);
        await startWatcher(ctx, selected, true);
      }
    });
    watcher = fileWatch(ctx, (workspaceId) => {
      if (changeTimer) clearTimeout(changeTimer);
      changeTimer = setTimeout(() => {
        if (selected?.id !== workspaceId) return;
        invalidateSearch(selected);
        invalidateIgnored(selected);
        docCache.clear();
        ctx.events.emit("files.changed", { workspaceId });
        void publishSkills(ctx);
        recheckExclusions(ctx);
      }, 200);
    }, {
      warning: (workspaceId, text) => {
        ctx.log.warn(`File watcher: ${text}`);
        if (selected?.id === workspaceId) ctx.state.set("files.watch", { workspaceId, warning: text, excluded: watching?.exclude.length ?? 0 });
      }
    });
    let skillsFor = ctx.state.get("workspace.selected")?.id || null;
    ctx.state.watch("workspace.selected", (ws) => {
      const id = ws?.id || null;
      if (id !== skillsFor) {
        skillsFor = id;
        void publishSkills(ctx);
      }
      void watchSelected(ctx);
    });
    await watchSelected(ctx);
    ctx.events.on("ai.skillsRequested", () => {
      void publishSkills(ctx);
    });
    await publishSkills(ctx);
  },
  async deactivate() {
    presentations?.dispose();
    presentations = null;
    selection++;
    skillsVersion++;
    stopSearchIndexes();
    if (changeTimer) clearTimeout(changeTimer);
    if (recheckTimer) clearTimeout(recheckTimer);
    recheckTimer = null;
    watching = null;
    await watcher?.stop();
    watcher = null;
  },
  methods: {
    async presentations(ctx, a) {
      const workspace = await desc(ctx, a.workspaceId);
      return presentations?.get(workspace, Array.isArray(a.entries) ? a.entries : []) || {};
    },
    async search(ctx, a) {
      const query = String(a.query || "").slice(0, 300).trim();
      if (!query && a.refresh) {
        const d2 = await desc(ctx, a.workspaceId);
        invalidateSearch(d2);
        invalidateIgnored(d2);
        await searchFiles(ctx, d2, "", false, a.hideIgnored !== false);
      }
      if (!query) return { entries: [], matchCount: 0, indexedCount: 0, partial: false, skipped: 0 };
      const d = await desc(ctx, a.workspaceId);
      if (a.refresh) invalidateIgnored(d);
      return searchFiles(ctx, d, query, !!a.refresh, !!a.hideIgnored);
    },
    /** Literal, case-insensitive search of file contents (git grep; grep outside repositories). */
    async grep(ctx, a) {
      const query = String(a.query || "").slice(0, 300);
      if (query.trim().length < 2) return { files: [], matchCount: 0, fileCount: 0, truncated: false };
      const d = await desc(ctx, a.workspaceId);
      return grepFiles(ctx, d, query, !a.hideIgnored, Math.min(2e3, Math.max(1, Number(a.maxMatches) || 500)));
    },
    async list(ctx, a) {
      const d = await desc(ctx, a.workspaceId);
      const rel = cleanRel(a.relativeDir);
      return withWorkspace(ctx, d, async () => {
        const g = await workspaceGrant(ctx, d, "fs");
        const r = await ctx.host.fs.list(g.grant, rel);
        const hidden = /* @__PURE__ */ new Set([".git", ".DS_Store"]);
        let entries = r.entries.filter((e) => a.showHidden || !hidden.has(e.name)).sort((x, y) => (x.kind === "dir" ? 0 : 1) - (y.kind === "dir" ? 0 : 1) || x.name.localeCompare(y.name)).map((e) => ({ ...e, relativePath: rel === "." ? e.name : `${rel}/${e.name}` }));
        let hiddenIgnored = 0;
        if (a.hideIgnored && entries.length) {
          const ignored = await ignoredAmong(ctx, d, entries);
          hiddenIgnored = ignored.size;
          entries = entries.filter((e) => !ignored.has(e.relativePath));
        }
        return { workspaceId: d.id, machineId: d.machineId, root: d.rootAbsolutePath, relativeDir: rel, entries, hiddenIgnored };
      });
    },
    /** Read a file and open a native document handle (syntax highlighting is native). */
    async open(ctx, a) {
      const d = await desc(ctx, a.workspaceId);
      const rel = cleanRel(a.relativePath);
      return withWorkspace(ctx, d, async () => {
        const g = await workspaceGrant(ctx, d, "fs");
        const st = await ctx.host.fs.stat(g.grant, rel);
        if (st.kind === "dir") throw new Error(`${rel} is a directory`);
        const key = `${d.id}|${rel}`;
        const cached = docCache.get(key);
        if (cached && cached.mtime === st.mtime && cached.size === st.size && (!a.includeText || cached.text !== void 0)) {
          return { workspaceId: d.id, relativePath: rel, document: cached.document, language: langFromPath(rel), size: st.size, mtime: st.mtime, binary: false, truncated: cached.truncated, ...a.includeText ? { text: cached.text } : {}, cached: true };
        }
        const r = await ctx.host.fs.read(g.grant, rel, MAX_VIEW_BYTES);
        if (r.binary) {
          return { workspaceId: d.id, relativePath: rel, document: null, language: "binary", size: st.size, binary: true, truncated: r.truncated, message: `Binary file (${st.size} bytes) — not shown.` };
        }
        const language = langFromPath(rel);
        const text = r.truncated ? r.text + `

… truncated: file is larger than ${MAX_VIEW_BYTES} bytes` : r.text;
        const document = await ctx.host.ui.documentOpen(d.id, text, language, { path: rel });
        docCache.set(key, { document, mtime: st.mtime, size: st.size, ...a.includeText ? { text } : {}, truncated: r.truncated });
        return { workspaceId: d.id, relativePath: rel, document, language, size: st.size, mtime: st.mtime, binary: false, truncated: r.truncated, ...a.includeText ? { text } : {} };
      });
    },
    /** Write a text file atomically. When `expectedMtime` is given and the file changed on disk
     *  since then, fails with a conflict unless `force`. The first write under a workspace root
     *  asks for native approval of a write grant. */
    async save(ctx, a) {
      const d = await desc(ctx, a.workspaceId);
      const rel = cleanRel(a.relativePath);
      if (rel === ".") throw new Error("a file path is required");
      if (typeof a.text !== "string") throw new Error("text must be a string");
      return withWorkspace(ctx, d, async () => {
        if (a.expectedMtime != null && !a.force) {
          const g2 = await workspaceGrant(ctx, d, "fs");
          const st2 = await ctx.host.fs.stat(g2.grant, rel).catch(() => null);
          if (st2 && st2.mtime != null && st2.mtime !== a.expectedMtime) {
            const err = new Error(`${rel} changed on disk since it was opened`);
            err.code = "ECONFLICT";
            throw err;
          }
        }
        const key = `${d.machineId}|${d.rootAbsolutePath}`;
        const w = await writeGrant(ctx, d);
        try {
          await ctx.host.fs.writeAtomic(w.grant, rel, a.text, { reason: `Save ${rel}` });
        } catch (e) {
          if (e && ["ENOTCONN", "ESTALE", "EBADF"].includes(e.code)) writeGrants.delete(key);
          throw e;
        }
        docCache.delete(`${d.id}|${rel}`);
        const g = await workspaceGrant(ctx, d, "fs");
        const st = await ctx.host.fs.stat(g.grant, rel);
        return { workspaceId: d.id, relativePath: rel, size: st.size, mtime: st.mtime };
      });
    },
    async stat(ctx, a) {
      const d = await desc(ctx, a.workspaceId);
      const g = await workspaceGrant(ctx, d, "fs");
      try {
        return await ctx.host.fs.stat(g.grant, cleanRel(a.relativePath));
      } catch (e) {
        return { error: errMsg(e) };
      }
    }
  }
};
var index_default = mod;
export {
  index_default as default
};
