// viewer: a native syntax-highlighted source editor bound to a kernel document handle, with
// autosave through the files service. Highlighting, editing and selection are native; the module
// owns save policy (debounce, conflicts, retries). Tabs prefixed by DIFF_TAB_PREFIX show a native
// Git diff of that file instead (opened by git-panel).
import type { AppModule, ModuleContext, UiNode } from "@hato/sdk/types";
import { fileIcons } from "@hato/sdk/file-icons";
import { fileTabStyle, tabButtonStyle } from "@hato/sdk/tab-style";
import { exportSettings } from "@hato/sdk/settings";
import { errMsg } from "@hato/sdk/runtime";
import { resolveWorkspaceLink } from "@hato/sdk/links";
import { diffTabPath } from "@hato/sdk/git";
import { uiIcons } from "@hato/sdk/ui-icons";

import { languageDefinitions, languageForPath, workspacePath, validPosition, type LanguageDefinition } from "@hato/sdk/languages";

import { LanguagePanel } from "./language-panel";
import { shellBlocks } from "./markdown";

let showMetadata = true;
let renderMarkdown = true;
let diffMode: "split" | "unified" = "split";
let publishSettings: () => void = () => {};
let ws: any = null;
let current: any = null;
let error: string | null = null;
let loadingPath: string | null = null;

