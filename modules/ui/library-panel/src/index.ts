// Library panel: browse global and project skills/agents as a tree. Files open as editor tabs
// through the viewer's virtual-document protocol (@hato/sdk/virtual-documents); this module is
// the provider that reads, saves and refreshes them through the library service.
import type { AppModule, ModuleContext, UiNode, TreeRow } from "@hato/sdk/types";
import { uiIcons } from "@hato/sdk/ui-icons";
import { errMsg, langFromPath } from "@hato/sdk/runtime";
import { filterInput } from "@hato/sdk/filter-style";
import { parseVirtualTab, virtualTab, type VirtualShow } from "@hato/sdk/virtual-documents";

const PROVIDER = "library-panel";
const BOOK = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 5v16M3 3h5a4 4 0 0 1 4 2 4 4 0 0 1 4-2h5v16h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3Z\"/></svg>";
const AGENT = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"4\" y=\"8\" width=\"16\" height=\"12\" rx=\"3\"/><path d=\"M12 4v4M9 13h.01M15 13h.01M9 17h6\"/></svg>";
const rootOf = (kind: string) => kind === "agent" ? "AGENT.md" : "SKILL.md";

type Scope = "global" | "project";
interface Target { workspaceId: string; scope: Scope; id: string; path: string }
/** Open editor tabs: the stored text each was based on (for conflict checks) and its document. */
interface Opened { base: string; document: string | null }

let scope: Scope = "global", workspaceId: string | null = null, entries: any[] = [];
let selectedId: string | null = null, selectedFile: string | null = null;
let query = "", error = "", busy = false, generation = 0;
let form: null | "new" | "details" = null, name = "", description = "", kind = "skill";
let adding = false, newPath = "", confirmRemove = false, confirmDeleteFile: string | null = null;
let expanded = new Set<string>(), collapsedDirs = new Set<string>();
const opened = new Map<string, Opened>();
let saving = 0;

const selected = () => entries.find(e => e.id === selectedId) || null;
const args = () => ({ scope, workspaceId });
const btn = (key: string, text: string, action: string, opts: { disabled?: boolean; icon?: string; tooltip?: string; variant?: "ghost" | "danger" } = {}): UiNode =>
  ({ type: "button", key, text, action, small: true, disabled: busy || !!opts.disabled, variant: opts.variant || "ghost", ...(opts.icon ? { iconSvg: opts.icon } : {}), ...(opts.tooltip ? { tooltip: opts.tooltip } : {}) });
const label = (key: string, text: string, muted = false): UiNode => ({ type: "label", key, text, size: "sm", color: muted ? "muted" : undefined, wrap: true });

// ---- Tabs ----------------------------------------------------------------------------------
const tabFor = (t: Target) => virtualTab(PROVIDER, `${t.scope}/${t.id}/${t.path}`);
const openedKey = (wsId: string, tab: string) => `${wsId}|${tab}`;
function targetOf(wsId: unknown, tab: unknown): Target | null {
  const parsed = parseVirtualTab(typeof tab === "string" ? tab : null);
  if (!parsed || parsed.provider !== PROVIDER || typeof wsId !== "string" || !wsId) return null;
  const [s, id, ...rest] = parsed.key.split("/");
  if ((s !== "global" && s !== "project") || !id || !rest.length) return null;
  return { workspaceId: wsId, scope: s, id, path: rest.join("/") };
}
const libraryArgs = (t: Target) => ({ scope: t.scope, workspaceId: t.workspaceId, id: t.id });

