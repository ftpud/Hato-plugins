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

// ../sdk/mcp-servers.ts
var transportOf = (m) => m.transport === "http" || m.transport === "sse" ? m.transport : "stdio";
function parseHttpUrl(url) {
  const m = /^(https?):\/\/([^/?#@\s]+)([^?#\s]*)(?:\?[^#\s]*)?(?:#\S*)?$/i.exec(String(url || "").trim());
  if (!m) return null;
  const scheme = m[1].toLowerCase(), host = m[2].toLowerCase();
  return { scheme, host, origin: `${scheme}://${host}`, path: m[3] || "/" };
}
function importMcpConfig(text) {
  const raw = text.trim();
  if (!raw) return [];
  if (/^https?:\/\//i.test(raw) && !/\s/.test(raw)) return [remoteDraft(nameFromUrl(raw), { url: raw })];
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error('Paste JSON (e.g. {"mcpServers": {...}}) or a server URL');
  }
  const map = json?.mcpServers || json?.servers || json?.mcp?.servers;
  const entries = map && typeof map === "object" ? Object.entries(map) : json && (json.command || json.url) ? [[String(json.name || (json.url ? nameFromUrl(json.url) : json.command)), json]] : [];
  if (!entries.length) throw new Error("No MCP servers found in the pasted JSON");
  return entries.map(([name, s]) => {
    if (typeof s?.url === "string") return remoteDraft(name, s);
    if (typeof s?.command !== "string") throw new Error(`Server "${name}" needs a command or url`);
    const env = s.env && typeof s.env === "object" ? Object.entries(s.env).map(([k, v]) => ({ name: k, value: String(v) })) : [];
    return { name, transport: "stdio", command: s.command, args: Array.isArray(s.args) ? s.args.map(String) : [], env, enabled: true };
  });
}
function remoteDraft(name, s) {
  const headers = s.headers && typeof s.headers === "object" ? Object.entries(s.headers).map(([k, v]) => ({ name: k, value: String(v) })) : [];
  const bearer = headers.find((h) => h.name.toLowerCase() === "authorization" && /^bearer\s+/i.test(h.value));
  const type = String(s.type || s.transport || "").toLowerCase();
  return {
    name,
    transport: type === "sse" || /\/sse\/?$/.test(s.url) ? "sse" : "http",
    command: "",
    args: [],
    env: [],
    url: s.url,
    enabled: true,
    headers: headers.filter((h) => h !== bearer),
    auth: bearer ? { type: "bearer", token: bearer.value.replace(/^bearer\s+/i, "") } : { type: s.oauth === false ? "none" : "oauth" }
  };
}
function nameFromUrl(url) {
  const host = parseHttpUrl(url)?.host.replace(/:\d+$/, "") || "Remote server";
  const parts = host.split(".").filter((p) => !["mcp", "api", "www", "com", "app", "dev", "io", "ai", "net", "org"].includes(p));
  const word = parts[parts.length - 1] || host;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// modules/ui/mcp-panel/src/index.ts
var PRESETS = [
  { key: "linear", label: "Linear", hint: "Issues and projects · OAuth", make: () => ({ kind: "remote", name: "Linear", url: "https://mcp.linear.app/mcp", authType: "oauth" }) },
  { key: "notion", label: "Notion", hint: "Pages and databases · OAuth", make: () => ({ kind: "remote", name: "Notion", url: "https://mcp.notion.com/mcp", authType: "oauth" }) },
  { key: "sentry", label: "Sentry", hint: "Errors and issues · OAuth", make: () => ({ kind: "remote", name: "Sentry", url: "https://mcp.sentry.dev/mcp", authType: "oauth" }) },
  { key: "context7", label: "Context7", hint: "Library docs · no sign-in", make: () => ({ kind: "remote", name: "Context7", url: "https://mcp.context7.com/mcp", authType: "none" }) },
  { key: "github", label: "GitHub", hint: "Repositories · personal access token", make: () => ({ kind: "remote", name: "GitHub", url: "https://api.githubcopilot.com/mcp/", authType: "bearer" }) },
  { key: "filesystem", label: "Filesystem", hint: "Local files · runs with npx", make: () => ({ kind: "local", name: "Filesystem", command: "npx", args: "-y\n@modelcontextprotocol/server-filesystem\n.", env: "" }) }
];
var servers = [];
var selected = null;
var filter = "";
var draft = null;
var flows = {};
var error = null;
var notice = null;
var busy = false;
var removeId = null;
var alive = true;
var showBuiltin = false;
var pending = /* @__PURE__ */ new Map();
function request(ctx, method, args = {}, timeoutMs = 15e3) {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error("MCP configuration request timed out"));
    }, timeoutMs);
    pending.set(requestId, { resolve, reject, timer });
    ctx.events.emit("mcp-panel.request", { requestId, method, args });
  });
}
async function refresh(ctx) {
  try {
    const next = await request(ctx, "listMcps");
    if (alive) {
      servers = next;
      error = null;
    }
  } catch (e) {
    if (alive) error = errMsg(e);
  }
  if (alive) ctx.ui.invalidate();
}
var card = { background: "raised", borderColor: "border", borderWidth: 1, radius: 10, padding: 10, gap: 6 };
var chip = (key, text, color, bg) => ({ type: "label", key, text, size: "xs", weight: "medium", color, style: { background: bg, radius: 9, paddingX: 7, paddingY: 1, noShrink: true } });
var btn = (key, text, action, opts = {}) => ({ type: "button", key, text, action, small: true, iconSvg: opts.icon, variant: opts.variant, tooltip: opts.tooltip, value: opts.value, disabled: opts.disabled ?? busy, copyText: opts.copy });
var fieldLabel = (key, text, hint) => ({ type: "row", key, gap: 6, align: "center", children: [
  { type: "label", key: "t", text, size: "sm", weight: "medium" },
  ...hint ? [{ type: "label", key: "h", text: hint, size: "xs", color: "muted", grow: true }] : []
] });
var input = (key, value, placeholder, extra = {}) => ({
  type: "textInput",
  key,
  value,
  placeholder,
  changeAction: `field:${key.slice(2)}`,
  secret: extra.secret,
  multiline: extra.multiline,
  rows: extra.rows,
  ...extra.mono ? { style: { font: "mono" } } : {}
});
function hostOf(s) {
  return parseHttpUrl(s.url || "")?.host || s.url || "";
}
function minutes(ms) {
  const m = Math.round(ms / 6e4);
  return m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`;
}
function iconFor(s) {
  return s.builtin ? uiIcons.sparkles : transportOf(s) === "stdio" ? uiIcons.terminal : s.auth?.type === "oauth" ? uiIcons["cloud-lock"] : uiIcons.globe;
}
function health(s) {
  if (s.builtin) return { text: "Built-in", tone: "info", detail: s.description || "Provided by Hato" };
  if (s.enabled === false) return { text: "Off", tone: "off", detail: "Not offered to new agents" };
  const flow = flows[s.id];
  if (flow && ["discovering", "waiting", "exchanging"].includes(flow.status)) return { text: "Signing in…", tone: "warn", detail: "Finish signing in in your browser" };
  if (transportOf(s) !== "stdio" && s.auth?.type === "oauth") {
    const st = s.authStatus?.state;
    if (st === "signedIn") return { text: "Signed in", tone: "ok", detail: s.authStatus?.expiresAt && !s.authStatus.refreshable ? `Token expires in ${minutes(s.authStatus.expiresAt - Date.now())}` : `Connected to ${s.authStatus?.issuer ? parseHttpUrl(s.authStatus.issuer)?.host || s.authStatus.issuer : hostOf(s)}` };
    return { text: st === "expired" ? "Expired" : "Sign in", tone: "warn", detail: "Sign in before agents can use it" };
  }
  return { text: transportOf(s) === "stdio" ? "Local" : "Remote", tone: "ok", detail: transportOf(s) === "stdio" ? "Runs on the agent's machine" : hostOf(s) };
}
var toneColor = { ok: "success", warn: "warning", off: "muted", info: "primary" };
var toneBg = { ok: "#2f9e6a22", warn: "#d8962022", off: "#80808022", info: "#6f7cf622" };
function summary(s) {
  if (s.builtin) return s.description || "";
  if (transportOf(s) === "stdio") return [s.command, ...s.args || []].join(" ");
  return s.url || "";
}
function blankDraft() {
  return {
    id: crypto.randomUUID(),
    isNew: true,
    kind: "remote",
    name: "",
    enabled: true,
    command: "",
    args: "",
    env: "",
    url: "",
    transport: "http",
    authType: "oauth",
    token: "",
    headers: "",
    clientId: "",
    clientSecret: "",
    scopes: "",
    redirectPort: "",
    advanced: false,
    importing: false,
    importText: "",
    probe: null
  };
}
function draftFrom(server, copy = false) {
  const d = blankDraft();
  const remote = transportOf(server) !== "stdio";
  Object.assign(d, {
    id: copy ? crypto.randomUUID() : server.id,
    isNew: copy,
    kind: remote ? "remote" : "local",
    name: copy ? `${server.name} copy` : server.name,
    enabled: server.enabled !== false,
    command: server.command || "",
    args: (server.args || []).join("\n"),
    env: (server.env || []).map((e) => `${e.name}=${e.value}`).join("\n"),
    url: server.url || "",
    transport: server.transport === "sse" ? "sse" : "http",
    authType: server.auth?.type || "none",
    token: server.auth?.token || "",
    headers: (server.headers || []).map((h) => `${h.name}: ${h.value}`).join("\n"),
    clientId: server.auth?.clientId || "",
    clientSecret: server.auth?.clientSecret || "",
    scopes: server.auth?.scopes || "",
    redirectPort: server.auth?.redirectPort ? String(server.auth.redirectPort) : ""
  });
  d.advanced = !!(d.clientId || d.scopes || d.redirectPort || d.headers);
  return d;
}
function applyPartial(d, p) {
  Object.assign(d, p);
  d.probe = null;
  d.advanced = d.advanced || !!(p.headers || p.clientId);
}
function draftFromImport(m) {
  const remote = transportOf(m) !== "stdio";
  return {
    kind: remote ? "remote" : "local",
    name: m.name,
    command: m.command || "",
    args: (m.args || []).join("\n"),
    env: (m.env || []).map((e) => `${e.name}=${e.value}`).join("\n"),
    url: m.url || "",
    transport: m.transport === "sse" ? "sse" : "http",
    authType: m.auth?.type || "none",
    token: m.auth?.token || "",
    headers: (m.headers || []).map((h) => `${h.name}: ${h.value}`).join("\n")
  };
}
function lines(text) {
  return text.split("\n").map((l) => l.trim()).filter(Boolean);
}
function pairs(text, sep, what) {
  return lines(text).map((l) => {
    const i = l.indexOf(sep);
    if (i <= 0) throw new Error(`${what}: “${l}” should look like NAME${sep === "=" ? "=value" : ": value"}`);
    return { name: l.slice(0, i).trim(), value: l.slice(i + 1).trim() };
  });
}
function serverFromDraft(d) {
  const name = d.name.trim() || (d.kind === "remote" ? nameFromUrl(d.url) : d.command.trim().split("/").pop() || "");
  if (d.kind === "local") return { id: d.id, name, transport: "stdio", enabled: d.enabled, command: d.command.trim(), args: lines(d.args), env: pairs(d.env, "=", "Environment") };
  return {
    id: d.id,
    name,
    transport: d.transport,
    enabled: d.enabled,
    command: "",
    args: [],
    env: [],
    url: d.url.trim(),
    headers: pairs(d.headers, ":", "Headers"),
    auth: d.authType === "oauth" ? {
      type: "oauth",
      clientId: d.clientId.trim() || void 0,
      clientSecret: d.clientSecret.trim() || void 0,
      scopes: d.scopes.trim() || void 0,
      redirectPort: d.redirectPort.trim() ? Number(d.redirectPort.trim()) : void 0
    } : d.authType === "bearer" ? { type: "bearer", token: d.token.trim() } : { type: "none" }
  };
}
function serverRows(list) {
  return {
    type: "tree",
    key: "servers",
    rowHeight: 46,
    rowGap: 2,
    iconSize: 20,
    indent: 0,
    selectAction: "select",
    expandAction: "noop",
    activateAction: "edit",
    rows: list.map((s) => {
      const h = health(s);
      return {
        key: s.id,
        label: s.name,
        detail: summary(s) || h.detail,
        badge: h.text,
        depth: 0,
        expanded: false,
        expandable: false,
        selected: s.id === selected,
        iconSvg: iconFor(s),
        iconColor: toneColor[h.tone],
        busy: h.text === "Signing in…",
        weight: "medium"
      };
    })
  };
}
function emptyState() {
  return { type: "column", key: "empty", style: { ...card, padding: 14, gap: 10 }, children: [
    { type: "row", key: "head", gap: 8, align: "center", children: [
      { type: "button", key: "ico", text: "", iconSvg: uiIcons.sparkles, iconSize: 20, action: "add", variant: "ghost", tooltip: "Add a server" },
      { type: "column", key: "t", gap: 2, grow: true, children: [
        { type: "label", key: "a", text: "Give your agents more tools", weight: "semibold" },
        { type: "label", key: "b", text: "Connect a remote service with one sign-in, or run a local MCP command.", size: "sm", color: "muted", wrap: true }
      ] }
    ] },
    presetGrid("empty-presets"),
    { type: "row", key: "go", gap: 6, children: [btn("add", "Add server", "add", { icon: uiIcons.plus, variant: "primary" }), btn("paste", "Paste config", "addImport", { icon: uiIcons.import, variant: "ghost" })] }
  ] };
}
function presetGrid(key) {
  return { type: "row", key, gap: 6, wrap: true, children: PRESETS.map((p) => ({ type: "button", key: p.key, text: p.label, action: "preset", value: p.key, small: true, variant: "default", tooltip: p.hint, disabled: busy })) };
}
function detailCard(s) {
  const h = health(s), remote = transportOf(s) !== "stdio", flow = flows[s.id];
  const oauth = remote && s.auth?.type === "oauth";
  const signingIn = flow && ["discovering", "waiting", "exchanging"].includes(flow.status);
  const rows = [
    { type: "row", key: "head", gap: 8, align: "center", children: [
      { type: "label", key: "name", text: s.name, weight: "semibold", size: "md", grow: true, wrap: true },
      chip("state", h.text, toneColor[h.tone], toneBg[h.tone])
    ] },
    { type: "label", key: "what", text: s.builtin ? "Built-in endpoint" : remote ? `${s.transport === "sse" ? "SSE (legacy)" : "Streamable HTTP"} · ${s.auth?.type === "oauth" ? "OAuth" : s.auth?.type === "bearer" ? "Bearer token" : "No authentication"}` : "Local command (stdio)", size: "xs", color: "muted" }
  ];
  const sum = summary(s);
  if (sum && !s.builtin) rows.push({ type: "row", key: "sum", gap: 4, align: "center", style: { background: "panel", radius: 6, paddingX: 8, paddingY: 4 }, children: [
    { type: "label", key: "v", text: sum, mono: true, size: "xs", grow: true, selectable: true, tooltip: sum },
    { type: "button", key: "copy", text: "", iconSvg: uiIcons.copy, action: "", copyText: sum, small: true, variant: "ghost", tooltip: "Copy" }
  ] });
  else if (s.builtin) rows.push({ type: "label", key: "desc", text: s.description || "", size: "sm", color: "muted", wrap: true });
  if (!s.builtin && transportOf(s) === "stdio" && s.env?.length) rows.push({ type: "label", key: "env", text: `${s.env.length} environment variable${s.env.length > 1 ? "s" : ""}: ${s.env.map((e) => e.name).join(", ")}`, size: "xs", color: "muted", wrap: true });
  if (oauth) {
    if (signingIn) rows.push({ type: "column", key: "flow", gap: 6, style: { background: "panel", radius: 8, padding: 8 }, children: [
      { type: "progress", key: "p", indeterminate: true, label: flow.status === "discovering" ? "Finding the sign-in page…" : flow.status === "exchanging" ? "Finishing sign-in…" : "Waiting for you in the browser…" },
      { type: "row", key: "b", gap: 6, children: [
        ...flow.authorizeUrl ? [btn("copy-link", "Copy sign-in link", "", { icon: uiIcons.copy, variant: "ghost", copy: flow.authorizeUrl, disabled: false, tooltip: "Paste into a browser if none opened" })] : [],
        btn("cancel-signin", "Cancel", "cancelSignIn", { variant: "ghost", disabled: false })
      ] }
    ] });
    else if (s.authStatus?.state === "signedIn") rows.push({ type: "row", key: "auth", gap: 6, align: "center", children: [
      { type: "label", key: "i", text: `✓ ${h.detail}${s.authStatus.scope ? ` · ${s.authStatus.scope}` : ""}`, size: "xs", color: "success", grow: true, wrap: true },
      btn("signout", "Sign out", "signOut", { icon: uiIcons["log-out"], variant: "ghost" })
    ] });
    else rows.push({ type: "column", key: "auth", gap: 6, style: { background: "#d8962014", radius: 8, padding: 8 }, children: [
      { type: "label", key: "i", text: flow?.status === "error" ? flow.error || "Sign-in failed" : s.authStatus?.state === "expired" ? "Your session expired. Sign in again to keep using this server." : "Sign in once; Hato refreshes the token for your agents.", size: "sm", color: flow?.status === "error" ? "danger" : "default", wrap: true },
      { type: "row", key: "b", children: [btn("signin", flow?.status === "error" ? "Try again" : "Sign in with browser", "signIn", { icon: uiIcons.external, variant: "primary" })] }
    ] });
  }
  if (!s.builtin) rows.push({ type: "row", key: "actions", gap: 4, align: "center", wrap: true, children: [
    { type: "switch", key: "enabled", label: "Available to agents", checked: s.enabled !== false, action: "toggleEnabled", disabled: busy },
    { type: "spacer", key: "sp" },
    btn("edit", "", "edit", { icon: uiIcons.pencil, variant: "ghost", tooltip: "Edit" }),
    btn("dup", "", "duplicate", { icon: uiIcons.copy, variant: "ghost", tooltip: "Duplicate" }),
    btn("remove", "", "remove", { icon: uiIcons.trash, variant: "ghost", tooltip: "Remove" })
  ] });
  return { type: "column", key: "detail", style: card, children: rows };
}
function editor(d) {
  const kids = [];
  if (d.isNew) kids.push({ type: "column", key: "quick", gap: 6, children: [
    { type: "row", key: "h", gap: 6, align: "center", children: [
      { type: "label", key: "t", text: "Quick add", size: "sm", weight: "medium", grow: true },
      btn("toggle-import", d.importing ? "Hide paste" : "Paste config", "toggleImport", { icon: uiIcons.import, variant: "ghost" })
    ] },
    presetGrid("presets"),
    ...d.importing ? [
      input("f-importText", d.importText, '{"mcpServers": {"name": {"command": "npx", "args": [...]}}} or https://…', { multiline: true, rows: 5, mono: true }),
      { type: "row", key: "imp", gap: 6, children: [btn("do-import", "Import", "import", { variant: "primary" }), { type: "label", key: "h", text: "Claude, Cursor and VS Code formats work. Several servers are added at once.", size: "xs", color: "muted", wrap: true, grow: true }] }
    ] : [],
    { type: "divider", key: "d" }
  ] });
  kids.push({ type: "row", key: "kind", gap: 8, children: [
    { type: "choice", key: "local", text: "Local command", description: "Runs a program on the agent's machine", selected: d.kind === "local", action: "kind", value: "local", grow: true },
    { type: "choice", key: "remote", text: "Remote server", description: "HTTPS endpoint · OAuth sign-in", selected: d.kind === "remote", action: "kind", value: "remote", grow: true }
  ] });
  if (d.kind === "remote") {
    kids.push(fieldLabel("l-url", "Server URL"), { type: "row", key: "url-row", gap: 6, align: "center", children: [
      { ...input("f-url", d.url, "https://mcp.example.com/mcp", { mono: true }), grow: true },
      btn("detect", d.probe?.busy ? "Checking…" : "Check", "probe", { icon: uiIcons.search, variant: "ghost", tooltip: "Check the server and detect sign-in", disabled: busy || d.probe?.busy || !parseHttpUrl(d.url) })
    ] });
    if (d.probe?.text) kids.push({ type: "status", key: "probe", text: d.probe.text, level: d.probe.level });
    kids.push(fieldLabel("l-name", "Name", "Shown to you and to agents"), input("f-name", d.name, d.url ? nameFromUrl(d.url) : "e.g. Linear"));
    kids.push({ type: "row", key: "opts", gap: 8, children: [
      { type: "column", key: "auth", gap: 4, grow: true, children: [fieldLabel("l-auth", "Authentication"), { type: "select", key: "authType", value: d.authType, action: "authType", options: [
        { value: "oauth", label: "OAuth — sign in with browser" },
        { value: "bearer", label: "Bearer token" },
        { value: "none", label: "None" }
      ] }] },
      { type: "column", key: "tr", gap: 4, width: 150, children: [fieldLabel("l-tr", "Transport"), { type: "select", key: "transport", value: d.transport, action: "transport", options: [
        { value: "http", label: "Streamable HTTP" },
        { value: "sse", label: "SSE (legacy)" }
      ] }] }
    ] });
    if (d.authType === "bearer") kids.push(fieldLabel("l-token", "Token"), input("f-token", d.token, "Paste the access token", { secret: true }));
    if (d.authType === "oauth") kids.push({ type: "label", key: "oauth-hint", text: "After saving, Hato opens your browser to sign in. Tokens are kept by Hato and refreshed automatically; nothing is written to the agent's machine.", size: "xs", color: "muted", wrap: true });
    kids.push({ type: "row", key: "adv-toggle", children: [btn("adv", d.advanced ? "▾ Advanced" : "▸ Advanced", "toggleAdvanced", { variant: "ghost" })] });
    if (d.advanced) {
      const adv = [fieldLabel("l-headers", "Extra headers", "One per line · Name: value"), input("f-headers", d.headers, "X-Api-Version: 2", { multiline: true, rows: 2, mono: true })];
      if (d.authType === "oauth") adv.push(
        fieldLabel("l-client", "Client ID", "Leave empty to register automatically"),
        input("f-clientId", d.clientId, "Registered OAuth client id"),
        fieldLabel("l-secret", "Client secret", "Only for confidential clients"),
        input("f-clientSecret", d.clientSecret, "Optional", { secret: true }),
        { type: "row", key: "sc", gap: 8, children: [
          { type: "column", key: "a", gap: 4, grow: true, children: [fieldLabel("l-scopes", "Scopes"), input("f-scopes", d.scopes, "Server default")] },
          { type: "column", key: "b", gap: 4, width: 150, children: [fieldLabel("l-port", "Redirect port"), input("f-redirectPort", d.redirectPort, "Any free port")] }
        ] },
        { type: "label", key: "redir", text: `Redirect URI: http://127.0.0.1:${d.redirectPort.trim() || "<port>"}/mcp/oauth/callback`, size: "xs", color: "muted", mono: true, selectable: true }
      );
      kids.push({ type: "column", key: "advanced", gap: 6, style: { background: "panel", radius: 8, padding: 8 }, children: adv });
    }
  } else {
    kids.push(fieldLabel("l-name", "Name"), input("f-name", d.name, "e.g. Filesystem"));
    kids.push(fieldLabel("l-command", "Command", "Executable on the agent's machine"), input("f-command", d.command, "npx, uvx, docker or /path/to/server", { mono: true }));
    kids.push(fieldLabel("l-args", "Arguments", "One per line"), input("f-args", d.args, "-y\n@scope/server\n--flag", { multiline: true, rows: 4, mono: true }));
    kids.push(fieldLabel("l-env", "Environment", "One per line · NAME=value"), input("f-env", d.env, "API_KEY=…", { multiline: true, rows: 3, mono: true }));
  }
  kids.push({ type: "switch", key: "enabled", label: "Available to agents", checked: d.enabled, action: "draftEnabled" });
  if (error) kids.push({ type: "status", key: "save-error", level: "error", text: error });
  const oauth = d.kind === "remote" && d.authType === "oauth";
  kids.push({ type: "row", key: "footer", gap: 6, children: [
    { type: "spacer", key: "sp" },
    btn("cancel", "Cancel", "closeEditor", { variant: "ghost" }),
    ...oauth ? [btn("save", "Save", "save", { variant: "default" }), btn("save-signin", "Save & sign in", "saveSignIn", { icon: uiIcons.external, variant: "primary" })] : [btn("save", d.isNew ? "Add server" : "Save", "save", { variant: "primary" })]
  ] });
  return { type: "modal", key: "editor", width: 560, title: d.isNew ? "Add MCP server" : `Edit ${d.name || "MCP server"}`, closeAction: "closeEditor", children: [{ type: "column", key: "form", gap: 8, scroll: true, maxHeight: 620, children: kids }] };
}
var mod = {
  id: "mcp-panel",
  moduleApiVersion: 1,
  async activate(ctx, previous) {
    alive = true;
    filter = previous?.filter || "";
    selected = previous?.selected || null;
    showBuiltin = !!previous?.showBuiltin;
    ctx.events.on("persistent-agents.mcpResponse", (response) => {
      const p = pending.get(response?.requestId);
      if (!p) return;
      pending.delete(response.requestId);
      clearTimeout(p.timer);
      if (response.error) p.reject(new Error(response.error));
      else p.resolve(response.value);
    });
    ctx.events.on("persistent-agents.mcpsChanged", () => {
      void refresh(ctx);
    });
    ctx.events.on("mcp-auth.changed", () => {
      void refresh(ctx);
    });
    flows = ctx.state.get("mcp-auth.flows") || {};
    ctx.state.watch("mcp-auth.flows", (v) => {
      const before = flows;
      flows = v || {};
      for (const [id, f] of Object.entries(flows)) if (f.status === "done" && before[id]?.status !== "done") notice = `Signed in to ${servers.find((s) => s.id === id)?.name || "server"}.`;
      ctx.ui.invalidate();
    });
    void refresh(ctx);
  },
  deactivate() {
    alive = false;
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("MCP panel reloaded"));
    }
    pending.clear();
  },
  snapshot: () => ({ filter, selected, showBuiltin }),
  render() {
    const query = filter.trim().toLowerCase();
    const match = (s) => [s.name, summary(s), s.description || ""].join(" ").toLowerCase().includes(query);
    const mine = servers.filter((s) => !s.builtin), builtin = servers.filter((s) => s.builtin);
    const current = servers.find((s) => s.id === selected);
    const needsSignIn = mine.filter((s) => s.enabled !== false && transportOf(s) !== "stdio" && s.auth?.type === "oauth" && s.authStatus?.state !== "signedIn").length;
    const children = [
      { type: "row", key: "header", gap: 6, align: "center", children: [
        { type: "column", key: "t", gap: 0, grow: true, children: [
          { type: "label", key: "title", text: "MCP servers", weight: "semibold", size: "md" },
          { type: "label", key: "sub", text: `${mine.length} yours · ${mine.filter((s) => s.enabled !== false).length} on${needsSignIn ? ` · ${needsSignIn} need sign-in` : ""}`, size: "xs", color: needsSignIn ? "warning" : "muted" }
        ] },
        btn("refresh", "", "refresh", { icon: uiIcons.refresh, variant: "ghost", tooltip: "Refresh" }),
        btn("add", "Add", "add", { icon: uiIcons.plus, variant: "primary", tooltip: "Add MCP server" })
      ] }
    ];
    if (mine.length > 3 || query) children.push({ type: "textInput", key: "filter", ...filterInput, prefixSvg: uiIcons.search, placeholder: "Filter servers", value: filter, changeAction: "filter" });
    if (error && !draft) children.push({ type: "status", key: "error", level: "error", text: error });
    if (notice) children.push({ type: "row", key: "notice", gap: 6, align: "center", children: [{ type: "status", key: "s", level: "success", text: notice, grow: true }, btn("x", "", "dismiss", { icon: uiIcons.x, variant: "ghost", disabled: false })] });
    const visibleMine = mine.filter(match);
    if (!mine.length && !query) children.push(emptyState());
    else children.push(visibleMine.length ? serverRows(visibleMine) : { type: "label", key: "nomatch", text: "No matching servers.", color: "muted", size: "sm", padding: 6 });
    children.push({ type: "row", key: "builtin-h", gap: 6, align: "center", children: [
      btn("toggle-builtin", `${showBuiltin ? "▾" : "▸"} Built-in · ${builtin.length}`, "toggleBuiltin", { variant: "ghost", tooltip: "Hato's own MCP endpoints", disabled: false })
    ] });
    if (showBuiltin) children.push({ ...serverRows(builtin.filter(match)), key: "builtin" });
    children.push({ type: "spacer", key: "grow" });
    if (current) children.push(detailCard(current));
    if (draft) children.push(editor(draft));
    if (removeId) children.push({ type: "modal", key: "confirm-remove", title: "Remove MCP server?", closeAction: "cancelRemove", width: 420, children: [
      { type: "label", key: "message", text: `${servers.find((s) => s.id === removeId)?.name || "This server"} will no longer be offered to new agents, and any saved sign-in is deleted. Running agents keep their current connection.`, wrap: true },
      { type: "row", key: "buttons", gap: 6, children: [{ type: "spacer", key: "sp" }, btn("cancel", "Cancel", "cancelRemove", { variant: "ghost" }), btn("confirm", "Remove", "confirmRemove", { variant: "danger" })] }
    ] });
    return { type: "column", key: "mcp-root", padding: 8, gap: 8, grow: true, scroll: true, children };
  },
  async onEvent(ctx, event) {
    const a = event.action;
    if (a === "filter") {
      filter = String(event.value || "");
      ctx.ui.invalidate();
      return;
    }
    if (a.startsWith("field:") && draft) {
      const key = a.slice(6);
      if (key in draft && typeof draft[key] === "string") {
        draft[key] = String(event.value ?? "");
        if (key === "url") draft.probe = null;
      }
      if (key === "url") ctx.ui.invalidate();
      return;
    }
    if (draft) {
      if (a === "kind") {
        draft.kind = event.value === "local" ? "local" : "remote";
        error = null;
        ctx.ui.invalidate();
        return;
      }
      if (a === "authType") {
        draft.authType = ["oauth", "bearer", "none"].includes(String(event.value)) ? event.value : "none";
        ctx.ui.invalidate();
        return;
      }
      if (a === "transport") {
        draft.transport = event.value === "sse" ? "sse" : "http";
        ctx.ui.invalidate();
        return;
      }
      if (a === "draftEnabled") {
        draft.enabled = !!event.value;
        ctx.ui.invalidate();
        return;
      }
      if (a === "toggleAdvanced") {
        draft.advanced = !draft.advanced;
        ctx.ui.invalidate();
        return;
      }
      if (a === "toggleImport") {
        draft.importing = !draft.importing;
        ctx.ui.invalidate();
        return;
      }
    }
    if (a === "dismiss") {
      notice = null;
      ctx.ui.invalidate();
      return;
    }
    if (a === "toggleBuiltin") {
      showBuiltin = !showBuiltin;
      ctx.ui.invalidate();
      return;
    }
    if (busy) return;
    try {
      if (a === "add") {
        draft = blankDraft();
        error = null;
      } else if (a === "addImport") {
        draft = { ...blankDraft(), importing: true };
        error = null;
      } else if (a === "preset") {
        const p = PRESETS.find((x) => x.key === event.value);
        if (p) {
          if (!draft) draft = blankDraft();
          applyPartial(draft, { ...p.make() });
          error = null;
        }
      } else if (a === "import" && draft) {
        const found = importMcpConfig(event.inputs["f-importText"] ?? draft.importText);
        if (found.length === 1) {
          applyPartial(draft, { ...draftFromImport(found[0]), importing: false, importText: "" });
        } else {
          busy = true;
          ctx.ui.invalidate();
          for (const m of found) await request(ctx, "saveMcp", { server: { ...m, id: crypto.randomUUID() } });
          notice = `Imported ${found.length} servers.`;
          draft = null;
          await refresh(ctx);
        }
      } else if (a === "probe" && draft) {
        draft.url = event.inputs["f-url"] ?? draft.url;
        draft.probe = { busy: true };
        ctx.ui.invalidate();
        const d = draft;
        try {
          const headers = d.advanced ? pairs(event.inputs["f-headers"] ?? d.headers, ":", "Headers") : [];
          const r = await request(ctx, "probeMcp", { url: d.url.trim(), transport: d.transport, headers }, 9e4);
          const host = r.issuer ? parseHttpUrl(r.issuer)?.host : null;
          if (r.oauth && r.requiresAuth !== false) {
            d.authType = "oauth";
            d.probe = { busy: false, level: "success", text: `Sign-in required${host ? ` via ${host}` : ""}. ${r.dynamicRegistration ? "Hato will register itself automatically." : "This provider needs a client ID — see Advanced."}` };
            if (!r.dynamicRegistration) d.advanced = true;
          } else if (r.requiresAuth === false) {
            if (d.authType === "oauth") d.authType = "none";
            d.probe = { busy: false, level: "success", text: "Server is reachable and accepts requests without signing in." };
          } else if (r.requiresAuth) {
            d.authType = "bearer";
            d.probe = { busy: false, level: "warn", text: `Server requires authentication but advertises no OAuth (HTTP ${r.status}). Use a bearer token.` };
          } else d.probe = { busy: false, level: "info", text: r.status ? `Server answered HTTP ${r.status}.` : "Server is reachable." };
          if (!d.scopes && r.scopes && d.authType === "oauth") d.scopes = "";
        } catch (e) {
          d.probe = { busy: false, level: "error", text: errMsg(e) };
        }
      } else if (a === "select") {
        selected = event.rowKey || String(event.value || "");
        notice = null;
      } else if (a === "edit") {
        const id = event.rowKey || selected;
        const s = servers.find((x) => x.id === id);
        if (s && !s.builtin) {
          selected = s.id;
          draft = draftFrom(s);
          error = null;
        }
      } else if (a === "duplicate") {
        const s = servers.find((x) => x.id === selected);
        if (s && !s.builtin) {
          draft = draftFrom(s, true);
          error = null;
        }
      } else if (a === "closeEditor") {
        draft = null;
        error = null;
      } else if (a === "remove") {
        const s = servers.find((x) => x.id === selected);
        if (s && !s.builtin) removeId = s.id;
      } else if (a === "cancelRemove") removeId = null;
      else if (a === "confirmRemove" && removeId) {
        busy = true;
        ctx.ui.invalidate();
        await request(ctx, "removeMcp", { id: removeId });
        selected = null;
        removeId = null;
        await refresh(ctx);
      } else if (a === "toggleEnabled") {
        const s = servers.find((x) => x.id === selected);
        if (s && !s.builtin) {
          busy = true;
          ctx.ui.invalidate();
          const { builtin: _b, description: _d, authStatus: _a, ...config } = s;
          await request(ctx, "saveMcp", { server: { ...config, enabled: !!event.value } });
          await refresh(ctx);
        }
      } else if (a === "signIn") {
        const s = servers.find((x) => x.id === selected);
        if (s) {
          notice = null;
          await request(ctx, "signInMcp", { id: s.id });
        }
      } else if (a === "cancelSignIn") {
        if (selected) await request(ctx, "cancelSignInMcp", { id: selected });
      } else if (a === "signOut") {
        if (selected) {
          busy = true;
          ctx.ui.invalidate();
          await request(ctx, "signOutMcp", { id: selected });
          await refresh(ctx);
        }
      } else if ((a === "save" || a === "saveSignIn") && draft) {
        for (const [k, v] of Object.entries(event.inputs)) if (k.startsWith("f-") && k.slice(2) in draft) draft[k.slice(2)] = v;
        const server = serverFromDraft(draft);
        busy = true;
        ctx.ui.invalidate();
        await request(ctx, "saveMcp", { server });
        selected = server.id;
        draft = null;
        error = null;
        await refresh(ctx);
        if (a === "saveSignIn") await request(ctx, "signInMcp", { id: server.id });
      } else if (a === "refresh") await refresh(ctx);
    } catch (e) {
      error = errMsg(e);
    } finally {
      busy = false;
      if (alive) ctx.ui.invalidate();
    }
  }
};
var index_default = mod;
export {
  index_default as default
};
