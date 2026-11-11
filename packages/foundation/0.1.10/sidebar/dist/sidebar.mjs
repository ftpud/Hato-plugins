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
  // Bottom dock
  terminal: outline('<path d="m4 17 6-6-6-6M12 19h8"/>'),
  // Kept for user plugins that reference the old name.
  remote: outline('<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01M11 6.5h6M11 17.5h6"/>')
};

// ../sdk/chat-style.ts
var sidebarButtonStyle = (selected) => ({
  padding: 0,
  noShrink: true,
  radius: 10,
  borderWidth: 0,
  background: selected ? "selection" : "surface",
  color: selected ? "primary" : "muted"
});

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

// ../sdk/activity-sidebar.ts
var fallbackIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/></svg>`;
function activitySidebar(id, side) {
  let visible = {};
  let choices = {};
  let order = {};
  let sharing = null;
  let grouping = true;
  let contributions = null;
  let stop = null;
  const buttons = () => contributions ? sidebarPanels(contributions, choices, side) : [];
  return {
    id,
    moduleApiVersion: 1,
    async activate(ctx) {
      order = normalizeSidebarOrder(ctx.state.get("workspace-layout.sidebarOrder"));
      ctx.state.watch("workspace-layout.sidebarOrder", (value) => {
        order = normalizeSidebarOrder(value);
        ctx.ui.invalidate();
      });
      choices = normalizeSidebarButtons(ctx.state.get("workspace-layout.sidebarButtons"));
      ctx.state.watch("workspace-layout.sidebarButtons", (value) => {
        choices = normalizeSidebarButtons(value);
        ctx.ui.invalidate();
      });
      const asSharing = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : null;
      sharing = asSharing(ctx.state.get("workspace-layout.panelSharing"));
      ctx.state.watch("workspace-layout.panelSharing", (value) => {
        sharing = asSharing(value);
        ctx.ui.invalidate();
      });
      grouping = ctx.state.get("workspace-layout.sidebarGrouping") !== false;
      ctx.state.watch("workspace-layout.sidebarGrouping", (value) => {
        grouping = value !== false;
        ctx.ui.invalidate();
      });
      visible = ctx.state.get("workspace-layout.panels") || {};
      ctx.state.watch("workspace-layout.panels", (value) => {
        visible = value || {};
        ctx.ui.invalidate();
      });
      try {
        contributions = await loadContributions(ctx);
      } catch (e) {
        ctx.log.warn("plugins.list failed", String(e));
      }
      stop = watchContributions(ctx, (c) => {
        contributions = c;
        ctx.ui.invalidate();
      });
    },
    deactivate() {
      stop?.();
    },
    render() {
      return { type: "column", key: "activity-sidebar", grow: true, bg: "panel", padding: 3, gap: 4, borderSide: side === "left" ? "right" : "left", children: (() => {
        const panels = buttons();
        const top = contributions ? orderedSidebarItems(contributions, choices, order, `${side}-top`) : [];
        const bottom = contributions ? orderedSidebarItems(contributions, choices, order, `${side}-bottom`) : [];
        const button = (panel) => {
          const title = panel.activity?.title || panel.title;
          const iconSvg = panel.activity?.iconSvg || panel.activity?.icon && sidebarIcons[panel.activity.icon] || fallbackIcon;
          return {
            type: "button",
            key: panel.id,
            text: "",
            iconSvg,
            iconSize: 22,
            width: 36,
            height: 36,
            style: sidebarButtonStyle(!!visible[panel.id]),
            variant: visible[panel.id] ? "primary" : "ghost",
            action: "toggle",
            value: panel.id,
            tooltip: `${visible[panel.id] && !panel.pinned ? "Hide" : "Show"} ${title}`
          };
        };
        const item = (id2) => id2.startsWith("@spacer:") ? { type: "column", key: id2, height: 12, children: [] } : button(panels.find((p) => p.id === id2));
        const space = (id2) => sharing?.[id2] || `solo:${id2}`;
        const grouped = (ids) => {
          if (!grouping || !sharing) return ids.map(item);
          const out = [];
          ids.forEach((id2, i) => {
            const prev = ids[i - 1];
            if (prev && !prev.startsWith("@spacer:") && !id2.startsWith("@spacer:") && space(prev) !== space(id2))
              out.push({ type: "row", key: `group-rule:${id2}`, height: 9, align: "center", style: { justify: "center" }, children: [
                { type: "column", key: "rule", width: 18, height: 1, style: { background: "border", width: 18, height: 1 }, children: [] }
              ] });
            out.push(item(id2));
          });
          return out;
        };
        return [...grouped(top), ...bottom.length ? [{ type: "spacer", key: "sidebar-spacer" }] : [], ...grouped(bottom)];
      })() };
    },
    onEvent(ctx, ev) {
      if (ev.action === "toggle" && buttons().some((panel) => panel.id === ev.value)) ctx.events.emit(`${id}.togglePanel`, { id: ev.value });
    }
  };
}

// modules/ui/sidebar/src/index.ts
var index_default = activitySidebar("sidebar", "right");
export {
  index_default as default
};
