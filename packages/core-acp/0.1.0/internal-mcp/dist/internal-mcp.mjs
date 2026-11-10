// sdk/settings-order.ts
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

// sdk/settings.ts
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
        else if (field.type === "toggle" ? typeof edit.value !== "boolean" : typeof edit.value !== "string" || !field.options.some((o) => o.value === edit.value)) {
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

// sdk/runtime.ts
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
var JsonRpcPeer = class {
  constructor(send, startId = 1) {
    this.send = send;
    this.buf = "";
    this.nextId = 1;
    this.pending = /* @__PURE__ */ new Map();
    this.onRequest = async (m) => {
      throw rpcError(-32601, "Method not found: " + m);
    };
    this.onNotification = () => {
    };
    this.onProtocolError = () => {
    };
    this.nextId = startId;
  }
  get pendingCount() {
    return this.pending.size;
  }
  get nextRequestId() {
    return this.nextId;
  }
  get partial() {
    return this.buf;
  }
  restore(partial) {
    this.buf = partial;
  }
  feed(chunk) {
    this.buf += chunk;
    let i;
    while ((i = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch (e) {
        this.onProtocolError("invalid JSON", line);
        continue;
      }
      this.handle(msg, line);
    }
  }
  handle(msg, line) {
    if (msg && msg.method && msg.id !== void 0 && msg.id !== null) {
      const id = msg.id;
      this.onRequest(msg.method, msg.params, id).then(
        (result) => this.send(JSON.stringify({ jsonrpc: "2.0", id, result: result === void 0 ? null : result })),
        (err) => this.send(JSON.stringify({ jsonrpc: "2.0", id, error: { code: err && typeof err.rpcCode === "number" ? err.rpcCode : -32603, message: err && err.message || String(err), data: err && err.data } }))
      ).catch(() => {
      });
    } else if (msg && msg.method) {
      try {
        this.onNotification(msg.method, msg.params);
      } catch (e) {
        this.onProtocolError(String(e), line);
      }
    } else if (msg && (msg.result !== void 0 || msg.error !== void 0) && msg.id !== void 0) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) {
        const d = msg.error.data;
        const detail = d ? typeof d === "string" ? d : typeof d.message === "string" ? d.message : JSON.stringify(d) : "";
        const e = new Error((msg.error.message || "JSON-RPC error") + (detail && !String(msg.error.message).includes(detail) ? `: ${detail.slice(0, 600)}` : ""));
        e.rpcCode = msg.error.code;
        e.data = msg.error.data;
        p.reject(e);
      } else p.resolve(msg.result);
    } else {
      this.onProtocolError("unrecognized message", line);
    }
  }
  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.send(JSON.stringify({ jsonrpc: "2.0", id, method, params })).catch((e) => {
        this.pending.delete(id);
        reject(e);
      });
    });
  }
  notify(method, params) {
    return this.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
  }
  failAll(reason) {
    for (const [id, p] of this.pending) {
      const e = new Error(reason);
      e.code = "ECLOSED";
      p.reject(e);
      this.pending.delete(id);
    }
  }
};
function rpcError(code, message, data) {
  const e = new Error(message);
  e.rpcCode = code;
  e.data = data;
  return e;
}
function errMsg(e) {
  return e && (e.message || String(e)) || "unknown error";
}

