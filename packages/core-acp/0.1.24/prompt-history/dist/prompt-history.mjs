// ../sdk/prompt-history.ts
var PROMPT_CHARS = 600;
function promptTurns(messages, base2) {
  const out = [];
  let current = null;
  let byPath = /* @__PURE__ */ new Map();
  for (const m of messages) {
    if (m.role === "user") {
      const prompt = String(m.text || "").trim();
      if (!prompt) continue;
      current = { ...base2, id: `${base2.source}:${base2.sessionId}:${m.key}`, prompt: prompt.slice(0, PROMPT_CHARS), at: m.at ?? null, files: [] };
      byPath = /* @__PURE__ */ new Map();
      out.push(current);
      continue;
    }
    if (!current || !Array.isArray(m.diffs)) continue;
    for (const d of m.diffs) {
      if (!d || typeof d.path !== "string") continue;
      let file = byPath.get(d.path);
      if (!file) {
        file = { path: d.path, added: 0, removed: 0, edits: [], ...d.newFile ? { newFile: true } : {} };
        byPath.set(d.path, file);
        current.files.push(file);
      }
      file.added += Number(d.added) || 0;
      file.removed += Number(d.removed) || 0;
      if (d.truncated) file.truncated = true;
      file.edits.push(d);
    }
  }
  return out;
}
function mergePromptEntries(lists) {
  return lists.flat().map((e, i) => ({ e, i })).sort((a, b) => (b.e.updatedAt ?? b.e.at ?? -1) - (a.e.updatedAt ?? a.e.at ?? -1) || a.i - b.i).map((x) => x.e);
}
function relativePromptPath(path, root) {
  const r = root?.replace(/\/+$/, "");
  return r && path.startsWith(r + "/") ? path.slice(r.length + 1) : path;
}
function promptPatch(files, root) {
  const out = [];
  for (const f of files) {
    const p = relativePromptPath(f.path, root);
    f.edits.forEach((d, i) => {
      if (!d.lines.length) return;
      const created = i === 0 && !!d.newFile;
      out.push(`diff --git a/${p} b/${p}`, ...d.deletedFile ? ["deleted file mode 100644"] : [], ...created ? ["new file mode 100644", "--- /dev/null"] : [`--- a/${p}`], d.deletedFile ? "+++ /dev/null" : `+++ b/${p}`, ...d.lines);
    });
  }
  return out.length ? out.join("\n") + "\n" : "";
}
function promptAge(at, now = Date.now()) {
  if (at == null || !Number.isFinite(at)) return "";
  const s = Math.max(0, (now - at) / 1e3);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(at).toLocaleDateString();
}

// ../sdk/change-capture.ts
var CAPTURE_SETTING = "files.changesEnabled";
var CAPTURE_STATE = "files.changeCapture";
var captureEnabled = (ctx) => ctx.state.get(CAPTURE_SETTING) !== false;
function capturedChanges(ctx, workspaceId) {
  const state = ctx.state.get(CAPTURE_STATE);
  return captureEnabled(ctx) && state?.workspaceId === workspaceId ? state.records : [];
}
function capturedEntries(records, entries2 = []) {
  const merged = new Map(entries2.map((entry) => [entry.id, entry]));
  const groups = /* @__PURE__ */ new Map();
  for (const record of records) {
    const owner = record.owner;
    const id = owner ? owner.source + ":" + owner.sessionId + ":" + owner.key : "workspace::" + record.id;
    const group = groups.get(id) || [];
    group.push(record);
    groups.set(id, group);
  }
  for (const [id, group] of groups) {
    const record = group[0], owner = record.owner, current = merged.get(id);
    const captured = promptTurns([
      { key: owner?.key || record.id, role: "user", text: owner?.prompt || "Project file changes", at: current?.at ?? record.at },
      ...group.map((change) => ({ key: change.id, role: "tool", diffs: change.diffs }))
    ], { source: owner?.source || "workspace", sessionId: owner?.sessionId || "", sessionTitle: current?.sessionTitle || "Project", agent: current?.agent || "File capture" })[0];
    const updatedAt = Math.max(current?.updatedAt ?? current?.at ?? 0, ...group.map((change) => change.at));
    const paths = new Set(captured.files.map((file) => file.path));
    merged.set(id, current ? { ...current, updatedAt, files: [...current.files.filter((file) => !paths.has(file.path)), ...captured.files] } : { ...captured, updatedAt });
  }
  return [...merged.values()];
}

