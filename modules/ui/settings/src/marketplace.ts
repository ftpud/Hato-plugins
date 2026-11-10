import type { ModuleContext, PluginInfo, TreeRow, UiNode } from '@hato/sdk/types';
import { sha256HexAsync } from '@hato/sdk/sha256';
import bundled from '../../../../plugins.catalogue.json';
export const REPOSITORY = 'ftpud/Hato-plugins';
export interface Package { id:string; name:string; type:string; core:boolean; author:string; description:string; version:string; coreVersion:string; dependencies:Record<string,string>; modules:string[]; artifacts?: {id:string; manifest:string; bundle:string; manifestSha256?:string; bundleSha256?:string}[] }
export function satisfies(version:string, range:string):boolean {
  const parse=(s:string)=> /^\d+\.\d+\.\d+$/.test(s) ? s.split('.').map(Number) : null;
  const v=parse(version), r=parse(range.replace(/^[\^~]/,''));
  if(!v||!r)return false;
  const cmp=v[0]-r[0]||v[1]-r[1]||v[2]-r[2];
  if(range[0]==='~')return cmp>=0&&v[0]===r[0]&&v[1]===r[1];
  if(range[0]==='^')return cmp>=0&&v[0]===r[0]&&(r[0]>0||v[1]===r[1])&&(r[0]>0||r[1]>0||v[2]===r[2]);
  return cmp===0;
}
export function plan(packages:Package[], id:string, coreVersion:string):Package[] {
  const done=new Set<string>(), visiting=new Set<string>(), result:Package[]=[];
  const visit=(key:string)=>{
    if(done.has(key))return;
    if(visiting.has(key))throw Error(`Cyclic package dependency: ${key}`);
    const p=packages.find(p=>p.id===key);if(!p)throw Error(`Missing package: ${key}`);
    if(!satisfies(coreVersion,p.coreVersion))throw Error(`${p.name} requires Hato ${p.coreVersion}`);
    visiting.add(key);
    for(const [dep,range] of Object.entries(p.dependencies)){
      const d=packages.find(x=>x.id===dep);if(!d||!satisfies(d.version,range))throw Error(`Unsatisfied dependency: ${dep} ${range}`);
      visit(dep);
    }
    visiting.delete(key);done.add(key);result.push(p);
  };visit(id);return result;
}
let packages:Package[]=bundled.packages as Package[];
let base='';
let receipts:Record<string,string>={};
let tab = 'marketplace';
let search = '';
let selection = '';
const collapsed = new Set<string>();
export function pluginBrowserSnapshot() { return { tab, search, selection, collapsed: [...collapsed] }; }
export function restorePluginBrowser(state: any) {
  tab = ['installed', 'builtin'].includes(state?.tab) ? state.tab : 'marketplace';
  search = typeof state?.search === 'string' ? state.search : '';
  selection = typeof state?.selection === 'string' ? state.selection : '';
  collapsed.clear();
  if (Array.isArray(state?.collapsed)) for (const key of state.collapsed) if (typeof key === 'string') collapsed.add(key);
}
export function pluginBrowserAction(action: string, value: string) {
  if (action === 'marketSearch') search = value;
  if (action === 'marketSelect' && !value.startsWith('type:')) selection = value;
  if (action === 'marketExpand' && value.startsWith('type:')) {
    if (collapsed.has(value)) collapsed.delete(value); else collapsed.add(value);
  }
}

