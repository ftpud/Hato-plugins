// ../sdk/usage-limits.ts
var clean = (s) => s.replace(/\\([\\`*_[\]<>|])/g, "$1").replace(/\*\*/g, "").trim();
var slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "limit";
function parseCodexStatus(markdown) {
  const windows = [];
  for (const line of markdown.split("\n")) {
    const m = /^\*\*(.+?):\*\*\s+(\d+(?:\.\d+)?)% left(?:\s+\((?:resets\s+)?([^)]*)\))?/.exec(line.trim());
    if (!m) continue;
    const label = clean(m[1]);
    if (/spend limit/i.test(label)) continue;
    const short = label.replace(/^codex\s+/i, "").replace(/\s*limit$/i, "") || label;
    windows.push({ id: slug(label), label: /^(7d|weekly|week)$/i.test(short) ? "Wk" : short, usedPercent: Math.max(0, 100 - Number(m[2])), resetsAt: null, resetsText: m[3] ? clean(m[3]) : null });
  }
  const account = /^\*\*Account:\*\*\s+(.+)$/m.exec(markdown);
  return { windows, plan: account ? clean(account[1]).replace(/\s*\([^)]*@[^)]*\)\s*$/, "") : null };
}

// modules/services/codex-provider/src/index.ts
var index_default = {
  id: "codex-provider",
  moduleApiVersion: 1,
  methods: {
    parseLimits: (_ctx, a) => ({ provider: "codex", ...parseCodexStatus(a.text), updatedAt: Date.now(), source: "probe", error: null }),
    sessionLimits: () => null
  }
};
export {
  index_default as default
};
