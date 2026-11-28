import { providerMcpLaunch } from "@hato/sdk/provider-mcp";
import { updateSubagents, knownSubagent, disconnectSubagents, hasWorkingSubagents, openCodeChildUpdate, OPENCODE_CHILD_UPDATE, OPENCODE_CHILD_OPT_IN, type AcpSubagents } from "@hato/sdk/acp-subagents";
import { authMethods, sessionPage, terminalAuthEnvironment, acpSystemPrompt } from "@hato/sdk/acp-protocol";
// acp: Agent Client Protocol (agentclientprotocol.com) client implemented in TS over generic
// process stdio streams. The agent process runs ON the workspace's machine with cwd = the exact
// project root / worktree: local child process for local workspaces, SSH exec for remote ones.
// No local fallback, no implicit clone, no auto-install.
import { agentProviders, providerProfiles, type AgentProvider } from "@hato/sdk/agent-providers";
import { imageAttachments } from "@hato/sdk/images";
import { reportedUsage, type ReportedUsage } from "@hato/sdk/context-usage";
import { type LimitProvider, type LimitsSnapshot } from "@hato/sdk/usage-limits";
import type { AppModule, Handle, ModuleContext } from "@hato/sdk/types";
import { errMsg, JsonRpcPeer, rpcError, targetFor, workspaceGrant, type WorkspaceDescriptor } from "@hato/sdk/runtime";
import { firstExistingFile, pathListSeparator, resolveWindowsExecutable, workspaceOs, type MachineOs } from "@hato/sdk/platform";
import { PLATFORM_LABELS, platformSupportOf, REQUIRED_TOOLS } from "@hato/sdk/agent-providers";

const PROTOCOL_VERSION = 1;
async function providers(ctx: ModuleContext) { return agentProviders((await ctx.host.plugins.list()).plugins); }
async function providerById(ctx: ModuleContext, id: string): Promise<AgentProvider> {
  const found = (await providers(ctx)).find(p => p.id === id);
  if (!found) throw new Error(`Provider '${id}' is unavailable. Install or enable its plugin in Marketplace.`);
  return found;
}
/** Quota parsing is optional; standard ACP token/context usage never needs provider RPC access. */
export async function providerSessionLimits(ctx: ModuleContext, providerId: string, update: any, previous: LimitsSnapshot | null): Promise<LimitsSnapshot | null> {
  const definition = (await providers(ctx)).find(p => p.id === providerId);
  if (!definition?.usageCommand) return null;
  return ctx.modules.call(definition.module, "sessionLimits", { update, previous });
}
async function environmentPolicy(ctx: ModuleContext, profile: any) {
  const auth = (await providers(ctx)).find(p => p.id === profile.provider)?.auth;
  if (!auth) return [];
  const saved = await ctx.modules.call('persistence', 'settings.get', { key: auth.key });
  return (saved == null ? auth.default : !!saved) ? auth.envRemove : [];
}

/** Capabilities understood by this client. OpenCode uses agent-side filesystem/shell tools, so
 * generic ACP fs/terminal methods stay disabled. Terminal authentication stays disabled until arbitrary-argv PTY launch is supported.
 * Form elicitation is supported by the desktop UI. */
const CLIENT_CAPABILITIES = {
  subagents: {},
  fs: { readTextFile: false, writeTextFile: false },
  terminal: false,
  elicitation: { form: {} },
  session: { configOptions: { boolean: {} } },
};

function additionalDirectories(value: any): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error("additionalDirectories must be an array");
  const out = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string" || !/^(?:\/|[A-Za-z]:[\\/])/.test(entry) || /[*?]/.test(entry)) {
      throw new Error("additionalDirectories entries must be absolute paths without wildcards");
    }
    out.add(entry);
  }
  return [...out];
}

function terminalAuthMethod(method: any): any | null {
  const legacy = method?._meta?.["terminal-auth"];
  return method?.type === "terminal" || legacy ? { ...legacy, ...method, args: Array.isArray(method.args) ? method.args : Array.isArray(legacy?.args) ? legacy.args : undefined,
    env: method.env && typeof method.env === "object" ? method.env : legacy?.env } : null;
}

function supportsAdditionalDirectories(c: Conn): boolean {
  return !!c.agentCapabilities?.sessionCapabilities?.additionalDirectories;
}

function requireAdditionalDirectories(c: Conn, dirs: string[]) {
  if (dirs.length && !supportsAdditionalDirectories(c)) {
    throw new Error("This agent does not support additionalDirectories; remove the additional workspace roots or choose an agent that advertises sessionCapabilities.additionalDirectories");
  }
}

function sessionMatches(c: Conn, params: any): boolean {
  return !params?.sessionId || params.sessionId === c.sessionId || knownSubagent(c.childSessions, params.sessionId) || (c.loadingHistory === true && params.sessionId === c.loadingSessionId);
}

function promptBlocks(a: any, c: Conn): any[] {
  const raw = Array.isArray(a.prompt) ? a.prompt : Array.isArray(a.content) ? a.content : null;
  if (raw) {
    if (!raw.length) throw new Error("empty prompt");
    return raw.map((block: any) => {
      if (!block || typeof block !== "object") throw new Error("Invalid ACP prompt block");
      switch (block.type) {
        case "text":
          if (typeof block.text !== "string") throw new Error("Invalid text prompt block");
          return block;
        case "image":
          if (!c.agentCapabilities?.promptCapabilities?.image) throw new Error("This agent does not support image prompts");
          if (typeof block.data !== "string" || typeof block.mimeType !== "string") throw new Error("Image blocks require data and mimeType");
          return block;
        case "resource":
          if (!c.agentCapabilities?.promptCapabilities?.embeddedContext) throw new Error("This agent does not support embedded context");
          if (!block.resource || typeof block.resource.uri !== "string" || (typeof block.resource.text !== "string" && typeof block.resource.blob !== "string")) throw new Error("Embedded resource requires nested resource uri and text or blob");
          if (typeof block.resource.blob === "string" && typeof block.resource.mimeType !== "string") throw new Error("Blob resources require mimeType");
          return block;
        case "resource_link":
          if (typeof block.uri !== "string" || typeof block.name !== "string") throw new Error("Resource links require uri and name");
          return block;
        case "audio":
          if (!c.agentCapabilities?.promptCapabilities?.audio) throw new Error("This agent does not support audio prompts");
          if (typeof block.data !== "string" || typeof block.mimeType !== "string") throw new Error("Audio blocks require data and mimeType");
          return block;
        default:
          throw new Error(`Unsupported ACP prompt block '${String(block.type)}'`);
      }
    });
  }
  const images = imageAttachments(a.images);
  if (images.length && !c.agentCapabilities?.promptCapabilities?.image) throw new Error("This agent does not support image prompts. Choose an agent with image support.");
  const blocks: any[] = a.text ? [{ type: "text", text: String(a.text) }] : [];
  blocks.push(...images.map((image) => ({ type: "image", mimeType: image.mimeType, data: image.data })));
  if (!blocks.length) throw new Error("empty prompt");
  return blocks;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: any) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

interface Conn {
  loadingHistory?: boolean;
  loadingSessionId?: string | null;
  conversationId: string;
  workspaceId: string;
  machineId: string;
  cwd: string;
  profileId: string;
  providerId?: string;
  providerModule?: string;
  profile?: any;
  env?: Record<string, string>;
  envRemove?: string[];
  proc: Handle;
  pid: number;
  peer: JsonRpcPeer;
  sessionId: string | null;
  sessionClosed?: boolean;
  additionalDirectories: string[];
  systemPrompt: string | null;
  agentInfo: any;
  agentCapabilities: any;
  /** Agent advertised the `_session/steering` extension (inject into the running turn). */
  steering: boolean;
  authMethods: any[];
  authPlan?: any;
  authProcess?: { attemptId?: string; kind?: "pty"; handle: Handle; pid: number; methodId: string; command: string; args: string[]; envKeys: string[]; cwd: string; machineId: string; label: string; startedAt: number } | null;
  configOptions: any[] | null;
  modes: any | null;
  models: any | null;
  commands: any[];
  usage: ReportedUsage | null;
  turnUsage: any | null;
  sessionInfo: any | null;
  childSessions: AcpSubagents;
  compaction: any | null;
  status: "starting" | "ready" | "busy" | "exited" | "error";
  error: string | null;
  stderrTail: string;
  stopping?: boolean;
  activeTurn?: { cancelled?: boolean; timer?: any } | null;
  /** Autonomous wakeup turn started by the provider after a prompt turn ended (e.g. Claude AIR
   *  asyncTasks or background activity streaming on an idle session). */
  providerTurn?: { id: string; idleTimer?: ReturnType<typeof setTimeout> } | null;
  pendingPermissions: Map<number | string, (outcome: any) => void>;
  pendingElicitations: Map<number | string, { params: any; resolve: (value: any) => void; reject: (error: any) => void; timer: any }>;
  mcp: { enabled: boolean; status: string; selection?: string[] };
  mcpServers: any[];
  executablePath: string;
  /** Program and leading arguments that start the adapter (Windows: node.exe + entry script). */
  launchPrefix?: { executable: string; args: string[] };
  startedAt: number;
}

const conns = new Map<string, Conn>();
const startups = new Map<string, Promise<any>>();
const operations = new Map<string, string>();

function sessionNotFound(error: any): boolean { return error?.rpcCode === -32002; }
function requireSessionId(value: any): string {
  if (typeof value !== "string" || !value.trim() || value.length > 4096) throw new Error("A nonempty sessionId is required");
  return value;
}

