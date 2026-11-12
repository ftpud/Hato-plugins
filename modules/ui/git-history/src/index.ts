import { commitGraph } from "./graph";
import type { AppModule, ModuleContext, UiNode } from "@hato/sdk/types";
import { errMsg } from "@hato/sdk/runtime";
import { exportSettings } from "@hato/sdk/settings";
let visible = false;
let mode: "split" | "unified" = "split";
let wrapLines = true, filesCollapsed = true;
let publishSettings: () => void = () => {};
const layoutOptions = [{ value: "split", label: "Side by side" }, { value: "unified", label: "Unified" }];
async function applySetting(ctx: ModuleContext, key: string, value: boolean | string) {
  if (key === "diffMode" ? value !== "split" && value !== "unified" : !["wrapLines", "filesCollapsed"].includes(key) || typeof value !== "boolean") throw new Error("Invalid Git history setting");
  await ctx.modules.call("persistence", "settings.set", { key: `git-history.${key}`, value });
  if (key === "diffMode") mode = value as "split" | "unified";
  else if (key === "wrapLines") wrapLines = value as boolean;
  else filesCollapsed = value as boolean;
  ctx.ui.invalidate();
}
let ws: any, branches: any[] = [], tags: string[] = [], commits: any[] = [], comparison: any = null;
/** Commit under the pointer: its branch line is highlighted. */
let hovered: string | null = null;
let ref = "ALL", query = "", branchQuery = "", chosen = "", error = "", loading = false, more = false, epoch = 0;
async function refresh(ctx: ModuleContext, append = false) {
  if (!ws || !visible) return;
  const mine = ++epoch, id = ws.id; loading = true; ctx.ui.invalidate();
  try {
    const [catalog, r] = await Promise.all([
      ctx.modules.call("git", "branches", { workspaceId: id }),
      ctx.modules.call("git", "history", { workspaceId: id, ref, skip: append ? commits.length : 0 }),
    ]);
    if (mine !== epoch) return;
    branches = [...catalog.local, ...catalog.remote]; tags = r.tags; commits = append ? [...commits, ...r.commits] : r.commits; more = r.more; error = "";
  } catch (e) { if (mine === epoch) error = errMsg(e); }
  finally { if (mine === epoch) loading = false; ctx.ui.invalidate(); }
}
const mod: AppModule = {
  id: "git-history", moduleApiVersion: 1,
  async activate(ctx, prev) {
    const get = (key: string) => ctx.modules.call("persistence", "settings.get", { key: `git-history.${key}` });
    const [savedMode, savedWrap, savedCollapsed] = await Promise.all([get("diffMode"), get("wrapLines"), get("filesCollapsed")]);
    mode = savedMode === "unified" ? "unified" : "split";
    wrapLines = typeof savedWrap === "boolean" ? savedWrap : true;
    filesCollapsed = typeof savedCollapsed === "boolean" ? savedCollapsed : true;
    publishSettings = exportSettings(ctx, () => [{ key: "git-history", title: "Git history", fields: [
      { key: "diffMode", label: "Diff layout", type: "select", value: mode, options: layoutOptions,
        description: "Compare commit changes side by side or in a unified view." },
      { key: "wrapLines", label: "Wrap long lines", type: "toggle", value: wrapLines },
      { key: "filesCollapsed", label: "Start file previews collapsed", type: "toggle", value: filesCollapsed,
        description: "Applies when a commit preview is first opened." },
    ] }], (_section, key, value) => applySetting(ctx, key, value));
    visible = !!(ctx.state.get("workspace-layout.panels") as any)?.["git-history"];
    ctx.state.watch("workspace-layout.panels", (v: any) => { const next = !!v?.["git-history"]; if (next === visible) return; visible = next; if (visible) void refresh(ctx); });
    ws = ctx.state.get("workspace.selected");
    if (prev && prev.workspaceId === ws?.id) {
      ref = prev.ref || "ALL"; query = prev.query || ""; branchQuery = prev.branchQuery || ""; chosen = prev.chosen || "";
      branches = prev.branches || []; tags = prev.tags || []; commits = prev.commits || []; comparison = prev.comparison || null; more = !!prev.more;
    }
    ctx.state.watch("workspace.selected", (v: any) => { if (ws?.id === v?.id) return; epoch++; ws = v; ref = "ALL"; chosen = ""; commits = []; comparison = null; error = ""; void refresh(ctx); });
    ctx.events.on("git.changed", (v: any) => { if (v.workspaceId === ws?.id) void refresh(ctx); });
    await refresh(ctx);
  },
  deactivate() { epoch++; },
  snapshot: () => ({ workspaceId: ws?.id, ref, query, branchQuery, chosen, branches, tags, commits, comparison, more }),
  render(): UiNode {
    if (!ws) return { type: "label", key: "empty", text: "Select a project or task.", color: "muted", padding: 12 };
    const options = [{ value: "ALL", label: "All branches" }, { value: "HEAD", label: "Current branch" }, ...branches.map(b => ({ value: b.ref, label: b.name })), ...tags.map(t => ({ value: t, label: t.replace("refs/tags/", "Tag · ") }))].filter(b => b.value === ref || b.label.toLowerCase().includes(branchQuery.toLowerCase()));
    const layout = commitGraph(commits, 58);
    const highlight = hovered !== null ? layout.branchOf.get(hovered) ?? null : null;
    const graph = highlight === null ? layout : commitGraph(commits, 58, highlight);
    const tooltip = (c: any) => {
      const branch = graph.branchOf.get(c.id);
      const name = branch === undefined ? undefined : graph.branchName.get(branch);
      const all = graph.containedIn.get(c.id) || [];
      const shown = all.slice(0, 6).join(", ") + (all.length > 6 ? ` +${all.length - 6} more` : "");
      return [`Branch: ${name || "unnamed (no ref points here)"}`, all.length ? `Contained in: ${shown}` : "Not in any loaded branch or tag"].join("\n");
    };
    const shown = commits.filter(c => `${c.subject} ${c.author} ${c.id} ${c.refs}`.toLowerCase().includes(query.toLowerCase()));
    return { type: "column", key: "root", padding: 8, gap: 8, grow: true, children: [
      { type: "row", key: "toolbar", gap: 6, wrap: true, children: [
        { type: "textInput", key: "query", value: query, placeholder: "Search loaded commits…", changeAction: "query", grow: true },
        { type: "select", key: "diff-mode", label: "Diff: ", value: mode, options: layoutOptions, action: "diffMode", tooltip: "Git history diff layout" },
        { type: "button", key: "refresh", text: "Refresh", action: "refresh", small: true, disabled: loading },
      ] },
      ...(error ? [{ type: "status", key: "error", text: error, level: "error" } as UiNode] : []),
      ...(loading ? [{ type: "progress", key: "loading", indeterminate: true } as UiNode] : []),
      { type: "split", key: "history", direction: "horizontal", sizes: [0.18, 0.32, 0.5], grow: true, children: [
        { type: "column", key: "refs", grow: true, gap: 6, children: [
          { type: "label", key: "title", text: "Branches & tags", weight: "semibold", size: "sm" },
          { type: "textInput", key: "refs-query", value: branchQuery, placeholder: "Find a ref…", changeAction: "branchQuery" },
          { type: "tree", key: "ref-tree", grow: true, rowHeight: 32, selectAction: "ref", expandAction: "expand", rows: options.map(b => ({
            key: b.value, label: b.label, depth: b.value.startsWith("refs/") ? 1 : 0,
            badge: b.value.startsWith("refs/remotes/") ? "remote" : b.value.startsWith("refs/tags/") ? "tag" : branches.find(branch => branch.ref === b.value)?.current ? "current" : undefined,
            expandable: false, expanded: false, selected: ref === b.value,
          })) },
        ] },
        { type: "column", key: "log", grow: true, children: [
          { type: "tree", key: "commits", hoverAction: "hoverCommit", rowHeight: graph.height, rowGap: 0, iconSize: 40, iconWidth: graph.width, iconHeight: graph.height, indent: 0, grow: true, expandAction: "expand", selectAction: "commit", rows: shown.map(c => ({
            key: c.id, label: c.subject, iconSvg: graph.svgs.get(c.id), tooltip: tooltip(c), detail: `${c.id.slice(0, 8)} · ${c.author} · ${c.date.slice(0, 10)}`, badge: c.refs || undefined,
            depth: 0, expandable: false, expanded: false, selected: chosen === c.id, iconColor: "primary",
          })) },
          ...(more ? [{ type: "button", key: "more", text: "Load older commits", action: "more", small: true, disabled: loading } as UiNode] : []),
        ] },
        { type: "column", key: "detail", grow: true, gap: 6, children: [
          { type: "label", key: "subject", text: commits.find(c => c.id === chosen)?.subject || "Select a commit", weight: "semibold", wrap: true, size: "sm" },
          { type: "diff", key: "diff", filesCollapsed, document: comparison?.document || null, mode, grow: true, softWrap: wrapLines, placeholder: chosen ? "Loading commit…" : "Choose a commit to review its changes.", changeNavigation: { previous: "Previous change", next: "Next change" } },
        ] },
      ] },
    ] };
  },
  async onEvent(ctx, ev) {
    try {
      if (ev.action === "hoverCommit") {
        const next = ev.rowKey || null;
        if (next !== hovered) { hovered = next; ctx.ui.invalidate(); }
        return;
      }
      if (ev.action === "diffMode") { await applySetting(ctx, "diffMode", String(ev.value ?? ev.rowKey)); publishSettings(); }
      else if (ev.action === "branchQuery") branchQuery = String(ev.value ?? "");
      else if (ev.action === "query") query = String(ev.value ?? "");
      else if (ev.action === "ref") { ref = String(ev.value ?? ev.rowKey); chosen = ""; comparison = null; commits = []; await refresh(ctx); }
      else if (ev.action === "refresh" || ev.action === "more") await refresh(ctx, ev.action === "more");
      else if (ev.action === "commit") {
        const id = String(ev.rowKey), workspaceId = ws.id; chosen = id; comparison = null; ctx.ui.invalidate();
        const r = await ctx.modules.call("git", "commitDiff", { workspaceId, id });
        if (ws?.id === workspaceId && chosen === id) comparison = r;
      }
    } catch (e) { error = errMsg(e); }
    ctx.ui.invalidate();
  },
};
export default mod;
