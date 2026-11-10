import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const entry = fileURLToPath(new URL('../modules/ui/settings/src/marketplace.ts', import.meta.url));
const result=await build({entryPoints:[entry],bundle:true,format:'esm',platform:'node',write:false});
const {satisfies,plan,marketNodes,marketTab,pluginBrowserAction,restorePluginBrowser,packageVersion,refreshMarket,installPackage,isNewer}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
test('version requirements handle zero-major compatibility and reject unsupported syntax',()=>{
 assert.ok(satisfies('0.1.3','^0.1.0'));assert.ok(!satisfies('0.2.0','^0.1.0'));
 assert.ok(!satisfies('0.0.2','^0.0.1'));assert.ok(satisfies('1.2.9','~1.2.3'));
 assert.ok(!satisfies('1.3.0','~1.2.3'));assert.ok(!satisfies('1.0.0','*'));
 assert.ok(!satisfies('1.0.0-beta','^1.0.0'));assert.ok(!satisfies('0.1.0','^0.1.1'));
});
const p=(id,dependencies={})=>({id,name:id,version:'0.1.0',coreVersion:'^0.1.0',dependencies});
test('dependency plans order prerequisites and reject cycles, missing and incompatible versions',()=>{
 assert.deepEqual(plan([p('a',{b:'^0.1.0'}),p('b')],'a','0.1.0').map(p=>p.id),['b','a']);
 assert.throws(()=>plan([p('a',{b:'^0.1.0'}),p('b',{a:'^0.1.0'})],'a','0.1.0'),/Cyclic/);
 assert.throws(()=>plan([p('a',{b:'^0.1.0'})],'a','0.1.0'),/Unsatisfied/);
 assert.throws(()=>plan([p('a',{b:'^0.2.0'}),p('b')],'a','0.1.0'),/Unsatisfied/);
 assert.throws(()=>plan([p('a')],'a','0.2.0'),/requires Hato/);
});

const walk = nodes => nodes.flatMap(n => [n, ...walk(n.children || [])]);
test('plugin tabs separate installed sources and marketplace excludes disabled and partially installed packages', () => {
 restorePluginBrowser(null);
 const plugins = [{id:'persistence',name:'Persistence',description:'',kind:'service',source:'builtin',enabled:false},
  {id:'custom',name:'Custom',description:'',kind:'ui',source:'user',enabled:true,active:'custom@1'}];
 const render = () => ({type:'label',key:'detail',text:'details'});
 const rows = () => walk(marketNodes(plugins,false,render)).find(n=>n.type==='tree').rows;
 assert.ok(!rows().some(r=>r.key==='package:foundation'));
 marketTab('installed');
 assert.deepEqual(rows().filter(r=>r.depth===1).map(r=>r.key),['module:custom']);
 marketTab('builtin');
 assert.deepEqual(rows().filter(r=>r.depth===1).map(r=>r.key),['package:foundation']);
 pluginBrowserAction('marketExpand','type:System');
 assert.equal(rows().filter(r=>r.depth===1).length,0);
 pluginBrowserAction('marketSearch','persistence');
 assert.equal(rows().filter(r=>r.depth===1).length,1);
 restorePluginBrowser(null);
});

test('native tabs receive a single active page containing both toolbar and browser', () => {
 for (const tab of ['marketplace', 'installed', 'builtin']) {
  marketTab(tab);
  const [node] = marketNodes([], false, () => { throw Error('unexpected detail'); });
  assert.equal(node.type, 'tabs');
  assert.equal(node.children.length, 1);
  const page = node.children.find(child => child.key === node.active);
  assert.ok(page);
  assert.deepEqual(page.children.map(child => child.key), ['toolbar', 'browser']);
  assert.ok(node.height > 0);
 }
 restorePluginBrowser(null);
});

test('actual installed metadata overrides stale package receipts', () => {
 const pkg = {id:'demo',modules:['one','two']};
 const plugins = [{id:'one',source:'user',metadata:{version:'1.2.0'}},{id:'two',source:'user',metadata:{version:'1.2.0'}}];
 assert.equal(packageVersion(pkg,plugins),'1.2.0');
 plugins[1].metadata.version = '1.1.0';
 assert.equal(packageVersion(pkg,plugins),undefined);
});

