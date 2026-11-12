// First-run setup: choose a plugin profile, then install/enable it with per-package progress.
// Installation goes through the normal marketplace path (pinned catalogue, hash checks, native
// approval of each plugin's permissions); this file only decides what to install and shows it.
import type { ModuleContext, PluginInfo, UiNode } from "@hato/sdk/types";
import { errMsg } from "@hato/sdk/runtime";
import { installPackage, managePackage, marketPackages, packageInstalled, refreshMarket, type Package } from "./marketplace";

export const SETUP_KEY = "setup.v1";
type Profile = "empty" | "default" | "full";
type State = "pending" | "running" | "done" | "failed";
type Kind = "catalogue" | "install" | "disable";
interface Step { id: string; kind: Kind; label: string; detail: string; state: State; error?: string; note?: string }

const PROVIDERS = [
  { id: "claude-acp", name: "Claude", hint: "Anthropic's Claude Code agent" },
  { id: "codex-acp", name: "Codex", hint: "OpenAI's Codex agent" },
  { id: "copilot-acp", name: "GitHub Copilot", hint: "GitHub Copilot's coding agent" },
];
/** Shipped with Hato and on by default; "Empty" turns them off. */
const BASELINE = ["core-acp", "git"];
/** The Default profile: baseline plus remote development. Providers are chosen separately. */
const DEFAULT_PACKAGES = ["core-acp", "git", "remote"];

const S = {
  open: false, phase: "choose" as "choose" | "running" | "done",
  profile: "default" as Profile, providers: new Set(["claude-acp", "codex-acp"]),
  steps: [] as Step[], firstRun: false,
};

export const setupOpen = () => S.open;

/** Opens automatically once on a fresh profile (no setup record, projects or marketplace installs). */
export async function initSetup(ctx: ModuleContext, prev: any) {
  if (prev?.setup) { Object.assign(S, prev.setup, { providers: new Set(prev.setup.providers || []) }); if (S.phase === "running") S.phase = "done"; return; }
  // Never block Settings on this check; without persistence the wizard simply stays closed.
  const get = (method: string, args?: any) => Promise.resolve().then(() => ctx.modules.call("persistence", method, args)).catch(() => undefined);
  const [record, receipts, projects] = await Promise.all([get("settings.get", { key: SETUP_KEY }), get("settings.get", { key: "plugins.receipts.v1" }), get("projects.list")]);
  Object.assign(S, { open: false, phase: "choose", steps: [], firstRun: false, profile: "default", providers: new Set(["claude-acp", "codex-acp"]) });
  if (record === undefined || projects === undefined) return;
  if (!record && !Object.keys(receipts || {}).length && !(projects || []).length) Object.assign(S, { open: true, firstRun: true });
}
export const setupSnapshot = () => ({ ...S, providers: [...S.providers] });
export function openSetup() { Object.assign(S, { open: true, phase: "choose", steps: [], firstRun: false }); }

function chosenPackages(all: Package[]): string[] {
  const exists = (id: string) => all.some(p => p.id === id);
  if (S.profile === "empty") return [];
  if (S.profile === "full") return all.filter(p => !p.core || BASELINE.includes(p.id)).map(p => p.id);
  return [...DEFAULT_PACKAGES, ...PROVIDERS.filter(p => S.providers.has(p.id)).map(p => p.id)].filter(exists);
}

function buildSteps(all: Package[], plugins: PluginInfo[]): Step[] {
  const byId = (id: string) => all.find(p => p.id === id);
  if (S.profile === "empty") return BASELINE.map(id => byId(id)).filter((p): p is Package => !!p)
    .map(p => ({ id: p.id, kind: "disable", label: `Turn off ${p.name}`, detail: "You can turn it back on in Settings → Plugins.", state: "pending" }));
  const ids = chosenPackages(all);
  const needsDownload = ids.some(id => { const p = byId(id); return p && !packageInstalled(p, plugins); });
  return [
    ...(needsDownload ? [{ id: "catalogue", kind: "catalogue" as Kind, label: "Check the plugin catalogue", detail: "Finds the latest verified plugin versions.", state: "pending" as State }] : []),
    ...ids.map(id => byId(id)!).map((p): Step => ({ id: p.id, kind: "install", label: p.name, detail: p.description, state: "pending" })),
  ];
}

async function runStep(ctx: ModuleContext, step: Step) {
  const plugins = (await ctx.host.plugins.list()).plugins;
  if (step.kind === "catalogue") { await refreshMarket(ctx); return; }
  const pkg = marketPackages().find(p => p.id === step.id);
  if (!pkg) throw Error("This plugin is not in the catalogue");
  if (step.kind === "disable") {
    // Core packages are switched off module by module; cascade covers anything built on them.
    for (const id of [...pkg.modules].reverse()) {
      const m = plugins.find(m => m.id === id);
      if (m?.enabled) await ctx.host.plugins.disable(id, { cascade: true });
    }
    step.note = "Off";
    return;
  }
  if (packageInstalled(pkg, plugins)) { await managePackage(ctx, "enable", pkg.id, plugins); step.note = "Enabled"; }
  else { await installPackage(ctx, pkg.id, plugins); step.note = `Installed ${pkg.version}`; }
}

