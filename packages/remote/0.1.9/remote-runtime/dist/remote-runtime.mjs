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
var sshCache = /* @__PURE__ */ new Map();
function sshProfileSpec(ssh) {
  return { profileId: ssh.profileId, host: ssh.host, port: ssh.port, user: ssh.user, identityFile: ssh.identityFile ?? null, transport: ssh.transport ?? "ssh", ...ssh.auth ? { auth: ssh.auth } : {} };
}
function sshFromProfile(p) {
  const password = p.authRef === "password";
  return { profileId: p.id, host: p.host, port: p.port, user: p.user, identityFile: p.authRef && p.authRef !== "agent" && !password ? p.authRef : null, transport: p.transport ?? "ssh", ...password ? { auth: "password" } : {} };
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

// ../sdk/ui-controls.ts
var HEX = /^#[0-9a-fA-F]{6}$/;
function validControlValue(field, value) {
  if (typeof value !== "string") return false;
  if (value === "") return !!field.allowDefault;
  if (field.type === "color") return HEX.test(value);
  const n = Number(value);
  return Number.isFinite(n) && n >= field.min && n <= field.max;
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
        else if (field.type === "color" || field.type === "range") {
          if (!validControlValue(field, edit.value)) throw new Error(field.type === "color" ? "Enter a color as #RRGGBB" : `Choose a value from ${field.min} to ${field.max}`);
        } else if (field.type === "toggle" ? typeof edit.value !== "boolean" : typeof edit.value !== "string" || field.type === "select" && !field.options.some((o) => o.value === edit.value)) {
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

// ../sdk/platform.ts
var isPosix = (os) => os !== "windows";
function osOf(platform) {
  return platform === "windows" ? "windows" : platform === "macos" ? "macos" : platform === "linux" ? "linux" : "posix";
}
function hostOs(ctx) {
  return osOf(ctx.host?.env?.info?.().platform);
}
function workspaceOs(ctx, desc) {
  return desc.os || (desc.location === "local" ? hostOs(ctx) : "posix");
}
var PLATFORM_LABELS = { windows: "Windows", macos: "macOS", linux: "Linux" };
function parsePlatforms(raw) {
  if (!raw || typeof raw !== "object") return void 0;
  const out = {};
  for (const id of Object.keys(PLATFORM_LABELS)) {
    const e = raw[id];
    if (!e || !["supported", "untested", "unsupported"].includes(e.status)) continue;
    const requires = Array.isArray(e.requires) ? e.requires.filter((r) => typeof r?.tool === "string" && /^[a-z0-9][a-z0-9-]{0,39}$/.test(r.tool) && (r.env === void 0 || /^[A-Z][A-Z0-9_]{0,63}$/.test(r.env))).map((r) => ({ tool: r.tool, ...r.env ? { env: r.env } : {} })) : [];
    out[id] = { status: e.status, ...requires.length ? { requires } : {}, ...typeof e.note === "string" ? { note: e.note.slice(0, 500) } : {} };
  }
  return Object.keys(out).length ? out : void 0;
}
function supportOn(platforms, os) {
  const declared = os === "posix" ? void 0 : platforms?.[os];
  return declared || { status: os === "windows" ? "untested" : "supported" };
}
var pluginSupport = (plugin, os) => supportOn(parsePlatforms(plugin?.metadata?.platforms), os);
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

// ../sdk/persistent-agents.ts
var LIMITABLE_TOOL_KINDS = ["execute", "edit", "delete", "move", "fetch"];
var NO_AGENT_LIMITS = { maxConcurrent: 0, maxTurnMinutes: 0, approvalCap: "autopilot", deniedToolKinds: [], allowedProviders: [], allowedModels: [] };
var idList = (v, max = 64) => Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === "string").map((x) => x.trim()).filter((x) => x && x.length <= 200))].slice(0, max) : [];
var whole = (v, max) => Number.isInteger(v) && v > 0 ? Math.min(v, max) : 0;
function normalizeAgentLimits(value) {
  const v = value && typeof value === "object" ? value : {};
  return {
    maxConcurrent: whole(v.maxConcurrent, 64),
    maxTurnMinutes: whole(v.maxTurnMinutes, 7 * 24 * 60),
    approvalCap: v.approvalCap === "ask" || v.approvalCap === "auto-low" ? v.approvalCap : "autopilot",
    deniedToolKinds: idList(v.deniedToolKinds).filter((k) => LIMITABLE_TOOL_KINDS.includes(k)),
    allowedProviders: idList(v.allowedProviders),
    allowedModels: idList(v.allowedModels)
  };
}

