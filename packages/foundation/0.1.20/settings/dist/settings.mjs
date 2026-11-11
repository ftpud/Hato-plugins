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
function hasher() {
  const buf = new Uint8Array(64);
  const view = new DataView(buf.buffer);
  let used = 0;
  let length = 0;
  const H = new Uint32Array([1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225]);
  const W = new Uint32Array(64);
  const compress = () => {
    for (let i = 0; i < 16; i++) W[i] = view.getUint32(i * 4);
    for (let i = 16; i < 64; i++) {
      const a2 = W[i - 15], b2 = W[i - 2];
      const s0 = (a2 >>> 7 | a2 << 25) ^ (a2 >>> 18 | a2 << 14) ^ a2 >>> 3;
      const s1 = (b2 >>> 17 | b2 << 15) ^ (b2 >>> 19 | b2 << 13) ^ b2 >>> 10;
      W[i] = W[i - 16] + s0 + W[i - 7] + s1 >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = (e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7);
      const ch = e & f ^ ~e & g;
      const t1 = h + S1 + ch + K[i] + W[i] >>> 0;
      const S0 = (a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10);
      const mj = a & b ^ a & c ^ b & c;
      const t2 = S0 + mj >>> 0;
      h = g;
      g = f;
      f = e;
      e = d + t1 >>> 0;
      d = c;
      c = b;
      b = a;
      a = t1 + t2 >>> 0;
    }
    H[0] = H[0] + a >>> 0;
    H[1] = H[1] + b >>> 0;
    H[2] = H[2] + c >>> 0;
    H[3] = H[3] + d >>> 0;
    H[4] = H[4] + e >>> 0;
    H[5] = H[5] + f >>> 0;
    H[6] = H[6] + g >>> 0;
    H[7] = H[7] + h >>> 0;
  };
  const byte = (b) => {
    buf[used++] = b;
    length++;
    if (used === 64) {
      compress();
      used = 0;
    }
  };
  const update = (text, from, to) => {
    let i = from;
    for (; i < to; i++) {
      let c = text.charCodeAt(i);
      if (c >= 55296 && c <= 56319) {
        const d = text.charCodeAt(i + 1);
        if (d >= 56320 && d <= 57343) {
          c = 65536 + (c - 55296 << 10) + d - 56320;
          i++;
        } else c = 65533;
      } else if (c >= 56320 && c <= 57343) c = 65533;
      if (c < 128) byte(c);
      else if (c < 2048) {
        byte(192 | c >> 6);
        byte(128 | c & 63);
      } else if (c < 65536) {
        byte(224 | c >> 12);
        byte(128 | c >> 6 & 63);
        byte(128 | c & 63);
      } else {
        byte(240 | c >> 18);
        byte(128 | c >> 12 & 63);
        byte(128 | c >> 6 & 63);
        byte(128 | c & 63);
      }
    }
    return i;
  };
  const finish = () => {
    const bits = length * 8;
    byte(128);
    while (used !== 56) byte(0);
    view.setUint32(56, Math.floor(bits / 4294967296));
    view.setUint32(60, bits >>> 0);
    compress();
    let out = "";
    for (let i = 0; i < 8; i++) out += H[i].toString(16).padStart(8, "0");
    return out;
  };
  return { update, finish };
}
async function sha256HexAsync(text, chunk = 256 * 1024) {
  const h = hasher();
  for (let i = 0; i < text.length; ) {
    i = h.update(text, i, Math.min(i + chunk, text.length));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return h.finish();
}

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
      version: "0.1.20",
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
      name: "AI Chat",
      type: "AI",
      core: true,
      author: "Hato contributors",
      version: "0.1.7",
      coreVersion: "^0.1.0",
      description: "Provider-independent ACP sessions, chat UI and MCP tools. Install AI providers separately.",
      dependencies: {
        foundation: "^0.1.0"
      },
      modules: [
        "acp",
        "ai-sessions",
        "ai",
        "internal-mcp",
        "internal-local-mcp",
        "mcp-auth",
        "mcp-panel"
      ]
    },
    {
      id: "git",
      name: "Git",
      type: "Development",
      core: true,
      author: "Hato contributors",
      version: "0.1.8",
      coreVersion: "^0.1.0",
      description: "Git changes, branch controls, worktree tasks and history panels.",
      dependencies: {
        foundation: "^0.1.0"
      },
      modules: [
        "git",
        "git-panel",
        "git-branch",
        "git-changes",
        "git-tasks",
        "git-history",
        "git-task-changes"
      ]
    },
    {
      id: "claude-acp",
      name: "Claude",
      type: "AI providers",
      core: false,
      author: "Hato contributors",
      version: "0.1.4",
      coreVersion: "^0.1.0",
      description: "Claude provider, adapter setup and plan usage bar. Install this plugin to use Claude in chats, agents and workflows.",
      dependencies: {
        foundation: "^0.1.0",
        "core-acp": "^0.1.0"
      },
      modules: [
        "claude-provider",
        "claude-usage"
      ]
    },
    {
      id: "codex-acp",
      name: "Codex",
      type: "AI providers",
      core: false,
      author: "Hato contributors",
      version: "0.1.4",
      coreVersion: "^0.1.0",
      description: "Codex provider, adapter setup and plan usage bar. Install this plugin to use Codex in chats, agents and workflows.",
      dependencies: {
        foundation: "^0.1.0",
        "core-acp": "^0.1.0"
      },
      modules: [
        "codex-provider",
        "codex-usage"
      ]
    },
    {
      id: "copilot-acp",
      name: "GitHub Copilot",
      type: "AI providers",
      core: false,
      author: "Hato contributors",
      version: "0.1.0",
      coreVersion: "^0.1.0",
      description: "GitHub Copilot CLI using its native ACP server. Available in AI Chat and Background Agents; install and authenticate Copilot on the workspace machine.",
      dependencies: {
        foundation: "^0.1.0",
        "core-acp": "^0.1.7"
      },
      modules: [
        "copilot-provider"
      ]
    },
    {
      id: "agents",
      name: "Background Agents",
      type: "Automation",
      core: false,
      author: "Hato contributors",
      version: "0.1.5",
      coreVersion: "^0.1.0",
      description: "Persistent agent runtime, background agent panel and workspace tools. Supports local and SSH machines.",
      dependencies: {
        foundation: "^0.1.0",
        "core-acp": "^0.1.0",
        git: "^0.1.0"
      },
      modules: [
        "agent-runner",
        "internal-remote-mcp",
        "persistent-agents",
        "agents-panel"
      ]
    },
    {
      id: "automation",
      name: "Workflows",
      type: "Automation",
      core: false,
      author: "Hato contributors",
      version: "0.1.3",
      coreVersion: "^0.1.0",
      description: "Visual workflow editor and execution runtime. Uses Background Agents to run agent steps.",
      dependencies: {
        foundation: "^0.1.0",
        "core-acp": "^0.1.0",
        agents: "^0.1.0"
      },
      modules: [
        "workflows",
        "workflow-runner",
        "workflows-panel"
      ]
    },
    {
      id: "remote",
      name: "Remote workspaces",
      type: "Connectivity",
      core: false,
      author: "Hato contributors",
      version: "0.1.3",
      coreVersion: "^0.1.0",
      description: "Remote workspaces services and panels.",
      dependencies: {
        foundation: "^0.1.0"
      },
      modules: [
        "remote-runtime",
        "remote-panel"
      ]
    },
    {
      id: "language-service",
      name: "Language services",
      type: "Languages",
      core: false,
      author: "Hato contributors",
      version: "0.1.10",
      coreVersion: "^0.1.0",
      description: "Shared language support for local and SSH workspaces.",
      dependencies: {
        foundation: "^0.1.8"
      },
      modules: [
        "language-service",
        "language-tools",
        "language-status"
      ]
    },
    {
      id: "language-java",
      name: "Java",
      type: "Languages",
      core: false,
      author: "Hato contributors",
      version: "0.1.6",
      coreVersion: "^0.1.0",
      description: "Java highlighting and Eclipse JDTLS navigation.",
      dependencies: {
        "language-service": "^0.1.6"
      },
      modules: [
        "language-java"
      ]
    },
    {
      id: "language-typescript",
      name: "JavaScript & TypeScript",
      type: "Languages",
      core: false,
      author: "Hato contributors",
      version: "0.1.1",
      coreVersion: "^0.1.0",
      description: "JS/TS/JSX/TSX highlighting and language server navigation.",
      dependencies: {
        "language-service": "^0.1.2"
      },
      modules: [
        "language-typescript"
      ]
    },
    {
      id: "language-sap",
      name: "SAP syntax",
      type: "Languages",
      core: false,
      author: "Hato contributors",
      version: "0.1.0",
      coreVersion: "^0.1.0",
      description: "CDS, MTA/MTAEXT, CAP and HANA syntax highlighting.",
      dependencies: {
        foundation: "^0.1.0"
      },
      modules: [
        "language-sap"
      ]
    }
  ]
};

