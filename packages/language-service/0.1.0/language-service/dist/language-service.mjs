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

// ../sdk/languages.ts
function languageDefinitions(plugins) {
  const result = [];
  for (const plugin of [...plugins].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!plugin.enabled || !plugin.active) continue;
    const contributions = plugin.contributes?.languages;
    if (!Array.isArray(contributions)) continue;
    for (const lang of contributions) {
      if (!lang || typeof lang.id !== "string" || typeof lang.grammar !== "string" || typeof lang.name !== "string") continue;
      const extensions = Array.isArray(lang.extensions) ? lang.extensions.filter((v) => typeof v === "string" && v.length) : [];
      const filenames = Array.isArray(lang.filenames) ? lang.filenames.filter((v) => typeof v === "string" && v.length) : [];
      if (!extensions.length && !filenames.length) continue;
      const server = lang.server;
      const validServer = server && typeof server.id === "string" && typeof server.executable === "string" && Array.isArray(server.args) && server.args.every((v) => typeof v === "string") && typeof server.installHint === "string";
      result.push({ ...lang, extensions, filenames, server: validServer ? server : void 0, pluginId: plugin.id });
    }
  }
  return result;
}
function languageForPath(languages2, path) {
  const name = path.replace(/\\/g, "/").split("/").pop().toLowerCase();
  return languages2.find((l) => l.filenames?.some((n) => n.toLowerCase() === name)) || languages2.find((l) => l.extensions?.some((ext) => name.endsWith("." + ext.toLowerCase()))) || null;
}
function relativeFile(path) {
  if (!path || /^[\\/]|^[a-z]:/i.test(path) || path.includes("\0")) throw new Error("Expected a workspace-relative file");
  const parts = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (part === "..") {
      if (!parts.length) throw new Error("File escapes the workspace");
      parts.pop();
    } else if (part && part !== ".") parts.push(part);
  }
  if (!parts.length) throw new Error("Expected a file");
  return parts.join("/");
}
function fileUri(path) {
  const normalized = path.replace(/\\/g, "/");
  if (!normalized.startsWith("/") && !/^[a-z]:\//i.test(normalized)) throw new Error("Expected an absolute path");
  const absolute = normalized.startsWith("/") ? normalized : "/" + normalized;
  return "file://" + absolute.split("/").map((s, i) => i === 1 && /^[a-z]:$/i.test(s) ? s : encodeURIComponent(s)).join("/");
}
function documentUri(root, path) {
  return fileUri(root.replace(/[\\/]+$/, "") + "/" + relativeFile(path));
}
function definitionLinks(value) {
  return (Array.isArray(value) ? value : value ? [value] : []).flatMap((item) => {
    const targetUri = item?.targetUri ?? item?.uri;
    const targetRange = item?.targetRange ?? item?.range;
    const selection = item?.targetSelectionRange ?? targetRange;
    if (typeof targetUri !== "string" || !validRange(targetRange) || !validRange(selection)) return [];
    return [{
      targetUri,
      targetRange,
      targetSelectionRange: selection,
      ...validRange(item.originSelectionRange) ? { originSelectionRange: item.originSelectionRange } : {}
    }];
  });
}
function validPosition(p) {
  return p && Number.isInteger(p.line) && p.line >= 0 && Number.isInteger(p.character) && p.character >= 0;
}
function validRange(r) {
  return r && validPosition(r.start) && validPosition(r.end);
}

// ../sdk/lsp.ts
var encoder = new TextEncoder();
var decoder = new TextDecoder();
function lspFrame(message) {
  const body = JSON.stringify(message);
  return `Content-Length: ${encoder.encode(body).length}\r
\r
${body}`;
}
function decodeBase64(text) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const result = [];
  let bits = 0, value = 0;
  for (const c of text.replace(/=+$/, "")) {
    const n = alphabet.indexOf(c);
    if (n < 0) throw new Error("Invalid base64 stream");
    value = value << 6 | n;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      result.push(value >> bits & 255);
    }
  }
  return new Uint8Array(result);
}
var LspPeer = class {
  constructor(send) {
    this.send = send;
    this.buffer = new Uint8Array(0);
    this.nextId = 1;
    this.pending = /* @__PURE__ */ new Map();
    this.writes = Promise.resolve();
    this.closed = null;
    this.onRequest = async (method) => {
      throw Object.assign(new Error(`Unsupported request: ${method}`), { code: -32601 });
    };
    this.onNotification = () => {
    };
  }
  write(message) {
    if (this.closed) return Promise.reject(this.closed);
    const next = this.writes.then(() => this.send(lspFrame(message)));
    this.writes = next.catch((e) => this.fail(e));
    return next;
  }
  feed(bytes) {
    if (this.closed) return;
    try {
      if (this.buffer.length + bytes.length > 16 * 1024 * 1024) throw new Error("LSP message exceeds 16 MiB");
      const buffer = new Uint8Array(this.buffer.length + bytes.length);
      buffer.set(this.buffer);
      buffer.set(bytes, this.buffer.length);
      this.buffer = buffer;
      while (this.buffer.length) {
        let end = -1;
        for (let i = 0; i + 3 < this.buffer.length; i++) if (this.buffer[i] === 13 && this.buffer[i + 1] === 10 && this.buffer[i + 2] === 13 && this.buffer[i + 3] === 10) {
          end = i;
          break;
        }
        if (end < 0) {
          if (this.buffer.length > 8192) throw new Error("LSP header too large");
          return;
        }
        if (end > 8192) throw new Error("LSP header too large");
        const header = decoder.decode(this.buffer.slice(0, end));
        const lengths = [...header.matchAll(/^Content-Length:\s*(\d+)\s*$/gim)];
        if (lengths.length !== 1) throw new Error("Invalid LSP Content-Length");
        const length = Number(lengths[0][1]);
        if (length > 16 * 1024 * 1024) throw new Error("LSP message exceeds 16 MiB");
        if (this.buffer.length < end + 4 + length) return;
        const message = JSON.parse(decoder.decode(this.buffer.slice(end + 4, end + 4 + length)));
        this.buffer = this.buffer.slice(end + 4 + length);
        this.handle(message);
      }
    } catch (error) {
      this.fail(error);
    }
  }
  handle(message) {
    if (message?.jsonrpc !== "2.0") throw new Error("Invalid LSP response");
    if (typeof message.method === "string") {
      if (message.id != null) {
        void Promise.resolve().then(() => this.onRequest(message.method, message.params)).then(
          (result) => this.write({ jsonrpc: "2.0", id: message.id, result: result ?? null }),
          (error) => this.write({ jsonrpc: "2.0", id: message.id, error: { code: typeof error.code === "number" ? error.code : -32603, message: String(error.message || error) } })
        ).catch(() => {
        });
      } else this.onNotification(message.method, message.params);
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(message.error.message || "LSP request failed"));
    else pending.resolve(message.result);
  }
  request(method, params, timeoutMs = 3e4) {
    if (this.closed) return Promise.reject(this.closed);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
        void this.notify("$/cancelRequest", { id }).catch(() => {
        });
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      void this.write({ jsonrpc: "2.0", id, method, params }).catch((error) => this.fail(error));
    });
  }
  notify(method, params) {
    return this.write({ jsonrpc: "2.0", method, params });
  }
  fail(reason) {
    if (this.closed) return;
    this.closed = reason instanceof Error ? reason : new Error(String(reason));
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(this.closed);
    }
    this.pending.clear();
    this.buffer = new Uint8Array(0);
  }
  get alive() {
    return !this.closed;
  }
};

