// ../sdk/file-presentation.ts
var FilePresentationClient = class {
  constructor(ctx) {
    this.ctx = ctx;
    this.cache = /* @__PURE__ */ new Map();
    this.queued = /* @__PURE__ */ new Map();
    this.workspace = null;
    this.revision = 0;
    this.busy = false;
    this.stopped = false;
    this.stops = [
      ctx.state.watch("files.presentationRuleCount", () => this.clear()),
      ctx.events.on("files.presentationChanged", () => this.clear()),
      ctx.events.on("files.changed", (event) => {
        if (event.workspaceId === this.workspace) this.clear();
      })
    ];
  }
  get(workspaceId, path, kind = "file") {
    if (this.ctx.state.get("files.presentationRuleCount") === 0) return {};
    if (this.workspace !== workspaceId) {
      this.clear();
      this.workspace = workspaceId;
    }
    const key2 = `${kind}:${path}`;
    const cached = this.cache.get(key2);
    if (cached) return cached;
    this.queued.set(key2, { path, kind });
    if (!this.timer && !this.busy && !this.stopped) this.timer = setTimeout(() => {
      this.timer = void 0;
      void this.flush();
    }, 30);
    return {};
  }
  clear() {
    this.revision++;
    this.cache.clear();
    this.queued.clear();
    this.ctx.ui.invalidate();
  }
  dispose() {
    this.stopped = true;
    this.revision++;
    if (this.timer) clearTimeout(this.timer);
    for (const stop of this.stops) if (typeof stop === "function") stop();
  }
  async flush() {
    if (this.stopped || this.busy || !this.workspace) return;
    this.busy = true;
    const revision = this.revision, workspaceId = this.workspace;
    const batch = [...this.queued.entries()].slice(0, 64);
    for (const [key2] of batch) {
      this.queued.delete(key2);
      this.cache.set(key2, {});
    }
    try {
      const result = await this.ctx.modules.call("files", "presentations", { workspaceId, entries: batch.map(([, entry]) => entry) }, { timeoutMs: 45e3 });
      if (revision === this.revision && !this.stopped) for (const [key2, entry] of batch) this.cache.set(key2, result?.[entry.path] || {});
    } catch {
    } finally {
      this.busy = false;
      if (revision === this.revision && !this.stopped) this.ctx.ui.invalidate();
      if (this.queued.size && !this.stopped) this.timer = setTimeout(() => {
        this.timer = void 0;
        void this.flush();
      }, 30);
    }
  }
};

