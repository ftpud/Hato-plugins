// ../sdk/filter-style.ts
var filterInput = { height: 32, style: { noShrink: true } };

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

// modules/ui/agents-panel/src/index.ts
var ws = null;
var catalog = null;
var rows = [];
var selected = null;
var creating = false;
var error = null;
var busy = false;
var visible = false;
var editing = null;
var confirming = null;
var name = "";
var profile = "";
var agentFile = "";
var filter = "";
var showWorkflow = false;
var isWorkflowAgent = (s) => !!s?.workflow || s?.name === "Workflow configurator";
var DEFAULT_EDITOR = { x: 180, y: 90, width: 440, height: 560 };
var editor = { ...DEFAULT_EDITOR };
var skills = /* @__PURE__ */ new Set();
var mcps = /* @__PURE__ */ new Set(["internal-remote-mcp"]);
var timer = null;
var epoch = 0;
var refreshing = null;
var animation = null;
var frame = 0;
var working = (s) => s.status === "starting" || s.status === "busy";
function spinnerSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8" opacity="0.2"/><path d="M12 4a8 8 0 0 1 8 8" stroke-linecap="round" transform="rotate(${frame * 30} 12 12)"/></svg>`;
}
function animate(ctx) {
  if (visible && rows.some(working)) {
    if (!animation) animation = setInterval(() => {
      frame = (frame + 1) % 12;
      ctx.ui.invalidate();
    }, 80);
  } else if (animation) {
    clearInterval(animation);
    animation = null;
  }
}
var call = (ctx, method, args = {}) => ctx.modules.call("persistent-agents", method, { workspaceId: ws?.id, ...args }, { timeoutMs: 24e4 });
var button = (key, text, action, value) => ({ type: "button", key, text, action, value, small: true });
async function refresh(ctx, force = false) {
  if (!ws || refreshing === epoch || !visible && !force) return;
  const mine = epoch, id = ws.id;
  refreshing = mine;
  try {
    const next = await call(ctx, "list");
    if (mine !== epoch || id !== ws?.id) return;
    rows = next;
    animate(ctx);
    error = null;
  } catch (e) {
    if (mine === epoch) error = errMsg(e);
  } finally {
    if (refreshing === mine) refreshing = null;
    ctx.ui.invalidate();
  }
}
async function setup(ctx) {
  const mine = ++epoch;
  busy = false;
  error = null;
  rows = [];
  animate(ctx);
  selected = null;
  catalog = null;
  creating = false;
  if (!ws) {
    ctx.ui.invalidate();
    return;
  }
  try {
    const c = await call(ctx, "catalog");
    if (mine !== epoch) return;
    catalog = c;
    profile = c.profiles[0]?.id || "";
  } catch (e) {
    if (mine === epoch) error = errMsg(e);
  }
  if (visible) await refresh(ctx, true);
}
function schedule(ctx) {
  animate(ctx);
  if (timer) clearInterval(timer);
  timer = visible ? setInterval(() => {
    void refresh(ctx);
  }, 1500) : null;
}
function checks(items, set, action) {
  return items.map((item) => ({ type: "toggle", key: `${action}:${item.path || item.id}`, label: item.name || item.id, checked: set.has(item.path || item.id), action, value: item.path || item.id }));
}
var label = (key, text) => ({ type: "label", key, text, wrap: true, color: "muted", size: "sm" });
function editorWindow() {
  const target = editing ? rows.find((s) => s.id === editing) : null;
  const title = editing ? `Edit ${target?.name || name || "agent"}` : "New background agent";
  return { type: "floating", key: "agent-editor", title, ...editor, moveAction: "moveEditor", children: [
    { type: "column", key: "editor-body", padding: 10, gap: 8, grow: true, children: [
      { type: "row", key: "editor-header", gap: 4, align: "center", children: [
        { type: "label", key: "editor-title", text: editing ? "Change this agent’s provider, instructions, tools and skills." : "Choose a provider, instructions, tools and skills.", size: "xs", color: "muted", wrap: true, grow: true },
        { type: "button", key: "editor-close", text: "", iconSvg: uiIcons.x, action: "back", small: true, variant: "ghost", tooltip: "Close without saving" }
      ] },
      ...error ? [{ type: "status", key: "editor-error", level: "error", text: error }] : [],
      ...busy ? [{ type: "progress", key: "editor-busy", indeterminate: true }] : [],
      { type: "column", key: "create-form", gap: 8, scroll: true, grow: true, children: [
        { type: "textInput", key: "agent-name", placeholder: "Agent name", value: name, changeAction: "name" },
        { type: "select", key: "provider", label: "Provider", value: profile, options: catalog.profiles.map((p) => ({ value: p.id, label: p.name })), action: "provider" },
        label("model-note", editing ? "Changing the provider starts a new provider session; choose its model in the chat. Changes other than the name restart a connected agent." : "Connect to choose from the provider’s models before sending the first prompt."),
        { type: "select", key: "agent-file", label: "Agent instructions", value: agentFile, options: [{ value: "", label: "No agent file" }, ...catalog.agentFiles.map((f) => ({ value: f.path, label: f.path }))], action: "agentFile" },
        label("mcp-heading", "Allowed MCP servers"),
        ...checks(catalog.mcps, mcps, "mcp"),
        label("skills-heading", "Allowed skills"),
        ...checks(catalog.skills, skills, "skill"),
        ...!catalog.skills.length ? [label("no-skills", "No workspace skills found in .agents/skills.")] : [],
        label("scope-note", "Selections control supplied instructions, skills and MCP connections. Provider-native tools keep the provider’s permission controls."),
        label("lifetime", "Runs on the workspace machine’s daemon, including local workspaces. Closing this panel or Hato does not stop a running turn.")
      ] },
      { type: "row", key: "editor-footer", gap: 4, align: "center", children: [
        { type: "label", key: "editor-spacer", text: "", grow: true },
        button("cancel-create", "Cancel", "back"),
        editing ? { type: "button", key: "save", text: "Save changes", action: "save", variant: "primary", small: true, disabled: busy || !profile } : { type: "button", key: "create", text: "Connect and choose model", action: "create", variant: "primary", small: true, disabled: busy || !profile }
      ] }
    ] }
  ] };
}
var workflowCount = () => rows.filter(isWorkflowAgent).length;
var workflowIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><path d="M9 6h6M18 9v6M6 9v6a3 3 0 0 0 3 3h6"/></svg>`;
var mod = {
  id: "agents-panel",
  moduleApiVersion: 1,
  async activate(ctx, prev) {
    const saved = prev?.editor;
    if (saved && ["x", "y", "width", "height"].every((k) => Number.isFinite(saved[k]))) editor = { x: saved.x, y: saved.y, width: Math.max(320, saved.width), height: Math.max(320, saved.height) };
    ws = ctx.state.get("workspace.selected") || null;
    visible = !!ctx.state.get("workspace-layout.panels")?.agents;
    ctx.state.watch("workspace.selected", (next) => {
      const changed = next?.id !== ws?.id;
      ws = next;
      if (changed) void setup(ctx);
    });
    ctx.state.watch("workspace-layout.panels", (panels) => {
      visible = !!panels?.agents;
      schedule(ctx);
      if (visible) void refresh(ctx, true);
    });
    await setup(ctx);
    if (prev && prev.workspaceId === ws?.id) {
      selected = prev.selected || null;
      filter = prev.filter || "";
      showWorkflow = !!prev.showWorkflow;
      if (visible) await refresh(ctx, true);
    }
    ctx.events.on("persistent-agents.mcpsChanged", () => {
      if (ws && creating) void call(ctx, "catalog").then((next) => {
        catalog = next;
        mcps = new Set([...mcps].filter((id) => next.mcps.some((server) => server.id === id)));
        ctx.ui.invalidate();
      }).catch((e) => {
        error = errMsg(e);
        ctx.ui.invalidate();
      });
    });
    ctx.state.watch("ai.session", (session) => {
      selected = session?.kind === "background" && session.workspaceId === ws?.id ? session.id : null;
      ctx.ui.invalidate();
    });
    schedule(ctx);
  },
  deactivate() {
    epoch++;
    if (timer) clearInterval(timer);
    timer = null;
    if (animation) clearInterval(animation);
    animation = null;
  },
  snapshot: () => ({ workspaceId: ws?.id, selected, filter, editor, showWorkflow }),
  render() {
    const children = [{ type: "row", key: "header", gap: 3, children: [
      { type: "textInput", key: "agent-filter", ...filterInput, prefixSvg: uiIcons.search, placeholder: "Filter agents", value: filter, changeAction: "filter", grow: true },
      {
        type: "button",
        key: "workflow-toggle",
        text: workflowCount() ? String(workflowCount()) : "",
        iconSvg: workflowIcon,
        action: "toggleWorkflow",
        small: true,
        variant: showWorkflow ? "primary" : "ghost",
        tooltip: showWorkflow ? "Showing workflow agents — click to hide them" : `Show workflow agents${workflowCount() ? ` (${workflowCount()} hidden)` : ""}`
      },
      { type: "button", key: "new", text: "", iconSvg: uiIcons.plus, action: "new", small: true, variant: "ghost", tooltip: "Create agent" },
      { type: "button", key: "refresh", text: "", iconSvg: uiIcons.refresh, action: "refresh", small: true, variant: "ghost", tooltip: "Refresh agents" }
    ] }, { type: "row", key: "summary", children: [{ type: "label", key: "count", text: `${rows.filter((s) => showWorkflow || !isWorkflowAgent(s)).length} agents${!showWorkflow && workflowCount() ? ` · ${workflowCount()} workflow hidden` : ""}`, size: "xs", color: "muted", grow: true }] }];
    if (!ws) children.push(label("none", "Select a workspace to create or open its agents."));
    if (error && !creating) children.push({ type: "status", key: "error", level: "error", text: error });
    if (busy && !creating) children.push({ type: "progress", key: "busy", indeterminate: true });
    if (ws) {
      const query = filter.trim().toLowerCase();
      const agents = rows.filter((s) => (showWorkflow || !isWorkflowAgent(s)) && [s.name, s.profile.name, s.status, s.activity || ""].some((v) => v.toLowerCase().includes(query)));
      children.push({ type: "tree", key: "agents", rowHeight: 42, rowGap: 0, iconSize: 18, grow: true, selectAction: "open", expandAction: "noop", rows: agents.map((s) => ({
        key: s.id,
        label: s.name,
        detail: s.activity || `${s.profile.name} · ${s.machineId}`,
        badge: s.status,
        tooltip: `${s.profile.name} · ${s.machineId}${s.activity ? "\n" + s.activity : ""}`,
        selected: s.id === selected,
        depth: 0,
        expandable: false,
        expanded: false,
        iconSvg: working(s) ? spinnerSvg() : s.status === "waiting" ? uiIcons.warning : uiIcons["message-square"],
        iconColor: working(s) ? "primary" : s.status === "error" ? "danger" : s.status === "waiting" ? "warning" : "muted"
      })) });
      if (!agents.length) children.push(label("empty", query ? "No matching agents." : !showWorkflow && workflowCount() ? "Only workflow agents here — use the workflow button to show them." : "No background agents in this workspace. Create one to begin."));
      const current = rows.find((s) => s.id === selected);
      if (current) {
        const running = ["starting", "busy", "waiting"].includes(current.status);
        children.push({ type: "row", key: "agent-actions", gap: 4, children: [
          { type: "button", key: "edit", text: "Edit", iconSvg: uiIcons.pencil, action: "edit", value: current.id, small: true, variant: "ghost", disabled: busy, tooltip: `Edit ${current.name}` },
          { type: "button", key: "clear", text: "Clear session", iconSvg: uiIcons.eraser, action: "confirmClear", value: current.id, small: true, variant: "ghost", disabled: busy || running, tooltip: running ? "Cancel the running turn first" : "Delete this agent’s history and start a fresh provider session" },
          { type: "button", key: "remove", text: "Remove", iconSvg: uiIcons.trash, action: "confirmRemove", value: current.id, small: true, variant: "ghost", disabled: busy, tooltip: `Stop and delete ${current.name}` }
        ] });
      }
      if (confirming) {
        const target = rows.find((s) => s.id === confirming.id);
        if (target) children.push({ type: "modal", key: "confirm", title: confirming.action === "remove" ? "Remove agent" : "Clear session", closeAction: "dismiss", children: [
          label("confirm-text", confirming.action === "remove" ? `Remove “${target.name}”? It is stopped and its conversation history is deleted. Files it changed are kept.` : `Clear “${target.name}”? Its conversation history is deleted and the next prompt starts a fresh provider session with the same settings.`),
          { type: "row", key: "confirm-buttons", gap: 4, children: [
            { type: "button", key: "confirm-yes", text: confirming.action === "remove" ? "Remove" : "Clear session", action: confirming.action, value: target.id, variant: "danger", small: true, disabled: busy },
            button("confirm-no", "Cancel", "dismiss")
          ] }
        ] });
      }
    }
    if (creating && catalog && ws) children.push(editorWindow());
    return { type: "column", key: "agents-root", padding: 8, gap: 8, grow: true, children };
  },
  async onEvent(ctx, ev) {
    const value = String(ev.value || "");
    if (ev.action === "filter") {
      filter = value;
      ctx.ui.invalidate();
      return;
    }
    if (ev.action === "toggleWorkflow") {
      showWorkflow = !showWorkflow;
      if (!showWorkflow && isWorkflowAgent(rows.find((s) => s.id === selected))) selected = null;
      ctx.ui.invalidate();
      return;
    }
    if (ev.action === "name") {
      name = value;
      return;
    }
    if (ev.action === "provider") {
      profile = value;
      return;
    }
    if (ev.action === "agentFile") {
      agentFile = value;
      return;
    }
    if (ev.action === "moveEditor") {
      const g = ev.value;
      if (g && ["x", "y", "width", "height"].every((k) => Number.isFinite(g[k]))) {
        editor = { x: g.x, y: g.y, width: g.width, height: g.height };
        ctx.ui.invalidate();
      }
      return;
    }
    if (ev.action === "skill" || ev.action === "mcp") {
      const set = ev.action === "skill" ? skills : mcps;
      const id = ev.key.slice(ev.key.indexOf(":") + 1);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      ctx.ui.invalidate();
      return;
    }
    if (busy) return;
    const mine = epoch, workspaceId = ws?.id;
    const actionCall = async (method, args = {}) => {
      const result = await ctx.modules.call("persistent-agents", method, { workspaceId, ...args }, { timeoutMs: 24e4 });
      if (mine !== epoch) throw new Error("Workspace changed");
      return result;
    };
    busy = true;
    error = null;
    ctx.ui.invalidate();
    try {
      if (ev.action === "new") {
        catalog = await actionCall("catalog");
        creating = true;
        editing = null;
        name = "";
        profile = catalog.profiles[0]?.id || "";
        agentFile = "";
        skills = /* @__PURE__ */ new Set();
        mcps = /* @__PURE__ */ new Set(["internal-remote-mcp"]);
      } else if (ev.action === "edit") {
        const s = rows.find((r) => r.id === value);
        if (!s) throw new Error("Agent is no longer available");
        catalog = await actionCall("catalog");
        if (mine !== epoch) return;
        editing = s.id;
        creating = true;
        name = s.name;
        profile = s.profile.id;
        agentFile = s.agentFile || "";
        skills = new Set(s.skills);
        mcps = /* @__PURE__ */ new Set([...s.workspaceMcp ? ["internal-remote-mcp"] : [], ...s.mcps.map((m) => m.id)]);
      } else if (ev.action === "save" && editing) {
        await actionCall("update", { id: editing, name: ev.inputs["agent-name"] || name, profileId: profile, agentFile, skills: [...skills], mcps: [...mcps] });
        if (mine !== epoch) return;
        creating = false;
        editing = null;
      } else if (ev.action === "back") {
        creating = false;
        editing = null;
      } else if (ev.action === "confirmClear" || ev.action === "confirmRemove") {
        confirming = { action: ev.action === "confirmClear" ? "clear" : "remove", id: value };
      } else if (ev.action === "dismiss") {
        confirming = null;
      } else if (ev.action === "clear") {
        confirming = null;
        await actionCall("clear", { id: value });
        ctx.events.emit("agents-panel.agentCleared", { workspaceId, id: value });
      } else if (ev.action === "remove") {
        confirming = null;
        await actionCall("remove", { id: value });
        if (selected === value) selected = null;
        ctx.events.emit("agents-panel.agentRemoved", { workspaceId, id: value });
      } else if (ev.action === "create") {
        const s = await actionCall("create", { name: ev.inputs["agent-name"] || name || "Agent", profileId: profile, agentFile, skills: [...skills], mcps: [...mcps] });
        if (mine !== epoch) return;
        selected = s.id;
        creating = false;
        ctx.events.emit("agents-panel.openChat", { workspaceId, id: s.id });
      } else if (ev.action === "open") {
        selected = ev.rowKey || value;
        ctx.events.emit("agents-panel.openChat", { workspaceId, id: selected });
      }
      if (mine === epoch) await refresh(ctx, true);
    } catch (e) {
      if (mine === epoch) error = errMsg(e);
    } finally {
      if (mine === epoch) busy = false;
      ctx.ui.invalidate();
    }
  }
};
var index_default = mod;
export {
  index_default as default
};
