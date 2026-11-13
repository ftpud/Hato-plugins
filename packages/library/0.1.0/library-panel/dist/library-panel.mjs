// ../sdk/ui-icons.ts
var outline = (paths, width = 1.8) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
var uiIcons = {
  send: outline("<path d='m22 2-7 20-4-9-9-4Z'/><path d='M22 2 11 13'/>"),
  paperclip: outline("<path d='m21 11-9 9a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8l8.5-8.5'/>"),
  "sliders-horizontal": outline("<path d='M3 6h3m4 0h11M3 18h11m4 0h3'/><circle cx='8' cy='6' r='2'/><circle cx='16' cy='18' r='2'/>"),
  "message-square": outline("<path d='M21 15a2 2 0 0 1-2 2H7l-5 5V4a2 2 0 0 1 2-2h15a2 2 0 0 1 2 2Z'/>"),
  "graduation-cap": outline("<path d='m2 8 10-5 10 5-10 5Zm4 2v7q6 5 12 0v-7M22 8v8'/>"),
  pencil: outline("<path d='M21.2 6.8a2.8 2.8 0 0 0-4-4L3.8 16.2 3 21l4.8-.8Z'/><path d='m15 5 4 4'/>"),
  eraser: outline("<path d='m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L11 21'/><path d='M22 21H7'/><path d='m5 11 9 9'/>"),
  trash: outline("<path d='M3 6h18'/><path d='M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6'/><path d='M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'/><path d='M10 11v6M14 11v6'/>"),
  copy: outline("<rect x='8' y='8' width='13' height='13' rx='2'/><path d='M16 5V3H3v13h2'/>"),
  warning: outline("<path d='m12 3 10 18H2Z'/><path d='M12 9v5m0 3h.01'/>"),
  terminal: outline("<rect x='3' y='4' width='18' height='16' rx='2'/><path d='m7 9 3 3-3 3m6 0h4'/>"),
  "git-branch": outline("<circle cx='6' cy='3' r='2'/><circle cx='6' cy='20' r='2'/><circle cx='18' cy='6' r='2'/><path d='M6 5v13M18 8c0 7-12 4-12 10'/>"),
  files: outline("<path d='M14 2H6v16h14V8Z'/><path d='M14 2v6h6M3 6v16h13'/>"),
  folder: outline("<path d='M3 5h6l2 2h10v13H3Z'/>"),
  refresh: outline("<path d='M20 7a8 8 0 1 0 0 10M20 3v5h-5'/>"),
  collapse: outline("<path d='m8 8 4-4 4 4M8 16l4 4 4-4M4 12h16'/>"),
  locate: outline("<circle cx='12' cy='12' r='7'/><circle cx='12' cy='12' r='2'/><path d='M12 2v3m0 14v3M2 12h3m14 0h3'/>"),
  search: outline("<circle cx='10' cy='10' r='7'/><path d='m15 15 6 6'/>"),
  x: outline("<path d='m6 6 12 12M6 18 18 6'/>"),
  plus: outline("<path d='M12 4v16M4 12h16'/>"),
  remote: outline("<rect x='3' y='4' width='18' height='12' rx='2'/><path d='M8 20h8M12 16v4'/>"),
  plug: outline("<path d='M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0V7ZM12 17v5'/>"),
  "text-search": outline("<path d='M4 6h16M4 12h7M4 18h6'/><circle cx='17' cy='15' r='3'/><path d='m19.2 17.2 2.3 2.3'/>"),
  eye: outline("<path d='M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z'/><circle cx='12' cy='12' r='3'/>"),
  "eye-off": outline("<path d='M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3 3.8M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18'/>"),
  globe: outline("<circle cx='12' cy='12' r='9'/><path d='M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18'/>"),
  "cloud-lock": outline("<path d='M17.5 17H18a4 4 0 0 0 .5-8A6 6 0 0 0 7 7.5 4.5 4.5 0 0 0 6.5 17'/><rect x='9' y='14' width='6' height='6' rx='1'/><path d='M10.5 14v-1.5a1.5 1.5 0 0 1 3 0V14'/>"),
  lock: outline("<rect x='4' y='11' width='16' height='10' rx='2'/><path d='M8 11V7a4 4 0 0 1 8 0v4'/>"),
  key: outline("<circle cx='8' cy='15' r='4'/><path d='m10.8 12.2 8.7-8.7M17 6l3 3M14.5 8.5l2 2'/>"),
  check: outline("<path d='m5 12 5 5 9-11'/>"),
  "log-out": outline("<path d='M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9'/>"),
  external: outline("<path d='M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'/>"),
  sparkles: outline("<path d='M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z'/><path d='M19 16v4M17 18h4'/>"),
  import: outline("<path d='M12 3v12M7 10l5 5 5-5M5 21h14'/>"),
  task: outline("<circle cx='6' cy='3' r='2'/><circle cx='6' cy='20' r='2'/><circle cx='18' cy='6' r='2'/><path d='M6 5v13M18 8c0 7-12 4-12 10'/>")
};