async function show(ctx: ModuleContext, t: Target, reveal: boolean) {
  const tab = tabFor(t), key = openedKey(t.workspaceId, tab);
  let request: VirtualShow;
  let next: Opened | null = null;
  try {
    const file = await ctx.modules.call("library", "read", { ...libraryArgs(t), path: t.path });
    const document = await ctx.host.ui.documentOpen(t.workspaceId, file.content, langFromPath(t.path), { path: t.path });
    next = { base: file.content, document };
    request = { workspaceId: t.workspaceId, tab, title: `Library · ${file.name} / ${t.path}`, document, text: file.content, reveal };
  } catch (e) {
    request = { workspaceId: t.workspaceId, tab, title: `Library / ${t.path}`, document: null, text: "", reveal, error: `Library: ${errMsg(e)}` };
  }
  const result = await ctx.modules.call("viewer", "virtual.show", request);
  // The viewer keeps unsaved edits over a refreshed copy; keep comparing against what they were based on.
  if (result?.replaced === false) { if (next?.document) void ctx.host.resources.release(next.document).catch(() => {}); return; }
  const previous = opened.get(key);
  if (previous?.document && previous.document !== next?.document) void ctx.host.resources.release(previous.document).catch(() => {});
  if (next) opened.set(key, next); else opened.delete(key);
}

async function openFile(ctx: ModuleContext, id: string, path: string) {
  if (!workspaceId) throw new Error("Select a project or task to open Library files in the editor.");
  selectedId = id; selectedFile = path;
  await show(ctx, { workspaceId, scope, id, path }, true);
}

/** Viewer → provider: persist a buffer, refusing to overwrite a copy changed elsewhere. */
async function saveTab(ctx: ModuleContext, ev: any) {
  const t = targetOf(ev?.workspaceId, ev?.tab);
  if (!t || typeof ev?.requestId !== "string") return;
  saving++;
  try {
    const { text, force } = await ctx.modules.call("viewer", "virtual.take", { requestId: ev.requestId });
    const key = openedKey(t.workspaceId, ev.tab), base = opened.get(key)?.base;
    try {
      const entry = await ctx.modules.call("library", "read", libraryArgs(t));
      if (!force) {
        if (!entry.paths.includes(t.path)) throw Object.assign(new Error(`${t.path} was deleted from the Library.`), { conflict: true });
        const stored = (await ctx.modules.call("library", "read", { ...libraryArgs(t), path: t.path })).content;
        if (base !== undefined && stored !== base) throw Object.assign(new Error(`${t.path} changed in the Library since it was opened.`), { conflict: true });
      }
      // Record the new base first: the save's library.changed must not look like an outside edit.
      const before = opened.get(key);
      opened.set(key, { base: text, document: before?.document ?? null });
      await ctx.modules.call("library", "save", { ...libraryArgs(t), path: t.path, content: text, expectedRevision: entry.revision })
        .catch(e => { if (before) opened.set(key, before); else opened.delete(key); throw Object.assign(new Error(errMsg(e)), { conflict: /changed/.test(errMsg(e)) }); });
      await ctx.modules.call("viewer", "virtual.saved", { requestId: ev.requestId });
    } catch (e: any) {
      await ctx.modules.call("viewer", "virtual.saved", { requestId: ev.requestId, error: errMsg(e), conflict: !!e?.conflict });
    }
  } catch (e) { ctx.log.warn(`library save: ${errMsg(e)}`); }
  finally { saving--; }
}

/** Refresh open tabs whose stored copy changed (e.g. an agent wrote through Library MCP). */
async function refreshOpened(ctx: ModuleContext) {
  for (const [key, item] of [...opened]) {
    const split = key.indexOf("|"), t = targetOf(key.slice(0, split), key.slice(split + 1));
    if (!t) continue;
    const stored = await ctx.modules.call("library", "read", { ...libraryArgs(t), path: t.path }).then((f: any) => f.content, () => null);
    if (stored !== item.base) await show(ctx, t, false).catch(e => ctx.log.warn(errMsg(e)));
  }
}

function resolveLink(from: string, href: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("/")) return null;
  const resolved: string[] = [];
  for (const part of [...from.split("/").slice(0, -1), ...decodeURI(href.split("#")[0]).split("/")]) {
    if (part === "..") { if (!resolved.length) return null; resolved.pop(); }
    else if (part && part !== ".") resolved.push(part);
  }
  return resolved.length ? resolved.join("/") : null;
}

