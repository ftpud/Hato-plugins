import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const sdk = new URL('../../sdk', import.meta.url).pathname;
// `fresh` busts the import cache, giving a module instance with empty caches (as after a reload).
const load = async (path, fresh = '') => import('data:text/javascript;base64,' + Buffer.from((await build({ entryPoints: [new URL(path, import.meta.url).pathname], bundle: true, format: 'esm', write: false, alias: { '@hato/sdk': sdk } })).outputFiles[0].text + fresh).toString('base64'));
const { fileHistory } = await load('../modules/services/git/src/file-history.ts');
const { mapToCommitted } = await load('../modules/ui/viewer/src/history.ts');

/** Repository at `root`; the workspace is `root/<sub>` (a subdirectory when `sub` is set). */
async function fixture(sub, fn, history = fileHistory) {
  const root = await mkdtemp(join(tmpdir(), 'hato-history-'));
  const cwd = sub ? join(root, sub) : root;
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const commit = (message, date) => git('commit', '-q', '-m', message, `--date=${date}`);
  const docs = [];
  const ctx = { host: { ui: { documentOpen: async (_id, text) => { docs.push(text); return `doc${docs.length}`; } }, resources: { release: async () => {} } } };
  const api = history({
    desc: async () => ({ id: 'ws', rootAbsolutePath: cwd }),
    git: async (_ctx, _d, args, limit = 4 * 1024 * 1024) => {
      try { const out = execFileSync('git', ['--literal-pathspecs', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 }); return { code: 0, stdout: out.slice(0, limit), stderr: '', truncated: out.length > limit }; }
      catch (e) { return { code: e.status, stdout: e.stdout || '', stderr: e.stderr || '', truncated: false }; }
    },
    fail: (r, what) => { throw new Error(`${what}: ${r.stderr}`); },
    cleanRel: p => { if (!p || p.startsWith('/') || p.split('/').includes('..')) throw Error('path'); return p; },
  });
  try {
    git('init', '-q', '-b', 'main'); git('config', 'user.email', 'ada@example.com'); git('config', 'user.name', 'Ada');
    await mkdir(cwd, { recursive: true });
    await fn({ root, cwd, git, commit, ctx, api, docs });
  } finally { await rm(root, { recursive: true, force: true }); }
}
const lines = n => Array.from({ length: n }, (_, i) => `line ${i + 1}`);

test('file history follows renames inside a workspace subdirectory and diffs both paths', async () => fixture('app', async ({ cwd, git, commit, ctx, api, docs }) => {
  await writeFile(join(cwd, 'old.txt'), lines(5).join('\n') + '\n'); git('add', '.'); commit('create', '2024-01-01T10:00:00Z');
  await writeFile(join(cwd, 'other.txt'), 'x\n'); git('add', '.'); commit('unrelated', '2024-01-02T10:00:00Z');
  git('mv', 'app/old.txt', 'app/new.txt'); commit('rename', '2024-01-03T10:00:00Z');
  await writeFile(join(cwd, 'new.txt'), ['changed', ...lines(5).slice(1)].join('\n') + '\n'); git('add', '.'); commit('edit', '2024-01-04T10:00:00Z');

  const r = await api.fileHistory(ctx, { workspaceId: 'ws', path: 'new.txt' });
  assert.deepEqual(r.commits.map(c => c.subject), ['edit', 'rename', 'create']);
  assert.equal(r.commits[0].author, 'Ada'); assert.equal(r.commits[0].email, 'ada@example.com');
  assert.equal(Date.parse(r.commits[0].date), Date.parse('2024-01-04T10:00:00Z'));
  assert.equal(r.commits[1].path, 'app/new.txt'); assert.equal(r.commits[1].previousPath, 'app/old.txt');
  assert.equal(r.commits[2].path, 'app/old.txt'); assert.equal(r.more, false);
  assert.match(r.head, /^[0-9a-f]{40}$/);

  const rename = r.commits[1];
  await api.fileCommitDiff(ctx, { workspaceId: 'ws', id: rename.id, repoPath: rename.path, previousPath: rename.previousPath });
  assert.match(docs.at(-1), /rename from app\/old\.txt/);
  const created = r.commits[2];
  await api.fileCommitDiff(ctx, { workspaceId: 'ws', id: created.id, repoPath: created.path });
  assert.match(docs.at(-1), /new file mode[\s\S]*\+line 5/);
}));

