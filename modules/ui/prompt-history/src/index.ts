import { captureEnabled, capturedChanges, capturedEntries, CAPTURE_STATE } from "@hato/sdk/change-capture";
// Prompt history: every prompt sent in the selected project (chats and background agents), newest
// first. A row expands to the files that prompt's turn changed; a file or "Review all" opens the
// change in a read-only Viewer diff tab (virtual document, see @hato/sdk/virtual-documents).
// Data: ai-sessions.promptHistory and persistent-agents.promptHistory (optional plugin).
import type { AppModule, ModuleContext, UiNode } from "@hato/sdk/types";
import { mergePromptEntries, promptAge, promptPatch, relativePromptPath, type PromptEntry, type PromptFile } from "@hato/sdk/prompt-history";
import { virtualTab, parseVirtualTab } from "@hato/sdk/virtual-documents";
import { filterInput } from "@hato/sdk/filter-style";
import { debounce, errMsg } from "@hato/sdk/runtime";
import { uiIcons } from "@hato/sdk/ui-icons";

const PANEL = "prompt-history";
const PAGE = 400, MAX_PAGE = 3000;
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const icons = {
  chat: svg("<path d='M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z'/>"),
  agent: svg("<rect x='5' y='8' width='14' height='11' rx='3'/><path d='M12 4v4M9 13h.01M15 13h.01M9.5 16.5h5'/>"),
  chevron: svg("<path d='m9 6 6 6-6 6'/>"),
  diff: svg("<path d='M12 3v6m-3-3h6M9 17h6M5 3h14v18H5z'/>"),
  open: svg("<path d='M14 4h6v6M20 4l-9 9M18 14v6H4V6h6'/>"),
};

let ctxForCapture: ModuleContext | null = null;
let ws: any = null;
let visible = false;
let entries: PromptEntry[] = [];
let agentNote: string | null = null;
let error: string | null = null;
let loading = false, epoch = 0, stale = false;
let showLoading = false;
let messageLimit = PAGE;
let query = "", changesOnly = true;
const expanded = new Set<string>();
/** Open diff tabs → what they show, so the Viewer can restore them (viewer.virtualRequest). */
const tabs = new Map<string, { workspaceId: string; title: string; patch: string }>();

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(36); };
const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);
/** Children shifted right by `px` (UiStyle has no one-sided padding). */
const indented = (key: string, px: number, child: UiNode): UiNode => ({ type: "row", key, gap: 0, align: "stretch", children: [
  { type: "column", key: "indent", width: px, style: { noShrink: true }, children: [] } as UiNode, { ...child, grow: true } as UiNode] } as UiNode);
const firstLine = (s: string) => s.split("\n").find(l => l.trim())?.trim() || s.trim();

async function refresh(ctx: ModuleContext, background = false) {
  if (!captureEnabled(ctx) || !visible || !ws?.id) return;
  if (loading) { stale = true; return; }
  const mine = ++epoch, workspaceId = ws.id;
  const before = JSON.stringify([entries, agentNote, error]);
  loading = true; stale = false;
  showLoading = !background;
  if (showLoading) ctx.ui.invalidate();
  try {
    const [chats, agents] = await Promise.allSettled([
      ctx.modules.call("ai-sessions", "promptHistory", { workspaceId, messageLimit }, { timeoutMs: 60000 }),
      ctx.modules.call("persistent-agents", "promptHistory", { workspaceId, messageLimit: Math.min(messageLimit, 200) }, { timeoutMs: 60000 }),
    ]);
    if (mine !== epoch) return;
    if (chats.status === "rejected") throw chats.reason;
    entries = mergePromptEntries([capturedEntries(capturedChanges(ctx, workspaceId), [...(chats.value?.entries || []), ...(agents.status === "fulfilled" ? agents.value?.entries || [] : [])])]);
    // Background agents are a separate, optional plugin; say why they are missing instead of failing.
    agentNote = agents.status === "rejected" ? `Background agents unavailable: ${errMsg(agents.reason)}` : null;
    error = null;
  } catch (e) { if (mine === epoch) error = errMsg(e); }
  finally {
    if (mine === epoch) {
      const changed = before !== JSON.stringify([entries, agentNote, error]);
      const wasShowingLoading = showLoading;
      loading = false; showLoading = false;
      if (changed || wasShowingLoading) ctx.ui.invalidate();
      if (stale) void refresh(ctx, true);
    }
  }
}

