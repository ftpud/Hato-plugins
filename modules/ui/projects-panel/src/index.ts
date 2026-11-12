import { filterInput } from "@hato/sdk/filter-style";
// projects-panel: left tree of projects and their Git task worktrees.
// Clicking a row selects a workspace; clicking the chevron expands/collapses (separate events).
import type { AppModule, ModuleContext, TreeRow, UiNode } from "@hato/sdk/types";
import { errMsg, wslLocation } from "@hato/sdk/runtime";
import { uiIcons } from "@hato/sdk/ui-icons";
import { exportSettings } from "@hato/sdk/settings";
import { addProjectModal, localRequest, sourcesFor, sshRequest, wslRequest, type AddSource, type FieldErrors, type SshAuth } from "./add-project";
import { taskDialog, taskBranchChoice, branchValue } from "./task-dialog";
import { projectsBranding } from "./branding";

let tree: any[] = [];
let selected: string | null = null;
let error: string | null = null;
let treeError: string | null = null;
let notice: string | null = null;
let busy: string | null = null;
let addForm = false;
let addSource: AddSource = "local";
let sshAuth: SshAuth = "agent";
let addValues: Record<string, string> = {};
let fieldErrors: FieldErrors = {};
let wslDistros: string[] = [];
let wslDistro = "";
let filter = "";
let backgroundOpacity = 0.12;
// Row hover fill opacity: a translucent hover keeps the branding background visible.
let hoverOpacity = 0.45;
let taskFormFor: string | null = null;
let taskBranches: any[] = [], taskBranch = "", taskQuery = "";
let taskBranchLoading = false, taskRequest = 0;
// Pending destructive/branch action awaiting confirmation in a modal.
type Confirm = { kind: "merge" | "deleteTask" | "removeProject"; id: string; name: string; deleteBranch: boolean; force: boolean; removeAfter: boolean };
let confirm: Confirm | null = null;
const taskMenu = (t: any) => [
  { text: "Merge into project branch…", action: "askMerge", value: t.id, disabled: t.status !== "ready" },
  { text: "Delete task…", action: "askDeleteTask", value: t.id },
];
const projectMenu = (p: any) => [
  { text: p.tasks.length ? "Remove from Hato (delete its tasks first)" : "Remove from Hato…", action: "askRemoveProject", value: p.id, disabled: p.tasks.length > 0 },
];
// workspaceId -> number of working AI chats (ai-sessions) and background agents (persistent-agents).
let chatBusy: Record<string, number> = {};
let agentBusy: Record<string, number> = {};
let aiBusy: Record<string, number> = {};
let windows = false;
const busyText = (n: number) => `AI working${n > 1 ? ` (${n})` : ""}`;
// Busy rows swap their icon for a rotating spinner; frames only tick while something is working.
let frame = 0;
let animation: ReturnType<typeof setInterval> | null = null;
const spinnerSvg = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8" opacity="0.2"/><path d="M12 4a8 8 0 0 1 8 8" stroke-linecap="round" transform="rotate(${frame * 30} 12 12)"/></svg>`;
function updateBusy(ctx: ModuleContext) {
  aiBusy = { ...chatBusy };
  for (const [k, n] of Object.entries(agentBusy)) aiBusy[k] = (aiBusy[k] || 0) + n;
  const working = Object.values(aiBusy).some((n) => n > 0);
  if (working && !animation) animation = setInterval(() => { frame = (frame + 1) % 12; ctx.ui.invalidate(); }, 80);
  else if (!working && animation) { clearInterval(animation); animation = null; }
  ctx.ui.invalidate();
}
const asCounts = (v: any): Record<string, number> => (v && typeof v === "object" ? v : {});

