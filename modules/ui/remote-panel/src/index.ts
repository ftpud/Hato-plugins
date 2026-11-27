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
let upgrade: { workspaceId: string; profiles: { id: string; label: string }[]; profileId: string } | null = null;
/** The machine settings editor is open (gear button in the header). */
let showPolicy = false;

const IDLE_OPTIONS = [
  { value: "0", label: "Never" }, { value: "15", label: "After 15 minutes" }, { value: "60", label: "After 1 hour" },
  { value: "240", label: "After 4 hours" }, { value: "1440", label: "After 1 day" },
];
const ACCESS_OPTIONS = [
  { value: "all", label: "All enabled workspace plugins" },
  { value: "selected", label: "Only the plugins checked below" },
  { value: "none", label: "None" },
];

const OVERRIDE_OPTIONS = (on: boolean) => [
  { value: "default", label: `Use the default (${on ? "on" : "off"})` }, { value: "on", label: "On" }, { value: "off", label: "Off" },
];
const overrideValue = (v: boolean | null) => v === null || v === undefined ? "default" : v ? "on" : "off";
const CONCURRENT_OPTIONS = [{ value: "0", label: "No limit" }, ...[1, 2, 4, 8].map((n) => ({ value: String(n), label: `At most ${n}` }))];
const TURN_OPTIONS = [
  { value: "0", label: "No limit" }, { value: "15", label: "15 minutes" }, { value: "60", label: "1 hour" }, { value: "240", label: "4 hours" },
];
const APPROVAL_OPTIONS = [
  { value: "autopilot", label: "Any (autopilot allowed)" },
  { value: "auto-low", label: "Auto-approve low-risk tools at most" },
  { value: "ask", label: "Always ask" },
];
const TOOL_KINDS = [
  { id: "execute", label: "Run commands" }, { id: "edit", label: "Edit files" }, { id: "delete", label: "Delete files" },
  { id: "move", label: "Move or rename files" }, { id: "fetch", label: "Fetch from the web" },
];
const COUNT_OPTIONS = (noun: string) => [{ value: "0", label: "No limit" }, ...[1, 2, 4, 8, 16, 32].map((n) => ({ value: String(n), label: `At most ${n} ${noun}` }))];
const MEMORY_OPTIONS = [{ value: "0", label: "No limit" }, ...[512, 1024, 2048, 4096, 8192, 16384].map((mb) => ({ value: String(mb), label: mb < 1024 ? `${mb} MB` : `${mb / 1024} GB` }))];
/** Capabilities a machine can take away from every plugin running there. */
const BLOCKABLE = [
  { cap: "process.scope", label: "Start programs (persistent agents need this)" },
  { cap: "pty.scope", label: "Open terminals" },
  { cap: "net.fetch", label: "Web requests" },
  { cap: "net.websocket", label: "WebSocket connections" },
  { cap: "ssh.connect", label: "SSH connections to other machines" },
];