// ---- Panel -----------------------------------------------------------------------------------
async function refresh(ctx: ModuleContext) {
  const version = ++generation;
  if (scope === "project" && !workspaceId) { entries = []; ctx.ui.invalidate(); return; }
  try { const next = await ctx.modules.call("library", "list", args()); if (version !== generation) return; entries = next; error = ""; }
  catch (e) { if (version === generation) error = errMsg(e); }
  if (selectedId && !selected()) { selectedId = selectedFile = null; confirmRemove = false; adding = false; }
  ctx.ui.invalidate();
}

function entryMenu(entry: any): TreeRow["contextMenu"] {
  return [
    { text: `Open ${rootOf(entry.kind)}`, action: "openRoot", value: entry.id },
    { text: "Add file…", action: "startAdd", value: entry.id },
    { text: "Edit details…", action: "details", value: entry.id },
    { separator: true },
    { text: "Remove…", action: "askRemove", value: entry.id },
  ];
}
function rows(): TreeRow[] {
  const result: TreeRow[] = [];
  const q = query.trim().toLowerCase();
  for (const entry of entries.filter(e => `${e.name} ${e.description} ${e.paths.join(" ")}`.toLowerCase().includes(q))) {
    const open = expanded.has(entry.id) || !!q;
    result.push({ key: entry.id, label: entry.name, tooltip: entry.description || undefined, badge: entry.kind === "agent" ? "agent" : "skill",
      depth: 0, expandable: true, expanded: open, selected: selectedId === entry.id && !selectedFile, weight: "medium",
      iconSvg: entry.kind === "agent" ? AGENT : BOOK, contextMenu: entryMenu(entry) });
    if (!open) continue;
    const dirs = new Set<string>();
    for (const p of entry.paths as string[]) {
      const segments = p.split("/");
      let hidden = false;
      for (let i = 1; i < segments.length; i++) {
        const dir = segments.slice(0, i).join("/"), key = `dir:${entry.id}:${dir}`;
        if (!dirs.has(dir)) { dirs.add(dir); result.push({ key, label: segments[i - 1], depth: i, expandable: true, expanded: !collapsedDirs.has(key), selected: false, iconSvg: uiIcons.folder }); }
        if (collapsedDirs.has(key)) { hidden = true; break; }
      }
      if (hidden) continue;
      const root = p === rootOf(entry.kind);
      result.push({ key: `file:${entry.id}:${p}`, label: segments[segments.length - 1], depth: segments.length, expandable: false, expanded: false,
        selected: selectedId === entry.id && selectedFile === p, iconSvg: uiIcons[p.endsWith(".sh") ? "terminal" : "files"], weight: root ? "medium" : undefined,
        contextMenu: [{ text: "Open in editor", action: "openFile", value: p }, { separator: true }, { text: "Delete file…", action: "askDeleteFile", value: p, disabled: root }] });
    }
  }
  return result;
}

