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

// ../sdk/runtime.ts
function errMsg(e) {
  return e && (e.message || String(e)) || "unknown error";
}

// ../sdk/ui-icons.ts
var outline = (paths, width = 1.8) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
var uiIcons = {
  send: outline("<path d='m22 2-7 20-4-9-9-4Z'/><path d='M22 2 11 13'/>"),
  paperclip: outline("<path d='m21 11-9 9a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8l8.5-8.5'/>"),
  "sliders-horizontal": outline("<path d='M3 6h3m4 0h11M3 18h11m4 0h3'/><circle cx='8' cy='6' r='2'/><circle cx='16' cy='18' r='2'/>"),
  "message-square": outline("<path d='M21 15a2 2 0 0 1-2 2H7l-5 5V4a2 2 0 0 1 2-2h15a2 2 0 0 1 2 2Z'/>"),
  "graduation-cap": outline("<path d='m2 8 10-5 10 5-10 5Zm4 2v7q6 5 12 0v-7M22 8v8'/>"),
  pencil: outline("<path d='M21.2 6.8a2.8 2.8 0 0 0-4-4L3.8 16.2 3 21l4.8-.8Z'/><path d='m15 5 4 4'/>"),
  eraser: outline("<path d='m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L11 21'/><path d='M22 21H7'/><path d='m5 11 9 9'/>"),
  trash: outline("<path d='M3 6h18'/><path d='M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6'/><path d='M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'/><path d='M10 11v6M14 11v6'/>"),
  copy: outline("<rect x='8' y='8' width='13' height='13' rx='2'/><path d='M16 5V3H3v13h2'/>"),
  warning: outline("<path d='m12 3 10 18H2Z'/><path d='M12 9v5m0 3h.01'/>"),
  terminal: outline("<rect x='3' y='4' width='18' height='16' rx='2'/><path d='m7 9 3 3-3 3m6 0h4'/>"),
  "git-branch": outline("<circle cx='6' cy='3' r='2'/><circle cx='6' cy='20' r='2'/><circle cx='18' cy='6' r='2'/><path d='M6 5v13M18 8c0 7-12 4-12 10'/>"),
  files: outline("<path d='M14 2H6v16h14V8Z'/><path d='M14 2v6h6M3 6v16h13'/>"),
  folder: outline("<path d='M3 5h6l2 2h10v13H3Z'/>"),
  refresh: outline("<path d='M20 7a8 8 0 1 0 0 10M20 3v5h-5'/>"),
  collapse: outline("<path d='m8 8 4-4 4 4M8 16l4 4 4-4M4 12h16'/>"),
  locate: outline("<circle cx='12' cy='12' r='7'/><circle cx='12' cy='12' r='2'/><path d='M12 2v3m0 14v3M2 12h3m14 0h3'/>"),
  search: outline("<circle cx='10' cy='10' r='7'/><path d='m15 15 6 6'/>"),
  x: outline("<path d='m6 6 12 12M6 18 18 6'/>"),
  plus: outline("<path d='M12 4v16M4 12h16'/>"),
  remote: outline("<rect x='3' y='4' width='18' height='12' rx='2'/><path d='M8 20h8M12 16v4'/>"),
  cloud: outline("<path d='M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z'/>"),
  "cloud-off": outline("<path d='m2 2 20 20M5.78 5.78A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.31-.2M21.53 16.05A4.5 4.5 0 0 0 17.5 10h-1.79A7 7 0 0 0 10.2 5.1'/>"),
  "shield-alert": outline("<path d='M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1Z'/><path d='M12 8v4M12 16h.01'/>"),
  plug: outline("<path d='M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0V7ZM12 17v5'/>"),
  "text-search": outline("<path d='M4 6h16M4 12h7M4 18h6'/><circle cx='17' cy='15' r='3'/><path d='m19.2 17.2 2.3 2.3'/>"),
  eye: outline("<path d='M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z'/><circle cx='12' cy='12' r='3'/>"),
  "eye-off": outline("<path d='M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3 3.8M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18'/>"),
  globe: outline("<circle cx='12' cy='12' r='9'/><path d='M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18'/>"),
  "cloud-lock": outline("<path d='M17.5 17H18a4 4 0 0 0 .5-8A6 6 0 0 0 7 7.5 4.5 4.5 0 0 0 6.5 17'/><rect x='9' y='14' width='6' height='6' rx='1'/><path d='M10.5 14v-1.5a1.5 1.5 0 0 1 3 0V14'/>"),
  lock: outline("<rect x='4' y='11' width='16' height='10' rx='2'/><path d='M8 11V7a4 4 0 0 1 8 0v4'/>"),
  key: outline("<circle cx='8' cy='15' r='4'/><path d='m10.8 12.2 8.7-8.7M17 6l3 3M14.5 8.5l2 2'/>"),
  check: outline("<path d='m5 12 5 5 9-11'/>"),
  "log-out": outline("<path d='M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9'/>"),
  external: outline("<path d='M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'/>"),
  sparkles: outline("<path d='M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z'/><path d='M19 16v4M17 18h4'/>"),
  import: outline("<path d='M12 3v12M7 10l5 5 5-5M5 21h14'/>"),
  task: outline("<circle cx='6' cy='3' r='2'/><circle cx='6' cy='20' r='2'/><circle cx='18' cy='6' r='2'/><path d='M6 5v13M18 8c0 7-12 4-12 10'/>")
};

