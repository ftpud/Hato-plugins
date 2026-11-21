import type { RunConfigDraft } from "@hato/sdk/run-configurations";

export const envName = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const mask = "••••••";

function string(value: unknown, field: string, max = 2048) {
  if (typeof value !== "string" || value.length > max || value.includes("\0")) throw new Error(`Invalid ${field}`);
  return value;
}
function required(value: unknown, field: string, max?: number) {
  const text = string(value, field, max).trim();
  if (!text) throw new Error(`Enter ${field}`);
  return text;
}

export function relativePath(value: unknown, field: string, rootAllowed = false): string {
  const path = required(value, field).replace(/^\.\//, "");
  if (path === "." && rootAllowed) return path;
  if (!path || /^(?:\/|[A-Za-z]:)|[\\\r\n]/.test(path) || path.split("/").some(p => !p || p === "." || p === "..")) {
    throw new Error(`${field} must be relative to the workspace`);
  }
  return path;
}

function array(value: unknown, label: string, limit = 100): unknown[] {
  if (!Array.isArray(value) || value.length > limit) throw new Error(`Invalid ${label}`);
  return value;
}

const args = (value: unknown) => array(value, "arguments").map(v => string(v, "argument", 8192));

export function environment(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid environment variables");
  const entries = Object.entries(value);
  if (entries.length > 200) throw new Error("Too many inline environment variables");
  return Object.fromEntries(entries.map(([key, val]) => {
    if (!envName.test(key) || key.length > 128) throw new Error("Invalid environment variable name");
    return [key, string(val, "environment variable value", 8192)];
  }));
}

export function normalizeConfig(value: any): RunConfigDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Provide a run configuration");
  return {
    name: required(value.name, "a configuration name", 120),
    type: required(value.type, "a configuration type", 80),
    target: required(value.target, "a target"),
    cwd: relativePath(value.cwd ?? ".", "Working directory", true),
    args: args(value.args ?? []),
    runtimeArgs: args(value.runtimeArgs ?? []),
    runtime: string(value.runtime ?? "", "runtime").trim(),
    shared: value.shared === true,
    env: environment(value.env ?? {}),
    envFiles: array(value.envFiles ?? [], "environment files", 20).map(p => relativePath(p, "Environment file")),
    profiles: array(value.profiles ?? [], "profiles", 40).map(p => required(p, "profile", 120)),
    beforeLaunch: array(value.beforeLaunch ?? [], "before-launch steps", 30).map((step: any) => ({
      kind: (["build", "npm", "configuration", "command"] as const).find(kind => kind === step?.kind) ?? "command",
      executable: required(step?.executable, "a before-launch executable"),
      args: args(step.args ?? []),
      cwd: step.cwd ? relativePath(step.cwd, "Before-launch working directory", true) : "",
    })),
  };
}

export function parseEnv(text: string, path: string): [string, string][] {
  const entries: [string, string][] = [];
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;
    const assignment = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!assignment) throw new Error(`${path}:${i + 1} must contain a KEY=value assignment`);
    const [, key, raw] = assignment;
    const quote = raw[0];
    if (quote !== '"' && quote !== "'" && quote !== "`") {
      entries.push([key, raw.split("#", 1)[0].trimEnd()]);
      continue;
    }
    const start = i;
    let value = raw.slice(1), end = -1, index = 0;
    while (i < lines.length) {
      while (index < value.length) {
        if (quote === '"' && value[index] === "\\") { index += 2; continue; }
        if (value[index] === quote) { end = index; break; }
        index++;
      }
      if (end >= 0 || i + 1 >= lines.length) break;
      value += "\n" + lines[++i];
    }
    if (end < 0 || !/^\s*(?:#.*)?$/.test(value.slice(end + 1))) throw new Error(`${path}:${start + 1} has an invalid quoted value`);
    const content = value.slice(0, end);
    entries.push([key, quote === '"' ? content.replace(/\\([nrt"\\])/g, (_, c) => ({ n: "\n", r: "\r", t: "\t", '"': '"', "\\": "\\" })[c]!) : content]);
  }
  return entries;
}
