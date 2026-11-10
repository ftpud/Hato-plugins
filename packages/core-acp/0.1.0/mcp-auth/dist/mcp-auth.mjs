// sdk/runtime.ts
function errMsg(e) {
  return e && (e.message || String(e)) || "unknown error";
}

// sdk/sha256.ts
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

// sdk/mcp-servers.ts
function parseHttpUrl(url) {
  const m = /^(https?):\/\/([^/?#@\s]+)([^?#\s]*)(?:\?[^#\s]*)?(?:#\S*)?$/i.exec(String(url || "").trim());
  if (!m) return null;
  const scheme = m[1].toLowerCase(), host = m[2].toLowerCase();
  return { scheme, host, origin: `${scheme}://${host}`, path: m[3] || "/" };
}

// sdk/mcp-oauth.ts
var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function base64UrlFromHex(hex) {
  const bytes = hex.match(/../g).map((h) => parseInt(h, 16));
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = bytes[i] << 16 | (bytes[i + 1] ?? 0) << 8 | (bytes[i + 2] ?? 0);
    out += B64[n >> 18 & 63] + B64[n >> 12 & 63] + (i + 1 < bytes.length ? B64[n >> 6 & 63] : "") + (i + 2 < bytes.length ? B64[n & 63] : "");
  }
  return out;
}
var pkceChallenge = (verifier) => base64UrlFromHex(sha256Hex(verifier));
function form(params) {
  return Object.entries(params).filter(([, v]) => v !== void 0 && v !== null && v !== "").map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
}
function withQuery(url, params) {
  const q = form(params);
  return q ? `${url}${url.includes("?") ? "&" : "?"}${q}` : url;
}
function parseQuery(q) {
  const out = {};
  for (const part of q.replace(/^\?/, "").split("&")) {
    if (!part) continue;
    const i = part.indexOf("=");
    const dec = (s) => {
      try {
        return decodeURIComponent(s.replace(/\+/g, " "));
      } catch {
        return s;
      }
    };
    out[dec(i < 0 ? part : part.slice(0, i))] = i < 0 ? "" : dec(part.slice(i + 1));
  }
  return out;
}
function parseWwwAuthenticate(header) {
  const out = {};
  if (!header) return out;
  const re = /([a-zA-Z_][a-zA-Z0-9_-]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/g;
  let m;
  while (m = re.exec(header)) out[m[1].toLowerCase()] = (m[2] ?? m[3]).replace(/\\(.)/g, "$1");
  return out;
}
var trimSlash = (p) => p === "/" ? "" : p.replace(/\/+$/, "");
function protectedResourceMetadataUrls(serverUrl) {
  const u = parseHttpUrl(serverUrl);
  if (!u) return [];
  const path = trimSlash(u.path);
  return [.../* @__PURE__ */ new Set([`${u.origin}/.well-known/oauth-protected-resource${path}`, `${u.origin}/.well-known/oauth-protected-resource`])];
}
function authServerMetadataUrls(issuer) {
  const u = parseHttpUrl(issuer);
  if (!u) return [];
  const path = trimSlash(u.path);
  return path ? [`${u.origin}/.well-known/oauth-authorization-server${path}`, `${u.origin}/.well-known/openid-configuration${path}`, `${u.origin}${path}/.well-known/openid-configuration`] : [`${u.origin}/.well-known/oauth-authorization-server`, `${u.origin}/.well-known/openid-configuration`];
}
function canonicalResource(serverUrl) {
  const u = parseHttpUrl(serverUrl);
  return u ? `${u.origin}${trimSlash(u.path)}` : serverUrl;
}
function parseCallbackRequest(text) {
  const m = /^([A-Z]+) (\S+) HTTP\/1\.[01]\r?\n/.exec(text);
  if (!m) return null;
  const [path, q = ""] = m[2].split("?", 2);
  return { method: m[1], path, query: parseQuery(q) };
}
function callbackPage(ok, title, detail) {
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const body = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
body{margin:0;height:100vh;display:grid;place-items:center;font:15px -apple-system,system-ui,sans-serif;background:#14131c;color:#ecebf5}
.card{padding:32px 40px;border-radius:16px;background:#1f1d2b;box-shadow:0 10px 40px #0006;text-align:center;max-width:420px}
.icon{width:56px;height:56px;border-radius:50%;margin:0 auto 16px;display:grid;place-items:center;font-size:28px;background:${ok ? "#1f3d2c;color:#5fd38d" : "#3d1f24;color:#f07a7a"}}
h1{font-size:19px;margin:0 0 8px}p{margin:0;color:#a9a6bf;line-height:1.5}</style></head>
<body><div class="card"><div class="icon">${ok ? "✓" : "!"}</div><h1>${esc(title)}</h1><p>${esc(detail)}</p></div></body></html>`;
  const bytes = new TextEncoder().encode(body).length;
  return `HTTP/1.1 ${ok ? "200 OK" : "400 Bad Request"}\r
Content-Type: text/html; charset=utf-8\r
Content-Length: ${bytes}\r
Cache-Control: no-store\r
Connection: close\r
\r
${body}`;
}

// modules/services/mcp-auth/src/index.ts
var CALLBACK_PATH = "/mcp/oauth/callback";
var STORE = "mcp-auth.tokens.v1";
var SIGN_IN_TIMEOUT = 5 * 6e4;
var REFRESH_EARLY = 12e4;
var tokens = {};
var flows = {};
var cancels = /* @__PURE__ */ new Map();
var refreshing = /* @__PURE__ */ new Map();
var publishFlows = (ctx) => ctx.state.set("mcp-auth.flows", { ...flows });
var changed = (ctx, serverId) => ctx.events.emit("mcp-auth.changed", { serverId });
async function load(ctx) {
  const v = await ctx.modules.call("persistence", "settings.get", { key: STORE });
  tokens = v && typeof v === "object" ? v : {};
}
async function save(ctx) {
  await ctx.modules.call("persistence", "settings.set", { key: STORE, value: tokens });
}
function resolveLocation(base, location) {
  if (/^https?:\/\//i.test(location)) return location;
  const u = parseHttpUrl(base);
  return location.startsWith("/") ? u.origin + location : u.origin + u.path.replace(/[^/]*$/, "") + location;
}
async function http(ctx, req) {
  let r = { ...req };
  for (let hop = 0; hop < 5; hop++) {
    const res = await ctx.host.net.fetch({ timeoutMs: 2e4, maxBytes: 512 * 1024, ...r });
    if (![301, 302, 303, 307, 308].includes(res.status) || !res.headers.location) return res;
    r = { ...r, url: resolveLocation(r.url, res.headers.location), ...res.status === 303 ? { method: "GET", body: void 0 } : {} };
  }
  throw new Error("too many redirects");
}
var json = (r) => {
  try {
    return JSON.parse(r.body);
  } catch {
    return null;
  }
};
async function getJson(ctx, url) {
  try {
    const r = await http(ctx, { url, headers: { Accept: "application/json", "MCP-Protocol-Version": "2025-06-18" } });
    return r.status === 200 ? json(r) : null;
  } catch {
    return null;
  }
}
function oauthError(r, what) {
  const body = json(r);
  const detail = body?.error_description || body?.error || r.body.slice(0, 200).trim();
  return new Error(`${what} failed (HTTP ${r.status})${detail ? `: ${detail}` : ""}`);
}
async function discover(ctx, url, transport, headers) {
  let status = null, requiresAuth = null, challenge = {};
  if (transport !== "sse") {
    const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "hato", version: "0.1.0" } } };
    try {
      const r = await http(ctx, {
        url,
        method: "POST",
        body: JSON.stringify(init),
        timeoutMs: 15e3,
        maxBytes: 64 * 1024,
        headers: { ...headers, "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18" }
      });
      status = r.status;
      requiresAuth = r.status === 401 || r.status === 403 ? true : r.status < 400 ? false : null;
      challenge = parseWwwAuthenticate(r.headers["www-authenticate"]);
    } catch (e) {
      if (e?.code !== "ETIMEDOUT") throw new Error(`Cannot reach ${url}: ${errMsg(e)}`);
    }
  }
  let prm = null;
  for (const candidate of [challenge.resource_metadata, ...protectedResourceMetadataUrls(url)].filter(Boolean)) {
    prm = await getJson(ctx, candidate);
    if (prm && Array.isArray(prm.authorization_servers) && prm.authorization_servers.length) break;
    prm = null;
  }
  const origin = parseHttpUrl(url).origin;
  const issuer = prm?.authorization_servers?.[0] || origin;
  let metadata = null;
  for (const candidate of authServerMetadataUrls(issuer)) {
    metadata = await getJson(ctx, candidate);
    if (metadata?.authorization_endpoint && metadata?.token_endpoint) break;
    metadata = null;
  }
  let legacy = false;
  if (!metadata && !prm && requiresAuth) {
    metadata = { issuer: origin, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`, registration_endpoint: `${origin}/register` };
    legacy = true;
  }
  const scopes = challenge.scope || (Array.isArray(prm?.scopes_supported) ? prm.scopes_supported.join(" ") : null);
  if (metadata && requiresAuth === null && transport === "sse") requiresAuth = true;
  return { requiresAuth, status, issuer: metadata ? metadata.issuer || issuer : null, scopes, metadata, legacy };
}
async function waitForCallback(ctx, listener, state, onCancel) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (err, code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      err ? reject(err) : resolve(code);
    };
    const timer = setTimeout(() => finish(new Error("Sign-in timed out — the browser did not return to Hato within 5 minutes")), SIGN_IN_TIMEOUT);
    onCancel((reason) => finish(new Error(reason)));
    let pending = "";
    void ctx.host.streams.listen(listener, { encoding: "utf8" }, (chunk) => {
      pending += chunk;
      let i;
      while ((i = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, i);
        pending = pending.slice(i + 1);
        let conn = null;
        try {
          conn = JSON.parse(line).connection;
        } catch {
          conn = null;
        }
        if (conn) handleConnection(conn);
      }
    });
    const handleConnection = (conn) => {
      let buf = "";
      void ctx.host.streams.listen(conn, { encoding: "utf8" }, (chunk) => {
        buf += chunk;
        if (!buf.includes("\r\n\r\n") && buf.length < 16384) return;
        const req = parseCallbackRequest(buf);
        buf = "";
        let page;
        if (!req || req.path !== CALLBACK_PATH) page = callbackPage(false, "Not found", "This address only accepts the sign-in redirect.");
        else if (req.query.state !== state) page = callbackPage(false, "Sign-in not recognised", "The response did not match the sign-in Hato started. Start again from Hato.");
        else if (req.query.error) {
          const msg = req.query.error_description || req.query.error;
          page = callbackPage(false, "Sign-in was not completed", msg);
          finish(new Error(req.query.error === "access_denied" ? "Access was denied in the browser" : `Authorization failed: ${msg}`));
        } else if (!req.query.code) page = callbackPage(false, "Missing authorization code", "Start the sign-in again from Hato.");
        else {
          page = callbackPage(true, "Connected to Hato", "You can close this tab and return to Hato.");
          finish(null, req.query.code);
        }
        void ctx.host.net.write(conn, page).finally(() => ctx.host.net.close(conn).catch(() => {
        }));
      });
    };
  });
}
async function register(ctx, metadata, redirectUri, scope) {
  if (!metadata.registration_endpoint) throw new Error("This server does not support automatic client registration. Open Advanced and enter a client ID registered with the provider (and its redirect port).");
  const r = await http(ctx, {
    url: metadata.registration_endpoint,
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_name: "Hato",
      client_uri: "https://github.com/ftpud/hato",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      ...scope ? { scope } : {}
    })
  });
  if (r.status !== 200 && r.status !== 201) throw oauthError(r, "Client registration");
  const c = json(r);
  if (!c?.client_id) throw new Error("Client registration returned no client_id");
  const method = c.token_endpoint_auth_method === "client_secret_basic" ? "client_secret_basic" : c.client_secret ? "client_secret_post" : "none";
  return { clientId: String(c.client_id), clientSecret: c.client_secret ? String(c.client_secret) : void 0, authMethod: method };
}
function b64(text) {
  const s = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", bytes = new TextEncoder().encode(text);
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = bytes[i] << 16 | (bytes[i + 1] ?? 0) << 8 | (bytes[i + 2] ?? 0);
    out += s[n >> 18 & 63] + s[n >> 12 & 63] + (i + 1 < bytes.length ? s[n >> 6 & 63] : "=") + (i + 2 < bytes.length ? s[n & 63] : "=");
  }
  return out;
}
async function tokenRequest(ctx, rec, params) {
  const headers = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
  const body = { ...params, client_id: rec.clientId };
  if (rec.clientSecret && rec.authMethod === "client_secret_basic") headers.Authorization = `Basic ${b64(`${encodeURIComponent(rec.clientId)}:${encodeURIComponent(rec.clientSecret)}`)}`;
  else if (rec.clientSecret) body.client_secret = rec.clientSecret;
  const r = await http(ctx, { url: rec.tokenEndpoint, method: "POST", headers, body: form(body) });
  const t = json(r);
  if (r.status !== 200 || !t?.access_token) {
    const err = oauthError(r, params.grant_type === "refresh_token" ? "Token refresh" : "Token exchange");
    err.oauth = t?.error;
    throw err;
  }
  return t;
}
function applyToken(rec, t) {
  const now = Date.now();
  return {
    ...rec,
    accessToken: String(t.access_token),
    refreshToken: t.refresh_token ? String(t.refresh_token) : rec.refreshToken,
    expiresAt: Number.isFinite(Number(t.expires_in)) && Number(t.expires_in) > 0 ? now + Number(t.expires_in) * 1e3 : null,
    scope: typeof t.scope === "string" ? t.scope : rec.scope,
    obtainedAt: now
  };
}
async function signIn(ctx, a) {
  const serverId = String(a.serverId), url = String(a.url || ""), auth = a.auth || {};
  if (!parseHttpUrl(url)) throw new Error("A remote server URL is required");
  cancels.get(serverId)?.("Sign-in restarted");
  flows[serverId] = { status: "discovering", startedAt: Date.now() };
  publishFlows(ctx);
  let listener = null;
  let cancelled = null;
  cancels.set(serverId, (reason) => {
    cancelled?.(reason);
    if (!cancelled) flows[serverId] = { status: "error", error: reason, startedAt: Date.now() };
  });
  try {
    const headers = Object.fromEntries((Array.isArray(a.headers) ? a.headers : []).map((h) => [h.name, h.value]));
    const d = await discover(ctx, url, String(a.transport || "http"), headers);
    if (!d.metadata) throw new Error(d.requiresAuth === false ? "This server accepts requests without signing in — set authentication to None." : "Could not find OAuth metadata for this server.");
    if (Array.isArray(d.metadata.code_challenge_methods_supported) && !d.metadata.code_challenge_methods_supported.includes("S256")) throw new Error("The authorization server does not support PKCE (S256), which MCP requires.");
    const l = await ctx.host.net.listenLoopback({ port: Number(auth.redirectPort) || 0 });
    listener = l.handle;
    const redirectUri = `http://127.0.0.1:${l.port}${CALLBACK_PATH}`;
    const scope = auth.scopes || d.scopes || null;
    const client = auth.clientId ? {
      clientId: String(auth.clientId),
      clientSecret: auth.clientSecret ? String(auth.clientSecret) : void 0,
      authMethod: auth.clientSecret ? "client_secret_post" : "none"
    } : await register(ctx, d.metadata, redirectUri, scope);
    const verifier = crypto.randomHex(48), state = crypto.randomHex(16), resource = canonicalResource(url);
    const authorizeUrl = withQuery(d.metadata.authorization_endpoint, {
      response_type: "code",
      client_id: client.clientId,
      redirect_uri: redirectUri,
      code_challenge: pkceChallenge(verifier),
      code_challenge_method: "S256",
      state,
      scope,
      resource
    });
    flows[serverId] = { status: "waiting", authorizeUrl, issuer: d.issuer || void 0, startedAt: Date.now() };
    publishFlows(ctx);
    await ctx.host.ui.openUrl(authorizeUrl).catch((e) => ctx.log.warn("open browser", errMsg(e)));
    const code = await waitForCallback(ctx, listener, state, (fn) => {
      cancelled = fn;
    });
    flows[serverId] = { ...flows[serverId], status: "exchanging" };
    publishFlows(ctx);
    const base = { resource, issuer: d.issuer || "", tokenEndpoint: d.metadata.token_endpoint, revocationEndpoint: d.metadata.revocation_endpoint, ...client };
    const t = await tokenRequest(ctx, base, { grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier, resource });
    tokens = { ...tokens, [serverId]: applyToken(base, t) };
    await save(ctx);
    flows[serverId] = { status: "done", issuer: d.issuer || void 0, startedAt: Date.now() };
    changed(ctx, serverId);
  } catch (e) {
    flows[serverId] = { ...flows[serverId] || { startedAt: Date.now() }, status: "error", error: errMsg(e) };
  } finally {
    cancels.delete(serverId);
    if (listener) await ctx.host.net.close(listener).catch(() => {
    });
    publishFlows(ctx);
  }
}
async function fresh(ctx, serverId, url) {
  const rec = tokens[serverId];
  if (!rec || rec.resource !== canonicalResource(url)) throw new Error("Sign-in required");
  if (rec.expiresAt === null || rec.expiresAt - Date.now() > REFRESH_EARLY) return rec;
  if (!rec.refreshToken) throw new Error("Session expired — sign in again");
  let p = refreshing.get(serverId);
  if (!p) {
    p = (async () => {
      try {
        const t = await tokenRequest(ctx, rec, { grant_type: "refresh_token", refresh_token: rec.refreshToken, resource: rec.resource });
        tokens = { ...tokens, [serverId]: applyToken(rec, t) };
      } catch (e) {
        if (e?.oauth === "invalid_grant") {
          const { [serverId]: _gone, ...rest } = tokens;
          tokens = rest;
          await save(ctx);
          changed(ctx, serverId);
          throw new Error("Session expired — sign in again");
        }
        throw e;
      }
      await save(ctx);
      changed(ctx, serverId);
      return tokens[serverId];
    })().finally(() => refreshing.delete(serverId));
    refreshing.set(serverId, p);
  }
  return p;
}
function statusOf(serverId, url) {
  const rec = tokens[serverId];
  const flow = flows[serverId];
  if (!rec || url && rec.resource !== canonicalResource(url)) return { state: "signedOut", flow: flow || null };
  const expired = rec.expiresAt !== null && rec.expiresAt <= Date.now();
  return {
    state: expired && !rec.refreshToken ? "expired" : "signedIn",
    expiresAt: rec.expiresAt,
    refreshable: !!rec.refreshToken,
    issuer: rec.issuer,
    scope: rec.scope || null,
    obtainedAt: rec.obtainedAt,
    flow: flow || null
  };
}
var mod = {
  id: "mcp-auth",
  moduleApiVersion: 1,
  async activate(ctx) {
    await load(ctx);
    publishFlows(ctx);
  },
  async deactivate() {
    for (const cancel of cancels.values()) cancel("Hato reloaded the sign-in service");
  },
  methods: {
    /** Probe a remote server: reachability, whether OAuth is needed, issuer and suggested scopes. */
    async probe(ctx, a) {
      if (!parseHttpUrl(a?.url)) throw new Error("Enter an http(s) URL");
      const headers = Object.fromEntries((Array.isArray(a.headers) ? a.headers : []).map((h) => [h.name, h.value]));
      const d = await discover(ctx, String(a.url), String(a.transport || "http"), headers);
      return {
        status: d.status,
        requiresAuth: d.requiresAuth,
        oauth: !!d.metadata,
        issuer: d.issuer,
        scopes: d.scopes,
        legacy: d.legacy,
        dynamicRegistration: !!d.metadata?.registration_endpoint
      };
    },
    status(_ctx, a) {
      const list = Array.isArray(a?.servers) ? a.servers : [];
      return Object.fromEntries(list.map((s) => [String(s.id), statusOf(String(s.id), s.url)]));
    },
    /** Start the browser sign-in; progress is published at `mcp-auth.flows`. Returns immediately. */
    signIn(ctx, a) {
      void signIn(ctx, a);
      return { started: true };
    },
    cancel(ctx, a) {
      const id = String(a?.serverId);
      cancels.get(id)?.("Sign-in cancelled");
      delete flows[id];
      publishFlows(ctx);
      return null;
    },
    async signOut(ctx, a) {
      const id = String(a?.serverId), rec = tokens[id];
      if (rec?.revocationEndpoint) {
        await tokenRequest(ctx, { ...rec, tokenEndpoint: rec.revocationEndpoint }, { token: rec.refreshToken || rec.accessToken, token_type_hint: rec.refreshToken ? "refresh_token" : "access_token" }).catch(() => {
        });
      }
      const { [id]: _gone, ...rest } = tokens;
      tokens = rest;
      delete flows[id];
      await save(ctx);
      publishFlows(ctx);
      changed(ctx, id);
      return null;
    },
    /** `Authorization` header value for starting an agent session (refreshes when close to expiry). */
    async authorization(ctx, a, meta) {
      if (meta.caller !== "persistent-agents" && meta.caller !== "ai-sessions") throw new Error("Tokens are only issued to chat and background-agent launchers");
      const rec = await fresh(ctx, String(a.serverId), String(a.url));
      return `Bearer ${rec.accessToken}`;
    }
  }
};
var index_default = mod;
export {
  index_default as default
};
