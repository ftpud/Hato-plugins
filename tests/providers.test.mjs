import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {build} from 'esbuild';
const load=async path=>{
 const code=(await build({entryPoints:[new URL('../'+path,import.meta.url).pathname],bundle:true,format:'esm',write:false})).outputFiles[0].text;
 return import('data:text/javascript;base64,'+Buffer.from(code).toString('base64')+'#'+Math.random());
};
const provider=(id,enabled=true)=>{
 const m=JSON.parse(fs.readFileSync(new URL(`../modules/services/${id}-provider/manifest.json`,import.meta.url),'utf8'));
 return {id:m.id,enabled,active:enabled?'active':null,contributes:m.contributes};
};
function context(plugins=[],saved=[]) {
 const settings=new Map();
 return {moduleId:'acp',host:{plugins:{list:async()=>({plugins})}},state:{set(){}},events:{emit(){}},log:{info(){},warn(){}},
 modules:{call:async(id,method,a)=>{
  if(method==='acpProfiles.list')return saved;
  if(method==='settings.get')return settings.get(a.key);
  if(method==='settings.set'){settings.set(a.key,a.value);return;}
  if(id==='workspace')return {id:'ws',machineId:'local'};
  throw Error(`Unexpected call ${id}.${method}`);
 }},settings};
}

test('shared ACP exposes only installed provider plugins and preserves saved profile customizations',async()=>{
 const {default:acp}=await load('modules/services/acp/src/index.ts');
 const saved=[{id:'codex',provider:'codex',name:'My Codex',machineId:'*',enabled:true,executable:'/custom/codex',args:['--custom']}];
 const plugins=[],ctx=context(plugins,saved);
 await acp.activate(ctx);
 assert.deepEqual(await acp.methods.profiles(ctx,{}),[],'no implicit providers');
 plugins.push(provider('codex'));
 const rows=await acp.methods.profiles(ctx,{});
 assert.equal(rows.length,1);assert.equal(rows[0].name,'My Codex');assert.equal(rows[0].executable,'/custom/codex');
 assert.equal(rows[0].providerModule,'codex-provider');
 plugins[0].enabled=false;
 assert.deepEqual(await acp.methods.profiles(ctx,{}),[],'disabled provider disappears without deleting saved settings');
 plugins.splice(0,1,provider('claude'));
 assert.deepEqual((await acp.methods.profiles(ctx,{})).map(p=>p.provider),['claude']);
});

test('authentication controls come from the provider contribution',async()=>{
 const {default:acp}=await load('modules/services/acp/src/index.ts');
 const ctx=context([provider('codex')]);
 assert.deepEqual(await acp.methods.authSettings(ctx),{});
 ctx.host.plugins.list=async()=>({plugins:[provider('claude')]});
 assert.deepEqual(await acp.methods.authSettings(ctx),{claudeSubscription:true});
 await acp.methods.setAuthSettings(ctx,{claudeSubscription:false,unknown:true});
 assert.equal(ctx.settings.get('acp.claude.useSubscription'),false);
 assert.equal(ctx.settings.size,1);
});

test('no provider plugin means no adapter detection or npm calls',async()=>{
 const {default:acp}=await load('modules/services/acp/src/index.ts');
 assert.deepEqual(await acp.methods.adapters(context(),{workspaceId:'ws'}),[]);
 await assert.rejects(acp.methods.installAdapter(context(),{adapterId:'codex'},{caller:'ai-sessions'}),/unavailable/);
});

test('provider modules own usage parsing and live update handling',async()=>{
 const {default:codex}=await load('modules/services/codex-provider/src/index.ts');
 const {default:claude}=await load('modules/services/claude-provider/src/index.ts');
 const c=codex.methods.parseLimits(null,{text:'**codex 5h limit:** 73% left (resets 14:00)'});
 assert.equal(c.windows[0].usedPercent,27);assert.equal(c.provider,'codex');
 const a=claude.methods.parseLimits(null,{text:'',updates:[{_meta:{'_claude/rateLimit':{rateLimitType:'five_hour',utilization:0.42}}}]});
 assert.equal(a.windows[0].usedPercent,42);assert.equal(a.provider,'claude');
});
