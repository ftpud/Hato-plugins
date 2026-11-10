// ../sdk/filter-style.ts
var filterInput = { height: 32, style: { noShrink: true } };

// ../sdk/chat-window.ts
var CHAT_MESSAGE_LIMIT = 20;
var CHAT_HISTORY_LIMIT = 60;
function messageWindow(messages, limit, before) {
  const boundary = before ? messages.findIndex((message) => (message.id || message.key) === before) : -1;
  const end = boundary >= 0 ? boundary : messages.length;
  const start = Math.max(0, end - limit);
  return { messages: messages.slice(start, end), hasLoadedOlder: start > 0, hasNewer: end < messages.length };
}

// ../sdk/context-usage.ts
function reportedUsage(value) {
  return value && typeof value.used === "number" && Number.isFinite(value.used) && value.used >= 0 && typeof value.size === "number" && Number.isFinite(value.size) && value.size >= 0 ? { used: value.used, size: value.size } : null;
}
function contextUsage(value) {
  const usage = reportedUsage(value);
  if (!usage || usage.size === 0) return { value: null, tooltip: "Context usage unavailable — the agent has not reported a context capacity." };
  const fraction = usage.used / usage.size;
  return { value: Math.min(1, fraction), tooltip: `${Math.round(fraction * 100)}% context used · ${String(usage.used).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} / ${String(usage.size).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} tokens` };
}
function usagePieSvg(value) {
  const v = value !== null && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null;
  const track = "currentColor";
  const fill = v !== null && v >= 0.9 ? "#d95050" : v !== null && v >= 0.75 ? "#bd8120" : "#6f7cf6";
  let body;
  if (v === null) body = `<circle cx='9' cy='9' r='7' fill='none' stroke='${track}' stroke-opacity='0.5' stroke-width='2' stroke-dasharray='2 2'/>`;
  else {
    const angle = v * Math.PI * 2;
    const x = (9 + 7 * Math.sin(angle)).toFixed(3), y = (9 - 7 * Math.cos(angle)).toFixed(3);
    const sector = v >= 1 ? `<circle cx='9' cy='9' r='7' fill='${fill}'/>` : v <= 0 ? "" : `<path d='M9 9 L9 2 A7 7 0 ${v > 0.5 ? 1 : 0} 1 ${x} ${y} Z' fill='${fill}'/>`;
    body = `<circle cx='9' cy='9' r='7' fill='${track}' fill-opacity='0.2'/>${sector}`;
  }
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 18 18'>${body}</svg>`;
}

// ../sdk/chat-style.ts
var chatStyle = {
  root: { position: "relative", background: "surface", color: "text", fontSize: 14, font: "ui", radius: 10, borderWidth: 1, borderColor: "border" },
  toolbar: { background: "field", borderBottom: 1, borderColor: "border", wrap: true },
  composer: { background: "surface", borderTop: 1, borderColor: "border" },
  settings: { background: "surface", color: "muted" },
  picker: { background: "surface", color: "text", borderWidth: 1, borderColor: "border", radius: 12 },
  control: { height: 32, fontSize: 14, radius: 8, background: "surface", borderColor: "border", color: "text", paddingX: 12, gap: 8 },
  iconControl: { height: 32, width: 32, radius: 8, background: "surface", borderColor: "border", color: "text", padding: 0, noShrink: true },
  fieldControl: { height: 36, radius: 8, background: "surface", borderColor: "border", color: "text", fullWidth: true, justify: "between" },
  primary: { height: 32, fontSize: 14, radius: 8, background: "primary", color: "primaryText", paddingX: 12, noShrink: true },
  iconPrimary: { height: 32, width: 32, radius: 8, background: "primary", color: "primaryText", padding: 0, noShrink: true },
  result: { fullWidth: true, height: 34, color: "text", justify: "start" },
  attach: { height: 32, width: 32, padding: 0, noShrink: true, radius: 8, background: "field", borderColor: "border" },
  textarea: { background: "field" }
};

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