test('selection history traces only commits touching the lines, pinned and paged', async () => fixture('', async ({ cwd, git, commit, ctx, api, docs }) => {
  const text = lines(60);
  await writeFile(join(cwd, 'f.txt'), text.join('\n') + '\n'); git('add', '.'); commit('create', '2024-01-01T10:00:00Z');
  for (let i = 0; i < 45; i++) { text[9] = `edit ${i}`; await writeFile(join(cwd, 'f.txt'), text.join('\n') + '\n'); git('add', '.'); commit(`touch line 10 #${i}`, `2024-02-01T10:${String(i).padStart(2, '0')}:00Z`); }
  text[49] = 'far away'; await writeFile(join(cwd, 'f.txt'), text.join('\n') + '\n'); git('add', '.'); commit('touch line 50', '2024-03-01T10:00:00Z');

  const first = await api.fileHistory(ctx, { workspaceId: 'ws', path: 'f.txt', startLine: 8, endLine: 10 });
  assert.equal(first.commits.length, 40); assert.equal(first.more, true);
  assert.equal(first.commits[0].subject, 'touch line 10 #44');
  assert.ok(!first.commits.some(c => c.subject === 'touch line 50'));

  // A commit landing between pages does not shift the pinned paging.
  text[9] = 'newer'; await writeFile(join(cwd, 'f.txt'), text.join('\n') + '\n'); git('add', '.'); commit('newer', '2024-04-01T10:00:00Z');
  const second = await api.fileHistory(ctx, { workspaceId: 'ws', path: 'f.txt', startLine: 8, endLine: 10, head: first.head, skip: 40 });
  assert.deepEqual(second.commits.map(c => c.subject), ['touch line 10 #4', 'touch line 10 #3', 'touch line 10 #2', 'touch line 10 #1', 'touch line 10 #0', 'create']);
  assert.equal(second.more, false);

  const c = first.commits[0];
  await api.fileCommitDiff(ctx, { workspaceId: 'ws', id: c.id, path: 'f.txt', head: first.head, startLine: 8, endLine: 10, index: 0 });
  assert.match(docs.at(-1), /-edit 43\n\+edit 44/);
  assert.doesNotMatch(docs.at(-1), /far away/);
}));

test('selection diff re-traces from the pinned head when its patch is not cached', async () => {
  const { fileHistory: reloaded } = await load('../modules/services/git/src/file-history.ts', '\n// reloaded');
  await fixture('', async ({ cwd, git, commit, ctx, api, docs }) => {
    const text = lines(20);
    await writeFile(join(cwd, 'f.txt'), text.join('\n') + '\n'); git('add', '.'); commit('create', '2024-01-01T10:00:00Z');
    for (const word of ['one', 'two', 'three']) { text[4] = word; await writeFile(join(cwd, 'f.txt'), text.join('\n') + '\n'); git('add', '.'); commit(word, '2024-01-02T10:00:00Z'); }
    const head = git('rev-parse', 'HEAD').trim();
    const two = git('rev-parse', 'HEAD~1').trim();
    await api.fileCommitDiff(ctx, { workspaceId: 'ws', id: two, path: 'f.txt', head, startLine: 4, endLine: 4, index: 1 });
    assert.match(docs.at(-1), /-one\n\+two/);
    // A stale index (the list no longer matches the trace) is reported, not shown as another commit.
    const one = git('rev-parse', 'HEAD~2').trim();
    await assert.rejects(api.fileCommitDiff(ctx, { workspaceId: 'ws', id: one, path: 'f.txt', head, startLine: 4, endLine: 4, index: 0 }), /History changed/);
  }, reloaded);
});

test('untracked files report no history; invalid input is rejected', async () => fixture('', async ({ cwd, git, commit, ctx, api }) => {
  await writeFile(join(cwd, 'a.txt'), 'a\n'); git('add', '.'); commit('create', '2024-01-01T10:00:00Z');
  await writeFile(join(cwd, 'new.txt'), 'n\n');
  const r = await api.fileHistory(ctx, { workspaceId: 'ws', path: 'new.txt' });
  assert.equal(r.untracked, true); assert.deepEqual(r.commits, []);
  await assert.rejects(api.fileHistory(ctx, { workspaceId: 'ws', path: '../x' }), /path/);
  await assert.rejects(api.fileHistory(ctx, { workspaceId: 'ws', path: 'a.txt', startLine: 3, endLine: 1 }), /line range/);
  await assert.rejects(api.fileCommitDiff(ctx, { workspaceId: 'ws', id: 'HEAD', repoPath: 'a.txt' }), /commit ID/);
}));

test('selected editor lines map to committed lines across uncommitted edits', () => {
  const committed = ['a', 'b', 'c', 'd', 'e', ''].join('\n');
  // Two lines inserted at the top shift everything down by two.
  assert.deepEqual(mapToCommitted(committed, ['x', 'y', 'a', 'b', 'c', 'd', 'e', ''].join('\n'), 3, 4), [1, 2]);
  // Only newly added lines selected: nothing to trace.
  assert.equal(mapToCommitted(committed, ['x', 'y', 'a', 'b', 'c', 'd', 'e', ''].join('\n'), 0, 1), null);
  // A replaced line inside the selection keeps its committed counterpart.
  assert.deepEqual(mapToCommitted(committed, ['a', 'B', 'c', 'd', 'e', ''].join('\n'), 1, 1), [1, 1]);
  // Unchanged file maps one to one; the range is clamped to the committed file.
  assert.deepEqual(mapToCommitted(committed, committed, 0, 4), [0, 4]);
  assert.deepEqual(mapToCommitted(committed, committed, 4, 5), [4, 4]);
});
