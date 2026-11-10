// ../sdk/runtime.ts
function errMsg(e) {
  return e && (e.message || String(e)) || "unknown error";
}

// ../sdk/workflows.ts
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
    const edge2 = { id: clip(e?.id, 120) || `edge-${i + 1}`, from: clip(e?.from, 80), to: clip(e?.to, 80) };
    if (["follow", "use", "path"].includes(e?.type)) edge2.type = e.type;
    if (typeof e?.label === "string" && e.label) edge2.label = clip(e.label, 80);
    if (e?.loop === true) edge2.loop = true;
    if (num(e?.timeoutMs)) edge2.timeoutMs = num(e.timeoutMs);
    return edge2;
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
var newBlockId = (def, type) => {
  const base = type.replace(/_/g, "-");
  for (let i = 1; ; i++) if (!def.blocks.some((b) => b.id === `${base}-${i}`)) return `${base}-${i}`;
};
var newEdgeId = (def, from, to) => {
  const base = `${from}-${to}`.slice(0, 100);
  if (!def.edges.some((e) => e.id === base)) return base;
  for (let i = 2; ; i++) if (!def.edges.some((e) => e.id === `${base}-${i}`)) return `${base}-${i}`;
};
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

// modules/ui/workflows-panel/src/style.ts
var svg = (paths) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
var CARD = { width: 228, height: 88, grid: 24, snap: 12 };
var blockColor = {
  start_button: "#2f9e5b",
  start_input: "#2f9e5b",
  ai: "#7c6cf0",
  chatbox: "#4f8fde",
  skill: "#d08b2c",
  text: "#6f8f5f",
  markdown: "#6f8f5f",
  script: "#c0603f",
  run_app: "#c0603f",
  timer: "#8a8f99",
  user_prompt: "#c99a12",
  yes_no_prompt: "#c99a12",
  meeting: "#3aa98e",
  terminal_control: "#7d7d7d",
  task_controls: "#7d7d7d",
  mcp: "#7d7d7d"
};
var blockIcon = {
  start_button: svg("<polygon points='7 4 20 12 7 20 7 4'/>"),
  start_input: svg("<polygon points='5 4 15 12 5 20 5 4'/><path d='M18 6v12'/>"),
  ai: svg("<rect x='4' y='7' width='16' height='12' rx='3'/><path d='M12 3v4M9 12h.01M15 12h.01M9 16h6'/>"),
  chatbox: svg("<path d='M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'/>"),
  skill: svg("<path d='M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z'/><path d='M8 7h8M8 11h6'/>"),
  text: svg("<path d='M4 6h16M4 12h16M4 18h10'/>"),
  markdown: svg("<rect x='3' y='5' width='18' height='14' rx='2'/><path d='M7 15V9l2.5 3L12 9v6M16 9v6M14 13l2 2 2-2'/>"),
  script: svg("<polyline points='4 17 10 11 4 5'/><line x1='12' y1='19' x2='20' y2='19'/>"),
  run_app: svg("<rect x='3' y='4' width='18' height='16' rx='2'/><path d='M3 9h18M9 14l2 2 4-4'/>"),
  timer: svg("<circle cx='12' cy='13' r='8'/><path d='M12 9v4l2 2M9 2h6'/>"),
  user_prompt: svg("<circle cx='12' cy='12' r='9'/><path d='M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01'/>"),
  yes_no_prompt: svg("<path d='M20 6 9 17l-5-5'/>"),
  meeting: svg("<circle cx='9' cy='8' r='3'/><circle cx='17' cy='9' r='2.5'/><path d='M3 20a6 6 0 0 1 12 0M14.5 15a5 5 0 0 1 6.5 5'/>"),
  terminal_control: svg("<rect x='3' y='4' width='18' height='16' rx='2'/><path d='m7 9 3 3-3 3M13 15h4'/>"),
  task_controls: svg("<circle cx='6' cy='6' r='2'/><circle cx='18' cy='18' r='2'/><path d='M6 8v6a4 4 0 0 0 4 4h6M18 16V6'/>"),
  mcp: svg("<path d='M9 3v4m6-4v4M7 7h10v4a5 5 0 0 1-10 0V7Zm5 9v5'/>"),
  workflow: svg("<rect x='3' y='3' width='6' height='6' rx='1'/><rect x='15' y='15' width='6' height='6' rx='1'/><rect x='15' y='3' width='6' height='6' rx='1'/><path d='M9 6h6M18 9v6M6 9v6a3 3 0 0 0 3 3h6'/>"),
  play: svg("<polygon points='6 4 20 12 6 20 6 4'/>"),
  stop: svg("<rect x='6' y='6' width='12' height='12' rx='1'/>"),
  save: svg("<path d='M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z'/><path d='M17 21v-8H7v8M7 3v5h8'/>"),
  undo: svg("<path d='M9 14 4 9l5-5'/><path d='M4 9h10a6 6 0 0 1 0 12h-3'/>"),
  redo: svg("<path d='m15 14 5-5-5-5'/><path d='M20 9H10a6 6 0 0 0 0 12h3'/>"),
  window: svg("<rect x='3' y='4' width='18' height='16' rx='2'/><path d='M3 9h18'/>"),
  sparkles: svg("<path d='M12 3l1.8 4.7L18 9l-4.2 1.3L12 15l-1.8-4.7L6 9l4.2-1.3z'/><path d='M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z'/>"),
  "chevron-down": svg("<path d='m6 9 6 6 6-6'/>"),
  "chevron-up": svg("<path d='m18 15-6-6-6 6'/>"),
  maximize: svg("<path d='M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7'/>"),
  minimize: svg("<path d='M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7'/>"),
  rerun: svg("<path d='M3 12a9 9 0 1 0 3-6.7L3 8'/><path d='M3 3v5h5'/>"),
  "circle-play": svg("<circle cx='12' cy='12' r='9'/><polygon points='10 8 16 12 10 16 10 8'/>"),
  edit: svg("<path d='M12 20h9'/><path d='M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z'/>"),
  copy: svg("<rect x='9' y='9' width='12' height='12' rx='2'/><path d='M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1'/>"),
  chat: svg("<path d='M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'/>")
};
var edgeStyle = {
  follow: { color: "muted", dashed: false, fromSide: "right", toSide: "left", name: "Follow" },
  use: { color: "#4f8fde", dashed: true, fromSide: "bottom", toSide: "top", name: "Use" },
  path: { color: "#c99a12", dashed: false, fromSide: "right", toSide: "left", name: "Path" }
};
var statusColor = (s) => s === "succeeded" ? "success" : s === "failed" ? "danger" : s === "running" ? "primary" : s === "cancelled" || s === "skipped" ? "muted" : s === "awaiting_user_input" || s === "awaiting_permission" || s === "waiting" ? "warning" : s === "waiting_timer" ? "info" : "muted";
var statusText = {
  idle: "idle",
  queued: "queued",
  running: "running",
  succeeded: "done",
  failed: "failed",
  cancelled: "cancelled",
  skipped: "skipped",
  waiting_timer: "timer",
  awaiting_user_input: "needs answer",
  awaiting_permission: "needs approval",
  waiting: "waiting"
};

// modules/ui/workflows-panel/src/state.ts
var S = {
  ws: null,
  catalog: null,
  list: [],
  visible: false,
  epoch: 0,
  // library
  filter: "",
  newTemplate: "blank",
  defs: /* @__PURE__ */ new Map(),
  recent: [],
  details: /* @__PURE__ */ new Map(),
  open: /* @__PURE__ */ new Set(),
  maximized: null,
  cardRun: /* @__PURE__ */ new Map(),
  cardBlock: /* @__PURE__ */ new Map(),
  logOpen: /* @__PURE__ */ new Set(),
  chatHistory: /* @__PURE__ */ new Map(),
  starting: null,
  quick: null,
  startText: /* @__PURE__ */ new Map(),
  chatDrafts: /* @__PURE__ */ new Map(),
  answers: /* @__PURE__ */ new Map(),
  providerChoices: /* @__PURE__ */ new Map(),
  providerLoading: /* @__PURE__ */ new Set(),
  providerErrors: /* @__PURE__ */ new Map(),
  // designer
  selectedId: null,
  draft: null,
  revision: null,
  dirty: false,
  issues: [],
  undo: [],
  redo: [],
  lastSnapshot: { at: 0, field: "" },
  selection: null,
  mode: "follow",
  designerOpen: false,
  designerInline: false,
  designerSize: { width: 1280, height: 820 },
  askText: "",
  // chrome
  importText: "",
  importOpen: false,
  error: null,
  notice: null,
  busy: false,
  confirm: null
};
async function call(ctx, method, args = {}, timeoutMs = 24e4) {
  const epoch = S.epoch;
  const result = await ctx.modules.call("workflows", method, { workspaceId: S.ws?.id, ...args }, { timeoutMs });
  if (epoch !== S.epoch) throw new Error("Workflow workspace changed");
  return result;
}
var ACTIVE = /* @__PURE__ */ new Set(["running", "waiting"]);
var runsOf = (wf) => S.recent.filter((r) => r.workflowId === wf);
var latestRun = (wf) => runsOf(wf)[0];
function shownRunId(wf) {
  const chosen = S.cardRun.get(wf);
  return chosen && S.recent.some((r) => r.id === chosen) ? chosen : latestRun(wf)?.id;
}
var shownRun = (wf) => {
  const id = shownRunId(wf);
  return id ? S.details.get(id) : void 0;
};
var text = (key, value, extra = {}) => ({ type: "label", key, text: value, size: "sm", wrap: true, ...extra });
var muted = (key, value, extra = {}) => text(key, value, { color: "muted", size: "xs", ...extra });
var btn = (key, label, action, extra = {}) => ({ type: "button", key, text: label, action, small: true, ...extra });
var icon = (key, svgIcon, action, tooltip, extra = {}) => ({ type: "button", key, text: "", iconSvg: svgIcon, iconSize: 15, action, small: true, variant: "ghost", tooltip, ...extra });
var field = (key, title, node) => ({ type: "column", key, gap: 3, children: [{ type: "label", key: "t", text: title, size: "xs", color: "muted", weight: "medium" }, node] });
var input = (key, value, action, extra = {}) => ({ type: "textInput", key, value: value === void 0 ? "" : String(value), changeAction: action, ...extra });
var card = (key, children, extra = {}) => ({ type: "column", key, gap: 8, ...extra, style: { background: "panel", borderColor: "border", borderWidth: 1, radius: 10, padding: 10, ...extra.style || {} }, children });
function rememberChatHistory(run) {
  for (const st of run.blocks) {
    if (!st.agentMessages) continue;
    const key = JSON.stringify([run.id, st.blockId]);
    const old = S.chatHistory.get(key);
    if (!old || old.sessionId !== st.sessionId) {
      S.chatHistory.set(key, { sessionId: st.sessionId, messages: st.agentMessages, before: st.agentHistoryBefore ?? null, loading: false });
    } else {
      const messages = new Map(old.messages.map((m) => [m.key, m]));
      for (const m of st.agentMessages) messages.set(m.key, m);
      old.messages = [...messages.values()];
    }
  }
  return run;
}

// ../sdk/workflow-provider-options.ts
function blockProfile(b, catalog) {
  return b.profileId || (b.provider ? catalog?.profiles?.find((p) => p.provider === b.provider)?.id : null) || catalog?.defaultProfileId || catalog?.profiles?.[0]?.id || "";
}
var providerChoiceKey = (workspaceId, profileId, model = "") => JSON.stringify([workspaceId, profileId, model]);

