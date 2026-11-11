import { ignoredSet, isIgnored } from "./gitignore";
import type { ModuleContext } from "@hato/sdk/types";
import { targetFor, workspaceGrant, withWorkspace, type WorkspaceDescriptor } from "@hato/sdk/runtime";
export interface IndexedEntry { name: string; kind: string; relativePath: string; size: number }
interface Index {
  entries: IndexedEntry[]; previous?: Map<string, IndexedEntry>; byPath: Map<string, IndexedEntry>; pending: Promise<void>;
  indexing: boolean; cancelled: boolean; dirty: boolean; skipped: number; error?: unknown; notified: number;
}
const indexes = new Map<string, Index>();
const rootKey = (desc: WorkspaceDescriptor) => `${desc.id}|${desc.machineId}|${desc.rootAbsolutePath}|`;
export function invalidateSearch(desc: WorkspaceDescriptor) {
  for (const [key, index] of indexes) if (key.startsWith(rootKey(desc))) index.dirty = true;
}
export function stopSearchIndexes() {
  for (const index of indexes.values()) index.cancelled = true;
  indexes.clear();
}
function publish(ctx: ModuleContext, desc: WorkspaceDescriptor, index: Index, force = false) {
  if (!index.cancelled && (force || Date.now() - index.notified >= 1000)) {
    index.notified = Date.now();
    ctx.events.emit("files.indexed", { workspaceId: desc.id, indexing: index.indexing });
  }
}
function add(index: Index, entry: IndexedEntry) {
  if (index.byPath.has(entry.relativePath)) return;
  index.byPath.set(entry.relativePath, entry); index.entries.push(entry);
}
function addPath(index: Index, path: string) {
  const parts = path.split("/");
  // Git output is data, never a command or an authority to escape the scoped workspace.
  if (parts.some(part => !part || part === "." || part === ".." || part === ".git")) return;
  let relativePath = "";
  for (let i = 0; i < parts.length; i++) {
    relativePath += (i ? "/" : "") + parts[i];
    add(index, { name: parts[i], kind: i === parts.length - 1 ? "file" : "dir", relativePath, size: 0 });
  }
}
/** Enumerate on the workspace machine: one Git operation, not one SSH round trip per folder.
 * Git prunes ignored directories before visiting their contents. Truncated output is never
 * accepted as a complete index; the incremental filesystem walker handles that case. */
