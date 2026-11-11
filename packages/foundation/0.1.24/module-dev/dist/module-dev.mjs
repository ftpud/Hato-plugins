// ../sdk/runtime.ts
function errMsg(e) {
  return e && (e.message || String(e)) || "unknown error";
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
function hasher() {
  const buf = new Uint8Array(64);
  const view = new DataView(buf.buffer);
  let used = 0;
  let length = 0;
  const H = new Uint32Array([1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225]);
  const W = new Uint32Array(64);
  const compress = () => {
    for (let i = 0; i < 16; i++) W[i] = view.getUint32(i * 4);
    for (let i = 16; i < 64; i++) {
      const a2 = W[i - 15], b2 = W[i - 2];
      const s0 = (a2 >>> 7 | a2 << 25) ^ (a2 >>> 18 | a2 << 14) ^ a2 >>> 3;
      const s1 = (b2 >>> 17 | b2 << 15) ^ (b2 >>> 19 | b2 << 13) ^ b2 >>> 10;
      W[i] = W[i - 16] + s0 + W[i - 7] + s1 >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = (e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7);
      const ch = e & f ^ ~e & g;
      const t1 = h + S1 + ch + K[i] + W[i] >>> 0;
      const S0 = (a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10);
      const mj = a & b ^ a & c ^ b & c;
      const t2 = S0 + mj >>> 0;
      h = g;
      g = f;
      f = e;
      e = d + t1 >>> 0;
      d = c;
      c = b;
      b = a;
      a = t1 + t2 >>> 0;
    }
    H[0] = H[0] + a >>> 0;
    H[1] = H[1] + b >>> 0;
    H[2] = H[2] + c >>> 0;
    H[3] = H[3] + d >>> 0;
    H[4] = H[4] + e >>> 0;
    H[5] = H[5] + f >>> 0;
    H[6] = H[6] + g >>> 0;
    H[7] = H[7] + h >>> 0;
  };
  const byte = (b) => {
    buf[used++] = b;
    length++;
    if (used === 64) {
      compress();
      used = 0;
    }
  };
  const update = (text, from, to) => {
    let i = from;
    for (; i < to; i++) {
      let c = text.charCodeAt(i);
      if (c >= 55296 && c <= 56319) {
        const d = text.charCodeAt(i + 1);
        if (d >= 56320 && d <= 57343) {
          c = 65536 + (c - 55296 << 10) + d - 56320;
          i++;
        } else c = 65533;
      } else if (c >= 56320 && c <= 57343) c = 65533;
      if (c < 128) byte(c);
      else if (c < 2048) {
        byte(192 | c >> 6);
        byte(128 | c & 63);
      } else if (c < 65536) {
        byte(224 | c >> 12);
        byte(128 | c >> 6 & 63);
        byte(128 | c & 63);
      } else {
        byte(240 | c >> 18);
        byte(128 | c >> 12 & 63);
        byte(128 | c >> 6 & 63);
        byte(128 | c & 63);
      }
    }
    return i;
  };
  const finish = () => {
    const bits = length * 8;
    byte(128);
    while (used !== 56) byte(0);
    view.setUint32(56, Math.floor(bits / 4294967296));
    view.setUint32(60, bits >>> 0);
    compress();
    let out = "";
    for (let i = 0; i < 8; i++) out += H[i].toString(16).padStart(8, "0");
    return out;
  };
  return { update, finish };
}
async function sha256HexAsync(text, chunk = 256 * 1024) {
  const h = hasher();
  for (let i = 0; i < text.length; ) {
    i = h.update(text, i, Math.min(i + chunk, text.length));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return h.finish();
}

// modules/services/module-dev/src/index.ts
var BUILD_ARGS = ["--bundle", "--format=esm", "--platform=neutral", "--target=es2020", "--log-level=warning", "--charset=utf8", "--legal-comments=none", "--loader:.sql=text", "--loader:.md=text"];
var srcRead = null;
var srcWrite = null;
var shared = null;
var lastBuild = /* @__PURE__ */ new Map();
var grantRead = (ctx) => srcRead ?? (srcRead = ctx.host.capabilities.request({ kind: "source" }).then((g) => g.grant).catch((e) => {
  srcRead = null;
  throw e;
}));
var grantWrite = (ctx) => srcWrite ?? (srcWrite = ctx.host.capabilities.request({ kind: "source", write: true }).then((g) => g.grant).catch((e) => {
  srcWrite = null;
  throw e;
}));
var grantShared = (ctx) => shared ?? (shared = ctx.host.capabilities.request({ kind: "fs", root: ctx.host.env.info().sharedDir, write: true }).then((g) => g.grant).catch((e) => {
  shared = null;
  throw e;
}));
async function moduleDir(ctx, id) {
  if (!/^[a-z0-9][a-z0-9._-]{0,47}$/i.test(id)) throw new Error("Invalid module ID");
  const d = await ctx.host.modules.describe(id);
  const source = String(d.sourceDir || "").replace(/\\/g, "/").replace(/^modules\//, "");
  if (source === `services/${id}` || source === `ui/${id}`) return source;
  const kind = d.manifest?.kind === "service" ? "services" : d.manifest?.kind === "ui" ? "ui" : null;
  if (kind) {
    const dir = `${kind}/${id}`;
    try {
      await ctx.host.fs.stat(await grantRead(ctx), `${dir}/manifest.json`);
      return dir;
    } catch (e) {
      if (e?.code !== "ENOENT" && e?.code !== "ENOTDIR") throw e;
    }
  }
  throw Object.assign(new Error(`Editable source is not available for ${id}. Update this installed plugin through Settings → Plugins.`), { code: "ESOURCEUNAVAILABLE" });
}
async function resolveSourcePath(ctx, id, p) {
  const dir = await moduleDir(ctx, id);
  let rel = String(p || "").trim().replace(/^\.\//, "");
  if (rel.startsWith("a/") || rel.startsWith("b/")) rel = rel.slice(2);
  if (rel.startsWith("modules/")) rel = rel.slice("modules/".length);
  if (!rel.startsWith(dir + "/")) rel = `${dir}/${rel}`;
  const parts = [];
  for (const seg of rel.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  const norm = parts.join("/");
  if (!norm.startsWith(dir + "/")) {
    const e = new Error(`path ${p} is outside module '${id}' (allowed: modules/${dir}/)`);
    e.code = "EPERM";
    throw e;
  }
  return norm;
}
async function listTree(ctx, grant, dir, out, depth = 0) {
  if (depth > 6 || out.length > 500) return;
  const r = await ctx.host.fs.list(grant, dir);
  for (const e of r.entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const p = `${dir}/${e.name}`;
    if (e.kind === "dir") await listTree(ctx, grant, p, out, depth + 1);
    else out.push(p);
  }
}
function parseUnifiedDiff(patch) {
  const files = [];
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  let cur = null;
  let hunk = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith("--- ")) {
      const next = lines[i + 1] || "";
      if (next.startsWith("+++ ")) {
        const oldP = l.slice(4).split("	")[0].trim();
        const newP = next.slice(4).split("	")[0].trim();
        const strip = (x) => x.replace(/^[ab]\//, "");
        cur = { path: strip(newP === "/dev/null" ? oldP : newP), hunks: [], isNew: oldP === "/dev/null" };
        files.push(cur);
        hunk = null;
        i++;
        continue;
      }
    }
    const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(l);
    if (h) {
      if (!cur) throw new Error("hunk before file header");
      hunk = { oldStart: Number(h[1]), lines: [] };
      cur.hunks.push(hunk);
      continue;
    }
    if (hunk && (l.startsWith(" ") || l.startsWith("+") || l.startsWith("-"))) hunk.lines.push(l);
    else if (hunk && l === "") hunk.lines.push(" ");
    else if (l.startsWith("\\ No newline")) continue;
  }
  if (!files.length) throw new Error("no file headers (--- / +++) found in patch");
  return files;
}
function applyHunks(text, hunks) {
  const src = text.split("\n");
  let out = [];
  let pos = 0;
  for (const h of hunks) {
    while (h.lines.length && h.lines[h.lines.length - 1] === " ") h.lines.pop();
    const oldLines = h.lines.filter((l) => !l.startsWith("+")).map((l) => l.slice(1));
    const newLines = h.lines.filter((l) => !l.startsWith("-")).map((l) => l.slice(1));
    const want = Math.max(0, h.oldStart - 1);
    const matches = (at2) => oldLines.every((ol, k) => src[at2 + k] !== void 0 && src[at2 + k].trimEnd() === ol.trimEnd());
    let at = -1;
    for (let d = 0; d <= Math.max(src.length, 1); d++) {
      if (want - d >= pos && matches(want - d)) {
        at = want - d;
        break;
      }
      if (want + d <= src.length && matches(want + d)) {
        at = want + d;
        break;
      }
      if (want - d < pos && want + d > src.length) break;
    }
    if (at < 0) throw new Error(`hunk @@ -${h.oldStart} does not apply (context not found)`);
    out = out.concat(src.slice(pos, at), newLines);
    pos = at + oldLines.length;
  }
  return out.concat(src.slice(pos)).join("\n");
}
async function backup(ctx, rel, content) {
  try {
    const g = await grantShared(ctx);
    const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
    const path = `backups/${rel.replace(/\//g, "__")}.${stamp}.bak`;
    await ctx.host.fs.mkdir(g, "backups");
    await ctx.host.fs.writeAtomic(g, path, content);
    return path;
  } catch (e) {
    ctx.log.warn("backup failed", errMsg(e));
    return null;
  }
}
async function readSrc(ctx, rel) {
  try {
    const r = await ctx.host.fs.read(await grantRead(ctx), rel, 2 * 1024 * 1024);
    if (r.binary) throw new Error(`${rel} is binary`);
    return r.text;
  } catch (e) {
    if (e && e.code === "ENOENT") return null;
    throw e;
  }
}
async function compile(ctx, id) {
  const info = await ctx.host.modules.sourceInfo();
  if (!info.buildTool) return { ok: false, code: "", diagnostics: "", ms: 0, error: "esbuild is not installed in the repository (run `npm ci`)" };
  const d = await ctx.host.modules.describe(id);
  let dir;
  try {
    dir = await moduleDir(ctx, id);
  } catch (e) {
    return { ok: false, code: "", diagnostics: "", ms: 0, error: errMsg(e), unavailable: e?.code === "ESOURCEUNAVAILABLE" };
  }
  let manifest = d.manifest;
  const reported = String(d.sourceDir || "").replace(/\\/g, "/").replace(/^modules\//, "");
  if (reported !== dir) {
    const local = await ctx.host.fs.read(await grantRead(ctx), `${dir}/manifest.json`, 256 * 1024);
    manifest = JSON.parse(local.text || "{}");
    if (manifest.id !== id || manifest.kind !== d.manifest.kind) throw new Error("Editable manifest does not match the installed module");
  }
  const relative = String(manifest.entry || "").replace(/^\.\//, "");
  if (!relative || relative.startsWith("/") || relative.includes("\\") || relative.split("/").includes("..")) throw new Error("Module entry must be inside its source directory");
  const entry = `modules/${dir}/${relative}`;
  const g = await ctx.host.capabilities.request({ kind: "build" });
  const t0 = Date.now();
  try {
    const r = await ctx.host.process.run(g.grant, { executable: info.buildTool, args: [entry, ...BUILD_ARGS, `--alias:@hato/sdk=${info.sdkRoot || info.repoRoot + "/sdk"}`], cwd: info.repoRoot }, { timeoutMs: 12e4, limitBytes: 8 * 1024 * 1024 });
    const ok = r.code === 0 && !r.truncated && !!r.stdout.trim();
    return { ok, code: r.stdout, diagnostics: r.stderr.trim(), ms: Date.now() - t0, error: ok ? void 0 : r.truncated ? "Compiler output exceeded the 8 MB capture limit" : `build failed (exit ${r.code})` };
  } finally {
    await ctx.host.capabilities.release(g.grant).catch(() => {
    });
  }
}
async function build(ctx, id) {
  const c = await compile(ctx, id);
  const t0 = Date.now() - c.ms;
  const r = { stdout: c.code };
  const diagnostics = c.diagnostics;
  if (!c.ok) {
    const res = { ok: false, id, error: c.error, diagnostics, buildMs: c.ms };
    lastBuild.set(id, res);
    return res;
  }
  try {
    const staged = await ctx.host.modules.stageArtifact(id, r.stdout);
    const res = { ok: true, id, stageId: staged.stageId, version: staged.version, label: staged.label, sha256: staged.sha256, diagnostics, buildMs: Date.now() - t0 };
    lastBuild.set(id, res);
    return res;
  } catch (e) {
    const res = { ok: false, id, error: errMsg(e), code: e.code, diagnostics, buildMs: Date.now() - t0 };
    lastBuild.set(id, res);
    return res;
  }
}
var updates = /* @__PURE__ */ new Map();
var scanning = null;
async function fingerprint(ctx, id) {
  const g = await grantRead(ctx);
  const dir = await moduleDir(ctx, id);
  const files = [];
  await listTree(ctx, g, dir, files);
  const parts = [];
  for (const f of files) {
    try {
      const st = await ctx.host.fs.stat(g, f);
      parts.push(`${f}:${st.size}:${st.mtime}`);
    } catch {
      parts.push(`${f}:?`);
    }
  }
  return parts.join("|");
}
async function scan(ctx, full) {
  if (scanning) return scanning;
  scanning = (async () => {
    const mods = await ctx.host.modules.list();
    let changed = false;
    const known = new Set(mods.map((m) => m.id));
    for (const id of updates.keys()) if (!known.has(id)) {
      updates.delete(id);
      changed = true;
    }
    for (const m of mods) {
      const prev = updates.get(m.id);
      const activeHash = m.active ? m.active.sha256 : null;
      let fp = "";
      try {
        fp = await fingerprint(ctx, m.id);
      } catch {
        fp = "?";
      }
      if (!full && prev && prev.fingerprint === fp && prev.activeHash === activeHash) continue;
      const c = await compile(ctx, m.id).catch((e) => ({ unavailable: false, ok: false, code: "", diagnostics: "", ms: 0, error: errMsg(e) }));
      let builtHash = null;
      let hashError = "";
      if (c.ok) {
        try {
          builtHash = await sha256HexAsync(c.code);
        } catch (e) {
          hashError = `Cannot check compiled module: ${errMsg(e)}`;
        }
      }
      const status = c.unavailable ? "source-unavailable" : !c.ok || hashError ? "build-error" : !activeHash ? "update-available" : builtHash === activeHash ? "current" : "update-available";
      const info = { id: m.id, kind: m.kind, active: m.active ? m.active.label : null, status, builtHash, activeHash, diagnostics: hashError || (c.ok ? c.diagnostics : `${c.error || ""}
${c.diagnostics}`.trim()), fingerprint: fp, checkedAt: Date.now() };
      if (!prev || prev.status !== info.status || prev.builtHash !== info.builtHash || prev.active !== info.active) changed = true;
      updates.set(m.id, info);
    }
    if (changed) ctx.events.emit("module-dev.updatesChanged", summary());
    return Array.from(updates.values());
  })();
  try {
    return await scanning;
  } finally {
    scanning = null;
  }
}
function summary() {
  const list = Array.from(updates.values());
  return { available: list.filter((u) => u.status === "update-available").map((u) => u.id), errors: list.filter((u) => u.status === "build-error").map((u) => u.id) };
}
var mod = {
  id: "module-dev",
  moduleApiVersion: 1,
  async activate(ctx) {
    setTimeout(() => {
      scan(ctx, true).catch((e) => ctx.log.warn("update scan", errMsg(e)));
    }, 1500);
    setInterval(() => {
      scan(ctx, false).catch(() => {
      });
    }, 4e3);
  },
  methods: {
    /** Cached update status of every module. */
    updates: () => ({ modules: Array.from(updates.values()).map(({ fingerprint: fingerprint2, ...u }) => u), ...summary() }),
    /** Re-check now (`full` rebuilds every module; otherwise only those whose sources changed). */
    async scanUpdates(ctx, a) {
      const list = await scan(ctx, !!(a && a.full));
      return { modules: list.map(({ fingerprint: fingerprint2, ...u }) => u), ...summary() };
    },
    /** Build + activate every module with an available update (each step natively approved). */
    async activateUpdates(ctx) {
      await scan(ctx, false);
      const results = [];
      for (const id of summary().available) {
        results.push(await mod.methods.buildAndActivate(ctx, { id }, { caller: "module-dev" }));
      }
      return { ok: results.every((r) => r.ok), results };
    },
    list: (ctx) => ctx.host.modules.list(),
    describe: async (ctx, a) => {
      const d = await ctx.host.modules.describe(String(a.id));
      const env = ctx.host.env.info();
      const source = await ctx.host.modules.sourceInfo();
      return {
        ...d,
        runtime: {
          repoRoot: env.repoRoot,
          modulesRoot: source.modulesRoot,
          buildTool: source.buildTool,
          pluginsDir: `${env.dataDir}/plugins`,
          artifactsDir: `${env.dataDir}/artifacts`,
          dataDir: env.dataDir
        },
        lastBuild: lastBuild.get(String(a.id)) || null
      };
    },
    logs: (ctx, a) => ctx.host.modules.logs(String(a.id), Number(a.limit) || 100),
    /** Without `path`: list the module's source files. With `path`: return its text. */
    async readSource(ctx, a) {
      const id = String(a.id);
      const dir = await moduleDir(ctx, id);
      if (!a.path) {
        const files = [];
        await listTree(ctx, await grantRead(ctx), dir, files);
        return { id, root: `modules/${dir}`, files: files.map((f) => `modules/${f}`) };
      }
      const rel = await resolveSourcePath(ctx, id, a.path);
      const text = await readSrc(ctx, rel);
      if (text === null) throw new Error(`modules/${rel} not found`);
      return { id, path: `modules/${rel}`, text };
    },
    /**
     * Apply a change to allowlisted module sources. Accepts a unified diff (`patch`), exact
     * replacements (`edits: [{path, oldText, newText}]`) or a whole file (`path` + `content`).
     * Each file write is approved natively with a kernel-computed diff; a backup is kept.
     */
    async applyPatch(ctx, a) {
      const id = String(a.id);
      const changes = [];
      if (typeof a.patch === "string" && a.patch.trim()) {
        for (const fp of parseUnifiedDiff(a.patch)) {
          const rel = await resolveSourcePath(ctx, id, fp.path);
          const before = await readSrc(ctx, rel);
          if (before === null && !fp.isNew) throw new Error(`modules/${rel} does not exist`);
          changes.push({ rel, before, after: applyHunks(before ?? "", fp.hunks) });
        }
      } else if (Array.isArray(a.edits)) {
        const byFile = /* @__PURE__ */ new Map();
        for (const e of a.edits) {
          const rel = await resolveSourcePath(ctx, id, e.path);
          if (!byFile.has(rel)) byFile.set(rel, await readSrc(ctx, rel));
          const cur = byFile.get(rel);
          if (cur === null || cur === void 0) throw new Error(`modules/${rel} does not exist`);
          const n = cur.split(String(e.oldText)).length - 1;
          if (n !== 1) throw new Error(`oldText must occur exactly once in modules/${rel} (found ${n})`);
          byFile.set(rel, cur.replace(String(e.oldText), () => String(e.newText)));
        }
        for (const [rel, after] of byFile) changes.push({ rel, before: await readSrc(ctx, rel), after });
      } else if (typeof a.path === "string" && typeof a.content === "string") {
        const rel = await resolveSourcePath(ctx, id, a.path);
        changes.push({ rel, before: await readSrc(ctx, rel), after: a.content });
      } else {
        throw new Error("provide `patch` (unified diff), `edits`, or `path` + `content`");
      }
      const results = [];
      for (const c of changes) {
        if (c.before === c.after) {
          results.push({ path: `modules/${c.rel}`, changed: false });
          continue;
        }
        const bak = c.before !== null ? await backup(ctx, c.rel, c.before) : null;
        await ctx.host.fs.writeAtomic(await grantWrite(ctx), c.rel, c.after, { reason: a.reason ? String(a.reason).slice(0, 300) : void 0 });
        results.push({ path: `modules/${c.rel}`, changed: true, backup: bak });
      }
      ctx.events.emit("module-dev.sourceChanged", { id, files: results.map((r) => r.path) });
      return { ok: true, id, files: results };
    },
    build: (ctx, a) => build(ctx, String(a.id)),
    async activate(ctx, a) {
      const id = String(a.id);
      const stageId = String(a.stageId || lastBuild.get(id)?.stageId || "");
      if (!stageId) throw new Error(`no staged build for '${id}'; run build first`);
      const r = await ctx.host.modules.activate(id, stageId, a.force === true ? { force: true } : void 0);
      return { ...r, ok: true };
    },
    async rollback(ctx, a) {
      const r = await ctx.host.modules.rollback(String(a.id), { ...a.toVersion ? { toVersion: Number(a.toVersion) } : {}, ...a.force === true ? { force: true } : {} });
      scan(ctx, false).catch(() => {
      });
      return { ...r, ok: true };
    },
    async buildAndActivate(ctx, a) {
      const b = await build(ctx, String(a.id));
      if (!b.ok) return b;
      try {
        const r = await ctx.host.modules.activate(String(a.id), b.stageId);
        scan(ctx, false).catch(() => {
        });
        return { ...r, ok: true, build: b };
      } catch (e) {
        return { ok: false, id: a.id, error: errMsg(e), code: e.code, build: b };
      }
    }
  }
};
var index_default = mod;
export {
  applyHunks,
  index_default as default,
  parseUnifiedDiff
};
