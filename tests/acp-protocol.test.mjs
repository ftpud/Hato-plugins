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
const copilotManifest = JSON.parse(fs.readFileSync(path.join(root, 'modules/services/copilot-provider/manifest.json'), 'utf8'));
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
      plugins: { list: async () => ({ plugins: options.plugins || [{ id: 'opencode-provider', enabled: true, contributes: providerManifest.contributes }] }) },
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
          if (state.request.args?.includes('auth')) {
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

function initialize(state, message, send, capabilities = agentCapabilities) {
  send(state, {
    jsonrpc: '2.0', id: message.id,
    result: {
      protocolVersion: 1,
      agentCapabilities: capabilities,
      authMethods: [{ id: 'opencode-login', name: 'Login with OpenCode', _meta: { 'terminal-auth': { command: 'opencode', args: ['auth', 'login'], label: 'Log in' } } }],
      _meta: { steering: { supported: true } },
      agentInfo: { name: 'FakeACP', version: '1.0' },
    },
  });
}

function configOptions() {
  return [
    { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'fake/model', options: [{ value: 'fake/model', name: 'Fake' }] },
    { id: 'fast', name: 'Fast mode', type: 'boolean', currentValue: false },
  ];
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
  const state = await acp.methods.start(rt.ctx, { conversationId: 'c1', workspaceId: 'ws-1', profileId: 'opencode', additionalDirectories: ['/extra'], systemPrompt: 'Trusted Hato instructions' });
  assert.equal(state.sessionId, 's-new');
  assert.deepEqual(state.additionalDirectories, ['/extra']);
  const init = seen.find((message) => message.method === 'initialize');
  assert.deepEqual(init.params.clientCapabilities, {
    fs: { readTextFile: false, writeTextFile: false }, terminal: false,
    elicitation: { form: {} }, session: { configOptions: { boolean: {} } },
  });
  const created = seen.find((message) => message.method === 'session/new').params;
  assert.deepEqual(created.additionalDirectories, ['/extra']);
  assert.equal(Object.hasOwn(created, 'systemPrompt'), false);
});

test('ACP sends the standard boolean discriminator for boolean config options', async () => {
  const acp = await loadModule();
  let setter;
  const rt = runtime(async (state, message, { send }) => {
    if (!message.method) return;
    if (message.method === 'initialize') initialize(state, message, send);
    else if (message.method === 'session/new') send(state, { jsonrpc: '2.0', id: message.id, result: { sessionId: 's-new', configOptions: configOptions() } });
    else if (message.method === 'session/set_config_option') {
      setter = message.params;
      send(state, { jsonrpc: '2.0', id: message.id, result: { configOptions: configOptions() } });
    }
  });
  await acp.activate(rt.ctx);
  await acp.methods.start(rt.ctx, { conversationId: 'c1', workspaceId: 'ws-1', profileId: 'opencode' });
  await acp.methods.setConfig(rt.ctx, { conversationId: 'c1', configId: 'fast', value: true });
  assert.deepEqual(setter, { sessionId: 's-new', configId: 'fast', type: 'boolean', value: true });
  await assert.rejects(acp.methods.setConfig(rt.ctx, { conversationId: 'c1', configId: 'fast', value: 'true' }), /boolean/);
});

test('ACP rejects additionalDirectories unless the agent advertises support', async () => {
  const acp = await loadModule();
  const seen = [];
  const capabilities = { ...agentCapabilities, sessionCapabilities: { ...agentCapabilities.sessionCapabilities, additionalDirectories: undefined } };
  const rt = runtime(async (state, message, { send }) => {
    if (!message.method) return;
    seen.push(message);
    if (message.method === 'initialize') initialize(state, message, send, capabilities);
    else if (message.method === 'session/new') send(state, { jsonrpc: '2.0', id: message.id, result: { sessionId: 's-new' } });
  });
  await acp.activate(rt.ctx);
  await assert.rejects(acp.methods.start(rt.ctx, { conversationId: 'c1', workspaceId: 'ws-1', profileId: 'opencode', additionalDirectories: ['/extra'] }), /does not support additionalDirectories/);
  assert.ok(!seen.some(message => message.method === 'session/new'));
});

