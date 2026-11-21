import { exportMcpTools } from "@hato/sdk/mcp";
import type { AppModule, ModuleContext } from "@hato/sdk/types";
import { errMsg, targetFor, withWorkspace, workspaceGrant, type WorkspaceDescriptor } from "@hato/sdk/runtime";
import type { RunCandidate, RunConfig, RunConfigType } from "@hato/sdk/run-configurations";
import { mask, normalizeConfig, relativePath } from "./config";
import { environmentPreview, readText, resolveEnvironment, scanRunFiles } from "./workspace-files";

const providers = ["language-java", "language-typescript"];
const sharePath = ".hato/run.json";
const setting = "run-configurations";
let mcp: ReturnType<typeof exportMcpTools>;
let writing = 0;
let markersVersion = 0;
const projectWrites = new Map<string, Promise<unknown>>();

async function workspace(ctx: ModuleContext, id: string) {
  if (!id || typeof id !== "string") throw new Error("Select a project or task workspace");
  return ctx.modules.call<WorkspaceDescriptor>("workspace", "resolve", { workspaceId: id });
}

async function runTypes(ctx: ModuleContext) {
  const { plugins } = await ctx.host.plugins.list();
  const modules = providers.filter(id => plugins.some(p => p.id === id && p.enabled && p.active));
  const typed = await Promise.all(modules.map(async id => ({
    id, types: await ctx.modules.call<RunConfigType[]>(id, "runConfigurations.types", {}).catch(() => []),
  })));
  return typed.filter(p => p.types.length > 0);
}

const scope = (d: WorkspaceDescriptor) => `workspace:project:${d.projectId}:root`;
async function load(ctx: ModuleContext, d: WorkspaceDescriptor) {
  const saved = await ctx.modules.call<{ value: RunConfig[]; rev: number } | null>("persistence", "scoped.get", { scope: scope(d), key: setting });
  return { items: Array.isArray(saved?.value) ? saved.value : [], rev: saved?.rev ?? 0 };
}
async function save(ctx: ModuleContext, d: WorkspaceDescriptor, items: RunConfig[], expectedRev: number) {
  if (items.length > 100) throw new Error("A project can have up to 100 run configurations");
  await ctx.modules.call("persistence", "scoped.set", { scope: scope(d), key: setting, value: items, expectedRev });
  ctx.events.emit("run-configurations.changed", { workspaceId: d.id, projectId: d.projectId });
}
function find(items: RunConfig[], id: string) {
  const entry = items.find(item => item.id === id);
  if (!entry) throw new Error("Run configuration was not found in this project");
  return entry;
}
function redact(config: RunConfig) {
  return { ...config, env: Object.fromEntries(Object.keys(config.env).map(key => [key, mask])) };
}
function requireRevision(config: RunConfig, rev: unknown) {
  if (rev !== config.revision) throw new Error("Configuration changed. Reload it before saving or deleting.");
}

async function detect(ctx: ModuleContext, d: WorkspaceDescriptor) {
  const active = await runTypes(ctx);
  if (!active.length) return { candidates: [], limited: false, warnings: ["Enable an updated Java or JavaScript & TypeScript plugin to detect launch targets."] };
  const { limited, ...files } = await scanRunFiles(ctx, d);
  const replies = await Promise.all(active.map(async ({ id, types }) => {
    const allowed = new Set(types.map(type => type.id));
    // Send each provider only the source text it needs.
    const sources = files.sources.filter(f => id === "language-java" ? f.path.endsWith(".java") : f.path.endsWith("package.json"));
    try {
      const result = await ctx.modules.call<RunCandidate[]>(id, "runConfigurations.detect", { sources, paths: files.paths }, { timeoutMs: 60000 });
      return { candidates: result.filter(c => allowed.has(c.type)), warning: "" };
    } catch (e) { return { candidates: [], warning: `${id}: ${errMsg(e)}` }; }
  }));
  const candidates = new Map<string, RunCandidate>();
  for (const c of replies.flatMap(r => r.candidates)) candidates.set(JSON.stringify([c.type, c.cwd, c.target]), c);
  return {
    candidates: [...candidates.values()].slice(0, 200),
    limited: limited || candidates.size > 200,
    warnings: replies.map(r => r.warning).filter(Boolean),
  };
}

