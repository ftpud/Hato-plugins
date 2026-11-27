import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { build } from "esbuild";

const sdk = fileURLToPath(new URL("../../sdk", import.meta.url));
// Trigger helpers only use runScript to create FIFOs; tests do not reach it.
const stubProcs = { name: "stub-procs", setup(b) {
  b.onResolve({ filter: /^\.\/procs$/ }, () => ({ path: "procs", namespace: "stub" }));
  b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export const runScript = async (...a) => globalThis.runScriptStub ? globalThis.runScriptStub(...a) : ({ code: 1, stdout: '', stderr: 'stub' }); export const createWindowsFile = async () => ({ code: 1, stdout: '', stderr: 'stub' });", loader: "js" }));
} };
const load = async (path, plugins = []) => import("data:text/javascript;base64," + Buffer.from((await build({ entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true, format: "esm", write: false, alias: { "@hato/sdk": sdk }, plugins })).outputFiles[0].text).toString("base64"));
const triggers = await load("../modules/services/workflow-runner/src/triggers.ts", [stubProcs]);
const wf = await load("../../sdk/workflows.ts");

/** Loopback net host backed by real sockets: listener streams emit `{"connection": handle}` lines. */
function fakeCtx(fsOverrides = {}) {
  const handles = new Map(); let n = 0;
  const id = (v) => { const h = `h${++n}`; handles.set(h, v); return h; };
  return { host: {
    net: {
      listenLoopback: ({ port = 0 } = {}) => new Promise((resolve, reject) => {
        const entry = { server: null, onConn: null };
        entry.server = net.createServer(sock => { const h = id({ sock }); entry.onConn?.(JSON.stringify({ connection: h }) + "\n"); });
        entry.server.once("error", e => reject(Object.assign(new Error(`${e.code}: ${e.message}`), { code: e.code })));
        entry.server.listen(port, "127.0.0.1", () => resolve({ handle: id(entry), port: entry.server.address().port }));
      }),
      write: async (h, text) => { handles.get(h)?.sock?.write(text); },
      close: async (h) => { const e = handles.get(h); handles.delete(h); e?.sock?.end(); e?.server?.close(); },
    },
    streams: {
      listen: async (h, _opts, onData, onEnd) => {
        const e = handles.get(h);
        if (e?.server) e.onConn = onData;
        if (e?.sock) { e.sock.setEncoding("utf8"); e.sock.on("data", onData); e.sock.on("end", () => onEnd?.(null)); }
        return { subId: h, close: async () => {} };
      },
    },
    capabilities: { request: async () => ({ grant: "g" }), release: async () => {} },
    fs: { stat: async () => { throw new Error("ENOENT: no such file"); }, read: async () => ({ text: "" }), ...fsOverrides },
    resources: { release: async () => {} },
  } };
}
const exec = () => ({ run: { id: "run1", status: "running" }, env: { root: "/tmp/ws" }, outputs: new Map(), triggers: new Map(), triggerWaiters: new Map(), cancelled: false });
const httpRequest = (port, raw) => new Promise((resolve, reject) => {
  const s = net.connect(port, "127.0.0.1", () => s.write(raw)); let out = "";
  s.setEncoding("utf8"); s.on("data", d => out += d); s.on("end", () => resolve(out)); s.on("error", reject);
});

test("trigger blocks normalize from nested or flat fields and validate endpoints", () => {
  const def = wf.normalizeDefinition({ id: "w", name: "W", blocks: [
    { id: "h", type: "http_trigger", label: "H", trigger: { port: 8123, path: "/hook", method: "post", status_code: 202 } },
    { id: "s", type: "socket_trigger", label: "S", protocol: "unix", path: "run/x.sock" },
    { id: "f", type: "file_pipe_trigger", label: "F", trigger: { path: "../escape" } },
    { id: "bad", type: "http_trigger", label: "Bad", trigger: { port: 80 } },
  ], edges: [] });
  assert.deepEqual(def.blocks[0].trigger, { port: 8123, path: "/hook", method: "POST", statusCode: 202 });
  assert.equal(def.blocks[1].trigger.protocol, "unix");
  assert.equal(def.blocks[2].type, "file_trigger");
  const issues = wf.validateWorkflow(def).filter(i => i.code === "invalid-trigger").map(i => i.blockId);
  assert.deepEqual(issues.sort(), ["bad", "f"]);
});

