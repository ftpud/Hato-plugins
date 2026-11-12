// Stashes dialog for the Git changes panel: save (all or selected files), browse with a file
// list and diff preview, and pop/apply/branch/delete or restore a single file. All Git work runs
// in the `git` service; this file only owns presentation and the dialog's view state.
import type { ModuleContext, TreeRow, UiNode } from "@hato/sdk/types";
import { errMsg } from "@hato/sdk/runtime";
import { fileIcons } from "@hato/sdk/file-icons";
import { uiIcons } from "@hato/sdk/ui-icons";
import { COLOR, LABEL, LETTER } from "./model";

export interface Stash { id: string; ref: string; name: string; branch: string; message: string; base: string; date: number; untracked: boolean }
interface StashFile { path: string; kind: string }
type Confirm = { kind: "drop" | "branch" | "restore"; id: string; path?: string; untracked?: boolean };
type Level = "info" | "warn" | "success" | "error";

export const stashIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4"/></svg>`;

const S = {
  open: false, list: [] as Stash[], chosen: "", file: "",
  files: [] as StashFile[], filesFor: "", document: null as string | null, docFor: "", empty: false, detailError: "",
  confirm: null as Confirm | null, query: "", untracked: true, onlySelected: false, mode: "unified" as "unified" | "split",
  message: "", level: "info" as Level, seq: 0,
};

export interface StashEnv {
  workspaceId: string;
  current(): boolean;
  /** Changed files in the active changeset and those ticked for commit. */
  changes(): { path: string; kind: string }[];
  picked(): { path: string; kind: string }[];
  /** Marks the panel busy around a mutation and refreshes Git status afterwards. */
  mutate(work: () => Promise<void>): Promise<void>;
}

export const stashCount = () => S.list.length;
export function resetStashes() {
  Object.assign(S, { open: false, list: [], chosen: "", file: "", files: [], filesFor: "", document: null, docFor: "", confirm: null, query: "", message: "", detailError: "" });
}
export async function loadStashPreferences(ctx: ModuleContext) {
  const [untracked, mode] = await Promise.all(["git-panel.stashUntracked", "git-panel.stashDiffMode"].map(key => ctx.modules.call("persistence", "settings.get", { key })));
  if (typeof untracked === "boolean") S.untracked = untracked;
  if (mode === "split" || mode === "unified") S.mode = mode;
}
/** Refresh the list (cheap; also feeds the toolbar badge). Detail reloads only if the dialog is open. */
export async function loadStashes(ctx: ModuleContext, workspaceId: string, current: () => boolean) {
  const list = await ctx.modules.call("git", "stashes", { workspaceId }).catch(() => null);
  if (!current() || !Array.isArray(list)) return;
  const changed = list.map((s: Stash) => s.id).join() !== S.list.map(s => s.id).join();
  S.list = list;
  if (!S.list.some(s => s.id === S.chosen)) { S.chosen = S.list[0]?.id || ""; S.file = ""; }
  if (S.confirm && !S.list.some(s => s.id === S.confirm!.id)) S.confirm = null;
  if (S.open && (changed || S.docFor !== S.chosen)) await loadDetail(ctx, workspaceId, current, changed);
}
async function loadDetail(ctx: ModuleContext, workspaceId: string, current: () => boolean, force = false) {
  const id = S.chosen;
  if (!id) { S.files = []; S.document = null; S.filesFor = S.docFor = ""; return; }
  if (!force && S.docFor === id && S.filesFor === id) return;
  S.document = null; S.files = []; S.filesFor = S.docFor = ""; S.detailError = "";
  ctx.ui.invalidate();
  try {
    const [files, diff] = await Promise.all([
      ctx.modules.call("git", "stashFiles", { workspaceId, id }),
      ctx.modules.call("git", "stashDiff", { workspaceId, id }, { timeoutMs: 45000 }),
    ]);
    if (!current() || S.chosen !== id) return;
    S.files = files.files; S.filesFor = id; S.document = diff.document; S.docFor = id; S.empty = diff.empty;
  } catch (e) { if (current() && S.chosen === id) { S.detailError = errMsg(e); S.docFor = S.filesFor = id; } }
}

