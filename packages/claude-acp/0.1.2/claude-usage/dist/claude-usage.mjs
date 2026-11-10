// ../sdk/settings-order.ts
var SPACER_PREFIX = "@spacer:";
function parseOrder(value, allowed, allowSpacers = false) {
  if (typeof value !== "string") throw new Error("Invalid item order");
  const items = JSON.parse(value);
  if (!Array.isArray(items) || items.length > allowed.length + 24) throw new Error("Invalid item order");
  const seen = /* @__PURE__ */ new Set();
  let gaps = 0;
  for (const item of items) {
    if (typeof item !== "string" || seen.has(item)) throw new Error("Duplicate or invalid item");
    seen.add(item);
    if (!allowed.includes(item) && !(allowSpacers && item.startsWith(SPACER_PREFIX) && /^@spacer:[a-zA-Z0-9_-]{1,80}$/.test(item) && ++gaps <= 24)) throw new Error("Unknown item");
  }
  if (!allowed.every((id) => seen.has(id))) throw new Error("Order must retain all current items");
  return items;
}

// ../sdk/settings.ts
function exportSettings(ctx, getSections, onChange, options = {}) {
  const publish = (error = null) => {
    const value = { sections: getSections(), error, ...options.reset ? { resetLabel: options.reset.label } : {} };
    ctx.state.set(`${ctx.moduleId}.settings`, value);
  };
  let queue = Promise.resolve();
  ctx.events.on("settings.change", (edit) => {
    if (edit?.module !== ctx.moduleId) return;
    queue = queue.then(async () => {
      try {
        const section = getSections().find((s) => s.key === edit.section);
        const field = section?.fields.find((f) => f.key === edit.key);
        if (!field) throw new Error("Setting is no longer available");
        if (field.type === "order") parseOrder(edit.value, field.items.map((i) => i.id), field.allowSpacers);
        else if (field.type === "toggle" ? typeof edit.value !== "boolean" : typeof edit.value !== "string" || !field.options.some((o) => o.value === edit.value)) {
          throw new Error("Invalid setting value");
        }
        await onChange(section.key, field.key, edit.value);
        publish();
      } catch (e) {
        publish(e instanceof Error ? e.message : String(e));
      }
      if (options.invalidate !== false) ctx.ui.invalidate();
    });
  });
  if (options.reset) ctx.events.on("settings.reset", (event) => {
    if (event?.module !== ctx.moduleId || !options.reset) return;
    queue = queue.then(async () => {
      try {
        await options.reset.run();
        publish();
      } catch (e) {
        publish(e instanceof Error ? e.message : String(e));
      }
      if (options.invalidate !== false) ctx.ui.invalidate();
    });
  });
  publish();
  return publish;
}

// ../sdk/usage-limits.ts
function resetText(w, now = Date.now()) {
  if (w.resetsAt) {
    const mins = Math.max(0, Math.round((w.resetsAt - now) / 6e4));
    if (mins < 60) return `resets in ${mins} min`;
    if (mins < 48 * 60) return `resets in ${Math.floor(mins / 60)} h ${mins % 60} min`;
    return `resets in ${Math.round(mins / 1440)} days`;
  }
  return w.resetsText ? `resets ${w.resetsText}` : "";
}