async function run(ctx: ModuleContext, onChanged: () => Promise<void>, only?: Set<string>) {
  S.phase = "running"; ctx.ui.invalidate();
  for (const step of S.steps) {
    if (only ? !only.has(step.id) : step.state === "done") continue;
    step.state = "running"; step.error = undefined; ctx.ui.invalidate();
    try { await runStep(ctx, step); step.state = "done"; }
    catch (e) { step.state = "failed"; step.error = errMsg(e); }
    ctx.ui.invalidate();
  }
  await ctx.modules.call("persistence", "settings.set", { key: SETUP_KEY, value: { profile: S.profile, providers: [...S.providers], at: new Date().toISOString(),
    failed: S.steps.filter(s => s.state === "failed").map(s => s.id) } });
  S.phase = "done"; await onChanged(); ctx.ui.invalidate();
}

export async function setupEvent(ctx: ModuleContext, action: string, value: any, onChanged: () => Promise<void>) {
  if (action === "setup.profile" && S.phase === "choose") S.profile = (["empty", "default", "full"].includes(value) ? value : "default") as Profile;
  else if (action.startsWith("setup.provider:") && S.phase === "choose") { const id = action.slice(15); if (PROVIDERS.some(p => p.id === id)) S.providers.has(id) ? S.providers.delete(id) : S.providers.add(id); }
  else if (action === "setup.skip" && S.phase !== "running") {
    if (S.phase === "choose") await ctx.modules.call("persistence", "settings.set", { key: SETUP_KEY, value: { profile: "skipped", at: new Date().toISOString() } });
    S.open = false;
  } else if (action === "setup.start" && S.phase === "choose") {
    S.steps = buildSteps(marketPackages(), (await ctx.host.plugins.list()).plugins);
    await run(ctx, onChanged);
  } else if (action === "setup.retry" && S.phase === "done") {
    const failed = S.steps.filter(s => s.state === "failed");
    // A failed catalogue check blocks every download behind it, so retry those too.
    const ids = new Set(failed.map(s => s.id));
    if (ids.has("catalogue")) for (const s of S.steps) if (s.state === "failed") ids.add(s.id);
    await run(ctx, onChanged, ids);
  } else if (action === "setup.back" && S.phase === "done") { S.phase = "choose"; S.steps = []; }
  ctx.ui.invalidate();
}

// ---- presentation ----------------------------------------------------------------------------

const card = (selected: boolean) => ({ borderWidth: 1, borderColor: selected ? "primary" : "border", radius: 10, padding: 0, background: selected ? "selection" : "transparent" });

function profileCard(id: Profile, title: string, description: string, includes: string, extra: UiNode[] = []): UiNode {
  const selected = S.profile === id;
  return { type: "column", key: `profile:${id}`, gap: 0, style: card(selected), children: [
    { type: "choice", key: `pick:${id}`, text: title, description, selected, action: "setup.profile", value: id, mark: "●",
      style: { background: "transparent", paddingX: 14, paddingY: 10, radius: 10 } },
    ...(selected ? [{ type: "column", key: "more", gap: 8, style: { paddingX: 16, paddingY: 4 }, children: [
      { type: "label", key: "includes", text: includes, size: "xs", color: "muted", wrap: true },
      ...extra,
      { type: "spacer", key: "pad", height: 6 },
    ] } as UiNode] : []),
  ] };
}

function chooseView(): UiNode[] {
  const all = marketPackages(), name = (id: string) => all.find(p => p.id === id)?.name || id;
  const full = all.filter(p => !p.core || BASELINE.includes(p.id));
  const providerCount = S.providers.size;
  const count = S.profile === "empty" ? 0 : chosenPackages(all).length;
  return [
    { type: "label", key: "intro", text: "Choose what to start with. Everything can be changed later in Settings → Plugins.", color: "muted", wrap: true },
    { type: "column", key: "profiles", gap: 10, children: [
      profileCard("empty", "Empty", "Projects, files, the editor and terminals.",
        "AI chat and Git are turned off. Nothing is downloaded."),
      profileCard("default", "Default", "Recommended: AI chat, Git and remote development, with the agents you use.",
        `Includes ${DEFAULT_PACKAGES.map(name).join(", ")}. Choose agent providers:`, [
          { type: "column", key: "providers", gap: 2, children: PROVIDERS.map((p): UiNode => ({ type: "row", key: p.id, gap: 10, align: "center", children: [
            { type: "switch", key: `provider:${p.id}`, label: "", checked: S.providers.has(p.id), action: `setup.provider:${p.id}` } as UiNode,
            { type: "label", key: "name", text: p.name, size: "sm", weight: "medium", style: { width: 120, noShrink: true } },
            { type: "label", key: "hint", text: p.hint, size: "xs", color: "muted", grow: true },
          ] })) },
          ...(!providerCount ? [{ type: "label", key: "none", text: "No agent selected: chat stays available, but you'll need to add a provider before you can start one.", size: "xs", color: "warning", wrap: true } as UiNode] : []),
        ]),
      profileCard("full", "Full", `Every plugin available today (${full.length} packages).`,
        full.map(p => p.name).join(" · ")),
    ] },
    { type: "row", key: "actions", gap: 8, align: "center", children: [
      { type: "label", key: "note", text: count ? "Hato will ask you to approve each new plugin's permissions." : "", size: "xs", color: "muted", grow: true, wrap: true },
      { type: "button", key: "skip", text: S.firstRun ? "Skip for now" : "Cancel", action: "setup.skip", variant: "ghost" },
      { type: "button", key: "start", text: S.profile === "empty" ? "Use empty setup" : `Set up ${count} plugin${count === 1 ? "" : "s"}`, action: "setup.start", variant: "primary" },
    ] },
  ];
}

