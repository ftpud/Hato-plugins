import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root=new URL('../',import.meta.url);
const catalogue=JSON.parse(fs.readFileSync(new URL('plugins.catalogue.json',root),'utf8'));
const manifests=new Map();
for(const kind of ['services','ui'])for(const id of fs.readdirSync(new URL(`modules/${kind}/`,root))){
 const file=new URL(`modules/${kind}/${id}/manifest.json`,root);
 if(fs.existsSync(file))manifests.set(id,JSON.parse(fs.readFileSync(file,'utf8')));
}
test('every module has one feature plugin owner and matching manifest metadata',()=>{
 const owners=new Map();
 for(const pkg of catalogue.packages)for(const id of pkg.modules){
  assert.ok(!owners.has(id),`duplicate module ${id}`);owners.set(id,pkg.id);
  const m=manifests.get(id);assert.ok(m,`missing ${id}`);
  assert.equal(m.pluginPackage,pkg.id);assert.equal(m.pluginType,pkg.type);
 }
 assert.deepEqual([...owners.keys()].sort(),[...manifests.keys()].sort());
});
test('provider and workflow packages contain complete feature modules',()=>{
 const pkg=id=>catalogue.packages.find(p=>p.id===id);
 assert.deepEqual(pkg('codex-acp').modules,['codex-provider','codex-usage']);
 assert.deepEqual(pkg('claude-acp').modules,['claude-provider','claude-usage']);
 assert.deepEqual(pkg('automation').modules,['workflows','workflow-runner','workflows-panel']);
 assert.ok(pkg('automation').dependencies.agents);
 assert.ok(pkg('agents').modules.includes('agent-runner'));
 assert.ok(pkg('agents').modules.includes('persistent-agents'));
});
test('fresh system dependency closure excludes optional features and satisfies module dependencies',()=>{
 const selected=new Set();
 const include=id=>{if(selected.has(id))return;const p=catalogue.packages.find(p=>p.id===id);assert.ok(p);selected.add(id);Object.keys(p.dependencies).forEach(include);};
 catalogue.packages.filter(p=>p.core).forEach(p=>include(p.id));
 for(const id of ['codex-acp','claude-acp','copilot-acp','automation','agents','remote'])assert.ok(!selected.has(id));
 const modules=new Set(catalogue.packages.filter(p=>selected.has(p.id)).flatMap(p=>p.modules));
 for(const id of modules)for(const dependency of manifests.get(id).dependencies || [])assert.ok(modules.has(dependency),`${id} needs optional module ${dependency}`);
});

test('language packages are marketplace-only, absent from system bootstrap and never preapproved',()=>{
 const grants=JSON.parse(fs.readFileSync(new URL('../../grants/first-party.json',import.meta.url),'utf8'));
 for(const id of ['language-service','language-java','language-typescript','language-sap']){
  const pkg=catalogue.packages.find(p=>p.id===id);
  assert.equal(pkg.core,false);
  assert.equal(pkg.type,'Languages');
  assert.equal(manifests.get(id).distribution,'marketplace');
  assert.equal(grants.modules[id],undefined);
 }
});
