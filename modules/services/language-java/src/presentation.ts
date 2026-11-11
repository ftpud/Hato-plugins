import type { FilePresentationContribution, FilePresentationRule } from "@hato/sdk/file-presentation";
export interface JavaFileStyle { icons: boolean; backgrounds: boolean; sources: string; tests: string; resources: string; testResources: string }
export const defaults: JavaFileStyle = {
  icons: true, backgrounds: true,
  sources: "**/src/main/java", tests: "**/src/test/java",
  resources: "**/src/main/resources", testResources: "**/src/test/resources",
};
const glyphs = {
  file: "M9 7h7v7a4 4 0 0 1-8 0",
  class: "M15 8a5 5 0 1 0 0 8", interface: "M9 7h6m-3 0v10m-3 0h6",
  enum: "M15 7H9v10h6m-6-5h5", record: "M9 17V7h3a3 3 0 0 1 0 6H9m3 0 4 4",
  annotation: "M15 15v-5a3 3 0 1 0-3 5c2 0 3-2 3-3m0 1a2 2 0 0 0 4 0v-1a7 7 0 1 0-4 6",
  package: "m7 9 5-3 5 3v7l-5 3-5-3V9m0 0 5 3 5-3m-5 3v7",
  module: "M6 6h5v5H6zm7 0h5v5h-5zM6 13h5v5H6zm7 0h5v5h-5z",
};
const icon = (kind: keyof typeof glyphs, color: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" opacity="0.35"/><path d="${glyphs[kind]}"/></svg>`;
/** Source roots accept workspace-relative paths with * and ** wildcards. */
function rootPattern(root: string): string {
  const parts = root.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "").split("/");
  return "^" + parts.map(part => part === "**" ? "(?:[^/]+/)*" : part.split("*").map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*") + "/").join("").replace(/\/$/, "") + "(?:/|$)";
}
export function javaFilePresentation(settings: JavaFileStyle): FilePresentationContribution {
  const rules: FilePresentationRule[] = [];
  if (settings.backgrounds) for (const [key, background] of [
    ["sources", "#3b82f624"], ["tests", "#22c55e24"], ["resources", "#eab30824"], ["testResources", "#f9731624"],
  ] as const) for (const root of settings[key].split(/[,\r\n]+/).map(s => s.trim()).filter(Boolean)) {
    rules.push({ id: `java-${key}:${root}`, pathPattern: rootPattern(root), background });
  }
  if (settings.icons) {
    const colors = { class: "#4f8dd6", interface: "#45a26b", enum: "#b887ce", record: "#d08a38", annotation: "#b887ce", package: "#bf9642", module: "#538fc5" };
    rules.push({ id: "java-file", pathPattern: "\\.java$", kind: "file", iconSvg: icon("file", colors.class), description: "Java source" });
    for (const kind of ["class", "interface", "enum", "record", "annotation"] as const) rules.push({
      id: `java-${kind}`, pathPattern: "\\.java$", kind: "file",
      contentPattern: kind === "annotation" ? "@\\s*interface\\s+$FILE_STEM\\b" : `\\b${kind}\\s+$FILE_STEM\\b`,
      iconSvg: icon(kind, colors[kind]), description: `Java ${kind}`,
    });
    for (const kind of ["package", "module"] as const) rules.push({ id: `java-${kind}`, pathPattern: `(?:^|/)${kind}-info\\.java$`, kind: "file", iconSvg: icon(kind, colors[kind]), description: `Java ${kind} descriptor` });
  }
  return { rules };
}