/** Open (or refresh) a read-only diff tab for some of a prompt's files. */
async function showDiff(ctx: ModuleContext, entry: PromptEntry, files: PromptFile[], reveal = true) {
  if (!ws) return;
  const workspaceId = ws.id, root = ws.rootAbsolutePath;
  const patch = promptPatch(files, root);
  if (!patch) { ctx.host.ui.toast("info", "No line changes were recorded for this edit."); return; }
  const name = files.length === 1 ? base(files[0].path) : "changes";
  const tab = virtualTab(PANEL, `${hash(entry.id)}/${files.length === 1 ? hash(files[0].path) + "/" : ""}${name}.diff`);
  const title = `${files.length === 1 ? relativePromptPath(files[0].path, root) : `${files.length} files`} · “${firstLine(entry.prompt).slice(0, 60)}”`;
  tabs.set(tab, { workspaceId, title, patch });
  if (tabs.size > 100) tabs.delete(tabs.keys().next().value!);
  await present(ctx, tab, reveal);
}
async function present(ctx: ModuleContext, tab: string, reveal: boolean) {
  const t = tabs.get(tab);
  if (!t) return;
  const document = await ctx.host.ui.documentOpen(t.workspaceId, t.patch, "diff", { path: tab.slice(tab.lastIndexOf("/") + 1) });
  await ctx.modules.call("viewer", "virtual.show", { workspaceId: t.workspaceId, tab, title: t.title, document, diff: true, editable: false, reveal });
}

const matches = (e: PromptEntry, q: string) => !q || e.prompt.toLowerCase().includes(q) || e.sessionTitle.toLowerCase().includes(q)
  || e.agent.toLowerCase().includes(q) || e.files.some(f => f.path.toLowerCase().includes(q));

function counts(added: number, removed: number): UiNode[] {
  return [
    { type: "label", key: "add", text: `+${added}`, size: "xs", color: "success", mono: true },
    { type: "label", key: "del", text: `−${removed}`, size: "xs", color: "danger", mono: true },
  ];
}

function fileRow(entry: PromptEntry, f: PromptFile): UiNode {
  const rel = relativePromptPath(f.path, ws?.rootAbsolutePath), slash = rel.lastIndexOf("/");
  return { type: "row", key: `file:${f.path}`, gap: 6, align: "center", action: "openFile", value: `${entry.id}\n${f.path}`, hoverStyle: { background: "hover" },
    tooltip: `${rel}${f.edits.length > 1 ? ` · ${f.edits.length} edits` : ""}${f.truncated ? " · partly recorded" : ""}\nOpen the change`,
    style: { height: 24, radius: 6, paddingX: 6 }, children: [
      { type: "icon", key: "i", svg: icons.diff, size: 13, color: "faint" } as UiNode,
      { type: "label", key: "name", text: slash >= 0 ? rel.slice(slash + 1) : rel, size: "xs", color: "text", style: { noShrink: true } },
      { type: "label", key: "dir", text: slash > 0 ? rel.slice(0, slash) : "", size: "xs", color: "faint", grow: true },
      ...(f.newFile ? [{ type: "label", key: "new", text: "new", size: "xs", color: "faint" } as UiNode] : []),
      ...counts(f.added, f.removed),
    ] } as UiNode;
}

