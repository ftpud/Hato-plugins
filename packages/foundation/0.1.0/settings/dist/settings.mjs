// plugins.catalogue.json
var plugins_catalogue_default = {
  schemaVersion: 1,
  coreVersion: "0.1.0",
  packages: [
    {
      id: "foundation",
      name: "Hato essentials",
      type: "System",
      core: true,
      author: "Hato contributors",
      version: "0.1.0",
      coreVersion: "^0.1.0",
      description: "Hato essentials services and panels.",
      dependencies: {},
      modules: [
        "persistence",
        "workspace",
        "projects",
        "files",
        "terminals",
        "workspace-layout",
        "settings",
        "module-dev",
        "explorer",
        "viewer",
        "terminal-panel",
        "projects-panel",
        "left-sidebar",
        "sidebar"
      ]
    },
    {
      id: "core-acp",
      name: "Agent Client Protocol",
      type: "AI",
      core: true,
      author: "Hato contributors",
      version: "0.1.0",
      coreVersion: "^0.1.0",
      description: "Agent Client Protocol services and panels.",
      dependencies: {
        foundation: "^0.1.0"
      },
      modules: [
        "acp",
        "ai-sessions",
        "ai",
        "internal-mcp",
        "internal-local-mcp",
        "internal-remote-mcp",
        "mcp-auth",
        "agent-runner",
        "mcp-panel"
      ]
    },
    {
      id: "git",
      name: "Git",
      type: "Development",
      core: true,
      author: "Hato contributors",
      version: "0.1.0",
      coreVersion: "^0.1.0",
      description: "Git services and panels.",
      dependencies: {
        foundation: "^0.1.0"
      },
      modules: [
        "git",
        "git-panel",
        "git-branch",
        "git-changes",
        "git-tasks"
      ]
    },
    {
      id: "claude-acp",
      name: "Claude ACP",
      type: "AI providers",
      core: false,
      author: "Hato contributors",
      version: "0.1.0",
      coreVersion: "^0.1.0",
      description: "Claude ACP integration and plan usage bar. Requires the Claude adapter installed on the workspace machine.",
      dependencies: {
        foundation: "^0.1.0",
        "core-acp": "^0.1.0"
      },
      modules: [
        "claude-usage"
      ]
    },
    {
      id: "codex-acp",
      name: "Codex ACP",
      type: "AI providers",
      core: false,
      author: "Hato contributors",
      version: "0.1.0",
      coreVersion: "^0.1.0",
      description: "Codex ACP integration and plan usage bar. Requires the Codex adapter installed on the workspace machine.",
      dependencies: {
        foundation: "^0.1.0",
        "core-acp": "^0.1.0"
      },
      modules: [
        "codex-usage"
      ]
    },
    {
      id: "automation",
      name: "Workflows & agents",
      type: "Automation",
      core: false,
      author: "Hato contributors",
      version: "0.1.0",
      coreVersion: "^0.1.0",
      description: "Workflows & agents services and panels.",
      dependencies: {
        foundation: "^0.1.0",
        "core-acp": "^0.1.0"
      },
      modules: [
        "workflows",
        "workflow-runner",
        "workflows-panel",
        "persistent-agents",
        "agents-panel"
      ]
    },
    {
      id: "remote",
      name: "Remote workspaces",
      type: "Connectivity",
      core: false,
      author: "Hato contributors",
      version: "0.1.0",
      coreVersion: "^0.1.0",
      description: "Remote workspaces services and panels.",
      dependencies: {
        foundation: "^0.1.0"
      },
      modules: [
        "remote-runtime",
        "remote-panel"
      ]
    }
  ]
};

