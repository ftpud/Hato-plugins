import type { AppModule, CloudDaemonConnection, Handle, ModuleContext, StreamSubscription } from "@hato/sdk/types";
import { cloudMachineId, errMsg, sshProfileSpec } from "@hato/sdk/runtime";
import { callback, CloudHttpError, DEFAULT_SERVER, eventFrames, jsonResponse, serverOrigin, webPath } from "./protocol";

type User = { email: string; name: string };
type Device = { name: string; fingerprint: string };
type Host = { id: string; name: string; publicKey: string; fingerprint: string; online: boolean };
type Project = { id: string; hostId: string; name: string; path: string };
type ConnectionState = { state: "idle" | "connecting" | "connected" | "reconnecting" | "error"; error?: string };
type Task = { label: string; step?: string };
type PresenceStream = { handle: Handle; subscription?: StreamSubscription };
type SignInFlow = { cancelled: boolean; finish?: () => void; done?: Promise<void> };

let server = DEFAULT_SERVER;
let user: User | null = null;
let device: Device | null = null;
let all: { hosts: Host[]; projects: Project[] } = { hosts: [], projects: [] };
let states: Record<string, ConnectionState> = {};
let task: Task | null = null;
let error: string | null = null;
let flow: SignInFlow | null = null;
let epoch = 0;
let inactive = false;
let stream: PresenceStream | null = null;
let streamPending = false;
let retry: ReturnType<typeof setTimeout> | undefined;
let heartbeat: ReturnType<typeof setInterval> | undefined;
let inventoryFetch: Promise<void> | null = null;
const routes = new Map<string, CloudDaemonConnection>();
const dialing = new Map<string, Promise<CloudDaemonConnection>>();
const probes = new Set<string>();
const serviceRecipients = new Set(["terminals", "persistent-agents", "workflows", "remote-runtime",
  "files", "git", "git-tasks", "projects", "run", "run-configurations", "acp", "debug", "language-service"]);
const changed = (ctx: ModuleContext) => { if (!inactive) ctx.events.emit("cloud.changed", {}); };
const settings = (ctx: ModuleContext, key: string) => ctx.modules.call("persistence", "settings.get", { key });
const save = (ctx: ModuleContext, key: string, value: any) => ctx.modules.call("persistence", "settings.set", { key, value });

function state(ctx: ModuleContext, hostId: string, value: ConnectionState) {
  const previous = states[hostId];
  if (previous?.state === value.state && previous.error === value.error) return;
  states = { ...states, [hostId]: value };
  changed(ctx);
}

async function stopStream(ctx: ModuleContext) {
  clearTimeout(retry);
  retry = undefined;
  if (!stream) return;
  const old = stream;
  stream = null;
  await old.subscription?.close().catch(() => {});
  await ctx.host.resources.release(old.handle).catch(() => {});
}

async function clearSession(ctx: ModuleContext, oldServer = server, forget = true) {
  ++epoch;
  user = null; device = null; all = { hosts: [], projects: [] }; states = {};
  const active = [...routes.values()];
  routes.clear();
  dialing.clear();
  inventoryFetch = null;
  if (forget) {
    await ctx.host.cloud.clear(oldServer).catch(() => {});
    const current = await ctx.modules.call("workspace", "current", {}).catch(() => null);
    if (current?.location === "cloud") {
      await ctx.modules.call("workspace", "forget", { workspaceIds: [current.id] }).catch(() => {});
    }
  }
  await Promise.all([stopStream(ctx), ...active.map(route => ctx.host.cloud.disconnect(route.target.connection).catch(() => {}))]);
  changed(ctx);
}

async function request<T>(ctx: ModuleContext, path: string, method: "GET" | "POST" | "DELETE" = "GET", body?: object): Promise<T> {
  const attempt = epoch;
  try {
    return jsonResponse<T>(await ctx.host.cloud.request(server, path, method, body));
  } catch (e) {
    if (attempt === epoch && user && (e instanceof CloudHttpError && e.status === 401 || (e as any)?.code === "ECLOUD_AUTH")) {
      error = "Your Cloud session expired. Sign in again.";
      await clearSession(ctx);
    }
    throw e;
  }
}