// ../sdk/file-icons.ts
var fileIcons = {
  "folder": '<svg\n  xmlns="http://www.w3.org/2000/svg"\n  width="24"\n  height="24"\n  viewBox="0 0 24 24"\n  fill="none"\n  stroke="currentColor"\n  stroke-width="1.7"\n  stroke-linecap="round"\n  stroke-linejoin="round"\n>\n  <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />\n</svg>',
  "folderOpen": '<svg\n  xmlns="http://www.w3.org/2000/svg"\n  width="24"\n  height="24"\n  viewBox="0 0 24 24"\n  fill="none"\n  stroke="currentColor"\n  stroke-width="1.7"\n  stroke-linecap="round"\n  stroke-linejoin="round"\n>\n  <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />\n</svg>',
  "file": '<svg\n  xmlns="http://www.w3.org/2000/svg"\n  width="24"\n  height="24"\n  viewBox="0 0 24 24"\n  fill="none"\n  stroke="currentColor"\n  stroke-width="1.7"\n  stroke-linecap="round"\n  stroke-linejoin="round"\n>\n  <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />\n  <path d="M14 2v5a1 1 0 0 0 1 1h5" />\n</svg>',
  "text": '<svg\n  xmlns="http://www.w3.org/2000/svg"\n  width="24"\n  height="24"\n  viewBox="0 0 24 24"\n  fill="none"\n  stroke="currentColor"\n  stroke-width="1.7"\n  stroke-linecap="round"\n  stroke-linejoin="round"\n>\n  <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />\n  <path d="M14 2v5a1 1 0 0 0 1 1h5" />\n  <path d="M10 9H8" />\n  <path d="M16 13H8" />\n  <path d="M16 17H8" />\n</svg>',
  "code": '<svg\n  xmlns="http://www.w3.org/2000/svg"\n  width="24"\n  height="24"\n  viewBox="0 0 24 24"\n  fill="none"\n  stroke="currentColor"\n  stroke-width="1.7"\n  stroke-linecap="round"\n  stroke-linejoin="round"\n>\n  <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />\n  <path d="M14 2v5a1 1 0 0 0 1 1h5" />\n  <path d="M10 12.5 8 15l2 2.5" />\n  <path d="m14 12.5 2 2.5-2 2.5" />\n</svg>',
  "config": '<svg\n  xmlns="http://www.w3.org/2000/svg"\n  width="24"\n  height="24"\n  viewBox="0 0 24 24"\n  fill="none"\n  stroke="currentColor"\n  stroke-width="1.7"\n  stroke-linecap="round"\n  stroke-linejoin="round"\n>\n  <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />\n  <path d="M14 2v5a1 1 0 0 0 1 1h5" />\n  <path d="M10 12a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1 1 1 0 0 1 1 1v1a1 1 0 0 0 1 1" />\n  <path d="M14 18a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1 1 1 0 0 1-1-1v-1a1 1 0 0 0-1-1" />\n</svg>',
  "image": '<svg\n  xmlns="http://www.w3.org/2000/svg"\n  width="24"\n  height="24"\n  viewBox="0 0 24 24"\n  fill="none"\n  stroke="currentColor"\n  stroke-width="1.7"\n  stroke-linecap="round"\n  stroke-linejoin="round"\n>\n  <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />\n  <path d="M14 2v5a1 1 0 0 0 1 1h5" />\n  <circle cx="10" cy="12" r="2" />\n  <path d="m20 17-1.296-1.296a2.41 2.41 0 0 0-3.408 0L9 22" />\n</svg>',
  "archive": '<svg\n  xmlns="http://www.w3.org/2000/svg"\n  width="24"\n  height="24"\n  viewBox="0 0 24 24"\n  fill="none"\n  stroke="currentColor"\n  stroke-width="1.7"\n  stroke-linecap="round"\n  stroke-linejoin="round"\n>\n  <path d="M13.659 22H18a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v11.5" />\n  <path d="M14 2v5a1 1 0 0 0 1 1h5" />\n  <path d="M8 12v-1" />\n  <path d="M8 18v-2" />\n  <path d="M8 7V6" />\n  <circle cx="8" cy="20" r="2" />\n</svg>',
  "link": '<svg\n  xmlns="http://www.w3.org/2000/svg"\n  width="24"\n  height="24"\n  viewBox="0 0 24 24"\n  fill="none"\n  stroke="currentColor"\n  stroke-width="1.7"\n  stroke-linecap="round"\n  stroke-linejoin="round"\n>\n  <path d="M4 11V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h7" />\n  <path d="M14 2v5a1 1 0 0 0 1 1h5" />\n  <path d="m10 18 3-3-3-3" />\n</svg>'
};

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
        else if (field.type === "toggle" ? typeof edit.value !== "boolean" : typeof edit.value !== "string" || field.type === "select" && !field.options.some((o) => o.value === edit.value)) {
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

// ../sdk/typography.ts
var fontOptions = [
  { value: "JetBrains Mono", label: "JetBrains Mono" },
  { value: "system", label: "System font" },
  { value: "Menlo", label: "Menlo" },
  { value: "Monaco", label: "Monaco" }
];

// ../sdk/runtime.ts
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

// ../sdk/git.ts
var DIFF_TAB_PREFIX = "git-diff:";
var diffTabPath = (tab) => tab && tab.startsWith(DIFF_TAB_PREFIX) ? tab.slice(DIFF_TAB_PREFIX.length) : null;

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

// ../sdk/languages.ts
function languageDefinitions(plugins) {
  const result = [];
  for (const plugin of [...plugins].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!plugin.enabled || !plugin.active) continue;
    const contributions = plugin.contributes?.languages;
    if (!Array.isArray(contributions)) continue;
    for (const lang of contributions) {
      if (!lang || typeof lang.id !== "string" || typeof lang.grammar !== "string" || typeof lang.name !== "string") continue;
      const extensions = Array.isArray(lang.extensions) ? lang.extensions.filter((v) => typeof v === "string" && v.length) : [];
      const filenames = Array.isArray(lang.filenames) ? lang.filenames.filter((v) => typeof v === "string" && v.length) : [];
      if (!extensions.length && !filenames.length) continue;
      const server = lang.server;
      const validServer = server && typeof server.id === "string" && typeof server.executable === "string" && Array.isArray(server.args) && server.args.every((v) => typeof v === "string") && typeof server.installHint === "string";
      result.push({ ...lang, extensions, filenames, server: validServer ? server : void 0, pluginId: plugin.id });
    }
  }
  return result;
}
function languageForPath(languages2, path) {
  const name = path.replace(/\\/g, "/").split("/").pop().toLowerCase();
  return languages2.find((l) => l.filenames?.some((n) => n.toLowerCase() === name)) || languages2.find((l) => l.extensions?.some((ext) => name.endsWith("." + ext.toLowerCase()))) || null;
}
function relativeFile(path) {
  if (!path || /^[\\/]|^[a-z]:/i.test(path) || path.includes("\0")) throw new Error("Expected a workspace-relative file");
  const parts = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (part === "..") {
      if (!parts.length) throw new Error("File escapes the workspace");
      parts.pop();
    } else if (part && part !== ".") parts.push(part);
  }
  if (!parts.length) throw new Error("Expected a file");
  return parts.join("/");
}
function workspacePath(root, uri) {
  const match = /^file:\/\/(?:localhost)?(\/[^?#]*)$/i.exec(uri);
  if (!match) return null;
  let path;
  try {
    path = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  const base = root.replace(/\\/g, "/").replace(/\/+$/, "");
  if (/^[a-z]:\//i.test(base) && /^\/[a-z]:\//i.test(path)) path = path.slice(1);
  if (!path.startsWith(base + "/")) return null;
  try {
    return relativeFile(path.slice(base.length + 1));
  } catch {
    return null;
  }
}
function validPosition(p) {
  return p && Number.isInteger(p.line) && p.line >= 0 && Number.isInteger(p.character) && p.character >= 0;
}

// modules/ui/viewer/src/markdown.ts
function shellBlocks(text) {
  const blocks = [];
  let fence = null;
  let offset = 0;
  for (const line of text.split(/(?<=\n)/)) {
    const body = line.replace(/\r?\n$/, "");
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(body);
      if (close && close[1][0] === fence.mark && close[1].length >= fence.length) {
        if (["sh", "shell", "bash", "zsh"].includes(fence.language)) blocks.push({
          start: fence.start,
          end: offset + line.length,
          language: fence.language,
          code: text.slice(fence.body, offset).split("\n").map((line2) => line2.replace(new RegExp(`^ {0,${fence.indent}}`), "")).join("\n")
        });
        fence = null;
      }
    } else {
      const open = /^( {0,3})(`{3,}|~{3,})([^\r\n]*)$/.exec(body);
      if (open && !(open[2][0] === "`" && open[3].includes("`"))) fence = { start: offset, body: offset + line.length, mark: open[2][0], length: open[2].length, language: open[3].trim().split(/\s+/)[0].toLowerCase(), indent: open[1].length };
    }
    offset += line.length;
  }
  return blocks;
}

// modules/ui/viewer/src/assist.ts
var KIND_ICONS = {
  2: ["m", "#e0675c"],
  3: ["m", "#e0675c"],
  4: ["m", "#e0675c"],
  // method, function, constructor
  5: ["f", "#e39b38"],
  10: ["f", "#e39b38"],
  // field, property
  6: ["v", "#8a94a6"],
  7: ["c", "#4a8fe0"],
  8: ["i", "#3dab6c"],
  9: ["p", "#8a94a6"],
  13: ["e", "#a77bd6"],
  20: ["e", "#a77bd6"],
  21: ["k", "#a77bd6"],
  22: ["s", "#4a8fe0"],
  14: ["k", "#8a94a6"],
  15: ["t", "#8a94a6"],
  25: ["T", "#4a8fe0"]
};
var utf8 = new TextEncoder();
var utf8Length = (text) => utf8.encode(text).length;
var simpleType = (type) => type.replace(/<.*$/s, "").replace(/\[\]/g, "").trim().split(".").pop() || "";
function declaringType(item) {
  const m = /^([\w$.]+(?:<[^>]*>)?)\.[\w$]+\s*(?:\(|:|$)/.exec(String(item?.detail ?? ""));
  return m ? simpleType(m[1]) : null;
}
function receiverAt(line, character) {
  const before = line.slice(0, character);
  const m = /([\w$]+)\s*(\((?:[^()]|\([^()]*\))*\))?\s*\.\s*[\w$]*$/.exec(before);
  return m ? { name: m[1], character: m.index } : null;
}
function enclosingType(text, offset) {
  let found = null;
  for (const m of text.slice(0, offset).matchAll(/\b(?:class|interface|enum|record)\s+([\w$]+)/g)) found = m[1];
  return found;
}
function hoverType(hover) {
  const code = hoverParts(hover).find((p) => p.code !== void 0)?.code?.trim().replace(/\s+-\s+.*$/s, "");
  if (!code) return null;
  const paren = code.indexOf("(");
  const head = paren >= 0 ? code.slice(0, paren) : code;
  const split = lastTopLevelSpace(head);
  if (split < 0) return null;
  const type = head.slice(0, split).replace(/^(?:(?:public|protected|private|static|final|abstract|default|synchronized)\s+)*/, "");
  return simpleType(type) || null;
}
function shapeCompletions(result, owner, originals, keyOf) {
  const items = Array.isArray(result) ? result : Array.isArray(result?.items) ? result.items : [];
  originals.clear();
  const shaped = items.map((original, index) => {
    const name = String(original.filterText || original.label || "").replace(/\(.*$/s, "").replace(/ [-:] .*$/, "").trim() || String(original.label);
    const params = original.labelDetails?.detail ?? (/^[^(]*(\(.*?\))/.exec(String(original.label))?.[1] || "");
    const typed = / : (.+)$/.exec(String(original.label))?.[1] ?? / : (.+)$/.exec(String(original.detail ?? ""))?.[1];
    const pkg = / - (.+)$/.exec(String(original.label))?.[1];
    const right = original.labelDetails?.description || typed || pkg || (original.detail && String(original.detail).length <= 48 ? original.detail : "");
    const declaring = declaringType(original);
    const own = !!owner && declaring === owner;
    const icon = KIND_ICONS[original.kind];
    const item = {
      ...original,
      label: `${name}${params}`,
      detail: right || void 0,
      filterText: original.filterText || name,
      labelDetails: right ? { description: right } : void 0,
      data: { presentation: { bold: own, mutedFrom: utf8Length(name), ...icon ? { icon: { text: icon[0], color: icon[1], background: icon[1] + "1f" } } : {} }, original: index },
      // Without an explicit edit the menu inserts the label; keep inserting just the name.
      ...!original.textEdit && !original.insertText ? { insertText: name } : {}
    };
    originals.set(keyOf(item), original);
    return item;
  });
  const rank = (item) => item.data.presentation.bold ? 0 : 1;
  shaped.sort((a, b) => rank(a) - rank(b) || String(a.sortText ?? a.label).localeCompare(String(b.sortText ?? b.label)) || a.data.original - b.data.original);
  return Array.isArray(result) ? shaped : { ...result, items: shaped };
}
function hoverParts(hover) {
  const contents = hover?.contents;
  const one = (c) => typeof c === "string" ? [{ markdown: c }] : c && typeof c.value === "string" ? c.kind === "markdown" || c.kind === "plaintext" ? [{ markdown: c.value }] : [{ code: c.value, language: c.language }] : [];
  return Array.isArray(contents) ? contents.flatMap(one) : one(contents);
}
function lastTopLevelSpace(text) {
  let depth = 0, at = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "<" || c === "(" || c === "[") depth++;
    else if (c === ">" || c === ")" || c === "]") depth = Math.max(0, depth - 1);
    else if (c === " " && depth === 0) at = i;
  }
  return at;
}
function splitTopLevel(text) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "<" || c === "(" || c === "[") depth++;
    else if (c === ">" || c === ")" || c === "]") depth = Math.max(0, depth - 1);
    else if (c === "," && depth === 0) {
      out.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = text.slice(start).trim();
  if (last) out.push(last);
  return out;
}
function packageOf(uri) {
  const path = decodeURIComponent(uri.replace(/^file:\/\//, "").replace(/#.*$/, ""));
  const m = /\/(?:src\/(?:main|test)\/java|src\/(?:main|test)\/kotlin|java|src)\/(.+)\/[^/]+\.\w+$/.exec(path);
  return m ? m[1].replace(/\//g, ".") : null;
}
function shapeDocs(markdown) {
  const lines2 = markdown.split("\n"), out = [];
  for (let i = 0; i < lines2.length; i++) {
    const section = /^\s*\*\s+\*\*(.+?):\*\*\s*$/.exec(lines2[i]);
    if (!section) {
      out.push(lines2[i]);
      continue;
    }
    const entries = [];
    while (i + 1 < lines2.length && /^\s{2,}\*\s+/.test(lines2[i + 1])) {
      const entry = lines2[++i].replace(/^\s+\*\s+/, "");
      const named = /^\*\*([\w$<>]+)\*\*\s*(.*)$/.exec(entry);
      entries.push(named ? `\`${named[1]}\` – ${named[2]}` : entry);
    }
    const label = section[1] === "Parameters" ? "Params" : section[1];
    if (!entries.length) continue;
    out.push("", [`**${label}:** ${entries[0]}`, ...entries.slice(1)].join("\\\n"));
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
function declarationAt(text, line, declared) {
  const lines2 = text.split("\n");
  let statement = "";
  for (let i = line - 1; i >= 0 && i < lines2.length && i < line + 4; i++) {
    statement += (statement ? " " : "") + lines2[i].trim();
    if (statement.includes(";") || statement.endsWith("{")) break;
  }
  statement = statement.replace(/;.*$/s, "").replace(/\s*\{$/, "").replace(/\s+/g, " ").trim();
  const at = statement.indexOf(declared);
  if (at < 0 || !statement.slice(at + declared.length).trimStart().startsWith("=") || statement.length - at > 300) return null;
  return statement.slice(at);
}
function shapeHover(hover, context = {}) {
  const parts = hoverParts(hover);
  if (!parts.some((p) => (p.code ?? p.markdown ?? "").trim())) return null;
  const codePart = parts.find((p) => p.code !== void 0);
  if (!codePart?.code?.trim()) return hover;
  const code = codePart.code.trim();
  const language = codePart.language || context.language || "";
  const docs = [];
  let source = null;
  for (const p of parts) {
    if (p.markdown === void 0 || !p.markdown.trim()) continue;
    const text = p.markdown.trim();
    const s = /^Source:\s*\*?\[([^\]]+)\]\(([^)]+)\)\*?$/.exec(text);
    const plain = /^Source:\s*\*?([^*\n]+?)\*?$/.exec(text);
    if (s) source = { name: s[1], uri: s[2], line: Number(/#(\d+)$/.exec(s[2])?.[1] || 0) };
    else if (plain) source = { name: plain[1].trim(), uri: "", line: 0 };
    else docs.push(shapeDocs(p.markdown));
  }
  if (/^[a-z_$][\w$]*$/.test(code) && !docs.length) return null;
  let header = "", signature = code, context2 = "";
  const paren = code.indexOf("(");
  const variable = /^(.+?)\s+-\s+(.+)$/.exec(code);
  if (paren > 0 && code.endsWith(")") && !variable) {
    const head = code.slice(0, paren), split = lastTopLevelSpace(head);
    const ret = split >= 0 ? head.slice(0, split) : "";
    const qualified = head.slice(split + 1);
    const dot = qualified.lastIndexOf(".");
    const owner = dot > 0 ? qualified.slice(0, dot) : "";
    const name = qualified.slice(dot + 1);
    const params = splitTopLevel(code.slice(paren + 1, -1));
    const pkg = owner && !owner.includes(".") && source ? packageOf(source.uri) : null;
    header = owner ? pkg ? `${pkg}.${owner}` : owner : "";
    signature = `${ret ? ret + " " : ""}${name}(${params.length ? "\n" + params.map((p) => "    " + p).join(",\n") + "\n" : ""})`;
  } else if (variable) {
    signature = variable[1];
    context2 = variable[2];
    if (source && context.text && context.path && source.uri.replace(/#.*$/, "").endsWith("/" + context.path)) {
      signature = declarationAt(context.text, source.line, signature) || signature;
    }
  }
  const project = source?.name.replace(/_[0-9a-f]{6,}$/i, "");
  const blocks = [
    ...header ? [`*${header}*`] : [],
    "```" + language + "\n" + signature + "\n```",
    ...context2 ? [`*in ${context2}*`] : [],
    ...docs.length ? ["---", ...docs] : [],
    ...project ? ["---", `*${project}*`] : []
  ];
  return { ...hover?.range ? { range: hover.range } : {}, contents: { kind: "markdown", value: blocks.join("\n\n") } };
}

// ../sdk/text-diff.ts
function myers(a, b, maxD) {
  const n = a.length, m = b.length, max = n + m, offset = max;
  maxD = Math.min(maxD, Math.floor(8e6 / (2 * max + 2)));
  const v = new Int32Array(2 * max + 2);
  const trace = [];
  for (let d = 0; d <= Math.min(max, maxD); d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || k !== d && v[offset + k - 1] < v[offset + k + 1] ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        const ops = [];
        let cx = n, cy = m;
        for (let dd = d; dd > 0; dd--) {
          const pv = trace[dd], kk = cx - cy;
          const prevK = kk === -dd || kk !== dd && pv[offset + kk - 1] < pv[offset + kk + 1] ? kk + 1 : kk - 1;
          const px = pv[offset + prevK], py = px - prevK;
          while (cx > px && cy > py) {
            ops.push({ kind: " ", line: a[--cx] });
            cy--;
          }
          if (cx === px) ops.push({ kind: "+", line: b[--cy] });
          else ops.push({ kind: "-", line: a[--cx] });
        }
        while (cx > 0 && cy > 0) {
          ops.push({ kind: " ", line: a[--cx] });
          cy--;
        }
        return ops.reverse();
      }
    }
  }
  return null;
}
function diffLines(a, b, maxD = 4e3) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA), midB = b.slice(start, endB);
  const mid = myers(midA, midB, maxD) ?? [...midA.map((line) => ({ kind: "-", line })), ...midB.map((line) => ({ kind: "+", line }))];
  return [...a.slice(0, start).map((line) => ({ kind: " ", line })), ...mid, ...a.slice(endA).map((line) => ({ kind: " ", line }))];
}

// modules/ui/viewer/src/declarations.ts
function blankJava(text) {
  const out = text.split("");
  const blank = (from, to) => {
    for (let i2 = from; i2 < to && i2 < out.length; i2++) if (out[i2] !== "\n") out[i2] = " ";
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i], next = text[i + 1];
    if (c === "/" && next === "/") {
      const end = text.indexOf("\n", i);
      blank(i, end < 0 ? text.length : end);
      i = end < 0 ? text.length : end;
    } else if (c === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? text.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (c === '"' && text.startsWith('"""', i)) {
      const end = text.indexOf('"""', i + 3);
      const stop = end < 0 ? text.length : end + 3;
      blank(i + 1, stop - 1);
      i = stop;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c && text[j] !== "\n") j += text[j] === "\\" ? 2 : 1;
      blank(i + 1, j);
      i = j + 1;
    } else i++;
  }
  return out.join("");
}
var NOT_METHODS = /* @__PURE__ */ new Set(["if", "for", "while", "switch", "catch", "synchronized", "try", "else", "do", "return", "new", "throw", "case", "assert", "finally", "yield"]);
var TYPE = /\b(class|interface|enum|record|@\s*interface)\s+([A-Za-z_$][\w$]*)/;
var METHOD = /([A-Za-z_$][\w$]*)\s*\(([^()]|\([^()]*\))*\)\s*(\[\s*\]\s*)*(throws\s+[\w$.<>,\s]+)?\s*$/;
function javaDeclarations(text) {
  if (text.length > 2e6) return [];
  const src = blankJava(text);
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (offset) => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = lo + hi + 1 >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const out = [];
  const stack = [];
  let headerStart = 0, parens = 0;
  const header = (end) => {
    const raw = src.slice(headerStart, end);
    const lead = raw.length - raw.trimStart().length;
    return { text: raw.trim(), start: headerStart + lead };
  };
  const declare = (end, body) => {
    const h = header(end);
    if (!h.text) return null;
    const inType = stack.length === 0 || stack[stack.length - 1].type;
    const type = TYPE.exec(h.text);
    if (type && body) {
      const at2 = h.start + type.index + type[0].length - type[2].length;
      return { kind: "type", name: type[2], line: lineOf(at2), start: lineOf(h.start), end: lineOf(end) };
    }
    if (!inType || stack.length === 0 || /=|->|\bnew\s/.test(h.text)) return null;
    const method = METHOD.exec(h.text);
    if (!method || NOT_METHODS.has(method[1])) return null;
    const before = h.text.slice(0, method.index).trim();
    const owner = [...stack].reverse().find((b) => b.decl?.kind === "type")?.decl?.name;
    if (!before && method[1] !== owner) return null;
    const at = h.start + method.index;
    return { kind: "method", name: method[1], line: lineOf(at), start: lineOf(h.start), end: lineOf(end) };
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "(") parens++;
    else if (c === ")") parens = Math.max(0, parens - 1);
    else if (parens > 0) continue;
    else if (c === "{") {
      const decl = declare(i, true);
      stack.push({ type: decl?.kind === "type", decl });
      headerStart = i + 1;
    } else if (c === "}") {
      const block = stack.pop();
      if (block?.decl) {
        block.decl.end = lineOf(i);
        out.push(block.decl);
      }
      headerStart = i + 1;
    } else if (c === ";") {
      const decl = declare(i, false);
      if (decl) out.push(decl);
      headerStart = i + 1;
    }
  }
  return out.sort((a, b) => a.line - b.line || (a.kind === b.kind ? a.start - b.start : a.kind === "type" ? -1 : 1));
}
var scanners = { java: javaDeclarations };
var declarationsFor = (grammar, text) => grammar && scanners[grammar] ? scanners[grammar](text) : [];
var hasDeclarations = (grammar) => !!grammar && grammar in scanners;

// modules/ui/viewer/src/authorship.ts
var blames = /* @__PURE__ */ new Map();
var pending = /* @__PURE__ */ new Map();
var generation = 0;
var key = (workspaceId, path) => `${workspaceId}|${path}`;
function forgetBlames() {
  blames.clear();
  generation++;
}
async function refreshBlame(ctx, workspaceId, path, text) {
  const k = key(workspaceId, path), mine = ++generation;
  pending.set(k, mine);
  try {
    const r = await ctx.modules.call("git", "blame", { workspaceId, path, text }, { timeoutMs: 6e4 });
    if (pending.get(k) !== mine) return false;
    blames.delete(k);
    blames.set(k, { text, commits: r.commits || [], lines: r.lines || [], tracked: !!r.tracked });
    while (blames.size > 24) blames.delete(blames.keys().next().value);
    return true;
  } catch (e) {
    ctx.log.warn(`blame ${path}: ${String(e)}`);
    return false;
  } finally {
    if (pending.get(k) === mine) pending.delete(k);
  }
}
function currentLines(b, text) {
  if (b.text === text) return b.lines;
  const before = b.text.split("\n"), after = text.split("\n");
  if (before.length > 2e4 || after.length > 2e4) return [];
  const out = [];
  let old = 0;
  for (const op of diffLines(before, after)) {
    if (op.kind === " ") out.push(b.lines[old++] ?? -1);
    else if (op.kind === "+") out.push(-1);
    else old++;
  }
  return out;
}
function ago(seconds) {
  const s = Math.max(0, Date.now() / 1e3 - seconds);
  const unit = (n, word) => `${n} ${word}${n === 1 ? "" : "s"} ago`;
  if (s < 3600) return s < 120 ? "just now" : unit(Math.floor(s / 60), "minute");
  if (s < 86400) return unit(Math.floor(s / 3600), "hour");
  if (s < 86400 * 30) return unit(Math.floor(s / 86400), "day");
  if (s < 86400 * 365) return unit(Math.floor(s / (86400 * 30)), "month");
  return unit(Math.floor(s / (86400 * 365)), "year");
}
var memo = null;
function declarationAnnotations(workspaceId, path, grammar, text) {
  if (typeof text !== "string") return [];
  const b = blames.get(key(workspaceId, path));
  if (!b?.tracked) return [];
  const args = [workspaceId, path, grammar, text, b, Math.floor(Date.now() / 6e4)];
  if (memo && memo.args.every((v, i) => v === args[i])) return memo.result;
  const result = compute(b, grammar, text);
  memo = { args, result };
  return result;
}
function compute(b, grammar, text) {
  const declarations = declarationsFor(grammar, text);
  if (!declarations.length) return [];
  const lines2 = currentLines(b, text);
  if (!lines2.length) return [];
  return declarations.map((d) => {
    let latest = null, uncommitted = false;
    const authors = /* @__PURE__ */ new Set();
    for (let line = d.start; line <= d.end; line++) {
      const i = lines2[line];
      if (i === void 0 || i < 0) {
        uncommitted = true;
        continue;
      }
      const c = b.commits[i];
      authors.add(c.email || c.author);
      if (!latest || c.time > latest.time) latest = c;
    }
    if (uncommitted) return { line: d.line, text: "Uncommitted changes" };
    if (!latest) return null;
    const others = authors.size - 1;
    return { line: d.line, text: `${latest.author}${others > 0 ? ` +${others}` : ""}, ${ago(latest.time)}` };
  }).filter((a) => !!a);
}

// modules/ui/viewer/src/history.ts
var H = null;
var seq = 0;
var epoch = 0;
var size = { width: 1180, height: 760 };
var SIZE_KEY = "viewer.historyWindow";
function mapToCommitted(committed, text, start, end) {
  const a = committed.split("\n"), b = text.split("\n");
  if (a.length > 2e4 || b.length > 2e4) return [start, end];
  let oldLine = 0, newLine = 0, first = -1, last = -1;
  const take = (line) => {
    if (first < 0) first = line;
    last = line;
  };
  for (const op of diffLines(a, b)) {
    if (op.kind === " ") {
      if (newLine >= start && newLine <= end) take(oldLine);
      oldLine++;
      newLine++;
    } else if (op.kind === "+") newLine++;
    else {
      if (newLine >= start && newLine <= end) take(oldLine);
      oldLine++;
    }
  }
  const lastLine = Math.max(0, a.length - (a[a.length - 1] === "" ? 2 : 1));
  return first < 0 ? null : [Math.min(first, lastLine), Math.min(last, lastLine)];
}
async function restoreHistory(ctx, prev) {
  const saved = await ctx.modules.call("persistence", "settings.get", { key: SIZE_KEY }).catch(() => null);
  if (saved && Number(saved.width) >= 480 && Number(saved.height) >= 320) size = { width: Number(saved.width), height: Number(saved.height) };
  if (prev?.history?.workspaceId) {
    H = { ...prev.history, loading: false, diffLoading: false };
    seq = H.seq;
  }
}
var historySnapshot = () => H && { ...H, loading: false, diffLoading: false };
async function openHistory(ctx, request) {
  epoch++;
  H = { seq: ++seq, ...request, head: null, commits: [], more: false, untracked: false, loading: false, error: null, chosen: null, document: null, diffLoading: false, empty: false, wholeFile: false };
  ctx.ui.invalidate();
  await loadPage(ctx);
}
async function loadPage(ctx) {
  const h = H;
  if (!h || h.loading) return;
  const mine = epoch;
  h.loading = true;
  ctx.ui.invalidate();
  try {
    const r = await ctx.modules.call("git", "fileHistory", {
      workspaceId: h.workspaceId,
      path: h.path,
      head: h.head,
      skip: h.commits.length,
      ...h.range ? { startLine: h.range[0], endLine: h.range[1] } : {}
    }, { timeoutMs: 6e4 });
    if (mine !== epoch || H !== h) return;
    h.head = r.head;
    h.untracked = !!r.untracked;
    h.more = !!r.more;
    h.error = null;
    const known = new Set(h.commits.map((c) => c.id));
    h.commits.push(...r.commits.filter((c) => !known.has(c.id)));
    if (!h.chosen && h.commits.length) void choose(ctx, h.commits[0].id);
  } catch (e) {
    if (H === h) {
      h.error = errMsg(e);
      h.more = false;
    }
  } finally {
    if (H === h) h.loading = false;
    ctx.ui.invalidate();
  }
}
async function choose(ctx, id) {
  const h = H;
  const index = h ? h.commits.findIndex((c2) => c2.id === id) : -1;
  if (!h || index < 0) return;
  const c = h.commits[index];
  h.chosen = id;
  h.diffLoading = true;
  ctx.ui.invalidate();
  try {
    const args = h.range && !h.wholeFile ? { workspaceId: h.workspaceId, id, path: h.path, head: h.head, startLine: h.range[0], endLine: h.range[1], index } : { workspaceId: h.workspaceId, id, repoPath: c.path, previousPath: c.previousPath };
    const r = await ctx.modules.call("git", "fileCommitDiff", args, { timeoutMs: 6e4 });
    if (H !== h || h.chosen !== id) return;
    h.document = r.document;
    h.empty = !!r.empty;
    h.error = null;
  } catch (e) {
    if (H === h && h.chosen === id) h.error = errMsg(e);
  } finally {
    if (H === h && h.chosen === id) h.diffLoading = false;
    ctx.ui.invalidate();
  }
}
function ago2(iso) {
  const days = (Date.now() - Date.parse(iso)) / 864e5;
  if (!Number.isFinite(days)) return "";
  if (days < 1) {
    const hours = Math.floor(days * 24);
    return hours < 1 ? "just now" : `${hours} h ago`;
  }
  if (days < 30) return `${Math.floor(days)} d ago`;
  if (days < 365) return `${Math.floor(days / 30)} mo ago`;
  return `${Math.floor(days / 365)} y ago`;
}
var when = (iso) => iso ? iso.slice(0, 16).replace("T", " ") : "";
var lines = (r) => r[0] === r[1] ? `line ${r[0] + 1}` : `lines ${r[0] + 1}–${r[1] + 1}`;
function historyWindow(diffMode2, softWrap) {
  const h = H;
  if (!h) return null;
  const name = h.path.split("/").pop() || h.path;
  const title = h.shown ? `History of ${name}, ${lines(h.shown)}` : `History of ${name}`;
  const c = h.commits.find((x) => x.id === h.chosen);
  const emptyText = h.untracked ? "This file has no committed history yet." : h.range ? "No commits changed these lines." : "No commits changed this file.";
  const list = h.commits.length || h.loading ? {
    type: "tree",
    key: "commits",
    grow: true,
    rowHeight: 46,
    indent: 0,
    selectAction: "history.select",
    expandAction: "history.noop",
    endReachedAction: h.more && !h.loading && !h.error ? "history.more" : void 0,
    rows: h.commits.map((x) => ({
      key: x.id,
      label: x.subject || "(no message)",
      depth: 0,
      expandable: false,
      expanded: false,
      selected: x.id === h.chosen,
      detail: `${x.id.slice(0, 8)} · ${x.author} · ${ago2(x.date)}`,
      badge: x.status === "A" ? "added" : x.previousPath ? "renamed" : void 0,
      tooltip: `${x.subject}
${x.id}
${x.author} <${x.email}>
${when(x.date)}${x.previousPath ? `
Renamed from ${x.previousPath}` : ""}`
    }))
  } : { type: "label", key: "empty", text: emptyText, color: "muted", wrap: true };
  return { type: "window", key: `file-history-${h.seq}`, title, width: size.width, height: size.height, closeAction: "history.closed", children: [
    { type: "column", key: "root", grow: true, padding: 10, gap: 8, children: [
      { type: "row", key: "header", gap: 8, align: "center", children: [
        { type: "column", key: "title", grow: true, gap: 2, children: [
          { type: "label", key: "path", text: h.path, weight: "semibold", size: "sm", selectable: true },
          {
            type: "label",
            key: "scope",
            size: "xs",
            color: "muted",
            text: `${h.shown ? `Commits that changed ${lines(h.shown)}` : "Commits that changed this file, following renames"} · ${h.commits.length}${h.more ? "+" : ""} loaded`
          }
        ] },
        ...h.range ? [{ type: "switch", key: "whole", label: "Whole file diff", checked: h.wholeFile, action: "history.wholeFile" }] : [],
        { type: "button", key: "layout", text: diffMode2 === "split" ? "Unified" : "Side by side", action: "history.diffMode", small: true, variant: "ghost", tooltip: "Switch diff layout" },
        { type: "button", key: "refresh", text: "Refresh", action: "history.refresh", small: true, variant: "ghost", disabled: h.loading }
      ] },
      ...h.error ? [{ type: "status", key: "error", text: h.error, level: "error" }] : [],
      { type: "split", key: "body", direction: "horizontal", sizes: [0.34, 0.66], grow: true, children: [
        { type: "column", key: "log", grow: true, gap: 4, children: [
          list,
          ...h.loading ? [{ type: "progress", key: "loading", indeterminate: true, label: h.commits.length ? "Loading older commits…" : "Loading history…" }] : []
        ] },
        { type: "column", key: "detail", grow: true, gap: 6, children: [
          ...c ? [
            { type: "label", key: "subject", text: c.subject || "(no message)", weight: "semibold", size: "sm", wrap: true, selectable: true },
            { type: "label", key: "meta", text: `${c.author} <${c.email}> · ${when(c.date)} · ${c.id}${c.previousPath ? ` · renamed from ${c.previousPath}` : ""}`, size: "xs", color: "muted", wrap: true, selectable: true }
          ] : [],
          {
            type: "diff",
            key: `diff-${h.chosen || "none"}`,
            document: h.diffLoading ? null : h.document,
            mode: diffMode2,
            softWrap,
            grow: true,
            placeholder: h.chosen ? "Loading changes…" : "Choose a commit to see what it changed.",
            emptyText: "This commit changed no content here (mode or merge only).",
            changeNavigation: { previous: "Previous change", next: "Next change" }
          }
        ] }
      ] }
    ] }
  ] };
}
async function historyEvent(ctx, action, ev, toggleDiffMode) {
  if (!action.startsWith("history.")) return false;
  const h = H;
  switch (action) {
    case "history.closed": {
      H = null;
      epoch++;
      const v = ev.value || {};
      if (Number(v.width) >= 480 && Number(v.height) >= 320) {
        size = { width: Math.round(v.width), height: Math.round(v.height) };
        await ctx.modules.call("persistence", "settings.set", { key: SIZE_KEY, value: size }).catch(() => {
        });
      }
      break;
    }
    case "history.more":
      await loadPage(ctx);
      break;
    case "history.select":
      if (ev.rowKey && ev.rowKey !== h?.chosen) await choose(ctx, String(ev.rowKey));
      break;
    case "history.wholeFile":
      if (h) {
        h.wholeFile = !h.wholeFile;
        if (h.chosen) await choose(ctx, h.chosen);
      }
      break;
    case "history.diffMode":
      await toggleDiffMode();
      break;
    case "history.refresh":
      if (h) {
        epoch++;
        Object.assign(h, { head: null, commits: [], more: false, chosen: null, document: null, error: null, loading: false });
        await loadPage(ctx);
      }
      break;
  }
  ctx.ui.invalidate();
  return true;
}

// modules/ui/viewer/src/index.ts
var heads = /* @__PURE__ */ new Map();
var hunks = [];
var hunkView = null;
var gitMarkers = true;
var declarationAuthors = true;
var headKey = (workspaceId, path) => `${workspaceId}|${path}`;
function computeHunks(head, text) {
  if (head === null || typeof text !== "string") return [];
  const a = head.split("\n"), b = text.split("\n");
  if (a.length > 2e4 || b.length > 2e4) return [];
  const out = [];
  let line = 0, cur = null;
  for (const op of diffLines(a, b)) {
    if (op.kind === " ") {
      cur = null;
      line++;
      continue;
    }
    if (!cur) {
      cur = { line, added: 0, removed: [], current: [] };
      out.push(cur);
    }
    if (op.kind === "+") {
      cur.added++;
      cur.current.push(op.line);
      line++;
    } else cur.removed.push(op.line);
  }
  return out;
}
var showMetadata = true;
var renderMarkdown = true;
var diffMode = "split";
var editorWrap = false;
var viewerWrap = true;
var publishSettings = () => {
};
var presentation = null;
var ws = null;
var current = null;
var error = null;
var loadingPath = null;
var editable = true;
var autosave = true;
var autosaveDelay = 800;
var AUTOSAVE_DELAYS = [300, 800, 2e3, 5e3];
var GLOBAL_FONT = "global";
var editorFontOptions = [{ value: GLOBAL_FONT, label: "Global default" }, ...fontOptions.filter((o) => o.value !== "system")];
var FONT_NUMBERS = {
  fontWeight: { min: 100, max: 900, label: "Font weight" },
  fontSize: { min: 8, max: 40, label: "Size" },
  lineHeight: { min: 1, max: 3, label: "Line height" }
};
var editorFont = { family: GLOBAL_FONT, fontWeight: "", fontSize: "", lineHeight: "" };
function fontNumber(key2, raw) {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  const value = Number(text), { min, max, label } = FONT_NUMBERS[key2];
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${label} must be between ${min} and ${max}, or empty for the global default`);
  return String(value);
}
function editorFontNode() {
  const font = {};
  if (editorFont.family !== GLOBAL_FONT) font.family = editorFont.family;
  if (editorFont.fontWeight) font.weight = Number(editorFont.fontWeight);
  if (editorFont.fontSize) font.size = Number(editorFont.fontSize);
  if (editorFont.lineHeight) font.lineHeight = Number(editorFont.lineHeight);
  return Object.keys(font).length ? font : void 0;
}
var buffers = /* @__PURE__ */ new Map();
var saveTimer = null;
function bufferFor(path) {
  if (!path || !ws) return void 0;
  for (const b of buffers.values()) if (b.workspaceId === ws.id && b.path === path) return b;
  return void 0;
}
var unsaved = (b) => !!b && b.state !== "clean";
async function save(ctx, b, force = false) {
  if (b.text === null) return;
  if (b.inflight) {
    b.again = true;
    return;
  }
  b.inflight = true;
  b.again = false;
  b.state = "saving";
  ctx.ui.invalidate();
  const text = b.text;
  try {
    const r = await ctx.modules.call("files", "save", { workspaceId: b.workspaceId, relativePath: b.path, text, expectedMtime: b.mtime, force }, { timeoutMs: 6e5 });
    b.mtime = r?.mtime ?? b.mtime;
    if (current?.workspaceId === b.workspaceId && current.relativePath === b.path) current.text = text;
    if (b.text === text) {
      b.state = "clean";
      b.text = null;
    } else b.state = "dirty";
    b.error = void 0;
    if (current?.workspaceId === b.workspaceId && current.relativePath === b.path) refreshAuthorship(ctx);
    if (languageService) void ctx.modules.call("language-service", "saved", { workspaceId: b.workspaceId, path: b.path, text }, { timeoutMs: 175e3 }).catch((e) => ctx.log.warn(errMsg(e)));
  } catch (e) {
    const msg = errMsg(e);
    b.state = e?.code === "ECONFLICT" || /changed on disk/.test(msg) ? "conflict" : "error";
    b.error = msg;
    b.again = false;
  } finally {
    b.inflight = false;
    if (b.again && b.state === "dirty") void save(ctx, b);
    ctx.ui.invalidate();
  }
}
function scheduleSaves(ctx, now = false) {
  if (saveTimer) clearTimeout(saveTimer);
  const run = () => {
    saveTimer = null;
    for (const b of buffers.values()) if (b.state === "dirty") void save(ctx, b);
  };
  if (now) run();
  else saveTimer = setTimeout(run, autosaveDelay);
}
var tabs = [];
var tabMenu = null;
var shellRequests = /* @__PURE__ */ new Map();
function runShellBlock(ctx, args) {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      shellRequests.delete(requestId);
      reject(new Error("Opening the shell block terminal timed out."));
    }, 6e4);
    shellRequests.set(requestId, { resolve, reject, timer });
    ctx.events.emit("viewer.runCode", { requestId, ...args });
  });
}
var generation2 = 0;
var languages = [];
var languageService = false;
var languageError = null;
var projectLanguageEnabled = true;
var languageTimer = null;
function languageRequest() {
  const buffer = current?.document ? buffers.get(current.document) : void 0;
  return {
    workspaceId: ws?.id,
    path: current?.relativePath,
    text: buffer?.text ?? current?.text,
    documents: [...buffers.values()].filter((b) => b.workspaceId === ws?.id && b.text !== null).map((b) => ({ path: b.path, text: b.text }))
  };
}
var semantic = /* @__PURE__ */ new Map();
var SEMANTIC_CAPTURES = {
  interface: ["type", "type.interface"],
  enum: ["type", "type.enum"],
  typeParameter: ["type", "type.typeParameter"],
  property: ["variable", "property"],
  enumMember: ["variable", "constant"]
};
function nameCaptures(workspaceId, path) {
  var _a;
  const names = workspaceId && path ? semantic.get(headKey(workspaceId, path)) : void 0;
  if (!names) return void 0;
  const out = {};
  for (const [name, kind] of Object.entries(names)) {
    const target = SEMANTIC_CAPTURES[kind];
    if (target) (out[_a = target[0]] ?? (out[_a] = {}))[name] = target[1];
  }
  return Object.keys(out).length ? out : void 0;
}
async function refreshSemantic(ctx, request) {
  const key2 = headKey(request.workspaceId, request.path);
  try {
    const names = await ctx.modules.call("language-service", "semanticNames", request, { timeoutMs: 6e4 });
    if (!names || typeof names !== "object") return;
    if (!Object.keys(names).length && semantic.has(key2)) return;
    if (JSON.stringify(semantic.get(key2)) === JSON.stringify(names)) return;
    semantic.delete(key2);
    semantic.set(key2, names);
    while (semantic.size > 40) semantic.delete(semantic.keys().next().value);
    if (request.workspaceId === ws?.id && request.path === current?.relativePath) ctx.ui.invalidate();
  } catch (e) {
    ctx.log.warn(`semantic names: ${errMsg(e)}`);
  }
}
async function synchronizeLanguage(ctx) {
  const request = languageRequest();
  const language = languageForPath(languages, request.path || "");
  if (!languageService || !language?.server || current?.binary || current?.truncated || current?.diff || typeof request.text !== "string") {
    projectLanguageEnabled = true;
    ctx.ui.invalidate();
    return;
  }
  const project = await ctx.modules.call("language-service", "project.get", { workspaceId: request.workspaceId, serverId: language.server.id }).catch(() => null);
  projectLanguageEnabled = project?.config.enabled !== false;
  if (request.workspaceId !== ws?.id || request.path !== current?.relativePath || !projectLanguageEnabled) return;
  try {
    await ctx.modules.call("language-service", "synchronize", request, { timeoutMs: 175e3 });
    if (request.workspaceId === ws?.id && request.path === current?.relativePath) {
      languageError = null;
      ctx.ui.invalidate();
      void refreshSemantic(ctx, request);
    }
  } catch (e) {
    if (request.workspaceId === ws?.id && request.path === current?.relativePath) {
      languageError = errMsg(e);
      ctx.ui.invalidate();
    }
  }
}
async function editorRequest(ctx, a, method) {
  const buffer = buffers.get(a.document);
  const empty = method === "hover" || method === "signatureHelp" ? null : [];
  if (!languageService || !buffer || buffer.workspaceId !== a.workspaceId || buffer.path !== a.path || typeof a.text !== "string") return empty;
  try {
    const result = await ctx.modules.call("language-service", method, {
      ...a,
      documents: [...buffers.values()].filter((b) => b.workspaceId === buffer.workspaceId && b.text !== null).map((b) => ({ path: b.path, text: b.text }))
    }, { timeoutMs: 175e3 });
    languageError = null;
    ctx.ui.invalidate();
    return result;
  } catch (e) {
    languageError = errMsg(e);
    ctx.ui.invalidate();
    return empty;
  }
}
var shapedOriginals = /* @__PURE__ */ new Map();
var shapeKey = (item) => `${item.label}\0${JSON.stringify(item.data ?? null)}`;
async function completionOwner(ctx, a) {
  if (typeof a.text !== "string" || !validPosition(a.position)) return null;
  const lines2 = a.text.split("\n");
  const line = lines2[a.position.line] ?? "";
  let offset = 0;
  for (let i = 0; i < a.position.line; i++) offset += lines2[i].length + 1;
  const enclosing = enclosingType(a.text, offset + a.position.character);
  const receiver = receiverAt(line, a.position.character);
  if (!receiver) return enclosing;
  if (receiver.name === "this") return enclosing;
  const hover = await editorRequest(ctx, { ...a, position: { line: a.position.line, character: receiver.character } }, "hover");
  return hoverType(hover) ?? (/^[A-Z]/.test(receiver.name) ? receiver.name : null);
}
var navigation = null;
async function refreshLanguages(ctx) {
  const { plugins } = await ctx.host.plugins.list();
  languages = languageDefinitions(plugins);
  languageService = plugins.some((p) => p.id === "language-service" && p.enabled && !!p.active);
  ctx.ui.invalidate();
  void synchronizeLanguage(ctx);
}
function restoreTabs() {
  const saved = ws?.view?.ui?.viewerTabs;
  tabs = Array.isArray(saved) ? saved.filter((p) => typeof p === "string") : [];
}
async function saveTabs(ctx) {
  await ctx.modules.call("workspace", "view.patch", { workspaceId: ws.id, patch: { ui: { viewerTabs: [...tabs] } } });
}
async function load(ctx, force = false) {
  const path = ws?.view?.previewPath || null;
  const workspaceId = ws?.id;
  if (!workspaceId || !path) {
    generation2++;
    loadingPath = null;
    current = null;
    projectLanguageEnabled = true;
    error = null;
    ctx.ui.invalidate();
    return;
  }
  if (!tabs.includes(path)) {
    tabs.push(path);
    await saveTabs(ctx);
  }
  if (ws?.id !== workspaceId || ws?.view?.previewPath !== path) return;
  if (!force && current?.workspaceId === workspaceId && current.tab === path || loadingPath === path) return;
  const mine = ++generation2;
  const diffPath = diffTabPath(path);
  const known = !force && !diffPath ? opened.get(openedKey(workspaceId, path)) : void 0;
  if (known) {
    current = known;
    languageError = null;
    updateHunks();
  } else if (!force) {
    current = null;
    languageError = null;
  }
  error = null;
  loadingPath = path;
  ctx.ui.invalidate();
  if (known) void synchronizeLanguage(ctx);
  try {
    const r = diffPath ? { ...await ctx.modules.call("git", "diff", { workspaceId, path: diffPath }, { timeoutMs: 45e3 }), diff: true, relativePath: diffPath } : await ctx.modules.call("files", "open", { workspaceId, relativePath: path, includeText: true });
    const keep = known && r.document !== known.document && unsaved(buffers.get(known.document));
    if (mine === generation2 && !keep) {
      current = { ...r, workspaceId, tab: path };
      error = null;
      if (!r.diff && !r.binary && r.document) rememberOpened(current);
      if (!r.diff && r.document && !buffers.has(r.document)) {
        for (const [doc, b] of buffers) if (b.workspaceId === workspaceId && b.path === r.relativePath && b.state === "clean") buffers.delete(doc);
        buffers.set(r.document, { workspaceId, path: r.relativePath, mtime: r.mtime ?? null, text: null, state: "clean" });
      }
    }
  } catch (e) {
    if (mine === generation2) {
      error = errMsg(e);
      current = null;
      opened.delete(openedKey(workspaceId, path));
    }
  } finally {
    if (mine === generation2) {
      loadingPath = null;
      if (!known || current?.document !== known.document) void synchronizeLanguage(ctx);
      void refreshHead(ctx);
      refreshAuthorship(ctx);
    }
    ctx.ui.invalidate();
  }
}
var opened = /* @__PURE__ */ new Map();
var OPENED_LIMIT = 40;
var openedKey = (workspaceId, path) => `${workspaceId}|${path}`;
function rememberOpened(result) {
  const key2 = openedKey(result.workspaceId, result.tab);
  opened.delete(key2);
  opened.set(key2, result);
  while (opened.size > OPENED_LIMIT) opened.delete(opened.keys().next().value);
}
function updateHunks() {
  const head = current && !current.diff && !current.binary && !current.truncated && ws ? heads.get(headKey(ws.id, current.relativePath)) : void 0;
  const text = current?.document ? buffers.get(current.document)?.text ?? current.text : void 0;
  hunks = gitMarkers && head?.tracked ? computeHunks(head.text, text) : [];
  if (hunkView && !hunks[hunkView.index]) hunkView = null;
}
async function refreshHead(ctx) {
  if (!gitMarkers || !ws || !current || current.diff || current.binary) {
    updateHunks();
    ctx.ui.invalidate();
    return;
  }
  const workspaceId = ws.id, path = current.relativePath;
  try {
    const r = await ctx.modules.call("git", "headText", { workspaceId, path }, { timeoutMs: 3e4 });
    heads.set(headKey(workspaceId, path), { text: r?.text ?? null, tracked: !!r?.tracked });
  } catch {
    heads.delete(headKey(workspaceId, path));
  }
  updateHunks();
  ctx.ui.invalidate();
}
function refreshAuthorship(ctx) {
  if (!declarationAuthors || !ws || !current || current.diff || current.binary || current.truncated || !current.document) return;
  if (!hasDeclarations(languageForPath(languages, current.relativePath)?.grammar)) return;
  const text = buffers.get(current.document)?.text ?? current.text;
  if (typeof text !== "string") return;
  void refreshBlame(ctx, ws.id, current.relativePath, text).then((changed) => {
    if (changed) ctx.ui.invalidate();
  });
}
function tabLabel(tab) {
  const file = diffTabPath(tab) ?? tab;
  const name = file.split("/").pop() || file;
  return diffTabPath(tab) ? `Δ ${name}` : unsaved(bufferFor(tab)) ? `● ${name}` : name;
}
async function refreshFromDisk(ctx) {
  if (!current || current.diff || current.binary || !ws) return;
  const b = buffers.get(current.document);
  if (!b || b.state !== "clean" || b.inflight) return;
  const st = await ctx.modules.call("files", "stat", { workspaceId: ws.id, relativePath: current.relativePath }).catch(() => null);
  if (!st || st.error || st.mtime == null || st.mtime === b.mtime) return;
  if (buffers.get(current?.document) === b && b.state === "clean") void load(ctx, true);
}
function saveStatus(b) {
  if (!b) return { text: "", color: "muted" };
  switch (b.state) {
    case "saving":
      return { text: "Saving…", color: "muted" };
    case "dirty":
      return { text: autosave ? "Edited" : "Unsaved", color: autosave ? "muted" : "warning" };
    case "error":
      return { text: "Save failed", color: "danger", tooltip: b.error };
    case "conflict":
      return { text: "Changed on disk", color: "warning", tooltip: b.error };
    default:
      return { text: b.mtime != null ? "Saved" : "", color: "muted" };
  }
}
var mod = {
  id: "viewer",
  moduleApiVersion: 1,
  async activate(ctx, prev) {
    presentation = new FilePresentationClient(ctx);
    ctx.events.on("terminal-panel.runCodeResult", (result) => {
      const pending2 = shellRequests.get(result?.requestId);
      if (!pending2) return;
      shellRequests.delete(result.requestId);
      clearTimeout(pending2.timer);
      if (result.error) pending2.reject(new Error(result.error));
      else pending2.resolve();
    });
    await refreshLanguages(ctx);
    ctx.events.on("kernel.modules.changed", () => {
      void refreshLanguages(ctx).catch((e) => ctx.log.warn(errMsg(e)));
    });
    const saved = await ctx.modules.call("persistence", "settings.get", { key: "viewer.showMetadata" });
    showMetadata = typeof saved === "boolean" ? saved : true;
    const savedMarkdown = await ctx.modules.call("persistence", "settings.get", { key: "viewer.renderMarkdown" });
    renderMarkdown = typeof savedMarkdown === "boolean" ? savedMarkdown : true;
    const savedDiffMode = await ctx.modules.call("persistence", "settings.get", { key: "viewer.diffMode" });
    diffMode = savedDiffMode === "unified" ? "unified" : "split";
    const savedEditorWrap = await ctx.modules.call("persistence", "settings.get", { key: "viewer.editorWrap" });
    editorWrap = typeof savedEditorWrap === "boolean" ? savedEditorWrap : false;
    const savedViewerWrap = await ctx.modules.call("persistence", "settings.get", { key: "viewer.viewerWrap" });
    viewerWrap = typeof savedViewerWrap === "boolean" ? savedViewerWrap : true;
    const savedMarkers = await ctx.modules.call("persistence", "settings.get", { key: "viewer.gitMarkers" });
    gitMarkers = typeof savedMarkers === "boolean" ? savedMarkers : true;
    const savedAuthors = await ctx.modules.call("persistence", "settings.get", { key: "viewer.declarationAuthors" });
    declarationAuthors = typeof savedAuthors === "boolean" ? savedAuthors : true;
    const savedEditable = await ctx.modules.call("persistence", "settings.get", { key: "viewer.editable" });
    editable = typeof savedEditable === "boolean" ? savedEditable : true;
    const savedAutosave = await ctx.modules.call("persistence", "settings.get", { key: "viewer.autosave" });
    autosave = typeof savedAutosave === "boolean" ? savedAutosave : true;
    const savedDelay = await ctx.modules.call("persistence", "settings.get", { key: "viewer.autosaveDelay" });
    autosaveDelay = AUTOSAVE_DELAYS.includes(Number(savedDelay)) ? Number(savedDelay) : 800;
    const savedFont = await ctx.modules.call("persistence", "settings.get", { key: "viewer.editorFont" });
    editorFont = { family: editorFontOptions.some((o) => o.value === savedFont?.family) ? savedFont.family : GLOBAL_FONT, fontWeight: "", fontSize: "", lineHeight: "" };
    for (const key2 of Object.keys(FONT_NUMBERS)) {
      try {
        editorFont[key2] = fontNumber(key2, savedFont?.[key2]);
      } catch {
      }
    }
    for (const [doc, b] of Object.entries(prev?.buffers || {})) buffers.set(doc, { ...b, inflight: false, again: false });
    await restoreHistory(ctx, prev);
    publishSettings = exportSettings(ctx, () => [{ key: "viewer", title: "Source editor", fields: [
      {
        key: "editable",
        label: "Edit files",
        type: "toggle",
        value: editable,
        description: "Allow editing in the source panel. The first save in a workspace asks for write access."
      },
      {
        key: "autosave",
        label: "Autosave",
        type: "toggle",
        value: autosave,
        description: "Save edits automatically after you stop typing. When off, use Save in the status bar."
      },
      {
        key: "autosaveDelay",
        label: "Autosave delay",
        type: "select",
        value: String(autosaveDelay),
        options: AUTOSAVE_DELAYS.map((ms) => ({ value: String(ms), label: ms < 1e3 ? `${ms} ms` : `${ms / 1e3} s` })),
        description: "Quiet time after the last keystroke before saving."
      },
      {
        key: "editorWrap",
        label: "Wrap lines in the editor",
        type: "toggle",
        value: editorWrap,
        description: "Soft-wrap long lines when editing source files (including Markdown source)."
      },
      {
        key: "viewerWrap",
        label: "Wrap lines in diffs",
        type: "toggle",
        value: viewerWrap,
        description: "Soft-wrap long lines in Git diff review. Markdown previews always reflow."
      },
      {
        key: "gitMarkers",
        label: "Show Git change bars",
        type: "toggle",
        value: gitMarkers,
        description: "Mark added, changed and deleted lines next to the line numbers. Click a bar to review or roll back the change."
      },
      {
        key: "declarationAuthors",
        label: "Show authors next to declarations",
        type: "toggle",
        value: declarationAuthors,
        description: "After each class, interface and method (Java), show who changed it last and when."
      },
      {
        key: "showMetadata",
        label: "Show file metadata",
        type: "toggle",
        value: showMetadata,
        description: "Display the language and file size in the bottom status bar."
      },
      {
        key: "renderMarkdown",
        label: "Preview Markdown files",
        type: "toggle",
        value: renderMarkdown,
        description: "Render Markdown documents. Switch between Preview and Source in the viewer status bar."
      },
      {
        key: "diffMode",
        label: "Diff layout",
        type: "select",
        value: diffMode,
        options: [{ value: "split", label: "Side by side" }, { value: "unified", label: "Unified" }],
        description: "How Git diffs are compared. Switch in the viewer status bar."
      }
    ] }, { key: "viewer-font", title: "Editor font", fields: [
      {
        key: "fontFamily",
        label: "Font",
        type: "select",
        value: editorFont.family,
        options: editorFontOptions,
        description: editorFont.family === GLOBAL_FONT ? "Global default" : "Source editor only"
      },
      ...Object.keys(FONT_NUMBERS).map((key2) => ({
        key: key2,
        label: FONT_NUMBERS[key2].label,
        type: "text",
        value: editorFont[key2],
        placeholder: "Default",
        description: editorFont[key2] ? `Source editor only · ${FONT_NUMBERS[key2].min}–${FONT_NUMBERS[key2].max}` : "Global default"
      }))
    ] }], async (section, key2, value) => {
      if (section === "viewer-font") {
        const next = { ...editorFont };
        if (key2 === "fontFamily") {
          if (typeof value !== "string" || !editorFontOptions.some((o) => o.value === value)) throw new Error("Invalid editor font");
          next.family = value;
        } else if (key2 in FONT_NUMBERS) next[key2] = fontNumber(key2, value);
        else throw new Error("Invalid editor font setting");
        await ctx.modules.call("persistence", "settings.set", { key: "viewer.editorFont", value: next });
        editorFont = next;
        ctx.ui.invalidate();
        return;
      }
      if (key2 === "diffMode") {
        if (value !== "split" && value !== "unified") throw new Error("Invalid diff layout");
        await ctx.modules.call("persistence", "settings.set", { key: "viewer.diffMode", value });
        diffMode = value;
        return;
      }
      if (key2 === "autosaveDelay") {
        const ms = Number(value);
        if (!AUTOSAVE_DELAYS.includes(ms)) throw new Error("Invalid autosave delay");
        await ctx.modules.call("persistence", "settings.set", { key: "viewer.autosaveDelay", value: ms });
        autosaveDelay = ms;
        return;
      }
      if (!["showMetadata", "renderMarkdown", "editable", "autosave", "editorWrap", "viewerWrap", "gitMarkers", "declarationAuthors"].includes(key2) || typeof value !== "boolean") throw new Error("Invalid viewer setting");
      await ctx.modules.call("persistence", "settings.set", { key: `viewer.${key2}`, value });
      if (key2 === "showMetadata") showMetadata = value;
      else if (key2 === "renderMarkdown") renderMarkdown = value;
      else if (key2 === "editable") editable = value;
      else if (key2 === "editorWrap") editorWrap = value;
      else if (key2 === "viewerWrap") viewerWrap = value;
      else if (key2 === "gitMarkers") {
        gitMarkers = value;
        void refreshHead(ctx);
      } else if (key2 === "declarationAuthors") {
        declarationAuthors = value;
        refreshAuthorship(ctx);
      } else {
        autosave = value;
        if (value) scheduleSaves(ctx);
      }
      ctx.ui.invalidate();
    });
    ws = ctx.state.get("workspace.selected") || null;
    restoreTabs();
    ctx.events.on("git-panel.statusChanged", (e) => {
      if (current?.diff && e?.workspaceId === ws?.id && ws?.view?.previewPath === current.tab) void load(ctx, true);
    });
    ctx.events.on("git.changed", (e) => {
      if (e?.workspaceId === ws?.id) {
        heads.clear();
        void refreshHead(ctx);
        forgetBlames();
        refreshAuthorship(ctx);
      }
    });
    ctx.events.on("language-service.configurationChanged", () => {
      void synchronizeLanguage(ctx);
    });
    ctx.events.on("language-service.changed", () => {
      void synchronizeLanguage(ctx);
    });
    ctx.events.on("files.changed", (e) => {
      if (e?.workspaceId === ws?.id) void refreshFromDisk(ctx);
    });
    ctx.state.watch("workspace.selected", (v) => {
      const changed = ws?.id !== v?.id;
      ws = v;
      if (changed) {
        projectLanguageEnabled = true;
        languageError = null;
        navigation = null;
        generation2++;
        current = null;
        loadingPath = null;
        restoreTabs();
      }
      void load(ctx);
    });
    await load(ctx);
  },
  async deactivate(ctx) {
    presentation?.dispose();
    presentation = null;
    if (languageTimer) clearTimeout(languageTimer);
    for (const pending2 of shellRequests.values()) {
      clearTimeout(pending2.timer);
      pending2.reject(new Error("Editor reloaded."));
    }
    shellRequests.clear();
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (autosave) await Promise.all([...buffers.values()].filter((b) => b.state === "dirty").map((b) => save(ctx, b)));
  },
  snapshot: () => ({ current, history: historySnapshot(), buffers: Object.fromEntries([...buffers].filter(([, b]) => b.state !== "clean" || b.mtime != null).map(([d, b]) => [d, { ...b, inflight: false }])) }),
  methods: {
    "language.document"(_ctx, a) {
      if (a.workspaceId !== ws?.id) throw new Error("The editor is showing a different workspace");
      return languageRequest();
    },
    async "editor.openLocation"(ctx, a) {
      if (a.workspaceId !== ws?.id || !validPosition(a.position)) throw new Error("Invalid workspace navigation");
      const path = a.uri ? workspacePath(ws.rootAbsolutePath, a.uri) : a.path ? relativeFile(a.path) : null;
      if (!path) throw new Error("Symbol is outside this workspace or has no source location");
      navigation = { workspaceId: ws.id, path, key: crypto.randomUUID(), ...a.position };
      await ctx.modules.call("workspace", "view.patch", { workspaceId: ws.id, patch: { previewPath: path } });
    },
    async "editor.definitions"(ctx, a) {
      return editorRequest(ctx, a, "definitions");
    },
    async "editor.hover"(ctx, a) {
      const hover = await editorRequest(ctx, a, "hover");
      return hover ? shapeHover(hover, { text: a.text, path: a.path, language: languageForPath(languages, String(a.path || ""))?.grammar }) : hover;
    },
    async "editor.completions"(ctx, a) {
      const [result, owner] = await Promise.all([editorRequest(ctx, a, "completions"), completionOwner(ctx, a).catch(() => null)]);
      return shapeCompletions(result, owner, shapedOriginals, shapeKey);
    },
    async "editor.signature"(ctx, a) {
      return editorRequest(ctx, a, "signatureHelp");
    },
    async "editor.resolveCompletion"(ctx, a) {
      const original = shapedOriginals.get(shapeKey(a.item || {}));
      const buffer = buffers.get(a.document);
      if (!original || !languageService || !buffer || buffer.workspaceId !== a.workspaceId || buffer.path !== a.path) return a.item;
      return ctx.modules.call("language-service", "resolveCompletion", { workspaceId: a.workspaceId, path: a.path, item: original }, { timeoutMs: 45e3 }).catch(() => a.item);
    }
  },
  render() {
    const diff = !!current?.diff;
    const search = ws?.view?.ui?.viewerSearch;
    const editorSearch = search?.path === current?.relativePath && typeof search?.query === "string" && typeof search?.key === "string" ? { key: search.key, query: search.query } : void 0;
    const markdown = current && !diff && !current.binary && (current.language === "markdown" || /\.(md|markdown)$/i.test(current.relativePath));
    const title = current ? diff ? `Changes in ${current.relativePath}` : current.relativePath : ws?.view?.previewPath || "No file selected";
    const kids = [
      { type: "row", key: "tabs", gap: 3, wrap: true, children: tabs.map((path) => {
        const active = ws?.view?.previewPath === path;
        const appearance = presentation?.get(ws.id, diffTabPath(path) || path) || {};
        const tint = appearance.background ? { background: appearance.background } : {};
        const buttonStyle = { ...tabButtonStyle(active), ...tint };
        return { type: "row", key: path, gap: 0, style: { ...fileTabStyle(active), ...tint }, children: [
          { type: "button", key: "select", iconSvg: appearance.iconSvg || fileIcons.file, iconColor: appearance.iconColor, text: tabLabel(path), tooltip: diffTabPath(path) ? `Changes in ${diffTabPath(path)}` : path, action: `select:${path}`, middleClickAction: `close:${path}`, contextAction: `tabMenu:${path}`, contextMenu: [
            { text: "Close", action: `close:${path}` },
            { text: "Close others", action: "closeOthers", value: path, disabled: tabs.length < 2 },
            { text: "Close all to the right", action: "closeRight", value: path, disabled: tabs.indexOf(path) === tabs.length - 1 },
            { text: "Close all", action: "closeAll", value: path }
          ], small: true, variant: "ghost", style: buttonStyle },
          { type: "button", key: "close", text: "", iconSvg: uiIcons["x"], tooltip: `Close ${path}`, action: `close:${path}`, small: true, variant: "ghost", style: buttonStyle }
        ] };
      }) }
    ];
    if (languageError) kids.push({ type: "status", key: "language-error", text: languageError, level: "warn" });
    if (error) kids.push({ type: "status", key: "err", text: error, level: "error" });
    if (loadingPath && current?.tab !== loadingPath) kids.push({ type: "progress", key: "ld", indeterminate: true, label: `Opening ${loadingPath}…` });
    if (current && current.binary) kids.push({ type: "status", key: "bin", text: current.message, level: "info" });
    if (diff) kids.push({ type: "diff", key: "diff", changeNavigation: { previous: "Previous change", next: "Next change" }, document: current.document, mode: diffMode, softWrap: viewerWrap, header: false, emptyText: "No changes against HEAD.", grow: true });
    else if (markdown && renderMarkdown && !editorSearch) {
      const markdownText = bufferFor(current.relativePath)?.text ?? current.text;
      const blocks = typeof markdownText === "string" ? shellBlocks(markdownText) : [];
      if (!blocks.length) kids.push({ type: "markdown", key: "preview", document: current.document, linkAction: "openLink", grow: true });
      else {
        const content = [];
        let offset = 0;
        for (const [index, block] of blocks.entries()) {
          if (offset < block.start) content.push({ type: "markdown", key: `md:${offset}`, text: markdownText.slice(offset, block.start), inline: true, linkAction: "openLink" });
          let fence = "```";
          for (const run of block.code.matchAll(/`+/g)) if (run[0].length >= fence.length) fence = "`".repeat(run[0].length + 1);
          content.push({ type: "column", key: `shell:${block.start}`, style: { paddingY: 12 }, children: [{
            type: "column",
            key: "shell-card",
            gap: 0,
            style: { borderWidth: 1, borderColor: "border", radius: 8, background: "field" },
            children: [
              { type: "row", key: "header", gap: 8, align: "center", style: { background: "panel", borderBottom: 1, borderColor: "border", paddingX: 14, paddingY: 6, minHeight: 36 }, children: [
                { type: "label", key: "language", text: block.language.toUpperCase(), size: "xs", color: "muted", grow: true },
                {
                  type: "button",
                  key: "run",
                  text: "",
                  action: "runShellBlock",
                  value: block.start,
                  variant: "ghost",
                  small: true,
                  iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="m7 4 14 8-14 8Z"/></svg>',
                  iconSize: 16,
                  style: { color: "success", background: "surface", radius: 7, paddingX: 7, paddingY: 4 },
                  tooltip: `Run in block terminal · shell block ${index + 1}`
                }
              ] },
              { type: "markdown", key: "code", codeBlockStyle: { borderWidth: 0, background: "transparent", paddingX: 16, paddingY: 14 }, text: fence + "\n" + block.code + (block.code.endsWith("\n") ? "" : "\n") + fence, inline: true }
            ]
          }] });
          offset = block.end;
        }
        if (offset < markdownText.length) content.push({ type: "markdown", key: `md:${offset}`, text: markdownText.slice(offset), inline: true, linkAction: "openLink" });
        kids.push({ type: "scroll", key: "preview", padding: 12, grow: true, children: content });
      }
    } else {
      const canEdit = editable && !!current && !current.binary && !current.truncated && !!current.document;
      const language = current ? languageForPath(languages, current.relativePath) : null;
      kids.push({
        type: "codeViewer",
        key: "code",
        document: current && !current.binary ? current.document : null,
        placeholder: ws ? "Open a file from the explorer." : "Select a workspace.",
        grow: true,
        editable: canEdit,
        changeAction: canEdit ? "edit" : void 0,
        changeDebounceMs: 250,
        language: language?.grammar,
        syntaxRules: language?.syntaxRules,
        softWrap: editorWrap,
        font: editorFontNode(),
        highlightQuery: Array.isArray(language?.highlightQuery) ? language.highlightQuery.join("\n") : language?.highlightQuery,
        nameCaptures: languageService && language?.server && projectLanguageEnabled ? nameCaptures(ws?.id, current?.relativePath) : void 0,
        definitionMethod: languageService && language?.server && projectLanguageEnabled && !current?.truncated ? "editor.definitions" : void 0,
        hoverMethod: languageService && language?.server && projectLanguageEnabled && !current?.truncated ? "editor.hover" : void 0,
        completionMethod: languageService && language?.server && projectLanguageEnabled && !current?.truncated ? "editor.completions" : void 0,
        completionTriggers: ["."],
        completionMenu: { width: 720, minWidth: 420, maxHeight: 420 },
        signatureMethod: languageService && language?.server && projectLanguageEnabled && !current?.truncated && canEdit ? "editor.signature" : void 0,
        completionResolveMethod: languageService && language?.server && projectLanguageEnabled && !current?.truncated && canEdit ? "editor.resolveCompletion" : void 0,
        lineMarkers: hunks.map((h, index) => ({ line: h.line, endLine: h.line + h.added, color: !h.added ? "danger" : h.removed.length ? "primary" : "success", value: index })),
        lineMarkerAction: "showHunk",
        lineAnnotations: declarationAuthors && current && !current.binary && !current.truncated && ws ? declarationAnnotations(ws.id, current.relativePath, language?.grammar, buffers.get(current.document)?.text ?? current.text) : void 0,
        definitionArgs: { workspaceId: ws?.id, path: current?.relativePath },
        openLocationAction: "openDefinition",
        search: editorSearch,
        contextMenu: current && !current.binary && current.document ? (() => {
          const untracked = heads.get(headKey(ws.id, current.relativePath))?.tracked === false;
          return [
            { text: "View file history", action: "viewHistory", value: "file", disabled: untracked },
            { text: "View selection history", action: "viewHistory", value: "selection", disabled: untracked }
          ];
        })() : void 0,
        reveal: navigation && navigation.workspaceId === ws?.id && navigation?.path === current?.relativePath ? navigation : void 0
      });
    }
    const buf = !diff && current?.document ? buffers.get(current.document) : void 0;
    const status = saveStatus(buf);
    kids.push(
      { type: "row", key: "status-bar", gap: 6, padding: 3, align: "center", children: [
        { type: "label", key: "path", text: title, size: "xs", color: "muted", tooltip: title, grow: true },
        ...diff ? [
          { type: "button", key: "diff-mode", text: diffMode === "split" ? "Unified" : "Side by side", action: "toggleDiffMode", small: true, variant: "ghost", tooltip: "Switch diff layout" },
          ...current.kind !== "deleted" ? [{ type: "button", key: "open-file", text: "Open file", action: "openFile", small: true, variant: "ghost", tooltip: `Open ${current.relativePath}` }] : []
        ] : [],
        ...status.text ? [{ type: "label", key: "save-state", text: status.text, size: "xs", color: status.color, tooltip: status.tooltip }] : [],
        ...buf && (buf.state === "error" || buf.state === "dirty" && !autosave) ? [{ type: "button", key: "save", text: buf.state === "error" ? "Retry" : "Save", action: "save", small: true, variant: "ghost", tooltip: `Save ${current.relativePath}` }] : [],
        ...buf?.state === "conflict" ? [
          { type: "button", key: "overwrite", text: "Overwrite", action: "overwrite", small: true, variant: "ghost", tooltip: "Replace the file on disk with your edits" },
          { type: "button", key: "reload", text: "Reload", action: "reload", small: true, variant: "ghost", tooltip: "Discard your edits and load the file from disk" }
        ] : [],
        ...markdown ? [{ type: "button", key: "markdown-mode", text: renderMarkdown ? "Source" : "Preview", action: "toggleMarkdown", small: true, variant: "ghost", tooltip: renderMarkdown ? "Show Markdown source" : "Render Markdown preview" }] : [],
        { type: "label", key: "lang", text: diff ? current.truncated ? "diff (truncated)" : "" : current && showMetadata ? `${current.language} · ${current.size} B${current.truncated ? " (truncated)" : ""}` : "", size: "xs", color: "muted" }
      ] }
    );
    if (hunkView) {
      const h = hunkView.hunk;
      const kind = !h.added ? "Deleted" : h.removed.length ? "Changed" : "Added";
      const lines2 = h.added ? `${h.line + 1}${h.added > 1 ? `–${h.line + h.added}` : ""}` : `${h.line}–${h.line + 1}`;
      let fence = "```";
      const body = [...h.removed.map((l) => "-" + l), ...h.current.map((l) => "+" + l)].join("\n");
      for (const run of body.matchAll(/`+/g)) if (run[0].length >= fence.length) fence = "`".repeat(run[0].length + 1);
      kids.push({ type: "modal", key: "hunk", title: `${kind} lines ${lines2}`, closeAction: "closeHunk", width: 640, children: [
        { type: "markdown", key: "diff", text: `${fence}diff
${body}
${fence}`, inline: true },
        { type: "row", key: "buttons", gap: 6, children: [
          { type: "label", key: "hint", text: h.removed.length ? `${h.removed.length} line${h.removed.length === 1 ? "" : "s"} in HEAD` : "Not in HEAD", size: "xs", color: "muted", grow: true },
          { type: "button", key: "prev", text: "Previous", action: "stepHunk", value: -1, small: true, variant: "ghost", disabled: hunkView.index === 0 },
          { type: "button", key: "next", text: "Next", action: "stepHunk", value: 1, small: true, variant: "ghost", disabled: hunkView.index >= hunks.length - 1 },
          { type: "button", key: "rollback", text: "Roll back", action: "rollbackHunk", small: true, variant: "danger", disabled: !editable, tooltip: "Restore these lines from HEAD" },
          { type: "button", key: "close", text: "Close", action: "closeHunk", small: true }
        ] }
      ] });
    }
    if (tabMenu && tabs.includes(tabMenu)) kids.push({
      type: "popover",
      key: "tab-menu",
      width: 236,
      top: 34,
      left: 4,
      maxHeight: 124,
      style: { background: "panel", padding: 6, radius: 6, borderWidth: 1, borderColor: "border" },
      closeAction: "dismissTabMenu",
      children: [
        { type: "button", key: "others", text: "Close others", action: "closeOthers", value: tabMenu, variant: "ghost" },
        { type: "button", key: "right", text: "Close all to the right", action: "closeRight", value: tabMenu, variant: "ghost" },
        { type: "button", key: "all", text: "Close all", action: "closeAll", value: tabMenu, variant: "ghost" }
      ]
    });
    const history = historyWindow(diffMode, viewerWrap);
    if (history) kids.push(history);
    return { type: "column", key: "viewer-root", style: { position: "relative" }, gap: 3, padding: 4, grow: true, children: kids };
  },
  async onEvent(ctx, ev) {
    try {
      if (await historyEvent(ctx, ev.action, ev, () => mod.onEvent(ctx, { action: "toggleDiffMode", key: "history", inputs: {} }))) return;
    } catch (e) {
      error = errMsg(e);
      ctx.ui.invalidate();
      return;
    }
    if (!ws) return;
    try {
      if (ev.action === "viewHistory") {
        const v = ev.value || {};
        if (!current || current.diff || v.document !== current.document) return;
        const path = current.relativePath, workspaceId = ws.id;
        if (v.value !== "selection") {
          await openHistory(ctx, { workspaceId, path, range: null, shown: null });
          return;
        }
        const sel = v.selection || {};
        let start = Number(sel.start?.line) || 0, end = Number(sel.end?.line) || 0;
        if (end < start) [start, end] = [end, start];
        if (end > start && Number(sel.end?.character) === 0) end--;
        let head = heads.get(headKey(workspaceId, path));
        if (!head) {
          const r = await ctx.modules.call("git", "headText", { workspaceId, path }, { timeoutMs: 3e4 });
          head = { text: r?.text ?? null, tracked: !!r?.tracked };
          heads.set(headKey(workspaceId, path), head);
        }
        if (!head.tracked) throw new Error(`${path} has no committed history yet.`);
        const text = buffers.get(current.document)?.text ?? current.text;
        const range = head.text !== null && typeof text === "string" ? mapToCommitted(head.text, text, start, end) : [start, end];
        if (!range) throw new Error("The selected lines are not committed yet, so they have no history.");
        await openHistory(ctx, { workspaceId, path, range, shown: [start, end] });
      } else if (ev.action === "openDefinition") {
        const value = ev.value || {};
        if (value.document !== current?.document) return;
        const path = workspacePath(ws.rootAbsolutePath, String(value.uri));
        if (!path) throw new Error("This definition is outside the workspace or uses a virtual document URI; opening it is not supported yet.");
        const position = value.selection?.start;
        if (!validPosition(position)) return;
        navigation = { workspaceId: ws.id, path, key: crypto.randomUUID(), line: position.line, character: position.character };
        languageError = null;
        await ctx.modules.call("workspace", "view.patch", { workspaceId: ws.id, patch: { previewPath: path } });
      } else if (ev.action === "edit") {
        const v = ev.value || {};
        const b = typeof v.document === "string" ? buffers.get(v.document) : void 0;
        if (!b || typeof v.text !== "string") return;
        b.text = v.text;
        if (b.state === "clean" || b.state === "error") b.state = "dirty";
        if (autosave && b.state === "dirty") scheduleSaves(ctx);
        if (current?.document === v.document) updateHunks();
        if (languageTimer) clearTimeout(languageTimer);
        languageTimer = setTimeout(() => {
          languageTimer = null;
          void synchronizeLanguage(ctx);
        }, 500);
      } else if (ev.action === "runShellBlock" && current && !current.diff) {
        const text = bufferFor(current.relativePath)?.text ?? current.text;
        const blocks = typeof text === "string" ? shellBlocks(text) : [];
        const index = blocks.findIndex((block2) => block2.start === ev.value);
        const block = blocks[index];
        if (!block || !block.code.trim()) return;
        await runShellBlock(ctx, { workspaceId: ws.id, path: current.relativePath, block: index, code: block.code, language: block.language });
      } else if (ev.action === "showHunk") {
        const index = Number(ev.value?.marker);
        if (hunks[index]) hunkView = { index, hunk: hunks[index] };
      } else if (ev.action === "closeHunk") {
        hunkView = null;
      } else if (ev.action === "stepHunk" && hunkView) {
        const index = hunkView.index + Number(ev.value);
        if (hunks[index]) {
          hunkView = { index, hunk: hunks[index] };
          navigation = { workspaceId: ws.id, path: current.relativePath, key: crypto.randomUUID(), line: hunks[index].line, character: 0 };
        }
      } else if (ev.action === "rollbackHunk" && hunkView && current?.document) {
        const b = buffers.get(current.document);
        const text = b?.text ?? current.text;
        const h = hunks[hunkView.index];
        if (!b || typeof text !== "string" || !h || JSON.stringify(h) !== JSON.stringify(hunkView.hunk)) {
          hunkView = null;
          return;
        }
        const lines2 = text.split("\n");
        lines2.splice(h.line, h.added, ...h.removed);
        b.text = lines2.join("\n");
        b.state = "dirty";
        hunkView = null;
        await save(ctx, b);
        const state = b.state;
        if (state === "error" || state === "conflict") throw new Error(b.error || "Could not save the rolled back file");
        navigation = { workspaceId: ws.id, path: current.relativePath, key: crypto.randomUUID(), line: h.line, character: 0 };
        if (state === "clean") await load(ctx, true);
      } else if (ev.action === "save") {
        const b = current?.document ? buffers.get(current.document) : void 0;
        if (b && b.text !== null) {
          b.state = "dirty";
          await save(ctx, b);
        }
      } else if (ev.action === "overwrite") {
        const b = current?.document ? buffers.get(current.document) : void 0;
        if (b) await save(ctx, b, true);
      } else if (ev.action === "reload") {
        if (current?.document) buffers.delete(current.document);
        await load(ctx, true);
      } else if (ev.action === "toggleDiffMode") {
        const next = diffMode === "split" ? "unified" : "split";
        await ctx.modules.call("persistence", "settings.set", { key: "viewer.diffMode", value: next });
        diffMode = next;
        publishSettings();
      } else if (ev.action === "openFile" && current?.diff) {
        await ctx.modules.call("workspace", "view.patch", { workspaceId: ws.id, patch: { previewPath: current.relativePath } });
      } else if (ev.action === "toggleMarkdown") {
        const next = !renderMarkdown;
        await ctx.modules.call("persistence", "settings.set", { key: "viewer.renderMarkdown", value: next });
        renderMarkdown = next;
        publishSettings();
      } else if (ev.action === "openLink") {
        const base = current?.relativePath ? current.relativePath.split("/").slice(0, -1).join("/") : "";
        const path = resolveWorkspaceLink(String(ev.value || ""), ws.rootAbsolutePath, base);
        if (!path) throw new Error(`Cannot open link outside the workspace: ${ev.value}`);
        await ctx.modules.call("workspace", "view.patch", { workspaceId: ws.id, patch: { previewPath: path } });
      } else if (ev.action === "dismissTabMenu") {
        tabMenu = null;
      } else if (ev.action.startsWith("tabMenu:")) {
        tabMenu = ev.action.slice(8);
      } else if (ev.action === "closeRight" || ev.action === "closeAll" || ev.action === "closeOthers") {
        const keep = typeof ev.value === "string" ? ev.value : tabMenu || "";
        const index = tabs.indexOf(keep);
        if (index < 0) return;
        if (ev.action === "closeOthers" && ws.view?.previewPath !== keep) await ctx.modules.call("workspace", "view.patch", { workspaceId: ws.id, patch: { previewPath: keep } });
        const closing = ev.action === "closeAll" ? [...tabs] : ev.action === "closeOthers" ? tabs.filter((t) => t !== keep) : tabs.slice(index + 1);
        tabMenu = null;
        for (const path of closing) await mod.onEvent(ctx, { action: `close:${path}`, key: "menu", inputs: {} });
      } else if (ev.action.startsWith("select:")) {
        const path = ev.action.slice(7);
        if (tabs.includes(path)) await ctx.modules.call("workspace", "view.patch", { workspaceId: ws.id, patch: { previewPath: path } });
      } else if (ev.action.startsWith("close:")) {
        const path = ev.action.slice(6), workspaceId = ws.id;
        let index = tabs.indexOf(path);
        if (index < 0) return;
        tabMenu = null;
        const pending2 = bufferFor(path);
        if (pending2?.state === "dirty") await save(ctx, pending2);
        if (ws?.id !== workspaceId) return;
        index = tabs.indexOf(path);
        if (index < 0) return;
        if (unsaved(pending2)) throw new Error(`Cannot close ${path}: save or resolve its unsaved changes first.`);
        tabs.splice(index, 1);
        const previewPath = ws.view?.previewPath === path ? tabs[Math.min(index, tabs.length - 1)] || null : ws.view?.previewPath;
        await ctx.modules.call("workspace", "view.patch", { workspaceId: ws.id, patch: { previewPath, ui: { viewerTabs: [...tabs] } } });
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
