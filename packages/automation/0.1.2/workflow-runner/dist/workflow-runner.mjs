// ../sdk/runtime.ts
var JsonRpcPeer = class {
  constructor(send, startId = 1) {
    this.send = send;
    this.buf = "";
    this.nextId = 1;
    this.pending = /* @__PURE__ */ new Map();
    this.onRequest = async (m) => {
      throw rpcError(-32601, "Method not found: " + m);
    };
    this.onNotification = () => {
    };
    this.onProtocolError = () => {
    };
    this.nextId = startId;
  }
  get pendingCount() {
    return this.pending.size;
  }
  get nextRequestId() {
    return this.nextId;
  }
  get partial() {
    return this.buf;
  }
  restore(partial) {
    this.buf = partial;
  }
  feed(chunk) {
    this.buf += chunk;
    let i;
    while ((i = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch (e) {
        this.onProtocolError("invalid JSON", line);
        continue;
      }
      this.handle(msg, line);
    }
  }
  handle(msg, line) {
    if (msg && msg.method && msg.id !== void 0 && msg.id !== null) {
      const id = msg.id;
      this.onRequest(msg.method, msg.params, id).then(
        (result) => this.send(JSON.stringify({ jsonrpc: "2.0", id, result: result === void 0 ? null : result })),
        (err) => this.send(JSON.stringify({ jsonrpc: "2.0", id, error: { code: err && typeof err.rpcCode === "number" ? err.rpcCode : -32603, message: err && err.message || String(err), data: err && err.data } }))
      ).catch(() => {
      });
    } else if (msg && msg.method) {
      try {
        this.onNotification(msg.method, msg.params);
      } catch (e) {
        this.onProtocolError(String(e), line);
      }
    } else if (msg && (msg.result !== void 0 || msg.error !== void 0) && msg.id !== void 0) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) {
        const d = msg.error.data;
        const detail2 = d ? typeof d === "string" ? d : typeof d.message === "string" ? d.message : JSON.stringify(d) : "";
        const e = new Error((msg.error.message || "JSON-RPC error") + (detail2 && !String(msg.error.message).includes(detail2) ? `: ${detail2.slice(0, 600)}` : ""));
        e.rpcCode = msg.error.code;
        e.data = msg.error.data;
        p.reject(e);
      } else p.resolve(msg.result);
    } else {
      this.onProtocolError("unrecognized message", line);
    }
  }
  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.send(JSON.stringify({ jsonrpc: "2.0", id, method, params })).catch((e) => {
        this.pending.delete(id);
        reject(e);
      });
    });
  }
  notify(method, params) {
    return this.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
  }
  failAll(reason) {
    for (const [id, p] of this.pending) {
      const e = new Error(reason);
      e.code = "ECLOSED";
      p.reject(e);
      this.pending.delete(id);
    }
  }
};
function rpcError(code, message, data) {
  const e = new Error(message);
  e.rpcCode = code;
  e.data = data;
  return e;
}
function errMsg(e) {
  return e && (e.message || String(e)) || "unknown error";
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
    const block2 = {
      id: clip(b?.id, 80) || `block-${i + 1}`,
      type: String(b?.type || ""),
      label: clip(b?.label, 200),
      prompt: clip(b?.prompt, 2e5),
      position: { x: Math.round(num(b?.position?.x) ?? 40 + i % 5 * 260), y: Math.round(num(b?.position?.y) ?? 40 + Math.floor(i / 5) * 170) }
    };
    if (typeof b?.description === "string") block2.description = clip(b.description, 4e3);
    if (typeof b?.command === "string") block2.command = clip(b.command, 64e3);
    if (num(b?.timeoutSeconds) !== void 0) block2.timeoutSeconds = num(b.timeoutSeconds);
    if (num(b?.seconds) !== void 0) block2.seconds = num(b.seconds);
    if (b?.app && typeof b.app === "object") block2.app = {
      name: clip(b.app.name, 80),
      ...Array.isArray(b.app.actions) ? { actions: b.app.actions.filter((a) => ["start", "status", "kill", "tail"].includes(a)) } : {},
      ...["start", "status", "kill", "tail"].includes(b.app.action) ? { action: b.app.action } : {},
      ...num(b.app.lines) ? { lines: num(b.app.lines) } : {}
    };
    for (const k of ["profileId", "provider", "model", "reasoning", "agentFile", "skillId"]) if (typeof b?.[k] === "string" && b[k]) block2[k] = clip(b[k], 400);
    if (!block2.agentFile && b?.agent && b.agent.scope === "workspace" && typeof b.agent.name === "string") block2.agentFile = `.agents/agents/${clip(b.agent.name, 180)}`;
    if (typeof b?.autopilot === "boolean") block2.autopilot = b.autopilot;
    if (b?.mcp && typeof b.mcp.serverId === "string") block2.mcp = { serverId: clip(b.mcp.serverId, 120) };
    if (b?.join === "any" || b?.join === "all") block2.join = b.join;
    if (b?.inputSchema && typeof b.inputSchema === "object") block2.inputSchema = b.inputSchema;
    if (b?.outputSchema && typeof b.outputSchema === "object") block2.outputSchema = b.outputSchema;
    return block2;
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
function validateWorkflow(def, available) {
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
    if (b.type === "mcp" && b.mcp?.serverId && available?.mcps && !available.mcps.some((m) => m.id === b.mcp.serverId)) warn("unavailable-mcp", `MCP server for '${name}' is not configured or enabled`, { blockId: b.id });
    if (isAgentBlock(b) && available?.profiles) {
      const ok = b.profileId ? available.profiles.some((p) => p.id === b.profileId) : b.provider ? available.profiles.some((p) => p.provider === b.provider) : available.profiles.length > 0;
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
var blockingIssues = (issues) => issues.filter((i) => i.severity !== "warning");
function preview(text, limit) {
  if (text.length <= limit) return text;
  const head = Math.floor(limit * 0.6), tail = limit - head;
  return `${text.slice(0, head)}
…[${text.length - limit} characters omitted; use workflow_block_output to page]…
${text.slice(-tail)}`;
}
function renderPrompt(template, input, outputs, limits = { reference: 8e3, total: 2e4 }) {
  const get = (id) => outputs instanceof Map ? outputs.get(id) : outputs[id];
  let budget = limits.total;
  return template.replace(/\{\{\s*(input|blocks\.([A-Za-z0-9_-]+)\.output)\s*\}\}/g, (_m, all, id) => {
    if (all === "input") return input;
    const value = get(id) ?? "";
    const text = preview(value, Math.max(200, Math.min(limits.reference, budget)));
    budget = Math.max(0, budget - text.length);
    return text;
  });
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
      ...agents.map((agent2, index) => ({
        id: agent2.id,
        type: "ai",
        label: agent2.label,
        prompt: `${agent2.role}
Task: {{input}}
Use the connected meeting block through workflow_use_block to read the team's messages (action diff), publish relevant findings (action publish, message), and coordinate handoffs. Status notices are announced automatically. If waking a teammate with action shake, supply peer_block_id and a specific message. Publish your result to the room and return it to the coordinator. Finish your invocation when your assigned work is complete.`,
        position: { x: 620, y: 40 + index * 180 }
      })),
      { id: "meeting", type: "meeting", label: "Team meeting", prompt: "", position: { x: 940, y: 220 } },
      { id: "report", type: "markdown", label: "Team report", prompt: "{{input}}", position: { x: 310, y: 580 } }
    ],
    edges: [
      { id: "start-team", from: "start", to: "coordinator", type: "follow" },
      ...agents.map((agent2) => ({ id: `delegate-${agent2.id}`, from: "coordinator", to: agent2.id, type: "use" })),
      ...["coordinator", ...agents.map((agent2) => agent2.id)].map((id) => ({ id: `meeting-${id}`, from: id, to: "meeting", type: "use" })),
      { id: "team-report", from: "coordinator", to: "report", type: "follow" }
    ]
  };
}
var WORKFLOW_TEMPLATES = [
  { id: "blank", name: "Blank workflow", description: "Start from an empty canvas.", graph: () => ({ blocks: [], edges: [] }) },
  { id: "multi-agent-setup", name: "Multi-agent setup", description: "Start with a prompt, coordinate three specialist agents in a shared meeting, and produce a report.", graph: multiAgentSetup }
];

// ../sdk/mcp-servers.ts
var transportOf = (m) => m.transport === "http" || m.transport === "sse" ? m.transport : "stdio";
function acpServer(m, authorization) {
  const transport = transportOf(m);
  if (transport === "stdio") return { name: m.name, command: m.command, args: m.args, env: m.env };
  const headers = [...m.headers || []];
  const auth = authorization ?? (m.auth?.type === "bearer" && m.auth.token ? `Bearer ${m.auth.token}` : null);
  if (auth) headers.push({ name: "Authorization", value: auth });
  return { type: transport, name: m.name, url: m.url, headers };
}

// modules/services/workflow-runner/src/procs.ts
var shell = (ctx2) => ctx2.host.env.info().platform === "macos" ? "/bin/zsh" : "/bin/sh";
async function runScript(ctx2, root, command, input, opts) {
  const grant = await ctx2.host.capabilities.request({ kind: "process", root, target: { kind: "local" } });
  let handle;
  try {
    const env = { HATO_WORKFLOW_INPUT: input, HATOPAD_WORKFLOW_INPUT: input, TERM: "dumb" };
    handle = (await ctx2.host.process.spawn(grant.grant, { target: { kind: "local" }, executable: shell(ctx2), args: ["-lc", command], cwd: root, env })).handle;
  } finally {
    await ctx2.host.capabilities.release(grant.grant);
  }
  opts.track(handle);
  let stdout = "", stderr = "";
  const subs = [
    await ctx2.host.streams.listen(handle, { channel: "stdout" }, (c) => {
      stdout = (stdout + c).slice(-4e5);
    }),
    await ctx2.host.streams.listen(handle, { channel: "stderr" }, (c) => {
      stderr = (stderr + c).slice(-4e4);
    })
  ];
  const timer = setTimeout(() => {
    stderr += `
Script timed out after ${Math.round(opts.timeoutMs / 1e3)} s`;
    void ctx2.host.process.terminate(handle, "SIGKILL").catch(() => {
    });
  }, opts.timeoutMs);
  try {
    await ctx2.host.process.write(handle, input).catch(() => {
    });
    await ctx2.host.process.closeStdin(handle).catch(() => {
    });
    const exit = await ctx2.host.process.wait(handle);
    await new Promise((r) => setTimeout(r, 50));
    return { code: exit?.code ?? null, stdout, stderr };
  } finally {
    clearTimeout(timer);
    opts.track(null);
    for (const s of subs) await s.close().catch(() => {
    });
    await ctx2.host.resources.release(handle).catch(() => {
    });
  }
}
var apps = /* @__PURE__ */ new Map();
var key = (root, name) => `${root}\0${name}`;
var APP_BUFFER = 512 * 1024;
var runningApps = () => [...apps.values()].filter((a) => a.status !== "exited").length;
var listApps = (root) => [...apps.values()].filter((a) => a.root === root).map((a) => appState(a));
function appState(a, name = "", lines = 0) {
  if (!a) return { name, status: "not_found", output: "" };
  const out = lines > 0 ? a.output.split("\n").slice(-Math.min(lines, 1e4) - 1).join("\n") : void 0;
  return { name: a.name, status: a.status, pid: a.pid, exitCode: a.exitCode, startedAt: a.startedAt, command: a.command, ...out !== void 0 ? { output: out } : {} };
}
async function appAction(ctx2, root, name, command, action, lines = 100) {
  const k = key(root, name), current = apps.get(k);
  if (action === "status") return appState(current, name);
  if (action === "tail") return appState(current, name, lines);
  if (action === "kill") {
    if (!current || current.status === "exited" || !current.handle) return appState(current, name);
    const h2 = current.handle;
    await ctx2.host.process.terminate(h2, "SIGTERM").catch(() => {
    });
    setTimeout(() => {
      if (current.status !== "exited") void ctx2.host.process.terminate(h2, "SIGKILL").catch(() => {
      });
    }, 3e3);
    for (let i = 0; i < 40 && current.status !== "exited"; i++) await new Promise((r) => setTimeout(r, 100));
    return appState(current, name);
  }
  if (action !== "start") throw new Error(`Unknown Run App action '${action}'`);
  if (current && current.status !== "exited") return { ...appState(current, name), note: "Already running" };
  const app = { name, root, command, handle: null, status: "starting", output: "", startedAt: (/* @__PURE__ */ new Date()).toISOString() };
  apps.set(k, app);
  const grant = await ctx2.host.capabilities.request({ kind: "process", root, target: { kind: "local" } });
  try {
    const spawned = await ctx2.host.process.spawn(grant.grant, { target: { kind: "local" }, executable: shell(ctx2), args: ["-lc", command], cwd: root, env: { TERM: "dumb" } });
    app.handle = spawned.handle;
    app.pid = spawned.pid;
    app.status = "running";
  } catch (e) {
    app.status = "exited";
    app.output = errMsg(e);
    throw e;
  } finally {
    await ctx2.host.capabilities.release(grant.grant);
  }
  const append = (c) => {
    app.output = (app.output + c).slice(-APP_BUFFER);
  };
  const h = app.handle;
  await ctx2.host.streams.listen(h, { channel: "stdout" }, append);
  await ctx2.host.streams.listen(h, { channel: "stderr" }, append);
  void ctx2.host.process.wait(h).then((exit) => {
    app.status = "exited";
    app.exitCode = exit?.code ?? null;
    void ctx2.host.resources.release(h).catch(() => {
    });
  }).catch(() => {
    app.status = "exited";
  });
  await ctx2.host.process.closeStdin(h).catch(() => {
  });
  return appState(app, name);
}
async function killAllApps(ctx2) {
  for (const a of apps.values()) if (a.handle && a.status !== "exited") await ctx2.host.process.terminate(a.handle, "SIGKILL").catch(() => {
  });
}

// modules/services/workflow-runner/src/mcp.ts
var db;
var listener = null;
var scopes = /* @__PURE__ */ new Map();
var connections = /* @__PURE__ */ new Map();
var proxy = `const net=require('node:net'),fs=require('node:fs');let p=process.env.HATO_MCP_PORT;try{p=fs.readFileSync(process.env.HATO_MCP_PORT_FILE,'utf8').trim()||p}catch{}const s=net.connect({host:'127.0.0.1',port:Number(p)},()=>{s.write(JSON.stringify({token:process.env.HATO_MCP_TOKEN})+'\\n');process.stdin.pipe(s)});s.pipe(process.stdout);s.on('error',e=>{console.error(e.message);process.exit(1)});s.on('close',()=>process.exit(0));process.stdin.on('end',()=>s.end());`;
var handler;
var portDir = null;
var PORT_FILE = "workflow-runner.port";
async function initMcp(ctx2, database, h) {
  db = database;
  handler = h;
  await ctx2.host.db.exec(db, "CREATE TABLE IF NOT EXISTS scopes(token TEXT PRIMARY KEY, data TEXT NOT NULL)");
  for (const r of await ctx2.host.db.query(db, "SELECT data FROM scopes")) {
    const s = JSON.parse(r.data);
    scopes.set(s.token, s);
  }
  portDir = ctx2.host.env.info().sharedDir || null;
  if (scopes.size && portDir) await listen(ctx2).catch((e) => ctx2.log.warn("workflow MCP listener", errMsg(e)));
}
async function writePort(ctx2) {
  if (!portDir || !listener) return;
  portWritten = false;
  const g = await ctx2.host.capabilities.request({ kind: "fs", root: portDir, target: { kind: "local" }, write: true });
  try {
    await ctx2.host.fs.writeAtomic(g.grant, PORT_FILE, String(listener.port), { reason: "workflow MCP port" });
  } finally {
    await ctx2.host.capabilities.release(g.grant);
  }
  portWritten = true;
}
var portWritten = false;
async function listen(ctx2) {
  if (listener) return listener;
  listener = await ctx2.host.net.listenLoopback();
  let pending = "";
  await ctx2.host.streams.listen(listener.handle, {}, (chunk) => {
    pending += chunk;
    let i;
    while ((i = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, i);
      pending = pending.slice(i + 1);
      try {
        const e = JSON.parse(line);
        if (e.connection) void connection(ctx2, e.connection);
      } catch {
      }
    }
  });
  await writePort(ctx2).catch((e) => ctx2.log.warn("workflow MCP port file", errMsg(e)));
  return listener;
}
async function connection(ctx2, handle) {
  const c = { token: null, buffer: "", peer: null };
  connections.set(handle, c);
  await ctx2.host.streams.listen(handle, {}, (chunk) => {
    if (c.peer) {
      c.peer.feed(chunk);
      return;
    }
    c.buffer += chunk;
    const i = c.buffer.indexOf("\n");
    if (i < 0) {
      if (c.buffer.length > 4096) void ctx2.host.net.close(handle);
      return;
    }
    let token;
    try {
      token = JSON.parse(c.buffer.slice(0, i)).token;
    } catch {
    }
    if (typeof token !== "string" || !scopes.has(token)) {
      void ctx2.host.net.close(handle);
      return;
    }
    c.token = token;
    c.peer = new JsonRpcPeer((line) => ctx2.host.net.write(handle, line + "\n"));
    c.peer.onRequest = async (method, params) => {
      const s = scopes.get(c.token);
      if (!s) throw rpcError(-32001, "Workflow MCP access revoked");
      if (method === "initialize") return { protocolVersion: ["2024-11-05", "2025-03-26", "2025-06-18"].includes(params?.protocolVersion) ? params.protocolVersion : "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "hato-workflow", version: "0.1.0" } };
      if (method === "ping") return {};
      if (method === "tools/list") return { tools: handler.list(s) };
      if (method === "tools/call") {
        try {
          const value = await handler.call(s, String(params?.name || ""), params?.arguments || {});
          return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }] };
        } catch (e) {
          return { content: [{ type: "text", text: errMsg(e) }], isError: true };
        }
      }
      throw rpcError(-32601, "Unknown MCP method");
    };
    const rest = c.buffer.slice(i + 1);
    c.buffer = "";
    if (rest) c.peer.feed(rest);
  }, () => {
    connections.delete(handle);
    void ctx2.host.net.close(handle).catch(() => {
    });
  });
}
async function issueEndpoint(ctx2, scope) {
  const token = crypto.randomUUID() + crypto.randomUUID();
  const s = { ...scope, token };
  scopes.set(token, s);
  await ctx2.host.db.exec(db, "INSERT INTO scopes(token,data) VALUES(?,?)", [token, JSON.stringify(s)]);
  const l = await listen(ctx2);
  return { id: "hato-workflow", name: "hato-workflow", command: "node", args: ["-e", proxy], env: [{ name: "HATO_MCP_PORT", value: String(l.port) }, ...portDir && portWritten ? [{ name: "HATO_MCP_PORT_FILE", value: `${portDir.replace(/\/$/, "")}/${PORT_FILE}` }] : [], { name: "HATO_MCP_TOKEN", value: token }] };
}
async function revokeWhere(ctx2, match) {
  for (const [t, s] of [...scopes]) if (match(s)) {
    scopes.delete(t);
    await ctx2.host.db.exec(db, "DELETE FROM scopes WHERE token=?", [t]);
    for (const [h, c] of connections) if (c.token === t) await ctx2.host.net.close(h).catch(() => {
    });
  }
}

