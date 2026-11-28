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
function errMsg(e) {
  return e && (e.message || String(e)) || "unknown error";
}

// ../sdk/mcp.ts
function exportMcpTools(ctx, title, tools) {
  let pending = 0;
  const publish2 = () => ctx.state.set(`${ctx.moduleId}.mcp`, {
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
  publish2();
  return { publish: publish2, pending: () => pending };
}

// ../sdk/browser.ts
var DEFAULT_VIEWPORT = { width: 1280, height: 800 };
function locationLabel(l) {
  switch (l.kind) {
    case "local":
      return "This computer";
    case "workspace":
      return l.label ? `Workspace · ${l.label}` : "Workspace machine";
    case "endpoint":
      return l.url.replace(/^(wss?|https?):\/\//, "").replace(/\/devtools\/.*$/, "").replace(/[?#].*$/, "");
  }
}

// modules/services/browser/src/cdp.ts
var CdpError = class extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
};
var Cdp = class _Cdp {
  constructor(ctx, handle) {
    this.ctx = ctx;
    this.handle = handle;
    this.nextId = 1;
    this.pending = /* @__PURE__ */ new Map();
    this.listeners = /* @__PURE__ */ new Map();
    this.buffer = "";
    this.sub = null;
    /** Host ops run concurrently; chain writes so messages (e.g. press then release) stay ordered. */
    this.writes = Promise.resolve();
    this.closed = false;
    this.onClose = () => {
    };
  }
  static async connect(ctx, url) {
    const { handle } = await ctx.host.net.websocket(url, { timeoutMs: 15e3 });
    const cdp = new _Cdp(ctx, handle);
    cdp.sub = await ctx.host.streams.listen(handle, { highWaterMark: 32 << 20 }, (chunk) => cdp.data(chunk), (err) => cdp.end(err ? err.message : "connection closed"));
    return cdp;
  }
  data(chunk) {
    this.buffer += chunk;
    let nl;
    while ((nl = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      let frame;
      try {
        frame = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof frame.t !== "string") continue;
      let msg;
      try {
        msg = JSON.parse(frame.t);
      } catch {
        continue;
      }
      this.dispatch(msg);
    }
  }
  dispatch(msg) {
    if (typeof msg.id === "number") {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new CdpError(`${p.method}: ${msg.error.message || "failed"}`, msg.error.code));
      else p.resolve(msg.result || {});
      return;
    }
    if (typeof msg.method !== "string") return;
    for (const key of [msg.method, "*"]) {
      const set = this.listeners.get(key);
      if (set) for (const l of [...set]) {
        try {
          key === "*" ? l({ method: msg.method, params: msg.params }, msg.sessionId) : l(msg.params || {}, msg.sessionId);
        } catch (e) {
          this.ctx.log.warn("CDP listener", msg.method, String(e));
        }
      }
    }
  }
  end(reason) {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new CdpError(`${p.method}: ${reason}`));
    }
    this.pending.clear();
    this.onClose(reason);
  }
  send(method, params = {}, sessionId, timeoutMs = 3e4) {
    if (this.closed) return Promise.reject(new CdpError(`${method}: browser connection is closed`));
    const id = this.nextId++;
    const body = JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CdpError(`${method}: timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, method, timer });
      this.writes = this.writes.then(() => this.ctx.host.net.write(this.handle, body)).catch((e) => {
        const p = this.pending.get(id);
        if (p) {
          this.pending.delete(id);
          clearTimeout(p.timer);
          p.reject(e);
        }
      });
    });
  }
  on(method, listener) {
    let set = this.listeners.get(method);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      this.listeners.set(method, set);
    }
    set.add(listener);
    return () => set.delete(listener);
  }
  async close() {
    this.end("closed");
    try {
      await this.sub?.close();
    } catch {
    }
    try {
      await this.ctx.host.net.close(this.handle);
    } catch {
    }
  }
};

// ../sdk/platform.ts
var isPosix = (os) => os !== "windows";
function osOf(platform) {
  return platform === "windows" ? "windows" : platform === "macos" ? "macos" : platform === "linux" ? "linux" : "posix";
}
function hostOs(ctx) {
  return osOf(ctx.host?.env?.info?.().platform);
}
function isAbsolutePath(p) {
  return p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("\\\\");
}
var slashPath = (p) => p.replace(/\\/g, "/");
function dirName(p) {
  const s = slashPath(p).replace(/\/+$/, "");
  const i = s.lastIndexOf("/");
  return i <= 0 ? i === 0 ? "/" : "." : /^[A-Za-z]:$/.test(s.slice(0, i)) ? s.slice(0, i + 1) : s.slice(0, i);
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
async function programExists(ctx, grant, cwd, program) {
  if (!isAbsolutePath(program)) return !!await resolveWindowsExecutable(ctx, grant, cwd, program).catch(() => null);
  return await firstExistingFile(ctx, grant, cwd, [program]) === program;
}
async function firstExistingFile(ctx, grant, cwd, paths) {
  const list = paths.filter((p) => isAbsolutePath(p) && !/[\r\n]/.test(p));
  if (!list.length) return null;
  const r = await ctx.host.process.run(grant, {
    target: { kind: "local" },
    executable: windowsPowerShell(ctx),
    args: [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      '$i=0;foreach($p in ($env:HATO_PROBE -split "`n")){ if (Test-Path -LiteralPath $p -PathType Leaf) { exit (10+$i) }; $i++ }; exit 1'
    ],
    cwd,
    env: { HATO_PROBE: list.join("\n") }
  }, { timeoutMs: 15e3 }).catch(() => null);
  const i = (r?.code ?? 1) - 10;
  return i >= 0 && i < list.length ? list[i] : null;
}
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
var SAFE_NAME = /^[A-Za-z0-9_.@+\-\\/: ()]+$/;
async function resolveWindowsExecutable(ctx, grant, cwd, name) {
  if (!SAFE_NAME.test(name) || /[*?\[\]]/.test(name)) throw new Error(`Unsupported executable name: ${name}`);
  const r = await ctx.host.process.run(
    grant,
    {
      target: { kind: "local" },
      executable: windowsPowerShell(ctx),
      args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", RESOLVE_SCRIPT],
      cwd,
      env: { HATO_RESOLVE: name }
    },
    { timeoutMs: 3e4, limitBytes: 1 << 20 }
  );
  const line = r.stdout.split(/\r?\n/).filter((l) => l.startsWith(RESOLVE_MARK)).pop();
  if (!line) throw new Error(`Could not query PATH with Windows PowerShell: ${(r.stderr || r.stdout).trim().slice(-400)}`);
  const found = JSON.parse(line.slice(RESOLVE_MARK.length));
  if (!found.path) return null;
  const path = String(found.path), pathEnv = String(found.pathEnv || "");
  if (!/\.(cmd|bat)$/i.test(path)) return { path, pathEnv, launch: { executable: path, args: [] } };
  const shim = parseCmdShim(String(found.shim || ""), path, npmNodeExe(path, !!found.nodeNext, found.node || null));
  return { path, pathEnv, launch: shim || { executable: path, args: [] } };
}
function npmNodeExe(shimPath, nodeNext, node) {
  return nodeNext ? `${dirName(shimPath).replace(/\//g, "\\")}\\node.exe` : node;
}
function parseCmdShim(text, shimPath, node) {
  if (!node) return null;
  const dir = slashPath(shimPath).replace(/\/[^/]*$/, "");
  const win = (p) => p.replace(/\//g, "\\");
  const key = /npx\.cmd$/i.test(shimPath) ? "NPX_CLI_JS" : "NPM_CLI_JS";
  const npm = new RegExp(`SET\\s+"${key}=%~dp0\\\\?([^"]+\\.c?js)"`, "i").exec(text);
  if (npm) return { executable: node, args: [win(normalize(`${dir}/${slashPath(npm[1])}`))] };
  if (!/node\.exe"/i.test(text)) return null;
  const matches = [...text.matchAll(/"%(?:dp0%|~dp0)\\?([^"%]+)"\s+%\*/gi)];
  const m = matches[matches.length - 1];
  if (!m || /node\.exe$/i.test(m[1])) return null;
  return { executable: node, args: [win(normalize(`${dir}/${slashPath(m[1])}`))] };
}
function normalize(p) {
  const prefix = p.startsWith("//") ? "//" : p.startsWith("/") ? "/" : "";
  const out = [];
  for (const part of p.slice(prefix.length).split("/")) {
    if (part === "..") {
      if (out.length > 1) out.pop();
    } else if (part !== "." && part !== "") out.push(part);
  }
  return prefix + out.join("/");
}

// modules/services/browser/src/launch.ts
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function machineFor(ctx, spec) {
  const loc = spec.location;
  if (loc.kind === "local") {
    const shared = String(ctx.host.env.info().sharedDir || "").replace(/\/+$/, "");
    if (!shared) throw new Error("Hato's shared data folder is unavailable");
    const grant2 = await ctx.host.capabilities.request({ kind: "process", root: shared, purpose: "Run browser sessions" });
    return { id: "local", label: "This computer", grant: grant2, target: { kind: "local" }, stateDir: `${shared}/browser`, windows: !isPosix(hostOs(ctx)) };
  }
  if (loc.kind !== "workspace") throw new Error("Endpoint sessions do not run a browser process");
  const desc = await ctx.modules.call("workspace", "resolve", { workspaceId: loc.workspaceId });
  if (desc.location === "cloud") throw new Error("Browser sessions on Cloud machines are not supported yet");
  const grant = await workspaceGrant(ctx, desc, "process");
  const target2 = await targetFor(ctx, desc);
  let home = null;
  if (desc.location === "ssh") home = (await sshConnect(ctx, desc)).home;
  else home = ctx.host.env.info().home;
  if (!home) throw new Error("Cannot determine the home folder on the workspace machine");
  if (desc.location === "local") {
    const shared = String(ctx.host.env.info().sharedDir || "").replace(/\/+$/, "");
    return { id: "local", label: "This computer", grant, target: target2, stateDir: `${shared}/browser`, desc, windows: !isPosix(hostOs(ctx)) };
  }
  return { id: desc.machineId, label: desc.name, grant, target: target2, stateDir: `${home.replace(/\/+$/, "")}/.local/state/hato/browser`, desc };
}
function windowsBrowsers(ctx) {
  const d = knownDirs(ctx), programs = d.programs || "C:\\Program Files", x86 = programs.replace(/ ?\(x86\)$/, "") + " (x86)";
  const roots = [programs, x86, ...d.localData ? [d.localData] : []];
  return [
    ...roots.map((r) => `${r}\\Google\\Chrome\\Application\\chrome.exe`),
    ...roots.map((r) => `${r}\\Microsoft\\Edge\\Application\\msedge.exe`),
    ...roots.map((r) => `${r}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`),
    ...roots.map((r) => `${r}\\Chromium\\Application\\chrome.exe`)
  ];
}
async function sh(ctx, m, script, args = [], timeoutMs = 3e4, env) {
  return ctx.host.process.run(
    m.grant.grant,
    { target: m.target, executable: "sh", args: ["-c", script, "sh", ...args], cwd: m.grant.root, env, loginShell: m.target.kind !== "local" },
    { timeoutMs, limitBytes: 1 << 20 }
  );
}
var DETECT = `
for c in "$HATO_BROWSER" "$1/chrome-headless-shell/current/chrome-headless-shell" \\
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" "/Applications/Chromium.app/Contents/MacOS/Chromium" \\
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" \\
  "$HOME/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; do
  [ -n "$c" ] && [ -x "$c" ] && { printf '%s' "$c"; exit 0; }
done
for n in google-chrome-stable google-chrome chromium chromium-browser microsoft-edge brave-browser chrome-headless-shell; do
  p=$(command -v "$n" 2>/dev/null) && [ -n "$p" ] && { printf '%s' "$p"; exit 0; }
done
exit 3`;
async function findBrowser(ctx, m, preferred) {
  if (m.windows) {
    if (preferred && !isAbsolutePath(preferred) && await programExists(ctx, m.grant.grant, m.grant.root, preferred)) return preferred;
    return firstExistingFile(ctx, m.grant.grant, m.grant.root, [...preferred ? [preferred] : [], ...windowsBrowsers(ctx)]);
  }
  const r = await sh(ctx, m, DETECT, [m.stateDir], 15e3, { HATO_BROWSER: preferred || "" });
  return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}
var INSTALL = `
set -e
D="$1/chrome-headless-shell"; U="$2"
mkdir -p "$D"; cd "$D"; rm -rf tmp; mkdir tmp
if command -v curl >/dev/null 2>&1; then curl -fsSL "$U" -o tmp/s.zip; else wget -q -O tmp/s.zip "$U"; fi
if command -v unzip >/dev/null 2>&1; then unzip -q tmp/s.zip -d tmp; else python3 -c 'import sys,zipfile;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' tmp/s.zip tmp; fi
rm -rf current; mv tmp/chrome-headless-shell-* current; rm -rf tmp
chmod +x current/chrome-headless-shell 2>/dev/null || true
xattr -dr com.apple.quarantine current 2>/dev/null || true
printf '%s' "$D/current/chrome-headless-shell"`;
async function installHeadlessShell(ctx, m) {
  if (m.windows) throw new Error("No Chromium browser found. Install Google Chrome or Microsoft Edge, or set the browser path.");
  const uname = await sh(ctx, m, "uname -sm");
  const [os, arch] = uname.stdout.trim().split(/\s+/);
  const platform = os === "Darwin" ? arch === "arm64" ? "mac-arm64" : "mac-x64" : os === "Linux" && (arch === "x86_64" || arch === "amd64") ? "linux64" : null;
  if (!platform) throw new Error(`No managed headless browser for ${uname.stdout.trim() || "this machine"}; install Chrome or Chromium there`);
  const res = await ctx.host.net.fetch({ url: "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json", maxBytes: 4 << 20 });
  if (res.status !== 200) throw new Error(`Chrome for Testing index unavailable (HTTP ${res.status})`);
  const stable = JSON.parse(res.body)?.channels?.Stable;
  const url = stable?.downloads?.["chrome-headless-shell"]?.find((d) => d.platform === platform)?.url;
  if (typeof url !== "string" || !url.startsWith("https://")) throw new Error("Chrome for Testing has no headless shell for this platform");
  const r = await sh(ctx, m, INSTALL, [m.stateDir, url], 6e5);
  if (r.code !== 0) throw new Error(`Installing the headless browser failed: ${(r.stderr || r.stdout).trim().slice(-400)}`);
  return r.stdout.trim();
}
var LAUNCH = `
P="$1"; B="$2"; FRESH="$3"; shift 3
[ "$FRESH" = 1 ] && rm -rf "$P"
mkdir -p "$P"; rm -f "$P/DevToolsActivePort"
exec "$B" "$@"`;
var processKey = (id) => `browser-${id.replace(/[^A-Za-z0-9_-]/g, "_")}`;
async function daemonFor(ctx, m) {
  try {
    const target2 = m.desc ? await daemonTargetFor(ctx, m.desc) : { kind: "local" };
    await ctx.host.daemon.ensure(target2);
    return target2;
  } catch (e) {
    ctx.log.warn("browser daemon unavailable", errMsg(e));
    return null;
  }
}
async function launch(ctx, m, spec, bin, viewport) {
  const keep = spec.keepProfile !== false;
  const profile = `${m.stateDir}/${keep ? "profiles" : "scratch"}/${spec.id.replace(/[^A-Za-z0-9_-]/g, "_")}`;
  const headless = !(spec.headed && m.target.kind === "local");
  const flags = [
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=Translate,MediaRouter,OptimizationHints",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--use-mock-keychain",
    "--password-store=basic",
    "--mute-audio",
    `--window-size=${viewport.width},${viewport.height}`,
    ...headless && !/headless-shell/.test(bin) ? ["--headless=new"] : [],
    ...m.target.kind !== "local" ? ["--no-sandbox"] : [],
    spec.startUrl || "about:blank"
  ];
  const key = processKey(spec.id);
  if (m.windows) {
    const reset = keep ? "Remove-Item -LiteralPath (Join-Path $env:HATO_PROFILE 'DevToolsActivePort') -Force -ErrorAction SilentlyContinue" : "Remove-Item -LiteralPath $env:HATO_PROFILE -Recurse -Force -ErrorAction SilentlyContinue";
    await ctx.host.process.run(m.grant.grant, {
      target: m.target,
      executable: windowsPowerShell(ctx),
      args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", reset],
      cwd: m.grant.root,
      env: { HATO_PROFILE: profile.replace(/\//g, "\\") }
    }, { timeoutMs: 3e4 }).catch((e) => ctx.log.warn("reset browser profile", errMsg(e)));
    const { handle: handle2 } = await ctx.host.process.spawn(m.grant.grant, { target: m.target, executable: bin, args: flags, cwd: m.grant.root });
    launchedAt.set(profile, Date.now());
    return { handle: handle2, key, daemon: null, profile };
  }
  const daemon = await daemonFor(ctx, m);
  const req = { target: m.target, executable: "sh", args: ["-c", LAUNCH, "sh", profile, bin, keep ? "0" : "1", ...flags], cwd: m.grant.root, loginShell: m.target.kind !== "local" };
  const { handle } = await ctx.host.process.spawn(m.grant.grant, daemon ? { ...req, persist: { key } } : req);
  return { handle, key, daemon, profile };
}
var launchedAt = /* @__PURE__ */ new Map();
async function devtoolsPort(ctx, m, profile, timeoutMs = 3e4) {
  const deadline = Date.now() + timeoutMs;
  if (m.windows) {
    const g = await ctx.host.capabilities.request({ kind: "fs", root: m.stateDir, target: { kind: "local" }, purpose: "Read the browser's DevTools port" }).catch(() => ctx.host.capabilities.request({ kind: "fs", root: profile, target: { kind: "local" } }));
    try {
      const since = (launchedAt.get(profile) || 0) - 2e3;
      while (Date.now() < deadline) {
        const file = `${profile}/DevToolsActivePort`;
        const st = await ctx.host.fs.stat(g.grant, file).catch(() => null);
        if (st && (st.mtime == null || st.mtime * 1e3 >= since)) {
          const r = await ctx.host.fs.read(g.grant, file, 4096).catch(() => null);
          const [port, path] = (r?.text || "").split(/\r?\n/).map((s) => s.trim());
          if (/^\d+$/.test(port || "") && path?.startsWith("/devtools/browser/")) return { port: Number(port), path };
        }
        await sleep(250);
      }
    } finally {
      await ctx.host.capabilities.release(g.grant).catch(() => {
      });
    }
    throw new Error("The browser did not open its DevTools port in time");
  }
  while (Date.now() < deadline) {
    const r = await sh(ctx, m, 'cat "$1/DevToolsActivePort" 2>/dev/null', [profile], 1e4).catch(() => null);
    const [port, path] = (r?.stdout || "").split("\n").map((s) => s.trim());
    if (/^\d+$/.test(port || "") && path?.startsWith("/devtools/browser/")) return { port: Number(port), path };
    await sleep(250);
  }
  throw new Error("The browser did not open its DevTools port in time");
}
async function endpointUrl(ctx, url) {
  const u = url.trim();
  if (/^wss?:\/\//i.test(u)) return u;
  if (!/^https?:\/\//i.test(u)) throw new Error("Endpoint must be ws(s):// or http(s)://");
  const base = u.replace(/\/+$/, "").replace(/\/json(\/version)?$/, "");
  const res = await ctx.host.net.fetch({ url: `${base}/json/version`, timeoutMs: 1e4 });
  if (res.status !== 200) throw new Error(`DevTools endpoint answered HTTP ${res.status}`);
  const ws = JSON.parse(res.body)?.webSocketDebuggerUrl;
  if (typeof ws !== "string") throw new Error("DevTools endpoint did not report a browser websocket");
  return ws;
}
async function forward(ctx, m, port) {
  if (m.target.kind === "local") return { handle: null, port };
  if (!m.desc || m.desc.location !== "ssh") throw new Error("Unsupported machine");
  const { connection } = await sshConnect(ctx, m.desc);
  const f = await ctx.host.ssh.localForward(connection, { localPort: 0, remoteHost: "127.0.0.1", remotePort: port });
  return { handle: f.handle, port: f.localPort };
}

// modules/services/browser/src/scripts.ts
var PRELUDE = String.raw`
const roots = [document];
(function collect(doc, depth) {
  if (depth > 6) return;
  for (const el of doc.querySelectorAll("*")) {
    if (el.shadowRoot) { roots.push(el.shadowRoot); collect(el.shadowRoot, depth + 1); }
    else if (el.tagName === "IFRAME" || el.tagName === "FRAME") {
      let d = null; try { d = el.contentDocument; } catch (e) {}
      if (d && d.documentElement) { roots.push(d); collect(d, depth + 1); }
    }
  }
})(document, 0);
const qa = sel => { const out = []; for (const r of roots) { try { for (const el of r.querySelectorAll(sel)) out.push(el); } catch (e) { if (r === document) throw e; } } return out; };
const norm = s => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
const win = el => el.ownerDocument.defaultView || window;
const shift = el => { let x = 0, y = 0; try { let w = win(el); while (w && w.frameElement) { const f = w.frameElement, r = f.getBoundingClientRect(); x += r.left + f.clientLeft; y += r.top + f.clientTop; w = w.parent; } } catch (e) {} return { x, y }; };
const rectOf = el => { const r = el.getBoundingClientRect(), s = shift(el); return { left: r.left + s.x, top: r.top + s.y, width: r.width, height: r.height, right: r.right + s.x, bottom: r.bottom + s.y }; };
const visible = el => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const cs = win(el).getComputedStyle(el); return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) !== 0; };
const INTERACTIVE = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=option],[role=switch],[role=combobox],[role=textbox],[role=searchbox],[role=spinbutton],[role=treeitem],[contenteditable=""],[contenteditable=true],[onclick],[tabindex]:not([tabindex="-1"])';
const FIELD = 'input:not([type=hidden]),select,textarea,[contenteditable=""],[contenteditable=true],[role=textbox],[role=searchbox],[role=combobox],[role=checkbox],[role=radio],[role=switch],[role=spinbutton]';
const ensureRef = el => {
  let ref = el.getAttribute("data-hato-ref");
  if (!ref) { const root = document.documentElement; const next = Number(root.getAttribute("data-hato-next") || "1"); ref = String(next); el.setAttribute("data-hato-ref", ref); root.setAttribute("data-hato-next", String(next + 1)); }
  return Number(ref);
};
const labelText = l => { const c = l.cloneNode(true); for (const x of c.querySelectorAll("select,textarea,option,input,button,script,style")) x.remove(); return c.textContent; };
const nameOf = el => {
  const aria = el.getAttribute("aria-label"); if (aria && norm(aria)) return norm(aria);
  const by = el.getAttribute("aria-labelledby");
  if (by) { const t = by.split(/\s+/).map(id => { const n = el.ownerDocument.getElementById(id); return n ? (n.innerText || n.textContent) : ""; }).join(" "); if (norm(t)) return norm(t); }
  if (el.labels && el.labels.length) { const t = [...el.labels].map(labelText).join(" "); if (norm(t)) return norm(t); }
  const tag = el.tagName.toLowerCase();
  if (tag === "input" && /^(button|submit|reset)$/.test(el.type) && el.value) return norm(el.value);
  const own = tag === "input" || tag === "textarea" || tag === "select" ? "" : norm(el.innerText || el.textContent);
  return own || norm(el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("alt") || el.getAttribute("name") || "");
};
const stateOf = el => {
  const s = {}; const tag = el.tagName.toLowerCase(); const type = String(el.type || "").toLowerCase();
  if (tag === "input" || tag === "textarea") {
    if (type === "checkbox" || type === "radio") s.checked = !!el.checked;
    else if (type === "password") s.value = el.value ? "•••" : "";
    else s.value = String(el.value == null ? "" : el.value).slice(0, 200);
  } else if (tag === "select") {
    s.value = el.selectedOptions && el.selectedOptions[0] ? norm(el.selectedOptions[0].text) : "";
  } else if (el.isContentEditable || /^(textbox|searchbox|combobox)$/.test(el.getAttribute("role") || "")) {
    const v = el.value != null && el.value !== "" ? el.value : norm(el.innerText); if (v) s.value = String(v).slice(0, 200);
  }
  const ac = el.getAttribute("aria-checked"); if (ac) s.checked = ac === "true";
  const as = el.getAttribute("aria-selected"); if (as) s.selected = as === "true";
  const ae = el.getAttribute("aria-expanded"); if (ae) s.expanded = ae === "true";
  const ap = el.getAttribute("aria-pressed"); if (ap) s.pressed = ap === "true";
  if (el.disabled || el.getAttribute("aria-disabled") === "true") s.disabled = true;
  if (el.readOnly || el.getAttribute("aria-readonly") === "true") s.readOnly = true;
  if (el.required || el.getAttribute("aria-required") === "true") s.required = true;
  if (el.getAttribute("aria-invalid") === "true" || (el.validity && !el.validity.valid && el.willValidate && s.value)) s.invalid = true;
  try { if (el.ownerDocument.activeElement === el) s.focused = true; } catch (e) {}
  return s;
};
const describe = el => {
  if (!el) return null;
  const d = { tag: el.tagName.toLowerCase(), name: nameOf(el).slice(0, 100), ref: ensureRef(el) };
  const role = el.getAttribute("role"); if (role) d.role = role;
  if (el.tagName === "INPUT") d.type = String(el.type || "").toLowerCase();
  Object.assign(d, stateOf(el));
  try { if (el.matches(":hover")) d.hovered = true; } catch (e) {}
  return d;
};
const deepAt = (x, y) => {
  let doc = document, ox = 0, oy = 0, el = null;
  for (let i = 0; i < 8; i++) {
    el = doc.elementFromPoint(x - ox, y - oy);
    if (!el) return null;
    while (el.shadowRoot && el.shadowRoot.elementFromPoint) { const inner = el.shadowRoot.elementFromPoint(x - ox, y - oy); if (!inner || inner === el) break; el = inner; }
    if ((el.tagName === "IFRAME" || el.tagName === "FRAME")) {
      let d = null; try { d = el.contentDocument; } catch (e) {}
      if (!d) return el;
      const r = el.getBoundingClientRect(); ox += r.left + el.clientLeft; oy += r.top + el.clientTop; doc = d; continue;
    }
    return el;
  }
  return el;
};
const impliedRole = el => {
  const r = el.getAttribute("role"); if (r) return r;
  const tag = el.tagName.toLowerCase(), type = String(el.type || "").toLowerCase();
  if (tag === "a") return "link"; if (tag === "button" || (tag === "input" && /^(button|submit|reset)$/.test(type))) return "button";
  if (tag === "select") return "combobox"; if (tag === "textarea" || (tag === "input" && !/^(checkbox|radio)$/.test(type))) return "textbox";
  if (tag === "input") return type; return "";
};
const rank = (n, want) => { const a = n.toLowerCase(), b = want.toLowerCase(); if (a === b) return 3; if (a.startsWith(b)) return 2; if (a.includes(b)) return 1; return 0; };
// Resolve a target description {ref, selector, name, label, role, nth} to one element.
function resolve(t) {
  if (t.ref) { const m = qa('[data-hato-ref="' + t.ref + '"]'); if (!m.length) return { error: "Element ref " + t.ref + " is gone; list elements again" }; return { el: m[0], matches: 1 }; }
  if (t.selector) {
    const m = qa(t.selector); if (!m.length) return { error: "No element matches " + t.selector };
    const vis = m.filter(visible), pick = vis.length ? vis : m;
    return { el: pick[Math.min(t.nth || 0, pick.length - 1)], matches: pick.length };
  }
  const want = norm(t.label || t.name);
  if (!want) return { error: "Give an element ref, a CSS selector, a name/label or x/y coordinates" };
  let pool = qa(t.label ? FIELD : INTERACTIVE).filter(visible);
  if (t.role) pool = pool.filter(el => impliedRole(el) === t.role);
  let scored = pool.map(el => ({ el, s: rank(nameOf(el), want), len: nameOf(el).length })).filter(c => c.s > 0);
  if (!scored.length && t.label) {
    // Custom form controls: a label-like element followed by a field in the same container.
    for (const l of qa("label,legend,span,div,dt,th,p")) {
      if (l.children.length > 2 || !visible(l) || rank(norm(l.innerText || l.textContent), want) < 2) continue;
      let field = l.control || null;
      for (let up = l, i = 0; !field && up && i < 4; up = up.parentElement, i++) { const f = [...up.querySelectorAll(FIELD)].filter(visible); if (f.length) field = f[0]; }
      if (field) scored.push({ el: field, s: 1, len: 0 });
    }
  }
  if (!scored.length && !t.label) {
    for (const el of qa("*")) {
      if (el.children.length > 3 || !visible(el)) continue;
      const n = norm(el.innerText || el.textContent); if (!n || n.length > 200) continue;
      const s = rank(n, want); if (s > 0) scored.push({ el: el.closest(INTERACTIVE) || el, s, len: n.length });
    }
  }
  if (!scored.length) return { error: 'No visible element named "' + want + '"; use browser_elements to see what is on the page' };
  const best = Math.max(...scored.map(c => c.s));
  let top = scored.filter(c => c.s === best);
  const minLen = Math.min(...top.map(c => c.len)); top = top.filter(c => c.len === minLen);
  const seen = new Set(); top = top.filter(c => !seen.has(c.el) && seen.add(c.el));
  return { el: top[Math.min(t.nth || 0, top.length - 1)].el, matches: top.length };
}
`;
var TEXT_FN = `function(scope, selector, max) {
  ${PRELUDE}
  let root = document.body;
  if (selector) { const r = resolve({ selector }); if (r.error) return { error: r.error }; root = r.el; }
  const vw = innerWidth, vh = innerHeight;
  if (scope !== "viewport") {
    let t = (root.innerText || "").replace(/\\n{3,}/g, "\\n\\n").trim();
    if (!selector) for (const r of roots) {
      if (r === document || r.nodeType !== 9 || !r.body) continue;
      const f = (r.body.innerText || "").replace(/\\n{3,}/g, "\\n\\n").trim();
      if (f) t += "\\n\\n[iframe]\\n" + f;
    }
    return { text: t.slice(0, max), total: t.length, truncated: t.length > max };
  }
  const out = []; let len = 0; let last = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const s = n.nodeValue.replace(/\\s+/g, " ").trim();
    if (!s) continue;
    const el = n.parentElement;
    if (!el) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
    range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.right < 0 || r.top > vh || r.left > vw) continue;
    const block = el.closest("p,li,h1,h2,h3,h4,h5,h6,tr,div,section,article,header,footer,nav,td,th,label,button,a") || el;
    out.push((last && last !== block ? "\\n" : " ") + s); last = block;
    len += s.length + 1; if (len > max) break;
  }
  const t = out.join("").replace(/^\\s+/, "").replace(/ \\n/g, "\\n");
  return { text: t.slice(0, max), total: t.length, truncated: len > max };
}`;
var ELEMENTS_FN = `function(all, max, fields, selector) {
  ${PRELUDE}
  const vw = innerWidth, vh = innerHeight;
  let list;
  if (selector) { const r = resolve({ selector }); if (r.error) return { error: r.error }; list = [...r.el.querySelectorAll(fields ? FIELD : INTERACTIVE)]; if (r.el.matches(fields ? FIELD : INTERACTIVE)) list.unshift(r.el); }
  else list = qa(fields ? FIELD : INTERACTIVE);
  const out = [];
  for (const el of list) {
    const r = rectOf(el);
    if (r.width < 2 || r.height < 2) continue;
    const cs = win(el).getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || (!fields && cs.pointerEvents === "none")) continue;
    const inView = !(r.bottom < 0 || r.right < 0 || r.top > vh || r.left > vw);
    if (!all && !inView) continue;
    const tag = el.tagName.toLowerCase();
    const name = nameOf(el).slice(0, 120);
    const item = { ref: ensureRef(el), tag, role: el.getAttribute("role") || undefined, text: name || norm(el.value).slice(0, 120), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height), inView };
    if (tag === "input") item.type = String(el.type || "").toLowerCase();
    Object.assign(item, stateOf(el));
    if (tag === "a") item.href = el.href;
    if (tag === "select") item.options = [...el.options].slice(0, 50).map(o => ({ text: norm(o.text), value: o.value, selected: o.selected || undefined }));
    out.push(item);
    if (out.length >= max) break;
  }
  return { elements: out, viewport: { width: vw, height: vh }, scroll: { x: scrollX, y: scrollY } };
}`;
var LOCATE_FN = `function(t, scroll) {
  ${PRELUDE}
  let el, matches = 1;
  if (typeof t.x === "number" && typeof t.y === "number") {
    el = deepAt(t.x, t.y);
    return { x: t.x, y: t.y, point: true, target: describe(el), editable: el ? !!(el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName)) : undefined };
  }
  const r = resolve(t);
  if (r.error) return { error: r.error };
  el = r.el; matches = r.matches;
  if (scroll) el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  const rect = rectOf(el);
  const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
  const out = { x, y, matches, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }, target: describe(el), editable: !!(el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName)) };
  const top = deepAt(x, y);
  if (top && top !== el && !el.contains(top) && !top.contains(el)) out.coveredBy = describe(top);
  if (!(rect.width >= 1 && rect.height >= 1)) out.hidden = true;
  return out;
}`;
var CLEAR_FN = `function(t) {
  ${PRELUDE}
  let el;
  if (t && (t.ref || t.selector || t.name || t.label)) { const r = resolve(t); el = r.el; }
  else {
    el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    while (el && /^i?frame$/i.test(el.tagName)) { let d = null; try { d = el.contentDocument; } catch (e) {} if (!d || !d.activeElement) break; el = d.activeElement; }
  }
  if (!el || el === document.body) return false;
  el.focus();
  if (typeof el.select === "function") { el.select(); return true; }
  if (el.isContentEditable) { const d = el.ownerDocument; const r = d.createRange(); r.selectNodeContents(el); const s = d.defaultView.getSelection(); s.removeAllRanges(); s.addRange(r); return true; }
  return false;
}`;
var READBACK_FN = `function() {
  ${PRELUDE}
  let el = document.activeElement;
  while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
  while (el && /^i?frame$/i.test(el.tagName)) { let d = null; try { d = el.contentDocument; } catch (e) {} if (!d || !d.activeElement) break; el = d.activeElement; }
  if (!el || el === document.body) return null;
  const s = stateOf(el);
  const typed = el.tagName === "INPUT" ? el.value : el.tagName === "TEXTAREA" ? el.value : el.isContentEditable ? el.innerText : null;
  return { target: describe(el), value: typeof typed === "string" ? (String(el.type).toLowerCase() === "password" ? null : typed) : null, state: s };
}`;
var SELECT_FN = `function(t, option) {
  ${PRELUDE}
  const r = resolve(t);
  if (r.error) return { error: r.error };
  const el = r.el;
  if (el.tagName !== "SELECT") return { native: false };
  const want = norm(option).toLowerCase();
  const opts = [...el.options];
  let match = opts.find(o => norm(o.text).toLowerCase() === want || o.value.toLowerCase() === want) || opts.find(o => norm(o.text).toLowerCase().includes(want));
  if (!match) return { error: 'No option "' + option + '"', options: opts.slice(0, 50).map(o => norm(o.text)) };
  if (match.disabled) return { error: 'Option "' + norm(match.text) + '" is disabled' };
  el.value = match.value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { native: true, selected: norm(match.text), value: match.value };
}`;
var OPTION_FN = `function(option) {
  ${PRELUDE}
  const want = norm(option);
  const pool = qa('[role=option],[role=menuitem],[role=menuitemradio],[role=menuitemcheckbox],[role=treeitem],[role=listitem],[data-value],li,[class*=option i],[class*=item i]').filter(visible);
  const scored = pool.map(el => { const n = norm(el.innerText || el.textContent); return { el, n, s: rank(n, want) }; }).filter(c => c.s > 0 && c.n.length < 300);
  if (!scored.length) return { error: 'No visible option "' + want + '"', available: pool.slice(0, 20).map(el => norm(el.innerText || el.textContent).slice(0, 60)).filter(Boolean) };
  const best = Math.max(...scored.map(c => c.s));
  const top = scored.filter(c => c.s === best).sort((a, b) => a.n.length - b.n.length)[0];
  const rect = rectOf(top.el);
  return { ref: ensureRef(top.el), name: top.n.slice(0, 100), x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}`;
var SCROLL_FN = `function(x, y, to) {
  ${PRELUDE}
  const scrollable = el => { const cs = win(el).getComputedStyle(el); return /(auto|scroll|overlay)/.test(cs.overflowY + cs.overflowX) && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1); };
  let el = deepAt(x, y), box = null;
  for (; el && el !== document.documentElement && el !== document.body; el = el.parentElement || (el.getRootNode && el.getRootNode().host) || null) {
    if (scrollable(el)) { box = el; break; }
  }
  const page = { x: Math.round(scrollX), y: Math.round(scrollY), height: document.documentElement.scrollHeight, viewportHeight: innerHeight };
  if (!box) {
    if (to) window.scrollTo(page.x, to === "top" ? 0 : document.documentElement.scrollHeight);
    const y2 = Math.round(scrollY);
    return to ? { target: "page", x: Math.round(scrollX), y: y2, height: page.height, viewportHeight: page.viewportHeight, atTop: y2 <= 0, atBottom: y2 + innerHeight >= page.height - 1 } : { target: "page", ...page, atTop: page.y <= 0, atBottom: page.y + innerHeight >= page.height - 1 };
  }
  if (to) box.scrollTop = to === "top" ? 0 : box.scrollHeight;
  return { target: describe(box), x: Math.round(box.scrollLeft), y: Math.round(box.scrollTop), height: box.scrollHeight, viewportHeight: box.clientHeight,
    atTop: box.scrollTop <= 0, atBottom: box.scrollTop + box.clientHeight >= box.scrollHeight - 1, page };
}`;
var PAGE_STATE_FN = `function() {
  ${PRELUDE}
  if (!window.__hatoQuiet) {
    const st = window.__hatoQuiet = { last: performance.now() };
    try { new MutationObserver(() => { st.last = performance.now(); }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "hidden", "aria-busy", "aria-hidden", "disabled", "open"] }); } catch (e) {}
  }
  let busy = false, busyReason;
  if (document.querySelector('[aria-busy="true"]')) { busy = true; busyReason = "aria-busy element present"; }
  else {
    const hits = qa('[role=progressbar],[class*="spinner" i],[class*="skeleton" i],[class*="loading" i],[class*="loader" i],[class*="shimmer" i]');
    for (let i = 0, n = 0; i < hits.length && n < 40; i++, n++) {
      const el = hits[i], r = rectOf(el);
      if (r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < innerHeight && visible(el)) { busy = true; busyReason = "loading indicator visible (" + (el.getAttribute("role") || String(el.className).slice(0, 40)) + ")"; break; }
    }
  }
  let focused = null;
  try {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    if (el && el !== document.body && el !== document.documentElement) focused = describe(el);
  } catch (e) {}
  return { readyState: document.readyState, quietMs: performance.now() - window.__hatoQuiet.last, busy, busyReason, focused };
}`;
var QUIET_INSTALL = `(() => {
  if (window.__hatoQuiet) return;
  const st = window.__hatoQuiet = { last: performance.now() };
  try { new MutationObserver(() => { st.last = performance.now(); }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "hidden", "aria-busy", "aria-hidden", "disabled", "open"] }); } catch (e) {}
})();`;
var WAIT_FN = `function(selector, text, selectorGone, textGone) {
  ${PRELUDE}
  const r = {};
  const present = sel => qa(sel).some(visible);
  const hay = () => {
    let t = (document.body && document.body.innerText) || "";
    for (const root of roots) if (root !== document && root.nodeType === 9 && root.body) t += "\\n" + (root.body.innerText || "");
    for (const el of qa("input,textarea,select")) { try { if (el.type !== "password" && el.value) t += "\\n" + el.value; } catch (e) {} }
    return norm(t).toLowerCase();
  };
  const text1 = text ? norm(text).toLowerCase() : "", text2 = textGone ? norm(textGone).toLowerCase() : "";
  const h = text1 || text2 ? hay() : "";
  if (selector) r.selector = present(selector);
  if (text) r.text = h.includes(text1);
  if (selectorGone) r.selectorGone = !present(selectorGone);
  if (textGone) r.textGone = !h.includes(text2);
  r.readyState = document.readyState;
  return r;
}`;

// modules/services/browser/src/session.ts
var sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));
var NETWORK_LIMIT = 1e3;
var CONSOLE_LIMIT = 500;
var PENDING_TYPES = /* @__PURE__ */ new Set(["Document", "XHR", "Fetch"]);
var SPECIAL = {
  Enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  Tab: { key: "Tab", code: "Tab", keyCode: 9 },
  Escape: { key: "Escape", code: "Escape", keyCode: 27 },
  Backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  Delete: { key: "Delete", code: "Delete", keyCode: 46 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  Home: { key: "Home", code: "Home", keyCode: 36 },
  End: { key: "End", code: "End", keyCode: 35 },
  PageUp: { key: "PageUp", code: "PageUp", keyCode: 33 },
  PageDown: { key: "PageDown", code: "PageDown", keyCode: 34 },
  Space: { key: " ", code: "Space", keyCode: 32, text: " " },
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, { key: `F${i + 1}`, code: `F${i + 1}`, keyCode: 112 + i }]))
};
var ALIASES = {
  enter: "Enter",
  return: "Enter",
  tab: "Tab",
  escape: "Escape",
  esc: "Escape",
  backspace: "Backspace",
  delete: "Delete",
  left: "ArrowLeft",
  right: "ArrowRight",
  up: "ArrowUp",
  down: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  space: "Space",
  " ": "Space"
};
function keyDef(name) {
  const special = SPECIAL[name] || SPECIAL[ALIASES[name.toLowerCase()] || ""] || (/^f\d{1,2}$/i.test(name) ? SPECIAL[name.toUpperCase()] : void 0);
  if (special) return special;
  if ([...name].length !== 1) return null;
  const upper = name.toUpperCase();
  if (/[A-Z]/.test(upper)) return { key: name, code: `Key${upper}`, keyCode: upper.charCodeAt(0), text: name };
  if (/[0-9]/.test(name)) return { key: name, code: `Digit${name}`, keyCode: name.charCodeAt(0), text: name };
  return { key: name, code: "", keyCode: 0, text: name };
}
function editCommands(def, m) {
  const k = def.key.toLowerCase();
  if (m.meta || m.ctrl) {
    if (k === "a") return ["selectAll"];
    if (k === "z") return [m.shift ? "redo" : "undo"];
    if (k === "y") return ["redo"];
    if (k === "x") return ["cut"];
    if (k === "c") return ["copy"];
    if (m.meta && k === "arrowleft") return [m.shift ? "moveToBeginningOfLineAndModifySelection" : "moveToBeginningOfLine"];
    if (m.meta && k === "arrowright") return [m.shift ? "moveToEndOfLineAndModifySelection" : "moveToEndOfLine"];
    if (m.meta && k === "backspace") return ["deleteToBeginningOfLine"];
  }
  if (m.alt) {
    if (k === "arrowleft") return [m.shift ? "moveWordLeftAndModifySelection" : "moveWordLeft"];
    if (k === "arrowright") return [m.shift ? "moveWordRightAndModifySelection" : "moveWordRight"];
    if (k === "backspace") return ["deleteWordBackward"];
  }
  return [];
}
var modBits = (m = {}) => (m.alt ? 1 : 0) | (m.ctrl ? 2 : 0) | (m.meta ? 4 : 0) | (m.shift ? 8 : 0);
var BrowserSession = class {
  constructor(ctx, spec, changed, carry) {
    this.ctx = ctx;
    this.spec = spec;
    this.changed = changed;
    this.status = "stopped";
    this.cdp = null;
    this.tabs = /* @__PURE__ */ new Map();
    this.activeTab = null;
    this.surface = null;
    this.network = [];
    this.netSeq = 0;
    this.consoleLog = [];
    this.consoleSeq = 0;
    /** Network sequence at the start of the latest agent action, so waits can match requests it caused. */
    this.actionSeq = 0;
    this.netIndex = /* @__PURE__ */ new Map();
    this.pending = /* @__PURE__ */ new Map();
    this.lastSeen = /* @__PURE__ */ new Map();
    this.machine = null;
    this.launched = null;
    this.wsUrl = "";
    this.forwardHandle = null;
    this.screencastSession = null;
    this.cursor = { x: 0, y: 0, shown: false };
    this.stopping = false;
    this.starting = null;
    this.retries = 0;
    this.bySession = /* @__PURE__ */ new Map();
    this.loadWaiters = /* @__PURE__ */ new Set();
    this.titleTimer = null;
    if (carry?.surface) this.surface = carry.surface;
    if (carry?.proc && carry.profile && carry.key) this.launched = { handle: carry.proc, profile: carry.profile, key: carry.key, daemon: carry.daemon ?? null };
  }
  get viewport() {
    return this.spec.viewport || DEFAULT_VIEWPORT;
  }
  carry() {
    return {
      surface: this.surface || void 0,
      proc: this.launched?.handle,
      profile: this.launched?.profile,
      key: this.launched?.key,
      daemon: this.launched?.daemon,
      ws: this.cdp?.handle,
      forward: this.forwardHandle
    };
  }
  view() {
    const tab2 = this.activeTab ? this.tabs.get(this.activeTab) : void 0;
    return {
      id: this.spec.id,
      name: this.spec.name,
      location: this.spec.location,
      locationLabel: locationLabel(this.spec.location),
      status: this.status,
      error: this.error,
      progress: this.progress,
      agentAccess: !!this.spec.agentAccess,
      headed: !!this.spec.headed,
      keepProfile: this.spec.keepProfile !== false,
      viewport: this.viewport,
      surface: this.surface,
      tabs: [...this.tabs.values()].map((t) => ({ id: t.id, title: t.title, url: t.url, loading: t.loading, active: t.id === this.activeTab })),
      activeTab: this.activeTab,
      url: tab2?.url || "",
      title: tab2?.title || "",
      loading: !!tab2?.loading,
      canGoBack: !!tab2?.history?.back,
      canGoForward: !!tab2?.history?.forward,
      agent: this.agent,
      network: { count: this.network.length, seq: this.netSeq },
      executable: this.executable
    };
  }
  set(status, extra = {}) {
    this.status = status;
    this.error = extra.error;
    this.progress = extra.progress;
    this.changed();
  }
  // ------------------------------------------------------------------ lifecycle
  start() {
    if (this.status === "running" && this.cdp && !this.cdp.closed) return Promise.resolve();
    if (!this.starting) this.starting = this.doStart().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }
  async doStart() {
    this.stopping = false;
    this.set("starting", { progress: "Connecting…" });
    try {
      if (!this.surface) this.surface = (await this.ctx.host.ui.surfaceOpen({ label: `browser ${this.spec.name}` })).handle;
      const deadline = Date.now() + 45e3;
      let lastError;
      for (let attempt = 0; Date.now() < deadline; attempt++) {
        try {
          this.wsUrl = await this.resolveUrl(attempt > 0);
          this.cdp = await Cdp.connect(this.ctx, this.wsUrl);
          break;
        } catch (e) {
          lastError = e;
          if (this.spec.location.kind === "endpoint" || this.stopping) throw e;
          await sleep2(500);
        }
      }
      if (!this.cdp) throw lastError || new Error("Could not connect to the browser");
      const cdp = this.cdp;
      cdp.onClose = (reason) => this.lost(cdp, reason);
      this.wire(cdp);
      await cdp.send("Target.setDiscoverTargets", { discover: true });
      const { targetInfos } = await cdp.send("Target.getTargets");
      const pages = (targetInfos || []).filter((t) => t.type === "page");
      for (const t of pages) this.tabs.set(t.targetId, { id: t.targetId, url: t.url, title: t.title, loading: false, openerId: t.openerId });
      if (!pages.length) {
        const { targetId } = await cdp.send("Target.createTarget", { url: this.spec.startUrl || "about:blank" });
        this.tabs.set(targetId, { id: targetId, url: "about:blank", title: "", loading: false });
      }
      await Promise.all([...this.tabs.keys()].map((id) => this.attach(id).catch((e) => this.ctx.log.warn("attach tab", errMsg(e)))));
      const first = this.activeTab && this.tabs.has(this.activeTab) ? this.activeTab : [...this.tabs.keys()][0];
      this.retries = 0;
      this.set("running");
      if (this.titleTimer === null) this.titleTimer = setInterval(() => {
        if (this.activeTab) this.syncTitle(this.activeTab).catch(() => {
        });
      }, 2e3);
      if (first) await this.activate(first);
      this.watchProcess();
    } catch (e) {
      this.set("error", { error: errMsg(e) });
      throw e;
    }
  }
  async resolveUrl(retry) {
    if (this.spec.location.kind === "endpoint") {
      this.progress = "Contacting endpoint…";
      this.changed();
      return endpointUrl(this.ctx, this.spec.location.url);
    }
    if (!this.machine) this.machine = await machineFor(this.ctx, this.spec);
    const m = this.machine;
    if (!this.launched) {
      this.progress = "Locating browser…";
      this.changed();
      let bin = await findBrowser(this.ctx, m, this.spec.executable);
      if (!bin) {
        this.progress = "Downloading a headless browser…";
        this.changed();
        bin = await installHeadlessShell(this.ctx, m);
      }
      this.executable = bin;
      this.progress = "Starting browser…";
      this.changed();
      this.launched = await launch(this.ctx, m, this.spec, bin, this.viewport);
    }
    if (retry && this.forwardHandle) {
      await this.ctx.host.ssh.cancelForward(this.forwardHandle).catch(() => {
      });
      this.forwardHandle = null;
    }
    const { port, path } = await devtoolsPort(this.ctx, m, this.launched.profile);
    if (!this.forwardHandle || retry) {
      const f = await forward(this.ctx, m, port);
      this.forwardHandle = f.handle;
      return `ws://127.0.0.1:${f.port}${path}`;
    }
    return this.wsUrl;
  }
  watchProcess() {
    const l = this.launched;
    if (!l) return;
    this.ctx.host.process.wait(l.handle).then((exit) => {
      if (this.launched !== l || this.stopping) return;
      if (exit === null) return;
      this.launched = null;
      this.teardown();
      this.set("error", { error: `The browser exited${exit.code !== null ? ` (code ${exit.code})` : exit.signal !== null ? ` (signal ${exit.signal})` : ""}` });
    }).catch(() => {
    });
  }
  lost(cdp, reason) {
    if (this.cdp !== cdp) return;
    this.cdp = null;
    this.tabs.clear();
    this.bySession.clear();
    this.screencastSession = null;
    if (this.stopping) return;
    this.set("error", { error: `Connection lost: ${reason}` });
    if (this.retries++ < 3) setTimeout(() => {
      if (!this.stopping && this.status === "error") this.start().catch(() => {
      });
    }, 1500 * this.retries);
  }
  teardown() {
    if (this.titleTimer !== null) {
      clearInterval(this.titleTimer);
      this.titleTimer = null;
    }
    const cdp = this.cdp;
    this.cdp = null;
    if (cdp) cdp.close().catch(() => {
    });
    if (this.forwardHandle) {
      this.ctx.host.ssh.cancelForward(this.forwardHandle).catch(() => {
      });
      this.forwardHandle = null;
    }
    this.tabs.clear();
    this.bySession.clear();
    this.screencastSession = null;
  }
  /** Disconnect; `kill` also ends the browser process (its profile stays when kept). */
  async stop(kill = true) {
    this.stopping = true;
    this.teardown();
    if (kill && this.launched) {
      const l = this.launched;
      this.launched = null;
      try {
        if (l.daemon) await this.ctx.host.daemon.request(l.daemon, "proc.kill", { key: l.key });
        else await this.ctx.host.process.terminate(l.handle);
      } catch (e) {
        this.ctx.log.warn("stop browser", errMsg(e));
      }
    }
    if (this.surface) await this.ctx.host.ui.surfaceClear(this.surface).catch(() => {
    });
    this.set("stopped");
  }
  /** Release native resources on module unload without ending the browser. */
  async detach() {
    this.stopping = true;
    if (this.titleTimer !== null) {
      clearInterval(this.titleTimer);
      this.titleTimer = null;
    }
    const cdp = this.cdp;
    this.cdp = null;
    if (cdp) await cdp.close().catch(() => {
    });
  }
  async removeProfile() {
    if (this.spec.location.kind === "endpoint") return;
    const m = this.machine || await machineFor(this.ctx, this.spec);
    const dir = `${m.stateDir}/profiles/${this.spec.id.replace(/[^A-Za-z0-9_-]/g, "_")}`;
    await this.ctx.host.process.run(m.grant.grant, { target: m.target, executable: "rm", args: ["-rf", dir], cwd: m.grant.root }, { timeoutMs: 3e4 });
  }
  // ------------------------------------------------------------------ CDP wiring
  tabOf(sessionId) {
    return sessionId ? this.bySession.get(sessionId) : void 0;
  }
  wire(cdp) {
    cdp.on("Target.targetCreated", ({ targetInfo: t }) => {
      if (t.type !== "page" || this.tabs.has(t.targetId)) return;
      this.tabs.set(t.targetId, { id: t.targetId, url: t.url, title: t.title, loading: true, openerId: t.openerId });
      this.attach(t.targetId).then(() => {
        if (t.openerId && t.openerId === this.activeTab) return this.activate(t.targetId);
      }).catch((e) => this.ctx.log.warn("attach", errMsg(e)));
      this.changed();
    });
    cdp.on("Target.targetInfoChanged", ({ targetInfo: t }) => {
      const tab2 = this.tabs.get(t.targetId);
      if (!tab2) return;
      const navigated = tab2.url !== t.url;
      tab2.url = t.url;
      if (navigated || t.title && t.title !== t.url) tab2.title = t.title;
      this.changed();
      if (navigated) this.syncTitle(t.targetId).catch(() => {
      });
    });
    cdp.on("Target.targetDestroyed", ({ targetId }) => {
      const tab2 = this.tabs.get(targetId);
      if (!tab2) return;
      this.tabs.delete(targetId);
      if (tab2.session) this.bySession.delete(tab2.session);
      if (this.activeTab === targetId) {
        this.activeTab = null;
        const next = tab2.openerId && this.tabs.has(tab2.openerId) ? tab2.openerId : [...this.tabs.keys()].pop();
        if (next) this.activate(next).catch(() => {
        });
        else if (this.cdp) this.newTab("about:blank").catch(() => {
        });
      }
      this.changed();
    });
    cdp.on("Page.frameStartedLoading", ({ frameId }, s) => {
      const id = this.tabOf(s);
      const tab2 = id && this.tabs.get(id);
      if (tab2 && frameId === id) {
        tab2.loading = true;
        this.changed();
      }
    });
    cdp.on("Page.frameStoppedLoading", ({ frameId }, s) => {
      const id = this.tabOf(s);
      const tab2 = id && this.tabs.get(id);
      if (tab2 && frameId === id) {
        tab2.loading = false;
        this.changed();
        this.refreshHistory(id).catch(() => {
        });
        this.syncTitle(id).catch(() => {
        });
      }
    });
    cdp.on("Page.loadEventFired", (_p, s) => {
      for (const w of [...this.loadWaiters]) if (w.session === s) {
        this.loadWaiters.delete(w);
        w.resolve();
      }
    });
    cdp.on("Page.navigatedWithinDocument", (_p, s) => {
      const id = this.tabOf(s);
      if (id) this.refreshHistory(id).catch(() => {
      });
    });
    cdp.on("Page.frameNavigated", ({ frame }, s) => {
      const id = this.tabOf(s);
      if (id && !frame.parentId) this.refreshHistory(id).catch(() => {
      });
    });
    cdp.on("Page.screencastFrame", (p, s) => this.frame(p, s));
    cdp.on("Page.javascriptDialogOpening", (p, s) => {
      cdp.send("Page.handleJavaScriptDialog", { accept: true, promptText: p.defaultPrompt || "" }, s).catch(() => {
      });
      this.agent = { at: Date.now(), text: `Dialog: ${String(p.message || "").slice(0, 120)}` };
      this.changed();
    });
    const note = (level, text, s, extra = {}) => {
      this.consoleLog.push({ seq: ++this.consoleSeq, tab: this.tabOf(s) || "", level, text: text.slice(0, 2e3), at: Date.now(), ...extra });
      if (this.consoleLog.length > CONSOLE_LIMIT) this.consoleLog.shift();
    };
    const show = (a) => a.value !== void 0 ? typeof a.value === "string" ? a.value : JSON.stringify(a.value) : a.description || a.unserializableValue || a.type;
    cdp.on("Runtime.consoleAPICalled", (p, s) => note(p.type === "warning" ? "warn" : p.type, (p.args || []).map(show).join(" "), s, { url: p.stackTrace?.callFrames?.[0]?.url, line: p.stackTrace?.callFrames?.[0]?.lineNumber }));
    cdp.on("Runtime.exceptionThrown", (p, s) => {
      const d = p.exceptionDetails || {};
      note("exception", d.exception?.description || d.text || "Uncaught exception", s, { url: d.url, line: d.lineNumber });
    });
    cdp.on("Log.entryAdded", (p, s) => note(p.entry?.level === "warning" ? "warn" : p.entry?.level || "log", `${p.entry?.text || ""}${p.entry?.url ? ` (${p.entry.url})` : ""}`, s, { url: p.entry?.url, line: p.entry?.lineNumber }));
    cdp.on("Network.requestWillBeSent", (p, s) => {
      const tab2 = this.tabOf(s) || "";
      const prev = this.netIndex.get(p.requestId);
      if (prev && p.redirectResponse) {
        prev.status = p.redirectResponse.status;
        prev.statusText = p.redirectResponse.statusText;
        prev.durationMs = Math.round((p.timestamp - prev._ts) * 1e3);
        this.netIndex.delete(p.requestId);
      }
      const e = {
        seq: ++this.netSeq,
        requestId: p.requestId,
        tab: tab2,
        url: p.request.url,
        method: p.request.method,
        type: p.type,
        startedAt: Math.round((p.wallTime || Date.now() / 1e3) * 1e3),
        requestHeaders: p.request.headers,
        postData: typeof p.request.postData === "string" ? p.request.postData.slice(0, 2e4) : void 0
      };
      Object.defineProperty(e, "_ts", { value: p.timestamp, enumerable: false, writable: true });
      this.netIndex.set(p.requestId, e);
      if (PENDING_TYPES.has(p.type)) this.pending.set(p.requestId, { tab: tab2, at: Date.now() });
      this.network.push(e);
      if (this.network.length > NETWORK_LIMIT) {
        const old = this.network.shift();
        if (this.netIndex.get(old.requestId) === old) this.netIndex.delete(old.requestId);
      }
      this.changed();
    });
    cdp.on("Network.responseReceived", (p) => {
      const e = this.netIndex.get(p.requestId);
      if (!e) return;
      e.status = p.response.status;
      e.statusText = p.response.statusText;
      e.mimeType = p.response.mimeType;
      e.responseHeaders = p.response.headers;
      e.fromCache = !!(p.response.fromDiskCache || p.response.fromServiceWorker || p.response.fromPrefetchCache);
      e.type = p.type || e.type;
      this.netSeq++;
      this.changed();
    });
    cdp.on("Network.loadingFinished", (p) => {
      this.pending.delete(p.requestId);
      const e = this.netIndex.get(p.requestId);
      if (!e) return;
      e.encodedBytes = p.encodedDataLength;
      e.durationMs = Math.round((p.timestamp - e._ts) * 1e3);
      this.netSeq++;
      this.changed();
    });
    cdp.on("Network.loadingFailed", (p) => {
      this.pending.delete(p.requestId);
      const e = this.netIndex.get(p.requestId);
      if (!e) return;
      e.failed = true;
      e.error = p.canceled ? "canceled" : p.errorText || p.blockedReason || "failed";
      e.durationMs = Math.round((p.timestamp - e._ts) * 1e3);
      this.netSeq++;
      this.changed();
    });
  }
  async attach(targetId) {
    const cdp = this.cdp;
    const tab2 = this.tabs.get(targetId);
    if (!tab2 || tab2.session) return;
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    tab2.session = sessionId;
    this.bySession.set(sessionId, targetId);
    const vp = this.viewport;
    await Promise.all([
      cdp.send("Page.enable", {}, sessionId),
      cdp.send("Network.enable", { maxPostDataSize: 2e4 }, sessionId),
      cdp.send("Runtime.enable", {}, sessionId).catch(() => {
      }),
      cdp.send("Log.enable", {}, sessionId).catch(() => {
      }),
      cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: QUIET_INSTALL }, sessionId).catch(() => {
      }),
      this.spec.headed ? Promise.resolve() : cdp.send("Emulation.setDeviceMetricsOverride", { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: false }, sessionId),
      cdp.send("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => {
      })
    ]);
    await this.refreshHistory(targetId).catch(() => {
    });
  }
  /** Target info does not report every title change (data: URLs, script-set titles). */
  async syncTitle(targetId) {
    const tab2 = this.tabs.get(targetId);
    if (!tab2?.session || !this.cdp) return;
    const r = await this.cdp.send("Runtime.evaluate", { expression: "document.title", returnByValue: true }, tab2.session, 5e3);
    const title = typeof r.result?.value === "string" ? r.result.value : "";
    if (title && title !== tab2.title) {
      tab2.title = title;
      this.changed();
    }
  }
  async refreshHistory(targetId) {
    const tab2 = this.tabs.get(targetId);
    if (!tab2?.session || !this.cdp) return;
    const h = await this.cdp.send("Page.getNavigationHistory", {}, tab2.session);
    tab2.history = { back: h.currentIndex > 0, forward: h.currentIndex < h.entries.length - 1 };
    this.changed();
  }
  async frame(p, sessionId) {
    const cdp = this.cdp;
    if (!cdp) return;
    try {
      if (sessionId === this.screencastSession && this.surface) {
        await this.ctx.host.ui.surfaceFrame(this.surface, { data: p.data, width: p.metadata?.deviceWidth, height: p.metadata?.deviceHeight });
      }
    } catch (e) {
      this.ctx.log.warn("surface frame", errMsg(e));
    }
    cdp.send("Page.screencastFrameAck", { sessionId: p.sessionId }, sessionId).catch(() => {
    });
  }
  // ------------------------------------------------------------------ tabs
  tab(id) {
    const tab2 = this.tabs.get(id || this.activeTab || "");
    if (!tab2?.session) throw new Error(id ? `No tab ${id}` : "The session has no open tab");
    return tab2;
  }
  async activate(targetId) {
    const cdp = this.cdp;
    if (!cdp) throw new Error("The browser is not running");
    const tab2 = this.tabs.get(targetId);
    if (!tab2) throw new Error(`No tab ${targetId}`);
    if (!tab2.session) await this.attach(targetId);
    if (this.screencastSession && this.screencastSession !== tab2.session) await cdp.send("Page.stopScreencast", {}, this.screencastSession).catch(() => {
    });
    this.activeTab = targetId;
    this.screencastSession = tab2.session;
    const vp = this.viewport;
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 72, maxWidth: vp.width, maxHeight: vp.height, everyNthFrame: 1 }, tab2.session);
    if (this.spec.headed) await cdp.send("Target.activateTarget", { targetId }).catch(() => {
    });
    this.changed();
  }
  async newTab(url = "about:blank") {
    const cdp = this.need();
    const { targetId } = await cdp.send("Target.createTarget", { url: this.normalizeUrl(url) });
    if (!this.tabs.has(targetId)) this.tabs.set(targetId, { id: targetId, url, title: "", loading: true });
    await this.attach(targetId);
    await this.activate(targetId);
    return targetId;
  }
  async closeTab(targetId) {
    await this.need().send("Target.closeTarget", { targetId });
  }
  async setViewport(width, height) {
    const w = Math.round(Math.min(Math.max(width, 320), 3840)), h = Math.round(Math.min(Math.max(height, 240), 2400));
    this.spec.viewport = { width: w, height: h };
    const cdp = this.cdp;
    if (cdp && !this.spec.headed) {
      for (const t of this.tabs.values()) if (t.session) await cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false }, t.session).catch(() => {
      });
      if (this.activeTab) await this.activate(this.activeTab);
    }
    this.changed();
  }
  need() {
    if (!this.cdp || this.status !== "running") throw new Error(`Browser session "${this.spec.name}" is not running`);
    return this.cdp;
  }
  normalizeUrl(url) {
    const u = url.trim();
    if (!u) return "about:blank";
    if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return u;
    if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(u)) return `http://${u}`;
    if (/^[^\s/]+\.[^\s/]{2,}(\/|$)/.test(u)) return `https://${u}`;
    return `https://www.google.com/search?q=${encodeURIComponent(u)}`;
  }
  // ------------------------------------------------------------------ navigation
  waitLoad(session2, ms) {
    return new Promise((resolve) => {
      const w = { session: session2, resolve };
      this.loadWaiters.add(w);
      setTimeout(() => {
        if (this.loadWaiters.delete(w)) resolve();
      }, ms);
    });
  }
  async navigate(url, tabId, waitMs = 15e3) {
    const cdp = this.need(), tab2 = this.tab(tabId);
    this.actionSeq = this.netSeq;
    const loaded = this.waitLoad(tab2.session, waitMs);
    const r = await cdp.send("Page.navigate", { url: this.normalizeUrl(url) }, tab2.session);
    if (r.errorText) throw new Error(`Navigation failed: ${r.errorText}`);
    await loaded;
    return this.observe(tab2.id);
  }
  async history(action, tabId) {
    const cdp = this.need(), tab2 = this.tab(tabId);
    if (action === "reload") {
      const loaded2 = this.waitLoad(tab2.session, 15e3);
      this.actionSeq = this.netSeq;
      await cdp.send("Page.reload", {}, tab2.session);
      await loaded2;
      return this.observe(tab2.id);
    }
    if (action === "stop") {
      await cdp.send("Page.stopLoading", {}, tab2.session);
      return this.where(tab2.id);
    }
    const h = await cdp.send("Page.getNavigationHistory", {}, tab2.session);
    const index = h.currentIndex + (action === "back" ? -1 : 1);
    if (index < 0 || index >= h.entries.length) throw new Error(`Nothing to go ${action} to`);
    const loaded = this.waitLoad(tab2.session, 1e4);
    await cdp.send("Page.navigateToHistoryEntry", { entryId: h.entries[index].id }, tab2.session);
    await loaded;
    return this.observe(tab2.id);
  }
  where(tabId) {
    const tab2 = this.tabs.get(tabId || this.activeTab || "");
    return { session: this.spec.id, tab: tab2?.id, url: tab2?.url, title: tab2?.title, loading: tab2?.loading };
  }
  // ------------------------------------------------------------------ user input (from the panel)
  async userPointer(e) {
    const cdp = this.cdp, s = this.screencastSession;
    if (!cdp || !s) return;
    const type = e.kind === "down" ? "mousePressed" : e.kind === "up" ? "mouseReleased" : "mouseMoved";
    await cdp.send("Input.dispatchMouseEvent", {
      type,
      x: e.x,
      y: e.y,
      button: e.kind === "move" ? e.buttons & 1 ? "left" : e.buttons & 2 ? "right" : "none" : e.button || "left",
      buttons: e.buttons,
      clickCount: e.kind === "move" ? 0 : Math.max(1, e.clickCount),
      modifiers: modBits(e.modifiers)
    }, s);
  }
  async userWheel(e) {
    const cdp = this.cdp, s = this.screencastSession;
    if (!cdp || !s) return;
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: e.x, y: e.y, deltaX: e.deltaX, deltaY: e.deltaY }, s);
  }
  async userKey(e) {
    const cdp = this.cdp, s = this.screencastSession;
    if (!cdp || !s) return;
    if (e.kind === "paste") {
      await cdp.send("Input.insertText", { text: e.text }, s);
      return;
    }
    const def = keyDef(e.key);
    if (!def) return;
    const m = e.modifiers;
    const printable = !!e.text && !m.ctrl && !m.meta && [...e.text].length === 1 && e.text >= " ";
    const text = printable ? e.text : def.text && !m.ctrl && !m.meta ? def.text : void 0;
    if (e.kind === "up") {
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: printable ? e.text : def.key, code: def.code, windowsVirtualKeyCode: def.keyCode, modifiers: modBits(m) }, s);
      return;
    }
    await cdp.send("Input.dispatchKeyEvent", {
      type: text ? "keyDown" : "rawKeyDown",
      key: printable ? e.text : def.key,
      code: def.code,
      windowsVirtualKeyCode: def.keyCode,
      text,
      unmodifiedText: text,
      modifiers: modBits(m),
      commands: editCommands(def, m)
    }, s);
  }
  // ------------------------------------------------------------------ agent actions
  noteAgent(text, caller) {
    this.agent = { at: Date.now(), text, caller };
    this.changed();
  }
  async glide(x, y, click) {
    if (!this.surface) return;
    const from = this.cursor.shown ? this.cursor : { x: this.viewport.width / 2, y: this.viewport.height / 2 };
    const dist = Math.hypot(x - from.x, y - from.y);
    const durationMs = this.cursor.shown ? Math.round(Math.min(Math.max(220 + dist * 0.45, 250), 900)) : 0;
    if (!this.cursor.shown) await this.ctx.host.ui.surfaceCursor(this.surface, { x: from.x, y: from.y, durationMs: 0 });
    await this.ctx.host.ui.surfaceCursor(this.surface, { x, y, durationMs: Math.max(durationMs, 300), click });
    this.cursor = { x, y, shown: true };
    await sleep2(Math.max(durationMs, 300));
  }
  async evaluate(fn, args, tabId, awaitPromise = false) {
    const cdp = this.need(), tab2 = this.tab(tabId);
    const expression = `(${fn})(${args.map((a) => JSON.stringify(a ?? null)).join(",")})`;
    const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise, userGesture: true }, tab2.session, 3e4);
    if (r.exceptionDetails) throw new Error(`Page script failed: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result?.value;
  }
  pendingCount(tabId) {
    const now = Date.now();
    let n = 0;
    for (const [id, p] of this.pending) {
      if (now - p.at > 2e4) {
        this.pending.delete(id);
        continue;
      }
      if (p.tab === tabId) n++;
    }
    return n;
  }
  /** Is the page done changing? Combines document state, in-flight XHR/fetch, DOM quiet time and loading indicators. */
  async readiness(tabId, quietMs = 500) {
    const tab2 = this.tab(tabId);
    const page = await this.evaluate(PAGE_STATE_FN, [], tab2.id).catch(() => null);
    const pendingRequests = this.pendingCount(tab2.id);
    const quiet = page?.quietMs ?? 0;
    const settled = !!page && page.readyState === "complete" && !tab2.loading && pendingRequests === 0 && !page.busy && quiet >= quietMs;
    return {
      settled,
      readyState: page?.readyState ?? "unknown",
      pendingRequests,
      busy: !!page?.busy,
      ...page?.busyReason ? { busyReason: page.busyReason } : {},
      quietMs: Math.round(quiet),
      focused: page?.focused ?? null
    };
  }
  mark(tab2) {
    this.lastSeen.set(tab2.id, { url: tab2.url, title: tab2.title });
  }
  /** Post-action state: where we are, whether URL/title changed since the previous call, the focused element and readiness. */
  async observe(tabId) {
    const tab2 = this.tab(tabId);
    const { focused, ...page } = await this.readiness(tab2.id, 300);
    const prev = this.lastSeen.get(tab2.id);
    this.mark(tab2);
    return { ...this.where(tab2.id), changed: { url: !!prev && prev.url !== tab2.url, title: !!prev && prev.title !== tab2.title }, focused, page };
  }
  async text(scope, selector, maxChars = 2e4, tabId) {
    const r = await this.evaluate(TEXT_FN, [scope, selector || null, Math.min(Math.max(maxChars, 200), 2e5)], tabId);
    if (r?.error) throw new Error(r.error);
    const tab2 = this.tab(tabId);
    const { focused: _focused, ...ready } = await this.readiness(tab2.id);
    this.mark(tab2);
    return {
      ...this.where(tabId),
      ...r,
      contentLoaded: ready.settled,
      ready,
      ...ready.settled ? {} : { warning: "The page is not settled yet, so this text may be partial (loading spinners, pending requests or recent DOM changes). Use browser_wait with no arguments to wait until it settles, then read again." }
    };
  }
  /** Interactive elements. `fields` lists form controls only, with label, value and checked/selected/disabled state. */
  async elements(all = false, max = 200, tabId, opts = {}) {
    const r = await this.evaluate(ELEMENTS_FN, [all, Math.min(Math.max(max, 1), 1e3), !!opts.fields, opts.selector || null], tabId);
    if (r?.error) throw new Error(r.error);
    this.mark(this.tab(tabId));
    return { ...this.where(tabId), ...r };
  }
  async screenshot(opts) {
    const cdp = this.need(), tab2 = this.tab(opts.tab);
    const quality = opts.quality === "full" ? "full" : opts.quality === "tiny" ? "tiny" : "low";
    let crop = opts.region;
    if (!crop && (opts.ref || opts.selector || opts.name || opts.label)) {
      const p = await this.locate(opts, tab2.id);
      if (!p.rect) throw new Error("Could not measure the element to crop to");
      const pad = 8;
      crop = { x: p.rect.left - pad, y: p.rect.top - pad, width: p.rect.width + pad * 2, height: p.rect.height + pad * 2 };
    }
    const metrics = await cdp.send("Page.getLayoutMetrics", {}, tab2.session);
    const vv = metrics.cssVisualViewport || metrics.visualViewport || { clientWidth: this.viewport.width, clientHeight: this.viewport.height, pageX: 0, pageY: 0 };
    const content = metrics.cssContentSize || metrics.contentSize;
    let x = vv.pageX, y = vv.pageY, width = vv.clientWidth, height = vv.clientHeight, origin = { x: 0, y: 0 };
    if (crop) {
      const left = Math.max(0, crop.x), top = Math.max(0, crop.y);
      width = Math.max(1, Math.min(vv.clientWidth, crop.x + crop.width) - left);
      height = Math.max(1, Math.min(vv.clientHeight, crop.y + crop.height) - top);
      x = vv.pageX + left;
      y = vv.pageY + top;
      origin = { x: Math.round(left), y: Math.round(top) };
    } else if (opts.fullPage) {
      x = 0;
      y = 0;
      width = content.width;
      height = Math.min(content.height, 16e3);
    }
    const limit = opts.maxWidth && opts.maxWidth > 0 ? opts.maxWidth : quality === "tiny" ? 480 : quality === "low" ? 960 : Infinity;
    const scale = Math.min(1, limit / Math.max(width, 1));
    const jpeg = quality !== "full";
    const r = await cdp.send("Page.captureScreenshot", {
      format: jpeg ? "jpeg" : "png",
      ...jpeg ? { quality: quality === "tiny" ? 40 : 55 } : {},
      clip: { x, y, width, height, scale },
      captureBeyondViewport: !!opts.fullPage && !crop
    }, tab2.session, 6e4);
    return {
      data: r.data,
      mimeType: jpeg ? "image/jpeg" : "image/png",
      width: Math.round(width * scale),
      height: Math.round(height * scale),
      cssWidth: width,
      cssHeight: height,
      scale,
      origin,
      coordinates: "Viewport CSS px = origin + picture px / scale. Or pass picture px to click/hover/scroll with scale (and originX/originY).",
      ...this.where(tab2.id)
    };
  }
  /** Resolve a target to viewport coordinates, with a description of what is there. */
  async locate(target2, tabId, scroll = true) {
    const scale = target2.scale && target2.scale > 0 ? target2.scale : 1;
    const point = typeof target2.x === "number" && typeof target2.y === "number" ? { x: (target2.originX ?? 0) + target2.x / scale, y: (target2.originY ?? 0) + target2.y / scale } : null;
    if (!point && !target2.ref && !target2.selector && !target2.name && !target2.label) {
      throw new Error("Give x/y coordinates, an element ref (from browser_elements), a CSS selector, or a visible name/label");
    }
    const spec = { ref: target2.ref || null, selector: target2.selector || null, name: target2.name || null, label: target2.label || null, role: target2.role || null, nth: target2.nth ?? 0, ...point ?? {} };
    let r;
    try {
      r = await this.evaluate(LOCATE_FN, [spec, scroll], tabId);
    } catch (e) {
      if (point) return { x: point.x, y: point.y };
      throw e;
    }
    if (r?.error) throw new Error(r.error);
    if (scroll && !point) await sleep2(120);
    return r;
  }
  targetInfo(p) {
    const warnings = [];
    if (p.matches && p.matches > 1) warnings.push(`${p.matches} elements matched; used the first. Pass ref (from browser_elements) or nth to choose another.`);
    if (p.coveredBy) warnings.push(`The target is covered by another element (${p.coveredBy.tag} "${p.coveredBy.name}"); a click lands there instead.`);
    if (p.hidden) warnings.push("The target has no visible size.");
    return { target: p.target, ...p.matches && p.matches > 1 ? { matches: p.matches } : {}, ...p.coveredBy ? { coveredBy: p.coveredBy } : {}, ...warnings.length ? { warning: warnings.join(" ") } : {} };
  }
  /** After an action: let navigation and the requests it triggered finish (bounded). */
  async settle(tabId) {
    await sleep2(250);
    const tab2 = this.tabs.get(tabId || this.activeTab || "");
    if (!tab2) return;
    const start = Date.now();
    while (tab2.loading && Date.now() - start < 5e3 || this.pendingCount(tab2.id) > 0 && Date.now() - start < 3e3) await sleep2(125);
  }
  async click(t) {
    const cdp = this.need(), tab2 = this.tab(t.tab);
    if (t.tab && t.tab !== this.activeTab) await this.activate(t.tab);
    const p = await this.locate(t, tab2.id);
    const info = this.targetInfo(p);
    if (t.dryRun) return { dryRun: true, wouldClick: { x: Math.round(p.x), y: Math.round(p.y) }, ...info, ...this.where(tab2.id) };
    this.actionSeq = this.netSeq;
    await this.glide(p.x, p.y, true);
    const button = t.button || "left", clickCount = Math.min(Math.max(t.clickCount || 1, 1), 3), modifiers2 = modBits(t.modifiers);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y, modifiers: modifiers2 }, tab2.session);
    for (let i = 1; i <= clickCount; i++) {
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button, buttons: button === "left" ? 1 : button === "right" ? 2 : 4, clickCount: i, modifiers: modifiers2 }, tab2.session);
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button, buttons: 0, clickCount: i, modifiers: modifiers2 }, tab2.session);
    }
    await this.settle(tab2.id);
    return { clicked: { x: Math.round(p.x), y: Math.round(p.y) }, ...info, ...await this.observe(tab2.id) };
  }
  async hover(t) {
    const cdp = this.need(), tab2 = this.tab(t.tab);
    const p = await this.locate(t, tab2.id);
    await this.glide(p.x, p.y, false);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y }, tab2.session);
    return { hovered: { x: Math.round(p.x), y: Math.round(p.y) }, ...this.targetInfo(p), ...this.where(tab2.id) };
  }
  /** What is at a point or behind a ref/selector/name, and is it covered? Never acts on the page. */
  async inspect(t) {
    const tab2 = this.tab(t.tab);
    const p = await this.locate(t, tab2.id, false);
    return { point: { x: Math.round(p.x), y: Math.round(p.y) }, ...p.rect ? { rect: p.rect } : {}, ...this.targetInfo(p), ...this.where(tab2.id) };
  }
  async type(t) {
    const cdp = this.need(), tab2 = this.tab(t.tab);
    const text = String(t.text ?? "");
    const hasTarget = !!(t.ref || t.selector || t.name || t.label || typeof t.x === "number");
    const target2 = { ref: t.ref, selector: t.selector, label: t.label ?? t.name, role: t.role, nth: t.nth, x: t.x, y: t.y, scale: t.scale, originX: t.originX, originY: t.originY };
    if (t.dryRun) return { ...hasTarget ? await this.click({ ...target2, tab: tab2.id, dryRun: true }) : this.where(tab2.id), dryRun: true, wouldType: text.length };
    if (hasTarget) await this.click({ ...target2, tab: tab2.id });
    this.actionSeq = this.netSeq;
    if (t.clear) {
      const ok = await this.evaluate(CLEAR_FN, [null], tab2.id).catch(() => false);
      if (!ok) await this.pressKey("a", { meta: true }, tab2.id);
    }
    const delay = Math.min(Math.max(t.delayMs ?? 12, 0), 200);
    if (text.length > 200 || delay === 0) await cdp.send("Input.insertText", { text }, tab2.session);
    else for (const ch of text) {
      if (ch === "\n") {
        await this.pressKey("Enter", {}, tab2.id);
        continue;
      }
      const def = keyDef(ch) || { key: ch, code: "", keyCode: 0 };
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: def.key, code: def.code, windowsVirtualKeyCode: def.keyCode, text: ch, unmodifiedText: ch }, tab2.session);
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: def.key, code: def.code, windowsVirtualKeyCode: def.keyCode }, tab2.session);
      if (delay) await sleep2(delay);
    }
    const back = await this.evaluate(READBACK_FN, [], tab2.id).catch(() => null);
    const squash = (v) => v.replace(/\s+/g, " ").trim();
    const verified = back && typeof back.value === "string" ? t.clear ? squash(back.value) === squash(text) : squash(back.value).endsWith(squash(text)) : void 0;
    if (t.submit) await this.pressKey("Enter", {}, tab2.id);
    await this.settle(tab2.id);
    return {
      typed: text.length,
      ...back && typeof back.value === "string" ? { value: back.value.slice(0, 200) } : {},
      ...verified === void 0 ? {} : { verified },
      ...verified === false ? { warning: "The field does not contain the typed text; the page may have lagged or dropped input. Read the value, wait for the page to settle and retype if needed." } : {},
      ...await this.observe(tab2.id)
    };
  }
  async pressKey(key, modifiers2 = {}, tabId, holdMs = 0) {
    const cdp = this.need(), tab2 = this.tab(tabId);
    let name = key;
    const mods = { ...modifiers2 };
    const MOD = { ctrl: "ctrl", control: "ctrl", cmd: "meta", command: "meta", meta: "meta", alt: "alt", option: "alt", shift: "shift" };
    while (name.length > 1 && name.includes("+")) {
      const head = MOD[name.slice(0, name.indexOf("+")).toLowerCase()];
      if (!head) break;
      mods[head] = true;
      name = name.slice(name.indexOf("+") + 1);
    }
    const def = keyDef(name);
    if (!def) throw new Error(`Unknown key ${key}; use names like Enter, Tab, Escape, ArrowDown, PageDown or a single character, optionally with modifiers (Shift+Tab, Ctrl+A)`);
    const plain = !mods.ctrl && !mods.meta && !mods.alt;
    const text = plain ? def.text : void 0;
    await cdp.send("Input.dispatchKeyEvent", {
      type: text ? "keyDown" : "rawKeyDown",
      key: def.key,
      code: def.code,
      windowsVirtualKeyCode: def.keyCode,
      text,
      unmodifiedText: text,
      modifiers: modBits(mods),
      commands: editCommands(def, mods)
    }, tab2.session);
    if (holdMs > 0) await sleep2(Math.min(holdMs, 5e3));
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: def.key, code: def.code, windowsVirtualKeyCode: def.keyCode, modifiers: modBits(mods) }, tab2.session);
    return tab2;
  }
  async press(key, modifiers2 = {}, tabId, holdMs = 0) {
    this.actionSeq = this.netSeq;
    const tab2 = await this.pressKey(key, modifiers2, tabId, holdMs);
    return { pressed: key, ...await this.observe(tab2.id) };
  }
  async scroll(t) {
    const cdp = this.need(), tab2 = this.tab(t.tab);
    let p = { x: this.viewport.width / 2, y: this.viewport.height / 2 };
    if (t.ref || t.selector || t.name || t.label || typeof t.x === "number") p = await this.locate(t, tab2.id);
    const probe = (to = null) => this.evaluate(SCROLL_FN, [p.x, p.y, to], tab2.id);
    const before = await probe();
    let after;
    if (t.to) after = await probe(t.to);
    else {
      await this.glide(p.x, p.y, false);
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: p.x, y: p.y, deltaX: t.deltaX || 0, deltaY: t.deltaY ?? this.viewport.height * 0.8 }, tab2.session);
      after = before;
      for (let i = 0; i < 8; i++) {
        await sleep2(150);
        const next = await probe();
        const still = next.x === after.x && next.y === after.y;
        after = next;
        if (still && i > 0) break;
      }
    }
    const scrolled = after.x !== before.x || after.y !== before.y;
    return { scroll: after, scrolled, ...scrolled ? {} : { note: after.atBottom || after.atTop ? "Nothing scrolled: already at the edge of this scroll area." : "Nothing scrolled: the pointer is not over a scrollable area. Target a ref/selector inside the scrolling panel, or try different coordinates." }, ...this.where(tab2.id) };
  }
  /** Choose an option in a native <select> or a custom dropdown/combobox: open, optionally type to filter, pick by visible text. */
  async select(t) {
    const tab2 = this.tab(t.tab);
    if (!t.option) throw new Error("option is required");
    const target2 = { ref: t.ref, selector: t.selector, name: t.name, label: t.label, role: t.role, nth: t.nth, x: t.x, y: t.y, scale: t.scale, originX: t.originX, originY: t.originY };
    this.actionSeq = this.netSeq;
    if (target2.ref || target2.selector || target2.name || target2.label) {
      const native = await this.evaluate(SELECT_FN, [{ ref: target2.ref || null, selector: target2.selector || null, name: target2.name || null, label: target2.label || null, role: target2.role || null, nth: target2.nth ?? 0 }, t.option], tab2.id);
      if (native?.error) throw new Error(`${native.error}${native.options ? `. Options: ${native.options.join(" | ")}` : ""}`);
      if (native?.native) return { selected: native.selected, value: native.value, native: true, ...await this.observe(tab2.id) };
    }
    await this.click({ ...target2, tab: tab2.id });
    if (t.search) await this.type({ text: t.search, tab: tab2.id });
    let found;
    const end = Date.now() + 4e3;
    while (Date.now() < end) {
      found = await this.evaluate(OPTION_FN, [t.option], tab2.id).catch(() => null);
      if (found && !found.error) break;
      await sleep2(250);
    }
    if (!found || found.error) throw new Error(`${found?.error ?? `No visible option "${t.option}"`}${found?.available?.length ? `. Visible items: ${found.available.join(" | ")}` : ""}. The dropdown may need a search term (search) or may not have opened.`);
    await this.click({ x: found.x, y: found.y, tab: tab2.id });
    return { selected: found.name, native: false, ...await this.observe(tab2.id) };
  }
  /** Poll until every given condition holds. A timeout reports which conditions failed and whether the page was still loading. */
  async waitFor(t) {
    const tab2 = this.tab(t.tab);
    const started = Date.now();
    const deadline = started + Math.min(Math.max(t.timeoutMs ?? 1e4, 100), 6e4);
    const pageChecks = !!(t.selector || t.text || t.selectorGone || t.textGone);
    const wantSettled = t.settled ?? !(pageChecks || t.url || t.request);
    const sinceSeq = t.sinceSeq ?? this.actionSeq;
    const method = t.requestMethod?.toUpperCase();
    for (; ; ) {
      const conditions = {};
      let pageError;
      if (pageChecks) {
        try {
          const r = await this.evaluate(WAIT_FN, [t.selector || null, t.text || null, t.selectorGone || null, t.textGone || null], tab2.id);
          for (const k of ["selector", "text", "selectorGone", "textGone"]) if (k in r) conditions[k] = !!r[k];
        } catch (e) {
          pageError = errMsg(e);
          for (const k of ["selector", "text", "selectorGone", "textGone"]) if (t[k]) conditions[k] = false;
        }
      }
      if (t.url) conditions.url = tab2.url.includes(t.url);
      let request;
      if (t.request) {
        const needle = t.request.toLowerCase();
        const e = this.network.find((n) => n.seq > sinceSeq && n.url.toLowerCase().includes(needle) && (!method || n.method === method) && (n.failed || n.encodedBytes !== void 0));
        conditions.request = !!e;
        if (e) request = { seq: e.seq, method: e.method, url: e.url, status: e.status, failed: e.failed, error: e.error, durationMs: e.durationMs };
      }
      let ready;
      if (wantSettled) {
        ready = await this.readiness(tab2.id, t.quietMs ?? 500).catch(() => void 0);
        conditions.settled = !!ready?.settled;
      }
      const found = Object.values(conditions).every(Boolean);
      if (found || Date.now() >= deadline) {
        const failed = Object.keys(conditions).filter((k) => !conditions[k]);
        const loading = ready ? !ready.settled : tab2.loading;
        const hint = found ? void 0 : failed.includes("text") || failed.includes("selector") ? loading ? "The page was still loading when the wait ended; wait longer or until settled, then read it." : "Not found. The text/element may be worded differently, hidden, or inside a cross-origin iframe. Check browser_text or browser_elements." : failed.includes("request") ? "No finished request matching this URL started since the last action. Trigger the action first, or pass sinceSeq." : void 0;
        const { focused: _focused, ...page } = ready ?? {};
        return { found, waitedMs: Date.now() - started, conditions, ...request ? { request } : {}, ...ready ? { ready: page } : {}, ...pageError ? { pageError } : {}, ...hint ? { hint } : {}, ...this.where(tab2.id) };
      }
      await sleep2(200);
    }
  }
  networkLog(opts) {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), NETWORK_LIMIT);
    const f = (opts.filter || "").toLowerCase();
    const rows = this.network.filter((e) => (!opts.tab || e.tab === opts.tab) && (!opts.sinceSeq || e.seq > opts.sinceSeq) && (!opts.failedOnly || e.failed || (e.status ?? 0) >= 400) && (!f || e.url.toLowerCase().includes(f) || (e.type || "").toLowerCase() === f || e.method.toLowerCase() === f));
    return rows.slice(-limit).map((e) => opts.headers ? { ...e } : {
      seq: e.seq,
      requestId: e.requestId,
      tab: e.tab,
      method: e.method,
      url: e.url,
      type: e.type,
      status: e.status,
      statusText: e.statusText,
      mimeType: e.mimeType,
      startedAt: e.startedAt,
      durationMs: e.durationMs,
      encodedBytes: e.encodedBytes,
      failed: e.failed,
      error: e.error,
      fromCache: e.fromCache
    });
  }
  networkEntry(requestId) {
    return this.netIndex.get(requestId) || this.network.find((e) => e.requestId === requestId) || null;
  }
  async networkBody(requestId, maxChars = 1e5) {
    const e = this.networkEntry(requestId);
    if (!e) throw new Error(`No request ${requestId} in the log`);
    const tab2 = this.tabs.get(e.tab);
    if (!tab2?.session) throw new Error("The request's tab is closed");
    const r = await this.need().send("Network.getResponseBody", { requestId }, tab2.session);
    const body = r.body || "";
    return { requestId, url: e.url, status: e.status, mimeType: e.mimeType, base64Encoded: !!r.base64Encoded, body: body.slice(0, maxChars), total: body.length, truncated: body.length > maxChars };
  }
  clearNetwork() {
    this.network = [];
    this.netIndex.clear();
    this.pending.clear();
    this.netSeq++;
    this.changed();
  }
  consoleEntries(opts) {
    const levels = opts.level === "error" ? ["error", "exception", "assert"] : opts.level === "warn" ? ["warn", "error", "exception", "assert"] : null;
    const rows = this.consoleLog.filter((e) => (!opts.tab || e.tab === opts.tab) && (!opts.sinceSeq || e.seq > opts.sinceSeq) && (!levels || levels.includes(e.level)));
    const out = rows.slice(-Math.min(Math.max(opts.limit ?? 100, 1), CONSOLE_LIMIT));
    if (opts.clear) this.consoleLog = [];
    return { entries: out, seq: this.consoleSeq };
  }
};

// modules/services/browser/src/tools.ts
var obj = (properties, required = []) => ({ type: "object", properties, required });
var session = { type: "string", description: "Session id or name (see browser_sessions). Optional when exactly one session allows agents." };
var tab = { type: "string", description: "Tab id; defaults to the active tab." };
var target = {
  ref: { type: "integer", description: "Element ref from browser_elements (preferred)." },
  selector: { type: "string", description: "CSS selector (pierces open shadow roots and same-origin iframes)." },
  name: { type: "string", description: 'Visible text or accessible name of a button, link, option or field, e.g. "Save changes". Case-insensitive; exact matches win over partial ones.' },
  label: { type: "string", description: "Label of a form field (for type/select). Finds the input by its <label>, aria-label, placeholder or the text next to it." },
  role: { type: "string", description: "Narrow name/label matches by role, e.g. button, link, textbox, checkbox, combobox." },
  nth: { type: "integer", description: "Which match to use (0-based) when name/label/selector match several elements." },
  x: { type: "number", description: "Viewport x in CSS px (or picture px when scale is given)." },
  y: { type: "number", description: "Viewport y in CSS px (or picture px when scale is given)." },
  scale: { type: "number", description: "Pass a screenshot's scale to give x/y in that picture's pixels; they are converted to CSS px." },
  originX: { type: "number", description: "Screenshot origin.x for cropped screenshots (with scale)." },
  originY: { type: "number", description: "Screenshot origin.y for cropped screenshots (with scale)." }
};
var dryRun = { type: "boolean", description: "Resolve and describe the target (what it is, whether it is covered) without acting." };
var ORDER = " Commands for one session run strictly one at a time in the order they were received, even when sent together; a dependent sequence (navigate, wait, click, type) is safest as one browser_batch.";
var IMAGE_LIMIT = 50;
var modifiers = { type: "object", properties: { shift: { type: "boolean" }, ctrl: { type: "boolean" }, alt: { type: "boolean" }, meta: { type: "boolean" } } };
function browserTools(host) {
  const run = (fn, label) => async (s, a, scope) => {
    await s.start();
    checkDeadline(scope);
    if (host.pick(s.spec.id) !== s) throw new Error("Browser session changed");
    s.noteAgent(label(a), scope.conversationId);
    return fn(s, a, scope);
  };
  const imagesTaken = /* @__PURE__ */ new Map();
  const imageKey = (scope) => scope.conversationId || "default";
  function imageBudget(scope) {
    const taken = imagesTaken.get(imageKey(scope)) ?? 0;
    const remaining = Math.max(0, IMAGE_LIMIT - taken);
    return { taken, assumedLimit: IMAGE_LIMIT, remaining, ...remaining <= 10 ? { warning: remaining === 0 ? "Image limit reached: further screenshots are probably not viewable. Use browser_text, browser_elements (fields) and browser_inspect instead." : `Only ${remaining} screenshots left before the usual ${IMAGE_LIMIT}-image viewing limit. Prefer browser_text, browser_elements (fields), browser_inspect, or cropped/tiny screenshots.` } : {} };
  }
  const queues = /* @__PURE__ */ new WeakMap();
  function checkDeadline(scope) {
    if (scope.browserDeadline && Date.now() >= scope.browserDeadline) throw new Error("Browser command timed out");
  }
  function enqueue(args, scope, task) {
    const s = host.pick(args.session);
    const result = (queues.get(s) ?? Promise.resolve()).catch(() => {
    }).then(() => {
      checkDeadline(scope);
      if (host.pick(s.spec.id) !== s) throw new Error("Browser session changed");
      return task(s);
    });
    queues.set(s, result);
    const release = () => {
      if (queues.get(s) === result) queues.delete(s);
    };
    void result.then(release, release);
    return result;
  }
  const list = {
    name: "browser_sessions",
    title: "List browser sessions",
    description: "List the browser sessions agents may use, with their tabs and current page, plus how many screenshots you have left before the usual image-viewing limit.",
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
    handler: (_a, scope) => ({ imageBudget: imageBudget(scope), sessions: host.agentSessions().map((s) => {
      const v = s.view();
      return {
        id: v.id,
        name: v.name,
        status: v.status,
        location: v.locationLabel,
        url: v.url,
        title: v.title,
        viewport: v.viewport,
        tabs: v.tabs.map((t) => ({ id: t.id, title: t.title, url: t.url, active: t.active }))
      };
    }) })
  };
  const commands = [
    {
      name: "browser_navigate",
      title: "Open a URL",
      description: "Navigate the active tab (or a new tab) to a URL and wait for it to load. Starts the session if needed. Returns the final URL/title and page readiness." + ORDER,
      inputSchema: obj({ session, url: { type: "string" }, newTab: { type: "boolean" }, tab }, ["url"]),
      timeoutMs: 9e4,
      handler: run(async (s, a) => a.newTab ? (await s.newTab(a.url), await new Promise((r) => setTimeout(r, 800)), s.where()) : s.navigate(a.url, a.tab), (a) => `Open ${a.url}`)
    },
    {
      name: "browser_history",
      title: "Back, forward, reload",
      description: "Go back, forward, reload or stop loading in a tab (reload works per tab).",
      inputSchema: obj({ session, action: { type: "string", enum: ["back", "forward", "reload", "stop"] }, tab }, ["action"]),
      timeoutMs: 6e4,
      handler: run((s, a) => s.history(a.action, a.tab), (a) => a.action)
    },
    {
      name: "browser_tabs",
      title: "Manage tabs",
      description: "List, open (url), close or activate tabs. The active tab is the one shown in the preview and used by default; the result names it.",
      inputSchema: obj({ session, action: { type: "string", enum: ["list", "new", "close", "activate"] }, tab, url: { type: "string" } }, ["action"]),
      timeoutMs: 6e4,
      handler: run(async (s, a) => {
        if (a.action === "new") await s.newTab(a.url || "about:blank");
        else if (a.action === "close") await s.closeTab(a.tab || s.activeTab);
        else if (a.action === "activate") await s.activate(a.tab);
        return { activeTab: s.activeTab, tabs: s.view().tabs };
      }, (a) => `Tabs: ${a.action}`)
    },
    {
      name: "browser_text",
      title: "Read visible text",
      description: "Visible text of the page (scope page, including same-origin iframes) or only what is on screen (scope viewport), optionally inside a CSS selector. The result says whether the page is settled (contentLoaded, ready) and warns when the text may be partial because the page is still loading. Does not include input values: use browser_elements with fields for form state.",
      inputSchema: obj({ session, scope: { type: "string", enum: ["page", "viewport"] }, selector: { type: "string", description: "Read only the text inside this element." }, maxChars: { type: "integer" }, tab }),
      annotations: { readOnlyHint: true },
      handler: run((s, a) => s.text(a.scope === "viewport" ? "viewport" : "page", a.selector, a.maxChars ?? 2e4, a.tab), () => "Read text")
    },
    {
      name: "browser_elements",
      title: "List interactive elements",
      description: "Interactive elements (links, buttons, inputs…) with stable refs, names, state (value, checked, selected, expanded, disabled, focused) and viewport centers, including inside open shadow roots and same-origin iframes. Use refs with click/type/hover/scroll. Set fields to list only form controls (label, current value, checked, selected option and options of a <select>, disabled, required) as text, so form state needs no screenshot. all includes off-screen elements; selector limits to one container.",
      inputSchema: obj({ session, all: { type: "boolean" }, fields: { type: "boolean", description: "Only form controls, with their current values." }, selector: { type: "string", description: "Limit to this container." }, max: { type: "integer" }, tab }),
      annotations: { readOnlyHint: true },
      handler: run((s, a) => s.elements(!!a.all, a.max ?? 200, a.tab, { fields: !!a.fields, selector: a.selector }), () => "List elements")
    },
    {
      name: "browser_inspect",
      title: "What is here?",
      description: "Describe what is at a point or behind a ref/selector/name without acting: element, name, state, and whether another element covers it (so a click would land elsewhere). Use before clicking risky targets.",
      inputSchema: obj({ session, ...target, tab }),
      annotations: { readOnlyHint: true },
      handler: run((s, a) => s.inspect(a), () => "Inspect")
    },
    {
      name: "browser_screenshot",
      title: "Screenshot",
      description: "Screenshot of the viewport, full page, or a crop. quality low (default): JPEG ≤960px wide; tiny: JPEG ≤480px wide (cheapest); full: lossless PNG. Crop with ref/selector/name/label or region {x,y,width,height} in viewport CSS px. The result lists your image budget (clients typically allow ~50 viewable images per conversation) and warns as it runs low; set budgetOnly to read it without capturing. Clicks accept the picture's pixels directly: pass x/y with scale (and originX/originY for crops), or compute CSS px = origin + picture px / scale. Prefer browser_text / browser_elements when you only need text or state.",
      inputSchema: obj({
        session,
        quality: { type: "string", enum: ["tiny", "low", "full"] },
        fullPage: { type: "boolean" },
        maxWidth: { type: "integer", description: "Downscale to at most this many pixels wide." },
        region: obj({ x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" } }, ["x", "y", "width", "height"]),
        ref: target.ref,
        selector: target.selector,
        name: target.name,
        label: target.label,
        budgetOnly: { type: "boolean" },
        tab
      }),
      annotations: { readOnlyHint: true },
      timeoutMs: 9e4,
      handler: run(async (s, a, scope) => {
        if (a.budgetOnly) return { imageBudget: imageBudget(scope) };
        const shot = await s.screenshot({ quality: a.quality, fullPage: !!a.fullPage, tab: a.tab, maxWidth: a.maxWidth, region: a.region, ref: a.ref, selector: a.selector, name: a.name, label: a.label });
        imagesTaken.set(imageKey(scope), (imagesTaken.get(imageKey(scope)) ?? 0) + 1);
        const { data, mimeType, ...meta } = shot;
        const result = { ...meta, imageBudget: imageBudget(scope) };
        return { mcpContent: [{ type: "image", data, mimeType }, { type: "text", text: JSON.stringify(result) }], ...result };
      }, (a) => `Screenshot${a.quality === "full" ? " (full)" : ""}`)
    },
    {
      name: "browser_click",
      title: "Click",
      description: "Move the visible pointer to an element (ref, selector, visible name, or coordinates) and click it. Waits for resulting navigation and requests, then returns the clicked element, URL/title, whether they changed, the focused element and page readiness. Warns if the target is covered by another element or the name matched several. dryRun checks the target without clicking." + ORDER,
      inputSchema: obj({ session, ...target, button: { type: "string", enum: ["left", "right", "middle"] }, clickCount: { type: "integer" }, modifiers, dryRun, tab }),
      timeoutMs: 6e4,
      handler: run((s, a) => s.click(a), (a) => `Click ${a.ref ? `#${a.ref}` : a.name || a.label || a.selector || `${a.x},${a.y}`}`)
    },
    {
      name: "browser_hover",
      title: "Hover",
      description: "Move the visible pointer over an element or coordinates (opens hover menus) and describe what is under it.",
      inputSchema: obj({ session, ...target, tab }),
      timeoutMs: 3e4,
      handler: run((s, a) => s.hover(a), () => "Hover")
    },
    {
      name: "browser_type",
      title: "Type text",
      description: 'Type text, first clicking the target field if given (ref, selector, label such as "DB instance identifier", or coordinates). clear replaces existing content; submit presses Enter afterwards. The field is read back after typing: verified=false means input was dropped or garbled (usually a lagging page), so wait for the page to settle and retype. dryRun checks the target without typing.' + ORDER,
      inputSchema: obj({ session, text: { type: "string" }, ...target, clear: { type: "boolean" }, submit: { type: "boolean" }, dryRun, tab }, ["text"]),
      timeoutMs: 12e4,
      handler: run((s, a) => s.type(a), (a) => `Type ${JSON.stringify(String(a.text).slice(0, 40))}`)
    },
    {
      name: "browser_select",
      title: "Choose a dropdown option",
      description: "Choose an option by its visible text in a native <select> or a custom dropdown/combobox: opens it, optionally types search to filter, and clicks the matching option. Identify the control with ref, selector, name, label or coordinates. Fails with the visible items listed when the option is not found." + ORDER,
      inputSchema: obj({ session, option: { type: "string", description: "Visible text of the option to choose." }, search: { type: "string", description: "Text to type into a searchable combobox before choosing." }, ...target, tab }, ["option"]),
      timeoutMs: 6e4,
      handler: run((s, a) => s.select(a), (a) => `Select ${JSON.stringify(String(a.option).slice(0, 40))}`)
    },
    {
      name: "browser_key",
      title: "Press a key",
      description: "Press a key such as Enter, Tab, Escape, Backspace, ArrowDown, PageDown or a character. Modifiers go in modifiers or in the key itself (Shift+Tab, Ctrl+A, Meta+A). holdMs keeps the key down.",
      inputSchema: obj({ session, key: { type: "string" }, modifiers, holdMs: { type: "integer", description: "Hold the key down this long (max 5000)." }, tab }, ["key"]),
      handler: run((s, a) => s.press(a.key, a.modifiers || {}, a.tab, a.holdMs ?? 0), (a) => `Key ${a.key}`)
    },
    {
      name: "browser_scroll",
      title: "Scroll",
      description: "Scroll the scroll area under an element/coordinates (default viewport center) with the mouse wheel; deltaY defaults to most of a screen, negative scrolls up. to jumps to top or bottom. Returns the scroll position of the area that actually scrolled (the page or an inner panel), whether anything moved (scrolled), and a note when nothing did.",
      inputSchema: obj({ session, deltaX: { type: "number" }, deltaY: { type: "number" }, to: { type: "string", enum: ["top", "bottom"] }, ...target, tab }),
      handler: run((s, a) => s.scroll(a), (a) => `Scroll ${a.to ?? a.deltaY ?? "down"}`)
    },
    {
      name: "browser_wait",
      title: "Wait for content",
      description: "Wait until ALL given conditions hold: selector visible, text present (case-insensitive; searches page text, input values and same-origin iframes), selectorGone / textGone (spinner or message disappeared), url contains, request finished (a request whose URL contains this, started since the last action, with its status), or settled (document complete, no pending XHR/fetch, no loading indicators, DOM quiet for quietMs). With no conditions it waits until the page settles. On timeout it returns found:false as a tool error listing which conditions were met, whether the page was still loading, and a hint. Use after slow actions instead of sleeping." + ORDER,
      inputSchema: obj({
        session,
        selector: { type: "string" },
        text: { type: "string" },
        selectorGone: { type: "string" },
        textGone: { type: "string" },
        url: { type: "string" },
        request: { type: "string", description: "URL substring of a request to wait for (e.g. the save call); its status is returned." },
        requestMethod: { type: "string" },
        sinceSeq: { type: "integer", description: "Only match requests newer than this network seq (default: since the last action)." },
        settled: { type: "boolean", description: "Also require the page to be settled (default only when no other condition is given)." },
        quietMs: { type: "integer", description: "Required DOM quiet time for settled (default 500)." },
        timeoutMs: { type: "integer", description: "Default 10000, max 60000." },
        tab
      }),
      annotations: { readOnlyHint: true },
      timeoutMs: 7e4,
      handler: run(async (s, a) => {
        const result = await s.waitFor(a);
        return result.found ? result : { ...result, ok: false, error: `Browser wait timed out after ${result.waitedMs}ms${result.hint ? `: ${result.hint}` : ""}` };
      }, () => "Wait")
    },
    {
      name: "browser_console",
      title: "Console and error log",
      description: "Recent console messages, uncaught exceptions and browser log entries (level, text, source). level error shows only errors/exceptions; warn adds warnings. sinceSeq returns only newer entries; clear empties the log afterwards. Pair with browser_network failedOnly to see failed requests.",
      inputSchema: obj({ session, level: { type: "string", enum: ["all", "warn", "error"] }, limit: { type: "integer" }, sinceSeq: { type: "integer" }, clear: { type: "boolean" }, tab }),
      annotations: { readOnlyHint: true },
      handler: run((s, a) => s.consoleEntries(a), () => "Console log")
    },
    {
      name: "browser_network",
      title: "Network log",
      description: "Recent requests (newest last): method, URL, status, type, timing and size. Filter by URL substring, resource type (xhr, fetch, document…) or method; failedOnly shows errors and HTTP ≥400; sinceSeq returns only newer entries; headers includes request/response headers. Use it to confirm a save call returned 2xx.",
      inputSchema: obj({ session, filter: { type: "string" }, limit: { type: "integer" }, failedOnly: { type: "boolean" }, sinceSeq: { type: "integer" }, headers: { type: "boolean" }, tab }),
      annotations: { readOnlyHint: true },
      handler: run((s, a) => ({ seq: s.netSeq, requests: s.networkLog(a) }), () => "Network log")
    },
    {
      name: "browser_network_body",
      title: "Response body",
      description: "Response body of a request from browser_network (text, or base64 for binary).",
      inputSchema: obj({ session, requestId: { type: "string" }, maxChars: { type: "integer" } }, ["requestId"]),
      annotations: { readOnlyHint: true },
      handler: run((s, a) => s.networkBody(a.requestId, a.maxChars ?? 1e5), () => "Response body")
    }
  ];
  const byName = new Map(commands.map((command) => [command.name, command]));
  const batch = {
    name: "browser_batch",
    title: "Run browser commands in order",
    description: "Run up to 10 existing browser commands on one session strictly in order, without interleaving other agent commands: the reliable way to send dependent steps (navigate, wait, click, type). Put a browser_wait between a slow action and the step that needs its result. Each step has a command name (e.g. browser_click) and its usual arguments, with session set only at the batch level. Stops on the first failure and returns completed results and any screenshots.",
    timeoutMs: 18e4,
    inputSchema: obj({ session, steps: {
      type: "array",
      minItems: 1,
      maxItems: 10,
      items: obj({ command: { type: "string", enum: [...byName.keys()] }, arguments: { type: "object" } }, ["command"])
    } }, ["steps"]),
    handler(args, scope) {
      if (!Array.isArray(args.steps) || args.steps.length < 1 || args.steps.length > 10) {
        throw new Error("Provide between 1 and 10 browser steps");
      }
      const steps = args.steps.map((step, index) => {
        const command = byName.get(step?.command);
        const input = step?.arguments ?? {};
        if (!command || !scope.allowedBrowserCommands?.includes(command.name)) {
          throw new Error(`Step ${index + 1}: browser command is denied or unavailable`);
        }
        if (typeof input !== "object" || Array.isArray(input) || "session" in input) {
          throw new Error(`Step ${index + 1}: arguments must be an object without session`);
        }
        for (const key of command.inputSchema.required ?? []) {
          if (input[key] === void 0) throw new Error(`Step ${index + 1}: missing ${key}`);
        }
        return { command, input };
      });
      return enqueue(args, scope, async (s) => {
        const results = [];
        const images = [];
        let failure;
        for (const { command, input } of steps) {
          try {
            checkDeadline(scope);
            if (host.pick(s.spec.id) !== s) throw new Error("Browser session changed");
            const { mcpContent = [], ...result } = await command.handler(s, input, scope);
            if (command.name === "browser_wait" && result.found === false) throw new Error(result.error);
            results.push({ command: command.name, result });
            const screenshots = mcpContent.filter((item) => item.type === "image");
            if (screenshots.length) images.push({ type: "text", text: `Screenshot from step ${results.length}` }, ...screenshots);
          } catch (error) {
            failure = { step: results.length + 1, command: command.name, error: error instanceof Error ? error.message : String(error) };
            break;
          }
        }
        const summary = { ok: !failure, results, ...failure ? { failure } : {} };
        return images.length ? { ...summary, mcpContent: [{ type: "text", text: JSON.stringify(summary) }, ...images] } : summary;
      });
    }
  };
  return [list, ...commands.map(({ handler, ...tool }) => ({
    ...tool,
    handler: (args, scope) => enqueue(args, scope, (s) => handler(s, args, scope))
  })), batch];
}

// modules/services/browser/src/index.ts
var SPECS_KEY = "browser.sessions";
var RUNNING_KEY = "browser.running";
var ctxRef;
var sessions = /* @__PURE__ */ new Map();
var rev = 0;
var publishTimer = null;
var running = /* @__PURE__ */ new Set();
function publish() {
  if (publishTimer !== null) return;
  publishTimer = setTimeout(() => {
    publishTimer = null;
    const state = { sessions: [...sessions.values()].map((s) => s.view()), rev: ++rev };
    ctxRef.state.set("browser.state", state);
    const live = [...sessions.values()].filter((s) => s.status === "running" || s.status === "starting").map((s) => s.spec.id).sort();
    if (live.join() !== [...running].sort().join()) {
      running = new Set(live);
      void saveRunning();
    }
  }, 60);
}
async function saveSpecs() {
  await ctxRef.modules.call("persistence", "settings.set", { key: SPECS_KEY, value: [...sessions.values()].map((s) => s.spec) });
}
async function saveRunning() {
  try {
    await ctxRef.modules.call("persistence", "settings.set", { key: RUNNING_KEY, value: [...running] });
  } catch (e) {
    ctxRef.log.warn("save running sessions", errMsg(e));
  }
}
function get(id) {
  const s = sessions.get(String(id));
  if (!s) throw new Error(`Unknown browser session ${id}`);
  return s;
}
function cleanLocation(l) {
  if (l?.kind === "workspace" && typeof l.workspaceId === "string" && l.workspaceId) return { kind: "workspace", workspaceId: l.workspaceId, label: typeof l.label === "string" ? l.label.slice(0, 120) : void 0 };
  if (l?.kind === "endpoint" && typeof l.url === "string" && /^(wss?|https?):\/\//i.test(l.url.trim())) return { kind: "endpoint", url: l.url.trim().slice(0, 2e3) };
  return { kind: "local" };
}
function cleanSpec(raw, prev) {
  const base = { ...prev || {}, ...raw || {} };
  const vp = base.viewport || DEFAULT_VIEWPORT;
  return {
    id: prev?.id || (typeof base.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(base.id) ? base.id : crypto.randomHex(6)),
    name: String(base.name || "Browser").trim().slice(0, 80) || "Browser",
    location: cleanLocation(base.location),
    headed: !!base.headed,
    keepProfile: base.keepProfile !== false,
    agentAccess: !!base.agentAccess,
    viewport: { width: Math.round(Math.min(Math.max(Number(vp.width) || DEFAULT_VIEWPORT.width, 320), 3840)), height: Math.round(Math.min(Math.max(Number(vp.height) || DEFAULT_VIEWPORT.height, 240), 2400)) },
    startUrl: typeof base.startUrl === "string" ? base.startUrl.slice(0, 2e3) : void 0,
    executable: typeof base.executable === "string" && base.executable.trim() ? base.executable.trim().slice(0, 1e3) : void 0
  };
}
function add(spec, carry) {
  const s = new BrowserSession(ctxRef, spec, publish, carry);
  sessions.set(spec.id, s);
  return s;
}
function pick(nameOrId) {
  const allowed = [...sessions.values()].filter((s2) => s2.spec.agentAccess);
  if (!nameOrId) {
    if (allowed.length === 1) return allowed[0];
    throw new Error(allowed.length ? `Several browser sessions allow agents (${allowed.map((s2) => `${s2.spec.name} [${s2.spec.id}]`).join(", ")}); pass session` : "No browser session allows agents. The user can enable “Agent access” for a session in the Browser panel.");
  }
  const key = String(nameOrId).toLowerCase();
  const s = [...sessions.values()].find((s2) => s2.spec.id === nameOrId) || [...sessions.values()].find((s2) => s2.spec.name.toLowerCase() === key);
  if (!s) throw new Error(`No browser session ${nameOrId}`);
  if (!s.spec.agentAccess) throw new Error(`Browser session “${s.spec.name}” does not allow agents. The user can enable “Agent access” for it in the Browser panel.`);
  return s;
}
function startQuietly(s) {
  s.start().catch((e) => ctxRef.log.warn(`browser ${s.spec.name}`, errMsg(e)));
}
var mod = {
  id: "browser",
  moduleApiVersion: 1,
  async activate(ctx, previous) {
    ctxRef = ctx;
    const specs = await ctx.modules.call("persistence", "settings.get", { key: SPECS_KEY }) || [];
    const wasRunning = previous?.running || await ctx.modules.call("persistence", "settings.get", { key: RUNNING_KEY }) || [];
    for (const raw of Array.isArray(specs) ? specs : []) {
      try {
        const spec = cleanSpec(raw);
        add(spec, previous?.carry?.[spec.id]);
      } catch (e) {
        ctx.log.warn("browser spec", errMsg(e));
      }
    }
    exportMcpTools(ctx, "Browser", browserTools({ pick, agentSessions: () => [...sessions.values()].filter((s) => s.spec.agentAccess) }));
    publish();
    for (const id of wasRunning) {
      const s = sessions.get(id);
      if (s) startQuietly(s);
    }
  },
  snapshot() {
    const carry = {};
    for (const s of sessions.values()) carry[s.spec.id] = s.carry();
    return { carry, running: [...sessions.values()].filter((s) => s.status === "running" || s.status === "starting").map((s) => s.spec.id) };
  },
  async deactivate() {
    if (publishTimer !== null) clearTimeout(publishTimer);
    await Promise.all([...sessions.values()].map((s) => s.detach()));
  },
  methods: {
    list: () => ({ sessions: [...sessions.values()].map((s) => s.view()) }),
    async create(_ctx, a) {
      const spec = cleanSpec(a.spec || a);
      if (sessions.has(spec.id)) throw new Error("Session id already exists");
      const s = add(spec);
      await saveSpecs();
      publish();
      if (a.start !== false) startQuietly(s);
      return s.view();
    },
    async update(_ctx, a) {
      const s = get(a.id);
      const prev = s.spec;
      const next = cleanSpec({ ...a.patch, id: prev.id }, prev);
      const restart = JSON.stringify([prev.location, prev.headed, prev.keepProfile, prev.executable]) !== JSON.stringify([next.location, next.headed, next.keepProfile, next.executable]);
      s.spec = next;
      await saveSpecs();
      if (prev.viewport?.width !== next.viewport?.width || prev.viewport?.height !== next.viewport?.height) await s.setViewport(next.viewport.width, next.viewport.height).catch(() => {
      });
      if (restart && s.status !== "stopped") {
        await s.stop(true);
        startQuietly(s);
      }
      publish();
      return s.view();
    },
    async remove(_ctx, a) {
      const s = get(a.id);
      await s.stop(true);
      if (a.deleteProfile) await s.removeProfile().catch((e) => ctxRef.log.warn("remove profile", errMsg(e)));
      if (s.surface) await ctxRef.host.resources.release(s.surface).catch(() => {
      });
      sessions.delete(s.spec.id);
      await saveSpecs();
      publish();
      return null;
    },
    async start(_ctx, a) {
      const s = get(a.id);
      await s.start();
      return s.view();
    },
    async stop(_ctx, a) {
      const s = get(a.id);
      await s.stop(a.kill !== false);
      return s.view();
    },
    async navigate(_ctx, a) {
      const s = get(a.id);
      await s.start();
      return s.navigate(String(a.url || ""), a.tab, 1);
    },
    async history(_ctx, a) {
      return get(a.id).history(a.action, a.tab);
    },
    async newTab(_ctx, a) {
      const s = get(a.id);
      await s.start();
      return s.newTab(a.url || "about:blank");
    },
    async closeTab(_ctx, a) {
      await get(a.id).closeTab(String(a.tab));
      return null;
    },
    async activateTab(_ctx, a) {
      await get(a.id).activate(String(a.tab));
      return null;
    },
    async setViewport(_ctx, a) {
      const s = get(a.id);
      await s.setViewport(Number(a.width), Number(a.height));
      await saveSpecs();
      return s.view();
    },
    /** Preview input from a `surface` node: {id, kind: pointer|wheel|key, event}. */
    async input(_ctx, a) {
      const s = get(a.id);
      if (s.status !== "running") return null;
      try {
        if (a.kind === "pointer") await s.userPointer(a.event);
        else if (a.kind === "wheel") await s.userWheel(a.event);
        else if (a.kind === "key") await s.userKey(a.event);
      } catch (e) {
        ctxRef.log.debug("browser input", errMsg(e));
      }
      return null;
    },
    network(_ctx, a) {
      return { requests: get(a.id).networkLog({ limit: a.limit, filter: a.filter, tab: a.tab, failedOnly: a.failedOnly, headers: a.headers }) };
    },
    networkEntry(_ctx, a) {
      return get(a.id).networkEntry(String(a.requestId));
    },
    async networkBody(_ctx, a) {
      return get(a.id).networkBody(String(a.requestId), a.maxChars ?? 2e5);
    },
    clearNetwork(_ctx, a) {
      get(a.id).clearNetwork();
      return null;
    },
    async evaluate(_ctx, a) {
      return { value: await get(a.id).evaluate(`function(){return (${String(a.expression)})}`, [], a.tab, true) };
    },
    async text(_ctx, a) {
      return get(a.id).text(a.scope === "viewport" ? "viewport" : "page", a.selector, a.maxChars ?? 2e4, a.tab);
    },
    async elements(_ctx, a) {
      return get(a.id).elements(!!a.all, a.max ?? 200, a.tab);
    },
    async click(_ctx, a) {
      const s = get(a.id);
      s.noteAgent("Click", a.caller);
      return s.click(a);
    },
    async type(_ctx, a) {
      const s = get(a.id);
      s.noteAgent("Type", a.caller);
      return s.type(a);
    },
    async screenshot(_ctx, a) {
      return get(a.id).screenshot({ quality: a.quality, fullPage: a.fullPage, tab: a.tab });
    },
    health: () => ({ ok: true, sessions: sessions.size })
  }
};
var index_default = mod;
export {
  index_default as default
};
