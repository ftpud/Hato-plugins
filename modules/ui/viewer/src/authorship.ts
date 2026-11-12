// Author and age annotations after declarations: the newest change inside each type or method,
// from `git.blame` of the editor text. Blame runs on open, save and Git changes; edits in
// between are mapped onto the last blamed text, so typing never waits for Git.
import type { ModuleContext } from "@hato/sdk/types";
import { diffLines } from "@hato/sdk/text-diff";
import { declarationsFor } from "./declarations";

interface BlameCommit { id: string; author: string; email: string; time: number; summary: string }
interface Blame { text: string; commits: BlameCommit[]; lines: number[]; tracked: boolean }
const blames = new Map<string, Blame>();
const pending = new Map<string, number>();
let generation = 0;
const key = (workspaceId: string, path: string) => `${workspaceId}|${path}`;

export function forgetBlames() { blames.clear(); generation++; }

/** Blame `text` (the editor content) for `path`; resolves true when the result changed. */
export async function refreshBlame(ctx: ModuleContext, workspaceId: string, path: string, text: string): Promise<boolean> {
  const k = key(workspaceId, path), mine = ++generation;
  pending.set(k, mine);
  try {
    const r = await ctx.modules.call("git", "blame", { workspaceId, path, text }, { timeoutMs: 60000 });
    if (pending.get(k) !== mine) return false;
    blames.delete(k); blames.set(k, { text, commits: r.commits || [], lines: r.lines || [], tracked: !!r.tracked });
    while (blames.size > 24) blames.delete(blames.keys().next().value!);
    return true;
  } catch (e) {
    ctx.log.warn(`blame ${path}: ${String(e)}`);
    return false;
  } finally { if (pending.get(k) === mine) pending.delete(k); }
}

/** Per line of `text`: commit index from the blame, -1 when changed since it was taken. */
function currentLines(b: Blame, text: string): number[] {
  if (b.text === text) return b.lines;
  const before = b.text.split("\n"), after = text.split("\n");
  if (before.length > 20000 || after.length > 20000) return [];
  const out: number[] = [];
  let old = 0;
  for (const op of diffLines(before, after)) {
    if (op.kind === " ") out.push(b.lines[old++] ?? -1);
    else if (op.kind === "+") out.push(-1);
    else old++;
  }
  return out;
}

export function ago(seconds: number) {
  const s = Math.max(0, Date.now() / 1000 - seconds);
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"} ago`;
  if (s < 3600) return s < 120 ? "just now" : unit(Math.floor(s / 60), "minute");
  if (s < 86400) return unit(Math.floor(s / 3600), "hour");
  if (s < 86400 * 30) return unit(Math.floor(s / 86400), "day");
  if (s < 86400 * 365) return unit(Math.floor(s / (86400 * 30)), "month");
  return unit(Math.floor(s / (86400 * 365)), "year");
}

/** `lineAnnotations` for a codeViewer: one per declaration, naming its latest author and age
 *  (and how many others changed it), or noting uncommitted changes. */
let memo: { args: unknown[]; result: { line: number; text: string }[] } | null = null;
export function declarationAnnotations(workspaceId: string, path: string, grammar: string | undefined, text: string | null | undefined) {
  if (typeof text !== "string") return [];
  const b = blames.get(key(workspaceId, path));
  if (!b?.tracked) return [];
  // Renders are frequent (hover, caret); recompute only when the text or blame changed.
  const args = [workspaceId, path, grammar, text, b, Math.floor(Date.now() / 60000)];
  if (memo && memo.args.every((v, i) => v === args[i])) return memo.result;
  const result = compute(b, grammar, text);
  memo = { args, result };
  return result;
}
function compute(b: Blame, grammar: string | undefined, text: string) {
  const declarations = declarationsFor(grammar, text);
  if (!declarations.length) return [];
  const lines = currentLines(b, text);
  if (!lines.length) return [];
  return declarations.map(d => {
    let latest: BlameCommit | null = null, uncommitted = false;
    const authors = new Set<string>();
    for (let line = d.start; line <= d.end; line++) {
      const i = lines[line];
      if (i === undefined || i < 0) { uncommitted = true; continue; }
      const c = b.commits[i];
      authors.add(c.email || c.author);
      if (!latest || c.time > latest.time) latest = c;
    }
    if (uncommitted) return { line: d.line, text: "Uncommitted changes" };
    if (!latest) return null;
    const others = authors.size - 1;
    return { line: d.line, text: `${latest.author}${others > 0 ? ` +${others}` : ""}, ${ago(latest.time)}` };
  }).filter((a): a is { line: number; text: string } => !!a);
}
