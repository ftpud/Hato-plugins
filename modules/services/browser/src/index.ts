// browser: persistent headless browser sessions (local, on a workspace machine, or an existing
// DevTools endpoint). Chrome processes are held by the machine's daemon so sessions survive module
// reloads, disconnects and app restarts. Publishes `browser.state` for the panel and workflow
// designer, accepts user input from the preview surface, and exposes agent MCP commands.
import type { AppModule, ModuleContext } from "@hato/sdk/types";
import { errMsg } from "@hato/sdk/runtime";
import { exportMcpTools } from "@hato/sdk/mcp";
import { DEFAULT_VIEWPORT, type BrowserLocation, type BrowserSessionSpec, type BrowserState } from "@hato/sdk/browser";
import { BrowserSession, type Carry } from "./session";
import { browserTools } from "./tools";

const SPECS_KEY = "browser.sessions";
const RUNNING_KEY = "browser.running";

let ctxRef: ModuleContext;
const sessions = new Map<string, BrowserSession>();
let rev = 0;
let publishTimer: number | null = null;
let running = new Set<string>();

function publish() {
  if (publishTimer !== null) return;
  publishTimer = setTimeout(() => {
    publishTimer = null;
    const state: BrowserState = { sessions: [...sessions.values()].map(s => s.view()), rev: ++rev };
    ctxRef.state.set("browser.state", state as any);
    const live = [...sessions.values()].filter(s => s.status === "running" || s.status === "starting").map(s => s.spec.id).sort();
    if (live.join() !== [...running].sort().join()) {
      running = new Set(live);
      void saveRunning();
    }
  }, 60);
}

async function saveSpecs() {
  await ctxRef.modules.call("persistence", "settings.set", { key: SPECS_KEY, value: [...sessions.values()].map(s => s.spec) });
}
async function saveRunning() {
  try { await ctxRef.modules.call("persistence", "settings.set", { key: RUNNING_KEY, value: [...running] }); }
  catch (e) { ctxRef.log.warn("save running sessions", errMsg(e)); }
}

function get(id: string): BrowserSession {
  const s = sessions.get(String(id));
  if (!s) throw new Error(`Unknown browser session ${id}`);
  return s;
}

