// modules/services/opencode-provider/src/index.ts
var sshTargets = /* @__PURE__ */ new Map();
async function executionTarget(ctx, desc) {
  if (desc.location === "local") return { kind: "local" };
  if (desc.location === "cloud") {
    if (!desc.cloudHostId) throw new Error("Cloud workspace is missing its host");
    return ctx.modules.call("cloud", "target", { hostId: desc.cloudHostId, machineId: desc.machineId }, { timeoutMs: 62e4 });
  }
  if (!desc.ssh) throw new Error("SSH workspace is missing its connection profile");
  let target = sshTargets.get(desc.machineId);
  if (!target) {
    const ssh = desc.ssh;
    target = ctx.host.ssh.connect({
      profileId: ssh.profileId,
      host: ssh.host,
      port: ssh.port,
      user: ssh.user,
      identityFile: ssh.identityFile ?? null,
      transport: ssh.transport ?? "ssh",
      ...ssh.auth ? { auth: ssh.auth } : {}
    }).then((connection) => ({ kind: "ssh", connection: connection.connection, machineId: connection.machineId }));
    sshTargets.set(desc.machineId, target);
    target.catch(() => sshTargets.delete(desc.machineId));
  }
  return target;
}
function meter(value, id, label) {
  if (!value || typeof value.percent !== "number" || !Number.isFinite(value.percent)) return null;
  return {
    id,
    label,
    usedPercent: Math.max(0, Math.min(100, value.percent)),
    resetsAt: typeof value.resetsAt === "number" && Number.isFinite(value.resetsAt) ? value.resetsAt : null,
    resetsText: null
  };
}
function parseLimitsText(text) {
  const envelope = JSON.parse(text);
  const info = envelope?.data === void 0 ? envelope : envelope.data;
  if (info === null) {
    return { provider: "opencode", windows: [], plan: null, updatedAt: Date.now(), source: "probe", error: "Connect OpenCode Console to see plan usage" };
  }
  const go = info?.go;
  const windows = [
    meter(go?.rolling, "five_hour", "5h"),
    meter(go?.weekly, "seven_day", "Wk"),
    meter(go?.monthly, "monthly", "Mo")
  ].filter((value) => !!value);
  const workspace = typeof info?.workspace?.name === "string" && info.workspace.name.trim() ? info.workspace.name.trim() : null;
  return {
    provider: "opencode",
    windows,
    plan: workspace ? `${workspace} · OpenCode Go` : go ? "OpenCode Go" : null,
    updatedAt: Date.now(),
    source: "probe",
    error: windows.length ? null : "No OpenCode Go allowance was reported for this workspace"
  };
}
function errorText(error) {
  return error?.message || String(error);
}
var API_ARGS = ["api", "experimental.usage.limits"];
var MISSING = /not found|no such file|ENOENT|cannot find|not recognized/i;
var FALLBACK_SCRIPT = [
  'export PATH="$HOME/.opencode/bin:$HOME/.bun/bin:$HOME/.local/bin:$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"',
  // Version managers are usually initialized only by interactive rc files.
  `if ! command -v opencode >/dev/null 2>&1; then P=$("\${SHELL:-/bin/sh}" -ic 'printf "\\n__HATO_PATH__=%s\\n" "$PATH"' </dev/null 2>/dev/null | sed -n "s/^__HATO_PATH__=//p" | tail -n 1); [ -n "$P" ] && export PATH="$P:$PATH"; fi`,
  'if ! command -v opencode >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1; fi',
  'exec opencode "$@"'
].join("; ");
var index_default = {
  id: "opencode-provider",
  moduleApiVersion: 1,
  methods: {
    parseLimits: (_ctx, a) => parseLimitsText(a.text),
    sessionLimits: () => null,
    async limits(ctx, a) {
      const desc = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
      const target = await executionTarget(ctx, desc);
      const grant = await ctx.host.capabilities.request({ kind: "process", root: desc.rootAbsolutePath, target });
      const executablePath = a.executablePath;
      const run = (executable, args, loginShell) => ctx.host.process.run(grant.grant, {
        target,
        executable,
        args,
        cwd: a.cwd ?? desc.rootAbsolutePath,
        ...a.env === void 0 ? {} : { env: a.env },
        envRemove: a.envRemove ?? [],
        loginShell
      }, { timeoutMs: 3e4, limitBytes: 1e6 });
      try {
        let result;
        try {
          result = await run(executablePath ?? "opencode", API_ARGS, desc.location !== "local");
          if (result.code === 127) throw new Error(result.stderr);
        } catch (error) {
          if (executablePath != null || !MISSING.test(errorText(error))) throw error;
          const retry = await run("sh", ["-c", FALLBACK_SCRIPT, "sh", ...API_ARGS], desc.location !== "local").catch((e) => e);
          if (retry instanceof Error || retry.code === 127) {
            throw new Error(`${errorText(error)} (PATH fallback failed: ${retry instanceof Error ? retry.message : retry.stderr.trim()})`);
          }
          result = retry;
        }
        if (result.code !== 0) throw new Error(result.stderr.trim() || `opencode api exited with code ${result.code}`);
        if (result.truncated) throw new Error("OpenCode usage response was truncated");
        return parseLimitsText(result.stdout);
      } catch (error) {
        throw new Error(`OpenCode plan usage is unavailable: ${errorText(error)}`);
      } finally {
        await ctx.host.capabilities.release(grant.grant).catch(() => {
        });
      }
    }
  }
};
export {
  index_default as default
};
