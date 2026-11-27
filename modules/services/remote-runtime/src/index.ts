// remote-runtime: policy for the workspace machine's daemon. The kernel only installs/starts the
// daemon and moves requests; this module decides when to start it, which plugins run there
// (manifest `runsOn: "workspace"`, pushed automatically when enabled), and exposes status and
// controls to UI plugins. Changes here hot reload like any module.
import type { AppModule, DaemonPolicy, DaemonPolicyStatus, DaemonTarget, ModuleContext, PluginInfo } from "@hato/sdk/types";
import { daemonTargetFor, errMsg, sshFromProfile, sshProfileSpec, type WorkspaceDescriptor } from "@hato/sdk/runtime";
import { syncScope } from "@hato/sdk/scoped-settings";
import { exportSettings } from "@hato/sdk/settings";
import { PLATFORM_LABELS, pluginSupport, workspaceOs } from "@hato/sdk/platform";
import { NO_DAEMON_LIMITS, POLICY_KEY, effectivePolicy, expiredTerminals, normalizePolicy, pluginAllowed, pushBlocked, type MachinePolicy } from "./policy";

let autoStart = true;
let sweepTimer: any = null;
/** Per machine: terminal key → when it was first seen detached (idle cleanup). */
const detachedSince = new Map<string, Map<string, number>>();

/** The machine's saved settings, including limits that "Unlimited" currently switches off. */
async function savedPolicy(ctx: ModuleContext, machineId: string): Promise<MachinePolicy> {
  const saved = await ctx.modules.call("persistence", "scoped.get", { scope: `machine:${machineId}`, key: POLICY_KEY }).catch(() => null);
  return normalizePolicy(saved?.value);
}
/** The rules to apply on the machine. */
async function policyFor(ctx: ModuleContext, machineId: string): Promise<MachinePolicy> {
  return effectivePolicy(await savedPolicy(ctx, machineId));
}
async function storePolicy(ctx: ModuleContext, machineId: string, policy: MachinePolicy) {
  await ctx.modules.call("persistence", "scoped.set", { scope: `machine:${machineId}`, key: POLICY_KEY, value: policy as any });
}
let autoPush = true;
const lastError = new Map<string, string>();
const connected = new Map<string, DaemonTarget>();
const tunnels = new Map<string, any>();
const syncing = new Map<string, Promise<any>>();
/** Machines whose daemon was ensured by a workspace selection in this module generation. */
const ensuredMachines = new Set<string>();
function sync(ctx: ModuleContext, machineId: string, target: DaemonTarget) {
  const previous = syncing.get(machineId) || Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    const result = await syncScope(`machine:${machineId}`,
      (method, args) => ctx.modules.call("persistence", method, args),
      (method, args) => ctx.host.daemon.request(target, "modules.call", { target: "persistence", method, args }));
    if (result.conflicts.length) {
      const message = `Settings conflicts (desktop retained): ${result.conflicts.join(", ")}`;
      lastError.set(machineId, message);
      ctx.log.warn(message);
    }
    return result;
  });
  syncing.set(machineId, next);
  void next.finally(() => { if (syncing.get(machineId) === next) syncing.delete(machineId); }).catch(() => {});
  return next;
}

async function resolve(ctx: ModuleContext, workspaceId: string): Promise<{ d: WorkspaceDescriptor; target: DaemonTarget }> {
  const d: WorkspaceDescriptor = await ctx.modules.call("workspace", "resolve", { workspaceId });
  const target = await daemonTargetFor(ctx, d);
  return { d, target };
}

/** Locally enabled service plugins meant for the workspace machine (before the machine policy). */
async function enabledWorkspacePlugins(ctx: ModuleContext): Promise<PluginInfo[]> {
  const { plugins } = await ctx.host.plugins.list();
  return plugins.filter((p) => p.enabled && p.kind === "service" && p.runsOn === "workspace");
}

/** Workspace plugins to run on the machine: minus those that declare its OS unsupported (its
 *  daemon would refuse them) and those the machine policy does not allow. */