/** Limits the daemon enforces itself, on every plugin it runs, whoever sent it. */
function enforcedSection(): UiNode[] {
  const e = status.enforced;
  if (!e) return [];
  const heading: UiNode = { type: "label", key: "h-enforced", text: "Enforced by the daemon", weight: "semibold", size: "xs", color: "muted", style: { paddingY: 2 } };
  if (!e.policy) return [heading, { type: "status", key: "enforced-error", text: e.error || "Unavailable", level: "warn" }];
  const p = e.policy, denied: string[] = p.capabilityDeny || [];
  const select = (key: string, label: string, value: number, field: string, options: { value: string; label: string }[]): UiNode =>
    ({ type: "select", key, label, value: String(value || 0), action: `enforced:${field}`, options, disabled: !!busy });
  return [
    heading,
    { type: "label", key: "blocked-h", text: "Take away from every plugin", size: "xs", color: "muted" },
    ...BLOCKABLE.map((b): UiNode => ({ type: "toggle", key: `block:${b.cap}`, label: b.label, checked: denied.includes(b.cap) || denied.includes("*"), action: "enforcedBlock", disabled: !!busy || denied.includes("*") } as UiNode)),
    ...(denied.includes("*") ? [{ type: "status", key: "all-blocked", text: "Every capability is blocked (the daemon's saved limits could not be read). Save any change to replace them.", level: "warn" } as UiNode] : []),
    select("max-procs", "Programs started by plugins", p.maxProcesses, "maxProcesses", COUNT_OPTIONS("programs")),
    select("max-terms", "Terminals opened by plugins", p.maxTerminals, "maxTerminals", COUNT_OPTIONS("terminals")),
    select("memory", "Memory per program (with everything it starts on Windows)", p.processMemoryMb, "processMemoryMb", MEMORY_OPTIONS),
    { type: "column", key: "roots", gap: 3, children: [
      { type: "label", key: "l", text: "Folders plugins may use (absolute paths, comma-separated, empty = any)", size: "xs", color: "muted", wrap: true },
      { type: "textInput", key: "roots-input", value: (p.fsRoots || []).join(", "), placeholder: "any folder", submitAction: "enforcedRoots", disabled: !!busy },
    ] },
    ...(e.denials.length ? [
      { type: "label", key: "denials-h", text: "Recently refused", size: "xs", color: "muted" } as UiNode,
      ...e.denials.slice(0, 5).map((d: any, i: number): UiNode => ({ type: "label", key: `denial:${i}`, text: `${d.module}: ${d.reason}`, size: "xs", color: "warning", wrap: true, tooltip: `${d.op} · ${d.time}` })),
    ] : []),
    { type: "label", key: "enforced-note", text: "The daemon checks these on every request from its plugins, including ones already running, and keeps them across restarts. Programs those plugins start (such as an agent's own commands) run as your user: only the program count and memory limits apply to them.", size: "xs", color: "muted", wrap: true },
  ];
}

async function setEnforced(ctx: ModuleContext, change: Record<string, unknown>) {
  const workspaceId = ws?.id, current = status?.enforced?.policy;
  if (!workspaceId || !current) return;
  // "*" only appears when the daemon could not read its saved limits; any edit replaces that state.
  const next = { ...current, ...change, capabilityDeny: ((change.capabilityDeny as string[]) ?? current.capabilityDeny ?? []).filter((c: string) => c !== "*") };
  await run(ctx, "Saving daemon limits…", () => ctx.modules.call("remote-runtime", "setEnforcedPolicy", { workspaceId, policy: next }));
}

/** Not allowed by the machine's policy (mirrors remote-runtime, which actually refuses pushes). */
/** Read-only only counts while the machine is limited. */
const readOnly = () => !!(status?.policy?.limited && status.policy.readOnly);
const pluginAllowed = (id: string) => {
  const p = status?.policy;
  return !p || !p.limited || id === "persistence" || p.plugins === "all" || (p.plugins === "selected" && p.allowed.includes(id));
};