test('ACP marks session/load notifications as replay and closes the replay window', async () => {
  const acp = await loadModule();
  const rt = runtime(async (state, message, { send, notify }) => {
    if (!message.method) return;
    if (message.method === 'initialize') initialize(state, message, send);
    else if (message.method === 'session/new') send(state, { jsonrpc: '2.0', id: message.id, result: { sessionId: 's-new', configOptions: configOptions() } });
    else if (message.method === 'session/load') {
      notify(state, 'session/update', { sessionId: 's-old', update: { sessionUpdate: 'agent_message_chunk', messageId: 'm-old', content: { type: 'text', text: 'Saved reply' } } });
      send(state, { jsonrpc: '2.0', id: message.id, result: { configOptions: configOptions() } });
    }
  });
  await acp.activate(rt.ctx);
  await acp.methods.start(rt.ctx, { conversationId: 'c1', workspaceId: 'ws-1', profileId: 'opencode' });
  await acp.methods.loadSession(rt.ctx, { conversationId: 'c1', sessionId: 's-old' });
  const update = rt.events.find(event => event.name === 'acp.update' && event.payload.update.messageId === 'm-old');
  assert.equal(update.payload.replayed, true);
  assert.equal(update.payload.sessionId, 's-old');
  assert.ok(rt.events.some(event => event.name === 'acp.replayEnded' && event.payload.sessionId === 's-old'));
});

test('ACP exposes session list, load, resume, fork, close, delete and new methods', async () => {
  const acp = await loadModule();
  const methods = [];
  let listParams;
  const rt = runtime(async (state, message, { send }) => {
    if (!message.method) return;
    methods.push(message.method);
    if (message.method === 'initialize') initialize(state, message, send);
    else if (message.method === 'session/new') send(state, { jsonrpc: '2.0', id: message.id, result: { sessionId: 's-new', configOptions: configOptions() } });
    else if (message.method === 'session/list') {
      listParams = message.params;
      send(state, { jsonrpc: '2.0', id: message.id, result: { sessions: [{ sessionId: 's-old', cwd: '/work/project' }], nextCursor: null } });
    }
    else if (['session/load', 'session/resume'].includes(message.method)) send(state, { jsonrpc: '2.0', id: message.id, result: { configOptions: configOptions() } });
    else if (message.method === 'session/fork') send(state, { jsonrpc: '2.0', id: message.id, result: { sessionId: 's-fork', configOptions: configOptions() } });
    else send(state, { jsonrpc: '2.0', id: message.id, result: {} });
  });
  await acp.activate(rt.ctx);
  await acp.methods.start(rt.ctx, { conversationId: 'c1', workspaceId: 'ws-1', profileId: 'opencode' });
  const listed = await acp.methods.listSessions(rt.ctx, { conversationId: 'c1', limit: 10 });
  assert.equal(listed.sessions[0].sessionId, 's-old');
  assert.deepEqual(listParams, { cwd: '/work/project' });
  await acp.methods.loadSession(rt.ctx, { conversationId: 'c1', sessionId: 's-old' });
  await acp.methods.resumeSession(rt.ctx, { conversationId: 'c1', sessionId: 's-old' });
  await acp.methods.forkSession(rt.ctx, { conversationId: 'c1', sessionId: 's-old' });
  await acp.methods.closeSession(rt.ctx, { conversationId: 'c1' });
  await acp.methods.newSession(rt.ctx, { conversationId: 'c1' });
  await acp.methods.deleteSession(rt.ctx, { conversationId: 'c1', sessionId: 's-new' });
  assert.deepEqual(methods, ['initialize', 'session/new', 'session/list', 'session/load', 'session/resume', 'session/fork', 'session/close', 'session/new', 'session/delete']);
});

test('ACP reconnect prefers session/resume and falls back to session/load', async () => {
  for (const failResume of [false, true]) {
    const acp = await loadModule();
    const methods = [];
    const rt = runtime(async (state, message, { send }) => {
      if (!message.method) return;
      methods.push(message.method);
      if (message.method === 'initialize') initialize(state, message, send);
      else if (message.method === 'session/resume') {
        if (failResume) send(state, { jsonrpc: '2.0', id: message.id, error: { code: -32002, message: 'Resume unavailable' } });
        else send(state, { jsonrpc: '2.0', id: message.id, result: { configOptions: configOptions() } });
      } else if (message.method === 'session/load') send(state, { jsonrpc: '2.0', id: message.id, result: { configOptions: configOptions() } });
      else if (message.method === 'session/new') send(state, { jsonrpc: '2.0', id: message.id, result: { sessionId: 's-new' } });
    });
    await acp.activate(rt.ctx);
    const state = await acp.methods.start(rt.ctx, { conversationId: 'c1', workspaceId: 'ws-1', profileId: 'opencode', resumeSessionId: 's-old' });
    assert.equal(state.sessionId, 's-old');
    assert.deepEqual(methods.slice(1), failResume ? ['session/resume', 'session/load'] : ['session/resume']);
  }
});

