// Browser panel: pick a session, drive it through the live surface (pointer, wheel, keyboard),
// watch agents act (gliding pointer + activity pill), manage tabs, and inspect network requests.
// All browser work happens in the `browser` service; this module only composes the UI.
import type { AppModule, ModuleContext, UiEvent, UiNode, TreeRow } from "@hato/sdk/types";
import { errMsg } from "@hato/sdk/runtime";
import { tabButtonStyle, terminalTabStyle } from "@hato/sdk/tab-style";
import { DEFAULT_VIEWPORT, type BrowserNetworkEntry, type BrowserSessionView, type BrowserState } from "@hato/sdk/browser";
import { icons } from "./icons";

type Mode = "view" | "create" | "settings";
interface Form { name: string; where: "local" | "workspace" | "endpoint"; endpoint: string; headed: boolean; keepProfile: boolean; agentAccess: boolean; width: string; height: string; startUrl: string; executable: string }

let ctxRef: ModuleContext;
let state: BrowserState = { sessions: [], rev: 0 };
let selected: string | null = null;
let mode: Mode = "view";
let error: string | null = null;
let busy = false;
let fit = false;
let showNetwork = false;
let netFilter = "";
let netRows: BrowserNetworkEntry[] = [];
let netSeq = -1;
let netLoading = false;
let netSelected: string | null = null;
let netDetail: { entry: BrowserNetworkEntry | null; body?: string; bodyError?: string; loading?: boolean } | null = null;
let workspace: any = null;
let form: Form = blankForm();
let inputs: Promise<unknown> = Promise.resolve();
let fitTimer: number | null = null;
let agentTimer: number | null = null;
let lastSize: { width: number; height: number } | null = null;

function blankForm(): Form {
  return { name: "", where: "local", endpoint: "", headed: false, keepProfile: true, agentAccess: true, width: String(DEFAULT_VIEWPORT.width), height: String(DEFAULT_VIEWPORT.height), startUrl: "", executable: "" };
}

const current = (): BrowserSessionView | undefined => state.sessions.find(s => s.id === selected) || state.sessions[0];
const call = <T = any>(method: string, args: any = {}, timeoutMs = 60_000) => ctxRef.modules.call<T>("browser", method, args, { timeoutMs });

async function act(fn: () => Promise<unknown>) {
  busy = true; error = null; ctxRef.ui.invalidate();
  try { await fn(); } catch (e) { error = errMsg(e); }
  finally { busy = false; ctxRef.ui.invalidate(); }
}

/** Input events must reach the browser in order; never let one failure stall the chain. */
function send(kind: "pointer" | "wheel" | "key", event: any) {
  const s = current();
  if (!s || s.status !== "running") return;
  const id = s.id;
  inputs = inputs.then(() => call("input", { id, kind, event }, 10_000)).catch(() => {});
}

async function refreshNetwork(force = false) {
  const s = current();
  if (!showNetwork || !s || netLoading) return;
  if (!force && s.network.seq === netSeq) return;
  netLoading = true;
  const seq = s.network.seq;
  try {
    const r = await call<{ requests: BrowserNetworkEntry[] }>("network", { id: s.id, limit: 400, filter: netFilter || undefined });
    netRows = r.requests; netSeq = seq;
  } catch (e) { error = errMsg(e); }
  finally { netLoading = false; ctxRef.ui.invalidate(); }
  if (current()?.network.seq !== netSeq) setTimeout(() => void refreshNetwork(), 400);
}

async function openRequest(requestId: string) {
  const s = current();
  if (!s) return;
  netSelected = requestId;
  netDetail = { entry: null, loading: true };
  ctxRef.ui.invalidate();
  try {
    const entry = await call<BrowserNetworkEntry | null>("networkEntry", { id: s.id, requestId });
    netDetail = { entry, loading: !!entry && !entry.failed };
    ctxRef.ui.invalidate();
    if (entry && !entry.failed) {
      try {
        const b = await call("networkBody", { id: s.id, requestId, maxChars: 60_000 });
        netDetail = { entry, body: b.base64Encoded ? `(binary, ${b.total} base64 chars)` : b.body + (b.truncated ? `\n… ${b.total - b.body.length} more characters` : "") };
      } catch (e) { netDetail = { entry, bodyError: errMsg(e) }; }
    }
  } catch (e) { netDetail = { entry: null, bodyError: errMsg(e) }; }
  ctxRef.ui.invalidate();
}

