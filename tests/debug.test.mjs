import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
const sdk = new URL('../../sdk', import.meta.url).pathname;
const load = async path => import('data:text/javascript;base64,' + Buffer.from((await build({
  entryPoints: [new URL(path, import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', write: false, alias: { '@hato/sdk': sdk },
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
