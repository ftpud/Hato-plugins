import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
async function load() {
 const result=await build({entryPoints:[new URL('../modules/services/files/src/search.ts',import.meta.url).pathname],bundle:true,format:'esm',write:false,alias:{'@hato/sdk':new URL('../../sdk',import.meta.url).pathname}});
 return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
}
const desc={id:'large',machineId:'local',rootAbsolutePath:'/workspace',location:'local'};
const entry=(name,kind='file')=>({name,kind,size:1});
test('workspace index traverses past old directory, file and time limits; filters reuse and invalidation rebuilds',async()=>{
 const {searchFiles,invalidateSearch}=await load();let calls=0,added=false;
 const ctx={host:{capabilities:{request:async()=>({grant:'fs'})},fs:{list:async(_g,path)=>{
  calls++;
  if(path==='.')return {entries:[...Array.from({length:4101},(_,i)=>entry('dir'+i,'dir')),entry('.git','dir'),{...entry('link','dir'),symlink:true}]};
  assert.notEqual(path,'.git');assert.notEqual(path,'link');
  return {entries:[...Array.from({length:13},(_,i)=>entry(i===12?'needle.txt':'file'+i)),...(added?[entry('new.txt')]:[])]};
 }}}};
 const realNow=Date.now;let clock=0;Date.now=()=>clock+=20000;
 try {
  const result=await searchFiles(ctx,desc,'dir4100/needle');
  assert.equal(result.partial,false);assert.equal(result.matchCount,1);
  assert.ok(result.indexedCount>50000);assert.ok(result.entries.some(e=>e.relativePath==='dir4100/needle.txt'));
  assert.equal(calls,4102);const before=calls;
  await searchFiles(ctx,desc,'dir100/needle');assert.equal(calls,before);
  added=true;invalidateSearch(desc);const updated=await searchFiles(ctx,desc,'dir4100/new');
  assert.equal(updated.matchCount,1);assert.equal(calls,before*2);
 } finally {Date.now=realNow;invalidateSearch(desc);}
});
test('ignored matches cannot consume the visible search result budget',async()=>{
 const {searchFiles}=await load();let calls=0;
 const ctx={host:{capabilities:{request:async()=>({grant:'g'})},process:{run:async()=>({code:0,stdout:'build/\0',stderr:''})},fs:{list:async(_g,path)=>{
  calls++;return {entries:path==='.'?[entry('build','dir'),entry('src','dir')]:path==='build'?Array.from({length:1200},(_,i)=>entry('needle'+i)): [entry('needle.java')]};
 }}}};
 const result=await searchFiles(ctx,{...desc,id:'ignored'},'needle',false,true);
 assert.equal(result.matchCount,1);assert.equal(result.partial,false);
 assert.deepEqual(result.entries.map(e=>e.relativePath),['src/needle.java','src']);assert.equal(calls,3);
});
