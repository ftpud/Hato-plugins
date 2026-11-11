// ../sdk/runtime.ts
var grantCache = /* @__PURE__ */ new Map();
var sshCache = /* @__PURE__ */ new Map();
function sshProfileSpec(ssh) {
  return { profileId: ssh.profileId, host: ssh.host, port: ssh.port, user: ssh.user, identityFile: ssh.identityFile ?? null, transport: ssh.transport ?? "ssh", ...ssh.auth ? { auth: ssh.auth } : {} };
}
function sshConnect(ctx, desc2) {
  if (desc2.location !== "ssh" || !desc2.ssh) throw new Error("not an SSH workspace");
  const key = desc2.machineId;
  let p = sshCache.get(key);
  if (!p) {
    p = ctx.host.ssh.connect(sshProfileSpec(desc2.ssh));
    sshCache.set(key, p);
    p.catch(() => sshCache.delete(key));
  }
  return p;
}
function forgetSsh(machineId) {
  sshCache.delete(machineId);
  for (const k of Array.from(grantCache.keys())) if (k.includes("|" + machineId + "|")) grantCache.delete(k);
}
async function targetFor(ctx, desc2) {
  if (desc2.location === "local") return { kind: "local" };
  const c = await sshConnect(ctx, desc2);
  return { kind: "ssh", connection: c.connection, machineId: c.machineId };
}
async function workspaceGrant(ctx, desc2, kind, root) {
  const r = root || desc2.rootAbsolutePath;
  const key = kind + "|" + desc2.machineId + "|" + r;
  let p = grantCache.get(key);
  if (!p) {
    p = (async () => {
      const target = await targetFor(ctx, desc2);
      return ctx.host.capabilities.request({ kind, root: r, target });
    })();
    grantCache.set(key, p);
    p.catch(() => grantCache.delete(key));
  }
  try {
    return await p;
  } catch (e) {
    if (e && (e.code === "ENOTCONN" || e.code === "EBADF")) forgetSsh(desc2.machineId);
    throw e;
  }
}
async function withWorkspace(ctx, desc2, fn) {
  try {
    return await fn();
  } catch (e) {
    if (desc2.location === "ssh" && e && (e.code === "ENOTCONN" || e.code === "ESTALE" || e.code === "EBADF")) {
      forgetSsh(desc2.machineId);
      return await fn();
    }
    throw e;
  }
}
function errMsg(e) {
  return e && (e.message || String(e)) || "unknown error";
}

// ../sdk/file-watch.ts
function fileWatch(ctx, changed2) {
  let generation = 0, stopped = false;
  let close = null;
  let retry = null;
  let delay = 1e3;
  async function select(ws, root) {
    const mine = ++generation;
    if (retry) clearTimeout(retry);
    retry = null;
    const previous = close;
    close = null;
    await previous?.();
    if (!ws || stopped || mine !== generation) return;
    let handle = null, subscription = null;
    const dispose = async () => {
      await subscription?.close().catch(() => {
      });
      if (handle) await ctx.host.resources.release(handle).catch(() => {
      });
    };
    const failed = (error) => {
      if (mine !== generation || stopped) return;
      ctx.log.warn(`File watcher: ${errMsg(error)}`);
      retry = setTimeout(() => {
        void select(ws, root);
      }, delay);
      delay = Math.min(delay * 2, 3e4);
    };
    try {
      const grant = await workspaceGrant(ctx, ws, "fs", root);
      if (mine !== generation || stopped) return;
      ({ handle } = await ctx.host.fs.watch(grant.grant, "."));
      if (mine !== generation || stopped) {
        await dispose();
        return;
      }
      close = dispose;
      subscription = await ctx.host.streams.listen(handle, { channel: "stdout" }, () => {
        if (mine !== generation || stopped) return;
        delay = 1e3;
        changed2(ws.id);
      }, (error) => failed(error || new Error("notification stream closed")));
      if (mine !== generation || stopped) await dispose();
    } catch (error) {
      await dispose();
      failed(error);
    }
  }
  return {
    select,
    async stop() {
      stopped = true;
      generation++;
      if (retry) clearTimeout(retry);
      retry = null;
      const previous = close;
      close = null;
      await previous?.();
    }
  };
}

// modules/services/git/src/status.ts
var CONFLICT = /* @__PURE__ */ new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);
function kindOf(x, y) {
  const xy = x + y;
  if (xy === "??") return "untracked";
  if (CONFLICT.has(xy)) return "conflicted";
  for (const c of [x, y]) {
    if (c === "R") return "renamed";
    if (c === "C") return "copied";
  }
  if (x === "A") return "added";
  if (x === "D" || y === "D") return "deleted";
  if (x === "T" || y === "T") return "typechange";
  return "modified";
}
function parseStatus(out) {
  const parts = out.split("\0");
  const changes = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    const x = entry[0], y = entry[1], path = entry.slice(3);
    if (x === "!") continue;
    let origPath = null;
    if (x === "R" || x === "C" || y === "R" || y === "C") origPath = parts[++i] || null;
    const kind = kindOf(x, y);
    changes.push({
      path,
      origPath,
      index: x,
      worktree: y,
      kind,
      staged: x !== " " && x !== "?",
      unstaged: y !== " ",
      additions: null,
      deletions: null,
      binary: false
    });
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}
function parseNumstat(out) {
  const result = /* @__PURE__ */ new Map();
  const parts = out.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(parts[i]);
    if (!m) continue;
    let path = m[3];
    if (path === "") {
      i++;
      path = parts[++i] || "";
    }
    const binary = m[1] === "-";
    result.set(path, { additions: binary ? null : Number(m[1]), deletions: binary ? null : Number(m[2]), binary });
  }
  return result;
}