async function start(ctx: ModuleContext, a: any) {
  const pending = startups.get(a.conversationId);
  if (pending) return pending;
  if (operations.has(a.conversationId)) throw new Error("A provider operation is already running");
  const task = startConnection(ctx, a);
  startups.set(a.conversationId, task);
  try { return await task; } finally { startups.delete(a.conversationId); }
}

// ---- plan usage limits ---------------------------------------------------------------------------
// Published at `acp.limits`, keyed by contributed provider IDs. Providers own usage commands
// and parsing; the shared transport runs probes and forwards session updates. Cache reuse and
// probe coalescing are workspace-scoped so one workspace can never receive another's snapshot.
let limits: Record<LimitProvider, LimitsSnapshot | null> = {};
let limitScopes: Record<LimitProvider, string> = {};
const probes = new Map<string, Promise<LimitsSnapshot>>();
const probeKey = (provider: string, workspaceId: string) => `${provider}\u0000${workspaceId}`;
function publishLimits(ctx: ModuleContext) { ctx.state.set("acp.limits", limits as any); }
function setLimits(ctx: ModuleContext, provider: LimitProvider, snap: LimitsSnapshot, workspaceId?: string) {
  limits = { ...limits, [provider]: snap };
  if (workspaceId) limitScopes = { ...limitScopes, [provider]: workspaceId };
  publishLimits(ctx);
}

async function probeLimits(ctx: ModuleContext, providerId: LimitProvider, workspaceId: string): Promise<LimitsSnapshot> {
  const definition = await providerById(ctx, providerId);
  if (!definition.usageCommand) throw new Error('This provider does not offer usage checks');
  const desc: WorkspaceDescriptor = await ctx.modules.call("workspace", "resolve", { workspaceId });
  const all = await profiles(ctx);
  const profile = all.find((p: any) => p.enabled && p.provider === providerId && (p.machineId === desc.machineId || p.machineId === "*"));
  if (!profile) throw new Error(`no enabled ${providerId} agent profile for ${desc.machineId}`);
  const det = await detect(ctx, desc, profile.executable);
  if (!det.found) throw new Error(`${profile.executable} was not found on ${desc.machineId}`);
  const env: Record<string, string> = { ...(profile.envRefs || {}) };
  if (det.pathEnv) env.PATH = det.pathEnv;
  const envRemove = await environmentPolicy(ctx, profile);
  for (const key of envRemove) delete env[key];
  const start = startWith(desc, det, profile.executable);
  const execution = { workspaceId, executablePath: start.executable, executableArgs: start.args, env, envRemove, cwd: desc.rootAbsolutePath };
  if (definition.usageCommand.startsWith("module:")) {
    return ctx.modules.call(definition.module, definition.usageCommand.slice(7), execution);
  }
  const g = await workspaceGrant(ctx, desc, "process");
  const proc = await ctx.host.process.spawn(g.grant, {
    target: await targetFor(ctx, desc), executable: execution.executablePath,
    args: [...start.args, ...(profile.args || [])], cwd: desc.rootAbsolutePath, env, envRemove, loginShell: desc.location !== "local",
  });
  const peer = new JsonRpcPeer((line) => ctx.host.process.write(proc.handle, line + "\n"), 1);
  let text = ""; const updates: any[] = [];
  peer.onNotification = (method, params) => {
    const u = method === "session/update" ? params?.update : null;
    if (u?.sessionUpdate === "agent_message_chunk" && u.content?.type === "text") text += u.content.text;
    if (u?.sessionUpdate === "usage_update") updates.push(u);
  };
  peer.onRequest = async (method) => { if (method === "session/request_permission") return { outcome: { outcome: "cancelled" } }; throw rpcError(-32601, `method not supported by client: ${method}`); };
  const subs = [
    await ctx.host.streams.listen(proc.handle, { channel: "stdout" }, (chunk) => peer.feed(chunk), () => peer.failAll("agent process exited")),
  ];
  try {
    await withTimeout(peer.request("initialize", { protocolVersion: PROTOCOL_VERSION, clientCapabilities: CLIENT_CAPABILITIES,
      clientInfo: { name: "hato", title: "Hato usage meter", version: "0.1.0" } }), 60000, "initialize");
    const session: any = await withTimeout(peer.request("session/new", { cwd: desc.rootAbsolutePath, mcpServers: [] }), 120000, "session/new");
    await withTimeout(peer.request("session/prompt", { sessionId: session.sessionId, prompt: [{ type: "text", text: definition.usageCommand }] }), 90000, definition.usageCommand);
  } finally {
    for (const sub of subs) await sub.close().catch(() => {});
    await ctx.host.process.closeStdin(proc.handle).catch(() => {});
    await ctx.host.process.terminate(proc.handle).catch(() => {});
  }
  const snap: LimitsSnapshot = await ctx.modules.call(definition.module, 'parseLimits', { text, updates });
  if (!snap.windows.length) snap.error = /not logged in|API key/i.test(text) ? `${definition.name} is not using a subscription login; plan limits are unavailable` : 'the agent reported no plan limits';
  return snap;
}

function publicState(c: Conn | undefined) {
  if (!c) return null;
  return {
    conversationId: c.conversationId, workspaceId: c.workspaceId, machineId: c.machineId, cwd: c.cwd, profileId: c.profileId,
    pid: c.pid, sessionId: c.sessionId, sessionClosed: !!c.sessionClosed, additionalDirectories: c.additionalDirectories,
    agentInfo: c.agentInfo, agentCapabilities: c.agentCapabilities, authMethods: c.authMethods, authProcess: c.authProcess || null,
    configOptions: c.configOptions, modes: c.modes, models: c.models, commands: c.commands, usage: c.usage || null,
    turnUsage: c.turnUsage || null, sessionInfo: c.sessionInfo || null, childSessions: c.childSessions, compaction: c.compaction || null,
    status: c.status, error: c.error, stderrTail: c.stderrTail.slice(-2000), mcp: c.mcp, executablePath: c.executablePath, startedAt: c.startedAt,
  };
}

function emitStatus(ctx: ModuleContext, c: Conn) { ctx.events.emit("acp.status", publicState(c) as any); }

async function profiles(ctx: ModuleContext) {
  return providerProfiles(ctx);
}

async function resolveProfile(ctx: ModuleContext, id: string, machineId: string) {
  const all = await profiles(ctx);
  const p = all.find((x: any) => x.id === id && x.enabled && (x.machineId === machineId || x.machineId === "*"));
  if (!p) throw new Error(`agent profile '${id}' is not configured for ${machineId}`);
  return p;
}

interface Detected { found: boolean; path: string; pathEnv: string | null; /** Windows: how to start it without cmd.exe. */ launch?: { executable: string; args: string[] } }

const warnedUntested = new Set<string>();

const osLabel = (os: MachineOs) => os === "posix" ? "this machine" : `${PLATFORM_LABELS[os]} projects`;

/**
 * Apply the provider's declared support for the workspace OS. Unsupported agents stop with their note,
 * untested ones warn once per OS, and required tools are located and passed in the agent's env.
 */
async function platformRequirements(ctx: ModuleContext, grant: Handle, desc: WorkspaceDescriptor, profile: any): Promise<Record<string, string>> {
  const os = workspaceOs(ctx, desc);
  const support = platformSupportOf({ platforms: profile.platforms }, os);
  const name = profile.name || profile.id;
  // WSL runs the Linux build of the same agent on this PC.
  const alternative = os === "windows" ? " Open this project in WSL to use it." : "";
  if (support.status === "unsupported")
    throw new Error(`${name} does not support ${osLabel(os)}${support.note ? `: ${support.note}` : "."}${alternative}`);
  if (support.status === "untested" && profile.provider && !warnedUntested.has(`${os}:${profile.provider}`)) {
    warnedUntested.add(`${os}:${profile.provider}`);
    ctx.host.ui.toast("warn", `${name} has not been tested on ${osLabel(os)} yet.${alternative ? " If it misbehaves, open the project in WSL." : ""}`);
  }
  const env: Record<string, string> = {};
  for (const r of support.requires || []) {
    const tool = REQUIRED_TOOLS[r.tool];
    if (!tool) throw new Error(`${name} requires '${r.tool}', which this version of Hato cannot locate. Update Hato.`);
    // Required tools are found on the local machine (native Windows); remote machines resolve their own.
    const found = desc.location === "local" && os === "windows" ? await firstExistingFile(ctx, grant, desc.rootAbsolutePath, tool.programs(ctx)) : null;
    if (!found) throw new Error(`${name} needs ${tool.label} on ${desc.location === "local" ? "this PC" : desc.machineId}. Install it from ${tool.install}, then reconnect.`);
    if (r.env) env[r.env] = found;
  }
  return env;
}

/** Program and leading arguments to start a detected tool (`configured` is the name used remotely). */
function startWith(desc: WorkspaceDescriptor, det: Detected, configured: string): { executable: string; args: string[] } {
  if (det.launch) return det.launch;
  return { executable: desc.location !== "local" ? configured : det.path, args: [] };
}

