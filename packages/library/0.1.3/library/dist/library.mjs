// ../sdk/runtime.ts
function errMsg(e) {
  return e && (e.message || String(e)) || "unknown error";
}

// ../sdk/mcp.ts
function exportMcpTools(ctx, title, tools) {
  let pending = 0;
  const publish2 = () => ctx.state.set(`${ctx.moduleId}.mcp`, {
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
      const scope2 = request.scope;
      if (!scope2 || typeof scope2.workspaceId !== "string" || typeof scope2.conversationId !== "string" || typeof scope2.machineId !== "string") throw new Error("Missing authenticated MCP scope");
      const result = await tool.handler(request.args || {}, scope2);
      ctx.events.emit(`${ctx.moduleId}.mcp.result`, { id: request.id, generation: ctx.generation, result: result === void 0 ? null : result });
    } catch (e) {
      ctx.events.emit(`${ctx.moduleId}.mcp.result`, { id: request.id, generation: ctx.generation, error: errMsg(e) });
    } finally {
      pending--;
    }
  });
  publish2();
  return { publish: publish2, pending: () => pending };
}

// ../sdk/library.ts
var LIBRARY_STATE = "library.catalog";

// modules/services/library/src/index.ts
var db;
var writes = Promise.resolve();
var pendingWrites = 0;
var mcp;
var summary = ({ files, ...entry }) => ({ ...entry, paths: Object.keys(files).sort() });
function path(value) {
  if (typeof value !== "string" || value.length > 240 || !/^[a-zA-Z0-9_. /-]+\.(md|sh|json)$/.test(value) || value.startsWith("/") || value.split("/").some((p) => !p || p === "." || p === "..")) throw new Error("Use a relative .md, .sh or .json path without traversal");
  return value;
}
async function project(ctx, a) {
  if (a.scope === "global") return null;
  if (a.scope !== "project") throw new Error("scope must be global or project");
  return (await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId })).projectId;
}
async function all(ctx, a) {
  const projectId = await project(ctx, a);
  return (await ctx.host.db.query(db, "SELECT data FROM entries WHERE project_id=?", [projectId || ""])).map((r) => JSON.parse(r.data));
}
async function read(ctx, a) {
  const entry = (await all(ctx, a)).find((e) => e.id === a.id);
  if (!entry) throw new Error("Library entry not found in this scope");
  if (a.path !== void 0) {
    const key = path(a.path);
    if (!(key in entry.files)) throw new Error("File not found");
    return { ...summary(entry), path: key, content: entry.files[key] };
  }
  return summary(entry);
}
function serialize(f) {
  pendingWrites++;
  const next = writes.catch(() => {
  }).then(f).finally(() => {
    pendingWrites--;
  });
  writes = next;
  return next;
}
async function save(ctx, a) {
  return serialize(async () => {
    const projectId = await project(ctx, a);
    const entries = await all(ctx, a), old = entries.find((e) => e.id === a.id);
    if (a.id && !old) throw new Error("Library entry not found in this scope");
    if ((old?.revision ?? null) !== a.expectedRevision) throw new Error("Entry changed; reload before saving (expectedRevision required)");
    const entry = old ? { ...old, files: { ...old.files } } : { id: crypto.randomUUID(), projectId, kind: a.kind, name: a.name, description: a.description || "", revision: 0, files: {} };
    if (a.name !== void 0) entry.name = String(a.name).trim();
    if (a.description !== void 0) entry.description = String(a.description);
    if (a.machines !== void 0) {
      if (a.machines !== null && (!Array.isArray(a.machines) || a.machines.length > 100 || a.machines.some((m) => typeof m !== "string" || !m || m.length > 200))) throw new Error("machines must be a list of machine ids, or null for all machines");
      if (projectId && a.machines?.length) throw new Error("Machine availability applies to global entries only");
      entry.machines = a.machines?.length ? [...new Set(a.machines)].sort() : [];
    }
    if (!entry.name || entry.name.length > 120 || entry.description.length > 1e3 || !["skill", "agent", "workflow"].includes(entry.kind)) throw new Error("Invalid name, description or kind");
    if (a.path !== void 0) {
      const key = path(a.path);
      if (a.content === null) delete entry.files[key];
      else {
        if (typeof a.content !== "string" || a.content.length > 128 * 1024) throw new Error("File exceeds 128 KiB");
        entry.files[key] = a.content;
      }
    }
    const root = entry.kind === "skill" ? "SKILL.md" : entry.kind === "workflow" ? "WORKFLOW.json" : "AGENT.md";
    if (entry.kind === "workflow" && entry.files[root] !== void 0) {
      try {
        const d = JSON.parse(entry.files[root]);
        if (!d || typeof d !== "object" || !Array.isArray(d.blocks)) throw 0;
      } catch {
        throw new Error("WORKFLOW.json must be a workflow definition");
      }
    }
    if (!old && !entry.files[root] && entry.kind === "workflow") throw new Error("A workflow entry needs its WORKFLOW.json definition");
    if (!old && !entry.files[root]) entry.files[root] = (entry.kind === "skill" ? `---
name: ${JSON.stringify(entry.name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "") || "skill")}
description: ${JSON.stringify(entry.description)}
---

` : "") + `# ${entry.name}

${entry.description}
`;
    if (!entry.files[root]) throw new Error(`Keep the entry's ${root}`);
    if (Object.keys(entry.files).length > 200 || JSON.stringify(entry).length > 1024 * 1024) throw new Error("Entry exceeds 200 files or 1 MiB");
    entry.revision++;
    await ctx.host.db.exec(db, "INSERT INTO entries(id,project_id,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data", [entry.id, projectId || "", JSON.stringify(entry)]);
    ctx.events.emit("library.changed", { projectId });
    void publish(ctx);
    return summary(entry);
  });
}
async function remove(ctx, a) {
  return serialize(async () => {
    const entry = (await all(ctx, a)).find((e) => e.id === a.id);
    if (!entry) throw new Error("Library entry not found in this scope");
    if (entry.revision !== a.expectedRevision) throw new Error("Entry changed; reload before removing");
    await ctx.host.db.exec(db, "DELETE FROM entries WHERE id=?", [entry.id]);
    ctx.events.emit("library.changed", { projectId: entry.projectId });
    void publish(ctx);
    return { removed: true };
  });
}
var machines = /* @__PURE__ */ new Map();
var publishing = Promise.resolve();
function publish(ctx) {
  publishing = publishing.catch(() => {
  }).then(async () => {
    const rows = await ctx.host.db.query(db, "SELECT data FROM entries");
    const items = [];
    for (const r of rows) {
      const e = JSON.parse(r.data);
      if (e.kind !== "skill" && e.kind !== "agent") continue;
      const root = e.kind === "skill" ? "SKILL.md" : "AGENT.md";
      items.push({ id: e.id, kind: e.kind, name: e.name, description: e.description, projectId: e.projectId || null, machines: e.machines || [], text: e.files[root] || "", paths: Object.keys(e.files).sort(), revision: e.revision });
    }
    ctx.state.set(LIBRARY_STATE, { items, machines: machineList() });
  });
  return publishing;
}
function machineList() {
  const out = [...machines].map(([id, names]) => ({ id, label: id === "local" ? "This computer" : `${names.slice(0, 3).join(", ") || "SSH"} (${id.replace(/^ssh:/, "")})` }));
  if (!machines.has("local")) out.unshift({ id: "local", label: "This computer" });
  return out.sort((a, b) => Number(b.id === "local") - Number(a.id === "local") || a.label.localeCompare(b.label));
}
async function noteMachine(ctx, ws) {
  const id = typeof ws?.machineId === "string" ? ws.machineId : "";
  if (!id) return;
  const project2 = String(ws.name || "").split(" / ")[0].slice(0, 80);
  const names = machines.get(id) || [];
  if (machines.has(id) && (!project2 || names.includes(project2))) return;
  const next = project2 ? [...names.filter((n) => n !== project2), project2].slice(-5) : names;
  machines.set(id, next);
  await ctx.host.db.exec(db, "INSERT INTO machines(id,names) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET names=excluded.names", [id, JSON.stringify(next)]);
  void publish(ctx);
}
var object = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
var scope = { scope: { type: "string", enum: ["global", "project"] } };
var mod = {
  id: "library",
  moduleApiVersion: 1,
  async activate(ctx) {
    db = await ctx.host.db.openNamespace("library");
    await ctx.host.db.exec(db, "CREATE TABLE IF NOT EXISTS entries(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,data TEXT NOT NULL)");
    await ctx.host.db.exec(db, "CREATE TABLE IF NOT EXISTS machines(id TEXT PRIMARY KEY,names TEXT NOT NULL)");
    for (const r of await ctx.host.db.query(db, "SELECT id,names FROM machines")) {
      try {
        machines.set(r.id, JSON.parse(r.names));
      } catch {
        machines.set(r.id, []);
      }
    }
    await publish(ctx);
    void noteMachine(ctx, ctx.state.get("workspace.selected"));
    ctx.state.watch("workspace.selected", (ws) => {
      void noteMachine(ctx, ws);
    });
    const scoped = (a, s) => ({ ...a, workspaceId: s.workspaceId });
    mcp = exportMcpTools(ctx, "Library", [
      { name: "list", description: "List global or current-project skills and agent templates. Paginated metadata only; read an entry for file paths, then read individual files on demand.", inputSchema: object({ ...scope, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 50 } }, ["scope"]), annotations: { readOnlyHint: true }, handler: async (a, s) => {
        const offset = a.offset ?? 0, limit = a.limit ?? 25;
        if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error("Invalid page");
        const entries = (await all(ctx, scoped(a, s))).sort((a2, b) => a2.id.localeCompare(b.id));
        return { entries: entries.slice(offset, offset + limit).map(({ files, ...entry }) => ({ ...entry, fileCount: Object.keys(files).length })), nextOffset: offset + limit < entries.length ? offset + limit : null };
      } },
      { name: "read", description: "Read one Library file (.md or .sh), or list entry paths if path is omitted. Scripts are stored as text; never executed by this tool.", inputSchema: object({ ...scope, id: { type: "string" }, path: { type: "string" } }, ["scope", "id"]), annotations: { readOnlyHint: true }, handler: (a, s) => read(ctx, scoped(a, s)) },
      { name: "write", description: "Create an entry or edit one file/metadata. expectedRevision is null to create, otherwise the last read revision. content:null removes a nested file. Project scope is bound to this connection's project.", inputSchema: object({ ...scope, id: { type: "string" }, kind: { type: "string", enum: ["skill", "agent", "workflow"] }, name: { type: "string" }, machines: { type: ["array", "null"], items: { type: "string" }, description: "Global entries only: machine ids it is offered on; [] or null for all" }, description: { type: "string" }, path: { type: "string" }, content: { type: ["string", "null"] }, expectedRevision: { type: ["number", "null"] } }, ["scope", "expectedRevision"]), handler: (a, s) => save(ctx, scoped(a, s)) },
      { name: "remove", description: "Remove a Library entry and its files. Requires the last read revision.", inputSchema: object({ ...scope, id: { type: "string" }, expectedRevision: { type: "number" } }, ["scope", "id", "expectedRevision"]), annotations: { destructiveHint: true }, handler: (a, s) => remove(ctx, scoped(a, s)) }
    ]);
  },
  canSwap: () => ({ ok: !pendingWrites && (!mcp || !mcp.pending()), reason: "Library commands are running" }),
  async deactivate() {
    await writes;
    await publishing.catch(() => {
    });
  },
  methods: {
    list: async (ctx, a) => (await all(ctx, a)).map(summary),
    read,
    save,
    remove,
    /** Machines known to the Library, for availability pickers. */
    machines: () => machineList()
  }
};
var index_default = mod;
export {
  index_default as default
};
