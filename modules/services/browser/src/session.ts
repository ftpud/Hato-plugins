// One browser session: process/endpoint lifecycle, tabs, live screencast into a native surface,
// user input forwarding, agent actions (with a visible gliding pointer) and a network log.
import type { ModuleContext, SurfaceKeyEvent, SurfacePointerEvent, SurfaceWheelEvent } from "@hato/sdk/types";
import { errMsg } from "@hato/sdk/runtime";
import { DEFAULT_VIEWPORT, locationLabel, type BrowserNetworkEntry, type BrowserSessionSpec, type BrowserSessionView, type BrowserStatus } from "@hato/sdk/browser";
import { Cdp } from "./cdp";
import { devtoolsPort, endpointUrl, findBrowser, forward, installHeadlessShell, launch, machineFor, processKey, type Launched, type Machine } from "./launch";
import { CLEAR_FN, ELEMENTS_FN, LOCATE_FN, OPTION_FN, PAGE_STATE_FN, QUIET_INSTALL, READBACK_FN, SCROLL_FN, SELECT_FN, TEXT_FN, WAIT_FN } from "./scripts";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const NETWORK_LIMIT = 1000;
const CONSOLE_LIMIT = 500;
/** Request types that mean "the page is still fetching something it will render". */
const PENDING_TYPES = new Set(["Document", "XHR", "Fetch"]);

interface Located {
  x: number; y: number; matches?: number; rect?: { left: number; top: number; width: number; height: number };
  target?: { tag: string; name: string; ref: number; [k: string]: unknown } | null; editable?: boolean;
  coveredBy?: { tag: string; name: string; ref: number }; hidden?: boolean; point?: boolean;
}

export interface ConsoleEntry { seq: number; tab: string; level: string; text: string; at: number; url?: string; line?: number }

/** How an agent points at something: ref, selector, visible name, field label or coordinates (optionally from a screenshot). */
export interface Target {
  ref?: number; selector?: string; name?: string; label?: string; role?: string; nth?: number;
  x?: number; y?: number; scale?: number; originX?: number; originY?: number;
}

interface Tab { id: string; session?: string; url: string; title: string; loading: boolean; openerId?: string; history?: { back: boolean; forward: boolean } }

export interface Carry { surface?: string; proc?: string; profile?: string; key?: string; daemon?: any; ws?: string; forward?: string | null }

type KeyDef = { key: string; code: string; keyCode: number; text?: string };
const SPECIAL: Record<string, KeyDef> = {
  Enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" }, Tab: { key: "Tab", code: "Tab", keyCode: 9 }, Escape: { key: "Escape", code: "Escape", keyCode: 27 },
  Backspace: { key: "Backspace", code: "Backspace", keyCode: 8 }, Delete: { key: "Delete", code: "Delete", keyCode: 46 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 }, ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 }, ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  Home: { key: "Home", code: "Home", keyCode: 36 }, End: { key: "End", code: "End", keyCode: 35 }, PageUp: { key: "PageUp", code: "PageUp", keyCode: 33 },
  PageDown: { key: "PageDown", code: "PageDown", keyCode: 34 }, Space: { key: " ", code: "Space", keyCode: 32, text: " " },
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, { key: `F${i + 1}`, code: `F${i + 1}`, keyCode: 112 + i }])),
};
const ALIASES: Record<string, string> = { enter: "Enter", return: "Enter", tab: "Tab", escape: "Escape", esc: "Escape", backspace: "Backspace", delete: "Delete",
  left: "ArrowLeft", right: "ArrowRight", up: "ArrowUp", down: "ArrowDown", arrowleft: "ArrowLeft", arrowright: "ArrowRight", arrowup: "ArrowUp", arrowdown: "ArrowDown",
  home: "Home", end: "End", pageup: "PageUp", pagedown: "PageDown", space: "Space", " ": "Space" };

export function keyDef(name: string): KeyDef | null {
  const special = SPECIAL[name] || SPECIAL[ALIASES[name.toLowerCase()] || ""] || (/^f\d{1,2}$/i.test(name) ? SPECIAL[name.toUpperCase()] : undefined);
  if (special) return special;
  if ([...name].length !== 1) return null;
  const upper = name.toUpperCase();
  if (/[A-Z]/.test(upper)) return { key: name, code: `Key${upper}`, keyCode: upper.charCodeAt(0), text: name };
  if (/[0-9]/.test(name)) return { key: name, code: `Digit${name}`, keyCode: name.charCodeAt(0), text: name };
  return { key: name, code: "", keyCode: 0, text: name };
}

/** Editing commands for platform shortcuts, which headless browsers do not map themselves. */
function editCommands(def: KeyDef, m: { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean }): string[] {
  const k = def.key.toLowerCase();
  if (m.meta || m.ctrl) {
    if (k === "a") return ["selectAll"];
    if (k === "z") return [m.shift ? "redo" : "undo"];
    if (k === "y") return ["redo"];
    if (k === "x") return ["cut"];
    if (k === "c") return ["copy"];
    if (m.meta && k === "arrowleft") return [m.shift ? "moveToBeginningOfLineAndModifySelection" : "moveToBeginningOfLine"];
    if (m.meta && k === "arrowright") return [m.shift ? "moveToEndOfLineAndModifySelection" : "moveToEndOfLine"];
    if (m.meta && k === "backspace") return ["deleteToBeginningOfLine"];
  }
  if (m.alt) {
    if (k === "arrowleft") return [m.shift ? "moveWordLeftAndModifySelection" : "moveWordLeft"];
    if (k === "arrowright") return [m.shift ? "moveWordRightAndModifySelection" : "moveWordRight"];
    if (k === "backspace") return ["deleteWordBackward"];
  }
  return [];
}
const modBits = (m: { alt?: boolean; ctrl?: boolean; meta?: boolean; shift?: boolean } = {}) => (m.alt ? 1 : 0) | (m.ctrl ? 2 : 0) | (m.meta ? 4 : 0) | (m.shift ? 8 : 0);

export class BrowserSession {
  status: BrowserStatus = "stopped";
  error?: string;
  progress?: string;
  cdp: Cdp | null = null;
  tabs = new Map<string, Tab>();
  activeTab: string | null = null;
  surface: string | null = null;
  agent?: { at: number; text: string; caller?: string };
  network: BrowserNetworkEntry[] = [];
  netSeq = 0;
  consoleLog: ConsoleEntry[] = [];
  consoleSeq = 0;
  /** Network sequence at the start of the latest agent action, so waits can match requests it caused. */
  actionSeq = 0;
  executable?: string;
  private netIndex = new Map<string, BrowserNetworkEntry>();
  private pending = new Map<string, { tab: string; at: number }>();
  private lastSeen = new Map<string, { url: string; title: string }>();
  private machine: Machine | null = null;
  private launched: Launched | null = null;
  private wsUrl = "";
  private forwardHandle: string | null = null;
  private screencastSession: string | null = null;
  private cursor = { x: 0, y: 0, shown: false };
  private stopping = false;
  private starting: Promise<void> | null = null;
  private retries = 0;
  private bySession = new Map<string, string>();
  private loadWaiters = new Set<{ session: string; resolve: () => void }>();
  private titleTimer: number | null = null;

