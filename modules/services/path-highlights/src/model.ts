import type { FilePresentationContribution } from "@hato/sdk/file-presentation";
export interface PathHighlight { id: string; path: string; color: string; enabled: boolean }
export interface HighlightSettings { enabled: boolean; opacity: number; rules: PathHighlight[] }
export const MAX_RULES = 200;
export const defaultSettings = (): HighlightSettings => ({ enabled: true, opacity: 6, rules: [] });
export function relativePattern(value: string): string {
  const path = value.trim().replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/\/+$/, "");
  if (!path || path.length > 400 || /^\/|^[a-z]:/i.test(path) || /[\x00-\x1f]/.test(path) || path.split("/").some(p => p === ".." || p === ".")) throw Error("Use a relative path such as src/test or **/generated. Absolute paths and .. are not allowed.");
  return path.replace(/\/{2,}/g, "/");
}
export function hexColor(value: string): string {
  const color = value.trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(color)) throw Error("Enter a color as #RRGGBB, for example #22c55e.");
  return color;
}
export function opacityValue(value: string | number): number {
  const n = typeof value === "string" && !value.trim() ? NaN : Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 100) throw Error("Opacity must be a whole number from 0 to 100.");
  return n;
}
/** A folder path matches itself and descendants; * and ** are optional globs. */
export function pathPattern(value: string): string {
  let path = relativePattern(value);
  while (path.endsWith("/**")) path = path.slice(0, -3);
  const parts = path.split("/");
  return "^" + parts.map((part, i) => {
    if (part === "**") return i === parts.length - 1 ? ".*" : "(?:[^/]+/)*";
    const pattern = [...part].map(c => c === "*" ? "[^/]*" : c === "?" ? "[^/]" : c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("");
    return pattern + (i < parts.length - 1 ? "/" : "");
  }).join("") + "(?:/|$)";
}
export function readSettings(saved: any): HighlightSettings {
  const settings = defaultSettings();
  if (typeof saved?.enabled === "boolean") settings.enabled = saved.enabled;
  try { if (saved?.opacity !== undefined) settings.opacity = opacityValue(saved.opacity); } catch {}
  const seen = new Set<string>();
  for (const rule of Array.isArray(saved?.rules) ? saved.rules.slice(0, MAX_RULES) : []) {
    try {
      if (typeof rule.id !== "string" || !/^[a-z0-9-]{1,80}$/i.test(rule.id) || seen.has(rule.id)) continue;
      settings.rules.push({ id: rule.id, path: relativePattern(rule.path), color: hexColor(rule.color), enabled: rule.enabled !== false });
      seen.add(rule.id);
    } catch { /* A malformed saved rule must not hide the other rules. */ }
  }
  return settings;
}
export function presentation(settings: HighlightSettings): FilePresentationContribution {
  const alpha = Math.round(settings.opacity * 255 / 100).toString(16).padStart(2, "0");
  return { rules: settings.enabled ? settings.rules.filter(rule => rule.enabled).map(rule => ({
    id: rule.id, priority: 100, pathPattern: pathPattern(rule.path), background: rule.color + alpha,
  })) : [] };
}
