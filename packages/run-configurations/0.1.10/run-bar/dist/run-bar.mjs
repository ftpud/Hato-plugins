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
var runActive = (s) => s.state === "starting" || s.state === "running" || s.state === "paused" || s.state === "stopping";

// ../sdk/filter-style.ts
var filterInput = { height: 32, style: { noShrink: true } };

// ../sdk/sha256.ts
var K = new Uint32Array([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);

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
  cloud: outline("<path d='M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z'/>"),
  "cloud-off": outline("<path d='m2 2 20 20M5.78 5.78A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.31-.2M21.53 16.05A4.5 4.5 0 0 0 17.5 10h-1.79A7 7 0 0 0 10.2 5.1'/>"),
  "shield-alert": outline("<path d='M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1Z'/><path d='M12 8v4M12 16h.01'/>"),
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

// modules/ui/run-bar/src/index.ts
var svg = (body, fill = false) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${fill ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
var icons = {
  run: svg("<path d='M7 4.5v15l12-7.5z'/>", true),
  debug: svg("<path d='M8 9a4 4 0 0 1 8 0v6a4 4 0 0 1-8 0z'/><path d='M12 9v10M4 13h4m8 0h4M5 7l3 2m11-2-3 2M5 19l3-2m11 2-3-2M10 5 9 3m5 2 1-2'/>"),
  stop: svg("<rect x='6' y='6' width='12' height='12' rx='1.5'/>", true),
  restart: svg("<path d='M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5'/>"),
  java: svg("<path d='M6 10h10v4a5 5 0 0 1-10 0zm10 1h1.5a2 2 0 0 1 0 4H16M9 3c-1 1.5 1 2 0 3.5M12.5 3c-1 1.5 1 2 0 3.5'/>"),
  node: svg("<path d='m12 2.5 8.5 4.8v9.4L12 21.5l-8.5-4.8V7.3z'/><path d='M9.5 9v5.5a1.5 1.5 0 0 1-3 0M14 13.6c.3.9 1.2 1.4 2.2 1.4 1.3 0 2.1-.6 2.1-1.5 0-2-4.2-1-4.2-3 0-.8.8-1.5 2-1.5.9 0 1.6.4 1.9 1.1'/>"),
  test: svg("<path d='M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3M7.5 15h9'/>"),
  build: svg("<path d='m12 2.5 8.5 4.8v9.4L12 21.5l-8.5-4.8V7.3zM3.5 7.3 12 12l8.5-4.7M12 12v9.5'/>"),
  config: svg("<path d='M4 6h16M4 12h10M4 18h7'/><circle cx='18' cy='16' r='3'/>")
};
function typeIcon(type) {
  if (/junit|test|jest|vitest|mocha/.test(type)) return icons.test;
  if (/maven|gradle/.test(type)) return icons.build;
  if (/java|spring/.test(type)) return icons.java;
  if (/node|npm|script|deno|bun|typescript|javascript/.test(type)) return icons.node;
  return icons.config;
}
var candidateKey = (c) => `${c.type}|${c.target}|${c.cwd}`;
var workspaceId = null;
var configs = [];
var candidates = [];
var detecting = false;
var detected = false;
var sessions = [];
var runner = { available: false, debug: false, debugTypes: [] };
var selection = null;
var recent = [];
var open = false;
var query = "";
var busy = false;
var error = null;
var epoch = 0;
var ticker = null;
var railExpanded = true;
var pref = (name) => `run-bar.${name}.${workspaceId}`;
var save = (ctx, name, value) => ctx.modules.call("persistence", "settings.set", { key: pref(name), value }).catch(() => {
});
async function refresh(ctx) {
  if (!workspaceId) return;
  const id = workspaceId, mine = ++epoch;
  try {
    const list = await ctx.modules.call("run-configurations", "list", { workspaceId: id });
    if (mine === epoch) configs = Array.isArray(list) ? list : [];
  } catch (e) {
    if (mine === epoch) {
      configs = [];
      error = errMsg(e);
    }
  }
  try {
    const caps = await ctx.modules.call("run", "capabilities", { workspaceId: id });
    const list = await ctx.modules.call("run", "list", { workspaceId: id });
    if (mine === epoch) {
      runner = { available: true, debug: !!caps?.debug, debugTypes: caps?.debugTypes || [] };
      sessions = list || [];
    }
  } catch {
    if (mine === epoch) {
      runner = { available: false, debug: false, debugTypes: [] };
      sessions = [];
    }
  }
  if (mine === epoch) {
    if (!configs.length && !detected) void detect(ctx);
    syncTicker(ctx);
    ctx.ui.invalidate();
  }
}
async function detect(ctx) {
  if (!workspaceId || detecting) return;
  const id = workspaceId, mine = epoch;
  detecting = true;
  ctx.ui.invalidate();
  try {
    const r = await ctx.modules.call("run-configurations", "detect", { workspaceId: id }, { timeoutMs: 12e4 });
    if (mine === epoch) {
      candidates = r?.candidates || [];
      detected = true;
    }
  } catch (e) {
    if (mine === epoch) error = errMsg(e);
  } finally {
    if (mine === epoch) detecting = false;
    ctx.ui.invalidate();
  }
}
function target() {
  const pick = (c) => ({ config: c, name: c.name, type: c.type });
  const sel = selection;
  if (sel?.kind === "config") {
    const c = configs.find((c2) => c2.id === sel.id);
    if (c) return pick(c);
  }
  if (sel?.kind === "candidate") {
    const c = candidates.find((c2) => candidateKey(c2) === sel.key);
    if (c) return { candidate: c, name: c.name, type: c.type };
  }
  const r = recent.map((id) => configs.find((c) => c.id === id)).find(Boolean);
  if (r) return pick(r);
  if (configs[0]) return pick(configs[0]);
  if (candidates[0]) return { candidate: candidates[0], name: candidates[0].name, type: candidates[0].type };
  return null;
}
var sessionFor = (t) => !t ? void 0 : sessions.filter(runActive).find((s) => t.config ? s.configId === t.config.id : !s.configId && s.name === t.name);
function elapsed(s) {
  const total = Math.max(0, Math.floor((Date.now() - s.startedAt) / 1e3));
  const h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, sec = total % 60;
  const two = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(sec)}` : `${two(m)}:${two(sec)}`;
}
function syncTicker(ctx) {
  const need = sessions.some((s) => s.state === "running" || s.state === "starting");
  if (need && !ticker) ticker = setInterval(() => ctx.ui.invalidate(), 1e3);
  if (!need && ticker) {
    clearInterval(ticker);
    ticker = null;
  }
}
async function launch(ctx, mode, restart = false) {
  const t = target();
  if (!workspaceId || !t || busy) return;
  busy = true;
  error = null;
  open = false;
  ctx.ui.invalidate();
  try {
    const s = await ctx.modules.call("run", "start", { workspaceId, mode, restart, ...t.config ? { configId: t.config.id } : { candidate: t.candidate } }, { timeoutMs: 6e4 });
    if (t.config) {
      recent = [t.config.id, ...recent.filter((id) => id !== t.config.id)].slice(0, 5);
      void save(ctx, "recent", recent);
    } else ctx.host.ui.toast("info", `Running detected target “${t.name}”. Save it as a configuration from the Run menu to customize it.`);
    ctx.events.emit(RUN_UI_EVENTS.revealSession, { workspaceId, id: s.id });
  } catch (e) {
    error = errMsg(e);
    ctx.host.ui.toast("error", `Could not start “${t.name}”: ${error}`);
  } finally {
    busy = false;
    await refresh(ctx);
  }
}
async function stop(ctx, id) {
  if (!workspaceId) return;
  try {
    await ctx.modules.call("run", "stop", { workspaceId, id }, { timeoutMs: 3e4 });
  } catch (e) {
    ctx.host.ui.toast("error", `Could not stop: ${errMsg(e)}`);
  }
  await refresh(ctx);
}
var iconButton = (key, icon, action, tooltip, extra = {}) => ({ type: "button", key, text: "", iconSvg: icon, iconSize: 15, action, variant: "ghost", small: true, tooltip, width: 28, style: { paddingX: 0, height: 26, radius: 6 }, ...extra });
var sectionTitle = (key, text) => ({ type: "label", key, text, size: "xs", weight: "semibold", color: "muted", style: { paddingY: 2 } });
function menuRow(key, text, type, action, value, selected, trailing = [], note) {
  return { type: "row", key, gap: 6, align: "center", style: { radius: 6, background: selected ? "selection" : "transparent", paddingX: 4 }, children: [
    { type: "button", key: "icon", text: "", iconSvg: typeIcon(type), iconSize: 14, action, value, variant: "ghost", width: 22, tooltip: type, style: { paddingX: 0, color: "muted", background: "transparent" } },
    { type: "column", key: "label", grow: true, children: [{
      type: "choice",
      key: "pick",
      text,
      description: note,
      action,
      value,
      selected,
      mark: "✓",
      style: { background: "transparent", borderWidth: 0, paddingX: 0, paddingY: 3, minHeight: 28, radius: 0 }
    }] },
    ...trailing
  ] };
}
function menu(t) {
  const q = query.trim().toLowerCase();
  const match = (s) => !q || s.toLowerCase().includes(q);
  const out = [
    { type: "textInput", key: "run-filter", ...filterInput, value: query, placeholder: "Find a configuration…", prefixSvg: uiIcons.search, changeAction: "filter", autoFocus: true }
  ];
  if (error) out.push({ type: "status", key: "error", text: error, level: "error" });
  if (!runner.available) out.push({ type: "status", key: "no-runner", level: "warn", text: "The runner service isn’t installed yet. You can edit configurations; Run and Debug unlock when it is." });
  const active = sessions.filter(runActive).filter((s) => match(s.name));
  if (active.length) out.push(sectionTitle("running-title", "Running"), ...active.map((s) => menuRow(`running:${s.id}`, s.name, s.type, "reveal", s.id, false, [
    { type: "label", key: "time", text: s.state === "paused" ? "paused" : s.state === "starting" ? "starting" : elapsed(s), size: "xs", color: "muted", mono: true },
    iconButton("stop", icons.stop, "stopSession", `Stop ${s.name}`, { value: s.id, iconColor: "danger" })
  ], s.mode === "debug" ? "Debugging" : void 0)));
  const recentConfigs = recent.map((id) => configs.find((c) => c.id === id)).filter((c) => !!c && match(c.name));
  if (recentConfigs.length && !q) out.push(sectionTitle("recent-title", "Recent"), ...recentConfigs.map((c) => menuRow(`recent:${c.id}`, c.name, c.type, "select", `config:${c.id}`, t?.config?.id === c.id)));
  const saved = configs.filter((c) => match(c.name) && (q || !recentConfigs.includes(c)));
  if (saved.length) out.push(sectionTitle("saved-title", "Project configurations"), ...saved.map((c) => menuRow(`config:${c.id}`, c.name, c.type, "select", `config:${c.id}`, t?.config?.id === c.id, [
    iconButton("edit", uiIcons.pencil, "editConfig", `Edit ${c.name}`, { value: c.id, iconColor: "muted" })
  ])));
  const found = candidates.filter((c) => match(c.name) && !configs.some((s) => s.type === c.type && s.target === c.target));
  if (found.length || detecting) out.push({ type: "row", key: "detected-head", align: "center", children: [
    { type: "column", key: "t", grow: true, children: [sectionTitle("detected-title", "Detected")] },
    detecting ? { type: "label", key: "busy", text: "Scanning…", size: "xs", color: "muted" } : iconButton("rescan", uiIcons.refresh, "detect", "Scan the project again", { iconColor: "muted" })
  ] }, ...found.slice(0, 30).map((c) => menuRow(`cand:${candidateKey(c)}`, c.name, c.type, "select", `candidate:${candidateKey(c)}`, !!t?.candidate && candidateKey(t.candidate) === candidateKey(c), [
    { type: "button", key: "save", text: "Save", action: "saveCandidate", value: candidateKey(c), variant: "ghost", small: true, tooltip: "Save as a project configuration and edit it" }
  ], `detected · ${c.file}:${c.line + 1}`)));
  if (!active.length && !recentConfigs.length && !saved.length && !found.length && !detecting)
    out.push({ type: "label", key: "empty", text: q ? "No matching configurations." : "No configurations yet. Create one, or scan the project for main classes, tests and package scripts.", size: "sm", color: "muted", wrap: true });
  out.push({ type: "divider", key: "footer-divider" }, { type: "row", key: "footer", gap: 4, children: [
    { type: "button", key: "new", text: "New configuration…", iconSvg: uiIcons.plus, action: "newConfig", variant: "ghost", small: true },
    { type: "spacer", key: "sp", grow: true },
    { type: "button", key: "edit-all", text: "Edit configurations…", iconSvg: icons.config, action: "editAll", variant: "ghost", small: true }
  ] });
  return out;
}
function compact(t, live, children) {
  const by = (key) => children.find((c) => c.key === key);
  const status = live ? `
${live.state === "running" ? `● ${elapsed(live)}` : live.state}` : t ? "" : "\nExpand the rail to add a configuration";
  const slim = (n, color) => ({
    ...n,
    iconSize: 14,
    iconColor: n.disabled ? "faint" : color,
    width: 30,
    tooltip: `${n.tooltip}${status}`,
    tooltipPlacement: "right",
    style: { paddingX: 0, height: 26, radius: 7 }
  });
  const primary = slim(by(live && live.state !== "stopping" ? "restart" : "run"), "muted");
  const secondary = live ? slim(by("stop"), "danger") : slim(by("debug"), "muted");
  const dot = live ? [{ type: "column", key: "live", children: [], style: {
    position: "absolute",
    right: -2,
    top: -2,
    width: 7,
    height: 7,
    radius: 4,
    borderWidth: 1.5,
    borderColor: "panel",
    background: live.state === "paused" ? "warning" : "success"
  } }] : [];
  return {
    type: "column",
    key: "run-bar",
    gap: 0,
    align: "center",
    style: { position: "relative", padding: 1, radius: 9, borderWidth: 1, borderColor: "border" },
    children: [primary, secondary, ...dot]
  };
}
var mod = {
  id: "run-bar",
  moduleApiVersion: 1,
  async activate(ctx, previous) {
    const load = async () => {
      const [sel, rec] = await Promise.all([
        ctx.modules.call("persistence", "settings.get", { key: pref("selected") }).catch(() => null),
        ctx.modules.call("persistence", "settings.get", { key: pref("recent") }).catch(() => null)
      ]);
      selection = sel && typeof sel === "object" && (sel.kind === "config" || sel.kind === "candidate") ? sel : null;
      recent = Array.isArray(rec) ? rec.filter((x) => typeof x === "string").slice(0, 5) : [];
    };
    workspaceId = ctx.state.get("workspace.selected")?.id || null;
    railExpanded = ctx.state.get("left-sidebar.expanded") !== false;
    ctx.state.watch("left-sidebar.expanded", (v) => {
      railExpanded = v !== false;
      open = false;
      ctx.ui.invalidate();
    });
    if (previous?.workspaceId === workspaceId) {
      configs = previous.configs || [];
      candidates = previous.candidates || [];
      detected = !!previous.detected;
    }
    ctx.state.watch("workspace.selected", async (v) => {
      const next = v?.id || null;
      if (next === workspaceId) return;
      ++epoch;
      workspaceId = next;
      configs = [];
      candidates = [];
      sessions = [];
      detected = false;
      selection = null;
      recent = [];
      open = false;
      query = "";
      error = null;
      ctx.ui.invalidate();
      if (next) {
        await load();
        await refresh(ctx);
      }
    });
    ctx.events.on(RUN_EVENTS.changed, (e) => {
      if (e?.workspaceId !== workspaceId) return;
      sessions = e.sessions || [];
      runner.available = true;
      syncTicker(ctx);
      ctx.ui.invalidate();
    });
    ctx.events.on("run-configurations.changed", (e) => {
      if (!e?.workspaceId || e.workspaceId === workspaceId) void refresh(ctx);
    });
    if (workspaceId) {
      await load();
      await refresh(ctx);
    }
  },
  deactivate() {
    ++epoch;
    if (ticker) clearInterval(ticker);
    ticker = null;
  },
  canSwap: () => ({ ok: !busy, ...busy ? { reason: "A run is starting." } : {} }),
  snapshot: () => ({ workspaceId, configs, candidates, detected }),
  render() {
    const t = target();
    const live = sessionFor(t);
    const debugOk = runner.available && runner.debug && !!t && (!runner.debugTypes.length || runner.debugTypes.includes(t.type));
    const noTarget = !t;
    const chipText = !workspaceId ? "No workspace" : t ? t.name : detecting ? "Scanning…" : "Add configuration…";
    const children = [
      {
        type: "dropdown",
        key: "picker",
        text: `${chipText.length > 24 ? chipText.slice(0, 23) + "…" : chipText}  ⌄`,
        iconSvg: t ? typeIcon(t.type) : icons.config,
        variant: "ghost",
        action: "toggle",
        open,
        disabled: !workspaceId,
        grow: true,
        minWidth: 0,
        menuWidth: 360,
        maxHeight: 560,
        tooltip: t ? `${t.name}${t.candidate ? " (detected)" : ""}
Choose a run configuration` : "Choose or create a run configuration",
        style: { background: "transparent", borderWidth: 0 },
        children: [{ type: "column", key: "menu", gap: 6, padding: 10, scroll: true, children: menu(t) }]
      },
      live && live.state !== "stopping" ? iconButton("restart", icons.restart, "restart", `Restart ${t.name}`, { disabled: busy }) : iconButton(
        "run",
        icons.run,
        "run",
        noTarget ? "Nothing to run yet" : !runner.available ? "Runner service not installed yet" : `Run ${t.name}`,
        { disabled: noTarget || !runner.available || busy, iconColor: noTarget || !runner.available ? "muted" : "success" }
      ),
      iconButton(
        "debug",
        icons.debug,
        "debug",
        !runner.available ? "Runner service not installed yet" : !runner.debug ? "Debugging isn’t available in this runner yet" : noTarget ? "Nothing to debug yet" : debugOk ? `Debug ${t.name}` : `Debugging isn’t supported for ${t.type}`,
        { disabled: !debugOk || busy || !!live, iconColor: debugOk && !live ? "info" : "muted" }
      ),
      iconButton("stop", icons.stop, "stop", live ? `Stop ${live.name}` : "Nothing is running", { disabled: !live || live.state === "stopping", iconColor: live ? "danger" : "muted" })
    ];
    if (live) {
      const text = live.state === "paused" ? `⏸ ${live.pausedAt ? `${live.pausedAt.path.split("/").pop()}:${live.pausedAt.line + 1}` : "Paused"}` : live.state === "starting" ? `◌ ${live.phase || "Starting…"}` : live.state === "stopping" ? "◌ Stopping…" : `● ${elapsed(live)}`;
      const others = sessions.filter(runActive).length - 1;
      children.push({
        type: "button",
        key: "status",
        text: others > 0 ? `${text}  +${others}` : text,
        action: "reveal",
        value: live.id,
        variant: "ghost",
        small: true,
        tooltip: `${live.mode === "debug" ? "Debugging" : "Running"} ${live.name}${others > 0 ? ` · ${others} more running` : ""}
Show output`,
        style: { color: live.state === "paused" ? "warning" : "success", font: "mono", fontSize: 11, paddingX: 6, height: 24, radius: 12, background: "surface", noShrink: true }
      });
    } else {
      const n = sessions.filter(runActive).length;
      if (n) children.push({ type: "button", key: "others", text: `${n} running`, action: "toggle", value: true, variant: "ghost", small: true, tooltip: "Other configurations are running. Open the menu to manage them.", style: { color: "muted", fontSize: 11 } });
    }
    if (!railExpanded) return compact(t, live, children);
    const [picker, ...controls] = children;
    return { type: "column", key: "run-bar", gap: 2, grow: true, minWidth: 0, children: [
      { type: "row", key: "picker-row", grow: true, minWidth: 0, style: { fullWidth: true }, children: [{ ...picker, grow: true, minWidth: 0, style: { ...picker.style, fullWidth: true, maxWidth: 220 } }] },
      { type: "row", key: "controls", gap: 2, align: "center", children: [...controls.slice(0, 3), { type: "spacer", key: "sp" }, ...controls.slice(3)] }
    ] };
  },
  async onEvent(ctx, ev) {
    switch (ev.action) {
      case "toggle":
        open = !!ev.value;
        if (open) {
          query = "";
          error = null;
          void refresh(ctx);
          if (!detected) void detect(ctx);
        }
        break;
      case "filter":
        query = String(ev.value || "");
        break;
      case "select": {
        const v = String(ev.value || "");
        selection = v.startsWith("config:") ? { kind: "config", id: v.slice(7) } : v.startsWith("candidate:") ? { kind: "candidate", key: v.slice(10) } : null;
        open = false;
        void save(ctx, "selected", selection);
        break;
      }
      case "detect":
        void detect(ctx);
        break;
      case "run":
        await launch(ctx, "run");
        return;
      case "debug":
        await launch(ctx, "debug");
        return;
      case "restart": {
        const s = sessionFor(target());
        if (s && workspaceId) {
          busy = true;
          ctx.ui.invalidate();
          try {
            await ctx.modules.call("run", "restart", { workspaceId, id: s.id }, { timeoutMs: 6e4 });
          } catch (e) {
            ctx.host.ui.toast("error", `Could not restart: ${errMsg(e)}`);
          } finally {
            busy = false;
          }
          await refresh(ctx);
        }
        return;
      }
      case "stop": {
        const s = sessionFor(target());
        if (s) await stop(ctx, s.id);
        return;
      }
      case "stopSession":
        await stop(ctx, String(ev.value));
        return;
      case "reveal":
        open = false;
        ctx.events.emit(RUN_UI_EVENTS.revealSession, { workspaceId, id: ev.value });
        break;
      case "editConfig":
        open = false;
        ctx.events.emit(RUN_UI_EVENTS.editConfiguration, { workspaceId, id: ev.value });
        break;
      case "saveCandidate": {
        const c = candidates.find((c2) => candidateKey(c2) === ev.value);
        open = false;
        if (c) ctx.events.emit(RUN_UI_EVENTS.editConfiguration, { workspaceId, candidate: c });
        break;
      }
      case "newConfig":
        open = false;
        ctx.events.emit(RUN_UI_EVENTS.editConfiguration, { workspaceId, candidate: null });
        break;
      case "editAll":
        open = false;
        ctx.events.emit(RUN_UI_EVENTS.editConfiguration, { workspaceId });
        break;
    }
    ctx.ui.invalidate();
  }
};
var index_default = mod;
export {
  index_default as default
};