// ../sdk/text-diff.ts
function splitLines(text) {
  if (!text) return { lines: [], noEol: false };
  const noEol = !text.endsWith("\n");
  const lines = (noEol ? text : text.slice(0, -1)).split("\n");
  return { lines, noEol };
}
function myers(a, b, maxD) {
  const n = a.length, m = b.length, max = n + m, offset = max;
  maxD = Math.min(maxD, Math.floor(8e6 / (2 * max + 2)));
  const v = new Int32Array(2 * max + 2);
  const trace = [];
  for (let d = 0; d <= Math.min(max, maxD); d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || k !== d && v[offset + k - 1] < v[offset + k + 1] ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        const ops = [];
        let cx = n, cy = m;
        for (let dd = d; dd > 0; dd--) {
          const pv = trace[dd], kk = cx - cy;
          const prevK = kk === -dd || kk !== dd && pv[offset + kk - 1] < pv[offset + kk + 1] ? kk + 1 : kk - 1;
          const px = pv[offset + prevK], py = px - prevK;
          while (cx > px && cy > py) {
            ops.push({ kind: " ", line: a[--cx] });
            cy--;
          }
          if (cx === px) ops.push({ kind: "+", line: b[--cy] });
          else ops.push({ kind: "-", line: a[--cx] });
        }
        while (cx > 0 && cy > 0) {
          ops.push({ kind: " ", line: a[--cx] });
          cy--;
        }
        return ops.reverse();
      }
    }
  }
  return null;
}
function diffLines(a, b, maxD = 4e3) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA), midB = b.slice(start, endB);
  const mid = myers(midA, midB, maxD) ?? [...midA.map((line) => ({ kind: "-", line })), ...midB.map((line) => ({ kind: "+", line }))];
  return [...a.slice(0, start).map((line) => ({ kind: " ", line })), ...mid, ...a.slice(endA).map((line) => ({ kind: " ", line }))];
}
function unifiedPatch(path, before, after, context = 3) {
  if (before === after) return "";
  const header = [`diff --git a/${path} b/${path}`];
  if (before === null) header.push("new file mode 100644");
  if (after === null) header.push("deleted file mode 100644");
  header.push(before === null ? "--- /dev/null" : `--- a/${path}`, after === null ? "+++ /dev/null" : `+++ b/${path}`);
  const A = splitLines(before ?? ""), B = splitLines(after ?? "");
  const NO_EOL = "\0";
  const keyed = (s) => s.noEol ? [...s.lines.slice(0, -1), s.lines[s.lines.length - 1] + NO_EOL] : s.lines;
  const ops = diffLines(keyed(A), keyed(B)).map((op) => op.line.endsWith(NO_EOL) ? { ...op, line: op.line.slice(0, -1) } : op);
  const hunks = [];
  let i = 0, oldNo = 1, newNo = 1;
  const noEolAt = (op, ai, bi) => op.kind !== "+" && A.noEol && ai === A.lines.length || op.kind !== "-" && B.noEol && bi === B.lines.length;
  while (i < ops.length) {
    if (ops[i].kind === " ") {
      i++;
      oldNo++;
      newNo++;
      continue;
    }
    let from = i, lead = 0;
    while (from > 0 && lead < context && ops[from - 1].kind === " ") {
      from--;
      lead++;
    }
    let to = i;
    for (; ; ) {
      while (to < ops.length && ops[to].kind !== " ") to++;
      let gap = 0;
      while (to + gap < ops.length && ops[to + gap].kind === " ") gap++;
      if (to + gap < ops.length && gap <= 2 * context) {
        to += gap;
        continue;
      }
      to = Math.min(ops.length, to + Math.min(gap, context));
      break;
    }
    const oStart = oldNo - lead, nStart = newNo - lead;
    let oCount = 0, nCount = 0, ai = oStart - 1, bi = nStart - 1;
    const body = [];
    for (let j = from; j < to; j++) {
      const op = ops[j];
      if (op.kind !== "+") {
        oCount++;
        ai++;
      }
      if (op.kind !== "-") {
        nCount++;
        bi++;
      }
      body.push(op.kind + op.line);
      if (noEolAt(op, ai, bi)) body.push("\\ No newline at end of file");
    }
    hunks.push(`@@ -${oCount ? oStart : oStart - 1},${oCount} +${nCount ? nStart : nStart - 1},${nCount} @@`, ...body);
    for (let j = i; j < to; j++) {
      if (ops[j].kind !== "+") oldNo++;
      if (ops[j].kind !== "-") newNo++;
    }
    i = to;
  }
  if (!hunks.length) return "";
  return [...header, ...hunks].join("\n") + "\n";
}

