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

// modules/services/language-java/src/presentation.ts
var defaults = {
  icons: true,
  backgrounds: true,
  sources: "**/src/main/java",
  tests: "**/src/test/java",
  resources: "**/src/main/resources",
  testResources: "**/src/test/resources"
};
var glyphs = {
  file: "M9 7h7v7a4 4 0 0 1-8 0",
  class: "M15 8a5 5 0 1 0 0 8",
  interface: "M9 7h6m-3 0v10m-3 0h6",
  enum: "M15 7H9v10h6m-6-5h5",
  record: "M9 17V7h3a3 3 0 0 1 0 6H9m3 0 4 4",
  annotation: "M15 15v-5a3 3 0 1 0-3 5c2 0 3-2 3-3m0 1a2 2 0 0 0 4 0v-1a7 7 0 1 0-4 6",
  package: "m7 9 5-3 5 3v7l-5 3-5-3V9m0 0 5 3 5-3m-5 3v7",
  module: "M6 6h5v5H6zm7 0h5v5h-5zM6 13h5v5H6zm7 0h5v5h-5z"
};
var icon = (kind, color) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" opacity="0.35"/><path d="${glyphs[kind]}"/></svg>`;
function rootPattern(root) {
  const parts = root.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "").split("/");
  return "^" + parts.map((part) => part === "**" ? "(?:[^/]+/)*" : part.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*") + "/").join("").replace(/\/$/, "") + "(?:/|$)";
}
function javaFilePresentation(settings2) {
  const rules = [];
  if (settings2.backgrounds) for (const [key, background] of [
    ["sources", "#3b82f60d"],
    ["tests", "#22c55e0d"],
    ["resources", "#eab3080d"],
    ["testResources", "#f973160d"]
  ]) for (const root of settings2[key].split(/[,\r\n]+/).map((s) => s.trim()).filter(Boolean)) {
    rules.push({ id: `java-${key}:${root}`, pathPattern: rootPattern(root), background });
  }
  if (settings2.icons) {
    const colors = { class: "#4f8dd6", interface: "#45a26b", enum: "#b887ce", record: "#d08a38", annotation: "#b887ce", package: "#bf9642", module: "#538fc5" };
    rules.push({ id: "java-file", pathPattern: "\\.java$", kind: "file", iconSvg: icon("file", colors.class), description: "Java source" });
    for (const kind of ["class", "interface", "enum", "record", "annotation"]) rules.push({
      id: `java-${kind}`,
      pathPattern: "\\.java$",
      kind: "file",
      contentPattern: kind === "annotation" ? "@\\s*interface\\s+$FILE_STEM\\b" : `\\b${kind}\\s+$FILE_STEM\\b`,
      iconSvg: icon(kind, colors[kind]),
      description: `Java ${kind}`
    });
    for (const kind of ["package", "module"]) rules.push({ id: `java-${kind}`, pathPattern: `(?:^|/)${kind}-info\\.java$`, kind: "file", iconSvg: icon(kind, colors[kind]), description: `Java ${kind} descriptor` });
  }
  return { rules };
}

// modules/services/language-java/src/index.ts
var settings = { ...defaults };
var index_default = {
  id: "language-java",
  moduleApiVersion: 1,
  async activate(ctx) {
    const saved = await ctx.modules.call("persistence", "settings.get", { key: "language-java.filePresentation" });
    settings = { ...defaults };
    for (const key of Object.keys(defaults)) if (typeof saved?.[key] === typeof defaults[key]) settings[key] = saved[key];
    const publish = () => ctx.state.set("language-java.filePresentation", javaFilePresentation(settings));
    publish();
    exportSettings(ctx, () => [{ key: "files", title: "Java file appearance", group: "Languages", description: "Source-root paths accept * and ** wildcards; separate multiple roots with commas. Applied through the shared file-presentation interface.", fields: [
      { key: "icons", label: "Java declaration icons", type: "toggle", value: settings.icons },
      { key: "backgrounds", label: "Enable Java file coloring", description: "Turn background colors on or off for Java source, test and resource files. Declaration icons are controlled separately.", type: "toggle", value: settings.backgrounds },
      ...[["sources", "Source roots"], ["tests", "Test roots"], ["resources", "Resource roots"], ["testResources", "Test resource roots"]].map(([key, label]) => ({ key, label, type: "text", value: settings[key] }))
    ] }], async (_section, key, value) => {
      if (!(key in defaults) || typeof value !== typeof defaults[key]) throw Error("Invalid Java appearance setting");
      const next = { ...settings, [key]: value };
      await ctx.modules.call("persistence", "settings.set", { key: "language-java.filePresentation", value: next });
      settings = next;
      publish();
    });
  }
};
export {
  index_default as default
};
