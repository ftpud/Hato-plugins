import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = await build({ entryPoints: [path.join(root, 'modules/ui/ai/src/commands.ts')], bundle: true, format: 'esm', write: false });
const { matchingCommands, applySlashCommand } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const commands = [
  { name: 'review', description: 'Review changes', input: { hint: 'path or focus' } },
  { name: 'research', description: 'Research codebase' },
  { name: 'bad/name', description: 'Ignored' },
];

test('slash autocomplete filters the leading command token and preserves provider descriptions', () => {
  assert.deepEqual(matchingCommands(commands, '/re').map(command => command.name), ['review', 'research']);
  assert.equal(matchingCommands(commands, '/review focus').length, 0);
  assert.equal(matchingCommands(commands, 'review').length, 0);
  assert.equal(matchingCommands(commands, '/').length, 2);
});

test('choosing a slash command inserts a normal prompt token without sending it', () => {
  assert.equal(applySlashCommand('/re', commands[0]), '/review ');
  assert.equal(applySlashCommand('/review focus', commands[0]), '/review focus');
});