// modules/services/workflow-runner/src/engine.ts
var ctx;
var persist;
var execs = /* @__PURE__ */ new Map();
function initEngine(c, save2) {
  ctx = c;
  persist = save2;
}
var now2 = () => (/* @__PURE__ */ new Date()).toISOString();
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
var block = (x, id) => {
  const b = x.def.blocks.find((b2) => b2.id === id);
  if (!b) throw new Error(`Unknown block '${id}'`);
  return b;
};
var stateOf = (x, id) => {
  let s = x.run.blocks.find((s2) => s2.blockId === id);
  if (!s) {
    s = { blockId: id, status: "idle", runs: 0, log: [] };
    x.run.blocks.push(s);
  }
  return s;
};
var outputLimit = (x) => x.def.settings?.outputLimitChars ?? 2e5;
function log(s, kind, text) {
  s.log.push({ at: now2(), kind, text: text.length > 4e3 ? text.slice(0, 4e3) + "…" : text });
  if (s.log.length > 200) s.log.splice(0, s.log.length - 200);
}
function touch(x) {
  publishMeetingStatusChanges(x);
  if (x.run.status === "running" || x.run.status === "waiting") {
    const active = x.run.blocks.some((s) => s.status === "running");
    const paused = x.run.blocks.some((s) => ["awaiting_user_input", "awaiting_permission", "waiting_timer"].includes(s.status));
    x.run.status = active ? "running" : paused ? "waiting" : "running";
  }
  persist(x.run);
}
function transfer(x, edgeId, phase, payload, callId = crypto.randomUUID(), action, error = false) {
  var _a;
  const events = (_a = x.run).transfers ?? (_a.transfers = []);
  const text = typeof payload === "string" ? payload : JSON.stringify(payload) || "";
  events.push({ seq: (events[events.length - 1]?.seq ?? 0) + 1, callId, edgeId, phase, at: now2(), action, chars: text.length, ...error ? { error: true } : {} });
  if (events.length > 1e3) events.splice(0, events.length - 1e3);
  touch(x);
  return callId;
}
function recordMcpActivity(x, callerId, sessionId, u) {
  if (stateOf(x, callerId).sessionId !== sessionId || !u.toolCallId) return;
  const key2 = `${sessionId}:${u.toolCallId}`;
  let call = x.mcpCalls.get(key2);
  if (!call) {
    const raw = u.rawInput || {};
    const server = raw.server || raw.server_name || raw.mcpServer || u._meta?.mcpServer;
    const title = String(u.title || raw.tool || raw.name || "");
    const names = [u.title, raw.tool, raw.name].filter((name) => typeof name === "string");
    const candidates = toolTargets(x, callerId).filter((b) => b.type === "mcp").filter((b) => {
      const config = x.env.mcpServers.find((m) => m.id === b.mcp?.serverId);
      return config && [config.id, config.name].some((name) => server === name || names.some((tool) => tool.startsWith(`mcp__${name}__`) || tool.startsWith(`mcp.${name}.`)));
    });
    if (candidates.length !== 1) return;
    const target = candidates[0];
    const edge = x.def.edges.find((e) => e.from === callerId && e.to === target.id && edgeType(e) === "use") || x.def.edges.find((e) => e.from === callerId && e.to === target.id && block(x, callerId).type === "chatbox");
    if (!edge) return;
    const callId = transfer(x, edge.id, "send", raw.arguments || raw, void 0, title);
    call = { blockId: target.id, edgeId: edge.id, callId, title: title || String(raw.tool || "MCP tool"), status: "" };
    x.mcpCalls.set(key2, call);
    const st2 = stateOf(x, target.id);
    st2.runs++;
    st2.startedAt = now2();
    st2.completedAt = void 0;
    st2.error = void 0;
    log(st2, "tool", `${callerId} · ${call.title} · ${callId}
${preview(JSON.stringify(raw.arguments || raw), 3e3)}`);
  }
  const status = String(u.status || "in_progress");
  if (call.status === status || ["completed", "failed"].includes(call.status)) return;
  call.status = status;
  const st = stateOf(x, call.blockId);
  if (["completed", "failed"].includes(status)) {
    const result = (u.content || []).map((item) => item.content?.text || item.text || "").join("\n");
    log(st, status === "failed" ? "error" : "response", `${call.title} · ${status} · ${call.callId}
${result}`);
    transfer(x, call.edgeId, "return", result, call.callId, call.title, status === "failed");
    if (status === "failed") st.error = preview(result || `${call.title} failed`, 1e3);
    st.completedAt = now2();
  }
  const pending = [...x.mcpCalls.values()].some((c) => c.blockId === call.blockId && !["completed", "failed"].includes(c.status));
  st.status = pending ? "running" : st.error ? "failed" : "succeeded";
  if (x.mcpCalls.size > 200) for (const [id, old] of x.mcpCalls) {
    if (x.mcpCalls.size <= 200) break;
    if (["completed", "failed"].includes(old.status)) x.mcpCalls.delete(id);
  }
  touch(x);
}
function assertActive(x) {
  if (x.cancelled) throw new Error("Workflow run was cancelled");
}
function newExec(run, env) {
  const x = {
    run,
    env,
    def: run.definition,
    mcpCalls: /* @__PURE__ */ new Map(),
    outputs: /* @__PURE__ */ new Map(),
    busy: /* @__PURE__ */ new Set(),
    timers: /* @__PURE__ */ new Map(),
    answers: /* @__PURE__ */ new Map(),
    background: /* @__PURE__ */ new Set(),
    loops: /* @__PURE__ */ new Map(),
    steps: 0,
    joins: /* @__PURE__ */ new Map(),
    fetched: /* @__PURE__ */ new Map(),
    meetingWaiters: /* @__PURE__ */ new Map(),
    participantStatuses: new Map(run.blocks.map((s) => [s.blockId, s.status])),
    procs: /* @__PURE__ */ new Set(),
    cancelled: false,
    driving: false
  };
  for (const s of run.blocks) if (s.output !== void 0) x.outputs.set(s.blockId, s.output);
  execs.set(run.id, x);
  return x;
}
var flowEdge = (e) => edgeType(e) !== "use";
function reaches2(x, from, to) {
  const seen = /* @__PURE__ */ new Set(), stack = [from];
  while (stack.length) {
    const c = stack.pop();
    if (c === to) return true;
    if (seen.has(c)) continue;
    seen.add(c);
    for (const e of x.def.edges) if (e.from === c && flowEdge(e)) stack.push(e.to);
  }
  return false;
}
var forwardEdge = (x, e) => !e.loop && flowEdge(e) && !reaches2(x, e.to, e.from);
function toolTargets(x, callerId) {
  const caller = block(x, callerId);
  const ids = x.def.edges.filter((e) => e.from === callerId && (edgeType(e) === "use" || caller.type === "chatbox")).map((e) => e.to);
  return [...new Set(ids)].map((id) => block(x, id));
}
function joinInput(x, target, active, outputs) {
  return active.map((e) => `## ${block(x, e.from).label} (${e.from})
${preview(outputs.get(e.from) ?? "", Math.floor(2e4 / active.length))}`).join("\n\n");
}
function resolveEdge(x, e, active, output, path, visited = /* @__PURE__ */ new Set()) {
  if (active) transfer(x, e.id, "flow", output);
  const target = e.to;
  const incoming = x.def.edges.filter((i) => i.to === target && forwardEdge(x, i));
  const outgoing = () => x.def.edges.filter((o) => o.from === target && forwardEdge(x, o));
  if (incoming.length < 2) {
    if (active) return [invoke(x, target, output, path)];
    if (visited.has(target)) return [];
    visited.add(target);
    return outgoing().flatMap((n) => resolveEdge(x, n, false, "", [...path, target], visited));
  }
  let entry = x.joins.get(target);
  if (!entry) {
    entry = { resolved: /* @__PURE__ */ new Set(), active: /* @__PURE__ */ new Set(), outputs: /* @__PURE__ */ new Map(), fired: false };
    x.joins.set(target, entry);
  }
  entry.resolved.add(e.id);
  if (active) {
    entry.active.add(e.id);
    entry.outputs.set(e.from, output);
  }
  const complete = incoming.every((i) => entry.resolved.has(i.id));
  const results = [];
  if (!entry.fired && entry.active.size > 0 && (complete || block(x, target).join === "any")) {
    entry.fired = true;
    const activeEdges = incoming.filter((i) => entry.active.has(i.id));
    const input = activeEdges.length === 1 ? entry.outputs.get(activeEdges[0].from) : joinInput(x, target, activeEdges, entry.outputs);
    results.push(invoke(x, target, input, path));
  }
  if (complete) {
    x.joins.delete(target);
    if (!entry.fired && !visited.has(target)) {
      visited.add(target);
      for (const n of outgoing()) results.push(...resolveEdge(x, n, false, "", [...path, target], visited));
    }
  }
  return results;
}
async function invoke(x, id, input, ancestors = [], viaTool = false) {
  assertActive(x);
  if (x.busy.has(id)) throw new Error("This block is already active; recursive or concurrent calls are not allowed");
  if (++x.steps > (x.def.settings?.maxSteps ?? 1e3)) throw new Error("Workflow exceeded its block execution limit");
  const b = block(x, id), s = stateOf(x, id);
  x.busy.add(id);
  Object.assign(s, { status: "running", startedAt: now2(), completedAt: void 0, error: void 0, selectedRoute: void 0, input: preview(input, 2e4), runs: s.runs + 1 });
  touch(x);
  let output = input;
  try {
    const rendered = () => renderPrompt(b.prompt, input, x.outputs);
    switch (b.type) {
      case "start_button":
      case "text":
        output = rendered();
        break;
      case "start_input":
        output = input;
        break;
      case "markdown":
        output = b.prompt.trim() ? rendered() : input;
        break;
      case "skill":
        output = b.skillId ? await loadSkill(x, b) : rendered();
        break;
      case "meeting":
        output = JSON.stringify(meetingTail(s, 20));
        break;
      case "terminal_control":
      case "task_controls":
      case "mcp":
        output = `${b.label} adds tools to connected agents.`;
        break;
      case "script":
        output = await script(x, b, s, input);
        break;
      case "run_app":
        output = JSON.stringify(await appAction(ctx, x.env.root, b.app.name, b.command || "", b.app?.action || "start", b.app?.lines || 100));
        break;
      case "timer": {
        armTimer(x, b, s, input);
        x.busy.delete(id);
        return `Timer armed for ${s.waitingUntil}`;
      }
      case "user_prompt":
      case "yes_no_prompt": {
        const question = rendered().trim() || input;
        let answer2 = await ask(x, b, s, question);
        if (b.type === "yes_no_prompt") {
          answer2 = /^(y|yes|true)$/i.test(answer2.trim()) ? "yes" : "no";
          s.selectedRoute = answer2;
        }
        output = answer2;
        break;
      }
      case "ai":
      case "chatbox":
        output = await agent(x, b, s, input);
        break;
      default:
        throw new Error(`Unsupported block type '${b.type}'`);
    }
    assertActive(x);
    log(s, "response", output);
    s.output = output.length > outputLimit(x) ? output.slice(-outputLimit(x)) : output;
    x.outputs.set(id, output);
    Object.assign(s, { status: "succeeded", completedAt: now2(), question: void 0, pauseId: void 0, permissionId: void 0 });
    touch(x);
  } catch (e) {
    const message = errMsg(e);
    Object.assign(s, { status: x.cancelled ? "cancelled" : "failed", error: message, completedAt: now2(), question: void 0, pauseId: void 0, permissionId: void 0 });
    log(s, "error", message);
    if (!viaTool && !x.cancelled) x.flowFailed ?? (x.flowFailed = `${b.label}: ${message}`);
    touch(x);
    throw e;
  } finally {
    x.busy.delete(id);
  }
  if (b.type !== "chatbox") await followers(x, b, s, output, ancestors);
  return output;
}
async function followers(x, b, s, output, ancestors) {
  const id = b.id, out = x.def.edges.filter((e) => e.from === id && flowEdge(e));
  const pending = [];
  for (const e of out.filter((e2) => edgeType(e2) === "path" && e2.label !== s.selectedRoute && forwardEdge(x, e2)))
    pending.push(...resolveEdge(x, e, false, "", [...ancestors, id]));
  for (const e of out.filter((e2) => edgeType(e2) === "follow" || edgeType(e2) === "path" && e2.label === s.selectedRoute)) {
    if (x.busy.has(e.to)) {
      log(s, "lifecycle", `Skipped connection to active block '${block(x, e.to).label}'`);
      continue;
    }
    const back = ancestors.includes(e.to) || e.to === id || !forwardEdge(x, e);
    if (back) {
      const count = (x.loops.get(e.id) ?? 0) + 1, limit = x.def.settings?.maxLoopCount ?? 100;
      if (count > limit) throw new Error(`Workflow loop '${e.label || e.id}' reached its limit of ${limit} iterations`);
      x.loops.set(e.id, count);
      transfer(x, e.id, "flow", output);
      pending.push(invoke(x, e.to, output, [...ancestors, id]));
    } else pending.push(...resolveEdge(x, e, true, output, [...ancestors, id]));
  }
  const settled = await Promise.allSettled(pending);
  const failed = settled.find((r) => r.status === "rejected");
  if (failed) throw failed.reason;
}
async function loadSkill(x, b) {
  const g = await ctx.host.capabilities.request({ kind: "fs", root: x.env.root, target: { kind: "local" } });
  try {
    const file = await ctx.host.fs.read(g.grant, b.skillId, 256 * 1024);
    if (file.binary || file.truncated) throw new Error(`Skill file is binary or too large: ${b.skillId}`);
    const dir = b.skillId.includes("/") ? b.skillId.slice(0, b.skillId.lastIndexOf("/")) : ".";
    return JSON.stringify({ skill: { name: b.label, path: b.skillId, baseDirectory: `${x.env.root.replace(/\/$/, "")}/${dir}`, content: file.text || "" } });
  } finally {
    await ctx.host.capabilities.release(g.grant);
  }
}
async function script(x, b, s, input) {
  log(s, "prompt", input);
  const timeoutMs = Math.min(Math.max((b.timeoutSeconds ?? 1800) * 1e3, 1e3), 864e5);
  let current = null;
  const r = await runScript(ctx, x.env.root, b.command || "", input, { timeoutMs, track: (h) => {
    if (current) x.procs.delete(current);
    current = h;
    if (h) x.procs.add(h);
  } });
  assertActive(x);
  if (r.code !== 0) throw new Error(`Script exited with ${r.code ?? "a signal"}${r.stderr.trim() ? `: ${preview(r.stderr.trim(), 4e3)}` : r.stdout.trim() ? `: ${preview(r.stdout.trim(), 4e3)}` : ""}`);
  return r.stdout + (r.stderr.trim() ? `
[stderr]
${r.stderr}` : "");
}
function armTimer(x, b, s, input) {
  const old = x.timers.get(b.id);
  if (old) clearTimeout(old);
  const ms = Math.max(0, (b.seconds ?? 0) * 1e3);
  Object.assign(s, { status: "waiting_timer", waitingUntil: new Date(Date.now() + ms).toISOString(), pauseId: crypto.randomUUID() });
  log(s, "lifecycle", `Timer armed for ${s.waitingUntil}`);
  touch(x);
  x.timers.set(b.id, setTimeout(() => {
    x.timers.delete(b.id);
    if (x.cancelled) return;
    x.steps = 0;
    s.output = input;
    x.outputs.set(b.id, input);
    Object.assign(s, { status: "succeeded", completedAt: now2(), waitingUntil: void 0, pauseId: void 0 });
    log(s, "lifecycle", "Timer fired; starting followers");
    touch(x);
    track(x, followers(x, b, s, input, []).catch((e) => {
      x.flowFailed ?? (x.flowFailed = `${b.label}: ${errMsg(e)}`);
    }));
  }, ms));
}
async function ask(x, b, s, question) {
  const pauseId = crypto.randomUUID();
  Object.assign(s, { status: "awaiting_user_input", question, pauseId });
  log(s, "prompt", question);
  touch(x);
  return new Promise((resolve, reject) => x.answers.set(b.id, { pauseId, resolve, reject }));
}
function answer(x, blockId, pauseId, text) {
  const pending = x.answers.get(blockId);
  if (!pending || pending.pauseId !== pauseId) throw new Error("This question is no longer waiting for an answer");
  x.answers.delete(blockId);
  pending.resolve(String(text).slice(0, 1e5));
}
function track(x, p) {
  x.background.add(p);
  void p.catch(() => {
  }).finally(() => {
    x.background.delete(p);
    if (!x.driving) settle(x);
  });
  return p;
}
function pickProfile(x, b) {
  const ps = x.env.profiles;
  const p = b.profileId && ps.find((p2) => p2.id === b.profileId) || b.provider && ps.find((p2) => p2.provider === b.provider) || !b.profileId && !b.provider && (ps.find((p2) => p2.id === x.env.defaultProfileId) || ps[0]);
  if (!p) throw new Error(`No enabled AI provider for '${b.label}' on this machine${b.provider ? ` (${b.provider})` : ""}`);
  return p;
}
function toolCatalogue(x, b) {
  return toolTargets(x, b.id).map((t) => ({
    block_id: t.id,
    name: t.label,
    type: t.type,
    ...t.description ? { description: t.description } : {},
    invocation: t.type === "mcp" ? "provider_mcp_tools" : t.type === "task_controls" ? "workspace_task_tools" : "workflow_use_block",
    ...t.type === "mcp" ? {
      server_id: t.mcp?.serverId,
      server_name: x.env.mcpServers.find((m) => m.id === t.mcp?.serverId)?.name,
      usage: "Discover and call this server's tools through the provider MCP tools. workflow_use_block only describes the connection; it does not call the MCP server."
    } : {},
    ...t.type === "task_controls" ? { usage: "Use workspace tasks_list, tasks_create, tasks_start_agent and tasks_reconcile tools." } : {},
    ...t.type === "run_app" ? { actions: t.app?.actions?.length ? t.app.actions : ["start", "status", "kill", "tail"] } : {},
    ...t.type === "terminal_control" ? { actions: ["list", "read", "write"] } : {},
    ...t.type === "timer" ? { seconds: t.seconds } : {}
  }));
}
function instructions(x, b) {
  const tools = toolCatalogue(x, b);
  const paths = b.type === "chatbox" ? [] : x.def.edges.filter((e) => e.from === b.id && edgeType(e) === "path").map((e) => e.label);
  const caps = toolTargets(x, b.id).filter(isCapabilityBlock).map((t) => t.type);
  return [
    `You are the "${b.label}" block of the Hato workflow "${x.run.workflowName}". Each workflow block keeps its own session and context.`,
    tools.length ? `Connected workflow blocks and capabilities: ${JSON.stringify(tools)}.` : "No workflow blocks are connected to you as tools.",
    "Call workflow_connections to discover your connected blocks and their invocation methods before deciding which tools to use. Check the connected capabilities before claiming you lack access. Blocks with invocation workflow_use_block accept block_id and input; provider_mcp_tools means use that MCP server's advertised tools directly.",
    caps.includes("mcp") ? "Connected MCP servers are available capabilities. Identify them by server_name in workflow_connections, then inspect their advertised tool names and descriptions. If your provider loads tools lazily, use its tool discovery/search facility to find that server's tools. Use relevant tools for the user's request without requiring the user to name the server. If discovery or connection fails, report that specific error rather than claiming no MCP server is connected." : "",
    tools.length ? `For connected AI Agents and Chatboxes: omit action to run and wait, start launches in the background, status checks state, tail reads recent messages (lines 1–50) and steer sends input to a running session. A timed_out result means the block keeps working; check it with status or workflow_block_messages. Run App blocks take action start, status, kill or tail. Meetings automatically publish participant status changes (started activity, idle, permission wait, error or stop) as room messages. Use diff or wait to receive them without status polling. Publishing does not consume your unread cursor or invoke other agents. Meetings take publish (message), tail, diff, wait, status and shake (peer_block_id and an explicit message, required). Skill blocks return instructions to apply in your own session. Timers arm and return at once; when they fire, their follow connections receive the input you gave them. User Prompt and Yes/No Prompt blocks wait for the user's answer. action "fetch" returns output you have not seen yet. Use workflow_block_output to page through long outputs. Keep requests and reports concise.` : "",
    caps.includes("terminal_control") ? "Terminal Control: always call workflow_use_block with the connected Terminal Control block_id and action list, read or write. read/write take key; read accepts cursor; write takes text. These calls are logged on the block. Do not use direct workspace terminals_* tools. Reuse existing terminals; do not start agents in terminals." : "",
    caps.includes("task_controls") ? "Task controls: use the workspace tasks_list, tasks_create, tasks_start_agent and tasks_reconcile tools (they need the Hato desktop open)." : "",
    paths.length ? `Available paths: ${JSON.stringify(paths)}. Call workflow_choose_path with one of them before you finish; your final answer is passed to the chosen path.` : "",
    b.type === "chatbox" ? "You are a chat with the user. Use your connected tools when they help answer." : "Your final message is this block's output."
  ].filter(Boolean).join("\n");
}
async function agentCall(method, args, timeoutMs = 6e4) {
  return ctx.modules.call("agent-runner", method, args, { timeoutMs });
}
async function createSession(x, b) {
  const profile = pickProfile(x, b);
  if (b.reasoning && !(await agentCall("health", {}).catch(() => null))?.reasoning) throw new Error("Reasoning needs the updated agent runtime. Stop saved background agents before upgrading their runtime, then retry.");
  const targets = toolTargets(x, b.id);
  const extra = targets.filter((t) => t.type === "mcp").map((t) => x.env.mcpServers.find((m) => m.id === t.mcp?.serverId)).filter(Boolean).map((m) => {
    const prepared = x.env.mcpConfigs?.[m.id];
    if (prepared) return { id: m.id, ...prepared };
    if (transportOf(m) !== "stdio" && m.auth?.type === "oauth") throw new Error(`MCP server “${m.name}” needs fresh authorization. Start a new workflow run to reconnect it.`);
    return { id: m.id, ...acpServer(m) };
  });
  const endpoint = await issueEndpoint(ctx, { kind: "run", runId: x.run.id, blockId: b.id });
  const id = crypto.randomUUID();
  const spec = {
    id,
    name: `${x.run.workflowName} · ${b.label}`.slice(0, 120),
    workspaceId: x.env.workspaceId,
    workspaceName: x.env.workspaceName,
    root: x.env.root,
    machineId: x.env.machineId,
    profile,
    model: b.model || "",
    reasoning: b.reasoning || "",
    agentFile: b.agentFile || null,
    skills: [],
    mcps: [endpoint, ...extra],
    claudeSubscription: x.env.claudeSubscription,
    workspaceMcp: targets.some((t) => t.type === "task_controls") && !!x.env.daemon,
    daemon: x.env.daemon,
    autopilot: !!b.autopilot,
    workflow: { runId: x.run.id, blockId: b.id }
  };
  try {
    await agentCall("create", { spec }, 24e4);
  } catch (e) {
    await revokeWhere(ctx, (s) => s.kind === "run" && s.token === endpoint.env.find((v) => v.name === "HATO_MCP_TOKEN")?.value);
    throw e;
  }
  return id;
}
var seqOf = (m) => Number(String(m?.key || "").replace("agent-msg-", "")) || 0;
async function turn(x, s, text) {
  const id = s.sessionId;
  const before = await agentCall("view", { id, limit: 1 });
  const mark = Math.max(0, ...before.messages.map(seqOf));
  if (["busy", "waiting", "starting"].includes(before.session.status)) throw new Error("This block's agent is busy; use steer or wait for it to finish");
  await agentCall("send", { id, text }, 24e4);
  for (; ; ) {
    await sleep(800);
    if (x.cancelled) {
      await agentCall("cancel", { id }).catch(() => {
      });
      throw new Error("Workflow run was cancelled");
    }
    const v = await agentCall("view", { id, limit: 80 });
    const status = v.session.status;
    if (status === "waiting" && s.status !== "awaiting_permission") {
      s.status = "awaiting_permission";
      s.permissionId = v.permissions[0]?.id;
      touch(x);
    } else if (status !== "waiting" && s.status === "awaiting_permission") {
      s.status = "running";
      s.permissionId = void 0;
      touch(x);
    }
    const after = v.messages.filter((m) => seqOf(m) > mark);
    const failure = after.find((m) => m.role === "error");
    if (failure && status === "ready") throw new Error(failure.text || "The agent turn failed");
    if (["interrupted", "stopped", "error"].includes(status)) throw new Error(v.session.error || `Agent ${status}`);
    if (status === "ready" && after.some((m) => m.role === "system" && String(m.text).startsWith("Turn ended"))) {
      if (after.some((m) => m.role === "system" && /cancel/i.test(String(m.text)))) log(s, "lifecycle", "Turn was cancelled");
      const answer2 = [...after].reverse().find((m) => m.role === "assistant" && String(m.text || "").trim());
      return answer2 ? String(answer2.text).trim() : "";
    }
  }
}
async function agent(x, b, s, input) {
  const fresh = !s.sessionId;
  if (fresh) {
    s.sessionId = await createSession(x, b);
    touch(x);
  }
  const limit = x.def.settings?.promptLimitChars ?? 2e5;
  const clipped = preview(input, 2e4);
  let text;
  if (b.type === "chatbox") {
    const refs = [...new Set([...b.prompt.matchAll(/\{\{\s*blocks\.([A-Za-z0-9_-]+)\.output\s*\}\}/g)].map((m) => m[1]))];
    const updates = refs.length ? `

Workflow context updates:
${refs.map((r) => `${r}: ${preview(x.outputs.get(r) ?? "", 4e3)}`).join("\n")}` : "";
    text = fresh ? `${instructions(x, b)}

Session guidance:
${renderPrompt(b.prompt, "", x.outputs)}

User message:
${clipped}` : clipped + updates;
    s.chat = [...s.chat || [], { id: crypto.randomUUID(), role: "user", text: clipped, at: now2() }].slice(-200);
  } else {
    const template = /\{\{\s*input\s*\}\}/.test(b.prompt) ? b.prompt : `${b.prompt}

Input:
{{input}}`;
    const body = fresh || /\{\{/.test(b.prompt) ? renderPrompt(template, clipped, x.outputs) : clipped;
    text = fresh ? `${instructions(x, b)}

${body}` : body;
  }
  if (text.length > limit) text = preview(text, limit);
  s.prompt = preview(text, 2e4);
  log(s, "prompt", text);
  touch(x);
  const out = await turn(x, s, text);
  if (b.type === "chatbox") s.chat = [...s.chat || [], { id: crypto.randomUUID(), role: "assistant", text: out, at: now2() }].slice(-200);
  const paths = b.type === "chatbox" ? [] : x.def.edges.filter((e) => e.from === b.id && edgeType(e) === "path");
  if (paths.length && !s.selectedRoute) throw new Error(`${b.label} finished without choosing a path (workflow_choose_path)`);
  return out;
}
async function steer(x, id, text) {
  const s = stateOf(x, id);
  if (!s.sessionId) throw new Error("This block has no session yet; start it first");
  return agentCall("send", { id: s.sessionId, text: preview(text, 2e4), steer: true }, 6e4);
}
async function messages(x, id, count) {
  const s = stateOf(x, id);
  if (!s.sessionId) return { status: s.status, messages: [] };
  const v = await agentCall("view", { id: s.sessionId, limit: Math.min(Math.max(count, 1), 50) });
  return { status: s.status, agentStatus: v.session.status, messages: v.messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, title: m.title, text: preview(String(m.text || ""), 2e3) })) };
}
var STATUS_DESCRIPTIONS = {
  running: "started activity",
  succeeded: "is idle",
  failed: "stopped with an error",
  cancelled: "was stopped",
  awaiting_permission: "is waiting for permission",
  awaiting_user_input: "is waiting for input",
  waiting_timer: "is waiting for a timer",
  queued: "is queued"
};
function notifyMeeting(x, roomId) {
  for (const wake of [...x.meetingWaiters.get(roomId) || []]) wake();
}
function appendMeetingMessage(x, roomId, participantId, text, status) {
  const s = stateOf(x, roomId), m = meeting(s), author = block(x, participantId).label;
  m.messages.push({ seq: ++m.seq, blockId: participantId, author, text, at: now2(), ...status ? { kind: "status", participantStatus: status } : {} });
  if (m.messages.length > 1e3) m.messages.splice(0, m.messages.length - 1e3);
  const output = m.messages.map((msg) => `[${msg.seq}] ${msg.author}: ${msg.text}`).join("\n\n").slice(-outputLimit(x));
  s.output = output;
  x.outputs.set(roomId, output);
  if (status) log(s, "lifecycle", text);
  notifyMeeting(x, roomId);
  return m.seq;
}
function publishMeetingStatusChanges(x) {
  for (const participant of x.def.blocks.filter(isAgentBlock)) {
    const s = stateOf(x, participant.id), before = x.participantStatuses.get(participant.id);
    x.participantStatuses.set(participant.id, s.status);
    if (before === s.status || before === void 0 && s.status !== "running") continue;
    const description = STATUS_DESCRIPTIONS[s.status];
    if (!description) continue;
    for (const room of toolTargets(x, participant.id).filter((b) => b.type === "meeting")) {
      appendMeetingMessage(x, room.id, participant.id, `[Status] ${participant.label.slice(0, 200)} ${description}.`, s.status);
    }
  }
}
function meeting(s) {
  return s.meeting ?? (s.meeting = { seq: 0, messages: [], cursors: {} });
}
function meetingTail(s, lines) {
  const m = meeting(s);
  return { messages: m.messages.slice(-Math.min(Math.max(lines, 1), 50)), latestSequence: m.seq };
}
async function useMeeting(x, meetingId, caller, a) {
  const s = stateOf(x, meetingId), m = meeting(s), action = a.action || "diff";
  const lines = Math.min(Math.max(Number(a.lines) || 20, 1), 50);
  const diff = (status) => {
    const from = typeof a.after === "number" ? a.after : m.cursors[caller] ?? 0;
    const unread = m.messages.filter((msg) => msg.seq > from), page = unread.slice(0, lines);
    const cursor = page.length ? page[page.length - 1].seq : from;
    if (typeof a.after !== "number") m.cursors[caller] = Math.max(m.cursors[caller] ?? 0, cursor);
    touch(x);
    return { meeting: { ...status ? { status } : {}, messages: page, cursor, latestSequence: m.seq, hasMore: unread.length > page.length } };
  };
  if (action === "publish") {
    const text = String(a.message ?? a.input ?? "").slice(0, 1e4);
    if (!text.trim()) throw new Error("A meeting message is required");
    const published = appendMeetingMessage(x, meetingId, caller, text);
    touch(x);
    return { meeting: { published } };
  }
  if (action === "tail" || action === "fetch") return { meeting: meetingTail(s, lines) };
  if (action === "diff") return diff();
  if (action === "status") {
    const peers = x.def.edges.filter((e) => e.to === meetingId && edgeType(e) === "use").map((e) => block(x, e.from));
    return { meeting: { peers: peers.map((p) => ({ block_id: p.id, name: p.label, type: p.type, online: x.busy.has(p.id), block_status: stateOf(x, p.id).status, hasSession: !!stateOf(x, p.id).sessionId, self: p.id === caller })) } };
  }
  if (action === "wait") {
    const from = typeof a.after === "number" ? a.after : m.cursors[caller] ?? 0;
    if (m.messages.some((msg) => msg.seq > from)) return diff("updated");
    const timeout = Math.min(Math.max(Number(a.timeout_seconds) || 300, 1), 86400) * 1e3;
    const updated = await new Promise((resolve) => {
      const listeners = x.meetingWaiters.get(meetingId) || /* @__PURE__ */ new Set();
      x.meetingWaiters.set(meetingId, listeners);
      const done = (v) => {
        listeners.delete(wake);
        if (!listeners.size) x.meetingWaiters.delete(meetingId);
        clearTimeout(t);
        resolve(v);
      };
      const wake = () => done(true);
      const t = setTimeout(() => done(false), timeout);
      listeners.add(wake);
    });
    assertActive(x);
    return diff(updated ? "updated" : "timed_out");
  }
  if (action === "shake") {
    const peer = String(a.peer_block_id || "");
    if (!x.def.edges.some((e) => e.from === peer && e.to === meetingId && edgeType(e) === "use") || peer === caller) throw new Error("Shake a different agent connected to this meeting");
    const message = a.message ?? a.input;
    if (typeof message !== "string" || !message.trim() || message.length > 1e4) throw new Error("Meeting shake needs a specific message of 1 to 10000 characters");
    if (x.busy.has(peer)) {
      await steer(x, peer, message);
      return { meeting: { shake: { blockId: peer, delivery: "steered" } } };
    }
    track(x, invoke(x, peer, message, [], true).catch(() => {
    }));
    return { meeting: { shake: { blockId: peer, delivery: "started" } } };
  }
  throw new Error(`Unknown meeting action '${action}'`);
}
async function drive(x, entries) {
  x.driving = true;
  const maxMs = x.def.settings?.maxRunDurationMs ?? 24 * 36e5;
  x.deadline = setTimeout(() => {
    x.flowFailed ?? (x.flowFailed = "The workflow reached its maximum run duration");
    void cancel(x, "The workflow reached its maximum run duration");
  }, maxMs);
  x.deadline.unref?.();
  try {
    const roots = entries ?? defaultRoots(x);
    for (const id of roots) {
      try {
        await invoke(x, id, x.run.input);
      } catch (e) {
        if (x.cancelled) break;
        x.flowFailed ?? (x.flowFailed = errMsg(e));
        break;
      }
    }
    while (!x.cancelled && (x.timers.size || x.background.size)) {
      if (x.background.size) await Promise.race([Promise.allSettled([...x.background]), sleep(500)]);
      else await sleep(250);
    }
  } finally {
    x.driving = false;
    settle(x);
  }
}
function defaultRoots(x) {
  if (x.run.startBlockId) return [x.run.startBlockId];
  const starts = x.def.blocks.filter(isStartBlock);
  if (starts.length) return starts.map((b) => b.id);
  return x.def.blocks.filter((b) => !x.def.edges.some((e) => e.to === b.id) && !isCapabilityBlock(b) && !(b.type === "chatbox" && !x.run.input.trim()) && !["meeting", "skill"].includes(b.type)).map((b) => b.id);
}
function settle(x) {
  if (x.driving || x.busy.size || x.timers.size || x.background.size || x.answers.size) {
    touch(x);
    return;
  }
  if (x.deadline) clearTimeout(x.deadline);
  if (x.run.status === "running" || x.run.status === "waiting") {
    x.run.status = x.cancelled ? "cancelled" : x.flowFailed ? "failed" : "succeeded";
    x.run.error = x.cancelled ? x.run.error : x.flowFailed;
    x.run.completedAt = now2();
  }
  for (const s of x.run.blocks) if (s.status === "queued") s.status = "skipped";
  persist(x.run);
}
async function cancel(x, reason = "Cancelled by the user") {
  x.cancelled = true;
  for (const t of x.timers.values()) clearTimeout(t);
  x.timers.clear();
  for (const p of x.answers.values()) p.reject(new Error("Workflow run was cancelled"));
  x.answers.clear();
  for (const listeners of [...x.meetingWaiters.values()]) for (const wake of [...listeners]) wake();
  for (const h of x.procs) await ctx.host.process.terminate(h, "SIGKILL").catch(() => {
  });
  for (const s of x.run.blocks) {
    if (s.sessionId && (s.status === "running" || s.status === "awaiting_permission")) await agentCall("cancel", { id: s.sessionId }).catch(() => {
    });
    if (["running", "waiting_timer", "awaiting_user_input", "awaiting_permission", "queued"].includes(s.status)) {
      s.status = "cancelled";
      s.completedAt = now2();
    }
  }
  x.run.status = "cancelled";
  x.run.error = reason;
  x.run.completedAt = now2();
  touch(x);
}
function chat(x, blockId, text) {
  const b = block(x, blockId);
  if (b.type !== "chatbox") throw new Error("Only Chatbox blocks accept chat messages");
  if (x.cancelled) throw new Error("This run was cancelled; start a new run to chat");
  if (x.busy.has(blockId)) return steer(x, blockId, text).then(() => ({ steered: true }));
  if (x.run.status !== "running" && x.run.status !== "waiting") {
    x.run.status = "running";
    x.run.completedAt = void 0;
  }
  track(x, invoke(x, blockId, text, [], true));
  touch(x);
  return Promise.resolve({ accepted: true });
}

