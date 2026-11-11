// ../sdk/runtime.ts
function errMsg(e) {
  return e && (e.message || String(e)) || "unknown error";
}

// ../sdk/git.ts
var DIFF_TAB_PREFIX = "git-diff:";
var diffTab = (path) => DIFF_TAB_PREFIX + path;

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
function changeBadge(c) {
  const counts = c.binary ? "bin" : [c.additions ? `+${c.additions}` : "", c.deletions ? `−${c.deletions}` : ""].filter(Boolean).join(" ");
  return [LETTER[c.kind] || "?", counts].filter(Boolean).join(" ");
}
function changeTree(changes) {
  const root = { name: "", path: "", children: [], paths: [] };
  const folders = /* @__PURE__ */ new Map([["", root]]);
  for (const file of changes) {
    const parts = file.path.split("/");
    let parent = root;
    parent.paths.push(file.path);
    for (let i = 0; i < parts.length - 1; i++) {
      const path = parts.slice(0, i + 1).join("/");
      let folder = folders.get(path);
      if (!folder) {
        folder = { name: parts[i], path, children: [], paths: [] };
        folders.set(path, folder);
        parent.children.push(folder);
      }
      folder.paths.push(file.path);
      parent = folder;
    }
    parent.children.push({ name: parts[parts.length - 1], path: file.path, file, children: [], paths: [file.path] });
  }
  const sort = (nodes) => nodes.sort((a, b) => Number(!!a.file) - Number(!!b.file) || a.name.localeCompare(b.name)).map((n) => {
    let leaf = n, name = n.name;
    while (!leaf.file && leaf.children.length === 1 && !leaf.children[0].file) {
      leaf = leaf.children[0];
      name += "/" + leaf.name;
    }
    return { ...leaf, name, children: sort(leaf.children) };
  });
  return sort(root.children);
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
        if (!field || field.type === "action") throw new Error("Setting is no longer available");
        if (field.type === "order") parseOrder(edit.value, field.items.map((i) => i.id), field.allowSpacers);
        else if (field.type === "toggle" ? typeof edit.value !== "boolean" : typeof edit.value !== "string" || field.type === "select" && !field.options.some((o) => o.value === edit.value)) {
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
  if (options.action) ctx.events.on("settings.action", (event) => {
    if (event?.module !== ctx.moduleId) return;
    const run = async () => {
      try {
        const section = getSections().find((s) => s.key === event.section);
        const field = section?.fields.find((f) => f.key === event.key);
        if (!field || field.type !== "action" || field.disabled) throw new Error("Action is not available");
        await options.action(section.key, field.key);
        publish();
      } catch (error2) {
        publish(error2 instanceof Error ? error2.message : String(error2));
      }
      if (options.invalidate !== false) ctx.ui.invalidate();
    };
    void run();
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
var drafts = {};
var draftsLoaded = /* @__PURE__ */ new Set();
var selected = /* @__PURE__ */ new Set();
var collapsed = /* @__PURE__ */ new Set();
var error = "";
var notice = "";
var busy = false;
var loading = false;
var dirty = false;
var visible = false;
var autoRefresh = true;
var epoch = 0;
var query = "";
var newSet = false;
var stashOpen = false;
var stashes = [];
var dropStash = null;
var draft = () => {
  var _a;
  return drafts[_a = ws.id] || (drafts[_a] = { sets: [{ id: "main", name: "Changes", paths: [], message: "" }], active: "main" });
};
var active = () => draft().sets.find((s) => s.id === draft().active) || draft().sets[0];
function files() {
  const d = draft(), a = active();
  return (status?.files || []).filter((f) => a.id === "main" ? !d.sets.some((s) => s.id !== "main" && s.paths.includes(f.path)) : a.paths.includes(f.path));
}
function save(ctx) {
  return ctx.modules.call("persistence", "settings.set", { key: `git-panel.changesets.${ws.id}`, value: draft() });
}
async function refresh(ctx) {
  if (!ws) {
    ctx.state.set("git-panel.panelBadge.git", 0);
    return;
  }
  if (loading) {
    dirty = true;
    return;
  }
  loading = true;
  dirty = false;
  const id = ws.id, mine = epoch;
  try {
    const r = await ctx.modules.call("git", "status", { workspaceId: id }, { timeoutMs: 45e3 });
    if (mine !== epoch) return;
    if (!draftsLoaded.has(id)) {
      const saved = await ctx.modules.call("persistence", "settings.get", { key: `git-panel.changesets.${id}` });
      if (mine !== epoch) return;
      if (saved?.sets?.[0]?.id === "main") drafts[id] = saved;
      draftsLoaded.add(id);
    }
    status = r;
    error = "";
    ctx.state.set("git-panel.panelBadge.git", r.files.length);
    selected = new Set([...selected].filter((p) => r.files.some((f) => f.path === p)));
    ctx.events.emit("git-panel.statusChanged", { workspaceId: id });
  } catch (e) {
    if (mine === epoch) error = errMsg(e);
  } finally {
    if (mine === epoch) {
      loading = false;
      if (dirty && autoRefresh) void refresh(ctx);
    }
    ctx.ui.invalidate();
  }
}
function button(key, text, action = key, extra = {}) {
  return { type: "button", key, text, action, small: true, variant: "ghost", disabled: busy, ...extra };
}
var mod = {
  id: "git-panel",
  moduleApiVersion: 1,
  async activate(ctx, prev) {
    collapsed = new Set(prev?.collapsed || []);
    drafts = prev?.drafts || {};
    draftsLoaded = new Set(Object.keys(drafts));
    ws = ctx.state.get("workspace.selected");
    const saved = await ctx.modules.call("persistence", "settings.get", { key: "git-panel.autoRefresh" });
    const old = saved == null ? await ctx.modules.call("persistence", "settings.get", { key: "git-panel.pollSeconds" }) : null;
    autoRefresh = typeof saved === "boolean" ? saved : old !== 0;
    exportSettings(ctx, () => [{ key: "git-panel", title: "Git changes", fields: [
      { key: "autoRefresh", label: "Automatic refresh", type: "toggle", value: autoRefresh }
    ] }], async (_section, key, value) => {
      if (key !== "autoRefresh" || typeof value !== "boolean") throw new Error("Invalid preference");
      await ctx.modules.call("persistence", "settings.set", { key: "git-panel.autoRefresh", value });
      autoRefresh = value;
      if (visible && value) void refresh(ctx);
    });
    visible = !!ctx.state.get("workspace-layout.panels")?.git;
    ctx.state.watch("workspace.selected", (v) => {
      if (ws?.id !== v?.id) {
        epoch++;
        loading = false;
        status = null;
        ctx.state.set("git-panel.panelBadge.git", 0);
        selected.clear();
        query = "";
        stashOpen = false;
        error = "";
        notice = "";
      }
      ws = v;
      void refresh(ctx);
    });
    ctx.state.watch("workspace-layout.panels", (v) => {
      visible = !!v?.git;
      if (visible) void refresh(ctx);
    });
    ctx.events.on("git.changed", (v) => {
      if (v.workspaceId === ws?.id) {
        dirty = true;
        if (autoRefresh) void refresh(ctx);
      }
    });
    await refresh(ctx);
  },
  canSwap: () => ({ ok: !busy, reason: "A Git operation is running" }),
  deactivate() {
    epoch++;
  },
  snapshot: () => ({ drafts, collapsed: [...collapsed] }),
  render() {
    if (!ws) return { type: "label", key: "empty", text: "Select a project or task.", color: "muted" };
    const d = draft(), a = active(), current = files(), shown = current.filter((f) => f.path.toLowerCase().includes(query.toLowerCase()));
    const picked = current.filter((f) => selected.has(f.path));
    const children = [
      { type: "row", key: "tools", gap: 4, wrap: true, align: "center", children: [
        { type: "label", key: "branch", text: `⎇ ${status?.branch || "Git"}${status?.upstream ? ` · ↑${status.ahead} ↓${status.behind}` : ""}`, tooltip: status?.upstream || "No upstream configured", grow: true, weight: "semibold", size: "sm" },
        button("stashOpen", "Stashes…"),
        button("fetch", "Fetch"),
        button("pull", "Pull"),
        button("push", "Push"),
        button("refresh", "", "refresh", { iconSvg: uiIcons.refresh, tooltip: "Refresh Git status", disabled: busy || loading })
      ] },
      { type: "row", key: "sets", gap: 3, wrap: true, children: [
        ...d.sets.map((s) => button(`set:${s.id}`, `${s.name} (${s.id === "main" ? (status?.files || []).filter((f) => !d.sets.some((t) => t.id !== "main" && t.paths.includes(f.path))).length : (status?.files || []).filter((f) => s.paths.includes(f.path)).length})`, "set", { value: s.id, variant: a.id === s.id ? "primary" : "ghost" })),
        button("newSet", "+", "newSet", { tooltip: "Create a changeset" })
      ] },
      { type: "textInput", key: "filter", value: query, placeholder: "Filter changed files…", changeAction: "filter", prefixSvg: uiIcons.search }
    ];
    if (error) children.push({ type: "status", key: "error", text: error, level: "error" });
    if (notice) children.push({ type: "status", key: "notice", text: notice, level: "info" });
    if (loading || busy) children.push({ type: "progress", key: "progress", indeterminate: true });
    const list = [];
    for (const untracked of [false, true]) {
      const group = shown.filter((f) => f.kind === "untracked" === untracked);
      if (!group.length) continue;
      list.push({ type: "toggle", key: `group:${untracked}`, label: `${untracked ? "Untracked" : "Changes"} · ${group.length}`, checked: group.every((f) => selected.has(f.path)), action: `group:${untracked}`, disabled: busy });
      const scope = untracked ? "untracked" : "tracked";
      const append = (nodes, depth) => {
        for (const node of nodes) {
          const folder = !node.file, key = `${ws.id}:${scope}:${node.path}`, open = !!query || !collapsed.has(key);
          const f = node.file;
          list.push({ type: "row", key: `${scope}:${node.path}`, gap: 4, align: "center", children: [
            { type: "label", key: "indent", text: "", width: depth * 16, style: { noShrink: true } },
            ...folder ? [button(`disclose:${scope}:${node.path}`, open ? "▾" : "▸", "folder", {
              value: key,
              width: 20,
              style: { padding: 0, noShrink: true },
              tooltip: `${open ? "Collapse" : "Expand"} ${node.path}`
            })] : [{ type: "label", key: "disclosure-space", text: "", width: 20, style: { noShrink: true } }],
            {
              type: "toggle",
              key: `check:${scope}:${node.path}`,
              label: "",
              checked: node.paths.every((p) => selected.has(p)),
              action: folder ? `folderCheck:${scope}:${node.path}` : `check:${node.path}`,
              disabled: busy,
              tooltip: folder ? `Include all changes in ${node.path}` : `Include ${node.path} in commit`
            },
            button(
              `${folder ? "folder" : "file"}:${scope}:${node.path}`,
              node.name,
              folder ? "folder" : "diff",
              {
                doubleClickAction: folder ? void 0 : "edit",
                value: folder ? key : node.path,
                iconSvg: folder ? open ? fileIcons.folderOpen : fileIcons.folder : fileIcons.file,
                style: { justify: "start", paddingX: 4 },
                tooltip: f?.origPath ? `${f.origPath} → ${node.path}` : node.path
              }
            ),
            { type: "label", key: "row-space", text: "", grow: true },
            {
              type: "label",
              key: "badge",
              text: f ? changeBadge(f) : String(node.paths.length),
              size: "xs",
              color: f && (f.kind === "untracked" || f.kind === "added") ? "success" : "muted",
              style: { noShrink: true }
            }
          ] });
          if (folder && open) append(node.children, depth + 1);
        }
      };
      append(changeTree(group), 0);
    }
    children.push({ type: "column", key: "files", grow: true, scroll: true, gap: 3, children: list.length ? list : [{ type: "label", key: "clean", text: !status ? "Loading…" : !status.repo ? "Not a Git repository" : query ? "No matching files" : "No changes in this changeset", color: "muted", padding: 12 }] });
    children.push({ type: "row", key: "selection", gap: 4, wrap: true, children: [
      { type: "label", key: "count", text: `${picked.length} selected`, size: "xs", color: "muted", grow: true },
      {
        type: "select",
        key: "move",
        value: null,
        placeholder: "Move selected to…",
        action: "move",
        disabled: busy || !picked.length,
        options: d.sets.filter((s) => s.id !== a.id).map((s) => ({ value: s.id, label: s.name }))
      },
      ...a.id !== "main" ? [button("removeSet", "Remove tab", "removeSet", { tooltip: "Return these files to Changes" })] : []
    ] });
    children.push({ type: "textInput", key: `message:${a.id}`, value: a.message, multiline: true, rows: 3, placeholder: "Commit message", changeAction: "message", disabled: busy });
    children.push({ type: "row", key: "commit-tools", gap: 6, wrap: true, children: [
      button("commit", "Commit selected", "commit", { variant: "primary", disabled: busy || !picked.length || !a.message.trim() }),
      button("commitPush", "Commit & push", "commitPush", { disabled: busy || !picked.length || !a.message.trim() }),
      { type: "label", key: "hint", text: "Commits the complete contents of selected files.", size: "xs", color: "muted", wrap: true }
    ] });
    if (newSet) children.push({ type: "modal", key: "new-set", title: "New changeset", closeAction: "cancelSet", children: [
      ...error ? [{ type: "status", key: "set-error", text: error, level: "error" }] : [],
      { type: "textInput", key: "set-name", placeholder: "Changeset name", submitAction: "createSet" },
      { type: "label", key: "hint", text: "Selected files will move into this changeset.", color: "muted", size: "sm" },
      button("createSet", "Create", "createSet", { variant: "primary" })
    ] });
    if (stashOpen) children.push({ type: "modal", key: "stashes", title: "Stashes", closeAction: "closeStashes", children: [
      ...error ? [{ type: "status", key: "stash-error", text: error, level: "error" }] : [],
      { type: "label", key: "hint", text: "Save stashes all working changes, including untracked files. Apply keeps the saved stash.", wrap: true, size: "sm", color: "muted" },
      { type: "textInput", key: "stash-message", placeholder: "Stash description (optional)" },
      button("stashSave", "Save all changes", "stashSave", { disabled: busy || !status?.files.length }),
      { type: "column", key: "stash-list", scroll: true, height: 260, children: stashes.map((s) => ({ type: "row", key: s.id, gap: 6, children: [
        { type: "label", key: "name", text: s.name, grow: true, size: "sm", wrap: true },
        button(`apply:${s.id}`, "Apply", "stashApply", { value: s.id }),
        button(`drop:${s.id}`, "Delete…", "askDrop", { value: s.id })
      ] })) },
      ...dropStash ? [{ type: "label", key: "drop-warning", text: `Permanently delete “${dropStash.name}”?`, wrap: true }, button("confirmDrop", "Delete stash", "confirmDrop", { variant: "danger" }), button("cancelDrop", "Keep stash")] : []
    ] });
    return { type: "column", key: "git-root", gap: 8, padding: 10, grow: true, children };
  },
  async onEvent(ctx, ev) {
    if (!ws || busy) return;
    const id = ws.id;
    try {
      const a = active(), d = draft();
      if (ev.action === "filter") query = String(ev.value ?? "");
      else if (ev.action === "message") {
        a.message = String(ev.value ?? "");
        await save(ctx);
      } else if (ev.action === "folder") {
        const key = String(ev.value);
        collapsed.has(key) ? collapsed.delete(key) : collapsed.add(key);
      } else if (ev.action.startsWith("folderCheck:")) {
        const token = ev.action.slice("folderCheck:".length), split = token.indexOf(":"), scope = token.slice(0, split), path = token.slice(split + 1);
        const group = files().filter((f) => f.path.startsWith(path + "/") && f.kind === "untracked" === (scope === "untracked") && f.path.toLowerCase().includes(query.toLowerCase()));
        const remove = group.every((f) => selected.has(f.path));
        for (const f of group) remove ? selected.delete(f.path) : selected.add(f.path);
      } else if (ev.action.startsWith("check:")) {
        const p = ev.action.slice(6);
        selected.has(p) ? selected.delete(p) : selected.add(p);
      } else if (ev.action.startsWith("group:")) {
        const group = files().filter((f) => f.path.toLowerCase().includes(query.toLowerCase()) && f.kind === "untracked" === (ev.action === "group:true"));
        const remove = group.every((f) => selected.has(f.path));
        for (const f of group) remove ? selected.delete(f.path) : selected.add(f.path);
      } else if (ev.action === "set") {
        d.active = String(ev.value ?? ev.rowKey);
        selected.clear();
        await save(ctx);
      } else if (ev.action === "newSet") newSet = true;
      else if (ev.action === "cancelSet") newSet = false;
      else if (ev.action === "createSet" || ev.action === "move") {
        let target = String(ev.value ?? ev.rowKey ?? "");
        if (ev.action === "createSet") {
          const name = (ev.inputs["set-name"] || "").trim();
          if (!name) throw new Error("Enter a changeset name");
          target = crypto.randomUUID();
          d.sets.push({ id: target, name, paths: [], message: "" });
          newSet = false;
        }
        if (!d.sets.some((s) => s.id === target)) throw new Error("Unknown changeset");
        const paths = files().filter((f) => selected.has(f.path)).map((f) => f.path);
        for (const s of d.sets) s.paths = s.paths.filter((p) => !paths.includes(p));
        if (target !== "main") d.sets.find((s) => s.id === target).paths.push(...paths);
        d.active = target;
        selected.clear();
        await save(ctx);
      } else if (ev.action === "removeSet" && a.id !== "main") {
        d.sets = d.sets.filter((s) => s !== a);
        d.active = "main";
        selected.clear();
        await save(ctx);
      } else if (ev.action === "edit") await ctx.modules.call("workspace", "view.patch", { workspaceId: id, patch: { previewPath: String(ev.value) } });
      else if (ev.action === "diff") await ctx.modules.call("workspace", "view.patch", { workspaceId: id, patch: { previewPath: diffTab(String(ev.value)) } });
      else if (ev.action === "refresh") await refresh(ctx);
      else if (ev.action === "closeStashes") {
        stashOpen = false;
        dropStash = null;
      } else if (ev.action === "askDrop") dropStash = stashes.find((s) => s.id === ev.value);
      else if (ev.action === "cancelDrop") dropStash = null;
      else {
        busy = true;
        error = "";
        notice = "";
        ctx.ui.invalidate();
        if (ev.action === "commit" || ev.action === "commitPush") {
          const paths = files().filter((f) => selected.has(f.path)).map((f) => f.path);
          const r = await ctx.modules.call("git", "commit", { workspaceId: id, paths, message: a.message }, { timeoutMs: 12e4 });
          a.message = "";
          if (ws?.id === id) {
            selected.clear();
            await save(ctx);
            notice = r.output;
          }
          if (ev.action === "commitPush") {
            try {
              await ctx.modules.call("git", "network", { workspaceId: id, operation: "push" }, { timeoutMs: 12e4 });
            } catch (e) {
              throw new Error(`Commit succeeded; push failed. Use Push to retry. ${errMsg(e)}`);
            }
          }
        } else if (["fetch", "pull", "push"].includes(ev.action)) {
          const r = await ctx.modules.call("git", "network", { workspaceId: id, operation: ev.action }, { timeoutMs: 12e4 });
          if (ws?.id === id) notice = r.output || "Done";
        } else if (ev.action === "stashSave" || ev.action === "stashApply" || ev.action === "confirmDrop") {
          await ctx.modules.call("git", "stash", { workspaceId: id, operation: ev.action === "stashSave" ? "save" : ev.action === "stashApply" ? "apply" : "drop", id: ev.action === "confirmDrop" ? dropStash?.id : ev.value, message: ev.inputs["stash-message"] }, { timeoutMs: 12e4 });
          dropStash = null;
        }
        if (ev.action.startsWith("stash") || ev.action === "confirmDrop") {
          const list = await ctx.modules.call("git", "stashes", { workspaceId: id });
          if (ws?.id === id) {
            stashes = list;
            stashOpen = true;
          }
        }
        if (ws?.id === id) await refresh(ctx);
      }
    } catch (e) {
      if (ws?.id === id) error = errMsg(e);
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