export function stashTitle(s: Stash) {
  return s.message || (s.base ? `WIP: ${s.base.replace(/^[0-9a-f]{7,64} /, "")}` : "Untitled stash");
}
function ago(ms: number) {
  const s = (Date.now() - ms) / 1000;
  if (!Number.isFinite(s)) return "";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) { const d = Math.floor(s / 86400); return d === 1 ? "yesterday" : `${d} days ago`; }
  return new Date(ms).toISOString().slice(0, 10);
}
const when = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const btn = (key: string, text: string, action: string, extra: any = {}): UiNode =>
  ({ type: "button", key, text, action, small: true, variant: "ghost", ...extra });
const card = { background: "raised", borderWidth: 1, borderColor: "border", radius: 8, padding: 12, gap: 8 };

type Files = { path: string; kind: string }[];
function saveCard(busy: boolean, changes: Files, picked: Files): UiNode {
  const only = S.onlySelected && picked.length > 0;
  const count = only ? picked.length : changes.length;
  const untrackedNeeded = only && !S.untracked && picked.some(f => f.kind === "untracked");
  const skipped = !only && !S.untracked ? changes.filter(f => f.kind === "untracked").length : 0;
  const hint = !changes.length ? "There are no local changes to stash."
    : only ? `Stashes the ${plural(picked.length, "selected file")}; other changes stay in the working tree.${untrackedNeeded ? " Selected untracked files are included." : ""}`
    : `Stashes all ${plural(changes.length - skipped, "changed file")} and leaves a clean working tree.${skipped ? ` ${plural(skipped, "untracked file")} stay${skipped === 1 ? "s" : ""}.` : ""}`;
  return { type: "column", key: "save", children: [
    { type: "row", key: "save-head", gap: 8, align: "center", children: [
      { type: "label", key: "save-title", text: "Stash local changes", weight: "semibold", size: "sm", grow: true },
      { type: "label", key: "save-count", text: changes.length ? plural(changes.length, "changed file") : "Working tree clean", size: "xs", color: "muted" },
    ] },
    { type: "row", key: "save-input", gap: 8, align: "center", children: [
      { type: "textInput", key: `stash-message:${S.seq}`, grow: true, placeholder: "Describe these changes (optional)", submitAction: "stash.save", disabled: busy || !changes.length },
      btn("save", only ? `Stash ${plural(count, "file")}` : "Stash all", "stash.save", { variant: "primary", iconSvg: stashIcon, disabled: busy || !count,
        tooltip: only ? "Stash only the files ticked in Git changes" : "Stash every change in this workspace", style: { noShrink: true } }),
    ] },
    { type: "row", key: "save-options", gap: 16, wrap: true, align: "center", style: { noShrink: true }, children: [
      { type: "switch", key: "untracked", label: "Include untracked files", checked: S.untracked, action: "stash.untracked", disabled: busy },
      { type: "switch", key: "only", label: picked.length ? `Only selected files (${picked.length})` : "Only selected files", checked: only, action: "stash.onlySelected",
        disabled: busy || !picked.length, tooltip: picked.length ? "Stash just the files ticked in Git changes" : "Tick files in Git changes to stash only those" },
    ] },
    { type: "label", key: "save-hint", text: hint, size: "xs", color: "muted", wrap: true },
  ], style: { ...card, gap: 6, noShrink: true } };
}

