// ../sdk/sidebar-icons.ts
var outline = (paths) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
var sidebarIcons = {
  // Workspace
  projects: outline('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>'),
  // Navigator space
  files: outline('<path d="M13 10h7a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-3l-1.5-2H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1ZM13 21h7a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-3l-1.5-2H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1ZM3 3v13a2 2 0 0 0 2 2h4M3 5a2 2 0 0 0 2 2h4"/>'),
  git: outline('<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7v10M18 10c0 4-4 4-10 7.5"/>'),
  server: outline('<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01M11 6.5h6M11 17.5h6"/>'),
  // Editor space
  code: outline('<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>'),
  history: outline('<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5M12 7v5l3.5 2"/>'),
  workflow: outline('<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><path d="M9 6h6M18 9v6M6 9v6a3 3 0 0 0 3 3h6"/>'),
  // Assistant space
  ai: outline('<path d="M21 15a2 2 0 0 1-2 2H7l-5 5V4a2 2 0 0 1 2-2h15a2 2 0 0 1 2 2Z"/><path d="M8 9h8M8 13h5"/>'),
  bot: outline('<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4M10 4h4M2 14h2M20 14h2M9 13v2M15 13v2"/>'),
  plug: outline('<path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0V7ZM12 17v5"/>'),
  // Bottom dock
  terminal: outline('<path d="m4 17 6-6-6-6M12 19h8"/>'),
  // Kept for user plugins that reference the old name.
  remote: outline('<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01M11 6.5h6M11 17.5h6"/>')
};

