import type { ModuleContext } from "@hato/sdk/types";
import { filePresentationRules, matchingFileRules, presentFile, type CompiledFileRule, type FilePresentation, type FilePresentationEntry } from "@hato/sdk/file-presentation";
import { relativeFile } from "@hato/sdk/languages";
import { workspaceGrant, withWorkspace, type WorkspaceDescriptor } from "@hato/sdk/runtime";

/** Files owns scoped reads; presentation policy belongs to contributing plugins. */
export class FilePresentations {
  private rules: CompiledFileRule[] = [];
  private cache = new Map<string, Promise<FilePresentation>>();
  private stops: (() => void)[] = [];
  private revision = 0;
  private stopped = false;
  constructor(private ctx: ModuleContext) {}
  async activate() {
    this.stops.push(this.ctx.events.on("kernel.modules.changed", () => { void this.load(); }));
    this.stops.push(this.ctx.events.on("files.changed", () => this.clear()));
    await this.load();
  }
  dispose() { this.stopped = true; this.revision++; for (const stop of [...this.stops, ...this.providerStops]) if (typeof stop === "function") stop(); }
  private clear() { this.cache.clear(); this.ctx.events.emit("files.presentationChanged", {}); }
  private async load() {
    const revision = ++this.revision;
    try {
      const { plugins } = await this.ctx.host.plugins.list();
      if (revision !== this.revision || this.stopped) return;
      for (const stop of this.providerStops) if (typeof stop === "function") stop();
      this.providerStops = plugins.filter(p => p.enabled && p.active).map(p => this.ctx.state.watch(`${p.id}.filePresentation`, () => { void this.load(); }));
      this.rules = filePresentationRules(plugins, key => this.ctx.state.get(key));
      this.ctx.state.set("files.presentationRuleCount", this.rules.length);
      this.clear();
    } catch { /* Hosts without contributions keep ordinary file presentation. */ }
  }
  private providerStops: (() => void)[] = [];
  async get(workspace: WorkspaceDescriptor, requested: FilePresentationEntry[]): Promise<Record<string, FilePresentation>> {
    const entries = requested.slice(0, 64).map(entry => ({ path: relativeFile(String(entry.path)), kind: entry.kind === "dir" ? "dir" as const : "file" as const }));
    const result: Record<string, FilePresentation> = {};
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(4, entries.length) }, async () => {
      while (cursor < entries.length) {
        const entry = entries[cursor++], key = `${workspace.id}|${entry.kind}|${entry.path}`;
        let pending = this.cache.get(key);
        if (!pending) {
          const rules = this.rules;
          pending = (async () => {
            if (!matchingFileRules(rules, entry).some(({ rule }) => rule.contentPattern)) return presentFile(rules, entry);
            try {
              return await withWorkspace(this.ctx, workspace, async () => {
                const grant = await workspaceGrant(this.ctx, workspace, "fs");
                const read = await this.ctx.host.fs.read(grant.grant, entry.path, 32768);
                return presentFile(rules, entry, read.binary ? undefined : read.text);
              });
            } catch { return presentFile(rules, entry); }
          })();
          this.cache.set(key, pending);
          if (this.cache.size > 6000) this.cache.delete(this.cache.keys().next().value!);
        }
        result[entry.path] = await pending;
      }
    }));
    return result;
  }
}
