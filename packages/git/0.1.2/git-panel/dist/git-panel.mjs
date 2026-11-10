// ../sdk/runtime.ts
function errMsg(e) {
  return e && (e.message || String(e)) || "unknown error";
}

// ../sdk/git.ts
var DIFF_TAB_PREFIX = "git-diff:";
var diffTab = (path) => DIFF_TAB_PREFIX + path;
var diffTabPath = (tab) => tab && tab.startsWith(DIFF_TAB_PREFIX) ? tab.slice(DIFF_TAB_PREFIX.length) : null;

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

// ../sdk/settings.ts
function exportSettings(ctx, getSections, onChange, options = {}) {
  const publish = (error2 = null) => {
    const value = { sections: getSections(), error: error2, ...options.reset ? { resetLabel: options.reset.label } : {} };
    ctx.state.set(`${ctx.moduleId}.settings`, value);
  };
  let queue = Promise.resolve();
  ctx.events.on("settings.change", (edit) => {
    if (edit?.module !== ctx.moduleId) return;
    queue = queue.then(async () => {
      try {
        const section = getSections().find((s) => s.key === edit.section);
        const field = section?.fields.find((f) => f.key === edit.key);
        if (!field) throw new Error("Setting is no longer available");
        if (field.type === "order") parseOrder(edit.value, field.items.map((i) => i.id), field.allowSpacers);
        else if (field.type === "toggle" ? typeof edit.value !== "boolean" : typeof edit.value !== "string" || !field.options.some((o) => o.value === edit.value)) {
          throw new Error("Invalid setting value");
        }
        await onChange(section.key, field.key, edit.value);
        publish();
      } catch (e) {
        publish(e instanceof Error ? e.message : String(e));
      }
      if (options.invalidate !== false) ctx.ui.invalidate();
    });
  });
  if (options.reset) ctx.events.on("settings.reset", (event) => {
    if (event?.module !== ctx.moduleId || !options.reset) return;
    queue = queue.then(async () => {
      try {
        await options.reset.run();
        publish();
      } catch (e) {
        publish(e instanceof Error ? e.message : String(e));
      }
      if (options.invalidate !== false) ctx.ui.invalidate();
    });
  });
  publish();
  return publish;
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
function changeRows(changes, selected) {
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
      selected: c.path === selected,
      badge: changeBadge(c),
      detail: [c.origPath ? `from ${c.origPath}` : dir, state].filter(Boolean).join(" · "),
      iconSvg: fileIcons.file,
      iconColor: COLOR[c.kind] || "muted"
    };
  });
}
function signature(r) {
  if (!r) return "";
  return (r.branch || "") + "\n" + (r.files || []).map((c) => `${c.index}${c.worktree} ${c.path} ${c.additions}/${c.deletions}`).join("\n");
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

// modules/ui/git-panel/src/index.ts
var ws = null;
var status = null;
var error = null;
var loading = false;
var visible = false;
var autoRefresh = true;
var dirty = false;
var epoch = 0;
var lastSig = "";
async function refresh(ctx) {
  if (!ws) return;
  if (loading) {
    dirty = true;
    return;
  }
  dirty = false;
  const mine = ++epoch, workspaceId = ws.id;
  loading = true;
  if (!status) ctx.ui.invalidate();
  try {
    const r = await ctx.modules.call("git", "status", { workspaceId }, { timeoutMs: 45e3 });
    if (mine !== epoch || ws?.id !== workspaceId) return;
    error = null;
    const sig = workspaceId + "\n" + signature(r);
    status = r;
    if (sig !== lastSig) {
      lastSig = sig;
      ctx.events.emit("git-panel.statusChanged", { workspaceId });
    }
  } catch (e) {
    if (mine === epoch) error = errMsg(e);
  } finally {
    if (mine === epoch) {
      loading = false;
      if (dirty && visible && autoRefresh) void refresh(ctx);
    }
    ctx.ui.invalidate();
  }
}
async function show(ctx, previewPath) {
  await ctx.modules.call("workspace", "view.patch", { workspaceId: ws.id, patch: { previewPath } });
}
var mod = {
  id: "git-panel",
  moduleApiVersion: 1,
  async activate(ctx, prev) {
    const saved = await ctx.modules.call("persistence", "settings.get", { key: "git-panel.autoRefresh" });
    const old = saved == null ? await ctx.modules.call("persistence", "settings.get", { key: "git-panel.pollSeconds" }) : null;
    autoRefresh = typeof saved === "boolean" ? saved : old !== 0;
    exportSettings(ctx, () => [{ key: "git-panel", title: "Git changes", fields: [
      {
        key: "autoRefresh",
        label: "Automatic refresh",
        type: "toggle",
        value: autoRefresh,
        description: "Refresh Git status when files or repository metadata change."
      }
    ] }], async (_section, key, value) => {
      if (key !== "autoRefresh" || typeof value !== "boolean") throw new Error("Invalid automatic refresh preference");
      await ctx.modules.call("persistence", "settings.set", { key: "git-panel.autoRefresh", value });
      autoRefresh = value;
      if (visible && value) void refresh(ctx);
    });
    ctx.events.on("git.changed", (event) => {
      if (event.workspaceId === ws?.id && autoRefresh) {
        dirty = true;
        if (visible) void refresh(ctx);
      }
    });
    ws = ctx.state.get("workspace.selected") || null;
    if (prev?.status && prev.status.workspaceId === ws?.id) status = prev.status;
    visible = !!ctx.state.get("workspace-layout.panels")?.git;
    ctx.state.watch("workspace-layout.panels", (v) => {
      const next = !!v?.git;
      if (next === visible) return;
      visible = next;
      if (visible) void refresh(ctx);
    });
    ctx.state.watch("workspace.selected", (v) => {
      const changed = ws?.id !== v?.id;
      ws = v;
      if (changed) {
        epoch++;
        loading = false;
        status = null;
        error = null;
        lastSig = "";
        dirty = false;
        void refresh(ctx);
      } else ctx.ui.invalidate();
    });
    await refresh(ctx);
  },
  deactivate() {
    epoch++;
    loading = false;
    dirty = false;
  },
  snapshot: () => ({ status }),
  render() {
    const children = [];
    if (!ws) return { type: "column", key: "git-root", padding: 8, grow: true, children: [{ type: "label", key: "none", text: "Select a project or task.", color: "muted" }] };
    const files = status && status.workspaceId === ws.id ? status.files : [];
    const preview = ws.view?.previewPath || null;
    const selected = diffTabPath(preview) ?? preview;
    const summary = !status ? "Loading…" : !status.repo ? "Not a Git repository" : files.length ? `${files.length} changed ${files.length === 1 ? "file" : "files"}` : "No changes";
    children.push({ type: "row", key: "tools", gap: 4, align: "center", children: [
      { type: "label", key: "branch", text: status?.branch ? `⎇ ${status.branch}` : "", size: "xs", weight: "semibold", tooltip: "Current branch" },
      { type: "label", key: "count", text: summary + (status?.truncated ? " (truncated)" : ""), size: "xs", color: "muted", grow: true },
      { type: "button", key: "refresh", text: "", iconSvg: uiIcons["refresh"], action: "refresh", small: true, variant: "ghost", disabled: loading, tooltip: "Refresh Git status" }
    ] });
    if (error) children.push({ type: "status", key: "err", text: error, level: "error" });
    if (loading && !status) children.push({ type: "progress", key: "loading", indeterminate: true });
    if (status?.repo && files.length) {
      children.push({
        type: "tree",
        key: "changes",
        rows: changeRows(files, selected),
        selectAction: "diff",
        activateAction: "open",
        grow: true,
        rowHeight: 52,
        rowGap: 3,
        iconSize: 18,
        tooltip: "Click to compare with HEAD · double click to open the file"
      });
    }
    return { type: "column", key: "git-root", gap: 4, padding: 8, grow: true, children };
  },
  async onEvent(ctx, ev) {
    if (!ws) return;
    try {
      if (ev.action === "refresh") {
        await refresh(ctx);
        return;
      }
      const change = status?.files.find((c) => c.path === ev.rowKey);
      if (!change) return;
      if (ev.action === "diff") await show(ctx, diffTab(change.path));
      else if (ev.action === "open") {
        if (change.kind === "deleted") throw new Error(`${change.path} was deleted; showing its diff instead.`);
        await show(ctx, change.path);
      }
    } catch (e) {
      error = errMsg(e);
    }
    ctx.ui.invalidate();
  }
};
var index_default = mod;
export {
  index_default as default
};