async function publishMarkers(ctx: ModuleContext, current: { workspaceId: string; path: string } | null) {
  const version = ++markersVersion;
  ctx.state.set("run-configurations.gutter", null);
  if (!current || !/(?:\.java|(?:^|\/)package\.json)$/.test(current.path)) return;
  try {
    const path = relativePath(current.path, "Source file");
    const d = await workspace(ctx, current.workspaceId);
    const provider = path.endsWith(".java") ? "language-java" : "language-typescript";
    if (!(await runTypes(ctx)).some(p => p.id === provider)) return;
    const source = await readText(ctx, d, path, 128 * 1024);
    // Package scripts are local to their manifest. For Java, include nearest build roots.
    const paths = [path];
    if (provider === "language-java") {
      const dirs = path.split("/").slice(0, -1);
      const grant = await workspaceGrant(ctx, d, "fs");
      for (let count = 0; count <= dirs.length; count++) {
        const parent = dirs.slice(0, count).join("/") || ".";
        const result = await ctx.host.fs.list(grant.grant, parent).catch(() => null);
        for (const entry of result?.entries ?? []) if (["pom.xml", "build.gradle", "build.gradle.kts"].includes(entry.name)) {
          paths.push(parent === "." ? entry.name : `${parent}/${entry.name}`);
        }
      }
    }
    const candidates = await ctx.modules.call<RunCandidate[]>(provider, "runConfigurations.detect", { sources: [{ path, text: source }], paths });
    if (version !== markersVersion) return;
    ctx.state.set("run-configurations.gutter", { ...current, candidates: candidates.filter(c => c.file === path && c.type !== "node") });
  } catch (e) { ctx.log.debug("run gutter detection", errMsg(e)); }
}

type Crud = "list" | "get" | "create" | "update" | "delete" | "detect";
async function operation(ctx: ModuleContext, d: WorkspaceDescriptor, op: Crud, a: any, privateValues = false) {
  if (op === "detect") return detect(ctx, d);
  const { items, rev } = await load(ctx, d);
  if (op === "list") return items.map(redact);
  if (op === "get") {
    const config = find(items, a.id);
    return privateValues ? config : redact(config);
  }
  if (op === "delete") {
    const config = find(items, a.id);
    requireRevision(config, a.revision);
    if (config.shared) await updateShare(ctx, d, config.name);
    await save(ctx, d, items.filter(c => c.id !== config.id), rev);
    return { deleted: config.id };
  }
  const prev = op === "update" ? find(items, a.id) : null;
  if (prev) requireRevision(prev, a.revision);
  if (!a.config || typeof a.config !== "object" || Array.isArray(a.config)) throw new Error("Provide configuration fields");
  const draft = normalizeConfig({ ...prev, ...a.config });
  if (!privateValues && Object.values(a.config.env ?? {}).includes(mask)) throw new Error("Omit env to preserve the stored values, or provide replacement values");
  if (draft.type !== prev?.type && !(await runTypes(ctx)).some(p => p.types.some(type => type.id === draft.type))) throw new Error("Enable the language plugin for this configuration type");
  if (items.some(item => item.id !== prev?.id && item.name.toLowerCase() === draft.name.toLowerCase())) throw new Error("A run configuration already uses that name");
  const config = { ...draft, id: prev?.id ?? crypto.randomUUID(), revision: (prev?.revision ?? 0) + 1 };
  if (config.shared || prev?.shared) await updateShare(ctx, d, prev?.shared ? prev.name : undefined, config.shared ? config : undefined);
  await save(ctx, d, prev ? items.map(c => c.id === prev.id ? config : c) : [...items, config], rev);
  return privateValues ? config : redact(config);
}

