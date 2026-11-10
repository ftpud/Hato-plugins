// Desktop coordinator; process scopes place each server on its workspace machine (local/SSH).
import type { AppModule, ModuleContext, StreamSubscription, SettingsSection } from "@hato/sdk/types";
import { errMsg, targetFor, workspaceGrant, type WorkspaceDescriptor } from "@hato/sdk/runtime";
import { languageDefinitions, languageForPath, documentUri, definitionLinks, relativeFile, validPosition, type LanguageDefinition, type LanguageServerSpec } from "@hato/sdk/languages";
import { LanguageDependencies } from "./dependencies";
import { LspPeer, decodeBase64 } from "@hato/sdk/lsp";
import { exportSettings } from "@hato/sdk/settings";
import { get as scopedGet, set as scopedSet } from "@hato/sdk/scoped-settings";

interface Session {
  key: string; workspace: WorkspaceDescriptor; server: LanguageServerSpec; handle: string; peer: LspPeer;
  subscriptions: StreamSubscription[]; documents: Map<string, { text: string; version: number }>;
  capabilities: any; queue: Promise<any>; stderr: string;
}
let languages: LanguageDefinition[] = [];
let publishSettings = (_error?: string | null) => {};
const sessions = new Map<string, Promise<Session>>();
const paths = new Map<string, string>();
let selected: WorkspaceDescriptor | null = null;
let refreshVersion = 0;
let stopped = false;
let dependencies: LanguageDependencies | null = null;
function servers() { return [...new Map(languages.filter(l => l.server).map(l => [l.server!.id, l.server!])).values()]; }
function sections(): SettingsSection[] {
  return servers().map(server => ({ key: server.id, title: server.id, group: "Languages", fields: [
    { key: "executable", label: "Language server executable", type: "text", value: paths.get(server.id) || server.executable,
      description: `${selected?.location === "ssh" ? "Remote" : "Local"} executable for this workspace. Press Enter to apply. ${server.installHint}` },
    ...(dependencies?.fields(server) || []),
  ] }));
}
async function dispose(ctx: ModuleContext, session: Session) {
  session.peer.fail("Language server stopped");
  await Promise.all(session.subscriptions.map(sub => sub.close().catch(() => {})));
  await ctx.host.process.terminate(session.handle).catch(() => {});
  await ctx.host.resources.release(session.handle).catch(() => {});
}
async function stopSessions(ctx: ModuleContext) {
  const previous = [...sessions.values()]; sessions.clear();
  await Promise.all(previous.map(p => p.then(s => dispose(ctx, s)).catch(() => {})));
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
  const executableSetting = await scopedGet(ctx, `language-server.${server.id}.executable`, d);
  const executable = typeof executableSetting?.value === "string" && executableSetting.value.trim() ? executableSetting.value.trim() : server.executable;
  const grant = await workspaceGrant(ctx, d, "process");
  let handle: string;
  try {
    const args = server.args.map(arg => arg.replace(/\$WORKSPACE/g, d.rootAbsolutePath));
    handle = (await ctx.host.process.spawn(grant.grant, { target: await targetFor(ctx, d), executable, args, cwd: d.rootAbsolutePath, loginShell: d.location === "ssh" })).handle;
  } catch (error) { throw new Error(`${server.id} on ${d.machineId}: ${errMsg(error)}. ${server.installHint}`); }
  const peer = new LspPeer(frame => ctx.host.process.write(handle, frame));
  const s: Session = { key, workspace: d, server, handle, peer, subscriptions: [], documents: new Map(), capabilities: {}, queue: Promise.resolve(), stderr: "" };
  peer.onRequest = async (method, params) => {
    if (method === "workspace/configuration") return (params?.items || []).map((item: any) => configValue(server.settings || {}, item.section));
    if (method === "workspace/workspaceFolders") return [{ uri: documentUri(d.rootAbsolutePath, ".hato-root").replace(/\/\.hato-root$/, ""), name: d.name }];
    if (["client/registerCapability", "client/unregisterCapability", "window/workDoneProgress/create"].includes(method)) return null;
    if (method === "workspace/applyEdit") return { applied: false, failureReason: "Workspace edits are not enabled" };
    throw Object.assign(new Error(`Unsupported server request: ${method}`), { code: -32601 });
  };
  try {
    s.subscriptions.push(await ctx.host.streams.listen(handle, { channel: "stdout", encoding: "base64" }, chunk => {
      try { peer.feed(decodeBase64(chunk)); } catch (error) { peer.fail(error); }
    }, error => peer.fail(error ? errMsg(error) : `${server.id} exited. ${s.stderr.slice(-1500)}`)));
    s.subscriptions.push(await ctx.host.streams.listen(handle, { channel: "stderr" }, chunk => { s.stderr = (s.stderr + chunk).slice(-4000); }));
    const rootUri = documentUri(d.rootAbsolutePath, ".hato-root").replace(/\/\.hato-root$/, "");
    const initialized = await peer.request("initialize", {
      processId: null, rootUri, workspaceFolders: [{ uri: rootUri, name: d.name }],
      clientInfo: { name: "Hato", version: "0.1.0" },
      capabilities: { general: { positionEncodings: ["utf-16"] }, workspace: { configuration: true, workspaceFolders: true },
        textDocument: { definition: { linkSupport: true }, synchronization: { dynamicRegistration: false, didSave: true } } },
      initializationOptions: server.initializationOptions || {},
    }, 120000);
    s.capabilities = initialized?.capabilities || {};
    if (s.capabilities.positionEncoding && s.capabilities.positionEncoding !== "utf-16") throw new Error("Server selected an unsupported position encoding");
    await peer.notify("initialized", {});
    await peer.notify("workspace/didChangeConfiguration", { settings: server.settings || {} });
    return s;
  } catch (error) { await dispose(ctx, s); throw new Error(`${server.id}: ${errMsg(error)}. ${s.stderr.slice(-1500)} ${server.installHint}`); }
}
async function sessionFor(ctx: ModuleContext, d: WorkspaceDescriptor, server: LanguageServerSpec): Promise<Session> {
  const key = `${d.machineId}|${d.rootAbsolutePath}|${server.id}`;
  let pending = sessions.get(key);
  if (pending) {
    const existing = await pending;
    if (existing.peer.alive) return existing;
    sessions.delete(key); await dispose(ctx, existing); pending = undefined;
  }
  if (!pending) {
    pending = start(ctx, d, server, key); sessions.set(key, pending);
    pending.catch(() => { if (sessions.get(key) === pending) sessions.delete(key); });
  }
  return pending;
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
const mod: AppModule = {
  id: "language-service", moduleApiVersion: 1,
  async activate(ctx) {
    stopped = false;
    selected = ctx.state.get("workspace.selected") as any || null;
    dependencies = new LanguageDependencies(ctx, servers, () => selected, () => publishSettings(), async (workspace, server, executable) => {
      const key = `${workspace.machineId}|${workspace.rootAbsolutePath}|${server.id}`;
      const session = sessions.get(key);
      if (session) { sessions.delete(key); await session.then(s => dispose(ctx, s)).catch(() => {}); }
      if (selected?.id === workspace.id) paths.set(server.id, executable);
    });
    publishSettings = exportSettings(ctx, sections, async (section, key, value) => {
      if (dependencies?.busy) throw new Error("Wait for dependency setup to finish before changing the executable");
      if (key !== "executable" || typeof value !== "string" || !value.trim() || /[\r\n\0]/.test(value)) throw new Error("Enter an executable path or command name");
      if (!servers().some(s => s.id === section)) throw new Error("Language server is no longer available");
      await scopedSet(ctx, selected ? `workspace:${selected.id}` : "user", `language-server.${section}.executable`, value.trim());
      paths.set(section, value.trim()); dependencies?.invalidate(section, selected?.id); await stopSessions(ctx);
    }, { invalidate: false, action: async (section, key) => { await dependencies!.action(section, key); } });
    await refresh(ctx);
    ctx.events.on("kernel.modules.changed", () => { void refresh(ctx).catch(e => publishSettings(errMsg(e))); });
    ctx.state.watch("workspace.selected", (value: any) => {
      if (selected?.id === value?.id) return;
      selected = value || null;
      void stopSessions(ctx).then(() => refresh(ctx)).catch(e => publishSettings(errMsg(e)));
    });
  },
  canSwap: () => ({ ok: !dependencies?.busy, reason: "Language dependency installation/check is running" }),
  async deactivate(ctx) { stopped = true; refreshVersion++; await stopSessions(ctx); },
  methods: {
    health() {
      if (stopped) throw new Error("Language services stopped");
      return { ok: true, languages: languages.length };
    },
    async "dependencies.check"(_ctx, a) { return dependencies!.action(String(a.serverId), "checkDependencies", a.workspaceId); },
    async "dependencies.install"(_ctx, a) { return dependencies!.action(String(a.serverId), "installDependencies", a.workspaceId); },
    async describe(_ctx, a) { return languageForPath(languages, String(a.path)); },
    async definitions(ctx, a) {
      if (typeof a.text !== "string" || !validPosition(a.position)) throw new Error("Definition requires text and a UTF-16 position");
      const path = relativeFile(String(a.path));
      const lang = languageForPath(languages, path);
      if (!lang?.server) return [];
      const d: WorkspaceDescriptor = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
      const s = await sessionFor(ctx, d, lang.server);
      const operation = s.queue.catch(() => {}).then(async () => {
        const documents = (Array.isArray(a.documents) ? a.documents : []).filter((doc: any) => typeof doc.text === "string")
          .map((doc: any) => ({ path: relativeFile(doc.path), text: doc.text }));
        const keep = new Set([documentUri(d.rootAbsolutePath, path), ...documents.map((doc: any) => documentUri(d.rootAbsolutePath, doc.path))]);
        // Release saved/closed overlays so later lookups see dependency changes on disk.
        for (const uri of s.documents.keys()) if (!keep.has(uri)) {
          await s.peer.notify("textDocument/didClose", { textDocument: { uri } }); s.documents.delete(uri);
        }
        for (const doc of documents) await synchronize(s, doc.path, doc.text);
        await synchronize(s, path, a.text);
        return definitionLinks(await s.peer.request("textDocument/definition", { textDocument: { uri: documentUri(d.rootAbsolutePath, path) }, position: a.position }));
      });
      s.queue = operation;
      return operation;
    },
  },
};
export default mod;