// modules/ui/settings/src/marketplace.ts
var REPOSITORY = "ftpud/Hota-plugins";
function satisfies(version2, range) {
  const parse = (s) => /^\d+\.\d+\.\d+$/.test(s) ? s.split(".").map(Number) : null;
  const v = parse(version2), r = parse(range.replace(/^[\^~]/, ""));
  if (!v || !r) return false;
  const cmp = v[0] - r[0] || v[1] - r[1] || v[2] - r[2];
  if (range[0] === "~") return cmp >= 0 && v[0] === r[0] && v[1] === r[1];
  if (range[0] === "^") return cmp >= 0 && v[0] === r[0] && (r[0] > 0 || v[1] === r[1]) && (r[0] > 0 || r[1] > 0 || v[2] === r[2]);
  return cmp === 0;
}
function plan(packages2, id, coreVersion) {
  const done = /* @__PURE__ */ new Set(), visiting = /* @__PURE__ */ new Set(), result = [];
  const visit = (key) => {
    if (done.has(key)) return;
    if (visiting.has(key)) throw Error(`Cyclic package dependency: ${key}`);
    const p = packages2.find((p2) => p2.id === key);
    if (!p) throw Error(`Missing package: ${key}`);
    if (!satisfies(coreVersion, p.coreVersion)) throw Error(`${p.name} requires Hato ${p.coreVersion}`);
    visiting.add(key);
    for (const [dep, range] of Object.entries(p.dependencies)) {
      const d = packages2.find((x) => x.id === dep);
      if (!d || !satisfies(d.version, range)) throw Error(`Unsatisfied dependency: ${dep} ${range}`);
      visit(dep);
    }
    visiting.delete(key);
    done.add(key);
    result.push(p);
  };
  visit(id);
  return result;
}
var packages = plugins_catalogue_default.packages;
var base = "";
var receipts = {};
var tab = "installed";
async function refreshMarket(ctx) {
  receipts = await ctx.modules.call("persistence", "settings.get", { key: "plugins.receipts.v1" }) || {};
  const get = async (url) => {
    const r = await ctx.host.net.fetch({ url, maxBytes: 2 * 1024 * 1024 });
    if (r.status !== 200) throw Error(`Marketplace HTTP ${r.status}`);
    return JSON.parse(r.body);
  };
  const commit = await get(`https://api.github.com/repos/${REPOSITORY}/commits/main`);
  if (!/^[a-f0-9]{40}$/.test(commit.sha)) throw Error("Invalid repository revision");
  const nextBase = `https://raw.githubusercontent.com/${REPOSITORY}/${commit.sha}/`;
  const cat = await get(nextBase + "catalogue.json");
  if (cat.schemaVersion !== 1 || !Array.isArray(cat.packages)) throw Error("Unsupported catalogue");
  const ids = /* @__PURE__ */ new Set(), modules = /* @__PURE__ */ new Set();
  for (const p of cat.packages) {
    if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(p.id) || ids.has(p.id) || typeof p.author !== "string" || typeof p.type !== "string" || !Array.isArray(p.modules) || !p.dependencies || !Array.isArray(p.artifacts)) throw Error("Invalid package metadata");
    ids.add(p.id);
    for (const id of p.modules) {
      if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(id) || modules.has(id)) throw Error("Invalid or duplicate module");
      modules.add(id);
    }
  }
  for (const p of cat.packages) plan(cat.packages, p.id, plugins_catalogue_default.coreVersion);
  packages = cat.packages;
  base = nextBase;
}
function installed(p, plugins2) {
  return p.modules.every((id) => plugins2.some((m) => m.id === id));
}
function version(p, plugins2) {
  return receipts[p.id] || (installed(p, plugins2) && p.modules.every((id) => plugins2.find((m) => m.id === id)?.source === "builtin") ? plugins_catalogue_default.packages.find((b) => b.id === p.id)?.version : void 0);
}
function marketNodes(plugins2, busy) {
  const visible = packages.filter((p) => tab === "marketplace" || installed(p, plugins2));
  return [
    { type: "row", key: "market-tabs", gap: 8, children: [...["installed", "marketplace"].map((t) => ({ type: "button", key: t, text: t === "installed" ? "Installed packages" : "Marketplace", action: "plugin:marketTab", value: t, variant: tab === t ? "primary" : void 0 })), { type: "button", key: "refresh-market", text: "Check for updates", action: "plugin:marketRefresh", disabled: busy }] },
    ...Array.from(new Set(visible.map((p) => p.type))).sort().map((type) => ({ type: "column", key: `group-${type}`, gap: 8, children: [
      { type: "label", key: "group-title", text: type, weight: "semibold", color: "muted" },
      ...visible.filter((p) => p.type === type).map((p) => {
        const has = installed(p, plugins2), v = version(p, plugins2);
        return { type: "column", key: p.id, padding: 12, gap: 6, border: true, children: [
          { type: "row", key: "title", gap: 8, children: [{ type: "label", key: "name", text: p.name, weight: "semibold", grow: true }, { type: "label", key: "version", text: `${p.version}${p.core ? " · Bundled core" : ""}`, color: "muted", size: "xs" }] },
          { type: "label", key: "description", text: p.description, wrap: true, size: "sm" },
          { type: "label", key: "author", text: `By ${p.author} · Hato ${p.coreVersion} · ${p.modules.length} modules`, color: "muted", size: "xs" },
          { type: "label", key: "dependencies", text: `Dependencies: ${Object.keys(p.dependencies).join(", ") || "none"}`, color: "muted", size: "xs" },
          { type: "button", key: "install", text: !has ? "Download & install" : v === p.version ? "Reinstall" : "Update", action: "plugin:marketInstall", value: p.id, disabled: busy || !base, small: true }
        ] };
      })
    ] }))
  ];
}
function marketTab(value) {
  tab = value === "marketplace" ? value : "installed";
}
async function installPackage(ctx, id, plugins2) {
  if (!base) await refreshMarket(ctx);
  const selected = plan(packages, id, plugins_catalogue_default.coreVersion);
  const files = [];
  for (const p of selected) {
    if (p.id !== id && version(p, plugins2) === p.version) continue;
    for (const moduleId of p.modules) {
      const a = p.artifacts?.find((a2) => a2.id === moduleId);
      if (!a) throw Error(`Missing artifact: ${moduleId}`);
      const read = async (path) => {
        if (!/^packages\/[a-z0-9/._-]+$/.test(path) || path.includes("..")) throw Error("Unsafe artifact path");
        const r = await ctx.host.net.fetch({ url: base + path, maxBytes: 16 * 1024 * 1024 });
        if (r.status !== 200) throw Error(`Download failed: ${path}`);
        return r.body;
      };
      const manifest = await read(a.manifest), m = JSON.parse(manifest);
      if (m.id !== moduleId || m.version !== p.version || m.moduleApiVersion !== 1 || m.pluginPackage !== p.id) throw Error("Artifact metadata mismatch");
      files.push({ id: moduleId, manifest, code: await read(a.bundle) });
    }
  }
  let pendingRestart = false;
  const root = ctx.host.env.info().dataDir + "/marketplace-downloads";
  const grant = await ctx.host.capabilities.request({ kind: "fs", root: ctx.host.env.info().dataDir, write: true, purpose: "Download plugin packages" });
  try {
    await ctx.host.fs.mkdir(grant.grant, root);
    for (const f of files) {
      const dir = root + "/" + f.id;
      await ctx.host.fs.mkdir(grant.grant, dir);
      await ctx.host.fs.mkdir(grant.grant, dir + "/dist");
      await ctx.host.fs.writeAtomic(grant.grant, dir + "/manifest.json", f.manifest);
      await ctx.host.fs.writeAtomic(grant.grant, dir + "/dist/" + f.id + ".mjs", f.code);
      const result = await ctx.host.plugins.install(dir);
      pendingRestart || (pendingRestart = !!result.pendingRestart);
    }
    for (const p of selected) {
      receipts[p.id] = p.version;
      await ctx.modules.call("persistence", "settings.set", { key: "plugins.receipts.v1", value: receipts });
    }
  } finally {
    await ctx.host.capabilities.release(grant.grant);
  }
  return `Installed ${id}.${pendingRestart ? " Restart Hato to load the updated plugin manager." : ""} Enable new modules below to approve their permissions.`;
}

