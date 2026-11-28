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

// modules/ui/remote-panel/src/index.ts
var ws = null;
var status = null;
var error = null;
var busy = null;
var timer = null;
var tunnels = [];
var localPort = "";
var remoteHost = "localhost";
var remotePort = "";
var confirmUpdate = false;
var updateNote = null;
var upgrade = null;
var showPolicy = false;
var IDLE_OPTIONS = [
  { value: "0", label: "Never" },
  { value: "15", label: "After 15 minutes" },
  { value: "60", label: "After 1 hour" },
  { value: "240", label: "After 4 hours" },
  { value: "1440", label: "After 1 day" }
];
var ACCESS_OPTIONS = [
  { value: "all", label: "All enabled workspace plugins" },
  { value: "selected", label: "Only the plugins checked below" },
  { value: "none", label: "None" }
];
var OVERRIDE_OPTIONS = (on) => [
  { value: "default", label: `Use the default (${on ? "on" : "off"})` },
  { value: "on", label: "On" },
  { value: "off", label: "Off" }
];
var overrideValue = (v) => v === null || v === void 0 ? "default" : v ? "on" : "off";
var CONCURRENT_OPTIONS = [{ value: "0", label: "No limit" }, ...[1, 2, 4, 8].map((n) => ({ value: String(n), label: `At most ${n}` }))];
var TURN_OPTIONS = [
  { value: "0", label: "No limit" },
  { value: "15", label: "15 minutes" },
  { value: "60", label: "1 hour" },
  { value: "240", label: "4 hours" }
];
var APPROVAL_OPTIONS = [
  { value: "autopilot", label: "Any (autopilot allowed)" },
  { value: "auto-low", label: "Auto-approve low-risk tools at most" },
  { value: "ask", label: "Always ask" }
];
var TOOL_KINDS = [
  { id: "execute", label: "Run commands" },
  { id: "edit", label: "Edit files" },
  { id: "delete", label: "Delete files" },
  { id: "move", label: "Move or rename files" },
  { id: "fetch", label: "Fetch from the web" }
];
var COUNT_OPTIONS = (noun) => [{ value: "0", label: "No limit" }, ...[1, 2, 4, 8, 16, 32].map((n) => ({ value: String(n), label: `At most ${n} ${noun}` }))];
var MEMORY_OPTIONS = [{ value: "0", label: "No limit" }, ...[512, 1024, 2048, 4096, 8192, 16384].map((mb) => ({ value: String(mb), label: mb < 1024 ? `${mb} MB` : `${mb / 1024} GB` }))];
var BLOCKABLE = [
  { cap: "process.scope", label: "Start programs (persistent agents need this)" },
  { cap: "pty.scope", label: "Open terminals" },
  { cap: "net.fetch", label: "Web requests" },
  { cap: "net.websocket", label: "WebSocket connections" },
  { cap: "ssh.connect", label: "SSH connections to other machines" }
];
function enforcedSection() {
  const e = status.enforced;
  if (!e) return [];
  const heading = { type: "label", key: "h-enforced", text: "Enforced by the daemon", weight: "semibold", size: "xs", color: "muted", style: { paddingY: 2 } };
  if (!e.policy) return [heading, { type: "status", key: "enforced-error", text: e.error || "Unavailable", level: "warn" }];
  const p = e.policy, denied = p.capabilityDeny || [];
  const select = (key, label, value, field, options) => ({ type: "select", key, label, value: String(value || 0), action: `enforced:${field}`, options, disabled: !!busy });
  return [
    heading,
    { type: "label", key: "blocked-h", text: "Take away from every plugin", size: "xs", color: "muted" },
    ...BLOCKABLE.map((b) => ({ type: "toggle", key: `block:${b.cap}`, label: b.label, checked: denied.includes(b.cap) || denied.includes("*"), action: "enforcedBlock", disabled: !!busy || denied.includes("*") })),
    ...denied.includes("*") ? [{ type: "status", key: "all-blocked", text: "Every capability is blocked (the daemon's saved limits could not be read). Save any change to replace them.", level: "warn" }] : [],
    select("max-procs", "Programs started by plugins", p.maxProcesses, "maxProcesses", COUNT_OPTIONS("programs")),
    select("max-terms", "Terminals opened by plugins", p.maxTerminals, "maxTerminals", COUNT_OPTIONS("terminals")),
    select("memory", "Memory per program (with everything it starts on Windows)", p.processMemoryMb, "processMemoryMb", MEMORY_OPTIONS),
    { type: "column", key: "roots", gap: 3, children: [
      { type: "label", key: "l", text: "Folders plugins may use (absolute paths, comma-separated, empty = any)", size: "xs", color: "muted", wrap: true },
      { type: "textInput", key: "roots-input", value: (p.fsRoots || []).join(", "), placeholder: "any folder", submitAction: "enforcedRoots", disabled: !!busy }
    ] },
    ...e.denials.length ? [
      { type: "label", key: "denials-h", text: "Recently refused", size: "xs", color: "muted" },
      ...e.denials.slice(0, 5).map((d, i) => ({ type: "label", key: `denial:${i}`, text: `${d.module}: ${d.reason}`, size: "xs", color: "warning", wrap: true, tooltip: `${d.op} · ${d.time}` }))
    ] : [],
    { type: "label", key: "enforced-note", text: "The daemon checks these on every request from its plugins, including ones already running, and keeps them across restarts. Programs those plugins start (such as an agent's own commands) run as your user: only the program count and memory limits apply to them.", size: "xs", color: "muted", wrap: true }
  ];
}
async function setEnforced(ctx, change) {
  const workspaceId = ws?.id, current = status?.enforced?.policy;
  if (!workspaceId || !current) return;
  const next = { ...current, ...change, capabilityDeny: (change.capabilityDeny ?? current.capabilityDeny ?? []).filter((c) => c !== "*") };
  await run(ctx, "Saving daemon limits…", () => ctx.modules.call("remote-runtime", "setEnforcedPolicy", { workspaceId, policy: next }));
}
var readOnly = () => !!(status?.policy?.limited && status.policy.readOnly);
var pluginAllowed = (id) => {
  const p = status?.policy;
  return !p || !p.limited || id === "persistence" || p.plugins === "all" || p.plugins === "selected" && p.allowed.includes(id);
};
function policySection() {
  const p = status.policy, a = p.agents, available = status.available || [];
  const defaults = status.defaults || { autoStart: true, autoPush: true };
  const muted = (key, text) => ({ type: "label", key, text, size: "xs", color: "muted", wrap: true });
  const heading = (key, text) => ({ type: "label", key, text, weight: "semibold", size: "xs", color: "muted", style: { paddingY: 2 } });
  const select = (key, label, value, action, options) => ({ type: "select", key, label, value, action, options, disabled: !!busy });
  const list = (key, label, values, placeholder) => ({ type: "column", key, gap: 3, children: [
    { type: "label", key: "l", text: label, size: "xs", color: "muted" },
    { type: "textInput", key: `${key}-input`, value: values.join(", "), placeholder, submitAction: "policyLists", disabled: !!busy }
  ] });
  return { type: "column", key: "policy", gap: 8, style: { background: "raised", borderColor: "border", borderWidth: 1, radius: 8, paddingX: 10, paddingY: 8 }, children: [
    { type: "row", key: "head", gap: 6, align: "center", children: [
      { type: "label", key: "title", text: "Settings for this machine", weight: "semibold", size: "sm", grow: true },
      { type: "button", key: "global", text: "Defaults…", action: "openGlobalSettings", small: true, variant: "ghost", tooltip: "Settings that apply to every machine" }
    ] },
    heading("h-daemon", "Daemon"),
    select("auto-start", "Start the daemon when a project here is opened", overrideValue(p.autoStart), "policyAutoStart", OVERRIDE_OPTIONS(defaults.autoStart)),
    select("auto-push", "Send workspace plugins automatically", overrideValue(p.autoPush), "policyAutoPush", OVERRIDE_OPTIONS(defaults.autoPush)),
    { type: "toggle", key: "unlimited", label: "Unlimited: allow everything on this machine", checked: !p.limited, action: "policyUnlimited", disabled: !!busy },
    ...p.limited ? limitControls(p, a, available, heading, select, list, muted) : [muted("unlimited-note", "No limits apply here. Turn this off to choose what plugins and agents may do; your choices are kept when you turn it back on.")]
  ] };
}
function limitControls(p, a, available, heading, select, list, muted) {
  return [
    { type: "toggle", key: "read-only", label: "Read-only: send nothing new to this machine", checked: p.readOnly, action: "policyReadOnly", disabled: !!busy },
    select("idle", "Stop detached terminals", String(p.idleTerminalMinutes), "policyIdle", IDLE_OPTIONS),
    heading("h-plugins", "Plugins"),
    select("access", "Plugins allowed to run here", p.plugins, "policyAccess", ACCESS_OPTIONS),
    ...p.plugins === "selected" ? available.length ? available.map((a2) => ({ type: "toggle", key: `allow:${a2.id}`, label: a2.name, checked: p.allowed.includes(a2.id), action: "policyAllow", disabled: !!busy })) : [muted("no-available", "No enabled plugins are meant to run on a workspace machine.")] : [],
    heading("h-agents", "Persistent agents"),
    select("max-agents", "Connected agents", String(a.maxConcurrent), "policyAgents:maxConcurrent", CONCURRENT_OPTIONS),
    select("max-turn", "Stop a turn after", String(a.maxTurnMinutes), "policyAgents:maxTurnMinutes", TURN_OPTIONS),
    select("approval-cap", "Automatic approval", a.approvalCap, "policyAgents:approvalCap", APPROVAL_OPTIONS),
    { type: "label", key: "deny-h", text: "Always refuse these tools", size: "xs", color: "muted" },
    ...TOOL_KINDS.map((k) => ({ type: "toggle", key: `deny:${k.id}`, label: k.label, checked: a.deniedToolKinds.includes(k.id), action: "policyDenyTool", disabled: !!busy })),
    list("providers", "Allowed providers (comma-separated ids, empty = any)", a.allowedProviders, "e.g. claude, codex"),
    list("models", "Allowed models (comma-separated ids, empty = any)", a.allowedModels, "any model"),
    muted("lists-hint", "Press Enter in a list to save it."),
    ...status.limitsError ? [{ type: "status", key: "limits-error", text: status.limitsError, level: "warn" }] : [],
    ...enforcedSection(),
    muted("note", "Plugin and daemon rules above are applied by this desktop. Idle terminals are stopped only while it is connected. Agent limits are applied by the agent runtime on the machine, for agents that connect after the change. Running plugins that are no longer allowed are listed below with a button to stop them.")
  ];
}
async function setPolicy(ctx, change) {
  const workspaceId = ws?.id;
  if (!workspaceId || !status?.policy) return;
  const next = { ...status.policy, ...change };
  status = { ...status, policy: next };
  await run(ctx, "Saving machine settings…", () => ctx.modules.call("remote-runtime", "setPolicy", { workspaceId, policy: next }));
}
async function refresh(ctx) {
  if (!ws) {
    status = null;
    ctx.ui.invalidate();
    return;
  }
  const workspaceId = ws.id;
  try {
    const next = await ctx.modules.call("remote-runtime", "status", { workspaceId }, { timeoutMs: 6e4 });
    const forwards = await ctx.modules.call("remote-runtime", "tunnels", { workspaceId });
    if (ws?.id !== workspaceId) return;
    status = next;
    error = null;
    tunnels = forwards;
  } catch (e) {
    if (ws?.id !== workspaceId) return;
    error = errMsg(e);
  }
  ctx.ui.invalidate();
}
async function run(ctx, label, fn) {
  busy = label;
  error = null;
  ctx.ui.invalidate();
  let failure = null;
  try {
    await fn();
  } catch (e) {
    failure = errMsg(e);
  }
  busy = null;
  await refresh(ctx);
  if (failure) {
    error = failure;
    ctx.ui.invalidate();
  }
}
var row = (key, label, detail, actions) => ({ type: "row", key, gap: 6, align: "center", padding: 2, children: [
  { type: "column", key: "t", grow: true, gap: 0, children: [
    { type: "label", key: "l", text: label, size: "sm", mono: true },
    { type: "label", key: "d", text: detail, size: "xs", color: "muted" }
  ] },
  ...actions
] });
var card = { background: "raised", borderColor: "border", borderWidth: 1, radius: 8, paddingX: 10, paddingY: 8 };
var chip = (key, text, color, bg) => ({ type: "label", key, text, size: "xs", weight: "medium", color, style: { background: bg, radius: 9, paddingX: 7, paddingY: 1, noShrink: true } });
var iconBtn = (key, icon, tooltip, action, extra = {}) => ({ type: "button", key, text: "", iconSvg: icon, iconSize: 14, action, small: true, variant: "ghost", tooltip, ...extra });
var PRESETS = [3e3, 5e3, 5173, 8e3, 8080];
var portError = (s, optional) => {
  const v = s.trim();
  if (!v) return optional ? null : "";
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? null : "Ports are whole numbers from 1 to 65535.";
};
function tunnelCard(t) {
  const url = `http://localhost:${t.localPort}`;
  const target = `${t.remoteHost}:${t.remotePort}`;
  return { type: "row", key: `tunnel:${t.id}`, gap: 8, align: "center", style: card, children: [
    { type: "label", key: "dot", text: "●", size: "xs", color: "success", tooltip: "Forwarding" },
    { type: "column", key: "addr", grow: true, gap: 1, children: [
      { type: "label", key: "local", text: `localhost:${t.localPort}`, size: "sm", weight: "medium", mono: true, selectable: true },
      { type: "label", key: "remote", text: t.remoteHost === "localhost" && t.localPort === t.remotePort ? "same port on server" : `server → ${target}`, size: "xs", color: "muted", mono: true }
    ] },
    iconBtn("copy", uiIcons.copy, `Copy ${url}`, "", { copyText: url }),
    iconBtn("stop", uiIcons.x, "Stop forwarding", "stopTunnel", { value: t.id, disabled: !!busy, iconColor: "danger" })
  ] };
}
function forwardingSection() {
  const remoteErr = portError(remotePort, false), localErr = portError(localPort, true);
  const fieldErr = remoteErr ?? localErr;
  const canSubmit = !busy && fieldErr === null;
  const taken = new Set(tunnels.map((t) => Number(t.localPort)));
  const presets = PRESETS.filter((p) => !taken.has(p));
  const field = (key, label, input2, width) => ({ type: "column", key, gap: 3, ...width ? { width } : { grow: true }, children: [{ type: "label", key: "l", text: label, size: "xs", color: "muted" }, input2] });
  const input = (key, value, placeholder) => ({ type: "textInput", key, value, placeholder, changeAction: "tunnelInput", submitAction: "startTunnel", disabled: !!busy });
  return { type: "column", key: "forwarding", gap: 8, children: [
    { type: "divider", key: "sep" },
    { type: "row", key: "heading", align: "center", gap: 6, children: [
      { type: "label", key: "title", text: "Port forwarding", weight: "semibold", size: "sm", grow: true },
      ...tunnels.length ? [chip("count", `${tunnels.length} active`, "success", "#2fa36b1f")] : []
    ] },
    ...tunnels.length ? tunnels.map(tunnelCard) : [{ type: "label", key: "empty", text: "Reach a service running on the server (a dev server, database, dashboard…) as if it were on this computer.", size: "xs", color: "muted", wrap: true }],
    // Stacked so it stays readable in a narrow sidebar: ports side by side, host full width,
    // wrapping quick picks, then a full-width submit.
    { type: "column", key: "form", gap: 8, style: { ...card, background: "panel" }, children: [
      { type: "row", key: "ports", gap: 6, children: [
        field("remote-port", "Server port", input("fwdRemotePort", remotePort, "e.g. 3000")),
        field("local-port", "Local port", input("fwdLocalPort", localPort, remotePort.trim() || "same"))
      ] },
      field("host", "Host on server", input("fwdHost", remoteHost, "localhost")),
      ...fieldErr ? [{ type: "label", key: "err", text: fieldErr, size: "xs", color: "danger", wrap: true }] : [],
      { type: "button", key: "start-tunnel", text: "Forward port", iconSvg: uiIcons.plus, action: "startTunnel", variant: "primary", small: true, disabled: !canSubmit, style: { fullWidth: true, justify: "center" } },
      ...presets.length ? [{ type: "column", key: "quick", gap: 4, children: [
        { type: "label", key: "l", text: "Quick forward", size: "xs", color: "muted" },
        { type: "row", key: "chips", gap: 4, wrap: true, children: presets.map((p) => ({ type: "button", key: `preset:${p}`, text: String(p), action: "forwardPreset", value: p, small: true, disabled: !!busy, tooltip: `Forward localhost:${p} on the server`, style: { paddingX: 8, noShrink: true } })) }
      ] }] : []
    ] }
  ] };
}
async function startTunnel(ctx, workspaceId, args) {
  const remote = args.remotePort.trim();
  if (portError(remote, false) !== null || portError(args.localPort, true) !== null) return;
  const local = args.localPort.trim() || remote, host = args.remoteHost.trim() || "localhost";
  await run(ctx, `Forwarding localhost:${local}…`, async () => {
    await ctx.modules.call("remote-runtime", "startTunnel", { workspaceId, localPort: local, remoteHost: host, remotePort: remote });
    localPort = "";
    remotePort = "";
    remoteHost = "localhost";
  });
}
var mod = {
  id: "remote-panel",
  moduleApiVersion: 1,
  async activate(ctx) {
    ws = ctx.state.get("workspace.selected") || null;
    ctx.state.watch("workspace.selected", (v) => {
      const changed = ws?.id !== v?.id;
      ws = v;
      if (changed) {
        status = null;
        confirmUpdate = false;
        upgrade = null;
        updateNote = null;
        void refresh(ctx);
      } else ctx.ui.invalidate();
    });
    ctx.events.on("remote-runtime.changed", () => {
      void refresh(ctx);
    });
    timer = setInterval(() => {
      if (ctx.state.get("workspace-layout.panels")?.remote) void refresh(ctx);
    }, 5e3);
    await refresh(ctx);
  },
  deactivate() {
    if (timer) clearInterval(timer);
  },
  render() {
    const kids = [];
    if (!ws) return { type: "column", key: "root", padding: 8, children: [{ type: "label", key: "none", text: "Select a project or task.", color: "muted" }] };
    kids.push({ type: "row", key: "head", gap: 6, align: "center", children: [
      { type: "label", key: "machine", text: status ? `${status.machineId}` : ws.machineId, weight: "semibold", size: "sm", grow: true },
      ...status?.running ? [{
        type: "button",
        key: "force-update",
        text: confirmUpdate ? "Confirm update" : "Force update",
        action: confirmUpdate ? "forceUpdate" : "askForceUpdate",
        small: true,
        variant: confirmUpdate ? "danger" : "ghost",
        disabled: !!busy || readOnly(),
        tooltip: confirmUpdate ? "Replaces every daemon plugin now. Running background agents and workflow runs stop and must reconnect." : "Send this desktop's current build of all daemon plugins, even while they are busy"
      }] : [],
      ...status?.running && (status.location === "ssh" || status.location === "cloud" || status.location === "local") ? [{
        type: "button",
        key: "force-upgrade",
        text: "Force upgrade",
        action: "prepareUpgrade",
        small: true,
        disabled: !!busy,
        variant: status.stale ? "primary" : "ghost",
        tooltip: status.location === "local" ? "Restart this computer's daemon with this app's build after confirmation (stops what it holds)" : "Replace the native daemon over SSH and restart it after confirmation"
      }] : [],
      ...confirmUpdate ? [{ type: "button", key: "cancel-update", text: "Cancel", action: "cancelForceUpdate", small: true, variant: "ghost" }] : [],
      ...status?.policy ? [{
        type: "button",
        key: "policy",
        text: "",
        iconSvg: uiIcons["sliders-horizontal"],
        action: "togglePolicy",
        small: true,
        variant: showPolicy ? "default" : "ghost",
        tooltip: "Settings for this machine: allowed plugins, read-only, idle terminals"
      }] : [],
      { type: "button", key: "refresh", text: "", iconSvg: uiIcons.refresh, action: "refresh", small: true, variant: "ghost", tooltip: "Refresh" }
    ] });
    if (readOnly()) kids.push({ type: "status", key: "read-only", text: "Read-only: nothing new is sent to this machine.", level: "warn" });
    if (showPolicy && status?.policy) kids.push(policySection());
    if (updateNote) kids.push({ type: "status", key: "update-note", text: updateNote, level: "success" });
    if (busy) kids.push({ type: "progress", key: "busy", indeterminate: true, label: busy });
    if (error || status?.error) kids.push({ type: "status", key: "err", text: error || status.error, level: "error" });
    if (upgrade && upgrade.workspaceId === ws.id) kids.push({ type: "column", key: "upgrade-options", gap: 6, children: [
      { type: "label", key: "title", text: "SSH profile for this Cloud host", size: "sm", weight: "semibold" },
      ...upgrade.profiles.length ? [{
        type: "select",
        key: "upgrade-profile",
        value: upgrade.profileId || null,
        action: "upgradeProfile",
        options: upgrade.profiles.map((p) => ({ label: p.label, value: p.id }))
      }] : [{ type: "label", key: "no-profile", text: "Add an SSH profile for the enrolled host first.", size: "xs", color: "muted", wrap: true }],
      { type: "row", key: "actions", gap: 6, children: [
        { type: "button", key: "cancel-upgrade", text: "Cancel", action: "cancelUpgrade", small: true, disabled: !!busy },
        { type: "button", key: "confirm-upgrade", text: "Continue", action: "forceUpgrade", small: true, variant: "primary", disabled: !!busy || !upgrade.profileId }
      ] }
    ] });
    if (!status) return { type: "column", key: "root", padding: 8, gap: 6, children: kids };
    if (!status.running) {
      kids.push({ type: "label", key: "off", text: "The Hato daemon is not running on this machine. Terminals and plugins stop when the connection drops.", size: "sm", color: "muted", wrap: true });
      kids.push({ type: "button", key: "start", text: "Start daemon", action: "ensure", variant: "primary", small: true, disabled: !!busy });
    }
    if (status.running) {
      kids.push({ type: "label", key: "ver", text: `daemon ${status.version} · pid ${status.pid}${status.stale ? " · older build" : ""}`, size: "xs", color: status.stale ? "warning" : "muted" });
      const ptys = status.resources?.ptys || [], procs = status.resources?.procs || [];
      kids.push({ type: "label", key: "h-res", text: `Held on the server (${ptys.length + procs.length})`, weight: "semibold", size: "sm" });
      for (const p of ptys) kids.push(row(`pty:${p.key}`, p.key, `terminal · ${p.exit ? `exited (${p.exit})` : p.attached ? "attached" : "detached"} · ${p.cwd}`, [
        { type: "button", key: "kill", text: "Stop", action: "kill", value: { kind: "pty", key: p.key }, small: true, variant: "danger", disabled: !!busy }
      ]));
      for (const p of procs) kids.push(row(`proc:${p.key}`, p.key, `process ${p.pid} · ${p.exit ? "exited" : p.attached ? "attached" : `detached, ${p.bufferedBytes} bytes buffered`}`, [
        { type: "button", key: "kill", text: "Stop", action: "kill", value: { kind: "proc", key: p.key }, small: true, variant: "danger", disabled: !!busy }
      ]));
      const remote = status.plugins || [];
      const candidates = status.candidates || [];
      kids.push({ type: "label", key: "h-plg", text: "Plugins on the server", weight: "semibold", size: "sm" });
      if (!remote.length && !candidates.length) kids.push({ type: "label", key: "no-plg", text: 'None. Plugins with runsOn: "workspace" are sent here when enabled.', size: "xs", color: "muted", wrap: true });
      const policy = status.policy, allowed = pluginAllowed;
      const canSend = (id) => !readOnly() && allowed(id);
      const blockedRunning = remote.filter((p) => p.enabled && !allowed(p.id));
      if (blockedRunning.length) kids.push({ type: "row", key: "blocked-running", gap: 6, align: "center", children: [
        { type: "label", key: "t", text: `${blockedRunning.length} running plugin${blockedRunning.length === 1 ? " is" : "s are"} no longer allowed here.`, size: "xs", color: "warning", grow: true, wrap: true },
        { type: "button", key: "stop-blocked", text: "Stop them", action: "stopDisallowed", small: true, variant: "danger", disabled: !!busy }
      ] });
      for (const p of remote) kids.push(row(`rp:${p.id}`, p.id, `${p.enabled ? p.active || "loading" : "disabled"}${p.lastError && !p.active ? ` · ${p.lastError}` : ""}${allowed(p.id) ? "" : " · not allowed by this machine's settings"}`, [
        ...p.enabled ? [{ type: "button", key: "dis", text: "Stop", action: "disable", value: p.id, small: true, disabled: !!busy, variant: allowed(p.id) ? "default" : "danger" }] : [],
        { type: "button", key: "push", text: "Update", action: "push", value: p.id, small: true, disabled: !!busy || !canSend(p.id) }
      ]));
      for (const id of candidates.filter((id2) => !remote.some((p) => p.id === id2))) kids.push(row(`cp:${id}`, id, "enabled here, not on the server yet", [
        { type: "button", key: "push", text: "Send", action: "push", value: id, small: true, variant: "primary", disabled: !!busy || !canSend(id) }
      ]));
      for (const s of (status.skipped || []).filter((s2) => !remote.some((p) => p.id === s2.id))) kids.push(row(`sp:${s.id}`, s.id, s.reason, []));
    }
    if (status.location === "ssh") kids.push(forwardingSection());
    return { type: "column", key: "root", padding: 8, gap: 6, scroll: true, grow: true, children: kids };
  },
  async onEvent(ctx, ev) {
    const workspaceId = ws?.id;
    if (!workspaceId) return;
    const forceUpgrade = (profileId) => run(ctx, "Upgrading native daemon…", async () => {
      const result = await ctx.modules.call("remote-runtime", "forceUpgrade", { workspaceId, profileId }, { timeoutMs: 62e4 });
      if (ws?.id !== workspaceId) return;
      upgrade = null;
      updateNote = `Native daemon restarted (PID ${result.status.pid}).`;
    });
    switch (ev.action) {
      case "tunnelInput":
        if (ev.key === "fwdLocalPort") localPort = String(ev.value ?? ev.inputs?.fwdLocalPort ?? "");
        if (ev.key === "fwdHost") remoteHost = String(ev.value ?? ev.inputs?.fwdHost ?? "");
        if (ev.key === "fwdRemotePort") remotePort = String(ev.value ?? ev.inputs?.fwdRemotePort ?? "");
        ctx.ui.invalidate();
        return;
      case "startTunnel":
        localPort = ev.inputs?.fwdLocalPort ?? localPort;
        remoteHost = ev.inputs?.fwdHost ?? remoteHost;
        remotePort = ev.inputs?.fwdRemotePort ?? remotePort;
        return startTunnel(ctx, workspaceId, { localPort, remoteHost, remotePort });
      case "forwardPreset":
        return startTunnel(ctx, workspaceId, { localPort: String(ev.value), remoteHost: "localhost", remotePort: String(ev.value) });
      case "stopTunnel":
        return run(ctx, "Stopping forward…", () => ctx.modules.call("remote-runtime", "stopTunnel", { workspaceId, id: ev.value }));
      case "refresh":
        return refresh(ctx);
      case "togglePolicy":
        showPolicy = !showPolicy;
        ctx.ui.invalidate();
        return;
      case "openGlobalSettings":
        ctx.events.emit("settings.open", { category: JSON.stringify(["remote-runtime", "remote"]) });
        return;
      case "policyAccess":
        return setPolicy(ctx, { plugins: String(ev.value) });
      case "policyUnlimited":
        return setPolicy(ctx, { limited: ev.value !== true });
      case "policyReadOnly":
        return setPolicy(ctx, { readOnly: ev.value === true });
      case "policyIdle":
        return setPolicy(ctx, { idleTerminalMinutes: Number(ev.value) });
      case "policyAutoStart":
      case "policyAutoPush": {
        const v = ev.value === "on" ? true : ev.value === "off" ? false : null;
        return setPolicy(ctx, ev.action === "policyAutoStart" ? { autoStart: v } : { autoPush: v });
      }
      case "policyAgents:maxConcurrent":
      case "policyAgents:maxTurnMinutes":
      case "policyAgents:approvalCap": {
        const field = ev.action.slice("policyAgents:".length);
        return setPolicy(ctx, { agents: { ...status.policy.agents, [field]: field === "approvalCap" ? String(ev.value) : Number(ev.value) } });
      }
      case "policyDenyTool": {
        const kind = String(ev.key).replace(/^deny:/, ""), current = status?.policy?.agents?.deniedToolKinds || [];
        return setPolicy(ctx, { agents: { ...status.policy.agents, deniedToolKinds: ev.value === true ? [.../* @__PURE__ */ new Set([...current, kind])] : current.filter((k) => k !== kind) } });
      }
      case "policyLists": {
        const ids = (text, fallback) => text === void 0 ? fallback : text.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
        const agents = status.policy.agents;
        return setPolicy(ctx, { agents: {
          ...agents,
          allowedProviders: ids(ev.inputs?.["providers-input"], agents.allowedProviders),
          allowedModels: ids(ev.inputs?.["models-input"], agents.allowedModels)
        } });
      }
      case "enforced:maxProcesses":
      case "enforced:maxTerminals":
      case "enforced:processMemoryMb":
        return setEnforced(ctx, { [ev.action.slice("enforced:".length)]: Number(ev.value) });
      case "enforcedBlock": {
        const cap = String(ev.key).replace(/^block:/, ""), current = (status?.enforced?.policy?.capabilityDeny || []).filter((c) => c !== "*");
        return setEnforced(ctx, { capabilityDeny: ev.value === true ? [.../* @__PURE__ */ new Set([...current, cap])] : current.filter((c) => c !== cap) });
      }
      case "enforcedRoots": {
        const text = ev.inputs?.["roots-input"];
        if (text === void 0) return;
        return setEnforced(ctx, { fsRoots: text.split(",").map((x) => x.trim()).filter(Boolean) });
      }
      case "stopDisallowed":
        return run(ctx, "Stopping plugins that are not allowed…", () => ctx.modules.call("remote-runtime", "stopDisallowed", { workspaceId }, { timeoutMs: 12e4 }));
      case "policyAllow": {
        const id = String(ev.key).replace(/^allow:/, ""), current = status?.policy?.allowed || [];
        return setPolicy(ctx, { allowed: ev.value === true ? [.../* @__PURE__ */ new Set([...current, id])] : current.filter((a) => a !== id) });
      }
      case "askForceUpdate":
        confirmUpdate = true;
        updateNote = null;
        ctx.ui.invalidate();
        return;
      case "cancelForceUpdate":
        confirmUpdate = false;
        ctx.ui.invalidate();
        return;
      case "prepareUpgrade": {
        if (busy) return;
        updateNote = null;
        confirmUpdate = false;
        if (ws.location === "ssh" || ws.location === "local") return forceUpgrade();
        if (ws.location !== "cloud") return;
        return run(ctx, "Loading SSH profiles…", async () => {
          const profiles = await ctx.modules.call("remote-runtime", "upgradeProfiles");
          if (ws?.id === workspaceId) upgrade = { workspaceId, profiles, profileId: profiles.length === 1 ? profiles[0].id : "" };
        });
      }
      case "upgradeProfile":
        if (upgrade && upgrade.workspaceId === workspaceId && upgrade.profiles.some((p) => p.id === ev.value)) upgrade.profileId = String(ev.value);
        ctx.ui.invalidate();
        return;
      case "cancelUpgrade":
        upgrade = null;
        ctx.ui.invalidate();
        return;
      case "forceUpgrade":
        if (!busy && upgrade && upgrade.workspaceId === workspaceId && upgrade.profileId) return forceUpgrade(upgrade.profileId);
        return;
      case "forceUpdate":
        confirmUpdate = false;
        return run(ctx, "Updating daemon plugins…", async () => {
          const r = await ctx.modules.call("remote-runtime", "forceUpdate", { workspaceId }, { timeoutMs: 6e5 });
          const reloaded = (r?.plugins || []).filter((p) => p.reloaded).map((p) => p.id);
          const failed = (r?.plugins || []).filter((p) => p.error);
          if (failed.length) throw new Error("Update failed for " + failed.map((p) => `${p.id} (${p.error})`).join(", "));
          updateNote = reloaded.length ? `Updated ${reloaded.join(", ")}. Reconnect background agents to continue.` : "Daemon plugins were already up to date.";
        });
      case "ensure":
        return run(ctx, "Starting daemon…", () => ctx.modules.call("remote-runtime", "ensure", { workspaceId }, { timeoutMs: 6e5 }));
      case "kill":
        return run(ctx, "Stopping…", () => ctx.modules.call("remote-runtime", "kill", { workspaceId, ...ev.value }));
      case "push":
        return run(ctx, `Sending ${ev.value}…`, () => ctx.modules.call("remote-runtime", "push", { workspaceId, id: ev.value }, { timeoutMs: 12e4 }));
      case "disable":
        return run(ctx, `Stopping ${ev.value}…`, () => ctx.modules.call("remote-runtime", "disable", { workspaceId, id: ev.value }));
    }
  }
};
var index_default = mod;
export {
  index_default as default
};
