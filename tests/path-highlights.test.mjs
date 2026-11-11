import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const load=async path=>{
 const r=await build({entryPoints:[new URL(path,import.meta.url).pathname],bundle:true,format:'esm',write:false,alias:{'@hato/sdk':new URL('../../sdk',import.meta.url).pathname}});
 return import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));
};
const model=await load('../modules/services/path-highlights/src/model.ts');
const sdk=await load('../../sdk/file-presentation.ts');
test('relative highlight paths include descendants without prefix collisions and support globs',()=>{
 const matches=(pattern,path)=>new RegExp(model.pathPattern(pattern)).test(path);
 assert.ok(matches('src/test','src/test/Foo.java'));
 assert.ok(matches('src/test/**','src/test'));
 assert.equal(matches('src/test','src/testing/Foo.java'),false);
 for(const path of ['src/test/Foo.java','module/src/test/Foo.java','a/b/src/test/Foo.java'])assert.ok(matches('**/src/test',path));
 assert.ok(matches('modules/*/source','modules/demo/source/Foo.java'));
 assert.equal(matches('modules/*/source','modules/a/b/source/Foo.java'),false);
 assert.ok(matches('**/*.java','mod/Foo.java'));
 assert.equal(matches('**/*.java','FooXjava'),false);
 assert.equal(model.relativePattern('./src\\test/'),'src/test');
 for(const path of ['/etc','../outside','src/../outside','C:\\code','src/./x',''])assert.throws(()=>model.relativePattern(path));
 assert.throws(()=>model.hexColor('red'));assert.equal(model.hexColor('#ABCDEF'),'#abcdef');
 for(const value of ['',-1,101,1.5])assert.throws(()=>model.opacityValue(value));
});
test('user rules override language backgrounds while preserving icons and respecting toggles',()=>{
 const settings=model.readSettings({rules:[{id:'one',path:'src',color:'#abcdef'},{id:'bad',path:'../x',color:'red'},{id:'one',path:'x',color:'#ffffff'}]});
 assert.equal(settings.rules.length,1);
 const plugin=(id,contribution)=>({id,enabled:true,active:{version:1},contributes:{filePresentation:contribution}});
 const rules=sdk.filePresentationRules([plugin('path-highlights',model.presentation(settings)),plugin('zzz-language',{rules:[{id:'lang',pathPattern:'.*',background:'#000000ff',iconSvg:'class'}]})]);
 assert.deepEqual(sdk.presentFile(rules,{path:'src/File',kind:'file'}),{background:'#abcdef0f',iconSvg:'class'});
 assert.deepEqual(model.presentation({...settings,enabled:false}),{rules:[]});
 assert.deepEqual(model.presentation({...settings,rules:settings.rules.map(r=>({...r,enabled:false}))}),{rules:[]});
});
test('settings add, edit, validate, persist globally and remove rules',async()=>{
 const module=(await load('../modules/services/path-highlights/src/index.ts')).default;
 const saved=new Map();
 const context=()=>{
  const values=new Map(),events=new Map();
  return {moduleId:'path-highlights',state:{get:k=>values.get(k),set:(k,v)=>values.set(k,v)},ui:{invalidate(){}},events:{on(n,f){const list=events.get(n)||[];list.push(f);events.set(n,list);},emit(n,v){for(const fn of events.get(n)||[])fn(v);}},modules:{async call(id,method,args){assert.equal(id,'persistence');assert.equal(args.key,'path-highlights.shared.v1');if(method==='settings.get')return saved.get(args.key);saved.set(args.key,structuredClone(args.value));}}};
 };
 const ctx=context();await module.activate(ctx);
 const flush=()=>new Promise(resolve=>setImmediate(resolve));
 const send=async(name,section,key,value)=>{ctx.events.emit(name,{module:'path-highlights',section,key,value});await flush();};
 await send('settings.action','shared','add');
 const section=ctx.state.get('path-highlights.settings').sections[1].key;
 await send('settings.change',section,'path','**/generated');
 await send('settings.change',section,'color','#AA1122');
 assert.equal(saved.get('path-highlights.shared.v1').rules[0].color,'#aa1122');
 await send('settings.change',section,'path','../invalid');
 assert.match(ctx.state.get('path-highlights.settings').error,/relative path/);
 assert.equal(saved.get('path-highlights.shared.v1').rules[0].path,'**/generated');
 const other=context();await module.activate(other);
 assert.equal(other.state.get('path-highlights.settings').sections[1].fields.find(f=>f.key==='path').value,'**/generated');
 await send('settings.change',section,'enabled',false);
 assert.deepEqual(ctx.state.get('path-highlights.filePresentation'),{rules:[]});
 await send('settings.action',section,'remove');
 assert.equal(saved.get('path-highlights.shared.v1').rules.length,0);
});
