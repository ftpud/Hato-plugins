// ../sdk/runtime.ts
var grantCache = /* @__PURE__ */ new Map();
var sshCache = /* @__PURE__ */ new Map();
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
async function targetFor(ctx, desc) {
  if (desc.location === "local") return { kind: "local" };
  const c = await sshConnect(ctx, desc);
  return { kind: "ssh", connection: c.connection, machineId: c.machineId };
}
async function workspaceGrant(ctx, desc, kind, root) {
  const r = root || desc.rootAbsolutePath;
  const key = kind + "|" + desc.machineId + "|" + r;
  let p = grantCache.get(key);
  if (!p) {
    p = (async () => {
      const target = await targetFor(ctx, desc);
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

// modules/services/projects/src/index.ts
var gitCache = /* @__PURE__ */ new Map();
var offline = /* @__PURE__ */ new Map();
function projectDesc(p, ssh) {
  return {
    id: `project:${p.id}:root`,
    projectId: p.id,
    name: p.name,
    location: p.kind,
    machineId: p.kind === "ssh" ? `ssh:${p.sshProfileId}` : "local",
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
  const run = async (args) => ctx.host.process.run(g.grant, { target: await targetFor(ctx, desc), executable: "git", args: ["-C", desc.rootAbsolutePath, ...args], cwd: desc.rootAbsolutePath, loginShell: desc.location === "ssh" }, { timeoutMs: 2e4 });
  const top = await run(["rev-parse", "--show-toplevel"]);
  if (top.code !== 0) return { isGit: false, topLevel: null, hasCommits: false, checkedAt: Date.now() };
  const head = await run(["rev-parse", "--verify", "-q", "HEAD"]);
  return { isGit: true, topLevel: top.stdout.trim(), hasCommits: head.code === 0, checkedAt: Date.now() };
}
async function refreshGit(ctx, projectId) {
  try {
    const { desc } = await describeProject(ctx, projectId);
    const info = await detectGit(ctx, desc);
    gitCache.set(projectId, info);
    offline.delete(projectId);
  } catch (e) {
    offline.set(projectId, errMsg(e));
    gitCache.set(projectId, { isGit: gitCache.get(projectId)?.isGit ?? false, topLevel: null, hasCommits: false, error: errMsg(e), checkedAt: Date.now() });
  }
  ctx.events.emit("projects.changed", { projectId });
}
function basename(p) {
  const parts = p.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || p;
}
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
      const root = ctx.host.env.info().initialRoot;
      if (root && (!isWindows(ctx) || wslLocation(root))) {
        try {
          await mod.methods.addLocal(ctx, { path: root }, { caller: "projects" });
          ctx.log.info("registered initial project", root);
        } catch (e) {
          ctx.log.warn("could not register initial root", root, errMsg(e));
        }
      }
    }
    const all = await ctx.modules.call("persistence", "projects.list");
    for (const p of all) if (!gitCache.has(p.id)) refreshGit(ctx, p.id);
  },
  snapshot: () => ({ git: Array.from(gitCache.entries()) }),
  methods: {
    health: async (ctx) => {
      await ctx.modules.call("persistence", "projects.list");
      return { ok: true };
    },
    /** Tree model consumed by projects-panel. Sorted by name (case-insensitive). */
    async tree(ctx) {
      const projects = await ctx.modules.call("persistence", "projects.list");
      const tasks = await ctx.modules.call("persistence", "tasks.list", {});
      const profiles = await ctx.modules.call("persistence", "ssh.list");
      const byProfile = new Map(profiles.map((p) => [p.id, p]));
      const out = projects.map((p) => {
        const git = gitCache.get(p.id);
        const ssh = p.kind === "ssh" ? byProfile.get(p.sshProfileId) : null;
        return {
          id: p.id,
          name: p.name,
          kind: p.kind,
          rootPath: p.rootPath,
          expanded: p.expanded,
          host: ssh ? ssh.transport === "wsl" ? ssh.host : `${ssh.user}@${ssh.host}${ssh.port !== 22 ? ":" + ssh.port : ""}` : null,
          transport: ssh ? ssh.transport : null,
          auth: ssh?.authRef === "password" ? "password" : null,
          needsPassword: ssh?.authRef === "password" && offline.has(p.id),
          isGit: git ? git.isGit : null,
          hasCommits: git ? git.hasCommits : null,
          offline: offline.get(p.id) || null,
          tasks: tasks.filter((t) => t.projectId === p.id).map((t) => ({ id: t.id, name: t.name, branch: t.branch, worktreePath: t.worktreePath, status: t.status }))
        };
      });
      out.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
      return out;
    },
    async get(ctx, a) {
      const { project, desc } = await describeProject(ctx, a.projectId);
      return { ...project, desc, git: gitCache.get(project.id) || null };
    },
    async addLocal(ctx, a) {
      const path = String(a.path || "").trim();
      if (isWindows(ctx)) {
        const wsl = wslLocation(path);
        if (!wsl) throw new Error("On Windows, Hato opens projects in WSL or on a Linux host. Choose a folder under \\\\wsl.localhost, or add a WSL project.");
        return mod.methods.addWsl(ctx, { ...wsl, name: a.name }, { caller: "projects" });
      }
      if (!path.startsWith("/")) throw new Error("project path must be absolute");
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
      const { desc } = await describeProject(ctx, a.projectId);
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
      const all = await ctx.modules.call("persistence", "projects.list");
      await Promise.all(all.filter((p) => !a || !a.projectId || p.id === a.projectId).map((p) => refreshGit(ctx, p.id)));
      return null;
    }
  }
};
var index_default = mod;
export {
  index_default as default
};