/** Machine settings: plugins, daemon behaviour, idle cleanup and agent limits. */
function policySection(): UiNode {
  const p = status.policy, a = p.agents, available: { id: string; name: string }[] = status.available || [];
  const defaults = status.defaults || { autoStart: true, autoPush: true };
  const muted = (key: string, text: string): UiNode => ({ type: "label", key, text, size: "xs", color: "muted", wrap: true });
  const heading = (key: string, text: string): UiNode => ({ type: "label", key, text, weight: "semibold", size: "xs", color: "muted", style: { paddingY: 2 } });
  const select = (key: string, label: string, value: string, action: string, options: { value: string; label: string }[]): UiNode =>
    ({ type: "select", key, label, value, action, options, disabled: !!busy });
  const list = (key: string, label: string, values: string[], placeholder: string): UiNode => ({ type: "column", key, gap: 3, children: [
    { type: "label", key: "l", text: label, size: "xs", color: "muted" },
    { type: "textInput", key: `${key}-input`, value: values.join(", "), placeholder, submitAction: "policyLists", disabled: !!busy },
  ] });
  return { type: "column", key: "policy", gap: 8, style: { background: "raised", borderColor: "border", borderWidth: 1, radius: 8, paddingX: 10, paddingY: 8 }, children: [
    { type: "row", key: "head", gap: 6, align: "center", children: [
      { type: "label", key: "title", text: "Settings for this machine", weight: "semibold", size: "sm", grow: true },
      { type: "button", key: "global", text: "Defaults…", action: "openGlobalSettings", small: true, variant: "ghost", tooltip: "Settings that apply to every machine" },
    ] },
    heading("h-daemon", "Daemon"),
    select("auto-start", "Start the daemon when a project here is opened", overrideValue(p.autoStart), "policyAutoStart", OVERRIDE_OPTIONS(defaults.autoStart)),
    select("auto-push", "Send workspace plugins automatically", overrideValue(p.autoPush), "policyAutoPush", OVERRIDE_OPTIONS(defaults.autoPush)),
    { type: "toggle", key: "unlimited", label: "Unlimited: allow everything on this machine", checked: !p.limited, action: "policyUnlimited", disabled: !!busy },
    ...(p.limited ? limitControls(p, a, available, heading, select, list, muted) : [muted("unlimited-note", "No limits apply here. Turn this off to choose what plugins and agents may do; your choices are kept when you turn it back on.")]),
  ] };
}

/** Everything "Unlimited" switches off: shown only while the machine is limited. */
function limitControls(p: any, a: any, available: { id: string; name: string }[], heading: (key: string, text: string) => UiNode,
  select: (key: string, label: string, value: string, action: string, options: { value: string; label: string }[]) => UiNode,
  list: (key: string, label: string, values: string[], placeholder: string) => UiNode, muted: (key: string, text: string) => UiNode): UiNode[] {
  return [
    { type: "toggle", key: "read-only", label: "Read-only: send nothing new to this machine", checked: p.readOnly, action: "policyReadOnly", disabled: !!busy },
    select("idle", "Stop detached terminals", String(p.idleTerminalMinutes), "policyIdle", IDLE_OPTIONS),
    heading("h-plugins", "Plugins"),
    select("access", "Plugins allowed to run here", p.plugins, "policyAccess", ACCESS_OPTIONS),
    ...(p.plugins === "selected" ? available.length
      ? available.map((a): UiNode => ({ type: "toggle", key: `allow:${a.id}`, label: a.name, checked: p.allowed.includes(a.id), action: "policyAllow", disabled: !!busy } as UiNode))
      : [muted("no-available", "No enabled plugins are meant to run on a workspace machine.")] : []),
    heading("h-agents", "Persistent agents"),
    select("max-agents", "Connected agents", String(a.maxConcurrent), "policyAgents:maxConcurrent", CONCURRENT_OPTIONS),
    select("max-turn", "Stop a turn after", String(a.maxTurnMinutes), "policyAgents:maxTurnMinutes", TURN_OPTIONS),
    select("approval-cap", "Automatic approval", a.approvalCap, "policyAgents:approvalCap", APPROVAL_OPTIONS),
    { type: "label", key: "deny-h", text: "Always refuse these tools", size: "xs", color: "muted" },
    ...TOOL_KINDS.map((k): UiNode => ({ type: "toggle", key: `deny:${k.id}`, label: k.label, checked: a.deniedToolKinds.includes(k.id), action: "policyDenyTool", disabled: !!busy } as UiNode)),
    list("providers", "Allowed providers (comma-separated ids, empty = any)", a.allowedProviders, "e.g. claude, codex"),
    list("models", "Allowed models (comma-separated ids, empty = any)", a.allowedModels, "any model"),
    muted("lists-hint", "Press Enter in a list to save it."),
    ...(status.limitsError ? [{ type: "status", key: "limits-error", text: status.limitsError, level: "warn" } as UiNode] : []),
    ...enforcedSection(),
    muted("note", "Plugin and daemon rules above are applied by this desktop. Idle terminals are stopped only while it is connected. Agent limits are applied by the agent runtime on the machine, for agents that connect after the change. Running plugins that are no longer allowed are listed below with a button to stop them."),
  ];
}

