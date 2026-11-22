// Debug adapters, pinned by version and SHA-256, installed for the user on the workspace machine
// (`python3 -c INSTALL_SCRIPT <request>`) under ~/.local/share/hato/debug-adapters. No admin rights.
export const ADAPTERS = {
  "js-debug": {
    version: "1.140.1",
    url: "https://github.com/microsoft/vscode-js-debug/releases/download/v1.140.1/js-debug-dap-v1.140.1.tar.gz",
    sha256: "c72fab31bcbfdce6ad1f42adfd28eff8d4681dd3b03b5e2e6f9e72e6f9927faf",
  },
  "java-debug": {
    version: "0.53.1",
    url: "https://repo1.maven.org/maven2/com/microsoft/java/com.microsoft.java.debug.plugin/0.53.1/com.microsoft.java.debug.plugin-0.53.1.jar",
    sha256: "4f4778d452a6a0665536f43ce4e32403a24be6593336b80dc85a322912859e24",
  },
} as const;
export type AdapterId = keyof typeof ADAPTERS;
export const INSTALL_MARKER = "HATO_DEBUG_ADAPTER_RESULT:";

export const INSTALL_SCRIPT = String.raw`
import hashlib, json, os, pathlib, shutil, sys, tarfile, tempfile, urllib.request
MARKER = '${INSTALL_MARKER}'
def target(root, name, spec):
    if name == 'js-debug': return root / ('js-debug-' + spec['version']) / 'js-debug' / 'src' / 'dapDebugServer.js'
    return root / ('java-debug-' + spec['version'] + '.jar')
def download(url, destination, digest):
    if not url.startswith('https://'): raise ValueError('Adapter downloads require HTTPS')
    request = urllib.request.Request(url, headers={'User-Agent': 'hato-debug-installer'})
    sha = hashlib.sha256()
    with urllib.request.urlopen(request, timeout=120) as response, open(destination, 'wb') as out:
        if not response.geturl().startswith('https://'): raise ValueError('Insecure download redirect')
        while True:
            chunk = response.read(1 << 20)
            if not chunk: break
            sha.update(chunk); out.write(chunk)
    if sha.hexdigest() != digest: raise ValueError('Checksum mismatch for ' + url)
def safe_extract(archive, destination):
    base = destination.resolve()
    with tarfile.open(archive, 'r:gz') as tar:
        for member in tar.getmembers():
            path = (destination / member.name).resolve()
            if member.issym() or member.islnk() or not (path == base or base in path.parents):
                raise ValueError('Unsafe path in adapter archive: ' + member.name)
        tar.extractall(destination)
def install(root, name, spec):
    final = target(root, name, spec)
    if final.is_file(): return str(final)
    root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.download-', dir=root) as temporary:
        temporary = pathlib.Path(temporary)
        archive = temporary / 'download'
        download(spec['url'], archive, spec['sha256'])
        if name == 'js-debug':
            unpacked = temporary / 'unpacked'
            unpacked.mkdir()
            safe_extract(archive, unpacked)
            destination = root / ('js-debug-' + spec['version'])
            if destination.exists(): shutil.rmtree(destination)
            unpacked.replace(destination)
        else:
            archive.replace(final)
    if not final.is_file(): raise ValueError(name + ' is missing after installation')
    return str(final)
def main(request):
    root = pathlib.Path(os.environ.get('HATO_DEBUG_ADAPTERS_HOME') or os.path.expanduser('~/.local/share/hato/debug-adapters'))
    result = {}
    for name, spec in request['adapters'].items():
        if name not in ('js-debug', 'java-debug'): raise ValueError('Unknown adapter ' + name)
        path = target(root, name, spec)
        result[name] = install(root, name, spec) if request['action'] == 'install' else (str(path) if path.is_file() else None)
    return result
try: print(MARKER + json.dumps(main(json.loads(sys.argv[1]))))
except Exception as error:
    print(MARKER + json.dumps({'error': str(error)})); sys.exit(1)
`;