// modules/services/remote-runtime/src/policy.ts
var POLICY_KEY = "remote-runtime.policy";
var ALWAYS_ALLOWED = /* @__PURE__ */ new Set(["persistence"]);
var IDLE_CHOICES = [0, 15, 60, 240, 1440];
var NO_DAEMON_LIMITS = { capabilityDeny: [], fsRoots: [], maxProcesses: 0, maxTerminals: 0, processMemoryMb: 0 };
var DEFAULT_POLICY = { limited: false, enforced: null, plugins: "all", allowed: [], readOnly: false, idleTerminalMinutes: 0, autoStart: null, autoPush: null, agents: NO_AGENT_LIMITS };
function normalizePolicy(value) {
  const v = value && typeof value === "object" ? value : {};
  const e = v.enforced && typeof v.enforced === "object" ? v.enforced : null;
  const ids = (x) => Array.isArray(x) ? x.filter((i) => typeof i === "string") : [];
  const count = (x) => Number.isInteger(x) && x > 0 ? x : 0;
  return {
    limited: v.limited === true,
    enforced: e ? { capabilityDeny: ids(e.capabilityDeny), fsRoots: ids(e.fsRoots), maxProcesses: count(e.maxProcesses), maxTerminals: count(e.maxTerminals), processMemoryMb: count(e.processMemoryMb) } : null,
    plugins: v.plugins === "selected" || v.plugins === "none" ? v.plugins : "all",
    allowed: Array.isArray(v.allowed) ? [...new Set(v.allowed.filter((id) => typeof id === "string" && id))] : [],
    readOnly: v.readOnly === true,
    idleTerminalMinutes: IDLE_CHOICES.includes(v.idleTerminalMinutes) ? v.idleTerminalMinutes : 0,
    autoStart: typeof v.autoStart === "boolean" ? v.autoStart : null,
    autoPush: typeof v.autoPush === "boolean" ? v.autoPush : null,
    agents: normalizeAgentLimits(v.agents)
  };
}
function pluginAllowed(policy, id) {
  if (ALWAYS_ALLOWED.has(id)) return true;
  return policy.plugins === "all" || policy.plugins === "selected" && policy.allowed.includes(id);
}
function pushBlocked(policy, id) {
  if (ALWAYS_ALLOWED.has(id)) return null;
  if (policy.readOnly) return "this machine is read-only";
  return pluginAllowed(policy, id) ? null : "not allowed on this machine";
}
function expiredTerminals(ptys, seen, now, minutes) {
  const present = new Set(ptys.map((p) => p.key));
  for (const key of [...seen.keys()]) if (!present.has(key)) seen.delete(key);
  const expired = [];
  for (const p of ptys) {
    if (p.attached) {
      seen.delete(p.key);
      continue;
    }
    const since = seen.get(p.key) ?? now;
    seen.set(p.key, since);
    if (minutes > 0 && now - since >= minutes * 6e4) expired.push(p.key);
  }
  return expired;
}
function effectivePolicy(policy) {
  return policy.limited ? policy : { ...DEFAULT_POLICY, autoStart: policy.autoStart, autoPush: policy.autoPush };
}

