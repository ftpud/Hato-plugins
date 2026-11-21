import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
const sdk = new URL('../../sdk', import.meta.url).pathname;
const load = async path => import('data:text/javascript;base64,' + Buffer.from((await build({
  entryPoints: [path], bundle: true, platform: 'node', format: 'esm', write: false, alias: { '@hato/sdk': sdk },
})).outputFiles[0].text).toString('base64'));

const { findLocations, runActive, RUN_UI_EVENTS } = await load(`${sdk}/run.ts`);
const spans = text => findLocations(text).map(f => ({ span: text.slice(f.start, f.end), ...f.location }));

test('Java frames link the file:line span and resolve by package path', () => {
  assert.deepEqual(spans('\tat com.acme.orders.OrderService$Inner.place(OrderService.java:42)'),
    [{ span: 'OrderService.java:42', suffix: 'com/acme/orders/OrderService.java', line: 41 }]);
  assert.deepEqual(spans('\tat Main.main(Main.java:3)'), [{ span: 'Main.java:3', suffix: 'Main.java', line: 2 }]);
});

test('Node frames link absolute paths, file URLs and keep the column', () => {
  assert.deepEqual(spans('    at Object.<anonymous> (/srv/app/src/index.ts:12:5)'),
    [{ span: '/srv/app/src/index.ts:12:5', path: '/srv/app/src/index.ts', line: 11, character: 4 }]);
  assert.deepEqual(spans('file:///srv/app/a.mjs:7'), [{ span: 'file:///srv/app/a.mjs:7', path: '/srv/app/a.mjs', line: 6, character: 0 }]);
});

test('runtime internals and plain text produce no links', () => {
  assert.deepEqual(spans('    at node:internal/modules/cjs/loader:1105:14'), []);
  assert.deepEqual(spans('Exception in thread "main" java.lang.NullPointerException'), []);
});

test('run UI events are namespaced to their publishing module', () => {
  // The kernel broker only lets a module emit `<moduleId>.*`.
  assert.ok(RUN_UI_EVENTS.editConfiguration.startsWith('run-bar.'));
  assert.ok(RUN_UI_EVENTS.revealSession.startsWith('run-bar.'));
  assert.ok(RUN_UI_EVENTS.openLocation.startsWith('run-panel.'));
  assert.equal(runActive({ state: 'paused' }), true);
  assert.equal(runActive({ state: 'exited' }), false);
});