function stashRows(list: Stash[]): TreeRow[] {
  return list.map(s => ({
    key: s.id, label: stashTitle(s), depth: 0, expandable: false, expanded: false, selected: s.id === S.chosen,
    detail: [s.branch && `on ${s.branch}`, ago(s.date), s.untracked ? "incl. untracked" : ""].filter(Boolean).join(" · "),
    badge: s.ref.replace(/^stash@\{(\d+)\}$/, "#$1"),
    iconSvg: stashIcon, iconColor: "muted",
    tooltip: `${s.name}\n${s.ref} · ${when(s.date)}\n${s.id}`,
    contextMenu: [
      { text: "Pop (apply and delete)", action: "stash.pop", value: s.id },
      { text: "Apply (keep stash)", action: "stash.apply", value: s.id },
      { separator: true },
      { text: "New branch from stash…", action: "stash.askBranch", value: s.id },
      { separator: true },
      { text: "Delete…", action: "stash.askDrop", value: s.id },
    ],
  }));
}

function confirmArea(s: Stash, busy: boolean): UiNode[] {
  const c = S.confirm;
  if (!c || c.id !== s.id) return [];
  const box = (key: string, tone: string, children: UiNode[]): UiNode => ({ type: "column", key, children,
    style: { background: tone, borderWidth: 1, borderColor: "border", radius: 6, padding: 10, gap: 8 } });
  if (c.kind === "drop") return [box("confirm-drop", "raised", [
    { type: "label", key: "q", text: `Delete “${stashTitle(s)}”? Its changes are lost unless they were applied elsewhere.`, wrap: true, size: "sm" },
    { type: "row", key: "a", gap: 6, children: [
      btn("yes", "Delete stash", "stash.drop", { variant: "danger", disabled: busy }), btn("no", "Cancel", "stash.cancel"),
    ] },
  ])];
  if (c.kind === "branch") return [box("confirm-branch", "raised", [
    { type: "label", key: "q", text: "Creates a branch at the commit the stash was made on, switches to it, applies the stash and deletes it if it applies cleanly.", wrap: true, size: "xs", color: "muted" },
    { type: "row", key: "a", gap: 6, align: "center", children: [
      { type: "textInput", key: "stash-branch", grow: true, placeholder: "new-branch-name", prefixSvg: uiIcons["git-branch"], submitAction: "stash.branch", disabled: busy },
      btn("yes", "Create and switch", "stash.branch", { variant: "primary", disabled: busy, style: { noShrink: true } }), btn("no", "Cancel", "stash.cancel", { style: { noShrink: true } }),
    ] },
  ])];
  return [box("confirm-restore", "raised", [
    { type: "label", key: "q", text: `${c.path} has local changes. Replace it with the stashed version?`, wrap: true, size: "sm" },
    { type: "row", key: "a", gap: 6, children: [
      btn("yes", "Replace file", "stash.confirmRestore", { variant: "danger", disabled: busy }), btn("no", "Cancel", "stash.cancel"),
    ] },
  ])];
}

