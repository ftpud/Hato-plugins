// Run bar: configuration picker + Run / Debug / Stop / Restart and a live status pill, in the top bar.
// Presentation only; configurations come from `run-configurations`, sessions from `run` (sdk/run.ts).
import type { AppModule, ModuleContext, UiNode } from "@hato/sdk/types";
import type { RunCandidate, RunConfig } from "@hato/sdk/run-configurations";
import { RUN_EVENTS, RUN_UI_EVENTS, runActive, type RunMode, type RunSession } from "@hato/sdk/run";
import { filterInput } from "@hato/sdk/filter-style";
import { errMsg } from "@hato/sdk/runtime";
import { uiIcons } from "@hato/sdk/ui-icons";

const svg = (body: string, fill = false) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${fill ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const icons = {
  run: svg("<path d='M7 4.5v15l12-7.5z'/>", true),
  debug: svg("<path d='M8 9a4 4 0 0 1 8 0v6a4 4 0 0 1-8 0z'/><path d='M12 9v10M4 13h4m8 0h4M5 7l3 2m11-2-3 2M5 19l3-2m11 2-3-2M10 5 9 3m5 2 1-2'/>"),
  stop: svg("<rect x='6' y='6' width='12' height='12' rx='1.5'/>", true),
  restart: svg("<path d='M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5'/>"),
  java: svg("<path d='M6 10h10v4a5 5 0 0 1-10 0zm10 1h1.5a2 2 0 0 1 0 4H16M9 3c-1 1.5 1 2 0 3.5M12.5 3c-1 1.5 1 2 0 3.5'/>"),
  node: svg("<path d='m12 2.5 8.5 4.8v9.4L12 21.5l-8.5-4.8V7.3z'/><path d='M9.5 9v5.5a1.5 1.5 0 0 1-3 0M14 13.6c.3.9 1.2 1.4 2.2 1.4 1.3 0 2.1-.6 2.1-1.5 0-2-4.2-1-4.2-3 0-.8.8-1.5 2-1.5.9 0 1.6.4 1.9 1.1'/>"),
  test: svg("<path d='M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3M7.5 15h9'/>"),
  build: svg("<path d='m12 2.5 8.5 4.8v9.4L12 21.5l-8.5-4.8V7.3zM3.5 7.3 12 12l8.5-4.7M12 12v9.5'/>"),
  config: svg("<path d='M4 6h16M4 12h10M4 18h7'/><circle cx='18' cy='16' r='3'/>"),
};
function typeIcon(type: string) {
  if (/junit|test|jest|vitest|mocha/.test(type)) return icons.test;
  if (/maven|gradle/.test(type)) return icons.build;
  if (/java|spring/.test(type)) return icons.java;
  if (/node|npm|script|deno|bun|typescript|javascript/.test(type)) return icons.node;
  return icons.config;
}

type Selection = { kind: "config"; id: string } | { kind: "candidate"; key: string } | null;
const candidateKey = (c: RunCandidate) => `${c.type}|${c.target}|${c.cwd}`;

let workspaceId: string | null = null;
let configs: RunConfig[] = [];
let candidates: RunCandidate[] = [];
let detecting = false, detected = false;
let sessions: RunSession[] = [];
let runner = { available: false, debug: false, debugTypes: [] as string[] };
let selection: Selection = null;
let recent: string[] = [];
let open = false, query = "", busy = false, error: string | null = null;
let epoch = 0, ticker: ReturnType<typeof setInterval> | null = null;

const pref = (name: string) => `run-bar.${name}.${workspaceId}`;
const save = (ctx: ModuleContext, name: string, value: unknown) => ctx.modules.call("persistence", "settings.set", { key: pref(name), value }).catch(() => {});

async function refresh(ctx: ModuleContext) {
  if (!workspaceId) return;
  const id = workspaceId, mine = ++epoch;
  try {
    const list: RunConfig[] = await ctx.modules.call("run-configurations", "list", { workspaceId: id });
    if (mine === epoch) configs = Array.isArray(list) ? list : [];
  } catch (e) { if (mine === epoch) { configs = []; error = errMsg(e); } }
  try {
    const caps = await ctx.modules.call("run", "capabilities", { workspaceId: id });
    const list: RunSession[] = await ctx.modules.call("run", "list", { workspaceId: id });
    if (mine === epoch) { runner = { available: true, debug: !!caps?.debug, debugTypes: caps?.debugTypes || [] }; sessions = list || []; }
  } catch { if (mine === epoch) { runner = { available: false, debug: false, debugTypes: [] }; sessions = []; } }
  if (mine === epoch) {
    // Nothing saved and nothing chosen: fall back to detection so ▶ can still do something useful.
    if (!configs.length && !detected) void detect(ctx);
    syncTicker(ctx); ctx.ui.invalidate();
  }
}

async function detect(ctx: ModuleContext) {
  if (!workspaceId || detecting) return;
  const id = workspaceId, mine = epoch;
  detecting = true; ctx.ui.invalidate();
  try {
    const r = await ctx.modules.call("run-configurations", "detect", { workspaceId: id }, { timeoutMs: 120000 });
    if (mine === epoch) { candidates = r?.candidates || []; detected = true; }
  } catch (e) { if (mine === epoch) error = errMsg(e); }
  finally { if (mine === epoch) detecting = false; ctx.ui.invalidate(); }
}

/** The selection, else the most recent config, else the first config, else the first detected target. */
function target(): { config?: RunConfig; candidate?: RunCandidate; name: string; type: string } | null {
  const pick = (c: RunConfig) => ({ config: c, name: c.name, type: c.type });
  const sel = selection;
  if (sel?.kind === "config") { const c = configs.find(c => c.id === sel.id); if (c) return pick(c); }
  if (sel?.kind === "candidate") { const c = candidates.find(c => candidateKey(c) === sel.key); if (c) return { candidate: c, name: c.name, type: c.type }; }
  const r = recent.map(id => configs.find(c => c.id === id)).find(Boolean);
  if (r) return pick(r);
  if (configs[0]) return pick(configs[0]);
  if (candidates[0]) return { candidate: candidates[0], name: candidates[0].name, type: candidates[0].type };
  return null;
}
const sessionFor = (t: ReturnType<typeof target>) => !t ? undefined
  : sessions.filter(runActive).find(s => t.config ? s.configId === t.config.id : !s.configId && s.name === t.name);

function elapsed(s: RunSession) {
  const total = Math.max(0, Math.floor((Date.now() - s.startedAt) / 1000));
  const h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, sec = total % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(sec)}` : `${two(m)}:${two(sec)}`;
}
function syncTicker(ctx: ModuleContext) {
  const need = sessions.some(s => s.state === "running" || s.state === "starting");
  if (need && !ticker) ticker = setInterval(() => ctx.ui.invalidate(), 1000);
  if (!need && ticker) { clearInterval(ticker); ticker = null; }
}

async function launch(ctx: ModuleContext, mode: RunMode, restart = false) {
  const t = target();
  if (!workspaceId || !t || busy) return;
  busy = true; error = null; open = false; ctx.ui.invalidate();
  try {
    const s: RunSession = await ctx.modules.call("run", "start", { workspaceId, mode, restart, ...(t.config ? { configId: t.config.id } : { candidate: t.candidate }) }, { timeoutMs: 60000 });
    if (t.config) { recent = [t.config.id, ...recent.filter(id => id !== t.config!.id)].slice(0, 5); void save(ctx, "recent", recent); }
    else ctx.host.ui.toast("info", `Running detected target “${t.name}”. Save it as a configuration from the Run menu to customize it.`);
    ctx.events.emit(RUN_UI_EVENTS.revealSession, { workspaceId, id: s.id });
  } catch (e) { error = errMsg(e); ctx.host.ui.toast("error", `Could not start “${t.name}”: ${error}`); }
  finally { busy = false; await refresh(ctx); }
}
async function stop(ctx: ModuleContext, id: string) {
  if (!workspaceId) return;
  try { await ctx.modules.call("run", "stop", { workspaceId, id }, { timeoutMs: 30000 }); }
  catch (e) { ctx.host.ui.toast("error", `Could not stop: ${errMsg(e)}`); }
  await refresh(ctx);
}

const iconButton = (key: string, icon: string, action: string, tooltip: string, extra: object = {}): UiNode =>
  ({ type: "button", key, text: "", iconSvg: icon, iconSize: 15, action, variant: "ghost", small: true, tooltip, width: 28, style: { paddingX: 0, height: 26, radius: 6 }, ...extra });
const sectionTitle = (key: string, text: string): UiNode => ({ type: "label", key, text, size: "xs", weight: "semibold", color: "muted", style: { paddingY: 2 } });

function menuRow(key: string, text: string, type: string, action: string, value: string, selected: boolean, trailing: UiNode[] = [], note?: string): UiNode {
  return { type: "row", key, gap: 6, align: "center", style: { radius: 6, background: selected ? "selection" : "transparent", paddingX: 4 }, children: [
    { type: "button", key: "icon", text: "", iconSvg: typeIcon(type), iconSize: 14, action, value, variant: "ghost", width: 22, tooltip: type, style: { paddingX: 0, color: "muted", background: "transparent" } },
    { type: "column", key: "label", grow: true, children: [{ type: "choice", key: "pick", text, description: note, action, value, selected, mark: "✓",
      style: { background: "transparent", borderWidth: 0, paddingX: 0, paddingY: 3, minHeight: 28, radius: 0 } }] },
    ...trailing,
  ] };
}

function menu(t: ReturnType<typeof target>): UiNode[] {
  const q = query.trim().toLowerCase();
  const match = (s: string) => !q || s.toLowerCase().includes(q);
  const out: UiNode[] = [
    { type: "textInput", key: "run-filter", ...filterInput, value: query, placeholder: "Find a configuration…", prefixSvg: uiIcons.search, changeAction: "filter", autoFocus: true },
  ];
  if (error) out.push({ type: "status", key: "error", text: error, level: "error" });
  if (!runner.available) out.push({ type: "status", key: "no-runner", level: "warn", text: "The runner service isn’t installed yet. You can edit configurations; Run and Debug unlock when it is." });

  const active = sessions.filter(runActive).filter(s => match(s.name));
  if (active.length) out.push(sectionTitle("running-title", "Running"), ...active.map(s => menuRow(`running:${s.id}`, s.name, s.type, "reveal", s.id, false, [
    { type: "label", key: "time", text: s.state === "paused" ? "paused" : s.state === "starting" ? "starting" : elapsed(s), size: "xs", color: "muted", mono: true },
    iconButton("stop", icons.stop, "stopSession", `Stop ${s.name}`, { value: s.id, iconColor: "danger" }),
  ], s.mode === "debug" ? "Debugging" : undefined)));

  const recentConfigs = recent.map(id => configs.find(c => c.id === id)).filter((c): c is RunConfig => !!c && match(c.name));
  if (recentConfigs.length && !q) out.push(sectionTitle("recent-title", "Recent"), ...recentConfigs.map(c => menuRow(`recent:${c.id}`, c.name, c.type, "select", `config:${c.id}`, t?.config?.id === c.id)));

  const saved = configs.filter(c => match(c.name) && (q || !recentConfigs.includes(c)));
  if (saved.length) out.push(sectionTitle("saved-title", "Project configurations"), ...saved.map(c => menuRow(`config:${c.id}`, c.name, c.type, "select", `config:${c.id}`, t?.config?.id === c.id, [
    iconButton("edit", uiIcons.pencil, "editConfig", `Edit ${c.name}`, { value: c.id, iconColor: "muted" }),
  ])));

  const found = candidates.filter(c => match(c.name) && !configs.some(s => s.type === c.type && s.target === c.target));
  if (found.length || detecting) out.push({ type: "row", key: "detected-head", align: "center", children: [
    { type: "column", key: "t", grow: true, children: [sectionTitle("detected-title", "Detected")] },
    detecting ? { type: "label", key: "busy", text: "Scanning…", size: "xs", color: "muted" } : iconButton("rescan", uiIcons.refresh, "detect", "Scan the project again", { iconColor: "muted" }),
  ] }, ...found.slice(0, 30).map(c => menuRow(`cand:${candidateKey(c)}`, c.name, c.type, "select", `candidate:${candidateKey(c)}`, !!t?.candidate && candidateKey(t.candidate) === candidateKey(c), [
    { type: "button", key: "save", text: "Save", action: "saveCandidate", value: candidateKey(c), variant: "ghost", small: true, tooltip: "Save as a project configuration and edit it" },
  ], `detected · ${c.file}:${c.line + 1}`)));

  if (!active.length && !recentConfigs.length && !saved.length && !found.length && !detecting)
    out.push({ type: "label", key: "empty", text: q ? "No matching configurations." : "No configurations yet. Create one, or scan the project for main classes, tests and package scripts.", size: "sm", color: "muted", wrap: true });

  out.push({ type: "divider", key: "footer-divider" }, { type: "row", key: "footer", gap: 4, children: [
    { type: "button", key: "new", text: "New configuration…", iconSvg: uiIcons.plus, action: "newConfig", variant: "ghost", small: true },
    { type: "spacer", key: "sp", grow: true } as UiNode,
    { type: "button", key: "edit-all", text: "Edit configurations…", iconSvg: icons.config, action: "editAll", variant: "ghost", small: true },
  ] });
  return out;
}

const mod: AppModule = {
  id: "run-bar", moduleApiVersion: 1,
  async activate(ctx, previous) {
    const load = async () => {
      const [sel, rec] = await Promise.all([
        ctx.modules.call("persistence", "settings.get", { key: pref("selected") }).catch(() => null),
        ctx.modules.call("persistence", "settings.get", { key: pref("recent") }).catch(() => null),
      ]);
      selection = sel && typeof sel === "object" && (sel.kind === "config" || sel.kind === "candidate") ? sel : null;
      recent = Array.isArray(rec) ? rec.filter((x: unknown) => typeof x === "string").slice(0, 5) : [];
    };
    workspaceId = (ctx.state.get("workspace.selected") as any)?.id || null;
    if (previous?.workspaceId === workspaceId) { configs = previous.configs || []; candidates = previous.candidates || []; detected = !!previous.detected; }
    ctx.state.watch("workspace.selected", async (v: any) => {
      const next = v?.id || null;
      if (next === workspaceId) return;
      ++epoch; workspaceId = next; configs = []; candidates = []; sessions = []; detected = false; selection = null; recent = []; open = false; query = ""; error = null;
      ctx.ui.invalidate();
      if (next) { await load(); await refresh(ctx); }
    });
    ctx.events.on(RUN_EVENTS.changed, (e: any) => { if (e?.workspaceId !== workspaceId) return; sessions = e.sessions || []; runner.available = true; syncTicker(ctx); ctx.ui.invalidate(); });
    ctx.events.on("run-configurations.changed", (e: any) => { if (!e?.workspaceId || e.workspaceId === workspaceId) void refresh(ctx); });
    if (workspaceId) { await load(); await refresh(ctx); }
  },
  deactivate() { ++epoch; if (ticker) clearInterval(ticker); ticker = null; },
  canSwap: () => ({ ok: !busy, ...(busy ? { reason: "A run is starting." } : {}) }),
  snapshot: () => ({ workspaceId, configs, candidates, detected }),
  render(): UiNode {
    const t = target();
    const live = sessionFor(t);
    const debugOk = runner.available && runner.debug && !!t && (!runner.debugTypes.length || runner.debugTypes.includes(t.type));
    const noTarget = !t;
    const chipText = !workspaceId ? "No workspace" : t ? t.name : detecting ? "Scanning…" : "Add configuration…";
    const children: UiNode[] = [
      { type: "dropdown", key: "picker", text: `${chipText}  ⌄`, iconSvg: t ? typeIcon(t.type) : icons.config, variant: "ghost", action: "toggle", open,
        disabled: !workspaceId, width: 190, menuWidth: 360, maxHeight: 560,
        tooltip: t ? `${t.name}${t.candidate ? " (detected)" : ""}\nChoose a run configuration` : "Choose or create a run configuration",
        style: { background: "transparent", borderWidth: 0 }, children: [{ type: "column", key: "menu", gap: 6, padding: 10, scroll: true, children: menu(t) }] },
      live && live.state !== "stopping"
        ? iconButton("restart", icons.restart, "restart", `Restart ${t!.name}`, { disabled: busy })
        : iconButton("run", icons.run, "run", noTarget ? "Nothing to run yet" : !runner.available ? "Runner service not installed yet" : `Run ${t!.name}`,
            { disabled: noTarget || !runner.available || busy, iconColor: noTarget || !runner.available ? "muted" : "success" }),
      iconButton("debug", icons.debug, "debug", !runner.available ? "Runner service not installed yet" : !runner.debug ? "Debugging isn’t available in this runner yet" : noTarget ? "Nothing to debug yet" : debugOk ? `Debug ${t!.name}` : `Debugging isn’t supported for ${t!.type}`,
        { disabled: !debugOk || busy || !!live, iconColor: debugOk && !live ? "info" : "muted" }),
      iconButton("stop", icons.stop, "stop", live ? `Stop ${live.name}` : "Nothing is running", { disabled: !live || live.state === "stopping", iconColor: live ? "danger" : "muted" }),
    ];
    if (live) {
      const text = live.state === "paused" ? `⏸ ${live.pausedAt ? `${live.pausedAt.path.split("/").pop()}:${live.pausedAt.line + 1}` : "Paused"}`
        : live.state === "starting" ? `◌ ${live.phase || "Starting…"}` : live.state === "stopping" ? "◌ Stopping…" : `● ${elapsed(live)}`;
      const others = sessions.filter(runActive).length - 1;
      children.push({ type: "button", key: "status", text: others > 0 ? `${text}  +${others}` : text, action: "reveal", value: live.id, variant: "ghost", small: true,
        tooltip: `${live.mode === "debug" ? "Debugging" : "Running"} ${live.name}${others > 0 ? ` · ${others} more running` : ""}\nShow output`,
        style: { color: live.state === "paused" ? "warning" : "success", font: "mono", fontSize: 11, paddingX: 6, height: 24, radius: 12, background: "surface", noShrink: true } });
    } else {
      const n = sessions.filter(runActive).length;
      if (n) children.push({ type: "button", key: "others", text: `${n} running`, action: "toggle", value: true, variant: "ghost", small: true, tooltip: "Other configurations are running. Open the menu to manage them.", style: { color: "muted", fontSize: 11 } });
    }
    return { type: "row", key: "run-bar", gap: 2, align: "center", children };
  },
  async onEvent(ctx, ev) {
    switch (ev.action) {
      case "toggle": open = !!ev.value; if (open) { query = ""; error = null; void refresh(ctx); if (!detected) void detect(ctx); } break;
      case "filter": query = String(ev.value || ""); break;
      case "select": {
        const v = String(ev.value || "");
        selection = v.startsWith("config:") ? { kind: "config", id: v.slice(7) } : v.startsWith("candidate:") ? { kind: "candidate", key: v.slice(10) } : null;
        open = false; void save(ctx, "selected", selection); break;
      }
      case "detect": void detect(ctx); break;
      case "run": await launch(ctx, "run"); return;
      case "debug": await launch(ctx, "debug"); return;
      case "restart": { const s = sessionFor(target()); if (s && workspaceId) { busy = true; ctx.ui.invalidate(); try { await ctx.modules.call("run", "restart", { workspaceId, id: s.id }, { timeoutMs: 60000 }); } catch (e) { ctx.host.ui.toast("error", `Could not restart: ${errMsg(e)}`); } finally { busy = false; } await refresh(ctx); } return; }
      case "stop": { const s = sessionFor(target()); if (s) await stop(ctx, s.id); return; }
      case "stopSession": await stop(ctx, String(ev.value)); return;
      case "reveal": open = false; ctx.events.emit(RUN_UI_EVENTS.revealSession, { workspaceId, id: ev.value }); break;
      case "editConfig": open = false; ctx.events.emit(RUN_UI_EVENTS.editConfiguration, { workspaceId, id: ev.value }); break;
      case "saveCandidate": {
        const c = candidates.find(c => candidateKey(c) === ev.value);
        open = false;
        if (c) ctx.events.emit(RUN_UI_EVENTS.editConfiguration, { workspaceId, candidate: c });
        break;
      }
      case "newConfig": open = false; ctx.events.emit(RUN_UI_EVENTS.editConfiguration, { workspaceId, candidate: null }); break;
      case "editAll": open = false; ctx.events.emit(RUN_UI_EVENTS.editConfiguration, { workspaceId }); break;
    }
    ctx.ui.invalidate();
  },
};
export default mod;
