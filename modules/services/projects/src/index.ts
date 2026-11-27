// projects: registration of local and SSH projects, Git detection on the project's own machine,
// and the project/task tree model. Persistence goes through the `persistence` service.
import type { AppModule, ModuleContext } from "@hato/sdk/types";
import { exportMcpTools } from "@hato/sdk/mcp";
import { cloudMachineId, errMsg, machinePlatformKey, projectWorkspaceId, sshConnect, sshFromProfile, sshProfileSpec, targetFor, workspaceGrant, wslLocation, type WorkspaceDescriptor } from "@hato/sdk/runtime";
import { parseOrder } from "@hato/sdk/settings-order";
import { baseName, isAbsolutePath } from "@hato/sdk/platform";
import { groupTools, pendingGroups, projectGroups } from "./groups";

interface GitInfo { isGit: boolean; topLevel: string | null; hasCommits: boolean; error?: string; checkedAt: number }
interface Project { id: string; name: string; kind: "local" | "ssh" | "cloud"; cloudOrigin?: string; cloudHostId?: string; rootWorkspace?: boolean; rootPath: string; sshProfileId: string | null; expanded: boolean }
const gitCache = new Map<string, GitInfo>();
const offline = new Map<string, string>(); // projectId -> last connectivity error
const ORDER_KEY = "projects.order";
const TASK_TIMEOUT_MS = 180000;
let mcp: ReturnType<typeof exportMcpTools>;