function details(s: Stash, busy: boolean): UiNode {
  const ready = S.filesFor === s.id, file = S.files.find(f => f.path === S.file);
  const fileRows: TreeRow[] = S.files.map(f => {
    const at = f.path.lastIndexOf("/");
    return { key: f.path, label: f.path.slice(at + 1), badges: at < 0 ? [] : [{ text: f.path.slice(0, at), color: "muted" }], depth: 0, expandable: false, expanded: false,
      selected: f.path === S.file, iconSvg: fileIcons.file, iconColor: COLOR[f.kind] || "muted", badge: LETTER[f.kind] || "?",
      tooltip: `${f.path}\n${LABEL[f.kind] || f.kind}`,
      contextMenu: [{ text: f.kind === "deleted" ? "Deleted in stash; nothing to restore" : "Restore this file to the working tree", action: "stash.restore", value: f.path, disabled: f.kind === "deleted" }] };
  });
  return { type: "column", key: "detail", grow: true, gap: 8, children: [
    { type: "row", key: "head", gap: 8, align: "start", children: [
      { type: "column", key: "title", grow: true, gap: 2, children: [
        { type: "label", key: "name", text: stashTitle(s), weight: "semibold", wrap: true, selectable: true },
        { type: "label", key: "meta", size: "xs", color: "muted", wrap: true, selectable: true,
          text: [s.ref, s.branch && `on ${s.branch}`, s.base && `based on ${s.base}`, when(s.date), ready && !S.detailError ? plural(S.files.length, "file") : ""].filter(Boolean).join(" · ") },
      ] },
    ] },
    { type: "row", key: "actions", gap: 6, wrap: true, align: "center", children: [
      btn("pop", "Pop", "stash.pop", { value: s.id, variant: "primary", disabled: busy, tooltip: "Apply the changes and delete this stash" }),
      btn("apply", "Apply", "stash.apply", { value: s.id, variant: "default", disabled: busy, tooltip: "Apply the changes and keep this stash" }),
      btn("branch", "New branch…", "stash.askBranch", { value: s.id, iconSvg: uiIcons["git-branch"], disabled: busy, tooltip: "Restore the stash on a new branch where it applies cleanly" }),
      { type: "label", key: "gap", text: "", grow: true },
      btn("drop", "Delete…", "stash.askDrop", { value: s.id, iconSvg: uiIcons.trash, iconColor: "danger", disabled: busy, tooltip: "Delete this stash" }),
    ] },
    ...confirmArea(s, busy),
    ...(S.detailError ? [{ type: "status", key: "detail-error", text: S.detailError, level: "error" } as UiNode] : []),
    { type: "row", key: "files-head", gap: 6, align: "center", children: [
      { type: "label", key: "files-title", text: ready ? `Files · ${S.files.length}` : "Files", size: "xs", weight: "semibold", color: "muted", grow: true },
      ...(file ? [btn("restore", `Restore ${file.path.split("/").pop()}`, "stash.restore", { value: file.path, disabled: busy || file.kind === "deleted",
        tooltip: file.kind === "deleted" ? "The stash deletes this file; there is nothing to restore" : `Write the stashed ${file.path} to the working tree; the stash is kept` })] : []),
      btn("mode", S.mode === "split" ? "Unified" : "Side by side", "stash.mode", { tooltip: "Switch diff layout" }),
    ] },
    ready
      ? { type: "tree", key: `files:${s.id}`, rows: fileRows, rowHeight: 24, height: Math.min(Math.max(fileRows.length, 1), 5) * 24 + 4, indent: 0,
          selectAction: "stash.file", expandAction: "stash.noop", style: { borderWidth: 1, borderColor: "border", radius: 6 } }
      : { type: "progress", key: "files-loading", indeterminate: true, label: "Loading stash…" },
    { type: "diff", key: `diff:${s.id}`, document: S.docFor === s.id ? S.document : null, mode: S.mode, grow: true, softWrap: true,
      placeholder: "Loading changes…", emptyText: "This stash has no changes inside this workspace.",
      changeNavigation: { previous: "Previous change", next: "Next change" } },
  ] };
}

