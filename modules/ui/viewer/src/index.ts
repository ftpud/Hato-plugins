import { FilePresentationClient } from "@hato/sdk/file-presentation";
// viewer: a native syntax-highlighted source editor bound to a kernel document handle, with
// autosave through the files service. Highlighting, editing and selection are native; the module
// owns save policy (debounce, conflicts, retries). Tabs prefixed by DIFF_TAB_PREFIX show a native
// Git diff of that file instead (opened by git-panel).
import type { AppModule, ModuleContext, UiNode } from "@hato/sdk/types";
import { fileIcons } from "@hato/sdk/file-icons";
import { fileTabStyle, tabButtonStyle } from "@hato/sdk/tab-style";
import { exportSettings } from "@hato/sdk/settings";
import { fontOptions } from "@hato/sdk/typography";
import { errMsg } from "@hato/sdk/runtime";
import { resolveWorkspaceLink } from "@hato/sdk/links";
import { diffTabPath } from "@hato/sdk/git";
import { uiIcons } from "@hato/sdk/ui-icons";

import { languageDefinitions, languageForPath, workspacePath, relativeFile, validPosition, type LanguageDefinition } from "@hato/sdk/languages";

import { shellBlocks } from "./markdown";
import { enclosingType, hoverType, receiverAt, shapeCompletions, shapeHover } from "./assist";
import { diffLines } from "@hato/sdk/text-diff";

// ---- Git change markers -------------------------------------------------------------------
// HEAD text per open file; hunks are recomputed locally as the buffer changes.
interface Hunk { line: number; added: number; removed: string[]; current: string[] }
const heads = new Map<string, { text: string | null; tracked: boolean }>();
let hunks: Hunk[] = [];
let hunkView: { index: number; hunk: Hunk } | null = null;
let gitMarkers = true;
const headKey = (workspaceId: string, path: string) => `${workspaceId}|${path}`;
function computeHunks(head: string | null, text: string | null | undefined): Hunk[] {
  if (head === null || typeof text !== "string") return [];
  const a = head.split("\n"), b = text.split("\n");
  if (a.length > 20000 || b.length > 20000) return [];
  const out: Hunk[] = [];
  let line = 0, cur: Hunk | null = null;
  for (const op of diffLines(a, b)) {
    if (op.kind === " ") { cur = null; line++; continue; }
    if (!cur) { cur = { line, added: 0, removed: [], current: [] }; out.push(cur); }
    if (op.kind === "+") { cur.added++; cur.current.push(op.line); line++; }
    else cur.removed.push(op.line);
  }
  return out;
}

let showMetadata = true;
let renderMarkdown = true;
let diffMode: "split" | "unified" = "split";
// Word wrap is configured separately for the source editor and for read-only views (diffs).
let editorWrap = false;
let viewerWrap = true;
let publishSettings: () => void = () => {};
let presentation: FilePresentationClient | null = null;
let ws: any = null;
let current: any = null;
let error: string | null = null;
let loadingPath: string | null = null;

let editable = true;
let autosave = true;
let autosaveDelay = 800;
const AUTOSAVE_DELAYS = [300, 800, 2000, 5000];

