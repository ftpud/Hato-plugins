import type { LanguageServerSpec } from "@hato/sdk/languages";
export interface ProjectConfiguration { enabled: boolean; values: Record<string, string | string[] | boolean>; settings: Record<string, any> }
export function projectConfiguration(server: LanguageServerSpec, input: any): ProjectConfiguration {
  const values: ProjectConfiguration["values"] = {};
  for (const field of server.projectSettings?.fields || []) {
    const value = input?.values?.[field.key];
    if (field.type === "toggle") { if (value !== undefined && typeof value !== "boolean") throw new Error(`Invalid ${field.label}`); values[field.key] = value ?? true; }
    else if (value !== undefined) {
      const paths = field.type === "paths" ? (Array.isArray(value) ? value : String(value).split(/\r?\n/)).filter((p: any) => typeof p !== 'string' || p.trim()) : [String(value)];
      if (paths.length > 256) throw new Error(`Too many ${field.label}`);
      for (const path of paths) if (typeof path !== "string" || /[\0\r\n]/.test(path) || /^[\\/]|^[a-z]:/i.test(path) || path.replace(/\\/g,"/").split("/").includes("..")) throw new Error(`${field.label} must stay inside the workspace`);
      values[field.key] = field.type === "paths" ? paths.map((p: string) => p.trim()) : paths[0].trim();
    }
  }
  const settings = input?.settings ?? {};
  if (!settings || typeof settings !== "object" || Array.isArray(settings) || JSON.stringify(settings).length > 64000) throw new Error("Additional settings must be a JSON object under 64 KB");
  // Language support is opt-in per workspace: a project is treated as e.g. a Java project only
  // after the user (or an agent) enables that server for it.
  return { enabled: input?.enabled === true, values, settings };
}
function merge(base: any, extra: any): any {
  const result = { ...base };
  for (const [key, value] of Object.entries(extra || {})) {
    if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error("Invalid settings key");
    result[key] = value && typeof value === "object" && !Array.isArray(value) ? merge(base?.[key], value) : value;
  }
  return result;
}
export function projectServer(server: LanguageServerSpec, config: ProjectConfiguration): LanguageServerSpec {
  let settings = merge(server.settings || {}, config.settings);
  for (const field of server.projectSettings?.fields || []) {
    const value = config.values[field.key];
    if (value === undefined || value === "" || Array.isArray(value) && !value.length) continue;
    const keys = field.setting.split(".");
    let nested: any = value;
    for (const key of keys.reverse()) nested = { [key]: nested };
    settings = merge(settings, nested);
  }
  return { ...server, settings, initializationOptions: server.projectSettings?.initializationSettings
    ? { ...server.initializationOptions, settings } : server.initializationOptions };
}
export function documentSymbols(result: any, uri: string) {
  const symbols: any[] = [];
  function visit(items: any[], parent = "", depth = 0) {
    if (depth > 20 || symbols.length >= 2000) return;
    for (const item of items || []) {
      const range = item.selectionRange || item.location?.range || item.range;
      if (typeof item.name !== "string" || !range?.start || item.location?.uri && item.location.uri !== uri) continue;
      symbols.push({ name: item.name, detail: item.detail || "", kind: item.kind, container: item.containerName || parent, range });
      if (Array.isArray(item.children)) visit(item.children, parent ? `${parent}.${item.name}` : item.name, depth + 1);
      if (symbols.length >= 2000) break;
    }
  }
  visit(Array.isArray(result) ? result : []);
  return symbols;
}
