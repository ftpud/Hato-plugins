// File and selection history window: commits that changed the open file (or a block of its
// lines) on the left, loaded page by page as the list scrolls; the chosen commit's diff on the
// right. Opened from the editor's right-click menu; rendered as a native OS window.
import type { ModuleContext, UiNode } from "@hato/sdk/types";
import { errMsg } from "@hato/sdk/runtime";
import { diffLines } from "@hato/sdk/text-diff";

interface Commit { id: string; parents: string[]; author: string; email: string; date: string; subject: string; path: string; previousPath: string | null; status: string }
interface History {
  seq: number; workspaceId: string; path: string;
  /** Lines traced in the committed file (zero-based, inclusive), and as shown in the editor. */
  range: [number, number] | null; shown: [number, number] | null;
  head: string | null; commits: Commit[]; more: boolean; untracked: boolean;
  loading: boolean; error: string | null;
  chosen: string | null; document: string | null; diffLoading: boolean; empty: boolean;
  /** Selection history: show the commit's whole-file change instead of only the traced lines. */
  wholeFile: boolean;
}
let H: History | null = null;
let seq = 0, epoch = 0;
let size = { width: 1180, height: 760 };
const SIZE_KEY = "viewer.historyWindow";

/** Map editor lines `start..end` (zero-based, inclusive) to the committed file's lines, skipping
 *  lines added since. Lines replaced inside the range keep their committed counterparts. */
export function mapToCommitted(committed: string, text: string, start: number, end: number): [number, number] | null {
  const a = committed.split("\n"), b = text.split("\n");
  if (a.length > 20000 || b.length > 20000) return [start, end];
  let oldLine = 0, newLine = 0, first = -1, last = -1;
  const take = (line: number) => { if (first < 0) first = line; last = line; };
  for (const op of diffLines(a, b)) {
    if (op.kind === " ") { if (newLine >= start && newLine <= end) take(oldLine); oldLine++; newLine++; }
    else if (op.kind === "+") newLine++;
    else { if (newLine >= start && newLine <= end) take(oldLine); oldLine++; }
  }
  // A trailing newline yields an empty last element; never trace past the committed file.
  const lastLine = Math.max(0, a.length - (a[a.length - 1] === "" ? 2 : 1));
  return first < 0 ? null : [Math.min(first, lastLine), Math.min(last, lastLine)];
}

export async function restoreHistory(ctx: ModuleContext, prev: any) {
  const saved = await ctx.modules.call("persistence", "settings.get", { key: SIZE_KEY }).catch(() => null);
  if (saved && Number(saved.width) >= 480 && Number(saved.height) >= 320) size = { width: Number(saved.width), height: Number(saved.height) };
  if (prev?.history?.workspaceId) { H = { ...prev.history, loading: false, diffLoading: false }; seq = H!.seq; }
}
export const historySnapshot = () => H && { ...H, loading: false, diffLoading: false };

export async function openHistory(ctx: ModuleContext, request: { workspaceId: string; path: string; range: [number, number] | null; shown: [number, number] | null }) {
  epoch++;
  H = { seq: ++seq, ...request, head: null, commits: [], more: false, untracked: false, loading: false, error: null, chosen: null, document: null, diffLoading: false, empty: false, wholeFile: false };
  ctx.ui.invalidate();
  await loadPage(ctx);
}

async function loadPage(ctx: ModuleContext) {
  const h = H;
  if (!h || h.loading) return;
  const mine = epoch;
  h.loading = true; ctx.ui.invalidate();
  try {
    const r = await ctx.modules.call("git", "fileHistory", { workspaceId: h.workspaceId, path: h.path, head: h.head, skip: h.commits.length,
      ...(h.range ? { startLine: h.range[0], endLine: h.range[1] } : {}) }, { timeoutMs: 60000 });
    if (mine !== epoch || H !== h) return;
    h.head = r.head; h.untracked = !!r.untracked; h.more = !!r.more; h.error = null;
    const known = new Set(h.commits.map(c => c.id));
    h.commits.push(...(r.commits as Commit[]).filter(c => !known.has(c.id)));
    if (!h.chosen && h.commits.length) void choose(ctx, h.commits[0].id);
  } catch (e) { if (H === h) { h.error = errMsg(e); h.more = false; } }
  finally { if (H === h) h.loading = false; ctx.ui.invalidate(); }
}