async function workspacePlugins(ctx: ModuleContext, d: WorkspaceDescriptor, policy?: MachinePolicy): Promise<PluginInfo[]> {
  const os = workspaceOs(ctx, d), rules = policy || await policyFor(ctx, d.machineId);
  return (await enabledWorkspacePlugins(ctx)).filter((p) => pluginSupport(p, os).status !== "unsupported" && pluginAllowed(rules, p.id));
}

/** Enabled workspace plugins left out on this machine, with the reason (shown in the remote panel). */
async function skippedPlugins(ctx: ModuleContext, d: WorkspaceDescriptor, policy: MachinePolicy): Promise<{ id: string; reason: string }[]> {
  const os = workspaceOs(ctx, d);
  return (await enabledWorkspacePlugins(ctx)).flatMap((p) => {
    const s = pluginSupport(p, os);
    if (s.status === "unsupported" && os !== "posix") return [{ id: p.id, reason: `not supported on ${PLATFORM_LABELS[os]}${s.note ? `: ${s.note}` : ""}` }];
    return pluginAllowed(policy, p.id) ? [] : [{ id: p.id, reason: "not allowed by this machine's policy" }];
  });
}

/** Stop terminals that stayed detached past the machine's idle limit. Runs only while this
 *  desktop is connected to the machine. */
async function sweepIdle(ctx: ModuleContext) {
  for (const [machineId, target] of connected) {
    const policy = await policyFor(ctx, machineId);
    const seen = detachedSince.get(machineId) || new Map<string, number>();
    detachedSince.set(machineId, seen);
    if (!policy.idleTerminalMinutes) { seen.clear(); continue; }
    try {
      if (!(await ctx.host.daemon.status(target))) continue;
      const hello: any = await ctx.host.daemon.request(target, "hello");
      const expired = expiredTerminals(hello?.resources?.ptys || [], seen, Date.now(), policy.idleTerminalMinutes);
      for (const key of expired) {
        await ctx.host.daemon.request(target, "pty.kill", { key }).catch((e) => ctx.log.warn("idle cleanup", key, errMsg(e)));
        seen.delete(key);
      }
      if (expired.length) {
        ctx.log.info(`Stopped ${expired.length} idle terminal(s) on ${machineId}`);
        ctx.events.emit("remote-runtime.changed", { machineId });
      }
    } catch (e) { ctx.log.warn("idle cleanup", machineId, errMsg(e)); }
  }
}

/** Machines whose agent runtime rejected or missed the latest limits: machineId → reason. */
const limitsError = new Map<string, string>();
/** Hand the machine's agent limits to its agent runtime, when that runtime is running there. */
async function sendAgentLimits(ctx: ModuleContext, machineId: string, target: DaemonTarget, policy: MachinePolicy) {
  try {
    const hello: any = await ctx.host.daemon.request(target, "hello");
    if (!(hello?.plugins || []).some((p: any) => p.id === "agent-runner" && p.enabled !== false)) { limitsError.delete(machineId); return; }
    await ctx.host.daemon.request(target, "modules.call", { target: "agent-runner", method: "setLimits", args: { limits: policy.agents } });
    limitsError.delete(machineId);
  } catch (e) {
    // An agent runtime from before machine limits has no setLimits: say so instead of failing quietly.
    limitsError.set(machineId, `Agent limits not applied: ${errMsg(e)}`);
    ctx.log.warn("agent limits", machineId, errMsg(e));
  }
}

