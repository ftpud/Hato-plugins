// File and line-range history: the commits that changed one file (following renames) or one
// block of lines (`git log -L`), paged from a pinned start commit so "load more" stays
// consistent while new commits land. Per-commit patches open as native diff documents.
import type { ModuleContext, RunResult } from "@hato/sdk/types";
import type { WorkspaceDescriptor } from "@hato/sdk/runtime";

type Dependencies = {
  desc(ctx: ModuleContext, id: string): Promise<WorkspaceDescriptor>;
  git(ctx: ModuleContext, d: WorkspaceDescriptor, args: string[], limit?: number): Promise<RunResult>;
  fail(r: RunResult, what: string): never;
  cleanRel(path: any): string;
};

const PAGE = 40;
const RECORD = "\x1e";
const FORMAT = `--format=${RECORD}%H%x00%P%x00%an%x00%ae%x00%aI%x00%s`;
const MAX_LOG_BYTES = 8 * 1024 * 1024;
/** Range patches captured while listing, so opening a commit needs no second trace. */
const RANGE_CACHE_LIMIT = 400;
const rangePatches = new Map<string, string>();
const KEEP_DOCUMENTS = 6;
const opened: string[] = [];

export interface FileCommit {
  id: string; parents: string[]; author: string; email: string; date: string; subject: string;
  /** Repository-relative path of the file in this commit, and its previous path when renamed. */
  path: string; previousPath: string | null; status: string;
}

const oid = (value: any) => {
  if (!/^[0-9a-f]{40,64}$/.test(String(value))) throw new Error("Invalid commit ID");
  return String(value);
};
/** Repository-relative path from a workspace-relative path supplied by the UI. */
function repoRel(p: any): string {
  const s = String(p || "");
  if (!s || s.startsWith("/") || s.split("/").includes("..")) throw new Error("path must be repository-relative");
  return s;
}
/** Pathspec for a repository-relative path, given the workspace's prefix inside the repository. */
function fromWorkspace(prefix: string, repoPath: string) {
  if (repoPath.startsWith(prefix)) return repoPath.slice(prefix.length);
  return "../".repeat(prefix.split("/").filter(Boolean).length) + repoPath;
}
function header(line: string) {
  const [id, parents, author, email, date, subject] = line.split("\0");
  return { id, parents: (parents || "").split(" ").filter(Boolean), author, email, date, subject: subject ?? "" };
}
function cache(key: string, patch: string) {
  rangePatches.delete(key); rangePatches.set(key, patch);
  while (rangePatches.size > RANGE_CACHE_LIMIT) rangePatches.delete(rangePatches.keys().next().value!);
}
/** Commit chunks of a log; a chunk cut by the output limit is dropped (loaded again as "more"). */
function chunks(r: RunResult) {
  const all = r.stdout.split(RECORD).slice(1);
  if (r.truncated) all.pop();
  return all;
}
const rangeKey = (workspaceId: string, head: string, path: string, start: number, end: number, id: string) => `${workspaceId}|${head}|${path}|${start},${end}|${id}`;

