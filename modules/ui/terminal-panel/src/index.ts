// Multiple resizable blocks; each block's tabs attach to independent kernel-owned PTYs.
import type { AppModule, ModuleContext, UiNode } from "@hato/sdk/types";
import { sidebarIcons } from "@hato/sdk/sidebar-icons";
import { terminalIcons } from "@hato/sdk/terminal-icons";
import { terminalTabStyle, tabButtonStyle } from "@hato/sdk/tab-style";
import { errMsg } from "@hato/sdk/runtime";
import { blocks, firstBlock, remove, replace, resize, restore, type Block, type Node } from "./model";
import { uiIcons } from "@hato/sdk/ui-icons";
let ws: any = null;
let layout: Node = firstBlock();
let epoch = 0;
let error: string | null = null;
let terminals = new Map<string, any>();
let loading = new Map<string, Promise<void>>();
let busy = new Set<string>();
let activityTimer: ReturnType<typeof setInterval> | null = null;
let activityBusy = false;
let cursors = new Map<string, number>();
let unread = new Set<string>();
async function checkActivity(ctx: ModuleContext) {
  if (!ws || activityBusy) return;
  const version = epoch, workspaceId = ws.id;
  activityBusy = true;
  try {
    const all = blocks(layout), keys = all.flatMap(block => block.keys);
    const activity = await ctx.modules.call("terminals", "activity", { workspaceId, keys });
    if (version !== epoch) return;
    const active = new Set(blocks(layout).map(block => block.active));
    let changed = false;
    for (const item of activity) {
      if (typeof item.cursor !== "number") continue;
      const previous = cursors.get(item.key);
      cursors.set(item.key, item.cursor);
      if (!active.has(item.key) && previous !== undefined && item.cursor > previous && !unread.has(item.key)) { unread.add(item.key); changed = true; }
      if (active.has(item.key) && unread.delete(item.key)) changed = true;
    }
    if (changed) ctx.ui.invalidate();
  } catch { /* A transient connection failure must not disrupt the terminal. */ }
  finally { activityBusy = false; }
}
const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
async function attach(ctx: ModuleContext, block: Block, restart = false) {
  if (!ws) return;
  const workspaceId = ws.id, version = epoch, key = block.active;
  if (loading.has(key)) return loading.get(key);
  if (!restart && terminals.has(key)) return;
  terminals.delete(key);
  const request = (async () => {
    try {
      const result = await ctx.modules.call("terminals", restart ? "restart" : "attach", { workspaceId, key }, { timeoutMs: 60000 });
      if (version === epoch && blocks(layout).some(b => b.keys.includes(key))) terminals.set(key, result);
    } catch (e) { if (version === epoch) error = errMsg(e); }
    finally { if (version === epoch) { loading.delete(key); ctx.ui.invalidate(); } }
  })();
  loading.set(key, request); ctx.ui.invalidate();
  await request;
}
async function save(ctx: ModuleContext) {
  const first = blocks(layout)[0];
  await ctx.modules.call("workspace", "view.patch", { workspaceId: ws.id, patch: { ui: {
    terminalLayout: JSON.parse(JSON.stringify(layout)), terminalTabs: { keys: [...first.keys], active: first.active },
  } } });
}
function reset(saved?: any) {
  epoch++; cursors = new Map(); unread = new Set(); terminals = new Map(); loading = new Map(); busy = new Set(); error = null;
  layout = restore(saved || ws?.view?.ui?.terminalLayout, ws?.view?.ui?.terminalTabs);
}
async function attachVisible(ctx: ModuleContext) { await Promise.all(blocks(layout).map(block => attach(ctx, block))); }
function renderNode(node: Node): UiNode {
  if (node.kind === "split") return { type: "split", key: node.id, direction: node.direction, sizes: node.sizes,
    minSize: node.direction === "horizontal" ? 160 : 100, resizeAction: "resizeBlocks", grow: true, children: node.children.map(renderNode) };
  const all = blocks(layout), locked = !ws || busy.has(node.id) || loading.has(node.active);
  const action = (name: string) => `${name}:${node.id}`;
  const control = (name: string, tooltip: string, icon: "plus" | "refresh" | "x"): UiNode => ({ type: "button", key: name, text: "", iconSvg: uiIcons[icon],
    action: action(name), small: true, variant: "ghost", tooltip, disabled: locked });
  return { type: "column", key: node.id, gap: 3, padding: 4, grow: true, children: [
    { type: "row", key: "tabs", gap: 3, wrap: true, children: [
      ...node.keys.map((key): UiNode => ({ type: "row", key, gap: 0, style: terminalTabStyle(node.active === key), children: [
        { type: "button", key: "select", iconSvg: sidebarIcons.terminal, text: `${key.startsWith("md:") ? key.slice(3, key.lastIndexOf(":" )).split("/").pop() + " · block " + (Number(key.slice(key.lastIndexOf(":" ) + 1)) + 1) : "Terminal " + (all.flatMap(b => b.keys).indexOf(key) + 1)}${unread.has(key) ? " •" : ""}`,
          action: `select:${key}`, middleClickAction: `close:${key}`, small: true, variant: "ghost", style: tabButtonStyle(node.active === key, true), disabled: locked },
        { type: "button", key: "close", text: "", iconSvg: uiIcons["x"], action: `close:${key}`, small: true, variant: "ghost",
          style: tabButtonStyle(node.active === key, true), tooltip: "Close terminal", disabled: locked },
      ] })),
      control("new", "New terminal tab", "plus"),
      ...(["splitRight", "splitDown"] as const).map((name): UiNode => ({ type: "button", key: name, text: "", iconSvg: terminalIcons[name],
        action: action(name), small: true, variant: "ghost", tooltip: name === "splitRight" ? "Split right" : "Split down", disabled: locked })),
      control("restart", "Restart active shell", "refresh"),
      ...(all.length > 1 ? [control("closeBlock", "Close block and its terminal tabs", "x")] : []),
    ] },
    { type: "terminal", key: `term:${node.active}`, pty: terminals.get(node.active)?.pty || null,
      placeholder: ws ? "Starting shell…" : "Select a workspace.", grow: true },
  ] };
}
const mod: AppModule = {
  id: "terminal-panel", moduleApiVersion: 1,
  async activate(ctx, prev) {
    ws = ctx.state.get("workspace.selected") || null;
    reset(prev && prev.workspaceId === ws?.id ? prev.layout : undefined);
    if (prev && prev.workspaceId === ws?.id) {
      cursors = new Map(prev.cursors || []);
      unread = new Set(prev.unread || []);
    }
    ctx.state.watch("workspace.selected", (value: any) => {
      const changed = ws?.id !== value?.id; ws = value;
      if (changed) { reset(); void attachVisible(ctx); ctx.ui.invalidate(); }
    });
    ctx.events.on("terminals.changed", () => ctx.ui.invalidate());
    ctx.events.on("viewer.runCode", async (args: any) => {
      if (typeof args?.requestId !== "string") return;
      try { await mod.methods!.runCode(ctx, args, { caller: "viewer" }); ctx.events.emit("terminal-panel.runCodeResult", { requestId: args.requestId }); }
      catch (e) { ctx.events.emit("terminal-panel.runCodeResult", { requestId: args.requestId, error: errMsg(e) }); }
    });
    await attachVisible(ctx);
    void checkActivity(ctx);
    activityTimer = setInterval(() => { void checkActivity(ctx); }, 1500);
    (activityTimer as any).unref?.();
  },
  async deactivate() { if (activityTimer) clearInterval(activityTimer); activityTimer = null; },
  snapshot: () => ({ workspaceId: ws?.id || null, layout, cursors: [...cursors], unread: [...unread] }),
  canSwap: async () => ({ ok: !busy.size && !loading.size, reason: "Terminal operation in progress" }),
  render(): UiNode { return { type: "column", key: "terminal-root", grow: true, children: [
    ...(error ? [{ type: "status", key: "err", text: error, level: "error" } as UiNode] : []), renderNode(layout),
  ] }; },
  methods: {
    async runCode(ctx, args) {
      if (!ws || args.workspaceId !== ws.id) throw new Error("Select the Markdown file's workspace first.");
      if (typeof args.path !== "string" || !Number.isSafeInteger(args.block) || args.block < 0 || typeof args.code !== "string" || !args.code.trim() || args.code.length > 32768 || args.code.includes("\0")) throw new Error("Invalid shell block.");
      const version = epoch, workspaceId = ws.id;
      const key = `md:${args.path}:${args.block}`;
      let block = blocks(layout).find(b => b.keys.includes(key));
      if (!block) {
        block = blocks(layout)[0];
        layout = replace(layout, block.id, { ...block, keys: [...block.keys, key], active: key });
      } else layout = replace(layout, block.id, { ...block, active: key });
      unread.delete(key);
      block = blocks(layout).find(b => b.keys.includes(key))!;
      if (busy.has(block.id)) throw new Error("Wait for this terminal operation to finish.");
      busy.add(block.id); ctx.ui.invalidate();
      try {
        await attach(ctx, block);
        if (version !== epoch) throw new Error("Workspace changed before the shell block could run.");
        await save(ctx);
        ctx.events.emit("terminal-panel.reveal", { workspaceId });
        const shell = ["bash", "zsh"].includes(args.language) ? args.language : "sh";
        let delimiter = "HATO_SCRIPT";
        while (args.code.split(/\r?\n/).includes(delimiter)) delimiter += "_";
        const command = `${shell} <<'${delimiter}'\n${args.code}${args.code.endsWith("\n") ? "" : "\n"}${delimiter}`;
        await ctx.modules.call("terminals", "runCode", { workspaceId, key, command }, { timeoutMs: 10000 });
        return { key };
      } finally { if (version === epoch) busy.delete(block.id); ctx.ui.invalidate(); }
    },
  },
  async onEvent(ctx, ev) {
    if (!ws) return;
    if (ev.action === "resizeBlocks") {
      const value: any = ev.value;
      layout = resize(layout, ev.key, Array.isArray(value?.sizes) ? value.sizes : []);
      try { await save(ctx); } catch (e) { error = errMsg(e); }
      ctx.ui.invalidate(); return;
    }
    // Markdown tab identifiers include colons; preserve the entire identifier after the verb.
    const separator = ev.action.indexOf(":");
    const name = separator < 0 ? ev.action : ev.action.slice(0, separator);
    const target = separator < 0 ? "" : ev.action.slice(separator + 1);
    if (name === "select") unread.delete(target);
    const block = name === "select" || name === "close" ? blocks(layout).find(b => b.keys.includes(target)) : blocks(layout).find(b => b.id === target) || (!target ? blocks(layout)[0] : undefined);
    if (!block || busy.has(block.id) || loading.has(block.active)) return;
    const version = epoch, workspaceId = ws.id;
    busy.add(block.id); error = null; ctx.ui.invalidate();
    try {
      if (name === "restart") { await attach(ctx, block, true); return; }
      if (name === "new") {
        const key = uid("shell"); layout = replace(layout, block.id, { ...block, keys: [...block.keys, key], active: key });
      } else if (name === "select") layout = replace(layout, block.id, { ...block, active: target });
      else if (name === "splitRight" || name === "splitDown") {
        const key = uid("shell");
        const next: Block = { kind: "block", id: uid("block"), keys: [key], active: key };
        layout = replace(layout, block.id, { kind: "split", id: uid("split"), direction: name === "splitRight" ? "horizontal" : "vertical", sizes: [0.5, 0.5], children: [block, next] });
      } else if (name === "close" || name === "closeBlock") {
        if (name === "closeBlock" && blocks(layout).length === 1) return;
        const closing = name === "closeBlock" ? block.keys : [target];
        for (const key of closing) {
          await ctx.modules.call("terminals", "close", { workspaceId, key });
          if (version !== epoch) return;
          terminals.delete(key);
        }
        const keys = block.keys.filter(key => !closing.includes(key));
        layout = keys.length ? replace(layout, block.id, { ...block, keys, active: keys.includes(block.active) ? block.active : keys[Math.min(block.keys.indexOf(target), keys.length - 1)] || keys[0] }) : remove(layout, block.id) || firstBlock();
      } else return;
      await save(ctx);
      if (version === epoch) await attachVisible(ctx);
    } catch (e) { if (version === epoch) error = errMsg(e); }
    finally { if (version === epoch) { busy.delete(block.id); ctx.ui.invalidate(); } }
  },
};
export default mod;