// ../sdk/usage-meter.ts
var INTERVALS = [
  { value: "0", label: "Manual only" },
  { value: "5", label: "Every 5 minutes" },
  { value: "15", label: "Every 15 minutes" },
  { value: "30", label: "Every 30 minutes" },
  { value: "60", label: "Every hour" }
];
var BAR_WIDTH = 28;
function usageMeter(id, provider, title, options = { command: "/usage" }) {
  let snap = null;
  let ws = null;
  let minutes = "15";
  let show = "left";
  let timer = null;
  let error = null;
  const refresh = async (ctx, force) => {
    if (!ws?.id) return;
    const maxAgeMs = force ? 0 : Math.max(1, Number(minutes) || 15) * 6e4;
    try {
      error = null;
      const r = await ctx.modules.call("acp", "limits", { provider, workspaceId: ws.id, force, maxAgeMs }, { timeoutMs: 3e5 });
      if (r) snap = r;
    } catch (e) {
      error = e?.message || String(e);
    }
    ctx.ui.invalidate();
  };
  const schedule = (ctx) => {
    if (timer) clearTimeout(timer);
    timer = null;
    const m = Number(minutes);
    if (m > 0) timer = setTimeout(() => {
      void refresh(ctx, false).finally(() => schedule(ctx));
    }, m * 6e4);
  };
  const levelColor = (left) => left <= 10 ? "danger" : left <= 30 ? "warning" : "success";
  const meter = (w) => {
    const left = Math.max(0, Math.min(100, 100 - w.usedPercent));
    const shown = show === "left" ? left : Math.min(100, w.usedPercent);
    const fill = Math.round(BAR_WIDTH * left / 100);
    return { type: "row", key: `w-${w.id}`, gap: 4, align: "center", style: { noShrink: true }, children: [
      { type: "label", key: "n", text: w.label, size: "xs", color: "muted" },
      { type: "row", key: "track", width: BAR_WIDTH, height: 6, style: { background: "border", radius: 3, width: BAR_WIDTH, height: 6, noShrink: true }, children: fill > 0 ? [
        { type: "column", key: "fill", width: fill, height: 6, style: { background: levelColor(left), radius: 3, width: fill, height: 6 }, children: [] }
      ] : [] },
      { type: "label", key: "v", text: `${Math.round(shown)}%`, size: "xs", mono: true, color: left <= 10 ? "danger" : "default" }
    ] };
  };
  const tooltip = () => {
    const lines = [`${title} plan usage (${show === "left" ? "remaining" : "used"})`];
    if (snap?.plan) lines.push(snap.plan);
    for (const w of snap?.windows || []) lines.push(`${w.label}: ${Math.round(Math.max(0, 100 - w.usedPercent))}% left · ${Math.round(w.usedPercent)}% used${resetText(w) ? ` · ${resetText(w)}` : ""}`);
    if (snap?.error || error) lines.push(`⚠ ${snap?.error || error}`);
    if (snap?.updatedAt) lines.push(`Updated ${new Date(snap.updatedAt).toLocaleTimeString()} (${snap.source === "session" ? "live session" : "usage check"})`);
    lines.push(snap?.loading ? "Checking…" : "Click to refresh");
    return lines.join("\n");
  };
  return {
    id,
    moduleApiVersion: 1,
    async activate(ctx) {
      const savedMinutes = await ctx.modules.call("persistence", "settings.get", { key: `${id}.refreshMinutes` });
      minutes = INTERVALS.some((o) => o.value === String(savedMinutes)) ? String(savedMinutes) : "15";
      const savedShow = await ctx.modules.call("persistence", "settings.get", { key: `${id}.show` });
      show = savedShow === "used" ? "used" : "left";
      exportSettings(ctx, () => [{ key: id, title: `${title} usage meter`, group: "Agents", fields: [
        {
          key: "refreshMinutes",
          label: "Refresh",
          type: "select",
          value: minutes,
          options: INTERVALS,
          description: `Checks run the adapter's local ${options.command} command in a short hidden ACP session; no model request is made.${options.liveHint ? " " + options.liveHint : ""}`
        },
        { key: "show", label: "Show", type: "select", value: show, options: [{ value: "left", label: "Remaining" }, { value: "used", label: "Used" }] }
      ] }], async (_s, key, value) => {
        await ctx.modules.call("persistence", "settings.set", { key: `${id}.${key}`, value });
        if (key === "refreshMinutes") {
          minutes = String(value);
          schedule(ctx);
        } else show = value === "used" ? "used" : "left";
      });
      snap = ctx.state.get("acp.limits")?.[provider] || null;
      ctx.state.watch("acp.limits", (v) => {
        snap = v?.[provider] || null;
        ctx.ui.invalidate();
      });
      ws = ctx.state.get("workspace.selected") || null;
      ctx.state.watch("workspace.selected", (v) => {
        const first = !ws?.id && v?.id;
        ws = v;
        if (first && Number(minutes) > 0) void refresh(ctx, false);
      });
      if (Number(minutes) > 0) void refresh(ctx, false);
      schedule(ctx);
    },
    deactivate() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
    render() {
      const windows = (snap?.windows || []).slice(0, 2);
      const problem = !windows.length && (snap?.error || error);
      return { type: "row", key: "meter", gap: 8, align: "center", tooltip: tooltip(), style: { wrap: false }, children: [
        { type: "button", key: "name", text: title, action: "refresh", small: true, variant: "ghost", height: 22, tooltip: tooltip(), disabled: !ws?.id },
        ...snap?.loading && !windows.length ? [{ type: "label", key: "busy", text: "…", size: "xs", color: "muted" }] : problem ? [{ type: "label", key: "na", text: "n/a", size: "xs", color: "muted", tooltip: tooltip() }] : !windows.length ? [{ type: "label", key: "none", text: ws?.id ? "—" : "no workspace", size: "xs", color: "muted" }] : windows.map(meter)
      ] };
    },
    async onEvent(ctx, ev) {
      if (ev.action === "refresh") await refresh(ctx, true);
    }
  };
}

// modules/ui/claude-usage/src/index.ts
var index_default = usageMeter("claude-usage", "claude", "Claude", { command: "/usage", liveHint: "Live Claude chats also update the meter." });
export {
  index_default as default
};
