// ../sdk/sidebar-placement.ts
var SIDEBAR_POSITIONS = ["left-top", "left-bottom", "right-top", "right-bottom", "hidden"];
function normalizeSidebarButtons(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, p]) => SIDEBAR_POSITIONS.includes(p)));
}
function sidebarPosition(panel, choices) {
  const choice = choices[panel.id];
  return SIDEBAR_POSITIONS.includes(choice) ? choice : panel.activity ? `${panel.activity.side}-top` : "hidden";
}
function configurableSidebarPanels(c) {
  return Object.values(c.panels).sort((a, b) => (a.activity?.order ?? 100) - (b.activity?.order ?? 100) || a.id.localeCompare(b.id));
}
function sidebarPanels(c, choices, side) {
  return configurableSidebarPanels(c).filter((p) => sidebarPosition(p, choices).startsWith(`${side}-`));
}
function normalizeSidebarOrder(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter(([key, items]) => SIDEBAR_POSITIONS.includes(key) && key !== "hidden" && Array.isArray(items)).map(([key, items]) => [key, [...new Set(items.filter((i) => typeof i === "string" && i.length < 160))].slice(0, 512)]));
}
function orderedSidebarItems(c, choices, order, position) {
  const panels = configurableSidebarPanels(c).filter((p) => sidebarPosition(p, choices) === position).map((p) => p.id);
  const existing = (order[position] || []).filter((id) => panels.includes(id) || id.startsWith("@spacer:"));
  return [...existing, ...panels.filter((id) => !existing.includes(id))];
}

// ../sdk/sidebar-icons.ts
var outline = (paths) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
var sidebarIcons = {
  // Workspace
  projects: outline('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>'),
  // Navigator space
  files: outline('<path d="M13 10h7a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-3l-1.5-2H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1ZM13 21h7a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-3l-1.5-2H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1ZM3 3v13a2 2 0 0 0 2 2h4M3 5a2 2 0 0 0 2 2h4"/>'),
  git: outline('<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7v10M18 10c0 4-4 4-10 7.5"/>'),
  server: outline('<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01M11 6.5h6M11 17.5h6"/>'),
  // Editor space
  code: outline('<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>'),
  history: outline('<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5M12 7v5l3.5 2"/>'),
  workflow: outline('<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><path d="M9 6h6M18 9v6M6 9v6a3 3 0 0 0 3 3h6"/>'),
  // Assistant space
  ai: outline('<path d="M21 15a2 2 0 0 1-2 2H7l-5 5V4a2 2 0 0 1 2-2h15a2 2 0 0 1 2 2Z"/><path d="M8 9h8M8 13h5"/>'),
  bot: outline('<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4M10 4h4M2 14h2M20 14h2M9 13v2M15 13v2"/>'),
  plug: outline('<path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0V7ZM12 17v5"/>'),
  // Connectivity
  cloud: outline('<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>'),
  // Bottom dock
  terminal: outline('<path d="m4 17 6-6-6-6M12 19h8"/>'),
  // Kept for user plugins that reference the old name.
  remote: outline('<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01M11 6.5h6M11 17.5h6"/>')
};

// ../sdk/plugins.ts
var isObj = (x) => !!x && typeof x === "object" && !Array.isArray(x);
var isId = (x) => typeof x === "string" && /^[a-z0-9][a-z0-9._-]{0,47}$/i.test(x);
function collectContributions(plugins) {
  const out = { plugins, panels: {}, sidebars: [], overlays: [], barItems: [] };
  for (const p of plugins) {
    if (!p.enabled || !isObj(p.contributes)) continue;
    const c = p.contributes;
    for (const panel of Array.isArray(c.panels) ? c.panels : []) {
      if (!isObj(panel) || !isId(panel.id) || out.panels[panel.id]) continue;
      const module = isId(panel.module) ? panel.module : p.id;
      const dock = panel.dock === "bottom" ? "bottom" : isObj(panel.dock) && Number.isFinite(panel.dock.column) ? { column: Number(panel.dock.column), size: Number.isFinite(panel.dock.size) && panel.dock.size > 0 ? Number(panel.dock.size) : void 0 } : void 0;
      const activity = isObj(panel.activity) && (panel.activity.side === "left" || panel.activity.side === "right") ? {
        side: panel.activity.side,
        order: Number.isFinite(panel.activity.order) ? Number(panel.activity.order) : 100,
        icon: typeof panel.activity.icon === "string" ? panel.activity.icon : void 0,
        iconSvg: typeof panel.activity.iconSvg === "string" ? panel.activity.iconSvg : void 0,
        title: typeof panel.activity.title === "string" ? panel.activity.title : void 0
      } : void 0;
      out.panels[panel.id] = {
        id: panel.id,
        title: typeof panel.title === "string" && panel.title ? panel.title : panel.id,
        module,
        plugin: p.id,
        defaultHidden: !!panel.defaultHidden,
        dockBelow: isId(panel.dockBelow) ? panel.dockBelow : void 0,
        dock,
        pinned: !!panel.pinned,
        activity
      };
    }
    for (const s of Array.isArray(c.sidebars) ? c.sidebars : []) {
      if (!isObj(s) || s.side !== "left" && s.side !== "right") continue;
      out.sidebars.push({ module: isId(s.module) ? s.module : p.id, side: s.side, width: Number.isFinite(s.width) ? Number(s.width) : 44, order: Number.isFinite(s.order) ? Number(s.order) : 100 });
    }
    for (const o of Array.isArray(c.overlays) ? c.overlays : []) {
      if (o === true || isObj(o)) out.overlays.push({ module: isObj(o) && isId(o.module) ? o.module : p.id });
    }
    for (const b of Array.isArray(c.barItems) ? c.barItems : []) {
      if (!isObj(b) || !isId(b.id) || out.barItems.some((x) => x.id === b.id)) continue;
      out.barItems.push({
        id: b.id,
        title: typeof b.title === "string" && b.title ? b.title : b.id,
        module: isId(b.module) ? b.module : p.id,
        bar: b.bar === "top" ? "top" : "bottom",
        width: Number.isFinite(b.width) && b.width > 0 ? Math.min(600, Number(b.width)) : void 0,
        order: Number.isFinite(b.order) ? Number(b.order) : 100
      });
    }
  }
  out.barItems.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  out.sidebars.sort((a, b) => a.order - b.order || a.module.localeCompare(b.module));
  return out;
}
function watchContributions(ctx, onChange) {
  let version = 0;
  const load = async () => {
    const mine = ++version;
    try {
      const r = await ctx.host.plugins.list();
      if (mine === version) onChange(collectContributions(r.plugins));
    } catch (e) {
      ctx.log.warn("plugins.list failed", String(e));
    }
  };
  void load();
  return ctx.events.on("kernel.modules.changed", () => {
    void load();
  });
}
async function loadContributions(ctx) {
  return collectContributions((await ctx.host.plugins.list()).plugins);
}

// ../sdk/halo-glass.ts
var glassCard = {
  gradient: { angle: 180, from: "cardTop", to: "cardBottom", toAt: 0.34 },
  shadows: [{ y: 1, color: "highlight", inset: true }, { y: 18, blur: 40, color: "depth" }]
};
var surfaceEffectsOf = (value) => value === "full" || value === "flat" ? value : "reduced";
var dockedCard = (effects) => effects === "full" ? glassCard : effects === "reduced" ? { gradient: glassCard.gradient, shadows: [{ y: 1, color: "highlight", inset: true }] } : { shadows: [{ y: 1, color: "highlight", inset: true }] };
var glassChip = {
  gradient: { angle: 180, from: "glassTop", to: "glassBottom" },
  borderWidth: 1,
  borderColor: "glassEdge",
  shadows: [{ y: 1, color: "highlight", inset: true }, { y: 1, blur: 3, color: "chipDepth" }]
};
var glassWell = { background: "well", borderWidth: 1, borderColor: "wellEdge" };
var glossyTile = {
  gradient: { angle: 180, from: "tileTop", to: "tileBottom" },
  shadows: [{ y: 1, color: "#ffffff80", inset: true }, { y: 2, blur: 6, color: "depth" }]
};
var glow = (color = "glow", blur = 6, spread = 0) => ({ shadows: [{ blur, spread, color }] });
var fadeLine = (towards) => ({ gradient: { angle: towards === "left" ? 270 : 90, from: "#00000000", to: "rule" } });