function entryActions(entry: any): UiNode[] {
  const out: UiNode[] = [{ type: "row", key: "entry", gap: 4, align: "center", children: [
    { type: "label", key: "name", text: entry.name, grow: true, weight: "semibold", size: "sm" },
    btn("add-file", "Add file", "startAdd", { icon: uiIcons.plus, tooltip: "Add a Markdown page or shell script" }),
    btn("details", "Details", "details", { icon: uiIcons.pencil, tooltip: "Rename or describe this entry" }),
    btn("remove", "", "askRemove", { icon: uiIcons.trash, tooltip: "Remove this entry" }),
  ] }];
  if (entry.description) out.push(label("entry-description", entry.description, true));
  if (adding) out.push({ type: "row", key: "add-row", gap: 6, align: "center", children: [
    { type: "textInput", key: "newPath", value: newPath, changeAction: "newPath", submitAction: "addFile", placeholder: "references/guide.md or scripts/check.sh", grow: true },
    btn("add-confirm", "Add", "addFile", { disabled: !newPath.trim() }),
    btn("add-cancel", "Cancel", "cancelAdd"),
  ] } as UiNode);
  if (confirmRemove) out.push({ type: "row", key: "remove-confirm", gap: 6, align: "center", children: [
    { type: "label", key: "warn", text: `Delete “${entry.name}” and all its files?`, size: "sm", color: "danger", grow: true, wrap: true },
    btn("yes", "Delete", "remove", { variant: "danger" }), btn("no", "Cancel", "cancelRemove"),
  ] });
  if (confirmDeleteFile) out.push({ type: "row", key: "file-confirm", gap: 6, align: "center", children: [
    { type: "label", key: "warn", text: `Delete ${confirmDeleteFile}?`, size: "sm", color: "danger", grow: true, wrap: true },
    btn("yes", "Delete", "deleteFile", { variant: "danger" }), btn("no", "Cancel", "cancelDeleteFile"),
  ] });
  return [{ type: "column", key: "selection", gap: 6, padding: 8, border: true, children: out }];
}

