// Agent-facing MCP commands (published as browser__<name> by internal-mcp). Only sessions with
// "agent access" are reachable; each command is also individually allowed in Settings.
import type { ModuleMcpTool, McpScope } from "@hato/sdk/mcp";
import type { BrowserSession } from "./session";

const obj = (properties: Record<string, any>, required: string[] = []) => ({ type: "object", properties, required });
const session = { type: "string", description: "Session id or name (see browser_sessions). Optional when exactly one session allows agents." };
const tab = { type: "string", description: "Tab id; defaults to the active tab." };
const target = {
  ref: { type: "integer", description: "Element ref from browser_elements (preferred)." },
  selector: { type: "string", description: "CSS selector (pierces open shadow roots and same-origin iframes)." },
  name: { type: "string", description: 'Visible text or accessible name of a button, link, option or field, e.g. "Save changes". Case-insensitive; exact matches win over partial ones.' },
  label: { type: "string", description: "Label of a form field (for type/select). Finds the input by its <label>, aria-label, placeholder or the text next to it." },
  role: { type: "string", description: "Narrow name/label matches by role, e.g. button, link, textbox, checkbox, combobox." },
  nth: { type: "integer", description: "Which match to use (0-based) when name/label/selector match several elements." },
  x: { type: "number", description: "Viewport x in CSS px (or picture px when scale is given)." },
  y: { type: "number", description: "Viewport y in CSS px (or picture px when scale is given)." },
  scale: { type: "number", description: "Pass a screenshot's scale to give x/y in that picture's pixels; they are converted to CSS px." },
  originX: { type: "number", description: "Screenshot origin.x for cropped screenshots (with scale)." },
  originY: { type: "number", description: "Screenshot origin.y for cropped screenshots (with scale)." },
};
const dryRun = { type: "boolean", description: "Resolve and describe the target (what it is, whether it is covered) without acting." };
const ORDER = " Commands for one session run strictly one at a time in the order they were received, even when sent together; a dependent sequence (navigate, wait, click, type) is safest as one browser_batch.";
const IMAGE_LIMIT = 50;
const modifiers = { type: "object", properties: { shift: { type: "boolean" }, ctrl: { type: "boolean" }, alt: { type: "boolean" }, meta: { type: "boolean" } } };

type BrowserScope = McpScope & { allowedBrowserCommands?: string[]; browserDeadline?: number };

export interface ToolHost {
  pick(nameOrId: string | undefined): BrowserSession;
  agentSessions(): BrowserSession[];
}

