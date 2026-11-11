// ../sdk/file-presentation.ts
var FilePresentationClient = class {
  constructor(ctx) {
    this.ctx = ctx;
    this.cache = /* @__PURE__ */ new Map();
    this.queued = /* @__PURE__ */ new Map();
    this.workspace = null;
    this.revision = 0;
    this.busy = false;
    this.stopped = false;
    this.stops = [
      ctx.state.watch("files.presentationRuleCount", () => this.clear()),
      ctx.events.on("files.presentationChanged", () => this.clear()),
      ctx.events.on("files.changed", (event) => {
        if (event.workspaceId === this.workspace) this.clear();
      })
    ];
  }
  get(workspaceId, path, kind = "file") {
    if (this.ctx.state.get("files.presentationRuleCount") === 0) return {};
    if (this.workspace !== workspaceId) {
      this.clear();
      this.workspace = workspaceId;
    }
    const key = `${kind}:${path}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    this.queued.set(key, { path, kind });
    if (!this.timer && !this.busy && !this.stopped) this.timer = setTimeout(() => {
      this.timer = void 0;
      void this.flush();
    }, 30);
    return {};
  }
  clear() {
    this.revision++;
    this.cache.clear();
    this.queued.clear();
    this.ctx.ui.invalidate();
  }
  dispose() {
    this.stopped = true;
    this.revision++;
    if (this.timer) clearTimeout(this.timer);
    for (const stop of this.stops) if (typeof stop === "function") stop();
  }
  async flush() {
    if (this.stopped || this.busy || !this.workspace) return;
    this.busy = true;
    const revision = this.revision, workspaceId = this.workspace;
    const batch = [...this.queued.entries()].slice(0, 64);
    for (const [key] of batch) {
      this.queued.delete(key);
      this.cache.set(key, {});
    }
    try {
      const result = await this.ctx.modules.call("files", "presentations", { workspaceId, entries: batch.map(([, entry]) => entry) }, { timeoutMs: 45e3 });
      if (revision === this.revision && !this.stopped) for (const [key, entry] of batch) this.cache.set(key, result?.[entry.path] || {});
    } catch {
    } finally {
      this.busy = false;
      if (revision === this.revision && !this.stopped) this.ctx.ui.invalidate();
      if (this.queued.size && !this.stopped) this.timer = setTimeout(() => {
        this.timer = void 0;
        void this.flush();
      }, 30);
    }
  }
};

// ../sdk/filter-style.ts
var filterInput = { height: 32, style: { noShrink: true } };

// ../sdk/runtime.ts
function debounce(fn, ms) {
  let t = null;
  return () => {
    if (t !== null) return;
    t = setTimeout(() => {
      t = null;
      fn();
    }, ms);
  };
}
function errMsg(e) {
  return e && (e.message || String(e)) || "unknown error";
}

// ../sdk/file-icons.ts
var fileIcons = {
  "folder": '<svg\n  xmlns="http://www.w3.org/2000/svg"\n  width="24"\n  height="24"\n  viewBox="0 0 24 24"\n  fill="none"\n  stroke="currentColor"\n  stroke-width="1.7"\n  stroke-linecap="round"\n  stroke-linejoin="round"\n>\n  <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />\n</svg>',
  "folderOpen": '<svg\n  xmlns="http://www.w3.org/2000/svg"\n  width="24"\n  height="24"\n  viewBox="0 0 24 24"\n  fill="none"\n  stroke="currentColor"\n  stroke-width="1.7"\n  stroke-linecap="round"\n  stroke-linejoin="round"\n>\n  <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />\n</svg>',
  "file": '<svg\n  xmlns="http://www.w3.org/2000/svg"\n  width="24"\n  height="24"\n  viewBox="0 0 24 24"\n  fill="none"\n  stroke="currentColor"\n  stroke-width="1.7"\n  stroke-linecap="round"\n  stroke-linejoin="round"\n>\n  <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />\n  <path d="M14 2v5a1 1 0 0 0 1 1h5" />\n</svg>',
  "text": '<svg\n  xmlns="http://www.w3.org/2000/svg"\n  width="24"\n  height="24"\n  viewBox="0 0 24 24"\n  fill="none"\n  stroke="currentColor"\n  stroke-width="1.7"\n  stroke-linecap="round"\n  stroke-linejoin="round"\n>\n  <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />\n  <path d="M14 2v5a1 1 0 0 0 1 1h5" />\n  <path d="M10 9H8" />\n  <path d="M16 13H8" />\n  <path d="M16 17H8" />\n</svg>',
  "code": '<svg\n  xmlns="http://www.w3.org/2000/svg"\n  width="24"\n  height="24"\n  viewBox="0 0 24 24"\n  fill="none"\n  stroke="currentColor"\n  stroke-width="1.7"\n  stroke-linecap="round"\n  stroke-linejoin="round"\n>\n  <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />\n  <path d="M14 2v5a1 1 0 0 0 1 1h5" />\n  <path d="M10 12.5 8 15l2 2.5" />\n  <path d="m14 12.5 2 2.5-2 2.5" />\n</svg>',
  "config": '<svg\n  xmlns="http://www.w3.org/2000/svg"\n  width="24"\n  height="24"\n  viewBox="0 0 24 24"\n  fill="none"\n  stroke="currentColor"\n  stroke-width="1.7"\n  stroke-linecap="round"\n  stroke-linejoin="round"\n>\n  <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />\n  <path d="M14 2v5a1 1 0 0 0 1 1h5" />\n  <path d="M10 12a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1 1 1 0 0 1 1 1v1a1 1 0 0 0 1 1" />\n  <path d="M14 18a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1 1 1 0 0 1-1-1v-1a1 1 0 0 0-1-1" />\n</svg>',
  "image": '<svg\n  xmlns="http://www.w3.org/2000/svg"\n  width="24"\n  height="24"\n  viewBox="0 0 24 24"\n  fill="none"\n  stroke="currentColor"\n  stroke-width="1.7"\n  stroke-linecap="round"\n  stroke-linejoin="round"\n>\n  <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />\n  <path d="M14 2v5a1 1 0 0 0 1 1h5" />\n  <circle cx="10" cy="12" r="2" />\n  <path d="m20 17-1.296-1.296a2.41 2.41 0 0 0-3.408 0L9 22" />\n</svg>',
  "archive": '<svg\n  xmlns="http://www.w3.org/2000/svg"\n  width="24"\n  height="24"\n  viewBox="0 0 24 24"\n  fill="none"\n  stroke="currentColor"\n  stroke-width="1.7"\n  stroke-linecap="round"\n  stroke-linejoin="round"\n>\n  <path d="M13.659 22H18a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v11.5" />\n  <path d="M14 2v5a1 1 0 0 0 1 1h5" />\n  <path d="M8 12v-1" />\n  <path d="M8 18v-2" />\n  <path d="M8 7V6" />\n  <circle cx="8" cy="20" r="2" />\n</svg>',
  "link": '<svg\n  xmlns="http://www.w3.org/2000/svg"\n  width="24"\n  height="24"\n  viewBox="0 0 24 24"\n  fill="none"\n  stroke="currentColor"\n  stroke-width="1.7"\n  stroke-linecap="round"\n  stroke-linejoin="round"\n>\n  <path d="M4 11V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h7" />\n  <path d="M14 2v5a1 1 0 0 0 1 1h5" />\n  <path d="m10 18 3-3-3-3" />\n</svg>'
};

// modules/ui/explorer/src/model.ts
function matchingFileEntries(files) {
  const entries = /* @__PURE__ */ new Map();
  for (const file of files) {
    const parts = file.relativePath.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const relativePath = parts.slice(0, i).join("/");
      entries.set(relativePath, { relativePath, name: parts[i - 1], kind: i === parts.length ? "file" : "dir" });
    }
  }
  return [...entries.values()];
}
function fileIcon(entry) {
  if (entry.kind === "dir") return "folder";
  if (entry.kind === "symlink") return "link";
  const ext = entry.name.toLowerCase().split(".").pop() || "";
  if (["json", "jsonc", "yaml", "yml", "toml", "xml", "ini", "env"].includes(ext)) return "config";
  if (["md", "mdx", "txt", "rst"].includes(ext)) return "text";
  if (["ts", "tsx", "js", "jsx", "mjs", "rs", "py", "go", "rb", "java", "c", "cpp", "h", "swift", "sh", "css", "scss", "html", "sql"].includes(ext)) return "code";
  if (["png", "jpg", "jpeg", "webp", "gif", "svg", "ico"].includes(ext)) return "image";
  if (["zip", "gz", "tar", "bz2", "xz", "7z"].includes(ext)) return "archive";
  return "file";
}
function directories(entries) {
  const dirs2 = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    const at = entry.relativePath.lastIndexOf("/");
    const parent = at < 0 ? "." : entry.relativePath.slice(0, at);
    const items = dirs2.get(parent) || [];
    items.push(entry);
    dirs2.set(parent, items);
  }
  return dirs2;
}
function treeRows(dirs2, expanded2, selected, filtering = false, filterCollapsed2 = /* @__PURE__ */ new Set()) {
  const rows = [];
  const visit = (parent, depth) => {
    for (let entry of [...dirs2.get(parent) || []].sort((a, b) => Number(b.kind === "dir") - Number(a.kind === "dir") || a.name.localeCompare(b.name))) {
      if (rows.length >= 5e3) return;
      let label = entry.name;
      const seen = /* @__PURE__ */ new Set();
      while (!filtering && entry.kind === "dir" && !seen.has(entry.relativePath)) {
        seen.add(entry.relativePath);
        const children = dirs2.get(entry.relativePath);
        if (children?.length !== 1 || children[0].kind !== "dir") break;
        entry = children[0];
        label += "/" + entry.name;
      }
      const folder = entry.kind === "dir";
      const open = folder && (filtering ? !filterCollapsed2.has(entry.relativePath) : expanded2.has(entry.relativePath));
      const kind = fileIcon(entry) || "file";
      const drawing = folder ? open ? fileIcons.folderOpen : fileIcons.folder : fileIcons[kind] || fileIcons.file;
      const softDrawing = drawing.replace('stroke-width="1.7"', 'stroke-width="1.3" stroke-opacity="0.7"');
      const iconColor = kind === "config" ? "warning" : ["text", "code"].includes(kind) ? "accent" : "muted";
      rows.push({ iconSvg: softDrawing, iconColor, key: entry.relativePath, label, depth, expandable: folder, expanded: open, selected: entry.relativePath === selected, icon: fileIcon(entry) });
      if (open) visit(entry.relativePath, depth + 1);
    }
  };
  visit(".", 0);
  return rows;
}

// ../sdk/ui-icons.ts
var outline = (paths, width = 1.8) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
var uiIcons = {
  send: outline("<path d='m22 2-7 20-4-9-9-4Z'/><path d='M22 2 11 13'/>"),
  paperclip: outline("<path d='m21 11-9 9a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8l8.5-8.5'/>"),
  "sliders-horizontal": outline("<path d='M3 6h3m4 0h11M3 18h11m4 0h3'/><circle cx='8' cy='6' r='2'/><circle cx='16' cy='18' r='2'/>"),
  "message-square": outline("<path d='M21 15a2 2 0 0 1-2 2H7l-5 5V4a2 2 0 0 1 2-2h15a2 2 0 0 1 2 2Z'/>"),
  "graduation-cap": outline("<path d='m2 8 10-5 10 5-10 5Zm4 2v7q6 5 12 0v-7M22 8v8'/>"),
  pencil: outline("<path d='M21.2 6.8a2.8 2.8 0 0 0-4-4L3.8 16.2 3 21l4.8-.8Z'/><path d='m15 5 4 4'/>"),
  eraser: outline("<path d='m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L11 21'/><path d='M22 21H7'/><path d='m5 11 9 9'/>"),
  trash: outline("<path d='M3 6h18'/><path d='M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6'/><path d='M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'/><path d='M10 11v6M14 11v6'/>"),
  copy: outline("<rect x='8' y='8' width='13' height='13' rx='2'/><path d='M16 5V3H3v13h2'/>"),
  warning: outline("<path d='m12 3 10 18H2Z'/><path d='M12 9v5m0 3h.01'/>"),
  terminal: outline("<rect x='3' y='4' width='18' height='16' rx='2'/><path d='m7 9 3 3-3 3m6 0h4'/>"),
  "git-branch": outline("<circle cx='6' cy='3' r='2'/><circle cx='6' cy='20' r='2'/><circle cx='18' cy='6' r='2'/><path d='M6 5v13M18 8c0 7-12 4-12 10'/>"),
  files: outline("<path d='M14 2H6v16h14V8Z'/><path d='M14 2v6h6M3 6v16h13'/>"),
  folder: outline("<path d='M3 5h6l2 2h10v13H3Z'/>"),
  refresh: outline("<path d='M20 7a8 8 0 1 0 0 10M20 3v5h-5'/>"),
  collapse: outline("<path d='m8 8 4-4 4 4M8 16l4 4 4-4M4 12h16'/>"),
  locate: outline("<circle cx='12' cy='12' r='7'/><circle cx='12' cy='12' r='2'/><path d='M12 2v3m0 14v3M2 12h3m14 0h3'/>"),
  search: outline("<circle cx='10' cy='10' r='7'/><path d='m15 15 6 6'/>"),
  x: outline("<path d='m6 6 12 12M6 18 18 6'/>"),
  plus: outline("<path d='M12 4v16M4 12h16'/>"),
  remote: outline("<rect x='3' y='4' width='18' height='12' rx='2'/><path d='M8 20h8M12 16v4'/>"),
  plug: outline("<path d='M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0V7ZM12 17v5'/>"),
  "text-search": outline("<path d='M4 6h16M4 12h7M4 18h6'/><circle cx='17' cy='15' r='3'/><path d='m19.2 17.2 2.3 2.3'/>"),
  eye: outline("<path d='M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z'/><circle cx='12' cy='12' r='3'/>"),
  "eye-off": outline("<path d='M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3 3.8M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18'/>"),
  globe: outline("<circle cx='12' cy='12' r='9'/><path d='M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18'/>"),
  "cloud-lock": outline("<path d='M17.5 17H18a4 4 0 0 0 .5-8A6 6 0 0 0 7 7.5 4.5 4.5 0 0 0 6.5 17'/><rect x='9' y='14' width='6' height='6' rx='1'/><path d='M10.5 14v-1.5a1.5 1.5 0 0 1 3 0V14'/>"),
  lock: outline("<rect x='4' y='11' width='16' height='10' rx='2'/><path d='M8 11V7a4 4 0 0 1 8 0v4'/>"),
  key: outline("<circle cx='8' cy='15' r='4'/><path d='m10.8 12.2 8.7-8.7M17 6l3 3M14.5 8.5l2 2'/>"),
  check: outline("<path d='m5 12 5 5 9-11'/>"),
  "log-out": outline("<path d='M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9'/>"),
  external: outline("<path d='M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'/>"),
  sparkles: outline("<path d='M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z'/><path d='M19 16v4M17 18h4'/>"),
  import: outline("<path d='M12 3v12M7 10l5 5 5-5M5 21h14'/>"),
  task: outline("<circle cx='6' cy='3' r='2'/><circle cx='6' cy='20' r='2'/><circle cx='18' cy='6' r='2'/><path d='M6 5v13M18 8c0 7-12 4-12 10'/>")
};

// modules/ui/explorer/src/index.ts
var presentation = null;
var ws = null;
var dirs = /* @__PURE__ */ new Map();
var expanded = /* @__PURE__ */ new Set();
var filterCollapsed = /* @__PURE__ */ new Set();
var pending = /* @__PURE__ */ new Set();
var query = "";
var results = null;
var searching = false;
var error = null;
var epoch = 0;
var searchVersion = 0;
var searchSoon = () => {
};
var contentMode = false;
var showIgnored = false;
var gitFiles = [];
var gitVersion = 0;
var grep = null;
var grepSoon = () => {
};
async function refreshGit(ctx) {
  const version = ++gitVersion, workspaceId = ws?.id;
  if (!workspaceId) {
    gitFiles = [];
    return;
  }
  try {
    const status = await ctx.modules.call("git", "status", { workspaceId }, { timeoutMs: 45e3 });
    if (version === gitVersion && workspaceId === ws?.id) {
      gitFiles = status.files || [];
      ctx.ui.invalidate();
    }
  } catch {
    if (version === gitVersion) {
      gitFiles = [];
      ctx.ui.invalidate();
    }
  }
}
async function loadDir(ctx, path, version = epoch) {
  if (!ws || pending.has(path) || dirs.has(path)) return;
  const workspaceId = ws.id;
  pending.add(path);
  ctx.ui.invalidate();
  try {
    const listing = await ctx.modules.call("files", "list", { workspaceId, relativeDir: path, showHidden: true, hideIgnored: !showIgnored });
    if (version === epoch) {
      dirs.set(path, listing.entries.filter((entry) => entry.name !== ".DS_Store"));
      error = null;
    }
  } catch (e) {
    if (version === epoch) error = errMsg(e);
  } finally {
    if (version === epoch) pending.delete(path);
    ctx.ui.invalidate();
  }
}
var refreshing = false;
var refreshAgain = false;
var treeDirty = false;
async function refreshTree(ctx) {
  if (refreshing) {
    refreshAgain = true;
    return;
  }
  refreshing = true;
  try {
    do {
      refreshAgain = false;
      const version = epoch, workspaceId = ws?.id;
      if (!workspaceId) return;
      if (query.trim()) {
        treeDirty = true;
        await search(ctx);
        continue;
      }
      treeDirty = false;
      const paths = [...dirs.keys()];
      const listings = await Promise.all(paths.map(async (path) => {
        try {
          const listing = await ctx.modules.call("files", "list", { workspaceId, relativeDir: path, showHidden: true, hideIgnored: !showIgnored });
          return [path, listing.entries.filter((entry) => entry.name !== ".DS_Store")];
        } catch (e) {
          if (version === epoch) error = errMsg(e);
          return null;
        }
      }));
      if (version !== epoch) {
        refreshAgain = true;
        continue;
      }
      for (const listing of listings) if (listing) dirs.set(listing[0], listing[1]);
      if (query.trim()) await search(ctx);
      ctx.ui.invalidate();
    } while (refreshAgain);
  } finally {
    refreshing = false;
  }
}
async function compactChildren(ctx, parent, version = epoch) {
  let budget = 64;
  const compact = async (path) => {
    if (version !== epoch || budget-- <= 0 || path === ".git") return;
    await loadDir(ctx, path, version);
    const children = dirs.get(path);
    if (children?.length === 1 && children[0].kind === "dir") await compact(children[0].relativePath);
  };
  const folders = (dirs.get(parent) || []).filter((entry) => entry.kind === "dir");
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, folders.length) }, async () => {
    while (cursor < folders.length && version === epoch && budget > 0) await compact(folders[cursor++].relativePath);
  }));
}
async function search(ctx, refresh = false) {
  const version = ++searchVersion;
  const workspaceId = ws?.id;
  const text = query.trim();
  if (!workspaceId || !text) {
    results = null;
    searching = false;
    ctx.ui.invalidate();
    return;
  }
  searching = true;
  ctx.ui.invalidate();
  try {
    const next = contentMode ? await ctx.modules.call("files", "grep", { workspaceId, query: text, hideIgnored: !showIgnored }, { timeoutMs: 12e4 }) : await ctx.modules.call("files", "search", { workspaceId, query: text, refresh, hideIgnored: !showIgnored }, { timeoutMs: 12e4 });
    if (contentMode && version === searchVersion && ws?.id === workspaceId) {
      grep = next;
      results = null;
      error = null;
      return;
    }
    if (version === searchVersion && ws?.id === workspaceId) {
      results = next;
      error = null;
    }
  } catch (e) {
    if (version === searchVersion && ws?.id === workspaceId) {
      error = errMsg(e);
    }
  } finally {
    if (version === searchVersion) searching = false;
    ctx.ui.invalidate();
  }
}
var filteredEntries = () => contentMode ? matchingFileEntries(grep?.files || []) : results?.entries || [];
async function reveal(ctx) {
  const path = ws?.view?.previewPath;
  if (!path) return;
  const version = epoch;
  query = "";
  results = null;
  searchVersion++;
  searching = false;
  const parts = path.split("/");
  parts.pop();
  let parent = "";
  for (const part of parts) {
    parent = parent ? parent + "/" + part : part;
    expanded.add(parent);
    await loadDir(ctx, parent, version);
    if (version !== epoch) return;
  }
  ctx.ui.invalidate();
}
async function reset(ctx, saved) {
  treeDirty = false;
  gitFiles = [];
  gitVersion++;
  void refreshGit(ctx);
  const version = ++epoch;
  searchVersion++;
  ctx.ui.invalidate();
  dirs = /* @__PURE__ */ new Map();
  pending = /* @__PURE__ */ new Set();
  filterCollapsed = new Set(saved?.filterCollapsed || []);
  results = null;
  searching = false;
  error = null;
  expanded = new Set(saved?.expanded || ws?.view?.ui?.explorerTree?.expanded || []);
  query = saved?.query || "";
  grep = null;
  if (saved && typeof saved.showIgnored === "boolean") showIgnored = saved.showIgnored;
  if (saved && typeof saved.contentMode === "boolean") contentMode = saved.contentMode;
  await loadDir(ctx, ".");
  await compactChildren(ctx, ".", version);
  if (version !== epoch) return;
  for (const path of [...expanded].sort()) {
    await loadDir(ctx, path, version);
    if (version !== epoch) return;
  }
  if (query) await search(ctx);
}
var mod = {
  id: "explorer",
  moduleApiVersion: 1,
  async activate(ctx, prev) {
    presentation?.dispose();
    presentation = new FilePresentationClient(ctx);
    searchSoon = debounce(() => {
      void search(ctx);
    }, 160);
    grepSoon = debounce(() => {
      void search(ctx);
    }, 450);
    ws = ctx.state.get("workspace.selected") || null;
    ctx.state.watch("workspace.selected", (next) => {
      const changed = ws?.id !== next?.id;
      ws = next;
      if (changed) void reset(ctx);
      else ctx.ui.invalidate();
    });
    const gitSoon = debounce(() => {
      void refreshGit(ctx);
    }, 300);
    ctx.events.on("files.indexed", (event) => {
      if (event.workspaceId === ws?.id && query.trim() && !contentMode) searchSoon();
    });
    ctx.events.on("git.changed", (event) => {
      if (event.workspaceId === ws?.id) gitSoon();
    });
    ctx.events.on("files.changed", (event) => {
      if (event.workspaceId !== ws?.id) return;
      void refreshTree(ctx);
      gitSoon();
    });
    const savedView = ws?.view?.ui?.explorerTree;
    await reset(ctx, prev?.workspaceId === ws?.id ? prev : savedView ? { showIgnored: !!savedView.showIgnored, contentMode: false } : null);
  },
  deactivate() {
    presentation?.dispose();
    presentation = null;
  },
  snapshot: () => ({ workspaceId: ws?.id || null, expanded: [...expanded], filterCollapsed: [...filterCollapsed], query, showIgnored, contentMode }),
  render() {
    const filtering = !!query.trim();
    const grepping = filtering && contentMode;
    const rows = treeRows(filtering ? directories(filteredEntries()) : dirs, expanded, ws?.view?.previewPath || null, filtering, filterCollapsed);
    const loaded = [...dirs.values()].reduce((count2, entries) => count2 + entries.length, 0);
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    const count = grepping ? searching ? "Searching file contents…" : query.trim().length < 2 ? "Type at least 2 characters" : `${plural(grep?.matchCount || 0, "match", "matches")} in ${plural(grep?.fileCount || 0, "file", "files")}${grep?.truncated ? " · first results" : ""}` : filtering ? searching ? "Searching workspace…" : `${plural(results?.matchCount || 0, "match", "matches")}${results?.indexing ? " · indexing…" : results?.partial ? " · first results" : ""}` : `${loaded} items loaded`;
    const toggle = (key, icon, on, action, tooltip) => ({ type: "button", key, text: "", iconSvg: icon, action, small: true, variant: on ? "primary" : "ghost", tooltip, disabled: !ws });
    const children = [
      { type: "row", key: "filter-bar", gap: 4, align: "center", children: [
        { type: "textInput", key: "file-filter", ...filterInput, prefixSvg: contentMode ? uiIcons["text-search"] : uiIcons.search, placeholder: contentMode ? "Search in files" : "Filter files", value: query, changeAction: "filter", submitAction: "submitFilter", grow: true, disabled: !ws },
        ...query ? [{ type: "button", key: "clear", text: "", iconSvg: uiIcons["x"], action: "clearFilter", small: true, variant: "ghost", tooltip: "Clear filter" }] : [],
        toggle("content-mode", uiIcons["text-search"], contentMode, "toggleContent", contentMode ? "Searching file contents — click to filter by file name" : "Search the filter text inside files"),
        toggle("show-ignored", showIgnored ? uiIcons.eye : uiIcons["eye-off"], showIgnored, "toggleIgnored", showIgnored ? "Showing .gitignored files — click to hide them" : "Show .gitignored files")
      ] }
    ];
    if (!ws) children.push({ type: "label", key: "none", text: "Select a project or task.", color: "muted", padding: 8 });
    else {
      children.push({ type: "row", key: "tools", gap: 4, children: [
        { type: "label", key: "count", text: count, size: "xs", color: "muted", grow: true, tooltip: filtering ? "Search covers workspace paths, excluding .git object storage. Project paths are cached, including collapsed folders. Hidden ignored folders are skipped before traversal; results update while indexing. Up to 1,000 matches are shown." : "Folders load as you expand them; filtering searches the workspace." },
        { type: "button", key: "reveal", text: "", iconSvg: uiIcons["locate"], action: "reveal", small: true, variant: "ghost", disabled: !ws.view?.previewPath, tooltip: "Reveal selected file" },
        { type: "button", key: "collapse", text: "", iconSvg: uiIcons["collapse"], action: "collapseAll", small: true, variant: "ghost", tooltip: "Collapse all folders" },
        { type: "button", key: "refresh", text: "", iconSvg: uiIcons["refresh"], action: "refresh", small: true, variant: "ghost", tooltip: "Refresh files" }
      ] });
      if (error) children.push({ type: "status", key: "err", text: error, level: "error" });
      if (pending.size && !dirs.has(".")) children.push({ type: "progress", key: "loading", indeterminate: true });
      if (filtering && !searching && !rows.length && !error && !(grepping && query.trim().length < 2)) children.push({ type: "label", key: "empty", text: grepping ? "No files contain this text." : "No matching files.", color: "muted", padding: 12 });
      if (!filtering && !pending.size && !loaded) children.push({ type: "label", key: "empty", text: "This folder is empty.", color: "muted", padding: 12 });
      children.push({
        type: "tree",
        key: "files",
        rowHeight: 28,
        rowGap: 2,
        indent: 18,
        iconSize: 17,
        collapsedIconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m9 5 7 7-7 7"/></svg>',
        expandedIconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m5 9 7 7 7-7"/></svg>',
        rows: rows.map((row) => {
          const change = gitFiles.find((file) => file.path === row.key);
          const below = row.expandable && gitFiles.some((file) => file.path.startsWith(row.key + "/"));
          return { ...row, ...presentation?.get(ws.id, row.key, row.expandable ? "dir" : "file"), badge: pending.has(row.key) ? "…" : change ? { modified: "M", added: "A", deleted: "D", renamed: "R", untracked: "U", conflicted: "!", copied: "C", typechange: "T" }[change.kind] || "M" : below ? "•" : "" };
        }),
        selectAction: "open",
        expandAction: "expand",
        style: { fontWeight: 400 },
        grow: true
      });
    }
    return { type: "column", key: "explorer-root", gap: 4, padding: 8, grow: true, children };
  },
  async onEvent(ctx, ev) {
    if (!ws) return;
    const workspaceId = ws.id;
    const version = epoch;
    try {
      if (ev.action === "filter") {
        const nextQuery = String(ev.value || "");
        if (nextQuery === query) return;
        query = nextQuery;
        filterCollapsed.clear();
        results = null;
        grep = null;
        searchVersion++;
        const go = contentMode ? query.trim().length >= 2 : !!query.trim();
        searching = go;
        if (go) (contentMode ? grepSoon : searchSoon)();
        else if (treeDirty) void refreshTree(ctx);
        ctx.ui.invalidate();
        return;
      }
      if (ev.action === "submitFilter") {
        if (query.trim()) await search(ctx);
        return;
      }
      if (ev.action === "clearFilter") {
        query = "";
        results = null;
        grep = null;
        searching = false;
        searchVersion++;
        if (treeDirty) void refreshTree(ctx);
        ctx.ui.invalidate();
        return;
      }
      if (ev.action === "toggleContent") {
        contentMode = !contentMode;
        results = null;
        grep = null;
        searchVersion++;
        if (query.trim()) await search(ctx);
        else ctx.ui.invalidate();
        return;
      }
      if (ev.action === "toggleIgnored") {
        showIgnored = !showIgnored;
        await ctx.modules.call("workspace", "view.patch", { workspaceId, patch: { ui: { explorerTree: { expanded: [...expanded], showIgnored } } } });
        await reset(ctx, { expanded: [...expanded], query, showIgnored, contentMode });
        return;
      }
      if (ev.action === "collapseAll") {
        expanded.clear();
        query = "";
        results = null;
        searchVersion++;
        searching = false;
      } else if (ev.action === "reveal") {
        await reveal(ctx);
      } else if (ev.action === "refresh") {
        await ctx.modules.call("files", "search", { workspaceId, query: "", refresh: true, hideIgnored: !showIgnored });
        if (version !== epoch) return;
        await refreshTree(ctx);
      } else if (["open", "expand"].includes(ev.action) && ev.rowKey) {
        const entry = (query.trim() ? filteredEntries() : [...dirs.values()].flat()).find((item) => item.relativePath === ev.rowKey);
        if (!entry) return;
        if (entry.kind === "dir") {
          if (query.trim()) {
            if (filterCollapsed.has(entry.relativePath)) filterCollapsed.delete(entry.relativePath);
            else filterCollapsed.add(entry.relativePath);
          } else if (expanded.has(entry.relativePath)) expanded.delete(entry.relativePath);
          else {
            expanded.add(entry.relativePath);
            await loadDir(ctx, entry.relativePath);
            await compactChildren(ctx, entry.relativePath, version);
          }
        } else if (ev.action === "open") await ctx.modules.call("workspace", "view.patch", { workspaceId: ws.id, patch: { previewPath: entry.relativePath, ...contentMode && query.trim() ? { ui: { viewerSearch: { key: crypto.randomUUID(), path: entry.relativePath, query: query.trim() } } } : {} } });
      }
      if (version !== epoch) return;
      await ctx.modules.call("workspace", "view.patch", { workspaceId, patch: { ui: { explorerTree: { expanded: [...expanded], showIgnored } } } });
      error = null;
    } catch (e) {
      if (version === epoch) error = errMsg(e);
    }
    ctx.ui.invalidate();
  }
};
var index_default = mod;
export {
  index_default as default
};
