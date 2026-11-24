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

// ../sdk/runtime.ts
var grantCache = /* @__PURE__ */ new Map();
var sshCache = /* @__PURE__ */ new Map();
function sshProfileSpec(ssh) {
  return { profileId: ssh.profileId, host: ssh.host, port: ssh.port, user: ssh.user, identityFile: ssh.identityFile ?? null, transport: ssh.transport ?? "ssh", ...ssh.auth ? { auth: ssh.auth } : {} };
}
function sshConnect(ctx, desc) {
  if (desc.location !== "ssh" || !desc.ssh) throw new Error("not an SSH workspace");
  const key = desc.machineId;
  let p = sshCache.get(key);
  if (!p) {
    p = ctx.host.ssh.connect(sshProfileSpec(desc.ssh));
    sshCache.set(key, p);
    p.catch(() => sshCache.delete(key));
  }
  return p;
}
function forgetSsh(machineId) {
  sshCache.delete(machineId);
  for (const k of Array.from(grantCache.keys())) if (k.includes("|" + machineId + "|")) grantCache.delete(k);
}
async function daemonTargetFor(ctx, desc) {
  switch (desc.location) {
    case "local":
      return { kind: "local" };
    case "ssh":
      return { kind: "ssh", connection: (await sshConnect(ctx, desc)).connection };
    case "cloud": {
      if (!desc.cloudHostId) throw new Error("Cloud workspace is missing its host.");
      const target2 = await ctx.modules.call("cloud", "target", {
        hostId: desc.cloudHostId,
        machineId: desc.machineId
      }, { timeoutMs: 62e4 });
      if (target2?.kind !== "cloud" || !target2.connection) throw new Error("Invalid Cloud daemon route.");
      return target2;
    }
    default:
      throw new Error("Unsupported workspace location.");
  }
}
async function targetFor(ctx, desc) {
  if (desc.location === "local") return { kind: "local" };
  if (desc.location === "cloud") return daemonTargetFor(ctx, desc);
  const c = await sshConnect(ctx, desc);
  return { kind: "ssh", connection: c.connection, machineId: c.machineId };
}
async function workspaceGrant(ctx, desc, kind, root) {
  const r = root || desc.rootAbsolutePath;
  const cloud = desc.location === "cloud" ? await targetFor(ctx, desc) : null;
  const key = kind + "|" + desc.machineId + "|" + r + "|" + (cloud?.kind === "cloud" ? cloud.connection : "");
  let p = grantCache.get(key);
  if (!p) {
    p = (async () => {
      const target2 = cloud ?? await targetFor(ctx, desc);
      return ctx.host.capabilities.request({ kind, root: r, target: target2 });
    })();
    grantCache.set(key, p);
    p.catch(() => grantCache.delete(key));
  }
  try {
    return await p;
  } catch (e) {
    if (e && (e.code === "ENOTCONN" || e.code === "EBADF")) forgetSsh(desc.machineId);
    throw e;
  }
}
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
      const scope = request.scope;
      if (!scope || typeof scope.workspaceId !== "string" || typeof scope.conversationId !== "string" || typeof scope.machineId !== "string") throw new Error("Missing authenticated MCP scope");
      const result = await tool.handler(request.args || {}, scope);
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