// workspaceId -> uncommitted line counts against HEAD (git status numstat).
let diffStats: Record<string, { added: number; removed: number }> = {};
let statsTimer: ReturnType<typeof setTimeout> | null = null;
const statsInflight = new Set<string>();
async function refreshStats(ctx: ModuleContext, workspaceId: string) {
  if (statsInflight.has(workspaceId)) return;
  statsInflight.add(workspaceId);
  try {
    const r = await ctx.modules.call("git", "status", { workspaceId }, { timeoutMs: 45000 });
    let added = 0, removed = 0;
    for (const f of r?.files || []) { added += Number(f.additions) || 0; removed += Number(f.deletions) || 0; }
    diffStats = { ...diffStats, [workspaceId]: { added, removed } };
  } catch { const { [workspaceId]: _, ...rest } = diffStats; diffStats = rest; }
  finally { statsInflight.delete(workspaceId); ctx.ui.invalidate(); }
}
/** Refresh stats for every reachable Git workspace (debounced); offline projects are skipped. */
function scheduleStats(ctx: ModuleContext, only?: string) {
  if (only) { void refreshStats(ctx, only); return; }
  if (statsTimer) clearTimeout(statsTimer);
  statsTimer = setTimeout(() => {
    statsTimer = null;
    for (const p of tree) {
      if (!p.isGit || p.offline || p.needsPassword) continue;
      void refreshStats(ctx, `project:${p.id}:root`);
      for (const t of p.tasks) if (t.status === "ready") void refreshStats(ctx, `task:${t.id}`);
    }
  }, 300);
}
function statBadges(workspaceId: string) {
  const s = diffStats[workspaceId];
  if (!s || (!s.added && !s.removed)) return undefined;
  return [{ text: `+${s.added}`, color: "success" }, { text: `−${s.removed}`, color: "danger" }];
}

async function reload(ctx: ModuleContext) {
  try { tree = await ctx.modules.call("projects", "tree"); treeError = null; scheduleStats(ctx); }
  catch (e) { treeError = errMsg(e); }
  ctx.ui.invalidate();
}

/** Privacy: show a neutral label instead of an SSH project's user and host (e.g. when screen sharing). */
let hideRemoteAddress = false;
let remoteLabel = "Remote";
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Replace `user@host[:port]` and the bare host inside service messages such as connection errors. */
function maskAddress(text: string, p: any): string {
  // The projects service reports SSH hosts as `user@host[:port]`.
  const host = String(p.host || "").trim().replace(/^[^@]*@/, "").replace(/:\d+$/, "");
  if (!host) return text;
  return text.replace(new RegExp(`(?:[^\\s@]+@)?${escapeRe(host)}(?::\\d+)?`, "g"), remoteLabel);
}

function rows(): TreeRow[] {
  const out: TreeRow[] = [];
  const query = filter.trim().toLowerCase();
  for (const p of tree) {
    const key = `project:${p.id}:root`;
    const masked = hideRemoteAddress && p.kind === "ssh" && p.transport !== "wsl";
    const projectMatches = !query || [p.name, p.rootPath, masked ? remoteLabel : p.host].some(value => String(value || "").toLowerCase().includes(query));
    const tasks = projectMatches ? p.tasks : p.tasks.filter((task: any) => [task.name, task.branch].some(value => String(value || "").toLowerCase().includes(query)));
    if (!projectMatches && !tasks.length) continue;
    const location = masked ? remoteLabel : p.kind === "ssh" ? `${p.transport === "wsl" ? "WSL" : "SSH"} · ${p.host || p.rootPath}` : p.rootPath;
    const offline = p.offline && masked ? maskAddress(String(p.offline), p) : p.offline;
    const open = !!query || p.expanded;
    // A collapsed project also reports activity in its hidden tasks.
    const busyCount = (aiBusy[key] || 0) + (open ? 0 : p.tasks.reduce((n: number, t: any) => n + (aiBusy[`task:${t.id}`] || 0), 0));
    out.push({
      key, label: p.name, depth: 0, expandable: tasks.length > 0, expanded: !!query || p.expanded, selected: selected === key,
      badge: p.needsPassword ? "Connect" : p.offline ? "Offline" : tasks.length ? `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}` : undefined,
      detail: p.needsPassword ? `Password needed · ${location}` : offline ? `Offline · ${offline}` : busyCount ? `${busyText(busyCount)} · ${location}` : location,
      badges: statBadges(key), contextMenu: projectMenu(p),
      icon: p.offline ? "warning" : p.kind === "ssh" ? "remote" : "folder",
      iconSvg: busyCount ? spinnerSvg() : p.offline ? uiIcons.warning : p.kind === "ssh" ? uiIcons.terminal : uiIcons.folder, iconColor: busyCount ? "primary" : "muted", weight: "semibold",
    });
    if (query || p.expanded) for (const [index, t] of tasks.entries()) {
      const tk = `task:${t.id}`;
      const taskBusy = aiBusy[tk] || 0;
      out.push({ key: tk, label: t.name, connector: index === tasks.length - 1 ? "last" : "branch", depth: 1, expandable: false, expanded: false, selected: selected === tk,
        badge: t.status !== "ready" ? t.status : undefined, badges: statBadges(tk), contextMenu: taskMenu(t), detail: taskBusy ? `${busyText(taskBusy)} · ${t.branch}` : t.branch, icon: t.status === "ready" ? "task" : "warning",
        iconSvg: taskBusy ? spinnerSvg() : t.status === "ready" ? uiIcons["git-branch"] : uiIcons.warning, iconColor: taskBusy ? "primary" : "muted" });
    }
  }
  return out;
}