/** Find the adapter executable on the workspace machine (login-shell PATH). Never installs anything. */
export async function detect(ctx: ModuleContext, desc: WorkspaceDescriptor, executable: string): Promise<Detected> {
  const g = await workspaceGrant(ctx, desc, "process");
  const target = await targetFor(ctx, desc);
  if (workspaceOs(ctx, desc) === "windows") {
    // Registry PATH (finds tools installed after Hato started); npm shims start node.exe directly.
    const r = await resolveWindowsExecutable(ctx, g.grant, desc.rootAbsolutePath, executable);
    return r ? { found: true, path: r.path, pathEnv: r.pathEnv, launch: r.launch } : { found: false, path: "", pathEnv: null };
  }
  if (executable.startsWith("/") && desc.location === "local") {
    const r = await ctx.host.process.run(g.grant, { target, executable: "test", args: ["-x", executable], cwd: desc.rootAbsolutePath }, { timeoutMs: 15000 });
    return { found: r.code === 0, path: executable, pathEnv: null as string | null };
  }
  if (desc.location !== "local") {
    const probe = async (pathEnv: string | null) => {
      const r = await ctx.host.process.run(g.grant, { target, executable: "sh", args: ["-c", 'p=$(command -v -- "$1") || exit; printf "\\n__HATO_EXEC__=%s\\n" "$p"', "hato-detect", executable], cwd: desc.rootAbsolutePath, loginShell: true, ...(pathEnv ? { env: { PATH: pathEnv } } : {}) }, { timeoutMs: 20000 });
      const path = /^__HATO_EXEC__=(.+)$/m.exec(r.stdout)?.[1] || "";
      return { found: r.code === 0 && !!path, path, pathEnv };
    };
    const login = await probe(null);
    if (login.found) return login;
    // Version managers are often initialized only by interactive rc files (including bash's
    // common early return in .bashrc). Capture that PATH without mixing startup output into ACP
    // stdio, then pass it explicitly to the non-interactive agent/npm process.
    const r = await ctx.host.process.run(g.grant, { target, executable: "sh", args: ["-c", 'exec "${SHELL:-/bin/sh}" -ic "$1"', "hato-shell-path", `exec /bin/sh -c 'printf "\\n__HATO_PATH__=%s\\n" "$PATH"'`], cwd: desc.rootAbsolutePath, loginShell: true }, { timeoutMs: 20000 });
    const pathEnv = /^__HATO_PATH__=(.+)$/m.exec(r.stdout)?.[1] || null;
    if (!pathEnv || r.code !== 0) return login;
    const interactive = await probe(pathEnv);
    return interactive.found ? interactive : login;
  }
  // Local: the GUI process may not inherit the user's shell PATH; ask the login shell.
  const shell = (globalThis as any).process?.env?.SHELL || "/bin/sh";
  const r = await ctx.host.process.run(g.grant, { target, executable: shell, args: ["-lc", 'command -v -- "$1"; printf "\\n__PATH__=%s" "$PATH"', "hato-detect", executable], cwd: desc.rootAbsolutePath }, { timeoutMs: 20000 });
  const pathEnv = (/__PATH__=(.*)$/m.exec(r.stdout) || [])[1] || null;
  const found = r.stdout.split("\n").map((l) => l.trim()).find((l) => l.startsWith("/")) || "";
  return { found: !!found, path: found, pathEnv };
}

/** Runs npm on the workspace machine (local: absolute npm + login PATH; SSH: login shell). */
async function npmRunner(ctx: ModuleContext, desc: WorkspaceDescriptor) {
  const det = await detect(ctx, desc, "npm");
  if (!det.found) return { ok: false as const, error: `npm was not found in the login or interactive shell PATH on ${desc.machineId}; check that Node.js and npm are available for this user`, run: null as any };
  const g = await workspaceGrant(ctx, desc, "process");
  const target = await targetFor(ctx, desc);
  const env: Record<string, string> = {};
  if (det.pathEnv) env.PATH = det.pathEnv;
  const start = startWith(desc, det, "npm"), npm = start.executable;
  const run = (args: string[], timeoutMs: number) => ctx.host.process.run(g.grant, {
    target, executable: npm, args: [...start.args, ...args], cwd: desc.rootAbsolutePath, env, loginShell: desc.location !== "local",
  }, { timeoutMs, limitBytes: 1 << 20 });
  /** Where `npm install -g` should go: null for npm's global prefix when this user can write to it,
   *  otherwise `$HOME/.local` (bin in ~/.local/bin) so installing never needs root or sudo. */
  const userPrefix = async (): Promise<string | null> => {
    // Windows: npm's global prefix is %APPDATA%\npm, which the user owns.
    if (workspaceOs(ctx, desc) === "windows") return null;
    const script = 'g=$("$1" prefix -g) || exit 1; m="$g/lib/node_modules"; '
      + 'if [ -w "$m" ] || { [ ! -e "$m" ] && [ -w "$g" ]; }; then printf "\\n__HATO_PREFIX__=\\n"; else printf "\\n__HATO_PREFIX__=%s\\n" "$HOME/.local"; fi';
    const r = await ctx.host.process.run(g.grant, { target, executable: "sh", args: ["-c", script, "hato-npm-prefix", npm], cwd: desc.rootAbsolutePath, env, loginShell: desc.location !== "local" }, { timeoutMs: 30000 });
    const m = /^__HATO_PREFIX__=(.*)$/m.exec(r.stdout);
    return r.code === 0 && m && m[1].trim() ? m[1].trim() : null;
  };
  return { ok: true as const, error: "", run, userPrefix };
}

const installArgs = (pkg: string, prefix: string | null) => ["install", "-g", ...(prefix ? ["--prefix", prefix] : []), `${pkg}@latest`];
const installedVersion = (stdout: string, pkg: string) => { try { return JSON.parse(stdout || "{}").dependencies?.[pkg]?.version || null; } catch { return null; } };

async function authSettings(ctx: ModuleContext): Promise<Record<string, boolean>> {
  const values: Record<string, boolean> = {};
  for (const p of await providers(ctx)) if (p.auth) {
    const v = await ctx.modules.call('persistence', 'settings.get', { key: p.auth.key });
    values[p.auth.field] = v == null ? p.auth.default : !!v;
  }
  return values;
}

async function sessionMcp(ctx: ModuleContext, a: any, desc: WorkspaceDescriptor) {
  const selection = Array.isArray(a.mcpSelection) ? new Set<string>(a.mcpSelection) : null;
  const servers: any[] = (a.mcpServers || []).filter((server: any) => !selection || selection.has(server.id) || selection.has(server.name));
  const wantInternal = !!a.mcp && (!selection || selection.has("internal"));
  let state: Conn["mcp"] = { enabled: false, status: "disabled", selection: [...(selection || [])] };
  if (wantInternal) {
    try {
      const ep = await ctx.modules.call("internal-mcp", "endpoint", { conversationId: a.conversationId, workspaceId: desc.id }, { timeoutMs: 300000 });
      servers.push(ep.server); state = { enabled: true, status: `internal MCP via ${ep.transport}`, selection: [...(selection || ["internal"])] };
    } catch (e) {
      state = { enabled: true, status: `unavailable: ${errMsg(e)}`, selection: [...(selection || ["internal"])] };
      ctx.log.warn("internal MCP unavailable for", a.conversationId, errMsg(e));
    }
  } else if (servers.length) {
    state.enabled = true;
    state.status = `${servers.length} external MCP server${servers.length === 1 ? "" : "s"}`;
  }
  return { servers, state };
}

