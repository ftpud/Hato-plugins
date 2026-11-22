// ../sdk/runtime.ts
var grantCache = /* @__PURE__ */ new Map();
var sshCache = /* @__PURE__ */ new Map();
function sshProfileSpec(ssh) {
  return { profileId: ssh.profileId, host: ssh.host, port: ssh.port, user: ssh.user, identityFile: ssh.identityFile ?? null, transport: ssh.transport ?? "ssh", ...ssh.auth ? { auth: ssh.auth } : {} };
}
function sshConnect(ctx, desc) {
  if (desc.location !== "ssh" || !desc.ssh) throw new Error("not an SSH workspace");
  const key = desc.machineId;
  let p = sshCache.get(key);
  if (!p) {
    p = ctx.host.ssh.connect(sshProfileSpec(desc.ssh));
    sshCache.set(key, p);
    p.catch(() => sshCache.delete(key));
  }
  return p;
}
function forgetSsh(machineId) {
  sshCache.delete(machineId);
  for (const k of Array.from(grantCache.keys())) if (k.includes("|" + machineId + "|")) grantCache.delete(k);
}
async function targetFor(ctx, desc) {
  if (desc.location === "local") return { kind: "local" };
  const c = await sshConnect(ctx, desc);
  return { kind: "ssh", connection: c.connection, machineId: c.machineId };
}
async function workspaceGrant(ctx, desc, kind, root) {
  const r = root || desc.rootAbsolutePath;
  const key = kind + "|" + desc.machineId + "|" + r;
  let p = grantCache.get(key);
  if (!p) {
    p = (async () => {
      const target = await targetFor(ctx, desc);
      return ctx.host.capabilities.request({ kind, root: r, target });
    })();
    grantCache.set(key, p);
    p.catch(() => grantCache.delete(key));
  }
  try {
    return await p;
  } catch (e) {
    if (e && (e.code === "ENOTCONN" || e.code === "EBADF")) forgetSsh(desc.machineId);
    throw e;
  }
}
function errMsg(e) {
  return e && (e.message || String(e)) || "unknown error";
}