  constructor(private ctx: ModuleContext, public spec: BrowserSessionSpec, private changed: () => void, carry?: Carry) {
    if (carry?.surface) this.surface = carry.surface;
    if (carry?.proc && carry.profile && carry.key) this.launched = { handle: carry.proc, profile: carry.profile, key: carry.key, daemon: carry.daemon ?? null };
  }

  get viewport() { return this.spec.viewport || DEFAULT_VIEWPORT; }

  carry(): Carry {
    return { surface: this.surface || undefined, proc: this.launched?.handle, profile: this.launched?.profile, key: this.launched?.key, daemon: this.launched?.daemon,
      ws: this.cdp?.handle, forward: this.forwardHandle };
  }

  view(): BrowserSessionView {
    const tab = this.activeTab ? this.tabs.get(this.activeTab) : undefined;
    return {
      id: this.spec.id, name: this.spec.name, location: this.spec.location, locationLabel: locationLabel(this.spec.location),
      status: this.status, error: this.error, progress: this.progress,
      agentAccess: !!this.spec.agentAccess, headed: !!this.spec.headed, keepProfile: this.spec.keepProfile !== false,
      viewport: this.viewport, surface: this.surface,
      tabs: [...this.tabs.values()].map(t => ({ id: t.id, title: t.title, url: t.url, loading: t.loading, active: t.id === this.activeTab })),
      activeTab: this.activeTab, url: tab?.url || "", title: tab?.title || "", loading: !!tab?.loading,
      canGoBack: !!tab?.history?.back, canGoForward: !!tab?.history?.forward,
      agent: this.agent, network: { count: this.network.length, seq: this.netSeq }, executable: this.executable,
    };
  }

  private set(status: BrowserStatus, extra: { error?: string; progress?: string } = {}) {
    this.status = status; this.error = extra.error; this.progress = extra.progress; this.changed();
  }

  // ------------------------------------------------------------------ lifecycle

  start(): Promise<void> {
    if (this.status === "running" && this.cdp && !this.cdp.closed) return Promise.resolve();
    if (!this.starting) this.starting = this.doStart().finally(() => { this.starting = null; });
    return this.starting;
  }

  private async doStart() {
    this.stopping = false;
    this.set("starting", { progress: "Connecting…" });
    try {
      if (!this.surface) this.surface = (await this.ctx.host.ui.surfaceOpen({ label: `browser ${this.spec.name}` })).handle;
      const deadline = Date.now() + 45_000;
      let lastError: any;
      for (let attempt = 0; Date.now() < deadline; attempt++) {
        try {
          this.wsUrl = await this.resolveUrl(attempt > 0);
          this.cdp = await Cdp.connect(this.ctx, this.wsUrl);
          break;
        } catch (e) {
          lastError = e;
          if (this.spec.location.kind === "endpoint" || this.stopping) throw e;
          await sleep(500);
        }
      }
      if (!this.cdp) throw lastError || new Error("Could not connect to the browser");
      const cdp = this.cdp;
      cdp.onClose = reason => this.lost(cdp, reason);
      this.wire(cdp);
      await cdp.send("Target.setDiscoverTargets", { discover: true });
      const { targetInfos } = await cdp.send("Target.getTargets");
      const pages = (targetInfos || []).filter((t: any) => t.type === "page");
      for (const t of pages) this.tabs.set(t.targetId, { id: t.targetId, url: t.url, title: t.title, loading: false, openerId: t.openerId });
      if (!pages.length) {
        const { targetId } = await cdp.send("Target.createTarget", { url: this.spec.startUrl || "about:blank" });
        this.tabs.set(targetId, { id: targetId, url: "about:blank", title: "", loading: false });
      }
      await Promise.all([...this.tabs.keys()].map(id => this.attach(id).catch(e => this.ctx.log.warn("attach tab", errMsg(e)))));
      const first = (this.activeTab && this.tabs.has(this.activeTab)) ? this.activeTab : [...this.tabs.keys()][0];
      this.retries = 0;
      this.set("running");
      if (this.titleTimer === null) this.titleTimer = setInterval(() => { if (this.activeTab) this.syncTitle(this.activeTab).catch(() => {}); }, 2000);
      if (first) await this.activate(first);
      this.watchProcess();
    } catch (e) {
      this.set("error", { error: errMsg(e) });
      throw e;
    }
  }

  private async resolveUrl(retry: boolean): Promise<string> {
    if (this.spec.location.kind === "endpoint") { this.progress = "Contacting endpoint…"; this.changed(); return endpointUrl(this.ctx, this.spec.location.url); }
    if (!this.machine) this.machine = await machineFor(this.ctx, this.spec);
    const m = this.machine;
    if (!this.launched) {
      this.progress = "Locating browser…"; this.changed();
      let bin = await findBrowser(this.ctx, m, this.spec.executable);
      if (!bin) {
        this.progress = "Downloading a headless browser…"; this.changed();
        bin = await installHeadlessShell(this.ctx, m);
      }
      this.executable = bin;
      this.progress = "Starting browser…"; this.changed();
      this.launched = await launch(this.ctx, m, this.spec, bin, this.viewport);
    }
    if (retry && this.forwardHandle) { await this.ctx.host.ssh.cancelForward(this.forwardHandle).catch(() => {}); this.forwardHandle = null; }
    const { port, path } = await devtoolsPort(this.ctx, m, this.launched.profile);
    if (!this.forwardHandle || retry) {
      const f = await forward(this.ctx, m, port);
      this.forwardHandle = f.handle;
      return `ws://127.0.0.1:${f.port}${path}`;
    }
    return this.wsUrl;
  }

  private watchProcess() {
    const l = this.launched;
    if (!l) return;
    this.ctx.host.process.wait(l.handle).then(exit => {
      if (this.launched !== l || this.stopping) return;
      if (exit === null) return;
      this.launched = null;
      this.teardown();
      this.set("error", { error: `The browser exited${exit.code !== null ? ` (code ${exit.code})` : exit.signal !== null ? ` (signal ${exit.signal})` : ""}` });
    }).catch(() => {});
  }

  private lost(cdp: Cdp, reason: string) {
    if (this.cdp !== cdp) return;
    this.cdp = null;
    this.tabs.clear(); this.bySession.clear(); this.screencastSession = null;
    if (this.stopping) return;
    this.set("error", { error: `Connection lost: ${reason}` });
    if (this.retries++ < 3) setTimeout(() => { if (!this.stopping && this.status === "error") this.start().catch(() => {}); }, 1500 * this.retries);
  }

  private teardown() {
    if (this.titleTimer !== null) { clearInterval(this.titleTimer); this.titleTimer = null; }
    const cdp = this.cdp;
    this.cdp = null;
    if (cdp) cdp.close().catch(() => {});
    if (this.forwardHandle) { this.ctx.host.ssh.cancelForward(this.forwardHandle).catch(() => {}); this.forwardHandle = null; }
    this.tabs.clear(); this.bySession.clear(); this.screencastSession = null;
  }

