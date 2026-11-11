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
        if (!field || field.type === "action") throw new Error("Setting is no longer available");
        if (field.type === "order") parseOrder(edit.value, field.items.map((i) => i.id), field.allowSpacers);
        else if (field.type === "toggle" ? typeof edit.value !== "boolean" : typeof edit.value !== "string" || field.type === "select" && !field.options.some((o) => o.value === edit.value)) {
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
      } catch (error) {
        publish(error instanceof Error ? error.message : String(error));
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

// modules/services/path-highlights/src/model.ts
var MAX_RULES = 200;
var defaultSettings = () => ({ enabled: true, opacity: 6, rules: [] });
function relativePattern(value) {
  const path = value.trim().replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/\/+$/, "");
  if (!path || path.length > 400 || /^\/|^[a-z]:/i.test(path) || /[\x00-\x1f]/.test(path) || path.split("/").some((p) => p === ".." || p === ".")) throw Error("Use a relative path such as src/test or **/generated. Absolute paths and .. are not allowed.");
  return path.replace(/\/{2,}/g, "/");
}
function hexColor(value) {
  const color = value.trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(color)) throw Error("Enter a color as #RRGGBB, for example #22c55e.");
  return color;
}
function opacityValue(value) {
  const n = typeof value === "string" && !value.trim() ? NaN : Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 100) throw Error("Opacity must be a whole number from 0 to 100.");
  return n;
}
function pathPattern(value) {
  let path = relativePattern(value);
  while (path.endsWith("/**")) path = path.slice(0, -3);
  const parts = path.split("/");
  return "^" + parts.map((part, i) => {
    if (part === "**") return i === parts.length - 1 ? ".*" : "(?:[^/]+/)*";
    const pattern = [...part].map((c) => c === "*" ? "[^/]*" : c === "?" ? "[^/]" : c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("");
    return pattern + (i < parts.length - 1 ? "/" : "");
  }).join("") + "(?:/|$)";
}
function readSettings(saved) {
  const settings2 = defaultSettings();
  if (typeof saved?.enabled === "boolean") settings2.enabled = saved.enabled;
  try {
    if (saved?.opacity !== void 0) settings2.opacity = opacityValue(saved.opacity);
  } catch {
  }
  const seen = /* @__PURE__ */ new Set();
  for (const rule of Array.isArray(saved?.rules) ? saved.rules.slice(0, MAX_RULES) : []) {
    try {
      if (typeof rule.id !== "string" || !/^[a-z0-9-]{1,80}$/i.test(rule.id) || seen.has(rule.id)) continue;
      settings2.rules.push({ id: rule.id, path: relativePattern(rule.path), color: hexColor(rule.color), enabled: rule.enabled !== false });
      seen.add(rule.id);
    } catch {
    }
  }
  return settings2;
}
function presentation(settings2) {
  const alpha = Math.round(settings2.opacity * 255 / 100).toString(16).padStart(2, "0");
  return { rules: settings2.enabled ? settings2.rules.filter((rule) => rule.enabled).map((rule) => ({
    id: rule.id,
    priority: 100,
    pathPattern: pathPattern(rule.path),
    background: rule.color + alpha
  })) : [] };
}

// modules/services/path-highlights/src/index.ts
var KEY = "path-highlights.shared.v1";
var settings = defaultSettings();
var index_default = {
  id: "path-highlights",
  moduleApiVersion: 1,
  async activate(ctx) {
    settings = readSettings(await ctx.modules.call("persistence", "settings.get", { key: KEY }));
    const publish = () => ctx.state.set("path-highlights.filePresentation", presentation(settings));
    const save = async (next) => {
      await ctx.modules.call("persistence", "settings.set", { key: KEY, value: next });
      settings = next;
      publish();
    };
    publish();
    let publishSettings = () => {
    };
    const openSection = (section) => {
      publishSettings();
      ctx.events.emit("settings.open", { category: JSON.stringify(["path-highlights", section]) });
    };
    publishSettings = exportSettings(ctx, () => [{
      key: "shared",
      title: "Path highlights",
      group: "Appearance",
      description: "Shared across all projects, tasks and workspaces. Add a rule to choose its relative path and color. Folder rules include their contents; **/src/test also matches nested modules. User rules override language colors; later rules win when they overlap.",
      fields: [
        { key: "enabled", label: "Enable path coloring", type: "toggle", value: settings.enabled },
        { key: "opacity", label: "Background opacity (%)", type: "text", value: String(settings.opacity), description: "0–100. Low values keep file names easy to read. Press Enter to save." },
        { key: "add", label: "Add rule", buttonLabel: "Add highlight rule", type: "action", disabled: settings.rules.length >= MAX_RULES }
      ]
    }, ...settings.rules.map((rule) => ({
      key: `rule:${rule.id}`,
      title: `Path highlight: ${rule.path}`,
      group: "Appearance",
      description: "This rule is shared across all workspaces and tasks. Edit the path or color and press Enter to save.",
      fields: [
        { key: "enabled", label: "Enable this rule", type: "toggle", value: rule.enabled },
        { key: "path", label: "Relative path", type: "text", value: rule.path, placeholder: "src/test or **/generated" },
        { key: "color", label: "Color (#RRGGBB)", type: "text", value: rule.color, placeholder: "#22c55e" },
        { key: "remove", label: "Remove rule", buttonLabel: "Remove highlight rule", type: "action" }
      ]
    }))], async (section, key, value) => {
      if (section === "shared") {
        if (key === "enabled" && typeof value === "boolean") return save({ ...settings, enabled: value });
        if (key === "opacity") return save({ ...settings, opacity: opacityValue(String(value)) });
      }
      const rule = settings.rules.find((rule2) => section === `rule:${rule2.id}`);
      if (!rule) throw Error("Highlight rule is no longer available");
      const next = { ...rule };
      if (key === "path") next.path = relativePattern(String(value));
      else if (key === "color") next.color = hexColor(String(value));
      else if (key === "enabled" && typeof value === "boolean") next.enabled = value;
      else throw Error("Invalid highlight setting");
      await save({ ...settings, rules: settings.rules.map((rule2) => rule2.id === next.id ? next : rule2) });
    }, { action: async (section, key) => {
      if (section === "shared" && key === "add") {
        if (settings.rules.length >= MAX_RULES) throw Error("Remove an existing rule before adding another");
        const rule = { id: crypto.randomUUID(), path: "src/test", color: "#22c55e", enabled: true };
        await save({ ...settings, rules: [...settings.rules, rule] });
        openSection(`rule:${rule.id}`);
      } else if (key === "remove") {
        await save({ ...settings, rules: settings.rules.filter((rule) => section !== `rule:${rule.id}`) });
        openSection("shared");
      } else throw Error("Unknown highlight action");
    } });
  }
};
export {
  index_default as default
};