test('Copilot reconnect continues to prefer session/load', async () => {
  const acp = await loadModule();
  const methods = [];
  const rt = runtime(async (state, message, { send }) => {
    if (!message.method) return;
    methods.push(message.method);
    if (message.method === 'initialize') initialize(state, message, send);
    else if (message.method === 'session/load') send(state, { jsonrpc: '2.0', id: message.id, result: { configOptions: configOptions() } });
    else if (message.method === 'session/resume') send(state, { jsonrpc: '2.0', id: message.id, result: { configOptions: configOptions() } });
  }, { plugins: [{ id: 'copilot-provider', enabled: true, contributes: copilotManifest.contributes }] });
  await acp.activate(rt.ctx);
  await acp.methods.start(rt.ctx, { conversationId: 'c1', workspaceId: 'ws-1', profileId: 'copilot', resumeSessionId: 's-old' });
  assert.deepEqual(methods.slice(1), ['session/load']);
});

test('ACP sends trusted systemPrompt append only on advertised new, load and resume requests', async () => {
  const acp = await loadModule();
  const requests = [];
  const capabilities = { ...agentCapabilities, sessionCapabilities: { ...agentCapabilities.sessionCapabilities, systemPrompt: {} } };
  const rt = runtime(async (state, message, { send }) => {
    if (!message.method) return;
    requests.push(message);
    if (message.method === 'initialize') initialize(state, message, send, capabilities);
    else if (message.method === 'session/new') send(state, { jsonrpc: '2.0', id: message.id, result: { sessionId: 's-new', configOptions: configOptions() } });
    else if (['session/load', 'session/resume'].includes(message.method)) send(state, { jsonrpc: '2.0', id: message.id, result: { configOptions: configOptions() } });
  });
  await acp.activate(rt.ctx);
  await acp.methods.start(rt.ctx, { conversationId: 'c1', workspaceId: 'ws-1', profileId: 'opencode', systemPrompt: 'Follow Hato instructions' });
  await acp.methods.loadSession(rt.ctx, { conversationId: 'c1', sessionId: 's-old' });
  await acp.methods.resumeSession(rt.ctx, { conversationId: 'c1', sessionId: 's-old' });
  for (const method of ['session/new', 'session/load', 'session/resume']) {
    const params = requests.find(request => request.method === method).params;
    assert.deepEqual(params.systemPrompt, { mode: 'append', content: [{ type: 'text', text: 'Follow Hato instructions' }] });
  }
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
      notify(state, 'session/update', { sessionId: 's-new', update: { sessionUpdate: 'usage_update', used: 1200, size: 100000, cost: { amount: 0.25, currency: 'USD' } } });
      send(state, { jsonrpc: '2.0', id: message.id, result: { stopReason: 'end_turn', usage: { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 } } });
    }
  });
  await acp.activate(rt.ctx);
  await acp.methods.start(rt.ctx, { conversationId: 'c1', workspaceId: 'ws-1', profileId: 'opencode' });
  const blocks = [{ type: 'resource_link', uri: 'file:///work/project/a.ts', name: 'a.ts' }, { type: 'resource', resource: { uri: 'file:///work/context', text: 'embedded context' } }];
  await acp.methods.prompt(rt.ctx, { conversationId: 'c1', prompt: blocks });
  const ended = await rt.waitFor('acp.turnEnded');
  assert.deepEqual(prompt, blocks);
  assert.deepEqual(ended.usage, { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 });
  assert.deepEqual(acp.methods.state(rt.ctx, { conversationId: 'c1' }).usage.cost, { amount: 0.25, currency: 'USD' });
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