// modules/ui/settings/src/marketplace.ts
var REPOSITORY = "ftpud/Hato-plugins";
function satisfies(version, range) {
  const parse = (s) => /^\d+\.\d+\.\d+$/.test(s) ? s.split(".").map(Number) : null;
  const v = parse(version), r = parse(range.replace(/^[\^~]/, ""));
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
var published = [];
function mergeCatalogues(local, remote) {
  const merged = new Map(remote.map((p) => [p.id, p]));
  for (const p of local) {
    const existing = merged.get(p.id);
    if (!existing || isNewer(p.version, existing.version)) merged.set(p.id, p);
  }
  return [...merged.values()];
}
var receipts = {};
var tab = "marketplace";
var search = "";
var selection = "";
var collapsed = /* @__PURE__ */ new Set();
var expandedModules = /* @__PURE__ */ new Set();
function pluginBrowserSnapshot() {
  return { tab, search, selection, collapsed: [...collapsed], expandedModules: [...expandedModules] };
}
function restorePluginBrowser(state) {
  tab = ["installed", "builtin"].includes(state?.tab) ? state.tab : "marketplace";
  search = typeof state?.search === "string" ? state.search : "";
  selection = typeof state?.selection === "string" ? state.selection : "";
  collapsed.clear();
  expandedModules.clear();
  if (Array.isArray(state?.expandedModules)) {
    for (const id of state.expandedModules) if (typeof id === "string") expandedModules.add(id);
  }
  if (Array.isArray(state?.collapsed)) {
    for (const key of state.collapsed) if (typeof key === "string") collapsed.add(key);
  }
}
function pluginBrowserAction(action, value) {
  if (action === "marketSearch") search = value;
  if (action === "marketSelect" && !value.startsWith("type:")) selection = value;
  if (action === "marketExpand" && value.startsWith("package:")) {
    if (expandedModules.has(value)) expandedModules.delete(value);
    else expandedModules.add(value);
  }
  if (action === "marketExpand" && value.startsWith("type:")) {
    if (collapsed.has(value)) collapsed.delete(value);
    else collapsed.add(value);
  }
}
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
  const remote = validateCatalogue(cat);
  const merged = mergeCatalogues(plugins_catalogue_default.packages, remote);
  for (const p of merged) plan(merged, p.id, plugins_catalogue_default.coreVersion);
  packages = merged;
  published = remote;
  base = nextBase;
}
function validateCatalogue(cat) {
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
  return cat.packages;
}
function packageVersion(p, plugins2) {
  const members = p.modules.map((id) => plugins2.find((m) => m.id === id));
  if (members.some((m) => !m)) return void 0;
  const versions = members.map((m) => m?.metadata?.version);
  if (versions.some((v) => typeof v === "string")) return versions.every((v) => v === versions[0]) ? versions[0] : void 0;
  return receipts[p.id] || (members.every((m) => m?.source === "builtin") ? plugins_catalogue_default.packages.find((b) => b.id === p.id)?.version : void 0);
}
function isNewer(target, current) {
  if (!current) return true;
  if (!/^\d+\.\d+\.\d+$/.test(target) || !/^\d+\.\d+\.\d+$/.test(current)) return false;
  const a = target.split(".").map(Number), b = current.split(".").map(Number);
  return (a[0] - b[0] || a[1] - b[1] || a[2] - b[2]) > 0;
}
function availableUpdates(plugins2) {
  return packages.filter((p) => p.modules.some((id) => plugins2.some((m) => m.id === id)) && isNewer(p.version, packageVersion(p, plugins2)));
}
function packageRows(plugins2, selectedTab, needle = "") {
  const owned = new Set(packages.flatMap((p) => p.modules));
  const known = packages.filter((p) => {
    const present = p.modules.some((id) => plugins2.some((m) => m.id === id));
    return selectedTab === "marketplace" ? !present : present && (selectedTab === "builtin" ? p.core : !p.core);
  }).map((p) => ({ key: `package:${p.id}`, name: p.name, description: p.description, type: p.type, package: p, plugin: void 0 }));
  const unknown = selectedTab === "marketplace" ? [] : plugins2.filter((p) => !owned.has(p.id) && (selectedTab === "builtin" ? p.source === "builtin" : p.source === "user")).map((p) => ({ key: `module:${p.id}`, name: p.name, description: `${p.id} ${p.description}`, type: String(p.metadata?.pluginType || (p.kind === "ui" ? "UI" : "Services")), package: void 0, plugin: p }));
  return [...known, ...unknown].filter((p) => !needle || `${p.name} ${p.description} ${p.type} ${p.package?.modules.join(" ") || ""}`.toLowerCase().includes(needle)).sort((a, b) => a.name.localeCompare(b.name));
}
function moduleOrder(members) {
  const seen = /* @__PURE__ */ new Set(), result = [];
  const visit = (m) => {
    if (seen.has(m.id)) return;
    seen.add(m.id);
    for (const id of m.dependencies || []) {
      const dep = members.find((m2) => m2.id === id);
      if (dep) visit(dep);
    }
    result.push(m);
  };
  members.forEach(visit);
  return result;
}
async function managePackage(ctx, action, id, plugins2) {
  if (!["enable", "disable", "uninstall"].includes(action)) throw Error("Unknown plugin action");
  const pkg = packages.find((p) => p.id === id);
  if (!pkg) throw Error("Unknown plugin");
  const members = plugins2.filter((m) => pkg.modules.includes(m.id));
  if (action === "enable") {
    if (members.length !== pkg.modules.length) throw Error("Complete this plugin installation first");
    const required = new Set(plan(packages, id, plugins_catalogue_default.coreVersion).flatMap((p) => p.modules));
    const include = (id2) => {
      const m = plugins2.find((m2) => m2.id === id2);
      for (const dep of m?.dependencies || []) if (!required.has(dep)) {
        required.add(dep);
        include(dep);
      }
    };
    [...required].forEach(include);
    const ordered2 = moduleOrder(plugins2.filter((m) => required.has(m.id)));
    for (const m of ordered2) if (!m.enabled || !m.active || m.pendingApprovals?.length) {
      const result = await ctx.host.plugins.enable(m.id);
      if (!result.active) throw Error(`${m.name}: ${result.error || "could not start"}`);
    }
    return `${pkg.name} enabled`;
  }
  if (pkg.core) throw Error("Manage individual system modules in the expanded plugin tree");
  const ids = new Set(pkg.modules), outsiders = /* @__PURE__ */ new Set();
  for (const m of members) for (const dep of await ctx.host.plugins.dependents(m.id)) if (!ids.has(dep)) outsiders.add(dep);
  if (outsiders.size) {
    const names = [...new Set([...outsiders].map((id2) => packages.find((p) => p.modules.includes(id2))?.name || id2))];
    throw Error(`Disable dependent plugins first: ${names.join(", ")}`);
  }
  if (action === "uninstall" && members.some((m) => m.source !== "user")) throw Error("Development or baseline modules can be disabled, but not uninstalled");
  const ordered = moduleOrder(members).reverse();
  for (const m of ordered) if (m.enabled) await ctx.host.plugins.disable(m.id);
  if (action === "uninstall") for (const m of ordered) await ctx.host.plugins.uninstall(m.id);
  return `${pkg.name} ${action === "uninstall" ? "uninstalled" : "disabled"}`;
}
function marketNodes(plugins2, busy, renderPlugin) {
  const needle = search.trim().toLowerCase(), items = packageRows(plugins2, tab, needle);
  const child = selection.startsWith("module:") ? plugins2.find((p) => p.id === selection.slice(7)) : void 0;
  const selected = items.find((p) => p.key === selection || child && p.package?.modules.includes(child.id)) || items[0];
  const selectedModule = child && selected?.package?.modules.includes(child.id) ? child : selected?.plugin;
  if (selected && !selectedModule) selection = selected.key;
  const rows = [];
  const status = (p) => {
    const members = plugins2.filter((m) => p.modules.includes(m.id));
    if (members.length !== p.modules.length) return "Incomplete";
    if (members.every((m) => !m.enabled)) return "Off";
    if (members.some((m) => !m.enabled)) return "Partly enabled";
    return members.some((m) => m.lastError && !m.active) ? "Needs attention" : members.some((m) => !m.active) ? "Starting…" : "Enabled";
  };
  for (const type of [...new Set(items.map((p) => p.type))].sort()) {
    const key = `type:${type}`, entries = items.filter((p) => p.type === type), expanded = !collapsed.has(key) || !!needle;
    rows.push({ key, label: type, depth: 0, expandable: true, expanded, selected: false, badge: String(entries.length), weight: "semibold" });
    if (!expanded) continue;
    for (const item of entries) {
      const expandable = tab !== "marketplace" && !!item.package, expanded2 = expandedModules.has(item.key);
      rows.push({
        key: item.key,
        label: item.name,
        depth: 1,
        expandable,
        expanded: expanded2,
        selected: selected?.key === item.key && !selectedModule,
        badge: item.package ? tab === "marketplace" ? item.package.version : status(item.package) : item.plugin?.enabled ? "" : "Off"
      });
      if (expandable && expanded2) for (const id of item.package.modules) {
        const m = plugins2.find((m2) => m2.id === id);
        if (!m) continue;
        rows.push({ key: `module:${m.id}`, label: m.name, depth: 2, expandable: false, expanded: false, selected: selectedModule?.id === m.id, badge: m.enabled ? "" : "Off" });
      }
    }
  }
  const details = [];
  if (selectedModule) details.push(renderPlugin(selectedModule));
  else if (selected?.package) {
    const p = selected.package, members = plugins2.filter((m) => p.modules.includes(m.id)), has = members.length > 0;
    const version = packageVersion(p, plugins2);
    const button = (key, text, action, variant) => ({ type: "button", key, text, action: `plugin:${action}`, value: p.id, small: true, disabled: busy, variant });
    const actions = [];
    if (!has || members.length !== p.modules.length) actions.push(button("install", has ? "Complete installation" : "Install", "marketInstall", "primary"));
    else {
      if (isNewer(p.version, version)) actions.push(button("update", "Update", "marketInstall", "primary"));
      if (members.some((m) => !m.enabled || !m.active)) actions.push(button("enable", "Enable plugin", "packageEnable", "primary"));
      if (!p.core && members.some((m) => m.enabled)) actions.push(button("disable", "Disable plugin", "packageDisable"));
      if (!p.core && members.every((m) => m.source === "user")) actions.push(button("uninstall", "Uninstall", "packageUninstall", "danger"));
    }
    details.push(
      { type: "label", key: "name", text: p.name, size: "lg", weight: "semibold", wrap: true },
      { type: "label", key: "author", text: `${p.type} · ${version || p.version} · By ${p.author}`, color: "muted", size: "xs", wrap: true },
      ...actions.length ? [{ type: "row", key: "package-actions", gap: 8, wrap: true, children: actions }] : [],
      { type: "label", key: "description", text: p.description, wrap: true, size: "sm" },
      { type: "divider", key: "contents-divider" },
      { type: "label", key: "contents-title", text: `Included modules (${p.modules.length})`, weight: "semibold", size: "sm" },
      ...p.modules.map((id) => {
        const m = plugins2.find((m2) => m2.id === id);
        return { type: "label", key: `includes:${id}`, text: `${m?.name || id}${has ? m ? m.enabled ? " · Enabled" : " · Off" : " · Missing" : ""}`, size: "xs", color: "muted", wrap: true };
      }),
      { type: "label", key: "dependencies", text: `Requires: ${Object.keys(p.dependencies).map((id) => packages.find((p2) => p2.id === id)?.name || id).join(", ") || "None"}`, size: "xs", color: "muted", wrap: true }
    );
  } else details.push({ type: "label", key: "empty", text: needle ? "No matching plugins." : tab === "marketplace" ? "All available plugins are already installed." : "No plugins installed.", color: "muted", wrap: true });
  return [{ type: "tabs", key: "plugin-tabs", height: 474, style: { gap: 12 }, tabs: [{ key: "marketplace", label: "Marketplace" }, { key: "installed", label: "Installed" }, { key: "builtin", label: "System" }], active: tab, action: "plugin:marketTab", children: [{ type: "column", key: tab, height: 430, gap: 0, style: { borderWidth: 1, borderColor: "border", radius: 8 }, children: [
    { type: "row", key: "toolbar", gap: 8, padding: 12, style: { borderBottom: 1, borderColor: "border" }, children: [
      { type: "textInput", key: "plugin-search", ...filterInput, value: search, placeholder: "Search plugins…", changeAction: "plugin:marketSearch", grow: true },
      { type: "button", key: "refresh", text: "Refresh", action: "plugin:marketRefresh", disabled: busy, small: true },
      ...availableUpdates(plugins2).length ? [{ type: "button", key: "update-all", text: `Update all (${availableUpdates(plugins2).length})`, action: "plugin:marketUpdateAll", disabled: busy, small: true, variant: "primary" }] : [],
      ...tab === "installed" ? [{ type: "button", key: "folder", text: "Install from folder…", action: "plugin:install", disabled: busy, small: true }] : []
    ] },
    { type: "row", key: "browser", height: 374, gap: 0, align: "stretch", children: [
      { type: "column", key: "list", width: 260, padding: 8, borderSide: "right", children: [{ type: "tree", key: "plugin-tree", rows, rowHeight: 30, indent: 12, rowGap: 0, selectAction: "plugin:marketSelect", expandAction: "plugin:marketExpand", grow: true }] },
      { type: "column", key: selectedModule?.id || selected?.key || "details", grow: true, scroll: true, gap: 16, padding: 20, children: details }
    ] }
  ] }] }];
}
function marketTab(value) {
  tab = ["installed", "builtin"].includes(value) ? value : "marketplace";
  selection = "";
}
async function installPackage(ctx, id, plugins2) {
  if (!base) await refreshMarket(ctx);
  return installPackages(ctx, [id], plugins2);
}
async function updateAllPackages(ctx, plugins2) {
  await refreshMarket(ctx);
  const updates = availableUpdates(plugins2);
  if (!updates.length) return "All plugins are up to date";
  return installPackages(ctx, updates.map((p) => p.id), plugins2);
}
async function installPackages(ctx, ids, plugins2) {
  if (typeof ctx.host.plugins.installMany !== "function") throw Error("This plugin update needs the new Hato host. Rebuild and restart Hato once to enable live package updates.");
  const autoEnable = new Map(ids.map((id) => {
    const pkg = packages.find((p) => p.id === id);
    const previous = plugins2.filter((m) => pkg?.modules.includes(m.id));
    return [id, !previous.length || previous.some((m) => m.enabled)];
  }));
  const selected = [...new Map(ids.flatMap((id) => plan(packages, id, plugins_catalogue_default.coreVersion)).map((p) => [p.id, p])).values()];
  const changed = selected.filter((p) => {
    if (ids.includes(p.id)) return true;
    const current2 = packageVersion(p, plugins2);
    const requirements = selected.flatMap((dependent) => dependent.dependencies[p.id] ? [dependent.dependencies[p.id]] : []);
    return !current2 || isNewer(p.version, current2) || requirements.some((range) => !satisfies(current2, range)) || p.modules.some((id) => plugins2.find((m) => m.id === id)?.pendingApprovals?.length);
  });
  const files = [];
  let local = null;
  const localPackage = async (p) => {
    if (!local) {
      if (typeof ctx.host.modules?.sourceInfo !== "function") throw Error(`${p.name} ${p.version} has not been published. Install its prepared package from a development checkout or publish it first.`);
      const source = await ctx.host.modules.sourceInfo();
      const grant2 = await ctx.host.capabilities.request({ kind: "fs", root: source.repoRoot, purpose: "Read prepared local marketplace packages" });
      local = { grant: grant2.grant, packages: [] };
      const file = await ctx.host.fs.read(grant2.grant, "catalogue.json", 2 * 1024 * 1024);
      if (file.binary || file.truncated || typeof file.text !== "string") throw Error("Invalid local marketplace catalogue");
      local.packages = validateCatalogue(JSON.parse(file.text));
    }
    const candidate = local.packages.find((candidate2) => candidate2.id === p.id && candidate2.version === p.version);
    if (!candidate || JSON.stringify(candidate.modules) !== JSON.stringify(p.modules) || JSON.stringify(candidate.dependencies) !== JSON.stringify(p.dependencies))
      throw Error(`${p.name} ${p.version} has not been published and its local artifacts are unavailable. Prepare the marketplace packages first.`);
    return candidate;
  };
  try {
    for (const p of changed) {
      const remote = published.find((candidate) => candidate.id === p.id && candidate.version === p.version);
      const source = remote || await localPackage(p);
      for (const moduleId of p.modules) {
        const a = source.artifacts?.find((a2) => a2.id === moduleId);
        if (!a) throw Error(`Missing artifact: ${moduleId}`);
        const read = async (path, digest) => {
          if (!/^packages\/[a-z0-9/._-]+$/.test(path) || path.split("/").includes("..")) throw Error("Unsafe artifact path");
          let body;
          if (remote) {
            const r = await ctx.host.net.fetch({ url: base + path, maxBytes: 8 * 1024 * 1024 });
            if (r.status !== 200) throw Error(`Download failed: ${path}`);
            body = r.body;
          } else {
            if (!digest) throw Error(`Missing local artifact hash: ${path}`);
            const r = await ctx.host.fs.read(local.grant, path, 8 * 1024 * 1024);
            if (r.binary || r.truncated || typeof r.text !== "string") throw Error(`Cannot read local artifact: ${path}`);
            body = r.text;
          }
          if (digest && await sha256HexAsync(body) !== digest) throw Error(`Integrity mismatch: ${path}`);
          return body;
        };
        const manifest = await read(a.manifest, a.manifestSha256), m = JSON.parse(manifest);
        if (m.id !== moduleId || m.version !== p.version || m.moduleApiVersion !== 1 || m.pluginPackage !== p.id) throw Error("Artifact metadata mismatch");
        files.push({ id: moduleId, manifest, code: await read(a.bundle, a.bundleSha256) });
      }
    }
  } finally {
    if (local) await ctx.host.capabilities.release(local.grant);
  }
  const root = ctx.host.env.info().dataDir + "/marketplace-downloads/" + crypto.randomUUID();
  const grant = await ctx.host.capabilities.request({ kind: "fs", root: ctx.host.env.info().dataDir, write: true, purpose: "Download plugin packages" });
  try {
    await ctx.host.fs.mkdir(grant.grant, ctx.host.env.info().dataDir + "/marketplace-downloads");
    await ctx.host.fs.mkdir(grant.grant, root);
    const paths = [];
    for (const f of files) {
      const dir = root + "/" + f.id;
      await ctx.host.fs.mkdir(grant.grant, dir);
      await ctx.host.fs.mkdir(grant.grant, dir + "/dist");
      await ctx.host.fs.writeAtomic(grant.grant, dir + "/manifest.json", f.manifest);
      await ctx.host.fs.writeAtomic(grant.grant, dir + "/dist/" + f.id + ".mjs", f.code);
      paths.push(dir);
    }
    await ctx.host.plugins.installMany(paths);
    for (const p of changed) receipts[p.id] = p.version;
    await ctx.modules.call("persistence", "settings.set", { key: "plugins.receipts.v1", value: receipts });
  } finally {
    await ctx.host.capabilities.release(grant.grant);
  }
  const current = (await ctx.host.plugins.list()).plugins;
  for (const id of ids) {
    if (autoEnable.get(id)) await managePackage(ctx, "enable", id, current);
  }
  return `Installed ${ids.map((id) => packages.find((p) => p.id === id)?.name || id).join(", ")}. All included modules are managed together.`;
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

// ../sdk/ui-table.ts
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

// ../sdk/runtime.ts
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
  const version = ++refreshVersion;
  try {
    const modules = await ctx.host.modules.list();
    if (version !== refreshVersion) return;
    providers = modules.filter((m) => m.active && m.id !== ctx.moduleId).map((m) => m.id).sort();
    const list = await ctx.host.plugins.list();
    if (version !== refreshVersion) return;
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
    if (version === refreshVersion) error = errMsg(e);
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
    restorePluginBrowser(prev?.pluginBrowser);
    open = !!prev?.open;
    query = prev?.query || "";
    ctx.events.on("settings.open", (args) => {
      open = true;
      query = "";
      selectedCategory = args?.category || "plugins";
      if (selectedCategory === "plugins") marketTab("marketplace");
      void refresh(ctx);
    });
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
  snapshot: () => ({ open, selectedCategory, query, pluginBrowser: pluginBrowserSnapshot() }),
  methods: {
    /** User syntax color schemes: `*.json` in <sharedDir>/syntax-schemes, as raw text for
     *  workspace-layout to validate (it has no file access of its own). Read-only. */
    async syntaxSchemeFiles(ctx) {
      const dir = `${String(ctx.host.env.info().sharedDir || "").replace(/\/+$/, "")}/syntax-schemes`;
      const files = [];
      let grant = null;
      try {
        grant = (await ctx.host.capabilities.request({ kind: "fs", root: dir })).grant;
        const { entries } = await ctx.host.fs.list(grant, ".");
        for (const entry of entries.filter((e) => e.kind === "file" && e.name.toLowerCase().endsWith(".json")).slice(0, 50)) {
          try {
            const file = await ctx.host.fs.read(grant, entry.name, 256 * 1024);
            files.push(typeof file.text === "string" && !file.truncated ? { name: entry.name, text: file.text } : { name: entry.name, error: "file is too large or not text" });
          } catch (e) {
            files.push({ name: entry.name, error: e instanceof Error ? e.message : String(e) });
          }
        }
      } catch {
      } finally {
        if (grant) await ctx.host.capabilities.release(grant).catch(() => {
        });
      }
      return { dir, files };
    },
    async open(ctx, args) {
      open = true;
      if (typeof args?.module === "string" && typeof args?.section === "string") selectedCategory = JSON.stringify([args.module, args.section]);
      else if (args?.category === "plugins") selectedCategory = args.category;
      if (args?.category || args?.module) query = "";
      ctx.ui.invalidate();
      await refresh(ctx);
    }
  },
  render(ctx) {
    if (!open) return { type: "column", key: "settings-closed", children: [] };
    const all = categories(ctx), needle = query.trim().toLowerCase();
    const list = all.filter((c) => !needle || [c.title, c.section?.description, ...(c.section?.fields || []).flatMap((f) => [f.label, f.description])].join(" ").toLowerCase().includes(needle));
    if (!list.length) return { type: "modal", key: "settings-modal", title: "Settings", width: 1080, closeAction: "close", style: { padding: 20, gap: 16, radius: 12 }, children: [
      { type: "textInput", key: "settings-search", ...filterInput, value: query, changeAction: "search", placeholder: "Search settings…" },
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
      const control = field.type === "action" ? { type: "button", key: fieldKey, text: field.buttonLabel, disabled: !!field.disabled, action: "settingAction", small: true } : field.type === "toggle" ? { type: "toggle", key: fieldKey, label: active.section?.layout === "table" ? "" : field.label, checked: field.value, action: "change" } : field.type === "text" ? { type: "textInput", key: fieldKey, value: field.value, placeholder: field.placeholder, submitAction: "change" } : { type: "select", key: fieldKey, value: field.value, options: field.options, action: "change", buttonStyle: { height: 32, fullWidth: true } };
      if (active.section?.layout === "table") tableRows.push({ key: fieldKey, label: field.label, description: field.description, control });
      else options.push({ type: "column", key: `${fieldKey}:field`, gap: 5, padding: 10, border: true, children: [
        ...field.type !== "toggle" ? [{ type: "label", key: "label", text: field.label, size: "sm", weight: "medium" }] : [],
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
    const navigation = [
      { type: "column", key: "navigation-search", style: { paddingX: 6, paddingY: 8 }, children: [
        { type: "textInput", key: "settings-search", ...filterInput, value: query, changeAction: "search", placeholder: "Search settings…" }
      ] }
    ];
    for (const group of [...groups, ...new Set(list.map(categoryGroup).filter((g) => !groups.includes(g)))]) {
      const entries = list.filter((c) => categoryGroup(c) === group);
      if (!entries.length) continue;
      navigation.push({ type: "label", key: `group:${group}`, text: group.toUpperCase(), size: "xs", color: "muted", weight: "semibold", style: { paddingX: 10, paddingY: 10 } });
      navigation.push(...entries.map((category) => ({
        type: "choice",
        key: category.key,
        text: category.title,
        selected: active.key === category.key,
        style: { paddingX: 10, paddingY: 5, radius: 5 },
        description: category.error ? "Needs attention" : void 0,
        action: "selectCategory",
        value: category.key
      })));
    }
    return { type: "modal", key: "settings-modal", title: "Settings", width: 1080, closeAction: "close", style: { padding: 20, gap: 16, radius: 12 }, children: [
      ...error ? [{ type: "status", key: "error", text: error, level: "error" }] : [],
      { type: "row", key: "settings-content", height: 540, gap: 20, align: "stretch", children: [
        { type: "column", key: "categories", width: 210, gap: 2, scroll: true, borderSide: "right", children: navigation },
        { type: "column", key: `options:${active.key}`, gap: 16, grow: true, scroll: true, children: options }
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
      await pluginAction(ctx, event.action.slice(7), event.rowKey ?? event.value);
      return;
    }
    if (event.action === "selectCategory") {
      if (categories(ctx).some((category) => category.key === event.value)) selectedCategory = String(event.value);
      ctx.ui.invalidate();
      return;
    }
    if (event.action === "settingAction") {
      try {
        const [module, section, key] = JSON.parse(event.key);
        const category = categories(ctx).find((c) => c.module === module && c.section?.key === section);
        const field = category?.section?.fields.find((f) => f.key === key);
        if (!field || field.type !== "action" || field.disabled) return;
        ctx.events.emit("settings.action", { module, section, key });
      } catch (e) {
        error = errMsg(e);
        ctx.ui.invalidate();
      }
      return;
    }
    if (event.action !== "change") return;
    try {
      const [module, section, key] = JSON.parse(event.key);
      const category = categories(ctx).find((category2) => category2.module === module && category2.section?.key === section);
      if (!category || !category.section.fields.some((field2) => field2.key === key)) return;
      const field = category.section.fields.find((field2) => field2.key === key);
      if (field.type === "action") return;
      ctx.events.emit("settings.change", { module, section, key, value: field.type === "text" ? event.inputs?.[event.key] ?? event.value : event.value });
    } catch (e) {
      error = errMsg(e);
      ctx.ui.invalidate();
    }
  }
};
var index_default = mod;
function pluginRow(p) {
  const status = !p.enabled ? "Disabled" : p.active ? "Enabled" : p.lastError ? "failed" : "loading";
  const facts = [
    p.kind,
    p.source === "user" ? "Installed" : "Managed",
    p.runsOn !== "ui" ? `runs on: ${p.runsOn}` : null,
    p.provides.length ? `provides ${p.provides.join(", ")}` : null,
    p.requires.length ? `needs ${p.requires.join(", ")}` : null
  ].filter(Boolean).join(" · ");
  const isRootProvider = p.provides.includes("shell.root");
  const busy = pluginBusy !== null;
  return { type: "column", key: `plugin:${p.id}`, gap: 16, children: [
    { type: "row", key: "head", gap: 8, align: "center", children: [
      { type: "column", key: "title", grow: true, gap: 2, children: [
        { type: "label", key: "name", text: p.name, weight: "semibold", size: "lg", wrap: true },
        { type: "label", key: "id", text: p.id, size: "xs", color: "muted", wrap: true }
      ] },
      { type: "label", key: "status", text: status, size: "xs", color: !p.enabled ? "muted" : p.active ? "success" : "danger" },
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
    ...p.description ? [{ type: "label", key: "desc", text: p.description, size: "sm", wrap: true }] : [],
    { type: "divider", key: "details-divider" },
    { type: "label", key: "section-title", text: "Plugin information", size: "sm", weight: "semibold" },
    { type: "label", key: "facts", text: facts, size: "xs", color: "muted", wrap: true },
    ...p.pendingApprovals.length && !p.enabled ? [{ type: "label", key: "perm", text: `Needs approval: ${p.pendingApprovals.join(", ")}`, size: "xs", color: "warning", wrap: true }] : [],
    ...p.enabled && p.lastError && !p.active ? [{ type: "label", key: "err", text: p.lastError, size: "xs", color: "danger", wrap: true }] : [],
    ...p.canRollback ? [{ type: "row", key: "rollback-actions", children: [
      { type: "button", key: "rollback", text: "Roll back update", action: "plugin:rollback", value: p.id, small: true, disabled: busy }
    ] }] : [],
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
  return [
    ...marketNodes(plugins, pluginBusy !== null, pluginRow),
    ...pluginBusy ? [{ type: "progress", key: "plugin-busy", indeterminate: true, label: pluginBusy }] : [],
    ...pluginStatus ? [{ type: "status", key: "plugin-status", text: pluginStatus.text, level: pluginStatus.level }] : [],
    ...pendingCascade ? [{ type: "row", key: "cascade", gap: 6, align: "center", children: [
      { type: "label", key: "t", text: `Also disable: ${pendingCascade.dependents}?`, size: "sm", grow: true, wrap: true },
      { type: "button", key: "yes", text: "Disable all", action: "plugin:cascade", value: pendingCascade.id, small: true, variant: "danger" },
      { type: "button", key: "no", text: "Cancel", action: "plugin:cancelCascade", small: true }
    ] }] : []
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
    case "marketSearch":
    case "marketSelect":
    case "marketExpand":
      pluginBrowserAction(action, String(value));
      ctx.ui.invalidate();
      return;
    case "marketTab":
      pluginStatus = null;
      marketTab(String(value));
      ctx.ui.invalidate();
      return;
    case "marketRefresh":
      return run("Checking marketplace…", async () => {
        await refreshMarket(ctx);
        return "Marketplace is up to date";
      });
    case "rollback":
      return run("Restoring previous plugin…", async () => {
        await ctx.host.plugins.rollback(String(value));
        return "Previous version restored; active plugins reload live";
      });
    case "marketUpdateAll":
      return run("Updating plugins…", () => updateAllPackages(ctx, plugins));
    case "packageEnable":
      return run("Enabling plugin…", () => managePackage(ctx, "enable", String(value), plugins));
    case "packageDisable":
      return run("Disabling plugin…", () => managePackage(ctx, "disable", String(value), plugins));
    case "packageUninstall":
      return run("Uninstalling plugin…", () => managePackage(ctx, "uninstall", String(value), plugins));
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
        return `Installed ${r.id}. Enable it in Installed to load it.`;
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
