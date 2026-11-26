import { activitySidebar } from "@hato/sdk/activity-sidebar";
import type { ModuleContext, SettingsExport, UiNode } from "@hato/sdk/types";

const rail = activitySidebar("sidebar", "right");
const providers = ["claude", "codex", "opencode"];

// Keep the shared rail renderer's layout, actions, and warning colors. Only
// complement the displayed values for meters configured to show remaining.
function showRemaining(node: UiNode, remaining: ReadonlySet<string>, active = false): UiNode {
  const isUsage = "action" in node && node.action === "usage"
    && "value" in node && typeof node.value === "string" && remaining.has(node.value);
  const convert = active || isUsage;
  if (convert && (node.type === "meter" || node.type === "ring")) {
    return { ...node, value: 100 - node.value };
  }
  if ("children" in node && Array.isArray(node.children)) {
    const bar = convert ? node.children.find(child => child.type === "meter") : undefined;
    const children = node.children.map((child: UiNode) =>
      bar?.type === "meter" && child.type === "label" && child.key === "v"
        ? { ...child, text: `${Math.round(100 - bar.value)}%` }
        : showRemaining(child, remaining, convert));
    if (isUsage && "tooltip" in node && typeof node.tooltip === "string") {
      return { ...node, children, tooltip: node.tooltip.replace(" plan usage", " plan usage (remaining shown)") } as UiNode;
    }
    return { ...node, children } as UiNode;
  }
  return node;
}

export default {
  ...rail,
  async activate(ctx: ModuleContext) {
    for (const provider of providers) {
      ctx.state.watch(`${provider}-usage.settings`, () => ctx.ui.invalidate());
    }
    await rail.activate?.(ctx);
  },
  render(ctx: ModuleContext): UiNode {
    // The shared rail renders synchronously, and also without a context in tests/early frames.
    const tree = rail.render!(ctx) as UiNode;
    if (!ctx?.state) return tree;
    const remaining = new Set(providers.filter(provider => {
      const id = `${provider}-usage`;
      const settings = ctx.state.get(`${id}.settings`) as SettingsExport | undefined;
      const field = settings?.sections.find(section => section.key === id)
        ?.fields.find(field => field.key === "show");
      return field?.type === "select" && field.value === "left";
    }));
    return remaining.size ? showRemaining(tree, remaining) : tree;
  },
};
