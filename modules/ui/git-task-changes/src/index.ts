let visible = false;
import type { AppModule, ModuleContext, UiNode } from "@hato/sdk/types";
import { errMsg } from "@hato/sdk/runtime";
import { changeRows } from "../../git-panel/src/model";
let ws: any, result: any = null, comparison: any = null, selected: string | null = null;
let error = "", loading = false, epoch = 0, dirty = false;
async function refresh(ctx: ModuleContext) {
  if (!visible || !ws?.id?.startsWith("task:")) return;
  if (loading) { dirty = true; return; }
  const mine = epoch, id = ws.id; loading = true; dirty = false;
  try {
    const r = await ctx.modules.call("git", "taskChanges", { workspaceId: id });
    if (mine !== epoch) return; result = r; error = "";
    if (selected && r.files.some((f: any) => f.path === selected)) {
      const path = selected;
      const diff = await ctx.modules.call("git", "diff", { workspaceId: id, path, base: r.base });
      if (mine === epoch && path === selected) comparison = diff;
    } else { comparison = null; selected = null; }
  } catch (e) { if (mine === epoch) error = errMsg(e); }
  finally { if (mine === epoch) { loading = false; if (dirty) void refresh(ctx); } ctx.ui.invalidate(); }
}
const mod: AppModule = {
  id: "git-task-changes", moduleApiVersion: 1,
  async activate(ctx) {
    visible = !!(ctx.state.get("workspace-layout.panels") as any)?.["git-task-changes"];
    ctx.state.watch("workspace-layout.panels", (v: any) => { const next = !!v?.["git-task-changes"]; if (next === visible) return; visible = next; if (visible) void refresh(ctx); });
    ws = ctx.state.get("workspace.selected");
    ctx.state.watch("workspace.selected", (v: any) => { if (v?.id === ws?.id) return; ws = v; epoch++; loading = false; result = comparison = null; selected = null; error = ""; void refresh(ctx); ctx.ui.invalidate(); });
    ctx.events.on("git.changed", (v: any) => { if (v.workspaceId === ws?.id) void refresh(ctx); });
    await refresh(ctx);
  },
  deactivate() { epoch++; },
  render(): UiNode {
    if (!ws?.id?.startsWith("task:")) return { type: "label", key: "select", text: "Select a task to review changes since its creation.", color: "muted", padding: 12, wrap: true };
    const children: UiNode[] = [
      { type: "row", key: "tools", gap: 6, children: [
        { type: "label", key: "summary", text: result?.base ? `${result.files.length} files · since ${result.base.slice(0, 8)} · includes commits` : "Changes since task creation", grow: true, size: "xs", color: "muted" },
        { type: "button", key: "refresh", text: "Refresh", action: "refresh", small: true, disabled: loading },
      ] },
    ];
    if (error) children.push({ type: "status", key: "error", text: error, level: "error" });
    if (result && !result.base) children.push(
      { type: "label", key: "legacy", text: result.message, wrap: true, color: "muted", size: "sm" },
      { type: "textInput", key: "baseline", placeholder: "Full starting commit ID" },
      { type: "button", key: "setBase", text: "Set fixed baseline", action: "setBase", small: true },
    );
    if (result?.base) children.push({ type: "split", key: "review", direction: "vertical", sizes: [0.35, 0.65], grow: true, children: [
      { type: "tree", key: "files", rows: changeRows(result.files, selected), selectAction: "compare", expandAction: "expand", rowHeight: 42, grow: true },
      { type: "diff", key: "diff", document: comparison?.document || null, mode: "split", softWrap: true, grow: true, placeholder: selected ? "Loading comparison…" : result.files.length ? "Select a file to compare." : "No changes since task creation.", changeNavigation: { previous: "Previous change", next: "Next change" } },
    ] });
    return { type: "column", key: "root", padding: 8, gap: 8, grow: true, children };
  },
  async onEvent(ctx, ev) {
    const mine = epoch, id = ws?.id;
    try {
      if (ev.action === "refresh") await refresh(ctx);
      else if (ev.action === "setBase") { await ctx.modules.call("git", "setTaskBase", { workspaceId: id, id: ev.inputs.baseline?.trim() }); if (mine === epoch) await refresh(ctx); }
      else if (ev.action === "compare") {
        selected = ev.rowKey || null; comparison = null; ctx.ui.invalidate();
        const path = selected;
        const r = await ctx.modules.call("git", "diff", { workspaceId: id, path, base: result.base });
        if (mine === epoch && path === selected) comparison = r;
      }
    } catch (e) { if (mine === epoch) error = errMsg(e); }
    ctx.ui.invalidate();
  },
};
export default mod;