export function stashModal(busy: boolean, changes: Files, picked: Files): UiNode | null {
  if (!S.open) return null;
  const q = S.query.trim().toLowerCase();
  const shown = q ? S.list.filter(s => `${s.name} ${s.branch} ${s.ref}`.toLowerCase().includes(q)) : S.list;
  const chosen = S.list.find(s => s.id === S.chosen);
  const body: UiNode = !S.list.length
    ? { type: "column", key: "empty", align: "center", gap: 6, style: { paddingY: 36 }, children: [
        { type: "button", key: "empty-icon", text: "", action: "stash.noop", iconSvg: stashIcon, iconSize: 28, iconColor: "muted", variant: "ghost", disabled: true },
        { type: "label", key: "empty-title", text: "No stashes yet", weight: "semibold" },
        { type: "label", key: "empty-text", text: "Stash changes to set work aside without committing it, then pop it back later on this or any other branch.", color: "muted", size: "sm", wrap: true, style: { maxWidth: 420 } },
      ] }
    : { type: "column", key: "browser-box", height: 460, style: { noShrink: true }, children: [{ type: "split", key: "browser", direction: "horizontal", sizes: [0.36, 0.64], minSize: 200, grow: true, children: [
        { type: "column", key: "list", grow: true, gap: 6, style: { paddingX: 2 }, children: [
          { type: "row", key: "list-head", gap: 6, align: "center", children: [
            { type: "label", key: "list-title", text: `Saved · ${S.list.length}`, size: "xs", weight: "semibold", color: "muted", grow: true },
            btn("reload", "", "stash.refresh", { iconSvg: uiIcons.refresh, tooltip: "Reload stashes", disabled: busy }),
          ] },
          ...(S.list.length > 5 ? [{ type: "textInput", key: "stash-filter", value: S.query, placeholder: "Filter stashes…", changeAction: "stash.query", prefixSvg: uiIcons.search } as UiNode] : []),
          shown.length
            ? { type: "tree", key: "stash-list", grow: true, rows: stashRows(shown), rowHeight: 46, indent: 0, selectAction: "stash.select", expandAction: "stash.noop", activateAction: "stash.apply" }
            : { type: "label", key: "no-match", text: "No stashes match the filter.", color: "muted", size: "sm", padding: 8 },
          { type: "label", key: "list-hint", text: "Right-click for more actions · double-click to apply", size: "xs", color: "muted", wrap: true },
        ] },
        chosen ? details(chosen, busy) : { type: "label", key: "none", text: "Select a stash to see its changes.", color: "muted", padding: 12 },
      ] }] };
  return { type: "modal", key: "stashes", title: "Stashes", width: 900, closeAction: "stash.close", style: { padding: 18, gap: 12, radius: 10 }, children: [
    ...(S.message ? [{ type: "status", key: "stash-status", text: S.message, level: S.level } as UiNode] : []),
    ...(busy ? [{ type: "progress", key: "stash-busy", indeterminate: true } as UiNode] : []),
    saveCard(busy, changes, picked),
    body,
  ] };
}