// ../sdk/languages.ts
function languageDefinitions(plugins) {
  const result = [];
  for (const plugin of [...plugins].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!plugin.enabled || !plugin.active) continue;
    const contributions = plugin.contributes?.languages;
    if (!Array.isArray(contributions)) continue;
    for (const lang of contributions) {
      if (!lang || typeof lang.id !== "string" || typeof lang.grammar !== "string" || typeof lang.name !== "string") continue;
      const extensions = Array.isArray(lang.extensions) ? lang.extensions.filter((v) => typeof v === "string" && v.length) : [];
      const filenames = Array.isArray(lang.filenames) ? lang.filenames.filter((v) => typeof v === "string" && v.length) : [];
      if (!extensions.length && !filenames.length) continue;
      const server = lang.server;
      const validServer = server && typeof server.id === "string" && typeof server.executable === "string" && Array.isArray(server.args) && server.args.every((v) => typeof v === "string") && typeof server.installHint === "string";
      result.push({ ...lang, extensions, filenames, server: validServer ? server : void 0, pluginId: plugin.id });
    }
  }
  return result;
}
function languageForPath(languages2, path) {
  const name = path.replace(/\\/g, "/").split("/").pop().toLowerCase();
  return languages2.find((l) => l.filenames?.some((n) => n.toLowerCase() === name)) || languages2.find((l) => l.extensions?.some((ext) => name.endsWith("." + ext.toLowerCase()))) || null;
}
function relativeFile(path) {
  if (!path || /^[\\/]|^[a-z]:/i.test(path) || path.includes("\0")) throw new Error("Expected a workspace-relative file");
  const parts = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (part === "..") {
      if (!parts.length) throw new Error("File escapes the workspace");
      parts.pop();
    } else if (part && part !== ".") parts.push(part);
  }
  if (!parts.length) throw new Error("Expected a file");
  return parts.join("/");
}
function fileUri(path) {
  const normalized = path.replace(/\\/g, "/");
  if (!normalized.startsWith("/") && !/^[a-z]:\//i.test(normalized)) throw new Error("Expected an absolute path");
  const absolute = normalized.startsWith("/") ? normalized : "/" + normalized;
  return "file://" + absolute.split("/").map((s, i) => i === 1 && /^[a-z]:$/i.test(s) ? s : encodeURIComponent(s)).join("/");
}
function documentUri(root, path) {
  return fileUri(root.replace(/[\\/]+$/, "") + "/" + relativeFile(path));
}
function workspacePath(root, uri) {
  const match = /^file:\/\/(?:localhost)?(\/[^?#]*)$/i.exec(uri);
  if (!match) return null;
  let path;
  try {
    path = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  const base = root.replace(/\\/g, "/").replace(/\/+$/, "");
  if (/^[a-z]:\//i.test(base) && /^\/[a-z]:\//i.test(path)) path = path.slice(1);
  if (!path.startsWith(base + "/")) return null;
  try {
    return relativeFile(path.slice(base.length + 1));
  } catch {
    return null;
  }
}
function definitionLinks(value) {
  return (Array.isArray(value) ? value : value ? [value] : []).flatMap((item) => {
    const targetUri = item?.targetUri ?? item?.uri;
    const targetRange = item?.targetRange ?? item?.range;
    const selection = item?.targetSelectionRange ?? targetRange;
    if (typeof targetUri !== "string" || !validRange(targetRange) || !validRange(selection)) return [];
    return [{
      targetUri,
      targetRange,
      targetSelectionRange: selection,
      ...validRange(item.originSelectionRange) ? { originSelectionRange: item.originSelectionRange } : {}
    }];
  });
}
function validPosition(p) {
  return p && Number.isInteger(p.line) && p.line >= 0 && Number.isInteger(p.character) && p.character >= 0;
}
function validRange(r) {
  return r && validPosition(r.start) && validPosition(r.end);
}

// ../sdk/scoped-settings.ts
function scopesFor(ws) {
  return ws ? [`workspace:${ws.id}`, `machine:${ws.machineId}`, "user"] : ["user"];
}
function get(ctx, key, ws) {
  return ctx.modules.call("persistence", "scoped.resolve", { key, scopes: scopesFor(ws) });
}
function set(ctx, scope, key, value, expectedRev) {
  return ctx.modules.call("persistence", "scoped.set", { scope, key, value, ...expectedRev === void 0 ? {} : { expectedRev } });
}

// modules/services/language-service/src/server-data.ts
var SCRIPT = `import os,pathlib,hashlib,json,sys
key=os.path.realpath(sys.argv[1])+'|'+sys.argv[2]+'|'+sys.argv[3]
base=pathlib.Path(os.environ.get('HATO_LANGUAGE_SERVER_DATA_HOME') or str(pathlib.Path.home()/'.local/share/hato/language-tools/workspaces'))
root=base/sys.argv[2]/hashlib.sha256(key.encode()).hexdigest()[:24]
root.mkdir(parents=True,exist_ok=True,mode=0o700)
print(json.dumps(str(root)))`;
async function serverData(ctx, d, serverId, grant) {
  const generation = await get(ctx, `language-server.${serverId}.index`, d);
  const result = await ctx.host.process.run(grant, { target: await targetFor(ctx, d), executable: "python3", args: ["-c", SCRIPT, d.rootAbsolutePath, serverId, String(generation?.value || "1")], cwd: d.rootAbsolutePath, loginShell: d.location === "ssh" }, { timeoutMs: 3e4 });
  if (result.code !== 0) throw new Error(`Cannot create language-server data directory on ${d.machineId}: ${result.stderr}`);
  const path = JSON.parse(result.stdout.trim().split(/\r?\n/).pop());
  if (typeof path !== "string" || !path.startsWith("/") || /[\r\n\0]/.test(path)) throw new Error("Invalid server data directory");
  return path;
}

// ../sdk/mcp.ts
function exportMcpTools(ctx, title, tools) {
  let pending = 0;
  const publish = () => ctx.state.set(`${ctx.moduleId}.mcp`, {
    title,
    generation: ctx.generation,
    tools: tools.map(({ handler: _handler, ...definition }) => definition)
  });
  ctx.events.on("internal-mcp.call", async (request) => {
    if (request?.module !== ctx.moduleId || request.generation !== ctx.generation || typeof request.id !== "string") return;
    const tool = tools.find((tool2) => tool2.name === request.tool);
    pending++;
    try {
      if (!tool) throw new Error("Unknown module MCP command");
      const scope = request.scope;
      if (!scope || typeof scope.workspaceId !== "string" || typeof scope.conversationId !== "string" || typeof scope.machineId !== "string") throw new Error("Missing authenticated MCP scope");
      const result = await tool.handler(request.args || {}, scope);
      ctx.events.emit(`${ctx.moduleId}.mcp.result`, { id: request.id, generation: ctx.generation, result: result === void 0 ? null : result });
    } catch (e) {
      ctx.events.emit(`${ctx.moduleId}.mcp.result`, { id: request.id, generation: ctx.generation, error: errMsg(e) });
    } finally {
      pending--;
    }
  });
  publish();
  return { publish, pending: () => pending };
}

// modules/services/language-service/src/project.ts
function projectConfiguration(server, input) {
  const values = {};
  for (const field of server.projectSettings?.fields || []) {
    const value = input?.values?.[field.key];
    if (field.type === "toggle") {
      if (value !== void 0 && typeof value !== "boolean") throw new Error(`Invalid ${field.label}`);
      values[field.key] = value ?? true;
    } else if (value !== void 0) {
      const paths2 = field.type === "paths" ? (Array.isArray(value) ? value : String(value).split(/\r?\n/)).filter((p) => typeof p !== "string" || p.trim()) : [String(value)];
      if (paths2.length > 256) throw new Error(`Too many ${field.label}`);
      for (const path of paths2) if (typeof path !== "string" || /[\0\r\n]/.test(path) || /^[\\/]|^[a-z]:/i.test(path) || path.replace(/\\/g, "/").split("/").includes("..")) throw new Error(`${field.label} must stay inside the workspace`);
      values[field.key] = field.type === "paths" ? paths2.map((p) => p.trim()) : paths2[0].trim();
    }
  }
  const settings = input?.settings ?? {};
  if (!settings || typeof settings !== "object" || Array.isArray(settings) || JSON.stringify(settings).length > 64e3) throw new Error("Additional settings must be a JSON object under 64 KB");
  return { enabled: input?.enabled === true, values, settings };
}
function merge(base, extra) {
  const result = { ...base };
  for (const [key, value] of Object.entries(extra || {})) {
    if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error("Invalid settings key");
    result[key] = value && typeof value === "object" && !Array.isArray(value) ? merge(base?.[key], value) : value;
  }
  return result;
}
function projectServer(server, config, root) {
  let settings = merge(server.settings || {}, config.settings);
  for (const field of server.projectSettings?.fields || []) {
    const value = config.values[field.key];
    if (value === void 0 || value === "" || Array.isArray(value) && !value.length) continue;
    const keys = field.setting.split(".");
    const absolute = (p) => root ? `${root.replace(/\/+$/, "")}/${p.replace(/^\.\//, "")}` : p;
    let nested = field.absolute && typeof value === "string" ? absolute(value) : field.absolute && Array.isArray(value) ? value.map(absolute) : value;
    for (const key of keys.reverse()) nested = { [key]: nested };
    settings = merge(settings, nested);
  }
  return { ...server, settings, initializationOptions: server.projectSettings?.initializationSettings ? { ...server.initializationOptions, settings } : server.initializationOptions };
}
function documentSymbols(result, uri) {
  const symbols = [];
  function visit(items, parent = "", depth = 0) {
    if (depth > 20 || symbols.length >= 2e3) return;
    for (const item of items || []) {
      const range = item.selectionRange || item.location?.range || item.range;
      if (typeof item.name !== "string" || !range?.start || item.location?.uri && item.location.uri !== uri) continue;
      symbols.push({ name: item.name, detail: item.detail || "", kind: item.kind, container: item.containerName || parent, range });
      if (Array.isArray(item.children)) visit(item.children, parent ? `${parent}.${item.name}` : item.name, depth + 1);
      if (symbols.length >= 2e3) break;
    }
  }
  visit(Array.isArray(result) ? result : []);
  return symbols;
}

// modules/services/language-service/src/dependency-script.ts
var DEPENDENCY_SCRIPT = String.raw`
import hashlib, json, os, pathlib, platform, re, shlex, shutil, subprocess, sys, tarfile, tempfile, urllib.request, uuid, zipfile
MARKER = '__HATO_DEPENDENCIES__='

def command(args, env=None, timeout=20):
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, text=True, timeout=timeout)
    return result.returncode, (result.stdout + '\n' + result.stderr).strip()

def executable(value):
    if not value or '\x00' in value: return None
    found = shutil.which(value)
    return os.path.abspath(found) if found else None

def runtime(path, kind, minimum):
    if not path or not os.path.isfile(path): return None
    try:
        code, output = command([path, '-version' if kind == 'java' else '--version'])
        match = re.search(r'(?:version\s+"(?:1\.)?|^v)(\d+)', output)
        if code == 0 and match and int(match.group(1)) >= minimum:
            return {'path': path, 'version': output.splitlines()[0]}
    except (OSError, subprocess.TimeoutExpired): pass
    return None

def java_home(path):
    return str(pathlib.Path(path).resolve().parent.parent)

def java_candidates(root, minimum):
    candidates = [os.path.join(os.environ.get('JAVA_HOME', ''), 'bin/java') if os.environ.get('JAVA_HOME') else None,
                  executable('java'), str(root / ('java-' + str(minimum)) / 'bin/java'), str(root / ('java-' + str(minimum)) / 'Contents/Home/bin/java'), str(root / 'java/bin/java'), str(root / 'java/Contents/Home/bin/java')]
    if sys.platform == 'darwin':
        candidates += ['/opt/homebrew/opt/openjdk/bin/java', '/usr/local/opt/openjdk/bin/java']
        try:
            code, output = command(['/usr/libexec/java_home', '-v', str(minimum) + '+'])
            if code == 0: candidates.append(output.splitlines()[0] + '/bin/java')
        except (OSError, subprocess.TimeoutExpired): pass
    candidates += [str(p) for p in pathlib.Path('/usr/lib/jvm').glob('*/bin/java')]
    return [r for p in dict.fromkeys(candidates) if (r := runtime(p, 'java', minimum))]

def read_metadata(root, server):
    try: return json.loads((root / (server + '.json')).read_text())
    except (OSError, ValueError): return {}

def required_java(recipe, root, server_root=None):
    # The Python launcher and upstream README can lag behind the actual core bundle.
    minimum = recipe['javaMajor']
    plugins = pathlib.Path(server_root or root / ('jdtls-' + recipe['version'])) / 'plugins'
    for jar in plugins.glob('org.eclipse.jdt.core_*.jar'):
        with zipfile.ZipFile(jar) as archive:
            manifest = archive.read('META-INF/MANIFEST.MF').decode('utf-8')
        manifest = re.sub(r'\r?\n ', '', manifest)
        environments = re.findall(r'JavaSE-(\d+)', manifest)
        if environments: minimum = max(minimum, *map(int, environments))
    return minimum

def inspect(request, root):
    recipe, server = request['setup'], request['server']
    wrapper = str(root / 'bin' / server)
    # Managed tools remain usable even after a workspace moves or its preference was cleared.
    path = executable(request['executable'])
    metadata = read_metadata(root, server) if path == wrapper else {}
    python = metadata.get('python') or sys.executable
    components = [{'label': 'Python 3', 'found': os.path.isfile(python), 'version': platform.python_version(), 'path': python}]
    if recipe['kind'] == 'jdtls':
        effective = metadata.get('runtime') or (os.path.join(os.environ['JAVA_HOME'], 'bin/java') if os.environ.get('JAVA_HOME') else executable('java'))
        minimum = required_java(recipe, root, metadata.get('serverRoot'))
        jdk = runtime(effective, 'java', minimum)
        components.append({'label': 'JDK ' + str(minimum) + '+ (language server)', 'found': bool(jdk), **(jdk or {})})
    else:
        node = runtime(metadata.get('runtime') or executable('node'), 'node', 20)
        npm = metadata.get('npm') or executable('npm')
        components += [{'label': 'Node.js 20+', 'found': bool(node), **(node or {})}, {'label': 'npm', 'found': bool(npm and os.path.isfile(npm)), 'path': npm}]
    components.append({'label': server, 'found': bool(path), 'path': path})
    return {'ready': all(c['found'] for c in components), 'executable': path, 'components': components,
            'supported': platform.system() in ('Darwin', 'Linux'), 'directory': str(root)}

def fetch(url, limit=4 * 1024 * 1024):
    if not url.startswith('https://'): raise ValueError('Dependency downloads require HTTPS')
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Hato-language-setup'}), timeout=45) as response:
        if not response.geturl().startswith('https://'): raise ValueError('Insecure download redirect')
        data = response.read(limit + 1)
        if len(data) > limit: raise ValueError('Download metadata is too large')
        return data

def download(url, destination, digest):
    if not re.fullmatch('[a-fA-F0-9]{64}', digest): raise ValueError('Invalid dependency checksum')
    if not url.startswith('https://'): raise ValueError('Dependency downloads require HTTPS')
    h, size = hashlib.sha256(), 0
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Hato-language-setup'}), timeout=60) as response, open(destination, 'wb') as out:
        if not response.geturl().startswith('https://'): raise ValueError('Insecure download redirect')
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk: break
            size += len(chunk)
            if size > 600 * 1024 * 1024: raise ValueError('Dependency archive exceeds 600 MiB')
            h.update(chunk); out.write(chunk)
    if h.hexdigest().lower() != digest.lower(): raise ValueError('Dependency checksum mismatch')

def extract(archive, destination):
    destination.mkdir()
    root = destination.resolve()
    with tarfile.open(archive, 'r:gz') as tar:
        members = tar.getmembers()
        if len(members) > 50000 or sum(m.size for m in members) > 2 * 1024**3: raise ValueError('Dependency archive is too large')
        for member in members:
            if not (member.isfile() or member.isdir() or member.issym() or member.islnk()): raise ValueError('Unsupported archive entry')
            if os.path.isabs(member.name): raise ValueError('Absolute archive path')
            path = root / member.name
            target = path.resolve()
            if target != root and root not in target.parents: raise ValueError('Archive path escapes destination')
            if member.issym() or member.islnk():
                if os.path.isabs(member.linkname): raise ValueError('Absolute archive link')
                link = ((path.parent.resolve() if member.issym() else root) / member.linkname).resolve()
                if link != root and root not in link.parents: raise ValueError('Archive link escapes destination')
            # Create validated symlinks directly: Python data-filter versions differ in
            # resolving relative links through already-created archive symlinks.
            if member.issym():
                path.parent.mkdir(parents=True, exist_ok=True)
                if os.path.lexists(path): path.unlink()
                os.symlink(member.linkname, path)
                continue
            # Recheck after prior symlinks were created; retain the data filter for other entries.
            if hasattr(tarfile, 'data_filter'): tar.extract(member, destination, filter='data')
            else: tar.extract(member, destination)

def install_archive(root, name, url, digest, flatten):
    with tempfile.TemporaryDirectory(prefix='.download-', dir=root) as temporary:
        temp = pathlib.Path(temporary)
        archive = temp / 'archive.tar.gz'
        download(url, archive, digest)
        payload = temp / 'payload'
        extract(archive, payload)
        children = list(payload.iterdir())
        source = children[0] if flatten and len(children) == 1 and children[0].is_dir() else payload
        destination = root / name
        backup = root / ('.previous-' + uuid.uuid4().hex)
        existed = destination.exists()
        if existed: destination.rename(backup)
        try: source.rename(destination)
        except Exception:
            if existed: backup.rename(destination)
            raise
        if existed: shutil.rmtree(backup)
        return destination

def machine():
    system = {'Darwin': 'mac', 'Linux': 'linux'}.get(platform.system())
    arch = {'arm64': 'aarch64', 'aarch64': 'aarch64', 'x86_64': 'x64', 'AMD64': 'x64'}.get(platform.machine())
    if not system or not arch: raise ValueError('Automatic installation supports macOS/Linux on x64 and arm64; install manually on this platform')
    if system == 'linux' and platform.libc_ver()[0] != 'glibc': raise ValueError('Automatic runtime downloads require glibc Linux; configure an installed runtime on this machine')
    return system, arch

def install_java(root, major):
    existing = java_candidates(root, major)
    if existing: return existing[0]['path']
    system, arch = machine()
    url = 'https://api.adoptium.net/v3/assets/latest/' + str(major) + '/hotspot?architecture=' + arch + '&image_type=jdk&os=' + system + '&vendor=eclipse'
    assets = json.loads(fetch(url))
    package = assets[0]['binary']['package']
    destination = install_archive(root, 'java-' + str(major), package['link'], package['checksum'], True)
    candidates = [destination / 'bin/java', destination / 'Contents/Home/bin/java']
    for candidate in candidates:
        if runtime(str(candidate), 'java', major): return str(candidate)
    raise ValueError('Downloaded JDK did not pass its version check')

def install_node(root, major):
    node = runtime(executable('node'), 'node', 20)
    npm = executable('npm')
    if node and npm: return node['path'], npm
    for binary in [root / 'node/bin/node']:
        if runtime(str(binary), 'node', 20) and (root / 'node/lib/node_modules/npm/bin/npm-cli.js').is_file():
            return str(binary), str(root / 'node/lib/node_modules/npm/bin/npm-cli.js')
    system, arch = machine()
    suffix = ('darwin' if system == 'mac' else system) + '-' + ('arm64' if arch == 'aarch64' else arch) + '.tar.gz'
    base = 'https://nodejs.org/download/release/latest-v' + str(major) + '.x/'
    sums = fetch(base + 'SHASUMS256.txt').decode().splitlines()
    matches = [(line.split()[1], line.split()[0]) for line in sums if len(line.split()) == 2 and line.split()[1].endswith('-' + suffix)]
    if len(matches) != 1: raise ValueError('No matching Node.js archive')
    filename, checksum = matches[0]
    destination = install_archive(root, 'node', base + filename, checksum, True)
    node, npm = str(destination / 'bin/node'), str(destination / 'lib/node_modules/npm/bin/npm-cli.js')
    if not runtime(node, 'node', 20) or not os.path.isfile(npm): raise ValueError('Downloaded Node.js did not pass its version check')
    return node, npm

def atomic_text(path, text, mode=0o600):
    temporary = path.with_name('.' + path.name + '-' + uuid.uuid4().hex)
    temporary.write_text(text)
    temporary.chmod(mode)
    temporary.replace(path)

def acquire_lock(lock):
    for attempt in range(2):
        try:
            descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            os.write(descriptor, str(os.getpid()).encode()); os.close(descriptor)
            return
        except FileExistsError:
            try:
                owner = lock.read_text()
                pid = int(owner)
                if pid <= 0: raise ValueError('Invalid lock owner')
                os.kill(pid, 0)
            except ProcessLookupError:
                # A timed-out helper must not prevent the next install forever.
                if lock.read_text() == owner: lock.unlink()
                continue
            except FileNotFoundError: continue
            except (ValueError, PermissionError): pass
            break
    raise ValueError('Another language dependency installation is running; wait for it to finish')

def install(request, root):
    recipe, server = request['setup'], request['server']
    machine()
    root.mkdir(parents=True, exist_ok=True)
    lock = root / '.install.lock'
    acquire_lock(lock)
    try:
        if recipe['kind'] == 'jdtls':
            destination = root / ('jdtls-' + recipe['version'])
            if not (destination / 'bin/jdtls').is_file():
                destination = install_archive(root, destination.name, recipe['url'], recipe['sha256'], False)
            java = install_java(root, required_java(recipe, root, destination))
            launcher = destination / 'bin/jdtls'
            if not launcher.is_file(): raise ValueError('JDTLS archive is missing its launcher')
            # Use this Python and chosen JDK regardless of the GUI/login shell's older JAVA_HOME.
            body = '#!/bin/sh\nexport JAVA_HOME=' + shlex.quote(java_home(java)) + '\nexec ' + shlex.quote(sys.executable) + ' ' + shlex.quote(str(launcher)) + ' "$@"\n'
            metadata = {'runtime': str(pathlib.Path(java).resolve()), 'python': sys.executable, 'serverRoot': str(destination)}
        else:
            node, npm = install_node(root, recipe['nodeMajor'])
            prefix = root / 'typescript'
            env = dict(os.environ, PATH=str(pathlib.Path(node).parent) + os.pathsep + os.environ.get('PATH', ''))
            args = [node, npm, 'install', '--prefix', str(prefix), '--no-audit', '--no-fund', '--ignore-scripts'] + recipe['packages']
            code, output = command(args, env=env, timeout=600)
            if code: raise ValueError('npm install failed: ' + output[-2000:])
            launcher = prefix / 'node_modules/typescript-language-server/lib/cli.mjs'
            if not launcher.is_file(): raise ValueError('TypeScript language server launcher is missing')
            body = '#!/bin/sh\nexport PATH=' + shlex.quote(str(pathlib.Path(node).parent)) + ':"$PATH"\nexec ' + shlex.quote(node) + ' ' + shlex.quote(str(launcher)) + ' "$@"\n'
            metadata = {'runtime': node, 'npm': npm}
        (root / 'bin').mkdir(exist_ok=True)
        atomic_text(root / (server + '.json'), json.dumps(metadata))
        wrapper = root / 'bin' / server
        atomic_text(wrapper, body, 0o755)
        return inspect(dict(request, executable=str(wrapper)), root)
    finally: lock.unlink(missing_ok=True)

def main(request):
    if not re.fullmatch('[a-z0-9][a-z0-9-]{0,79}', request['server']): raise ValueError('Invalid server id')
    if request['setup']['kind'] not in ('jdtls', 'npm'): raise ValueError('Unknown dependency installer')
    root = pathlib.Path(request.get('root') or os.environ.get('HATO_LANGUAGE_TOOLS_HOME') or os.path.expanduser('~/.local/share/hato/language-tools'))
    if request['action'] == 'check': return inspect(request, root)
    if request['action'] == 'install':
        current = inspect(request, root)
        return current if current['ready'] else install(request, root)
    raise ValueError('Unknown dependency action')

if __name__ == '__main__':
    try: print(MARKER + json.dumps(main(json.loads(sys.argv[1]))))
    except Exception as error:
        print(MARKER + json.dumps({'error': str(error)})); sys.exit(1)
`;

// modules/services/language-service/src/dependencies.ts
var LanguageDependencies = class {
  constructor(ctx, servers2, selected2, publish, configured) {
    this.ctx = ctx;
    this.servers = servers2;
    this.selected = selected2;
    this.publish = publish;
    this.configured = configured;
    this.statuses = /* @__PURE__ */ new Map();
  }
  get busy() {
    return [...this.statuses.values()].some((status) => status.busy);
  }
  invalidate(serverId, workspaceId) {
    for (const [key, status] of this.statuses) if (!status.busy && (!serverId || key === `${workspaceId}|${serverId}`)) this.statuses.delete(key);
  }
  fields(server) {
    if (!server.dependencySetup) return [];
    const workspace = this.selected();
    const status = this.statuses.get(`${workspace?.id}|${server.id}`);
    const target = workspace ? `${workspace.name || workspace.id} (${workspace.machineId})` : "a selected workspace";
    const disabled = !workspace || !!status?.busy;
    return [
      {
        type: "action",
        key: "checkDependencies",
        label: "Dependencies",
        buttonLabel: status?.busy ? "Working…" : "Check dependencies",
        disabled,
        description: status?.message || (workspace ? `Check the language server and runtimes on ${target}.` : "Select a workspace to check its dependencies.")
      },
      {
        type: "action",
        key: "installDependencies",
        label: "Dependency installation",
        buttonLabel: "Install missing dependencies",
        disabled: disabled || status?.ready === true || status?.supported === false,
        description: `Install missing tools for your user on ${target}, configure this workspace, then check again. Downloads go under ~/.local/share/hato/language-tools; no administrator access is needed. Requires Python 3.8+; automatic runtime downloads support macOS and glibc Linux (x64/arm64).`
      }
    ];
  }
  async action(serverId, key, workspaceId) {
    const server = this.servers().find((server2) => server2.id === serverId);
    if (!server?.dependencySetup || !["checkDependencies", "installDependencies"].includes(key)) throw new Error("Unknown dependency action");
    const id = workspaceId || this.selected()?.id;
    if (!id) throw new Error("Select a workspace first");
    const workspace = await this.ctx.modules.call("workspace", "resolve", { workspaceId: id });
    const statusKey = `${workspace.id}|${server.id}`;
    if (this.statuses.get(statusKey)?.busy) throw new Error("A dependency operation is already running for this workspace");
    const install = key === "installDependencies";
    this.statuses.set(statusKey, { busy: true, message: `${install ? "Installing missing dependencies" : "Checking dependencies"} on ${workspace.machineId}…` });
    this.publish();
    try {
      const setting = await get(this.ctx, `language-server.${server.id}.executable`, workspace);
      const executable = typeof setting?.value === "string" && setting.value.trim() ? setting.value.trim() : server.executable;
      const result = await this.run(workspace, { action: install ? "install" : "check", server: server.id, setup: server.dependencySetup, executable }, install);
      if (install) {
        if (!result.ready || !result.executable) throw new Error("Installation finished but some dependencies are still missing");
        await set(this.ctx, `workspace:${workspace.id}`, `language-server.${server.id}.executable`, result.executable);
        await this.configured(workspace, server, result.executable);
      }
      const details = result.components.map((c) => `${c.label}: ${c.found ? c.version || "found" : "missing"}`).join(" · ");
      this.statuses.set(statusKey, {
        busy: false,
        ready: result.ready,
        supported: result.supported,
        message: `${result.ready ? "Ready" : "Missing dependencies"} on ${workspace.machineId}. ${details}${!result.supported ? ". Automatic installation is unavailable on this platform; configure installed tools manually." : ""}`
      });
      return result;
    } catch (error) {
      this.statuses.set(statusKey, { busy: false, message: `${workspace.machineId}: ${errMsg(error)}` });
      throw error;
    } finally {
      this.publish();
    }
  }
  async run(workspace, request, install) {
    const scope = await workspaceGrant(this.ctx, workspace, "process");
    const target = await targetFor(this.ctx, workspace);
    let diagnostic = "";
    for (const python of ["python3", "python"]) {
      let result;
      try {
        result = await this.ctx.host.process.run(
          scope.grant,
          {
            target,
            executable: python,
            args: ["-c", DEPENDENCY_SCRIPT, JSON.stringify(request)],
            cwd: workspace.rootAbsolutePath,
            loginShell: workspace.location === "ssh"
          },
          { timeoutMs: install ? 15 * 60 * 1e3 : 6e4, limitBytes: 65536 }
        );
      } catch (error) {
        if (["ENOENT", "ENOTFOUND", "ENOEXEC"].includes(error?.code)) {
          diagnostic = errMsg(error);
          continue;
        }
        throw error;
      }
      const line = result.stdout.split(/\r?\n/).filter((line2) => line2.startsWith("__HATO_DEPENDENCIES__=")).pop();
      if (!line) {
        diagnostic = (result.stderr || result.stdout).trim().slice(-800);
        if (result.code === 127 || /SyntaxError|not found|not recognized/i.test(diagnostic)) continue;
        throw new Error(`Dependency helper failed (${result.code}): ${diagnostic}`);
      }
      const parsed = JSON.parse(line.slice("__HATO_DEPENDENCIES__=".length));
      if (parsed.error) throw new Error(String(parsed.error));
      if (result.code !== 0 || typeof parsed.ready !== "boolean" || !Array.isArray(parsed.components)) throw new Error("Invalid dependency check result");
      return parsed;
    }
    throw new Error(`Python 3.8+ is required on ${workspace.machineId} to check/install dependencies. ${diagnostic}`);
  }
};

// ../sdk/lsp.ts
var encoder = new TextEncoder();
var decoder = new TextDecoder();
function lspFrame(message) {
  const body = JSON.stringify(message);
  return `Content-Length: ${encoder.encode(body).length}\r
\r
${body}`;
}
function decodeBase64(text) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const result = [];
  let bits = 0, value = 0;
  for (const c of text.replace(/=+$/, "")) {
    const n = alphabet.indexOf(c);
    if (n < 0) throw new Error("Invalid base64 stream");
    value = value << 6 | n;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      result.push(value >> bits & 255);
    }
  }
  return new Uint8Array(result);
}
var LspPeer = class {
  constructor(send) {
    this.send = send;
    this.buffer = new Uint8Array(0);
    this.nextId = 1;
    this.pending = /* @__PURE__ */ new Map();
    this.writes = Promise.resolve();
    this.closed = null;
    this.onRequest = async (method) => {
      throw Object.assign(new Error(`Unsupported request: ${method}`), { code: -32601 });
    };
    this.onNotification = () => {
    };
  }
  write(message) {
    if (this.closed) return Promise.reject(this.closed);
    const next = this.writes.then(() => this.send(lspFrame(message)));
    this.writes = next.catch((e) => this.fail(e));
    return next;
  }
  feed(bytes) {
    if (this.closed) return;
    try {
      if (this.buffer.length + bytes.length > 16 * 1024 * 1024) throw new Error("LSP message exceeds 16 MiB");
      const buffer = new Uint8Array(this.buffer.length + bytes.length);
      buffer.set(this.buffer);
      buffer.set(bytes, this.buffer.length);
      this.buffer = buffer;
      while (this.buffer.length) {
        let end = -1;
        for (let i = 0; i + 3 < this.buffer.length; i++) if (this.buffer[i] === 13 && this.buffer[i + 1] === 10 && this.buffer[i + 2] === 13 && this.buffer[i + 3] === 10) {
          end = i;
          break;
        }
        if (end < 0) {
          if (this.buffer.length > 8192) throw new Error("LSP header too large");
          return;
        }
        if (end > 8192) throw new Error("LSP header too large");
        const header = decoder.decode(this.buffer.slice(0, end));
        const lengths = [...header.matchAll(/^Content-Length:\s*(\d+)\s*$/gim)];
        if (lengths.length !== 1) throw new Error("Invalid LSP Content-Length");
        const length = Number(lengths[0][1]);
        if (length > 16 * 1024 * 1024) throw new Error("LSP message exceeds 16 MiB");
        if (this.buffer.length < end + 4 + length) return;
        const message = JSON.parse(decoder.decode(this.buffer.slice(end + 4, end + 4 + length)));
        this.buffer = this.buffer.slice(end + 4 + length);
        this.handle(message);
      }
    } catch (error) {
      this.fail(error);
    }
  }
  handle(message) {
    if (message?.jsonrpc !== "2.0") throw new Error("Invalid LSP response");
    if (typeof message.method === "string") {
      if (message.id != null) {
        void Promise.resolve().then(() => this.onRequest(message.method, message.params)).then(
          (result) => this.write({ jsonrpc: "2.0", id: message.id, result: result ?? null }),
          (error) => this.write({ jsonrpc: "2.0", id: message.id, error: { code: typeof error.code === "number" ? error.code : -32603, message: String(error.message || error) } })
        ).catch(() => {
        });
      } else this.onNotification(message.method, message.params);
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(message.error.message || "LSP request failed"));
    else pending.resolve(message.result);
  }
  request(method, params, timeoutMs = 3e4) {
    if (this.closed) return Promise.reject(this.closed);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
        void this.notify("$/cancelRequest", { id }).catch(() => {
        });
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      void this.write({ jsonrpc: "2.0", id, method, params }).catch((error) => this.fail(error));
    });
  }
  notify(method, params) {
    return this.write({ jsonrpc: "2.0", method, params });
  }
  fail(reason) {
    if (this.closed) return;
    this.closed = reason instanceof Error ? reason : new Error(String(reason));
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(this.closed);
    }
    this.pending.clear();
    this.buffer = new Uint8Array(0);
  }
  get alive() {
    return !this.closed;
  }
};
var SEMANTIC_TYPES = [
  "namespace",
  "type",
  "class",
  "enum",
  "interface",
  "struct",
  "typeParameter",
  "parameter",
  "variable",
  "property",
  "enumMember",
  "event",
  "function",
  "method",
  "macro",
  "keyword",
  "modifier",
  "comment",
  "string",
  "number",
  "regexp",
  "operator",
  "decorator"
];
function semanticNames(result, legend, text) {
  const data = result?.data, types = legend?.tokenTypes;
  if (!Array.isArray(data) || !Array.isArray(types)) return {};
  const lines = text.split("\n"), out = /* @__PURE__ */ new Map();
  let line = 0, start2 = 0;
  for (let i = 0; i + 4 < data.length; i += 5) {
    const [dl, ds, length, type] = [data[i], data[i + 1], data[i + 2], data[i + 3]].map(Number);
    if (![dl, ds, length, type].every(Number.isInteger)) break;
    line += dl;
    start2 = dl ? ds : start2 + ds;
    const kind = types[type];
    if (typeof kind !== "string" || length < 1 || length > 128) continue;
    const name = lines[line]?.slice(start2, start2 + length);
    if (!name || !/^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(name)) continue;
    const seen = out.get(name);
    out.set(name, seen === void 0 || seen === kind ? kind : null);
    if (out.size > 5e3) break;
  }
  return Object.fromEntries([...out].filter((entry) => entry[1] !== null));
}

