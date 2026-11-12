import { FilePresentations } from "./presentation";
// files: workspace-scoped listing and reading through scoped FS grants (local fs or SFTP on the
// workspace's machine). Returns native document handles for the viewer.
import { fileWatch } from "@hato/sdk/file-watch";
import { searchFiles, invalidateSearch, stopSearchIndexes } from "./search";
import { workspaceSkills } from "./skills";
import { grepFiles, ignoredAmong, invalidateIgnored } from "./gitignore";
import type { AppModule, ModuleContext } from "@hato/sdk/types";
import { errMsg, langFromPath, targetFor, withWorkspace, workspaceGrant, type WorkspaceDescriptor } from "@hato/sdk/runtime";
import type { ScopeGrant } from "@hato/sdk/types";
import { exportSettings } from "@hato/sdk/settings";
import { DEFAULT_EXCLUDES, loadPreferences, watchExcludes, type WatchPreferences } from "./watch-excludes";

const MAX_VIEW_BYTES = 2 * 1024 * 1024;
const docCache = new Map<string, { document: string; mtime: number | null; size: number; text?: string; truncated: boolean }>();

async function desc(ctx: ModuleContext, workspaceId: string): Promise<WorkspaceDescriptor> {
  return ctx.modules.call("workspace", "resolve", { workspaceId });
}

function cleanRel(rel: any): string {
  const r = typeof rel === "string" && rel.length ? rel : ".";
  if (r.startsWith("/")) throw new Error("paths must be workspace-relative");
  const parts: string[] = [];
  for (const p of r.split("/")) {
    if (p === "" || p === ".") continue;
    if (p === "..") { if (!parts.length) throw new Error("path escapes the workspace root"); parts.pop(); continue; }
    parts.push(p);
  }
  return parts.length ? parts.join("/") : ".";
}

// Write grants are requested lazily (the kernel shows a native approval) and reused per root.
const writeGrants = new Map<string, Promise<ScopeGrant>>();
function writeGrant(ctx: ModuleContext, d: WorkspaceDescriptor): Promise<ScopeGrant> {
  const key = `${d.machineId}|${d.rootAbsolutePath}`;
  let p = writeGrants.get(key);
  if (!p) {
    p = (async () => ctx.host.capabilities.request({ kind: "fs", root: d.rootAbsolutePath, target: await targetFor(ctx, d), write: true, purpose: "Save files edited in the source editor." }))();
    writeGrants.set(key, p);
    p.catch(() => writeGrants.delete(key));
  }
  return p;
}

let watcher: ReturnType<typeof fileWatch> | null = null;
let changeTimer: ReturnType<typeof setTimeout> | null = null;
let selected: WorkspaceDescriptor | null = null;
let selection = 0;
let prefs: WatchPreferences = { defaults: true, gitignored: true, extra: "" };
/** Exclusions the running watcher uses, and when they were last recomputed. */
let watching: { key: string; exclude: string[]; at: number } | null = null;
const RECHECK_MS = 15000;
let recheckTimer: ReturnType<typeof setTimeout> | null = null;

/** (Re)start the project watcher with current exclusions. `force` restarts even if unchanged. */
async function startWatcher(ctx: ModuleContext, d: WorkspaceDescriptor | null, force = false) {
  if (!d) { watching = null; await watcher?.select(null); return; }
  const key = `${d.id}|${d.machineId}|${d.rootAbsolutePath}`;
  const exclude = await watchExcludes(ctx, d, prefs).catch(e => { ctx.log.warn(`Watch exclusions: ${errMsg(e)}`); return [] as string[]; });
  if (selected?.id !== d.id) return;
  const same = watching?.key === key && watching.exclude.length === exclude.length && watching.exclude.every((x, i) => x === exclude[i]);
  if (same && !force) { watching!.at = Date.now(); return; }
  watching = { key, exclude, at: Date.now() };
  ctx.state.set("files.watch", { workspaceId: d.id, warning: null, excluded: exclude.length });
  await watcher?.select(d, undefined, { exclude });
}