function entryNode(e: PromptEntry): UiNode {
  const open = expanded.has(e.id);
  const added = e.files.reduce((n, f) => n + f.added, 0), removed = e.files.reduce((n, f) => n + f.removed, 0);
  const age = promptAge(e.updatedAt ?? e.at) || "Time unavailable";
  const head: UiNode = { type: "row", key: "head", gap: 8, align: "center", action: "toggle", value: e.id, hoverStyle: { background: "hover" },
    tooltip: open ? "Collapse" : e.files.length ? "Show changed files" : "Show prompt", style: { radius: 7, paddingX: 6, paddingY: 5 }, children: [
      { type: "icon", key: "chev", svg: icons.chevron, size: 12, color: "faint", style: { rotate: open ? 90 : 0 } } as UiNode,
      { type: "column", key: "text", gap: 2, grow: true, minWidth: 0, children: [
        { type: "label", key: "prompt", text: firstLine(e.prompt), size: "sm", color: "text" },
        { type: "row", key: "meta", gap: 5, align: "center", children: [
          { type: "icon", key: "src", svg: e.source === "agent" ? icons.agent : icons.chat, size: 11, color: "faint" } as UiNode,
          { type: "label", key: "who", text: `${e.agent} · ${e.sessionTitle}`, size: "xs", color: "faint", grow: true },
          ...(age ? [{ type: "label", key: "age", text: age, size: "xs", color: "faint", mono: true } as UiNode] : []),
        ] },
      ] },
      ...(e.files.length ? [{ type: "column", key: "sum", gap: 1, align: "end", style: { noShrink: true }, children: [
        { type: "label", key: "n", text: `${e.files.length} file${e.files.length === 1 ? "" : "s"}`, size: "xs", color: "muted" },
        { type: "row", key: "c", gap: 4, children: counts(added, removed) },
      ] } as UiNode] : []),
    ] } as UiNode;
  const body: UiNode[] = open ? [
    ...(e.prompt.includes("\n") || e.prompt.length > 80 ? [{ type: "label", key: "full", text: e.prompt, size: "xs", color: "muted", wrap: true, selectable: true, style: { paddingX: 26, paddingY: 2 } } as UiNode] : []),
    ...(e.files.length
      ? [indented("files", 20, { type: "column", key: "list", gap: 0, children: e.files.map(f => fileRow(e, f)) } as UiNode)]
      : [{ type: "label", key: "none", text: "No file changes recorded for this prompt.", size: "xs", color: "faint", style: { paddingX: 26 } } as UiNode]),
    indented("actions", 22, { type: "row", key: "buttons", gap: 4, style: { paddingY: 2 }, children: [
      ...(e.files.length ? [{ type: "button", key: "all", text: "Review all", iconSvg: icons.diff, action: "reviewAll", value: e.id, small: true, variant: "ghost", tooltip: "Open every change from this prompt in one diff" } as UiNode] : []),
      ...(e.source === "workspace" ? [] : [{ type: "button", key: "chat", text: e.source === "agent" ? "Open agent" : "Open chat", iconSvg: icons.open, action: "openChat", value: e.id, small: true, variant: "ghost" } as UiNode]),
    ] } as UiNode),
  ] : [];
  return { type: "column", key: e.id, gap: 2, style: { radius: 8, ...(open ? { background: "surface", paddingY: 2 } : {}) }, children: [head, ...body] };
}

