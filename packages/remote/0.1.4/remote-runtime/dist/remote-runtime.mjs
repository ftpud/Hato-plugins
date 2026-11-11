// ../sdk/runtime.ts
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
function errMsg(e) {
  return e && (e.message || String(e)) || "unknown error";
}

// ../sdk/scoped-settings.ts
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
async function syncScope(scope, local, remote) {
  const [left, right] = await Promise.all([local("scoped.list", { scope }), remote("scoped.list", { scope })]);
  const l = new Map(left.map((e) => [e.key, e])), r = new Map(right.map((e) => [e.key, e]));
  const conflicts = [];
  for (const key of /* @__PURE__ */ new Set([...l.keys(), ...r.keys()])) {
    const a = l.get(key), b = r.get(key);
    if (a && b && a.rev === b.rev) {
      if (canonical(a.value) === canonical(b.value)) continue;
      conflicts.push(key);
      const rev = a.rev + 1;
      await local("scoped.set", { scope, key, value: a.value, expectedRev: a.rev, rev });
      await remote("scoped.set", { scope, key, value: a.value, expectedRev: b.rev, rev });
    } else {
      const from = a && (!b || a.rev > b.rev) ? a : b;
      const destination = from === a ? remote : local;
      await destination("scoped.set", { scope, key, value: from.value, rev: from.rev, expectedRev: (from === a ? b : a)?.rev ?? 0 });
    }
  }
  return { conflicts };
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
      } catch (error) {
        publish(error instanceof Error ? error.message : String(error));
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

// modules/services/remote-runtime/src/index.ts
var autoStart = true;
var autoPush = true;
var lastError = /* @__PURE__ */ new Map();
var connected = /* @__PURE__ */ new Map();
var tunnels = /* @__PURE__ */ new Map();
var syncing = /* @__PURE__ */ new Map();
function sync(ctx, machineId, target) {
  const previous = syncing.get(machineId) || Promise.resolve();
  const next = previous.catch(() => {
  }).then(async () => {
    const result = await syncScope(
      `machine:${machineId}`,
      (method, args) => ctx.modules.call("persistence", method, args),
      (method, args) => ctx.host.daemon.request(target, "modules.call", { target: "persistence", method, args })
    );
    if (result.conflicts.length) {
      const message = `Settings conflicts (desktop retained): ${result.conflicts.join(", ")}`;
      lastError.set(machineId, message);
      ctx.log.warn(message);
    }
    return result;
  });
  syncing.set(machineId, next);
  void next.finally(() => {
    if (syncing.get(machineId) === next) syncing.delete(machineId);
  }).catch(() => {
  });
  return next;
}
async function resolve(ctx, workspaceId) {
  const d = await ctx.modules.call("workspace", "resolve", { workspaceId });
  const target = d.location === "ssh" ? { kind: "ssh", connection: (await sshConnect(ctx, d)).connection } : { kind: "local" };
  return { d, target };
}
async function workspacePlugins(ctx) {
  const { plugins } = await ctx.host.plugins.list();
  return plugins.filter((p) => p.enabled && p.kind === "service" && p.runsOn === "workspace");
}
async function ensure(ctx, workspaceId) {
  const { d, target } = await resolve(ctx, workspaceId);
  try {
    const status = await ctx.host.daemon.ensure(target);
    lastError.delete(d.machineId);
    if (d.location === "ssh") {
      await ctx.host.daemon.request(target, "plugins.push", { id: "persistence" });
      await sync(ctx, d.machineId, target);
      connected.set(d.machineId, target);
    }
    const pushed = [];
    if (autoPush) for (const p of await workspacePlugins(ctx)) {
      try {
        await ctx.host.daemon.request(target, "plugins.push", { id: p.id });
        pushed.push(p.id);
      } catch (e) {
        lastError.set(d.machineId, `${p.id}: ${errMsg(e)}`);
      }
    }
    ctx.events.emit("remote-runtime.changed", { machineId: d.machineId });
    return { machineId: d.machineId, status, pushed };
  } catch (e) {
    lastError.set(d.machineId, errMsg(e));
    ctx.events.emit("remote-runtime.changed", { machineId: d.machineId });
    throw e;
  }
}
var mod = {
  id: "remote-runtime",
  moduleApiVersion: 1,
  async activate(ctx, prev) {
    for (const [id, tunnel] of prev?.tunnels || []) tunnels.set(id, tunnel);
    const saved = await ctx.modules.call("persistence", "settings.get", { key: "remote-runtime.prefs" }).catch(() => null);
    if (saved && typeof saved === "object") {
      autoStart = saved.autoStart !== false;
      autoPush = saved.autoPush !== false;
    }
    exportSettings(ctx, () => [{ key: "remote", title: "Remote runtime", fields: [
      {
        key: "autoStart",
        label: "Start the Hato daemon when an SSH workspace is selected",
        type: "toggle",
        value: autoStart,
        description: "Installs a small copy of Hato on the server (in ~/.hato) so terminals and plugins keep running while you are offline."
      },
      {
        key: "autoPush",
        label: "Run workspace plugins on the server",
        type: "toggle",
        value: autoPush,
        description: `Enabled plugins whose manifest says runsOn: "workspace" are copied to the server's daemon with the permissions you approved.`
      }
    ] }], async (_s, key, value) => {
      if (key !== "autoStart" && key !== "autoPush" || typeof value !== "boolean") throw new Error("Invalid preference");
      const next = { autoStart: key === "autoStart" ? value : autoStart, autoPush: key === "autoPush" ? value : autoPush };
      await ctx.modules.call("persistence", "settings.set", { key: "remote-runtime.prefs", value: next });
      autoStart = next.autoStart;
      autoPush = next.autoPush;
    });
    let ensuredFor = null;
    ctx.state.watch("workspace.selected", (ws) => {
      const id = autoStart && ws?.location === "ssh" && ws.id ? String(ws.id) : null;
      if (id === ensuredFor) return;
      ensuredFor = id;
      if (id) ensure(ctx, id).catch((e) => {
        if (ensuredFor === id) ensuredFor = null;
        ctx.log.warn("daemon", errMsg(e));
      });
    });
    ctx.events.on("persistence.settingChanged", (event) => {
      if (!event?.scope?.startsWith("machine:")) return;
      const machineId = event.scope.slice(8), target = connected.get(machineId);
      if (target) sync(ctx, machineId, target).catch((e) => {
        lastError.set(machineId, errMsg(e));
        ctx.events.emit("remote-runtime.changed", { machineId });
      });
    });
    ctx.events.on("terminals.changed", () => {
      ctx.events.emit("remote-runtime.changed", {});
      setTimeout(() => ctx.events.emit("remote-runtime.changed", {}), 1500);
    });
    ctx.events.on("kernel.modules.changed", () => {
      const ws = ctx.state.get("workspace.selected");
      if (autoPush && ws?.location === "ssh" && ws.id) resolve(ctx, ws.id).then(async ({ target }) => {
        if (!await ctx.host.daemon.status(target)) return;
        for (const p of await workspacePlugins(ctx)) await ctx.host.daemon.request(target, "plugins.push", { id: p.id }).catch(() => {
        });
      }).catch(() => {
      });
    });
  },
  snapshot: () => ({ tunnels: Array.from(tunnels.entries()) }),
  methods: {
    async tunnels(ctx, a) {
      const { d } = await resolve(ctx, String(a.workspaceId));
      return Array.from(tunnels.entries()).filter(([, t]) => t.machineId === d.machineId).map(([id, t]) => ({ ...t, id, handle: void 0 }));
    },
    async startTunnel(ctx, a) {
      const { d, target } = await resolve(ctx, String(a.workspaceId));
      if (target.kind !== "ssh") throw new Error("Select an SSH workspace.");
      const localPort = Number(a.localPort), remotePort = Number(a.remotePort), remoteHost = String(a.remoteHost || "").trim();
      if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535 || !Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535 || !remoteHost) throw new Error("Enter a host and valid ports (1–65535).");
      const result = await ctx.host.ssh.localForward(target.connection, { localPort, remoteHost, remotePort });
      tunnels.set(String(result.handle), { handle: result.handle, machineId: d.machineId, localPort: result.localPort, remoteHost, remotePort });
    },
    async stopTunnel(ctx, a) {
      const { d } = await resolve(ctx, String(a.workspaceId));
      const t = tunnels.get(String(a.id));
      if (!t || t.machineId !== d.machineId) throw new Error("Tunnel not found.");
      await ctx.host.ssh.cancelForward(t.handle);
      tunnels.delete(String(a.id));
    },
    async sync(ctx, a) {
      const { d, target } = await resolve(ctx, String(a.workspaceId));
      return sync(ctx, d.machineId, target);
    },
    ensure: (ctx, a) => ensure(ctx, String(a.workspaceId)),
    async status(ctx, a) {
      const { d, target } = await resolve(ctx, String(a.workspaceId));
      const daemon = await ctx.host.daemon.status(target);
      const base = { machineId: d.machineId, location: d.location, error: lastError.get(d.machineId) || null, candidates: (await workspacePlugins(ctx)).map((p) => p.id) };
      if (!daemon) return { ...base, running: false };
      try {
        const hello = await ctx.host.daemon.request(target, "hello");
        return { ...base, running: true, version: hello.version, pid: hello.pid, stale: !!daemon.status?.stale, resources: hello.resources, plugins: hello.plugins };
      } catch (e) {
        return { ...base, running: false, error: errMsg(e) };
      }
    },
    async kill(ctx, a) {
      const { target } = await resolve(ctx, String(a.workspaceId));
      await ctx.host.daemon.request(target, a.kind === "proc" ? "proc.kill" : "pty.kill", { key: String(a.key) });
      ctx.events.emit("remote-runtime.changed", {});
      return null;
    },
    async push(ctx, a) {
      const { target } = await resolve(ctx, String(a.workspaceId));
      const r = await ctx.host.daemon.request(target, "plugins.push", { id: String(a.id) });
      ctx.events.emit("remote-runtime.changed", {});
      return r;
    },
    /** Push the desktop's current build of every daemon-side plugin, replacing running versions.
     *  Unlike automatic pushes this does not wait for idle: processes held by a replaced plugin
     *  (e.g. background agents) stop and must reconnect. The daemon binary itself is native and
     *  still restarts only when idle. */
    async forceUpdate(ctx, a) {
      const { d, target } = await resolve(ctx, String(a.workspaceId));
      await ctx.host.daemon.ensure(target);
      const local = (await ctx.host.plugins.list()).plugins.filter((p) => p.enabled && p.kind === "service");
      const remote = (await ctx.host.daemon.request(target, "plugins.list"))?.plugins || [];
      const ids = [.../* @__PURE__ */ new Set([
        ...d.location === "ssh" ? ["persistence"] : [],
        ...remote.filter((p) => p.enabled !== false && local.some((l) => l.id === p.id)).map((p) => String(p.id)),
        ...(await workspacePlugins(ctx)).map((p) => p.id)
      ])];
      const results = [];
      for (const id of ids) {
        try {
          const r = await ctx.host.daemon.request(target, "plugins.push", { id });
          results.push({ id, reloaded: !!r?.reloaded, active: r?.active || null, error: r?.error || null });
        } catch (e) {
          results.push({ id, reloaded: false, active: null, error: errMsg(e) });
        }
      }
      const failed = results.filter((r) => r.error);
      if (failed.length) lastError.set(d.machineId, failed.map((r) => `${r.id}: ${r.error}`).join("; "));
      else lastError.delete(d.machineId);
      ctx.events.emit("remote-runtime.changed", { machineId: d.machineId });
      ctx.events.emit("remote-runtime.updated", { machineId: d.machineId, plugins: results.filter((r) => r.reloaded).map((r) => r.id) });
      return { machineId: d.machineId, plugins: results };
    },
    async disable(ctx, a) {
      const { target } = await resolve(ctx, String(a.workspaceId));
      const r = await ctx.host.daemon.request(target, "plugins.disable", { id: String(a.id) });
      ctx.events.emit("remote-runtime.changed", {});
      return r;
    }
  }
};
var index_default = mod;
export {
  index_default as default
};
