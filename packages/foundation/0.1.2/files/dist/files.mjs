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

// ../sdk/file-watch.ts
function fileWatch(ctx, changed) {
  let generation = 0, stopped = false;
  let close = null;
  let retry = null;
  let delay = 1e3;
  async function select(ws, root) {
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
        void select(ws, root);
      }, delay);
      delay = Math.min(delay * 2, 3e4);
    };
    try {
      const grant = await workspaceGrant(ctx, ws, "fs", root);
      if (mine !== generation || stopped) return;
      ({ handle } = await ctx.host.fs.watch(grant.grant, "."));
      if (mine !== generation || stopped) {
        await dispose();
        return;
      }
      close = dispose;
      subscription = await ctx.host.streams.listen(handle, { channel: "stdout" }, () => {
        if (mine !== generation || stopped) return;
        delay = 1e3;
        changed(ws.id);
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

// modules/services/files/src/search.ts
var indexes = /* @__PURE__ */ new Map();
function invalidateSearch(desc2) {
  indexes.delete(`${desc2.id}|${desc2.machineId}|${desc2.rootAbsolutePath}`);
}
async function scan(ctx, desc2) {
  return withWorkspace(ctx, desc2, async () => {
    const grant = await workspaceGrant(ctx, desc2, "fs");
    const entries = [];
    const queue = ["."];
    const started = Date.now();
    let visited = 0, skipped = 0;
    while (queue.length && entries.length < 5e4 && visited < 4e3 && Date.now() - started < 15e3) {
      const dirs = queue.splice(0, 4);
      visited += dirs.length;
      const batches = await Promise.all(dirs.map(async (dir) => {
        try {
          return { dir, entries: (await ctx.host.fs.list(grant.grant, dir)).entries };
        } catch (error) {
          if (dir === "." || ["ENOTCONN", "ESTALE", "EBADF"].includes(error?.code)) throw error;
          skipped++;
          return { dir, entries: [] };
        }
      }));
      for (const batch of batches) for (const entry of batch.entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name === ".DS_Store") continue;
        if (entries.length >= 5e4) {
          skipped++;
          break;
        }
        const relativePath = batch.dir === "." ? entry.name : `${batch.dir}/${entry.name}`;
        entries.push({ name: entry.name, kind: entry.kind, size: entry.size, relativePath });
        if (entry.kind === "dir" && entry.name !== ".git" && !entry.symlink) queue.push(relativePath);
      }
    }
    return { entries, complete: queue.length === 0 && skipped === 0, skipped };
  });
}
async function searchFiles(ctx, desc2, query, refresh = false) {
  const key = `${desc2.id}|${desc2.machineId}|${desc2.rootAbsolutePath}`;
  let index = indexes.get(key);
  if (refresh || !index || Date.now() - index.time > 3e4) {
    const pending = scan(ctx, desc2);
    index = { time: Date.now(), pending };
    indexes.set(key, index);
    pending.catch(() => {
      if (indexes.get(key)?.pending === pending) indexes.delete(key);
    });
  }
  const result = await index.pending;
  const words2 = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = result.entries.filter((entry) => words2.every((word) => entry.relativePath.toLowerCase().includes(word)));
  const byPath = new Map(result.entries.map((entry) => [entry.relativePath, entry]));
  const visible = /* @__PURE__ */ new Map();
  for (const entry of matches.slice(0, 1e3)) {
    visible.set(entry.relativePath, entry);
    let parent = entry.relativePath;
    while (parent.includes("/")) {
      parent = parent.slice(0, parent.lastIndexOf("/"));
      const ancestor = byPath.get(parent);
      if (ancestor) visible.set(parent, ancestor);
    }
  }
  return { entries: [...visible.values()], matchCount: matches.length, indexedCount: result.entries.length, partial: !result.complete || matches.length > 1e3, skipped: result.skipped };
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

// modules/services/files/src/index.ts
var words = (q) => q.toLowerCase().trim().split(/\s+/).filter(Boolean);
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
async function watchSelected(ctx) {
  const mine = ++selection;
  const ws = ctx.state.get("workspace.selected");
  try {
    const next = ws?.id ? await desc(ctx, ws.id) : null;
    if (mine !== selection) return;
    if (selected?.id === next?.id && selected?.rootAbsolutePath === next?.rootAbsolutePath) return;
    selected = next;
    await watcher?.select(next);
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
var mod = {
  id: "files",
  moduleApiVersion: 1,
  async activate(ctx) {
    ctx.events.on("git.changed", (event) => {
      if (!event.worktreeChanged || event.workspaceId !== selected?.id || !selected) return;
      invalidateSearch(selected);
      invalidateIgnored(selected);
      docCache.clear();
      ctx.events.emit("files.changed", { workspaceId: selected.id });
      void publishSkills(ctx);
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
      }, 200);
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
    selection++;
    skillsVersion++;
    if (changeTimer) clearTimeout(changeTimer);
    await watcher?.stop();
    watcher = null;
  },
  methods: {
    async search(ctx, a) {
      const query = String(a.query || "").slice(0, 300).trim();
      if (!query && a.refresh) invalidateSearch(await desc(ctx, a.workspaceId));
      if (!query) return { entries: [], matchCount: 0, indexedCount: 0, partial: false, skipped: 0 };
      const d = await desc(ctx, a.workspaceId);
      if (a.refresh) invalidateIgnored(d);
      const found = await searchFiles(ctx, d, query, !!a.refresh);
      if (!a.hideIgnored) return found;
      const ignored = await ignoredSet(ctx, d);
      const entries = found.entries.filter((e) => !isIgnored(ignored, e.relativePath));
      const w = words(query), hits = entries.filter((e) => w.every((x) => e.relativePath.toLowerCase().includes(x))).length;
      return { ...found, entries, matchCount: found.partial ? Math.max(hits, found.matchCount - (found.entries.length - entries.length)) : hits, hiddenIgnored: found.entries.length - entries.length };
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
        if (cached && cached.mtime === st.mtime && cached.size === st.size) {
          return { workspaceId: d.id, relativePath: rel, document: cached.document, language: langFromPath(rel), size: st.size, mtime: st.mtime, binary: false, truncated: false, cached: true };
        }
        const r = await ctx.host.fs.read(g.grant, rel, MAX_VIEW_BYTES);
        if (r.binary) {
          return { workspaceId: d.id, relativePath: rel, document: null, language: "binary", size: st.size, binary: true, truncated: r.truncated, message: `Binary file (${st.size} bytes) — not shown.` };
        }
        const language = langFromPath(rel);
        const text = r.truncated ? r.text + `

… truncated: file is larger than ${MAX_VIEW_BYTES} bytes` : r.text;
        const document = await ctx.host.ui.documentOpen(d.id, text, language, { path: rel });
        docCache.set(key, { document, mtime: st.mtime, size: st.size });
        return { workspaceId: d.id, relativePath: rel, document, language, size: st.size, mtime: st.mtime, binary: false, truncated: r.truncated };
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