test('downloads are pinned and fully validated before one native install request', async () => {
 const pkg = {id:'demo',name:'Demo',type:'Tools',core:false,author:'Test',version:'0.1.0',coreVersion:'^0.1.0',dependencies:{},modules:['one','two'],
  artifacts:['one','two'].map(id=>({id,manifest:`packages/demo/${id}/manifest.json`,bundle:`packages/demo/${id}/dist/${id}.mjs`}))};
 const sha = 'a'.repeat(40), writes=[], installs=[];
 let broken = true, requests=[], members=[];
 const ctx = {modules:{call:async()=>({})},host:{
  net:{fetch:async({url})=>{
   requests.push(url);
   if(url.endsWith('commits/main'))return {status:200,body:JSON.stringify({sha})};
   assert.ok(url.includes('/'+sha+'/'));
   if(url.endsWith('catalogue.json'))return {status:200,body:JSON.stringify({schemaVersion:1,packages:[pkg]})};
   if(url.endsWith('/manifest.json')){
    const id=url.includes('/one/')?'one':'two';
    return {status:200,body:JSON.stringify({id:broken&&id==='two'?'wrong':id,version:'0.1.0',moduleApiVersion:1,pluginPackage:'demo'})};
   }
   return {status:200,body:'export default {};'};
  }},env:{info:()=>({dataDir:'/data'})},capabilities:{request:async()=>({grant:'g'}),release:async()=>{}},
  fs:{mkdir:async()=>{},writeAtomic:async(_g,p,t)=>writes.push({p,t})},plugins:{list:async()=>({plugins:members}),enable:async id=>{members.find(m=>m.id===id).enabled=true;return {active:true};},installMany:async paths=>{installs.push(paths);members=['one','two'].map(id=>({id,name:id,enabled:false,source:'user',dependencies:[]}));return {plugins:[]};}},
 }};
 await refreshMarket(ctx);
 await assert.rejects(installPackage(ctx,'demo',[]),/metadata mismatch/);
 assert.equal(writes.length,0); assert.equal(installs.length,0);
 broken=false;
 await installPackage(ctx,'demo',[]);
 assert.equal(installs.length,1);assert.equal(installs[0].length,2);
 assert.equal(writes.length,4);
 assert.ok(members.every(m=>m.enabled),'install enables all included modules');
 assert.equal(requests.filter(url=>url.endsWith('commits/main')).length,1);
});

test('update discovery never treats a newer development build as an available downgrade', () => {
 assert.equal(isNewer('0.1.0','0.1.1'),false);
 assert.equal(isNewer('0.1.1','0.1.1'),false);
 assert.equal(isNewer('0.1.2','0.1.1'),true);
 assert.equal(isNewer('1.0.0','0.9.9'),true);
 assert.equal(isNewer('0.1.1',undefined),true);
});

test('provider plugins contain provider and usage modules, with advanced module children', async () => {
 const fresh=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64')+'#groups');
 const codex=['codex-provider','codex-usage'].map(id=>({id,name:id,source:'user',enabled:true,active:id,dependencies:[]}));
 fresh.marketTab('installed');
 let nodes=walk(fresh.marketNodes(codex,false,()=>({type:'label',key:'module-detail',text:'detail'})));
 let tree=nodes.find(n=>n.type==='tree');
 assert.deepEqual(tree.rows.filter(r=>r.depth===1).map(r=>r.key),['package:codex-acp']);
 assert.equal(nodes.find(n=>n.key==='contents-title').text,'Included modules (2)');
 fresh.pluginBrowserAction('marketExpand','package:codex-acp');
 tree=walk(fresh.marketNodes(codex,false,()=>({type:'label',key:'detail',text:'detail'}))).find(n=>n.type==='tree');
 assert.deepEqual(tree.rows.filter(r=>r.depth===2).map(r=>r.key),['module:codex-provider','module:codex-usage']);
 fresh.marketTab('marketplace');
 tree=walk(fresh.marketNodes(codex,false,()=>({type:'label',key:'detail',text:'detail'}))).find(n=>n.type==='tree');
 assert.ok(!tree.rows.some(r=>r.key==='package:codex-acp'));
 assert.ok(tree.rows.some(r=>r.key==='package:claude-acp'));
});

test('package actions enable dependencies first and block disabling another plugin dependents', async () => {
 const fresh=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64')+'#actions');
 const members=[{id:'codex-usage',name:'Usage',enabled:false,source:'user',dependencies:['codex-provider']},{id:'codex-provider',name:'Provider',enabled:false,source:'user',dependencies:[]}];
 const enabled=[],disabled=[],removed=[];
 let dependent=false;
 const ctx={host:{plugins:{enable:async id=>{enabled.push(id);return {active:true};},dependents:async()=>dependent?['workflows']:[],disable:async id=>disabled.push(id),uninstall:async id=>removed.push(id)}}};
 await fresh.managePackage(ctx,'enable','codex-acp',members);
 assert.deepEqual(enabled,['codex-provider','codex-usage']);
 members.forEach(m=>m.enabled=true);dependent=true;
 await assert.rejects(fresh.managePackage(ctx,'disable','codex-acp',members),/Workflows/);
 assert.equal(disabled.length,0);
 dependent=false;
 await fresh.managePackage(ctx,'uninstall','codex-acp',members);
 assert.deepEqual(disabled,['codex-usage','codex-provider']);
 assert.deepEqual(removed,['codex-usage','codex-provider']);
});

test('installing Workflows enables every module of its Background Agents dependency', async () => {
 const fresh=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64')+'#workflow-dependency');
 const ids=['workflows','workflow-runner','workflows-panel','agent-runner','internal-remote-mcp','persistent-agents','agents-panel'];
 const members=ids.map(id=>({id,name:id,enabled:false,source:'user',dependencies:[]}));
 const enabled=[];
 await fresh.managePackage({host:{plugins:{enable:async id=>{enabled.push(id);return {active:true};}}}},'enable','automation',members);
 assert.deepEqual(enabled.sort(),ids.sort());
});