function scheduleAgentFade(s?: BrowserSessionView) {
  if (agentTimer !== null || !s?.agent) return;
  const left = s.agent.at + 6000 - Date.now();
  if (left <= 0) return;
  agentTimer = setTimeout(() => { agentTimer = null; ctxRef.ui.invalidate(); }, left + 50);
}

// ------------------------------------------------------------------ presentation

const muted = "muted";
const ghost = (key: string, icon: string, action: string, tooltip: string, disabled = false, extra: Partial<UiNode> = {}): UiNode =>
  ({ type: "button", key, text: "", iconSvg: icon, iconSize: 15, action, small: true, variant: "ghost", tooltip, disabled, ...extra } as UiNode);

function statusDot(s: BrowserSessionView): { color: string; text: string } {
  switch (s.status) {
    case "running": return { color: "success", text: s.loading ? "Loading" : "Running" };
    case "starting": return { color: "warning", text: s.progress || "Starting…" };
    case "error": return { color: "danger", text: "Error" };
    default: return { color: muted, text: "Stopped" };
  }
}

function header(s?: BrowserSessionView): UiNode {
  const dot = s ? statusDot(s) : null;
  return { type: "row", key: "header", gap: 6, align: "center", style: { paddingX: 8, paddingY: 6 }, children: [
    { type: "select", key: "session", value: s?.id || null, placeholder: "No sessions", action: "pick", style: { width: 220 },
      options: state.sessions.map(x => ({ value: x.id, label: `${x.name} · ${x.locationLabel}` })) },
    ...(s && dot ? [{ type: "label", key: "status", text: `● ${dot.text}`, size: "xs", color: dot.color } as UiNode] : []),
    { type: "spacer", key: "sp" },
    ...(s ? [
      ...(s.status === "running" || s.status === "starting"
        ? [ghost("stop", icons.power, "stop", "Stop the browser (the profile is kept)", busy)]
        : [ghost("start", icons.play, "start", "Start the browser", busy)]),
      ghost("settings", icons.settings, "settings", "Session settings", busy, mode === "settings" ? { variant: "default" } : {}),
    ] : []),
    { type: "button", key: "new", text: "New session", iconSvg: icons.plus, iconSize: 14, action: "create", small: true, variant: mode === "create" ? "default" : "ghost", disabled: busy },
  ] };
}

function tabStrip(s: BrowserSessionView): UiNode {
  return { type: "row", key: "tabs", gap: 3, align: "center", wrap: false, style: { paddingX: 8 }, children: [
    ...s.tabs.map((t): UiNode => ({ type: "row", key: t.id, gap: 0, style: { ...terminalTabStyle(t.active), maxWidth: 220 }, children: [
      { type: "button", key: "select", text: (t.title || t.url || "New tab").slice(0, 40), iconSvg: t.loading ? icons.reload : icons.globe, iconSize: 13,
        action: `tab:${t.id}`, middleClickAction: `closeTab:${t.id}`, small: true, variant: "ghost", style: tabButtonStyle(t.active, true), tooltip: t.url },
      { type: "button", key: "close", text: "", iconSvg: icons.close, iconSize: 12, action: `closeTab:${t.id}`, small: true, variant: "ghost", style: tabButtonStyle(t.active, true), tooltip: "Close tab" },
    ] })),
    ghost("newTab", icons.plus, "newTab", "New tab", s.status !== "running"),
  ] };
}

