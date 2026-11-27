// terminals: maps (workspaceId, stableKey) to a kernel-owned PTY handle. Local workspaces get a
// local login shell in the root/worktree; SSH workspaces get an SSH PTY in the remote directory.
// PTY bytes and the emulator buffer live in the kernel; this module only decides which PTY
// belongs to which workspace, so a hot swap of this module never kills a shell.
import { exportMcpTools } from "@hato/sdk/mcp";
import { terminalTools } from "./tools";
import type { AppModule, ModuleContext } from "@hato/sdk/types";
import { daemonTargetFor, errMsg, workspaceGrant, withWorkspace, type WorkspaceDescriptor } from "@hato/sdk/runtime";
import { exportSettings } from "@hato/sdk/settings";
import type { DaemonTarget } from "@hato/sdk/types";
import { hostOs, parseShellChoice, SHELL_SETTING, shellChoiceValue, shellChoiceFor, shellOptions, terminalCandidates, workspaceOs } from "@hato/sdk/platform";
import { set as scopedSet } from "@hato/sdk/scoped-settings";

// Persistence preferences: terminals held by `hato daemon` survive disconnects (remote) and app
// restarts (local). Failures fall back to an ordinary shell with a warning.
let keepRemote = true;
let keepLocal = false;
const ensured = new Map<string, Promise<unknown>>();
const daemonKey = (stable: string) => stable.replace(/[^A-Za-z0-9\-_.:@/]/g, "_");

async function daemonTarget(ctx: ModuleContext, d: WorkspaceDescriptor): Promise<DaemonTarget | null> {
  if (d.location === "cloud") return daemonTargetFor(ctx, d);
  if (d.location === "ssh" ? !keepRemote : !keepLocal) return null;
  // The workspace daemon runs on Linux and macOS; native Windows terminals are ordinary shells.
  if (workspaceOs(ctx, d) === "windows") return null;
  const target = await daemonTargetFor(ctx, d);
  let p = ensured.get(d.machineId);
  if (!p) {
    p = ctx.host.daemon.ensure(target);
    ensured.set(d.machineId, p);
  }
  try { await p; return target; }
  catch (e) {
    ensured.delete(d.machineId);
    ctx.host.ui.toast("warn", `Terminals on ${d.machineId} will not survive disconnects: ${errMsg(e)}`);
    return null;
  }
}

// Shell profile (Windows): a default for all native projects and an optional per-workspace override.
let selected: WorkspaceDescriptor | null = null;
let userShell = "auto";
let workspaceShell: string | null = null;
let distros: string[] = [];

async function loadShells(ctx: ModuleContext) {
  if (hostOs(ctx) !== "windows") return;
  const get = (scopes: string[]) => ctx.modules.call("persistence", "scoped.resolve", { key: SHELL_SETTING, scopes }).catch(() => null);
  userShell = parseShellChoiceValue((await get(["user"]))?.value) || "auto";
  workspaceShell = selected?.location === "local" ? parseShellChoiceValue((await get([`workspace:${selected.id}`]))?.value) : null;
  if (!distros.length) distros = await ctx.host.ssh.wslDistributions().catch(() => []);
}

/** A stored value normalized to a select option value (null when unset). */
const parseShellChoiceValue = (v: unknown) => typeof v === "string" && v ? shellChoiceValue(parseShellChoice(v)) : null;

function shellFields() {
  const options = shellOptions(distros);
  const local = selected?.location === "local";
  return [
    { key: "shell", label: "Shell", type: "select" as const, value: userShell, options,
      description: "Terminals and workflow Script/Run App blocks in native Windows projects (run configurations start their programs directly). WSL and SSH projects use the login shell there." },
    { key: "workspaceShell", label: "Shell for this workspace", type: "select" as const, value: local ? workspaceShell || "default" : "default",
      options: [{ value: "default", label: "Use the default shell" }, ...options],
      description: local ? `Overrides the shell for ${selected!.name}. Reopen a terminal to apply.` : "Select a native Windows project to override its shell." },
  ];
}

