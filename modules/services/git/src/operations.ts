import { parseStatus } from "./status";
import type { ModuleContext, RunResult } from "@hato/sdk/types";
import type { WorkspaceDescriptor } from "@hato/sdk/runtime";

type Dependencies = {
  desc(ctx: ModuleContext, id: string): Promise<WorkspaceDescriptor>;
  git(ctx: ModuleContext, d: WorkspaceDescriptor, args: string[], limit?: number): Promise<RunResult>;
  fail(r: RunResult, what: string): never;
  cleanRel(path: any): string;
};
export function gitOperations({ desc, git, fail, cleanRel }: Dependencies) {
  const queues = new Map<string, Promise<any>>();
  async function run(ctx: ModuleContext, d: WorkspaceDescriptor, args: string[]) {
    const r = await git(ctx, d, args);
    if (r.code !== 0) fail(r, `git ${args[0]}`);
    if (r.truncated) throw new Error(`git ${args[0]} output is too large; narrow the selection`);
    return r.stdout;
  }
  const oid = (value: any) => {
    if (!/^[0-9a-f]{40,64}$/.test(String(value))) throw new Error("Invalid commit ID");
    return String(value);
  };
  function mutate(ctx: ModuleContext, a: any, work: (d: WorkspaceDescriptor) => Promise<any>) {
    const id = String(a.workspaceId);
    const next = (queues.get(id) || Promise.resolve()).catch(() => {}).then(async () => {
      const d = await desc(ctx, id);
      try { return await work(d); }
      finally { ctx.events.emit("git.changed", { workspaceId: id }); }
    });
    queues.set(id, next);
    void next.finally(() => { if (queues.get(id) === next) queues.delete(id); }).catch(() => {});
    return next;
  }
  return {
    async commit(ctx: ModuleContext, a: any) {
      return mutate(ctx, a, async d => {
        let paths = [...new Set<string>((a.paths || []).map(cleanRel))];
        const message = String(a.message || "").trim();
        if (!paths.length || !message) throw new Error("Select files and enter a commit message");
        if (paths.length > 1000) throw new Error("Select at most 1000 files per commit");
        const conflicts = await run(ctx, d, ["diff", "--name-only", "--diff-filter=U", "-z"]);
        if (conflicts) throw new Error("Resolve merge conflicts before committing");
        const status = parseStatus(await run(ctx, d, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."]));
        const prefix = (await run(ctx, d, ["rev-parse", "--show-prefix"])).trim();
        const selected = paths.map(p => {
          const file = status.find(f => f.path === prefix + p);
          if (!file) throw new Error(`${p} is no longer changed; refresh before committing`);
          if (file.kind === "renamed" && file.origPath && !file.origPath.startsWith(prefix)) throw new Error("This rename crosses the workspace boundary; commit it from the repository workspace");
          return file;
        });
        paths = [...new Set(selected.flatMap(f => [f.path.slice(prefix.length), ...(f.kind === "renamed" && f.origPath ? [f.origPath.slice(prefix.length)] : [])]))];
        // --only leaves any unrelated staged files out of this commit and in the index.
        const toStage = selected.filter(f => !(f.index === "D" && f.worktree === " ")).map(f => f.path.slice(prefix.length));
        if (toStage.length) await run(ctx, d, ["add", "--", ...toStage]);
        const output = await run(ctx, d, ["commit", "--only", "-m", message, "--", ...paths]);
        return { output, committed: paths };
      });
    },
    network(ctx: ModuleContext, a: any) {
      return mutate(ctx, a, async d => {
        if (!["fetch", "pull", "push"].includes(a.operation)) throw new Error("Invalid Git operation");
        return { output: await run(ctx, d, a.operation === "pull" ? ["pull", "--ff-only"] : a.operation === "fetch" ? ["fetch", "--all"] : ["push"]) };
      });
    },
    async stashes(ctx: ModuleContext, a: any) {
      const d = await desc(ctx, a.workspaceId);
      const text = await run(ctx, d, ["stash", "list", "--format=%H%x09%gs"]);
      return text.trim().split("\n").filter(Boolean).map(line => { const [id, ...name] = line.split("\t"); return { id, name: name.join("\t") }; });
    },
    stash(ctx: ModuleContext, a: any) {
      return mutate(ctx, a, async d => {
        if (a.operation === "save") return { output: await run(ctx, d, ["stash", "push", "--include-untracked", "-m", String(a.message || "Hato stash")]) };
        const id = oid(a.id);
        if (a.operation === "apply") return { output: await run(ctx, d, ["stash", "apply", id]) };
        if (a.operation === "drop") {
          // Resolve the stable object ID at mutation time; never drop a shifted stash@{n}.
          const list = await run(ctx, d, ["stash", "list", "--format=%H%x09%gd"]);
          const ref = list.split("\n").map(x => x.split("\t")).find(x => x[0] === id)?.[1];
          if (!ref) throw new Error("Stash no longer exists; refresh the list");
          return { output: await run(ctx, d, ["stash", "drop", ref]) };
        }
        throw new Error("Invalid stash operation");
      });
    },
    async history(ctx: ModuleContext, a: any) {
      const d = await desc(ctx, a.workspaceId);
      const ref = String(a.ref || "ALL");
      if (ref !== "ALL" && ref !== "HEAD" && !ref.startsWith("refs/")) throw new Error("Select a branch or tag");
      const verified = ref === "ALL" ? null : await run(ctx, d, ["rev-parse", "--verify", `${ref}^{commit}`]);
      const skip = Math.max(0, Math.min(Number(a.skip) || 0, 100000));
      const text = await run(ctx, d, ["log", "--topo-order", "-n", "100", `--skip=${skip}`, "--format=%H%x00%P%x00%an%x00%aI%x00%D%x00%s", ...(verified ? [oid(verified.trim())] : ["--all"]), "--"]);
      const commits = text.trim().split("\n").filter(Boolean).map(line => {
        const [id, parents, author, date, refs, subject] = line.split("\0");
        return { id, parents: parents.split(" ").filter(Boolean), author, date, refs, subject };
      });
      const tags = await run(ctx, d, ["for-each-ref", "--format=%(refname)", "refs/tags/"]);
      return { workspaceId: d.id, commits, tags: tags.trim().split("\n").filter(Boolean), more: commits.length === 100 };
    },
    async commitDiff(ctx: ModuleContext, a: any) {
      const d = await desc(ctx, a.workspaceId), id = oid(a.id);
      const text = await run(ctx, d, ["show", "--format=", "--root", "--first-parent", "--no-ext-diff", "--no-textconv", "-M", id, "--", "."]);
      return { workspaceId: d.id, document: await ctx.host.ui.documentOpen(d.id, text, "diff", { path: `${id.slice(0, 8)}.diff` }) };
    },
    async taskChanges(ctx: ModuleContext, a: any) {
      const d = await desc(ctx, a.workspaceId);
      const key = `git.taskBase.${d.id}`;
      let base = await ctx.modules.call("persistence", "settings.get", { key });
      // Older tasks have no saved baseline. Recover only an intact worktree creation reflog,
      // corroborated by the task timestamp; expired logs require an explicit baseline.
      if (!base && d.id.startsWith("task:")) {
        const task = await ctx.modules.call("persistence", "tasks.get", { id: d.id.slice(5) });
        if (task?.createdAt) {
          const log = await git(ctx, d, ["reflog", "show", "--date=unix", "--format=%H%x09%gD%x09%gs", "HEAD"]);
          const rows = log.stdout.split("\n").filter(Boolean).map(row => row.split("\t"));
          const first = rows[rows.length - 1], reset = rows[rows.length - 2];
          const time = first?.[1]?.match(/^HEAD@\{(\d+)\}$/)?.[1];
          const age = time ? Date.parse(task.createdAt) / 1000 - Number(time) : NaN;
          if (log.code === 0 && !log.truncated && first?.[2] === "" && reset?.[0] === first[0] && reset?.[2] === "reset: moving to HEAD" && age >= -2 && age < 900) {
            base = oid(first[0]);
            await ctx.modules.call("persistence", "settings.set", { key, value: base });
          }
        }
      }
      if (!base) return { workspaceId: d.id, base: null, files: [], message: "This task predates baseline tracking. Choose a starting commit to compare." };
      const reference = oid(base);
      const raw = await run(ctx, d, ["diff", "--name-status", "-z", "--no-renames", reference, "--", "."]);
      const prefix = (await run(ctx, d, ["rev-parse", "--show-prefix"])).trim();
      const parts = raw.split("\0"), files: any[] = [];
      for (let i = 0; i + 1 < parts.length; i += 2) {
        const kind = ({ A: "added", D: "deleted", M: "modified", T: "typechange" } as any)[parts[i]] || "modified";
        const path = parts[i + 1];
        if (path.startsWith(prefix)) files.push({ path: path.slice(prefix.length), kind, origPath: null });
      }
      const untracked = await run(ctx, d, ["ls-files", "--others", "--exclude-standard", "-z", "--", "."]);
      for (const path of untracked.split("\0").filter(Boolean)) if (!files.some(f => f.path === path)) files.push({ path, kind: "untracked", origPath: null });
      return { workspaceId: d.id, base: reference, files };
    },
    async setTaskBase(ctx: ModuleContext, a: any) {
      const d = await desc(ctx, a.workspaceId);
      if (!d.id.startsWith("task:")) throw new Error("Select a task workspace");
      const id = oid(a.id);
      await run(ctx, d, ["cat-file", "-e", `${id}^{commit}`]);
      const key = `git.taskBase.${d.id}`;
      if (await ctx.modules.call("persistence", "settings.get", { key })) throw new Error("This task already has a fixed baseline");
      await ctx.modules.call("persistence", "settings.set", { key, value: id });
      ctx.events.emit("git.changed", { workspaceId: d.id });
    },
  };
}
