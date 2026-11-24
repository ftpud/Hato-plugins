// Agent-facing MCP commands (published as browser__<name> by internal-mcp). Only sessions with
// "agent access" are reachable; each command is also individually allowed in Settings.
import type { ModuleMcpTool, McpScope } from "@hato/sdk/mcp";
import type { BrowserSession } from "./session";

const obj = (properties: Record<string, any>, required: string[] = []) => ({ type: "object", properties, required });
const session = { type: "string", description: "Session id or name (see browser_sessions). Optional when exactly one session allows agents." };
const tab = { type: "string", description: "Tab id; defaults to the active tab." };
const target = {
  ref: { type: "integer", description: "Element ref from browser_elements (preferred)." },
  selector: { type: "string", description: "CSS selector." },
  x: { type: "number", description: "Viewport x in CSS px." },
  y: { type: "number", description: "Viewport y in CSS px." },
};
const modifiers = { type: "object", properties: { shift: { type: "boolean" }, ctrl: { type: "boolean" }, alt: { type: "boolean" }, meta: { type: "boolean" } } };

export interface ToolHost {
  pick(nameOrId: string | undefined): BrowserSession;
  agentSessions(): BrowserSession[];
}

export function browserTools(host: ToolHost): ModuleMcpTool[] {
  const run = (fn: (s: BrowserSession, a: any) => Promise<any> | any, label: (a: any) => string) =>
    async (a: any, scope: McpScope) => {
      const s = host.pick(a.session);
      await s.start();
      s.noteAgent(label(a), scope.conversationId);
      return fn(s, a);
    };
  return [
    { name: "browser_sessions", title: "List browser sessions", description: "List the browser sessions agents may use, with their tabs and current page.",
      inputSchema: obj({}), annotations: { readOnlyHint: true },
      handler: () => ({ sessions: host.agentSessions().map(s => { const v = s.view(); return { id: v.id, name: v.name, status: v.status, location: v.locationLabel, url: v.url, title: v.title, viewport: v.viewport,
        tabs: v.tabs.map(t => ({ id: t.id, title: t.title, url: t.url, active: t.active })) }; }) }) },
    { name: "browser_navigate", title: "Open a URL", description: "Navigate the active tab (or a new tab) to a URL and wait for it to load. Starts the session if needed.",
      inputSchema: obj({ session, url: { type: "string" }, newTab: { type: "boolean" }, tab }, ["url"]), timeoutMs: 90_000,
      handler: run(async (s, a) => a.newTab ? (await s.newTab(a.url), await new Promise(r => setTimeout(r, 800)), s.where()) : s.navigate(a.url, a.tab), a => `Open ${a.url}`) },
    { name: "browser_history", title: "Back, forward, reload", description: "Go back, forward, reload or stop loading in a tab.",
      inputSchema: obj({ session, action: { type: "string", enum: ["back", "forward", "reload", "stop"] }, tab }, ["action"]), timeoutMs: 60_000,
      handler: run((s, a) => s.history(a.action, a.tab), a => a.action) },
    { name: "browser_tabs", title: "Manage tabs", description: "List, open (url), close or activate tabs. The active tab is the one shown in the preview and used by default.",
      inputSchema: obj({ session, action: { type: "string", enum: ["list", "new", "close", "activate"] }, tab, url: { type: "string" } }, ["action"]), timeoutMs: 60_000,
      handler: run(async (s, a) => {
        if (a.action === "new") await s.newTab(a.url || "about:blank");
        else if (a.action === "close") await s.closeTab(a.tab || s.activeTab);
        else if (a.action === "activate") await s.activate(a.tab);
        return { tabs: s.view().tabs };
      }, a => `Tabs: ${a.action}`) },
    { name: "browser_text", title: "Read visible text", description: "Visible text of the page (scope page) or only what is on screen (scope viewport), optionally inside a CSS selector.",
      inputSchema: obj({ session, scope: { type: "string", enum: ["page", "viewport"] }, selector: { type: "string" }, maxChars: { type: "integer" }, tab }), annotations: { readOnlyHint: true },
      handler: run((s, a) => s.text(a.scope === "viewport" ? "viewport" : "page", a.selector, a.maxChars ?? 20_000, a.tab), () => "Read text") },
    { name: "browser_elements", title: "List interactive elements", description: "Interactive elements (links, buttons, inputs…) with stable refs, labels and viewport centers. Use refs with click/type/hover/scroll. Set all to include off-screen elements.",
      inputSchema: obj({ session, all: { type: "boolean" }, max: { type: "integer" }, tab }), annotations: { readOnlyHint: true },
      handler: run((s, a) => s.elements(!!a.all, a.max ?? 200, a.tab), () => "List elements") },
    { name: "browser_screenshot", title: "Screenshot", description: "Screenshot of the viewport (or full page). quality low (default): compact JPEG ≤960px wide for orientation; full: lossless PNG at CSS resolution. Coordinates in other commands are CSS px: divide picture px by the returned scale.",
      inputSchema: obj({ session, quality: { type: "string", enum: ["low", "full"] }, fullPage: { type: "boolean" }, tab }), annotations: { readOnlyHint: true }, timeoutMs: 90_000,
      handler: run(async (s, a) => {
        const shot = await s.screenshot({ quality: a.quality === "full" ? "full" : "low", fullPage: !!a.fullPage, tab: a.tab });
        const { data, mimeType, ...meta } = shot;
        return { mcpContent: [{ type: "image", data, mimeType }, { type: "text", text: JSON.stringify(meta) }], ...meta };
      }, a => `Screenshot${a.quality === "full" ? " (full)" : ""}`) },
    { name: "browser_click", title: "Click", description: "Move the visible pointer to an element (ref or selector) or coordinates and click it. Waits briefly for resulting navigation.",
      inputSchema: obj({ session, ...target, button: { type: "string", enum: ["left", "right", "middle"] }, clickCount: { type: "integer" }, modifiers, tab }), timeoutMs: 60_000,
      handler: run((s, a) => s.click(a), a => `Click ${a.ref ? `#${a.ref}` : a.selector || `${a.x},${a.y}`}`) },
    { name: "browser_hover", title: "Hover", description: "Move the visible pointer over an element or coordinates (opens hover menus).",
      inputSchema: obj({ session, ...target, tab }), timeoutMs: 30_000,
      handler: run((s, a) => s.hover(a), () => "Hover") },
    { name: "browser_type", title: "Type text", description: "Type text, first clicking the target field if given. clear replaces existing content; submit presses Enter afterwards.",
      inputSchema: obj({ session, text: { type: "string" }, ...target, clear: { type: "boolean" }, submit: { type: "boolean" }, tab }, ["text"]), timeoutMs: 120_000,
      handler: run((s, a) => s.type(a), a => `Type ${JSON.stringify(String(a.text).slice(0, 40))}`) },
    { name: "browser_key", title: "Press a key", description: "Press a key such as Enter, Tab, Escape, Backspace, ArrowDown, PageDown or a character, with optional modifiers (meta/ctrl + a selects all).",
      inputSchema: obj({ session, key: { type: "string" }, modifiers, tab }, ["key"]),
      handler: run((s, a) => s.press(a.key, a.modifiers || {}, a.tab), a => `Key ${a.key}`) },
    { name: "browser_scroll", title: "Scroll", description: "Scroll with the mouse wheel at an element/coordinates (default viewport center). deltaY defaults to most of a screen; negative scrolls up.",
      inputSchema: obj({ session, deltaX: { type: "number" }, deltaY: { type: "number" }, ...target, tab }),
      handler: run((s, a) => s.scroll(a), a => `Scroll ${a.deltaY ?? "down"}`) },
    { name: "browser_wait", title: "Wait for content", description: "Wait until a CSS selector exists or text appears (up to timeoutMs, max 60000).",
      inputSchema: obj({ session, selector: { type: "string" }, text: { type: "string" }, timeoutMs: { type: "integer" }, tab }), annotations: { readOnlyHint: true }, timeoutMs: 70_000,
      handler: run((s, a) => s.waitFor(a), () => "Wait") },
    { name: "browser_network", title: "Network log", description: "Recent requests (newest last): method, URL, status, type, timing and size. Filter by URL substring, resource type (xhr, fetch, document…) or method; failedOnly shows errors and HTTP ≥400; sinceSeq returns only newer entries; headers includes request/response headers.",
      inputSchema: obj({ session, filter: { type: "string" }, limit: { type: "integer" }, failedOnly: { type: "boolean" }, sinceSeq: { type: "integer" }, headers: { type: "boolean" }, tab }), annotations: { readOnlyHint: true },
      handler: run((s, a) => ({ requests: s.networkLog(a) }), () => "Network log") },
    { name: "browser_network_body", title: "Response body", description: "Response body of a request from browser_network (text, or base64 for binary).",
      inputSchema: obj({ session, requestId: { type: "string" }, maxChars: { type: "integer" } }, ["requestId"]), annotations: { readOnlyHint: true },
      handler: run((s, a) => s.networkBody(a.requestId, a.maxChars ?? 100_000), () => "Response body") },
  ];
}