/** A Markdown code block typed into a native Windows terminal, if that terminal's shell can run it. */
async function windowsCode(ctx: ModuleContext, d: WorkspaceDescriptor, language: string, code: string): Promise<string> {
  const kind = (await shellChoiceFor(ctx, d)).kind;
  const powershell = kind === "auto" || kind === "pwsh" || kind === "powershell";
  const posix = kind === "git-bash" || kind === "wsl";
  if (["powershell", "pwsh", "ps1"].includes(language) && powershell) return code.replace(/\n$/, "");
  if (["cmd", "bat", "batch"].includes(language) && kind === "cmd") return code.replace(/\n$/, "");
  if (["sh", "shell", "bash", "zsh"].includes(language) && posix) {
    let delimiter = "HATO_SCRIPT";
    while (code.split(/\r?\n/).includes(delimiter)) delimiter += "_";
    return `${language === "zsh" ? "bash" : language === "shell" ? "sh" : language} <<'${delimiter}'\n${code}${code.endsWith("\n") ? "" : "\n"}${delimiter}`;
  }
  throw new Error(`This terminal's shell cannot run ${language || "this"} code. Choose a matching shell in Settings → Terminals, or open the project in WSL.`);
}

let commands: ReturnType<typeof terminalTools>;
let contribution: ReturnType<typeof exportMcpTools>;
const keyFor = (workspaceId: string, key: string) => `pty:${workspaceId}:${key || "main"}`;

async function attach(ctx: ModuleContext, a: any, forceNew = false) {
  const d: WorkspaceDescriptor = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
  const stable = keyFor(d.id, a.key);
  commands?.remember(d.id, a.key || "main");
  const existing = await ctx.host.resources.lookup(stable);
  if (existing && !forceNew) {
    const info: any = await ctx.host.pty.info(existing);
    // An exited shell stays visible (with its exit status) until the user restarts it explicitly.
    if (d.location !== "cloud" || info.exit !== "exited (Cloud connection closed)") {
      return { pty: existing, machineId: info.machineId, cwd: info.cwd, exited: info.exit, reattached: true };
    }
    await ctx.host.resources.release(existing);
  }
  if (existing && forceNew) await ctx.host.pty.close(existing).catch(() => {});
  if (d.location === "cloud") {
    const target = await daemonTargetFor(ctx, d);
    if (target.kind !== "cloud") throw new Error("Invalid Cloud terminal route.");
    if (forceNew) {
      await ctx.host.daemon.request(target, "pty.kill", { key: daemonKey(stable) }).catch(e => {
        if (!/no terminal/.test(errMsg(e))) throw e;
      });
    }
    const r = await ctx.host.daemon.cloudOpenTerminal(target, {
      cwd: d.rootAbsolutePath, key: daemonKey(stable), columns: a.columns || 120, rows: a.rows || 30,
    });
    await ctx.host.resources.retainForWorkspace(r.handle, stable);
    ctx.events.emit("terminals.changed", { workspaceId: d.id });
    return { pty: r.handle, machineId: r.machineId, cwd: r.cwd, exited: null, reattached: false };
  }
  return withWorkspace(ctx, d, async () => {
    const g = await workspaceGrant(ctx, d, "pty");
    const target = await daemonTarget(ctx, d);
    // Restart means a fresh shell: drop the daemon-held one first.
    if (target && forceNew) await ctx.host.daemon.request(target, "pty.kill", { key: daemonKey(stable) }).catch(() => {});
    const shell = workspaceOs(ctx, d) === "windows" ? terminalCandidates(ctx, await shellChoiceFor(ctx, d)) : null;
    const r = await ctx.host.pty.open(g.grant, { cwd: d.rootAbsolutePath, columns: a.columns || 120, rows: a.rows || 30,
      ...(target ? { persist: { key: daemonKey(stable) } } : {}), ...(shell ? { shellCandidates: shell } : {}) });
    await ctx.host.resources.retainForWorkspace(r.handle, stable);
    ctx.events.emit("terminals.changed", { workspaceId: d.id });
    return { pty: r.handle, machineId: r.machineId, cwd: r.cwd, exited: null, reattached: false };
  });
}