function toolbar(s: BrowserSessionView): UiNode {
  const running = s.status === "running";
  return { type: "row", key: "toolbar", gap: 4, align: "center", style: { paddingX: 8, paddingY: 4 }, children: [
    ghost("back", icons.back, "back", "Back", !running || !s.canGoBack),
    ghost("forward", icons.forward, "forward", "Forward", !running || !s.canGoForward),
    s.loading ? ghost("stopLoad", icons.stop, "stopLoad", "Stop loading", !running) : ghost("reload", icons.reload, "reload", "Reload", !running),
    { type: "textInput", key: `url:${s.id}:${s.activeTab || ""}`, value: s.url === "about:blank" ? "" : s.url, placeholder: "Search or enter address", submitAction: "go", grow: true, disabled: !running && s.status !== "stopped", prefixSvg: icons.globe },
    ghost("agent", icons.agent, "toggleAgent", s.agentAccess ? "Agents may use this session — click to block" : "Agents cannot use this session — click to allow", busy,
      { variant: s.agentAccess ? "default" : "ghost", iconColor: s.agentAccess ? "primary" : muted }),
    ghost("fit", icons.fit, "fit", fit ? "Viewport follows the panel size — click to keep a fixed size" : `Fixed viewport ${s.viewport.width}×${s.viewport.height} — click to fit the panel`, !running,
      { variant: fit ? "default" : "ghost" }),
    ghost("network", icons.network, "network", showNetwork ? "Hide network requests" : "Show network requests", false,
      { variant: showNetwork ? "default" : "ghost", badge: s.network.count ? String(Math.min(s.network.count, 999)) : "" }),
  ] };
}

/** Agent commands are individually allowed in Settings (internal MCP); new ones start denied. */
function commandsNotice(s: BrowserSessionView): UiNode | null {
  if (!s.agentAccess) return null;
  const section = ctxRef.state.get<any>("internal-mcp.settings")?.sections?.find((x: any) => x?.key === "mcp:browser");
  if (!section || !Array.isArray(section.fields)) return null;
  const off = section.fields.filter((f: any) => f.value === false).length;
  if (!off) return null;
  const all = off === section.fields.length;
  return { type: "row", key: "commands", gap: 8, align: "center", style: { paddingX: 8, paddingY: 2 }, children: [
    { type: "status", key: "t", level: "warn", grow: true, text: all ? "Agent commands for browsers are turned off, so agents cannot use this session yet." : `${off} of ${section.fields.length} browser agent commands are turned off.` },
    { type: "button", key: "open", text: "Review in Settings", action: "openCommands", small: true },
  ] };
}

function agentPill(s: BrowserSessionView): UiNode | null {
  if (!s.agent || Date.now() - s.agent.at > 6000) return null;
  scheduleAgentFade(s);
  return { type: "row", key: "agentPill", gap: 6, align: "center", style: { paddingX: 10, paddingY: 4, background: "primary", radius: 0 }, children: [
    { type: "label", key: "t", text: `Agent is using this browser · ${s.agent.text}`, size: "xs", color: "primaryText" },
  ] };
}

function preview(s: BrowserSessionView): UiNode {
  const placeholder = s.status === "starting" ? (s.progress || "Starting browser…") : s.status === "error" ? "" : s.status === "stopped" ? "The browser is stopped." : "Waiting for the first frame…";
  return { type: "surface", key: `surface:${s.id}`, surface: s.surface, placeholder, grow: true,
    pointerAction: "ptr", wheelAction: "wheel", keyAction: "key", resizeAction: "resize",
    cursorSvg: icons.pointer, cursorLabel: "Agent", cursorColor: "#6d5dfc", style: { background: s.status === "running" ? "#ffffff" : "background" } };
}

