import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'modules/services/acp/src/index.ts');
const sdkRoot = process.env.HATO_SDK_ROOT || (fs.existsSync(path.join(root, '../sdk/types.ts')) ? path.join(root, '../sdk') : path.join(root, '../Hato-upstream/sdk'));
const providerManifest = JSON.parse(fs.readFileSync(path.join(root, 'modules/services/opencode-provider/manifest.json'), 'utf8'));
const desc = { id: 'ws-1', location: 'local', machineId: 'local', rootAbsolutePath: '/work/project' };
let importVersion = 0;

async function loadModule() {
  const result = await build({ entryPoints: [source], alias: { '@hato/sdk': sdkRoot }, bundle: true, format: 'esm', platform: 'node', write: false });
  const code = result.outputFiles[0].text;
  return (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}#${++importVersion}`)).default;
}

const agentCapabilities = {
  loadSession: true,
  mcpCapabilities: { http: true, sse: false },
  promptCapabilities: { image: true, embeddedContext: true },
  sessionCapabilities: { additionalDirectories: {}, close: {}, delete: {}, fork: {}, list: {}, resume: {} },
};

function runtime(handler, options = {}) {
  const procs = new Map();
  const writes = [];
  const events = [];
  const moduleCalls = [];
  const waiters = [];
  let sequence = 0;

  const send = (state, message) => {
    for (const listener of state.listeners.stdout) listener.onData(`${JSON.stringify(message)}\n`);
  };
  const notify = (state, method, params) => send(state, { jsonrpc: '2.0', method, params });
  const close = (state, code = 0, signal = null) => {
    if (state.closed) return;
    state.closed = true;
    for (const listener of state.listeners.stdout) listener.onEnd?.();
    for (const listener of state.listeners.stderr) listener.onEnd?.();
    for (const resolve of state.waiters) resolve({ code, signal });
    state.waiters.length = 0;
  };

  const ctx = {
    moduleId: 'acp',
    host: {
      plugins: { list: async () => ({ plugins: [{ id: 'opencode-provider', enabled: true, contributes: providerManifest.contributes }] }) },
      capabilities: { request: async () => ({ grant: 'grant-1' }), release: async () => {} },
      env: { info: () => ({ platform: 'linux' }) },
      process: {
        run: async (_grant, request) => {
          assert.equal(request.executable, process.env.SHELL || '/bin/sh');
          return { code: 0, signal: null, stdout: '/usr/bin/opencode\n__PATH__=/usr/bin:/bin', stderr: '', truncated: false };
        },
        spawn: async (_grant, request) => {
          const handle = `proc-${++sequence}`;
          const state = { handle, request, listeners: { stdout: [], stderr: [] }, closed: false, waiters: [] };
          procs.set(handle, state);
          return { handle, pid: 1000 + sequence };
        },
        write: async (handle, line) => {
          const state = procs.get(handle);
          if (state.request.args?.[0] === 'auth') {
            options.onAuthInput?.(line);
            return;
          }
          const message = JSON.parse(line);
          writes.push({ handle, message });
          await handler(state, message, { send, notify, close });
        },
        closeStdin: async (handle) => close(procs.get(handle)),
        terminate: async (handle) => close(procs.get(handle)),
        wait: (handle) => {
          const state = procs.get(handle);
          if (state.closed) return Promise.resolve({ code: 0, signal: null });
          return new Promise((resolve) => state.waiters.push(resolve));
        },
      },
      streams: {
        listen: async (handle, { channel }, onData, onEnd) => {
          const state = procs.get(handle);
          const listener = { onData, onEnd };
          state.listeners[channel].push(listener);
          return { close: async () => {
            const index = state.listeners[channel].indexOf(listener);
            if (index >= 0) state.listeners[channel].splice(index, 1);
          } };
        },
      },
    },
    modules: {
      call: async (id, method, args) => {
        moduleCalls.push({ id, method, args });
        if (id === 'workspace' && method === 'resolve') return { ...desc, id: args.workspaceId };
        if (id === 'persistence' && method === 'acpProfiles.list') return [];
        if (id === 'ai-sessions' && method === 'permissionRequest') {
          options.onPermission?.(args);
          return options.permissionResult || new Promise(() => {});
        }
        if (id === 'opencode-provider' && method === 'limits') return options.limits?.(args);
        throw new Error(`Unexpected module call ${id}.${method}`);
      },
    },
    state: { set: () => {} },
    events: {
      emit: (name, payload) => {
        events.push({ name, payload });
        for (let index = waiters.length - 1; index >= 0; index--) {
          if (waiters[index].predicate(name, payload)) {
            const waiter = waiters.splice(index, 1)[0];
            clearTimeout(waiter.timer);
            waiter.resolve(payload);
          }
        }
      },
      on: () => {},
    },
    log: { info: () => {}, warn: () => {}, error: () => {} },
  };

  function waitFor(name, predicate = () => true, timeoutMs = 2000) {
    const found = events.find((event) => event.name === name && predicate(event.payload));
    if (found) return Promise.resolve(found.payload);
    return new Promise((resolve, reject) => {
      const waiter = { predicate: (eventName, payload) => eventName === name && predicate(payload), resolve };
      waiter.timer = setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error(`Timed out waiting for ${name}`));
      }, timeoutMs);
      waiters.push(waiter);
    });
  }

  async function until(predicate, timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('Condition timed out');
  }

  return { ctx, writes, events, moduleCalls, waitFor, until, procs };
}