function selectedProject() {
  if (!selected) return null;
  const pm = /^project:(.+):root$/.exec(selected);
  if (pm) return tree.find((p) => p.id === pm[1]) || null;
  const tm = /^task:(.+)$/.exec(selected);
  if (tm) return tree.find((p) => p.tasks.some((t: any) => t.id === tm[1])) || null;
  return null;
}

function projectOfRow(rowKey: string | undefined) {
  const task = /^task:(.+)$/.exec(rowKey || "");
  if (task) return tree.find((p) => p.tasks.some((t: any) => t.id === task[1])) || null;
  return tree.find((p) => rowKey === `project:${p.id}:root`) || null;
}

async function loadDistros(ctx: ModuleContext) {
  try { wslDistros = await ctx.modules.call("projects", "wslDistributions", {}); wslDistro = wslDistros.includes(wslDistro) ? wslDistro : wslDistros[0] || ""; }
  catch (e) { error = errMsg(e); }
}

/** A prompt can wait for the user several times, on top of the connection itself. */
const CONNECT_TIMEOUT_MS = 960000;

function confirmModal(c: Confirm): UiNode {
  const errorNode: UiNode[] = error ? [{ type: "status", key: "confirm-error", text: error, level: "error" }] : [];
  const buttons = (primary: UiNode[]): UiNode => ({ type: "row", key: "confirm-buttons", gap: 4, children: [...primary,
    { type: "button", key: "confirm-cancel", text: "Cancel", action: "cancelConfirm", small: true }] });
  if (c.kind === "merge") return { type: "modal", key: "confirm", title: "Merge task", closeAction: "cancelConfirm", children: [
    { type: "label", key: "text", text: `Merge “${c.name}” into the branch checked out in its project. Uncommitted changes block the merge, and conflicts abort it without changing anything.`, size: "sm", wrap: true },
    ...errorNode,
    { type: "toggle", key: "remove-after", label: "Delete the task and its merged branch afterwards", checked: c.removeAfter, action: "toggleRemoveAfter" },
    buttons([
      { type: "button", key: "merge", text: "Merge", action: "confirmMerge", variant: "primary", small: true, disabled: !!busy },
      { type: "button", key: "squash", text: "Squash merge", action: "confirmSquash", small: true, disabled: !!busy },
    ]),
  ] };
  if (c.kind === "deleteTask") return { type: "modal", key: "confirm", title: "Delete task", closeAction: "cancelConfirm", children: [
    { type: "label", key: "text", text: `Delete “${c.name}”: removes its worktree folder and the task from Hato.`, size: "sm", wrap: true },
    ...errorNode,
    { type: "toggle", key: "delete-branch", label: "Also delete its branch", checked: c.deleteBranch, action: "toggleDeleteBranch" },
    { type: "toggle", key: "force", label: "Discard uncommitted changes and unmerged commits", checked: c.force, action: "toggleForce" },
    buttons([{ type: "button", key: "delete", text: "Delete task", action: "confirmDeleteTask", variant: "danger", small: true, disabled: !!busy }]),
  ] };
  return { type: "modal", key: "confirm", title: "Remove project", closeAction: "cancelConfirm", children: [
    { type: "label", key: "text", text: `Remove “${c.name}” from Hato? Files on disk are not touched; you can add the folder again later.`, size: "sm", wrap: true },
    ...errorNode,
    buttons([{ type: "button", key: "remove", text: "Remove project", action: "confirmRemoveProject", variant: "danger", small: true, disabled: !!busy }]),
  ] };
}

