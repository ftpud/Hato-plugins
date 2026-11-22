// A Debug Adapter Protocol relay that runs on the workspace machine (`python3 -c RELAY_SCRIPT <config>`).
// The host can spawn processes with streamed stdio but cannot open TCP connections, and adapters
// (js-debug, java-debug) listen on loopback TCP. The relay optionally starts the adapter, connects to
// it (one socket per DAP session; js-debug opens child sessions) and translates Content-Length framing
// to one ASCII-only JSON object per line, so a UTF-8 sequence can never be split across stream chunks.
//
// stdin:  {"op":"open","id":N} | {"op":"send","id":N,"msg":{...}} | {"op":"close","id":N}
// stdout: {"ev":"ready","port":P} | {"ev":"opened","id":N} | {"ev":"msg","id":N,"msg":{...}}
//         {"ev":"closed","id":N,"error"?} | {"ev":"log","text"} | {"ev":"fatal","text"}
export const RELAY_SCRIPT = String.raw`
import json, os, re, socket, subprocess, sys, threading
cfg = json.loads(sys.argv[1])
lock = threading.Lock()
def emit(obj):
    line = json.dumps(obj, ensure_ascii=True, separators=(',', ':'))
    with lock:
        sys.stdout.write(line + '\n'); sys.stdout.flush()
server = None
host = '127.0.0.1'
if 'spawn' in cfg:
    spec = cfg['spawn']
    env = dict(os.environ, **spec.get('env', {}))
    server = subprocess.Popen(spec['command'], cwd=spec.get('cwd') or None, env=env, stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    pattern = re.compile(spec['portPattern'])
    port = None
    for line in server.stdout:
        emit({'ev': 'log', 'text': line[-2000:]})
        m = pattern.search(line)
        if m:
            port = int(m.group(1)); break
    if port is None:
        emit({'ev': 'fatal', 'text': 'The debug adapter exited before it started listening'}); sys.exit(1)
    def drain():
        for line in server.stdout: emit({'ev': 'log', 'text': line[-2000:]})
    threading.Thread(target=drain, daemon=True).start()
else:
    port = int(cfg['connect']['port'])
    host = cfg['connect'].get('host') or host
    if host not in ('127.0.0.1', 'localhost', '::1'):
        emit({'ev': 'fatal', 'text': 'The relay only connects to loopback adapters'}); sys.exit(1)
emit({'ev': 'ready', 'port': port})
conns = {}
def reader(cid, sock):
    buf = b''
    try:
        while True:
            data = sock.recv(65536)
            if not data: break
            buf += data
            while True:
                end = buf.find(b'\r\n\r\n')
                if end < 0: break
                m = re.search(rb'Content-Length:\s*(\d+)', buf[:end], re.I)
                if not m: raise ValueError('Malformed DAP header')
                size = int(m.group(1)); start = end + 4
                if len(buf) < start + size: break
                body, buf = buf[start:start + size], buf[start + size:]
                emit({'ev': 'msg', 'id': cid, 'msg': json.loads(body.decode('utf-8'))})
    except Exception as error:
        emit({'ev': 'closed', 'id': cid, 'error': str(error)}); return
    emit({'ev': 'closed', 'id': cid})
for line in sys.stdin:
    try: req = json.loads(line)
    except ValueError: continue
    op, cid = req.get('op'), req.get('id')
    if op == 'open':
        try:
            sock = socket.create_connection((host, port), timeout=15)
            sock.settimeout(None)
            conns[cid] = sock
            threading.Thread(target=reader, args=(cid, sock), daemon=True).start()
            emit({'ev': 'opened', 'id': cid})
        except Exception as error:
            emit({'ev': 'closed', 'id': cid, 'error': str(error)})
    elif op == 'send' and cid in conns:
        body = json.dumps(req['msg'], ensure_ascii=False).encode('utf-8')
        try: conns[cid].sendall(b'Content-Length: ' + str(len(body)).encode() + b'\r\n\r\n' + body)
        except OSError as error: emit({'ev': 'closed', 'id': cid, 'error': str(error)})
    elif op == 'close' and cid in conns:
        try: conns.pop(cid).close()
        except OSError: pass
for sock in conns.values():
    try: sock.close()
    except OSError: pass
if server:
    server.terminate()
    try: server.wait(5)
    except subprocess.TimeoutExpired: server.kill()
`;
