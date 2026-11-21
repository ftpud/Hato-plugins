import { fileIcons } from "@hato/sdk/file-icons";
import type { TreeRow } from "@hato/sdk/types";

export interface Change { path: string; origPath: string | null; kind: string; index: string; worktree: string; staged: boolean; unstaged: boolean; additions: number | null; deletions: number | null; binary: boolean }

export const LETTER: Record<string, string> = { modified: "M", added: "A", deleted: "D", renamed: "R", copied: "C", untracked: "U", conflicted: "!", typechange: "T" };
export const COLOR: Record<string, TreeRow["iconColor"]> = { added: "success", untracked: "success", deleted: "warning", conflicted: "warning", renamed: "accent", copied: "accent", modified: "accent", typechange: "accent" };
export const LABEL: Record<string, string> = { modified: "Modified", added: "Added", deleted: "Deleted", renamed: "Renamed", copied: "Copied", untracked: "Untracked", conflicted: "Conflicted", typechange: "Type changed" };

type FileChange = Pick<Change, "path" | "kind"> & Partial<Change>;
export const CHANGE_ROW_HEIGHT = 28;
export const changeGroups = <T extends FileChange>(files: T[]) => [
  { title: "Changes", files: files.filter(f => f.kind !== "untracked") },
  { title: "Untracked", files: files.filter(f => f.kind === "untracked") },
];

export function changeBadge(c: FileChange): string {
  const counts = c.binary ? "bin" : [c.additions ? `+${c.additions}` : "", c.deletions ? `−${c.deletions}` : ""].filter(Boolean).join(" ");
  return [LETTER[c.kind] || "?", counts].filter(Boolean).join(" ");
}

export function changeFileRow(c: FileChange, selected: string | null = null): TreeRow {
  const at = c.path.lastIndexOf("/");
  const status = LABEL[c.kind] || c.kind;
  return {
    key: c.path, label: c.path.slice(at + 1), depth: 0, expandable: false, expanded: false,
    selected: c.path === selected, badge: changeBadge(c),
    detail: at < 0 ? undefined : c.path.slice(0, at),
    tooltip: c.origPath ? `${c.origPath} → ${c.path}` : `${status} · ${c.path}`,
    iconSvg: fileIcons.file, iconColor: COLOR[c.kind] || "muted",
  };
}

/** Fingerprint so refreshes only notify the viewer when status changes. */
export function signature(r: { branch?: string | null; files?: Change[] } | null): string {
  if (!r) return "";
  return (r.branch || "") + "\n" + (r.files || []).map((c) => `${c.index}${c.worktree} ${c.path} ${c.additions}/${c.deletions}`).join("\n");
}

export interface ChangeNode { name: string; path: string; file?: Change; children: ChangeNode[]; paths: string[] }
/** Compact single-child directory chains, retaining the deepest path for selection and expansion. */
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
  const sort = (nodes: ChangeNode[]): ChangeNode[] => nodes.sort((a, b) => Number(!!a.file) - Number(!!b.file) || a.name.localeCompare(b.name)).map(n => {
    let leaf = n, name = n.name;
    while (!leaf.file && leaf.children.length === 1 && !leaf.children[0].file) {
      leaf = leaf.children[0]; name += "/" + leaf.name;
    }
    return { ...leaf, name, children: sort(leaf.children) };
  });
  return sort(root.children);
}
