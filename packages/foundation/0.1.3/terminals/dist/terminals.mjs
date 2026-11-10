// ../sdk/runtime.ts
var grantCache = /* @__PURE__ */ new Map();
var sshCache = /* @__PURE__ */ new Map();
function sshProfileSpec(ssh) {
  return { profileId: ssh.profileId, host: ssh.host, port: ssh.port, user: ssh.user, identityFile: ssh.identityFile ?? null, transport: ssh.transport ?? "ssh", ...ssh.auth ? { auth: ssh.auth } : {} };
}
function sshConnect(ctx, desc) {
  if (desc.location !== "ssh" || !desc.ssh) throw new Error("not an SSH workspace");
  const key = desc.machineId;
  let p = sshCache.get(key);
  if (!p) {
    p = ctx.host.ssh.connect(sshProfileSpec(desc.ssh));
    sshCache.set(key, p);
    p.catch(() => sshCache.delete(key));
  }
  return p;
}
function forgetSsh(machineId) {
  sshCache.delete(machineId);
  for (const k of Array.from(grantCache.keys())) if (k.includes("|" + machineId + "|")) grantCache.delete(k);
}
async function targetFor(ctx, desc) {
  if (desc.location === "local") return { kind: "local" };
  const c = await sshConnect(ctx, desc);
  return { kind: "ssh", connection: c.connection, machineId: c.machineId };
}
async function workspaceGrant(ctx, desc, kind, root) {
  const r = root || desc.rootAbsolutePath;
  const key = kind + "|" + desc.machineId + "|" + r;
  let p = grantCache.get(key);
  if (!p) {
    p = (async () => {
      const target = await targetFor(ctx, desc);
      return ctx.host.capabilities.request({ kind, root: r, target });
    })();
    grantCache.set(key, p);
    p.catch(() => grantCache.delete(key));
  }
  try {
    return await p;
  } catch (e) {
    if (e && (e.code === "ENOTCONN" || e.code === "EBADF")) forgetSsh(desc.machineId);
    throw e;
  }
}
async function withWorkspace(ctx, desc, fn) {
  try {
    return await fn();
  } catch (e) {
    if (desc.location === "ssh" && e && (e.code === "ENOTCONN" || e.code === "ESTALE" || e.code === "EBADF")) {
      forgetSsh(desc.machineId);
      return await fn();
    }
    throw e;
  }
}
function errMsg(e) {
  return e && (e.message || String(e)) || "unknown error";
}

// ../sdk/mcp.ts
function exportMcpTools(ctx, title, tools) {
  let pending = 0;
  const publish = () => ctx.state.set(`${ctx.moduleId}.mcp`, {
    title,
    generation: ctx.generation,
    tools: tools.map(({ handler: _handler, ...definition }) => definition)
  });
  ctx.events.on("internal-mcp.call", async (request) => {
    if (request?.module !== ctx.moduleId || request.generation !== ctx.generation || typeof request.id !== "string") return;
    const tool = tools.find((tool2) => tool2.name === request.tool);
    pending++;
    try {
      if (!tool) throw new Error("Unknown module MCP command");
      const scope = request.scope;
      if (!scope || typeof scope.workspaceId !== "string" || typeof scope.conversationId !== "string" || typeof scope.machineId !== "string") throw new Error("Missing authenticated MCP scope");
      const result = await tool.handler(request.args || {}, scope);
      ctx.events.emit(`${ctx.moduleId}.mcp.result`, { id: request.id, generation: ctx.generation, result: result === void 0 ? null : result });
    } catch (e) {
      ctx.events.emit(`${ctx.moduleId}.mcp.result`, { id: request.id, generation: ctx.generation, error: errMsg(e) });
    } finally {
      pending--;
    }
  });
  publish();
  return { publish, pending: () => pending };
}

// modules/services/terminals/src/tools.ts
var shellQuote = (text) => "'" + text.replace(/'/g, "'\\''") + "'";
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function plainOutput(text) {
  return text.replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\r\n/g, "\n").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}