async function startConnection(ctx: ModuleContext, a: any) {
  const existing = conns.get(a.conversationId);
  if (existing && ((existing.status === "ready" && existing.sessionId && !existing.sessionClosed) || existing.status === "busy" || existing.status === "starting")) return publicState(existing);
  if (existing) {
    existing.stopping = true;
    await ctx.host.process.closeStdin(existing.proc).catch(() => {});
    await ctx.host.process.terminate(existing.proc).catch(() => {});
    conns.delete(a.conversationId);
    await ctx.modules.call("internal-mcp", "revoke", { conversationId: a.conversationId }).catch(() => {});
  }
  const desc: WorkspaceDescriptor = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
  const profile = await resolveProfile(ctx, a.profileId, desc.machineId);
  const det = await detect(ctx, desc, profile.executable);
  if (!det.found) {
    throw new Error(`ACP adapter '${profile.executable}' was not found on ${desc.machineId}. Use Manage agents to install and authenticate it on that machine, or point the profile to an absolute path. Hato never installs agents automatically.`);
  }
  const g = await workspaceGrant(ctx, desc, "process");
  const env: Record<string, string> = { ...(profile.envRefs || {}) };
  if (det.pathEnv) env.PATH = det.pathEnv;
  Object.assign(env, await platformRequirements(ctx, g.grant, desc, profile));
  const envRemove = await environmentPolicy(ctx, profile);
  for (const key of envRemove) delete env[key];
  const dirs = additionalDirectories(a.additionalDirectories);
  const preparedMcp = profile.mcpLaunch ? await sessionMcp(ctx, a, desc) : null;
  const start = startWith(desc, det, profile.executable);
  let launch = providerMcpLaunch(undefined, start.executable, [...start.args, ...(profile.args || [])], env, preparedMcp?.servers || []);
  let spawned;
  try {
    launch = providerMcpLaunch(profile.mcpLaunch, launch.executable, [...start.args, ...(profile.args || [])], env, preparedMcp?.servers || []);
    if (launch.wrapped) {
      const node = await detect(ctx, desc, "node");
      if (!node.found) throw new Error("Node.js is required on the workspace machine for this provider's MCP launcher");
      launch = { ...launch, executable: startWith(desc, node, "node").executable,
        env: { ...launch.env, ...(node.pathEnv ? { PATH: [node.pathEnv, launch.env.PATH].filter(Boolean).join(pathListSeparator(workspaceOs(ctx, desc))) } : {}) } };
    }
    spawned = await ctx.host.process.spawn(g.grant, {
      target: await targetFor(ctx, desc), executable: launch.executable,
      args: launch.args, cwd: desc.rootAbsolutePath, env: launch.env, envRemove, loginShell: desc.location !== "local",
    });
  } catch (e) {
    if (preparedMcp && a.mcp) await ctx.modules.call("internal-mcp", "revoke", { conversationId: a.conversationId }).catch(() => {});
    throw e;
  }
  const c: Conn = {
    conversationId: a.conversationId, workspaceId: desc.id, machineId: desc.machineId, cwd: desc.rootAbsolutePath, profileId: profile.id, providerId: profile.provider, providerModule: profile.providerModule,
    profile, env, envRemove, proc: spawned.handle, pid: spawned.pid, peer: null as any, sessionId: null, sessionClosed: false, additionalDirectories: dirs,
    systemPrompt: typeof a.systemPrompt === "string" ? a.systemPrompt : null,
    agentInfo: null, agentCapabilities: null, steering: false, authMethods: [], authProcess: null,
    configOptions: null, modes: null, models: null, commands: [], usage: null, turnUsage: null, sessionInfo: null, childSessions: {}, compaction: null,
    status: "starting", error: null, stderrTail: "", activeTurn: null, pendingPermissions: new Map(), pendingElicitations: new Map(),
    mcp: { enabled: !!a.mcp, status: a.mcp ? "pending" : "disabled" }, mcpServers: [], executablePath: det.path, launchPrefix: start, startedAt: Date.now(),
  };
  conns.set(c.conversationId, c);
  await wire(ctx, c, 1);
  emitStatus(ctx, c);
  try {
    const airMeta = c.providerId === "claude" || c.profile?.provider === "claude"
      ? { jetbrains: { air: { version: 1, capabilities: ["asyncTasks"] } } } : {};
    const init: any = await sessionRequest(ctx, c, "initialize", {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { ...CLIENT_CAPABILITIES, _meta: { ...OPENCODE_CHILD_OPT_IN, ...airMeta }, ...(ctx.host.env.info().hostFeatures?.includes("pty.spawn") ? { auth: { terminal: true }, _meta: { ...OPENCODE_CHILD_OPT_IN, ...airMeta, "terminal-auth": true } } : {}) },
      clientInfo: { name: "hato", title: "Hato", version: "0.1.0" },
    }, 60000);
    c.agentInfo = init.agentInfo || null;
    c.agentCapabilities = init.agentCapabilities || {};
    c.steering = init._meta?.steering?.supported === true;
    c.authMethods = authMethods(init.authMethods, !!ctx.host.env.info().hostFeatures?.includes("pty.spawn"));
    if (init.protocolVersion !== PROTOCOL_VERSION) throw new Error(`agent negotiated unsupported ACP protocol version ${init.protocolVersion}`);
    const configuredMcp = preparedMcp || await sessionMcp(ctx, a, desc);
    const mcpServers = configuredMcp.servers;
    c.mcp = configuredMcp.state;
    const sessionServers = launch.wrapped ? launch.sessionServers : mcpServers;
    c.mcpServers = sessionServers;
    const caps = c.agentCapabilities.mcpCapabilities || {};
    for (const server of sessionServers) {
      if (server.type === "http" && !caps.http) throw new Error(`Agent does not support HTTP MCP server “${server.name}”`);
      if (server.type === "sse" && !caps.sse) throw new Error(`Agent does not support SSE MCP server “${server.name}”`);
    }
    requireAdditionalDirectories(c, c.additionalDirectories);
    const systemPrompt = acpSystemPrompt(c.agentCapabilities, c.systemPrompt);
    const lifecycle = { cwd: c.cwd, mcpServers: sessionServers, ...(c.additionalDirectories.length ? { additionalDirectories: c.additionalDirectories } : {}), ...(systemPrompt ? { systemPrompt } : {}) };
    let res: any;
    if (a.forkSessionId) {
      if (!c.agentCapabilities.sessionCapabilities?.fork) throw new Error("This agent does not support session forking");
      res = await sessionRequest(ctx, c, "session/fork", { ...lifecycle, sessionId: String(a.forkSessionId) }, 120000);
      validateSessionResult(res);
      c.sessionId = requireSessionId(res?.sessionId);
    } else if (a.resumeSessionId) {
      const sessionId = String(a.resumeSessionId);
      const canResume = !!c.agentCapabilities.sessionCapabilities?.resume;
      const canLoad = !!c.agentCapabilities.loadSession;
      const copilot = c.profile?.provider === "copilot" || c.providerId === "copilot";
      const preferred = a.resumeMode === "load" || (copilot && canLoad) ? ["session/load", "session/resume"] : ["session/resume", "session/load"];
      const methods = preferred.filter((method, index) => (method === "session/resume" ? canResume : canLoad) && preferred.indexOf(method) === index);
      let lastError: string | null = "the agent advertises neither session/resume nor session/load";
      for (const method of methods) {
        let success = false;
        try {
          c.loadingHistory = method === "session/load";
          c.loadingSessionId = sessionId;
          res = await sessionRequest(ctx, c, method, { ...lifecycle, sessionId }, 120000);
          validateSessionResult(res, sessionId);
          c.sessionId = sessionId;
          success = true;
          lastError = null;
          break;
        } catch (e) {
          if (!sessionNotFound(e)) throw e;
          lastError = errMsg(e);
          ctx.log.warn(`${method} failed${methods.indexOf(method) < methods.length - 1 ? "; trying the other resume method" : "; starting a new session"}`, lastError);
        } finally {
          c.loadingHistory = false;
          c.loadingSessionId = null;
          if (method === "session/load") ctx.events.emit("acp.replayEnded", { conversationId: c.conversationId, sessionId, success });
        }
      }
      if (!c.sessionId) ctx.events.emit("acp.update", { conversationId: c.conversationId, update: { sessionUpdate: "_hato_notice", text: `Could not resume the previous agent session (${lastError}); started a new one. A bounded dialogue handoff will accompany the next prompt.` } });
    }
    if (!c.sessionId) {
      res = await sessionRequest(ctx, c, "session/new", lifecycle, 120000);
      validateSessionResult(res);
      c.sessionId = requireSessionId(res?.sessionId);
    }
    c.sessionClosed = false;
    c.configOptions = res && Array.isArray(res.configOptions) ? res.configOptions : null;
    c.modes = res && res.modes ? res.modes : null;
    c.models = res && res.models ? res.models : null;
    c.status = "ready";
  } catch (e: any) {
    c.status = "error";
    const auth = c.authMethods && c.authMethods.length && /auth/i.test(errMsg(e));
    c.error = auth ? `Agent requires authentication on ${c.machineId} (${c.authMethods.map((m: any) => m.name || m.id).join(", ")}). Authenticate the adapter there then reconnect. Details: ${errMsg(e)}` : errMsg(e);
    const message = c.error;
    emitStatus(ctx, c);
    if (!auth) await ctx.host.process.terminate(c.proc).catch(() => {});
    if (a.mcp) await ctx.modules.call("internal-mcp", "revoke", { conversationId: a.conversationId }).catch(() => {});
    throw new Error(message);
  }
  emitStatus(ctx, c);
  return publicState(c);
}