// modules/services/remote-runtime/src/index.ts
var autoStart = true;
var sweepTimer = null;
var detachedSince = /* @__PURE__ */ new Map();
async function savedPolicy(ctx, machineId) {
  const saved = await ctx.modules.call("persistence", "scoped.get", { scope: `machine:${machineId}`, key: POLICY_KEY }).catch(() => null);
  return normalizePolicy(saved?.value);
}
async function policyFor(ctx, machineId) {
  return effectivePolicy(await savedPolicy(ctx, machineId));
}
async function storePolicy(ctx, machineId, policy) {
  await ctx.modules.call("persistence", "scoped.set", { scope: `machine:${machineId}`, key: POLICY_KEY, value: policy });
}
var autoPush = true;
var lastError = /* @__PURE__ */ new Map();
var connected = /* @__PURE__ */ new Map();
var tunnels = /* @__PURE__ */ new Map();
var syncing = /* @__PURE__ */ new Map();
var ensuredMachines = /* @__PURE__ */ new Set();
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
  const target = await daemonTargetFor(ctx, d);
  return { d, target };
}
async function enabledWorkspacePlugins(ctx) {
  const { plugins } = await ctx.host.plugins.list();
  return plugins.filter((p) => p.enabled && p.kind === "service" && p.runsOn === "workspace");
}
async function workspacePlugins(ctx, d, policy) {
  const os = workspaceOs(ctx, d), rules = policy || await policyFor(ctx, d.machineId);
  return (await enabledWorkspacePlugins(ctx)).filter((p) => pluginSupport(p, os).status !== "unsupported" && pluginAllowed(rules, p.id));
}
async function skippedPlugins(ctx, d, policy) {
  const os = workspaceOs(ctx, d);
  return (await enabledWorkspacePlugins(ctx)).flatMap((p) => {
    const s = pluginSupport(p, os);
    if (s.status === "unsupported" && os !== "posix") return [{ id: p.id, reason: `not supported on ${PLATFORM_LABELS[os]}${s.note ? `: ${s.note}` : ""}` }];
    return pluginAllowed(policy, p.id) ? [] : [{ id: p.id, reason: "not allowed by this machine's policy" }];
  });
}
async function sweepIdle(ctx) {
  for (const [machineId, target] of connected) {
    const policy = await policyFor(ctx, machineId);
    const seen = detachedSince.get(machineId) || /* @__PURE__ */ new Map();
    detachedSince.set(machineId, seen);
    if (!policy.idleTerminalMinutes) {
      seen.clear();
      continue;
    }
    try {
      if (!await ctx.host.daemon.status(target)) continue;
      const hello = await ctx.host.daemon.request(target, "hello");
      const expired = expiredTerminals(hello?.resources?.ptys || [], seen, Date.now(), policy.idleTerminalMinutes);
      for (const key of expired) {
        await ctx.host.daemon.request(target, "pty.kill", { key }).catch((e) => ctx.log.warn("idle cleanup", key, errMsg(e)));
        seen.delete(key);
      }
      if (expired.length) {
        ctx.log.info(`Stopped ${expired.length} idle terminal(s) on ${machineId}`);
        ctx.events.emit("remote-runtime.changed", { machineId });
      }
    } catch (e) {
      ctx.log.warn("idle cleanup", machineId, errMsg(e));
    }
  }
}
var limitsError = /* @__PURE__ */ new Map();
async function sendAgentLimits(ctx, machineId, target, policy) {
  try {
    const hello = await ctx.host.daemon.request(target, "hello");
    if (!(hello?.plugins || []).some((p) => p.id === "agent-runner" && p.enabled !== false)) {
      limitsError.delete(machineId);
      return;
    }
    await ctx.host.daemon.request(target, "modules.call", { target: "agent-runner", method: "setLimits", args: { limits: policy.agents } });
    limitsError.delete(machineId);
  } catch (e) {
    limitsError.set(machineId, `Agent limits not applied: ${errMsg(e)}`);
    ctx.log.warn("agent limits", machineId, errMsg(e));
  }
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
    const policy = await policyFor(ctx, d.machineId);
    if ((policy.autoPush ?? autoPush) && !policy.readOnly) for (const p of await workspacePlugins(ctx, d, policy)) {
      try {
        await ctx.host.daemon.request(target, "plugins.push", { id: p.id });
        pushed.push(p.id);
      } catch (e) {
        lastError.set(d.machineId, `${p.id}: ${errMsg(e)}`);
      }
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
    ctx.state.watch("workspace.selected", (ws) => {
      if (ws?.location !== "ssh" || !ws.id || !ws.machineId) return;
      const machineId = String(ws.machineId);
      if (ensuredMachines.has(machineId)) return;
      ensuredMachines.add(machineId);
      policyFor(ctx, machineId).then((policy) => {
        if (!(policy.autoStart ?? autoStart)) {
          ensuredMachines.delete(machineId);
          return;
        }
        return ensure(ctx, String(ws.id));
      }).catch((e) => {
        ensuredMachines.delete(machineId);
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
    sweepTimer = setInterval(() => {
      void sweepIdle(ctx);
    }, 6e4);
    ctx.events.on("kernel.modules.changed", () => {
      const ws = ctx.state.get("workspace.selected");
      if (ws?.location === "ssh" && ws.id) resolve(ctx, ws.id).then(async ({ d, target }) => {
        if (!await ctx.host.daemon.status(target)) return;
        const policy = await policyFor(ctx, d.machineId);
        if (policy.readOnly || !(policy.autoPush ?? autoPush)) return;
        for (const p of await workspacePlugins(ctx, d, policy)) await ctx.host.daemon.request(target, "plugins.push", { id: p.id }).catch(() => {
        });
        await sendAgentLimits(ctx, d.machineId, target, policy);
      }).catch(() => {
      });
    });
  },
  deactivate() {
    if (sweepTimer) clearInterval(sweepTimer);
    sweepTimer = null;
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
    async policy(ctx, a) {
      const { d } = await resolve(ctx, String(a.workspaceId));
      return policyFor(ctx, d.machineId);
    },
    /** Replace the machine's policy. Already-running plugins are not stopped; the panel offers that. */
    async setPolicy(ctx, a) {
      const { d, target } = await resolve(ctx, String(a.workspaceId));
      const before = await savedPolicy(ctx, d.machineId);
      let policy = normalizePolicy(a.policy);
      const running = !!await ctx.host.daemon.status(target).catch(() => null);
      if (before.limited !== policy.limited && running) {
        if (!policy.limited) {
          const current = await ctx.host.daemon.request(target, "policy.get").catch(() => null);
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
      const r = await ctx.host.daemon.request(target, "policy.set", { policy: a.policy });
      await storePolicy(ctx, d.machineId, { ...saved, enforced: r.policy });
      ctx.events.emit("remote-runtime.changed", { machineId: d.machineId });
      return r;
    },
    /** Stop plugins running on the daemon that the machine's policy no longer allows. */
    async stopDisallowed(ctx, a) {
      const { d, target } = await resolve(ctx, String(a.workspaceId));
      const policy = await policyFor(ctx, d.machineId);
      const remote = (await ctx.host.daemon.request(target, "plugins.list"))?.plugins || [];
      const stopped = [], failed = [];
      for (const p of remote.filter((p2) => p2.enabled !== false && !pluginAllowed(policy, String(p2.id)))) {
        try {
          await ctx.host.daemon.request(target, "plugins.disable", { id: String(p.id) });
          stopped.push(String(p.id));
        } catch (e) {
          failed.push(`${p.id} (${errMsg(e)})`);
        }
      }
      ctx.events.emit("remote-runtime.changed", { machineId: d.machineId });
      if (failed.length) throw new Error(`Could not stop ${failed.join(", ")}`);
      return { stopped };
    },
    async status(ctx, a) {
      const { d, target } = await resolve(ctx, String(a.workspaceId));
      const daemon = await ctx.host.daemon.status(target);
      const saved = await savedPolicy(ctx, d.machineId), policy = effectivePolicy(saved);
      const base = {
        machineId: d.machineId,
        location: d.location,
        error: lastError.get(d.machineId) || null,
        policy: saved,
        defaults: { autoStart, autoPush },
        limitsError: limitsError.get(d.machineId) || null,
        available: (await enabledWorkspacePlugins(ctx)).map((p) => ({ id: p.id, name: p.name || p.id })),
        candidates: (await workspacePlugins(ctx, d, policy)).map((p) => p.id),
        skipped: await skippedPlugins(ctx, d, policy)
      };
      if (!daemon) {
        ensuredMachines.delete(d.machineId);
        return { ...base, running: false };
      }
      try {
        const hello = await ctx.host.daemon.request(target, "hello");
        const stale = !!daemon.status?.stale || d.location === "cloud" && !hello.features?.includes("fs");
        const enforced = await ctx.host.daemon.request(target, "policy.get").then((r) => ({ policy: r.policy, denials: r.denials || [], error: null })).catch((e) => ({ policy: null, denials: [], error: /unknown daemon op|not available/.test(errMsg(e)) ? "This daemon is older than enforced limits. Use Force upgrade to replace it." : errMsg(e) }));
        return { ...base, running: true, version: hello.version, pid: hello.pid, stale, resources: hello.resources, plugins: hello.plugins, enforced };
      } catch (e) {
        ensuredMachines.delete(d.machineId);
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
      const remote = (await ctx.host.daemon.request(target, "plugins.list"))?.plugins || [];
      const ids = [.../* @__PURE__ */ new Set([
        ...d.location === "ssh" ? ["persistence"] : [],
        ...remote.filter((p) => p.enabled !== false && local.some((l) => l.id === p.id) && pluginAllowed(policy, String(p.id))).map((p) => String(p.id)),
        ...(await workspacePlugins(ctx, d, policy)).map((p) => p.id)
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
    async upgradeProfiles(ctx) {
      const profiles = await ctx.modules.call("persistence", "ssh.list");
      return profiles.filter((p) => p.transport !== "wsl").map((p) => ({ id: p.id, label: `${p.user}@${p.host}:${p.port}` }));
    },
    async forceUpgrade(ctx, a) {
      const d = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
      if (d.location === "local") {
        try {
          const upgraded = await ctx.host.daemon.forceUpgrade({ kind: "local" });
          lastError.delete(d.machineId);
          await ensure(ctx, String(a.workspaceId)).catch((e) => lastError.set(d.machineId, errMsg(e)));
          ctx.events.emit("remote-runtime.updated", { machineId: d.machineId, plugins: [] });
          return upgraded;
        } finally {
          ctx.events.emit("remote-runtime.changed", { machineId: d.machineId });
        }
      }
      try {
        let ssh = d.ssh;
        let cloud;
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
    }
  }
};
var index_default = mod;
export {
  index_default as default
};
