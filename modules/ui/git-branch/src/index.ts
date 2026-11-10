import type { AppModule, ModuleContext, UiNode } from "@hato/sdk/types";
import type { GitBranch, GitBranches } from "@hato/sdk/git-branches";
import { errMsg } from "@hato/sdk/runtime";
import { uiIcons } from "@hato/sdk/ui-icons";

let workspaceId: string | null = null;
let catalog: GitBranches | null = null;
let open = false, loading = false, dirty = false;
let busy: string | null = null, error: string | null = null;
let query = "", tab: "local" | "remote" = "local";
let actionsFor: string | null = null;
let creating = false, source: string | null = null, branchName = "";
let epoch = 0, mutations = 0;
let edit: "rename" | "publish" | "upstream" | "delete" | null = null;
let editValue = "";

async function refresh(ctx: ModuleContext) {
  if (!workspaceId) return;
  if (loading || busy) { dirty = true; return; }
  const id = workspaceId, mine = ++epoch;
  dirty = false; loading = true; ctx.ui.invalidate();
  try {
    const result: GitBranches = await ctx.modules.call("git", "branches", { workspaceId: id }, { timeoutMs: 180000 });
    if (mine === epoch && id === workspaceId) { catalog = result; error = null; }
  } catch (e) { if (mine === epoch && id === workspaceId) error = errMsg(e); }
  finally {
    if (mine === epoch && id === workspaceId) {
      loading = false;
      if (dirty) void refresh(ctx);
    }
    ctx.ui.invalidate();
  }
}

async function mutate(ctx: ModuleContext, method: "checkout" | "createBranch" | "renameBranch" | "publishBranch" | "setUpstream" | "deleteBranch", args: object) {
  if (!workspaceId || busy) return;
  const id = workspaceId;
  ++epoch; loading = false; busy = ({ checkout: "Switching branch…", createBranch: "Creating branch…", renameBranch: "Renaming branch…", publishBranch: "Publishing branch…", setUpstream: "Setting upstream…", deleteBranch: "Deleting branch…" })[method];
  error = null; mutations++; ctx.ui.invalidate();
  try {
    const result: GitBranches = await ctx.modules.call("git", method, { workspaceId: id, ...args }, { timeoutMs: 180000 });
    if (workspaceId !== id) return;
    ++epoch; catalog = result; open = method !== "checkout" && method !== "createBranch"; edit = null; creating = false; branchName = ""; actionsFor = null; dirty = false;
  } catch (e) { if (workspaceId === id) { error = errMsg(e); open = true; } }
  finally { mutations--; if (workspaceId === id) { busy = null; if (dirty) void refresh(ctx); } ctx.ui.invalidate(); }
}