/** After changes, pick up newly ignored folders (a first build creating `target/`), at most
 *  every RECHECK_MS: restarting a watcher re-walks the project. */
function recheckExclusions(ctx: ModuleContext) {
  if (!prefs.gitignored || recheckTimer || !selected) return;
  const wait = Math.max(0, RECHECK_MS - (Date.now() - (watching?.at ?? 0)));
  recheckTimer = setTimeout(() => { recheckTimer = null; void startWatcher(ctx, selected).catch(e => ctx.log.warn(`File watcher: ${errMsg(e)}`)); }, wait);
}
async function watchSelected(ctx: ModuleContext) {
  const mine = ++selection;
  const ws: any = ctx.state.get("workspace.selected");
  try {
    const next = ws?.id ? await desc(ctx, ws.id) : null;
    if (mine !== selection) return;
    if (selected?.id === next?.id && selected?.machineId === next?.machineId && selected?.rootAbsolutePath === next?.rootAbsolutePath) return;
    selected = next;
    await startWatcher(ctx, next);
    // Warm all paths independently of which folders are expanded.
    if (next) {
      // This root was unwatched while another workspace was selected.
      invalidateSearch(next); invalidateIgnored(next);
      void searchFiles(ctx, next, "", false, true).catch(e => ctx.log.warn(`File index: ${errMsg(e)}`));
    }
  } catch (e) { ctx.log.warn(`File watcher: ${errMsg(e)}`); }
}
let skillsVersion = 0;
async function publishSkills(ctx: ModuleContext) {
  const version = ++skillsVersion;
  const workspace = ctx.state.get("workspace.selected") as any;
  const workspaceId = workspace?.id || null;
  ctx.state.set("files.skills", { workspaceId, skills: [], loading: !!workspaceId, error: null });
  if (!workspaceId) return;
  try {
    const skills = await workspaceSkills(ctx, await desc(ctx, workspaceId));
    if (version === skillsVersion) ctx.state.set("files.skills", { workspaceId, skills, loading: false, error: null });
  } catch (e) {
    if (version === skillsVersion) ctx.state.set("files.skills", { workspaceId, skills: [], loading: false, error: errMsg(e) });
  }
}

