// remote-panel: what the workspace machine's daemon is holding, with controls. All decisions are
// in the remote-runtime service; this module only renders its status.
import type { AppModule, ModuleContext, UiColor, UiNode, UiStyle } from "@hato/sdk/types";
import { errMsg } from "@hato/sdk/runtime";
import { uiIcons } from "@hato/sdk/ui-icons";

let ws: any = null;
let status: any = null;
let error: string | null = null;
let busy: string | null = null;
let timer: any = null;
let tunnels: any[] = [];
let localPort = "", remoteHost = "localhost", remotePort = "";
/** Force update asks for a second click: it replaces running plugins and stops what they hold. */
let confirmUpdate = false;
let updateNote: string | null = null;

async function refresh(ctx: ModuleContext) {
  if (!ws) { status = null; ctx.ui.invalidate(); return; }
  try { status = await ctx.modules.call("remote-runtime", "status", { workspaceId: ws.id }, { timeoutMs: 60000 }); error = null; tunnels = await ctx.modules.call("remote-runtime", "tunnels", { workspaceId: ws.id }); }
  catch (e) { error = errMsg(e); }
  ctx.ui.invalidate();
}

async function run(ctx: ModuleContext, label: string, fn: () => Promise<unknown>) {
  busy = label; error = null; ctx.ui.invalidate();
  let failure: string | null = null;
  try { await fn(); } catch (e) { failure = errMsg(e); }
  busy = null; await refresh(ctx);
  // refresh() clears status errors on success; keep the action's failure visible.
  if (failure) { error = failure; ctx.ui.invalidate(); }
}

const row = (key: string, label: string, detail: string, actions: UiNode[]): UiNode => ({ type: "row", key, gap: 6, align: "center", padding: 2, children: [
  { type: "column", key: "t", grow: true, gap: 0, children: [
    { type: "label", key: "l", text: label, size: "sm", mono: true },
    { type: "label", key: "d", text: detail, size: "xs", color: "muted" },
  ] },
  ...actions,
] });

// ---- port forwarding ----------------------------------------------------------------------------
const card: UiStyle = { background: "raised", borderColor: "border", borderWidth: 1, radius: 8, paddingX: 10, paddingY: 8 };
const chip = (key: string, text: string, color: UiColor, bg: UiColor): UiNode =>
  ({ type: "label", key, text, size: "xs", weight: "medium", color, style: { background: bg, radius: 9, paddingX: 7, paddingY: 1, noShrink: true } });
const iconBtn = (key: string, icon: string, tooltip: string, action: string, extra: Partial<UiNode & { value: any; copyText: string; iconColor: UiColor }> = {}): UiNode =>
  ({ type: "button", key, text: "", iconSvg: icon, iconSize: 14, action, small: true, variant: "ghost", tooltip, ...extra } as UiNode);
/** Common dev-server ports offered as one-click forwards. */
const PRESETS = [3000, 5000, 5173, 8000, 8080];

const portError = (s: string, optional: boolean): string | null => {
  const v = s.trim();
  if (!v) return optional ? null : "";
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? null : "Ports are whole numbers from 1 to 65535.";
};

function tunnelCard(t: any): UiNode {
  const url = `http://localhost:${t.localPort}`;
  const target = `${t.remoteHost}:${t.remotePort}`;
  return { type: "row", key: `tunnel:${t.id}`, gap: 8, align: "center", style: card, children: [
    { type: "label", key: "dot", text: "●", size: "xs", color: "success", tooltip: "Forwarding" },
    { type: "column", key: "addr", grow: true, gap: 1, children: [
      { type: "label", key: "local", text: `localhost:${t.localPort}`, size: "sm", weight: "medium", mono: true, selectable: true },
      { type: "label", key: "remote", text: t.remoteHost === "localhost" && t.localPort === t.remotePort ? "same port on server" : `server → ${target}`, size: "xs", color: "muted", mono: true },
    ] },
    iconBtn("copy", uiIcons.copy, `Copy ${url}`, "", { copyText: url }),
    iconBtn("stop", uiIcons.x, "Stop forwarding", "stopTunnel", { value: t.id, disabled: !!busy, iconColor: "danger" }),
  ] };
}