// modules/services/workflow-runner/src/terminal.ts
async function ctl(ctx2, env, op, args = {}) {
  if (!env.daemon) throw new Error("Terminal Control requires the workspace daemon");
  const grant = await ctx2.host.capabilities.request({ kind: "process", root: env.root });
  try {
    const r = await ctx2.host.process.run(grant.grant, {
      executable: env.daemon.bin,
      args: ["daemon", "ctl", "--dir", env.daemon.dir],
      cwd: env.root
    }, { stdin: JSON.stringify({ op, args }) + "\n", timeoutMs: 3e4 });
    if (r.code !== 0) throw new Error(r.stderr || "Daemon control failed");
    const result = JSON.parse(r.stdout);
    if (!result.ok) throw new Error(result.error?.message || "Daemon request failed");
    return result.value;
  } finally {
    await ctx2.host.capabilities.release(grant.grant);
  }
}
async function terminalAction(ctx2, env, action, a) {
  if (!["list", "read", "write"].includes(action)) throw new Error("Terminal Control actions: list, read, write");
  const list = await ctl(ctx2, env, "resources.list");
  const root = env.root.replace(/\/$/, "");
  const allowed = (list.ptys || []).filter((p) => p.cwd === env.root || p.cwd.startsWith(root + "/"));
  if (action === "list") return allowed;
  if (!allowed.some((p) => p.key === a.key)) throw new Error("Terminal is outside this workspace");
  return ctl(ctx2, env, action === "read" ? "pty.read" : "pty.write", {
    key: a.key,
    cursor: a.cursor,
    limitBytes: 65536,
    text: String(a.text ?? a.input ?? "")
  });
}

