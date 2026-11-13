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

// ../sdk/runtime.ts
function errMsg(e) {
  return e && (e.message || String(e)) || "unknown error";
}
function langFromPath(p) {
  const name2 = p.split("/").pop() || "";
  const lower = name2.toLowerCase();
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

// ../sdk/filter-style.ts
var filterInput = { height: 32, style: { noShrink: true } };

// ../sdk/virtual-documents.ts
var VIRTUAL_TAB_PREFIX = "virtual:";
var virtualTab = (provider, key) => `${VIRTUAL_TAB_PREFIX}${provider}/${key}`;
function parseVirtualTab(tab) {
  if (!tab || !tab.startsWith(VIRTUAL_TAB_PREFIX)) return null;
  const rest = tab.slice(VIRTUAL_TAB_PREFIX.length), slash = rest.indexOf("/");
  if (slash <= 0 || slash === rest.length - 1) return null;
  return { provider: rest.slice(0, slash), key: rest.slice(slash + 1) };
}

// modules/ui/library-panel/src/index.ts
var PROVIDER = "library-panel";
var BOOK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v16M3 3h5a4 4 0 0 1 4 2 4 4 0 0 1 4-2h5v16h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3Z"/></svg>';
var AGENT = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9 17h6"/></svg>';
var rootOf = (kind2) => kind2 === "agent" ? "AGENT.md" : "SKILL.md";
var scope = "global";
var workspaceId = null;
var entries = [];
var selectedId = null;
var selectedFile = null;
var query = "";
var error = "";
var busy = false;
var generation = 0;
var form = null;
var name = "";
var description = "";
var kind = "skill";
var adding = false;
var newPath = "";
var confirmRemove = false;
var confirmDeleteFile = null;
var expanded = /* @__PURE__ */ new Set();
var collapsedDirs = /* @__PURE__ */ new Set();
var opened = /* @__PURE__ */ new Map();
var saving = 0;
var selected = () => entries.find((e) => e.id === selectedId) || null;
var args = () => ({ scope, workspaceId });
var btn = (key, text, action, opts = {}) => ({ type: "button", key, text, action, small: true, disabled: busy || !!opts.disabled, variant: opts.variant || "ghost", ...opts.icon ? { iconSvg: opts.icon } : {}, ...opts.tooltip ? { tooltip: opts.tooltip } : {} });
var label = (key, text, muted = false) => ({ type: "label", key, text, size: "sm", color: muted ? "muted" : void 0, wrap: true });
var tabFor = (t) => virtualTab(PROVIDER, `${t.scope}/${t.id}/${t.path}`);
var openedKey = (wsId, tab) => `${wsId}|${tab}`;
function targetOf(wsId, tab) {
  const parsed = parseVirtualTab(typeof tab === "string" ? tab : null);
  if (!parsed || parsed.provider !== PROVIDER || typeof wsId !== "string" || !wsId) return null;
  const [s, id, ...rest] = parsed.key.split("/");
  if (s !== "global" && s !== "project" || !id || !rest.length) return null;
  return { workspaceId: wsId, scope: s, id, path: rest.join("/") };
}
var libraryArgs = (t) => ({ scope: t.scope, workspaceId: t.workspaceId, id: t.id });
async function show(ctx, t, reveal) {
  const tab = tabFor(t), key = openedKey(t.workspaceId, tab);
  let request;
  let next = null;
  try {
    const file = await ctx.modules.call("library", "read", { ...libraryArgs(t), path: t.path });
    const document = await ctx.host.ui.documentOpen(t.workspaceId, file.content, langFromPath(t.path), { path: t.path });
    next = { base: file.content, document };
    request = { workspaceId: t.workspaceId, tab, title: `Library · ${file.name} / ${t.path}`, document, text: file.content, reveal };
  } catch (e) {
    request = { workspaceId: t.workspaceId, tab, title: `Library / ${t.path}`, document: null, text: "", reveal, error: `Library: ${errMsg(e)}` };
  }
  const result = await ctx.modules.call("viewer", "virtual.show", request);
  if (result?.replaced === false) {
    if (next?.document) void ctx.host.resources.release(next.document).catch(() => {
    });
    return;
  }
  const previous = opened.get(key);
  if (previous?.document && previous.document !== next?.document) void ctx.host.resources.release(previous.document).catch(() => {
  });
  if (next) opened.set(key, next);
  else opened.delete(key);
}
async function openFile(ctx, id, path) {
  if (!workspaceId) throw new Error("Select a project or task to open Library files in the editor.");
  selectedId = id;
  selectedFile = path;
  await show(ctx, { workspaceId, scope, id, path }, true);
}
async function saveTab(ctx, ev) {
  const t = targetOf(ev?.workspaceId, ev?.tab);
  if (!t || typeof ev?.requestId !== "string") return;
  saving++;
  try {
    const { text, force } = await ctx.modules.call("viewer", "virtual.take", { requestId: ev.requestId });
    const key = openedKey(t.workspaceId, ev.tab), base = opened.get(key)?.base;
    try {
      const entry = await ctx.modules.call("library", "read", libraryArgs(t));
      if (!force) {
        if (!entry.paths.includes(t.path)) throw Object.assign(new Error(`${t.path} was deleted from the Library.`), { conflict: true });
        const stored = (await ctx.modules.call("library", "read", { ...libraryArgs(t), path: t.path })).content;
        if (base !== void 0 && stored !== base) throw Object.assign(new Error(`${t.path} changed in the Library since it was opened.`), { conflict: true });
      }
      const before = opened.get(key);
      opened.set(key, { base: text, document: before?.document ?? null });
      await ctx.modules.call("library", "save", { ...libraryArgs(t), path: t.path, content: text, expectedRevision: entry.revision }).catch((e) => {
        if (before) opened.set(key, before);
        else opened.delete(key);
        throw Object.assign(new Error(errMsg(e)), { conflict: /changed/.test(errMsg(e)) });
      });
      await ctx.modules.call("viewer", "virtual.saved", { requestId: ev.requestId });
    } catch (e) {
      await ctx.modules.call("viewer", "virtual.saved", { requestId: ev.requestId, error: errMsg(e), conflict: !!e?.conflict });
    }
  } catch (e) {
    ctx.log.warn(`library save: ${errMsg(e)}`);
  } finally {
    saving--;
  }
}
async function refreshOpened(ctx) {
  for (const [key, item] of [...opened]) {
    const split = key.indexOf("|"), t = targetOf(key.slice(0, split), key.slice(split + 1));
    if (!t) continue;
    const stored = await ctx.modules.call("library", "read", { ...libraryArgs(t), path: t.path }).then((f) => f.content, () => null);
    if (stored !== item.base) await show(ctx, t, false).catch((e) => ctx.log.warn(errMsg(e)));
  }
}
function resolveLink(from, href) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("/")) return null;
  const resolved = [];
  for (const part of [...from.split("/").slice(0, -1), ...decodeURI(href.split("#")[0]).split("/")]) {
    if (part === "..") {
      if (!resolved.length) return null;
      resolved.pop();
    } else if (part && part !== ".") resolved.push(part);
  }
  return resolved.length ? resolved.join("/") : null;
}
async function refresh(ctx) {
  const version = ++generation;
  if (scope === "project" && !workspaceId) {
    entries = [];
    ctx.ui.invalidate();
    return;
  }
  try {
    const next = await ctx.modules.call("library", "list", args());
    if (version !== generation) return;
    entries = next;
    error = "";
  } catch (e) {
    if (version === generation) error = errMsg(e);
  }
  if (selectedId && !selected()) {
    selectedId = selectedFile = null;
    confirmRemove = false;
    adding = false;
  }
  ctx.ui.invalidate();
}
function entryMenu(entry) {
  return [
    { text: `Open ${rootOf(entry.kind)}`, action: "openRoot", value: entry.id },
    { text: "Add file…", action: "startAdd", value: entry.id },
    { text: "Edit details…", action: "details", value: entry.id },
    { separator: true },
    { text: "Remove…", action: "askRemove", value: entry.id }
  ];
}
function rows() {
  const result = [];
  const q = query.trim().toLowerCase();
  for (const entry of entries.filter((e) => `${e.name} ${e.description} ${e.paths.join(" ")}`.toLowerCase().includes(q))) {
    const open = expanded.has(entry.id) || !!q;
    result.push({
      key: entry.id,
      label: entry.name,
      tooltip: entry.description || void 0,
      badge: entry.kind === "agent" ? "agent" : "skill",
      depth: 0,
      expandable: true,
      expanded: open,
      selected: selectedId === entry.id && !selectedFile,
      weight: "medium",
      iconSvg: entry.kind === "agent" ? AGENT : BOOK,
      contextMenu: entryMenu(entry)
    });
    if (!open) continue;
    const dirs = /* @__PURE__ */ new Set();
    for (const p of entry.paths) {
      const segments = p.split("/");
      let hidden = false;
      for (let i = 1; i < segments.length; i++) {
        const dir = segments.slice(0, i).join("/"), key = `dir:${entry.id}:${dir}`;
        if (!dirs.has(dir)) {
          dirs.add(dir);
          result.push({ key, label: segments[i - 1], depth: i, expandable: true, expanded: !collapsedDirs.has(key), selected: false, iconSvg: uiIcons.folder });
        }
        if (collapsedDirs.has(key)) {
          hidden = true;
          break;
        }
      }
      if (hidden) continue;
      const root = p === rootOf(entry.kind);
      result.push({
        key: `file:${entry.id}:${p}`,
        label: segments[segments.length - 1],
        depth: segments.length,
        expandable: false,
        expanded: false,
        selected: selectedId === entry.id && selectedFile === p,
        iconSvg: uiIcons[p.endsWith(".sh") ? "terminal" : "files"],
        weight: root ? "medium" : void 0,
        contextMenu: [{ text: "Open in editor", action: "openFile", value: p }, { separator: true }, { text: "Delete file…", action: "askDeleteFile", value: p, disabled: root }]
      });
    }
  }
  return result;
}
function entryActions(entry) {
  const out = [{ type: "row", key: "entry", gap: 4, align: "center", children: [
    { type: "label", key: "name", text: entry.name, grow: true, weight: "semibold", size: "sm" },
    btn("add-file", "Add file", "startAdd", { icon: uiIcons.plus, tooltip: "Add a Markdown page or shell script" }),
    btn("details", "Details", "details", { icon: uiIcons.pencil, tooltip: "Rename or describe this entry" }),
    btn("remove", "", "askRemove", { icon: uiIcons.trash, tooltip: "Remove this entry" })
  ] }];
  if (entry.description) out.push(label("entry-description", entry.description, true));
  if (adding) out.push({ type: "row", key: "add-row", gap: 6, align: "center", children: [
    { type: "textInput", key: "newPath", value: newPath, changeAction: "newPath", submitAction: "addFile", placeholder: "references/guide.md or scripts/check.sh", grow: true },
    btn("add-confirm", "Add", "addFile", { disabled: !newPath.trim() }),
    btn("add-cancel", "Cancel", "cancelAdd")
  ] });
  if (confirmRemove) out.push({ type: "row", key: "remove-confirm", gap: 6, align: "center", children: [
    { type: "label", key: "warn", text: `Delete “${entry.name}” and all its files?`, size: "sm", color: "danger", grow: true, wrap: true },
    btn("yes", "Delete", "remove", { variant: "danger" }),
    btn("no", "Cancel", "cancelRemove")
  ] });
  if (confirmDeleteFile) out.push({ type: "row", key: "file-confirm", gap: 6, align: "center", children: [
    { type: "label", key: "warn", text: `Delete ${confirmDeleteFile}?`, size: "sm", color: "danger", grow: true, wrap: true },
    btn("yes", "Delete", "deleteFile", { variant: "danger" }),
    btn("no", "Cancel", "cancelDeleteFile")
  ] });
  return [{ type: "column", key: "selection", gap: 6, padding: 8, border: true, children: out }];
}
var mod = {
  id: PROVIDER,
  moduleApiVersion: 1,
  async activate(ctx, prev) {
    scope = prev?.scope === "project" ? "project" : "global";
    expanded = new Set(prev?.expanded || []);
    collapsedDirs = new Set(prev?.collapsedDirs || []);
    selectedId = prev?.selectedId || null;
    selectedFile = prev?.selectedFile || null;
    for (const [key, item] of Object.entries(prev?.opened || {})) if (typeof item?.base === "string") opened.set(key, item);
    workspaceId = ctx.state.get("workspace.selected")?.id || null;
    ctx.state.watch("workspace.selected", () => {
      const next = ctx.state.get("workspace.selected")?.id || null;
      if (next === workspaceId) return;
      workspaceId = next;
      if (scope === "project") {
        selectedId = selectedFile = null;
        confirmRemove = adding = false;
        void refresh(ctx);
      } else ctx.ui.invalidate();
    });
    ctx.events.on("library.changed", () => {
      void refresh(ctx);
      void refreshOpened(ctx);
    });
    ctx.events.on("viewer.virtualRequest", (ev) => {
      const t = targetOf(ev?.workspaceId, ev?.tab);
      if (t) void show(ctx, t, false).catch((e) => ctx.log.warn(errMsg(e)));
    });
    ctx.events.on("viewer.virtualSave", (ev) => {
      void saveTab(ctx, ev);
    });
    ctx.events.on("viewer.virtualLink", (ev) => {
      const t = targetOf(ev?.workspaceId, ev?.tab);
      if (!t) return;
      const path = resolveLink(t.path, String(ev.href || ""));
      if (!path) {
        ctx.host.ui.toast("warn", `Library links must point to files in the same entry: ${ev.href}`);
        return;
      }
      void show(ctx, { ...t, path }, true).catch((e) => ctx.host.ui.toast("error", errMsg(e)));
    });
    ctx.events.on("viewer.virtualClosed", (ev) => {
      const key = openedKey(String(ev?.workspaceId), String(ev?.tab)), item = opened.get(key);
      if (!item) return;
      opened.delete(key);
      if (item.document) void ctx.host.resources.release(item.document).catch(() => {
      });
    });
    await refresh(ctx);
  },
  snapshot: () => ({ scope, selectedId, selectedFile, expanded: [...expanded], collapsedDirs: [...collapsedDirs], opened: Object.fromEntries(opened) }),
  canSwap: () => ({ ok: !busy && !saving, reason: "Library changes are being saved" }),
  render() {
    const entry = selected();
    const children = [
      { type: "row", key: "heading", gap: 4, align: "center", children: [
        { type: "label", key: "title", text: "Library", size: "lg", weight: "semibold", grow: true },
        btn("refresh", "", "refresh", { icon: uiIcons.refresh, tooltip: "Reload the Library" }),
        btn("add", "New", "new", { icon: uiIcons.plus, tooltip: "Create a skill or agent" })
      ] },
      { type: "select", key: "scope", value: scope, action: "scope", disabled: busy, options: [{ value: "global", label: "Global · all projects" }, { value: "project", label: "Project · shared with its tasks" }] },
      { type: "textInput", key: "filter", ...filterInput, value: query, placeholder: "Find skills, agents or files…", changeAction: "filter" }
    ];
    if (error) children.push({ type: "status", key: "error", text: error, level: "error" });
    if (form) children.push({ type: "column", key: "create", gap: 8, padding: 10, border: true, children: [
      label("ct", form === "details" ? "Edit details" : "New Library entry"),
      { type: "select", key: "kind", value: kind, action: "kind", disabled: form === "details", options: [{ value: "skill", label: "Skill · SKILL.md" }, { value: "agent", label: "Agent instructions · AGENT.md" }] },
      { type: "textInput", key: "name", value: name, placeholder: "Name", changeAction: "name", submitAction: "create" },
      { type: "textInput", key: "description", value: description, placeholder: "When should this be used?", changeAction: "description" },
      { type: "row", key: "create-actions", gap: 6, children: [
        { type: "button", key: "create", text: form === "details" ? "Save details" : "Create", action: "create", small: true, disabled: busy || !name.trim() },
        btn("cancel", "Cancel", "cancelCreate")
      ] }
    ] });
    const tree = rows();
    if (tree.length) children.push({ type: "tree", key: "entries", rows: tree, selectAction: "select", expandAction: "expand", grow: true, rowHeight: 28 });
    else children.push({ type: "column", key: "empty", padding: 20, gap: 10, grow: true, children: [
      label("empty-title", scope === "project" && !workspaceId ? "Select a project to open its Library" : entries.length ? "Nothing matches your filter" : "Your Library is empty"),
      ...entries.length ? [] : [label("empty-hint", "Create a skill (SKILL.md) or agent (AGENT.md), then add Markdown references and .sh scripts. Files open in the editor.", true)]
    ] });
    if (entry) children.push(...entryActions(entry));
    if (!workspaceId) children.push(label("no-workspace", "Select a project or task to open Library files in the editor.", true));
    children.push(label("footer", "Agents read these files on demand through Library MCP tools. Scripts are stored as text and never run automatically.", true));
    return { type: "column", key: "library", grow: true, padding: 12, gap: 8, children };
  },
  async onEvent(ctx, ev) {
    if (busy) return;
    error = "";
    try {
      const action = ev.action, value = ev.value;
      const text = String(value ?? "");
      if (ev.inputs?.name !== void 0) name = ev.inputs.name;
      if (ev.inputs?.description !== void 0) description = ev.inputs.description;
      if (ev.inputs?.newPath !== void 0) newPath = ev.inputs.newPath;
      const entry = selected();
      if (typeof value === "string" && ["openRoot", "startAdd", "details", "askRemove"].includes(action) && entries.some((e) => e.id === value)) {
        if (selectedId !== value) {
          selectedId = value;
          selectedFile = null;
          confirmRemove = adding = false;
          confirmDeleteFile = null;
        }
      }
      if (["openFile", "askDeleteFile"].includes(action) && ev.rowKey?.startsWith("file:")) {
        const [, id] = ev.rowKey.split(":");
        selectedId = id;
      }
      const current = selected();
      if (action === "filter") query = text;
      else if (action === "name") name = text;
      else if (action === "description") description = text;
      else if (action === "kind") kind = text === "agent" ? "agent" : "skill";
      else if (action === "newPath") newPath = text;
      else if (action === "details" && current) {
        form = "details";
        name = current.name;
        description = current.description;
        kind = current.kind;
      } else if (action === "new") {
        form = "new";
        name = description = "";
      } else if (action === "cancelCreate") form = null;
      else if (action === "startAdd" && current) {
        adding = true;
        confirmRemove = false;
        confirmDeleteFile = null;
        expanded.add(current.id);
      } else if (action === "cancelAdd") {
        adding = false;
        newPath = "";
      } else if (action === "askRemove" && current) {
        confirmRemove = true;
        adding = false;
        confirmDeleteFile = null;
      } else if (action === "cancelRemove") confirmRemove = false;
      else if (action === "askDeleteFile" && current && text !== rootOf(current.kind)) {
        confirmDeleteFile = text;
        confirmRemove = adding = false;
      } else if (action === "cancelDeleteFile") confirmDeleteFile = null;
      else if (action === "expand") {
        const id = ev.rowKey || text;
        const set = id.startsWith("dir:") ? collapsedDirs : expanded, present = set.has(id);
        if (present) set.delete(id);
        else set.add(id);
      } else {
        busy = true;
        ctx.ui.invalidate();
        if (action === "scope") {
          scope = text === "project" ? "project" : "global";
          selectedId = selectedFile = null;
          confirmRemove = adding = false;
          await refresh(ctx);
        } else if (action === "refresh") await refresh(ctx);
        else if (action === "select") {
          const key = ev.rowKey || text;
          if (key.startsWith("file:")) {
            const [, id, ...rest] = key.split(":");
            await openFile(ctx, id, rest.join(":"));
          } else if (key.startsWith("dir:")) {
            if (collapsedDirs.has(key)) collapsedDirs.delete(key);
            else collapsedDirs.add(key);
          } else {
            const target = entries.find((e) => e.id === key);
            if (target) {
              if (selectedId !== key) {
                confirmRemove = adding = false;
                confirmDeleteFile = null;
              }
              expanded.add(key);
              selectedId = key;
              selectedFile = null;
              if (workspaceId) {
                await openFile(ctx, key, rootOf(target.kind));
                selectedFile = null;
              }
            }
          }
        } else if (action === "openRoot" && current) await openFile(ctx, current.id, rootOf(current.kind));
        else if (action === "openFile" && current) await openFile(ctx, current.id, text);
        else if (action === "create") {
          const saved = await ctx.modules.call("library", "save", {
            ...args(),
            name,
            description,
            kind,
            ...form === "details" && entry ? { id: entry.id, expectedRevision: entry.revision } : { expectedRevision: null }
          });
          const created = form === "new";
          form = null;
          selectedId = saved.id;
          expanded.add(saved.id);
          await refresh(ctx);
          if (created && workspaceId) await openFile(ctx, saved.id, rootOf(saved.kind));
        } else if (action === "addFile" && entry) {
          const path = newPath.trim();
          if (entry.paths.includes(path)) throw new Error("That file already exists");
          await ctx.modules.call("library", "save", { ...args(), id: entry.id, path, content: path.endsWith(".sh") ? "#!/bin/sh\nset -eu\n\n" : `# ${path.split("/").pop().replace(/\.md$/, "")}

`, expectedRevision: entry.revision });
          adding = false;
          newPath = "";
          await refresh(ctx);
          if (workspaceId) await openFile(ctx, entry.id, path);
        } else if (action === "deleteFile" && entry && confirmDeleteFile) {
          await ctx.modules.call("library", "save", { ...args(), id: entry.id, path: confirmDeleteFile, content: null, expectedRevision: entry.revision });
          if (selectedFile === confirmDeleteFile) selectedFile = null;
          confirmDeleteFile = null;
          await refresh(ctx);
        } else if (action === "remove" && entry) {
          await ctx.modules.call("library", "remove", { ...args(), id: entry.id, expectedRevision: entry.revision });
          selectedId = selectedFile = null;
          confirmRemove = false;
          await refresh(ctx);
        }
      }
    } catch (e) {
      error = errMsg(e);
    } finally {
      busy = false;
      ctx.ui.invalidate();
    }
  }
};
var index_default = mod;
export {
  index_default as default
};
