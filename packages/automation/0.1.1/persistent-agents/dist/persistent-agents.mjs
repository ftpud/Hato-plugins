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
      const target2 = await targetFor(ctx, desc);
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

// ../sdk/persistent-agents.ts
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

// modules/services/persistent-agents/src/index.ts
var activityCache = /* @__PURE__ */ new Map();
var daemonInfo = /* @__PURE__ */ new Map();
var prepared = /* @__PURE__ */ new Map();
async function target(ctx, workspaceId) {
  const d = await ctx.modules.call("workspace", "resolve", { workspaceId });
  let pending = prepared.get(d.machineId);
  if (!pending) {
    pending = (async () => {
      const t = d.location === "ssh" ? { kind: "ssh", connection: (await sshConnect(ctx, d)).connection } : { kind: "local" };
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
  const profiles = (await ctx.modules.call("persistence", "acpProfiles.list")).filter((p) => p.enabled && (p.machineId === "*" || p.machineId === d.machineId));
  const skills = await workspaceSkills(ctx, d);
  const grant = await workspaceGrant(ctx, d, "fs");
  const agentFiles = [];
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
  return { workspace: d, profiles, skills, agentFiles, mcps: [
    { id: "internal-remote-mcp", name: "Workspace tools (background agents and terminals)" },
    ...d.location === "local" ? [{ id: "internal-remote-mcp-local", name: "Workspace tools · local desktop terminals (online only)" }] : [],
    { id: "internal-local-mcp", name: "Desktop tools (requires desktop online)" },
    ...(await mcps(ctx)).filter((m) => m.enabled !== false)
  ] };
}
var agentMcpIds = (s) => [...s.workspaceMcp ? ["internal-remote-mcp"] : [], ...s.mcps.map((m) => m.id)];
async function agentConfig(ctx, c, a, sessionId) {
  const profile = c.profiles.find((p) => p.id === a.profileId);
  if (!profile) throw new Error("Select an enabled provider for this machine");
  const skills = (Array.isArray(a.skills) ? a.skills : []).map(relativeAgentPath);
  if (skills.some((p) => !c.skills.some((s) => s.path === p))) throw new Error("Selected skill is no longer available");
  const agentFile = a.agentFile ? relativeAgentPath(a.agentFile) : null;
  if (agentFile && !c.agentFiles.some((f) => f.path === agentFile)) throw new Error("Selected agent file is no longer available");
  const ids = Array.isArray(a.mcps) ? a.mcps : [];
  if (ids.some((id) => !c.mcps.some((m) => m.id === id))) throw new Error("Unknown MCP server");
  await target(ctx, c.workspace.id);
  const chosen = (await mcps(ctx)).filter((m) => m.enabled !== false && ids.includes(m.id));
  const auth = await oauthHeaders(ctx, chosen);
  const servers = chosen.map((m) => ({ id: m.id, ...acpServer(m, auth[m.id]) }));
  if (ids.includes("internal-remote-mcp-local")) {
    const endpoint = await ctx.modules.call("internal-remote-mcp", "endpoint", { workspaceId: c.workspace.id, sessionId, skills });
    servers.push({ ...endpoint, id: "internal-remote-mcp-local", name: "internal-remote-mcp-local" });
  }
  if (ids.includes("internal-local-mcp")) {
    const endpoint = await ctx.modules.call("internal-local-mcp", "endpoint", { conversationId: sessionId, workspaceId: c.workspace.id });
    servers.push({ id: "internal-local-mcp", ...endpoint.server });
  }
  return { profile, model: String(a.model || ""), agentFile, skills, mcps: servers, workspaceMcp: ids.includes("internal-remote-mcp") };
}
var clip = (v, n) => typeof v === "string" ? v.trim().slice(0, n) : "";
function agentRequest(a) {
  if (a == null) return null;
  const prompt = clip(a.prompt, 128 * 1024);
  if (!prompt) throw new Error("A background agent needs a prompt");
  return { name: clip(a.name, 120) || "Task agent", prompt, model: clip(a.model, 200) };
}
async function approve(ctx, session, title, detail, allowLabel, operation) {
  if (session.autopilot) return;
  const decision = await ctx.host.approvals.request({
    title: `${session.name}: ${title}`,
    detail,
    operation,
    timeoutMs: 9 * 60 * 1e3,
    options: [{ id: "allow", label: allowLabel, kind: "allow" }, { id: "deny", label: "Deny", kind: "deny" }]
  });
  if (decision.optionId !== "allow") throw new Error(decision.expired ? "The request was not approved in time" : `The user denied: ${title}`);
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
var WORKING = /* @__PURE__ */ new Set(["starting", "busy", "waiting"]);
async function pollDaemons(ctx) {
  if (polling) return;
  polling = true;
  try {
    const busy = {};
    for (const [machineId, pending] of [...prepared]) {
      let t;
      try {
        t = await pending;
      } catch {
        continue;
      }
      try {
        const sessions = await ctx.host.daemon.request(t, "modules.call", { target: "agent-runner", method: "list", args: {}, timeoutMs: 1e4 });
        for (const s of sessions || []) if (s.machineId === machineId && WORKING.has(s.status)) busy[s.workspaceId] = (busy[s.workspaceId] || 0) + 1;
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
  } finally {
    polling = false;
  }
}
var mod = {
  id: "persistent-agents",
  moduleApiVersion: 1,
  deactivate() {
    if (daemonPoll) clearInterval(daemonPoll);
    daemonPoll = null;
  },
  activate(ctx) {
    setTimeout(async () => {
      try {
        if (!await ctx.host.daemon.status({ kind: "local" })) return;
        const local = (await ctx.modules.call("persistence", "projects.list")).find((p) => p.kind === "local");
        if (local) await target(ctx, `project:${local.id}:root`);
      } catch (e) {
        ctx.log?.warn("local daemon warm-up", e instanceof Error ? e.message : String(e));
      }
    }, 1500);
    const allowed = /* @__PURE__ */ new Set(["view", "send", "cancel", "stop", "reconnect", "setModel", "setAutopilot", "reviewPermission", "clear"]);
    ctx.events.on("mcp-panel.request", async (request) => {
      if (typeof request?.requestId !== "string" || !["listMcps", "saveMcp", "removeMcp", "probeMcp", "signInMcp", "signOutMcp", "cancelSignInMcp"].includes(request.method)) return;
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
    catalog: (ctx, a) => catalog(ctx, String(a.workspaceId)),
    async listMcps(ctx) {
      const list = await mcps(ctx);
      const remote = list.filter((m) => transportOf(m) !== "stdio" && m.auth?.type === "oauth").map((m) => ({ id: m.id, url: m.url }));
      const status = remote.length ? await ctx.modules.call("mcp-auth", "status", { servers: remote }).catch(() => ({})) : {};
      return [...builtInMcps, ...list.map((m) => status[m.id] ? { ...m, authStatus: status[m.id] } : m)];
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
    async create(ctx, a) {
      const c = await catalog(ctx, String(a.workspaceId));
      const id = crypto.randomUUID();
      const config = await agentConfig(ctx, c, a, id);
      const subscription = await ctx.modules.call("persistence", "settings.get", { key: "acp.claude.useSubscription" });
      const spec = {
        id,
        name: String(a.name || "Agent").trim().slice(0, 120),
        workspaceId: c.workspace.id,
        workspaceName: c.workspace.name,
        root: c.workspace.rootAbsolutePath,
        machineId: c.workspace.machineId,
        ...config,
        claudeSubscription: subscription !== false,
        daemon: daemonInfo.get(c.workspace.machineId)
      };
      return invoke(ctx, c.workspace.id, "create", { spec });
    },
    /** Edit name, provider, instructions, skills and MCP servers. Only a rename leaves a connected agent running. */
    async update(ctx, a) {
      const v = await owned(ctx, a), s = v.session;
      const name = String(a.name || "").trim().slice(0, 120);
      if (!name) throw new Error("Agent name is required");
      const ids = [...new Set(Array.isArray(a.mcps) ? a.mcps : [])].sort();
      const skills = [...Array.isArray(a.skills) ? a.skills : []].map(relativeAgentPath).sort();
      const agentFile = a.agentFile ? relativeAgentPath(a.agentFile) : null;
      const same = s.profile.id === a.profileId && (s.agentFile || null) === agentFile && JSON.stringify([...s.skills].sort()) === JSON.stringify(skills) && JSON.stringify(agentMcpIds(s).sort()) === JSON.stringify(ids);
      if (same) return invoke(ctx, a.workspaceId, "update", { id: s.id, patch: { name } });
      const c = await catalog(ctx, String(a.workspaceId));
      await ctx.modules.call("internal-local-mcp", "revoke", { conversationId: s.id }).catch(() => {
      });
      await ctx.modules.call("internal-remote-mcp", "revoke", { sessionId: s.id }).catch(() => {
      });
      const config = await agentConfig(ctx, c, { ...a, mcps: ids, skills, agentFile, model: s.profile.id === a.profileId ? s.model : "" }, s.id);
      return invoke(ctx, a.workspaceId, "update", { id: s.id, patch: { name, ...config } });
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
    async mcpConfigs(ctx, a) {
      await ctx.modules.call("workspace", "resolve", { workspaceId: String(a.workspaceId) });
      if (!Array.isArray(a.ids) || !a.ids.every((id) => typeof id === "string")) throw new Error("MCP server ids are required");
      const ids = new Set(a.ids), list = (await mcps(ctx)).filter((m) => m.enabled !== false && ids.has(m.id));
      if (list.length !== ids.size) throw new Error("A connected MCP server is missing or disabled");
      const auth = await oauthHeaders(ctx, list);
      return list.map((m) => ({ id: m.id, ...acpServer(m, auth[m.id]) }));
    },
    async view(ctx, a) {
      const v = await invoke(ctx, String(a.workspaceId), "view", { id: a.id, before: a.before, limit: a.limit });
      if (v.session.workspaceId !== a.workspaceId) throw new Error("Agent belongs to another workspace");
      return v;
    },
    async send(ctx, a) {
      await owned(ctx, a);
      return invoke(ctx, a.workspaceId, "send", { id: a.id, text: a.text, steer: !!a.steer });
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
      return invoke(ctx, a.workspaceId, "reconnect", { id: a.id, authorization });
    },
    async setModel(ctx, a) {
      await owned(ctx, a);
      return invoke(ctx, a.workspaceId, "setModel", { id: a.id, model: a.model });
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
async function owned(ctx, a) {
  const v = await invoke(ctx, String(a.workspaceId), "view", { id: a.id, limit: 1 });
  if (v.session.workspaceId !== a.workspaceId) throw new Error("Agent belongs to another workspace");
  return v;
}
var index_default = mod;
export {
  index_default as default
};
