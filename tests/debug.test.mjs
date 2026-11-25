import { fileURLToPath } from "node:url";
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
const sdk = fileURLToPath(new URL('../../sdk', import.meta.url));
const load = async path => import('data:text/javascript;base64,' + Buffer.from((await build({
  entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false, alias: { '@hato/sdk': sdk },
})).outputFiles[0].text).toString('base64'));
if (!globalThis.crypto) globalThis.crypto = { randomUUID };

const { RELAY_SCRIPT } = await load('../modules/services/debug/src/relay.ts');
const { javaDebugLaunch, JDWP_LISTENING } = await load('../modules/services/run/src/launch.ts');
const { inlineValues, debugKind } = await load(`${sdk}/debug.ts`);
const debug = (await load('../modules/services/debug/src/index.ts')).default;

/** A tiny DAP server: answers every request with its arguments echoed, plus an event first. */
function fakeAdapter() {
  const server = net.createServer(socket => {
    let buf = Buffer.alloc(0);
    socket.on('data', data => {
      buf = Buffer.concat([buf, data]);
      for (;;) {
        const end = buf.indexOf('\r\n\r\n');
        if (end < 0) return;
        const size = Number(/Content-Length: (\d+)/i.exec(buf.subarray(0, end).toString())[1]);
        if (buf.length < end + 4 + size) return;
        const msg = JSON.parse(buf.subarray(end + 4, end + 4 + size).toString('utf8'));
        buf = buf.subarray(end + 4 + size);
        const send = body => { const b = Buffer.from(JSON.stringify(body), 'utf8'); socket.write(`Content-Length: ${b.length}\r\n\r\n`); socket.write(b); };
        send({ seq: 1, type: 'event', event: 'output', body: { output: 'héllo → 世界 🎉\n' } });
        send({ seq: 2, type: 'response', request_seq: msg.seq, command: msg.command, success: true, body: msg.arguments });
      }
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

test('relay frames DAP over stdio with ASCII-only lines and several connections', async () => {
  const server = await fakeAdapter();
  const relay = spawn('python3', ['-c', RELAY_SCRIPT, JSON.stringify({ connect: { port: server.address().port } })]);
  const lines = [];
  let buf = '';
  relay.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(buf.slice(0, i)); buf = buf.slice(i + 1); } });
  const until = async pred => { for (let i = 0; i < 200; i++) { const hit = lines.map(l => JSON.parse(l)).find(pred); if (hit) return hit; await new Promise(r => setTimeout(r, 25)); } throw Error('timeout: ' + lines.join('\n')); };
  try {
    await until(e => e.ev === 'ready');
    relay.stdin.write(JSON.stringify({ op: 'open', id: 1 }) + '\n');
    relay.stdin.write(JSON.stringify({ op: 'open', id: 2 }) + '\n');
    await until(e => e.ev === 'opened' && e.id === 1);
    await until(e => e.ev === 'opened' && e.id === 2);
    relay.stdin.write(JSON.stringify({ op: 'send', id: 2, msg: { seq: 7, type: 'request', command: 'evaluate', arguments: { expression: 'naïve ✓' } } }) + '\n');
    const response = await until(e => e.ev === 'msg' && e.id === 2 && e.msg.type === 'response');
    assert.equal(response.msg.request_seq, 7);
    assert.equal(response.msg.body.expression, 'naïve ✓');
    const event = await until(e => e.ev === 'msg' && e.id === 2 && e.msg.type === 'event');
    assert.equal(event.msg.body.output, 'héllo → 世界 🎉\n');
    // Non-ASCII is escaped, so a UTF-8 sequence can never be split across stream chunks.
    assert.ok(lines.every(l => /^[\x00-\x7f]*$/.test(l)));
    assert.ok(!lines.some(l => l.includes('"id":1,"msg"')), 'connection 1 received nothing');
  } finally { relay.stdin.end(); relay.kill(); server.close(); }
});

test('relay refuses non-loopback adapters', async () => {
  const relay = spawn('python3', ['-c', RELAY_SCRIPT, JSON.stringify({ connect: { port: 9, host: '10.0.0.1' } })]);
  let out = '';
  relay.stdout.on('data', d => { out += d; });
  const code = await new Promise(r => relay.on('exit', r));
  assert.equal(code, 1);
  assert.match(out, /only connects to loopback/);
});

test('debug launches add a JDWP agent to the JVM that runs user code', () => {
  const base = { name: 'x', target: 'com.acme.Main', args: [], runtimeArgs: [], cwd: '.', env: {}, envFiles: [], profiles: [], beforeLaunch: [], runtime: '' };
  const app = javaDebugLaunch({ ...base, type: 'java-application' }, { executable: 'java', args: ['-cp', 'target/classes', 'com.acme.Main'], cwd: '/w', env: {} });
  assert.match(app.args[0], /^-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=127\.0\.0\.1:0$/);
  assert.deepEqual(app.args.slice(1), ['-cp', 'target/classes', 'com.acme.Main']);
  const boot = javaDebugLaunch({ ...base, type: 'spring-boot' }, { executable: 'mvn', args: ['spring-boot:run', '-Dspring-boot.run.main-class=x'], cwd: '/w', env: {} });
  assert.equal(boot.args[0], 'spring-boot:run');
  assert.match(boot.args[1], /^-Dspring-boot\.run\.jvmArguments=-agentlib:jdwp/);
  assert.deepEqual(javaDebugLaunch({ ...base, type: 'spring-boot' }, { executable: './gradlew', args: ['bootRun'], cwd: '/w', env: {} }).args, ['bootRun', '--debug-jvm']);
  const unit = javaDebugLaunch({ ...base, type: 'junit' }, { executable: 'mvn', args: ['test', '-Dtest=FooTest'], cwd: '/w', env: {} });
  assert.ok(unit.args.some(a => a.startsWith('-Dmaven.surefire.debug=-agentlib:jdwp')));
  assert.throws(() => javaDebugLaunch({ ...base, type: 'java-maven' }, { executable: 'mvn', args: [], cwd: '/w', env: {} }), /isn't supported/);
  assert.equal(JDWP_LISTENING.exec('Listening for transport dt_socket at address: 50123\n')[1], '50123');
  assert.equal(debugKind('npm-script'), 'js');
  assert.equal(debugKind('junit'), 'java');
  assert.equal(debugKind('java-gradle'), null);
});

test('inline values show variables named on the paused line', () => {
  const vars = [{ name: 'total', value: '3', variablesReference: 0 }, { name: 'i', value: '2', variablesReference: 0 }, { name: 'unused', value: '9', variablesReference: 0 },
    { name: 'long', value: 'x'.repeat(60), variablesReference: 0 }];
  assert.equal(inlineValues('  total += i; // long', vars), `total = 3, i = 2, long = ${'x'.repeat(39)}…`);
  assert.equal(inlineValues('return;', vars), '');
});

test('breakpoints persist per workspace, toggle, carry conditions and reject unsafe paths', async () => {
  const store = new Map(), events = [];
  const ctx = {
    modules: { call: async (module, method, a) => {
      if (module === 'workspace') return { id: a.workspaceId, rootAbsolutePath: '/repo', machineId: 'local', name: 'repo', location: 'local' };
      if (method === 'settings.get') return structuredClone(store.get(a.key) ?? null);
      if (method === 'settings.set') { store.set(a.key, structuredClone(a.value)); return; }
      throw Error(`unexpected ${module}.${method}`);
    } },
    events: { emit: (topic, payload) => events.push({ topic, payload }), on() {} },
  };
  const m = debug.methods;
  const set = await m.breakpointsSet(ctx, { workspaceId: 'w1', path: '/repo/src/a.ts', line: 4, condition: '  count > 1 ' });
  assert.equal(set.path, 'src/a.ts');
  assert.equal(set.condition, 'count > 1');
  await m.breakpointsSet(ctx, { workspaceId: 'w1', path: 'src/a.ts', line: 4, condition: '', logMessage: 'n={n}' });
  let list = await m.breakpointsList(ctx, { workspaceId: 'w1' });
  assert.equal(list.breakpoints.length, 1);
  assert.equal(list.breakpoints[0].condition, undefined);
  assert.equal(list.breakpoints[0].logMessage, 'n={n}');
  assert.deepEqual(list.exceptions, { uncaught: true, caught: false });
  await m.breakpointsToggle(ctx, { workspaceId: 'w1', path: 'src/b.ts', line: 0 });
  await m.breakpointsToggle(ctx, { workspaceId: 'w1', path: 'src/a.ts', line: 4 });
  list = await m.breakpointsList(ctx, { workspaceId: 'w1' });
  assert.deepEqual(list.breakpoints.map(b => `${b.path}:${b.line}`), ['src/b.ts:0']);
  assert.deepEqual(store.get('debug.breakpoints.w1').breakpoints.map(b => b.path), ['src/b.ts']);
  await assert.rejects(m.breakpointsSet(ctx, { workspaceId: 'w1', path: '../etc/passwd', line: 1 }), /workspace-relative/);
  await assert.rejects(m.breakpointsSet(ctx, { workspaceId: 'w1', path: 'src/a.ts', line: -1 }), /zero-based/);
  assert.ok(events.some(e => e.topic === 'debug.breakpoints' && e.payload.workspaceId === 'w1'));
  assert.equal((await m.breakpointsList(ctx, { workspaceId: 'w2' })).breakpoints.length, 0);
  await assert.rejects(m.launchJs(ctx, { workspaceId: 'w1' }, { caller: 'viewer' }), /Only the run service/);
});

test('viewer shows a breakpoint immediately and keeps it when the service event precedes the reply', async () => {
  const viewer = await load('../modules/ui/viewer/src/debug-gutter.ts');
  const listeners = new Map();
  let breakpoints = [], reply;
  const ctx = {
    events: { on: (name, fn) => listeners.set(name, fn) },
    modules: { call: async (_, method, args) => {
      if (method === 'breakpointsList') return { breakpoints };
      if (method === 'sessions') return [];
      if (method === 'capabilities') return { debug: true };
      assert.match(method, /^breakpoints(Set|Remove)$/);
      breakpoints = method === 'breakpointsSet' ? [{ id: 'persisted', path: args.path, line: args.line, enabled: true }] : [];
      listeners.get('debug.breakpoints')({ workspaceId: args.workspaceId, breakpoints });
      await new Promise(resolve => { reply = resolve; });
    } },
  };
  viewer.initDebug(ctx, { invalidate() {} });
  await viewer.loadDebug(ctx, 'test');
  const markers = () => viewer.debugEditorFields('main.ts', [], undefined).gutterMarkers;
  const add = viewer.toggleBreakpoint(ctx, 'main.ts', 2);
  assert.equal(markers()[0].line, 2);
  await Promise.resolve();
  assert.equal(markers().length, 1);
  reply();
  await add;
  assert.equal(markers()[0].value.id, 'persisted');

  const remove = viewer.toggleBreakpoint(ctx, 'main.ts', 2);
  assert.deepEqual(markers(), []);
  await Promise.resolve();
  reply();
  await remove;
  assert.deepEqual(markers(), []);
});

test('debug hover selects a dotted expression at a UTF-16 offset', async () => {
  const { debugExpressionAt } = await load(`${sdk}/debug.ts`);
  const source = '😀\nconst value = obj . $member.界;';
  const start = source.indexOf('obj');
  const end = source.indexOf(';');
  assert.deepEqual(debugExpressionAt(source, source.indexOf('$member') + 1), { start, end, text: 'obj . $member.界' });
  assert.equal(debugExpressionAt(source, end), null);
  assert.equal(debugExpressionAt('123abc', 4), null);
});

test('paused hover expands a paged row on the same request and rejects a dismissed reply', async () => {
  const viewer = await load('../modules/ui/viewer/src/debug-gutter.ts');
  const source = 'obj.items.length';
  let answer, delayed = false;
  const calls = [];
  const ctx = {
    events: { on() {} },
    modules: { call: async (_, method, args) => {
      calls.push({ method, args });
      if (method === 'breakpointsList') return { breakpoints: [] };
      if (method === 'sessions') return [{ id: 's', state: 'paused', stopped: { path: 'main.ts', conn: 2, frameId: 5 } }];
      if (method === 'capabilities') return { debug: true };
      if (method === 'evaluate') {
        if (delayed) await new Promise(resolve => { answer = resolve; });
        return { name: 'items', value: 'Array(250)', variablesReference: 10, indexedVariables: 250 };
      }
      if (method === 'variables') return args.filter === 'indexed'
        ? [{ name: '100', value: '42', type: 'number', variablesReference: 0 }]
        : [];
      throw Error(method);
    } },
  };
  viewer.initDebug(ctx, { invalidate() {}, currentText: () => source });
  await viewer.loadDebug(ctx, 'test');
  const path = 'main.ts', offset = source.indexOf('items') + 1;
  const response = () => viewer.debugHoverFields(path).hoverPopover;
  const tree = () => response().node.children.find(n => n.type === 'tree');
  await viewer.hoverEvent(ctx, 'debugHover', { requestId: 17, offset }, path);
  assert.equal(response().requestId, 17);
  assert.deepEqual(calls.find(c => c.method === 'evaluate').args, {
    workspaceId: 'test', id: 's', conn: 2, frameId: 5, expression: 'obj.items', context: 'hover',
  });
  const rowKey = tree().rows.find(r => r.label === '[100…199]').key;
  await viewer.hoverEvent(ctx, 'debugHoverExpand', { rowKey }, path);
  assert.equal(response().requestId, 17);
  assert.equal(tree().rows.find(r => r.key === rowKey).expanded, true);
  assert.ok(tree().rows.some(r => r.label === '100' && r.value === '42'));
  assert.deepEqual(calls.filter(c => c.method === 'variables').map(c => c.args), [
    { workspaceId: 'test', id: 's', conn: 2, variablesReference: 10, filter: 'named' },
    { workspaceId: 'test', id: 's', conn: 2, variablesReference: 10, filter: 'indexed', start: 100, count: 100 },
  ]);
  delayed = true;
  const pending = viewer.hoverEvent(ctx, 'debugHover', { requestId: 18, offset }, path);
  await viewer.hoverEvent(ctx, 'debugHoverDismiss', { requestId: 18 }, path);
  answer();
  await pending;
  assert.equal(response(), undefined);
});

test('debug service only sends DAP paging arguments for indexed children', async () => {
  const workspaceId = 'java-variables', id = 'java-variables-session';
  let stdout;
  const requests = [];
  const receive = event => stdout(JSON.stringify(event) + '\n');
  const ctx = {
    events: { emit() {} },
    modules: { call: async (module, method) => {
      if (module === 'workspace') return { id: workspaceId, rootAbsolutePath: '/repo', machineId: 'local', location: 'local' };
      if (module === 'language-service' && method === 'bundles.set') return { changed: false };
      if (module === 'language-service' && method === 'executeCommand') return 54321;
      throw Error(`unexpected ${module}.${method}`);
    } },
    host: {
      capabilities: { request: async () => ({ grant: 'test' }) },
      streams: { listen: async (_, { channel }, callback) => {
        if (channel === 'stdout') {
          stdout = callback;
          receive({ ev: 'ready', port: 54321 });
        }
        return { close: async () => {} };
      } },
      process: {
        run: async () => ({ stdout: 'HATO_DEBUG_ADAPTER_RESULT:{"java-debug":"/adapter.jar"}\n' }),
        spawn: async () => ({ handle: 'relay' }),
        write: async (_, line) => {
          const { op, id: conn, msg } = JSON.parse(line);
          if (op === 'open') { receive({ ev: 'opened', id: conn }); return; }
          assert.equal(op, 'send');
          if (msg.command === 'variables') requests.push(msg.arguments);
          receive({ ev: 'msg', id: conn, msg: { type: 'response', request_seq: msg.seq, success: true,
            body: { variables: [{ name: 'task', value: 'Task@43', variablesReference: 19 }] } } });
        },
      },
    },
  };
  await debug.methods.attachJava(ctx, { workspaceId, id, name: 'Java fixture', port: 54322 }, { caller: 'run' });
  const args = { workspaceId, id, variablesReference: 10, start: 200, count: 300 };
  const fields = await debug.methods.variables(ctx, args);
  assert.equal(fields[0].variablesReference, 19);
  await debug.methods.variables(ctx, { ...args, filter: 'named' });
  await debug.methods.variables(ctx, { ...args, filter: 'indexed', count: 50 });
  assert.deepEqual(requests, [
    { variablesReference: 10 },
    { variablesReference: 10, filter: 'named' },
    { variablesReference: 10, filter: 'indexed', start: 200, count: 50 },
  ]);
});
