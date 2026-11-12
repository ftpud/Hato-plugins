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
function shortId(uuid) {
  return uuid.replace(/-/g, "").slice(0, 8);
}
function errMsg(e) {
  return e && (e.message || String(e)) || "unknown error";
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

// modules/services/git-tasks/src/tools.ts
var object = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
function taskTools(ctx, ops) {
  const projectOf = async (scope) => {
    const d = await ctx.modules.call("workspace", "resolve", { workspaceId: scope.workspaceId });
    return { projectId: String(d.projectId), currentTaskId: d.taskId };
  };
  const view = (t, currentTaskId) => ({
    id: t.id,
    workspaceId: `task:${t.id}`,
    name: t.name,
    branch: t.branch,
    worktreePath: t.worktreePath,
    status: t.status,
    current: t.id === currentTaskId
  });
  return [
    {
      name: "list",
      title: "List Git tasks",
      description: "List the Git tasks (branch + linked worktree) of the current project, including status and worktree path.",
      inputSchema: object({}),
      annotations: { readOnlyHint: true },
      async handler(_args, scope) {
        const { projectId, currentTaskId } = await projectOf(scope);
        const tasks = await ctx.modules.call("persistence", "tasks.list", { projectId });
        return tasks.map((t) => view(t, currentTaskId));
      }
    },
    {
      name: "create",
      title: "Create a Git task",
      description: "Create a Git task in the current project: a linked worktree on its own branch. With `branch`, an existing local branch is checked out, a branch existing on exactly one remote is tracked, and otherwise a new branch is created from HEAD. Without it, a task/<name>-<id> branch is generated. Does not switch the user's view.",
      inputSchema: object({
        name: { type: "string", maxLength: 100, description: "Task name shown in Hato. Defaults to the branch name." },
        branch: { type: "string", maxLength: 200, description: "Optional full branch name, e.g. feature/login-fix." }
      }),
      timeoutMs: 3e5,
      async handler(args, scope) {
        const name = typeof args.name === "string" ? args.name : void 0;
        const branch = typeof args.branch === "string" ? args.branch : void 0;
        if (!name?.trim() && !branch?.trim()) throw new Error("Provide a task name or a branch");
        const { projectId } = await projectOf(scope);
        return ops.create({ projectId, name, branch, select: false });
      }
    },
    {
      name: "merge",
      title: "Merge a Git task",
      description: "Merge a task's branch into the branch checked out in the project root (normally main). Refuses when the task or the project checkout has uncommitted changes, and aborts without changing anything on conflicts. Never switches branches.",
      inputSchema: object({
        taskId: { type: "string", description: "Task id from the list tool." },
        squash: { type: "boolean", description: "Squash the task into one commit instead of a merge commit." }
      }, ["taskId"]),
      timeoutMs: 3e5,
      async handler(args, scope) {
        const { projectId } = await projectOf(scope);
        const tasks = await ctx.modules.call("persistence", "tasks.list", { projectId });
        if (!tasks.some((t) => t.id === args.taskId)) throw new Error("Task not found in the current project");
        return ops.merge({ taskId: String(args.taskId), squash: args.squash === true });
      }
    },
    {
      name: "delete",
      title: "Delete a Git task",
      description: "Delete a task of the current project: removes its linked worktree and Hato's task entry. Refuses when the worktree has uncommitted changes. With deleteMergedBranch, also deletes the branch if it is fully merged. Cannot delete the task this session runs in.",
      inputSchema: object({
        taskId: { type: "string", description: "Task id from the list tool." },
        deleteMergedBranch: { type: "boolean", description: "Also delete the branch when it is fully merged (git branch -d)." }
      }, ["taskId"]),
      annotations: { destructiveHint: true },
      timeoutMs: 18e4,
      async handler(args, scope) {
        const { projectId, currentTaskId } = await projectOf(scope);
        if (args.taskId === currentTaskId) throw new Error("Cannot delete the task this session is running in");
        const tasks = await ctx.modules.call("persistence", "tasks.list", { projectId });
        if (!tasks.some((t) => t.id === args.taskId)) throw new Error("Task not found in the current project");
        return ops.remove({ taskId: String(args.taskId), force: false, deleteBranch: args.deleteMergedBranch === true ? "merged" : false });
      }
    },
    {
      name: "reconcile",
      title: "Reconcile Git tasks",
      description: "Compare the current project's tasks with `git worktree list` and update task statuses (missing, prunable, branch-mismatch). Never deletes anything.",
      inputSchema: object({}),
      annotations: { idempotentHint: true },
      async handler(_args, scope) {
        const { projectId } = await projectOf(scope);
        return ops.reconcile(projectId);
      }
    }
  ];
}

// modules/services/git-tasks/src/index.ts
function slugify(name) {
  const s = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return s || "task";
}
async function git(ctx, desc, args, timeoutMs = 6e4) {
  const g = await workspaceGrant(ctx, desc, "process");
  return ctx.host.process.run(g.grant, {
    target: await targetFor(ctx, desc),
    executable: "git",
    args,
    cwd: desc.rootAbsolutePath,
    loginShell: desc.location === "ssh"
  }, { timeoutMs });
}
function must(r, what) {
  if (r.code !== 0) throw new Error(`${what} failed (exit ${r.code}): ${(r.stderr || r.stdout).trim().slice(0, 800)}`);
  return r.stdout;
}
function parsePorcelain(out) {
  const items = [];
  let cur = null;
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (cur) items.push(cur);
      cur = { worktree: line.slice(9), branch: null, head: null, detached: false, prunable: false };
    } else if (cur && line.startsWith("branch ")) cur.branch = line.slice(7).replace(/^refs\/heads\//, "");
    else if (cur && line.startsWith("HEAD ")) cur.head = line.slice(5);
    else if (cur && line === "detached") cur.detached = true;
    else if (cur && line.startsWith("prunable")) cur.prunable = true;
  }
  if (cur) items.push(cur);
  return items;
}
async function remoteStateDir(ctx, desc) {
  const c = await ctx.host.ssh.connect(sshProfileSpec(desc.ssh));
  if (!c.home) throw new Error("cannot determine remote home directory");
  return `${c.home.replace(/\/+$/, "")}/.local/state/hato`;
}
async function reconcile(ctx, projectId) {
  const proj = await ctx.modules.call("projects", "get", { projectId });
  const tasks = await ctx.modules.call("persistence", "tasks.list", { projectId });
  if (tasks.length === 0) return { tasks: [], worktrees: [] };
  const out = await git(ctx, proj.desc, ["-C", proj.desc.rootAbsolutePath, "worktree", "list", "--porcelain"]);
  if (out.code !== 0) return { error: out.stderr.trim(), tasks };
  const wts = parsePorcelain(out.stdout);
  const changed = [];
  for (const t of tasks) {
    const wt = wts.find((w) => w.worktree === t.worktreePath);
    const status = !wt ? "missing" : wt.prunable ? "prunable" : wt.branch !== t.branch ? "branch-mismatch" : "ready";
    if (status !== t.status) {
      await ctx.modules.call("persistence", "tasks.setStatus", { id: t.id, status });
      changed.push({ id: t.id, status });
    }
  }
  if (changed.length) ctx.events.emit("git-tasks.changed", { projectId, changed });
  return { worktrees: wts, changed };
}
var contribution = null;
async function taskContext(ctx, taskId) {
  const task = await ctx.modules.call("persistence", "tasks.get", { id: String(taskId || "") });
  if (!task) throw new Error("Unknown task");
  const proj = await ctx.modules.call("projects", "get", { projectId: task.projectId });
  return { task, proj, desc: proj.desc, root: proj.desc.rootAbsolutePath };
}
async function porcelain(ctx, desc, dir) {
  return must(await git(ctx, desc, ["-C", dir, "status", "--porcelain"]), "git status").split("\n").filter(Boolean);
}
async function mergeTask(ctx, a) {
  const { task, proj, desc, root } = await taskContext(ctx, a.taskId);
  const current = must(await git(ctx, desc, ["-C", root, "symbolic-ref", "--short", "-q", "HEAD"]), "git symbolic-ref").trim();
  const target = String(a.target || current).trim();
  if (target !== current) throw new Error(`The project checkout is on ${current}, not ${target}. Check out ${target} in ${proj.name} first.`);
  if (target === task.branch) throw new Error("The task branch is the project's current branch");
  if (task.status === "ready") {
    const pending = await porcelain(ctx, desc, task.worktreePath).catch(() => []);
    if (pending.length) throw new Error(`Task ${task.name} has ${pending.length} uncommitted change(s); commit them before merging.`);
  }
  const dirty = await porcelain(ctx, desc, root);
  if (dirty.length) throw new Error(`${proj.name} has ${dirty.length} uncommitted change(s) on ${target}; commit or stash them before merging.`);
  const ahead = Number(must(await git(ctx, desc, ["-C", root, "rev-list", "--count", `${target}..${task.branch}`]), "git rev-list").trim());
  if (!ahead) return { merged: false, target, branch: task.branch, message: `${task.branch} has no commits that are not already in ${target}.` };
  const args = a.squash ? ["merge", "--squash", task.branch] : ["merge", "--no-ff", "--no-edit", "-m", `Merge task ${task.name} (${task.branch})`, task.branch];
  const r = await git(ctx, desc, ["-C", root, ...args], 18e4);
  if (r.code !== 0) {
    const conflicts = (await git(ctx, desc, ["-C", root, "diff", "--name-only", "--diff-filter=U"])).stdout.split("\n").filter(Boolean);
    await git(ctx, desc, ["-C", root, "merge", "--abort"]);
    if (a.squash) await git(ctx, desc, ["-C", root, "reset", "--merge"]);
    throw new Error(conflicts.length ? `Merging ${task.branch} into ${target} conflicts in ${conflicts.slice(0, 10).join(", ")}${conflicts.length > 10 ? "…" : ""}. Nothing was changed; merge ${target} into the task and resolve there first.` : `git merge failed (exit ${r.code}): ${(r.stderr || r.stdout).trim().slice(0, 800)}`);
  }
  if (a.squash) must(await git(ctx, desc, ["-C", root, "commit", "--no-edit", "-m", `Task ${task.name} (${task.branch})`]), "git commit");
  ctx.events.emit("git.changed", { workspaceId: `project:${proj.id}:root` });
  ctx.events.emit("git-tasks.changed", { projectId: proj.id, taskId: task.id, merged: true });
  return { merged: true, target, branch: task.branch, commits: ahead, squash: !!a.squash };
}
async function removeTask(ctx, a) {
  const { task, proj, desc, root } = await taskContext(ctx, a.taskId);
  const list = parsePorcelain(must(await git(ctx, desc, ["-C", root, "worktree", "list", "--porcelain"]), "git worktree list"));
  const wt = list.find((w) => w.worktree === task.worktreePath);
  if (wt && !wt.prunable) {
    const pending = await porcelain(ctx, desc, task.worktreePath);
    if (pending.length && !a.force) throw new Error(`Task ${task.name} has ${pending.length} uncommitted change(s). Commit them, or delete with force to discard them.`);
    must(await git(ctx, desc, ["-C", root, "worktree", "remove", ...a.force ? ["--force"] : [], task.worktreePath], 12e4), "git worktree remove");
  } else await git(ctx, desc, ["-C", root, "worktree", "prune"]);
  let branchDeleted = false, branchWarning = null;
  if (a.deleteBranch) {
    const r = await git(ctx, desc, ["-C", root, "branch", a.deleteBranch === "force" ? "-D" : "-d", task.branch]);
    if (r.code === 0) branchDeleted = true;
    else branchWarning = `Kept branch ${task.branch}: ${(r.stderr || r.stdout).trim().split("\n")[0]}`;
  }
  await ctx.modules.call("workspace", "forget", { workspaceIds: [`task:${task.id}`] });
  await ctx.modules.call("persistence", "tasks.delete", { id: task.id });
  ctx.events.emit("git-tasks.changed", { projectId: proj.id, taskId: task.id, removed: true });
  return { removed: true, branch: task.branch, branchDeleted, warning: branchWarning };
}
var mod = {
  id: "git-tasks",
  moduleApiVersion: 1,
  async activate(ctx) {
    contribution = exportMcpTools(ctx, "Git tasks", taskTools(ctx, {
      create: (args) => mod.methods.create(ctx, args, { caller: "git-tasks" }),
      reconcile: (projectId) => reconcile(ctx, projectId),
      merge: (args) => mergeTask(ctx, args),
      remove: (args) => removeTask(ctx, args)
    }));
    setTimeout(async () => {
      try {
        const projects = await ctx.modules.call("persistence", "projects.list");
        for (const p of projects) reconcile(ctx, p.id).catch((e) => ctx.log.warn("reconcile", p.name, errMsg(e)));
      } catch (e) {
        ctx.log.warn("reconcile failed", errMsg(e));
      }
    }, 500);
  },
  canSwap: () => ({ ok: (contribution?.pending() ?? 0) === 0, reason: "A Git task MCP command is running" }),
  methods: {
    list: (ctx, a) => ctx.modules.call("persistence", "tasks.list", { projectId: a.projectId }),
    reconcile: (ctx, a) => reconcile(ctx, a.projectId),
    merge: (ctx, a) => mergeTask(ctx, { taskId: a.taskId, target: a.target, squash: !!a.squash }),
    remove: (ctx, a) => removeTask(ctx, { taskId: a.taskId, force: !!a.force, deleteBranch: a.deleteBranch === "force" || a.deleteBranch === "merged" ? a.deleteBranch : false }),
    /** Report whether the parent checkout has uncommitted/untracked changes (not copied into tasks). */
    async dirtyCheck(ctx, a) {
      const proj = await ctx.modules.call("projects", "get", { projectId: a.projectId });
      const r = await git(ctx, proj.desc, ["-C", proj.desc.rootAbsolutePath, "status", "--porcelain"]);
      must(r, "git status");
      const lines = r.stdout.split("\n").filter(Boolean);
      return { dirty: lines.length > 0, count: lines.length, sample: lines.slice(0, 10) };
    },
    async create(ctx, a) {
      const name = String(a.name || a.branch || "").trim();
      if (!name || name.length > 100) throw new Error("task name is required (max 100 chars)");
      const proj = await ctx.modules.call("projects", "get", { projectId: a.projectId });
      const desc = proj.desc;
      const root = desc.rootAbsolutePath;
      const top = await git(ctx, desc, ["-C", root, "rev-parse", "--show-toplevel"]);
      if (top.code !== 0) throw new Error("project root is not a Git working tree");
      if (top.stdout.trim() !== root) throw new Error(`project root must be the repository top level (${top.stdout.trim()})`);
      const head = await git(ctx, desc, ["-C", root, "rev-parse", "--verify", "-q", "HEAD"]);
      if (head.code !== 0) throw new Error("repository has no commits yet; commit once before creating tasks");
      const taskId = crypto.randomUUID();
      const requested = String(a.branch || "").trim();
      const remoteRef = requested.startsWith("refs/remotes/") ? requested : null;
      if (remoteRef && !/^refs\/remotes\/[^/]+\/.+/.test(remoteRef)) throw new Error("Invalid remote branch");
      const custom = remoteRef ? remoteRef.replace(/^refs\/remotes\/[^/]+\//, "") : requested.replace(/^refs\/heads\//, "");
      if (remoteRef) must(await git(ctx, desc, ["show-ref", "--verify", remoteRef]), "Resolve remote branch");
      if (custom.startsWith("-") || custom.length > 200) throw new Error("invalid branch name");
      const branch = custom || `task/${slugify(name)}-${shortId(taskId)}`;
      must(await git(ctx, desc, ["check-ref-format", "--branch", branch]), "git check-ref-format");
      const local = (await git(ctx, desc, ["-C", root, "show-ref", "--verify", "-q", `refs/heads/${branch}`])).code === 0;
      const remotes = remoteRef ? [remoteRef] : local ? [] : must(await git(ctx, desc, ["-C", root, "for-each-ref", "--format=%(refname)", `refs/remotes/*/${branch}`]), "git for-each-ref").split("\n").filter(Boolean);
      if (remotes.length > 1) throw new Error(`branch ${branch} exists on several remotes (${remotes.map((r) => r.replace(/^refs\/remotes\//, "")).join(", ")}); create a local branch first`);
      const base = desc.location === "local" ? `${ctx.host.env.info().sharedDir}/worktrees` : `${await remoteStateDir(ctx, desc)}/worktrees`;
      const wtPath = `${base}/${proj.id}/${taskId}`;
      if (wtPath.startsWith(root + "/")) throw new Error("refusing to place worktree inside the checkout");
      const dirty = await mod.methods.dirtyCheck(ctx, { projectId: proj.id }, { caller: "git-tasks" });
      const addArgs = local && !remoteRef ? [wtPath, branch] : remotes.length ? ["--track", "-b", branch, wtPath, remotes[0]] : ["-b", branch, wtPath, "HEAD"];
      must(await git(ctx, desc, ["-C", root, "worktree", "add", ...addArgs], 18e4), "git worktree add");
      const list = must(await git(ctx, desc, ["-C", root, "worktree", "list", "--porcelain"]), "git worktree list");
      const wt = parsePorcelain(list).find((w) => w.branch === branch);
      if (!wt) throw new Error(`worktree for ${branch} not found in 'git worktree list' after creation`);
      try {
        await ctx.modules.call("persistence", "settings.set", { key: `git.taskBase.task:${taskId}`, value: wt.head });
        await ctx.modules.call("persistence", "tasks.insert", { task: { id: taskId, projectId: proj.id, name, branch, worktreePath: wt.worktree, status: "ready" } });
      } catch (e) {
        throw new Error(`worktree created at ${wt.worktree} on ${desc.machineId} but saving the task failed: ${errMsg(e)}. Use Reconcile; nothing was deleted.`);
      }
      ctx.events.emit("git-tasks.changed", { projectId: proj.id, taskId });
      if (a.select !== false) await ctx.modules.call("workspace", "select", { workspaceId: `task:${taskId}` });
      const startedFrom = local ? `existing branch ${branch}` : remotes.length ? remotes[0].replace(/^refs\/remotes\//, "") : "HEAD";
      return {
        id: taskId,
        branch,
        worktreePath: wt.worktree,
        machineId: desc.machineId,
        startedFrom,
        warning: dirty.dirty && !local && !remotes.length ? `Parent checkout has ${dirty.count} uncommitted/untracked change(s); worktrees start from HEAD and do not include them.` : null
      };
    }
  }
};
var index_default = mod;
export {
  index_default as default
};