const mod: AppModule = {
  id: PANEL, moduleApiVersion: 1,
  async activate(ctx) {
    ctxForCapture = ctx;
    ws = ctx.state.get("workspace.selected") || null;
    visible = !!(ctx.state.get("workspace-layout.panels") as any)?.[PANEL];
    ctx.events.on("files.changeCaptured", () => { if (visible) void refresh(ctx, true); });
    ctx.state.watch("files.changesEnabled", () => { if (!captureEnabled(ctx)) { epoch++; loading = false; showLoading = false; entries = []; } else void refresh(ctx); ctx.ui.invalidate(); });
    const soon = debounce(() => { void refresh(ctx, true); }, 1500);
    ctx.state.watch("workspace-layout.panels", (v: any) => { const next = !!v?.[PANEL]; if (next === visible) return; visible = next; if (visible) void refresh(ctx); });
    ctx.state.watch("workspace.selected", (v: any) => {
      if (v?.id === ws?.id) { ws = v; return; }
      ws = v; epoch++; loading = false; showLoading = false; entries = []; expanded.clear(); error = null; agentNote = null; messageLimit = PAGE;
      ctx.ui.invalidate(); void refresh(ctx);
    });
    // New prompts and edits arrive with these; the debounce keeps streaming from re-reading history.
    ctx.events.on("ai-sessions.changed", () => { if (visible) soon(); });
    ctx.events.on("persistent-agents.changed", (e: any) => { if (visible && (!e?.workspaceId || e.workspaceId === ws?.id)) soon(); });
    ctx.events.on("viewer.virtualRequest", (e: any) => {
      if (parseVirtualTab(e?.tab)?.provider !== PANEL) return;
      if (tabs.has(e.tab)) { void present(ctx, e.tab, false).catch(err => ctx.log.warn(errMsg(err))); return; }
      void ctx.modules.call("viewer", "virtual.show", { workspaceId: e.workspaceId, tab: e.tab, title: "Prompt change", reveal: false, editable: false,
        error: "This change is no longer loaded. Open it again from Prompt history." }).catch(() => {});
    });
    ctx.events.on("viewer.virtualClosed", (e: any) => { if (parseVirtualTab(e?.tab)?.provider === PANEL) tabs.delete(e.tab); });
    await refresh(ctx);
  },
  deactivate() { epoch++; },
  render(): UiNode {
    if (!ws) return { type: "label", key: "none", text: "Select a project to see its prompts.", color: "muted", padding: 12, wrap: true };
    const q = query.trim().toLowerCase();
    const shown = entries.filter(e => (!changesOnly || e.files.length) && matches(e, q));
    const kids: UiNode[] = [
      { type: "row", key: "tools", gap: 4, align: "center", children: [
        { type: "textInput", key: "filter", ...filterInput, value: query, placeholder: "Search prompts or files", prefixSvg: uiIcons.search, changeAction: "filter", grow: true },
        { type: "button", key: "changes", text: "Changes only", small: true, variant: changesOnly ? "primary" : "ghost", action: "changesOnly", value: !changesOnly,
          tooltip: changesOnly ? "Showing prompts that changed files — click to show every prompt" : "Show only prompts that changed files" },
        { type: "button", key: "refresh", text: "", iconSvg: uiIcons.refresh, action: "refresh", small: true, variant: "ghost", disabled: showLoading, tooltip: "Refresh" },
      ] },
    ];
    const capture = ctxForCapture?.state.get(CAPTURE_STATE) as any;
    if (capture?.workspaceId === ws.id && capture.warning) kids.push({ type: "label", key: "capture-warning", text: capture.warning, size: "xs", color: "muted", wrap: true });
    if (error) kids.push({ type: "status", key: "error", text: error, level: "error" });
    if (agentNote) kids.push({ type: "label", key: "agents", text: agentNote, size: "xs", color: "faint", wrap: true });
    if (showLoading && !entries.length) kids.push({ type: "progress", key: "loading", indeterminate: true });
    if (!loading && !error && !shown.length) kids.push({ type: "label", key: "empty", wrap: true, size: "sm", color: "muted", style: { padding: 12 },
      text: q ? "No prompts match." : changesOnly && entries.length ? "No prompt in the loaded history changed files. File changes are recorded for edits made with inline diffs available." : "No prompts in this project yet." });
    kids.push({ type: "column", key: "list", gap: 2, grow: true, scroll: true, children: [
      ...shown.map(entryNode),
      ...(entries.length && messageLimit < MAX_PAGE ? [{ type: "button", key: "more", text: showLoading ? "Loading…" : "Load older prompts", action: "more", small: true, variant: "ghost", disabled: showLoading, style: { fullWidth: true } } as UiNode] : []),
    ] });
    return { type: "column", key: "prompt-history", gap: 6, padding: 8, grow: true, children: kids };
  },
  async onEvent(ctx, ev) {
    const find = (id: unknown) => entries.find(e => e.id === id);
    try {
      switch (ev.action) {
        case "filter": query = String(ev.value || ""); break;
        case "changesOnly": changesOnly = !!ev.value; break;
        case "refresh": void refresh(ctx); break;
        case "more": messageLimit = Math.min(MAX_PAGE, messageLimit * 2); void refresh(ctx); break;
        case "toggle": { const id = String(ev.value); if (expanded.has(id)) expanded.delete(id); else expanded.add(id); break; }
        case "openFile": {
          const [id, path] = String(ev.value || "").split("\n");
          const e = find(id), f = e?.files.find(x => x.path === path);
          if (e && f) await showDiff(ctx, e, [f]);
          break;
        }
        case "reviewAll": { const e = find(ev.value); if (e) await showDiff(ctx, e, e.files); break; }
        case "openChat": {
          const e = find(ev.value);
          if (e && ws) ctx.events.emit(`${PANEL}.openChat`, e.source === "agent" ? { workspaceId: ws.id, agentId: e.sessionId } : { workspaceId: ws.id, conversationId: e.sessionId });
          break;
        }
      }
    } catch (e) { ctx.host.ui.toast("error", errMsg(e)); }
    ctx.ui.invalidate();
  },
};
export default mod;
