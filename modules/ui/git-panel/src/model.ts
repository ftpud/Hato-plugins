import { fileIcons } from "@hato/sdk/file-icons";
import type { TreeRow } from "@hato/sdk/types";

export interface Change { path: string; origPath: string | null; kind: string; index: string; worktree: string; staged: boolean; unstaged: boolean; additions: number | null; deletions: number | null; binary: boolean }

const LETTER: Record<string, string> = { modified: "M", added: "A", deleted: "D", renamed: "R", copied: "C", untracked: "U", conflicted: "!", typechange: "T" };
const COLOR: Record<string, TreeRow["iconColor"]> = { added: "success", untracked: "success", deleted: "warning", conflicted: "warning", renamed: "accent", copied: "accent", modified: "accent", typechange: "accent" };
const LABEL: Record<string, string> = { modified: "Modified", added: "Added", deleted: "Deleted", renamed: "Renamed", copied: "Copied", untracked: "Untracked", conflicted: "Conflicted", typechange: "Type changed" };

export function changeBadge(c: Change): string {
  const counts = c.binary ? "bin" : [c.additions ? `+${c.additions}` : "", c.deletions ? `−${c.deletions}` : ""].filter(Boolean).join(" ");
  return [LETTER[c.kind] || "?", counts].filter(Boolean).join(" ");
}

export function changeRows(changes: Change[], selected: string | null): TreeRow[] {
  return changes.slice(0, 5000).map((c) => {
    const at = c.path.lastIndexOf("/");
    const dir = at < 0 ? "" : c.path.slice(0, at);
    const state = [LABEL[c.kind] || c.kind, c.staged && c.unstaged ? "partly staged" : c.staged ? "staged" : ""].filter(Boolean).join(", ");
    return {
      key: c.path, label: c.path.slice(at + 1), depth: 0, expandable: false, expanded: false,
      selected: c.path === selected, badge: changeBadge(c),
      detail: [c.origPath ? `from ${c.origPath}` : dir, state].filter(Boolean).join(" · "),
      iconSvg: fileIcons.file, iconColor: COLOR[c.kind] || "muted",
    };
  });
}

/** Fingerprint so refreshes only notify the viewer when status changes. */
export function signature(r: { branch?: string | null; files?: Change[] } | null): string {
  if (!r) return "";
  return (r.branch || "") + "\n" + (r.files || []).map((c) => `${c.index}${c.worktree} ${c.path} ${c.additions}/${c.deletions}`).join("\n");
}

export interface ChangeNode { name: string; path: string; file?: Change; children: ChangeNode[]; paths: string[] }
/** Directory hierarchy, with folders before files and stable sorting within each level. */
export function changeTree(changes: Change[]): ChangeNode[] {
  const root: ChangeNode = { name: "", path: "", children: [], paths: [] };
  const folders = new Map<string, ChangeNode>([["", root]]);
  for (const file of changes) {
    const parts = file.path.split("/");
    let parent = root;
    parent.paths.push(file.path);
    for (let i = 0; i < parts.length - 1; i++) {
      const path = parts.slice(0, i + 1).join("/");
      let folder = folders.get(path);
      if (!folder) { folder = { name: parts[i], path, children: [], paths: [] }; folders.set(path, folder); parent.children.push(folder); }
      folder.paths.push(file.path); parent = folder;
    }
    parent.children.push({ name: parts[parts.length - 1], path: file.path, file, children: [], paths: [file.path] });
  }
  const sort = (nodes: ChangeNode[]): ChangeNode[] => nodes.sort((a, b) => Number(!!a.file) - Number(!!b.file) || a.name.localeCompare(b.name)).map(n => ({ ...n, children: sort(n.children) }));
  return sort(root.children);
}