// ../sdk/usage-limits.ts
function resetText(w, now = Date.now()) {
  if (w.resetsAt && Number.isFinite(w.resetsAt)) {
    const remaining = w.resetsAt - now;
    if (remaining <= 0) return w.resetsText ? `resets ${w.resetsText}` : "reset time passed · refresh usage";
    if (remaining < 6e4) return "resets in <1 min";
    const mins = Math.ceil(remaining / 6e4);
    if (mins < 60) return `resets in ${mins} min`;
    if (mins < 48 * 60) return `resets in ${Math.floor(mins / 60)} h ${mins % 60} min`;
    return `resets in ${Math.round(mins / 1440)} days`;
  }
  return w.resetsText ? `resets ${w.resetsText}` : "";
}

// ../sdk/halo-logo.ts
var haloLogo = { name: "hato-tile.png", mimeType: "image/png", data: "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" };

// ../sdk/halo-rail.ts
var svg = (paths, width = 1.6) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
var haloIcons = {
  search: svg(`<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>`),
  sidebar: svg(`<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M9.5 4.5v15"/>`),
  chevron: svg(`<path d="m9 6 6 6-6 6"/>`),
  updown: svg(`<path d="m8 9 4-4 4 4M8 15l4 4 4-4"/>`),
  file: svg(`<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>`),
  check: svg(`<path d="m5 12.5 4.5 4.5L19 7.5"/>`, 2),
  plus: svg(`<path d="M12 5v14M5 12h14"/>`, 1.8),
  settings: svg(`<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M4.2 7.5l2 1.2M17.8 15.3l2 1.2M4.2 16.5l2-1.2M17.8 8.7l2-1.2"/><circle cx="12" cy="12" r="7"/>`),
  plug: svg(`<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/>`),
  layout: svg(`<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M10 9.5v10"/>`),
  modules: svg(`<path d="M12 3 4 7.5v9L12 21l8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>`),
  moon: svg(`<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>`),
  chat: svg(`<path d="M5 5h14a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 17h-8l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 5 5z"/>`),
  history: svg(`<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4.5v4h4M12 8v4.5l3 2"/>`),
  branch: svg(`<circle cx="6" cy="5.5" r="2"/><circle cx="6" cy="18.5" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7.5v9M18 10c0 4-6 3.5-11 7"/>`),
  folder: svg(`<path d="M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>`)
};
var ease = { out: [0.22, 1, 0.36, 1], in: [0.4, 0, 1, 1], std: [0.2, 0, 0, 1], spring: [0.34, 1.36, 0.64, 1] };
var haloMotion = {
  width: { durationMs: 320, easing: ease.out },
  layout: { durationMs: 260, easing: ease.out },
  indicator: { durationMs: 300, easing: ease.spring },
  /** Labels decode left → right; rows stagger so the list reads top-down. */
  scramble: (row2) => ({ effect: "scramble", charMs: 22, delayMs: 60 + Math.min(row2, 24) * 16, charset: "/>\\=_#%*<+:", on: "mount" }),
  rowPresence: {
    enter: { durationMs: 220, easing: ease.out, opacity: 0, offsetPx: [0, -4], heightCollapse: true },
    exit: { durationMs: 180, easing: ease.in, opacity: 0, heightCollapse: true }
  },
  fade: { enter: { durationMs: 160, easing: ease.std, opacity: 0 }, exit: { durationMs: 110, easing: ease.in, opacity: 0 } },
  menu: { enter: { durationMs: 240, easing: ease.out, opacity: 0, offsetPx: [0, 6] }, exit: { durationMs: 150, easing: ease.in, opacity: 0, offsetPx: [0, 6] } },
  value: { durationMs: 600, easing: ease.out }
};
var HALO = { inset: 8, expanded: 240, collapsed: { left: 64, right: 48 }, chrome: 24 };
var PAD = 6;
var haloSlotWidth = (side, expanded) => (expanded ? HALO.expanded : HALO.collapsed[side]) + HALO.inset;
var haloTrafficLights = { x: HALO.inset + 6, y: HALO.inset + 6 };
var row = (key, children, extra = {}) => ({ type: "row", key, align: "center", children, ...extra });
var col = (key, children, extra = {}) => ({ type: "column", key, children, ...extra });
var icon = (key, svgText, size = 16, color = "muted", style) => ({ type: "icon", key, svg: svgText, size, color, ...style ? { style } : {} });
var text = (key, value, o = {}) => ({
  type: "label",
  key,
  text: value,
  color: o.color || "text",
  ...o.grow ? { grow: true } : {},
  style: { fontSize: o.size ?? 13, ...o.weight ? { fontWeight: o.weight } : {}, ...o.mono ? { font: "mono" } : {}, ...o.spacing ? { letterSpacing: o.spacing } : {} },
  ...o.reveal ? { reveal: o.reveal } : {},
  ...o.tween ? { tween: o.tween } : {}
});
var tipSide = (m) => m.side === "left" ? "right" : "left";
var SPINNER_FPS = 60;
var spinner = (key, size = 12, color = "muted") => ({ type: "spinner", key, size, color, thickness: 1.5, fps: SPINNER_FPS });
var indicator = (m) => col("indicator", [], {
  layoutId: `halo-indicator-${m.side}`,
  layoutTransition: haloMotion.indicator,
  style: { position: "absolute", ...m.side === "left" ? { left: -PAD } : { right: -PAD }, top: 9, width: 3, height: 14, radius: 2, background: "primary", ...glow() }
});
var letterTile = (key, letter, active, size = 18) => row(key, [text("l", letter, { size: size * 0.55, weight: 600, color: active ? "primaryText" : "muted" })], {
  style: { width: size, height: size, radius: 5, justify: "center", noShrink: true, background: active ? "primary" : "raised", borderWidth: 1, borderColor: active ? "primary" : "border" }
});
var badgeNode = (count, expanded) => expanded ? row("badge", [
  col("dot", [], { style: { width: 6, height: 6, radius: 3, background: "primary", ...glow("glow", 6, 1) } }),
  text("n", count > 99 ? "99+" : String(count), { size: 11, color: "primary", mono: true, tween: { format: "int", durationMs: 260 } })
], { gap: 5, style: { noShrink: true } }) : col("badge", [], { style: { position: "absolute", right: -4, top: -3, width: 8, height: 8, radius: 4, background: "primary", borderWidth: 1.5, borderColor: "panel", ...glow("glow", 7, 1) } });
function itemRow(m, item, index) {
  const hasChildren = item.expandable || !!item.children?.length;
  const open = m.expanded && hasChildren && !!item.open;
  const lead = item.tile !== void 0 ? letterTile("tile", item.tile, !!item.active) : icon("icon", item.iconSvg || haloIcons.folder, 16, item.active ? "text" : "muted");
  const kids = [];
  if (m.focused === item.id) kids.push(indicator(m));
  if (m.expanded) kids.push(lead);
  else {
    const beacon = item.badge ? badgeNode(item.badge, false) : item.busy ? col("busy", [spinner("s", 8, "primary")], { style: { position: "absolute", right: -5, top: -4 } }) : null;
    kids.push(row("lead", [lead, ...beacon ? [beacon] : []], { style: { position: "relative", noShrink: true } }));
  }
  if (m.expanded) {
    kids.push(col("text", [
      text("label", item.title, { color: item.active ? "text" : "muted", weight: item.active ? 500 : void 0, reveal: haloMotion.scramble(index) }),
      ...item.detail ? [text("detail", item.detail, { size: 10.5, color: "faint", reveal: haloMotion.scramble(index + 1) })] : []
    ], { grow: true, gap: 1, minWidth: 0 }));
    if (item.busy) kids.push(spinner("busy"));
    if (item.badge) kids.push(badgeNode(item.badge, true));
    if (hasChildren) kids.push(row("chev", [icon("chevron", haloIcons.chevron, 12, "faint", { rotate: open ? 90 : 0 })], {
      action: item.groupAction || item.action,
      value: item.value,
      hoverStyle: { background: "hover" },
      layoutTransition: haloMotion.layout,
      style: { width: 20, height: 20, radius: 5, justify: "center", noShrink: true }
    }));
  }
  const tooltip = item.tooltip || `${item.title}${item.detail ? ` · ${item.detail}` : ""}${item.badge ? ` · ${item.badge} new` : ""}`;
  const out = [row(`row:${item.id}`, kids, {
    action: item.action,
    value: item.value,
    layoutTransition: haloMotion.layout,
    presence: haloMotion.rowPresence,
    hoverStyle: { background: item.active ? "selection" : "hover" },
    style: {
      position: "relative",
      minHeight: item.detail && m.expanded ? 40 : 32,
      radius: 8,
      paddingX: m.expanded ? 9 : 0,
      gap: 10,
      justify: m.expanded ? "start" : "center",
      ...item.active ? { background: "selection", ...glassChip } : { borderWidth: 1, borderColor: "transparent" }
    },
    ...m.expanded ? {} : { tooltip, tooltipPlacement: tipSide(m) }
  })];
  if (open) out.push(row(`children:${item.id}`, [
    col("guide", [], { style: { width: 1, background: "border", noShrink: true } }),
    col("list", item.children.map((c, i) => row(`child:${c.id}`, [
      ...c.dot ? [col("dot", [], { style: { width: 6, height: 6, radius: 3, background: c.dot, noShrink: true } })] : [],
      text("label", c.label, { size: 12.5, color: c.selected ? "text" : "muted", weight: c.selected ? 500 : void 0, reveal: haloMotion.scramble(i), grow: true }),
      ...c.busy ? [spinner("busy", 10)] : [],
      ...c.detail ? [text("detail", c.detail, { size: 10.5, color: "faint", mono: true })] : []
    ], {
      gap: 7,
      action: c.action,
      value: c.value,
      hoverStyle: { background: "hover" },
      style: { height: 26, radius: 6, paddingX: 9, ...c.selected ? { background: "selection" } : {} }
    })), { grow: true, gap: 1, minWidth: 0 })
  ], { align: "stretch", gap: 6, presence: haloMotion.rowPresence, layoutTransition: haloMotion.layout, style: { paddingX: 0, gap: 6 } }));
  if (m.expanded) for (const t of item.tasks || []) out.push(taskRow(item.id, t));
  return out;
}
function taskRow(owner, t) {
  const done = t.state === "done", failed = t.state === "error";
  const pct = t.progress == null ? null : Math.max(0, Math.min(1, t.progress));
  return row(`task:${owner}:${t.id}`, [
    row("tile", [icon("i", done ? haloIcons.check : t.iconSvg || haloIcons.file, 14, done ? "success" : "muted")], { style: { width: 28, height: 28, radius: 7, background: "raised", justify: "center", noShrink: true } }),
    col("body", [
      row("top", [
        col("names", [text("name", t.label, { size: 12 }), ...t.detail ? [text("detail", t.detail, { size: 10.5, color: "faint" })] : []], { grow: true, gap: 1, minWidth: 0 }),
        done ? text("state", "Done", { size: 10.5, color: "success", mono: true, reveal: { effect: "scramble", charMs: 30, on: "change" } }) : failed ? text("state", "Failed", { size: 10.5, color: "danger", mono: true }) : spinner("spin", 10)
      ], { gap: 6 }),
      // Native progress takes a 0–1 fraction and animates value changes with `transition`.
      {
        type: "progress",
        key: "bar",
        value: done ? 1 : pct == null ? void 0 : pct,
        indeterminate: !done && !failed && pct == null,
        color: done ? "success" : failed ? "danger" : "primary",
        trackColor: "meterOff",
        height: 2,
        transition: { durationMs: 420, easing: ease.out },
        ...!done && !failed && pct !== 0 ? { style: { radius: 1, ...glow("glow", 5) } } : {}
      }
    ], { grow: true, gap: 6, minWidth: 0 })
  ], {
    gap: 9,
    presence: haloMotion.rowPresence,
    layoutTransition: haloMotion.layout,
    ...t.action ? { action: t.action, value: t.value ?? null, hoverStyle: { borderColor: "activeBorder" }, tooltip: t.tooltip } : {},
    style: { radius: 10, padding: 6, paddingX: 8, background: "field", ...glassChip }
  });
}
function sectionHead(m, s, index) {
  if (!m.expanded) return row(`head:${s.key}`, [
    col("rule-l", [], { style: { width: 12, height: 1, ...fadeLine("right") } }),
    col("rule-r", [], { style: { width: 12, height: 1, ...fadeLine("left") } })
  ], { style: { height: 13, justify: "center" } });
  return row(`head:${s.key}`, [
    text("t", s.title.toUpperCase(), { size: 9, color: "faint", mono: true, spacing: 1.8, reveal: haloMotion.scramble(index), grow: true }),
    ...s.add ? [row("add", [icon("i", s.add.iconSvg || haloIcons.plus, 12, "faint")], {
      action: s.add.action,
      value: s.add.value ?? null,
      tooltip: s.add.tooltip,
      hoverStyle: { background: "hover" },
      style: { width: 20, height: 20, radius: 5, justify: "center" }
    })] : []
  ], { style: { height: 24, paddingX: 9 } });
}
function header(m) {
  const left = m.side === "left";
  const chrome = left ? [row("chrome", [], { windowDrag: true, visibleWhen: "windowed", style: { height: HALO.chrome, noShrink: true } })] : [{ type: "column", key: "chrome", height: 6, children: [] }];
  if (!m.expanded) {
    const top = left ? row("logo", [{ type: "image", key: "pigeon", image: haloLogo, width: 30, height: 30 }], {
      action: "expand",
      value: true,
      tooltip: `${m.header.title} · Expand`,
      tooltipPlacement: "right",
      style: { width: 30, height: 30, radius: 9, clip: true, ...glossyTile }
    }) : row("expand", [icon("i", haloIcons.sidebar, 16, "muted")], {
      action: "expand",
      value: true,
      tooltip: "Expand",
      tooltipPlacement: "left",
      hoverStyle: { background: "hover" },
      style: { width: 32, height: 30, radius: 8, justify: "center" }
    });
    return [...chrome, row("header", [top], { style: { height: 40, justify: "center" } })];
  }
  const collapse = row("collapse", [icon("i", haloIcons.sidebar, 15, "faint")], {
    action: "expand",
    value: false,
    tooltip: "Collapse",
    hoverStyle: { background: "hover" },
    style: { width: 28, height: 28, radius: 8, justify: "center", noShrink: true, background: "raised", ...glassChip }
  });
  const title = col("title", [
    text("name", m.header.title, { size: 14, weight: 600, reveal: haloMotion.scramble(0) }),
    ...m.header.subtitle ? [text("sub", m.header.subtitle, { size: 10.5, color: "faint", reveal: haloMotion.scramble(1) })] : []
  ], { grow: true, gap: 1, minWidth: 0, ...left ? {} : { windowDrag: true } });
  const head = row("header", [
    ...m.header.logo ? [row("logo", [{ type: "image", key: "pigeon", image: haloLogo, width: 30, height: 30 }], { style: { width: 30, height: 30, radius: 9, clip: true, noShrink: true, ...glossyTile } })] : [],
    title,
    collapse
  ], { gap: 10, style: { height: 40, paddingX: 3 } });
  return [...chrome, head, ...m.header.embed ? [row("header-embed", [m.header.embed], { style: { paddingX: 0, height: 28, justify: "start" } })] : []];
}
function searchNode(m) {
  if (!m.search) return null;
  if (!m.expanded) return row("search", [icon("i", haloIcons.search, 15)], {
    action: "expand",
    value: true,
    tooltip: m.search.placeholder,
    tooltipPlacement: tipSide(m),
    hoverStyle: { background: "hover" },
    style: { height: 32, radius: 9, justify: "center", background: "raised", ...glassChip }
  });
  return row("search", [
    icon("i", haloIcons.search, 15, "faint"),
    {
      type: "textInput",
      key: "q",
      value: m.search.query,
      placeholder: m.search.placeholder,
      bare: true,
      grow: true,
      minWidth: 0,
      changeAction: "query",
      submitAction: "querySubmit",
      cancelAction: "queryClear"
    },
    row("key", [text("k", m.search.query ? "esc" : "↵", { size: 10, color: "faint", mono: true })], {
      style: { height: 20, paddingX: 6, radius: 6, noShrink: true, background: "raised", borderWidth: 1, borderColor: "glassEdge", shadows: [{ y: 1, color: "highlight", inset: true }] }
    })
  ], { gap: 8, style: { height: 36, radius: 10, paddingX: 10, background: "field", ...glassChip } });
}
function primaryNode(m) {
  if (!m.primary) return null;
  const p = m.primary;
  return m.expanded ? row("primary", [icon("i", p.iconSvg, 15, "primaryText"), text("l", p.label, { size: 13, weight: 500, color: "primaryText", reveal: haloMotion.scramble(1) })], {
    gap: 9,
    action: p.action,
    value: null,
    tooltip: p.tooltip,
    hoverStyle: { background: "primaryHover" },
    pressedStyle: { background: "primaryActive" },
    style: { height: 34, radius: 9, paddingX: 10, background: "primary", shadows: [{ y: 1, color: "#ffffff26", inset: true }, { y: 3, blur: 10, color: "glow" }] }
  }) : row("primary", [icon("i", p.iconSvg, 16, "primaryText")], {
    action: p.action,
    value: null,
    tooltip: p.tooltip,
    tooltipPlacement: tipSide(m),
    hoverStyle: { background: "primaryHover" },
    style: { height: 32, radius: 9, justify: "center", background: "primary", shadows: [{ y: 1, color: "#ffffff26", inset: true }, { y: 2, blur: 8, color: "glow" }] }
  });
}
var usageTone = (used) => used >= 90 ? "danger" : used >= 70 ? "warning" : "meterOn";
var clampPct = (n) => Math.max(0, Math.min(100, n));
function usageRings(u) {
  const [outer, inner] = u.windows;
  const ring = (key, w, size, thickness, style = {}) => ({ type: "ring", key, value: clampPct(w.usedPercent), max: 100, size, thickness, color: usageTone(w.usedPercent), trackColor: "meterOff", transition: haloMotion.value, style });
  return row(`ring:${u.id}`, [
    row("rings", [
      ring("outer", outer, 26, 2.5),
      ...inner ? [ring("inner", inner, 16, 2, { position: "absolute", left: 5, top: 5 })] : []
    ], { style: { position: "relative", width: 26, height: 26 } })
  ], { action: "usage", value: u.id, tooltip: u.tooltip, tooltipPlacement: "left", hoverStyle: { background: "hover" }, style: { height: 34, radius: 8, justify: "center" } });
}
function usageBars(u, i) {
  return col(`meter:${u.id}`, [
    row("head", [
      text("t", u.name.toUpperCase(), { size: 9, color: "faint", mono: true, spacing: 1.6, reveal: haloMotion.scramble(i), grow: true }),
      ...u.loading ? [spinner("s", 9)] : []
    ], { gap: 6 }),
    ...u.windows.map((w, k) => row(`w${k}`, [
      text("l", w.label.toUpperCase(), { size: 9, color: "faint", mono: true }),
      {
        type: "meter",
        key: "bar",
        value: clampPct(w.usedPercent),
        max: 100,
        segments: k === 0 ? 28 : 28,
        filledColor: usageTone(w.usedPercent),
        emptyColor: "meterOff",
        highlightColor: "primary",
        segmentWidth: 3,
        segmentHeight: k === 0 ? 10 : 6,
        gap: 2.2,
        radius: 1.5,
        transition: haloMotion.value,
        grow: true
      },
      text("v", `${Math.round(clampPct(w.usedPercent))}%`, { size: 9, color: "muted", mono: true, tween: { format: "percent", durationMs: 500 } })
    ], { gap: 7 }))
  ], { gap: 5, action: "usage", value: u.id, tooltip: u.tooltip, hoverStyle: { background: "hover" }, style: { radius: 8, padding: 6 } });
}
function usageNode(m) {
  if (!m.usage.length) return null;
  return col(
    "usage",
    m.expanded ? m.usage.map(usageBars) : m.usage.map(usageRings),
    { gap: m.expanded ? 4 : 2, presence: haloMotion.fade, style: { paddingY: 6, borderTop: 1, borderColor: "border" } }
  );
}
function avatar(initials, badge) {
  return row("avatar", [
    text("i", initials, { size: 10, weight: 600, mono: true }),
    col("presence", [], { style: { position: "absolute", right: -1, bottom: -1, width: 8, height: 8, radius: 4, background: "success", borderWidth: 2, borderColor: "panel" } }),
    ...badge ? [col("badge", [], { style: { position: "absolute", right: -2, top: -2, width: 8, height: 8, radius: 4, background: "primary", borderWidth: 2, borderColor: "panel", ...glow("glow", 7, 1) } })] : []
  ], { style: { position: "relative", width: 28, height: 28, radius: 14, background: "raised", borderWidth: 1, borderColor: "border", justify: "center", noShrink: true } });
}
function accountMenu(a) {
  const enter = { enter: { ...haloMotion.fade.enter, offsetPx: [0, 4] } };
  const item = (it, i) => row(it.key, [
    icon("i", it.iconSvg, 15),
    text("l", it.label, { size: 12.5, grow: true }),
    ...it.badge ? [text("b", it.badge, { size: 10.5, color: "primary", mono: true })] : []
  ], { gap: 10, action: it.action, value: it.value ?? null, hoverStyle: { background: "hover" }, presence: enter, presenceDelayMs: 30 * i, style: { height: 30, radius: 7, paddingX: 8 } });
  return {
    type: "popover",
    key: "account-menu",
    closeAction: "account",
    bottom: 52,
    left: 0,
    right: 0,
    anchorScope: "container",
    transition: haloMotion.menu,
    clipReveal: true,
    children: [col("menu", [
      ...a.menu.map(item),
      ...a.status?.length ? [col("rule-1", [], { style: { height: 1, background: "border" } }), col("status", a.status, { gap: 4, style: { paddingX: 8, paddingY: 4 } })] : [],
      col("rule-2", [], { style: { height: 1, background: "border" } }),
      row("dark", [
        icon("i", haloIcons.moon, 15),
        text("l", "Dark mode", { size: 12.5, grow: true }),
        { type: "switch", key: "s", label: "", checked: a.darkMode, action: "darkMode", accent: "meterOn" }
      ], { gap: 10, presence: enter, presenceDelayMs: 30 * a.menu.length, style: { height: 32, radius: 7, paddingX: 8 } })
    ], { gap: 2, style: { padding: 5, radius: 12, background: "panel", borderWidth: 1, borderColor: "glassEdge", ...glassCard } })]
  };
}
function footer(m) {
  const out = [];
  if (!m.expanded && m.busy && m.side === "right") out.push(row("busy", [spinner("s", 14, "text")], { presence: haloMotion.fade, tooltip: `${m.busy} agent${m.busy === 1 ? "" : "s"} working`, tooltipPlacement: tipSide(m), style: { height: 28, justify: "center" } }));
  const a = m.account;
  if (!a) return out;
  if (!m.expanded) {
    out.push(row("account", [avatar(a.initials, a.badge)], { action: "expand", value: true, tooltip: `${a.name} · ${a.detail}`, tooltipPlacement: tipSide(m), style: { height: 44, justify: "center" } }));
    return out;
  }
  out.push(col("footer", [
    ...a.open ? [accountMenu(a)] : [],
    row("account", [
      avatar(a.initials, a.badge),
      col("who", [text("n", a.name, { size: 12.5, weight: 500, reveal: haloMotion.scramble(1) }), text("d", a.detail, { size: 10.5, color: "faint", reveal: haloMotion.scramble(2) })], { grow: true, gap: 1, minWidth: 0 }),
      icon("ud", haloIcons.updown, 13, "faint")
    ], {
      gap: 9,
      action: "account",
      value: !a.open,
      hoverStyle: { background: "hover" },
      style: { height: 46, radius: 11, paddingX: 6, ...glassWell }
    })
  ], { style: { position: "relative" } }));
  return out;
}
function tabsNode(s) {
  const t = s.tabs;
  return row(`tabs:${s.key}`, t.items.map((it) => {
    const on = it.id === t.active;
    return row(`tab:${it.id}`, [
      text("l", it.label, { size: 11.5, color: on ? "text" : "muted", weight: on ? 500 : void 0 }),
      ...it.count != null ? [text("n", String(it.count), { size: 10, color: "faint", mono: true })] : []
    ], {
      gap: 5,
      action: t.action,
      value: it.id,
      hoverStyle: { background: on ? "selection" : "hover" },
      layoutTransition: haloMotion.layout,
      style: { height: 24, radius: 7, paddingX: 8, ...on ? { background: "selection", ...glassChip } : { borderWidth: 1, borderColor: "transparent" } }
    });
  }), { wrap: true, gap: 3, style: { paddingX: 3, paddingY: 2 } });
}
function haloRail(m) {
  let index = 2;
  const top = [...header(m)];
  const search = searchNode(m);
  if (search) top.push(search);
  const primary = primaryNode(m);
  if (primary) top.push(primary);
  const lane = (key, kids) => col(key, kids, { gap: 2, style: { paddingX: PAD, clip: false } });
  const list = [];
  for (const s of m.sections) {
    const items = m.expanded ? s.items : s.collapsed === "none" ? [] : s.collapsed === "active" ? s.items.filter((i) => i.active) : s.items;
    const tasks = m.expanded ? s.tasks || [] : [];
    if (!items.length && !tasks.length && !(m.expanded && (s.embed || s.add))) continue;
    const head = [sectionHead(m, s, index++)];
    if (m.expanded && s.tabs && s.tabs.items.length > 1) head.push(tabsNode(s));
    if (m.expanded && s.embed) head.push(row(`embed:${s.key}`, [s.embed], { style: { paddingX: 3 } }));
    for (const t of tasks) head.push(taskRow(s.key, t));
    const rows = items.flatMap((item) => itemRow(m, item, index++));
    if (m.expanded && s.maxHeight) list.push(lane(`lane:${s.key}`, head), col(`scroll:${s.key}`, [lane(`lane:${s.key}:items`, rows)], { scroll: true, maxHeight: s.maxHeight, style: { noShrink: true } }));
    else list.push(lane(`lane:${s.key}`, [...head, ...rows]));
  }
  const bottom = [];
  const usage = usageNode(m);
  if (usage) bottom.push(usage);
  bottom.push(...footer(m));
  const card = col("halo-card", [
    col("top", top, { gap: 3, style: { paddingX: PAD, noShrink: true } }),
    // The middle band scrolls; header and footer stay put.
    col("sections", list, { grow: true, scroll: true, gap: 2, style: { paddingY: 4 } }),
    col("bottom", bottom, { gap: 3, style: { paddingX: PAD, noShrink: true } })
  ], { grow: true, gap: 0, style: { position: "relative", radius: 16, background: "panel", borderWidth: 1, borderColor: "glassEdge", clip: true, ...dockedCard(m.effects ?? "reduced") } });
  const gutter = col("gutter", [], { width: HALO.inset, style: { width: HALO.inset, noShrink: true } });
  return row("halo", m.side === "left" ? [gutter, card] : [card, gutter], { grow: true, align: "stretch", style: { paddingY: HALO.inset } });
}
function haloUsage(limits) {
  const out = [];
  for (const [provider, snap] of Object.entries(limits || {})) {
    const all = snap?.windows || [];
    const hours = all.find((w) => /five_hour|5h|5-hour/i.test(`${w.id} ${w.label}`)) || all[0];
    const week = all.find((w) => w !== hours && /^(wk|week|weekly)$|seven_day$/i.test(String(w.label).trim()) || w.id === "seven_day") || all.find((w) => w !== hours && /wk|week/i.test(w.label));
    const windows = [hours, week].filter((w) => !!w).map((w) => ({ label: /wk|week/i.test(w.label) ? "wk" : /5/.test(w.label) ? "5h" : w.label.slice(0, 3), usedPercent: Number(w.usedPercent) || 0 }));
    if (!windows.length) continue;
    const name = provider === "claude" ? "Claude" : provider === "codex" ? "Codex" : provider[0].toUpperCase() + provider.slice(1);
    const lines = [`${name} plan usage`, ...snap.windows.map((x) => {
      const reset = resetText(x);
      return `${x.label}: ${Math.round(x.usedPercent)}% used · ${Math.round(Math.max(0, 100 - x.usedPercent))}% left${reset ? ` · ${reset}` : ""}`;
    })];
    if (snap.error) lines.push(`⚠ ${snap.error}`);
    lines.push(snap.loading ? "Checking…" : "Click to refresh");
    out.push({ id: provider, name, windows, tooltip: lines.join("\n"), loading: !!snap.loading });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ../sdk/activity-sidebar.ts
var fallbackIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/></svg>`;
var CHAT_LIMIT = 6;
var initialsOf = (name) => name.split(/[\s/_.@-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "H";
var sum = (v) => v && typeof v === "object" ? Object.values(v).reduce((n, c) => n + (Number.isFinite(Number(c)) ? Math.max(0, Number(c)) : 0), 0) : 0;
var statText = (s) => s && (s.added || s.removed) ? `+${s.added} −${s.removed}` : void 0;
var taskDot = (status, busy) => busy ? "primary" : status === "ready" ? "success" : status === "error" || status === "failed" ? "danger" : "warning";
function activitySidebar(id, side) {
  let visible = {};
  let choices = {};
  let order = {};
  let contributions = null;
  let stop = null;
  const stops = [];
  const badges = {};
  const children = {};
  const tasks = {};
  const panelStops = /* @__PURE__ */ new Map();
  const syncPanels = (ctx) => {
    const panels = Object.values(contributions?.panels || {});
    const wanted = new Set(panels.map((p) => p.id));
    for (const [pid, stopIt] of panelStops) if (!wanted.has(pid)) {
      stopIt();
      panelStops.delete(pid);
      delete badges[pid];
      delete children[pid];
      delete tasks[pid];
    }
    for (const panel of panels) if (!panelStops.has(panel.id)) {
      const watches = [["panelBadge", badges], ["panelChildren", children], ["panelTasks", tasks]].map(([kind, into]) => {
        const key = `${panel.module}.${kind}.${panel.id}`;
        into[panel.id] = ctx.state.get(key);
        return ctx.state.watch(key, (value) => {
          into[panel.id] = value;
          ctx.ui.invalidate();
        });
      });
      panelStops.set(panel.id, () => watches.forEach((w) => typeof w === "function" && w()));
    }
  };
  let theme = "ember";
  let colorMode = "system";
  let effects = "reduced";
  let expanded = false;
  let query = "";
  let focused = null;
  let accountOpen = false;
  const open = {};
  let ws = null;
  let limits = null;
  let busyAi = null;
  let busyAgents = null;
  let projects = null;
  let workingChats = null;
  let workingAgents = null;
  let chatProgress = null;
  let chats = null;
  let updates = 0;
  let error = null;
  const busyCount = () => sum(busyAi) + sum(busyAgents);
  const publishWidth = (ctx) => ctx.state.set(`${id}.preferredWidth`, haloSlotWidth(side, expanded));
  const enabled = (module) => !!contributions && (Object.values(contributions.panels).some((p) => p.module === module) || (contributions.barItems || []).some((b) => b.module === module));
  const finished = /* @__PURE__ */ new Map();
  let lastTasks = {};
  const asChildren = (v) => Array.isArray(v) ? v.filter((c) => c && typeof c.id === "string" && typeof c.label === "string").slice(0, 50).map((c) => ({ id: c.id, label: c.label, selected: c.selected === true, ...Number.isFinite(c.count) ? { count: c.count } : {} })) : [];
  const asTasks = (v) => Array.isArray(v) ? v.filter((t) => t && typeof t.id === "string" && typeof t.label === "string").slice(0, 5).map((t) => ({ id: t.id, label: t.label, progress: Number.isFinite(t.progress) ? t.progress : null, state: t.state === "done" || t.state === "error" ? t.state : "running" })) : [];
  const tasksFor = (ctx, panel) => {
    const live = asTasks(tasks[panel]);
    const now = Date.now();
    for (const t of lastTasks[panel] || []) if (t.state === "running" && !live.some((l) => l.id === t.id) && !finished.has(`${panel}:${t.id}`)) {
      finished.set(`${panel}:${t.id}`, { task: { ...t, state: "done", progress: 1 }, until: now + 1600 });
      setTimeout(() => ctx.ui.invalidate(), 1650);
    }
    lastTasks[panel] = live;
    const lingering = [...finished].filter(([k, f]) => k.startsWith(`${panel}:`) && (f.until > now || (finished.delete(k), false))).map(([, f]) => f.task);
    return [...live, ...lingering.filter((t) => !live.some((l) => l.id === t.id))];
  };
  const buttons = () => contributions ? sidebarPanels(contributions, choices, side) : [];
  const panelItems = (ctx, pos, skip = []) => {
    if (!contributions) return [];
    const panels = buttons();
    const q = query.trim().toLowerCase();
    return orderedSidebarItems(contributions, choices, order, pos).flatMap((pid) => {
      if (pid.startsWith("@spacer:") || skip.includes(pid)) return [];
      const panel = panels.find((p) => p.id === pid);
      if (!panel) return [];
      const title = panel.activity?.title || panel.title;
      if (q && !title.toLowerCase().includes(q)) return [];
      const count = badges[panel.id];
      const kids = asChildren(children[panel.id]);
      const navigation = Array.isArray(children[panel.id]);
      return [{
        id: panel.id,
        title,
        action: "toggle",
        value: panel.id,
        groupAction: "toggle",
        active: navigation ? !!open[panel.id] : !!visible[panel.id],
        iconSvg: panel.activity?.iconSvg || panel.activity?.icon && sidebarIcons[panel.activity.icon] || fallbackIcon,
        badge: typeof count === "number" && Number.isFinite(count) && count > 0 ? Math.floor(count) : void 0,
        children: kids.map((c) => ({ id: c.id, label: c.label, selected: c.selected, detail: c.count != null ? String(c.count) : void 0, action: "child", value: { panel: panel.id, child: c.id } })),
        open: !!open[panel.id],
        expandable: navigation,
        tasks: tasksFor(ctx, panel.id),
        tooltip: `${navigation ? open[panel.id] ? "Collapse" : "Expand" : visible[panel.id] && !panel.pinned ? "Hide" : "Show"} ${title}`
      }];
    });
  };
  const projectsSection = () => {
    if (!projects) return null;
    const q = query.trim().toLowerCase();
    const sel = projects.selected;
    const all = projects.projects;
    const match = (p) => !q || String(p.name).toLowerCase().includes(q) || p.tasks.some((t) => `${t.name} ${t.branch}`.toLowerCase().includes(q));
    const isActive = (p) => p.id === sel || p.tasks.some((t) => t.id === sel);
    const groups = projects.groups || [];
    const group = groups.find((g) => g.id === projects.activeGroup);
    const inGroup = (p) => !group || group.projectIds.includes(p.projectId);
    const list = all.filter((p) => match(p) && (!!q || inGroup(p)));
    const items = list.map((p) => {
      const busy = p.busy + p.tasks.reduce((n, t) => n + t.busy, 0);
      const tasksShown = q ? p.tasks.filter((t) => `${t.name} ${t.branch}`.toLowerCase().includes(q) || String(p.name).toLowerCase().includes(q)) : p.tasks;
      return {
        id: `project:${p.id}`,
        title: p.name,
        tile: String(p.name || "?")[0].toUpperCase(),
        action: "workspace",
        value: p.id,
        groupAction: "group",
        active: isActive(p),
        busy: busy > 0,
        detail: p.needsPassword ? "Connect" : p.offline ? "Offline" : busy ? `AI working${busy > 1 ? ` · ${busy}` : ""}` : statText(p.stats) || (p.kind === "local" ? void 0 : p.kind === "cloud" ? "Cloud" : "Remote"),
        tooltip: `${p.name}${p.tasks.length ? ` · ${p.tasks.length} task${p.tasks.length === 1 ? "" : "s"}` : ""}`,
        children: tasksShown.map((t) => ({
          id: t.id,
          label: t.name,
          detail: statText(t.stats),
          selected: t.id === sel,
          busy: t.busy > 0,
          dot: taskDot(t.status, t.busy),
          action: "workspace",
          value: t.id
        })),
        open: !!q || (open[`project:${p.id}`] ?? isActive(p))
      };
    });
    return {
      key: "projects",
      title: "Projects",
      items,
      add: { action: "toggleProjectPanel", iconSvg: haloIcons.chevron, tooltip: visible.projects ? "Hide Projects panel" : "Show Projects panel" },
      collapsed: "active",
      maxHeight: 260,
      tabs: groups.length && !q ? { action: "selectGroup", active: group ? group.id : "all", items: [{ id: "all", label: "All", count: all.length }, ...groups.map((g) => ({ id: g.id, label: g.name, count: g.projectIds.length }))] } : void 0
    };
  };
  const chatsSection = () => {
    if (!chats || chats.workspaceId !== ws?.id) return null;
    const q = query.trim().toLowerCase();
    const list = (chats.conversations || []).filter((c) => !q || `${c.title} ${c.provider}`.toLowerCase().includes(q)).slice(0, CHAT_LIMIT);
    const items = list.map((c) => ({
      id: `chat:${c.id}`,
      title: c.title,
      detail: c.provider,
      iconSvg: haloIcons.chat,
      action: "chat",
      value: c.id,
      active: c.id === chats.activeId && !!visible.ai,
      busy: c.status === "busy" || c.status === "waiting"
    }));
    if ((chats.conversations || []).length > list.length || list.length) items.push({ id: "chats-all", title: "All chats…", iconSvg: haloIcons.history, action: "history", value: null });
    return { key: "chats", title: "Chats", items, collapsed: "none" };
  };
  const placeName = (workspaceId) => {
    for (const p of projects?.projects || []) {
      if (p.id === workspaceId) return p.name;
      const t = p.tasks.find((t2) => t2.id === workspaceId);
      if (t) return `${p.name} / ${t.name}`;
    }
    return workspaceId === ws?.id ? ws?.name : void 0;
  };
  const finishedRows = /* @__PURE__ */ new Map();
  let lastRunning = /* @__PURE__ */ new Map();
  const FINISHED_LIMIT = 6;
  const workingSection = () => {
    const count = busyCount();
    const running = [];
    if (workingChats || workingAgents) {
      const fraction = (p) => p && Number.isFinite(p.percent) ? Math.max(0, Math.min(100, p.percent)) / 100 : null;
      const where = (p, place) => [p?.note, place].filter(Boolean).join(" · ") || void 0;
      for (const c of workingChats || []) running.push({
        id: `chat:${c.id}`,
        label: c.title || "Chat",
        detail: where(chatProgress?.[c.id], placeName(c.workspaceId)),
        iconSvg: haloIcons.chat,
        progress: fraction(chatProgress?.[c.id]),
        state: "running",
        action: "openAgent",
        value: { kind: "chat", id: c.id, workspaceId: c.workspaceId },
        tooltip: "Open this chat and its project"
      });
      for (const a of workingAgents || []) {
        const desktop = chatProgress?.[a.id];
        const progress = desktop && (!a.progress || Number(desktop.at) >= Number(a.progress.at || 0)) ? desktop : a.progress;
        running.push({
          id: `agent:${a.id}`,
          label: a.name || (a.workflow ? "Workflow agent" : "Background agent"),
          detail: where(progress, [a.workflow ? "Workflow" : null, placeName(a.workspaceId)].filter(Boolean).join(" · ")),
          progress: fraction(progress),
          state: "running",
          iconSvg: a.workflow ? sidebarIcons.workflow : sidebarIcons.bot,
          action: "openAgent",
          value: { kind: a.workflow ? "workflow" : "agent", id: a.id, workspaceId: a.workspaceId, workflow: a.workflow || null },
          tooltip: "Open this agent and its project"
        });
      }
      const now = new Map(running.map((t) => [t.id, t]));
      for (const [id2, t] of lastRunning) if (!now.has(id2)) {
        finishedRows.delete(id2);
        finishedRows.set(id2, {
          ...t,
          state: "done",
          progress: 1,
          detail: t.value?.workspaceId ? placeName(t.value.workspaceId) : void 0,
          value: { ...t.value, dismiss: id2 },
          tooltip: "Finished · open it to dismiss"
        });
      }
      for (const id2 of now.keys()) finishedRows.delete(id2);
      while (finishedRows.size > FINISHED_LIMIT) finishedRows.delete(finishedRows.keys().next().value);
      lastRunning = now;
    } else if (count) running.push({ id: "agents-working", label: `${count} agent${count === 1 ? "" : "s"} working`, iconSvg: sidebarIcons.bot, progress: null, state: "running" });
    const done = [...finishedRows.values()].reverse();
    if (!running.length && !done.length) return null;
    const title = running.length ? `Working · ${count || running.length}` : "Finished";
    return { key: "working", title, items: [], tasks: [...running, ...done].slice(0, 10), collapsed: "none" };
  };
  const model = (ctx) => {
    const usage = haloUsage(limits);
    if (side === "left") {
      const machine = !ws ? "No project" : ws.location === "ssh" ? ws.ssh?.host || "SSH" : ws.location === "cloud" ? "Cloud" : "This computer";
      const sections = [
        projectsSection(),
        ...enabled("run-bar") ? [{ key: "run", title: "Run", items: [], embed: { type: "slot", key: "run-bar", module: "run-bar", height: 62, grow: true }, collapsed: "none" }] : [],
        { key: "menu", title: "Panels", items: panelItems(ctx, "left-top", ["projects"]) },
        { key: "tools", title: "Tools", items: panelItems(ctx, "left-bottom", ["projects"]) }
      ].filter(Boolean);
      return {
        side,
        expanded,
        focused,
        sections,
        busy: busyCount(),
        usage: [],
        header: {
          title: ws?.name || "Hato",
          subtitle: ws ? void 0 : "Select a project",
          logo: true,
          embed: enabled("git-branch") && ws ? { type: "slot", key: "git-branch", module: "git-branch", height: 28 } : void 0
        },
        search: { placeholder: "Search…", query },
        account: {
          initials: initialsOf(machine),
          name: machine,
          detail: error || (updates ? `${updates} module update${updates === 1 ? "" : "s"}` : ws ? ws.location === "local" ? "Local workspace" : ws.machineId : "Hato"),
          badge: updates || void 0,
          open: accountOpen,
          darkMode: colorMode !== "light",
          menu: [
            { key: "settings", label: "Settings", iconSvg: haloIcons.settings, action: "open", value: "settings" },
            { key: "plugins", label: "Plugins", iconSvg: haloIcons.plug, action: "open", value: "plugins" },
            { key: "modules", label: "Modules", iconSvg: haloIcons.modules, action: "open", value: "modules", badge: updates ? String(updates) : void 0 },
            { key: "layout", label: "Layout", iconSvg: haloIcons.layout, action: "open", value: "layout" }
          ],
          status: [
            { type: "approvalPanel", key: "approvals" },
            ...enabled("language-status") ? [{ type: "slot", key: "languages", module: "language-status", height: 24 }] : []
          ]
        }
      };
    }
    const chatsSec = chatsSection();
    return {
      side,
      expanded,
      focused,
      busy: busyCount(),
      usage,
      header: { title: "Assistant", subtitle: chats?.conversations?.length ? `${chats.conversations.length} chat${chats.conversations.length === 1 ? "" : "s"} in ${ws?.name || "this project"}` : ws?.name },
      primary: ws ? { label: "New chat", iconSvg: haloIcons.plus, action: "newChat", tooltip: "Start a new chat in this project" } : void 0,
      search: expanded ? { placeholder: "Search…", query } : void 0,
      sections: [
        ...workingSection() ? [workingSection()] : [],
        ...chatsSec ? [chatsSec] : [],
        { key: "agents", title: "Panels", items: panelItems(ctx, "right-top") },
        { key: "more", title: "Tools", items: panelItems(ctx, "right-bottom") }
      ]
    };
  };
  const togglePanel = (ctx, pid) => {
    if (!visible[pid]) focused = pid;
    ctx.events.emit(`${id}.togglePanel`, { id: pid });
  };
  const showPanel = (ctx, pid) => {
    if (!visible[pid]) togglePanel(ctx, pid);
    else focused = pid;
  };
  const watch = (ctx, key, fn) => {
    fn(ctx.state.get(key));
    const s = ctx.state.watch(key, (v) => {
      fn(v);
      ctx.ui.invalidate();
    });
    if (typeof s === "function") stops.push(s);
  };
  const setExpanded = (ctx, value) => {
    expanded = value;
    accountOpen = false;
    if (!expanded) query = "";
    publishWidth(ctx);
    ctx.ui.invalidate();
    ctx.events.emit(`${id}.expanded`, { expanded });
  };
  const request = (ctx, name, payload = {}) => ctx.events.emit(`${id}.${name}`, payload);
  const mod = {
    id,
    moduleApiVersion: 1,
    async activate(ctx) {
      watch(ctx, "workspace-layout.sidebarOrder", (v) => {
        order = normalizeSidebarOrder(v);
      });
      watch(ctx, "workspace-layout.sidebarButtons", (v) => {
        choices = normalizeSidebarButtons(v);
      });
      visible = ctx.state.get("workspace-layout.panels") || {};
      const s = ctx.state.watch("workspace-layout.panels", (value) => {
        const next = value || {};
        const opened = Object.keys(next).find((k) => next[k] && !visible[k] && buttons().some((p) => p.id === k));
        if (opened) focused = opened;
        visible = next;
        ctx.ui.invalidate();
      });
      if (typeof s === "function") stops.push(s);
      watch(ctx, "workspace-layout.appearance", (v) => {
        theme = typeof v?.theme === "string" ? v.theme : "ember";
        colorMode = typeof v?.mode === "string" ? v.mode : "system";
        effects = surfaceEffectsOf(v?.effects);
      });
      watch(ctx, "workspace-layout.moduleUpdates", (v) => {
        updates = Number(v) > 0 ? Number(v) : 0;
      });
      watch(ctx, "workspace.selected", (v) => {
        ws = v;
      });
      watch(ctx, "acp.limits", (v) => {
        limits = v;
      });
      watch(ctx, "ai-sessions.busy", (v) => {
        busyAi = v;
      });
      watch(ctx, "persistent-agents.busy", (v) => {
        busyAgents = v;
      });
      watch(ctx, "projects-panel.rail", (v) => {
        projects = v && Array.isArray(v.projects) ? v : null;
      });
      watch(ctx, "ai.rail", (v) => {
        chats = v && Array.isArray(v.conversations) ? v : null;
      });
      watch(ctx, "ai-sessions.working", (v) => {
        workingChats = Array.isArray(v) ? v : null;
      });
      watch(ctx, "persistent-agents.working", (v) => {
        workingAgents = Array.isArray(v) ? v : null;
      });
      let viaTool = {}, viaMarker = {};
      const merge = () => {
        const out = { ...viaMarker };
        for (const [id2, p] of Object.entries(viaTool)) if (!out[id2] || Number(p?.at) >= Number(out[id2]?.at)) out[id2] = p;
        chatProgress = out;
      };
      watch(ctx, "internal-mcp.progress", (v) => {
        viaTool = v && typeof v === "object" ? v : {};
        merge();
      });
      watch(ctx, "ai-sessions.progress", (v) => {
        viaMarker = v && typeof v === "object" ? v : {};
        merge();
      });
      watch(ctx, "workspace-layout.railExpanded", (v) => {
        const next = v?.[id] === true;
        if (next !== expanded) {
          expanded = next;
          if (!expanded) query = "";
        }
      });
      publishWidth(ctx);
      const s2 = ctx.state.watch("workspace-layout.railExpanded", () => publishWidth(ctx));
      if (typeof s2 === "function") stops.push(s2);
      try {
        contributions = await loadContributions(ctx);
      } catch (e) {
        ctx.log.warn("plugins.list failed", String(e));
      }
      syncPanels(ctx);
      stop = watchContributions(ctx, (c) => {
        contributions = c;
        syncPanels(ctx);
        ctx.ui.invalidate();
      });
    },
    methods: {
      /** Expand or collapse this rail. */
      setExpanded: (ctx, a) => {
        setExpanded(ctx, a?.expanded === true);
        return { expanded };
      }
    },
    deactivate() {
      stop?.();
      stops.splice(0).forEach((s) => s());
      for (const s of panelStops.values()) s();
      panelStops.clear();
    },
    render(ctx) {
      const m = model(ctx);
      if (!focused || !visible[focused] && !open[focused]) focused = m.sections.flatMap((s) => s.items).find((i) => i.active && !i.id.includes(":"))?.id || null;
      m.focused = focused;
      m.effects = effects;
      return haloRail(m);
    },
    async onEvent(ctx, ev) {
      const v = ev.value;
      switch (ev.action) {
        case "toggle":
          if (!buttons().some((panel) => panel.id === v)) break;
          if (Array.isArray(children[v])) {
            open[v] = !expanded || !open[v];
            if (open[v]) focused = v;
            if (!expanded) setExpanded(ctx, true);
            ctx.ui.invalidate();
          } else togglePanel(ctx, v);
          break;
        case "group":
          open[v] = !(open[v] ?? (typeof v === "string" && v.startsWith("project:") && projects?.projects.some((p) => `project:${p.id}` === v && (p.id === projects.selected || p.tasks.some((t) => t.id === projects.selected)))));
          ctx.ui.invalidate();
          break;
        case "child":
          if (v && typeof v.panel === "string") ctx.events.emit(`${id}.panelChild`, { panel: v.panel, child: v.child });
          break;
        case "expand":
          setExpanded(ctx, v === true);
          break;
        case "query":
          query = typeof v === "string" ? v : "";
          ctx.ui.invalidate();
          break;
        case "queryClear":
          query = "";
          ctx.ui.invalidate();
          break;
        case "querySubmit": {
          const first = model(ctx).sections.flatMap((s) => s.items)[0];
          query = "";
          if (first) await mod.onEvent(ctx, { action: first.action, value: first.value });
          ctx.ui.invalidate();
          break;
        }
        case "workspace":
          if (typeof v === "string") request(ctx, "selectWorkspace", { workspaceId: v });
          break;
        case "addProject":
          showPanel(ctx, "projects");
          request(ctx, "addProject");
          break;
        case "toggleProjectPanel":
          togglePanel(ctx, "projects");
          ctx.ui.invalidate();
          break;
        case "openPanel":
          if (typeof v === "string") showPanel(ctx, v);
          ctx.ui.invalidate();
          break;
        case "newChat":
          showPanel(ctx, "ai");
          request(ctx, "newChat");
          break;
        case "chat":
          showPanel(ctx, "ai");
          request(ctx, "selectConversation", { id: v });
          break;
        case "history":
          showPanel(ctx, "ai");
          request(ctx, "openHistory");
          break;
        case "selectGroup":
          if (typeof v === "string") request(ctx, "selectGroup", { id: v });
          break;
        case "openAgent":
          if (typeof v?.dismiss === "string") {
            finishedRows.delete(v.dismiss);
            ctx.ui.invalidate();
          }
          if (v && typeof v.workspaceId === "string") {
            showPanel(ctx, v.kind === "workflow" ? "workflows" : "ai");
            request(ctx, "openAgent", { kind: v.kind, id: v.id, workspaceId: v.workspaceId, workflow: v.workflow ?? null });
          }
          break;
        case "usage":
          if (typeof v === "string") request(ctx, "refreshUsage", { provider: v });
          break;
        case "account":
          accountOpen = v === true;
          ctx.ui.invalidate();
          break;
        case "open":
          accountOpen = false;
          ctx.ui.invalidate();
          if (typeof v === "string") request(ctx, "open", { target: v });
          break;
        case "darkMode":
          request(ctx, "appearance", { mode: v === true ? "dark" : "light" });
          break;
      }
    }
  };
  return mod;
}

// modules/ui/left-sidebar/src/index.ts
var index_default = activitySidebar("left-sidebar", "left");
export {
  index_default as default
};
