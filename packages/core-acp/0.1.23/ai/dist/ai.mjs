// ../sdk/acp-protocol.ts
function sessionPage(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.sessions)) throw new Error("Invalid session/list response");
  const seen = /* @__PURE__ */ new Set();
  const sessions = value.sessions.filter((s) => s && typeof s.sessionId === "string" && s.sessionId.length > 0 && s.sessionId.length <= 4096 && !seen.has(s.sessionId) && (seen.add(s.sessionId), true)).slice(0, 500).map((s) => ({ sessionId: s.sessionId, ...typeof s.title === "string" ? { title: s.title.slice(0, 4096) } : {}, ...typeof s.cwd === "string" ? { cwd: s.cwd.slice(0, 4096) } : {}, ...typeof s.updatedAt === "string" ? { updatedAt: s.updatedAt.slice(0, 128) } : {} }));
  return { sessions, nextCursor: typeof value.nextCursor === "string" && value.nextCursor.length > 0 && value.nextCursor.length <= 16384 ? value.nextCursor : null };
}

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
  if (!value || typeof value.used !== "number" || !Number.isFinite(value.used) || value.used < 0 || typeof value.size !== "number" || !Number.isFinite(value.size) || value.size < 0) return null;
  const cost = value.cost && typeof value.cost === "object" && !Array.isArray(value.cost) && typeof value.cost.amount === "number" && Number.isFinite(value.cost.amount) && value.cost.amount >= 0 && typeof value.cost.currency === "string" && value.cost.currency.trim() ? { amount: value.cost.amount, currency: value.cost.currency } : void 0;
  return { used: value.used, size: value.size, ...cost ? { cost } : {} };
}
function contextUsage(value) {
  const usage = reportedUsage(value);
  if (!usage || usage.size === 0) return { value: null, tooltip: "Context usage unavailable — the agent has not reported a context capacity." };
  const fraction = usage.used / usage.size;
  const tokens = `${String(usage.used).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} / ${String(usage.size).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} tokens`;
  const amount = usage.cost ? usage.cost.amount.toFixed(4).replace(/\.?0+$/, "") : null;
  return { value: Math.min(1, fraction), tooltip: `${Math.round(fraction * 100)}% context used · ${tokens}${amount ? ` · ${amount} ${usage.cost.currency}` : ""}` };
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
  // The hosting panel supplies the frame; a second border/radius here drew a card inside a card.
  root: { position: "relative", background: "surface", color: "text", fontSize: 14, font: "ui" },
  toolbar: { background: "field", borderBottom: 1, borderColor: "border", wrap: true },
  // The split divider above already draws the separating line.
  composer: { background: "surface" },
  settings: { background: "surface", color: "text" },
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

// ../sdk/persistent-agents.ts
var MARKER = /<!--\s*hato-progress\s+(\d{1,3}(?:\.\d+)?)\s*%?\s*(?:\|\s*([^>]*?))?\s*-->/gi;
function stripProgressMarkers(text) {
  if (!text || !text.includes("<!--")) return text;
  let out = text.replace(new RegExp(`^[ \\t]*(?:${MARKER.source})[ \\t]*(?:\\r?\\n|$)`, "gim"), "").replace(MARKER, "");
  const open = out.lastIndexOf("<!--");
  if (open >= 0 && !out.includes("-->", open)) {
    const head = out.slice(open + 4).replace(/^\s+/, "").toLowerCase();
    const word = head.split(/[\s|]/)[0];
    if ("hato-progress".startsWith(word) || /^hato-progress\b/.test(head)) out = out.slice(0, open);
  }
  return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
function modelChoices(state) {
  const option = state.configOptions?.find((o) => o.category === "model");
  if (option) {
    const flatten = (options) => options.flatMap((o) => Array.isArray(o.options) ? flatten(o.options) : [o]);
    return flatten(option.options || []).map((o) => ({ id: String(o.value), label: o.name || String(o.value), configId: option.id }));
  }
  return (state.models?.availableModels || []).map((m) => ({ id: m.modelId, label: m.name || m.modelId, configId: "__model" }));
}
var agentPolicy = (s) => s.autopilot ? "autopilot" : s.approvalPolicy === "auto-low" ? "auto-low" : "ask";
function agentSettings(value) {
  const out = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [k, v] of Object.entries(value).slice(0, 32))
    if (k && k.length <= 200 && (typeof v === "boolean" || typeof v === "string" && v.length <= 500)) out[k] = v;
  return out;
}
function providerLabel(profile) {
  const name = String(profile?.name || profile?.provider || "Agent").replace(/\s*\([^)]*\)\s*$/, "").trim();
  return name || "Agent";
}

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
var isProgressReport = (m) => m.role === "tool" && /report[_.\s-]?progress/i.test(m.title || "");
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
  for (const raw of messages) {
    if (raw.role === "system" && /^Permission for "/.test(raw.text || "") || isProgressReport(raw)) continue;
    const m = raw.role === "assistant" && raw.text?.includes("<!--") ? { ...raw, text: stripProgressMarkers(raw.text) } : raw;
    if (m !== raw && !m.text && !m.images?.length) continue;
    items.push(messageNode(m, opts));
  }
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

// ../sdk/library.ts
var LIBRARY_STATE = "library.catalog";
var LIBRARY_PREFIX = "library:";
var libraryRef = (id) => LIBRARY_PREFIX + id;
var isLibraryRef = (path) => typeof path === "string" && path.startsWith(LIBRARY_PREFIX);
var libraryRefId = (path) => path.slice(LIBRARY_PREFIX.length);
function libraryCatalog(value) {
  const v = value;
  return { items: Array.isArray(v?.items) ? v.items : [], machines: Array.isArray(v?.machines) ? v.machines : [] };
}
function libraryOffered(item, ws2) {
  if (item.projectId) return item.projectId === ws2.projectId;
  return !item.machines?.length || item.machines.includes(ws2.machineId);
}
function libraryItemsFor(value, ws2, kind) {
  if (!ws2) return [];
  return libraryCatalog(value).items.filter((i) => i.kind === kind && libraryOffered(i, ws2)).sort((a, b) => Number(!a.projectId) - Number(!b.projectId) || a.name.localeCompare(b.name));
}
function libraryInstructions(item) {
  const scope = item.projectId ? "project" : "global";
  const extra = item.paths.filter((p) => p !== "SKILL.md" && p !== "AGENT.md");
  return item.text + (extra.length ? `

(Library ${item.kind} "${item.name}" also has these files: ${extra.join(", ")}. Read them with the Library read tool, scope "${scope}", id "${item.id}", when needed.)` : "");
}

// ../sdk/settings-order.ts
var SPACER_PREFIX = "@spacer:";
function parseOrder(value, allowed, allowSpacers = false) {
  if (typeof value !== "string") throw new Error("Invalid item order");
  const items = JSON.parse(value);
  if (!Array.isArray(items) || items.length > allowed.length + 24) throw new Error("Invalid item order");
  const seen = /* @__PURE__ */ new Set();
  let gaps = 0;
  for (const item of items) {
    if (typeof item !== "string" || seen.has(item)) throw new Error("Duplicate or invalid item");
    seen.add(item);
    if (!allowed.includes(item) && !(allowSpacers && item.startsWith(SPACER_PREFIX) && /^@spacer:[a-zA-Z0-9_-]{1,80}$/.test(item) && ++gaps <= 24)) throw new Error("Unknown item");
  }
  if (!allowed.every((id) => seen.has(id))) throw new Error("Order must retain all current items");
  return items;
}

// ../sdk/ui-controls.ts
var HEX = /^#[0-9a-fA-F]{6}$/;
function validControlValue(field, value) {
  if (typeof value !== "string") return false;
  if (value === "") return !!field.allowDefault;
  if (field.type === "color") return HEX.test(value);
  const n = Number(value);
  return Number.isFinite(n) && n >= field.min && n <= field.max;
}

// ../sdk/settings.ts
function exportSettings(ctx, getSections, onChange, options = {}) {
  const publish = (error2 = null) => {
    const value = { sections: getSections(), error: error2, ...options.reset ? { resetLabel: options.reset.label } : {} };
    ctx.state.set(`${ctx.moduleId}.settings`, value);
  };
  let queue = Promise.resolve();
  ctx.events.on("settings.change", (edit) => {
    if (edit?.module !== ctx.moduleId) return;
    queue = queue.then(async () => {
      try {
        const section = getSections().find((s) => s.key === edit.section);
        const field = section?.fields.find((f) => f.key === edit.key);
        if (!field || field.type === "action") throw new Error("Setting is no longer available");
        if (field.type === "order") parseOrder(edit.value, field.items.map((i) => i.id), field.allowSpacers);
        else if (field.type === "color" || field.type === "range") {
          if (!validControlValue(field, edit.value)) throw new Error(field.type === "color" ? "Enter a color as #RRGGBB" : `Choose a value from ${field.min} to ${field.max}`);
        } else if (field.type === "toggle" ? typeof edit.value !== "boolean" : typeof edit.value !== "string" || field.type === "select" && !field.options.some((o) => o.value === edit.value)) {
          throw new Error("Invalid setting value");
        }
        await onChange(section.key, field.key, edit.value);
        publish();
      } catch (e) {
        publish(e instanceof Error ? e.message : String(e));
      }
      if (options.invalidate !== false) ctx.ui.invalidate();
    });
  });
  if (options.action) ctx.events.on("settings.action", (event) => {
    if (event?.module !== ctx.moduleId) return;
    const run = async () => {
      try {
        const section = getSections().find((s) => s.key === event.section);
        const field = section?.fields.find((f) => f.key === event.key);
        if (!field || field.type !== "action" || field.disabled) throw new Error("Action is not available");
        await options.action(section.key, field.key);
        publish();
      } catch (error2) {
        publish(error2 instanceof Error ? error2.message : String(error2));
      }
      if (options.invalidate !== false) ctx.ui.invalidate();
    };
    void run();
  });
  if (options.reset) ctx.events.on("settings.reset", (event) => {
    if (event?.module !== ctx.moduleId || !options.reset) return;
    queue = queue.then(async () => {
      try {
        await options.reset.run();
        publish();
      } catch (e) {
        publish(e instanceof Error ? e.message : String(e));
      }
      if (options.invalidate !== false) ctx.ui.invalidate();
    });
  });
  publish();
  return publish;
}

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

// modules/ui/ai/src/commands.ts
function slashCommandQuery(draft2) {
  const match = /^\/([^\s/]*)$/.exec(draft2 || "");
  return match ? match[1].toLowerCase() : null;
}
function matchingCommands(commands, draft2, limit = 8) {
  const query = slashCommandQuery(draft2);
  if (query === null || !Array.isArray(commands)) return [];
  return commands.slice(0, 500).filter((command) => !!command && typeof command === "object" && typeof command.name === "string" && /^[^\s/]+$/.test(command.name) && command.name.toLowerCase().startsWith(query)).slice(0, Math.max(1, Math.min(limit, 50)));
}
function applySlashCommand(draft2, command) {
  const query = slashCommandQuery(draft2);
  if (query === null || !/^[^\s/]+$/.test(command.name)) return draft2;
  return `/${command.name} `;
}

// modules/ui/ai/src/elicitation.ts
var primitive = (value) => typeof value === "string" || typeof value === "number" || typeof value === "boolean" || Array.isArray(value) && value.every((item) => typeof item === "string");
var unsafeKey = (key) => key === "__proto__" || key === "prototype" || key === "constructor";
var propertyObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
var fieldTypes = /* @__PURE__ */ new Set(["string", "boolean", "number", "integer", "array"]);
function safePattern(pattern) {
  const unsupported = () => {
    throw new Error("pattern is outside the supported safe subset");
  };
  if (pattern.length > 200) unsupported();
  let inClass = false, quantifiers = 0;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\") {
      const escaped = pattern[++i];
      if (!escaped || !"dDsSwW.^$[]{}()+*?\\-".includes(escaped)) unsupported();
      continue;
    }
    if (c === "[") {
      if (!inClass) inClass = true;
      continue;
    }
    if (c === "]" && inClass) {
      inClass = false;
      continue;
    }
    if (inClass) continue;
    if ("()|".includes(c)) unsupported();
    if ("*+?".includes(c)) quantifiers++;
    if (c === "{") {
      const bounded = /^\{(\d+)(?:,(\d+))?\}/.exec(pattern.slice(i));
      if (!bounded || Number(bounded[1]) > 256 || Number(bounded[2] || bounded[1]) > 256) unsupported();
      i += bounded[0].length - 1;
      quantifiers++;
    }
  }
  if (inClass || quantifiers > 1 || quantifiers && (!pattern.startsWith("^") || !pattern.endsWith("$"))) unsupported();
  return new RegExp(pattern);
}
function enumValues(property) {
  if (Array.isArray(property.enum)) return property.enum;
  if (Array.isArray(property.oneOf)) return property.oneOf.map((option) => option?.const ?? option?.value);
  return null;
}
function enumChoices(property) {
  if (!propertyObject(property)) return [];
  if (Array.isArray(property.enum)) return property.enum.filter((value) => typeof value === "string").slice(0, 200).map((value) => ({ value, label: value }));
  if (Array.isArray(property.oneOf)) return property.oneOf.flatMap((option) => {
    const value = option?.const ?? option?.value;
    return typeof value === "string" ? [{ value, label: String(option?.title || option?.label || value) }] : [];
  }).slice(0, 200);
  return [];
}
function normalizeElicitationSchema(value) {
  const empty = { type: "object", properties: {}, required: [] };
  if (!propertyObject(value)) return { schema: empty, error: "The agent did not provide a flat object schema." };
  if (value.type !== void 0 && value.type !== "object") return { schema: empty, error: "The elicitation schema must be an object." };
  if (value.properties !== void 0 && !propertyObject(value.properties)) return { schema: empty, error: "Schema properties must be an object." };
  if (value.required !== void 0 && (!Array.isArray(value.required) || value.required.some((name) => typeof name !== "string"))) return { schema: empty, error: "Schema required must be an array of field names." };
  const entries = Object.entries(value.properties || {});
  if (entries.length > 64) return { schema: empty, error: "The form has too many fields." };
  const properties = {};
  let error2 = null;
  for (const [key, raw] of entries) {
    if (unsafeKey(key)) {
      error2 = `Unsafe field name '${key}' is not supported.`;
      continue;
    }
    if (!propertyObject(raw)) {
      properties[key] = { type: "unsupported" };
      error2 || (error2 = `Field '${key}' has an invalid schema.`);
      continue;
    }
    const property = { ...raw };
    if (property.type !== void 0 && !fieldTypes.has(property.type)) error2 || (error2 = `Field '${key}' uses unsupported schema type '${String(property.type)}'.`);
    if (property.pattern !== void 0) {
      if (typeof property.pattern !== "string") error2 || (error2 = `Field '${key}' has an invalid pattern.`);
      else try {
        safePattern(property.pattern);
      } catch (e) {
        error2 || (error2 = `Field '${key}': ${e.message}`);
      }
    }
    if (typeof property.default === "string" && property.default.length > 16384) error2 || (error2 = `Field '${key}' has an oversized default.`);
    if (property.type === "array" && property.items !== void 0 && !propertyObject(property.items)) error2 || (error2 = `Field '${key}' has invalid multi-select items.`);
    properties[key] = property;
  }
  const required = value.required || [];
  for (const name of required) if (!(name in properties)) error2 || (error2 = `Required field '${name}' is missing from the schema.`);
  return { schema: { type: "object", title: typeof value.title === "string" ? value.title : void 0, description: typeof value.description === "string" ? value.description : void 0, properties, required }, error: error2 };
}
function initialElicitationValues(schema) {
  const values = {};
  for (const [key, property] of Object.entries(schema?.properties || {}).slice(0, 64)) {
    if (unsafeKey(key) || !propertyObject(property)) continue;
    if (primitive(property.default)) values[key] = property.default;
    else if (property.type === "boolean") values[key] = false;
    else if (property.type === "array") values[key] = [];
    else values[key] = "";
  }
  return values;
}
function validateElicitation(value, values) {
  const normalized = normalizeElicitationSchema(value);
  if (normalized.error) return { content: {}, errors: { _schema: normalized.error } };
  const schema = normalized.schema, errors = {}, content = {};
  const required = new Set(schema.required || []);
  for (const [key, property] of Object.entries(schema.properties || {})) {
    const raw = values[key], label = property.title || key, missing = raw === void 0 || raw === "";
    if (required.has(key) && missing) {
      errors[key] = `${label} is required.`;
      continue;
    }
    if (missing && !required.has(key)) continue;
    const allowed = enumValues(property);
    if (property.type === "string") {
      if (typeof raw !== "string") {
        errors[key] = `${label} must be text.`;
        continue;
      }
      if (raw.length > 16384) errors[key] = `${label} is too long.`;
      else if (allowed && !allowed.includes(raw)) errors[key] = `${label} must be one of its declared values.`;
      else if (typeof property.minLength === "number" && raw.length < property.minLength) errors[key] = `${label} must contain at least ${property.minLength} characters.`;
      else if (typeof property.maxLength === "number" && raw.length > property.maxLength) errors[key] = `${label} must contain at most ${property.maxLength} characters.`;
      else if (property.pattern !== void 0) {
        try {
          if (!safePattern(property.pattern).test(raw)) errors[key] = `${label} has an invalid format.`;
        } catch (e) {
          errors[key] = `${label} uses an unsupported pattern: ${e.message}`;
        }
      }
      if (!errors[key]) content[key] = raw;
    } else if (property.type === "boolean") {
      if (typeof raw !== "boolean") errors[key] = `${label} must be true or false.`;
      else if (allowed && !allowed.includes(raw)) errors[key] = `${label} must be one of its declared values.`;
      else content[key] = raw;
    } else if (property.type === "number" || property.type === "integer") {
      const number = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
      if (!Number.isFinite(number)) errors[key] = `${label} must be a number.`;
      else if (property.type === "integer" && !Number.isInteger(number)) errors[key] = `${label} must be a whole number.`;
      else if (allowed && !allowed.includes(number)) errors[key] = `${label} must be one of its declared values.`;
      else if (typeof property.minimum === "number" && number < property.minimum) errors[key] = `${label} must be at least ${property.minimum}.`;
      else if (typeof property.maximum === "number" && number > property.maximum) errors[key] = `${label} must be at most ${property.maximum}.`;
      else content[key] = number;
    } else if (property.type === "array") {
      if (!Array.isArray(raw) || !raw.every((item) => typeof item === "string")) {
        errors[key] = `${label} must be a list of text choices.`;
        continue;
      }
      const choices = enumValues(propertyObject(property.items) ? property.items : {});
      if (!choices) errors[key] = `${label} does not declare supported choices.`;
      else if (raw.some((item) => !choices.includes(item))) errors[key] = `${label} contains an unsupported choice.`;
      else if (typeof property.minItems === "number" && raw.length < property.minItems) errors[key] = `${label} requires at least ${property.minItems} selections.`;
      else if (typeof property.maxItems === "number" && raw.length > property.maxItems) errors[key] = `${label} allows at most ${property.maxItems} selections.`;
      else if (raw.length || required.has(key) || primitive(property.default)) content[key] = [...raw];
    } else errors[key] = `${label} uses unsupported schema type '${String(property.type || "unknown")}'.`;
  }
  return { content, errors };
}

