#!/usr/bin/env node
// Real stdio server smoke test using the actual language-service module and a disposable project.
// Usage: node tools/smoke-languages.mjs typescript /absolute/path/to/typescript-language-server
//        JAVA_HOME=/jdk node tools/smoke-languages.mjs java /absolute/path/to/jdtls
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn,execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
const [language, executable] = process.argv.slice(2);
if (!['java','typescript'].includes(language) || !executable) throw Error('Specify java|typescript and a server executable');
const moduleRoot = new URL('../', import.meta.url);
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'hato-language-smoke-')));
const code = (await build({entryPoints:[new URL('../modules/services/language-service/src/index.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'esm',write:false})).outputFiles[0].text;
const mod = (await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))).default;
const manifest = JSON.parse(await fs.readFile(new URL(`modules/services/language-${language === 'java' ? 'java' : 'typescript'}/manifest.json`,moduleRoot),'utf8'));
const descriptor = {id:'smoke',name:'Smoke',location:'local',machineId:'local',rootAbsolutePath:root};
const processes = new Map(), settings = new Map(); let id = 0;
settings.set(`language-server.${language === "java" ? "jdtls" : "typescript-language-server"}.executable`, executable);
const ctx = {moduleId:'language-service',log:console,ui:{invalidate(){}},events:{on(){},emit(){}},state:{get:()=>descriptor,set(){},watch(){}},
  modules:{call:async(target,method,a)=>{if(target==='workspace')return descriptor;if(method==='scoped.resolve')return settings.has(a.key)?{value:settings.get(a.key)}:null;if(method==='scoped.set'){settings.set(a.key,a.value);return {applied:true};}return null;}},
  host:{plugins:{list:async()=>({plugins:[{...manifest,enabled:true,active:'smoke'}]})},capabilities:{request:async()=>({grant:'smoke'})},
    resources:{release:async()=>{}},process:{
      run:async(_grant,spec)=>({code:0,stdout:execFileSync(spec.executable,spec.args,{cwd:spec.cwd,env:{...process.env,HATO_LANGUAGE_SERVER_DATA_HOME:path.join(root,'..','hato-language-data-smoke')}}).toString(),stderr:''}),
      spawn:async(_grant,spec)=>{
        const child=spawn(spec.executable,spec.args,{cwd:spec.cwd,env:process.env});
        child.on('error',error=>console.error(error));
        const handle=String(++id);processes.set(handle,child);return {handle};
      },
      write:async(handle,text)=>new Promise((resolve,reject)=>processes.get(handle).stdin.write(text,error=>error?reject(error):resolve())),
      terminate:async handle=>{processes.get(handle).kill('SIGTERM');},
    },streams:{listen:async(handle,opts,onData,onEnd)=>{
      const stream=processes.get(handle)[opts.channel];
      const data=chunk=>onData(opts.encoding==='base64'?chunk.toString('base64'):chunk.toString('utf8'));
      const end=()=>onEnd?.(null);
      stream.on('data',data);stream.on('end',end);
      return {close:async()=>{stream.off('data',data);stream.off('end',end);}};
    }},
  },
};
try {
  let filename, text, target;
  if(language==='typescript') {
    await fs.writeFile(path.join(root,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2020',module:'commonjs',strict:true},include:['*.ts']}));
    await fs.writeFile(path.join(root,'target.ts'),'export const target = 42;\n');
    filename='main.ts';text='import { target } from "./target";\nconsole.log(target);\nfunction run() { return target; }\n';target='/target.ts';
  } else {
    await fs.mkdir(path.join(root,'src'),{recursive:true});
    // Plain Java project exercises explicit source folders without Maven downloads.
    await fs.mkdir(path.join(root,'src/main/java'),{recursive:true});
    filename='src/main/java/Main.java';text='class Main {\n  static int target = 42;\n  int value = target;\n}\n';target='/Main.java';
  }
  await fs.writeFile(path.join(root,filename),text);
  if(language==='java')await fs.writeFile(path.join(root,'src/main/java/Other.java'),'class Other {}\n');
  await mod.activate(ctx);
  if(language==='java') await mod.methods['project.set'](ctx,{workspaceId:'smoke',serverId:'jdtls',config:{enabled:true,values:{sourcePaths:['src/main/java'],outputPath:'bin'}}});
  const status=await mod.methods.synchronize(ctx,{workspaceId:'smoke',path:filename,text});
  assert.equal(status.phase,'ready');
  const symbols=await mod.methods.symbols(ctx,{workspaceId:'smoke',path:filename,text});
  assert.ok(symbols.length,'Server returned no document symbols');
  const position=language==='typescript'?{line:0,character:11}:{line:2,character:15};
  const result=await mod.methods.definitions(ctx,{workspaceId:'smoke',path:filename,text,position});
  assert.ok(result.some(location=>location.targetUri.endsWith(target)),JSON.stringify(result));
  console.log('project',root);
  let projectSymbols=[];
  for(let attempt=0;attempt<40&&!projectSymbols.length;attempt++){
   projectSymbols=await mod.methods.workspaceSymbols(ctx,{workspaceId:'smoke',serverId:language==='java'?'jdtls':'typescript-language-server',query:language==='java'?'Other':'target'});
   if(!projectSymbols.length)await new Promise(r=>setTimeout(r,500));
  }
  assert.ok(projectSymbols.length,'No workspace symbols returned');
  const hover=await mod.methods.hover(ctx,{workspaceId:'smoke',path:filename,text,position});
  assert.ok(hover?.contents,'Server returned no hover information');
  const completionText = language==='typescript' ? text+'const completionProbe = tar' : text;
  const completionPosition = language==='typescript' ? {line:text.split('\n').length-1,character:'const completionProbe = tar'.length} : position;
  const completions=await mod.methods.completions(ctx,{workspaceId:'smoke',path:filename,text:completionText,position:completionPosition,context:{triggerKind:1}});
  assert.ok((Array.isArray(completions)?completions:completions.items)?.length,'Server returned no completions');
  // Prove unsaved text is sent, without writing the new symbol to disk.
  const changed=text.replaceAll('target','renamed').replace('"./renamed"','"./target"');
  const documents=language==='typescript'?[{path:'target.ts',text:'export const renamed = 43;\n'}]:[];
  const next=await mod.methods.definitions(ctx,{workspaceId:'smoke',path:filename,text:changed,position,documents});
  assert.ok(next.some(location=>location.targetUri.endsWith(target)),JSON.stringify(next));
  console.log(`${language}: real server startup + project settings + symbols + hover + completion + unsaved-buffer navigation passed`);
} finally {
  await mod.deactivate(ctx);
  for(const child of processes.values()) child.kill('SIGTERM');
  if(!process.env.HATO_KEEP_SMOKE_PROJECT)await fs.rm(root,{recursive:true,force:true,maxRetries:4});
}