const mod: AppModule = {
  id: "projects-panel",
  moduleApiVersion: 1,
  async activate(ctx, prev) {
    windows = ctx.host?.env.info().platform === "windows";
    addSource = sourcesFor(windows)[0].id;
    if (prev) {
      taskFormFor = prev.taskFormFor || null; taskQuery = prev.taskQuery || ""; taskBranch = prev.taskBranch || ""; taskBranches = prev.taskBranches || []; addForm = !!prev.addForm; filter = prev.filter || ""; addValues = prev.addValues || {};
      if (sourcesFor(windows).some((source) => source.id === prev.addSource)) addSource = prev.addSource;
      if (prev.sshAuth === "key" || prev.sshAuth === "password") sshAuth = prev.sshAuth;
      if (addForm && windows) await loadDistros(ctx);
    }
    const sel: any = ctx.state.get("workspace.selected");
    selected = sel ? sel.id : null;
    ctx.state.watch("workspace.selected", (v: any) => { selected = v ? v.id : null; ctx.ui.invalidate(); });
    const updateBackground = (value: any) => {
      backgroundOpacity = typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.12;
      ctx.ui.invalidate();
    };
    updateBackground(ctx.state.get("workspace-layout.projectsBackgroundOpacity"));
    const savedHover = Number(await ctx.modules.call("persistence", "settings.get", { key: "projects-panel.hoverOpacity" }).catch(() => null));
    if (Number.isFinite(savedHover) && savedHover >= 0.1 && savedHover <= 1) hoverOpacity = savedHover;
    const privacy: any = await ctx.modules.call("persistence", "settings.get", { key: "projects-panel.remoteAddress" }).catch(() => null);
    if (privacy && typeof privacy === "object") {
      hideRemoteAddress = privacy.hide === true;
      if (typeof privacy.label === "string" && privacy.label.trim()) remoteLabel = privacy.label.trim();
    }
    const savePrivacy = () => ctx.modules.call("persistence", "settings.set", { key: "projects-panel.remoteAddress", value: { hide: hideRemoteAddress, label: remoteLabel } });
    exportSettings(ctx, () => [{ key: "projects-panel", title: "Projects", fields: [
      { key: "hoverOpacity", label: "Row hover opacity", type: "range", value: String(Math.round(hoverOpacity * 100)), min: 10, max: 100, step: 5, unit: "%",
        description: "How solid the highlight is when the pointer is over a project or task." },
      { key: "hideRemoteAddress", label: "Hide SSH user and host", type: "toggle", value: hideRemoteAddress,
        description: "Show a label instead of user@host under SSH projects, for example while screen sharing." },
      { key: "remoteLabel", label: "Label for SSH projects", type: "text", value: remoteLabel, placeholder: "Remote",
        description: "Shown instead of the SSH address when it is hidden." },
    ] }], async (_section, key, value) => {
      if (key === "hideRemoteAddress" && typeof value === "boolean") { hideRemoteAddress = value; await savePrivacy(); ctx.ui.invalidate(); return; }
      if (key === "remoteLabel" && typeof value === "string") { remoteLabel = value.trim().slice(0, 40) || "Remote"; await savePrivacy(); ctx.ui.invalidate(); return; }
      const v = Math.round(Number(value)) / 100;
      if (key !== "hoverOpacity" || !Number.isFinite(v) || v < 0.1 || v > 1) throw new Error("Invalid projects setting");
      await ctx.modules.call("persistence", "settings.set", { key: "projects-panel.hoverOpacity", value: v });
      hoverOpacity = v; ctx.ui.invalidate();
    });
    ctx.state.watch("workspace-layout.projectsBackgroundOpacity", updateBackground);
    chatBusy = asCounts(ctx.state.get("ai-sessions.busy"));
    agentBusy = asCounts(ctx.state.get("persistent-agents.busy"));
    ctx.state.watch("ai-sessions.busy", (v: any) => { chatBusy = asCounts(v); updateBusy(ctx); });
    ctx.state.watch("persistent-agents.busy", (v: any) => { agentBusy = asCounts(v); updateBusy(ctx); });
    updateBusy(ctx);
    ctx.events.on("projects.changed", () => reload(ctx));
    ctx.events.on("git-tasks.changed", () => reload(ctx));
    // Keep +/− counts current: git operations and the visible Git panel's status refresh.
    for (const topic of ["git.changed", "git-panel.statusChanged", "files.changed"])
      ctx.events.on(topic, (e: any) => { if (typeof e?.workspaceId === "string") scheduleStats(ctx, e.workspaceId); });
    if (prev?.diffStats) diffStats = prev.diffStats;
    await reload(ctx);
  },
  deactivate() { taskRequest++; if (animation) clearInterval(animation); animation = null; if (statsTimer) clearTimeout(statsTimer); statsTimer = null; },
  snapshot: () => ({ taskFormFor, taskQuery, taskBranch, taskBranches, addForm, addSource, sshAuth, addValues, filter, diffStats }),
  render(): UiNode {
    const proj = selectedProject();
    const visibleRows = rows();
    const children: UiNode[] = [
      { type: "row", key: "hdr", gap: 3, children: [
        { type: "textInput", key: "project-filter", ...filterInput, prefixSvg: uiIcons.search, placeholder: "Filter projects", value: filter, changeAction: "filter", grow: true },
        { type: "button", key: "add-project", text: "", iconSvg: uiIcons["plus"], action: "showAdd", small: true, variant: "ghost", tooltip: "Add project", disabled: !!busy },
        { type: "button", key: "refresh", text: "", iconSvg: uiIcons["refresh"], action: "refresh", small: true, variant: "ghost", tooltip: "Refresh projects", disabled: !!busy },
      ] },
      { type: "row", key: "summary", gap: 4, children: [
        { type: "label", key: "count", text: `${tree.length} ${tree.length === 1 ? "project" : "projects"}`, size: "xs", color: "muted", grow: true },
        ...(proj?.isGit && proj.hasCommits !== false ? [{ type: "button", key: "new-task", text: "New task", iconSvg: uiIcons["git-branch"], action: "newTask", small: true, variant: "ghost", tooltip: `Create a worktree in ${proj.name}`, disabled: !!busy } as UiNode] : []),
      ] },
    ];
    if ((error || treeError) && !addForm && !confirm) children.push({ type: "status", key: "err", text: (error || treeError)!, level: "error" });
    if (notice) children.push({ type: "status", key: "notice", text: notice, level: "warn" });
    if (busy) children.push({ type: "progress", key: "busy", indeterminate: true, label: busy });
    if (!visibleRows.length) children.push({ type: "label", key: "empty", text: filter.trim() ? "No matching projects or tasks." : "Add a project to get started.", size: "sm", color: "muted", padding: 8 });
    children.push({ type: "tree", key: "tree", hoverOpacity: hoverOpacity, rowHeight: 42, rowGap: 0, iconSize: 18, rows: visibleRows, selectAction: "selectWorkspace", expandAction: "toggleExpanded", grow: true });
    if (proj && proj.isGit && proj.hasCommits !== false) {
      if (taskFormFor === proj.id) {
        children.push(taskDialog({ branches: taskBranches, query: taskQuery, selected: taskBranch,
          loading: taskBranchLoading, busy: !!busy, error }));
      }
    }
    if (confirm) children.push(confirmModal(confirm));
    if (addForm) children.push(addProjectModal({ windows, source: addSource, sshAuth, values: addValues, errors: fieldErrors, error, busy, distros: wslDistros, distro: wslDistro }));
    return { type: "column", key: "projects-root", gap: 4, padding: 6, grow: true,
      ...(backgroundOpacity > 0 ? { backgroundImage: projectsBranding, backgroundImageStyle: { opacity: backgroundOpacity, width: 960, left: -350, top: -60 } } : {}), children };
  },
  async onEvent(ctx, ev) {
    const run = async (label: string, fn: () => Promise<any>) => {
      busy = label; error = null; ctx.ui.invalidate();
      try { return await fn(); } catch (e) { error = errMsg(e); return null; } finally { busy = null; await reload(ctx); }
    };
    // Typing is kept while a connection is under way.
    if (ev.action === "addField") { addValues = { ...addValues, [ev.key]: String(ev.value ?? "") }; delete fieldErrors[ev.key]; ctx.ui.invalidate(); return; }
    if (busy) return;
    const closeAdd = () => { addForm = false; addValues = {}; fieldErrors = {}; };
    const openAdd = async (source: AddSource) => {
      addForm = true; addSource = source; error = null; fieldErrors = {};
      if (source === "wsl") await loadDistros(ctx);
    };
    switch (ev.action) {
      case "filter": filter = String(ev.value || ""); break;
      case "refresh": error = null; await reload(ctx); break;
      case "showAdd": await openAdd(sourcesFor(windows).some((source) => source.id === addSource) ? addSource : sourcesFor(windows)[0].id); break;
      case "hideAdd": addForm = false; error = null; fieldErrors = {}; break;
      case "addSource": await openAdd(ev.value as AddSource); break;
      case "selectWorkspace":
        error = null;
        selected = ev.rowKey || null; ctx.ui.invalidate();
        // Clicking a project is the gesture that may ask for its password; nothing else prompts.
        {
          const project = projectOfRow(ev.rowKey);
          if (project?.auth === "password") await run("Connecting…", () => ctx.modules.call("projects", "connect", { projectId: project.id }, { timeoutMs: CONNECT_TIMEOUT_MS }));
        }
        try { await ctx.modules.call("workspace", "select", { workspaceId: ev.rowKey }); } catch (e) { error = errMsg(e); }
        break;
      case "toggleExpanded": {
        const m = /^project:(.+):root$/.exec(ev.rowKey || "");
        const p = m && tree.find((x) => x.id === m[1]);
        if (p) await ctx.modules.call("projects", "setExpanded", { projectId: p.id, expanded: !p.expanded });
        break;
      }
      case "browse": {
        const path = await run("Choosing a folder…", () => ctx.modules.call("projects", "pickFolder", {}));
        if (!path) break;
        if (!windows) { addValues = { ...addValues, "local-path": path }; break; }
        const location = wslLocation(path);
        if (!location) { error = "Choose a folder under \\\\wsl.localhost, inside a WSL distribution."; break; }
        if (wslDistros.includes(location.distro)) wslDistro = location.distro;
        addValues = { ...addValues, "wsl-path": location.remotePath };
        break;
      }
      case "addLocalPath": {
        const parsed = localRequest({ ...addValues, ...ev.inputs });
        fieldErrors = parsed.errors;
        if (parsed.request && await run("Adding project…", () => ctx.modules.call("projects", "addLocal", parsed.request))) closeAdd();
        break;
      }
      case "showWsl": await openAdd("wsl"); break;
      case "wslDistro": wslDistro = String(ev.value || ""); break;
      case "addWsl": {
        const parsed = wslRequest({ ...addValues, ...ev.inputs }, wslDistro);
        fieldErrors = parsed.errors;
        if (parsed.request && await run("Connecting to WSL…", () => ctx.modules.call("projects", "addWsl", parsed.request, { timeoutMs: 120000 }))) closeAdd();
        break;
      }
      case "showSsh": await openAdd("ssh"); break;
      case "sshAuth": if (ev.value === "agent" || ev.value === "key" || ev.value === "password") sshAuth = ev.value; break;
      case "addSsh": {
        const parsed = sshRequest({ ...addValues, ...ev.inputs }, sshAuth);
        fieldErrors = parsed.errors;
        if (parsed.request && await run("Connecting over SSH…", () => ctx.modules.call("projects", "addSsh", parsed.request, { timeoutMs: CONNECT_TIMEOUT_MS }))) closeAdd();
        break;
      }
      case "askMerge": case "askDeleteTask": {
        const project = tree.find((p) => p.tasks.some((t: any) => t.id === ev.value));
        const task = project?.tasks.find((t: any) => t.id === ev.value);
        if (task) { error = null; confirm = { kind: ev.action === "askMerge" ? "merge" : "deleteTask", id: task.id, name: task.name, deleteBranch: false, force: false, removeAfter: false }; }
        break;
      }
      case "askRemoveProject": {
        const project = tree.find((p) => p.id === ev.value);
        if (project) { error = null; confirm = { kind: "removeProject", id: project.id, name: project.name, deleteBranch: false, force: false, removeAfter: false }; }
        break;
      }
      case "cancelConfirm": confirm = null; error = null; break;
      case "toggleDeleteBranch": if (confirm) confirm = { ...confirm, deleteBranch: !confirm.deleteBranch }; break;
      case "toggleForce": if (confirm) confirm = { ...confirm, force: !confirm.force }; break;
      case "toggleRemoveAfter": if (confirm) confirm = { ...confirm, removeAfter: !confirm.removeAfter }; break;
      case "confirmMerge": case "confirmSquash": {
        const c = confirm; if (!c) break;
        const r = await run("Merging task…", () => ctx.modules.call("git-tasks", "merge", { taskId: c.id, squash: ev.action === "confirmSquash" }, { timeoutMs: 300000 }));
        if (!r) break;
        let message = r.merged ? `Merged ${r.branch} into ${r.target}${r.commits ? ` (${r.commits} commit${r.commits === 1 ? "" : "s"})` : ""}.` : r.message;
        if (c.removeAfter && r.merged) {
          // A squash merge leaves the branch unmerged by ancestry, so only -d after a real merge.
          const removed = await run("Deleting task…", () => ctx.modules.call("git-tasks", "remove", { taskId: c.id, deleteBranch: r.squash ? "force" : "merged" }, { timeoutMs: 180000 }));
          if (!removed) break;
          if (removed.warning) message += ` ${removed.warning}`;
        }
        confirm = null; notice = message;
        break;
      }
      case "confirmDeleteTask": {
        const c = confirm; if (!c) break;
        const r = await run("Deleting task…", () => ctx.modules.call("git-tasks", "remove", { taskId: c.id, force: c.force, deleteBranch: c.deleteBranch ? (c.force ? "force" : "merged") : false }, { timeoutMs: 180000 }));
        if (r) { confirm = null; notice = r.warning || null; }
        break;
      }
      case "confirmRemoveProject": {
        const c = confirm; if (!c) break;
        if (await run("Removing project…", () => ctx.modules.call("projects", "remove", { projectId: c.id }))) confirm = null;
        break;
      }
      case "newTask": {
        taskFormFor = selectedProject()?.id || null; notice = null; taskBranch = ""; taskQuery = ""; taskBranches = []; taskBranchLoading = true; error = null; const request = ++taskRequest; ctx.ui.invalidate();
        const id = taskFormFor;
        try {
          const r = await ctx.modules.call("git", "branches", { workspaceId: `project:${id}:root` });
          if (taskRequest === request && taskFormFor === id) taskBranches = [...r.local, ...r.remote.map((b: any) => ({ ...b, remote: true }))];
        } catch (e) { if (taskRequest === request && taskFormFor === id) error = errMsg(e); }
        finally { if (taskRequest === request) taskBranchLoading = false; } break;
      }
      case "taskBranchSearch": taskQuery = String(ev.value ?? ""); taskBranch = ""; error = null; break;
      case "pickTaskBranch": {
        const branch = taskBranches.find(b => branchValue(b) === String(ev.value ?? ev.rowKey ?? ""));
        if (branch) { taskBranch = branchValue(branch); taskQuery = branch.name; error = null; }
        break;
      }
      case "newTaskBranch": taskBranch = taskQuery.trim(); error = null; break;
      case "cancelTask": taskFormFor = null; taskRequest++; taskBranchLoading = false; error = null; break;
      case "createTask": {
        const projectId = taskFormFor;
        if (!projectId || taskBranchLoading) break;
        let choice: { name: string; branch: string };
        try {
          const query = ev.inputs["task-branch-search"] ?? taskQuery;
          choice = taskBranchChoice(taskBranches, query, query.trim() === taskQuery.trim() ? taskBranch : "");
        }
        catch (e) { error = errMsg(e); break; }
        const { name, branch } = choice;
        const r = await run("Creating worktree…", () => ctx.modules.call("git-tasks", "create", { projectId, name, branch }, { timeoutMs: 300000 }));
        if (r) { taskFormFor = null; notice = r.warning || null; }
        break;
      }
    }
    ctx.ui.invalidate();
  },
};
export default mod;