async function gitIndex(ctx: ModuleContext, desc: WorkspaceDescriptor, index: Index): Promise<boolean> {
  try {
    const grant = await workspaceGrant(ctx, desc, "process");
    const target = await targetFor(ctx, desc);
    const run = (args: string[]) => ctx.host.process.run(grant.grant, {
      target, executable: "git", args: ["--no-optional-locks", "ls-files", "-z", ...args],
      cwd: desc.rootAbsolutePath, loginShell: desc.location === "ssh",
    }, { timeoutMs: 30000, limitBytes: 32 << 20 });
    const [files, deleted] = await Promise.all([run(["--cached", "--others", "--exclude-standard", "--stage"]), run(["--deleted"])]);
    if (index.cancelled) return true;
    if (files.code !== 0 || deleted.code !== 0 || files.truncated || deleted.truncated) return false;
    const missing = new Set(deleted.stdout.split("\0"));
    const paths = files.stdout.split("\0").filter(Boolean).map(record => {
      const staged = /^(\d{6}) [a-f0-9]+ \d\t([\s\S]*)$/.exec(record);
      return { mode: staged?.[1], path: staged ? staged[2] : record };
    });
    // Submodules need their own filesystem traversal; do not present them as files.
    if (paths.some(item => item.mode === "160000")) return false;
    for (let i = 0; i < paths.length; i++) {
      if (index.cancelled) return true;
      if (!missing.has(paths[i].path)) addPath(index, paths[i].path);
      if (i % 4096 === 4095) {
        publish(ctx, desc, index);
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
    }
    return true;
  } catch { return false; }
}
async function scan(ctx: ModuleContext, desc: WorkspaceDescriptor, index: Index, hideIgnored: boolean) {
  await withWorkspace(ctx, desc, async () => {
    if (hideIgnored && await gitIndex(ctx, desc, index)) return;
    // Fallback for non-Git roots, missing Git, or exceptionally large Git output.
    const ignored = hideIgnored ? await ignoredSet(ctx, desc) : null;
    const grant = await workspaceGrant(ctx, desc, "fs");
    const queue = ["."], deferred: string[] = [];
    let cursor = 0;
    while (!index.cancelled && (cursor < queue.length || deferred.length)) {
      if (cursor === queue.length) queue.push(...deferred.splice(0, 4));
      const dirs = queue.slice(cursor, cursor + 4); cursor += dirs.length;
      const batches = await Promise.all(dirs.map(async dir => {
        try { return { dir, entries: (await ctx.host.fs.list(grant.grant, dir)).entries }; }
        catch (error: any) {
          if (dir === "." || ["ENOTCONN", "ESTALE", "EBADF"].includes(error?.code)) throw error;
          index.skipped++; return { dir, entries: [] };
        }
      }));
      if (index.cancelled) return;
      for (const batch of batches) for (const entry of batch.entries) {
        if (entry.name === ".DS_Store" || entry.name === ".git") continue;
        const relativePath = batch.dir === "." ? entry.name : `${batch.dir}/${entry.name}`;
        // Prune before enqueueing: invisible dependencies never consume filesystem requests.
        if (hideIgnored && isIgnored(ignored, relativePath)) continue;
        add(index, { name: entry.name, kind: entry.kind, size: entry.size, relativePath });
        if (entry.kind === "dir" && !entry.symlink) {
          (["node_modules", "vendor", "target", ".cache"].includes(entry.name) ? deferred : queue).push(relativePath);
        }
      }
      publish(ctx, desc, index);
    }
  });
}
function start(ctx: ModuleContext, desc: WorkspaceDescriptor, hideIgnored: boolean, key: string): Index {
  const previous = indexes.get(key);
  const index: Index = { previous: previous?.previous || previous?.byPath, entries: [], byPath: new Map(), pending: Promise.resolve(), indexing: true, cancelled: false, dirty: false, skipped: 0, notified: Date.now() };
  indexes.set(key, index);
  index.pending = scan(ctx, desc, index, hideIgnored).catch(error => { index.error = error; }).finally(() => {
    index.indexing = false;
    if (!index.error) index.previous = undefined;
    publish(ctx, desc, index, true);
  });
  return index;
}
export async function searchFiles(ctx: ModuleContext, desc: WorkspaceDescriptor, query: string, refresh = false, hideIgnored = false) {
  const key = rootKey(desc) + (hideIgnored ? "visible" : "all");
  let index = indexes.get(key);
  if (refresh && index) index.dirty = true;
  // Coalesce watcher storms: finish the current generation instead of restarting it every time.
  if (!index || index.dirty && !index.indexing) index = start(ctx, desc, hideIgnored, key);
  indexes.delete(key); indexes.set(key, index);
  while (indexes.size > 6) {
    const oldest = indexes.keys().next().value!;
    indexes.get(oldest)!.cancelled = true; indexes.delete(oldest);
  }
  // RPCs return promptly even if an SSH directory request or Git command is still pending.
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([index.pending, new Promise<void>(resolve => { timer = setTimeout(resolve, 100); })]);
  if (timer) clearTimeout(timer);
  if (index.error && !index.entries.length && !index.previous?.size) throw index.error;
  // Keep the prior snapshot visible while the replacement index arrives. Add new
  // paths in place; only a completed scan can establish that old paths disappeared.
  const entries = index.previous ? new Map([...index.previous, ...index.byPath]) : index.byPath;
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  let matchCount = 0;
  const visible = new Map<string, IndexedEntry>();
  for (const entry of entries.values()) {
    if (!words.every(word => entry.relativePath.toLowerCase().includes(word))) continue;
    if (++matchCount > 1000) continue;
    visible.set(entry.relativePath, entry);
    let parent = entry.relativePath;
    while (parent.includes("/")) {
      parent = parent.slice(0, parent.lastIndexOf("/"));
      const ancestor = entries.get(parent); if (ancestor) visible.set(parent, ancestor);
    }
  }
  return { entries: [...visible.values()], matchCount, indexedCount: index.entries.length, indexing: index.indexing || index.dirty,
    partial: index.indexing || index.dirty || !!index.error || index.skipped > 0 || matchCount > 1000, skipped: index.skipped };
}