// modules/services/internal-mcp/src/registry.ts
var McpRegistry = class {
  constructor(ctx, builtins, changed) {
    this.ctx = ctx;
    this.builtins = builtins;
    this.changed = changed;
    this.active = [];
    this.generations = /* @__PURE__ */ new Map();
    this.accepted = /* @__PURE__ */ new Map();
    this.catalog = /* @__PURE__ */ new Map();
    this.policies = {};
    this.watches = /* @__PURE__ */ new Map();
    this.pending = /* @__PURE__ */ new Map();
    this.publish = () => {
    };
    this.refreshVersion = 0;
  }
  async start() {
    const saved = await this.ctx.modules.call("persistence", "settings.get", { key: "internal-mcp.permissions" });
    if (saved && typeof saved === "object" && !Array.isArray(saved)) {
      for (const [key, value] of Object.entries(saved)) if (typeof value === "boolean") this.policies[key] = value;
    }
    this.publish = exportSettings(this.ctx, () => {
      const groups = /* @__PURE__ */ new Map();
      for (const tool of this.catalog.values()) {
        const group = groups.get(tool.owner) || [];
        group.push(tool);
        groups.set(tool.owner, group);
      }
      return [...groups].map(([owner, tools]) => ({
        key: `mcp:${owner}`,
        title: tools[0].category,
        description: "Allow or deny individual internal MCP commands. New module commands start denied. Existing native capability checks still apply.",
        fields: tools.map((tool) => ({
          key: tool.name,
          label: tool.title || tool.localName,
          description: tool.description,
          type: "toggle",
          value: this.allowed(tool.name)
        }))
      }));
    }, async (_section, name, value) => {
      if (!this.catalog.has(name) || typeof value !== "boolean") throw new Error("Invalid MCP permission");
      const tool = this.catalog.get(name);
      const next = { ...this.policies, [JSON.stringify([tool.owner, tool.localName])]: value };
      await this.ctx.modules.call("persistence", "settings.set", { key: "internal-mcp.permissions", value: next });
      this.policies = next;
      this.changed();
    }, { invalidate: false });
    this.ctx.events.on("kernel.modules.changed", () => {
      void this.refresh().catch((e) => this.ctx.log.warn("MCP discovery", errMsg(e)));
    });
    await this.refresh();
  }
  async refresh() {
    const version = ++this.refreshVersion;
    const modules = await this.ctx.host.modules.list();
    if (version !== this.refreshVersion) return;
    this.active = modules.filter((module) => module.active && module.id !== this.ctx.moduleId).map((module) => module.id).sort();
    this.generations = new Map(modules.filter((module) => module.active).map((module) => [module.id, module.active.generation]));
    for (const [id, stops] of this.watches) if (!this.active.includes(id)) {
      stops.forEach((stop) => stop());
      this.watches.delete(id);
    }
    for (const id of this.active) if (!this.watches.has(id)) this.watches.set(id, [
      this.ctx.state.watch(`${id}.mcp`, () => this.rebuild()),
      this.ctx.events.on(`${id}.mcp.result`, (reply) => {
        const waiting = this.pending.get(reply?.id);
        if (!waiting || waiting.owner !== id || waiting.generation !== reply.generation) return;
        clearTimeout(waiting.timer);
        this.pending.delete(reply.id);
        if (typeof reply.error === "string") waiting.reject(new Error(reply.error));
        else waiting.resolve(reply.result);
      })
    ]);
    this.rebuild();
  }
  rebuild() {
    const next = /* @__PURE__ */ new Map();
    for (const tool of this.builtins) next.set(tool.name, { ...tool, owner: "internal-mcp", localName: tool.name, category: "Module tools MCP" });
    for (const owner of this.active) {
      const published = this.ctx.state.get(`${owner}.mcp`);
      if (Array.isArray(published?.tools) && published.generation === this.generations.get(owner)) this.accepted.set(owner, published);
      const contribution = this.accepted.get(owner);
      if (!Array.isArray(contribution?.tools) || contribution.generation !== this.generations.get(owner)) continue;
      for (const tool of contribution.tools) {
        if (!tool || typeof tool.name !== "string" || !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(tool.name) || typeof tool.description !== "string" || tool.inputSchema?.type !== "object") continue;
        const name = `${owner}__${tool.name}`;
        if (name.length > 128 || next.has(name)) {
          this.ctx.log.warn("MCP command name collision or excessive length", name);
          continue;
        }
        next.set(name, {
          name,
          generation: contribution.generation,
          localName: tool.name,
          owner,
          category: `${typeof contribution.title === "string" ? contribution.title : owner} MCP`,
          title: typeof tool.title === "string" ? tool.title : tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
          timeoutMs: tool.timeoutMs
        });
      }
    }
    this.catalog = next;
    this.publish();
    this.changed();
  }
  allowed(name) {
    const tool = this.catalog.get(name);
    if (!tool) return false;
    const key = JSON.stringify([tool.owner, tool.localName]);
    return Object.prototype.hasOwnProperty.call(this.policies, key) ? this.policies[key] : tool.owner === "internal-mcp";
  }
  assertAllowed(name) {
    if (!this.allowed(name)) throw new Error(`MCP command is denied or unavailable: ${name}. Enable it in Settings.`);
  }
  list() {
    return [...this.catalog.values()].filter((tool) => this.allowed(tool.name)).map(({ owner: _owner, localName: _localName, category: _category, timeoutMs: _timeout, generation: _generation, ...tool }) => tool);
  }
  call(name, args, scope) {
    this.assertAllowed(name);
    const tool = this.catalog.get(name);
    if (tool.owner === "internal-mcp") throw new Error("Built-in command uses the core MCP dispatcher");
    const id = crypto.randomHex(16);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Module MCP command timed out"));
      }, Math.max(1e3, Math.min(18e4, Number(tool.timeoutMs) || 3e4)));
      this.pending.set(id, { owner: tool.owner, generation: tool.generation, resolve, reject, timer });
      try {
        this.ctx.events.emit("internal-mcp.call", { id, module: tool.owner, generation: tool.generation, tool: tool.localName, args, scope });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  stop() {
    this.watches.forEach((stops) => stops.forEach((stop) => stop()));
    this.watches.clear();
    this.pending.forEach((waiting) => {
      clearTimeout(waiting.timer);
      waiting.reject(new Error("MCP registry closed"));
    });
    this.pending.clear();
  }
};

