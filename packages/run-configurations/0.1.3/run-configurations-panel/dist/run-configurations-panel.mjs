// ../sdk/runtime.ts
function errMsg(e) {
  return e && (e.message || String(e)) || "unknown error";
}

// ../sdk/ui-icons.ts
var outline = (paths, width = 1.8) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
var uiIcons = {
  send: outline("<path d='m22 2-7 20-4-9-9-4Z'/><path d='M22 2 11 13'/>"),
  paperclip: outline("<path d='m21 11-9 9a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8l8.5-8.5'/>"),
  "sliders-horizontal": outline("<path d='M3 6h3m4 0h11M3 18h11m4 0h3'/><circle cx='8' cy='6' r='2'/><circle cx='16' cy='18' r='2'/>"),
  "message-square": outline("<path d='M21 15a2 2 0 0 1-2 2H7l-5 5V4a2 2 0 0 1 2-2h15a2 2 0 0 1 2 2Z'/>"),
  "graduation-cap": outline("<path d='m2 8 10-5 10 5-10 5Zm4 2v7q6 5 12 0v-7M22 8v8'/>"),
  pencil: outline("<path d='M21.2 6.8a2.8 2.8 0 0 0-4-4L3.8 16.2 3 21l4.8-.8Z'/><path d='m15 5 4 4'/>"),
  eraser: outline("<path d='m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L11 21'/><path d='M22 21H7'/><path d='m5 11 9 9'/>"),
  trash: outline("<path d='M3 6h18'/><path d='M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6'/><path d='M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'/><path d='M10 11v6M14 11v6'/>"),
  copy: outline("<rect x='8' y='8' width='13' height='13' rx='2'/><path d='M16 5V3H3v13h2'/>"),
  warning: outline("<path d='m12 3 10 18H2Z'/><path d='M12 9v5m0 3h.01'/>"),
  terminal: outline("<rect x='3' y='4' width='18' height='16' rx='2'/><path d='m7 9 3 3-3 3m6 0h4'/>"),
  "git-branch": outline("<circle cx='6' cy='3' r='2'/><circle cx='6' cy='20' r='2'/><circle cx='18' cy='6' r='2'/><path d='M6 5v13M18 8c0 7-12 4-12 10'/>"),
  files: outline("<path d='M14 2H6v16h14V8Z'/><path d='M14 2v6h6M3 6v16h13'/>"),
  folder: outline("<path d='M3 5h6l2 2h10v13H3Z'/>"),
  refresh: outline("<path d='M20 7a8 8 0 1 0 0 10M20 3v5h-5'/>"),
  collapse: outline("<path d='m8 8 4-4 4 4M8 16l4 4 4-4M4 12h16'/>"),
  locate: outline("<circle cx='12' cy='12' r='7'/><circle cx='12' cy='12' r='2'/><path d='M12 2v3m0 14v3M2 12h3m14 0h3'/>"),
  search: outline("<circle cx='10' cy='10' r='7'/><path d='m15 15 6 6'/>"),
  x: outline("<path d='m6 6 12 12M6 18 18 6'/>"),
  plus: outline("<path d='M12 4v16M4 12h16'/>"),
  remote: outline("<rect x='3' y='4' width='18' height='12' rx='2'/><path d='M8 20h8M12 16v4'/>"),
  plug: outline("<path d='M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0V7ZM12 17v5'/>"),
  "text-search": outline("<path d='M4 6h16M4 12h7M4 18h6'/><circle cx='17' cy='15' r='3'/><path d='m19.2 17.2 2.3 2.3'/>"),
  eye: outline("<path d='M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z'/><circle cx='12' cy='12' r='3'/>"),
  "eye-off": outline("<path d='M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3 3.8M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18'/>"),
  globe: outline("<circle cx='12' cy='12' r='9'/><path d='M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18'/>"),
  "cloud-lock": outline("<path d='M17.5 17H18a4 4 0 0 0 .5-8A6 6 0 0 0 7 7.5 4.5 4.5 0 0 0 6.5 17'/><rect x='9' y='14' width='6' height='6' rx='1'/><path d='M10.5 14v-1.5a1.5 1.5 0 0 1 3 0V14'/>"),
  lock: outline("<rect x='4' y='11' width='16' height='10' rx='2'/><path d='M8 11V7a4 4 0 0 1 8 0v4'/>"),
  key: outline("<circle cx='8' cy='15' r='4'/><path d='m10.8 12.2 8.7-8.7M17 6l3 3M14.5 8.5l2 2'/>"),
  check: outline("<path d='m5 12 5 5 9-11'/>"),
  "log-out": outline("<path d='M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9'/>"),
  external: outline("<path d='M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'/>"),
  sparkles: outline("<path d='M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z'/><path d='M19 16v4M17 18h4'/>"),
  import: outline("<path d='M12 3v12M7 10l5 5 5-5M5 21h14'/>"),
  task: outline("<circle cx='6' cy='3' r='2'/><circle cx='6' cy='20' r='2'/><circle cx='18' cy='6' r='2'/><path d='M6 5v13M18 8c0 7-12 4-12 10'/>")
};

