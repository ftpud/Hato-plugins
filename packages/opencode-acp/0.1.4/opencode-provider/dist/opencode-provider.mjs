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

// modules/services/opencode-provider/src/index.ts
var sshTargets = /* @__PURE__ */ new Map();
async function executionTarget(ctx, desc) {
  if (desc.location === "local") return { kind: "local" };
  if (desc.location === "cloud") {
    if (!desc.cloudHostId) throw new Error("Cloud workspace is missing its host");
    return ctx.modules.call("cloud", "target", { hostId: desc.cloudHostId, machineId: desc.machineId }, { timeoutMs: 62e4 });
  }
  if (!desc.ssh) throw new Error("SSH workspace is missing its connection profile");
  let target = sshTargets.get(desc.machineId);
  if (!target) {
    const ssh = desc.ssh;
    target = ctx.host.ssh.connect({
      profileId: ssh.profileId,
      host: ssh.host,
      port: ssh.port,
      user: ssh.user,
      identityFile: ssh.identityFile ?? null,
      transport: ssh.transport ?? "ssh",
      ...ssh.auth ? { auth: ssh.auth } : {}
    }).then((connection) => ({ kind: "ssh", connection: connection.connection, machineId: connection.machineId }));
    sshTargets.set(desc.machineId, target);
    target.catch(() => sshTargets.delete(desc.machineId));
  }
  return target;
}
function meter(value, id, label) {
  if (!value || typeof value.percent !== "number" || !Number.isFinite(value.percent)) return null;
  return {
    id,
    label,
    usedPercent: Math.max(0, Math.min(100, value.percent)),
    resetsAt: typeof value.resetsAt === "number" && Number.isFinite(value.resetsAt) ? value.resetsAt : null,
    resetsText: null
  };
}
function parseLimitsText(text) {
  const envelope = JSON.parse(text);
  const info = envelope?.data === void 0 ? envelope : envelope.data;
  if (info === null) {
    return { provider: "opencode", windows: [], plan: null, updatedAt: Date.now(), source: "probe", error: "Connect OpenCode Console to see plan usage" };
  }
  const go = info?.go;
  const windows = [
    meter(go?.rolling, "five_hour", "5h"),
    meter(go?.weekly, "seven_day", "Wk"),
    meter(go?.monthly, "monthly", "Mo")
  ].filter((value) => !!value);
  const workspace = typeof info?.workspace?.name === "string" && info.workspace.name.trim() ? info.workspace.name.trim() : null;
  return {
    provider: "opencode",
    windows,
    plan: workspace ? `${workspace} · OpenCode Go` : go ? "OpenCode Go" : null,
    updatedAt: Date.now(),
    source: "probe",
    error: windows.length ? null : "No OpenCode Go allowance was reported for this workspace"
  };
}
function errorText(error) {
  return error?.message || String(error);
}
var API_ARGS = ["api", "experimental.usage.limits"];
var MISSING = /not found|no such file|ENOENT|cannot find|not recognized/i;
var FALLBACK_SCRIPT = [
  'export PATH="$HOME/.opencode/bin:$HOME/.bun/bin:$HOME/.local/bin:$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"',
  // Version managers are usually initialized only by interactive rc files.
  `if ! command -v opencode >/dev/null 2>&1; then P=$("\${SHELL:-/bin/sh}" -ic 'printf "\\n__HATO_PATH__=%s\\n" "$PATH"' </dev/null 2>/dev/null | sed -n "s/^__HATO_PATH__=//p" | tail -n 1); [ -n "$P" ] && export PATH="$P:$PATH"; fi`,
  'if ! command -v opencode >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1; fi',
  'exec opencode "$@"'
].join("; ");
var index_default = {
  id: "opencode-provider",
  moduleApiVersion: 1,
  methods: {
    parseLimits: (_ctx, a) => parseLimitsText(a.text),
    sessionLimits: () => null,
    async limits(ctx, a) {
      const desc = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
      const target = await executionTarget(ctx, desc);
      const grant = await ctx.host.capabilities.request({ kind: "process", root: desc.rootAbsolutePath, target });
      const executablePath = a.executablePath;
      const run = (executable, args, loginShell) => ctx.host.process.run(grant.grant, {
        target,
        executable,
        args,
        cwd: a.cwd ?? desc.rootAbsolutePath,
        ...a.env === void 0 ? {} : { env: a.env },
        envRemove: a.envRemove ?? [],
        loginShell
      }, { timeoutMs: 3e4, limitBytes: 1e6 });
      try {
        let result;
        try {
          const leading = Array.isArray(a.executableArgs) ? a.executableArgs.filter((x) => typeof x === "string") : [];
          result = await run(executablePath ?? "opencode", [...leading, ...API_ARGS], desc.location !== "local");
          if (result.code === 127) throw new Error(result.stderr);
        } catch (error) {
          if (executablePath != null || !MISSING.test(errorText(error)) || !isPosix(workspaceOs(ctx, desc))) throw error;
          const retry = await run("sh", ["-c", FALLBACK_SCRIPT, "sh", ...API_ARGS], desc.location !== "local").catch((e) => e);
          if (retry instanceof Error || retry.code === 127) {
            throw new Error(`${errorText(error)} (PATH fallback failed: ${retry instanceof Error ? retry.message : retry.stderr.trim()})`);
          }
          result = retry;
        }
        if (result.code !== 0) throw new Error(result.stderr.trim() || `opencode api exited with code ${result.code}`);
        if (result.truncated) throw new Error("OpenCode usage response was truncated");
        return parseLimitsText(result.stdout);
      } catch (error) {
        throw new Error(`OpenCode plan usage is unavailable: ${errorText(error)}`);
      } finally {
        await ctx.host.capabilities.release(grant.grant).catch(() => {
        });
      }
    }
  }
};
export {
  index_default as default
};