let editable = true;
let autosave = true;
let autosaveDelay = 800;
const AUTOSAVE_DELAYS = [300, 800, 2000, 5000];

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
const languagePanel = new LanguagePanel();
let languageTimer: ReturnType<typeof setTimeout> | null = null;
function languageRequest() {
  const buffer = current?.document ? buffers.get(current.document) : undefined;
  return { workspaceId: ws?.id, path: current?.relativePath, text: buffer?.text ?? current?.text,
    documents: [...buffers.values()].filter(b => b.workspaceId === ws?.id && b.text !== null).map(b => ({ path: b.path, text: b.text })) };
}
async function synchronizeLanguage(ctx: ModuleContext) {
  const request = languageRequest();
  const language = languageForPath(languages, request.path || "");
  if (!languageService || !language?.server || current?.binary || current?.truncated || current?.diff || typeof request.text !== "string") { languagePanel.reset(); ctx.ui.invalidate(); return; }
  await languagePanel.attach(ctx, request.workspaceId, language.server.id, request.path);
  if (request.workspaceId !== ws?.id || request.path !== current?.relativePath || languagePanel.project?.config.enabled === false) return;
  try {
    await ctx.modules.call("language-service", "synchronize", request, { timeoutMs: 175000 });
    if (request.workspaceId === ws?.id && request.path === current?.relativePath) { languagePanel.error = null; ctx.ui.invalidate(); }
  }
  catch (e) { if (request.workspaceId === ws?.id && request.path === current?.relativePath) { languagePanel.error = errMsg(e); ctx.ui.invalidate(); } }
}
async function editorRequest(ctx: ModuleContext, a: any, method: string) {
  const buffer = buffers.get(a.document);
  if (!languageService || !buffer || buffer.workspaceId !== a.workspaceId || buffer.path !== a.path || typeof a.text !== "string") return method === "hover" ? null : [];
  try {
    const result = await ctx.modules.call("language-service", method, { ...a,
      documents: [...buffers.values()].filter(b => b.workspaceId === buffer.workspaceId && b.text !== null).map(b => ({ path: b.path, text: b.text })),
    }, { timeoutMs: 175000 });
    languageError = null; ctx.ui.invalidate(); return result;
  } catch (e) { languageError = errMsg(e); ctx.ui.invalidate(); return method === "hover" ? null : []; }
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
  if (!workspaceId || !path) { generation++; loadingPath = null; current = null; languagePanel.reset(); error = null; ctx.ui.invalidate(); return; }
  if (!tabs.includes(path)) { tabs.push(path); await saveTabs(ctx); }
  if (ws?.id !== workspaceId || ws?.view?.previewPath !== path) return;
  if (!force && current?.workspaceId === workspaceId && current.tab === path || loadingPath === path) return;
  const mine = ++generation;
  // A forced reload (diff refresh) keeps the current view until the new one arrives.
  if (!force) { current = null; languageError = null; }
  error = null; loadingPath = path; ctx.ui.invalidate();
  try {
    const diffPath = diffTabPath(path);
    const r = diffPath
      ? { ...(await ctx.modules.call("git", "diff", { workspaceId, path: diffPath }, { timeoutMs: 45000 })), diff: true, relativePath: diffPath }
      : await ctx.modules.call("files", "open", { workspaceId, relativePath: path, includeText: true });
    if (mine === generation) {
      current = { ...r, workspaceId, tab: path }; error = null;
      if (!r.diff && r.document && !buffers.has(r.document)) {
        // A fresh handle replaces any older clean buffer for the same file.
        for (const [doc, b] of buffers) if (b.workspaceId === workspaceId && b.path === r.relativePath && b.state === "clean") buffers.delete(doc);
        buffers.set(r.document, { workspaceId, path: r.relativePath, mtime: r.mtime ?? null, text: null, state: "clean" });
      }
    }
  } catch (e) { if (mine === generation) { error = errMsg(e); current = null; } }
  finally { if (mine === generation) { loadingPath = null; void synchronizeLanguage(ctx); } ctx.ui.invalidate(); }
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
    const savedEditable = await ctx.modules.call("persistence", "settings.get", { key: "viewer.editable" });
    editable = typeof savedEditable === "boolean" ? savedEditable : true;
    const savedAutosave = await ctx.modules.call("persistence", "settings.get", { key: "viewer.autosave" });
    autosave = typeof savedAutosave === "boolean" ? savedAutosave : true;
    const savedDelay = await ctx.modules.call("persistence", "settings.get", { key: "viewer.autosaveDelay" });
    autosaveDelay = AUTOSAVE_DELAYS.includes(Number(savedDelay)) ? Number(savedDelay) : 800;
    for (const [doc, b] of Object.entries(prev?.buffers || {}) as [string, Buffer][]) buffers.set(doc, { ...b, inflight: false, again: false });
    publishSettings = exportSettings(ctx, () => [{ key: "viewer", title: "Source editor", fields: [
      { key: "editable", label: "Edit files", type: "toggle", value: editable,
        description: "Allow editing in the source panel. The first save in a workspace asks for write access." },
      { key: "autosave", label: "Autosave", type: "toggle", value: autosave,
        description: "Save edits automatically after you stop typing. When off, use Save in the status bar." },
      { key: "autosaveDelay", label: "Autosave delay", type: "select", value: String(autosaveDelay),
        options: AUTOSAVE_DELAYS.map(ms => ({ value: String(ms), label: ms < 1000 ? `${ms} ms` : `${ms / 1000} s` })),
        description: "Quiet time after the last keystroke before saving." },
      { key: "showMetadata", label: "Show file metadata", type: "toggle", value: showMetadata,
        description: "Display the language and file size in the bottom status bar." },
      { key: "renderMarkdown", label: "Preview Markdown files", type: "toggle", value: renderMarkdown,
        description: "Render Markdown documents. Switch between Preview and Source in the viewer status bar." },
      { key: "diffMode", label: "Diff layout", type: "select", value: diffMode,
        options: [{ value: "split", label: "Side by side" }, { value: "unified", label: "Unified" }],
        description: "How Git diffs are compared. Switch in the viewer status bar." },
    ] }], async (_section, key, value) => {
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
      if (!["showMetadata", "renderMarkdown", "editable", "autosave"].includes(key) || typeof value !== "boolean") throw new Error("Invalid viewer setting");
      await ctx.modules.call("persistence", "settings.set", { key: `viewer.${key}`, value });
      if (key === "showMetadata") showMetadata = value;
      else if (key === "renderMarkdown") renderMarkdown = value;
      else if (key === "editable") editable = value;
      else { autosave = value; if (value) scheduleSaves(ctx); }
      ctx.ui.invalidate();
    });
    ws = ctx.state.get("workspace.selected") || null;
    restoreTabs();
    // Keep an open diff current as the working tree changes.
    ctx.events.on("git-panel.statusChanged", (e: any) => {
      if (current?.diff && e?.workspaceId === ws?.id && ws?.view?.previewPath === current.tab) void load(ctx, true);
    });
    ctx.events.on("language-service.changed", () => { void synchronizeLanguage(ctx); });
    ctx.events.on("language-service.status", (status: any) => languagePanel.update(ctx, status));
    ctx.events.on("files.changed", (e: any) => { if (e?.workspaceId === ws?.id) void refreshFromDisk(ctx); });
    ctx.state.watch("workspace.selected", (v: any) => {
      const changed = ws?.id !== v?.id; ws = v;
      if (changed) { languagePanel.reset(); languageError = null; navigation = null; generation++; current = null; loadingPath = null; restoreTabs(); }
      void load(ctx);
    });
    await load(ctx);
  },
  async deactivate(ctx) {
    if (languageTimer) clearTimeout(languageTimer);
    for (const pending of shellRequests.values()) { clearTimeout(pending.timer); pending.reject(new Error("Editor reloaded.")); }
    shellRequests.clear();
    // Flush pending edits before a hot swap; unsaved buffers also survive in the snapshot.
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (autosave) await Promise.all([...buffers.values()].filter(b => b.state === "dirty").map(b => save(ctx, b)));
  },
  snapshot: () => ({ current, buffers: Object.fromEntries([...buffers].filter(([, b]) => b.state !== "clean" || b.mtime != null).map(([d, b]) => [d, { ...b, inflight: false }])) }),
  methods: {
    async "editor.definitions"(ctx, a) { return editorRequest(ctx, a, "definitions"); },
    async "editor.hover"(ctx, a) { return editorRequest(ctx, a, "hover"); },
    async "editor.completions"(ctx, a) { return editorRequest(ctx, a, "completions"); },
  },
  render(): UiNode {
    const diff = !!current?.diff;
    const markdown = current && !diff && !current.binary && (current.language === "markdown" || /\.(md|markdown)$/i.test(current.relativePath));
    const title = current ? (diff ? `Changes in ${current.relativePath}` : current.relativePath) : ws?.view?.previewPath || "No file selected";
    const kids: UiNode[] = [
      { type: "row", key: "tabs", gap: 3, wrap: true, children: tabs.map((path): UiNode => ({ type: "row", key: path, gap: 0, style: fileTabStyle(ws?.view?.previewPath === path), children: [
        { type: "button", key: "select", iconSvg: fileIcons.file, text: tabLabel(path), tooltip: diffTabPath(path) ? `Changes in ${diffTabPath(path)}` : path, action: `select:${path}`, middleClickAction: `close:${path}`, contextAction: `tabMenu:${path}`, contextMenu: [
          { text: "Close", action: `close:${path}` },
          { text: "Close all to the right", action: "closeRight", value: path, disabled: tabs.indexOf(path) === tabs.length - 1 },
          { text: "Close all", action: "closeAll", value: path },
        ], small: true, variant: "ghost", style: tabButtonStyle(ws?.view?.previewPath === path) },
        { type: "button", key: "close", text: "", iconSvg: uiIcons["x"], tooltip: `Close ${path}`, action: `close:${path}`, small: true, variant: "ghost", style: tabButtonStyle(ws?.view?.previewPath === path) },
      ] })) },

    ];
    if (languageError) kids.push({ type: "status", key: "language-error", text: languageError, level: "warn" });
    if (error) kids.push({ type: "status", key: "err", text: error, level: "error" });
    if (loadingPath) kids.push({ type: "progress", key: "ld", indeterminate: true, label: `Opening ${loadingPath}…` });
    if (current && current.binary) kids.push({ type: "status", key: "bin", text: current.message, level: "info" });
    if (diff) kids.push({ type: "diff", key: "diff", document: current.document, mode: diffMode, softWrap: true, header: false, emptyText: "No changes against HEAD.", grow: true });
    else if (markdown && renderMarkdown) {
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
        language: language?.grammar, syntaxRules: language?.syntaxRules,
        definitionMethod: languageService && language?.server && languagePanel.project?.config.enabled !== false && !current?.truncated ? "editor.definitions" : undefined,
        hoverMethod: languageService && language?.server && languagePanel.project?.config.enabled !== false && !current?.truncated ? "editor.hover" : undefined,
        completionMethod: languageService && language?.server && languagePanel.project?.config.enabled !== false && !current?.truncated ? "editor.completions" : undefined,
        completionTriggers: languagePanel.status?.capabilities?.completionProvider?.triggerCharacters || ["."],
        definitionArgs: { workspaceId: ws?.id, path: current?.relativePath }, openLocationAction: "openDefinition",
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
        ...languagePanel.controls(),
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
    const languageOverlay = languagePanel.overlay();
    if (languageOverlay) kids.push(languageOverlay);
    // Compact fallback for a host that has not yet loaded the native context-menu capability.
    if (tabMenu && tabs.includes(tabMenu)) kids.push({ type: "popover", key: "tab-menu", width: 236, top: 34, left: 4, maxHeight: 92,
      style: { background: "panel", padding: 6, radius: 6, borderWidth: 1, borderColor: "border" }, closeAction: "dismissTabMenu", children: [
        { type: "button", key: "right", text: "Close all to the right", action: "closeRight", value: tabMenu, variant: "ghost" },
        { type: "button", key: "all", text: "Close all", action: "closeAll", value: tabMenu, variant: "ghost" },
      ] });
    return { type: "column", key: "viewer-root", style: { position: "relative" }, gap: 3, padding: 4, grow: true, children: kids };
  },
  async onEvent(ctx, ev) {
    if (!ws) return;
    try {
      if (await languagePanel.event(ctx, ev, languageRequest, symbol => {
        navigation = { workspaceId: ws.id, path: current.relativePath, key: crypto.randomUUID(), ...symbol.range.start };
      })) return;
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
        if (languageTimer) clearTimeout(languageTimer);
        languageTimer = setTimeout(() => { languageTimer = null; void synchronizeLanguage(ctx); }, 500);
      } else if (ev.action === "runShellBlock" && current && !current.diff) {
        const text = bufferFor(current.relativePath)?.text ?? current.text;
        const blocks = typeof text === "string" ? shellBlocks(text) : [];
        const index = blocks.findIndex(block => block.start === ev.value);
        const block = blocks[index];
        if (!block || !block.code.trim()) return;
        await runShellBlock(ctx, { workspaceId: ws.id, path: current.relativePath, block: index, code: block.code, language: block.language });
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
      } else if (ev.action === "closeRight" || ev.action === "closeAll") {
        const index = tabs.indexOf(typeof ev.value === "string" ? ev.value : tabMenu || "");
        if (index < 0) return;
        const closing = ev.action === "closeAll" ? [...tabs] : tabs.slice(index + 1);
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
