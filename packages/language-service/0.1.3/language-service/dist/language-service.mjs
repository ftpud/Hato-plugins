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
            target = (root / member.name).resolve()
            if target != root and root not in target.parents: raise ValueError('Archive path escapes destination')
            if member.issym() or member.islnk():
                link = ((target.parent if member.issym() else root) / member.linkname).resolve()
                if link != root and root not in link.parents: raise ValueError('Archive link escapes destination')
            # Recheck after prior symlinks were created. On Python 3.12+, use its data filter too.
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
        else if (field.type === "toggle" ? typeof edit.value !== "boolean" : typeof edit.value !== "string" || field.type === "select" && !field.options.some((o) => o.value === edit.value)) {
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
var paths = /* @__PURE__ */ new Map();
var selected = null;
var refreshVersion = 0;
var stopped = false;
var dependencies = null;
function servers() {
  return [...new Map(languages.filter((l) => l.server).map((l) => [l.server.id, l.server])).values()];
}
function sections() {
  return servers().map((server) => ({ key: server.id, title: server.id, group: "Languages", fields: [
    {
      key: "executable",
      label: "Language server executable",
      type: "text",
      value: paths.get(server.id) || server.executable,
      description: `${selected?.location === "ssh" ? "Remote" : "Local"} executable for this workspace. Press Enter to apply. ${server.installHint}`
    },
    ...dependencies?.fields(server) || []
  ] }));
}
async function dispose(ctx, session) {
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
  await Promise.all(previous.map((p) => p.then((s) => dispose(ctx, s)).catch(() => {
  })));
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
  const executableSetting = await get(ctx, `language-server.${server.id}.executable`, d);
  const executable = typeof executableSetting?.value === "string" && executableSetting.value.trim() ? executableSetting.value.trim() : server.executable;
  const grant = await workspaceGrant(ctx, d, "process");
  let handle;
  try {
    const args = server.args.map((arg) => arg.replace(/\$WORKSPACE/g, d.rootAbsolutePath));
    handle = (await ctx.host.process.spawn(grant.grant, { target: await targetFor(ctx, d), executable, args, cwd: d.rootAbsolutePath, loginShell: d.location === "ssh" })).handle;
  } catch (error) {
    throw new Error(`${server.id} on ${d.machineId}: ${errMsg(error)}. ${server.installHint}`);
  }
  const peer = new LspPeer((frame) => ctx.host.process.write(handle, frame));
  const s = { key, workspace: d, server, handle, peer, subscriptions: [], documents: /* @__PURE__ */ new Map(), capabilities: {}, queue: Promise.resolve(), stderr: "" };
  peer.onRequest = async (method, params) => {
    if (method === "workspace/configuration") return (params?.items || []).map((item) => configValue(server.settings || {}, item.section));
    if (method === "workspace/workspaceFolders") return [{ uri: documentUri(d.rootAbsolutePath, ".hato-root").replace(/\/\.hato-root$/, ""), name: d.name }];
    if (["client/registerCapability", "client/unregisterCapability", "window/workDoneProgress/create"].includes(method)) return null;
    if (method === "workspace/applyEdit") return { applied: false, failureReason: "Workspace edits are not enabled" };
    throw Object.assign(new Error(`Unsupported server request: ${method}`), { code: -32601 });
  };
  try {
    s.subscriptions.push(await ctx.host.streams.listen(handle, { channel: "stdout", encoding: "base64" }, (chunk) => {
      try {
        peer.feed(decodeBase64(chunk));
      } catch (error) {
        peer.fail(error);
      }
    }, (error) => peer.fail(error ? errMsg(error) : `${server.id} exited. ${s.stderr.slice(-1500)}`)));
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
        general: { positionEncodings: ["utf-16"] },
        workspace: { configuration: true, workspaceFolders: true },
        textDocument: { definition: { linkSupport: true }, synchronization: { dynamicRegistration: false, didSave: true } }
      },
      initializationOptions: server.initializationOptions || {}
    }, 12e4);
    s.capabilities = initialized?.capabilities || {};
    if (s.capabilities.positionEncoding && s.capabilities.positionEncoding !== "utf-16") throw new Error("Server selected an unsupported position encoding");
    await peer.notify("initialized", {});
    await peer.notify("workspace/didChangeConfiguration", { settings: server.settings || {} });
    return s;
  } catch (error) {
    await dispose(ctx, s);
    throw new Error(`${server.id}: ${errMsg(error)}. ${s.stderr.slice(-1500)} ${server.installHint}`);
  }
}
async function sessionFor(ctx, d, server) {
  const key = `${d.machineId}|${d.rootAbsolutePath}|${server.id}`;
  let pending = sessions.get(key);
  if (pending) {
    const existing = await pending;
    if (existing.peer.alive) return existing;
    sessions.delete(key);
    await dispose(ctx, existing);
    pending = void 0;
  }
  if (!pending) {
    pending = start(ctx, d, server, key);
    sessions.set(key, pending);
    pending.catch(() => {
      if (sessions.get(key) === pending) sessions.delete(key);
    });
  }
  return pending;
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
var mod = {
  id: "language-service",
  moduleApiVersion: 1,
  async activate(ctx) {
    stopped = false;
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
    });
    publishSettings = exportSettings(ctx, sections, async (section, key, value) => {
      if (dependencies?.busy) throw new Error("Wait for dependency setup to finish before changing the executable");
      if (key !== "executable" || typeof value !== "string" || !value.trim() || /[\r\n\0]/.test(value)) throw new Error("Enter an executable path or command name");
      if (!servers().some((s) => s.id === section)) throw new Error("Language server is no longer available");
      await set(ctx, selected ? `workspace:${selected.id}` : "user", `language-server.${section}.executable`, value.trim());
      paths.set(section, value.trim());
      dependencies?.invalidate(section, selected?.id);
      await stopSessions(ctx);
    }, { invalidate: false, action: async (section, key) => {
      await dependencies.action(section, key);
    } });
    await refresh(ctx);
    ctx.events.on("kernel.modules.changed", () => {
      void refresh(ctx).catch((e) => publishSettings(errMsg(e)));
    });
    ctx.state.watch("workspace.selected", (value) => {
      if (selected?.id === value?.id) return;
      selected = value || null;
      void stopSessions(ctx).then(() => refresh(ctx)).catch((e) => publishSettings(errMsg(e)));
    });
  },
  canSwap: () => ({ ok: !dependencies?.busy, reason: "Language dependency installation/check is running" }),
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
    async definitions(ctx, a) {
      if (typeof a.text !== "string" || !validPosition(a.position)) throw new Error("Definition requires text and a UTF-16 position");
      const path = relativeFile(String(a.path));
      const lang = languageForPath(languages, path);
      if (!lang?.server) return [];
      const d = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
      const s = await sessionFor(ctx, d, lang.server);
      const operation = s.queue.catch(() => {
      }).then(async () => {
        const documents = (Array.isArray(a.documents) ? a.documents : []).filter((doc) => typeof doc.text === "string").map((doc) => ({ path: relativeFile(doc.path), text: doc.text }));
        const keep = /* @__PURE__ */ new Set([documentUri(d.rootAbsolutePath, path), ...documents.map((doc) => documentUri(d.rootAbsolutePath, doc.path))]);
        for (const uri of s.documents.keys()) if (!keep.has(uri)) {
          await s.peer.notify("textDocument/didClose", { textDocument: { uri } });
          s.documents.delete(uri);
        }
        for (const doc of documents) await synchronize(s, doc.path, doc.text);
        await synchronize(s, path, a.text);
        return definitionLinks(await s.peer.request("textDocument/definition", { textDocument: { uri: documentUri(d.rootAbsolutePath, path) }, position: a.position }));
      });
      s.queue = operation;
      return operation;
    }
  }
};
var index_default = mod;
export {
  index_default as default
};
