// Runs on the workspace machine through its approved process scope; no administrator install.
export const DEPENDENCY_SCRIPT = String.raw`
import hashlib, json, os, pathlib, platform, re, shlex, shutil, subprocess, sys, tarfile, tempfile, time, urllib.request, uuid, zipfile
MARKER = '__HATO_DEPENDENCIES__='
WINDOWS = os.name == 'nt'
EXE = '.exe' if WINDOWS else ''

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
    candidates = [os.path.join(os.environ.get('JAVA_HOME', ''), 'bin', 'java' + EXE) if os.environ.get('JAVA_HOME') else None,
                  executable('java'), str(root / ('java-' + str(minimum)) / 'bin' / ('java' + EXE)), str(root / ('java-' + str(minimum)) / 'Contents/Home/bin/java'), str(root / 'java' / 'bin' / ('java' + EXE)), str(root / 'java/Contents/Home/bin/java')]
    if sys.platform == 'darwin':
        candidates += ['/opt/homebrew/opt/openjdk/bin/java', '/usr/local/opt/openjdk/bin/java']
        try:
            code, output = command(['/usr/libexec/java_home', '-v', str(minimum) + '+'])
            if code == 0: candidates.append(output.splitlines()[0] + '/bin/java')
        except (OSError, subprocess.TimeoutExpired): pass
    if WINDOWS:
        for base in [os.environ.get('ProgramFiles'), os.environ.get('LOCALAPPDATA')]:
            if base:
                for vendor in ('Eclipse Adoptium', 'Java', 'Microsoft', 'Zulu', 'Amazon Corretto', 'BellSoft'):
                    candidates += [str(p) for p in pathlib.Path(base, vendor).glob('*/bin/java.exe')]
    else:
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
    wrapper = str(root / 'bin' / (server + ('.cmd' if WINDOWS else '')))
    # Managed tools remain usable even after a workspace moves or its preference was cleared.
    path = executable(request['executable'])
    metadata = read_metadata(root, server) if path == wrapper else {}
    python = metadata.get('python') or sys.executable
    components = [{'label': 'Python 3', 'found': os.path.isfile(python), 'version': platform.python_version(), 'path': python}]
    if recipe['kind'] == 'jdtls':
        effective = metadata.get('runtime') or (os.path.join(os.environ['JAVA_HOME'], 'bin', 'java' + EXE) if os.environ.get('JAVA_HOME') else executable('java'))
        minimum = required_java(recipe, root, metadata.get('serverRoot'))
        jdk = runtime(effective, 'java', minimum)
        components.append({'label': 'JDK ' + str(minimum) + '+ (language server)', 'found': bool(jdk), **(jdk or {})})
    else:
        node = runtime(metadata.get('runtime') or executable('node'), 'node', 20)
        npm = metadata.get('npm') or executable('npm')
        components += [{'label': 'Node.js 20+', 'found': bool(node), **(node or {})}, {'label': 'npm', 'found': bool(npm and os.path.isfile(npm)), 'path': npm}]
    components.append({'label': server, 'found': bool(path), 'path': path})
    return {'ready': all(c['found'] for c in components), 'executable': path, 'components': components,
            'supported': platform.system() in ('Darwin', 'Linux', 'Windows'), 'directory': str(root)}

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

def extract_zip(archive, destination):
    destination.mkdir()
    root = destination.resolve()
    with zipfile.ZipFile(archive) as z:
        members = z.infolist()
        if len(members) > 50000 or sum(m.file_size for m in members) > 2 * 1024**3: raise ValueError('Dependency archive is too large')
        for member in members:
            name = member.filename.replace('\\', '/')
            if name.startswith('/') or re.match(r'^[A-Za-z]:', name): raise ValueError('Absolute archive path')
            target = (root / name).resolve()
            if target != root and root not in target.parents: raise ValueError('Archive path escapes destination')
            if name.endswith('/'): target.mkdir(parents=True, exist_ok=True); continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with z.open(member) as source, open(target, 'wb') as out: shutil.copyfileobj(source, out)

def extract(archive, destination):
    if zipfile.is_zipfile(archive): return extract_zip(archive, destination)
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
        archive = temp / ('archive.zip' if url.lower().endswith('.zip') else 'archive.tar.gz')
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
    system = {'Darwin': 'mac', 'Linux': 'linux', 'Windows': 'windows'}.get(platform.system())
    arch = {'arm64': 'aarch64', 'aarch64': 'aarch64', 'x86_64': 'x64', 'AMD64': 'x64'}.get(platform.machine())
    if not system or not arch: raise ValueError('Automatic installation supports macOS/Linux on x64 and arm64 and Windows on x64; install manually on this platform')
    # Windows: x64 only (Windows on ARM is not supported).
    if system == 'windows' and arch != 'x64': raise ValueError('Automatic installation on Windows supports x64 only; install the runtime manually')
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
    candidates = [destination / 'bin' / ('java' + EXE), destination / 'Contents/Home/bin/java']
    for candidate in candidates:
        if runtime(str(candidate), 'java', major): return str(candidate)
    raise ValueError('Downloaded JDK did not pass its version check')

def install_node(root, major):
    node = runtime(executable('node'), 'node', 20)
    npm = executable('npm')
    if node and npm: return node['path'], npm
    # Windows archives keep node.exe and node_modules at the top level.
    managed_node = root / ('node/node.exe' if WINDOWS else 'node/bin/node')
    managed_npm = root / ('node/node_modules/npm/bin/npm-cli.js' if WINDOWS else 'node/lib/node_modules/npm/bin/npm-cli.js')
    if runtime(str(managed_node), 'node', 20) and managed_npm.is_file(): return str(managed_node), str(managed_npm)
    system, arch = machine()
    suffix = 'win-x64.zip' if system == 'windows' else ('darwin' if system == 'mac' else system) + '-' + ('arm64' if arch == 'aarch64' else arch) + '.tar.gz'
    base = 'https://nodejs.org/download/release/latest-v' + str(major) + '.x/'
    sums = fetch(base + 'SHASUMS256.txt').decode().splitlines()
    matches = [(line.split()[1], line.split()[0]) for line in sums if len(line.split()) == 2 and line.split()[1].endswith('-' + suffix)]
    if len(matches) != 1: raise ValueError('No matching Node.js archive')
    filename, checksum = matches[0]
    destination = install_archive(root, 'node', base + filename, checksum, True)
    node = str(destination / ('node.exe' if WINDOWS else 'bin/node'))
    npm = str(destination / ('node_modules/npm/bin/npm-cli.js' if WINDOWS else 'lib/node_modules/npm/bin/npm-cli.js'))
    if not runtime(node, 'node', 20) or not os.path.isfile(npm): raise ValueError('Downloaded Node.js did not pass its version check')
    return node, npm

def cmd_wrapper(env, argv, path_prefix=None):
    # Batch wrapper for Windows. Paths with characters cmd would expand or split are refused.
    for value in list(env.values()) + argv + ([path_prefix] if path_prefix else []):
        if re.search(r'[%"\r\n^&|<>!]', value): raise ValueError('Unsupported character in tool path: ' + value)
    lines = ['@echo off', 'setlocal']
    lines += ['set "' + k + '=' + v + '"' for k, v in env.items()]
    if path_prefix: lines.append('set "PATH=' + path_prefix + ';%PATH%"')
    lines.append(' '.join('"' + a + '"' for a in argv) + ' %*')
    return '\r\n'.join(lines) + '\r\n'

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
                # os.kill(pid, 0) terminates the process on Windows: use the lock's age there.
                if WINDOWS:
                    if time.time() - lock.stat().st_mtime > 30 * 60: raise ProcessLookupError()
                else: os.kill(pid, 0)
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
            body = cmd_wrapper({'JAVA_HOME': java_home(java)}, [sys.executable, str(launcher)]) if WINDOWS else \
                '#!/bin/sh\nexport JAVA_HOME=' + shlex.quote(java_home(java)) + '\nexec ' + shlex.quote(sys.executable) + ' ' + shlex.quote(str(launcher)) + ' "$@"\n'
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
            body = cmd_wrapper({}, [node, str(launcher)], str(pathlib.Path(node).parent)) if WINDOWS else \
                '#!/bin/sh\nexport PATH=' + shlex.quote(str(pathlib.Path(node).parent)) + ':"$PATH"\nexec ' + shlex.quote(node) + ' ' + shlex.quote(str(launcher)) + ' "$@"\n'
            metadata = {'runtime': node, 'npm': npm}
        (root / 'bin').mkdir(exist_ok=True)
        atomic_text(root / (server + '.json'), json.dumps(metadata))
        wrapper = root / 'bin' / (server + ('.cmd' if WINDOWS else ''))
        atomic_text(wrapper, body, 0o755)
        return inspect(dict(request, executable=str(wrapper)), root)
    finally: lock.unlink(missing_ok=True)

def main(request):
    if not re.fullmatch('[a-z0-9][a-z0-9-]{0,79}', request['server']): raise ValueError('Invalid server id')
    if request['setup']['kind'] not in ('jdtls', 'npm'): raise ValueError('Unknown dependency installer')
    default = os.path.join(os.environ['LOCALAPPDATA'], 'Hato', 'language-tools') if WINDOWS and os.environ.get('LOCALAPPDATA') else os.path.expanduser('~/.local/share/hato/language-tools')
    root = pathlib.Path(request.get('root') or os.environ.get('HATO_LANGUAGE_TOOLS_HOME') or default)
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