// modules/services/internal-mcp/skills/self-configure.md
var self_configure_default = "---\nname: self-configure\nversion: 1\ndescription: Choose the correct Hato runtime, update modules or install plugins, and verify or recover the live app.\n---\n# Self-configure Hato\n\nUse this guide when changing Hato itself. It does not authorize unrelated changes or bypass native approvals.\n\n## Find the live runtime first\n\nCall `modules_list`, then `modules_describe` for the target. Its `runtime` reports exact `repoRoot`,\n`modulesRoot`, `buildTool`, `pluginsDir`, `artifactsDir` and `dataDir`. Older module-dev versions may omit\n`runtime`; use `modules_read_source` for the running module rather than guessing a source directory.\nDo not assume the current workspace checkout is the source tree used by the app.\n\n- The macOS `.app` contains the native executable, compiler, remote binaries and initial module seeds.\n- A packaged launcher copies sources and seeds once per release to a writable runtime, normally\n  `~/Library/Application Support/Hato/runtimes/<release>/`. Edit that runtime through module tools.\n  Do not patch signed `.app/Contents` files. A development launch can instead use a checkout.\n- Saved builds live in `<dataDir>/artifacts`; the active selection is recorded in the module registry.\n  Module `@NNNN` numbers are saved builds, not release versions. Startup retains the selection while\n  the supplied seed hash is unchanged; a changed seed on a new release can replace it.\n- User plugins live in `<dataDir>/plugins/<id>`. Workflow definitions and script commands belong to\n  workflow-runner on the workspace daemon, normally under `~/.hato/data/sqlite/` locally or remotely.\n  Changing the desktop does not automatically replace already-running daemon code.\n\n## Choose the smallest update\n\nKeep behavior, defaults, layout and labels in TypeScript modules. Read manifests, SDK contracts and\ncallers before changing them. A missing native primitive, capability enforcement, trusted approvals,\nor the native process runner needs a native build and relaunch; module activation cannot apply Rust.\n\nFor an existing module:\n1. Read `inspect-module` and `patch-module`; inspect the active source, preserve unrelated edits and\n   snapshot/workspace state, then apply the authorized change.\n2. Read `build-and-test-module`; typecheck and run relevant checks when checkout tools are available.\n   Call `modules_build`: this compiles and stages an artifact, without changing the active app.\n3. Read `activate-and-verify`; call `modules_activate` with the returned stageId, inspect versions and\n   logs, and verify the actual changed behavior. Report built, staged, activated, or restart required.\n\nShared SDK helpers are bundled into consumers: rebuild and activate every affected consumer.\nMaintenance patch tools only write inside an existing module; they cannot edit SDK files, grants,\nRust, or arbitrary new module IDs. Use the authorized development checkout for those changes and\naccount for the live runtime separately. Do not claim a local seed build activates a packaged app.\n\n## New plugins and JavaScript\n\nA plain `.js` file is not a complete Hato plugin. Prepare a folder named after its unique module ID,\nwith `manifest.json` and a runnable entry. Supply `dist/<id>.mjs`, `dist/index.mjs`, or a JavaScript\n`.js`/`.mjs` manifest entry. The default export must declare `moduleApiVersion: 1` and implement an\nAppModule. Bundle TypeScript and external imports beforehand; installation is not an npm install.\nThe embedded JS runtime has no Node or browser globals: use the Hato SDK/host capabilities.\n\nInstall the folder through Settings → Plugins, then enable it and approve its declared permissions.\nExisting module-maintenance MCP tools do not install new plugins or grant capabilities. Tell the user\nwhich concrete installation step remains if current tools cannot perform it. New built-ins also need\ncompiled first-party install bounds and a native rebuild; prefer user plugins for ordinary extensions.\n\n## Recovery and failed updates\n\nThe Modules selector uses saved artifacts: Bundled is the imported seed for that runtime (a development\nseed in checkout mode); Updated is the latest custom build that activated successfully, not merely staged.\nIt does not erase source edits or rebuild anything. The Modules panel itself stays updated so the\nselector remains available. `modules_rollback {id,toVersion}` can explicitly select a known saved build;\nverify version/origin/status with describe first. Do not label the first or an arbitrary previous build\nas the bundled release. On old kernels without seedVersion, seed-origin history is only a fallback.\n\nA failed compile is not evidence that the active module stopped. Preserve the working generation,\ninspect the full diagnostics, fix the cause and retry only when something changed. In older native\nbuilds, compiler output above the 4 MB stream buffer can deadlock and time out; that needs the native\nprocess-runner fix and a rebuilt app, not repeated builds or shorter approval prompts.\n\nNative approvals remain required for source writes, staging and cutover. Stop on denial and report it.\nDo not replace a daemon with live agents/workflows to force an upgrade. Report any pending daemon\nupgrade separately from desktop activation, and do not start real workflows just to verify UI changes.\n\nFor an internal-mcp self-update over its own connection, build/stage first and activate from the\nModules panel when no MCP call is in flight. The server deliberately refuses to replace itself\nmid-call. Keep that guard; report staged rather than active until the UI cutover is verified.\n";

