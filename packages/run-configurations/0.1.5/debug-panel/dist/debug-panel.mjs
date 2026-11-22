// ../sdk/debug.ts
var DEBUG_EVENTS = {
  /** {workspaceId, sessions: DebugSessionInfo[]} on session state changes. */
  changed: "debug.changed",
  /** {workspaceId, breakpoints: Breakpoint[], exceptions: ExceptionBreakpoints} when the set changes. */
  breakpoints: "debug.breakpoints"
};
var DEBUG_UI_EVENTS = {
  /** Focus a frame in the editor: {workspaceId, id, conn, frameId, path, line}. Published by the Debug panel. */
  focusFrame: "debug-panel.focusFrame"
};

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

// ../sdk/debug-values.ts
var icon = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
var valueIcons = {
  primitive: icon("<circle cx='12' cy='12' r='3.2' fill='currentColor'/>"),
  string: icon("<path d='M7 7h4v4c0 3-1.5 5-4 6M14 7h4v4c0 3-1.5 5-4 6'/>"),
  array: icon("<path d='M8 4H5v16h3M16 4h3v16h-3'/>"),
  map: icon("<path d='M8 4c-2 0-3 1-3 3v2.5c0 1.5-1 2.5-2 2.5 1 0 2 1 2 2.5V17c0 2 1 3 3 3M16 4c2 0 3 1 3 3v2.5c0 1.5 1 2.5 2 2.5-1 0-2 1-2 2.5V17c0 2-1 3-3 3'/>"),
  object: icon("<rect x='4.5' y='4.5' width='15' height='15' rx='3'/><path d='M9 10h6M9 14h4'/>"),
  date: icon("<rect x='4' y='5.5' width='16' height='14' rx='2'/><path d='M4 10h16M8 3.5v4M16 3.5v4'/>"),
  enumeration: icon("<path d='M5 7h3M5 12h3M5 17h3M11 7h8M11 12h8M11 17h8'/>"),
  fn: icon("<path d='M14 4c-3 0-3.5 2-4 5l-1.5 7c-.5 2.5-1.5 4-4 4M7 10h8'/>"),
  error: icon("<path d='M12 3.5 21 19.5H3z'/><path d='M12 10v4M12 17v.2'/>"),
  promise: icon("<circle cx='12' cy='12' r='8'/><path d='M12 7.5V12l3 2'/>"),
  virtual: icon("<path d='M5 12h14' stroke-dasharray='2 3'/>")
};
var STRING_MAX = 120;
var JAVA_BOXED = /* @__PURE__ */ new Set(["Integer", "Long", "Short", "Byte", "Double", "Float", "Character", "Boolean", "BigDecimal", "BigInteger", "AtomicInteger", "AtomicLong", "AtomicBoolean"]);
var JAVA_DATES = /^(Instant|LocalDate|LocalDateTime|LocalTime|ZonedDateTime|OffsetDateTime|OffsetTime|Date|Timestamp|Calendar|GregorianCalendar|Duration|Period)$/;
var MAP_TYPES = /(Map|Dictionary|Properties|Hashtable|Record)$/;
var SET_TYPES = /Set$/;
var LIST_TYPES = /(List|Collection|Queue|Deque|Vector|Stack|Iterable|Array|Buffer)$|\[\]$/;
function shortType(type) {
  if (!type) return void 0;
  const t = type.trim();
  const lt = t.indexOf("<");
  const base = (lt < 0 ? t : t.slice(0, lt)).split(/[.$]/).pop() || t;
  if (lt < 0) return base;
  const body = t.slice(lt + 1, t.lastIndexOf(">"));
  const args = [];
  let depth = 0, from = 0;
  for (let i = 0; i <= body.length; i++) {
    const c = body[i];
    if (c === "<") depth++;
    else if (c === ">") depth--;
    else if (c === "," && depth === 0 || i === body.length) {
      args.push(body.slice(from, i).trim());
      from = i + 1;
    }
  }
  const short = args.map((a) => {
    const g = a.indexOf("<");
    const n = (g < 0 ? a : a.slice(0, g)).split(/[.$]/).pop() || "?";
    return g < 0 ? n : `${n}<…>`;
  });
  const inner = short.join(",");
  return `${base}<${inner.length > 24 ? short[0] + ",…" : inner}>`;
}
function sizeOf(v) {
  const m = /\bsize=(\d+)/.exec(v.value) || /^[\w$.]*(?:Array|Map|Set|List)\((\d+)\)/.exec(v.value) || /\[(\d+)\]$/.exec(v.value) || /^[\w$.]+\[(\d+)\]/.exec(v.value);
  if (m) return Number(m[1]);
  return v.indexedVariables && v.indexedVariables > 0 ? v.indexedVariables : void 0;
}
function escapeString(s) {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t").replace(/[\u0000-\u001f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
function clip(s, max = STRING_MAX) {
  return s.length > max ? [s.slice(0, max - 1) + "…", true] : [s, false];
}
function unquote(value) {
  const q = value[0];
  if ((q === '"' || q === "'" || q === "`") && value.length >= 2 && value.endsWith(q)) return value.slice(1, -1);
  return null;
}
function relativeTime(text, now = Date.now()) {
  const iso = /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?/.exec(text)?.[0];
  const t = iso ? Date.parse(iso) : Date.parse(text);
  if (!Number.isFinite(t)) return null;
  const d = (t - now) / 1e3, a = Math.abs(d);
  const [n, u] = a < 60 ? [Math.round(a), "s"] : a < 3600 ? [Math.round(a / 60), "min"] : a < 86400 ? [Math.round(a / 3600), "h"] : a < 86400 * 60 ? [Math.round(a / 86400), "d"] : [Math.round(a / (86400 * 30.4)), "mo"];
  if (a < 1) return "now";
  return d < 0 ? `${n} ${u} ago` : `in ${n} ${u}`;
}
function describeValue(v) {
  const raw = v.value ?? "";
  const type = v.type?.trim();
  const badge = shortType(type);
  const base = (badge || "").replace(/<.*$/, "");
  const hint = v.presentationHint;
  const view = (kind, summary, color, iconSvg, extra = {}) => ({ kind, summary, color, badge, truncated: false, iconSvg, ...extra });
  if (hint?.lazy) return view("virtual", "…", "muted", valueIcons.virtual, { badge: badge || "getter" });
  if (hint?.kind === "virtual" || /^\[\[.*\]\]$|^\[\d+…\d+\]$/.test(v.name)) return view("virtual", raw, "muted", valueIcons.virtual);
  if (/^<?(not available|optimized out|unavailable)>?$/i.test(raw) || /^<error/i.test(raw)) return view("unavailable", raw, "muted", valueIcons.virtual);
  const str = unquote(raw);
  if (str !== null || base === "String" || type === "string") {
    const content = str ?? raw.replace(/^String@\d+\s*/, "").replace(/^"(.*)"$/s, "$1");
    const [text2, cut2] = clip(escapeString(content));
    return view("string", `"${text2}"`, "success", valueIcons.string, { truncated: cut2 || content.includes("\n"), size: content.length, badge: badge || "string" });
  }
  if (raw === "null" || raw === "None" || raw === "nil") return view("null", "null", "muted", valueIcons.primitive);
  if (raw === "undefined") return view("undefined", "undefined", "muted", valueIcons.primitive);
  if (raw === "true" || raw === "false") return view("boolean", raw, "primary", valueIcons.primitive, { badge: badge || "boolean" });
  if (/^-?\d+n$/.test(raw)) return view("bigint", raw, "info", valueIcons.primitive, { badge: badge || "bigint" });
  if (/^-?(\d[\d_]*(\.\d+)?([eE][+-]?\d+)?|NaN|Infinity|0x[\da-fA-F]+)[dDfFlL]?$/.test(raw) || type === "number") return view("number", raw, "info", valueIcons.primitive, { badge: badge || "number" });
  if (/^Symbol\(/.test(raw)) return view("symbol", raw, "warning", valueIcons.primitive);
  if (/^\/.+\/[dgimsuyv]*$/.test(raw)) return view("regexp", raw, "warning", valueIcons.primitive, { badge: badge || "RegExp" });
  if (JAVA_BOXED.has(base)) {
    const inner = raw.replace(/^[\w$.]+@[\da-f]+\s*/, "").replace(/^"(.*)"$/, "$1");
    return view(base === "Boolean" || base === "AtomicBoolean" ? "boolean" : "number", inner, base.startsWith("Bool") || base === "AtomicBoolean" ? "primary" : "info", valueIcons.primitive);
  }
  if (/^(ƒ|function\b|async\b|\(.*\)\s*=>|[\w$]+\s*=>)/.test(raw) || type === "function" || /\$\$Lambda|Function$|Supplier$|Consumer$|Runnable$|Callable$/.test(type || "")) {
    const sig = raw.replace(/^ƒ\s*/, "").replace(/\s*\{[\s\S]*$/, "");
    return view("function", clip(`ƒ ${sig}`, 80)[0], "muted", valueIcons.fn, { badge: badge || "function" });
  }
  if (/^class\s/.test(raw)) return view("class", raw.replace(/\s*\{[\s\S]*$/, ""), "muted", valueIcons.object);
  if (/^Promise\b/.test(raw) || base === "Promise" || /Future$/.test(base)) {
    const state = /<(pending|fulfilled|rejected)>|\b(pending|fulfilled|rejected|resolved|completed)\b/i.exec(raw);
    const s = (state?.[1] || state?.[2] || "").toLowerCase();
    return view("promise", s ? `${base || "Promise"} · ${s}` : raw, s === "rejected" ? "danger" : s ? "success" : "warning", valueIcons.promise);
  }
  if (/(Error|Exception|Throwable)$/.test(base) || /^[\w$.]*(Error|Exception)\b[:@]/.test(raw)) {
    const msg = raw.split("\n")[0].replace(/^[\w$.]+@[\da-f]+\s*/, "");
    return view("error", clip(msg, 100)[0], "danger", valueIcons.error, { truncated: raw.includes("\n") });
  }
  if (JAVA_DATES.test(base) || /^Date\b/.test(raw)) {
    const text2 = raw.replace(/^[\w$.]+@[\da-f]+\s*/, "").replace(/^Date\s+/, "").replace(/^"(.*)"$/, "$1");
    const rel = relativeTime(text2);
    return view("date", rel ? `${text2}  ·  ${rel}` : text2, "warning", valueIcons.date);
  }
  if (hint?.kind === "enum" || /\bEnum\b/.test(type || "") || /^[A-Z][A-Z0-9_]+$/.test(raw) && !!type && !/^(int|long|char)$/.test(type)) {
    return view("enum", raw.replace(/^[\w$.]+@[\da-f]+\s*/, ""), "warning", valueIcons.enumeration);
  }
  const size = sizeOf(v);
  const sized = (kind, iconSvg, color = "default") => view(kind, size !== void 0 ? size === 0 ? "empty" : `size ${size}` : raw.replace(/^[\w$.]+@[\da-f]+\s*/, "") || raw, size === 0 ? "muted" : color, iconSvg, { size });
  if (MAP_TYPES.test(base) || /^Map\(/.test(raw)) return sized("map", valueIcons.map);
  if (SET_TYPES.test(base) || /^Set\(/.test(raw)) return sized("set", valueIcons.array);
  if (LIST_TYPES.test(base) || /^(Array|\w+Array)\(\d+\)/.test(raw) || /\[\d+\]$/.test(raw)) return sized("array", valueIcons.array);
  if (v.indexedVariables && v.indexedVariables > 0) return sized("collection", valueIcons.array);
  const preview = raw.replace(/^[\w$.]+@[\da-f]+\s*/, "").trim();
  const [text, cut] = clip(preview && preview !== base ? preview : raw || base, 100);
  return view(v.variablesReference > 0 ? "object" : "unavailable", text, "default", valueIcons.object, { truncated: cut });
}
var VALUE_PAGE = 100;
var childKey = (r) => r.start === void 0 ? `${r.variablesReference}` : `${r.variablesReference}:${r.start}:${r.count}`;
var valueIdentity = (v, key) => v.evaluateName || key.replace(/^[^/]*\//, "");
function row(v, key, depth, open, o) {
  const d = describeValue(v);
  const prev = o.previous?.get(valueIdentity(v, key));
  const changed = prev !== void 0 && prev !== v.value;
  const readOnly = v.presentationHint?.attributes?.includes("readOnly");
  const badges = [];
  if (changed) badges.push({ text: "changed", color: "warning" });
  if (d.kind === "string" && d.size !== void 0 && d.size > 40) badges.push({ text: `${d.size} chars`, color: "muted" });
  const tooltip = [`${v.type ? `${v.type} ` : ""}${v.name}`, changed ? `was ${prev}` : "", readOnly ? "read-only" : "", d.truncated ? `${v.value.slice(0, 400)}${v.value.length > 400 ? "…" : ""}
(right-click to copy the full value)` : ""].filter(Boolean).join("\n");
  return {
    key,
    label: v.name,
    value: d.summary,
    valueColor: changed ? "warning" : d.color,
    badge: d.badge,
    badges: badges.length ? badges : void 0,
    iconSvg: d.iconSvg,
    iconColor: changed ? "warning" : d.color === "default" ? "muted" : d.color,
    depth,
    expandable: v.variablesReference > 0,
    expanded: open,
    selected: false,
    weight: v.presentationHint?.visibility === "private" || d.kind === "virtual" ? void 0 : depth === 0 ? "medium" : void 0,
    tooltip: tooltip.slice(0, 500),
    contextMenu: [
      { text: "Copy value", action: "", copyText: v.value },
      ...v.evaluateName ? [{ text: "Copy expression", action: "", copyText: v.evaluateName }] : [],
      ...o.menu ? o.menu(v, key) : []
    ]
  };
}
function valueTreeRows(range, prefix, depth, o, out = [], indexed = 0) {
  const max = o.maxRows ?? 2e3;
  if (out.length >= max) return out;
  if (indexed > VALUE_PAGE && range.start === void 0) {
    const named = o.children(childKey(range)) || [];
    const seen2 = /* @__PURE__ */ new Set();
    for (const v of named.filter((x) => !/^\d+$/.test(x.name))) pushVar(v, prefix, depth, o, out, seen2);
    for (let start = 0; start < indexed && out.length < max; start += VALUE_PAGE) {
      const count = Math.min(VALUE_PAGE, indexed - start);
      const key = `${prefix}/[${start}]`;
      const page = { variablesReference: range.variablesReference, start, count, filter: "indexed" };
      o.ranges?.set(key, page);
      const open = o.expanded.has(key);
      out.push({ key, label: `[${start}…${start + count - 1}]`, depth, expandable: true, expanded: open, selected: false, iconSvg: valueIcons.array, iconColor: "muted" });
      if (open) valueTreeRows(page, key, depth + 1, o, out);
    }
    return out;
  }
  const list = o.children(childKey(range));
  if (!list) {
    out.push({ key: `${prefix}/…loading`, label: "Loading…", depth, expandable: false, expanded: false, selected: false, busy: true });
    return out;
  }
  if (!list.length && depth > 0) out.push({ key: `${prefix}/…empty`, label: "No fields", depth, expandable: false, expanded: false, selected: false });
  const seen = /* @__PURE__ */ new Set();
  for (const v of list) {
    if (out.length >= max) break;
    pushVar(v, prefix, depth, o, out, seen);
  }
  if (out.length >= max) out.push({ key: `${prefix}/…more`, label: "Too many rows. Narrow with a watch expression.", depth, expandable: false, expanded: false, selected: false });
  return out;
}
function pushVar(v, prefix, depth, o, out, seen) {
  let key = `${prefix}/${v.name}`;
  for (let n = 2; seen.has(key); n++) key = `${prefix}/${v.name}#${n}`;
  seen.add(key);
  o.vars?.set(key, v);
  const paged = (v.indexedVariables || 0) > VALUE_PAGE;
  if (v.variablesReference > 0) o.ranges?.set(key, { variablesReference: v.variablesReference, ...paged ? { filter: "named" } : {} });
  const open = o.expanded.has(key) && v.variablesReference > 0;
  out.push(row(v, key, depth, open, o));
  if (open) valueTreeRows({ variablesReference: v.variablesReference }, key, depth + 1, o, out, v.indexedVariables || 0);
}
function valueSnapshot(vars) {
  const m = /* @__PURE__ */ new Map();
  for (const [key, v] of vars) m.set(valueIdentity(v, key), v.value);
  return m;
}

// modules/ui/debug-panel/src/index.ts
var svg = (body, fill = false) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${fill ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
var icons = {
  resume: svg("<path d='M6 4v16M10 4.5v15l10-7.5z'/>"),
  pause: svg("<path d='M8 5v14M16 5v14'/>"),
  over: svg("<path d='M4 14a8 8 0 0 1 15-4m1-5v5h-5'/><circle cx='12' cy='19' r='1.6' fill='currentColor'/>"),
  into: svg("<path d='M12 3v11m-4-4 4 4 4-4'/><circle cx='12' cy='19.5' r='1.6' fill='currentColor'/>"),
  smart: svg("<path d='M12 3v11m-4-4 4 4 4-4M4 6h3m10 0h3'/><circle cx='12' cy='19.5' r='1.6' fill='currentColor'/>"),
  out: svg("<path d='M12 15V4M8 8l4-4 4 4'/><circle cx='12' cy='19.5' r='1.6' fill='currentColor'/>"),
  drop: svg("<path d='M4 7h16M4 12h10M4 17h6M17 14v6m-3-3 3 3 3-3'/>"),
  stop: svg("<rect x='6' y='6' width='12' height='12' rx='1.5'/>", true),
  thread: svg("<path d='M4 7h16M4 12h16M4 17h10'/>"),
  frame: svg("<path d='M7 5h10v14H7z'/>"),
  paused: svg("<path d='M4 8.5h8V4.5l8 7.5-8 7.5v-4H4z'/>", true),
  watch: svg("<path d='M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z'/><circle cx='12' cy='12' r='3'/>"),
  bp: svg("<circle cx='12' cy='12' r='6.5'/>", true),
  bpOff: svg("<circle cx='12' cy='12' r='6'/>"),
  bug: svg("<path d='M9 7.5V6a3 3 0 0 1 6 0v1.5'/><rect x='7' y='7.5' width='10' height='12' rx='5'/><path d='M12 11v8.5M7 12H3.5M17 12h3.5M7.4 16.5 4 18.5M16.6 16.5l3.4 2M7.6 9 5 6.5M16.4 9 19 6.5'/>")
};
var workspaceId = null;
var sessions = [];
var active = null;
var threads = [];
var frames = [];
var frame = null;
var showLibrary = false;
var scopes = [];
var children = /* @__PURE__ */ new Map();
var expanded = /* @__PURE__ */ new Set();
var rowVars = /* @__PURE__ */ new Map();
var ranges = /* @__PURE__ */ new Map();
var previous = /* @__PURE__ */ new Map();
var watches = [];
var watchValues = /* @__PURE__ */ new Map();
var consoleLines = [];
var history = [];
var breakpoints = [];
var exceptions = { uncaught: true, caught: false };
var tab = "console";
var smartTargets = null;
var busy = false;
var error = null;
var epoch = 0;
var lastStop = "";
var call = (ctx, method, args = {}) => ctx.modules.call("debug", method, { workspaceId, ...args }, { timeoutMs: 6e4 });
var current = () => sessions.find((s) => s.id === active) || sessions.find((s) => s.state !== "ended") || sessions[sessions.length - 1] || null;
async function refresh(ctx) {
  const s = current(), mine = ++epoch;
  if (s?.state !== "paused") {
    frame = null;
    scopes = [];
    children.clear();
    ranges.clear();
  }
  if (!s || s.state === "ended") {
    threads = [];
    frames = [];
    ctx.ui.invalidate();
    return;
  }
  try {
    const nextThreads = await call(ctx, "threads", { id: s.id });
    if (mine !== epoch) return;
    threads = nextThreads;
    if (s.state === "paused" && s.stopped) {
      const stack = await call(ctx, "stack", { id: s.id, conn: s.stopped.conn, threadId: s.stopped.threadId, levels: 60 });
      if (mine !== epoch) return;
      frames = stack;
      const key = `${s.id}:${s.stopped.conn}:${s.stopped.threadId}:${s.stopped.frameId}`;
      if (key !== lastStop || !frame) {
        const sameThread = lastStop.startsWith(`${s.id}:${s.stopped.conn}:${s.stopped.threadId}:`);
        previous = sameThread ? valueSnapshot(rowVars) : /* @__PURE__ */ new Map();
        lastStop = key;
        frame = { conn: s.stopped.conn, id: s.stopped.frameId };
      }
      await loadFrame(ctx, s, mine);
    } else {
      frames = [];
      scopes = [];
      children.clear();
      smartTargets = null;
    }
    if (mine === epoch) error = null;
  } catch (e) {
    if (mine === epoch) error = errMsg(e);
  }
  ctx.ui.invalidate();
}
async function loadFrame(ctx, s, mine = ++epoch) {
  if (!frame) return;
  children.clear();
  ranges.clear();
  scopes = [];
  watchValues.clear();
  const nextScopes = await call(ctx, "scopes", { id: s.id, conn: frame.conn, frameId: frame.id });
  if (mine !== epoch) return;
  scopes = nextScopes;
  for (const sc of scopes) {
    if (mine !== epoch) return;
    const key = `scope:${sc.name}`;
    if (!sc.expensive) expanded.add(key);
    if (expanded.has(key)) await loadChildren(ctx, s, { variablesReference: sc.variablesReference }, mine);
  }
  await evaluateWatches(ctx, s, mine);
  await restoreExpanded(ctx, s, mine);
}
async function loadChildren(ctx, s, range, mine = epoch) {
  const key = childKey(range);
  if (mine !== epoch || children.has(key) || !frame) return;
  const { variablesReference, start, count, filter } = range;
  const list = await call(ctx, "variables", {
    id: s.id,
    conn: frame.conn,
    variablesReference,
    ...filter ? { filter } : {},
    ...start !== void 0 ? { start, count } : {}
  });
  if (mine === epoch) children.set(key, list);
}
async function restoreExpanded(ctx, s, mine) {
  for (let pass = 0; pass < 8 && mine === epoch; pass++) {
    variablesTree();
    const missing = [...expanded].map((k) => ranges.get(k)).filter((r) => !!r && !children.has(childKey(r)));
    if (!missing.length) return;
    await Promise.all(missing.map((r) => loadChildren(ctx, s, r, mine).catch(() => {
      if (mine === epoch) children.set(childKey(r), []);
    })));
  }
}
async function evaluateWatches(ctx, s, mine = epoch) {
  if (mine !== epoch) return;
  watchValues.clear();
  for (const w of watches) {
    if (mine !== epoch) return;
    try {
      const result = await call(ctx, "evaluate", { id: s.id, conn: frame?.conn, frameId: frame?.id, expression: w, context: "watch" });
      if (mine === epoch) watchValues.set(w, result);
    } catch (e) {
      if (mine === epoch) watchValues.set(w, { error: errMsg(e) });
    }
  }
}
var treeOptions = () => ({
  children: (k) => children.get(k),
  expanded,
  ranges,
  vars: rowVars,
  previous,
  menu: (v) => v.evaluateName ? [{ text: "Add to watches", action: "addWatch", value: v.evaluateName }] : []
});
function variablesTree() {
  rowVars.clear();
  ranges.clear();
  const rows = [];
  const o = treeOptions();
  for (const [i, w] of watches.entries()) {
    const r = watchValues.get(w);
    const ok = r && !("error" in r) ? r : null;
    const key = `watch:${i}`;
    const d = ok ? describeValue(ok) : null;
    const childRange = ok?.variablesReference ? {
      variablesReference: ok.variablesReference,
      ...(ok.indexedVariables || 0) > VALUE_PAGE ? { filter: "named" } : {}
    } : null;
    if (childRange) ranges.set(key, childRange);
    rows.push({
      key,
      label: w,
      value: d ? d.summary : r && "error" in r ? r.error : "",
      valueColor: d ? d.color : "danger",
      badge: d?.badge,
      iconSvg: icons.watch,
      iconColor: ok ? "info" : "muted",
      tooltip: ok ? `${ok.type ? `${ok.type} ` : ""}${w}` : void 0,
      depth: 0,
      expandable: !!ok?.variablesReference,
      expanded: expanded.has(key),
      selected: false,
      contextMenu: [
        ...ok ? [{ text: "Copy value", action: "", copyText: ok.value }] : [],
        { text: "Remove watch", action: "removeWatch", value: i }
      ]
    });
    if (ok && childRange && expanded.has(key)) valueTreeRows(childRange, key, 1, o, rows, ok.indexedVariables || 0);
  }
  for (const sc of scopes) {
    const key = `scope:${sc.name}`;
    ranges.set(key, { variablesReference: sc.variablesReference });
    rows.push({
      key,
      label: sc.name,
      depth: 0,
      expandable: true,
      expanded: expanded.has(key),
      selected: false,
      weight: "semibold",
      tooltip: sc.expensive ? "Expanding this scope can be slow" : void 0
    });
    if (expanded.has(key)) valueTreeRows({ variablesReference: sc.variablesReference }, key, 1, o, rows);
  }
  return rows;
}
function frameTree(s) {
  const rows = [];
  const ordered = [...threads].sort((a, b) => Number(b.stopped) - Number(a.stopped));
  for (const t of ordered.slice(0, 300)) {
    const stopped = s.stopped && s.stopped.conn === t.conn && s.stopped.threadId === t.id;
    rows.push({
      key: `t:${t.conn}:${t.id}`,
      label: t.name,
      depth: 0,
      expandable: !!stopped,
      expanded: !!stopped,
      selected: false,
      iconSvg: stopped ? icons.paused : icons.thread,
      iconColor: stopped ? "warning" : "muted",
      badge: stopped ? s.stopped.reason === "breakpoint" ? "breakpoint" : s.stopped.reason : s.state === "paused" ? "suspended" : "running"
    });
    if (!stopped) continue;
    let hidden = 0;
    for (const f of frames) {
      if (f.library && !showLibrary) {
        hidden++;
        continue;
      }
      rows.push({
        key: `f:${f.conn}:${f.id}`,
        label: f.name,
        value: f.source ? `${f.source}:${f.line + 1}` : "",
        depth: 1,
        expandable: false,
        expanded: false,
        selected: frame?.conn === f.conn && frame?.id === f.id,
        iconSvg: icons.frame,
        iconColor: f.library ? "muted" : "primary",
        tooltip: f.path ? `${f.path}:${f.line + 1}` : "No source available",
        contextMenu: s.supports.restartFrame ? [{ text: "Drop frame (restart from here)", action: "restartFrame", value: f.id }] : void 0
      });
    }
    if (hidden) rows.push({ key: "", label: `${hidden} library frame${hidden === 1 ? "" : "s"} hidden`, depth: 1, expandable: false, expanded: false, selected: false });
  }
  return rows;
}
var tool = (key, icon2, action, tooltip, enabled, extra = {}) => ({ type: "button", key, text: "", iconSvg: icon2, iconSize: 15, action, variant: "ghost", small: true, width: 28, tooltip, disabled: !enabled || busy, style: { paddingX: 0, height: 26, radius: 6 }, ...extra });
function toolbar(s) {
  const paused = s.state === "paused", live = s.state !== "ended";
  const items = [
    paused ? tool("resume", icons.resume, "continue", "Resume (continue to the next breakpoint)", true, { iconColor: "success" }) : tool("pause", icons.pause, "pause", "Pause all threads", live && s.state === "running"),
    tool("over", icons.over, "stepOver", "Step over", paused),
    tool("into", icons.into, "stepInto", "Step into", paused)
  ];
  if (s.supports.stepInTargets) items.push(tool("smart", icons.smart, "smartStep", "Smart step into: choose the call to enter", paused));
  items.push(tool("out", icons.out, "stepOut", "Step out", paused));
  if (s.supports.restartFrame) items.push(tool("drop", icons.drop, "restartFrame", "Drop frame: restart the selected frame", paused && !!frame, { value: frame?.id }));
  items.push({ type: "column", key: "sep", width: 8, children: [] }, tool("stop", icons.stop, "stop", "Stop debugging", live, { iconColor: live ? "danger" : "muted" }));
  const status = s.state === "paused" && s.stopped ? `⏸ ${s.stopped.reason}${s.stopped.path ? ` · ${s.stopped.path.split("/").pop()}:${s.stopped.line + 1}` : ""}${s.stopped.description ? ` · ${s.stopped.description}` : ""}` : s.state === "running" ? "● Running" : s.state === "starting" ? "◌ Starting…" : "Ended";
  items.push(
    { type: "column", key: "gap", grow: true, children: [] },
    { type: "label", key: "status", text: status, size: "xs", color: s.state === "paused" ? "warning" : s.state === "running" ? "success" : "muted", tooltip: status }
  );
  return { type: "row", key: "toolbar", gap: 2, align: "center", style: { paddingX: 6, paddingY: 2, borderBottom: 1, borderColor: "border" }, children: items };
}
function consoleView(s) {
  return { type: "column", key: "console", grow: true, gap: 4, children: [
    { type: "scroll", key: `lines:${consoleLines.length}`, grow: true, style: { paddingX: 6 }, children: consoleLines.length ? consoleLines.slice(-400).map((l, i) => ({
      type: "label",
      key: `c${i}`,
      text: l.kind === "in" ? `› ${l.text}` : l.text,
      mono: true,
      wrap: true,
      selectable: true,
      color: l.kind === "err" ? "danger" : l.kind === "in" ? "muted" : "default",
      style: { fontSize: 12 }
    })) : [{ type: "label", key: "hint", text: s?.state === "paused" ? "Evaluate expressions in the selected frame." : "Pause the program to evaluate expressions.", size: "xs", color: "muted" }] },
    { type: "textInput", key: "repl", placeholder: s?.state === "paused" ? "Expression — Enter to evaluate" : "Available while paused", submitAction: "evaluate", disabled: s?.state !== "paused", style: { font: "mono" } }
  ] };
}
function breakpointsView() {
  const rows = breakpoints.map((b) => ({
    key: b.id,
    label: `${b.path.split("/").pop()}:${b.line + 1}`,
    value: b.logMessage ? `log: ${b.logMessage}` : b.condition ? `if ${b.condition}` : b.hitCondition ? `hits ${b.hitCondition}` : b.path,
    depth: 0,
    expandable: false,
    expanded: false,
    selected: false,
    iconSvg: b.enabled ? icons.bp : icons.bpOff,
    iconColor: b.enabled ? "danger" : "muted",
    tooltip: b.path,
    contextMenu: [{ text: b.enabled ? "Disable" : "Enable", action: "bpEnable", value: !b.enabled }, { text: "Remove", action: "bpRemove" }]
  }));
  return { type: "column", key: "bps", grow: true, gap: 6, children: [
    { type: "row", key: "ex", gap: 12, align: "center", style: { paddingX: 6 }, children: [
      { type: "switch", key: "uncaught", label: "Pause on uncaught exceptions", checked: exceptions.uncaught, action: "exUncaught" },
      { type: "switch", key: "caught", label: "Caught exceptions", checked: exceptions.caught, action: "exCaught" }
    ] },
    rows.length ? { type: "tree", key: "bp-tree", rows, selectAction: "bpOpen", expandAction: "", rowHeight: 26, grow: true, activateAction: "bpOpen" } : { type: "label", key: "none", text: "No breakpoints. Click the editor gutter to add one; right-click for conditions and log messages.", size: "sm", color: "muted", wrap: true, padding: 6 },
    ...breakpoints.length ? [{ type: "button", key: "clear", text: "Remove all", action: "bpRemoveAll", small: true, variant: "ghost", iconSvg: uiIcons.trash }] : []
  ] };
}
var mod = {
  id: "debug-panel",
  moduleApiVersion: 1,
  async activate(ctx, previous2) {
    const load = async () => {
      if (!workspaceId) return;
      const [saved, bps, list] = await Promise.all([
        ctx.modules.call("persistence", "settings.get", { key: `debug-panel.watches.${workspaceId}` }).catch(() => null),
        call(ctx, "breakpointsList").catch(() => null),
        call(ctx, "sessions").catch(() => [])
      ]);
      watches = Array.isArray(saved) ? saved.filter((w) => typeof w === "string").slice(0, 50) : [];
      if (bps) {
        breakpoints = bps.breakpoints || [];
        exceptions = bps.exceptions || exceptions;
      }
      sessions = list || [];
      await refresh(ctx);
    };
    workspaceId = ctx.state.get("workspace.selected")?.id || null;
    if (previous2?.workspaceId === workspaceId) {
      showLibrary = !!previous2.showLibrary;
      tab = previous2.tab === "breakpoints" ? "breakpoints" : "console";
      consoleLines = previous2.consoleLines || [];
      history = previous2.history || [];
    }
    ctx.state.watch("workspace.selected", (v) => {
      if ((v?.id || null) === workspaceId) return;
      ++epoch;
      workspaceId = v?.id || null;
      sessions = [];
      active = null;
      frame = null;
      consoleLines = [];
      expanded.clear();
      children.clear();
      breakpoints = [];
      void load();
    });
    ctx.events.on(DEBUG_EVENTS.changed, (e) => {
      if (e?.workspaceId !== workspaceId) return;
      sessions = e.sessions || [];
      const paused = sessions.find((s) => s.state === "paused");
      if (paused?.stopped && (!frame || `${paused.id}:${paused.stopped.conn}:${paused.stopped.threadId}:${paused.stopped.frameId}` !== lastStop)) {
        active = paused.id;
        ctx.events.emit("debug-panel.reveal", { workspaceId });
      }
      void refresh(ctx);
    });
    ctx.events.on("viewer.debugAddWatch", (e) => {
      if (e?.workspaceId !== workspaceId || typeof e.expression !== "string") return;
      void mod.onEvent(ctx, { action: "addWatch", key: "hover", value: e.expression, inputs: {} });
    });
    ctx.events.on(DEBUG_EVENTS.breakpoints, (e) => {
      if (e?.workspaceId === workspaceId) {
        breakpoints = e.breakpoints || [];
        exceptions = e.exceptions || exceptions;
        ctx.ui.invalidate();
      }
    });
    await load();
  },
  deactivate() {
    ++epoch;
  },
  snapshot: () => ({ workspaceId, showLibrary, tab, consoleLines: consoleLines.slice(-200), history: history.slice(-50) }),
  render() {
    if (!workspaceId) return { type: "label", key: "none", text: "Open a project to debug it.", color: "muted", padding: 12 };
    const s = current();
    const right = { type: "column", key: "right", grow: true, children: [
      { type: "tabStrip", key: "tabs", tabs: [{ key: "console", label: "Console" }, { key: "breakpoints", label: `Breakpoints${breakpoints.length ? ` (${breakpoints.length})` : ""}` }], active: tab, action: "tab" },
      tab === "console" ? consoleView(s) : breakpointsView()
    ] };
    if (!s) return { type: "column", key: "idle", grow: true, children: [
      { type: "label", key: "hint", text: "Nothing is being debugged. Choose a configuration in the Run bar and press Debug, or use Debug in the editor gutter's ▶ menu.", size: "sm", color: "muted", wrap: true, padding: 10 },
      { type: "column", key: "bp", grow: true, children: [breakpointsView()] }
    ] };
    const sessionTabs = sessions.length > 1 ? [{
      type: "tabStrip",
      key: "sessions",
      active: s.id,
      action: "session",
      tabs: sessions.map((x) => ({
        key: x.id,
        label: x.name,
        iconSvg: x.state === "paused" ? icons.paused : icons.bug,
        iconColor: x.state === "paused" ? "warning" : x.state === "ended" ? "muted" : "success",
        tooltip: `${x.name} · ${x.state}`
      }))
    }] : [];
    const smart = smartTargets ? [{
      type: "popover",
      key: "smart",
      width: 320,
      top: 40,
      left: 120,
      closeAction: "smartClose",
      style: { background: "panel", padding: 6, radius: 8, borderWidth: 1, borderColor: "border" },
      children: smartTargets.length ? [{ type: "label", key: "t", text: "Step into which call?", size: "xs", color: "muted" }, ...smartTargets.map((t, i) => ({ type: "button", key: `t${i}`, text: t.label, action: "smartInto", value: t.id, small: true, variant: "ghost", style: { justify: "start", fullWidth: true, font: "mono" } }))] : [{ type: "label", key: "none", text: "No calls on this line to step into.", size: "sm", color: "muted" }]
    }] : [];
    return { type: "column", key: "debug", grow: true, children: [
      ...sessionTabs,
      toolbar(s),
      ...error ? [{ type: "status", key: "error", text: error, level: "error" }] : [],
      { type: "split", key: "body", direction: "horizontal", sizes: [0.3, 0.38, 0.32], grow: true, resizable: true, children: [
        { type: "column", key: "frames", grow: true, children: [
          { type: "row", key: "fh", align: "center", style: { paddingX: 6, paddingY: 2 }, children: [
            { type: "label", key: "t", text: "Threads & frames", size: "xs", weight: "semibold", color: "muted", grow: true },
            { type: "button", key: "lib", text: showLibrary ? "Hide library" : "Show library", action: "toggleLibrary", small: true, variant: "ghost", tooltip: "Show or hide frames without project sources" }
          ] },
          { type: "tree", key: "frame-tree", rows: frameTree(s), selectAction: "selectFrame", expandAction: "", rowHeight: 24, grow: true, activateAction: "selectFrame" }
        ] },
        { type: "column", key: "vars", grow: true, children: [
          { type: "row", key: "vh", gap: 4, align: "center", style: { paddingX: 6, paddingY: 2 }, children: [
            { type: "label", key: "t", text: "Variables", size: "xs", weight: "semibold", color: "muted", grow: true }
          ] },
          { type: "textInput", key: "new-watch", placeholder: "+ Add watch expression", submitAction: "addWatch", prefixSvg: icons.watch, style: { font: "mono" } },
          s.state === "paused" ? { type: "tree", key: "var-tree", rows: variablesTree(), selectAction: "noop", expandAction: "expandVar", rowHeight: 22, grow: true, indent: 14 } : { type: "label", key: "running", text: s.state === "ended" ? "The session has ended." : "Variables appear when the program pauses.", size: "sm", color: "muted", padding: 8 }
        ] },
        right
      ] },
      ...smart
    ] };
  },
  async onEvent(ctx, ev) {
    const s = current();
    const v = ev.value;
    try {
      switch (ev.action) {
        case "tab":
          tab = ev.value === "breakpoints" ? "breakpoints" : "console";
          break;
        case "session":
          active = String(ev.value);
          frame = null;
          await refresh(ctx);
          return;
        case "toggleLibrary":
          showLibrary = !showLibrary;
          break;
        case "continue":
        case "pause":
        case "stepOver":
        case "stepInto":
        case "stepOut":
        case "stop":
          if (!s) return;
          busy = true;
          ctx.ui.invalidate();
          await call(ctx, ev.action, { id: s.id, ...s.stopped ? { conn: s.stopped.conn, threadId: s.stopped.threadId } : {} });
          break;
        case "restartFrame":
          if (s) await call(ctx, "restartFrame", { id: s.id, conn: frame?.conn, frameId: Number.isInteger(v) ? v : frame?.id });
          break;
        case "smartStep":
          if (s) smartTargets = await call(ctx, "stepInTargets", { id: s.id, conn: frame?.conn, frameId: frame?.id });
          break;
        case "smartClose":
          smartTargets = null;
          break;
        case "smartInto":
          smartTargets = null;
          if (s?.stopped) await call(ctx, "stepInto", { id: s.id, conn: s.stopped.conn, threadId: s.stopped.threadId, targetId: Number(v) });
          break;
        case "selectFrame": {
          const m = /^f:(\d+):(\d+)$/.exec(ev.rowKey || "");
          if (!m || !s) return;
          frame = { conn: Number(m[1]), id: Number(m[2]) };
          const f = frames.find((x) => x.conn === frame.conn && x.id === frame.id);
          if (f) ctx.events.emit(DEBUG_UI_EVENTS.focusFrame, { workspaceId, id: s.id, conn: f.conn, frameId: f.id, path: f.path, line: f.line });
          await loadFrame(ctx, s);
          break;
        }
        case "expandVar": {
          const key = ev.rowKey || "";
          if (expanded.has(key)) {
            expanded.delete(key);
            break;
          }
          expanded.add(key);
          const range = ranges.get(key);
          if (s && range) {
            ctx.ui.invalidate();
            await loadChildren(ctx, s, range);
          }
          break;
        }
        case "addWatch": {
          const expr = String(typeof v === "string" && v ? v : ev.inputs?.["new-watch"] || "").trim();
          if (!expr || watches.includes(expr) || watches.length >= 50) break;
          watches = [...watches, expr];
          await ctx.modules.call("persistence", "settings.set", { key: `debug-panel.watches.${workspaceId}`, value: watches });
          if (s?.state === "paused") await evaluateWatches(ctx, s);
          break;
        }
        case "removeWatch":
          watches = watches.filter((_, i) => i !== Number(v));
          await ctx.modules.call("persistence", "settings.set", { key: `debug-panel.watches.${workspaceId}`, value: watches });
          break;
        case "evaluate": {
          const expr = String(ev.inputs?.repl || "").trim();
          if (!expr || !s) break;
          history = [...history.filter((h) => h !== expr), expr].slice(-50);
          consoleLines.push({ kind: "in", text: expr });
          try {
            const r = await call(ctx, "evaluate", { id: s.id, conn: frame?.conn, frameId: frame?.id, expression: expr, context: "repl" });
            consoleLines.push({ kind: "out", text: `${r.value}${r.type ? `  (${r.type})` : ""}` });
          } catch (e) {
            consoleLines.push({ kind: "err", text: errMsg(e) });
          }
          consoleLines = consoleLines.slice(-1e3);
          await refresh(ctx);
          return;
        }
        case "exUncaught":
          await call(ctx, "exceptionsSet", { uncaught: !!v });
          break;
        case "exCaught":
          await call(ctx, "exceptionsSet", { caught: !!v });
          break;
        case "bpOpen": {
          const b = breakpoints.find((x) => x.id === ev.rowKey);
          if (b) ctx.events.emit(DEBUG_UI_EVENTS.focusFrame, { workspaceId, path: b.path, line: b.line });
          break;
        }
        case "bpEnable":
          if (ev.rowKey) {
            const b = breakpoints.find((x) => x.id === ev.rowKey);
            if (b) await call(ctx, "breakpointsSet", { breakpointId: b.id, path: b.path, line: b.line, enabled: !!v });
          }
          break;
        case "bpRemove":
          if (ev.rowKey) await call(ctx, "breakpointsRemove", { breakpointId: ev.rowKey });
          break;
        case "bpRemoveAll":
          await call(ctx, "breakpointsRemove", { all: true });
          break;
      }
      error = null;
    } catch (e) {
      error = errMsg(e);
    } finally {
      busy = false;
    }
    ctx.ui.invalidate();
  }
};
var index_default = mod;
export {
  index_default as default
};
