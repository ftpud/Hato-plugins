import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { build } from 'esbuild';
const root = new URL('../', import.meta.url);
const load = async relative => {
  const code = (await build({entryPoints: [new URL(relative, root).pathname], bundle:true, format:'esm', platform:'node', write:false})).outputFiles[0].text;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64') + '#' + Math.random());
};
const registry = await load('../sdk/languages.ts');
const {LspPeer, lspFrame, decodeBase64} = await load('../sdk/lsp.ts');
const plugin = id => ({ ...JSON.parse(fs.readFileSync(new URL(`modules/services/${id}/manifest.json`, root))), enabled:true, active:'test' });
const all = ['language-java','language-typescript','language-sap'].map(plugin);

test('marketplace languages match independently, including SAP compound names and extension descriptors', () => {
  const langs = registry.languageDefinitions(all);
  for (const [path, id, grammar] of [
    ['Main.java','java','java'], ['a.mjs','javascript','javascript'], ['a.cts','typescript','typescript'],
    ['a.jsx','javascriptreact','javascript'], ['a.tsx','typescriptreact','tsx'],
    ['db/model.cds','cds','text'], ['view.hdbcds','cds','text'], ['view.ddls','cds','text'],
    ['mta.yaml','sap-mta','yaml'], ['mtad.yml','sap-mta','yaml'], ['prod.mtaext','sap-mta','yaml'],
    ['.cdsrc-private.json','sap-json','json'], ['xs-security.json','sap-json','json'],
    ['foo.hdbgrants','sap-json','json'], ['foo.hdbprocedure','sap-sql','sql'],
  ]) {
    const actual = registry.languageForPath(langs, path);
    assert.equal(actual?.id, id, path); assert.equal(actual?.grammar, grammar, path);
  }
  all[2].enabled = false;
  assert.equal(registry.languageForPath(registry.languageDefinitions(all), 'model.cds'), null);
  all[2].enabled = true;
  assert.equal(registry.languageForPath(langs, 'unrelated.txt'), null);
  assert.equal(registry.languageForPath(langs, 'unrelated.java.bak'), null);
  assert.ok(!registry.languageForPath(langs, 'prod.mtaext').server);
});

test('URI mapping preserves remote identities, spaces, Unicode and drive letters; blocks traversal and non-file targets', () => {
  for (const root of ['/srv/my project/日本語', 'C:\\Users\\dev\\project', '/']) {
    const uri = registry.documentUri(root, 'src/a #é.ts');
    assert.equal(registry.workspacePath(root, uri), 'src/a #é.ts');
  }
  for (const uri of ['file:///etc/passwd', 'file:///srv/app-other/file.ts', 'file:///srv/app/../../etc/passwd', 'file://other/srv/app/file.ts', 'jdt://contents/Foo.class', 'https://example.com/a', 'file:///srv/app/%ZZ']) assert.equal(registry.workspacePath('/srv/app', uri), null, uri);
  assert.throws(() => registry.documentUri('/srv/app', '../private'), /escapes/);
  const pos = {line:2,character:4}, range = {start:pos,end:pos};
  assert.deepEqual(registry.definitionLinks({uri:'file:///srv/app/a.ts',range}), [{targetUri:'file:///srv/app/a.ts',targetRange:range,targetSelectionRange:range}]);
  assert.deepEqual(registry.definitionLinks([{uri:'file:///bad',range:{start:{line:-1,character:0},end:pos}}]), []);
});

