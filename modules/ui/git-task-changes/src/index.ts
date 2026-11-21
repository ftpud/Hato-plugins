let visible = false;
import type { AppModule, ModuleContext, UiNode } from "@hato/sdk/types";
import { errMsg } from "@hato/sdk/runtime";
import { uiIcons } from "@hato/sdk/ui-icons";
import { CHANGE_ROW_HEIGHT, changeFileRow, changeGroups } from "../../git-panel/src/model";
let ws: any, result: { base: string | null; files: { path: string; kind: string }[]; message?: string } | null = null;
let selected: string | null = null;
let error = "", loading = false, epoch = 0, dirty = false;
let navigation = Promise.resolve();
async function refresh(ctx: ModuleContext) {
  if (!visible || !ws?.id?.startsWith("task:")) return;
  if (loading) { dirty = true; return; }
  const mine = epoch, id = ws.id; loading = true; dirty = false;
  try {
    const r = await ctx.modules.call("git", "taskChanges", { workspaceId: id });
    if (mine !== epoch) return; result = r; error = "";
    if (!result?.files.some(f => f.path === selected)) selected = null;
  } catch (e) { if (mine === epoch) error = errMsg(e); }
  finally { if (mine === epoch) { loading = false; if (dirty) void refresh(ctx); } ctx.ui.invalidate(); }
}
const mod: AppModule = {
  id: "git-task-changes", moduleApiVersion: 1,
  async activate(ctx) {
    visible = !!(ctx.state.get("workspace-layout.panels") as any)?.["git-task-changes"];
    ctx.state.watch("workspace-layout.panels", (v: any) => { const next = !!v?.["git-task-changes"]; if (next === visible) return; visible = next; if (visible) void refresh(ctx); });
    ws = ctx.state.get("workspace.selected");
    ctx.state.watch("workspace.selected", (v: any) => { if (v?.id === ws?.id) return; ws = v; epoch++; loading = false; result = null; selected = null; error = ""; void refresh(ctx); ctx.ui.invalidate(); });
    ctx.events.on("git.changed", (v: any) => { if (v.workspaceId === ws?.id) void refresh(ctx); });
    await refresh(ctx);
  },
  deactivate() { epoch++; },
  render(): UiNode {
    if (!ws?.id?.startsWith("task:")) return { type: "label", key: "select", text: "Select a task to review changes since its creation.", color: "muted", padding: 12, wrap: true };
    const children: UiNode[] = [
      { type: "row", key: "tools", gap: 6, children: [
        { type: "label", key: "summary", text: result?.base ? `${result.files.length} files · since ${result.base.slice(0, 8)} · includes commits` : "Changes since task creation", grow: true, size: "xs", color: "muted" },
        { type: "button", key: "refresh", text: "", iconSvg: uiIcons.refresh, action: "refresh", small: true, variant: "ghost", disabled: loading, tooltip: "Refresh now" },
      ] },
    ];
    if (error) children.push({ type: "status", key: "error", text: error, level: "error" });
    if (result && !result.base) children.push(
      { type: "label", key: "legacy", text: result.message || "Set a starting commit to compare.", wrap: true, color: "muted", size: "sm" },
      { type: "textInput", key: "baseline", placeholder: "Full starting commit ID" },
      { type: "button", key: "setBase", text: "Set fixed baseline", action: "setBase", small: true },
    );
    if (result?.base) {
      const rows = changeGroups(result.files.slice(0, 5000)).filter(group => group.files.length).flatMap(({ title, files }) => [
        { key: "", label: `${title} · ${files.length}`, depth: 0, expandable: false, expanded: false, selected: false, weight: "semibold" as const },
        ...files.map(file => changeFileRow(file, selected)),
      ]);
      children.push(rows.length
        ? { type: "tree", key: `files:${ws.id}`, rows, selectAction: "compare", activateAction: "open", expandAction: "", rowHeight: CHANGE_ROW_HEIGHT, rowGap: 3, grow: true }
        : { type: "label", key: "empty", text: "No changes since task creation.", color: "muted", padding: 12 });
    }
    return { type: "column", key: "root", padding: 8, gap: 8, grow: true, children };
  },
  async onEvent(ctx, ev) {
    const mine = epoch, id = ws?.id;
    try {
      if (ev.action === "refresh") await refresh(ctx);
      else if (ev.action === "setBase") { await ctx.modules.call("git", "setTaskBase", { workspaceId: id, id: ev.inputs.baseline?.trim() }); if (mine === epoch) await refresh(ctx); }
      else if (ev.action === "compare" || ev.action === "open") {
        const file = result?.files.find(f => f.path === ev.rowKey);
        if (!file || !result?.base || !id) return;
        selected = file.path; error = ""; ctx.ui.invalidate();
        const edit = ev.action === "open" && file.kind !== "deleted";
        // The first click previews the diff. Keep that write ordered ahead of activation.
        const next = navigation.then(async () => {
          if (mine === epoch) await ctx.modules.call("git", "previewTaskFile", { workspaceId: id, path: file.path, edit });
        });
        navigation = next.catch(() => {});
        await next;
      }
    } catch (e) { if (mine === epoch) error = errMsg(e); }
    ctx.ui.invalidate();
  },
};
export default mod;
