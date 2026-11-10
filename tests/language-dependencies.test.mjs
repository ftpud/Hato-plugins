import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';
async function load(name){
 const code=(await build({entryPoints:[new URL('../modules/services/language-service/src/'+name,import.meta.url).pathname],bundle:true,format:'esm',platform:'node',write:false})).outputFiles[0].text;
 return import('data:text/javascript;base64,'+Buffer.from(code).toString('base64')+'#'+Math.random());
}
const {DEPENDENCY_SCRIPT}=await load('dependency-script.ts');
const setup={kind:'jdtls',javaMajor:21,version:'test',url:'https://fixture.invalid/jdtls.tar.gz',sha256:'a'.repeat(64)};

test('real Python dependency check is read-only and does not execute a configured language server',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hato-dependency-check-'));
 try{
  const marker=path.join(root,'server-ran');
  const server=path.join(root,"server with 'quotes'");
  fs.writeFileSync(server,'#!/bin/sh\ntouch '+JSON.stringify(marker)+'\n',{mode:0o755});
  const request={action:'check',server:'jdtls',setup,executable:server,root:path.join(root,'not-created')};
  const result=spawnSync('python3',['-c',DEPENDENCY_SCRIPT,JSON.stringify(request)],{encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,result.stderr+result.stdout);
  const parsed=JSON.parse(result.stdout.trim().split('__HATO_DEPENDENCIES__=')[1]);
  assert.ok(parsed.components.some(c=>c.label==='jdtls'&&c.found));
  assert.equal(fs.existsSync(marker),false);
  assert.equal(fs.existsSync(request.root),false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('Python installer verifies checksums, rejects escaping archives and creates a usable JDTLS wrapper',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hato-dependency-install-'));
 try{
  const python=`
import io, json, os, pathlib, subprocess, tarfile, unittest.mock as mock, hashlib, shutil
namespace={'__name__':'hato_dependency_test'}
exec(${JSON.stringify(DEPENDENCY_SCRIPT)},namespace)
root=pathlib.Path(${JSON.stringify(root)})
# Real extraction rejects traversal before writing outside the staging root.
archive=root/'bad.tar.gz'
with tarfile.open(archive,'w:gz') as tar:
 item=tarfile.TarInfo('../escaped');item.size=1;tar.addfile(item,io.BytesIO(b'x'))
try:namespace['extract'](archive,root/'bad-extract');raise AssertionError('accepted traversal')
except ValueError:pass
assert not (root/'escaped').exists()
archive=root/'bad-link.tar.gz'
with tarfile.open(archive,'w:gz') as tar:
 item=tarfile.TarInfo('link');item.type=tarfile.SYMTYPE;item.linkname='../../escape';tar.addfile(item)
try:namespace['extract'](archive,root/'link-extract');raise AssertionError('accepted escaping link')
except ValueError:pass
class Response(io.BytesIO):
 def geturl(self):return 'https://fixture.invalid/archive'
with mock.patch('urllib.request.urlopen',return_value=Response(b'corrupt')):
 try:namespace['download']('https://fixture.invalid/archive',root/'archive', '0'*64);raise AssertionError('accepted wrong checksum')
 except ValueError as error:assert 'checksum' in str(error)
# Install a local archive through the same code used for an official downloaded archive.
runtime=root/"runtime 'quoted'"/'bin/java';runtime.parent.mkdir(parents=True)
runtime.write_text(${JSON.stringify("#!/bin/sh\necho 'openjdk version \"21.0.1\"' >&2\n")});runtime.chmod(0o755)
archive=root/'jdtls.tar.gz'
with tarfile.open(archive,'w:gz') as tar:
 payload=b'import json,os,sys; print(json.dumps({"java":os.environ["JAVA_HOME"],"args":sys.argv[1:]}))'
 item=tarfile.TarInfo('bin/jdtls');item.size=len(payload);item.mode=0o755;tar.addfile(item,io.BytesIO(payload))
digest=hashlib.sha256(archive.read_bytes()).hexdigest();downloads=[]
def download(url,target,sha):
 assert sha==digest;downloads.append(url);shutil.copyfile(archive,target)
namespace['download']=download
namespace['machine']=lambda:('mac','aarch64')
namespace['java_candidates']=lambda root,minimum:[{'path':str(runtime),'version':'21'}]
request={'action':'install','server':'jdtls','executable':'/absent-jdtls','root':str(root/'managed tools'), 'setup':{'kind':'jdtls','version':'fixture','javaMajor':21,'url':'https://fixture.invalid/jdtls.tar.gz','sha256':digest}}
result=namespace['main'](request)
assert result['ready'],result
response=json.loads(subprocess.check_output([result['executable'],'--fixture'],text=True))
assert response['java']==str(runtime.resolve().parent.parent),response
assert response['args']==['--fixture']
assert namespace['main'](request)['ready']
assert len(downloads)==1,'repeat installation must reuse downloaded artifacts'
(root/'managed tools/.install.lock').write_text('99999999')
assert namespace['main'](request)['ready'],'recover an installation lock left by a dead helper'
assert not (root/'managed tools/.install.lock').exists()
# Missing runtimes select platform-specific, checksummed official downloads.
namespace['java_candidates']=lambda root,minimum:[]
namespace['machine']=lambda:('linux','x64')
requests=[]
def jdk_fetch(url):
 requests.append(url)
 return json.dumps([{'binary':{'package':{'link':'https://fixture.invalid/java.tar.gz','checksum':'f'*64}}}]).encode()
def jdk_archive(root,name,url,digest,flatten):
 assert name=='java' and digest=='f'*64 and flatten
 binary=root/name/'bin/java';binary.parent.mkdir(parents=True)
 binary.write_text(${JSON.stringify("#!/bin/sh\necho 'openjdk version \"21.0.1\"' >&2\n")});binary.chmod(0o755)
 return root/name
namespace['fetch']=jdk_fetch;namespace['install_archive']=jdk_archive
jdk=namespace['install_java'](root,21)
assert jdk.endswith('/java/bin/java')
assert 'os=linux' in requests[-1] and 'architecture=x64' in requests[-1]
namespace['executable']=lambda value:None
namespace['runtime']=lambda path,kind,minimum:{'path':path,'version':'v24'} if path and path.endswith('/node/bin/node') else None
namespace['machine']=lambda:('mac','aarch64')
namespace['fetch']=lambda url:('e'*64+'  node-v24.0.0-darwin-arm64.tar.gz\\n').encode()
def node_archive(root,name,url,digest,flatten):
 assert url.endswith('/latest-v24.x/node-v24.0.0-darwin-arm64.tar.gz') and digest=='e'*64
 npm=root/name/'lib/node_modules/npm/bin/npm-cli.js';npm.parent.mkdir(parents=True);npm.write_text('// fixture')
 return root/name
namespace['install_archive']=node_archive
node,npm=namespace['install_node'](root,24)
assert node.endswith('/node/bin/node') and npm.endswith('/npm-cli.js')
print('installer checks passed')
`;
  const result=spawnSync('python3',['-c',python],{encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,result.stderr+result.stdout);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

for(const location of ['local','ssh'])test(`dependency actions run on the ${location} workspace, report progress, and configure the verified executable`,async()=>{
 const {LanguageDependencies}=await load('dependencies.ts');
 const workspace={id:'dependencies-'+location,name:'Example',location,machineId:location==='ssh'?'ssh:fixture':'local',rootAbsolutePath:'/project with spaces',...(location==='ssh'?{ssh:{profileId:'fixture',host:'host',user:'dev',port:22}}:{})};
 let selected=workspace;
 const runs=[],writes=[],configured=[],published=[];
 let finish;
 const ctx={modules:{call:async(id,method,a)=>{
  if(id==='workspace')return workspace;
  if(method==='scoped.resolve')return null;
  if(method==='scoped.set'){writes.push(a);return {rev:1,applied:true};}
  throw Error(method);
 }},host:{
  ssh:{connect:async()=>({connection:'ssh-connection',machineId:'ssh:fixture'})},
  capabilities:{request:async spec=>{assert.equal(spec.target.kind,location);return {grant:'g'};}},
  process:{run:async(grant,request)=>{
   const input=JSON.parse(request.args.at(-1));runs.push({grant,request,input});
   if(input.action==='install')await new Promise(resolve=>{finish=resolve;});
   const ready=input.action==='install';
   return {code:0,stdout:'login shell banner\n__HATO_DEPENDENCIES__='+JSON.stringify({ready,executable:ready?'/managed/bin/jdtls':null,supported:true,directory:'/managed',components:[{label:'jdtls',found:ready}]}),stderr:''};
  }},
 }};
 const server={id:'jdtls',executable:'jdtls',dependencySetup:setup};
 const manager=new LanguageDependencies(ctx,()=>[server],()=>selected,()=>published.push(manager.fields(server)),async(...args)=>configured.push(args));
 assert.equal(manager.fields(server)[1].disabled,false);
 assert.equal((await manager.action('jdtls','checkDependencies')).ready,false);
 assert.equal(writes.length,0,'check must not mutate the executable preference');
 const install=manager.action('jdtls','installDependencies');
 await new Promise(r=>setImmediate(r));
 assert.equal(manager.busy,true);assert.ok(manager.fields(server).every(f=>f.disabled));
 await assert.rejects(manager.action('jdtls','installDependencies'),/already running/);
 // Installation stays bound to the captured workspace when the user changes selection.
 selected={...workspace,id:'other',name:'Other'};
 assert.ok(manager.fields(server)[0].description.includes('Other'));
 finish();await install;
 assert.equal(writes[0].scope,'workspace:'+workspace.id);assert.equal(writes[0].value,'/managed/bin/jdtls');
 assert.equal(configured[0][0].id,workspace.id);assert.equal(manager.busy,false);
 for(const run of runs){assert.equal(run.request.target.kind,location);assert.equal(run.request.loginShell,location==='ssh');assert.equal(run.request.cwd,workspace.rootAbsolutePath);}
 selected=workspace;
 assert.ok(manager.fields(server)[0].description.startsWith('Ready'));
 assert.equal(manager.fields(server)[1].disabled,true);
 manager.invalidate('jdtls',workspace.id);
 assert.equal(manager.fields(server)[1].disabled,false,'editing an executable clears the old Ready state');
});

test('dependency installer errors clear busy state and never persist a failing executable',async()=>{
 const {LanguageDependencies}=await load('dependencies.ts');
 const ws={id:'failed-install',name:'Failed',location:'local',machineId:'local',rootAbsolutePath:'/fixture'};
 const server={id:'jdtls',executable:'jdtls',dependencySetup:setup};
 let writes=0;
 const ctx={modules:{call:async(id,method)=>{if(id==='workspace')return ws;if(method==='scoped.set')writes++;return null;}},host:{capabilities:{request:async()=>({grant:'g'})},process:{run:async()=>({code:1,stdout:'__HATO_DEPENDENCIES__='+JSON.stringify({error:'Dependency checksum mismatch'}),stderr:''})}}};
 const manager=new LanguageDependencies(ctx,()=>[server],()=>ws,()=>{},async()=>assert.fail('must not configure failed installs'));
 await assert.rejects(manager.action('jdtls','installDependencies'),/checksum/);
 assert.equal(writes,0);assert.equal(manager.busy,false);assert.equal(manager.fields(server)[1].disabled,false);
 assert.ok(manager.fields(server)[0].description.includes('checksum'));
});

test('dependency checks try Python aliases and report the required Python version when none can start',async()=>{
 const {LanguageDependencies}=await load('dependencies.ts');
 const ws={id:'no-python',name:'No Python',location:'local',machineId:'local',rootAbsolutePath:'/fixture'};
 const server={id:'jdtls',executable:'jdtls',dependencySetup:setup};
 const attempts=[];
 const ctx={modules:{call:async id=>id==='workspace'?ws:null},host:{capabilities:{request:async()=>({grant:'g'})},process:{run:async(_grant,request)=>{
  attempts.push(request.executable);throw Object.assign(new Error('failed to start '+request.executable),{code:'ENOEXEC'});
 }}}};
 const manager=new LanguageDependencies(ctx,()=>[server],()=>ws,()=>{},async()=>{});
 await assert.rejects(manager.action('jdtls','checkDependencies'),/Python 3\.8\+ is required/);
 assert.deepEqual(attempts,['python3','python']);assert.equal(manager.busy,false);
});