// sdk/settings-order.ts
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

// sdk/ui-table.ts
var defaultTableStyle = { density: "comfortable", stripes: true, dividers: false };
function normalizeTableStyle(raw) {
  return { density: ["compact", "comfortable", "spacious"].includes(raw?.density) ? raw.density : "comfortable", stripes: raw?.stripes !== false, dividers: raw?.dividers === true };
}
function uiTable(key, rows, style = defaultTableStyle) {
  return { type: "column", key, gap: 0, style: { borderColor: "border", borderWidth: 1, radius: 8 }, children: [
    { type: "row", key: "head", gap: 16, padding: 10, bg: "panel", children: [{ type: "label", key: "name", text: "Setting", grow: true, size: "xs", weight: "semibold", color: "muted" }, { type: "label", key: "value", text: "Value", width: 220, size: "xs", weight: "semibold", color: "muted" }] },
    ...rows.map((row, i) => ({ type: "row", key: row.key, gap: 16, padding: style.density === "compact" ? 6 : style.density === "spacious" ? 14 : 10, align: "center", style: { ...style.stripes && i % 2 === 1 ? { background: "raised" } : {}, ...style.dividers ? { borderBottom: 1, borderColor: "border" } : {} }, children: [
      { type: "column", key: "label", grow: true, gap: 3, children: [{ type: "label", key: "name", text: row.label, size: "sm", wrap: true }, ...row.description ? [{ type: "label", key: "description", text: row.description, size: "xs", color: "muted", wrap: true }] : []] },
      { type: "column", key: "control", width: 220, children: [row.control] }
    ] }))
  ] };
}

