import type { MenuItem, ModuleContext, UiEvent, UiNode } from "@hato/sdk/types";
import { errMsg } from "@hato/sdk/runtime";

type Group = { id: string; name: string; projectIds: string[] };
type Groups = { active: string; groups: Group[] };
type Project = { id: string; name: string };
type NameEdit = { key: string; name: string; id?: string; projectId?: string };

export function groupPanel(onChange: (ctx: ModuleContext) => void = () => {}) {
  let state: Groups = { active: "all", groups: [] };
  let request = 0, form = 0;
  let edit: NameEdit | null = null;
  let checklist: string | null = null, confirm: string | null = null;
  let error = "", saving = false, nativeTabs = false;
  const active = () => state.groups.find(g => g.id === state.active);
  const update = (ctx: ModuleContext, next: Groups) => {
    if (Array.isArray(next?.groups)) { state = next; onChange(ctx); ctx.ui.invalidate(); }
  };
  const load = async (ctx: ModuleContext) => {
    const mine = ++request;
    const next = await ctx.modules.call<Groups>("projects", "groups.list").catch(() => null);
    if (next && mine === request) update(ctx, next);
  };
  function activate(ctx: ModuleContext) {
    nativeTabs = ctx.host.env.info().uiNodes?.includes("tabStrip") === true;
    ctx.events.on("projects.groupsChanged", (next: Groups) => { request++; update(ctx, next); });
    ctx.events.on("projects.changed", () => void load(ctx));
    return load(ctx);
  }
  function projectMenu(projectId: string): MenuItem[] {
    const items: MenuItem[] = state.groups.map(group => {
      const checked = group.projectIds.includes(projectId);
      return {
        text: nativeTabs ? group.name : `${checked ? "✓ " : ""}${group.name}`,
        checked, action: checked ? "groups.unassign" : "groups.assign", value: { id: group.id, projectId },
      };
    });
    items.push({ text: "New group…", action: "groups.new", value: projectId });
    return nativeTabs ? [{ text: "Groups", children: items }] : items;
  }
  function tabMenu(group: Group, index: number): MenuItem[] {
    return [
      { text: "Rename…", action: "groups.rename", value: group.id },
      { text: "Move left", action: "groups.move", value: { id: group.id, delta: -1 }, disabled: index === 0 },
      { text: "Move right", action: "groups.move", value: { id: group.id, delta: 1 }, disabled: index === state.groups.length - 1 },
      { text: "Add projects…", action: "groups.checklist", value: group.id },
      { text: "Delete", action: "groups.delete", value: group.id },
    ];
  }
  function render(projects: Project[]): UiNode {
    const tooltip = (name: string, n: number) => `${name} · ${n} ${n === 1 ? "project" : "projects"}`;
    const tabs: { key: string; label: string; tooltip: string; contextMenu?: MenuItem[]; draggable?: boolean }[] = [
      { key: "all", label: "All", tooltip: tooltip("All", projects.length) },
      ...state.groups.map((g, i) => ({ key: g.id, label: g.name, tooltip: tooltip(g.name, g.projectIds.length), contextMenu: tabMenu(g, i), draggable: true })),
    ];
    const plus: UiNode = { type: "button", key: "new-group", text: "+", tooltip: "New project group", action: "groups.new", variant: "ghost", small: true };
    const legacyTabs: UiNode = { type: "row", key: "legacy-tabs", gap: 2, grow: true, children: [
      { type: "button", key: "all", text: "All", action: "groups.tab", value: "all", variant: state.active === "all" ? "primary" : "ghost", small: true },
      ...(active() ? [{ type: "button", key: "active", text: active()!.name, action: "", variant: "primary", small: true, contextMenu: tabs.find(t => t.key === state.active)?.contextMenu } as UiNode] : []),
      ...(state.groups.length ? [{ type: "button", key: "more", text: "⋯", tooltip: "Project groups", action: "groups.choose", small: true, variant: "ghost" } as UiNode] : []),
    ] };
    const children: UiNode[] = [{ type: "row", key: "strip", gap: 4, align: "center", style: { borderTop: 1, borderColor: "border" }, children: [
      nativeTabs ? { type: "tabStrip", key: "tabs", tabs, active: state.active, action: "groups.tab", doubleClickAction: "groups.rename", reorderAction: "groups.drop", grow: true } : legacyTabs,
      ...(nativeTabs && state.groups.length > 3 ? [{ type: "button", key: "more", text: "⋯", tooltip: "Project groups", action: "groups.choose", small: true, variant: "ghost" } as UiNode] : []),
      plus,
    ] }];
    if (edit) children.push({ type: "row", key: "name-row", gap: 4, children: [
      { type: "textInput", key: edit.key, value: edit.name, placeholder: edit.id ? "Rename group" : "Group name", submitAction: "groups.save", cancelAction: "groups.cancel", autoFocus: true, grow: true, disabled: saving },
      { type: "button", key: "save", text: edit.id ? "Rename" : "Create", action: "groups.save", small: true, disabled: saving },
      { type: "button", key: "cancel", text: "Cancel", action: "groups.cancel", variant: "ghost", small: true, disabled: saving },
    ] });
    if (error) children.push({ type: "status", key: "groups-error", text: error, level: "error" });
    const group = state.groups.find(g => g.id === checklist);
    if (group) children.push({ type: "modal", key: "projects-checklist", title: `Projects in ${group.name}`, closeAction: "groups.close", width: 420, children: [
      { type: "column", key: "projects", scroll: true, maxHeight: 340, gap: 4,
        children: projects.length ? projects.map(p => ({ type: "toggle", key: p.id, label: p.name, checked: group.projectIds.includes(p.id), action: "groups.member" }))
          : [{ type: "label", key: "empty", text: "Add a project to Hato first.", color: "muted" }] },
      { type: "button", key: "done", text: "Done", action: "groups.close", small: true },
    ] });
    const deleting = state.groups.find(g => g.id === confirm);
    if (deleting) children.push({ type: "modal", key: "delete-group", title: `Delete ${deleting.name}?`, closeAction: "groups.close", width: 360, children: [
      { type: "label", key: "detail", text: "Projects in the group will stay in Hato.", wrap: true },
      { type: "row", key: "actions", gap: 6, children: [
        { type: "button", key: "cancel", text: "Cancel", action: "groups.close" },
        { type: "button", key: "delete", text: "Delete group", action: "groups.delete_confirmed", value: deleting.id, variant: "danger" },
      ] },
    ] });
    if (checklist === "choose") children.push({ type: "modal", key: "choose-group", title: "Project groups", closeAction: "groups.close", width: 340,
      children: [{ type: "column", key: "groups", gap: 4, maxHeight: 300, scroll: true, children: tabs.map(tab => ({
        type: "button", key: tab.key, text: tab.label, action: "groups.tab", value: tab.key, contextMenu: tab.contextMenu,
        variant: state.active === tab.key ? "primary" : "default",
      })) }] });
    return { type: "column", key: "project-groups", gap: 3, children };
  }
  async function event(ctx: ModuleContext, ev: UiEvent) {
    const value = ev.value;
    const target = typeof value === "string" ? state.groups.find(g => g.id === value) : undefined;
    const call = async (op: string, args: object) => {
      const next = await ctx.modules.call<Groups>("projects", `groups.${op}`, args);
      update(ctx, next);
    };
    error = "";
    try {
      switch (ev.action) {
        case "groups.tab": await call("set_active", { id: value }); if (checklist === "choose") checklist = null; break;
        case "groups.new": edit = { key: `group-name-${++form}`, name: "", projectId: typeof value === "string" ? value : undefined }; break;
        case "groups.rename":
          if (target) { checklist = null; edit = { key: `group-name-${++form}`, id: target.id, name: target.name }; }
          break;
        case "groups.cancel": if (!saving) edit = null; break;
        case "groups.save": {
          if (!edit || saving) break;
          const draft = edit, name = ev.inputs[draft.key] ?? draft.name;
          draft.name = name; saving = true; ctx.ui.invalidate();
          try {
            if (draft.id) await call("rename", { id: draft.id, name });
            else await call("create", { name, projectId: draft.projectId, activate: true });
            edit = null;
          } finally { saving = false; }
          break;
        }
        case "groups.choose": checklist = "choose"; break;
        case "groups.checklist": checklist = target?.id || active()?.id || null; break;
        case "groups.close": checklist = null; confirm = null; break;
        case "groups.member": {
          if (!checklist) break;
          const group = state.groups.find(g => g.id === checklist);
          if (!group) break;
          await call(group.projectIds.includes(ev.key) ? "unassign" : "assign", { id: group.id, projectId: ev.key });
          break;
        }
        case "groups.assign": case "groups.unassign":
          if (value && typeof value === "object") await call(ev.action.slice(7), value);
          break;
        case "groups.move": {
          const move = value as { id?: string; delta?: number } | null;
          const ids = state.groups.map(g => g.id), from = ids.indexOf(move?.id || ""), to = from + (move?.delta ?? 0);
          if (from >= 0 && to >= 0 && to < ids.length) { [ids[from], ids[to]] = [ids[to], ids[from]]; await call("reorder", { ids }); }
          break;
        }
        case "groups.drop": {
          const move = value as { from?: string; to?: string } | null;
          const ids = state.groups.map(g => g.id), from = ids.indexOf(move?.from || ""), to = ids.indexOf(move?.to || "");
          if (from >= 0 && to >= 0 && from !== to) { const [id] = ids.splice(from, 1); ids.splice(to, 0, id); await call("reorder", { ids }); }
          break;
        }
        case "groups.delete":
          if (!target) break;
          if (target.projectIds.length) { checklist = null; confirm = target.id; }
          else await call("delete", { id: target.id });
          break;
        case "groups.delete_confirmed":
          if (target && confirm === target.id) { await call("delete", { id: target.id, confirm: true }); confirm = null; }
          break;
      }
    } catch (e) { error = errMsg(e); }
    ctx.ui.invalidate();
  }
  /** Groups and the active tab, for the Halo rail's project tabs. */
  const snapshot = () => ({ active: state.active, groups: state.groups.map(g => ({ id: g.id, name: g.name, projectIds: [...g.projectIds] })) });
  return { activate, active, projectMenu, render, event, snapshot };
}
