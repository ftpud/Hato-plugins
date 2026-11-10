// Export self-contained marketplace artifacts; never replace a committed version's bytes.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] && path.resolve(process.argv[2]);
process.chdir(root);
if (!target) throw Error('Usage: node tools/export-plugins.mjs DESTINATION');
const tracked = new Set(execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD', '--', 'packages'], {encoding:'utf8'}).trim().split('\n'));
const catalogue = JSON.parse(fs.readFileSync('plugins.catalogue.json', 'utf8'));
const files = [];
const digest = data => createHash('sha256').update(data).digest('hex');
for (const pkg of catalogue.packages) {
  pkg.artifacts = [];
  for (const id of pkg.modules) {
    const kind = ['services', 'ui'].find(k => fs.existsSync(`modules/${k}/${id}/manifest.json`));
    const manifest = JSON.parse(fs.readFileSync(`modules/${kind}/${id}/manifest.json`, 'utf8'));
    if (manifest.version !== pkg.version) throw Error(`Version mismatch: ${id}`);
    const base = `packages/${pkg.id}/${pkg.version}/${id}`;
    const manifestPath = `${base}/manifest.json`, bundlePath = `${base}/dist/${id}.mjs`;
    const manifestBytes = Buffer.from(JSON.stringify(manifest,null,2)+'\n');
    const bundleBytes = fs.readFileSync(`build/modules/${id}.mjs`);
    files.push({path:manifestPath,data:manifestBytes},{path:bundlePath,data:bundleBytes});
    pkg.artifacts.push({id,manifest:manifestPath,bundle:bundlePath,manifestSha256:digest(manifestBytes),bundleSha256:digest(bundleBytes)});
  }
}
for (const file of files) {
  if (tracked.has(file.path)) {
    const prior = execFileSync('git',['show',`HEAD:${file.path}`],{maxBuffer:16*1024*1024});
    if (!prior.equals(file.data)) throw Error(`Published artifact changed: ${file.path}. Run npm run release:prepare to bump its package.`);
  }
}
for (const file of files) {
  const destination = path.join(target,file.path);
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  fs.writeFileSync(destination,file.data);
}
fs.writeFileSync(path.join(target,'catalogue.json'),JSON.stringify(catalogue,null,2)+'\n');