function forwardingSection(): UiNode {
  const remoteErr = portError(remotePort, false), localErr = portError(localPort, true);
  const fieldErr = remoteErr ?? localErr;
  const canSubmit = !busy && fieldErr === null;
  const taken = new Set(tunnels.map((t) => Number(t.localPort)));
  const presets = PRESETS.filter((p) => !taken.has(p));
  const field = (key: string, label: string, input: UiNode, width?: number): UiNode =>
    ({ type: "column", key, gap: 3, ...(width ? { width } : { grow: true }), children: [{ type: "label", key: "l", text: label, size: "xs", color: "muted" }, input] });
  const input = (key: string, value: string, placeholder: string): UiNode =>
    ({ type: "textInput", key, value, placeholder, changeAction: "tunnelInput", submitAction: "startTunnel", disabled: !!busy });
  return { type: "column", key: "forwarding", gap: 8, children: [
    { type: "divider", key: "sep" },
    { type: "row", key: "heading", align: "center", gap: 6, children: [
      { type: "label", key: "title", text: "Port forwarding", weight: "semibold", size: "sm", grow: true },
      ...(tunnels.length ? [chip("count", `${tunnels.length} active`, "success", "#2fa36b1f")] : []),
    ] },
    ...(tunnels.length ? tunnels.map(tunnelCard)
      : [{ type: "label", key: "empty", text: "Reach a service running on the server (a dev server, database, dashboard…) as if it were on this computer.", size: "xs", color: "muted", wrap: true } as UiNode]),
    // Stacked so it stays readable in a narrow sidebar: ports side by side, host full width,
    // wrapping quick picks, then a full-width submit.
    { type: "column", key: "form", gap: 8, style: { ...card, background: "panel" }, children: [
      { type: "row", key: "ports", gap: 6, children: [
        field("remote-port", "Server port", input("fwdRemotePort", remotePort, "e.g. 3000")),
        field("local-port", "Local port", input("fwdLocalPort", localPort, remotePort.trim() || "same")),
      ] },
      field("host", "Host on server", input("fwdHost", remoteHost, "localhost")),
      ...(fieldErr ? [{ type: "label", key: "err", text: fieldErr, size: "xs", color: "danger", wrap: true } as UiNode] : []),
      { type: "button", key: "start-tunnel", text: "Forward port", iconSvg: uiIcons.plus, action: "startTunnel", variant: "primary", small: true, disabled: !canSubmit, style: { fullWidth: true, justify: "center" } },
      ...(presets.length ? [{ type: "column", key: "quick", gap: 4, children: [
        { type: "label", key: "l", text: "Quick forward", size: "xs", color: "muted" },
        { type: "row", key: "chips", gap: 4, wrap: true, children: presets.map((p): UiNode => ({ type: "button", key: `preset:${p}`, text: String(p), action: "forwardPreset", value: p, small: true, disabled: !!busy, tooltip: `Forward localhost:${p} on the server`, style: { paddingX: 8, noShrink: true } })) },
      ] } as UiNode] : []),
    ] },
  ] };
}

async function startTunnel(ctx: ModuleContext, workspaceId: string, args: { localPort: string; remoteHost: string; remotePort: string }) {
  const remote = args.remotePort.trim();
  if (portError(remote, false) !== null || portError(args.localPort, true) !== null) return;
  const local = args.localPort.trim() || remote, host = args.remoteHost.trim() || "localhost";
  await run(ctx, `Forwarding localhost:${local}…`, async () => {
    await ctx.modules.call("remote-runtime", "startTunnel", { workspaceId, localPort: local, remoteHost: host, remotePort: remote });
    localPort = ""; remotePort = ""; remoteHost = "localhost";
  });
}

