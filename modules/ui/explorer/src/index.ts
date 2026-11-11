import { FilePresentationClient } from "@hato/sdk/file-presentation";
import { filterInput } from "@hato/sdk/filter-style";
// Workspace file tree: lazy directory loading, scoped search, and viewer selection.
import type { AppModule, ModuleContext, UiNode } from "@hato/sdk/types";
import { debounce, errMsg } from "@hato/sdk/runtime";
import { directories, matchingFileEntries, treeRows, type Entry } from "./model";
import { uiIcons } from "@hato/sdk/ui-icons";
let presentation: FilePresentationClient | null = null;
let ws: any = null;
let dirs = new Map<string, Entry[]>();
let expanded = new Set<string>();
let filterCollapsed = new Set<string>();
let pending = new Set<string>();
let query = "";
let results: any = null;
let searching = false;
let error: string | null = null;
let epoch = 0;
let searchVersion = 0;
let searchSoon: () => void = () => {};
/** Filter text searches file contents instead of paths. */
let contentMode = false;
/** .gitignored files are hidden unless the user shows them. */
let showIgnored = false;
let gitFiles: { path: string; kind: string }[] = [];
let gitVersion = 0;
let grep: any = null;
let grepSoon: () => void = () => {};

async function refreshGit(ctx: ModuleContext) {
  const version = ++gitVersion, workspaceId = ws?.id;
  if (!workspaceId) { gitFiles = []; return; }
  try {
    const status = await ctx.modules.call("git", "status", { workspaceId }, { timeoutMs: 45000 });
    if (version === gitVersion && workspaceId === ws?.id) { gitFiles = status.files || []; ctx.ui.invalidate(); }
  } catch { if (version === gitVersion) { gitFiles = []; ctx.ui.invalidate(); } }
}
async function loadDir(ctx: ModuleContext, path: string, version = epoch) {
  if (!ws || pending.has(path) || dirs.has(path)) return;
  const workspaceId = ws.id;
  pending.add(path); ctx.ui.invalidate();
  try {
    const listing = await ctx.modules.call("files", "list", { workspaceId, relativeDir: path, showHidden: true, hideIgnored: !showIgnored });
    if (version === epoch) { dirs.set(path, listing.entries.filter((entry: Entry) => entry.name !== ".DS_Store")); error = null; }
  } catch (e) { if (version === epoch) error = errMsg(e); }
  finally { if (version === epoch) pending.delete(path); ctx.ui.invalidate(); }
}
// Refresh cached listings in place so watch events never blank the visible tree.
let refreshing = false;
let refreshAgain = false;
let treeDirty = false;
async function refreshTree(ctx: ModuleContext) {
  if (refreshing) { refreshAgain = true; return; }
  refreshing = true;
  try {
    do {
      refreshAgain = false;
      const version = epoch, workspaceId = ws?.id;
      if (!workspaceId) return;
      if (query.trim()) { treeDirty = true; await search(ctx); continue; }
      treeDirty = false;
      const paths = [...dirs.keys()];
      const listings = await Promise.all(paths.map(async path => {
        try {
          const listing = await ctx.modules.call("files", "list", { workspaceId, relativeDir: path, showHidden: true, hideIgnored: !showIgnored });
          return [path, listing.entries.filter((entry: Entry) => entry.name !== ".DS_Store")] as const;
        } catch (e) { if (version === epoch) error = errMsg(e); return null; }
      }));
      if (version !== epoch) { refreshAgain = true; continue; }
      for (const listing of listings) if (listing) dirs.set(listing[0], listing[1]);
      if (query.trim()) await search(ctx);
      ctx.ui.invalidate();
    } while (refreshAgain);
  } finally { refreshing = false; }
}
async function compactChildren(ctx: ModuleContext, parent: string, version = epoch) {
  let budget = 64;
  const compact = async (path: string): Promise<void> => {
    if (version !== epoch || budget-- <= 0 || path === ".git") return;
    await loadDir(ctx, path, version);
    const children = dirs.get(path);
    if (children?.length === 1 && children[0].kind === "dir") await compact(children[0].relativePath);
  };
  const folders = (dirs.get(parent) || []).filter(entry => entry.kind === "dir");
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, folders.length) }, async () => {
    while (cursor < folders.length && version === epoch && budget > 0) await compact(folders[cursor++].relativePath);
  }));
}
async function search(ctx: ModuleContext, refresh = false) {
  const version = ++searchVersion;
  const workspaceId = ws?.id;
  const text = query.trim();
  if (!workspaceId || !text) { results = null; searching = false; ctx.ui.invalidate(); return; }
  searching = true; ctx.ui.invalidate();
  try {
    const next = contentMode
      ? await ctx.modules.call("files", "grep", { workspaceId, query: text, hideIgnored: !showIgnored }, { timeoutMs: 120000 })
      : await ctx.modules.call("files", "search", { workspaceId, query: text, refresh, hideIgnored: !showIgnored }, { timeoutMs: 120000 });
    if (contentMode && version === searchVersion && ws?.id === workspaceId) { grep = next; results = null; error = null; return; }
    if (version === searchVersion && ws?.id === workspaceId) { results = next; error = null; }
  } catch (e) { if (version === searchVersion && ws?.id === workspaceId) { error = errMsg(e); } }
  finally { if (version === searchVersion) searching = false; ctx.ui.invalidate(); }
}
const filteredEntries = (): Entry[] => contentMode ? matchingFileEntries(grep?.files || []) : results?.entries || [];
async function reveal(ctx: ModuleContext) {
  const path = ws?.view?.previewPath;
  if (!path) return;
  const version = epoch;
  query = ""; results = null; searchVersion++; searching = false;
  const parts = path.split("/"); parts.pop();
  let parent = "";
  for (const part of parts) { parent = parent ? parent + "/" + part : part; expanded.add(parent); await loadDir(ctx, parent, version); if (version !== epoch) return; }
  ctx.ui.invalidate();
}
async function reset(ctx: ModuleContext, saved?: any) {
  treeDirty = false;
  gitFiles = []; gitVersion++;
  void refreshGit(ctx);
  const version = ++epoch; searchVersion++; ctx.ui.invalidate(); dirs = new Map(); pending = new Set(); filterCollapsed = new Set(saved?.filterCollapsed || []); results = null; searching = false; error = null;
  expanded = new Set(saved?.expanded || ws?.view?.ui?.explorerTree?.expanded || []);
  query = saved?.query || ""; grep = null;
  if (saved && typeof saved.showIgnored === "boolean") showIgnored = saved.showIgnored;
  if (saved && typeof saved.contentMode === "boolean") contentMode = saved.contentMode;
  await loadDir(ctx, ".");
  await compactChildren(ctx, ".", version);
  if (version !== epoch) return;
  for (const path of [...expanded].sort()) { await loadDir(ctx, path, version); if (version !== epoch) return; }
  if (query) await search(ctx);
}
const mod: AppModule = {
  id: "explorer", moduleApiVersion: 1,
  async activate(ctx, prev) {
    presentation?.dispose();
    presentation = new FilePresentationClient(ctx);
    searchSoon = debounce(() => { void search(ctx); }, 160);
    grepSoon = debounce(() => { void search(ctx); }, 450);
    ws = ctx.state.get("workspace.selected") || null;
    ctx.state.watch("workspace.selected", (next: any) => { const changed = ws?.id !== next?.id; ws = next; if (changed) void reset(ctx); else ctx.ui.invalidate(); });
    const gitSoon = debounce(() => { void refreshGit(ctx); }, 300);
    ctx.events.on("files.indexed", (event: any) => { if (event.workspaceId === ws?.id && query.trim() && !contentMode) searchSoon(); });
    ctx.events.on("git.changed", (event: any) => { if (event.workspaceId === ws?.id) gitSoon(); });
    ctx.events.on("files.changed", (event: any) => {
      if (event.workspaceId !== ws?.id) return;
      // Keep expansion, query and selection when replacing stale directory listings.
      void refreshTree(ctx); gitSoon();
    });
    const savedView = ws?.view?.ui?.explorerTree;
    await reset(ctx, prev?.workspaceId === ws?.id ? prev : savedView ? { showIgnored: !!savedView.showIgnored, contentMode: false } : null);
  },
  deactivate() { presentation?.dispose(); presentation = null; },
  snapshot: () => ({ workspaceId: ws?.id || null, expanded: [...expanded], filterCollapsed: [...filterCollapsed], query, showIgnored, contentMode }),
  render(): UiNode {
    const filtering = !!query.trim();
    const grepping = filtering && contentMode;
    const rows = treeRows(filtering ? directories(filteredEntries()) : dirs, expanded, ws?.view?.previewPath || null, filtering, filterCollapsed);
    const loaded = [...dirs.values()].reduce((count, entries) => count + entries.length, 0);
    const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
    const count = grepping ? searching ? "Searching file contents…" : query.trim().length < 2 ? "Type at least 2 characters" : `${plural(grep?.matchCount || 0, "match", "matches")} in ${plural(grep?.fileCount || 0, "file", "files")}${grep?.truncated ? " · first results" : ""}`
      : filtering ? searching ? "Searching workspace…" : `${plural(results?.matchCount || 0, "match", "matches")}${results?.indexing ? " · indexing…" : results?.partial ? " · first results" : ""}` : `${loaded} items loaded`;
    const toggle = (key: string, icon: string, on: boolean, action: string, tooltip: string): UiNode => ({ type: "button", key, text: "", iconSvg: icon, action, small: true, variant: on ? "primary" : "ghost", tooltip, disabled: !ws });
    const children: UiNode[] = [
      { type: "row", key: "filter-bar", gap: 4, align: "center", children: [
        { type: "textInput", key: "file-filter", ...filterInput, prefixSvg: contentMode ? uiIcons["text-search"] : uiIcons.search, placeholder: contentMode ? "Search in files" : "Filter files", value: query, changeAction: "filter", submitAction: "submitFilter", grow: true, disabled: !ws },
        ...(query ? [{ type: "button", key: "clear", text: "", iconSvg: uiIcons["x"], action: "clearFilter", small: true, variant: "ghost", tooltip: "Clear filter" } as UiNode] : []),
        toggle("content-mode", uiIcons["text-search"], contentMode, "toggleContent", contentMode ? "Searching file contents — click to filter by file name" : "Search the filter text inside files"),
        toggle("show-ignored", showIgnored ? uiIcons.eye : uiIcons["eye-off"], showIgnored, "toggleIgnored", showIgnored ? "Showing .gitignored files — click to hide them" : "Show .gitignored files"),
      ] },
    ];
    if (!ws) children.push({ type: "label", key: "none", text: "Select a project or task.", color: "muted", padding: 8 });
    else {
      children.push({ type: "row", key: "tools", gap: 4, children: [
        { type: "label", key: "count", text: count, size: "xs", color: "muted", grow: true, tooltip: filtering ? "Search covers workspace paths, excluding .git object storage. Project paths are cached, including collapsed folders. Hidden ignored folders are skipped before traversal; results update while indexing. Up to 1,000 matches are shown." : "Folders load as you expand them; filtering searches the workspace." },
        { type: "button", key: "reveal", text: "", iconSvg: uiIcons["locate"], action: "reveal", small: true, variant: "ghost", disabled: !ws.view?.previewPath, tooltip: "Reveal selected file" },
        { type: "button", key: "collapse", text: "", iconSvg: uiIcons["collapse"], action: "collapseAll", small: true, variant: "ghost", tooltip: "Collapse all folders" },
        { type: "button", key: "refresh", text: "", iconSvg: uiIcons["refresh"], action: "refresh", small: true, variant: "ghost", tooltip: "Refresh files" },
      ] });
      if (error) children.push({ type: "status", key: "err", text: error, level: "error" });
      if (pending.size && !dirs.has(".")) children.push({ type: "progress", key: "loading", indeterminate: true });
      if (filtering && !searching && !rows.length && !error && !(grepping && query.trim().length < 2)) children.push({ type: "label", key: "empty", text: grepping ? "No files contain this text." : "No matching files.", color: "muted", padding: 12 });
      if (!filtering && !pending.size && !loaded) children.push({ type: "label", key: "empty", text: "This folder is empty.", color: "muted", padding: 12 });
      children.push({ type: "tree", key: "files", rowHeight: 28, rowGap: 0, indent: 18, iconSize: 17,
        collapsedIconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m9 5 7 7-7 7"/></svg>',
        expandedIconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m5 9 7 7 7-7"/></svg>', rows: rows.map(row => {
          const change = gitFiles.find(file => file.path === row.key);
          const below = row.expandable && gitFiles.some(file => file.path.startsWith(row.key + "/"));
          return { ...row, ...presentation?.get(ws.id, row.key, row.expandable ? "dir" : "file"), badge: pending.has(row.key) ? "…" : change ? ({ modified: "M", added: "A", deleted: "D", renamed: "R", untracked: "U", conflicted: "!", copied: "C", typechange: "T" } as Record<string, string>)[change.kind] || "M" : below ? "•" : "" };
        }), selectAction: "open", expandAction: "expand", style: { fontWeight: 400 }, grow: true });
    }
    return { type: "column", key: "explorer-root", gap: 4, padding: 8, grow: true, children };
  },
  async onEvent(ctx, ev) {
    if (!ws) return;
    const workspaceId = ws.id;
    const version = epoch;
    try {
      if (ev.action === "filter") {
        const nextQuery = String(ev.value || "");
        if (nextQuery === query) return;
        query = nextQuery; filterCollapsed.clear(); results = null; grep = null; searchVersion++;
        const go = contentMode ? query.trim().length >= 2 : !!query.trim();
        searching = go; if (go) (contentMode ? grepSoon : searchSoon)();
        else if (treeDirty) void refreshTree(ctx);
        ctx.ui.invalidate(); return;
      }
      if (ev.action === "submitFilter") { if (query.trim()) await search(ctx); return; }
      if (ev.action === "clearFilter") { query = ""; results = null; grep = null; searching = false; searchVersion++; if (treeDirty) void refreshTree(ctx); ctx.ui.invalidate(); return; }
      if (ev.action === "toggleContent") { contentMode = !contentMode; results = null; grep = null; searchVersion++; if (query.trim()) await search(ctx); else ctx.ui.invalidate(); return; }
      if (ev.action === "toggleIgnored") {
        showIgnored = !showIgnored;
        await ctx.modules.call("workspace", "view.patch", { workspaceId, patch: { ui: { explorerTree: { expanded: [...expanded], showIgnored } } } });
        await reset(ctx, { expanded: [...expanded], query, showIgnored, contentMode });
        return;
      }
      if (ev.action === "collapseAll") { expanded.clear(); query = ""; results = null; searchVersion++; searching = false; }
      else if (ev.action === "reveal") { await reveal(ctx); }
      else if (ev.action === "refresh") { await ctx.modules.call("files", "search", { workspaceId, query: "", refresh: true, hideIgnored: !showIgnored }); if (version !== epoch) return; await refreshTree(ctx); }
      else if (["open", "expand"].includes(ev.action) && ev.rowKey) {
        const entry = (query.trim() ? filteredEntries() : [...dirs.values()].flat()).find((item: Entry) => item.relativePath === ev.rowKey);
        if (!entry) return;
        if (entry.kind === "dir") {
          if (query.trim()) { if (filterCollapsed.has(entry.relativePath)) filterCollapsed.delete(entry.relativePath); else filterCollapsed.add(entry.relativePath); }
          else if (expanded.has(entry.relativePath)) expanded.delete(entry.relativePath);
          else { expanded.add(entry.relativePath); await loadDir(ctx, entry.relativePath); await compactChildren(ctx, entry.relativePath, version); }
        } else if (ev.action === "open") await ctx.modules.call("workspace", "view.patch", { workspaceId: ws.id, patch: { previewPath: entry.relativePath, ...(contentMode && query.trim() ? { ui: { viewerSearch: { key: crypto.randomUUID(), path: entry.relativePath, query: query.trim() } } } : {}) } });
      }
      if (version !== epoch) return;
      await ctx.modules.call("workspace", "view.patch", { workspaceId, patch: { ui: { explorerTree: { expanded: [...expanded], showIgnored } } } });
      error = null;
    } catch (e) { if (version === epoch) error = errMsg(e); }
    ctx.ui.invalidate();
  },
};
export default mod;
