// modules/ui/git-history/src/graph.ts
var COLORS = ["#5b6cf0", "#2fa36b", "#e5534b", "#d89620", "#a259d9", "#1e9bd7", "#d9488f", "#7a8b99"];
var PAD = 9;
var SPACING = 14;
var MIN_WIDTH = 28;
var MAX_WIDTH = 220;
var DIM = 0.22;
function refNames(decoration = "") {
  return decoration.split(",").map((r) => r.trim().replace(/^HEAD -> /, "").replace(/^tag: /, "").replace(/^refs\/(heads|remotes|tags)\//, "")).filter((r) => r && r !== "HEAD");
}
function mergedBranch(subject = "") {
  const m = /^Merge (?:remote-tracking )?branch '([^']+)'/.exec(subject) || /^Merge pull request #\d+ from (\S+)/.exec(subject) || /^Merged? in (\S+)/.exec(subject);
  return m ? m[1] : null;
}
function layoutGraph(commits2, height = 58) {
  const rows = [];
  const branchName = /* @__PURE__ */ new Map();
  const namedByRef = /* @__PURE__ */ new Set();
  let lanes = [], branches2 = 0, maxLanes = 1;
  const mid = height / 2;
  for (const commit of commits2) {
    let lane = lanes.findIndex((l) => l.id === commit.id);
    const isTip = lane < 0;
    if (isTip) {
      lane = lanes.length;
      lanes.push({ id: commit.id, branch: branches2++ });
    }
    const before = lanes.slice();
    const branch = before[lane].branch;
    const names = refNames(commit.refs);
    if (names.length && !namedByRef.has(branch)) {
      branchName.set(branch, names.join(", "));
      namedByRef.add(branch);
    }
    const after = before.slice();
    after.splice(lane, 1);
    const parentEdges = [];
    let insert = lane;
    commit.parents.forEach((parent, i) => {
      const existing = after.find((l2) => l2.id === parent);
      if (existing) {
        parentEdges.push({ lane: existing, joins: true });
        return;
      }
      const l = { id: parent, branch: i === 0 ? branch : branches2++ };
      const merged = i > 0 ? mergedBranch(commit.subject) : null;
      if (merged) branchName.set(l.branch, merged);
      after.splice(insert++, 0, l);
      parentEdges.push({ lane: l, joins: false });
    });
    const edges = [];
    before.forEach((l, i) => {
      if (i === lane) {
        if (!isTip) edges.push({ x1: i, y1: 0, x2: i, y2: mid, branch });
        return;
      }
      edges.push({ x1: i, y1: 0, x2: after.indexOf(l), y2: height, branch: l.branch });
    });
    for (const p of parentEdges) edges.push({ x1: lane, y1: mid, x2: after.indexOf(p.lane), y2: height, branch: p.joins ? branch : p.lane.branch });
    rows.push({ id: commit.id, lane, branch, edges });
    maxLanes = Math.max(maxLanes, before.length, after.length);
    lanes = after;
  }
  const contained = /* @__PURE__ */ new Map();
  for (const c of commits2) {
    const set = contained.get(c.id) || /* @__PURE__ */ new Set();
    for (const name of refNames(c.refs)) set.add(name);
    contained.set(c.id, set);
    for (const p of c.parents) {
      const parent = contained.get(p) || /* @__PURE__ */ new Set();
      for (const name of set) parent.add(name);
      contained.set(p, parent);
    }
  }
  const natural = PAD * 2 + (maxLanes - 1) * SPACING;
  const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, natural));
  const spacing = maxLanes > 1 ? Math.min(SPACING, (width - PAD * 2) / (maxLanes - 1)) : SPACING;
  return { rows, width, spacing, branchName, containedIn: new Map([...contained].map(([id, s]) => [id, [...s]])) };
}
function commitGraph(commits2, height = 58, highlight = null) {
  const g = layoutGraph(commits2, height);
  const x = (lane) => +(PAD + lane * g.spacing).toFixed(2);
  const color = (branch) => COLORS[branch % COLORS.length];
  const look = (branch) => highlight === null ? "" : branch === highlight ? ' stroke-width="3"' : ` opacity="${DIM}"`;
  const path = (e) => {
    const [x1, x2] = [x(e.x1), x(e.x2)];
    if (x1 === x2) return `M${x1} ${e.y1}V${e.y2}`;
    const bend = (e.y2 - e.y1) / 2;
    return `M${x1} ${e.y1}C${x1} ${e.y1 + bend} ${x2} ${e.y2 - bend} ${x2} ${e.y2}`;
  };
  const svgs = /* @__PURE__ */ new Map();
  const branchOf = /* @__PURE__ */ new Map();
  for (const r of g.rows) {
    branchOf.set(r.id, r.branch);
    const lines = r.edges.map((e) => `<path stroke="${color(e.branch)}"${look(e.branch)} d="${path(e)}"/>`).join("");
    const dot = `<circle cx="${x(r.lane)}" cy="${height / 2}" r="${highlight === r.branch ? 5.5 : 4.5}" fill="${color(r.branch)}"${highlight !== null && highlight !== r.branch ? ` opacity="${DIM}"` : ""}/>`;
    svgs.set(r.id, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${g.width} ${height}" width="${g.width}" height="${height}" fill="none" stroke-width="2" stroke-linecap="round">${lines}${dot}</svg>`);
  }
  return { svgs, width: g.width, height, branchOf, branchName: g.branchName, containedIn: g.containedIn };
}

// ../sdk/runtime.ts
function errMsg(e) {
  return e && (e.message || String(e)) || "unknown error";
}

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

// ../sdk/ui-controls.ts
var HEX = /^#[0-9a-fA-F]{6}$/;
function validControlValue(field, value) {
  if (typeof value !== "string") return false;
  if (value === "") return !!field.allowDefault;
  if (field.type === "color") return HEX.test(value);
  const n = Number(value);
  return Number.isFinite(n) && n >= field.min && n <= field.max;
}

// ../sdk/settings.ts
function exportSettings(ctx, getSections, onChange, options = {}) {
  const publish = (error2 = null) => {
    const value = { sections: getSections(), error: error2, ...options.reset ? { resetLabel: options.reset.label } : {} };
    ctx.state.set(`${ctx.moduleId}.settings`, value);
  };
  let queue = Promise.resolve();
  ctx.events.on("settings.change", (edit) => {
    if (edit?.module !== ctx.moduleId) return;
    queue = queue.then(async () => {
      try {
        const section = getSections().find((s) => s.key === edit.section);
        const field = section?.fields.find((f) => f.key === edit.key);
        if (!field || field.type === "action") throw new Error("Setting is no longer available");
        if (field.type === "order") parseOrder(edit.value, field.items.map((i) => i.id), field.allowSpacers);
        else if (field.type === "color" || field.type === "range") {
          if (!validControlValue(field, edit.value)) throw new Error(field.type === "color" ? "Enter a color as #RRGGBB" : `Choose a value from ${field.min} to ${field.max}`);
        } else if (field.type === "toggle" ? typeof edit.value !== "boolean" : typeof edit.value !== "string" || field.type === "select" && !field.options.some((o) => o.value === edit.value)) {
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
  if (options.action) ctx.events.on("settings.action", (event) => {
    if (event?.module !== ctx.moduleId) return;
    const run = async () => {
      try {
        const section = getSections().find((s) => s.key === event.section);
        const field = section?.fields.find((f) => f.key === event.key);
        if (!field || field.type !== "action" || field.disabled) throw new Error("Action is not available");
        await options.action(section.key, field.key);
        publish();
      } catch (error2) {
        publish(error2 instanceof Error ? error2.message : String(error2));
      }
      if (options.invalidate !== false) ctx.ui.invalidate();
    };
    void run();
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

// modules/ui/git-history/src/index.ts
var visible = false;
var mode = "split";
var wrapLines = true;
var filesCollapsed = true;
var publishSettings = () => {
};
var layoutOptions = [{ value: "split", label: "Side by side" }, { value: "unified", label: "Unified" }];
async function applySetting(ctx, key, value) {
  if (key === "diffMode" ? value !== "split" && value !== "unified" : !["wrapLines", "filesCollapsed"].includes(key) || typeof value !== "boolean") throw new Error("Invalid Git history setting");
  await ctx.modules.call("persistence", "settings.set", { key: `git-history.${key}`, value });
  if (key === "diffMode") mode = value;
  else if (key === "wrapLines") wrapLines = value;
  else filesCollapsed = value;
  ctx.ui.invalidate();
}
var ws;
var branches = [];
var tags = [];
var commits = [];
var comparison = null;
var hovered = null;
var ref = "ALL";
var query = "";
var branchQuery = "";
var chosen = "";
var error = "";
var loading = false;
var more = false;
var epoch = 0;
async function refresh(ctx, append = false) {
  if (!ws || !visible) return;
  const mine = ++epoch, id = ws.id;
  loading = true;
  ctx.ui.invalidate();
  try {
    const [catalog, r] = await Promise.all([
      ctx.modules.call("git", "branches", { workspaceId: id }),
      ctx.modules.call("git", "history", { workspaceId: id, ref, skip: append ? commits.length : 0 })
    ]);
    if (mine !== epoch) return;
    branches = [...catalog.local, ...catalog.remote];
    tags = r.tags;
    commits = append ? [...commits, ...r.commits] : r.commits;
    more = r.more;
    error = "";
  } catch (e) {
    if (mine === epoch) error = errMsg(e);
  } finally {
    if (mine === epoch) loading = false;
    ctx.ui.invalidate();
  }
}
var mod = {
  id: "git-history",
  moduleApiVersion: 1,
  async activate(ctx, prev) {
    const get = (key) => ctx.modules.call("persistence", "settings.get", { key: `git-history.${key}` });
    const [savedMode, savedWrap, savedCollapsed] = await Promise.all([get("diffMode"), get("wrapLines"), get("filesCollapsed")]);
    mode = savedMode === "unified" ? "unified" : "split";
    wrapLines = typeof savedWrap === "boolean" ? savedWrap : true;
    filesCollapsed = typeof savedCollapsed === "boolean" ? savedCollapsed : true;
    publishSettings = exportSettings(ctx, () => [{ key: "git-history", title: "Git history", fields: [
      {
        key: "diffMode",
        label: "Diff layout",
        type: "select",
        value: mode,
        options: layoutOptions,
        description: "Compare commit changes side by side or in a unified view."
      },
      { key: "wrapLines", label: "Wrap long lines", type: "toggle", value: wrapLines },
      {
        key: "filesCollapsed",
        label: "Start file previews collapsed",
        type: "toggle",
        value: filesCollapsed,
        description: "Applies when a commit preview is first opened."
      }
    ] }], (_section, key, value) => applySetting(ctx, key, value));
    visible = !!ctx.state.get("workspace-layout.panels")?.["git-history"];
    ctx.state.watch("workspace-layout.panels", (v) => {
      const next = !!v?.["git-history"];
      if (next === visible) return;
      visible = next;
      if (visible) void refresh(ctx);
    });
    ws = ctx.state.get("workspace.selected");
    if (prev && prev.workspaceId === ws?.id) {
      ref = prev.ref || "ALL";
      query = prev.query || "";
      branchQuery = prev.branchQuery || "";
      chosen = prev.chosen || "";
      branches = prev.branches || [];
      tags = prev.tags || [];
      commits = prev.commits || [];
      comparison = prev.comparison || null;
      more = !!prev.more;
    }
    ctx.state.watch("workspace.selected", (v) => {
      if (ws?.id === v?.id) return;
      epoch++;
      ws = v;
      ref = "ALL";
      chosen = "";
      commits = [];
      comparison = null;
      error = "";
      void refresh(ctx);
    });
    ctx.events.on("git.changed", (v) => {
      if (v.workspaceId === ws?.id) void refresh(ctx);
    });
    await refresh(ctx);
  },
  deactivate() {
    epoch++;
  },
  snapshot: () => ({ workspaceId: ws?.id, ref, query, branchQuery, chosen, branches, tags, commits, comparison, more }),
  render() {
    if (!ws) return { type: "label", key: "empty", text: "Select a project or task.", color: "muted", padding: 12 };
    const options = [{ value: "ALL", label: "All branches" }, { value: "HEAD", label: "Current branch" }, ...branches.map((b) => ({ value: b.ref, label: b.name })), ...tags.map((t) => ({ value: t, label: t.replace("refs/tags/", "Tag · ") }))].filter((b) => b.value === ref || b.label.toLowerCase().includes(branchQuery.toLowerCase()));
    const layout = commitGraph(commits, 58);
    const highlight = hovered !== null ? layout.branchOf.get(hovered) ?? null : null;
    const graph = highlight === null ? layout : commitGraph(commits, 58, highlight);
    const tooltip = (c) => {
      const branch = graph.branchOf.get(c.id);
      const name = branch === void 0 ? void 0 : graph.branchName.get(branch);
      const all = graph.containedIn.get(c.id) || [];
      const shown2 = all.slice(0, 6).join(", ") + (all.length > 6 ? ` +${all.length - 6} more` : "");
      return [`Branch: ${name || "unnamed (no ref points here)"}`, all.length ? `Contained in: ${shown2}` : "Not in any loaded branch or tag"].join("\n");
    };
    const shown = commits.filter((c) => `${c.subject} ${c.author} ${c.id} ${c.refs}`.toLowerCase().includes(query.toLowerCase()));
    return { type: "column", key: "root", padding: 8, gap: 8, grow: true, children: [
      { type: "row", key: "toolbar", gap: 6, wrap: true, children: [
        { type: "textInput", key: "query", value: query, placeholder: "Search loaded commits…", changeAction: "query", grow: true },
        { type: "select", key: "diff-mode", label: "Diff: ", value: mode, options: layoutOptions, action: "diffMode", tooltip: "Git history diff layout" },
        { type: "button", key: "refresh", text: "Refresh", action: "refresh", small: true, disabled: loading }
      ] },
      ...error ? [{ type: "status", key: "error", text: error, level: "error" }] : [],
      ...loading ? [{ type: "progress", key: "loading", indeterminate: true }] : [],
      { type: "split", key: "history", direction: "horizontal", sizes: [0.18, 0.32, 0.5], grow: true, children: [
        { type: "column", key: "refs", grow: true, gap: 6, children: [
          { type: "label", key: "title", text: "Branches & tags", weight: "semibold", size: "sm" },
          { type: "textInput", key: "refs-query", value: branchQuery, placeholder: "Find a ref…", changeAction: "branchQuery" },
          { type: "tree", key: "ref-tree", grow: true, rowHeight: 32, selectAction: "ref", expandAction: "expand", rows: options.map((b) => ({
            key: b.value,
            label: b.label,
            depth: b.value.startsWith("refs/") ? 1 : 0,
            badge: b.value.startsWith("refs/remotes/") ? "remote" : b.value.startsWith("refs/tags/") ? "tag" : branches.find((branch) => branch.ref === b.value)?.current ? "current" : void 0,
            expandable: false,
            expanded: false,
            selected: ref === b.value
          })) }
        ] },
        { type: "column", key: "log", grow: true, children: [
          { type: "tree", key: "commits", hoverAction: "hoverCommit", rowHeight: graph.height, rowGap: 0, iconSize: 40, iconWidth: graph.width, iconHeight: graph.height, indent: 0, grow: true, expandAction: "expand", selectAction: "commit", rows: shown.map((c) => ({
            key: c.id,
            label: c.subject,
            iconSvg: graph.svgs.get(c.id),
            tooltip: tooltip(c),
            detail: `${c.id.slice(0, 8)} · ${c.author} · ${c.date.slice(0, 10)}`,
            badge: c.refs || void 0,
            depth: 0,
            expandable: false,
            expanded: false,
            selected: chosen === c.id,
            iconColor: "primary"
          })) },
          ...more ? [{ type: "button", key: "more", text: "Load older commits", action: "more", small: true, disabled: loading }] : []
        ] },
        { type: "column", key: "detail", grow: true, gap: 6, children: [
          { type: "label", key: "subject", text: commits.find((c) => c.id === chosen)?.subject || "Select a commit", weight: "semibold", wrap: true, size: "sm" },
          { type: "diff", key: "diff", filesCollapsed, document: comparison?.document || null, mode, grow: true, softWrap: wrapLines, placeholder: chosen ? "Loading commit…" : "Choose a commit to review its changes.", changeNavigation: { previous: "Previous change", next: "Next change" } }
        ] }
      ] }
    ] };
  },
  async onEvent(ctx, ev) {
    try {
      if (ev.action === "hoverCommit") {
        const next = ev.rowKey || null;
        if (next !== hovered) {
          hovered = next;
          ctx.ui.invalidate();
        }
        return;
      }
      if (ev.action === "diffMode") {
        await applySetting(ctx, "diffMode", String(ev.value ?? ev.rowKey));
        publishSettings();
      } else if (ev.action === "branchQuery") branchQuery = String(ev.value ?? "");
      else if (ev.action === "query") query = String(ev.value ?? "");
      else if (ev.action === "ref") {
        ref = String(ev.value ?? ev.rowKey);
        chosen = "";
        comparison = null;
        commits = [];
        await refresh(ctx);
      } else if (ev.action === "refresh" || ev.action === "more") await refresh(ctx, ev.action === "more");
      else if (ev.action === "commit") {
        const id = String(ev.rowKey), workspaceId = ws.id;
        chosen = id;
        comparison = null;
        ctx.ui.invalidate();
        const r = await ctx.modules.call("git", "commitDiff", { workspaceId, id });
        if (ws?.id === workspaceId && chosen === id) comparison = r;
      }
    } catch (e) {
      error = errMsg(e);
    }
    ctx.ui.invalidate();
  }
};
var index_default = mod;
export {
  index_default as default
};