// ../sdk/motion.ts
var motionDuration = { fast: 120, base: 180, slow: 240 };
var motionEasing = {
  enter: [0.2, 0, 0, 1],
  exit: [0.4, 0, 1, 1]
};
var motionExitRatio = 0.7;
var interactionMotion = {
  durationMs: motionDuration.fast,
  easing: motionEasing.enter
};
var anchoredMotion = {
  enter: { durationMs: motionDuration.base, easing: motionEasing.enter, opacity: 0, offsetPx: [0, -4] },
  exit: { durationMs: Math.round(motionDuration.base * motionExitRatio), easing: motionEasing.exit, opacity: 0, offsetPx: [0, -4] }
};
var anchoredAboveMotion = {
  enter: { ...anchoredMotion.enter, offsetPx: [0, 4] },
  exit: { ...anchoredMotion.exit, offsetPx: [0, 4] }
};
var tooltipMotion = {
  ...anchoredMotion,
  enter: { ...anchoredMotion.enter, offsetPx: [0, 4] },
  exit: { ...anchoredMotion.exit, offsetPx: [0, 4] }
};
var toastMotion = {
  enter: { durationMs: motionDuration.base, easing: motionEasing.enter, opacity: 0, offsetPx: [0, 8] },
  exit: { durationMs: Math.round(motionDuration.base * motionExitRatio), easing: motionEasing.exit, opacity: 0 }
};
var dockRevealMotion = {
  enter: { durationMs: 260, easing: motionEasing.enter, opacity: 0 },
  exit: { durationMs: 210, easing: [0.4, 0, 0.2, 1], opacity: 0 }
};