test('LSP framing counts bytes and survives every byte boundary, coalescing and server requests', async () => {
  const messages = [], writes = [];
  const peer = new LspPeer(async frame => writes.push(frame));
  peer.onNotification = (method, params) => messages.push([method,params]);
  peer.onRequest = async (method, params) => ({method,params});
  const frame = lspFrame({jsonrpc:'2.0',method:'notice',params:'é 日本語 😀'});
  assert.equal(Number(/Content-Length: (\d+)/.exec(frame)[1]), Buffer.byteLength(frame.split('\r\n\r\n')[1]));
  const bytes = Buffer.from(frame);
  for (const byte of bytes) peer.feed(new Uint8Array([byte]));
  peer.feed(Buffer.concat([bytes, bytes]));
  assert.equal(messages.length,3); assert.equal(messages[0][1],'é 日本語 😀');
  assert.deepEqual(decodeBase64(bytes.toString('base64')), new Uint8Array(bytes));
  const pending = peer.request('definition',{});
  await new Promise(r => setImmediate(r));
  const request = JSON.parse(writes.shift().split('\r\n\r\n')[1]);
  peer.feed(Buffer.from(lspFrame({jsonrpc:'2.0',id:request.id,result:['ok']})));
  assert.deepEqual(await pending,['ok']);
  peer.feed(Buffer.from(lspFrame({jsonrpc:'2.0',id:99,method:'configuration',params:{section:'java'}})));
  await new Promise(r => setImmediate(r));
  assert.deepEqual(JSON.parse(writes.shift().split('\r\n\r\n')[1]).result,{method:'configuration',params:{section:'java'}});
  const timeout = peer.request('never',{},5);
  await assert.rejects(timeout,/timed out/);
  const broken = peer.request('broken',{});
  peer.feed(Buffer.from('Content-Length: nope\r\n\r\n'));
  await assert.rejects(broken,/Content-Length/);
  assert.equal(peer.alive,false);
  await assert.rejects(peer.request('after-close'),/Content-Length/);
});