// sdk/runtime.ts
function errMsg(e) {
  return e && (e.message || String(e)) || "unknown error";
}

// modules/ui/settings/src/index.ts
var open = false;
var selectedCategory = "";
var query = "";
var error = null;
var providers = [];
var subscriptions = /* @__PURE__ */ new Map();
var refreshVersion = 0;
var plugins = [];
var rootPlugin = null;
var rootOverride = null;
var pluginBusy = null;
var pluginStatus = null;
var pendingCascade = null;
async function refresh(ctx) {
  const version2 = ++refreshVersion;
  try {
    const modules = await ctx.host.modules.list();
    if (version2 !== refreshVersion) return;
    providers = modules.filter((m) => m.active && m.id !== ctx.moduleId).map((m) => m.id).sort();
    const list = await ctx.host.plugins.list();
    if (version2 !== refreshVersion) return;
    plugins = list.plugins;
    rootPlugin = list.root;
    rootOverride = list.rootOverride;
    for (const [id, stop] of subscriptions) if (!providers.includes(id)) {
      stop();
      subscriptions.delete(id);
    }
    for (const id of providers) if (!subscriptions.has(id)) {
      subscriptions.set(id, ctx.state.watch(`${id}.settings`, () => ctx.ui.invalidate()));
    }
    error = null;
  } catch (e) {
    if (version2 === refreshVersion) error = errMsg(e);
  }
  ctx.ui.invalidate();
}
function categories(ctx) {
  const result = [{ key: "plugins", title: "Plugins" }];
  const seen = /* @__PURE__ */ new Set();
  for (const module of providers) {
    const contribution = ctx.state.get(`${module}.settings`);
    if (!Array.isArray(contribution?.sections)) continue;
    for (const section of contribution.sections) {
      if (!section || typeof section.key !== "string" || !Array.isArray(section.fields)) continue;
      const key = JSON.stringify([module, section.key]);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ key, title: section.title || section.key, module, section, error: contribution.error });
    }
  }
  return result;
}
function categoryGroup(category) {
  if (category.section?.group) return category.section.group;
  if (category.key === "plugins") return "Advanced";
  if (["appearance", "typography", "tables"].includes(category.section?.key || "")) return "Appearance";
  if (["side-panels", "sidebar-order", "panel-sharing", "workspace-chrome"].includes(category.section?.key || "")) return "Workspace";
  if (["viewer", "git-changes", "git-panel"].includes(category.module || "")) return "Editor & Git";
  if ((category.module || "").includes("mcp")) return "AI & tools";
  return "Tools & runtime";
}
function orderEditor(field, key) {
  let items;
  try {
    items = parseOrder(field.value, field.items.map((i) => i.id), field.allowSpacers);
  } catch {
    items = field.items.map((i) => i.id);
  }
  const button = (id, text, operation, index = -1, disabled = false) => ({ type: "button", key: id, text, action: `order:${operation}`, value: { field: key, index }, small: true, variant: "ghost", disabled });
  return { type: "column", key, gap: 5, border: true, padding: 10, children: [
    { type: "row", key: "heading", gap: 6, children: [{ type: "label", key: "title", text: field.label, weight: "semibold", grow: true }, ...field.allowSpacers ? [button("add", "+ Spacer", "add")] : []] },
    ...items.map((id, index) => ({ type: "row", key: id, gap: 5, padding: 4, children: [
      { type: "label", key: "name", text: id.startsWith(SPACER_PREFIX) ? "— Spacer —" : field.items.find((i) => i.id === id)?.label || id, color: id.startsWith(SPACER_PREFIX) ? "muted" : "default", grow: true, size: "sm" },
      button("up", "↑", "up", index, index === 0),
      button("down", "↓", "down", index, index === items.length - 1),
      ...id.startsWith(SPACER_PREFIX) ? [button("remove", "×", "remove", index)] : []
    ] })),
    ...!items.length ? [{ type: "label", key: "empty", text: "No buttons here. Choose positions on the Side panels page.", color: "muted", wrap: true, size: "xs" }] : []
  ] };
}
var mod = {
  id: "settings",
  moduleApiVersion: 1,
  async activate(ctx, prev) {
    open = !!prev?.open;
    query = prev?.query || "";
    ctx.events.on("workspace-layout.tableStyleChanged", () => ctx.ui.invalidate());
    selectedCategory = typeof prev?.selectedCategory === "string" ? prev.selectedCategory : "";
    if (ctx.host.plugins.rescan) await ctx.host.plugins.rescan();
    ctx.events.on("kernel.modules.changed", () => {
      void refresh(ctx);
    });
    await refresh(ctx);
  },
  deactivate() {
    for (const stop of subscriptions.values()) stop();
    subscriptions.clear();
  },
  snapshot: () => ({ open, selectedCategory, query }),
  methods: { async open(ctx, args) {
    open = true;
    if (typeof args?.module === "string" && typeof args?.section === "string") selectedCategory = JSON.stringify([args.module, args.section]);
    else if (args?.category === "plugins") selectedCategory = args.category;
    if (args?.category || args?.module) query = "";
    ctx.ui.invalidate();
    await refresh(ctx);
  } },
  render(ctx) {
    if (!open) return { type: "column", key: "settings-closed", children: [] };
    const all = categories(ctx), needle = query.trim().toLowerCase();
    const list = all.filter((c) => !needle || [c.title, c.section?.description, ...(c.section?.fields || []).flatMap((f) => [f.label, f.description])].join(" ").toLowerCase().includes(needle));
    if (!list.length) return { type: "modal", key: "settings-modal", title: "Settings", width: 960, closeAction: "close", children: [
      { type: "textInput", key: "settings-search", value: query, changeAction: "search", placeholder: "Search settings…" },
      { type: "label", key: "none", text: "No matching settings.", color: "muted" }
    ] };
    const active = list.find((category) => category.key === selectedCategory) || list.find((c) => c.section?.key === "appearance") || list.find((c) => c.key !== "plugins") || list[0];
    selectedCategory = active.key;
    const options = [
      { type: "label", key: "category-title", text: active.title, weight: "semibold" }
    ];
    if (active.key === "plugins") options.push(...pluginsPage());
    if (active.error) options.push({ type: "status", key: "category-error", text: active.error, level: "error" });
    if (active.section?.description) options.push({ type: "label", key: "category-description", text: active.section.description, size: "sm", color: "muted", wrap: true });
    const tableRows = [];
    for (const field of active.section?.fields || []) {
      if (!field || typeof field.key !== "string") continue;
      const fieldKey = JSON.stringify([active.module, active.section.key, field.key]);
      if (field.type === "order") {
        options.push(orderEditor(field, fieldKey));
        continue;
      }
      const control = field.type === "toggle" ? { type: "toggle", key: fieldKey, label: active.section?.layout === "table" ? "" : field.label, checked: field.value, action: "change" } : { type: "select", key: fieldKey, value: field.value, options: field.options, action: "change", buttonStyle: { height: 32, fullWidth: true } };
      if (active.section?.layout === "table") tableRows.push({ key: fieldKey, label: field.label, description: field.description, control });
      else options.push({ type: "column", key: `${fieldKey}:field`, gap: 5, padding: 10, border: true, children: [
        ...field.type === "select" ? [{ type: "label", key: "label", text: field.label, size: "sm", weight: "medium" }] : [],
        control,
        ...field.description ? [{ type: "label", key: "description", text: field.description, size: "xs", color: "muted", wrap: true }] : []
      ] });
    }
    if (tableRows.length) options.push(uiTable("preferences-table", tableRows, normalizeTableStyle(ctx.state.get("workspace-layout.tableStyle"))));
    const resetLabel = active.module ? ctx.state.get(`${active.module}.settings`)?.resetLabel : null;
    if (resetLabel) options.push({ type: "column", key: "reset-preferences", gap: 6, padding: 10, border: true, children: [
      { type: "label", key: "description", text: "Restore default appearance, typography, panel placement, sharing, sidebar buttons, spacers and table styling. Workflows, chats and provider settings are preserved.", size: "sm", color: "muted", wrap: true },
      { type: "button", key: "reset", text: resetLabel, action: "resetPreferences", value: active.module, variant: "danger", small: true }
    ] });
    const groups = ["Appearance", "Workspace", "Editor & Git", "AI & tools", "Tools & runtime", "Advanced"];
    const navigation = [];
    for (const group of [...groups, ...new Set(list.map(categoryGroup).filter((g) => !groups.includes(g)))]) {
      const entries = list.filter((c) => categoryGroup(c) === group);
      if (!entries.length) continue;
      navigation.push({ type: "label", key: `group:${group}`, text: group.toUpperCase(), size: "xs", color: "muted", weight: "semibold", padding: 6 });
      navigation.push(...entries.map((category) => ({
        type: "choice",
        key: category.key,
        text: category.title,
        selected: active.key === category.key,
        description: category.error ? "Needs attention" : void 0,
        action: "selectCategory",
        value: category.key
      })));
    }
    return { type: "modal", key: "settings-modal", title: "Settings", width: 960, closeAction: "close", children: [
      ...error ? [{ type: "status", key: "error", text: error, level: "error" }] : [],
      { type: "textInput", key: "settings-search", value: query, changeAction: "search", placeholder: "Search settings…" },
      { type: "row", key: "settings-content", height: 520, gap: 12, align: "stretch", children: [
        { type: "column", key: "categories", width: 200, gap: 4, scroll: true, borderSide: "right", children: navigation },
        { type: "column", key: `options:${active.key}`, gap: 10, grow: true, scroll: true, children: options }
      ] }
    ] };
  },
  async onEvent(ctx, event) {
    if (event.action === "resetPreferences") {
      const module = String(event.value || "");
      if (providers.includes(module) && ctx.state.get(`${module}.settings`)?.resetLabel) ctx.events.emit("settings.reset", { module });
      return;
    }
    if (event.action === "search") {
      query = String(event.value || "");
      ctx.ui.invalidate();
      return;
    }
    if (event.action.startsWith("order:")) {
      try {
        const payload = event.value;
        if (!payload || typeof payload.field !== "string") return;
        const [module, section, key] = JSON.parse(payload.field);
        const field = categories(ctx).find((c) => c.module === module && c.section?.key === section)?.section?.fields.find((f) => f.key === key);
        if (field?.type !== "order") return;
        const items = parseOrder(field.value, field.items.map((i) => i.id), field.allowSpacers), index = Number(payload.index);
        const action = event.action.slice(6);
        if (action === "add" && field.allowSpacers) items.push(SPACER_PREFIX + crypto.randomUUID());
        else if (action === "remove" && items[index]?.startsWith(SPACER_PREFIX)) items.splice(index, 1);
        else if (action === "up" && index > 0 && index < items.length) [items[index - 1], items[index]] = [items[index], items[index - 1]];
        else if (action === "down" && index >= 0 && index + 1 < items.length) [items[index + 1], items[index]] = [items[index], items[index + 1]];
        else return;
        parseOrder(JSON.stringify(items), field.items.map((i) => i.id), field.allowSpacers);
        ctx.events.emit("settings.change", { module, section, key, value: JSON.stringify(items) });
      } catch (e) {
        error = errMsg(e);
        ctx.ui.invalidate();
      }
      return;
    }
    if (event.action === "close") {
      open = false;
      ctx.ui.invalidate();
      return;
    }
    if (event.action === "plugin:toggle" && event.key.startsWith("enabled:")) {
      await togglePlugin(ctx, event.key.slice(8), !!event.value);
      return;
    }
    if (event.action.startsWith("plugin:")) {
      await pluginAction(ctx, event.action.slice(7), event.value);
      return;
    }
    if (event.action === "selectCategory") {
      if (categories(ctx).some((category) => category.key === event.value)) selectedCategory = String(event.value);
      ctx.ui.invalidate();
      return;
    }
    if (event.action !== "change") return;
    try {
      const [module, section, key] = JSON.parse(event.key);
      const category = categories(ctx).find((category2) => category2.module === module && category2.section?.key === section);
      if (!category || !category.section.fields.some((field) => field.key === key)) return;
      ctx.events.emit("settings.change", { module, section, key, value: event.value });
    } catch (e) {
      error = errMsg(e);
      ctx.ui.invalidate();
    }
  }
};
var index_default = mod;
function pluginRow(p) {
  const status = !p.enabled ? "disabled" : p.active ? p.active : p.lastError ? "failed" : "loading";
  const facts = [
    p.kind,
    p.source === "user" ? "user plugin" : "built-in",
    p.runsOn !== "ui" ? `runs on: ${p.runsOn}` : null,
    p.provides.length ? `provides ${p.provides.join(", ")}` : null,
    p.requires.length ? `needs ${p.requires.join(", ")}` : null
  ].filter(Boolean).join(" · ");
  const isRootProvider = p.provides.includes("shell.root");
  const busy = pluginBusy !== null;
  return { type: "column", key: `plugin:${p.id}`, gap: 4, padding: 8, border: true, children: [
    { type: "row", key: "head", gap: 8, align: "center", children: [
      { type: "column", key: "title", grow: true, gap: 2, children: [
        { type: "label", key: "name", text: p.name === p.id ? p.id : `${p.name}  (${p.id})`, weight: "semibold", size: "sm" },
        { type: "label", key: "facts", text: facts, size: "xs", color: "muted" }
      ] },
      { type: "label", key: "status", text: status, size: "xs", color: !p.enabled ? "muted" : p.active ? "success" : "danger", mono: true },
      {
        type: "switch",
        key: `enabled:${p.id}`,
        label: "",
        checked: p.enabled,
        action: "plugin:toggle",
        disabled: busy || p.id === "settings",
        tooltip: p.id === "settings" ? "Settings cannot disable itself" : p.enabled ? "Disable plugin" : p.pendingApprovals.length ? "Enable (asks to approve its permissions)" : "Enable plugin"
      }
    ] },
    ...p.description ? [{ type: "label", key: "desc", text: p.description, size: "xs", color: "muted", wrap: true }] : [],
    ...p.pendingApprovals.length && !p.enabled ? [{ type: "label", key: "perm", text: `Needs approval: ${p.pendingApprovals.join(", ")}`, size: "xs", color: "warning", wrap: true }] : [],
    ...p.enabled && p.lastError && !p.active ? [{ type: "label", key: "err", text: p.lastError, size: "xs", color: "danger", wrap: true }] : [],
    ...isRootProvider || p.source === "user" ? [{ type: "row", key: "actions", gap: 6, children: [
      ...isRootProvider ? [{
        type: "button",
        key: "root",
        text: rootPlugin === p.id ? rootOverride === p.id ? "Window root (pinned)" : "Window root" : "Use as window root",
        action: "plugin:setRoot",
        value: p.id,
        small: true,
        disabled: busy || !p.enabled || rootOverride === p.id
      }] : [],
      ...rootOverride === p.id ? [{ type: "button", key: "unpin", text: "Automatic root", action: "plugin:setRoot", value: null, small: true, disabled: busy }] : [],
      ...p.source === "user" ? [{ type: "button", key: "uninstall", text: "Uninstall", action: "plugin:uninstall", value: p.id, small: true, variant: "danger", disabled: busy }] : []
    ] }] : []
  ] };
}
function pluginsPage() {
  const user = plugins.filter((p) => p.source === "user");
  const builtin = plugins.filter((p) => p.source === "builtin");
  return [
    ...marketNodes(plugins, pluginBusy !== null),
    { type: "label", key: "plugins-hint", text: "Everything in Hato is a plugin. Disable built-ins you do not need, or install your own: a folder with manifest.json and a built dist/<id>.mjs. New plugins stay disabled until you enable them and approve their permissions.", size: "sm", color: "muted", wrap: true },
    { type: "row", key: "plugin-tools", gap: 6, children: [
      { type: "button", key: "install", text: "Install from folder…", action: "plugin:install", small: true, variant: "primary", disabled: pluginBusy !== null },
      { type: "button", key: "rescan", text: "Rescan plugins folder", action: "plugin:rescan", small: true, disabled: pluginBusy !== null }
    ] },
    ...pluginBusy ? [{ type: "progress", key: "plugin-busy", indeterminate: true, label: pluginBusy }] : [],
    ...pluginStatus ? [{ type: "status", key: "plugin-status", text: pluginStatus.text, level: pluginStatus.level }] : [],
    ...pendingCascade ? [{ type: "row", key: "cascade", gap: 6, align: "center", children: [
      { type: "label", key: "t", text: `Also disable: ${pendingCascade.dependents}?`, size: "sm", grow: true, wrap: true },
      { type: "button", key: "yes", text: "Disable all", action: "plugin:cascade", value: pendingCascade.id, small: true, variant: "danger" },
      { type: "button", key: "no", text: "Cancel", action: "plugin:cancelCascade", small: true }
    ] }] : [],
    ...user.length ? [{ type: "label", key: "user-h", text: "Your plugins", weight: "semibold", size: "sm" }, ...user.map(pluginRow)] : [],
    { type: "label", key: "builtin-h", text: "Built-in plugins", weight: "semibold", size: "sm" },
    ...builtin.map(pluginRow)
  ];
}
async function pluginAction(ctx, action, value) {
  const run = async (label, fn) => {
    pluginBusy = label;
    pluginStatus = null;
    ctx.ui.invalidate();
    try {
      const text = await fn();
      if (text) pluginStatus = { level: "success", text };
    } catch (e) {
      if (e?.code === "EDEPENDENTS") pendingCascade = { id: String(value), dependents: errMsg(e).replace(/^.*?:\s*/, "") };
      else pluginStatus = { level: "error", text: errMsg(e) };
    } finally {
      pluginBusy = null;
      await refresh(ctx);
    }
  };
  switch (action) {
    case "marketTab":
      marketTab(String(value));
      ctx.ui.invalidate();
      return;
    case "marketRefresh":
      return run("Checking marketplace…", async () => {
        await refreshMarket(ctx);
        return "Marketplace is up to date";
      });
    case "marketInstall":
      return run("Installing package…", () => installPackage(ctx, String(value), plugins));
    case "setRoot":
      return run("Changing window root…", async () => {
        await ctx.host.plugins.setRoot(typeof value === "string" ? value : null);
        return null;
      });
    case "uninstall":
      return run(`Uninstalling ${value}…`, async () => {
        await ctx.host.plugins.uninstall(String(value));
        return `Uninstalled ${value}`;
      });
    case "rescan":
      return run("Scanning plugins folder…", async () => {
        const r = await ctx.host.plugins.rescan();
        return r.added.length ? `Found ${r.added.join(", ")}` : "No new plugins";
      });
    case "install":
      return run("Installing plugin…", async () => {
        const path = await ctx.host.ui.pickFolder();
        if (!path) return null;
        const r = await ctx.host.plugins.install(path);
        return `Installed ${r.id}. Enable it below to load it.`;
      });
    case "cascade": {
      const id = String(value);
      pendingCascade = null;
      return run(`Disabling ${id}…`, async () => {
        const r = await ctx.host.plugins.disable(id, { cascade: true });
        return `Disabled ${r.disabled.join(", ")}`;
      });
    }
    case "cancelCascade":
      pendingCascade = null;
      ctx.ui.invalidate();
      return;
  }
}
async function togglePlugin(ctx, id, enabled) {
  pluginBusy = `${enabled ? "Enabling" : "Disabling"} ${id}…`;
  pluginStatus = null;
  pendingCascade = null;
  ctx.ui.invalidate();
  try {
    if (enabled) {
      const r = await ctx.host.plugins.enable(id);
      pluginStatus = r.active ? { level: "success", text: `${id} enabled` } : { level: "warn", text: `${id} enabled but not running: ${r.error || "unknown error"}` };
    } else {
      const r = await ctx.host.plugins.disable(id);
      pluginStatus = { level: "success", text: `Disabled ${r.disabled.join(", ")}` };
    }
  } catch (e) {
    if (e?.code === "EDEPENDENTS") pendingCascade = { id, dependents: errMsg(e).replace(/^.*?:\s*/, "") };
    else pluginStatus = { level: "error", text: errMsg(e) };
  } finally {
    pluginBusy = null;
    await refresh(ctx);
  }
}
export {
  index_default as default
};
