import { ignoredSet, isIgnored } from "./gitignore";
import type { ModuleContext } from "@hato/sdk/types";
import { workspaceGrant, withWorkspace, type WorkspaceDescriptor } from "@hato/sdk/runtime";
export interface IndexedEntry { name: string; kind: string; relativePath: string; size: number }
interface Index { entries: IndexedEntry[]; byPath: Map<string, IndexedEntry>; complete: boolean; skipped: number }
const indexes = new Map<string, { pending: Promise<Index> }>();

export function invalidateSearch(desc: WorkspaceDescriptor) {
  indexes.delete(`${desc.id}|${desc.machineId}|${desc.rootAbsolutePath}`);
}

async function scan(ctx: ModuleContext, desc: WorkspaceDescriptor): Promise<Index> {
  return withWorkspace(ctx, desc, async () => {
    const grant = await workspaceGrant(ctx, desc, "fs");
    const entries: IndexedEntry[] = [];
    const queue = ["."];
    let skipped = 0, cursor = 0;
    while (cursor < queue.length) {
      const dirs = queue.slice(cursor, cursor + 4);
      cursor += dirs.length;
      const batches = await Promise.all(dirs.map(async (dir) => {
        try { return { dir, entries: (await ctx.host.fs.list(grant.grant, dir)).entries }; }
        catch (error: any) {
          if (dir === "." || ["ENOTCONN", "ESTALE", "EBADF"].includes(error?.code)) throw error;
          skipped++; return { dir, entries: [] };
        }
      }));
      for (const batch of batches) for (const entry of batch.entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name === ".DS_Store") continue;
        const relativePath = batch.dir === "." ? entry.name : `${batch.dir}/${entry.name}`;
        entries.push({ name: entry.name, kind: entry.kind, size: entry.size, relativePath });
        // Show .git as a folder but do not index repository object storage or follow symlinks.
        if (entry.kind === "dir" && entry.name !== ".git" && !entry.symlink) queue.push(relativePath);
      }
    }
    return { entries, byPath: new Map(entries.map(entry => [entry.relativePath, entry])), complete: skipped === 0, skipped };
  });
}

export async function searchFiles(ctx: ModuleContext, desc: WorkspaceDescriptor, query: string, refresh = false, hideIgnored = false) {
  const key = `${desc.id}|${desc.machineId}|${desc.rootAbsolutePath}`;
  let index = indexes.get(key);
  if (refresh || !index) {
    const pending = scan(ctx, desc);
    index = { pending }; indexes.set(key, index);
    pending.catch(() => { if (indexes.get(key)?.pending === pending) indexes.delete(key); });
  }
  // Keep recent workspace indexes without accumulating every root ever visited.
  indexes.delete(key); indexes.set(key, index);
  while (indexes.size > 3) indexes.delete(indexes.keys().next().value!);
  const result = await index.pending;
  const ignored = hideIgnored ? await ignoredSet(ctx, desc) : null;
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = result.entries.filter((entry) => (!hideIgnored || !isIgnored(ignored, entry.relativePath)) && words.every((word) => entry.relativePath.toLowerCase().includes(word)));
  const byPath = result.byPath;
  const visible = new Map<string, IndexedEntry>();
  for (const entry of matches.slice(0, 1000)) {
    visible.set(entry.relativePath, entry);
    let parent = entry.relativePath;
    while (parent.includes("/")) { parent = parent.slice(0, parent.lastIndexOf("/")); const ancestor = byPath.get(parent); if (ancestor) visible.set(parent, ancestor); }
  }
  return { entries: [...visible.values()], matchCount: matches.length, indexedCount: result.entries.length, partial: !result.complete || matches.length > 1000, skipped: result.skipped };
}