// Language servers are opt-in per workspace; most fixtures model a workspace that opted in.
function context(location = 'local', {optedIn = true} = {}) {
  const handlers = {}, watchers = {}, settings = new Map(), processes = [], calls = [], sent = [], events = [];
  const workspace = {id:'ws',name:'Fixture',location,machineId:location === 'ssh' ? 'ssh:test' : 'local',rootAbsolutePath:'/srv/project with spaces', ...(location === 'ssh' ? {ssh:{profileId:'test',host:'host',port:22,user:'dev'}} : {})};
  let seq = 0;
  const ctx = {moduleId:'language-service',generation:1,version:1,log:console,ui:{invalidate(){}},
    events:{on:(name,fn)=>{handlers[name]=fn;},emit:(name,value)=>events.push({name,value})},
    state:{get:()=>workspace,set(){},watch:(key,fn)=>{watchers[key]=fn;}},
    modules:{call:async (id,method,a)=>{
      calls.push({id,method,a});
      if (id === 'workspace') return workspace;
      if (method === 'scoped.resolve') return settings.has(a.key) ? {value:settings.get(a.key)} : optedIn && /^language-server\.[^.]+\.project$/.test(a.key) ? {value:{enabled:true,values:{},settings:{}}} : null;
      if (method === 'scoped.set') { settings.set(a.key,a.value); return {applied:true,rev:1}; }
      throw Error(`${id}.${method}`);
    }},
    host:{plugins:{list:async()=>({plugins:all})},capabilities:{request:async spec=>{calls.push({grant:spec});return {grant:'g'};}},
      ssh:{connect:async spec=>{calls.push({ssh:spec});return {connection:'ssh-connection',machineId:'ssh:test'};}},
      process:{run:async(_grant,spec)=>{calls.push({run:spec});return {code:0,stdout:'"/home/dev/.local/share/hato/language-tools/workspaces/jdtls/test"',stderr:''};},spawn:async (_grant,spec)=>{const p={handle:`process-${++seq}`,spec,listeners:{},stopped:false}; processes.push(p);return p;},
        write:async (handle,frame)=>{
          const p=processes.find(p=>p.handle===handle), message=JSON.parse(frame.split('\r\n\r\n')[1]);sent.push(message);
          if(message.id){
            const result=message.method==='initialize'?{capabilities:{textDocumentSync:{openClose:true,change:2,save:{includeText:true}},definitionProvider:true,documentSymbolProvider:true,hoverProvider:true,completionProvider:{triggerCharacters:['.']}}}:message.method==='workspace/symbol'?[{name:'OtherClass',kind:5,location:{uri:registry.documentUri(workspace.rootAbsolutePath,'src/OtherClass.java'),range:{start:{line:0,character:6},end:{line:0,character:16}}}}]:message.method==='textDocument/documentSymbol'?[{name:'Main',kind:5,range:{start:{line:0,character:0},end:{line:3,character:1}},selectionRange:{start:{line:0,character:6},end:{line:0,character:10}},children:[{name:'run',kind:6,selectionRange:{start:{line:1,character:7},end:{line:1,character:10}}}]}]:message.method==='textDocument/hover'?{contents:{kind:'markdown',value:'int target'}}:message.method==='textDocument/completion'?[{label:'target',insertText:'target'}]:[{uri:registry.documentUri(workspace.rootAbsolutePath,'src/target.ts'),range:{start:{line:1,character:2},end:{line:1,character:5}}}];
            p.listeners.stdout(Buffer.from(lspFrame({jsonrpc:'2.0',id:message.id,result})).toString('base64'));
          }
        },terminate:async handle=>{processes.find(p=>p.handle===handle).stopped=true;}},
      streams:{listen:async(handle,opts,data,end)=>{const p=processes.find(p=>p.handle===handle);p.listeners[opts.channel]=data;if (end) p.end=end;return {close:async()=>{}};}},
      resources:{release:async()=>{}},
    },
  };
  return {ctx,workspace,processes,calls,sent,handlers,watchers,settings,events};
}
for (const location of ['local','ssh']) test(`language service uses ${location} process scopes, synchronizes unsaved buffers and restarts dead servers`, async () => {
  const {default:mod}=await load('modules/services/language-service/src/index.ts');
  const c=context(location), position={line:1,character:3};
  await mod.activate(c.ctx);
  assert.equal(mod.methods.health(c.ctx).ok,true);
  try {
    const args={workspaceId:'ws',path:'src/main.ts',text:'// 😀\nconst x = target;',position,documents:[{path:'src/target.ts',text:'// unsaved\nexport const target = 1;'}]};
    const result=await mod.methods.definitions(c.ctx,args);
    assert.equal(result[0].targetSelectionRange.start.line,1);
    assert.equal(c.processes.length,1);
    assert.equal(c.processes[0].spec.cwd,c.workspace.rootAbsolutePath);
    assert.equal(c.processes[0].spec.target.kind,location);
    assert.equal(c.processes[0].spec.loginShell,location==='ssh');
    assert.ok(c.calls.some(call=>call.grant?.target.kind===location));
    const opened=c.sent.filter(m=>m.method==='textDocument/didOpen');
    assert.equal(opened.length,2);assert.equal(opened[0].params.textDocument.text,args.documents[0].text);
    await mod.methods.definitions(c.ctx,{...args,text:args.text+'\n// changed'});
    const change=c.sent.find(m=>m.method==='textDocument/didChange').params;
    assert.equal(change.textDocument.version,2);
    assert.deepEqual(change.contentChanges[0].range.end,{line:1,character:17});
    assert.equal(c.sent.filter(m=>m.method==='initialize').length,1);
    c.processes[0].end(null);
    assert.equal(c.events.at(-1).value.phase,'error');
    await mod.methods.definitions(c.ctx,args);
    assert.equal(c.processes.length,2);assert.ok(c.processes[0].stopped);
    c.handlers['settings.change']({module:'language-service',section:'typescript-language-server',key:'executable',value:'/custom/server'});
    await new Promise(r=>setImmediate(r));
    assert.equal(c.settings.get('language-server.typescript-language-server.executable'),'/custom/server');
    await mod.methods.definitions(c.ctx,args);
    assert.equal(c.processes.at(-1).spec.executable,'/custom/server');
  } finally {await mod.deactivate(c.ctx);}
  assert.ok(c.processes.every(p=>p.stopped));
});

