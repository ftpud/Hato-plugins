// ../sdk/usage-limits.ts
var clean = (s) => s.replace(/\\([\\`*_[\]<>|])/g, "$1").replace(/\*\*/g, "").trim();
var slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "limit";
function parseClaudeUsage(markdown) {
  const windows = [];
  for (const line of markdown.split("\n")) {
    const m = /^\*\*(.+?)\*\*\s+—\s+\*\*(\d+(?:\.\d+)?)%\*\*(?:\s+·\s+Resets\s+(.+))?\s*$/.exec(line.trim());
    if (!m) continue;
    const label = clean(m[1]);
    windows.push({ id: claudeWindowId(label), label: shortLabel(label), usedPercent: Number(m[2]), resetsAt: parseDate(m[3]), resetsText: m[3] ? clean(m[3]) : null });
  }
  const plan = /^>\s*(Claude .+ subscription usage)\s*$/m.exec(markdown);
  return { windows, plan: plan ? clean(plan[1]).replace(/ usage$/, "") : null };
}
function claudeWindowId(label) {
  const l = label.toLowerCase();
  if (l.startsWith("5-hour")) return "five_hour";
  if (l === "weekly · all models") return "seven_day";
  return slug(label);
}
function shortLabel(label) {
  return label.replace(/^5-hour limit$/i, "5h").replace(/^Weekly · all models$/i, "Wk").replace(/^Weekly · /i, "Wk · ");
}
function parseDate(text) {
  if (!text) return null;
  const t = Date.parse(clean(text).replace(/\s+[A-Z]{2,5}$/, ""));
  return Number.isFinite(t) ? t : null;
}
function applyClaudeRateLimit(prev, info, now = Date.now()) {
  if (!info || typeof info !== "object" || typeof info.utilization !== "number" || !Number.isFinite(info.utilization)) return prev;
  const type = typeof info.rateLimitType === "string" ? info.rateLimitType : "five_hour";
  const labels = { five_hour: "5h", seven_day: "Wk", seven_day_opus: "Wk · Opus", seven_day_sonnet: "Wk · Sonnet", overage: "Extra usage" };
  const win = {
    id: type,
    label: labels[type] || type.replace(/_/g, " "),
    usedPercent: Math.round(info.utilization * 1e3) / 10,
    resetsAt: typeof info.resetsAt === "number" && info.resetsAt > 0 ? info.resetsAt * 1e3 : null,
    resetsText: null
  };
  const windows = [...(prev?.windows || []).filter((w) => w.id !== win.id), win];
  const order = ["five_hour", "seven_day"];
  windows.sort((a, b) => (order.indexOf(a.id) + 1 || 99) - (order.indexOf(b.id) + 1 || 99));
  return { provider: "claude", windows, plan: prev?.plan ?? null, updatedAt: now, source: "session", error: null };
}

// modules/services/claude-provider/src/index.ts
var index_default = {
  id: "claude-provider",
  moduleApiVersion: 1,
  methods: {
    parseLimits(_ctx, a) {
      const parsed = parseClaudeUsage(a.text);
      let result = { provider: "claude", ...parsed, updatedAt: Date.now(), source: "probe", error: null };
      const rate = a.updates?.map((u) => u?._meta?.["_claude/rateLimit"]).filter(Boolean).pop();
      if (!result.windows.length && rate) result = { ...applyClaudeRateLimit(null, rate), source: "probe" };
      return result;
    },
    sessionLimits(_ctx, a) {
      const rate = a.update?._meta?.["_claude/rateLimit"];
      return rate ? applyClaudeRateLimit(a.previous, rate) : null;
    }
  }
};
export {
  index_default as default
};
