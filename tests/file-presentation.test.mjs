import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const load=async path=>{
 const r=await build({entryPoints:[new URL(path,import.meta.url).pathname],bundle:true,format:'esm',write:false,alias:{'@hato/sdk':new URL('../../sdk',import.meta.url).pathname}});
 return import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));
};
const sdk=await load('../../sdk/file-presentation.ts');
const java=await load('../modules/services/language-java/src/presentation.ts');
const plugin=(id,contribution)=>({id,enabled:true,active:{version:1},contributes:{filePresentation:contribution}});
const entry=(path,kind='file')=>({path,kind});

test('shared presentation composes plugins and ignores disabled/malformed rules',()=>{
 const rules=sdk.filePresentationRules([
  plugin('other',{rules:[{id:'root',pathPattern:'^src/',background:'#11223322'},{id:'schema',pathPattern:'\\.schema$',iconSvg:'schema'}]}),
  {...plugin('disabled',{rules:[{id:'bad',pathPattern:'.*',iconSvg:'wrong'}]}),enabled:false},
  plugin('broken',{rules:[{id:'invalid',pathPattern:'['}]}),
 ]);
 assert.deepEqual(sdk.presentFile(rules,entry('src/item.schema')),{background:'#11223322',iconSvg:'schema'});
 assert.deepEqual(sdk.presentFile(rules,entry('other.txt')),{});
});

test('Java classifies the file declaration while ignoring comments/literals',()=>{
 const rules=sdk.filePresentationRules([plugin('language-java',java.javaFilePresentation(java.defaults))]);
 for(const [kind,source] of Object.entries({class:'public class Named {}',interface:'public interface Named {}',enum:'public enum Named {}',record:'public record Named(int x) {}',annotation:'public @interface Named {}'})){
  const result=sdk.presentFile(rules,entry('src/main/java/Named.java'),source);
  assert.equal(result.description,`Java ${kind}`);assert.ok(result.iconSvg.startsWith('<svg'));assert.ok(result.background);
 }
 assert.equal(sdk.presentFile(rules,entry('Named.java'),'// interface Named {}\nclass Named { String s="enum Named"; }').description,'Java class');
 assert.equal(sdk.presentFile(rules,entry('Named.java'),'interface Other {}\nclass Named {}').description,'Java class');
 assert.equal(sdk.presentFile(rules,entry('package-info.java'),'').description,'Java package descriptor');
 assert.equal(sdk.presentFile(rules,entry('module-info.java'),'').description,'Java module descriptor');
});

test('Java root backgrounds support modules, user paths and toggles',()=>{
 const rules=sdk.filePresentationRules([plugin('language-java',java.javaFilePresentation(java.defaults))]);
 const paths=['src/main/java/X.java','mod/src/test/java/X.java','src/main/resources/settings.xml','mod/src/test/resources/data.json'];
 assert.equal(new Set(paths.map(path=>sdk.presentFile(rules,entry(path)).background)).size,4);
 for(const path of paths)assert.ok(parseInt(sdk.presentFile(rules,entry(path)).background.slice(-2),16)<=0x10);
 assert.ok(sdk.presentFile(rules,entry('mod/src/main/java','dir')).background);
 assert.equal(sdk.presentFile(rules,entry('mod/src/main/javascript/X.java')).background,undefined);
 const custom=sdk.filePresentationRules([plugin('language-java',java.javaFilePresentation({...java.defaults,sources:'code\nmodules/*/source',icons:false}))]);
 assert.ok(sdk.presentFile(custom,entry('modules/demo/source/X.java')).background);
 assert.equal(sdk.presentFile(custom,entry('code/X.java')).iconSvg,undefined);
 const uncolored=sdk.filePresentationRules([plugin('language-java',java.javaFilePresentation({...java.defaults,backgrounds:false}))]);
 const named=sdk.presentFile(uncolored,entry('src/main/java/Named.java'),'public class Named {}');
 assert.ok(named.iconSvg);assert.equal(named.background,undefined);
 assert.deepEqual(java.javaFilePresentation({...java.defaults,icons:false,backgrounds:false}),{rules:[]});
});