function refresh(ctx: ModuleContext) {
  if (!user) return Promise.resolve();
  if (inventoryFetch) return inventoryFetch;
  const attempt = epoch;
  const pending = (async () => {
    const [hosts, projects] = await Promise.all([
      request<{ hosts: Host[] }>(ctx, "/api/hosts"), request<{ projects: Project[] }>(ctx, "/api/projects"),
    ]);
    if (attempt !== epoch || inactive) return;
    await ctx.modules.call("persistence", "projects.syncCloud", { origin: server, projects: projects.projects });
    if (attempt !== epoch || inactive) return;
    all = { hosts: hosts.hosts, projects: projects.projects };
    error = null;
    changed(ctx);
    for (const [id, route] of routes) {
      const host = all.hosts.find(h => h.id === id);
      if (!host) {
        routes.delete(id);
        await ctx.host.cloud.disconnect(route.target.connection).catch(() => {});
        state(ctx, id, { state: "error", error: "Host access was revoked." });
      } else if (!host.online) state(ctx, id, { state: "reconnecting" });
      else if (states[id]?.state === "reconnecting") void probe(ctx, id, route);
    }
  })().finally(() => { if (inventoryFetch === pending) inventoryFetch = null; });
  inventoryFetch = pending;
  return pending;
}

async function probe(ctx: ModuleContext, id: string, route: CloudDaemonConnection) {
  if (probes.has(id) || inactive || !user) return;
  probes.add(id);
  const attempt = epoch;
  try {
    await ctx.host.daemon.status(route.target);
    if (epoch === attempt && routes.get(id) === route) state(ctx, id, { state: "connected" });
  } catch (e) {
    if (epoch === attempt && routes.get(id) === route) state(ctx, id, { state: "reconnecting", error: errMsg(e) });
  } finally { probes.delete(id); }
}

function watch(ctx: ModuleContext) {
  if (!user || inactive || stream || streamPending) return;
  const attempt = epoch;
  streamPending = true;
  const schedule = () => {
    clearTimeout(retry);
    if (epoch !== attempt || !user || inactive) return;
    retry = setTimeout(() => {
      if (epoch !== attempt || inactive) return;
      void refresh(ctx).catch((e) => { if (user) { error = errMsg(e); changed(ctx); } });
      watch(ctx);
    }, 2500);
  };
  void (async () => {
    const { handle } = await ctx.host.cloud.events(server);
    if (attempt !== epoch || inactive) { await ctx.host.resources.release(handle); return; }
    const current: PresenceStream = { handle };
    stream = current;
    let buffer = "";
    current.subscription = await ctx.host.streams.listen(handle, { encoding: "utf8" }, chunk => {
      if (stream !== current || epoch !== attempt) return;
      const parsed = eventFrames(buffer, chunk);
      buffer = parsed.buffer;
      for (const event of parsed.events) {
        if (event?.type === "host.online" || event?.type === "host.offline") {
          const item = event.host as Host;
          if (!item || typeof item.id !== "string") continue;
          all = { ...all, hosts: [...all.hosts.filter(host => host.id !== item.id), item] };
          changed(ctx);
          const route = routes.get(item.id);
          if (route && item.online) void probe(ctx, item.id, route);
          else if (route) state(ctx, item.id, { state: "reconnecting" });
        }
        if (event?.type === "host.revoked") void refresh(ctx).catch(() => {});
      }
    }, () => {
      if (stream === current) void stopStream(ctx).finally(schedule);
    });
    if (stream !== current) await current.subscription.close().catch(() => {});
  })().catch(() => { if (epoch === attempt) void stopStream(ctx).finally(schedule); })
    .finally(() => {
      streamPending = false;
      if (attempt !== epoch && user && !inactive) watch(ctx);
    });
}

async function restore(ctx: ModuleContext) {
  const attempt = epoch;
  try {
    const [me, currentDevice] = await Promise.all([
      request<{ user: User }>(ctx, "/api/me"), ctx.host.cloud.device(server),
    ]);
    if (attempt !== epoch || inactive) return;
    user = me.user;
    device = currentDevice;
    changed(ctx);
    await refresh(ctx).catch((e) => { error = errMsg(e); changed(ctx); });
    watch(ctx);
  } catch (e) {
    if (attempt !== epoch || inactive) return;
    if ((e as any)?.code !== "ECLOUD_AUTH" && !(e instanceof CloudHttpError && e.status === 401)) error = errMsg(e);
    changed(ctx);
  }
}