// ../sdk/settings-order.ts
var SPACER_PREFIX = "@spacer:";
function parseOrder(value, allowed, allowSpacers = false) {
  if (typeof value !== "string") throw new Error("Invalid item order");
  const items = JSON.parse(value);
  if (!Array.isArray(items) || items.length > allowed.length + 24) throw new Error("Invalid item order");
  const seen = /* @__PURE__ */ new Set();
  let gaps = 0;
  for (const item of items) {
    if (typeof item !== "string" || seen.has(item)) throw new Error("Duplicate or invalid item");
    seen.add(item);
    if (!allowed.includes(item) && !(allowSpacers && item.startsWith(SPACER_PREFIX) && /^@spacer:[a-zA-Z0-9_-]{1,80}$/.test(item) && ++gaps <= 24)) throw new Error("Unknown item");
  }
  if (!allowed.every((id) => seen.has(id))) throw new Error("Order must retain all current items");
  return items;
}

// ../sdk/ui-controls.ts
var HEX = /^#[0-9a-fA-F]{6}$/;
function validControlValue(field, value) {
  if (typeof value !== "string") return false;
  if (value === "") return !!field.allowDefault;
  if (field.type === "color") return HEX.test(value);
  const n = Number(value);
  return Number.isFinite(n) && n >= field.min && n <= field.max;
}

