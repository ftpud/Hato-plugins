// Where a browser runs and how to reach its DevTools endpoint: local or workspace-machine Chrome
// (system install, or a managed chrome-headless-shell) held by the machine's daemon, or an
// existing endpoint. All process work uses a process grant and POSIX `sh` on the target machine.
import type { DaemonTarget, ExecutionTarget, ModuleContext, ScopeGrant } from "@hato/sdk/types";
import { daemonTargetFor, errMsg, sshConnect, targetFor, workspaceGrant, type WorkspaceDescriptor } from "@hato/sdk/runtime";
import type { BrowserSessionSpec } from "@hato/sdk/browser";

export interface Machine {
  id: string;
  label: string;
  grant: ScopeGrant;
  target: ExecutionTarget;
  /** Per-machine state root for profiles and the managed browser. */
  stateDir: string;
  desc?: WorkspaceDescriptor;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export async function machineFor(ctx: ModuleContext, spec: BrowserSessionSpec): Promise<Machine> {
  const loc = spec.location;
  if (loc.kind === "local") {
    const shared = String(ctx.host.env.info().sharedDir || "").replace(/\/+$/, "");
    if (!shared) throw new Error("Hato's shared data folder is unavailable");
    const grant = await ctx.host.capabilities.request({ kind: "process", root: shared, purpose: "Run browser sessions" });
    return { id: "local", label: "This computer", grant, target: { kind: "local" }, stateDir: `${shared}/browser` };
  }
  if (loc.kind !== "workspace") throw new Error("Endpoint sessions do not run a browser process");
  const desc: WorkspaceDescriptor = await ctx.modules.call("workspace", "resolve", { workspaceId: loc.workspaceId });
  if (desc.location === "cloud") throw new Error("Browser sessions on Cloud machines are not supported yet");
  const grant = await workspaceGrant(ctx, desc, "process");
  const target = await targetFor(ctx, desc);
  let home: string | null = null;
  if (desc.location === "ssh") home = (await sshConnect(ctx, desc)).home;
  else home = ctx.host.env.info().home;
  if (!home) throw new Error("Cannot determine the home folder on the workspace machine");
  if (desc.location === "local") {
    const shared = String(ctx.host.env.info().sharedDir || "").replace(/\/+$/, "");
    return { id: "local", label: "This computer", grant, target, stateDir: `${shared}/browser`, desc };
  }
  return { id: desc.machineId, label: desc.name, grant, target, stateDir: `${home.replace(/\/+$/, "")}/.local/state/hato/browser`, desc };
}

export async function sh(ctx: ModuleContext, m: Machine, script: string, args: string[] = [], timeoutMs = 30_000, env?: Record<string, string>) {
  return ctx.host.process.run(m.grant.grant, { target: m.target, executable: "sh", args: ["-c", script, "sh", ...args], cwd: m.grant.root, env, loginShell: m.target.kind !== "local" },
    { timeoutMs, limitBytes: 1 << 20 });
}

const DETECT = `
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

/** System browser, then the managed headless shell. `preferred` wins when executable. */
export async function findBrowser(ctx: ModuleContext, m: Machine, preferred?: string): Promise<string | null> {
  const r = await sh(ctx, m, DETECT, [m.stateDir], 15_000, { HATO_BROWSER: preferred || "" });
  return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

const INSTALL = `
set -e
D="$1/chrome-headless-shell"; U="$2"
mkdir -p "$D"; cd "$D"; rm -rf tmp; mkdir tmp
if command -v curl >/dev/null 2>&1; then curl -fsSL "$U" -o tmp/s.zip; else wget -q -O tmp/s.zip "$U"; fi
if command -v unzip >/dev/null 2>&1; then unzip -q tmp/s.zip -d tmp; else python3 -c 'import sys,zipfile;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' tmp/s.zip tmp; fi
rm -rf current; mv tmp/chrome-headless-shell-* current; rm -rf tmp
chmod +x current/chrome-headless-shell 2>/dev/null || true
xattr -dr com.apple.quarantine current 2>/dev/null || true
printf '%s' "$D/current/chrome-headless-shell"`;

/** Download Chrome for Testing's headless shell onto the machine. */
export async function installHeadlessShell(ctx: ModuleContext, m: Machine): Promise<string> {
  const uname = await sh(ctx, m, "uname -sm");
  const [os, arch] = uname.stdout.trim().split(/\s+/);
  const platform = os === "Darwin" ? (arch === "arm64" ? "mac-arm64" : "mac-x64") : os === "Linux" && (arch === "x86_64" || arch === "amd64") ? "linux64" : null;
  if (!platform) throw new Error(`No managed headless browser for ${uname.stdout.trim() || "this machine"}; install Chrome or Chromium there`);
  const res = await ctx.host.net.fetch({ url: "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json", maxBytes: 4 << 20 });
  if (res.status !== 200) throw new Error(`Chrome for Testing index unavailable (HTTP ${res.status})`);
  const stable = JSON.parse(res.body)?.channels?.Stable;
  const url = stable?.downloads?.["chrome-headless-shell"]?.find((d: any) => d.platform === platform)?.url;
  if (typeof url !== "string" || !url.startsWith("https://")) throw new Error("Chrome for Testing has no headless shell for this platform");
  const r = await sh(ctx, m, INSTALL, [m.stateDir, url], 600_000);
  if (r.code !== 0) throw new Error(`Installing the headless browser failed: ${(r.stderr || r.stdout).trim().slice(-400)}`);
  return r.stdout.trim();
}

const LAUNCH = `
P="$1"; B="$2"; FRESH="$3"; shift 3
[ "$FRESH" = 1 ] && rm -rf "$P"
mkdir -p "$P"; rm -f "$P/DevToolsActivePort"
exec "$B" "$@"`;

export interface Launched { handle: string; key: string; daemon: DaemonTarget | null; profile: string }

export const processKey = (id: string) => `browser-${id.replace(/[^A-Za-z0-9_-]/g, "_")}`;

async function daemonFor(ctx: ModuleContext, m: Machine): Promise<DaemonTarget | null> {
  try {
    const target: DaemonTarget = m.desc ? await daemonTargetFor(ctx, m.desc) : { kind: "local" };
    await ctx.host.daemon.ensure(target);
    return target;
  } catch (e) {
    ctx.log.warn("browser daemon unavailable", errMsg(e));
    return null;
  }
}

/** Start (or reattach to) the session's browser process. */
export async function launch(ctx: ModuleContext, m: Machine, spec: BrowserSessionSpec, bin: string, viewport: { width: number; height: number }): Promise<Launched> {
  const keep = spec.keepProfile !== false;
  const profile = `${m.stateDir}/${keep ? "profiles" : "scratch"}/${spec.id.replace(/[^A-Za-z0-9_-]/g, "_")}`;
  const headless = !(spec.headed && m.target.kind === "local") ;
  const flags = [
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
    "--disable-features=Translate,MediaRouter,OptimizationHints", "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows", "--use-mock-keychain", "--password-store=basic", "--mute-audio",
    `--window-size=${viewport.width},${viewport.height}`,
    ...(headless && !/headless-shell/.test(bin) ? ["--headless=new"] : []),
    ...(m.target.kind !== "local" ? ["--no-sandbox"] : []),
    spec.startUrl || "about:blank",
  ];
  const key = processKey(spec.id);
  const daemon = await daemonFor(ctx, m);
  const req = { target: m.target, executable: "sh", args: ["-c", LAUNCH, "sh", profile, bin, keep ? "0" : "1", ...flags], cwd: m.grant.root, loginShell: m.target.kind !== "local" };
  const { handle } = await ctx.host.process.spawn(m.grant.grant, daemon ? { ...req, persist: { key } } : req);
  return { handle, key, daemon, profile };
}

/** Wait for the DevTools port file, then return the browser websocket path and port. */
export async function devtoolsPort(ctx: ModuleContext, m: Machine, profile: string, timeoutMs = 30_000): Promise<{ port: number; path: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await sh(ctx, m, 'cat "$1/DevToolsActivePort" 2>/dev/null', [profile], 10_000).catch(() => null);
    const [port, path] = (r?.stdout || "").split("\n").map(s => s.trim());
    if (/^\d+$/.test(port || "") && path?.startsWith("/devtools/browser/")) return { port: Number(port), path };
    await sleep(250);
  }
  throw new Error("The browser did not open its DevTools port in time");
}

export async function endpointUrl(ctx: ModuleContext, url: string): Promise<string> {
  const u = url.trim();
  if (/^wss?:\/\//i.test(u)) return u;
  if (!/^https?:\/\//i.test(u)) throw new Error("Endpoint must be ws(s):// or http(s)://");
  const base = u.replace(/\/+$/, "").replace(/\/json(\/version)?$/, "");
  const res = await ctx.host.net.fetch({ url: `${base}/json/version`, timeoutMs: 10_000 });
  if (res.status !== 200) throw new Error(`DevTools endpoint answered HTTP ${res.status}`);
  const ws = JSON.parse(res.body)?.webSocketDebuggerUrl;
  if (typeof ws !== "string") throw new Error("DevTools endpoint did not report a browser websocket");
  return ws;
}

export async function forward(ctx: ModuleContext, m: Machine, port: number): Promise<{ handle: string | null; port: number }> {
  if (m.target.kind === "local") return { handle: null, port };
  if (!m.desc || m.desc.location !== "ssh") throw new Error("Unsupported machine");
  const { connection } = await sshConnect(ctx, m.desc);
  const f = await ctx.host.ssh.localForward(connection, { localPort: 0, remoteHost: "127.0.0.1", remotePort: port });
  return { handle: f.handle, port: f.localPort };
}

export { q };