const mod: AppModule = {
  id: PROVIDER, moduleApiVersion: 1,
  async activate(ctx, prev) {
    scope = prev?.scope === "project" ? "project" : "global";
    expanded = new Set(prev?.expanded || []); collapsedDirs = new Set(prev?.collapsedDirs || []);
    selectedId = prev?.selectedId || null; selectedFile = prev?.selectedFile || null;
    for (const [key, item] of Object.entries(prev?.opened || {}) as [string, Opened][]) if (typeof item?.base === "string") opened.set(key, item);
    workspaceId = (ctx.state.get("workspace.selected") as any)?.id || null;
    ctx.state.watch("workspace.selected", () => {
      const next = (ctx.state.get("workspace.selected") as any)?.id || null;
      if (next === workspaceId) return;
      workspaceId = next;
      if (scope === "project") { selectedId = selectedFile = null; confirmRemove = adding = false; void refresh(ctx); }
      else ctx.ui.invalidate();
    });
    ctx.events.on("library.changed", () => { void refresh(ctx); void refreshOpened(ctx); });
    ctx.events.on("viewer.virtualRequest", (ev: any) => { const t = targetOf(ev?.workspaceId, ev?.tab); if (t) void show(ctx, t, false).catch(e => ctx.log.warn(errMsg(e))); });
    ctx.events.on("viewer.virtualSave", (ev: any) => { void saveTab(ctx, ev); });
    ctx.events.on("viewer.virtualLink", (ev: any) => {
      const t = targetOf(ev?.workspaceId, ev?.tab);
      if (!t) return;
      const path = resolveLink(t.path, String(ev.href || ""));
      if (!path) { ctx.host.ui.toast("warn", `Library links must point to files in the same entry: ${ev.href}`); return; }
      void show(ctx, { ...t, path }, true).catch(e => ctx.host.ui.toast("error", errMsg(e)));
    });
    ctx.events.on("viewer.virtualClosed", (ev: any) => {
      const key = openedKey(String(ev?.workspaceId), String(ev?.tab)), item = opened.get(key);
      if (!item) return;
      opened.delete(key);
      if (item.document) void ctx.host.resources.release(item.document).catch(() => {});
    });
    await refresh(ctx);
  },
  snapshot: () => ({ scope, selectedId, selectedFile, expanded: [...expanded], collapsedDirs: [...collapsedDirs], opened: Object.fromEntries(opened) }),
  canSwap: () => ({ ok: !busy && !saving, reason: "Library changes are being saved" }),
  render() {
    const entry = selected();
    const children: UiNode[] = [
      { type: "row", key: "heading", gap: 4, align: "center", children: [
        { type: "label", key: "title", text: "Library", size: "lg", weight: "semibold", grow: true },
        btn("refresh", "", "refresh", { icon: uiIcons.refresh, tooltip: "Reload the Library" }),
        btn("add", "New", "new", { icon: uiIcons.plus, tooltip: "Create a skill or agent" }),
      ] },
      { type: "select", key: "scope", value: scope, action: "scope", disabled: busy, options: [{ value: "global", label: "Global · all projects" }, { value: "project", label: "Project · shared with its tasks" }] },
      { type: "textInput", key: "filter", ...filterInput, value: query, placeholder: "Find skills, agents or files…", changeAction: "filter" },
    ];
    if (error) children.push({ type: "status", key: "error", text: error, level: "error" });
    if (form) children.push({ type: "column", key: "create", gap: 8, padding: 10, border: true, children: [
      label("ct", form === "details" ? "Edit details" : "New Library entry"),
      { type: "select", key: "kind", value: kind, action: "kind", disabled: form === "details", options: [{ value: "skill", label: "Skill · SKILL.md" }, { value: "agent", label: "Agent instructions · AGENT.md" }] },
      { type: "textInput", key: "name", value: name, placeholder: "Name", changeAction: "name", submitAction: "create" },
      { type: "textInput", key: "description", value: description, placeholder: "When should this be used?", changeAction: "description" },
      { type: "row", key: "create-actions", gap: 6, children: [
        { type: "button", key: "create", text: form === "details" ? "Save details" : "Create", action: "create", small: true, disabled: busy || !name.trim() },
        btn("cancel", "Cancel", "cancelCreate")] },
    ] });
    const tree = rows();
    if (tree.length) children.push({ type: "tree", key: "entries", rows: tree, selectAction: "select", expandAction: "expand", grow: true, rowHeight: 28 });
    else children.push({ type: "column", key: "empty", padding: 20, gap: 10, grow: true, children: [
      label("empty-title", scope === "project" && !workspaceId ? "Select a project to open its Library" : entries.length ? "Nothing matches your filter" : "Your Library is empty"),
      ...(entries.length ? [] : [label("empty-hint", "Create a skill (SKILL.md) or agent (AGENT.md), then add Markdown references and .sh scripts. Files open in the editor.", true)]),
    ] });
    if (entry) children.push(...entryActions(entry));
    if (!workspaceId) children.push(label("no-workspace", "Select a project or task to open Library files in the editor.", true));
    children.push(label("footer", "Agents read these files on demand through Library MCP tools. Scripts are stored as text and never run automatically.", true));
    return { type: "column", key: "library", grow: true, padding: 12, gap: 8, children };
  },
  async onEvent(ctx, ev) {
    if (busy) return;
    error = "";
    try {
      const action = ev.action, value = ev.value;
      const text = String(value ?? "");
      if (ev.inputs?.name !== undefined) name = ev.inputs.name;
      if (ev.inputs?.description !== undefined) description = ev.inputs.description;
      if (ev.inputs?.newPath !== undefined) newPath = ev.inputs.newPath;
      const entry = selected();
      // Context-menu actions name their entry; select it first.
      if (typeof value === "string" && ["openRoot", "startAdd", "details", "askRemove"].includes(action) && entries.some(e => e.id === value)) {
        if (selectedId !== value) { selectedId = value; selectedFile = null; confirmRemove = adding = false; confirmDeleteFile = null; }
      }
      if (["openFile", "askDeleteFile"].includes(action) && ev.rowKey?.startsWith("file:")) { const [, id] = ev.rowKey.split(":"); selectedId = id; }
      const current = selected();
      if (action === "filter") query = text;
      else if (action === "name") name = text;
      else if (action === "description") description = text;
      else if (action === "kind") kind = text === "agent" ? "agent" : "skill";
      else if (action === "newPath") newPath = text;
      else if (action === "details" && current) { form = "details"; name = current.name; description = current.description; kind = current.kind; }
      else if (action === "new") { form = "new"; name = description = ""; }
      else if (action === "cancelCreate") form = null;
      else if (action === "startAdd" && current) { adding = true; confirmRemove = false; confirmDeleteFile = null; expanded.add(current.id); }
      else if (action === "cancelAdd") { adding = false; newPath = ""; }
      else if (action === "askRemove" && current) { confirmRemove = true; adding = false; confirmDeleteFile = null; }
      else if (action === "cancelRemove") confirmRemove = false;
      else if (action === "askDeleteFile" && current && text !== rootOf(current.kind)) { confirmDeleteFile = text; confirmRemove = adding = false; }
      else if (action === "cancelDeleteFile") confirmDeleteFile = null;
      else if (action === "expand") {
        const id = ev.rowKey || text;
        const set = id.startsWith("dir:") ? collapsedDirs : expanded, present = set.has(id);
        if (present) set.delete(id); else set.add(id);
      }
      else {
        busy = true; ctx.ui.invalidate();
        if (action === "scope") { scope = text === "project" ? "project" : "global"; selectedId = selectedFile = null; confirmRemove = adding = false; await refresh(ctx); }
        else if (action === "refresh") await refresh(ctx);
        else if (action === "select") {
          const key = ev.rowKey || text;
          if (key.startsWith("file:")) { const [, id, ...rest] = key.split(":"); await openFile(ctx, id, rest.join(":")); }
          else if (key.startsWith("dir:")) { if (collapsedDirs.has(key)) collapsedDirs.delete(key); else collapsedDirs.add(key); }
          else {
            const target = entries.find(e => e.id === key);
            if (target) {
              if (selectedId !== key) { confirmRemove = adding = false; confirmDeleteFile = null; }
              expanded.add(key); selectedId = key; selectedFile = null;
              if (workspaceId) { await openFile(ctx, key, rootOf(target.kind)); selectedFile = null; }
            }
          }
        }
        else if (action === "openRoot" && current) await openFile(ctx, current.id, rootOf(current.kind));
        else if (action === "openFile" && current) await openFile(ctx, current.id, text);
        else if (action === "create") {
          const saved = await ctx.modules.call("library", "save", { ...args(), name, description, kind,
            ...(form === "details" && entry ? { id: entry.id, expectedRevision: entry.revision } : { expectedRevision: null }) });
          const created = form === "new";
          form = null; selectedId = saved.id; expanded.add(saved.id); await refresh(ctx);
          if (created && workspaceId) await openFile(ctx, saved.id, rootOf(saved.kind));
        }
        else if (action === "addFile" && entry) {
          const path = newPath.trim();
          if (entry.paths.includes(path)) throw new Error("That file already exists");
          await ctx.modules.call("library", "save", { ...args(), id: entry.id, path, content: path.endsWith(".sh") ? "#!/bin/sh\nset -eu\n\n" : `# ${path.split("/").pop()!.replace(/\.md$/, "")}\n\n`, expectedRevision: entry.revision });
          adding = false; newPath = ""; await refresh(ctx);
          if (workspaceId) await openFile(ctx, entry.id, path);
        }
        else if (action === "deleteFile" && entry && confirmDeleteFile) {
          await ctx.modules.call("library", "save", { ...args(), id: entry.id, path: confirmDeleteFile, content: null, expectedRevision: entry.revision });
          if (selectedFile === confirmDeleteFile) selectedFile = null;
          confirmDeleteFile = null; await refresh(ctx);
        }
        else if (action === "remove" && entry) {
          await ctx.modules.call("library", "remove", { ...args(), id: entry.id, expectedRevision: entry.revision });
          selectedId = selectedFile = null; confirmRemove = false; await refresh(ctx);
        }
      }
    } catch (e) { error = errMsg(e); }
    finally { busy = false; ctx.ui.invalidate(); }
  },
};
export default mod;