const button = (key: string, text: string, action: string, extra: object = {}): UiNode => ({ type: "button", key, text, action, small: true, disabled: !!busy, ...extra });
function branchRow(branch: GitBranch): UiNode {
  const expanded = actionsFor === branch.ref;
  const local = branch.ref.startsWith("refs/heads/");
  const locked = !!branch.worktree && !branch.current;
  const action = (key: string, text: string, icon: string, disabled = false, danger = false): UiNode => ({
    type: "column", key, grow: true, children: [{ type: "row", key: "content", gap: 6, padding: 6,
      style: { background: "panel", radius: 7, minHeight: 32 }, children: [
        button("icon", "", disabled ? "noop" : "editBranch", { value: key, iconSvg: icon, width: 22, variant: "ghost", disabled: !!busy || disabled, style: { color: danger ? "danger" : "muted", paddingX: 0, background: "transparent" } }),
        { type: "column", key: "label", grow: true, children: [{ type: "choice", key: "action", text, action: disabled ? "noop" : "editBranch", value: key, mark: "", selected: false,
          style: { background: "transparent", color: danger ? "danger" : "muted", borderWidth: 0, padding: 0, radius: 0, opacity: disabled ? 0.45 : 1 } }] },
      ] }],
  });
  const children: UiNode[] = [
    { type: "row", key: "row", gap: 8, align: "center", children: [
      button("branch-icon", "", branch.current || locked ? "noop" : "checkout", { value: branch.ref, iconSvg: uiIcons["git-branch"], width: 22, variant: "ghost",
        style: { color: branch.current ? "primary" : "muted", background: "transparent", paddingX: 0 } }),
      { type: "column", key: "branch-label", grow: true, children: [{ type: "choice", key: "checkout", text: branch.name,
        action: branch.current || locked ? "noop" : "checkout", value: branch.ref, selected: branch.current, mark: "✓",
        style: { background: "transparent", borderWidth: 0, paddingX: 0, paddingY: 4, minHeight: 30, radius: 0 },
        tooltip: branch.current ? "Current branch" : locked ? "Checked out in another worktree" : `Check out ${branch.name}` }] },
      button("actions", "⋮", "branchActions", { value: branch.ref, width: 22, variant: "ghost", tooltip: `Actions for ${branch.name}`, style: { color: "muted", paddingX: 0, minHeight: 30 } }),
    ] },
  ];
  if (branch.worktree && !branch.current) children.push({ type: "label", key: "worktree", text: "In another worktree", color: "muted", size: "xs", tooltip: branch.worktree, padding: 6 });
  if (expanded) {
    if (local) children.push({ type: "column", key: "actions", gap: 4, padding: 6, children: [
      { type: "row", key: "first", gap: 4, children: [action("rename", "Rename", uiIcons.pencil, locked), action("publish", "Publish", uiIcons.remote, locked || branch.unborn || !catalog?.remotes.length)] },
      { type: "row", key: "second", gap: 4, children: [action("upstream", "Set upstream", uiIcons["git-branch"], locked || !catalog?.remote.length), action("delete", "Delete", uiIcons.trash, locked || branch.current, true)] },
    ] });
    else children.push(button("create-from", "Create local branch from here", "createFrom", { value: branch.ref, iconSvg: uiIcons.plus, variant: "ghost" }));
    if (edit) {
      const fields: UiNode[] = [];
      if (edit === "rename") fields.push({ type: "textInput", key: "branch-edit-name", height: 34, value: editValue, changeAction: "editValue", submitAction: "applyBranchEdit", placeholder: "New branch name" });
      if (edit === "publish" || edit === "upstream") fields.push({ type: "select", key: "branch-edit-target", value: editValue, action: "editValue", options: edit === "publish" ? (catalog?.remotes || []).map(remote => ({ value: remote, label: remote })) : (catalog?.remote || []).map(remote => ({ value: remote.ref, label: remote.name })) });
      fields.push({ type: "label", key: "explain", text: edit === "delete" ? `Delete “${branch.name}”? Only merged branches can be deleted. The remote branch stays in place.` : edit === "publish" ? `Push “${branch.name}” and track it on the selected remote.` : edit === "upstream" ? `Track the selected remote branch from “${branch.name}”.` : `Rename “${branch.name}”.`, size: "xs", color: "muted", wrap: true });
      fields.push({ type: "row", key: "confirm", gap: 6, children: [
        button("apply", edit === "delete" ? "Delete merged branch" : edit === "publish" ? "Publish branch" : edit === "upstream" ? "Set upstream" : "Rename branch", "applyBranchEdit", { variant: edit === "delete" ? "danger" : "primary", disabled: !!busy || edit !== "delete" && !editValue.trim() }),
        button("cancel", "Cancel", "cancelBranchEdit", { variant: "ghost" }),
      ] });
      children.push({ type: "column", key: "edit", gap: 8, padding: 8, children: fields });
    }
  }
  return { type: "column", key: branch.ref, gap: 2, padding: 6, style: { radius: 8, background: expanded ? "surface" : branch.current ? "selection" : "transparent" }, children };
}

