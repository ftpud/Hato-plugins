// ../sdk/debug.ts
var DEBUG_EVENTS = {
  /** {workspaceId, sessions: DebugSessionInfo[]} on session state changes. */
  changed: "debug.changed",
  /** {workspaceId, breakpoints: Breakpoint[], exceptions: ExceptionBreakpoints} when the set changes. */
  breakpoints: "debug.breakpoints"
};
var DEBUG_UI_EVENTS = {
  /** Focus a frame in the editor: {workspaceId, id, conn, frameId, path, line}. Published by the Debug panel. */
  focusFrame: "debug-panel.focusFrame"
};

// ../sdk/runtime.ts
function errMsg(e) {
  return e && (e.message || String(e)) || "unknown error";
}

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

// modules/ui/debug-panel/src/index.ts
var svg = (body, fill = false) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${fill ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
var icons = {
  resume: svg("<path d='M6 4v16M10 4.5v15l10-7.5z'/>"),
  pause: svg("<path d='M8 5v14M16 5v14'/>"),
  over: svg("<path d='M4 14a8 8 0 0 1 15-4m1-5v5h-5'/><circle cx='12' cy='19' r='1.6' fill='currentColor'/>"),
  into: svg("<path d='M12 3v11m-4-4 4 4 4-4'/><circle cx='12' cy='19.5' r='1.6' fill='currentColor'/>"),
  smart: svg("<path d='M12 3v11m-4-4 4 4 4-4M4 6h3m10 0h3'/><circle cx='12' cy='19.5' r='1.6' fill='currentColor'/>"),
  out: svg("<path d='M12 15V4M8 8l4-4 4 4'/><circle cx='12' cy='19.5' r='1.6' fill='currentColor'/>"),
  drop: svg("<path d='M4 7h16M4 12h10M4 17h6M17 14v6m-3-3 3 3 3-3'/>"),
  stop: svg("<rect x='6' y='6' width='12' height='12' rx='1.5'/>", true),
  thread: svg("<path d='M4 7h16M4 12h16M4 17h10'/>"),
  frame: svg("<path d='M7 5h10v14H7z'/>"),
  paused: svg("<path d='M4 8.5h8V4.5l8 7.5-8 7.5v-4H4z'/>", true),
  watch: svg("<path d='M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z'/><circle cx='12' cy='12' r='3'/>"),
  bp: svg("<circle cx='12' cy='12' r='6.5'/>", true),
  bpOff: svg("<circle cx='12' cy='12' r='6'/>")
};
var workspaceId = null;
var sessions = [];
var active = null;
var threads = [];
var frames = [];
var frame = null;
var showLibrary = false;
var scopes = [];
var children = /* @__PURE__ */ new Map();
var expanded = /* @__PURE__ */ new Set();
var rowVars = /* @__PURE__ */ new Map();
var watches = [];
var watchValues = /* @__PURE__ */ new Map();
var consoleLines = [];
var history = [];
var breakpoints = [];
var exceptions = { uncaught: true, caught: false };
var tab = "console";
var smartTargets = null;
var busy = false;
var error = null;
var epoch = 0;
var lastStop = "";
var call = (ctx, method, args = {}) => ctx.modules.call("debug", method, { workspaceId, ...args }, { timeoutMs: 6e4 });
var current = () => sessions.find((s) => s.id === active) || sessions.find((s) => s.state !== "ended") || sessions[sessions.length - 1] || null;
async function refresh(ctx) {
  const s = current(), mine = ++epoch;
  if (!s || s.state === "ended") {
    threads = [];
    frames = [];
    scopes = [];
    ctx.ui.invalidate();
    return;
  }
  try {
    threads = await call(ctx, "threads", { id: s.id });
    if (s.state === "paused" && s.stopped) {
      const stack = await call(ctx, "stack", { id: s.id, conn: s.stopped.conn, threadId: s.stopped.threadId, levels: 60 });
      if (mine !== epoch) return;
      frames = stack;
      const key = `${s.id}:${s.stopped.conn}:${s.stopped.threadId}:${s.stopped.frameId}`;
      if (key !== lastStop || !frame) {
        lastStop = key;
        frame = { conn: s.stopped.conn, id: s.stopped.frameId };
      }
      await loadFrame(ctx, s);
    } else {
      frames = [];
      scopes = [];
      children.clear();
      smartTargets = null;
    }
    error = null;
  } catch (e) {
    if (mine === epoch) error = errMsg(e);
  }
  ctx.ui.invalidate();
}
async function loadFrame(ctx, s) {
  if (!frame) return;
  children.clear();
  scopes = await call(ctx, "scopes", { id: s.id, conn: frame.conn, frameId: frame.id });
  for (const sc of scopes) {
    const key = `scope:${sc.name}`;
    if (!sc.expensive) expanded.add(key);
    if (expanded.has(key)) await loadChildren(ctx, s, sc.variablesReference);
  }
  for (const key of [...expanded]) {
    const v = rowVars.get(key);
    if (v?.variablesReference) await loadChildren(ctx, s, v.variablesReference).catch(() => expanded.delete(key));
  }
  await evaluateWatches(ctx, s);
}
async function loadChildren(ctx, s, ref) {
  if (children.has(ref) || !frame) return;
  children.set(ref, await call(ctx, "variables", { id: s.id, conn: frame.conn, variablesReference: ref, count: 300 }));
}
async function evaluateWatches(ctx, s) {
  watchValues.clear();
  for (const w of watches) {
    try {
      watchValues.set(w, await call(ctx, "evaluate", { id: s.id, conn: frame?.conn, frameId: frame?.id, expression: w, context: "watch" }));
    } catch (e) {
      watchValues.set(w, { error: errMsg(e) });
    }
  }
}
function variableRows(ref, prefix, depth, out) {
  for (const [i, v] of (children.get(ref) || []).entries()) {
    const key = `${prefix}/${i}:${v.name}`;
    rowVars.set(key, v);
    const open = expanded.has(key);
    out.push({
      key,
      label: v.name,
      description: v.value,
      badge: v.type ? v.type.split(".").pop() : void 0,
      depth,
      expandable: v.variablesReference > 0,
      expanded: open,
      selected: false,
      tooltip: `${v.type ? `${v.type} ` : ""}${v.name} = ${v.value}`.slice(0, 500),
      contextMenu: [
        ...v.evaluateName ? [{ text: "Add to watches", action: "addWatch", value: v.evaluateName }] : []
      ]
    });
    if (open && v.variablesReference > 0) variableRows(v.variablesReference, key, depth + 1, out);
  }
}
function variablesTree() {
  rowVars.clear();
  const rows = [];
  for (const [i, w] of watches.entries()) {
    const r = watchValues.get(w);
    const ok = r && !("error" in r) ? r : null;
    const key = `watch:${i}`;
    if (ok) rowVars.set(key, ok);
    rows.push({
      key,
      label: w,
      description: ok ? ok.value : r && "error" in r ? r.error : "",
      iconSvg: icons.watch,
      iconColor: ok ? "info" : "muted",
      depth: 0,
      expandable: !!ok?.variablesReference,
      expanded: expanded.has(key),
      selected: false,
      contextMenu: [{ text: "Remove watch", action: "removeWatch", value: i }]
    });
    if (ok?.variablesReference && expanded.has(key)) variableRows(ok.variablesReference, key, 1, rows);
  }
  for (const sc of scopes) {
    const key = `scope:${sc.name}`;
    rows.push({ key, label: sc.name, depth: 0, expandable: true, expanded: expanded.has(key), selected: false, tooltip: sc.expensive ? "Expanding this scope can be slow" : void 0 });
    if (expanded.has(key)) variableRows(sc.variablesReference, key, 1, rows);
  }
  return rows;
}
function frameTree(s) {
  const rows = [];
  const ordered = [...threads].sort((a, b) => Number(b.stopped) - Number(a.stopped));
  for (const t of ordered.slice(0, 300)) {
    const stopped = s.stopped && s.stopped.conn === t.conn && s.stopped.threadId === t.id;
    rows.push({
      key: `t:${t.conn}:${t.id}`,
      label: t.name,
      depth: 0,
      expandable: !!stopped,
      expanded: !!stopped,
      selected: false,
      iconSvg: stopped ? icons.paused : icons.thread,
      iconColor: stopped ? "warning" : "muted",
      badge: stopped ? s.stopped.reason === "breakpoint" ? "breakpoint" : s.stopped.reason : s.state === "paused" ? "suspended" : "running"
    });
    if (!stopped) continue;
    let hidden = 0;
    for (const f of frames) {
      if (f.library && !showLibrary) {
        hidden++;
        continue;
      }
      rows.push({
        key: `f:${f.conn}:${f.id}`,
        label: f.name,
        description: f.source ? `${f.source}:${f.line + 1}` : "",
        depth: 1,
        expandable: false,
        expanded: false,
        selected: frame?.conn === f.conn && frame?.id === f.id,
        iconSvg: icons.frame,
        iconColor: f.library ? "muted" : "primary",
        tooltip: f.path ? `${f.path}:${f.line + 1}` : "No source available",
        contextMenu: s.supports.restartFrame ? [{ text: "Drop frame (restart from here)", action: "restartFrame", value: f.id }] : void 0
      });
    }
    if (hidden) rows.push({ key: "", label: `${hidden} library frame${hidden === 1 ? "" : "s"} hidden`, depth: 1, expandable: false, expanded: false, selected: false });
  }
  return rows;
}
var tool = (key, icon, action, tooltip, enabled, extra = {}) => ({ type: "button", key, text: "", iconSvg: icon, iconSize: 15, action, variant: "ghost", small: true, width: 28, tooltip, disabled: !enabled || busy, style: { paddingX: 0, height: 26, radius: 6 }, ...extra });
function toolbar(s) {
  const paused = s.state === "paused", live = s.state !== "ended";
  const items = [
    paused ? tool("resume", icons.resume, "continue", "Resume (continue to the next breakpoint)", true, { iconColor: "success" }) : tool("pause", icons.pause, "pause", "Pause all threads", live && s.state === "running"),
    tool("over", icons.over, "stepOver", "Step over", paused),
    tool("into", icons.into, "stepInto", "Step into", paused)
  ];
  if (s.supports.stepInTargets) items.push(tool("smart", icons.smart, "smartStep", "Smart step into: choose the call to enter", paused));
  items.push(tool("out", icons.out, "stepOut", "Step out", paused));
  if (s.supports.restartFrame) items.push(tool("drop", icons.drop, "restartFrame", "Drop frame: restart the selected frame", paused && !!frame, { value: frame?.id }));
  items.push({ type: "column", key: "sep", width: 8, children: [] }, tool("stop", icons.stop, "stop", "Stop debugging", live, { iconColor: live ? "danger" : "muted" }));
  const status = s.state === "paused" && s.stopped ? `⏸ ${s.stopped.reason}${s.stopped.path ? ` · ${s.stopped.path.split("/").pop()}:${s.stopped.line + 1}` : ""}${s.stopped.description ? ` · ${s.stopped.description}` : ""}` : s.state === "running" ? "● Running" : s.state === "starting" ? "◌ Starting…" : "Ended";
  items.push(
    { type: "column", key: "gap", grow: true, children: [] },
    { type: "label", key: "status", text: status, size: "xs", color: s.state === "paused" ? "warning" : s.state === "running" ? "success" : "muted", tooltip: status }
  );
  return { type: "row", key: "toolbar", gap: 2, align: "center", style: { paddingX: 6, paddingY: 2, borderBottom: 1, borderColor: "border" }, children: items };
}
function consoleView(s) {
  return { type: "column", key: "console", grow: true, gap: 4, children: [
    { type: "scroll", key: `lines:${consoleLines.length}`, grow: true, style: { paddingX: 6 }, children: consoleLines.length ? consoleLines.slice(-400).map((l, i) => ({
      type: "label",
      key: `c${i}`,
      text: l.kind === "in" ? `› ${l.text}` : l.text,
      mono: true,
      wrap: true,
      selectable: true,
      color: l.kind === "err" ? "danger" : l.kind === "in" ? "muted" : "default",
      style: { fontSize: 12 }
    })) : [{ type: "label", key: "hint", text: s?.state === "paused" ? "Evaluate expressions in the selected frame." : "Pause the program to evaluate expressions.", size: "xs", color: "muted" }] },
    { type: "textInput", key: "repl", placeholder: s?.state === "paused" ? "Expression — Enter to evaluate" : "Available while paused", submitAction: "evaluate", disabled: s?.state !== "paused", style: { font: "mono" } }
  ] };
}
function breakpointsView() {
  const rows = breakpoints.map((b) => ({
    key: b.id,
    label: `${b.path.split("/").pop()}:${b.line + 1}`,
    description: b.logMessage ? `log: ${b.logMessage}` : b.condition ? `if ${b.condition}` : b.hitCondition ? `hits ${b.hitCondition}` : b.path,
    depth: 0,
    expandable: false,
    expanded: false,
    selected: false,
    iconSvg: b.enabled ? icons.bp : icons.bpOff,
    iconColor: b.enabled ? "danger" : "muted",
    tooltip: b.path,
    contextMenu: [{ text: b.enabled ? "Disable" : "Enable", action: "bpEnable", value: !b.enabled }, { text: "Remove", action: "bpRemove" }]
  }));
  return { type: "column", key: "bps", grow: true, gap: 6, children: [
    { type: "row", key: "ex", gap: 12, align: "center", style: { paddingX: 6 }, children: [
      { type: "switch", key: "uncaught", label: "Pause on uncaught exceptions", checked: exceptions.uncaught, action: "exUncaught" },
      { type: "switch", key: "caught", label: "Caught exceptions", checked: exceptions.caught, action: "exCaught" }
    ] },
    rows.length ? { type: "tree", key: "bp-tree", rows, selectAction: "bpOpen", expandAction: "", rowHeight: 26, grow: true, activateAction: "bpOpen" } : { type: "label", key: "none", text: "No breakpoints. Click the editor gutter to add one; right-click for conditions and log messages.", size: "sm", color: "muted", wrap: true, padding: 6 },
    ...breakpoints.length ? [{ type: "button", key: "clear", text: "Remove all", action: "bpRemoveAll", small: true, variant: "ghost", iconSvg: uiIcons.trash }] : []
  ] };
}
var mod = {
  id: "debug-panel",
  moduleApiVersion: 1,
  async activate(ctx, previous) {
    const load = async () => {
      if (!workspaceId) return;
      const [saved, bps, list] = await Promise.all([
        ctx.modules.call("persistence", "settings.get", { key: `debug-panel.watches.${workspaceId}` }).catch(() => null),
        call(ctx, "breakpointsList").catch(() => null),
        call(ctx, "sessions").catch(() => [])
      ]);
      watches = Array.isArray(saved) ? saved.filter((w) => typeof w === "string").slice(0, 50) : [];
      if (bps) {
        breakpoints = bps.breakpoints || [];
        exceptions = bps.exceptions || exceptions;
      }
      sessions = list || [];
      await refresh(ctx);
    };
    workspaceId = ctx.state.get("workspace.selected")?.id || null;
    if (previous?.workspaceId === workspaceId) {
      showLibrary = !!previous.showLibrary;
      tab = previous.tab === "breakpoints" ? "breakpoints" : "console";
      consoleLines = previous.consoleLines || [];
      history = previous.history || [];
    }
    ctx.state.watch("workspace.selected", (v) => {
      if ((v?.id || null) === workspaceId) return;
      workspaceId = v?.id || null;
      sessions = [];
      active = null;
      frame = null;
      consoleLines = [];
      expanded.clear();
      children.clear();
      breakpoints = [];
      void load();
    });
    ctx.events.on(DEBUG_EVENTS.changed, (e) => {
      if (e?.workspaceId !== workspaceId) return;
      sessions = e.sessions || [];
      const paused = sessions.find((s) => s.state === "paused");
      if (paused && `${paused.id}:${paused.stopped?.threadId}:${paused.stopped?.frameId}` !== lastStop) {
        active = paused.id;
        ctx.events.emit("debug-panel.reveal", { workspaceId });
      }
      void refresh(ctx);
    });
    ctx.events.on(DEBUG_EVENTS.breakpoints, (e) => {
      if (e?.workspaceId === workspaceId) {
        breakpoints = e.breakpoints || [];
        exceptions = e.exceptions || exceptions;
        ctx.ui.invalidate();
      }
    });
    await load();
  },
  deactivate() {
    ++epoch;
  },
  snapshot: () => ({ workspaceId, showLibrary, tab, consoleLines: consoleLines.slice(-200), history: history.slice(-50) }),
  render() {
    if (!workspaceId) return { type: "label", key: "none", text: "Open a project to debug it.", color: "muted", padding: 12 };
    const s = current();
    const right = { type: "column", key: "right", grow: true, children: [
      { type: "tabStrip", key: "tabs", tabs: [{ key: "console", label: "Console" }, { key: "breakpoints", label: `Breakpoints${breakpoints.length ? ` (${breakpoints.length})` : ""}` }], active: tab, action: "tab" },
      tab === "console" ? consoleView(s) : breakpointsView()
    ] };
    if (!s) return { type: "column", key: "idle", grow: true, children: [
      { type: "label", key: "hint", text: "Nothing is being debugged. Choose a configuration in the Run bar and press Debug, or use Debug in the editor gutter's ▶ menu.", size: "sm", color: "muted", wrap: true, padding: 10 },
      { type: "column", key: "bp", grow: true, children: [breakpointsView()] }
    ] };
    const sessionTabs = sessions.length > 1 ? [{
      type: "tabStrip",
      key: "sessions",
      active: s.id,
      action: "session",
      tabs: sessions.map((x) => ({ key: x.id, label: `${x.state === "paused" ? "⏸" : x.state === "ended" ? "■" : "●"} ${x.name}` }))
    }] : [];
    const smart = smartTargets ? [{
      type: "popover",
      key: "smart",
      width: 320,
      top: 40,
      left: 120,
      closeAction: "smartClose",
      style: { background: "panel", padding: 6, radius: 8, borderWidth: 1, borderColor: "border" },
      children: smartTargets.length ? [{ type: "label", key: "t", text: "Step into which call?", size: "xs", color: "muted" }, ...smartTargets.map((t, i) => ({ type: "button", key: `t${i}`, text: t.label, action: "smartInto", value: t.id, small: true, variant: "ghost", style: { justify: "start", fullWidth: true, font: "mono" } }))] : [{ type: "label", key: "none", text: "No calls on this line to step into.", size: "sm", color: "muted" }]
    }] : [];
    return { type: "column", key: "debug", grow: true, children: [
      ...sessionTabs,
      toolbar(s),
      ...error ? [{ type: "status", key: "error", text: error, level: "error" }] : [],
      { type: "split", key: "body", direction: "horizontal", sizes: [0.3, 0.38, 0.32], grow: true, resizable: true, children: [
        { type: "column", key: "frames", grow: true, children: [
          { type: "row", key: "fh", align: "center", style: { paddingX: 6, paddingY: 2 }, children: [
            { type: "label", key: "t", text: "Threads & frames", size: "xs", weight: "semibold", color: "muted", grow: true },
            { type: "button", key: "lib", text: showLibrary ? "Hide library" : "Show library", action: "toggleLibrary", small: true, variant: "ghost", tooltip: "Show or hide frames without project sources" }
          ] },
          { type: "tree", key: "frame-tree", rows: frameTree(s), selectAction: "selectFrame", expandAction: "", rowHeight: 24, grow: true, activateAction: "selectFrame" }
        ] },
        { type: "column", key: "vars", grow: true, children: [
          { type: "row", key: "vh", gap: 4, align: "center", style: { paddingX: 6, paddingY: 2 }, children: [
            { type: "label", key: "t", text: "Variables", size: "xs", weight: "semibold", color: "muted", grow: true }
          ] },
          { type: "textInput", key: "new-watch", placeholder: "+ Add watch expression", submitAction: "addWatch", prefixSvg: icons.watch, style: { font: "mono" } },
          s.state === "paused" ? { type: "tree", key: "var-tree", rows: variablesTree(), selectAction: "noop", expandAction: "expandVar", rowHeight: 22, grow: true, indent: 14 } : { type: "label", key: "running", text: s.state === "ended" ? "The session has ended." : "Variables appear when the program pauses.", size: "sm", color: "muted", padding: 8 }
        ] },
        right
      ] },
      ...smart
    ] };
  },
  async onEvent(ctx, ev) {
    const s = current();
    const v = ev.value;
    try {
      switch (ev.action) {
        case "tab":
          tab = ev.value === "breakpoints" ? "breakpoints" : "console";
          break;
        case "session":
          active = String(ev.value);
          frame = null;
          await refresh(ctx);
          return;
        case "toggleLibrary":
          showLibrary = !showLibrary;
          break;
        case "continue":
        case "pause":
        case "stepOver":
        case "stepInto":
        case "stepOut":
        case "stop":
          if (!s) return;
          busy = true;
          ctx.ui.invalidate();
          await call(ctx, ev.action, { id: s.id, ...s.stopped ? { conn: s.stopped.conn, threadId: s.stopped.threadId } : {} });
          break;
        case "restartFrame":
          if (s) await call(ctx, "restartFrame", { id: s.id, conn: frame?.conn, frameId: Number.isInteger(v) ? v : frame?.id });
          break;
        case "smartStep":
          if (s) smartTargets = await call(ctx, "stepInTargets", { id: s.id, conn: frame?.conn, frameId: frame?.id });
          break;
        case "smartClose":
          smartTargets = null;
          break;
        case "smartInto":
          smartTargets = null;
          if (s?.stopped) await call(ctx, "stepInto", { id: s.id, conn: s.stopped.conn, threadId: s.stopped.threadId, targetId: Number(v) });
          break;
        case "selectFrame": {
          const m = /^f:(\d+):(\d+)$/.exec(ev.rowKey || "");
          if (!m || !s) return;
          frame = { conn: Number(m[1]), id: Number(m[2]) };
          const f = frames.find((x) => x.conn === frame.conn && x.id === frame.id);
          if (f?.path) ctx.events.emit(DEBUG_UI_EVENTS.focusFrame, { workspaceId, id: s.id, conn: f.conn, frameId: f.id, path: f.path, line: f.line });
          await loadFrame(ctx, s);
          break;
        }
        case "expandVar": {
          const key = ev.rowKey || "";
          if (expanded.has(key)) {
            expanded.delete(key);
            break;
          }
          expanded.add(key);
          const ref = key.startsWith("scope:") ? scopes.find((x) => `scope:${x.name}` === key)?.variablesReference : rowVars.get(key)?.variablesReference;
          if (s && ref) await loadChildren(ctx, s, ref);
          break;
        }
        case "addWatch": {
          const expr = String(typeof v === "string" && v ? v : ev.inputs?.["new-watch"] || "").trim();
          if (!expr || watches.includes(expr) || watches.length >= 50) break;
          watches = [...watches, expr];
          await ctx.modules.call("persistence", "settings.set", { key: `debug-panel.watches.${workspaceId}`, value: watches });
          if (s?.state === "paused") await evaluateWatches(ctx, s);
          break;
        }
        case "removeWatch":
          watches = watches.filter((_, i) => i !== Number(v));
          await ctx.modules.call("persistence", "settings.set", { key: `debug-panel.watches.${workspaceId}`, value: watches });
          break;
        case "evaluate": {
          const expr = String(ev.inputs?.repl || "").trim();
          if (!expr || !s) break;
          history = [...history.filter((h) => h !== expr), expr].slice(-50);
          consoleLines.push({ kind: "in", text: expr });
          try {
            const r = await call(ctx, "evaluate", { id: s.id, conn: frame?.conn, frameId: frame?.id, expression: expr, context: "repl" });
            consoleLines.push({ kind: "out", text: `${r.value}${r.type ? `  (${r.type})` : ""}` });
          } catch (e) {
            consoleLines.push({ kind: "err", text: errMsg(e) });
          }
          consoleLines = consoleLines.slice(-1e3);
          await refresh(ctx);
          return;
        }
        case "exUncaught":
          await call(ctx, "exceptionsSet", { uncaught: !!v });
          break;
        case "exCaught":
          await call(ctx, "exceptionsSet", { caught: !!v });
          break;
        case "bpOpen": {
          const b = breakpoints.find((x) => x.id === ev.rowKey);
          if (b) ctx.events.emit(DEBUG_UI_EVENTS.focusFrame, { workspaceId, path: b.path, line: b.line });
          break;
        }
        case "bpEnable":
          if (ev.rowKey) {
            const b = breakpoints.find((x) => x.id === ev.rowKey);
            if (b) await call(ctx, "breakpointsSet", { breakpointId: b.id, path: b.path, line: b.line, enabled: !!v });
          }
          break;
        case "bpRemove":
          if (ev.rowKey) await call(ctx, "breakpointsRemove", { breakpointId: ev.rowKey });
          break;
        case "bpRemoveAll":
          await call(ctx, "breakpointsRemove", { all: true });
          break;
      }
      error = null;
    } catch (e) {
      error = errMsg(e);
    } finally {
      busy = false;
    }
    ctx.ui.invalidate();
  }
};
var index_default = mod;
export {
  index_default as default
};