function terminalTools(ctx, saved) {
  const known = new Map((saved || []).map(([workspace, keys]) => [workspace, new Set(keys)]));
  const running = /* @__PURE__ */ new Map();
  const remember = (workspace, key) => {
    const keys = known.get(workspace) || /* @__PURE__ */ new Set();
    keys.add(key);
    known.set(workspace, keys);
  };
  async function check(scope) {
    const desc = await ctx.modules.call("workspace", "resolve", { workspaceId: scope.workspaceId });
    if (desc.machineId !== scope.machineId) throw new Error("MCP workspace machine has changed; reconnect the agent");
  }
  async function list(scope) {
    await check(scope);
    const view = await ctx.modules.call("workspace", "view.get", { workspaceId: scope.workspaceId });
    const tabs = [];
    const seen = /* @__PURE__ */ new Set();
    function add(key, blockId, active) {
      if (typeof key === "string" && !seen.has(key)) {
        seen.add(key);
        tabs.push({ key, blockId, active });
      }
    }
    function visit(node, depth = 0) {
      if (!node || depth > 32) return;
      if (node.kind === "block" && Array.isArray(node.keys)) for (const key of node.keys) add(key, node.id, node.active === key);
      else if (Array.isArray(node.children)) node.children.forEach((child) => visit(child, depth + 1));
    }
    visit(view?.ui?.terminalLayout);
    if (!tabs.length && Array.isArray(view?.ui?.terminalTabs?.keys)) for (const key of view.ui.terminalTabs.keys) add(key, "block-main", key === view.ui.terminalTabs.active);
    for (const key of known.get(scope.workspaceId) || []) if (await ctx.host.resources.lookup(`pty:${scope.workspaceId}:${key}`)) add(key, null, !tabs.length);
    return Promise.all(tabs.map(async (tab, index) => {
      const handle = await ctx.host.resources.lookup(`pty:${scope.workspaceId}:${tab.key}`);
      const info = handle ? await ctx.host.pty.info(handle) : null;
      if (info && info.machineId !== scope.machineId) throw new Error("Terminal belongs to another machine; restart it in the current workspace");
      return {
        ...tab,
        title: `Terminal ${index + 1}`,
        machineId: scope.machineId,
        cwd: info?.cwd || null,
        exit: info?.exit || null,
        status: !handle ? "not_started" : info?.exit ? "exited" : running.has(handle) ? "running_command" : "open"
      };
    }));
  }
  async function target(scope, args) {
    const tabs = await list(scope);
    const tab = args.tab === void 0 ? tabs.find((tab2) => tab2.active) || tabs[0] : tabs.find((tab2) => tab2.key === args.tab);
    if (!tab) throw new Error("Unknown terminal tab in this workspace; use list_tabs first");
    const handle = await ctx.host.resources.lookup(`pty:${scope.workspaceId}:${tab.key}`);
    if (!handle) throw new Error("Terminal tab is not running; open it in the terminal panel first");
    return { handle, tab: tab.key };
  }
  function integer(value, fallback, min, max) {
    if (value === void 0) return fallback;
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Expected an integer from ${min} to ${max}`);
    return value;
  }
  const schema = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
  const tabProperty = { type: "string", description: "Tab key from list_tabs. Defaults to the first active tab." };
  const tools = [
    {
      name: "list_tabs",
      title: "List terminal tabs",
      description: "List terminal tabs and blocks in the authenticated workspace, including stable tab keys and status.",
      inputSchema: schema({}),
      annotations: { readOnlyHint: true },
      handler: (_args, scope) => list(scope)
    },
    {
      name: "tail",
      title: "Read terminal output",
      description: "Read bounded recent terminal output (up to 64 KiB), or output after a byte cursor. ANSI controls are removed. Reports truncated history.",
      inputSchema: schema({ tab: tabProperty, lines: { type: "integer", minimum: 1, maximum: 500 }, cursor: { type: "integer", minimum: 0 } }),
      annotations: { readOnlyHint: true },
      async handler(args, scope) {
        const { handle, tab } = await target(scope, args);
        const lines = integer(args.lines, 80, 1, 500);
        const cursor = args.cursor === void 0 ? void 0 : integer(args.cursor, 0, 0, Number.MAX_SAFE_INTEGER);
        const result = await ctx.host.pty.read(handle, { cursor, limitBytes: 65536 });
        const outputLines = plainOutput(result.text).split("\n");
        return { tab, ...result, truncated: result.truncated || outputLines.length > lines, text: outputLines.slice(-lines).join("\n") };
      }
    },
    {
      name: "send",
      title: "Send terminal input",
      description: "Send input to an existing workspace terminal. Set enter=true to submit a line. May execute arbitrary commands. Send \\u0003 to interrupt.",
      inputSchema: schema({ tab: tabProperty, text: { type: "string", maxLength: 65536 }, enter: { type: "boolean" } }, ["text"]),
      annotations: { destructiveHint: true },
      async handler(args, scope) {
        if (typeof args.text !== "string" || args.text.length > 65536 || args.enter !== void 0 && typeof args.enter !== "boolean") throw new Error("Invalid terminal input");
        const { handle, tab } = await target(scope, args);
        if (running.has(handle) && args.text !== "") throw new Error("A command is running in this tab; only an interrupt is allowed until it completes");
        await ctx.host.pty.write(handle, args.text + (args.enter ? "\r" : ""));
        if (args.text === "") running.delete(handle);
        return { tab, sent: true };
      }
    },
    {
      name: "run_and_wait_for_answer",
      title: "Run terminal command and wait",
      description: "Run a command through sh in an existing workspace terminal and wait for its exit marker. Inherits that terminal’s cwd/environment; changes inside the command do not alter the parent shell. Timeout leaves the command running. Use on a shell prompt, not inside an editor or another foreground program.",
      inputSchema: schema({ tab: tabProperty, command: { type: "string", minLength: 1, maxLength: 32768 }, timeoutMs: { type: "integer", minimum: 100, maximum: 12e4 } }, ["command"]),
      annotations: { destructiveHint: true },
      timeoutMs: 15e4,
      async handler(args, scope) {
        if (typeof args.command !== "string" || !args.command.trim() || args.command.length > 32768 || args.command.includes("\0")) throw new Error("Invalid terminal command");
        const timeout = integer(args.timeoutMs, 3e4, 100, 12e4);
        const { handle, tab } = await target(scope, args);
        if (running.has(handle)) throw new Error("A command is already running in this tab");
        const nonce = crypto.randomHex(12);
        running.set(handle, nonce);
        const start = `HATO_START_${nonce}`, end = `HATO_END_${nonce}:`;
        let timedOut = false;
        try {
          let cursor = (await ctx.host.pty.read(handle, { limitBytes: 0 })).cursor;
          const script = `printf '\\036HATO_START_${nonce}\\037\\n'; ( eval ${shellQuote(args.command)} ); hato_result=$?; printf '\\036HATO_END_${nonce}:%s\\037\\n' "$hato_result"`;
          await ctx.host.pty.write(handle, `sh -c ${shellQuote(script)}\r`);
          const deadline = Date.now() + timeout;
          let buffer = "", started = false, truncated = false;
          while (Date.now() < deadline) {
            const output = await ctx.host.pty.read(handle, { cursor, limitBytes: 65536 });
            cursor = output.cursor;
            truncated || (truncated = output.truncated);
            buffer += output.text;
            if (!started) {
              const index = buffer.indexOf(start);
              if (index >= 0) {
                started = true;
                buffer = buffer.slice(index + start.length);
              }
            }
            if (started) {
              const index = buffer.indexOf(end);
              if (index >= 0) {
                const match = /^(-?\d+)\x1f/.exec(buffer.slice(index + end.length));
                if (match) return { tab, exitCode: Number(match[1]), text: plainOutput(buffer.slice(0, index)).replace(/^\n/, ""), cursor, truncated, timedOut: false };
              }
            }
            if (buffer.length > 131072) {
              buffer = buffer.slice(-65536);
              truncated = true;
            }
            if (output.exit !== null) return { tab, exitCode: null, text: started ? plainOutput(buffer) : "", cursor, truncated, exited: output.exit, timedOut: false };
            await sleep(100);
          }
          timedOut = true;
          void (async () => {
            let suffix = buffer.slice(-256);
            try {
              while (running.get(handle) === nonce) {
                await sleep(250);
                const output = await ctx.host.pty.read(handle, { cursor, limitBytes: 65536 });
                cursor = output.cursor;
                suffix = (suffix + output.text).slice(-65536);
                if (suffix.includes(end) || output.exit !== null) break;
                suffix = suffix.slice(-256);
              }
            } catch {
            } finally {
              if (running.get(handle) === nonce) running.delete(handle);
            }
          })();
          return { tab, exitCode: null, text: started ? plainOutput(buffer) : "", cursor, truncated, timedOut: true, running: true };
        } finally {
          if (!timedOut && running.get(handle) === nonce) running.delete(handle);
        }
      }
    }
  ];
  return { tools, remember, forget: (workspace, key) => known.get(workspace)?.delete(key), snapshot: () => [...known].map(([workspace, keys]) => [workspace, [...keys]]), running: () => running.size };
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
  const publish = (error = null) => {
    const value = { sections: getSections(), error, ...options.reset ? { resetLabel: options.reset.label } : {} };
    ctx.state.set(`${ctx.moduleId}.settings`, value);
  };
  let queue = Promise.resolve();
  ctx.events.on("settings.change", (edit) => {
    if (edit?.module !== ctx.moduleId) return;
    queue = queue.then(async () => {
      try {
        const section = getSections().find((s) => s.key === edit.section);
        const field = section?.fields.find((f) => f.key === edit.key);
        if (!field) throw new Error("Setting is no longer available");
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

// modules/services/terminals/src/index.ts
var keepRemote = true;
var keepLocal = false;
var ensured = /* @__PURE__ */ new Map();
var daemonKey = (stable) => stable.replace(/[^A-Za-z0-9\-_.:@/]/g, "_");
async function daemonTarget(ctx, d) {
  if (d.location === "ssh" ? !keepRemote : !keepLocal) return null;
  const target = d.location === "ssh" ? { kind: "ssh", connection: (await sshConnect(ctx, d)).connection } : { kind: "local" };
  let p = ensured.get(d.machineId);
  if (!p) {
    p = ctx.host.daemon.ensure(target);
    ensured.set(d.machineId, p);
  }
  try {
    await p;
    return target;
  } catch (e) {
    ensured.delete(d.machineId);
    ctx.host.ui.toast("warn", `Terminals on ${d.machineId} will not survive disconnects: ${errMsg(e)}`);
    return null;
  }
}
var commands;
var contribution;
var keyFor = (workspaceId, key) => `pty:${workspaceId}:${key || "main"}`;
async function attach(ctx, a, forceNew = false) {
  const d = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
  const stable = keyFor(d.id, a.key);
  commands?.remember(d.id, a.key || "main");
  const existing = await ctx.host.resources.lookup(stable);
  if (existing && !forceNew) {
    const info = await ctx.host.pty.info(existing);
    return { pty: existing, machineId: info.machineId, cwd: info.cwd, exited: info.exit, reattached: true };
  }
  if (existing && forceNew) await ctx.host.pty.close(existing).catch(() => {
  });
  return withWorkspace(ctx, d, async () => {
    const g = await workspaceGrant(ctx, d, "pty");
    const target = await daemonTarget(ctx, d);
    if (target && forceNew) await ctx.host.daemon.request(target, "pty.kill", { key: daemonKey(stable) }).catch(() => {
    });
    const r = await ctx.host.pty.open(g.grant, {
      cwd: d.rootAbsolutePath,
      columns: a.columns || 120,
      rows: a.rows || 30,
      ...target ? { persist: { key: daemonKey(stable) } } : {}
    });
    await ctx.host.resources.retainForWorkspace(r.handle, stable);
    ctx.events.emit("terminals.changed", { workspaceId: d.id });
    return { pty: r.handle, machineId: r.machineId, cwd: r.cwd, exited: null, reattached: false };
  });
}
var mod = {
  id: "terminals",
  moduleApiVersion: 1,
  async activate(ctx, prev) {
    commands = terminalTools(ctx, prev?.known);
    contribution = exportMcpTools(ctx, "Terminal", commands.tools);
    const saved = await ctx.modules.call("persistence", "settings.get", { key: "terminals.persistence" }).catch(() => null);
    if (saved && typeof saved === "object") {
      keepRemote = saved.remote !== false;
      keepLocal = saved.local === true;
    }
    exportSettings(ctx, () => [{ key: "terminals", title: "Terminals", fields: [
      {
        key: "remote",
        label: "Keep SSH terminals running on the server",
        type: "toggle",
        value: keepRemote,
        description: "Shells run inside the Hato daemon on the remote machine and survive disconnects; reopening reattaches."
      },
      {
        key: "local",
        label: "Keep local terminals running after quitting",
        type: "toggle",
        value: keepLocal,
        description: "Shells run inside a local Hato daemon and are reattached at the next start."
      }
    ] }], async (_section, key, value) => {
      if (key !== "remote" && key !== "local" || typeof value !== "boolean") throw new Error("Invalid terminal preference");
      const next = { remote: key === "remote" ? value : keepRemote, local: key === "local" ? value : keepLocal };
      await ctx.modules.call("persistence", "settings.set", { key: "terminals.persistence", value: next });
      keepRemote = next.remote;
      keepLocal = next.local;
    });
  },
  snapshot: () => ({ known: commands.snapshot() }),
  canSwap: async () => ({ ok: !commands.running() && !contribution.pending(), reason: "A terminal MCP command is in progress" }),
  methods: {
    async workspaceControl(ctx, a, meta) {
      if (meta.caller !== "internal-remote-mcp") throw new Error("Workspace terminal control requires the workspace MCP server");
      const tool = commands.tools.find((t) => t.name === a.tool);
      if (!tool) throw new Error("Unknown terminal tool");
      return tool.handler(a.args || {}, a.scope);
    },
    attach: (ctx, a) => attach(ctx, a, false),
    restart: (ctx, a) => attach(ctx, a, true),
    async close(ctx, a) {
      const h = await ctx.host.resources.lookup(keyFor(a.workspaceId, a.key));
      if (h) await ctx.host.pty.close(h);
      try {
        const d = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
        const target = await daemonTarget(ctx, d);
        if (target) await ctx.host.daemon.request(target, "pty.kill", { key: daemonKey(keyFor(d.id, a.key)) }).catch(() => {
        });
      } catch {
      }
      commands?.forget(a.workspaceId, a.key || "main");
      ctx.events.emit("terminals.changed", { workspaceId: a.workspaceId });
      return null;
    },
    async runCode(ctx, a) {
      const d = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
      const tool = commands.tools.find((tool2) => tool2.name === "run_and_wait_for_answer");
      return tool.handler({ tab: a.key, command: a.command, timeoutMs: 100 }, { conversationId: "markdown", workspaceId: d.id, machineId: d.machineId });
    },
    async activity(ctx, a) {
      const keys = [...new Set((Array.isArray(a.keys) ? a.keys : []).filter((key) => typeof key === "string"))].slice(0, 128);
      return Promise.all(keys.map(async (key) => {
        const handle = await ctx.host.resources.lookup(keyFor(a.workspaceId, key));
        if (!handle) return { key, cursor: null };
        try {
          const output = await ctx.host.pty.read(handle, { limitBytes: 1 });
          return { key, cursor: output.endCursor };
        } catch {
          return { key, cursor: null };
        }
      }));
    },
    async lookup(ctx, a) {
      return ctx.host.resources.lookup(keyFor(a.workspaceId, a.key));
    },
    async info(ctx, a) {
      const h = await ctx.host.resources.lookup(keyFor(a.workspaceId, a.key));
      return h ? { pty: h, ...await ctx.host.pty.info(h) } : null;
    },
    async send(ctx, a) {
      const h = await ctx.host.resources.lookup(keyFor(a.workspaceId, a.key));
      if (!h) throw new Error("no terminal for this workspace");
      await ctx.host.pty.write(h, String(a.text));
      return null;
    }
  }
};
var index_default = mod;
export {
  index_default as default
};