async function waitForBrowser(ctx: ModuleContext, listener: Handle, state: string, current: SignInFlow, open: () => Promise<void>) {
  const connections = new Set<Handle>();
  const subscriptions = new Set<StreamSubscription>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let finish!: (value: string | null) => void;
  const result = new Promise<string | null>(resolve => { finish = resolve; });
  current.finish = () => finish(null);
  const timeout = setTimeout(() => finish(null), 5 * 60_000);
  const close = (handle: Handle) => void ctx.host.net.close(handle).catch(() => {});
  try {
    let announcements = "";
    const listenerSubscription = await ctx.host.streams.listen(listener, { encoding: "utf8" }, chunk => {
      announcements += chunk;
      if (announcements.length > 128 * 1024) announcements = "";
      const lines = announcements.split("\n");
      announcements = lines.pop() ?? "";
      for (const line of lines) {
        let handle: Handle;
        try { handle = JSON.parse(line).connection; } catch { continue; }
        if (!handle) continue;
        if (current.cancelled || connections.size >= 16) { close(handle); continue; }
        connections.add(handle);
        const timer = setTimeout(() => { connections.delete(handle); close(handle); }, 10_000);
        timers.add(timer);
        let text = "", responded = false;
        void ctx.host.streams.listen(handle, { encoding: "utf8" }, bytes => {
          if (responded) return;
          text += bytes;
          if (!text.includes("\r\n\r\n") && text.length < 16_384) return;
          responded = true;
          const code = text.length <= 16_384 && !current.cancelled ? callback(text, state) : null;
          const body = code ? "You can close this tab and return to Hato." : "This callback does not match the Hato sign-in.";
          const response = `HTTP/1.1 ${code ? "200 OK" : "400 Bad Request"}\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: ${body.length}\r\n\r\n${body}`;
          clearTimeout(timer);
          timers.delete(timer);
          void ctx.host.net.write(handle, response).catch(() => {}).finally(() => {
            connections.delete(handle);
            close(handle);
            if (code) finish(code);
          });
        }).then(subscription => {
          if (!connections.has(handle)) void subscription.close().catch(() => {});
          else subscriptions.add(subscription);
        }).catch(() => { connections.delete(handle); close(handle); });
      }
    });
    subscriptions.add(listenerSubscription);
    if (!current.cancelled) await open();
    else finish(null);
    return await result;
  } finally {
    clearTimeout(timeout);
    for (const timer of timers) clearTimeout(timer);
    for (const handle of connections) close(handle);
    await Promise.all([...subscriptions].map(subscription => subscription.close().catch(() => {})));
    current.finish = undefined;
  }
}

function signIn(ctx: ModuleContext) {
  if (flow || user) return;
  const current: SignInFlow = { cancelled: false };
  flow = current;
  error = null;
  changed(ctx);
  const origin = server;
  current.done = (async () => {
    let listener: Handle | null = null;
    try {
      const key = await ctx.host.cloud.begin(origin);
      if (current.cancelled) return;
      const bound = await ctx.host.net.listenLoopback({});
      listener = bound.handle;
      const redirect_uri = `http://127.0.0.1:${bound.port}/callback`;
      const name = `Hato desktop (${ctx.host.env.info().platform})`;
      const query = Object.entries({ redirect_uri, state: key.state, code_challenge: key.challenge, public_key: key.publicKey, name })
        .map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("&");
      const code = await waitForBrowser(ctx, listener, key.state, current, () => ctx.host.ui.openUrl(`${origin}/auth/desktop?${query}`));
      if (current.cancelled) return;
      if (!code) throw new Error("The Cloud sign-in expired. Start again from Hato.");
      const result = jsonResponse<{ user: User; device: Device }>(
        await ctx.host.cloud.exchange(origin, { code, verifier: key.verifier, redirect_uri }),
      );
      if (current.cancelled || inactive) {
        await ctx.host.cloud.request(origin, "/auth/logout", "POST").catch(() => {});
        await ctx.host.cloud.clear(origin);
        return;
      }
      user = result.user;
      device = result.device;
      changed(ctx);
      await refresh(ctx).catch(e => { error = errMsg(e); });
      watch(ctx);
    } catch (e) {
      if (!current.cancelled) error = errMsg(e);
    } finally {
      if (listener) await ctx.host.net.close(listener).catch(() => {});
      if (flow === current) flow = null;
      changed(ctx);
    }
  })();
}

function cancel(ctx: ModuleContext) {
  if (!flow) return;
  flow.cancelled = true;
  flow.finish?.();
  changed(ctx);
}

