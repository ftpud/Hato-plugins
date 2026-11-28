// ../sdk/prompt-history.ts
var PROMPT_CHARS = 600;
function promptTurns(messages, base) {
  const out = [];
  let current = null;
  let byPath = /* @__PURE__ */ new Map();
  for (const m of messages) {
    if (m.role === "user") {
      const prompt = String(m.text || "").trim();
      if (!prompt) continue;
      current = { ...base, id: `${base.source}:${base.sessionId}:${m.key}`, prompt: prompt.slice(0, PROMPT_CHARS), at: m.at ?? null, files: [] };
      byPath = /* @__PURE__ */ new Map();
      out.push(current);
      continue;
    }
    if (!current || !Array.isArray(m.diffs)) continue;
    for (const d of m.diffs) {
      if (!d || typeof d.path !== "string") continue;
      let file = byPath.get(d.path);
      if (!file) {
        file = { path: d.path, added: 0, removed: 0, edits: [], ...d.newFile ? { newFile: true } : {} };
        byPath.set(d.path, file);
        current.files.push(file);
      }
      file.added += Number(d.added) || 0;
      file.removed += Number(d.removed) || 0;
      if (d.truncated) file.truncated = true;
      file.edits.push(d);
    }
  }
  return out;
}
function epochOf(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value < 1e12 ? value * 1e3 : value;
  if (typeof value === "string" && value) {
    const n = Date.parse(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// ../sdk/change-capture.ts
var CAPTURE_SETTING = "files.changesEnabled";
var CAPTURE_STATE = "files.changeCapture";
var captureEnabled = (ctx) => ctx.state.get(CAPTURE_SETTING) !== false;
function capturedChanges(ctx, workspaceId) {
  const state = ctx.state.get(CAPTURE_STATE);
  return captureEnabled(ctx) && state?.workspaceId === workspaceId ? state.records : [];
}
var normalizePath = (path) => path.replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^(\.\/)+/, "").replace(/\/$/, "");
var isWindowsPath = (path) => /^[a-zA-Z]:\//.test(path);
function pathMatcher(paths) {
  const wanted = [...paths].map(normalizePath).filter(Boolean);
  return (path) => {
    const p = normalizePath(path);
    return wanted.some((w) => {
      const fold = isWindowsPath(p) || isWindowsPath(w);
      const a = fold ? p.toLowerCase() : p, b = fold ? w.toLowerCase() : w;
      return a === b || a.endsWith("/" + b) || b.endsWith("/" + a);
    });
  };
}
function capturedTranscript(messages, records, source, sessionId) {
  const result = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    result.push(message);
    if (message.role !== "user") continue;
    let end = i + 1;
    while (end < messages.length && messages[end].role !== "user") end++;
    const changes = records.filter((r) => r.owner?.source === source && r.owner.sessionId === sessionId && r.owner.key === message.key);
    const paths = new Set(changes.flatMap((r) => r.diffs.map((d) => d.path)));
    const captured = pathMatcher(paths);
    const anchored = /* @__PURE__ */ new Map();
    for (const change of changes) {
      const changed = pathMatcher(change.diffs.map((diff) => diff.path));
      let anchor = i;
      let matching = -1;
      for (let j = i + 1; j < end; j++) {
        const candidate = messages[j];
        if (candidate.role !== "tool") continue;
        const at = candidate.at;
        const timestamp = typeof at === "string" ? Date.parse(at) : at;
        if (timestamp !== void 0 && timestamp > change.at) continue;
        anchor = j;
        if (candidate.diffs?.some((diff) => changed(diff.path))) matching = j;
      }
      if (matching >= 0) anchor = matching;
      const group = anchored.get(anchor) || [];
      group.push(change);
      anchored.set(anchor, group);
    }
    const cards = (index) => (anchored.get(index) || []).map((change) => ({
      key: "capture:" + change.id,
      role: "tool",
      title: "Project file changes",
      text: "",
      status: "completed",
      diffs: change.diffs
    }));
    result.push(...cards(i));
    for (let j = i + 1; j < end; j++) {
      const original = messages[j];
      result.push(paths.size && original.diffs ? { ...original, diffs: original.diffs.filter((d) => !captured(d.path)) } : original);
      result.push(...cards(j));
    }
    i = end - 1;
  }
  return result;
}

// ../sdk/platform.ts
var isPosix = (os) => os !== "windows";
function osOf(platform) {
  return platform === "windows" ? "windows" : platform === "macos" ? "macos" : platform === "linux" ? "linux" : "posix";
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

// ../sdk/agent-providers.ts
function agentProviders(plugins, enabledOnly = true) {
  const out = [], seen = /* @__PURE__ */ new Set(), profiles = /* @__PURE__ */ new Set();
  for (const plugin of plugins) {
    if (enabledOnly && !plugin.enabled) continue;
    const definitions = plugin.contributes?.agentProviders;
    if (!Array.isArray(definitions)) continue;
    for (const raw of definitions) {
      if (!raw || typeof raw.id !== "string" || seen.has(raw.id) || typeof raw.name !== "string" || typeof raw.profile?.id !== "string" || profiles.has(raw.profile.id) || typeof raw.profile?.name !== "string" || typeof raw.profile?.executable !== "string" || !Array.isArray(raw.profile.args) || !raw.profile.args.every((v) => typeof v === "string") || typeof raw.adapter?.pkg !== "string" || !/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(raw.adapter.pkg) || typeof raw.adapter?.bin !== "string") continue;
      if (raw.auth && (typeof raw.auth.key !== "string" || typeof raw.auth.field !== "string" || typeof raw.auth.label !== "string" || typeof raw.auth.default !== "boolean" || !Array.isArray(raw.auth.envRemove) || !raw.auth.envRemove.every((key) => typeof key === "string"))) continue;
      profiles.add(raw.profile.id);
      seen.add(raw.id);
      out.push({ ...raw, platforms: parsePlatforms(raw.platforms), module: plugin.id });
    }
  }
  return out;
}
async function providerProfiles(ctx) {
  const { plugins } = await ctx.host.plugins.list();
  const available = agentProviders(plugins);
  const saved = await ctx.modules.call("persistence", "acpProfiles.list");
  const rows = saved.filter((p) => !p.provider || p.provider === "custom" || available.some((d) => d.id === p.provider));
  for (const definition of available) {
    if (!rows.some((p) => p.id === definition.profile.id)) rows.push({
      ...definition.profile,
      provider: definition.id,
      machineId: "*",
      enabled: true,
      envRefs: {}
    });
  }
  return rows.map((p) => {
    const definition = available.find((d) => d.id === p.provider);
    return {
      ...p,
      providerModule: definition?.module,
      mcpLaunch: definition?.mcpLaunch,
      authOption: definition?.auth,
      platforms: definition?.platforms
    };
  });
}

// ../sdk/persistent-agents.ts
function modelChoices(state) {
  const option = state.configOptions?.find((o) => o.category === "model");
  if (option) {
    const flatten = (options) => options.flatMap((o) => Array.isArray(o.options) ? flatten(o.options) : [o]);
    return flatten(option.options || []).map((o) => ({ id: String(o.value), label: o.name || String(o.value), configId: option.id }));
  }
  return (state.models?.availableModels || []).map((m) => ({ id: m.modelId, label: m.name || m.modelId, configId: "__model" }));
}
function relativeAgentPath(value) {
  if (typeof value !== "string" || !value || value.startsWith("/") || value.includes("\\") || value.split("/").some((p) => p === ".." || !p)) throw new Error("Expected a workspace-relative instruction path");
  return value;
}
function agentActivity(view) {
  const compact = (value) => value.replace(/\s+/g, " ").trim();
  const tail = (value) => {
    const text = compact(value);
    return text.length > 180 ? "…" + text.slice(-179) : text;
  };
  if (view.session.error) return "Error: " + tail(view.session.error);
  if (view.session.status === "waiting") return "Awaiting approval: " + tail(view.permissions[0]?.request?.toolCall?.title || "Agent tool request");
  if (view.session.status === "starting") return "Connecting to provider…";
  const latest = [...view.messages].reverse().find((m) => m.role !== "system" && (compact(m.text || "") || m.title));
  if (latest?.role === "tool") return tail([latest.title || "Tool", latest.status, latest.text].filter(Boolean).join(" · "));
  if (latest?.role === "thought") return "Thinking: " + tail(latest.text);
  if (latest?.role === "user" && view.session.status === "busy") return "Working on: " + tail(latest.text);
  if (latest) return tail(latest.text);
  return view.session.status === "busy" ? "Working…" : view.session.status === "ready" ? "Ready for a prompt" : view.session.status;
}
function agentSettings(value) {
  const out = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [k, v] of Object.entries(value).slice(0, 32))
    if (k && k.length <= 200 && (typeof v === "boolean" || typeof v === "string" && v.length <= 500)) out[k] = v;
  return out;
}
function providerLabel(profile) {
  const name = String(profile?.name || profile?.provider || "Agent").replace(/\s*\([^)]*\)\s*$/, "").trim();
  return name || "Agent";
}
function currentModel(s) {
  const option = s.configOptions?.find((o) => o.category === "model");
  return String(option?.currentValue ?? s.models?.currentModelId ?? s.model ?? "");
}
function autoAgentName(s) {
  const provider = providerLabel(s.profile), id = currentModel(s);
  const model = id ? modelChoices(s).find((m) => m.id === id)?.label || id : "";
  return (model ? `${provider}/${model}` : provider).slice(0, 120);
}
function isAutoAgentName(s) {
  if (typeof s.customName === "boolean") return !s.customName;
  const provider = providerLabel(s.profile), full = String(s.profile?.name || "");
  if (["Chat", "Agent", provider, full].includes(s.name)) return true;
  const [head, ...rest] = s.name.split("/"), model = rest.join("/");
  if (!model || head !== provider && head !== full) return false;
  return model === currentModel(s) || modelChoices(s).some((m) => m.label === model || m.id === model) || model === s.model;
}