test('ACP hides legacy terminal auth and rejects direct calls without spawning pipes', async () => {
  const acp = await loadModule();
  const rt = runtime(async (state, message, { send }) => {
    if (message.method === 'initialize') initialize(state, message, send);
    else if (message.method === 'session/new') send(state, { jsonrpc: '2.0', id: message.id, result: { sessionId: 's-new' } });
  });
  await acp.activate(rt.ctx);
  const state = await acp.methods.start(rt.ctx, { conversationId: 'c1', workspaceId: 'ws-1', profileId: 'opencode' });
  assert.deepEqual(state.authMethods, []);
  await assert.rejects(acp.methods.authenticate(rt.ctx, { conversationId: 'c1', methodId: 'opencode-login' }), /Unknown authentication/);
  assert.equal(rt.procs.size, 1);
});

test('ACP routes agent-driven authentication through authenticate', async () => {
  const acp = await loadModule();
  let request;
  const rt = runtime(async (state, message, { send }) => {
    if (!message.method) return;
    if (message.method === 'initialize') send(state, { jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1, agentCapabilities,
      authMethods: [{ id: 'agent-login', name: 'Agent login', type: 'agent' }] } });
    else if (message.method === 'session/new') send(state, { jsonrpc: '2.0', id: message.id, result: { sessionId: 's-new', configOptions: configOptions() } });
    else if (message.method === 'authenticate') { request = message.params; send(state, { jsonrpc: '2.0', id: message.id, result: {} }); }
  });
  await acp.activate(rt.ctx);
  await acp.methods.start(rt.ctx, { conversationId: 'c1', workspaceId: 'ws-1', profileId: 'opencode' });
  assert.deepEqual(await acp.methods.authenticate(rt.ctx, { conversationId: 'c1', methodId: 'agent-login' }), { outcome: 'authenticated', methodId: 'agent-login' });
  assert.deepEqual(request, { methodId: 'agent-login' });
  assert.equal(rt.procs.size, 1, 'agent-driven login does not spawn a terminal process');
});

test('ACP hides standard terminal methods including untrusted launch env', async () => {
  const acp = await loadModule();
  const rt = runtime(async (state, message, { send }) => {
    if (message.method === 'initialize') send(state, { jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1, agentCapabilities,
      authMethods: [{ id: 'terminal', type: 'terminal', env: { NODE_OPTIONS: '--require=/untrusted.js', PATH: '/untrusted' } }] } });
    else if (message.method === 'session/new') send(state, { jsonrpc: '2.0', id: message.id, result: { sessionId: 's-new' } });
  });
  await acp.activate(rt.ctx);
  const state = await acp.methods.start(rt.ctx, { conversationId: 'c1', workspaceId: 'ws-1', profileId: 'opencode' });
  assert.deepEqual(state.authMethods, []);
  await assert.rejects(acp.methods.authenticate(rt.ctx, { conversationId: 'c1', methodId: 'terminal' }), /Unknown authentication/);
  assert.equal(rt.procs.size, 1);
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

const startArgs = { conversationId: 'c1', workspaceId: 'ws-1', profileId: 'opencode' };
test('concurrent ACP starts share the full startup and prevent swaps before spawn', async () => {
  const acp = await loadModule();
  let initializeCount = 0;
  const rt = runtime(async (state, message, { send }) => {
    if (message.method === 'initialize') { initializeCount++; initialize(state, message, send); }
    else if (message.method === 'session/new') send(state, { jsonrpc: '2.0', id: message.id, result: { sessionId: 's-new' } });
  });
  await acp.activate(rt.ctx);
  const first = acp.methods.start(rt.ctx, startArgs), second = acp.methods.start(rt.ctx, startArgs);
  assert.equal(acp.canSwap().ok, false);
  await assert.rejects(acp.methods.stop(rt.ctx, startArgs), /operation is already running/);
  const states = await Promise.all([first, second]);
  assert.equal(initializeCount, 1); assert.equal(rt.procs.size, 1);
  assert.equal(states[0].status, 'ready'); assert.deepEqual(states[0], states[1]);
  assert.equal(acp.canSwap().ok, true);
});

test('lifecycle reservation rejects prompt/config/other mutations and rolls directories back on failure', async () => {
  const acp = await loadModule();
  let fail;
  const rt = runtime(async (state, message, { send }) => {
    if (message.method === 'initialize') initialize(state, message, send);
    else if (message.method === 'session/new') send(state, { jsonrpc: '2.0', id: message.id, result: { sessionId: 's-new' } });
    else if (message.method === 'session/resume') fail = () => send(state, { jsonrpc: '2.0', id: message.id, error: { code: -32603, message: 'Internal failure' } });
  });
  await acp.activate(rt.ctx); await acp.methods.start(rt.ctx, startArgs);
  const pending = acp.methods.resumeSession(rt.ctx, { ...startArgs, sessionId: 'other', additionalDirectories: ['/temporary'] });
  assert.equal(acp.canSwap().ok, false);
  for (const method of ['newSession', 'setConfig', 'authenticate', 'prompt']) await assert.rejects(acp.methods[method](rt.ctx, { ...startArgs, text: 'hello' }), /operation is already running/);
  fail(); await assert.rejects(pending, /Internal failure/);
  assert.deepEqual(acp.methods.state(rt.ctx, startArgs).additionalDirectories, []);
  assert.equal(acp.canSwap().ok, true);
});

test('resume authentication and internal errors surface without fallback or creating a session', async () => {
  for (const code of [-32000, -32602, -32603]) {
    const acp = await loadModule();
    const methods = [];
    const rt = runtime(async (state, message, { send }) => {
      methods.push(message.method);
      if (message.method === 'initialize') initialize(state, message, send);
      else send(state, { jsonrpc: '2.0', id: message.id, error: { code, message: 'Provider failure' } });
    });
    await acp.activate(rt.ctx);
    await assert.rejects(acp.methods.start(rt.ctx, { ...startArgs, resumeSessionId: 'old' }), /Provider failure/);
    assert.deepEqual(methods, ['initialize', 'session/resume']);
  }
});

test('failed session load signals replay discard and leaves the current session intact', async () => {
  const acp = await loadModule();
  const rt = runtime(async (state, message, { send, notify }) => {
    if (message.method === 'initialize') initialize(state, message, send);
    else if (message.method === 'session/new') send(state, { jsonrpc: '2.0', id: message.id, result: { sessionId: 's-new' } });
    else if (message.method === 'session/load') {
      notify(state, 'session/update', { sessionId: 'broken', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'partial' } } });
      send(state, { jsonrpc: '2.0', id: message.id, error: { code: -32603, message: 'Load failed' } });
    }
  });
  await acp.activate(rt.ctx); await acp.methods.start(rt.ctx, startArgs);
  await assert.rejects(acp.methods.loadSession(rt.ctx, { ...startArgs, sessionId: 'broken' }), /Load failed/);
  assert.equal((await rt.waitFor('acp.replayEnded')).success, false);
  assert.equal(acp.methods.state(rt.ctx, startArgs).sessionId, 's-new');
});

