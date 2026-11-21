import { runDirname, type RunCandidate, type RunConfigType, type RunDiscovery } from "@hato/sdk/run-configurations";

export const jsRunTypes: RunConfigType[] = [
  ["node", "Node.js script", "Script path"], ["npm-script", "npm script", "Script name"],
  ["jest", "Jest test", "Test path"], ["vitest", "Vitest test", "Test path"],
].map(([id, label, targetLabel]) => ({ id, label, targetLabel, profileHint: "NODE_ENV profile", runtimeLabel: "Node executable", runtimeHint: "Use node from the workspace PATH" }));

export function detectJsRuns({ sources, paths }: RunDiscovery): RunCandidate[] {
  const candidates: RunCandidate[] = [];
  for (const { path: file, text } of sources) {
    if (!/(^|\/)package\.json$/.test(file)) continue;
    let pkg: any;
    try { pkg = JSON.parse(text); } catch { continue; }
    if (!pkg || typeof pkg !== "object") continue;
    const cwd = runDirname(file);
    const add = (type: string, target: string, name: string, source = file) => candidates.push({ name, type, target, cwd, file: source, line: 0 });
    for (const [name, script] of Object.entries(pkg.scripts || {})) {
      if (!name || typeof script !== "string") continue;
      const escapedName = JSON.stringify(name);
      const line = text.split("\n").findIndex(s => s.trimStart().startsWith(escapedName) && s.trimStart().slice(escapedName.length).trimStart().startsWith(":"));
      candidates.push({ name: `npm run ${name}`, type: "npm-script", target: name, cwd, file, line: Math.max(0, line) });
    }
    const entries = typeof pkg.bin === "string" ? [[pkg.name, pkg.bin]] : Object.entries(pkg.bin || {});
    if (typeof pkg.main === "string") entries.push([pkg.name, pkg.main]);
    for (const [name, target] of entries) {
      if (typeof target === "string" && /\.[cm]?[jt]sx?$/.test(target)) add("node", target, typeof name === "string" ? name : target);
    }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const type of ["jest", "vitest"]) if (Object.prototype.hasOwnProperty.call(deps, type)) {
      add(type, ".", `All ${type} tests`);
      const prefix = cwd === "." ? "" : cwd + "/";
      for (const path of paths) if (path.startsWith(prefix) && /\.(test|spec)\.[cm]?[jt]sx?$/.test(path)) {
        add(type, path.slice(prefix.length), path.split("/").pop()!, path);
      }
    }
  }
  for (const file of paths) {
    if (file.includes("/") || !/^(index|main|server|app)\.[cm]?[jt]s$/.test(file)) continue;
    if (!candidates.some(c => c.type === "node" && c.cwd === "." && c.target.replace(/^\.\//, "") === file)) {
      candidates.push({ name: file, type: "node", target: file, cwd: ".", file, line: 0 });
    }
  }
  return candidates;
}
