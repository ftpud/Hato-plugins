import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'modules/services/opencode-provider/src/index.ts');
const sdkRoot = process.env.HATO_SDK_ROOT || (fs.existsSync(path.join(root, '../sdk/types.ts')) ? path.join(root, '../sdk') : path.join(root, '../Hato-upstream/sdk'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'modules/services/opencode-provider/manifest.json'), 'utf8'));
const provider = manifest.contributes.agentProviders[0];
let importVersion = 0;

async function loadModule() {
  const result = await build({ entryPoints: [source], alias: { '@hato/sdk': sdkRoot }, bundle: true, format: 'esm', platform: 'node', write: false });
  const code = result.outputFiles[0].text;
  return (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}#${++importVersion}`)).default;
}

const usageResponse = () => JSON.stringify({
  location: { directory: '/work/project' },
  data: {
    workspace: { id: 'org-1', name: 'Personal', usageURL: 'https://opencode.ai/console/org-1/activity/overview' },
    go: {
      rolling: { percent: 53, limited: false, resetsAt: 1795649559000 },
      weekly: { percent: 21, limited: false, resetsAt: 1795996800000 },
      monthly: { percent: 10, limited: false, resetsAt: 1798222757000 },
    },
    budgets: [],
  },
});

test('OpenCode uses its native ACP command and official CLI package', () => {
  assert.equal(provider.id, 'opencode');
  assert.equal(provider.profile.id, 'opencode');
  assert.equal(provider.profile.executable, 'opencode');
  assert.deepEqual(provider.profile.args, ['acp']);
  assert.deepEqual(provider.adapter, { pkg: '@opencode/cli', bin: 'opencode' });
  assert.equal(provider.mcpLaunch, undefined);
  assert.equal(provider.usageCommand, 'module:limits');
});

test('OpenCode provider is marketplace-only with scoped process capabilities', () => {
  assert.equal(manifest.distribution, 'marketplace');
  assert.equal(manifest.pluginPackage, 'opencode-acp');
  assert.deepEqual(manifest.provides, ['ai.provider']);
  assert.deepEqual(manifest.dependencies, ['workspace']);
  assert.deepEqual(manifest.calls, ['workspace', 'cloud']);
  assert.deepEqual(manifest.capabilities, ['process.scope', 'ssh.connect']);
});

test('provider parses rolling, weekly and monthly OpenCode Go plan windows', async () => {
  const module = await loadModule();
  const snap = module.methods.parseLimits(null, { text: usageResponse() });
  assert.equal(snap.provider, 'opencode');
  assert.equal(snap.plan, 'Personal · OpenCode Go');
  assert.deepEqual(snap.windows.map((window) => [window.id, window.label, window.usedPercent]), [
    ['five_hour', '5h', 53], ['seven_day', 'Wk', 21], ['monthly', 'Mo', 10],
  ]);
  assert.equal(snap.windows[0].resetsAt, 1795649559000);
  assert.equal(snap.error, null);
});

test('provider leaves ACP usage_update data on the context-meter path', async () => {
  const module = await loadModule();
  const previous = module.methods.parseLimits(null, { text: usageResponse() });
  assert.equal(module.methods.sessionLimits(null, { update: { sessionUpdate: 'usage_update', used: 1500, size: 200000 }, previous }), null);
});

test('provider uses the supplied OpenCode binary, environment and cwd for plan usage', async () => {
  const module = await loadModule();
  const calls = [];
  let released = null;
  const desc = { id: 'project:1:root', location: 'local', machineId: 'local', rootAbsolutePath: '/fallback' };
  const ctx = {
    modules: { call: async (id, method) => {
      assert.deepEqual([id, method], ['workspace', 'resolve']);
      return desc;
    } },
    host: {
      capabilities: { request: async () => ({ grant: 'grant-1' }), release: async (grant) => { released = grant; } },
      process: { run: async (grant, request) => {
        calls.push({ grant, request });
        return { code: 0, signal: null, stdout: usageResponse(), stderr: '', truncated: false };
      } },
    },
  };
  const snap = await module.methods.limits(ctx, {
    workspaceId: desc.id, executablePath: '/custom/opencode', env: { OPENCODE_CONFIG: '/custom/config' }, envRemove: ['TOKEN'], cwd: '/custom/work',
  });
  assert.equal(snap.windows[0].usedPercent, 53);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].grant, 'grant-1');
  assert.equal(calls[0].request.executable, '/custom/opencode');
  assert.deepEqual(calls[0].request.args, ['api', 'experimental.usage.limits']);
  assert.equal(calls[0].request.cwd, '/custom/work');
  assert.deepEqual(calls[0].request.env, { OPENCODE_CONFIG: '/custom/config' });
  assert.deepEqual(calls[0].request.envRemove, ['TOKEN']);
  assert.equal(released, 'grant-1');
});

test('provider reports a missing Console connection without inventing plan data', async () => {
  const module = await loadModule();
  const snap = module.methods.parseLimits(null, { text: JSON.stringify({ data: null }) });
  assert.deepEqual(snap.windows, []);
  assert.match(snap.error, /Connect OpenCode Console/);
});

test('provider retries with a PATH-augmented shell when opencode is not found', async () => {
  const module = await loadModule();
  const runs = [];
  const desc = { id: 'ws', location: 'local', machineId: 'local', rootAbsolutePath: '/work/project' };
  const ctx = {
    modules: { call: async () => desc },
    host: {
      capabilities: { request: async () => ({ grant: 'g' }), release: async () => {} },
      process: { run: async (_grant, request) => {
        runs.push(request);
        if (request.executable === 'opencode') return { code: 127, signal: null, stdout: '', stderr: 'opencode: command not found', truncated: false };
        return { code: 0, signal: null, stdout: usageResponse(), stderr: '', truncated: false };
      } },
    },
  };
  const snap = await module.methods.limits(ctx, { workspaceId: desc.id });
  assert.equal(snap.windows[0].usedPercent, 53);
  assert.equal(runs[1].executable, 'sh');
  assert.deepEqual(runs[1].args.slice(-2), ['api', 'experimental.usage.limits']);
});

test('provider does not replace an explicit missing executable through PATH fallback', async () => {
  const module = await loadModule();
  const runs = [];
  const desc = { id: 'ws', location: 'local', machineId: 'local', rootAbsolutePath: '/work/project' };
  const ctx = {
    modules: { call: async () => desc },
    host: {
      capabilities: { request: async () => ({ grant: 'g' }), release: async () => {} },
      process: { run: async (_grant, request) => {
        runs.push(request);
        return { code: 127, signal: null, stdout: '', stderr: 'missing', truncated: false };
      } },
    },
  };
  await assert.rejects(module.methods.limits(ctx, { workspaceId: desc.id, executablePath: '/missing/opencode' }), /unavailable/);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].executable, '/missing/opencode');
});