  /** Disconnect; `kill` also ends the browser process (its profile stays when kept). */
  async stop(kill = true) {
    this.stopping = true;
    this.teardown();
    if (kill && this.launched) {
      const l = this.launched;
      this.launched = null;
      try {
        if (l.daemon) await this.ctx.host.daemon.request(l.daemon, "proc.kill", { key: l.key });
        else await this.ctx.host.process.terminate(l.handle);
      } catch (e) { this.ctx.log.warn("stop browser", errMsg(e)); }
    }
    if (this.surface) await this.ctx.host.ui.surfaceClear(this.surface).catch(() => {});
    this.set("stopped");
  }

  /** Release native resources on module unload without ending the browser. */
  async detach() {
    this.stopping = true;
    if (this.titleTimer !== null) { clearInterval(this.titleTimer); this.titleTimer = null; }
    const cdp = this.cdp;
    this.cdp = null;
    if (cdp) await cdp.close().catch(() => {});
  }

  async removeProfile() {
    if (this.spec.location.kind === "endpoint") return;
    const m = this.machine || await machineFor(this.ctx, this.spec);
    const dir = `${m.stateDir}/profiles/${this.spec.id.replace(/[^A-Za-z0-9_-]/g, "_")}`;
    await this.ctx.host.process.run(m.grant.grant, { target: m.target, executable: "rm", args: ["-rf", dir], cwd: m.grant.root }, { timeoutMs: 30_000 });
  }

  // ------------------------------------------------------------------ CDP wiring

  private tabOf(sessionId?: string) { return sessionId ? this.bySession.get(sessionId) : undefined; }

  private wire(cdp: Cdp) {
    cdp.on("Target.targetCreated", ({ targetInfo: t }) => {
      if (t.type !== "page" || this.tabs.has(t.targetId)) return;
      this.tabs.set(t.targetId, { id: t.targetId, url: t.url, title: t.title, loading: true, openerId: t.openerId });
      this.attach(t.targetId).then(() => { if (t.openerId && t.openerId === this.activeTab) return this.activate(t.targetId); }).catch(e => this.ctx.log.warn("attach", errMsg(e)));
      this.changed();
    });
    cdp.on("Target.targetInfoChanged", ({ targetInfo: t }) => {
      const tab = this.tabs.get(t.targetId);
      if (!tab) return;
      const navigated = tab.url !== t.url;
      tab.url = t.url;
      // Target titles fall back to the URL; keep a real document title synced from the page.
      if (navigated || (t.title && t.title !== t.url)) tab.title = t.title;
      this.changed();
      if (navigated) this.syncTitle(t.targetId).catch(() => {});
    });
    cdp.on("Target.targetDestroyed", ({ targetId }) => {
      const tab = this.tabs.get(targetId);
      if (!tab) return;
      this.tabs.delete(targetId);
      if (tab.session) this.bySession.delete(tab.session);
      if (this.activeTab === targetId) {
        this.activeTab = null;
        const next = (tab.openerId && this.tabs.has(tab.openerId)) ? tab.openerId : [...this.tabs.keys()].pop();
        if (next) this.activate(next).catch(() => {});
        else if (this.cdp) this.newTab("about:blank").catch(() => {});
      }
      this.changed();
    });
    cdp.on("Page.frameStartedLoading", ({ frameId }, s) => { const id = this.tabOf(s); const tab = id && this.tabs.get(id); if (tab && frameId === id) { tab.loading = true; this.changed(); } });
    cdp.on("Page.frameStoppedLoading", ({ frameId }, s) => {
      const id = this.tabOf(s); const tab = id && this.tabs.get(id);
      if (tab && frameId === id) { tab.loading = false; this.changed(); this.refreshHistory(id).catch(() => {}); this.syncTitle(id).catch(() => {}); }
    });
    cdp.on("Page.loadEventFired", (_p, s) => { for (const w of [...this.loadWaiters]) if (w.session === s) { this.loadWaiters.delete(w); w.resolve(); } });
    cdp.on("Page.navigatedWithinDocument", (_p, s) => { const id = this.tabOf(s); if (id) this.refreshHistory(id).catch(() => {}); });
    cdp.on("Page.frameNavigated", ({ frame }, s) => { const id = this.tabOf(s); if (id && !frame.parentId) this.refreshHistory(id).catch(() => {}); });
    cdp.on("Page.screencastFrame", (p, s) => this.frame(p, s));
    cdp.on("Page.javascriptDialogOpening", (p, s) => {
      // Never block a session on a modal dialog: accept alerts/confirms, keep prompt defaults.
      cdp.send("Page.handleJavaScriptDialog", { accept: true, promptText: p.defaultPrompt || "" }, s).catch(() => {});
      this.agent = { at: Date.now(), text: `Dialog: ${String(p.message || "").slice(0, 120)}` }; this.changed();
    });
    // Console and uncaught errors
    const note = (level: string, text: string, s?: string, extra: { url?: string; line?: number } = {}) => {
      this.consoleLog.push({ seq: ++this.consoleSeq, tab: this.tabOf(s) || "", level, text: text.slice(0, 2000), at: Date.now(), ...extra });
      if (this.consoleLog.length > CONSOLE_LIMIT) this.consoleLog.shift();
    };
    const show = (a: any) => a.value !== undefined ? (typeof a.value === "string" ? a.value : JSON.stringify(a.value)) : a.description || a.unserializableValue || a.type;
    cdp.on("Runtime.consoleAPICalled", (p, s) => note(p.type === "warning" ? "warn" : p.type, (p.args || []).map(show).join(" "), s, { url: p.stackTrace?.callFrames?.[0]?.url, line: p.stackTrace?.callFrames?.[0]?.lineNumber }));
    cdp.on("Runtime.exceptionThrown", (p, s) => { const d = p.exceptionDetails || {}; note("exception", d.exception?.description || d.text || "Uncaught exception", s, { url: d.url, line: d.lineNumber }); });
    cdp.on("Log.entryAdded", (p, s) => note(p.entry?.level === "warning" ? "warn" : p.entry?.level || "log", `${p.entry?.text || ""}${p.entry?.url ? ` (${p.entry.url})` : ""}`, s, { url: p.entry?.url, line: p.entry?.lineNumber }));
    // Network log
    cdp.on("Network.requestWillBeSent", (p, s) => {
      const tab = this.tabOf(s) || "";
      const prev = this.netIndex.get(p.requestId);
      if (prev && p.redirectResponse) { prev.status = p.redirectResponse.status; prev.statusText = p.redirectResponse.statusText; prev.durationMs = Math.round((p.timestamp - (prev as any)._ts) * 1000); this.netIndex.delete(p.requestId); }
      const e: BrowserNetworkEntry & { _ts?: number } = { seq: ++this.netSeq, requestId: p.requestId, tab, url: p.request.url, method: p.request.method, type: p.type,
        startedAt: Math.round((p.wallTime || Date.now() / 1000) * 1000), requestHeaders: p.request.headers, postData: typeof p.request.postData === "string" ? p.request.postData.slice(0, 20_000) : undefined };
      Object.defineProperty(e, "_ts", { value: p.timestamp, enumerable: false, writable: true });
      this.netIndex.set(p.requestId, e);
      if (PENDING_TYPES.has(p.type)) this.pending.set(p.requestId, { tab, at: Date.now() });
      this.network.push(e);
      if (this.network.length > NETWORK_LIMIT) { const old = this.network.shift()!; if (this.netIndex.get(old.requestId) === old) this.netIndex.delete(old.requestId); }
      this.changed();
    });
    cdp.on("Network.responseReceived", p => {
      const e = this.netIndex.get(p.requestId); if (!e) return;
      e.status = p.response.status; e.statusText = p.response.statusText; e.mimeType = p.response.mimeType; e.responseHeaders = p.response.headers;
      e.fromCache = !!(p.response.fromDiskCache || p.response.fromServiceWorker || p.response.fromPrefetchCache); e.type = p.type || e.type;
      this.netSeq++; this.changed();
    });
    cdp.on("Network.loadingFinished", p => {
      this.pending.delete(p.requestId);
      const e = this.netIndex.get(p.requestId); if (!e) return;
      e.encodedBytes = p.encodedDataLength; e.durationMs = Math.round((p.timestamp - (e as any)._ts) * 1000); this.netSeq++; this.changed();
    });
    cdp.on("Network.loadingFailed", p => {
      this.pending.delete(p.requestId);
      const e = this.netIndex.get(p.requestId); if (!e) return;
      e.failed = true; e.error = p.canceled ? "canceled" : p.errorText || p.blockedReason || "failed"; e.durationMs = Math.round((p.timestamp - (e as any)._ts) * 1000); this.netSeq++; this.changed();
    });
  }