async function orderedProjects(ctx: ModuleContext): Promise<Project[]> {
  const [projects, savedOrder] = await Promise.all([
    ctx.modules.call<Project[]>("persistence", "projects.list"),
    ctx.modules.call("persistence", "settings.get", { key: ORDER_KEY }),
  ]);
  const positions = new Map<string, number>();
  if (Array.isArray(savedOrder)) for (const id of savedOrder) {
    if (typeof id === "string" && !positions.has(id)) positions.set(id, positions.size);
  }
  return projects.sort((a, b) => (positions.get(a.id) ?? positions.size) - (positions.get(b.id) ?? positions.size)
    || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

function projectDesc(p: any, ssh: any): WorkspaceDescriptor {
  return {
    id: projectWorkspaceId(p), projectId: p.id, name: p.name, location: p.kind,
    machineId: p.kind === "cloud" ? cloudMachineId(p.cloudOrigin, p.cloudHostId) : p.kind === "ssh" ? `ssh:${p.sshProfileId}` : "local",
    ...(p.kind === "cloud" ? { cloudHostId: p.cloudHostId } : {}),
    rootAbsolutePath: p.rootPath, connectionRef: p.sshProfileId,
    ssh: ssh ? sshFromProfile(ssh) : null,
  };
}

async function describeProject(ctx: ModuleContext, projectId: string) {
  const p = await ctx.modules.call("persistence", "projects.get", { id: projectId });
  if (!p) throw new Error(`unknown project ${projectId}`);
  const ssh = p.kind === "ssh" ? await ctx.modules.call("persistence", "ssh.get", { id: p.sshProfileId }) : null;
  return { project: p, desc: projectDesc(p, ssh) };
}

/** `git -C <root> rev-parse --show-toplevel` on the project's machine via the process broker. */
async function detectGit(ctx: ModuleContext, desc: WorkspaceDescriptor): Promise<GitInfo> {
  const g = await workspaceGrant(ctx, desc, "process");
  const run = async (args: string[]) => ctx.host.process.run(g.grant, { target: await targetFor(ctx, desc), executable: "git", args: ["-C", desc.rootAbsolutePath, ...args], cwd: desc.rootAbsolutePath, loginShell: desc.location !== "local" }, { timeoutMs: 20000 });
  const top = await run(["rev-parse", "--show-toplevel"]);
  if (top.code !== 0) return { isGit: false, topLevel: null, hasCommits: false, checkedAt: Date.now() };
  const head = await run(["rev-parse", "--verify", "-q", "HEAD"]);
  return { isGit: true, topLevel: top.stdout.trim(), hasCommits: head.code === 0, checkedAt: Date.now() };
}

/** Last platform recorded per SSH machine, so it is written only when it changes. */
const recordedPlatform = new Map<string, string>();

/** Record the OS the kernel detected for an SSH machine; `workspace` adds it to descriptors. */
async function recordPlatform(ctx: ModuleContext, desc: WorkspaceDescriptor) {
  if (desc.location !== "ssh" || desc.ssh?.transport === "wsl") return;
  const platform = (await sshConnect(ctx, desc).catch(() => null))?.platform;
  if (!platform?.os) return;
  const value = JSON.stringify(platform);
  if (recordedPlatform.get(desc.machineId) === value) return;
  await ctx.modules.call("persistence", "settings.set", { key: machinePlatformKey(desc.machineId), value: platform });
  recordedPlatform.set(desc.machineId, value);
  ctx.events.emit("projects.machinePlatform", { machineId: desc.machineId, ...platform });
}

async function refreshGit(ctx: ModuleContext, projectId: string) {
  try {
    const { desc } = await describeProject(ctx, projectId);
    const info = await detectGit(ctx, desc);
    await recordPlatform(ctx, desc).catch(e => ctx.log.warn("record machine platform", errMsg(e)));
    gitCache.set(projectId, info);
    offline.delete(projectId);
  } catch (e) {
    offline.set(projectId, errMsg(e));
    gitCache.set(projectId, { isGit: gitCache.get(projectId)?.isGit ?? false, topLevel: null, hasCommits: false, error: errMsg(e), checkedAt: Date.now() });
  }
  ctx.events.emit("projects.changed", { projectId });
}

const basename = baseName;

const isWindows = (ctx: ModuleContext) => ctx.host.env.info().platform === "windows";

/** Verify the root on its machine (connects + realpaths there), then add the project once. */
async function registerRemote(ctx: ModuleContext, profile: any, remotePath: string, name?: string) {
  const desc: WorkspaceDescriptor = projectDesc({ id: "pending", name: "pending", kind: "ssh", rootPath: remotePath, sshProfileId: profile.id }, profile);
  const g = await workspaceGrant(ctx, desc, "fs");
  const existing = await ctx.modules.call("persistence", "projects.findByRoot", { rootPath: g.root, sshProfileId: profile.id });
  if (existing) return existing;
  const id = crypto.randomUUID();
  await ctx.modules.call("persistence", "projects.insert", { project: { id, name: String(name || `${basename(g.root)} (${profile.host})`), kind: "ssh", rootPath: g.root, sshProfileId: profile.id } });
  await refreshGit(ctx, id);
  ctx.events.emit("projects.changed", { projectId: id });
  return ctx.modules.call("persistence", "projects.get", { id });
}

const mod: AppModule = {
  id: "projects",
  moduleApiVersion: 1,
  async activate(ctx, prev) {
    if (prev && prev.git) for (const [k, v] of prev.git) gitCache.set(k, v);
    // First launch: register --root (or the process cwd) when no project exists.
    const list = await ctx.modules.call("persistence", "projects.list");
    if (list.length === 0) {
      const info = ctx.host.env.info();
      const root = info.initialRoot;
      // On Windows a working directory from Explorer/Start is System32 or the install folder, not a
      // project: register it only when given with `--root` (or when it is inside WSL).
      if (root && (!isWindows(ctx) || info.initialRootExplicit === true || wslLocation(root))) {
        try {
          await mod.methods!.addLocal(ctx, { path: root }, { caller: "projects" });
          ctx.log.info("registered initial project", root);
        } catch (e) { ctx.log.warn("could not register initial root", root, errMsg(e)); }
      }
    }
    // Background git detection (never blocks activation; SSH projects may be offline).
    const all = await ctx.modules.call("persistence", "projects.list");
    for (const p of all) if (p.kind !== "cloud" && !gitCache.has(p.id)) void refreshGit(ctx, p.id);
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
          const current = await ctx.modules.call<WorkspaceDescriptor>("workspace", "resolve", { workspaceId: scope.workspaceId });
          return (await orderedProjects(ctx)).map(p => ({ id: p.id, name: p.name, kind: p.kind, rootPath: p.rootPath,
            current: p.id === current.projectId, isGit: gitCache.get(p.id)?.isGit ?? null }));
        },
      },
      {
        name: "create_task",
        title: "Create a task in any project",
        description: "Create a linked Git worktree in a registered Hato project using its ID from projects__list. An optional branch can be existing or new. The user's workspace selection is preserved.",
        inputSchema: { type: "object", additionalProperties: false, required: ["projectId"], properties: {
          projectId: { type: "string", description: "Project ID from projects__list." },
          name: { type: "string", maxLength: 100, description: "Task name. Defaults to the branch name." },
          branch: { type: "string", maxLength: 200, description: "Branch name. A new branch is generated when omitted." },
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
        },
      },
    ]);
  },
  canSwap: () => ({ ok: (mcp?.pending() ?? 0) === 0 && pendingGroups() === 0, reason: "A Projects command is running" }),
  snapshot: () => ({ git: Array.from(gitCache.entries()) }),
  methods: {
    health: async (ctx) => { await ctx.modules.call("persistence", "projects.list"); return { ok: true }; },
    "groups.list": ctx => projectGroups(ctx, "list"),
    "groups.create": (ctx, a) => projectGroups(ctx, "create", a),
    "groups.rename": (ctx, a) => projectGroups(ctx, "rename", a),
    "groups.delete": (ctx, a) => projectGroups(ctx, "delete", a),
    "groups.reorder": (ctx, a) => projectGroups(ctx, "reorder", a),
    "groups.assign": (ctx, a) => projectGroups(ctx, "assign", a),
    "groups.unassign": (ctx, a) => projectGroups(ctx, "unassign", a),
    "groups.set_active": (ctx, a) => projectGroups(ctx, "set_active", a),

    async setOrder(ctx, a) {
      const projects = await ctx.modules.call<Project[]>("persistence", "projects.list");
      const value = parseOrder(a.order, projects.map(p => p.id));
      await ctx.modules.call("persistence", "settings.set", { key: ORDER_KEY, value });
      ctx.events.emit("projects.changed", { orderChanged: true });
      return null;
    },

    /** Tree model consumed by projects-panel, in the user's saved order. */
    async tree(ctx) {
      const projects = await orderedProjects(ctx);
      const tasks = await ctx.modules.call("persistence", "tasks.list", {});
      const profiles = await ctx.modules.call("persistence", "ssh.list");
      const byProfile = new Map(profiles.map((p: any) => [p.id, p]));
      const cloud = projects.some(p => p.kind === "cloud")
        ? await mod.methods!.cloudHosts(ctx, {}, { caller: "projects" }) : null;
      return projects.map(p => {
        const git = gitCache.get(p.id);
        const ssh: any = p.kind === "ssh" ? byProfile.get(p.sshProfileId) : null;
        const host = p.kind === "cloud" && cloud?.server === p.cloudOrigin
          ? cloud?.hosts.find((h: { id: string }) => h.id === p.cloudHostId) : null;
        const cloudUnavailable = p.kind === "cloud" && (!host?.online || !cloud?.projectIds.includes(p.id));
        return {
          id: p.id, name: p.name, kind: p.kind, rootPath: p.rootPath, expanded: p.expanded,
          ...(p.kind === "cloud" && p.rootWorkspace ? { rootWorkspace: true } : {}),
          host: ssh ? (ssh.transport === "wsl" ? ssh.host : `${ssh.user}@${ssh.host}${ssh.port !== 22 ? ":" + ssh.port : ""}`) : host?.name ?? null,
          transport: ssh ? ssh.transport : null,
          auth: ssh?.authRef === "password" ? "password" : null,
          needsPassword: ssh?.authRef === "password" && offline.has(p.id),
          isGit: git ? git.isGit : null, hasCommits: git ? git.hasCommits : null,
          offline: cloudUnavailable ? "Cloud project or host unavailable" : offline.get(p.id) || null,
          tasks: tasks.filter((t: any) => t.projectId === p.id).map((t: any) => ({ id: t.id, name: t.name, branch: t.branch, worktreePath: t.worktreePath, status: t.status })),
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
      try { await projectGroups(ctx, "list"); } catch (e) { ctx.log.warn("prune project groups", errMsg(e)); }
      gitCache.delete(id); offline.delete(id);
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
        // A folder under \\wsl.localhost is a Linux project in that distribution; any other folder
        // (C:\..., a network share) is a native Windows project.
        const wsl = wslLocation(path);
        if (wsl) return mod.methods!.addWsl(ctx, { ...wsl, name: a.name }, { caller: "projects" });
      }
      if (!isAbsolutePath(path)) throw new Error("project path must be absolute");
      // The kernel canonicalizes and validates the root when granting.
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
        if (a?.refresh) await ctx.modules.call("cloud", "refresh").catch(() => {});
        const [status, inventory] = await Promise.all([
          ctx.modules.call("cloud", "status"), ctx.modules.call("cloud", "inventory"),
        ]);
        return { available: true, server: status.server, signedIn: status.signedIn, hosts: inventory.hosts,
          projectIds: inventory.projects.map((p: { id: string }) => p.id) };
      } catch (e) {
        // `available: false`: the Cloud plugin is not installed (or is disabled), so Cloud
        // projects cannot be offered at all.
        const available = !/no module '|is unavailable|has no active generation/i.test(errMsg(e));
        return { available, server: null, signedIn: false, hosts: [], projectIds: [] };
      }
    },

    async addCloud(ctx, a) {
      const { available, server, signedIn, hosts } = await mod.methods!.cloudHosts(ctx, {}, { caller: "projects" });
      if (!available) throw new Error("Install the Hato Cloud plugin to add Cloud projects.");
      if (!signedIn) throw new Error("Sign in from the Cloud panel first.");
      const host = hosts.find((h: { id: string }) => h.id === a.hostId);
      if (!host?.online) throw new Error("Choose an online Cloud host.");
      const path = String(a.remotePath || "").trim();
      if (!path.startsWith("/")) throw new Error("Enter an absolute path on the Cloud host.");
      const desc = projectDesc({ id: "pending", name: "pending", kind: "cloud", rootPath: path, cloudOrigin: server, cloudHostId: host.id }, null);
      const grant = await workspaceGrant(ctx, desc, "fs");
      const inventory = await ctx.modules.call("cloud", "inventory");
      const existing = inventory.projects.find((p: { hostId: string; path: string }) => p.hostId === host.id && p.path === grant.root);
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
      const { server, signedIn, hosts } = await mod.methods!.cloudHosts(ctx, { refresh: true }, { caller: "projects" });
      if (!signedIn || !server) throw new Error("Sign in from the Cloud panel first.");
      const host = hosts.find((h: { id: string }) => h.id === a.hostId);
      if (!host?.online) throw new Error("Choose an online Cloud host.");
      // The folder must exist on the chosen Cloud host: this also catches picking the wrong machine.
      const desc = projectDesc({ ...project, kind: "cloud", rootWorkspace: true, cloudOrigin: server, cloudHostId: host.id }, null);
      let root: string;
      try { root = (await workspaceGrant(ctx, desc, "fs")).root; }
      catch (e) { throw new Error(`${project.rootPath} isn't reachable on ${host.name}. Pick the Cloud host that is this same machine. (${errMsg(e)})`); }
      const inventory = await ctx.modules.call("cloud", "inventory");
      const clash = inventory.projects.find((p: { id: string; hostId: string; path: string }) => p.hostId === host.id && p.path === root && p.id !== project.id);
      if (clash) throw new Error(`This folder is already a separate Cloud project (“${clash.name}”). Remove that one from Hato first, then move this project.`);
      await ctx.modules.call("cloud", "addProject", { id: project.id, hostId: host.id, name: project.name, path: root });
      const moved = await ctx.modules.call("persistence", "projects.moveToCloud", {
        id: project.id, origin: server, hostId: host.id,
        fromMachineId: `ssh:${project.sshProfileId}`, toMachineId: cloudMachineId(server, host.id),
      });
      offline.delete(project.id);
      await ctx.modules.call("workspace", "refresh", {}).catch(() => {});
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
      // Only the choice is stored: the kernel asks for the password itself, whenever it connects.
      const authRef = password ? "password" : identityFile || "agent";
      const profiles = await ctx.modules.call("persistence", "ssh.list");
      let profile = profiles.find((p: any) => p.host === host && p.user === user && p.port === port && (p.authRef || "agent") === authRef);
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
      if (desc.location === "cloud") await ctx.modules.call("cloud", "prepareProject", { projectId: project.id, origin: project.cloudOrigin }, { timeoutMs: 620000 });
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
      let profile = profiles.find((p: any) => p.transport === "wsl" && p.host === distro);
      if (!profile) {
        // `user` is required by the profile schema; WSL channels run as the distribution's default user.
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
      if (!a?.projectId) await ctx.modules.call("cloud", "refresh").catch(() => {});
      const all = await ctx.modules.call("persistence", "projects.list");
      await Promise.all(all.filter((p: any) => a?.projectId ? p.id === a.projectId : p.kind !== "cloud" || gitCache.has(p.id)).map((p: any) => refreshGit(ctx, p.id)));
      return null;
    },
  },
};
export default mod;
