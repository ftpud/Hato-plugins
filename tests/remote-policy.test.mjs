import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../modules/services/remote-runtime/src/policy.ts", import.meta.url))],
  bundle: true, format: "esm", write: false,
  alias: { "@hato/sdk": fileURLToPath(new URL("../../sdk", import.meta.url)) },
});
const policy = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));

test("invalid or missing policy values fall back to safe defaults", () => {
  assert.deepEqual(policy.normalizePolicy(null), policy.DEFAULT_POLICY);
  assert.deepEqual(policy.normalizePolicy({ plugins: "everything", allowed: ["a", "a", 3, ""], readOnly: "yes", idleTerminalMinutes: 7 }),
    { ...policy.DEFAULT_POLICY, allowed: ["a"] });
  const agents = policy.normalizePolicy({ autoPush: false, agents: { maxConcurrent: 2.5, maxTurnMinutes: -1, approvalCap: "root",
    deniedToolKinds: ["execute", "format-disk"], allowedProviders: ["claude", " claude "] } });
  assert.equal(agents.autoPush, false);
  assert.equal(agents.autoStart, null);
  assert.deepEqual(agents.agents, { maxConcurrent: 0, maxTurnMinutes: 0, approvalCap: "autopilot", deniedToolKinds: ["execute"], allowedProviders: ["claude"], allowedModels: [] });
});

test("allow list and read-only gate pushes, but never machine-setting sync", () => {
  const selected = policy.normalizePolicy({ plugins: "selected", allowed: ["agents"] });
  assert.equal(policy.pushBlocked(selected, "agents"), null);
  assert.match(policy.pushBlocked(selected, "workflows"), /not allowed/);
  const none = policy.normalizePolicy({ plugins: "none" });
  assert.match(policy.pushBlocked(none, "agents"), /not allowed/);
  const readOnly = policy.normalizePolicy({ readOnly: true });
  assert.match(policy.pushBlocked(readOnly, "agents"), /read-only/);
  for (const p of [none, readOnly]) assert.equal(policy.pushBlocked(p, "persistence"), null);
});

test("idle cleanup counts from the first detached sighting and resets on attach", () => {
  const seen = new Map(), min = 60_000;
  assert.deepEqual(policy.expiredTerminals([{ key: "a", attached: false }, { key: "b", attached: true }], seen, 0, 15), []);
  assert.deepEqual(policy.expiredTerminals([{ key: "a", attached: false }], seen, 14 * min, 15), []);
  assert.equal(seen.has("b"), false);
  // Reattached: the clock starts again.
  policy.expiredTerminals([{ key: "a", attached: true }], seen, 14 * min, 15);
  assert.deepEqual(policy.expiredTerminals([{ key: "a", attached: false }], seen, 20 * min, 15), []);
  assert.deepEqual(policy.expiredTerminals([{ key: "a", attached: false }], seen, 35 * min, 15), ["a"]);
  // Off: nothing expires.
  assert.deepEqual(policy.expiredTerminals([{ key: "a", attached: false }], seen, 999 * min, 0), []);
});

const sdk = await import("data:text/javascript;base64," + Buffer.from((await build({
  entryPoints: [fileURLToPath(new URL("../../sdk/persistent-agents.ts", import.meta.url))], bundle: true, format: "esm", write: false,
})).outputFiles[0].text).toString("base64"));

test("agent limits cap approval and refuse providers and models outside the allow lists", () => {
  const limits = sdk.normalizeAgentLimits({ approvalCap: "auto-low", allowedProviders: ["claude"], allowedModels: ["sonnet"] });
  assert.equal(sdk.cappedPolicy("autopilot", limits), "auto-low");
  assert.equal(sdk.cappedPolicy("ask", limits), "ask");
  assert.equal(sdk.agentRefusal(limits, "claude", "sonnet"), null);
  assert.equal(sdk.agentRefusal(limits, "claude", ""), null); // provider default, checked once the session reports it
  assert.match(sdk.agentRefusal(limits, "codex", "sonnet"), /Provider codex/);
  assert.match(sdk.agentRefusal(limits, "claude", "opus"), /Model opus/);
  assert.equal(sdk.agentRefusal(sdk.NO_AGENT_LIMITS, "anything", "any"), null);
});

test("Unlimited (the default) allows everything but keeps the saved limits and preferences", () => {
  const saved = policy.normalizePolicy({ plugins: "none", readOnly: true, autoPush: false, agents: { maxConcurrent: 1 },
    enforced: { maxProcesses: 4, fsRoots: ["/srv"], bogus: 1 } });
  assert.equal(saved.limited, false);
  assert.deepEqual(saved.enforced, { capabilityDeny: [], fsRoots: ["/srv"], maxProcesses: 4, maxTerminals: 0, processMemoryMb: 0 });
  const applied = policy.effectivePolicy(saved);
  assert.equal(policy.pushBlocked(applied, "agents"), null);
  assert.equal(applied.agents.maxConcurrent, 0);
  assert.equal(applied.autoPush, false);
  const limited = policy.effectivePolicy({ ...saved, limited: true });
  assert.match(policy.pushBlocked(limited, "agents"), /read-only/);
  assert.equal(limited.agents.maxConcurrent, 1);
});
