import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../modules/services/files/src/change-capture.ts", import.meta.url))],
  bundle: true, format: "esm", write: false,
  alias: { "@hato/sdk": fileURLToPath(new URL("../../sdk", import.meta.url)) },
});
const { ChangeCapture } = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
function fixture(git = true) {
  const disk = new Map([["a.txt", "before\n"]]), settings = new Map(), state = new Map(), handlers = new Map();
  const ctx = {
    moduleId: "files", ui: { invalidate() {} }, log: { warn() {} },
    state: { set: (key, value) => state.set(key, structuredClone(value)), get: key => state.get(key) },
    events: { on: (name, fn) => handlers.set(name, fn), emit() {} },
    modules: { async call(_module, method, args) {
      if (method === "settings.get") return structuredClone(settings.get(args.key) ?? null);
      if (method === "settings.set") settings.set(args.key, structuredClone(args.value));
    } },
    host: {
      capabilities: { request: async () => ({ grant: "test" }) },
      process: { run: async () => ({ code: git ? 0 : 128, stdout: [...disk.keys()].join("\0"), truncated: false }) },
      fs: {
        list: async () => ({ entries: [...disk.keys()].map(name => ({ name, kind: "file", symlink: false })) }),
        stat: async (_grant, path) => ({ kind: "file", size: disk.get(path).length, mtime: 1 }),
        read: async (_grant, path) => ({ text: disk.get(path), binary: false, truncated: false }),
      },
    },
  };
  return { disk, settings, state, handlers, capture: new ChangeCapture(ctx) };
}
for (const git of [true, false]) test(`captures shell edits, new files, deletes and restores with Git=${git}`, async () => {
  const f = fixture(git);
  await f.capture.activate();
  await f.capture.select({ id: "w", location: "local", machineId: "local", rootAbsolutePath: "/capture-test" });
  try {
    assert.equal(f.state.get("files.changeCapture").records.length, 0);
    // Same size and mtime, so checking metadata alone would miss this edit.
    f.disk.set("a.txt", "AFTER!\n");
    f.disk.set("new.txt", "created\n");
    await f.capture.scan();
    let records = f.state.get("files.changeCapture").records;
    assert.equal(records.length, 1);
    assert.equal(records[0].diffs.length, 2);
    assert.ok(records[0].diffs.some(d => d.newFile));
    f.disk.delete("a.txt");
    await f.capture.scan();
    records = f.state.get("files.changeCapture").records;
    assert.equal(records.length, 2);
    assert.ok(records[1].diffs[0].lines.includes("-AFTER!"));
    const count = records.length;
    await f.capture.scan();
    assert.equal(f.state.get("files.changeCapture").records.length, count);
    await f.capture.select({ id: "w", location: "local", machineId: "local", rootAbsolutePath: "/capture-test" });
    assert.equal(f.state.get("files.changeCapture").records.length, count);
  } finally { await f.capture.stop(); }
});
test("disable stops capture and retention removes expired records across projects", async () => {
  const f = fixture();
  f.settings.set("changes.projects", ["closed"]);
  f.settings.set("changes.history.closed", [{ id: "old", at: 0, diffs: [] }]);
  await f.capture.activate();
  await f.capture.select({ id: "w", location: "local", machineId: "local", rootAbsolutePath: "/capture-test" });
  try {
    await f.capture.change("enabled", false);
    // exportSettings queues edits.
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(f.state.get("files.changesEnabled"), false);
    assert.deepEqual(f.settings.get("changes.history.closed"), []);
    f.disk.set("a.txt", "changed");
    await f.capture.scan();
    assert.equal(f.state.get("files.changeCapture").records.length, 0);
  } finally { await f.capture.stop(); }
});
test("captured changes keep a single prompt owner and remain unassigned for concurrent agents", async () => {
  const f = fixture();
  await f.capture.activate();
  await f.capture.select({ id: "w", location: "local", machineId: "local", rootAbsolutePath: "/capture-test" });
  try {
    f.handlers.get("ai-sessions.capturePrompt")({ workspaceId: "w", sessionId: "one", source: "chat", prompt: "Edit it", key: "prompt-one" });
    f.disk.set("a.txt", "one\n");
    await f.capture.scan();
    assert.equal(f.state.get("files.changeCapture").records[0].owner.key, "prompt-one");
    f.handlers.get("persistent-agents.capturePrompt")({ workspaceId: "w", sessionId: "two", source: "agent", prompt: "Other edit", key: "prompt-two" });
    f.disk.set("a.txt", "two\n");
    await f.capture.scan();
    assert.equal(f.state.get("files.changeCapture").records[1].owner, undefined);
  } finally { await f.capture.stop(); }
});
test("retention enforces its size cap and clear deletes saved capture history", async () => {
  const f = fixture();
  await f.capture.activate();
  try {
    const recent = Date.now();
    const huge = { id: "large", at: recent, diffs: [{ path: "a", lines: ["+".repeat(2_000_000)] }] };
    f.settings.set("changes.projects", ["closed"]);
    f.settings.set("changes.history.closed", [huge, { id: "small", at: recent, diffs: [] }]);
    await f.capture.change("megabytes", "5");
    assert.deepEqual(f.settings.get("changes.history.closed").map(r => r.id), ["small"]);
    await f.capture.clear();
    assert.deepEqual(f.settings.get("changes.history.closed"), []);
  } finally { await f.capture.stop(); }
});

test("capture merges edits into one prompt and supplies inline chat cards", async () => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("../../sdk/change-capture.ts", import.meta.url))],
    bundle: true, format: "esm", write: false,
  });
  const sdk = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64"));
  const owner = { source: "chat", sessionId: "chat", key: "user", prompt: "Edit it" };
  const diff = { path: "/w/a", added: 1, removed: 1, lines: ["@@ -1 +1 @@", "-a", "+b"] };
  const records = [{ id: "one", at: 1, owner, diffs: [diff] }, { id: "two", at: 2, owner, diffs: [diff] }];
  const entries = sdk.capturedEntries(records);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].files[0].edits.length, 2);
  const messages = sdk.capturedTranscript([{ key: "user", role: "user", text: "Edit it" },
    { key: "tool", role: "tool", text: "", diffs: [diff] }], records, "chat", "chat");
  assert.equal(messages.filter(m => m.diffs?.length).length, 2);
  assert.equal(messages.at(-1).key, "capture:two");
});

test("captured shell edits stay beside their tool call before later replies", async () => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("../../sdk/change-capture.ts", import.meta.url))],
    bundle: true, format: "esm", write: false,
  });
  const sdk = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64"));
  const records = [{ id: "edit", at: 20, owner: { source: "chat", sessionId: "c", key: "u", prompt: "Edit" },
    diffs: [{ path: "/w/a", added: 1, removed: 0, lines: ["+new"] }] }];
  const messages = [
    { key: "u", role: "user", text: "Edit" },
    { key: "shell", role: "tool", text: "python", at: 10 },
    { key: "reply", role: "assistant", text: "Done", at: 15 },
    { key: "later-tool", role: "tool", text: "other command", at: 30 },
    { key: "final", role: "assistant", text: "Finished", at: 40 },
  ];
  assert.deepEqual(sdk.capturedTranscript(messages, records, "chat", "c").map(m => m.key),
    ["u", "shell", "capture:edit", "reply", "later-tool", "final"]);
});