export function fileHistory({ desc, git, fail, cleanRel }: Dependencies) {
  async function prefixOf(ctx: ModuleContext, d: WorkspaceDescriptor) {
    const r = await git(ctx, d, ["rev-parse", "--show-prefix"]);
    if (r.code !== 0) throw new Error("This workspace is not inside a Git repository");
    return r.stdout.trim();
  }
  async function resolveHead(ctx: ModuleContext, d: WorkspaceDescriptor, head: any) {
    if (head) return oid(head);
    const r = await git(ctx, d, ["rev-parse", "--verify", "-q", "HEAD^{commit}"]);
    if (r.code !== 0) throw new Error("This repository has no commits yet");
    return oid(r.stdout.trim());
  }
  function lineRange(a: any): [number, number] | null {
    if (a.startLine == null) return null;
    const start = Number(a.startLine), end = Number(a.endLine ?? a.startLine);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > 10_000_000) throw new Error("Invalid line range");
    return [start, end];
  }

  return {
    /** Commits that changed `path` (workspace-relative), newest first, `PAGE` at a time.
     *  With `startLine`/`endLine` (zero-based, inclusive, as of `head`) only commits that changed
     *  those lines. Pass the returned `head` back with `skip` to load older pages. */
    async fileHistory(ctx: ModuleContext, a: any) {
      const d = await desc(ctx, a.workspaceId);
      const path = cleanRel(a.path);
      const prefix = await prefixOf(ctx, d);
      const head = await resolveHead(ctx, d, a.head);
      const skip = Math.max(0, Math.min(Number(a.skip) || 0, 1_000_000));
      const range = lineRange(a);
      const known = await git(ctx, d, ["cat-file", "-e", `${head}:${prefix}${path}`]);
      if (known.code !== 0) return { workspaceId: d.id, head, path, commits: [], more: false, untracked: true };
      const paging = ["-n", String(PAGE), `--skip=${skip}`];
      const commits: FileCommit[] = [];
      if (range) {
        // -L takes a cwd-relative path; it cannot be combined with a pathspec.
        const r = await git(ctx, d, ["log", ...paging, FORMAT, "--no-ext-diff", `-L${range[0] + 1},${range[1] + 1}:${path}`, head], MAX_LOG_BYTES);
        if (r.code !== 0) fail(r, "git log -L");
        for (const chunk of chunks(r)) {
          const newline = chunk.indexOf("\n");
          const c = header(newline < 0 ? chunk : chunk.slice(0, newline));
          const patch = newline < 0 ? "" : chunk.slice(newline + 1).replace(/^\n+/, "");
          cache(rangeKey(d.id, head, path, range[0], range[1], c.id), patch);
          const files = /^diff --git a\/(.*) b\/(.*)$/m.exec(patch);
          commits.push({ ...c, path: files ? files[2] : prefix + path, previousPath: files && files[1] !== files[2] ? files[1] : null, status: /^new file mode/m.test(patch) ? "A" : "M" });
        }
        return { workspaceId: d.id, head, path, range, commits, more: commits.length === PAGE || r.truncated };
      }
      const r = await git(ctx, d, ["log", ...paging, FORMAT, "--follow", "--name-status", "-M", head, "--", path], MAX_LOG_BYTES);
      if (r.code !== 0) fail(r, "git log --follow");
      let current = prefix + path;
      for (const chunk of chunks(r)) {
        const [first, ...rest] = chunk.split("\n");
        const c = header(first);
        // "M\tpath", "A\tpath", "R087\told\tnew". Merges list no files: keep the newer commit's path.
        const change = rest.map(l => l.split("\t")).find(f => f.length >= 2 && /^[ACDMRTUX]/.test(f[0]));
        const filePath = change ? change[change.length - 1] : current;
        const previousPath = change && /^[RC]/.test(change[0]) && change.length >= 3 ? change[1] : null;
        commits.push({ ...c, path: filePath, previousPath, status: change ? change[0][0] : "M" });
        current = previousPath ?? filePath;
      }
      return { workspaceId: d.id, head, path, range: null, commits, more: commits.length === PAGE || r.truncated };
    },

    /** What one commit changed in the file (both paths of a rename), or only in the traced
     *  line range when `startLine`/`endLine`/`head` repeat the `fileHistory` request. */
    async fileCommitDiff(ctx: ModuleContext, a: any) {
      const d = await desc(ctx, a.workspaceId), id = oid(a.id);
      const prefix = await prefixOf(ctx, d);
      const range = lineRange(a);
      let text: string;
      if (range) {
        const path = cleanRel(a.path), head = oid(a.head);
        const key = rangeKey(d.id, head, path, range[0], range[1], id);
        let patch = rangePatches.get(key);
        if (patch === undefined) {
          // Re-trace from the pinned start to this commit (after a reload evicted the cache).
          const index = Math.max(0, Math.min(Number(a.index) || 0, 1_000_000));
          const r = await git(ctx, d, ["log", "-n", "1", `--skip=${index}`, FORMAT, "--no-ext-diff", `-L${range[0] + 1},${range[1] + 1}:${path}`, head], MAX_LOG_BYTES);
          if (r.code !== 0) fail(r, "git log -L");
          const chunk = r.stdout.split(RECORD)[1] || "";
          if (header(chunk.split("\n")[0]).id !== id) throw new Error("History changed; refresh the list");
          patch = chunk.slice(chunk.indexOf("\n") + 1).replace(/^\n+/, "");
          cache(key, patch);
        }
        text = patch;
      } else {
        const paths = [...new Set([repoRel(a.repoPath), ...(a.previousPath ? [repoRel(a.previousPath)] : [])])].map(p => fromWorkspace(prefix, p));
        const r = await git(ctx, d, ["show", "--format=", "--root", "--first-parent", "--no-ext-diff", "--no-textconv", "-M", id, "--", ...paths]);
        if (r.code !== 0) fail(r, "git show");
        text = r.stdout;
      }
      const document = await ctx.host.ui.documentOpen(d.id, text, "diff", { path: `${id.slice(0, 8)}.diff` });
      // Keep the few most recent documents; release older ones once the window has moved on.
      opened.push(document);
      for (const old of opened.splice(0, Math.max(0, opened.length - KEEP_DOCUMENTS))) setTimeout(() => { void ctx.host.resources.release(old).catch(() => {}); }, 5000);
      return { workspaceId: d.id, id, empty: !text.trim(), document };
    },
  };
}