async function choose(ctx: ModuleContext, id: string) {
  const h = H;
  const index = h ? h.commits.findIndex(c => c.id === id) : -1;
  if (!h || index < 0) return;
  const c = h.commits[index];
  h.chosen = id; h.diffLoading = true; ctx.ui.invalidate();
  try {
    const args = h.range && !h.wholeFile
      ? { workspaceId: h.workspaceId, id, path: h.path, head: h.head, startLine: h.range[0], endLine: h.range[1], index }
      : { workspaceId: h.workspaceId, id, repoPath: c.path, previousPath: c.previousPath };
    const r = await ctx.modules.call("git", "fileCommitDiff", args, { timeoutMs: 60000 });
    if (H !== h || h.chosen !== id) return;
    h.document = r.document; h.empty = !!r.empty; h.error = null;
  } catch (e) { if (H === h && h.chosen === id) h.error = errMsg(e); }
  finally { if (H === h && h.chosen === id) h.diffLoading = false; ctx.ui.invalidate(); }
}

function ago(iso: string) {
  const days = (Date.now() - Date.parse(iso)) / 86_400_000;
  if (!Number.isFinite(days)) return "";
  if (days < 1) { const hours = Math.floor(days * 24); return hours < 1 ? "just now" : `${hours} h ago`; }
  if (days < 30) return `${Math.floor(days)} d ago`;
  if (days < 365) return `${Math.floor(days / 30)} mo ago`;
  return `${Math.floor(days / 365)} y ago`;
}
const when = (iso: string) => iso ? iso.slice(0, 16).replace("T", " ") : "";
const lines = (r: [number, number]) => r[0] === r[1] ? `line ${r[0] + 1}` : `lines ${r[0] + 1}–${r[1] + 1}`;