async function ensure(ctx: ModuleContext, workspaceId: string) {
  const { d, target } = await resolve(ctx, workspaceId);
  try {
    const status = await ctx.host.daemon.ensure(target);
    lastError.delete(d.machineId);
    if (d.location === "ssh") {
      await ctx.host.daemon.request(target, "plugins.push", { id: "persistence" });
      await sync(ctx, d.machineId, target);
      connected.set(d.machineId, target);
    }
    const pushed: string[] = [];
    const policy = await policyFor(ctx, d.machineId);
    if ((policy.autoPush ?? autoPush) && !policy.readOnly) for (const p of await workspacePlugins(ctx, d, policy)) {
      try { await ctx.host.daemon.request(target, "plugins.push", { id: p.id }); pushed.push(p.id); }
      catch (e) { lastError.set(d.machineId, `${p.id}: ${errMsg(e)}`); }
    }
    await sendAgentLimits(ctx, d.machineId, target, policy);
    ctx.events.emit("remote-runtime.changed", { machineId: d.machineId });
    return { machineId: d.machineId, status, pushed };
  } catch (e) {
    lastError.set(d.machineId, errMsg(e));
    ctx.events.emit("remote-runtime.changed", { machineId: d.machineId });
    throw e;
  }
}

const mod: AppModule = {
  id: "remote-runtime",
  moduleApiVersion: 1,
  async activate(ctx, prev: any) {
    for (const [id, tunnel] of prev?.tunnels || []) tunnels.set(id, tunnel);
    const saved = await ctx.modules.call("persistence", "settings.get", { key: "remote-runtime.prefs" }).catch(() => null);
    if (saved && typeof saved === "object") { autoStart = saved.autoStart !== false; autoPush = saved.autoPush !== false; }
    exportSettings(ctx, () => [{ key: "remote", title: "Remote runtime", fields: [
      { key: "autoStart", label: "Start the Hato daemon when an SSH workspace is selected", type: "toggle", value: autoStart,
        description: "Installs a small copy of Hato on the server (in ~/.hato) so terminals and plugins keep running while you are offline." },
      { key: "autoPush", label: "Run workspace plugins on the server", type: "toggle", value: autoPush,
        description: "Enabled plugins whose manifest says runsOn: \"workspace\" are copied to the server's daemon with the permissions you approved." },
    ] }], async (_s, key, value) => {
      if ((key !== "autoStart" && key !== "autoPush") || typeof value !== "boolean") throw new Error("Invalid preference");
      const next = { autoStart: key === "autoStart" ? value : autoStart, autoPush: key === "autoPush" ? value : autoPush };
      await ctx.modules.call("persistence", "settings.set", { key: "remote-runtime.prefs", value: next });
      autoStart = next.autoStart; autoPush = next.autoPush;
    });
    // The daemon, its service plugins and machine-scoped settings belong to the machine, not the
    // project: ensure them once per machine, so switching between projects on one host costs no
    // SSH round trips. Project state (terminals, agents, chats) stays keyed by workspace in its own
    // module. A failure, or the machine's connection being reset, retries on the next selection.
    ctx.state.watch("workspace.selected", (ws: any) => {
      if (ws?.location !== "ssh" || !ws.id || !ws.machineId) return;
      const machineId = String(ws.machineId);
      if (ensuredMachines.has(machineId)) return;
      ensuredMachines.add(machineId);
      // The machine's own setting wins over the global one.
      policyFor(ctx, machineId).then((policy) => {
        if (!(policy.autoStart ?? autoStart)) { ensuredMachines.delete(machineId); return; }
        return ensure(ctx, String(ws.id));
      }).catch((e) => { ensuredMachines.delete(machineId); ctx.log.warn("daemon", errMsg(e)); });
    });
    ctx.events.on("persistence.settingChanged", (event: any) => {
      if (!event?.scope?.startsWith("machine:")) return;
      const machineId = event.scope.slice(8), target = connected.get(machineId);
      if (target) sync(ctx, machineId, target).catch(e => {
        lastError.set(machineId, errMsg(e));
        ctx.events.emit("remote-runtime.changed", { machineId });
      });
    });
    // Terminals opened or closed change what the daemon holds.
    // The daemon creates the shell once the remote attach starts, shortly after the local viewer.
    ctx.events.on("terminals.changed", () => {
      ctx.events.emit("remote-runtime.changed", {});
      setTimeout(() => ctx.events.emit("remote-runtime.changed", {}), 1500);
    });
    sweepTimer = setInterval(() => { void sweepIdle(ctx); }, 60_000);
    // Newly enabled workspace plugins go to the current workspace machine right away.
    ctx.events.on("kernel.modules.changed", () => {
      const ws: any = ctx.state.get("workspace.selected");
      if (ws?.location === "ssh" && ws.id) resolve(ctx, ws.id).then(async ({ d, target }) => {
        if (!(await ctx.host.daemon.status(target))) return;
        const policy = await policyFor(ctx, d.machineId);
        if (policy.readOnly || !(policy.autoPush ?? autoPush)) return;
        for (const p of await workspacePlugins(ctx, d, policy)) await ctx.host.daemon.request(target, "plugins.push", { id: p.id }).catch(() => {});
        await sendAgentLimits(ctx, d.machineId, target, policy);
      }).catch(() => {});
    });
  },
  deactivate() { if (sweepTimer) clearInterval(sweepTimer); sweepTimer = null; },
  snapshot: () => ({ tunnels: Array.from(tunnels.entries()) }),
  methods: {
    async tunnels(ctx, a) { const { d } = await resolve(ctx, String(a.workspaceId)); return Array.from(tunnels.entries()).filter(([, t]) => t.machineId === d.machineId).map(([id, t]) => ({ ...t, id, handle: undefined })); },
    async startTunnel(ctx, a) {
      const { d, target } = await resolve(ctx, String(a.workspaceId));
      if (target.kind !== "ssh") throw new Error("Select an SSH workspace.");
      const localPort = Number(a.localPort), remotePort = Number(a.remotePort), remoteHost = String(a.remoteHost || "").trim();
      if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535 || !Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535 || !remoteHost) throw new Error("Enter a host and valid ports (1–65535).");
      const result = await ctx.host.ssh.localForward(target.connection, { localPort, remoteHost, remotePort });
      tunnels.set(String(result.handle), { handle: result.handle, machineId: d.machineId, localPort: result.localPort, remoteHost, remotePort });
    },
    async stopTunnel(ctx, a) { const { d } = await resolve(ctx, String(a.workspaceId)); const t = tunnels.get(String(a.id)); if (!t || t.machineId !== d.machineId) throw new Error("Tunnel not found."); await ctx.host.ssh.cancelForward(t.handle); tunnels.delete(String(a.id)); },
    async sync(ctx, a) {
      const { d, target } = await resolve(ctx, String(a.workspaceId));
      return sync(ctx, d.machineId, target);
    },
    ensure: (ctx, a) => ensure(ctx, String(a.workspaceId)),
    async policy(ctx, a) {
      const { d } = await resolve(ctx, String(a.workspaceId));
      return policyFor(ctx, d.machineId);
    },
    /** Replace the machine's policy. Already-running plugins are not stopped; the panel offers that. */
    async setPolicy(ctx, a) {
      const { d, target } = await resolve(ctx, String(a.workspaceId));
      const before = await savedPolicy(ctx, d.machineId);
      let policy = normalizePolicy(a.policy);
      const running = !!(await ctx.host.daemon.status(target).catch(() => null));
      // "Unlimited" also lifts the daemon's own limits, keeping them to restore later.
      if (before.limited !== policy.limited && running) {
        if (!policy.limited) {
          const current = await ctx.host.daemon.request<DaemonPolicyStatus>(target, "policy.get").catch(() => null);
          if (current) policy = { ...policy, enforced: current.policy };
          await ctx.host.daemon.request(target, "policy.set", { policy: NO_DAEMON_LIMITS }).catch((e) => ctx.log.warn("daemon limits", errMsg(e)));
        } else if (policy.enforced) {
          await ctx.host.daemon.request(target, "policy.set", { policy: policy.enforced }).catch((e) => ctx.log.warn("daemon limits", errMsg(e)));
        }
      }
      await storePolicy(ctx, d.machineId, policy);
      if (running) await sendAgentLimits(ctx, d.machineId, target, effectivePolicy(policy));
      if (!effectivePolicy(policy).idleTerminalMinutes) detachedSince.delete(d.machineId);
      ctx.events.emit("remote-runtime.changed", { machineId: d.machineId });
      return policy;
    },
    /** Replace the limits the daemon enforces on every plugin it runs (validated by the daemon).
     *  Only while the machine is limited; the saved copy is restored after "Unlimited". */
    async setEnforcedPolicy(ctx, a) {
      const { d, target } = await resolve(ctx, String(a.workspaceId));
      const saved = await savedPolicy(ctx, d.machineId);
      if (!saved.limited) throw new Error("Turn off Unlimited to set limits for this machine.");
      const r = await ctx.host.daemon.request<DaemonPolicyStatus>(target, "policy.set", { policy: a.policy as DaemonPolicy });
      await storePolicy(ctx, d.machineId, { ...saved, enforced: r.policy });
      ctx.events.emit("remote-runtime.changed", { machineId: d.machineId });
      return r;
    },
    /** Stop plugins running on the daemon that the machine's policy no longer allows. */
    async stopDisallowed(ctx, a) {
      const { d, target } = await resolve(ctx, String(a.workspaceId));
      const policy = await policyFor(ctx, d.machineId);
      const remote: any[] = (await ctx.host.daemon.request<any>(target, "plugins.list"))?.plugins || [];
      const stopped: string[] = [], failed: string[] = [];
      for (const p of remote.filter((p) => p.enabled !== false && !pluginAllowed(policy, String(p.id)))) {
        try { await ctx.host.daemon.request(target, "plugins.disable", { id: String(p.id) }); stopped.push(String(p.id)); }
        catch (e) { failed.push(`${p.id} (${errMsg(e)})`); }
      }
      ctx.events.emit("remote-runtime.changed", { machineId: d.machineId });
      if (failed.length) throw new Error(`Could not stop ${failed.join(", ")}`);
      return { stopped };
    },
    async status(ctx, a) {
      const { d, target } = await resolve(ctx, String(a.workspaceId));
      const daemon = await ctx.host.daemon.status(target);
      const saved = await savedPolicy(ctx, d.machineId), policy = effectivePolicy(saved);
      // `policy` is what the panel edits (limits are kept while "Unlimited" is on); the lists below
      // follow what is actually applied.
      const base = { machineId: d.machineId, location: d.location, error: lastError.get(d.machineId) || null, policy: saved,
        defaults: { autoStart, autoPush }, limitsError: limitsError.get(d.machineId) || null,
        available: (await enabledWorkspacePlugins(ctx)).map((p) => ({ id: p.id, name: p.name || p.id })),
        candidates: (await workspacePlugins(ctx, d, policy)).map((p) => p.id), skipped: await skippedPlugins(ctx, d, policy) };
      if (!daemon) { ensuredMachines.delete(d.machineId); return { ...base, running: false }; }
      try {
        const hello = await ctx.host.daemon.request(target, "hello");
        const stale = !!daemon.status?.stale || (d.location === "cloud" && !hello.features?.includes("fs"));
        // Limits the daemon itself enforces on its plugins. Daemons from before them say "unknown op".
        const enforced = await ctx.host.daemon.request<DaemonPolicyStatus>(target, "policy.get")
          .then((r) => ({ policy: r.policy, denials: r.denials || [], error: null }))
          .catch((e) => ({ policy: null, denials: [], error: /unknown daemon op|not available/.test(errMsg(e)) ? "This daemon is older than enforced limits. Use Force upgrade to replace it." : errMsg(e) }));
        return { ...base, running: true, version: hello.version, pid: hello.pid, stale, resources: hello.resources, plugins: hello.plugins, enforced };
      } catch (e) {
        ensuredMachines.delete(d.machineId); // ensure again on the next selection
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
      const { d, target } = await resolve(ctx, String(a.workspaceId));
      const blocked = pushBlocked(await policyFor(ctx, d.machineId), String(a.id));
      if (blocked) throw new Error(`${a.id}: ${blocked}`);
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
      const policy = await policyFor(ctx, d.machineId);
      if (policy.readOnly) throw new Error("This machine is read-only. Turn that off in its runtime settings to update plugins.");
      await ctx.host.daemon.ensure(target);
      const local = (await ctx.host.plugins.list()).plugins.filter((p) => p.enabled && p.kind === "service");
      const remote: any[] = (await ctx.host.daemon.request<any>(target, "plugins.list"))?.plugins || [];
      const ids = [...new Set([
        ...(d.location === "ssh" ? ["persistence"] : []),
        ...remote.filter((p) => p.enabled !== false && local.some((l) => l.id === p.id) && pluginAllowed(policy, String(p.id))).map((p) => String(p.id)),
        ...(await workspacePlugins(ctx, d, policy)).map((p) => p.id),
      ])];
      const results: any[] = [];
      for (const id of ids) {
        try { const r = await ctx.host.daemon.request<any>(target, "plugins.push", { id }); results.push({ id, reloaded: !!r?.reloaded, active: r?.active || null, error: r?.error || null }); }
        catch (e) { results.push({ id, reloaded: false, active: null, error: errMsg(e) }); }
      }
      const failed = results.filter((r) => r.error);
      if (failed.length) lastError.set(d.machineId, failed.map((r) => `${r.id}: ${r.error}`).join("; ")); else lastError.delete(d.machineId);
      ctx.events.emit("remote-runtime.changed", { machineId: d.machineId });
      ctx.events.emit("remote-runtime.updated", { machineId: d.machineId, plugins: results.filter((r) => r.reloaded).map((r) => r.id) });
      return { machineId: d.machineId, plugins: results };
    },
    async upgradeProfiles(ctx) {
      const profiles: Array<{ id: string; host: string; user: string; port: number; transport?: string }> =
        await ctx.modules.call("persistence", "ssh.list");
      return profiles.filter(p => p.transport !== "wsl")
        .map(p => ({ id: p.id, label: `${p.user}@${p.host}:${p.port}` }));
    },
    async forceUpgrade(ctx, a) {
      const d = await ctx.modules.call<WorkspaceDescriptor>("workspace", "resolve", { workspaceId: a.workspaceId });
      if (d.location === "local") {
        try {
          const upgraded = await ctx.host.daemon.forceUpgrade({ kind: "local" });
          lastError.delete(d.machineId);
          // The new daemon starts empty: send this machine's plugins and limits again.
          await ensure(ctx, String(a.workspaceId)).catch((e) => lastError.set(d.machineId, errMsg(e)));
          ctx.events.emit("remote-runtime.updated", { machineId: d.machineId, plugins: [] });
          return upgraded;
        } finally {
          ctx.events.emit("remote-runtime.changed", { machineId: d.machineId });
        }
      }
      try {
        let ssh = d.ssh;
        let cloud: Extract<DaemonTarget, { kind: "cloud" }> | undefined;
        if (d.location === "cloud") {
          const profile = await ctx.modules.call("persistence", "ssh.get", { id: String(a.profileId || "") });
          if (!profile || profile.transport === "wsl") throw new Error("Choose an SSH profile for the enrolled Cloud host.");
          ssh = sshFromProfile(profile);
          const target = await daemonTargetFor(ctx, d);
          if (target.kind !== "cloud") throw new Error("Invalid Cloud host route.");
          cloud = target;
        } else if (d.location !== "ssh") {
          throw new Error("Select an SSH or Cloud workspace.");
        }
        if (!ssh) throw new Error("Missing SSH profile.");
        const { connection } = await ctx.host.ssh.connect(sshProfileSpec(ssh), { interactive: true });
        const upgraded = await ctx.host.daemon.forceUpgrade({ kind: "ssh", connection }, cloud);
        lastError.delete(d.machineId);
        ctx.events.emit("remote-runtime.updated", { machineId: d.machineId, plugins: [] });
        return upgraded;
      } finally {
        ctx.events.emit("remote-runtime.changed", { machineId: d.machineId });
      }
    },
    async disable(ctx, a) {
      const { target } = await resolve(ctx, String(a.workspaceId));
      const r = await ctx.host.daemon.request(target, "plugins.disable", { id: String(a.id) });
      ctx.events.emit("remote-runtime.changed", {});
      return r;
    },
  },
};
export default mod;
