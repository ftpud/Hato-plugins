import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = await build({ entryPoints: [path.join(root, 'modules/ui/ai/src/elicitation.ts')], bundle: true, format: 'esm', write: false });
const { initialElicitationValues, validateElicitation } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const schema = {
  type: 'object', required: ['name', 'strategy', 'count'], properties: {
    name: { type: 'string', default: 'Ada', minLength: 2 },
    strategy: { type: 'string', enum: ['safe', 'fast'] },
    count: { type: 'integer', default: 2, minimum: 1, maximum: 5 },
    ratio: { type: 'number', minimum: 0, maximum: 1 },
    notify: { type: 'boolean', default: true },
    tags: { type: 'array', items: { enum: ['one', 'two'] }, default: ['one'], minItems: 1, maxItems: 2 },
    note: { type: 'string' },
  },
};

test('elicitation defaults and validation produce primitive ACP response content', () => {
  const values = { ...initialElicitationValues(schema), strategy: 'safe', ratio: '0.5' };
  const result = validateElicitation(schema, values);
  assert.deepEqual(result.errors, {});
  assert.deepEqual(result.content, { name: 'Ada', strategy: 'safe', count: 2, ratio: 0.5, notify: true, tags: ['one'] });
});

test('elicitation validates required fields, enums, integer ranges and multi-select bounds', () => {
  const values = { ...initialElicitationValues(schema), name: '', strategy: 'unsafe', count: '2.5', ratio: 2, tags: ['one', 'two', 'bad'] };
  const result = validateElicitation(schema, values);
  assert.match(result.errors.name, /required/);
  assert.match(result.errors.strategy, /one of/);
  assert.match(result.errors.count, /whole number/);
  assert.match(result.errors.ratio, /at most/);
  assert.match(result.errors.tags, /unsupported choice/);
  assert.equal(Object.hasOwn(result.content, 'note'), false);
});

test('malformed and prototype-mutating elicitation schemas fail closed', () => {
  const schema = JSON.parse('{"type":"object","properties":{"broken":null,"__proto__":{"type":"string"}}}');
  const result = validateElicitation(schema, { broken: 'x' });
  assert.match(result.errors._schema, /invalid schema|Unsafe field name/);
  assert.deepEqual(result.content, {});
});

test('unknown elicitation property types are rejected instead of rendered as invented input', () => {
  const result = validateElicitation({ type: 'object', properties: { custom: { type: 'future' } } }, { custom: 'value' });
  assert.match(result.errors._schema, /unsupported schema type/);
  assert.deepEqual(result.content, {});
});

test('pattern validation rejects overlapping repetitions and exponential optional chains',()=>{
 for(const pattern of ['^a*a*a*a*z$','^a?a?a?a?a?z$','a+z','^(a+)+$']){
  const result=validateElicitation({type:'object',properties:{answer:{type:'string',pattern}}},{answer:'a'.repeat(16000)});
  assert.ok(result.errors._schema);
 }
 assert.deepEqual(validateElicitation({type:'object',properties:{answer:{type:'string',pattern:'^[A-Za-z0-9_-]+$'}}},{answer:'valid_123'}).errors,{});
});