async function signOut(ctx: ModuleContext) {
  const origin = server;
  cancel(ctx);
  await flow?.done;
  await ctx.host.cloud.request(origin, "/auth/logout", "POST").catch(() => {});
  error = null;
  await clearSession(ctx, origin);
}

function connect(ctx: ModuleContext, id: string): Promise<CloudDaemonConnection> {
  const existing = routes.get(id);
  if (existing) return Promise.resolve(existing);
  const inflight = dialing.get(id);
  if (inflight) return inflight;
  const attempt = epoch;
  const pending = (async () => {
    if (!user) throw new Error("Sign in to Hato Cloud before opening the workspace.");
    if (!all.hosts.some(h => h.id === id)) await refresh(ctx);
    const host = all.hosts.find(h => h.id === id);
    if (!host) throw new Error("Cloud host not found.");
    if (!host.online) throw new Error("The Cloud host is offline.");
    state(ctx, id, { state: "connecting" });
    const key = `cloud.pin:${server}:${id}`;
    const pin = await settings(ctx, key);
    if (pin && pin !== host.fingerprint) throw new Error("The Cloud host key changed. Verify the host before reconnecting.");
    const route = await ctx.host.cloud.connect(server, { hostId: id, publicKey: host.publicKey, fingerprint: host.fingerprint });
    if (attempt !== epoch || inactive) {
      await ctx.host.cloud.disconnect(route.target.connection);
      throw new Error("The Cloud session changed while connecting.");
    }
    try { if (!pin) await save(ctx, key, route.hostKeyFingerprint); }
    catch (e) { await ctx.host.cloud.disconnect(route.target.connection); throw e; }
    routes.set(id, route);
    state(ctx, id, { state: "connected" });
    return route;
  })().catch(e => {
    if (attempt === epoch) state(ctx, id, { state: "error", error: errMsg(e) });
    throw e;
  }).finally(() => { if (dialing.get(id) === pending) dialing.delete(id); });
  dialing.set(id, pending);
  return pending;
}

async function prepareProject(ctx: ModuleContext, projectId: string) {
  const project = all.projects.find(p => p.id === projectId);
  if (!project) throw new Error("Cloud project not found.");
  const attempt = epoch;
  const route = await connect(ctx, project.hostId);
  try {
    const { plugins } = await ctx.host.daemon.request(route.target, "plugins.list");
    if (!plugins.some((plugin: { id: string; active: boolean }) => plugin.id === "cloud-activity" && plugin.active)) {
      const pushed = await ctx.host.daemon.request(route.target, "plugins.push", { id: "cloud-activity" });
      if (!pushed.active) throw new Error(pushed.error || "Cloud activity module did not activate");
    }
  } catch (e) {
    ctx.log.warn("Could not enable Cloud activity: " + errMsg(e));
  }
  if (attempt !== epoch || inactive || routes.get(project.hostId) !== route) {
    throw new Error("The Cloud session changed while opening the project.");
  }
  return project;
}

async function sshProfiles(ctx: ModuleContext) {
  const profiles: any[] = await ctx.modules.call("persistence", "ssh.list", {});
  return profiles.filter(p => p.transport !== "wsl").map(p => ({ id: p.id, label: p.name || `${p.user}@${p.host}` }));
}

async function addHost(ctx: ModuleContext, a: { profileId: string; name: string }) {
  if (!user || task) throw new Error("Sign in and finish the current Cloud setup first.");
  const attempt = epoch;
  const update = (step: string) => { task = { label: "Add a Cloud host", step }; changed(ctx); };
  const name = typeof a.name === "string" ? a.name.trim() : "";
  if (!name || name.length > 120) throw new Error("Enter a host name of up to 120 characters.");
  update("Connect over SSH");
  try {
    const profile: any = await ctx.modules.call("persistence", "ssh.get", { id: a.profileId });
    if (!profile || profile.transport === "wsl") throw new Error("Choose an SSH profile.");
    const spec = sshProfileSpec({
      profileId: profile.id, host: profile.host, user: profile.user, port: profile.port,
      identityFile: profile.authRef && !["agent", "password"].includes(profile.authRef) ? profile.authRef : null,
      auth: profile.authRef === "password" ? "password" : undefined,
    });
    const { connection } = await ctx.host.ssh.connect(spec, { interactive: true });
    update("Install or update hatod");
    await ctx.host.daemon.ensure({ kind: "ssh", connection });
    if (epoch !== attempt) throw new Error("The Cloud session changed during setup.");
    const origin = server;
    update("Create a one-time enrolment claim");
    const { claim } = await request<{ claim: string }>(ctx, "/api/enrol/claims", "POST");
    if (epoch !== attempt) throw new Error("The Cloud session changed during setup.");
    update("Enrol the host");
    const result = await ctx.host.cloud.enrolSsh(connection, { server: origin, name, claim });
    update("Configure the connector to start at boot");
    await ctx.host.cloud.superviseSsh(connection);
    await refresh(ctx);
    return result;
  } finally { task = null; changed(ctx); }
}