// ../sdk/settings-order.ts
var SPACER_PREFIX = "@spacer:";
function parseOrder(value, allowed, allowSpacers = false) {
  if (typeof value !== "string") throw new Error("Invalid item order");
  const items = JSON.parse(value);
  if (!Array.isArray(items) || items.length > allowed.length + 24) throw new Error("Invalid item order");
  const seen = /* @__PURE__ */ new Set();
  let gaps = 0;
  for (const item of items) {
    if (typeof item !== "string" || seen.has(item)) throw new Error("Duplicate or invalid item");
    seen.add(item);
    if (!allowed.includes(item) && !(allowSpacers && item.startsWith(SPACER_PREFIX) && /^@spacer:[a-zA-Z0-9_-]{1,80}$/.test(item) && ++gaps <= 24)) throw new Error("Unknown item");
  }
  if (!allowed.every((id) => seen.has(id))) throw new Error("Order must retain all current items");
  return items;
}

// ../sdk/settings.ts
function exportSettings(ctx, getSections, onChange, options = {}) {
  const publish = (error = null) => {
    const value = { sections: getSections(), error, ...options.reset ? { resetLabel: options.reset.label } : {} };
    ctx.state.set(`${ctx.moduleId}.settings`, value);
  };
  let queue = Promise.resolve();
  ctx.events.on("settings.change", (edit) => {
    if (edit?.module !== ctx.moduleId) return;
    queue = queue.then(async () => {
      try {
        const section = getSections().find((s) => s.key === edit.section);
        const field = section?.fields.find((f) => f.key === edit.key);
        if (!field) throw new Error("Setting is no longer available");
        if (field.type === "order") parseOrder(edit.value, field.items.map((i) => i.id), field.allowSpacers);
        else if (field.type === "toggle" ? typeof edit.value !== "boolean" : typeof edit.value !== "string" || field.type === "select" && !field.options.some((o) => o.value === edit.value)) {
          throw new Error("Invalid setting value");
        }
        await onChange(section.key, field.key, edit.value);
        publish();
      } catch (e) {
        publish(e instanceof Error ? e.message : String(e));
      }
      if (options.invalidate !== false) ctx.ui.invalidate();
    });
  });
  if (options.reset) ctx.events.on("settings.reset", (event) => {
    if (event?.module !== ctx.moduleId || !options.reset) return;
    queue = queue.then(async () => {
      try {
        await options.reset.run();
        publish();
      } catch (e) {
        publish(e instanceof Error ? e.message : String(e));
      }
      if (options.invalidate !== false) ctx.ui.invalidate();
    });
  });
  publish();
  return publish;
}

