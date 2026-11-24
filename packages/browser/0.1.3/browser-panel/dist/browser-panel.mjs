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

// ../sdk/tab-style.ts
function fileTabStyle(active) {
  return {
    background: active ? "field" : "surface",
    color: active ? "text" : "muted",
    borderBottom: 2,
    borderColor: active ? "primary" : "surface",
    radius: 5
  };
}
function terminalTabStyle(active) {
  return { background: active ? "selection" : "surface", color: active ? "primary" : "muted", radius: 6 };
}
function tabButtonStyle(active, terminal = false) {
  const { background, color } = terminal ? terminalTabStyle(active) : fileTabStyle(active);
  return { background, color, fontWeight: 400, radius: 4, paddingX: 9, paddingY: 5, minHeight: 30 };
}

// ../sdk/browser.ts
var DEFAULT_VIEWPORT = { width: 1280, height: 800 };

// modules/ui/browser-panel/src/icons.ts
var svg = (body, fill = false) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${fill ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
var icons = {
  back: svg("<path d='M15 18l-6-6 6-6'/>"),
  forward: svg("<path d='M9 18l6-6-6-6'/>"),
  reload: svg("<path d='M20 11a8 8 0 1 0-2.3 5.7'/><path d='M20 4v7h-7'/>"),
  stop: svg("<path d='M6 6l12 12M18 6 6 18'/>"),
  plus: svg("<path d='M12 5v14M5 12h14'/>"),
  close: svg("<path d='M7 7l10 10M17 7 7 17'/>"),
  power: svg("<path d='M12 3v9'/><path d='M6.3 7.3a8 8 0 1 0 11.4 0'/>"),
  play: svg("<path d='M7 5l12 7-12 7z'/>"),
  network: svg("<path d='M4 18h3l2-7 3 10 3-14 2 11h3'/>"),
  settings: svg("<circle cx='12' cy='12' r='3'/><path d='M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'/>"),
  fit: svg("<path d='M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'/>"),
  agent: svg("<rect x='5' y='8' width='14' height='11' rx='3'/><path d='M12 4v4M9 13h.01M15 13h.01'/>"),
  trash: svg("<path d='M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3'/>"),
  globe: svg("<circle cx='12' cy='12' r='9'/><path d='M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z'/>"),
  /** Agent pointer overlay drawn natively over the live preview. */
  pointer: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 2.5 19.5 12l-7 1.6-3.4 6.9z" fill="currentColor"/></svg>`
};

// modules/ui/browser-panel/src/index.ts
var ctxRef;
var state = { sessions: [], rev: 0 };
var selected = null;
var mode = "view";
var error = null;
var busy = false;
var fit = false;
var showNetwork = false;
var netFilter = "";
var netRows = [];
var netSeq = -1;
var netLoading = false;
var netSelected = null;
var netDetail = null;
var workspace = null;
var form = blankForm();
var inputs = Promise.resolve();
var fitTimer = null;
var agentTimer = null;
var lastSize = null;
function blankForm() {
  return { name: "", where: "local", endpoint: "", headed: false, keepProfile: true, agentAccess: true, width: String(DEFAULT_VIEWPORT.width), height: String(DEFAULT_VIEWPORT.height), startUrl: "", executable: "" };
}
var current = () => state.sessions.find((s) => s.id === selected) || state.sessions[0];
var call = (method, args = {}, timeoutMs = 6e4) => ctxRef.modules.call("browser", method, args, { timeoutMs });
async function act(fn) {
  busy = true;
  error = null;
  ctxRef.ui.invalidate();
  try {
    await fn();
  } catch (e) {
    error = errMsg(e);
  } finally {
    busy = false;
    ctxRef.ui.invalidate();
  }
}
function send(kind, event) {
  const s = current();
  if (!s || s.status !== "running") return;
  const id = s.id;
  inputs = inputs.then(() => call("input", { id, kind, event }, 1e4)).catch(() => {
  });
}
async function refreshNetwork(force = false) {
  const s = current();
  if (!showNetwork || !s || netLoading) return;
  if (!force && s.network.seq === netSeq) return;
  netLoading = true;
  const seq = s.network.seq;
  try {
    const r = await call("network", { id: s.id, limit: 400, filter: netFilter || void 0 });
    netRows = r.requests;
    netSeq = seq;
  } catch (e) {
    error = errMsg(e);
  } finally {
    netLoading = false;
    ctxRef.ui.invalidate();
  }
  if (current()?.network.seq !== netSeq) setTimeout(() => void refreshNetwork(), 400);
}
async function openRequest(requestId) {
  const s = current();
  if (!s) return;
  netSelected = requestId;
  netDetail = { entry: null, loading: true };
  ctxRef.ui.invalidate();
  try {
    const entry = await call("networkEntry", { id: s.id, requestId });
    netDetail = { entry, loading: !!entry && !entry.failed };
    ctxRef.ui.invalidate();
    if (entry && !entry.failed) {
      try {
        const b = await call("networkBody", { id: s.id, requestId, maxChars: 6e4 });
        netDetail = { entry, body: b.base64Encoded ? `(binary, ${b.total} base64 chars)` : b.body + (b.truncated ? `
… ${b.total - b.body.length} more characters` : "") };
      } catch (e) {
        netDetail = { entry, bodyError: errMsg(e) };
      }
    }
  } catch (e) {
    netDetail = { entry: null, bodyError: errMsg(e) };
  }
  ctxRef.ui.invalidate();
}
function scheduleAgentFade(s) {
  if (agentTimer !== null || !s?.agent) return;
  const left = s.agent.at + 6e3 - Date.now();
  if (left <= 0) return;
  agentTimer = setTimeout(() => {
    agentTimer = null;
    ctxRef.ui.invalidate();
  }, left + 50);
}
var muted = "muted";
var ghost = (key, icon, action, tooltip, disabled = false, extra = {}) => ({ type: "button", key, text: "", iconSvg: icon, iconSize: 15, action, small: true, variant: "ghost", tooltip, disabled, ...extra });
function statusDot(s) {
  switch (s.status) {
    case "running":
      return { color: "success", text: s.loading ? "Loading" : "Running" };
    case "starting":
      return { color: "warning", text: s.progress || "Starting…" };
    case "error":
      return { color: "danger", text: "Error" };
    default:
      return { color: muted, text: "Stopped" };
  }
}
function header(s) {
  const dot = s ? statusDot(s) : null;
  return { type: "row", key: "header", gap: 6, align: "center", style: { paddingX: 8, paddingY: 6 }, children: [
    {
      type: "select",
      key: "session",
      value: s?.id || null,
      placeholder: "No sessions",
      action: "pick",
      style: { width: 220 },
      options: state.sessions.map((x) => ({ value: x.id, label: `${x.name} · ${x.locationLabel}` }))
    },
    ...s && dot ? [{ type: "label", key: "status", text: `● ${dot.text}`, size: "xs", color: dot.color }] : [],
    { type: "spacer", key: "sp" },
    ...s ? [
      ...s.status === "running" || s.status === "starting" ? [ghost("stop", icons.power, "stop", "Stop the browser (the profile is kept)", busy)] : [ghost("start", icons.play, "start", "Start the browser", busy)],
      ghost("settings", icons.settings, "settings", "Session settings", busy, mode === "settings" ? { variant: "default" } : {})
    ] : [],
    { type: "button", key: "new", text: "New session", iconSvg: icons.plus, iconSize: 14, action: "create", small: true, variant: mode === "create" ? "default" : "ghost", disabled: busy }
  ] };
}
function tabStrip(s) {
  return { type: "row", key: "tabs", gap: 3, align: "center", wrap: false, style: { paddingX: 8 }, children: [
    ...s.tabs.map((t) => ({ type: "row", key: t.id, gap: 0, style: { ...terminalTabStyle(t.active), maxWidth: 220 }, children: [
      {
        type: "button",
        key: "select",
        text: (t.title || t.url || "New tab").slice(0, 40),
        iconSvg: t.loading ? icons.reload : icons.globe,
        iconSize: 13,
        action: `tab:${t.id}`,
        middleClickAction: `closeTab:${t.id}`,
        small: true,
        variant: "ghost",
        style: tabButtonStyle(t.active, true),
        tooltip: t.url
      },
      { type: "button", key: "close", text: "", iconSvg: icons.close, iconSize: 12, action: `closeTab:${t.id}`, small: true, variant: "ghost", style: tabButtonStyle(t.active, true), tooltip: "Close tab" }
    ] })),
    ghost("newTab", icons.plus, "newTab", "New tab", s.status !== "running")
  ] };
}
function toolbar(s) {
  const running = s.status === "running";
  return { type: "row", key: "toolbar", gap: 4, align: "center", style: { paddingX: 8, paddingY: 4 }, children: [
    ghost("back", icons.back, "back", "Back", !running || !s.canGoBack),
    ghost("forward", icons.forward, "forward", "Forward", !running || !s.canGoForward),
    s.loading ? ghost("stopLoad", icons.stop, "stopLoad", "Stop loading", !running) : ghost("reload", icons.reload, "reload", "Reload", !running),
    { type: "textInput", key: `url:${s.id}:${s.activeTab || ""}`, value: s.url === "about:blank" ? "" : s.url, placeholder: "Search or enter address", submitAction: "go", grow: true, disabled: !running && s.status !== "stopped", prefixSvg: icons.globe },
    ghost(
      "agent",
      icons.agent,
      "toggleAgent",
      s.agentAccess ? "Agents may use this session — click to block" : "Agents cannot use this session — click to allow",
      busy,
      { variant: s.agentAccess ? "default" : "ghost", iconColor: s.agentAccess ? "primary" : muted }
    ),
    ghost(
      "fit",
      icons.fit,
      "fit",
      fit ? "Viewport follows the panel size — click to keep a fixed size" : `Fixed viewport ${s.viewport.width}×${s.viewport.height} — click to fit the panel`,
      !running,
      { variant: fit ? "default" : "ghost" }
    ),
    ghost(
      "network",
      icons.network,
      "network",
      showNetwork ? "Hide network requests" : "Show network requests",
      false,
      { variant: showNetwork ? "default" : "ghost", badge: s.network.count ? String(Math.min(s.network.count, 999)) : "" }
    )
  ] };
}
function commandsNotice(s) {
  if (!s.agentAccess) return null;
  const section = ctxRef.state.get("internal-mcp.settings")?.sections?.find((x) => x?.key === "mcp:browser");
  if (!section || !Array.isArray(section.fields)) return null;
  const off = section.fields.filter((f) => f.value === false).length;
  if (!off) return null;
  const all = off === section.fields.length;
  return { type: "row", key: "commands", gap: 8, align: "center", style: { paddingX: 8, paddingY: 2 }, children: [
    { type: "status", key: "t", level: "warn", grow: true, text: all ? "Agent commands for browsers are turned off, so agents cannot use this session yet." : `${off} of ${section.fields.length} browser agent commands are turned off.` },
    { type: "button", key: "open", text: "Review in Settings", action: "openCommands", small: true }
  ] };
}
function agentPill(s) {
  if (!s.agent || Date.now() - s.agent.at > 6e3) return null;
  scheduleAgentFade(s);
  return { type: "row", key: "agentPill", gap: 6, align: "center", style: { paddingX: 10, paddingY: 4, background: "primary", radius: 0 }, children: [
    { type: "label", key: "t", text: `Agent is using this browser · ${s.agent.text}`, size: "xs", color: "primaryText" }
  ] };
}
function preview(s) {
  const placeholder = s.status === "starting" ? s.progress || "Starting browser…" : s.status === "error" ? "" : s.status === "stopped" ? "The browser is stopped." : "Waiting for the first frame…";
  return {
    type: "surface",
    key: `surface:${s.id}`,
    surface: s.surface,
    placeholder,
    grow: true,
    pointerAction: "ptr",
    wheelAction: "wheel",
    keyAction: "key",
    resizeAction: "resize",
    cursorSvg: icons.pointer,
    cursorLabel: "Agent",
    cursorColor: "#6d5dfc",
    style: { background: s.status === "running" ? "#ffffff" : "background" }
  };
}
var statusColor = (e) => e.failed || (e.status ?? 0) >= 400 ? "danger" : (e.status ?? 0) >= 300 ? "warning" : e.status ? "success" : muted;
var size = (n) => n === void 0 ? "" : n < 1024 ? `${n} B` : n < 1 << 20 ? `${(n / 1024).toFixed(1)} KB` : `${(n / (1 << 20)).toFixed(1)} MB`;
function shortUrl(url) {
  const m = /^[a-z]+:\/\/([^/]+)(\/[^?#]*)?/i.exec(url);
  if (!m) return url.slice(0, 120);
  const path = m[2] || "/";
  return `${path.length > 70 ? "…" + path.slice(-69) : path}  ·  ${m[1]}`;
}
function networkPane(s) {
  const rows = netRows.slice().reverse().map((e) => ({
    key: e.requestId,
    label: shortUrl(e.url),
    depth: 0,
    expandable: false,
    expanded: false,
    selected: e.requestId === netSelected,
    tooltip: e.url,
    badges: [{ text: e.failed ? e.error || "failed" : String(e.status ?? "…"), color: statusColor(e) }, { text: e.method, color: muted }, ...e.type ? [{ text: e.type.toLowerCase(), color: muted }] : []],
    badge: [e.durationMs !== void 0 ? `${e.durationMs} ms` : "", size(e.encodedBytes)].filter(Boolean).join(" · ")
  }));
  const list = rows.length ? { type: "tree", key: "requests", rows, selectAction: "request", expandAction: "noop", grow: true } : { type: "label", key: "empty", text: netLoading ? "Loading…" : "No requests yet.", size: "sm", color: muted, style: { padding: 12 } };
  const children = [
    { type: "row", key: "netbar", gap: 6, align: "center", style: { paddingX: 8, paddingY: 4 }, children: [
      { type: "label", key: "title", text: "Network", size: "sm", weight: "semibold" },
      { type: "textInput", key: "netFilter", value: netFilter, placeholder: "Filter: URL, xhr, fetch, POST…", changeAction: "netFilter", grow: true },
      ghost("clear", icons.trash, "clearNetwork", "Clear the log"),
      ghost("closeNet", icons.close, "network", "Hide network requests")
    ] }
  ];
  if (netDetail && netSelected) {
    const e = netDetail.entry;
    const headers = (h) => h ? Object.entries(h).map(([k, v]) => `${k}: ${v}`).join("\n") : "";
    const text = e ? [
      `${e.method} ${e.url}`,
      `Status: ${e.failed ? `failed (${e.error})` : `${e.status ?? "pending"} ${e.statusText || ""}`}${e.fromCache ? " (cache)" : ""}`,
      `Type: ${e.type || "?"}   MIME: ${e.mimeType || "?"}   Time: ${e.durationMs ?? "?"} ms   Size: ${size(e.encodedBytes) || "?"}`,
      "",
      "Request headers",
      headers(e.requestHeaders),
      ...e.postData ? ["", "Request body", e.postData] : [],
      "",
      "Response headers",
      headers(e.responseHeaders),
      "",
      "Response body",
      netDetail.loading ? "Loading…" : netDetail.bodyError ? `Unavailable: ${netDetail.bodyError}` : netDetail.body ?? ""
    ].join("\n") : netDetail.bodyError || "Loading…";
    children.push({ type: "split", key: "netsplit", direction: "horizontal", sizes: [0.5, 0.5], resizable: true, grow: true, children: [
      { type: "column", key: "list", grow: true, children: [list] },
      { type: "column", key: "detail", grow: true, children: [
        { type: "row", key: "dh", gap: 4, align: "center", style: { paddingX: 8 }, children: [
          { type: "label", key: "t", text: "Request", size: "sm", weight: "semibold" },
          { type: "spacer", key: "s" },
          ghost("closeDetail", icons.close, "closeDetail", "Close details")
        ] },
        { type: "scroll", key: "ds", grow: true, children: [{ type: "label", key: "body", text, mono: true, size: "xs", wrap: true, selectable: true, style: { padding: 8 } }] }
      ] }
    ] });
  } else children.push(list);
  return { type: "column", key: "network", grow: true, style: { borderTop: 1, borderColor: "border" }, children };
}
function field(key, label, control, hint) {
  return { type: "column", key, gap: 3, children: [
    { type: "label", key: "l", text: label, size: "sm", weight: "medium" },
    control,
    ...hint ? [{ type: "label", key: "h", text: hint, size: "xs", color: muted, wrap: true }] : []
  ] };
}
function formView(editing) {
  const ws = workspace;
  const remoteWs = ws && ws.location === "ssh";
  const whereOptions = [
    { value: "local", label: "This computer" },
    { value: "workspace", label: remoteWs ? `Workspace machine · ${ws.name}` : "Workspace machine (select an SSH workspace)", disabled: !remoteWs && !(editing?.location.kind === "workspace") },
    { value: "endpoint", label: "Existing DevTools endpoint" }
  ];
  const title = editing ? `Settings · ${editing.name}` : "New browser session";
  return { type: "scroll", key: "formScroll", grow: true, children: [{ type: "column", key: "form", gap: 14, style: { padding: 16, maxWidth: 560 }, children: [
    { type: "label", key: "title", text: title, size: "lg", weight: "semibold" },
    field("name", "Name", { type: "textInput", key: "f.name", value: form.name, placeholder: "e.g. QA browser", changeAction: "form:name" }),
    field(
      "where",
      "Runs on",
      { type: "select", key: "f.where", value: form.where, action: "form:where", options: whereOptions, disabled: !!editing },
      form.where === "local" ? "Uses Chrome, Chromium, Edge or Brave if installed; otherwise downloads Chrome for Testing’s headless shell." : form.where === "workspace" ? "Chrome runs on the workspace machine and is held by its Hato daemon, so it survives disconnects." : "Attach to a browser that is already running with remote debugging (ws://, wss:// or http://127.0.0.1:9222)."
    ),
    ...form.where === "endpoint" ? [field("endpoint", "Endpoint URL", { type: "textInput", key: "f.endpoint", value: form.endpoint, placeholder: "ws://127.0.0.1:9222/devtools/browser/… or wss://…", changeAction: "form:endpoint" })] : [],
    { type: "row", key: "vp", gap: 10, children: [
      field("w", "Viewport width", { type: "textInput", key: "f.width", value: form.width, changeAction: "form:width", width: 110 }),
      field("h", "Height", { type: "textInput", key: "f.height", value: form.height, changeAction: "form:height", width: 110 })
    ] },
    { type: "switch", key: "f.agent", label: "Agents and workflows may use this session", checked: form.agentAccess, action: "form:agentAccess" },
    ...form.where !== "endpoint" ? [
      { type: "switch", key: "f.keep", label: "Keep cookies and logins between launches", checked: form.keepProfile, action: "form:keepProfile" },
      ...form.where === "local" ? [{ type: "switch", key: "f.headed", label: "Also show a real browser window", checked: form.headed, action: "form:headed" }] : [],
      field("start", "Start page", { type: "textInput", key: "f.start", value: form.startUrl, placeholder: "about:blank", changeAction: "form:startUrl" }),
      field("exe", "Browser executable (optional)", { type: "textInput", key: "f.exe", value: form.executable, placeholder: editing?.executable || "Detected automatically", changeAction: "form:executable" })
    ] : [],
    ...error ? [{ type: "status", key: "err", text: error, level: "error" }] : [],
    { type: "row", key: "actions", gap: 8, children: [
      { type: "button", key: "save", text: editing ? "Save" : "Create and start", action: "submit", variant: "primary", disabled: busy },
      { type: "button", key: "cancel", text: "Cancel", action: "cancel", variant: "ghost", disabled: busy },
      { type: "spacer", key: "sp" },
      ...editing ? [{ type: "button", key: "delete", text: "Delete session", iconSvg: icons.trash, action: "delete", variant: "danger", disabled: busy }] : []
    ] }
  ] }] };
}
function emptyView() {
  return { type: "column", key: "empty", gap: 10, align: "center", grow: true, style: { padding: 32, justify: "center" }, children: [
    { type: "label", key: "t", text: "No browser sessions yet", size: "lg", weight: "semibold" },
    { type: "label", key: "d", text: "Create a persistent browser that you, your agents and workflows can share. It keeps running in the background, with its own logins.", size: "sm", color: muted, wrap: true, style: { maxWidth: 420 } },
    { type: "button", key: "c", text: "New session", iconSvg: icons.plus, action: "create", variant: "primary" }
  ] };
}
function render() {
  const s = current();
  if (s && selected !== s.id) selected = s.id;
  const top = [header(s)];
  if (mode !== "view") return { type: "column", key: "root", grow: true, children: [...top, { type: "divider", key: "d" }, formView(mode === "settings" ? s : void 0)] };
  if (!s) return { type: "column", key: "root", grow: true, children: [...top, emptyView()] };
  const body = [tabStrip(s), toolbar(s)];
  if (error) body.push({ type: "row", key: "errRow", style: { paddingX: 8 }, children: [{ type: "status", key: "err", text: error, level: "error", grow: true }] });
  if (s.status === "error" && s.error) body.push({ type: "row", key: "serr", gap: 8, align: "center", style: { paddingX: 8 }, children: [
    { type: "status", key: "t", text: s.error, level: "error", grow: true },
    { type: "button", key: "r", text: "Retry", action: "start", small: true }
  ] });
  const notice = commandsNotice(s);
  if (notice) body.push(notice);
  const pill = agentPill(s);
  const view = { type: "column", key: "view", grow: true, children: [preview(s), ...pill ? [pill] : []] };
  const main = showNetwork ? { type: "split", key: "main", direction: "vertical", sizes: [0.62, 0.38], resizable: true, grow: true, children: [view, networkPane(s)] } : view;
  return { type: "column", key: "root", grow: true, children: [...top, ...body, main] };
}
function loadForm(s) {
  form = blankForm();
  if (!s) {
    form.name = `Browser ${state.sessions.length + 1}`;
    return;
  }
  form = {
    name: s.name,
    where: s.location.kind,
    endpoint: s.location.kind === "endpoint" ? s.location.url : "",
    headed: s.headed,
    keepProfile: s.keepProfile,
    agentAccess: s.agentAccess,
    width: String(s.viewport.width),
    height: String(s.viewport.height),
    startUrl: "",
    executable: ""
  };
}
function specFromForm() {
  const width = Number(form.width), height = Number(form.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 320 || height < 240) throw new Error("Viewport must be at least 320×240");
  const location = form.where === "endpoint" ? { kind: "endpoint", url: form.endpoint.trim() } : form.where === "workspace" ? { kind: "workspace", workspaceId: workspace?.id, label: workspace?.name } : { kind: "local" };
  if (location.kind === "endpoint" && !/^(wss?|https?):\/\//i.test(location.url)) throw new Error("Enter a ws://, wss://, http:// or https:// endpoint");
  if (location.kind === "workspace" && !location.workspaceId) throw new Error("Select an SSH workspace first");
  return {
    name: form.name.trim() || "Browser",
    location,
    headed: form.headed,
    keepProfile: form.keepProfile,
    agentAccess: form.agentAccess,
    viewport: { width: Math.round(width), height: Math.round(height) },
    ...form.startUrl.trim() ? { startUrl: form.startUrl.trim() } : {},
    ...form.executable.trim() ? { executable: form.executable.trim() } : {}
  };
}
async function onEvent(ctx, ev) {
  const s = current();
  const a = ev.action;
  if (a === "ptr") return send("pointer", ev.value);
  if (a === "wheel") return send("wheel", ev.value);
  if (a === "key") return send("key", ev.value);
  if (a === "resize") {
    const v = ev.value;
    lastSize = { width: Math.round(v.width), height: Math.round(v.height) };
    if (fit && s && s.status === "running") {
      if (fitTimer !== null) clearTimeout(fitTimer);
      fitTimer = setTimeout(() => {
        fitTimer = null;
        const cur = current();
        if (cur && lastSize) void call("setViewport", { id: cur.id, ...lastSize }).catch((e) => {
          error = errMsg(e);
          ctx.ui.invalidate();
        });
      }, 350);
    }
    return;
  }
  if (a.startsWith("form:")) {
    const k = a.slice(5);
    form[k] = typeof form[k] === "boolean" ? !!ev.value : String(ev.value ?? "");
    if (k === "where" || typeof form[k] === "boolean") ctx.ui.invalidate();
    return;
  }
  switch (a) {
    case "pick":
      selected = String(ev.value);
      mode = mode === "settings" ? "view" : mode;
      netRows = [];
      netSeq = -1;
      netSelected = null;
      netDetail = null;
      error = null;
      void refreshNetwork(true);
      ctx.ui.invalidate();
      return;
    case "create":
      loadForm();
      mode = mode === "create" ? "view" : "create";
      error = null;
      ctx.ui.invalidate();
      return;
    case "settings":
      if (s) {
        loadForm(s);
        mode = mode === "settings" ? "view" : "settings";
        error = null;
        ctx.ui.invalidate();
      }
      return;
    case "cancel":
      mode = "view";
      error = null;
      ctx.ui.invalidate();
      return;
    case "submit":
      return act(async () => {
        const spec = specFromForm();
        if (mode === "settings" && s) await call("update", { id: s.id, patch: spec });
        else {
          const v = await call("create", { spec });
          selected = v.id;
        }
        mode = "view";
      });
    case "delete":
      if (s) return act(async () => {
        await call("remove", { id: s.id, deleteProfile: true });
        selected = null;
        mode = "view";
      });
      return;
    case "noop":
      return;
    case "openCommands":
      return act(() => ctx.modules.call("settings", "open", { module: "internal-mcp", section: "mcp:browser" }));
  }
  if (!s) return;
  switch (a) {
    case "start":
      return act(() => call("start", { id: s.id }, 18e4));
    case "stop":
      return act(() => call("stop", { id: s.id }));
    case "go": {
      const url = String(ev.inputs[`url:${s.id}:${s.activeTab || ""}`] ?? "").trim();
      if (!url) return;
      return act(async () => {
        if (s.status !== "running") await call("start", { id: s.id }, 18e4);
        await call("navigate", { id: s.id, url });
      });
    }
    case "back":
    case "forward":
    case "reload":
      return act(() => call("history", { id: s.id, action: a }));
    case "stopLoad":
      return act(() => call("history", { id: s.id, action: "stop" }));
    case "newTab":
      return act(() => call("newTab", { id: s.id }));
    case "toggleAgent":
      return act(() => call("update", { id: s.id, patch: { agentAccess: !s.agentAccess } }));
    case "fit":
      fit = !fit;
      if (fit && lastSize && s.status === "running") return act(() => call("setViewport", { id: s.id, ...lastSize }));
      ctx.ui.invalidate();
      return;
    case "network":
      showNetwork = !showNetwork;
      netSeq = -1;
      if (!showNetwork) {
        netSelected = null;
        netDetail = null;
      }
      void refreshNetwork(true);
      ctx.ui.invalidate();
      return;
    case "netFilter":
      netFilter = String(ev.value ?? "");
      netSeq = -1;
      void refreshNetwork(true);
      return;
    case "clearNetwork":
      netRows = [];
      netSelected = null;
      netDetail = null;
      return act(() => call("clearNetwork", { id: s.id }));
    case "request":
      return openRequest(String(ev.rowKey ?? ev.value));
    case "closeDetail":
      netSelected = null;
      netDetail = null;
      ctx.ui.invalidate();
      return;
  }
  if (a.startsWith("tab:")) return act(() => call("activateTab", { id: s.id, tab: a.slice(4) }));
  if (a.startsWith("closeTab:")) return act(() => call("closeTab", { id: s.id, tab: a.slice(9) }));
}
var mod = {
  id: "browser-panel",
  moduleApiVersion: 1,
  activate(ctx, prev) {
    ctxRef = ctx;
    if (prev) {
      selected = prev.selected ?? null;
      fit = !!prev.fit;
      showNetwork = !!prev.showNetwork;
      netFilter = prev.netFilter || "";
    }
    state = ctx.state.get("browser.state") || state;
    workspace = ctx.state.get("workspace.selected") || null;
    ctx.state.watch("browser.state", (v) => {
      if (!v) return;
      state = v;
      if (showNetwork) void refreshNetwork();
      ctx.ui.invalidate();
    });
    ctx.state.watch("workspace.selected", (v) => {
      workspace = v;
      if (mode !== "view") ctx.ui.invalidate();
    });
    ctx.state.watch("internal-mcp.settings", () => ctx.ui.invalidate());
    void refreshNetwork(true);
  },
  deactivate() {
    if (fitTimer !== null) clearTimeout(fitTimer);
    if (agentTimer !== null) clearTimeout(agentTimer);
  },
  snapshot: () => ({ selected, fit, showNetwork, netFilter }),
  render,
  onEvent
};
var index_default = mod;
export {
  index_default as default
};
