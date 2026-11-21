// Run panel: one tab per run session with ANSI-colored output, clickable stack frames and an exit footer.
// Sessions and output come from the `run` service (sdk/run.ts); this module only presents them.
import type { AppModule, MenuItem, ModuleContext, UiNode } from "@hato/sdk/types";
import { RUN_EVENTS, RUN_UI_EVENTS, findLocations, runActive, type RunOutput, type RunSession } from "@hato/sdk/run";
import { filterInput } from "@hato/sdk/filter-style";
import { errMsg } from "@hato/sdk/runtime";
import { uiIcons } from "@hato/sdk/ui-icons";

const svg = (body: string, fill = false) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${fill ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const icons = {
  stop: svg("<rect x='6' y='6' width='12' height='12' rx='1.5'/>", true),
  restart: svg("<path d='M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5'/>"),
  follow: svg("<path d='M12 4v14m-6-6 6 6 6-6M5 21h14'/>"),
  wrap: svg("<path d='M3 6h18M3 12h15a3 3 0 0 1 0 6h-4m2-2-2 2 2 2M3 18h7'/>"),
};

const MAX_LINES = 20000, LINE_HEIGHT = 18;
interface Segment { text: string; color?: string; bold?: boolean; link?: number }
interface Line { stream: "stdout" | "stderr" | "system"; segments: Segment[]; plain: string; links: { suffix?: string; path?: string; line: number; character?: number }[] }
interface Console { lines: Line[]; next: number; partial: { stream: Line["stream"]; text: string } | null; truncated: boolean; loading: boolean; dirty: boolean }

let workspaceId: string | null = null;
let sessions: RunSession[] = [];
let consoles = new Map<string, Console>();
let active: string | null = null;
let filter = "", follow = true, wrap = false, error: string | null = null;
let epoch = 0, ticker: ReturnType<typeof setInterval> | null = null;

// ANSI SGR → theme colors. Bright variants share the base hue; 256/truecolor fall back to default.
const ANSI = ["text", "danger", "success", "warning", "info", "#b887ce", "#3fb9c6", "text"];
function parseLine(stream: Line["stream"], raw: string, state: { color?: string; bold?: boolean }): Line {
  const segments: Segment[] = [];
  let plain = "";
  const re = /\x1b\[([\d;]*)m|\x1b\[[\d;?]*[A-Za-z]|\r/g;
  let last = 0;
  const push = (text: string) => { if (text) { segments.push({ text, color: state.color, bold: state.bold }); plain += text; } };
  for (let m; (m = re.exec(raw));) {
    push(raw.slice(last, m.index)); last = re.lastIndex;
    if (m[0] === "\r") { segments.length = 0; plain = ""; continue; } // progress bars rewrite the line
    if (m[1] === undefined) continue;
    const codes = m[1] === "" ? [0] : m[1].split(";").map(Number);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0) { state.color = undefined; state.bold = false; }
      else if (c === 1) state.bold = true;
      else if (c === 22) state.bold = false;
      else if (c === 39) state.color = undefined;
      else if (c >= 30 && c <= 37) state.color = ANSI[c - 30];
      else if (c >= 90 && c <= 97) state.color = ANSI[c - 90];
      else if (c === 38) i += codes[i + 1] === 5 ? 2 : 4;
    }
  }
  push(raw.slice(last));
  const line: Line = { stream, segments, plain, links: [] };
  // Split segments at stack-frame locations so they render as links.
  const found = findLocations(plain);
  if (found.length) {
    const out: Segment[] = [];
    let offset = 0;
    for (const seg of segments) {
      let s = 0;
      const end = offset + seg.text.length;
      for (const f of found) {
        if (f.end <= offset + s || f.start >= end) continue;
        const a = Math.max(f.start, offset + s) - offset, b = Math.min(f.end, end) - offset;
        if (a > s) out.push({ ...seg, text: seg.text.slice(s, a) });
        let idx = line.links.indexOf(f.location as any);
        if (idx < 0) { line.links.push(f.location); idx = line.links.length - 1; }
        out.push({ ...seg, text: seg.text.slice(a, b), link: idx });
        s = b;
      }
      if (s < seg.text.length) out.push({ ...seg, text: seg.text.slice(s) });
      offset = end;
    }
    line.segments = out;
  }
  return line;
}

const ansiState = new Map<string, { color?: string; bold?: boolean }>();
function append(id: string, c: Console, out: RunOutput) {
  const state = ansiState.get(id) || {};
  ansiState.set(id, state);
  for (const chunk of out.chunks) {
    let text = chunk.text;
    if (c.partial && c.partial.stream === chunk.stream) { text = c.partial.text + text; c.partial = null; }
    else if (c.partial) { c.lines.push(parseLine(c.partial.stream, c.partial.text, state)); c.partial = null; }
    const parts = text.split("\n");
    const tail = parts.pop()!;
    for (const p of parts) c.lines.push(parseLine(chunk.stream, p, state));
    if (tail) c.partial = { stream: chunk.stream, text: tail };
  }
  if (c.lines.length > MAX_LINES) { c.lines.splice(0, c.lines.length - MAX_LINES); c.truncated = true; }
  c.truncated ||= out.truncated;
  c.next = out.next;
}

async function pull(ctx: ModuleContext, id: string) {
  if (!workspaceId) return;
  const c = consoles.get(id) || { lines: [], next: 0, partial: null, truncated: false, loading: false, dirty: false };
  consoles.set(id, c);
  if (c.loading) { c.dirty = true; return; }
  const ws = workspaceId, mine = epoch;
  c.loading = true;
  try {
    for (let rounds = 0; rounds < 20; rounds++) {
      const out: RunOutput = await ctx.modules.call("run", "output", { workspaceId: ws, id, after: c.next, limit: 2000 });
      if (mine !== epoch) return;
      append(id, c, out);
      if (out.chunks.length < 2000) break;
    }
  } catch (e) { if (mine === epoch) error = errMsg(e); }
  finally { c.loading = false; if (c.dirty) { c.dirty = false; void pull(ctx, id); } ctx.ui.invalidate(); }
}

async function refresh(ctx: ModuleContext) {
  if (!workspaceId) return;
  const ws = workspaceId, mine = ++epoch;
  try {
    const list: RunSession[] = await ctx.modules.call("run", "list", { workspaceId: ws });
    if (mine !== epoch) return;
    setSessions(ctx, list || []); error = null;
  } catch (e) { if (mine === epoch) { sessions = []; error = /unknown|not found|no module/i.test(errMsg(e)) ? "The runner service isn’t installed yet." : errMsg(e); } }
  ctx.ui.invalidate();
}
function setSessions(ctx: ModuleContext, list: RunSession[]) {
  sessions = list;
  for (const id of consoles.keys()) if (!list.some(s => s.id === id)) { consoles.delete(id); ansiState.delete(id); }
  for (const s of list) if (!consoles.has(s.id)) void pull(ctx, s.id);
  if (!active || !list.some(s => s.id === active)) active = list[list.length - 1]?.id || null;
  const need = list.some(s => s.state === "running" || s.state === "starting");
  if (need && !ticker) ticker = setInterval(() => ctx.ui.invalidate(), 1000);
  if (!need && ticker) { clearInterval(ticker); ticker = null; }
}

function duration(s: RunSession) {
  const total = Math.max(0, Math.floor(((s.endedAt || Date.now()) - s.startedAt) / 1000));
  const h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, sec = total % 60;
  return h ? `${h}h ${m}m ${sec}s` : m ? `${m}m ${sec}s` : `${sec}s`;
}
function tabLabel(s: RunSession) {
  const mark = s.state === "exited" ? (s.exitCode === 0 ? " ✓" : ` ✗${s.exitCode ?? ""}`) : s.state === "failed" ? " ✗" : s.state === "paused" ? " ⏸" : runActive(s) ? " ●" : "";
  return `${s.mode === "debug" ? "🐞" : "▶"} ${s.name}${mark}`;
}

function lineNode(line: Line, i: number): UiNode {
  const base = line.stream === "stderr" ? "danger" : line.stream === "system" ? "muted" : undefined;
  const children: UiNode[] = line.segments.length ? line.segments.map((seg, j): UiNode => seg.link !== undefined
    ? { type: "button", key: `s${j}`, text: seg.text, action: "openLocation", value: { line: i, link: seg.link }, variant: "ghost",
        tooltip: "Open in editor", style: { font: "mono", fontSize: 12, lineHeight: LINE_HEIGHT, height: LINE_HEIGHT, paddingX: 0, paddingY: 0, color: "primary", background: "transparent", noShrink: true } }
    : { type: "label", key: `s${j}`, text: seg.text, mono: true, wrap, color: seg.color || base || "default", weight: seg.bold ? "semibold" : "normal",
        style: { fontSize: 12, lineHeight: LINE_HEIGHT, italic: line.stream === "system", ...(wrap ? {} : { noShrink: true }) } })
    : [{ type: "label", key: "empty", text: " ", mono: true }];
  return { type: "row", key: `l${i}`, wrap, children };
}

function sessionView(s: RunSession): UiNode {
  const c = consoles.get(s.id);
  const q = filter.trim().toLowerCase();
  const all = c ? (c.partial ? [...c.lines, parseLine(c.partial.stream, c.partial.text, {})] : c.lines) : [];
  const shown = q ? all.map((l, i) => [l, i] as const).filter(([l]) => l.plain.toLowerCase().includes(q)) : all.map((l, i) => [l, i] as const);
  const live = runActive(s);
  const toolbar: UiNode = { type: "row", key: "toolbar", gap: 2, align: "center", style: { paddingX: 6, paddingY: 2, borderBottom: 1, borderColor: "border" }, children: [
    { type: "button", key: "restart", text: "", iconSvg: icons.restart, iconSize: 14, action: live ? "restart" : "rerun", value: s.id, variant: "ghost", small: true, width: 26, tooltip: live ? "Restart" : "Run again" },
    { type: "button", key: "stop", text: "", iconSvg: icons.stop, iconSize: 14, iconColor: live ? "danger" : "muted", action: "stop", value: s.id, variant: "ghost", small: true, width: 26, disabled: !live || s.state === "stopping", tooltip: live ? "Stop" : "Not running" },
    { type: "button", key: "clear", text: "", iconSvg: uiIcons.eraser, iconSize: 14, action: "clearOutput", value: s.id, variant: "ghost", small: true, width: 26, tooltip: "Clear the console view" },
    { type: "button", key: "follow", text: "", iconSvg: icons.follow, iconSize: 14, iconColor: follow ? "primary" : "muted", action: "follow", variant: "ghost", small: true, width: 26, tooltip: follow ? "Following new output (click to stop)" : "Follow new output" },
    { type: "button", key: "wrap", text: "", iconSvg: icons.wrap, iconSize: 14, iconColor: wrap ? "primary" : "muted", action: "wrap", variant: "ghost", small: true, width: 26, tooltip: wrap ? "Soft wrap on" : "Soft wrap off" },
    { type: "column", key: "gap", grow: true, children: [] },
    { type: "textInput", key: "output-filter", ...filterInput, width: 200, value: filter, placeholder: "Filter output", prefixSvg: uiIcons.search, changeAction: "filter" },
  ] };
  const body: UiNode[] = [];
  if (c?.truncated) body.push({ type: "label", key: "trunc", text: "Earlier output was discarded.", size: "xs", color: "muted", style: { paddingX: 8 } });
  const lines: UiNode = shown.length
    ? { type: "scroll", key: follow ? `out:${s.id}:${all.length}` : `out:${s.id}`, grow: true, ...(wrap ? {} : { itemHeight: LINE_HEIGHT }), style: { paddingX: 8 },
        children: shown.map(([l, i]) => lineNode(l, i)) }
    : { type: "label", key: "nothing", text: q ? "No matching output." : s.state === "starting" ? s.phase || "Starting…" : "No output yet.", color: "muted", size: "sm", padding: 10 };
  const footer: UiNode | null = s.state === "exited" || s.state === "failed"
    ? { type: "row", key: "footer", gap: 6, align: "center", style: { paddingX: 8, paddingY: 4, borderTop: 1, borderColor: "border" }, children: [
        { type: "label", key: "exit", size: "xs", color: s.state === "failed" || (s.exitCode ?? 0) !== 0 ? "danger" : "muted",
          text: s.state === "failed" ? `Failed: ${s.error || "unknown error"}` : `Process finished with exit code ${s.exitCode ?? "?"} · ${duration(s)}` },
      ] }
    : s.state === "paused" && s.pausedAt
      ? { type: "row", key: "footer", style: { paddingX: 8, paddingY: 4, borderTop: 1, borderColor: "border" }, children: [
          { type: "button", key: "paused", text: `⏸ Paused at ${s.pausedAt.path.split("/").pop()}:${s.pausedAt.line + 1}${s.pausedAt.reason ? ` (${s.pausedAt.reason})` : ""}`, action: "openPaused", value: s.id, variant: "ghost", small: true, style: { color: "warning" } },
        ] }
      : null;
  return { type: "column", key: `session:${s.id}`, grow: true, children: [toolbar, ...body, lines, ...(footer ? [footer] : [])] };
}

async function open(ctx: ModuleContext, loc: { path?: string; suffix?: string; line: number; character?: number }) {
  if (!workspaceId) return;
  ctx.events.emit(RUN_UI_EVENTS.openLocation, { workspaceId, ...loc });
}

const mod: AppModule = {
  id: "run-panel", moduleApiVersion: 1,
  async activate(ctx, previous) {
    workspaceId = (ctx.state.get("workspace.selected") as any)?.id || null;
    if (previous?.workspaceId === workspaceId) { active = previous.active || null; follow = previous.follow !== false; wrap = !!previous.wrap; }
    ctx.state.watch("workspace.selected", (v: any) => {
      const next = v?.id || null;
      if (next === workspaceId) return;
      ++epoch; workspaceId = next; sessions = []; consoles = new Map(); ansiState.clear(); active = null; filter = ""; error = null;
      ctx.ui.invalidate(); void refresh(ctx);
    });
    ctx.events.on(RUN_EVENTS.changed, (e: any) => { if (e?.workspaceId === workspaceId) { setSessions(ctx, e.sessions || []); error = null; ctx.ui.invalidate(); } });
    ctx.events.on(RUN_EVENTS.output, (e: any) => { if (e?.workspaceId === workspaceId && consoles.has(e.id)) void pull(ctx, e.id); });
    // The bar reveals its own launches; the service reveals launches from the gutter and agents.
    const reveal = (e: any) => {
      if (e?.workspaceId !== workspaceId) return;
      active = e.id; follow = true;
      void refresh(ctx);
    };
    ctx.events.on(RUN_UI_EVENTS.revealSession, reveal);
    ctx.events.on("run.reveal", reveal);
    await refresh(ctx);
  },
  deactivate() { ++epoch; if (ticker) clearInterval(ticker); ticker = null; },
  snapshot: () => ({ workspaceId, active, follow, wrap }),
  render(): UiNode {
    if (!workspaceId) return { type: "label", key: "none", text: "Open a project to run it.", color: "muted", padding: 12 };
    if (!sessions.length) return { type: "column", key: "empty", gap: 6, padding: 14, children: [
      ...(error ? [{ type: "status", key: "error", text: error, level: "warn" } as UiNode] : []),
      { type: "label", key: "hint", text: "Nothing has run yet. Pick a configuration in the Run bar and press ▶.", color: "muted", size: "sm", wrap: true },
    ] };
    const current = sessions.find(s => s.id === active) || sessions[sessions.length - 1];
    const ended = sessions.filter(s => !runActive(s));
    const menu = (s: RunSession): MenuItem[] => [
      ...(runActive(s) ? [{ text: "Stop", action: "stop", value: s.id }, { text: "Restart", action: "restart", value: s.id }] : [{ text: "Run again", action: "rerun", value: s.id }, { text: "Close", action: "close", value: s.id }]),
      { separator: true },
      { text: "Close all finished", action: "closeEnded", disabled: !ended.length },
    ];
    return { type: "column", key: "run-panel", grow: true, children: [
      { type: "tabStrip", key: "sessions", tabs: sessions.map(s => ({ key: s.id, label: tabLabel(s), contextMenu: menu(s) })), active: current.id, action: "tab" },
      ...(error ? [{ type: "status", key: "error", text: error, level: "error" } as UiNode] : []),
      sessionView(current),
    ] };
  },
  async onEvent(ctx, ev) {
    const id = typeof ev.value === "string" ? ev.value : active;
    try {
      switch (ev.action) {
        case "tab": active = String(ev.value); break;
        case "filter": filter = String(ev.value || ""); break;
        case "follow": follow = !follow; break;
        case "wrap": wrap = !wrap; break;
        case "clearOutput": { const c = id && consoles.get(id); if (c) { c.lines = []; c.partial = null; c.truncated = false; } break; }
        case "stop": if (id) await ctx.modules.call("run", "stop", { workspaceId, id }, { timeoutMs: 30000 }); break;
        case "restart": if (id) await ctx.modules.call("run", "restart", { workspaceId, id }, { timeoutMs: 60000 }); break;
        case "rerun": {
          const s = sessions.find(s => s.id === id);
          if (s?.configId) { const n: RunSession = await ctx.modules.call("run", "start", { workspaceId, configId: s.configId, mode: s.mode, restart: true }, { timeoutMs: 60000 }); active = n.id; }
          else if (s) await ctx.modules.call("run", "restart", { workspaceId, id: s.id }, { timeoutMs: 60000 });
          break;
        }
        case "close": if (id) setSessions(ctx, await ctx.modules.call("run", "clear", { workspaceId, id })); break;
        case "closeEnded": setSessions(ctx, await ctx.modules.call("run", "clear", { workspaceId })); break;
        case "openLocation": {
          const v: any = ev.value || {};
          const c = active && consoles.get(active);
          const line = c ? (c.lines[v.line] || (c.partial && v.line === c.lines.length ? parseLine(c.partial.stream, c.partial.text, {}) : null)) : null;
          const loc = line?.links[v.link];
          if (loc) await open(ctx, loc);
          break;
        }
        case "openPaused": { const s = sessions.find(s => s.id === id); if (s?.pausedAt) await open(ctx, { path: s.pausedAt.path, line: s.pausedAt.line }); break; }
      }
    } catch (e) { error = errMsg(e); }
    ctx.ui.invalidate();
  },
};
export default mod;
