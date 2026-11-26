import { fileURLToPath } from "node:url";
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const load=async path=>{
 const r=await build({entryPoints:[fileURLToPath(new URL(path,import.meta.url))],bundle:true,format:'esm',write:false,alias:{'@hato/sdk':fileURLToPath(new URL('../../sdk',import.meta.url))}});
 return import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));
};
const sdk=await load('../../sdk/prompt-history.ts');
const diffs=await load('../../sdk/chat-diffs.ts');
const base={source:'chat',sessionId:'c1',sessionTitle:'Chat',agent:'Claude'};

test('prompts group the file edits of their turn, merged per file',()=>{
 const [a]=diffs.acpDiffs([{type:'diff',path:'/w/src/a.ts',oldText:'x\ny\n',newText:'x\nY\n'}]);
 const [b]=diffs.acpDiffs([{type:'diff',path:'/w/src/a.ts',oldText:'x\nY\n',newText:'x\nY\nz\n'}]);
 const [n]=diffs.acpDiffs([{type:'diff',path:'/w/new.md',newText:'hi\n'}]);
 const turns=sdk.promptTurns([
  {key:'m1',role:'user',text:'first',at:1},
  {key:'t1',role:'tool',diffs:[a]},{key:'t2',role:'tool',diffs:[b,n]},
  {key:'m2',role:'user',text:'second',at:2},
  {key:'t3',role:'tool'},
 ],base);
 assert.equal(turns.length,2);
 assert.equal(turns[0].id,'chat:c1:m1');
 assert.deepEqual(turns[0].files.map(f=>[f.path,f.added,f.removed,f.edits.length,!!f.newFile]),[['/w/src/a.ts',2,1,2,false],['/w/new.md',1,0,1,true]]);
 assert.equal(turns[1].files.length,0);
 const patch=sdk.promptPatch(turns[0].files,'/w');
 assert.match(patch,/^diff --git a\/src\/a\.ts b\/src\/a\.ts\n--- a\/src\/a\.ts\n\+\+\+ b\/src\/a\.ts\n@@/);
 assert.match(patch,/diff --git a\/new\.md b\/new\.md\nnew file mode 100644\n--- \/dev\/null\n\+\+\+ b\/new\.md\n@@ -0,0 \+1,1 @@\n\+hi\n/);
});

test('merged history is newest first and keeps untimed entries',()=>{
 const e=(id,at)=>({...base,id,prompt:id,at,files:[]});
 assert.deepEqual(sdk.mergePromptEntries([[e('a',1),e('c',3)],[e('b',2),e('x',null)]]).map(x=>x.id),['c','b','a','x']);
 assert.equal(sdk.epochOf('2026-11-26T10:00:00.000Z'),Date.parse('2026-11-26T10:00:00.000Z'));
 assert.equal(sdk.promptAge(Date.now()-5*60000),'5m');
});

test('latest recorded activity determines ordering across prompts and project changes',()=>{
 const e=(id,at,updatedAt)=>({...base,id,prompt:id,at,updatedAt,files:[]});
 assert.deepEqual(sdk.mergePromptEntries([
  [e('older-prompt-new-edit',100,400),e('recent-prompt',300)],
  [e('project-change',200),e('undated-first',null),e('undated-second',null)],
 ]).map(entry=>entry.id),['older-prompt-new-edit','recent-prompt','project-change','undated-first','undated-second']);
});