// ../sdk/acp-subagents.ts
var hasWorkingSubagents = (children) => Object.values(children || {}).some((c) => c.state === "running" || c.state === "requires_action");
function subagentList(children) {
  return Object.values(children || {}).slice(0, 200).map(({ progressTail, ...child }) => child);
}
function trackFinishedSubagents(store, prev, now, childrenOf, at = Date.now(), ttl = 15e3) {
  let changed = false;
  for (const id of prev) if (!now.has(id)) {
    const children = childrenOf(id);
    if (children?.length) {
      store.set(id, { id, children, at });
      changed = true;
    }
  }
  for (const [id, entry] of store) if (now.has(id) || at - entry.at > ttl) {
    store.delete(id);
    changed = true;
  }
  return changed;
}

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
async function daemonTargetFor(ctx, desc) {
  switch (desc.location) {
    case "local":
      return { kind: "local" };
    case "ssh":
      return { kind: "ssh", connection: (await sshConnect(ctx, desc)).connection };
    case "cloud": {
      if (!desc.cloudHostId) throw new Error("Cloud workspace is missing its host.");
      const target2 = await ctx.modules.call("cloud", "target", {
        hostId: desc.cloudHostId,
        machineId: desc.machineId
      }, { timeoutMs: 62e4 });
      if (target2?.kind !== "cloud" || !target2.connection) throw new Error("Invalid Cloud daemon route.");
      return target2;
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
      const target2 = cloud ?? await targetFor(ctx, desc);
      return ctx.host.capabilities.request({ kind, root: r, target: target2 });
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

// modules/services/files/src/skills.ts
function metadata(text, key) {
  const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1];
  if (!header) return "";
  const lines = header.split(/\r?\n/);
  const index = lines.findIndex((line) => line.startsWith(key + ":"));
  if (index < 0) return "";
  const value = lines[index].slice(key.length + 1).trim();
  if (/^[>|][-+]?\s*$/.test(value)) {
    const continuation = [];
    for (const line of lines.slice(index + 1)) {
      if (line && !/^\s/.test(line)) break;
      continuation.push(line.trim());
    }
    return continuation.join(" ").trim();
  }
  return value.replace(/^(["'])([\s\S]*)\1$/, "$2");
}
async function workspaceSkills(ctx, desc) {
  return withWorkspace(ctx, desc, async () => {
    const grant = await workspaceGrant(ctx, desc, "fs");
    let entries;
    try {
      entries = (await ctx.host.fs.list(grant.grant, ".agents/skills")).entries;
    } catch (e) {
      if (["ENOENT", "ENOTDIR"].includes(e?.code)) return [];
      throw e;
    }
    const skills = [];
    for (const entry of entries.filter((e) => ["dir", "symlink"].includes(e.kind)).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = `.agents/skills/${entry.name}/SKILL.md`;
      try {
        const file = await ctx.host.fs.read(grant.grant, path, 64 * 1024);
        if (file.binary || !file.text || file.truncated) continue;
        skills.push({ name: metadata(file.text, "name") || entry.name, description: metadata(file.text, "description"), path });
      } catch (e) {
        if (!["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(e?.code)) throw e;
      }
    }
    return skills;
  });
}

// ../sdk/images.ts
function imageAttachments(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 4) throw new Error("Attach up to 4 pictures.");
  let total = 0;
  return value.map((image) => {
    if (!image || !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(image.mimeType) || typeof image.data !== "string" || !image.data.length || image.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) throw new Error("Invalid image attachment. Use PNG, JPEG, WebP or GIF.");
    const size = image.data.length / 4 * 3 - (image.data.endsWith("==") ? 2 : image.data.endsWith("=") ? 1 : 0);
    total += size;
    if (size > 5 * 1024 * 1024 || total > 10 * 1024 * 1024) throw new Error("Pictures must be under 5 MB each and 10 MB combined.");
    return { name: String(image.name || "Picture").slice(0, 180), mimeType: image.mimeType, data: image.data };
  });
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

// ../sdk/mcp-servers.ts
var transportOf = (m) => m.transport === "http" || m.transport === "sse" ? m.transport : "stdio";
var isPair = (v) => v && typeof v.name === "string" && typeof v.value === "string";
function parseHttpUrl(url) {
  const m = /^(https?):\/\/([^/?#@\s]+)([^?#\s]*)(?:\?[^#\s]*)?(?:#\S*)?$/i.exec(String(url || "").trim());
  if (!m) return null;
  const scheme = m[1].toLowerCase(), host = m[2].toLowerCase();
  return { scheme, host, origin: `${scheme}://${host}`, path: m[3] || "/" };
}
var isLoopbackHost = (host) => /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host);
function validateMcp(value) {
  if (!value || typeof value.id !== "string" || !value.id || typeof value.name !== "string") throw new Error("MCP requires id and name");
  if (value.id.startsWith("internal-") || value.id.length > 120) throw new Error("Reserved or invalid MCP server id");
  const name = value.name.trim();
  if (!name) throw new Error("Server name is required");
  if (value.enabled !== void 0 && typeof value.enabled !== "boolean") throw new Error("Enabled must be a boolean");
  const transport = transportOf(value);
  const base = { id: value.id, name, transport, enabled: value.enabled !== false };
  if (transport === "stdio") {
    if (typeof value.command !== "string" || !value.command.trim()) throw new Error("Command is required");
    if (!Array.isArray(value.args) || !value.args.every((a2) => typeof a2 === "string")) throw new Error("Arguments must be strings");
    const env = Array.isArray(value.env) ? value.env : [];
    const names = /* @__PURE__ */ new Set();
    for (const item of env) {
      if (!isPair(item) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(item.name) || names.has(item.name)) throw new Error("Environment variable names must be valid and unique");
      names.add(item.name);
    }
    return { ...base, command: value.command.trim(), args: value.args, env };
  }
  const url = parseHttpUrl(value.url);
  if (!url) throw new Error("Enter an http(s) URL for the remote server");
  if (url.scheme === "http" && !isLoopbackHost(url.host)) throw new Error("Remote servers must use https (plain http is allowed only for localhost)");
  const headers = Array.isArray(value.headers) ? value.headers : [];
  const seen = /* @__PURE__ */ new Set();
  for (const h of headers) {
    if (!isPair(h) || !/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(h.name) || seen.has(h.name.toLowerCase())) throw new Error("Header names must be valid and unique");
    seen.add(h.name.toLowerCase());
  }
  const a = value.auth || {};
  const type = a.type === "oauth" || a.type === "bearer" ? a.type : "none";
  if (type !== "none" && seen.has("authorization")) throw new Error("Remove the Authorization header or set authentication to None");
  const auth = { type };
  if (type === "bearer") {
    if (typeof a.token !== "string" || !a.token.trim()) throw new Error("Enter the bearer token");
    auth.token = a.token.trim();
  }
  if (type === "oauth") {
    for (const k of ["clientId", "clientSecret", "scopes"]) if (typeof a[k] === "string" && a[k].trim()) auth[k] = a[k].trim();
    if (a.redirectPort !== void 0 && a.redirectPort !== null && a.redirectPort !== "") {
      const port = Number(a.redirectPort);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Redirect port must be 1024–65535");
      auth.redirectPort = port;
    }
  }
  return { ...base, command: "", args: [], env: [], url: String(value.url).trim(), headers, auth };
}
function acpServer(m, authorization) {
  const transport = transportOf(m);
  if (transport === "stdio") return { name: m.name, command: m.command, args: m.args, env: m.env };
  const headers = [...m.headers || []];
  const auth = authorization ?? (m.auth?.type === "bearer" && m.auth.token ? `Bearer ${m.auth.token}` : null);
  if (auth) headers.push({ name: "Authorization", value: auth });
  return { type: transport, name: m.name, url: m.url, headers };
}

// ../sdk/library.ts
var LIBRARY_STATE = "library.catalog";
var LIBRARY_PREFIX = "library:";
var libraryRef = (id) => LIBRARY_PREFIX + id;
var isLibraryRef = (path) => typeof path === "string" && path.startsWith(LIBRARY_PREFIX);
var libraryRefId = (path) => path.slice(LIBRARY_PREFIX.length);
function libraryCatalog(value) {
  const v = value;
  return { items: Array.isArray(v?.items) ? v.items : [], machines: Array.isArray(v?.machines) ? v.machines : [] };
}
function libraryOffered(item, ws) {
  if (item.projectId) return item.projectId === ws.projectId;
  return !item.machines?.length || item.machines.includes(ws.machineId);
}
function libraryItemsFor(value, ws, kind) {
  if (!ws) return [];
  return libraryCatalog(value).items.filter((i) => i.kind === kind && libraryOffered(i, ws)).sort((a, b) => Number(!a.projectId) - Number(!b.projectId) || a.name.localeCompare(b.name));
}
function libraryInstructions(item) {
  const scope = item.projectId ? "project" : "global";
  const extra = item.paths.filter((p) => p !== "SKILL.md" && p !== "AGENT.md");
  return item.text + (extra.length ? `

(Library ${item.kind} "${item.name}" also has these files: ${extra.join(", ")}. Read them with the Library read tool, scope "${scope}", id "${item.id}", when needed.)` : "");
}
function textDigest(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36) + ":" + text.length.toString(36);
}

// modules/services/persistent-agents/src/index.ts
var activityCache = /* @__PURE__ */ new Map();
var daemonInfo = /* @__PURE__ */ new Map();
var prepared = /* @__PURE__ */ new Map();
async function target(ctx, workspaceId) {
  const d = await ctx.modules.call("workspace", "resolve", { workspaceId });
  let pending = prepared.get(d.machineId);
  if (!pending) {
    pending = (async () => {
      const t = await daemonTargetFor(ctx, d);
      const info = await ctx.host.daemon.ensure(t);
      daemonInfo.set(d.machineId, { bin: info.bin, dir: info.dir });
      const result = await ctx.host.daemon.request(t, "plugins.list");
      const mcp = result.plugins.find((p) => p.id === "internal-remote-mcp");
      if (!mcp?.active) await ctx.host.daemon.request(t, "plugins.push", { id: "internal-remote-mcp" });
      const runtime = result.plugins.find((p) => p.id === "agent-runner");
      if (!runtime?.active) {
        const pushed = await ctx.host.daemon.request(t, "plugins.push", { id: "agent-runner" });
        if (!pushed.active) throw new Error(pushed.error || "Agent runtime did not activate");
      }
      return t;
    })();
    prepared.set(d.machineId, pending);
    if (!daemonPoll) {
      daemonPoll = setInterval(() => {
        void pollDaemons(ctx);
      }, 2e3);
      daemonPoll.unref?.();
    }
    void pending.catch(() => {
      prepared.delete(d.machineId);
    });
  }
  return pending;
}
async function invoke(ctx, workspaceId, method, args = {}) {
  const t = await target(ctx, workspaceId);
  try {
    return await ctx.host.daemon.request(t, "modules.call", { target: "agent-runner", method, args, timeoutMs: 18e4 });
  } catch (e) {
    if (e?.code === "ENOMETHOD" || /has no method/.test(String(e?.message || e)))
      throw new Error("This machine's background agent runtime is older than Hato and lacks this setting. Use “Update runtime” in the chat settings (or Force update in the Remote runtime panel), then try again.");
    const d = await ctx.modules.call("workspace", "resolve", { workspaceId });
    prepared.delete(d.machineId);
    throw e;
  }
}
async function mcps(ctx) {
  return await ctx.modules.call("persistence", "settings.get", { key: "persistent-agents.mcps" }) || [];
}
var builtInMcps = [
  { id: "internal-remote-mcp", name: "Workspace tools", builtin: true, description: "Daemon-hosted background agent, terminal and selected-skill tools. Works without the desktop." },
  { id: "internal-remote-mcp-local", name: "Local workspace tools", builtin: true, description: "Workspace tools for ordinary local desktop terminals. Available to local workspaces while the desktop is open." },
  { id: "internal-local-mcp", name: "Desktop tools", builtin: true, description: "UI and application module tools. Requires the desktop to remain open." }
];
var mcpWrites = Promise.resolve();
function editMcps(ctx, edit) {
  const next = mcpWrites.catch(() => {
  }).then(async () => {
    const value = edit(await mcps(ctx));
    await ctx.modules.call("persistence", "settings.set", { key: "persistent-agents.mcps", value });
    ctx.events.emit("persistent-agents.mcpsChanged", {});
  });
  mcpWrites = next;
  return next;
}
async function oauthHeaders(ctx, list) {
  const out = {};
  for (const m of list) if (transportOf(m) !== "stdio" && m.auth?.type === "oauth") {
    try {
      out[m.id] = await ctx.modules.call("mcp-auth", "authorization", { serverId: m.id, url: m.url }, { timeoutMs: 6e4 });
    } catch (e) {
      throw new Error(`MCP server “${m.name}” needs you to sign in: open MCP servers and choose Sign in (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  return out;
}
async function catalog(ctx, workspaceId) {
  const d = await ctx.modules.call("workspace", "resolve", { workspaceId });
  const profiles = (await providerProfiles(ctx)).filter((p) => p.enabled && (p.machineId === "*" || p.machineId === d.machineId));
  const library = ctx.state.get(LIBRARY_STATE);
  const libraryText = /* @__PURE__ */ new Map();
  const fromLibrary = (kind) => libraryItemsFor(library, d, kind).map((i) => {
    libraryText.set(libraryRef(i.id), libraryInstructions(i));
    return { name: i.name, description: i.description, path: libraryRef(i.id), source: i.projectId ? "library-project" : "library-global" };
  });
  const workspaceEntries = d.location === "cloud" ? [] : await workspaceSkills(ctx, d);
  const skills = [...workspaceEntries.map((s) => ({ ...s, source: "workspace" })), ...fromLibrary("skill")];
  const agentFiles = [];
  if (d.location !== "cloud") {
    const grant = await workspaceGrant(ctx, d, "fs");
    try {
      if ((await ctx.host.fs.stat(grant.grant, "AGENTS.md")).kind === "file") agentFiles.push({ name: "AGENTS.md", path: "AGENTS.md" });
    } catch {
    }
    for (const dir of [".agents/agents", ".claude/agents"]) {
      let entries;
      try {
        entries = (await ctx.host.fs.list(grant.grant, dir)).entries;
      } catch {
        continue;
      }
      for (const e of entries) if (e.kind === "file" && e.name.endsWith(".md")) agentFiles.push({ name: e.name, path: `${dir}/${e.name}` });
    }
  }
  agentFiles.push(...fromLibrary("agent").map((a) => ({ name: `Library · ${a.name}`, path: a.path })));
  return { workspace: d, profiles, skills, agentFiles, libraryText, mcps: [
    { id: "internal-remote-mcp", name: "Workspace tools (background agents and terminals)" },
    ...d.location === "local" ? [{ id: "internal-remote-mcp-local", name: "Workspace tools · local desktop terminals (online only)" }] : [],
    ...d.location === "cloud" ? [] : [{ id: "internal-local-mcp", name: "Desktop tools (requires desktop online)" }],
    ...(await mcps(ctx)).filter((m) => m.enabled !== false)
  ] };
}
function libraryInline(c, paths) {
  const inline = {};
  for (const p of paths) if (isLibraryRef(p)) {
    const text = c.libraryText.get(p);
    if (text === void 0) throw new Error("A selected Library entry is not available on this machine");
    inline[p] = text;
  }
  return inline;
}
var agentMcpIds = (s) => [...s.workspaceMcp ? ["internal-remote-mcp"] : [], ...s.mcps.map((m) => m.id)];
function agentSelection(c, a) {
  const profile = c.profiles.find((p) => p.id === a.profileId);
  if (!profile) throw new Error("Select an enabled provider for this machine");
  const skills = (Array.isArray(a.skills) ? a.skills : []).map(relativeAgentPath);
  if (skills.some((p) => !c.skills.some((s) => s.path === p))) throw new Error("Selected skill is no longer available");
  const agentFile = a.agentFile ? relativeAgentPath(a.agentFile) : null;
  if (agentFile && !c.agentFiles.some((f) => f.path === agentFile)) throw new Error("Selected agent file is no longer available");
  const ids = Array.isArray(a.mcps) ? a.mcps : [];
  if (ids.some((id) => !c.mcps.some((m) => m.id === id))) throw new Error("Unknown MCP server");
  return { profile, model: String(a.model || ""), agentFile, skills, ids };
}
async function agentConfig(ctx, c, selection, sessionId) {
  const { profile, model, agentFile, skills, ids } = selection;
  const inline = libraryInline(c, [agentFile, ...skills]);
  await target(ctx, c.workspace.id);
  const chosen = (await mcps(ctx)).filter((m) => m.enabled !== false && ids.includes(m.id));
  const auth = await oauthHeaders(ctx, chosen);
  const servers = chosen.map((m) => ({ id: m.id, ...acpServer(m, auth[m.id]) }));
  servers.push(...await desktopEndpoints(ctx, c.workspace.id, sessionId, ids, [agentFile, ...skills], inline));
  return { profile, model, agentFile, skills, mcps: servers, workspaceMcp: ids.includes("internal-remote-mcp"), inline };
}
var DESKTOP_MCP_IDS = ["internal-remote-mcp-local", "internal-local-mcp"];
async function desktopEndpoints(ctx, workspaceId, sessionId, ids, skillPaths, inline) {
  const servers = [];
  if (ids.includes("internal-remote-mcp-local")) {
    const endpoint = await ctx.modules.call("internal-remote-mcp", "endpoint", { workspaceId, sessionId, skills: [...new Set(skillPaths.filter(Boolean))], inline });
    servers.push({ ...endpoint, id: "internal-remote-mcp-local", name: "internal-remote-mcp-local" });
  }
  if (ids.includes("internal-local-mcp")) {
    const endpoint = await ctx.modules.call("internal-local-mcp", "endpoint", { conversationId: sessionId, workspaceId });
    servers.push({ id: "internal-local-mcp", ...endpoint.server });
  }
  return servers;
}
var clip = (v, n) => typeof v === "string" ? v.trim().slice(0, n) : "";
function agentRequest(a) {
  if (a == null) return null;
  const prompt = clip(a.prompt, 128 * 1024);
  if (!prompt) throw new Error("A background agent needs a prompt");
  return { name: clip(a.name, 120) || "Task agent", prompt, model: clip(a.model, 200) };
}
async function approve(ctx, session, title, detail, allowLabel, operation, timeoutMs = 9 * 60 * 1e3) {
  if (session.autopilot) return;
  const decision = await ctx.host.approvals.request({
    title: `${session.name}: ${title}`,
    detail,
    operation,
    timeoutMs,
    options: [{ id: "allow", label: allowLabel, kind: "allow" }, { id: "deny", label: "Deny", kind: "deny" }]
  });
  if (decision.optionId !== "allow") throw new Error(decision.expired ? "The request was not approved in time" : `The user denied: ${title}`);
}
async function createAgent(ctx, c, a, selection, id, fromChat = false) {
  const config = await agentConfig(ctx, c, selection, id);
  const subscription = await ctx.modules.call("persistence", "settings.get", { key: "acp.claude.useSubscription" });
  const policy = a.approvalPolicy === "autopilot" ? "autopilot" : a.approvalPolicy === "auto-low" ? "auto-low" : "ask";
  const settings = agentSettings(a.settings);
  const spec = {
    id,
    name: String(a.name || "Agent").trim().slice(0, 120),
    customName: a.autoName !== true && !!String(a.name || "").trim(),
    workspaceId: c.workspace.id,
    workspaceName: c.workspace.name,
    root: c.workspace.rootAbsolutePath,
    machineId: c.workspace.machineId,
    ...config,
    claudeSubscription: subscription !== false,
    daemon: daemonInfo.get(c.workspace.machineId),
    ...fromChat && policy !== "ask" ? { autopilot: policy === "autopilot", approvalPolicy: policy === "auto-low" ? "auto-low" : void 0 } : {},
    ...Object.keys(settings).length ? { settings } : {}
  };
  return invoke(ctx, c.workspace.id, "create", { spec });
}
async function readyWorkspace(ctx, workspaceId) {
  if (typeof workspaceId !== "string" || !workspaceId) throw new Error("workspace_id is required");
  const d = await ctx.modules.call("workspace", "resolve", { workspaceId });
  if (d.taskId && d.status !== "ready") throw new Error(`Task worktree is ${d.status}; reconcile it first`);
  return d;
}
function desktopAgentTools(ctx) {
  const object = (properties, required) => ({ type: "object", properties, required, additionalProperties: false });
  const workspaceId = { type: "string", description: "Target workspace ID: task:<taskId> from persistent-agents__list_tasks or project:<projectId>:root from a project ID." };
  const selectionList = { type: "array", items: { type: "string" }, maxItems: 32 };
  return exportMcpTools(ctx, "Background agents", [
    {
      name: "list_tasks",
      title: "List tasks in any project",
      description: "Find the task workspace IDs for a registered project.",
      inputSchema: object({ project_id: { type: "string", description: "Project ID from projects__list." } }, ["project_id"]),
      annotations: { readOnlyHint: true },
      async handler(a, scope) {
        await ctx.modules.call("workspace", "resolve", { workspaceId: scope.workspaceId });
        if (typeof a.project_id !== "string" || !a.project_id) throw new Error("project_id is required");
        const d = await readyWorkspace(ctx, `project:${a.project_id}:root`);
        const tasks = await ctx.modules.call("git-tasks", "list", { projectId: d.projectId });
        return tasks.map((t) => ({ id: t.id, workspaceId: `task:${t.id}`, name: t.name, branch: t.branch, status: t.status }));
      }
    },
    {
      name: "options",
      title: "View background agent configuration options",
      description: "List provider profiles, instruction files, skills and MCP server IDs available in the target workspace.",
      inputSchema: object({ workspace_id: workspaceId }, ["workspace_id"]),
      annotations: { readOnlyHint: true },
      timeoutMs: 12e4,
      async handler(a, scope) {
        await ctx.modules.call("workspace", "resolve", { workspaceId: scope.workspaceId });
        const d = await readyWorkspace(ctx, a.workspace_id);
        const c = await catalog(ctx, d.id);
        return {
          workspaceId: d.id,
          projectId: d.projectId,
          name: d.name,
          machineId: d.machineId,
          agentFiles: c.agentFiles,
          skills: c.skills,
          profiles: c.profiles.map((p) => ({ id: p.id, name: p.name, provider: p.provider })),
          mcps: c.mcps.map((m) => ({ id: m.id, name: m.name }))
        };
      }
    },
    {
      name: "start",
      title: "Start a background agent in a workspace",
      description: "Create a background agent in an explicit project or task workspace and send its first prompt after the user's approval. Use persistent-agents__options to discover IDs for its provider, instructions, skills and MCP servers.",
      inputSchema: object({
        workspace_id: workspaceId,
        prompt: { type: "string", minLength: 1, maxLength: 128 * 1024 },
        name: { type: "string", maxLength: 120 },
        profile_id: { type: "string" },
        model: { type: "string", maxLength: 200 },
        agent_file: { type: "string", description: "Instruction path from the target options." },
        skills: selectionList,
        mcp_ids: { ...selectionList, description: "MCP server IDs from the target options. Defaults to Workspace tools; pass [] to omit MCP servers." },
        settings: { type: "object", description: "Provider configuration option IDs and values.", additionalProperties: { type: ["string", "boolean"] }, maxProperties: 32 }
      }, ["workspace_id", "prompt", "profile_id"]),
      timeoutMs: 18e4,
      async handler(a, scope) {
        if (typeof a.prompt !== "string" || !a.prompt.trim() || a.prompt.length > 128 * 1024) throw new Error("A prompt of up to 128 Ki characters is required");
        if (typeof a.profile_id !== "string" || !a.profile_id) throw new Error("profile_id is required");
        for (const value of [a.skills, a.mcp_ids]) {
          if (value !== void 0 && (!Array.isArray(value) || value.length > 32 || value.some((id2) => typeof id2 !== "string" || !id2))) throw new Error("Select up to 32 skill or MCP IDs");
        }
        const origin = await ctx.modules.call("workspace", "resolve", { workspaceId: scope.workspaceId });
        const d = await readyWorkspace(ctx, a.workspace_id);
        const c = await catalog(ctx, d.id);
        const config = {
          name: clip(a.name, 120) || "Background agent",
          profileId: a.profile_id,
          model: clip(a.model, 200),
          agentFile: a.agent_file,
          skills: a.skills,
          mcps: a.mcp_ids ?? ["internal-remote-mcp"],
          settings: agentSettings(a.settings)
        };
        const selection = agentSelection(c, config);
        const details = [
          `Source: ${origin.name} (${origin.machineId})`,
          `Target: ${d.name} (${d.machineId})`,
          `Agent: ${config.name}`,
          `Provider: ${selection.profile.name}${selection.model ? ` · ${selection.model}` : ""}`,
          `Instructions: ${selection.agentFile || "None"}`,
          `Skills: ${selection.skills.join(", ") || "None"}`,
          `MCP servers: ${selection.ids.map((id2) => c.mcps.find((m) => m.id === id2)?.name || id2).join(", ") || "None"}`,
          ...Object.keys(config.settings).length ? [`Provider settings: ${JSON.stringify(config.settings)}`] : [],
          `Prompt: ${a.prompt.length > 1500 ? a.prompt.slice(0, 1500) + "…" : a.prompt}`
        ];
        await approve(ctx, { name: origin.name }, "Start a background agent", details.join("\n"), "Start agent", "persistent-agents.create", 6e4);
        await readyWorkspace(ctx, d.id);
        const id = crypto.randomUUID();
        const result = { id, name: config.name, workspaceId: d.id, projectId: d.projectId };
        try {
          await createAgent(ctx, c, config, selection, id);
        } catch (e) {
          throw new Error(`Agent ${id} could not start in ${d.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
        ctx.events.emit("persistent-agents.changed", { workspaceId: d.id });
        try {
          await invoke(ctx, d.id, "send", { id, text: a.prompt });
        } catch (e) {
          return { ...result, promptAccepted: false, error: e instanceof Error ? e.message : String(e) };
        }
        return { ...result, promptAccepted: true };
      }
    }
  ]);
}
var agentLines = (agent) => agent ? [`Background agent: ${agent.name}${agent.model ? ` (${agent.model})` : ""}`, `Prompt: ${agent.prompt.length > 1500 ? agent.prompt.slice(0, 1500) + "…" : agent.prompt}`] : [];
async function startTaskAgent(ctx, parent, taskWorkspaceId, agent) {
  const c = await catalog(ctx, taskWorkspaceId);
  const mcpIds = [...parent.workspaceMcp ? ["internal-remote-mcp"] : [], ...(parent.mcps || []).map((m) => m.id)].filter((id) => c.mcps.some((m) => m.id === id));
  const created = await mod.methods.create(ctx, {
    workspaceId: taskWorkspaceId,
    name: agent.name,
    profileId: parent.profile.id,
    model: agent.model || parent.model,
    agentFile: c.agentFiles.some((f) => f.path === parent.agentFile) ? parent.agentFile : null,
    skills: (parent.skills || []).filter((p) => c.skills.some((s) => s.path === p)),
    mcps: mcpIds
  }, { caller: "persistent-agents" });
  if (parent.autopilot) await invoke(ctx, taskWorkspaceId, "setAutopilot", { id: created.id, enabled: true });
  await invoke(ctx, taskWorkspaceId, "send", { id: created.id, text: agent.prompt });
  ctx.events.emit("persistent-agents.changed", { workspaceId: taskWorkspaceId });
  return { id: created.id, name: created.name, workspaceId: taskWorkspaceId, autopilot: !!parent.autopilot };
}
async function performTask(ctx, r) {
  const v = await owned(ctx, { workspaceId: String(r.workspaceId), id: String(r.sessionId) });
  const d = await ctx.modules.call("workspace", "resolve", { workspaceId: r.workspaceId });
  const tasks = async () => ctx.modules.call("git-tasks", "list", { projectId: d.projectId });
  if (r.op === "list") return (await tasks()).map((t) => ({ id: t.id, workspaceId: `task:${t.id}`, name: t.name, branch: t.branch, worktreePath: t.worktreePath, status: t.status, current: t.id === d.taskId }));
  if (r.op === "reconcile") return ctx.modules.call("git-tasks", "reconcile", { projectId: d.projectId }, { timeoutMs: 12e4 });
  const project = `${d.name.split(" / ")[0]} (${d.machineId})`;
  if (r.op === "startAgent") {
    const agent2 = agentRequest(r.args?.agent);
    const task2 = (await tasks()).find((t) => t.id === r.args?.taskId);
    if (!task2) throw new Error("Task is not part of this project");
    if (task2.status !== "ready") throw new Error(`Task worktree is ${task2.status}; reconcile it first`);
    await approve(ctx, v.session, `start agent in task ${task2.name}`, [`Agent: ${v.session.name}`, `Project: ${project}`, `Task: ${task2.name} (${task2.branch})`, ...agentLines(agent2)].join("\n"), "Start agent", "persistent-agents.create");
    return startTaskAgent(ctx, v.session, `task:${task2.id}`, agent2);
  }
  if (r.op !== "create") throw new Error("Unknown task operation");
  const name = clip(r.args?.name, 100), branch = clip(r.args?.branch, 200), agent = agentRequest(r.args?.agent);
  if (!name && !branch) throw new Error("Provide a task name or a branch");
  await approve(
    ctx,
    v.session,
    agent ? "create Git task and start an agent" : "create Git task",
    [
      `Agent: ${v.session.name}`,
      `Project: ${project}`,
      `Task name: ${name || branch}`,
      `Branch: ${branch || "generated task/<name>-<id>"}`,
      "Creates a linked Git worktree outside the project checkout. Existing branches are checked out, otherwise a new branch starts from HEAD.",
      ...agentLines(agent)
    ].join("\n"),
    agent ? "Create and start" : "Create task",
    "git-tasks.create"
  );
  const task = await ctx.modules.call("git-tasks", "create", { projectId: d.projectId, name: name || branch, branch, select: false }, { timeoutMs: 3e5 });
  if (!agent) return task;
  try {
    return { ...task, agent: await startTaskAgent(ctx, v.session, `task:${task.id}`, agent) };
  } catch (e) {
    return { ...task, agentError: `The task was created but the agent did not start: ${e instanceof Error ? e.message : String(e)}` };
  }
}
var daemonPoll = null;
var polling = false;
var busySignature = "";
var workingSignature = "";
var workflowsSignature = "";
var historySignatures = /* @__PURE__ */ new Map();
var WORKING_LIMIT = 50;
var WORKING = /* @__PURE__ */ new Set(["starting", "busy", "waiting"]);
var workingIds = /* @__PURE__ */ new Set();
var finishedChildren = /* @__PURE__ */ new Map();
function publishWorking(ctx, working, childrenOf = () => void 0) {
  const now = new Set(working.map((w) => w.id));
  if (trackFinishedSubagents(finishedChildren, workingIds, now, childrenOf)) ctx.state.set("persistent-agents.finished", [...finishedChildren.values()]);
  workingIds = now;
  const entries = working.sort((a, b) => a.id.localeCompare(b.id)).slice(0, WORKING_LIMIT);
  const sig = JSON.stringify(entries);
  if (sig === workingSignature) return;
  workingSignature = sig;
  ctx.state.set("persistent-agents.working", entries);
}
async function pollDaemons(ctx) {
  if (polling) return;
  polling = true;
  try {
    const busy = {};
    const working = [];
    const allChildren = /* @__PURE__ */ new Map();
    const workflows = [];
    for (const [machineId, pending] of [...prepared]) {
      let t;
      try {
        t = await pending;
      } catch {
        continue;
      }
      try {
        const runs = await ctx.host.daemon.request(t, "modules.call", { target: "workflow-runner", method: "active", args: {}, timeoutMs: 1e4 });
        if (Array.isArray(runs)) workflows.push(...runs);
      } catch {
      }
      try {
        const sessions = await ctx.host.daemon.request(t, "modules.call", { target: "agent-runner", method: "list", args: {}, timeoutMs: 1e4 });
        const byWorkspace = /* @__PURE__ */ new Map();
        for (const s of sessions || []) {
          if (s.machineId !== machineId) continue;
          const revisions = byWorkspace.get(s.workspaceId) ?? [];
          revisions.push(JSON.stringify([s.id, s.revision]));
          byWorkspace.set(s.workspaceId, revisions);
        }
        const previous = historySignatures.get(machineId);
        const current = new Map([...byWorkspace].map(([id, revisions]) => [id, JSON.stringify(revisions.sort())]));
        historySignatures.set(machineId, current);
        for (const workspaceId of /* @__PURE__ */ new Set([...previous?.keys() ?? [], ...current.keys()])) {
          if (previous?.get(workspaceId) !== current.get(workspaceId)) {
            ctx.events.emit("persistent-agents.changed", { workspaceId });
          }
        }
        for (const s of sessions || []) {
          if (s.machineId === machineId && !WORKING.has(s.status)) ctx.events.emit("persistent-agents.captureEnded", { workspaceId: s.workspaceId, sessionId: s.id });
          if (s.machineId === machineId && s.childSessions) allChildren.set(s.id, subagentList(s.childSessions));
          if (s.machineId !== machineId || !WORKING.has(s.status) && !hasWorkingSubagents(s.childSessions)) continue;
          busy[s.workspaceId] = (busy[s.workspaceId] || 0) + 1;
          const { workflowId, runId, blockId } = s.workflow ?? {};
          const workflow = s.workflow ? {
            ...typeof workflowId === "string" ? { workflowId } : {},
            ...typeof runId === "string" ? { runId } : {},
            ...typeof blockId === "string" ? { blockId } : {}
          } : null;
          const progress = s.progress && Number.isFinite(s.progress.percent) ? { percent: s.progress.percent, ...Number.isFinite(s.progress.at) ? { at: s.progress.at } : {}, ...s.progress.note ? { note: s.progress.note } : {} } : null;
          const children = subagentList(s.childSessions);
          working.push({ id: s.id, name: s.name, workspaceId: s.workspaceId, status: WORKING.has(s.status) ? s.status : "busy", workflow, progress, ...children.length ? { children } : {} });
        }
      } catch {
      }
      let requests;
      try {
        requests = await ctx.host.daemon.request(t, "modules.call", { target: "internal-remote-mcp", method: "claimTaskRequests", args: {}, timeoutMs: 1e4 });
      } catch {
        continue;
      }
      for (const r of requests || []) void (async () => {
        let outcome;
        try {
          const d = await ctx.modules.call("workspace", "resolve", { workspaceId: String(r.workspaceId) });
          if (d.machineId !== machineId) throw new Error("Workspace does not belong to this machine");
          outcome = { value: await performTask(ctx, r) };
        } catch (e) {
          outcome = { error: e instanceof Error ? e.message : String(e) };
        }
        await ctx.host.daemon.request(t, "modules.call", { target: "internal-remote-mcp", method: "resolveTaskRequest", args: { id: r.id, ...outcome }, timeoutMs: 1e4 }).catch((e) => ctx.log.warn("task request reply", String(e)));
      })();
    }
    const sig = JSON.stringify(Object.entries(busy).sort());
    if (sig !== busySignature) {
      busySignature = sig;
      ctx.state.set("persistent-agents.busy", busy);
    }
    publishWorking(ctx, working, (id) => allChildren.get(id));
    const workflowSig = JSON.stringify(workflows);
    if (workflowSig !== workflowsSignature) {
      workflowsSignature = workflowSig;
      ctx.state.set("persistent-agents.workflows", workflows.slice(0, 50));
    }
  } finally {
    polling = false;
  }
}
var libraryTimer = null;
async function pushLibrary(ctx) {
  const items = libraryCatalog(ctx.state.get(LIBRARY_STATE)).items;
  for (const pending of [...prepared.values()]) {
    let t;
    try {
      t = await pending;
    } catch {
      continue;
    }
    let rows;
    try {
      rows = await ctx.host.daemon.request(t, "modules.call", { target: "agent-runner", method: "list", args: {}, timeoutMs: 6e4 });
    } catch {
      continue;
    }
    for (const s of rows) {
      const inline = {};
      for (const ref of [s.agentFile, ...s.skills || []].filter(isLibraryRef)) {
        const item = items.find((i) => i.id === libraryRefId(ref));
        if (!item) continue;
        const text = libraryInstructions(item);
        if (s.inlineDigest?.[ref] !== textDigest(text)) inline[ref] = text;
      }
      if (!Object.keys(inline).length) continue;
      try {
        await ctx.host.daemon.request(t, "modules.call", { target: "agent-runner", method: "refreshInline", args: { id: s.id, inline }, timeoutMs: 6e4 });
        await ctx.modules.call("internal-remote-mcp", "updateInline", { sessionId: s.id, inline }).catch(() => {
        });
      } catch (e) {
        ctx.log.warn(`Library refresh for agent ${s.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
}
var desktopMcp;
var mod = {
  id: "persistent-agents",
  moduleApiVersion: 1,
  canSwap: () => ({ ok: (desktopMcp?.pending() ?? 0) === 0, reason: "A background agent MCP command is running" }),
  deactivate() {
    if (daemonPoll) clearInterval(daemonPoll);
    daemonPoll = null;
    if (libraryTimer) clearTimeout(libraryTimer);
    libraryTimer = null;
  },
  activate(ctx) {
    desktopMcp = desktopAgentTools(ctx);
    publishWorking(ctx, []);
    ctx.state.watch(LIBRARY_STATE, () => {
      if (libraryTimer) clearTimeout(libraryTimer);
      libraryTimer = setTimeout(() => {
        libraryTimer = null;
        void pushLibrary(ctx).catch((e) => ctx.log.warn(String(e)));
      }, 1500);
    });
    setTimeout(async () => {
      try {
        if (!await ctx.host.daemon.status({ kind: "local" })) return;
        const local = (await ctx.modules.call("persistence", "projects.list")).find((p) => p.kind === "local");
        if (local) await target(ctx, `project:${local.id}:root`);
      } catch (e) {
        ctx.log?.warn("local daemon warm-up", e instanceof Error ? e.message : String(e));
      }
    }, 1500);
    const allowed = /* @__PURE__ */ new Set(["create", "catalog", "list", "view", "send", "cancel", "stop", "reconnect", "setModel", "setConfig", "setAutopilot", "setPolicy", "update", "updateRuntime", "reviewPermission", "clear", "listMcpTools"]);
    ctx.events.on("mcp-panel.request", async (request) => {
      if (typeof request?.requestId !== "string" || !["listMcps", "saveMcp", "removeMcp", "probeMcp", "signInMcp", "signOutMcp", "cancelSignInMcp", "listMcpTools"].includes(request.method)) return;
      try {
        const value = await mod.methods[request.method](ctx, request.args || {}, { caller: "mcp-panel" });
        ctx.events.emit("persistent-agents.mcpResponse", { requestId: request.requestId, value });
      } catch (e) {
        ctx.events.emit("persistent-agents.mcpResponse", { requestId: request.requestId, error: e instanceof Error ? e.message : String(e) });
      }
    });
    ctx.events.on("ai.persistentRequest", async (request) => {
      if (typeof request?.requestId !== "string" || !allowed.has(request.method)) return;
      try {
        const value = await mod.methods[request.method](ctx, request.args, { caller: "ai" });
        ctx.events.emit("persistent-agents.chatResponse", { requestId: request.requestId, value });
      } catch (e) {
        ctx.events.emit("persistent-agents.chatResponse", { requestId: request.requestId, error: e instanceof Error ? e.message : String(e) });
      }
    });
  },
  methods: {
    async taskRequest(ctx, a, meta) {
      if (meta.caller !== "internal-remote-mcp") throw new Error("Task requests come from the workspace MCP server");
      return performTask(ctx, { sessionId: String(a.sessionId), workspaceId: String(a.workspaceId), op: String(a.op), args: a.args || {} });
    },
    workspaceEndpoint: async (ctx, a) => ctx.modules.call("internal-remote-mcp", "endpoint", { workspaceId: String(a.workspaceId), sessionId: String(a.sessionId || crypto.randomUUID()), skills: Array.isArray(a.skills) ? a.skills : [] }),
    catalog: async (ctx, a) => {
      const { libraryText: _text, ...c } = await catalog(ctx, String(a.workspaceId));
      return c;
    },
    async listMcps(ctx) {
      const list = await mcps(ctx);
      const remote = list.filter((m) => transportOf(m) !== "stdio" && m.auth?.type === "oauth").map((m) => ({ id: m.id, url: m.url }));
      const status = remote.length ? await ctx.modules.call("mcp-auth", "status", { servers: remote }).catch(() => ({})) : {};
      return [...builtInMcps, ...list.map((m) => status[m.id] ? { ...m, authStatus: status[m.id] } : m)];
    },
    /** Tools a server exposes: built-ins from their modules, remote servers over HTTP. */
    async listMcpTools(ctx, a) {
      const id = String(a.id || "");
      if (id === "internal-local-mcp") return { tools: await ctx.modules.call("internal-local-mcp", "tools", {}) };
      if (id === "internal-remote-mcp" || id === "internal-remote-mcp-local") return { tools: await ctx.modules.call("internal-remote-mcp", "tools", {}) };
      const server = (await mcps(ctx)).find((m) => m.id === id);
      if (!server) throw new Error("Unknown MCP server");
      if (transportOf(server) === "stdio") throw new Error("Local (command) servers start on the agent's machine when an agent connects; their tools cannot be listed from here yet.");
      return ctx.modules.call("mcp-auth", "listTools", { serverId: server.id, url: server.url, transport: server.transport, headers: server.headers, auth: server.auth }, { timeoutMs: 9e4 });
    },
    async probeMcp(ctx, a) {
      return ctx.modules.call("mcp-auth", "probe", { url: a.url, transport: a.transport, headers: a.headers }, { timeoutMs: 6e4 });
    },
    async signInMcp(ctx, a) {
      const server = (await mcps(ctx)).find((m) => m.id === a.id);
      if (!server || transportOf(server) === "stdio" || server.auth?.type !== "oauth") throw new Error("Save the server with OAuth authentication first");
      return ctx.modules.call("mcp-auth", "signIn", { serverId: server.id, url: server.url, transport: server.transport, headers: server.headers, auth: server.auth });
    },
    async signOutMcp(ctx, a) {
      return ctx.modules.call("mcp-auth", "signOut", { serverId: String(a.id) });
    },
    async cancelSignInMcp(ctx, a) {
      return ctx.modules.call("mcp-auth", "cancel", { serverId: String(a.id) });
    },
    async saveMcp(ctx, a) {
      const server = validateMcp(a.server);
      await editMcps(ctx, (list) => [...list.filter((p) => p.id !== server.id), server]);
      return null;
    },
    async removeMcp(ctx, a) {
      if (typeof a.id !== "string" || a.id.startsWith("internal-")) throw new Error("Built-in MCP servers cannot be removed");
      await editMcps(ctx, (list) => list.filter((m) => m.id !== a.id));
      await ctx.modules.call("mcp-auth", "signOut", { serverId: a.id }).catch(() => {
      });
      return null;
    },
    async create(ctx, a, meta) {
      const c = await catalog(ctx, String(a.workspaceId));
      return createAgent(ctx, c, a, agentSelection(c, a), crypto.randomUUID(), meta?.caller === "ai");
    },
    /** Edit name, provider, instructions, skills and MCP servers. Only a rename leaves a connected agent running. */
    async update(ctx, a) {
      const v = await owned(ctx, a), s = v.session;
      const name = String(a.name || "").trim().slice(0, 120);
      if (!name) throw new Error("Agent name is required");
      const followsProvider = name === s.name && isAutoAgentName(s) && s.profile.id !== a.profileId;
      const customName = !(name === s.name && isAutoAgentName(s)) && name !== autoAgentName(s);
      const ids = [...new Set(Array.isArray(a.mcps) ? a.mcps : [])].sort();
      const skills = [...Array.isArray(a.skills) ? a.skills : []].map(relativeAgentPath).sort();
      const agentFile = a.agentFile ? relativeAgentPath(a.agentFile) : null;
      const c = await catalog(ctx, String(a.workspaceId));
      const digests = s.inlineDigest || {};
      const libraryChanged = [agentFile, ...skills].some((p) => isLibraryRef(p) && c.libraryText.has(p) && digests[p] !== textDigest(c.libraryText.get(p)));
      const same = !libraryChanged && s.profile.id === a.profileId && (s.agentFile || null) === agentFile && JSON.stringify([...s.skills].sort()) === JSON.stringify(skills) && JSON.stringify(agentMcpIds(s).sort()) === JSON.stringify(ids);
      if (same) return invoke(ctx, a.workspaceId, "update", { id: s.id, patch: { name, customName } });
      await ctx.modules.call("internal-local-mcp", "revoke", { conversationId: s.id }).catch(() => {
      });
      await ctx.modules.call("internal-remote-mcp", "revoke", { sessionId: s.id }).catch(() => {
      });
      const selection = agentSelection(c, { ...a, mcps: ids, skills, agentFile, model: s.profile.id === a.profileId ? s.model : "" });
      const config = await agentConfig(ctx, c, selection, s.id);
      const result = await invoke(ctx, a.workspaceId, "update", { id: s.id, patch: { name, customName, ...config } });
      await followName(ctx, a.workspaceId, s.id, followsProvider);
      return result;
    },
    async clear(ctx, a) {
      await owned(ctx, a);
      return invoke(ctx, a.workspaceId, "clear", { id: a.id });
    },
    async remove(ctx, a) {
      await owned(ctx, a);
      const result = await invoke(ctx, a.workspaceId, "remove", { id: a.id });
      await ctx.modules.call("internal-local-mcp", "revoke", { conversationId: a.id }).catch(() => {
      });
      await ctx.modules.call("internal-remote-mcp", "revoke", { sessionId: a.id }).catch(() => {
      });
      activityCache.delete(a.id);
      return result;
    },
    /** Prompts sent to this workspace's background agents with the files each turn edited (prompt-history panel).
     *  Uses the runner's ordinary `view`, so older runtimes still list prompts (without diffs). */
    async promptHistory(ctx, a) {
      const workspaceId = String(a.workspaceId), limit = Math.max(50, Math.min(Number(a.messageLimit) || 200, 200));
      const rows = (await invoke(ctx, workspaceId, "list")).filter((s) => s.workspaceId === workspaceId).sort((x, y) => String(y.updatedAt).localeCompare(String(x.updatedAt))).slice(0, 20);
      const entries = [];
      for (const s of rows) {
        try {
          const v = await invoke(ctx, workspaceId, "view", { id: s.id, limit });
          entries.push(...promptTurns(
            (v.messages || []).map((m) => ({ key: m.key, role: m.role, text: m.role === "user" ? m.text : void 0, diffs: m.diffs, at: epochOf(m.at) })),
            { source: "agent", sessionId: s.id, sessionTitle: s.name || "Agent", agent: s.profile?.name || s.profile?.id || "Agent" }
          ));
        } catch (e) {
          ctx.log.warn("prompt history", errMsg(e));
        }
      }
      return { entries };
    },
    async list(ctx, a) {
      const rows = await invoke(ctx, String(a.workspaceId), "list");
      const scoped = rows.filter((s) => s.workspaceId === a.workspaceId);
      const result = new Array(scoped.length);
      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(4, scoped.length) }, async () => {
        while (cursor < scoped.length) {
          const index = cursor++, s = scoped[index], cached = activityCache.get(s.id);
          let text = cached && cached.status === s.status ? cached.text : void 0;
          if (!cached || cached.revision !== s.revision || cached.status !== s.status) {
            try {
              const detail = await invoke(ctx, String(a.workspaceId), "view", { id: s.id, limit: 8 });
              if (detail.session.workspaceId !== a.workspaceId) throw new Error("Agent belongs to another workspace");
              text = agentActivity(detail);
              activityCache.set(s.id, { revision: s.revision, status: s.status, text });
            } catch {
            }
          }
          result[index] = { ...s, activity: text };
        }
      }));
      return result;
    },
    async fork(ctx, a) {
      await owned(ctx, { ...a, id: a.parentId });
      return invoke(ctx, a.workspaceId, "fork", { parentId: a.parentId, name: a.name, text: a.text, model: a.model });
    },
    async mcpConfigs(ctx, a, meta) {
      await ctx.modules.call("workspace", "resolve", { workspaceId: String(a.workspaceId) });
      if (!Array.isArray(a.ids) || !a.ids.every((id) => typeof id === "string")) throw new Error("MCP server ids are required");
      const ids = new Set(a.ids), desktop = [];
      if (ids.delete("internal-local-mcp")) {
        if (meta?.caller !== "workflows" || typeof a.conversationId !== "string" || !a.conversationId.startsWith("workflow:")) throw new Error("Desktop tools are issued to workflows only");
        const endpoint = await ctx.modules.call("internal-local-mcp", "endpoint", { conversationId: a.conversationId, workspaceId: String(a.workspaceId) });
        desktop.push({ id: "internal-local-mcp", ...endpoint.server });
      }
      if (!ids.size) return desktop;
      const list = (await mcps(ctx)).filter((m) => m.enabled !== false && ids.has(m.id));
      if (list.length !== ids.size) throw new Error("A connected MCP server is missing or disabled");
      const auth = await oauthHeaders(ctx, list);
      return [...desktop, ...list.map((m) => ({ id: m.id, ...acpServer(m, auth[m.id]) }))];
    },
    async view(ctx, a) {
      const v = await invoke(ctx, String(a.workspaceId), "view", { id: a.id, before: a.before, limit: a.limit });
      if (v.session.workspaceId !== a.workspaceId) throw new Error("Agent belongs to another workspace");
      if (isAutoAgentName(v.session)) {
        const name = autoAgentName(v.session);
        if (name !== v.session.name) {
          await invoke(ctx, String(a.workspaceId), "update", { id: v.session.id, patch: { name, customName: false } }).catch(() => {
          });
          v.session = { ...v.session, name };
        }
      }
      v.messages = captureEnabled(ctx) ? capturedTranscript(v.messages, capturedChanges(ctx, a.workspaceId), "agent", a.id) : v.messages.map((m) => ({ ...m, diffs: void 0 }));
      return v;
    },
    async send(ctx, a) {
      const { session } = await owned(ctx, a), images = imageAttachments(a.images);
      if (session.workflow) {
        const t = await target(ctx, a.workspaceId);
        return ctx.host.daemon.request(t, "modules.call", {
          target: "workflow-runner",
          method: "promptSession",
          args: { ...session.workflow, workspaceId: a.workspaceId, id: a.id, text: a.text, images },
          timeoutMs: 18e4
        });
      }
      const result = await invoke(ctx, a.workspaceId, "send", { id: a.id, text: a.text, steer: !!a.steer, ...images.length ? { images } : {} });
      const page = await invoke(ctx, a.workspaceId, "view", { id: a.id, limit: 20 });
      const message = [...page.messages || []].reverse().find((m) => m.role === "user");
      if (message) ctx.events.emit("persistent-agents.capturePrompt", { workspaceId: a.workspaceId, sessionId: a.id, source: "agent", prompt: a.text, key: message.key });
      return result;
    },
    /** Replace this machine's agent runtime with the desktop's current build, even while agents run.
     *  Agents that were connected are reconnected afterwards (their provider sessions resume). */
    async updateRuntime(ctx, a) {
      const workspaceId = String(a.workspaceId);
      const d = await ctx.modules.call("workspace", "resolve", { workspaceId });
      const t = await target(ctx, workspaceId);
      let rows = [];
      try {
        rows = await ctx.host.daemon.request(t, "modules.call", { target: "agent-runner", method: "list", args: {}, timeoutMs: 15e3 });
      } catch {
      }
      const wasLive = (rows || []).filter((s) => s.machineId === d.machineId && ["starting", "ready", "busy", "waiting"].includes(s.status));
      const pushed = [];
      for (const id of ["internal-remote-mcp", "agent-runner"]) {
        const r = await ctx.host.daemon.request(t, "plugins.push", { id });
        if (!r?.active) throw new Error(`${id} did not activate after the update: ${r?.error || "unknown error"}`);
        pushed.push({ id, reloaded: !!r.reloaded });
      }
      const reconnected = [], failed = [];
      for (const s of wasLive) {
        try {
          await mod.methods.reconnect(ctx, { workspaceId: s.workspaceId, id: s.id }, { caller: "persistent-agents" });
          reconnected.push(s.id);
        } catch (e) {
          failed.push({ id: s.id, name: s.name, error: e instanceof Error ? e.message : String(e) });
        }
      }
      activityCache.clear();
      ctx.events.emit("persistent-agents.changed", { workspaceId });
      ctx.events.emit("remote-runtime.changed", { machineId: d.machineId });
      return { machineId: d.machineId, pushed, reconnected, failed };
    },
    async setConfig(ctx, a) {
      const v = await owned(ctx, a);
      const result = await invoke(ctx, a.workspaceId, "setConfig", { id: a.id, configId: String(a.configId || ""), value: typeof a.value === "boolean" ? a.value : String(a.value ?? "") });
      if (v.session.configOptions?.find((o) => o.id === a.configId)?.category === "model") await followName(ctx, a.workspaceId, a.id, isAutoAgentName(v.session));
      return result;
    },
    async setPolicy(ctx, a) {
      await owned(ctx, a);
      return invoke(ctx, a.workspaceId, "setPolicy", { id: a.id, policy: String(a.policy || "ask") });
    },
    async cancel(ctx, a) {
      await owned(ctx, a);
      return invoke(ctx, a.workspaceId, "cancel", { id: a.id });
    },
    async stop(ctx, a) {
      await owned(ctx, a);
      const result = await invoke(ctx, a.workspaceId, "stop", { id: a.id });
      await ctx.modules.call("internal-local-mcp", "revoke", { conversationId: a.id }).catch(() => {
      });
      await ctx.modules.call("internal-remote-mcp", "revoke", { sessionId: a.id }).catch(() => {
      });
      return result;
    },
    async setAutopilot(ctx, a) {
      await owned(ctx, a);
      return invoke(ctx, a.workspaceId, "setAutopilot", { id: a.id, enabled: a.enabled === true });
    },
    async reconnect(ctx, a) {
      const v = await owned(ctx, a);
      const used = new Set((v.session.mcps || []).map((m) => m.id));
      const authorization = await oauthHeaders(ctx, (await mcps(ctx)).filter((m) => used.has(m.id)));
      const subscription = await ctx.modules.call("persistence", "settings.get", { key: "acp.claude.useSubscription" });
      const desktopIds = DESKTOP_MCP_IDS.filter((id) => used.has(id));
      let endpoints = [];
      if (desktopIds.length) {
        const paths = [v.session.agentFile, ...v.session.skills || []];
        const inline = desktopIds.includes("internal-remote-mcp-local") && paths.some(isLibraryRef) ? libraryInline(await catalog(ctx, a.workspaceId), paths) : {};
        endpoints = await desktopEndpoints(ctx, a.workspaceId, v.session.id, desktopIds, paths, inline);
      }
      const d = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
      const info = await ctx.host.daemon.ensure(await daemonTargetFor(ctx, d));
      const daemon = { bin: info.bin, dir: info.dir };
      daemonInfo.set(d.machineId, daemon);
      return invoke(ctx, a.workspaceId, "reconnect", { id: a.id, authorization, endpoints, claudeSubscription: subscription !== false, daemon });
    },
    async setModel(ctx, a) {
      const v = await owned(ctx, a);
      const result = await invoke(ctx, a.workspaceId, "setModel", { id: a.id, model: a.model });
      await followName(ctx, a.workspaceId, a.id, isAutoAgentName(v.session));
      return result;
    },
    async reviewPermission(ctx, a) {
      const v = await owned(ctx, a), permission = v.permissions.find((p) => p.id === a.permissionId);
      if (!permission) throw new Error("Permission request is no longer active");
      const options = (permission.request.options || []).map((o) => ({ id: o.optionId, label: o.name || o.optionId, kind: String(o.kind).startsWith("allow") ? "allow" : "deny" }));
      const deny = options.find((o) => o.kind === "deny");
      if (!deny) throw new Error("Provider supplied no deny option");
      const decision = await ctx.host.approvals.request({ title: `${v.session.name}: agent permission`, detail: JSON.stringify(permission.request.toolCall || permission.request, null, 2), options });
      return invoke(ctx, a.workspaceId, "permission", { id: a.id, permissionId: a.permissionId, optionId: decision.optionId || deny.id });
    }
  }
};
async function followName(ctx, workspaceId, id, wasAuto) {
  if (!wasAuto) return;
  try {
    const v = await invoke(ctx, workspaceId, "view", { id, limit: 1 });
    const name = autoAgentName(v.session);
    if (name && name !== v.session.name) await invoke(ctx, workspaceId, "update", { id, patch: { name, customName: false } });
  } catch (e) {
    ctx.log.warn(`agent rename: ${e instanceof Error ? e.message : String(e)}`);
  }
}
async function owned(ctx, a) {
  const v = await invoke(ctx, String(a.workspaceId), "view", { id: a.id, limit: 1 });
  if (v.session.workspaceId !== a.workspaceId) throw new Error("Agent belongs to another workspace");
  return v;
}
var index_default = mod;
export {
  index_default as default
};
