import type { UiNode } from "@hato/sdk/types";
import { uiIcons } from "@hato/sdk/ui-icons";

export interface TaskBranch { ref: string; name: string; remote?: boolean; worktree?: string | null }
export const branchValue = (branch: TaskBranch) => branch.remote ? branch.ref : branch.name;

/** Resolve the field as an existing ref or a new branch without silently choosing an in-use ref. */
export function taskBranchChoice(branches: TaskBranch[], query: string, selected: string): { name: string; branch: string } {
  const text = query.trim();
  if (!text) throw new Error("Choose a branch or enter a new branch name.");
  const match = branches.find(b => branchValue(b) === selected) || branches.find(b => b.name === text && !b.remote) || branches.find(b => b.name === text);
  if (match?.worktree) throw new Error(`“${match.name}” is already open in another workspace. Choose another branch or enter a new name.`);
  return { name: match?.name || text, branch: match ? branchValue(match) : text };
}

export function taskDialog(view: { branches: TaskBranch[]; query: string; selected: string; loading: boolean; busy: boolean; error: string | null }): UiNode {
  const text = view.query.trim();
  const matches = view.branches.filter(b => b.name.toLowerCase().includes(text.toLowerCase()));
  const existing = view.branches.some(b => b.name === text);
  const selected = view.branches.find(b => branchValue(b) === view.selected) || view.branches.find(b => b.name === text);
  const creating = !!text && !existing && view.selected === text;
  return { type: "modal", key: "task-form", title: "Create Task", closeAction: "cancelTask", width: 720,
    style: { padding: 24, gap: 18, radius: 18, fontSize: 20 }, children: [
      { type: "label", key: "task-subtitle", text: "A separate workspace copy will be created for this branch.", size: "sm", color: "muted", wrap: true },
      { type: "divider", key: "task-divider" },
      { type: "column", key: "task-body", gap: 8, style: { paddingY: 6 }, children: [
        { type: "label", key: "branch-label", text: "Branch name", size: "md", weight: "medium" },
        { type: "textInput", key: "task-branch-search", height: 44, value: view.query, placeholder: "feature/my-task", changeAction: "taskBranchSearch", submitAction: "createTask", disabled: view.busy },
        { type: "column", key: "branch-options", height: Math.max(120, Math.min(224, matches.length * 40)),
          style: { background: "field", borderWidth: 1, borderColor: "border", radius: 4 }, children: view.loading ? [
            { type: "label", key: "branch-loading", text: "Loading branches…", size: "sm", color: "muted", padding: 12 },
          ] : matches.length ? [
            { type: "tree", key: "task-branches", grow: true, rowHeight: 40, rowGap: 0, iconSize: 18,
              selectAction: "pickTaskBranch", expandAction: "", rows: matches.map(b => ({
                key: branchValue(b), label: b.name, badge: b.worktree ? "in use" : b.remote ? "remote" : "existing",
                iconSvg: uiIcons["git-branch"], iconColor: b.worktree ? "muted" : "text", depth: 0,
                expandable: false, expanded: false, selected: view.selected === branchValue(b),
              })) },
          ] : [{ type: "label", key: "no-branches", text: text ? "No matching branches" : "No branches available", size: "sm", color: "muted", padding: 12 }] },
        { type: "row", key: "new-branch-row", children: [
          { type: "button", key: "new-task-branch", text: creating ? `New branch “${text}” · from current branch` : !text ? "Create new branch …" : existing ? "Enter a new name to create a branch" : `Create new branch “${text}”`,
            action: "newTaskBranch", small: true, variant: "ghost", disabled: !text || existing || view.busy || view.loading,
            style: { paddingX: 0, color: creating ? "primary" : "muted" } },
          { type: "spacer", key: "new-branch-space" },
        ] },
        ...(selected?.worktree ? [{ type: "label", key: "in-use", text: "This branch already has a workspace. Choose another branch or enter a new name.", size: "xs", color: "muted", wrap: true } as UiNode] : []),
        ...(view.error ? [{ type: "status", key: "task-error", text: view.error, level: "error" } as UiNode] : []),
        ...(view.busy ? [{ type: "progress", key: "task-progress", indeterminate: true, label: "Creating workspace…" } as UiNode] : []),
      ] },
      { type: "row", key: "task-footer", gap: 10, style: { paddingY: 6 }, children: [
        { type: "spacer", key: "task-footer-space" },
        { type: "button", key: "tf-cancel", text: "Cancel", action: "cancelTask", disabled: view.busy, style: { paddingX: 18 } },
        { type: "button", key: "tf-create", text: "Create", action: "createTask", variant: "primary",
          disabled: view.busy || view.loading || !text || !!selected?.worktree, style: { paddingX: 18 } },
      ] },
    ] };
}
