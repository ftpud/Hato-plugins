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

// modules/ui/git-branch/src/index.ts
var workspaceId = null;
var catalog = null;
var open = false;
var loading = false;
var dirty = false;
var busy = null;
var error = null;
var query = "";
var tab = "local";
var actionsFor = null;
var creating = false;
var source = null;
var branchName = "";
var epoch = 0;
var mutations = 0;
async function refresh(ctx) {
  if (!workspaceId) return;
  if (loading || busy) {
    dirty = true;
    return;
  }
  const id = workspaceId, mine = ++epoch;
  dirty = false;
  loading = true;
  ctx.ui.invalidate();
  try {
    const result = await ctx.modules.call("git", "branches", { workspaceId: id }, { timeoutMs: 18e4 });
    if (mine === epoch && id === workspaceId) {
      catalog = result;
      error = null;
    }
  } catch (e) {
    if (mine === epoch && id === workspaceId) error = errMsg(e);
  } finally {
    if (mine === epoch && id === workspaceId) {
      loading = false;
      if (dirty) void refresh(ctx);
    }
    ctx.ui.invalidate();
  }
}
async function mutate(ctx, method, args) {
  if (!workspaceId || busy) return;
  const id = workspaceId;
  ++epoch;
  loading = false;
  busy = method === "checkout" ? "Checking out branch…" : "Creating branch…";
  error = null;
  mutations++;
  ctx.ui.invalidate();
  try {
    const result = await ctx.modules.call("git", method, { workspaceId: id, ...args }, { timeoutMs: 18e4 });
    if (workspaceId !== id) return;
    ++epoch;
    catalog = result;
    open = false;
    creating = false;
    branchName = "";
    actionsFor = null;
    dirty = false;
  } catch (e) {
    if (workspaceId === id) {
      error = errMsg(e);
      open = true;
    }
  } finally {
    mutations--;
    if (workspaceId === id) {
      busy = null;
      if (dirty) void refresh(ctx);
    }
    ctx.ui.invalidate();
  }
}
var button = (key, text, action, extra = {}) => ({ type: "button", key, text, action, small: true, disabled: !!busy, ...extra });
function branchRow(branch) {
  return { type: "column", key: branch.ref, gap: 3, padding: 5, style: { radius: 8, ...branch.current ? { background: "selection" } : {} }, children: [
    { type: "row", key: "row", gap: 6, children: [
      button("checkout", branch.name, "checkout", {
        value: branch.ref,
        iconSvg: uiIcons["git-branch"],
        variant: "ghost",
        grow: true,
        disabled: !!busy || branch.current,
        tooltip: branch.current ? "Current branch" : `Check out ${branch.name}`
      }),
      ...branch.current ? [{ type: "label", key: "current", text: "✓", color: "primary", size: "sm" }] : [],
      button("actions", "⋮", "branchActions", { value: branch.ref, variant: "ghost", tooltip: `Actions for ${branch.name}` })
    ] },
    ...branch.worktree && !branch.current ? [{ type: "label", key: "worktree", text: "In another worktree", color: "muted", size: "xs", tooltip: branch.worktree }] : [],
    ...actionsFor === branch.ref ? [{ type: "row", key: "actions", gap: 4, children: [
      button("create-from", "Create branch from here", "createFrom", { value: branch.ref, iconSvg: uiIcons.plus, variant: "ghost" })
    ] }] : []
  ] };
}
var mod = {
  id: "git-branch",
  moduleApiVersion: 1,
  async activate(ctx, previous) {
    workspaceId = ctx.state.get("workspace.selected")?.id || null;
    if (previous?.workspaceId === workspaceId) {
      catalog = previous.catalog || null;
      query = previous.query || "";
      tab = previous.tab === "remote" ? "remote" : "local";
    }
    ctx.state.watch("workspace.selected", (value) => {
      const next = value?.id || null;
      if (next === workspaceId) return;
      ++epoch;
      workspaceId = next;
      catalog = null;
      open = false;
      loading = false;
      dirty = false;
      busy = null;
      error = null;
      query = "";
      tab = "local";
      creating = false;
      source = null;
      branchName = "";
      actionsFor = null;
      ctx.ui.invalidate();
      void refresh(ctx);
    });
    ctx.events.on("git.changed", (event) => {
      if (event.workspaceId === workspaceId) void refresh(ctx);
    });
    await refresh(ctx);
  },
  deactivate() {
    ++epoch;
  },
  canSwap: () => ({ ok: mutations === 0, ...mutations ? { reason: "A branch operation is in progress." } : {} }),
  snapshot: () => ({ workspaceId, catalog, query, tab }),
  render() {
    const list = catalog?.[tab] || [];
    const filtered = list.filter((b) => b.name.toLowerCase().includes(query.trim().toLowerCase()));
    const title = !workspaceId ? "No workspace" : !catalog ? error ? "Git unavailable" : "Git…" : !catalog.repo ? "No repository" : catalog.current || (catalog.head ? `Detached ${catalog.head}` : "No commits");
    const children = [
      { type: "row", key: "header", gap: 6, children: [
        { type: "column", key: "heading", gap: 3, grow: true, children: [
          { type: "label", key: "title", text: "Switch branch", weight: "semibold" },
          { type: "label", key: "hint", text: `Current: ${title}`, color: "muted", size: "xs", wrap: true }
        ] },
        button("refresh", "", "refresh", { iconSvg: uiIcons.refresh, variant: "ghost", tooltip: "Refresh local and remote-tracking branches", disabled: loading || !!busy })
      ] },
      { type: "textInput", key: "branch-search", value: query, placeholder: "Find a branch…", prefixSvg: uiIcons.search, changeAction: "filter", disabled: !!busy },
      { type: "row", key: "tabs", gap: 6, children: [
        button("local", `Local ${catalog?.local.length || 0}`, "tab", { value: "local", variant: tab === "local" ? "primary" : "ghost" }),
        button("remote", `Remote ${catalog?.remote.length || 0}`, "tab", { value: "remote", variant: tab === "remote" ? "primary" : "ghost" })
      ] },
      { type: "divider", key: "divider" }
    ];
    if (error) children.push({ type: "status", key: "error", text: error, level: "error" });
    if (busy || loading) children.push({ type: "progress", key: "loading", indeterminate: true, label: busy || "Refreshing branches…" });
    children.push({ type: "scroll", key: "branches", height: Math.min(260, Math.max(48, filtered.length * 48)), children: filtered.map(branchRow) });
    if (!filtered.length) children.push({ type: "label", key: "empty", text: query ? "No matching branches." : tab === "remote" ? "No remote-tracking branches. Fetch using Git to update this list." : "No local branches.", color: "muted", size: "sm", wrap: true });
    if (creating) children.push({ type: "column", key: "create-form", gap: 5, children: [
      { type: "label", key: "from", text: source ? `From ${source.replace(/^refs\/(heads|remotes)\//, "")}` : "From the current HEAD", size: "xs", color: "muted" },
      { type: "textInput", key: "new-branch-name", value: branchName, placeholder: "feature/welcome", changeAction: "branchName", submitAction: "createBranch", disabled: !!busy },
      { type: "row", key: "create-actions", gap: 6, children: [button("create", "Create & checkout", "createBranch", { variant: "primary", disabled: !!busy || !branchName.trim() }), button("cancel", "Cancel", "cancelCreate", { variant: "ghost" })] }
    ] });
    children.push({ type: "divider", key: "footer-divider" }, { type: "row", key: "footer", gap: 5, children: [
      button("new", "Create a branch", "showCreate", { iconSvg: uiIcons.plus, variant: "ghost", grow: true }),
      { type: "label", key: "esc", text: "esc to close", color: "muted", size: "xs" }
    ] });
    return {
      type: "dropdown",
      key: "branch-menu",
      text: `${title}  ⌄`,
      iconSvg: uiIcons["git-branch"],
      variant: "ghost",
      action: "toggle",
      open,
      disabled: !workspaceId || catalog?.repo === false,
      menuWidth: 440,
      maxHeight: 620,
      tooltip: `Current branch: ${title}${error ? `
${error}` : ""}`,
      style: { background: "transparent", borderWidth: 0 },
      children
    };
  },
  async onEvent(ctx, event) {
    if (event.action === "toggle") {
      open = !!event.value;
      if (open) {
        error = null;
        void refresh(ctx);
      }
      ctx.ui.invalidate();
      return;
    }
    if (busy) return;
    switch (event.action) {
      case "filter":
        query = String(event.value || "");
        actionsFor = null;
        break;
      case "tab":
        tab = event.value === "remote" ? "remote" : "local";
        actionsFor = null;
        break;
      case "refresh":
        await refresh(ctx);
        return;
      case "branchActions":
        actionsFor = actionsFor === event.value ? null : String(event.value);
        break;
      case "showCreate":
        creating = true;
        source = null;
        branchName = "";
        break;
      case "createFrom":
        creating = true;
        source = String(event.value);
        branchName = "";
        actionsFor = null;
        break;
      case "cancelCreate":
        creating = false;
        branchName = "";
        break;
      case "branchName":
        branchName = String(event.value || "");
        break;
      case "checkout":
        await mutate(ctx, "checkout", { ref: event.value });
        return;
      case "createBranch": {
        branchName = event.inputs?.["new-branch-name"] ?? branchName;
        if (!branchName.trim()) {
          error = "Enter a branch name.";
          break;
        }
        await mutate(ctx, "createBranch", { name: branchName.trim(), from: source });
        return;
      }
    }
    ctx.ui.invalidate();
  }
};
var index_default = mod;
export {
  index_default as default
};
