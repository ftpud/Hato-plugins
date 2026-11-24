// ../sdk/sha256.ts
var K = new Uint32Array([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
function hasher() {
  const buf = new Uint8Array(64);
  const view = new DataView(buf.buffer);
  let used = 0;
  let length = 0;
  const H = new Uint32Array([1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225]);
  const W = new Uint32Array(64);
  const compress = () => {
    for (let i = 0; i < 16; i++) W[i] = view.getUint32(i * 4);
    for (let i = 16; i < 64; i++) {
      const a2 = W[i - 15], b2 = W[i - 2];
      const s0 = (a2 >>> 7 | a2 << 25) ^ (a2 >>> 18 | a2 << 14) ^ a2 >>> 3;
      const s1 = (b2 >>> 17 | b2 << 15) ^ (b2 >>> 19 | b2 << 13) ^ b2 >>> 10;
      W[i] = W[i - 16] + s0 + W[i - 7] + s1 >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = (e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7);
      const ch = e & f ^ ~e & g;
      const t1 = h + S1 + ch + K[i] + W[i] >>> 0;
      const S0 = (a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10);
      const mj = a & b ^ a & c ^ b & c;
      const t2 = S0 + mj >>> 0;
      h = g;
      g = f;
      f = e;
      e = d + t1 >>> 0;
      d = c;
      c = b;
      b = a;
      a = t1 + t2 >>> 0;
    }
    H[0] = H[0] + a >>> 0;
    H[1] = H[1] + b >>> 0;
    H[2] = H[2] + c >>> 0;
    H[3] = H[3] + d >>> 0;
    H[4] = H[4] + e >>> 0;
    H[5] = H[5] + f >>> 0;
    H[6] = H[6] + g >>> 0;
    H[7] = H[7] + h >>> 0;
  };
  const byte = (b) => {
    buf[used++] = b;
    length++;
    if (used === 64) {
      compress();
      used = 0;
    }
  };
  const update = (text, from, to) => {
    let i = from;
    for (; i < to; i++) {
      let c = text.charCodeAt(i);
      if (c >= 55296 && c <= 56319) {
        const d = text.charCodeAt(i + 1);
        if (d >= 56320 && d <= 57343) {
          c = 65536 + (c - 55296 << 10) + d - 56320;
          i++;
        } else c = 65533;
      } else if (c >= 56320 && c <= 57343) c = 65533;
      if (c < 128) byte(c);
      else if (c < 2048) {
        byte(192 | c >> 6);
        byte(128 | c & 63);
      } else if (c < 65536) {
        byte(224 | c >> 12);
        byte(128 | c >> 6 & 63);
        byte(128 | c & 63);
      } else {
        byte(240 | c >> 18);
        byte(128 | c >> 12 & 63);
        byte(128 | c >> 6 & 63);
        byte(128 | c & 63);
      }
    }
    return i;
  };
  const finish = () => {
    const bits = length * 8;
    byte(128);
    while (used !== 56) byte(0);
    view.setUint32(56, Math.floor(bits / 4294967296));
    view.setUint32(60, bits >>> 0);
    compress();
    let out = "";
    for (let i = 0; i < 8; i++) out += H[i].toString(16).padStart(8, "0");
    return out;
  };
  return { update, finish };
}
function sha256Hex(text) {
  const h = hasher();
  h.update(text, 0, text.length);
  return h.finish();
}

// ../sdk/runtime.ts
function cloudMachineId(server2, hostId) {
  return "cloud:" + sha256Hex(hostId + " on " + server2.replace(/^http/, "ws"));
}
function sshProfileSpec(ssh) {
  return { profileId: ssh.profileId, host: ssh.host, port: ssh.port, user: ssh.user, identityFile: ssh.identityFile ?? null, transport: ssh.transport ?? "ssh", ...ssh.auth ? { auth: ssh.auth } : {} };
}
function errMsg(e) {
  return e && (e.message || String(e)) || "unknown error";
}

// modules/services/cloud/src/protocol.ts
var DEFAULT_SERVER = "https://cloud-dev.hatopad.dev";
var loopback = /* @__PURE__ */ new Set(["127.0.0.1", "[::1]", "localhost"]);
function serverOrigin(value) {
  if (typeof value !== "string") throw new Error("Enter a Cloud server URL.");
  const match = /^(https?):\/\/(\[[0-9a-f:]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::([0-9]{1,5}))?\/?$/i.exec(value.trim());
  if (!match) throw new Error("Use a Cloud server origin, such as https://cloud-dev.hatopad.dev.");
  const scheme = match[1].toLowerCase();
  let host = match[2].toLowerCase();
  const port = match[3] ? Number(match[3]) : null;
  if (port !== null && (port < 1 || port > 65535)) throw new Error("Enter a valid Cloud server port.");
  if (scheme === "http" && !loopback.has(host)) throw new Error("Cloud servers require HTTPS, except on loopback.");
  if (host === "localhost" && scheme === "http") host = "127.0.0.1";
  return `${scheme}://${host}${port && port !== (scheme === "https" ? 443 : 80) ? ":" + port : ""}`;
}
function webPath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020\u007f]/u.test(value)) throw new Error("Use a path on the Cloud server.");
  return value;
}
var CloudHttpError = class extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
};
function jsonResponse(response) {
  let value = null;
  try {
    if (response.body) value = JSON.parse(response.body);
  } catch {
  }
  if (response.status >= 200 && response.status < 300 && (value !== null || response.status === 204)) return value;
  const code = typeof value?.error?.code === "string" ? value.error.code : "unavailable";
  const message = response.status === 401 ? "Your Cloud session expired. Sign in again." : typeof value?.error?.message === "string" ? value.error.message.trim().slice(0, 400) : "The Cloud server returned an invalid response.";
  throw new CloudHttpError(response.status, code, message);
}
function callback(text, state2) {
  const line = text.split("\r\n", 1)[0];
  const match = /^GET \/callback\?([^ ]+) HTTP\/1\.[01]$/.exec(line);
  if (!match) return null;
  const values = /* @__PURE__ */ new Map();
  try {
    for (const field of match[1].split("&")) {
      const i = field.indexOf("=");
      if (i < 1) return null;
      const key = decodeURIComponent(field.slice(0, i));
      if (values.has(key)) return null;
      values.set(key, decodeURIComponent(field.slice(i + 1)));
    }
  } catch {
    return null;
  }
  const code = values.get("code") ?? "";
  return values.get("state") === state2 && /^[A-Za-z0-9_-]{43}$/.test(code) ? code : null;
}
function eventFrames(buffer, chunk) {
  const text = (buffer + chunk).replace(/\r\n/g, "\n");
  if (text.length > 1024 * 1024) return { buffer: "", events: [] };
  const records = text.split("\n\n");
  const rest = records.pop() ?? "";
  const events = records.flatMap((record) => {
    const data = record.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n");
    try {
      return data ? [JSON.parse(data)] : [];
    } catch {
      return [];
    }
  });
  return { buffer: rest, events };
}