const mod: AppModule = {
  id: "remote-panel",
  moduleApiVersion: 1,
  async activate(ctx) {
    ws = ctx.state.get("workspace.selected") || null;
    ctx.state.watch("workspace.selected", (v: any) => {
      const changed = ws?.id !== v?.id; ws = v;
      if (changed) void refresh(ctx); else ctx.ui.invalidate();
    });
    ctx.events.on("remote-runtime.changed", () => { void refresh(ctx); });
    timer = setInterval(() => { if ((ctx.state.get("workspace-layout.panels") as any)?.remote) void refresh(ctx); }, 5000);
    await refresh(ctx);
  },
  deactivate() { if (timer) clearInterval(timer); },
  render(): UiNode {
    const kids: UiNode[] = [];
    if (!ws) return { type: "column", key: "root", padding: 8, children: [{ type: "label", key: "none", text: "Select a project or task.", color: "muted" }] };
    kids.push({ type: "row", key: "head", gap: 6, align: "center", children: [
      { type: "label", key: "machine", text: status ? `${status.machineId}` : ws.machineId, weight: "semibold", size: "sm", grow: true },
      ...(status?.running ? [{ type: "button", key: "force-update", text: confirmUpdate ? "Confirm update" : "Force update", action: confirmUpdate ? "forceUpdate" : "askForceUpdate",
        small: true, variant: confirmUpdate ? "danger" : "ghost", disabled: !!busy,
        tooltip: confirmUpdate ? "Replaces every daemon plugin now. Running background agents and workflow runs stop and must reconnect." : "Send this desktop's current build of all daemon plugins, even while they are busy" } as UiNode] : []),
      ...(confirmUpdate ? [{ type: "button", key: "cancel-update", text: "Cancel", action: "cancelForceUpdate", small: true, variant: "ghost" } as UiNode] : []),
      { type: "button", key: "refresh", text: "", iconSvg: uiIcons.refresh, action: "refresh", small: true, variant: "ghost", tooltip: "Refresh" },
    ] });
    if (updateNote) kids.push({ type: "status", key: "update-note", text: updateNote, level: "success" });
    if (busy) kids.push({ type: "progress", key: "busy", indeterminate: true, label: busy });
    if (error || status?.error) kids.push({ type: "status", key: "err", text: error || status.error, level: "error" });
    if (!status) return { type: "column", key: "root", padding: 8, gap: 6, children: kids };
    if (!status.running) {
      kids.push({ type: "label", key: "off", text: "The Hato daemon is not running on this machine. Terminals and plugins stop when the connection drops.", size: "sm", color: "muted", wrap: true });
      kids.push({ type: "button", key: "start", text: "Start daemon", action: "ensure", variant: "primary", small: true, disabled: !!busy });
    }
    if (status.running) {
    kids.push({ type: "label", key: "ver", text: `daemon ${status.version} · pid ${status.pid}${status.stale ? " · older build (restarts when idle)" : ""}`, size: "xs", color: status.stale ? "warning" : "muted" });
    const ptys: any[] = status.resources?.ptys || [], procs: any[] = status.resources?.procs || [];
    kids.push({ type: "label", key: "h-res", text: `Held on the server (${ptys.length + procs.length})`, weight: "semibold", size: "sm" });
    for (const p of ptys) kids.push(row(`pty:${p.key}`, p.key, `terminal · ${p.exit ? `exited (${p.exit})` : p.attached ? "attached" : "detached"} · ${p.cwd}`, [
      { type: "button", key: "kill", text: "Stop", action: "kill", value: { kind: "pty", key: p.key }, small: true, variant: "danger", disabled: !!busy },
    ]));
    for (const p of procs) kids.push(row(`proc:${p.key}`, p.key, `process ${p.pid} · ${p.exit ? "exited" : p.attached ? "attached" : `detached, ${p.bufferedBytes} bytes buffered`}`, [
      { type: "button", key: "kill", text: "Stop", action: "kill", value: { kind: "proc", key: p.key }, small: true, variant: "danger", disabled: !!busy },
    ]));
    const remote: any[] = status.plugins || [];
    const candidates: string[] = status.candidates || [];
    kids.push({ type: "label", key: "h-plg", text: "Plugins on the server", weight: "semibold", size: "sm" });
    if (!remote.length && !candidates.length) kids.push({ type: "label", key: "no-plg", text: "None. Plugins with runsOn: \"workspace\" are sent here when enabled.", size: "xs", color: "muted", wrap: true });
    for (const p of remote) kids.push(row(`rp:${p.id}`, p.id, `${p.enabled ? p.active || "loading" : "disabled"}${p.lastError && !p.active ? ` · ${p.lastError}` : ""}`, [
      ...(p.enabled ? [{ type: "button", key: "dis", text: "Stop", action: "disable", value: p.id, small: true, disabled: !!busy } as UiNode] : []),
      { type: "button", key: "push", text: "Update", action: "push", value: p.id, small: true, disabled: !!busy },
    ]));
    for (const id of candidates.filter((id) => !remote.some((p) => p.id === id))) kids.push(row(`cp:${id}`, id, "enabled here, not on the server yet", [
      { type: "button", key: "push", text: "Send", action: "push", value: id, small: true, variant: "primary", disabled: !!busy },
    ]));
    }
    if (status.location === "ssh") kids.push(forwardingSection());
    return { type: "column", key: "root", padding: 8, gap: 6, scroll: true, grow: true, children: kids };
  },
  async onEvent(ctx, ev) {
    const workspaceId = ws?.id;
    if (!workspaceId) return;
    switch (ev.action) {
      case "tunnelInput":
        if (ev.key === "fwdLocalPort") localPort = String(ev.value ?? ev.inputs?.fwdLocalPort ?? "");
        if (ev.key === "fwdHost") remoteHost = String(ev.value ?? ev.inputs?.fwdHost ?? "");
        if (ev.key === "fwdRemotePort") remotePort = String(ev.value ?? ev.inputs?.fwdRemotePort ?? "");
        ctx.ui.invalidate(); return;
      case "startTunnel":
        localPort = ev.inputs?.fwdLocalPort ?? localPort; remoteHost = ev.inputs?.fwdHost ?? remoteHost; remotePort = ev.inputs?.fwdRemotePort ?? remotePort;
        return startTunnel(ctx, workspaceId, { localPort, remoteHost, remotePort });
      case "forwardPreset": return startTunnel(ctx, workspaceId, { localPort: String(ev.value), remoteHost: "localhost", remotePort: String(ev.value) });
      case "stopTunnel": return run(ctx, "Stopping forward…", () => ctx.modules.call("remote-runtime", "stopTunnel", { workspaceId, id: ev.value }));
      case "refresh": return refresh(ctx);
      case "askForceUpdate": confirmUpdate = true; updateNote = null; ctx.ui.invalidate(); return;
      case "cancelForceUpdate": confirmUpdate = false; ctx.ui.invalidate(); return;
      case "forceUpdate": confirmUpdate = false; return run(ctx, "Updating daemon plugins…", async () => {
        const r: any = await ctx.modules.call("remote-runtime", "forceUpdate", { workspaceId }, { timeoutMs: 600000 });
        const reloaded = (r?.plugins || []).filter((p: any) => p.reloaded).map((p: any) => p.id);
        const failed = (r?.plugins || []).filter((p: any) => p.error);
        if (failed.length) throw new Error("Update failed for " + failed.map((p: any) => `${p.id} (${p.error})`).join(", "));
        updateNote = reloaded.length ? `Updated ${reloaded.join(", ")}. Reconnect background agents to continue.` : "Daemon plugins were already up to date.";
      });
      case "ensure": return run(ctx, "Starting daemon…", () => ctx.modules.call("remote-runtime", "ensure", { workspaceId }, { timeoutMs: 600000 }));
      case "kill": return run(ctx, "Stopping…", () => ctx.modules.call("remote-runtime", "kill", { workspaceId, ...(ev.value as any) }));
      case "push": return run(ctx, `Sending ${ev.value}…`, () => ctx.modules.call("remote-runtime", "push", { workspaceId, id: ev.value }, { timeoutMs: 120000 }));
      case "disable": return run(ctx, `Stopping ${ev.value}…`, () => ctx.modules.call("remote-runtime", "disable", { workspaceId, id: ev.value }));
    }
  },
};
export default mod;
