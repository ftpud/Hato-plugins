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
 const ctx={events:{emit(){}},host:{capabilities:{request:async()=>({grant:'fs'})},fs:{list:async(_g,path)=>{
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
 const ctx={events:{emit(){}},host:{capabilities:{request:async()=>({grant:'g'})},process:{run:async(_g,spec)=>spec.args.includes('--cached')||spec.args.includes('--deleted')?{code:128,stdout:'',stderr:''}:{code:0,stdout:'build/\0',stderr:''}},fs:{list:async(_g,path)=>{
  calls++;return {entries:path==='.'?[entry('build','dir'),entry('src','dir')]:path==='build'?Array.from({length:1200},(_,i)=>entry('needle'+i)): [entry('needle.java')]};
 }}}};
 const result=await searchFiles(ctx,{...desc,id:'ignored'},'needle',false,true);
 assert.equal(result.matchCount,1);assert.equal(result.partial,false);
 assert.deepEqual(result.entries.map(e=>e.relativePath),['src/needle.java','src']);assert.equal(calls,2);
 const all=await searchFiles(ctx,{...desc,id:'ignored'},'build/needle1199',false,false);
 assert.equal(all.matchCount,1);assert.equal(calls,5,'show ignored builds a separate full index');
 const hidden=await searchFiles(ctx,{...desc,id:'ignored'},'build/needle1199',false,true);
 assert.equal(hidden.matchCount,0);assert.equal(calls,5,'switching back reuses only the visible cache');
});
test('slow traversal returns partial results, coalesces invalidations and refreshes on completion',async()=>{
 const {searchFiles,invalidateSearch,stopSearchIndexes}=await load();
 let release;const blocked=new Promise(resolve=>release=resolve);const visited=[],events=[];
 const ctx={events:{emit:(name,data)=>events.push({name,...data})},host:{capabilities:{request:async()=>({grant:'slow'})},
 process:{run:async()=>({code:128,stdout:'',stderr:''})},fs:{list:async(_g,path)=>{
  visited.push(path);
  if(path==='.')return {entries:[entry('src','dir'),entry('node_modules','dir')]};
  if(path==='node_modules')await blocked;
  return {entries:[entry('needle.ts')]};
 }}}};
 const d={...desc,id:'slow'};
 try {
  const first=await searchFiles(ctx,d,'needle');
  assert.equal(first.indexing,true);assert.ok(first.entries.some(e=>e.relativePath==='src/needle.ts'));
  for(let i=0;i<3;i++){invalidateSearch(d);await searchFiles(ctx,d,'needle');}
  assert.equal(visited.filter(p=>p==='.').length,1,'watch changes must not spawn duplicate active traversals');
  release();await new Promise(r=>setTimeout(r,0));
  const final=await searchFiles(ctx,d,'needle');assert.equal(final.indexing,false);
  assert.equal(visited.filter(p=>p==='.').length,2,'one follow-up scan reconciles changes');
  assert.ok(events.some(e=>e.name==='files.indexed'&&!e.indexing));
 } finally {release();stopSearchIndexes();}
});
test('Git builds the visible cache without per-directory SSH reads or ignored and deleted files',async()=>{
 const {searchFiles,stopSearchIndexes}=await load();const specs=[];
 const ctx={events:{emit(){}},host:{capabilities:{request:async()=>({grant:'git'})},process:{run:async(_g,spec)=>{
  specs.push(spec);assert.equal(spec.cwd,'/workspace');assert.ok(spec.args.includes('-z'));
  return {code:0,stdout:spec.args.includes('--deleted')?'src/deleted.ts\0':'src/needle.ts\0src/deleted.ts\0new file.ts\0',stderr:''};
 }},fs:{list:async()=>{throw new Error('must not traverse node_modules via SSH');}}}};
 try {
  const result=await searchFiles(ctx,{...desc,id:'git'},'src',false,true);
  assert.equal(result.indexing,false);assert.equal(result.partial,false);
  assert.deepEqual(result.entries.map(e=>e.relativePath),['src','src/needle.ts']);
  assert.ok(specs.some(s=>s.args.includes('--exclude-standard')));
  await searchFiles(ctx,{...desc,id:'git'},'new',false,true);assert.equal(specs.length,2);
 } finally {stopSearchIndexes();}
});
test('real Git enumeration respects nested ignores, tracked ignored files, spaces and removals',async()=>{
 const {mkdtemp,mkdir,writeFile,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');
 const exec=promisify(execFile),root=await mkdtemp(join(tmpdir(),'hato-index-'));
 const {searchFiles,stopSearchIndexes}=await load();
 try {
  await exec('git',['init','-q',root]);
  for(const dir of ['src','node_modules/pkg'])await mkdir(join(root,dir),{recursive:true});
  await writeFile(join(root,'.gitignore'),'node_modules/\n*.cache\n');
  await writeFile(join(root,'src/keep.cache'),'tracked');await writeFile(join(root,'src/deleted.ts'),'gone');
  await exec('git',['-C',root,'add','-f','src/keep.cache','src/deleted.ts']);
  await rm(join(root,'src/deleted.ts'));await writeFile(join(root,'src/new file.ts'),'new');
  await writeFile(join(root,'src/hide.cache'),'hidden');await writeFile(join(root,'node_modules/pkg/index.js'),'dependency');
  const ctx={events:{emit(){}},host:{capabilities:{request:async()=>({grant:'fixture'})},process:{run:async(_g,spec)=>{
   try {const r=await exec(spec.executable,spec.args,{cwd:spec.cwd});return {code:0,...r};}
   catch(e){return {code:e.code,stdout:e.stdout||'',stderr:e.stderr||''};}
  }},fs:{list:async()=>assert.fail('Git should enumerate without filesystem traversal')}}};
  const d={...desc,id:'fixture',rootAbsolutePath:root};let result=await searchFiles(ctx,d,'src',false,true);
  while(result.indexing)result=await searchFiles(ctx,d,'src',false,true);
  assert.deepEqual(result.entries.map(e=>e.relativePath).sort(),['src','src/keep.cache','src/new file.ts']);
  assert.equal(result.partial,false);
 } finally {stopSearchIndexes();await rm(root,{recursive:true,force:true});}
});
test('truncated remote Git output falls back to traversal instead of reporting a complete partial cache',async()=>{
 const {searchFiles,stopSearchIndexes}=await load();
 const ctx={events:{emit(){}},host:{capabilities:{request:async()=>({grant:'truncated'})},process:{run:async(_g,spec)=>({code:0,stdout:'',stderr:'',truncated:spec.args.includes('--cached')})},fs:{list:async()=>({entries:[entry('fallback.ts')]})}}};
 try {
  const result=await searchFiles(ctx,{...desc,id:'truncated'},'fallback',false,true);
  assert.equal(result.matchCount,1);assert.equal(result.partial,false);
 } finally {stopSearchIndexes();}
});