function dispatch(ctx: ModuleContext, d: WorkspaceDescriptor, op: Crud, a: any, privateValues = false) {
  if (op === "list" || op === "get" || op === "detect") return operation(ctx, d, op, a, privateValues);
  return writeProject(d.projectId, () => operation(ctx, d, op, a, privateValues));
}

function writeProject<T>(projectId: string, work: () => Promise<T>): Promise<T> {
  const next = (projectWrites.get(projectId) ?? Promise.resolve()).then(work);
  const tail = next.catch(() => {});
  projectWrites.set(projectId, tail);
  void tail.finally(() => { if (projectWrites.get(projectId) === tail) projectWrites.delete(projectId); });
  return next;
}

async function tracked<T>(op: () => Promise<T>): Promise<T> {
  writing++;
  try { return await op(); }
  finally { writing--; }
}

async function readShare(ctx: ModuleContext, d: WorkspaceDescriptor) {
  const raw = JSON.parse(await readText(ctx, d, sharePath, 256 * 1024));
  if (raw?.version !== 1 || !Array.isArray(raw.configurations) || raw.configurations.length > 100) throw new Error("Unsupported .hato/run.json format");
  return raw.configurations.map(normalizeConfig);
}

async function updateShare(ctx: ModuleContext, d: WorkspaceDescriptor, oldName?: string, config?: RunConfig) {
  const shared = await readShare(ctx, d).catch(e => {
    if (e.code === "ENOENT") return [];
    throw e;
  });
  const collision = config && shared.some(c => c.name === config.name && c.name !== oldName);
  if (collision) throw new Error("A shared configuration already has this name. Import or rename it first.");
  const next = shared.filter(c => c.name !== oldName);
  if (config) next.push({ ...config, env: {} });
  await writeShare(ctx, d, next, true, true);
}

async function writeShare(ctx: ModuleContext, d: WorkspaceDescriptor, items: ReturnType<typeof normalizeConfig>[], replace: boolean, preservePublishedEnv = false) {
  const json = { version: 1, configurations: items.map(config => {
    const { id: _id, revision: _rev, env, shared: _shared, ...rest } = config as RunConfig;
    return { ...rest, ...(preservePublishedEnv && Object.keys(env).length ? { env } : {}) };
  }) };
  const text = JSON.stringify(json, null, 2) + "\n";
  if (text.length > 120 * 1024) throw new Error("The exported configuration file is too large");
  return withWorkspace(ctx, d, async () => {
    const grant = await ctx.host.capabilities.request({ kind: "fs", root: d.rootAbsolutePath,
      target: await targetFor(ctx, d), write: true, purpose: "Export run configurations" });
    try {
      if (!replace) {
        const existing = await ctx.host.fs.stat(grant.grant, sharePath).catch(e => {
          if (e.code === "ENOENT") return null;
          throw e;
        });
        if (existing) throw new Error("A shared file already exists. Import it or confirm replacement.");
      }
      await ctx.host.fs.mkdir(grant.grant, ".hato");
      await ctx.host.fs.writeAtomic(grant.grant, sharePath, text, { reason: "Export project run configurations" });
      return { count: items.length };
    } finally { await ctx.host.capabilities.release(grant.grant); }
  });
}

