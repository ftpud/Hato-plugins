import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const load=async id=>import('data:text/javascript;base64,'+Buffer.from((await build({entryPoints:[new URL(`../modules/ui/${id}/src/index.ts`,import.meta.url).pathname],bundle:true,format:'esm',write:false,alias:{'@hato/sdk':new URL('../../sdk',import.meta.url).pathname}})).outputFiles[0].text).toString('base64'));
const walk=n=>[n,...(n.children||[]).flatMap(walk)];
test('lng-srv exposes project settings on a separate row and opens the chosen disabled language',async()=>{
 const {default:tools}=await load('language-tools'),{default:status}=await load('language-status');
 const state=new Map([['workspace.selected',{id:'workspace'}]]),handlers=new Map(),pending=[];let writes=0;
 const servers=[{id:'java',title:'Java'},{id:'sap',title:'SAP'}];
 const ctx={state:{get:k=>state.get(k),set:(k,v)=>state.set(k,v),watch(){}},events:{on:(k,f)=>handlers.set(k,f),emit:(k,v)=>{const fn=handlers.get(k);if(fn)pending.push(fn(v));}},ui:{invalidate(){}},modules:{call:async(_id,m,a)=>{
  if(m==='servers')return servers;
  if(m==='project.get')return {config:{enabled:a.serverId==='java',values:{},settings:{}},schema:{fields:[]},status:{phase:'idle'}};
  if(m==='project.set')writes++;
 }}};
 await tools.activate(ctx);status.activate(ctx);
 const nodes=walk(status.render(ctx)),settings=nodes.filter(n=>n.action==='settings');
 assert.equal(settings.length,2);assert.ok(settings.every(n=>n.text==='Project settings…'&&!n.disabled));
 assert.ok(nodes.filter(n=>n.action==='toggle').every(n=>!n.grow),'language labels must not fill the width and clip settings');
 await status.onEvent(ctx,{action:'settings',value:'sap',inputs:{}});await Promise.all(pending);
 const project=walk(tools.render());assert.equal(project.find(n=>n.key==='server').value,'sap');assert.equal(project.find(n=>n.key==='project-enabled').checked,false);assert.equal(writes,0);
 tools.deactivate();
});
