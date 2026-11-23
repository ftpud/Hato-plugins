// cloud-panel: Hato Cloud sign-in, hosts, projects and host enrolment. Presentation only; the
// `cloud` service owns sign-in, inventory, enrolment, connections and workspace opening.
//
// Service contract used here (module "cloud"):
//   status() -> CloudStatus           inventory() -> { hosts, projects }
//   connections() -> Record<hostId, { state, error? }>
//   setServer({ url })  signIn()  cancelSignIn()  signOut()  refresh()  openWeb({ path })
//   openProject({ projectId })  addProject({ hostId, name, path })
//   sshProfiles() -> [{ id, label }]  addHostViaSsh({ profileId, name })
//   pendingEnrollment({ userCode })  approveEnrollment({ userCode })  denyEnrollment({ userCode })
//   event "cloud.changed" whenever any of the above changes.
import type { AppModule, ModuleContext, UiColor, UiNode, UiStyle } from "@hato/sdk/types";
import { errMsg } from "@hato/sdk/runtime";
import { uiIcons } from "@hato/sdk/ui-icons";

interface CloudStatus {
  server: string;
  signedIn: boolean;
  signingIn: boolean;
  user: { email: string; name: string } | null;
  device: { name: string; fingerprint: string } | null;
  /** Long-running setup step, e.g. SSH install, shown as progress. */
  task: { label: string; step?: string } | null;
  error: string | null;
}
interface Host { id: string; name: string; os: string; version: string; online: boolean; lastSeen: string | null; fingerprint: string }
interface Project { id: string; hostId: string; name: string; path: string }
type ConnState = "idle" | "connecting" | "connected" | "reconnecting" | "error";
interface Pending { userCode: string; name: string; os: string; version: string; fingerprint: string; expiresAt: string }

const SERVICE = "cloud";
const DEFAULT_SERVER = "https://cloud-dev.hatopad.dev";

let status: CloudStatus | null = null;
let hosts: Host[] = [];
let projects: Project[] = [];
let conns: Record<string, { state: ConnState; error?: string }> = {};
let error: string | null = null;
let busy: string | null = null;
let loaded = false;

// Local UI state
let editingServer = false;
let serverDraft = "";
let addMode: null | "ssh" | "code" = null;
let sshProfiles: { id: string; label: string }[] | null = null;
let sshProfile: string | null = null;
let sshName = "";
let codeDraft = "";
let pending: Pending | null = null;
let addProjectFor: string | null = null;
let projectPath = "";
let projectName = "";
let projectNameTouched = false;
const collapsed = new Set<string>();

