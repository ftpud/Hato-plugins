// ../sdk/runtime.ts
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

// modules/ui/git-panel/src/model.ts
var LETTER = { modified: "M", added: "A", deleted: "D", renamed: "R", copied: "C", untracked: "U", conflicted: "!", typechange: "T" };
var COLOR = { added: "success", untracked: "success", deleted: "warning", conflicted: "warning", renamed: "accent", copied: "accent", modified: "accent", typechange: "accent" };
var LABEL = { modified: "Modified", added: "Added", deleted: "Deleted", renamed: "Renamed", copied: "Copied", untracked: "Untracked", conflicted: "Conflicted", typechange: "Type changed" };
function changeBadge(c) {
  const counts = c.binary ? "bin" : [c.additions ? `+${c.additions}` : "", c.deletions ? `−${c.deletions}` : ""].filter(Boolean).join(" ");
  return [LETTER[c.kind] || "?", counts].filter(Boolean).join(" ");
}
function changeRows(changes, selected2) {
  return changes.slice(0, 5e3).map((c) => {
    const at = c.path.lastIndexOf("/");
    const dir = at < 0 ? "" : c.path.slice(0, at);
    const state = [LABEL[c.kind] || c.kind, c.staged && c.unstaged ? "partly staged" : c.staged ? "staged" : ""].filter(Boolean).join(", ");
    return {
      key: c.path,
      label: c.path.slice(at + 1),
      depth: 0,
      expandable: false,
      expanded: false,
      selected: c.path === selected2,
      badge: changeBadge(c),
      detail: [c.origPath ? `from ${c.origPath}` : dir, state].filter(Boolean).join(" · "),
      iconSvg: fileIcons.file,
      iconColor: COLOR[c.kind] || "muted"
    };
  });
}

// modules/ui/git-task-changes/src/index.ts
var visible = false;
var ws;
var result = null;
var comparison = null;
var selected = null;
var error = "";
var loading = false;
var epoch = 0;
var dirty = false;
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
    if (selected && r.files.some((f) => f.path === selected)) {
      const path = selected;
      const diff = await ctx.modules.call("git", "diff", { workspaceId: id, path, base: r.base });
      if (mine === epoch && path === selected) comparison = diff;
    } else {
      comparison = null;
      selected = null;
    }
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
      result = comparison = null;
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
        { type: "button", key: "refresh", text: "Refresh", action: "refresh", small: true, disabled: loading }
      ] }
    ];
    if (error) children.push({ type: "status", key: "error", text: error, level: "error" });
    if (result && !result.base) children.push(
      { type: "label", key: "legacy", text: result.message, wrap: true, color: "muted", size: "sm" },
      { type: "textInput", key: "baseline", placeholder: "Full starting commit ID" },
      { type: "button", key: "setBase", text: "Set fixed baseline", action: "setBase", small: true }
    );
    if (result?.base) children.push({ type: "split", key: "review", direction: "vertical", sizes: [0.35, 0.65], grow: true, children: [
      { type: "tree", key: "files", rows: changeRows(result.files, selected), selectAction: "compare", expandAction: "expand", rowHeight: 42, grow: true },
      { type: "diff", key: "diff", document: comparison?.document || null, mode: "split", softWrap: true, grow: true, placeholder: selected ? "Loading comparison…" : result.files.length ? "Select a file to compare." : "No changes since task creation.", changeNavigation: { previous: "Previous change", next: "Next change" } }
    ] });
    return { type: "column", key: "root", padding: 8, gap: 8, grow: true, children };
  },
  async onEvent(ctx, ev) {
    const mine = epoch, id = ws?.id;
    try {
      if (ev.action === "refresh") await refresh(ctx);
      else if (ev.action === "setBase") {
        await ctx.modules.call("git", "setTaskBase", { workspaceId: id, id: ev.inputs.baseline?.trim() });
        if (mine === epoch) await refresh(ctx);
      } else if (ev.action === "compare") {
        selected = ev.rowKey || null;
        comparison = null;
        ctx.ui.invalidate();
        const path = selected;
        const r = await ctx.modules.call("git", "diff", { workspaceId: id, path, base: result.base });
        if (mine === epoch && path === selected) comparison = r;
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