// ../sdk/runtime.ts
function errMsg(e) {
  return e && (e.message || String(e)) || "unknown error";
}

// ../sdk/filter-style.ts
var filterInput = { height: 32, style: { noShrink: true } };

// modules/ui/library-panel/src/index.ts
var scope = "global";
var workspaceId = null;
var entries = [];
var selected = null;
var file = "";
var content = "";
var saved = "";
var query = "";
var error = "";
var busy = false;
var preview = true;
var editingMetadata = false;
var creating = false;
var name = "";
var description = "";
var kind = "skill";
var newPath = "";
var confirmRemove = false;
var expanded = /* @__PURE__ */ new Set();
var collapsedDirs = /* @__PURE__ */ new Set();
var generation = 0;
var dirty = () => content !== saved;
var args = () => ({ scope, workspaceId });
var btn = (key, text, action, disabled = false) => ({ type: "button", key, text, action, small: true, disabled: busy || disabled, variant: "ghost" });
var label = (key, text, muted = false) => ({ type: "label", key, text, size: "sm", color: muted ? "muted" : void 0, wrap: true });
async function refresh(ctx) {
  const version = ++generation;
  if (scope === "project" && !workspaceId) {
    entries = [];
    selected = null;
    ctx.ui.invalidate();
    return;
  }
  try {
    const next = await ctx.modules.call("library", "list", args());
    if (version !== generation) return;
    entries = next;
    error = "";
  } catch (e) {
    if (version === generation) error = errMsg(e);
  }
  ctx.ui.invalidate();
}
async function open(ctx, id, path) {
  if (dirty()) throw new Error("Save or discard your changes before navigating");
  const version = ++generation;
  const next = await ctx.modules.call("library", "read", { ...args(), id });
  const key = path || next.paths.find((p) => p === "SKILL.md" || p === "AGENT.md") || next.paths[0];
  const result = await ctx.modules.call("library", "read", { ...args(), id, path: key });
  if (version !== generation) return;
  selected = next;
  file = key;
  content = saved = result.content;
  preview = true;
  creating = false;
  confirmRemove = false;
  expanded.add(id);
  ctx.ui.invalidate();
}
function rows() {
  const result = [];
  for (const entry of entries.filter((e) => `${e.name} ${e.description}`.toLowerCase().includes(query.toLowerCase()))) {
    result.push({ key: entry.id, label: entry.name, description: entry.description, badge: entry.kind, depth: 0, expandable: true, expanded: expanded.has(entry.id), selected: selected?.id === entry.id && !file, iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v16M3 3h5a4 4 0 0 1 4 2 4 4 0 0 1 4-2h5v16h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3Z"/></svg>' });
    if (!expanded.has(entry.id)) continue;
    const dirs = /* @__PURE__ */ new Set();
    for (const p of entry.paths) {
      const segments = p.split("/");
      let hidden = false;
      for (let i = 1; i < segments.length; i++) {
        const dir = segments.slice(0, i).join("/");
        if (!dirs.has(dir)) {
          dirs.add(dir);
          result.push({ key: `dir:${entry.id}:${dir}`, label: segments[i - 1], depth: i, expandable: true, expanded: !collapsedDirs.has(`dir:${entry.id}:${dir}`), selected: false, iconSvg: uiIcons.folder });
        }
        if (collapsedDirs.has(`dir:${entry.id}:${dir}`)) {
          hidden = true;
          break;
        }
      }
      if (hidden) continue;
      result.push({ key: `file:${entry.id}:${p}`, label: segments[segments.length - 1], depth: segments.length, expandable: false, expanded: false, selected: selected?.id === entry.id && file === p, iconSvg: uiIcons[p.endsWith(".sh") ? "terminal" : "files"] });
    }
  }
  return result;
}
var mod = {
  id: "library-panel",
  moduleApiVersion: 1,
  async activate(ctx, prev) {
    scope = prev?.scope || "global";
    expanded = new Set(prev?.expanded || []);
    collapsedDirs = new Set(prev?.collapsedDirs || []);
    const w = ctx.state.get("workspace.selected");
    workspaceId = w?.id || null;
    ctx.state.watch("workspace.selected", () => {
      const w2 = ctx.state.get("workspace.selected");
      if (scope === "project" && dirty()) {
        error = "Project changed. Save or discard Library edits before selecting the new project scope.";
        ctx.ui.invalidate();
        return;
      }
      workspaceId = w2?.id || null;
      if (scope === "project") {
        generation++;
        selected = null;
        file = "";
        content = saved = "";
        void refresh(ctx);
      }
    });
    ctx.events.on("library.changed", () => {
      void refresh(ctx);
    });
    await refresh(ctx);
  },
  snapshot: () => ({ scope, expanded: [...expanded], collapsedDirs: [...collapsedDirs] }),
  canSwap: () => ({ ok: !dirty() && !busy, reason: "Save Library edits before reloading" }),
  render() {
    const children = [
      { type: "row", key: "heading", gap: 8, align: "center", children: [{ type: "label", key: "title", text: "Library", size: "lg", weight: "semibold", grow: true }, btn("refresh", "Refresh", "refresh", dirty()), btn("add", "+ New", "new", dirty())] },
      label("intro", "Reusable skills and agents, stored outside your workspace.", true),
      { type: "select", key: "scope", value: scope, action: "scope", disabled: busy || dirty(), options: [{ value: "global", label: "Global · all projects" }, { value: "project", label: "Project · shared with its tasks" }] },
      { type: "textInput", key: "filter", ...filterInput, value: query, placeholder: "Find skills or agents…", changeAction: "filter" }
    ];
    if (error) children.push({ type: "label", key: "error", text: error, color: "danger", wrap: true });
    if (creating) children.push({ type: "column", key: "create", gap: 8, padding: 12, border: true, children: [label("ct", editingMetadata ? "Edit Library entry" : "New Library entry"), { type: "select", key: "kind", value: kind, action: "kind", disabled: editingMetadata, options: [{ value: "skill", label: "Skill" }, { value: "agent", label: "Agent instructions" }] }, { type: "textInput", key: "name", value: name, placeholder: "Name", changeAction: "name" }, { type: "textInput", key: "description", value: description, placeholder: "When should this be used?", changeAction: "description" }, { type: "row", key: "create-actions", gap: 8, children: [btn("create", editingMetadata ? "Save details" : "Create", "create", !name.trim()), btn("cancel", "Cancel", "cancelCreate")] }] });
    children.push(entries.length ? { type: "tree", key: "entries", rows: rows(), selectAction: "select", expandAction: "expand", height: selected ? 190 : 360, grow: !selected, rowHeight: 28 } : { type: "column", key: "empty", padding: 20, gap: 10, children: [label("empty-title", scope === "project" && !workspaceId ? "Select a project to open its Library" : "Your Library is ready"), label("empty-hint", "Add a skill with SKILL.md, or an agent with AGENT.md. Keep references in nested Markdown pages and scripts in .sh files.", true)] });
    if (selected) {
      children.push({ type: "row", key: "entry", gap: 8, children: [{ type: "label", key: "name", text: selected.name, grow: true, weight: "semibold" }, btn("details", "Details", "details", dirty()), btn("remove", "Remove", "askRemove", dirty())] });
      if (confirmRemove) children.push({ type: "row", key: "remove-confirm", gap: 6, children: [label("warn", "Delete this entry and all its files?"), btn("yes", "Delete", "remove"), btn("no", "Cancel", "cancelRemove")] });
      children.push({ type: "row", key: "file-bar", gap: 6, children: [{ type: "label", key: "path", text: file + (dirty() ? " · Unsaved" : ""), grow: true, size: "xs", color: "muted" }, btn("preview", preview ? "Edit" : "Preview", "preview", !file.endsWith(".md")), btn("save", "Save", "save", !dirty()), btn("discard", "Discard", "discard", !dirty())] });
      children.push(preview && file.endsWith(".md") ? { type: "column", key: "preview-scroll", grow: true, scroll: true, padding: 10, children: [{ type: "markdown", key: "preview", text: content, linkAction: "link" }] } : { type: "textInput", key: "editor", value: content, changeAction: "content", multiline: true, fillHeight: true, grow: true, style: { font: "mono", minHeight: 140 } });
      children.push({ type: "column", key: "new-file", gap: 6, children: [{ type: "textInput", key: "newPath", value: newPath, changeAction: "newPath", placeholder: "references/guide.md or scripts/check.sh", grow: true }, { type: "row", key: "file-actions", gap: 6, children: [btn("add-file", "Add file", "addFile", !newPath || dirty()), btn("delete-file", "Delete file", "deleteFile", dirty() || file === "SKILL.md" || file === "AGENT.md")] }] });
    }
    children.push(label("footer", "AI reads files on demand through Library MCP tools. Scripts are stored, never auto-run.", true));
    return { type: "column", key: "library", grow: true, padding: 14, gap: 10, children };
  },
  async onEvent(ctx, ev) {
    if (busy) return;
    error = "";
    try {
      const action = ev.action, value = String(ev.value ?? "");
      if (ev.inputs?.editor !== void 0) content = ev.inputs.editor;
      if (ev.inputs?.name !== void 0) name = ev.inputs.name;
      if (ev.inputs?.description !== void 0) description = ev.inputs.description;
      if (ev.inputs?.newPath !== void 0) newPath = ev.inputs.newPath;
      if (action === "filter") query = value;
      else if (action === "content") content = value;
      else if (action === "name") name = value;
      else if (action === "description") description = value;
      else if (action === "kind") kind = value;
      else if (action === "newPath") newPath = value;
      else if (action === "preview") preview = !preview;
      else if (action === "discard") {
        content = saved;
        const w = ctx.state.get("workspace.selected");
        if (scope === "project" && workspaceId !== (w?.id || null)) {
          workspaceId = w?.id || null;
          selected = null;
          void refresh(ctx);
        }
      } else if (action === "details") {
        editingMetadata = true;
        creating = true;
        name = selected.name;
        description = selected.description;
        kind = selected.kind;
      } else if (action === "new") {
        editingMetadata = false;
        creating = true;
        name = description = "";
      } else if (action === "cancelCreate") creating = false;
      else if (action === "askRemove") confirmRemove = true;
      else if (action === "cancelRemove") confirmRemove = false;
      else if (action === "expand") {
        const id = ev.rowKey || value;
        if (id.startsWith("dir:")) {
          if (collapsedDirs.has(id)) collapsedDirs.delete(id);
          else collapsedDirs.add(id);
        } else if (expanded.has(id)) expanded.delete(id);
        else expanded.add(id);
      } else {
        busy = true;
        if (action === "scope") {
          if (dirty()) throw new Error("Save or discard edits first");
          scope = value;
          selected = null;
          content = saved = "";
          workspaceId = ctx.state.get("workspace.selected")?.id || null;
          await refresh(ctx);
        } else if (action === "refresh") {
          await refresh(ctx);
          if (selected && !dirty()) await open(ctx, selected.id, file);
        } else if (action === "select") {
          const key = ev.rowKey || value;
          if (key.startsWith("file:")) {
            const [_, id, ...rest] = key.split(":");
            await open(ctx, id, rest.join(":"));
          } else if (key.startsWith("dir:")) {
            if (collapsedDirs.has(key)) collapsedDirs.delete(key);
            else collapsedDirs.add(key);
          } else await open(ctx, key);
        } else if (action === "create") {
          const entry = await ctx.modules.call("library", "save", { ...args(), name, description, kind, ...editingMetadata ? { id: selected.id, expectedRevision: selected.revision } : { expectedRevision: null } });
          creating = false;
          await refresh(ctx);
          await open(ctx, entry.id);
        } else if (action === "save" || action === "addFile" || action === "deleteFile") {
          const path = action === "addFile" ? newPath : file;
          if (action === "addFile" && selected.paths.includes(path)) throw new Error("That file already exists");
          await ctx.modules.call("library", "save", { ...args(), id: selected.id, path, content: action === "deleteFile" ? null : action === "addFile" ? "" : content, expectedRevision: selected.revision });
          saved = content;
          await refresh(ctx);
          await open(ctx, selected.id, action === "deleteFile" ? void 0 : path);
          newPath = "";
        } else if (action === "remove") {
          await ctx.modules.call("library", "remove", { ...args(), id: selected.id, expectedRevision: selected.revision });
          selected = null;
          file = "";
          content = saved = "";
          await refresh(ctx);
        } else if (action === "link") {
          const base = file.split("/").slice(0, -1), parts = [...base, ...value.split("#")[0].split("/")], resolved = [];
          for (const part of parts) {
            if (part === "..") resolved.pop();
            else if (part && part !== ".") resolved.push(part);
          }
          await open(ctx, selected.id, resolved.join("/"));
        }
      }
    } catch (e) {
      error = errMsg(e);
    } finally {
      busy = false;
      ctx.ui.invalidate();
    }
  }
};
var index_default = mod;
export {
  index_default as default
};
