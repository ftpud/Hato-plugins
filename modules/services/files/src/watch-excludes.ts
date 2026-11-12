// Folders the project watcher skips. Changes inside dependency, cache and Git-ignored folders do
// not affect the explorer's view or Git status, yet in big projects they cost most of the
// watches (Linux caps them per user) and turn installs and builds into refresh storms.
import type { ModuleContext } from "@hato/sdk/types";
import type { WorkspaceDescriptor } from "@hato/sdk/runtime";
import { ignoredSet } from "./gitignore";

/** Always dependencies or caches, whatever the project. Names like `build`/`dist`/`target` can be
 *  real source folders, so they are left to `.gitignore` (where build output nearly always is). */
export const DEFAULT_EXCLUDES = [".git", "node_modules", "__pycache__", ".venv", ".gradle", ".next", ".nuxt", ".turbo",
  ".cache", ".tox", ".mypy_cache", ".pytest_cache", ".ruff_cache", ".terraform", ".dart_tool"];
/** The kernel accepts at most 2000; leave room for the user's own entries. */
const MAX_EXCLUDES = 1500;

export interface WatchPreferences { defaults: boolean; gitignored: boolean; extra: string }
export const defaultPreferences: WatchPreferences = { defaults: true, gitignored: true, extra: "" };

/** A user/Git entry the watcher accepts: no parent escapes, flags or control characters. */
function valid(p: string) {
  return !!p && p.length <= 512 && !p.startsWith("-") && !p.startsWith("!") && !/[\u0000-\u001f]/.test(p) && !p.split("/").includes("..");
}

/** `dist, out` or one per line → patterns. A leading `/` anchors to the project root. */
export function parseExtra(text: string): string[] {
  return text.split(/[\n,]/).map(s => s.trim()).filter(Boolean)
    .map(s => (s.startsWith("/") && !s.slice(1).includes("/") ? s.slice(1) + "/" : s.replace(/^\/+/, "")))
    .filter(valid);
}

export async function watchExcludes(ctx: ModuleContext, d: WorkspaceDescriptor, prefs: WatchPreferences): Promise<string[]> {
  const out = new Set<string>();
  if (prefs.defaults) DEFAULT_EXCLUDES.forEach(n => out.add(n));
  for (const p of parseExtra(prefs.extra)) out.add(p);
  if (prefs.gitignored) {
    // Ignored folders collapsed to their top (`dist/`, `app/build/`): git's own rules, including
    // nested and global ignore files. Unavailable outside a repository.
    const ignored = await ignoredSet(ctx, d).catch(() => null);
    for (const dir of ignored?.dirs || []) {
      if (out.size >= MAX_EXCLUDES) break;
      if (valid(dir)) out.add(dir.endsWith("/") ? dir : dir + "/");
    }
  }
  return [...out];
}

export async function loadPreferences(ctx: ModuleContext): Promise<WatchPreferences> {
  const saved = await ctx.modules.call("persistence", "settings.get", { key: "files.watch" }).catch(() => null);
  return {
    defaults: typeof saved?.defaults === "boolean" ? saved.defaults : true,
    gitignored: typeof saved?.gitignored === "boolean" ? saved.gitignored : true,
    extra: typeof saved?.extra === "string" ? saved.extra : "",
  };
}