// modules/ui/run-configurations-panel/src/index.ts
var sections = [
  { key: "general", label: "General" },
  { key: "environment", label: "Environment" },
  { key: "profiles", label: "Profiles" },
  { key: "before", label: "Before launch" }
];
var selectedWorkspace = null;
var configs = [];
var types = [];
var candidates = [];
var draft = null;
var section = "general";
var editor = false;
var busy = "";
var error = "";
var status = "";
var validation = "";
var previewOpen = false;
var preview = { rows: [], missing: [] };
var reveal = false;
var confirmation = null;
var targetQuery = "";
var browse = null;
var hints = { runtimes: [], profiles: [] };
var draftInputs = {};
var epoch = 0;
var draftSerial = 0;
var runnerAvailable = false;
var hintRequest = 0;
var empty = (type = "") => ({ name: "", type, target: "", cwd: ".", env: {}, envFiles: [], args: [], runtimeArgs: [], runtime: "", profiles: [], beforeLaunch: [] });
var clone = (config) => JSON.parse(JSON.stringify(config));
var lines = (text) => text.split(/\r?\n/).filter((line) => line.length > 0);
var detectedTargets = (d) => candidates.filter((c) => c.type === d.type && c.cwd === d.cwd);
var valid = () => !!draft && !!draft.name.trim() && !!draft.type && !!draft.target.trim() && !!draft.cwd.trim() && Object.keys(draft.env).every((key) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) && draft.beforeLaunch.every((step) => step.executable.trim());
var service = (ctx, method, args = {}) => ctx.modules.call("run-configurations", method, { ...args, workspaceId: selectedWorkspace?.id }, { timeoutMs: 12e4 });
async function load(ctx) {
  const request = ++epoch, id = selectedWorkspace?.id;
  if (!id) {
    configs = [];
    ctx.ui.invalidate();
    return;
  }
  try {
    const [saved, available, plugins] = await Promise.all([service(ctx, "list"), service(ctx, "types"), ctx.host.plugins.list()]);
    if (request !== epoch || selectedWorkspace?.id !== id) return;
    configs = saved;
    types = available;
    runnerAvailable = plugins.plugins.some((p) => p.id === "run" && p.enabled && !!p.active);
  } catch (e) {
    if (request === epoch) error = errMsg(e);
  }
  ctx.ui.invalidate();
}
function setDraft(value) {
  draft = value ? clone(value) : null;
  draftInputs = {};
  previewOpen = false;
  preview = { rows: [], missing: [] };
  reveal = false;
  validation = "";
  targetQuery = "";
  browse = null;
  hints = { runtimes: [], profiles: [] };
  hintRequest++;
  draftSerial++;
}
function loadHints(ctx) {
  if (!draft?.type) return;
  const request = ++hintRequest;
  void service(ctx, "hints", { cwd: draft.cwd, type: draft.type }).then((result) => {
    if (request === hintRequest) {
      hints = result;
      ctx.ui.invalidate();
    }
  }).catch(() => {
  });
}
function button(key, text, action, options = {}) {
  return { type: "button", key, text, action, small: true, variant: "ghost", ...options };
}
function label(key, text, extra = {}) {
  return { type: "label", key, text, size: "sm", ...extra };
}
function field(key, title, options = {}) {
  const d = draft;
  const input = `run-field:${draftSerial}:${key}`, value = key === "target" && d.type === "junit" ? d.target.split("#")[0] : d[key];
  const text = draftInputs[input] ?? (Array.isArray(value) ? value.join("\n") : String(value));
  return { type: "column", key: `field:${key}`, gap: 4, children: [
    label("label", title, { weight: "medium" }),
    {
      type: "textInput",
      key: input,
      value: text,
      placeholder: options.hint,
      changeAction: "field",
      multiline: options.multiline,
      rows: 2,
      ...options.multiline ? { style: { font: "mono" } } : {}
    },
    ...!text.trim() && ["name", "target", "cwd"].includes(key) && (validation || draftInputs[input] !== void 0) ? [label("required", "⚠ Required", { color: "danger", size: "xs" })] : []
  ] };
}
function picker(key, title, select) {
  return { type: "column", key: `picker:${key}`, gap: 4, children: [
    label("label", title, { weight: "medium" }),
    { type: "select", key, ...select, buttonStyle: { justify: "start", fullWidth: true } }
  ] };
}
var runIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l12-7.5z"/></svg>`;
var debugIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 9a4 4 0 0 1 8 0v6a4 4 0 0 1-8 0zM12 9v10M4 13h4m8 0h4M5 7l3 2m11-2-3 2M5 19l3-2m11 2-3-2"/></svg>`;
function row(key, children) {
  return { type: "row", key, gap: 6, align: "center", children };
}
function sortable(kind, index, content) {
  return { type: "dropZone", key: `${kind}:${index}`, action: "dropOrder", regions: ["center"], children: [
    row("order", [{ type: "dragHandle", key: "drag", label: "⋮", tooltip: "Drag to reorder", payload: { kind, index }, width: 18 }, content])
  ] };
}
function sectionContent(d, info) {
  if (section === "environment") {
    const move = (index, delta) => button(
      delta < 0 ? "up" : "down",
      delta < 0 ? "↑" : "↓",
      "moveEnv",
      { value: { index, delta }, tooltip: delta < 0 ? "Move environment file earlier" : "Move environment file later", disabled: index + delta < 0 || index + delta >= d.envFiles.length }
    );
    return [
      row("files-header", [label("files", "Environment files", { weight: "semibold", grow: true }), button("add", "+ Add", "addEnvFile")]),
      ...d.envFiles.map((path, index) => sortable("env", index, row(`env-file:${index}`, [
        { type: "textInput", key: `env-file:${draftSerial}:${index}`, value: path, changeAction: "envFile", placeholder: ".env", grow: true },
        ...preview.missing.includes(path) ? [label("missing", "⚠ not found", { color: "warning", size: "xs" })] : [],
        move(index, -1),
        move(index, 1),
        button("remove", "−", "removeEnv", { value: index, tooltip: "Remove environment file" })
      ]))),
      label("precedence", "Later files override earlier; inline overrides all.", { size: "xs", color: "muted" }),
      row("inline-header", [label("inline", "Inline variables", { weight: "semibold", grow: true }), button("add", "+ Add", "addInline")]),
      ...Object.entries(d.env).map(([name, value], index) => row(`inline:${index}`, [
        { type: "textInput", key: `env-key:${draftSerial}:${index}`, value: name, changeAction: "inlineKey", placeholder: "KEY", grow: true },
        { type: "textInput", key: `env-value:${draftSerial}:${index}`, value, secret: /SECRET|TOKEN|PASSWORD|KEY/i.test(name), changeAction: "inlineValue", placeholder: "Value", grow: true },
        button("remove", "−", "removeInline", { value: index, tooltip: "Remove inline variable" })
      ])),
      row("preview-controls", [
        button("preview", previewOpen ? "▾ Resolved preview" : "▸ Resolved preview", "previewEnvironment"),
        ...previewOpen ? [button("reveal", reveal ? "Hide masked values" : "Show masked values", "revealEnvironment")] : []
      ]),
      ...previewOpen ? [
        row("env-header", ["KEY", "Value", "Source"].map((title) => label(title, title, { grow: true, weight: "semibold", size: "xs" }))),
        ...preview.rows.map((v) => row(`resolved:${v.name}`, [label("name", v.name, { grow: true }), label("value", v.value, { grow: true }), label("source", v.source, { grow: true, size: "xs", color: "muted" })]))
      ] : []
    ];
  }
  if (section === "profiles") return [
    label("profiles", "Profiles", { weight: "semibold" }),
    label("hint", info?.profileHint || "Launch profiles", { color: "muted", size: "xs" }),
    { type: "row", key: "chips", gap: 4, wrap: true, children: d.profiles.map((profile) => button(profile, `${profile} ×`, "removeProfile", { value: profile, tooltip: `Remove ${profile}` })) },
    { type: "row", key: "new-profile", gap: 4, children: [
      { type: "textInput", key: `profile:${draftSerial}`, placeholder: "Add profile", submitAction: "addProfile", grow: true },
      button("add", "Add", "addProfile")
    ] },
    { type: "row", key: "suggestions", gap: 4, wrap: true, children: [.../* @__PURE__ */ new Set([
      ...hints.profiles,
      ...["node", "npm-script", "jest", "vitest"].includes(d.type) ? ["development", "test", "production"] : []
    ])].map((value) => button(value, value, "addProfile", { value, disabled: d.profiles.includes(value) })) }
  ];
  if (section === "before") return [
    row("steps-header", [label("steps", "Before launch", { weight: "semibold", grow: true }), button("add-step", "+ Add step", "addStep")]),
    ...d.beforeLaunch.map((step, index) => sortable("step", index, { type: "column", key: `step:${index}`, gap: 4, padding: 6, border: true, grow: true, children: [
      row("step-header", [
        label("order", `Step ${index + 1}`, { grow: true }),
        button("up", "↑", "moveStep", { value: { index, delta: -1 }, tooltip: "Move step earlier", disabled: index === 0 }),
        button("down", "↓", "moveStep", { value: { index, delta: 1 }, tooltip: "Move step later", disabled: index === d.beforeLaunch.length - 1 }),
        button("remove", "−", "removeStep", { value: index, tooltip: "Remove step" })
      ]),
      { type: "select", key: `step-kind:${index}`, value: step.kind || "command", action: "stepKind", options: [
        { value: "build", label: "Build project" },
        { value: "npm", label: "Run npm script" },
        { value: "configuration", label: "Run config" },
        { value: "command", label: "Shell command" }
      ] },
      ...["executable", "args", "cwd"].map((prop) => ({
        type: "textInput",
        key: `step:${draftSerial}:${index}:${prop}`,
        placeholder: prop === "executable" ? step.kind === "configuration" ? "Saved configuration name or ID" : step.kind === "npm" ? "Script name" : step.kind === "build" ? "Build goal or task" : "Executable (e.g. npm)" : prop === "args" ? "One argument per line" : "Step working directory (optional)",
        value: prop === "args" ? step.args.join("\n") : step[prop],
        multiline: prop === "args",
        rows: 2,
        changeAction: "stepField"
      }))
    ] }))
  ];
  const known = detectedTargets(d).filter((c) => c.target.toLowerCase().includes(targetQuery.toLowerCase()));
  return [
    picker("type", "Configuration type", {
      value: d.type || null,
      options: [...types.map(({ id, label: label2 }) => ({ value: id, label: label2 })), ...d.type && !info ? [{ value: d.type, label: d.type }] : []],
      action: "type"
    }),
    field("target", info?.targetLabel || "Target"),
    ...d.type === "junit" ? [{ type: "column", key: "test-method", gap: 4, children: [
      label("method", "Test method (optional)", { weight: "medium" }),
      { type: "textInput", key: `method:${draftSerial}`, value: d.target.split("#")[1] || "", changeAction: "testMethod", placeholder: "All test methods" }
    ] }] : [],
    ...detectedTargets(d).length ? [
      { type: "textInput", key: "target-search", value: targetQuery, placeholder: "Search detected targets", changeAction: "targetSearch" },
      picker("detected-targets", "Detected targets", {
        value: null,
        placeholder: "Choose a detected target…",
        options: known.map((c) => ({ value: c.target, label: c.target })),
        action: "target"
      })
    ] : [],
    field("args", "Program arguments", { multiline: true, hint: "One argument per line" }),
    field("runtimeArgs", "VM / Node arguments", { multiline: true, hint: "One argument per line" }),
    { type: "row", key: "cwd", gap: 6, align: "end", children: [{ ...field("cwd", "Working directory", { hint: "Path relative to the workspace" }), grow: true }, button("browse", "Browse…", "browseCwd", { value: d.cwd, iconSvg: uiIcons.folder })] },
    picker("runtime-choice", "Runtime", { value: d.runtime || "", action: "runtimeChoice", options: [
      { value: "", label: "Project default" },
      ...hints.runtimes.map((runtime) => ({ value: runtime, label: runtime })),
      ...d.runtime && !hints.runtimes.includes(d.runtime) ? [{ value: d.runtime, label: d.runtime }] : []
    ] }),
    field("runtime", info?.runtimeLabel || "Runtime", { hint: info?.runtimeHint || "Project default" })
  ];
}
var mod = {
  id: "run-configurations-panel",
  moduleApiVersion: 1,
  async activate(ctx) {
    selectedWorkspace = ctx.state.get("workspace.selected") || null;
    ctx.state.watch("workspace.selected", (v) => {
      if (v?.id === selectedWorkspace?.id) return;
      selectedWorkspace = v;
      configs = [];
      candidates = [];
      editor = false;
      busy = "";
      error = "";
      status = "";
      setDraft(null);
      void load(ctx);
    });
    ctx.events.on("run-configurations.changed", (ev) => {
      if (ev.projectId === selectedWorkspace?.projectId) void load(ctx);
    });
    ctx.events.on("kernel.modules.changed", () => void load(ctx));
    const open = async (a) => {
      if (a.workspaceId !== selectedWorkspace?.id) return;
      section = "general";
      editor = true;
      error = "";
      const c = a.candidate;
      if (c) setDraft({ ...empty(c.type), name: c.name, target: c.target, cwd: c.cwd });
      else if (Object.prototype.hasOwnProperty.call(a, "candidate")) setDraft(empty(types[0]?.id));
      else {
        const id = a.id || configs[0]?.id;
        if (!id) setDraft(null);
        else try {
          const config = await service(ctx, "get", { id });
          if (a.workspaceId === selectedWorkspace?.id) setDraft(config);
        } catch (e) {
          error = errMsg(e);
        }
      }
      loadHints(ctx);
      ctx.ui.invalidate();
    };
    ctx.events.on("viewer.runConfiguration", (c) => void open({ workspaceId: c.workspaceId, candidate: c }));
    ctx.events.on("run-configurations-panel.edit", open);
    ctx.events.on("run-bar.editConfiguration", open);
    await load(ctx);
  },
  deactivate() {
    epoch++;
  },
  render() {
    if (!selectedWorkspace?.id) return label("project", "Select a project or task to configure a run.", { padding: 8, color: "muted" });
    const panel = [
      row("toolbar", [
        label("summary", `${configs.length} ${configs.length === 1 ? "configuration" : "configurations"}`, { grow: true, color: "muted" }),
        button("detect", "Detect", "detect", { disabled: !!busy }),
        button("edit", "Edit configurations…", "edit", { disabled: !!busy })
      ])
    ];
    if (error || status || busy) panel.push({ type: "status", key: "status", text: error || busy || status, level: error ? "error" : "info" });
    if (!types.length) panel.push(label("languages", "Enable an updated Java or JavaScript & TypeScript plugin to create or detect configurations.", { color: "muted", wrap: true }));
    if (candidates.length) panel.push({ type: "tree", key: "detected", grow: true, rowHeight: 30, selectAction: "candidate", expandAction: "", rows: candidates.map((c, i) => ({
      key: String(i),
      label: c.name,
      detail: c.cwd,
      badge: types.find((t) => t.id === c.type)?.label || c.type,
      depth: 0,
      expandable: false,
      expanded: false,
      selected: false
    })) });
    if (editor) {
      const d = draft;
      const ordered = [...types, ...configs.filter((c) => !types.some((t) => t.id === c.type)).map((c) => ({ id: c.type, label: c.type }))];
      const seenTypes = /* @__PURE__ */ new Set();
      const rows = ordered.flatMap((type) => {
        if (seenTypes.has(type.id)) return [];
        seenTypes.add(type.id);
        const matching = configs.filter((c) => c.type === type.id);
        return matching.length ? [
          { key: "", label: type.label, depth: 0, expandable: false, expanded: false, selected: false },
          ...matching.map((c) => ({
            key: c.id,
            label: c.name,
            badge: c.shared ? "Shared" : void 0,
            tooltip: c.shared ? `${c.name} · Shared (.hato/run.json)` : c.name,
            depth: 0,
            expandable: false,
            expanded: false,
            selected: c.id === d?.id
          }))
        ] : [];
      });
      panel.push({ type: "modal", key: "editor", title: "Run Configurations", width: 760, closeAction: "cancel", children: [
        { type: "row", key: "editor-body", height: 450, gap: 12, align: "stretch", children: [
          { type: "column", key: "configuration-list", width: 220, gap: 6, borderSide: "right", children: [
            row("toolbar", [
              button("add", "+", "new", { tooltip: "Add configuration", disabled: !types.length || !!busy }),
              button("remove", "−", "delete", { tooltip: "Delete configuration", disabled: !d?.id || !!busy }),
              button("duplicate", "⧉", "duplicate", { tooltip: "Duplicate configuration", disabled: !d || !!busy }),
              button("earlier", "↑", "orderConfig", { value: -1, tooltip: "Move configuration earlier", disabled: !d?.id || !!busy }),
              button("later", "↓", "orderConfig", { value: 1, tooltip: "Move configuration later", disabled: !d?.id || !!busy })
            ]),
            { type: "tree", key: "configs", grow: true, selectAction: "select", expandAction: "", rowHeight: 28, rows },
            button("import", "Import .hato/run.json", "import", { disabled: !!busy, iconSvg: uiIcons.import, tooltip: "Add shared configurations from .hato/run.json", style: { justify: "start", fullWidth: true } }),
            button("export", "Export .hato/run.json", "export", { disabled: !configs.length || !!busy, iconSvg: uiIcons.external, tooltip: "Write shared configurations to .hato/run.json", style: { justify: "start", fullWidth: true } })
          ] },
          { type: "column", key: "fields", grow: true, gap: 6, scroll: true, children: d ? [
            field("name", "Name"),
            { type: "toggle", key: "shared", label: "Store in .hato/run.json (shared)", checked: !!d.shared, action: "shared", tooltip: "Inline environment values stay local" },
            { type: "tabs", key: "sections", tabs: sections, active: section, action: "section", children: [] },
            ...sectionContent(d, types.find((t) => t.id === d.type))
          ] : [label("empty", "Choose a configuration or add one.", { color: "muted" })] }
        ] },
        ...error || validation || status ? [{ type: "status", key: "form-status", text: error || validation || status, level: error || validation ? "error" : "info" }] : [],
        row("footer", [
          button("run", "Run", "run", { iconSvg: runIcon, iconColor: runnerAvailable && valid() ? "success" : "muted", disabled: !runnerAvailable || !valid() || !!busy, tooltip: runnerAvailable ? "Save and run this configuration" : "Available when Run sessions is installed" }),
          button("debug", "Debug", "", { iconSvg: debugIcon, disabled: true, tooltip: "Debug controls will be available with debugger support" }),
          { type: "spacer", key: "space" },
          button("cancel", "Cancel", "cancel", { disabled: !!busy }),
          button("apply", "Apply", "apply", { disabled: !valid() || !!busy }),
          button("ok", "OK", "ok", { disabled: !valid() || !!busy, variant: "primary" })
        ])
      ] });
    }
    if (confirmation) panel.push({
      type: "modal",
      key: "confirm",
      title: confirmation === "delete" ? "Delete configuration?" : "Replace the shared configuration file?",
      closeAction: "cancelConfirmation",
      width: 380,
      children: [
        row("actions", [button("cancel", "Cancel", "cancelConfirmation"), button("confirm", confirmation === "delete" ? "Delete" : "Replace", "confirm", { variant: "danger" })])
      ]
    });
    if (browse) panel.push({ type: "modal", key: "browse", title: "Working directory", width: 420, closeAction: "closeBrowse", children: [
      label("path", browse.cwd),
      ...browse.cwd !== "." ? [button("parent", "↑ Parent folder", "browseCwd", { value: browse.cwd.split("/").slice(0, -1).join("/") || "." })] : [],
      { type: "column", key: "folders", scroll: true, maxHeight: 250, children: browse.dirs.map((dir) => button(dir, dir.split("/").pop(), "browseCwd", { value: dir })) },
      button("use", "Use this folder", "chooseCwd", { value: browse.cwd, variant: "primary" })
    ] });
    return { type: "column", key: "run-configurations", padding: 8, gap: 6, grow: true, children: panel };
  },
  async onEvent(ctx, ev) {
    const value = ev.value;
    const text = typeof value === "string" ? value : "";
    const mine = selectedWorkspace?.id;
    if (!mine || busy) return;
    const perform = async (label2, action) => {
      busy = label2;
      error = "";
      ctx.ui.invalidate();
      try {
        await action();
      } catch (e) {
        if (selectedWorkspace?.id === mine) error = errMsg(e);
      } finally {
        if (selectedWorkspace?.id === mine) busy = "";
      }
    };
    const move = (items, info) => {
      const from = Number(info?.index), to = from + Number(info?.delta);
      if (Number.isInteger(from) && Number.isInteger(to) && items[from] !== void 0 && items[to] !== void 0) [items[from], items[to]] = [items[to], items[from]];
    };
    switch (ev.action) {
      case "edit":
        editor = true;
        section = "general";
        if (!draft && configs[0]) await perform("Opening configuration…", async () => {
          const result = await service(ctx, "get", { id: configs[0].id });
          if (selectedWorkspace?.id === mine) setDraft(result);
        });
        break;
      case "new":
        section = "general";
        setDraft(empty(types[0]?.id));
        editor = true;
        break;
      case "duplicate":
        if (draft) {
          const { id: _id, revision: _revision, ...copy } = draft;
          setDraft({ ...copy, name: `${draft.name} copy`, shared: false });
        }
        break;
      case "select":
        await perform("Opening configuration…", async () => {
          const result = await service(ctx, "get", { id: ev.rowKey });
          if (selectedWorkspace?.id === mine) setDraft(result);
        });
        break;
      case "candidate": {
        const c = candidates[Number(ev.rowKey)];
        if (c) {
          setDraft({ ...empty(c.type), name: c.name, target: c.target, cwd: c.cwd });
          section = "general";
          editor = true;
        }
        break;
      }
      case "section":
        if (sections.some((s) => s.key === text)) section = text;
        break;
      case "cancel":
        editor = false;
        setDraft(null);
        break;
      case "type":
        if (draft) {
          draft.type = text;
          draft.target = "";
          draftInputs = {};
        }
        break;
      case "target":
        if (draft) {
          draft.target = text;
          delete draftInputs[`run-field:${draftSerial}:target`];
        }
        break;
      case "targetSearch":
        targetQuery = text;
        break;
      case "shared":
        if (draft) draft.shared = value === true;
        break;
      case "runtimeChoice":
        if (draft) {
          draft.runtime = text;
          delete draftInputs[`run-field:${draftSerial}:runtime`];
        }
        break;
      case "browseCwd":
        await perform("Reading folders…", async () => {
          const result = await service(ctx, "directories", { cwd: text || "." });
          if (selectedWorkspace?.id === mine) browse = result;
        });
        break;
      case "closeBrowse":
        browse = null;
        break;
      case "chooseCwd":
        if (draft) {
          draft.cwd = text;
          delete draftInputs[`run-field:${draftSerial}:cwd`];
          browse = null;
        }
        break;
      case "field": {
        if (!draft) break;
        const property = ev.key.split(":").pop();
        draftInputs[ev.key] = text;
        if (property === "name" || property === "cwd" || property === "runtime") draft[property] = text;
        if (property === "target") {
          const method = draft.type === "junit" ? draft.target.split("#")[1] : "";
          draft.target = method ? `${text}#${method}` : text;
        }
        if (property === "args" || property === "runtimeArgs") draft[property] = lines(text);
        break;
      }
      case "testMethod":
        if (draft?.type === "junit") draft.target = draft.target.split("#")[0] + (text ? "#" + text : "");
        break;
      case "envFile":
        if (draft) draft.envFiles[Number(ev.key.split(":").pop())] = text;
        break;
      case "addEnvFile":
        draft?.envFiles.push("");
        break;
      case "removeEnv":
        if (draft) draft.envFiles.splice(Number(value), 1);
        break;
      case "moveEnv":
        if (draft) move(draft.envFiles, value);
        break;
      case "addInline":
        if (draft && !Object.prototype.hasOwnProperty.call(draft.env, "")) draft.env = Object.fromEntries([...Object.entries(draft.env), ["", ""]]);
        break;
      case "inlineKey":
      case "inlineValue":
      case "removeInline": {
        if (!draft) break;
        const env = Object.entries(draft.env);
        const i = ev.action === "removeInline" ? Number(value) : Number(ev.key.split(":").pop());
        if (!env[i]) break;
        if (ev.action === "removeInline") env.splice(i, 1);
        else if (ev.action === "inlineValue") env[i][1] = text;
        else {
          if (env.some(([key], ix) => ix !== i && key === text)) break;
          env[i][0] = text;
        }
        draft.env = Object.fromEntries(env);
        break;
      }
      case "previewEnvironment":
      case "revealEnvironment":
        if (previewOpen && ev.action === "previewEnvironment") {
          previewOpen = false;
          reveal = false;
        } else if (draft) await perform("Resolving environment…", async () => {
          const show = ev.action === "revealEnvironment" && !reveal;
          const result = await service(ctx, "environment", { env: draft.env, envFiles: draft.envFiles.filter(Boolean), reveal: show });
          if (selectedWorkspace?.id === mine) {
            preview = result;
            previewOpen = true;
            reveal = show;
          }
        });
        break;
      case "addProfile": {
        const profile = (text || ev.inputs[`profile:${draftSerial}`] || "").trim();
        if (profile && draft && !draft.profiles.includes(profile)) draft.profiles.push(profile);
        break;
      }
      case "removeProfile":
        if (draft) draft.profiles = draft.profiles.filter((p) => p !== text);
        break;
      case "addStep":
        draft?.beforeLaunch.push({ executable: "", cwd: "", args: [] });
        break;
      case "removeStep":
        draft?.beforeLaunch.splice(Number(value), 1);
        break;
      case "moveStep":
        if (draft) move(draft.beforeLaunch, value);
        break;
      case "stepKind": {
        const step = draft?.beforeLaunch[Number(ev.key.split(":").pop())];
        if (step) {
          step.kind = text;
          step.executable = "";
        }
        break;
      }
      case "dropOrder": {
        if (!draft) break;
        const data = value, [kind, target] = ev.key.split(":");
        if (kind !== data?.payload?.kind) break;
        const items = kind === "env" ? draft.envFiles : draft.beforeLaunch;
        const from = Number(data.payload.index), to = Number(target);
        if (items[from] === void 0 || items[to] === void 0) break;
        if (kind === "env") {
          const [item] = draft.envFiles.splice(from, 1);
          draft.envFiles.splice(to, 0, item);
        } else {
          const [item] = draft.beforeLaunch.splice(from, 1);
          draft.beforeLaunch.splice(to, 0, item);
        }
        break;
      }
      case "orderConfig": {
        const group = configs.filter((c) => c.type === draft?.type);
        const selected = group.findIndex((c) => c.id === draft?.id), neighbor = group[selected + Number(value)];
        if (selected < 0 || !neighbor) break;
        const ids = configs.map((c) => c.id);
        const from = ids.indexOf(group[selected].id), to = ids.indexOf(neighbor.id);
        [ids[from], ids[to]] = [ids[to], ids[from]];
        await perform("Saving configuration order…", async () => {
          await service(ctx, "reorder", { ids });
          if (selectedWorkspace?.id === mine) await load(ctx);
        });
        break;
      }
      case "stepField": {
        const [, , index, prop] = ev.key.split(":");
        const step = draft?.beforeLaunch[Number(index)];
        if (!step) break;
        if (prop === "args") step.args = lines(text);
        else if (prop === "executable" || prop === "cwd") step[prop] = text;
        break;
      }
      case "detect":
        await perform("Detecting launch targets…", async () => {
          const result = await service(ctx, "detect");
          if (selectedWorkspace?.id !== mine) return;
          candidates = result.candidates;
          status = [`${candidates.length} targets detected${result.limited ? " (partial scan)" : ""}`, ...result.warnings].join(" · ");
        });
        break;
      case "apply":
      case "ok":
      case "run":
        if (!draft || !valid()) {
          validation = "Complete the required fields.";
          break;
        }
        await perform("Saving configuration…", async () => {
          const { id, revision, ...config } = draft;
          const saved = await service(ctx, id ? "update" : "create", { id, revision, config: { ...config, envFiles: config.envFiles.filter(Boolean) } });
          if (selectedWorkspace?.id !== mine) return;
          setDraft(saved);
          status = "Configuration saved.";
          if (ev.action === "run") {
            await ctx.modules.call("run", "start", { workspaceId: mine, configId: saved.id, mode: "run" }, { timeoutMs: 6e4 });
            if (selectedWorkspace?.id !== mine) return;
          }
          if (ev.action === "ok" || ev.action === "run") {
            editor = false;
            setDraft(null);
          }
          await load(ctx);
        });
        break;
      case "delete":
        if (draft?.id) confirmation = "delete";
        break;
      case "export":
        await perform("Exporting configurations…", async () => {
          const result = await service(ctx, "exportShared");
          if (selectedWorkspace?.id === mine) status = `Wrote ${result.count} configurations to .hato/run.json.`;
        });
        if (error.startsWith("A shared file already exists")) confirmation = "replace";
        break;
      case "cancelConfirmation":
        confirmation = null;
        break;
      case "confirm":
        await perform(confirmation === "delete" ? "Deleting configuration…" : "Replacing shared file…", async () => {
          if (confirmation === "delete" && draft?.id) {
            await service(ctx, "delete", { id: draft.id, revision: draft.revision });
            if (selectedWorkspace?.id === mine) {
              setDraft(null);
              await load(ctx);
            }
          } else await service(ctx, "exportShared", { replace: true });
          if (selectedWorkspace?.id === mine) confirmation = null;
        });
        break;
      case "import":
        await perform("Importing configurations…", async () => {
          const result = await service(ctx, "importShared");
          if (selectedWorkspace?.id === mine) {
            status = `Imported ${result.added} · skipped ${result.skipped} with matching names.`;
            await load(ctx);
          }
        });
        break;
    }
    if (["edit", "new", "select", "candidate", "type", "section", "chooseCwd"].includes(ev.action)) loadHints(ctx);
    ctx.ui.invalidate();
  }
};
var index_default = mod;
export {
  index_default as default
};
