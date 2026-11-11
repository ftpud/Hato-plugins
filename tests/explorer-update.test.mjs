import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const walk=node=>[node,...(node.children||[]).flatMap(walk)];
const entries=paths=>paths.map(relativePath=>({relativePath,name:relativePath.split('/').at(-1),kind:relativePath.endsWith('.ts')?'file':'dir'}));
test('filtered rows and collapse choices stay stable as index results grow',async()=>{
 const result=await build({entryPoints:[new URL('../modules/ui/explorer/src/index.ts',import.meta.url).pathname],bundle:true,format:'esm',write:false,alias:{'@hato/sdk':new URL('../../sdk',import.meta.url).pathname}});
 const mod=(await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'))).default;
 const selected={id:'ws',view:{}},events=new Map();let paths=['src','src/deep','src/deep/needle.ts'],searches=0,listings=0;
 const ctx={events:{on:(key,fn)=>events.set(key,fn)},state:{get:()=>selected,watch(){}},ui:{invalidate(){}},log:{warn(){}},modules:{async call(id,method){
  if(id==='git')return {files:[]};
  if(method==='list'){listings++;return {entries:[]};}
  if(method==='search'){searches++;return {entries:entries(paths),matchCount:paths.filter(p=>p.endsWith('.ts')).length,indexing:true};}
  if(method==='view.patch')return;
  throw Error(method);
 }}};
 await mod.activate(ctx);
 await mod.onEvent(ctx,{action:'filter',value:'needle'});
 await mod.onEvent(ctx,{action:'submitFilter'});
 const tree=()=>walk(mod.render()).find(n=>n.type==='tree');
 assert.deepEqual(tree().rows.map(r=>r.key),paths);
 await mod.onEvent(ctx,{action:'expand',rowKey:'src'});
 assert.equal(tree().rows[0].expanded,false);
 const before=searches;
 await mod.onEvent(ctx,{action:'filter',value:'needle'});
 assert.equal(searches,before);
 assert.equal(tree().rows[0].expanded,false);
 paths=[...paths,'src/another','src/another/needle.ts'];
 const beforeListings=listings;
 events.get('files.indexed')({workspaceId:'ws'});
 await new Promise(resolve=>setTimeout(resolve,210));
 assert.deepEqual(tree().rows.map(r=>r.key),['src']);
 assert.equal(tree().rows[0].expanded,false);
 events.get('files.changed')({workspaceId:'ws'});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(listings,beforeListings);
 const saved=mod.snapshot();
 assert.deepEqual(saved.filterCollapsed,['src']);
 await mod.activate(ctx,saved);
 assert.equal(tree().rows[0].expanded,false);
});