const ICON: Record<State, [string, string]> = { pending: ["○", "muted"], running: ["◐", "primary"], done: ["✓", "success"], failed: ["✕", "danger"] };

function progressView(): UiNode[] {
  const total = S.steps.length, finished = S.steps.filter(s => s.state === "done" || s.state === "failed").length;
  const failed = S.steps.filter(s => s.state === "failed").length, current = S.steps.find(s => s.state === "running");
  const done = S.phase === "done";
  const headline = !done ? (current ? `${current.kind === "install" ? "Setting up" : ""} ${current.label}…`.trim() : "Preparing…")
    : failed ? `Finished with ${failed} problem${failed === 1 ? "" : "s"}` : total ? "All set" : "Nothing to install";
  return [
    { type: "column", key: "overall", gap: 6, children: [
      { type: "row", key: "head", gap: 8, align: "center", children: [
        { type: "label", key: "title", text: headline, weight: "semibold", grow: true },
        { type: "label", key: "count", text: `${finished} of ${total}`, size: "sm", color: "muted" },
      ] },
      { type: "progress", key: "bar", value: total ? finished / total : 1 },
    ] },
    { type: "column", key: "steps", gap: 0, scroll: true, maxHeight: 360, style: { borderWidth: 1, borderColor: "border", radius: 8 }, children: S.steps.flatMap((s, i): UiNode[] => [
      ...(i ? [{ type: "divider", key: `d:${s.id}` } as UiNode] : []),
      { type: "column", key: s.id, gap: 6, style: { paddingX: 12, paddingY: 10 }, children: [
        { type: "row", key: "line", gap: 10, align: "center", children: [
          { type: "label", key: "icon", text: ICON[s.state][0], color: ICON[s.state][1], weight: "bold", style: { width: 16, noShrink: true } },
          { type: "column", key: "text", grow: true, gap: 2, children: [
            { type: "label", key: "name", text: s.label, size: "sm", weight: "medium", color: s.state === "pending" ? "muted" : "default" },
            ...(s.detail && s.state !== "failed" ? [{ type: "label", key: "detail", text: s.detail, size: "xs", color: "muted", wrap: true } as UiNode] : []),
            ...(s.error ? [{ type: "label", key: "error", text: s.error, size: "xs", color: "danger", wrap: true, selectable: true } as UiNode] : []),
          ] },
          { type: "label", key: "state", size: "xs", color: ICON[s.state][1], style: { noShrink: true },
            text: s.state === "done" ? s.note || "Done" : s.state === "failed" ? "Failed" : s.state === "running" ? "Working…" : "Waiting" },
        ] },
        ...(s.state === "running" ? [{ type: "progress", key: "bar", indeterminate: true } as UiNode] : []),
      ] },
    ]) },
    ...(done ? [{ type: "row", key: "actions", gap: 8, align: "center", children: [
      { type: "label", key: "note", text: failed ? "You can retry now, or install the rest later from Settings → Plugins." : "Your plugins are ready. Open a project to get started.", size: "xs", color: "muted", grow: true, wrap: true },
      ...(failed ? [{ type: "button", key: "retry", text: "Retry failed", action: "setup.retry" } as UiNode] : []),
      ...(!failed && S.steps.length === 0 ? [{ type: "button", key: "back", text: "Back", action: "setup.back", variant: "ghost" } as UiNode] : []),
      { type: "button", key: "finish", text: "Start using Hato", action: "setup.skip", variant: "primary" },
    ] } as UiNode] : [{ type: "label", key: "wait", text: "Keep Hato open while plugins install. Approve permission requests when asked.", size: "xs", color: "muted", wrap: true } as UiNode]),
  ];
}

export function setupModal(): UiNode {
  return { type: "modal", key: "setup-modal", title: S.firstRun ? "Welcome to Hato" : "Set up plugins", width: 640,
    ...(S.phase === "running" ? {} : { closeAction: "setup.skip" }), style: { padding: 24, gap: 18, radius: 14 },
    children: S.phase === "choose" ? chooseView() : progressView() };
}