function cleanLocation(l: any): BrowserLocation {
  if (l?.kind === "workspace" && typeof l.workspaceId === "string" && l.workspaceId) return { kind: "workspace", workspaceId: l.workspaceId, label: typeof l.label === "string" ? l.label.slice(0, 120) : undefined };
  if (l?.kind === "endpoint" && typeof l.url === "string" && /^(wss?|https?):\/\//i.test(l.url.trim())) return { kind: "endpoint", url: l.url.trim().slice(0, 2000) };
  return { kind: "local" };
}

function cleanSpec(raw: any, prev?: BrowserSessionSpec): BrowserSessionSpec {
  const base: any = { ...(prev || {}), ...(raw || {}) };
  const vp = base.viewport || DEFAULT_VIEWPORT;
  return {
    id: prev?.id || (typeof base.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(base.id) ? base.id : crypto.randomHex(6)),
    name: String(base.name || "Browser").trim().slice(0, 80) || "Browser",
    location: cleanLocation(base.location),
    headed: !!base.headed,
    keepProfile: base.keepProfile !== false,
    agentAccess: !!base.agentAccess,
    viewport: { width: Math.round(Math.min(Math.max(Number(vp.width) || DEFAULT_VIEWPORT.width, 320), 3840)), height: Math.round(Math.min(Math.max(Number(vp.height) || DEFAULT_VIEWPORT.height, 240), 2400)) },
    startUrl: typeof base.startUrl === "string" ? base.startUrl.slice(0, 2000) : undefined,
    executable: typeof base.executable === "string" && base.executable.trim() ? base.executable.trim().slice(0, 1000) : undefined,
  };
}

function add(spec: BrowserSessionSpec, carry?: Carry) {
  const s = new BrowserSession(ctxRef, spec, publish, carry);
  sessions.set(spec.id, s);
  return s;
}

function pick(nameOrId: string | undefined): BrowserSession {
  const allowed = [...sessions.values()].filter(s => s.spec.agentAccess);
  if (!nameOrId) {
    if (allowed.length === 1) return allowed[0];
    throw new Error(allowed.length ? `Several browser sessions allow agents (${allowed.map(s => `${s.spec.name} [${s.spec.id}]`).join(", ")}); pass session` : "No browser session allows agents. The user can enable “Agent access” for a session in the Browser panel.");
  }
  const key = String(nameOrId).toLowerCase();
  const s = [...sessions.values()].find(s => s.spec.id === nameOrId) || [...sessions.values()].find(s => s.spec.name.toLowerCase() === key);
  if (!s) throw new Error(`No browser session ${nameOrId}`);
  if (!s.spec.agentAccess) throw new Error(`Browser session “${s.spec.name}” does not allow agents. The user can enable “Agent access” for it in the Browser panel.`);
  return s;
}

function startQuietly(s: BrowserSession) {
  s.start().catch(e => ctxRef.log.warn(`browser ${s.spec.name}`, errMsg(e)));
}

const mod: AppModule = {
  id: "browser",
  moduleApiVersion: 1,
  async activate(ctx, previous?: { carry?: Record<string, Carry>; running?: string[] }) {
    ctxRef = ctx;
    const specs = (await ctx.modules.call("persistence", "settings.get", { key: SPECS_KEY })) || [];
    const wasRunning: string[] = previous?.running || (await ctx.modules.call("persistence", "settings.get", { key: RUNNING_KEY })) || [];
    for (const raw of Array.isArray(specs) ? specs : []) {
      try { const spec = cleanSpec(raw); add(spec, previous?.carry?.[spec.id]); } catch (e) { ctx.log.warn("browser spec", errMsg(e)); }
    }
    exportMcpTools(ctx, "Browser", browserTools({ pick, agentSessions: () => [...sessions.values()].filter(s => s.spec.agentAccess) }));
    publish();
    // Reattach to browsers that were running (daemon-held processes keep their tabs and logins).
    for (const id of wasRunning) { const s = sessions.get(id); if (s) startQuietly(s); }
  },
  snapshot() {
    const carry: Record<string, Carry> = {};
    for (const s of sessions.values()) carry[s.spec.id] = s.carry();
    return { carry, running: [...sessions.values()].filter(s => s.status === "running" || s.status === "starting").map(s => s.spec.id) };
  },
  async deactivate() {
    if (publishTimer !== null) clearTimeout(publishTimer);
    await Promise.all([...sessions.values()].map(s => s.detach()));
  },
  methods: {
    list: () => ({ sessions: [...sessions.values()].map(s => s.view()) }),
    async create(_ctx, a) {
      const spec = cleanSpec(a.spec || a);
      if (sessions.has(spec.id)) throw new Error("Session id already exists");
      const s = add(spec);
      await saveSpecs();
      publish();
      if (a.start !== false) startQuietly(s);
      return s.view();
    },
    async update(_ctx, a) {
      const s = get(a.id);
      const prev = s.spec;
      const next = cleanSpec({ ...a.patch, id: prev.id }, prev);
      const restart = JSON.stringify([prev.location, prev.headed, prev.keepProfile, prev.executable]) !== JSON.stringify([next.location, next.headed, next.keepProfile, next.executable]);
      s.spec = next;
      await saveSpecs();
      if (prev.viewport?.width !== next.viewport?.width || prev.viewport?.height !== next.viewport?.height) await s.setViewport(next.viewport!.width, next.viewport!.height).catch(() => {});
      if (restart && s.status !== "stopped") { await s.stop(true); startQuietly(s); }
      publish();
      return s.view();
    },
    async remove(_ctx, a) {
      const s = get(a.id);
      await s.stop(true);
      if (a.deleteProfile) await s.removeProfile().catch(e => ctxRef.log.warn("remove profile", errMsg(e)));
      if (s.surface) await ctxRef.host.resources.release(s.surface).catch(() => {});
      sessions.delete(s.spec.id);
      await saveSpecs();
      publish();
      return null;
    },
    async start(_ctx, a) { const s = get(a.id); await s.start(); return s.view(); },
    async stop(_ctx, a) { const s = get(a.id); await s.stop(a.kill !== false); return s.view(); },
    async navigate(_ctx, a) { const s = get(a.id); await s.start(); return s.navigate(String(a.url || ""), a.tab, 1); },
    async history(_ctx, a) { return get(a.id).history(a.action, a.tab); },
    async newTab(_ctx, a) { const s = get(a.id); await s.start(); return s.newTab(a.url || "about:blank"); },
    async closeTab(_ctx, a) { await get(a.id).closeTab(String(a.tab)); return null; },
    async activateTab(_ctx, a) { await get(a.id).activate(String(a.tab)); return null; },
    async setViewport(_ctx, a) { const s = get(a.id); await s.setViewport(Number(a.width), Number(a.height)); await saveSpecs(); return s.view(); },
    /** Preview input from a `surface` node: {id, kind: pointer|wheel|key, event}. */
    async input(_ctx, a) {
      const s = get(a.id);
      if (s.status !== "running") return null;
      try {
        if (a.kind === "pointer") await s.userPointer(a.event);
        else if (a.kind === "wheel") await s.userWheel(a.event);
        else if (a.kind === "key") await s.userKey(a.event);
      } catch (e) { ctxRef.log.debug("browser input", errMsg(e)); }
      return null;
    },
    network(_ctx, a) { return { requests: get(a.id).networkLog({ limit: a.limit, filter: a.filter, tab: a.tab, failedOnly: a.failedOnly, headers: a.headers }) }; },
    networkEntry(_ctx, a) { return get(a.id).networkEntry(String(a.requestId)); },
    async networkBody(_ctx, a) { return get(a.id).networkBody(String(a.requestId), a.maxChars ?? 200_000); },
    clearNetwork(_ctx, a) { get(a.id).clearNetwork(); return null; },
    async evaluate(_ctx, a) { return { value: await get(a.id).evaluate(`function(){return (${String(a.expression)})}`, [], a.tab, true) }; },
    async text(_ctx, a) { return get(a.id).text(a.scope === "viewport" ? "viewport" : "page", a.selector, a.maxChars ?? 20_000, a.tab); },
    async elements(_ctx, a) { return get(a.id).elements(!!a.all, a.max ?? 200, a.tab); },
    async click(_ctx, a) { const s = get(a.id); s.noteAgent("Click", a.caller); return s.click(a); },
    async type(_ctx, a) { const s = get(a.id); s.noteAgent("Type", a.caller); return s.type(a); },
    async screenshot(_ctx, a) { return get(a.id).screenshot({ quality: a.quality, fullPage: a.fullPage, tab: a.tab }); },
    health: () => ({ ok: true, sessions: sessions.size }),
  },
};

export default mod;