function initialize(state, message, send) {
  send(state, {
    jsonrpc: '2.0', id: message.id,
    result: {
      protocolVersion: 1,
      agentCapabilities,
      authMethods: [{ id: 'opencode-login', name: 'Login with OpenCode', _meta: { 'terminal-auth': { command: 'opencode', args: ['auth', 'login'], label: 'Log in' } } }],
      _meta: { steering: { supported: true } },
      agentInfo: { name: 'FakeACP', version: '1.0' },
    },
  });
}

function configOptions() {
  return [{ id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'fake/model', options: [{ value: 'fake/model', name: 'Fake' }] }];
}

test('ACP advertises the full OpenCode-facing client surface and forwards additional directories', async () => {
  const acp = await loadModule();
  const seen = [];
  const rt = runtime(async (state, message, { send }) => {
    if (!message.method) return;
    seen.push(message);
    if (message.method === 'initialize') initialize(state, message, send);
    else if (message.method === 'session/new') send(state, { jsonrpc: '2.0', id: message.id, result: { sessionId: 's-new', configOptions: configOptions() } });
  });
  await acp.activate(rt.ctx);
  const state = await acp.methods.start(rt.ctx, { conversationId: 'c1', workspaceId: 'ws-1', profileId: 'opencode', additionalDirectories: ['/extra'] });
  assert.equal(state.sessionId, 's-new');
  assert.deepEqual(state.additionalDirectories, ['/extra']);
  const init = seen.find((message) => message.method === 'initialize');
  assert.deepEqual(init.params.clientCapabilities, {
    fs: { readTextFile: false, writeTextFile: false }, terminal: false,
    auth: { terminal: true }, _meta: { 'terminal-auth': true }, elicitation: { form: {} }, session: { compaction: {} },
  });
  assert.deepEqual(seen.find((message) => message.method === 'session/new').params.additionalDirectories, ['/extra']);
});

test('ACP exposes session list, load, resume, fork, close, delete and new methods', async () => {
  const acp = await loadModule();
  const methods = [];
  const rt = runtime(async (state, message, { send }) => {
    if (!message.method) return;
    methods.push(message.method);
    if (message.method === 'initialize') initialize(state, message, send);
    else if (message.method === 'session/new') send(state, { jsonrpc: '2.0', id: message.id, result: { sessionId: 's-new', configOptions: configOptions() } });
    else if (message.method === 'session/list') send(state, { jsonrpc: '2.0', id: message.id, result: { sessions: [{ sessionId: 's-old', cwd: '/work/project' }], nextCursor: null } });
    else if (['session/load', 'session/resume'].includes(message.method)) send(state, { jsonrpc: '2.0', id: message.id, result: { configOptions: configOptions() } });
    else if (message.method === 'session/fork') send(state, { jsonrpc: '2.0', id: message.id, result: { sessionId: 's-fork', configOptions: configOptions() } });
    else send(state, { jsonrpc: '2.0', id: message.id, result: {} });
  });
  await acp.activate(rt.ctx);
  await acp.methods.start(rt.ctx, { conversationId: 'c1', workspaceId: 'ws-1', profileId: 'opencode' });
  const listed = await acp.methods.listSessions(rt.ctx, { conversationId: 'c1', limit: 10 });
  assert.equal(listed.sessions[0].sessionId, 's-old');
  await acp.methods.loadSession(rt.ctx, { conversationId: 'c1', sessionId: 's-old' });
  await acp.methods.resumeSession(rt.ctx, { conversationId: 'c1', sessionId: 's-old' });
  await acp.methods.forkSession(rt.ctx, { conversationId: 'c1', sessionId: 's-old' });
  await acp.methods.closeSession(rt.ctx, { conversationId: 'c1' });
  await acp.methods.newSession(rt.ctx, { conversationId: 'c1' });
  await acp.methods.deleteSession(rt.ctx, { conversationId: 'c1', sessionId: 's-new' });
  assert.deepEqual(methods, ['initialize', 'session/new', 'session/list', 'session/load', 'session/resume', 'session/fork', 'session/close', 'session/new', 'session/delete']);
});