const string = { type: "string" }, revision = { type: "integer", minimum: 1 };
const strings = { type: "array", items: string };
const draft = { type: "object", additionalProperties: false, properties: {
  name: string, type: string, target: string, args: strings, runtimeArgs: strings, cwd: string,
  env: { type: "object", additionalProperties: string }, envFiles: strings, profiles: strings, runtime: string,
  shared: { type: "boolean" },
  beforeLaunch: { type: "array", items: { type: "object", properties: { kind: { enum: ["build", "npm", "configuration", "command"] }, executable: string, args: strings, cwd: string }, required: ["executable"], additionalProperties: false } },
} };
const definitions: [Crud, string, Record<string, unknown>, string[]][] = [
  ["list", "List run configurations for the authenticated project, with inline environment values masked.", {}, []],
  ["get", "Read a run configuration in this project, with inline environment values masked.", { id: string }, ["id"]],
  ["create", "Create a run configuration in this project. Provide name, type and target.", { config: { ...draft, required: ["name", "type", "target"] } }, ["config"]],
  ["update", "Update fields on a run configuration using its current revision. Omit env to preserve its values.", { id: string, revision, config: draft }, ["id", "revision", "config"]],
  ["delete", "Delete a run configuration by ID and current revision.", { id: string, revision }, ["id", "revision"]],
  ["detect", "Detect runnable Java and JavaScript/TypeScript targets in this workspace. This only reads workspace files.", {}, []],
];

