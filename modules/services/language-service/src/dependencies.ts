import type { ModuleContext, SettingField } from "@hato/sdk/types";
import { errMsg, targetFor, workspaceGrant, type WorkspaceDescriptor } from "@hato/sdk/runtime";
import type { LanguageServerSpec } from "@hato/sdk/languages";
import { get as scopedGet, set as scopedSet } from "@hato/sdk/scoped-settings";
import { DEPENDENCY_SCRIPT } from "./dependency-script";

interface DependencyResult {
  ready: boolean; executable: string | null; supported: boolean; directory: string;
  components: { label: string; found: boolean; version?: string; path?: string }[];
}
interface Status { busy: boolean; message: string; ready?: boolean; supported?: boolean }
export class LanguageDependencies {
  private statuses = new Map<string, Status>();
  constructor(private ctx: ModuleContext, private servers: () => LanguageServerSpec[], private selected: () => WorkspaceDescriptor | null,
    private publish: () => void, private configured: (workspace: WorkspaceDescriptor, server: LanguageServerSpec, path: string) => Promise<void>) {}
  get busy() { return [...this.statuses.values()].some(status => status.busy); }
  invalidate(serverId?: string, workspaceId?: string) {
    for (const [key, status] of this.statuses) if (!status.busy && (!serverId || key === `${workspaceId}|${serverId}`)) this.statuses.delete(key);
  }
  fields(server: LanguageServerSpec): SettingField[] {
    if (!server.dependencySetup) return [];
    const workspace = this.selected();
    const status = this.statuses.get(`${workspace?.id}|${server.id}`);
    const target = workspace ? `${workspace.name || workspace.id} (${workspace.machineId})` : "a selected workspace";
    const disabled = !workspace || !!status?.busy;
    return [
      { type: "action", key: "checkDependencies", label: "Dependencies", buttonLabel: status?.busy ? "Working…" : "Check dependencies", disabled,
        description: status?.message || (workspace ? `Check the language server and runtimes on ${target}.` : "Select a workspace to check its dependencies.") },
      { type: "action", key: "installDependencies", label: "Dependency installation", buttonLabel: "Install missing dependencies",
        disabled: disabled || status?.ready === true || status?.supported === false,
        description: `Install missing tools for your user on ${target}, configure this workspace, then check again. Downloads go under ~/.local/share/hato/language-tools; no administrator access is needed. Requires Python 3.8+; automatic runtime downloads support macOS and glibc Linux (x64/arm64).` },
    ];
  }
  async action(serverId: string, key: string, workspaceId?: string): Promise<DependencyResult> {
    const server = this.servers().find(server => server.id === serverId);
    if (!server?.dependencySetup || !["checkDependencies", "installDependencies"].includes(key)) throw new Error("Unknown dependency action");
    const id = workspaceId || this.selected()?.id;
    if (!id) throw new Error("Select a workspace first");
    const workspace: WorkspaceDescriptor = await this.ctx.modules.call("workspace", "resolve", { workspaceId: id });
    const statusKey = `${workspace.id}|${server.id}`;
    if (this.statuses.get(statusKey)?.busy) throw new Error("A dependency operation is already running for this workspace");
    const install = key === "installDependencies";
    this.statuses.set(statusKey, { busy: true, message: `${install ? "Installing missing dependencies" : "Checking dependencies"} on ${workspace.machineId}…` });
    this.publish();
    try {
      const setting = await scopedGet(this.ctx, `language-server.${server.id}.executable`, workspace);
      const executable = typeof setting?.value === "string" && setting.value.trim() ? setting.value.trim() : server.executable;
      const result = await this.run(workspace, { action: install ? "install" : "check", server: server.id, setup: server.dependencySetup, executable }, install);
      if (install) {
        if (!result.ready || !result.executable) throw new Error("Installation finished but some dependencies are still missing");
        await scopedSet(this.ctx, `workspace:${workspace.id}`, `language-server.${server.id}.executable`, result.executable);
        await this.configured(workspace, server, result.executable);
      }
      const details = result.components.map(c => `${c.label}: ${c.found ? c.version || "found" : "missing"}`).join(" · ");
      this.statuses.set(statusKey, { busy: false, ready: result.ready, supported: result.supported,
        message: `${result.ready ? "Ready" : "Missing dependencies"} on ${workspace.machineId}. ${details}${!result.supported ? ". Automatic installation is unavailable on this platform; configure installed tools manually." : ""}` });
      return result;
    } catch (error) {
      this.statuses.set(statusKey, { busy: false, message: `${workspace.machineId}: ${errMsg(error)}` });
      throw error;
    } finally { this.publish(); }
  }
  private async run(workspace: WorkspaceDescriptor, request: object, install: boolean): Promise<DependencyResult> {
    const scope = await workspaceGrant(this.ctx, workspace, "process");
    const target = await targetFor(this.ctx, workspace);
    let diagnostic = "";
    for (const python of ["python3", "python"]) {
      let result;
      try {
        result = await this.ctx.host.process.run(scope.grant, { target, executable: python,
          args: ["-c", DEPENDENCY_SCRIPT, JSON.stringify(request)], cwd: workspace.rootAbsolutePath, loginShell: workspace.location === "ssh" },
          { timeoutMs: install ? 15 * 60 * 1000 : 60000, limitBytes: 65536 });
      } catch (error) {
        if (["ENOENT", "ENOTFOUND", "ENOEXEC"].includes((error as any)?.code)) { diagnostic = errMsg(error); continue; }
        throw error;
      }
      const line = result.stdout.split(/\r?\n/).filter(line => line.startsWith("__HATO_DEPENDENCIES__=")).pop();
      if (!line) {
        diagnostic = (result.stderr || result.stdout).trim().slice(-800);
        if (result.code === 127 || /SyntaxError|not found|not recognized/i.test(diagnostic)) continue;
        throw new Error(`Dependency helper failed (${result.code}): ${diagnostic}`);
      }
      const parsed = JSON.parse(line.slice("__HATO_DEPENDENCIES__=".length));
      if (parsed.error) throw new Error(String(parsed.error));
      if (result.code !== 0 || typeof parsed.ready !== "boolean" || !Array.isArray(parsed.components)) throw new Error("Invalid dependency check result");
      return parsed;
    }
    throw new Error(`Python 3.8+ is required on ${workspace.machineId} to check/install dependencies. ${diagnostic}`);
  }
}