// ../sdk/browser.ts
var DEFAULT_VIEWPORT = { width: 1280, height: 800 };
function locationLabel(l) {
  switch (l.kind) {
    case "local":
      return "This computer";
    case "workspace":
      return l.label ? `Workspace · ${l.label}` : "Workspace machine";
    case "endpoint":
      return l.url.replace(/^(wss?|https?):\/\//, "").replace(/\/devtools\/.*$/, "").replace(/[?#].*$/, "");
  }
}

// modules/services/browser/src/cdp.ts
var CdpError = class extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
};
var Cdp = class _Cdp {
  constructor(ctx, handle) {
    this.ctx = ctx;
    this.handle = handle;
    this.nextId = 1;
    this.pending = /* @__PURE__ */ new Map();
    this.listeners = /* @__PURE__ */ new Map();
    this.buffer = "";
    this.sub = null;
    /** Host ops run concurrently; chain writes so messages (e.g. press then release) stay ordered. */
    this.writes = Promise.resolve();
    this.closed = false;
    this.onClose = () => {
    };
  }
  static async connect(ctx, url) {
    const { handle } = await ctx.host.net.websocket(url, { timeoutMs: 15e3 });
    const cdp = new _Cdp(ctx, handle);
    cdp.sub = await ctx.host.streams.listen(handle, { highWaterMark: 32 << 20 }, (chunk) => cdp.data(chunk), (err) => cdp.end(err ? err.message : "connection closed"));
    return cdp;
  }
  data(chunk) {
    this.buffer += chunk;
    let nl;
    while ((nl = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      let frame;
      try {
        frame = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof frame.t !== "string") continue;
      let msg;
      try {
        msg = JSON.parse(frame.t);
      } catch {
        continue;
      }
      this.dispatch(msg);
    }
  }
  dispatch(msg) {
    if (typeof msg.id === "number") {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new CdpError(`${p.method}: ${msg.error.message || "failed"}`, msg.error.code));
      else p.resolve(msg.result || {});
      return;
    }
    if (typeof msg.method !== "string") return;
    for (const key of [msg.method, "*"]) {
      const set = this.listeners.get(key);
      if (set) for (const l of [...set]) {
        try {
          key === "*" ? l({ method: msg.method, params: msg.params }, msg.sessionId) : l(msg.params || {}, msg.sessionId);
        } catch (e) {
          this.ctx.log.warn("CDP listener", msg.method, String(e));
        }
      }
    }
  }
  end(reason) {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new CdpError(`${p.method}: ${reason}`));
    }
    this.pending.clear();
    this.onClose(reason);
  }
  send(method, params = {}, sessionId, timeoutMs = 3e4) {
    if (this.closed) return Promise.reject(new CdpError(`${method}: browser connection is closed`));
    const id = this.nextId++;
    const body = JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CdpError(`${method}: timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, method, timer });
      this.writes = this.writes.then(() => this.ctx.host.net.write(this.handle, body)).catch((e) => {
        const p = this.pending.get(id);
        if (p) {
          this.pending.delete(id);
          clearTimeout(p.timer);
          p.reject(e);
        }
      });
    });
  }
  on(method, listener) {
    let set = this.listeners.get(method);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      this.listeners.set(method, set);
    }
    set.add(listener);
    return () => set.delete(listener);
  }
  async close() {
    this.end("closed");
    try {
      await this.sub?.close();
    } catch {
    }
    try {
      await this.ctx.host.net.close(this.handle);
    } catch {
    }
  }
};

// modules/services/browser/src/launch.ts
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function machineFor(ctx, spec) {
  const loc = spec.location;
  if (loc.kind === "local") {
    const shared = String(ctx.host.env.info().sharedDir || "").replace(/\/+$/, "");
    if (!shared) throw new Error("Hato's shared data folder is unavailable");
    const grant2 = await ctx.host.capabilities.request({ kind: "process", root: shared, purpose: "Run browser sessions" });
    return { id: "local", label: "This computer", grant: grant2, target: { kind: "local" }, stateDir: `${shared}/browser` };
  }
  if (loc.kind !== "workspace") throw new Error("Endpoint sessions do not run a browser process");
  const desc = await ctx.modules.call("workspace", "resolve", { workspaceId: loc.workspaceId });
  if (desc.location === "cloud") throw new Error("Browser sessions on Cloud machines are not supported yet");
  const grant = await workspaceGrant(ctx, desc, "process");
  const target2 = await targetFor(ctx, desc);
  let home = null;
  if (desc.location === "ssh") home = (await sshConnect(ctx, desc)).home;
  else home = ctx.host.env.info().home;
  if (!home) throw new Error("Cannot determine the home folder on the workspace machine");
  if (desc.location === "local") {
    const shared = String(ctx.host.env.info().sharedDir || "").replace(/\/+$/, "");
    return { id: "local", label: "This computer", grant, target: target2, stateDir: `${shared}/browser`, desc };
  }
  return { id: desc.machineId, label: desc.name, grant, target: target2, stateDir: `${home.replace(/\/+$/, "")}/.local/state/hato/browser`, desc };
}
async function sh(ctx, m, script, args = [], timeoutMs = 3e4, env) {
  return ctx.host.process.run(
    m.grant.grant,
    { target: m.target, executable: "sh", args: ["-c", script, "sh", ...args], cwd: m.grant.root, env, loginShell: m.target.kind !== "local" },
    { timeoutMs, limitBytes: 1 << 20 }
  );
}
var DETECT = `
for c in "$HATO_BROWSER" "$1/chrome-headless-shell/current/chrome-headless-shell" \\
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" "/Applications/Chromium.app/Contents/MacOS/Chromium" \\
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" \\
  "$HOME/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; do
  [ -n "$c" ] && [ -x "$c" ] && { printf '%s' "$c"; exit 0; }
done
for n in google-chrome-stable google-chrome chromium chromium-browser microsoft-edge brave-browser chrome-headless-shell; do
  p=$(command -v "$n" 2>/dev/null) && [ -n "$p" ] && { printf '%s' "$p"; exit 0; }
done
exit 3`;
async function findBrowser(ctx, m, preferred) {
  const r = await sh(ctx, m, DETECT, [m.stateDir], 15e3, { HATO_BROWSER: preferred || "" });
  return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}
var INSTALL = `
set -e
D="$1/chrome-headless-shell"; U="$2"
mkdir -p "$D"; cd "$D"; rm -rf tmp; mkdir tmp
if command -v curl >/dev/null 2>&1; then curl -fsSL "$U" -o tmp/s.zip; else wget -q -O tmp/s.zip "$U"; fi
if command -v unzip >/dev/null 2>&1; then unzip -q tmp/s.zip -d tmp; else python3 -c 'import sys,zipfile;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' tmp/s.zip tmp; fi
rm -rf current; mv tmp/chrome-headless-shell-* current; rm -rf tmp
chmod +x current/chrome-headless-shell 2>/dev/null || true
xattr -dr com.apple.quarantine current 2>/dev/null || true
printf '%s' "$D/current/chrome-headless-shell"`;
async function installHeadlessShell(ctx, m) {
  const uname = await sh(ctx, m, "uname -sm");
  const [os, arch] = uname.stdout.trim().split(/\s+/);
  const platform = os === "Darwin" ? arch === "arm64" ? "mac-arm64" : "mac-x64" : os === "Linux" && (arch === "x86_64" || arch === "amd64") ? "linux64" : null;
  if (!platform) throw new Error(`No managed headless browser for ${uname.stdout.trim() || "this machine"}; install Chrome or Chromium there`);
  const res = await ctx.host.net.fetch({ url: "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json", maxBytes: 4 << 20 });
  if (res.status !== 200) throw new Error(`Chrome for Testing index unavailable (HTTP ${res.status})`);
  const stable = JSON.parse(res.body)?.channels?.Stable;
  const url = stable?.downloads?.["chrome-headless-shell"]?.find((d) => d.platform === platform)?.url;
  if (typeof url !== "string" || !url.startsWith("https://")) throw new Error("Chrome for Testing has no headless shell for this platform");
  const r = await sh(ctx, m, INSTALL, [m.stateDir, url], 6e5);
  if (r.code !== 0) throw new Error(`Installing the headless browser failed: ${(r.stderr || r.stdout).trim().slice(-400)}`);
  return r.stdout.trim();
}
var LAUNCH = `
P="$1"; B="$2"; FRESH="$3"; shift 3
[ "$FRESH" = 1 ] && rm -rf "$P"
mkdir -p "$P"; rm -f "$P/DevToolsActivePort"
exec "$B" "$@"`;
var processKey = (id) => `browser-${id.replace(/[^A-Za-z0-9_-]/g, "_")}`;
async function daemonFor(ctx, m) {
  try {
    const target2 = m.desc ? await daemonTargetFor(ctx, m.desc) : { kind: "local" };
    await ctx.host.daemon.ensure(target2);
    return target2;
  } catch (e) {
    ctx.log.warn("browser daemon unavailable", errMsg(e));
    return null;
  }
}
async function launch(ctx, m, spec, bin, viewport) {
  const keep = spec.keepProfile !== false;
  const profile = `${m.stateDir}/${keep ? "profiles" : "scratch"}/${spec.id.replace(/[^A-Za-z0-9_-]/g, "_")}`;
  const headless = !(spec.headed && m.target.kind === "local");
  const flags = [
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=Translate,MediaRouter,OptimizationHints",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--use-mock-keychain",
    "--password-store=basic",
    "--mute-audio",
    `--window-size=${viewport.width},${viewport.height}`,
    ...headless && !/headless-shell/.test(bin) ? ["--headless=new"] : [],
    ...m.target.kind !== "local" ? ["--no-sandbox"] : [],
    spec.startUrl || "about:blank"
  ];
  const key = processKey(spec.id);
  const daemon = await daemonFor(ctx, m);
  const req = { target: m.target, executable: "sh", args: ["-c", LAUNCH, "sh", profile, bin, keep ? "0" : "1", ...flags], cwd: m.grant.root, loginShell: m.target.kind !== "local" };
  const { handle } = await ctx.host.process.spawn(m.grant.grant, daemon ? { ...req, persist: { key } } : req);
  return { handle, key, daemon, profile };
}
async function devtoolsPort(ctx, m, profile, timeoutMs = 3e4) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await sh(ctx, m, 'cat "$1/DevToolsActivePort" 2>/dev/null', [profile], 1e4).catch(() => null);
    const [port, path] = (r?.stdout || "").split("\n").map((s) => s.trim());
    if (/^\d+$/.test(port || "") && path?.startsWith("/devtools/browser/")) return { port: Number(port), path };
    await sleep(250);
  }
  throw new Error("The browser did not open its DevTools port in time");
}
async function endpointUrl(ctx, url) {
  const u = url.trim();
  if (/^wss?:\/\//i.test(u)) return u;
  if (!/^https?:\/\//i.test(u)) throw new Error("Endpoint must be ws(s):// or http(s)://");
  const base = u.replace(/\/+$/, "").replace(/\/json(\/version)?$/, "");
  const res = await ctx.host.net.fetch({ url: `${base}/json/version`, timeoutMs: 1e4 });
  if (res.status !== 200) throw new Error(`DevTools endpoint answered HTTP ${res.status}`);
  const ws = JSON.parse(res.body)?.webSocketDebuggerUrl;
  if (typeof ws !== "string") throw new Error("DevTools endpoint did not report a browser websocket");
  return ws;
}
async function forward(ctx, m, port) {
  if (m.target.kind === "local") return { handle: null, port };
  if (!m.desc || m.desc.location !== "ssh") throw new Error("Unsupported machine");
  const { connection } = await sshConnect(ctx, m.desc);
  const f = await ctx.host.ssh.localForward(connection, { localPort: 0, remoteHost: "127.0.0.1", remotePort: port });
  return { handle: f.handle, port: f.localPort };
}

// modules/services/browser/src/scripts.ts
var TEXT_FN = `function(scope, selector, max) {
  const root = selector ? document.querySelector(selector) : document.body;
  if (!root) return { error: "No element matches " + selector };
  const vw = innerWidth, vh = innerHeight;
  if (scope !== "viewport") {
    const t = (root.innerText || "").replace(/\\n{3,}/g, "\\n\\n").trim();
    return { text: t.slice(0, max), total: t.length, truncated: t.length > max };
  }
  const out = []; let len = 0; let last = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const s = n.nodeValue.replace(/\\s+/g, " ").trim();
    if (!s) continue;
    const el = n.parentElement;
    if (!el) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
    range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.right < 0 || r.top > vh || r.left > vw) continue;
    const block = el.closest("p,li,h1,h2,h3,h4,h5,h6,tr,div,section,article,header,footer,nav,td,th,label,button,a") || el;
    out.push((last && last !== block ? "\\n" : " ") + s); last = block;
    len += s.length + 1; if (len > max) break;
  }
  const t = out.join("").replace(/^\\s+/, "").replace(/ \\n/g, "\\n");
  return { text: t.slice(0, max), total: t.length, truncated: len > max };
}`;
var ELEMENTS_FN = `function(all, max) {
  const sel = 'a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=option],[role=switch],[role=combobox],[role=textbox],[contenteditable=""],[contenteditable=true],[onclick],[tabindex]:not([tabindex="-1"])';
  const vw = innerWidth, vh = innerHeight;
  let next = Number(document.documentElement.getAttribute("data-hato-next") || "1");
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || cs.pointerEvents === "none") continue;
    const inView = !(r.bottom < 0 || r.right < 0 || r.top > vh || r.left > vw);
    if (!all && !inView) continue;
    let ref = el.getAttribute("data-hato-ref");
    if (!ref) { ref = String(next++); el.setAttribute("data-hato-ref", ref); }
    const tag = el.tagName.toLowerCase();
    const label = (el.getAttribute("aria-label") || el.innerText || el.value || el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("alt") || el.getAttribute("name") || "").replace(/\\s+/g, " ").trim().slice(0, 120);
    const item = { ref: Number(ref), tag, role: el.getAttribute("role") || undefined, text: label, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height), inView };
    if (tag === "input") { item.type = el.type; if (el.type === "checkbox" || el.type === "radio") item.checked = el.checked; }
    if (tag === "a") item.href = el.href;
    if (el.disabled) item.disabled = true;
    out.push(item);
    if (out.length >= max) break;
  }
  document.documentElement.setAttribute("data-hato-next", String(next));
  return { elements: out, viewport: { width: vw, height: vh }, scroll: { x: scrollX, y: scrollY } };
}`;
var LOCATE_FN = `function(ref, selector) {
  const el = ref ? document.querySelector('[data-hato-ref="' + ref + '"]') : document.querySelector(selector);
  if (!el) return { error: ref ? "Element ref " + ref + " is gone; list elements again" : "No element matches " + selector };
  el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, tag: el.tagName.toLowerCase(), editable: el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName) };
}`;
var CLEAR_FN = `function(ref, selector) {
  const el = ref ? document.querySelector('[data-hato-ref="' + ref + '"]') : selector ? document.querySelector(selector) : document.activeElement;
  if (!el) return false;
  el.focus();
  if (typeof el.select === "function") { el.select(); return true; }
  if (el.isContentEditable) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true; }
  return false;
}`;
var WAIT_FN = `function(selector, text) {
  if (!selector && !text) return document.readyState === "complete";
  return (!selector || !!document.querySelector(selector))
    && (!text || (document.body && document.body.innerText || "").includes(text));
}`;

// modules/services/browser/src/session.ts
var sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));
var NETWORK_LIMIT = 1e3;
var SPECIAL = {
  Enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  Tab: { key: "Tab", code: "Tab", keyCode: 9 },
  Escape: { key: "Escape", code: "Escape", keyCode: 27 },
  Backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  Delete: { key: "Delete", code: "Delete", keyCode: 46 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  Home: { key: "Home", code: "Home", keyCode: 36 },
  End: { key: "End", code: "End", keyCode: 35 },
  PageUp: { key: "PageUp", code: "PageUp", keyCode: 33 },
  PageDown: { key: "PageDown", code: "PageDown", keyCode: 34 },
  Space: { key: " ", code: "Space", keyCode: 32, text: " " },
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, { key: `F${i + 1}`, code: `F${i + 1}`, keyCode: 112 + i }]))
};
var ALIASES = {
  enter: "Enter",
  return: "Enter",
  tab: "Tab",
  escape: "Escape",
  esc: "Escape",
  backspace: "Backspace",
  delete: "Delete",
  left: "ArrowLeft",
  right: "ArrowRight",
  up: "ArrowUp",
  down: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  space: "Space",
  " ": "Space"
};
function keyDef(name) {
  const special = SPECIAL[name] || SPECIAL[ALIASES[name.toLowerCase()] || ""] || (/^f\d{1,2}$/i.test(name) ? SPECIAL[name.toUpperCase()] : void 0);
  if (special) return special;
  if ([...name].length !== 1) return null;
  const upper = name.toUpperCase();
  if (/[A-Z]/.test(upper)) return { key: name, code: `Key${upper}`, keyCode: upper.charCodeAt(0), text: name };
  if (/[0-9]/.test(name)) return { key: name, code: `Digit${name}`, keyCode: name.charCodeAt(0), text: name };
  return { key: name, code: "", keyCode: 0, text: name };
}
function editCommands(def, m) {
  const k = def.key.toLowerCase();
  if (m.meta || m.ctrl) {
    if (k === "a") return ["selectAll"];
    if (k === "z") return [m.shift ? "redo" : "undo"];
    if (k === "y") return ["redo"];
    if (k === "x") return ["cut"];
    if (k === "c") return ["copy"];
    if (m.meta && k === "arrowleft") return [m.shift ? "moveToBeginningOfLineAndModifySelection" : "moveToBeginningOfLine"];
    if (m.meta && k === "arrowright") return [m.shift ? "moveToEndOfLineAndModifySelection" : "moveToEndOfLine"];
    if (m.meta && k === "backspace") return ["deleteToBeginningOfLine"];
  }
  if (m.alt) {
    if (k === "arrowleft") return [m.shift ? "moveWordLeftAndModifySelection" : "moveWordLeft"];
    if (k === "arrowright") return [m.shift ? "moveWordRightAndModifySelection" : "moveWordRight"];
    if (k === "backspace") return ["deleteWordBackward"];
  }
  return [];
}
var modBits = (m = {}) => (m.alt ? 1 : 0) | (m.ctrl ? 2 : 0) | (m.meta ? 4 : 0) | (m.shift ? 8 : 0);
var BrowserSession = class {
  constructor(ctx, spec, changed, carry) {
    this.ctx = ctx;
    this.spec = spec;
    this.changed = changed;
    this.status = "stopped";
    this.cdp = null;
    this.tabs = /* @__PURE__ */ new Map();
    this.activeTab = null;
    this.surface = null;
    this.network = [];
    this.netSeq = 0;
    this.netIndex = /* @__PURE__ */ new Map();
    this.machine = null;
    this.launched = null;
    this.wsUrl = "";
    this.forwardHandle = null;
    this.screencastSession = null;
    this.cursor = { x: 0, y: 0, shown: false };
    this.stopping = false;
    this.starting = null;
    this.retries = 0;
    this.bySession = /* @__PURE__ */ new Map();
    this.loadWaiters = /* @__PURE__ */ new Set();
    this.titleTimer = null;
    if (carry?.surface) this.surface = carry.surface;
    if (carry?.proc && carry.profile && carry.key) this.launched = { handle: carry.proc, profile: carry.profile, key: carry.key, daemon: carry.daemon ?? null };
  }
  get viewport() {
    return this.spec.viewport || DEFAULT_VIEWPORT;
  }
  carry() {
    return {
      surface: this.surface || void 0,
      proc: this.launched?.handle,
      profile: this.launched?.profile,
      key: this.launched?.key,
      daemon: this.launched?.daemon,
      ws: this.cdp?.handle,
      forward: this.forwardHandle
    };
  }
  view() {
    const tab2 = this.activeTab ? this.tabs.get(this.activeTab) : void 0;
    return {
      id: this.spec.id,
      name: this.spec.name,
      location: this.spec.location,
      locationLabel: locationLabel(this.spec.location),
      status: this.status,
      error: this.error,
      progress: this.progress,
      agentAccess: !!this.spec.agentAccess,
      headed: !!this.spec.headed,
      keepProfile: this.spec.keepProfile !== false,
      viewport: this.viewport,
      surface: this.surface,
      tabs: [...this.tabs.values()].map((t) => ({ id: t.id, title: t.title, url: t.url, loading: t.loading, active: t.id === this.activeTab })),
      activeTab: this.activeTab,
      url: tab2?.url || "",
      title: tab2?.title || "",
      loading: !!tab2?.loading,
      canGoBack: !!tab2?.history?.back,
      canGoForward: !!tab2?.history?.forward,
      agent: this.agent,
      network: { count: this.network.length, seq: this.netSeq },
      executable: this.executable
    };
  }
  set(status, extra = {}) {
    this.status = status;
    this.error = extra.error;
    this.progress = extra.progress;
    this.changed();
  }
  // ------------------------------------------------------------------ lifecycle
  start() {
    if (this.status === "running" && this.cdp && !this.cdp.closed) return Promise.resolve();
    if (!this.starting) this.starting = this.doStart().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }
  async doStart() {
    this.stopping = false;
    this.set("starting", { progress: "Connecting…" });
    try {
      if (!this.surface) this.surface = (await this.ctx.host.ui.surfaceOpen({ label: `browser ${this.spec.name}` })).handle;
      const deadline = Date.now() + 45e3;
      let lastError;
      for (let attempt = 0; Date.now() < deadline; attempt++) {
        try {
          this.wsUrl = await this.resolveUrl(attempt > 0);
          this.cdp = await Cdp.connect(this.ctx, this.wsUrl);
          break;
        } catch (e) {
          lastError = e;
          if (this.spec.location.kind === "endpoint" || this.stopping) throw e;
          await sleep2(500);
        }
      }
      if (!this.cdp) throw lastError || new Error("Could not connect to the browser");
      const cdp = this.cdp;
      cdp.onClose = (reason) => this.lost(cdp, reason);
      this.wire(cdp);
      await cdp.send("Target.setDiscoverTargets", { discover: true });
      const { targetInfos } = await cdp.send("Target.getTargets");
      const pages = (targetInfos || []).filter((t) => t.type === "page");
      for (const t of pages) this.tabs.set(t.targetId, { id: t.targetId, url: t.url, title: t.title, loading: false, openerId: t.openerId });
      if (!pages.length) {
        const { targetId } = await cdp.send("Target.createTarget", { url: this.spec.startUrl || "about:blank" });
        this.tabs.set(targetId, { id: targetId, url: "about:blank", title: "", loading: false });
      }
      await Promise.all([...this.tabs.keys()].map((id) => this.attach(id).catch((e) => this.ctx.log.warn("attach tab", errMsg(e)))));
      const first = this.activeTab && this.tabs.has(this.activeTab) ? this.activeTab : [...this.tabs.keys()][0];
      this.retries = 0;
      this.set("running");
      if (this.titleTimer === null) this.titleTimer = setInterval(() => {
        if (this.activeTab) this.syncTitle(this.activeTab).catch(() => {
        });
      }, 2e3);
      if (first) await this.activate(first);
      this.watchProcess();
    } catch (e) {
      this.set("error", { error: errMsg(e) });
      throw e;
    }
  }
  async resolveUrl(retry) {
    if (this.spec.location.kind === "endpoint") {
      this.progress = "Contacting endpoint…";
      this.changed();
      return endpointUrl(this.ctx, this.spec.location.url);
    }
    if (!this.machine) this.machine = await machineFor(this.ctx, this.spec);
    const m = this.machine;
    if (!this.launched) {
      this.progress = "Locating browser…";
      this.changed();
      let bin = await findBrowser(this.ctx, m, this.spec.executable);
      if (!bin) {
        this.progress = "Downloading a headless browser…";
        this.changed();
        bin = await installHeadlessShell(this.ctx, m);
      }
      this.executable = bin;
      this.progress = "Starting browser…";
      this.changed();
      this.launched = await launch(this.ctx, m, this.spec, bin, this.viewport);
    }
    if (retry && this.forwardHandle) {
      await this.ctx.host.ssh.cancelForward(this.forwardHandle).catch(() => {
      });
      this.forwardHandle = null;
    }
    const { port, path } = await devtoolsPort(this.ctx, m, this.launched.profile);
    if (!this.forwardHandle || retry) {
      const f = await forward(this.ctx, m, port);
      this.forwardHandle = f.handle;
      return `ws://127.0.0.1:${f.port}${path}`;
    }
    return this.wsUrl;
  }
  watchProcess() {
    const l = this.launched;
    if (!l) return;
    this.ctx.host.process.wait(l.handle).then((exit) => {
      if (this.launched !== l || this.stopping) return;
      if (exit === null) return;
      this.launched = null;
      this.teardown();
      this.set("error", { error: `The browser exited${exit.code !== null ? ` (code ${exit.code})` : exit.signal !== null ? ` (signal ${exit.signal})` : ""}` });
    }).catch(() => {
    });
  }
  lost(cdp, reason) {
    if (this.cdp !== cdp) return;
    this.cdp = null;
    this.tabs.clear();
    this.bySession.clear();
    this.screencastSession = null;
    if (this.stopping) return;
    this.set("error", { error: `Connection lost: ${reason}` });
    if (this.retries++ < 3) setTimeout(() => {
      if (!this.stopping && this.status === "error") this.start().catch(() => {
      });
    }, 1500 * this.retries);
  }
  teardown() {
    if (this.titleTimer !== null) {
      clearInterval(this.titleTimer);
      this.titleTimer = null;
    }
    const cdp = this.cdp;
    this.cdp = null;
    if (cdp) cdp.close().catch(() => {
    });
    if (this.forwardHandle) {
      this.ctx.host.ssh.cancelForward(this.forwardHandle).catch(() => {
      });
      this.forwardHandle = null;
    }
    this.tabs.clear();
    this.bySession.clear();
    this.screencastSession = null;
  }
  /** Disconnect; `kill` also ends the browser process (its profile stays when kept). */
  async stop(kill = true) {
    this.stopping = true;
    this.teardown();
    if (kill && this.launched) {
      const l = this.launched;
      this.launched = null;
      try {
        if (l.daemon) await this.ctx.host.daemon.request(l.daemon, "proc.kill", { key: l.key });
        else await this.ctx.host.process.terminate(l.handle);
      } catch (e) {
        this.ctx.log.warn("stop browser", errMsg(e));
      }
    }
    if (this.surface) await this.ctx.host.ui.surfaceClear(this.surface).catch(() => {
    });
    this.set("stopped");
  }
  /** Release native resources on module unload without ending the browser. */
  async detach() {
    this.stopping = true;
    if (this.titleTimer !== null) {
      clearInterval(this.titleTimer);
      this.titleTimer = null;
    }
    const cdp = this.cdp;
    this.cdp = null;
    if (cdp) await cdp.close().catch(() => {
    });
  }
  async removeProfile() {
    if (this.spec.location.kind === "endpoint") return;
    const m = this.machine || await machineFor(this.ctx, this.spec);
    const dir = `${m.stateDir}/profiles/${this.spec.id.replace(/[^A-Za-z0-9_-]/g, "_")}`;
    await this.ctx.host.process.run(m.grant.grant, { target: m.target, executable: "rm", args: ["-rf", dir], cwd: m.grant.root }, { timeoutMs: 3e4 });
  }
  // ------------------------------------------------------------------ CDP wiring
  tabOf(sessionId) {
    return sessionId ? this.bySession.get(sessionId) : void 0;
  }
  wire(cdp) {
    cdp.on("Target.targetCreated", ({ targetInfo: t }) => {
      if (t.type !== "page" || this.tabs.has(t.targetId)) return;
      this.tabs.set(t.targetId, { id: t.targetId, url: t.url, title: t.title, loading: true, openerId: t.openerId });
      this.attach(t.targetId).then(() => {
        if (t.openerId && t.openerId === this.activeTab) return this.activate(t.targetId);
      }).catch((e) => this.ctx.log.warn("attach", errMsg(e)));
      this.changed();
    });
    cdp.on("Target.targetInfoChanged", ({ targetInfo: t }) => {
      const tab2 = this.tabs.get(t.targetId);
      if (!tab2) return;
      const navigated = tab2.url !== t.url;
      tab2.url = t.url;
      if (navigated || t.title && t.title !== t.url) tab2.title = t.title;
      this.changed();
      if (navigated) this.syncTitle(t.targetId).catch(() => {
      });
    });
    cdp.on("Target.targetDestroyed", ({ targetId }) => {
      const tab2 = this.tabs.get(targetId);
      if (!tab2) return;
      this.tabs.delete(targetId);
      if (tab2.session) this.bySession.delete(tab2.session);
      if (this.activeTab === targetId) {
        this.activeTab = null;
        const next = tab2.openerId && this.tabs.has(tab2.openerId) ? tab2.openerId : [...this.tabs.keys()].pop();
        if (next) this.activate(next).catch(() => {
        });
        else if (this.cdp) this.newTab("about:blank").catch(() => {
        });
      }
      this.changed();
    });
    cdp.on("Page.frameStartedLoading", ({ frameId }, s) => {
      const id = this.tabOf(s);
      const tab2 = id && this.tabs.get(id);
      if (tab2 && frameId === id) {
        tab2.loading = true;
        this.changed();
      }
    });
    cdp.on("Page.frameStoppedLoading", ({ frameId }, s) => {
      const id = this.tabOf(s);
      const tab2 = id && this.tabs.get(id);
      if (tab2 && frameId === id) {
        tab2.loading = false;
        this.changed();
        this.refreshHistory(id).catch(() => {
        });
        this.syncTitle(id).catch(() => {
        });
      }
    });
    cdp.on("Page.loadEventFired", (_p, s) => {
      for (const w of [...this.loadWaiters]) if (w.session === s) {
        this.loadWaiters.delete(w);
        w.resolve();
      }
    });
    cdp.on("Page.navigatedWithinDocument", (_p, s) => {
      const id = this.tabOf(s);
      if (id) this.refreshHistory(id).catch(() => {
      });
    });
    cdp.on("Page.frameNavigated", ({ frame }, s) => {
      const id = this.tabOf(s);
      if (id && !frame.parentId) this.refreshHistory(id).catch(() => {
      });
    });
    cdp.on("Page.screencastFrame", (p, s) => this.frame(p, s));
    cdp.on("Page.javascriptDialogOpening", (p, s) => {
      cdp.send("Page.handleJavaScriptDialog", { accept: true, promptText: p.defaultPrompt || "" }, s).catch(() => {
      });
      this.agent = { at: Date.now(), text: `Dialog: ${String(p.message || "").slice(0, 120)}` };
      this.changed();
    });
    cdp.on("Network.requestWillBeSent", (p, s) => {
      const tab2 = this.tabOf(s) || "";
      const prev = this.netIndex.get(p.requestId);
      if (prev && p.redirectResponse) {
        prev.status = p.redirectResponse.status;
        prev.statusText = p.redirectResponse.statusText;
        prev.durationMs = Math.round((p.timestamp - prev._ts) * 1e3);
        this.netIndex.delete(p.requestId);
      }
      const e = {
        seq: ++this.netSeq,
        requestId: p.requestId,
        tab: tab2,
        url: p.request.url,
        method: p.request.method,
        type: p.type,
        startedAt: Math.round((p.wallTime || Date.now() / 1e3) * 1e3),
        requestHeaders: p.request.headers,
        postData: typeof p.request.postData === "string" ? p.request.postData.slice(0, 2e4) : void 0
      };
      Object.defineProperty(e, "_ts", { value: p.timestamp, enumerable: false, writable: true });
      this.netIndex.set(p.requestId, e);
      this.network.push(e);
      if (this.network.length > NETWORK_LIMIT) {
        const old = this.network.shift();
        if (this.netIndex.get(old.requestId) === old) this.netIndex.delete(old.requestId);
      }
      this.changed();
    });
    cdp.on("Network.responseReceived", (p) => {
      const e = this.netIndex.get(p.requestId);
      if (!e) return;
      e.status = p.response.status;
      e.statusText = p.response.statusText;
      e.mimeType = p.response.mimeType;
      e.responseHeaders = p.response.headers;
      e.fromCache = !!(p.response.fromDiskCache || p.response.fromServiceWorker || p.response.fromPrefetchCache);
      e.type = p.type || e.type;
      this.netSeq++;
      this.changed();
    });
    cdp.on("Network.loadingFinished", (p) => {
      const e = this.netIndex.get(p.requestId);
      if (!e) return;
      e.encodedBytes = p.encodedDataLength;
      e.durationMs = Math.round((p.timestamp - e._ts) * 1e3);
      this.netSeq++;
      this.changed();
    });
    cdp.on("Network.loadingFailed", (p) => {
      const e = this.netIndex.get(p.requestId);
      if (!e) return;
      e.failed = true;
      e.error = p.canceled ? "canceled" : p.errorText || p.blockedReason || "failed";
      e.durationMs = Math.round((p.timestamp - e._ts) * 1e3);
      this.netSeq++;
      this.changed();
    });
  }
  async attach(targetId) {
    const cdp = this.cdp;
    const tab2 = this.tabs.get(targetId);
    if (!tab2 || tab2.session) return;
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    tab2.session = sessionId;
    this.bySession.set(sessionId, targetId);
    const vp = this.viewport;
    await Promise.all([
      cdp.send("Page.enable", {}, sessionId),
      cdp.send("Network.enable", { maxPostDataSize: 2e4 }, sessionId),
      this.spec.headed ? Promise.resolve() : cdp.send("Emulation.setDeviceMetricsOverride", { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: false }, sessionId),
      cdp.send("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => {
      })
    ]);
    await this.refreshHistory(targetId).catch(() => {
    });
  }
  /** Target info does not report every title change (data: URLs, script-set titles). */
  async syncTitle(targetId) {
    const tab2 = this.tabs.get(targetId);
    if (!tab2?.session || !this.cdp) return;
    const r = await this.cdp.send("Runtime.evaluate", { expression: "document.title", returnByValue: true }, tab2.session, 5e3);
    const title = typeof r.result?.value === "string" ? r.result.value : "";
    if (title && title !== tab2.title) {
      tab2.title = title;
      this.changed();
    }
  }
  async refreshHistory(targetId) {
    const tab2 = this.tabs.get(targetId);
    if (!tab2?.session || !this.cdp) return;
    const h = await this.cdp.send("Page.getNavigationHistory", {}, tab2.session);
    tab2.history = { back: h.currentIndex > 0, forward: h.currentIndex < h.entries.length - 1 };
    this.changed();
  }
  async frame(p, sessionId) {
    const cdp = this.cdp;
    if (!cdp) return;
    try {
      if (sessionId === this.screencastSession && this.surface) {
        await this.ctx.host.ui.surfaceFrame(this.surface, { data: p.data, width: p.metadata?.deviceWidth, height: p.metadata?.deviceHeight });
      }
    } catch (e) {
      this.ctx.log.warn("surface frame", errMsg(e));
    }
    cdp.send("Page.screencastFrameAck", { sessionId: p.sessionId }, sessionId).catch(() => {
    });
  }
  // ------------------------------------------------------------------ tabs
  tab(id) {
    const tab2 = this.tabs.get(id || this.activeTab || "");
    if (!tab2?.session) throw new Error(id ? `No tab ${id}` : "The session has no open tab");
    return tab2;
  }
  async activate(targetId) {
    const cdp = this.cdp;
    if (!cdp) throw new Error("The browser is not running");
    const tab2 = this.tabs.get(targetId);
    if (!tab2) throw new Error(`No tab ${targetId}`);
    if (!tab2.session) await this.attach(targetId);
    if (this.screencastSession && this.screencastSession !== tab2.session) await cdp.send("Page.stopScreencast", {}, this.screencastSession).catch(() => {
    });
    this.activeTab = targetId;
    this.screencastSession = tab2.session;
    const vp = this.viewport;
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 72, maxWidth: vp.width, maxHeight: vp.height, everyNthFrame: 1 }, tab2.session);
    if (this.spec.headed) await cdp.send("Target.activateTarget", { targetId }).catch(() => {
    });
    this.changed();
  }
  async newTab(url = "about:blank") {
    const cdp = this.need();
    const { targetId } = await cdp.send("Target.createTarget", { url: this.normalizeUrl(url) });
    if (!this.tabs.has(targetId)) this.tabs.set(targetId, { id: targetId, url, title: "", loading: true });
    await this.attach(targetId);
    await this.activate(targetId);
    return targetId;
  }
  async closeTab(targetId) {
    await this.need().send("Target.closeTarget", { targetId });
  }
  async setViewport(width, height) {
    const w = Math.round(Math.min(Math.max(width, 320), 3840)), h = Math.round(Math.min(Math.max(height, 240), 2400));
    this.spec.viewport = { width: w, height: h };
    const cdp = this.cdp;
    if (cdp && !this.spec.headed) {
      for (const t of this.tabs.values()) if (t.session) await cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false }, t.session).catch(() => {
      });
      if (this.activeTab) await this.activate(this.activeTab);
    }
    this.changed();
  }
  need() {
    if (!this.cdp || this.status !== "running") throw new Error(`Browser session "${this.spec.name}" is not running`);
    return this.cdp;
  }
  normalizeUrl(url) {
    const u = url.trim();
    if (!u) return "about:blank";
    if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return u;
    if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(u)) return `http://${u}`;
    if (/^[^\s/]+\.[^\s/]{2,}(\/|$)/.test(u)) return `https://${u}`;
    return `https://www.google.com/search?q=${encodeURIComponent(u)}`;
  }
  // ------------------------------------------------------------------ navigation
  waitLoad(session2, ms) {
    return new Promise((resolve) => {
      const w = { session: session2, resolve };
      this.loadWaiters.add(w);
      setTimeout(() => {
        if (this.loadWaiters.delete(w)) resolve();
      }, ms);
    });
  }
  async navigate(url, tabId, waitMs = 15e3) {
    const cdp = this.need(), tab2 = this.tab(tabId);
    const loaded = this.waitLoad(tab2.session, waitMs);
    const r = await cdp.send("Page.navigate", { url: this.normalizeUrl(url) }, tab2.session);
    if (r.errorText) throw new Error(`Navigation failed: ${r.errorText}`);
    await loaded;
    return this.where(tab2.id);
  }
  async history(action, tabId) {
    const cdp = this.need(), tab2 = this.tab(tabId);
    if (action === "reload") {
      const loaded2 = this.waitLoad(tab2.session, 15e3);
      await cdp.send("Page.reload", {}, tab2.session);
      await loaded2;
      return this.where(tab2.id);
    }
    if (action === "stop") {
      await cdp.send("Page.stopLoading", {}, tab2.session);
      return this.where(tab2.id);
    }
    const h = await cdp.send("Page.getNavigationHistory", {}, tab2.session);
    const index = h.currentIndex + (action === "back" ? -1 : 1);
    if (index < 0 || index >= h.entries.length) throw new Error(`Nothing to go ${action} to`);
    const loaded = this.waitLoad(tab2.session, 1e4);
    await cdp.send("Page.navigateToHistoryEntry", { entryId: h.entries[index].id }, tab2.session);
    await loaded;
    return this.where(tab2.id);
  }
  where(tabId) {
    const tab2 = this.tabs.get(tabId || this.activeTab || "");
    return { session: this.spec.id, tab: tab2?.id, url: tab2?.url, title: tab2?.title, loading: tab2?.loading };
  }
  // ------------------------------------------------------------------ user input (from the panel)
  async userPointer(e) {
    const cdp = this.cdp, s = this.screencastSession;
    if (!cdp || !s) return;
    const type = e.kind === "down" ? "mousePressed" : e.kind === "up" ? "mouseReleased" : "mouseMoved";
    await cdp.send("Input.dispatchMouseEvent", {
      type,
      x: e.x,
      y: e.y,
      button: e.kind === "move" ? e.buttons & 1 ? "left" : e.buttons & 2 ? "right" : "none" : e.button || "left",
      buttons: e.buttons,
      clickCount: e.kind === "move" ? 0 : Math.max(1, e.clickCount),
      modifiers: modBits(e.modifiers)
    }, s);
  }
  async userWheel(e) {
    const cdp = this.cdp, s = this.screencastSession;
    if (!cdp || !s) return;
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: e.x, y: e.y, deltaX: e.deltaX, deltaY: e.deltaY }, s);
  }
  async userKey(e) {
    const cdp = this.cdp, s = this.screencastSession;
    if (!cdp || !s) return;
    if (e.kind === "paste") {
      await cdp.send("Input.insertText", { text: e.text }, s);
      return;
    }
    const def = keyDef(e.key);
    if (!def) return;
    const m = e.modifiers;
    const printable = !!e.text && !m.ctrl && !m.meta && [...e.text].length === 1 && e.text >= " ";
    const text = printable ? e.text : def.text && !m.ctrl && !m.meta ? def.text : void 0;
    if (e.kind === "up") {
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: printable ? e.text : def.key, code: def.code, windowsVirtualKeyCode: def.keyCode, modifiers: modBits(m) }, s);
      return;
    }
    await cdp.send("Input.dispatchKeyEvent", {
      type: text ? "keyDown" : "rawKeyDown",
      key: printable ? e.text : def.key,
      code: def.code,
      windowsVirtualKeyCode: def.keyCode,
      text,
      unmodifiedText: text,
      modifiers: modBits(m),
      commands: editCommands(def, m)
    }, s);
  }
  // ------------------------------------------------------------------ agent actions
  noteAgent(text, caller) {
    this.agent = { at: Date.now(), text, caller };
    this.changed();
  }
  async glide(x, y, click) {
    if (!this.surface) return;
    const from = this.cursor.shown ? this.cursor : { x: this.viewport.width / 2, y: this.viewport.height / 2 };
    const dist = Math.hypot(x - from.x, y - from.y);
    const durationMs = this.cursor.shown ? Math.round(Math.min(Math.max(220 + dist * 0.45, 250), 900)) : 0;
    if (!this.cursor.shown) await this.ctx.host.ui.surfaceCursor(this.surface, { x: from.x, y: from.y, durationMs: 0 });
    await this.ctx.host.ui.surfaceCursor(this.surface, { x, y, durationMs: Math.max(durationMs, 300), click });
    this.cursor = { x, y, shown: true };
    await sleep2(Math.max(durationMs, 300));
  }
  async evaluate(fn, args, tabId, awaitPromise = false) {
    const cdp = this.need(), tab2 = this.tab(tabId);
    const expression = `(${fn})(${args.map((a) => JSON.stringify(a ?? null)).join(",")})`;
    const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise, userGesture: true }, tab2.session, 3e4);
    if (r.exceptionDetails) throw new Error(`Page script failed: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result?.value;
  }
  async text(scope, selector, maxChars = 2e4, tabId) {
    const r = await this.evaluate(TEXT_FN, [scope, selector || null, Math.min(Math.max(maxChars, 200), 2e5)], tabId);
    if (r?.error) throw new Error(r.error);
    return { ...this.where(tabId), ...r };
  }
  async elements(all = false, max = 200, tabId) {
    const r = await this.evaluate(ELEMENTS_FN, [all, Math.min(Math.max(max, 1), 1e3)], tabId);
    return { ...this.where(tabId), ...r };
  }
  async screenshot(opts) {
    const cdp = this.need(), tab2 = this.tab(opts.tab);
    const low = opts.quality !== "full";
    const metrics = await cdp.send("Page.getLayoutMetrics", {}, tab2.session);
    const vv = metrics.cssVisualViewport || metrics.visualViewport || { clientWidth: this.viewport.width, clientHeight: this.viewport.height, pageX: 0, pageY: 0 };
    const content = metrics.cssContentSize || metrics.contentSize;
    const width = opts.fullPage ? content.width : vv.clientWidth, height = opts.fullPage ? Math.min(content.height, 16e3) : vv.clientHeight;
    const scale = low ? Math.min(1, 960 / Math.max(width, 1)) : 1;
    const clip = { x: opts.fullPage ? 0 : vv.pageX, y: opts.fullPage ? 0 : vv.pageY, width, height, scale };
    const r = await cdp.send("Page.captureScreenshot", { format: low ? "jpeg" : "png", ...low ? { quality: 55 } : {}, clip, captureBeyondViewport: !!opts.fullPage }, tab2.session, 6e4);
    return { data: r.data, mimeType: low ? "image/jpeg" : "image/png", width: Math.round(width * scale), height: Math.round(height * scale), cssWidth: width, cssHeight: height, scale, ...this.where(tab2.id) };
  }
  async locate(target2, tabId) {
    if (typeof target2.x === "number" && typeof target2.y === "number") return { x: target2.x, y: target2.y, editable: void 0 };
    if (!target2.ref && !target2.selector) throw new Error("Give x/y coordinates, an element ref (from browser_elements) or a CSS selector");
    const r = await this.evaluate(LOCATE_FN, [target2.ref || null, target2.selector || null], tabId);
    if (r?.error) throw new Error(r.error);
    await sleep2(120);
    return r;
  }
  async settle(tabId) {
    await sleep2(250);
    const tab2 = this.tabs.get(tabId || this.activeTab || "");
    for (let i = 0; i < 40 && tab2?.loading; i++) await sleep2(125);
  }
  async click(t) {
    const cdp = this.need(), tab2 = this.tab(t.tab);
    if (t.tab && t.tab !== this.activeTab) await this.activate(t.tab);
    const p = await this.locate(t, tab2.id);
    await this.glide(p.x, p.y, true);
    const button = t.button || "left", clickCount = Math.min(Math.max(t.clickCount || 1, 1), 3), modifiers2 = modBits(t.modifiers);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y, modifiers: modifiers2 }, tab2.session);
    for (let i = 1; i <= clickCount; i++) {
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button, buttons: button === "left" ? 1 : button === "right" ? 2 : 4, clickCount: i, modifiers: modifiers2 }, tab2.session);
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button, buttons: 0, clickCount: i, modifiers: modifiers2 }, tab2.session);
    }
    await this.settle(tab2.id);
    return { clicked: { x: Math.round(p.x), y: Math.round(p.y) }, ...this.where() };
  }
  async hover(t) {
    const cdp = this.need(), tab2 = this.tab(t.tab);
    const p = await this.locate(t, tab2.id);
    await this.glide(p.x, p.y, false);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y }, tab2.session);
    return { hovered: { x: Math.round(p.x), y: Math.round(p.y) }, ...this.where(tab2.id) };
  }
  async type(t) {
    const cdp = this.need(), tab2 = this.tab(t.tab);
    if (t.ref || t.selector || typeof t.x === "number") await this.click({ x: t.x, y: t.y, ref: t.ref, selector: t.selector, tab: tab2.id });
    if (t.clear) await this.evaluate(CLEAR_FN, [t.ref || null, t.selector || null], tab2.id);
    const text = String(t.text ?? "");
    const delay = Math.min(Math.max(t.delayMs ?? 12, 0), 200);
    if (text.length > 200 || delay === 0) await cdp.send("Input.insertText", { text }, tab2.session);
    else for (const ch of text) {
      if (ch === "\n") {
        await this.press("Enter", {}, tab2.id);
        continue;
      }
      const def = keyDef(ch) || { key: ch, code: "", keyCode: 0 };
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: def.key, code: def.code, windowsVirtualKeyCode: def.keyCode, text: ch, unmodifiedText: ch }, tab2.session);
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: def.key, code: def.code, windowsVirtualKeyCode: def.keyCode }, tab2.session);
      if (delay) await sleep2(delay);
    }
    if (t.submit) await this.press("Enter", {}, tab2.id);
    await this.settle(tab2.id);
    return { typed: text.length, ...this.where(tab2.id) };
  }
  async press(key, modifiers2 = {}, tabId) {
    const cdp = this.need(), tab2 = this.tab(tabId);
    const def = keyDef(key);
    if (!def) throw new Error(`Unknown key ${key}; use names like Enter, Tab, Escape, ArrowDown, PageDown or a single character`);
    const plain = !modifiers2.ctrl && !modifiers2.meta && !modifiers2.alt;
    const text = plain ? def.text : void 0;
    await cdp.send("Input.dispatchKeyEvent", {
      type: text ? "keyDown" : "rawKeyDown",
      key: def.key,
      code: def.code,
      windowsVirtualKeyCode: def.keyCode,
      text,
      unmodifiedText: text,
      modifiers: modBits(modifiers2),
      commands: editCommands(def, modifiers2)
    }, tab2.session);
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: def.key, code: def.code, windowsVirtualKeyCode: def.keyCode, modifiers: modBits(modifiers2) }, tab2.session);
    return { pressed: key, ...this.where(tab2.id) };
  }
  async scroll(t) {
    const cdp = this.need(), tab2 = this.tab(t.tab);
    let p = { x: this.viewport.width / 2, y: this.viewport.height / 2 };
    if (t.ref || t.selector || typeof t.x === "number") p = await this.locate(t, tab2.id);
    await this.glide(p.x, p.y, false);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: p.x, y: p.y, deltaX: t.deltaX || 0, deltaY: t.deltaY ?? this.viewport.height * 0.8 }, tab2.session);
    await sleep2(300);
    const pos = await this.evaluate("function(){return {x: scrollX, y: scrollY, height: document.documentElement.scrollHeight}}", [], tab2.id);
    return { scroll: pos, ...this.where(tab2.id) };
  }
  async waitFor(t) {
    const deadline = Date.now() + Math.min(Math.max(t.timeoutMs ?? 1e4, 100), 6e4);
    while (Date.now() < deadline) {
      if (await this.evaluate(WAIT_FN, [t.selector || null, t.text || null], t.tab).catch(() => false)) return { found: true, ...this.where(t.tab) };
      await sleep2(250);
    }
    return { found: false, ...this.where(t.tab) };
  }
  networkLog(opts) {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), NETWORK_LIMIT);
    const f = (opts.filter || "").toLowerCase();
    const rows = this.network.filter((e) => (!opts.tab || e.tab === opts.tab) && (!opts.sinceSeq || e.seq > opts.sinceSeq) && (!opts.failedOnly || e.failed || (e.status ?? 0) >= 400) && (!f || e.url.toLowerCase().includes(f) || (e.type || "").toLowerCase() === f || e.method.toLowerCase() === f));
    return rows.slice(-limit).map((e) => opts.headers ? { ...e } : {
      seq: e.seq,
      requestId: e.requestId,
      tab: e.tab,
      method: e.method,
      url: e.url,
      type: e.type,
      status: e.status,
      statusText: e.statusText,
      mimeType: e.mimeType,
      startedAt: e.startedAt,
      durationMs: e.durationMs,
      encodedBytes: e.encodedBytes,
      failed: e.failed,
      error: e.error,
      fromCache: e.fromCache
    });
  }
  networkEntry(requestId) {
    return this.netIndex.get(requestId) || this.network.find((e) => e.requestId === requestId) || null;
  }
  async networkBody(requestId, maxChars = 1e5) {
    const e = this.networkEntry(requestId);
    if (!e) throw new Error(`No request ${requestId} in the log`);
    const tab2 = this.tabs.get(e.tab);
    if (!tab2?.session) throw new Error("The request's tab is closed");
    const r = await this.need().send("Network.getResponseBody", { requestId }, tab2.session);
    const body = r.body || "";
    return { requestId, url: e.url, status: e.status, mimeType: e.mimeType, base64Encoded: !!r.base64Encoded, body: body.slice(0, maxChars), total: body.length, truncated: body.length > maxChars };
  }
  clearNetwork() {
    this.network = [];
    this.netIndex.clear();
    this.netSeq++;
    this.changed();
  }
};

// modules/services/browser/src/tools.ts
var obj = (properties, required = []) => ({ type: "object", properties, required });
var session = { type: "string", description: "Session id or name (see browser_sessions). Optional when exactly one session allows agents." };
var tab = { type: "string", description: "Tab id; defaults to the active tab." };
var target = {
  ref: { type: "integer", description: "Element ref from browser_elements (preferred)." },
  selector: { type: "string", description: "CSS selector." },
  x: { type: "number", description: "Viewport x in CSS px." },
  y: { type: "number", description: "Viewport y in CSS px." }
};
var modifiers = { type: "object", properties: { shift: { type: "boolean" }, ctrl: { type: "boolean" }, alt: { type: "boolean" }, meta: { type: "boolean" } } };
function browserTools(host) {
  const run = (fn, label) => async (s, a, scope) => {
    await s.start();
    checkDeadline(scope);
    if (host.pick(s.spec.id) !== s) throw new Error("Browser session changed");
    s.noteAgent(label(a), scope.conversationId);
    return fn(s, a);
  };
  const queues = /* @__PURE__ */ new WeakMap();
  function checkDeadline(scope) {
    if (scope.browserDeadline && Date.now() >= scope.browserDeadline) throw new Error("Browser command timed out");
  }
  function enqueue(args, scope, task) {
    const s = host.pick(args.session);
    const result = (queues.get(s) ?? Promise.resolve()).catch(() => {
    }).then(() => {
      checkDeadline(scope);
      if (host.pick(s.spec.id) !== s) throw new Error("Browser session changed");
      return task(s);
    });
    queues.set(s, result);
    const release = () => {
      if (queues.get(s) === result) queues.delete(s);
    };
    void result.then(release, release);
    return result;
  }
  const list = {
    name: "browser_sessions",
    title: "List browser sessions",
    description: "List the browser sessions agents may use, with their tabs and current page.",
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
    handler: () => ({ sessions: host.agentSessions().map((s) => {
      const v = s.view();
      return {
        id: v.id,
        name: v.name,
        status: v.status,
        location: v.locationLabel,
        url: v.url,
        title: v.title,
        viewport: v.viewport,
        tabs: v.tabs.map((t) => ({ id: t.id, title: t.title, url: t.url, active: t.active }))
      };
    }) })
  };
  const commands = [
    {
      name: "browser_navigate",
      title: "Open a URL",
      description: "Navigate the active tab (or a new tab) to a URL and wait for it to load. Starts the session if needed.",
      inputSchema: obj({ session, url: { type: "string" }, newTab: { type: "boolean" }, tab }, ["url"]),
      timeoutMs: 9e4,
      handler: run(async (s, a) => a.newTab ? (await s.newTab(a.url), await new Promise((r) => setTimeout(r, 800)), s.where()) : s.navigate(a.url, a.tab), (a) => `Open ${a.url}`)
    },
    {
      name: "browser_history",
      title: "Back, forward, reload",
      description: "Go back, forward, reload or stop loading in a tab.",
      inputSchema: obj({ session, action: { type: "string", enum: ["back", "forward", "reload", "stop"] }, tab }, ["action"]),
      timeoutMs: 6e4,
      handler: run((s, a) => s.history(a.action, a.tab), (a) => a.action)
    },
    {
      name: "browser_tabs",
      title: "Manage tabs",
      description: "List, open (url), close or activate tabs. The active tab is the one shown in the preview and used by default.",
      inputSchema: obj({ session, action: { type: "string", enum: ["list", "new", "close", "activate"] }, tab, url: { type: "string" } }, ["action"]),
      timeoutMs: 6e4,
      handler: run(async (s, a) => {
        if (a.action === "new") await s.newTab(a.url || "about:blank");
        else if (a.action === "close") await s.closeTab(a.tab || s.activeTab);
        else if (a.action === "activate") await s.activate(a.tab);
        return { tabs: s.view().tabs };
      }, (a) => `Tabs: ${a.action}`)
    },
    {
      name: "browser_text",
      title: "Read visible text",
      description: "Visible text of the page (scope page) or only what is on screen (scope viewport), optionally inside a CSS selector.",
      inputSchema: obj({ session, scope: { type: "string", enum: ["page", "viewport"] }, selector: { type: "string" }, maxChars: { type: "integer" }, tab }),
      annotations: { readOnlyHint: true },
      handler: run((s, a) => s.text(a.scope === "viewport" ? "viewport" : "page", a.selector, a.maxChars ?? 2e4, a.tab), () => "Read text")
    },
    {
      name: "browser_elements",
      title: "List interactive elements",
      description: "Interactive elements (links, buttons, inputs…) with stable refs, labels and viewport centers. Use refs with click/type/hover/scroll. Set all to include off-screen elements.",
      inputSchema: obj({ session, all: { type: "boolean" }, max: { type: "integer" }, tab }),
      annotations: { readOnlyHint: true },
      handler: run((s, a) => s.elements(!!a.all, a.max ?? 200, a.tab), () => "List elements")
    },
    {
      name: "browser_screenshot",
      title: "Screenshot",
      description: "Screenshot of the viewport (or full page). quality low (default): compact JPEG ≤960px wide for orientation; full: lossless PNG at CSS resolution. Coordinates in other commands are CSS px: divide picture px by the returned scale.",
      inputSchema: obj({ session, quality: { type: "string", enum: ["low", "full"] }, fullPage: { type: "boolean" }, tab }),
      annotations: { readOnlyHint: true },
      timeoutMs: 9e4,
      handler: run(async (s, a) => {
        const shot = await s.screenshot({ quality: a.quality === "full" ? "full" : "low", fullPage: !!a.fullPage, tab: a.tab });
        const { data, mimeType, ...meta } = shot;
        return { mcpContent: [{ type: "image", data, mimeType }, { type: "text", text: JSON.stringify(meta) }], ...meta };
      }, (a) => `Screenshot${a.quality === "full" ? " (full)" : ""}`)
    },
    {
      name: "browser_click",
      title: "Click",
      description: "Move the visible pointer to an element (ref or selector) or coordinates and click it. Waits briefly for resulting navigation.",
      inputSchema: obj({ session, ...target, button: { type: "string", enum: ["left", "right", "middle"] }, clickCount: { type: "integer" }, modifiers, tab }),
      timeoutMs: 6e4,
      handler: run((s, a) => s.click(a), (a) => `Click ${a.ref ? `#${a.ref}` : a.selector || `${a.x},${a.y}`}`)
    },
    {
      name: "browser_hover",
      title: "Hover",
      description: "Move the visible pointer over an element or coordinates (opens hover menus).",
      inputSchema: obj({ session, ...target, tab }),
      timeoutMs: 3e4,
      handler: run((s, a) => s.hover(a), () => "Hover")
    },
    {
      name: "browser_type",
      title: "Type text",
      description: "Type text, first clicking the target field if given. clear replaces existing content; submit presses Enter afterwards.",
      inputSchema: obj({ session, text: { type: "string" }, ...target, clear: { type: "boolean" }, submit: { type: "boolean" }, tab }, ["text"]),
      timeoutMs: 12e4,
      handler: run((s, a) => s.type(a), (a) => `Type ${JSON.stringify(String(a.text).slice(0, 40))}`)
    },
    {
      name: "browser_key",
      title: "Press a key",
      description: "Press a key such as Enter, Tab, Escape, Backspace, ArrowDown, PageDown or a character, with optional modifiers (meta/ctrl + a selects all).",
      inputSchema: obj({ session, key: { type: "string" }, modifiers, tab }, ["key"]),
      handler: run((s, a) => s.press(a.key, a.modifiers || {}, a.tab), (a) => `Key ${a.key}`)
    },
    {
      name: "browser_scroll",
      title: "Scroll",
      description: "Scroll with the mouse wheel at an element/coordinates (default viewport center). deltaY defaults to most of a screen; negative scrolls up.",
      inputSchema: obj({ session, deltaX: { type: "number" }, deltaY: { type: "number" }, ...target, tab }),
      handler: run((s, a) => s.scroll(a), (a) => `Scroll ${a.deltaY ?? "down"}`)
    },
    {
      name: "browser_wait",
      title: "Wait for content",
      description: "Wait for a CSS selector, visible text, or both. Without either, waits for the current document to finish loading. A timeout returns found: false as a tool error. To wait after a specific action, put both in one browser_batch.",
      inputSchema: obj({ session, selector: { type: "string" }, text: { type: "string" }, timeoutMs: { type: "integer" }, tab }),
      annotations: { readOnlyHint: true },
      timeoutMs: 7e4,
      handler: run(async (s, a) => {
        const result = await s.waitFor(a);
        return result.found ? result : { ...result, ok: false, error: "Browser wait timed out" };
      }, () => "Wait")
    },
    {
      name: "browser_network",
      title: "Network log",
      description: "Recent requests (newest last): method, URL, status, type, timing and size. Filter by URL substring, resource type (xhr, fetch, document…) or method; failedOnly shows errors and HTTP ≥400; sinceSeq returns only newer entries; headers includes request/response headers.",
      inputSchema: obj({ session, filter: { type: "string" }, limit: { type: "integer" }, failedOnly: { type: "boolean" }, sinceSeq: { type: "integer" }, headers: { type: "boolean" }, tab }),
      annotations: { readOnlyHint: true },
      handler: run((s, a) => ({ requests: s.networkLog(a) }), () => "Network log")
    },
    {
      name: "browser_network_body",
      title: "Response body",
      description: "Response body of a request from browser_network (text, or base64 for binary).",
      inputSchema: obj({ session, requestId: { type: "string" }, maxChars: { type: "integer" } }, ["requestId"]),
      annotations: { readOnlyHint: true },
      handler: run((s, a) => s.networkBody(a.requestId, a.maxChars ?? 1e5), () => "Response body")
    }
  ];
  const byName = new Map(commands.map((command) => [command.name, command]));
  const batch = {
    name: "browser_batch",
    title: "Run browser commands in order",
    description: "Run up to 10 existing browser commands on one session, in order, without interleaving agent commands. Each step has a command name (e.g. browser_click) and its usual arguments, with session set only at the batch level. Stops on the first failure and returns completed results and any screenshots.",
    timeoutMs: 18e4,
    inputSchema: obj({ session, steps: {
      type: "array",
      minItems: 1,
      maxItems: 10,
      items: obj({ command: { type: "string", enum: [...byName.keys()] }, arguments: { type: "object" } }, ["command"])
    } }, ["steps"]),
    handler(args, scope) {
      if (!Array.isArray(args.steps) || args.steps.length < 1 || args.steps.length > 10) {
        throw new Error("Provide between 1 and 10 browser steps");
      }
      const steps = args.steps.map((step, index) => {
        const command = byName.get(step?.command);
        const input = step?.arguments ?? {};
        if (!command || !scope.allowedBrowserCommands?.includes(command.name)) {
          throw new Error(`Step ${index + 1}: browser command is denied or unavailable`);
        }
        if (typeof input !== "object" || Array.isArray(input) || "session" in input) {
          throw new Error(`Step ${index + 1}: arguments must be an object without session`);
        }
        for (const key of command.inputSchema.required ?? []) {
          if (input[key] === void 0) throw new Error(`Step ${index + 1}: missing ${key}`);
        }
        return { command, input };
      });
      return enqueue(args, scope, async (s) => {
        const results = [];
        const images = [];
        let failure;
        for (const { command, input } of steps) {
          try {
            checkDeadline(scope);
            if (host.pick(s.spec.id) !== s) throw new Error("Browser session changed");
            const { mcpContent = [], ...result } = await command.handler(s, input, scope);
            if (command.name === "browser_wait" && result.found === false) throw new Error(result.error);
            results.push({ command: command.name, result });
            const screenshots = mcpContent.filter((item) => item.type === "image");
            if (screenshots.length) images.push({ type: "text", text: `Screenshot from step ${results.length}` }, ...screenshots);
          } catch (error) {
            failure = { step: results.length + 1, command: command.name, error: error instanceof Error ? error.message : String(error) };
            break;
          }
        }
        const summary = { ok: !failure, results, ...failure ? { failure } : {} };
        return images.length ? { ...summary, mcpContent: [{ type: "text", text: JSON.stringify(summary) }, ...images] } : summary;
      });
    }
  };
  return [list, ...commands.map(({ handler, ...tool }) => ({
    ...tool,
    handler: (args, scope) => enqueue(args, scope, (s) => handler(s, args, scope))
  })), batch];
}

// modules/services/browser/src/index.ts
var SPECS_KEY = "browser.sessions";
var RUNNING_KEY = "browser.running";
var ctxRef;
var sessions = /* @__PURE__ */ new Map();
var rev = 0;
var publishTimer = null;
var running = /* @__PURE__ */ new Set();
function publish() {
  if (publishTimer !== null) return;
  publishTimer = setTimeout(() => {
    publishTimer = null;
    const state = { sessions: [...sessions.values()].map((s) => s.view()), rev: ++rev };
    ctxRef.state.set("browser.state", state);
    const live = [...sessions.values()].filter((s) => s.status === "running" || s.status === "starting").map((s) => s.spec.id).sort();
    if (live.join() !== [...running].sort().join()) {
      running = new Set(live);
      void saveRunning();
    }
  }, 60);
}
async function saveSpecs() {
  await ctxRef.modules.call("persistence", "settings.set", { key: SPECS_KEY, value: [...sessions.values()].map((s) => s.spec) });
}
async function saveRunning() {
  try {
    await ctxRef.modules.call("persistence", "settings.set", { key: RUNNING_KEY, value: [...running] });
  } catch (e) {
    ctxRef.log.warn("save running sessions", errMsg(e));
  }
}
function get(id) {
  const s = sessions.get(String(id));
  if (!s) throw new Error(`Unknown browser session ${id}`);
  return s;
}
function cleanLocation(l) {
  if (l?.kind === "workspace" && typeof l.workspaceId === "string" && l.workspaceId) return { kind: "workspace", workspaceId: l.workspaceId, label: typeof l.label === "string" ? l.label.slice(0, 120) : void 0 };
  if (l?.kind === "endpoint" && typeof l.url === "string" && /^(wss?|https?):\/\//i.test(l.url.trim())) return { kind: "endpoint", url: l.url.trim().slice(0, 2e3) };
  return { kind: "local" };
}
function cleanSpec(raw, prev) {
  const base = { ...prev || {}, ...raw || {} };
  const vp = base.viewport || DEFAULT_VIEWPORT;
  return {
    id: prev?.id || (typeof base.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(base.id) ? base.id : crypto.randomHex(6)),
    name: String(base.name || "Browser").trim().slice(0, 80) || "Browser",
    location: cleanLocation(base.location),
    headed: !!base.headed,
    keepProfile: base.keepProfile !== false,
    agentAccess: !!base.agentAccess,
    viewport: { width: Math.round(Math.min(Math.max(Number(vp.width) || DEFAULT_VIEWPORT.width, 320), 3840)), height: Math.round(Math.min(Math.max(Number(vp.height) || DEFAULT_VIEWPORT.height, 240), 2400)) },
    startUrl: typeof base.startUrl === "string" ? base.startUrl.slice(0, 2e3) : void 0,
    executable: typeof base.executable === "string" && base.executable.trim() ? base.executable.trim().slice(0, 1e3) : void 0
  };
}
function add(spec, carry) {
  const s = new BrowserSession(ctxRef, spec, publish, carry);
  sessions.set(spec.id, s);
  return s;
}
function pick(nameOrId) {
  const allowed = [...sessions.values()].filter((s2) => s2.spec.agentAccess);
  if (!nameOrId) {
    if (allowed.length === 1) return allowed[0];
    throw new Error(allowed.length ? `Several browser sessions allow agents (${allowed.map((s2) => `${s2.spec.name} [${s2.spec.id}]`).join(", ")}); pass session` : "No browser session allows agents. The user can enable “Agent access” for a session in the Browser panel.");
  }
  const key = String(nameOrId).toLowerCase();
  const s = [...sessions.values()].find((s2) => s2.spec.id === nameOrId) || [...sessions.values()].find((s2) => s2.spec.name.toLowerCase() === key);
  if (!s) throw new Error(`No browser session ${nameOrId}`);
  if (!s.spec.agentAccess) throw new Error(`Browser session “${s.spec.name}” does not allow agents. The user can enable “Agent access” for it in the Browser panel.`);
  return s;
}
function startQuietly(s) {
  s.start().catch((e) => ctxRef.log.warn(`browser ${s.spec.name}`, errMsg(e)));
}
var mod = {
  id: "browser",
  moduleApiVersion: 1,
  async activate(ctx, previous) {
    ctxRef = ctx;
    const specs = await ctx.modules.call("persistence", "settings.get", { key: SPECS_KEY }) || [];
    const wasRunning = previous?.running || await ctx.modules.call("persistence", "settings.get", { key: RUNNING_KEY }) || [];
    for (const raw of Array.isArray(specs) ? specs : []) {
      try {
        const spec = cleanSpec(raw);
        add(spec, previous?.carry?.[spec.id]);
      } catch (e) {
        ctx.log.warn("browser spec", errMsg(e));
      }
    }
    exportMcpTools(ctx, "Browser", browserTools({ pick, agentSessions: () => [...sessions.values()].filter((s) => s.spec.agentAccess) }));
    publish();
    for (const id of wasRunning) {
      const s = sessions.get(id);
      if (s) startQuietly(s);
    }
  },
  snapshot() {
    const carry = {};
    for (const s of sessions.values()) carry[s.spec.id] = s.carry();
    return { carry, running: [...sessions.values()].filter((s) => s.status === "running" || s.status === "starting").map((s) => s.spec.id) };
  },
  async deactivate() {
    if (publishTimer !== null) clearTimeout(publishTimer);
    await Promise.all([...sessions.values()].map((s) => s.detach()));
  },
  methods: {
    list: () => ({ sessions: [...sessions.values()].map((s) => s.view()) }),
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
      if (prev.viewport?.width !== next.viewport?.width || prev.viewport?.height !== next.viewport?.height) await s.setViewport(next.viewport.width, next.viewport.height).catch(() => {
      });
      if (restart && s.status !== "stopped") {
        await s.stop(true);
        startQuietly(s);
      }
      publish();
      return s.view();
    },
    async remove(_ctx, a) {
      const s = get(a.id);
      await s.stop(true);
      if (a.deleteProfile) await s.removeProfile().catch((e) => ctxRef.log.warn("remove profile", errMsg(e)));
      if (s.surface) await ctxRef.host.resources.release(s.surface).catch(() => {
      });
      sessions.delete(s.spec.id);
      await saveSpecs();
      publish();
      return null;
    },
    async start(_ctx, a) {
      const s = get(a.id);
      await s.start();
      return s.view();
    },
    async stop(_ctx, a) {
      const s = get(a.id);
      await s.stop(a.kill !== false);
      return s.view();
    },
    async navigate(_ctx, a) {
      const s = get(a.id);
      await s.start();
      return s.navigate(String(a.url || ""), a.tab, 1);
    },
    async history(_ctx, a) {
      return get(a.id).history(a.action, a.tab);
    },
    async newTab(_ctx, a) {
      const s = get(a.id);
      await s.start();
      return s.newTab(a.url || "about:blank");
    },
    async closeTab(_ctx, a) {
      await get(a.id).closeTab(String(a.tab));
      return null;
    },
    async activateTab(_ctx, a) {
      await get(a.id).activate(String(a.tab));
      return null;
    },
    async setViewport(_ctx, a) {
      const s = get(a.id);
      await s.setViewport(Number(a.width), Number(a.height));
      await saveSpecs();
      return s.view();
    },
    /** Preview input from a `surface` node: {id, kind: pointer|wheel|key, event}. */
    async input(_ctx, a) {
      const s = get(a.id);
      if (s.status !== "running") return null;
      try {
        if (a.kind === "pointer") await s.userPointer(a.event);
        else if (a.kind === "wheel") await s.userWheel(a.event);
        else if (a.kind === "key") await s.userKey(a.event);
      } catch (e) {
        ctxRef.log.debug("browser input", errMsg(e));
      }
      return null;
    },
    network(_ctx, a) {
      return { requests: get(a.id).networkLog({ limit: a.limit, filter: a.filter, tab: a.tab, failedOnly: a.failedOnly, headers: a.headers }) };
    },
    networkEntry(_ctx, a) {
      return get(a.id).networkEntry(String(a.requestId));
    },
    async networkBody(_ctx, a) {
      return get(a.id).networkBody(String(a.requestId), a.maxChars ?? 2e5);
    },
    clearNetwork(_ctx, a) {
      get(a.id).clearNetwork();
      return null;
    },
    async evaluate(_ctx, a) {
      return { value: await get(a.id).evaluate(`function(){return (${String(a.expression)})}`, [], a.tab, true) };
    },
    async text(_ctx, a) {
      return get(a.id).text(a.scope === "viewport" ? "viewport" : "page", a.selector, a.maxChars ?? 2e4, a.tab);
    },
    async elements(_ctx, a) {
      return get(a.id).elements(!!a.all, a.max ?? 200, a.tab);
    },
    async click(_ctx, a) {
      const s = get(a.id);
      s.noteAgent("Click", a.caller);
      return s.click(a);
    },
    async type(_ctx, a) {
      const s = get(a.id);
      s.noteAgent("Type", a.caller);
      return s.type(a);
    },
    async screenshot(_ctx, a) {
      return get(a.id).screenshot({ quality: a.quality, fullPage: a.fullPage, tab: a.tab });
    },
    health: () => ({ ok: true, sessions: sessions.size })
  }
};
var index_default = mod;
export {
  index_default as default
};