// modules/services/git/src/branches.ts
var message = (r, action) => `${action}: ${(r.stderr || r.stdout).trim().slice(0, 1200) || `Git exited with ${r.code}`}`;
async function checked(run, args, action) {
  const result = await run(args);
  if (result.code !== 0) throw new Error(message(result, action));
  return result;
}
async function listBranches(run) {
  const repo = await run(["rev-parse", "--is-inside-work-tree"]);
  if (repo.code !== 0 || repo.stdout.trim() !== "true") return { repo: false, current: null, head: null, local: [], remote: [], remotes: [] };
  const current = await run(["symbolic-ref", "-q", "HEAD"]);
  const head = await run(["rev-parse", "--short", "--verify", "HEAD"]);
  const result = await checked(run, ["for-each-ref", "--sort=refname", "--format=%(refname)%00%(objectname:short)%00%(symref)%00%(upstream)%00%(worktreepath)%00", "refs/heads/", "refs/remotes/"], "List branches");
  if (result.truncated) throw new Error("Branch list is too large; Git output was truncated.");
  const currentRef = current.code === 0 ? current.stdout.trim() : null;
  const local = [], remote = [];
  const fields = result.stdout.split("\0");
  for (let i = 0; i + 4 < fields.length; i += 5) {
    const ref = fields[i].replace(/^\n/, "");
    if (fields[i + 2]) continue;
    const isLocal = ref.startsWith("refs/heads/");
    if (!isLocal && !ref.startsWith("refs/remotes/")) continue;
    (isLocal ? local : remote).push({
      ref,
      name: ref.slice(isLocal ? 11 : 13),
      commit: fields[i + 1] || null,
      current: ref === currentRef,
      upstream: fields[i + 3] || null,
      worktree: fields[i + 4] || null
    });
  }
  if (currentRef?.startsWith("refs/heads/") && !local.some((b) => b.ref === currentRef)) {
    local.unshift({ ref: currentRef, name: currentRef.slice(11), commit: null, current: true, upstream: null, worktree: null, unborn: true });
  }
  const remotes = await checked(run, ["remote"], "List remotes");
  return {
    repo: true,
    current: currentRef?.slice(11) || null,
    head: head.code === 0 ? head.stdout.trim() : null,
    local,
    remote,
    remotes: remotes.stdout.trim().split("\n").filter(Boolean)
  };
}
async function validName(run, value) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.startsWith("-") || name.length > 1024) throw new Error("Enter a valid branch name.");
  const result = await run(["check-ref-format", "--branch", name]);
  if (result.code !== 0 || result.stdout.trim() !== name) throw new Error("Invalid branch name. Use a name such as feature/welcome.");
  return name;
}
function findRef(catalog, ref) {
  if (!catalog.repo) throw new Error("This workspace is not a Git worktree.");
  const branch = [...catalog.local, ...catalog.remote].find((b) => b.ref === ref);
  if (!branch) throw new Error("Branch is no longer available. Refresh the branch list.");
  return branch;
}
async function checkoutBranch(run, ref) {
  const catalog = await listBranches(run);
  const branch = findRef(catalog, ref);
  if (branch.current) return;
  if (branch.ref.startsWith("refs/heads/")) {
    await validName(run, branch.name);
    await checked(run, ["switch", "--no-guess", "--", branch.name], "Checkout branch");
  } else {
    const remote = [...catalog.remotes].sort((a, b) => b.length - a.length).find((r) => branch.name.startsWith(r + "/"));
    if (!remote) throw new Error("This remote no longer exists. Refresh the branch list.");
    const name = await validName(run, branch.name.slice(remote.length + 1));
    const local = catalog.local.find((b) => b.name === name);
    if (local && local.upstream !== branch.ref) throw new Error(`Local branch “${name}” already exists with a different upstream. Use “Create branch from here” to choose another name.`);
    await checked(run, local ? ["switch", "--no-guess", "--", name] : ["switch", "--create", name, "--track", "--", branch.ref], "Checkout remote branch");
  }
}
async function createBranch(run, nameValue, from) {
  const name = await validName(run, nameValue);
  const catalog = await listBranches(run);
  if (!catalog.repo) throw new Error("This workspace is not a Git worktree.");
  if (catalog.local.some((b) => b.name === name)) throw new Error(`Branch “${name}” already exists.`);
  const source = from ? findRef(catalog, from) : null;
  const args = ["switch", "--create", name];
  if (source && !source.unborn) {
    if (source.ref.startsWith("refs/remotes/")) args.push("--track");
    args.push("--", source.ref);
  }
  await checked(run, args, "Create and checkout branch");
}
async function localBranch(run, ref) {
  const catalog = await listBranches(run);
  const branch = findRef(catalog, ref);
  if (!branch.ref.startsWith("refs/heads/")) throw new Error("Choose a local branch.");
  if (branch.worktree && !branch.current) throw new Error("This branch is checked out in another worktree.");
  await validName(run, branch.name);
  return { catalog, branch };
}
async function renameBranch(run, ref, value) {
  const { catalog, branch } = await localBranch(run, ref);
  const name = await validName(run, value);
  if (catalog.local.some((item) => item.name === name)) throw new Error(`Branch “${name}” already exists.`);
  await checked(run, ["branch", "--move", "--", branch.name, name], "Rename branch");
}
async function deleteBranch(run, ref) {
  const { branch } = await localBranch(run, ref);
  if (branch.current) throw new Error("Switch to another branch before deleting this one.");
  await checked(run, ["branch", "--delete", "--", branch.name], "Delete merged branch");
}
async function publishBranch(run, ref, remote) {
  const { catalog, branch } = await localBranch(run, ref);
  if (typeof remote !== "string" || !catalog.remotes.includes(remote) || remote.startsWith("-")) throw new Error("Choose an available remote.");
  if (branch.unborn) throw new Error("Create a commit before publishing this branch.");
  await checked(run, ["push", "--set-upstream", "--", remote, `${branch.ref}:${branch.ref}`], "Publish branch");
}
async function setBranchUpstream(run, ref, upstream) {
  const { catalog, branch } = await localBranch(run, ref);
  const target = catalog.remote.find((item) => item.ref === upstream);
  if (!target) throw new Error("Choose an existing remote-tracking branch. Refresh or fetch if it is missing.");
  await checked(run, ["branch", `--set-upstream-to=${target.ref}`, "--", branch.name], "Set upstream");
}

