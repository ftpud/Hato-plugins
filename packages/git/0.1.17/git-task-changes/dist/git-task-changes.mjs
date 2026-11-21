// ../sdk/runtime.ts
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

// modules/ui/git-panel/src/model.ts
var LETTER = { modified: "M", added: "A", deleted: "D", renamed: "R", copied: "C", untracked: "U", conflicted: "!", typechange: "T" };
var COLOR = { added: "success", untracked: "success", deleted: "warning", conflicted: "warning", renamed: "accent", copied: "accent", modified: "accent", typechange: "accent" };
var LABEL = { modified: "Modified", added: "Added", deleted: "Deleted", renamed: "Renamed", copied: "Copied", untracked: "Untracked", conflicted: "Conflicted", typechange: "Type changed" };
var CHANGE_ROW_HEIGHT = 28;
var changeGroups = (files) => [
  { title: "Changes", files: files.filter((f) => f.kind !== "untracked") },
  { title: "Untracked", files: files.filter((f) => f.kind === "untracked") }
];
function changeBadge(c) {
  const counts = c.binary ? "bin" : [c.additions ? `+${c.additions}` : "", c.deletions ? `−${c.deletions}` : ""].filter(Boolean).join(" ");
  return [LETTER[c.kind] || "?", counts].filter(Boolean).join(" ");
}
function changeFileRow(c, selected2 = null) {
  const at = c.path.lastIndexOf("/");
  const status = LABEL[c.kind] || c.kind;
  return {
    key: c.path,
    label: c.path.slice(at + 1),
    depth: 0,
    expandable: false,
    expanded: false,
    selected: c.path === selected2,
    badge: changeBadge(c),
    detail: at < 0 ? void 0 : c.path.slice(0, at),
    tooltip: c.origPath ? `${c.origPath} → ${c.path}` : `${status} · ${c.path}`,
    iconSvg: fileIcons.file,
    iconColor: COLOR[c.kind] || "muted"
  };
}

// modules/ui/git-task-changes/src/index.ts
var visible = false;
var ws;
var result = null;
var selected = null;
var error = "";
var loading = false;
var epoch = 0;
var dirty = false;
var navigation = Promise.resolve();
async function refresh(ctx) {
  if (!visible || !ws?.id?.startsWith("task:")) return;
  if (loading) {
    dirty = true;
    return;
  }
  const mine = epoch, id = ws.id;
  loading = true;
  dirty = false;
  try {
    const r = await ctx.modules.call("git", "taskChanges", { workspaceId: id });
    if (mine !== epoch) return;
    result = r;
    error = "";
    if (!result?.files.some((f) => f.path === selected)) selected = null;
  } catch (e) {
    if (mine === epoch) error = errMsg(e);
  } finally {
    if (mine === epoch) {
      loading = false;
      if (dirty) void refresh(ctx);
    }
    ctx.ui.invalidate();
  }
}
var mod = {
  id: "git-task-changes",
  moduleApiVersion: 1,
  async activate(ctx) {
    visible = !!ctx.state.get("workspace-layout.panels")?.["git-task-changes"];
    ctx.state.watch("workspace-layout.panels", (v) => {
      const next = !!v?.["git-task-changes"];
      if (next === visible) return;
      visible = next;
      if (visible) void refresh(ctx);
    });
    ws = ctx.state.get("workspace.selected");
    ctx.state.watch("workspace.selected", (v) => {
      if (v?.id === ws?.id) return;
      ws = v;
      epoch++;
      loading = false;
      result = null;
      selected = null;
      error = "";
      void refresh(ctx);
      ctx.ui.invalidate();
    });
    ctx.events.on("git.changed", (v) => {
      if (v.workspaceId === ws?.id) void refresh(ctx);
    });
    await refresh(ctx);
  },
  deactivate() {
    epoch++;
  },
  render() {
    if (!ws?.id?.startsWith("task:")) return { type: "label", key: "select", text: "Select a task to review changes since its creation.", color: "muted", padding: 12, wrap: true };
    const children = [
      { type: "row", key: "tools", gap: 6, children: [
        { type: "label", key: "summary", text: result?.base ? `${result.files.length} files · since ${result.base.slice(0, 8)} · includes commits` : "Changes since task creation", grow: true, size: "xs", color: "muted" },
        { type: "button", key: "refresh", text: "", iconSvg: uiIcons.refresh, action: "refresh", small: true, variant: "ghost", disabled: loading, tooltip: "Refresh now" }
      ] }
    ];
    if (error) children.push({ type: "status", key: "error", text: error, level: "error" });
    if (result && !result.base) children.push(
      { type: "label", key: "legacy", text: result.message || "Set a starting commit to compare.", wrap: true, color: "muted", size: "sm" },
      { type: "textInput", key: "baseline", placeholder: "Full starting commit ID" },
      { type: "button", key: "setBase", text: "Set fixed baseline", action: "setBase", small: true }
    );
    if (result?.base) {
      const rows = changeGroups(result.files.slice(0, 5e3)).filter((group) => group.files.length).flatMap(({ title, files }) => [
        { key: "", label: `${title} · ${files.length}`, depth: 0, expandable: false, expanded: false, selected: false, weight: "semibold" },
        ...files.map((file) => changeFileRow(file, selected))
      ]);
      children.push(rows.length ? { type: "tree", key: `files:${ws.id}`, rows, selectAction: "compare", activateAction: "open", expandAction: "", rowHeight: CHANGE_ROW_HEIGHT, rowGap: 3, grow: true } : { type: "label", key: "empty", text: "No changes since task creation.", color: "muted", padding: 12 });
    }
    return { type: "column", key: "root", padding: 8, gap: 8, grow: true, children };
  },
  async onEvent(ctx, ev) {
    const mine = epoch, id = ws?.id;
    try {
      if (ev.action === "refresh") await refresh(ctx);
      else if (ev.action === "setBase") {
        await ctx.modules.call("git", "setTaskBase", { workspaceId: id, id: ev.inputs.baseline?.trim() });
        if (mine === epoch) await refresh(ctx);
      } else if (ev.action === "compare" || ev.action === "open") {
        const file = result?.files.find((f) => f.path === ev.rowKey);
        if (!file || !result?.base || !id) return;
        selected = file.path;
        error = "";
        ctx.ui.invalidate();
        const edit = ev.action === "open" && file.kind !== "deleted";
        const next = navigation.then(async () => {
          if (mine === epoch) await ctx.modules.call("git", "previewTaskFile", { workspaceId: id, path: file.path, edit });
        });
        navigation = next.catch(() => {
        });
        await next;
      }
    } catch (e) {
      if (mine === epoch) error = errMsg(e);
    }
    ctx.ui.invalidate();
  }
};
var index_default = mod;
export {
  index_default as default
};
