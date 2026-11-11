import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const root = new URL('../', import.meta.url);
const code = (await build({ entryPoints: [new URL('modules/ui/viewer/src/assist.ts', root).pathname], bundle: true, format: 'esm', platform: 'node', write: false })).outputFiles[0].text;
const a = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

// Shapes recorded from Eclipse JDT LS 1.63.
const items = [
  { label: 'baseField', kind: 5, detail: 'Base.baseField : int', labelDetails: { description: 'int' }, sortText: '999999034', filterText: 'baseField', insertText: 'baseField', data: { pid: '0' } },
  { label: 'synchronisationComponent', kind: 5, detail: 'Helper.synchronisationComponent : SyncComponent', labelDetails: { description: 'SyncComponent' }, sortText: '999999034', filterText: 'synchronisationComponent', insertText: 'synchronisationComponent', data: { pid: '1' } },
  { label: 'equals', kind: 2, detail: 'Object.equals(Object obj) : boolean', labelDetails: { detail: '(Object obj)', description: 'boolean' }, sortText: '999999035', filterText: 'equals(Object obj) : boolean', insertText: 'equals', data: { pid: '3' } },
  { label: 'getDeleteRequest', kind: 2, detail: 'Helper.getDeleteRequest(UUID artIDCalculation, boolean flag) : String', labelDetails: { detail: '(UUID artIDCalculation, boolean flag)', description: 'String' }, sortText: '999999035', filterText: 'getDeleteRequest(UUID artIDCalculation, boolean flag) : String', insertText: 'getDeleteRequest', data: { pid: '5' } },
];

test('own members are bold, iconed and listed first; originals stay resolvable', () => {
  const originals = new Map(), key = i => `${i.label}\u0000${JSON.stringify(i.data)}`;
  const shaped = a.shapeCompletions(items, 'Helper', originals, key);
  assert.deepEqual(shaped.map(i => [i.label, i.data.presentation.bold]), [
    ['synchronisationComponent', true], ['getDeleteRequest(UUID artIDCalculation, boolean flag)', true], ['baseField', false], ['equals(Object obj)', false]]);
  const m = shaped[1];
  assert.equal(m.data.presentation.mutedFrom, 'getDeleteRequest'.length);
  assert.equal(m.detail, 'String');
  assert.equal(m.insertText, 'getDeleteRequest');
  assert.equal(m.data.presentation.icon.text, 'm');
  assert.equal(shaped[0].data.presentation.icon.text, 'f');
  assert.equal(originals.get(key(m)), items[3]);
  assert.equal(a.declaringType(items[2]), 'Object');
});

test('receiver and its type are found for member completion', () => {
  assert.deepEqual(a.receiverAt('        this.requestBuilder.get', 32), { name: 'requestBuilder', character: 13 });
  assert.deepEqual(a.receiverAt('x = foo(1, bar()).', 18), { name: 'foo', character: 4 });
  assert.equal(a.receiverAt('    getDel', 10), null);
  assert.equal(a.hoverType({ contents: [{ language: 'java', value: 'Helper requestBuilder' }] }), 'Helper');
  assert.equal(a.hoverType({ contents: [{ language: 'java', value: 'Map<String, List<A>> m - Main.f(UUID)' }] }), 'Map');
  assert.equal(a.hoverType({ contents: [{ language: 'java', value: 'String Helper.getDeleteRequest(UUID a, boolean b)' }] }), 'String');
  assert.equal(a.enclosingType('class A { class B { void f() { x', 30), 'B');
});

test('method hover becomes owner, multi-line signature, compact params and project', () => {
  const hover = { contents: [{ language: 'java', value: 'String Helper.getDeleteRequest(UUID artIDCalculation, boolean flag)' },
    'returns the payload of the onPremArt which should be deleted\n\n* **Parameters:**\n  * **artIDCalculation** the art node ID of the calculation\n  * **flag** a flag\n* **Returns:**\n  * the payload',
    'Source: *[proj_68d7df02](file:///w/src/main/java/com/acme/Helper.java#13)*'] };
  const value = a.shapeHover(hover).contents.value;
  assert.match(value, /^\*com\.acme\.Helper\*/);
  assert.ok(value.includes('```java\nString getDeleteRequest(\n    UUID artIDCalculation,\n    boolean flag\n)\n```'), value);
  assert.ok(value.includes('**Params:** `artIDCalculation` – the art node ID of the calculation'), value);
  assert.ok(value.includes('the calculation\\\n`flag` – a flag'), value);
  assert.ok(value.includes('**Returns:** the payload'), value);
  assert.ok(value.endsWith('*proj*'), value);
});

test('variable hover shows its type and local declaration', () => {
  const text = 'class Main {\n  void f(UUID artID) {\n    String deleteEntity = this.requestBuilder\n        .getDeleteRequest(artID, true);\n  }\n}';
  const hover = { contents: [{ language: 'java', value: 'String deleteEntity - Main.f(UUID)' }, 'Source: *[proj_68d7df02](file:///w/src/Main.java#3)*'] };
  const value = a.shapeHover(hover, { text, path: 'src/Main.java' }).contents.value;
  assert.ok(value.startsWith('```java\nString deleteEntity = this.requestBuilder .getDeleteRequest(artID, true)\n```'), value);
  assert.ok(value.includes('*in Main.f(UUID)*'), value);
  const param = a.shapeHover({ contents: [{ language: 'java', value: 'UUID artID - Main.f(UUID)' }, 'Source: *[p](file:///w/src/Main.java#2)*'] }, { text, path: 'src/Main.java' }).contents.value;
  assert.ok(param.startsWith('```java\nUUID artID\n```'), param);
  const field = a.shapeHover({ contents: [{ language: 'java', value: 'Helper requestBuilder' }] }).contents.value;
  assert.equal(field, '```java\nHelper requestBuilder\n```');
  assert.equal(a.shapeHover({ contents: '' }), null);
  assert.equal(a.shapeHover({ contents: [] }), null);
  const plain = { contents: { kind: 'markdown', value: 'just text' } };
  assert.equal(a.shapeHover(plain), plain);
});
