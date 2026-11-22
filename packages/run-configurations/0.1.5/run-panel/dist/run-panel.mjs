// ../sdk/run.ts
var RUN_EVENTS = {
  /** {workspaceId, sessions: RunSession[]} on any session state change. */
  changed: "run.changed",
  /** {workspaceId, id, seq} when new output is available (coalesced, at most ~10/s per session). */
  output: "run.output"
};
var RUN_UI_EVENTS = {
  /** Open the configuration editor: {workspaceId, id?} edits a saved config, {workspaceId, candidate}
   *  starts a new one prefilled from a detected candidate (null = blank), {workspaceId} opens the list. */
  editConfiguration: "run-bar.editConfiguration",
  /** Reveal the Run panel on a session: {workspaceId, id}. */
  revealSession: "run-bar.reveal",
  /** Open a source location in the editor: OpenLocation. Handled by the viewer. */
  openLocation: "run-panel.openLocation"
};
function findLocations(text) {
  const out = [];
  const java = /\bat\s+((?:[\w$]+\.)*)([\w$]+)\.[\w$<>]+\(([\w$]+\.(?:java|kt|groovy|scala)):(\d+)\)/g;
  for (let m; m = java.exec(text); ) {
    const pkg = m[1].replace(/\.$/, "").split(".").filter(Boolean);
    const start = m.index + m[0].indexOf(m[3]);
    out.push({ start, end: start + m[3].length + 1 + m[4].length, location: { suffix: [...pkg, m[3]].join("/"), line: Number(m[4]) - 1 } });
  }
  const js = /(?:file:\/\/)?((?:\/|[A-Za-z]:[\\/]|\.{1,2}\/)[^\s():'"]+\.(?:[cm]?[jt]sx?|vue|svelte)):(\d+)(?::(\d+))?/g;
  for (let m; m = js.exec(text); ) {
    if (out.some((o) => m.index < o.end && m.index + m[0].length > o.start)) continue;
    out.push({ start: m.index, end: m.index + m[0].length, location: { path: m[1], line: Number(m[2]) - 1, character: m[3] ? Number(m[3]) - 1 : 0 } });
  }
  return out.sort((a, b) => a.start - b.start);
}
var runActive = (s) => s.state === "starting" || s.state === "running" || s.state === "paused" || s.state === "stopping";

// ../sdk/filter-style.ts
var filterInput = { height: 32, style: { noShrink: true } };

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

// modules/ui/run-panel/src/index.ts
var svg = (body, fill = false) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${fill ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
var icons = {
  stop: svg("<rect x='6' y='6' width='12' height='12' rx='1.5'/>", true),
  restart: svg("<path d='M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5'/>"),
  follow: svg("<path d='M12 4v14m-6-6 6 6 6-6M5 21h14'/>"),
  wrap: svg("<path d='M3 6h18M3 12h15a3 3 0 0 1 0 6h-4m2-2-2 2 2 2M3 18h7'/>"),
  // Tab glyphs: outline bug for debug sessions, play triangle for runs. Color carries the state.
  debug: svg("<path d='M9 7.5V6a3 3 0 0 1 6 0v1.5'/><rect x='7' y='7.5' width='10' height='12' rx='5'/><path d='M12 11v8.5M7 12H3.5M17 12h3.5M7.4 16.5 4 18.5M16.6 16.5l3.4 2M7.6 9 5 6.5M16.4 9 19 6.5'/>"),
  run: svg("<path d='M7.5 5v14l11.5-7z'/>", true)
};
var MAX_LINES = 2e4;
var LINE_HEIGHT = 18;
var workspaceId = null;
var sessions = [];
var consoles = /* @__PURE__ */ new Map();
var active = null;
var filter = "";
var follow = true;
var wrap = false;
var error = null;
var epoch = 0;
var ticker = null;
var ANSI = ["text", "danger", "success", "warning", "info", "#b887ce", "#3fb9c6", "text"];
function parseLine(stream, raw, state) {
  const segments = [];
  let plain = "";
  const re = /\x1b\[([\d;]*)m|\x1b\[[\d;?]*[A-Za-z]|\r/g;
  let last = 0;
  const push = (text) => {
    if (text) {
      segments.push({ text, color: state.color, bold: state.bold });
      plain += text;
    }
  };
  for (let m; m = re.exec(raw); ) {
    push(raw.slice(last, m.index));
    last = re.lastIndex;
    if (m[0] === "\r") {
      segments.length = 0;
      plain = "";
      continue;
    }
    if (m[1] === void 0) continue;
    const codes = m[1] === "" ? [0] : m[1].split(";").map(Number);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0) {
        state.color = void 0;
        state.bold = false;
      } else if (c === 1) state.bold = true;
      else if (c === 22) state.bold = false;
      else if (c === 39) state.color = void 0;
      else if (c >= 30 && c <= 37) state.color = ANSI[c - 30];
      else if (c >= 90 && c <= 97) state.color = ANSI[c - 90];
      else if (c === 38) i += codes[i + 1] === 5 ? 2 : 4;
    }
  }
  push(raw.slice(last));
  const line = { stream, segments, plain, links: [] };
  const found = findLocations(plain);
  if (found.length) {
    const out = [];
    let offset = 0;
    for (const seg of segments) {
      let s = 0;
      const end = offset + seg.text.length;
      for (const f of found) {
        if (f.end <= offset + s || f.start >= end) continue;
        const a = Math.max(f.start, offset + s) - offset, b = Math.min(f.end, end) - offset;
        if (a > s) out.push({ ...seg, text: seg.text.slice(s, a) });
        let idx = line.links.indexOf(f.location);
        if (idx < 0) {
          line.links.push(f.location);
          idx = line.links.length - 1;
        }
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
var ansiState = /* @__PURE__ */ new Map();
function append(id, c, out) {
  const state = ansiState.get(id) || {};
  ansiState.set(id, state);
  for (const chunk of out.chunks) {
    let text = chunk.text;
    if (c.partial && c.partial.stream === chunk.stream) {
      text = c.partial.text + text;
      c.partial = null;
    } else if (c.partial) {
      c.lines.push(parseLine(c.partial.stream, c.partial.text, state));
      c.partial = null;
    }
    const parts = text.split("\n");
    const tail = parts.pop();
    for (const p of parts) c.lines.push(parseLine(chunk.stream, p, state));
    if (tail) c.partial = { stream: chunk.stream, text: tail };
  }
  if (c.lines.length > MAX_LINES) {
    c.lines.splice(0, c.lines.length - MAX_LINES);
    c.truncated = true;
  }
  c.truncated || (c.truncated = out.truncated);
  c.next = out.next;
}
async function pull(ctx, id) {
  if (!workspaceId) return;
  const c = consoles.get(id) || { lines: [], next: 0, partial: null, truncated: false, loading: false, dirty: false };
  consoles.set(id, c);
  if (c.loading) {
    c.dirty = true;
    return;
  }
  const ws = workspaceId, mine = epoch;
  c.loading = true;
  try {
    for (let rounds = 0; rounds < 20; rounds++) {
      const out = await ctx.modules.call("run", "output", { workspaceId: ws, id, after: c.next, limit: 2e3 });
      if (mine !== epoch) return;
      append(id, c, out);
      if (out.chunks.length < 2e3) break;
    }
  } catch (e) {
    if (mine === epoch) error = errMsg(e);
  } finally {
    c.loading = false;
    if (c.dirty) {
      c.dirty = false;
      void pull(ctx, id);
    }
    ctx.ui.invalidate();
  }
}
async function refresh(ctx) {
  if (!workspaceId) return;
  const ws = workspaceId, mine = ++epoch;
  try {
    const list = await ctx.modules.call("run", "list", { workspaceId: ws });
    if (mine !== epoch) return;
    setSessions(ctx, list || []);
    error = null;
  } catch (e) {
    if (mine === epoch) {
      sessions = [];
      error = /unknown|not found|no module/i.test(errMsg(e)) ? "The runner service isn’t installed yet." : errMsg(e);
    }
  }
  ctx.ui.invalidate();
}
function setSessions(ctx, list) {
  sessions = list;
  for (const id of consoles.keys()) if (!list.some((s) => s.id === id)) {
    consoles.delete(id);
    ansiState.delete(id);
  }
  for (const s of list) if (!consoles.has(s.id)) void pull(ctx, s.id);
  if (!active || !list.some((s) => s.id === active)) active = list[list.length - 1]?.id || null;
  const need = list.some((s) => s.state === "running" || s.state === "starting");
  if (need && !ticker) ticker = setInterval(() => ctx.ui.invalidate(), 1e3);
  if (!need && ticker) {
    clearInterval(ticker);
    ticker = null;
  }
}
function duration(s) {
  const total = Math.max(0, Math.floor(((s.endedAt || Date.now()) - s.startedAt) / 1e3));
  const h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, sec = total % 60;
  return h ? `${h}h ${m}m ${sec}s` : m ? `${m}m ${sec}s` : `${sec}s`;
}
var stoppedBySignal = (s) => s.state === "exited" && (s.exitCode === 130 || s.exitCode === 143 || s.exitCode === 137);
function tabLabel(s) {
  const mark = s.state === "exited" ? s.exitCode === 0 ? " ✓" : stoppedBySignal(s) ? "" : ` ✗ ${s.exitCode ?? ""}` : s.state === "failed" ? " ✗" : s.state === "paused" ? " ⏸" : "";
  return `${s.name}${mark}`;
}
function tabIcon(s) {
  const color = s.state === "paused" ? "warning" : s.state === "failed" || s.state === "exited" && s.exitCode !== 0 && !stoppedBySignal(s) ? "danger" : runActive(s) ? "success" : "muted";
  return { iconSvg: s.mode === "debug" ? icons.debug : icons.run, iconColor: color };
}
function tabTooltip(s) {
  const kind = s.mode === "debug" ? "Debug" : "Run";
  const state = s.state === "exited" ? s.exitCode === 0 ? "finished" : stoppedBySignal(s) ? `stopped (exit ${s.exitCode})` : `exited with code ${s.exitCode ?? "?"}` : s.state === "failed" ? `failed${s.error ? `: ${s.error}` : ""}` : s.state;
  return `${kind} · ${s.name} · ${state} · ${duration(s)}`;
}
function lineNode(line, i) {
  const base = line.stream === "stderr" ? "danger" : line.stream === "system" ? "muted" : void 0;
  const children = line.segments.length ? line.segments.map((seg, j) => seg.link !== void 0 ? {
    type: "button",
    key: `s${j}`,
    text: seg.text,
    action: "openLocation",
    value: { line: i, link: seg.link },
    variant: "ghost",
    tooltip: "Open in editor",
    style: { font: "mono", fontSize: 12, lineHeight: LINE_HEIGHT, height: LINE_HEIGHT, paddingX: 0, paddingY: 0, color: "primary", background: "transparent", noShrink: true }
  } : {
    type: "label",
    key: `s${j}`,
    text: seg.text,
    mono: true,
    wrap,
    color: seg.color || base || "default",
    weight: seg.bold ? "semibold" : "normal",
    style: { fontSize: 12, lineHeight: LINE_HEIGHT, italic: line.stream === "system", ...wrap ? {} : { noShrink: true } }
  }) : [{ type: "label", key: "empty", text: " ", mono: true }];
  return { type: "row", key: `l${i}`, wrap, children };
}
function sessionView(s) {
  const c = consoles.get(s.id);
  const q = filter.trim().toLowerCase();
  const all = c ? c.partial ? [...c.lines, parseLine(c.partial.stream, c.partial.text, {})] : c.lines : [];
  const shown = q ? all.map((l, i) => [l, i]).filter(([l]) => l.plain.toLowerCase().includes(q)) : all.map((l, i) => [l, i]);
  const live = runActive(s);
  const toolbar = { type: "row", key: "toolbar", gap: 2, align: "center", style: { paddingX: 6, paddingY: 2, borderBottom: 1, borderColor: "border" }, children: [
    { type: "button", key: "restart", text: "", iconSvg: icons.restart, iconSize: 14, action: live ? "restart" : "rerun", value: s.id, variant: "ghost", small: true, width: 26, tooltip: live ? "Restart" : "Run again" },
    { type: "button", key: "stop", text: "", iconSvg: icons.stop, iconSize: 14, iconColor: live ? "danger" : "muted", action: "stop", value: s.id, variant: "ghost", small: true, width: 26, disabled: !live || s.state === "stopping", tooltip: live ? "Stop" : "Not running" },
    { type: "button", key: "clear", text: "", iconSvg: uiIcons.eraser, iconSize: 14, action: "clearOutput", value: s.id, variant: "ghost", small: true, width: 26, tooltip: "Clear the console view" },
    { type: "button", key: "follow", text: "", iconSvg: icons.follow, iconSize: 14, iconColor: follow ? "primary" : "muted", action: "follow", variant: "ghost", small: true, width: 26, tooltip: follow ? "Following new output (click to stop)" : "Follow new output" },
    { type: "button", key: "wrap", text: "", iconSvg: icons.wrap, iconSize: 14, iconColor: wrap ? "primary" : "muted", action: "wrap", variant: "ghost", small: true, width: 26, tooltip: wrap ? "Soft wrap on" : "Soft wrap off" },
    { type: "column", key: "gap", grow: true, children: [] },
    { type: "textInput", key: "output-filter", ...filterInput, width: 200, value: filter, placeholder: "Filter output", prefixSvg: uiIcons.search, changeAction: "filter" }
  ] };
  const body = [];
  if (c?.truncated) body.push({ type: "label", key: "trunc", text: "Earlier output was discarded.", size: "xs", color: "muted", style: { paddingX: 8 } });
  const lines = shown.length ? {
    type: "scroll",
    key: follow ? `out:${s.id}:${all.length}` : `out:${s.id}`,
    grow: true,
    ...wrap ? {} : { itemHeight: LINE_HEIGHT },
    style: { paddingX: 8 },
    children: shown.map(([l, i]) => lineNode(l, i))
  } : { type: "label", key: "nothing", text: q ? "No matching output." : s.state === "starting" ? s.phase || "Starting…" : "No output yet.", color: "muted", size: "sm", padding: 10 };
  const footer = s.state === "exited" || s.state === "failed" ? { type: "row", key: "footer", gap: 6, align: "center", style: { paddingX: 8, paddingY: 4, borderTop: 1, borderColor: "border" }, children: [
    {
      type: "label",
      key: "exit",
      size: "xs",
      color: s.state === "failed" || (s.exitCode ?? 0) !== 0 ? "danger" : "muted",
      text: s.state === "failed" ? `Failed: ${s.error || "unknown error"}` : `Process finished with exit code ${s.exitCode ?? "?"} · ${duration(s)}`
    }
  ] } : s.state === "paused" && s.pausedAt ? { type: "row", key: "footer", style: { paddingX: 8, paddingY: 4, borderTop: 1, borderColor: "border" }, children: [
    { type: "button", key: "paused", text: `⏸ Paused at ${s.pausedAt.path.split("/").pop()}:${s.pausedAt.line + 1}${s.pausedAt.reason ? ` (${s.pausedAt.reason})` : ""}`, action: "openPaused", value: s.id, variant: "ghost", small: true, style: { color: "warning" } }
  ] } : null;
  return { type: "column", key: `session:${s.id}`, grow: true, children: [toolbar, ...body, lines, ...footer ? [footer] : []] };
}
async function open(ctx, loc) {
  if (!workspaceId) return;
  ctx.events.emit(RUN_UI_EVENTS.openLocation, { workspaceId, ...loc });
}
var mod = {
  id: "run-panel",
  moduleApiVersion: 1,
  async activate(ctx, previous) {
    workspaceId = ctx.state.get("workspace.selected")?.id || null;
    if (previous?.workspaceId === workspaceId) {
      active = previous.active || null;
      follow = previous.follow !== false;
      wrap = !!previous.wrap;
    }
    ctx.state.watch("workspace.selected", (v) => {
      const next = v?.id || null;
      if (next === workspaceId) return;
      ++epoch;
      workspaceId = next;
      sessions = [];
      consoles = /* @__PURE__ */ new Map();
      ansiState.clear();
      active = null;
      filter = "";
      error = null;
      ctx.ui.invalidate();
      void refresh(ctx);
    });
    ctx.events.on(RUN_EVENTS.changed, (e) => {
      if (e?.workspaceId === workspaceId) {
        setSessions(ctx, e.sessions || []);
        error = null;
        ctx.ui.invalidate();
      }
    });
    ctx.events.on(RUN_EVENTS.output, (e) => {
      if (e?.workspaceId === workspaceId && consoles.has(e.id)) void pull(ctx, e.id);
    });
    const reveal = (e) => {
      if (e?.workspaceId !== workspaceId) return;
      active = e.id;
      follow = true;
      void refresh(ctx);
    };
    ctx.events.on(RUN_UI_EVENTS.revealSession, reveal);
    ctx.events.on("run.reveal", reveal);
    await refresh(ctx);
  },
  deactivate() {
    ++epoch;
    if (ticker) clearInterval(ticker);
    ticker = null;
  },
  snapshot: () => ({ workspaceId, active, follow, wrap }),
  render() {
    if (!workspaceId) return { type: "label", key: "none", text: "Open a project to run it.", color: "muted", padding: 12 };
    if (!sessions.length) return { type: "column", key: "empty", gap: 6, padding: 14, children: [
      ...error ? [{ type: "status", key: "error", text: error, level: "warn" }] : [],
      { type: "label", key: "hint", text: "Nothing has run yet. Pick a configuration in the Run bar and press ▶.", color: "muted", size: "sm", wrap: true }
    ] };
    const current = sessions.find((s) => s.id === active) || sessions[sessions.length - 1];
    const ended = sessions.filter((s) => !runActive(s));
    const menu = (s) => [
      ...runActive(s) ? [{ text: "Stop", action: "stop", value: s.id }, { text: "Restart", action: "restart", value: s.id }] : [{ text: "Run again", action: "rerun", value: s.id }, { text: "Close", action: "close", value: s.id }],
      { separator: true },
      { text: "Close all finished", action: "closeEnded", disabled: !ended.length }
    ];
    return { type: "column", key: "run-panel", grow: true, children: [
      { type: "tabStrip", key: "sessions", tabs: sessions.map((s) => ({ key: s.id, label: tabLabel(s), ...tabIcon(s), tooltip: tabTooltip(s), contextMenu: menu(s) })), active: current.id, action: "tab" },
      ...error ? [{ type: "status", key: "error", text: error, level: "error" }] : [],
      sessionView(current)
    ] };
  },
  async onEvent(ctx, ev) {
    const id = typeof ev.value === "string" ? ev.value : active;
    try {
      switch (ev.action) {
        case "tab":
          active = String(ev.value);
          break;
        case "filter":
          filter = String(ev.value || "");
          break;
        case "follow":
          follow = !follow;
          break;
        case "wrap":
          wrap = !wrap;
          break;
        case "clearOutput": {
          const c = id && consoles.get(id);
          if (c) {
            c.lines = [];
            c.partial = null;
            c.truncated = false;
          }
          break;
        }
        case "stop":
          if (id) await ctx.modules.call("run", "stop", { workspaceId, id }, { timeoutMs: 3e4 });
          break;
        case "restart":
          if (id) await ctx.modules.call("run", "restart", { workspaceId, id }, { timeoutMs: 6e4 });
          break;
        case "rerun": {
          const s = sessions.find((s2) => s2.id === id);
          if (s?.configId) {
            const n = await ctx.modules.call("run", "start", { workspaceId, configId: s.configId, mode: s.mode, restart: true }, { timeoutMs: 6e4 });
            active = n.id;
          } else if (s) await ctx.modules.call("run", "restart", { workspaceId, id: s.id }, { timeoutMs: 6e4 });
          break;
        }
        case "close":
          if (id) setSessions(ctx, await ctx.modules.call("run", "clear", { workspaceId, id }));
          break;
        case "closeEnded":
          setSessions(ctx, await ctx.modules.call("run", "clear", { workspaceId }));
          break;
        case "openLocation": {
          const v = ev.value || {};
          const c = active && consoles.get(active);
          const line = c ? c.lines[v.line] || (c.partial && v.line === c.lines.length ? parseLine(c.partial.stream, c.partial.text, {}) : null) : null;
          const loc = line?.links[v.link];
          if (loc) await open(ctx, loc);
          break;
        }
        case "openPaused": {
          const s = sessions.find((s2) => s2.id === id);
          if (s?.pausedAt) await open(ctx, { path: s.pausedAt.path, line: s.pausedAt.line });
          break;
        }
      }
    } catch (e) {
      error = errMsg(e);
    }
    ctx.ui.invalidate();
  }
};
var index_default = mod;
export {
  index_default as default
};