// Source editor font. Empty values follow the global (interface) font settings.
const GLOBAL_FONT = "global";
const editorFontOptions = [{ value: GLOBAL_FONT, label: "Global default" }, ...fontOptions.filter(o => o.value !== "system")];
const FONT_NUMBERS = {
  fontWeight: { min: 100, max: 900, label: "Font weight" },
  fontSize: { min: 8, max: 40, label: "Size" },
  lineHeight: { min: 1, max: 3, label: "Line height" },
} as const;
type FontNumber = keyof typeof FONT_NUMBERS;
let editorFont = { family: GLOBAL_FONT, fontWeight: "", fontSize: "", lineHeight: "" };
function fontNumber(key: FontNumber, raw: unknown): string {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  const value = Number(text), { min, max, label } = FONT_NUMBERS[key];
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${label} must be between ${min} and ${max}, or empty for the global default`);
  return String(value);
}
function editorFontNode() {
  const font: { family?: string; weight?: number; size?: number; lineHeight?: number } = {};
  if (editorFont.family !== GLOBAL_FONT) font.family = editorFont.family;
  if (editorFont.fontWeight) font.weight = Number(editorFont.fontWeight);
  if (editorFont.fontSize) font.size = Number(editorFont.fontSize);
  if (editorFont.lineHeight) font.lineHeight = Number(editorFont.lineHeight);
  return Object.keys(font).length ? font : undefined;
}

// Edits keyed by document handle so a debounced change that lands after a tab switch still
// saves the right file. `mtime` is the on-disk version this buffer is based on.
interface Buffer { workspaceId: string; path: string; mtime: number | null; text: string | null;
  state: "clean" | "dirty" | "saving" | "error" | "conflict"; error?: string; inflight?: boolean; again?: boolean }
const buffers = new Map<string, Buffer>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function bufferFor(path: string | null | undefined): Buffer | undefined {
  if (!path || !ws) return undefined;
  for (const b of buffers.values()) if (b.workspaceId === ws.id && b.path === path) return b;
  return undefined;
}
const unsaved = (b?: Buffer) => !!b && b.state !== "clean";

async function save(ctx: ModuleContext, b: Buffer, force = false) {
  if (b.text === null) return;
  if (b.inflight) { b.again = true; return; }
  b.inflight = true; b.again = false; b.state = "saving"; ctx.ui.invalidate();
  const text = b.text;
  try {
    const r = await ctx.modules.call("files", "save", { workspaceId: b.workspaceId, relativePath: b.path, text, expectedMtime: b.mtime, force }, { timeoutMs: 600000 });
    b.mtime = r?.mtime ?? b.mtime;
    if (current?.workspaceId === b.workspaceId && current.relativePath === b.path) current.text = text;
    if (b.text === text) { b.state = "clean"; b.text = null; } else b.state = "dirty";
    b.error = undefined;
    if (languageService) void ctx.modules.call("language-service", "saved", { workspaceId: b.workspaceId, path: b.path, text }, { timeoutMs: 175000 }).catch(e => ctx.log.warn(errMsg(e)));
  } catch (e: any) {
    const msg = errMsg(e);
    b.state = e?.code === "ECONFLICT" || /changed on disk/.test(msg) ? "conflict" : "error";
    b.error = msg; b.again = false;
  } finally {
    b.inflight = false;
    if (b.again && b.state === "dirty") void save(ctx, b);
    ctx.ui.invalidate();
  }
}
function scheduleSaves(ctx: ModuleContext, now = false) {
  if (saveTimer) clearTimeout(saveTimer);
  const run = () => { saveTimer = null; for (const b of buffers.values()) if (b.state === "dirty") void save(ctx, b); };
  if (now) run(); else saveTimer = setTimeout(run, autosaveDelay);
}

let tabs: string[] = [];
let tabMenu: string | null = null;
const shellRequests = new Map<string, { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
function runShellBlock(ctx: ModuleContext, args: object) {
  const requestId = crypto.randomUUID();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { shellRequests.delete(requestId); reject(new Error("Opening the shell block terminal timed out.")); }, 60000);
    shellRequests.set(requestId, { resolve, reject, timer });
    ctx.events.emit("viewer.runCode", { requestId, ...args });
  });
}
let generation = 0;
let languages: LanguageDefinition[] = [];
let languageService = false;
let languageError: string | null = null;
let projectLanguageEnabled = true;
let languageTimer: ReturnType<typeof setTimeout> | null = null;
function languageRequest() {
  const buffer = current?.document ? buffers.get(current.document) : undefined;
  return { workspaceId: ws?.id, path: current?.relativePath, text: buffer?.text ?? current?.text,
    documents: [...buffers.values()].filter(b => b.workspaceId === ws?.id && b.text !== null).map(b => ({ path: b.path, text: b.text })) };
}
// Semantic classes from the language server, per file: identifier → LSP token kind.
const semantic = new Map<string, Record<string, string>>();
// Which semantic kinds restyle which grammar capture (scheme keys such as "type.interface").
const SEMANTIC_CAPTURES: Record<string, [base: string, capture: string]> = {
  interface: ["type", "type.interface"], enum: ["type", "type.enum"], typeParameter: ["type", "type.typeParameter"],
  property: ["variable", "property"], enumMember: ["variable", "constant"],
};
function nameCaptures(workspaceId: string | undefined, path: string | undefined) {
  const names = workspaceId && path ? semantic.get(headKey(workspaceId, path)) : undefined;
  if (!names) return undefined;
  const out: Record<string, Record<string, string>> = {};
  for (const [name, kind] of Object.entries(names)) {
    const target = SEMANTIC_CAPTURES[kind];
    if (target) (out[target[0]] ??= {})[name] = target[1];
  }
  return Object.keys(out).length ? out : undefined;
}
async function refreshSemantic(ctx: ModuleContext, request: ReturnType<typeof languageRequest>) {
  const key = headKey(request.workspaceId, request.path!);
  try {
    const names = await ctx.modules.call("language-service", "semanticNames", request, { timeoutMs: 60000 });
    if (!names || typeof names !== "object") return;
    // An empty answer while the server is still importing must not wipe known classes.
    if (!Object.keys(names).length && semantic.has(key)) return;
    if (JSON.stringify(semantic.get(key)) === JSON.stringify(names)) return;
    semantic.delete(key); semantic.set(key, names);
    while (semantic.size > 40) semantic.delete(semantic.keys().next().value!);
    if (request.workspaceId === ws?.id && request.path === current?.relativePath) ctx.ui.invalidate();
  } catch (e) { ctx.log.warn(`semantic names: ${errMsg(e)}`); }
}
async function synchronizeLanguage(ctx: ModuleContext) {
  const request = languageRequest();
  const language = languageForPath(languages, request.path || "");
  if (!languageService || !language?.server || current?.binary || current?.truncated || current?.diff || typeof request.text !== "string") { projectLanguageEnabled = true; ctx.ui.invalidate(); return; }
  const project = await ctx.modules.call("language-service","project.get",{workspaceId:request.workspaceId,serverId:language.server.id}).catch(()=>null);
  projectLanguageEnabled = project?.config.enabled !== false;
  if (request.workspaceId !== ws?.id || request.path !== current?.relativePath || !projectLanguageEnabled) return;
  try {
    await ctx.modules.call("language-service", "synchronize", request, { timeoutMs: 175000 });
    if (request.workspaceId === ws?.id && request.path === current?.relativePath) { languageError = null; ctx.ui.invalidate(); void refreshSemantic(ctx, request); }
  }
  catch (e) { if (request.workspaceId === ws?.id && request.path === current?.relativePath) { languageError = errMsg(e); ctx.ui.invalidate(); } }
}
async function editorRequest(ctx: ModuleContext, a: any, method: string) {
  const buffer = buffers.get(a.document);
  const empty = method === "hover" || method === "signatureHelp" ? null : [];
  if (!languageService || !buffer || buffer.workspaceId !== a.workspaceId || buffer.path !== a.path || typeof a.text !== "string") return empty;
  try {
    const result = await ctx.modules.call("language-service", method, { ...a,
      documents: [...buffers.values()].filter(b => b.workspaceId === buffer.workspaceId && b.text !== null).map(b => ({ path: b.path, text: b.text })),
    }, { timeoutMs: 175000 });
    languageError = null; ctx.ui.invalidate(); return result;
  } catch (e) { languageError = errMsg(e); ctx.ui.invalidate(); return empty; }
}

// ---- IDEA-style completion items and hovers (see ./assist) --------------------------------
// Shaped items map back to the server's originals for completionItem/resolve (auto-import).
const shapedOriginals = new Map<string, any>();
const shapeKey = (item: any) => `${item.label}\u0000${JSON.stringify(item.data ?? null)}`;
/** Simple name of the type whose members are being completed (receiver type, else enclosing type). */
async function completionOwner(ctx: ModuleContext, a: any): Promise<string | null> {
  if (typeof a.text !== "string" || !validPosition(a.position)) return null;
  const lines = a.text.split("\n");
  const line = lines[a.position.line] ?? "";
  let offset = 0;
  for (let i = 0; i < a.position.line; i++) offset += lines[i].length + 1;
  const enclosing = enclosingType(a.text, offset + a.position.character);
  const receiver = receiverAt(line, a.position.character);
  if (!receiver) return enclosing;
  if (receiver.name === "this") return enclosing;
  const hover = await editorRequest(ctx, { ...a, position: { line: a.position.line, character: receiver.character } }, "hover");
  return hoverType(hover) ?? (/^[A-Z]/.test(receiver.name) ? receiver.name : null);
}
let navigation: { workspaceId: string; path: string; key: string; line: number; character: number } | null = null;
async function refreshLanguages(ctx: ModuleContext) {
  const { plugins } = await ctx.host.plugins.list();
  languages = languageDefinitions(plugins);
  languageService = plugins.some(p => p.id === "language-service" && p.enabled && !!p.active);
  ctx.ui.invalidate();
  void synchronizeLanguage(ctx);
}
function restoreTabs() {
  const saved = ws?.view?.ui?.viewerTabs;
  tabs = Array.isArray(saved) ? saved.filter((p: unknown) => typeof p === "string") : [];
}
async function saveTabs(ctx: ModuleContext) {
  await ctx.modules.call("workspace", "view.patch", { workspaceId: ws.id, patch: { ui: { viewerTabs: [...tabs] } } });
}
async function load(ctx: ModuleContext, force = false) {
  const path = ws?.view?.previewPath || null;
  const workspaceId = ws?.id;
  if (!workspaceId || !path) { generation++; loadingPath = null; current = null; projectLanguageEnabled = true; error = null; ctx.ui.invalidate(); return; }
  if (!tabs.includes(path)) { tabs.push(path); await saveTabs(ctx); }
  if (ws?.id !== workspaceId || ws?.view?.previewPath !== path) return;
  if (!force && current?.workspaceId === workspaceId && current.tab === path || loadingPath === path) return;
  const mine = ++generation;
  const diffPath = diffTabPath(path);
  // Switching back to a file shows its last opened document at once (remote workspaces pay a
  // round trip per open); the open below still runs and swaps in a newer version if the file changed.
  const known = !force && !diffPath ? opened.get(openedKey(workspaceId, path)) : undefined;
  if (known) { current = known; languageError = null; updateHunks(); }
  // A forced reload (diff refresh) keeps the current view until the new one arrives.
  else if (!force) { current = null; languageError = null; }
  error = null; loadingPath = path; ctx.ui.invalidate();
  if (known) void synchronizeLanguage(ctx);
  try {
    const r = diffPath
      ? { ...(await ctx.modules.call("git", "diff", { workspaceId, path: diffPath }, { timeoutMs: 45000 })), diff: true, relativePath: diffPath }
      : await ctx.modules.call("files", "open", { workspaceId, relativePath: path, includeText: true });
    // Keep unsaved edits on screen when the file changed underneath them; saving reports the conflict.
    const keep = known && r.document !== known.document && unsaved(buffers.get(known.document));
    if (mine === generation && !keep) {
      current = { ...r, workspaceId, tab: path }; error = null;
      if (!r.diff && !r.binary && r.document) rememberOpened(current);
      if (!r.diff && r.document && !buffers.has(r.document)) {
        // A fresh handle replaces any older clean buffer for the same file.
        for (const [doc, b] of buffers) if (b.workspaceId === workspaceId && b.path === r.relativePath && b.state === "clean") buffers.delete(doc);
        buffers.set(r.document, { workspaceId, path: r.relativePath, mtime: r.mtime ?? null, text: null, state: "clean" });
      }
    }
  } catch (e) { if (mine === generation) { error = errMsg(e); current = null; opened.delete(openedKey(workspaceId, path)); } }
  finally {
    if (mine === generation) {
      loadingPath = null;
      if (!known || current?.document !== known.document) void synchronizeLanguage(ctx);
      void refreshHead(ctx);
    }
    ctx.ui.invalidate();
  }
}
// Last opened result per file tab, so switching tabs needs no round trip before drawing.
const opened = new Map<string, any>();
const OPENED_LIMIT = 40;
const openedKey = (workspaceId: string, path: string) => `${workspaceId}|${path}`;
function rememberOpened(result: any) {
  const key = openedKey(result.workspaceId, result.tab);
  opened.delete(key); opened.set(key, result);
  while (opened.size > OPENED_LIMIT) opened.delete(opened.keys().next().value!);
}
function updateHunks() {
  const head = current && !current.diff && !current.binary && !current.truncated && ws ? heads.get(headKey(ws.id, current.relativePath)) : undefined;
  const text = current?.document ? buffers.get(current.document)?.text ?? current.text : undefined;
  hunks = gitMarkers && head?.tracked ? computeHunks(head.text, text) : [];
  if (hunkView && !hunks[hunkView.index]) hunkView = null;
}
async function refreshHead(ctx: ModuleContext) {
  if (!gitMarkers || !ws || !current || current.diff || current.binary) { updateHunks(); ctx.ui.invalidate(); return; }
  const workspaceId = ws.id, path = current.relativePath;
  try {
    const r = await ctx.modules.call("git", "headText", { workspaceId, path }, { timeoutMs: 30000 });
    heads.set(headKey(workspaceId, path), { text: r?.text ?? null, tracked: !!r?.tracked });
  } catch { heads.delete(headKey(workspaceId, path)); }
  updateHunks(); ctx.ui.invalidate();
}

function tabLabel(tab: string) {
  const file = diffTabPath(tab) ?? tab;
  const name = file.split("/").pop() || file;
  return diffTabPath(tab) ? `Δ ${name}` : unsaved(bufferFor(tab)) ? `● ${name}` : name;
}

/** Reload the open file when it changed on disk and has no unsaved edits. */
async function refreshFromDisk(ctx: ModuleContext) {
  if (!current || current.diff || current.binary || !ws) return;
  const b = buffers.get(current.document);
  if (!b || b.state !== "clean" || b.inflight) return;
  const st = await ctx.modules.call("files", "stat", { workspaceId: ws.id, relativePath: current.relativePath }).catch(() => null);
  if (!st || st.error || st.mtime == null || st.mtime === b.mtime) return;
  if (buffers.get(current?.document) === b && b.state === "clean") void load(ctx, true);
}

function saveStatus(b: Buffer | undefined): { text: string; color: string; tooltip?: string } {
  if (!b) return { text: "", color: "muted" };
  switch (b.state) {
    case "saving": return { text: "Saving…", color: "muted" };
    case "dirty": return { text: autosave ? "Edited" : "Unsaved", color: autosave ? "muted" : "warning" };
    case "error": return { text: "Save failed", color: "danger", tooltip: b.error };
    case "conflict": return { text: "Changed on disk", color: "warning", tooltip: b.error };
    default: return { text: b.mtime != null ? "Saved" : "", color: "muted" };
  }
}

const mod: AppModule = {
  id: "viewer",
  moduleApiVersion: 1,
  async activate(ctx, prev) {
    presentation = new FilePresentationClient(ctx);
    ctx.events.on("terminal-panel.runCodeResult", (result: any) => {
      const pending = shellRequests.get(result?.requestId);
      if (!pending) return;
      shellRequests.delete(result.requestId); clearTimeout(pending.timer);
      if (result.error) pending.reject(new Error(result.error)); else pending.resolve();
    });
    await refreshLanguages(ctx);
    ctx.events.on("kernel.modules.changed", () => { void refreshLanguages(ctx).catch(e => ctx.log.warn(errMsg(e))); });
    const saved = await ctx.modules.call("persistence", "settings.get", { key: "viewer.showMetadata" });
    showMetadata = typeof saved === "boolean" ? saved : true;
    const savedMarkdown = await ctx.modules.call("persistence", "settings.get", { key: "viewer.renderMarkdown" });
    renderMarkdown = typeof savedMarkdown === "boolean" ? savedMarkdown : true;
    const savedDiffMode = await ctx.modules.call("persistence", "settings.get", { key: "viewer.diffMode" });
    diffMode = savedDiffMode === "unified" ? "unified" : "split";
    const savedEditorWrap = await ctx.modules.call("persistence", "settings.get", { key: "viewer.editorWrap" });
    editorWrap = typeof savedEditorWrap === "boolean" ? savedEditorWrap : false;
    const savedViewerWrap = await ctx.modules.call("persistence", "settings.get", { key: "viewer.viewerWrap" });
    viewerWrap = typeof savedViewerWrap === "boolean" ? savedViewerWrap : true;
    const savedMarkers = await ctx.modules.call("persistence", "settings.get", { key: "viewer.gitMarkers" });
    gitMarkers = typeof savedMarkers === "boolean" ? savedMarkers : true;
    const savedEditable = await ctx.modules.call("persistence", "settings.get", { key: "viewer.editable" });
    editable = typeof savedEditable === "boolean" ? savedEditable : true;
    const savedAutosave = await ctx.modules.call("persistence", "settings.get", { key: "viewer.autosave" });
    autosave = typeof savedAutosave === "boolean" ? savedAutosave : true;
    const savedDelay = await ctx.modules.call("persistence", "settings.get", { key: "viewer.autosaveDelay" });
    autosaveDelay = AUTOSAVE_DELAYS.includes(Number(savedDelay)) ? Number(savedDelay) : 800;
    const savedFont = await ctx.modules.call("persistence", "settings.get", { key: "viewer.editorFont" });
    editorFont = { family: editorFontOptions.some(o => o.value === savedFont?.family) ? savedFont.family : GLOBAL_FONT, fontWeight: "", fontSize: "", lineHeight: "" };
    for (const key of Object.keys(FONT_NUMBERS) as FontNumber[]) { try { editorFont[key] = fontNumber(key, savedFont?.[key]); } catch { /* ignore invalid saved value */ } }
    for (const [doc, b] of Object.entries(prev?.buffers || {}) as [string, Buffer][]) buffers.set(doc, { ...b, inflight: false, again: false });
    publishSettings = exportSettings(ctx, () => [{ key: "viewer", title: "Source editor", fields: [
      { key: "editable", label: "Edit files", type: "toggle", value: editable,
        description: "Allow editing in the source panel. The first save in a workspace asks for write access." },
      { key: "autosave", label: "Autosave", type: "toggle", value: autosave,
        description: "Save edits automatically after you stop typing. When off, use Save in the status bar." },
      { key: "autosaveDelay", label: "Autosave delay", type: "select", value: String(autosaveDelay),
        options: AUTOSAVE_DELAYS.map(ms => ({ value: String(ms), label: ms < 1000 ? `${ms} ms` : `${ms / 1000} s` })),
        description: "Quiet time after the last keystroke before saving." },
      { key: "editorWrap", label: "Wrap lines in the editor", type: "toggle", value: editorWrap,
        description: "Soft-wrap long lines when editing source files (including Markdown source)." },
      { key: "viewerWrap", label: "Wrap lines in diffs", type: "toggle", value: viewerWrap,
        description: "Soft-wrap long lines in Git diff review. Markdown previews always reflow." },
      { key: "gitMarkers", label: "Show Git change bars", type: "toggle", value: gitMarkers,
        description: "Mark added, changed and deleted lines next to the line numbers. Click a bar to review or roll back the change." },
      { key: "showMetadata", label: "Show file metadata", type: "toggle", value: showMetadata,
        description: "Display the language and file size in the bottom status bar." },
      { key: "renderMarkdown", label: "Preview Markdown files", type: "toggle", value: renderMarkdown,
        description: "Render Markdown documents. Switch between Preview and Source in the viewer status bar." },
      { key: "diffMode", label: "Diff layout", type: "select", value: diffMode,
        options: [{ value: "split", label: "Side by side" }, { value: "unified", label: "Unified" }],
        description: "How Git diffs are compared. Switch in the viewer status bar." },
    ] }, { key: "viewer-font", title: "Editor font", fields: [
      { key: "fontFamily", label: "Font", type: "select", value: editorFont.family, options: editorFontOptions,
        description: editorFont.family === GLOBAL_FONT ? "Global default" : "Source editor only" },
      ...(Object.keys(FONT_NUMBERS) as FontNumber[]).map(key => ({ key, label: FONT_NUMBERS[key].label, type: "text" as const, value: editorFont[key],
        placeholder: "Default", description: editorFont[key] ? `Source editor only · ${FONT_NUMBERS[key].min}–${FONT_NUMBERS[key].max}` : "Global default" })),
    ] }], async (section, key, value) => {
      if (section === "viewer-font") {
        const next = { ...editorFont };
        if (key === "fontFamily") {
          if (typeof value !== "string" || !editorFontOptions.some(o => o.value === value)) throw new Error("Invalid editor font");
          next.family = value;
        } else if (key in FONT_NUMBERS) next[key as FontNumber] = fontNumber(key as FontNumber, value);
        else throw new Error("Invalid editor font setting");
        await ctx.modules.call("persistence", "settings.set", { key: "viewer.editorFont", value: next });
        editorFont = next; ctx.ui.invalidate(); return;
      }
      if (key === "diffMode") {
        if (value !== "split" && value !== "unified") throw new Error("Invalid diff layout");
        await ctx.modules.call("persistence", "settings.set", { key: "viewer.diffMode", value });
        diffMode = value; return;
      }
      if (key === "autosaveDelay") {
        const ms = Number(value);
        if (!AUTOSAVE_DELAYS.includes(ms)) throw new Error("Invalid autosave delay");
        await ctx.modules.call("persistence", "settings.set", { key: "viewer.autosaveDelay", value: ms });
        autosaveDelay = ms; return;
      }
      if (!["showMetadata", "renderMarkdown", "editable", "autosave", "editorWrap", "viewerWrap", "gitMarkers"].includes(key) || typeof value !== "boolean") throw new Error("Invalid viewer setting");
      await ctx.modules.call("persistence", "settings.set", { key: `viewer.${key}`, value });
      if (key === "showMetadata") showMetadata = value;
      else if (key === "renderMarkdown") renderMarkdown = value;
      else if (key === "editable") editable = value;
      else if (key === "editorWrap") editorWrap = value;
      else if (key === "viewerWrap") viewerWrap = value;
      else if (key === "gitMarkers") { gitMarkers = value; void refreshHead(ctx); }
      else { autosave = value; if (value) scheduleSaves(ctx); }
      ctx.ui.invalidate();
    });
    ws = ctx.state.get("workspace.selected") || null;
    restoreTabs();
    // Keep an open diff current as the working tree changes.
    ctx.events.on("git-panel.statusChanged", (e: any) => {
      if (current?.diff && e?.workspaceId === ws?.id && ws?.view?.previewPath === current.tab) void load(ctx, true);
    });
    ctx.events.on("git.changed", (e: any) => { if (e?.workspaceId === ws?.id) { heads.clear(); void refreshHead(ctx); } });
    ctx.events.on("language-service.configurationChanged", () => { void synchronizeLanguage(ctx); });
    ctx.events.on("language-service.changed", () => { void synchronizeLanguage(ctx); });

    ctx.events.on("files.changed", (e: any) => { if (e?.workspaceId === ws?.id) void refreshFromDisk(ctx); });
    ctx.state.watch("workspace.selected", (v: any) => {
      const changed = ws?.id !== v?.id; ws = v;
      if (changed) { projectLanguageEnabled = true; languageError = null; navigation = null; generation++; current = null; loadingPath = null; restoreTabs(); }
      void load(ctx);
    });
    await load(ctx);
  },
  async deactivate(ctx) {
    presentation?.dispose(); presentation = null;
    if (languageTimer) clearTimeout(languageTimer);
    for (const pending of shellRequests.values()) { clearTimeout(pending.timer); pending.reject(new Error("Editor reloaded.")); }
    shellRequests.clear();
    // Flush pending edits before a hot swap; unsaved buffers also survive in the snapshot.
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (autosave) await Promise.all([...buffers.values()].filter(b => b.state === "dirty").map(b => save(ctx, b)));
  },
  snapshot: () => ({ current, buffers: Object.fromEntries([...buffers].filter(([, b]) => b.state !== "clean" || b.mtime != null).map(([d, b]) => [d, { ...b, inflight: false }])) }),
  methods: {
    "language.document"(_ctx,a) {
      if(a.workspaceId!==ws?.id)throw new Error("The editor is showing a different workspace");
      return languageRequest();
    },
    async "editor.openLocation"(ctx,a) {
      if(a.workspaceId!==ws?.id || !validPosition(a.position))throw new Error("Invalid workspace navigation");
      const path=a.uri?workspacePath(ws.rootAbsolutePath,a.uri):a.path?relativeFile(a.path):null;
      if(!path)throw new Error("Symbol is outside this workspace or has no source location");
      navigation={workspaceId:ws.id,path,key:crypto.randomUUID(),...a.position};
      await ctx.modules.call("workspace","view.patch",{workspaceId:ws.id,patch:{previewPath:path}});
    },
    async "editor.definitions"(ctx, a) { return editorRequest(ctx, a, "definitions"); },
    async "editor.hover"(ctx, a) {
      const hover = await editorRequest(ctx, a, "hover");
      return hover ? shapeHover(hover, { text: a.text, path: a.path, language: languageForPath(languages, String(a.path || ""))?.grammar }) : hover;
    },
    async "editor.completions"(ctx, a) {
      const [result, owner] = await Promise.all([editorRequest(ctx, a, "completions"), completionOwner(ctx, a).catch(() => null)]);
      return shapeCompletions(result, owner, shapedOriginals, shapeKey);
    },
    async "editor.signature"(ctx, a) { return editorRequest(ctx, a, "signatureHelp"); },
    async "editor.resolveCompletion"(ctx, a) {
      const original = shapedOriginals.get(shapeKey(a.item || {}));
      const buffer = buffers.get(a.document);
      if (!original || !languageService || !buffer || buffer.workspaceId !== a.workspaceId || buffer.path !== a.path) return a.item;
      return ctx.modules.call("language-service", "resolveCompletion", { workspaceId: a.workspaceId, path: a.path, item: original }, { timeoutMs: 45000 }).catch(() => a.item);
    },
  },
  render(): UiNode {
    const diff = !!current?.diff;
    const search = ws?.view?.ui?.viewerSearch;
    const editorSearch = search?.path === current?.relativePath && typeof search?.query === "string" && typeof search?.key === "string" ? { key: search.key, query: search.query } : undefined;
    const markdown = current && !diff && !current.binary && (current.language === "markdown" || /\.(md|markdown)$/i.test(current.relativePath));
    const title = current ? (diff ? `Changes in ${current.relativePath}` : current.relativePath) : ws?.view?.previewPath || "No file selected";
    const kids: UiNode[] = [
      { type: "row", key: "tabs", gap: 3, wrap: true, children: tabs.map((path): UiNode => {
        const active = ws?.view?.previewPath === path;
        const appearance = presentation?.get(ws.id, diffTabPath(path) || path) || {};
        const tint = appearance.background ? { background: appearance.background } : {};
        const buttonStyle = { ...tabButtonStyle(active), ...tint };
        return { type: "row", key: path, gap: 0, style: { ...fileTabStyle(active), ...tint }, children: [
        { type: "button", key: "select", iconSvg: appearance.iconSvg || fileIcons.file, iconColor: appearance.iconColor, text: tabLabel(path), tooltip: diffTabPath(path) ? `Changes in ${diffTabPath(path)}` : path, action: `select:${path}`, middleClickAction: `close:${path}`, contextAction: `tabMenu:${path}`, contextMenu: [
          { text: "Close", action: `close:${path}` },
          { text: "Close others", action: "closeOthers", value: path, disabled: tabs.length < 2 },
          { text: "Close all to the right", action: "closeRight", value: path, disabled: tabs.indexOf(path) === tabs.length - 1 },
          { text: "Close all", action: "closeAll", value: path },
        ], small: true, variant: "ghost", style: buttonStyle },
        { type: "button", key: "close", text: "", iconSvg: uiIcons["x"], tooltip: `Close ${path}`, action: `close:${path}`, small: true, variant: "ghost", style: buttonStyle },
      ] }; }) },

    ];
    if (languageError) kids.push({ type: "status", key: "language-error", text: languageError, level: "warn" });
    if (error) kids.push({ type: "status", key: "err", text: error, level: "error" });
    if (loadingPath && current?.tab !== loadingPath) kids.push({ type: "progress", key: "ld", indeterminate: true, label: `Opening ${loadingPath}…` });
    if (current && current.binary) kids.push({ type: "status", key: "bin", text: current.message, level: "info" });
    if (diff) kids.push({ type: "diff", key: "diff", changeNavigation: { previous: "Previous change", next: "Next change" }, document: current.document, mode: diffMode, softWrap: viewerWrap, header: false, emptyText: "No changes against HEAD.", grow: true });
    else if (markdown && renderMarkdown && !editorSearch) {
      const markdownText = bufferFor(current.relativePath)?.text ?? current.text;
      const blocks = typeof markdownText === "string" ? shellBlocks(markdownText) : [];
      if (!blocks.length) kids.push({ type: "markdown", key: "preview", document: current.document, linkAction: "openLink", grow: true });
      else {
        const content: UiNode[] = [];
        let offset = 0;
        for (const [index, block] of blocks.entries()) {
          if (offset < block.start) content.push({ type: "markdown", key: `md:${offset}`, text: markdownText.slice(offset, block.start), inline: true, linkAction: "openLink" });
          // A fence longer than any backtick run keeps the source literal inside the code body.
          let fence = "```";
          for (const run of block.code.matchAll(/`+/g)) if (run[0].length >= fence.length) fence = "`".repeat(run[0].length + 1);
          content.push({ type: "column", key: `shell:${block.start}`, style: { paddingY: 12 }, children: [{ type: "column", key: "shell-card", gap: 0,
            style: { borderWidth: 1, borderColor: "border", radius: 8, background: "field" }, children: [
              { type: "row", key: "header", gap: 8, align: "center", style: { background: "panel", borderBottom: 1, borderColor: "border", paddingX: 14, paddingY: 6, minHeight: 36 }, children: [
                { type: "label", key: "language", text: block.language.toUpperCase(), size: "xs", color: "muted", grow: true },
                { type: "button", key: "run", text: "", action: "runShellBlock", value: block.start, variant: "ghost", small: true,
                  iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="m7 4 14 8-14 8Z"/></svg>',
                  iconSize: 16, style: { color: "success", background: "surface", radius: 7, paddingX: 7, paddingY: 4 },
                  tooltip: `Run in block terminal · shell block ${index + 1}` },
              ] },
              { type: "markdown", key: "code", codeBlockStyle: { borderWidth: 0, background: "transparent", paddingX: 16, paddingY: 14 }, text: fence + "\n" + block.code + (block.code.endsWith("\n") ? "" : "\n") + fence, inline: true },
            ] }] });
          offset = block.end;
        }
        if (offset < markdownText.length) content.push({ type: "markdown", key: `md:${offset}`, text: markdownText.slice(offset), inline: true, linkAction: "openLink" });
        kids.push({ type: "scroll", key: "preview", padding: 12, grow: true, children: content });
      }
    }
    else {
      const canEdit = editable && !!current && !current.binary && !current.truncated && !!current.document;
      const language = current ? languageForPath(languages, current.relativePath) : null;
      kids.push({ type: "codeViewer", key: "code", document: current && !current.binary ? current.document : null, placeholder: ws ? "Open a file from the explorer." : "Select a workspace.", grow: true,
        editable: canEdit, changeAction: canEdit ? "edit" : undefined, changeDebounceMs: 250,
        language: language?.grammar, syntaxRules: language?.syntaxRules, softWrap: editorWrap, font: editorFontNode(),
        highlightQuery: Array.isArray(language?.highlightQuery) ? language.highlightQuery.join("\n") : language?.highlightQuery,
        nameCaptures: languageService && language?.server && projectLanguageEnabled ? nameCaptures(ws?.id, current?.relativePath) : undefined,
        definitionMethod: languageService && language?.server && projectLanguageEnabled && !current?.truncated ? "editor.definitions" : undefined,
        hoverMethod: languageService && language?.server && projectLanguageEnabled && !current?.truncated ? "editor.hover" : undefined,
        completionMethod: languageService && language?.server && projectLanguageEnabled && !current?.truncated ? "editor.completions" : undefined,
        completionTriggers: ["."], completionMenu: { width: 720, minWidth: 420, maxHeight: 420 },
        signatureMethod: languageService && language?.server && projectLanguageEnabled && !current?.truncated && canEdit ? "editor.signature" : undefined,
        completionResolveMethod: languageService && language?.server && projectLanguageEnabled && !current?.truncated && canEdit ? "editor.resolveCompletion" : undefined,
        lineMarkers: hunks.map((h, index) => ({ line: h.line, endLine: h.line + h.added, color: !h.added ? "danger" : h.removed.length ? "primary" : "success", value: index })),
        lineMarkerAction: "showHunk",
        definitionArgs: { workspaceId: ws?.id, path: current?.relativePath }, openLocationAction: "openDefinition",
        search: editorSearch,
        reveal: navigation && navigation.workspaceId === ws?.id && navigation?.path === current?.relativePath ? navigation : undefined });
    }
    const buf = !diff && current?.document ? buffers.get(current.document) : undefined;
    const status = saveStatus(buf);
    kids.push(
      { type: "row", key: "status-bar", gap: 6, padding: 3, align: "center", children: [
        { type: "label", key: "path", text: title, size: "xs", color: "muted", tooltip: title, grow: true },
        ...(diff ? [
          { type: "button", key: "diff-mode", text: diffMode === "split" ? "Unified" : "Side by side", action: "toggleDiffMode", small: true, variant: "ghost", tooltip: "Switch diff layout" } as UiNode,
          ...(current.kind !== "deleted" ? [{ type: "button", key: "open-file", text: "Open file", action: "openFile", small: true, variant: "ghost", tooltip: `Open ${current.relativePath}` } as UiNode] : []),
        ] : []),
        ...(status.text ? [{ type: "label", key: "save-state", text: status.text, size: "xs", color: status.color, tooltip: status.tooltip } as UiNode] : []),
        ...(buf && (buf.state === "error" || (buf.state === "dirty" && !autosave)) ? [{ type: "button", key: "save", text: buf.state === "error" ? "Retry" : "Save", action: "save", small: true, variant: "ghost", tooltip: `Save ${current.relativePath}` } as UiNode] : []),
        ...(buf?.state === "conflict" ? [
          { type: "button", key: "overwrite", text: "Overwrite", action: "overwrite", small: true, variant: "ghost", tooltip: "Replace the file on disk with your edits" } as UiNode,
          { type: "button", key: "reload", text: "Reload", action: "reload", small: true, variant: "ghost", tooltip: "Discard your edits and load the file from disk" } as UiNode,
        ] : []),
        ...(markdown ? [{ type: "button", key: "markdown-mode", text: renderMarkdown ? "Source" : "Preview", action: "toggleMarkdown", small: true, variant: "ghost", tooltip: renderMarkdown ? "Show Markdown source" : "Render Markdown preview" } as UiNode] : []),
        { type: "label", key: "lang", text: diff ? (current.truncated ? "diff (truncated)" : "") : current && showMetadata ? `${current.language} · ${current.size} B${current.truncated ? " (truncated)" : ""}` : "", size: "xs", color: "muted" },
      ] }
    );
    if (hunkView) {
      const h = hunkView.hunk;
      const kind = !h.added ? "Deleted" : h.removed.length ? "Changed" : "Added";
      const lines = h.added ? `${h.line + 1}${h.added > 1 ? `–${h.line + h.added}` : ""}` : `${h.line}–${h.line + 1}`;
      let fence = "```"; const body = [...h.removed.map(l => "-" + l), ...h.current.map(l => "+" + l)].join("\n");
      for (const run of body.matchAll(/`+/g)) if (run[0].length >= fence.length) fence = "`".repeat(run[0].length + 1);
      kids.push({ type: "modal", key: "hunk", title: `${kind} lines ${lines}`, closeAction: "closeHunk", width: 640, children: [
        { type: "markdown", key: "diff", text: `${fence}diff\n${body}\n${fence}`, inline: true },
        { type: "row", key: "buttons", gap: 6, children: [
          { type: "label", key: "hint", text: h.removed.length ? `${h.removed.length} line${h.removed.length === 1 ? "" : "s"} in HEAD` : "Not in HEAD", size: "xs", color: "muted", grow: true },
          { type: "button", key: "prev", text: "Previous", action: "stepHunk", value: -1, small: true, variant: "ghost", disabled: hunkView.index === 0 },
          { type: "button", key: "next", text: "Next", action: "stepHunk", value: 1, small: true, variant: "ghost", disabled: hunkView.index >= hunks.length - 1 },
          { type: "button", key: "rollback", text: "Roll back", action: "rollbackHunk", small: true, variant: "danger", disabled: !editable, tooltip: "Restore these lines from HEAD" },
          { type: "button", key: "close", text: "Close", action: "closeHunk", small: true },
        ] },
      ] });
    }
    // Compact fallback for a host that has not yet loaded the native context-menu capability.
    if (tabMenu && tabs.includes(tabMenu)) kids.push({ type: "popover", key: "tab-menu", width: 236, top: 34, left: 4, maxHeight: 124,
      style: { background: "panel", padding: 6, radius: 6, borderWidth: 1, borderColor: "border" }, closeAction: "dismissTabMenu", children: [
        { type: "button", key: "others", text: "Close others", action: "closeOthers", value: tabMenu, variant: "ghost" },
        { type: "button", key: "right", text: "Close all to the right", action: "closeRight", value: tabMenu, variant: "ghost" },
        { type: "button", key: "all", text: "Close all", action: "closeAll", value: tabMenu, variant: "ghost" },
      ] });
    return { type: "column", key: "viewer-root", style: { position: "relative" }, gap: 3, padding: 4, grow: true, children: kids };
  },
  async onEvent(ctx, ev) {
    if (!ws) return;
    try {
      if (ev.action === "openDefinition") {
        const value: any = ev.value || {};
        if (value.document !== current?.document) return;
        const path = workspacePath(ws.rootAbsolutePath, String(value.uri));
        if (!path) throw new Error("This definition is outside the workspace or uses a virtual document URI; opening it is not supported yet.");
        const position = value.selection?.start;
        if (!validPosition(position)) return;
        navigation = { workspaceId: ws.id, path, key: crypto.randomUUID(), line: position.line, character: position.character };
        languageError = null;
        await ctx.modules.call("workspace", "view.patch", { workspaceId: ws.id, patch: { previewPath: path } });
      } else if (ev.action === "edit") {
        const v: any = ev.value || {};
        const b = typeof v.document === "string" ? buffers.get(v.document) : undefined;
        if (!b || typeof v.text !== "string") return;
        b.text = v.text;
        if (b.state === "clean" || b.state === "error") b.state = "dirty";
        if (autosave && b.state === "dirty") scheduleSaves(ctx);
        if (current?.document === v.document) updateHunks();
        if (languageTimer) clearTimeout(languageTimer);
        languageTimer = setTimeout(() => { languageTimer = null; void synchronizeLanguage(ctx); }, 500);
      } else if (ev.action === "runShellBlock" && current && !current.diff) {
        const text = bufferFor(current.relativePath)?.text ?? current.text;
        const blocks = typeof text === "string" ? shellBlocks(text) : [];
        const index = blocks.findIndex(block => block.start === ev.value);
        const block = blocks[index];
        if (!block || !block.code.trim()) return;
        await runShellBlock(ctx, { workspaceId: ws.id, path: current.relativePath, block: index, code: block.code, language: block.language });
      } else if (ev.action === "showHunk") {
        const index = Number((ev.value as any)?.marker);
        if (hunks[index]) hunkView = { index, hunk: hunks[index] };
      } else if (ev.action === "closeHunk") { hunkView = null;
      } else if (ev.action === "stepHunk" && hunkView) {
        const index = hunkView.index + Number(ev.value);
        if (hunks[index]) { hunkView = { index, hunk: hunks[index] }; navigation = { workspaceId: ws.id, path: current.relativePath, key: crypto.randomUUID(), line: hunks[index].line, character: 0 }; }
      } else if (ev.action === "rollbackHunk" && hunkView && current?.document) {
        const b = buffers.get(current.document);
        const text = b?.text ?? current.text;
        const h = hunks[hunkView.index];
        if (!b || typeof text !== "string" || !h || JSON.stringify(h) !== JSON.stringify(hunkView.hunk)) { hunkView = null; return; }
        const lines = text.split("\n");
        lines.splice(h.line, h.added, ...h.removed);
        // The native buffer has no external edit API: save the restored text, then reopen.
        b.text = lines.join("\n"); b.state = "dirty"; hunkView = null;
        await save(ctx, b);
        const state = b.state as Buffer["state"];
        if (state === "error" || state === "conflict") throw new Error(b.error || "Could not save the rolled back file");
        navigation = { workspaceId: ws.id, path: current.relativePath, key: crypto.randomUUID(), line: h.line, character: 0 };
        if (state === "clean") await load(ctx, true);
      } else if (ev.action === "save") {
        const b = current?.document ? buffers.get(current.document) : undefined;
        if (b && b.text !== null) { b.state = "dirty"; await save(ctx, b); }
      } else if (ev.action === "overwrite") {
        const b = current?.document ? buffers.get(current.document) : undefined;
        if (b) await save(ctx, b, true);
      } else if (ev.action === "reload") {
        if (current?.document) buffers.delete(current.document);
        await load(ctx, true);
      } else if (ev.action === "toggleDiffMode") {
        const next = diffMode === "split" ? "unified" : "split";
        await ctx.modules.call("persistence", "settings.set", { key: "viewer.diffMode", value: next });
        diffMode = next; publishSettings();
      } else if (ev.action === "openFile" && current?.diff) {
        await ctx.modules.call("workspace", "view.patch", { workspaceId: ws.id, patch: { previewPath: current.relativePath } });
      } else if (ev.action === "toggleMarkdown") {
        const next = !renderMarkdown;
        await ctx.modules.call("persistence", "settings.set", { key: "viewer.renderMarkdown", value: next });
        renderMarkdown = next; publishSettings();
      } else if (ev.action === "openLink") {
        const base = current?.relativePath ? current.relativePath.split("/").slice(0, -1).join("/") : "";
        const path = resolveWorkspaceLink(String(ev.value || ""), ws.rootAbsolutePath, base);
        if (!path) throw new Error(`Cannot open link outside the workspace: ${ev.value}`);
        await ctx.modules.call("workspace", "view.patch", { workspaceId: ws.id, patch: { previewPath: path } });
      } else if (ev.action === "dismissTabMenu") { tabMenu = null;
      } else if (ev.action.startsWith("tabMenu:")) { tabMenu = ev.action.slice(8);
      } else if (ev.action === "closeRight" || ev.action === "closeAll" || ev.action === "closeOthers") {
        const keep = typeof ev.value === "string" ? ev.value : tabMenu || "";
        const index = tabs.indexOf(keep);
        if (index < 0) return;
        // "Close others" keeps the chosen tab and makes it the visible one.
        if (ev.action === "closeOthers" && ws.view?.previewPath !== keep) await ctx.modules.call("workspace", "view.patch", { workspaceId: ws.id, patch: { previewPath: keep } });
        const closing = ev.action === "closeAll" ? [...tabs] : ev.action === "closeOthers" ? tabs.filter(t => t !== keep) : tabs.slice(index + 1);
        tabMenu = null;
        for (const path of closing) await mod.onEvent!(ctx, { action: `close:${path}`, key: "menu", inputs: {} });
      } else if (ev.action.startsWith("select:")) {
        const path = ev.action.slice(7);
        if (tabs.includes(path)) await ctx.modules.call("workspace", "view.patch", { workspaceId: ws.id, patch: { previewPath: path } });
      } else if (ev.action.startsWith("close:")) {
        const path = ev.action.slice(6), workspaceId = ws.id;
        let index = tabs.indexOf(path);
        if (index < 0) return;
        tabMenu = null;
        // Closing a tab commits its edits even when autosave is off.
        const pending = bufferFor(path);
        if (pending?.state === "dirty") await save(ctx, pending);
        if (ws?.id !== workspaceId) return;
        index = tabs.indexOf(path);
        if (index < 0) return;
        if (unsaved(pending)) throw new Error(`Cannot close ${path}: save or resolve its unsaved changes first.`);
        tabs.splice(index, 1);
        // Move selection before persisting tabs so the watcher cannot reopen the closed file.
        const previewPath = ws.view?.previewPath === path ? tabs[Math.min(index, tabs.length - 1)] || null : ws.view?.previewPath;
        await ctx.modules.call("workspace", "view.patch", { workspaceId: ws.id, patch: { previewPath, ui: { viewerTabs: [...tabs] } } });
      }
    } catch (e) { error = errMsg(e); }
    ctx.ui.invalidate();
  },
};
export default mod;