// modules/ui/ai/src/index.ts
var background = null;
var backgroundPage = null;
var backgroundTimer = null;
var backgroundSignature = "";
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
  deleteChat = null;
  error = null;
  authPickerOpen = false;
  providerSessionsOpen = false;
  providerSessionDelete = null;
  invalidateProviderSessions();
  slashDismissed = false;
  activeElicitation = null;
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
  backgroundSignature = "";
  draft = backgroundDrafts.get(selection.id) || "";
  attachments = [];
  resetChatWindows();
  publishSession(ctx);
  if (backgroundTimer) clearInterval(backgroundTimer);
  backgroundTimer = setInterval(() => {
    void load(ctx, true);
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
var loadGeneration = 0;
var pendingLoads = 0;
var pendingEvents = 0;
var origin = crypto.randomUUID();
var originSignature = "";
function syncOrigin() {
  const next = JSON.stringify([ws?.id, background?.id, view?.active?.conversation?.id, view?.active?.live?.sessionId, view?.active?.live?.startedAt, authConsole?.uiKey]);
  if (next !== originSignature) {
    const oldConversation = originSignature ? JSON.parse(originSignature)[2] : null;
    originSignature = next;
    origin = crypto.randomUUID();
    if (oldConversation !== view?.active?.conversation?.id) {
      authConsole = null;
      authPickerOpen = false;
      providerSessionsOpen = false;
      providerSessionDelete = null;
      invalidateProviderSessions();
      providerSessions = [];
      providerSessionsCursor = null;
    }
  }
}
var liveInputKeys = /* @__PURE__ */ new Set();
function scopeTree(node, inputs = /* @__PURE__ */ new Set(), root = true) {
  const n = node;
  if (n.type === "textInput") {
    if (typeof n.key === "string") inputs.add(n.key);
  } else for (const key of Object.keys(n)) {
    if ((key === "action" || key.endsWith("Action")) && typeof n[key] === "string" && n[key]) n[key] = `origin:${origin}:${n[key].replace(/^origin:[^:]+:/, "")}`;
  }
  for (const child of n.children || []) scopeTree(child, inputs, false);
  if (root) liveInputKeys = inputs;
  return node;
}
var error = null;
var busy = null;
var busyOwner = null;
var settingsOpen = false;
var mcpOpen = false;
var modelsOpen = false;
var historyOpen = false;
var historyQuery = "";
var deleteChat = null;
var chatWorking = (status) => ["busy", "waiting", "starting", "connecting"].includes(status);
var historyConversationId = null;
var historyBefore = [];
var pagingHistory = false;
var historyLimit = CHAT_MESSAGE_LIMIT;
var preserveHistoryScroll = false;
var historyScrollReset = 0;
var skillsOpen = false;
var modelQuery = "";
var workspaceSkillState = null;
var libraryState = null;
var attachments = [];
var connectionAttempts = /* @__PURE__ */ new Set();
var draft = void 0;
var slashDismissed = false;
var refresh = () => {
};
var ADAPTERS_SECTION = "acp-adapters";
var adapters = null;
var adaptersBusy = null;
var adaptersMsg = null;
var publishSettings = () => {
};
var authPickerOpen = false;
var authConsole = null;
var refreshAuth = () => {
};
var providerSessionsOpen = false;
var providerSessions = [];
var providerSessionsCursor = null;
var providerSessionsLoading = false;
var providerSessionsConversation = null;
var providerSessionsEpoch = 0;
var providerCursors = /* @__PURE__ */ new Set();
var providerSessionsQuery = "";
var providerSessionAction = null;
var providerSessionDelete = null;
var elicitationKey = (conversationId, requestId) => `${conversationId}\0${String(requestId)}`;
var pendingElicitations = /* @__PURE__ */ new Map();
var pendingByUiKey = (uiKey) => [...pendingElicitations.values()].find((item) => item.uiKey === uiKey);
var activeElicitation = null;
var terminalMethod = (method) => method?.type === "terminal" || !!method?._meta?.["terminal-auth"];
var authOutputText = (text) => text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").slice(-32e3);
async function loadProviderSessions(ctx, conversationId, append = false) {
  if (!conversationId || providerSessionsLoading) return;
  const epoch = ++providerSessionsEpoch;
  providerSessionsConversation = conversationId;
  providerSessionsLoading = true;
  providerSessionAction = "list";
  ctx.ui.invalidate();
  try {
    const page = await ctx.modules.call("ai-sessions", "providerSessions", { conversationId, ...append && providerSessionsCursor ? { cursor: providerSessionsCursor } : {} }, { timeoutMs: 9e4 });
    if (epoch !== providerSessionsEpoch || !providerSessionsOpen || providerSessionsConversation !== conversationId) return;
    const normalized = sessionPage(page);
    const incoming = normalized.sessions;
    const seen = new Set(providerSessions.map((s) => s.sessionId));
    providerSessions = append ? [...providerSessions, ...incoming.filter((s) => !seen.has(s.sessionId))] : incoming;
    const cursor = normalized.nextCursor;
    if (!append) providerCursors.clear();
    const progress = incoming.some((s) => !seen.has(s.sessionId));
    providerSessionsCursor = cursor && !providerCursors.has(cursor) && (!append || progress) && providerSessions.length < 1e4 ? cursor : null;
    if (cursor) providerCursors.add(cursor);
  } finally {
    if (epoch === providerSessionsEpoch) {
      providerSessionsLoading = false;
      providerSessionAction = null;
      ctx.ui.invalidate();
    }
  }
}
function invalidateProviderSessions() {
  providerSessionsEpoch++;
  providerSessionsLoading = false;
  providerSessionAction = null;
  providerSessionsConversation = null;
}
async function answerElicitation(ctx, pending, response) {
  pending.submitting = true;
  ctx.ui.invalidate();
  try {
    await ctx.modules.call("ai-sessions", "respondElicitation", { conversationId: pending.conversationId, requestId: pending.requestId, response });
    const key = elicitationKey(pending.conversationId, pending.requestId);
    pendingElicitations.delete(key);
    if (activeElicitation === key) {
      const next = [...pendingElicitations.values()].reverse().find((item) => item.conversationId === pending.conversationId);
      activeElicitation = next ? elicitationKey(next.conversationId, next.requestId) : null;
    }
  } finally {
    pending.submitting = false;
    ctx.ui.invalidate();
  }
}
async function loadAdapters(ctx) {
  if (!ws || adaptersBusy) return;
  const machineId = ws.machineId;
  adaptersBusy = "check";
  publishSettings();
  try {
    const list2 = await ctx.modules.call("ai-sessions", "adapters", { workspaceId: ws.id }, { timeoutMs: 3e5 });
    adapters = { machineId, list: Array.isArray(list2) ? list2 : [] };
  } finally {
    adaptersBusy = null;
    publishSettings();
  }
}
function adapterSections() {
  const busy2 = !!adaptersBusy;
  const list2 = adapters && adapters.machineId === ws?.machineId ? adapters.list : null;
  const fields = (list2 || []).map((a) => {
    const upToDate = a.installed && a.latest && a.installed === a.latest;
    const status = a.error ? a.error : !a.installed ? `not installed · latest ${a.latest || "?"}` : `installed ${a.installed}${a.latest ? upToDate ? " · up to date" : ` · update available: ${a.latest}` : ""}`;
    return {
      key: "install:" + a.id,
      type: "action",
      label: a.name,
      description: `${a.pkg}${a.path ? " → " + a.path : ""} · ${status}`,
      buttonLabel: adaptersBusy === a.id ? "Installing…" : !a.installed ? "Install" : upToDate ? "Reinstall" : "Update",
      disabled: busy2
    };
  });
  fields.push({
    key: "check",
    type: "action",
    label: list2 ? "Versions" : "Adapters",
    disabled: busy2 || !ws,
    description: adaptersBusy === "check" ? "Checking installed and latest versions…" : list2 ? "Check the installed and latest npm versions again." : ws ? "Check which adapters are installed on this machine." : "Select a project to manage the adapters on its machine.",
    buttonLabel: adaptersBusy === "check" ? "Checking…" : "Check versions"
  });
  return [{
    key: ADAPTERS_SECTION,
    title: "ACP adapters",
    group: "AI & tools",
    fields,
    description: `Agents run on the workspace's machine${ws ? ` (${ws.machineId})` : ""}. Install or update an adapter there with npm (you will be asked to confirm), then authenticate it (e.g. \`claude\` login or \`codex login\`).` + (adaptersBusy && adaptersBusy !== "check" ? ` Installing ${adaptersBusy}… (npm install -g)` : adaptersMsg ? " " + adaptersMsg : "")
  }];
}
async function adapterAction(ctx, key) {
  if (!ws) throw new Error("Select a project first");
  adaptersMsg = null;
  if (key === "check") return loadAdapters(ctx);
  if (!key.startsWith("install:") || adaptersBusy) return;
  const adapterId = key.slice(8);
  adaptersBusy = adapterId;
  publishSettings();
  try {
    const r = await ctx.modules.call("ai-sessions", "installAdapter", { workspaceId: ws.id, adapterId }, { timeoutMs: 17 * 60 * 1e3 });
    adaptersMsg = `✓ ${r.adapterId} installed/updated on ${r.machineId}${r.prefix ? ` in ${r.prefix}` : ""}.${r.note ? " ⚠ " + r.note : ""}`;
  } finally {
    adaptersBusy = null;
  }
  await loadAdapters(ctx);
}
var chatSignature = "";
async function load(ctx, poll = false, fromEvent = false) {
  const generation = ++loadGeneration;
  pendingLoads++;
  try {
    await loadCurrent(ctx, poll, generation, fromEvent);
  } finally {
    pendingLoads--;
  }
}
async function loadCurrent(ctx, poll, generation, fromEvent = false) {
  if (!ws) {
    view = null;
    ctx.ui.invalidate();
    return;
  }
  if (background) {
    const selection = background;
    try {
      const page = await persistent(ctx, "view", { limit: Math.min(historyLimit, 200), before: Number(historyBefore[historyBefore.length - 1]) || void 0 });
      const auth = await ctx.modules.call("acp", "authSettings", {});
      if (generation !== loadGeneration || background !== selection || ws?.id !== selection.workspaceId) return;
      const catalogNow = backgroundCatalog?.workspaceId === ws.id ? backgroundCatalog : null;
      const signature2 = JSON.stringify([page, auth, backgroundSessions.map((s) => [s.id, s.name, s.status, s.profile?.id]), catalogNow ? [catalogNow.profiles, catalogNow.mcps] : null, historyBefore.length]);
      if (poll && signature2 === backgroundSignature && view && !error) return;
      backgroundSignature = signature2;
      backgroundPage = page;
      const session = page.session;
      const catalog = backgroundCatalog?.workspaceId === ws.id ? backgroundCatalog : null;
      const profiles = catalog?.profiles.some((p) => p.id === session.profile.id) ? catalog.profiles : [session.profile, ...catalog?.profiles || []];
      view = {
        auth,
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
      syncOrigin();
    } catch (e) {
      if (generation === loadGeneration && background === selection) error = errMsg(e);
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
    if (generation !== loadGeneration || ws?.id !== workspaceId || background) return;
    if (historyConversationId !== next.active?.conversation?.id) {
      historyBefore = [];
      historyLimit = CHAT_MESSAGE_LIMIT;
      preserveHistoryScroll = false;
      historyConversationId = next.active?.conversation?.id || null;
    }
    view = next;
    error = null;
    syncOrigin();
    const active = view.active;
    if (active && !connectionAttempts.has(active.conversation.id)) {
      const id = active.conversation.id;
      connectionAttempts.add(id);
      if (!active.live || !["ready", "busy", "starting", "connecting"].includes(active.live.status)) {
        ctx.ui.invalidate();
        await ctx.modules.call("ai-sessions", "connect", { conversationId: id }, { timeoutMs: 6e5 });
        if (ws?.id === workspaceId && !background) {
          const resumed = await ctx.modules.call("ai-sessions", "view", { workspaceId, messageLimit: historyLimit, windowConversationId: historyConversationId, beforeMessageId: historyBefore[historyBefore.length - 1] });
          if (generation === loadGeneration && ws?.id === workspaceId && !background) {
            view = resumed;
            syncOrigin();
          }
        }
      }
    }
  } catch (e) {
    if (generation === loadGeneration) error = errMsg(e);
  }
  const signature = JSON.stringify([view, error]);
  if (fromEvent && signature === chatSignature) return;
  chatSignature = signature;
  publishRail(ctx);
  ctx.ui.invalidate();
}
async function openAgentFromRail(ctx, e) {
  const workspaceId = typeof e?.workspaceId === "string" ? e.workspaceId : null;
  if (!workspaceId || typeof e?.id !== "string") return;
  const here = ws?.id === workspaceId;
  if (e.kind === "chat") {
    if (background) leaveBackground(ctx);
    await ctx.modules.call("ai-sessions", "select", { workspaceId, conversationId: e.id });
    if (here) {
      await ctx.modules.call("workspace", "view.patch", { workspaceId, patch: { ui: { aiBackgroundSession: null } } });
      await load(ctx);
    }
  } else if (e.kind === "agent") {
    await ctx.modules.call("workspace", "view.patch", { workspaceId, patch: { ui: { aiBackgroundSession: e.id } } });
    if (here) await openBackground(ctx, { workspaceId, id: e.id });
  }
  if (!here) await ctx.modules.call("workspace", "select", { workspaceId });
}
function publishRail(ctx) {
  const profiles = view?.profiles || [];
  ctx.state.set("ai.rail", view && ws ? {
    workspaceId: ws.id,
    activeId: view.activeId || null,
    background: !!background,
    conversations: (view.conversations || []).slice(0, 40).map((c) => ({
      id: c.id,
      title: c.title || "New chat",
      provider: (profiles.find((p) => p.id === c.acpProfileId)?.name || "Agent").replace(/\s*\([^)]*\)$/, ""),
      status: c.status || "saved"
    }))
  } : null);
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
var toolLists = /* @__PURE__ */ new Map();
var toolsExpanded = /* @__PURE__ */ new Set();
var toolKey = (id) => (background ? "bg:" : "chat:") + id;
var chip = (key, text, color, bg) => ({ type: "label", key, text, size: "xs", weight: "medium", color, style: { background: bg, radius: 9, paddingX: 7, paddingY: 1, noShrink: true } });
var tone = { ok: ["success", "#2f9e6a22"], warn: ["warning", "#d8962022"], off: ["muted", "#80808022"], info: ["primary", "#6f7cf622"] };
var heading = (key, text, count) => ({ type: "label", key, text: count === void 0 ? text : `${text} · ${count}`, size: "xs", weight: "semibold", color: "muted" });
var sourceLabel = (source) => source === "library-global" ? "Library" : source === "library-project" ? "Project library" : "Workspace";
function offeredSkills(workspace) {
  if (background) return list(backgroundCatalog?.workspaceId === ws?.id ? backgroundCatalog?.skills : []).map((k) => ({ ...k, source: k.source || "workspace" }));
  return [
    ...workspace.map((k) => ({ ...k, source: "workspace" })),
    ...libraryItemsFor(libraryState, ws, "skill").map((i) => ({ name: i.name, description: i.description, path: libraryRef(i.id), source: i.projectId ? "library-project" : "library-global" }))
  ];
}
function toolsList(id) {
  const entry = toolLists.get(toolKey(id));
  if (!entry || entry.busy) return [{ type: "label", key: "tools-loading", text: "Loading tools…", size: "xs", color: "muted" }];
  if (entry.error) return [{ type: "label", key: "tools-error", text: entry.error, size: "xs", color: "danger", wrap: true }];
  const tools = entry.tools || [];
  if (!tools.length) return [{ type: "label", key: "tools-none", text: "This server exposes no tools.", size: "xs", color: "muted" }];
  return [{ type: "column", key: "tools", gap: 2, maxHeight: 220, scroll: true, children: tools.map((t) => ({ type: "column", key: "t-" + t.name, gap: 1, style: { background: "panel", radius: 6, paddingX: 8, paddingY: 4 }, children: [
    { type: "row", key: "h", gap: 6, align: "center", children: [
      { type: "label", key: "n", text: t.name, mono: true, size: "xs", weight: "medium", grow: true, selectable: true },
      ...t.readOnly ? [chip("ro", "read-only", tone.ok[0], tone.ok[1])] : [],
      ...t.destructive ? [chip("dx", "destructive", tone.warn[0], tone.warn[1])] : []
    ] },
    ...t.description ? [{ type: "label", key: "d", text: t.description.length > 220 ? t.description.slice(0, 220) + "…" : t.description, size: "xs", color: "muted", wrap: true, tooltip: t.description }] : []
  ] })) }];
}
function connectionsPopover(conv, live, active, connected, workspaceSkills, skillState, providerName, modelName, modelId) {
  const servers = view.mcpServers || [{ id: "internal", name: "Hato" }];
  const on = new Set(conv.mcpSelection || []);
  const applied = new Set(background ? [...on] : live?.mcp?.selection || (live?.mcp?.enabled ? ["internal"] : []));
  const pending = !background && connected && [.../* @__PURE__ */ new Set([...on, ...applied])].some((id) => on.has(id) !== applied.has(id));
  const session = background ? backgroundPage?.session : null;
  const idle = !session || !["busy", "waiting", "starting"].includes(session.status);
  const skills = offeredSkills(workspaceSkills);
  const enabledSkills = new Set(session?.skills || []);
  const statusText = connected ? "Connected" : live?.status === "starting" ? "Starting…" : live?.status ? live.status[0].toUpperCase() + live.status.slice(1) : "Not connected";
  const body = [];
  body.push(heading("agent-h", "AGENT"), { type: "row", key: "agent", gap: 6, align: "center", children: [
    { type: "label", key: "state", text: "●", size: "xs", color: connected ? "success" : live?.error ? "danger" : "muted", style: { noShrink: true } },
    { type: "label", key: "who", text: `${providerName}${modelId ? " · " + modelName : ""}`, size: "sm", weight: "medium", grow: true, wrap: true },
    chip("kind", background ? "background" : "desktop", tone.info[0], tone.info[1])
  ] }, { type: "label", key: "where", text: `${statusText} · ${live?.machineId || view.workspace.machineId} · ${view.workspace.root}`, size: "xs", color: "muted", wrap: true, tooltip: view.workspace.root });
  body.push({ type: "divider", key: "d-mcp" }, heading("mcp-h", "MCP SERVERS", [...on].filter((id) => servers.some((s) => s.id === id)).length));
  if (!pending && (connected || background)) body.push({ type: "row", key: "reconnect-tools", gap: 8, align: "center", children: [
    { type: "label", key: "t", text: "Hato tools not responding after a restart?", size: "xs", color: "muted", grow: true, wrap: true },
    {
      type: "button",
      key: "b",
      text: "Reconnect MCPs",
      iconSvg: uiIcons.refresh,
      action: "reconnect",
      small: true,
      disabled: !idle || !!active.busy || !!busy,
      tooltip: !idle || active.busy ? "Wait for the agent to finish its turn, or stop it, before reconnecting" : "Restart this chat's MCP servers with fresh connections to Hato. The conversation resumes where it left off."
    }
  ] });
  for (const sv of servers) {
    const isOn = on.has(sv.id), isApplied = applied.has(sv.id), open = toolsExpanded.has(toolKey(sv.id));
    const state = isOn && (isApplied || !connected) ? connected ? ["connected", tone.ok] : ["enabled", tone.info] : isOn ? ["reconnect to apply", tone.warn] : isApplied ? ["removing on reconnect", tone.warn] : ["off", tone.off];
    body.push({ type: "column", key: "mcp-" + sv.id, gap: 4, children: [
      { type: "row", key: "row", gap: 8, align: "center", children: [
        { type: "button", key: "expand", text: open ? "▾" : "▸", action: "toggleTools:" + sv.id, variant: "ghost", small: true, tooltip: open ? "Hide tools" : "Show the tools this server exposes" },
        { type: "column", key: "t", gap: 1, grow: true, children: [
          { type: "label", key: "n", text: sv.name, size: "sm", weight: "medium" },
          ...sv.description ? [{ type: "label", key: "d", text: sv.description, size: "xs", color: "muted", wrap: true }] : []
        ] },
        chip("st", String(state[0]), state[1][0], state[1][1]),
        {
          type: "switch",
          key: "s",
          label: "",
          checked: isOn,
          action: "toggleMcp:" + sv.id,
          disabled: !!background && !!active.busy,
          tooltip: background ? "Applies immediately; a connected background agent restarts with the new tools" : "Applies on the next connect"
        }
      ] },
      ...open ? toolsList(sv.id) : []
    ] });
  }
  if (pending) body.push({ type: "row", key: "apply", gap: 8, align: "center", style: { background: "#d8962014", radius: 8, paddingX: 8, paddingY: 6 }, children: [
    { type: "label", key: "t", text: "Reconnect to apply MCP changes", size: "xs", grow: true },
    { type: "button", key: "b", text: "Reconnect", action: "reconnect", small: true, disabled: active.busy }
  ] });
  body.push({ type: "button", key: "manage", text: "Manage MCP servers…", iconSvg: uiIcons["sliders-horizontal"], action: "openMcps", variant: "ghost", small: true, tooltip: "Add servers, sign in to remote ones, and choose what background agents can use" });
  body.push({ type: "divider", key: "d-skills" });
  if (background && session) {
    body.push(
      heading("skills-h", "SKILLS", enabledSkills.size),
      { type: "label", key: "skills-note", text: on.has("internal-remote-mcp") ? "The agent gets each enabled skill's name and description, and reads the full text with Workspace tools when a task needs it. Changing them restarts a connected agent." : "Without Workspace tools, enabled skills are sent in full. Turn Workspace tools on so the agent loads them only when needed. Changing them restarts a connected agent.", size: "xs", color: "muted", wrap: true }
    );
    const missing = [...enabledSkills].filter((p) => !skills.some((k) => k.path === p));
    body.push(...skills.map((k) => ({ type: "row", key: "skill-" + k.path, gap: 8, align: "center", tooltip: k.description || k.path, children: [
      { type: "column", key: "t", gap: 1, grow: true, children: [
        { type: "label", key: "n", text: k.name, size: "sm", weight: enabledSkills.has(k.path) ? "medium" : "normal" },
        { type: "label", key: "d", text: sourceLabel(k.source) + (k.description ? " · " + k.description : ""), size: "xs", color: "muted", wrap: true }
      ] },
      { type: "button", key: "insert", text: "Insert", action: "useSkill", value: k.path, small: true, variant: "ghost", tooltip: "Reference this skill in your message" },
      { type: "switch", key: "s", label: "", checked: enabledSkills.has(k.path), action: "toggleSkill:" + k.path, disabled: !idle || busy === "skills", tooltip: idle ? "Enable for this agent" : "Wait for the agent to finish its turn" }
    ] })), ...missing.map((p) => ({ type: "row", key: "missing-" + p, gap: 8, align: "center", children: [
      { type: "label", key: "n", text: p, size: "xs", color: "warning", grow: true, wrap: true, tooltip: "Enabled, but no longer offered here (removed, or not available on this machine)" },
      { type: "switch", key: "s", label: "", checked: true, action: "toggleSkill:" + p, disabled: !idle }
    ] })));
    if (!skills.length && !missing.length) body.push({ type: "label", key: "skills-none", text: "No skills here. Add them to .agents/skills or the Library.", size: "xs", color: "muted", wrap: true });
  } else {
    body.push(
      heading("skills-h", "SKILLS", skills.length),
      { type: "label", key: "skills-note", text: "Desktop chats don't preload skills. Insert one to add its instructions to your message.", size: "xs", color: "muted", wrap: true },
      ...skills.length ? skills.map((k) => ({ type: "row", key: "skill-" + k.path, gap: 8, align: "center", tooltip: k.description || k.path, children: [
        { type: "column", key: "t", gap: 1, grow: true, children: [
          { type: "label", key: "n", text: k.name, size: "sm" },
          { type: "label", key: "d", text: sourceLabel(k.source) + (k.description ? " · " + k.description : ""), size: "xs", color: "muted", wrap: true }
        ] },
        { type: "button", key: "insert", text: "Insert", action: "useSkill", value: k.path, small: true, variant: "ghost" }
      ] })) : [{ type: "label", key: "skills-none", text: skillState?.loading ? "Loading workspace skills…" : skillState?.error ? "Could not load workspace skills: " + skillState.error : "No skills here. Add them to .agents/skills or the Library.", size: "xs", color: "muted", wrap: true }]
    );
  }
  body.push({ type: "divider", key: "d-agents" }, heading("instr-h", "INSTRUCTIONS & AGENTS"));
  if (session) {
    const file = session.agentFile ? (backgroundCatalog?.agentFiles || []).find((f) => f.path === session.agentFile)?.name || session.agentFile : null;
    body.push({ type: "label", key: "agent-file", text: "Instruction file: " + (file || "none") + " · change it in agent settings", size: "xs", wrap: true });
  } else body.push({ type: "label", key: "agent-file", text: "Instruction file: the provider's own (AGENTS.md / CLAUDE.md in the workspace)", size: "xs", color: "muted", wrap: true });
  const canAgents = background ? on.has("internal-remote-mcp") || on.has("internal-remote-mcp-local") : false;
  body.push({
    type: "label",
    key: "agents",
    size: "xs",
    wrap: true,
    color: canAgents ? void 0 : "muted",
    text: canAgents ? "Background agents: this chat can create, prompt and stop background agents in this workspace (Workspace tools)." : background ? "Background agents: not reachable. Enable Workspace tools to let this chat start and control them." : "Background agents: not available to desktop chats. Start a new chat to run it as a background agent."
  });
  return { type: "popover", key: "mcp-picker", transition: anchoredAboveMotion, closeAction: "toggleMcpPicker", bottom: 56, left: 8, width: 420, anchorScope: "container", heightFraction: 0.85, maxHeight: 640, style: { ...chatStyle.picker, background: "background" }, children: [
    { type: "row", key: "head", gap: 8, padding: 10, align: "center", children: [
      { type: "label", key: "t", text: "Connected to this chat", weight: "semibold", grow: true },
      { type: "button", key: "close-mcp", text: "", iconSvg: uiIcons.x, action: "toggleMcpPicker", tooltip: "Close", style: chatStyle.iconControl }
    ] },
    { type: "divider", key: "d1" },
    // A bounded height (heightFraction) plus grow lets the body scroll instead of being clipped.
    { type: "column", key: "body", scroll: true, grow: true, gap: 8, padding: 10, children: body }
  ] };
}
async function loadTools(ctx, id) {
  const key = toolKey(id);
  toolLists.set(key, { busy: true });
  ctx.ui.invalidate();
  try {
    const r = background ? await persistent(ctx, "listMcpTools", { id }) : await ctx.modules.call("ai-sessions", "mcpTools", { serverId: id }, { timeoutMs: 95e3 });
    toolLists.set(key, { busy: false, tools: Array.isArray(r?.tools) ? r.tools : Array.isArray(r) ? r : [] });
  } catch (e) {
    toolLists.set(key, { busy: false, error: errMsg(e) });
  }
  ctx.ui.invalidate();
}
function elicitationFields(pending) {
  const required = new Set(pending.schema.required || []);
  return Object.entries(pending.schema.properties || {}).slice(0, 64).flatMap(([key, property], index) => {
    const token = "f" + index, controlKey = `${pending.uiKey}-${token}`, action = `elicitationField:${pending.uiKey}:${token}`;
    if (!property || typeof property !== "object" || Array.isArray(property) || ["__proto__", "prototype", "constructor"].includes(key)) return [{ type: "status", key: controlKey, text: `Field '${key}' has an invalid schema.`, level: "error" }];
    const label = property.title || key, value = pending.values[key], choices = enumChoices(property);
    let control;
    if (property.type === "string" && (Array.isArray(property.enum) || Array.isArray(property.oneOf))) control = {
      type: "select",
      key: controlKey,
      value: typeof value === "string" ? value : null,
      options: choices,
      action,
      placeholder: required.has(key) ? "Choose…" : "Optional",
      buttonStyle: chatStyle.fieldControl
    };
    else if (property.type === "string") control = {
      type: "textInput",
      key: controlKey,
      value: typeof value === "string" ? value : "",
      placeholder: property.description || label,
      changeAction: action,
      style: chatStyle.fieldControl
    };
    else if (property.type === "boolean") control = { type: "toggle", key: controlKey, label: "", checked: value === true, action };
    else if (property.type === "number" || property.type === "integer") control = {
      type: "textInput",
      key: controlKey,
      value: typeof value === "number" ? String(value) : typeof value === "string" ? value : "",
      placeholder: property.type === "integer" ? "Whole number" : "Number",
      changeAction: action,
      style: chatStyle.fieldControl
    };
    else if (property.type === "array") {
      const options = enumChoices(property.items || {});
      control = options.length ? { type: "column", key: controlKey, gap: 4, children: options.map((choice, choiceIndex) => ({
        type: "switch",
        key: "o" + choiceIndex,
        label: choice.label,
        checked: Array.isArray(value) && value.includes(choice.value),
        action: `elicitationArray:${pending.uiKey}:${token}:o${choiceIndex}`
      })) } : { type: "status", key: controlKey, text: "This multi-select field does not declare supported choices.", level: "error" };
    } else control = { type: "status", key: controlKey, text: `Unsupported schema type '${String(property.type || "unknown")}'.`, level: "error" };
    return [
      { type: "column", key: "field-" + token, gap: 5, children: [
        { type: "label", key: "label", text: label + (required.has(key) ? " *" : ""), size: "sm", weight: "medium" },
        control,
        ...property.description && property.type !== "string" ? [{ type: "label", key: "description", text: property.description, size: "xs", color: "muted", wrap: true }] : [],
        ...pending.errors[key] ? [{ type: "label", key: "error", text: pending.errors[key], size: "xs", color: "danger", wrap: true }] : []
      ] }
    ];
  });
}
var mod = {
  methods: {
    newChat: async (ctx) => {
      await mod.onEvent(ctx, { action: "newChat" });
      return true;
    },
    selectConversation: async (ctx, a) => {
      await mod.onEvent(ctx, { action: "selectConv", value: String(a?.id || "") });
      return true;
    },
    openHistory: async (ctx) => {
      await mod.onEvent(ctx, { action: "openHistory" });
      return true;
    }
  },
  id: "ai",
  moduleApiVersion: 1,
  async activate(ctx, prev) {
    for (const rail of ["left-sidebar", "sidebar"]) {
      ctx.events.on(`${rail}.newChat`, () => {
        void mod.onEvent(ctx, { action: "newChat" });
      });
      ctx.events.on(`${rail}.selectConversation`, (e) => {
        if (typeof e?.id === "string") void mod.onEvent(ctx, { action: "selectConv", value: e.id });
      });
      ctx.events.on(`${rail}.openHistory`, () => {
        void mod.onEvent(ctx, { action: "openHistory" });
      });
      ctx.events.on(`${rail}.openAgent`, (e) => {
        void openAgentFromRail(ctx, e).catch((err) => {
          error = errMsg(err);
          ctx.ui.invalidate();
        });
      });
    }
    if (prev?.composerFractions) for (const [id, value] of prev.composerFractions) composerFractions.set(id, clampComposerFraction(value));
    if (prev?.attachments) attachments = imageAttachments(prev.attachments);
    if (prev && typeof prev.draft === "string") draft = prev.draft;
    authPickerOpen = !!prev?.authPickerOpen;
    providerSessionsOpen = !!prev?.providerSessionsOpen;
    if (Array.isArray(prev?.elicitations)) for (const item of prev.elicitations) {
      if (typeof item?.conversationId === "string" && item.requestId !== void 0 && item.schema) pendingElicitations.set(elicitationKey(item.conversationId, item.requestId), {
        ...item,
        schemaError: item.schemaError || null,
        uiKey: typeof item.uiKey === "string" ? item.uiKey : "form-" + crypto.randomUUID(),
        submitting: false
      });
    }
    activeElicitation = typeof prev?.activeElicitation === "string" ? prev.activeElicitation : null;
    authConsole = prev?.authConsole && typeof prev.authConsole.conversationId === "string" ? { ...prev.authConsole, output: "", uiKey: prev.authConsole.uiKey || "auth-" + crypto.randomUUID(), inputKey: prev.authConsole.inputKey || "auth-input-" + crypto.randomUUID() } : null;
    refresh = debounce(() => load(ctx, false, true), 100);
    ws = ctx.state.get("workspace.selected") || null;
    void restoreComposer(ctx);
    workspaceSkillState = ctx.state.get("files.skills") || null;
    ctx.state.watch("files.skills", (value) => {
      workspaceSkillState = value;
      ctx.ui.invalidate();
    });
    libraryState = ctx.state.get(LIBRARY_STATE) ?? null;
    ctx.state.watch(LIBRARY_STATE, (value) => {
      libraryState = value;
      if (background) void loadCatalog(ctx);
      ctx.ui.invalidate();
    });
    ctx.state.watch("workspace.selected", (v) => {
      const changed = ws?.id !== v?.id;
      ws = v;
      if (changed) {
        void restoreComposer(ctx);
        publishSettings();
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
      if (adapters) void loadAdapters(ctx).catch((e) => publishSettings(errMsg(e)));
    });
    publishSettings = exportSettings(
      ctx,
      adapterSections,
      () => {
        throw new Error("ACP adapters have no editable values");
      },
      { action: (_section, key) => adapterAction(ctx, key) }
    );
    ctx.events.on("settings.open", () => {
      if (ws && adapters?.machineId !== ws.machineId) void loadAdapters(ctx).catch((e) => publishSettings(errMsg(e)));
    });
    ctx.events.on("acp.authChanged", () => refresh());
    refreshAuth = debounce(() => ctx.ui.invalidate(), 50);
    ctx.events.on("acp.authOutput", (p) => {
      if (!authConsole || p.conversationId !== authConsole.conversationId || p.methodId !== authConsole.methodId || p.attemptId !== authConsole.attemptId) return;
      authConsole.output = authOutputText(authConsole.output + String(p.data || ""));
      refreshAuth();
    });
    ctx.events.on("acp.authCompleted", (p) => {
      if (!authConsole || p.conversationId !== authConsole.conversationId || p.methodId !== authConsole.methodId || p.attemptId !== authConsole.attemptId) return;
      authConsole.cancelled = !!p.cancelled;
      authConsole.completed = { code: p.code ?? null, signal: p.signal ?? null };
      if (!p.cancelled && p.code === 0 && p.signal == null) {
        authConsole = null;
        authPickerOpen = false;
        error = null;
      }
      refresh();
      refreshAuth();
    });
    ctx.events.on("acp.elicitation", (p) => {
      if (p?.request?.mode !== "form" || typeof p.conversationId !== "string" || !p.request.requestedSchema) return;
      const key = elicitationKey(p.conversationId, p.requestId);
      if (pendingElicitations.has(key)) return;
      const normalized = normalizeElicitationSchema(p.request.requestedSchema);
      pendingElicitations.set(key, {
        conversationId: p.conversationId,
        requestId: p.requestId,
        request: p.request,
        schema: normalized.schema,
        schemaError: normalized.error,
        values: initialElicitationValues(normalized.schema),
        errors: normalized.error ? { _schema: normalized.error } : {},
        uiKey: "form-" + crypto.randomUUID()
      });
      activeElicitation = key;
      refresh();
    });
    ctx.events.on("acp.elicitationComplete", (p) => {
      if (p?.requestId !== void 0) pendingElicitations.delete(elicitationKey(String(p.conversationId || ""), p.requestId));
      if (activeElicitation && !pendingElicitations.has(activeElicitation)) activeElicitation = null;
      refresh();
    });
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
  canSwap() {
    return { ok: pendingEvents === 0 && pendingLoads === 0 && !busy && !providerSessionsLoading && !requests.size && ![...pendingElicitations.values()].some((p) => p.submitting), reason: "Chat operations are in progress" };
  },
  deactivate() {
    loadGeneration++;
    origin = crypto.randomUUID();
    if (backgroundTimer) clearInterval(backgroundTimer);
    backgroundTimer = null;
    for (const p of requests.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("Chat module reloaded"));
    }
    requests.clear();
  },
  snapshot: () => background ? {
    draft,
    attachments,
    background,
    normalDraft,
    normalAttachments,
    composerFractions: [...composerFractions],
    authPickerOpen,
    providerSessionsOpen,
    elicitations: [...pendingElicitations.values()],
    activeElicitation,
    authConsole: authConsole ? { ...authConsole, output: "" } : null
  } : {
    draft,
    attachments,
    composerFractions: [...composerFractions],
    authPickerOpen,
    providerSessionsOpen,
    elicitations: [...pendingElicitations.values()],
    activeElicitation,
    authConsole: authConsole ? { ...authConsole, output: "" } : null
  },
  render() {
    syncOrigin();
    const active = view?.active;
    const conv = active?.conversation;
    const live = active?.live;
    const shownAuth = authConsole && authConsole.conversationId === conv?.id ? authConsole : live?.authProcess ? {
      conversationId: conv.id,
      methodId: live.authProcess.methodId,
      label: live.authProcess.label,
      display: [live.authProcess.command, ...live.authProcess.args.map((arg) => JSON.stringify(arg))].join(" "),
      attemptId: live.authProcess.attemptId,
      pty: live.authProcess.handle,
      envKeys: live.authProcess.envKeys || [],
      output: "",
      uiKey: `auth-${conv.id}-${live.authProcess.methodId}-${live.authProcess.startedAt || 0}`,
      inputKey: `auth-${conv.id}-${live.authProcess.methodId}-${live.authProcess.startedAt || 0}-0`
    } : null;
    const pendingForm = activeElicitation && pendingElicitations.get(activeElicitation)?.conversationId === conv?.id ? pendingElicitations.get(activeElicitation) : conv ? [...pendingElicitations.values()].reverse().find((item) => item.conversationId === conv.id) : void 0;
    const context = contextUsage(live?.usage);
    const connected = !!live && ["ready", "busy", ...background ? ["waiting"] : []].includes(live.status);
    const profile = view?.profiles.find((p) => p.id === conv?.acpProfileId);
    const providerName = profile?.name?.replace(/\s*\([^)]*\)$/, "") || "Agent";
    const skillState = workspaceSkillState?.workspaceId === ws?.id ? workspaceSkillState : null;
    const skills = skillState?.skills || [];
    const config = selectors(live, connected);
    const slashCommands = slashDismissed ? [] : matchingCommands(live?.commands, draft || "", 50);
    const model = config.find((n) => n.key === "cfg-model");
    const modelName = model.options.find((o) => o.value === model.value)?.label || (connected ? "Choose model" : "Connect to choose");
    const modelOption = (live?.configOptions || []).find((o) => o.category === "model");
    const advertised = (modelOption?.options || []).flatMap((o) => o.options || [o]);
    const modelDetails = (id) => advertised.find((o) => String(o.value) === id) || live?.models?.availableModels?.find((o) => o.modelId === id);
    const iconButton = (key, icon, action, tooltip) => ({ type: "button", key, text: "", iconSvg: uiIcons[icon], action, tooltip, style: chatStyle.iconControl, disabled: !ws });
    const providerLocked = !conv || !!active?.busy || live?.status === "starting" || live?.status === "busy";
    const autoTooltip = background ? "Autopilot: approve this background agent's tool permissions and Git task creation automatically, even while Hato is closed." : "Automatically approve agent tool permissions. Module changes still require native approval.";
    const kids = [];
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
    if (live?.error && !connected) kids.push({ type: "column", key: "liveerr", gap: 6, children: [
      { type: "status", key: "liveerr-text", text: live.error, level: "error" },
      ...live.authMethods?.length ? [{ type: "button", key: "authenticate", text: "Authenticate…", action: "openAuth", small: true, disabled: !!active?.busy || !!live.authProcess }] : []
    ] });
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
          const confirming = deleteChat?.id === c.id;
          return { type: "column", key: c.id, gap: 6, style: { padding: 8, radius: 10, borderWidth: 1, borderColor: selected ? "primary" : "border", background: selected ? "selection" : "background" }, children: [
            { type: "row", key: "session", gap: 8, align: "center", children: [
              // Native choices fill their parent; constrain that parent so the delete action
              // always keeps its own space, even beside a long conversation title.
              { type: "column", key: "selection", grow: true, minWidth: 0, children: [
                { type: "choice", key: "select", text: c.title, description: `${provider} · ${c.status === "busy" ? "Working" : c.status === "online" ? "Connected" : c.status === "error" ? "Needs attention" : "Saved"}${selected ? " · Current session" : ""}`, selected, action: "selectConv", value: c.id, disabled: busy === "deleteChat" }
              ] },
              { type: "button", key: "delete", text: "Delete", iconSvg: uiIcons.trash, action: "requestDeleteChat", value: c.id, small: true, variant: "ghost", style: { width: 84, noShrink: true }, disabled: !!busy || chatWorking(c.status), tooltip: chatWorking(c.status) ? "Finish or stop this chat before deleting it" : "Delete chat" }
            ] },
            ...confirming ? [{ type: "row", key: "confirm-delete", gap: 8, align: "center", children: [
              { type: "label", key: "warning", text: "Delete this chat and its saved history?", size: "xs", wrap: true, grow: true },
              { type: "button", key: "cancel", text: "Cancel", action: "cancelDeleteChat", small: true, disabled: !!busy },
              { type: "button", key: "confirm", text: "Delete", action: "confirmDeleteChat", small: true, variant: "danger", disabled: !!busy || chatWorking(c.status) }
            ] }] : []
          ] };
        }) : [{ type: "label", key: "no-sessions", text: historyQuery ? "No matching sessions. Try another search." : "Your conversations will appear here.", color: "muted", padding: 20, wrap: true }] }
      ] });
    }
    if (conv) {
      if (settingsOpen) {
        const field = (key, label, control, hint) => ({ type: "column", key: key + "-field", gap: 5, children: [
          { type: "label", key: "label", text: label, size: "sm", weight: "medium" },
          control,
          ...hint ? [{ type: "label", key: "hint", text: hint, size: "xs", color: "muted", wrap: true }] : []
        ] });
        const section = (key, title, children) => ({ type: "column", key, gap: 12, children: [
          { type: "label", key: "title", text: title.toUpperCase(), size: "xs", weight: "semibold", color: "muted" },
          ...children
        ] });
        const selectControl = (node) => ({ ...node, label: void 0, buttonStyle: chatStyle.fieldControl });
        const options = [];
        for (const node of config.filter((n) => n.key !== "cfg-model")) {
          const option = (live?.configOptions || []).find((o) => "cfg-" + o.id === node.key);
          options.push(node.type === "select" ? field(node.key, node.label || option?.name || "Option", selectControl(node), option?.description) : node);
        }
        const permissions = [
          field(
            "policy",
            "Approval policy",
            { type: "select", key: "policy", options: POLICIES, value: conv.approvalPolicy, action: "setPolicy", buttonStyle: chatStyle.fieldControl },
            "Which tool requests ask you first. Auto in the toolbar switches to autopilot."
          )
        ];
        if (profile?.authOption) permissions.push({ type: "row", key: "provider-auth-row", gap: 12, align: "center", children: [
          { type: "column", key: "text", grow: true, gap: 3, children: [
            { type: "label", key: "label", text: profile.authOption.label, size: "sm", weight: "medium", wrap: true },
            ...profile.authOption.description ? [{ type: "label", key: "hint", text: profile.authOption.description, size: "xs", color: "muted", wrap: true }] : []
          ] },
          { type: "switch", key: "provider-auth", label: "", checked: view.auth?.[profile.authOption.field] !== false, action: "toggleProviderAuth" }
        ] });
        const description = modelDetails(model.value || "")?.description;
        const fields = [
          { type: "row", key: "heading", gap: 8, align: "center", children: [
            { type: "column", key: "title", grow: true, gap: 2, children: [
              { type: "label", key: "name", text: providerName + " settings", weight: "semibold" },
              { type: "label", key: "model", text: model.value ? modelName : "No model selected", size: "xs", color: "muted" }
            ] },
            iconButton("close", "x", "toggleSettings", "Close settings")
          ] },
          ...description ? [{ type: "label", key: "model-description", text: description, size: "xs", color: "muted", wrap: true }] : [],
          ...options.length ? [{ type: "divider", key: "d-options" }, section("agent-options", "Agent", options)] : [],
          { type: "divider", key: "d-permissions" },
          section("permissions", "Permissions", permissions)
        ];
        const authMethods = live?.authMethods || [];
        if (authMethods.length || live?.authProcess) {
          const auth = live?.authProcess;
          fields.push({ type: "divider", key: "d-auth" }, section("authentication", "Authentication", [
            { type: "label", key: "auth-note", text: auth ? `Authentication running: ${auth.label}` : "Sign in to the agent on this workspace machine. Hato reconnects after a successful login.", size: "xs", color: "muted", wrap: true },
            ...auth ? [{ type: "button", key: "show-auth", text: "Show authentication", action: "openAuth", style: chatStyle.control }] : [],
            ...authMethods.map((method) => ({ type: "column", key: "auth-method-" + method.id, gap: 4, children: [
              {
                type: "button",
                key: "start",
                text: method.name || method.id,
                action: "authenticate:" + method.id,
                style: chatStyle.control,
                disabled: !!active?.busy || !!auth || !!busy,
                tooltip: terminalMethod(method) ? "Run the configured agent in an authentication console" : "Ask the agent to authenticate this session"
              },
              ...method.description ? [{ type: "label", key: "description", text: method.description, size: "xs", color: "muted", wrap: true }] : []
            ] }))
          ]));
        }
        if (background && backgroundPage) {
          const session = backgroundPage.session, files = backgroundCatalog?.agentFiles || [];
          const idle = !["busy", "waiting", "starting"].includes(session.status);
          fields.push({ type: "divider", key: "d-instructions" }, section("instructions", "Instructions", [
            field("agent-file", "Instruction file", {
              type: "select",
              key: "agent-file",
              buttonStyle: chatStyle.fieldControl,
              action: "setAgentFile",
              disabled: !idle,
              options: [{ value: "", label: "None" }, ...files.map((f) => ({ value: f.path, label: isLibraryRef(f.path) ? f.name : f.path })), ...session.agentFile && !files.some((f) => f.path === session.agentFile) ? [{ value: session.agentFile, label: session.agentFile }] : []],
              value: session.agentFile || ""
            }, "Sent with the first prompt. Changing it restarts a connected agent."),
            { type: "label", key: "agent-skills", text: `Skills: ${session.skills.length || "none"} enabled · manage them from the MCP button below the message box`, size: "xs", color: "muted", wrap: true }
          ]));
        }
        const statusText = connected ? "Connected" : live?.status === "starting" ? "Starting…" : live?.status ? live.status[0].toUpperCase() + live.status.slice(1) : "Not connected";
        fields.push({ type: "divider", key: "d-connection" }, section("connection", "Connection", [
          { type: "row", key: "where", gap: 6, align: "center", children: [
            { type: "label", key: "state", text: "●", size: "xs", color: connected ? "success" : live?.error ? "danger" : "muted", style: { noShrink: true } },
            { type: "label", key: "status", text: statusText, size: "sm", weight: "medium", style: { noShrink: true } },
            { type: "label", key: "loc", text: `${live?.machineId || view.workspace.machineId} · ${view.workspace.root}`, size: "xs", color: "muted", grow: true, tooltip: view.workspace.root }
          ] },
          { type: "row", key: "connection", gap: 8, wrap: true, children: [
            ...background ? [
              { type: "button", key: "connect", text: connected ? "Reconnect" : "Connect", action: "reconnect", style: chatStyle.control, disabled: !!active?.busy },
              { type: "button", key: "stop", text: "Stop agent", action: "stopBackground", style: chatStyle.control, variant: "danger", disabled: !live || live.status === "stopped" }
            ] : [{ type: "button", key: "connect", text: connected ? "Disconnect" : "Connect", action: connected ? "disconnect" : "connect", style: chatStyle.control }],
            { type: "button", key: "adapters", text: "Manage agents…", action: "openAdapters", style: chatStyle.control, tooltip: "Install or update ACP adapters in Settings" },
            {
              type: "button",
              key: "provider-sessions",
              text: "Provider sessions…",
              action: "openProviderSessions",
              style: chatStyle.control,
              disabled: !live?.agentCapabilities?.sessionCapabilities?.list || !!active?.busy || !!live?.authProcess,
              tooltip: live?.agentCapabilities?.sessionCapabilities?.list ? "List, resume, load, fork, close or delete sessions stored by this agent" : "This agent does not advertise session/list"
            }
          ] },
          ...background ? [{ type: "row", key: "runtime", gap: 8, align: "center", wrap: true, children: [
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
          ] }] : []
        ]));
        kids.push({ type: "column", key: "settings", style: chatStyle.settings, grow: true, scroll: true, gap: 16, padding: 14, children: fields });
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
        composer.push({ type: "textInput", key: "prompt", style: { ...chatStyle.textarea, minHeight: 56 }, changeAction: "draftChanged", cancelAction: "dismissCommands", pasteImageAction: "attachImages", maxFiles: 4, maxBytes: 5 * 1024 * 1024, placeholder: active.busy ? "Steer " + providerName + "…" : "Ask " + providerName + "…", multiline: true, fillHeight: true, grow: true, rows: 2, submitAction: "send", value: draft });
        const chipStatus = active.steering ? "Steering · " : active.busy ? "Working · " : connected ? "" : `${live?.status || conv.status || "Offline"} · `;
        const clip = (t, n) => t.length > n ? t.slice(0, n - 1) + "…" : t;
        const modelChevron = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;
        composer.push({ type: "row", key: "chat-tools", gap: 6, align: "center", style: { noShrink: true }, children: [
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
          {
            type: "button",
            key: "mcp-toggle",
            text: String((conv.mcpSelection || []).length),
            iconSvg: uiIcons.plug,
            action: "toggleMcpPicker",
            style: { ...mcpOpen ? { ...chatStyle.control, borderColor: "primary" } : chatStyle.control, paddingX: 9, noShrink: true },
            tooltip: `MCP ${(conv.mcpSelection || []).length}${background && backgroundPage ? ` · Skills ${backgroundPage.session.skills.length}` : ""}
What's connected to this chat: MCP servers and tools, skills, instructions and agents`
          },
          // A clickable row, not a button: the label stays left-aligned and truncates; chevron on the right.
          {
            type: "row",
            key: "cfg-model",
            grow: true,
            minWidth: 0,
            gap: 6,
            align: "center",
            action: "toggleModels",
            value: null,
            hoverStyle: { background: "hover" },
            tooltip: `Provider and model
${providerName} · ${modelName} · ${live?.status || conv.status || "offline"}`,
            style: { height: 32, radius: 8, paddingX: 12, borderWidth: 1, borderColor: modelsOpen ? "primary" : "border", background: "surface" },
            children: [
              { type: "label", key: "t", text: clip(`${chipStatus}${providerName} · ${modelName.replace(/\s*\((recommended|default)\)$/i, "")}`, 28), grow: true, minWidth: 0, style: { fontSize: 14 } },
              { type: "icon", key: "chev", svg: modelChevron, size: 12, color: "muted", style: { rotate: modelsOpen ? 180 : 0 } }
            ]
          }
        ] });
        composer.push({ type: "row", key: "act", gap: 6, align: "center", style: { noShrink: true }, children: [
          { type: "switch", key: "auto", style: { radius: 8, color: "muted" }, label: "Auto", checked: conv?.approvalPolicy === "autopilot", action: "toggleAuto", disabled: !conv, tooltip: autoTooltip },
          iconButton("settings-toggle", "sliders-horizontal", "toggleSettings", "Agent settings"),
          { type: "spacer", key: "chat-gap" },
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
        const transcriptPane = { type: "column", key: "transcript-pane", grow: true, style: { position: "relative", minHeight: 0 }, children: [kids.pop()] };
        if (slashCommands.length) transcriptPane.children.push({
          type: "column",
          key: "slash-commands",
          scroll: true,
          gap: 2,
          padding: 4,
          height: Math.min(slashCommands.length, 5) * 50 + 8,
          style: { ...chatStyle.picker, background: "background", position: "absolute", bottom: 6, left: 8, right: 8 },
          children: slashCommands.map((command) => ({
            type: "choice",
            key: command.name,
            text: `/${command.name}`,
            description: [command.description, command.input?.hint].filter(Boolean).join(" · "),
            action: "chooseCommand",
            value: command.name
          }))
        });
        const transcript = transcriptPane;
        kids.push({
          type: "split",
          key: "chat-composer-split",
          direction: "vertical",
          grow: true,
          fixed: attachments.length ? [null, 240] : void 0,
          sizes: [1 - Math.max(composerFraction, attachments.length ? 0.42 : 0), Math.max(composerFraction, attachments.length ? 0.42 : 0)],
          minSize: attachments.length ? 260 : 150,
          resizeAction: "resizeComposer",
          children: [transcript, { type: "column", key: "composer", style: chatStyle.composer, grow: true, gap: 6, padding: 8, children: composer }],
          tooltip: "Drag the divider above the input to resize it"
        });
      }
      if (mcpOpen && conv) kids.push(connectionsPopover(conv, live, active, connected, skills, skillState, providerName, modelName, model.value || ""));
      if (modelsOpen) {
        const filtered = model.options.filter((o) => `${o.label} ${modelDetails(o.value)?.description || ""}`.toLowerCase().includes(modelQuery.toLowerCase()));
        kids.push({ type: "popover", key: "model-picker", transition: anchoredAboveMotion, closeAction: "toggleModels", bottom: 56, left: 8, width: 380, anchorScope: "container", maxHeight: 520, style: { ...chatStyle.picker, background: "background" }, children: [
          { type: "label", key: "provider-h", text: "Provider", size: "xs", color: "muted", padding: 10 },
          { type: "row", key: "providers", gap: 6, wrap: true, style: { paddingX: 10 }, children: (view?.profiles || []).map((pr) => ({
            type: "button",
            key: "pr-" + pr.id,
            text: pr.name.replace(/\s*\([^)]*\)$/, ""),
            action: "setProfile",
            value: pr.id,
            small: true,
            variant: pr.id === conv?.acpProfileId ? "primary" : "ghost",
            disabled: providerLocked && pr.id !== conv?.acpProfileId,
            tooltip: providerLocked ? "Wait for the agent to finish or stop its turn before switching providers" : "Switch provider · recent dialogue carries over once; earlier history is available through MCP"
          })) },
          { type: "label", key: "model-h", text: "Model", size: "xs", color: "muted", padding: 10 },
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
      if (pendingForm) {
        kids.push({ type: "modal", key: "elicitation", title: pendingForm.schema.title || "Agent requests input", closeAction: "cancelElicitation:" + pendingForm.uiKey, width: 620, children: [
          { type: "label", key: "elicitation-message", text: String(pendingForm.request.message || "Please provide the requested information."), wrap: true },
          ...pendingForm.schema.description ? [{ type: "label", key: "elicitation-description", text: pendingForm.schema.description, color: "muted", wrap: true }] : [],
          ...pendingForm.errors._schema ? [{ type: "status", key: "elicitation-schema-error", text: pendingForm.errors._schema, level: "error" }] : [],
          { type: "column", key: "elicitation-fields", gap: 12, scroll: true, maxHeight: 420, children: elicitationFields(pendingForm) },
          { type: "row", key: "elicitation-actions", gap: 8, wrap: true, children: [
            { type: "button", key: "decline", text: "Decline", action: "declineElicitation:" + pendingForm.uiKey, variant: "ghost", disabled: !!pendingForm.submitting },
            { type: "button", key: "cancel", text: "Cancel", action: "cancelElicitation:" + pendingForm.uiKey, variant: "ghost", disabled: !!pendingForm.submitting },
            { type: "spacer", key: "gap" },
            { type: "button", key: "accept", text: pendingForm.submitting ? "Submitting…" : "Accept", action: "acceptElicitation:" + pendingForm.uiKey, variant: "primary", disabled: !!pendingForm.submitting || !!pendingForm.schemaError }
          ] }
        ] });
      }
      if (providerSessionsOpen && conv && providerSessionsConversation === conv.id) {
        const caps = live?.agentCapabilities?.sessionCapabilities || {};
        const rows = providerSessions.filter((s) => `${s.title || ""} ${s.sessionId} ${s.cwd || ""}`.toLowerCase().includes(providerSessionsQuery.toLowerCase()));
        const locked = !!active?.busy || !!busy || !!providerSessionAction || !!live?.authProcess || live?.authStarting;
        kids.push({ type: "modal", key: "provider-sessions-modal", title: "Provider sessions", closeAction: "closeProviderSessions", width: 720, children: [
          { type: "row", key: "provider-sessions-head", gap: 8, align: "center", children: [
            { type: "column", key: "summary", grow: true, gap: 2, children: [
              { type: "label", key: "provider", text: providerName, weight: "semibold" },
              { type: "label", key: "current", text: live?.sessionId ? `Current provider session: ${live.sessionId}` : "No current provider session", size: "xs", color: "muted", wrap: true }
            ] },
            { type: "button", key: "new", text: "New session", action: "newProviderSession", value: { conversationId: conv.id }, variant: "primary", disabled: locked },
            { type: "button", key: "reload", text: "Reload", action: "reloadProviderSessions", disabled: !!providerSessionAction }
          ] },
          { type: "textInput", key: "provider-session-search", ...filterInput, value: providerSessionsQuery, placeholder: "Search provider sessions…", changeAction: "searchProviderSessions" },
          { type: "column", key: "provider-session-list", scroll: true, maxHeight: 430, gap: 6, children: rows.length ? rows.map((s) => {
            const current = !live?.sessionClosed && s.sessionId === live?.sessionId;
            return { type: "column", key: s.sessionId, gap: 6, style: { padding: 8, radius: 8, borderWidth: 1, borderColor: current ? "primary" : "border", background: current ? "selection" : "surface" }, children: [
              { type: "row", key: "heading", gap: 8, align: "center", children: [
                { type: "column", key: "title", grow: true, minWidth: 0, gap: 2, children: [
                  { type: "label", key: "name", text: s.title || s.sessionId, weight: "medium", wrap: true },
                  { type: "label", key: "id", text: s.sessionId, mono: true, size: "xs", color: "muted", selectable: true, wrap: true },
                  ...s.cwd ? [{ type: "label", key: "cwd", text: s.cwd, size: "xs", color: "muted", wrap: true }] : [],
                  ...s.updatedAt ? [{ type: "label", key: "updated", text: `Updated ${s.updatedAt}`, size: "xs", color: "muted" }] : []
                ] },
                ...current ? [chip("current", "current", tone.info[0], tone.info[1])] : []
              ] },
              { type: "row", key: "actions", gap: 6, wrap: true, children: [
                ...caps.resume ? [{ type: "button", key: "resume", text: "Resume", action: "resumeProviderSession", value: { conversationId: conv.id, sessionId: s.sessionId }, small: true, disabled: locked }] : [],
                ...live?.agentCapabilities?.loadSession ? [{ type: "button", key: "load", text: "Load", action: "loadProviderSession", value: { conversationId: conv.id, sessionId: s.sessionId }, small: true, variant: "ghost", disabled: locked }] : [],
                ...caps.fork ? [{ type: "button", key: "fork", text: "Fork", action: "forkProviderSession", value: { conversationId: conv.id, sessionId: s.sessionId }, small: true, variant: "ghost", disabled: locked }] : [],
                ...current && caps.close ? [{ type: "button", key: "close", text: "Close", action: "closeProviderSession", value: { conversationId: conv.id, sessionId: s.sessionId }, small: true, variant: "ghost", disabled: locked }] : [],
                ...caps.delete ? [{ type: "button", key: "delete", text: "Delete", action: "requestDeleteProviderSession", value: { conversationId: conv.id, sessionId: s.sessionId }, small: true, variant: "danger", disabled: locked }] : []
              ] },
              ...providerSessionDelete?.conversationId === conv.id && providerSessionDelete?.sessionId === s.sessionId ? [{ type: "row", key: "confirm-delete", gap: 8, align: "center", children: [
                { type: "label", key: "warning", text: "Delete this provider session? Hato's local chat history is kept.", size: "xs", color: "warning", grow: true, wrap: true },
                { type: "button", key: "cancel", text: "Cancel", action: "cancelDeleteProviderSession", small: true, disabled: locked },
                { type: "button", key: "confirm", text: "Delete", action: "confirmDeleteProviderSession", value: providerSessionDelete, small: true, variant: "danger", disabled: locked }
              ] }] : []
            ] };
          }) : [{ type: "label", key: "provider-sessions-none", text: providerSessionsLoading ? "Loading provider sessions…" : providerSessionsQuery ? "No matching provider sessions." : "This agent has no saved provider sessions.", color: "muted", padding: 20, wrap: true }] },
          ...providerSessionsCursor ? [{ type: "button", key: "more", text: providerSessionsLoading ? "Loading…" : "Load more", action: "moreProviderSessions", disabled: !!providerSessionAction }] : []
        ] });
      }
      if (authPickerOpen || shownAuth) {
        const methods = live?.authMethods || [];
        const success = shownAuth?.completed && !shownAuth.cancelled && shownAuth.completed.code === 0 && shownAuth.completed.signal == null;
        const authChildren = [
          { type: "label", key: "auth-provider", text: `${providerName} · ${live?.machineId || view.workspace.machineId}`, size: "xs", color: "muted", wrap: true },
          ...shownAuth ? [
            { type: "label", key: "auth-label", text: shownAuth.label, weight: "semibold", wrap: true },
            { type: "label", key: "auth-command", text: shownAuth.display, mono: true, size: "xs", selectable: true, wrap: true, style: { background: "surface", radius: 6, padding: 8 } },
            { type: "label", key: "auth-cwd", text: `Working directory: ${live?.authProcess?.cwd || view.workspace.root}`, size: "xs", color: "muted", wrap: true },
            ...shownAuth.envKeys.length ? [{ type: "label", key: "auth-env", text: `Environment overrides: ${shownAuth.envKeys.join(", ")} (values hidden)`, size: "xs", color: "muted", wrap: true }] : [],
            ...shownAuth.pty ? [{ type: "column", key: "auth-terminal", height: 320, children: [{ type: "terminal", key: "terminal", pty: shownAuth.pty }] }] : [],
            ...!shownAuth.pty && !shownAuth.confirmToken ? [{ type: "column", key: "auth-output", scroll: true, maxHeight: 260, style: { background: "surface", radius: 6, padding: 8 }, children: [
              { type: "label", key: "auth-output-text", text: shownAuth.output || "Waiting for authentication output…", mono: true, size: "xs", selectable: true, wrap: true }
            ] }] : [],
            ...shownAuth.cancelled ? [{ type: "status", key: "auth-cancelled", text: "Authentication cancelled.", level: "warn" }] : [],
            ...shownAuth.completed && !shownAuth.cancelled && !success ? [{ type: "status", key: "auth-failed", text: `Authentication ended with code ${shownAuth.completed.code ?? "unknown"}${shownAuth.completed.signal ? ` (signal ${shownAuth.completed.signal})` : ""}.`, level: "error" }] : [],
            ...shownAuth.confirmToken ? [{ type: "button", key: "launch-auth", text: "Launch authentication", action: "launchAuth", variant: "primary" }] : [],
            ...!shownAuth.completed && !shownAuth.cancelled && !shownAuth.confirmToken ? [
              { type: "textInput", key: shownAuth.inputKey, placeholder: "Type a response and press Enter", submitAction: "authInput", cancelAction: "closeAuth", autoFocus: true, value: "", secret: true, disabled: !!shownAuth.inputPending },
              { type: "row", key: "auth-actions", gap: 8, children: [
                { type: "button", key: "cancel-auth", text: "Cancel authentication", action: "cancelAuth", variant: "danger", disabled: busy === "cancelAuth" },
                { type: "label", key: "auth-input-hint", text: "Input is sent to the agent process on the workspace machine.", size: "xs", color: "muted", grow: true, wrap: true }
              ] }
            ] : [
              { type: "row", key: "auth-done", gap: 8, children: [
                { type: "button", key: "retry-auth", text: "Choose another method", action: "authBack", variant: "ghost" },
                { type: "button", key: "close-auth", text: "Close", action: "closeAuth" }
              ] }
            ]
          ] : [
            { type: "label", key: "auth-intro", text: "Choose how to sign in. Terminal methods run the configured agent invocation; other methods are handled by the agent.", color: "muted", wrap: true },
            { type: "column", key: "auth-methods", gap: 8, children: methods.length ? methods.map((method) => ({ type: "column", key: method.id, gap: 3, children: [
              { type: "button", key: "choose", text: method.name || method.id, action: "authenticate:" + method.id, disabled: !!active?.busy || !!busy, style: chatStyle.control },
              ...method.description ? [{ type: "label", key: "description", text: method.description, size: "xs", color: "muted", wrap: true }] : [],
              { type: "label", key: "kind", text: terminalMethod(method) ? "Terminal login" : "Agent-driven login", size: "xs", color: "muted" }
            ] })) : [{ type: "label", key: "auth-none", text: "This agent has not advertised any authentication methods.", color: "muted" }] }
          ]
        ];
        kids.push({ type: "modal", key: "authentication-modal", title: shownAuth ? "Agent authentication" : "Authenticate agent", closeAction: "closeAuth", width: 620, children: authChildren });
      }
    } else if (ws && view) kids.push({ type: "column", key: "empty", padding: 24, gap: 12, grow: true, children: [
      { type: "label", key: "title", text: view.profiles.length ? "Start a conversation" : "Choose your AI provider", size: "lg", weight: "bold" },
      { type: "label", key: "hint", text: view.profiles.length ? "Ask your agent to build, explore or fix something in this workspace." : "Install Claude, Codex or another provider from Marketplace to start chatting.", wrap: true, color: "muted" },
      { type: "button", key: "start", text: view.profiles.length ? "New chat" : "Browse providers", iconSvg: uiIcons.plus, action: "newChat", style: chatStyle.primary, variant: "primary" }
    ] });
    return scopeTree({ type: "column", key: "ai-root", style: chatStyle.root, gap: 0, grow: true, children: kids });
  },
  async onEvent(ctx, ev) {
    const eventOrigin = origin, owner = crypto.randomUUID();
    const ownBusy = (value) => {
      if (value === null) {
        if (busyOwner === owner) {
          busy = null;
          busyOwner = null;
        }
      } else {
        busy = value;
        busyOwner = owner;
      }
    };
    if (ev.action === "requestDeleteChat") {
      const chat = view?.conversations.find((c) => c.id === ev.value);
      if (!ws || !chat || busy || chatWorking(chat.status)) return;
      deleteChat = { id: chat.id, workspaceId: ws.id, background: !!background };
      ctx.ui.invalidate();
      return;
    }
    if (ev.action === "cancelDeleteChat") {
      deleteChat = null;
      ctx.ui.invalidate();
      return;
    }
    if (ev.action === "confirmDeleteChat") {
      const target = deleteChat;
      if (!target || target.workspaceId !== ws?.id || target.background !== !!background || busy) return;
      ownBusy("deleteChat");
      ctx.ui.invalidate();
      try {
        if (target.background) {
          const page = await persistent(ctx, "view", { id: target.id, limit: 1 });
          if (chatWorking(page.session.status)) throw new Error("Finish or stop this chat before deleting it");
          await persistent(ctx, "remove", { id: target.id });
          if (ws?.id === target.workspaceId) {
            backgroundSessions = backgroundSessions.filter((s) => s.id !== target.id);
            if (background?.id === target.id) {
              leaveBackground(ctx);
              await ctx.modules.call("workspace", "view.patch", { workspaceId: target.workspaceId, patch: { ui: { aiBackgroundSession: null } } });
            }
          }
          backgroundDrafts.delete(target.id);
        } else await ctx.modules.call("ai-sessions", "remove", { workspaceId: target.workspaceId, conversationId: target.id });
        if (ws?.id === target.workspaceId) {
          connectionAttempts.delete(target.id);
          deleteChat = null;
          await load(ctx);
          historyOpen = true;
        }
      } catch (e) {
        if (ws?.id === target.workspaceId) error = errMsg(e);
      } finally {
        if (busy === "deleteChat") ownBusy(null);
        ctx.ui.invalidate();
      }
      return;
    }
    if (ev.action === "openHistory") {
      historyOpen = true;
      historyQuery = "";
      if (background) {
        try {
          backgroundSessions = await persistent(ctx, "list");
          await load(ctx);
        } catch (e) {
          error = errMsg(e);
        }
      }
      ctx.ui.invalidate();
      return;
    }
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
          if (eventOrigin === origin) error = "Could not save input height: " + errMsg(e);
        }
      }
      ctx.ui.invalidate();
      return;
    }
    if (ev.action === "draftChanged") {
      draft = String(ev.value || "");
      slashDismissed = false;
      ctx.ui.invalidate();
      return;
    }
    if (ev.action === "dismissCommands") {
      slashDismissed = true;
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
      ownBusy("updateRuntime");
      error = null;
      ctx.ui.invalidate();
      try {
        const r = await persistent(ctx, "updateRuntime", { workspaceId: ws.id });
        if (r?.failed?.length) error = "Runtime updated, but these agents did not reconnect: " + r.failed.map((f) => `${f.name} (${f.error})`).join(", ");
      } catch (e) {
        error = errMsg(e);
      } finally {
        ownBusy(null);
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
      ownBusy("newChat");
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
        const source = background && backgroundPage ? backgroundPage.session : view?.active?.live;
        const modelLabel = config.model ? modelChoices(source || {}).find((m) => m.id === config.model)?.label || config.model : "";
        const providerName = providerLabel(catalog.profiles.find((p) => p.id === profileId));
        const name = (modelLabel ? `${providerName}/${modelLabel}` : providerName).slice(0, 120);
        const session = await persistent(ctx, "create", { profileId, name, autoName: true, ...config });
        if (ws?.id === workspaceId) await openBackground(ctx, { workspaceId, id: session.id });
      } catch (e) {
        if (eventOrigin === origin) error = errMsg(e);
      } finally {
        ownBusy(null);
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
    ].includes(ev.action) || ev.action.startsWith("setConfig:") || ev.action.startsWith("toggleMcp:") || ev.action.startsWith("toggleSkill:");
    if (background && backgroundAction) {
      const selection = background;
      let actionError = null;
      try {
        if (ev.action === "send") {
          const text = (ev.inputs.prompt || draft || "").trim();
          if (!text && !attachments.length || busy === "send") return;
          ownBusy("send");
          ctx.ui.invalidate();
          await persistent(ctx, "send", { text, steer: !!view?.active?.busy, ...attachments.length ? { images: attachments } : {} });
          if (eventOrigin !== origin) return;
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
        else if (ev.action.startsWith("toggleSkill:")) {
          const path = ev.action.slice("toggleSkill:".length), current = new Set(backgroundPage?.session.skills || []);
          if (ev.value) current.add(path);
          else current.delete(path);
          ownBusy("skills");
          ctx.ui.invalidate();
          await updateBackground(ctx, { skills: [...current] });
        } else if (ev.action.startsWith("toggleMcp:")) {
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
        ownBusy(null);
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
    const eventLive = view?.active?.live;
    const shownAuth = authConsole && authConsole.conversationId === conv?.id ? authConsole : eventLive?.authProcess ? {
      conversationId: conv.id,
      methodId: eventLive.authProcess.methodId,
      label: eventLive.authProcess.label,
      display: [eventLive.authProcess.command, ...eventLive.authProcess.args.map((arg) => JSON.stringify(arg))].join(" "),
      attemptId: eventLive.authProcess.attemptId,
      pty: eventLive.authProcess.handle,
      envKeys: eventLive.authProcess.envKeys || [],
      output: "",
      uiKey: `auth-${conv.id}-${eventLive.authProcess.methodId}-${eventLive.authProcess.startedAt || 0}`,
      inputKey: `auth-${conv.id}-${eventLive.authProcess.methodId}-${eventLive.authProcess.startedAt || 0}-0`
    } : null;
    try {
      if (ev.action.startsWith("elicitationField:")) {
        const [, uiKey, token] = ev.action.split(":"), pending = pendingByUiKey(uiKey);
        const index = /^f(\d+)$/.test(token) ? Number(token.slice(1)) : -1, entry = Object.entries(pending?.schema.properties || {})[index];
        if (!pending || !entry || pending.submitting) return;
        const [key, property] = entry;
        pending.values[key] = property.type === "boolean" ? !!ev.value : String(ev.value ?? "");
        delete pending.errors[key];
        delete pending.errors._schema;
        ctx.ui.invalidate();
        return;
      }
      if (ev.action.startsWith("elicitationArray:")) {
        const [, uiKey, token, optionToken] = ev.action.split(":"), pending = pendingByUiKey(uiKey);
        const index = /^f(\d+)$/.test(token) ? Number(token.slice(1)) : -1, entry = Object.entries(pending?.schema.properties || {})[index];
        const optionIndex = /^o(\d+)$/.test(optionToken || "") ? Number(optionToken.slice(1)) : -1;
        const option = entry ? enumChoices(entry[1].items || {})[optionIndex] : void 0;
        if (!pending || !entry || !option || pending.submitting) return;
        const [key] = entry, current = Array.isArray(pending.values[key]) ? [...pending.values[key]] : [];
        pending.values[key] = ev.value ? [.../* @__PURE__ */ new Set([...current, option.value])] : current.filter((value) => value !== option.value);
        delete pending.errors[key];
        delete pending.errors._schema;
        ctx.ui.invalidate();
        return;
      }
      for (const [verb, responseAction] of [["acceptElicitation", "accept"], ["declineElicitation", "decline"], ["cancelElicitation", "cancel"]]) {
        if (!ev.action.startsWith(verb + ":")) continue;
        const pending = pendingByUiKey(ev.action.slice(verb.length + 1));
        if (!pending || pending.submitting || pending.schemaError) return;
        if (responseAction === "accept") {
          const values = { ...pending.values };
          for (const [index, [key, property]] of Object.entries(pending.schema.properties || {}).entries()) {
            if (property.type === "string" && !Array.isArray(property.enum) && !Array.isArray(property.oneOf) || property.type === "number" || property.type === "integer") {
              const inputKey = `${pending.uiKey}-f${index}`;
              values[key] = String(ev.inputs[inputKey] ?? values[key] ?? "");
            }
          }
          const validated = validateElicitation(pending.schema, values);
          pending.values = values;
          pending.errors = validated.errors;
          if (Object.keys(validated.errors).length) {
            ctx.ui.invalidate();
            return;
          }
          await answerElicitation(ctx, pending, { action: "accept", content: validated.content });
        } else await answerElicitation(ctx, pending, { action: responseAction });
        return;
      }
      if (ev.action === "openProviderSessions") {
        if (!conv || !eventLive?.agentCapabilities?.sessionCapabilities?.list) return;
        invalidateProviderSessions();
        authPickerOpen = false;
        providerSessionsOpen = true;
        providerSessions = [];
        providerSessionsCursor = null;
        providerSessionsQuery = "";
        providerSessionDelete = null;
        ctx.ui.invalidate();
        try {
          await loadProviderSessions(ctx, conv.id);
        } catch (e) {
          if (providerSessionsOpen && providerSessionsConversation === conv.id) error = errMsg(e);
        }
        return;
      }
      if (ev.action === "closeProviderSessions") {
        providerSessionsOpen = false;
        providerSessionDelete = null;
        invalidateProviderSessions();
        ctx.ui.invalidate();
        return;
      }
      if (ev.action === "searchProviderSessions") {
        providerSessionsQuery = String(ev.value || "");
        ctx.ui.invalidate();
        return;
      }
      if (ev.action === "reloadProviderSessions" && conv) {
        if (busy || providerSessionsConversation !== conv.id) return;
        providerSessionsCursor = null;
        try {
          await loadProviderSessions(ctx, conv.id);
        } catch (e) {
          if (providerSessionsOpen && providerSessionsConversation === conv.id) error = errMsg(e);
        }
        return;
      }
      if (ev.action === "moreProviderSessions" && conv) {
        if (busy || providerSessionsConversation !== conv.id) return;
        try {
          await loadProviderSessions(ctx, conv.id, true);
        } catch (e) {
          if (providerSessionsOpen && providerSessionsConversation === conv.id) error = errMsg(e);
        }
        return;
      }
      if (ev.action === "requestDeleteProviderSession") {
        const target = typeof ev.value === "object" && ev.value ? ev.value : null;
        if (target?.conversationId !== conv?.id || typeof target.sessionId !== "string") return;
        providerSessionDelete = { conversationId: target.conversationId, sessionId: target.sessionId };
        ctx.ui.invalidate();
        return;
      }
      if (ev.action === "cancelDeleteProviderSession") {
        providerSessionDelete = null;
        ctx.ui.invalidate();
        return;
      }
      if (["newProviderSession", "resumeProviderSession", "loadProviderSession", "forkProviderSession", "closeProviderSession", "confirmDeleteProviderSession"].includes(ev.action) && conv) {
        if (busy || providerSessionAction || view?.active?.busy || eventLive?.authProcess || eventLive?.authStarting) return;
        const target = typeof ev.value === "object" && ev.value ? ev.value : null;
        if (target && target.conversationId !== conv.id) return;
        const sessionId = ev.action === "confirmDeleteProviderSession" ? providerSessionDelete?.sessionId : target?.sessionId;
        if (ev.action === "confirmDeleteProviderSession" && (target?.sessionId !== providerSessionDelete?.sessionId || !providerSessionDelete || providerSessionDelete.conversationId !== conv.id || !sessionId)) return;
        if (["resumeProviderSession", "loadProviderSession", "forkProviderSession", "closeProviderSession"].includes(ev.action) && typeof sessionId !== "string") return;
        const method = ev.action === "confirmDeleteProviderSession" ? "deleteProviderSession" : ev.action;
        const operation = crypto.randomUUID();
        ownBusy(operation);
        providerSessionAction = ev.action;
        ctx.ui.invalidate();
        try {
          await call(method, { conversationId: conv.id, ...sessionId ? { sessionId } : {} }, 15e4);
          if (view?.active?.conversation?.id !== conv.id) return;
          providerSessionDelete = null;
          await load(ctx);
          if (providerSessionsOpen && providerSessionsConversation === conv.id) {
            providerSessionsCursor = null;
            await loadProviderSessions(ctx, conv.id);
          }
        } finally {
          if (busy === operation) ownBusy(null);
          if (providerSessionAction === ev.action) providerSessionAction = null;
          ctx.ui.invalidate();
        }
        return;
      }
      if (ev.action === "openAuth") {
        if (!conv || !view?.active?.live?.authMethods?.length) return;
        providerSessionsOpen = false;
        invalidateProviderSessions();
        authPickerOpen = true;
        authConsole = null;
        ctx.ui.invalidate();
        return;
      }
      if (ev.action === "authBack") {
        authConsole = null;
        authPickerOpen = true;
        ctx.ui.invalidate();
        return;
      }
      if (ev.action === "closeAuth") {
        const closing = shownAuth;
        authConsole = null;
        authPickerOpen = false;
        if (closing && closing.conversationId === conv?.id && view?.active?.live?.authProcess && !closing.completed && !closing.cancelled) {
          const operation = crypto.randomUUID();
          ownBusy(operation);
          try {
            await call("cancelAuth", { conversationId: closing.conversationId, attemptId: closing.attemptId });
          } finally {
            if (busy === operation) ownBusy(null);
          }
        }
        ctx.ui.invalidate();
        return;
      }
      if ((ev.action.startsWith("authenticate:") || ev.action === "launchAuth") && conv) {
        if (busy || providerSessionAction || view?.active?.busy || view?.active?.live?.authProcess || view?.active?.live?.authStarting) return;
        const methodId = ev.action === "launchAuth" ? shownAuth?.methodId : ev.action.slice("authenticate:".length), method = (view.active.live.authMethods || []).find((entry) => entry?.id === methodId);
        if (!method || !methodId) return;
        const confirmToken = ev.action === "launchAuth" ? shownAuth?.confirmToken : void 0;
        if (ev.action === "launchAuth" && !confirmToken) return;
        const uiKey = "auth-" + crypto.randomUUID(), operation = crypto.randomUUID();
        authConsole = { conversationId: conv.id, methodId, label: method.name || methodId, display: "Preparing authentication…", envKeys: [], output: "", uiKey, inputKey: uiKey + "-input-0" };
        authPickerOpen = false;
        ownBusy(operation);
        ctx.ui.invalidate();
        try {
          const result = await call("authenticate", { conversationId: conv.id, methodId, confirmToken }, 15e4);
          const currentAuth = authConsole;
          if (currentAuth?.uiKey !== uiKey) return;
          if (result?.outcome === "terminal" || result?.outcome === "prepared") {
            currentAuth.confirmToken = result.confirmToken;
            currentAuth.attemptId = result.attemptId;
            currentAuth.pty = result.handle;
            currentAuth.label = result.label || method.name || methodId;
            currentAuth.display = result.display || [result.command, ...(result.args || []).map((arg) => JSON.stringify(arg))].join(" ");
            currentAuth.envKeys = result.envKeys || [];
          } else {
            authConsole = null;
            authPickerOpen = false;
          }
        } catch (e) {
          if (authConsole?.uiKey === uiKey) {
            authConsole.completed = { code: null, signal: null };
            authConsole.output = errMsg(e);
            error = errMsg(e);
          }
        } finally {
          if (busy === operation) ownBusy(null);
          ctx.ui.invalidate();
        }
        return;
      }
      if (ev.action === "authInput" && conv && shownAuth) {
        const currentAuth = authConsole;
        if (!currentAuth || currentAuth.conversationId !== conv.id || currentAuth.inputPending || currentAuth.completed || currentAuth.cancelled) return;
        const data = String(ev.inputs[shownAuth.inputKey] || "");
        if (!data) return;
        const operation = crypto.randomUUID();
        currentAuth.inputPending = true;
        ownBusy(operation);
        ctx.ui.invalidate();
        try {
          await call("authInput", { conversationId: conv.id, data: data + "\n", attemptId: shownAuth.attemptId });
          currentAuth.output = authOutputText(currentAuth.output + `
> ${data.replace(/./g, "•")}
`);
          currentAuth.inputKey = `${currentAuth.uiKey}-input-${Date.now()}`;
        } finally {
          currentAuth.inputPending = false;
          if (busy === operation) ownBusy(null);
          ctx.ui.invalidate();
        }
        return;
      }
      if (ev.action === "cancelAuth" && conv && shownAuth) {
        const currentAuth = authConsole, operation = crypto.randomUUID();
        if (!currentAuth || currentAuth.conversationId !== conv.id) return;
        ownBusy(operation);
        ctx.ui.invalidate();
        try {
          await call("cancelAuth", { conversationId: conv.id, attemptId: shownAuth.attemptId });
        } finally {
          currentAuth.cancelled = true;
          currentAuth.completed = { code: null, signal: null };
          if (busy === operation) ownBusy(null);
          ctx.ui.invalidate();
        }
        return;
      }
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
        const path = String(ev.value || ""), current = ev.inputs.prompt || draft || "";
        if (isLibraryRef(path)) {
          const item = libraryItemsFor(libraryState, ws, "skill").find((i) => i.id === libraryRefId(path));
          if (!item) return;
          draft = `Use the Library skill "${item.name}":

${libraryInstructions(item)}

---
` + current;
        } else {
          const skill = workspaceSkillState?.workspaceId === ws?.id && workspaceSkillState.skills?.find((s) => s.path === path) || background && list(backgroundCatalog?.skills).find((s) => s.path === path);
          if (!skill) return;
          draft = `Use the workspace skill at ${skill.path}.
` + current;
        }
        skillsOpen = false;
        mcpOpen = false;
        ctx.ui.invalidate();
        return;
      }
      if (ev.action.startsWith("toggleTools:")) {
        const id = ev.action.slice("toggleTools:".length), key = toolKey(id);
        if (toolsExpanded.has(key)) toolsExpanded.delete(key);
        else {
          toolsExpanded.add(key);
          if (!toolLists.get(key)?.tools) void loadTools(ctx, id);
        }
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
        if (mcpOpen) {
          ctx.events.emit("ai.skillsRequested", {});
          if (background) void loadCatalog(ctx);
          toolLists.clear();
        }
        ctx.ui.invalidate();
        return;
      }
      if (ev.action === "toggleSettings") {
        settingsOpen = !settingsOpen;
        ctx.ui.invalidate();
        return;
      }
      if (ev.action === "openAdapters") {
        ctx.events.emit("settings.open", { category: JSON.stringify([ctx.moduleId, ADAPTERS_SECTION]) });
        return;
      }
      if (ev.action === "toggleProviderAuth") {
        const p = view?.profiles.find((p2) => p2.id === view?.active?.conversation?.acpProfileId);
        if (p?.authOption) {
          await ctx.modules.call("acp", "setAuthSettings", { [p.authOption.field]: !!ev.value });
          await load(ctx);
        }
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
      } else if (ev.action === "chooseCommand" && conv) {
        const command = (view?.active?.live?.commands || []).find((entry) => entry.name === ev.value);
        if (command) {
          draft = applySlashCommand(ev.inputs.prompt || draft || "", command);
          slashDismissed = true;
          ctx.ui.invalidate();
        }
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
        ownBusy("connect");
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
        ownBusy("send");
        ctx.ui.invalidate();
        await call("send", { conversationId: conv.id, text, images: attachments }, 6e5);
        if (eventOrigin !== origin) return;
        attachments = [];
        draft = draft === "" ? " " : "";
        ctx.ui.invalidate();
      }
      if (eventOrigin === origin) error = null;
    } catch (e) {
      if (eventOrigin === origin) error = errMsg(e);
    } finally {
      if (!["loadOlder", "olderMessages", "newerMessages", "latestMessages", "revealOlder", "revealNewer", "collapseHistory"].includes(ev.action)) ownBusy(null);
      if (eventOrigin === origin) await load(ctx);
    }
  }
};
var handleEvent = mod.onEvent;
mod.onEvent = (ctx, event) => {
  syncOrigin();
  const native = event.action.startsWith("origin:");
  if (native) {
    const [, token, ...action] = event.action.split(":");
    if (token !== origin) return;
    event = { ...event, action: action.join(":") };
  } else if (event.key && !liveInputKeys.has(event.key)) return;
  const eventOrigin = origin;
  if (["selectConv", "backToChats", "newChat"].includes(event.action)) {
    loadGeneration++;
    origin = crypto.randomUUID();
  }
  pendingEvents++;
  const task = Promise.resolve(handleEvent(ctx, event)).finally(() => {
    pendingEvents--;
  });
  if (native) {
    void task.catch((e) => {
      if (eventOrigin === origin) {
        error = errMsg(e);
        ctx.ui.invalidate();
      }
    });
    return;
  }
  return task;
};
var index_default = mod;
export {
  index_default as default
};
