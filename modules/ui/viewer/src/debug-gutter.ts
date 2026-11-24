// Debugger presentation in the editor: breakpoints in the line-number column, the
// paused line (arrow + full-line tint), inline variable values and the breakpoint editor popover.
// State lives in the `debug` service; this file only mirrors and presents it.
import type { ModuleContext, UiNode, WindowAnchor } from "@hato/sdk/types";
import { childKey, describeValue, VALUE_PAGE, valueTreeRows, type ChildRange, type ValueVariable } from "@hato/sdk/debug-values";
import { DEBUG_EVENTS, debugExpressionAt, inlineValues, type Breakpoint, type DebugSessionInfo, type DebugVariable } from "@hato/sdk/debug";
import { errMsg } from "@hato/sdk/runtime";
import { anchoredMotion } from "@hato/sdk/motion";

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${body}</svg>`;
// Shapes differ by kind so state never depends on color alone.
const icons = {
  breakpoint: svg("<circle cx='12' cy='12' r='7' fill='currentColor'/>"),
  conditional: svg("<circle cx='12' cy='12' r='7.5' fill='currentColor'/><path d='M9.8 10a2.3 2.3 0 1 1 3.2 2.1c-.7.3-1 .8-1 1.5M12 16.3v.2' stroke='white' stroke-width='1.8' fill='none' stroke-linecap='round'/>"),
  logpoint: svg("<path d='M12 4.5 19.5 12 12 19.5 4.5 12z' fill='currentColor'/>"),
  disabled: svg("<circle cx='12' cy='12' r='6.5' fill='none' stroke='currentColor' stroke-width='2'/>"),
  unverified: svg("<circle cx='12' cy='12' r='6.5' fill='none' stroke='currentColor' stroke-width='2' stroke-dasharray='3 2.4'/>"),
  paused: svg("<path d='M4 8.5h8V4.5l8 7.5-8 7.5v-4H4z' fill='currentColor'/>"),
};
const runIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="m7 4 14 8-14 8z"/></svg>';

let workspaceId: string | null = null;
let breakpoints: Breakpoint[] = [];
let breakpointVersion = 0;
let sessionVersion = 0;
let workspaceLoad = 0;
const pendingToggles = new Map<string, { breakpoint: Breakpoint | null; done: Promise<void> }>();
let sessions: DebugSessionInfo[] = [];
let inline: { key: string; path: string; line: number; text: string } | null = null;
let lastStop = "";
export let debugAvailable = false;
export let debugTypes: string[] = [];
/** Breakpoint editor anchored at the clicked gutter row. */
export let bpEditor: { path: string; line: number; y: number; runLine: boolean; anchor?: WindowAnchor } | null = null;
let bpError = "";

export type GutterValue = { kind: "run" | "bp" | "paused"; line: number; id?: string };
interface Hooks { invalidate(): void; currentText(path: string): string | null; reveal(path: string, line: number): void }
let hooks: Hooks;

export function initDebug(ctx: ModuleContext, h: Hooks) {
  hooks = h;
  ctx.events.on("debug-panel.focusFrame", (e: any) => {
    // The panel's selected frame scopes hover evaluation (a frame without an id is a breakpoint jump).
    if (e?.workspaceId === workspaceId && Number.isInteger(e.frameId) && typeof e.id === "string") {
      const next = { id: e.id, conn: e.conn, frameId: e.frameId, path: typeof e.path === "string" ? e.path : null };
      if (!focusedFrame || next.id !== focusedFrame.id || next.conn !== focusedFrame.conn || next.frameId !== focusedFrame.frameId) closeHover();
      focusedFrame = next;
      hooks.invalidate();
    }
    if (e?.workspaceId === workspaceId && typeof e.path === "string" && !e.path.startsWith("/") && Number.isInteger(e.line)) hooks.reveal(e.path, e.line);
  });
  ctx.events.on(DEBUG_EVENTS.breakpoints, (e: any) => { if (e?.workspaceId === workspaceId) { breakpoints = e.breakpoints || []; breakpointVersion++; debugAvailable = true; hooks.invalidate(); } });
  ctx.events.on(DEBUG_EVENTS.changed, (e: any) => {
    if (e?.workspaceId !== workspaceId) return;
    sessions = e.sessions || []; sessionVersion++; debugAvailable = true;
    const paused = sessions.find(s => s.stopped);
    const key = paused?.stopped ? `${paused.id}:${paused.stopped.conn}:${paused.stopped.threadId}:${paused.stopped.frameId}` : "";
    if (key && key !== lastStop && paused!.stopped!.path && !paused!.stopped!.path.startsWith("/")) hooks.reveal(paused!.stopped!.path, paused!.stopped!.line);
    if (key !== lastStop) { focusedFrame = null; closeHover(); }
    lastStop = key;
    void refreshInline(ctx);
    hooks.invalidate();
  });
}
export async function loadDebug(ctx: ModuleContext, id: string | null) {
  workspaceId = id; breakpoints = []; sessions = []; inline = null; bpEditor = null; lastStop = "";
  focusedFrame = null;
  closeHover();
  debugAvailable = false; debugTypes = [];
  const load = ++workspaceLoad;
  if (!id) return;
  const version = breakpointVersion, liveVersion = sessionVersion;
  try {
    const [list, live, caps] = await Promise.all([
      ctx.modules.call("debug", "breakpointsList", { workspaceId: id }),
      ctx.modules.call("debug", "sessions", { workspaceId: id }),
      ctx.modules.call("debug", "capabilities", { workspaceId: id }),
    ]);
    if (load !== workspaceLoad) return;
    if (version === breakpointVersion) breakpoints = list?.breakpoints || [];
    if (liveVersion === sessionVersion) sessions = live || [];
    debugAvailable = !!caps?.debug; debugTypes = caps?.debugTypes || [];
  } catch { if (load !== workspaceLoad) return; }
  hooks.invalidate();
}

/** Locals of the paused frame whose names appear on its line, painted after the line. */
async function refreshInline(ctx: ModuleContext) {
  const s = sessions.find(x => x.stopped?.path);
  if (!s?.stopped?.path || !workspaceId) { inline = null; return; }
  const st = s.stopped, key = `${s.id}:${st.conn}:${st.frameId}`;
  if (inline?.key === key) return;
  const text = hooks.currentText(st.path!);
  if (text === null) { inline = null; return; }
  try {
    const scopes: { name: string; variablesReference: number; expensive: boolean }[] = await ctx.modules.call("debug", "scopes", { workspaceId, id: s.id, conn: st.conn, frameId: st.frameId });
    const scope = scopes.find(x => !x.expensive && x.variablesReference > 0);
    const vars: DebugVariable[] = scope ? await ctx.modules.call("debug", "variables", { workspaceId, id: s.id, conn: st.conn, variablesReference: scope.variablesReference }) : [];
    const lineText = text.split("\n")[st.line] || "";
    const value = inlineValues(lineText, vars);
    inline = value ? { key, path: st.path!, line: st.line, text: value } : null;
  } catch { inline = null; }
  hooks.invalidate();
}

/** codeViewer fields for `path`: gutter markers (breakpoints win over run markers on the same line),
 *  the paused line and inline values. */
export function debugEditorFields(path: string | null, runLines: number[], annotations: { line: number; text: string }[] | undefined) {
  if (!path) return { gutterMarkers: [], lineHighlights: [], lineAnnotations: annotations };
  const markers = new Map<number, { line: number; iconSvg: string; color: string; value: GutterValue }>();
  for (const line of runLines) markers.set(line, { line, iconSvg: runIcon, color: "success", value: { kind: "run", line } });
  const status = new Map(sessions.flatMap(s => s.breakpoints).map(b => [b.id, b]));
  const live = sessions.some(s => s.state !== "ended");
  const visible = new Map(breakpoints.filter(b => b.path === path).map(b => [b.line, b]));
  const prefix = toggleKey(workspaceId, path);
  for (const [key, pending] of pendingToggles) {
    if (!key.startsWith(prefix)) continue;
    const line = Number(key.slice(prefix.length));
    if (pending.breakpoint) visible.set(line, pending.breakpoint);
    else visible.delete(line);
  }
  for (const b of visible.values()) {
    const st = status.get(b.id);
    const unverified = live && b.enabled && st && !st.verified;
    const icon = !b.enabled ? icons.disabled : unverified ? icons.unverified : b.logMessage ? icons.logpoint : b.condition || b.hitCondition ? icons.conditional : icons.breakpoint;
    markers.set(b.line, { line: b.line, iconSvg: icon, color: !b.enabled || unverified ? "muted" : b.logMessage ? "warning" : "danger", value: { kind: "bp", line: b.line, id: b.id } });
  }
  const paused = sessions.find(s => s.stopped?.path === path)?.stopped;
  if (paused) markers.set(paused.line, { line: paused.line, iconSvg: icons.paused, color: "warning", value: { kind: "paused", line: paused.line, id: markers.get(paused.line)?.value.id } });
  const lineAnnotations = inline && inline.path === path
    ? [...(annotations || []).filter(a => a.line !== inline!.line), { line: inline.line, text: inline.text, color: "info" }] : annotations;
  return {
    gutterMarkers: [...markers.values()],
    gutterHoverIconSvg: debugAvailable ? icons.breakpoint : undefined,
    lineHighlights: paused ? [{ line: paused.line, color: "warning", opacity: 0.2 }] : [],
    lineAnnotations,
  };
}
export const gutterTooltip = () => debugAvailable ? "Click to toggle a breakpoint · right-click for conditions and log messages" : "Run configuration actions";
export function hasRunMarker(value: unknown): value is GutterValue { return !!value && typeof value === "object" && (value as GutterValue).kind === "run"; }

function toggleKey(id: string | null, path: string) { return JSON.stringify([id, path]) + ":"; }

export async function toggleBreakpoint(ctx: ModuleContext, path: string, line: number) {
  const id = workspaceId;
  if (!id || !debugAvailable) return;
  const key = toggleKey(id, path) + line;
  const prior = pendingToggles.get(key);
  const exists = prior ? !!prior.breakpoint : breakpoints.some(b => b.path === path && b.line === line);
  const breakpoint = exists ? null : { id: "pending", path, line, enabled: true };

  // Queue clicks on this line. While requests are in flight the latest click owns its display.
  const done = (prior?.done ?? Promise.resolve()).then(async () => {
    try {
      await ctx.modules.call("debug", breakpoint ? "breakpointsSet" : "breakpointsRemove", { workspaceId: id, path, line });
      if (workspaceId !== id || pendingToggles.get(key)?.done !== done) return;
      const version = breakpointVersion;
      const list = await ctx.modules.call("debug", "breakpointsList", { workspaceId: id });
      if (workspaceId === id && version === breakpointVersion) breakpoints = list.breakpoints;
    } catch (e) {
      if (workspaceId === id) bpError = errMsg(e);
    } finally {
      if (pendingToggles.get(key)?.done === done) pendingToggles.delete(key);
      if (workspaceId === id) hooks.invalidate();
    }
  });
  pendingToggles.set(key, { breakpoint, done });
  hooks.invalidate();
  await done;
}
export function openEditor(path: string, line: number, y: number, runLine: boolean, anchor?: WindowAnchor) { bpEditor = { path, line, y, runLine, anchor }; bpError = ""; hooks.invalidate(); }

export async function editorEvent(ctx: ModuleContext, action: string, value: unknown, inputs: Record<string, string>): Promise<boolean> {
  if (!action.startsWith("bp") || !workspaceId) return false;
  const ed = bpEditor;
  const existing = ed ? breakpoints.find(b => b.path === ed.path && b.line === ed.line) : undefined;
  try {
    if (action === "bpClose") bpEditor = null;
    else if (ed && action === "bpSave") {
      await ctx.modules.call("debug", "breakpointsSet", { workspaceId, path: ed.path, line: ed.line, enabled: existing?.enabled ?? true,
        condition: inputs["bp-condition"] ?? existing?.condition ?? "", hitCondition: inputs["bp-hit"] ?? existing?.hitCondition ?? "", logMessage: inputs["bp-log"] ?? existing?.logMessage ?? "" });
      bpEditor = null;
    } else if (ed && action === "bpEnabled") await ctx.modules.call("debug", "breakpointsSet", { workspaceId, path: ed.path, line: ed.line, enabled: !!value });
    else if (ed && action === "bpRemove") { if (existing) await ctx.modules.call("debug", "breakpointsRemove", { workspaceId, breakpointId: existing.id }); bpEditor = null; }
    else if (ed && action === "bpRunTo") {
      const s = sessions.find(x => x.state === "paused");
      if (s) await ctx.modules.call("debug", "runToLine", { workspaceId, id: s.id, path: ed.path, line: ed.line });
      bpEditor = null;
    }
    bpError = "";
  } catch (e) { bpError = errMsg(e); }
  hooks.invalidate();
  return true;
}

/** Popover to edit the breakpoint on the right-clicked line (created on save if absent). */
export function editorPopover(path: string | null, runMenu: UiNode[]): UiNode | null {
  const ed = bpEditor;
  if (!ed || ed.path !== path) return null;
  const b = breakpoints.find(x => x.path === ed.path && x.line === ed.line);
  const paused = sessions.some(s => s.state === "paused");
  const input = (key: string, label: string, value: string | undefined, placeholder: string, tooltip: string): UiNode => ({ type: "column", key: `${key}-field`, gap: 3, children: [
    { type: "label", key: "label", text: label, size: "xs", weight: "medium", tooltip },
    { type: "textInput", key, value: value || "", placeholder, submitAction: "bpSave", cancelAction: "bpClose", style: { font: "mono" } },
  ] });
  return { type: "popover", key: "bp-editor", transition: anchoredMotion, width: 340, windowAnchor: ed.anchor, top: Math.max(36, ed.y + 54), left: 24, closeAction: "bpClose",
    style: { background: "panel", padding: 10, radius: 8, borderWidth: 1, borderColor: "border", shadow: "md" }, children: [
      { type: "row", key: "head", gap: 6, align: "center", children: [
        { type: "label", key: "title", text: `${b ? "Breakpoint" : "New breakpoint"} · line ${ed.line + 1}`, weight: "semibold", size: "sm", grow: true },
        ...(b ? [{ type: "switch", key: "enabled", label: "Enabled", checked: b.enabled, action: "bpEnabled" } as UiNode] : []),
      ] },
      input("bp-condition", "Condition", b?.condition, "e.g. count > 10", "Pause only when this expression is true"),
      input("bp-hit", "Hit count", b?.hitCondition, "e.g. 5 or >= 5", "Pause when the hit count matches"),
      input("bp-log", "Log message", b?.logMessage, "e.g. total = {total}", "Log instead of pausing; {expression} is interpolated"),
      ...(bpError ? [{ type: "status", key: "error", text: bpError, level: "error" } as UiNode] : []),
      { type: "row", key: "actions", gap: 6, align: "center", children: [
        ...(paused ? [{ type: "button", key: "run-to", text: "Run to line", action: "bpRunTo", small: true, variant: "ghost", tooltip: "Continue until this line" } as UiNode] : []),
        ...(b ? [{ type: "button", key: "remove", text: "Remove", action: "bpRemove", small: true, variant: "ghost", style: { color: "danger" } } as UiNode] : []),
        { type: "column", key: "space", grow: true, children: [] },
        { type: "button", key: "cancel", text: "Cancel", action: "bpClose", small: true, variant: "ghost" },
        { type: "button", key: "save", text: b ? "Save" : "Add breakpoint", action: "bpSave", small: true, variant: "primary" },
      ] },
      ...(ed.runLine && runMenu.length ? [{ type: "divider", key: "run-divider" } as UiNode, ...runMenu] : []),
    ] };
}

// ---------- debug hover ----------
// While paused, hovering an identifier or member chain in the paused frame's file evaluates it and
// shows an interactive value popover (header + the same field tree as the Variables panel).

let focusedFrame: { id: string; conn: number; frameId: number; path: string | null } | null = null;
interface HoverState {
  requestId: number; path: string; expression: string;
  frame: { id: string; conn: number; frameId: number };
  result: ValueVariable;
}
let hover: HoverState | null = null;
let pendingHover: number | null = null;
const hoverChildren = new Map<string, ValueVariable[]>();
const hoverExpanded = new Set<string>();
const hoverRanges = new Map<string, ChildRange>();
const KEYWORDS = new Set(["if", "else", "for", "while", "do", "return", "new", "const", "let", "var", "function", "class", "import", "export", "from",
  "public", "private", "protected", "static", "final", "void", "try", "catch", "finally", "throw", "throws", "switch", "case", "default", "break",
  "continue", "async", "await", "typeof", "instanceof", "in", "of", "extends", "implements", "interface", "package", "enum", "true", "false", "null", "undefined"]);

function closeHover() { pendingHover = null; hover = null; hoverChildren.clear(); hoverExpanded.clear(); hoverRanges.clear(); }

/** The frame hover evaluates in: the panel's selected frame if it's in `path`, else the stopped frame there. */
function hoverFrame(path: string) {
  if (focusedFrame?.path === path && sessions.some(s => s.id === focusedFrame?.id && s.state === "paused")) return focusedFrame;
  const s = sessions.find(x => x.state === "paused" && x.stopped?.path === path);
  return s?.stopped ? { id: s.id, conn: s.stopped.conn, frameId: s.stopped.frameId } : null;
}

/** codeViewer hover fields: interactive debug hover only while paused in this file; otherwise the
 *  editor keeps its normal LSP hover. */
export function debugHoverFields(path: string | null) {
  if (!path || !hoverFrame(path)) return {};
  const node = hover && hover.path === path ? hoverNode(hover) : null;
  return { hoverAction: "debugHover", hoverDismissAction: "debugHoverDismiss", ...(node && hover ? { hoverPopover: { requestId: hover.requestId, node } } : {}) };
}

/** Trims a member chain at the hovered segment: hovering `b` in `a.b.c` evaluates `a.b`. */
function expressionAt(text: string, offset: number): string | null {
  const hit = debugExpressionAt(text, offset);
  if (!hit) return null;
  const rest = text.slice(offset, hit.end);
  const segmentEnd = offset + (/^[$\u200c\u200d\p{ID_Continue}]*/u.exec(rest)?.[0].length ?? 0);
  const expr = text.slice(hit.start, segmentEnd).replace(/\s+/g, "");
  const last = expr.split(".").pop() || "";
  if (!expr || KEYWORDS.has(last) || /^\d/.test(last)) return null;
  return expr;
}

export async function hoverEvent(ctx: ModuleContext, action: string, value: any, path: string | null): Promise<boolean> {
  if (!action.startsWith("debugHover")) return false;
  if (action === "debugHoverDismiss") {
    if (value?.requestId === pendingHover || value?.requestId === hover?.requestId) {
      closeHover();
      hooks.invalidate();
    }
    return true;
  }
  if (action === "debugHover") {
    const frame = path ? hoverFrame(path) : null;
    const text = path ? hooks.currentText(path) : null;
    const expression = text !== null && Number.isInteger(value?.offset) ? expressionAt(text, value.offset) : null;
    if (!frame || !path || !expression || !workspaceId || !Number.isSafeInteger(value?.requestId)) return true;
    const requestId: number = value.requestId;
    closeHover();
    pendingHover = requestId;
    try {
      const result: ValueVariable = await ctx.modules.call("debug", "evaluate", { workspaceId, id: frame.id, conn: frame.conn, frameId: frame.frameId, expression, context: "hover" });
      // Unknown names come back as errors; stay silent, like a hover over plain text.
      if (pendingHover !== requestId || !result || typeof result.value !== "string") return true;
      pendingHover = null;
      hover = { requestId, path, expression, frame, result };
      if (result.variablesReference > 0) {
        hoverExpanded.add("hover");
        hooks.invalidate();
        await loadHoverChildren(ctx, hoverRange(result));
      }
    } catch { /* Unknown expressions have no hover. */ }
    finally { if (pendingHover === requestId) pendingHover = null; }
    hooks.invalidate();
    return true;
  }
  if (!hover || hover.path !== path) return true;
  if (action === "debugHoverExpand") {
    const key = value?.rowKey;
    const range = typeof key === "string" ? hoverRanges.get(key) : undefined;
    if (!range) return true;
    if (hoverExpanded.has(key)) hoverExpanded.delete(key);
    else {
      hoverExpanded.add(key);
      hooks.invalidate();
      await loadHoverChildren(ctx, range);
    }
  } else if (action === "debugHoverWatch") {
    ctx.events.emit("viewer.debugAddWatch", { workspaceId, expression: typeof value === "string" && value ? value : hover.expression });
  }
  hooks.invalidate();
  return true;
}

const hoverRange = (v: ValueVariable): ChildRange => ({ variablesReference: v.variablesReference, ...((v.indexedVariables || 0) > VALUE_PAGE ? { filter: "named" as const } : {}) });
async function loadHoverChildren(ctx: ModuleContext, range: ChildRange) {
  const h = hover;
  if (!h || hoverChildren.has(childKey(range))) return;
  const { variablesReference, start, count, filter } = range;
  const list: ValueVariable[] = await ctx.modules.call("debug", "variables", { workspaceId, id: h.frame.id, conn: h.frame.conn, variablesReference,
    ...(filter ? { filter } : {}), ...(start !== undefined ? { start, count } : {}) }).catch(() => []);
  if (hover === h) hoverChildren.set(childKey(range), list || []);
}

const ROW = 22, ROW_GAP = 0, HOVER_WIDTH = 360, TREE_MAX = 236; // card stays within 360×320
function hoverNode(h: HoverState): UiNode {
  const v = h.result, d = describeValue(v);
  hoverRanges.clear();
  const rows = v.variablesReference > 0 && hoverExpanded.has("hover")
    ? valueTreeRows(hoverRange(v), "hover", 0, {
        children: k => hoverChildren.get(k), expanded: hoverExpanded, ranges: hoverRanges, maxRows: 500,
        menu: x => x.evaluateName ? [{ text: "Add to watches", action: "debugHoverWatch", value: x.evaluateName }] : [],
      }, [], v.indexedVariables || 0)
    : [];
  return { type: "column", key: "debug-hover", width: HOVER_WIDTH, gap: 4,
    style: { background: "panel", padding: 8, radius: 8, borderWidth: 1, borderColor: "border", shadow: "md" }, children: [
      { type: "row", key: "head", gap: 6, align: "center", children: [
        { type: "label", key: "expr", text: h.expression, mono: true, weight: "semibold", size: "sm", selectable: true, style: { noShrink: true } } as UiNode,
        ...(d.badge ? [{ type: "label", key: "type", text: d.badge, size: "xs", color: "muted", tooltip: v.type } as UiNode] : []),
        { type: "column", key: "space", grow: true, children: [] },
        ...(v.evaluateName || h.expression ? [{ type: "button", key: "watch", text: "", iconSvg: WATCH_ICON, iconSize: 14, action: "debugHoverWatch", value: h.expression,
          variant: "ghost", small: true, width: 24, tooltip: "Add to watches" } as UiNode] : []),
        { type: "button", key: "copy", text: "", iconSvg: COPY_ICON, iconSize: 14, action: "", copyText: v.value, variant: "ghost", small: true, width: 24, tooltip: "Copy value" } as UiNode,
      ] },
      { type: "label", key: "value", text: d.kind === "object" && rows.length ? d.summary : d.kind === "string" && d.truncated ? v.value : d.summary,
        mono: true, wrap: true, selectable: true, color: d.color, size: "sm", maxHeight: d.kind === "string" ? 120 : undefined } as UiNode,
      ...(rows.length ? [{ type: "tree", key: "fields", rows, selectAction: "", expandAction: "debugHoverExpand", rowHeight: ROW, rowGap: ROW_GAP, indent: 14,
        height: Math.min(TREE_MAX, rows.length * (ROW + ROW_GAP)) } as UiNode] : []),
    ] };
}
const WATCH_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const COPY_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>';