// modules/services/internal-mcp/skills/inspect-module.md
var inspect_module_default = "---\nname: inspect-module\nversion: 2\ndescription: Inspect a Hato application module before changing it.\n---\n# Inspect a Hato module\n\n1. Call `modules_list` to see every module, its active version (`id@NNNN`), kind (`service` or `ui`) and errors.\n2. Call `modules_describe` with the module id: manifest, capabilities, source directory, recent logs.\n3. Call `modules_read_source` with only `id` to list files, then again with `path` to read a file.\n\nUI modules export `render(ctx)` returning a keyed UI tree (`row`, `column`, `label`, `button`, `tree`, …) and\n`onEvent(ctx, event)` handling `event.action`. Services export `methods`. Modules never import each other at\nruntime; they call `ctx.modules.call(id, method, args)`.\n\nRead `self-configure` for packaged launches and storage. `modules_describe.runtime` identifies the\nactual editable source tree, compiler and data folders; a workspace checkout can be a different copy.\nInspect saved build origins/status and `seedVersion` before choosing a recovery build.\n";

// modules/services/internal-mcp/skills/patch-module.md
var patch_module_default = "---\nname: patch-module\nversion: 2\ndescription: Propose and apply a change to a module's TypeScript source.\n---\n# Patch a module\n\n- Use `modules_apply_patch` with `id` and either a unified diff in `patch` (paths relative to the module,\n  e.g. `src/index.ts`), or `edits: [{path, oldText, newText}]` where `oldText` occurs exactly once.\n- Only files inside `modules/<kind>/<id>/` can be changed. Everything else is denied by the kernel.\n- The user sees a kernel-computed diff in a native approval dialog and must approve every write,\n  even with Autopilot enabled. A denial returns an error: do not retry silently; explain.\n- Keep keys stable in UI trees so native controls keep their state.\n\nPatch the runtime returned by describe, using module-relative paths. A packaged app's editable copy\nis normally outside the workspace checkout; do not patch signed bundle files. These tools cannot\ncreate a new module ID or edit SDK/Rust/grants. For a new plugin, follow `self-configure` and install\nits prepared folder through Settings → Plugins. Keep shared SDK changes and native work in an\nauthorized checkout, then deliver them to the actual runtime through the appropriate build path.\n";

// modules/services/internal-mcp/skills/build-and-test-module.md
var build_and_test_module_default = "---\nname: build-and-test-module\nversion: 2\ndescription: Build a module into a new versioned artifact and stage it.\n---\n# Build and stage\n\nCall `modules_build` with `id`. The source is bundled with esbuild into a new artifact version\n(never overwriting the active one) and evaluated in an isolated runtime. On failure the result contains\ncompiler diagnostics in `diagnostics`; fix the source and build again. Staging requires native approval.\nThe result's `stageId` is used by `modules_activate`.\n\nUse the compiler and source tree from `modules_describe.runtime`; packaged builds do not require a\nsystem Node installation for esbuild. A checkout `npm run modules:build` writes seeds only; it does\nnot activate a packaged runtime. Shared SDK edits require rebuilding every affected consumer.\nRun relevant checks before cutover. Keep the active version on build failure and show the full error.\nA repeated large-output timeout on an older native runner needs a rebuilt app; see `self-configure`.\n";

// modules/services/internal-mcp/skills/activate-and-verify.md
var activate_and_verify_default = "---\nname: activate-and-verify\nversion: 2\ndescription: Hot-swap a staged module generation and verify it.\n---\n# Activate and verify\n\nCall `modules_activate` with `id` (and optionally `stageId`; defaults to the last build). The kernel fences\nthe module, snapshots its state, activates the new generation, runs a health check (UI modules must render)\nand switches routing atomically. Failure keeps the previous version active. Afterwards call `modules_list`\nand `modules_logs` to verify. Terminals, agent processes and data are preserved. Native approval required.\n\nVerify the returned active build against the stage you built, then check the actual UI/service behavior.\nDo not call a change live merely because it compiled. Report desktop activation separately from\nworkspace-daemon activation: long-lived agents/workflows may still use their existing daemon runtime.\nPreserve active work and defer daemon replacement when busy. Updating this MCP service or its bundled\nskill Markdown requires rebuilding and activating internal-mcp; clients may need to reconnect to\nrefresh advertised tools/instructions. When using internal-mcp to update internal-mcp itself,\nits own activation call counts as an in-flight MCP call and canSwap defers the swap. Build/stage\nthrough MCP, then activate from the Modules panel after the tool call ends; verify after reconnecting.\nDo not remove the in-flight guard to force a self-swap. Rust/native changes require a rebuilt app and relaunch.\n";