// ../sdk/ui-icons.ts
var outline = (paths, width = 1.8) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
var uiIcons = {
  send: outline("<path d='m22 2-7 20-4-9-9-4Z'/><path d='M22 2 11 13'/>"),
  paperclip: outline("<path d='m21 11-9 9a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8l8.5-8.5'/>"),
  "sliders-horizontal": outline("<path d='M3 6h3m4 0h11M3 18h11m4 0h3'/><circle cx='8' cy='6' r='2'/><circle cx='16' cy='18' r='2'/>"),
  "message-square": outline("<path d='M21 15a2 2 0 0 1-2 2H7l-5 5V4a2 2 0 0 1 2-2h15a2 2 0 0 1 2 2Z'/>"),
  "graduation-cap": outline("<path d='m2 8 10-5 10 5-10 5Zm4 2v7q6 5 12 0v-7M22 8v8'/>"),
  pencil: outline("<path d='M21.2 6.8a2.8 2.8 0 0 0-4-4L3.8 16.2 3 21l4.8-.8Z'/><path d='m15 5 4 4'/>"),
  eraser: outline("<path d='m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L11 21'/><path d='M22 21H7'/><path d='m5 11 9 9'/>"),
  trash: outline("<path d='M3 6h18'/><path d='M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6'/><path d='M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'/><path d='M10 11v6M14 11v6'/>"),
  copy: outline("<rect x='8' y='8' width='13' height='13' rx='2'/><path d='M16 5V3H3v13h2'/>"),
  warning: outline("<path d='m12 3 10 18H2Z'/><path d='M12 9v5m0 3h.01'/>"),
  terminal: outline("<rect x='3' y='4' width='18' height='16' rx='2'/><path d='m7 9 3 3-3 3m6 0h4'/>"),
  "git-branch": outline("<circle cx='6' cy='3' r='2'/><circle cx='6' cy='20' r='2'/><circle cx='18' cy='6' r='2'/><path d='M6 5v13M18 8c0 7-12 4-12 10'/>"),
  files: outline("<path d='M14 2H6v16h14V8Z'/><path d='M14 2v6h6M3 6v16h13'/>"),
  folder: outline("<path d='M3 5h6l2 2h10v13H3Z'/>"),
  refresh: outline("<path d='M20 7a8 8 0 1 0 0 10M20 3v5h-5'/>"),
  collapse: outline("<path d='m8 8 4-4 4 4M8 16l4 4 4-4M4 12h16'/>"),
  locate: outline("<circle cx='12' cy='12' r='7'/><circle cx='12' cy='12' r='2'/><path d='M12 2v3m0 14v3M2 12h3m14 0h3'/>"),
  search: outline("<circle cx='10' cy='10' r='7'/><path d='m15 15 6 6'/>"),
  x: outline("<path d='m6 6 12 12M6 18 18 6'/>"),
  plus: outline("<path d='M12 4v16M4 12h16'/>"),
  remote: outline("<rect x='3' y='4' width='18' height='12' rx='2'/><path d='M8 20h8M12 16v4'/>"),
  plug: outline("<path d='M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0V7ZM12 17v5'/>"),
  "text-search": outline("<path d='M4 6h16M4 12h7M4 18h6'/><circle cx='17' cy='15' r='3'/><path d='m19.2 17.2 2.3 2.3'/>"),
  eye: outline("<path d='M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z'/><circle cx='12' cy='12' r='3'/>"),
  "eye-off": outline("<path d='M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3 3.8M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18'/>"),
  globe: outline("<circle cx='12' cy='12' r='9'/><path d='M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18'/>"),
  "cloud-lock": outline("<path d='M17.5 17H18a4 4 0 0 0 .5-8A6 6 0 0 0 7 7.5 4.5 4.5 0 0 0 6.5 17'/><rect x='9' y='14' width='6' height='6' rx='1'/><path d='M10.5 14v-1.5a1.5 1.5 0 0 1 3 0V14'/>"),
  lock: outline("<rect x='4' y='11' width='16' height='10' rx='2'/><path d='M8 11V7a4 4 0 0 1 8 0v4'/>"),
  key: outline("<circle cx='8' cy='15' r='4'/><path d='m10.8 12.2 8.7-8.7M17 6l3 3M14.5 8.5l2 2'/>"),
  check: outline("<path d='m5 12 5 5 9-11'/>"),
  "log-out": outline("<path d='M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9'/>"),
  external: outline("<path d='M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'/>"),
  sparkles: outline("<path d='M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z'/><path d='M19 16v4M17 18h4'/>"),
  import: outline("<path d='M12 3v12M7 10l5 5 5-5M5 21h14'/>"),
  task: outline("<circle cx='6' cy='3' r='2'/><circle cx='6' cy='20' r='2'/><circle cx='18' cy='6' r='2'/><path d='M6 5v13M18 8c0 7-12 4-12 10'/>")
};

// modules/ui/workflows-panel/src/transfers.ts
var DURATION = 1400;
var runs = /* @__PURE__ */ new Map();
function transferEdges(edges, run, now2 = Date.now()) {
  if (!run?.transfers?.length) return edges;
  let state = runs.get(run.id);
  const fresh = !state;
  if (!state) {
    state = { seen: 0, pulses: [] };
    runs.set(run.id, state);
    if (runs.size > 100) runs.delete(runs.keys().next().value);
  }
  state.pulses = state.pulses.filter((p) => p.end > now2);
  for (const event of run.transfers) {
    if (event.seq <= state.seen) continue;
    state.seen = event.seq;
    if (fresh && now2 - Date.parse(event.at) > 5e3) continue;
    const same = state.pulses.filter((p) => p.event.edgeId === event.edgeId);
    const last = same[same.length - 1];
    const start = Math.max(now2, last?.end ?? now2);
    state.pulses.push({ event, start, end: start + DURATION });
  }
  const overlays = [];
  for (const { event, start, end } of state.pulses) {
    if (now2 < start || now2 >= end) continue;
    const edge2 = edges.find((e) => e.key === event.edgeId);
    if (!edge2) continue;
    const reverse = event.phase === "return";
    overlays.push({
      ...edge2,
      key: `transfer:${event.seq}`,
      label: void 0,
      arrow: false,
      ...reverse ? { from: edge2.to, to: edge2.from, fromSide: edge2.toSide || "left", toSide: edge2.fromSide || "right" } : {},
      active: true,
      sparkColor: event.error ? "danger" : reverse ? "success" : "primary"
    });
  }
  return [...edges, ...overlays];
}
function tickTransfers(now2 = Date.now()) {
  let dirty = false;
  for (const state of runs.values()) {
    if (state.pulses.length) dirty = true;
    state.pulses = state.pulses.filter((p) => p.end > now2);
  }
  return dirty;
}
function clearTransfers() {
  runs.clear();
}