const mod: AppModule = {
  id: "run-configurations", moduleApiVersion: 1,
  activate(ctx) {
    const refreshMarkers = () => void publishMarkers(ctx, ctx.state.get("viewer.runSource") || null);
    ctx.state.watch("viewer.runSource", refreshMarkers);
    ctx.events.on("kernel.modules.changed", refreshMarkers);
    ctx.events.on("files.changed", (e: any) => {
      if (e.workspaceId === ctx.state.get<{ workspaceId: string }>("viewer.runSource")?.workspaceId) refreshMarkers();
    });
    refreshMarkers();
    mcp = exportMcpTools(ctx, "Run configurations", definitions.map(([op, description, properties, required]) => ({
      name: `run_configs_${op}`, description,
      inputSchema: { type: "object", properties, required, additionalProperties: false },
      annotations: { readOnlyHint: op === "list" || op === "get" || op === "detect", destructiveHint: op === "delete" },
      timeoutMs: op === "detect" ? 120000 : undefined,
      handler: async (a, session) => tracked(async () => {
        const d = await workspace(ctx, session.workspaceId);
        if (d.machineId !== session.machineId) throw new Error("MCP workspace machine does not match its authenticated scope");
        return dispatch(ctx, d, op, a);
      }),
    })));
  },
  canSwap: () => ({ ok: writing === 0 && !mcp?.pending(), reason: "Run configuration operation in progress" }),
  methods: {
    types: async ctx => (await runTypes(ctx)).flatMap(p => p.types),
    ...Object.fromEntries(definitions.map(([op]) => [op, (ctx: ModuleContext, a: any, meta: { caller: string }) => tracked(async () =>
      dispatch(ctx, await workspace(ctx, a.workspaceId), op, a, meta.caller === "run-configurations-panel"))])),
    environment: async (ctx, a, meta) => environmentPreview(ctx, await workspace(ctx, a.workspaceId), a, meta.caller === "run-configurations-panel" && a.reveal === true),
    async directories(ctx, a) {
      const d = await workspace(ctx, a.workspaceId);
      const cwd = relativePath(a.cwd || ".", "Working directory", true);
      const g = await workspaceGrant(ctx, d, "fs");
      const { entries } = await ctx.host.fs.list(g.grant, cwd);
      return { cwd, dirs: entries.filter(e => e.kind === "dir" && !e.name.startsWith(".")).slice(0, 160).map(e => cwd === "." ? e.name : `${cwd}/${e.name}`) };
    },
    async hints(ctx, a) {
      const d = await workspace(ctx, a.workspaceId);
      const cwd = relativePath(a.cwd || ".", "Working directory", true);
      const profiles = new Set<string>();
      const runtimes: string[] = [];
      const at = (name: string) => cwd === "." ? name : `${cwd}/${name}`;
      if (a.type === "spring-boot" || a.type === "java-maven") {
        const g = await workspaceGrant(ctx, d, "fs");
        for (const dir of [cwd, at("src/main/resources"), at("src/test/resources")]) {
          const listed = await ctx.host.fs.list(g.grant, dir).catch(() => null);
          for (const entry of listed?.entries ?? []) {
            const name = /^application-(.+)\.(?:properties|ya?ml)$/.exec(entry.name)?.[1];
            if (name && a.type === "spring-boot") profiles.add(name);
          }
        }
        if (a.type === "java-maven") {
          const pom = await readText(ctx, d, at("pom.xml"), 128 * 1024).catch(() => "");
          for (const match of pom.matchAll(/<profile>\s*<id>([^<]+)<\/id>/g)) profiles.add(match[1].trim());
        }
      }
      const java = /^(java-|junit$|spring-boot$)/.test(a.type || "");
      const version = await withWorkspace(ctx, d, async () => {
        const grant = await workspaceGrant(ctx, d, "process");
        return ctx.host.process.run(grant.grant, { target: await targetFor(ctx, d), cwd: d.rootAbsolutePath,
          executable: java ? "java" : "node", args: java ? ["-XshowSettings:properties", "-version"] : ["--version"],
          loginShell: d.location === "ssh",
        }, { timeoutMs: 4000, limitBytes: 32 * 1024 });
      }).catch(() => null);
      if (version?.code === 0) {
        const executable = java ? /^\s*java\.home\s*=\s*(.+)$/m.exec(version.stderr)?.[1]?.trim() : "node";
        if (executable) runtimes.push(executable);
      }
      return { profiles: [...profiles].filter(Boolean).slice(0, 50), runtimes };
    },
    async resolveLaunch(ctx, a, meta) {
      if (meta.caller !== "run") throw new Error("Only the run service can resolve launch values");
      const d = await workspace(ctx, a.workspaceId);
      const { items } = await load(ctx, d);
      const candidate = a.candidate;
      const config = a.configId
        ? (items.find(c => c.name === a.configId) || find(items, a.configId))
        : normalizeConfig({ name: candidate?.name, type: candidate?.type, target: candidate?.target, cwd: candidate?.cwd });
      const { values } = await resolveEnvironment(ctx, d, config);
      return { ...config, env: Object.fromEntries(values.map(v => [v.name, v.value])) };
    },
    async reorder(ctx, a) {
      const d = await workspace(ctx, a.workspaceId);
      return tracked(() => writeProject(d.projectId, async () => {
        const { items, rev } = await load(ctx, d);
        if (!Array.isArray(a.ids) || a.ids.length !== items.length || new Set(a.ids).size !== items.length) throw new Error("Provide each configuration ID once");
        await save(ctx, d, a.ids.map((id: string) => find(items, id)), rev);
      }));
    },
    async importShared(ctx, a) {
      const d = await workspace(ctx, a.workspaceId);
      return tracked(() => writeProject(d.projectId, async () => {
        const imported = await readShare(ctx, d);
        const { items, rev } = await load(ctx, d);
        const names = new Set(items.map(c => c.name.toLowerCase()));
        const additions: RunConfig[] = [];
        for (const draft of imported) {
          if (names.has(draft.name.toLowerCase())) continue;
          names.add(draft.name.toLowerCase());
          additions.push({ ...draft, shared: true, id: crypto.randomUUID(), revision: 1 });
        }
        if (additions.length) await save(ctx, d, [...items, ...additions], rev);
        return { added: additions.length, skipped: imported.length - additions.length };
      }));
    },
    exportShared: (ctx, a) => tracked(async () => {
      const d = await workspace(ctx, a.workspaceId);
      return writeProject(d.projectId, async () => {
        const { items } = await load(ctx, d);
        if (!items.length) throw new Error("Create a run configuration before exporting");
        return writeShare(ctx, d, items, a.replace === true);
      });
    }),
  },
};
export default mod;