test("HTTP trigger fires on a matching authorized request and rejects others", async () => {
  const ctx = fakeCtx(), events = [];
  const b = { id: "h", type: "http_trigger", label: "Hook", prompt: "", position: { x: 0, y: 0 }, trigger: { port: 0, path: "/hook", method: "POST", secret: "s3", responseBody: "thanks" } };
  const armed = await triggers.armHttpTrigger(ctx, exec(), b, raw => events.push(JSON.parse(raw)));
  try {
    assert.match(armed.endpoint, /^http:\/\/127\.0\.0\.1:\d+\/hook$/);
    assert.match(await httpRequest(armed.port, "GET /other HTTP/1.1\r\n\r\n"), /^HTTP\/1.1 404/);
    assert.match(await httpRequest(armed.port, "GET /hook HTTP/1.1\r\n\r\n"), /^HTTP\/1.1 405/);
    assert.match(await httpRequest(armed.port, "POST /hook HTTP/1.1\r\nContent-Length: 2\r\n\r\n{}"), /^HTTP\/1.1 401/);
    const body = '{"a":1}';
    const res = await httpRequest(armed.port, `POST /hook?x=1 HTTP/1.1\r\nAuthorization: Bearer s3\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
    assert.match(res, /^HTTP\/1.1 200[\s\S]*thanks$/);
    assert.equal(events.length, 1);
    assert.deepEqual([events[0].method, events[0].path, events[0].query, events[0].body], ["POST", "/hook", { x: "1" }, { a: 1 }]);
  } finally { await armed.disarm(); }
});

test("arming fails when the port is already in use", async () => {
  const busy = net.createServer(); await new Promise(r => busy.listen(0, "127.0.0.1", r));
  const port = busy.address().port;
  try {
    const b = { id: "h", type: "http_trigger", label: "Hook", prompt: "", position: { x: 0, y: 0 }, trigger: { port } };
    await assert.rejects(triggers.armHttpTrigger(fakeCtx(), exec(), b, () => {}), /EADDRINUSE/);
    const s = { ...b, id: "s", type: "socket_trigger", trigger: { protocol: "tcp", port } };
    await assert.rejects(triggers.armSocketTrigger(fakeCtx(), exec(), s, () => {}), /EADDRINUSE/);
  } finally { busy.close(); }
});

test("TCP socket trigger emits one event per line and replies", async () => {
  const events = [];
  const b = { id: "s", type: "socket_trigger", label: "Sock", prompt: "", position: { x: 0, y: 0 }, trigger: { protocol: "tcp", port: 0, framing: "line", responseBody: "ok" } };
  const armed = await triggers.armSocketTrigger(fakeCtx(), exec(), b, raw => events.push(raw));
  try {
    const reply = await new Promise((resolve, reject) => {
      const s = net.connect(armed.port, "127.0.0.1", () => s.end("one\ntwo\n")); let out = "";
      s.setEncoding("utf8"); s.on("data", d => out += d); s.on("close", () => resolve(out)); s.on("error", reject);
    });
    assert.deepEqual(events, ["one", "two"]);
    assert.equal(reply, "ok\nok\n");
  } finally { await armed.disarm(); }
});

test("file trigger fails to arm when the file is missing and creation is off", async () => {
  const b = { id: "f", type: "file_trigger", label: "File", prompt: "", position: { x: 0, y: 0 }, trigger: { path: "missing.txt" } };
  await assert.rejects(triggers.armFileTrigger(fakeCtx(), exec(), b, () => {}), /cannot be armed/);
  const dir = { ...b, trigger: { path: "src" } };
  await assert.rejects(triggers.armFileTrigger(fakeCtx({ stat: async () => ({ kind: "dir", size: 0, mtime: null, path: "src" }) }), exec(), dir, () => {}), /is a directory/);
});

// ---------------------------------------------------------------- queue connections

// Script blocks run through a stubbed runScript that records inputs and takes 40 ms.
const stubEngineDeps = { name: "stub-engine-deps", setup(b) {
  b.onResolve({ filter: /^\.\/(procs|mcp)$/ }, a => ({ path: a.path, namespace: "stub-engine" }));
  b.onLoad({ filter: /.*/, namespace: "stub-engine" }, a => ({ loader: "js", contents: a.path === "./procs"
    ? "export const appAction = async () => ({}); export const createWindowsFile = async () => ({ code: 1, stdout: '', stderr: 'stub' }); export const runScript = async (_c, _r, _cmd, input) => { (globalThis.scriptCalls ||= []).push({ input, at: Date.now() }); await new Promise(r => setTimeout(r, 40)); return { code: 0, stdout: 'done ' + input, stderr: '' }; };"
    : "export const issueEndpoint = async () => ({}); export const revokeWhere = async () => {};" }));
} };
const engine = await load("../modules/services/workflow-runner/src/engine.ts", [stubEngineDeps]);

async function runFlow(edgeTypeToScript, queueLimit) {
  globalThis.scriptCalls = [];
  engine.initEngine({ host: {}, log: { warn() {}, error() {} }, modules: {} }, () => {});
  const def = wf.normalizeDefinition({ id: "q", name: "Q", blocks: [
    { id: "start", type: "start_button", label: "Start", prompt: "go" },
    { id: "a", type: "text", label: "A", prompt: "first" },
    { id: "b", type: "text", label: "B", prompt: "second" },
    { id: "c", type: "text", label: "C", prompt: "third" },
    { id: "s", type: "script", label: "S", prompt: "", command: "x" },
  ], edges: [
    { id: "e1", from: "start", to: "a" }, { id: "e2", from: "start", to: "b" }, { id: "e3", from: "start", to: "c" },
    ...["a", "b", "c"].map(f => ({ id: `q-${f}`, from: f, to: "s", type: edgeTypeToScript, ...(queueLimit ? { queueLimit } : {}) })),
  ] });
  const run = { id: crypto.randomUUID(), workflowId: def.id, workflowName: def.name, projectId: "p", workspaceId: "w", status: "running", input: "", createdAt: new Date().toISOString(), definition: def, blocks: def.blocks.map(b => ({ blockId: b.id, status: "idle", runs: 0, log: [] })) };
  const x = engine.newExec(run, { root: "/tmp", workspaceId: "w", profiles: [], mcpServers: [] });
  await engine.drive(x);
  return x;
}

test("queue connections feed a busy block one item at a time, in arrival order", async () => {
  const x = await runFlow("queue");
  assert.equal(x.run.status, "succeeded");
  assert.deepEqual(globalThis.scriptCalls.map(c => c.input), ["first", "second", "third"]);
  const gaps = globalThis.scriptCalls.slice(1).map((c, i) => c.at - globalThis.scriptCalls[i].at);
  assert.ok(gaps.every(g => g >= 35), `items ran sequentially (${gaps})`);
  assert.equal(x.run.blocks.find(s => s.blockId === "s").queueDepth, undefined);
});

test("plain follow connections skip a busy block (contrast with queue)", async () => {
  await runFlow("follow");
  assert.equal(globalThis.scriptCalls.length, 1);
});

test("a trigger feeding a full queue rejects the event with HTTP 503", async () => {
  globalThis.scriptCalls = [];
  engine.initEngine({ ...fakeCtx(), log: { warn() {}, error() {} }, modules: {} }, () => {});
  const def = wf.normalizeDefinition({ id: "t", name: "T", blocks: [
    { id: "hook", type: "http_trigger", label: "Hook", prompt: "", trigger: { port: 0, continuous: true } },
    { id: "s", type: "script", label: "S", prompt: "", command: "x" },
  ], edges: [{ id: "q", from: "hook", to: "s", type: "queue", queueLimit: 1 }] });
  const run = { id: crypto.randomUUID(), workflowId: def.id, workflowName: def.name, projectId: "p", workspaceId: "w", status: "running", input: "", createdAt: new Date().toISOString(), definition: def, blocks: def.blocks.map(b => ({ blockId: b.id, status: "idle", runs: 0, log: [] })) };
  const x = engine.newExec(run, { root: "/tmp", workspaceId: "w", profiles: [], mcpServers: [] });
  assert.equal(await engine.armTriggers(x), undefined);
  const port = x.triggers.get("hook").port;
  const post = body => httpRequest(port, `POST / HTTP/1.1\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
  const statuses = [];
  for (const body of ["one", "two", "three"]) statuses.push((await post(body)).split(" ")[1]);
  assert.deepEqual(statuses, ["200", "200", "503"]);
  await new Promise(r => setTimeout(r, 150));
  assert.deepEqual(globalThis.scriptCalls.map(c => JSON.parse(c.input).rawBody), ["one", "two"]);
  await engine.cancel(x);
  assert.equal(x.triggers.size, 0);
});

test("Text Input keeps the run open and feeds each sent text to its connections", async () => {
  globalThis.scriptCalls = [];
  engine.initEngine({ host: {}, log: { warn() {}, error() {} }, modules: {} }, () => {});
  const def = wf.normalizeDefinition({ id: "ti", name: "TI", blocks: [
    { id: "in", type: "text_input", label: "In", prompt: "" },
    { id: "s", type: "script", label: "S", prompt: "", command: "x" },
  ], edges: [{ id: "q", from: "in", to: "s", type: "queue" }] });
  assert.deepEqual(wf.validateWorkflow(def).filter(i => i.severity !== "warning"), []);
  const run = { id: crypto.randomUUID(), workflowId: def.id, workflowName: def.name, projectId: "p", workspaceId: "w", status: "running", input: "", createdAt: new Date().toISOString(), definition: def, blocks: def.blocks.map(b => ({ blockId: b.id, status: "idle", runs: 0, log: [] })) };
  const x = engine.newExec(run, { root: "/tmp", workspaceId: "w", profiles: [], mcpServers: [] });
  engine.openTextInputs(x);
  const driving = engine.drive(x);
  await new Promise(r => setTimeout(r, 30));
  assert.equal(x.run.status, "waiting", "nothing runs until text is sent");
  engine.sendText(x, "in", "hello");
  engine.sendText(x, "in", "again");
  assert.throws(() => engine.sendText(x, "s", "nope"), /Only Text Input/);
  await new Promise(r => setTimeout(r, 150));
  assert.deepEqual(globalThis.scriptCalls.map(c => c.input), ["hello", "again"]);
  assert.equal(x.run.blocks.find(b => b.blockId === "in").status, "waiting_input");
  await engine.cancel(x);
  await driving;
  assert.equal(x.run.status, "cancelled");
});

test("file trigger creates a missing file through the process scope, never asking for write access", async () => {
  const requests = [], commands = [];
  let created = false;
  globalThis.runScriptStub = async (_ctx, _root, command) => { commands.push(command); created = true; return { code: 0, stdout: "", stderr: "" }; };
  const ctx = fakeCtx({
    stat: async () => { if (!created) throw new Error("ENOENT"); return { kind: "file", size: 0, mtime: null, path: "x" }; },
    watch: async () => ({ handle: "watch" }),
  });
  ctx.host.capabilities.request = async req => { requests.push(req); return { grant: "g" }; };
  const b = { id: "f", type: "file_trigger", label: "File", prompt: "", position: { x: 0, y: 0 }, trigger: { path: "dir/it's.txt", mode: "file", createIfMissing: true } };
  try {
    const armed = await triggers.armFileTrigger(ctx, exec(), b, () => {});
    assert.equal(armed.endpoint, "file:dir/it's.txt");
    assert.ok(requests.every(r => !r.write), "no write grant requested");
    assert.equal(commands.length, 1);
    assert.match(commands[0], /^mkdir -p -- "\$\(dirname -- 'dir\/it'\\''s\.txt'\)" && touch -- 'dir\/it'\\''s\.txt'$/);
    await armed.disarm();
  } finally { delete globalThis.runScriptStub; }
});

test("deactivating the runtime releases armed trigger ports", async () => {
  engine.initEngine({ ...fakeCtx(), log: { warn() {}, error() {}, info() {} }, modules: {} }, () => {});
  const def = wf.normalizeDefinition({ id: "r", name: "R", blocks: [
    { id: "hook", type: "http_trigger", label: "Hook", prompt: "", trigger: { port: 0, continuous: true } },
    { id: "out", type: "text", label: "Out", prompt: "{{input}}" },
  ], edges: [{ id: "e", from: "hook", to: "out" }] });
  const run = { id: crypto.randomUUID(), workflowId: def.id, workflowName: def.name, projectId: "p", workspaceId: "w", status: "running", input: "", createdAt: new Date().toISOString(), definition: def, blocks: def.blocks.map(b => ({ blockId: b.id, status: "idle", runs: 0, log: [] })) };
  const x = engine.newExec(run, { root: "/tmp", workspaceId: "w", profiles: [], mcpServers: [] });
  assert.equal(await engine.armTriggers(x), undefined);
  const port = x.triggers.get("hook").port;
  assert.equal(await engine.releaseAllTriggers(), 1);
  assert.equal(x.triggers.size, 0);
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(port, "127.0.0.1", resolve); });
  probe.close();
  engine.execs.delete(run.id);
});