// modules/services/cloud/src/index.ts
var server = DEFAULT_SERVER;
var user = null;
var device = null;
var all = { hosts: [], projects: [] };
var states = {};
var task = null;
var error = null;
var flow = null;
var epoch = 0;
var inactive = false;
var stream = null;
var streamPending = false;
var retry;
var heartbeat;
var inventoryFetch = null;
var routes = /* @__PURE__ */ new Map();
var dialing = /* @__PURE__ */ new Map();
var probes = /* @__PURE__ */ new Set();
var serviceRecipients = /* @__PURE__ */ new Set([
  "terminals",
  "persistent-agents",
  "workflows",
  "remote-runtime",
  "files",
  "git",
  "git-tasks",
  "projects",
  "run",
  "run-configurations",
  "acp",
  "debug",
  "language-service"
]);
var changed = (ctx) => {
  if (!inactive) ctx.events.emit("cloud.changed", {});
};
var settings = (ctx, key) => ctx.modules.call("persistence", "settings.get", { key });
var save = (ctx, key, value) => ctx.modules.call("persistence", "settings.set", { key, value });
function state(ctx, hostId, value) {
  const previous = states[hostId];
  if (previous?.state === value.state && previous.error === value.error) return;
  states = { ...states, [hostId]: value };
  changed(ctx);
}
async function stopStream(ctx) {
  clearTimeout(retry);
  retry = void 0;
  if (!stream) return;
  const old = stream;
  stream = null;
  await old.subscription?.close().catch(() => {
  });
  await ctx.host.resources.release(old.handle).catch(() => {
  });
}
async function clearSession(ctx, oldServer = server, forget = true) {
  ++epoch;
  user = null;
  device = null;
  all = { hosts: [], projects: [] };
  states = {};
  const active = [...routes.values()];
  routes.clear();
  dialing.clear();
  inventoryFetch = null;
  if (forget) {
    await ctx.host.cloud.clear(oldServer).catch(() => {
    });
    const current = await ctx.modules.call("workspace", "current", {}).catch(() => null);
    if (current?.location === "cloud") {
      await ctx.modules.call("workspace", "forget", { workspaceIds: [current.id] }).catch(() => {
      });
    }
  }
  await Promise.all([stopStream(ctx), ...active.map((route) => ctx.host.cloud.disconnect(route.target.connection).catch(() => {
  }))]);
  changed(ctx);
}
async function request(ctx, path, method = "GET", body) {
  const attempt = epoch;
  try {
    return jsonResponse(await ctx.host.cloud.request(server, path, method, body));
  } catch (e) {
    if (attempt === epoch && user && (e instanceof CloudHttpError && e.status === 401 || e?.code === "ECLOUD_AUTH")) {
      error = "Your Cloud session expired. Sign in again.";
      await clearSession(ctx);
    }
    throw e;
  }
}
function refresh(ctx) {
  if (!user) return Promise.resolve();
  if (inventoryFetch) return inventoryFetch;
  const attempt = epoch;
  const pending = (async () => {
    const [hosts, projects] = await Promise.all([
      request(ctx, "/api/hosts"),
      request(ctx, "/api/projects")
    ]);
    if (attempt !== epoch || inactive) return;
    await ctx.modules.call("persistence", "projects.syncCloud", { origin: server, projects: projects.projects });
    if (attempt !== epoch || inactive) return;
    all = { hosts: hosts.hosts, projects: projects.projects };
    error = null;
    changed(ctx);
    for (const [id, route] of routes) {
      const host = all.hosts.find((h) => h.id === id);
      if (!host) {
        routes.delete(id);
        await ctx.host.cloud.disconnect(route.target.connection).catch(() => {
        });
        state(ctx, id, { state: "error", error: "Host access was revoked." });
      } else if (!host.online) state(ctx, id, { state: "reconnecting" });
      else if (states[id]?.state === "reconnecting") void probe(ctx, id, route);
    }
  })().finally(() => {
    if (inventoryFetch === pending) inventoryFetch = null;
  });
  inventoryFetch = pending;
  return pending;
}
async function probe(ctx, id, route) {
  if (probes.has(id) || inactive || !user) return;
  probes.add(id);
  const attempt = epoch;
  try {
    await ctx.host.daemon.status(route.target);
    if (epoch === attempt && routes.get(id) === route) state(ctx, id, { state: "connected" });
  } catch (e) {
    if (epoch === attempt && routes.get(id) === route) state(ctx, id, { state: "reconnecting", error: errMsg(e) });
  } finally {
    probes.delete(id);
  }
}
function watch(ctx) {
  if (!user || inactive || stream || streamPending) return;
  const attempt = epoch;
  streamPending = true;
  const schedule = () => {
    clearTimeout(retry);
    if (epoch !== attempt || !user || inactive) return;
    retry = setTimeout(() => {
      if (epoch !== attempt || inactive) return;
      void refresh(ctx).catch((e) => {
        if (user) {
          error = errMsg(e);
          changed(ctx);
        }
      });
      watch(ctx);
    }, 2500);
  };
  void (async () => {
    const { handle } = await ctx.host.cloud.events(server);
    if (attempt !== epoch || inactive) {
      await ctx.host.resources.release(handle);
      return;
    }
    const current = { handle };
    stream = current;
    let buffer = "";
    current.subscription = await ctx.host.streams.listen(handle, { encoding: "utf8" }, (chunk) => {
      if (stream !== current || epoch !== attempt) return;
      const parsed = eventFrames(buffer, chunk);
      buffer = parsed.buffer;
      for (const event of parsed.events) {
        if (event?.type === "host.online" || event?.type === "host.offline") {
          const item = event.host;
          if (!item || typeof item.id !== "string") continue;
          all = { ...all, hosts: [...all.hosts.filter((host) => host.id !== item.id), item] };
          changed(ctx);
          const route = routes.get(item.id);
          if (route && item.online) void probe(ctx, item.id, route);
          else if (route) state(ctx, item.id, { state: "reconnecting" });
        }
        if (event?.type === "host.revoked") void refresh(ctx).catch(() => {
        });
      }
    }, () => {
      if (stream === current) void stopStream(ctx).finally(schedule);
    });
    if (stream !== current) await current.subscription.close().catch(() => {
    });
  })().catch(() => {
    if (epoch === attempt) void stopStream(ctx).finally(schedule);
  }).finally(() => {
    streamPending = false;
    if (attempt !== epoch && user && !inactive) watch(ctx);
  });
}
async function restore(ctx) {
  const attempt = epoch;
  try {
    const [me, currentDevice] = await Promise.all([
      request(ctx, "/api/me"),
      ctx.host.cloud.device(server)
    ]);
    if (attempt !== epoch || inactive) return;
    user = me.user;
    device = currentDevice;
    changed(ctx);
    await refresh(ctx).catch((e) => {
      error = errMsg(e);
      changed(ctx);
    });
    watch(ctx);
  } catch (e) {
    if (attempt !== epoch || inactive) return;
    if (e?.code !== "ECLOUD_AUTH" && !(e instanceof CloudHttpError && e.status === 401)) error = errMsg(e);
    changed(ctx);
  }
}
async function waitForBrowser(ctx, listener, state2, current, open) {
  const connections = /* @__PURE__ */ new Set();
  const subscriptions = /* @__PURE__ */ new Set();
  const timers = /* @__PURE__ */ new Set();
  let finish;
  const result = new Promise((resolve) => {
    finish = resolve;
  });
  current.finish = () => finish(null);
  const timeout = setTimeout(() => finish(null), 5 * 6e4);
  const close = (handle) => void ctx.host.net.close(handle).catch(() => {
  });
  try {
    let announcements = "";
    const listenerSubscription = await ctx.host.streams.listen(listener, { encoding: "utf8" }, (chunk) => {
      announcements += chunk;
      if (announcements.length > 128 * 1024) announcements = "";
      const lines = announcements.split("\n");
      announcements = lines.pop() ?? "";
      for (const line of lines) {
        let handle;
        try {
          handle = JSON.parse(line).connection;
        } catch {
          continue;
        }
        if (!handle) continue;
        if (current.cancelled || connections.size >= 16) {
          close(handle);
          continue;
        }
        connections.add(handle);
        const timer = setTimeout(() => {
          connections.delete(handle);
          close(handle);
        }, 1e4);
        timers.add(timer);
        let text = "", responded = false;
        void ctx.host.streams.listen(handle, { encoding: "utf8" }, (bytes) => {
          if (responded) return;
          text += bytes;
          if (!text.includes("\r\n\r\n") && text.length < 16384) return;
          responded = true;
          const code = text.length <= 16384 && !current.cancelled ? callback(text, state2) : null;
          const body = code ? "You can close this tab and return to Hato." : "This callback does not match the Hato sign-in.";
          const response = `HTTP/1.1 ${code ? "200 OK" : "400 Bad Request"}\r
Content-Type: text/plain; charset=utf-8\r
Cache-Control: no-store\r
Connection: close\r
Content-Length: ${body.length}\r
\r
${body}`;
          clearTimeout(timer);
          timers.delete(timer);
          void ctx.host.net.write(handle, response).catch(() => {
          }).finally(() => {
            connections.delete(handle);
            close(handle);
            if (code) finish(code);
          });
        }).then((subscription) => {
          if (!connections.has(handle)) void subscription.close().catch(() => {
          });
          else subscriptions.add(subscription);
        }).catch(() => {
          connections.delete(handle);
          close(handle);
        });
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
    await Promise.all([...subscriptions].map((subscription) => subscription.close().catch(() => {
    })));
    current.finish = void 0;
  }
}
function signIn(ctx) {
  if (flow || user) return;
  const current = { cancelled: false };
  flow = current;
  error = null;
  changed(ctx);
  const origin = server;
  current.done = (async () => {
    let listener = null;
    try {
      const key = await ctx.host.cloud.begin(origin);
      if (current.cancelled) return;
      const bound = await ctx.host.net.listenLoopback({});
      listener = bound.handle;
      const redirect_uri = `http://127.0.0.1:${bound.port}/callback`;
      const name = `Hato desktop (${ctx.host.env.info().platform})`;
      const query = Object.entries({ redirect_uri, state: key.state, code_challenge: key.challenge, public_key: key.publicKey, name }).map(([name2, value]) => `${name2}=${encodeURIComponent(value)}`).join("&");
      const code = await waitForBrowser(ctx, listener, key.state, current, () => ctx.host.ui.openUrl(`${origin}/auth/desktop?${query}`));
      if (current.cancelled) return;
      if (!code) throw new Error("The Cloud sign-in expired. Start again from Hato.");
      const result = jsonResponse(
        await ctx.host.cloud.exchange(origin, { code, verifier: key.verifier, redirect_uri })
      );
      if (current.cancelled || inactive) {
        await ctx.host.cloud.request(origin, "/auth/logout", "POST").catch(() => {
        });
        await ctx.host.cloud.clear(origin);
        return;
      }
      user = result.user;
      device = result.device;
      changed(ctx);
      await refresh(ctx).catch((e) => {
        error = errMsg(e);
      });
      watch(ctx);
    } catch (e) {
      if (!current.cancelled) error = errMsg(e);
    } finally {
      if (listener) await ctx.host.net.close(listener).catch(() => {
      });
      if (flow === current) flow = null;
      changed(ctx);
    }
  })();
}
function cancel(ctx) {
  if (!flow) return;
  flow.cancelled = true;
  flow.finish?.();
  changed(ctx);
}
async function signOut(ctx) {
  const origin = server;
  cancel(ctx);
  await flow?.done;
  await ctx.host.cloud.request(origin, "/auth/logout", "POST").catch(() => {
  });
  error = null;
  await clearSession(ctx, origin);
}
function connect(ctx, id) {
  const existing = routes.get(id);
  if (existing) return Promise.resolve(existing);
  const inflight = dialing.get(id);
  if (inflight) return inflight;
  const attempt = epoch;
  const pending = (async () => {
    if (!user) throw new Error("Sign in to Hato Cloud before opening the workspace.");
    if (!all.hosts.some((h) => h.id === id)) await refresh(ctx);
    const host = all.hosts.find((h) => h.id === id);
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
    try {
      if (!pin) await save(ctx, key, route.hostKeyFingerprint);
    } catch (e) {
      await ctx.host.cloud.disconnect(route.target.connection);
      throw e;
    }
    routes.set(id, route);
    state(ctx, id, { state: "connected" });
    return route;
  })().catch((e) => {
    if (attempt === epoch) state(ctx, id, { state: "error", error: errMsg(e) });
    throw e;
  }).finally(() => {
    if (dialing.get(id) === pending) dialing.delete(id);
  });
  dialing.set(id, pending);
  return pending;
}
async function prepareProject(ctx, projectId) {
  const project = all.projects.find((p) => p.id === projectId);
  if (!project) throw new Error("Cloud project not found.");
  const attempt = epoch;
  const route = await connect(ctx, project.hostId);
  try {
    const { plugins } = await ctx.host.daemon.request(route.target, "plugins.list");
    if (!plugins.some((plugin) => plugin.id === "cloud-activity" && plugin.active)) {
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
async function sshProfiles(ctx) {
  const profiles = await ctx.modules.call("persistence", "ssh.list", {});
  return profiles.filter((p) => p.transport !== "wsl").map((p) => ({ id: p.id, label: p.name || `${p.user}@${p.host}` }));
}
async function addHost(ctx, a) {
  if (!user || task) throw new Error("Sign in and finish the current Cloud setup first.");
  const attempt = epoch;
  const update = (step) => {
    task = { label: "Add a Cloud host", step };
    changed(ctx);
  };
  const name = typeof a.name === "string" ? a.name.trim() : "";
  if (!name || name.length > 120) throw new Error("Enter a host name of up to 120 characters.");
  update("Connect over SSH");
  try {
    const profile = await ctx.modules.call("persistence", "ssh.get", { id: a.profileId });
    if (!profile || profile.transport === "wsl") throw new Error("Choose an SSH profile.");
    const spec = sshProfileSpec({
      profileId: profile.id,
      host: profile.host,
      user: profile.user,
      port: profile.port,
      identityFile: profile.authRef && !["agent", "password"].includes(profile.authRef) ? profile.authRef : null,
      auth: profile.authRef === "password" ? "password" : void 0
    });
    const { connection } = await ctx.host.ssh.connect(spec, { interactive: true });
    update("Install or update hatod");
    await ctx.host.daemon.ensure({ kind: "ssh", connection });
    if (epoch !== attempt) throw new Error("The Cloud session changed during setup.");
    const origin = server;
    update("Create a one-time enrolment claim");
    const { claim } = await request(ctx, "/api/enrol/claims", "POST");
    if (epoch !== attempt) throw new Error("The Cloud session changed during setup.");
    update("Enrol the host");
    const result = await ctx.host.cloud.enrolSsh(connection, { server: origin, name, claim });
    update("Configure the connector to start at boot");
    await ctx.host.cloud.superviseSsh(connection);
    await refresh(ctx);
    return result;
  } finally {
    task = null;
    changed(ctx);
  }
}
var mod = {
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
      for (const [id, route] of routes) if (all.hosts.some((host) => host.id === id && host.online)) void probe(ctx, id, route);
    }, 15e3);
    setTimeout(() => {
      void restore(ctx);
    }, 0);
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
    connections: () => Object.fromEntries(all.hosts.map((host) => [host.id, states[host.id] ?? { state: "idle" }])),
    refresh: async (ctx) => {
      await refresh(ctx);
      watch(ctx);
      return all;
    },
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
        hostId: a.hostId,
        name: a.name,
        path: a.path,
        ...typeof a.id === "string" ? { id: a.id } : {}
      });
      await refresh(ctx);
      return result;
    },
    async removeProject(ctx, a, meta) {
      if (meta.caller !== "projects" || a.origin !== server || !user) throw new Error("Sign into the project's Cloud server first.");
      try {
        await request(ctx, "/api/projects/" + encodeURIComponent(a.projectId), "DELETE");
      } catch (e) {
        if (!(e instanceof CloudHttpError) || e.status !== 404) throw e;
      }
      await refresh(ctx);
    },
    sshProfiles,
    addHostViaSsh: addHost,
    pendingEnrollment: (ctx, a) => request(ctx, "/api/enrol/pending/" + encodeURIComponent(a.userCode)),
    async approveEnrollment(ctx, a) {
      await request(ctx, "/api/enrol/approve", "POST", { userCode: a.userCode });
      await refresh(ctx);
    },
    async denyEnrollment(ctx, a) {
      await request(ctx, "/api/enrol/deny", "POST", { userCode: a.userCode });
      changed(ctx);
    },
    async target(ctx, a, meta) {
      if (!serviceRecipients.has(meta.caller)) throw new Error("Cloud daemon routes are available to workspace services only.");
      const id = String(a.hostId || "");
      if (a.machineId && a.machineId !== cloudMachineId(server, id)) throw new Error("This project belongs to another Cloud server.");
      const route = await connect(ctx, id);
      return ctx.host.cloud.share(route.target.connection, meta.caller);
    }
  }
};
var index_default = mod;
export {
  index_default as default
};
