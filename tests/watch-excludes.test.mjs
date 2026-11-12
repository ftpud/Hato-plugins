import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const sdk = new URL('../../sdk', import.meta.url).pathname;
const gitignore = new URL('../modules/services/files/src/gitignore.ts', import.meta.url).pathname;
// `ignoredSet` is stubbed: tests set `globalThis.ignoredDirs` to Git's answer (null = no repository).
const stub = { name: 'stub-gitignore', setup(b) {
  b.onResolve({ filter: /\.\/gitignore$/ }, () => ({ path: gitignore, namespace: 'stub' }));
  b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const ignoredSet = async () => globalThis.ignoredDirs ? { dirs: globalThis.ignoredDirs, files: new Set() } : null;', loader: 'js' }));
} };
const load = async (path, plugins = []) => import('data:text/javascript;base64,' + Buffer.from((await build({ entryPoints: [new URL(path, import.meta.url).pathname], bundle: true, format: 'esm', write: false, alias: { '@hato/sdk': sdk }, plugins })).outputFiles[0].text).toString('base64'));
const ex = await load('../modules/services/files/src/watch-excludes.ts', [stub]);
const { fileWatch } = await load('../../sdk/file-watch.ts');

test('"Also skip" entries: names, root-anchored paths, and nothing unsafe', () => {
  assert.deepEqual(ex.parseExtra('out, generated\n/tmp\n packages/web/dist/ ,*.egg-info'), ['out', 'generated', 'tmp/', 'packages/web/dist/', '*.egg-info']);
  assert.deepEqual(ex.parseExtra('../up, -rf, !keep, a/../b, ok'), ['ok']);
});

test('exclusions combine defaults, Git-ignored folders and the user list, per preference', async () => {
  globalThis.ignoredDirs = ['dist/', 'app/build/', '-weird/', 'x/../y/'];
  const all = await ex.watchExcludes({}, {}, { defaults: true, gitignored: true, extra: 'out' });
  assert.ok(all.includes('node_modules') && all.includes('.git'));
  assert.ok(all.includes('dist/') && all.includes('app/build/') && all.includes('out'));
  assert.ok(!all.some(p => p.startsWith('-') || p.includes('..')), 'unsafe Git paths are dropped');
  assert.deepEqual(await ex.watchExcludes({}, {}, { defaults: false, gitignored: false, extra: '' }), []);
  globalThis.ignoredDirs = null; // outside a repository
  assert.deepEqual(await ex.watchExcludes({}, {}, { defaults: false, gitignored: true, extra: 'out' }), ['out']);
  globalThis.ignoredDirs = Array.from({ length: 5000 }, (_, i) => `d${i}/`);
  assert.ok((await ex.watchExcludes({}, {}, { defaults: true, gitignored: true, extra: '' })).length <= 1500, 'bounded below the kernel limit');
});

test('fileWatch passes exclusions and keeps warnings out of change notifications', async () => {
  let onData, watchArgs;
  const ctx = {
    log: { warn() {} },
    modules: { call: async () => ({ id: 'ws', machineId: 'local', location: 'local', rootAbsolutePath: '/p' }) },
    capabilities: {},
    host: {
      capabilities: { request: async () => ({ grant: 'g' }), release: async () => {} },
      fs: { watch: async (...a) => { watchArgs = a; return { handle: 'h' }; } },
      streams: { listen: async (_h, _o, data) => { onData = data; return { close: async () => {} }; } },
      resources: { release: async () => {} },
    },
  };
  // workspaceGrant resolves through ctx; give it what it needs.
  ctx.modules.call = async (_m, method) => method === 'grant' || method === 'resolve' ? { grant: 'g', id: 'ws' } : { grant: 'g' };
  const changes = [], warnings = [];
  const w = fileWatch(ctx, id => changes.push(id), { warning: (id, text) => warnings.push([id, text]) });
  await w.select({ id: 'ws', machineId: 'local', location: 'local', rootAbsolutePath: '/p' }, undefined, { exclude: ['node_modules', 'dist/'] });
  assert.deepEqual(watchArgs?.[2], { exclude: ['node_modules', 'dist/'] });
  onData('warning watch limit reached: some folders are not watched\n');
  assert.deepEqual(changes, [], 'a warning alone is not a change');
  assert.deepEqual(warnings, [['ws', 'watch limit reached: some folders are not watched']]);
  onData('changed\nwarning again\n');
  assert.deepEqual(changes, ['ws']);
  onData('ready\n');
  assert.equal(changes.length, 2);
  await w.stop();
});