// ../sdk/virtual-documents.ts
var VIRTUAL_TAB_PREFIX = "virtual:";
var virtualTab = (provider, key) => `${VIRTUAL_TAB_PREFIX}${provider}/${key}`;
function parseVirtualTab(tab) {
  if (!tab || !tab.startsWith(VIRTUAL_TAB_PREFIX)) return null;
  const rest = tab.slice(VIRTUAL_TAB_PREFIX.length), slash = rest.indexOf("/");
  if (slash <= 0 || slash === rest.length - 1) return null;
  return { provider: rest.slice(0, slash), key: rest.slice(slash + 1) };
}

// ../sdk/filter-style.ts
var filterInput = { height: 32, style: { noShrink: true } };

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
  cloud: outline("<path d='M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z'/>"),
  "cloud-off": outline("<path d='m2 2 20 20M5.78 5.78A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.31-.2M21.53 16.05A4.5 4.5 0 0 0 17.5 10h-1.79A7 7 0 0 0 10.2 5.1'/>"),
  "shield-alert": outline("<path d='M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1Z'/><path d='M12 8v4M12 16h.01'/>"),
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

// modules/ui/prompt-history/src/index.ts
var PANEL = "prompt-history";
var PAGE = 400;
var MAX_PAGE = 3e3;
var svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
var icons = {
  chat: svg("<path d='M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z'/>"),
  agent: svg("<rect x='5' y='8' width='14' height='11' rx='3'/><path d='M12 4v4M9 13h.01M15 13h.01M9.5 16.5h5'/>"),
  chevron: svg("<path d='m9 6 6 6-6 6'/>"),
  diff: svg("<path d='M12 3v6m-3-3h6M9 17h6M5 3h14v18H5z'/>"),
  open: svg("<path d='M14 4h6v6M20 4l-9 9M18 14v6H4V6h6'/>")
};
var ctxForCapture = null;
var ws = null;
var visible = false;
var entries = [];
var agentNote = null;
var error = null;
var loading = false;
var epoch = 0;
var stale = false;
var showLoading = false;
var messageLimit = PAGE;
var query = "";
var changesOnly = true;
var expanded = /* @__PURE__ */ new Set();
var tabs = /* @__PURE__ */ new Map();
var hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
};
var base = (p) => p.slice(p.lastIndexOf("/") + 1);
var indented = (key, px, child) => ({ type: "row", key, gap: 0, align: "stretch", children: [
  { type: "column", key: "indent", width: px, style: { noShrink: true }, children: [] },
  { ...child, grow: true }
] });
var firstLine = (s) => s.split("\n").find((l) => l.trim())?.trim() || s.trim();
async function refresh(ctx, background = false) {
  if (!captureEnabled(ctx) || !visible || !ws?.id) return;
  if (loading) {
    stale = true;
    return;
  }
  const mine = ++epoch, workspaceId = ws.id;
  const before = JSON.stringify([entries, agentNote, error]);
  loading = true;
  stale = false;
  showLoading = !background;
  if (showLoading) ctx.ui.invalidate();
  try {
    const [chats, agents] = await Promise.allSettled([
      ctx.modules.call("ai-sessions", "promptHistory", { workspaceId, messageLimit }, { timeoutMs: 6e4 }),
      ctx.modules.call("persistent-agents", "promptHistory", { workspaceId, messageLimit: Math.min(messageLimit, 200) }, { timeoutMs: 6e4 })
    ]);
    if (mine !== epoch) return;
    if (chats.status === "rejected") throw chats.reason;
    entries = mergePromptEntries([capturedEntries(capturedChanges(ctx, workspaceId), [...chats.value?.entries || [], ...agents.status === "fulfilled" ? agents.value?.entries || [] : []])]);
    agentNote = agents.status === "rejected" ? `Background agents unavailable: ${errMsg(agents.reason)}` : null;
    error = null;
  } catch (e) {
    if (mine === epoch) error = errMsg(e);
  } finally {
    if (mine === epoch) {
      const changed = before !== JSON.stringify([entries, agentNote, error]);
      const wasShowingLoading = showLoading;
      loading = false;
      showLoading = false;
      if (changed || wasShowingLoading) ctx.ui.invalidate();
      if (stale) void refresh(ctx, true);
    }
  }
}
async function showDiff(ctx, entry, files, reveal = true) {
  if (!ws) return;
  const workspaceId = ws.id, root = ws.rootAbsolutePath;
  const patch = promptPatch(files, root);
  if (!patch) {
    ctx.host.ui.toast("info", "No line changes were recorded for this edit.");
    return;
  }
  const name = files.length === 1 ? base(files[0].path) : "changes";
  const tab = virtualTab(PANEL, `${hash(entry.id)}/${files.length === 1 ? hash(files[0].path) + "/" : ""}${name}.diff`);
  const title = `${files.length === 1 ? relativePromptPath(files[0].path, root) : `${files.length} files`} · “${firstLine(entry.prompt).slice(0, 60)}”`;
  tabs.set(tab, { workspaceId, title, patch });
  if (tabs.size > 100) tabs.delete(tabs.keys().next().value);
  await present(ctx, tab, reveal);
}
async function present(ctx, tab, reveal) {
  const t = tabs.get(tab);
  if (!t) return;
  const document = await ctx.host.ui.documentOpen(t.workspaceId, t.patch, "diff", { path: tab.slice(tab.lastIndexOf("/") + 1) });
  await ctx.modules.call("viewer", "virtual.show", { workspaceId: t.workspaceId, tab, title: t.title, document, diff: true, editable: false, reveal });
}
var matches = (e, q) => !q || e.prompt.toLowerCase().includes(q) || e.sessionTitle.toLowerCase().includes(q) || e.agent.toLowerCase().includes(q) || e.files.some((f) => f.path.toLowerCase().includes(q));
function counts(added, removed) {
  return [
    { type: "label", key: "add", text: `+${added}`, size: "xs", color: "success", mono: true },
    { type: "label", key: "del", text: `−${removed}`, size: "xs", color: "danger", mono: true }
  ];
}
function fileRow(entry, f) {
  const rel = relativePromptPath(f.path, ws?.rootAbsolutePath), slash = rel.lastIndexOf("/");
  return {
    type: "row",
    key: `file:${f.path}`,
    gap: 6,
    align: "center",
    action: "openFile",
    value: `${entry.id}
${f.path}`,
    hoverStyle: { background: "hover" },
    tooltip: `${rel}${f.edits.length > 1 ? ` · ${f.edits.length} edits` : ""}${f.truncated ? " · partly recorded" : ""}
Open the change`,
    style: { height: 24, radius: 6, paddingX: 6 },
    children: [
      { type: "icon", key: "i", svg: icons.diff, size: 13, color: "faint" },
      { type: "label", key: "name", text: slash >= 0 ? rel.slice(slash + 1) : rel, size: "xs", color: "text", style: { noShrink: true } },
      { type: "label", key: "dir", text: slash > 0 ? rel.slice(0, slash) : "", size: "xs", color: "faint", grow: true },
      ...f.newFile ? [{ type: "label", key: "new", text: "new", size: "xs", color: "faint" }] : [],
      ...counts(f.added, f.removed)
    ]
  };
}
function entryNode(e) {
  const open = expanded.has(e.id);
  const added = e.files.reduce((n, f) => n + f.added, 0), removed = e.files.reduce((n, f) => n + f.removed, 0);
  const age = promptAge(e.updatedAt ?? e.at) || "Time unavailable";
  const head = {
    type: "row",
    key: "head",
    gap: 8,
    align: "center",
    action: "toggle",
    value: e.id,
    hoverStyle: { background: "hover" },
    tooltip: open ? "Collapse" : e.files.length ? "Show changed files" : "Show prompt",
    style: { radius: 7, paddingX: 6, paddingY: 5 },
    children: [
      { type: "icon", key: "chev", svg: icons.chevron, size: 12, color: "faint", style: { rotate: open ? 90 : 0 } },
      { type: "column", key: "text", gap: 2, grow: true, minWidth: 0, children: [
        { type: "label", key: "prompt", text: firstLine(e.prompt), size: "sm", color: "text" },
        { type: "row", key: "meta", gap: 5, align: "center", children: [
          { type: "icon", key: "src", svg: e.source === "agent" ? icons.agent : icons.chat, size: 11, color: "faint" },
          { type: "label", key: "who", text: `${e.agent} · ${e.sessionTitle}`, size: "xs", color: "faint", grow: true },
          ...age ? [{ type: "label", key: "age", text: age, size: "xs", color: "faint", mono: true }] : []
        ] }
      ] },
      ...e.files.length ? [{ type: "column", key: "sum", gap: 1, align: "end", style: { noShrink: true }, children: [
        { type: "label", key: "n", text: `${e.files.length} file${e.files.length === 1 ? "" : "s"}`, size: "xs", color: "muted" },
        { type: "row", key: "c", gap: 4, children: counts(added, removed) }
      ] }] : []
    ]
  };
  const body = open ? [
    ...e.prompt.includes("\n") || e.prompt.length > 80 ? [{ type: "label", key: "full", text: e.prompt, size: "xs", color: "muted", wrap: true, selectable: true, style: { paddingX: 26, paddingY: 2 } }] : [],
    ...e.files.length ? [indented("files", 20, { type: "column", key: "list", gap: 0, children: e.files.map((f) => fileRow(e, f)) })] : [{ type: "label", key: "none", text: "No file changes recorded for this prompt.", size: "xs", color: "faint", style: { paddingX: 26 } }],
    indented("actions", 22, { type: "row", key: "buttons", gap: 4, style: { paddingY: 2 }, children: [
      ...e.files.length ? [{ type: "button", key: "all", text: "Review all", iconSvg: icons.diff, action: "reviewAll", value: e.id, small: true, variant: "ghost", tooltip: "Open every change from this prompt in one diff" }] : [],
      ...e.source === "workspace" ? [] : [{ type: "button", key: "chat", text: e.source === "agent" ? "Open agent" : "Open chat", iconSvg: icons.open, action: "openChat", value: e.id, small: true, variant: "ghost" }]
    ] })
  ] : [];
  return { type: "column", key: e.id, gap: 2, style: { radius: 8, ...open ? { background: "surface", paddingY: 2 } : {} }, children: [head, ...body] };
}
var mod = {
  id: PANEL,
  moduleApiVersion: 1,
  async activate(ctx) {
    ctxForCapture = ctx;
    ws = ctx.state.get("workspace.selected") || null;
    visible = !!ctx.state.get("workspace-layout.panels")?.[PANEL];
    ctx.events.on("files.changeCaptured", () => {
      if (visible) void refresh(ctx, true);
    });
    ctx.state.watch("files.changesEnabled", () => {
      if (!captureEnabled(ctx)) {
        epoch++;
        loading = false;
        showLoading = false;
        entries = [];
      } else void refresh(ctx);
      ctx.ui.invalidate();
    });
    const soon = debounce(() => {
      void refresh(ctx, true);
    }, 1500);
    ctx.state.watch("workspace-layout.panels", (v) => {
      const next = !!v?.[PANEL];
      if (next === visible) return;
      visible = next;
      if (visible) void refresh(ctx);
    });
    ctx.state.watch("workspace.selected", (v) => {
      if (v?.id === ws?.id) {
        ws = v;
        return;
      }
      ws = v;
      epoch++;
      loading = false;
      showLoading = false;
      entries = [];
      expanded.clear();
      error = null;
      agentNote = null;
      messageLimit = PAGE;
      ctx.ui.invalidate();
      void refresh(ctx);
    });
    ctx.events.on("ai-sessions.changed", () => {
      if (visible) soon();
    });
    ctx.events.on("persistent-agents.changed", (e) => {
      if (visible && (!e?.workspaceId || e.workspaceId === ws?.id)) soon();
    });
    ctx.events.on("viewer.virtualRequest", (e) => {
      if (parseVirtualTab(e?.tab)?.provider !== PANEL) return;
      if (tabs.has(e.tab)) {
        void present(ctx, e.tab, false).catch((err) => ctx.log.warn(errMsg(err)));
        return;
      }
      void ctx.modules.call("viewer", "virtual.show", {
        workspaceId: e.workspaceId,
        tab: e.tab,
        title: "Prompt change",
        reveal: false,
        editable: false,
        error: "This change is no longer loaded. Open it again from Prompt history."
      }).catch(() => {
      });
    });
    ctx.events.on("viewer.virtualClosed", (e) => {
      if (parseVirtualTab(e?.tab)?.provider === PANEL) tabs.delete(e.tab);
    });
    await refresh(ctx);
  },
  deactivate() {
    epoch++;
  },
  render() {
    if (!ws) return { type: "label", key: "none", text: "Select a project to see its prompts.", color: "muted", padding: 12, wrap: true };
    const q = query.trim().toLowerCase();
    const shown = entries.filter((e) => (!changesOnly || e.files.length) && matches(e, q));
    const kids = [
      { type: "row", key: "tools", gap: 4, align: "center", children: [
        { type: "textInput", key: "filter", ...filterInput, value: query, placeholder: "Search prompts or files", prefixSvg: uiIcons.search, changeAction: "filter", grow: true },
        {
          type: "button",
          key: "changes",
          text: "Changes only",
          small: true,
          variant: changesOnly ? "primary" : "ghost",
          action: "changesOnly",
          value: !changesOnly,
          tooltip: changesOnly ? "Showing prompts that changed files — click to show every prompt" : "Show only prompts that changed files"
        },
        { type: "button", key: "refresh", text: "", iconSvg: uiIcons.refresh, action: "refresh", small: true, variant: "ghost", disabled: showLoading, tooltip: "Refresh" }
      ] }
    ];
    const capture = ctxForCapture?.state.get(CAPTURE_STATE);
    if (capture?.workspaceId === ws.id && capture.warning) kids.push({ type: "label", key: "capture-warning", text: capture.warning, size: "xs", color: "muted", wrap: true });
    if (error) kids.push({ type: "status", key: "error", text: error, level: "error" });
    if (agentNote) kids.push({ type: "label", key: "agents", text: agentNote, size: "xs", color: "faint", wrap: true });
    if (showLoading && !entries.length) kids.push({ type: "progress", key: "loading", indeterminate: true });
    if (!loading && !error && !shown.length) kids.push({
      type: "label",
      key: "empty",
      wrap: true,
      size: "sm",
      color: "muted",
      style: { padding: 12 },
      text: q ? "No prompts match." : changesOnly && entries.length ? "No prompt in the loaded history changed files. File changes are recorded for edits made with inline diffs available." : "No prompts in this project yet."
    });
    kids.push({ type: "column", key: "list", gap: 2, grow: true, scroll: true, children: [
      ...shown.map(entryNode),
      ...entries.length && messageLimit < MAX_PAGE ? [{ type: "button", key: "more", text: showLoading ? "Loading…" : "Load older prompts", action: "more", small: true, variant: "ghost", disabled: showLoading, style: { fullWidth: true } }] : []
    ] });
    return { type: "column", key: "prompt-history", gap: 6, padding: 8, grow: true, children: kids };
  },
  async onEvent(ctx, ev) {
    const find = (id) => entries.find((e) => e.id === id);
    try {
      switch (ev.action) {
        case "filter":
          query = String(ev.value || "");
          break;
        case "changesOnly":
          changesOnly = !!ev.value;
          break;
        case "refresh":
          void refresh(ctx);
          break;
        case "more":
          messageLimit = Math.min(MAX_PAGE, messageLimit * 2);
          void refresh(ctx);
          break;
        case "toggle": {
          const id = String(ev.value);
          if (expanded.has(id)) expanded.delete(id);
          else expanded.add(id);
          break;
        }
        case "openFile": {
          const [id, path] = String(ev.value || "").split("\n");
          const e = find(id), f = e?.files.find((x) => x.path === path);
          if (e && f) await showDiff(ctx, e, [f]);
          break;
        }
        case "reviewAll": {
          const e = find(ev.value);
          if (e) await showDiff(ctx, e, e.files);
          break;
        }
        case "openChat": {
          const e = find(ev.value);
          if (e && ws) ctx.events.emit(`${PANEL}.openChat`, e.source === "agent" ? { workspaceId: ws.id, agentId: e.sessionId } : { workspaceId: ws.id, conversationId: e.sessionId });
          break;
        }
      }
    } catch (e) {
      ctx.host.ui.toast("error", errMsg(e));
    }
    ctx.ui.invalidate();
  }
};
var index_default = mod;
export {
  index_default as default
};
