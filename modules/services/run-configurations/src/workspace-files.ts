import type { EnvironmentPreview, RunDiscovery } from "@hato/sdk/run-configurations";
import { workspaceGrant, withWorkspace, type WorkspaceDescriptor } from "@hato/sdk/runtime";
import type { ModuleContext } from "@hato/sdk/types";
import { environment, mask, parseEnv, relativePath } from "./config";

const excluded = new Set(["node_modules", "target", "build", "dist", "out", "coverage", "vendor"]);
const sourceFile = /(^|\/)package\.json$|\.java$/;
const candidateFile = /(^|\/)(pom\.xml|build\.gradle(?:\.kts)?)$|\.[cm]?[jt]sx?$/;

export function readText(ctx: ModuleContext, d: WorkspaceDescriptor, path: string, max: number) {
  return withWorkspace(ctx, d, async () => {
    const grant = await workspaceGrant(ctx, d, "fs");
    const r = await ctx.host.fs.read(grant.grant, path, max);
    if (r.binary || r.truncated || typeof r.text !== "string") throw new Error(`${path} must be a text file smaller than ${max / 1024} KiB`);
    return r.text;
  });
}

export function scanRunFiles(ctx: ModuleContext, d: WorkspaceDescriptor): Promise<RunDiscovery & { limited: boolean }> {
  return withWorkspace(ctx, d, async () => {
    const grant = await workspaceGrant(ctx, d, "fs");
    const dirs = ["."], paths: string[] = [], toRead: string[] = [];
    let limited = false;
    for (let i = 0; i < dirs.length && i < 300; i += 12) {
      const batch = dirs.slice(i, i + 12);
      const listing = await Promise.all(batch.map(path => ctx.host.fs.list(grant.grant, path).catch(e => {
        if (path === "." || e.code === "ENOTCONN" || e.code === "ESTALE") throw e;
        limited = true;
        return { entries: [] };
      })));
      for (const [index, result] of listing.entries()) {
        const dir = batch[index];
        for (const entry of result.entries) {
          if (entry.name.startsWith(".")) continue;
          const path = dir === "." ? entry.name : `${dir}/${entry.name}`;
          if (entry.kind === "dir" && !excluded.has(entry.name)) {
            if (dirs.length < 300) dirs.push(path);
            else limited = true;
          } else if (entry.kind === "file") {
            if (sourceFile.test(path)) {
              if (toRead.length < 450) toRead.push(path);
              else limited = true;
            }
            if (candidateFile.test(path)) {
              if (paths.length < 3000) paths.push(path);
              else limited = true;
            }
          }
        }
      }
      // Each listing can append work; advance by the actual batch length.
      i -= 12 - batch.length;
    }
    const sources: RunDiscovery["sources"] = [];
    for (let i = 0; i < toRead.length; i += 12) {
      const batch = await Promise.all(toRead.slice(i, i + 12).map(async path => {
        const r = await ctx.host.fs.read(grant.grant, path, 128 * 1024).catch(e => {
          if (e.code === "ENOTCONN" || e.code === "ESTALE") throw e;
          return null;
        });
        return r && !r.binary && !r.truncated && typeof r.text === "string" ? { path, text: r.text } : null;
      }));
      for (const source of batch) if (source) sources.push(source); else limited = true;
    }
    return { sources, paths, limited };
  });
}

export async function resolveEnvironment(ctx: ModuleContext, d: WorkspaceDescriptor, a: any, allowMissing = false) {
  const values = new Map<string, { name: string; source: string; value: string }>();
  const missing: string[] = [];
  const files = a.envFiles ?? [];
  if (!Array.isArray(files) || files.length > 20) throw new Error("Choose up to 20 environment files");
  for (const candidate of files) {
    const path = relativePath(candidate, "Environment file");
    try {
      for (const [name, value] of parseEnv(await readText(ctx, d, path, 128 * 1024), path)) values.set(name, { name, source: path, value });
    } catch (e: any) {
      if (!allowMissing || e.code !== "ENOENT") throw e;
      missing.push(path);
    }
  }
  for (const [name, value] of Object.entries(environment(a.env ?? {}))) values.set(name, { name, source: "Inline", value });
  return { values: [...values.values()], missing };
}

export async function environmentPreview(ctx: ModuleContext, d: WorkspaceDescriptor, a: any, reveal: boolean): Promise<EnvironmentPreview> {
  const { values, missing } = await resolveEnvironment(ctx, d, a, true);
  return { missing, rows: values.sort((a, b) => a.name.localeCompare(b.name)).map(row => ({
    ...row, value: reveal || !/SECRET|TOKEN|PASSWORD|KEY/i.test(row.name) ? row.value : mask,
  })) };
}