/** Handles `stash.*` actions. Errors are shown inside the dialog. */
export async function stashEvent(ctx: ModuleContext, ev: { action: string; value?: any; rowKey?: string; inputs: Record<string, string> }, env: StashEnv) {
  const { workspaceId: id, current } = env;
  const target = String(ev.value ?? ev.rowKey ?? S.chosen);
  const stash = () => S.list.find(s => s.id === target);
  const say = (message: string, level: Level = "success") => { S.message = message; S.level = level; };
  const reload = () => loadStashes(ctx, id, current);
  const op = (operation: string, extra: any) => ctx.modules.call("git", "stash", { workspaceId: id, operation, ...extra }, { timeoutMs: 120000 });
  try {
    switch (ev.action) {
      case "stash.noop": return;
      case "stash.open":
        S.open = true; S.confirm = null; S.message = ""; S.onlySelected = env.picked().length > 0;
        ctx.ui.invalidate(); await reload(); await loadDetail(ctx, id, current); return;
      case "stash.close": S.open = false; S.confirm = null; S.message = ""; return;
      case "stash.query": S.query = String(ev.value ?? ""); return;
      case "stash.refresh": S.message = ""; await reload(); await loadDetail(ctx, id, current, true); return;
      case "stash.select":
        if (target === S.chosen) return;
        S.chosen = target; S.file = ""; S.confirm = null; await loadDetail(ctx, id, current); return;
      case "stash.file": S.file = String(ev.rowKey ?? ev.value ?? ""); return;
      case "stash.cancel": S.confirm = null; return;
      case "stash.untracked":
        S.untracked = !S.untracked; await ctx.modules.call("persistence", "settings.set", { key: "git-panel.stashUntracked", value: S.untracked }); return;
      case "stash.onlySelected": S.onlySelected = !S.onlySelected; return;
      case "stash.mode":
        S.mode = S.mode === "split" ? "unified" : "split"; await ctx.modules.call("persistence", "settings.set", { key: "git-panel.stashDiffMode", value: S.mode }); return;
      case "stash.askDrop": case "stash.askBranch":
        if (S.chosen !== target) { S.chosen = target; S.file = ""; void loadDetail(ctx, id, current).then(() => ctx.ui.invalidate()); }
        S.confirm = { kind: ev.action === "stash.askDrop" ? "drop" : "branch", id: target }; return;
    }
    S.message = "";
    await env.mutate(async () => {
      if (ev.action === "stash.save") {
        const picked = env.picked(), only = S.onlySelected && picked.length > 0;
        const message = (ev.inputs[`stash-message:${S.seq}`] || "").trim();
        const r = await op("save", { message, paths: only ? picked.map(f => f.path) : [],
          includeUntracked: S.untracked || (only && picked.some(f => f.kind === "untracked")) });
        if (/No local changes to save/.test(r.output || "")) { say("There were no local changes to stash.", "info"); return; }
        S.seq++; S.onlySelected = false; await reload();
        S.chosen = S.list[0]?.id || ""; S.file = ""; await loadDetail(ctx, id, current, true);
        say(`Stashed ${only ? plural(picked.length, "file") : "all changes"}${message ? ` as “${message}”` : ""}.`);
      } else if (ev.action === "stash.apply" || ev.action === "stash.pop") {
        const s = stash(); if (!s) throw new Error("Stash no longer exists; reload the list");
        const pop = ev.action === "stash.pop";
        const r = await op(pop ? "pop" : "apply", { id: s.id });
        await reload();
        if (r.conflicts) say(`Applied “${stashTitle(s)}” with conflicts. Resolve them in Git changes; the stash was kept.`, "warn");
        else say(pop ? `Popped “${stashTitle(s)}”; the stash was deleted.` : `Applied “${stashTitle(s)}”; the stash was kept.`);
      } else if (ev.action === "stash.drop") {
        const s = S.list.find(x => x.id === S.confirm?.id); if (!s) throw new Error("Stash no longer exists; reload the list");
        await op("drop", { id: s.id }); S.confirm = null; await reload();
        say(`Deleted “${stashTitle(s)}”.`, "info");
      } else if (ev.action === "stash.branch") {
        const s = S.list.find(x => x.id === S.confirm?.id), branch = (ev.inputs["stash-branch"] || "").trim();
        if (!s) throw new Error("Stash no longer exists; reload the list");
        if (!branch) throw new Error("Enter a name for the new branch");
        await op("branch", { id: s.id, branch }); S.confirm = null; await reload();
        say(`Switched to new branch ${branch} with “${stashTitle(s)}” applied.`);
      } else if (ev.action === "stash.restore" || ev.action === "stash.confirmRestore") {
        const confirmed = ev.action === "stash.confirmRestore";
        const path = confirmed ? S.confirm?.path : String(ev.value ?? S.file);
        const f = S.files.find(x => x.path === path), s = S.list.find(x => x.id === (confirmed ? S.confirm?.id : S.chosen));
        if (!f || !s) throw new Error("Select a file in the stash");
        if (!confirmed && env.changes().some(c => c.path === f.path)) { S.confirm = { kind: "restore", id: s.id, path: f.path, untracked: f.kind === "untracked" }; return; }
        await op("restore", { id: s.id, path: f.path, untracked: f.kind === "untracked" }); S.confirm = null;
        say(`Restored ${f.path} from the stash; the stash was kept.`);
      } else throw new Error(`Unknown stash action ${ev.action}`);
    });
  } catch (e) { if (current()) say(errMsg(e), "error"); }
}
