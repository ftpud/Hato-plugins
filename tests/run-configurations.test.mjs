import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { randomUUID } from 'node:crypto';
const sdk = new URL('../../sdk', import.meta.url).pathname;
const load = async path => import('data:text/javascript;base64,' + Buffer.from((await build({
  entryPoints: [new URL(path, import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', write: false, alias: { '@hato/sdk': sdk },
})).outputFiles[0].text).toString('base64'));

if (!globalThis.crypto) globalThis.crypto = { randomUUID };
const { projectGroups, groupTools } = await load('../modules/services/projects/src/groups.ts');
const { normalizeConfig, parseEnv } = await load('../modules/services/run-configurations/src/config.ts');
const { detectJavaRuns } = await load('../modules/services/language-java/src/run-configs.ts');
const { detectJsRuns } = await load('../modules/services/language-typescript/src/run-configs.ts');

test('project groups persist order, active tab and multi-membership and prune removed projects', async () => {
  let saved = null, ids = [{ id: 'first' }, { id: 'other' }];
  const ctx = { modules: { call: async (_m, method, a) => {
    if (method === 'projects.list') return ids;
    if (method === 'settings.get') return structuredClone(saved);
    saved = structuredClone(a.value);
  } }, events: { emit() {} } };
  const act = (op, args) => projectGroups(ctx, op, args);
  const work = (await act('create', { name: 'Work', projectId: 'first' })).created;
  const lab = (await act('create', { name: 'Lab', projectId: 'first', activate: true })).created;
  await act('assign', { id: work.id, projectId: 'other' });
  await act('rename', { id: lab.id, name: 'Research' });
  await act('reorder', { ids: [lab.id, work.id] });
  assert.deepEqual((await act('list')).groups.map(g => [g.name, g.projectIds]), [['Research', ['first']], ['Work', ['first', 'other']]]);
  assert.equal((await act('list')).active, lab.id);
  await assert.rejects(act('delete', { id: lab.id }), /Confirm/);
  await act('delete', { id: lab.id, confirm: true });
  assert.equal((await act('list')).active, 'all');
  assert.equal(ids.length, 2);
  ids = ids.filter(p => p.id !== 'first');
  await act('list');
  assert.deepEqual(saved.groups[0].projectIds, ['other']);
  assert.equal(groupTools(ctx).length, 8);
});

test('run config validation preserves argv and dotenv preserves quoting and multiline values', () => {
  const config = normalizeConfig({ name: 'Node', type: 'node', target: 'app.ts', args: ['a b', '', '--ordinary-argument'], envFiles: ['.env', 'env/.local'],
    env: { API_TOKEN: 'private' }, profiles: ['test'], beforeLaunch: [{ kind: 'npm', executable: 'build' }] });
  assert.deepEqual(config.args, ['a b', '', '--ordinary-argument']);
  assert.deepEqual(config.envFiles, ['.env', 'env/.local']);
  assert.equal(config.beforeLaunch[0].kind, 'npm');
  assert.throws(() => normalizeConfig({ ...config, cwd: '../outside' }), /relative/);
  assert.throws(() => normalizeConfig({ ...config, env: { 'A=B': 'x' } }), /variable name/);
  assert.deepEqual(parseEnv('export FIRST=one # comment\nAPI_TOKEN="one#two"\nQUOTE="a\\n\\\"b"\nBLOCK=\'first\nsecond\'\nEMPTY=\n', '.env'),
    [['FIRST', 'one'], ['API_TOKEN', 'one#two'], ['QUOTE', 'a\n"b'], ['BLOCK', 'first\nsecond'], ['EMPTY', '']]);
});

test('Java/JS providers detect main, Spring Boot, JUnit, build and package targets', () => {
  const java = detectJavaRuns({ paths: ['pom.xml', 'lib/build.gradle.kts'], sources: [
    { path: 'src/main/java/App.java', text: 'package sample;\n@SpringBootApplication\nclass App { public static void main(String[] args) {} }' },
    { path: 'lib/src/test/java/Test.java', text: 'package sample; class Test { @Test void check() {} }' },
  ] });
  assert.ok(java.some(c => c.type === 'spring-boot' && c.target === 'sample.App' && c.line === 1));
  assert.ok(java.some(c => c.type === 'java-application' && c.target === 'sample.App'));
  assert.ok(java.some(c => c.type === 'junit' && c.target === 'sample.Test' && c.cwd === 'lib'));
  assert.ok(java.some(c => c.type === 'java-maven' && c.target === 'package'));
  const js = detectJsRuns({ paths: ['packages/cli/start.ts', 'packages/cli/math.test.ts', 'server.js'], sources: [
    { path: 'packages/cli/package.json', text: '{"scripts":{"build":"tsc"}, "bin":{"command":"start.ts"},"devDependencies":{"vitest":"*"}}' },
  ] });
  assert.ok(js.some(c => c.type === 'npm-script' && c.target === 'build' && c.cwd === 'packages/cli'));
  assert.ok(js.some(c => c.type === 'node' && c.target === 'start.ts'));
  assert.ok(js.some(c => c.type === 'vitest' && c.target === 'math.test.ts'));
  assert.ok(js.some(c => c.type === 'node' && c.target === 'server.js'));
});
