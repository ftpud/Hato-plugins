import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';

test('export preserves committed versions and hashes new versioned artifacts', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'hato-plugin-release-'));
  try {
    const put=(name,data)=>{const p=path.join(root,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,data);};
    const catalogue={schemaVersion:1,coreVersion:'0.1.0',packages:[{id:'demo',version:'0.1.0',modules:['probe']}]};
    const manifest={id:'probe',kind:'service',entry:'index.ts',version:'0.1.0'};
    put('package.json','{"type":"module"}');
    put('tools/export-plugins.mjs',fs.readFileSync(new URL('../tools/export-plugins.mjs',import.meta.url)));
    put('plugins.catalogue.json',JSON.stringify(catalogue));
    put('modules/services/probe/manifest.json',JSON.stringify(manifest));
    put('build/modules/probe.mjs','old bundle');
    put('packages/demo/0.1.0/probe/manifest.json',JSON.stringify(manifest,null,2)+'\n');
    put('packages/demo/0.1.0/probe/dist/probe.mjs','old bundle');
    const git=(...args)=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
    git('init');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture');
    put('build/modules/probe.mjs','new bundle');
    const run=()=>spawnSync(process.execPath,['tools/export-plugins.mjs','.'],{cwd:root,encoding:'utf8'});
    const refused=run();
    assert.notEqual(refused.status,0);assert.match(refused.stderr,/Published artifact changed/);
    assert.equal(fs.readFileSync(path.join(root,'packages/demo/0.1.0/probe/dist/probe.mjs'),'utf8'),'old bundle');
    catalogue.packages[0].version='0.1.1';manifest.version='0.1.1';
    put('plugins.catalogue.json',JSON.stringify(catalogue));put('modules/services/probe/manifest.json',JSON.stringify(manifest));
    const exported=run();assert.equal(exported.status,0,exported.stderr);
    const result=JSON.parse(fs.readFileSync(path.join(root,'catalogue.json'),'utf8'));
    assert.match(result.packages[0].artifacts[0].bundleSha256,/^[a-f0-9]{64}$/);
    assert.equal(fs.readFileSync(path.join(root,'packages/demo/0.1.1/probe/dist/probe.mjs'),'utf8'),'new bundle');
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