// modules/services/git/src/operations.ts
function gitOperations({ desc: desc2, git: git2, fail: fail2, cleanRel: cleanRel2 }) {
  const queues = /* @__PURE__ */ new Map();
  async function run(ctx, d, args) {
    const r = await git2(ctx, d, args);
    if (r.code !== 0) fail2(r, `git ${args[0]}`);
    if (r.truncated) throw new Error(`git ${args[0]} output is too large; narrow the selection`);
    return r.stdout;
  }
  const oid = (value) => {
    if (!/^[0-9a-f]{40,64}$/.test(String(value))) throw new Error("Invalid commit ID");
    return String(value);
  };
  function mutate(ctx, a, work) {
    const id = String(a.workspaceId);
    const next = (queues.get(id) || Promise.resolve()).catch(() => {
    }).then(async () => {
      const d = await desc2(ctx, id);
      try {
        return await work(d);
      } finally {
        ctx.events.emit("git.changed", { workspaceId: id });
      }
    });
    queues.set(id, next);
    void next.finally(() => {
      if (queues.get(id) === next) queues.delete(id);
    }).catch(() => {
    });
    return next;
  }
  return {
    async commit(ctx, a) {
      return mutate(ctx, a, async (d) => {
        let paths = [...new Set((a.paths || []).map(cleanRel2))];
        const message2 = String(a.message || "").trim();
        if (!paths.length || !message2) throw new Error("Select files and enter a commit message");
        if (paths.length > 1e3) throw new Error("Select at most 1000 files per commit");
        const conflicts = await run(ctx, d, ["diff", "--name-only", "--diff-filter=U", "-z"]);
        if (conflicts) throw new Error("Resolve merge conflicts before committing");
        const status = parseStatus(await run(ctx, d, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."]));
        const prefix = (await run(ctx, d, ["rev-parse", "--show-prefix"])).trim();
        const selected = paths.map((p) => {
          const file = status.find((f) => f.path === prefix + p);
          if (!file) throw new Error(`${p} is no longer changed; refresh before committing`);
          if (file.kind === "renamed" && file.origPath && !file.origPath.startsWith(prefix)) throw new Error("This rename crosses the workspace boundary; commit it from the repository workspace");
          return file;
        });
        paths = [...new Set(selected.flatMap((f) => [f.path.slice(prefix.length), ...f.kind === "renamed" && f.origPath ? [f.origPath.slice(prefix.length)] : []]))];
        const toStage = selected.filter((f) => !(f.index === "D" && f.worktree === " ")).map((f) => f.path.slice(prefix.length));
        if (toStage.length) await run(ctx, d, ["add", "--", ...toStage]);
        const output = await run(ctx, d, ["commit", "--only", "-m", message2, "--", ...paths]);
        return { output, committed: paths };
      });
    },
    network(ctx, a) {
      return mutate(ctx, a, async (d) => {
        if (!["fetch", "pull", "push"].includes(a.operation)) throw new Error("Invalid Git operation");
        return { output: await run(ctx, d, a.operation === "pull" ? ["pull", "--ff-only"] : a.operation === "fetch" ? ["fetch", "--all"] : ["push"]) };
      });
    },
    async stashes(ctx, a) {
      const d = await desc2(ctx, a.workspaceId);
      const text = await run(ctx, d, ["stash", "list", "--format=%H%x09%gs"]);
      return text.trim().split("\n").filter(Boolean).map((line) => {
        const [id, ...name] = line.split("	");
        return { id, name: name.join("	") };
      });
    },
    stash(ctx, a) {
      return mutate(ctx, a, async (d) => {
        if (a.operation === "save") return { output: await run(ctx, d, ["stash", "push", "--include-untracked", "-m", String(a.message || "Hato stash")]) };
        const id = oid(a.id);
        if (a.operation === "apply") return { output: await run(ctx, d, ["stash", "apply", id]) };
        if (a.operation === "drop") {
          const list = await run(ctx, d, ["stash", "list", "--format=%H%x09%gd"]);
          const ref = list.split("\n").map((x) => x.split("	")).find((x) => x[0] === id)?.[1];
          if (!ref) throw new Error("Stash no longer exists; refresh the list");
          return { output: await run(ctx, d, ["stash", "drop", ref]) };
        }
        throw new Error("Invalid stash operation");
      });
    },
    async history(ctx, a) {
      const d = await desc2(ctx, a.workspaceId);
      const ref = String(a.ref || "ALL");
      if (ref !== "ALL" && ref !== "HEAD" && !ref.startsWith("refs/")) throw new Error("Select a branch or tag");
      const verified = ref === "ALL" ? null : await run(ctx, d, ["rev-parse", "--verify", `${ref}^{commit}`]);
      const skip = Math.max(0, Math.min(Number(a.skip) || 0, 1e5));
      const text = await run(ctx, d, ["log", "--topo-order", "-n", "100", `--skip=${skip}`, "--format=%H%x00%P%x00%an%x00%aI%x00%D%x00%s", ...verified ? [oid(verified.trim())] : ["--all"], "--"]);
      const commits = text.trim().split("\n").filter(Boolean).map((line) => {
        const [id, parents, author, date, refs, subject] = line.split("\0");
        return { id, parents: parents.split(" ").filter(Boolean), author, date, refs, subject };
      });
      const tags = await run(ctx, d, ["for-each-ref", "--format=%(refname)", "refs/tags/"]);
      return { workspaceId: d.id, commits, tags: tags.trim().split("\n").filter(Boolean), more: commits.length === 100 };
    },
    async commitDiff(ctx, a) {
      const d = await desc2(ctx, a.workspaceId), id = oid(a.id);
      const text = await run(ctx, d, ["show", "--format=", "--root", "--first-parent", "--no-ext-diff", "--no-textconv", "-M", id, "--", "."]);
      return { workspaceId: d.id, document: await ctx.host.ui.documentOpen(d.id, text, "diff", { path: `${id.slice(0, 8)}.diff` }) };
    },
    async taskChanges(ctx, a) {
      const d = await desc2(ctx, a.workspaceId);
      const key = `git.taskBase.${d.id}`;
      let base2 = await ctx.modules.call("persistence", "settings.get", { key });
      if (!base2 && d.id.startsWith("task:")) {
        const task = await ctx.modules.call("persistence", "tasks.get", { id: d.id.slice(5) });
        if (task?.createdAt) {
          const log = await git2(ctx, d, ["reflog", "show", "--date=unix", "--format=%H%x09%gD%x09%gs", "HEAD"]);
          const rows = log.stdout.split("\n").filter(Boolean).map((row) => row.split("	"));
          const first = rows[rows.length - 1], reset = rows[rows.length - 2];
          const time = first?.[1]?.match(/^HEAD@\{(\d+)\}$/)?.[1];
          const age = time ? Date.parse(task.createdAt) / 1e3 - Number(time) : NaN;
          if (log.code === 0 && !log.truncated && first?.[2] === "" && reset?.[0] === first[0] && reset?.[2] === "reset: moving to HEAD" && age >= -2 && age < 900) {
            base2 = oid(first[0]);
            await ctx.modules.call("persistence", "settings.set", { key, value: base2 });
          }
        }
      }
      if (!base2) return { workspaceId: d.id, base: null, files: [], message: "This task predates baseline tracking. Choose a starting commit to compare." };
      const reference = oid(base2);
      const raw = await run(ctx, d, ["diff", "--name-status", "-z", "--no-renames", reference, "--", "."]);
      const prefix = (await run(ctx, d, ["rev-parse", "--show-prefix"])).trim();
      const parts = raw.split("\0"), files = [];
      for (let i = 0; i + 1 < parts.length; i += 2) {
        const kind = { A: "added", D: "deleted", M: "modified", T: "typechange" }[parts[i]] || "modified";
        const path = parts[i + 1];
        if (path.startsWith(prefix)) files.push({ path: path.slice(prefix.length), kind, origPath: null });
      }
      const untracked = await run(ctx, d, ["ls-files", "--others", "--exclude-standard", "-z", "--", "."]);
      for (const path of untracked.split("\0").filter(Boolean)) if (!files.some((f) => f.path === path)) files.push({ path, kind: "untracked", origPath: null });
      return { workspaceId: d.id, base: reference, files };
    },
    async setTaskBase(ctx, a) {
      const d = await desc2(ctx, a.workspaceId);
      if (!d.id.startsWith("task:")) throw new Error("Select a task workspace");
      const id = oid(a.id);
      await run(ctx, d, ["cat-file", "-e", `${id}^{commit}`]);
      const key = `git.taskBase.${d.id}`;
      if (await ctx.modules.call("persistence", "settings.get", { key })) throw new Error("This task already has a fixed baseline");
      await ctx.modules.call("persistence", "settings.set", { key, value: id });
      ctx.events.emit("git.changed", { workspaceId: d.id });
    }
  };
}

// modules/services/git/src/index.ts
var EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
var MAX_PATCH_BYTES = 4 * 1024 * 1024;
var docCache = /* @__PURE__ */ new Map();
async function desc(ctx, workspaceId) {
  return ctx.modules.call("workspace", "resolve", { workspaceId });
}
async function git(ctx, d, args, limitBytes = MAX_PATCH_BYTES) {
  return withWorkspace(ctx, d, async () => {
    const g = await workspaceGrant(ctx, d, "process");
    return ctx.host.process.run(g.grant, {
      target: await targetFor(ctx, d),
      executable: "git",
      args: [...args[0] === "stash" ? [] : ["--literal-pathspecs"], "--no-optional-locks", "-c", "core.quotepath=false", "-c", "color.ui=false", ...args],
      cwd: d.rootAbsolutePath,
      loginShell: d.location === "ssh"
    }, { timeoutMs: 3e4, limitBytes });
  });
}
function fail(r, what) {
  throw new Error(`${what} failed (exit ${r.code}): ${(r.stderr || r.stdout).trim().slice(0, 600)}`);
}
async function checkedBase(ctx, d, value) {
  if (!/^[0-9a-f]{40,64}$/.test(value)) throw new Error("Invalid comparison commit");
  const r = await git(ctx, d, ["rev-parse", "--verify", `${value}^{commit}`]);
  if (r.code !== 0) fail(r, "Resolve comparison commit");
  return r.stdout.trim();
}
async function base(ctx, d) {
  const head = await git(ctx, d, ["rev-parse", "--verify", "-q", "HEAD"]);
  return head.code === 0 ? "HEAD" : EMPTY_TREE;
}
function cleanRel(p) {
  const s = String(p || "");
  if (!s || s.startsWith("/") || s.split("/").includes("..")) throw new Error("path must be workspace-relative");
  return s;
}
var MAX_SNAPSHOT_BYTES = 1024 * 1024;
var snapshots = /* @__PURE__ */ new Map();
var latest = /* @__PURE__ */ new Map();
var latestQueue = /* @__PURE__ */ new Map();
var GONE = { size: -1, mtime: null, text: null, binary: false };
async function statSeen(ctx, grant, path) {
  try {
    const st = await ctx.host.fs.stat(grant, path);
    return st.kind === "file" ? { size: st.size, mtime: st.mtime, text: null, binary: st.size > MAX_SNAPSHOT_BYTES } : GONE;
  } catch {
    return GONE;
  }
}
async function readSeen(ctx, grant, path, st) {
  if (st.size < 0 || st.binary) return st;
  try {
    const r = await ctx.host.fs.read(grant, path, MAX_SNAPSHOT_BYTES);
    return { ...st, text: r.binary || r.truncated ? null : r.text ?? "", binary: r.binary || r.truncated };
  } catch {
    return GONE;
  }
}
var missing = (s) => s.size < 0;
async function headText(ctx, d, repoPath) {
  const r = await git(ctx, d, ["show", `HEAD:${repoPath}`], MAX_SNAPSHOT_BYTES);
  return r.code === 0 && !r.truncated ? r.stdout : null;
}
function filePatch(path, before, after) {
  const b = before && !missing(before) ? before : null, a = missing(after) ? null : after;
  if (b?.binary || a?.binary) {
    if (b && a && b.size === a.size && b.mtime === a.mtime) return "";
    return `diff --git a/${path} b/${path}
Binary files ${b ? "a/" + path : "/dev/null"} and ${a ? "b/" + path : "/dev/null"} differ
`;
  }
  return unifiedPatch(path, b ? b.text : null, a ? a.text : null);
}
function setLatest(ctx, workspaceId, next) {
  const prev = latest.get(workspaceId)?.document;
  latest.set(workspaceId, next);
  if (prev && prev !== next.document) setTimeout(() => {
    void ctx.host.resources.release(prev).catch(() => {
    });
  }, 5e3);
}
async function computeLatest(ctx, workspaceId) {
  const d = await desc(ctx, workspaceId);
  const prefixR = await git(ctx, d, ["rev-parse", "--show-prefix"]);
  if (prefixR.code !== 0) return { workspaceId: d.id, repo: false, document: null, files: [], at: null, baseline: false, empty: true };
  const prefix = prefixR.stdout.trim();
  const st = await git(ctx, d, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."]);
  if (st.code !== 0) fail(st, "git status");
  const changes = parseStatus(st.stdout).filter((c) => c.path.startsWith(prefix)).map((c) => ({ ...c, path: c.path.slice(prefix.length) }));
  const kinds = new Map(changes.map((c) => [c.path, c.kind]));
  const grant = (await workspaceGrant(ctx, d, "fs")).grant;
  let snap = snapshots.get(d.id);
  const candidates = /* @__PURE__ */ new Set([...kinds.keys(), ...snap?.keys() || []]);
  const stats = /* @__PURE__ */ new Map();
  for (const path of candidates) stats.set(path, await statSeen(ctx, grant, path));
  const newestMtime = Math.max(0, ...[...stats.values()].map((x) => x.mtime ?? 0));
  const current = /* @__PURE__ */ new Map();
  for (const [path, st2] of stats) {
    const before = snap?.get(path);
    const unchanged = before && before.size === st2.size && before.mtime === st2.mtime && st2.mtime !== null && st2.mtime < newestMtime - 2;
    current.set(path, unchanged ? before : await readSeen(ctx, grant, path, st2));
  }
  if (!snap) {
    snapshots.set(d.id, new Map([...current].filter(([p]) => kinds.has(p))));
    const newest = [...current].filter(([p]) => kinds.has(p)).sort((x, y) => (y[1].mtime ?? 0) - (x[1].mtime ?? 0))[0];
    let text = "";
    if (newest) {
      const [path, after] = newest;
      const base2 = kinds.get(path) === "untracked" || kinds.get(path) === "added" ? null : await headText(ctx, d, prefix + path);
      text = filePatch(path, base2 === null ? null : { size: base2.length, mtime: null, text: base2, binary: false }, after);
    }
    const result2 = {
      document: text ? await ctx.host.ui.documentOpen(d.id, text, "diff", { path: "latest.diff" }) : null,
      files: newest ? [newest[0]] : [],
      at: newest?.[1].mtime ? new Date(newest[1].mtime * 1e3).toISOString() : null,
      baseline: true,
      empty: !text
    };
    setLatest(ctx, d.id, result2);
    return { workspaceId: d.id, repo: true, ...result2 };
  }
  const patches = [], files = [];
  for (const [path, after] of current) {
    const before = snap.get(path);
    if (before === after) continue;
    let prev = before ?? null;
    if (!before) {
      const base2 = kinds.get(path) === "untracked" ? null : await headText(ctx, d, prefix + path);
      prev = base2 === null ? null : { size: base2.length, mtime: null, text: base2, binary: false };
    }
    const patch = filePatch(path, prev, after);
    if (patch) {
      patches.push(patch);
      files.push(path);
    }
  }
  snap = new Map([...current].filter(([p]) => kinds.has(p)));
  snapshots.set(d.id, snap);
  if (patches.length) {
    const text = patches.join("");
    setLatest(ctx, d.id, { document: await ctx.host.ui.documentOpen(d.id, text, "diff", { path: "latest.diff" }), files, at: (/* @__PURE__ */ new Date()).toISOString(), baseline: false, empty: false });
  }
  const result = latest.get(d.id);
  return { workspaceId: d.id, repo: true, ...result };
}
var watchers = [];
var selection = 0;
var selectedId = null;
var changeTimer = null;
function changed(ctx, workspaceId) {
  if (changeTimer) clearTimeout(changeTimer);
  changeTimer = setTimeout(() => ctx.events.emit("git.changed", { workspaceId }), 200);
}
async function watchSelected(ctx) {
  const id = ctx.state.get("workspace.selected")?.id || null;
  if (id === selectedId) return;
  selectedId = id;
  const mine = ++selection;
  const previous = watchers;
  watchers = [];
  await Promise.all(previous.map((w) => w.stop()));
  if (!id || mine !== selection) return;
  try {
    const d = await desc(ctx, id);
    const roots = await git(ctx, d, ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"]);
    if (mine !== selection || roots.code !== 0) return;
    for (const root of new Set(roots.stdout.trim().split("\n").filter(Boolean))) {
      const watcher = fileWatch(ctx, (workspaceId) => changed(ctx, workspaceId));
      watchers.push(watcher);
      await watcher.select(d, root);
      if (mine !== selection) {
        await watcher.stop();
        return;
      }
    }
  } catch (e) {
    ctx.log.warn(`Git watcher: ${String(e)}`);
  }
}
var mod = {
  id: "git",
  moduleApiVersion: 1,
  async activate(ctx) {
    ctx.events.on("files.changed", (event) => {
      if (event.workspaceId === selectedId) changed(ctx, event.workspaceId);
    });
    ctx.state.watch("workspace.selected", () => {
      void watchSelected(ctx);
    });
    await watchSelected(ctx);
  },
  async deactivate() {
    selection++;
    if (changeTimer) clearTimeout(changeTimer);
    await Promise.all(watchers.map((w) => w.stop()));
    watchers = [];
  },
  methods: {
    ...gitOperations({ desc, git, fail, cleanRel }),
    /** Local/remote branches and HEAD, without fetching or changing the repository. */
    async branches(ctx, a) {
      const d = await desc(ctx, a.workspaceId);
      return { workspaceId: d.id, ...await listBranches((args) => git(ctx, d, args)) };
    },
    /** Git itself refuses overwriting local changes or taking another worktree's branch. */
    async checkout(ctx, a) {
      const d = await desc(ctx, a.workspaceId);
      await checkoutBranch((args) => git(ctx, d, args), a.ref);
      snapshots.delete(d.id);
      ctx.events.emit("git.changed", { workspaceId: d.id, worktreeChanged: true });
      return { workspaceId: d.id, ...await listBranches((args) => git(ctx, d, args)) };
    },
    async createBranch(ctx, a) {
      const d = await desc(ctx, a.workspaceId);
      await createBranch((args) => git(ctx, d, args), a.name, a.from);
      snapshots.delete(d.id);
      ctx.events.emit("git.changed", { workspaceId: d.id, worktreeChanged: true });
      return { workspaceId: d.id, ...await listBranches((args) => git(ctx, d, args)) };
    },
    async renameBranch(ctx, a) {
      const d = await desc(ctx, a.workspaceId);
      await renameBranch((args) => git(ctx, d, args), a.ref, a.name);
      ctx.events.emit("git.changed", { workspaceId: d.id });
      return { workspaceId: d.id, ...await listBranches((args) => git(ctx, d, args)) };
    },
    async deleteBranch(ctx, a) {
      const d = await desc(ctx, a.workspaceId);
      await deleteBranch((args) => git(ctx, d, args), a.ref);
      ctx.events.emit("git.changed", { workspaceId: d.id });
      return { workspaceId: d.id, ...await listBranches((args) => git(ctx, d, args)) };
    },
    async publishBranch(ctx, a) {
      const d = await desc(ctx, a.workspaceId);
      await publishBranch((args) => git(ctx, d, args), a.ref, a.remote);
      ctx.events.emit("git.changed", { workspaceId: d.id });
      return { workspaceId: d.id, ...await listBranches((args) => git(ctx, d, args)) };
    },
    async setUpstream(ctx, a) {
      const d = await desc(ctx, a.workspaceId);
      await setBranchUpstream((args) => git(ctx, d, args), a.ref, a.upstream);
      ctx.events.emit("git.changed", { workspaceId: d.id });
      return { workspaceId: d.id, ...await listBranches((args) => git(ctx, d, args)) };
    },
    /** Changed files in the working tree (staged, unstaged and untracked) with line counts. */
    async status(ctx, a) {
      const d = await desc(ctx, a.workspaceId);
      const prefixR = await git(ctx, d, ["rev-parse", "--show-prefix"]);
      if (prefixR.code !== 0) return { workspaceId: d.id, repo: false, branch: null, files: [] };
      const prefix = prefixR.stdout.trim();
      const rel = (p) => p == null ? null : p.startsWith(prefix) ? p.slice(prefix.length) : null;
      const branchR = await git(ctx, d, ["symbolic-ref", "--short", "-q", "HEAD"]);
      const st = await git(ctx, d, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."]);
      if (st.code !== 0) fail(st, "git status");
      const files = parseStatus(st.stdout).flatMap((f) => {
        const path = rel(f.path);
        return path ? [{ ...f, path, origPath: rel(f.origPath) }] : [];
      });
      const ns = await git(ctx, d, ["diff", "--numstat", "-z", "-M", await base(ctx, d), "--", "."]);
      if (ns.code === 0) {
        const counts = parseNumstat(ns.stdout);
        for (const f of files) Object.assign(f, counts.get(prefix + f.path) || {});
      }
      const upstream = await git(ctx, d, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
      const distance = upstream.code === 0 ? await git(ctx, d, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]) : null;
      const [ahead, behind] = distance?.code === 0 ? distance.stdout.trim().split(/\s+/).map(Number) : [0, 0];
      return {
        workspaceId: d.id,
        repo: true,
        branch: branchR.code === 0 ? branchR.stdout.trim() : "(detached)",
        upstream: upstream.code === 0 ? upstream.stdout.trim() : null,
        ahead,
        behind,
        truncated: st.truncated,
        files
      };
    },
    /** A file's committed (HEAD) text for editor change markers. `tracked: false` for files not in
     *  HEAD (new/untracked) or outside a repository; `text: null` when binary or too large. */
    async headText(ctx, a) {
      const d = await desc(ctx, a.workspaceId);
      const path = cleanRel(a.path);
      const prefixR = await git(ctx, d, ["rev-parse", "--show-prefix"]);
      if (prefixR.code !== 0) return { workspaceId: d.id, path, tracked: false, text: null };
      const repoPath = prefixR.stdout.trim() + path;
      const exists = await git(ctx, d, ["cat-file", "-e", `HEAD:${repoPath}`]);
      if (exists.code !== 0) return { workspaceId: d.id, path, tracked: false, text: null };
      const text = await headText(ctx, d, repoPath);
      return { workspaceId: d.id, path, tracked: true, text: text !== null && text.includes("\0") ? null : text };
    },
    /** Patch for one file against HEAD (working tree incl. staged changes) as a document handle. */
    async diff(ctx, a) {
      const d = await desc(ctx, a.workspaceId);
      const path = cleanRel(a.path);
      const st = await git(ctx, d, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", path]);
      if (st.code !== 0) fail(st, "git status");
      const change = parseStatus(st.stdout)[0];
      const prefix = (await git(ctx, d, ["rev-parse", "--show-prefix"])).stdout.trim();
      const orig = change?.origPath?.startsWith(prefix) ? change.origPath.slice(prefix.length) : null;
      let r;
      if (change?.kind === "untracked") {
        r = await git(ctx, d, ["diff", "--no-index", "--no-ext-diff", "--", "/dev/null", path]);
        if (r.code !== 0 && r.code !== 1) fail(r, "git diff --no-index");
      } else {
        r = await git(ctx, d, ["diff", "--no-ext-diff", "-M", a.base ? await checkedBase(ctx, d, a.base) : await base(ctx, d), "--", ...orig ? [orig] : [], path]);
        if (r.code !== 0) fail(r, "git diff");
      }
      const text = r.stdout;
      const key = `${d.id}|${path}`;
      const cached = docCache.get(key);
      const document = cached && cached.text === text ? cached.document : await ctx.host.ui.documentOpen(d.id, text, "diff", { path });
      docCache.set(key, { text, document });
      return { workspaceId: d.id, path, kind: change?.kind || null, document, empty: !text.trim(), truncated: r.truncated };
    },
    /** Only what changed since the previous call (the most recent update), as one patch. */
    latestChange(ctx, a) {
      const id = String(a.workspaceId);
      const next = (latestQueue.get(id) || Promise.resolve()).catch(() => {
      }).then(() => computeLatest(ctx, id));
      latestQueue.set(id, next);
      void next.finally(() => {
        if (latestQueue.get(id) === next) latestQueue.delete(id);
      }).catch(() => {
      });
      return next;
    },
    /** One patch of every working-tree change against HEAD (tracked, staged and untracked). */
    async diffAll(ctx, a) {
      const d = await desc(ctx, a.workspaceId);
      const prefixR = await git(ctx, d, ["rev-parse", "--show-prefix"]);
      if (prefixR.code !== 0) return { workspaceId: d.id, repo: false, document: null, files: 0, empty: true, truncated: false };
      const prefix = prefixR.stdout.trim();
      const tracked = await git(ctx, d, ["diff", "--no-ext-diff", "-M", await base(ctx, d), "--", "."]);
      if (tracked.code !== 0) fail(tracked, "git diff");
      let text = tracked.stdout, truncated = tracked.truncated;
      const st = await git(ctx, d, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."]);
      if (st.code !== 0) fail(st, "git status");
      const changes = parseStatus(st.stdout);
      const maxUntracked = Math.min(Math.max(Number(a.maxUntracked) || 100, 0), 500);
      const untracked = changes.filter((c) => c.kind === "untracked" && c.path.startsWith(prefix)).map((c) => c.path.slice(prefix.length));
      for (const path of untracked.slice(0, maxUntracked)) {
        if (text.length >= MAX_PATCH_BYTES) {
          truncated = true;
          break;
        }
        const r = await git(ctx, d, ["diff", "--no-index", "--no-ext-diff", "--", "/dev/null", path], MAX_PATCH_BYTES - text.length);
        if (r.code !== 0 && r.code !== 1) continue;
        if (r.stdout) text += (text && !text.endsWith("\n") ? "\n" : "") + r.stdout;
        truncated || (truncated = r.truncated);
      }
      if (untracked.length > maxUntracked) truncated = true;
      const key = `${d.id}|*all*`;
      const cached = docCache.get(key);
      const document = cached && cached.text === text ? cached.document : await ctx.host.ui.documentOpen(d.id, text, "diff", { path: "changes.diff" });
      docCache.set(key, { text, document });
      return { workspaceId: d.id, repo: true, document, files: changes.length, empty: !text.trim(), truncated };
    }
  }
};
var index_default = mod;
export {
  index_default as default
};