export async function refreshMarket(ctx:ModuleContext){
  receipts=(await ctx.modules.call('persistence','settings.get',{key:'plugins.receipts.v1'}))||{};
  const get=async(url:string)=>{const r=await ctx.host.net.fetch({url,maxBytes:2*1024*1024});if(r.status!==200)throw Error(`Marketplace HTTP ${r.status}`);return JSON.parse(r.body);};
  const commit=await get(`https://api.github.com/repos/${REPOSITORY}/commits/main`);
  if(!/^[a-f0-9]{40}$/.test(commit.sha))throw Error('Invalid repository revision');
  const nextBase=`https://raw.githubusercontent.com/${REPOSITORY}/${commit.sha}/`;
  const cat=await get(nextBase+'catalogue.json');
  if(cat.schemaVersion!==1||!Array.isArray(cat.packages))throw Error('Unsupported catalogue');
  const ids=new Set<string>(), modules=new Set<string>();
  for(const p of cat.packages){
    if(!/^[a-z0-9][a-z0-9-]{0,47}$/.test(p.id)||ids.has(p.id)||typeof p.author!=='string'||typeof p.type!=='string'||!Array.isArray(p.modules)||!p.dependencies||!Array.isArray(p.artifacts))throw Error('Invalid package metadata');
    ids.add(p.id);
    for(const id of p.modules){if(!/^[a-z0-9][a-z0-9-]{0,47}$/.test(id)||modules.has(id))throw Error('Invalid or duplicate module');modules.add(id);}
  }
  for(const p of cat.packages)plan(cat.packages,p.id,bundled.coreVersion);
  packages=cat.packages;base=nextBase;
}
function installed(p:Package,plugins:PluginInfo[]){return p.modules.every(id=>plugins.some(m=>m.id===id));}
export function packageVersion(p: Package, plugins: PluginInfo[]) {
  const members = p.modules.map(id => plugins.find(m => m.id === id));
  if (members.some(m => !m)) return undefined;
  const versions = members.map(m => m?.metadata?.version);
  if (versions.some(v => typeof v === 'string')) return versions.every(v => v === versions[0]) ? versions[0] as string : undefined;
  return receipts[p.id] || (members.every(m => m?.source === 'builtin') ? bundled.packages.find(b => b.id === p.id)?.version : undefined);
}
function isSystem(p: PluginInfo) {
  return packages.find(pkg => pkg.modules.includes(p.id))?.core ?? p.source === 'builtin';
}
export function isNewer(target: string, current?: string) {
  if (!current) return true;
  if (!/^\d+\.\d+\.\d+$/.test(target) || !/^\d+\.\d+\.\d+$/.test(current)) return false;
  const a = target.split('.').map(Number), b = current.split('.').map(Number);
  return (a[0] - b[0] || a[1] - b[1] || a[2] - b[2]) > 0;
}
export function availableUpdates(plugins: PluginInfo[]) {
  return packages.filter(p => installed(p, plugins) && isNewer(p.version, packageVersion(p, plugins)));
}
export function marketNodes(plugins: PluginInfo[], busy: boolean, renderPlugin: (p: PluginInfo) => UiNode): UiNode[] {
  const needle = search.trim().toLowerCase();
  const items = (tab === 'marketplace'
    ? packages.filter(p => !p.modules.some(id => plugins.some(m => m.id === id))).map(p => ({ key: `package:${p.id}`, name: p.name, description: p.description, type: p.type, package: p, plugin: undefined as PluginInfo | undefined }))
    : plugins.filter(p => tab === 'builtin' ? isSystem(p) : !isSystem(p)).map(p => ({ key: `module:${p.id}`, name: p.name, description: `${p.id} ${p.description}`, type: String(p.metadata?.pluginType || packages.find(pkg => pkg.modules.includes(p.id))?.type || '') || (p.kind === 'ui' ? 'UI' : 'Services'), package: undefined as Package | undefined, plugin: p })))
    .filter(p => !needle || `${p.name} ${p.description} ${p.type}`.toLowerCase().includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name));
  const selected = items.find(p => p.key === selection) || items[0];
  if (selected) selection = selected.key;
  const rows: TreeRow[] = [];
  for (const type of [...new Set(items.map(p => p.type))].sort()) {
    const key = `type:${type}`, children = items.filter(p => p.type === type), expanded = !collapsed.has(key) || !!needle;
    rows.push({ key, label: type, depth: 0, expandable: true, expanded, selected: false, badge: String(children.length), weight: 'semibold' });
    if (expanded) rows.push(...children.map(p => ({ key: p.key, label: p.name, depth: 1, expandable: false, expanded: false, selected: selected?.key === p.key,
      badge: p.plugin ? (!p.plugin.enabled ? 'Off' : p.plugin.lastError && !p.plugin.active ? 'Failed' : '') : p.package?.version })));
  }
  const details: UiNode[] = [];
  if (selected?.plugin) {
    const pkg = packages.find(p => p.modules.includes(selected.plugin!.id));
    details.push(renderPlugin(selected.plugin));
    if (pkg) {
      const v = packageVersion(pkg, plugins);
      details.push({ type: 'label', key: 'package', text: `${pkg.name} · ${v || pkg.version} · ${pkg.type}`, color: 'muted', size: 'xs', wrap: true });
      if (isNewer(pkg.version, v)) details.push({ type: 'row', key: 'package-actions', children: [
        { type: 'button', key: 'update', text: 'Update package', action: 'plugin:marketInstall', value: pkg.id, disabled: busy, small: true },
      ] });
    }
  } else if (selected?.package) {
    const p = selected.package;
    details.push(
      { type: 'label', key: 'name', text: p.name, size: 'lg', weight: 'semibold', wrap: true },
      { type: 'label', key: 'author', text: `By ${p.author} · ${p.type} · ${p.version}`, color: 'muted', size: 'sm', wrap: true },
      { type: 'row', key: 'install-actions', children: [{ type: 'button', key: 'install', text: 'Install', action: 'plugin:marketInstall', value: p.id, disabled: busy, variant: 'primary' }] },
      { type: 'label', key: 'description', text: p.description, wrap: true },
      { type: 'label', key: 'compatibility', text: `Requires Hato ${p.coreVersion}`, size: 'xs', color: 'muted' },
      { type: 'label', key: 'dependencies', text: `Dependencies: ${Object.keys(p.dependencies).join(', ') || 'None'}`, size: 'xs', color: 'muted', wrap: true });
  } else details.push({ type: 'label', key: 'empty', text: needle ? 'No matching plugins.' : tab === 'marketplace' ? 'All catalogue plugins are already installed. Check for more plugins using Refresh.' : 'No plugins installed.', color: 'muted', wrap: true });
  return [{ type: 'tabs', key: 'plugin-tabs', height: 474, style: { gap: 12 }, tabs: [{ key: 'marketplace', label: 'Marketplace' }, { key: 'installed', label: 'Installed' }, { key: 'builtin', label: 'System' }], active: tab, action: 'plugin:marketTab', children: [{ type: 'column', key: tab, height: 430, gap: 0, style: { borderWidth: 1, borderColor: 'border', radius: 8 }, children: [
    { type: 'row', key: 'toolbar', gap: 8, padding: 12, style: { borderBottom: 1, borderColor: 'border' }, children: [
      { type: 'textInput', key: 'plugin-search', value: search, placeholder: 'Search plugins…', changeAction: 'plugin:marketSearch', grow: true },
      { type: 'button', key: 'refresh', text: 'Refresh', action: 'plugin:marketRefresh', disabled: busy, small: true },
      ...(availableUpdates(plugins).length ? [{ type: 'button', key: 'update-all', text: `Update all (${availableUpdates(plugins).length})`, action: 'plugin:marketUpdateAll', disabled: busy, small: true, variant: 'primary' } as UiNode] : []),
      ...(tab === 'installed' ? [
        { type: 'button', key: 'folder', text: 'Install from folder…', action: 'plugin:install', disabled: busy, small: true } as UiNode,
        { type: 'button', key: 'rescan', text: 'Rescan', action: 'plugin:rescan', disabled: busy, small: true } as UiNode] : []),
    ] },
    { type: 'row', key: 'browser', height: 374, gap: 0, align: 'stretch', children: [
      { type: 'column', key: 'list', width: 260, padding: 8, borderSide: 'right', children: [
        { type: 'tree', key: 'plugin-tree', rows, rowHeight: 30, indent: 12, rowGap: 0, selectAction: 'plugin:marketSelect', expandAction: 'plugin:marketExpand', grow: true },
      ] },
      { type: 'column', key: selected?.key || 'details', grow: true, scroll: true, gap: 16, padding: 20, children: details },
    ] },
  ] }] }];
}
export function marketTab(value: string) { tab = ['installed', 'builtin'].includes(value) ? value : 'marketplace'; selection = ''; }
export async function installPackage(ctx: ModuleContext, id: string, plugins: PluginInfo[]) {
  if (!base) await refreshMarket(ctx);
  return installPackages(ctx, [id], plugins);
}
export async function updateAllPackages(ctx: ModuleContext, plugins: PluginInfo[]) {
  await refreshMarket(ctx);
  const updates = availableUpdates(plugins);
  if (!updates.length) return 'All plugins are up to date';
  return installPackages(ctx, updates.map(p => p.id), plugins);
}
async function installPackages(ctx: ModuleContext, ids: string[], plugins: PluginInfo[]) {
  if (typeof ctx.host.plugins.installMany !== 'function') throw Error('This plugin update needs the new Hato host. Rebuild and restart Hato once to enable live package updates.');
  const selected = [...new Map(ids.flatMap(id => plan(packages, id, bundled.coreVersion)).map(p => [p.id, p])).values()];
  const changed = selected.filter(p => {
    if (ids.includes(p.id)) return true;
    const current = packageVersion(p, plugins);
    const requirements = selected.flatMap(dependent => dependent.dependencies[p.id] ? [dependent.dependencies[p.id]] : []);
    return !current || isNewer(p.version, current) || requirements.some(range => !satisfies(current, range));
  });
  const files: { id: string; manifest: string; code: string }[] = [];
  // Fetch the entire dependency closure from one pinned revision before asking to install.
  for (const p of changed) for (const moduleId of p.modules) {
    const a = p.artifacts?.find(a => a.id === moduleId);
    if (!a) throw Error(`Missing artifact: ${moduleId}`);
    const read = async (path: string, digest?: string) => {
      if (!/^packages\/[a-z0-9/._-]+$/.test(path) || path.split('/').includes('..')) throw Error('Unsafe artifact path');
      const r = await ctx.host.net.fetch({ url: base + path, maxBytes: 8 * 1024 * 1024 });
      if (r.status !== 200) throw Error(`Download failed: ${path}`);
      if (digest && await sha256HexAsync(r.body) !== digest) throw Error(`Integrity mismatch: ${path}`);
      return r.body;
    };
    const manifest = await read(a.manifest, a.manifestSha256), m = JSON.parse(manifest);
    if (m.id !== moduleId || m.version !== p.version || m.moduleApiVersion !== 1 || m.pluginPackage !== p.id) throw Error('Artifact metadata mismatch');
    files.push({ id: moduleId, manifest, code: await read(a.bundle, a.bundleSha256) });
  }
  const root = ctx.host.env.info().dataDir + '/marketplace-downloads/' + crypto.randomUUID();
  const grant = await ctx.host.capabilities.request({ kind: 'fs', root: ctx.host.env.info().dataDir, write: true, purpose: 'Download plugin packages' });
  try {
    await ctx.host.fs.mkdir(grant.grant, root);
    const paths: string[] = [];
    for (const f of files) {
      const dir = root + '/' + f.id;
      await ctx.host.fs.mkdir(grant.grant, dir);
      await ctx.host.fs.mkdir(grant.grant, dir + '/dist');
      await ctx.host.fs.writeAtomic(grant.grant, dir + '/manifest.json', f.manifest);
      await ctx.host.fs.writeAtomic(grant.grant, dir + '/dist/' + f.id + '.mjs', f.code);
      paths.push(dir);
    }
    await ctx.host.plugins.installMany(paths);
    for (const p of changed) receipts[p.id] = p.version;
    await ctx.modules.call('persistence', 'settings.set', { key: 'plugins.receipts.v1', value: receipts });
  } finally { await ctx.host.capabilities.release(grant.grant); }
  return `Updated ${changed.length} package${changed.length === 1 ? '' : 's'}. Enabled plugins reload live; enable new plugins in Installed.`;
}