// ../sdk/chat-transcript.ts
var ROLE_LABELS = { user: "YOU", plan: "PLAN", error: "ERROR", system: "SYSTEM" };
var EDGE = { user: "primary", assistant: "agentEdge", error: "danger" };
var singleLine = (text) => text.split(/\s+/).filter(Boolean).join(" ");
var copyButton = (key, text, tooltip, size = 22) => ({
  type: "button",
  key,
  text: "",
  iconSvg: uiIcons.copy,
  iconSize: 14,
  copyText: text,
  action: "",
  variant: "ghost",
  small: true,
  tooltip,
  style: { width: size + 4, height: 22, padding: 0, noShrink: true }
});
function markdown(key, text, linkAction, style) {
  return { type: "markdown", key, text, inline: true, lineHeight: 18, paragraphGap: 0.3, linkAction, style };
}
function messageNode(m, opts = {}) {
  if (m.role === "system" && /^Turn ended(?::|$)/.test(m.text)) {
    return { type: "divider", key: m.key, tooltip: m.text };
  }
  if (m.role === "thought") {
    return { type: "column", key: m.key, gap: 2, style: { borderLeft: 2, borderColor: "border", paddingX: 12, paddingY: 4, color: "muted", fontSize: 14 }, children: [
      { type: "label", key: "kind", text: "REASONING", size: "xs" },
      { type: "label", key: "body", text: m.text.replace(/\*\*([^]*?)\*\*/g, "$1").replace(/\*([^*\n]+)\*/g, "$1").replace(/\r\n?/g, "\n").replace(/\n[ \t]*\n+/g, "\n").trim(), wrap: true, selectable: true, color: "muted", style: { italic: true, fontWeight: 400, color: "muted", lineHeight: 18 } }
    ] };
  }
  if (m.role === "tool") {
    const title = m.title || "Tool";
    const copied = m.text ? `${title}
${m.text}` : title;
    return { type: "row", key: m.key, gap: 8, align: "center", style: { height: 28, noShrink: true, paddingX: 12, radius: 7, borderWidth: 1, borderColor: "border", color: "muted", fontSize: 14 }, children: [
      { type: "label", key: "kind", text: "TOOLS", size: "xs" },
      { type: "label", key: "summary", text: singleLine(title), grow: true },
      ...m.status ? [{ type: "label", key: "status", text: singleLine(m.status), size: "xs", style: { maxWidth: 72 } }] : [],
      copyButton("copy", copied, "Copy tool output")
    ] };
  }
  const label = m.role === "assistant" ? opts.agentLabel || "AGENT" : ROLE_LABELS[m.role] || "SYSTEM";
  const body = [];
  if (m.text) {
    body.push(m.role === "assistant" || m.role === "plan" ? markdown("text", m.text, opts.linkAction) : { type: "label", key: "text", text: m.text, wrap: true, selectable: true, style: { lineHeight: 18 } });
  }
  for (const [i, image] of (m.images || []).entries()) body.push({ type: "image", key: `image-${i}`, image, width: 200, height: 140 });
  return { type: "row", key: m.key, align: "stretch", style: { radius: 9, borderWidth: 1, borderColor: "border", noShrink: true }, children: [
    { type: "column", key: "edge", style: { width: 2, background: EDGE[m.role] || "border" }, children: [] },
    { type: "column", key: "card", grow: true, children: [
      { type: "row", key: "header", gap: 8, align: "center", style: { paddingX: 12, paddingY: 2, background: "surface", borderBottom: 1, borderColor: "border" }, children: [
        { type: "label", key: "role", text: label.toUpperCase(), size: "xs", color: "muted", grow: true },
        copyButton("copy", m.text, "Copy message")
      ] },
      { type: "column", key: "body", gap: 4, style: { paddingX: 12, paddingY: 4, lineHeight: 18, background: m.role === "user" ? "selection" : "answer", color: "text" }, children: body }
    ] }
  ] };
}
function transcriptItems(messages, opts = {}) {
  const items = [];
  if (opts.hasOlder) {
    items.push({
      type: "button",
      key: "__older",
      variant: "ghost",
      small: true,
      style: { fullWidth: true },
      text: opts.loadingOlder ? "Loading older messages…" : opts.historyError ? "Retry loading older messages" : "Load older messages",
      action: opts.loadOlderAction || "",
      disabled: !!opts.loadingOlder || !opts.loadOlderAction,
      tooltip: opts.historyError || "Load the previous message batch"
    });
  }
  for (const m of messages) if (!(m.role === "system" && /^Permission for "/.test(m.text || ""))) items.push(messageNode(m, opts));
  return items;
}
var followKey = (messages) => [...messages].reverse().find((m) => m.role === "user")?.key;

// ../sdk/images.ts
function imageAttachments(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 4) throw new Error("Attach up to 4 pictures.");
  let total = 0;
  return value.map((image) => {
    if (!image || !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(image.mimeType) || typeof image.data !== "string" || !image.data.length || image.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) throw new Error("Invalid image attachment. Use PNG, JPEG, WebP or GIF.");
    const size = image.data.length / 4 * 3 - (image.data.endsWith("==") ? 2 : image.data.endsWith("=") ? 1 : 0);
    total += size;
    if (size > 5 * 1024 * 1024 || total > 10 * 1024 * 1024) throw new Error("Pictures must be under 5 MB each and 10 MB combined.");
    return { name: String(image.name || "Picture").slice(0, 180), mimeType: image.mimeType, data: image.data };
  });
}

// ../sdk/runtime.ts
function debounce(fn, ms) {
  let t = null;
  return () => {
    if (t !== null) return;
    t = setTimeout(() => {
      t = null;
      fn();
    }, ms);
  };
}
function errMsg(e) {
  return e && (e.message || String(e)) || "unknown error";
}

// ../sdk/links.ts
function resolveWorkspaceLink(href, rootAbsolutePath, baseDir = "") {
  let raw = String(href || "").trim().replace(/^<|>$/g, "");
  if (!raw || raw.startsWith("#")) return null;
  if (!rootAbsolutePath || !rootAbsolutePath.startsWith("/")) return null;
  let absolute = false;
  if (/^file:/i.test(raw)) {
    const authority = /^file:\/\/([^/]*)/i.exec(raw)?.[1];
    if (authority && authority.toLowerCase() !== "localhost") return null;
    raw = raw.replace(/^file:(\/\/[^/]*)?/i, "");
    absolute = true;
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(raw.replace(/:\d+(?::\d+)?(?:[?#].*)?$/, ""))) return null;
  raw = raw.replace(/[?#].*$/, "");
  try {
    raw = decodeURIComponent(raw);
  } catch {
  }
  raw = raw.replace(/:\d+(?::\d+)?$/, "");
  if (!raw) return null;
  const root = normalize(rootAbsolutePath || "");
  let full;
  if (absolute || raw.startsWith("/")) full = normalize(raw);
  else if (raw.startsWith("~")) return null;
  else full = normalize(`${root}/${baseDir}/${raw}`);
  if (!root || full === root) return null;
  const prefix = root === "/" ? "/" : root + "/";
  if (!full.startsWith(prefix)) return null;
  return full.slice(prefix.length);
}
function normalize(path) {
  const out = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return "/" + out.join("/");
}

// ../sdk/persistent-agents.ts
var agentPolicy = (s) => s.autopilot ? "autopilot" : s.approvalPolicy === "auto-low" ? "auto-low" : "ask";
function agentSettings(value) {
  const out = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [k, v] of Object.entries(value).slice(0, 32))
    if (k && k.length <= 200 && (typeof v === "boolean" || typeof v === "string" && v.length <= 500)) out[k] = v;
  return out;
}

// modules/ui/ai/src/index.ts
var background = null;
var backgroundPage = null;
var backgroundTimer = null;
var backgroundSessions = [];
var confirmRuntimeUpdate = false;
var backgroundCatalog = null;
var sessionMcpIds = (s) => [...s.workspaceMcp ? ["internal-remote-mcp"] : [], ...(s.mcps || []).map((m) => m.id)];
var list = (v) => Array.isArray(v) ? v : [];
var normalCatalog = (c, workspaceId) => ({ workspaceId, profiles: list(c?.profiles), mcps: list(c?.mcps), agentFiles: list(c?.agentFiles), skills: list(c?.skills) });
async function loadCatalog(ctx) {
  const workspaceId = ws?.id;
  if (!workspaceId) return;
  try {
    const c = await persistent(ctx, "catalog");
    if (ws?.id === workspaceId) {
      backgroundCatalog = normalCatalog(c, workspaceId);
      void load(ctx);
    }
  } catch (e) {
    if (background) error = errMsg(e);
  }
}
async function updateBackground(ctx, patch) {
  const s = backgroundPage?.session;
  if (!s) throw new Error("Background session is still loading");
  if (["busy", "waiting", "starting"].includes(s.status)) throw new Error("Wait for the agent to finish its turn, or stop it, before changing its configuration");
  await persistent(ctx, "update", {
    name: s.name,
    profileId: patch.profileId ?? s.profile.id,
    agentFile: patch.agentFile !== void 0 ? patch.agentFile : s.agentFile,
    skills: patch.skills ?? s.skills,
    mcps: patch.mcps ?? sessionMcpIds(s)
  });
}
var normalDraft;
var normalAttachments = [];
var backgroundDrafts = /* @__PURE__ */ new Map();
var requests = /* @__PURE__ */ new Map();
function persistent(ctx, method, args = {}) {
  const selection = background || (ws ? { workspaceId: ws.id } : null);
  if (!selection) return Promise.reject(new Error("No background session selected"));
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      requests.delete(requestId);
      reject(new Error("Background session request timed out"));
    }, 24e4);
    requests.set(requestId, { resolve, reject, timer });
    ctx.events.emit("ai.persistentRequest", { requestId, method, args: { ...selection, ...args } });
  });
}
function resetChatWindows() {
  historyBefore = [];
  historyLimit = CHAT_MESSAGE_LIMIT;
  settingsOpen = false;
  modelsOpen = false;
  historyOpen = false;
  mcpOpen = false;
  skillsOpen = false;
  error = null;
}
function publishSession(ctx) {
  ctx.state.set("ai.session", background ? { kind: "background", ...background } : { kind: "chat" });
}
async function openBackground(ctx, selection) {
  if (!ws || selection?.workspaceId !== ws.id || typeof selection.id !== "string") return;
  if (background) backgroundDrafts.set(background.id, draft || "");
  else {
    normalDraft = draft;
    normalAttachments = attachments;
  }
  background = { workspaceId: selection.workspaceId, id: selection.id };
  backgroundPage = null;
  view = null;
  draft = backgroundDrafts.get(selection.id) || "";
  attachments = [];
  resetChatWindows();
  publishSession(ctx);
  if (backgroundTimer) clearInterval(backgroundTimer);
  backgroundTimer = setInterval(() => {
    void load(ctx);
  }, 1500);
  ctx.events.emit("ai.chatOpened", {});
  if (backgroundCatalog?.workspaceId !== selection.workspaceId) void loadCatalog(ctx);
  await ctx.modules.call("workspace", "view.patch", { workspaceId: selection.workspaceId, patch: { ui: { aiBackgroundSession: selection.id } } });
  await load(ctx);
}
function leaveBackground(ctx) {
  if (background) backgroundDrafts.set(background.id, draft || "");
  background = null;
  backgroundPage = null;
  view = null;
  draft = normalDraft;
  attachments = normalAttachments;
  if (backgroundTimer) clearInterval(backgroundTimer);
  backgroundTimer = null;
  resetChatWindows();
  publishSession(ctx);
}
var composerFraction = 0.24;
var composerFractions = /* @__PURE__ */ new Map();
var clampComposerFraction = (value) => typeof value === "number" && Number.isFinite(value) ? Math.max(0.15, Math.min(0.65, value)) : 0.24;
async function restoreComposer(ctx) {
  const id = ws?.id;
  composerFraction = id ? composerFractions.get(id) ?? 0.24 : 0.24;
  if (!id || composerFractions.has(id)) return;
  try {
    const saved = await ctx.modules.call("workspace", "view.get", { workspaceId: id });
    const fraction = clampComposerFraction(saved?.ui?.aiComposerFraction);
    if (!composerFractions.has(id)) composerFractions.set(id, fraction);
    if (ws?.id === id) {
      composerFraction = composerFractions.get(id);
      ctx.ui.invalidate();
    }
  } catch {
  }
}
var ws = null;
var view = null;
var error = null;
var busy = null;
var settingsOpen = false;
var mcpOpen = false;
var modelsOpen = false;
var historyOpen = false;
var historyQuery = "";
var historyConversationId = null;
var historyBefore = [];
var pagingHistory = false;
var historyLimit = CHAT_MESSAGE_LIMIT;
var preserveHistoryScroll = false;
var historyScrollReset = 0;
var skillsOpen = false;
var modelQuery = "";
var workspaceSkillState = null;
var attachments = [];
var connectionAttempts = /* @__PURE__ */ new Set();
var draft = void 0;
var refresh = () => {
};
var adaptersOpen = false;
var adapters = null;
var adaptersBusy = null;
var adaptersMsg = null;
async function loadAdapters(ctx) {
  if (!ws) return;
  adaptersBusy = "check";
  ctx.ui.invalidate();
  try {
    adapters = await ctx.modules.call("ai-sessions", "adapters", { workspaceId: ws.id }, { timeoutMs: 3e5 });
  } catch (e) {
    adaptersMsg = { level: "error", text: errMsg(e) };
  } finally {
    adaptersBusy = null;
    ctx.ui.invalidate();
  }
}
function adapterWindow() {
  const rows = (adapters || []).map((a) => {
    const upToDate = a.installed && a.latest && a.installed === a.latest;
    const label = !a.installed ? "Install" : upToDate ? "Reinstall" : "Update";
    const status = a.error ? a.error : !a.installed ? `not installed · latest ${a.latest || "?"}` : `installed ${a.installed}${a.latest ? upToDate ? " · up to date" : ` · update available: ${a.latest}` : ""}`;
    return { type: "row", key: "ad-" + a.id, gap: 8, align: "center", border: true, padding: 6, children: [
      { type: "column", key: "info", grow: true, gap: 2, children: [
        { type: "label", key: "n", text: a.name, weight: "bold", size: "sm" },
        { type: "label", key: "p", text: `${a.pkg}${a.path ? " → " + a.path : ""}`, size: "xs", color: "muted" },
        { type: "label", key: "s", text: status, size: "xs", color: a.error ? "danger" : upToDate ? "success" : a.installed ? "warning" : "muted", wrap: true }
      ] },
      { type: "button", key: "b", text: adaptersBusy === a.id ? "Working…" : label, action: "installAdapter", value: a.id, small: true, variant: upToDate ? "default" : "primary", disabled: !!adaptersBusy }
    ] };
  });
  return { type: "modal", key: "adapters-modal", title: `ACP adapters on ${ws ? ws.machineId : "?"}`, closeAction: "closeAdapters", children: [
    { type: "label", key: "hint", text: "Agents run on the workspace's machine. Install or update an adapter there with npm (you will be asked to confirm). Authenticate it afterwards (e.g. `claude` login or `codex login`).", size: "xs", color: "muted", wrap: true },
    ...adaptersMsg ? [{ type: "status", key: "msg", text: adaptersMsg.text, level: adaptersMsg.level }] : [],
    ...adaptersBusy ? [{ type: "progress", key: "busy", indeterminate: true, label: adaptersBusy === "check" ? "Checking installed and latest versions…" : `Installing ${adaptersBusy}… (npm install -g)` }] : [],
    ...adapters ? rows : [],
    { type: "row", key: "foot", gap: 6, children: [
      { type: "spacer", key: "sp" },
      { type: "button", key: "recheck", text: "Check versions", action: "checkAdapters", small: true, disabled: !!adaptersBusy },
      { type: "button", key: "close", text: "Close", action: "closeAdapters", small: true }
    ] }
  ] };
}
async function load(ctx) {
  if (!ws) {
    view = null;
    ctx.ui.invalidate();
    return;
  }
  if (background) {
    const selection = background;
    try {
      const page = await persistent(ctx, "view", { limit: Math.min(historyLimit, 200), before: Number(historyBefore[historyBefore.length - 1]) || void 0 });
      if (background !== selection || ws?.id !== selection.workspaceId) return;
      backgroundPage = page;
      const session = page.session;
      const catalog = backgroundCatalog?.workspaceId === ws.id ? backgroundCatalog : null;
      const profiles = catalog?.profiles.some((p) => p.id === session.profile.id) ? catalog.profiles : [session.profile, ...catalog?.profiles || []];
      view = {
        workspace: { name: ws.name, machineId: session.machineId, root: session.root },
        profiles,
        mcpServers: (catalog?.mcps || []).map((m) => ({ id: m.id, name: m.name, description: m.description })),
        conversations: backgroundSessions.map((s) => ({ id: s.id, title: s.name, acpProfileId: s.profile.id, status: s.status })),
        activeId: session.id,
        active: {
          conversation: { id: session.id, title: session.name, acpProfileId: session.profile.id, status: session.status, approvalPolicy: agentPolicy(session), mcpSelection: sessionMcpIds(session) },
          live: { ...session, profileId: session.profile.id },
          messages: page.messages,
          windowed: true,
          hasOlder: page.before !== null,
          hasLoadedOlder: false,
          hasNewer: historyBefore.length > 0,
          busy: ["busy", "waiting"].includes(session.status),
          steering: page.queued.length
        }
      };
      error = null;
    } catch (e) {
      if (background === selection) error = errMsg(e);
    }
    ctx.ui.invalidate();
    return;
  }
  try {
    const workspaceId = ws.id;
    const next = await ctx.modules.call("ai-sessions", "view", {
      workspaceId,
      messageLimit: historyLimit,
      windowConversationId: historyConversationId,
      beforeMessageId: historyBefore[historyBefore.length - 1]
    });
    if (ws?.id !== workspaceId || background) return;
    if (historyConversationId !== next.active?.conversation?.id) {
      historyBefore = [];
      historyLimit = CHAT_MESSAGE_LIMIT;
      preserveHistoryScroll = false;
      historyConversationId = next.active?.conversation?.id || null;
    }
    view = next;
    error = null;
    const active = view.active;
    if (active && !connectionAttempts.has(active.conversation.id)) {
      const id = active.conversation.id;
      connectionAttempts.add(id);
      if (!active.live || !["ready", "busy", "starting", "connecting"].includes(active.live.status)) {
        ctx.ui.invalidate();
        await ctx.modules.call("ai-sessions", "connect", { conversationId: id }, { timeoutMs: 6e5 });
        if (ws?.id === workspaceId && !background) {
          const resumed = await ctx.modules.call("ai-sessions", "view", { workspaceId, messageLimit: historyLimit, windowConversationId: historyConversationId, beforeMessageId: historyBefore[historyBefore.length - 1] });
          if (ws?.id === workspaceId && !background) view = resumed;
        }
      }
    }
  } catch (e) {
    error = errMsg(e);
  }
  ctx.ui.invalidate();
}
var POLICIES = [
  { value: "ask", label: "Ask (default)" },
  { value: "auto-low", label: "Auto-approve low-risk" },
  { value: "autopilot", label: "Autopilot (explicit opt-in)" }
];
function flattenOptions(o) {
  const out = [];
  for (const x of o.options || []) {
    if (Array.isArray(x.options)) for (const y of x.options) out.push({ value: String(y.value), label: `${x.name || x.group}: ${y.name}` });
    else out.push({ value: String(x.value), label: x.name || String(x.value) });
  }
  return out;
}
function selectors(live, connected) {
  const out = [];
  const reason = connected ? "not advertised by this agent" : "connect to read the agent's advertised options";
  const opts = live && Array.isArray(live.configOptions) ? live.configOptions : [];
  const byCat = (cat) => opts.filter((o) => o.category === cat && o.type !== "boolean");
  const sel = (key, label, o) => ({ type: "select", key, label, options: flattenOptions(o), value: o.currentValue === void 0 ? null : String(o.currentValue), action: "setConfig:" + o.id, placeholder: "—" });
  const disabled = (key, label, why = reason) => ({ type: "select", key, label, options: [], value: null, action: "noop", disabled: true, placeholder: "n/a", disabledReason: why, tooltip: why });
  const model = byCat("model")[0];
  if (model) out.push(sel("cfg-model", "Model", model));
  else if (live && live.models && live.models.availableModels) out.push({ type: "select", key: "cfg-model", label: "Model", options: live.models.availableModels.map((m) => ({ value: m.modelId, label: m.name || m.modelId })), value: live.models.currentModelId, action: "setConfig:__model" });
  else out.push(disabled("cfg-model", "Model"));
  const thought = byCat("thought_level")[0];
  out.push(thought ? sel("cfg-reasoning", "Reasoning effort", thought) : disabled("cfg-reasoning", "Reasoning effort"));
  const mode = byCat("mode")[0];
  if (mode) out.push(sel("cfg-mode", "Collaboration mode", mode));
  else if (live && live.modes && live.modes.availableModes) out.push({ type: "select", key: "cfg-mode", label: "Mode", options: live.modes.availableModes.map((m) => ({ value: m.id, label: m.name || m.id })), value: live.modes.currentModeId, action: "setConfig:__mode" });
  else out.push(disabled("cfg-mode", "Mode"));
  for (const o of opts.filter((o2) => !["model", "thought_level", "mode"].includes(o2.category) && o2.type !== "boolean")) out.push(sel("cfg-" + o.id, o.name || o.id, o));
  for (const o of opts.filter((o2) => o2.type === "boolean")) out.push({ type: "toggle", key: "cfg-" + o.id, label: o.name || o.id, checked: !!o.currentValue, action: "setConfig:" + o.id, tooltip: o.description });
  return out;
}
function visibleHistory(active) {
  const window = messageWindow(
    active?.messages || [],
    historyLimit,
    active?.windowed ? void 0 : historyBefore[historyBefore.length - 1]
  );
  return {
    messages: window.messages,
    hasOlder: !!active?.hasOlder || window.hasLoadedOlder,
    hasLoadedOlder: window.hasLoadedOlder || !!(active?.windowed && active.hasLoadedOlder),
    hasNewer: active?.windowed ? !!active.hasNewer : window.hasNewer
  };
}
var mod = {
  id: "ai",
  moduleApiVersion: 1,
  async activate(ctx, prev) {
    if (prev?.composerFractions) for (const [id, value] of prev.composerFractions) composerFractions.set(id, clampComposerFraction(value));
    if (prev?.attachments) attachments = imageAttachments(prev.attachments);
    if (prev && typeof prev.draft === "string") draft = prev.draft;
    refresh = debounce(() => load(ctx), 40);
    ws = ctx.state.get("workspace.selected") || null;
    void restoreComposer(ctx);
    workspaceSkillState = ctx.state.get("files.skills") || null;
    ctx.state.watch("files.skills", (value) => {
      workspaceSkillState = value;
      ctx.ui.invalidate();
    });
    ctx.state.watch("workspace.selected", (v) => {
      const changed = ws?.id !== v?.id;
      ws = v;
      if (changed) {
        void restoreComposer(ctx);
        if (background) leaveBackground(ctx);
        const saved = v?.view?.ui?.aiBackgroundSession;
        if (saved) void openBackground(ctx, { workspaceId: v.id, id: saved });
        else void load(ctx);
      }
    });
    ctx.events.on("persistent-agents.chatResponse", (response) => {
      const pending = requests.get(response?.requestId);
      if (!pending) return;
      requests.delete(response.requestId);
      clearTimeout(pending.timer);
      if (response.error) pending.reject(new Error(response.error));
      else pending.resolve(response.value);
    });
    ctx.events.on("agents-panel.openChat", (selection) => {
      void openBackground(ctx, selection);
    });
    ctx.events.on("workflows-panel.openChat", (selection) => {
      void openBackground(ctx, selection);
    });
    ctx.events.on("agents-panel.agentRemoved", (e) => {
      if (e?.id) {
        backgroundDrafts.delete(e.id);
        if (background?.id === e.id) {
          leaveBackground(ctx);
          void load(ctx);
        }
      }
    });
    ctx.events.on("agents-panel.agentCleared", (e) => {
      if (background?.id === e?.id) {
        resetChatWindows();
        void load(ctx);
      }
    });
    ctx.events.on("ai-sessions.changed", () => refresh());
    ctx.events.on("acp.status", () => refresh());
    ctx.events.on("acp.adaptersChanged", () => {
      if (adaptersOpen) loadAdapters(ctx);
    });
    ctx.events.on("acp.authChanged", () => refresh());
    if (prev?.background && prev.background.workspaceId === ws?.id) {
      normalDraft = prev.normalDraft;
      normalAttachments = prev.normalAttachments || [];
      const opening = openBackground(ctx, prev.background);
      normalDraft = prev.normalDraft;
      normalAttachments = prev.normalAttachments || [];
      draft = prev.draft || "";
      void opening.catch((e) => {
        error = errMsg(e);
        ctx.ui.invalidate();
      });
    } else if (ws?.view?.ui?.aiBackgroundSession) void openBackground(ctx, { workspaceId: ws.id, id: ws.view.ui.aiBackgroundSession }).catch((e) => {
      error = errMsg(e);
      ctx.ui.invalidate();
    });
    else void load(ctx);
  },
  deactivate() {
    if (backgroundTimer) clearInterval(backgroundTimer);
    backgroundTimer = null;
    for (const p of requests.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("Chat module reloaded"));
    }
    requests.clear();
  },
  snapshot: () => background ? { draft, attachments, background, normalDraft, normalAttachments, composerFractions: [...composerFractions] } : { draft, attachments, composerFractions: [...composerFractions] },
  render() {
    const active = view?.active;
    const conv = active?.conversation;
    const live = active?.live;
    const context = contextUsage(live?.usage);
    const connected = !!live && ["ready", "busy", ...background ? ["waiting"] : []].includes(live.status);
    const profile = view?.profiles.find((p) => p.id === conv?.acpProfileId);
    const providerName = profile?.name?.replace(/\s*\([^)]*\)$/, "") || "Agent";
    const skillState = workspaceSkillState?.workspaceId === ws?.id ? workspaceSkillState : null;
    const skills = skillState?.skills || [];
    const config = selectors(live, connected);
    const model = config.find((n) => n.key === "cfg-model");
    const modelName = model.options.find((o) => o.value === model.value)?.label || (connected ? "Choose model" : "Connect to choose");
    const modelOption = (live?.configOptions || []).find((o) => o.category === "model");
    const advertised = (modelOption?.options || []).flatMap((o) => o.options || [o]);
    const modelDetails = (id) => advertised.find((o) => String(o.value) === id) || live?.models?.availableModels?.find((o) => o.modelId === id);
    const iconButton = (key, icon, action, tooltip) => ({ type: "button", key, text: "", iconSvg: uiIcons[icon], action, tooltip, style: chatStyle.iconControl, disabled: !ws });
    const header = { type: "row", key: "hdr", style: chatStyle.toolbar, padding: 8, gap: 6, align: "center", children: [
      { type: "column", key: "provider-field", grow: true, minWidth: 100, gap: 0, children: [
        { type: "select", key: "agent", height: 32, buttonStyle: { ...chatStyle.fieldControl, height: 32 }, tooltip: active?.busy || live?.status === "starting" ? "Wait for the agent to finish or stop its turn before switching providers" : "Provider", options: (view?.profiles || []).map((p) => ({ value: p.id, label: p.name.replace(/\s*\([^)]*\)$/, "") })), value: conv?.acpProfileId || null, action: "setProfile", disabled: !conv || !!active?.busy || live?.status === "starting" || live?.status === "busy", placeholder: "Choose provider" }
      ] },
      { type: "column", key: "model-field", grow: true, minWidth: 100, gap: 0, children: [
        { type: "button", key: "cfg-model", style: { ...chatStyle.control, fullWidth: true }, text: modelName + "  ⌄", action: "toggleModels", disabled: model.disabled, tooltip: "Choose model", grow: true }
      ] },
      { type: "switch", key: "auto", style: { radius: 8, color: "muted" }, label: "Auto", checked: conv?.approvalPolicy === "autopilot", action: "toggleAuto", disabled: !conv, tooltip: "Automatically approve agent tool permissions. Module changes still require native approval." },
      iconButton("settings-toggle", "sliders-horizontal", "toggleSettings", "Agent settings"),
      iconButton("new", "plus", "newChat", "New chat"),
      iconButton("history-toggle", "message-square", "toggleHistory", "Chat history")
    ] };
    if (background) header.children = header.children.map((n) => n.key === "auto" ? { ...n, tooltip: "Autopilot: approve this background agent's tool permissions and Git task creation automatically, even while Hato is closed." } : n);
    const kids = [header];
    if (background) {
      kids.push({ type: "row", key: "background-session", padding: 8, gap: 6, children: [
        { type: "label", key: "name", text: conv?.title || "Background agent", grow: true, weight: "semibold" },
        { type: "button", key: "back-to-chats", text: "Chats", action: "backToChats", small: true, variant: "ghost" },
        { type: "button", key: "stop-agent", text: "Stop agent", action: "stopBackground", small: true, variant: "ghost" }
      ] });
      if (live && ["stopped", "interrupted", "error"].includes(live.status)) kids.push({ type: "button", key: "reconnect-background", text: "Reconnect saved agent", action: "reconnect", small: true });
      for (const permission of backgroundPage?.permissions || []) kids.push({ type: "button", key: permission.id, text: "Review: " + (permission.request.toolCall?.title || "Agent permission"), action: "reviewBackgroundPermission", value: permission.id, small: true });
    }
    if (!ws) kids.push({ type: "label", key: "none", text: "Select a project or task to start chatting.", color: "muted", padding: 16, wrap: true });
    else if (!view) kids.push({ type: "progress", key: "ld", indeterminate: true });
    if (error) kids.push({ type: "status", key: "err", text: error, level: "error" });
    if (error && background && /runtime is older/.test(error)) kids.push({ type: "row", key: "runtime-fix", gap: 6, padding: 8, children: [
      { type: "button", key: "update-runtime", text: confirmRuntimeUpdate ? "Confirm: restart agents and update" : "Update runtime", action: confirmRuntimeUpdate ? "updateRuntime" : "askUpdateRuntime", small: true, variant: confirmRuntimeUpdate ? "danger" : "primary", disabled: busy === "updateRuntime" },
      ...confirmRuntimeUpdate ? [{ type: "button", key: "cancel-update", text: "Cancel", action: "cancelUpdateRuntime", small: true, variant: "ghost" }] : []
    ] });
    if (live?.error && !connected) kids.push({ type: "status", key: "liveerr", text: live.error, level: "error" });
    if (adaptersOpen && ws) kids.push(adapterWindow());
    if (historyOpen && view) {
      const sessions = view.conversations.filter((c) => `${c.title} ${view.profiles.find((p) => p.id === c.acpProfileId)?.name || ""}`.toLowerCase().includes(historyQuery.toLowerCase()));
      kids.push({ type: "modal", key: "history", title: "Sessions", closeAction: "toggleHistory", children: [
        { type: "row", key: "sessions-heading", gap: 12, align: "center", children: [
          { type: "column", key: "summary", grow: true, gap: 4, children: [
            { type: "label", key: "workspace", text: view.workspace.name || ws?.name || "Workspace chats", weight: "semibold" },
            { type: "label", key: "count", text: `${view.conversations.length} saved conversation${view.conversations.length === 1 ? "" : "s"}`, color: "muted", size: "xs" }
          ] },
          { type: "button", key: "new-chat", text: view.profiles.length ? "New chat" : "Browse providers", iconSvg: uiIcons.plus, action: "newChat", style: chatStyle.primary, tooltip: "Start a chat with the current chat’s settings" }
        ] },
        { type: "textInput", key: "session-search", ...filterInput, value: historyQuery, placeholder: "Search sessions or providers…", changeAction: "searchSessions" },
        { type: "column", key: "session-list", scroll: true, maxHeight: 440, gap: 6, children: sessions.length ? sessions.map((c) => {
          const provider = view.profiles.find((p) => p.id === c.acpProfileId)?.name || "Agent";
          const selected = c.id === view.activeId;
          return {
            type: "choice",
            key: c.id,
            text: c.title,
            description: `${provider} · ${c.status === "busy" ? "Working" : c.status === "online" ? "Connected" : c.status === "error" ? "Needs attention" : "Saved"}${selected ? " · Current session" : ""}`,
            selected,
            action: "selectConv",
            value: c.id,
            style: { padding: 12, radius: 10, borderWidth: 1, borderColor: selected ? "primary" : "border", background: selected ? "selection" : "background" }
          };
        }) : [{ type: "label", key: "no-sessions", text: historyQuery ? "No matching sessions. Try another search." : "Your conversations will appear here.", color: "muted", padding: 20, wrap: true }] }
      ] });
    }
    if (conv) {
      if (settingsOpen) {
        const fields = [
          { type: "row", key: "heading", gap: 8, children: [
            { type: "label", key: "title", text: providerName + " settings", weight: "bold", grow: true },
            iconButton("close", "x", "toggleSettings", "Close settings")
          ] },
          { type: "divider", key: "divider" },
          ...modelDetails(model.value || "")?.description ? [{ type: "label", key: "model-description", text: modelDetails(model.value || "").description, wrap: true, color: "muted" }] : []
        ];
        for (const field of config.filter((n) => n.key !== "cfg-model")) {
          const option = (live?.configOptions || []).find((o) => "cfg-" + o.id === field.key);
          if (field.type === "select") {
            fields.push({ type: "label", key: field.key + "-label", text: field.label || "Option", color: "muted" });
            fields.push({ ...field, label: void 0, buttonStyle: chatStyle.fieldControl });
          } else fields.push(field);
          if (option?.description) fields.push({ type: "label", key: field.key + "-hint", text: option.description, size: "sm", color: "muted", wrap: true });
        }
        fields.push({ type: "select", key: "policy", label: "Approval policy", options: POLICIES, value: conv.approvalPolicy, action: "setPolicy", buttonStyle: chatStyle.fieldControl });
        if (background && backgroundPage) {
          const session = backgroundPage.session, files = backgroundCatalog?.agentFiles || [];
          const idle = !["busy", "waiting", "starting"].includes(session.status);
          fields.push({
            type: "select",
            key: "agent-file",
            label: "Instructions",
            buttonStyle: chatStyle.fieldControl,
            action: "setAgentFile",
            disabled: !idle,
            options: [{ value: "", label: "None" }, ...files.map((f) => ({ value: f.path, label: f.path })), ...session.agentFile && !files.some((f) => f.path === session.agentFile) ? [{ value: session.agentFile, label: session.agentFile }] : []],
            value: session.agentFile || "",
            tooltip: "Instruction file sent with the first prompt. Changing it restarts a connected agent."
          });
          fields.push({ type: "label", key: "agent-skills", text: "Instruction skills: " + (session.skills.join(", ") || "None") + " · edit in the Agents panel", size: "xs", color: "muted", wrap: true });
        }
        if (profile?.authOption) fields.push({ type: "toggle", key: "provider-auth", label: profile.authOption.label, checked: view.auth?.[profile.authOption.field] !== false, action: "toggleProviderAuth", tooltip: profile.authOption.description });
        fields.push({ type: "label", key: "loc", text: `${live?.machineId || view.workspace.machineId} · ${view.workspace.root}`, size: "xs", color: "muted", wrap: true });
        fields.push({ type: "row", key: "connection", gap: 8, children: [
          ...background ? [
            { type: "button", key: "connect", text: connected ? "Reconnect" : "Connect", action: "reconnect", style: chatStyle.control, disabled: !!active?.busy },
            { type: "button", key: "stop", text: "Stop agent", action: "stopBackground", style: chatStyle.control, disabled: !live || live.status === "stopped" }
          ] : [{ type: "button", key: "connect", text: connected ? "Disconnect" : "Connect", action: connected ? "disconnect" : "connect", style: chatStyle.control }],
          { type: "button", key: "adapters", text: "Manage agents…", action: "openAdapters", style: chatStyle.control }
        ] });
        if (background) fields.push({ type: "row", key: "runtime", gap: 8, align: "center", children: [
          {
            type: "button",
            key: "update-runtime",
            text: confirmRuntimeUpdate ? "Confirm update" : "Update runtime",
            action: confirmRuntimeUpdate ? "updateRuntime" : "askUpdateRuntime",
            style: chatStyle.control,
            variant: confirmRuntimeUpdate ? "danger" : void 0,
            disabled: busy === "updateRuntime",
            tooltip: "Install this desktop's agent runtime on the machine now. Running background agents restart and reconnect; a turn in progress is interrupted."
          },
          ...confirmRuntimeUpdate ? [{ type: "button", key: "cancel-update", text: "Cancel", action: "cancelUpdateRuntime", style: chatStyle.control }] : [],
          { type: "label", key: "hint", text: confirmRuntimeUpdate ? "Restarts all background agents on this machine" : "", size: "xs", color: "muted", grow: true, wrap: true }
        ] });
        kids.push({ type: "column", key: "settings", style: chatStyle.settings, grow: true, scroll: true, gap: 10, padding: 12, children: fields });
      } else {
        const history = visibleHistory(active);
        if (history.hasOlder || historyBefore.length || historyLimit > CHAT_MESSAGE_LIMIT) kids.push({ type: "row", key: "message-history", gap: 6, children: [
          { type: "button", key: "older-messages", text: pagingHistory ? "Loading…" : "Older", action: "revealOlder", small: true, variant: "ghost", disabled: pagingHistory || !history.hasOlder },
          { type: "label", key: "history-window", text: historyBefore.length ? "Older messages" : `Latest ${history.messages.length} messages`, size: "xs", color: "muted", grow: true },
          ...historyBefore.length ? [{ type: "button", key: "newer-messages", text: "Newer", action: "revealNewer", small: true, variant: "ghost", disabled: pagingHistory }] : [],
          ...historyBefore.length || historyLimit > CHAT_MESSAGE_LIMIT ? [{ type: "button", key: "latest-messages", text: "Latest", action: "latestMessages", small: true, variant: "ghost", disabled: pagingHistory }] : []
        ] });
        if (active.historyError) kids.push({ type: "status", key: "history-error", text: active.historyError, level: "error" });
        const loadingOlder = pagingHistory || !!active.historyLoading;
        kids.push({
          type: "transcript",
          key: "transcript",
          scrollbarMode: "scrolling",
          scrollKey: conv.id,
          followKey: followKey(history.messages),
          hasOlder: history.hasOlder,
          loadingOlder,
          loadOlderAction: "revealOlder",
          bottomAction: history.hasNewer ? "revealNewer" : historyLimit > CHAT_MESSAGE_LIMIT ? "collapseHistory" : void 0,
          preserveScrollOnChange: preserveHistoryScroll,
          scrollReset: historyScrollReset,
          grow: true,
          children: transcriptItems(history.messages, {
            agentLabel: providerName + (model.value ? " · " + modelName : ""),
            linkAction: "openLink",
            hasOlder: history.hasOlder,
            loadingOlder,
            historyError: active.historyError,
            loadOlderAction: "revealOlder"
          })
        });
        const composer = [];
        if (attachments.length) composer.push({ type: "row", key: "attachments", gap: 8, children: attachments.map((image, index) => ({ type: "column", key: "attachment-" + index, gap: 4, children: [
          { type: "image", key: "preview", image, width: 80, height: 64 },
          { type: "button", key: "remove", text: "× " + image.name, action: "removeImage", value: index, small: true, tooltip: "Remove picture" }
        ] })) });
        composer.push({ type: "textInput", key: "prompt", style: { ...chatStyle.textarea, minHeight: 72 }, changeAction: "draftChanged", pasteImageAction: "attachImages", maxFiles: 4, maxBytes: 5 * 1024 * 1024, placeholder: active.busy ? "Steer " + providerName + "…" : "Ask " + providerName + "…", multiline: true, fillHeight: true, grow: true, rows: 2, submitAction: "send", value: draft });
        composer.push({ type: "row", key: "act", gap: 6, children: [
          {
            type: "imagePicker",
            key: "attach",
            action: "attachImages",
            iconSvg: uiIcons.paperclip,
            style: chatStyle.attach,
            maxFiles: 4,
            maxBytes: 5 * 1024 * 1024,
            dialogTitle: "Attach pictures",
            tooltip: "Attach pictures (PNG, JPEG, WebP or GIF)",
            disabled: busy === "send"
          },
          { type: "button", key: "mcp-toggle", text: `MCP ${(conv.mcpSelection || []).length}`, iconSvg: uiIcons.plug, action: "toggleMcpPicker", style: mcpOpen ? { ...chatStyle.control, borderColor: "primary" } : chatStyle.control, tooltip: "MCP servers and skills for this chat" },
          { type: "label", key: "chat-status", grow: true, text: active.steering ? "Steering…" : active.busy ? "Working…" : connected ? "" : live?.status || conv.status || "Offline", size: "xs", color: "muted", tooltip: `${providerName} · ${live?.status || conv.status || "offline"}` },
          {
            type: "button",
            key: "context-usage",
            text: context.value === null ? "—" : `${Math.round(context.value * 100)}%`,
            iconSvg: usagePieSvg(context.value),
            iconSize: 18,
            action: "",
            variant: "ghost",
            small: true,
            tooltip: context.tooltip,
            style: { height: 32, paddingX: 4, gap: 4, noShrink: true, color: "muted" }
          },
          ...active.busy ? [{ type: "button", key: "cancel", text: "Stop", action: "cancel", style: chatStyle.control }] : [],
          { type: "button", key: "send", text: "", iconSvg: uiIcons.send, action: "send", style: chatStyle.iconPrimary, variant: "primary", disabled: busy === "send", tooltip: active.busy ? "Steer agent" : "Send message" }
        ] });
        const transcript = kids.pop();
        kids.push({
          type: "split",
          key: "chat-composer-split",
          direction: "vertical",
          grow: true,
          fixed: attachments.length ? [null, 240] : void 0,
          sizes: [1 - Math.max(composerFraction, attachments.length ? 0.42 : 0), Math.max(composerFraction, attachments.length ? 0.42 : 0)],
          minSize: attachments.length ? 220 : 96,
          resizeAction: "resizeComposer",
          children: [transcript, { type: "column", key: "composer", style: chatStyle.composer, grow: true, gap: 6, padding: 8, children: composer }],
          tooltip: "Drag the divider above the input to resize it"
        });
      }
      if (mcpOpen && conv) {
        const servers = view.mcpServers || [{ id: "internal", name: "Hato" }];
        const on = new Set(conv.mcpSelection || []);
        const applied = new Set(live?.mcp?.selection || (live?.mcp?.enabled ? ["internal"] : []));
        const pending = !background && connected && [.../* @__PURE__ */ new Set([...on, ...applied])].some((id) => on.has(id) !== applied.has(id));
        kids.push({ type: "popover", key: "mcp-picker", closeAction: "toggleMcpPicker", bottom: 56, maxHeight: 460, style: { ...chatStyle.picker, background: "background" }, children: [
          { type: "row", key: "head", gap: 8, padding: 10, align: "center", children: [
            { type: "label", key: "t", text: "Tools for this chat", weight: "semibold", grow: true },
            iconButton("close-mcp", "x", "toggleMcpPicker", "Close")
          ] },
          { type: "divider", key: "d1" },
          { type: "column", key: "body", scroll: true, gap: 10, padding: 10, children: [
            { type: "label", key: "mcp-h", text: "MCP SERVERS", size: "xs", weight: "semibold", color: "muted" },
            ...servers.map((sv) => ({ type: "row", key: "mcp-" + sv.id, gap: 8, align: "center", children: [
              { type: "column", key: "t", gap: 1, grow: true, children: [
                { type: "label", key: "n", text: sv.name, size: "sm", weight: "medium" },
                ...sv.description ? [{ type: "label", key: "d", text: sv.description, size: "xs", color: "muted", wrap: true }] : []
              ] },
              {
                type: "switch",
                key: "s",
                label: "",
                checked: on.has(sv.id),
                action: "toggleMcp:" + sv.id,
                disabled: !!background && !!active.busy,
                tooltip: background ? "Applies immediately; a connected background agent restarts with the new tools" : void 0
              }
            ] })),
            ...pending ? [{ type: "row", key: "apply", gap: 8, align: "center", style: { background: "#d8962014", radius: 8, paddingX: 8, paddingY: 6 }, children: [
              { type: "label", key: "t", text: "Reconnect to apply changes", size: "xs", grow: true },
              { type: "button", key: "b", text: "Reconnect", action: "reconnect", small: true, disabled: active.busy }
            ] }] : [],
            { type: "button", key: "manage", text: "Manage MCP servers…", iconSvg: uiIcons["sliders-horizontal"], action: "openMcps", variant: "ghost", small: true, tooltip: "Add servers, sign in to remote ones, and choose what background agents can use" },
            { type: "divider", key: "d2" },
            { type: "button", key: "skills-h", text: `${skillsOpen ? "▾" : "▸"} Insert a skill · ${skills.length}`, action: "toggleSkills", variant: "ghost", small: true, tooltip: "Reference a workspace skill from .agents/skills in your message" },
            ...skillsOpen ? [{ type: "column", key: "skills-picker", scroll: true, maxHeight: 200, gap: 2, children: skills.length ? skills.map((skill) => ({ type: "button", key: skill.path, text: skill.name + (skill.description ? " · " + skill.description : ""), tooltip: skill.path, action: "useSkill", value: skill.path, variant: "ghost", style: chatStyle.result })) : [{ type: "label", key: "none", text: skillState?.loading ? "Loading workspace skills…" : skillState?.error ? "Could not load workspace skills: " + skillState.error : "No workspace skills in .agents/skills.", size: "xs", color: "muted", wrap: true }] }] : []
          ] }
        ] });
      }
      if (modelsOpen) {
        const filtered = model.options.filter((o) => `${o.label} ${modelDetails(o.value)?.description || ""}`.toLowerCase().includes(modelQuery.toLowerCase()));
        kids.push({ type: "popover", key: "model-picker", closeAction: "toggleModels", style: { ...chatStyle.picker, background: "background" }, children: [
          { type: "row", key: "search-row", gap: 8, padding: 10, children: [
            { type: "textInput", key: "model-search", ...filterInput, value: modelQuery, placeholder: "Search models", changeAction: "searchModels", grow: true },
            iconButton("close", "x", "toggleModels", "Close models")
          ] },
          { type: "divider", key: "divider" },
          { type: "column", key: "results", scroll: true, grow: true, gap: 3, padding: 6, children: filtered.length ? filtered.map((o) => ({
            type: "choice",
            key: o.value,
            text: o.label,
            description: modelDetails(o.value)?.description,
            selected: o.value === model.value,
            action: "chooseModel",
            value: o.value
          })) : [{ type: "label", key: "none", text: "No matching models", padding: 16, color: "muted" }] },
          { type: "label", key: "model-count", text: `${filtered.length} model${filtered.length === 1 ? "" : "s"} available`, size: "xs", color: "muted", padding: 10 }
        ] });
      }
    } else if (ws && view) kids.push({ type: "column", key: "empty", padding: 24, gap: 12, grow: true, children: [
      { type: "label", key: "title", text: view.profiles.length ? "Start a conversation" : "Choose your AI provider", size: "lg", weight: "bold" },
      { type: "label", key: "hint", text: view.profiles.length ? "Ask your agent to build, explore or fix something in this workspace." : "Install Claude, Codex or another provider from Marketplace to start chatting.", wrap: true, color: "muted" },
      { type: "button", key: "start", text: view.profiles.length ? "New chat" : "Browse providers", iconSvg: uiIcons.plus, action: "newChat", style: chatStyle.primary, variant: "primary" }
    ] });
    return { type: "column", key: "ai-root", style: chatStyle.root, gap: 0, grow: true, children: kids };
  },
  async onEvent(ctx, ev) {
    if (ev.action === "newChat" && view && !view.profiles.length) {
      ctx.events.emit("settings.open", { category: "plugins" });
      return;
    }
    if (ev.action === "resizeComposer") {
      const sizes = ev.value?.sizes;
      if (!Array.isArray(sizes) || sizes.length !== 2 || sizes.some((n) => typeof n !== "number" || !Number.isFinite(n) || n <= 0)) return;
      composerFraction = clampComposerFraction(sizes[1] / (sizes[0] + sizes[1]));
      const id = ws?.id;
      if (id) {
        composerFractions.set(id, composerFraction);
        try {
          await ctx.modules.call("workspace", "view.patch", { workspaceId: id, patch: { ui: { aiComposerFraction: composerFraction } } });
        } catch (e) {
          error = "Could not save input height: " + errMsg(e);
        }
      }
      ctx.ui.invalidate();
      return;
    }
    if (ev.action === "draftChanged") {
      draft = String(ev.value || "");
      ctx.ui.invalidate();
      return;
    }
    if (ev.action === "askUpdateRuntime") {
      confirmRuntimeUpdate = true;
      ctx.ui.invalidate();
      return;
    }
    if (ev.action === "cancelUpdateRuntime") {
      confirmRuntimeUpdate = false;
      ctx.ui.invalidate();
      return;
    }
    if (ev.action === "updateRuntime" && ws) {
      if (busy) return;
      confirmRuntimeUpdate = false;
      busy = "updateRuntime";
      error = null;
      ctx.ui.invalidate();
      try {
        const r = await persistent(ctx, "updateRuntime", { workspaceId: ws.id });
        if (r?.failed?.length) error = "Runtime updated, but these agents did not reconnect: " + r.failed.map((f) => `${f.name} (${f.error})`).join(", ");
      } catch (e) {
        error = errMsg(e);
      } finally {
        busy = null;
        await loadCatalog(ctx);
        await load(ctx);
        ctx.ui.invalidate();
      }
      return;
    }
    if (ev.action === "backToChats") {
      await ctx.modules.call("workspace", "view.patch", { workspaceId: ws.id, patch: { ui: { aiBackgroundSession: null } } });
      leaveBackground(ctx);
      await load(ctx);
      return;
    }
    if (ev.action === "newChat" && ws) {
      if (busy) return;
      const workspaceId = ws.id, current = view?.active?.conversation;
      busy = "newChat";
      ctx.ui.invalidate();
      try {
        const available = await ctx.host.plugins.list();
        if (!available.plugins.some((p) => p.id === "persistent-agents" && p.active)) throw new Error("Enable Background Agents in Marketplace to start a chat that runs while Hato is closed.");
        const catalog = await persistent(ctx, "catalog");
        if (ws?.id !== workspaceId) return;
        backgroundCatalog = normalCatalog(catalog, workspaceId);
        const profileId = catalog.profiles.some((p) => p.id === current?.acpProfileId) ? current.acpProfileId : catalog.profiles[0]?.id;
        if (!profileId) throw new Error("Install and enable an AI provider for this workspace first.");
        const offered = (id) => id === "internal-remote-mcp" || list(catalog.mcps).some((m) => m.id === id);
        const shown = backgroundPage?.session, samePrevious = background && shown?.profile.id === profileId ? shown : null;
        let config;
        if (background && backgroundPage) {
          const s = backgroundPage.session;
          config = {
            model: samePrevious ? s.model : "",
            agentFile: list(catalog.agentFiles).some((f) => f.path === s.agentFile) ? s.agentFile : null,
            skills: s.skills.filter((p) => list(catalog.skills).some((k) => k.path === p)),
            mcps: sessionMcpIds(s).filter(offered),
            approvalPolicy: agentPolicy(s),
            settings: samePrevious ? agentSettings(s.settings) : {}
          };
        } else {
          const live = view?.active?.live, sameProvider = live && current?.acpProfileId === profileId;
          const model = sameProvider ? selectors(live, true).find((n) => n.key === "cfg-model")?.value || "" : "";
          const settings = {};
          if (sameProvider) {
            for (const o of live.configOptions || []) if (o.category !== "model" && o.currentValue !== void 0 && o.currentValue !== null) settings[o.id] = typeof o.currentValue === "boolean" ? o.currentValue : String(o.currentValue);
          }
          if (sameProvider && !(live.configOptions || []).some((o) => o.category === "mode") && live.modes?.currentModeId) settings.__mode = String(live.modes.currentModeId);
          const local = current?.mcpSelection || ["internal"];
          config = {
            model,
            agentFile: list(catalog.agentFiles).some((f) => f.path === "AGENTS.md") ? "AGENTS.md" : null,
            skills: [],
            mcps: ["internal-remote-mcp", ...local.map((id) => id === "internal" ? "internal-local-mcp" : id)].filter((id, i, all) => offered(id) && all.indexOf(id) === i),
            approvalPolicy: current?.approvalPolicy || "ask",
            settings
          };
        }
        const session = await persistent(ctx, "create", { profileId, name: "Chat", ...config });
        if (ws?.id === workspaceId) await openBackground(ctx, { workspaceId, id: session.id });
      } catch (e) {
        error = errMsg(e);
      } finally {
        busy = null;
        ctx.ui.invalidate();
      }
      return;
    }
    if (background && ev.action === "toggleHistory") {
      historyOpen = !historyOpen;
      if (historyOpen) try {
        backgroundSessions = await persistent(ctx, "list");
        await load(ctx);
      } catch (e) {
        error = errMsg(e);
      }
      ctx.ui.invalidate();
      return;
    }
    if (background && ev.action === "searchSessions") {
      historyQuery = String(ev.value || "");
      ctx.ui.invalidate();
      return;
    }
    if (background && ev.action === "selectConv") {
      if (backgroundSessions.some((s) => s.id === ev.value)) await openBackground(ctx, { workspaceId: ws.id, id: ev.value });
      return;
    }
    const backgroundAction = [
      "send",
      "chooseModel",
      "cancel",
      "stopBackground",
      "toggleAuto",
      "setPolicy",
      "setProfile",
      "setAgentFile",
      "reconnect",
      "connect",
      "disconnect",
      "reviewBackgroundPermission",
      "revealOlder",
      "loadOlder",
      "olderMessages",
      "revealNewer",
      "newerMessages",
      "latestMessages",
      "collapseHistory"
    ].includes(ev.action) || ev.action.startsWith("setConfig:") || ev.action.startsWith("toggleMcp:");
    if (background && backgroundAction) {
      const selection = background;
      let actionError = null;
      try {
        if (ev.action === "send") {
          const text = (ev.inputs.prompt || draft || "").trim();
          if (!text && !attachments.length || busy === "send") return;
          busy = "send";
          ctx.ui.invalidate();
          await persistent(ctx, "send", { text, steer: !!view?.active?.busy, ...attachments.length ? { images: attachments } : {} });
          if (background === selection) {
            draft = "";
            attachments = [];
            historyBefore = [];
            historyLimit = CHAT_MESSAGE_LIMIT;
          }
        } else if (ev.action === "chooseModel") {
          await persistent(ctx, "setModel", { model: ev.value });
          modelsOpen = false;
        } else if (ev.action.startsWith("setConfig:")) await persistent(ctx, "setConfig", { configId: ev.action.slice(10), value: ev.value });
        else if (ev.action === "toggleAuto" || ev.action === "setPolicy") {
          const policy = ev.action === "toggleAuto" ? ev.value ? "autopilot" : "ask" : String(ev.value || "ask");
          try {
            await persistent(ctx, "setPolicy", { policy });
          } catch (e) {
            if (policy === "auto-low") throw e;
            await persistent(ctx, "setAutopilot", { enabled: policy === "autopilot" });
          }
        } else if (ev.action === "setProfile") {
          if (ev.value !== backgroundPage?.session.profile.id) await updateBackground(ctx, { profileId: String(ev.value) });
        } else if (ev.action === "setAgentFile") await updateBackground(ctx, { agentFile: ev.value ? String(ev.value) : null });
        else if (ev.action.startsWith("toggleMcp:")) {
          const id = ev.action.slice("toggleMcp:".length), current = new Set(backgroundPage ? sessionMcpIds(backgroundPage.session) : []);
          if (ev.value) current.add(id);
          else current.delete(id);
          await updateBackground(ctx, { mcps: [...current] });
        } else if (ev.action === "disconnect") await persistent(ctx, "stop");
        else if (ev.action === "cancel") await persistent(ctx, "cancel");
        else if (ev.action === "stopBackground") await persistent(ctx, "stop");
        else if (ev.action === "reconnect" || ev.action === "connect") await persistent(ctx, "reconnect");
        else if (ev.action === "reviewBackgroundPermission") await persistent(ctx, "reviewPermission", { permissionId: ev.value });
        else if (["revealOlder", "loadOlder", "olderMessages"].includes(ev.action)) {
          if (historyLimit < 200) historyLimit = Math.min(200, historyLimit + CHAT_MESSAGE_LIMIT);
          else if (backgroundPage?.before) historyBefore.push(String(backgroundPage.before));
          preserveHistoryScroll = true;
        } else if (["revealNewer", "newerMessages"].includes(ev.action)) {
          historyBefore.pop();
          preserveHistoryScroll = true;
        } else if (["latestMessages", "collapseHistory"].includes(ev.action)) {
          historyBefore = [];
          historyLimit = CHAT_MESSAGE_LIMIT;
          preserveHistoryScroll = false;
          historyScrollReset++;
        }
        error = null;
      } catch (e) {
        actionError = errMsg(e);
      } finally {
        busy = null;
        if (background === selection) {
          await load(ctx);
          if (actionError) error = actionError;
        }
        ctx.ui.invalidate();
      }
      return;
    }
    const conv = view && view.active ? view.active.conversation : null;
    const call = (m, args, timeoutMs = 12e4) => ctx.modules.call("ai-sessions", m, args, { timeoutMs });
    try {
      if (ev.action === "openLink") {
        const path = ws && resolveWorkspaceLink(String(ev.value || ""), ws.rootAbsolutePath);
        if (!path) throw new Error(`Cannot open link outside the workspace: ${ev.value}`);
        await ctx.modules.call("workspace", "view.patch", { workspaceId: ws.id, patch: { previewPath: path } });
        return;
      }
      if (ev.action === "toggleModels") {
        modelsOpen = !modelsOpen;
        modelQuery = "";
        ctx.ui.invalidate();
        return;
      }
      if (ev.action === "searchModels") {
        modelQuery = String(ev.value || "");
        ctx.ui.invalidate();
        return;
      }
      if (ev.action === "searchSessions") {
        historyQuery = String(ev.value || "");
        ctx.ui.invalidate();
        return;
      }
      if (ev.action === "toggleHistory") {
        historyOpen = !historyOpen;
        historyQuery = "";
        ctx.ui.invalidate();
        return;
      }
      if (ev.action === "openMcps") {
        mcpOpen = false;
        ctx.events.emit("ai.openMcps", {});
        ctx.ui.invalidate();
        return;
      }
      if (ev.action === "toggleSkills") {
        skillsOpen = !skillsOpen;
        if (skillsOpen) ctx.events.emit("ai.skillsRequested", {});
        ctx.ui.invalidate();
        return;
      }
      if (ev.action === "useSkill") {
        const skill = workspaceSkillState?.workspaceId === ws?.id && workspaceSkillState.skills?.find((s) => s.path === ev.value);
        if (!skill) return;
        draft = `Use the workspace skill at ${skill.path}.
` + (ev.inputs.prompt || draft || "");
        skillsOpen = false;
        mcpOpen = false;
        ctx.ui.invalidate();
        return;
      }
      if (ev.action === "chooseModel" && conv) {
        const model = selectors(view.active.live, true).find((n) => n.key === "cfg-model");
        await call("setConfig", { conversationId: conv.id, configId: model.action.slice(10), value: ev.value });
        modelsOpen = false;
        return;
      }
      if (ev.action === "attachImages") {
        const result = ev.value;
        if (result?.error) throw new Error(result.error);
        attachments = imageAttachments([...attachments, ...imageAttachments(result)]);
        ctx.ui.invalidate();
        return;
      }
      if (ev.action === "removeImage") {
        attachments.splice(Number(ev.value), 1);
        ctx.ui.invalidate();
        return;
      }
      if (ev.action === "toggleMcpPicker") {
        mcpOpen = !mcpOpen;
        if (mcpOpen) ctx.events.emit("ai.skillsRequested", {});
        ctx.ui.invalidate();
        return;
      }
      if (ev.action === "toggleSettings") {
        settingsOpen = !settingsOpen;
        ctx.ui.invalidate();
        return;
      }
      if (ev.action === "openAdapters" && ws) {
        adaptersOpen = true;
        adaptersMsg = null;
        await loadAdapters(ctx);
        return;
      }
      if (ev.action === "closeAdapters") {
        adaptersOpen = false;
        return;
      }
      if (ev.action === "checkAdapters") {
        adaptersMsg = null;
        await loadAdapters(ctx);
        return;
      }
      if (ev.action === "installAdapter" && ws) {
        adaptersBusy = String(ev.value);
        adaptersMsg = null;
        ctx.ui.invalidate();
        try {
          const r = await call("installAdapter", { workspaceId: ws.id, adapterId: ev.value }, 17 * 60 * 1e3);
          adaptersMsg = { level: "success", text: `✓ ${r.adapterId} installed/updated on ${r.machineId}` };
        } catch (e) {
          adaptersMsg = { level: "error", text: errMsg(e) };
        }
        adaptersBusy = null;
        await loadAdapters(ctx);
        return;
      }
      if (ev.action === "toggleProviderAuth") {
        const p = view?.profiles.find((p2) => p2.id === view?.active?.conversation?.acpProfileId);
        if (p?.authOption) await ctx.modules.call("acp", "setAuthSettings", { [p.authOption.field]: !!ev.value });
        return;
      }
      if (ev.action === "newChat" && ws) {
        await call("create", { workspaceId: ws.id, profileId: conv?.acpProfileId });
        historyOpen = false;
        settingsOpen = false;
        modelsOpen = false;
      } else if (ev.action === "selectConv" && ws) {
        await call("select", { workspaceId: ws.id, conversationId: ev.value });
        historyOpen = false;
        settingsOpen = false;
        modelsOpen = false;
      } else if (!conv) return;
      else if (ev.action === "olderMessages" || ev.action === "loadOlder" || ev.action === "revealOlder") {
        if (pagingHistory) return;
        const history = visibleHistory(view.active);
        if (!history.hasOlder || !history.messages.length) return;
        const first = history.messages[0].key, conversationId = conv.id;
        pagingHistory = true;
        ctx.ui.invalidate();
        try {
          if (!history.hasLoadedOlder) {
            const result = await call("loadOlder", { conversationId });
            if (result?.loaded === 0) return;
          }
          if (historyConversationId === conversationId) {
            preserveHistoryScroll = true;
            if (ev.action === "revealOlder" && historyLimit < CHAT_HISTORY_LIMIT) historyLimit = Math.min(CHAT_HISTORY_LIMIT, historyLimit + CHAT_MESSAGE_LIMIT);
            else historyBefore.push(ev.action === "revealOlder" ? history.messages[Math.max(0, history.messages.length - CHAT_MESSAGE_LIMIT)].key : first);
          }
        } finally {
          pagingHistory = false;
        }
      } else if (ev.action === "newerMessages" || ev.action === "revealNewer") {
        historyBefore.pop();
        preserveHistoryScroll = true;
      } else if (ev.action === "latestMessages" || ev.action === "collapseHistory") {
        historyBefore = [];
        historyLimit = CHAT_MESSAGE_LIMIT;
        preserveHistoryScroll = false;
        historyScrollReset++;
      } else if (ev.action === "connect") {
        busy = "connect";
        ctx.ui.invalidate();
        await call("connect", { conversationId: conv.id }, 6e5);
      } else if (ev.action === "reconnect") {
        await call("disconnect", { conversationId: conv.id });
        await call("connect", { conversationId: conv.id }, 6e5);
      } else if (ev.action === "disconnect") await call("disconnect", { conversationId: conv.id });
      else if (ev.action === "setProfile") {
        await call("setProfile", { conversationId: conv.id, profileId: ev.value });
        connectionAttempts.delete(conv.id);
      } else if (ev.action === "toggleAuto") await call("setPolicy", { conversationId: conv.id, policy: ev.value ? "autopilot" : "ask" });
      else if (ev.action === "setPolicy") await call("setPolicy", { conversationId: conv.id, policy: ev.value });
      else if (ev.action.startsWith("toggleMcp:")) await call("setMcp", { conversationId: conv.id, serverId: ev.action.slice("toggleMcp:".length), enabled: !!ev.value });
      else if (ev.action.startsWith("setConfig:")) await call("setConfig", { conversationId: conv.id, configId: ev.action.slice(10), value: ev.value });
      else if (ev.action === "cancel") await call("cancel", { conversationId: conv.id });
      else if (ev.action === "send") {
        historyBefore = [];
        historyLimit = CHAT_MESSAGE_LIMIT;
        preserveHistoryScroll = false;
        historyScrollReset++;
        const text = (ev.inputs.prompt || "").trim();
        if (!text && !attachments.length) return;
        if (busy === "send") return;
        busy = "send";
        ctx.ui.invalidate();
        await call("send", { conversationId: conv.id, text, images: attachments }, 6e5);
        attachments = [];
        draft = draft === "" ? " " : "";
        ctx.ui.invalidate();
      }
      error = null;
    } catch (e) {
      error = errMsg(e);
    } finally {
      if (!["loadOlder", "olderMessages", "newerMessages", "latestMessages", "revealOlder", "revealNewer", "collapseHistory"].includes(ev.action)) busy = null;
      await load(ctx);
    }
  }
};
var index_default = mod;
export {
  index_default as default
};