const mod: AppModule = {
  id: "git-branch", moduleApiVersion: 1,
  async activate(ctx, previous) {
    workspaceId = (ctx.state.get("workspace.selected") as any)?.id || null;
    if (previous?.workspaceId === workspaceId) {
      catalog = previous.catalog || null; query = previous.query || ""; tab = previous.tab === "remote" ? "remote" : "local";
    }
    ctx.state.watch("workspace.selected", (value: any) => {
      const next = value?.id || null;
      if (next === workspaceId) return;
      ++epoch; workspaceId = next; catalog = null; open = false; loading = false; dirty = false; busy = null; error = null;
      query = ""; tab = "local"; creating = false; source = null; branchName = ""; actionsFor = null; edit = null;
      ctx.ui.invalidate(); void refresh(ctx);
    });
    ctx.events.on("git.changed", (event: any) => { if (event.workspaceId === workspaceId) void refresh(ctx); });
    await refresh(ctx);
  },
  deactivate() { ++epoch; },
  canSwap: () => ({ ok: mutations === 0, ...(mutations ? { reason: "A branch operation is in progress." } : {}) }),
  snapshot: () => ({ workspaceId, catalog, query, tab }),
  render(): UiNode {
    const list = catalog?.[tab] || [];
    const filtered = list.filter(b => b.name.toLowerCase().includes(query.trim().toLowerCase()));
    const title = !workspaceId ? "No workspace" : !catalog ? error ? "Git unavailable" : "Git…" : !catalog.repo ? "No repository" : catalog.current || (catalog.head ? `Detached ${catalog.head}` : "No commits");
    const children: UiNode[] = [
      { type: "row", key: "header", gap: 6, children: [
        { type: "column", key: "heading", gap: 3, grow: true, children: [
          { type: "label", key: "title", text: "Switch branch", weight: "semibold" },
          { type: "label", key: "hint", text: "Select a branch to check it out", color: "muted", size: "xs", wrap: true },
        ] },
        button("refresh", "", "refresh", { iconSvg: uiIcons.refresh, variant: "ghost", tooltip: "Refresh local and remote-tracking branches", disabled: loading || !!busy }),
      ] },
      { type: "textInput", key: "branch-search", height: 36, value: query, placeholder: "Find a branch…", prefixSvg: uiIcons.search, changeAction: "filter", disabled: !!busy },
      { type: "row", key: "tabs", gap: 6, children: [
        button("local", `Local ${catalog?.local.length || 0}`, "tab", { value: "local", variant: "ghost", style: { background: tab === "local" ? "selection" : "transparent", color: tab === "local" ? "primary" : "muted", paddingX: 12, paddingY: 7, radius: 8 } }),
        button("remote", `Remote ${catalog?.remote.length || 0}`, "tab", { value: "remote", variant: "ghost", style: { background: tab === "remote" ? "selection" : "transparent", color: tab === "remote" ? "primary" : "muted", paddingX: 12, paddingY: 7, radius: 8 } }),
      ] },
      { type: "divider", key: "divider" },
    ];
    if (error) children.push({ type: "status", key: "error", text: error, level: "error" });
    if (busy || loading) children.push({ type: "progress", key: "loading", indeterminate: true, label: busy || "Refreshing branches…" });
    children.push({ type: "scroll", key: "branches", height: Math.min(360, Math.max(48, filtered.length * 42 + (actionsFor ? edit ? 240 : 100 : 0))), children: filtered.map(branchRow) });
    if (!filtered.length) children.push({ type: "label", key: "empty", text: query ? "No matching branches." : tab === "remote" ? "No remote-tracking branches. Fetch using Git to update this list." : "No local branches.", color: "muted", size: "sm", wrap: true });
    if (creating) children.push({ type: "column", key: "create-form", gap: 5, children: [
      { type: "label", key: "from", text: source ? `From ${source.replace(/^refs\/(heads|remotes)\//, "")}` : "From the current HEAD", size: "xs", color: "muted" },
      { type: "textInput", key: "new-branch-name", value: branchName, placeholder: "feature/welcome", changeAction: "branchName", submitAction: "createBranch", disabled: !!busy },
      { type: "row", key: "create-actions", gap: 6, children: [button("create", "Create & checkout", "createBranch", { variant: "primary", disabled: !!busy || !branchName.trim() }), button("cancel", "Cancel", "cancelCreate", { variant: "ghost" })] },
    ] });
    children.push({ type: "divider", key: "footer-divider" }, { type: "row", key: "footer", gap: 5, children: [
      button("new-icon", "", "showCreate", { iconSvg: uiIcons.plus, width: 22, variant: "ghost", style: { color: "primary", paddingX: 0 } }),
      { type: "column", key: "new", grow: true, children: [{ type: "choice", key: "create-label", text: "Create a branch", action: "showCreate", value: "", selected: false, mark: "", style: { background: "transparent", color: "primary", borderWidth: 0, paddingX: 0, paddingY: 6 } }] },
      { type: "label", key: "esc", text: "esc to close", color: "muted", size: "xs" },
    ] });
    return { type: "dropdown", key: "branch-menu", text: `${title}  ⌄`, iconSvg: uiIcons["git-branch"], variant: "ghost", action: "toggle", open,
      disabled: !workspaceId || catalog?.repo === false, menuWidth: 360, maxHeight: 620, tooltip: `Current branch: ${title}${error ? `\n${error}` : ""}`,
      style: { background: "transparent", borderWidth: 0 }, children };
  },
  async onEvent(ctx, event) {
    if (event.action === "toggle") { open = !!event.value; if (open) { error = null; void refresh(ctx); } ctx.ui.invalidate(); return; }
    if (busy) return;
    switch (event.action) {
      case "filter": query = String(event.value || ""); actionsFor = null; break;
      case "tab": tab = event.value === "remote" ? "remote" : "local"; actionsFor = null; break;
      case "refresh": await refresh(ctx); return;
      case "branchActions": actionsFor = actionsFor === event.value ? null : String(event.value); edit = null; break;
      case "editBranch": {
        const branch = catalog?.local.find(branch => branch.ref === actionsFor);
        if (!branch || !["rename", "publish", "upstream", "delete"].includes(String(event.value))) return;
        edit = event.value as typeof edit;
        editValue = edit === "rename" ? branch.name : edit === "publish" ? catalog?.remotes[0] || "" : edit === "upstream" ? branch.upstream || catalog?.remote[0]?.ref || "" : "";
        break;
      }
      case "editValue": editValue = String(event.value || ""); break;
      case "cancelBranchEdit": edit = null; break;
      case "applyBranchEdit": {
        if (!edit || !actionsFor) return;
        const method = ({ rename: "renameBranch", publish: "publishBranch", upstream: "setUpstream", delete: "deleteBranch" } as const)[edit];
        const value = edit === "rename" ? event.inputs?.["branch-edit-name"] ?? editValue : editValue;
        await mutate(ctx, method, { ref: actionsFor, name: value, remote: value, upstream: value }); return;
      }
      case "showCreate": creating = true; source = null; branchName = ""; break;
      case "createFrom": creating = true; source = String(event.value); branchName = ""; actionsFor = null; break;
      case "cancelCreate": creating = false; branchName = ""; break;
      case "branchName": branchName = String(event.value || ""); break;
      case "checkout": await mutate(ctx, "checkout", { ref: event.value }); return;
      case "createBranch": {
        branchName = event.inputs?.["new-branch-name"] ?? branchName;
        if (!branchName.trim()) { error = "Enter a branch name."; break; }
        await mutate(ctx, "createBranch", { name: branchName.trim(), from: source }); return;
      }
    }
    ctx.ui.invalidate();
  },
};
export default mod;