// ../sdk/scoped-settings.ts
function scopesFor(ws) {
  return ws ? [`workspace:${ws.id}`, `machine:${ws.machineId}`, "user"] : ["user"];
}
function get(ctx, key, ws) {
  return ctx.modules.call("persistence", "scoped.resolve", { key, scopes: scopesFor(ws) });
}
function set(ctx, scope, key, value, expectedRev) {
  return ctx.modules.call("persistence", "scoped.set", { scope, key, value, ...expectedRev === void 0 ? {} : { expectedRev } });
}

// modules/services/language-service/src/index.ts
var languages = [];
var publishSettings = (_error) => {
};
var sessions = /* @__PURE__ */ new Map();
var paths = /* @__PURE__ */ new Map();
var selected = null;
var refreshVersion = 0;
var stopped = false;
function servers() {
  return [...new Map(languages.filter((l) => l.server).map((l) => [l.server.id, l.server])).values()];
}
function sections() {
  return servers().map((server) => ({ key: server.id, title: server.id, group: "Languages", fields: [
    {
      key: "executable",
      label: "Language server executable",
      type: "text",
      value: paths.get(server.id) || server.executable,
      description: `${selected?.location === "ssh" ? "Remote" : "Local"} executable for this workspace. Press Enter to apply. ${server.installHint}`
    }
  ] }));
}
async function dispose(ctx, session) {
  session.peer.fail("Language server stopped");
  await Promise.all(session.subscriptions.map((sub) => sub.close().catch(() => {
  })));
  await ctx.host.process.terminate(session.handle).catch(() => {
  });
  await ctx.host.resources.release(session.handle).catch(() => {
  });
}
async function stopSessions(ctx) {
  const previous = [...sessions.values()];
  sessions.clear();
  await Promise.all(previous.map((p) => p.then((s) => dispose(ctx, s)).catch(() => {
  })));
}
async function refresh(ctx) {
  const mine = ++refreshVersion;
  const next = languageDefinitions((await ctx.host.plugins.list()).plugins);
  if (mine !== refreshVersion || stopped) return;
  const changed = JSON.stringify(next) !== JSON.stringify(languages);
  languages = next;
  paths.clear();
  for (const server of servers()) {
    const setting = await get(ctx, `language-server.${server.id}.executable`, selected);
    if (mine !== refreshVersion || stopped) return;
    if (typeof setting?.value === "string" && setting.value) paths.set(server.id, setting.value);
  }
  if (changed) await stopSessions(ctx);
  publishSettings();
  ctx.events.emit("language-service.changed", {});
}
function configValue(settings, section) {
  if (!section) return settings;
  return section.split(".").reduce((value, key) => value?.[key], settings) ?? null;
}
async function start(ctx, d, server, key) {
  const executableSetting = await get(ctx, `language-server.${server.id}.executable`, d);
  const executable = typeof executableSetting?.value === "string" && executableSetting.value.trim() ? executableSetting.value.trim() : server.executable;
  const grant = await workspaceGrant(ctx, d, "process");
  let handle;
  try {
    const args = server.args.map((arg) => arg.replace(/\$WORKSPACE/g, d.rootAbsolutePath));
    handle = (await ctx.host.process.spawn(grant.grant, { target: await targetFor(ctx, d), executable, args, cwd: d.rootAbsolutePath, loginShell: d.location === "ssh" })).handle;
  } catch (error) {
    throw new Error(`${server.id} on ${d.machineId}: ${errMsg(error)}. ${server.installHint}`);
  }
  const peer = new LspPeer((frame) => ctx.host.process.write(handle, frame));
  const s = { key, workspace: d, server, handle, peer, subscriptions: [], documents: /* @__PURE__ */ new Map(), capabilities: {}, queue: Promise.resolve(), stderr: "" };
  peer.onRequest = async (method, params) => {
    if (method === "workspace/configuration") return (params?.items || []).map((item) => configValue(server.settings || {}, item.section));
    if (method === "workspace/workspaceFolders") return [{ uri: documentUri(d.rootAbsolutePath, ".hato-root").replace(/\/\.hato-root$/, ""), name: d.name }];
    if (["client/registerCapability", "client/unregisterCapability", "window/workDoneProgress/create"].includes(method)) return null;
    if (method === "workspace/applyEdit") return { applied: false, failureReason: "Workspace edits are not enabled" };
    throw Object.assign(new Error(`Unsupported server request: ${method}`), { code: -32601 });
  };
  try {
    s.subscriptions.push(await ctx.host.streams.listen(handle, { channel: "stdout", encoding: "base64" }, (chunk) => {
      try {
        peer.feed(decodeBase64(chunk));
      } catch (error) {
        peer.fail(error);
      }
    }, (error) => peer.fail(error ? errMsg(error) : `${server.id} exited. ${s.stderr.slice(-1500)}`)));
    s.subscriptions.push(await ctx.host.streams.listen(handle, { channel: "stderr" }, (chunk) => {
      s.stderr = (s.stderr + chunk).slice(-4e3);
    }));
    const rootUri = documentUri(d.rootAbsolutePath, ".hato-root").replace(/\/\.hato-root$/, "");
    const initialized = await peer.request("initialize", {
      processId: null,
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: d.name }],
      clientInfo: { name: "Hato", version: "0.1.0" },
      capabilities: {
        general: { positionEncodings: ["utf-16"] },
        workspace: { configuration: true, workspaceFolders: true },
        textDocument: { definition: { linkSupport: true }, synchronization: { dynamicRegistration: false, didSave: true } }
      },
      initializationOptions: server.initializationOptions || {}
    }, 12e4);
    s.capabilities = initialized?.capabilities || {};
    if (s.capabilities.positionEncoding && s.capabilities.positionEncoding !== "utf-16") throw new Error("Server selected an unsupported position encoding");
    await peer.notify("initialized", {});
    await peer.notify("workspace/didChangeConfiguration", { settings: server.settings || {} });
    return s;
  } catch (error) {
    await dispose(ctx, s);
    throw new Error(`${server.id}: ${errMsg(error)}. ${s.stderr.slice(-1500)} ${server.installHint}`);
  }
}
async function sessionFor(ctx, d, server) {
  const key = `${d.machineId}|${d.rootAbsolutePath}|${server.id}`;
  let pending = sessions.get(key);
  if (pending) {
    const existing = await pending;
    if (existing.peer.alive) return existing;
    sessions.delete(key);
    await dispose(ctx, existing);
    pending = void 0;
  }
  if (!pending) {
    pending = start(ctx, d, server, key);
    sessions.set(key, pending);
    pending.catch(() => {
      if (sessions.get(key) === pending) sessions.delete(key);
    });
  }
  return pending;
}
async function synchronize(s, path, text) {
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
    const change = { text };
    if (kind === 2) {
      const lines = old.text.split("\n");
      change.range = { start: { line: 0, character: 0 }, end: { line: lines.length - 1, character: lines[lines.length - 1].length } };
      change.rangeLength = old.text.length;
    }
    await s.peer.notify("textDocument/didChange", { textDocument: { uri, version: old.version + 1 }, contentChanges: [change] });
    s.documents.set(uri, { text, version: old.version + 1 });
  }
}
var mod = {
  id: "language-service",
  moduleApiVersion: 1,
  async activate(ctx) {
    stopped = false;
    selected = ctx.state.get("workspace.selected") || null;
    publishSettings = exportSettings(ctx, sections, async (section, key, value) => {
      if (key !== "executable" || typeof value !== "string" || !value.trim() || /[\r\n\0]/.test(value)) throw new Error("Enter an executable path or command name");
      if (!servers().some((s) => s.id === section)) throw new Error("Language server is no longer available");
      await set(ctx, selected ? `workspace:${selected.id}` : "user", `language-server.${section}.executable`, value.trim());
      paths.set(section, value.trim());
      await stopSessions(ctx);
    });
    await refresh(ctx);
    ctx.events.on("kernel.modules.changed", () => {
      void refresh(ctx).catch((e) => publishSettings(errMsg(e)));
    });
    ctx.state.watch("workspace.selected", (value) => {
      if (selected?.id === value?.id) return;
      selected = value || null;
      void stopSessions(ctx).then(() => refresh(ctx)).catch((e) => publishSettings(errMsg(e)));
    });
  },
  async deactivate(ctx) {
    stopped = true;
    refreshVersion++;
    await stopSessions(ctx);
  },
  methods: {
    async describe(_ctx, a) {
      return languageForPath(languages, String(a.path));
    },
    async definitions(ctx, a) {
      if (typeof a.text !== "string" || !validPosition(a.position)) throw new Error("Definition requires text and a UTF-16 position");
      const path = relativeFile(String(a.path));
      const lang = languageForPath(languages, path);
      if (!lang?.server) return [];
      const d = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
      const s = await sessionFor(ctx, d, lang.server);
      const operation = s.queue.catch(() => {
      }).then(async () => {
        const documents = (Array.isArray(a.documents) ? a.documents : []).filter((doc) => typeof doc.text === "string").map((doc) => ({ path: relativeFile(doc.path), text: doc.text }));
        const keep = /* @__PURE__ */ new Set([documentUri(d.rootAbsolutePath, path), ...documents.map((doc) => documentUri(d.rootAbsolutePath, doc.path))]);
        for (const uri of s.documents.keys()) if (!keep.has(uri)) {
          await s.peer.notify("textDocument/didClose", { textDocument: { uri } });
          s.documents.delete(uri);
        }
        for (const doc of documents) await synchronize(s, doc.path, doc.text);
        await synchronize(s, path, a.text);
        return definitionLinks(await s.peer.request("textDocument/definition", { textDocument: { uri: documentUri(d.rootAbsolutePath, path) }, position: a.position }));
      });
      s.queue = operation;
      return operation;
    }
  }
};
var index_default = mod;
export {
  index_default as default
};
