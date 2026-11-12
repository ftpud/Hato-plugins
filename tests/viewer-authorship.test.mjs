import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const sdk = new URL('../../sdk', import.meta.url).pathname;
const load = async path => import('data:text/javascript;base64,' + Buffer.from((await build({ entryPoints: [new URL(path, import.meta.url).pathname], bundle: true, format: 'esm', write: false, alias: { '@hato/sdk': sdk } })).outputFiles[0].text).toString('base64'));
const { javaDeclarations } = await load('../modules/ui/viewer/src/declarations.ts');
const { parseBlame, blame } = await load('../modules/services/git/src/blame.ts');
const authorship = await load('../modules/ui/viewer/src/authorship.ts');

const JAVA = `package a;

/** Doc with { braces } and "quotes". */
@Entity
public class Order extends Base<Item> implements Serializable {
  private final List<String> names = new ArrayList<>();
  private Runnable task = () -> { run(); };
  static { init(); }

  public Order(String id) {
    this.id = id;
  }

  @Override
  public <T> List<T> items(Map<String, T> byId, int[] counts)
      throws IOException, InterruptedException {
    if (byId.isEmpty()) { return List.of(); }
    String s = "not a method() {";
    new Thread(new Runnable() {
      public void run() { }
    }).start();
    return null;
  }

  interface Listener {
    void changed(Order order);
    default String name() { return "x"; }
  }

  enum State { OPEN { void close() { } }, CLOSED; abstract void x(); }

  record Point(int x, int y) { Point { } }
}
`;

test('Java scanner finds types and methods with their line ranges, skipping blocks, lambdas and anonymous classes', () => {
  const found = javaDeclarations(JAVA).map(d => `${d.kind} ${d.name} ${d.line + 1} ${d.start + 1}-${d.end + 1}`);
  assert.deepEqual(found, [
    'type Order 5 4-33',
    'method Order 10 10-12',
    'method items 15 14-23',
    'type Listener 25 25-28',
    'method changed 26 26-26',
    'method name 27 27-27',
    'type State 30 30-30',
    'method x 30 30-30',
    'type Point 32 32-32',
  ]);
});

test('porcelain blame maps lines to commits and uncommitted lines to -1', () => {
  const sha = 'a'.repeat(40), zero = '0'.repeat(40);
  const out = [`${sha} 1 1 2`, 'author Ada', 'author-mail <ada@x>', 'author-time 1700000000', 'summary first', 'filename f', '\tx', `${sha} 2 2`, '\ty',
    `${zero} 3 3 1`, 'author Not Committed Yet', 'author-time 0', 'summary none', 'filename f', '\tz'].join('\n');
  const r = parseBlame(out);
  assert.deepEqual(r.lines, [0, 0, -1]);
  assert.deepEqual(r.commits[0], { id: sha, author: 'Ada', email: 'ada@x', time: 1700000000, summary: 'first' });
});

test('declarations show their newest author, other authors and uncommitted edits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hato-blame-'));
  const git = (args, env = {}) => execFileSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    git(['init', '-q', '-b', 'main']);
    const as = (name, date) => ({ GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: `${name}@x`, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: `${name}@x`, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
    const v1 = 'class A {\n  void one() {\n    a();\n  }\n  void two() {\n    b();\n  }\n}\n';
    await writeFile(join(root, 'A.java'), v1); git(['add', '.']); git(['commit', '-q', '-m', 'one'], as('Ada', '2020-01-01T00:00:00Z'));
    const v2 = v1.replace('b();', 'c();');
    await writeFile(join(root, 'A.java'), v2); git(['add', '.']); git(['commit', '-q', '-m', 'two'], as('Bob', '2021-01-01T00:00:00Z'));

    const service = blame({
      desc: async () => ({ id: 'ws', rootAbsolutePath: root }),
      git: async (_c, _d, args, _l, stdin) => { try { return { code: 0, stdout: execFileSync('git', args, { cwd: root, encoding: 'utf8', input: stdin, stdio: ['pipe', 'pipe', 'pipe'] }), stderr: '', truncated: false }; } catch (e) { return { code: e.status, stdout: '', stderr: e.stderr, truncated: false }; } },
      fail: (r, w) => { throw new Error(`${w}: ${r.stderr}`); }, cleanRel: p => p,
    });
    const ctx = { modules: { call: async (_m, method, a) => service[method](ctx, a) }, log: { warn() {} } };
    assert.equal(await authorship.refreshBlame(ctx, 'ws', 'A.java', v2), true);
    const shown = text => authorship.declarationAnnotations('ws', 'A.java', 'java', text).map(a => `${a.line}: ${a.text.replace(/\d+ years? ago/, 'N years ago')}`);
    assert.deepEqual(shown(v2), ['0: Bob +1, N years ago', '1: Ada, N years ago', '4: Bob +1, N years ago']);
    // Typing inside one() (not yet blamed again) marks only it and its class as uncommitted.
    const edited = v2.replace('a();', 'a(); d();');
    assert.deepEqual(shown(edited), ['0: Uncommitted changes', '1: Uncommitted changes', '4: Bob +1, N years ago']);
    // Lines inserted above shift the annotations with the code.
    assert.deepEqual(shown('// header\n' + v2), ['1: Bob +1, N years ago', '2: Ada, N years ago', '5: Bob +1, N years ago']);
    assert.deepEqual(authorship.declarationAnnotations('ws', 'A.java', 'typescript', v2), []);
    // Untracked files get no annotations.
    await writeFile(join(root, 'B.java'), 'class B {}\n');
    await authorship.refreshBlame(ctx, 'ws', 'B.java', 'class B {}\n');
    assert.deepEqual(authorship.declarationAnnotations('ws', 'B.java', 'java', 'class B {}\n'), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
