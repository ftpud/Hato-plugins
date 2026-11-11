// Desktop coordinator; process scopes place each server on its workspace machine (local/SSH).
import type { AppModule, ModuleContext, StreamSubscription, SettingsSection } from "@hato/sdk/types";
import { errMsg, targetFor, workspaceGrant, type WorkspaceDescriptor } from "@hato/sdk/runtime";
import { languageDefinitions, languageForPath, documentUri, definitionLinks, workspacePath, relativeFile, validPosition, type LanguageDefinition, type LanguageServerSpec } from "@hato/sdk/languages";
import { serverData } from "./server-data";
import { exportMcpTools } from "@hato/sdk/mcp";
import { projectConfiguration, projectServer, documentSymbols } from "./project";
import { LanguageDependencies } from "./dependencies";
import { LspPeer, decodeBase64 } from "@hato/sdk/lsp";
import { exportSettings } from "@hato/sdk/settings";
import { get as scopedGet, set as scopedSet } from "@hato/sdk/scoped-settings";

interface Session {
  key: string; workspace: WorkspaceDescriptor; server: LanguageServerSpec; handle: string; peer: LspPeer;
  subscriptions: StreamSubscription[]; documents: Map<string, { text: string; version: number }>;
  closing: boolean; initialized: boolean; capabilities: any; queue: Promise<any>; stderr: string;
}
let languages: LanguageDefinition[] = [];
let publishSettings = (_error?: string | null) => {};
const sessions = new Map<string, Promise<Session>>();
const sessionUse = new Map<string, number>();
const retiring = new Map<string, Promise<void>>();
let access = 0, warmSessions = 3;
let evictionQueue: Promise<void> = Promise.resolve();
const paths = new Map<string, string>();
const statuses = new Map<string, any>();
function sessionKey(d: WorkspaceDescriptor, server: LanguageServerSpec) { return `${d.machineId}|${d.rootAbsolutePath}|${server.id}`; }
function report(ctx: ModuleContext, d: WorkspaceDescriptor, server: LanguageServerSpec, update: any) {
  const key = sessionKey(d, server);
  const next = { serverId: server.id, workspaceId: d.id, machineId: d.machineId, ...statuses.get(key), ...update };
  statuses.set(key, next); ctx.events.emit("language-service.status", next);
}
async function configuredServer(ctx: ModuleContext, d: WorkspaceDescriptor, server: LanguageServerSpec) {
  const stored = await scopedGet(ctx, `language-server.${server.id}.project`, d);
  const config = projectConfiguration(server, stored?.value);
  return { config, server: projectServer(server, config) };
}
let selected: WorkspaceDescriptor | null = null;
let refreshVersion = 0;
let stopped = false;
let dependencies: LanguageDependencies | null = null;
let mcp: ReturnType<typeof exportMcpTools> | null = null;
function servers() { return [...new Map(languages.filter(l => l.server).map(l => [l.server!.id, l.server!])).values()]; }
function sections(): SettingsSection[] {
  return [{ key: "language-service", title: "Language server cache", group: "Languages", fields: [
    { key: "warmSessions", label: "Keep recent servers running", type: "select" as const, value: String(warmSessions),
      options: [1, 2, 3, 5].map(n => ({ value: String(n), label: `${n} ${n === 1 ? "server" : "servers"}` })),
      description: "Reuse language servers and their indexes when switching workspaces. Closed servers retain their on-disk cache." },
  ] }, ...servers().map((server): SettingsSection => ({ key: server.id, title: server.id, group: "Languages", fields: [
    { key: "executable", label: "Language server executable", type: "text", value: paths.get(server.id) || server.executable,
      description: `${selected?.location === "ssh" ? "Remote" : "Local"} executable for this workspace. Press Enter to apply. ${server.installHint}` },
    ...(dependencies?.fields(server) || []),
  ] }))];
}
async function dispose(ctx: ModuleContext, session: Session) {
  session.closing = true;
  // The shutdown response lets the server finish saving its workspace/index before exit.
  await session.queue.catch(() => {});
  if (session.initialized && session.peer.alive) {
    try { await session.peer.request("shutdown", null, 10000); await session.peer.notify("exit"); } catch {}
  }
  session.peer.fail("Language server stopped");
  await Promise.all(session.subscriptions.map(sub => sub.close().catch(() => {})));
  await ctx.host.process.terminate(session.handle).catch(() => {});
  await ctx.host.resources.release(session.handle).catch(() => {});
}
async function stopSessions(ctx: ModuleContext) {
  const previous = [...sessions.values()]; sessions.clear(); sessionUse.clear();
  await Promise.all([...previous.map(p => p.then(s => dispose(ctx, s)).catch(() => {})), ...retiring.values()]);
}
function trimSessions(ctx: ModuleContext, keep: string) {
  const trim = evictionQueue.catch(() => {}).then(async () => {
    while (!stopped && sessions.size > warmSessions) {
      const victim = [...sessions.keys()].filter(key => key !== keep).sort((a, b) => (sessionUse.get(a) || 0) - (sessionUse.get(b) || 0))[0];
      if (!victim) return;
      const pending = sessions.get(victim)!;
      sessions.delete(victim); sessionUse.delete(victim);
      const closing = pending.then(async s => {
        await dispose(ctx, s);
        report(ctx, s.workspace, s.server, { phase: "idle", message: "Index cached on disk; server will resume on demand" });
      }).catch(() => {});
      retiring.set(victim, closing);
      await closing;
      if (retiring.get(victim) === closing) retiring.delete(victim);
    }
  });
  evictionQueue = trim;
  return trim;
}
async function refresh(ctx: ModuleContext) {
  const mine = ++refreshVersion;
  const next = languageDefinitions((await ctx.host.plugins.list()).plugins);
  if (mine !== refreshVersion || stopped) return;
  const changed = JSON.stringify(next) !== JSON.stringify(languages);
  languages = next;
  paths.clear();
  for (const server of servers()) {
    const setting = await scopedGet(ctx, `language-server.${server.id}.executable`, selected);
    if (mine !== refreshVersion || stopped) return;
    if (typeof setting?.value === "string" && setting.value) paths.set(server.id, setting.value);
  }
  if (changed) { dependencies?.invalidate(); await stopSessions(ctx); }
  publishSettings(); ctx.events.emit("language-service.changed", {});
}
function configValue(settings: Record<string, any>, section?: string) {
  if (!section) return settings;
  return section.split(".").reduce((value, key) => value?.[key], settings) ?? null;
}
async function start(ctx: ModuleContext, d: WorkspaceDescriptor, server: LanguageServerSpec, key: string): Promise<Session> {
  const configured = await configuredServer(ctx, d, server);
  if (!configured.config.enabled) { report(ctx, d, server, { phase: "disabled", message: "Disabled for this workspace" }); throw new Error(`${server.id} is disabled for this workspace`); }
  server = configured.server;
  report(ctx, d, server, { phase: "starting", message: "Starting language server…", capabilities: {}, diagnostics: 0, log: [], importError: null });
  const executableSetting = await scopedGet(ctx, `language-server.${server.id}.executable`, d);
  const executable = typeof executableSetting?.value === "string" && executableSetting.value.trim() ? executableSetting.value.trim() : server.executable;
  const grant = await workspaceGrant(ctx, d, "process");
  let handle: string;
  try {
    const data = server.args.some(arg => arg.includes("$SERVER_DATA")) ? await serverData(ctx, d, server.id, grant.grant) : "";
    if(data)report(ctx,d,server,{dataDirectory:data});
    const args = server.args.map(arg => arg.replace(/\$WORKSPACE/g, d.rootAbsolutePath).replace(/\$SERVER_DATA/g, data));
    handle = (await ctx.host.process.spawn(grant.grant, { target: await targetFor(ctx, d), executable, args, cwd: d.rootAbsolutePath, loginShell: d.location === "ssh" })).handle;
  } catch (error) { throw new Error(`${server.id} on ${d.machineId}: ${errMsg(error)}. ${server.installHint}`); }
  const peer = new LspPeer(frame => ctx.host.process.write(handle, frame));
  const s: Session = { key, workspace: d, server, handle, peer, subscriptions: [], documents: new Map(), closing: false, initialized: false, capabilities: {}, queue: Promise.resolve(), stderr: "" };
  peer.onRequest = async (method, params) => {
    if (method === "workspace/configuration") return (params?.items || []).map((item: any) => configValue(server.settings || {}, item.section));
    if (method === "workspace/workspaceFolders") return [{ uri: documentUri(d.rootAbsolutePath, ".hato-root").replace(/\/\.hato-root$/, ""), name: d.name }];
    if (method === "client/registerCapability") {
      const names: Record<string, string> = { "textDocument/definition": "definitionProvider", "textDocument/documentSymbol": "documentSymbolProvider", "textDocument/hover": "hoverProvider", "textDocument/completion": "completionProvider" };
      for (const r of params?.registrations || []) if (names[r.method]) s.capabilities[names[r.method]] = r.registerOptions || true;
      report(ctx, d, server, { capabilities: s.capabilities }); return null;
    }
    if (["client/unregisterCapability", "window/workDoneProgress/create"].includes(method)) return null;
    if (method === "workspace/applyEdit") return { applied: false, failureReason: "Workspace edits are not enabled" };
    throw Object.assign(new Error(`Unsupported server request: ${method}`), { code: -32601 });
  };
  const diagnostics = new Map<string, number>();
  peer.onNotification = (method, params) => {
    if (method === "textDocument/publishDiagnostics") {
      diagnostics.set(params.uri, Array.isArray(params.diagnostics) ? params.diagnostics.length : 0);
      report(ctx, d, server, { diagnostics: [...diagnostics.values()].reduce((a, b) => a + b, 0) });
    } else if (method === "$/progress") {
      const value = params?.value;
      if ((value?.kind === "begin" || value?.kind === "report") && !statuses.get(key)?.importError) report(ctx, d, server, { phase: "indexing", message: value.message || value.title || "Indexing project…" });
      else if (value?.kind === "end" && !statuses.get(key)?.importError) report(ctx, d, server, { phase: "ready", message: value.message || "Ready" });
    } else if (["language/status", "window/showMessage", "window/logMessage"].includes(method)) {
      const message = String(params?.message || "").slice(-2000);
      const log = [...(statuses.get(key)?.log || []), message].slice(-30);
      const phase = method === "language/status" ? (params?.type === "Started" ? "ready" : params?.type === "Error" ? "error" : "indexing") : undefined;
      const failed = params?.type === 1 || method === "language/status" && params?.type === "Error";
      const importError = failed ? message : statuses.get(key)?.importError;
      report(ctx, d, server, { log, ...(importError ? { phase: "error", importError, message: importError.split("\n")[0] } : phase ? { phase, message } : {}) });
    }
  };
  try {
    s.subscriptions.push(await ctx.host.streams.listen(handle, { channel: "stdout", encoding: "base64" }, chunk => {
      try { peer.feed(decodeBase64(chunk)); } catch (error) { peer.fail(error); }
    }, error => { if (s.closing) return; const message = error ? errMsg(error) : `${server.id} exited. ${s.stderr.slice(-1500)}`; peer.fail(message); report(ctx, d, server, { phase: "error", message }); }));
    s.subscriptions.push(await ctx.host.streams.listen(handle, { channel: "stderr" }, chunk => { s.stderr = (s.stderr + chunk).slice(-4000); }));
    const rootUri = documentUri(d.rootAbsolutePath, ".hato-root").replace(/\/\.hato-root$/, "");
    const initialized = await peer.request("initialize", {
      processId: null, rootUri, workspaceFolders: [{ uri: rootUri, name: d.name }],
      clientInfo: { name: "Hato", version: "0.1.0" },
      capabilities: { window: { workDoneProgress: true }, general: { positionEncodings: ["utf-16"] }, workspace: { configuration: true, workspaceFolders: true, symbol: { dynamicRegistration: false } },
        textDocument: { definition: { linkSupport: true }, hover: { contentFormat: ["markdown", "plaintext"] },
          completion: { completionItem: { snippetSupport: false, documentationFormat: ["markdown", "plaintext"], labelDetailsSupport: true,
            resolveSupport: { properties: ["documentation", "detail", "additionalTextEdits"] } } },
          signatureHelp: { contextSupport: true, signatureInformation: { documentationFormat: ["markdown", "plaintext"], activeParameterSupport: true, parameterInformation: { labelOffsetSupport: true } } },
          documentSymbol: { hierarchicalDocumentSymbolSupport: true }, publishDiagnostics: {}, synchronization: { dynamicRegistration: false, didSave: true } } },
      initializationOptions: { ...server.initializationOptions, ...(server.projectSettings?.initializationSettings ? { workspaceFolders: [rootUri] } : {}) },
    }, 120000);
    s.capabilities = initialized?.capabilities || {};
    if (s.capabilities.positionEncoding && s.capabilities.positionEncoding !== "utf-16") throw new Error("Server selected an unsupported position encoding");
    s.initialized = true;
    await peer.notify("initialized", {});
    await peer.notify("workspace/didChangeConfiguration", { settings: server.settings || {} });
    report(ctx, d, server, { ...(!statuses.get(key)?.importError ? { phase: "ready", message: "Connected; project import may still be running" } : {}), capabilities: s.capabilities });
    return s;
  } catch (error) { await dispose(ctx, s); throw new Error(`${server.id}: ${errMsg(error)}. ${s.stderr.slice(-1500)} ${server.installHint}`); }
}
async function sessionFor(ctx: ModuleContext, d: WorkspaceDescriptor, server: LanguageServerSpec): Promise<Session> {
  const key = `${d.machineId}|${d.rootAbsolutePath}|${server.id}`;
  await retiring.get(key);
  sessionUse.set(key, ++access);
  let pending = sessions.get(key);
  if (pending) {
    const existing = await pending;
    if (existing.peer.alive) return existing;
    sessions.delete(key); await dispose(ctx, existing); pending = undefined;
  }
  if (!pending) {
    pending = start(ctx, d, server, key).catch(error => { if (statuses.get(key)?.phase !== "disabled") report(ctx, d, server, { phase: "error", message: errMsg(error) }); throw error; }); sessions.set(key, pending);
    pending.catch(() => { if (sessions.get(key) === pending) sessions.delete(key); });
  }
  const session = await pending;
  void trimSessions(ctx, key).catch(e => ctx.log.warn("language server cache", errMsg(e)));
  return session;
}
async function synchronize(s: Session, path: string, text: string) {
  const language = languageForPath(languages, path);
  if (language?.server?.id !== s.server.id) return;
  const uri = documentUri(s.workspace.rootAbsolutePath, path);
  const old = s.documents.get(uri);
  if (!old) {
    await s.peer.notify("textDocument/didOpen", { textDocument: { uri, languageId: language.id, version: 1, text } });
    s.documents.set(uri, { text, version: 1 });
  } else if (old.text !== text) {
    const sync = s.capabilities.textDocumentSync;
    const kind = typeof sync === "number" ? sync : sync?.change;
    if (kind === 0) throw new Error("Language server does not accept unsaved changes");
    const change: any = { text };
    // An entire-document range is also a valid incremental change. JS lengths are UTF-16.
    if (kind === 2) {
      const lines = old.text.split("\n");
      change.range = { start: { line: 0, character: 0 }, end: { line: lines.length - 1, character: lines[lines.length - 1].length } };
      change.rangeLength = old.text.length;
    }
    await s.peer.notify("textDocument/didChange", { textDocument: { uri, version: old.version + 1 }, contentChanges: [change] });
    s.documents.set(uri, { text, version: old.version + 1 });
  }
}
async function documentRequest(ctx: ModuleContext, a: any, method?: string, capability?: string) {
  if (typeof a.text !== "string") throw new Error("Document text is required");
  const path = relativeFile(String(a.path));
  const lang = languageForPath(languages, path);
  if (!lang?.server) return null;
  const d: WorkspaceDescriptor = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
  const s = await sessionFor(ctx, d, lang.server);
  const operation = s.queue.catch(() => {}).then(async () => {
    const documents = (Array.isArray(a.documents) ? a.documents : []).filter((doc: any) => typeof doc.text === "string")
      .map((doc: any) => ({ path: relativeFile(doc.path), text: doc.text }));
    const keep = new Set([documentUri(d.rootAbsolutePath, path), ...documents.map((doc: any) => documentUri(d.rootAbsolutePath, doc.path))]);
    for (const uri of s.documents.keys()) if (!keep.has(uri)) { await s.peer.notify("textDocument/didClose", { textDocument: { uri } }); s.documents.delete(uri); }
    for (const doc of documents) await synchronize(s, doc.path, doc.text);
    await synchronize(s, path, a.text);
    if (!method) return { ...statuses.get(s.key) };
    if (capability && !s.capabilities[capability]) return null;
    const uri = documentUri(d.rootAbsolutePath, path);
    return s.peer.request(method, { textDocument: { uri }, ...(a.position ? { position: a.position } : {}), ...(a.context ? { context: a.context } : {}) }, 60000);
  });
  s.queue = operation; return operation;
}
const mod: AppModule = {
  id: "language-service", moduleApiVersion: 1,
  async activate(ctx) {
    stopped = false;
    const cache = await scopedGet(ctx, "language-service.warmSessions", null);
    warmSessions = [1, 2, 3, 5].includes(Number(cache?.value)) ? Number(cache!.value) : 3;
    selected = ctx.state.get("workspace.selected") as any || null;
    dependencies = new LanguageDependencies(ctx, servers, () => selected, () => publishSettings(), async (workspace, server, executable) => {
      const key = `${workspace.machineId}|${workspace.rootAbsolutePath}|${server.id}`;
      const session = sessions.get(key);
      if (session) { sessions.delete(key); await session.then(s => dispose(ctx, s)).catch(() => {}); }
      if (selected?.id === workspace.id) paths.set(server.id, executable);
      ctx.events.emit("language-service.changed", { workspaceId: workspace.id });
    });
    publishSettings = exportSettings(ctx, sections, async (section, key, value) => {
      if (section === "language-service" && key === "warmSessions") {
        const limit = Number(value);
        if (typeof value !== "string" || ![1, 2, 3, 5].includes(limit)) throw new Error("Choose a valid server cache size");
        await scopedSet(ctx, "user", "language-service.warmSessions", limit);
        warmSessions = limit;
        const recent = [...sessions.keys()].sort((a, b) => (sessionUse.get(b) || 0) - (sessionUse.get(a) || 0))[0] || "";
        await trimSessions(ctx, recent); return;
      }
      if (dependencies?.busy) throw new Error("Wait for dependency setup to finish before changing the executable");
      if (key !== "executable" || typeof value !== "string" || !value.trim() || /[\r\n\0]/.test(value)) throw new Error("Enter an executable path or command name");
      if (!servers().some(s => s.id === section)) throw new Error("Language server is no longer available");
      await scopedSet(ctx, selected ? `workspace:${selected.id}` : "user", `language-server.${section}.executable`, value.trim());
      paths.set(section, value.trim()); dependencies?.invalidate(section, selected?.id); await stopSessions(ctx);
      ctx.events.emit("language-service.changed", { workspaceId: selected?.id });
    }, { invalidate: false, action: async (section, key) => { await dependencies!.action(section, key); } });
    mcp = exportMcpTools(ctx, "Language services", [
      ...[["project_get","project.get",true],["project_update","project.set",false],["server_restart","restart",false],["index_rebuild","reindex",false],["workspace_symbols","workspaceSymbols",true],["server_logs","logs",true]].map(([name,method,readOnly]) => ({
        name: String(name), description: `Language services: ${String(name).replace(/_/g," ")} in this agent's authenticated workspace. project_update accepts config (enabled, values and additional settings); project_get returns its schema.`,
        inputSchema: {type:"object", properties:{serverId:{type:"string"},query:{type:"string",maxLength:200},config:{type:"object"}},required:["serverId"],additionalProperties:false},
        annotations:{readOnlyHint:!!readOnly,destructiveHint:false}, timeoutMs:175000,
        handler: async (args:any,scope:any) => {
          const d:WorkspaceDescriptor=await ctx.modules.call("workspace","resolve",{workspaceId:scope.workspaceId});
          if(d.machineId!==scope.machineId)throw new Error("MCP workspace machine does not match its authenticated scope");
          if(method === "project.set" && (!args.config || typeof args.config !== "object"))throw new Error("config is required; read project_get first");
          const result=await mod.methods![String(method)](ctx,{...args,workspaceId:scope.workspaceId},{caller:"language-service"});
          return result;
        },
      })),
    ]);
    await refresh(ctx);
    ctx.events.on("kernel.modules.changed", () => { void refresh(ctx).catch(e => publishSettings(errMsg(e))); });
    ctx.state.watch("workspace.selected", (value: any) => {
      if (selected?.id === value?.id) return;
      selected = value || null;
      void refresh(ctx).catch(e => publishSettings(errMsg(e)));
    });
  },
  canSwap: () => ({ ok: !dependencies?.busy && !(mcp?.pending()), reason: "Language dependency installation/check is running" }),
  async deactivate(ctx) { stopped = true; refreshVersion++; await stopSessions(ctx); },
  methods: {
    health() {
      if (stopped) throw new Error("Language services stopped");
      return { ok: true, languages: languages.length };
    },
    async "dependencies.check"(_ctx, a) { return dependencies!.action(String(a.serverId), "checkDependencies", a.workspaceId); },
    async "dependencies.install"(_ctx, a) { return dependencies!.action(String(a.serverId), "installDependencies", a.workspaceId); },
    async describe(_ctx, a) { return languageForPath(languages, String(a.path)); },
    servers() { return servers().map(server => ({ id: server.id, title: server.projectSettings?.title || server.id })); },
    async workspaceSymbols(ctx, a) {
      if(typeof a.query!=="string" || a.query.length>200)throw new Error("Enter a symbol query up to 200 characters");
      const d: WorkspaceDescriptor = await ctx.modules.call("workspace", "resolve", {workspaceId:a.workspaceId});
      const server = servers().find(s => s.id===a.serverId);
      if(!server)throw new Error("Unknown server");
      if(!a.query.trim())return [];
      const session=await sessionFor(ctx,d,server);
      const operation = session.queue.catch(() => {}).then(() => session.peer.request("workspace/symbol", {query:a.query}, 60000));
      session.queue = operation;
      const result = await operation;
      return (Array.isArray(result)?result:[]).filter((s:any)=>typeof s.name==="string" && s.location?.range && workspacePath(d.rootAbsolutePath,s.location.uri)).slice(0,1000)
        .map((s:any)=>({name:s.name,kind:s.kind,container:s.containerName||"",uri:s.location.uri,range:s.location.range,path:workspacePath(d.rootAbsolutePath,s.location.uri)}));
    },
    async logs(ctx,a) {
      const d:WorkspaceDescriptor=await ctx.modules.call("workspace","resolve",{workspaceId:a.workspaceId});
      const server=servers().find(s=>s.id===a.serverId);
      if(!server)throw new Error("Unknown server");
      const status=statuses.get(sessionKey(d,server));
      if(!status?.dataDirectory)return {status,log:(status?.log||[]).join("\n")};
      const grant=await workspaceGrant(ctx,d,"process");
      const result=await ctx.host.process.run(grant.grant,{target:await targetFor(ctx,d),executable:"python3",args:["-c","import pathlib,sys; p=pathlib.Path(sys.argv[1])/'.metadata/.log'; print(p.read_text(errors='replace')[-32000:] if p.is_file() else 'No index log yet')",status.dataDirectory],cwd:d.rootAbsolutePath,loginShell:d.location==="ssh"},{timeoutMs:30000});
      if(result.code!==0)throw new Error(result.stderr||"Cannot read server log");
      return {status,log:result.stdout};
    },
    async reindex(ctx,a) {
      const d: WorkspaceDescriptor=await ctx.modules.call("workspace","resolve",{workspaceId:a.workspaceId});
      const server=servers().find(s=>s.id===a.serverId);
      if(!server?.args.some(arg=>arg.includes("$SERVER_DATA")))throw new Error("This server does not use a managed index; restart it instead");
      await scopedSet(ctx,`workspace:${d.id}`,`language-server.${server.id}.index`,crypto.randomUUID());
      return mod.methods!.restart(ctx,a,{caller:"language-service"});
    },
    async "project.get"(ctx, a) {
      const d: WorkspaceDescriptor = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
      const server = servers().find(s => s.id === a.serverId);
      if (!server) throw new Error("Language server is no longer available");
      const { config } = await configuredServer(ctx, d, server);
      return { config, schema: server.projectSettings || null, status: statuses.get(sessionKey(d, server)) || { phase: config.enabled ? "idle" : "disabled", message: config.enabled ? "Open a supported source file to start" : "Disabled for this workspace", serverId: server.id, machineId: d.machineId } };
    },
    async "project.set"(ctx, a, meta) {
      const d: WorkspaceDescriptor = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
      const server = servers().find(s => s.id === a.serverId);
      if (!server) throw new Error("Language server is no longer available");
      const config = projectConfiguration(server, a.config);
      await scopedSet(ctx, `workspace:${d.id}`, `language-server.${server.id}.project`, config as any);
      const key = sessionKey(d, server), pending = sessions.get(key);
      if (pending) { sessions.delete(key); await pending.then(s => dispose(ctx, s)).catch(() => {}); }
      report(ctx, d, server, { phase: config.enabled ? "idle" : "disabled", message: config.enabled ? "Configuration saved; restarting on next request" : "Disabled for this workspace" });
      ctx.events.emit("language-service.configurationChanged", { workspaceId: d.id, serverId: server.id, enabled: config.enabled, caller: meta?.caller || null });
      return { saved: true };
    },
    async restart(ctx, a) {
      const d: WorkspaceDescriptor = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
      const server = servers().find(s => s.id === a.serverId);
      if (!server) throw new Error("Language server is no longer available");
      const key = sessionKey(d, server), pending = sessions.get(key);
      if (pending) { sessions.delete(key); await pending.then(s => dispose(ctx, s)).catch(() => {}); }
      await sessionFor(ctx, d, server); return statuses.get(key);
    },
    async synchronize(ctx, a) { return documentRequest(ctx, a); },
    async saved(ctx, a) {
      const d: WorkspaceDescriptor = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
      const server = languageForPath(languages, String(a.path))?.server;
      if (!server) return;
      const pending = sessions.get(sessionKey(d, server));
      if (!pending) return; // Saving an unrelated file must not start a new server.
      const s = await pending;
      const operation = s.queue.catch(() => {}).then(async () => {
        await synchronize(s, relativeFile(a.path), a.text);
        const save = typeof s.capabilities.textDocumentSync === "object" ? s.capabilities.textDocumentSync.save : false;
        if (save) await s.peer.notify("textDocument/didSave", { textDocument: { uri: documentUri(d.rootAbsolutePath, a.path) }, ...(save.includeText ? { text: a.text } : {}) });
      });
      s.queue = operation; return operation;
    },
    async symbols(ctx, a) {
      const d: WorkspaceDescriptor = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
      const path=relativeFile(String(a.path)), uri=documentUri(d.rootAbsolutePath,path);
      return documentSymbols(await documentRequest(ctx, a, "textDocument/documentSymbol", "documentSymbolProvider"), uri).map(s=>({...s,path,uri}));
    },
    async hover(ctx, a) {
      if (!validPosition(a.position)) throw new Error("Invalid hover position");
      return documentRequest(ctx, a, "textDocument/hover", "hoverProvider");
    },
    async completions(ctx, a) {
      if (!validPosition(a.position)) throw new Error("Invalid completion position");
      return (await documentRequest(ctx, a, "textDocument/completion", "completionProvider")) || [];
    },
    async signatureHelp(ctx, a) {
      if (!validPosition(a.position)) throw new Error("Invalid signature position");
      return documentRequest(ctx, a, "textDocument/signatureHelp", "signatureHelpProvider");
    },
    /** Resolve an accepted completion item (details and additionalTextEdits such as imports). */
    async resolveCompletion(ctx, a) {
      if (!a.item || typeof a.item !== "object") throw new Error("A completion item is required");
      const path = relativeFile(String(a.path));
      const lang = languageForPath(languages, path);
      if (!lang?.server) return a.item;
      const d: WorkspaceDescriptor = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
      const pending = sessions.get(sessionKey(d, lang.server));
      if (!pending) return a.item;
      const s = await pending;
      if (!s.capabilities.completionProvider?.resolveProvider) return a.item;
      const operation = s.queue.catch(() => {}).then(() => s.peer.request("completionItem/resolve", a.item, 30000));
      s.queue = operation; return operation;
    },
    async definitions(ctx, a) {
      if (typeof a.text !== "string" || !validPosition(a.position)) throw new Error("Definition requires text and a UTF-16 position");
      return definitionLinks(await documentRequest(ctx, a, "textDocument/definition", "definitionProvider"));
    },
  },
};
export default mod;
