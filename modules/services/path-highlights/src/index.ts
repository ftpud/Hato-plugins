import type { AppModule, SettingsSection } from "@hato/sdk/types";
import { exportSettings } from "@hato/sdk/settings";
import { defaultSettings, readSettings, presentation, relativePattern, hexColor, opacityValue, MAX_RULES, type HighlightSettings } from "./model";
const KEY = "path-highlights.shared.v1";
let settings = defaultSettings();
export default {
  id: "path-highlights", moduleApiVersion: 1,
  async activate(ctx) {
    settings = readSettings(await ctx.modules.call("persistence", "settings.get", { key: KEY }));
    const publish = () => ctx.state.set("path-highlights.filePresentation", presentation(settings));
    const save = async (next: HighlightSettings) => {
      await ctx.modules.call("persistence", "settings.set", { key: KEY, value: next });
      settings = next; publish();
    };
    publish();
    let publishSettings: () => void = () => {};
    const openSection = (section: string) => {
      publishSettings(); ctx.events.emit("settings.open", { category: JSON.stringify(["path-highlights", section]) });
    };
    publishSettings = exportSettings(ctx, (): SettingsSection[] => [{ key: "shared", title: "Path highlights", group: "Appearance",
      description: "Shared across all projects, tasks and workspaces. Add a rule to choose its relative path and color. Folder rules include their contents; **/src/test also matches nested modules. User rules override language colors; later rules win when they overlap.", fields: [
        { key: "enabled", label: "Enable path coloring", type: "toggle", value: settings.enabled },
        { key: "opacity", label: "Background opacity (%)", type: "text", value: String(settings.opacity), description: "0–100. Low values keep file names easy to read. Press Enter to save." },
        { key: "add", label: "Add rule", buttonLabel: "Add highlight rule", type: "action", disabled: settings.rules.length >= MAX_RULES },
      ] }, ...settings.rules.map((rule): SettingsSection => ({ key: `rule:${rule.id}`, title: `Path highlight: ${rule.path}`, group: "Appearance",
      description: "This rule is shared across all workspaces and tasks. Edit the path or color and press Enter to save.", fields: [
        { key: "enabled", label: "Enable this rule", type: "toggle", value: rule.enabled },
        { key: "path", label: "Relative path", type: "text", value: rule.path, placeholder: "src/test or **/generated" },
        { key: "color", label: "Color (#RRGGBB)", type: "text", value: rule.color, placeholder: "#22c55e" },
        { key: "remove", label: "Remove rule", buttonLabel: "Remove highlight rule", type: "action" },
      ] }))], async (section, key, value) => {
      if (section === "shared") {
        if (key === "enabled" && typeof value === "boolean") return save({ ...settings, enabled: value });
        if (key === "opacity") return save({ ...settings, opacity: opacityValue(String(value)) });
      }
      const rule = settings.rules.find(rule => section === `rule:${rule.id}`);
      if (!rule) throw Error("Highlight rule is no longer available");
      const next = { ...rule };
      if (key === "path") next.path = relativePattern(String(value));
      else if (key === "color") next.color = hexColor(String(value));
      else if (key === "enabled" && typeof value === "boolean") next.enabled = value;
      else throw Error("Invalid highlight setting");
      await save({ ...settings, rules: settings.rules.map(rule => rule.id === next.id ? next : rule) });
    }, { action: async (section, key) => {
      if (section === "shared" && key === "add") {
        if (settings.rules.length >= MAX_RULES) throw Error("Remove an existing rule before adding another");
        const rule = { id: crypto.randomUUID(), path: "src/test", color: "#22c55e", enabled: true };
        await save({ ...settings, rules: [...settings.rules, rule] }); openSection(`rule:${rule.id}`);
      } else if (key === "remove") {
        await save({ ...settings, rules: settings.rules.filter(rule => section !== `rule:${rule.id}`) }); openSection("shared");
      } else throw Error("Unknown highlight action");
    } });
  },
} satisfies AppModule;
