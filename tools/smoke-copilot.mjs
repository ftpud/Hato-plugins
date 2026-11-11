#!/usr/bin/env node
// Protocol-only smoke check: initializes the installed CLI in a temporary directory.
// Does not create a provider session, send a prompt, log in, or install anything.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const sdk = process.env.HATO_SDK_ROOT || path.resolve(root, '../sdk');
const { outputFiles } = await build({ entryPoints: [path.join(sdk, 'runtime.ts')], bundle: true, format: 'esm', write: false });
const { JsonRpcPeer } = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'));
const manifest = JSON.parse(await readFile(path.join(root, 'modules/services/copilot-provider/manifest.json'), 'utf8'));
const profile = manifest.contributes.agentProviders[0].profile;
const cwd = await mkdtemp(path.join(tmpdir(), 'hato-copilot-acp-'));
const child = spawn(profile.executable, profile.args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
const peer = new JsonRpcPeer(line => new Promise((resolve, reject) => child.stdin.write(line + '\n', error => error ? reject(error) : resolve())));
const protocolErrors = [];
peer.onProtocolError = error => protocolErrors.push(error);
child.stdout.setEncoding('utf8');child.stdout.on('data', chunk => peer.feed(chunk));
child.stderr.resume();
child.stdin.on('error', error => peer.failAll(error.message));
child.on('error', error => peer.failAll(error.message));
let exited = false;
const exit = new Promise(resolve => child.once('close', code => { exited = true; peer.failAll(`Copilot exited (${code})`); resolve(); }));
let timer;
try {
  const result = await Promise.race([
    peer.request('initialize', { protocolVersion: 1, clientInfo: { name: 'hato-smoke', version: '0.1.0' }, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } }),
    new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Copilot ACP initialize timed out')), 30000); }),
  ]);
  if (result.protocolVersion !== 1 || protocolErrors.length) throw Error('Copilot did not negotiate a clean ACP v1 stream');
  console.log(JSON.stringify({ ok: true, protocolVersion: result.protocolVersion, agentInfo: result.agentInfo, authMethods: (result.authMethods || []).map(m => ({ id: m.id, name: m.name })) }, null, 2));
} finally {
  clearTimeout(timer);
  peer.failAll('Smoke check finished');
  child.stdin.end();
  if (!exited) {
    let grace;
    await Promise.race([exit, new Promise(resolve => { grace = setTimeout(resolve, 2000); })]);
    clearTimeout(grace);
  }
  if (!exited) { child.kill('SIGTERM'); await exit; }
  await rm(cwd, { recursive: true, force: true });
}