test('ACP forwards rich prompt content and end-turn usage', async () => {
  const acp = await loadModule();
  let prompt;
  const rt = runtime(async (state, message, { send, notify }) => {
    if (!message.method) return;
    if (message.method === 'initialize') initialize(state, message, send);
    else if (message.method === 'session/new') send(state, { jsonrpc: '2.0', id: message.id, result: { sessionId: 's-new', configOptions: configOptions() } });
    else if (message.method === 'session/prompt') {
      prompt = message.params.prompt;
      notify(state, 'session/update', { sessionId: 's-new', update: { sessionUpdate: 'usage_update', used: 1200, size: 100000, cost: 0.25 } });
      send(state, { jsonrpc: '2.0', id: message.id, result: { stopReason: 'end_turn', usage: { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 } } });
    }
  });
  await acp.activate(rt.ctx);
  await acp.methods.start(rt.ctx, { conversationId: 'c1', workspaceId: 'ws-1', profileId: 'opencode' });
  const blocks = [{ type: 'resource_link', uri: 'file:///work/project/a.ts' }, { type: 'resource', text: 'embedded context' }];
  await acp.methods.prompt(rt.ctx, { conversationId: 'c1', prompt: blocks });
  const ended = await rt.waitFor('acp.turnEnded');
  assert.deepEqual(prompt, blocks);
  assert.deepEqual(ended.usage, { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 });
  assert.equal(acp.methods.state(rt.ctx, { conversationId: 'c1' }).usage.cost, 0.25);
});

test('ACP emits form elicitation and accepts a UI response', async () => {
  const acp = await loadModule();
  let elicitationResponse;
  let promptId;
  const rt = runtime(async (state, message, { send }) => {
    if (!message.method) {
      if (message.id === 900) {
        elicitationResponse = message;
        send(state, { jsonrpc: '2.0', id: promptId, result: { stopReason: 'end_turn' } });
      }
      return;
    }
    if (message.method === 'initialize') initialize(state, message, send);
    else if (message.method === 'session/new') send(state, { jsonrpc: '2.0', id: message.id, result: { sessionId: 's-new', configOptions: configOptions() } });
    else if (message.method === 'session/prompt') {
      promptId = message.id;
      send(state, { jsonrpc: '2.0', id: 900, method: 'elicitation/create', params: {
        sessionId: 's-new', mode: 'form', message: 'Choose a strategy',
        requestedSchema: { type: 'object', properties: { strategy: { type: 'string', enum: ['safe', 'fast'] } }, required: ['strategy'] },
      } });
    }
  });
  await acp.activate(rt.ctx);
  await acp.methods.start(rt.ctx, { conversationId: 'c1', workspaceId: 'ws-1', profileId: 'opencode' });
  await acp.methods.prompt(rt.ctx, { conversationId: 'c1', text: 'go' });
  const request = await rt.waitFor('acp.elicitation');
  assert.equal(request.requestId, 900);
  acp.methods.respondElicitation(rt.ctx, { conversationId: 'c1', requestId: 900, response: { action: 'accept', content: { strategy: 'safe' } } });
  await rt.waitFor('acp.turnEnded');
  assert.deepEqual(elicitationResponse.result, { action: 'accept', content: { strategy: 'safe' } });
});

test('ACP cancellation settles pending permission requests', async () => {
  const acp = await loadModule();
  let permissionResponse;
  let promptId;
  const rt = runtime(async (state, message, { send }) => {
    if (!message.method) {
      if (message.id === 901) {
        permissionResponse = message;
        send(state, { jsonrpc: '2.0', id: promptId, result: { stopReason: 'cancelled' } });
      }
      return;
    }
    if (message.method === 'initialize') initialize(state, message, send);
    else if (message.method === 'session/new') send(state, { jsonrpc: '2.0', id: message.id, result: { sessionId: 's-new', configOptions: configOptions() } });
    else if (message.method === 'session/prompt') {
      promptId = message.id;
      send(state, { jsonrpc: '2.0', id: 901, method: 'session/request_permission', params: {
        sessionId: 's-new', toolCall: { toolCallId: 't1', title: 'Run command', kind: 'execute' },
        options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
      } });
    }
  });
  await acp.activate(rt.ctx);
  await acp.methods.start(rt.ctx, { conversationId: 'c1', workspaceId: 'ws-1', profileId: 'opencode' });
  await acp.methods.prompt(rt.ctx, { conversationId: 'c1', text: 'go' });
  await rt.until(() => rt.moduleCalls.some((call) => call.id === 'ai-sessions' && call.method === 'permissionRequest'));
  await acp.methods.cancel(rt.ctx, { conversationId: 'c1' });
  await rt.waitFor('acp.turnEnded');
  assert.deepEqual(permissionResponse.result, { outcome: { outcome: 'cancelled' } });
});

