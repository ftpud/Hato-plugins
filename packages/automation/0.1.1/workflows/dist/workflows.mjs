// ../sdk/runtime.ts
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

// ../sdk/workflows.ts
var WORKFLOW_RUNNER_VERSION = "8";
var WORKFLOW_BLOCKS = [
  { type: "start_button", label: "Start button", summary: "Starts the run with its prompt as the input.", fields: ["prompt"], tool: false },
  { type: "start_input", label: "Start with text", summary: "Starts the run with text typed when it is run.", fields: [], tool: false },
  { type: "ai", label: "AI Agent", summary: "A background agent session that runs its prompt template and returns its final answer.", fields: ["prompt", "profileId", "model", "reasoning", "autopilot", "agentFile"], tool: true },
  { type: "chatbox", label: "Chatbox", summary: "A persistent conversation; every outgoing connection is a tool it can call.", fields: ["prompt", "profileId", "model", "reasoning", "autopilot", "agentFile"], tool: true },
  { type: "skill", label: "SKILL", summary: "Reusable instructions, custom or loaded from a workspace SKILL.md.", fields: ["description", "prompt", "skillId"], tool: true },
  { type: "text", label: "Text input", summary: "Fixed text (supports templates) passed on or returned to the caller.", fields: ["prompt"], tool: true },
  { type: "markdown", label: "Markdown document", summary: "Renders its template, or its input, as a Markdown document.", fields: ["prompt"], tool: true },
  { type: "script", label: "Script execution", summary: "Runs a shell command in the workspace; stdin and $HATO_WORKFLOW_INPUT receive the input.", fields: ["command", "timeoutSeconds"], tool: true },
  { type: "run_app", label: "Run App", summary: "Starts, checks, kills or tails a named long-lived app.", fields: ["command", "app"], tool: true },
  { type: "timer", label: "Timer", summary: "Waits, then passes its input to follow connections. Used as a tool it arms and returns at once.", fields: ["seconds"], tool: true },
  { type: "user_prompt", label: "User Prompt", summary: "Asks the user a question and returns the typed answer.", fields: ["prompt"], tool: true },
  { type: "yes_no_prompt", label: "Yes/No Prompt", summary: 'Asks the user and returns "yes" or "no" (also selects a yes/no path).', fields: ["prompt"], tool: true },
  { type: "meeting", label: "Meeting", summary: "A shared, attributed discussion between connected agents.", fields: ["description"], tool: true },
  { type: "terminal_control", label: "Terminal Control", summary: "Gives connected agents the workspace terminal tools (list, read, write).", fields: [], tool: true },
  { type: "task_controls", label: "Task controls", summary: "Gives connected agents the Git task tools (list, create, start agent).", fields: [], tool: true },
  { type: "mcp", label: "MCP server", summary: "Attaches a configured MCP server to connected agents.", fields: ["mcp"], tool: true }
];
var blockInfo = (type) => WORKFLOW_BLOCKS.find((b) => b.type === type);
var AGENT_TYPES = /* @__PURE__ */ new Set(["ai", "chatbox"]);
var isAgentBlock = (b) => AGENT_TYPES.has(b.type);
var isCapabilityBlock = (b) => b.type === "terminal_control" || b.type === "task_controls" || b.type === "mcp";
var isStartBlock = (b) => b.type === "start_button" || b.type === "start_input";
var edgeType = (e) => e.type || "follow";
var ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
var now = () => (/* @__PURE__ */ new Date()).toISOString();
var clip = (v, n) => typeof v === "string" ? v.slice(0, n) : "";
var num = (v) => typeof v === "number" && Number.isFinite(v) ? v : void 0;
function normalizeDefinition(raw, fallback) {
  if (!raw || typeof raw !== "object") throw new Error("A workflow definition must be a JSON object");
  if (raw.blocks !== void 0 && !Array.isArray(raw.blocks)) throw new Error("blocks must be an array");
  if (raw.edges !== void 0 && !Array.isArray(raw.edges)) throw new Error("edges must be an array");
  if ((raw.blocks?.length || 0) > 300 || (raw.edges?.length || 0) > 1e3) throw new Error("A workflow is limited to 300 blocks and 1000 connections");
  const blocks = (raw.blocks || []).map((b, i) => {
    const block = {
      id: clip(b?.id, 80) || `block-${i + 1}`,
      type: String(b?.type || ""),
      label: clip(b?.label, 200),
      prompt: clip(b?.prompt, 2e5),
      position: { x: Math.round(num(b?.position?.x) ?? 40 + i % 5 * 260), y: Math.round(num(b?.position?.y) ?? 40 + Math.floor(i / 5) * 170) }
    };
    if (typeof b?.description === "string") block.description = clip(b.description, 4e3);
    if (typeof b?.command === "string") block.command = clip(b.command, 64e3);
    if (num(b?.timeoutSeconds) !== void 0) block.timeoutSeconds = num(b.timeoutSeconds);
    if (num(b?.seconds) !== void 0) block.seconds = num(b.seconds);
    if (b?.app && typeof b.app === "object") block.app = {
      name: clip(b.app.name, 80),
      ...Array.isArray(b.app.actions) ? { actions: b.app.actions.filter((a) => ["start", "status", "kill", "tail"].includes(a)) } : {},
      ...["start", "status", "kill", "tail"].includes(b.app.action) ? { action: b.app.action } : {},
      ...num(b.app.lines) ? { lines: num(b.app.lines) } : {}
    };
    for (const k of ["profileId", "provider", "model", "reasoning", "agentFile", "skillId"]) if (typeof b?.[k] === "string" && b[k]) block[k] = clip(b[k], 400);
    if (!block.agentFile && b?.agent && b.agent.scope === "workspace" && typeof b.agent.name === "string") block.agentFile = `.agents/agents/${clip(b.agent.name, 180)}`;
    if (typeof b?.autopilot === "boolean") block.autopilot = b.autopilot;
    if (b?.mcp && typeof b.mcp.serverId === "string") block.mcp = { serverId: clip(b.mcp.serverId, 120) };
    if (b?.join === "any" || b?.join === "all") block.join = b.join;
    if (b?.inputSchema && typeof b.inputSchema === "object") block.inputSchema = b.inputSchema;
    if (b?.outputSchema && typeof b.outputSchema === "object") block.outputSchema = b.outputSchema;
    return block;
  });
  const edges = (raw.edges || []).map((e, i) => {
    const edge = { id: clip(e?.id, 120) || `edge-${i + 1}`, from: clip(e?.from, 80), to: clip(e?.to, 80) };
    if (["follow", "use", "path"].includes(e?.type)) edge.type = e.type;
    if (typeof e?.label === "string" && e.label) edge.label = clip(e.label, 80);
    if (e?.loop === true) edge.loop = true;
    if (num(e?.timeoutMs)) edge.timeoutMs = num(e.timeoutMs);
    return edge;
  });
  const settings = {};
  for (const k of ["maxLoopCount", "maxSteps", "outputLimitChars", "promptLimitChars", "maxRunDurationMs"]) if (num(raw.settings?.[k]) !== void 0) settings[k] = num(raw.settings[k]);
  return {
    id: clip(raw.id, 80) || fallback?.id || crypto.randomUUID(),
    name: clip(raw.name, 200).trim() || fallback?.name || "Untitled workflow",
    ...typeof raw.description === "string" ? { description: clip(raw.description, 4e3) } : {},
    version: num(raw.version) ?? fallback?.version ?? 1,
    createdAt: clip(raw.createdAt, 40) || fallback?.createdAt || now(),
    updatedAt: now(),
    ...Object.keys(settings).length ? { settings } : {},
    blocks,
    edges
  };
}
var reaches = (edges, from, to) => {
  const seen = /* @__PURE__ */ new Set(), stack = [from];
  while (stack.length) {
    const c = stack.pop();
    if (c === to) return true;
    if (seen.has(c)) continue;
    seen.add(c);
    for (const e of edges) if (e.from === c && edgeType(e) !== "use") stack.push(e.to);
  }
  return false;
};
function validateWorkflow(def, available2) {
  const issues = [];
  const err = (code, message, extra = {}) => issues.push({ code, message, severity: "error", ...extra });
  const warn = (code, message, extra = {}) => issues.push({ code, message, severity: "warning", ...extra });
  if (!def.blocks.length) err("empty", "Add at least one block before running this workflow");
  const ids = /* @__PURE__ */ new Set();
  for (const b of def.blocks) {
    const name = b.label || b.id;
    if (!ID.test(b.id)) err("invalid-id", `Block ID '${b.id}' must start with a letter or digit and use letters, digits, _ or -`, { blockId: b.id });
    if (ids.has(b.id)) err("duplicate-id", `Block ID '${b.id}' is duplicated`, { blockId: b.id });
    ids.add(b.id);
    const info = blockInfo(b.type);
    if (!info) {
      err("unsupported-type", `Block '${name}' has unsupported type '${b.type}'`, { blockId: b.id });
      continue;
    }
    if (!b.label.trim()) err("empty-label", "Every block needs a name", { blockId: b.id });
    if (["ai", "start_button", "user_prompt", "yes_no_prompt"].includes(b.type) && !b.prompt.trim()) err("empty-prompt", `Block '${name}' needs a prompt`, { blockId: b.id });
    if (b.type === "skill" && !b.skillId && !b.prompt.trim()) err("empty-prompt", `Skill '${name}' needs instructions or an existing skill`, { blockId: b.id });
    if (b.type === "skill" && !b.description?.trim()) warn("skill-description", `Skill '${name}' should describe when to use it`, { blockId: b.id });
    if (b.type === "skill" && b.skillId && (b.skillId.startsWith("/") || b.skillId.split("/").includes("..") || !b.skillId.endsWith(".md")))
      err("invalid-skill", `Skill '${name}' must reference a workspace-relative SKILL.md file`, { blockId: b.id });
    if ((b.type === "script" || b.type === "run_app") && !b.command?.trim()) err("empty-command", `Block '${name}' needs a shell command`, { blockId: b.id });
    if (b.type === "script" && b.timeoutSeconds !== void 0 && !(b.timeoutSeconds >= 1 && b.timeoutSeconds <= 86400)) err("invalid-timeout", `Script '${name}' timeout must be 1–86400 seconds`, { blockId: b.id });
    if (b.type === "run_app" && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(b.app?.name || "")) err("invalid-app", `Run App '${name}' needs an app name (letters, digits, . _ -)`, { blockId: b.id });
    if (b.type === "timer" && !(Number.isInteger(b.seconds) && b.seconds >= 0 && b.seconds <= 7 * 86400)) err("invalid-timer", `Timer '${name}' needs whole seconds from 0 to 604800`, { blockId: b.id });
    if (b.type === "mcp" && !b.mcp?.serverId) err("invalid-mcp", `MCP block '${name}' needs a configured server`, { blockId: b.id });
    if (b.type === "mcp" && b.mcp?.serverId && available2?.mcps && !available2.mcps.some((m) => m.id === b.mcp.serverId)) warn("unavailable-mcp", `MCP server for '${name}' is not configured or enabled`, { blockId: b.id });
    if (isAgentBlock(b) && available2?.profiles) {
      const ok = b.profileId ? available2.profiles.some((p) => p.id === b.profileId) : b.provider ? available2.profiles.some((p) => p.provider === b.provider) : available2.profiles.length > 0;
      if (!ok) err("unavailable-provider", `No enabled AI provider matches '${name}' on this machine`, { blockId: b.id });
    }
    if (isAgentBlock(b) && b.agentFile && (b.agentFile.startsWith("/") || b.agentFile.split("/").includes(".."))) err("invalid-agent", `Agent file of '${name}' must be workspace-relative`, { blockId: b.id });
  }
  const edgeIds = /* @__PURE__ */ new Set(), pairs = /* @__PURE__ */ new Set();
  for (const e of def.edges) {
    if (edgeIds.has(e.id)) err("duplicate-edge-id", `Connection ID '${e.id}' is duplicated`, { edgeId: e.id });
    edgeIds.add(e.id);
    const from = def.blocks.find((b) => b.id === e.from), to = def.blocks.find((b) => b.id === e.to);
    if (!from || !to) {
      err("missing-endpoint", `Connection '${e.id}' references a missing block`, { edgeId: e.id });
      continue;
    }
    if (e.from === e.to) err("self-edge", `Block '${from.label}' cannot connect to itself`, { edgeId: e.id });
    const pair = `${e.from}>${e.to}>${edgeType(e)}>${e.label || ""}`;
    if (pairs.has(pair)) err("duplicate-edge", `Duplicate connection from '${from.label}' to '${to.label}'`, { edgeId: e.id });
    pairs.add(pair);
    const t = edgeType(e);
    if (t === "use" && !isAgentBlock(from)) err("invalid-use", `Only AI Agent and Chatbox blocks can use '${to.label}' as a tool`, { edgeId: e.id });
    if (t === "use" && isStartBlock(to)) err("invalid-use", "Start blocks cannot be used as tools", { edgeId: e.id });
    if (t === "path" && from.type !== "ai" && from.type !== "yes_no_prompt") err("route-label", `Paths start at an AI Agent or Yes/No Prompt ('${from.label}')`, { edgeId: e.id });
    if (t === "path" && !e.label?.trim()) err("route-label", `Path from '${from.label}' needs a route name`, { edgeId: e.id });
    if (t === "path" && from.type === "yes_no_prompt" && e.label && !["yes", "no"].includes(e.label)) err("route-label", "Yes/No paths are named yes or no", { edgeId: e.id });
    if (t !== "use" && from.type !== "chatbox" && isCapabilityBlock(to)) err("invalid-capability", `'${to.label}' adds tools to agents; connect it with a Use connection`, { edgeId: e.id });
    if (t !== "use" && isStartBlock(to)) err("invalid-follow", "Start blocks cannot have incoming connections", { edgeId: e.id });
    if (t !== "use" && from.type === "chatbox") warn("chatbox-follow", `Chatbox '${from.label}' exposes every outgoing connection as a tool; follow connections do not run automatically`, { edgeId: e.id });
    if (t !== "use" && !e.loop && reaches(def.edges.filter((x) => x.id !== e.id), e.to, e.from) && !["timer", "user_prompt", "yes_no_prompt"].includes(from.type) && !isAgentBlock(to))
      warn("cycle", `Connection '${from.label}' → '${to.label}' closes a cycle; mark it as a loop if intended`, { edgeId: e.id });
  }
  return issues;
}
var WORKFLOW_REFERENCE = String.raw`# Hato workflows: blocks and connections

Workflows are JSON graphs of blocks joined by connections. They run on the workspace
machine's daemon (hatod), so a run continues when the desktop disconnects. Saving a
workflow never starts it; the user runs it from the Workflows panel.

## Definition

~~~json
{"id":"review","name":"Review changes","blocks":[
  {"id":"start","type":"start_button","label":"Start","prompt":"Review the current changes","position":{"x":40,"y":80}},
  {"id":"status","type":"script","label":"Git status","prompt":"","command":"git status --short","position":{"x":300,"y":260}},
  {"id":"reviewer","type":"ai","label":"Reviewer","prompt":"{{input}}\nUse the status block, then report findings.","position":{"x":300,"y":80}}],
 "edges":[{"id":"e1","from":"start","to":"reviewer","type":"follow"},
  {"id":"e2","from":"reviewer","to":"status","type":"use"}]}
~~~

Keep block and connection IDs stable when editing (letters, digits, _ and -). Positions are
designer coordinates in pixels; place new blocks about 260 px apart horizontally.

## Connections

- follow (default): when the source finishes, the target runs with the source's output as input.
  Several follows from one block run in parallel. Converging follows join: the target waits for
  all active branches (join "all", default) or runs on the first one (join "any").
- use: the target becomes a tool of the source AI Agent or Chatbox, called with workflow_use_block.
- path: a named route (label). An AI Agent with paths must call workflow_choose_path before it
  finishes; only matching path connections run. Yes/No Prompts select the "yes" or "no" path.
- loop: true marks a follow/path that intentionally returns to an earlier block (bounded by
  settings.maxLoopCount, default 100).

## Templates

Prompts may contain {{input}} (the block's input) and {{blocks.ID.output}} (another block's latest
output, previewed to 8,000 characters). AI prompts without {{input}} get the input appended.

## Blocks

| type | fields | behavior |
| --- | --- | --- |
| start_button | prompt | Starts a run; its prompt becomes the input. |
| start_input | — | Starts a run with text typed by the user. |
| ai | prompt, profileId or provider, model, reasoning, autopilot, agentFile | Background agent session. Returns its final answer. Keeps its context for later invocations in the run. |
| chatbox | prompt (session guidance), profileId, model, reasoning, autopilot | Persistent conversation the user chats with. All outgoing connections are its tools. |
| skill | description, prompt or skillId (workspace SKILL.md path) | Instructions loaded on demand by connected agents. |
| text | prompt | Returns its rendered text. |
| markdown | prompt (optional) | Renders its template or its input as a Markdown document. |
| script | command, timeoutSeconds (default 1800) | sh -lc in the workspace root. stdin and $HATO_WORKFLOW_INPUT receive the input. Non-zero exit fails. |
| run_app | command, app {name, actions} | Named long-lived app: start, status, kill, tail. Survives between runs until killed. |
| timer | seconds | Waits, then follows run with its input. As a tool it arms and returns at once; reusing it re-arms. |
| user_prompt | prompt | Asks the user; returns the typed answer. |
| yes_no_prompt | prompt | Asks the user; returns "yes" or "no". |
| meeting | description | Shared transcript: publish, tail, diff, wait, status, shake. Participant work/idle/permission/error status changes are posted automatically and wake room waiters. |
| terminal_control | — | Connected agents call workflow_use_block with action list/read/write; read/write take key, read accepts cursor, write takes text. Requests/results are logged on the block. |
| task_controls | — | Use it to give an agent Git task tools (tasks_list/create/start_agent; desktop open). |
| mcp | mcp {serverId} | Use it to attach a configured MCP server to an agent. |

AI providers: profileId is an ACP profile id from the catalog (workflows__catalog). A block may
instead name a provider (claude, codex, gemini, …); the first enabled matching profile is used.

## Agent tools inside a run

- workflow_connections: list connected tools.
- workflow_use_block {block_id, input?, action?, lines?, timeout_seconds?}: run or control a connected block.
  AI/Chatbox actions: (omitted) run and wait, start, status, tail, steer. Run App: start, status,
  kill, tail. Meeting: publish {message}, tail, diff (default), wait, status, shake {peer_block_id, message} (a specific nonempty message is required).
  Any data block: fetch returns output not yet fetched by this caller.
- workflow_block_output {block_id, offset?, limit?}: page through retained output.
- workflow_block_messages {block_id, count?}: recent messages of a connected agent.
- workflow_choose_path {path}: choose a route before finishing.

## Self-configuration

Use workflows__list, workflows__read, workflows__write and workflows__validate (desktop MCP) or the
configurator's workflows_* tools. Read before writing and pass the returned revision as
expected_revision (null to create). Check returned validation issues. Never start runs unasked.
`;