const mod: AppModule = {
  id: "cloud",
  moduleApiVersion: 1,
  async activate(ctx, previous) {
    inactive = false;
    const value = await settings(ctx, "cloud.server");
    server = value ? serverOrigin(value) : DEFAULT_SERVER;
    states = previous?.states ?? {};
    for (const entry of previous?.routes ?? []) {
      if (Array.isArray(entry) && entry.length === 2) routes.set(entry[0], entry[1]);
    }
    heartbeat = setInterval(() => {
      for (const [id, route] of routes) if (all.hosts.some(host => host.id === id && host.online)) void probe(ctx, id, route);
    }, 15_000);
    setTimeout(() => { void restore(ctx); }, 0);
  },
  snapshot: () => ({ routes: [...routes], states }),
  canSwap: () => ({ ok: !flow && !task, reason: "Cloud sign-in or host setup is in progress" }),
  async deactivate(ctx) {
    inactive = true;
    ++epoch;
    clearInterval(heartbeat);
    flow?.finish?.();
    await stopStream(ctx);
  },
  methods: {
    status: () => ({ server, signedIn: user !== null, signingIn: !!flow && !flow.cancelled, user, device, task, error }),
    inventory: () => all,
    connections: () => Object.fromEntries(all.hosts.map(host => [host.id, states[host.id] ?? { state: "idle" }])),
    refresh: async ctx => { await refresh(ctx); watch(ctx); return all; },
    signIn,
    cancelSignIn: cancel,
    signOut,
    async setServer(ctx, a) {
      const next = serverOrigin(a.url);
      if (next === server) return next;
      await signOut(ctx);
      await save(ctx, "cloud.server", next);
      server = next;
      changed(ctx);
      return next;
    },
    openWeb: (ctx, a) => ctx.host.ui.openUrl(server + webPath(a.path)),
    async openProject(ctx, a) {
      const project = await prepareProject(ctx, String(a.projectId || ""));
      return ctx.modules.call("workspace", "select", { workspaceId: `cloud:${project.id}` });
    },
    async prepareProject(ctx, a, meta) {
      if (meta.caller !== "projects" || a.origin !== server) throw new Error("Sign into the project's Cloud server first.");
      await prepareProject(ctx, String(a.projectId || ""));
    },
    async addProject(ctx, a) {
      const result = await request(ctx, "/api/projects", "POST", {
        hostId: a.hostId, name: a.name, path: a.path, ...(typeof a.id === "string" ? { id: a.id } : {}),
      });
      await refresh(ctx);
      return result;
    },
    async removeProject(ctx, a, meta) {
      if (meta.caller !== "projects" || a.origin !== server || !user) throw new Error("Sign into the project's Cloud server first.");
      try { await request(ctx, "/api/projects/" + encodeURIComponent(a.projectId), "DELETE"); }
      catch (e) { if (!(e instanceof CloudHttpError) || e.status !== 404) throw e; }
      await refresh(ctx);
    },
    sshProfiles,
    addHostViaSsh: addHost,
    pendingEnrollment: (ctx, a) => request(ctx, "/api/enrol/pending/" + encodeURIComponent(a.userCode)),
    async approveEnrollment(ctx, a) { await request(ctx, "/api/enrol/approve", "POST", { userCode: a.userCode }); await refresh(ctx); },
    async denyEnrollment(ctx, a) { await request(ctx, "/api/enrol/deny", "POST", { userCode: a.userCode }); changed(ctx); },
    async target(ctx, a, meta) {
      if (!serviceRecipients.has(meta.caller)) throw new Error("Cloud daemon routes are available to workspace services only.");
      const id = String(a.hostId || "");
      if (a.machineId && a.machineId !== cloudMachineId(server, id)) throw new Error("This project belongs to another Cloud server.");
      const route = await connect(ctx, id);
      return ctx.host.cloud.share(route.target.connection, meta.caller);
    },
  },
};
export default mod;