test('Java uses a workspace-specific JDTLS data directory and SAP never launches a process', async () => {
  const {default:mod}=await load('modules/services/language-service/src/index.ts');
  const c=context();await mod.activate(c.ctx);
  try {
    assert.deepEqual(await mod.methods.definitions(c.ctx,{workspaceId:'ws',path:'db/model.cds',text:'entity X {}',position:{line:0,character:2}}),[]);
    assert.equal(c.processes.length,0);
    await mod.methods.definitions(c.ctx,{workspaceId:'ws',path:'Main.java',text:'class Main {}',position:{line:0,character:6}});
    assert.deepEqual(c.processes[0].spec.args,['-data','/home/dev/.local/share/hato/language-tools/workspaces/jdtls/test']);
    assert.equal(c.calls.find(call=>call.run).run.target.kind,'local');
    assert.equal(c.processes[0].spec.executable,'jdtls');
  } finally {await mod.deactivate(c.ctx);}
});

for (const location of ['local','ssh']) test(`Java project settings, startup, symbols and context stay on the ${location} workspace`, async () => {
  const {default:mod}=await load('modules/services/language-service/src/index.ts');
  const c=context(location); await mod.activate(c.ctx);
  const args={workspaceId:'ws',serverId:'jdtls',path:'src/Main.java',text:'class Main { void run() {} }'};
  try {
    const initial=await mod.methods['project.get'](c.ctx,args);
    assert.equal(initial.status.phase,'idle');
    assert.equal(initial.config.enabled,true);
    await mod.methods['project.set'](c.ctx,{...args,config:{enabled:true,values:{sourcePaths:['src','test'],outputPath:'out',referencedLibraries:['lib/**/*.jar'],gradle:false},settings:{java:{configuration:{runtimes:[{name:'JavaSE-21',path:'/remote/jdk21',default:true}]}}}}});
    assert.deepEqual(c.settings.get('language-server.jdtls.project').values.sourcePaths,['src','test']);
    assert.ok(c.calls.some(call=>call.method==='scoped.set'&&call.a.scope==='workspace:ws'));
    const status=await mod.methods.synchronize(c.ctx,args);
    assert.equal(status.phase,'ready');
    await mod.methods.saved(c.ctx,args);
    assert.equal(c.sent.find(m=>m.method==='textDocument/didSave').params.text,args.text);
    assert.equal(c.processes[0].spec.target.kind,location);
    const init=c.sent.find(m=>m.method==='initialize');
    assert.deepEqual(init.params.initializationOptions.settings.java.project.sourcePaths,['src','test']);
    assert.equal(init.params.initializationOptions.settings.java.import.gradle.enabled,false);
    assert.equal(init.params.initializationOptions.settings.java.configuration.runtimes[0].path,'/remote/jdk21');
    const projectSymbols=await mod.methods.workspaceSymbols(c.ctx,{...args,query:'Other'});
    assert.equal(projectSymbols[0].path,'src/OtherClass.java');
    const symbols=await mod.methods.symbols(c.ctx,args);
    assert.deepEqual(symbols.map(s=>[s.name,s.container]),[['Main',''],['run','Main']]);
    assert.equal(symbols[1].range.start.line,1);
    const hover=await mod.methods.hover(c.ctx,{...args,position:{line:0,character:20}});
    assert.equal(hover.contents.value,'int target');
    assert.equal((await mod.methods.completions(c.ctx,{...args,position:{line:0,character:20},context:{triggerKind:1}}))[0].label,'target');
    const process=c.processes[0];
    const notification=(method,params)=>process.listeners.stdout(Buffer.from(lspFrame({jsonrpc:'2.0',method,params})).toString('base64'));
    notification('$/progress',{token:1,value:{kind:'begin',title:'Importing Java projects'}});
    assert.equal(c.events.at(-1).value.phase,'indexing');
    notification('$/progress',{token:1,value:{kind:'end'}});
    assert.equal(c.events.at(-1).value.phase,'ready');
    notification('textDocument/publishDiagnostics',{uri:'file:///Main.java',diagnostics:[{message:'error'}]});
    assert.equal(c.events.at(-1).value.diagnostics,1);
    await mod.methods['project.set'](c.ctx,{...args,config:{enabled:false}});
    assert.ok(process.stopped);
    await assert.rejects(mod.methods.definitions(c.ctx,{...args,position:{line:0,character:1}}),/disabled/);
    assert.equal(c.processes.length,1);
  } finally {await mod.deactivate(c.ctx);}
});