// ../sdk/chat-transcript.ts
var ROLE_LABELS = { user: "YOU", plan: "PLAN", error: "ERROR", system: "SYSTEM" };
var EDGE = { user: "primary", assistant: "agentEdge", error: "danger" };
var singleLine = (text2) => text2.split(/\s+/).filter(Boolean).join(" ");
var copyButton = (key, text2, tooltip, size = 22) => ({
  type: "button",
  key,
  text: "",
  iconSvg: uiIcons.copy,
  iconSize: 14,
  copyText: text2,
  action: "",
  variant: "ghost",
  small: true,
  tooltip,
  style: { width: size + 4, height: 22, padding: 0, noShrink: true }
});
function markdown(key, text2, linkAction, style) {
  return { type: "markdown", key, text: text2, inline: true, lineHeight: 18, paragraphGap: 0.3, linkAction, style };
}
function messageNode(m, opts = {}) {
  if (m.role === "system" && /^Turn ended(?::|$)/.test(m.text)) {
    return { type: "divider", key: m.key, tooltip: m.text };
  }
  if (m.role === "thought") {
    return { type: "column", key: m.key, gap: 2, style: { borderLeft: 2, borderColor: "border", paddingX: 12, paddingY: 4, color: "muted", fontSize: 14 }, children: [
      { type: "label", key: "kind", text: "REASONING", size: "xs" },
      { type: "label", key: "body", text: m.text.replace(/\*\*([^]*?)\*\*/g, "$1").replace(/\*([^*\n]+)\*/g, "$1").replace(/\r\n?/g, "\n").replace(/\n[ \t]*\n+/g, "\n").trim(), wrap: true, selectable: true, color: "muted", style: { italic: true, fontWeight: 400, color: "muted", lineHeight: 18 } }
    ] };
  }
  if (m.role === "tool") {
    const title = m.title || "Tool";
    const copied = m.text ? `${title}
${m.text}` : title;
    return { type: "row", key: m.key, gap: 8, align: "center", style: { height: 28, noShrink: true, paddingX: 12, radius: 7, borderWidth: 1, borderColor: "border", color: "muted", fontSize: 14 }, children: [
      { type: "label", key: "kind", text: "TOOLS", size: "xs" },
      { type: "label", key: "summary", text: singleLine(title), grow: true },
      ...m.status ? [{ type: "label", key: "status", text: singleLine(m.status), size: "xs", style: { maxWidth: 72 } }] : [],
      copyButton("copy", copied, "Copy tool output")
    ] };
  }
  const label = m.role === "assistant" ? opts.agentLabel || "AGENT" : ROLE_LABELS[m.role] || "SYSTEM";
  const body = [];
  if (m.text) {
    body.push(m.role === "assistant" || m.role === "plan" ? markdown("text", m.text, opts.linkAction) : { type: "label", key: "text", text: m.text, wrap: true, selectable: true, style: { lineHeight: 18 } });
  }
  for (const [i, image] of (m.images || []).entries()) body.push({ type: "image", key: `image-${i}`, image, width: 200, height: 140 });
  return { type: "row", key: m.key, align: "stretch", style: { radius: 9, borderWidth: 1, borderColor: "border", noShrink: true }, children: [
    { type: "column", key: "edge", style: { width: 2, background: EDGE[m.role] || "border" }, children: [] },
    { type: "column", key: "card", grow: true, children: [
      { type: "row", key: "header", gap: 8, align: "center", style: { paddingX: 12, paddingY: 2, background: "surface", borderBottom: 1, borderColor: "border" }, children: [
        { type: "label", key: "role", text: label.toUpperCase(), size: "xs", color: "muted", grow: true },
        copyButton("copy", m.text, "Copy message")
      ] },
      { type: "column", key: "body", gap: 4, style: { paddingX: 12, paddingY: 4, lineHeight: 18, background: m.role === "user" ? "selection" : "answer", color: "text" }, children: body }
    ] }
  ] };
}
function transcriptItems(messages, opts = {}) {
  const items = [];
  if (opts.hasOlder) {
    items.push({
      type: "button",
      key: "__older",
      variant: "ghost",
      small: true,
      style: { fullWidth: true },
      text: opts.loadingOlder ? "Loading older messages…" : opts.historyError ? "Retry loading older messages" : "Load older messages",
      action: opts.loadOlderAction || "",
      disabled: !!opts.loadingOlder || !opts.loadOlderAction,
      tooltip: opts.historyError || "Load the previous message batch"
    });
  }
  for (const m of messages) if (!(m.role === "system" && /^Permission for "/.test(m.text || ""))) items.push(messageNode(m, opts));
  return items;
}
var followKey = (messages) => [...messages].reverse().find((m) => m.role === "user")?.key;

// modules/ui/workflows-panel/src/runs.ts
var RUN_LABEL = { idle: "Ready", running: "Running", waiting: "Waiting", succeeded: "Succeeded", failed: "Failed", cancelled: "Cancelled" };
var statusLabel = (s) => RUN_LABEL[s || "idle"] || (s ? s[0].toUpperCase() + s.slice(1) : "Ready");
var PAUSED = /* @__PURE__ */ new Set(["awaiting_user_input", "awaiting_permission"]);
var BOX = { w: 120, h: 24 };
function previewLayout(def) {
  const src = def.blocks;
  if (!src.length) return { pos: /* @__PURE__ */ new Map(), height: 60 };
  const axis = (key, step) => {
    const values = [...new Set(src.map((b) => b.position[key]))].sort((a, b) => a - b);
    const gaps = values.slice(1).map((v, i) => v - values[i]);
    return { origin: values[0], scale: Math.min(0.6, gaps.length ? step / Math.min(...gaps) : 0.6) };
  };
  const x = axis("x", BOX.w + 16);
  const rows = [...new Set(src.map((b) => b.position.y))].sort((a, b) => a - b);
  const rowY = /* @__PURE__ */ new Map();
  let packedY = 8;
  rows.forEach((row, i) => {
    if (i) packedY += Math.min(BOX.h + 8, (row - rows[i - 1]) * 0.6);
    rowY.set(row, packedY);
  });
  const pos = new Map(src.map((b) => [b.id, {
    x: 8 + (b.position.x - x.origin) * x.scale,
    y: rowY.get(b.position.y)
  }]));
  const height = Math.max(...[...pos.values()].map((p) => p.y + BOX.h + 8));
  return { pos, height };
}
var dotColor = (s) => s === "idle" ? "border" : statusColor(s);
function preview(key, def, run, selected, opts) {
  const { pos, height } = previewLayout(def);
  const items = def.blocks.map((b) => {
    const p = pos.get(b.id), s = blockStatus(b, run?.blocks.find((x) => x.blockId === b.id));
    const sel = selected === b.id;
    return {
      key: b.id,
      x: p.x,
      y: p.y,
      width: BOX.w,
      height: BOX.h,
      ...s === "running" ? { pulse: "primary" } : PAUSED.has(s) ? { pulse: "warning" } : {},
      style: { background: s === "running" ? "selection" : "background", borderColor: sel ? "primary" : s === "idle" ? "border" : statusColor(s), borderWidth: sel ? 2 : 1, radius: 5, opacity: s === "skipped" || s === "cancelled" ? 0.55 : 1 },
      children: [{ type: "row", key: "r", gap: 5, style: { paddingX: 6, height: BOX.h - 2 }, children: [
        { type: "label", key: "d", text: "●", size: "xs", color: s === "idle" ? blockColor[b.type] || "muted" : dotColor(s) },
        { type: "label", key: "l", text: b.label.length > 15 ? b.label.slice(0, 14) + "…" : b.label, size: "xs", weight: "medium" }
      ] }]
    };
  });
  const edges = def.edges.filter((e) => pos.has(e.from) && pos.has(e.to)).map((e) => {
    const t = edgeType(e);
    const a = pos.get(e.from), b = pos.get(e.to);
    const dx = b.x - a.x, dy = b.y - a.y;
    const horizontal = Math.abs(dx) >= BOX.w;
    const fromSide = horizontal ? dx >= 0 ? "right" : "left" : dy >= 0 ? "bottom" : "top";
    const toSide = horizontal ? dx >= 0 ? "left" : "right" : dy >= 0 ? "top" : "bottom";
    const gap = horizontal ? Math.abs(dx) - BOX.w : Math.abs(dy) - BOX.h;
    return { key: e.id, from: e.from, to: e.to, fromSide, toSide, curveOffset: Math.max(2, Math.min(24, gap / 2)), color: t === "use" ? "#8b6fe8" : t === "path" ? "warning" : "border", dashed: t === "use", width: 1.4, arrow: false, sparkColor: t === "use" ? "#a58bff" : "primary" };
  });
  return {
    type: "column",
    key: `${key}:frame`,
    height: Math.min(opts.maxHeight, height + 8),
    style: { background: "background", borderColor: "border", borderWidth: 1, radius: 8 },
    children: [{ type: "canvas", key, items, edges: transferEdges(edges, run), margin: 8, grow: true, selectAction: "previewSelect" }]
  };
}
var outputBox = (key, value, markdown2) => markdown2 ? { type: "column", key, scroll: true, maxHeight: 320, style: { background: "background", borderColor: "border", borderWidth: 1, radius: 6, padding: 8 }, children: [{ type: "markdown", key: "m", text: value, inline: true }] } : { type: "column", key, scroll: true, maxHeight: 320, style: { background: "background", borderColor: "border", borderWidth: 1, radius: 6, padding: 8 }, children: [{ type: "label", key: "t", text: value, mono: true, size: "xs", wrap: true, selectable: true }] };
function blockStatus(b, st) {
  if (b.type === "chatbox" && st?.agentActivity) {
    if (["busy", "starting"].includes(st.agentActivity.status)) return "running";
    if (st.agentActivity.status === "waiting") return "awaiting_permission";
  }
  return st?.status || "idle";
}
var PARTICIPANT_COLORS = ["#60a5fa", "#c084fc", "#34d399", "#fbbf24", "#fb7185", "#22d3ee", "#f97316", "#a3e635"];
function participantColor(run, blockId) {
  const index = run.definition.blocks.filter(isAgentBlock).findIndex((b) => b.id === blockId);
  const fallback = [...blockId || "unknown"].reduce((hash, c) => hash * 31 + c.charCodeAt(0) >>> 0, 0);
  return PARTICIPANT_COLORS[(index >= 0 ? index : fallback) % PARTICIPANT_COLORS.length];
}
function chatStatus(st) {
  const status = st.agentActivity?.status;
  const fallback = st.status === "running" ? "busy" : st.status === "awaiting_permission" ? "waiting" : st.status === "failed" ? "error" : st.sessionId ? "ready" : "idle";
  const value = status || fallback;
  const labels = { busy: "Working", starting: "Connecting", waiting: "Waiting for permission", ready: "Ready", stopped: "Stopped", interrupted: "Interrupted", error: "Error", unavailable: "Status unavailable", idle: "Not started" };
  return {
    label: labels[value] || value,
    busy: ["busy", "starting", "waiting"].includes(value),
    color: value === "waiting" ? "warning" : value === "busy" || value === "starting" ? "primary" : value === "error" || value === "interrupted" ? "danger" : "muted",
    detail: st.agentActivity?.text || (value === "busy" ? "Agent is working…" : value === "ready" ? "Ready for a message" : "")
  };
}
function activityLog(run, st, prefix) {
  const ref = JSON.stringify([run.id, st.blockId]), open = S.logOpen.has(ref);
  const logs = st.log || [];
  const key = `${prefix}:${run.id}:${st.blockId}:activity-section`;
  return card(key, [
    btn(`${key}:toggle`, `Activity log · ${logs.length}`, "toggleActivity", { value: ref, iconSvg: blockIcon[open ? "chevron-up" : "chevron-down"], variant: "ghost", tooltip: open ? "Collapse activity log" : "Expand activity log" }),
    ...open ? [{ type: "column", key: `${prefix}:${run.id}:${st.blockId}:activity`, scroll: true, height: 220, gap: 6, children: logs.length ? logs.map((entry, i) => ({
      type: "column",
      key: `entry-${i}`,
      gap: 2,
      children: [
        muted("at", `${new Date(entry.at).toLocaleTimeString()} · ${entry.kind}`, { color: entry.kind === "error" ? "danger" : "muted" }),
        text("entry", entry.text, { selectable: true, mono: true, size: "xs" })
      ]
    })) : [muted("empty", "No activity recorded yet.")] }] : []
  ], { style: { background: "background" } });
}
function blockRunView(run, b, st, prefix, includeActivity = true) {
  const k = (s) => `${prefix}:${run.id}:${b.id}:${s}`;
  const chat = b.type === "chatbox" ? chatStatus(st) : null;
  const out = [{ type: "row", key: k("h"), gap: 6, children: [
    { type: "button", key: "i", text: "", iconSvg: blockIcon[b.type] || blockIcon.workflow, iconSize: 14, action: "", small: true, variant: "ghost", style: { color: blockColor[b.type] } },
    text("n", b.label, { weight: "semibold", grow: true, wrap: false }),
    { type: "row", key: "chip", gap: 4, style: { background: "raised", radius: 10, paddingX: 7, paddingY: 1 }, children: [
      { type: "label", key: "d", text: "●", size: "xs", color: chat?.color || dotColor(st.status) },
      { type: "label", key: "s", text: `${chat?.label || statusText[st.status] || st.status}${st.runs > 1 ? ` ×${st.runs}` : ""}`, size: "xs" }
    ] },
    ...st.sessionId ? [icon("chat", blockIcon.chat, "openChat", "Open this block's agent session in the AI chat", { value: st.sessionId })] : []
  ] }];
  if (st.error) out.push({ type: "status", key: k("err"), level: "error", text: st.error });
  if (st.status === "awaiting_user_input" && st.question) {
    out.push(outputBox(k("q"), st.question, true));
    if (b.type === "yes_no_prompt") out.push({ type: "row", key: k("yn"), gap: 6, children: [
      btn("yes", "Yes", "answer", { value: { runId: run.id, blockId: b.id, pauseId: st.pauseId, answer: "yes" }, variant: "primary" }),
      btn("no", "No", "answer", { value: { runId: run.id, blockId: b.id, pauseId: st.pauseId, answer: "no" } })
    ] });
    else out.push({ type: "row", key: k("ans"), gap: 6, align: "end", children: [
      { type: "textInput", key: `answer:${run.id}:${st.pauseId}`, changeAction: "answerText", submitAction: "answerSubmit", placeholder: "Type your answer, then Enter", grow: true, multiline: true, rows: 2 },
      btn("send", "Send", "answerSubmit", { value: `answer:${run.id}:${st.pauseId}`, variant: "primary" })
    ] });
  }
  const permissionId = st.agentActivity?.status === "waiting" ? st.agentActivity.permissionId : st.permissionId;
  if ((st.status === "awaiting_permission" || st.agentActivity?.status === "waiting") && st.sessionId && permissionId) out.push(btn(k("perm"), "Review permission", "reviewPermission", { value: { sessionId: st.sessionId, permissionId }, variant: "primary" }));
  if (st.status === "waiting_timer" && st.waitingUntil) out.push(muted(k("timer"), `Fires at ${new Date(st.waitingUntil).toLocaleTimeString()}`, { color: "info" }));
  if (b.type === "chatbox") {
    const agent = chatStatus(st);
    out.push({ type: "row", key: k("agent-status"), gap: 6, children: [
      text("dot", "●", { color: agent.color, wrap: false }),
      text("status", agent.label, { weight: "semibold", color: agent.color, wrap: false }),
      muted("activity", agent.detail.replace(/\s+/g, " ").trim().slice(0, 100), { grow: true, wrap: false })
    ] });
    if (agent.busy) out.push({ type: "progress", key: k("agent-busy"), indeterminate: true, height: 3 });
    const ref = JSON.stringify([run.id, b.id]);
    const history = S.chatHistory.get(ref);
    const transcript = history?.messages || (st.agentMessages?.length ? st.agentMessages : (st.chat || []).map((m) => ({ key: k(`m-${m.id}`), role: m.role, text: m.text })));
    const hasOlder = (history ? history.before : st.agentHistoryBefore) != null;
    const messages = transcriptItems(transcript, { agentLabel: b.label, hasOlder, loadingOlder: history?.loading, historyError: history?.error, loadOlderAction: "chatHistoryOlder" });
    const older = messages.find((m) => m.key === "__older");
    if (older?.type === "button") {
      older.value = ref;
      older.key = `__older:${transcript[0]?.key || ""}`;
    }
    if (messages.length) out.push({ type: "column", key: k("messages"), height: 320, children: [{
      type: "transcript",
      key: `chat-history:${ref}`,
      scrollbarMode: "scrolling",
      grow: true,
      scrollKey: `${run.id}:${b.id}:${st.sessionId || ""}`,
      followKey: followKey(transcript),
      hasOlder,
      loadingOlder: history?.loading,
      loadOlderAction: history?.error ? void 0 : "chatHistoryOlder",
      children: messages
    }] });
    if (run.status !== "cancelled") out.push({ type: "row", key: k("chat"), gap: 6, align: "end", children: [
      { type: "textInput", key: `chat:${run.id}:${b.id}`, value: S.chatDrafts.get(`chat:${run.id}:${b.id}`) || "", changeAction: "chatText", submitAction: "chatSend", placeholder: `Message ${b.label}`, grow: true, multiline: true, rows: 2 },
      btn("send", "Send", "chatSend", { value: `chat:${run.id}:${b.id}`, variant: "primary", disabled: agent.busy })
    ] });
  } else if (st.output && b.type !== "meeting") {
    out.push(outputBox(k("out"), st.output, b.type === "markdown" || isAgentBlock(b)));
    out.push({ type: "row", key: k("oa"), gap: 6, children: [
      ...(st.outputChars || 0) > st.output.length ? [muted("trunc", `Preview of ${st.outputChars} characters`, { grow: true })] : [{ type: "spacer", key: "sp" }],
      btn("copy", "Copy output", "", { iconSvg: blockIcon.copy, variant: "ghost", copyText: st.output })
    ] });
  }
  if (b.type === "meeting" && st.meeting?.messages.length) out.push(
    text(k("transcript-title"), "Meeting transcript", { weight: "semibold" }),
    { type: "column", key: k("transcript"), scroll: true, maxHeight: 280, gap: 6, children: st.meeting.messages.map((m) => ({
      type: "column",
      key: k(`mt-${m.seq}`),
      gap: 2,
      style: { borderLeft: 3, borderColor: participantColor(run, m.blockId), paddingX: 10, paddingY: 6, background: "background", radius: 4 },
      children: [
        muted("author", `${m.author} · ${new Date(m.at).toLocaleTimeString()}`, { color: participantColor(run, m.blockId), weight: "semibold" }),
        text("message", m.text, { selectable: true, ...m.kind === "status" ? { size: "xs", style: { italic: true } } : {} })
      ]
    })) }
  );
  if (includeActivity) out.push(activityLog(run, st, prefix));
  return out;
}
var pausedBlocks = (run) => (run?.blocks || []).filter((s) => PAUSED.has(s.status));

// modules/ui/workflows-panel/src/designer.ts
var block = (id) => S.draft?.blocks.find((b) => b.id === id);
var edge = (id) => S.draft?.edges.find((e) => e.id === id);
var designerRun = () => S.selectedId ? shownRun(S.selectedId) : void 0;
async function openDraft(ctx, id) {
  const r = await call(ctx, "get", { id });
  Object.assign(S, { selectedId: id, draft: r.definition, revision: r.revision, issues: r.issues || [], dirty: false, undo: [], redo: [], selection: null, lastSnapshot: { at: 0, field: "" }, confirm: null });
  S.defs.set(id, r.definition);
}
function snapshot(fieldKey = "") {
  if (!S.draft) return;
  const t = Date.now();
  if (!S.redo.length && fieldKey && fieldKey === S.lastSnapshot.field && t - S.lastSnapshot.at < 1500) {
    S.lastSnapshot.at = t;
    return;
  }
  S.lastSnapshot = { at: t, field: fieldKey };
  S.undo.push(JSON.stringify(S.draft));
  if (S.undo.length > 80) S.undo.shift();
  S.redo = [];
}
function changed() {
  S.dirty = true;
  if (S.draft) S.issues = validateWorkflow(S.draft, S.catalog ? { profiles: S.catalog.profiles, mcps: S.catalog.mcps } : void 0);
}
function mutate(fn, fieldKey = "") {
  if (!S.draft) return;
  snapshot(fieldKey);
  fn(S.draft);
  changed();
}
function undoDraft() {
  if (S.draft && S.undo.length) {
    S.redo.push(JSON.stringify(S.draft));
    S.draft = JSON.parse(S.undo.pop());
    changed();
    S.selection = null;
    S.lastSnapshot = { at: 0, field: "" };
  }
}
function redoDraft() {
  if (S.draft && S.redo.length) {
    S.undo.push(JSON.stringify(S.draft));
    S.draft = JSON.parse(S.redo.pop());
    changed();
    S.selection = null;
    S.lastSnapshot = { at: 0, field: "" };
  }
}
function addBlock(type) {
  const d = S.draft;
  if (!d) return;
  const info = blockInfo(type);
  if (!info) return;
  const id = newBlockId(d, type);
  const sel = S.selection?.kind === "block" ? block(S.selection.id) : void 0;
  const pos = sel ? { x: sel.position.x + CARD.width + 60, y: sel.position.y } : { x: 40 + d.blocks.length % 4 * (CARD.width + 50), y: 40 + Math.floor(d.blocks.length / 4) * (CARD.height + 70) };
  const b = { id, type: info.type, label: info.label, prompt: "", position: { x: Math.round(pos.x / CARD.snap) * CARD.snap, y: Math.round(pos.y / CARD.snap) * CARD.snap } };
  if (type === "timer") b.seconds = 60;
  if (type === "script") b.command = "git status --short";
  if (type === "run_app") {
    b.command = "npm run dev";
    b.app = { name: id, actions: ["start", "status", "kill", "tail"] };
  }
  if (type === "ai" || type === "user_prompt" || type === "yes_no_prompt") b.prompt = "{{input}}";
  if (type === "start_button") b.prompt = "Describe what this run should do.";
  if (type === "skill") b.description = "When to use these instructions.";
  if (type === "mcp") b.mcp = { serverId: S.catalog?.mcps?.[0]?.id || "" };
  mutate((dd) => {
    dd.blocks.push(b);
  });
  if (sel && (S.mode !== "use" || isAgentBlock(sel)) && !isStartBlock(b)) connect(sel.id, id);
  S.selection = { kind: "block", id };
}
function connect(from, to) {
  const d = S.draft;
  if (!d || from === to) return;
  const a = block(from), b = block(to);
  if (!a || !b) return;
  let type = S.mode;
  if (["terminal_control", "task_controls", "mcp", "skill", "meeting"].includes(b.type) && isAgentBlock(a)) type = "use";
  if (type === "use" && !isAgentBlock(a)) type = "follow";
  if (type === "path" && a.type !== "ai" && a.type !== "yes_no_prompt") type = "follow";
  let label;
  if (type === "path") {
    const used = d.edges.filter((e2) => e2.from === from && edgeType(e2) === "path").map((e2) => e2.label);
    label = a.type === "yes_no_prompt" ? used.includes("yes") ? "no" : "yes" : (() => {
      for (let i = 1; ; i++) if (!used.includes(`route-${i}`)) return `route-${i}`;
    })();
  }
  if (d.edges.some((e2) => e2.from === from && e2.to === to && edgeType(e2) === type && (e2.label || "") === (label || ""))) return;
  const e = { id: newEdgeId(d, from, to), from, to, type, ...label ? { label } : {} };
  mutate((dd) => {
    dd.edges.push(e);
  });
  S.selection = { kind: "edge", id: e.id };
}
function removeBlock(id) {
  mutate((d) => {
    d.blocks = d.blocks.filter((b) => b.id !== id);
    d.edges = d.edges.filter((e) => e.from !== id && e.to !== id);
  });
  S.selection = null;
}
function duplicateBlock(id) {
  const b = block(id), d = S.draft;
  if (!b || !d) return;
  const copy = JSON.parse(JSON.stringify(b));
  copy.id = newBlockId(d, b.type);
  copy.label = `${b.label} copy`;
  copy.position = { x: b.position.x + 36, y: b.position.y + 36 };
  if (copy.app) copy.app.name = copy.id;
  mutate((dd) => {
    dd.blocks.push(copy);
  });
  S.selection = { kind: "block", id: copy.id };
}
function renameBlockId(oldId, next) {
  const d = S.draft;
  if (!d || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(next) || d.blocks.some((b) => b.id === next)) throw new Error("IDs use letters, digits, _ or - and must be unique");
  mutate((dd) => {
    for (const b of dd.blocks) {
      if (b.id === oldId) b.id = next;
      b.prompt = b.prompt.split(`blocks.${oldId}.output`).join(`blocks.${next}.output`);
    }
    for (const e of dd.edges) {
      if (e.from === oldId) e.from = next;
      if (e.to === oldId) e.to = next;
    }
  });
  S.selection = { kind: "block", id: next };
}
async function saveDraft(ctx) {
  if (!S.draft) return;
  const r = await call(ctx, "save", { definition: S.draft, expectedRevision: S.revision });
  Object.assign(S, { revision: r.revision, draft: r.definition, issues: r.issues || [], dirty: false, notice: "Saved" });
  S.defs.set(r.id, r.definition);
}
function setField(target, f, raw) {
  const numeric = ["seconds", "timeoutSeconds", "timeoutMs", "maxLoopCount", "maxSteps"].includes(f);
  const value = numeric ? String(raw).trim() === "" ? void 0 : Number(raw) : raw;
  if (value === void 0 || value === "" && f !== "prompt" && f !== "label") delete target[f];
  else if (!numeric || Number.isFinite(value)) target[f] = value;
}
async function loadProviderChoices(ctx, id, refresh = false) {
  const b = block(id);
  if (!b || !isAgentBlock(b)) return;
  const profileId = blockProfile(b, S.catalog);
  if (!profileId) return;
  const key = providerChoiceKey(S.ws?.id || "", profileId, b.model || "");
  if (S.providerLoading.has(key) || !refresh && S.providerChoices.has(key)) return;
  S.providerLoading.add(key);
  S.providerErrors.delete(key);
  ctx.ui.invalidate();
  try {
    S.providerChoices.set(key, await call(ctx, "providerOptions", { profileId, model: b.model || "", refresh }));
  } catch (error) {
    S.providerErrors.set(key, error instanceof Error ? error.message : String(error));
  } finally {
    S.providerLoading.delete(key);
    ctx.ui.invalidate();
  }
}
function cardFor(b) {
  const color = blockColor[b.type] || "#888888";
  const st = designerRun()?.blocks.find((s) => s.blockId === b.id);
  const status = blockStatus(b, st);
  const selected = S.selection?.kind === "block" && S.selection.id === b.id;
  const issue = S.issues.find((i) => i.blockId === b.id && i.severity !== "warning");
  const c = S.catalog;
  const detail = b.type === "script" || b.type === "run_app" ? (b.command || "").split("\n")[0] : b.type === "timer" ? `${b.seconds ?? 0} s` : b.type === "skill" && b.skillId ? b.skillId : b.type === "mcp" ? c?.mcps?.find((m) => m.id === b.mcp?.serverId)?.name || b.mcp?.serverId || "" : isAgentBlock(b) ? `${c?.profiles?.find((p) => p.id === b.profileId)?.name || b.provider || "Default provider"}${b.model ? ` · ${b.model}` : ""}` : (b.prompt || b.description || "").replace(/\s+/g, " ");
  const running = status === "running", waiting = st && ["awaiting_user_input", "awaiting_permission"].includes(status);
  return {
    key: b.id,
    x: b.position.x,
    y: b.position.y,
    width: CARD.width,
    height: CARD.height,
    port: true,
    ...running ? { pulse: "primary" } : waiting ? { pulse: "warning" } : {},
    style: { background: "background", borderColor: selected ? "primary" : issue ? "danger" : "border", borderWidth: selected ? 2 : 1, radius: 8, shadow: selected ? "md" : "sm" },
    children: [
      { type: "row", key: "head", gap: 4, style: { background: color, paddingX: 8, paddingY: 3 }, children: [
        { type: "button", key: "ic", text: "", iconSvg: blockIcon[b.type] || blockIcon.workflow, iconSize: 13, action: "", small: true, variant: "ghost", style: { color: "#ffffff" } },
        { type: "label", key: "type", text: blockInfo(b.type)?.label || b.type, size: "xs", weight: "semibold", color: "#ffffff", grow: true },
        ...st && status !== "idle" ? [{ type: "label", key: "status", text: statusText[status] || status, size: "xs", weight: "bold", color: "#ffffff" }] : []
      ] },
      { type: "column", key: "body", gap: 2, style: { paddingX: 8, paddingY: 5 }, children: [
        { type: "label", key: "name", text: b.label || b.id, size: "sm", weight: "semibold" },
        { type: "label", key: "detail", text: detail.length > 60 ? detail.slice(0, 59) + "…" : detail || " ", size: "xs", color: "muted" },
        ...st && (status === "failed" || waiting) ? [{ type: "label", key: "state", text: status === "failed" ? `⚠ ${(st.error || "").slice(0, 56)}` : status === "awaiting_permission" ? "Waiting for permission" : "Waiting for your answer", size: "xs", color: statusColor(status) }] : []
      ] }
    ]
  };
}
function edgesFor() {
  const d = S.draft;
  if (!d) return [];
  return transferEdges(d.edges.map((e) => {
    const t = edgeType(e), st = edgeStyle[t], selected = S.selection?.kind === "edge" && S.selection.id === e.id;
    const target = block(e.to), use = t === "use";
    return {
      key: e.id,
      from: e.from,
      to: e.to,
      fromSide: use ? "bottom" : "right",
      toSide: use ? target && isAgentBlock(target) ? "left" : "top" : "left",
      color: selected ? "primary" : st.color,
      width: selected ? 3 : 1.6,
      dashed: st.dashed,
      label: t === "path" ? e.label || "path" : e.loop ? "loop" : t
    };
  }), designerRun());
}
function toolbar() {
  const d = S.draft, blocking = blockingIssues(S.issues).length, run = designerRun();
  return { type: "row", key: "designer-toolbar", gap: 4, padding: 6, bg: "panel", wrap: true, children: [
    ...!S.designerInline ? [{
      type: "row",
      key: "window-drag",
      windowDrag: true,
      width: 24,
      height: 28,
      tooltip: "Drag to move designer window",
      children: [muted("grip", "⠿", { size: "md" })]
    }] : [],
    { type: "textInput", key: `wf-name:${d.id}`, value: d.name, changeAction: "wfName", placeholder: "Workflow name", width: 220 },
    { type: "select", key: "add-block", placeholder: "Add block…", value: null, action: "addBlock", options: WORKFLOW_BLOCKS.map((b) => ({ value: b.type, label: b.label })) },
    muted("mode-label", "Connect:", { wrap: false }),
    ...["follow", "use", "path"].map((m) => btn(`mode-${m}`, edgeStyle[m].name, "mode", {
      value: m,
      variant: S.mode === m ? "primary" : "ghost",
      tooltip: m === "follow" ? "Run the target with this block's output" : m === "use" ? "The target becomes a tool of this AI Agent or Chatbox" : "A named route chosen by an AI Agent or Yes/No Prompt"
    })),
    icon("undo", blockIcon.undo, "undo", "Undo", { disabled: !S.undo.length }),
    icon("redo", blockIcon.redo, "redo", "Redo", { disabled: !S.redo.length }),
    { type: "spacer", key: "sp" },
    text("issues", blocking ? `${blocking} issue${blocking > 1 ? "s" : ""}` : S.issues.length ? `${S.issues.length} warning${S.issues.length > 1 ? "s" : ""}` : "Valid", { size: "xs", color: blocking ? "danger" : S.issues.length ? "warning" : "success", wrap: false }),
    btn("save", S.dirty ? "Save •" : "Saved", "save", { iconSvg: blockIcon.save, variant: S.dirty ? "primary" : "ghost", disabled: S.busy || !S.dirty }),
    btn("run-designer", "Run", "designerRun", { iconSvg: blockIcon.play, disabled: S.busy || blocking > 0, tooltip: blocking ? "Fix the listed issues first" : "Save and run from the first start block" }),
    ...run && ACTIVE.has(run.status) ? [btn("cancel-designer", "Stop", "cancelRun", { iconSvg: blockIcon.stop, variant: "danger", value: run.id })] : [],
    S.designerInline ? icon("to-window", blockIcon.window, "toWindow", "Open the designer in its own window") : icon("to-panel", uiIcons.collapse, "toPanel", "Show the designer inside the panel"),
    icon("close-designer", uiIcons.x, "closeDesigner", "Close the designer")
  ] };
}
function blockInspector(b) {
  const k = (f) => `f:${b.id}:${f}`, info = blockInfo(b.type), c = S.catalog;
  const out = [
    { type: "row", key: "bh", gap: 6, children: [
      { type: "button", key: "bi", text: "", iconSvg: blockIcon[b.type], action: "", small: true, variant: "ghost", style: { color: blockColor[b.type] } },
      text("bt", info?.label || b.type, { weight: "semibold", grow: true, size: "md" }),
      icon("dup", uiIcons.copy, "duplicateBlock", "Duplicate block", { value: b.id }),
      icon("del", uiIcons.trash, "confirmBlock", "Delete block", { value: b.id })
    ] },
    muted("summary", info?.summary || ""),
    field("label", "Name", input(k("label"), b.label, "field")),
    field("id", "ID (used in {{blocks.ID.output}})", input(`id:${b.id}`, b.id, "", { submitAction: "renameId", placeholder: "Press Enter to rename" }))
  ];
  const promptTitle = { ai: "Prompt template ({{input}}, {{blocks.ID.output}})", chatbox: "Session guidance", start_button: "Run input", text: "Text", markdown: "Markdown template (empty: pass the input)", user_prompt: "Question", yes_no_prompt: "Question", skill: "Instructions (or link a skill below)" };
  if (promptTitle[b.type]) out.push(field("prompt", promptTitle[b.type], input(k("prompt"), b.prompt, "field", { multiline: true, rows: isAgentBlock(b) ? 10 : 6 })));
  if (b.type === "skill" || b.type === "meeting" || isAgentBlock(b)) out.push(field("desc", b.type === "skill" ? "When to use (shown to agents)" : "Description (shown to callers)", input(k("description"), b.description, "field", { multiline: true, rows: 2 })));
  if (isAgentBlock(b)) {
    out.push(field("prov", "Provider", {
      type: "select",
      key: k("profileId"),
      value: b.profileId || "",
      action: "field",
      options: [{ value: "", label: b.provider ? `By name: ${b.provider}` : "Workflow default" }, ...(c?.profiles || []).map((p) => ({ value: p.id, label: `${p.name} (${p.provider})` }))]
    }));
    const choiceKey = providerChoiceKey(S.ws?.id || "", blockProfile(b, c), b.model || "");
    const choices = S.providerChoices.get(choiceKey), loading = S.providerLoading.has(choiceKey);
    const options = (items, selected) => [
      { value: "", label: "Provider default" },
      ...items,
      ...selected && !items.some((o) => o.value === selected) ? [{ value: selected, label: `Saved: ${selected}` }] : []
    ];
    out.push(field("model", "Model", {
      type: "select",
      key: k("model"),
      value: b.model || "",
      action: "field",
      disabled: loading || !choices?.models.length && !b.model,
      options: options(choices?.models || [], b.model),
      placeholder: loading ? "Loading models…" : "Provider default"
    }));
    out.push(field("reasoning", "Reasoning effort", {
      type: "select",
      key: k("reasoning"),
      value: b.reasoning || "",
      action: "field",
      disabled: loading || !choices?.reasoning.length && !b.reasoning,
      options: options(choices?.reasoning || [], b.reasoning),
      tooltip: choices && !choices.reasoning.length ? "This provider/model does not advertise reasoning options" : "Reasoning choices reported by the selected provider and model"
    }));
    out.push(btn("provider-options", loading ? "Reading provider options…" : "Refresh provider choices", "loadProviderChoices", { value: b.id, disabled: loading, iconSvg: uiIcons.refresh, variant: "ghost" }));
    if (choices?.reasoning.length && choices.reasoningReady === false) out.push(muted("reasoning-runtime", "Reasoning can be saved now. Stop ready background agents to activate the updated runtime before running with a reasoning override.", { color: "warning" }));
    if (S.providerErrors.has(choiceKey)) out.push({ type: "status", key: "provider-error", level: "error", text: S.providerErrors.get(choiceKey) });
    out.push(field("agent", "Agent instructions", {
      type: "select",
      key: k("agentFile"),
      value: b.agentFile || "",
      action: "field",
      options: [{ value: "", label: "None" }, ...(c?.agentFiles || []).map((f) => ({ value: f.path, label: f.path }))]
    }));
    out.push({ type: "switch", key: k("autopilot"), label: "Autopilot (approve tool permissions automatically)", checked: !!b.autopilot, action: "fieldBool" });
  }
  if (b.type === "script" || b.type === "run_app") out.push(field("cmd", "Shell command (runs in the workspace root)", input(k("command"), b.command, "field", { multiline: true, rows: 5 })));
  if (b.type === "script") out.push(field("timeout", "Timeout (seconds, default 1800)", input(k("timeoutSeconds"), b.timeoutSeconds, "field")));
  if (b.type === "run_app") {
    out.push(field("app", "App name", input(`app:${b.id}:name`, b.app?.name, "appName")));
    out.push(muted("app-actions", "Allowed actions for connected agents"));
    out.push({ type: "row", key: "acts", gap: 6, wrap: true, children: ["start", "status", "kill", "tail"].map((a) => ({ type: "toggle", key: `act:${b.id}:${a}`, label: a, checked: !b.app?.actions?.length || b.app.actions.includes(a), action: "appAct", value: a })) });
  }
  if (b.type === "timer") out.push(field("secs", "Seconds", input(k("seconds"), b.seconds, "field")));
  if (b.type === "skill") out.push(field("skill", "Existing workspace skill", {
    type: "select",
    key: k("skillId"),
    value: b.skillId || "",
    action: "field",
    options: [{ value: "", label: "Custom instructions" }, ...(c?.skills || []).map((s) => ({ value: s.path, label: s.name }))]
  }));
  if (b.type === "mcp") out.push(field("mcp", "MCP server", { type: "select", key: `mcp:${b.id}`, value: b.mcp?.serverId || "", action: "mcpServer", options: (c?.mcps || []).map((m) => ({ value: m.id, label: m.name })) }));
  if (S.draft.edges.filter((e) => e.to === b.id && edgeType(e) !== "use").length > 1)
    out.push(field("join", "When several connections arrive", { type: "select", key: k("join"), value: b.join || "all", action: "field", options: [{ value: "all", label: "Wait for all active branches" }, { value: "any", label: "Run on the first one" }] }));
  S.issues.filter((i) => i.blockId === b.id).forEach((i, n) => out.push({ type: "status", key: `iss-${n}`, level: i.severity === "warning" ? "warn" : "error", text: i.message }));
  const run = designerRun(), st = run?.blocks.find((s) => s.blockId === b.id);
  if (run && st && (st.status !== "idle" || st.log?.length || st.meeting)) out.push({ type: "divider", key: "rd" }, ...blockRunView(run, b, st, "insp"));
  return out;
}
function edgeInspector(e) {
  const a = block(e.from), b = block(e.to), t = edgeType(e);
  return [
    { type: "row", key: "eh", gap: 6, children: [text("et", "Connection", { weight: "semibold", grow: true, size: "md" }), icon("edel", uiIcons.trash, "deleteEdge", "Delete connection", { value: e.id })] },
    text("ends", `${a?.label || e.from} → ${b?.label || e.to}`),
    field("type", "Type", { type: "select", key: `e:${e.id}:type`, value: t, action: "edgeField", options: [{ value: "follow", label: "Follow: run with the output" }, { value: "use", label: "Use: tool of the source agent" }, { value: "path", label: "Path: named route" }] }),
    ...t === "path" ? [field("route", "Route name", input(`e:${e.id}:label`, e.label, "edgeField"))] : [],
    ...t === "use" ? [field("tmo", "Tool call timeout (seconds, default 300)", input(`e:${e.id}:timeoutMs`, e.timeoutMs ? e.timeoutMs / 1e3 : void 0, "edgeField"))] : [],
    ...t !== "use" ? [{ type: "switch", key: `e:${e.id}:loop`, label: "Loop (intentionally returns to an earlier block)", checked: !!e.loop, action: "edgeLoop" }] : [],
    ...S.issues.filter((i) => i.edgeId === e.id).map((i, n) => ({ type: "status", key: `iss-${n}`, level: i.severity === "warning" ? "warn" : "error", text: i.message }))
  ];
}
function workflowInspector() {
  const d = S.draft;
  return [
    text("wt", "Workflow", { weight: "semibold", size: "md" }),
    muted("help", "Add blocks from the menu. Drag a block to move it; drag from its round port onto another block to connect them with the selected connection type. Click a block or a connection label to edit it."),
    field("desc", "Description", input(`wf-desc:${d.id}`, d.description, "wfDesc", { multiline: true, rows: 3 })),
    field("loops", "Loop limit (default 100)", input(`wf-loops:${d.id}`, d.settings?.maxLoopCount, "wfSetting", { placeholder: "100" })),
    field("ask", "Ask AI to change this workflow", input("ask-designer", S.askText, "askText", { multiline: true, rows: 3, placeholder: "e.g. Add a reviewer agent that checks the script output" })),
    btn("ask-go", "Ask the configurator", "configure", { iconSvg: blockIcon.sparkles, disabled: S.busy || !S.askText.trim(), tooltip: "Starts a background agent with workflow editing tools and opens it in the AI chat" }),
    ...S.dirty ? [muted("ask-note", "Unsaved changes are saved first: the configurator edits the saved workflow.", { color: "warning" })] : [],
    { type: "divider", key: "d1" },
    text("it", S.issues.length ? "Issues" : "No issues", { weight: "medium" }),
    ...S.issues.slice(0, 30).map((i, n) => ({ type: "status", key: `wi-${n}`, level: i.severity === "warning" ? "warn" : "error", text: i.message }))
  ];
}
function designer() {
  const d = S.draft;
  if (!d) return text("no-draft", "Select a workflow to design.");
  const sel = S.selection?.kind === "block" ? block(S.selection.id) : void 0, se = S.selection?.kind === "edge" ? edge(S.selection.id) : void 0;
  const run = designerRun();
  return { type: "column", key: "designer", grow: true, children: [
    toolbar(),
    ...S.confirm?.kind === "block" ? [{ type: "row", key: "delete-block-confirmation", gap: 8, padding: 8, bg: "panel", children: [
      text("question", `Delete block "${block(S.confirm.id)?.label || S.confirm.id}" and its connections?`, { grow: true }),
      btn("cancel-delete", "Cancel", "confirmNo"),
      btn("confirm-delete", "Delete", "confirmYes", { variant: "danger" })
    ] }] : [],
    ...S.error ? [{ type: "status", key: "d-error", level: "error", text: S.error }] : [],
    ...run ? [{ type: "row", key: "d-run", gap: 6, padding: 4, children: [
      muted("d-run-l", `Showing run ${new Date(run.createdAt).toLocaleString()} · ${statusLabel(run.status)}${run.error ? ` · ${run.error}` : ""}`, { color: statusColor(run.status), grow: true })
    ] }] : [],
    { type: "split", key: "designer-split", direction: "horizontal", sizes: [1, 0], fixed: [null, 360], resizable: false, grow: true, children: [
      {
        type: "canvas",
        key: `canvas:${d.id}`,
        grid: CARD.grid,
        items: d.blocks.map(cardFor),
        edges: edgesFor(),
        grow: true,
        moveAction: "moveBlock",
        selectAction: "selectBlock",
        connectAction: "connect",
        edgeAction: "selectEdge",
        clickAction: "clearSelection"
      },
      { type: "column", key: "insp-wrap", borderSide: "left", grow: true, children: [
        {
          type: "column",
          key: `inspector:${S.selection?.kind || "wf"}:${S.selection?.id || ""}`,
          gap: 10,
          padding: 12,
          scroll: true,
          grow: true,
          children: sel ? blockInspector(sel) : se ? edgeInspector(se) : workflowInspector()
        }
      ] }
    ] }
  ] };
}

// ../sdk/filter-style.ts
var filterInput = { height: 32, style: { noShrink: true } };

// modules/ui/workflows-panel/src/library.ts
var definitionOf = (wf) => S.selectedId === wf && S.draft || S.defs.get(wf);
function toolbar2() {
  return [
    { type: "row", key: "toolbar", gap: 4, children: [
      { type: "textInput", key: "wf-filter", ...filterInput, prefixSvg: uiIcons.search, placeholder: "Filter workflows", value: S.filter, changeAction: "filter", grow: true },
      {
        type: "select",
        key: "template",
        value: S.newTemplate,
        action: "template",
        width: 150,
        options: (S.catalog?.templates || [{ id: "blank", name: "Blank workflow" }]).map((t) => ({ value: t.id, label: t.name }))
      },
      icon("new", uiIcons.plus, "create", "Create a workflow from the selected template", { disabled: !S.ws || S.busy }),
      icon("import", uiIcons.files, "importOpen", "Import workflow JSON", { disabled: !S.ws }),
      icon("refresh", uiIcons.refresh, "refresh", "Refresh", { disabled: !S.ws })
    ] },
    { type: "row", key: "heading", gap: 6, children: [
      text("count", `${S.list.length} workflow${S.list.length === 1 ? "" : "s"}`, { weight: "semibold", grow: true, wrap: false }),
      muted("where", S.ws ? `Runs on the ${S.ws.location === "ssh" ? "remote" : "local"} daemon` : "", { wrap: false })
    ] }
  ];
}
function statusChip(key, status) {
  return { type: "row", key, gap: 4, style: { background: "raised", radius: 10, paddingX: 7, paddingY: 1, noShrink: true }, children: [
    { type: "label", key: "d", text: "●", size: "xs", color: status === "idle" ? "muted" : statusColor(status) },
    { type: "label", key: "s", text: statusLabel(status), size: "xs", weight: "medium" }
  ] };
}
function startControls(w, def) {
  const starts = def.blocks.filter(isStartBlock);
  const k = (s) => `start:${w.id}:${s}`;
  if (!starts.length) return [{ type: "row", key: k("none"), gap: 6, align: "end", children: [
    { type: "textInput", key: k("input"), value: S.startText.get(`${w.id}:`) || "", changeAction: "startText", submitAction: "startInput", placeholder: "Run input (optional)", grow: true, multiline: true, rows: 2 },
    btn(k("go"), "Run", "startInput", { iconSvg: blockIcon.play, variant: "primary", value: `${w.id}:`, disabled: S.busy })
  ] }];
  return starts.map((b) => b.type === "start_button" ? { type: "row", key: k(b.id), gap: 8, style: { background: "background", borderColor: "border", borderWidth: 1, radius: 8, padding: 8 }, children: [
    { type: "column", key: "c", gap: 2, grow: true, children: [text("l", b.label, { weight: "medium" }), muted("p", b.prompt.length > 160 ? b.prompt.slice(0, 159) + "…" : b.prompt)] },
    btn("go", "Start", "startButton", { iconSvg: blockIcon.play, variant: "primary", value: `${w.id}:${b.id}`, disabled: S.busy || !b.prompt.trim() })
  ] } : { type: "column", key: k(b.id), gap: 6, style: { background: "background", borderColor: "border", borderWidth: 1, radius: 8, padding: 8 }, children: [
    text("l", b.label, { weight: "medium" }),
    { type: "row", key: "r", gap: 6, align: "end", children: [
      { type: "textInput", key: `start:${w.id}:${b.id}:text`, value: S.startText.get(`${w.id}:${b.id}`) || "", changeAction: "startText", submitAction: "startInput", placeholder: "What should this run do?", grow: true, multiline: true, rows: 2 },
      btn("go", "Start", "startInput", { iconSvg: blockIcon.play, variant: "primary", value: `${w.id}:${b.id}`, disabled: S.busy })
    ] }
  ] });
}
function workflowCard(w, maximized) {
  const open = maximized || S.open.has(w.id);
  const def = definitionOf(w.id);
  const runs2 = runsOf(w.id), run = shownRun(w.id);
  const latest = runs2[0], live = !!latest && ACTIVE.has(latest.status);
  const status = latest?.status || "idle";
  const graph = run?.definition || def;
  const starts = (def || graph)?.blocks.filter(isStartBlock) || [];
  const header = { type: "row", key: "header", gap: 6, children: [
    { type: "button", key: "ic", text: "", iconSvg: blockIcon.workflow, iconSize: 16, action: "toggleCard", value: w.id, small: true, variant: "ghost", style: { color: "primary" }, tooltip: open ? "Collapse" : "Show workflow" },
    { type: "column", key: "title", gap: 0, grow: true, children: [
      text("name", w.name, { weight: "semibold", size: "md", wrap: false }),
      ...open ? [] : [muted("meta", `${w.blocks} block${w.blocks === 1 ? "" : "s"}${latest ? ` · last run ${new Date(latest.createdAt).toLocaleString()}` : ""}`, { wrap: false })]
    ] },
    statusChip("status", status),
    ...!open ? starts.slice(0, 3).map((b) => icon(`qs-${b.id}`, b.type === "start_input" ? blockIcon["circle-play"] : blockIcon.play, b.type === "start_input" ? "quickStart" : "startButton", `Start: ${b.label}`, { value: `${w.id}:${b.id}`, disabled: S.busy })) : [],
    icon("design", blockIcon.edit, "openDesigner", "Open in the designer", { value: w.id }),
    ...open && def ? [icon("json", blockIcon.copy, "", "Copy workflow JSON", { copyText: JSON.stringify(def, null, 2) }), icon("del-wf", uiIcons.trash, "confirmWorkflow", "Delete workflow", { value: w.id })] : [],
    ...!maximized ? [icon("fold", open ? blockIcon["chevron-up"] : blockIcon["chevron-down"], "toggleCard", open ? "Collapse workflow" : "Show workflow content", { value: w.id })] : [],
    icon("max", maximized ? blockIcon.minimize : blockIcon.maximize, "maximize", maximized ? "Restore item size" : "Expand to panel", { value: w.id })
  ] };
  const children = [header];
  if (!open) {
    if (live && run && graph) children.push(preview(`narrow:${w.id}`, graph, run, void 0, { maxHeight: 70 }));
    if (S.quick?.wf === w.id) {
      const b = graph?.blocks.find((x) => x.id === S.quick.block);
      children.push({ type: "row", key: "quick", gap: 6, align: "end", children: [
        { type: "textInput", key: `start:${w.id}:${S.quick.block}:text`, value: S.startText.get(`${w.id}:${S.quick.block}`) || "", changeAction: "startText", submitAction: "startInput", placeholder: b ? `${b.label}: what should this run do?` : "Run input", grow: true, multiline: true, rows: 2 },
        btn("go", "Start", "startInput", { iconSvg: blockIcon.play, variant: "primary", value: `${w.id}:${S.quick.block}`, disabled: S.busy })
      ] });
    }
    return card(`card:${w.id}`, children, { style: { borderColor: live ? "primary" : "border", paddingY: 8 } });
  }
  if (!graph) {
    children.push(muted("loading", "Loading workflow…"));
    return card(`card:${w.id}`, children);
  }
  const selectedBlock = S.cardBlock.get(w.id);
  if (run) {
    const done = run.blocks.filter((b) => b.status === "succeeded").length;
    children.push({ type: "row", key: "meta", gap: 6, wrap: true, children: [
      {
        type: "select",
        key: `runsel:${w.id}`,
        value: run.id,
        action: "cardRun",
        grow: true,
        options: runs2.map((r) => ({ value: r.id, label: `${statusLabel(r.status)} · ${new Date(r.createdAt).toLocaleString()}` }))
      },
      muted("done", `${done}/${graph.blocks.length} complete`, { wrap: false })
    ] });
    children.push({ type: "row", key: "controls", gap: 2, children: [
      ...run.input ? [muted("input", `Prompt: ${run.input.replace(/\s+/g, " ").slice(0, 90)}`, { grow: true, wrap: false })] : [{ type: "spacer", key: "sp" }],
      icon("new-run", blockIcon.play, "newRun", "Choose a starting point for a new run", { value: w.id, variant: S.starting === w.id ? "primary" : "ghost" }),
      ...!ACTIVE.has(run.status) ? [icon("rerun", blockIcon.rerun, "rerun", "Rerun with the same prompt and start block", { value: run.id, disabled: S.busy })] : [],
      ...ACTIVE.has(run.status) ? [icon("stop", blockIcon.stop, "cancelRun", "Stop this run", { value: run.id, variant: "danger" })] : [icon("del-run", uiIcons.trash, "confirmRun", "Delete this run and its agent sessions", { value: run.id })]
    ] });
    if (S.starting === w.id && def) children.push(...startControls(w, def));
  } else {
    children.push(muted("hint", `${graph.blocks.length} blocks · ${graph.blocks.some((b) => b.type === "chatbox") ? "Open a Chatbox or choose a starting point" : "Choose a starting point"}`));
    if (def) children.push(...startControls(w, def));
  }
  children.push(preview(`preview:${w.id}`, graph, run, selectedBlock, { maxHeight: maximized ? 420 : 220 }));
  if (run) {
    for (const p of pausedBlocks(run)) {
      const b = graph.blocks.find((x) => x.id === p.blockId);
      if (b && p.blockId !== selectedBlock) children.push(card(`pause:${p.blockId}`, blockRunView(run, b, p, "pause"), { style: { background: "background", borderColor: "warning" } }));
    }
    if (run.error) children.push({ type: "status", key: "run-error", level: run.status === "cancelled" ? "warn" : "error", text: run.error });
  }
  const sb = selectedBlock && graph.blocks.find((b) => b.id === selectedBlock);
  if (sb) {
    const st = run?.blocks.find((s) => s.blockId === sb.id);
    children.push(card(`detail:${sb.id}`, st && run && (sb.type === "chatbox" || st.status !== "idle" || st.log?.length || st.meeting) ? blockRunView(run, sb, st, "detail", false) : [
      { type: "row", key: "h", gap: 6, children: [
        { type: "button", key: "i", text: "", iconSvg: blockIcon[sb.type], iconSize: 14, action: "", small: true, variant: "ghost", style: { color: blockColor[sb.type] } },
        text("n", sb.label, { weight: "semibold", grow: true }),
        muted("s", run ? "Not run" : "Ready", { wrap: false })
      ] },
      ...sb.prompt || sb.command ? [muted("p", (sb.command || sb.prompt).slice(0, 400))] : []
    ], { style: { background: "background" } }));
    if (run && st) children.push(activityLog(run, st, "detail"));
  }
  const content = maximized ? [children[0], { type: "column", key: "card-content", scroll: true, grow: true, gap: 8, children: children.slice(1) }] : children;
  return card(`card:${w.id}`, content, { style: { borderColor: live ? "primary" : "border" }, ...maximized ? { grow: true } : {} });
}
function library() {
  const nodes = [...toolbar2()];
  if (!S.ws) {
    nodes.push(muted("none", "Select a workspace to design and run its workflows.", { size: "sm" }));
    return nodes;
  }
  if (S.error) nodes.push({ type: "status", key: "error", level: "error", text: S.error });
  if (S.notice) nodes.push({ type: "status", key: "notice", level: "success", text: S.notice });
  if (S.busy) nodes.push({ type: "progress", key: "busy", indeterminate: true });
  if (!S.catalog && !S.error) nodes.push(muted("loading", "Connecting to the workspace runtime…", { size: "sm" }));
  const q = S.filter.trim().toLowerCase();
  if (S.maximized) {
    const w = S.list.find((x) => x.id === S.maximized);
    if (w) return [workflowCard(w, true)];
  }
  const shown = S.list.filter((w) => !q || w.name.toLowerCase().includes(q) || (w.description || "").toLowerCase().includes(q));
  for (const w of shown) nodes.push(workflowCard(w, false));
  if (S.catalog && !S.list.length) nodes.push(card("empty", [
    text("t", "No workflows yet", { weight: "semibold" }),
    muted("d", "Pick a template above and press + to create one, or import a HatoPad workflow JSON.", { size: "sm" })
  ]));
  else if (q && !shown.length) nodes.push(muted("nomatch", "No matching workflows.", { size: "sm" }));
  return nodes;
}

// modules/ui/workflows-panel/src/index.ts
var animationTimer = null;
var timer = null;
var tick = 0;
var polling = false;
async function setup(ctx) {
  const mine = ++S.epoch;
  Object.assign(S, { catalog: null, list: [], recent: [], error: null });
  S.details.clear();
  S.chatHistory.clear();
  ctx.ui.invalidate();
  if (!S.ws || !S.visible && !S.designerOpen) return;
  try {
    const [c, l, r] = await Promise.all([call(ctx, "catalog"), call(ctx, "list"), call(ctx, "runs")]);
    if (mine !== S.epoch) return;
    Object.assign(S, { catalog: c, list: l, recent: r });
    if (c.templates?.length && !c.templates.some((t) => t.id === S.newTemplate)) S.newTemplate = c.templates.find((t) => t.id === "multi-agent-setup")?.id || c.templates[0].id;
    if (!S.open.size && l[0]) S.open.add(l[0].id);
    await refreshDetails(ctx);
    if (S.designerOpen && S.selection?.kind === "block") void loadProviderChoices(ctx, S.selection.id);
  } catch (e) {
    if (mine === S.epoch) S.error = errMsg(e);
  }
  ctx.ui.invalidate();
}
async function refreshList(ctx) {
  S.list = await call(ctx, "list");
}
async function refreshRuns(ctx) {
  S.recent = await call(ctx, "runs");
}
async function refreshDetails(ctx) {
  for (const w of S.list) {
    const open = S.open.has(w.id) || S.maximized === w.id || S.designerOpen && S.selectedId === w.id;
    const live = !!latestRun(w.id) && ACTIVE.has(latestRun(w.id).status);
    if (!open && !live) continue;
    if (open && !definitionOf(w.id)) S.defs.set(w.id, (await call(ctx, "get", { id: w.id })).definition);
    const id = shownRunId(w.id);
    if (!id) continue;
    const cached = S.details.get(id);
    if (!cached || ACTIVE.has(cached.status) || cached.status !== S.recent.find((r) => r.id === id)?.status || cached.blocks.some((b) => b.sessionId && cached.definition.blocks.find((d) => d.id === b.blockId)?.type === "chatbox")) S.details.set(id, rememberChatHistory(await call(ctx, "runDetail", { runId: id })));
  }
}
function schedule(ctx) {
  const want = !!S.ws && (S.visible || S.designerOpen);
  if (want && !animationTimer) animationTimer = setInterval(() => {
    if (tickTransfers()) ctx.ui.invalidate();
  }, 80);
  if (!want && animationTimer) {
    clearInterval(animationTimer);
    animationTimer = null;
    clearTransfers();
  }
  if (want && !timer) timer = setInterval(() => {
    void poll(ctx);
  }, 1200);
  if (!want && timer) {
    clearInterval(timer);
    timer = null;
  }
}
async function poll(ctx) {
  if (polling || !S.ws || !S.catalog) return;
  polling = true;
  const mine = S.epoch;
  try {
    tick++;
    const live = S.recent.some((r) => ACTIVE.has(r.status));
    if (live || tick % 4 === 0) await refreshRuns(ctx);
    await refreshDetails(ctx);
    if (mine === S.epoch) ctx.ui.invalidate();
  } catch {
  } finally {
    polling = false;
  }
}
async function act(ctx, fn) {
  const mine = S.epoch;
  S.busy = true;
  S.error = null;
  S.notice = null;
  ctx.ui.invalidate();
  try {
    await fn();
  } catch (e) {
    if (mine === S.epoch) S.error = errMsg(e);
  } finally {
    if (mine === S.epoch) {
      S.busy = false;
      ctx.ui.invalidate();
    }
  }
}
async function startRun(ctx, wf, startBlockId, input2) {
  if (S.selectedId === wf && S.dirty) await saveDraft(ctx);
  const def = definitionOf(wf) || (await call(ctx, "get", { id: wf })).definition;
  const r = await call(ctx, "run", { id: wf, input: input2, startBlockId: startBlockId || void 0 });
  S.cardRun.set(wf, r.id);
  S.open.add(wf);
  S.starting = null;
  S.quick = null;
  S.defs.set(wf, def);
  const chatbox = def.blocks.find((b) => b.type === "chatbox" && !def.edges.some((e) => e.to === b.id));
  if (!startBlockId && !input2.trim() && !def.blocks.some(isStartBlock) && chatbox) S.cardBlock.set(wf, chatbox.id);
  S.startText.delete(`${wf}:${startBlockId || ""}`);
  await refreshRuns(ctx);
  await refreshDetails(ctx);
}
var runWorkflow = (runId) => S.recent.find((r) => r.id === runId)?.workflowId || S.details.get(runId)?.workflowId;
async function reloadRun(ctx, runId) {
  S.details.set(runId, rememberChatHistory(await call(ctx, "runDetail", { runId })));
  await refreshRuns(ctx);
}
var split2 = (v) => {
  const i = v.indexOf(":");
  return [v.slice(0, i), v.slice(i + 1)];
};
var workspaceDrafts = /* @__PURE__ */ new Map();
function draftState() {
  return {
    selectedId: S.selectedId,
    draft: S.draft,
    revision: S.revision,
    dirty: S.dirty,
    issues: S.issues,
    undo: S.undo,
    redo: S.redo,
    selection: S.selection
  };
}
function snapshot2() {
  return {
    workspaceDrafts: [...workspaceDrafts],
    ...draftState(),
    workspaceId: S.ws?.id,
    selectedId: S.selectedId,
    draft: S.draft,
    revision: S.revision,
    dirty: S.dirty,
    issues: S.issues,
    mode: S.mode,
    designerOpen: S.designerOpen,
    designerInline: S.designerInline,
    designerSize: S.designerSize,
    open: [...S.open],
    logOpen: [...S.logOpen],
    maximized: S.maximized,
    cardRun: [...S.cardRun],
    filter: S.filter
  };
}
var mod = {
  id: "workflows-panel",
  moduleApiVersion: 1,
  async activate(ctx, prev) {
    S.ws = ctx.state.get("workspace.selected") || null;
    S.visible = !!ctx.state.get("workspace-layout.panels")?.workflows;
    for (const [id, draft] of prev?.workspaceDrafts || []) workspaceDrafts.set(id, draft);
    if (prev && prev.workspaceId === S.ws?.id) {
      Object.assign(S, {
        selectedId: prev.selectedId,
        draft: prev.draft,
        revision: prev.revision,
        dirty: !!prev.dirty,
        issues: prev.issues || [],
        mode: prev.mode || "follow",
        designerOpen: !!prev.designerOpen,
        designerInline: !!prev.designerInline,
        designerSize: prev.designerSize || S.designerSize,
        maximized: prev.maximized || null,
        filter: prev.filter || ""
      });
      S.undo = prev.undo || [];
      S.redo = prev.redo || [];
      S.selection = prev.selection || null;
      S.logOpen = new Set(prev.logOpen || []);
      S.open = new Set(prev.open || []);
      S.cardRun = new Map(prev.cardRun || []);
    }
    ctx.state.watch("workspace.selected", (next) => {
      if (next?.id === S.ws?.id) return;
      if (S.ws?.id) workspaceDrafts.set(S.ws.id, draftState());
      S.ws = next;
      S.open.clear();
      S.cardRun.clear();
      S.cardBlock.clear();
      S.defs.clear();
      S.maximized = null;
      Object.assign(S, {
        selectedId: null,
        draft: null,
        revision: null,
        dirty: false,
        issues: [],
        undo: [],
        redo: [],
        selection: null,
        starting: null,
        quick: null,
        confirm: null,
        importOpen: false,
        busy: false,
        designerInline: false,
        ...workspaceDrafts.get(next?.id) || {}
      });
      S.lastSnapshot = { at: 0, field: "" };
      S.startText.clear();
      S.chatDrafts.clear();
      S.answers.clear();
      S.designerOpen = false;
      void setup(ctx);
      schedule(ctx);
    });
    ctx.state.watch("workspace-layout.panels", (panels) => {
      const was = S.visible;
      S.visible = !!panels?.workflows;
      schedule(ctx);
      if (S.visible && !was && !S.catalog) void setup(ctx);
    });
    ctx.events.on("workflows.changed", (e) => {
      if (e?.workspaceId !== S.ws?.id) return;
      void (async () => {
        try {
          await refreshList(ctx);
          await refreshRuns(ctx);
          if (e.workflowId) {
            S.defs.delete(e.workflowId);
            if (e.workflowId === S.selectedId && !S.dirty) await openDraft(ctx, e.workflowId);
          }
          await refreshDetails(ctx);
        } catch (err) {
          if (e.workspaceId === S.ws?.id) S.error = errMsg(err);
        }
        ctx.ui.invalidate();
      })();
    });
    schedule(ctx);
    if (S.visible || S.designerOpen) await setup(ctx);
  },
  deactivate() {
    S.epoch++;
    if (animationTimer) clearInterval(animationTimer);
    animationTimer = null;
    clearTransfers();
    if (timer) clearInterval(timer);
    timer = null;
  },
  snapshot: snapshot2,
  render() {
    const inline = S.designerInline && S.designerOpen;
    const extra = [];
    if (S.confirm && !(S.confirm.kind === "block" && S.designerOpen)) {
      const c = S.confirm;
      const what = c.kind === "workflow" ? `Delete workflow "${S.list.find((w) => w.id === c.id)?.name || c.id}"? Its runs remain until deleted.` : c.kind === "run" ? "Delete this run and the background agent sessions it created?" : `Delete block "${block(c.id)?.label || c.id}" and its connections?`;
      extra.push({ type: "modal", key: "confirm", title: "Confirm", closeAction: "confirmNo", width: 380, children: [
        { type: "label", key: "c", text: what, wrap: true },
        { type: "row", key: "cb", gap: 6, children: [{ type: "spacer", key: "s" }, btn("no", "Cancel", "confirmNo"), btn("yes", "Delete", "confirmYes", { variant: "danger" })] }
      ] });
    }
    if (S.importOpen) extra.push({ type: "modal", key: "import", title: "Import workflow JSON", closeAction: "importClose", width: 560, children: [
      muted("i", "Paste a workflow definition (Hato or HatoPad format). It is saved as a new workflow.", { size: "sm" }),
      { type: "textInput", key: "import-text", value: S.importText, changeAction: "importText", multiline: true, rows: 14, placeholder: '{"name": …, "blocks": […], "edges": […]}' },
      { type: "row", key: "ib", gap: 6, children: [{ type: "spacer", key: "s" }, btn("c", "Cancel", "importClose"), btn("go", "Import", "importGo", { variant: "primary", disabled: !S.importText.trim() })] }
    ] });
    if (S.designerOpen && !S.designerInline && S.draft)
      extra.push({ type: "window", key: "designer-window", titlebar: false, title: `Workflow designer — ${S.draft.name}`, width: S.designerSize.width, height: S.designerSize.height, closeAction: "designerClosed", children: [designer()] });
    const maximized = !!S.maximized && !inline;
    return { type: "column", key: "root", gap: 10, padding: inline ? 0 : 10, grow: true, scroll: !inline && !maximized, children: [...inline ? [designer()] : library(), ...extra] };
  },
  async onEvent(ctx, ev) {
    const v = ev.value, a = ev.action, value = typeof v === "string" ? v : "", key = String(ev.key || "");
    try {
      switch (a) {
        // ---- library
        case "refresh":
          await act(ctx, () => setup(ctx));
          return;
        case "toggleActivity":
          if (S.logOpen.has(value)) S.logOpen.delete(value);
          else S.logOpen.add(value);
          ctx.ui.invalidate();
          return;
        case "filter":
          S.filter = value;
          ctx.ui.invalidate();
          return;
        case "template":
          S.newTemplate = value || "blank";
          return;
        case "create":
          await act(ctx, async () => {
            const r = await call(ctx, "create", { templateId: S.newTemplate });
            await refreshList(ctx);
            S.open.add(r.id);
            S.defs.set(r.id, r.definition);
            S.notice = `Created "${r.definition.name}"`;
          });
          return;
        case "toggleCard":
          if (S.open.has(value)) {
            S.open.delete(value);
            if (S.maximized === value) S.maximized = null;
          } else S.open.add(value);
          await act(ctx, () => refreshDetails(ctx));
          return;
        case "maximize":
          S.maximized = S.maximized === value ? null : value;
          if (S.maximized) S.open.add(value);
          await act(ctx, () => refreshDetails(ctx));
          return;
        case "cardRun": {
          const wf = key.slice("runsel:".length);
          S.cardRun.set(wf, value);
          S.cardBlock.delete(wf);
          await act(ctx, () => refreshDetails(ctx));
          return;
        }
        case "previewSelect": {
          const wf = key.slice(key.indexOf(":") + 1);
          if (key.startsWith("narrow:")) S.open.add(wf);
          S.cardBlock.get(wf) === v?.key ? S.cardBlock.delete(wf) : S.cardBlock.set(wf, v?.key);
          await act(ctx, () => refreshDetails(ctx));
          return;
        }
        case "newRun":
          S.starting = S.starting === value ? null : value;
          ctx.ui.invalidate();
          return;
        case "quickStart": {
          const [wf, b] = split2(value);
          S.quick = S.quick?.wf === wf && S.quick.block === b ? null : { wf, block: b };
          ctx.ui.invalidate();
          return;
        }
        case "startText": {
          const m = key.match(/^start:([^:]+):(?:([^:]+):text|input)$/);
          if (m) S.startText.set(`${m[1]}:${m[2] || ""}`, value);
          return;
        }
        case "startButton": {
          const [wf, b] = split2(value);
          await act(ctx, () => startRun(ctx, wf, b, ""));
          return;
        }
        case "startInput": {
          const ref = value || key.replace(/^start:/, "").replace(/:text$|:input$/, "") + (key.endsWith(":input") ? ":" : "");
          const [wf, b] = split2(ref.includes(":") ? ref : `${ref}:`);
          const inputKey = b ? `start:${wf}:${b}:text` : `start:${wf}:input`;
          const textValue = String(ev.inputs?.[inputKey] ?? S.startText.get(`${wf}:${b}`) ?? "");
          if (b && definitionOf(wf)?.blocks.find((x) => x.id === b)?.type === "start_input" && !textValue.trim()) {
            S.error = "Type what this run should do first.";
            ctx.ui.invalidate();
            return;
          }
          await act(ctx, () => startRun(ctx, wf, b || void 0, textValue));
          return;
        }
        case "rerun": {
          const d = S.details.get(value), wf = runWorkflow(value);
          if (!d || !wf) return;
          await act(ctx, () => startRun(ctx, wf, d.startBlockId, d.input));
          return;
        }
        case "cancelRun":
          if (value) await act(ctx, async () => {
            await call(ctx, "cancel", { runId: value });
            await reloadRun(ctx, value);
          });
          return;
        case "importOpen":
          S.importOpen = true;
          S.importText = "";
          ctx.ui.invalidate();
          return;
        case "importClose":
          S.importOpen = false;
          ctx.ui.invalidate();
          return;
        case "importText":
          S.importText = value;
          return;
        case "importGo":
          await act(ctx, async () => {
            const parsed = normalizeDefinition(JSON.parse(ev.inputs?.["import-text"] ?? S.importText));
            const r = await call(ctx, "create", { templateId: "blank", name: parsed.name, definition: parsed });
            S.importOpen = false;
            await refreshList(ctx);
            S.open.add(r.id);
            S.defs.set(r.id, r.definition);
          });
          return;
        case "confirmWorkflow":
          S.confirm = { kind: "workflow", id: value };
          ctx.ui.invalidate();
          return;
        case "confirmRun":
          S.confirm = { kind: "run", id: value };
          ctx.ui.invalidate();
          return;
        case "confirmBlock":
          if (block(value)) S.confirm = { kind: "block", id: value, wf: S.draft?.id };
          ctx.ui.invalidate();
          return;
        case "confirmNo":
          S.confirm = null;
          ctx.ui.invalidate();
          return;
        case "confirmYes": {
          const c = S.confirm;
          S.confirm = null;
          if (!c) return;
          if (c.kind === "block") {
            if (c.wf !== S.draft?.id) return;
            removeBlock(c.id);
            ctx.ui.invalidate();
            return;
          }
          await act(ctx, async () => {
            if (c.kind === "workflow") {
              await call(ctx, "remove", { id: c.id });
              S.open.delete(c.id);
              S.defs.delete(c.id);
              if (S.maximized === c.id) S.maximized = null;
              if (S.selectedId === c.id) Object.assign(S, { selectedId: null, draft: null, dirty: false, designerOpen: false });
              await refreshList(ctx);
            } else {
              const wf = runWorkflow(c.id);
              await call(ctx, "removeRun", { runId: c.id });
              S.details.delete(c.id);
              if (wf && S.cardRun.get(wf) === c.id) S.cardRun.delete(wf);
              await refreshRuns(ctx);
              await refreshDetails(ctx);
            }
          });
          return;
        }
        // ---- run interaction
        case "answerText": {
          const id = key.split(":").pop();
          S.answers.set(id, value);
          return;
        }
        case "answer":
          await act(ctx, async () => {
            await call(ctx, "answer", { runId: v.runId, blockId: v.blockId, pauseId: v.pauseId, answer: v.answer });
            await reloadRun(ctx, v.runId);
          });
          return;
        case "answerSubmit": {
          const ref = key.startsWith("answer:") ? key : value;
          const [, runId, pauseId] = ref.split(":");
          const st = S.details.get(runId)?.blocks.find((s) => s.pauseId === pauseId);
          if (!st) return;
          const textValue = String(ev.inputs?.[`answer:${runId}:${pauseId}`] ?? S.answers.get(pauseId) ?? "");
          await act(ctx, async () => {
            await call(ctx, "answer", { runId, blockId: st.blockId, pauseId, answer: textValue });
            S.answers.delete(pauseId);
            await reloadRun(ctx, runId);
          });
          return;
        }
        case "chatHistoryOlder": {
          const ref = value || key.slice(key.indexOf("["));
          const [runId, blockId] = JSON.parse(ref);
          const history = S.chatHistory.get(ref);
          if (!history || history.loading || history.before === null) return;
          history.loading = true;
          history.error = void 0;
          ctx.ui.invalidate();
          try {
            const page = await call(ctx, "chatHistory", { runId, blockId, before: history.before });
            if (S.chatHistory.get(ref) !== history || page.sessionId !== history.sessionId) return;
            const messages = new Map(page.messages.map((m) => [m.key, m]));
            for (const m of history.messages) messages.set(m.key, m);
            history.messages = [...messages.values()];
            history.before = page.before;
          } catch (e) {
            history.error = errMsg(e);
          } finally {
            history.loading = false;
            ctx.ui.invalidate();
          }
          return;
        }
        case "chatText":
          S.chatDrafts.set(key, value);
          return;
        case "chatSend": {
          const ref = key.startsWith("chat:") ? key : value;
          const [, runId, blockId] = ref.split(":");
          const current = S.details.get(runId)?.blocks.find((b) => b.blockId === blockId);
          if (current && chatStatus(current).busy) {
            S.notice = "The agent is still working. Your draft is kept here.";
            ctx.ui.invalidate();
            return;
          }
          const textValue = String(ev.inputs?.[ref] ?? S.chatDrafts.get(ref) ?? "").trim();
          if (!textValue) return;
          await act(ctx, async () => {
            await call(ctx, "chat", { runId, blockId, text: textValue });
            S.chatDrafts.delete(ref);
            await reloadRun(ctx, runId);
          });
          return;
        }
        case "openChat":
          ctx.events.emit("workflows-panel.openChat", { workspaceId: S.ws?.id, id: value });
          return;
        case "reviewPermission":
          await act(ctx, async () => {
            await call(ctx, "reviewPermission", { sessionId: v.sessionId, permissionId: v.permissionId }, 6e5);
            await refreshDetails(ctx);
          });
          return;
        // ---- designer lifecycle
        case "openDesigner": {
          const wf = value || ev.rowKey || S.selectedId;
          if (!wf) return;
          if (S.dirty && S.selectedId !== wf) {
            S.error = "Save the open designer's changes first.";
            ctx.ui.invalidate();
            return;
          }
          await act(ctx, async () => {
            if (S.selectedId !== wf || !S.draft) await openDraft(ctx, wf);
            S.designerOpen = true;
            schedule(ctx);
            await refreshDetails(ctx);
          });
          return;
        }
        case "closeDesigner":
          if (S.confirm?.kind === "block") S.confirm = null;
          S.designerOpen = false;
          S.designerInline = false;
          schedule(ctx);
          ctx.ui.invalidate();
          return;
        case "designerClosed":
          if (S.confirm?.kind === "block") S.confirm = null;
          S.designerOpen = false;
          if (v && Number.isFinite(v.width)) S.designerSize = { width: Math.max(800, v.width), height: Math.max(500, v.height) };
          schedule(ctx);
          ctx.ui.invalidate();
          return;
        case "toPanel":
          S.designerInline = true;
          ctx.events.emit("workflows-panel.reveal", {});
          ctx.ui.invalidate();
          return;
        case "toWindow":
          S.designerInline = false;
          ctx.ui.invalidate();
          return;
        case "designerRun": {
          const wf = S.selectedId;
          if (!wf || !S.draft) return;
          const first = S.draft.blocks.find(isStartBlock);
          if (blockingIssues(S.issues).length) return;
          if (first?.type === "start_input") {
            S.open.add(wf);
            S.starting = wf;
            S.designerInline = false;
            S.notice = "Type the run input in the Workflows panel.";
            ctx.events.emit("workflows-panel.reveal", {});
            ctx.ui.invalidate();
            return;
          }
          await act(ctx, () => startRun(ctx, wf, first?.id, ""));
          return;
        }
        case "askText":
          S.askText = value;
          return;
        case "configure":
          await act(ctx, async () => {
            if (S.dirty) await saveDraft(ctx);
            const request = String(ev.inputs?.["ask-designer"] ?? S.askText).trim();
            const r = await call(ctx, "configure", { workflowId: S.draft?.id, request });
            S.askText = "";
            S.notice = "The configurator is working in the AI chat; this workflow reloads when it saves.";
            ctx.events.emit("workflows-panel.openChat", { workspaceId: r.workspaceId, id: r.id });
          });
          return;
        // ---- designer editing
        case "save":
          await act(ctx, async () => {
            await saveDraft(ctx);
            await refreshList(ctx);
          });
          return;
        case "undo":
          undoDraft();
          ctx.ui.invalidate();
          return;
        case "redo":
          redoDraft();
          ctx.ui.invalidate();
          return;
        case "mode":
          S.mode = value;
          ctx.ui.invalidate();
          return;
        case "addBlock":
          if (value) addBlock(value);
          ctx.ui.invalidate();
          if (S.selection?.kind === "block") await loadProviderChoices(ctx, S.selection.id);
          return;
        case "moveBlock": {
          const b = block(v?.key);
          if (!b) return;
          const x = Math.max(0, Math.round(v.x / CARD.snap) * CARD.snap), y = Math.max(0, Math.round(v.y / CARD.snap) * CARD.snap);
          if (b.position.x !== x || b.position.y !== y) mutate(() => {
            b.position = { x, y };
          });
          ctx.ui.invalidate();
          return;
        }
        case "selectBlock":
          S.selection = { kind: "block", id: v?.key };
          ctx.ui.invalidate();
          await loadProviderChoices(ctx, v?.key);
          return;
        case "loadProviderChoices":
          await loadProviderChoices(ctx, value, true);
          return;
        case "selectEdge":
          S.selection = { kind: "edge", id: v?.key };
          ctx.ui.invalidate();
          return;
        case "clearSelection":
          S.selection = null;
          ctx.ui.invalidate();
          return;
        case "connect":
          if (v?.from && v?.to) connect(v.from, v.to);
          ctx.ui.invalidate();
          return;
        case "duplicateBlock":
          duplicateBlock(value);
          ctx.ui.invalidate();
          return;
        case "deleteEdge":
          mutate((d) => {
            d.edges = d.edges.filter((e) => e.id !== value);
          });
          S.selection = null;
          ctx.ui.invalidate();
          return;
        case "renameId": {
          const old = key.slice(3);
          const next = String(ev.inputs?.[key] ?? value).trim();
          if (next && next !== old) renameBlockId(old, next);
          ctx.ui.invalidate();
          return;
        }
        case "field":
        case "fieldBool": {
          const [, id, f] = key.split(":");
          const b = block(id);
          if (!b) return;
          mutate(() => {
            setField(b, f, a === "fieldBool" ? v === true || value === "true" : value);
            if (f === "profileId") {
              delete b.model;
              delete b.reasoning;
              delete b.provider;
            }
            if (f === "model") delete b.reasoning;
          }, `${id}:${f}`);
          if (isAgentBlock(b) && ["profileId", "model"].includes(f)) await loadProviderChoices(ctx, id);
          if (["profileId", "model", "reasoning", "agentFile", "skillId", "join"].includes(f) || a === "fieldBool") ctx.ui.invalidate();
          return;
        }
        case "appName": {
          const id = key.split(":")[1];
          const b = block(id);
          if (!b) return;
          mutate(() => {
            b.app = { ...b.app || { name: "" }, name: value };
          }, `${id}:app`);
          return;
        }
        case "appAct": {
          const [, id, actName] = key.split(":");
          const b = block(id);
          if (!b) return;
          mutate(() => {
            const all = ["start", "status", "kill", "tail"];
            const cur = new Set(b.app?.actions?.length ? b.app.actions : all);
            if (cur.has(actName)) cur.delete(actName);
            else cur.add(actName);
            b.app = { ...b.app || { name: b.id }, actions: all.filter((x) => cur.has(x)) };
          });
          ctx.ui.invalidate();
          return;
        }
        case "mcpServer": {
          const id = key.split(":")[1];
          const b = block(id);
          if (!b) return;
          mutate(() => {
            b.mcp = { serverId: value };
          });
          ctx.ui.invalidate();
          return;
        }
        case "edgeField": {
          const [, id, f] = key.split(":");
          const e = edge(id);
          if (!e) return;
          mutate(() => {
            if (f === "timeoutMs") {
              const n = Number(value);
              if (Number.isFinite(n) && n > 0) e.timeoutMs = Math.round(n * 1e3);
              else delete e.timeoutMs;
            } else if (f === "type") {
              e.type = value;
              if (value !== "path") delete e.label;
              else e.label || (e.label = "route-1");
            } else setField(e, f, value);
          }, `${id}:${f}`);
          if (f === "type") ctx.ui.invalidate();
          return;
        }
        case "edgeLoop": {
          const id = key.split(":")[1];
          const e = edge(id);
          if (!e) return;
          mutate(() => {
            if (e.loop) delete e.loop;
            else e.loop = true;
          });
          ctx.ui.invalidate();
          return;
        }
        case "wfName":
          mutate((d) => {
            d.name = value;
          }, "wf:name");
          return;
        case "wfDesc":
          mutate((d) => {
            if (value) d.description = value;
            else delete d.description;
          }, "wf:desc");
          return;
        case "wfSetting":
          mutate((d) => {
            const n = Number(value);
            d.settings = { ...d.settings || {} };
            if (value.trim() && Number.isInteger(n) && n > 0) d.settings.maxLoopCount = n;
            else delete d.settings.maxLoopCount;
          }, "wf:loops");
          return;
        case "noop":
          return;
      }
    } catch (e) {
      S.error = errMsg(e);
      S.busy = false;
      ctx.ui.invalidate();
    }
  }
};
var index_default = mod;
export {
  index_default as default
};