const statusColor = (e: BrowserNetworkEntry) => e.failed || (e.status ?? 0) >= 400 ? "danger" : (e.status ?? 0) >= 300 ? "warning" : e.status ? "success" : muted;
const size = (n?: number) => n === undefined ? "" : n < 1024 ? `${n} B` : n < 1 << 20 ? `${(n / 1024).toFixed(1)} KB` : `${(n / (1 << 20)).toFixed(1)} MB`;
function shortUrl(url: string) {
  const m = /^[a-z]+:\/\/([^/]+)(\/[^?#]*)?/i.exec(url);
  if (!m) return url.slice(0, 120);
  const path = m[2] || "/";
  return `${path.length > 70 ? "…" + path.slice(-69) : path}  ·  ${m[1]}`;
}

function networkPane(s: BrowserSessionView): UiNode {
  const rows: TreeRow[] = netRows.slice().reverse().map(e => ({
    key: e.requestId, label: shortUrl(e.url), depth: 0, expandable: false, expanded: false, selected: e.requestId === netSelected, tooltip: e.url,
    badges: [{ text: e.failed ? (e.error || "failed") : String(e.status ?? "…"), color: statusColor(e) }, { text: e.method, color: muted }, ...(e.type ? [{ text: e.type.toLowerCase(), color: muted }] : [])],
    badge: [e.durationMs !== undefined ? `${e.durationMs} ms` : "", size(e.encodedBytes)].filter(Boolean).join(" · "),
  }));
  const list: UiNode = rows.length
    ? { type: "tree", key: "requests", rows, rowHeight: 28, selectAction: "request", expandAction: "noop", grow: true }
    : { type: "label", key: "empty", text: netLoading ? "Loading…" : "No requests yet.", size: "sm", color: muted, style: { padding: 12 } };
  const children: UiNode[] = [
    { type: "row", key: "netbar", gap: 6, align: "center", style: { paddingX: 8, paddingY: 4 }, children: [
      { type: "label", key: "title", text: "Network", size: "sm", weight: "semibold" },
      { type: "textInput", key: "netFilter", value: netFilter, placeholder: "Filter: URL, xhr, fetch, POST…", changeAction: "netFilter", grow: true },
      ghost("clear", icons.trash, "clearNetwork", "Clear the log"),
      ghost("closeNet", icons.close, "network", "Hide network requests"),
    ] },
  ];
  if (netDetail && netSelected) {
    const e = netDetail.entry;
    const headers = (h?: Record<string, string>) => h ? Object.entries(h).map(([k, v]) => `${k}: ${v}`).join("\n") : "";
    const text = e ? [
      `${e.method} ${e.url}`,
      `Status: ${e.failed ? `failed (${e.error})` : `${e.status ?? "pending"} ${e.statusText || ""}`}${e.fromCache ? " (cache)" : ""}`,
      `Type: ${e.type || "?"}   MIME: ${e.mimeType || "?"}   Time: ${e.durationMs ?? "?"} ms   Size: ${size(e.encodedBytes) || "?"}`,
      "", "Request headers", headers(e.requestHeaders), ...(e.postData ? ["", "Request body", e.postData] : []),
      "", "Response headers", headers(e.responseHeaders),
      "", "Response body", netDetail.loading ? "Loading…" : netDetail.bodyError ? `Unavailable: ${netDetail.bodyError}` : (netDetail.body ?? ""),
    ].join("\n") : (netDetail.bodyError || "Loading…");
    children.push({ type: "split", key: "netsplit", direction: "horizontal", sizes: [0.5, 0.5], resizable: true, grow: true, children: [
      { type: "column", key: "list", grow: true, children: [list] },
      { type: "column", key: "detail", grow: true, children: [
        { type: "row", key: "dh", gap: 4, align: "center", style: { paddingX: 8 }, children: [
          { type: "label", key: "t", text: "Request", size: "sm", weight: "semibold" }, { type: "spacer", key: "s" },
          ghost("closeDetail", icons.close, "closeDetail", "Close details"),
        ] },
        { type: "scroll", key: "ds", grow: true, children: [{ type: "label", key: "body", text, mono: true, size: "xs", wrap: true, selectable: true, style: { padding: 8 } }] },
      ] },
    ] });
  } else children.push(list);
  return { type: "column", key: "network", grow: true, style: { borderTop: 1, borderColor: "border" }, children };
}

function field(key: string, label: string, control: UiNode, hint?: string): UiNode {
  return { type: "column", key, gap: 3, children: [
    { type: "label", key: "l", text: label, size: "sm", weight: "medium" }, control,
    ...(hint ? [{ type: "label", key: "h", text: hint, size: "xs", color: muted, wrap: true } as UiNode] : []),
  ] };
}

function formView(editing?: BrowserSessionView): UiNode {
  const ws = workspace;
  const remoteWs = ws && ws.location === "ssh";
  const whereOptions = [
    { value: "local", label: "This computer" },
    { value: "workspace", label: remoteWs ? `Workspace machine · ${ws.name}` : "Workspace machine (select an SSH workspace)", disabled: !remoteWs && !(editing?.location.kind === "workspace") },
    { value: "endpoint", label: "Existing DevTools endpoint" },
  ];
  const title = editing ? `Settings · ${editing.name}` : "New browser session";
  return { type: "scroll", key: "formScroll", grow: true, children: [{ type: "column", key: "form", gap: 14, style: { padding: 16, maxWidth: 560 }, children: [
    { type: "label", key: "title", text: title, size: "lg", weight: "semibold" },
    field("name", "Name", { type: "textInput", key: "f.name", value: form.name, placeholder: "e.g. QA browser", changeAction: "form:name" }),
    field("where", "Runs on", { type: "select", key: "f.where", value: form.where, action: "form:where", options: whereOptions, disabled: !!editing },
      form.where === "local" ? "Uses Chrome, Chromium, Edge or Brave if installed; otherwise downloads Chrome for Testing’s headless shell."
        : form.where === "workspace" ? "Chrome runs on the workspace machine and is held by its Hato daemon, so it survives disconnects."
        : "Attach to a browser that is already running with remote debugging (ws://, wss:// or http://127.0.0.1:9222)."),
    ...(form.where === "endpoint" ? [field("endpoint", "Endpoint URL", { type: "textInput", key: "f.endpoint", value: form.endpoint, placeholder: "ws://127.0.0.1:9222/devtools/browser/… or wss://…", changeAction: "form:endpoint" })] : []),
    { type: "row", key: "vp", gap: 10, children: [
      field("w", "Viewport width", { type: "textInput", key: "f.width", value: form.width, changeAction: "form:width", width: 110 }),
      field("h", "Height", { type: "textInput", key: "f.height", value: form.height, changeAction: "form:height", width: 110 }),
    ] },
    { type: "switch", key: "f.agent", label: "Agents and workflows may use this session", checked: form.agentAccess, action: "form:agentAccess" },
    ...(form.where !== "endpoint" ? [
      { type: "switch", key: "f.keep", label: "Keep cookies and logins between launches", checked: form.keepProfile, action: "form:keepProfile" } as UiNode,
      ...(form.where === "local" ? [{ type: "switch", key: "f.headed", label: "Also show a real browser window", checked: form.headed, action: "form:headed" } as UiNode] : []),
      field("start", "Start page", { type: "textInput", key: "f.start", value: form.startUrl, placeholder: "about:blank", changeAction: "form:startUrl" }),
      field("exe", "Browser executable (optional)", { type: "textInput", key: "f.exe", value: form.executable, placeholder: editing?.executable || "Detected automatically", changeAction: "form:executable" }),
    ] : []),
    ...(error ? [{ type: "status", key: "err", text: error, level: "error" } as UiNode] : []),
    { type: "row", key: "actions", gap: 8, children: [
      { type: "button", key: "save", text: editing ? "Save" : "Create and start", action: "submit", variant: "primary", disabled: busy },
      { type: "button", key: "cancel", text: "Cancel", action: "cancel", variant: "ghost", disabled: busy },
      { type: "spacer", key: "sp" },
      ...(editing ? [{ type: "button", key: "delete", text: "Delete session", iconSvg: icons.trash, action: "delete", variant: "danger", disabled: busy } as UiNode] : []),
    ] },
  ] }] };
}

function emptyView(): UiNode {
  return { type: "column", key: "empty", gap: 10, align: "center", grow: true, style: { padding: 32, justify: "center" }, children: [
    { type: "label", key: "t", text: "No browser sessions yet", size: "lg", weight: "semibold" },
    { type: "label", key: "d", text: "Create a persistent browser that you, your agents and workflows can share. It keeps running in the background, with its own logins.", size: "sm", color: muted, wrap: true, style: { maxWidth: 420 } },
    { type: "button", key: "c", text: "New session", iconSvg: icons.plus, action: "create", variant: "primary" },
  ] };
}

function render(): UiNode {
  const s = current();
  if (s && selected !== s.id) selected = s.id;
  const top: UiNode[] = [header(s)];
  if (mode !== "view") return { type: "column", key: "root", grow: true, children: [...top, { type: "divider", key: "d" }, formView(mode === "settings" ? s : undefined)] };
  if (!s) return { type: "column", key: "root", grow: true, children: [...top, emptyView()] };
  const body: UiNode[] = [tabStrip(s), toolbar(s)];
  if (error) body.push({ type: "row", key: "errRow", style: { paddingX: 8 }, children: [{ type: "status", key: "err", text: error, level: "error", grow: true }] });
  if (s.status === "error" && s.error) body.push({ type: "row", key: "serr", gap: 8, align: "center", style: { paddingX: 8 }, children: [
    { type: "status", key: "t", text: s.error, level: "error", grow: true }, { type: "button", key: "r", text: "Retry", action: "start", small: true },
  ] });
  const notice = commandsNotice(s);
  if (notice) body.push(notice);
  const pill = agentPill(s);
  const view: UiNode = { type: "column", key: "view", grow: true, children: [preview(s), ...(pill ? [pill] : [])] };
  const main: UiNode = showNetwork
    ? { type: "split", key: "main", direction: "vertical", sizes: [0.62, 0.38], resizable: true, grow: true, children: [view, networkPane(s)] }
    : view;
  return { type: "column", key: "root", grow: true, children: [...top, ...body, main] };
}

// ------------------------------------------------------------------ events

function loadForm(s?: BrowserSessionView) {
  form = blankForm();
  if (!s) { form.name = `Browser ${state.sessions.length + 1}`; return; }
  form = { name: s.name, where: s.location.kind, endpoint: s.location.kind === "endpoint" ? s.location.url : "", headed: s.headed, keepProfile: s.keepProfile,
    agentAccess: s.agentAccess, width: String(s.viewport.width), height: String(s.viewport.height), startUrl: "", executable: "" };
}

function specFromForm() {
  const width = Number(form.width), height = Number(form.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 320 || height < 240) throw new Error("Viewport must be at least 320×240");
  const location = form.where === "endpoint" ? { kind: "endpoint", url: form.endpoint.trim() }
    : form.where === "workspace" ? { kind: "workspace", workspaceId: workspace?.id, label: workspace?.name } : { kind: "local" };
  if (location.kind === "endpoint" && !/^(wss?|https?):\/\//i.test((location as any).url)) throw new Error("Enter a ws://, wss://, http:// or https:// endpoint");
  if (location.kind === "workspace" && !(location as any).workspaceId) throw new Error("Select an SSH workspace first");
  return { name: form.name.trim() || "Browser", location, headed: form.headed, keepProfile: form.keepProfile, agentAccess: form.agentAccess,
    viewport: { width: Math.round(width), height: Math.round(height) }, ...(form.startUrl.trim() ? { startUrl: form.startUrl.trim() } : {}), ...(form.executable.trim() ? { executable: form.executable.trim() } : {}) };
}

async function onEvent(ctx: ModuleContext, ev: UiEvent) {
  const s = current();
  const a = ev.action;
  if (a === "ptr") return send("pointer", ev.value);
  if (a === "wheel") return send("wheel", ev.value);
  if (a === "key") return send("key", ev.value);
  if (a === "resize") {
    const v: any = ev.value;
    lastSize = { width: Math.round(v.width), height: Math.round(v.height) };
    if (fit && s && s.status === "running") {
      if (fitTimer !== null) clearTimeout(fitTimer);
      fitTimer = setTimeout(() => { fitTimer = null; const cur = current(); if (cur && lastSize) void call("setViewport", { id: cur.id, ...lastSize }).catch(e => { error = errMsg(e); ctx.ui.invalidate(); }); }, 350);
    }
    return;
  }
  if (a.startsWith("form:")) {
    const k = a.slice(5) as keyof Form;
    (form as any)[k] = typeof (form as any)[k] === "boolean" ? !!ev.value : String(ev.value ?? "");
    if (k === "where" || typeof (form as any)[k] === "boolean") ctx.ui.invalidate();
    return;
  }
  switch (a) {
    case "pick": selected = String(ev.value); mode = mode === "settings" ? "view" : mode; netRows = []; netSeq = -1; netSelected = null; netDetail = null; error = null; void refreshNetwork(true); ctx.ui.invalidate(); return;
    case "create": loadForm(); mode = mode === "create" ? "view" : "create"; error = null; ctx.ui.invalidate(); return;
    case "settings": if (s) { loadForm(s); mode = mode === "settings" ? "view" : "settings"; error = null; ctx.ui.invalidate(); } return;
    case "cancel": mode = "view"; error = null; ctx.ui.invalidate(); return;
    case "submit": return act(async () => {
      const spec = specFromForm();
      if (mode === "settings" && s) await call("update", { id: s.id, patch: spec });
      else { const v = await call<BrowserSessionView>("create", { spec }); selected = v.id; }
      mode = "view";
    });
    case "delete": if (s) return act(async () => { await call("remove", { id: s.id, deleteProfile: true }); selected = null; mode = "view"; });
      return;
    case "noop": return;
    case "openCommands": return act(() => ctx.modules.call("settings", "open", { module: "internal-mcp", section: "mcp:browser" }));
  }
  if (!s) return;
  switch (a) {
    case "start": return act(() => call("start", { id: s.id }, 180_000));
    case "stop": return act(() => call("stop", { id: s.id }));
    case "go": {
      const url = String(ev.inputs[`url:${s.id}:${s.activeTab || ""}`] ?? "").trim();
      if (!url) return;
      return act(async () => { if (s.status !== "running") await call("start", { id: s.id }, 180_000); await call("navigate", { id: s.id, url }); });
    }
    case "back": case "forward": case "reload": return act(() => call("history", { id: s.id, action: a }));
    case "stopLoad": return act(() => call("history", { id: s.id, action: "stop" }));
    case "newTab": return act(() => call("newTab", { id: s.id }));
    case "toggleAgent": return act(() => call("update", { id: s.id, patch: { agentAccess: !s.agentAccess } }));
    case "fit":
      fit = !fit;
      if (fit && lastSize && s.status === "running") return act(() => call("setViewport", { id: s.id, ...lastSize! }));
      ctx.ui.invalidate(); return;
    case "network": showNetwork = !showNetwork; netSeq = -1; if (!showNetwork) { netSelected = null; netDetail = null; } void refreshNetwork(true); ctx.ui.invalidate(); return;
    case "netFilter": netFilter = String(ev.value ?? ""); netSeq = -1; void refreshNetwork(true); return;
    case "clearNetwork": netRows = []; netSelected = null; netDetail = null; return act(() => call("clearNetwork", { id: s.id }));
    case "request": return openRequest(String(ev.rowKey ?? ev.value));
    case "closeDetail": netSelected = null; netDetail = null; ctx.ui.invalidate(); return;
  }
  if (a.startsWith("tab:")) return act(() => call("activateTab", { id: s.id, tab: a.slice(4) }));
  if (a.startsWith("closeTab:")) return act(() => call("closeTab", { id: s.id, tab: a.slice(9) }));
}

const mod: AppModule = {
  id: "browser-panel",
  moduleApiVersion: 1,
  activate(ctx, prev: any) {
    ctxRef = ctx;
    if (prev) { selected = prev.selected ?? null; fit = !!prev.fit; showNetwork = !!prev.showNetwork; netFilter = prev.netFilter || ""; }
    state = ctx.state.get<any>("browser.state") || state;
    workspace = ctx.state.get("workspace.selected") || null;
    ctx.state.watch("browser.state", (v: BrowserState) => {
      if (!v) return;
      state = v;
      if (showNetwork) void refreshNetwork();
      ctx.ui.invalidate();
    });
    ctx.state.watch("workspace.selected", (v: any) => { workspace = v; if (mode !== "view") ctx.ui.invalidate(); });
    ctx.state.watch("internal-mcp.settings", () => ctx.ui.invalidate());
    void refreshNetwork(true);
  },
  deactivate() { if (fitTimer !== null) clearTimeout(fitTimer); if (agentTimer !== null) clearTimeout(agentTimer); },
  snapshot: () => ({ selected, fit, showNetwork, netFilter }),
  render,
  onEvent,
};

export default mod;
