import type { AppModule } from "@hato/sdk/types";
import { exportSettings } from "@hato/sdk/settings";
import { defaults, javaFilePresentation, type JavaFileStyle } from "./presentation";
let settings: JavaFileStyle = { ...defaults };
export default {
  id: "language-java", moduleApiVersion: 1,
  async activate(ctx) {
    const saved = await ctx.modules.call("persistence", "settings.get", { key: "language-java.filePresentation" });
    settings = { ...defaults };
    for (const key of Object.keys(defaults) as (keyof JavaFileStyle)[]) if (typeof saved?.[key] === typeof defaults[key]) (settings as any)[key] = saved[key];
    const publish = () => ctx.state.set("language-java.filePresentation", javaFilePresentation(settings));
    publish();
    exportSettings(ctx, () => [{ key: "files", title: "Java file appearance", group: "Languages", description: "Source-root paths accept * and ** wildcards; separate multiple roots with commas. Applied through the shared file-presentation interface.", fields: [
      { key: "icons", label: "Java declaration icons", type: "toggle", value: settings.icons },
      { key: "backgrounds", label: "Tint source, test and resource files", type: "toggle", value: settings.backgrounds },
      ...([ ["sources", "Source roots"], ["tests", "Test roots"], ["resources", "Resource roots"], ["testResources", "Test resource roots"] ] as const).map(([key, label]) => ({ key, label, type: "text" as const, value: settings[key] })),
    ] }], async (_section, key, value) => {
      if (!(key in defaults) || typeof value !== typeof defaults[key as keyof JavaFileStyle]) throw Error("Invalid Java appearance setting");
      const next = { ...settings, [key]: value };
      await ctx.modules.call("persistence", "settings.set", { key: "language-java.filePresentation", value: next });
      settings = next; publish();
    });
  },
} satisfies AppModule;
