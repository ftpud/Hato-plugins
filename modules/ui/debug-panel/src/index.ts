// Debug panel: session controls, threads & frames, variables (+ watches), debug console and breakpoints.
// Presentation only; everything goes through the `debug` service (sdk/debug.ts).
import type { AppModule, MenuItem, ModuleContext, TreeRow, UiNode } from "@hato/sdk/types";
import { DEBUG_EVENTS, DEBUG_UI_EVENTS, type Breakpoint, type DebugFrame, type DebugSessionInfo, type DebugThread, type DebugVariable, type ExceptionBreakpoints } from "@hato/sdk/debug";
import { errMsg } from "@hato/sdk/runtime";
import { uiIcons } from "@hato/sdk/ui-icons";
import { childKey, describeValue, VALUE_PAGE, valueSnapshot, valueTreeRows, type ChildRange, type ValueVariable } from "@hato/sdk/debug-values";
import { anchoredMotion } from "@hato/sdk/motion";

const svg = (body: string, fill = false) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${fill ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const icons = {
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
  bpOff: svg("<circle cx='12' cy='12' r='6'/>"),
  bug: svg("<path d='M9 7.5V6a3 3 0 0 1 6 0v1.5'/><rect x='7' y='7.5' width='10' height='12' rx='5'/><path d='M12 11v8.5M7 12H3.5M17 12h3.5M7.4 16.5 4 18.5M16.6 16.5l3.4 2M7.6 9 5 6.5M16.4 9 19 6.5'/>"),
};

let workspaceId: string | null = null;
let sessions: DebugSessionInfo[] = [];
let active: string | null = null;
let threads: DebugThread[] = [];
let frames: DebugFrame[] = [];
let frame: { conn: number; id: number } | null = null;
let showLibrary = false;
/** Variables tree. Children are cached per childKey(range). Expansion is kept by row path (not by
 *  variablesReference, which adapters invalidate on every resume), so a step keeps the tree open. */
let scopes: { name: string; variablesReference: number; expensive: boolean }[] = [];
const children = new Map<string, ValueVariable[]>();
const expanded = new Set<string>();
const rowVars = new Map<string, ValueVariable>();
const ranges = new Map<string, ChildRange>();
/** Values shown at the previous stop of the same thread; rows that differ are marked "changed". */
let previous = new Map<string, string>();
let watches: string[] = [];
const watchValues = new Map<string, DebugVariable | { error: string }>();
let consoleLines: { kind: "in" | "out" | "err"; text: string }[] = [];
let history: string[] = [];
let breakpoints: Breakpoint[] = [];
let exceptions: ExceptionBreakpoints = { uncaught: true, caught: false };
let tab: "console" | "breakpoints" = "console";
let smartTargets: { id: number; label: string }[] | null = null;
let busy = false, error: string | null = null, epoch = 0, lastStop = "";

const call = <T = any>(ctx: ModuleContext, method: string, args: object = {}) => ctx.modules.call<T>("debug", method, { workspaceId, ...args }, { timeoutMs: 60000 });
const current = () => sessions.find(s => s.id === active) || sessions.find(s => s.state !== "ended") || sessions[sessions.length - 1] || null;

async function refresh(ctx: ModuleContext) {
  const s = current(), mine = ++epoch;
  if (s?.state !== "paused") { frame = null; scopes = []; children.clear(); ranges.clear(); }
  if (!s || s.state === "ended") { threads = []; frames = []; ctx.ui.invalidate(); return; }
  try {
    const nextThreads: DebugThread[] = await call(ctx, "threads", { id: s.id });
    if (mine !== epoch) return;
    threads = nextThreads;
    if (s.state === "paused" && s.stopped) {
      const stack: DebugFrame[] = await call(ctx, "stack", { id: s.id, conn: s.stopped.conn, threadId: s.stopped.threadId, levels: 60 });
      if (mine !== epoch) return;
      frames = stack;
      const key = `${s.id}:${s.stopped.conn}:${s.stopped.threadId}:${s.stopped.frameId}`;
      if (key !== lastStop || !frame) {
        // Compare against the last stop only when stepping the same thread; a new session or thread starts clean.
        const sameThread = lastStop.startsWith(`${s.id}:${s.stopped.conn}:${s.stopped.threadId}:`);
        previous = sameThread ? valueSnapshot(rowVars) : new Map();
        lastStop = key; frame = { conn: s.stopped.conn, id: s.stopped.frameId };
      }
      await loadFrame(ctx, s, mine);
    } else { frames = []; scopes = []; children.clear(); smartTargets = null; }
    if (mine === epoch) error = null;
  } catch (e) { if (mine === epoch) error = errMsg(e); }
  ctx.ui.invalidate();
}
async function loadFrame(ctx: ModuleContext, s: DebugSessionInfo, mine = ++epoch) {
  if (!frame) return;
  children.clear();
  ranges.clear();
  scopes = [];
  watchValues.clear();
  const nextScopes: typeof scopes = await call(ctx, "scopes", { id: s.id, conn: frame.conn, frameId: frame.id });
  if (mine !== epoch) return;
  scopes = nextScopes;
  // Non-expensive scopes (locals) open by default; globals stay collapsed.
  for (const sc of scopes) {
    if (mine !== epoch) return;
    const key = `scope:${sc.name}`;
    if (!sc.expensive) expanded.add(key);
    if (expanded.has(key)) await loadChildren(ctx, s, { variablesReference: sc.variablesReference }, mine);
  }
  await evaluateWatches(ctx, s, mine);
  await restoreExpanded(ctx, s, mine);
}
async function loadChildren(ctx: ModuleContext, s: DebugSessionInfo, range: ChildRange, mine = epoch) {
  const key = childKey(range);
  if (mine !== epoch || children.has(key) || !frame) return;
  const { variablesReference, start, count, filter } = range;
  const list = await call<ValueVariable[]>(ctx, "variables", { id: s.id, conn: frame.conn, variablesReference, ...(filter ? { filter } : {}),
    ...(start !== undefined ? { start, count } : {}) });
  if (mine === epoch) children.set(key, list);
}
/** Reopens expanded rows level by level after a stop: each pass renders (to learn the new
 *  references) and loads what is open but missing. Bounded so a cycle can't loop. */
async function restoreExpanded(ctx: ModuleContext, s: DebugSessionInfo, mine: number) {
  for (let pass = 0; pass < 8 && mine === epoch; pass++) {
    variablesTree();
    const missing = [...expanded].map(k => ranges.get(k)).filter((r): r is ChildRange => !!r && !children.has(childKey(r)));
    if (!missing.length) return;
    await Promise.all(missing.map(r => loadChildren(ctx, s, r, mine).catch(() => {
      if (mine === epoch) children.set(childKey(r), []);
    })));
  }
}
async function evaluateWatches(ctx: ModuleContext, s: DebugSessionInfo, mine = epoch) {
  if (mine !== epoch) return;
  watchValues.clear();
  for (const w of watches) {
    if (mine !== epoch) return;
    try {
      const result = await call<DebugVariable>(ctx, "evaluate", { id: s.id, conn: frame?.conn, frameId: frame?.id, expression: w, context: "watch" });
      if (mine === epoch) watchValues.set(w, result);
    } catch (e) { if (mine === epoch) watchValues.set(w, { error: errMsg(e) }); }
  }
}

// ---------- rows ----------
const treeOptions = () => ({
  children: (k: string) => children.get(k), expanded, ranges, vars: rowVars, previous,
  menu: (v: ValueVariable) => v.evaluateName ? [{ text: "Add to watches", action: "addWatch", value: v.evaluateName }] : [],
});
function variablesTree(): TreeRow[] {
  rowVars.clear(); ranges.clear();
  const rows: TreeRow[] = [];
  const o = treeOptions();
  for (const [i, w] of watches.entries()) {
    const r = watchValues.get(w);
    const ok = r && !("error" in r) ? r as ValueVariable : null;
    const key = `watch:${i}`;
    const d = ok ? describeValue(ok) : null;
    const childRange: ChildRange | null = ok?.variablesReference ? {
      variablesReference: ok.variablesReference,
      ...((ok.indexedVariables || 0) > VALUE_PAGE ? { filter: "named" as const } : {}),
    } : null;
    if (childRange) ranges.set(key, childRange);
    rows.push({ key, label: w, value: d ? d.summary : r && "error" in r ? r.error : "", valueColor: d ? d.color : "danger", badge: d?.badge,
      iconSvg: icons.watch, iconColor: ok ? "info" : "muted", tooltip: ok ? `${ok.type ? `${ok.type} ` : ""}${w}` : undefined,
      depth: 0, expandable: !!ok?.variablesReference, expanded: expanded.has(key), selected: false,
      contextMenu: [
        ...(ok ? [{ text: "Copy value", action: "", copyText: ok.value }] : []),
        { text: "Remove watch", action: "removeWatch", value: i },
      ] });
    if (ok && childRange && expanded.has(key)) valueTreeRows(childRange, key, 1, o, rows, ok.indexedVariables || 0);
  }
  for (const sc of scopes) {
    const key = `scope:${sc.name}`;
    ranges.set(key, { variablesReference: sc.variablesReference });
    rows.push({ key, label: sc.name, depth: 0, expandable: true, expanded: expanded.has(key), selected: false, weight: "semibold",
      tooltip: sc.expensive ? "Expanding this scope can be slow" : undefined });
    if (expanded.has(key)) valueTreeRows({ variablesReference: sc.variablesReference }, key, 1, o, rows);
  }
  return rows;
}
function frameTree(s: DebugSessionInfo): TreeRow[] {
  const rows: TreeRow[] = [];
  const ordered = [...threads].sort((a, b) => Number(b.stopped) - Number(a.stopped));
  for (const t of ordered.slice(0, 300)) {
    const stopped = s.stopped && s.stopped.conn === t.conn && s.stopped.threadId === t.id;
    rows.push({ key: `t:${t.conn}:${t.id}`, label: t.name, depth: 0, expandable: !!stopped, expanded: !!stopped, selected: false,
      iconSvg: stopped ? icons.paused : icons.thread, iconColor: stopped ? "warning" : "muted",
      badge: stopped ? (s.stopped!.reason === "breakpoint" ? "breakpoint" : s.stopped!.reason) : s.state === "paused" ? "suspended" : "running" });
    if (!stopped) continue;
    let hidden = 0;
    for (const f of frames) {
      if (f.library && !showLibrary) { hidden++; continue; }
      rows.push({ key: `f:${f.conn}:${f.id}`, label: f.name, value: f.source ? `${f.source}:${f.line + 1}` : "", depth: 1, expandable: false, expanded: false,
        selected: frame?.conn === f.conn && frame?.id === f.id, iconSvg: icons.frame, iconColor: f.library ? "muted" : "primary",
        tooltip: f.path ? `${f.path}:${f.line + 1}` : "No source available",
        contextMenu: s.supports.restartFrame ? [{ text: "Drop frame (restart from here)", action: "restartFrame", value: f.id }] : undefined });
    }
    if (hidden) rows.push({ key: "", label: `${hidden} library frame${hidden === 1 ? "" : "s"} hidden`, depth: 1, expandable: false, expanded: false, selected: false });
  }
  return rows;
}

// ---------- render ----------
const tool = (key: string, icon: string, action: string, tooltip: string, enabled: boolean, extra: object = {}): UiNode =>
  ({ type: "button", key, text: "", iconSvg: icon, iconSize: 15, action, variant: "ghost", small: true, width: 28, tooltip, disabled: !enabled || busy, style: { paddingX: 0, height: 26, radius: 6 }, ...extra });
function toolbar(s: DebugSessionInfo): UiNode {
  const paused = s.state === "paused", live = s.state !== "ended";
  const items: UiNode[] = [
    paused ? tool("resume", icons.resume, "continue", "Resume (continue to the next breakpoint)", true, { iconColor: "success" })
      : tool("pause", icons.pause, "pause", "Pause all threads", live && s.state === "running"),
    tool("over", icons.over, "stepOver", "Step over", paused),
    tool("into", icons.into, "stepInto", "Step into", paused),
  ];
  if (s.supports.stepInTargets) items.push(tool("smart", icons.smart, "smartStep", "Smart step into: choose the call to enter", paused));
  items.push(tool("out", icons.out, "stepOut", "Step out", paused));
  if (s.supports.restartFrame) items.push(tool("drop", icons.drop, "restartFrame", "Drop frame: restart the selected frame", paused && !!frame, { value: frame?.id }));
  items.push({ type: "column", key: "sep", width: 8, children: [] }, tool("stop", icons.stop, "stop", "Stop debugging", live, { iconColor: live ? "danger" : "muted" }));
  const status = s.state === "paused" && s.stopped
    ? `⏸ ${s.stopped.reason}${s.stopped.path ? ` · ${s.stopped.path.split("/").pop()}:${s.stopped.line + 1}` : ""}${s.stopped.description ? ` · ${s.stopped.description}` : ""}`
    : s.state === "running" ? "● Running" : s.state === "starting" ? "◌ Starting…" : "Ended";
  items.push({ type: "column", key: "gap", grow: true, children: [] },
    { type: "label", key: "status", text: status, size: "xs", color: s.state === "paused" ? "warning" : s.state === "running" ? "success" : "muted", tooltip: status });
  return { type: "row", key: "toolbar", gap: 2, align: "center", style: { paddingX: 6, paddingY: 2, borderBottom: 1, borderColor: "border" }, children: items };
}
function consoleView(s: DebugSessionInfo | null): UiNode {
  return { type: "column", key: "console", grow: true, gap: 4, children: [
    { type: "scroll", key: `lines:${consoleLines.length}`, grow: true, style: { paddingX: 6 }, children: consoleLines.length
      ? consoleLines.slice(-400).map((l, i): UiNode => ({ type: "label", key: `c${i}`, text: l.kind === "in" ? `› ${l.text}` : l.text, mono: true, wrap: true, selectable: true,
          color: l.kind === "err" ? "danger" : l.kind === "in" ? "muted" : "default", style: { fontSize: 12 } }))
      : [{ type: "label", key: "hint", text: s?.state === "paused" ? "Evaluate expressions in the selected frame." : "Pause the program to evaluate expressions.", size: "xs", color: "muted" }] },
    { type: "textInput", key: "repl", placeholder: s?.state === "paused" ? "Expression — Enter to evaluate" : "Available while paused", submitAction: "evaluate", disabled: s?.state !== "paused", style: { font: "mono" } },
  ] };
}
function breakpointsView(): UiNode {
  const rows: TreeRow[] = breakpoints.map(b => ({ key: b.id, label: `${b.path.split("/").pop()}:${b.line + 1}`, value: b.logMessage ? `log: ${b.logMessage}` : b.condition ? `if ${b.condition}` : b.hitCondition ? `hits ${b.hitCondition}` : b.path,
    depth: 0, expandable: false, expanded: false, selected: false, iconSvg: b.enabled ? icons.bp : icons.bpOff, iconColor: b.enabled ? "danger" : "muted", tooltip: b.path,
    contextMenu: [{ text: b.enabled ? "Disable" : "Enable", action: "bpEnable", value: !b.enabled }, { text: "Remove", action: "bpRemove" }] as MenuItem[] }));
  return { type: "column", key: "bps", grow: true, gap: 6, children: [
    { type: "row", key: "ex", gap: 12, align: "center", style: { paddingX: 6 }, children: [
      { type: "switch", key: "uncaught", label: "Pause on uncaught exceptions", checked: exceptions.uncaught, action: "exUncaught" },
      { type: "switch", key: "caught", label: "Caught exceptions", checked: exceptions.caught, action: "exCaught" },
    ] },
    rows.length ? { type: "tree", key: "bp-tree", rows, selectAction: "bpOpen", expandAction: "", rowHeight: 26, grow: true, activateAction: "bpOpen" }
      : { type: "label", key: "none", text: "No breakpoints. Click the editor gutter to add one; right-click for conditions and log messages.", size: "sm", color: "muted", wrap: true, padding: 6 },
    ...(breakpoints.length ? [{ type: "button", key: "clear", text: "Remove all", action: "bpRemoveAll", small: true, variant: "ghost", iconSvg: uiIcons.trash } as UiNode] : []),
  ] };
}

const mod: AppModule = {
  id: "debug-panel", moduleApiVersion: 1,
  async activate(ctx, previous) {
    const load = async () => {
      if (!workspaceId) return;
      const [saved, bps, list] = await Promise.all([
        ctx.modules.call("persistence", "settings.get", { key: `debug-panel.watches.${workspaceId}` }).catch(() => null),
        call(ctx, "breakpointsList").catch(() => null),
        call<DebugSessionInfo[]>(ctx, "sessions").catch(() => []),
      ]);
      watches = Array.isArray(saved) ? saved.filter((w: unknown) => typeof w === "string").slice(0, 50) : [];
      if (bps) { breakpoints = bps.breakpoints || []; exceptions = bps.exceptions || exceptions; }
      sessions = list || [];
      await refresh(ctx);
    };
    workspaceId = (ctx.state.get("workspace.selected") as any)?.id || null;
    if (previous?.workspaceId === workspaceId) { showLibrary = !!previous.showLibrary; tab = previous.tab === "breakpoints" ? "breakpoints" : "console"; consoleLines = previous.consoleLines || []; history = previous.history || []; }
    ctx.state.watch("workspace.selected", (v: any) => {
      if ((v?.id || null) === workspaceId) return;
      ++epoch;
      workspaceId = v?.id || null; sessions = []; active = null; frame = null; consoleLines = []; expanded.clear(); children.clear(); breakpoints = [];
      void load();
    });
    ctx.events.on(DEBUG_EVENTS.changed, (e: any) => {
      if (e?.workspaceId !== workspaceId) return;
      sessions = e.sessions || [];
      const paused = sessions.find(s => s.state === "paused");
      if (paused?.stopped && (!frame || `${paused.id}:${paused.stopped.conn}:${paused.stopped.threadId}:${paused.stopped.frameId}` !== lastStop)) { active = paused.id; ctx.events.emit("debug-panel.reveal", { workspaceId }); }
      void refresh(ctx);
    });
    // "Add to watches" from the editor's debug hover.
    ctx.events.on("viewer.debugAddWatch", (e: any) => {
      if (e?.workspaceId !== workspaceId || typeof e.expression !== "string") return;
      void mod.onEvent!(ctx, { action: "addWatch", key: "hover", value: e.expression, inputs: {} } as any);
    });
    ctx.events.on(DEBUG_EVENTS.breakpoints, (e: any) => { if (e?.workspaceId === workspaceId) { breakpoints = e.breakpoints || []; exceptions = e.exceptions || exceptions; ctx.ui.invalidate(); } });
    await load();
  },
  deactivate() { ++epoch; },
  snapshot: () => ({ workspaceId, showLibrary, tab, consoleLines: consoleLines.slice(-200), history: history.slice(-50) }),
  render(): UiNode {
    if (!workspaceId) return { type: "label", key: "none", text: "Open a project to debug it.", color: "muted", padding: 12 };
    const s = current();
    const right: UiNode = { type: "column", key: "right", grow: true, children: [
      { type: "tabStrip", key: "tabs", tabs: [{ key: "console", label: "Console" }, { key: "breakpoints", label: `Breakpoints${breakpoints.length ? ` (${breakpoints.length})` : ""}` }], active: tab, action: "tab" },
      tab === "console" ? consoleView(s) : breakpointsView(),
    ] };
    if (!s) return { type: "column", key: "idle", grow: true, children: [
      { type: "label", key: "hint", text: "Nothing is being debugged. Choose a configuration in the Run bar and press Debug, or use Debug in the editor gutter's ▶ menu.", size: "sm", color: "muted", wrap: true, padding: 10 },
      { type: "column", key: "bp", grow: true, children: [breakpointsView()] },
    ] };
    const sessionTabs: UiNode[] = sessions.length > 1 ? [{ type: "tabStrip", key: "sessions", active: s.id, action: "session",
      tabs: sessions.map(x => ({ key: x.id, label: x.name, iconSvg: x.state === "paused" ? icons.paused : icons.bug,
        iconColor: x.state === "paused" ? "warning" : x.state === "ended" ? "muted" : "success", tooltip: `${x.name} · ${x.state}` })) }] : [];
    const smart: UiNode[] = smartTargets ? [{ type: "popover", key: "smart", transition: anchoredMotion, width: 320, top: 40, left: 120, closeAction: "smartClose", style: { background: "panel", padding: 6, radius: 8, borderWidth: 1, borderColor: "border" },
      children: smartTargets.length ? [{ type: "label", key: "t", text: "Step into which call?", size: "xs", color: "muted" } as UiNode, ...smartTargets.map((t, i): UiNode =>
        ({ type: "button", key: `t${i}`, text: t.label, action: "smartInto", value: t.id, small: true, variant: "ghost", style: { justify: "start", fullWidth: true, font: "mono" } }))]
        : [{ type: "label", key: "none", text: "No calls on this line to step into.", size: "sm", color: "muted" }] }] : [];
    return { type: "column", key: "debug", grow: true, children: [
      ...sessionTabs, toolbar(s),
      ...(error ? [{ type: "status", key: "error", text: error, level: "error" } as UiNode] : []),
      { type: "split", key: "body", direction: "horizontal", sizes: [0.3, 0.38, 0.32], grow: true, resizable: true, children: [
        { type: "column", key: "frames", grow: true, children: [
          { type: "row", key: "fh", align: "center", style: { paddingX: 6, paddingY: 2 }, children: [
            { type: "label", key: "t", text: "Threads & frames", size: "xs", weight: "semibold", color: "muted", grow: true },
            { type: "button", key: "lib", text: showLibrary ? "Hide library" : "Show library", action: "toggleLibrary", small: true, variant: "ghost", tooltip: "Show or hide frames without project sources" },
          ] },
          { type: "tree", key: "frame-tree", rows: frameTree(s), selectAction: "selectFrame", expandAction: "", rowHeight: 24, grow: true, activateAction: "selectFrame" },
        ] },
        { type: "column", key: "vars", grow: true, children: [
          { type: "row", key: "vh", gap: 4, align: "center", style: { paddingX: 6, paddingY: 2 }, children: [
            { type: "label", key: "t", text: "Variables", size: "xs", weight: "semibold", color: "muted", grow: true },
          ] },
          { type: "textInput", key: "new-watch", placeholder: "+ Add watch expression", submitAction: "addWatch", prefixSvg: icons.watch, style: { font: "mono" } },
          s.state === "paused"
            ? { type: "tree", key: "var-tree", rows: variablesTree(), selectAction: "noop", expandAction: "expandVar", rowHeight: 22, grow: true, indent: 14 }
            : { type: "label", key: "running", text: s.state === "ended" ? "The session has ended." : "Variables appear when the program pauses.", size: "sm", color: "muted", padding: 8 },
        ] },
        right,
      ] },
      ...smart,
    ] };
  },
  async onEvent(ctx, ev) {
    const s = current();
    const v: any = ev.value;
    try {
      switch (ev.action) {
        case "tab": tab = ev.value === "breakpoints" ? "breakpoints" : "console"; break;
        case "session": active = String(ev.value); frame = null; await refresh(ctx); return;
        case "toggleLibrary": showLibrary = !showLibrary; break;
        case "continue": case "pause": case "stepOver": case "stepInto": case "stepOut": case "stop":
          if (!s) return;
          busy = true; ctx.ui.invalidate();
          await call(ctx, ev.action, { id: s.id, ...(s.stopped ? { conn: s.stopped.conn, threadId: s.stopped.threadId } : {}) });
          break;
        case "restartFrame": if (s) await call(ctx, "restartFrame", { id: s.id, conn: frame?.conn, frameId: Number.isInteger(v) ? v : frame?.id }); break;
        case "smartStep": if (s) smartTargets = await call(ctx, "stepInTargets", { id: s.id, conn: frame?.conn, frameId: frame?.id }); break;
        case "smartClose": smartTargets = null; break;
        case "smartInto": smartTargets = null; if (s?.stopped) await call(ctx, "stepInto", { id: s.id, conn: s.stopped.conn, threadId: s.stopped.threadId, targetId: Number(v) }); break;
        case "selectFrame": {
          const m = /^f:(\d+):(\d+)$/.exec(ev.rowKey || "");
          if (!m || !s) return;
          frame = { conn: Number(m[1]), id: Number(m[2]) };
          const f = frames.find(x => x.conn === frame!.conn && x.id === frame!.id);
          if (f) ctx.events.emit(DEBUG_UI_EVENTS.focusFrame, { workspaceId, id: s.id, conn: f.conn, frameId: f.id, path: f.path, line: f.line });
          await loadFrame(ctx, s);
          break;
        }
        case "expandVar": {
          const key = ev.rowKey || "";
          if (expanded.has(key)) { expanded.delete(key); break; }
          expanded.add(key);
          const range = ranges.get(key);
          if (s && range) { ctx.ui.invalidate(); await loadChildren(ctx, s, range); }
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
          history = [...history.filter(h => h !== expr), expr].slice(-50);
          consoleLines.push({ kind: "in", text: expr });
          try {
            const r: DebugVariable = await call(ctx, "evaluate", { id: s.id, conn: frame?.conn, frameId: frame?.id, expression: expr, context: "repl" });
            consoleLines.push({ kind: "out", text: `${r.value}${r.type ? `  (${r.type})` : ""}` });
          } catch (e) { consoleLines.push({ kind: "err", text: errMsg(e) }); }
          consoleLines = consoleLines.slice(-1000);
          await refresh(ctx); // evaluation may have changed state
          return;
        }
        case "exUncaught": await call(ctx, "exceptionsSet", { uncaught: !!v }); break;
        case "exCaught": await call(ctx, "exceptionsSet", { caught: !!v }); break;
        case "bpOpen": {
          const b = breakpoints.find(x => x.id === ev.rowKey);
          if (b) ctx.events.emit(DEBUG_UI_EVENTS.focusFrame, { workspaceId, path: b.path, line: b.line });
          break;
        }
        case "bpEnable": if (ev.rowKey) { const b = breakpoints.find(x => x.id === ev.rowKey); if (b) await call(ctx, "breakpointsSet", { breakpointId: b.id, path: b.path, line: b.line, enabled: !!v }); } break;
        case "bpRemove": if (ev.rowKey) await call(ctx, "breakpointsRemove", { breakpointId: ev.rowKey }); break;
        case "bpRemoveAll": await call(ctx, "breakpointsRemove", { all: true }); break;
      }
      error = null;
    } catch (e) { error = errMsg(e); }
    finally { busy = false; }
    ctx.ui.invalidate();
  },
};
export default mod;