test('ACP exposes terminal authentication as a controllable process interface', async () => {
  const acp = await loadModule();
  let authInput;
  const rt = runtime(async (state, message, { send }) => {
    if (!message.method) return;
    if (message.method === 'initialize') initialize(state, message, send);
    else if (message.method === 'session/new') send(state, { jsonrpc: '2.0', id: message.id, result: { sessionId: 's-new', configOptions: configOptions() } });
  }, { onAuthInput: (data) => { authInput = data; } });
  await acp.activate(rt.ctx);
  await acp.methods.start(rt.ctx, { conversationId: 'c1', workspaceId: 'ws-1', profileId: 'opencode' });
  const result = await acp.methods.authenticate(rt.ctx, { conversationId: 'c1', methodId: 'opencode-login' });
  assert.equal(result.outcome, 'terminal');
  assert.deepEqual(result.args, ['auth', 'login']);
  assert.ok(acp.methods.state(rt.ctx, { conversationId: 'c1' }).authProcess);
  await acp.methods.authInput(rt.ctx, { conversationId: 'c1', data: 'choice\n' });
  assert.equal(authInput, 'choice\n');
  await acp.methods.cancelAuth(rt.ctx, { conversationId: 'c1' });
  await rt.until(() => !acp.methods.state(rt.ctx, { conversationId: 'c1' }).authProcess);
});

test('ACP enforces MCP selection instead of forwarding disabled servers', async () => {
  const acp = await loadModule();
  let sessionParams;
  const rt = runtime(async (state, message, { send }) => {
    if (!message.method) return;
    if (message.method === 'initialize') initialize(state, message, send);
    else if (message.method === 'session/new') {
      sessionParams = message.params;
      send(state, { jsonrpc: '2.0', id: message.id, result: { sessionId: 's-new', configOptions: configOptions() } });
    }
  });
  await acp.activate(rt.ctx);
  await acp.methods.start(rt.ctx, {
    conversationId: 'c1', workspaceId: 'ws-1', profileId: 'opencode', mcp: false, mcpSelection: ['one'],
    mcpServers: [{ id: 'one', name: 'one', type: 'http', url: 'https://one.example/mcp' }, { id: 'two', name: 'two', type: 'http', url: 'https://two.example/mcp' }],
  });
  assert.deepEqual(sessionParams.mcpServers.map((server) => server.name), ['one']);
});

test('ACP usage cache and concurrent probes are workspace-scoped', async () => {
  const acp = await loadModule();
  const calls = [];
  const snapshot = (workspaceId, usedPercent) => ({
    provider: 'opencode', windows: [{ id: 'five_hour', label: '5h', usedPercent, resetsAt: null, resetsText: null }],
    plan: workspaceId, updatedAt: Date.now(), source: 'probe', error: null,
  });
  const rt = runtime(async () => {}, {
    limits: async (args) => {
      calls.push(args.workspaceId);
      await new Promise((resolve) => setTimeout(resolve, 10));
      return snapshot(args.workspaceId, args.workspaceId === 'ws-1' ? 10 : 20);
    },
  });
  await acp.activate(rt.ctx);
  const [first, concurrent] = await Promise.all([
    acp.methods.limits(rt.ctx, { provider: 'opencode', workspaceId: 'ws-1' }),
    acp.methods.limits(rt.ctx, { provider: 'opencode', workspaceId: 'ws-1' }),
  ]);
  assert.equal(first.plan, 'ws-1');
  assert.equal(concurrent.plan, 'ws-1');
  assert.deepEqual(calls, ['ws-1']);
  const second = await acp.methods.limits(rt.ctx, { provider: 'opencode', workspaceId: 'ws-2' });
  assert.equal(second.plan, 'ws-2');
  assert.deepEqual(calls, ['ws-1', 'ws-2']);
});