async function setPolicy(ctx: ModuleContext, change: Record<string, unknown>) {
  const workspaceId = ws?.id;
  if (!workspaceId || !status?.policy) return;
  const next = { ...status.policy, ...change };
  status = { ...status, policy: next }; // show the change at once; refresh confirms it
  await run(ctx, "Saving machine settings…", () => ctx.modules.call("remote-runtime", "setPolicy", { workspaceId, policy: next }));
}

async function refresh(ctx: ModuleContext) {
  if (!ws) { status = null; ctx.ui.invalidate(); return; }
  const workspaceId = ws.id;
  try {
    const next = await ctx.modules.call("remote-runtime", "status", { workspaceId }, { timeoutMs: 60000 });
    const forwards = await ctx.modules.call("remote-runtime", "tunnels", { workspaceId });
    if (ws?.id !== workspaceId) return;
    status = next; error = null; tunnels = forwards;
  } catch (e) {
    if (ws?.id !== workspaceId) return;
    error = errMsg(e);
  }
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
      if (changed) {
        status = null; confirmUpdate = false; upgrade = null; updateNote = null;
        void refresh(ctx);
      } else ctx.ui.invalidate();
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
        small: true, variant: confirmUpdate ? "danger" : "ghost", disabled: !!busy || readOnly(),
        tooltip: confirmUpdate ? "Replaces every daemon plugin now. Running background agents and workflow runs stop and must reconnect." : "Send this desktop's current build of all daemon plugins, even while they are busy" } as UiNode] : []),
      ...(status?.running && (status.location === "ssh" || status.location === "cloud" || status.location === "local") ? [{
        type: "button", key: "force-upgrade", text: "Force upgrade", action: "prepareUpgrade", small: true,
        disabled: !!busy, variant: status.stale ? "primary" : "ghost",
        tooltip: status.location === "local" ? "Restart this computer's daemon with this app's build after confirmation (stops what it holds)" : "Replace the native daemon over SSH and restart it after confirmation",
      } as UiNode] : []),
      ...(confirmUpdate ? [{ type: "button", key: "cancel-update", text: "Cancel", action: "cancelForceUpdate", small: true, variant: "ghost" } as UiNode] : []),
      ...(status?.policy ? [{ type: "button", key: "policy", text: "", iconSvg: uiIcons["sliders-horizontal"], action: "togglePolicy", small: true,
        variant: showPolicy ? "default" : "ghost", tooltip: "Settings for this machine: allowed plugins, read-only, idle terminals" } as UiNode] : []),
      { type: "button", key: "refresh", text: "", iconSvg: uiIcons.refresh, action: "refresh", small: true, variant: "ghost", tooltip: "Refresh" },
    ] });
    if (readOnly()) kids.push({ type: "status", key: "read-only", text: "Read-only: nothing new is sent to this machine.", level: "warn" });
    if (showPolicy && status?.policy) kids.push(policySection());
    if (updateNote) kids.push({ type: "status", key: "update-note", text: updateNote, level: "success" });
    if (busy) kids.push({ type: "progress", key: "busy", indeterminate: true, label: busy });
    if (error || status?.error) kids.push({ type: "status", key: "err", text: error || status.error, level: "error" });
    if (upgrade && upgrade.workspaceId === ws.id) kids.push({ type: "column", key: "upgrade-options", gap: 6, children: [
      { type: "label", key: "title", text: "SSH profile for this Cloud host", size: "sm", weight: "semibold" },
      ...(upgrade.profiles.length ? [{
        type: "select", key: "upgrade-profile", value: upgrade.profileId || null, action: "upgradeProfile",
        options: upgrade.profiles.map(p => ({ label: p.label, value: p.id })),
      } as UiNode] : [{ type: "label", key: "no-profile", text: "Add an SSH profile for the enrolled host first.", size: "xs", color: "muted", wrap: true } as UiNode]),
      { type: "row", key: "actions", gap: 6, children: [
        { type: "button", key: "cancel-upgrade", text: "Cancel", action: "cancelUpgrade", small: true, disabled: !!busy },
        { type: "button", key: "confirm-upgrade", text: "Continue", action: "forceUpgrade", small: true, variant: "primary", disabled: !!busy || !upgrade.profileId },
      ] },
    ] });
    if (!status) return { type: "column", key: "root", padding: 8, gap: 6, children: kids };
    if (!status.running) {
      kids.push({ type: "label", key: "off", text: "The Hato daemon is not running on this machine. Terminals and plugins stop when the connection drops.", size: "sm", color: "muted", wrap: true });
      kids.push({ type: "button", key: "start", text: "Start daemon", action: "ensure", variant: "primary", small: true, disabled: !!busy });
    }
    if (status.running) {
    kids.push({ type: "label", key: "ver", text: `daemon ${status.version} · pid ${status.pid}${status.stale ? " · older build" : ""}`, size: "xs", color: status.stale ? "warning" : "muted" });
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
    const policy = status.policy, allowed = pluginAllowed;
    const canSend = (id: string) => !readOnly() && allowed(id);
    const blockedRunning = remote.filter((p) => p.enabled && !allowed(p.id));
    if (blockedRunning.length) kids.push({ type: "row", key: "blocked-running", gap: 6, align: "center", children: [
      { type: "label", key: "t", text: `${blockedRunning.length} running plugin${blockedRunning.length === 1 ? " is" : "s are"} no longer allowed here.`, size: "xs", color: "warning", grow: true, wrap: true },
      { type: "button", key: "stop-blocked", text: "Stop them", action: "stopDisallowed", small: true, variant: "danger", disabled: !!busy },
    ] });
    for (const p of remote) kids.push(row(`rp:${p.id}`, p.id, `${p.enabled ? p.active || "loading" : "disabled"}${p.lastError && !p.active ? ` · ${p.lastError}` : ""}${allowed(p.id) ? "" : " · not allowed by this machine's settings"}`, [
      ...(p.enabled ? [{ type: "button", key: "dis", text: "Stop", action: "disable", value: p.id, small: true, disabled: !!busy, variant: allowed(p.id) ? "default" : "danger" } as UiNode] : []),
      { type: "button", key: "push", text: "Update", action: "push", value: p.id, small: true, disabled: !!busy || !canSend(p.id) },
    ]));
    for (const id of candidates.filter((id) => !remote.some((p) => p.id === id))) kids.push(row(`cp:${id}`, id, "enabled here, not on the server yet", [
      { type: "button", key: "push", text: "Send", action: "push", value: id, small: true, variant: "primary", disabled: !!busy || !canSend(id) },
    ]));
    for (const s of (status.skipped || []).filter((s: any) => !remote.some((p) => p.id === s.id))) kids.push(row(`sp:${s.id}`, s.id, s.reason, []));
    }
    if (status.location === "ssh") kids.push(forwardingSection());
    return { type: "column", key: "root", padding: 8, gap: 6, scroll: true, grow: true, children: kids };
  },
  async onEvent(ctx, ev) {
    const workspaceId = ws?.id;
    if (!workspaceId) return;
    const forceUpgrade = (profileId?: string) => run(ctx, "Upgrading native daemon…", async () => {
      const result = await ctx.modules.call("remote-runtime", "forceUpgrade", { workspaceId, profileId }, { timeoutMs: 620000 });
      if (ws?.id !== workspaceId) return;
      upgrade = null;
      updateNote = `Native daemon restarted (PID ${result.status.pid}).`;
    });
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
      case "togglePolicy": showPolicy = !showPolicy; ctx.ui.invalidate(); return;
      case "openGlobalSettings": ctx.events.emit("settings.open", { category: JSON.stringify(["remote-runtime", "remote"]) }); return;
      case "policyAccess": return setPolicy(ctx, { plugins: String(ev.value) });
      case "policyUnlimited": return setPolicy(ctx, { limited: ev.value !== true });
      case "policyReadOnly": return setPolicy(ctx, { readOnly: ev.value === true });
      case "policyIdle": return setPolicy(ctx, { idleTerminalMinutes: Number(ev.value) });
      case "policyAutoStart": case "policyAutoPush": {
        const v = ev.value === "on" ? true : ev.value === "off" ? false : null;
        return setPolicy(ctx, ev.action === "policyAutoStart" ? { autoStart: v } : { autoPush: v });
      }
      case "policyAgents:maxConcurrent": case "policyAgents:maxTurnMinutes": case "policyAgents:approvalCap": {
        const field = ev.action.slice("policyAgents:".length);
        return setPolicy(ctx, { agents: { ...status.policy.agents, [field]: field === "approvalCap" ? String(ev.value) : Number(ev.value) } });
      }
      case "policyDenyTool": {
        const kind = String(ev.key).replace(/^deny:/, ""), current: string[] = status?.policy?.agents?.deniedToolKinds || [];
        return setPolicy(ctx, { agents: { ...status.policy.agents, deniedToolKinds: ev.value === true ? [...new Set([...current, kind])] : current.filter((k) => k !== kind) } });
      }
      case "policyLists": {
        const ids = (text: string | undefined, fallback: string[]) => text === undefined ? fallback : text.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
        const agents = status.policy.agents;
        return setPolicy(ctx, { agents: { ...agents,
          allowedProviders: ids(ev.inputs?.["providers-input"], agents.allowedProviders),
          allowedModels: ids(ev.inputs?.["models-input"], agents.allowedModels) } });
      }
      case "enforced:maxProcesses": case "enforced:maxTerminals": case "enforced:processMemoryMb":
        return setEnforced(ctx, { [ev.action.slice("enforced:".length)]: Number(ev.value) });
      case "enforcedBlock": {
        const cap = String(ev.key).replace(/^block:/, ""), current: string[] = (status?.enforced?.policy?.capabilityDeny || []).filter((c: string) => c !== "*");
        return setEnforced(ctx, { capabilityDeny: ev.value === true ? [...new Set([...current, cap])] : current.filter((c) => c !== cap) });
      }
      case "enforcedRoots": {
        const text = ev.inputs?.["roots-input"];
        if (text === undefined) return;
        return setEnforced(ctx, { fsRoots: text.split(",").map((x) => x.trim()).filter(Boolean) });
      }
      case "stopDisallowed": return run(ctx, "Stopping plugins that are not allowed…", () => ctx.modules.call("remote-runtime", "stopDisallowed", { workspaceId }, { timeoutMs: 120000 }));
      case "policyAllow": {
        const id = String(ev.key).replace(/^allow:/, ""), current: string[] = status?.policy?.allowed || [];
        return setPolicy(ctx, { allowed: ev.value === true ? [...new Set([...current, id])] : current.filter((a) => a !== id) });
      }
      case "askForceUpdate": confirmUpdate = true; updateNote = null; ctx.ui.invalidate(); return;
      case "cancelForceUpdate": confirmUpdate = false; ctx.ui.invalidate(); return;
      case "prepareUpgrade": {
        if (busy) return;
        updateNote = null; confirmUpdate = false;
        if (ws.location === "ssh" || ws.location === "local") return forceUpgrade();
        if (ws.location !== "cloud") return;
        return run(ctx, "Loading SSH profiles…", async () => {
          const profiles = await ctx.modules.call("remote-runtime", "upgradeProfiles");
          if (ws?.id === workspaceId) upgrade = { workspaceId, profiles, profileId: profiles.length === 1 ? profiles[0].id : "" };
        });
      }
      case "upgradeProfile":
        if (upgrade && upgrade.workspaceId === workspaceId && upgrade.profiles.some(p => p.id === ev.value)) upgrade.profileId = String(ev.value);
        ctx.ui.invalidate(); return;
      case "cancelUpgrade": upgrade = null; ctx.ui.invalidate(); return;
      case "forceUpgrade":
        if (!busy && upgrade && upgrade.workspaceId === workspaceId && upgrade.profileId) return forceUpgrade(upgrade.profileId);
        return;
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
