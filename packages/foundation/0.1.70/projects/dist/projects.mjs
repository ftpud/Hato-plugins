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
function sha256Hex(text) {
  const h = hasher();
  h.update(text, 0, text.length);
  return h.finish();
}

// ../sdk/runtime.ts
var grantCache = /* @__PURE__ */ new Map();
var sshCache = /* @__PURE__ */ new Map();
function cloudMachineId(server, hostId) {
  return "cloud:" + sha256Hex(hostId + " on " + server.replace(/^http/, "ws"));
}
function projectWorkspaceId(project) {
  return project.kind === "cloud" && !project.rootWorkspace ? `cloud:${project.id}` : `project:${project.id}:root`;
}
function sshProfileSpec(ssh) {
  return { profileId: ssh.profileId, host: ssh.host, port: ssh.port, user: ssh.user, identityFile: ssh.identityFile ?? null, transport: ssh.transport ?? "ssh", ...ssh.auth ? { auth: ssh.auth } : {} };
}
function sshFromProfile(p) {
  const password = p.authRef === "password";
  return { profileId: p.id, host: p.host, port: p.port, user: p.user, identityFile: p.authRef && p.authRef !== "agent" && !password ? p.authRef : null, transport: p.transport ?? "ssh", ...password ? { auth: "password" } : {} };
}
function wslLocation(path) {
  const m = /^[\\/]{2}(?:\?[\\/]UNC[\\/])?(?:wsl\.localhost|wsl\$)[\\/]([^\\/]+)(?:[\\/](.*))?$/i.exec(path.trim());
  if (!m) return null;
  return { distro: m[1], remotePath: "/" + (m[2] || "").replace(/\\/g, "/").replace(/\/+$/, "") };
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
async function daemonTargetFor(ctx, desc) {
  switch (desc.location) {
    case "local":
      return { kind: "local" };
    case "ssh":
      return { kind: "ssh", connection: (await sshConnect(ctx, desc)).connection };
    case "cloud": {
      if (!desc.cloudHostId) throw new Error("Cloud workspace is missing its host.");
      const target = await ctx.modules.call("cloud", "target", {
        hostId: desc.cloudHostId,
        machineId: desc.machineId
      }, { timeoutMs: 62e4 });
      if (target?.kind !== "cloud" || !target.connection) throw new Error("Invalid Cloud daemon route.");
      return target;
    }
    default:
      throw new Error("Unsupported workspace location.");
  }
}
async function targetFor(ctx, desc) {
  if (desc.location === "local") return { kind: "local" };
  if (desc.location === "cloud") return daemonTargetFor(ctx, desc);
  const c = await sshConnect(ctx, desc);
  return { kind: "ssh", connection: c.connection, machineId: c.machineId };
}
async function workspaceGrant(ctx, desc, kind, root) {
  const r = root || desc.rootAbsolutePath;
  const cloud = desc.location === "cloud" ? await targetFor(ctx, desc) : null;
  const key = kind + "|" + desc.machineId + "|" + r + "|" + (cloud?.kind === "cloud" ? cloud.connection : "");
  let p = grantCache.get(key);
  if (!p) {
    p = (async () => {
      const target = cloud ?? await targetFor(ctx, desc);
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
function errMsg(e) {
  return e && (e.message || String(e)) || "unknown error";
}
var machinePlatformKey = (machineId) => `machine.platform.${machineId}`;

// ../sdk/mcp.ts
function exportMcpTools(ctx, title, tools) {
  let pending2 = 0;
  const publish = () => ctx.state.set(`${ctx.moduleId}.mcp`, {
    title,
    generation: ctx.generation,
    tools: tools.map(({ handler: _handler, ...definition }) => definition)
  });
  ctx.events.on("internal-mcp.call", async (request) => {
    if (request?.module !== ctx.moduleId || request.generation !== ctx.generation || typeof request.id !== "string") return;
    const tool = tools.find((tool2) => tool2.name === request.tool);
    pending2++;
    try {
      if (!tool) throw new Error("Unknown module MCP command");
      const scope = request.scope;
      if (!scope || typeof scope.workspaceId !== "string" || typeof scope.conversationId !== "string" || typeof scope.machineId !== "string") throw new Error("Missing authenticated MCP scope");
      const result = await tool.handler(request.args || {}, scope);
      ctx.events.emit(`${ctx.moduleId}.mcp.result`, { id: request.id, generation: ctx.generation, result: result === void 0 ? null : result });
    } catch (e) {
      ctx.events.emit(`${ctx.moduleId}.mcp.result`, { id: request.id, generation: ctx.generation, error: errMsg(e) });
    } finally {
      pending2--;
    }
  });
  publish();
  return { publish, pending: () => pending2 };
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

// ../sdk/platform.ts
var isPosix = (os) => os !== "windows";
function osOf(platform) {
  return platform === "windows" ? "windows" : platform === "macos" ? "macos" : platform === "linux" ? "linux" : "posix";
}
function isAbsolutePath(p) {
  return p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("\\\\");
}
var slashPath = (p) => p.replace(/\\/g, "/");
function baseName(p) {
  const parts = slashPath(p).replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || p;
}
function knownDirs(ctx) {
  const info = ctx.host?.env?.info?.();
  const d = info?.knownDirs || {};
  const windows = osOf(info?.platform) === "windows";
  return {
    home: d.home ?? info?.home ?? null,
    system: d.system || (windows ? "C:\\Windows" : null),
    programs: d.programs || (windows ? "C:\\Program Files" : null),
    localData: d.localData || null,
    roamingData: d.roamingData || null
  };
}
var systemRoot = (ctx) => knownDirs(ctx).system || "C:\\Windows";
var windowsPowerShell = (ctx) => `${systemRoot(ctx)}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
var windowsCmd = (ctx) => `${systemRoot(ctx)}\\System32\\cmd.exe`;
var windowsWsl = (ctx) => `${systemRoot(ctx)}\\System32\\wsl.exe`;
var PWSH_UTF8 = "[Console]::InputEncoding=[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);$OutputEncoding=[Console]::OutputEncoding";
function pwshScript(command) {
  return `${PWSH_UTF8}
${command}
$hatoOk=$?
if (-not $hatoOk) { if ($LASTEXITCODE) { exit $LASTEXITCODE }; exit 1 }
exit 0`;
}
function executionPolicyHint(output) {
  if (!/running scripts is disabled on this system|about_Execution_Policies|cannot be loaded because running scripts/i.test(output)) return null;
  return "PowerShell's execution policy blocked a script (for example npm.ps1). Hato does not change this policy. Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` in PowerShell, or choose Command Prompt as the shell.";
}
function posixHeredoc(language, code) {
  const shell = language === "bash" || language === "zsh" ? language : "sh";
  let delimiter = "HATO_SCRIPT";
  while (code.split(/\r?\n/).includes(delimiter)) delimiter += "_";
  return `${shell} <<'${delimiter}'
${code}${code.endsWith("\n") ? "" : "\n"}${delimiter}`;
}
var POSIX_CODE = { languages: ["sh", "shell", "bash", "zsh"], type: posixHeredoc };
var asTyped = (_language, code) => code.replace(/\r?\n$/, "");
var windowsOnly = (os) => os === "windows";
var powershellProfile = (label, programs) => ({
  label,
  os: windowsOnly,
  programs: (ctx, c) => c.program ? [c.program] : programs(ctx),
  terminal: () => ["-NoLogo", "-NoExit", "-Command", PWSH_UTF8],
  command: (command) => ({ args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", pwshScript(command)] }),
  code: { languages: ["powershell", "pwsh", "ps1"], type: asTyped },
  hint: executionPolicyHint
});
var SHELL_PROFILES = {
  // The user's login shell (Linux, macOS, SSH/WSL/Cloud machines). The kernel/daemon picks the program.
  login: {
    label: "Login shell",
    os: isPosix,
    programs: (_ctx, c) => c.program ? [c.program] : [],
    terminal: () => ["-l"],
    command: (command) => ({ args: ["-lc", command] }),
    code: POSIX_CODE
  },
  pwsh: powershellProfile("PowerShell 7 (pwsh)", (ctx) => [`${knownDirs(ctx).programs || "C:\\Program Files"}\\PowerShell\\7\\pwsh.exe`, "pwsh.exe"]),
  powershell: powershellProfile("Windows PowerShell 5.1", (ctx) => [windowsPowerShell(ctx)]),
  cmd: {
    label: "Command Prompt (cmd)",
    os: windowsOnly,
    programs: (ctx, c) => c.program ? [c.program] : [windowsCmd(ctx)],
    terminal: () => ["/K", "chcp 65001>nul"],
    // `/s /c "<command>"`: cmd strips exactly the outer quotes and runs the rest as typed.
    command: (command) => ({ args: ["/d", "/s", "/c", `"${command}"`], verbatimArgs: true }),
    code: { languages: ["cmd", "bat", "batch"], type: asTyped }
  },
  "git-bash": {
    label: "Git Bash",
    os: windowsOnly,
    programs: (ctx, c) => {
      if (c.program) return [c.program];
      const d = knownDirs(ctx);
      return [`${d.programs || "C:\\Program Files"}\\Git\\bin\\bash.exe`, ...d.localData ? [`${d.localData}\\Programs\\Git\\bin\\bash.exe`] : []];
    },
    terminal: () => ["--login", "-i"],
    command: (command) => ({ args: ["-lc", command] }),
    code: POSIX_CODE
  },
  wsl: {
    label: "WSL",
    os: windowsOnly,
    programs: (ctx, c) => c.program ? [c.program] : [windowsWsl(ctx)],
    terminal: (c) => c.distro ? ["-d", c.distro] : [],
    command: (command, c) => ({ args: [...c.distro ? ["-d", c.distro] : [], "--exec", "/bin/sh", "-lc", command] }),
    code: POSIX_CODE
  }
};
var RUNNABLE_CODE_LANGUAGES = [...new Set(Object.values(SHELL_PROFILES).flatMap((p) => p.code.languages))];
var RESOLVE_MARK = "__HATO_RESOLVE__=";
var RESOLVE_SCRIPT = [
  "$ErrorActionPreference='SilentlyContinue'",
  "$m=[Environment]::GetEnvironmentVariable('Path','Machine');$u=[Environment]::GetEnvironmentVariable('Path','User')",
  "$p=((@($m,$u)|Where-Object {$_}) -join ';');$env:Path=$p",
  "$n=$env:HATO_RESOLVE;$c=$null",
  "if ([IO.Path]::IsPathRooted($n)) { if (Test-Path -LiteralPath $n -PathType Leaf) { $c=(Resolve-Path -LiteralPath $n).Path } }",
  "else { $c=(Get-Command -Name $n -CommandType Application | Select-Object -First 1).Source }",
  "$s=$null;$nx=$false;$node=$null",
  "if ($c -and $c -match '\\.(cmd|bat)$') { $s=[IO.File]::ReadAllText($c);$nx=Test-Path -LiteralPath (Join-Path (Split-Path -Parent $c) 'node.exe');$node=(Get-Command -Name node -CommandType Application | Select-Object -First 1).Source }",
  `[Console]::Out.Write("\`n${RESOLVE_MARK}"+(ConvertTo-Json -Compress @{path=$c;pathEnv=$p;shim=$s;nodeNext=$nx;node=$node}))`
].join("\n");

// modules/services/projects/src/groups.ts
var settingsKey = "projects.groups";
var all = "all";
var queue = Promise.resolve();
var pending = 0;
var pendingGroups = () => pending;
function turn(work) {
  pending++;
  const next = queue.then(work).finally(() => {
    pending--;
  });
  queue = next.catch(() => {
  });
  return next;
}
function normalize(raw, projects) {
  const groups = [];
  const ids = /* @__PURE__ */ new Set([all]);
  for (const g of Array.isArray(raw?.groups) ? raw.groups : []) {
    if (typeof g?.id !== "string" || ids.has(g.id) || typeof g.name !== "string") continue;
    ids.add(g.id);
    const projectIds = Array.isArray(g.projectIds) ? [...new Set(g.projectIds.filter((id) => projects.has(id)))] : [];
    groups.push({ id: g.id, name: g.name, projectIds });
  }
  return { groups, active: ids.has(raw?.active) ? raw.active : all };
}
function nameFor(value, state, id) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > 60 || /[\r\n]/.test(name)) throw new Error("Enter a group name of 1–60 characters");
  const folded = name.toLowerCase();
  if (folded === all || state.groups.some((g) => g.id !== id && g.name.toLowerCase() === folded)) throw new Error("A group already uses that name");
  return name;
}
function projectGroups(ctx, op, args = {}) {
  return turn(async () => {
    const [raw, registered] = await Promise.all([
      ctx.modules.call("persistence", "settings.get", { key: settingsKey }),
      ctx.modules.call("persistence", "projects.list", {})
    ]);
    const projects = new Set(registered.map((p) => p.id));
    const state = normalize(raw, projects);
    const requireGroup = () => {
      const group = state.groups.find((g) => g.id === args.id);
      if (!group) throw new Error("Unknown project group");
      return group;
    };
    const projectId = () => {
      if (!projects.has(args.projectId)) throw new Error("Unknown project");
      return args.projectId;
    };
    let created;
    switch (op) {
      case "create": {
        if (state.groups.length >= 100) throw new Error("You can create up to 100 project groups");
        created = { id: crypto.randomUUID(), name: nameFor(args.name, state), projectIds: args.projectId == null ? [] : [projectId()] };
        state.groups.push(created);
        if (args.activate === true) state.active = created.id;
        break;
      }
      case "rename":
        requireGroup().name = nameFor(args.name, state, args.id);
        break;
      case "delete": {
        if (requireGroup().projectIds.length && args.confirm !== true) throw new Error("Confirm deletion of this non-empty group");
        state.groups = state.groups.filter((g) => g.id !== args.id);
        if (state.active === args.id) state.active = all;
        break;
      }
      case "reorder": {
        const ordered = Array.isArray(args.ids) ? args.ids : [];
        if (ordered.length !== state.groups.length || new Set(ordered).size !== ordered.length || ordered.some((id) => !state.groups.some((g) => g.id === id))) {
          throw new Error("Provide each custom group ID once in the desired order");
        }
        state.groups = ordered.map((id) => state.groups.find((g) => g.id === id));
        break;
      }
      case "assign": {
        const group = requireGroup(), id = projectId();
        if (!group.projectIds.includes(id)) group.projectIds.push(id);
        break;
      }
      case "unassign": {
        const group = requireGroup();
        group.projectIds = group.projectIds.filter((id) => id !== args.projectId);
        break;
      }
      case "set_active":
        if (args.id !== all) requireGroup();
        state.active = args.id;
        break;
    }
    if (JSON.stringify(state) !== JSON.stringify(raw ?? { groups: [], active: all })) {
      await ctx.modules.call("persistence", "settings.set", { key: settingsKey, value: state });
    }
    if (op !== "list") ctx.events.emit("projects.groupsChanged", state);
    return { ...state, ...created ? { created } : {} };
  });
}
var string = { type: "string" };
var boolean = { type: "boolean" };
function groupTools(ctx) {
  const definitions = [
    ["list", "List project groups, their project IDs, order and the active tab. All has ID all.", {}, []],
    ["create", "Create a project group. Optionally assign one project and activate the tab.", { name: string, projectId: string, activate: boolean }, ["name"]],
    ["rename", "Rename a custom project group.", { id: string, name: string }, ["id", "name"]],
    ["delete", "Delete a group. Set confirm for a non-empty group. Project registrations are kept.", { id: string, confirm: boolean }, ["id"]],
    ["reorder", "Set the complete order of custom groups. All stays first.", { ids: { type: "array", items: string } }, ["ids"]],
    ["assign", "Add a registered project to a group.", { id: string, projectId: string }, ["id", "projectId"]],
    ["unassign", "Remove a project's membership in one group.", { id: string, projectId: string }, ["id", "projectId"]],
    ["set_active", "Select a group in the desktop Projects panel. Pass all for the unfiltered view.", { id: string }, ["id"]]
  ];
  return definitions.map(([op, description, properties, required]) => ({
    name: `project_groups_${op}`,
    description,
    inputSchema: { type: "object", properties, required, additionalProperties: false },
    annotations: { readOnlyHint: op === "list", destructiveHint: op === "delete" },
    handler: (args) => projectGroups(ctx, op, args)
  }));
}

// modules/services/projects/src/index.ts
var gitCache = /* @__PURE__ */ new Map();
var offline = /* @__PURE__ */ new Map();
var ORDER_KEY = "projects.order";
var TASK_TIMEOUT_MS = 18e4;
var mcp;
async function orderedProjects(ctx) {
  const [projects, savedOrder] = await Promise.all([
    ctx.modules.call("persistence", "projects.list"),
    ctx.modules.call("persistence", "settings.get", { key: ORDER_KEY })
  ]);
  const positions = /* @__PURE__ */ new Map();
  if (Array.isArray(savedOrder)) for (const id of savedOrder) {
    if (typeof id === "string" && !positions.has(id)) positions.set(id, positions.size);
  }
  return projects.sort((a, b) => (positions.get(a.id) ?? positions.size) - (positions.get(b.id) ?? positions.size) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}
function projectDesc(p, ssh) {
  return {
    id: projectWorkspaceId(p),
    projectId: p.id,
    name: p.name,
    location: p.kind,
    machineId: p.kind === "cloud" ? cloudMachineId(p.cloudOrigin, p.cloudHostId) : p.kind === "ssh" ? `ssh:${p.sshProfileId}` : "local",
    ...p.kind === "cloud" ? { cloudHostId: p.cloudHostId } : {},
    rootAbsolutePath: p.rootPath,
    connectionRef: p.sshProfileId,
    ssh: ssh ? sshFromProfile(ssh) : null
  };
}
async function describeProject(ctx, projectId) {
  const p = await ctx.modules.call("persistence", "projects.get", { id: projectId });
  if (!p) throw new Error(`unknown project ${projectId}`);
  const ssh = p.kind === "ssh" ? await ctx.modules.call("persistence", "ssh.get", { id: p.sshProfileId }) : null;
  return { project: p, desc: projectDesc(p, ssh) };
}
async function detectGit(ctx, desc) {
  const g = await workspaceGrant(ctx, desc, "process");
  const run = async (args) => ctx.host.process.run(g.grant, { target: await targetFor(ctx, desc), executable: "git", args: ["-C", desc.rootAbsolutePath, ...args], cwd: desc.rootAbsolutePath, loginShell: desc.location !== "local" }, { timeoutMs: 2e4 });
  const top = await run(["rev-parse", "--show-toplevel"]);
  if (top.code !== 0) return { isGit: false, topLevel: null, hasCommits: false, checkedAt: Date.now() };
  const head = await run(["rev-parse", "--verify", "-q", "HEAD"]);
  return { isGit: true, topLevel: top.stdout.trim(), hasCommits: head.code === 0, checkedAt: Date.now() };
}
var recordedPlatform = /* @__PURE__ */ new Map();
async function recordPlatform(ctx, desc) {
  if (desc.location !== "ssh" || desc.ssh?.transport === "wsl") return;
  const platform = (await sshConnect(ctx, desc).catch(() => null))?.platform;
  if (!platform?.os) return;
  const value = JSON.stringify(platform);
  if (recordedPlatform.get(desc.machineId) === value) return;
  await ctx.modules.call("persistence", "settings.set", { key: machinePlatformKey(desc.machineId), value: platform });
  recordedPlatform.set(desc.machineId, value);
  ctx.events.emit("projects.machinePlatform", { machineId: desc.machineId, ...platform });
}
async function refreshGit(ctx, projectId) {
  try {
    const { desc } = await describeProject(ctx, projectId);
    const info = await detectGit(ctx, desc);
    await recordPlatform(ctx, desc).catch((e) => ctx.log.warn("record machine platform", errMsg(e)));
    gitCache.set(projectId, info);
    offline.delete(projectId);
  } catch (e) {
    offline.set(projectId, errMsg(e));
    gitCache.set(projectId, { isGit: gitCache.get(projectId)?.isGit ?? false, topLevel: null, hasCommits: false, error: errMsg(e), checkedAt: Date.now() });
  }
  ctx.events.emit("projects.changed", { projectId });
}
var basename = baseName;
var isWindows = (ctx) => ctx.host.env.info().platform === "windows";
async function registerRemote(ctx, profile, remotePath, name) {
  const desc = projectDesc({ id: "pending", name: "pending", kind: "ssh", rootPath: remotePath, sshProfileId: profile.id }, profile);
  const g = await workspaceGrant(ctx, desc, "fs");
  const existing = await ctx.modules.call("persistence", "projects.findByRoot", { rootPath: g.root, sshProfileId: profile.id });
  if (existing) return existing;
  const id = crypto.randomUUID();
  await ctx.modules.call("persistence", "projects.insert", { project: { id, name: String(name || `${basename(g.root)} (${profile.host})`), kind: "ssh", rootPath: g.root, sshProfileId: profile.id } });
  await refreshGit(ctx, id);
  ctx.events.emit("projects.changed", { projectId: id });
  return ctx.modules.call("persistence", "projects.get", { id });
}
var mod = {
  id: "projects",
  moduleApiVersion: 1,
  async activate(ctx, prev) {
    if (prev && prev.git) for (const [k, v] of prev.git) gitCache.set(k, v);
    const list = await ctx.modules.call("persistence", "projects.list");
    if (list.length === 0) {
      const info = ctx.host.env.info();
      const root = info.initialRoot;
      if (root && (!isWindows(ctx) || info.initialRootExplicit === true || wslLocation(root))) {
        try {
          await mod.methods.addLocal(ctx, { path: root }, { caller: "projects" });
          ctx.log.info("registered initial project", root);
        } catch (e) {
          ctx.log.warn("could not register initial root", root, errMsg(e));
        }
      }
    }
    const all2 = await ctx.modules.call("persistence", "projects.list");
    for (const p of all2) if (p.kind !== "cloud" && !gitCache.has(p.id)) void refreshGit(ctx, p.id);
    ctx.events.on("cloud.changed", () => ctx.events.emit("projects.changed", {}));
    ctx.events.on("workspace.selected", async ({ workspaceId }) => {
      if (typeof workspaceId === "string" && workspaceId.startsWith("cloud:")) await refreshGit(ctx, workspaceId.slice(6));
    });
    mcp = exportMcpTools(ctx, "Projects", [
      ...groupTools(ctx),
      {
        name: "list",
        title: "List projects",
        description: "List all registered Hato projects and their IDs for creating tasks. Includes the project name, location, root path and whether it contains the session workspace.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true },
        async handler(_args, scope) {
          const current = await ctx.modules.call("workspace", "resolve", { workspaceId: scope.workspaceId });
          return (await orderedProjects(ctx)).map((p) => ({
            id: p.id,
            name: p.name,
            kind: p.kind,
            rootPath: p.rootPath,
            current: p.id === current.projectId,
            isGit: gitCache.get(p.id)?.isGit ?? null
          }));
        }
      },
      {
        name: "create_task",
        title: "Create a task in any project",
        description: "Create a linked Git worktree in a registered Hato project using its ID from projects__list. An optional branch can be existing or new. The user's workspace selection is preserved.",
        inputSchema: { type: "object", additionalProperties: false, required: ["projectId"], properties: {
          projectId: { type: "string", description: "Project ID from projects__list." },
          name: { type: "string", maxLength: 100, description: "Task name. Defaults to the branch name." },
          branch: { type: "string", maxLength: 200, description: "Branch name. A new branch is generated when omitted." }
        } },
        annotations: { destructiveHint: false },
        timeoutMs: TASK_TIMEOUT_MS,
        async handler(args, scope) {
          const projectId = typeof args.projectId === "string" ? args.projectId.trim() : "";
          const name = typeof args.name === "string" ? args.name.trim() : "";
          const branch = typeof args.branch === "string" ? args.branch.trim() : "";
          if (!projectId) throw new Error("Provide a project ID from projects__list");
          if (!name && !branch) throw new Error("Provide a task name or a branch");
          await ctx.modules.call("workspace", "resolve", { workspaceId: scope.workspaceId });
          const task = await ctx.modules.call("git-tasks", "create", { projectId, name, branch, select: false }, { timeoutMs: TASK_TIMEOUT_MS });
          return { ...task, projectId, workspaceId: `task:${task.id}` };
        }
      }
    ]);
  },
  canSwap: () => ({ ok: (mcp?.pending() ?? 0) === 0 && pendingGroups() === 0, reason: "A Projects command is running" }),
  snapshot: () => ({ git: Array.from(gitCache.entries()) }),
  methods: {
    health: async (ctx) => {
      await ctx.modules.call("persistence", "projects.list");
      return { ok: true };
    },
    "groups.list": (ctx) => projectGroups(ctx, "list"),
    "groups.create": (ctx, a) => projectGroups(ctx, "create", a),
    "groups.rename": (ctx, a) => projectGroups(ctx, "rename", a),
    "groups.delete": (ctx, a) => projectGroups(ctx, "delete", a),
    "groups.reorder": (ctx, a) => projectGroups(ctx, "reorder", a),
    "groups.assign": (ctx, a) => projectGroups(ctx, "assign", a),
    "groups.unassign": (ctx, a) => projectGroups(ctx, "unassign", a),
    "groups.set_active": (ctx, a) => projectGroups(ctx, "set_active", a),
    async setOrder(ctx, a) {
      const projects = await ctx.modules.call("persistence", "projects.list");
      const value = parseOrder(a.order, projects.map((p) => p.id));
      await ctx.modules.call("persistence", "settings.set", { key: ORDER_KEY, value });
      ctx.events.emit("projects.changed", { orderChanged: true });
      return null;
    },
    /** Tree model consumed by projects-panel, in the user's saved order. */
    async tree(ctx) {
      const projects = await orderedProjects(ctx);
      const tasks = await ctx.modules.call("persistence", "tasks.list", {});
      const profiles = await ctx.modules.call("persistence", "ssh.list");
      const byProfile = new Map(profiles.map((p) => [p.id, p]));
      const cloud = projects.some((p) => p.kind === "cloud") ? await mod.methods.cloudHosts(ctx, {}, { caller: "projects" }) : null;
      return projects.map((p) => {
        const git = gitCache.get(p.id);
        const ssh = p.kind === "ssh" ? byProfile.get(p.sshProfileId) : null;
        const host = p.kind === "cloud" && cloud?.server === p.cloudOrigin ? cloud?.hosts.find((h) => h.id === p.cloudHostId) : null;
        const cloudUnavailable = p.kind === "cloud" && (!host?.online || !cloud?.projectIds.includes(p.id));
        return {
          id: p.id,
          name: p.name,
          kind: p.kind,
          rootPath: p.rootPath,
          expanded: p.expanded,
          ...p.kind === "cloud" && p.rootWorkspace ? { rootWorkspace: true } : {},
          host: ssh ? ssh.transport === "wsl" ? ssh.host : `${ssh.user}@${ssh.host}${ssh.port !== 22 ? ":" + ssh.port : ""}` : host?.name ?? null,
          transport: ssh ? ssh.transport : null,
          auth: ssh?.authRef === "password" ? "password" : null,
          needsPassword: ssh?.authRef === "password" && offline.has(p.id),
          isGit: git ? git.isGit : null,
          hasCommits: git ? git.hasCommits : null,
          offline: cloudUnavailable ? "Cloud project or host unavailable" : offline.get(p.id) || null,
          tasks: tasks.filter((t) => t.projectId === p.id).map((t) => ({ id: t.id, name: t.name, branch: t.branch, worktreePath: t.worktreePath, status: t.status }))
        };
      });
    },
    /** Remove a project from Hato. Its files stay on disk; tasks must be deleted first. */
    async remove(ctx, a) {
      const id = String(a.projectId || "");
      const project = await ctx.modules.call("persistence", "projects.get", { id });
      if (!project) throw new Error("Unknown project");
      const tasks = await ctx.modules.call("persistence", "tasks.list", { projectId: id });
      if (tasks.length) throw new Error(`${project.name} still has ${tasks.length} task(s); delete them first.`);
      if (project.kind === "cloud") await ctx.modules.call("cloud", "removeProject", { projectId: id, origin: project.cloudOrigin });
      await ctx.modules.call("workspace", "forget", { workspaceIds: [projectWorkspaceId(project)] });
      await ctx.modules.call("persistence", "projects.delete", { id });
      try {
        await projectGroups(ctx, "list");
      } catch (e) {
        ctx.log.warn("prune project groups", errMsg(e));
      }
      gitCache.delete(id);
      offline.delete(id);
      ctx.events.emit("projects.changed", { projectId: id, removed: true });
      return { removed: true };
    },
    async get(ctx, a) {
      const { project, desc } = await describeProject(ctx, a.projectId);
      return { ...project, desc, git: gitCache.get(project.id) || null };
    },
    async addLocal(ctx, a) {
      const path = String(a.path || "").trim();
      if (isWindows(ctx)) {
        const wsl = wslLocation(path);
        if (wsl) return mod.methods.addWsl(ctx, { ...wsl, name: a.name }, { caller: "projects" });
      }
      if (!isAbsolutePath(path)) throw new Error("project path must be absolute");
      const g = await ctx.host.capabilities.request({ kind: "fs", root: path, target: { kind: "local" } });
      const root = g.root;
      await ctx.host.capabilities.release(g.grant);
      const existing = await ctx.modules.call("persistence", "projects.findByRoot", { rootPath: root, sshProfileId: null });
      if (existing) return existing;
      const id = crypto.randomUUID();
      await ctx.modules.call("persistence", "projects.insert", { project: { id, name: String(a.name || basename(root)), kind: "local", rootPath: root, sshProfileId: null } });
      await refreshGit(ctx, id);
      ctx.events.emit("projects.changed", { projectId: id });
      return ctx.modules.call("persistence", "projects.get", { id });
    },
    async cloudHosts(ctx, a) {
      try {
        if (a?.refresh) await ctx.modules.call("cloud", "refresh").catch(() => {
        });
        const [status, inventory] = await Promise.all([
          ctx.modules.call("cloud", "status"),
          ctx.modules.call("cloud", "inventory")
        ]);
        return {
          available: true,
          server: status.server,
          signedIn: status.signedIn,
          hosts: inventory.hosts,
          projectIds: inventory.projects.map((p) => p.id)
        };
      } catch (e) {
        const available = !/no module '|is unavailable|has no active generation/i.test(errMsg(e));
        return { available, server: null, signedIn: false, hosts: [], projectIds: [] };
      }
    },
    async addCloud(ctx, a) {
      const { available, server, signedIn, hosts } = await mod.methods.cloudHosts(ctx, {}, { caller: "projects" });
      if (!available) throw new Error("Install the Hato Cloud plugin to add Cloud projects.");
      if (!signedIn) throw new Error("Sign in from the Cloud panel first.");
      const host = hosts.find((h) => h.id === a.hostId);
      if (!host?.online) throw new Error("Choose an online Cloud host.");
      const path = String(a.remotePath || "").trim();
      if (!path.startsWith("/")) throw new Error("Enter an absolute path on the Cloud host.");
      const desc = projectDesc({ id: "pending", name: "pending", kind: "cloud", rootPath: path, cloudOrigin: server, cloudHostId: host.id }, null);
      const grant = await workspaceGrant(ctx, desc, "fs");
      const inventory = await ctx.modules.call("cloud", "inventory");
      const existing = inventory.projects.find((p) => p.hostId === host.id && p.path === grant.root);
      if (existing) return ctx.modules.call("persistence", "projects.get", { id: existing.id });
      const created = await ctx.modules.call("cloud", "addProject", { hostId: host.id, path: grant.root, name: String(a.name || basename(grant.root)) });
      await refreshGit(ctx, created.id);
      return ctx.modules.call("persistence", "projects.get", { id: created.id });
    },
    /** Move an SSH project to Hato Cloud in place. It keeps its id and workspace id, so agents,
     *  chats, workflows, tasks and views stay with it; only the route changes to the Cloud host. */
    async moveToCloud(ctx, a) {
      const project = await ctx.modules.call("persistence", "projects.get", { id: String(a.projectId || "") });
      if (!project) throw new Error("Unknown project");
      if (project.kind !== "ssh") throw new Error("Only SSH projects can be moved to Hato Cloud.");
      const { server, signedIn, hosts } = await mod.methods.cloudHosts(ctx, { refresh: true }, { caller: "projects" });
      if (!signedIn || !server) throw new Error("Sign in from the Cloud panel first.");
      const host = hosts.find((h) => h.id === a.hostId);
      if (!host?.online) throw new Error("Choose an online Cloud host.");
      const desc = projectDesc({ ...project, kind: "cloud", rootWorkspace: true, cloudOrigin: server, cloudHostId: host.id }, null);
      let root;
      try {
        root = (await workspaceGrant(ctx, desc, "fs")).root;
      } catch (e) {
        throw new Error(`${project.rootPath} isn't reachable on ${host.name}. Pick the Cloud host that is this same machine. (${errMsg(e)})`);
      }
      const inventory = await ctx.modules.call("cloud", "inventory");
      const clash = inventory.projects.find((p) => p.hostId === host.id && p.path === root && p.id !== project.id);
      if (clash) throw new Error(`This folder is already a separate Cloud project (“${clash.name}”). Remove that one from Hato first, then move this project.`);
      await ctx.modules.call("cloud", "addProject", { id: project.id, hostId: host.id, name: project.name, path: root });
      const moved = await ctx.modules.call("persistence", "projects.moveToCloud", {
        id: project.id,
        origin: server,
        hostId: host.id,
        fromMachineId: `ssh:${project.sshProfileId}`,
        toMachineId: cloudMachineId(server, host.id)
      });
      offline.delete(project.id);
      await ctx.modules.call("workspace", "refresh", {}).catch(() => {
      });
      await refreshGit(ctx, project.id);
      return moved;
    },
    pickFolder: async (ctx) => ctx.host.ui.pickFolder(),
    /** Register an SSH project. Validates connectivity + remote root on that machine. */
    async addSsh(ctx, a) {
      const host = String(a.host || "").trim();
      const user = String(a.user || "").trim();
      const port = Number(a.port) || 22;
      const remotePath = String(a.remotePath || "").trim();
      const identityFile = a.identityFile ? String(a.identityFile).trim() : "";
      if (!host || !user || !remotePath.startsWith("/")) throw new Error("host, user and an absolute remote path are required");
      if (/PRIVATE KEY/.test(identityFile)) throw new Error("enter a key file path, never key contents");
      const password = a.auth === "password";
      if (password && identityFile) throw new Error("choose either a password or a key file");
      const authRef = password ? "password" : identityFile || "agent";
      const profiles = await ctx.modules.call("persistence", "ssh.list");
      let profile = profiles.find((p) => p.host === host && p.user === user && p.port === port && (p.authRef || "agent") === authRef);
      if (!profile) {
        profile = { id: crypto.randomUUID(), host, port, user, authRef };
        await ctx.modules.call("persistence", "ssh.upsert", { profile });
      }
      if (password) await ctx.host.ssh.connect(sshProfileSpec(sshFromProfile(profile)), { interactive: true });
      return registerRemote(ctx, profile, remotePath, a.name);
    },
    /** Connect a project's machine for a user gesture, which may ask for its password. */
    async connect(ctx, a) {
      const { desc, project } = await describeProject(ctx, a.projectId);
      if (desc.location === "cloud") await ctx.modules.call("cloud", "prepareProject", { projectId: project.id, origin: project.cloudOrigin }, { timeoutMs: 62e4 });
      if (desc.ssh) await ctx.host.ssh.connect(sshProfileSpec(desc.ssh), { interactive: true });
      await refreshGit(ctx, a.projectId);
      return null;
    },
    /** Installed WSL distributions (Windows), the default first. */
    wslDistributions: async (ctx) => ctx.host.ssh.wslDistributions(),
    /** Register a project inside a WSL distribution. It behaves like an SSH project, without SSH. */
    async addWsl(ctx, a) {
      const distro = String(a.distro || "").trim();
      const remotePath = String(a.remotePath || "").trim();
      if (!distro || !remotePath.startsWith("/")) throw new Error("a WSL distribution and an absolute Linux path are required");
      const profiles = await ctx.modules.call("persistence", "ssh.list");
      let profile = profiles.find((p) => p.transport === "wsl" && p.host === distro);
      if (!profile) {
        profile = { id: crypto.randomUUID(), host: distro, port: 22, user: "default", authRef: "agent", transport: "wsl" };
        await ctx.modules.call("persistence", "ssh.upsert", { profile });
      }
      return registerRemote(ctx, profile, remotePath, a.name);
    },
    async setExpanded(ctx, a) {
      await ctx.modules.call("persistence", "projects.setExpanded", { id: a.projectId, expanded: !!a.expanded });
      ctx.events.emit("projects.changed", { projectId: a.projectId });
      return null;
    },
    async gitInfo(ctx, a) {
      if (a.refresh || !gitCache.has(a.projectId)) await refreshGit(ctx, a.projectId);
      return gitCache.get(a.projectId) || null;
    },
    async refresh(ctx, a) {
      if (!a?.projectId) await ctx.modules.call("cloud", "refresh").catch(() => {
      });
      const all2 = await ctx.modules.call("persistence", "projects.list");
      await Promise.all(all2.filter((p) => a?.projectId ? p.id === a.projectId : p.kind !== "cloud" || gitCache.has(p.id)).map((p) => refreshGit(ctx, p.id)));
      return null;
    }
  }
};
var index_default = mod;
export {
  index_default as default
};