async function refresh(ctx: ModuleContext) {
  try {
    status = await ctx.modules.call(SERVICE, "status", {});
    if (status?.signedIn) {
      const inv: any = await ctx.modules.call(SERVICE, "inventory", {});
      hosts = (inv?.hosts ?? []).slice().sort((a: Host, b: Host) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
      projects = (inv?.projects ?? []).slice().sort((a: Project, b: Project) => a.name.localeCompare(b.name));
      conns = (await ctx.modules.call(SERVICE, "connections", {})) ?? {};
    } else { hosts = []; projects = []; conns = {}; }
    error = null;
  } catch (e) { error = errMsg(e); }
  loaded = true;
  ctx.ui.invalidate();
}

async function run(ctx: ModuleContext, label: string, fn: () => Promise<unknown>) {
  busy = label; error = null; ctx.ui.invalidate();
  let failure: string | null = null;
  try { await fn(); } catch (e) { failure = errMsg(e); }
  busy = null;
  await refresh(ctx);
  if (failure) { error = failure; ctx.ui.invalidate(); }
}

// ---- presentation helpers -----------------------------------------------------------------------
const card: UiStyle = { background: "raised", borderColor: "border", borderWidth: 1, radius: 8, paddingX: 10, paddingY: 8 };
const softCard: UiStyle = { ...card, background: "panel" };
const label = (key: string, text: string, extra: Partial<UiNode> = {}): UiNode => ({ type: "label", key, text, size: "sm", wrap: true, ...extra } as UiNode);
const muted = (key: string, text: string): UiNode => ({ type: "label", key, text, size: "xs", color: "muted", wrap: true });
const heading = (key: string, text: string, trailing: UiNode[] = []): UiNode =>
  ({ type: "row", key, align: "center", gap: 6, children: [{ type: "label", key: "t", text, size: "xs", weight: "semibold", color: "muted", grow: true }, ...trailing] });
const chip = (key: string, text: string, color: UiColor): UiNode =>
  ({ type: "label", key, text, size: "xs", weight: "medium", color, style: { borderColor: color, borderWidth: 1, radius: 9, paddingX: 7, paddingY: 0, noShrink: true } });
const iconBtn = (key: string, icon: string, tooltip: string, action: string, extra: Record<string, unknown> = {}): UiNode =>
  ({ type: "button", key, text: "", iconSvg: icon, iconSize: 14, action, small: true, variant: "ghost", tooltip, disabled: !!busy, ...extra } as UiNode);
const primary = (key: string, text: string, action: string, extra: Record<string, unknown> = {}): UiNode =>
  ({ type: "button", key, text, action, variant: "primary", small: true, disabled: !!busy, style: { fullWidth: true, justify: "center" }, ...extra } as UiNode);
const field = (key: string, text: string, input: UiNode): UiNode =>
  ({ type: "column", key, gap: 3, children: [{ type: "label", key: "l", text, size: "xs", color: "muted" }, input] });

const OS: Record<string, string> = { linux: "Linux", macos: "macOS", windows: "Windows", freebsd: "FreeBSD", openbsd: "OpenBSD", netbsd: "NetBSD", dragonfly: "DragonFly", other: "Other" };
/** "https://cloud-dev.hatopad.dev/" -> "cloud-dev.hatopad.dev" (no URL global in the module runtime). */
const host = (s: string) => s.replace(/^[a-z]+:\/\//i, "").replace(/\/.*$/, "");
const groups = (fp: string) => (fp.match(/.{1,4}/g) ?? []).join(" ");

function ago(iso: string | null) {
  if (!iso) return "never";
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s)) return "unknown";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

function connChip(hostId: string): UiNode | null {
  const c = conns[hostId];
  if (!c || c.state === "idle") return null;
  const map: Record<ConnState, [string, UiColor]> = {
    idle: ["", "muted"], connecting: ["Connecting", "warning"], connected: ["Connected", "success"],
    reconnecting: ["Reconnecting", "warning"], error: ["Error", "danger"],
  };
  const [text, color] = map[c.state];
  return { ...chip("conn", text, color), tooltip: c.error ?? text } as UiNode;
}

// ---- sections -----------------------------------------------------------------------------------
function signedOut(): UiNode[] {
  const s = status!;
  const kids: UiNode[] = [
    { type: "column", key: "hero", gap: 6, style: { ...softCard, paddingY: 14 }, children: [
      { type: "row", key: "t", gap: 8, align: "center", children: [
        { type: "button", key: "ico", text: "", iconSvg: uiIcons.cloud, iconSize: 18, action: "noop", variant: "ghost", small: true, iconColor: "accent" } as UiNode,
        { type: "label", key: "title", text: "Hato Cloud", weight: "semibold", size: "md" },
      ] },
      muted("lead", "Work on machines behind a firewall, and follow your agents from your phone. Hosts only make outgoing connections; traffic is end-to-end encrypted between this computer and the host."),
    ] },
  ];
  if (s.signingIn) {
    kids.push({ type: "progress", key: "signing", indeterminate: true, label: "Finish signing in in your browser…" });
    kids.push({ type: "button", key: "cancel", text: "Cancel", action: "cancelSignIn", small: true, variant: "ghost", style: { fullWidth: true, justify: "center" } } as UiNode);
    return kids;
  }
  kids.push(primary("signin", "Sign in with Google", "signIn", { iconSvg: uiIcons.external, tooltip: "Opens your browser" }));
  if (editingServer) {
    kids.push({ type: "column", key: "server-edit", gap: 6, style: softCard, children: [
      field("server", "Server", { type: "textInput", key: "serverInput", value: serverDraft, placeholder: DEFAULT_SERVER, changeAction: "serverInput", submitAction: "saveServer", cancelAction: "cancelServer", autoFocus: true }),
      { type: "row", key: "a", gap: 6, children: [
        { type: "button", key: "save", text: "Save", action: "saveServer", small: true, variant: "primary" } as UiNode,
        { type: "button", key: "cancel", text: "Cancel", action: "cancelServer", small: true, variant: "ghost" } as UiNode,
      ] },
    ] });
  } else {
    kids.push({ type: "row", key: "server", gap: 4, align: "center", children: [
      muted("s", `Server: ${host(s.server)}`),
      { type: "spacer", key: "sp" },
      { type: "button", key: "chg", text: "Change", action: "editServer", small: true, variant: "ghost" } as UiNode,
    ] });
  }
  kids.push(muted("invite", "Invite-only. Use the Google account your invitation was sent to."));
  return kids;
}

function accountRow(): UiNode {
  const s = status!;
  return { type: "row", key: "account", gap: 4, align: "center", children: [
    { type: "column", key: "who", grow: true, gap: 0, children: [
      { type: "label", key: "email", text: s.user?.email ?? "Signed in", size: "sm", weight: "medium" },
      muted("srv", host(s.server)),
    ] },
    iconBtn("web", uiIcons.globe, "Open Hato Cloud in the browser", "openWeb", { value: "/" }),
    iconBtn("refresh", uiIcons.refresh, "Refresh", "refresh"),
    iconBtn("signout", uiIcons["log-out"], "Sign out of Hato Cloud on this computer", "signOut"),
  ] };
}

function projectRow(p: Project, h: Host): UiNode {
  return { type: "row", key: `p:${p.id}`, gap: 6, align: "center", padding: 2, children: [
    { type: "column", key: "t", grow: true, gap: 0, children: [
      { type: "label", key: "n", text: p.name, size: "sm" },
      { type: "label", key: "path", text: p.path, size: "xs", color: "muted", mono: true },
    ] },
    { type: "button", key: "open", text: "Open", action: "openProject", value: p.id, small: true,
      disabled: !!busy || !h.online, tooltip: h.online ? `Open ${p.name} on ${h.name} through Hato Cloud` : `${h.name} is offline` } as UiNode,
  ] };
}

function addProjectForm(h: Host): UiNode {
  const pathOk = projectPath.trim().startsWith("/") && !projectPath.split("/").some((x) => x === ".." || x === ".");
  return { type: "column", key: "add-project", gap: 6, style: softCard, children: [
    field("path", "Folder on the host", { type: "textInput", key: "projectPath", value: projectPath, placeholder: "/home/you/code/app", changeAction: "projectInput", submitAction: "saveProject", cancelAction: "cancelProject", autoFocus: true }),
    field("name", "Name", { type: "textInput", key: "projectName", value: projectName, placeholder: "app", changeAction: "projectInput", submitAction: "saveProject", cancelAction: "cancelProject" }),
    ...(projectPath.trim() && !pathOk ? [{ type: "label", key: "err", text: "Use an absolute path, like /home/you/code/app.", size: "xs", color: "danger", wrap: true } as UiNode] : []),
    { type: "row", key: "a", gap: 6, children: [
      { type: "button", key: "save", text: "Add project", action: "saveProject", value: h.id, small: true, variant: "primary", disabled: !!busy || !pathOk || !projectName.trim() } as UiNode,
      { type: "button", key: "cancel", text: "Cancel", action: "cancelProject", small: true, variant: "ghost" } as UiNode,
    ] },
  ] };
}

function hostCard(h: Host): UiNode {
  const mine = projects.filter((p) => p.hostId === h.id);
  const open = !collapsed.has(h.id);
  const sub = [h.online ? "Online" : `Last seen ${ago(h.lastSeen)}`, OS[h.os] ?? h.os, `v${h.version}`].join(" · ");
  const conn = connChip(h.id);
  const kids: UiNode[] = [
    { type: "row", key: "head", gap: 6, align: "center", children: [
      { type: "label", key: "dot", text: "●", size: "xs", color: h.online ? "success" : "muted", tooltip: h.online ? "Online" : "Offline" },
      { type: "column", key: "t", grow: true, gap: 0, children: [
        { type: "label", key: "n", text: h.name, size: "sm", weight: "semibold" },
        muted("s", sub),
      ] },
      ...(conn ? [conn] : []),
      iconBtn("toggle", open ? uiIcons.collapse : uiIcons.folder, open ? "Hide projects" : `Show projects (${mine.length})`, "toggleHost", { value: h.id }),
    ] },
  ];
  const c = conns[h.id];
  if (c?.state === "error" && c.error) kids.push({ type: "status", key: "conn-err", text: c.error, level: "error" });
  if (open) {
    if (mine.length) kids.push({ type: "column", key: "projects", gap: 2, children: mine.map((p) => projectRow(p, h)) });
    else if (addProjectFor !== h.id) kids.push(muted("none", "No projects yet. Add a folder on this machine to open it here."));
    if (addProjectFor === h.id) kids.push(addProjectForm(h));
    else kids.push({ type: "button", key: "add", text: "Add project", iconSvg: uiIcons.plus, action: "addProject", value: h.id, small: true, variant: "ghost", disabled: !!busy } as UiNode);
  }
  return { type: "column", key: `h:${h.id}`, gap: 6, style: card, children: kids };
}

function addHostSection(): UiNode {
  const kids: UiNode[] = [heading("h", "ADD A HOST")];
  if (addMode === null) {
    kids.push({ type: "row", key: "modes", gap: 6, children: [
      { type: "button", key: "ssh", text: "Via SSH", iconSvg: uiIcons.terminal, action: "addMode", value: "ssh", small: true, disabled: !!busy, tooltip: "Install Hato on a machine you reach over SSH and connect it", style: { justify: "center" } } as UiNode,
      { type: "button", key: "code", text: "Enter code", iconSvg: uiIcons.key, action: "addMode", value: "code", small: true, disabled: !!busy, tooltip: "Approve a machine that ran `hato cloud enroll`", style: { justify: "center" } } as UiNode,
    ] });
    return { type: "column", key: "add-host", gap: 6, children: kids };
  }
  if (addMode === "ssh") {
    const options = (sshProfiles ?? []).map((p) => ({ value: p.id, label: p.label }));
    kids.push({ type: "column", key: "ssh", gap: 8, style: softCard, children: [
      label("t", "Install and connect over SSH", { weight: "semibold" }),
      muted("d", "Hato installs its daemon on the machine and connects it to your cloud. After that, it works even without SSH access."),
      sshProfiles === null
        ? { type: "progress", key: "loading", indeterminate: true, label: "Loading SSH profiles…" }
        : options.length
          ? field("profile", "SSH profile", { type: "select", key: "profile", options, value: sshProfile, action: "sshProfile", placeholder: "Choose a profile" })
          : muted("noprof", "No SSH profiles yet. Add an SSH project first, then come back."),
      field("name", "Name in Hato Cloud", { type: "textInput", key: "sshName", value: sshName, placeholder: "build-box", changeAction: "sshName", submitAction: "addViaSsh" }),
      { type: "row", key: "a", gap: 6, children: [
        { type: "button", key: "go", text: "Install and connect", action: "addViaSsh", small: true, variant: "primary", disabled: !!busy || !sshProfile || !sshName.trim() } as UiNode,
        { type: "button", key: "cancel", text: "Cancel", action: "addMode", value: null, small: true, variant: "ghost" } as UiNode,
      ] },
    ] });
  }
  if (addMode === "code") {
    if (!pending) {
      kids.push({ type: "column", key: "code", gap: 8, style: softCard, children: [
        label("t", "Approve a machine", { weight: "semibold" }),
        muted("d", "On the machine, run `hato cloud enroll`. Enter the code it prints."),
        { type: "textInput", key: "codeInput", value: codeDraft, placeholder: "ABCD-EFGH", changeAction: "codeInput", submitAction: "lookupCode", cancelAction: "cancelCode", autoFocus: true },
        { type: "row", key: "a", gap: 6, children: [
          { type: "button", key: "go", text: "Continue", action: "lookupCode", small: true, variant: "primary", disabled: !!busy || normaliseCode(codeDraft) === null } as UiNode,
          { type: "button", key: "cancel", text: "Cancel", action: "cancelCode", small: true, variant: "ghost" } as UiNode,
        ] },
      ] });
    } else {
      kids.push({ type: "column", key: "pending", gap: 8, style: softCard, children: [
        label("t", "Approve this host?", { weight: "semibold" }),
        muted("d", "Check that this code matches the one on the machine’s screen."),
        { type: "label", key: "code", text: pending.userCode, size: "lg", weight: "bold", mono: true, selectable: true, style: { justify: "center", paddingY: 6, background: "panel", radius: 6 } } as UiNode,
        { type: "column", key: "facts", gap: 2, children: [
          label("n", pending.name, { weight: "medium" }),
          muted("o", `${OS[pending.os] ?? pending.os} · Hato ${pending.version}`),
          { type: "label", key: "fp", text: groups(pending.fingerprint), size: "xs", mono: true, color: "muted", wrap: true, selectable: true, tooltip: "Host key fingerprint" } as UiNode,
        ] },
        { type: "status", key: "warn", level: "warn", text: "Only approve a machine you just set up. Approving lets Hato run agents, commands and terminals there as the user running Hato." },
        { type: "column", key: "a", gap: 6, children: [
          { type: "button", key: "approve", text: "Approve", iconSvg: uiIcons.check, action: "approveCode", small: true, variant: "primary", disabled: !!busy, style: { fullWidth: true, justify: "center" } } as UiNode,
          { type: "button", key: "deny", text: "Deny", iconSvg: uiIcons.x, action: "denyCode", small: true, disabled: !!busy, style: { fullWidth: true, justify: "center" } } as UiNode,
        ] },
      ] });
    }
  }
  return { type: "column", key: "add-host", gap: 6, children: kids };
}

function normaliseCode(value: string) {
  const c = value.toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (c.length !== 8) return null;
  const code = `${c.slice(0, 4)}-${c.slice(4)}`;
  return /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/.test(code) ? code : null;
}

function signedIn(): UiNode[] {
  const kids: UiNode[] = [accountRow(), { type: "divider", key: "d1" }];
  // An in-progress "add host" flow is the user's focus: show it first, not below a long list.
  if (addMode !== null) kids.push(addHostSection(), { type: "divider", key: "d0" });
  const online = hosts.filter((h) => h.online).length;
  kids.push(heading("hosts-h", hosts.length ? `HOSTS · ${online}/${hosts.length} ONLINE` : "HOSTS"));
  if (!hosts.length) {
    kids.push({ type: "column", key: "empty", gap: 4, style: softCard, children: [
      label("t", "No hosts yet", { weight: "semibold" }),
      muted("d", "Add a machine over SSH, or approve the code a firewalled machine shows after running `hato cloud enroll`."),
    ] });
  } else {
    for (const h of hosts) kids.push(hostCard(h));
    kids.push(muted("scope", "Over Cloud: agents, workflows and terminals. File browsing and Git are coming next."));
  }
  if (addMode === null) kids.push({ type: "divider", key: "d2" }, addHostSection());
  return kids;
}

// ---- module -------------------------------------------------------------------------------------
const mod: AppModule = {
  id: "cloud-panel",
  moduleApiVersion: 1,
  async activate(ctx) {
    ctx.events.on("cloud.changed", () => { void refresh(ctx); });
    await refresh(ctx);
  },
  render(): UiNode {
    const kids: UiNode[] = [];
    if (!loaded || !status) {
      kids.push(error ? { type: "status", key: "err", text: error, level: "error" } : { type: "progress", key: "loading", indeterminate: true, label: "Loading…" });
      return { type: "column", key: "root", padding: 8, gap: 8, children: kids };
    }
    if (busy) kids.push({ type: "progress", key: "busy", indeterminate: true, label: busy });
    if (status.task) kids.push({ type: "progress", key: "task", indeterminate: true, label: status.task.step ? `${status.task.label} — ${status.task.step}` : status.task.label });
    if (error || status.error) kids.push({ type: "status", key: "err", text: (error || status.error)!, level: "error" });
    kids.push(...(status.signedIn ? signedIn() : signedOut()));
    return { type: "column", key: "root", padding: 8, gap: 8, scroll: true, grow: true, children: kids };
  },
  async onEvent(ctx, ev) {
    const inputs: Record<string, any> = (ev as any).inputs ?? {};
    switch (ev.action) {
      case "noop": return;
      case "refresh": return run(ctx, "Refreshing…", () => ctx.modules.call(SERVICE, "refresh", {}));
      case "signIn": error = null; return run(ctx, "Opening your browser…", () => ctx.modules.call(SERVICE, "signIn", {}, { timeoutMs: 600000 }));
      case "cancelSignIn": return run(ctx, "Cancelling…", () => ctx.modules.call(SERVICE, "cancelSignIn", {}));
      case "signOut": return run(ctx, "Signing out…", () => ctx.modules.call(SERVICE, "signOut", {}));
      case "openWeb": return run(ctx, "Opening browser…", () => ctx.modules.call(SERVICE, "openWeb", { path: String(ev.value ?? "/") }));
      case "editServer": editingServer = true; serverDraft = status?.server ?? DEFAULT_SERVER; ctx.ui.invalidate(); return;
      case "serverInput": serverDraft = String(ev.value ?? inputs.serverInput ?? ""); return;
      case "cancelServer": editingServer = false; ctx.ui.invalidate(); return;
      case "saveServer": {
        const url = String(inputs.serverInput ?? serverDraft).trim() || DEFAULT_SERVER;
        editingServer = false;
        return run(ctx, "Saving…", () => ctx.modules.call(SERVICE, "setServer", { url }));
      }
      case "toggleHost": {
        const id = String(ev.value);
        if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
        ctx.ui.invalidate(); return;
      }
      case "openProject": return run(ctx, "Connecting through Hato Cloud…", () => ctx.modules.call(SERVICE, "openProject", { projectId: String(ev.value) }, { timeoutMs: 120000 }));
      case "addProject": addProjectFor = String(ev.value); projectPath = ""; projectName = ""; projectNameTouched = false; ctx.ui.invalidate(); return;
      case "cancelProject": addProjectFor = null; ctx.ui.invalidate(); return;
      case "projectInput": {
        if (ev.key === "projectPath") {
          projectPath = String(ev.value ?? inputs.projectPath ?? "");
          if (!projectNameTouched) projectName = projectPath.replace(/\/+$/, "").split("/").pop() ?? "";
        }
        if (ev.key === "projectName") { projectName = String(ev.value ?? inputs.projectName ?? ""); projectNameTouched = true; }
        ctx.ui.invalidate(); return;
      }
      case "saveProject": {
        const hostId = addProjectFor;
        if (!hostId) return;
        const path = String(inputs.projectPath ?? projectPath).trim().replace(/(.)\/+$/, "$1");
        const name = String(inputs.projectName ?? projectName).trim();
        if (!path.startsWith("/") || !name) return;
        return run(ctx, "Adding project…", async () => {
          await ctx.modules.call(SERVICE, "addProject", { hostId, name, path });
          addProjectFor = null;
        });
      }
      case "addMode": {
        addMode = (ev.value as any) ?? null;
        pending = null; codeDraft = "";
        if (addMode === "ssh") {
          sshProfiles = null; sshProfile = null; sshName = "";
          ctx.ui.invalidate();
          try { sshProfiles = (await ctx.modules.call(SERVICE, "sshProfiles", {})) ?? []; sshProfile = sshProfiles?.[0]?.id ?? null; sshName = sshProfiles?.[0]?.label?.split(/[@:\s]/).pop() ?? ""; }
          catch (e) { sshProfiles = []; error = errMsg(e); }
        }
        ctx.ui.invalidate(); return;
      }
      case "sshProfile": sshProfile = String(ev.value); { const p = sshProfiles?.find((x) => x.id === sshProfile); if (p && !sshName.trim()) sshName = p.label; } ctx.ui.invalidate(); return;
      case "sshName": sshName = String(ev.value ?? inputs.sshName ?? ""); ctx.ui.invalidate(); return;
      case "addViaSsh": {
        const name = String(inputs.sshName ?? sshName).trim();
        if (!sshProfile || !name) return;
        return run(ctx, `Installing Hato on ${name}…`, async () => {
          await ctx.modules.call(SERVICE, "addHostViaSsh", { profileId: sshProfile, name }, { timeoutMs: 900000 });
          addMode = null;
        });
      }
      case "codeInput": codeDraft = String(ev.value ?? inputs.codeInput ?? "").toUpperCase(); ctx.ui.invalidate(); return;
      case "cancelCode": addMode = null; pending = null; codeDraft = ""; ctx.ui.invalidate(); return;
      case "lookupCode": {
        const code = normaliseCode(String(inputs.codeInput ?? codeDraft));
        if (!code) { error = "Codes look like ABCD-EFGH."; ctx.ui.invalidate(); return; }
        return run(ctx, "Checking code…", async () => { pending = await ctx.modules.call(SERVICE, "pendingEnrollment", { userCode: code }); });
      }
      case "approveCode": {
        const code = pending?.userCode; if (!code) return;
        return run(ctx, "Approving…", async () => { await ctx.modules.call(SERVICE, "approveEnrollment", { userCode: code }); pending = null; addMode = null; codeDraft = ""; });
      }
      case "denyCode": {
        const code = pending?.userCode; if (!code) return;
        return run(ctx, "Denying…", async () => { await ctx.modules.call(SERVICE, "denyEnrollment", { userCode: code }); pending = null; addMode = null; codeDraft = ""; });
      }
    }
  },
};
export default mod;