export function browserTools(host: ToolHost): ModuleMcpTool[] {
  const run = (fn: (s: BrowserSession, a: any, scope: BrowserScope) => Promise<any> | any, label: (a: any) => string) =>
    async (s: BrowserSession, a: any, scope: BrowserScope) => {
      await s.start();
      checkDeadline(scope);
      if (host.pick(s.spec.id) !== s) throw new Error("Browser session changed");
      s.noteAgent(label(a), scope.conversationId);
      return fn(s, a, scope);
    };
  type SessionCommand = Omit<ModuleMcpTool, "handler"> & {
    handler(s: BrowserSession, args: any, scope: BrowserScope): Promise<any>;
  };
  // Clients typically cap how many images one conversation can view; count what we hand out.
  const imagesTaken = new Map<string, number>();
  const imageKey = (scope: BrowserScope) => scope.conversationId || "default";
  function imageBudget(scope: BrowserScope) {
    const taken = imagesTaken.get(imageKey(scope)) ?? 0;
    const remaining = Math.max(0, IMAGE_LIMIT - taken);
    return { taken, assumedLimit: IMAGE_LIMIT, remaining, ...(remaining <= 10
      ? { warning: remaining === 0 ? "Image limit reached: further screenshots are probably not viewable. Use browser_text, browser_elements (fields) and browser_inspect instead."
        : `Only ${remaining} screenshots left before the usual ${IMAGE_LIMIT}-image viewing limit. Prefer browser_text, browser_elements (fields), browser_inspect, or cropped/tiny screenshots.` } : {}) };
  }
  const queues = new WeakMap<BrowserSession, Promise<unknown>>();
  function checkDeadline(scope: BrowserScope) {
    if (scope.browserDeadline && Date.now() >= scope.browserDeadline) throw new Error("Browser command timed out");
  }
  function enqueue(args: any, scope: BrowserScope, task: (s: BrowserSession) => Promise<any>) {
    const s = host.pick(args.session);
    const result = (queues.get(s) ?? Promise.resolve()).catch(() => {}).then(() => {
      checkDeadline(scope);
      if (host.pick(s.spec.id) !== s) throw new Error("Browser session changed");
      return task(s);
    });
    queues.set(s, result);
    const release = () => { if (queues.get(s) === result) queues.delete(s); };
    void result.then(release, release);
    return result;
  }
  const list: ModuleMcpTool =
    { name: "browser_sessions", title: "List browser sessions", description: "List the browser sessions agents may use, with their tabs and current page, plus how many screenshots you have left before the usual image-viewing limit.",
      inputSchema: obj({}), annotations: { readOnlyHint: true },
      handler: (_a: any, scope: BrowserScope) => ({ imageBudget: imageBudget(scope), sessions: host.agentSessions().map(s => { const v = s.view(); return { id: v.id, name: v.name, status: v.status, location: v.locationLabel, url: v.url, title: v.title, viewport: v.viewport,
        tabs: v.tabs.map(t => ({ id: t.id, title: t.title, url: t.url, active: t.active })) }; }) }) };
  const commands: SessionCommand[] = [
    { name: "browser_navigate", title: "Open a URL", description: "Navigate the active tab (or a new tab) to a URL and wait for it to load. Starts the session if needed. Returns the final URL/title and page readiness." + ORDER,
      inputSchema: obj({ session, url: { type: "string" }, newTab: { type: "boolean" }, tab }, ["url"]), timeoutMs: 90_000,
      handler: run(async (s, a) => a.newTab ? (await s.newTab(a.url), await new Promise(r => setTimeout(r, 800)), s.where()) : s.navigate(a.url, a.tab), a => `Open ${a.url}`) },
    { name: "browser_history", title: "Back, forward, reload", description: "Go back, forward, reload or stop loading in a tab (reload works per tab).",
      inputSchema: obj({ session, action: { type: "string", enum: ["back", "forward", "reload", "stop"] }, tab }, ["action"]), timeoutMs: 60_000,
      handler: run((s, a) => s.history(a.action, a.tab), a => a.action) },
    { name: "browser_tabs", title: "Manage tabs", description: "List, open (url), close or activate tabs. The active tab is the one shown in the preview and used by default; the result names it.",
      inputSchema: obj({ session, action: { type: "string", enum: ["list", "new", "close", "activate"] }, tab, url: { type: "string" } }, ["action"]), timeoutMs: 60_000,
      handler: run(async (s, a) => {
        if (a.action === "new") await s.newTab(a.url || "about:blank");
        else if (a.action === "close") await s.closeTab(a.tab || s.activeTab);
        else if (a.action === "activate") await s.activate(a.tab);
        return { activeTab: s.activeTab, tabs: s.view().tabs };
      }, a => `Tabs: ${a.action}`) },
    { name: "browser_text", title: "Read visible text", description: "Visible text of the page (scope page, including same-origin iframes) or only what is on screen (scope viewport), optionally inside a CSS selector. The result says whether the page is settled (contentLoaded, ready) and warns when the text may be partial because the page is still loading. Does not include input values: use browser_elements with fields for form state.",
      inputSchema: obj({ session, scope: { type: "string", enum: ["page", "viewport"] }, selector: { type: "string", description: "Read only the text inside this element." }, maxChars: { type: "integer" }, tab }), annotations: { readOnlyHint: true },
      handler: run((s, a) => s.text(a.scope === "viewport" ? "viewport" : "page", a.selector, a.maxChars ?? 20_000, a.tab), () => "Read text") },
    { name: "browser_elements", title: "List interactive elements", description: "Interactive elements (links, buttons, inputs…) with stable refs, names, state (value, checked, selected, expanded, disabled, focused) and viewport centers, including inside open shadow roots and same-origin iframes. Use refs with click/type/hover/scroll. Set fields to list only form controls (label, current value, checked, selected option and options of a <select>, disabled, required) as text, so form state needs no screenshot. all includes off-screen elements; selector limits to one container.",
      inputSchema: obj({ session, all: { type: "boolean" }, fields: { type: "boolean", description: "Only form controls, with their current values." }, selector: { type: "string", description: "Limit to this container." }, max: { type: "integer" }, tab }), annotations: { readOnlyHint: true },
      handler: run((s, a) => s.elements(!!a.all, a.max ?? 200, a.tab, { fields: !!a.fields, selector: a.selector }), () => "List elements") },
    { name: "browser_inspect", title: "What is here?", description: "Describe what is at a point or behind a ref/selector/name without acting: element, name, state, and whether another element covers it (so a click would land elsewhere). Use before clicking risky targets.",
      inputSchema: obj({ session, ...target, tab }), annotations: { readOnlyHint: true },
      handler: run((s, a) => s.inspect(a), () => "Inspect") },
    { name: "browser_screenshot", title: "Screenshot", description: "Screenshot of the viewport, full page, or a crop. quality low (default): JPEG ≤960px wide; tiny: JPEG ≤480px wide (cheapest); full: lossless PNG. Crop with ref/selector/name/label or region {x,y,width,height} in viewport CSS px. The result lists your image budget (clients typically allow ~50 viewable images per conversation) and warns as it runs low; set budgetOnly to read it without capturing. Clicks accept the picture's pixels directly: pass x/y with scale (and originX/originY for crops), or compute CSS px = origin + picture px / scale. Prefer browser_text / browser_elements when you only need text or state.",
      inputSchema: obj({ session, quality: { type: "string", enum: ["tiny", "low", "full"] }, fullPage: { type: "boolean" }, maxWidth: { type: "integer", description: "Downscale to at most this many pixels wide." },
        region: obj({ x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" } }, ["x", "y", "width", "height"]),
        ref: target.ref, selector: target.selector, name: target.name, label: target.label, budgetOnly: { type: "boolean" }, tab }), annotations: { readOnlyHint: true }, timeoutMs: 90_000,
      handler: run(async (s, a, scope) => {
        if (a.budgetOnly) return { imageBudget: imageBudget(scope) };
        const shot = await s.screenshot({ quality: a.quality, fullPage: !!a.fullPage, tab: a.tab, maxWidth: a.maxWidth, region: a.region, ref: a.ref, selector: a.selector, name: a.name, label: a.label });
        imagesTaken.set(imageKey(scope), (imagesTaken.get(imageKey(scope)) ?? 0) + 1);
        const { data, mimeType, ...meta } = shot;
        const result = { ...meta, imageBudget: imageBudget(scope) };
        return { mcpContent: [{ type: "image", data, mimeType }, { type: "text", text: JSON.stringify(result) }], ...result };
      }, a => `Screenshot${a.quality === "full" ? " (full)" : ""}`) },
    { name: "browser_click", title: "Click", description: "Move the visible pointer to an element (ref, selector, visible name, or coordinates) and click it. Waits for resulting navigation and requests, then returns the clicked element, URL/title, whether they changed, the focused element and page readiness. Warns if the target is covered by another element or the name matched several. dryRun checks the target without clicking." + ORDER,
      inputSchema: obj({ session, ...target, button: { type: "string", enum: ["left", "right", "middle"] }, clickCount: { type: "integer" }, modifiers, dryRun, tab }), timeoutMs: 60_000,
      handler: run((s, a) => s.click(a), a => `Click ${a.ref ? `#${a.ref}` : a.name || a.label || a.selector || `${a.x},${a.y}`}`) },
    { name: "browser_hover", title: "Hover", description: "Move the visible pointer over an element or coordinates (opens hover menus) and describe what is under it.",
      inputSchema: obj({ session, ...target, tab }), timeoutMs: 30_000,
      handler: run((s, a) => s.hover(a), () => "Hover") },
    { name: "browser_type", title: "Type text", description: "Type text, first clicking the target field if given (ref, selector, label such as \"DB instance identifier\", or coordinates). clear replaces existing content; submit presses Enter afterwards. The field is read back after typing: verified=false means input was dropped or garbled (usually a lagging page), so wait for the page to settle and retype. dryRun checks the target without typing." + ORDER,
      inputSchema: obj({ session, text: { type: "string" }, ...target, clear: { type: "boolean" }, submit: { type: "boolean" }, dryRun, tab }, ["text"]), timeoutMs: 120_000,
      handler: run((s, a) => s.type(a), a => `Type ${JSON.stringify(String(a.text).slice(0, 40))}`) },
    { name: "browser_select", title: "Choose a dropdown option", description: "Choose an option by its visible text in a native <select> or a custom dropdown/combobox: opens it, optionally types search to filter, and clicks the matching option. Identify the control with ref, selector, name, label or coordinates. Fails with the visible items listed when the option is not found." + ORDER,
      inputSchema: obj({ session, option: { type: "string", description: "Visible text of the option to choose." }, search: { type: "string", description: "Text to type into a searchable combobox before choosing." }, ...target, tab }, ["option"]), timeoutMs: 60_000,
      handler: run((s, a) => s.select(a), a => `Select ${JSON.stringify(String(a.option).slice(0, 40))}`) },
    { name: "browser_key", title: "Press a key", description: "Press a key such as Enter, Tab, Escape, Backspace, ArrowDown, PageDown or a character. Modifiers go in modifiers or in the key itself (Shift+Tab, Ctrl+A, Meta+A). holdMs keeps the key down.",
      inputSchema: obj({ session, key: { type: "string" }, modifiers, holdMs: { type: "integer", description: "Hold the key down this long (max 5000)." }, tab }, ["key"]),
      handler: run((s, a) => s.press(a.key, a.modifiers || {}, a.tab, a.holdMs ?? 0), a => `Key ${a.key}`) },
    { name: "browser_scroll", title: "Scroll", description: "Scroll the scroll area under an element/coordinates (default viewport center) with the mouse wheel; deltaY defaults to most of a screen, negative scrolls up. to jumps to top or bottom. Returns the scroll position of the area that actually scrolled (the page or an inner panel), whether anything moved (scrolled), and a note when nothing did.",
      inputSchema: obj({ session, deltaX: { type: "number" }, deltaY: { type: "number" }, to: { type: "string", enum: ["top", "bottom"] }, ...target, tab }),
      handler: run((s, a) => s.scroll(a), a => `Scroll ${a.to ?? a.deltaY ?? "down"}`) },
    { name: "browser_wait", title: "Wait for content", description: "Wait until ALL given conditions hold: selector visible, text present (case-insensitive; searches page text, input values and same-origin iframes), selectorGone / textGone (spinner or message disappeared), url contains, request finished (a request whose URL contains this, started since the last action, with its status), or settled (document complete, no pending XHR/fetch, no loading indicators, DOM quiet for quietMs). With no conditions it waits until the page settles. On timeout it returns found:false as a tool error listing which conditions were met, whether the page was still loading, and a hint. Use after slow actions instead of sleeping." + ORDER,
      inputSchema: obj({ session, selector: { type: "string" }, text: { type: "string" }, selectorGone: { type: "string" }, textGone: { type: "string" }, url: { type: "string" },
        request: { type: "string", description: "URL substring of a request to wait for (e.g. the save call); its status is returned." }, requestMethod: { type: "string" }, sinceSeq: { type: "integer", description: "Only match requests newer than this network seq (default: since the last action)." },
        settled: { type: "boolean", description: "Also require the page to be settled (default only when no other condition is given)." }, quietMs: { type: "integer", description: "Required DOM quiet time for settled (default 500)." }, timeoutMs: { type: "integer", description: "Default 10000, max 60000." }, tab }), annotations: { readOnlyHint: true }, timeoutMs: 70_000,
      handler: run(async (s, a) => {
        const result = await s.waitFor(a);
        return result.found ? result : { ...result, ok: false, error: `Browser wait timed out after ${result.waitedMs}ms${result.hint ? `: ${result.hint}` : ""}` };
      }, () => "Wait") },
    { name: "browser_console", title: "Console and error log", description: "Recent console messages, uncaught exceptions and browser log entries (level, text, source). level error shows only errors/exceptions; warn adds warnings. sinceSeq returns only newer entries; clear empties the log afterwards. Pair with browser_network failedOnly to see failed requests.",
      inputSchema: obj({ session, level: { type: "string", enum: ["all", "warn", "error"] }, limit: { type: "integer" }, sinceSeq: { type: "integer" }, clear: { type: "boolean" }, tab }), annotations: { readOnlyHint: true },
      handler: run((s, a) => s.consoleEntries(a), () => "Console log") },
    { name: "browser_network", title: "Network log", description: "Recent requests (newest last): method, URL, status, type, timing and size. Filter by URL substring, resource type (xhr, fetch, document…) or method; failedOnly shows errors and HTTP ≥400; sinceSeq returns only newer entries; headers includes request/response headers. Use it to confirm a save call returned 2xx.",
      inputSchema: obj({ session, filter: { type: "string" }, limit: { type: "integer" }, failedOnly: { type: "boolean" }, sinceSeq: { type: "integer" }, headers: { type: "boolean" }, tab }), annotations: { readOnlyHint: true },
      handler: run((s, a) => ({ seq: s.netSeq, requests: s.networkLog(a) }), () => "Network log") },
    { name: "browser_network_body", title: "Response body", description: "Response body of a request from browser_network (text, or base64 for binary).",
      inputSchema: obj({ session, requestId: { type: "string" }, maxChars: { type: "integer" } }, ["requestId"]), annotations: { readOnlyHint: true },
      handler: run((s, a) => s.networkBody(a.requestId, a.maxChars ?? 100_000), () => "Response body") },
  ];
  const byName = new Map(commands.map(command => [command.name, command]));
  const batch: ModuleMcpTool = {
    name: "browser_batch",
    title: "Run browser commands in order",
    description: "Run up to 10 existing browser commands on one session strictly in order, without interleaving other agent commands: the reliable way to send dependent steps (navigate, wait, click, type). Put a browser_wait between a slow action and the step that needs its result. Each step has a command name (e.g. browser_click) and its usual arguments, with session set only at the batch level. Stops on the first failure and returns completed results and any screenshots.",
    timeoutMs: 180_000,
    inputSchema: obj({ session, steps: {
      type: "array", minItems: 1, maxItems: 10,
      items: obj({ command: { type: "string", enum: [...byName.keys()] }, arguments: { type: "object" } }, ["command"]),
    } }, ["steps"]),
    handler(args, scope: BrowserScope) {
      if (!Array.isArray(args.steps) || args.steps.length < 1 || args.steps.length > 10) {
        throw new Error("Provide between 1 and 10 browser steps");
      }
      const steps = args.steps.map((step: any, index: number) => {
        const command = byName.get(step?.command);
        const input = step?.arguments ?? {};
        if (!command || !scope.allowedBrowserCommands?.includes(command.name)) {
          throw new Error(`Step ${index + 1}: browser command is denied or unavailable`);
        }
        if (typeof input !== "object" || Array.isArray(input) || "session" in input) {
          throw new Error(`Step ${index + 1}: arguments must be an object without session`);
        }
        for (const key of command.inputSchema.required ?? []) {
          if (input[key] === undefined) throw new Error(`Step ${index + 1}: missing ${key}`);
        }
        return { command, input };
      });
      return enqueue(args, scope, async s => {
        const results: { command: string; result: unknown }[] = [];
        const images: unknown[] = [];
        let failure: { step: number; command: string; error: string } | undefined;
        for (const { command, input } of steps) {
          try {
            checkDeadline(scope);
            if (host.pick(s.spec.id) !== s) throw new Error("Browser session changed");
            const { mcpContent = [], ...result } = await command.handler(s, input, scope);
            if (command.name === "browser_wait" && result.found === false) throw new Error(result.error);
            results.push({ command: command.name, result });
            const screenshots = mcpContent.filter((item: any) => item.type === "image");
            if (screenshots.length) images.push({ type: "text", text: `Screenshot from step ${results.length}` }, ...screenshots);
          } catch (error) {
            failure = { step: results.length + 1, command: command.name, error: error instanceof Error ? error.message : String(error) };
            break;
          }
        }
        const summary = { ok: !failure, results, ...(failure ? { failure } : {}) };
        return images.length ? { ...summary, mcpContent: [{ type: "text", text: JSON.stringify(summary) }, ...images] } : summary;
      });
    },
  };
  return [list, ...commands.map(({ handler, ...tool }) => ({
    ...tool,
    handler: (args: any, scope: BrowserScope) => enqueue(args, scope, s => handler(s, args, scope)),
  })), batch];
}
