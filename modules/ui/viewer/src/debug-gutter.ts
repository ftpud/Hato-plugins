// Debugger presentation in the editor: breakpoints in the gutter lane (shared with run markers), the
// paused line (arrow + full-line tint), inline variable values and the breakpoint editor popover.
// State lives in the `debug` service; this file only mirrors and presents it.
import type { ModuleContext, UiNode } from "@hato/sdk/types";
import { DEBUG_EVENTS, inlineValues, type Breakpoint, type DebugSessionInfo, type DebugVariable } from "@hato/sdk/debug";
import { errMsg } from "@hato/sdk/runtime";

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
let sessions: DebugSessionInfo[] = [];
let inline: { key: string; path: string; line: number; text: string } | null = null;
let lastStop = "";
export let debugAvailable = false;
export let debugTypes: string[] = [];
/** Breakpoint editor anchored at the clicked gutter row. */
export let bpEditor: { path: string; line: number; y: number; runLine: boolean } | null = null;
let bpError = "";

export type GutterValue = { kind: "run" | "bp" | "paused"; line: number; id?: string };
interface Hooks { invalidate(): void; currentText(path: string): string | null; reveal(path: string, line: number): void }
let hooks: Hooks;

export function initDebug(ctx: ModuleContext, h: Hooks) {
  hooks = h;
  ctx.events.on("debug-panel.focusFrame", (e: any) => {
    if (e?.workspaceId === workspaceId && typeof e.path === "string" && !e.path.startsWith("/") && Number.isInteger(e.line)) hooks.reveal(e.path, e.line);
  });
  ctx.events.on(DEBUG_EVENTS.breakpoints, (e: any) => { if (e?.workspaceId === workspaceId) { breakpoints = e.breakpoints || []; debugAvailable = true; hooks.invalidate(); } });
  ctx.events.on(DEBUG_EVENTS.changed, (e: any) => {
    if (e?.workspaceId !== workspaceId) return;
    sessions = e.sessions || []; debugAvailable = true;
    const paused = sessions.find(s => s.stopped);
    const key = paused?.stopped ? `${paused.id}:${paused.stopped.conn}:${paused.stopped.threadId}:${paused.stopped.frameId}` : "";
    if (key && key !== lastStop && paused!.stopped!.path && !paused!.stopped!.path.startsWith("/")) hooks.reveal(paused!.stopped!.path, paused!.stopped!.line);
    lastStop = key;
    void refreshInline(ctx);
    hooks.invalidate();
  });
}
export async function loadDebug(ctx: ModuleContext, id: string | null) {
  workspaceId = id; breakpoints = []; sessions = []; inline = null; bpEditor = null; lastStop = "";
  if (!id) return;
  try {
    const [list, live, caps] = await Promise.all([
      ctx.modules.call("debug", "breakpointsList", { workspaceId: id }),
      ctx.modules.call("debug", "sessions", { workspaceId: id }),
      ctx.modules.call("debug", "capabilities", { workspaceId: id }),
    ]);
    if (workspaceId !== id) return;
    breakpoints = list?.breakpoints || []; sessions = live || []; debugAvailable = !!caps?.debug; debugTypes = caps?.debugTypes || [];
  } catch { debugAvailable = false; debugTypes = []; }
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
    const vars: DebugVariable[] = scope ? await ctx.modules.call("debug", "variables", { workspaceId, id: s.id, conn: st.conn, variablesReference: scope.variablesReference, count: 200 }) : [];
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
  for (const b of breakpoints) {
    if (b.path !== path) continue;
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
    lineHighlights: paused ? [{ line: paused.line, color: "warning", opacity: 0.2 }] : [],
    lineAnnotations,
  };
}
export const gutterTooltip = () => debugAvailable ? "Click to toggle a breakpoint · right-click for conditions and log messages" : "Run configuration actions";
export function hasRunMarker(value: unknown): value is GutterValue { return !!value && typeof value === "object" && (value as GutterValue).kind === "run"; }

export async function toggleBreakpoint(ctx: ModuleContext, path: string, line: number) {
  if (!workspaceId || !debugAvailable) return;
  try {
    await ctx.modules.call("debug", "breakpointsToggle", { workspaceId, path, line });
    // Events refresh the list; keep the UI responsive even when the event arrives late.
    const at = breakpoints.findIndex(b => b.path === path && b.line === line);
    if (at >= 0) breakpoints.splice(at, 1); else breakpoints.push({ id: "pending", path, line, enabled: true });
  } catch (e) { bpError = errMsg(e); }
  hooks.invalidate();
}
export function openEditor(path: string, line: number, y: number, runLine: boolean) { bpEditor = { path, line, y, runLine }; bpError = ""; hooks.invalidate(); }

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
  return { type: "popover", key: "bp-editor", width: 340, top: Math.max(36, ed.y + 54), left: 24, closeAction: "bpClose",
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