// ../sdk/settings.ts
function exportSettings(ctx, getSections, onChange, options = {}) {
  const publish = (error = null) => {
    const value = { sections: getSections(), error, ...options.reset ? { resetLabel: options.reset.label } : {} };
    ctx.state.set(`${ctx.moduleId}.settings`, value);
  };
  let queue = Promise.resolve();
  ctx.events.on("settings.change", (edit) => {
    if (edit?.module !== ctx.moduleId) return;
    queue = queue.then(async () => {
      try {
        const section = getSections().find((s) => s.key === edit.section);
        const field = section?.fields.find((f) => f.key === edit.key);
        if (!field || field.type === "action") throw new Error("Setting is no longer available");
        if (field.type === "order") parseOrder(edit.value, field.items.map((i) => i.id), field.allowSpacers);
        else if (field.type === "color" || field.type === "range") {
          if (!validControlValue(field, edit.value)) throw new Error(field.type === "color" ? "Enter a color as #RRGGBB" : `Choose a value from ${field.min} to ${field.max}`);
        } else if (field.type === "toggle" ? typeof edit.value !== "boolean" : typeof edit.value !== "string" || field.type === "select" && !field.options.some((o) => o.value === edit.value)) {
          throw new Error("Invalid setting value");
        }
        await onChange(section.key, field.key, edit.value);
        publish();
      } catch (e) {
        publish(e instanceof Error ? e.message : String(e));
      }
      if (options.invalidate !== false) ctx.ui.invalidate();
    });
  });
  if (options.action) ctx.events.on("settings.action", (event) => {
    if (event?.module !== ctx.moduleId) return;
    const run = async () => {
      try {
        const section = getSections().find((s) => s.key === event.section);
        const field = section?.fields.find((f) => f.key === event.key);
        if (!field || field.type !== "action" || field.disabled) throw new Error("Action is not available");
        await options.action(section.key, field.key);
        publish();
      } catch (error) {
        publish(error instanceof Error ? error.message : String(error));
      }
      if (options.invalidate !== false) ctx.ui.invalidate();
    };
    void run();
  });
  if (options.reset) ctx.events.on("settings.reset", (event) => {
    if (event?.module !== ctx.moduleId || !options.reset) return;
    queue = queue.then(async () => {
      try {
        await options.reset.run();
        publish();
      } catch (e) {
        publish(e instanceof Error ? e.message : String(e));
      }
      if (options.invalidate !== false) ctx.ui.invalidate();
    });
  });
  publish();
  return publish;
}

