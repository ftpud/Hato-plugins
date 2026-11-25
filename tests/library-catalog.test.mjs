import { fileURLToPath } from "node:url";
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const result=await build({entryPoints:[fileURLToPath(new URL('../../sdk/library.ts',import.meta.url))],bundle:true,format:'esm',write:false});
const lib=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const item=(id,extra={})=>({id,kind:'skill',name:id,description:'',projectId:null,machines:[],text:`# ${id}`,paths:['SKILL.md'],revision:1,...extra});
const catalog={items:[
  item('everywhere'),
  item('ssh-only',{machines:['ssh:box']}),
  item('project',{projectId:'p1'}),
  item('other-project',{projectId:'p2'}),
  item('agent',{kind:'agent',paths:['AGENT.md']}),
],machines:[]};

test('global Library entries follow their machine allow-list; project entries stay in their project',()=>{
  const local=lib.libraryItemsFor(catalog,{projectId:'p1',machineId:'local'},'skill').map(i=>i.id);
  assert.deepEqual(local,['project','everywhere']);
  const ssh=lib.libraryItemsFor(catalog,{projectId:'p3',machineId:'ssh:box'},'skill').map(i=>i.id);
  assert.deepEqual(ssh,['everywhere','ssh-only']);
  assert.deepEqual(lib.libraryItemsFor(catalog,{projectId:'p1',machineId:'local'},'agent').map(i=>i.id),['agent']);
  assert.deepEqual(lib.libraryItemsFor(undefined,{machineId:'local'},'skill'),[]);
  assert.deepEqual(lib.libraryItemsFor(catalog,null,'skill'),[]);
});

test('Library refs and instructions point agents at nested files through the Library tools',()=>{
  const ref=lib.libraryRef('abc');
  assert.equal(ref,'library:abc');assert.ok(lib.isLibraryRef(ref));assert.equal(lib.libraryRefId(ref),'abc');
  assert.ok(!lib.isLibraryRef('.agents/skills/x/SKILL.md'));
  assert.equal(lib.libraryInstructions(item('plain')),'# plain');
  const text=lib.libraryInstructions(item('nested',{paths:['SKILL.md','refs/a.md']}));
  assert.match(text,/refs\/a\.md/);assert.match(text,/scope "global", id "nested"/);
  assert.notEqual(lib.textDigest('a'),lib.textDigest('b'));assert.equal(lib.textDigest('same'),lib.textDigest('same'));
});