test('language servers stay disabled until a workspace opts in', async () => {
  const {default:mod}=await load('modules/services/language-service/src/index.ts');
  const c=context('local',{optedIn:false}); await mod.activate(c.ctx);
  const args={workspaceId:'ws',serverId:'jdtls',path:'src/Main.java',text:'class Main {}'};
  try {
    const initial=await mod.methods['project.get'](c.ctx,args);
    assert.equal(initial.config.enabled,false);
    assert.equal(initial.status.phase,'disabled');
    await assert.rejects(mod.methods.synchronize(c.ctx,args),/disabled for this workspace/);
    assert.equal(c.processes.length,0);
    await mod.methods['project.set'](c.ctx,{...args,config:{enabled:true}},{caller:'language-tools'});
    assert.ok(c.events.some(e=>e.name==='language-service.configurationChanged'&&e.value.enabled===true&&e.value.serverId==='jdtls'));
    await mod.methods.synchronize(c.ctx,args);
    assert.equal(c.processes.length,1);
  } finally { await mod.deactivate?.(c.ctx); }
});

test('project settings reject escaping folders and keep unspecified build defaults', async () => {
  const {projectConfiguration,projectServer}=await load('modules/services/language-service/src/project.ts');
  const server=all.find(p=>p.id==='language-java').contributes.languages[0].server;
  for(const value of ['../src','/outside','C:\\outside'])assert.throws(()=>projectConfiguration(server,{values:{sourcePaths:[value]}}),/inside the workspace/);
  const defaults=projectServer(server,projectConfiguration(server,{}));
  assert.equal(defaults.settings.java.project,undefined);
  assert.equal(defaults.settings.java.configuration.updateBuildConfiguration,'automatic');
  assert.throws(()=>projectServer(server,projectConfiguration(server,{settings:JSON.parse('{"__proto__":{"unsafe":true}}')})),/Invalid settings/);
  const maven=projectServer(server,projectConfiguration(server,{values:{mavenSettings:'.mvn/settings.xml'}}),'/home/me/calc/');
  assert.equal(maven.settings.java.configuration.maven.userSettings,'/home/me/calc/.mvn/settings.xml');
  assert.equal(maven.initializationOptions.settings.java.configuration.maven.userSettings,'/home/me/calc/.mvn/settings.xml');
  assert.ok(server.buildFiles.includes('pom.xml'));
});