// modules/services/language-service/src/index.ts
var languages = [];
var publishSettings = (_error) => {
};
var sessions = /* @__PURE__ */ new Map();
var sessionUse = /* @__PURE__ */ new Map();
var retiring = /* @__PURE__ */ new Map();
var access = 0;
var warmSessions = 3;
var evictionQueue = Promise.resolve();
var paths = /* @__PURE__ */ new Map();
var statuses = /* @__PURE__ */ new Map();
function sessionKey(d, server) {
  return `${d.machineId}|${d.rootAbsolutePath}|${server.id}`;
}
function report(ctx, d, server, update) {
  const key = sessionKey(d, server);
  const next = { serverId: server.id, workspaceId: d.id, machineId: d.machineId, ...statuses.get(key), ...update };
  statuses.set(key, next);
  ctx.events.emit("language-service.status", next);
}
async function configuredServer(ctx, d, server) {
  const stored = await get(ctx, `language-server.${server.id}.project`, d);
  const config = projectConfiguration(server, stored?.value);
  return { config, server: projectServer(server, config, d.rootAbsolutePath) };
}
var selected = null;
var refreshVersion = 0;
var stopped = false;
var dependencies = null;
var mcp = null;
function servers() {
  return [...new Map(languages.filter((l) => l.server).map((l) => [l.server.id, l.server])).values()];
}
function sections() {
  return [{ key: "language-service", title: "Language server cache", group: "Languages", fields: [
    {
      key: "warmSessions",
      label: "Keep recent servers running",
      type: "select",
      value: String(warmSessions),
      options: [1, 2, 3, 5].map((n) => ({ value: String(n), label: `${n} ${n === 1 ? "server" : "servers"}` })),
      description: "Reuse language servers and their indexes when switching workspaces. Closed servers retain their on-disk cache."
    }
  ] }, ...servers().map((server) => ({ key: server.id, title: server.id, group: "Languages", fields: [
    {
      key: "executable",
      label: "Language server executable",
      type: "text",
      value: paths.get(server.id) || server.executable,
      description: `${selected?.location === "ssh" ? "Remote" : "Local"} executable for this workspace. Press Enter to apply. ${server.installHint}`
    },
    ...dependencies?.fields(server) || []
  ] }))];
}
async function dispose(ctx, session) {
  session.closing = true;
  await session.queue.catch(() => {
  });
  if (session.initialized && session.peer.alive) {
    try {
      await session.peer.request("shutdown", null, 1e4);
      await session.peer.notify("exit");
    } catch {
    }
  }
  session.peer.fail("Language server stopped");
  await Promise.all(session.subscriptions.map((sub) => sub.close().catch(() => {
  })));
  await ctx.host.process.terminate(session.handle).catch(() => {
  });
  await ctx.host.resources.release(session.handle).catch(() => {
  });
}
async function stopSessions(ctx) {
  const previous = [...sessions.values()];
  sessions.clear();
  sessionUse.clear();
  await Promise.all([...previous.map((p) => p.then((s) => dispose(ctx, s)).catch(() => {
  })), ...retiring.values()]);
}
function trimSessions(ctx, keep) {
  const trim = evictionQueue.catch(() => {
  }).then(async () => {
    while (!stopped && sessions.size > warmSessions) {
      const victim = [...sessions.keys()].filter((key) => key !== keep).sort((a, b) => (sessionUse.get(a) || 0) - (sessionUse.get(b) || 0))[0];
      if (!victim) return;
      const pending = sessions.get(victim);
      sessions.delete(victim);
      sessionUse.delete(victim);
      const closing = pending.then(async (s) => {
        await dispose(ctx, s);
        report(ctx, s.workspace, s.server, { phase: "idle", message: "Index cached on disk; server will resume on demand" });
      }).catch(() => {
      });
      retiring.set(victim, closing);
      await closing;
      if (retiring.get(victim) === closing) retiring.delete(victim);
    }
  });
  evictionQueue = trim;
  return trim;
}
async function refresh(ctx) {
  const mine = ++refreshVersion;
  const next = languageDefinitions((await ctx.host.plugins.list()).plugins);
  if (mine !== refreshVersion || stopped) return;
  const changed = JSON.stringify(next) !== JSON.stringify(languages);
  languages = next;
  paths.clear();
  for (const server of servers()) {
    const setting = await get(ctx, `language-server.${server.id}.executable`, selected);
    if (mine !== refreshVersion || stopped) return;
    if (typeof setting?.value === "string" && setting.value) paths.set(server.id, setting.value);
  }
  if (changed) {
    dependencies?.invalidate();
    await stopSessions(ctx);
  }
  publishSettings();
  ctx.events.emit("language-service.changed", {});
}
function configValue(settings, section) {
  if (!section) return settings;
  return section.split(".").reduce((value, key) => value?.[key], settings) ?? null;
}
async function start(ctx, d, server, key) {
  const configured = await configuredServer(ctx, d, server);
  if (!configured.config.enabled) {
    report(ctx, d, server, { phase: "disabled", message: "Disabled for this workspace" });
    throw new Error(`${server.id} is disabled for this workspace`);
  }
  server = configured.server;
  report(ctx, d, server, { phase: "starting", message: "Starting language server…", capabilities: {}, diagnostics: 0, log: [], importError: null });
  const executableSetting = await get(ctx, `language-server.${server.id}.executable`, d);
  const executable = typeof executableSetting?.value === "string" && executableSetting.value.trim() ? executableSetting.value.trim() : server.executable;
  const grant = await workspaceGrant(ctx, d, "process");
  let handle;
  try {
    const data = server.args.some((arg) => arg.includes("$SERVER_DATA")) ? await serverData(ctx, d, server.id, grant.grant) : "";
    if (data) report(ctx, d, server, { dataDirectory: data });
    const args = server.args.map((arg) => arg.replace(/\$WORKSPACE/g, d.rootAbsolutePath).replace(/\$SERVER_DATA/g, data));
    handle = (await ctx.host.process.spawn(grant.grant, { target: await targetFor(ctx, d), executable, args, cwd: d.rootAbsolutePath, loginShell: d.location === "ssh" })).handle;
  } catch (error) {
    throw new Error(`${server.id} on ${d.machineId}: ${errMsg(error)}. ${server.installHint}`);
  }
  const peer = new LspPeer((frame) => ctx.host.process.write(handle, frame));
  const s = { key, workspace: d, server, handle, peer, subscriptions: [], documents: /* @__PURE__ */ new Map(), closing: false, initialized: false, capabilities: {}, queue: Promise.resolve(), stderr: "" };
  peer.onRequest = async (method, params) => {
    if (method === "workspace/configuration") return (params?.items || []).map((item) => configValue(server.settings || {}, item.section));
    if (method === "workspace/workspaceFolders") return [{ uri: documentUri(d.rootAbsolutePath, ".hato-root").replace(/\/\.hato-root$/, ""), name: d.name }];
    if (method === "client/registerCapability") {
      const names = { "textDocument/definition": "definitionProvider", "textDocument/documentSymbol": "documentSymbolProvider", "textDocument/hover": "hoverProvider", "textDocument/completion": "completionProvider", "textDocument/semanticTokens": "semanticTokensProvider" };
      for (const r of params?.registrations || []) if (names[r.method]) s.capabilities[names[r.method]] = r.registerOptions || true;
      report(ctx, d, server, { capabilities: s.capabilities });
      return null;
    }
    if (["client/unregisterCapability", "window/workDoneProgress/create"].includes(method)) return null;
    if (method === "workspace/applyEdit") return { applied: false, failureReason: "Workspace edits are not enabled" };
    throw Object.assign(new Error(`Unsupported server request: ${method}`), { code: -32601 });
  };
  const diagnostics = /* @__PURE__ */ new Map();
  const buildProblems = /* @__PURE__ */ new Map();
  peer.onNotification = (method, params) => {
    if (method === "textDocument/publishDiagnostics") {
      diagnostics.set(params.uri, Array.isArray(params.diagnostics) ? params.diagnostics.length : 0);
      const file = decodeURIComponent(String(params.uri || "").split("/").pop() || "");
      if (server.buildFiles?.includes(file)) {
        const errors = (Array.isArray(params.diagnostics) ? params.diagnostics : []).filter((x) => x?.severity === 1).map((x) => `${workspacePath(d.rootAbsolutePath, params.uri) || file}:${(x.range?.start?.line ?? 0) + 1}: ${String(x.message).split("\n")[0].slice(0, 300)}`);
        if (errors.length) buildProblems.set(params.uri, errors);
        else buildProblems.delete(params.uri);
      }
      const problems = [...buildProblems.values()].flat().slice(0, 50);
      report(ctx, d, server, {
        diagnostics: [...diagnostics.values()].reduce((a, b) => a + b, 0),
        buildProblems: problems,
        ...statuses.get(key)?.importError ? {} : problems.length ? { phase: "error", message: `Build problems: ${problems[0]}${problems.length > 1 ? ` (+${problems.length - 1} more)` : ""}` } : statuses.get(key)?.buildProblems?.length ? { phase: "ready", message: "Build problems resolved" } : {}
      });
    } else if (method === "$/progress") {
      const value = params?.value;
      if ((value?.kind === "begin" || value?.kind === "report") && !statuses.get(key)?.importError) report(ctx, d, server, { phase: "indexing", message: value.message || value.title || "Indexing project…" });
      else if (value?.kind === "end" && !statuses.get(key)?.importError) report(ctx, d, server, { phase: "ready", message: value.message || "Ready" });
    } else if (["language/status", "window/showMessage", "window/logMessage"].includes(method)) {
      const message = String(params?.message || "").slice(-2e3);
      const log = [...statuses.get(key)?.log || [], message].slice(-30);
      const phase = method === "language/status" ? params?.type === "Started" ? "ready" : params?.type === "Error" ? "error" : "indexing" : void 0;
      const failed = params?.type === 1 || method === "language/status" && params?.type === "Error";
      const importError = failed ? message : statuses.get(key)?.importError;
      report(ctx, d, server, { log, ...importError ? { phase: "error", importError, message: importError.split("\n")[0] } : phase ? { phase, message } : {} });
    }
  };
  try {
    s.subscriptions.push(await ctx.host.streams.listen(handle, { channel: "stdout", encoding: "base64" }, (chunk) => {
      try {
        peer.feed(decodeBase64(chunk));
      } catch (error) {
        peer.fail(error);
      }
    }, (error) => {
      if (s.closing) return;
      const message = error ? errMsg(error) : `${server.id} exited. ${s.stderr.slice(-1500)}`;
      peer.fail(message);
      report(ctx, d, server, { phase: "error", message });
    }));
    s.subscriptions.push(await ctx.host.streams.listen(handle, { channel: "stderr" }, (chunk) => {
      s.stderr = (s.stderr + chunk).slice(-4e3);
    }));
    const rootUri = documentUri(d.rootAbsolutePath, ".hato-root").replace(/\/\.hato-root$/, "");
    const initialized = await peer.request("initialize", {
      processId: null,
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: d.name }],
      clientInfo: { name: "Hato", version: "0.1.0" },
      capabilities: {
        window: { workDoneProgress: true },
        general: { positionEncodings: ["utf-16"] },
        workspace: { configuration: true, workspaceFolders: true, symbol: { dynamicRegistration: false } },
        textDocument: {
          definition: { linkSupport: true },
          hover: { contentFormat: ["markdown", "plaintext"] },
          completion: { completionItem: {
            snippetSupport: false,
            documentationFormat: ["markdown", "plaintext"],
            labelDetailsSupport: true,
            resolveSupport: { properties: ["documentation", "detail", "additionalTextEdits"] }
          } },
          signatureHelp: { contextSupport: true, signatureInformation: { documentationFormat: ["markdown", "plaintext"], activeParameterSupport: true, parameterInformation: { labelOffsetSupport: true } } },
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          semanticTokens: { dynamicRegistration: false, requests: { full: true }, formats: ["relative"], tokenTypes: SEMANTIC_TYPES, tokenModifiers: [], overlappingTokenSupport: false, multilineTokenSupport: false },
          publishDiagnostics: {},
          synchronization: { dynamicRegistration: false, didSave: true }
        }
      },
      initializationOptions: { ...server.initializationOptions, ...server.projectSettings?.initializationSettings ? { workspaceFolders: [rootUri] } : {} }
    }, 12e4);
    s.capabilities = initialized?.capabilities || {};
    if (s.capabilities.positionEncoding && s.capabilities.positionEncoding !== "utf-16") throw new Error("Server selected an unsupported position encoding");
    s.initialized = true;
    await peer.notify("initialized", {});
    await peer.notify("workspace/didChangeConfiguration", { settings: server.settings || {} });
    report(ctx, d, server, { ...!statuses.get(key)?.importError ? { phase: "ready", message: "Connected; project import may still be running" } : {}, capabilities: s.capabilities });
    return s;
  } catch (error) {
    await dispose(ctx, s);
    throw new Error(`${server.id}: ${errMsg(error)}. ${s.stderr.slice(-1500)} ${server.installHint}`);
  }
}
async function sessionFor(ctx, d, server) {
  const key = `${d.machineId}|${d.rootAbsolutePath}|${server.id}`;
  await retiring.get(key);
  sessionUse.set(key, ++access);
  let pending = sessions.get(key);
  if (pending) {
    const existing = await pending;
    if (existing.peer.alive) return existing;
    sessions.delete(key);
    await dispose(ctx, existing);
    pending = void 0;
  }
  if (!pending) {
    pending = start(ctx, d, server, key).catch((error) => {
      if (statuses.get(key)?.phase !== "disabled") report(ctx, d, server, { phase: "error", message: errMsg(error) });
      throw error;
    });
    sessions.set(key, pending);
    pending.catch(() => {
      if (sessions.get(key) === pending) sessions.delete(key);
    });
  }
  const session = await pending;
  void trimSessions(ctx, key).catch((e) => ctx.log.warn("language server cache", errMsg(e)));
  return session;
}
async function synchronize(s, path, text) {
  const language = languageForPath(languages, path);
  if (language?.server?.id !== s.server.id) return;
  const uri = documentUri(s.workspace.rootAbsolutePath, path);
  const old = s.documents.get(uri);
  if (!old) {
    await s.peer.notify("textDocument/didOpen", { textDocument: { uri, languageId: language.id, version: 1, text } });
    s.documents.set(uri, { text, version: 1 });
  } else if (old.text !== text) {
    const sync = s.capabilities.textDocumentSync;
    const kind = typeof sync === "number" ? sync : sync?.change;
    if (kind === 0) throw new Error("Language server does not accept unsaved changes");
    const change = { text };
    if (kind === 2) {
      const lines = old.text.split("\n");
      change.range = { start: { line: 0, character: 0 }, end: { line: lines.length - 1, character: lines[lines.length - 1].length } };
      change.rangeLength = old.text.length;
    }
    await s.peer.notify("textDocument/didChange", { textDocument: { uri, version: old.version + 1 }, contentChanges: [change] });
    s.documents.set(uri, { text, version: old.version + 1 });
  }
}
async function documentRequest(ctx, a, method, capability, map) {
  if (typeof a.text !== "string") throw new Error("Document text is required");
  const path = relativeFile(String(a.path));
  const lang = languageForPath(languages, path);
  if (!lang?.server) return null;
  const d = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
  const s = await sessionFor(ctx, d, lang.server);
  const synced = s.queue.catch(() => {
  }).then(async () => {
    const documents = (Array.isArray(a.documents) ? a.documents : []).filter((doc) => typeof doc.text === "string").map((doc) => ({ path: relativeFile(doc.path), text: doc.text }));
    const keep = /* @__PURE__ */ new Set([documentUri(d.rootAbsolutePath, path), ...documents.map((doc) => documentUri(d.rootAbsolutePath, doc.path))]);
    for (const uri2 of s.documents.keys()) if (!keep.has(uri2)) {
      await s.peer.notify("textDocument/didClose", { textDocument: { uri: uri2 } });
      s.documents.delete(uri2);
    }
    for (const doc of documents) await synchronize(s, doc.path, doc.text);
    await synchronize(s, path, a.text);
    if (!method) return { status: { ...statuses.get(s.key) } };
    if (capability && !s.capabilities[capability]) return { status: null };
    const uri = documentUri(d.rootAbsolutePath, path);
    return { answer: s.peer.request(method, { textDocument: { uri }, ...a.position ? { position: a.position } : {}, ...a.context ? { context: a.context } : {} }, 6e4) };
  });
  s.queue = synced;
  const step = await synced;
  if (!step.answer) return step.status;
  const result = await step.answer;
  return map ? map(result, s) : result;
}
var mod = {
  id: "language-service",
  moduleApiVersion: 1,
  async activate(ctx) {
    stopped = false;
    const cache = await get(ctx, "language-service.warmSessions", null);
    warmSessions = [1, 2, 3, 5].includes(Number(cache?.value)) ? Number(cache.value) : 3;
    selected = ctx.state.get("workspace.selected") || null;
    dependencies = new LanguageDependencies(ctx, servers, () => selected, () => publishSettings(), async (workspace, server, executable) => {
      const key = `${workspace.machineId}|${workspace.rootAbsolutePath}|${server.id}`;
      const session = sessions.get(key);
      if (session) {
        sessions.delete(key);
        await session.then((s) => dispose(ctx, s)).catch(() => {
        });
      }
      if (selected?.id === workspace.id) paths.set(server.id, executable);
      ctx.events.emit("language-service.changed", { workspaceId: workspace.id });
    });
    publishSettings = exportSettings(ctx, sections, async (section, key, value) => {
      if (section === "language-service" && key === "warmSessions") {
        const limit = Number(value);
        if (typeof value !== "string" || ![1, 2, 3, 5].includes(limit)) throw new Error("Choose a valid server cache size");
        await set(ctx, "user", "language-service.warmSessions", limit);
        warmSessions = limit;
        const recent = [...sessions.keys()].sort((a, b) => (sessionUse.get(b) || 0) - (sessionUse.get(a) || 0))[0] || "";
        await trimSessions(ctx, recent);
        return;
      }
      if (dependencies?.busy) throw new Error("Wait for dependency setup to finish before changing the executable");
      if (key !== "executable" || typeof value !== "string" || !value.trim() || /[\r\n\0]/.test(value)) throw new Error("Enter an executable path or command name");
      if (!servers().some((s) => s.id === section)) throw new Error("Language server is no longer available");
      await set(ctx, selected ? `workspace:${selected.id}` : "user", `language-server.${section}.executable`, value.trim());
      paths.set(section, value.trim());
      dependencies?.invalidate(section, selected?.id);
      await stopSessions(ctx);
      ctx.events.emit("language-service.changed", { workspaceId: selected?.id });
    }, { invalidate: false, action: async (section, key) => {
      await dependencies.action(section, key);
    } });
    mcp = exportMcpTools(ctx, "Language services", [
      ...[["project_get", "project.get", true], ["project_update", "project.set", false], ["server_restart", "restart", false], ["index_rebuild", "reindex", false], ["workspace_symbols", "workspaceSymbols", true], ["server_logs", "logs", true]].map(([name, method, readOnly]) => ({
        name: String(name),
        description: `Language services: ${String(name).replace(/_/g, " ")} in this agent's authenticated workspace. project_update accepts config (enabled, values and additional settings); project_get returns its schema.`,
        inputSchema: { type: "object", properties: { serverId: { type: "string" }, query: { type: "string", maxLength: 200 }, config: { type: "object" } }, required: ["serverId"], additionalProperties: false },
        annotations: { readOnlyHint: !!readOnly, destructiveHint: false },
        timeoutMs: 175e3,
        handler: async (args, scope) => {
          const d = await ctx.modules.call("workspace", "resolve", { workspaceId: scope.workspaceId });
          if (d.machineId !== scope.machineId) throw new Error("MCP workspace machine does not match its authenticated scope");
          if (method === "project.set" && (!args.config || typeof args.config !== "object")) throw new Error("config is required; read project_get first");
          const result = await mod.methods[String(method)](ctx, { ...args, workspaceId: scope.workspaceId }, { caller: "language-service" });
          return result;
        }
      }))
    ]);
    await refresh(ctx);
    ctx.events.on("kernel.modules.changed", () => {
      void refresh(ctx).catch((e) => publishSettings(errMsg(e)));
    });
    ctx.state.watch("workspace.selected", (value) => {
      if (selected?.id === value?.id) return;
      selected = value || null;
      void refresh(ctx).catch((e) => publishSettings(errMsg(e)));
    });
  },
  canSwap: () => ({ ok: !dependencies?.busy && !mcp?.pending(), reason: "Language dependency installation/check is running" }),
  async deactivate(ctx) {
    stopped = true;
    refreshVersion++;
    await stopSessions(ctx);
  },
  methods: {
    health() {
      if (stopped) throw new Error("Language services stopped");
      return { ok: true, languages: languages.length };
    },
    async "dependencies.check"(_ctx, a) {
      return dependencies.action(String(a.serverId), "checkDependencies", a.workspaceId);
    },
    async "dependencies.install"(_ctx, a) {
      return dependencies.action(String(a.serverId), "installDependencies", a.workspaceId);
    },
    async describe(_ctx, a) {
      return languageForPath(languages, String(a.path));
    },
    servers() {
      return servers().map((server) => ({ id: server.id, title: server.projectSettings?.title || server.id }));
    },
    async workspaceSymbols(ctx, a) {
      if (typeof a.query !== "string" || a.query.length > 200) throw new Error("Enter a symbol query up to 200 characters");
      const d = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
      const server = servers().find((s) => s.id === a.serverId);
      if (!server) throw new Error("Unknown server");
      if (!a.query.trim()) return [];
      const session = await sessionFor(ctx, d, server);
      const operation = session.queue.catch(() => {
      }).then(() => session.peer.request("workspace/symbol", { query: a.query }, 6e4));
      session.queue = operation;
      const result = await operation;
      return (Array.isArray(result) ? result : []).filter((s) => typeof s.name === "string" && s.location?.range && workspacePath(d.rootAbsolutePath, s.location.uri)).slice(0, 1e3).map((s) => ({ name: s.name, kind: s.kind, container: s.containerName || "", uri: s.location.uri, range: s.location.range, path: workspacePath(d.rootAbsolutePath, s.location.uri) }));
    },
    async logs(ctx, a) {
      const d = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
      const server = servers().find((s) => s.id === a.serverId);
      if (!server) throw new Error("Unknown server");
      const status = statuses.get(sessionKey(d, server));
      if (!status?.dataDirectory) return { status, log: (status?.log || []).join("\n") };
      const grant = await workspaceGrant(ctx, d, "process");
      const result = await ctx.host.process.run(grant.grant, { target: await targetFor(ctx, d), executable: "python3", args: ["-c", "import pathlib,sys; p=pathlib.Path(sys.argv[1])/'.metadata/.log'; print(p.read_text(errors='replace')[-32000:] if p.is_file() else 'No index log yet')", status.dataDirectory], cwd: d.rootAbsolutePath, loginShell: d.location === "ssh" }, { timeoutMs: 3e4 });
      if (result.code !== 0) throw new Error(result.stderr || "Cannot read server log");
      return { status, log: result.stdout };
    },
    async reindex(ctx, a) {
      const d = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
      const server = servers().find((s) => s.id === a.serverId);
      if (!server?.args.some((arg) => arg.includes("$SERVER_DATA"))) throw new Error("This server does not use a managed index; restart it instead");
      await set(ctx, `workspace:${d.id}`, `language-server.${server.id}.index`, crypto.randomUUID());
      return mod.methods.restart(ctx, a, { caller: "language-service" });
    },
    async "project.get"(ctx, a) {
      const d = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
      const server = servers().find((s) => s.id === a.serverId);
      if (!server) throw new Error("Language server is no longer available");
      const { config } = await configuredServer(ctx, d, server);
      return { config, schema: server.projectSettings || null, status: statuses.get(sessionKey(d, server)) || { phase: config.enabled ? "idle" : "disabled", message: config.enabled ? "Open a supported source file to start" : "Disabled for this workspace", serverId: server.id, machineId: d.machineId } };
    },
    async "project.set"(ctx, a, meta) {
      const d = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
      const server = servers().find((s) => s.id === a.serverId);
      if (!server) throw new Error("Language server is no longer available");
      const config = projectConfiguration(server, a.config);
      await set(ctx, `workspace:${d.id}`, `language-server.${server.id}.project`, config);
      const key = sessionKey(d, server), pending = sessions.get(key);
      if (pending) {
        sessions.delete(key);
        await pending.then((s) => dispose(ctx, s)).catch(() => {
        });
      }
      report(ctx, d, server, { phase: config.enabled ? "idle" : "disabled", message: config.enabled ? "Configuration saved; restarting on next request" : "Disabled for this workspace" });
      ctx.events.emit("language-service.configurationChanged", { workspaceId: d.id, serverId: server.id, enabled: config.enabled, caller: meta?.caller || null });
      return { saved: true };
    },
    async restart(ctx, a) {
      const d = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
      const server = servers().find((s) => s.id === a.serverId);
      if (!server) throw new Error("Language server is no longer available");
      const key = sessionKey(d, server), pending = sessions.get(key);
      if (pending) {
        sessions.delete(key);
        await pending.then((s) => dispose(ctx, s)).catch(() => {
        });
      }
      await sessionFor(ctx, d, server);
      return statuses.get(key);
    },
    async synchronize(ctx, a) {
      return documentRequest(ctx, a);
    },
    async saved(ctx, a) {
      const d = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
      const server = languageForPath(languages, String(a.path))?.server;
      if (!server) return;
      const pending = sessions.get(sessionKey(d, server));
      if (!pending) return;
      const s = await pending;
      const operation = s.queue.catch(() => {
      }).then(async () => {
        await synchronize(s, relativeFile(a.path), a.text);
        const save = typeof s.capabilities.textDocumentSync === "object" ? s.capabilities.textDocumentSync.save : false;
        if (save) await s.peer.notify("textDocument/didSave", { textDocument: { uri: documentUri(d.rootAbsolutePath, a.path) }, ...save.includeText ? { text: a.text } : {} });
      });
      s.queue = operation;
      return operation;
    },
    async symbols(ctx, a) {
      const d = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
      const path = relativeFile(String(a.path)), uri = documentUri(d.rootAbsolutePath, path);
      return documentSymbols(await documentRequest(ctx, a, "textDocument/documentSymbol", "documentSymbolProvider"), uri).map((s) => ({ ...s, path, uri }));
    },
    /** Identifiers in a document by semantic kind (`{EventHandler: "interface"}`), or {} without support. */
    async semanticNames(ctx, a) {
      return await documentRequest(
        ctx,
        a,
        "textDocument/semanticTokens/full",
        "semanticTokensProvider",
        (result, s) => semanticNames(result, s.capabilities.semanticTokensProvider?.legend, a.text)
      ) || {};
    },
    async hover(ctx, a) {
      if (!validPosition(a.position)) throw new Error("Invalid hover position");
      return documentRequest(ctx, a, "textDocument/hover", "hoverProvider");
    },
    async completions(ctx, a) {
      if (!validPosition(a.position)) throw new Error("Invalid completion position");
      return await documentRequest(ctx, a, "textDocument/completion", "completionProvider") || [];
    },
    async signatureHelp(ctx, a) {
      if (!validPosition(a.position)) throw new Error("Invalid signature position");
      return documentRequest(ctx, a, "textDocument/signatureHelp", "signatureHelpProvider");
    },
    /** Resolve an accepted completion item (details and additionalTextEdits such as imports). */
    async resolveCompletion(ctx, a) {
      if (!a.item || typeof a.item !== "object") throw new Error("A completion item is required");
      const path = relativeFile(String(a.path));
      const lang = languageForPath(languages, path);
      if (!lang?.server) return a.item;
      const d = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
      const pending = sessions.get(sessionKey(d, lang.server));
      if (!pending) return a.item;
      const s = await pending;
      if (!s.capabilities.completionProvider?.resolveProvider) return a.item;
      const sent = s.queue.catch(() => {
      }).then(() => ({ answer: s.peer.request("completionItem/resolve", a.item, 3e4) }));
      s.queue = sent;
      return (await sent).answer;
    },
    async definitions(ctx, a) {
      if (typeof a.text !== "string" || !validPosition(a.position)) throw new Error("Definition requires text and a UTF-16 position");
      return definitionLinks(await documentRequest(ctx, a, "textDocument/definition", "definitionProvider"));
    }
  }
};
var index_default = mod;
export {
  index_default as default
};
