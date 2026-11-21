import type { ModuleContext } from "@hato/sdk/types";
import type { ModuleMcpTool } from "@hato/sdk/mcp";

interface Group { id: string; name: string; projectIds: string[] }
interface Groups { groups: Group[]; active: string }
const settingsKey = "projects.groups";
const all = "all";
let queue: Promise<unknown> = Promise.resolve();
let pending = 0;
export const pendingGroups = () => pending;

function turn<T>(work: () => Promise<T>): Promise<T> {
  pending++;
  const next = queue.then(work).finally(() => { pending--; });
  queue = next.catch(() => {});
  return next;
}

function normalize(raw: any, projects: Set<string>): Groups {
  const groups: Group[] = [];
  const ids = new Set([all]);
  for (const g of Array.isArray(raw?.groups) ? raw.groups : []) {
    if (typeof g?.id !== "string" || ids.has(g.id) || typeof g.name !== "string") continue;
    ids.add(g.id);
    const projectIds = Array.isArray(g.projectIds) ? [...new Set<string>(g.projectIds.filter((id: string) => projects.has(id)))] : [];
    groups.push({ id: g.id, name: g.name, projectIds });
  }
  return { groups, active: ids.has(raw?.active) ? raw.active : all };
}

function nameFor(value: unknown, state: Groups, id?: string) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > 60 || /[\r\n]/.test(name)) throw new Error("Enter a group name of 1–60 characters");
  const folded = name.toLowerCase();
  if (folded === all || state.groups.some(g => g.id !== id && g.name.toLowerCase() === folded)) throw new Error("A group already uses that name");
  return name;
}

type Operation = "list" | "create" | "rename" | "delete" | "reorder" | "assign" | "unassign" | "set_active";
export function projectGroups(ctx: ModuleContext, op: Operation, args: any = {}) {
  return turn(async () => {
    const [raw, registered] = await Promise.all([
      ctx.modules.call("persistence", "settings.get", { key: settingsKey }),
      ctx.modules.call<{ id: string }[]>("persistence", "projects.list", {}),
    ]);
    const projects = new Set(registered.map(p => p.id));
    const state = normalize(raw, projects);
    const requireGroup = () => {
      const group = state.groups.find(g => g.id === args.id);
      if (!group) throw new Error("Unknown project group");
      return group;
    };
    const projectId = () => {
      if (!projects.has(args.projectId)) throw new Error("Unknown project");
      return args.projectId as string;
    };
    let created: Group | undefined;
    switch (op) {
      case "create": {
        if (state.groups.length >= 100) throw new Error("You can create up to 100 project groups");
        created = { id: crypto.randomUUID(), name: nameFor(args.name, state), projectIds: args.projectId == null ? [] : [projectId()] };
        state.groups.push(created);
        if (args.activate === true) state.active = created.id;
        break;
      }
      case "rename": requireGroup().name = nameFor(args.name, state, args.id); break;
      case "delete": {
        if (requireGroup().projectIds.length && args.confirm !== true) throw new Error("Confirm deletion of this non-empty group");
        state.groups = state.groups.filter(g => g.id !== args.id);
        if (state.active === args.id) state.active = all;
        break;
      }
      case "reorder": {
        const ordered: unknown[] = Array.isArray(args.ids) ? args.ids : [];
        if (ordered.length !== state.groups.length || new Set(ordered).size !== ordered.length || ordered.some(id => !state.groups.some(g => g.id === id))) {
          throw new Error("Provide each custom group ID once in the desired order");
        }
        state.groups = ordered.map(id => state.groups.find(g => g.id === id)!);
        break;
      }
      case "assign": {
        const group = requireGroup(), id = projectId();
        if (!group.projectIds.includes(id)) group.projectIds.push(id);
        break;
      }
      case "unassign": {
        const group = requireGroup();
        group.projectIds = group.projectIds.filter(id => id !== args.projectId);
        break;
      }
      case "set_active":
        if (args.id !== all) requireGroup();
        state.active = args.id;
        break;
    }
    if (JSON.stringify(state) !== JSON.stringify(raw ?? { groups: [], active: all })) {
      await ctx.modules.call("persistence", "settings.set", { key: settingsKey, value: state });
    }
    if (op !== "list") ctx.events.emit("projects.groupsChanged", state);
    return { ...state, ...(created ? { created } : {}) };
  });
}

const string = { type: "string" };
const boolean = { type: "boolean" };
export function groupTools(ctx: ModuleContext): ModuleMcpTool[] {
  const definitions: [Operation, string, Record<string, unknown>, string[]][] = [
    ["list", "List project groups, their project IDs, order and the active tab. All has ID all.", {}, []],
    ["create", "Create a project group. Optionally assign one project and activate the tab.", { name: string, projectId: string, activate: boolean }, ["name"]],
    ["rename", "Rename a custom project group.", { id: string, name: string }, ["id", "name"]],
    ["delete", "Delete a group. Set confirm for a non-empty group. Project registrations are kept.", { id: string, confirm: boolean }, ["id"]],
    ["reorder", "Set the complete order of custom groups. All stays first.", { ids: { type: "array", items: string } }, ["ids"]],
    ["assign", "Add a registered project to a group.", { id: string, projectId: string }, ["id", "projectId"]],
    ["unassign", "Remove a project's membership in one group.", { id: string, projectId: string }, ["id", "projectId"]],
    ["set_active", "Select a group in the desktop Projects panel. Pass all for the unfiltered view.", { id: string }, ["id"]],
  ];
  return definitions.map(([op, description, properties, required]) => ({
    name: `project_groups_${op}`, description, inputSchema: { type: "object", properties, required, additionalProperties: false },
    annotations: { readOnlyHint: op === "list", destructiveHint: op === "delete" },
    handler: (args) => projectGroups(ctx, op, args),
  }));
}