async function sessionRequest(ctx: ModuleContext, c: Conn, method: string, params: any, ms: number): Promise<any> {
  const id = c.peer.nextRequestId;
  try { return await withTimeout(c.peer.request(method, params), ms, method); }
  catch (error) {
    if (/timed out/.test(errMsg(error))) {
      c.peer.cancelRequest(id, `${method} timed out`);
      c.status = "error"; c.error = `${method} timed out; reconnect before continuing`; c.sessionClosed = true;
      emitStatus(ctx, c);
    }
    throw error;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function withReplay<T>(ctx: ModuleContext, c: Conn, sessionId: string, request: () => Promise<T>) {
  c.childSessions = disconnectSubagents(c.childSessions);
  c.loadingHistory = true;
  c.loadingSessionId = sessionId;
  let success = false;
  try { const result = await request(); success = true; return result; }
  finally {
    c.loadingHistory = false;
    c.loadingSessionId = null;
    ctx.events.emit("acp.replayEnded", { conversationId: c.conversationId, sessionId, success });
  }
}

function clearProviderTurn(c: Conn) {
  if (c.providerTurn?.idleTimer) clearTimeout(c.providerTurn.idleTimer);
  c.providerTurn = null;
}

function finishProviderTurn(ctx: ModuleContext, c: Conn, result: { stopReason?: string; error?: string } = { stopReason: "end_turn" }) {
  if (!c.providerTurn) return;
  clearProviderTurn(c);
  if (c.stopping || c.status === "exited" || c.activeTurn) return;
  if (c.status === "busy") c.status = "ready";
  if (result.error) c.error = result.error;
  emitStatus(ctx, c);
  ctx.events.emit("acp.turnEnded", {
    conversationId: c.conversationId,
    ...(result.error ? { error: result.error } : { stopReason: result.stopReason }),
  });
}

function armProviderTurnIdle(ctx: ModuleContext, c: Conn) {
  const pt = c.providerTurn;
  if (!pt || pt.id !== "implicit") return;
  if (pt.idleTimer) clearTimeout(pt.idleTimer);
  if (c.pendingPermissions.size || c.pendingElicitations.size || hasWorkingSubagents(c.childSessions)) {
    pt.idleTimer = undefined;
    return;
  }
  pt.idleTimer = setTimeout(() => {
    if (c.providerTurn !== pt || c.activeTurn) return;
    if (c.pendingPermissions.size || c.pendingElicitations.size || hasWorkingSubagents(c.childSessions)) {
      armProviderTurnIdle(ctx, c);
      return;
    }
    finishProviderTurn(ctx, c);
  }, 1500);
}

const STREAM_UPDATES = new Set(["agent_message_chunk", "agent_thought_chunk", "tool_call", "tool_call_update", "plan"]);

function finishTurn(ctx: ModuleContext, c: Conn, result: { stopReason?: string; usage?: any; error?: string }) {
  if (!c.activeTurn) return;
  if (c.activeTurn.timer) clearTimeout(c.activeTurn.timer);
  c.activeTurn = null;
  if (c.stopping || c.status === "exited") return;
  if (c.status === "busy" && !c.providerTurn) c.status = "ready";
  if (result.usage) c.turnUsage = result.usage;
  if (result.error) c.error = result.error;
  emitStatus(ctx, c);
  ctx.events.emit("acp.turnEnded", {
    conversationId: c.conversationId,
    ...(result.error ? { error: result.error } : { stopReason: result.stopReason }),
    ...(result.usage ? { usage: result.usage } : {}),
  });
}

async function cancelInternal(ctx: ModuleContext, c: Conn) {
  if (c.activeTurn) c.activeTurn.cancelled = true;
  const pt = c.providerTurn;
  for (const resolve of c.pendingPermissions.values()) resolve({ outcome: { outcome: "cancelled" } });
  c.pendingPermissions.clear();
  for (const pending of c.pendingElicitations.values()) {
    clearTimeout(pending.timer);
    pending.resolve({ action: "cancel" });
  }
  c.pendingElicitations.clear();
  if (c.sessionId) {
    if (pt && pt.id !== "implicit") await c.peer.request("_session/async_task/stop", { sessionId: c.sessionId, asyncTaskId: pt.id }).catch(() => {});
    else await c.peer.notify("session/cancel", { sessionId: c.sessionId }).catch(() => {});
  }
  if (pt && !c.activeTurn) finishProviderTurn(ctx, c, { stopReason: "cancelled" });
}

/** Connect the JSON-RPC peer to the process streams (also used after a hot swap). */
async function wire(ctx: ModuleContext, c: Conn, nextId: number, partial = "") {
  c.peer = new JsonRpcPeer((line) => ctx.host.process.write(c.proc, line + "\n"), nextId);
  c.peer.restore(partial);
  c.peer.onNotification = function onNotification(method, params) {
    if (method === "$/cancel_request") { void cancelInternal(ctx, c); return; }
    // OpenCode child lifecycle/traffic (ACP extension methods may arrive with a leading "_").
    if (method === OPENCODE_CHILD_UPDATE || method === `_${OPENCODE_CHILD_UPDATE}`) {
      const update = params?.rootSessionId === (c.loadingSessionId || c.sessionId) ? openCodeChildUpdate(params) : null;
      if (update) onNotification("session/update", update);
      return;
    }
    if (method === "elicitation/complete") {
      ctx.events.emit("acp.elicitationComplete", { conversationId: c.conversationId, ...params });
      return;
    }
    if (method === "session/update" && params && params.update) {
      if (!sessionMatches(c, params)) { ctx.log.warn(`ignored ACP update for foreign session ${String(params.sessionId)}`); return; }
      const u = params.update;
      const childUpdate = knownSubagent(c.childSessions, params.sessionId);
      if (updateSubagents(c.childSessions, c.loadingSessionId || c.sessionId, params, c.loadingHistory === true)) {
        emitStatus(ctx, c);
      }
      // Child traffic must never overwrite the parent's configuration, usage or transcript.
      if (childUpdate || u.sessionUpdate === "subagent_update" || u.sessionUpdate === "_hato_child_status") {
        armProviderTurnIdle(ctx, c);
        return;
      }
      if (!c.loadingHistory && u.sessionUpdate === "async_task_spawned" && u.taskType === "turn" && typeof u.asyncTaskId === "string" && !c.activeTurn && c.status === "ready") {
        clearProviderTurn(c);
        c.providerTurn = { id: u.asyncTaskId };
        c.status = "busy";
        c.error = null;
        emitStatus(ctx, c);
        return;
      }
      if (u.sessionUpdate === "async_task_state_update" && c.providerTurn?.id === u.asyncTaskId && ["completed", "failed", "stopped"].includes(u.state)) {
        finishProviderTurn(ctx, c, u.state === "failed" ? { error: "Autonomous turn failed" } : u.state === "stopped" ? { stopReason: "cancelled" } : { stopReason: "end_turn" });
        return;
      }
      if (u.sessionUpdate === "async_task_spawned" || u.sessionUpdate === "async_task_state_update") return;
      if (!c.loadingHistory && !c.activeTurn && STREAM_UPDATES.has(u.sessionUpdate)) {
        if (c.status === "ready") {
          c.providerTurn = { id: "implicit" };
          c.status = "busy";
          c.error = null;
          emitStatus(ctx, c);
        }
        armProviderTurnIdle(ctx, c);
      }
      if (u.sessionUpdate === "config_option_update" && Array.isArray(u.configOptions)) { c.configOptions = u.configOptions; emitStatus(ctx, c); }
      else if (u.sessionUpdate === "current_mode_update" && c.modes) { c.modes = { ...c.modes, currentModeId: u.currentModeId }; emitStatus(ctx, c); }
      else if (u.sessionUpdate === "usage_update") {
        c.usage = reportedUsage(u); emitStatus(ctx, c);
        if (c.providerModule && c.providerId) {
          const providerId = c.providerId;
          void providerSessionLimits(ctx, providerId, u, limits[providerId] || null)
            .then((next: LimitsSnapshot | null) => { if (next) setLimits(ctx, providerId, next, c.workspaceId); })
            .catch((e) => ctx.log.warn('Provider usage update:', errMsg(e)));
        }
      }
      else if (u.sessionUpdate === "available_commands_update") { c.commands = u.availableCommands || []; emitStatus(ctx, c); }
      else if (u.sessionUpdate === "session_info_update") {
        c.sessionInfo = u;
        const marker = u._meta?.["opencode/compaction"] || params._meta?.["opencode/compaction"];
        if (marker) c.compaction = marker;
        emitStatus(ctx, c);
      }
      else if (u.sessionUpdate === "compaction_update" || u.sessionUpdate === "compaction_summary_chunk") {
        c.compaction = u;
        emitStatus(ctx, c);
      }
      ctx.events.emit("acp.update", { conversationId: c.conversationId, sessionId: params.sessionId, update: u, replayed: c.loadingHistory === true });
      return;
    }
    ctx.events.emit("acp.notification", { conversationId: c.conversationId, method, params });
  };
  c.peer.onRequest = async (method, params, id) => {
    if (!sessionMatches(c, params)) throw rpcError(-32602, "ACP request targets a different session");
    if (method === "session/request_permission") {
      const pending = deferred<any>();
      c.pendingPermissions.set(id, pending.resolve);
      armProviderTurnIdle(ctx, c);
      try {
        return await Promise.race([
          ctx.modules.call("ai-sessions", "permissionRequest", { conversationId: c.conversationId, request: params }, { timeoutMs: 30 * 60 * 1000 }),
          pending.promise,
        ]);
      } finally { c.pendingPermissions.delete(id); armProviderTurnIdle(ctx, c); }
    }
    if (method === "elicitation/create") {
      if (params?.mode !== "form") throw rpcError(-32602, "Only form elicitation is supported");
      if (!params.requestedSchema || typeof params.requestedSchema !== "object" || Array.isArray(params.requestedSchema)) throw rpcError(-32602, "Form elicitation requires an object requestedSchema");
      const pending = deferred<any>();
      const timer = setTimeout(() => {
        c.pendingElicitations.delete(id);
        pending.resolve({ action: "cancel" });
      }, 30 * 60 * 1000);
      c.pendingElicitations.set(id, { params, resolve: pending.resolve, reject: pending.reject, timer });
      armProviderTurnIdle(ctx, c);
      ctx.events.emit("acp.elicitation", { conversationId: c.conversationId, requestId: id, request: params });
      try { return await pending.promise; }
      finally {
        clearTimeout(timer); c.pendingElicitations.delete(id); armProviderTurnIdle(ctx, c);
        ctx.events.emit("acp.elicitationComplete", { conversationId: c.conversationId, requestId: id });
      }
    }
    // fs/* and terminal/* capabilities are not advertised by this client.
    throw rpcError(-32601, `method not supported by client: ${method}`);
  };
  c.peer.onProtocolError = (err, line) => ctx.log.warn(`ACP protocol error (${c.conversationId}): ${err}: ${line.slice(0, 200)}`);
  await ctx.host.streams.listen(c.proc, { channel: "stdout" }, (chunk) => c.peer.feed(chunk), (err) => {
    const wasBusy = c.status === "busy";
    c.status = "exited";
    c.childSessions = disconnectSubagents(c.childSessions);
    if (c.activeTurn?.timer) clearTimeout(c.activeTurn.timer);
    c.activeTurn = null;
    clearProviderTurn(c);
    for (const resolve of c.pendingPermissions.values()) resolve({ outcome: { outcome: "cancelled" } });
    c.pendingPermissions.clear();
    for (const pending of c.pendingElicitations.values()) { clearTimeout(pending.timer); pending.resolve({ action: "cancel" }); }
    c.pendingElicitations.clear();
    if (c.stopping) { c.peer.failAll("agent stopped"); return; }
    c.error = c.error || (err ? errMsg(err) : "agent process exited");
    c.peer.failAll("agent process exited");
    ctx.host.process.wait(c.proc).then((x) => { if (x) c.error = `agent process exited (code ${x.code}${x.signal ? ", signal " + x.signal : ""})${c.stderrTail ? ": " + c.stderrTail.trim().split("\n").slice(-3).join(" | ") : ""}`; emitStatus(ctx, c); }).catch(() => emitStatus(ctx, c));
    if (wasBusy) ctx.events.emit("acp.turnEnded", { conversationId: c.conversationId, error: "agent process exited" });
  });
  await ctx.host.streams.listen(c.proc, { channel: "stderr" }, (chunk) => { c.stderrTail = (c.stderrTail + chunk).slice(-8000); });
}

function lifecycleParams(c: Conn) {
  requireAdditionalDirectories(c, c.additionalDirectories);
  const systemPrompt = acpSystemPrompt(c.agentCapabilities, c.systemPrompt);
  return { cwd: c.cwd, mcpServers: c.mcpServers, ...(c.additionalDirectories.length ? { additionalDirectories: c.additionalDirectories } : {}), ...(systemPrompt ? { systemPrompt } : {}) };
}

function updateAdditionalDirectories(c: Conn, value: any) {
  const dirs = additionalDirectories(value ?? c.additionalDirectories);
  requireAdditionalDirectories(c, dirs);
  c.additionalDirectories = dirs;
}

function requireIdleSession(c: Conn) {
  if (c.status === "busy" || c.status === "starting" || hasWorkingSubagents(c.childSessions) || c.activeTurn || c.loadingHistory || c.authProcess) {
    throw new Error("Wait for the active agent turn, session load, or authentication to finish before changing provider sessions");
  }
}

function validateSessionResult(res: any, expected?: string) {
  if(!res || typeof res!=="object" || Array.isArray(res) || res.sessionId!=null && expected && res.sessionId!==expected) throw new Error("Invalid session setup response");
  requireSessionId(expected || res.sessionId);
  if(res.configOptions!=null && !Array.isArray(res.configOptions))throw new Error("Invalid session setup response: configOptions");
  return res;
}

function applySessionResult(ctx: ModuleContext, c: Conn, res: any, sessionId?: string) {
  validateSessionResult(res, sessionId);
  c.sessionId = requireSessionId(sessionId || res.sessionId);
  const children: AcpSubagents = {};
  const include = (parentId: string) => {
    for (const child of Object.values(c.childSessions)) if (child.parentId === parentId && !knownSubagent(children, child.id)) {
      Object.defineProperty(children, child.id, { value: child, enumerable: true, writable: true, configurable: true });
      include(child.id);
    }
  };
  include(c.sessionId);
  c.childSessions = children;
  c.sessionClosed = false;
  c.configOptions = res && Array.isArray(res.configOptions) ? res.configOptions : null;
  c.modes = res && res.modes ? res.modes : null;
  c.models = res && res.models ? res.models : null;
  c.commands = [];
  c.usage = null;
  c.turnUsage = null;
  c.sessionInfo = null;
  c.compaction = null;
  emitStatus(ctx, c);
}

const mod: AppModule = {
  id: "acp",
  moduleApiVersion: 1,
  async activate(ctx, prev) {
    if (prev?.limits) limits = { ...prev.limits };
    if (prev?.limitScopes) limitScopes = { ...prev.limitScopes };
    for (const k of Object.keys(limits)) if (limits[k]?.loading) limits[k] = { ...limits[k]!, loading: false };
    publishLimits(ctx);
    // Hot-swap hand-over: re-attach live agent processes; the kernel replays buffered stdout.
    if (prev && Array.isArray(prev.conns)) {
      const available = await profiles(ctx);
      for (const s of prev.conns) {
        const p = available.find((p: any) => p.id === s.profileId);
        const c: Conn = {
          ...s, providerId: s.providerId || p?.provider, providerModule: s.providerModule || p?.providerModule,
          peer: null as any, pendingPermissions: new Map(), pendingElicitations: new Map(), activeTurn: null,
          childSessions: s.childSessions || {}, additionalDirectories: s.additionalDirectories || [],
        };
        conns.set(c.conversationId, c);
        if (c.status === "ready" || c.status === "busy") await wire(ctx, c, s.nextId, s.partial);
      }
      ctx.log.info(`re-attached ${prev.conns.length} ACP connection(s) after hot swap`);
    }
  },
  /** Defer swaps while a prompt turn or an agent request is in flight (parser state would be lost). */
  canSwap() {
    if (startups.size || operations.size) return { ok: false, reason: "An ACP operation is running" };
    if (probes.size) return { ok: false, reason: "a usage-limit probe is running" };
    for (const c of conns.values()) {
      if (c.status === "busy" || c.status === "starting" || hasWorkingSubagents(c.childSessions) || c.authProcess || c.pendingPermissions.size || c.pendingElicitations.size || (c.peer && c.peer.pendingCount > 0)) return { ok: false, reason: `ACP session ${c.conversationId} is busy` };
    }
    return { ok: true };
  },
  snapshot() {
    return { limits, limitScopes, conns: Array.from(conns.values()).map((c) => ({ ...publicState(c), proc: c.proc, providerId: c.providerId, providerModule: c.providerModule, profile: c.profile, env: c.env, envRemove: c.envRemove, systemPrompt: c.systemPrompt, mcpServers: c.mcpServers, stderrTail: c.stderrTail, nextId: c.peer ? c.peer.nextRequestId : 1, partial: c.peer ? c.peer.partial : "" })) };
  },
  methods: {
    profiles: async (ctx, a) => {
      const all = await profiles(ctx);
      return a && a.machineId ? all.filter((p: any) => p.machineId === "*" || p.machineId === a.machineId) : all;
    },
    saveProfile: async (ctx, a) => { await ctx.modules.call("persistence", "acpProfiles.upsert", { profile: a.profile }); return null; },
    authSettings: (ctx) => authSettings(ctx),
    async setAuthSettings(ctx, a) {
      for (const p of await providers(ctx)) if (p.auth && typeof a[p.auth.field] === 'boolean') {
        await ctx.modules.call('persistence', 'settings.set', { key: p.auth.key, value: a[p.auth.field] });
      }
      ctx.events.emit("acp.authChanged", await authSettings(ctx));
      return authSettings(ctx);
    },
    detect: async (ctx, a) => {
      const desc = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
      const p = await resolveProfile(ctx, a.profileId, desc.machineId);
      const d = await detect(ctx, desc, p.executable);
      return { ...d, machineId: desc.machineId, executable: p.executable, pathEnv: undefined };
    },
    start: (ctx, a) => start(ctx, a),
    state: (_ctx, a) => publicState(conns.get(a.conversationId)),
    async prompt(ctx, a) {
      const c = conns.get(a.conversationId);
      if (!c || c.status !== "ready" || !c.sessionId || c.sessionClosed) throw new Error(`agent session is ${c ? c.status : "not started"}`);
      if (operations.has(a.conversationId) || startups.has(a.conversationId)) throw new Error("A provider operation is already running");
      if (c.activeTurn) throw new Error("A prompt is already running for this session");
      const blocks = promptBlocks(a, c);
      const timeoutMs = Number.isFinite(a.timeoutMs) ? Math.max(1000, Math.min(30 * 60 * 1000, Number(a.timeoutMs))) : 30 * 60 * 1000;
      clearProviderTurn(c);
      c.status = "busy";
      c.error = null;
      c.turnUsage = null;
      const turn = c.activeTurn = { cancelled: false, timer: undefined as any };
      emitStatus(ctx, c);
      const requestId = c.peer.nextRequestId;
      c.activeTurn.timer = setTimeout(() => {
        if (c.activeTurn !== turn) return;
        c.peer.cancelRequest(requestId, "Prompt timed out");
        void cancelInternal(ctx, c);
        finishTurn(ctx, c, { error: `prompt timed out after ${timeoutMs} ms` });
      }, timeoutMs);
      c.peer.request("session/prompt", { sessionId: c.sessionId, prompt: blocks }).then(
        (r: any) => { if (c.activeTurn === turn) finishTurn(ctx, c, { stopReason: r && r.stopReason, usage: r && r.usage }); },
        (e) => { if (c.activeTurn === turn) finishTurn(ctx, c, { error: errMsg(e) }); },
      );
      return { accepted: true };
    },
    /** Inject a message into the running turn without interrupting it.
     *  Returns `steered`, `promptRequired` (the turn already ended) or `unsupported`. */
    async steer(ctx, a) {
      const c = conns.get(a.conversationId);
      if (!c || !c.sessionId || !c.steering || operations.has(a.conversationId) || startups.has(a.conversationId)) return { outcome: "unsupported" };
      const blocks = promptBlocks(a, c);
      const r: any = await sessionRequest(ctx, c, "_session/steering", { sessionId: c.sessionId, prompt: blocks, _meta: { steering: { idleBehavior: "promptRequired" } } }, 30000);
      return { outcome: r?.outcome === "promptRequired" ? "promptRequired" : "steered" };
    },
    async cancel(ctx, a) {
      const c = conns.get(a.conversationId);
      if (!c || !c.sessionId) return null;
      await cancelInternal(ctx, c);
      return null;
    },
    /** Respond to a form elicitation previously emitted as `acp.elicitation`. */
    respondElicitation(ctx, a) {
      const c = conns.get(a.conversationId);
      const pending = c?.pendingElicitations.get(a.requestId);
      if (!pending) throw new Error("Unknown or completed elicitation request");
      const action = a.response?.action;
      if (!["accept", "decline", "cancel"].includes(action)) throw new Error("Elicitation response action must be accept, decline, or cancel");
      if (action === "accept" && a.response.content != null && (typeof a.response.content !== "object" || Array.isArray(a.response.content))) throw new Error("Accepted elicitation content must be an object");
      clearTimeout(pending.timer);
      pending.resolve(a.response);
      c!.pendingElicitations.delete(a.requestId);
      return null;
    },
    /** ACP session lifecycle surface. These methods intentionally return raw protocol data so
     * a future Hato UI can build session browsers and management controls without another adapter. */
    async listSessions(ctx, a) {
      const c = conns.get(a.conversationId);
      if (!c) throw new Error("agent session not started");
      if (!c.agentCapabilities.sessionCapabilities?.list) throw new Error("This agent does not support session listing");
      const params: any = { cwd: c.cwd };
      if (a.cursor != null) params.cursor = String(a.cursor);
      // ACP session/list is cursor-paginated and has no standard limit field. Callers page with
      // nextCursor; never send adapter-specific parameters that would break honest negotiation.
      return sessionPage(await sessionRequest(ctx, c, "session/list", params, 60000));
    },
    async newSession(ctx, a) {
      const c = conns.get(a.conversationId);
      if (!c) throw new Error("agent session not started");
      requireIdleSession(c);
      updateAdditionalDirectories(c, a.additionalDirectories ?? c.additionalDirectories);
      const res: any = await sessionRequest(ctx, c, "session/new", lifecycleParams(c), 120000);
      applySessionResult(ctx, c, res);
      return publicState(c);
    },
    async resumeSession(ctx, a) {
      const c = conns.get(a.conversationId);
      if (!c) throw new Error("agent session not started");
      requireIdleSession(c);
      if (!c.agentCapabilities.sessionCapabilities?.resume) throw new Error("This agent does not support session resume");
      updateAdditionalDirectories(c, a.additionalDirectories ?? c.additionalDirectories);
      const res: any = await sessionRequest(ctx, c, "session/resume", { ...lifecycleParams(c), sessionId: requireSessionId(a.sessionId) }, 120000);
      applySessionResult(ctx, c, res, requireSessionId(a.sessionId));
      return publicState(c);
    },
    async loadSession(ctx, a) {
      const c = conns.get(a.conversationId);
      if (!c) throw new Error("agent session not started");
      requireIdleSession(c);
      if (!c.agentCapabilities.loadSession) throw new Error("This agent does not support session loading");
      updateAdditionalDirectories(c, a.additionalDirectories ?? c.additionalDirectories);
      const sessionId = requireSessionId(a.sessionId);
      const res: any = await withReplay(ctx, c, sessionId, async () => validateSessionResult(await sessionRequest(ctx, c, "session/load", { ...lifecycleParams(c), sessionId }, 120000), sessionId));
      applySessionResult(ctx, c, res, requireSessionId(a.sessionId));
      return publicState(c);
    },
    async forkSession(ctx, a) {
      const c = conns.get(a.conversationId);
      if (!c) throw new Error("agent session not started");
      requireIdleSession(c);
      if (!c.agentCapabilities.sessionCapabilities?.fork) throw new Error("This agent does not support session forking");
      updateAdditionalDirectories(c, a.additionalDirectories ?? c.additionalDirectories);
      const res: any = await sessionRequest(ctx, c, "session/fork", { ...lifecycleParams(c), sessionId: requireSessionId(a.sessionId) }, 120000);
      applySessionResult(ctx, c, res);
      return publicState(c);
    },
    async closeSession(ctx, a) {
      const c = conns.get(a.conversationId);
      if (!c || !c.sessionId) throw new Error("agent session not started");
      requireIdleSession(c);
      if (!c.agentCapabilities.sessionCapabilities?.close) throw new Error("This agent does not support session close");
      await sessionRequest(ctx, c, "session/close", { sessionId: c.sessionId }, 60000).catch(e => { if (!sessionNotFound(e)) throw e; });
      c.sessionClosed = true;
      emitStatus(ctx, c);
      return publicState(c);
    },
    async deleteSession(ctx, a) {
      const c = conns.get(a.conversationId);
      if (!c) throw new Error("agent session not started");
      requireIdleSession(c);
      if (!c.agentCapabilities.sessionCapabilities?.delete) throw new Error("This agent does not support session deletion");
      const sessionId = requireSessionId(a.sessionId ?? c.sessionId);
      if (!sessionId) throw new Error("sessionId is required");
      await sessionRequest(ctx, c, "session/delete", { sessionId }, 60000).catch(e => { if (!sessionNotFound(e)) throw e; });
      if (sessionId === c.sessionId) { c.sessionId = null; c.sessionClosed = true; emitStatus(ctx, c); }
      return null;
    },
    async authenticate(ctx, a) {
      const c = conns.get(a.conversationId);
      if (!c) throw new Error("agent session not started");
      if (c.authProcess) throw new Error("An authentication process is already running");
      const method = c.authMethods.find((entry: any) => entry.id === a.methodId);
      if (!method) throw new Error(`Unknown authentication method '${String(a.methodId)}'`);
      const terminal = terminalAuthMethod(method);
      if (terminal) {
        if (!ctx.host.env.info().hostFeatures?.includes("pty.spawn")) throw new Error("This host needs an update for interactive authentication");
        if (!a.confirmToken) {
          const desc: WorkspaceDescriptor = await ctx.modules.call("workspace", "resolve", { workspaceId: c.workspaceId });
          const profile = c.profile || await resolveProfile(ctx, c.profileId, desc.machineId);
          const configured = terminalAuthEnvironment(c.env || profile.envRefs || {}, terminal.env, c.envRemove || []);
          const extra = terminal.args ?? (method._meta?.["terminal-auth"] ? ["--login"] : []);
          if (!Array.isArray(extra) || extra.length > 128 || extra.some(v => typeof v !== "string" || v.includes("\0") || v.length > 16384)) throw new Error("Invalid authentication arguments");
          // Use the configured provider invocation; descriptors never choose a command.
          const start = c.launchPrefix || { executable: desc.location === "local" ? c.executablePath : profile.executable, args: [] };
          const launch = providerMcpLaunch(profile.mcpLaunch, start.executable, [...start.args, ...(profile.args || [])], configured.env, []);
          const token = crypto.randomUUID();
          c.authPlan = { token, methodId: method.id, desc, launch, args: [...launch.args, ...extra], envKeys: configured.keys, expires: Date.now() + 300000 };
          return { outcome: "prepared", confirmToken: token, methodId: method.id, label: method.name || method.id, command: launch.executable, args: c.authPlan.args, envKeys: configured.keys, display: [launch.executable, ...c.authPlan.args.map((a: string) => JSON.stringify(a))].join(" ") };
        }
        const plan = c.authPlan;
        if (!plan || plan.token !== a.confirmToken || plan.methodId !== method.id || plan.expires < Date.now()) throw new Error("Authentication launch expired; choose the method again");
        c.authPlan = null;
        const g = await workspaceGrant(ctx, plan.desc, "process");
        const pty = await ctx.host.pty.spawn(g.grant, { target: await targetFor(ctx, plan.desc), executable: plan.launch.executable, args: plan.args, cwd: plan.desc.rootAbsolutePath, env: plan.launch.env, envRemove: c.envRemove || [], loginShell: plan.desc.location !== "local", columns: 100, rows: 24 });
        const attemptId = crypto.randomUUID();
        c.authProcess = { kind: "pty", attemptId, handle: pty.handle, pid: 0, methodId: method.id, command: plan.launch.executable, args: plan.args, envKeys: plan.envKeys, cwd: plan.desc.rootAbsolutePath, machineId: plan.desc.machineId, label: method.name || method.id, startedAt: Date.now() };
        emitStatus(ctx, c);
        let cursor = 0;
        const poll = async () => {
          if (c.authProcess?.attemptId !== attemptId) return;
          try {
            const output = await ctx.host.pty.read(pty.handle, { cursor, limitBytes: 16384 });
            if(c.authProcess?.attemptId!==attemptId)return;
            cursor = output.cursor;
            if (output.text) ctx.events.emit("acp.authOutput", { conversationId: c.conversationId, methodId: method.id, attemptId, data: output.text });
            if (output.exit) {
              c.authProcess = null; emitStatus(ctx, c);
              const code = /^exited with code (\d+)$/.exec(output.exit)?.[1];
              ctx.events.emit("acp.authCompleted", { conversationId: c.conversationId, methodId: method.id, attemptId, code: code === undefined ? null : Number(code), signal: null });
              await ctx.host.pty.close(pty.handle).catch(() => {}); return;
            }
            setTimeout(() => void poll(), 250);
          } catch { if(c.authProcess?.attemptId===attemptId){ c.authProcess=null; emitStatus(ctx,c); ctx.events.emit("acp.authCompleted",{conversationId:c.conversationId,methodId:method.id,attemptId,code:null,signal:null}); } }
        };
        setTimeout(() => void poll(), 250);
        return { outcome: "terminal", ...c.authProcess, display: [plan.launch.executable, ...plan.args.map((a: string) => JSON.stringify(a))].join(" ") };
      }
      await sessionRequest(ctx, c, "authenticate", { methodId: method.id }, 120000);
      c.error = null;
      emitStatus(ctx, c);
      return { outcome: "authenticated", methodId: method.id };
    },
    async authInput(ctx, a) {
      const c = conns.get(a.conversationId);
      if (!c?.authProcess) throw new Error("No terminal authentication is running");
      if (a.attemptId !== c.authProcess.attemptId) throw new Error("Stale authentication input");
      await ctx.host.pty.write(c.authProcess.handle, String(a.data || ""));
      return null;
    },
    async cancelAuth(ctx, a) {
      const c = conns.get(a.conversationId);
      const auth = c?.authProcess;
      if (!auth) return null;
      if (a.attemptId !== auth.attemptId) throw new Error("Stale authentication cancellation");
      await ctx.host.pty.close(auth.handle).catch(() => {});
      if (c.authProcess?.handle === auth.handle) c.authProcess = null;
      emitStatus(ctx, c);
      ctx.events.emit("acp.authCompleted", { conversationId: c.conversationId, methodId: auth.methodId, attemptId: auth.attemptId, code: null, signal: null, cancelled: true });
      return null;
    },
    /** Change a negotiated session setting. Uses configOptions when advertised; legacy modes/models otherwise. */
    async setConfig(ctx, a) {
      const c = conns.get(a.conversationId);
      if (!c || !c.sessionId) throw new Error("agent session not started");
      const changesModel = a.configId === "__model" || c.configOptions?.some((o: any) => o.id === a.configId && o.category === "model");
      if (c.configOptions && c.configOptions.some((o: any) => o.id === a.configId)) {
        const option = c.configOptions.find((o: any) => o.id === a.configId);
        let value = a.value;
        if (option?.type === "boolean") {
          if (typeof value !== "boolean") throw new Error(`Setting '${a.configId}' requires a boolean value`);
        } else if (typeof value !== "string") {
          throw new Error(`Setting '${a.configId}' requires a string value`);
        }
        const r: any = await c.peer.request("session/set_config_option", {
          sessionId: c.sessionId, configId: a.configId,
          ...(option?.type === "boolean" ? { type: "boolean", value } : { value }),
        });
        if (r && Array.isArray(r.configOptions)) c.configOptions = r.configOptions;
      } else if (a.configId === "__mode" && c.modes) {
        await c.peer.request("session/set_mode", { sessionId: c.sessionId, modeId: a.value });
        c.modes = { ...c.modes, currentModeId: a.value };
      } else if (a.configId === "__model" && c.models) {
        await c.peer.request("session/set_model", { sessionId: c.sessionId, modelId: a.value });
        c.models = { ...c.models, currentModelId: a.value };
      } else {
        throw new Error(`agent does not advertise setting '${a.configId}'`);
      }
      if (changesModel) c.usage = null;
      emitStatus(ctx, c);
      return publicState(c);
    },
    async stop(ctx, a) {
      const c = conns.get(a.conversationId);
      if (!c) return null;
      c.stopping = true;
      if (c.activeTurn?.timer) clearTimeout(c.activeTurn.timer);
      c.activeTurn = null;
      clearProviderTurn(c);
      for (const resolve of c.pendingPermissions.values()) resolve({ outcome: { outcome: "cancelled" } });
      c.pendingPermissions.clear();
      for (const pending of c.pendingElicitations.values()) { clearTimeout(pending.timer); pending.resolve({ action: "cancel" }); }
      c.pendingElicitations.clear();
      const auth = c.authProcess;
      if (auth) await ctx.host.pty.close(auth.handle).catch(() => {});
      c.authProcess = null;
      if (auth) ctx.events.emit("acp.authCompleted", { conversationId: c.conversationId, methodId: auth.methodId, attemptId: auth.attemptId, code: null, signal: null, cancelled: true });
      await ctx.host.process.closeStdin(c.proc).catch(() => {});
      await ctx.host.process.terminate(c.proc).catch(() => {});
      c.status = "exited";
      c.childSessions = disconnectSubagents(c.childSessions);
      emitStatus(ctx, c);
      conns.delete(a.conversationId);
      await ctx.modules.call("internal-mcp", "revoke", { conversationId: a.conversationId }).catch(() => {});
      return null;
    },
    list: () => Array.from(conns.values()).map(publicState),

    /** Latest plan usage limits, refreshed through a hidden ACP session when older than `maxAgeMs`
     *  (default 60 s) or when `force`. Concurrent refreshes share one probe. */
    async limits(ctx, a) {
      const provider = String(a?.provider || '');
      await providerById(ctx, provider);
      const workspaceId = a?.workspaceId ? String(a.workspaceId) : null;
      const cur = limits[provider];
      const maxAge = Number.isFinite(a?.maxAgeMs) ? Number(a.maxAgeMs) : 60000;
      if (!workspaceId || (!a.force && cur && !cur.error && limitScopes[provider] === workspaceId && Date.now() - cur.updatedAt < maxAge)) return cur;
      const key = probeKey(provider, workspaceId);
      let p = probes.get(key);
      if (!p) {
        setLimits(ctx, provider, { ...(cur || { provider, windows: [], plan: null, updatedAt: 0, source: "probe", error: null }), loading: true }, workspaceId);
        p = probeLimits(ctx, provider, workspaceId).catch((e) => ({ ...(limits[provider] || { provider, windows: [], plan: null, source: "probe" as const }), updatedAt: Date.now(), error: errMsg(e) }));
        probes.set(key, p);
        p.then((snap) => { probes.delete(key); setLimits(ctx, provider, { ...snap, loading: false }, workspaceId); });
      }
      return p;
    },

    /** Installed/latest versions of the known adapters on the workspace's machine. */
    async adapters(ctx, a) {
      const desc: WorkspaceDescriptor = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
      const definitions = await providers(ctx);
      if (!definitions.length) return [];
      const npm = await npmRunner(ctx, desc);
      const prefix = npm.ok ? await npm.userPrefix().catch(() => null) : null;
      const out: any[] = [];
      for (const definition of definitions) {
        const ad = { id: definition.id, name: definition.profile.name, ...definition.adapter };
        const row: any = { id: ad.id, name: ad.name, pkg: ad.pkg, bin: ad.bin, machineId: desc.machineId, installed: null, latest: null, path: null, error: null,
          platform: (() => { const os = workspaceOs(ctx, desc); return { os, label: os === "posix" ? null : PLATFORM_LABELS[os], ...platformSupportOf(definition, os) }; })(),
          prefix, installCommand: "npm " + installArgs(ad.pkg, prefix).join(" ") };
        try {
          if (!npm.ok) throw new Error(npm.error);
          // A per-user install (see userPrefix) takes precedence over a root-owned global copy.
          if (prefix) row.installed = installedVersion((await npm.run(["ls", "-g", "--prefix", prefix, "--depth=0", "--json", ad.pkg], 60000)).stdout, ad.pkg);
          if (!row.installed) row.installed = installedVersion((await npm.run(["ls", "-g", "--depth=0", "--json", ad.pkg], 60000)).stdout, ad.pkg);
          const view = await npm.run(["view", ad.pkg, "version"], 60000);
          row.latest = view.code === 0 ? view.stdout.trim().split("\n").pop() || null : null;
          if (view.code !== 0) row.error = `cannot reach npm registry: ${view.stderr.trim().split("\n").pop()}`;
          const d = await detect(ctx, desc, ad.bin);
          row.path = d.found ? d.path : null;
        } catch (e) { row.error = errMsg(e); }
        out.push(row);
      }
      return out;
    },

    /** Install/update one known adapter with `npm install -g <pkg>@latest` on the workspace machine.
     *  Only accepted from ai-sessions, which obtains the user's approval first. */
    async installAdapter(ctx, a, meta) {
      if (meta.caller !== "ai-sessions") throw new Error("adapter installation must be requested through ai-sessions (approval required)");
      const definition = await providerById(ctx, String(a.adapterId));
      const ad = { id: definition.id, ...definition.adapter };
      const desc: WorkspaceDescriptor = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
      const npm = await npmRunner(ctx, desc);
      if (!npm.ok) throw new Error(npm.error);
      const prefix = await npm.userPrefix();
      const args = installArgs(ad.pkg, prefix);
      const r = await npm.run(args, 15 * 60 * 1000);
      const tail = (r.stderr + "\n" + r.stdout).trim().split("\n").slice(-12).join("\n");
      ctx.events.emit("acp.adaptersChanged", { machineId: desc.machineId, adapterId: ad.id });
      if (r.code !== 0) throw new Error(`npm ${args.join(" ")} failed on ${desc.machineId} (exit ${r.code}):\n${tail}`);
      // A per-user install only works if its bin directory wins on the login PATH.
      let note: string | null = null;
      if (prefix) {
        const d = await detect(ctx, desc, ad.bin);
        if (!d.found || !d.path.startsWith(prefix + "/bin/")) note = `npm's global folder is not writable, so ${ad.bin} was installed to ${prefix}/bin. `
          + `Add it to the front of PATH on ${desc.machineId} (e.g. in ~/.profile: export PATH="$HOME/.local/bin:$PATH")${d.found ? `; ${d.path} is used now` : ""}.`;
      }
      return { ok: true, adapterId: ad.id, machineId: desc.machineId, output: tail, prefix, note };
    },
  },
};
for (const name of ["newSession", "resumeSession", "loadSession", "forkSession", "closeSession", "deleteSession", "setConfig", "authenticate", "stop"]) {
  const original = mod.methods![name];
  mod.methods![name] = async (ctx, a, meta) => {
    const id = a.conversationId;
    if (startups.has(id) || operations.has(id)) throw new Error("A provider operation is already running");
    const c = conns.get(id);
    if (c && name !== "stop") {
      requireIdleSession(c);
      if(name!=="authenticate" && c.status!=="ready")throw new Error("Reconnect the agent before changing its session");
    }
    const previousDirectories = c?.additionalDirectories;
    operations.set(id, name);
    try { return await original(ctx, a, meta); }
    catch (e) {
      if(c && /Invalid session setup response/.test(errMsg(e))){c.status="error";c.sessionClosed=true;c.error=errMsg(e);emitStatus(ctx,c);}
      if (c && previousDirectories) c.additionalDirectories = previousDirectories; throw e;
    }
    finally { operations.delete(id); }
  };
}
export default mod;