// modules/ui/cloud-panel/src/index.ts
var SERVICE = "cloud";
var DEFAULT_SERVER = "https://cloud-dev.hatopad.dev";
var status = null;
var hosts = [];
var projects = [];
var conns = {};
var error = null;
var busy = null;
var loaded = false;
var editingServer = false;
var serverDraft = "";
var addMode = null;
var sshProfiles = null;
var sshProfile = null;
var sshName = "";
var codeDraft = "";
var pending = null;
var addProjectFor = null;
var projectPath = "";
var projectName = "";
var projectNameTouched = false;
var collapsed = /* @__PURE__ */ new Set();
async function refresh(ctx) {
  try {
    status = await ctx.modules.call(SERVICE, "status", {});
    if (status?.signedIn) {
      const inv = await ctx.modules.call(SERVICE, "inventory", {});
      hosts = (inv?.hosts ?? []).slice().sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
      projects = (inv?.projects ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
      conns = await ctx.modules.call(SERVICE, "connections", {}) ?? {};
    } else {
      hosts = [];
      projects = [];
      conns = {};
    }
    error = null;
  } catch (e) {
    error = errMsg(e);
  }
  loaded = true;
  ctx.ui.invalidate();
}
async function run(ctx, label2, fn) {
  busy = label2;
  error = null;
  ctx.ui.invalidate();
  let failure = null;
  try {
    await fn();
  } catch (e) {
    failure = errMsg(e);
  }
  busy = null;
  await refresh(ctx);
  if (failure) {
    error = failure;
    ctx.ui.invalidate();
  }
}
var card = { background: "raised", borderColor: "border", borderWidth: 1, radius: 8, paddingX: 10, paddingY: 8 };
var softCard = { ...card, background: "panel" };
var label = (key, text, extra = {}) => ({ type: "label", key, text, size: "sm", wrap: true, ...extra });
var muted = (key, text) => ({ type: "label", key, text, size: "xs", color: "muted", wrap: true });
var heading = (key, text, trailing = []) => ({ type: "row", key, align: "center", gap: 6, children: [{ type: "label", key: "t", text, size: "xs", weight: "semibold", color: "muted", grow: true }, ...trailing] });
var chip = (key, text, color) => ({ type: "label", key, text, size: "xs", weight: "medium", color, style: { borderColor: color, borderWidth: 1, radius: 9, paddingX: 7, paddingY: 0, noShrink: true } });
var iconBtn = (key, icon, tooltip, action, extra = {}) => ({ type: "button", key, text: "", iconSvg: icon, iconSize: 14, action, small: true, variant: "ghost", tooltip, disabled: !!busy, ...extra });
var primary = (key, text, action, extra = {}) => ({ type: "button", key, text, action, variant: "primary", small: true, disabled: !!busy, style: { fullWidth: true, justify: "center" }, ...extra });
var field = (key, text, input) => ({ type: "column", key, gap: 3, children: [{ type: "label", key: "l", text, size: "xs", color: "muted" }, input] });
var OS = { linux: "Linux", macos: "macOS", windows: "Windows", freebsd: "FreeBSD", openbsd: "OpenBSD", netbsd: "NetBSD", dragonfly: "DragonFly", other: "Other" };
var host = (s) => s.replace(/^[a-z]+:\/\//i, "").replace(/\/.*$/, "");
var groups = (fp) => (fp.match(/.{1,4}/g) ?? []).join(" ");
function ago(iso) {
  if (!iso) return "never";
  const s = Math.round((Date.now() - Date.parse(iso)) / 1e3);
  if (!Number.isFinite(s)) return "unknown";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
function connChip(hostId) {
  const c = conns[hostId];
  if (!c || c.state === "idle") return null;
  const map = {
    idle: ["", "muted"],
    connecting: ["Connecting", "warning"],
    connected: ["Connected", "success"],
    reconnecting: ["Reconnecting", "warning"],
    error: ["Error", "danger"]
  };
  const [text, color] = map[c.state];
  return { ...chip("conn", text, color), tooltip: c.error ?? text };
}
function signedOut() {
  const s = status;
  const kids = [
    { type: "column", key: "hero", gap: 6, style: { ...softCard, paddingY: 14 }, children: [
      { type: "row", key: "t", gap: 8, align: "center", children: [
        { type: "button", key: "ico", text: "", iconSvg: uiIcons.cloud, iconSize: 18, action: "noop", variant: "ghost", small: true, iconColor: "accent" },
        { type: "label", key: "title", text: "Hato Cloud", weight: "semibold", size: "md" }
      ] },
      muted("lead", "Work on machines behind a firewall, and follow your agents from your phone. Hosts only make outgoing connections; traffic is end-to-end encrypted between this computer and the host.")
    ] }
  ];
  if (s.signingIn) {
    kids.push({ type: "progress", key: "signing", indeterminate: true, label: "Finish signing in in your browser…" });
    kids.push({ type: "button", key: "cancel", text: "Cancel", action: "cancelSignIn", small: true, variant: "ghost", style: { fullWidth: true, justify: "center" } });
    return kids;
  }
  kids.push(primary("signin", "Sign in with Google", "signIn", { iconSvg: uiIcons.external, tooltip: "Opens your browser" }));
  if (editingServer) {
    kids.push({ type: "column", key: "server-edit", gap: 6, style: softCard, children: [
      field("server", "Server", { type: "textInput", key: "serverInput", value: serverDraft, placeholder: DEFAULT_SERVER, changeAction: "serverInput", submitAction: "saveServer", cancelAction: "cancelServer", autoFocus: true }),
      { type: "row", key: "a", gap: 6, children: [
        { type: "button", key: "save", text: "Save", action: "saveServer", small: true, variant: "primary" },
        { type: "button", key: "cancel", text: "Cancel", action: "cancelServer", small: true, variant: "ghost" }
      ] }
    ] });
  } else {
    kids.push({ type: "row", key: "server", gap: 4, align: "center", children: [
      muted("s", `Server: ${host(s.server)}`),
      { type: "spacer", key: "sp" },
      { type: "button", key: "chg", text: "Change", action: "editServer", small: true, variant: "ghost" }
    ] });
  }
  kids.push(muted("invite", "Invite-only. Use the Google account your invitation was sent to."));
  return kids;
}
function accountRow() {
  const s = status;
  return { type: "row", key: "account", gap: 4, align: "center", children: [
    { type: "column", key: "who", grow: true, gap: 0, children: [
      { type: "label", key: "email", text: s.user?.email ?? "Signed in", size: "sm", weight: "medium" },
      muted("srv", host(s.server))
    ] },
    iconBtn("web", uiIcons.globe, "Open Hato Cloud in the browser", "openWeb", { value: "/" }),
    iconBtn("refresh", uiIcons.refresh, "Refresh", "refresh"),
    iconBtn("signout", uiIcons["log-out"], "Sign out of Hato Cloud on this computer", "signOut")
  ] };
}
function projectRow(p, h) {
  return { type: "row", key: `p:${p.id}`, gap: 6, align: "center", padding: 2, children: [
    { type: "column", key: "t", grow: true, gap: 0, children: [
      { type: "label", key: "n", text: p.name, size: "sm" },
      { type: "label", key: "path", text: p.path, size: "xs", color: "muted", mono: true }
    ] },
    {
      type: "button",
      key: "open",
      text: "Open",
      action: "openProject",
      value: p.id,
      small: true,
      disabled: !!busy || !h.online,
      tooltip: h.online ? `Open ${p.name} on ${h.name} through Hato Cloud` : `${h.name} is offline`
    }
  ] };
}
function addProjectForm(h) {
  const pathOk = projectPath.trim().startsWith("/") && !projectPath.split("/").some((x) => x === ".." || x === ".");
  return { type: "column", key: "add-project", gap: 6, style: softCard, children: [
    field("path", "Folder on the host", { type: "textInput", key: "projectPath", value: projectPath, placeholder: "/home/you/code/app", changeAction: "projectInput", submitAction: "saveProject", cancelAction: "cancelProject", autoFocus: true }),
    field("name", "Name", { type: "textInput", key: "projectName", value: projectName, placeholder: "app", changeAction: "projectInput", submitAction: "saveProject", cancelAction: "cancelProject" }),
    ...projectPath.trim() && !pathOk ? [{ type: "label", key: "err", text: "Use an absolute path, like /home/you/code/app.", size: "xs", color: "danger", wrap: true }] : [],
    { type: "row", key: "a", gap: 6, children: [
      { type: "button", key: "save", text: "Add project", action: "saveProject", value: h.id, small: true, variant: "primary", disabled: !!busy || !pathOk || !projectName.trim() },
      { type: "button", key: "cancel", text: "Cancel", action: "cancelProject", small: true, variant: "ghost" }
    ] }
  ] };
}
function hostCard(h) {
  const mine = projects.filter((p) => p.hostId === h.id);
  const open = !collapsed.has(h.id);
  const sub = [h.online ? "Online" : `Last seen ${ago(h.lastSeen)}`, OS[h.os] ?? h.os, `v${h.version}`].join(" · ");
  const conn = connChip(h.id);
  const kids = [
    { type: "row", key: "head", gap: 6, align: "center", children: [
      { type: "label", key: "dot", text: "●", size: "xs", color: h.online ? "success" : "muted", tooltip: h.online ? "Online" : "Offline" },
      { type: "column", key: "t", grow: true, gap: 0, children: [
        { type: "label", key: "n", text: h.name, size: "sm", weight: "semibold" },
        muted("s", sub)
      ] },
      ...conn ? [conn] : [],
      iconBtn("toggle", open ? uiIcons.collapse : uiIcons.folder, open ? "Hide projects" : `Show projects (${mine.length})`, "toggleHost", { value: h.id })
    ] }
  ];
  const c = conns[h.id];
  if (c?.state === "error" && c.error) kids.push({ type: "status", key: "conn-err", text: c.error, level: "error" });
  if (open) {
    if (mine.length) kids.push({ type: "column", key: "projects", gap: 2, children: mine.map((p) => projectRow(p, h)) });
    else if (addProjectFor !== h.id) kids.push(muted("none", "No projects yet. Add a folder on this machine to open it here."));
    if (addProjectFor === h.id) kids.push(addProjectForm(h));
    else kids.push({ type: "button", key: "add", text: "Add project", iconSvg: uiIcons.plus, action: "addProject", value: h.id, small: true, variant: "ghost", disabled: !!busy });
  }
  return { type: "column", key: `h:${h.id}`, gap: 6, style: card, children: kids };
}
function addHostSection() {
  const kids = [heading("h", "ADD A HOST")];
  if (addMode === null) {
    kids.push({ type: "row", key: "modes", gap: 6, children: [
      { type: "button", key: "ssh", text: "Via SSH", iconSvg: uiIcons.terminal, action: "addMode", value: "ssh", small: true, disabled: !!busy, tooltip: "Install Hato on a machine you reach over SSH and connect it", style: { justify: "center" } },
      { type: "button", key: "code", text: "Enter code", iconSvg: uiIcons.key, action: "addMode", value: "code", small: true, disabled: !!busy, tooltip: "Approve a machine that ran `hato cloud enroll`", style: { justify: "center" } }
    ] });
    return { type: "column", key: "add-host", gap: 6, children: kids };
  }
  if (addMode === "ssh") {
    const options = (sshProfiles ?? []).map((p) => ({ value: p.id, label: p.label }));
    kids.push({ type: "column", key: "ssh", gap: 8, style: softCard, children: [
      label("t", "Install and connect over SSH", { weight: "semibold" }),
      muted("d", "Hato installs its daemon on the machine and connects it to your cloud. After that, it works even without SSH access."),
      sshProfiles === null ? { type: "progress", key: "loading", indeterminate: true, label: "Loading SSH profiles…" } : options.length ? field("profile", "SSH profile", { type: "select", key: "profile", options, value: sshProfile, action: "sshProfile", placeholder: "Choose a profile" }) : muted("noprof", "No SSH profiles yet. Add an SSH project first, then come back."),
      field("name", "Name in Hato Cloud", { type: "textInput", key: "sshName", value: sshName, placeholder: "build-box", changeAction: "sshName", submitAction: "addViaSsh" }),
      { type: "row", key: "a", gap: 6, children: [
        { type: "button", key: "go", text: "Install and connect", action: "addViaSsh", small: true, variant: "primary", disabled: !!busy || !sshProfile || !sshName.trim() },
        { type: "button", key: "cancel", text: "Cancel", action: "addMode", value: null, small: true, variant: "ghost" }
      ] }
    ] });
  }
  if (addMode === "code") {
    if (!pending) {
      kids.push({ type: "column", key: "code", gap: 8, style: softCard, children: [
        label("t", "Approve a machine", { weight: "semibold" }),
        muted("d", "On the machine, run `hato cloud enroll`. Enter the code it prints."),
        { type: "textInput", key: "codeInput", value: codeDraft, placeholder: "ABCD-EFGH", changeAction: "codeInput", submitAction: "lookupCode", cancelAction: "cancelCode", autoFocus: true },
        { type: "row", key: "a", gap: 6, children: [
          { type: "button", key: "go", text: "Continue", action: "lookupCode", small: true, variant: "primary", disabled: !!busy || normaliseCode(codeDraft) === null },
          { type: "button", key: "cancel", text: "Cancel", action: "cancelCode", small: true, variant: "ghost" }
        ] }
      ] });
    } else {
      kids.push({ type: "column", key: "pending", gap: 8, style: softCard, children: [
        label("t", "Approve this host?", { weight: "semibold" }),
        muted("d", "Check that this code matches the one on the machine’s screen."),
        { type: "label", key: "code", text: pending.userCode, size: "lg", weight: "bold", mono: true, selectable: true, style: { justify: "center", paddingY: 6, background: "panel", radius: 6 } },
        { type: "column", key: "facts", gap: 2, children: [
          label("n", pending.name, { weight: "medium" }),
          muted("o", `${OS[pending.os] ?? pending.os} · Hato ${pending.version}`),
          { type: "label", key: "fp", text: groups(pending.fingerprint), size: "xs", mono: true, color: "muted", wrap: true, selectable: true, tooltip: "Host key fingerprint" }
        ] },
        { type: "status", key: "warn", level: "warn", text: "Only approve a machine you just set up. Approving lets Hato run agents, commands and terminals there as the user running Hato." },
        { type: "column", key: "a", gap: 6, children: [
          { type: "button", key: "approve", text: "Approve", iconSvg: uiIcons.check, action: "approveCode", small: true, variant: "primary", disabled: !!busy, style: { fullWidth: true, justify: "center" } },
          { type: "button", key: "deny", text: "Deny", iconSvg: uiIcons.x, action: "denyCode", small: true, disabled: !!busy, style: { fullWidth: true, justify: "center" } }
        ] }
      ] });
    }
  }
  return { type: "column", key: "add-host", gap: 6, children: kids };
}
function normaliseCode(value) {
  const c = value.toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (c.length !== 8) return null;
  const code = `${c.slice(0, 4)}-${c.slice(4)}`;
  return /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/.test(code) ? code : null;
}
function signedIn() {
  const kids = [accountRow(), { type: "divider", key: "d1" }];
  if (addMode !== null) kids.push(addHostSection(), { type: "divider", key: "d0" });
  const online = hosts.filter((h) => h.online).length;
  kids.push(heading("hosts-h", hosts.length ? `HOSTS · ${online}/${hosts.length} ONLINE` : "HOSTS"));
  if (!hosts.length) {
    kids.push({ type: "column", key: "empty", gap: 4, style: softCard, children: [
      label("t", "No hosts yet", { weight: "semibold" }),
      muted("d", "Add a machine over SSH, or approve the code a firewalled machine shows after running `hato cloud enroll`.")
    ] });
  } else {
    for (const h of hosts) kids.push(hostCard(h));
    kids.push(muted("scope", "Over Cloud: agents, workflows and terminals. File browsing and Git are coming next."));
  }
  if (addMode === null) kids.push({ type: "divider", key: "d2" }, addHostSection());
  return kids;
}
var mod = {
  id: "cloud-panel",
  moduleApiVersion: 1,
  async activate(ctx) {
    ctx.events.on("cloud.changed", () => {
      void refresh(ctx);
    });
    await refresh(ctx);
  },
  render() {
    const kids = [];
    if (!loaded || !status) {
      kids.push(error ? { type: "status", key: "err", text: error, level: "error" } : { type: "progress", key: "loading", indeterminate: true, label: "Loading…" });
      return { type: "column", key: "root", padding: 8, gap: 8, children: kids };
    }
    if (busy) kids.push({ type: "progress", key: "busy", indeterminate: true, label: busy });
    if (status.task) kids.push({ type: "progress", key: "task", indeterminate: true, label: status.task.step ? `${status.task.label} — ${status.task.step}` : status.task.label });
    if (error || status.error) kids.push({ type: "status", key: "err", text: error || status.error, level: "error" });
    kids.push(...status.signedIn ? signedIn() : signedOut());
    return { type: "column", key: "root", padding: 8, gap: 8, scroll: true, grow: true, children: kids };
  },
  async onEvent(ctx, ev) {
    const inputs = ev.inputs ?? {};
    switch (ev.action) {
      case "noop":
        return;
      case "refresh":
        return run(ctx, "Refreshing…", () => ctx.modules.call(SERVICE, "refresh", {}));
      case "signIn":
        error = null;
        return run(ctx, "Opening your browser…", () => ctx.modules.call(SERVICE, "signIn", {}, { timeoutMs: 6e5 }));
      case "cancelSignIn":
        return run(ctx, "Cancelling…", () => ctx.modules.call(SERVICE, "cancelSignIn", {}));
      case "signOut":
        return run(ctx, "Signing out…", () => ctx.modules.call(SERVICE, "signOut", {}));
      case "openWeb":
        return run(ctx, "Opening browser…", () => ctx.modules.call(SERVICE, "openWeb", { path: String(ev.value ?? "/") }));
      case "editServer":
        editingServer = true;
        serverDraft = status?.server ?? DEFAULT_SERVER;
        ctx.ui.invalidate();
        return;
      case "serverInput":
        serverDraft = String(ev.value ?? inputs.serverInput ?? "");
        return;
      case "cancelServer":
        editingServer = false;
        ctx.ui.invalidate();
        return;
      case "saveServer": {
        const url = String(inputs.serverInput ?? serverDraft).trim() || DEFAULT_SERVER;
        editingServer = false;
        return run(ctx, "Saving…", () => ctx.modules.call(SERVICE, "setServer", { url }));
      }
      case "toggleHost": {
        const id = String(ev.value);
        if (collapsed.has(id)) collapsed.delete(id);
        else collapsed.add(id);
        ctx.ui.invalidate();
        return;
      }
      case "openProject":
        return run(ctx, "Connecting through Hato Cloud…", () => ctx.modules.call(SERVICE, "openProject", { projectId: String(ev.value) }, { timeoutMs: 12e4 }));
      case "addProject":
        addProjectFor = String(ev.value);
        projectPath = "";
        projectName = "";
        projectNameTouched = false;
        ctx.ui.invalidate();
        return;
      case "cancelProject":
        addProjectFor = null;
        ctx.ui.invalidate();
        return;
      case "projectInput": {
        if (ev.key === "projectPath") {
          projectPath = String(ev.value ?? inputs.projectPath ?? "");
          if (!projectNameTouched) projectName = projectPath.replace(/\/+$/, "").split("/").pop() ?? "";
        }
        if (ev.key === "projectName") {
          projectName = String(ev.value ?? inputs.projectName ?? "");
          projectNameTouched = true;
        }
        ctx.ui.invalidate();
        return;
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
        addMode = ev.value ?? null;
        pending = null;
        codeDraft = "";
        if (addMode === "ssh") {
          sshProfiles = null;
          sshProfile = null;
          sshName = "";
          ctx.ui.invalidate();
          try {
            sshProfiles = await ctx.modules.call(SERVICE, "sshProfiles", {}) ?? [];
            sshProfile = sshProfiles?.[0]?.id ?? null;
            sshName = sshProfiles?.[0]?.label?.split(/[@:\s]/).pop() ?? "";
          } catch (e) {
            sshProfiles = [];
            error = errMsg(e);
          }
        }
        ctx.ui.invalidate();
        return;
      }
      case "sshProfile":
        sshProfile = String(ev.value);
        {
          const p = sshProfiles?.find((x) => x.id === sshProfile);
          if (p && !sshName.trim()) sshName = p.label;
        }
        ctx.ui.invalidate();
        return;
      case "sshName":
        sshName = String(ev.value ?? inputs.sshName ?? "");
        ctx.ui.invalidate();
        return;
      case "addViaSsh": {
        const name = String(inputs.sshName ?? sshName).trim();
        if (!sshProfile || !name) return;
        return run(ctx, `Installing Hato on ${name}…`, async () => {
          await ctx.modules.call(SERVICE, "addHostViaSsh", { profileId: sshProfile, name }, { timeoutMs: 9e5 });
          addMode = null;
        });
      }
      case "codeInput":
        codeDraft = String(ev.value ?? inputs.codeInput ?? "").toUpperCase();
        ctx.ui.invalidate();
        return;
      case "cancelCode":
        addMode = null;
        pending = null;
        codeDraft = "";
        ctx.ui.invalidate();
        return;
      case "lookupCode": {
        const code = normaliseCode(String(inputs.codeInput ?? codeDraft));
        if (!code) {
          error = "Codes look like ABCD-EFGH.";
          ctx.ui.invalidate();
          return;
        }
        return run(ctx, "Checking code…", async () => {
          pending = await ctx.modules.call(SERVICE, "pendingEnrollment", { userCode: code });
        });
      }
      case "approveCode": {
        const code = pending?.userCode;
        if (!code) return;
        return run(ctx, "Approving…", async () => {
          await ctx.modules.call(SERVICE, "approveEnrollment", { userCode: code });
          pending = null;
          addMode = null;
          codeDraft = "";
        });
      }
      case "denyCode": {
        const code = pending?.userCode;
        if (!code) return;
        return run(ctx, "Denying…", async () => {
          await ctx.modules.call(SERVICE, "denyEnrollment", { userCode: code });
          pending = null;
          addMode = null;
          codeDraft = "";
        });
      }
    }
  }
};
var index_default = mod;
export {
  index_default as default
};