// ../sdk/persistent-agents.ts
function modelChoices(state) {
  const option = state.configOptions?.find((o) => o.category === "model");
  if (option) {
    const flatten = (options) => options.flatMap((o) => Array.isArray(o.options) ? flatten(o.options) : [o]);
    return flatten(option.options || []).map((o) => ({ id: String(o.value), label: o.name || String(o.value), configId: option.id }));
  }
  return (state.models?.availableModels || []).map((m) => ({ id: m.modelId, label: m.name || m.modelId, configId: "__model" }));
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

// ../sdk/workflow-provider-options.ts
function advertisedChoices(session) {
  const thought = session.configOptions?.find((o) => o.category === "thought_level" && o.type !== "boolean");
  const flatten = (items) => items.flatMap((o) => Array.isArray(o.options) ? flatten(o.options) : [o]);
  return {
    models: modelChoices(session).map((m) => ({ value: m.id, label: m.label })),
    reasoning: thought ? flatten(thought.options || []).filter((o) => typeof o.value === "string").map((o) => ({ value: o.value, label: o.name || o.value })) : [],
    reasoningId: thought?.id
  };
}
var providerChoiceKey = (workspaceId, profileId, model = "") => JSON.stringify([workspaceId, profileId, model]);

// ../sdk/workflow-templates.ts
function multiAgentSetup() {
  const agents = [
    { id: "researcher", label: "Researcher", role: "Investigate the goal, relevant code and constraints. Return concrete findings and recommended steps. Inspect without editing files." },
    { id: "implementer", label: "Implementer", role: "Implement the assigned part of the goal, following workspace instructions. Coordinate ownership before editing. Validate changes and report what changed and any remaining issues." },
    { id: "reviewer", label: "Reviewer", role: "Review the supplied plan or implementation against the user's goal. Inspect without editing files. Report bugs, missing coverage and concrete recommendations; distinguish verified facts from assumptions." }
  ];
  return {
    blocks: [
      { id: "start", type: "start_input", label: "Start with a prompt", prompt: "", position: { x: 32, y: 220 } },
      {
        id: "coordinator",
        type: "ai",
        label: "Coordinator",
        position: { x: 310, y: 220 },
        prompt: `Coordinate this goal: {{input}}
You have three connected agents (researcher, implementer, reviewer) and a shared Meeting block (meeting).
1. Publish the goal and a short plan to meeting with workflow_use_block, action publish.
2. Delegate concrete tasks through workflow_use_block to researcher, then implementer when changes are requested, and reviewer. Include the original goal and relevant findings in each task. Researcher and reviewer inspect without editing; implementer owns edits. For a question-only goal, ask implementer for a proposed solution without editing.
3. Read meeting messages with action diff as you work. Every agent can see participant activity notices there. To wake a specific participant, use action shake with that participant's block ID in peer_block_id and a specific message. Use the connected agents' returned results to track completion; do not wait indefinitely for optional messages.
4. Resolve review findings with the implementer as needed. Publish the final outcome to meeting, then return a concise report of results, validation and remaining issues. Do not claim unperformed checks.`
      },
      ...agents.map((agent, index) => ({
        id: agent.id,
        type: "ai",
        label: agent.label,
        prompt: `${agent.role}
Task: {{input}}
Use the connected meeting block through workflow_use_block to read the team's messages (action diff), publish relevant findings (action publish, message), and coordinate handoffs. Status notices are announced automatically. If waking a teammate with action shake, supply peer_block_id and a specific message. Publish your result to the room and return it to the coordinator. Finish your invocation when your assigned work is complete.`,
        position: { x: 620, y: 40 + index * 180 }
      })),
      { id: "meeting", type: "meeting", label: "Team meeting", prompt: "", position: { x: 940, y: 220 } },
      { id: "report", type: "markdown", label: "Team report", prompt: "{{input}}", position: { x: 310, y: 580 } }
    ],
    edges: [
      { id: "start-team", from: "start", to: "coordinator", type: "follow" },
      ...agents.map((agent) => ({ id: `delegate-${agent.id}`, from: "coordinator", to: agent.id, type: "use" })),
      ...["coordinator", ...agents.map((agent) => agent.id)].map((id) => ({ id: `meeting-${id}`, from: id, to: "meeting", type: "use" })),
      { id: "team-report", from: "coordinator", to: "report", type: "follow" }
    ]
  };
}
var WORKFLOW_TEMPLATES = [
  { id: "blank", name: "Blank workflow", description: "Start from an empty canvas.", graph: () => ({ blocks: [], edges: [] }) },
  { id: "multi-agent-setup", name: "Multi-agent setup", description: "Start with a prompt, coordinate three specialist agents in a shared meeting, and produce a report.", graph: multiAgentSetup }
];

// modules/services/workflows/src/index.ts
var prepared = /* @__PURE__ */ new Map();
async function resolve(ctx, workspaceId) {
  if (typeof workspaceId !== "string" || !workspaceId) throw new Error("Select a workspace first");
  return ctx.modules.call("workspace", "resolve", { workspaceId });
}
async function daemon(ctx, d) {
  let pending = prepared.get(d.machineId);
  if (!pending) {
    pending = (async () => {
      const target = d.location === "ssh" ? { kind: "ssh", connection: (await sshConnect(ctx, d)).connection } : { kind: "local" };
      const info = await ctx.host.daemon.ensure(target);
      const plugins = (await ctx.host.daemon.request(target, "plugins.list")).plugins;
      for (const id of ["internal-remote-mcp", "agent-runner"]) {
        if (plugins.find((p) => p.id === id)?.active) {
          if (id !== "agent-runner") continue;
          const health = await ctx.host.daemon.request(target, "modules.call", { target: id, method: "health", args: {}, timeoutMs: 15e3 }).catch(() => null);
          if (health?.reasoning && health?.mcpActivity && health?.toolTitles) continue;
          const agents = await ctx.host.daemon.request(target, "modules.call", { target: id, method: "list", args: {}, timeoutMs: 15e3 }).catch(() => null);
          if (!Array.isArray(agents) || agents.some((s) => ["ready", "starting", "busy", "waiting"].includes(s.status))) continue;
        }
        const pushed = await ctx.host.daemon.request(target, "plugins.push", { id });
        if (!pushed.active) throw new Error(pushed.error || `${id} did not activate on the daemon`);
      }
      let push = !plugins.find((p) => p.id === "workflow-runner")?.active;
      if (!push) {
        const health = await ctx.host.daemon.request(target, "modules.call", { target: "workflow-runner", method: "health", args: {}, timeoutMs: 15e3 }).catch(() => null);
        push = !health || health.version !== WORKFLOW_RUNNER_VERSION && !health.active && !health.apps;
      }
      if (push) {
        const pushed = await ctx.host.daemon.request(target, "plugins.push", { id: "workflow-runner" });
        if (!pushed.active) throw new Error(pushed.error || "The workflow runtime did not activate on the daemon");
      }
      return { target, bin: info.bin, dir: info.dir };
    })();
    prepared.set(d.machineId, pending);
    void pending.catch(() => prepared.delete(d.machineId));
  }
  return pending;
}
async function daemonCall(ctx, d, target, method, args = {}, timeoutMs = 12e4) {
  const t = await daemon(ctx, d);
  try {
    return await ctx.host.daemon.request(t.target, "modules.call", { target, method, args, timeoutMs });
  } catch (e) {
    prepared.delete(d.machineId);
    throw e;
  }
}
var runner = (ctx, d, method, args = {}, timeoutMs) => daemonCall(ctx, d, "workflow-runner", method, { projectId: d.projectId, ...args }, timeoutMs);
async function catalog(ctx, d) {
  const c = await ctx.modules.call("persistent-agents", "catalog", { workspaceId: d.id }, { timeoutMs: 12e4 });
  const mcps = (await ctx.modules.call("persistence", "settings.get", { key: "persistent-agents.mcps" }) || []).filter((m) => m.enabled !== false);
  const preferred = await ctx.modules.call("persistence", "settings.get", { key: "workflows.defaultProfile" }).catch(() => null);
  const defaultProfileId = c.profiles.some((p) => p.id === preferred) ? preferred : c.profiles[0]?.id || "";
  return { defaultProfileId, workspace: { id: d.id, name: d.name, machineId: d.machineId, location: d.location }, profiles: c.profiles.map((p) => ({ id: p.id, name: p.name, provider: p.provider })), skills: c.skills, agentFiles: c.agentFiles, mcps: mcps.map((m) => ({ id: m.id, name: m.name })), templates: WORKFLOW_TEMPLATES.map((t) => ({ id: t.id, name: t.name, description: t.description })) };
}
async function runEnv(ctx, d, workflowId) {
  const t = await daemon(ctx, d);
  const c = await ctx.modules.call("persistent-agents", "catalog", { workspaceId: d.id }, { timeoutMs: 12e4 });
  const mcps = (await ctx.modules.call("persistence", "settings.get", { key: "persistent-agents.mcps" }) || []).filter((m) => m.enabled !== false);
  const mcpConfigs = {};
  if (workflowId) {
    const { definition } = await runner(ctx, d, "get", { id: workflowId });
    const connected = /* @__PURE__ */ new Set();
    for (const edge of definition.edges) {
      const agent = definition.blocks.find((b) => b.id === edge.from);
      if (agent && isAgentBlock(agent) && (agent.type === "chatbox" || edgeType(edge) === "use")) connected.add(edge.to);
    }
    const ids = [...new Set(definition.blocks.filter((b) => b.type === "mcp" && connected.has(b.id)).map((b) => b.mcp?.serverId).filter(Boolean))];
    if (ids.length) {
      const configs = await ctx.modules.call("persistent-agents", "mcpConfigs", { workspaceId: d.id, ids }, { timeoutMs: 12e4 });
      for (const { id, ...config } of configs) mcpConfigs[id] = config;
    }
  }
  const subscription = await ctx.modules.call("persistence", "settings.get", { key: "acp.claude.useSubscription" });
  const preferred = await ctx.modules.call("persistence", "settings.get", { key: "workflows.defaultProfile" }).catch(() => null);
  return {
    projectId: d.projectId,
    workspaceId: d.id,
    workspaceName: d.name,
    root: d.rootAbsolutePath,
    machineId: d.machineId,
    daemon: { bin: t.bin, dir: t.dir },
    profiles: c.profiles,
    defaultProfileId: c.profiles.some((p) => p.id === preferred) ? preferred : c.profiles[0]?.id || "",
    claudeSubscription: subscription !== false,
    mcpServers: mcps,
    mcpConfigs
  };
}
var available = async (ctx, d) => {
  const c = await catalog(ctx, d);
  return { profiles: c.profiles, mcps: c.mcps };
};
async function configurator(ctx, d, a) {
  const env = await runEnv(ctx, d);
  const profile = env.profiles.find((p) => p.id === a.profileId) || env.profiles.find((p) => p.id === env.defaultProfileId);
  if (!profile) throw new Error("Enable an AI provider for this machine first");
  const id = crypto.randomUUID();
  const endpoint = await runner(ctx, d, "configEndpoint", { sessionId: id, profiles: env.profiles.map((p) => ({ id: p.id, provider: p.provider })), mcps: env.mcpServers.map((m) => ({ id: m.id })) });
  const spec = {
    id,
    name: "Workflow configurator",
    workspaceId: d.id,
    workspaceName: d.name,
    root: d.rootAbsolutePath,
    machineId: d.machineId,
    profile,
    model: String(a.model || ""),
    agentFile: null,
    skills: [],
    mcps: [endpoint],
    claudeSubscription: env.claudeSubscription,
    workspaceMcp: false,
    daemon: env.daemon,
    workflow: { configurator: true }
  };
  await daemonCall(ctx, d, "agent-runner", "create", { spec }, 24e4);
  const focus = a.workflowId ? `The user is editing workflow "${a.workflowId}" in the designer; read it first.` : "";
  const text = [
    "You configure Hato workflows for this project with the hato-workflow MCP tools (workflows_reference, workflows_list, workflows_read, workflows_write, workflows_validate).",
    'Read workflows_reference before designing. Read a workflow before editing and pass its revision as expected_revision (null to create; read id "new" for a starter).',
    "Preserve block and connection IDs and unrelated settings, fix returned validation issues, and never start runs: the user runs workflows from the Workflows panel.",
    "Report what you changed.",
    focus,
    "",
    `User request: ${String(a.request || "Help me design a workflow.").slice(0, 2e4)}`
  ].filter((s) => s !== void 0).join("\n");
  await daemonCall(ctx, d, "agent-runner", "send", { id, text }, 6e4);
  return { id, workspaceId: d.id };
}
var choicesCache = /* @__PURE__ */ new Map();
async function providerOptions(ctx, d, a) {
  const c = await ctx.modules.call("persistent-agents", "catalog", { workspaceId: d.id });
  const preferred = await ctx.modules.call("persistence", "settings.get", { key: "workflows.defaultProfile" }).catch(() => null);
  const profile = c.profiles.find((p) => p.id === (a.profileId || preferred)) || (!a.profileId ? c.profiles[0] : null);
  if (!profile) throw new Error("Select an enabled provider first");
  const model = String(a.model || ""), key = providerChoiceKey(d.id, profile.id, model);
  const reasoningReady = !!(await daemonCall(ctx, d, "agent-runner", "health").catch(() => null))?.reasoning;
  if (!a.refresh && choicesCache.has(key)) return { ...choicesCache.get(key), reasoningReady };
  const sessions = await daemonCall(ctx, d, "agent-runner", "list");
  const existing = !a.refresh && sessions.find((s) => ["ready", "busy", "waiting"].includes(s.status) && s.workspaceId === d.id && s.profile?.id === profile.id && (s.model || "") === model && (s.configOptions?.length || s.models?.availableModels?.length));
  let choices;
  if (existing) choices = advertisedChoices(existing);
  else {
    const id = crypto.randomUUID();
    try {
      const session = await daemonCall(ctx, d, "agent-runner", "create", { spec: {
        id,
        name: "Workflow provider options",
        workspaceId: d.id,
        workspaceName: d.name,
        root: d.rootAbsolutePath,
        machineId: d.machineId,
        profile,
        model,
        agentFile: null,
        skills: [],
        mcps: [],
        workspaceMcp: false,
        autopilot: false,
        claudeSubscription: await ctx.modules.call("persistence", "settings.get", { key: "acp.claude.useSubscription" }) !== false
      } }, 24e4);
      choices = advertisedChoices(session);
    } finally {
      await daemonCall(ctx, d, "agent-runner", "remove", { id }).catch(() => {
      });
    }
  }
  choicesCache.set(key, choices);
  return { ...choices, reasoningReady };
}
var mcp = null;
var mod = {
  id: "workflows",
  moduleApiVersion: 1,
  activate(ctx) {
    const object = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
    const scoped = async (scope) => resolve(ctx, scope.workspaceId);
    const parse = (c) => typeof c === "string" ? JSON.parse(c) : c;
    mcp = exportMcpTools(ctx, "Workflows", [
      {
        name: "reference",
        title: "Workflow format reference",
        description: "Read the workflow definition format: blocks, connections, templates and agent tools.",
        inputSchema: object({}),
        annotations: { readOnlyHint: true },
        handler: () => WORKFLOW_REFERENCE
      },
      {
        name: "catalog",
        title: "Workflow providers and templates",
        description: "List AI provider profiles, MCP servers, skills and templates usable by workflows in this workspace.",
        inputSchema: object({}),
        annotations: { readOnlyHint: true },
        handler: async (_a, s) => catalog(ctx, await scoped(s))
      },
      {
        name: "list",
        title: "List workflows",
        description: "List this project's workflows with their revisions.",
        inputSchema: object({}),
        annotations: { readOnlyHint: true },
        handler: async (_a, s) => runner(ctx, await scoped(s), "list")
      },
      {
        name: "read",
        title: "Read a workflow",
        description: 'Read a workflow definition and revision. Use id "new" (optionally template_id) for a starter definition.',
        inputSchema: object({ id: { type: "string" }, template_id: { type: "string" } }, ["id"]),
        annotations: { readOnlyHint: true },
        handler: async (a, s) => {
          const d = await scoped(s);
          if (a.id === "new") return { revision: null, definition: await runner(ctx, d, "starter", { templateId: a.template_id }) };
          const r = await runner(ctx, d, "get", { id: String(a.id) });
          return { ...r, issues: validateWorkflow(r.definition, await available(ctx, d)) };
        }
      },
      {
        name: "write",
        title: "Create or update a workflow",
        description: "Save a complete workflow definition (JSON string or object). expected_revision is the revision you read, or null to create. Returns validation issues. Never starts a run.",
        inputSchema: object({ content: {}, expected_revision: { type: ["number", "null"] } }, ["content", "expected_revision"]),
        handler: async (a, s) => {
          const d = await scoped(s);
          const r = await runner(ctx, d, "save", { definition: parse(a.content), expectedRevision: a.expected_revision === null ? null : Number(a.expected_revision), available: await available(ctx, d) });
          ctx.events.emit("workflows.changed", { workspaceId: d.id, workflowId: r.id });
          return { id: r.id, revision: r.revision, issues: r.issues };
        }
      },
      {
        name: "validate",
        title: "Validate a workflow",
        description: "Validate a workflow definition without saving it.",
        inputSchema: object({ content: {} }, ["content"]),
        annotations: { readOnlyHint: true },
        handler: async (a, s) => ({ issues: validateWorkflow(normalizeDefinition(parse(a.content)), await available(ctx, await scoped(s))) })
      },
      {
        name: "run",
        title: "Run a workflow",
        description: "Start a workflow run on the workspace daemon. Only use when the user explicitly asks to run it.",
        inputSchema: object({ id: { type: "string" }, input: { type: "string" }, start_block_id: { type: "string" } }, ["id"]),
        handler: async (a, s) => {
          const d = await scoped(s);
          const r = await runner(ctx, d, "start", { workflowId: String(a.id), input: String(a.input || ""), startBlockId: a.start_block_id, env: await runEnv(ctx, d, String(a.id)) });
          ctx.events.emit("workflows.changed", { workspaceId: d.id, runId: r.id });
          return r;
        }
      },
      {
        name: "run_status",
        title: "Workflow run status",
        description: "Read a workflow run's status and block results (or list recent runs when run_id is omitted).",
        inputSchema: object({ run_id: { type: "string" }, workflow_id: { type: "string" } }),
        annotations: { readOnlyHint: true },
        handler: async (a, s) => {
          const d = await scoped(s);
          if (!a.run_id) return runner(ctx, d, "runs", { workflowId: a.workflow_id });
          const r = await runner(ctx, d, "run", { id: String(a.run_id) });
          if (r.projectId !== d.projectId) throw new Error("Run belongs to another project");
          return { ...r, definition: void 0, blocks: r.blocks.map((b) => ({ blockId: b.blockId, status: b.status, error: b.error, question: b.question, output: b.output?.slice(0, 4e3) })) };
        }
      }
    ]);
  },
  canSwap: () => ({ ok: !mcp || mcp.pending() === 0, reason: "Workflow MCP commands are running" }),
  methods: {
    async providerOptions(ctx, a) {
      return providerOptions(ctx, await resolve(ctx, a.workspaceId), a);
    },
    async catalog(ctx, a) {
      return catalog(ctx, await resolve(ctx, a.workspaceId));
    },
    async list(ctx, a) {
      return runner(ctx, await resolve(ctx, a.workspaceId), "list");
    },
    async get(ctx, a) {
      const d = await resolve(ctx, a.workspaceId);
      const r = await runner(ctx, d, "get", { id: a.id });
      return { ...r, issues: validateWorkflow(r.definition, await available(ctx, d)) };
    },
    async save(ctx, a) {
      const d = await resolve(ctx, a.workspaceId);
      const r = await runner(ctx, d, "save", { definition: a.definition, expectedRevision: a.expectedRevision, available: await available(ctx, d) });
      ctx.events.emit("workflows.changed", { workspaceId: d.id, workflowId: r.id });
      return r;
    },
    async create(ctx, a) {
      const d = await resolve(ctx, a.workspaceId);
      const def = await runner(ctx, d, "starter", { templateId: a.templateId || "blank" });
      if (a.name) def.name = String(a.name).slice(0, 200);
      if (a.definition) Object.assign(def, normalizeDefinition(a.definition), { id: def.id });
      const r = await runner(ctx, d, "save", { definition: def, expectedRevision: null, available: await available(ctx, d) });
      ctx.events.emit("workflows.changed", { workspaceId: d.id, workflowId: r.id });
      return r;
    },
    async remove(ctx, a) {
      const d = await resolve(ctx, a.workspaceId);
      await runner(ctx, d, "remove", { id: a.id });
      ctx.events.emit("workflows.changed", { workspaceId: d.id });
      return null;
    },
    async run(ctx, a) {
      const d = await resolve(ctx, a.workspaceId);
      prepared.delete(d.machineId);
      const r = await runner(ctx, d, "start", { workflowId: a.id, input: String(a.input || ""), startBlockId: a.startBlockId || void 0, env: await runEnv(ctx, d, a.id) });
      ctx.events.emit("workflows.changed", { workspaceId: d.id, runId: r.id });
      return r;
    },
    async chatHistory(ctx, a) {
      const d = await resolve(ctx, a.workspaceId), r = await runner(ctx, d, "run", { id: a.runId });
      if (r.projectId !== d.projectId) throw new Error("Run belongs to another project");
      const st = r.blocks.find((b) => b.blockId === a.blockId);
      if (!st?.sessionId || r.definition.blocks.find((b) => b.id === a.blockId)?.type !== "chatbox") throw new Error("Unknown chatbox session");
      if (!Number.isSafeInteger(a.before) || a.before <= 0) throw new Error("Invalid history cursor");
      const view = await daemonCall(ctx, d, "agent-runner", "view", { id: st.sessionId, before: a.before, limit: 40 }, 15e3);
      if (view.session.workspaceId !== d.id || view.session.workflow && (view.session.workflow.runId !== r.id || view.session.workflow.blockId !== st.blockId)) throw new Error("Session belongs to another workflow");
      const messages = view.messages.map((message) => {
        const user = message.role === "user" && [...st.chat || []].reverse().find((m) => m.role === "user" && String(message.text || "").endsWith(m.text));
        return user ? { ...message, text: user.text } : message;
      });
      return { sessionId: st.sessionId, messages, before: view.before ?? null };
    },
    async runs(ctx, a) {
      return runner(ctx, await resolve(ctx, a.workspaceId), "runs", { workflowId: a.workflowId });
    },
    async runDetail(ctx, a) {
      const d = await resolve(ctx, a.workspaceId), r = await runner(ctx, d, "run", { id: a.runId });
      if (r.projectId !== d.projectId) throw new Error("Run belongs to another project");
      const blocks = await Promise.all(r.blocks.map(async (st) => {
        if (!st.sessionId || r.definition.blocks.find((b) => b.id === st.blockId)?.type !== "chatbox") return st;
        try {
          const view = await daemonCall(ctx, d, "agent-runner", "view", { id: st.sessionId, limit: 40 }, 15e3);
          if (view.session.workspaceId !== d.id || view.session.workflow && (view.session.workflow.runId !== r.id || view.session.workflow.blockId !== st.blockId)) throw new Error("Session belongs to another workflow");
          return { ...st, agentMessages: view.messages.map((message) => {
            const user = message.role === "user" && [...st.chat || []].reverse().find((m) => m.role === "user" && String(message.text || "").endsWith(m.text));
            return user ? { ...message, text: user.text } : message;
          }), agentHistoryBefore: view.before ?? null, agentActivity: { status: view.session.status, text: view.session.status === "ready" ? "Ready for a message" : agentActivity(view), permissionId: view.permissions?.[0]?.id } };
        } catch {
          return { ...st, agentActivity: { status: "unavailable", text: "Agent status is temporarily unavailable" } };
        }
      }));
      return { ...r, blocks };
    },
    async blockOutput(ctx, a) {
      return runner(ctx, await resolve(ctx, a.workspaceId), "blockOutput", { runId: a.runId, blockId: a.blockId, offset: a.offset, limit: a.limit });
    },
    async cancel(ctx, a) {
      return runner(ctx, await resolve(ctx, a.workspaceId), "cancel", { id: a.runId });
    },
    async answer(ctx, a) {
      return runner(ctx, await resolve(ctx, a.workspaceId), "answer", { runId: a.runId, blockId: a.blockId, pauseId: a.pauseId, answer: a.answer });
    },
    async chat(ctx, a) {
      return runner(ctx, await resolve(ctx, a.workspaceId), "chat", { runId: a.runId, blockId: a.blockId, text: a.text });
    },
    async removeRun(ctx, a) {
      const d = await resolve(ctx, a.workspaceId);
      const r = await runner(ctx, d, "removeRun", { id: a.runId });
      for (const id of r.sessions || []) await daemonCall(ctx, d, "agent-runner", "remove", { id }).catch((e) => ctx.log.warn("workflow session cleanup", errMsg(e)));
      return null;
    },
    async apps(ctx, a) {
      const d = await resolve(ctx, a.workspaceId);
      return runner(ctx, d, "apps", { root: d.rootAbsolutePath });
    },
    async appAction(ctx, a) {
      const d = await resolve(ctx, a.workspaceId);
      return runner(ctx, d, "appAction", { root: d.rootAbsolutePath, name: a.name, action: a.action, lines: a.lines });
    },
    /** Provider permission of a block's session, reviewed through the trusted approval UI. */
    async reviewPermission(ctx, a) {
      return ctx.modules.call("persistent-agents", "reviewPermission", { workspaceId: a.workspaceId, id: a.sessionId, permissionId: a.permissionId }, { timeoutMs: 6e5 });
    },
    async configure(ctx, a) {
      return configurator(ctx, await resolve(ctx, a.workspaceId), a);
    },
    async setDefaultProfile(ctx, a) {
      await ctx.modules.call("persistence", "settings.set", { key: "workflows.defaultProfile", value: String(a.profileId || "") });
      return null;
    }
  }
};
var index_default = mod;
export {
  index_default as default
};