// modules/services/workflow-runner/src/index.ts
var db2;
var now3 = () => (/* @__PURE__ */ new Date()).toISOString();
var GATEWAY = /* @__PURE__ */ new Set(["daemon-client", "workflows"]);
var gateway = (meta) => {
  if (!GATEWAY.has(meta?.caller)) throw new Error("Only the Hato workflow gateway may call this method");
};
var ctxRef;
var dirty = /* @__PURE__ */ new Map();
var flushTimer = null;
function save(run) {
  dirty.set(run.id, run);
  if (!flushTimer) flushTimer = setTimeout(() => {
    void flush();
  }, 250);
}
async function flush() {
  flushTimer = null;
  const runs = [...dirty.values()];
  dirty.clear();
  for (const run of runs) await ctxRef.host.db.exec(db2, "UPDATE runs SET data=? WHERE id=?", [JSON.stringify(run), run.id]).catch((e) => ctxRef.log.error("workflow run save", errMsg(e)));
}
async function loadRun(id) {
  const r = (await ctxRef.host.db.query(db2, "SELECT data, env FROM runs WHERE id=?", [id]))[0];
  return r ? { run: dirty.get(id) || JSON.parse(r.data), env: JSON.parse(r.env) } : null;
}
async function execFor(id) {
  const live = execs.get(id);
  if (live) return live;
  const stored = await loadRun(id);
  if (!stored) throw new Error("Workflow run not found");
  return execs.get(id) || newExec(stored.run, stored.env);
}
async function definition(projectId, id) {
  const r = (await ctxRef.host.db.query(db2, "SELECT data, revision FROM definitions WHERE id=? AND project=?", [id, projectId]))[0];
  if (!r) throw new Error(`Workflow '${id}' not found`);
  return { definition: JSON.parse(r.data), revision: Number(r.revision) };
}
async function saveDefinition(projectId, raw, expected, available) {
  const def = normalizeDefinition(raw);
  const current = (await ctxRef.host.db.query(db2, "SELECT revision, data, project FROM definitions WHERE id=?", [def.id]))[0];
  if (current && current.project !== projectId) throw new Error("This workflow id belongs to another project; choose a new id");
  if (expected === null && current) throw new Error(`Workflow '${def.id}' already exists (revision ${current.revision}); read it and pass its revision`);
  if (typeof expected === "number" && (!current || Number(current.revision) !== expected)) throw new Error(`Revision conflict: workflow '${def.id}' is at revision ${current ? current.revision : "none"}; reload and reconcile`);
  if (current) {
    const prev = JSON.parse(current.data);
    def.createdAt = prev.createdAt || def.createdAt;
    def.version = (prev.version || 1) + 1;
  }
  const revision = current ? Number(current.revision) + 1 : 1;
  await ctxRef.host.db.exec(
    db2,
    "INSERT INTO definitions(id,project,revision,data) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, data=excluded.data",
    [def.id, projectId, revision, JSON.stringify(def)]
  );
  return { id: def.id, revision, definition: def, issues: validateWorkflow(def, available) };
}
async function listDefinitions(projectId) {
  const rows = await ctxRef.host.db.query(db2, "SELECT data, revision FROM definitions WHERE project=? ORDER BY id", [projectId]);
  return rows.map((r) => {
    const d = JSON.parse(r.data);
    return { id: d.id, name: d.name, description: d.description, revision: Number(r.revision), updatedAt: d.updatedAt, blocks: d.blocks.length };
  }).sort((a, b) => a.name.localeCompare(b.name));
}
var summary = (run) => ({ id: run.id, workflowId: run.workflowId, workflowName: run.workflowName, status: run.status, createdAt: run.createdAt, completedAt: run.completedAt, error: run.error, input: preview(run.input, 300) });
function detail(run) {
  return { ...run, blocks: run.blocks.map((s) => ({ ...s, output: s.output === void 0 ? void 0 : preview(s.output, 16e3), outputChars: s.output?.length ?? 0, prompt: s.prompt === void 0 ? void 0 : preview(s.prompt, 8e3), log: s.log.slice(-40), chat: s.chat?.slice(-60), meeting: s.meeting ? { ...s.meeting, messages: s.meeting.messages.slice(-60) } : void 0 })) };
}
var object = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
var RUN_TOOLS = [
  { name: "workflow_connections", description: "Discover connected workflow blocks and capabilities, including MCP server names, invocation methods, and allowed actions. Call before choosing tools or claiming a capability is unavailable.", inputSchema: object({}) },
  {
    name: "workflow_use_block",
    description: "Run or control a connected workflow block. Pass block_id and input; action selects start/status/tail/steer (AI Agent, Chatbox), start/status/kill/tail (Run App), publish/tail/diff/wait/status/shake (Meeting; shake requires peer_block_id and a specific message), list/read/write (Terminal Control, key/cursor/text), or fetch (unseen output of any data block).",
    inputSchema: object({ block_id: { type: "string" }, input: { type: "string" }, action: { type: "string" }, lines: { type: "number" }, timeout_seconds: { type: "number" }, message: { type: "string" }, peer_block_id: { type: "string" }, key: { type: "string" }, cursor: { type: "number" }, text: { type: "string" }, after: { type: "number" } }, ["block_id"])
  },
  { name: "workflow_block_output", description: "Read retained output of a connected block in pages without running it.", inputSchema: object({ block_id: { type: "string" }, offset: { type: "number" }, limit: { type: "number" } }, ["block_id"]) },
  { name: "workflow_block_messages", description: "Read recent messages of a connected AI Agent or Chatbox without starting a turn.", inputSchema: object({ block_id: { type: "string" }, count: { type: "number" } }, ["block_id"]) },
  { name: "workflow_choose_path", description: "Choose the outgoing path your output is passed to. Call before finishing when paths are available.", inputSchema: object({ path: { type: "string" } }, ["path"]) }
];
var CONFIG_TOOLS = [
  { name: "workflows_reference", description: "Read the workflow format reference: block types, connections, templates and tools.", inputSchema: object({}) },
  { name: "workflows_list", description: "List this project's workflows with their revisions.", inputSchema: object({}) },
  { name: "workflows_read", description: 'Read a workflow definition and its revision. Use id "new" for a starter definition, or template_id to start from a template.', inputSchema: object({ id: { type: "string" }, template_id: { type: "string" } }, ["id"]) },
  {
    name: "workflows_write",
    description: "Create or replace a workflow. content is the complete JSON definition (string or object). expected_revision is the revision you read, or null to create. Returns the revision and validation issues. Never starts a run.",
    inputSchema: object({ content: {}, expected_revision: { type: ["number", "null"] } }, ["content", "expected_revision"])
  },
  { name: "workflows_validate", description: "Validate a workflow definition without saving it.", inputSchema: object({ content: {} }, ["content"]) }
];
var parseContent = (c) => {
  if (typeof c !== "string") return c;
  try {
    return JSON.parse(c);
  } catch (e) {
    throw new Error(`content is not valid JSON: ${errMsg(e)}`);
  }
};
function starter(templateId) {
  const t = WORKFLOW_TEMPLATES.find((t2) => t2.id === (templateId || "blank"));
  if (!t) throw new Error(`Unknown template; use one of ${WORKFLOW_TEMPLATES.map((t2) => t2.id).join(", ")}`);
  return normalizeDefinition({ id: `workflow-${crypto.randomUUID().slice(0, 8)}`, name: t.id === "blank" ? "New workflow" : t.name, ...t.graph() });
}
async function configTool(s, name, a) {
  const available = { profiles: s.profiles, mcps: s.mcps };
  if (name === "workflows_reference") return WORKFLOW_REFERENCE + `

Templates: ${WORKFLOW_TEMPLATES.map((t) => `${t.id} (${t.description})`).join("; ")}.
Providers on this machine: ${JSON.stringify(s.profiles)}.`;
  if (name === "workflows_list") return listDefinitions(s.projectId);
  if (name === "workflows_read") {
    if (a.id === "new") return { revision: null, definition: starter(a.template_id) };
    const d = await definition(s.projectId, String(a.id));
    return { ...d, issues: validateWorkflow(d.definition, available) };
  }
  if (name === "workflows_validate") return { issues: validateWorkflow(normalizeDefinition(parseContent(a.content)), available) };
  if (name === "workflows_write") {
    const r = await saveDefinition(s.projectId, parseContent(a.content), a.expected_revision === null ? null : Number(a.expected_revision), available);
    ctxRef.events.emit("workflow-runner.changed", { projectId: s.projectId, workflowId: r.id });
    return { id: r.id, revision: r.revision, issues: r.issues };
  }
  throw new Error("Unknown configuration tool");
}
async function runTool(s, name, a) {
  if (!["workflow_use_block", "workflow_block_output", "workflow_block_messages"].includes(name)) return runToolBody(s, name, a);
  const x = await execFor(s.runId);
  const target = toolTargets(x, s.blockId).find((t) => t.id === String(a.block_id || ""));
  if (!target) return runToolBody(s, name, a);
  const edge = x.def.edges.find((e) => e.from === s.blockId && e.to === target.id && edgeType(e) === "use") || x.def.edges.find((e) => e.from === s.blockId && e.to === target.id);
  if (!edge) return runToolBody(s, name, a);
  const action = `${name}:${a.action || "call"}`;
  const callId = transfer(x, edge.id, "send", a, void 0, action);
  const logTarget = (kind, value) => {
    const st = stateOf(x, target.id);
    const text = typeof value === "string" ? value : JSON.stringify(value);
    st.log.push({ at: now3(), kind, text: `${s.blockId} · ${action} · ${callId}
${preview(text || "", 4e3)}` });
    if (st.log.length > 200) st.log.splice(0, st.log.length - 200);
    touch(x);
  };
  logTarget("tool", a);
  try {
    const result = await runToolBody(s, name, a);
    logTarget("response", result);
    transfer(x, edge.id, "return", result, callId, action);
    return result;
  } catch (error) {
    logTarget("error", errMsg(error));
    transfer(x, edge.id, "return", errMsg(error), callId, action, true);
    throw error;
  }
}
async function runToolBody(s, name, a) {
  const x = await execFor(s.runId), caller = s.blockId;
  const targets = toolTargets(x, caller);
  const target = () => {
    const t2 = targets.find((t3) => t3.id === String(a.block_id || ""));
    if (!t2) throw new Error(`Block '${a.block_id}' is not connected to you; call workflow_connections`);
    return t2;
  };
  const record = (text) => {
    const st = stateOf(x, caller);
    st.log.push({ at: now3(), kind: "tool", text: text.slice(0, 500) });
    if (st.log.length > 200) st.log.shift();
  };
  if (name === "workflow_connections") return toolCatalogue(x, x.def.blocks.find((b) => b.id === caller)).map((t2) => ({ ...t2, status: stateOf(x, t2.block_id).status }));
  if (name === "workflow_choose_path") {
    const paths = x.def.edges.filter((e) => e.from === caller && edgeType(e) === "path").map((e) => e.label);
    if (!paths.includes(String(a.path))) throw new Error(`Unknown path; choose one of ${JSON.stringify(paths)}`);
    stateOf(x, caller).selectedRoute = String(a.path);
    record(`chose path ${a.path}`);
    touch(x);
    return { selected: a.path };
  }
  if (name === "workflow_block_output") {
    const t2 = target(), out = x.outputs.get(t2.id) ?? "";
    const offset = Math.max(0, Number(a.offset) || 0), limit = Math.min(Math.max(Number(a.limit) || 8e3, 1), 8e3);
    const text = out.slice(offset, offset + limit);
    return { block_id: t2.id, offset, text, total: out.length, ...offset + text.length < out.length ? { nextOffset: offset + text.length } : {} };
  }
  if (name === "workflow_block_messages") {
    const t2 = target();
    if (!isAgentBlock(t2)) throw new Error("Only AI Agent and Chatbox blocks have messages");
    return messages(x, t2.id, Number(a.count) || 6);
  }
  if (name !== "workflow_use_block") throw new Error("Unknown workflow tool");
  const t = target(), action = typeof a.action === "string" && a.action ? a.action : void 0;
  const input = String(a.input ?? a.message ?? "");
  record(`${action || "use"} ${t.label}`);
  if (action === "fetch") {
    if (t.type === "mcp") return toolCatalogue(x, x.def.blocks.find((b) => b.id === caller)).find((entry) => entry.block_id === t.id);
    if (t.type === "meeting") return useMeeting(x, t.id, caller, { action: "diff" });
    const k = `${caller}>${t.id}`, out = x.outputs.get(t.id) ?? "", seen = x.fetched.get(k) ?? 0;
    const from = seen > out.length ? 0 : seen, text = out.slice(from, from + 8e3);
    x.fetched.set(k, from + text.length);
    return text ? { text, hasMore: from + text.length < out.length } : { unchanged: true };
  }
  if (t.type === "mcp") return toolCatalogue(x, x.def.blocks.find((b) => b.id === caller)).find((entry) => entry.block_id === t.id);
  if (t.type === "meeting") return useMeeting(x, t.id, caller, { ...a, action: action || "diff" });
  if (t.type === "terminal_control") {
    const value = await terminalAction(ctxRef, x.env, action || "list", a);
    const st = stateOf(x, t.id);
    st.output = JSON.stringify(value);
    st.runs++;
    st.status = "succeeded";
    touch(x);
    return value;
  }
  if (isCapabilityBlock(t)) return { note: `${t.label} is not callable: it adds tools to your session.` };
  if (t.type === "run_app") {
    const allowed = t.app?.actions?.length ? t.app.actions : ["start", "status", "kill", "tail"];
    const act = action || t.app?.action || "start";
    if (!allowed.includes(act)) throw new Error(`Run App '${t.label}' allows ${allowed.join(", ")}`);
    const app = await appAction(ctxRef, x.env.root, t.app.name, t.command || "", act, Math.min(Math.max(Number(a.lines) || t.app?.lines || 100, 1), 1e4));
    const st = stateOf(x, t.id);
    st.output = JSON.stringify(app);
    x.outputs.set(t.id, st.output);
    st.status = "succeeded";
    st.runs++;
    touch(x);
    return { app };
  }
  const edge = x.def.edges.find((e) => e.from === caller && e.to === t.id);
  const timeoutMs = Math.min(Math.max((Number(a.timeout_seconds) || (edge?.timeoutMs ?? 3e5) / 1e3) * 1e3, 1e3), 864e5);
  if (isAgentBlock(t)) {
    const st = stateOf(x, t.id);
    if (action === "status") return { status: st.status, hasSession: !!st.sessionId, output: st.output === void 0 ? void 0 : preview(st.output, 4e3), error: st.error };
    if (action === "tail") return messages(x, t.id, Math.min(Math.max(Number(a.lines) || 6, 1), 50));
    if (action === "steer" && x.busy.has(t.id)) return steer(x, t.id, input);
    if (action === "start" || action === "steer") {
      track(x, invoke(x, t.id, input, [caller], true));
      return { status: "started" };
    }
  }
  if (t.type === "user_prompt" || t.type === "yes_no_prompt") return { answer: await invoke(x, t.id, input, [caller], true) };
  const run = invoke(x, t.id, input, [caller], true);
  let timer;
  const outcome = await Promise.race([run.then((output) => ({ output })), new Promise((r) => {
    timer = setTimeout(() => r({ timedOut: true }), timeoutMs);
  })]).finally(() => clearTimeout(timer));
  if ("timedOut" in outcome) {
    track(x, run);
    return { status: "timed_out", note: "The block keeps working; check it with action status or workflow_block_messages." };
  }
  return { status: "succeeded", output: preview(outcome.output, 2e4) };
}
var mod = {
  id: "workflow-runner",
  moduleApiVersion: 1,
  async activate(ctx2) {
    ctxRef = ctx2;
    db2 = await ctx2.host.db.openNamespace("workflow-runner");
    await ctx2.host.db.exec(db2, "CREATE TABLE IF NOT EXISTS definitions(id TEXT PRIMARY KEY, project TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL); CREATE INDEX IF NOT EXISTS definitions_project ON definitions(project); CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, project TEXT NOT NULL, workflow TEXT NOT NULL, created TEXT NOT NULL, data TEXT NOT NULL, env TEXT NOT NULL); CREATE INDEX IF NOT EXISTS runs_workflow ON runs(project, workflow, created)");
    initEngine(ctx2, save);
    ctx2.events.on("agent-runner.toolActivity", async (event) => {
      if (!event.workflow?.runId || !event.workflow?.blockId) return;
      try {
        recordMcpActivity(await execFor(event.workflow.runId), event.workflow.blockId, event.sessionId, event.update);
      } catch (e) {
        ctx2.log.warn("MCP activity trace", errMsg(e));
      }
    });
    await initMcp(ctx2, db2, {
      list: (s) => s.kind === "run" ? RUN_TOOLS : CONFIG_TOOLS,
      call: (s, name, args) => s.kind === "run" ? runTool(s, name, args) : configTool(s, name, args)
    });
    for (const r of await ctx2.host.db.query(db2, "SELECT id, data FROM runs")) {
      const run = JSON.parse(r.data);
      if (run.status !== "running" && run.status !== "waiting") continue;
      run.status = "failed";
      run.error = "Interrupted: the workflow runtime restarted. Sessions and outputs remain for inspection.";
      run.completedAt = now3();
      for (const s of run.blocks) if (["running", "waiting_timer", "awaiting_user_input", "awaiting_permission", "queued"].includes(s.status)) {
        s.status = "failed";
        s.error = "Interrupted by a runtime restart";
      }
      await ctx2.host.db.exec(db2, "UPDATE runs SET data=? WHERE id=?", [JSON.stringify(run), run.id]);
    }
  },
  canSwap: () => {
    const active = [...execs.values()].filter((x) => x.driving || x.busy.size || x.timers.size || x.answers.size || x.background.size).length;
    return { ok: active === 0 && runningApps() === 0, reason: "Workflow runs or Run App processes are active" };
  },
  async deactivate(ctx2) {
    if (flushTimer) clearTimeout(flushTimer);
    await flush();
  },
  methods: {
    health: () => ({ ok: true, version: WORKFLOW_RUNNER_VERSION, active: [...execs.values()].filter((x) => x.driving || x.busy.size || x.timers.size || x.answers.size).length, apps: runningApps() }),
    async list(_ctx, a) {
      return listDefinitions(String(a.projectId));
    },
    async get(_ctx, a) {
      return definition(String(a.projectId), String(a.id));
    },
    async save(_ctx, a, meta) {
      gateway(meta);
      return saveDefinition(String(a.projectId), a.definition, a.expectedRevision === void 0 ? void 0 : a.expectedRevision, a.available);
    },
    async remove(ctx2, a, meta) {
      gateway(meta);
      const active = [...execs.values()].some((x) => x.run.workflowId === a.id && x.run.projectId === a.projectId && (x.driving || x.busy.size));
      if (active) throw new Error("Cancel this workflow's active runs before deleting it");
      await ctx2.host.db.exec(db2, "DELETE FROM definitions WHERE id=? AND project=?", [String(a.id), String(a.projectId)]);
      return null;
    },
    templates: () => WORKFLOW_TEMPLATES.map((t) => ({ id: t.id, name: t.name, description: t.description })),
    starter: (_ctx, a) => starter(a.templateId),
    async start(ctx2, a, meta) {
      gateway(meta);
      const env = a.env;
      if (!env?.root?.startsWith("/") || !env.workspaceId || !Array.isArray(env.profiles)) throw new Error("Invalid workflow run environment");
      const { definition: def } = await definition(String(a.projectId), String(a.workflowId));
      const issues = blockingIssues(validateWorkflow(def, { profiles: env.profiles, mcps: env.mcpServers }));
      if (issues.length) throw new Error(`Fix the workflow first: ${issues.slice(0, 3).map((i) => i.message).join("; ")}`);
      if (a.startBlockId && !def.blocks.some((b) => b.id === a.startBlockId)) throw new Error("Unknown start block");
      const run = {
        id: crypto.randomUUID(),
        workflowId: def.id,
        workflowName: def.name,
        projectId: String(a.projectId),
        workspaceId: env.workspaceId,
        status: "running",
        input: String(a.input ?? "").slice(0, 2e5),
        ...a.startBlockId ? { startBlockId: String(a.startBlockId) } : {},
        createdAt: now3(),
        definition: def,
        blocks: def.blocks.map((b) => ({ blockId: b.id, status: "idle", runs: 0, log: [] }))
      };
      await ctx2.host.db.exec(db2, "INSERT INTO runs(id,project,workflow,created,data,env) VALUES(?,?,?,?,?,?)", [run.id, run.projectId, run.workflowId, run.createdAt, JSON.stringify(run), JSON.stringify(env)]);
      const old = await ctx2.host.db.query(db2, "SELECT id FROM runs WHERE project=? AND workflow=? ORDER BY created DESC LIMIT -1 OFFSET 30", [run.projectId, run.workflowId]);
      for (const r of old) if (!execs.get(r.id)?.driving) {
        execs.delete(r.id);
        await ctx2.host.db.exec(db2, "DELETE FROM runs WHERE id=?", [r.id]);
        await revokeWhere(ctx2, (s) => s.kind === "run" && s.runId === r.id);
      }
      const x = newExec(run, env);
      void drive(x).catch((e) => ctx2.log.error("workflow drive", errMsg(e)));
      return summary(run);
    },
    async runs(ctx2, a) {
      const rows = a.workflowId ? await ctx2.host.db.query(db2, "SELECT data FROM runs WHERE project=? AND workflow=? ORDER BY created DESC LIMIT 30", [String(a.projectId), String(a.workflowId)]) : await ctx2.host.db.query(db2, "SELECT data FROM runs WHERE project=? ORDER BY created DESC LIMIT 50", [String(a.projectId)]);
      return rows.map((r) => {
        const run = JSON.parse(r.data);
        return summary(execs.get(run.id)?.run || dirty.get(run.id) || run);
      });
    },
    async run(_ctx, a) {
      const live = execs.get(String(a.id))?.run;
      if (live) return detail(live);
      const stored = await loadRun(String(a.id));
      if (!stored) throw new Error("Workflow run not found");
      return detail(stored.run);
    },
    async blockOutput(_ctx, a) {
      const x = await execFor(String(a.runId)), out = stateOf(x, String(a.blockId)).output ?? "";
      const offset = Math.max(0, Number(a.offset) || 0), limit = Math.min(Math.max(Number(a.limit) || 64e3, 1), 2e5);
      return { text: out.slice(offset, offset + limit), total: out.length };
    },
    async cancel(_ctx, a, meta) {
      gateway(meta);
      const x = await execFor(String(a.id));
      await cancel(x);
      return summary(x.run);
    },
    async answer(_ctx, a, meta) {
      gateway(meta);
      const x = await execFor(String(a.runId));
      answer(x, String(a.blockId), String(a.pauseId), String(a.answer ?? ""));
      return null;
    },
    async chat(_ctx, a, meta) {
      gateway(meta);
      const text = String(a.text || "").trim();
      if (!text) throw new Error("Message is empty");
      return chat(await execFor(String(a.runId)), String(a.blockId), text);
    },
    /** Delete a finished run; returns its agent session ids for the gateway to remove. */
    async removeRun(ctx2, a, meta) {
      gateway(meta);
      const x = execs.get(String(a.id));
      if (x && (x.driving || x.busy.size || x.timers.size || x.answers.size || x.background.size)) throw new Error("Cancel the run before deleting it");
      const stored = await loadRun(String(a.id));
      if (!stored) return { sessions: [] };
      execs.delete(String(a.id));
      dirty.delete(String(a.id));
      await ctx2.host.db.exec(db2, "DELETE FROM runs WHERE id=?", [String(a.id)]);
      await revokeWhere(ctx2, (s) => s.kind === "run" && s.runId === a.id);
      return { sessions: stored.run.blocks.map((s) => s.sessionId).filter(Boolean) };
    },
    apps: (_ctx, a) => listApps(String(a.root)),
    async appAction(ctx2, a, meta) {
      gateway(meta);
      return appAction(ctx2, String(a.root), String(a.name), "", String(a.action), Number(a.lines) || 200);
    },
    /** Workflow MCP endpoint for a configurator agent created by the gateway. */
    async configEndpoint(ctx2, a, meta) {
      gateway(meta);
      return issueEndpoint(ctx2, { kind: "config", projectId: String(a.projectId), sessionId: String(a.sessionId), profiles: (a.profiles || []).map((p) => ({ id: String(p.id), provider: p.provider })), mcps: (a.mcps || []).map((m) => ({ id: String(m.id) })) });
    },
    async revokeConfig(ctx2, a, meta) {
      gateway(meta);
      await revokeWhere(ctx2, (s) => s.kind === "config" && s.sessionId === a.sessionId);
      return null;
    },
    async shutdownApps(ctx2, _a, meta) {
      gateway(meta);
      await killAllApps(ctx2);
      return null;
    }
  }
};
var index_default = mod;
export {
  index_default as default
};
