// Guard for the "no `sh` in modules" rule (native Windows workspaces): modules spawn programs with
// argv and parse output in TypeScript. User-authored commands go through `userCommandLaunch` in
// `@hato/sdk/platform`, and tool lookup through its resolvers. `loginShell` (the kernel's remote PATH
// setup) is allowed. Remaining POSIX-only shell use is listed below with the reason it stays.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ALLOWED = new Map([
  // Chrome detection/install scripts on Linux/macOS machines; native Windows uses the direct path.
  ['modules/services/browser/src/launch.ts', 'POSIX browser scripts; Windows branch spawns directly'],
  // Login/interactive-shell PATH discovery on Linux/macOS machines; Windows uses resolveWindowsExecutable.
  ['modules/services/acp/src/index.ts', 'POSIX PATH discovery; Windows uses the registry resolver'],
  ['modules/services/opencode-provider/src/index.ts', 'POSIX PATH fallback; never used on native Windows'],
  // `env -u` after login-shell initialization on Linux/macOS daemons; Windows spawns argv directly.
  ['modules/services/agent-runner/src/index.ts', 'POSIX login-shell env wrapper; Windows spawns directly'],
]);

const SHELL_SPAWN = [
  /executable\s*:\s*["'`](?:\/bin\/|\/usr\/bin\/)?(?:sh|bash|zsh|dash)["'`]/,
  /executable\s*:\s*[^,}\n]*["'`]\/bin\/(?:sh|bash|zsh)["'`]/,
  /\brun\(\s*["'`](?:sh|bash|zsh)["'`]\s*,/,
];

function* sources(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* sources(full);
    else if (entry.name.endsWith('.ts')) yield full;
  }
}

test('modules do not start POSIX shells outside the documented exceptions', () => {
  const offenders = [];
  for (const file of sources(path.join(root, 'modules'))) {
    const rel = path.relative(root, file).split(path.sep).join('/');
    if (ALLOWED.has(rel)) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => { if (SHELL_SPAWN.some(re => re.test(line))) offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 140)}`); });
  }
  assert.deepEqual(offenders, [], 'Use argv spawns, userCommandLaunch or the @hato/sdk/platform resolvers instead of sh/bash');
});

test('every allowed exception still exists', () => {
  for (const rel of ALLOWED.keys()) assert.ok(fs.existsSync(path.join(root, rel)), `${rel} is allowlisted but missing; remove it from ALLOWED`);
});