// modules/services/internal-mcp/skills/rollback-module.md
var rollback_module_default = "---\nname: rollback-module\nversion: 2\ndescription: Roll a module back to its previous healthy version.\n---\n# Roll back\n\nCall `modules_rollback` with `id` (optionally `toVersion`). The previous artifact is integrity-checked\n(SHA-256) and swapped in with the same protocol as activation. Native approval required.\n\nFor Bundled/Updated selection, inspect `seedVersion` and saved build origins/status using describe.\nBundled is the runtime's imported seed; Updated is the latest successfully activated custom build.\nStaged/untested or failed artifacts are not known-good recovery targets. Switching artifacts preserves\nlocal source files, so a reverted module can still show local differences in the Modules panel.\nSelecting an older build does not remove newer saved artifacts: use an explicit toVersion to return.\nAvoid rolling back the Modules panel itself when the user needs its Bundled/Updated controls.\n";

// modules/services/internal-mcp/src/index.ts
var SERVER_VERSION = "1.0.0";
var PROXY_VERSION = "v1";
var SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
var SKILLS = { "self-configure": self_configure_default, "inspect-module": inspect_module_default, "patch-module": patch_module_default, "build-and-test-module": build_and_test_module_default, "activate-and-verify": activate_and_verify_default, "rollback-module": rollback_module_default };
var PROXY_SOURCE = `#!/usr/bin/env node
// hato-mcp-proxy ${PROXY_VERSION}: forwards newline-delimited MCP JSON-RPC between stdio and a loopback
// socket. Contains no application logic. Env: HATO_MCP_PORT, HATO_MCP_TOKEN.
import net from "node:net";
const port = Number(process.env.HATO_MCP_PORT);
const token = process.env.HATO_MCP_TOKEN || "";
if (!port || !token) { process.stderr.write("hato-mcp-proxy: HATO_MCP_PORT/HATO_MCP_TOKEN missing\\n"); process.exit(2); }
const s = net.connect({ host: "127.0.0.1", port }, () => {
  s.write(JSON.stringify({ hatoAuth: token }) + "\\n");
  process.stdin.pipe(s);
});
s.pipe(process.stdout);
s.on("error", (e) => { process.stderr.write("hato-mcp-proxy: " + e.message + "\\n"); process.exit(1); });
s.on("close", () => process.exit(0));
process.stdin.on("end", () => s.end());
`;
var registry;
var listener = null;
var tokens = /* @__PURE__ */ new Map();
var connsByHandle = /* @__PURE__ */ new Map();
var forwards = /* @__PURE__ */ new Map();
var localProxyPath = null;
var stats = { connections: 0, toolCalls: 0, authFailures: 0 };
var TOOLS = [
  { name: "modules_list", title: "modules.list", description: "List Hato application modules, active builds, imported seed (bundled baseline), saved build origins and health. Local module build numbers are not app release versions.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: "modules_describe", title: "modules.describe", description: "Describe one module: static manifest, capabilities, dependencies, source directory, exact runtime/build-tool/storage paths, saved versions and their origins, diagnostics, last build. Inspect before editing; the running app may use a different source tree from the workspace checkout.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] }, annotations: { readOnlyHint: true } },
  { name: "modules_read_source", title: "modules.read_source", description: "Read allowlisted module source. Without `path` lists files; with `path` (module-relative, e.g. src/index.ts) returns its text.", inputSchema: { type: "object", properties: { id: { type: "string" }, path: { type: "string" } }, required: ["id"] }, annotations: { readOnlyHint: true } },
  { name: "modules_apply_patch", title: "modules.apply_patch", description: "Apply a change to a module's source (unified diff in `patch`, or `edits` [{path, oldText, newText}], or `path`+`content`). Requires explicit native user approval of the exact diff; a backup is kept.", inputSchema: { type: "object", properties: { id: { type: "string" }, patch: { type: "string" }, edits: { type: "array", items: { type: "object", properties: { path: { type: "string" }, oldText: { type: "string" }, newText: { type: "string" } }, required: ["path", "oldText", "newText"] } }, path: { type: "string" }, content: { type: "string" }, reason: { type: "string" } }, required: ["id"] }, annotations: { destructiveHint: true } },
  { name: "modules_build", title: "modules.build", description: "Build a module with esbuild into a new versioned artifact and stage it (isolated evaluation, not active). Returns compiler diagnostics on failure. Requires native approval.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "modules_activate", title: "modules.activate", description: "Hot-swap the staged build of a module (fence, snapshot, activate, health check, cutover). Previous version kept for rollback. Requires native approval.", inputSchema: { type: "object", properties: { id: { type: "string" }, stageId: { type: "string" } }, required: ["id"] } },
  { name: "modules_rollback", title: "modules.rollback", description: "Switch a module back to its previous healthy version (or `toVersion`). Requires native approval.", inputSchema: { type: "object", properties: { id: { type: "string" }, toVersion: { type: "integer" } }, required: ["id"] } },
  { name: "modules_logs", title: "modules.logs", description: "Bounded, redacted logs for one module.", inputSchema: { type: "object", properties: { id: { type: "string" }, limit: { type: "integer" } }, required: ["id"] }, annotations: { readOnlyHint: true } },
  { name: "skills_get", title: "skills.get", description: `Return a Hato skill guide (Markdown). Available: ${Object.keys(SKILLS).join(", ")}.`, inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] }, annotations: { readOnlyHint: true } }
];
async function callTool(ctx, conn, name, args) {
  const info = tokens.get(conn.token);
  if (!info) throw new Error("MCP session was revoked");
  if (info.desktopOnly && name.startsWith("terminals__")) throw new Error("Terminal tools are provided by internal-remote-mcp");
  registry.assertAllowed(name);
  ctx.log.info(`tool ${name} from conversation ${info?.conversationId} (${info?.machineId})`);
  stats.toolCalls++;
  const md = (m, a) => ctx.modules.call("module-dev", m, a, { timeoutMs: 30 * 60 * 1e3 });
  const id = args && args.id !== void 0 ? String(args.id) : void 0;
  switch (name) {
    case "modules_list": {
      const all = await md("list", {});
      return all.map((m) => ({ id: m.id, kind: m.kind, active: m.active ? m.active.label : null, seedVersion: m.seedVersion ?? null, savedBuilds: m.versions.map((v) => ({ version: v.version, origin: v.origin, status: v.status })), previous: m.previous, lastError: m.lastError, versions: m.versions.map((v) => `${v.version}:${v.status}`) }));
    }
    case "modules_describe":
      return md("describe", { id });
    case "modules_read_source":
      return md("readSource", { id, path: args.path });
    case "modules_apply_patch":
      return md("applyPatch", { id, patch: args.patch, edits: args.edits, path: args.path, content: args.content, reason: args.reason || `requested by agent in conversation ${info?.conversationId}` });
    case "modules_build":
      return md("build", { id });
    case "modules_activate":
      return md("activate", { id, stageId: args.stageId });
    case "modules_rollback":
      return md("rollback", { id, toVersion: args.toVersion });
    case "modules_logs":
      return md("logs", { id, limit: args.limit || 100 });
    case "skills_get": {
      const s = SKILLS[String(args.name)];
      if (!s) throw new Error(`unknown skill ${args.name}`);
      return s;
    }
    default:
      return registry.call(name, args, { conversationId: info.conversationId, workspaceId: info.workspaceId, machineId: info.machineId });
  }
}
function makePeer(ctx, conn) {
  const peer = new JsonRpcPeer((line) => ctx.host.net.write(conn.handle, line + "\n"));
  peer.onRequest = async (method, params) => {
    switch (method) {
      case "initialize": {
        conn.client = params && params.clientInfo;
        const v = params && SUPPORTED_PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : SUPPORTED_PROTOCOLS[0];
        return {
          protocolVersion: v,
          capabilities: { tools: { listChanged: true }, prompts: { listChanged: false }, resources: { listChanged: false } },
          serverInfo: { name: "hato-internal", title: "Hato internal modules", version: SERVER_VERSION },
          instructions: "Module-contributed commands are workspace-bound and individually controlled in Settings. Module maintenance tools inspect and evolve hot-swappable TypeScript modules: read skills_get self-configure first, then the task-specific skill. Describe the target module to discover the running runtime paths; workspace checkout edits may not affect a packaged app. Patch → build/stage → activate → verify; a build alone is not live. Bundled/Updated selects saved JavaScript builds, not native app releases. New plugins install through Settings → Plugins from a manifest and runnable JavaScript; maintenance patch tools only edit existing module source. Native changes need a rebuilt app and relaunch. Never replace a daemon that has active work. Module maintenance mutations require native user approval; contributed commands retain their provider module's existing capability checks."
        };
      }
      case "ping":
        return {};
      case "tools/list":
        return { tools: registry.list().filter((t) => !tokens.get(conn.token)?.desktopOnly || !t.name.startsWith("terminals__")) };
      case "tools/call": {
        conn.inflight++;
        try {
          const r = await callTool(ctx, conn, params.name, params.arguments || {});
          return { content: [{ type: "text", text: typeof r === "string" ? r : JSON.stringify(r, null, 2) }], structuredContent: typeof r === "object" && r !== null && !Array.isArray(r) ? r : void 0, isError: !!(r && typeof r === "object" && r.ok === false) };
        } catch (e) {
          if (e && e.rpcCode) throw e;
          return { content: [{ type: "text", text: `Error${e && e.code ? " " + e.code : ""}: ${errMsg(e)}` }], isError: true };
        } finally {
          conn.inflight--;
        }
      }
      case "prompts/list":
        return { prompts: Object.keys(SKILLS).map((n) => ({ name: n, description: (/description: (.*)/.exec(SKILLS[n]) || [])[1] || n })) };
      case "prompts/get": {
        const s = SKILLS[params && params.name];
        if (!s) throw rpcError(-32602, "unknown prompt");
        return { description: params.name, messages: [{ role: "user", content: { type: "text", text: s } }] };
      }
      case "resources/list":
        return { resources: Object.keys(SKILLS).map((n) => ({ uri: `hato://skills/${n}`, name: n, mimeType: "text/markdown" })) };
      case "resources/read": {
        const n = String(params && params.uri || "").replace("hato://skills/", "");
        if (!SKILLS[n]) throw rpcError(-32602, "unknown resource");
        return { contents: [{ uri: params.uri, mimeType: "text/markdown", text: SKILLS[n] }] };
      }
      default:
        throw rpcError(-32601, `method not found: ${method}`);
    }
  };
  peer.onNotification = () => {
  };
  return peer;
}
async function onConnection(ctx, handle, restored) {
  const conn = { handle, token: null, buf: "", peer: null, inflight: 0, client: null, ...restored || {} };
  connsByHandle.set(handle, conn);
  if (conn.token) conn.peer = makePeer(ctx, conn);
  stats.connections++;
  await ctx.host.streams.listen(handle, { encoding: "utf8" }, (chunk) => {
    if (conn.peer) {
      conn.peer.feed(chunk);
      return;
    }
    conn.buf += chunk;
    const i = conn.buf.indexOf("\n");
    if (i < 0) {
      if (conn.buf.length > 4096) ctx.host.net.close(handle).catch(() => {
      });
      return;
    }
    const first = conn.buf.slice(0, i);
    const rest = conn.buf.slice(i + 1);
    conn.buf = "";
    let tok = null;
    try {
      tok = JSON.parse(first).hatoAuth;
    } catch {
      tok = null;
    }
    if (!tok || !tokens.has(tok)) {
      stats.authFailures++;
      ctx.log.warn("rejected unauthenticated MCP connection");
      ctx.host.net.write(handle, JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "unauthorized" } }) + "\n").finally(() => ctx.host.net.close(handle).catch(() => {
      }));
      return;
    }
    conn.token = tok;
    conn.peer = makePeer(ctx, conn);
    if (rest) conn.peer.feed(rest);
  }, () => {
    connsByHandle.delete(handle);
    ctx.host.net.close(handle).catch(() => {
    });
  });
}
async function ensureListener(ctx) {
  if (listener) return listener;
  listener = await ctx.host.net.listenLoopback();
  await listenAccepts(ctx);
  return listener;
}
async function listenAccepts(ctx) {
  let pending = "";
  await ctx.host.streams.listen(listener.handle, { encoding: "utf8" }, (chunk) => {
    pending += chunk;
    let i;
    while ((i = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, i);
      pending = pending.slice(i + 1);
      try {
        const ev = JSON.parse(line);
        if (ev.connection) onConnection(ctx, ev.connection);
      } catch (e) {
        ctx.log.warn("bad accept event", errMsg(e));
      }
    }
  });
}
async function deployLocalProxy(ctx) {
  if (localProxyPath) return localProxyPath;
  const shared = ctx.host.env.info().sharedDir;
  const g = await ctx.host.capabilities.request({ kind: "fs", root: shared, write: true });
  await ctx.host.fs.mkdir(g.grant, "mcp-proxy");
  const rel = `mcp-proxy/hato-mcp-proxy-${PROXY_VERSION}.mjs`;
  const w = await ctx.host.fs.writeAtomic(g.grant, rel, PROXY_SOURCE, { mode: 493 });
  localProxyPath = w.path;
  return localProxyPath;
}
async function remoteBridge(ctx, desc) {
  const existing = forwards.get(desc.machineId);
  if (existing) return existing;
  const c = await sshConnect(ctx, desc);
  if (!c.home) throw new Error("cannot determine remote home directory for proxy deployment");
  const dir = `${c.home.replace(/\/+$/, "")}/.local/state/hato/bin`;
  const g = await ctx.host.capabilities.request({ kind: "fs", root: c.home, write: true, target: { kind: "ssh", connection: c.connection, machineId: c.machineId }, purpose: `Deploy the Hato MCP stdio proxy (${PROXY_VERSION}, forwards bytes only) to ${dir}` });
  await ctx.host.fs.mkdir(g.grant, ".local/state/hato/bin");
  const rel = `.local/state/hato/bin/hato-mcp-proxy-${PROXY_VERSION}.mjs`;
  let needWrite = true;
  try {
    const cur = await ctx.host.fs.read(g.grant, rel, 64 * 1024);
    needWrite = cur.text !== PROXY_SOURCE;
  } catch {
    needWrite = true;
  }
  if (needWrite) await ctx.host.fs.writeAtomic(g.grant, rel, PROXY_SOURCE, { mode: 493 });
  await ctx.host.capabilities.release(g.grant).catch(() => {
  });
  const l = await ensureListener(ctx);
  const f = await ctx.host.ssh.forwardLoopback(c.connection, { listener: l.handle });
  const entry = { handle: f.handle, remotePort: f.remotePort, proxyPath: `${dir}/hato-mcp-proxy-${PROXY_VERSION}.mjs` };
  forwards.set(desc.machineId, entry);
  return entry;
}
var mod = {
  id: "internal-mcp",
  moduleApiVersion: 1,
  async activate(ctx, prev) {
    registry = new McpRegistry(ctx, TOOLS, () => {
      for (const conn of connsByHandle.values()) if (conn.peer) conn.peer.notify("notifications/tools/list_changed").catch(() => {
      });
    });
    await registry.start();
    if (prev && prev.listener) {
      listener = prev.listener;
      for (const [k, v] of prev.tokens || []) tokens.set(k, v);
      for (const [k, v] of prev.forwards || []) forwards.set(k, v);
      localProxyPath = prev.localProxyPath || null;
      stats = prev.stats || stats;
      await listenAccepts(ctx);
      for (const c of prev.conns || []) await onConnection(ctx, c.handle, { token: c.token, client: c.client });
      ctx.log.info(`internal MCP re-attached: port ${listener.port}, ${tokens.size} token(s), ${(prev.conns || []).length} connection(s)`);
    } else {
      await ensureListener(ctx);
      ctx.log.info(`internal MCP listening on 127.0.0.1:${listener.port} (token-authenticated)`);
    }
  },
  deactivate() {
    registry.stop();
  },
  canSwap() {
    for (const c of connsByHandle.values()) if (c.inflight > 0) return { ok: false, reason: "an MCP tool call is in flight" };
    return { ok: true };
  },
  snapshot: () => ({ listener, tokens: Array.from(tokens.entries()), forwards: Array.from(forwards.entries()), localProxyPath, stats, conns: Array.from(connsByHandle.values()).filter((c) => c.token).map((c) => ({ handle: c.handle, token: c.token, client: c.client })) }),
  methods: {
    /** MCP server config (ACP `mcpServers` stdio entry) for one conversation on its workspace machine. */
    async endpoint(ctx, a) {
      const desc = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
      for (const [t, info] of tokens) if (info.conversationId === a.conversationId) tokens.delete(t);
      const token = crypto.randomHex(32);
      tokens.set(token, { conversationId: a.conversationId, workspaceId: desc.id, machineId: desc.machineId, created: Date.now(), desktopOnly: a.desktopOnly === true });
      const l = await ensureListener(ctx);
      if (desc.location === "local") {
        const proxy = await deployLocalProxy(ctx);
        return { transport: "local loopback", server: { name: "hato-internal", command: "node", args: [proxy], env: [{ name: "HATO_MCP_PORT", value: String(l.port) }, { name: "HATO_MCP_TOKEN", value: token }] } };
      }
      const f = await remoteBridge(ctx, desc);
      return { transport: `SSH reverse forward ${desc.machineId} 127.0.0.1:${f.remotePort} -> local 127.0.0.1:${l.port}`, server: { name: "hato-internal", command: "node", args: [f.proxyPath], env: [{ name: "HATO_MCP_PORT", value: String(f.remotePort) }, { name: "HATO_MCP_TOKEN", value: token }] } };
    },
    /** Revoke a conversation's token, close its connections, and drop unused forwards. */
    async revoke(ctx, a) {
      let machine = null;
      for (const [t, info] of tokens) if (info.conversationId === a.conversationId) {
        machine = info.machineId;
        tokens.delete(t);
        for (const c of connsByHandle.values()) if (c.token === t) ctx.host.net.close(c.handle).catch(() => {
        });
      }
      if (machine && machine !== "local" && ![...tokens.values()].some((i) => i.machineId === machine)) {
        const f = forwards.get(machine);
        if (f) {
          await ctx.host.ssh.cancelForward(f.handle).catch(() => {
          });
          forwards.delete(machine);
        }
      }
      return null;
    },
    status: () => ({ port: listener ? listener.port : null, tokens: tokens.size, connections: connsByHandle.size, forwards: Array.from(forwards.entries()).map(([m, f]) => ({ machineId: m, remotePort: f.remotePort })), stats, tools: registry.list().map((t) => t.name), skills: Object.keys(SKILLS) })
  }
};
var index_default = mod;
export {
  PROXY_SOURCE,
  index_default as default
};
