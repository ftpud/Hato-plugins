// Line authorship for editor annotations: `git blame --porcelain` over the exact text the
// editor holds (unsaved edits included), so line numbers match the buffer.
import type { ModuleContext, RunResult } from "@hato/sdk/types";
import type { WorkspaceDescriptor } from "@hato/sdk/runtime";

type Dependencies = {
  desc(ctx: ModuleContext, id: string): Promise<WorkspaceDescriptor>;
  git(ctx: ModuleContext, d: WorkspaceDescriptor, args: string[], limit?: number, stdin?: string): Promise<RunResult>;
  fail(r: RunResult, what: string): never;
  cleanRel(path: any): string;
};
const MAX_TEXT = 2 * 1024 * 1024;
const MAX_OUTPUT = 32 * 1024 * 1024;

export interface BlameCommit { id: string; author: string; email: string; time: number; summary: string }

/** Porcelain blame → distinct commits and, per zero-based line, an index into them (-1 = not committed). */
export function parseBlame(out: string) {
  const commits: BlameCommit[] = [], index = new Map<string, number>(), lines: number[] = [];
  let current: BlameCommit | null = null;
  for (const line of out.split("\n")) {
    if (line.startsWith("\t")) continue;
    const head = /^([0-9a-f]{40,64}) \d+ (\d+)(?: \d+)?$/.exec(line);
    if (head) {
      const [, id, final] = head;
      let i = index.get(id);
      if (i === undefined) { i = commits.length; index.set(id, i); commits.push({ id, author: "", email: "", time: 0, summary: "" }); }
      current = commits[i];
      lines[Number(final) - 1] = /^0+$/.test(id) ? -1 : i;
      continue;
    }
    if (!current) continue;
    const space = line.indexOf(" ");
    const key = space < 0 ? line : line.slice(0, space), value = space < 0 ? "" : line.slice(space + 1);
    if (key === "author") current.author = value;
    else if (key === "author-mail") current.email = value.replace(/^<|>$/g, "");
    else if (key === "author-time") current.time = Number(value) || 0;
    else if (key === "summary") current.summary = value;
  }
  for (let i = 0; i < lines.length; i++) if (lines[i] === undefined) lines[i] = -1;
  return { commits, lines };
}

export function blame({ desc, git, fail, cleanRel }: Dependencies) {
  return {
    /** Who last changed each line of `path`. With `text`, blames that content (an editor buffer)
     *  instead of the file on disk. `tracked: false` for files not committed yet. */
    async blame(ctx: ModuleContext, a: any) {
      const d = await desc(ctx, a.workspaceId);
      const path = cleanRel(a.path);
      const text = typeof a.text === "string" ? a.text : undefined;
      if (text !== undefined && text.length > MAX_TEXT) throw new Error("File is too large to annotate");
      const tracked = await git(ctx, d, ["ls-files", "--error-unmatch", "--", path]);
      if (tracked.code !== 0) return { workspaceId: d.id, path, tracked: false, commits: [], lines: [] };
      const r = await git(ctx, d, ["blame", "--porcelain", ...(text !== undefined ? ["--contents", "-"] : []), "--", path], MAX_OUTPUT, text);
      if (r.code !== 0) fail(r, "git blame");
      if (r.truncated) throw new Error("Blame output is too large");
      return { workspaceId: d.id, path, tracked: true, ...parseBlame(r.stdout) };
    },
  };
}
