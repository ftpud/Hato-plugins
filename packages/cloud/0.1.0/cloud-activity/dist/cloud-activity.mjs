// modules/services/cloud-activity/src/map.ts
var MAX_FINISHED = 100;
var SAFE = /[^\p{L}\p{N} ._\-·:()/#+&]/gu;
function clean(value, max) {
  if (typeof value !== "string") return null;
  const text = value.replace(SAFE, "").replace(/\s+/g, " ").trim().slice(0, max);
  return text || null;
}
function stateOf(status, previous) {
  switch (status) {
    case "starting":
      return { state: "running", worked: false };
    case "busy":
      return { state: "running", worked: true };
    case "waiting":
      return { state: "attention", worked: true };
    case "error":
      return { state: "failed", worked: false };
    case "stopped":
    case "interrupted":
      return { state: "cancelled", worked: false };
    case "ready":
    default:
      return { state: "completed", worked: previous?.worked ?? false };
  }
}
function activityItems(sessions, remembered2, now) {
  const items = [];
  const seen = /* @__PURE__ */ new Set();
  for (const session of sessions) {
    if (!session || typeof session.id !== "string") continue;
    const id = session.id.slice(0, 120);
    seen.add(id);
    const previous = remembered2.get(id);
    const status = session.status === "ready" && session.error ? "error" : session.status;
    const { state, worked } = stateOf(status, previous);
    if (status === "ready" && !worked) continue;
    const at = state === previous?.state ? previous.at : session.updatedAt ?? now;
    remembered2.set(id, { state, worked, at });
    items.push({
      id,
      kind: session.workflow ? "workflow" : "agent",
      title: clean(session.name, 120) ?? "Agent",
      state,
      detail: state === "attention" ? "Waiting for you" : state === "failed" ? "Stopped with an error" : null,
      source: clean(session.profile?.label ?? session.profile?.name ?? session.profile?.provider, 40),
      startedAt: session.createdAt ?? at,
      updatedAt: at
    });
  }
  for (const id of [...remembered2.keys()]) if (!seen.has(id)) remembered2.delete(id);
  const live = items.filter((item) => item.state === "running" || item.state === "attention");
  const finished = items.filter((item) => item.state !== "running" && item.state !== "attention").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, MAX_FINISHED);
  return [...live, ...finished];
}

// modules/services/cloud-activity/src/index.ts
var remembered = /* @__PURE__ */ new Map();
var mod = {
  id: "cloud-activity",
  moduleApiVersion: 1,
  async activate() {
  },
  methods: {
    /** `{ items }` — current agent sessions plus recently finished ones (bounded). */
    async snapshot(ctx) {
      const sessions = await ctx.modules.call("agent-runner", "list", {}, { timeoutMs: 1e4 });
      return { items: activityItems(sessions, remembered, (/* @__PURE__ */ new Date()).toISOString()) };
    }
  }
};
var index_default = mod;
export {
  index_default as default
};