// ../sdk/terminal-icons.ts
var svg = (paths) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
var terminalIcons = {
  splitRight: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16m3-11 3 3-3 3m-1-3h4"/>'),
  splitDown: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 12h18m-12 3 3 3 3-3m-3-1v4"/>')
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

// ../sdk/runtime.ts
function errMsg(e) {
  return e && (e.message || String(e)) || "unknown error";
}

// modules/ui/terminal-panel/src/model.ts
var firstBlock = () => ({ kind: "block", id: "block-main", keys: ["main"], active: "main" });
function blocks(node) {
  return node.kind === "block" ? [node] : node.children.flatMap(blocks);
}
function replace(node, id, next) {
  if (node.id === id) return next;
  return node.kind === "block" ? node : { ...node, children: node.children.map((child) => replace(child, id, next)) };
}
function remove(node, id) {
  if (node.id === id) return null;
  if (node.kind === "block") return node;
  const a = remove(node.children[0], id), b = remove(node.children[1], id);
  return !a ? b : !b ? a : { ...node, children: [a, b] };
}
function resize(node, id, sizes) {
  if (node.kind === "block") return node;
  if (node.id === id) return sizes.length === 2 && sizes.every((n) => Number.isFinite(n) && n > 0) ? { ...node, sizes } : node;
  return { ...node, children: node.children.map((child) => resize(child, id, sizes)) };
}
function restore(saved, legacy) {
  const ids = /* @__PURE__ */ new Set(), keys = /* @__PURE__ */ new Set();
  function read(value, depth = 0) {
    if (!value || depth > 32 || typeof value.id !== "string" || ids.has(value.id)) return null;
    ids.add(value.id);
    if (value.kind === "block" && Array.isArray(value.keys)) {
      const tabs = value.keys.filter((key) => typeof key === "string" && !!key && !keys.has(key) && !!keys.add(key));
      return tabs.length ? { kind: "block", id: value.id, keys: tabs, active: tabs.includes(value.active) ? value.active : tabs[0] } : null;
    }
    if (value.kind !== "split" || !Array.isArray(value.children)) return null;
    const a = read(value.children[0], depth + 1), b = read(value.children[1], depth + 1);
    if (!a || !b) return a || b;
    return {
      kind: "split",
      id: value.id,
      direction: value.direction === "vertical" ? "vertical" : "horizontal",
      sizes: Array.isArray(value.sizes) && value.sizes.length === 2 && value.sizes.every((n) => typeof n === "number" && Number.isFinite(n) && n > 0) ? value.sizes : [0.5, 0.5],
      children: [a, b]
    };
  }
  return read(saved) || read({ ...firstBlock(), keys: legacy?.keys || ["main"], active: legacy?.active || "main" }) || firstBlock();
}

// ../sdk/ui-icons.ts
var outline2 = (paths, width = 1.8) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
var uiIcons = {
  send: outline2("<path d='m22 2-7 20-4-9-9-4Z'/><path d='M22 2 11 13'/>"),
  paperclip: outline2("<path d='m21 11-9 9a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8l8.5-8.5'/>"),
  "sliders-horizontal": outline2("<path d='M3 6h3m4 0h11M3 18h11m4 0h3'/><circle cx='8' cy='6' r='2'/><circle cx='16' cy='18' r='2'/>"),
  "message-square": outline2("<path d='M21 15a2 2 0 0 1-2 2H7l-5 5V4a2 2 0 0 1 2-2h15a2 2 0 0 1 2 2Z'/>"),
  "graduation-cap": outline2("<path d='m2 8 10-5 10 5-10 5Zm4 2v7q6 5 12 0v-7M22 8v8'/>"),
  pencil: outline2("<path d='M21.2 6.8a2.8 2.8 0 0 0-4-4L3.8 16.2 3 21l4.8-.8Z'/><path d='m15 5 4 4'/>"),
  eraser: outline2("<path d='m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L11 21'/><path d='M22 21H7'/><path d='m5 11 9 9'/>"),
  trash: outline2("<path d='M3 6h18'/><path d='M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6'/><path d='M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'/><path d='M10 11v6M14 11v6'/>"),
  copy: outline2("<rect x='8' y='8' width='13' height='13' rx='2'/><path d='M16 5V3H3v13h2'/>"),
  warning: outline2("<path d='m12 3 10 18H2Z'/><path d='M12 9v5m0 3h.01'/>"),
  terminal: outline2("<rect x='3' y='4' width='18' height='16' rx='2'/><path d='m7 9 3 3-3 3m6 0h4'/>"),
  "git-branch": outline2("<circle cx='6' cy='3' r='2'/><circle cx='6' cy='20' r='2'/><circle cx='18' cy='6' r='2'/><path d='M6 5v13M18 8c0 7-12 4-12 10'/>"),
  files: outline2("<path d='M14 2H6v16h14V8Z'/><path d='M14 2v6h6M3 6v16h13'/>"),
  folder: outline2("<path d='M3 5h6l2 2h10v13H3Z'/>"),
  refresh: outline2("<path d='M20 7a8 8 0 1 0 0 10M20 3v5h-5'/>"),
  collapse: outline2("<path d='m8 8 4-4 4 4M8 16l4 4 4-4M4 12h16'/>"),
  locate: outline2("<circle cx='12' cy='12' r='7'/><circle cx='12' cy='12' r='2'/><path d='M12 2v3m0 14v3M2 12h3m14 0h3'/>"),
  search: outline2("<circle cx='10' cy='10' r='7'/><path d='m15 15 6 6'/>"),
  x: outline2("<path d='m6 6 12 12M6 18 18 6'/>"),
  plus: outline2("<path d='M12 4v16M4 12h16'/>"),
  remote: outline2("<rect x='3' y='4' width='18' height='12' rx='2'/><path d='M8 20h8M12 16v4'/>"),
  plug: outline2("<path d='M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0V7ZM12 17v5'/>"),
  "text-search": outline2("<path d='M4 6h16M4 12h7M4 18h6'/><circle cx='17' cy='15' r='3'/><path d='m19.2 17.2 2.3 2.3'/>"),
  eye: outline2("<path d='M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z'/><circle cx='12' cy='12' r='3'/>"),
  "eye-off": outline2("<path d='M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3 3.8M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18'/>"),
  globe: outline2("<circle cx='12' cy='12' r='9'/><path d='M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18'/>"),
  "cloud-lock": outline2("<path d='M17.5 17H18a4 4 0 0 0 .5-8A6 6 0 0 0 7 7.5 4.5 4.5 0 0 0 6.5 17'/><rect x='9' y='14' width='6' height='6' rx='1'/><path d='M10.5 14v-1.5a1.5 1.5 0 0 1 3 0V14'/>"),
  lock: outline2("<rect x='4' y='11' width='16' height='10' rx='2'/><path d='M8 11V7a4 4 0 0 1 8 0v4'/>"),
  key: outline2("<circle cx='8' cy='15' r='4'/><path d='m10.8 12.2 8.7-8.7M17 6l3 3M14.5 8.5l2 2'/>"),
  check: outline2("<path d='m5 12 5 5 9-11'/>"),
  "log-out": outline2("<path d='M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9'/>"),
  external: outline2("<path d='M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'/>"),
  sparkles: outline2("<path d='M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z'/><path d='M19 16v4M17 18h4'/>"),
  import: outline2("<path d='M12 3v12M7 10l5 5 5-5M5 21h14'/>"),
  task: outline2("<circle cx='6' cy='3' r='2'/><circle cx='6' cy='20' r='2'/><circle cx='18' cy='6' r='2'/><path d='M6 5v13M18 8c0 7-12 4-12 10'/>")
};

// modules/ui/terminal-panel/src/index.ts
var ws = null;
var layout = firstBlock();
var epoch = 0;
var error = null;
var terminals = /* @__PURE__ */ new Map();
var loading = /* @__PURE__ */ new Map();
var busy = /* @__PURE__ */ new Set();
var activityTimer = null;
var activityBusy = false;
var cursors = /* @__PURE__ */ new Map();
var unread = /* @__PURE__ */ new Set();
async function checkActivity(ctx) {
  if (!ws || activityBusy) return;
  const version = epoch, workspaceId = ws.id;
  activityBusy = true;
  try {
    const all = blocks(layout), keys = all.flatMap((block) => block.keys);
    const activity = await ctx.modules.call("terminals", "activity", { workspaceId, keys });
    if (version !== epoch) return;
    const active = new Set(blocks(layout).map((block) => block.active));
    let changed = false;
    for (const item of activity) {
      if (typeof item.cursor !== "number") continue;
      const previous = cursors.get(item.key);
      cursors.set(item.key, item.cursor);
      if (!active.has(item.key) && previous !== void 0 && item.cursor > previous && !unread.has(item.key)) {
        unread.add(item.key);
        changed = true;
      }
      if (active.has(item.key) && unread.delete(item.key)) changed = true;
    }
    if (changed) ctx.ui.invalidate();
  } catch {
  } finally {
    activityBusy = false;
  }
}
var uid = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
async function attach(ctx, block, restart = false) {
  if (!ws) return;
  const workspaceId = ws.id, version = epoch, key = block.active;
  if (loading.has(key)) return loading.get(key);
  if (!restart && terminals.has(key)) return;
  terminals.delete(key);
  const request = (async () => {
    try {
      const result = await ctx.modules.call("terminals", restart ? "restart" : "attach", { workspaceId, key }, { timeoutMs: 6e4 });
      if (version === epoch && blocks(layout).some((b) => b.keys.includes(key))) terminals.set(key, result);
    } catch (e) {
      if (version === epoch) error = errMsg(e);
    } finally {
      if (version === epoch) {
        loading.delete(key);
        ctx.ui.invalidate();
      }
    }
  })();
  loading.set(key, request);
  ctx.ui.invalidate();
  await request;
}
async function save(ctx) {
  const first = blocks(layout)[0];
  await ctx.modules.call("workspace", "view.patch", { workspaceId: ws.id, patch: { ui: {
    terminalLayout: JSON.parse(JSON.stringify(layout)),
    terminalTabs: { keys: [...first.keys], active: first.active }
  } } });
}
function reset(saved) {
  epoch++;
  cursors = /* @__PURE__ */ new Map();
  unread = /* @__PURE__ */ new Set();
  terminals = /* @__PURE__ */ new Map();
  loading = /* @__PURE__ */ new Map();
  busy = /* @__PURE__ */ new Set();
  error = null;
  layout = restore(saved || ws?.view?.ui?.terminalLayout, ws?.view?.ui?.terminalTabs);
}
async function attachVisible(ctx) {
  await Promise.all(blocks(layout).map((block) => attach(ctx, block)));
}
function renderNode(node) {
  if (node.kind === "split") return {
    type: "split",
    key: node.id,
    direction: node.direction,
    sizes: node.sizes,
    minSize: node.direction === "horizontal" ? 160 : 100,
    resizeAction: "resizeBlocks",
    grow: true,
    children: node.children.map(renderNode)
  };
  const all = blocks(layout), locked = !ws || busy.has(node.id) || loading.has(node.active);
  const action = (name) => `${name}:${node.id}`;
  const control = (name, tooltip, icon) => ({
    type: "button",
    key: name,
    text: "",
    iconSvg: uiIcons[icon],
    action: action(name),
    small: true,
    variant: "ghost",
    tooltip,
    disabled: locked
  });
  return { type: "column", key: node.id, gap: 3, padding: 4, grow: true, children: [
    { type: "row", key: "tabs", gap: 3, wrap: true, children: [
      ...node.keys.map((key) => ({ type: "row", key, gap: 0, style: terminalTabStyle(node.active === key), children: [
        {
          type: "button",
          key: "select",
          iconSvg: sidebarIcons.terminal,
          text: `${key.startsWith("md:") ? key.slice(3, key.lastIndexOf(":")).split("/").pop() + " · block " + (Number(key.slice(key.lastIndexOf(":") + 1)) + 1) : "Terminal " + (all.flatMap((b) => b.keys).indexOf(key) + 1)}${unread.has(key) ? " •" : ""}`,
          action: `select:${key}`,
          middleClickAction: `close:${key}`,
          small: true,
          variant: "ghost",
          style: tabButtonStyle(node.active === key, true),
          disabled: locked
        },
        {
          type: "button",
          key: "close",
          text: "",
          iconSvg: uiIcons["x"],
          action: `close:${key}`,
          small: true,
          variant: "ghost",
          style: tabButtonStyle(node.active === key, true),
          tooltip: "Close terminal",
          disabled: locked
        }
      ] })),
      control("new", "New terminal tab", "plus"),
      ...["splitRight", "splitDown"].map((name) => ({
        type: "button",
        key: name,
        text: "",
        iconSvg: terminalIcons[name],
        action: action(name),
        small: true,
        variant: "ghost",
        tooltip: name === "splitRight" ? "Split right" : "Split down",
        disabled: locked
      })),
      control("restart", "Restart active shell", "refresh"),
      ...all.length > 1 ? [control("closeBlock", "Close block and its terminal tabs", "x")] : []
    ] },
    {
      type: "terminal",
      key: `term:${node.active}`,
      pty: terminals.get(node.active)?.pty || null,
      placeholder: ws ? "Starting shell…" : "Select a workspace.",
      grow: true
    }
  ] };
}
var mod = {
  id: "terminal-panel",
  moduleApiVersion: 1,
  async activate(ctx, prev) {
    ws = ctx.state.get("workspace.selected") || null;
    reset(prev && prev.workspaceId === ws?.id ? prev.layout : void 0);
    if (prev && prev.workspaceId === ws?.id) {
      cursors = new Map(prev.cursors || []);
      unread = new Set(prev.unread || []);
    }
    ctx.state.watch("workspace.selected", (value) => {
      const changed = ws?.id !== value?.id;
      ws = value;
      if (changed) {
        reset();
        void attachVisible(ctx);
        ctx.ui.invalidate();
      }
    });
    ctx.events.on("terminals.changed", () => ctx.ui.invalidate());
    ctx.events.on("viewer.runCode", async (args) => {
      if (typeof args?.requestId !== "string") return;
      try {
        await mod.methods.runCode(ctx, args, { caller: "viewer" });
        ctx.events.emit("terminal-panel.runCodeResult", { requestId: args.requestId });
      } catch (e) {
        ctx.events.emit("terminal-panel.runCodeResult", { requestId: args.requestId, error: errMsg(e) });
      }
    });
    await attachVisible(ctx);
    void checkActivity(ctx);
    activityTimer = setInterval(() => {
      void checkActivity(ctx);
    }, 1500);
    activityTimer.unref?.();
  },
  async deactivate() {
    if (activityTimer) clearInterval(activityTimer);
    activityTimer = null;
  },
  snapshot: () => ({ workspaceId: ws?.id || null, layout, cursors: [...cursors], unread: [...unread] }),
  canSwap: async () => ({ ok: !busy.size && !loading.size, reason: "Terminal operation in progress" }),
  render() {
    return { type: "column", key: "terminal-root", grow: true, children: [
      ...error ? [{ type: "status", key: "err", text: error, level: "error" }] : [],
      renderNode(layout)
    ] };
  },
  methods: {
    async runCode(ctx, args) {
      if (!ws || args.workspaceId !== ws.id) throw new Error("Select the Markdown file's workspace first.");
      if (typeof args.path !== "string" || !Number.isSafeInteger(args.block) || args.block < 0 || typeof args.code !== "string" || !args.code.trim() || args.code.length > 32768 || args.code.includes("\0")) throw new Error("Invalid shell block.");
      const version = epoch, workspaceId = ws.id;
      const key = `md:${args.path}:${args.block}`;
      let block = blocks(layout).find((b) => b.keys.includes(key));
      if (!block) {
        block = blocks(layout)[0];
        layout = replace(layout, block.id, { ...block, keys: [...block.keys, key], active: key });
      } else layout = replace(layout, block.id, { ...block, active: key });
      unread.delete(key);
      block = blocks(layout).find((b) => b.keys.includes(key));
      if (busy.has(block.id)) throw new Error("Wait for this terminal operation to finish.");
      busy.add(block.id);
      ctx.ui.invalidate();
      try {
        await attach(ctx, block);
        if (version !== epoch) throw new Error("Workspace changed before the shell block could run.");
        await save(ctx);
        ctx.events.emit("terminal-panel.reveal", { workspaceId });
        const shell = ["bash", "zsh"].includes(args.language) ? args.language : "sh";
        let delimiter = "HATO_SCRIPT";
        while (args.code.split(/\r?\n/).includes(delimiter)) delimiter += "_";
        const command = `${shell} <<'${delimiter}'
${args.code}${args.code.endsWith("\n") ? "" : "\n"}${delimiter}`;
        await ctx.modules.call("terminals", "runCode", { workspaceId, key, command }, { timeoutMs: 1e4 });
        return { key };
      } finally {
        if (version === epoch) busy.delete(block.id);
        ctx.ui.invalidate();
      }
    }
  },
  async onEvent(ctx, ev) {
    if (!ws) return;
    if (ev.action === "resizeBlocks") {
      const value = ev.value;
      layout = resize(layout, ev.key, Array.isArray(value?.sizes) ? value.sizes : []);
      try {
        await save(ctx);
      } catch (e) {
        error = errMsg(e);
      }
      ctx.ui.invalidate();
      return;
    }
    const separator = ev.action.indexOf(":");
    const name = separator < 0 ? ev.action : ev.action.slice(0, separator);
    const target = separator < 0 ? "" : ev.action.slice(separator + 1);
    if (name === "select") unread.delete(target);
    const block = name === "select" || name === "close" ? blocks(layout).find((b) => b.keys.includes(target)) : blocks(layout).find((b) => b.id === target) || (!target ? blocks(layout)[0] : void 0);
    if (!block || busy.has(block.id) || loading.has(block.active)) return;
    const version = epoch, workspaceId = ws.id;
    busy.add(block.id);
    error = null;
    ctx.ui.invalidate();
    try {
      if (name === "restart") {
        await attach(ctx, block, true);
        return;
      }
      if (name === "new") {
        const key = uid("shell");
        layout = replace(layout, block.id, { ...block, keys: [...block.keys, key], active: key });
      } else if (name === "select") layout = replace(layout, block.id, { ...block, active: target });
      else if (name === "splitRight" || name === "splitDown") {
        const key = uid("shell");
        const next = { kind: "block", id: uid("block"), keys: [key], active: key };
        layout = replace(layout, block.id, { kind: "split", id: uid("split"), direction: name === "splitRight" ? "horizontal" : "vertical", sizes: [0.5, 0.5], children: [block, next] });
      } else if (name === "close" || name === "closeBlock") {
        if (name === "closeBlock" && blocks(layout).length === 1) return;
        const closing = name === "closeBlock" ? block.keys : [target];
        for (const key of closing) {
          await ctx.modules.call("terminals", "close", { workspaceId, key });
          if (version !== epoch) return;
          terminals.delete(key);
        }
        const keys = block.keys.filter((key) => !closing.includes(key));
        layout = keys.length ? replace(layout, block.id, { ...block, keys, active: keys.includes(block.active) ? block.active : keys[Math.min(block.keys.indexOf(target), keys.length - 1)] || keys[0] }) : remove(layout, block.id) || firstBlock();
      } else return;
      await save(ctx);
      if (version === epoch) await attachVisible(ctx);
    } catch (e) {
      if (version === epoch) error = errMsg(e);
    } finally {
      if (version === epoch) {
        busy.delete(block.id);
        ctx.ui.invalidate();
      }
    }
  }
};
var index_default = mod;
export {
  index_default as default
};