test('language MCP configuration is scoped to the authenticated workspace and reports import failures', async()=>{
 const {default:mod}=await load('modules/services/language-service/src/index.ts');
 const c=context('ssh');await mod.activate(c.ctx);
 try {
  await c.handlers['internal-mcp.call']({module:'language-service',generation:1,id:'get',tool:'project_get',args:{serverId:'jdtls',workspaceId:'injected'},scope:{workspaceId:'ws',machineId:'ssh:test',conversationId:'agent'}});
  const result=c.events.find(e=>e.name==='language-service.mcp.result'&&e.value.id==='get');
  assert.equal(result.value.result.config.enabled,true);
  assert.ok(c.calls.some(call=>call.id==='workspace'&&call.method==='resolve'&&call.a.workspaceId==='ws'));
  assert.ok(!c.calls.some(call=>call.a?.workspaceId==='injected'));
  await c.handlers['internal-mcp.call']({module:'language-service',generation:1,id:'bad',tool:'project_update',args:{serverId:'jdtls',config:{enabled:false}},scope:{workspaceId:'ws',machineId:'other',conversationId:'agent'}});
  assert.match(c.events.find(e=>e.value.id==='bad').value.error,/machine/);
  const args={workspaceId:'ws',serverId:'jdtls',path:'Main.java',text:'class Main {}'};
  await mod.methods.synchronize(c.ctx,args);
  const notify=(method,params)=>c.processes[0].listeners.stdout(Buffer.from(lspFrame({jsonrpc:'2.0',method,params})).toString('base64'));
  notify('window/logMessage',{type:1,message:'Invalid project description: overlap'});
  notify('$/progress',{token:1,value:{kind:'end'}});
  assert.equal((await mod.methods['project.get'](c.ctx,args)).status.phase,'error');
  await c.handlers['internal-mcp.call']({module:'language-service',generation:1,id:'set',tool:'project_update',args:{serverId:'jdtls',config:{enabled:false}},scope:{workspaceId:'ws',machineId:'ssh:test',conversationId:'agent'}});
  assert.equal(c.settings.get('language-server.jdtls.project').enabled,false);
  assert.ok(c.events.some(e=>e.name==='language-service.configurationChanged'));
 } finally {await mod.deactivate(c.ctx);}
});

for (const location of ['local','ssh']) test(`JDTLS stays warm across ${location} workspace switches and evicts old servers gracefully`, async()=>{
 const {default:mod}=await load('modules/services/language-service/src/index.ts');const c=context(location);
 const workspaces=new Map([['ws',c.workspace],...['b','c','d'].map(id=>[id,{...c.workspace,id,rootAbsolutePath:`/srv/project-${id}`}])]);
 const original=c.ctx.modules.call;
 c.ctx.modules.call=async(id,m,a)=>id==='workspace'?workspaces.get(a.workspaceId):original(id,m,a);
 const lifecycle=[],write=c.ctx.host.process.write,terminate=c.ctx.host.process.terminate;
 c.ctx.host.process.write=async(handle,frame)=>{lifecycle.push({handle,method:JSON.parse(frame.split('\r\n\r\n')[1]).method});return write(handle,frame);};
 c.ctx.host.process.terminate=async(handle)=>{lifecycle.push({handle,method:'terminate'});return terminate(handle);};
 await mod.activate(c.ctx);
 const open=async id=>{c.watchers['workspace.selected'](workspaces.get(id));await new Promise(setImmediate);return mod.methods.hover(c.ctx,{workspaceId:id,path:'Main.java',text:'class Main {}',position:{line:0,character:6}});};
 try {
  await open('ws');await open('b');await open('ws');
  assert.equal(c.processes.length,2,'returning to a workspace reuses its initialized JDTLS process');
  assert.ok(c.processes.every(p=>!p.stopped));
  await open('c');await open('d');await new Promise(setImmediate);
  const evicted=c.processes[1];assert.equal(evicted.stopped,true,'least recently used server is evicted');assert.equal(c.processes[0].stopped,false,'recently revisited server stays warm');
  const events=lifecycle.filter(e=>e.handle===evicted.handle).map(e=>e.method);
  assert.ok(events.indexOf('shutdown')>=0);assert.ok(events.indexOf('exit')>events.indexOf('shutdown'));assert.ok(events.indexOf('terminate')>events.indexOf('exit'));
  const firstData=c.calls.find(x=>x.run?.args?.includes(workspaces.get('b').rootAbsolutePath)).run.args;
  await open('b');await new Promise(setImmediate);
  const secondData=c.calls.filter(x=>x.run?.args?.includes(workspaces.get('b').rootAbsolutePath)).at(-1).run.args;
  assert.deepEqual(secondData,firstData,'evicted workspaces reuse their durable index generation');
  assert.ok(!c.calls.some(x=>x.method==='scoped.set'&&x.a?.key?.endsWith('.index')),'workspace switches must not request a fresh index');
 }finally{await mod.deactivate(c.ctx);}
 assert.ok(c.processes.every(p=>p.stopped));
});
