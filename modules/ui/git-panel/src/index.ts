import type { AppModule, ModuleContext, UiNode } from "@hato/sdk/types";
import { errMsg } from "@hato/sdk/runtime";
import { diffTab } from "@hato/sdk/git";
import { changeBadge, changeTree, type ChangeNode, type Change } from "./model";
import { exportSettings } from "@hato/sdk/settings";
import { fileIcons } from "@hato/sdk/file-icons";
import { uiIcons } from "@hato/sdk/ui-icons";
import { loadStashes, loadStashPreferences, resetStashes, stashCount, stashEvent, stashIcon, stashModal, type StashEnv } from "./stashes";

interface Changeset { id: string; name: string; paths: string[]; message: string }
interface Draft { sets: Changeset[]; active: string }
let ws: any = null, status: any = null;
let drafts: Record<string, Draft> = {};
let draftsLoaded = new Set<string>();
let selected = new Set<string>();
let collapsed = new Set<string>();
let error = "", notice = "", busy = false, loading = false, dirty = false, visible = false;
let autoRefresh = true;
let epoch = 0, query = "", newSet = false;
const draft = (): Draft => drafts[ws.id] ||= { sets: [{ id: "main", name: "Changes", paths: [], message: "" }], active: "main" };
const active = () => draft().sets.find(s => s.id === draft().active) || draft().sets[0];
function files(): Change[] {
  const d = draft(), a = active();
  return (status?.files || []).filter((f: Change) => a.id === "main" ? !d.sets.some(s => s.id !== "main" && s.paths.includes(f.path)) : a.paths.includes(f.path));
}
function save(ctx: ModuleContext) {
  return ctx.modules.call("persistence", "settings.set", { key: `git-panel.changesets.${ws.id}`, value: draft() });
}
async function refresh(ctx: ModuleContext) {
  if (!ws) { ctx.state.set("git-panel.panelBadge.git", 0); return; }
  if (loading) { dirty = true; return; }
  loading = true; dirty = false;
  const id = ws.id, mine = epoch;
  try {
    const [r] = await Promise.all([
      ctx.modules.call("git", "status", { workspaceId: id }, { timeoutMs: 45000 }),
      loadStashes(ctx, id, () => mine === epoch),
    ]);
    if (mine !== epoch) return;
    if (!draftsLoaded.has(id)) {
      const saved = await ctx.modules.call("persistence", "settings.get", { key: `git-panel.changesets.${id}` });
      if (mine !== epoch) return;
      if (saved?.sets?.[0]?.id === "main") drafts[id] = saved;
      draftsLoaded.add(id);
    }
    status = r; error = "";
    ctx.state.set("git-panel.panelBadge.git", r.files.length);
    selected = new Set([...selected].filter(p => r.files.some((f: Change) => f.path === p)));
    ctx.events.emit("git-panel.statusChanged", { workspaceId: id });
  } catch (e) { if (mine === epoch) error = errMsg(e); }
  finally { if (mine === epoch) { loading = false; if (dirty && autoRefresh) void refresh(ctx); } ctx.ui.invalidate(); }
}
function stashEnv(ctx: ModuleContext, id: string): StashEnv {
  return {
    workspaceId: id, current: () => ws?.id === id,
    changes: () => files(), picked: () => files().filter(f => selected.has(f.path)),
    async mutate(work) {
      busy = true; error = ""; notice = ""; ctx.ui.invalidate();
      try { await work(); }
      finally { busy = false; if (ws?.id === id) { selected = new Set([...selected].filter(p => files().some(f => f.path === p))); await refresh(ctx); } }
    },
  };
}
function button(key: string, text: string, action = key, extra: any = {}): UiNode {
  return { type: "button", key, text, action, small: true, variant: "ghost", disabled: busy, ...extra };
}
const mod: AppModule = {
  id: "git-panel", moduleApiVersion: 1,
  async activate(ctx, prev) {
    collapsed = new Set(prev?.collapsed || []);
    drafts = prev?.drafts || {}; draftsLoaded = new Set(Object.keys(drafts)); ws = ctx.state.get("workspace.selected");
    const saved = await ctx.modules.call("persistence", "settings.get", { key: "git-panel.autoRefresh" });
    const old = saved == null ? await ctx.modules.call("persistence", "settings.get", { key: "git-panel.pollSeconds" }) : null;
    autoRefresh = typeof saved === "boolean" ? saved : old !== 0;
    await loadStashPreferences(ctx);
    exportSettings(ctx, () => [{ key: "git-panel", title: "Git changes", fields: [
      { key: "autoRefresh", label: "Automatic refresh", type: "toggle", value: autoRefresh },
    ] }], async (_section, key, value) => {
      if (key !== "autoRefresh" || typeof value !== "boolean") throw new Error("Invalid preference");
      await ctx.modules.call("persistence", "settings.set", { key: "git-panel.autoRefresh", value }); autoRefresh = value;
      if (visible && value) void refresh(ctx);
    });
    visible = !!(ctx.state.get("workspace-layout.panels") as any)?.git;
    ctx.state.watch("workspace.selected", (v: any) => {
      if (ws?.id !== v?.id) { epoch++; loading = false; status = null; ctx.state.set("git-panel.panelBadge.git", 0); selected.clear(); query = ""; resetStashes(); error = ""; notice = ""; }
      ws = v; void refresh(ctx);
    });
    ctx.state.watch("workspace-layout.panels", (v: any) => { visible = !!v?.git; if (visible) void refresh(ctx); });
    ctx.events.on("git.changed", (v: any) => { if (v.workspaceId === ws?.id) { dirty = true; if (autoRefresh) void refresh(ctx); } });
    await refresh(ctx);
  },
  canSwap: () => ({ ok: !busy, reason: "A Git operation is running" }),
  deactivate() { epoch++; }, snapshot: () => ({ drafts, collapsed: [...collapsed] }),
  render(): UiNode {
    if (!ws) return { type: "label", key: "empty", text: "Select a project or task.", color: "muted" };
    const d = draft(), a = active(), current = files(), shown = current.filter(f => f.path.toLowerCase().includes(query.toLowerCase()));
    const picked = current.filter(f => selected.has(f.path));
    const children: UiNode[] = [
      { type: "row", key: "tools", gap: 4, wrap: true, align: "center", children: [
        { type: "label", key: "branch", text: `⎇ ${status?.branch || "Git"}${status?.upstream ? ` · ↑${status.ahead} ↓${status.behind}` : ""}`, tooltip: status?.upstream || "No upstream configured", grow: true, weight: "semibold", size: "sm" },
        button("stashes", stashCount() ? `Stashes (${stashCount()})` : "Stashes", "stash.open", { iconSvg: stashIcon,
          tooltip: stashCount() ? `${stashCount()} saved stash${stashCount() === 1 ? "" : "es"}` : "Stash changes to set them aside" }),
        button("fetch", "Fetch"), button("pull", "Pull"), button("push", "Push"),
        button("refresh", "", "refresh", { iconSvg: uiIcons.refresh, tooltip: "Refresh Git status", disabled: busy || loading }),
      ] },
      { type: "row", key: "sets", gap: 3, wrap: true, children: [
        ...d.sets.map(s => button(`set:${s.id}`, `${s.name} (${s.id === "main" ? (status?.files || []).filter((f: Change) => !d.sets.some(t => t.id !== "main" && t.paths.includes(f.path))).length : (status?.files || []).filter((f: Change) => s.paths.includes(f.path)).length})`, "set", { value: s.id, variant: a.id === s.id ? "primary" : "ghost" })),
        button("newSet", "+", "newSet", { tooltip: "Create a changeset" }),
      ] },
      { type: "textInput", key: "filter", value: query, placeholder: "Filter changed files…", changeAction: "filter", prefixSvg: uiIcons.search },
    ];
    if (error) children.push({ type: "status", key: "error", text: error, level: "error" });
    if (notice) children.push({ type: "status", key: "notice", text: notice, level: "info" });
    if (loading || busy) children.push({ type: "progress", key: "progress", indeterminate: true });
    const list: UiNode[] = [];
    for (const untracked of [false, true]) {
      const group = shown.filter(f => (f.kind === "untracked") === untracked);
      if (!group.length) continue;
      list.push({ type: "toggle", key: `group:${untracked}`, label: `${untracked ? "Untracked" : "Changes"} · ${group.length}`, checked: group.every(f => selected.has(f.path)), action: `group:${untracked}`, disabled: busy });
      const scope = untracked ? "untracked" : "tracked";
      const append = (nodes: ChangeNode[], depth: number) => {
        for (const node of nodes) {
          const folder = !node.file, key = `${ws.id}:${scope}:${node.path}`, open = !!query || !collapsed.has(key);
          const f = node.file;
          list.push({ type: "row", key: `${scope}:${node.path}`, gap: 4, align: "center", children: [
            { type: "label", key: "indent", text: "", width: depth * 16, style: { noShrink: true } },
            ...(folder ? [button(`disclose:${scope}:${node.path}`, open ? "▾" : "▸", "folder", {
              value: key, width: 20, style: { padding: 0, noShrink: true }, tooltip: `${open ? "Collapse" : "Expand"} ${node.path}`,
            })] : [{ type: "label", key: "disclosure-space", text: "", width: 20, style: { noShrink: true } } as UiNode]),
            { type: "toggle", key: `check:${scope}:${node.path}`, label: "", checked: node.paths.every(p => selected.has(p)),
              action: folder ? `folderCheck:${scope}:${node.path}` : `check:${node.path}`, disabled: busy,
              tooltip: folder ? `Include all changes in ${node.path}` : `Include ${node.path} in commit` },
            button(`${folder ? "folder" : "file"}:${scope}:${node.path}`, node.name,
              folder ? "folder" : "diff", { doubleClickAction: folder ? undefined : "edit", value: folder ? key : node.path,
                iconSvg: folder ? (open ? fileIcons.folderOpen : fileIcons.folder) : fileIcons.file,
                style: { justify: "start", paddingX: 4 },
                tooltip: f?.origPath ? `${f.origPath} → ${node.path}` : node.path }),
            { type: "label", key: "row-space", text: "", grow: true },
            { type: "label", key: "badge", text: f ? changeBadge(f) : String(node.paths.length), size: "xs",
              color: f && (f.kind === "untracked" || f.kind === "added") ? "success" : "muted", style: { noShrink: true } },
          ] });
          if (folder && open) append(node.children, depth + 1);
        }
      };
      append(changeTree(group), 0);
    }
    children.push({ type: "column", key: "files", grow: true, scroll: true, gap: 3, children: list.length ? list : [{ type: "label", key: "clean", text: !status ? "Loading…" : !status.repo ? "Not a Git repository" : query ? "No matching files" : "No changes in this changeset", color: "muted", padding: 12 }] });
    children.push({ type: "row", key: "selection", gap: 4, wrap: true, children: [
      { type: "label", key: "count", text: `${picked.length} selected`, size: "xs", color: "muted", grow: true },
      { type: "select", key: "move", value: null, placeholder: "Move selected to…", action: "move", disabled: busy || !picked.length,
        options: d.sets.filter(s => s.id !== a.id).map(s => ({ value: s.id, label: s.name })) },
      ...(a.id !== "main" ? [button("removeSet", "Remove tab", "removeSet", { tooltip: "Return these files to Changes" })] : []),
    ] });
    children.push({ type: "textInput", key: `message:${a.id}`, value: a.message, multiline: true, rows: 3, placeholder: "Commit message", changeAction: "message", disabled: busy });
    children.push({ type: "row", key: "commit-tools", gap: 6, wrap: true, children: [
      button("commit", "Commit selected", "commit", { variant: "primary", disabled: busy || !picked.length || !a.message.trim() }),
      button("commitPush", "Commit & push", "commitPush", { disabled: busy || !picked.length || !a.message.trim() }),
      { type: "label", key: "hint", text: "Commits the complete contents of selected files.", size: "xs", color: "muted", wrap: true },
    ] });
    if (newSet) children.push({ type: "modal", key: "new-set", title: "New changeset", closeAction: "cancelSet", children: [
      ...(error ? [{ type: "status", key: "set-error", text: error, level: "error" } as UiNode] : []),
      { type: "textInput", key: "set-name", placeholder: "Changeset name", submitAction: "createSet" },
      { type: "label", key: "hint", text: "Selected files will move into this changeset.", color: "muted", size: "sm" },
      button("createSet", "Create", "createSet", { variant: "primary" }),
    ] });
    const stashes = stashModal(busy, current, picked);
    if (stashes) children.push(stashes);
    return { type: "column", key: "git-root", gap: 8, padding: 10, grow: true, children };
  },
  async onEvent(ctx, ev) {
    if (!ws || busy) return;
    const id = ws.id;
    try {
      const a = active(), d = draft();
      if (ev.action === "filter") query = String(ev.value ?? "");
      else if (ev.action === "message") { a.message = String(ev.value ?? ""); await save(ctx); }
      else if (ev.action === "folder") { const key = String(ev.value); collapsed.has(key) ? collapsed.delete(key) : collapsed.add(key); }
      else if (ev.action.startsWith("folderCheck:")) {
        const token = ev.action.slice("folderCheck:".length), split = token.indexOf(":"), scope = token.slice(0, split), path = token.slice(split + 1);
        const group = files().filter(f => f.path.startsWith(path + "/") && (f.kind === "untracked") === (scope === "untracked") && f.path.toLowerCase().includes(query.toLowerCase()));
        const remove = group.every(f => selected.has(f.path));
        for (const f of group) remove ? selected.delete(f.path) : selected.add(f.path);
      }
      else if (ev.action.startsWith("check:")) { const p = ev.action.slice(6); selected.has(p) ? selected.delete(p) : selected.add(p); }
      else if (ev.action.startsWith("group:")) {
        const group = files().filter(f => f.path.toLowerCase().includes(query.toLowerCase()) && (f.kind === "untracked") === (ev.action === "group:true"));
        const remove = group.every(f => selected.has(f.path)); for (const f of group) remove ? selected.delete(f.path) : selected.add(f.path);
      } else if (ev.action === "set") { d.active = String(ev.value ?? ev.rowKey); selected.clear(); await save(ctx); }
      else if (ev.action === "newSet") newSet = true;
      else if (ev.action === "cancelSet") newSet = false;
      else if (ev.action === "createSet" || ev.action === "move") {
        let target = String(ev.value ?? ev.rowKey ?? "");
        if (ev.action === "createSet") {
          const name = (ev.inputs["set-name"] || "").trim(); if (!name) throw new Error("Enter a changeset name");
          target = crypto.randomUUID(); d.sets.push({ id: target, name, paths: [], message: "" }); newSet = false;
        }
        if (!d.sets.some(s => s.id === target)) throw new Error("Unknown changeset");
        const paths = files().filter(f => selected.has(f.path)).map(f => f.path);
        for (const s of d.sets) s.paths = s.paths.filter(p => !paths.includes(p));
        if (target !== "main") d.sets.find(s => s.id === target)!.paths.push(...paths);
        d.active = target; selected.clear(); await save(ctx);
      } else if (ev.action === "removeSet" && a.id !== "main") { d.sets = d.sets.filter(s => s !== a); d.active = "main"; selected.clear(); await save(ctx); }
      else if (ev.action === "edit") await ctx.modules.call("workspace", "view.patch", { workspaceId: id, patch: { previewPath: String(ev.value) } });
      else if (ev.action === "diff") await ctx.modules.call("workspace", "view.patch", { workspaceId: id, patch: { previewPath: diffTab(String(ev.value)) } });
      else if (ev.action === "refresh") await refresh(ctx);
      else if (ev.action.startsWith("stash.")) await stashEvent(ctx, ev, stashEnv(ctx, id));
      else {
        busy = true; error = ""; notice = ""; ctx.ui.invalidate();
        if (ev.action === "commit" || ev.action === "commitPush") {
          const paths = files().filter(f => selected.has(f.path)).map(f => f.path);
          const r = await ctx.modules.call("git", "commit", { workspaceId: id, paths, message: a.message }, { timeoutMs: 120000 });
          a.message = ""; if (ws?.id === id) { selected.clear(); await save(ctx); notice = r.output; }
          if (ev.action === "commitPush") {
            try { await ctx.modules.call("git", "network", { workspaceId: id, operation: "push" }, { timeoutMs: 120000 }); }
            catch (e) { throw new Error(`Commit succeeded; push failed. Use Push to retry. ${errMsg(e)}`); }
          }
        } else if (["fetch", "pull", "push"].includes(ev.action)) {
          const r = await ctx.modules.call("git", "network", { workspaceId: id, operation: ev.action }, { timeoutMs: 120000 }); if (ws?.id === id) notice = r.output || "Done";
        }
        if (ws?.id === id) await refresh(ctx);
      }
    } catch (e) { if (ws?.id === id) error = errMsg(e); }
    finally { busy = false; ctx.ui.invalidate(); }
  },
};
export default mod;
