import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,writeFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const result=await build({entryPoints:[new URL('../../sdk/provider-mcp.ts',import.meta.url).pathname],bundle:true,format:'esm',write:false});
const {providerMcpLaunch}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const option={flag:'--additional-mcp-config',stdioType:'local',tools:['*']};
const servers=[{name:'hato-internal',command:'node',args:['/remote path/proxy.mjs'],env:[{name:'HATO_MCP_TOKEN',value:'test-scoped-token'}]}];

test('provider-declared launch configuration preserves stdio servers and leaves other providers/transports alone',()=>{
 const http={type:'http',name:'http',url:'https://example.invalid/mcp',headers:[]};
 const unchanged=providerMcpLaunch(undefined,'copilot',['--acp'],{},servers);
 assert.equal(unchanged.wrapped,false);assert.deepEqual(unchanged.sessionServers,servers);
 const plan=providerMcpLaunch(option,'copilot',['--acp','--stdio'],{},[...servers,http]);
 assert.equal(plan.wrapped,true);assert.deepEqual(plan.sessionServers,[http]);
 assert.ok(!plan.args.join(' ').includes('test-scoped-token'));
 const configs=JSON.parse(plan.env.HATO_MCP_LAUNCH_CONFIG).mcpServers;
 assert.deepEqual(configs['hato-internal'],{type:'local',command:'node',args:['/remote path/proxy.mjs'],env:{HATO_MCP_TOKEN:'test-scoped-token'},tools:['*']});
 assert.throws(()=>providerMcpLaunch(option,'copilot',[],{},[...servers,...servers]),/Duplicate/);
});

test('launch wrapper uses a private temporary file, preserves argv, removes credentials from the child environment, and cleans up',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'hato-provider-test-'));
 try{
  const cli=join(dir,'fake provider.cjs');
  await writeFile(cli,`const fs=require('node:fs');const args=process.argv.slice(2);const file=args.at(-1).slice(1);const config=JSON.parse(fs.readFileSync(file,'utf8'));console.log(JSON.stringify({file,mode:fs.statSync(file).mode&511,args:args.slice(0,-2),server:config.mcpServers['hato-internal'],inherited:process.env.HATO_MCP_LAUNCH_CONFIG!==undefined}));`);
  const plan=providerMcpLaunch(option,process.execPath,[cli,'--acp','arg with spaces','$(not-a-command)'],{},servers,process.execPath);
  const response=await exec(plan.executable,plan.args,{env:{...process.env,...plan.env}});
  const output=JSON.parse(response.stdout);
  assert.equal(output.mode,0o600);assert.equal(output.inherited,false);
  assert.deepEqual(output.args,['--acp','arg with spaces','$(not-a-command)']);
  assert.equal(output.server.env.HATO_MCP_TOKEN,'test-scoped-token');
  await assert.rejects(access(output.file));
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('terminating the wrapper forwards the signal and removes its temporary configuration',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'hato-provider-signal-'));
 try{
  const cli=join(dir,'fake.cjs');
  await writeFile(cli,`console.log(process.argv.at(-1).slice(1));process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000);`);
  const plan=providerMcpLaunch(option,process.execPath,[cli],{},servers,process.execPath);
  const child=spawn(plan.executable,plan.args,{env:{...process.env,...plan.env},stdio:['ignore','pipe','pipe']});
  const file=await new Promise((resolve,reject)=>{child.stdout.once('data',data=>resolve(String(data).trim()));child.once('error',reject);});
  const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await exited;
  await assert.rejects(access(file));
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('SSH Copilot receives internal MCP at remote process launch rather than session/new',async()=>{
 const fs=await import('node:fs/promises');
 const manifest=JSON.parse(await fs.readFile(new URL('../modules/services/copilot-provider/manifest.json',import.meta.url),'utf8'));
 const built=await build({entryPoints:[new URL('../modules/services/acp/src/index.ts',import.meta.url).pathname],bundle:true,format:'esm',write:false});
 const {default:acp}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
 const workspace={id:'ssh-test',location:'ssh',machineId:'ssh:test',rootAbsolutePath:'/remote/project',ssh:{profileId:'test',host:'example.invalid',port:22,user:'test'}};
 let stdout,spawned;const order=[],requests=[];
 const ctx={state:{set(){}},events:{emit(){}},log:{warn(){},info(){}},modules:{async call(id,method){
  if(id==='workspace')return workspace;
  if(method==='acpProfiles.list')return [];
  if(method==='settings.get')return null;
  if(id==='internal-mcp'&&method==='endpoint'){order.push('endpoint');return{transport:'SSH reverse forward',server:servers[0]};}
  if(id==='internal-mcp'&&method==='revoke')return;
  throw Error(id+'.'+method);
 }},host:{plugins:{list:async()=>({plugins:[{id:'copilot-provider',enabled:true,active:'active',contributes:manifest.contributes}]})},
  ssh:{connect:async()=>({connection:'ssh',machineId:'ssh:test'})},capabilities:{request:async()=>({grant:'scoped'})},
  streams:{listen:async(_handle,opts,fn)=>{if(opts.channel==='stdout')stdout=fn;return{close(){}};}},
  process:{run:async(_grant,spec)=>({code:0,stdout:'\n__HATO_EXEC__=/remote/bin/'+spec.args.at(-1)+'\n',stderr:''}),spawn:async(_grant,spec)=>{order.push('spawn');spawned=spec;return{handle:'process',pid:123};},write:async(_handle,line)=>{
   const request=JSON.parse(line);requests.push(request);
   const result=request.method==='initialize'?{protocolVersion:1,agentCapabilities:{}}:{sessionId:'session'};
   stdout(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\n');
  },closeStdin:async()=>{},terminate:async()=>{}},
 }};
 const state=await acp.methods.start(ctx,{conversationId:'ssh-copilot',workspaceId:workspace.id,profileId:'copilot',mcp:true});
 assert.deepEqual(order,['endpoint','spawn']);
 assert.equal(spawned.target.kind,'ssh');assert.equal(spawned.cwd,'/remote/project');assert.equal(spawned.executable,'node');assert.equal(spawned.loginShell,true);
 assert.ok(!spawned.args.join(' ').includes('test-scoped-token'));
 assert.equal(JSON.parse(spawned.env.HATO_MCP_LAUNCH_CONFIG).mcpServers['hato-internal'].env.HATO_MCP_TOKEN,'test-scoped-token');
 assert.deepEqual(requests.find(r=>r.method==='session/new').params.mcpServers,[]);
 assert.equal(state.status,'ready');assert.deepEqual(state.mcp.selection,['internal']);
 await acp.methods.stop(ctx,{conversationId:'ssh-copilot'});
});
