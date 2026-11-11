import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const load = async path => import('data:text/javascript;base64,' + Buffer.from((await build({entryPoints:[new URL(path,import.meta.url).pathname],bundle:true,format:'esm',write:false,alias:{'@hato/sdk':new URL('../../sdk',import.meta.url).pathname}})).outputFiles[0].text).toString('base64'));
const {gitOperations} = await load('../modules/services/git/src/operations.ts');
async function fixture(fn) {
 const root=await mkdtemp(join(tmpdir(),'hato-git-'));
 const git=(...args)=>execFileSync('git',[...(args[0] === 'stash' ? [] : ['--literal-pathspecs']),...args],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});
 const settings=new Map();
 const ctx={modules:{call:async(_id,m,a)=> m==='settings.get'? settings.get(a.key):settings.set(a.key,a.value)},events:{emit(){}},host:{ui:{documentOpen:async(_id,text)=>text}}};
 const ops=gitOperations({desc:async()=>({id:'task:test',rootAbsolutePath:root}),git:async(_ctx,_d,args)=>{try{return {code:0,stdout:git(...args),stderr:'',truncated:false};}catch(e){return {code:e.status,stdout:e.stdout||'',stderr:e.stderr||'',truncated:false};}},fail:(r,w)=>{throw new Error(w+': '+r.stderr);},cleanRel:p=>{if(!p||p.startsWith('/')||p.split('/').includes('..'))throw Error('path');return p;}});
 try {git('init','-b','main');git('config','user.email','test@example.com');git('config','user.name','Test');await writeFile(join(root,'base'),'base\n');git('add','.');git('commit','-m','initial');await fn({root,git,ctx,ops,settings});} finally {await rm(root,{recursive:true,force:true});}
}
test('selected commit preserves unrelated staged changes and treats magic filenames literally',async()=>fixture(async({root,git,ctx,ops})=>{
 await writeFile(join(root,'base'),'other staged change\n');git('add','base');
 await writeFile(join(root,'[feature].txt'),'selected\n');
 await ops.commit(ctx,{workspaceId:'task:test',paths:['[feature].txt'],message:'selected commit'});
 assert.equal(git('show','--format=','--name-only','HEAD').trim(),'[feature].txt');
 assert.equal(git('diff','--cached','--name-only').trim(),'base');
 assert.equal(git('show','HEAD:base'),'base\n');
 await assert.rejects(ops.commit(ctx,{workspaceId:'task:test',paths:['.'],message:'no directory selections'}),/no longer changed/);
}));
test('renames commit both paths while leaving other staged files alone',async()=>fixture(async({root,git,ctx,ops})=>{
 git('mv','base','renamed');await writeFile(join(root,'unrelated'),'staged\n');git('add','unrelated');
 await ops.commit(ctx,{workspaceId:'task:test',paths:['renamed'],message:'rename'});
 assert.match(git('show','--format=','--name-status','HEAD'),/R100\s+base\s+renamed/);
 assert.equal(git('diff','--cached','--name-only').trim(),'unrelated');
}));
test('task baseline retains committed edits, deletions and untracked files',async()=>fixture(async({root,git,ctx,ops,settings})=>{
 const base=git('rev-parse','HEAD').trim();settings.set('git.taskBase.task:test',base);
 await writeFile(join(root,'base'),'committed change\n');git('add','.');git('commit','-m','task work');await writeFile(join(root,'new'),'untracked\n');
 const r=await ops.taskChanges(ctx,{workspaceId:'task:test'});
 assert.equal(r.base,base);assert.deepEqual(r.files.map(f=>f.path).sort(),['base','new']);
 assert.equal(git('diff','--name-only').trim(),'');
 git('rm','base');git('commit','-m','delete');
 assert.equal((await ops.taskChanges(ctx,{workspaceId:'task:test'})).files.find(f=>f.path==='base').kind,'deleted');
 await assert.rejects(ops.setTaskBase(ctx,{workspaceId:'task:test',id:git('rev-parse','HEAD').trim()}),/fixed baseline/);
}));
test('stash IDs stay stable and history includes branches and merge parentage',async()=>fixture(async({root,git,ctx,ops})=>{
 await writeFile(join(root,'new'),'stash me');await ops.stash(ctx,{workspaceId:'task:test',operation:'save',message:'saved work'});
 const list=await ops.stashes(ctx,{workspaceId:'task:test'});assert.equal(list.length,1);
 await ops.stash(ctx,{workspaceId:'task:test',operation:'apply',id:list[0].id});assert.equal((await ops.stashes(ctx,{workspaceId:'task:test'})).length,1);
 await ops.stash(ctx,{workspaceId:'task:test',operation:'drop',id:list[0].id});assert.equal((await ops.stashes(ctx,{workspaceId:'task:test'})).length,0);
 git('checkout','-b','feature');await writeFile(join(root,'feature'),'work');git('add','feature');git('commit','-m','feature commit');git('checkout','main');git('merge','--no-ff','feature','-m','merge feature');
 const history=await ops.history(ctx,{workspaceId:'task:test',ref:'ALL'});assert.equal(history.commits[0].parents.length,2);assert.match(history.commits[0].refs,/main/);
 assert.match((await ops.commitDiff(ctx,{workspaceId:'task:test',id:history.commits[0].id})).document,/feature/);
}));
test('graph connects merge parents across lanes',async()=>{
 const {commitGraph}=await load('../modules/ui/git-history/src/graph.ts');
 const graph=commitGraph([{id:'merge',parents:['a','b']},{id:'b',parents:['base']},{id:'a',parents:['base']},{id:'base',parents:[]}]);
 assert.equal(graph.size,4);assert.match(graph.get('merge'),/M8 24C8 40 20 40 20 58/);assert.match(graph.get('b'),/cx="20"/);
});
test('legacy task recovers the original worktree baseline rather than the latest commit',async()=>fixture(async({root,git,ctx,ops,settings})=>{
 const baseline=git('rev-parse','HEAD').trim();
 git('worktree','add','-b','task/old',join(root,'worktree'));
 const original=ctx.modules.call;
 ctx.modules.call=async(id,m,a)=>m==='tasks.get'?{createdAt:new Date().toISOString()}:original(id,m,a);
 const oldOps=gitOperations({desc:async()=>({id:'task:old',rootAbsolutePath:join(root,'worktree')}),git:async(_c,_d,args)=>{try{return {code:0,stdout:git('-C',join(root,'worktree'),...args),stderr:'',truncated:false};}catch(e){return {code:e.status,stdout:e.stdout||'',stderr:e.stderr||'',truncated:false};}},fail:(_r,w)=>{throw Error(w);},cleanRel:p=>p});
 await writeFile(join(root,'worktree','base'),'committed work\n');git('-C',join(root,'worktree'),'commit','-am','task edit');
 const r=await oldOps.taskChanges(ctx,{workspaceId:'task:old'});
 assert.equal(r.base,baseline);assert.deepEqual(r.files.map(f=>f.path),['base']);assert.equal(settings.get('git.taskBase.task:old'),baseline);
}));
const walk = n => [n,...(n.children||[]).flatMap(walk)];
test('changeset tabs move files exclusively and retain commit drafts across reload and workspace switches',async()=>{
 const {default: panel}=await load('../modules/ui/git-panel/src/index.ts');
 const state={'workspace.selected':{id:'task:one'},'workspace-layout.panels':{git:true}}, watches={}, stored=new Map();
 const ctx={moduleId:'git-panel',state:{get:k=>state[k],set(){},watch:(k,f)=>watches[k]=f},events:{on(){},emit(){}},ui:{invalidate(){}},modules:{call:async(_id,m,a)=>{
  if(m==='status')return {repo:true,workspaceId:a.workspaceId,branch:'main',files:[{path:'a.ts',kind:'modified'},{path:'b.ts',kind:'untracked'}]};
  if(m==='settings.get')return stored.get(a.key)??null;
  if(m==='settings.set')stored.set(a.key,structuredClone(a.value));
 }}};
 const ev=(action,value,inputs={})=>({action,value,inputs});
 await panel.activate(ctx);
 await panel.onEvent(ctx,ev('check:a.ts'));
 await panel.onEvent(ctx,ev('createSet',null,{'set-name':'Feature'}));
 let nodes=walk(panel.render());
 assert.ok(nodes.some(n=>n.action==='diff'&&n.value==='a.ts'));assert.ok(!nodes.some(n=>n.action==='diff'&&n.value==='b.ts'));
 await panel.onEvent(ctx,ev('message','feature message'));
 await panel.onEvent(ctx,ev('set','main'));
 nodes=walk(panel.render());assert.ok(!nodes.some(n=>n.action==='diff'&&n.value==='a.ts'));assert.ok(nodes.some(n=>n.action==='diff'&&n.value==='b.ts'));
 const feature=panel.snapshot().drafts['task:one'].sets.find(s=>s.name==='Feature').id;
 await panel.onEvent(ctx,ev('set',feature));
 panel.deactivate();await panel.activate(ctx,panel.snapshot());
 assert.equal(walk(panel.render()).find(n=>n.key===`message:${feature}`).value,'feature message');
 // A render can happen while another workspace's status is loading. It must not mask saved drafts.
 stored.set('git-panel.changesets.task:two',{sets:[{id:'main',name:'Changes',paths:[],message:'saved on two'}],active:'main'});
 watches['workspace.selected']({id:'task:two'});panel.render();await new Promise(setImmediate);
 assert.equal(walk(panel.render()).find(n=>n.key==='message:main').value,'saved on two');
 panel.deactivate();
});
test('selected deletions work when they have already been removed from the index',async()=>fixture(async({git,ctx,ops})=>{
 git('rm','base');
 await ops.commit(ctx,{workspaceId:'task:test',paths:['base'],message:'remove base'});
 assert.match(git('show','--format=','--name-status','HEAD'),/D\s+base/);
}));
test('Git changes groups paths in an expandable left-aligned tree and selects folder descendants', async () => {
 const {default:panel}=await load('../modules/ui/git-panel/src/index.ts');
 const changes=['src/z.ts','src/nested/a.ts','src2/other.ts','README.md'].map(path=>({path,kind:'modified'}));
 const ctx={moduleId:'git-panel',state:{get:k=>k==='workspace.selected'?{id:'tree-test'}:k==='workspace-layout.panels'?{git:true}:null,set(){},watch(){}},events:{on(){},emit(){}},ui:{invalidate(){}},modules:{call:async(_id,m)=>m==='status'?{repo:true,branch:'main',files:changes}:null}};
 const event=(action,value)=>({action,value,inputs:{}});
 await panel.activate(ctx);
 let nodes=walk(panel.render());
 const folder=nodes.find(n=>n.action==='folder'&&n.tooltip==='src');
 assert.equal(folder.style.justify,'start');
 assert.notEqual(folder.grow,true,'native button contents are centered, so the filename must not stretch');
 const fileButton=nodes.find(n=>n.action==='diff'&&n.value==='src/nested/a.ts');
 assert.notEqual(fileButton.grow,true);
 const fileRow=nodes.find(n=>n.key==='tracked:src/nested/a.ts');
 assert.ok(fileRow.children.findIndex(n=>n.key==='row-space'&&n.grow)>fileRow.children.indexOf(fileButton),'flexible space follows the name');
 assert.ok(nodes.some(n=>n.action==='folder'&&n.tooltip==='src/nested'));
 assert.equal(nodes.find(n=>n.action==='diff'&&n.value==='src/nested/a.ts').text,'a.ts');
 await panel.onEvent(ctx,event('folderCheck:tracked:src'));
 nodes=walk(panel.render());
 assert.equal(nodes.find(n=>n.action==='check:src/z.ts').checked,true);
 assert.equal(nodes.find(n=>n.action==='check:src/nested/a.ts').checked,true);
 assert.equal(nodes.find(n=>n.action==='check:src2/other.ts').checked,false);
 await panel.onEvent(ctx,event('folder',folder.value));
 assert.ok(!walk(panel.render()).some(n=>n.action==='diff'&&n.value==='src/z.ts'));
 await panel.onEvent(ctx,event('filter','a.ts'));
 assert.ok(walk(panel.render()).some(n=>n.action==='diff'&&n.value==='src/nested/a.ts'),'search reveals matching descendants of collapsed folders');
 panel.deactivate();
});
test('history diff settings persist, synchronize with toolbar and retain the selected preview on reload', async () => {
 const {default:history}=await load('../modules/ui/git-history/src/index.ts');
 const stored=new Map(), state=new Map(), handlers=new Map(); let previews=0, rejectSave=false;
 const ctx={moduleId:'git-history',state:{get:k=>k==='workspace.selected'?{id:'history-test'}:k==='workspace-layout.panels'?{'git-history':true}:state.get(k),set:(k,v)=>state.set(k,v),watch(){}},events:{on:(k,f)=>handlers.set(k,f)},ui:{invalidate(){}},modules:{call:async(_id,m,a)=>{
  if(m==='settings.get')return stored.get(a.key);
  if(m==='settings.set'){if(rejectSave)throw Error('save failed');stored.set(a.key,a.value);return;}
  if(m==='branches')return {local:[],remote:[]};
  if(m==='history')return {commits:[{id:'a'.repeat(40),parents:[],subject:'Example',author:'Test',date:'2026-11-11',refs:''}],tags:[],more:false};
  if(m==='commitDiff'){previews++;return {document:'preview-handle'};}
 }}};
 const event=(action,value,rowKey)=>({action,value,rowKey,inputs:{}});
 await history.activate(ctx);
 await history.onEvent(ctx,event('commit',null,'a'.repeat(40)));
 await history.onEvent(ctx,event('diffMode','unified'));
 let diff=walk(history.render()).find(n=>n.type==='diff');
 assert.equal(diff.mode,'unified');assert.equal(diff.document,'preview-handle');assert.equal(previews,1);
 assert.equal(stored.get('git-history.diffMode'),'unified');
 assert.equal(state.get('git-history.settings').sections[0].fields.find(f=>f.key==='diffMode').value,'unified');
 const edit=async(key,value)=>{handlers.get('settings.change')({module:'git-history',section:'git-history',key,value});await new Promise(setImmediate);};
 await edit('diffMode','split');await edit('wrapLines',false);await edit('filesCollapsed',false);
 diff=walk(history.render()).find(n=>n.type==='diff');
 assert.equal(diff.mode,'split');assert.equal(diff.softWrap,false);assert.equal(diff.filesCollapsed,false);
 assert.equal(walk(history.render()).find(n=>n.key==='diff-mode').value,'split');
 rejectSave=true;await history.onEvent(ctx,event('diffMode','unified'));assert.equal(walk(history.render()).find(n=>n.type==='diff').mode,'split');rejectSave=false;
 const snapshot=history.snapshot();history.deactivate();await history.activate(ctx,snapshot);
 diff=walk(history.render()).find(n=>n.type==='diff');assert.equal(diff.mode,'split');assert.equal(diff.softWrap,false);assert.equal(diff.filesCollapsed,false);assert.equal(diff.document,'preview-handle');
 history.deactivate();
});
test('Create Task uses one branch field with compact native rows and resolves local, remote and new branches', async () => {
 const {taskDialog,taskBranchChoice}=await load('../modules/ui/projects-panel/src/task-dialog.ts');
 const branches=[{ref:'refs/heads/main',name:'main',worktree:'/project'},{ref:'refs/heads/feature/login',name:'feature/login'},{ref:'refs/remotes/origin/fix',name:'origin/fix',remote:true}];
 const dialog=taskDialog({branches,query:'',selected:'',loading:false,busy:false,error:null});const nodes=walk(dialog);
 assert.equal(dialog.title,'Create Task');
 assert.equal(nodes.filter(n=>n.type==='textInput').length,1);
 assert.equal(nodes.find(n=>n.key==='tf-create').disabled,true);
 assert.equal(nodes.some(n=>n.type==='choice'),false);
 assert.deepEqual(nodes.find(n=>n.key==='task-branches').rows.map(r=>[r.label,r.badge]),[['main','in use'],['feature/login','existing'],['origin/fix','remote']]);
 const footer=nodes.find(n=>n.key==='task-footer');assert.deepEqual(footer.children.map(n=>n.key),['task-footer-space','tf-cancel','tf-create']);
 assert.deepEqual(taskBranchChoice(branches,'feature/login',''),{name:'feature/login',branch:'feature/login'});
 assert.deepEqual(taskBranchChoice(branches,'origin/fix','refs/remotes/origin/fix'),{name:'origin/fix',branch:'refs/remotes/origin/fix'});
 assert.deepEqual(taskBranchChoice(branches,'feature/new',''),{name:'feature/new',branch:'feature/new'});
 assert.throws(()=>taskBranchChoice(branches,'main',''),/already open/);
 assert.throws(()=>taskBranchChoice(branches,'  ',''),/Choose a branch/);
 const selected=walk(taskDialog({branches,query:'feature/login',selected:'feature/login',loading:false,busy:false,error:null}));
 assert.equal(selected.find(n=>n.key==='tf-create').disabled,false);
 assert.equal(selected.find(n=>n.key==='task-branches').rows.length,1);
});
test('compact change folders retain real leaf paths and stop at files or branching directories',async()=>{
 const {changeTree}=await load('../modules/ui/git-panel/src/model.ts');
 const files=['folder1/folder2/file.ts','src/pkg/a/a.ts','src/pkg/b/b.ts','mixed/direct.ts','mixed/deeper/nested/other.ts'].map(path=>({path,kind:'modified'}));
 const tree=changeTree(files);
 const compact=tree.find(n=>n.name==='folder1/folder2');assert.equal(compact.path,'folder1/folder2');assert.deepEqual(compact.paths,['folder1/folder2/file.ts']);assert.equal(compact.children[0].file,files[0]);
 const branching=tree.find(n=>n.name==='src/pkg');assert.deepEqual(branching.children.map(n=>n.name),['a','b']);
 const mixed=tree.find(n=>n.name==='mixed');assert.deepEqual(mixed.children.map(n=>n.name),['deeper/nested','direct.ts']);assert.equal(mixed.children[0].path,'mixed/deeper/nested');
});