test('file service caches scoped reads and observes provider changes',async()=>{
 const {FilePresentations}=await load('../modules/services/files/src/presentation.ts');
 const events=new Map(),watchers=new Map(),values=new Map();let reads=0;
 const ctx={events:{on(name,fn){const list=events.get(name)||[];list.push(fn);events.set(name,list);return()=>{};},emit(name,event){for(const fn of events.get(name)||[])fn(event);}},state:{get:key=>values.get(key),set:(key,value)=>values.set(key,value),watch(key,fn){watchers.set(key,fn);return()=>watchers.delete(key);}},host:{
  plugins:{list:async()=>({plugins:[plugin('language-java',java.javaFilePresentation(java.defaults))]})},
  capabilities:{request:async()=>({grant:'scoped'})},fs:{read:async(grant,path,limit)=>{reads++;assert.equal(grant,'scoped');assert.equal(limit,32768);return{text:'interface Named {}',binary:false};}},
 }};
 const service=new FilePresentations(ctx);await service.activate();
 const ws={id:'ws',machineId:'local',rootAbsolutePath:'/work',location:'local'},path='src/main/java/Named.java';
 assert.equal((await service.get(ws,[entry(path)]))[path].description,'Java interface');
 await service.get(ws,[entry(path)]);assert.equal(reads,1);
 await service.get(ws,[entry('src/main/resources/config.xml')]);assert.equal(reads,1);
 await assert.rejects(service.get(ws,[entry('../escape.java')]),/escapes/);
 values.set('language-java.filePresentation',{rules:[]});watchers.get('language-java.filePresentation')();
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual((await service.get(ws,[entry(path)]))[path],{});
 service.dispose();
});

test('shared client batches requests and discards results for a previous workspace',async()=>{
 const events=new Map();let resolveOld,requests=[];
 const ctx={state:{get:()=>1,watch:()=>()=>{}},events:{on(name,fn){events.set(name,fn);return()=>events.delete(name);}},ui:{invalidate(){}},modules:{async call(_id,_method,args){
  requests.push(args);
  if(args.workspaceId==='old')return new Promise(resolve=>resolveOld=resolve);
  return Object.fromEntries(args.entries.map(e=>[e.path,{iconSvg:'current'}]));
 }}};
 const client=new sdk.FilePresentationClient(ctx);
 client.get('old','Same.java');client.get('old','Same.java');
 await new Promise(resolve=>setTimeout(resolve,45));
 assert.equal(requests.length,1);assert.equal(requests[0].entries.length,1);
 client.get('new','Same.java');resolveOld({'Same.java':{iconSvg:'stale'}});
 await new Promise(resolve=>setTimeout(resolve,60));
 assert.equal(client.get('new','Same.java').iconSvg,'current');
 events.get('files.presentationChanged')();
 assert.deepEqual(client.get('new','Same.java'),{});
 client.dispose();
});

test('explorer applies presentation returned through the shared interface without knowing a language',async()=>{
 const {default:explorer}=await load('../modules/ui/explorer/src/index.ts');
 const ws={id:'ws',view:{}},look={iconSvg:'<svg/>',background:'#33669922'};
 const ctx={state:{get:key=>key==='workspace.selected'?ws:key==='files.presentationRuleCount'?1:undefined,watch:()=>()=>{}},events:{on:()=>()=>{}},ui:{invalidate(){}},modules:{async call(id,method,args){
  if(id==='git')return {files:[]};
  if(method==='list')return {entries:[{name:'Custom.xyz',relativePath:'Custom.xyz',kind:'file'}]};
  if(method==='presentations')return Object.fromEntries(args.entries.map(e=>[e.path,look]));
  if(method==='view.patch')return;
 }}};
 await explorer.activate(ctx);
 const walk=node=>[node,...(node.children||[]).flatMap(walk)];
 const tree=()=>walk(explorer.render()).find(node=>node.type==='tree');
 tree();await new Promise(resolve=>setTimeout(resolve,65));
 assert.equal(tree().rowGap,0);
 assert.equal(tree().rows[0].iconSvg,look.iconSvg);
 assert.equal(tree().rows[0].background,look.background);
 explorer.deactivate();
});
