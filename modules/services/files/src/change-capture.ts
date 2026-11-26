import type { ChatDiff, ModuleContext, SettingsSection } from "@hato/sdk/types";
import { CAPTURE_SETTING, CAPTURE_STATE, type CapturedChange } from "@hato/sdk/change-capture";
import { diffHunks } from "@hato/sdk/text-diff";
import { errMsg, targetFor, workspaceGrant, type WorkspaceDescriptor } from "@hato/sdk/runtime";
import { DEFAULT_EXCLUDES } from "./watch-excludes";

interface Preferences { enabled: boolean; days: number; megabytes: number }
interface Baseline { text: string; mtime: number | null; size: number }
const MAX_FILE = 200_000, MAX_BASELINE = 32_000_000, MAX_FILES = 10000;
const PREFS = "changes.capture";
const historyKey = (id: string) => "changes.history." + id;
type Owner = NonNullable<CapturedChange["owner"]>;

/** Selected-project capture. Git enumerates repository paths, including untracked files.
 * No repository metadata is written. Non-Git projects use scoped filesystem enumeration. */
export class ChangeCapture {
  private prefs: Preferences = { enabled: true, days: 7, megabytes: 20 };
  private workspace: WorkspaceDescriptor | null = null;
  private baseline = new Map<string, Baseline>();
  private records: CapturedChange[] = [];
  private owners = new Map<string, Owner>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: Promise<void> = Promise.resolve();
  private retentionTimer: ReturnType<typeof setInterval> | null = null;
  private generation = 0;
  private ready = false;
  private warning: string | null = null;
  constructor(private ctx: ModuleContext) {}
  async activate() {
    const saved = await this.ctx.modules.call("persistence", "settings.get", { key: PREFS });
    this.prefs = {
      enabled: typeof saved?.enabled === "boolean" ? saved.enabled : true,
      days: [1, 7, 30, 90].includes(saved?.days) ? saved.days : 7,
      megabytes: [5, 20, 100].includes(saved?.megabytes) ? saved.megabytes : 20,
    };
    this.ctx.state.set(CAPTURE_SETTING, this.prefs.enabled);
    await this.pruneAll();
    this.retentionTimer = setInterval(() => {
      void this.enqueue(() => this.pruneAll()).catch(e => this.ctx.log.warn("History retention", errMsg(e)));
    }, 3600000);
    const begin = (event: any) => {
      if (!event?.workspaceId || !event?.sessionId || !event?.key) return;
      this.owners.set(event.workspaceId + "|" + event.sessionId, event);
    };
    this.ctx.events.on("ai-sessions.capturePrompt", begin);
    this.ctx.events.on("persistent-agents.capturePrompt", begin);
    const end = (event: any) => {
      if (!this.owners.has(event.workspaceId + "|" + event.sessionId)) return;
      // Take the last snapshot before removing its attribution.
      void this.enqueue(async () => {
        await this.scan();
        this.owners.delete(event.workspaceId + "|" + event.sessionId);
      });
    };
    this.ctx.events.on("ai-sessions.captureEnded", end);
    this.ctx.events.on("persistent-agents.captureEnded", end);
  }
  sections(): SettingsSection[] { return [{
      key: "change-capture", title: "Change history", group: "AI & tools", fields: [
        { key: "enabled", type: "toggle", label: "Capture project changes", value: this.prefs.enabled,
          description: "Record text edits from agents, commands and editors. Controls Prompt History, its sidebar item and inline chat diffs. Captures the selected project while Hato is running." },
        { key: "days", type: "select", label: "Keep changes for", value: String(this.prefs.days),
          options: [1, 7, 30, 90].map(n => ({ value: String(n), label: n + (n === 1 ? " day" : " days") })) },
        { key: "megabytes", type: "select", label: "Maximum history per project", value: String(this.prefs.megabytes),
          options: [5, 20, 100].map(n => ({ value: String(n), label: n + " MB" })),
          description: "Oldest captured changes expire first. Text files up to 200 KB are captured. Dependency and cache folders are skipped. Binary files are skipped." },
        { key: "clear", type: "action", label: "Clear captured history", buttonLabel: "Clear history", description: "Delete saved captured edits for all projects." },
      ],
    }]; }
  async change(key: string, value: boolean | string) {
      const next = { ...this.prefs, [key]: key === "enabled" ? value : Number(value) } as Preferences;
      await this.ctx.modules.call("persistence", "settings.set", { key: PREFS, value: next });
      this.prefs = next;
      this.ctx.state.set(CAPTURE_SETTING, next.enabled);
      // Expire saved history for every project, including projects currently closed.
      await this.enqueue(() => this.pruneAll());
      await this.select(this.workspace);
  }
  async clear() {
      await this.enqueue(async () => {
        for (const id of await this.historyProjects()) {
          await this.ctx.modules.call("persistence", "settings.set", { key: historyKey(id), value: [] });
        }
        this.records = []; this.publish();
      });
  }
  private async pruneAll() {
    for (const id of await this.historyProjects()) await this.pruneStored(id);
    if (this.workspace) {
      const kept = this.trim(this.records);
      if (kept.length !== this.records.length) { this.records = kept; this.publish(); }
    }
  }
  private async historyProjects(): Promise<string[]> {
    return await this.ctx.modules.call("persistence", "settings.get", { key: "changes.projects" }) || [];
  }
  private trim(records: CapturedChange[]) {
    const cutoff = Date.now() - this.prefs.days * 86400000;
    const kept = records.filter(r => r.at >= cutoff);
    let bytes = 0;
    let start = kept.length;
    while (start > 0) {
      const size = JSON.stringify(kept[start - 1]).length * 3;
      if (bytes + size > this.prefs.megabytes * 1_000_000) break;
      bytes += size; start--;
    }
    return kept.slice(start);
  }
  private async pruneStored(id: string) {
    const records = await this.ctx.modules.call("persistence", "settings.get", { key: historyKey(id) });
    const trimmed = this.trim(Array.isArray(records) ? records : []);
    await this.ctx.modules.call("persistence", "settings.set", { key: historyKey(id), value: trimmed });
  }
  private publish() {
    this.ctx.state.set(CAPTURE_STATE, { workspaceId: this.workspace?.id || "", records: this.records, warning: this.warning, ready: this.ready });
    this.ctx.events.emit("files.changeCaptured", { workspaceId: this.workspace?.id });
  }
  private enqueue(work: () => Promise<void>) {
    const next = this.pending.catch(() => {}).then(work);
    this.pending = next;
    return next;
  }
  async select(workspace: WorkspaceDescriptor | null) {
    const generation = ++this.generation;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.enqueue(async () => {
      if (generation !== this.generation) return;
      this.workspace = workspace; this.baseline.clear(); this.ready = false; this.warning = null; this.records = [];
      if (workspace) {
        await this.pruneStored(workspace.id);
        this.records = await this.ctx.modules.call("persistence", "settings.get", { key: historyKey(workspace.id) }) || [];
        const ids = await this.historyProjects();
        if (!ids.includes(workspace.id)) await this.ctx.modules.call("persistence", "settings.set", { key: "changes.projects", value: [...ids, workspace.id] });
      }
      this.publish();
      if (this.prefs.enabled && workspace) await this.scan();
    });
    if (generation === this.generation && this.prefs.enabled && workspace) this.schedule(generation);
  }
  private schedule(generation: number) {
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.enqueue(() => this.scan()).catch(e => this.ctx.log.warn("Change capture", errMsg(e))).finally(() => {
        if (generation === this.generation && this.prefs.enabled) this.schedule(generation);
      });
    }, 3000);
  }
  private async paths(workspace: WorkspaceDescriptor, grant: string): Promise<string[]> {
    const process = await workspaceGrant(this.ctx, workspace, "process");
    const result = await this.ctx.host.process.run(process.grant, {
      target: await targetFor(this.ctx, workspace), executable: "git",
      args: ["--no-optional-locks", "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "."],
      cwd: workspace.rootAbsolutePath, loginShell: workspace.location !== "local",
    }, { timeoutMs: 30000, limitBytes: 4_000_000 }).catch(() => null);
    if (result?.code === 0 && !result.truncated) return [...new Set(result.stdout.split("\0").filter(Boolean))];
    const paths: string[] = [], directories = ["."];
    for (let i = 0; i < directories.length; i++) {
      if (directories.length + paths.length > MAX_FILES) throw new Error("Project exceeds the 10,000-file capture limit.");
      const dir = directories[i];
      const entries = (await this.ctx.host.fs.list(grant, dir)).entries;
      for (const entry of entries) {
        if (entry.symlink || DEFAULT_EXCLUDES.includes(entry.name)) continue;
        const path = dir === "." ? entry.name : dir + "/" + entry.name;
        if (entry.kind === "dir") directories.push(path);
        else if (entry.kind === "file") paths.push(path);
      }
    }
    return paths;
  }
  private async scan() {
    const workspace = this.workspace;
    if (!workspace || !this.prefs.enabled) return;
    try {
      const grant = (await workspaceGrant(this.ctx, workspace, "fs")).grant;
      const paths = (await this.paths(workspace, grant)).filter(path =>
        !path.startsWith("/") && !path.split("/").some(part => part === ".." || DEFAULT_EXCLUDES.includes(part)));
      if (paths.length > MAX_FILES) throw new Error("Project exceeds the 10,000-file capture limit.");
      const next = new Map<string, Baseline>();
      const excluded = new Set<string>();
      let total = 0, skipped = 0;
      // Read text even when size/mtime match: fast same-size rewrites must be detected.
      for (const path of paths) {
        let stat;
        try { stat = await this.ctx.host.fs.stat(grant, path); }
        catch (error: any) { if (error?.code === "ENOENT") continue; throw error; }
        if (stat.kind === "dir") {
          const nested = { ...workspace, rootAbsolutePath: workspace.rootAbsolutePath.replace(/\/$/, "") + "/" + path };
          const nestedGrant = (await workspaceGrant(this.ctx, nested, "fs")).grant;
          const children = await this.paths(nested, nestedGrant);
          for (const child of children) {
            if (!child.startsWith("/") && !child.split("/").some(part => part === ".." || DEFAULT_EXCLUDES.includes(part))) paths.push(path + "/" + child);
          }
          if (paths.length > MAX_FILES) throw new Error("Project exceeds the 10,000-file capture limit.");
          continue;
        }
        if (stat.kind !== "file" || stat.size > MAX_FILE) { skipped++; excluded.add(path); continue; }
        const read = await this.ctx.host.fs.read(grant, path, MAX_FILE);
        if (read.binary || read.truncated || read.text === undefined) { skipped++; excluded.add(path); continue; }
        total += read.text.length * 2;
        if (total > MAX_BASELINE) throw new Error("Project text exceeds the 32 MB capture baseline limit.");
        next.set(path, { text: read.text, size: stat.size, mtime: stat.mtime });
      }
      const diffs: ChatDiff[] = [];
      if (this.ready) for (const path of new Set([...this.baseline.keys(), ...next.keys()])) {
        if (excluded.has(path)) continue;
        const before = this.baseline.get(path)?.text ?? null, after = next.get(path)?.text ?? null;
        if (before === after) continue;
        diffs.push({ path: workspace.rootAbsolutePath.replace(/\/$/, "") + "/" + path,
          ...diffHunks(before, after, Number.MAX_SAFE_INTEGER), ...(before === null ? { newFile: true } : {}), ...(after === null ? { deletedFile: true } : {}) });
      }
      this.baseline = next;
      const wasReady = this.ready; this.ready = true;
      const warning = skipped ? skipped + " binary, oversized or non-regular files excluded." : null;
      const statusChanged = this.warning !== warning || !wasReady;
      this.warning = warning;
      const kept = this.trim(this.records);
      if (diffs.length) {
        const owners = [...this.owners.entries()].filter(([key]) => key.startsWith(workspace.id + "|")).map(([, owner]) => owner);
        kept.push({ id: crypto.randomUUID(), at: Date.now(), diffs, ...(owners.length === 1 ? { owner: owners[0] } : {}) });
      }
      const changed = diffs.length > 0 || kept.length !== this.records.length;
      if (changed) {
        const records = this.trim(kept);
        await this.ctx.modules.call("persistence", "settings.set", { key: historyKey(workspace.id), value: records });
        this.records = records;
      }
      if (changed || statusChanged) this.publish();
    } catch (e) {
      const warning = errMsg(e);
      if (this.warning !== warning) { this.warning = warning; this.publish(); }
    }
  }
  async stop() {
    this.generation++;
    if (this.retentionTimer) clearInterval(this.retentionTimer);
    this.retentionTimer = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.pending.catch(() => {});
  }
}
