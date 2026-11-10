#!/usr/bin/env node
// Build, bump changed packages, rebuild catalogue consumers, and export immutable new versions.
// Preparing a release never commits or pushes either repository.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync, execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
function build() {
  const result = spawnSync(process.execPath, ['tools/build-modules.mjs'], {stdio:'inherit'});
  if (result.status !== 0) process.exit(result.status || 1);
}
build();
const source = JSON.parse(fs.readFileSync('plugins.catalogue.json','utf8'));
const published = JSON.parse(execFileSync('git',['show','HEAD:catalogue.json'],{encoding:'utf8'}));
const bumped = [];
for (const pkg of source.packages) {
  const old = published.packages.find(p => p.id === pkg.id);
  const changed = !old || pkg.modules.some(id => {
    const artifact = old.artifacts.find(a => a.id === id);
    if (!artifact) return true;
    const kind = ['services','ui'].find(k => fs.existsSync(`modules/${k}/${id}/manifest.json`));
    const manifest = JSON.parse(fs.readFileSync(`modules/${kind}/${id}/manifest.json`,'utf8'));
    const oldManifest = JSON.parse(fs.readFileSync(artifact.manifest,'utf8'));
    return JSON.stringify(manifest) !== JSON.stringify(oldManifest) || !fs.readFileSync(`build/modules/${id}.mjs`).equals(fs.readFileSync(artifact.bundle));
  });
  if (!changed) continue;
  if (old?.version === pkg.version) {
    const numbers = pkg.version.split('.').map(Number);
    if (numbers.length !== 3 || numbers.some(n => !Number.isInteger(n))) throw Error('Only stable semver versions are supported');
    numbers[2]++;
    pkg.version = numbers.join('.');
  }
  for (const id of pkg.modules) {
    const kind = ['services','ui'].find(k => fs.existsSync(`modules/${k}/${id}/manifest.json`));
    const file = `modules/${kind}/${id}/manifest.json`;
    const manifest = JSON.parse(fs.readFileSync(file,'utf8'));
    manifest.version = pkg.version;
    fs.writeFileSync(file, JSON.stringify(manifest,null,2)+'\n');
  }
  bumped.push(`${pkg.id}@${pkg.version}`);
}
fs.writeFileSync('plugins.catalogue.json',JSON.stringify(source,null,2)+'\n');
build();
const exported = spawnSync(process.execPath,['tools/export-plugins.mjs',root],{stdio:'inherit'});
if (exported.status !== 0) process.exit(exported.status || 1);
console.log(`Prepared: ${bumped.join(', ') || 'no changes'}. Review, commit, and push this repository to publish.`);