const mod: AppModule = {
  id: "terminals",
  moduleApiVersion: 1,
  async activate(ctx, prev) {
    commands = terminalTools(ctx, prev?.known);
    contribution = exportMcpTools(ctx, "Terminal", commands.tools);
    const saved = await ctx.modules.call("persistence", "settings.get", { key: "terminals.persistence" }).catch(() => null);
    if (saved && typeof saved === "object") { keepRemote = saved.remote !== false; keepLocal = saved.local === true; }
    const windows = hostOs(ctx) === "windows";
    selected = ctx.state.get("workspace.selected") as any || null;
    await loadShells(ctx);
    const publish = exportSettings(ctx, () => [{ key: "terminals", title: "Terminals", fields: [
      ...(windows ? shellFields() : []),
      { key: "remote", label: "Keep SSH terminals running on the server", type: "toggle", value: keepRemote,
        description: "Shells run inside the Hato daemon on the remote machine and survive disconnects; reopening reattaches." },
      { key: "local", label: "Keep local terminals running after quitting", type: "toggle", value: keepLocal,
        description: windows ? "Applies to WSL projects. Native Windows terminals end when Hato quits." : "Shells run inside a local Hato daemon and are reattached at the next start." },
    ] }], async (_section, key, value) => {
      if (key === "shell" || key === "workspaceShell") {
        if (typeof value !== "string") throw new Error("Invalid shell");
        const scope = key === "shell" ? "user" : selected && selected.location === "local" ? `workspace:${selected.id}` as const : null;
        if (!scope) throw new Error("Select a local Windows workspace first");
        await scopedSet(ctx, scope, SHELL_SETTING, value === "default" ? null : value);
        await loadShells(ctx);
        return;
      }
      if ((key !== "remote" && key !== "local") || typeof value !== "boolean") throw new Error("Invalid terminal preference");
      const next = { remote: key === "remote" ? value : keepRemote, local: key === "local" ? value : keepLocal };
      await ctx.modules.call("persistence", "settings.set", { key: "terminals.persistence", value: next });
      keepRemote = next.remote; keepLocal = next.local;
    });
    ctx.state.watch("workspace.selected", (value: any) => {
      if (selected?.id === value?.id) return;
      selected = value || null;
      void loadShells(ctx).then(() => publish()).catch(e => publish(errMsg(e)));
    });
  },
  snapshot: () => ({ known: commands.snapshot() }),
  canSwap: async () => ({ ok: !commands.running() && !contribution.pending(), reason: "A terminal MCP command is in progress" }),
  methods: {
    async workspaceControl(ctx,a,meta) {
      if(meta.caller!=="internal-remote-mcp")throw new Error("Workspace terminal control requires the workspace MCP server");
      const tool=commands.tools.find(t=>t.name===a.tool);
      if(!tool)throw new Error("Unknown terminal tool");
      return tool.handler(a.args||{},a.scope);
    },
    attach: (ctx, a) => attach(ctx, a, false),
    restart: (ctx, a) => attach(ctx, a, true),
    async close(ctx, a) {
      const h = await ctx.host.resources.lookup(keyFor(a.workspaceId, a.key));
      if (h) await ctx.host.pty.close(h);
      // Closing a tab ends the shell, including a daemon-held one.
      try {
        const d: WorkspaceDescriptor = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
        const target = await daemonTarget(ctx, d);
        if (target) await ctx.host.daemon.request(target, "pty.kill", { key: daemonKey(keyFor(d.id, a.key)) }).catch(() => {});
      } catch { /* workspace gone: nothing to clean up remotely */ }
      commands?.forget(a.workspaceId, a.key || "main");
      ctx.events.emit("terminals.changed", { workspaceId: a.workspaceId });
      return null;
    },
    async runCode(ctx, a) {
      const d: WorkspaceDescriptor = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
      const tool = commands.tools.find(tool => tool.name === "send")!;
      const windows = workspaceOs(ctx, d) === "windows";
      if (!windows && ["powershell", "pwsh", "ps1", "cmd", "bat", "batch"].includes(String(a.language || "")))
        throw new Error(`${a.language} code runs only in native Windows projects.`);
      const text = windows ? await windowsCode(ctx, d, String(a.language || ""), String(a.code ?? "")) : a.command;
      return tool.handler({ tab: a.key, text, enter: true }, { conversationId: "markdown", workspaceId: d.id, machineId: d.machineId });
    },
    async activity(ctx, a) {
      const keys = [...new Set<string>((Array.isArray(a.keys) ? a.keys : []).filter((key: unknown) => typeof key === "string"))].slice(0, 128);
      return Promise.all(keys.map(async key => {
        const handle = await ctx.host.resources.lookup(keyFor(a.workspaceId, key));
        if (!handle) return { key, cursor: null };
        try { const output = await ctx.host.pty.read(handle, { limitBytes: 1 }); return { key, cursor: output.endCursor }; }
        catch { return { key, cursor: null }; }
      }));
    },
    async lookup(ctx, a) { return ctx.host.resources.lookup(keyFor(a.workspaceId, a.key)); },
    async info(ctx, a) {
      const h = await ctx.host.resources.lookup(keyFor(a.workspaceId, a.key));
      return h ? { pty: h, ...(await ctx.host.pty.info(h) as any) } : null;
    },
    async send(ctx, a) {
      const h = await ctx.host.resources.lookup(keyFor(a.workspaceId, a.key));
      if (!h) throw new Error("no terminal for this workspace");
      await ctx.host.pty.write(h, String(a.text));
      return null;
    },
  },
};
export default mod;
