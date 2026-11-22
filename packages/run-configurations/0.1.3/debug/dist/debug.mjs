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
async function targetFor(ctx, desc) {
  if (desc.location === "local") return { kind: "local" };
  const c = await sshConnect(ctx, desc);
  return { kind: "ssh", connection: c.connection, machineId: c.machineId };
}
async function workspaceGrant(ctx, desc, kind, root) {
  const r = root || desc.rootAbsolutePath;
  const key = kind + "|" + desc.machineId + "|" + r;
  let p = grantCache.get(key);
  if (!p) {
    p = (async () => {
      const target = await targetFor(ctx, desc);
      return ctx.host.capabilities.request({ kind, root: r, target });
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
function exportMcpTools(ctx, title, tools2) {
  let pending = 0;
  const publish = () => ctx.state.set(`${ctx.moduleId}.mcp`, {
    title,
    generation: ctx.generation,
    tools: tools2.map(({ handler: _handler, ...definition }) => definition)
  });
  ctx.events.on("internal-mcp.call", async (request) => {
    if (request?.module !== ctx.moduleId || request.generation !== ctx.generation || typeof request.id !== "string") return;
    const tool = tools2.find((tool2) => tool2.name === request.tool);
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
  publish();
  return { publish, pending: () => pending };
}

// ../sdk/debug.ts
var DEBUG_TYPES = { js: ["node", "npm-script", "jest", "vitest"], java: ["java-application", "spring-boot", "junit"] };
var DEBUG_EVENTS = {
  /** {workspaceId, sessions: DebugSessionInfo[]} on session state changes. */
  changed: "debug.changed",
  /** {workspaceId, breakpoints: Breakpoint[], exceptions: ExceptionBreakpoints} when the set changes. */
  breakpoints: "debug.breakpoints"
};

// modules/services/debug/src/relay.ts
var RELAY_SCRIPT = String.raw`
import json, os, re, socket, subprocess, sys, threading
cfg = json.loads(sys.argv[1])
lock = threading.Lock()
def emit(obj):
    line = json.dumps(obj, ensure_ascii=True, separators=(',', ':'))
    with lock:
        sys.stdout.write(line + '\n'); sys.stdout.flush()
server = None
host = '127.0.0.1'
if 'spawn' in cfg:
    spec = cfg['spawn']
    env = dict(os.environ, **spec.get('env', {}))
    server = subprocess.Popen(spec['command'], cwd=spec.get('cwd') or None, env=env, stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    pattern = re.compile(spec['portPattern'])
    port = None
    for line in server.stdout:
        emit({'ev': 'log', 'text': line[-2000:]})
        m = pattern.search(line)
        if m:
            port = int(m.group(1)); break
    if port is None:
        emit({'ev': 'fatal', 'text': 'The debug adapter exited before it started listening'}); sys.exit(1)
    def drain():
        for line in server.stdout: emit({'ev': 'log', 'text': line[-2000:]})
    threading.Thread(target=drain, daemon=True).start()
else:
    port = int(cfg['connect']['port'])
    host = cfg['connect'].get('host') or host
    if host not in ('127.0.0.1', 'localhost', '::1'):
        emit({'ev': 'fatal', 'text': 'The relay only connects to loopback adapters'}); sys.exit(1)
emit({'ev': 'ready', 'port': port})
conns = {}
def reader(cid, sock):
    buf = b''
    try:
        while True:
            data = sock.recv(65536)
            if not data: break
            buf += data
            while True:
                end = buf.find(b'\r\n\r\n')
                if end < 0: break
                m = re.search(rb'Content-Length:\s*(\d+)', buf[:end], re.I)
                if not m: raise ValueError('Malformed DAP header')
                size = int(m.group(1)); start = end + 4
                if len(buf) < start + size: break
                body, buf = buf[start:start + size], buf[start + size:]
                emit({'ev': 'msg', 'id': cid, 'msg': json.loads(body.decode('utf-8'))})
    except Exception as error:
        emit({'ev': 'closed', 'id': cid, 'error': str(error)}); return
    emit({'ev': 'closed', 'id': cid})
for line in sys.stdin:
    try: req = json.loads(line)
    except ValueError: continue
    op, cid = req.get('op'), req.get('id')
    if op == 'open':
        try:
            sock = socket.create_connection((host, port), timeout=15)
            sock.settimeout(None)
            conns[cid] = sock
            threading.Thread(target=reader, args=(cid, sock), daemon=True).start()
            emit({'ev': 'opened', 'id': cid})
        except Exception as error:
            emit({'ev': 'closed', 'id': cid, 'error': str(error)})
    elif op == 'send' and cid in conns:
        body = json.dumps(req['msg'], ensure_ascii=False).encode('utf-8')
        try: conns[cid].sendall(b'Content-Length: ' + str(len(body)).encode() + b'\r\n\r\n' + body)
        except OSError as error: emit({'ev': 'closed', 'id': cid, 'error': str(error)})
    elif op == 'close' and cid in conns:
        try: conns.pop(cid).close()
        except OSError: pass
for sock in conns.values():
    try: sock.close()
    except OSError: pass
if server:
    server.terminate()
    try: server.wait(5)
    except subprocess.TimeoutExpired: server.kill()
`;

// modules/services/debug/src/dap.ts
var Relay = class _Relay {
  constructor(ctx, handle, handlers2) {
    this.ctx = ctx;
    this.handle = handle;
    this.handlers = handlers2;
    this.seq = 1;
    this.buffer = "";
    this.pending = /* @__PURE__ */ new Map();
    this.opening = /* @__PURE__ */ new Map();
    this.subs = [];
    this.open = /* @__PURE__ */ new Set();
    this.alive = true;
  }
  static async start(ctx, d, config, handlers2) {
    const grant = await workspaceGrant(ctx, d, "process");
    const { handle } = await ctx.host.process.spawn(grant.grant, {
      target: await targetFor(ctx, d),
      executable: "python3",
      args: ["-c", RELAY_SCRIPT, JSON.stringify(config)],
      cwd: d.rootAbsolutePath,
      env: {},
      loginShell: d.location === "ssh"
    });
    const relay = new _Relay(ctx, handle, handlers2);
    const ready = new Promise((resolve, reject) => {
      relay.ready = { resolve, reject };
    });
    relay.subs.push(await ctx.host.streams.listen(handle, { channel: "stdout" }, (chunk) => relay.feed(chunk), (error) => relay.ended(error ? errMsg(error) : void 0)));
    relay.subs.push(await ctx.host.streams.listen(handle, { channel: "stderr" }, (chunk) => handlers2.log(chunk)));
    const timer = setTimeout(() => relay.ready.reject(new Error("The debug adapter did not start within 60 seconds")), 6e4);
    try {
      await ready;
    } catch (e) {
      await relay.dispose();
      throw e;
    } finally {
      clearTimeout(timer);
    }
    return relay;
  }
  feed(chunk) {
    this.buffer += chunk;
    let i;
    while ((i = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, i);
      this.buffer = this.buffer.slice(i + 1);
      if (!line.trim()) continue;
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        this.handlers.log(line);
        continue;
      }
      switch (ev.ev) {
        case "ready":
          this.ready.resolve(ev.port);
          break;
        case "fatal":
          this.ready.reject(new Error(ev.text));
          this.handlers.log(ev.text);
          break;
        case "log":
          this.handlers.log(String(ev.text));
          break;
        case "opened":
          this.open.add(ev.id);
          this.opening.get(ev.id)?.resolve();
          this.opening.delete(ev.id);
          break;
        case "closed":
          this.connectionClosed(ev.id, ev.error);
          break;
        case "msg":
          this.message(ev.id, ev.msg);
          break;
      }
    }
  }
  message(conn, msg) {
    if (msg.type === "response") {
      const key = `${conn}:${msg.request_seq}`, p = this.pending.get(key);
      if (!p) return;
      this.pending.delete(key);
      clearTimeout(p.timer);
      if (msg.success) p.resolve(msg);
      else p.reject(new Error(msg.body?.error?.format || msg.message || `${msg.command} failed`));
    } else if (msg.type === "event") this.handlers.event(conn, msg);
    else if (msg.type === "request") this.handlers.request(conn, msg);
  }
  connectionClosed(conn, error) {
    this.open.delete(conn);
    const o = this.opening.get(conn);
    if (o) {
      this.opening.delete(conn);
      o.reject(new Error(error || "Could not connect to the debug adapter"));
    }
    for (const [key, p] of this.pending) if (key.startsWith(`${conn}:`)) {
      this.pending.delete(key);
      clearTimeout(p.timer);
      p.reject(new Error(error || "Debug connection closed"));
    }
    this.handlers.closed(conn, error);
  }
  ended(error) {
    if (!this.alive) return;
    this.alive = false;
    this.ready?.reject(new Error(error || "The debug adapter relay exited"));
    for (const conn of [...this.open]) this.connectionClosed(conn, error || "Debug adapter exited");
    this.handlers.exit(error);
  }
  write(obj) {
    if (!this.alive) throw new Error("The debug adapter is not running");
    return this.ctx.host.process.write(this.handle, JSON.stringify(obj) + "\n");
  }
  connect(conn) {
    const opened = new Promise((resolve, reject) => this.opening.set(conn, { resolve, reject }));
    void this.write({ op: "open", id: conn }).catch((e) => this.connectionClosed(conn, errMsg(e)));
    return opened;
  }
  request(conn, command, args, timeoutMs = 3e4) {
    const seq = this.seq++, key = `${conn}:${seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(key);
        reject(new Error(`${command} timed out`));
      }, timeoutMs);
      this.pending.set(key, { resolve, reject, timer });
      this.write({ op: "send", id: conn, msg: { seq, type: "request", command, arguments: args ?? {} } }).catch((e) => {
        this.pending.delete(key);
        clearTimeout(timer);
        reject(e);
      });
    }).then((m) => m.body);
  }
  respond(conn, req, body = {}, error) {
    return this.write({ op: "send", id: conn, msg: {
      seq: this.seq++,
      type: "response",
      request_seq: req.seq,
      command: req.command,
      success: !error,
      ...error ? { message: error } : {},
      body
    } }).catch(() => {
    });
  }
  close(conn) {
    return this.write({ op: "close", id: conn }).catch(() => {
    });
  }
  async dispose() {
    this.alive = false;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error("Debug session ended"));
    }
    this.pending.clear();
    await this.ctx.host.process.closeStdin(this.handle).catch(() => {
    });
    await new Promise((r) => setTimeout(r, 300));
    await this.ctx.host.process.terminate(this.handle, "SIGTERM").catch(() => {
    });
    await Promise.allSettled(this.subs.map((s) => s.close()));
    await this.ctx.host.resources.release(this.handle).catch(() => {
    });
  }
};

// modules/services/debug/src/install.ts
var ADAPTERS = {
  "js-debug": {
    version: "1.140.1",
    url: "https://github.com/microsoft/vscode-js-debug/releases/download/v1.140.1/js-debug-dap-v1.140.1.tar.gz",
    sha256: "c72fab31bcbfdce6ad1f42adfd28eff8d4681dd3b03b5e2e6f9e72e6f9927faf"
  },
  "java-debug": {
    version: "0.53.1",
    url: "https://repo1.maven.org/maven2/com/microsoft/java/com.microsoft.java.debug.plugin/0.53.1/com.microsoft.java.debug.plugin-0.53.1.jar",
    sha256: "4f4778d452a6a0665536f43ce4e32403a24be6593336b80dc85a322912859e24"
  }
};
var INSTALL_MARKER = "HATO_DEBUG_ADAPTER_RESULT:";
var INSTALL_SCRIPT = String.raw`
import hashlib, json, os, pathlib, shutil, sys, tarfile, tempfile, urllib.request
MARKER = '${INSTALL_MARKER}'
def target(root, name, spec):
    if name == 'js-debug': return root / ('js-debug-' + spec['version']) / 'js-debug' / 'src' / 'dapDebugServer.js'
    return root / ('java-debug-' + spec['version'] + '.jar')
def download(url, destination, digest):
    if not url.startswith('https://'): raise ValueError('Adapter downloads require HTTPS')
    request = urllib.request.Request(url, headers={'User-Agent': 'hato-debug-installer'})
    sha = hashlib.sha256()
    with urllib.request.urlopen(request, timeout=120) as response, open(destination, 'wb') as out:
        if not response.geturl().startswith('https://'): raise ValueError('Insecure download redirect')
        while True:
            chunk = response.read(1 << 20)
            if not chunk: break
            sha.update(chunk); out.write(chunk)
    if sha.hexdigest() != digest: raise ValueError('Checksum mismatch for ' + url)
def safe_extract(archive, destination):
    base = destination.resolve()
    with tarfile.open(archive, 'r:gz') as tar:
        for member in tar.getmembers():
            path = (destination / member.name).resolve()
            if member.issym() or member.islnk() or not (path == base or base in path.parents):
                raise ValueError('Unsafe path in adapter archive: ' + member.name)
        tar.extractall(destination)
def install(root, name, spec):
    final = target(root, name, spec)
    if final.is_file(): return str(final)
    root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.download-', dir=root) as temporary:
        temporary = pathlib.Path(temporary)
        archive = temporary / 'download'
        download(spec['url'], archive, spec['sha256'])
        if name == 'js-debug':
            unpacked = temporary / 'unpacked'
            unpacked.mkdir()
            safe_extract(archive, unpacked)
            destination = root / ('js-debug-' + spec['version'])
            if destination.exists(): shutil.rmtree(destination)
            unpacked.replace(destination)
        else:
            archive.replace(final)
    if not final.is_file(): raise ValueError(name + ' is missing after installation')
    return str(final)
def main(request):
    root = pathlib.Path(os.environ.get('HATO_DEBUG_ADAPTERS_HOME') or os.path.expanduser('~/.local/share/hato/debug-adapters'))
    result = {}
    for name, spec in request['adapters'].items():
        if name not in ('js-debug', 'java-debug'): raise ValueError('Unknown adapter ' + name)
        path = target(root, name, spec)
        result[name] = install(root, name, spec) if request['action'] == 'install' else (str(path) if path.is_file() else None)
    return result
try: print(MARKER + json.dumps(main(json.loads(sys.argv[1]))))
except Exception as error:
    print(MARKER + json.dumps({'error': str(error)})); sys.exit(1)
`;

// modules/services/debug/src/index.ts
var debugTypes = [...DEBUG_TYPES.js, ...DEBUG_TYPES.java];
var sessions = /* @__PURE__ */ new Map();
var breakpoints = /* @__PURE__ */ new Map();
var exceptions = /* @__PURE__ */ new Map();
var loaded = /* @__PURE__ */ new Map();
var breakpointWrites = /* @__PURE__ */ new Map();
var mcp;
var abs = (d, rel2) => rel2.startsWith("/") ? rel2 : `${d.rootAbsolutePath.replace(/\/$/, "")}/${rel2}`;
function rel(d, path) {
  if (!path) return null;
  const root = d.rootAbsolutePath.replace(/\/$/, "") + "/";
  return path.startsWith(root) ? path.slice(root.length) : path;
}
async function workspace(ctx, workspaceId) {
  if (typeof workspaceId !== "string" || !workspaceId) throw new Error("Select a workspace");
  return ctx.modules.call("workspace", "resolve", { workspaceId });
}
var summaries = (workspaceId) => [...sessions.values()].filter((s) => s.info.workspaceId === workspaceId).map((s) => {
  const conn = s.info.stopped ? s.conns.get(s.info.stopped.conn) : void 0;
  return conn ? { ...s.info, supports: { ...s.info.supports, setVariable: !!conn.caps?.supportsSetVariable } } : { ...s.info };
});
var changed = (ctx, workspaceId) => ctx.events.emit(DEBUG_EVENTS.changed, { workspaceId, sessions: summaries(workspaceId) });
function session(id, workspaceId) {
  const s = sessions.get(id);
  if (!s || s.info.workspaceId !== workspaceId) throw new Error("Debug session was not found in this workspace");
  return s;
}
var report = (ctx, s, update) => ctx.modules.call("run", "debugReport", { workspaceId: s.info.workspaceId, id: s.info.id, ...update }).catch(() => {
});
var output = (ctx, s, stream, text) => report(ctx, s, { output: { stream, text } });
async function loadBreakpoints(ctx, workspaceId) {
  if (!loaded.has(workspaceId)) loaded.set(workspaceId, (async () => {
    const saved = await ctx.modules.call("persistence", "settings.get", { key: `debug.breakpoints.${workspaceId}` });
    const list = Array.isArray(saved?.breakpoints) ? saved.breakpoints : [];
    breakpoints.set(workspaceId, list.filter((b) => typeof b?.path === "string" && Number.isInteger(b?.line) && b.line >= 0).slice(0, 2e3).map((b) => ({
      id: String(b.id || crypto.randomUUID()),
      path: b.path,
      line: b.line,
      enabled: b.enabled !== false,
      ...typeof b.condition === "string" && b.condition ? { condition: b.condition } : {},
      ...typeof b.hitCondition === "string" && b.hitCondition ? { hitCondition: b.hitCondition } : {},
      ...typeof b.logMessage === "string" && b.logMessage ? { logMessage: b.logMessage } : {}
    })));
    exceptions.set(workspaceId, { uncaught: saved?.exceptions?.uncaught !== false, caught: !!saved?.exceptions?.caught });
  })().catch((error) => {
    loaded.delete(workspaceId);
    throw error;
  }));
  await loaded.get(workspaceId);
  return breakpoints.get(workspaceId);
}
async function saveBreakpoints(ctx, workspaceId, list, ex = exceptions.get(workspaceId)) {
  await ctx.modules.call("persistence", "settings.set", { key: `debug.breakpoints.${workspaceId}`, value: { breakpoints: list, exceptions: ex } });
  breakpoints.set(workspaceId, list);
  exceptions.set(workspaceId, ex);
  ctx.events.emit(DEBUG_EVENTS.breakpoints, { workspaceId, breakpoints: list, exceptions: ex });
}
function cleanText(value, max = 500) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : void 0;
}
async function syncBreakpoints(ctx, s, paths) {
  if (!s.relay || s.ended) return;
  const list = await loadBreakpoints(ctx, s.info.workspaceId);
  const files = paths ? [...new Set(paths)] : [...new Set(list.map((b) => b.path))];
  const statuses = new Map(s.info.breakpoints.map((b) => [b.id, b]));
  for (const conn of s.conns.values()) {
    if (!conn.ready || !s.relay.open.has(conn.id)) continue;
    if (s.info.kind === "js" && conn.parent === null && s.conns.size > 1) continue;
    for (const path of files) {
      const bps = list.filter((b) => b.path === path && b.enabled);
      const extra = s.runTo && s.runTo.path === path && !bps.some((b) => b.line === s.runTo.line) ? [{ line: s.runTo.line }] : [];
      try {
        const body = await s.relay.request(conn.id, "setBreakpoints", {
          source: { path: abs(s.d, path), name: path.split("/").pop() },
          breakpoints: [
            ...bps.map((b) => ({ line: b.line + 1, ...b.condition ? { condition: b.condition } : {}, ...b.hitCondition ? { hitCondition: b.hitCondition } : {}, ...b.logMessage ? { logMessage: b.logMessage } : {} })),
            ...extra.map((e) => ({ line: e.line + 1 }))
          ],
          sourceModified: false
        });
        (body?.breakpoints || []).slice(0, bps.length).forEach((r, i) => statuses.set(bps[i].id, { id: bps[i].id, verified: !!r.verified, ...r.line ? { line: r.line - 1 } : {}, ...r.message ? { message: String(r.message).slice(0, 300) } : {} }));
      } catch (e) {
        for (const b of bps) statuses.set(b.id, { id: b.id, verified: false, message: errMsg(e) });
      }
    }
    const ex = exceptions.get(s.info.workspaceId);
    const filters = (conn.caps?.exceptionBreakpointFilters || []).map((f) => f.filter);
    const wanted = filters.filter((f) => ex.uncaught && /uncaught/i.test(f) || ex.caught && /^(all|caught)/i.test(f));
    if (filters.length) await s.relay.request(conn.id, "setExceptionBreakpoints", { filters: wanted }).catch(() => {
    });
  }
  s.info.breakpoints = [...statuses.values()];
  changed(ctx, s.info.workspaceId);
}
var allSessions = (workspaceId) => [...sessions.values()].filter((s) => s.info.workspaceId === workspaceId && !s.ended);
async function adapters(ctx, d, names, install) {
  const grant = await workspaceGrant(ctx, d, "process");
  const request = { action: install ? "install" : "check", adapters: Object.fromEntries(names.map((n) => [n, ADAPTERS[n]])) };
  const r = await ctx.host.process.run(grant.grant, {
    target: await targetFor(ctx, d),
    executable: "python3",
    args: ["-c", INSTALL_SCRIPT, JSON.stringify(request)],
    cwd: d.rootAbsolutePath,
    env: {},
    loginShell: d.location === "ssh"
  }, { timeoutMs: install ? 10 * 60 * 1e3 : 6e4, limitBytes: 65536 });
  const line = (r.stdout || "").split("\n").find((l) => l.startsWith(INSTALL_MARKER));
  if (!line) throw new Error(`Python 3 is required on ${d.machineId} to install the debugger. ${(r.stderr || "").slice(-500)}`);
  const result = JSON.parse(line.slice(INSTALL_MARKER.length));
  if (result.error) throw new Error(`Could not install the debugger: ${result.error}`);
  return result;
}
async function adapterPath(ctx, s, name) {
  let found = (await adapters(ctx, s.d, [name], false))[name];
  if (!found) {
    void output(ctx, s, "system", `Installing ${name} ${ADAPTERS[name].version} for this machine…
`);
    found = (await adapters(ctx, s.d, [name], true))[name];
  }
  if (!found) throw new Error(`${name} is not installed`);
  return found;
}
async function initialize(ctx, s, conn, adapterID) {
  conn.caps = await s.relay.request(conn.id, "initialize", {
    clientID: "hato",
    clientName: "Hato",
    adapterID,
    locale: "en",
    linesStartAt1: true,
    columnsStartAt1: true,
    pathFormat: "path",
    supportsVariableType: true,
    supportsVariablePaging: true,
    supportsRunInTerminalRequest: false,
    supportsStartDebuggingRequest: true,
    supportsInvalidatedEvent: true,
    supportsProgressReporting: false
  }) || {};
  if (conn.parent === null) s.info.supports = {
    restartFrame: !!conn.caps.supportsRestartFrame,
    stepInTargets: !!conn.caps.supportsStepInTargetsRequest,
    setVariable: !!conn.caps.supportsSetVariable,
    hitConditions: !!conn.caps.supportsHitConditionalBreakpoints,
    logPoints: !!conn.caps.supportsLogPoints,
    conditionalBreakpoints: !!conn.caps.supportsConditionalBreakpoints,
    hotCodeReplace: s.info.kind === "java"
  };
}
async function onEvent(ctx, s, connId, msg) {
  const conn = s.conns.get(connId);
  const b = msg.body || {};
  switch (msg.event) {
    case "initialized":
      if (!conn) return;
      conn.ready = true;
      await syncBreakpoints(ctx, s);
      await s.relay.request(connId, "configurationDone", {}).catch((e) => output(ctx, s, "system", `configurationDone: ${errMsg(e)}
`));
      if (s.info.state === "starting") {
        s.info.state = "running";
        changed(ctx, s.info.workspaceId);
        void report(ctx, s, { state: "running" });
      }
      break;
    case "output": {
      const category = b.category === "stderr" ? "stderr" : b.category === "console" || b.category === "important" ? "system" : b.category === "telemetry" ? null : "stdout";
      if (category && typeof b.output === "string") void output(ctx, s, category, b.output);
      break;
    }
    case "stopped":
      await stopped(ctx, s, connId, b);
      break;
    case "continued":
      if (s.info.stopped && (b.allThreadsContinued !== false || s.info.stopped.threadId === b.threadId)) resumed(ctx, s);
      break;
    case "thread":
      if (conn && b.reason === "exited") conn.threads.delete(b.threadId);
      break;
    case "breakpoint": {
      const bp = b.breakpoint;
      if (bp?.id !== void 0) changed(ctx, s.info.workspaceId);
      break;
    }
    case "exited":
      if (conn?.parent !== null || s.info.kind === "java") s.exitCode = typeof b.exitCode === "number" ? b.exitCode : s.exitCode;
      break;
    case "terminated":
      if (conn && conn.parent !== null) {
        s.conns.delete(connId);
        void s.relay?.close(connId);
        if (![...s.conns.values()].some((c) => c.parent !== null)) await end(ctx, s);
      } else await end(ctx, s);
      break;
  }
}
async function onRequest(ctx, s, connId, msg) {
  if (msg.command === "startDebugging") {
    void s.relay.respond(connId, msg, {});
    const child = { id: s.nextConn++, caps: {}, parent: connId, ready: false, threads: /* @__PURE__ */ new Map() };
    s.conns.set(child.id, child);
    try {
      await s.relay.connect(child.id);
      await initialize(ctx, s, child, "pwa-node");
      const request = msg.arguments?.request === "attach" ? "attach" : "launch";
      void s.relay.request(child.id, request, msg.arguments?.configuration || {}, 12e4).catch((e) => output(ctx, s, "system", `${errMsg(e)}
`));
    } catch (e) {
      void output(ctx, s, "system", `Could not attach to a child process: ${errMsg(e)}
`);
    }
    return;
  }
  void s.relay.respond(connId, msg, {}, `${msg.command} is not supported by Hato`);
}
async function stopped(ctx, s, connId, b) {
  const threadId = typeof b.threadId === "number" ? b.threadId : [...s.conns.get(connId)?.threads.keys() || []][0];
  let frame = null;
  try {
    const trace = await s.relay.request(connId, "stackTrace", { threadId, startFrame: 0, levels: 20 });
    frame = (trace?.stackFrames || []).find((f) => f.source?.path && f.presentationHint !== "subtle") || trace?.stackFrames?.[0] || null;
  } catch {
  }
  if (s.runTo) {
    const r = s.runTo;
    s.runTo = null;
    await syncBreakpoints(ctx, s, [r.path]);
  }
  s.info.state = "paused";
  s.info.stopped = {
    conn: connId,
    threadId,
    reason: String(b.reason || "pause"),
    ...b.description || b.text ? { description: String(b.text || b.description).slice(0, 300) } : {},
    path: rel(s.d, frame?.source?.path),
    line: Math.max(0, (frame?.line || 1) - 1),
    frameId: frame?.id ?? 0
  };
  changed(ctx, s.info.workspaceId);
  void report(ctx, s, { state: "paused", pausedAt: s.info.stopped.path ? { path: s.info.stopped.path, line: s.info.stopped.line, reason: s.info.stopped.reason } : void 0 });
}
function resumed(ctx, s) {
  delete s.info.stopped;
  s.info.state = "running";
  changed(ctx, s.info.workspaceId);
  void report(ctx, s, { state: "running" });
}
async function end(ctx, s) {
  if (s.ended) return;
  s.ended = true;
  s.info.state = "ended";
  delete s.info.stopped;
  changed(ctx, s.info.workspaceId);
  const relay = s.relay;
  s.relay = null;
  if (relay) {
    for (const conn of [...relay.open]) await relay.request(conn, "disconnect", { terminateDebuggee: true }, 3e3).catch(() => {
    });
    await relay.dispose();
  }
  s.finish(s.exitCode);
  void report(ctx, s, { ended: true, exitCode: s.exitCode });
  setTimeout(() => {
    if (sessions.get(s.info.id) === s) {
      sessions.delete(s.info.id);
      changed(ctx, s.info.workspaceId);
    }
  }, 6e4);
}
function newSession(ctx, d, id, name, kind) {
  const old = sessions.get(id);
  if (old && !old.ended) throw new Error("This run is already being debugged");
  let finish;
  const done = new Promise((r) => {
    finish = r;
  });
  const s = {
    info: {
      id,
      workspaceId: d.id,
      name,
      kind,
      state: "starting",
      breakpoints: [],
      supports: { restartFrame: false, stepInTargets: false, setVariable: false, hitConditions: false, logPoints: false, conditionalBreakpoints: false, hotCodeReplace: false }
    },
    d,
    relay: null,
    conns: /* @__PURE__ */ new Map(),
    nextConn: 1,
    ended: false,
    exitCode: null,
    finish,
    done,
    runTo: null,
    launched: false
  };
  sessions.set(id, s);
  changed(ctx, d.id);
  return s;
}
var handlers = (ctx, s) => ({
  event: (conn, msg) => void onEvent(ctx, s, conn, msg).catch((e) => ctx.log.warn(`debug event: ${errMsg(e)}`)),
  request: (conn, msg) => void onRequest(ctx, s, conn, msg),
  closed: (conn) => {
    const c = s.conns.get(conn);
    if (c && c.parent === null && !s.ended) void end(ctx, s);
  },
  log: (text) => {
    if (/error|exception/i.test(text)) ctx.log.warn(`debug adapter: ${text.slice(0, 500)}`);
  },
  exit: () => {
    if (!s.ended) void end(ctx, s);
  }
});
async function launchJs(ctx, a) {
  const d = await workspace(ctx, a.workspaceId);
  const s = newSession(ctx, d, a.id, a.name, "js");
  try {
    const server = await adapterPath(ctx, s, "js-debug");
    const node = a.launch.executable.endsWith("node") ? a.launch.executable : "node";
    s.relay = await Relay.start(ctx, d, { spawn: { command: [node, server, "0", "127.0.0.1"], cwd: a.launch.cwd, portPattern: ":(\\d+)\\s*$" } }, handlers(ctx, s));
    const root = { id: s.nextConn++, caps: {}, parent: null, ready: false, threads: /* @__PURE__ */ new Map() };
    s.conns.set(root.id, root);
    await s.relay.connect(root.id);
    await initialize(ctx, s, root, "pwa-node");
    void s.relay.request(root.id, "launch", {
      type: "pwa-node",
      request: "launch",
      name: a.name,
      cwd: a.launch.cwd,
      env: a.launch.env,
      runtimeExecutable: a.launch.executable,
      runtimeArgs: a.launch.args,
      console: "internalConsole",
      outputCapture: "std",
      skipFiles: ["<node_internals>/**"],
      sourceMaps: true,
      autoAttachChildProcesses: true
    }, 12e4).catch((e) => {
      void output(ctx, s, "system", `${errMsg(e)}
`);
      void end(ctx, s);
    });
  } catch (e) {
    void output(ctx, s, "system", `${errMsg(e)}
`);
    await end(ctx, s);
    throw e;
  }
  return { started: true };
}
async function attachJava(ctx, a) {
  const d = await workspace(ctx, a.workspaceId);
  const s = newSession(ctx, d, a.id, a.name, "java");
  try {
    const jar = await adapterPath(ctx, s, "java-debug");
    const r = await ctx.modules.call("language-service", "bundles.set", { workspaceId: d.id, serverId: "jdtls", bundles: [jar] });
    if (r?.changed) void output(ctx, s, "system", "Restarting the Java language server with the debugger…\n");
    let port;
    try {
      port = await ctx.modules.call("language-service", "executeCommand", { workspaceId: d.id, serverId: "jdtls", command: "vscode.java.startDebugSession", arguments: [], timeoutMs: 18e4 }, { timeoutMs: 19e4 });
    } catch (e) {
      throw new Error(`Java debugging needs the Java language server for this project (Language tools → Java project). ${errMsg(e)}`);
    }
    if (!Number.isInteger(port)) throw new Error("The Java language server did not start the debugger");
    s.relay = await Relay.start(ctx, d, { connect: { port } }, handlers(ctx, s));
    const root = { id: s.nextConn++, caps: {}, parent: null, ready: false, threads: /* @__PURE__ */ new Map() };
    s.conns.set(root.id, root);
    await s.relay.connect(root.id);
    await initialize(ctx, s, root, "java");
    await s.relay.request(root.id, "attach", { type: "java", request: "attach", name: a.name, hostName: "127.0.0.1", port: a.port, timeout: 3e4 }, 6e4);
  } catch (e) {
    void output(ctx, s, "system", `${errMsg(e)}
`);
    await end(ctx, s);
    throw e;
  }
  return { attached: true };
}
function focus(s, a) {
  const conn = Number.isInteger(a.conn) ? a.conn : s.info.stopped?.conn ?? [...s.conns.values()].find((c) => c.parent !== null)?.id ?? 1;
  if (!s.relay || s.ended) throw new Error("The debug session has ended");
  return { conn, threadId: Number.isInteger(a.threadId) ? a.threadId : s.info.stopped?.threadId };
}
async function threads(s) {
  const out = [];
  for (const conn of s.conns.values()) {
    if (!s.relay?.open.has(conn.id) || s.info.kind === "js" && conn.parent === null && s.conns.size > 1) continue;
    const body = await s.relay.request(conn.id, "threads", {}).catch(() => null);
    for (const t of body?.threads || []) {
      const thread = { conn: conn.id, id: t.id, name: String(t.name), stopped: s.info.stopped?.conn === conn.id && s.info.stopped.threadId === t.id };
      conn.threads.set(t.id, thread);
      out.push(thread);
    }
  }
  return out;
}
async function stack(s, a) {
  const { conn, threadId } = focus(s, a);
  if (threadId === void 0) throw new Error("No thread is paused");
  const body = await s.relay.request(conn, "stackTrace", { threadId, startFrame: Math.max(0, a.start | 0), levels: Math.min(200, Math.max(1, a.levels | 0 || 50)) });
  return (body?.stackFrames || []).map((f) => ({
    conn,
    id: f.id,
    name: String(f.name),
    path: rel(s.d, f.source?.path),
    source: String(f.source?.name || f.source?.path?.split("/").pop() || ""),
    line: Math.max(0, (f.line || 1) - 1),
    column: Math.max(0, (f.column || 1) - 1),
    library: f.presentationHint === "subtle" || f.source?.presentationHint === "deemphasize" || !f.source?.path || /node_modules|<node_internals>/.test(f.source?.path || "")
  }));
}
var variable = (v) => ({
  name: String(v.name),
  value: String(v.value ?? v.result ?? ""),
  variablesReference: Number.isInteger(v.variablesReference) ? v.variablesReference : 0,
  type: v.type,
  evaluateName: v.evaluateName,
  namedVariables: v.namedVariables,
  indexedVariables: v.indexedVariables,
  presentationHint: v.presentationHint,
  memoryReference: v.memoryReference
});
async function control(ctx, s, action, a) {
  const { conn, threadId } = focus(s, a);
  const thread = threadId ?? [...s.conns.get(conn)?.threads.keys() || []][0] ?? 0;
  switch (action) {
    case "continue":
      await s.relay.request(conn, "continue", { threadId: thread });
      resumed(ctx, s);
      break;
    case "pause":
      await s.relay.request(conn, "pause", { threadId: thread });
      break;
    case "over":
      await s.relay.request(conn, "next", { threadId: thread });
      resumed(ctx, s);
      break;
    case "into":
      await s.relay.request(conn, "stepIn", { threadId: thread, ...Number.isInteger(a.targetId) ? { targetId: a.targetId } : {} });
      resumed(ctx, s);
      break;
    case "out":
      await s.relay.request(conn, "stepOut", { threadId: thread });
      resumed(ctx, s);
      break;
    case "restartFrame":
      if (!s.info.supports.restartFrame) throw new Error("This debugger cannot restart frames");
      await s.relay.request(conn, "restartFrame", { frameId: a.frameId ?? s.info.stopped?.frameId });
      break;
    default:
      throw new Error(`Unknown action ${action}`);
  }
  return { ...s.info };
}
function dispatch(ctx, d, op, a) {
  if (op !== "breakpointsSet" && op !== "breakpointsRemove" && op !== "breakpointsToggle" && op !== "exceptionsSet") {
    return operation(ctx, d, op, a);
  }
  const result = (breakpointWrites.get(d.id) ?? Promise.resolve()).then(() => operation(ctx, d, op, a));
  const settled = result.then(() => {
  }, () => {
  });
  breakpointWrites.set(d.id, settled);
  void settled.then(() => {
    if (breakpointWrites.get(d.id) === settled) breakpointWrites.delete(d.id);
  });
  return result;
}
async function operation(ctx, d, op, a) {
  switch (op) {
    case "capabilities":
      return { debug: true, debugTypes };
    case "sessions":
      return summaries(d.id);
    case "threads":
      return threads(session(a.id, d.id));
    case "stack":
      return stack(session(a.id, d.id), a);
    case "scopes": {
      const s = session(a.id, d.id), { conn } = focus(s, a);
      const body = await s.relay.request(conn, "scopes", { frameId: a.frameId ?? s.info.stopped?.frameId });
      return (body?.scopes || []).map((x) => ({ name: String(x.name), variablesReference: x.variablesReference | 0, expensive: !!x.expensive }));
    }
    case "variables": {
      const s = session(a.id, d.id), { conn } = focus(s, a);
      if (!Number.isInteger(a.variablesReference) || a.variablesReference <= 0) throw new Error("variablesReference is required");
      const body = await s.relay.request(conn, "variables", {
        variablesReference: a.variablesReference,
        ...a.filter === "indexed" || a.filter === "named" ? { filter: a.filter } : {},
        ...Number.isInteger(a.start) && a.start >= 0 ? { start: a.start } : {},
        ...Number.isInteger(a.count) && a.count >= 0 ? { count: Math.min(a.count, 500) } : {}
      });
      return (body?.variables || []).slice(0, 500).map(variable);
    }
    case "evaluate": {
      const s = session(a.id, d.id), { conn } = focus(s, a);
      if (typeof a.expression !== "string" || !a.expression.trim() || a.expression.length > 1e4) throw new Error("Enter an expression");
      const context = ["watch", "repl", "hover", "clipboard"].includes(a.context) ? a.context : "repl";
      const body = await s.relay.request(conn, "evaluate", { expression: a.expression, context, ...Number.isInteger(a.frameId ?? s.info.stopped?.frameId) ? { frameId: a.frameId ?? s.info.stopped?.frameId } : {} }, 6e4);
      return variable({ ...body, name: a.expression });
    }
    case "setVariable": {
      const s = session(a.id, d.id), { conn } = focus(s, a);
      if (!s.conns.get(conn)?.caps?.supportsSetVariable) throw new Error("This debugger cannot change values");
      const body = await s.relay.request(conn, "setVariable", { variablesReference: a.variablesReference, name: String(a.name), value: String(a.value) });
      return variable({ ...body, name: a.name });
    }
    case "stepInTargets": {
      const s = session(a.id, d.id), { conn } = focus(s, a);
      if (!s.info.supports.stepInTargets) return [];
      const body = await s.relay.request(conn, "stepInTargets", { frameId: a.frameId ?? s.info.stopped?.frameId });
      return (body?.targets || []).map((t) => ({ id: t.id, label: String(t.label) }));
    }
    case "continue":
      return control(ctx, session(a.id, d.id), "continue", a);
    case "pause":
      return control(ctx, session(a.id, d.id), "pause", a);
    case "stepOver":
      return control(ctx, session(a.id, d.id), "over", a);
    case "stepInto":
      return control(ctx, session(a.id, d.id), "into", a);
    case "stepOut":
      return control(ctx, session(a.id, d.id), "out", a);
    case "restartFrame":
      return control(ctx, session(a.id, d.id), "restartFrame", a);
    case "runToLine": {
      const s = session(a.id, d.id), { conn } = focus(s, a);
      if (typeof a.path !== "string" || !Number.isInteger(a.line) || a.line < 0) throw new Error("path and line are required");
      s.runTo = { conn, path: rel(d, a.path), line: a.line };
      await syncBreakpoints(ctx, s, [s.runTo.path]);
      return control(ctx, s, "continue", a);
    }
    case "stop": {
      const s = session(a.id, d.id);
      await end(ctx, s);
      return { ...s.info };
    }
    case "breakpointsList":
      return {
        breakpoints: await loadBreakpoints(ctx, d.id),
        exceptions: exceptions.get(d.id),
        status: allSessions(d.id).flatMap((s) => s.info.breakpoints)
      };
    case "breakpointsSet": {
      const list = (await loadBreakpoints(ctx, d.id)).map((bp2) => ({ ...bp2 }));
      const path = typeof a.path === "string" ? rel(d, a.path.replace(/^\.\//, "")) : null;
      if (!path || path.startsWith("/") || path.split("/").includes("..")) throw new Error("Use a workspace-relative file path");
      if (!Number.isInteger(a.line) || a.line < 0) throw new Error("line must be a zero-based line number");
      let bp = list.find((b) => a.breakpointId && b.id === a.breakpointId || b.path === path && b.line === a.line);
      if (!bp) {
        if (list.length >= 2e3) throw new Error("Too many breakpoints");
        bp = { id: crypto.randomUUID(), path, line: a.line, enabled: true };
        list.push(bp);
      }
      bp.path = path;
      bp.line = a.line;
      if ("enabled" in a) bp.enabled = a.enabled !== false;
      for (const key of ["condition", "hitCondition", "logMessage"]) if (key in a) {
        const v = cleanText(a[key]);
        if (v) bp[key] = v;
        else delete bp[key];
      }
      await saveBreakpoints(ctx, d.id, list);
      for (const s of allSessions(d.id)) await syncBreakpoints(ctx, s, [path]);
      return bp;
    }
    case "breakpointsRemove": {
      const list = await loadBreakpoints(ctx, d.id);
      const gone = list.filter((b) => a.breakpointId ? b.id === a.breakpointId : a.all === true || b.path === rel(d, a.path) && (a.line === void 0 || b.line === a.line));
      await saveBreakpoints(ctx, d.id, list.filter((b) => !gone.includes(b)));
      for (const s of allSessions(d.id)) await syncBreakpoints(ctx, s, [...new Set(gone.map((b) => b.path))]);
      return { removed: gone.length };
    }
    case "breakpointsToggle": {
      const list = await loadBreakpoints(ctx, d.id);
      const path = typeof a.path === "string" ? rel(d, a.path.replace(/^\.\//, "")) : null;
      const at = list.find((b) => b.path === path && b.line === a.line);
      if (at) return operation(ctx, d, "breakpointsRemove", { breakpointId: at.id });
      return operation(ctx, d, "breakpointsSet", { path, line: a.line });
    }
    case "exceptionsSet": {
      const list = await loadBreakpoints(ctx, d.id);
      const ex = { ...exceptions.get(d.id) };
      if (typeof a.uncaught === "boolean") ex.uncaught = a.uncaught;
      if (typeof a.caught === "boolean") ex.caught = a.caught;
      await saveBreakpoints(ctx, d.id, list, ex);
      for (const s of allSessions(d.id)) await syncBreakpoints(ctx, s, []);
      return ex;
    }
    case "install":
      return adapters(ctx, d, Array.isArray(a.adapters) && a.adapters.length ? a.adapters : ["js-debug", "java-debug"], true);
  }
}
var str = { type: "string" };
var int = { type: "integer" };
var bool = { type: "boolean" };
var sid = { id: { ...str, description: "Debug session ID (from debug_sessions)" } };
var where = { conn: { ...int, description: "Adapter connection (from threads/stack); defaults to the paused one" }, threadId: int };
var tools = [
  ["debug_sessions", "sessions", "List debug sessions, their state, paused location and breakpoint verification.", {}, [], "read"],
  ["debug_threads", "threads", "List threads of a debug session.", sid, ["id"], "read"],
  ["debug_stack", "stack", "Read the call stack of the paused (or given) thread. Lines are zero-based.", { ...sid, ...where, start: int, levels: int }, ["id"], "read"],
  ["debug_scopes", "scopes", "List variable scopes of a frame (default: the paused frame).", { ...sid, conn: int, frameId: int }, ["id"], "read"],
  ["debug_variables", "variables", "Expand a variablesReference from scopes, variables or evaluate.", { ...sid, conn: int, variablesReference: int, filter: { type: "string", enum: ["indexed", "named"] }, start: int, count: int }, ["id", "variablesReference"], "read"],
  ["debug_evaluate", "evaluate", "Evaluate an expression in the paused frame. Can run code in the program; requires approval.", { ...sid, conn: int, frameId: int, expression: str }, ["id", "expression"], "approve"],
  ["debug_set_variable", "setVariable", "Change a variable's value; requires approval.", { ...sid, conn: int, variablesReference: int, name: str, value: str }, ["id", "variablesReference", "name", "value"], "approve"],
  ["debug_continue", "continue", "Resume execution.", { ...sid, ...where }, ["id"], "control"],
  ["debug_pause", "pause", "Pause execution.", { ...sid, ...where }, ["id"], "control"],
  ["debug_step_over", "stepOver", "Step over the current line.", { ...sid, ...where }, ["id"], "control"],
  ["debug_step_into", "stepInto", "Step into the call on the current line (targetId from stepInTargets to choose one).", { ...sid, ...where, targetId: int }, ["id"], "control"],
  ["debug_step_out", "stepOut", "Step out of the current function.", { ...sid, ...where }, ["id"], "control"],
  ["debug_run_to_line", "runToLine", "Continue until a workspace-relative path and zero-based line.", { ...sid, ...where, path: str, line: int }, ["id", "path", "line"], "control"],
  ["debug_stop", "stop", "Stop debugging and terminate the program.", sid, ["id"], "control"],
  ["breakpoints_list", "breakpointsList", "List project breakpoints (zero-based lines), exception settings and verification.", {}, [], "read"],
  ["breakpoints_set", "breakpointsSet", "Add or update a breakpoint at a workspace-relative path and zero-based line. Empty condition/hitCondition/logMessage clears it.", { path: str, line: int, condition: str, hitCondition: str, logMessage: str, enabled: bool }, ["path", "line"], "control"],
  ["breakpoints_remove", "breakpointsRemove", "Remove a breakpoint by breakpointId, by path (and line), or all with all=true.", { breakpointId: str, path: str, line: int, all: bool }, [], "control"],
  ["breakpoints_toggle", "breakpointsToggle", "Toggle a breakpoint at a path and zero-based line.", { path: str, line: int }, ["path", "line"], "control"],
  ["breakpoints_exceptions", "exceptionsSet", "Pause on uncaught and/or caught exceptions.", { uncaught: bool, caught: bool }, [], "control"]
];
var mod = {
  id: "debug",
  moduleApiVersion: 1,
  activate(ctx) {
    mcp = exportMcpTools(ctx, "Debugger", tools.map(([name, op, description, properties, required, kind]) => ({
      name,
      description,
      inputSchema: { type: "object", properties, required, additionalProperties: false },
      annotations: { readOnlyHint: kind === "read", destructiveHint: op === "stop" || op === "breakpointsRemove" },
      timeoutMs: 9e4,
      handler: async (a, scope) => {
        const d = await workspace(ctx, scope.workspaceId);
        if (d.machineId !== scope.machineId) throw new Error("MCP machine scope does not match this workspace");
        if (kind === "approve") {
          const r = await ctx.host.approvals.request({
            operation: `debug.${op}`,
            title: op === "evaluate" ? "Allow this agent to evaluate code in the debugged program?" : "Allow this agent to change a value in the debugged program?",
            detail: `${d.name}
${String(a.expression ?? `${a.name} = ${a.value}`).slice(0, 400)}`,
            timeoutMs: 12e4
          });
          if (r.optionId !== "allow") throw new Error("Approval was denied or expired");
        }
        return dispatch(ctx, d, op, a);
      }
    })));
  },
  canSwap: () => ({ ok: !mcp?.pending() && ![...sessions.values()].some((s) => !s.ended), reason: "A debug session is active" }),
  async deactivate(ctx) {
    for (const s of sessions.values()) if (!s.ended) await end(ctx, s).catch(() => {
    });
  },
  methods: {
    ...Object.fromEntries(tools.map(([, op]) => [op, async (ctx, a) => dispatch(ctx, await workspace(ctx, a.workspaceId), op, a)])),
    capabilities: () => ({ debug: true, debugTypes }),
    install: async (ctx, a) => operation(ctx, await workspace(ctx, a.workspaceId), "install", a),
    scopes: async (ctx, a) => operation(ctx, await workspace(ctx, a.workspaceId), "scopes", a),
    stepInTargets: async (ctx, a) => operation(ctx, await workspace(ctx, a.workspaceId), "stepInTargets", a),
    restartFrame: async (ctx, a) => operation(ctx, await workspace(ctx, a.workspaceId), "restartFrame", a),
    /** Run service only: Node/TS launch through js-debug, resolving when the program ends. */
    async launchJs(ctx, a, meta) {
      if (meta?.caller !== "run") throw new Error("Only the run service starts debug launches");
      return launchJs(ctx, a);
    },
    /** Run service only: attach to a JVM it started with a JDWP agent on `port`. */
    async attachJava(ctx, a, meta) {
      if (meta?.caller !== "run") throw new Error("Only the run service starts debug launches");
      return attachJava(ctx, a);
    },
    /** Run service only: its process ended or the user stopped the run. */
    async end(ctx, a, meta) {
      if (meta?.caller !== "run") throw new Error("Only the run service ends debug sessions");
      const s = sessions.get(a.id);
      if (s) {
        if (Number.isInteger(a.exitCode)) s.exitCode = a.exitCode;
        await end(ctx, s);
      }
      return { ended: true };
    }
  }
};
var index_default = mod;
export {
  index_default as default
};