test('late timed-out prompt response cannot finish a newer turn', async () => {
  const acp = await loadModule();
  const prompts = [];
  const rt = runtime(async (state, message, { send }) => {
    if (message.method === 'initialize') initialize(state, message, send);
    else if (message.method === 'session/new') send(state, { jsonrpc: '2.0', id: message.id, result: { sessionId: 's-new' } });
    else if (message.method === 'session/prompt') prompts.push(() => send(state, { jsonrpc: '2.0', id: message.id, result: { stopReason: 'end_turn' } }));
  });
  await acp.activate(rt.ctx); await acp.methods.start(rt.ctx, startArgs);
  await acp.methods.prompt(rt.ctx, { ...startArgs, text: 'first', timeoutMs: 1000 });
  await rt.waitFor('acp.turnEnded', p => /timed out/.test(p.error));
  assert.ok(rt.writes.some(w => w.message.method === '$/cancel_request'));
  await acp.methods.prompt(rt.ctx, { ...startArgs, text: 'second' });
  prompts[0](); await new Promise(setImmediate);
  assert.equal(acp.methods.state(rt.ctx, startArgs).status, 'busy');
  assert.equal(rt.events.filter(e => e.name === 'acp.turnEnded').length, 1);
  prompts[1](); await new Promise(setImmediate);
  assert.equal(acp.methods.state(rt.ctx, startArgs).status, 'ready');
  assert.equal(rt.events.filter(e => e.name === 'acp.turnEnded').length, 2);
});