/** The history window, or null when closed. Diff layout and wrapping follow the viewer settings. */
export function historyWindow(diffMode: "split" | "unified", softWrap: boolean): UiNode | null {
  const h = H;
  if (!h) return null;
  const name = h.path.split("/").pop() || h.path;
  const title = h.shown ? `History of ${name}, ${lines(h.shown)}` : `History of ${name}`;
  const c = h.commits.find(x => x.id === h.chosen);
  const emptyText = h.untracked ? "This file has no committed history yet."
    : h.range ? "No commits changed these lines." : "No commits changed this file.";
  const list: UiNode = h.commits.length || h.loading
    ? { type: "tree", key: "commits", grow: true, rowHeight: 46, indent: 0, selectAction: "history.select", expandAction: "history.noop",
        endReachedAction: h.more && !h.loading && !h.error ? "history.more" : undefined,
        rows: h.commits.map(x => ({ key: x.id, label: x.subject || "(no message)", depth: 0, expandable: false, expanded: false, selected: x.id === h.chosen,
          detail: `${x.id.slice(0, 8)} · ${x.author} · ${ago(x.date)}`,
          badge: x.status === "A" ? "added" : x.previousPath ? "renamed" : undefined,
          tooltip: `${x.subject}\n${x.id}\n${x.author} <${x.email}>\n${when(x.date)}${x.previousPath ? `\nRenamed from ${x.previousPath}` : ""}` })) }
    : { type: "label", key: "empty", text: emptyText, color: "muted", wrap: true };
  return { type: "window", key: `file-history-${h.seq}`, title, width: size.width, height: size.height, closeAction: "history.closed", children: [
    { type: "column", key: "root", grow: true, padding: 10, gap: 8, children: [
      { type: "row", key: "header", gap: 8, align: "center", children: [
        { type: "column", key: "title", grow: true, gap: 2, children: [
          { type: "label", key: "path", text: h.path, weight: "semibold", size: "sm", selectable: true },
          { type: "label", key: "scope", size: "xs", color: "muted",
            text: `${h.shown ? `Commits that changed ${lines(h.shown)}` : "Commits that changed this file, following renames"} · ${h.commits.length}${h.more ? "+" : ""} loaded` },
        ] },
        ...(h.range ? [{ type: "switch", key: "whole", label: "Whole file diff", checked: h.wholeFile, action: "history.wholeFile" } as UiNode] : []),
        { type: "button", key: "layout", text: diffMode === "split" ? "Unified" : "Side by side", action: "history.diffMode", small: true, variant: "ghost", tooltip: "Switch diff layout" },
        { type: "button", key: "refresh", text: "Refresh", action: "history.refresh", small: true, variant: "ghost", disabled: h.loading },
      ] },
      ...(h.error ? [{ type: "status", key: "error", text: h.error, level: "error" } as UiNode] : []),
      { type: "split", key: "body", direction: "horizontal", sizes: [0.34, 0.66], grow: true, children: [
        { type: "column", key: "log", grow: true, gap: 4, children: [
          list,
          ...(h.loading ? [{ type: "progress", key: "loading", indeterminate: true, label: h.commits.length ? "Loading older commits…" : "Loading history…" } as UiNode] : []),
        ] },
        { type: "column", key: "detail", grow: true, gap: 6, children: [
          ...(c ? [
            { type: "label", key: "subject", text: c.subject || "(no message)", weight: "semibold", size: "sm", wrap: true, selectable: true } as UiNode,
            { type: "label", key: "meta", text: `${c.author} <${c.email}> · ${when(c.date)} · ${c.id}${c.previousPath ? ` · renamed from ${c.previousPath}` : ""}`, size: "xs", color: "muted", wrap: true, selectable: true } as UiNode,
          ] : []),
          { type: "diff", key: `diff-${h.chosen || "none"}`, document: h.diffLoading ? null : h.document, mode: diffMode, softWrap, grow: true,
            placeholder: h.chosen ? "Loading changes…" : "Choose a commit to see what it changed.",
            emptyText: "This commit changed no content here (mode or merge only).", changeNavigation: { previous: "Previous change", next: "Next change" } },
        ] },
      ] },
    ] },
  ] };
}

/** Handles `history.*` actions; returns false for anything else. */
export async function historyEvent(ctx: ModuleContext, action: string, ev: any, toggleDiffMode: () => Promise<void>): Promise<boolean> {
  if (!action.startsWith("history.")) return false;
  const h = H;
  switch (action) {
    case "history.closed": {
      H = null; epoch++;
      const v = ev.value || {};
      if (Number(v.width) >= 480 && Number(v.height) >= 320) {
        size = { width: Math.round(v.width), height: Math.round(v.height) };
        await ctx.modules.call("persistence", "settings.set", { key: SIZE_KEY, value: size }).catch(() => {});
      }
      break;
    }
    case "history.more": await loadPage(ctx); break;
    case "history.select": if (ev.rowKey && ev.rowKey !== h?.chosen) await choose(ctx, String(ev.rowKey)); break;
    case "history.wholeFile": if (h) { h.wholeFile = !h.wholeFile; if (h.chosen) await choose(ctx, h.chosen); } break;
    case "history.diffMode": await toggleDiffMode(); break;
    case "history.refresh":
      if (h) { epoch++; Object.assign(h, { head: null, commits: [], more: false, chosen: null, document: null, error: null, loading: false }); await loadPage(ctx); }
      break;
  }
  ctx.ui.invalidate();
  return true;
}