let presentations: FilePresentations | null = null;
const mod: AppModule = {
  id: "files",
  moduleApiVersion: 1,
  async activate(ctx) {
    presentations = new FilePresentations(ctx);
    await presentations.activate();
    ctx.events.on("git.changed", (event: any) => {
      if (!event.worktreeChanged || event.workspaceId !== selected?.id || !selected) return;
      invalidateSearch(selected); invalidateIgnored(selected);
      docCache.clear();
      ctx.events.emit("files.changed", { workspaceId: selected.id });
      void publishSkills(ctx);
    });
    prefs = await loadPreferences(ctx);
    exportSettings(ctx, () => [{ key: "files-watch", title: "File watching", fields: [
      { key: "defaults", label: "Skip dependency and cache folders", type: "toggle", value: prefs.defaults,
        description: `Changes inside ${DEFAULT_EXCLUDES.filter(n => n !== ".git").slice(0, 5).join(", ")} and similar folders do not refresh the explorer or Git status.` },
      { key: "gitignored", label: "Skip folders Git ignores", type: "toggle", value: prefs.gitignored,
        description: "Build output and other ignored folders (from .gitignore) are not watched. Use Refresh to see new files there." },
      { key: "extra", label: "Also skip", type: "text", value: prefs.extra, placeholder: "out, generated, /tmp",
        description: "Folder names (any depth, * and ? allowed) or paths from the project root with /, separated by commas." },
    ] }], async (_section, key, value) => {
      if (key === "extra" ? typeof value !== "string" : !["defaults", "gitignored"].includes(key) || typeof value !== "boolean") throw new Error("Invalid file watching setting");
      const next = { ...prefs, [key]: value } as WatchPreferences;
      await ctx.modules.call("persistence", "settings.set", { key: "files.watch", value: next });
      prefs = next;
      if (selected) { invalidateIgnored(selected); await startWatcher(ctx, selected, true); }
    });
    watcher = fileWatch(ctx, workspaceId => {
      if (changeTimer) clearTimeout(changeTimer);
      changeTimer = setTimeout(() => {
        if (selected?.id !== workspaceId) return;
        invalidateSearch(selected); invalidateIgnored(selected);
        docCache.clear();
        ctx.events.emit("files.changed", { workspaceId });
        void publishSkills(ctx);
        recheckExclusions(ctx);
      }, 200);
    }, {
      warning: (workspaceId, text) => {
        ctx.log.warn(`File watcher: ${text}`);
        if (selected?.id === workspaceId) ctx.state.set("files.watch", { workspaceId, warning: text, excluded: watching?.exclude.length ?? 0 });
      },
    });
    // View-state updates (tabs, preview) also change `workspace.selected`; skills only depend on
    // which workspace it is.
    let skillsFor = (ctx.state.get("workspace.selected") as any)?.id || null;
    ctx.state.watch("workspace.selected", (ws: any) => {
      const id = ws?.id || null;
      if (id !== skillsFor) { skillsFor = id; void publishSkills(ctx); }
      void watchSelected(ctx);
    });
    await watchSelected(ctx);
    ctx.events.on("ai.skillsRequested", () => { void publishSkills(ctx); });
    await publishSkills(ctx);
  },
  async deactivate() {
    presentations?.dispose(); presentations = null;
    selection++; skillsVersion++;
    stopSearchIndexes();
    if (changeTimer) clearTimeout(changeTimer);
    if (recheckTimer) clearTimeout(recheckTimer);
    recheckTimer = null; watching = null;
    await watcher?.stop(); watcher = null;
  },
  methods: {
    async presentations(ctx, a) {
      const workspace = await desc(ctx, a.workspaceId);
      return presentations?.get(workspace, Array.isArray(a.entries) ? a.entries : []) || {};
    },
    async search(ctx, a) {
      const query = String(a.query || "").slice(0, 300).trim();
      if (!query && a.refresh) { const d = await desc(ctx, a.workspaceId); invalidateSearch(d); invalidateIgnored(d); await searchFiles(ctx, d, "", false, a.hideIgnored !== false); }
      if (!query) return { entries: [], matchCount: 0, indexedCount: 0, partial: false, skipped: 0 };
      const d = await desc(ctx, a.workspaceId);
      if (a.refresh) invalidateIgnored(d);
      return searchFiles(ctx, d, query, !!a.refresh, !!a.hideIgnored);
    },
    /** Literal, case-insensitive search of file contents (git grep; grep outside repositories). */
    async grep(ctx, a) {
      const query = String(a.query || "").slice(0, 300);
      if (query.trim().length < 2) return { files: [], matchCount: 0, fileCount: 0, truncated: false };
      const d = await desc(ctx, a.workspaceId);
      return grepFiles(ctx, d, query, !a.hideIgnored, Math.min(2000, Math.max(1, Number(a.maxMatches) || 500)));
    },
    async list(ctx, a) {
      const d = await desc(ctx, a.workspaceId);
      const rel = cleanRel(a.relativeDir);
      return withWorkspace(ctx, d, async () => {
        const g = await workspaceGrant(ctx, d, "fs");
        const r = await ctx.host.fs.list(g.grant, rel);
        const hidden = new Set([".git", ".DS_Store"]);
        let entries = r.entries
          .filter((e) => a.showHidden || !hidden.has(e.name))
          .sort((x, y) => (x.kind === "dir" ? 0 : 1) - (y.kind === "dir" ? 0 : 1) || x.name.localeCompare(y.name))
          .map((e) => ({ ...e, relativePath: rel === "." ? e.name : `${rel}/${e.name}` }));
        let hiddenIgnored = 0;
        if (a.hideIgnored && entries.length) {
          const ignored = await ignoredAmong(ctx, d, entries);
          hiddenIgnored = ignored.size;
          entries = entries.filter((e) => !ignored.has(e.relativePath));
        }
        return { workspaceId: d.id, machineId: d.machineId, root: d.rootAbsolutePath, relativeDir: rel, entries, hiddenIgnored };
      });
    },

    /** Read a file and open a native document handle (syntax highlighting is native). */
    async open(ctx, a) {
      const d = await desc(ctx, a.workspaceId);
      const rel = cleanRel(a.relativePath);
      return withWorkspace(ctx, d, async () => {
        const g = await workspaceGrant(ctx, d, "fs");
        const st = await ctx.host.fs.stat(g.grant, rel);
        if (st.kind === "dir") throw new Error(`${rel} is a directory`);
        const key = `${d.id}|${rel}`;
        const cached = docCache.get(key);
        if (cached && cached.mtime === st.mtime && cached.size === st.size && (!a.includeText || cached.text !== undefined)) {
          return { workspaceId: d.id, relativePath: rel, document: cached.document, language: langFromPath(rel), size: st.size, mtime: st.mtime, binary: false, truncated: cached.truncated, ...(a.includeText ? { text: cached.text } : {}), cached: true };
        }
        const r = await ctx.host.fs.read(g.grant, rel, MAX_VIEW_BYTES);
        if (r.binary) {
          return { workspaceId: d.id, relativePath: rel, document: null, language: "binary", size: st.size, binary: true, truncated: r.truncated, message: `Binary file (${st.size} bytes) — not shown.` };
        }
        const language = langFromPath(rel);
        const text = r.truncated ? r.text + `\n\n… truncated: file is larger than ${MAX_VIEW_BYTES} bytes` : r.text!;
        const document = await ctx.host.ui.documentOpen(d.id, text, language, { path: rel });
        docCache.set(key, { document, mtime: st.mtime, size: st.size, ...(a.includeText ? { text } : {}), truncated: r.truncated });
        return { workspaceId: d.id, relativePath: rel, document, language, size: st.size, mtime: st.mtime, binary: false, truncated: r.truncated, ...(a.includeText ? { text } : {}) };
      });
    },

    /** Write a text file atomically. When `expectedMtime` is given and the file changed on disk
     *  since then, fails with a conflict unless `force`. The first write under a workspace root
     *  asks for native approval of a write grant. */
    async save(ctx, a) {
      const d = await desc(ctx, a.workspaceId);
      const rel = cleanRel(a.relativePath);
      if (rel === ".") throw new Error("a file path is required");
      if (typeof a.text !== "string") throw new Error("text must be a string");
      return withWorkspace(ctx, d, async () => {
        if (a.expectedMtime != null && !a.force) {
          const g = await workspaceGrant(ctx, d, "fs");
          const st = await ctx.host.fs.stat(g.grant, rel).catch(() => null);
          if (st && st.mtime != null && st.mtime !== a.expectedMtime) {
            const err: any = new Error(`${rel} changed on disk since it was opened`); err.code = "ECONFLICT"; throw err;
          }
        }
        const key = `${d.machineId}|${d.rootAbsolutePath}`;
        const w = await writeGrant(ctx, d);
        try { await ctx.host.fs.writeAtomic(w.grant, rel, a.text, { reason: `Save ${rel}` }); }
        catch (e: any) { if (e && ["ENOTCONN", "ESTALE", "EBADF"].includes(e.code)) writeGrants.delete(key); throw e; }
        docCache.delete(`${d.id}|${rel}`);
        const g = await workspaceGrant(ctx, d, "fs");
        const st = await ctx.host.fs.stat(g.grant, rel);
        return { workspaceId: d.id, relativePath: rel, size: st.size, mtime: st.mtime };
      });
    },

    async stat(ctx, a) {
      const d = await desc(ctx, a.workspaceId);
      const g = await workspaceGrant(ctx, d, "fs");
      try { return await ctx.host.fs.stat(g.grant, cleanRel(a.relativePath)); } catch (e) { return { error: errMsg(e) }; }
    },
  },
};
export default mod;