test('terminal authentication previews the invocation then launches an attempt-scoped native PTY',async()=>{
 const acp=await loadModule();const launches=[],writes=[];let closed=0;
 const rt=runtime(async(state,message,{send})=>{
  if(message.method==='initialize')send(state,{jsonrpc:'2.0',id:message.id,result:{protocolVersion:1,agentCapabilities,authMethods:[{id:'terminal',name:'Login',type:'terminal',args:['--login'],env:{ACP_INTERACTIVE_LOGIN:'1'}}]}});
  else if(message.method==='session/new')send(state,{jsonrpc:'2.0',id:message.id,result:{sessionId:'session'}});
 });
 rt.ctx.host.env.info=()=>({platform:'linux',hostFeatures:['pty.spawn']});
 rt.ctx.host.pty={spawn:async(_,request)=>{launches.push(request);return {handle:'pty'};},write:async(...a)=>writes.push(a),read:async()=>({text:'',cursor:0,exit:null}),close:async()=>{closed++;}};
 await acp.activate(rt.ctx);await acp.methods.start(rt.ctx,startArgs);
 const prepared=await acp.methods.authenticate(rt.ctx,{...startArgs,methodId:'terminal'});
 assert.equal(prepared.outcome,'prepared');assert.equal(launches.length,0);
 assert.match(prepared.display,/--login/);assert.deepEqual(prepared.envKeys,['ACP_INTERACTIVE_LOGIN']);
 const running=await acp.methods.authenticate(rt.ctx,{...startArgs,methodId:'terminal',confirmToken:prepared.confirmToken});
 assert.equal(running.kind,'pty');assert.equal(launches[0].executable,'/usr/bin/opencode');assert.deepEqual(launches[0].args,['acp','--login']);
 assert.equal(launches[0].env.ACP_INTERACTIVE_LOGIN,'1');assert.equal(acp.canSwap().ok,false);
 await assert.rejects(acp.methods.authInput(rt.ctx,{...startArgs,attemptId:'obsolete',data:'secret'}),/Stale/);
 await acp.methods.authInput(rt.ctx,{...startArgs,attemptId:running.attemptId,data:'choice\r'});assert.deepEqual(writes,[['pty','choice\r']]);
 await acp.methods.cancelAuth(rt.ctx,{...startArgs,attemptId:running.attemptId});assert.equal(closed,1);assert.equal(acp.canSwap().ok,true);
});

test('terminal auth rejects startup/lookup env and policy-removed credentials before launch',async()=>{
 for(const env of [{NODE_OPTIONS:'--require=/untrusted.js'},{PATH:'/untrusted'},{HTTPS_PROXY:'https://untrusted'},{BASH_ENV:'/untrusted'}]){
  const acp=await loadModule();const rt=runtime(async(state,message,{send})=>{
   if(message.method==='initialize')send(state,{jsonrpc:'2.0',id:message.id,result:{protocolVersion:1,agentCapabilities,authMethods:[{id:'terminal',type:'terminal',args:[],env}]}});
   else if(message.method==='session/new')send(state,{jsonrpc:'2.0',id:message.id,result:{sessionId:'session'}});
  });
  rt.ctx.host.env.info=()=>({platform:'linux',hostFeatures:['pty.spawn']});
  await acp.activate(rt.ctx);await acp.methods.start(rt.ctx,startArgs);
  await assert.rejects(acp.methods.authenticate(rt.ctx,{...startArgs,methodId:'terminal'}),/Unsafe authentication/);
  assert.equal(rt.procs.size,1);
 }
});

test('close/delete not-found responses settle idempotently and malformed load responses discard replay',async()=>{
 const acp=await loadModule();const rt=runtime(async(state,message,{send})=>{
  if(message.method==='initialize')initialize(state,message,send);
  else if(message.method==='session/new')send(state,{jsonrpc:'2.0',id:message.id,result:{sessionId:'session'}});
  else if(message.method==='session/load')send(state,{jsonrpc:'2.0',id:message.id,result:{sessionId:'wrong'}});
  else send(state,{jsonrpc:'2.0',id:message.id,error:{code:-32002,message:'Not found'}});
 });
 await acp.activate(rt.ctx);await acp.methods.start(rt.ctx,startArgs);
 await acp.methods.closeSession(rt.ctx,startArgs);await acp.methods.deleteSession(rt.ctx,{...startArgs,sessionId:'session'});
 assert.equal(acp.methods.state(rt.ctx,startArgs).sessionId,null);
 await assert.rejects(acp.methods.loadSession(rt.ctx,{...startArgs,sessionId:'broken'}),/Invalid session setup/);
 assert.equal((await rt.waitFor('acp.replayEnded')).success,false);assert.equal(acp.methods.state(rt.ctx,startArgs).status,'error');
});
