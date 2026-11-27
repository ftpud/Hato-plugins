// remote-runtime: policy for the workspace machine's daemon. The kernel only installs/starts the
// daemon and moves requests; this module decides when to start it, which plugins run there
// (manifest `runsOn: "workspace"`, pushed automatically when enabled), and exposes status and
// controls to UI plugins. Changes here hot reload like any module.
import type { AppModule, DaemonTarget, ModuleContext, PluginInfo } from "@hato/sdk/types";
import { daemonTargetFor, errMsg, sshFromProfile, sshProfileSpec, type WorkspaceDescriptor } from "@hato/sdk/runtime";
import { syncScope } from "@hato/sdk/scoped-settings";
import { exportSettings } from "@hato/sdk/settings";
import { PLATFORM_LABELS, pluginSupport, workspaceOs } from "@hato/sdk/platform";

let autoStart = true;
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

/** Locally enabled service plugins meant for the workspace machine, minus those that declare its
 *  OS unsupported (its daemon would refuse them). */
async function workspacePlugins(ctx: ModuleContext, d: WorkspaceDescriptor): Promise<PluginInfo[]> {
  const { plugins } = await ctx.host.plugins.list();
  const os = workspaceOs(ctx, d);
  return plugins.filter((p) => p.enabled && p.kind === "service" && p.runsOn === "workspace" && pluginSupport(p, os).status !== "unsupported");
}

/** Enabled workspace plugins left out on this machine, with the reason (shown in the remote panel). */
async function skippedPlugins(ctx: ModuleContext, d: WorkspaceDescriptor): Promise<{ id: string; reason: string }[]> {
  const { plugins } = await ctx.host.plugins.list();
  const os = workspaceOs(ctx, d);
  return plugins.filter((p) => p.enabled && p.kind === "service" && p.runsOn === "workspace").flatMap((p) => {
    const s = pluginSupport(p, os);
    return s.status === "unsupported" && os !== "posix" ? [{ id: p.id, reason: `not supported on ${PLATFORM_LABELS[os]}${s.note ? `: ${s.note}` : ""}` }] : [];
  });
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
    if (autoPush) for (const p of await workspacePlugins(ctx, d)) {
      try { await ctx.host.daemon.request(target, "plugins.push", { id: p.id }); pushed.push(p.id); }
      catch (e) { lastError.set(d.machineId, `${p.id}: ${errMsg(e)}`); }
    }
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
      if (!autoStart || ws?.location !== "ssh" || !ws.id || !ws.machineId) return;
      const machineId = String(ws.machineId);
      if (ensuredMachines.has(machineId)) return;
      ensuredMachines.add(machineId);
      ensure(ctx, String(ws.id)).catch((e) => { ensuredMachines.delete(machineId); ctx.log.warn("daemon", errMsg(e)); });
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
    // Newly enabled workspace plugins go to the current workspace machine right away.
    ctx.events.on("kernel.modules.changed", () => {
      const ws: any = ctx.state.get("workspace.selected");
      if (autoPush && ws?.location === "ssh" && ws.id) resolve(ctx, ws.id).then(async ({ d, target }) => {
        if (!(await ctx.host.daemon.status(target))) return;
        for (const p of await workspacePlugins(ctx, d)) await ctx.host.daemon.request(target, "plugins.push", { id: p.id }).catch(() => {});
      }).catch(() => {});
    });
  },
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
    async status(ctx, a) {
      const { d, target } = await resolve(ctx, String(a.workspaceId));
      const daemon = await ctx.host.daemon.status(target);
      const base = { machineId: d.machineId, location: d.location, error: lastError.get(d.machineId) || null, candidates: (await workspacePlugins(ctx, d)).map((p) => p.id), skipped: await skippedPlugins(ctx, d) };
      if (!daemon) { ensuredMachines.delete(d.machineId); return { ...base, running: false }; }
      try {
        const hello = await ctx.host.daemon.request(target, "hello");
        const stale = !!daemon.status?.stale || (d.location === "cloud" && !hello.features?.includes("fs"));
        return { ...base, running: true, version: hello.version, pid: hello.pid, stale, resources: hello.resources, plugins: hello.plugins };
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
      const remote: any[] = (await ctx.host.daemon.request<any>(target, "plugins.list"))?.plugins || [];
      const ids = [...new Set([
        ...(d.location === "ssh" ? ["persistence"] : []),
        ...remote.filter((p) => p.enabled !== false && local.some((l) => l.id === p.id)).map((p) => String(p.id)),
        ...(await workspacePlugins(ctx, d)).map((p) => p.id),
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