  private async attach(targetId: string) {
    const cdp = this.cdp!;
    const tab = this.tabs.get(targetId);
    if (!tab || tab.session) return;
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    tab.session = sessionId;
    this.bySession.set(sessionId, targetId);
    const vp = this.viewport;
    await Promise.all([
      cdp.send("Page.enable", {}, sessionId),
      cdp.send("Network.enable", { maxPostDataSize: 20_000 }, sessionId),
      cdp.send("Runtime.enable", {}, sessionId).catch(() => {}),
      cdp.send("Log.enable", {}, sessionId).catch(() => {}),
      cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: QUIET_INSTALL }, sessionId).catch(() => {}),
      this.spec.headed ? Promise.resolve() : cdp.send("Emulation.setDeviceMetricsOverride", { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: false }, sessionId),
      cdp.send("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => {}),
    ]);
    await this.refreshHistory(targetId).catch(() => {});
  }

  /** Target info does not report every title change (data: URLs, script-set titles). */
  private async syncTitle(targetId: string) {
    const tab = this.tabs.get(targetId);
    if (!tab?.session || !this.cdp) return;
    const r = await this.cdp.send("Runtime.evaluate", { expression: "document.title", returnByValue: true }, tab.session, 5_000);
    const title = typeof r.result?.value === "string" ? r.result.value : "";
    if (title && title !== tab.title) { tab.title = title; this.changed(); }
  }

  private async refreshHistory(targetId: string) {
    const tab = this.tabs.get(targetId);
    if (!tab?.session || !this.cdp) return;
    const h = await this.cdp.send("Page.getNavigationHistory", {}, tab.session);
    tab.history = { back: h.currentIndex > 0, forward: h.currentIndex < h.entries.length - 1 };
    this.changed();
  }

  private async frame(p: any, sessionId?: string) {
    const cdp = this.cdp;
    if (!cdp) return;
    try {
      if (sessionId === this.screencastSession && this.surface) {
        await this.ctx.host.ui.surfaceFrame(this.surface, { data: p.data, width: p.metadata?.deviceWidth, height: p.metadata?.deviceHeight });
      }
    } catch (e) { this.ctx.log.warn("surface frame", errMsg(e)); }
    cdp.send("Page.screencastFrameAck", { sessionId: p.sessionId }, sessionId).catch(() => {});
  }

  // ------------------------------------------------------------------ tabs

  private tab(id?: string | null): Tab {
    const tab = this.tabs.get(id || this.activeTab || "");
    if (!tab?.session) throw new Error(id ? `No tab ${id}` : "The session has no open tab");
    return tab;
  }

  async activate(targetId: string) {
    const cdp = this.cdp;
    if (!cdp) throw new Error("The browser is not running");
    const tab = this.tabs.get(targetId);
    if (!tab) throw new Error(`No tab ${targetId}`);
    if (!tab.session) await this.attach(targetId);
    if (this.screencastSession && this.screencastSession !== tab.session) await cdp.send("Page.stopScreencast", {}, this.screencastSession).catch(() => {});
    this.activeTab = targetId;
    this.screencastSession = tab.session!;
    const vp = this.viewport;
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 72, maxWidth: vp.width, maxHeight: vp.height, everyNthFrame: 1 }, tab.session);
    if (this.spec.headed) await cdp.send("Target.activateTarget", { targetId }).catch(() => {});
    this.changed();
  }

  async newTab(url = "about:blank") {
    const cdp = this.need();
    const { targetId } = await cdp.send("Target.createTarget", { url: this.normalizeUrl(url) });
    if (!this.tabs.has(targetId)) this.tabs.set(targetId, { id: targetId, url, title: "", loading: true });
    await this.attach(targetId);
    await this.activate(targetId);
    return targetId;
  }

  async closeTab(targetId: string) { await this.need().send("Target.closeTarget", { targetId }); }

  async setViewport(width: number, height: number) {
    const w = Math.round(Math.min(Math.max(width, 320), 3840)), h = Math.round(Math.min(Math.max(height, 240), 2400));
    this.spec.viewport = { width: w, height: h };
    const cdp = this.cdp;
    if (cdp && !this.spec.headed) {
      for (const t of this.tabs.values()) if (t.session) await cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false }, t.session).catch(() => {});
      if (this.activeTab) await this.activate(this.activeTab);
    }
    this.changed();
  }

  private need(): Cdp {
    if (!this.cdp || this.status !== "running") throw new Error(`Browser session "${this.spec.name}" is not running`);
    return this.cdp;
  }

  normalizeUrl(url: string) {
    const u = url.trim();
    if (!u) return "about:blank";
    if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return u;
    if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(u)) return `http://${u}`;
    if (/^[^\s/]+\.[^\s/]{2,}(\/|$)/.test(u)) return `https://${u}`;
    return `https://www.google.com/search?q=${encodeURIComponent(u)}`;
  }

  // ------------------------------------------------------------------ navigation

  private waitLoad(session: string, ms: number) {
    return new Promise<void>(resolve => {
      const w = { session, resolve };
      this.loadWaiters.add(w);
      setTimeout(() => { if (this.loadWaiters.delete(w)) resolve(); }, ms);
    });
  }

  async navigate(url: string, tabId?: string, waitMs = 15_000) {
    const cdp = this.need(), tab = this.tab(tabId);
    this.actionSeq = this.netSeq;
    const loaded = this.waitLoad(tab.session!, waitMs);
    const r = await cdp.send("Page.navigate", { url: this.normalizeUrl(url) }, tab.session);
    if (r.errorText) throw new Error(`Navigation failed: ${r.errorText}`);
    await loaded;
    return this.observe(tab.id);
  }

  async history(action: "back" | "forward" | "reload" | "stop", tabId?: string) {
    const cdp = this.need(), tab = this.tab(tabId);
    if (action === "reload") { const loaded = this.waitLoad(tab.session!, 15_000); this.actionSeq = this.netSeq; await cdp.send("Page.reload", {}, tab.session); await loaded; return this.observe(tab.id); }
    if (action === "stop") { await cdp.send("Page.stopLoading", {}, tab.session); return this.where(tab.id); }
    const h = await cdp.send("Page.getNavigationHistory", {}, tab.session);
    const index = h.currentIndex + (action === "back" ? -1 : 1);
    if (index < 0 || index >= h.entries.length) throw new Error(`Nothing to go ${action} to`);
    const loaded = this.waitLoad(tab.session!, 10_000);
    await cdp.send("Page.navigateToHistoryEntry", { entryId: h.entries[index].id }, tab.session);
    await loaded;
    return this.observe(tab.id);
  }

  where(tabId?: string) {
    const tab = this.tabs.get(tabId || this.activeTab || "");
    return { session: this.spec.id, tab: tab?.id, url: tab?.url, title: tab?.title, loading: tab?.loading };
  }

  // ------------------------------------------------------------------ user input (from the panel)

  async userPointer(e: SurfacePointerEvent) {
    const cdp = this.cdp, s = this.screencastSession;
    if (!cdp || !s) return;
    const type = e.kind === "down" ? "mousePressed" : e.kind === "up" ? "mouseReleased" : "mouseMoved";
    await cdp.send("Input.dispatchMouseEvent", { type, x: e.x, y: e.y, button: e.kind === "move" ? (e.buttons & 1 ? "left" : e.buttons & 2 ? "right" : "none") : e.button || "left",
      buttons: e.buttons, clickCount: e.kind === "move" ? 0 : Math.max(1, e.clickCount), modifiers: modBits(e.modifiers) }, s);
  }

  async userWheel(e: SurfaceWheelEvent) {
    const cdp = this.cdp, s = this.screencastSession;
    if (!cdp || !s) return;
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: e.x, y: e.y, deltaX: e.deltaX, deltaY: e.deltaY }, s);
  }

  async userKey(e: SurfaceKeyEvent) {
    const cdp = this.cdp, s = this.screencastSession;
    if (!cdp || !s) return;
    if (e.kind === "paste") { await cdp.send("Input.insertText", { text: e.text }, s); return; }
    const def = keyDef(e.key);
    if (!def) return;
    const m = e.modifiers;
    const printable = !!e.text && !m.ctrl && !m.meta && [...e.text].length === 1 && e.text >= " ";
    const text = printable ? e.text! : def.text && !m.ctrl && !m.meta ? def.text : undefined;
    if (e.kind === "up") { await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: printable ? e.text : def.key, code: def.code, windowsVirtualKeyCode: def.keyCode, modifiers: modBits(m) }, s); return; }
    await cdp.send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", key: printable ? e.text : def.key, code: def.code, windowsVirtualKeyCode: def.keyCode,
      text, unmodifiedText: text, modifiers: modBits(m), commands: editCommands(def, m) }, s);
  }

  // ------------------------------------------------------------------ agent actions

  noteAgent(text: string, caller?: string) { this.agent = { at: Date.now(), text, caller }; this.changed(); }

  private async glide(x: number, y: number, click: boolean) {
    if (!this.surface) return;
    const from = this.cursor.shown ? this.cursor : { x: this.viewport.width / 2, y: this.viewport.height / 2 };
    const dist = Math.hypot(x - from.x, y - from.y);
    const durationMs = this.cursor.shown ? Math.round(Math.min(Math.max(220 + dist * 0.45, 250), 900)) : 0;
    if (!this.cursor.shown) await this.ctx.host.ui.surfaceCursor(this.surface, { x: from.x, y: from.y, durationMs: 0 });
    await this.ctx.host.ui.surfaceCursor(this.surface, { x, y, durationMs: Math.max(durationMs, 300), click });
    this.cursor = { x, y, shown: true };
    await sleep(Math.max(durationMs, 300));
  }

  async evaluate(fn: string, args: any[], tabId?: string, awaitPromise = false): Promise<any> {
    const cdp = this.need(), tab = this.tab(tabId);
    const expression = `(${fn})(${args.map(a => JSON.stringify(a ?? null)).join(",")})`;
    const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise, userGesture: true }, tab.session, 30_000);
    if (r.exceptionDetails) throw new Error(`Page script failed: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result?.value;
  }

  private pendingCount(tabId: string) {
    const now = Date.now();
    let n = 0;
    for (const [id, p] of this.pending) {
      if (now - p.at > 20_000) { this.pending.delete(id); continue; } // long-polls and lost events do not block "settled"
      if (p.tab === tabId) n++;
    }
    return n;
  }

  /** Is the page done changing? Combines document state, in-flight XHR/fetch, DOM quiet time and loading indicators. */
  async readiness(tabId?: string, quietMs = 500) {
    const tab = this.tab(tabId);
    const page = await this.evaluate(PAGE_STATE_FN, [], tab.id).catch(() => null);
    const pendingRequests = this.pendingCount(tab.id);
    const quiet = page?.quietMs ?? 0;
    const settled = !!page && page.readyState === "complete" && !tab.loading && pendingRequests === 0 && !page.busy && quiet >= quietMs;
    return { settled, readyState: page?.readyState ?? "unknown", pendingRequests, busy: !!page?.busy, ...(page?.busyReason ? { busyReason: page.busyReason as string } : {}),
      quietMs: Math.round(quiet), focused: page?.focused ?? null };
  }

  private mark(tab: Tab) { this.lastSeen.set(tab.id, { url: tab.url, title: tab.title }); }

  /** Post-action state: where we are, whether URL/title changed since the previous call, the focused element and readiness. */
  async observe(tabId?: string) {
    const tab = this.tab(tabId);
    const { focused, ...page } = await this.readiness(tab.id, 300);
    const prev = this.lastSeen.get(tab.id);
    this.mark(tab);
    return { ...this.where(tab.id), changed: { url: !!prev && prev.url !== tab.url, title: !!prev && prev.title !== tab.title }, focused, page };
  }

  async text(scope: "page" | "viewport", selector?: string, maxChars = 20_000, tabId?: string) {
    const r = await this.evaluate(TEXT_FN, [scope, selector || null, Math.min(Math.max(maxChars, 200), 200_000)], tabId);
    if (r?.error) throw new Error(r.error);
    const tab = this.tab(tabId);
    const { focused: _focused, ...ready } = await this.readiness(tab.id);
    this.mark(tab);
    return { ...this.where(tabId), ...r, contentLoaded: ready.settled, ready,
      ...(ready.settled ? {} : { warning: "The page is not settled yet, so this text may be partial (loading spinners, pending requests or recent DOM changes). Use browser_wait with no arguments to wait until it settles, then read again." }) };
  }

  /** Interactive elements. `fields` lists form controls only, with label, value and checked/selected/disabled state. */
  async elements(all = false, max = 200, tabId?: string, opts: { fields?: boolean; selector?: string } = {}) {
    const r = await this.evaluate(ELEMENTS_FN, [all, Math.min(Math.max(max, 1), 1000), !!opts.fields, opts.selector || null], tabId);
    if (r?.error) throw new Error(r.error);
    this.mark(this.tab(tabId));
    return { ...this.where(tabId), ...r };
  }

  async screenshot(opts: Target & { quality?: "tiny" | "low" | "full"; fullPage?: boolean; tab?: string; maxWidth?: number; region?: { x: number; y: number; width: number; height: number } }) {
    const cdp = this.need(), tab = this.tab(opts.tab);
    const quality = opts.quality === "full" ? "full" : opts.quality === "tiny" ? "tiny" : "low";
    let crop: { x: number; y: number; width: number; height: number } | undefined = opts.region;
    if (!crop && (opts.ref || opts.selector || opts.name || opts.label)) {
      const p = await this.locate(opts, tab.id);
      if (!p.rect) throw new Error("Could not measure the element to crop to");
      const pad = 8;
      crop = { x: p.rect.left - pad, y: p.rect.top - pad, width: p.rect.width + pad * 2, height: p.rect.height + pad * 2 };
    }
    const metrics = await cdp.send("Page.getLayoutMetrics", {}, tab.session);
    const vv = metrics.cssVisualViewport || metrics.visualViewport || { clientWidth: this.viewport.width, clientHeight: this.viewport.height, pageX: 0, pageY: 0 };
    const content = metrics.cssContentSize || metrics.contentSize;
    let x = vv.pageX, y = vv.pageY, width = vv.clientWidth, height = vv.clientHeight, origin = { x: 0, y: 0 };
    if (crop) {
      const left = Math.max(0, crop.x), top = Math.max(0, crop.y);
      width = Math.max(1, Math.min(vv.clientWidth, crop.x + crop.width) - left); height = Math.max(1, Math.min(vv.clientHeight, crop.y + crop.height) - top);
      x = vv.pageX + left; y = vv.pageY + top; origin = { x: Math.round(left), y: Math.round(top) };
    } else if (opts.fullPage) { x = 0; y = 0; width = content.width; height = Math.min(content.height, 16_000); }
    const limit = opts.maxWidth && opts.maxWidth > 0 ? opts.maxWidth : quality === "tiny" ? 480 : quality === "low" ? 960 : Infinity;
    const scale = Math.min(1, limit / Math.max(width, 1));
    const jpeg = quality !== "full";
    const r = await cdp.send("Page.captureScreenshot", { format: jpeg ? "jpeg" : "png", ...(jpeg ? { quality: quality === "tiny" ? 40 : 55 } : {}),
      clip: { x, y, width, height, scale }, captureBeyondViewport: !!opts.fullPage && !crop }, tab.session, 60_000);
    return { data: r.data as string, mimeType: jpeg ? "image/jpeg" : "image/png", width: Math.round(width * scale), height: Math.round(height * scale), cssWidth: width, cssHeight: height, scale, origin,
      coordinates: "Viewport CSS px = origin + picture px / scale. Or pass picture px to click/hover/scroll with scale (and originX/originY).", ...this.where(tab.id) };
  }

  /** Resolve a target to viewport coordinates, with a description of what is there. */
  private async locate(target: Target, tabId?: string, scroll = true): Promise<Located> {
    const scale = target.scale && target.scale > 0 ? target.scale : 1;
    const point = typeof target.x === "number" && typeof target.y === "number" ? { x: (target.originX ?? 0) + target.x / scale, y: (target.originY ?? 0) + target.y / scale } : null;
    if (!point && !target.ref && !target.selector && !target.name && !target.label) {
      throw new Error("Give x/y coordinates, an element ref (from browser_elements), a CSS selector, or a visible name/label");
    }
    const spec = { ref: target.ref || null, selector: target.selector || null, name: target.name || null, label: target.label || null, role: target.role || null, nth: target.nth ?? 0, ...(point ?? {}) };
    let r: any;
    try { r = await this.evaluate(LOCATE_FN, [spec, scroll], tabId); }
    catch (e) { if (point) return { x: point.x, y: point.y }; throw e; }
    if (r?.error) throw new Error(r.error);
    if (scroll && !point) await sleep(120);
    return r as Located;
  }

  private targetInfo(p: Located) {
    const warnings: string[] = [];
    if (p.matches && p.matches > 1) warnings.push(`${p.matches} elements matched; used the first. Pass ref (from browser_elements) or nth to choose another.`);
    if (p.coveredBy) warnings.push(`The target is covered by another element (${p.coveredBy.tag} "${p.coveredBy.name}"); a click lands there instead.`);
    if (p.hidden) warnings.push("The target has no visible size.");
    return { target: p.target, ...(p.matches && p.matches > 1 ? { matches: p.matches } : {}), ...(p.coveredBy ? { coveredBy: p.coveredBy } : {}), ...(warnings.length ? { warning: warnings.join(" ") } : {}) };
  }

  /** After an action: let navigation and the requests it triggered finish (bounded). */
  private async settle(tabId?: string) {
    await sleep(250);
    const tab = this.tabs.get(tabId || this.activeTab || "");
    if (!tab) return;
    const start = Date.now();
    while ((tab.loading && Date.now() - start < 5000) || (this.pendingCount(tab.id) > 0 && Date.now() - start < 3000)) await sleep(125);
  }

  async click(t: Target & { button?: "left" | "right" | "middle"; clickCount?: number; tab?: string; modifiers?: any; dryRun?: boolean }) {
    const cdp = this.need(), tab = this.tab(t.tab);
    if (t.tab && t.tab !== this.activeTab) await this.activate(t.tab);
    const p = await this.locate(t, tab.id);
    const info = this.targetInfo(p);
    if (t.dryRun) return { dryRun: true, wouldClick: { x: Math.round(p.x), y: Math.round(p.y) }, ...info, ...this.where(tab.id) };
    this.actionSeq = this.netSeq;
    await this.glide(p.x, p.y, true);
    const button = t.button || "left", clickCount = Math.min(Math.max(t.clickCount || 1, 1), 3), modifiers = modBits(t.modifiers);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y, modifiers }, tab.session);
    for (let i = 1; i <= clickCount; i++) {
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button, buttons: button === "left" ? 1 : button === "right" ? 2 : 4, clickCount: i, modifiers }, tab.session);
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button, buttons: 0, clickCount: i, modifiers }, tab.session);
    }
    await this.settle(tab.id);
    return { clicked: { x: Math.round(p.x), y: Math.round(p.y) }, ...info, ...await this.observe(tab.id) };
  }

  async hover(t: Target & { tab?: string }) {
    const cdp = this.need(), tab = this.tab(t.tab);
    const p = await this.locate(t, tab.id);
    await this.glide(p.x, p.y, false);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y }, tab.session);
    return { hovered: { x: Math.round(p.x), y: Math.round(p.y) }, ...this.targetInfo(p), ...this.where(tab.id) };
  }

  /** What is at a point or behind a ref/selector/name, and is it covered? Never acts on the page. */
  async inspect(t: Target & { tab?: string }) {
    const tab = this.tab(t.tab);
    const p = await this.locate(t, tab.id, false);
    return { point: { x: Math.round(p.x), y: Math.round(p.y) }, ...(p.rect ? { rect: p.rect } : {}), ...this.targetInfo(p), ...this.where(tab.id) };
  }

  async type(t: Target & { text: string; clear?: boolean; submit?: boolean; tab?: string; delayMs?: number; dryRun?: boolean }) {
    const cdp = this.need(), tab = this.tab(t.tab);
    const text = String(t.text ?? "");
    const hasTarget = !!(t.ref || t.selector || t.name || t.label || typeof t.x === "number");
    // A visible name given for typing means the field with that label.
    const target: Target = { ref: t.ref, selector: t.selector, label: t.label ?? t.name, role: t.role, nth: t.nth, x: t.x, y: t.y, scale: t.scale, originX: t.originX, originY: t.originY };
    if (t.dryRun) return { ...(hasTarget ? await this.click({ ...target, tab: tab.id, dryRun: true }) : this.where(tab.id)), dryRun: true, wouldType: text.length };
    if (hasTarget) await this.click({ ...target, tab: tab.id });
    this.actionSeq = this.netSeq;
    if (t.clear) {
      const ok = await this.evaluate(CLEAR_FN, [null], tab.id).catch(() => false);
      if (!ok) await this.pressKey("a", { meta: true }, tab.id);
    }
    const delay = Math.min(Math.max(t.delayMs ?? 12, 0), 200);
    if (text.length > 200 || delay === 0) await cdp.send("Input.insertText", { text }, tab.session);
    else for (const ch of text) {
      if (ch === "\n") { await this.pressKey("Enter", {}, tab.id); continue; }
      const def = keyDef(ch) || { key: ch, code: "", keyCode: 0 };
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: def.key, code: def.code, windowsVirtualKeyCode: def.keyCode, text: ch, unmodifiedText: ch }, tab.session);
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: def.key, code: def.code, windowsVirtualKeyCode: def.keyCode }, tab.session);
      if (delay) await sleep(delay);
    }
    // Read the field back before submitting so dropped or garbled input (a lagging page) is visible.
    const back = await this.evaluate(READBACK_FN, [], tab.id).catch(() => null);
    const squash = (v: string) => v.replace(/\s+/g, " ").trim();
    const verified = back && typeof back.value === "string" ? (t.clear ? squash(back.value) === squash(text) : squash(back.value).endsWith(squash(text))) : undefined;
    if (t.submit) await this.pressKey("Enter", {}, tab.id);
    await this.settle(tab.id);
    return { typed: text.length, ...(back && typeof back.value === "string" ? { value: back.value.slice(0, 200) } : {}), ...(verified === undefined ? {} : { verified }),
      ...(verified === false ? { warning: "The field does not contain the typed text; the page may have lagged or dropped input. Read the value, wait for the page to settle and retype if needed." } : {}),
      ...await this.observe(tab.id) };
  }

  private async pressKey(key: string, modifiers: { alt?: boolean; ctrl?: boolean; meta?: boolean; shift?: boolean } = {}, tabId?: string, holdMs = 0) {
    const cdp = this.need(), tab = this.tab(tabId);
    let name = key;
    const mods = { ...modifiers };
    const MOD: Record<string, "ctrl" | "meta" | "alt" | "shift"> = { ctrl: "ctrl", control: "ctrl", cmd: "meta", command: "meta", meta: "meta", alt: "alt", option: "alt", shift: "shift" };
    while (name.length > 1 && name.includes("+")) {
      const head = MOD[name.slice(0, name.indexOf("+")).toLowerCase()];
      if (!head) break;
      mods[head] = true; name = name.slice(name.indexOf("+") + 1);
    }
    const def = keyDef(name);
    if (!def) throw new Error(`Unknown key ${key}; use names like Enter, Tab, Escape, ArrowDown, PageDown or a single character, optionally with modifiers (Shift+Tab, Ctrl+A)`);
    const plain = !mods.ctrl && !mods.meta && !mods.alt;
    const text = plain ? def.text : undefined;
    await cdp.send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", key: def.key, code: def.code, windowsVirtualKeyCode: def.keyCode, text, unmodifiedText: text,
      modifiers: modBits(mods), commands: editCommands(def, mods) }, tab.session);
    if (holdMs > 0) await sleep(Math.min(holdMs, 5000));
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: def.key, code: def.code, windowsVirtualKeyCode: def.keyCode, modifiers: modBits(mods) }, tab.session);
    return tab;
  }

  async press(key: string, modifiers: { alt?: boolean; ctrl?: boolean; meta?: boolean; shift?: boolean } = {}, tabId?: string, holdMs = 0) {
    this.actionSeq = this.netSeq;
    const tab = await this.pressKey(key, modifiers, tabId, holdMs);
    return { pressed: key, ...await this.observe(tab.id) };
  }

  async scroll(t: Target & { deltaX?: number; deltaY?: number; to?: "top" | "bottom"; tab?: string }) {
    const cdp = this.need(), tab = this.tab(t.tab);
    let p = { x: this.viewport.width / 2, y: this.viewport.height / 2 };
    if (t.ref || t.selector || t.name || t.label || typeof t.x === "number") p = await this.locate(t, tab.id);
    const probe = (to: string | null = null) => this.evaluate(SCROLL_FN, [p.x, p.y, to], tab.id);
    const before = await probe();
    let after;
    if (t.to) after = await probe(t.to);
    else {
      await this.glide(p.x, p.y, false);
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: p.x, y: p.y, deltaX: t.deltaX || 0, deltaY: t.deltaY ?? this.viewport.height * 0.8 }, tab.session);
      // Smooth scrolling animates: wait until the position stops changing.
      after = before;
      for (let i = 0; i < 8; i++) {
        await sleep(150);
        const next = await probe();
        const still = next.x === after.x && next.y === after.y;
        after = next;
        if (still && i > 0) break;
      }
    }
    const scrolled = after.x !== before.x || after.y !== before.y;
    return { scroll: after, scrolled, ...(scrolled ? {} : { note: after.atBottom || after.atTop ? "Nothing scrolled: already at the edge of this scroll area." : "Nothing scrolled: the pointer is not over a scrollable area. Target a ref/selector inside the scrolling panel, or try different coordinates." }), ...this.where(tab.id) };
  }

  /** Choose an option in a native <select> or a custom dropdown/combobox: open, optionally type to filter, pick by visible text. */
  async select(t: Target & { option: string; search?: string; tab?: string }) {
    const tab = this.tab(t.tab);
    if (!t.option) throw new Error("option is required");
    const target: Target = { ref: t.ref, selector: t.selector, name: t.name, label: t.label, role: t.role, nth: t.nth, x: t.x, y: t.y, scale: t.scale, originX: t.originX, originY: t.originY };
    this.actionSeq = this.netSeq;
    if (target.ref || target.selector || target.name || target.label) {
      const native = await this.evaluate(SELECT_FN, [{ ref: target.ref || null, selector: target.selector || null, name: target.name || null, label: target.label || null, role: target.role || null, nth: target.nth ?? 0 }, t.option], tab.id);
      if (native?.error) throw new Error(`${native.error}${native.options ? `. Options: ${native.options.join(" | ")}` : ""}`);
      if (native?.native) return { selected: native.selected, value: native.value, native: true, ...await this.observe(tab.id) };
    }
    await this.click({ ...target, tab: tab.id });
    if (t.search) await this.type({ text: t.search, tab: tab.id });
    let found: any;
    const end = Date.now() + 4000;
    while (Date.now() < end) {
      found = await this.evaluate(OPTION_FN, [t.option], tab.id).catch(() => null);
      if (found && !found.error) break;
      await sleep(250);
    }
    if (!found || found.error) throw new Error(`${found?.error ?? `No visible option "${t.option}"`}${found?.available?.length ? `. Visible items: ${found.available.join(" | ")}` : ""}. The dropdown may need a search term (search) or may not have opened.`);
    await this.click({ x: found.x, y: found.y, tab: tab.id });
    return { selected: found.name, native: false, ...await this.observe(tab.id) };
  }

  /** Poll until every given condition holds. A timeout reports which conditions failed and whether the page was still loading. */
  async waitFor(t: { selector?: string; text?: string; selectorGone?: string; textGone?: string; url?: string; request?: string; requestMethod?: string; sinceSeq?: number;
    settled?: boolean; quietMs?: number; timeoutMs?: number; tab?: string }) {
    const tab = this.tab(t.tab);
    const started = Date.now();
    const deadline = started + Math.min(Math.max(t.timeoutMs ?? 10_000, 100), 60_000);
    const pageChecks = !!(t.selector || t.text || t.selectorGone || t.textGone);
    const wantSettled = t.settled ?? !(pageChecks || t.url || t.request);
    const sinceSeq = t.sinceSeq ?? this.actionSeq;
    const method = t.requestMethod?.toUpperCase();
    for (;;) {
      const conditions: Record<string, boolean> = {};
      let pageError: string | undefined;
      if (pageChecks) {
        try {
          const r = await this.evaluate(WAIT_FN, [t.selector || null, t.text || null, t.selectorGone || null, t.textGone || null], tab.id);
          for (const k of ["selector", "text", "selectorGone", "textGone"]) if (k in r) conditions[k] = !!r[k];
        } catch (e) {
          pageError = errMsg(e); // typically a navigation in progress
          for (const k of ["selector", "text", "selectorGone", "textGone"] as const) if (t[k]) conditions[k] = false;
        }
      }
      if (t.url) conditions.url = tab.url.includes(t.url);
      let request: unknown;
      if (t.request) {
        const needle = t.request.toLowerCase();
        const e = this.network.find(n => n.seq > sinceSeq && n.url.toLowerCase().includes(needle) && (!method || n.method === method) && (n.failed || n.encodedBytes !== undefined));
        conditions.request = !!e;
        if (e) request = { seq: e.seq, method: e.method, url: e.url, status: e.status, failed: e.failed, error: e.error, durationMs: e.durationMs };
      }
      let ready: Awaited<ReturnType<BrowserSession["readiness"]>> | undefined;
      if (wantSettled) {
        ready = await this.readiness(tab.id, t.quietMs ?? 500).catch(() => undefined);
        conditions.settled = !!ready?.settled;
      }
      const found = Object.values(conditions).every(Boolean);
      if (found || Date.now() >= deadline) {
        const failed = Object.keys(conditions).filter(k => !conditions[k]);
        const loading = ready ? !ready.settled : tab.loading;
        const hint = found ? undefined : failed.includes("text") || failed.includes("selector")
          ? (loading ? "The page was still loading when the wait ended; wait longer or until settled, then read it." : "Not found. The text/element may be worded differently, hidden, or inside a cross-origin iframe. Check browser_text or browser_elements.")
          : failed.includes("request") ? "No finished request matching this URL started since the last action. Trigger the action first, or pass sinceSeq." : undefined;
        const { focused: _focused, ...page } = ready ?? {} as any;
        return { found, waitedMs: Date.now() - started, conditions, ...(request ? { request } : {}), ...(ready ? { ready: page } : {}), ...(pageError ? { pageError } : {}), ...(hint ? { hint } : {}), ...this.where(tab.id) };
      }
      await sleep(200);
    }
  }

  networkLog(opts: { limit?: number; filter?: string; tab?: string; sinceSeq?: number; failedOnly?: boolean; headers?: boolean }) {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), NETWORK_LIMIT);
    const f = (opts.filter || "").toLowerCase();
    const rows = this.network.filter(e => (!opts.tab || e.tab === opts.tab) && (!opts.sinceSeq || e.seq > opts.sinceSeq) && (!opts.failedOnly || e.failed || (e.status ?? 0) >= 400)
      && (!f || e.url.toLowerCase().includes(f) || (e.type || "").toLowerCase() === f || e.method.toLowerCase() === f));
    return rows.slice(-limit).map(e => opts.headers ? { ...e } : { seq: e.seq, requestId: e.requestId, tab: e.tab, method: e.method, url: e.url, type: e.type, status: e.status, statusText: e.statusText,
      mimeType: e.mimeType, startedAt: e.startedAt, durationMs: e.durationMs, encodedBytes: e.encodedBytes, failed: e.failed, error: e.error, fromCache: e.fromCache });
  }

  networkEntry(requestId: string) { return this.netIndex.get(requestId) || this.network.find(e => e.requestId === requestId) || null; }

  async networkBody(requestId: string, maxChars = 100_000) {
    const e = this.networkEntry(requestId);
    if (!e) throw new Error(`No request ${requestId} in the log`);
    const tab = this.tabs.get(e.tab);
    if (!tab?.session) throw new Error("The request's tab is closed");
    const r = await this.need().send("Network.getResponseBody", { requestId }, tab.session);
    const body: string = r.body || "";
    return { requestId, url: e.url, status: e.status, mimeType: e.mimeType, base64Encoded: !!r.base64Encoded, body: body.slice(0, maxChars), total: body.length, truncated: body.length > maxChars };
  }

  clearNetwork() { this.network = []; this.netIndex.clear(); this.pending.clear(); this.netSeq++; this.changed(); }

  consoleEntries(opts: { limit?: number; level?: string; sinceSeq?: number; tab?: string; clear?: boolean }) {
    const levels = opts.level === "error" ? ["error", "exception", "assert"] : opts.level === "warn" ? ["warn", "error", "exception", "assert"] : null;
    const rows = this.consoleLog.filter(e => (!opts.tab || e.tab === opts.tab) && (!opts.sinceSeq || e.seq > opts.sinceSeq) && (!levels || levels.includes(e.level)));
    const out = rows.slice(-Math.min(Math.max(opts.limit ?? 100, 1), CONSOLE_LIMIT));
    if (opts.clear) this.consoleLog = [];
    return { entries: out, seq: this.consoleSeq };
  }
}

export { processKey };
