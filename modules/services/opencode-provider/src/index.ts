import type { AppModule, ModuleContext } from '@hato/sdk/types';

interface LimitWindow {
  id: string;
  label: string;
  usedPercent: number;
  resetsAt: number | null;
  resetsText: string | null;
}
interface LimitsSnapshot {
  provider: 'opencode';
  windows: LimitWindow[];
  plan: string | null;
  updatedAt: number;
  source: 'probe';
  error: string | null;
}
interface WorkspaceDescriptor {
  id: string;
  location: 'local' | 'ssh' | 'cloud';
  cloudHostId?: string;
  machineId: string;
  rootAbsolutePath: string;
  ssh?: {
    profileId: string;
    host: string;
    port: number;
    user: string;
    identityFile?: string | null;
    transport?: 'ssh' | 'wsl';
    auth?: 'password';
  } | null;
}

const sshTargets = new Map<string, Promise<any>>();

async function executionTarget(ctx: ModuleContext, desc: WorkspaceDescriptor) {
  if (desc.location === 'local') return { kind: 'local' };
  if (desc.location === 'cloud') {
    if (!desc.cloudHostId) throw new Error('Cloud workspace is missing its host');
    return ctx.modules.call('cloud', 'target', { hostId: desc.cloudHostId, machineId: desc.machineId }, { timeoutMs: 620000 });
  }
  if (!desc.ssh) throw new Error('SSH workspace is missing its connection profile');
  let target = sshTargets.get(desc.machineId);
  if (!target) {
    const ssh = desc.ssh;
    target = ctx.host.ssh.connect({
      profileId: ssh.profileId,
      host: ssh.host,
      port: ssh.port,
      user: ssh.user,
      identityFile: ssh.identityFile ?? null,
      transport: ssh.transport ?? 'ssh',
      ...(ssh.auth ? { auth: ssh.auth } : {}),
    }).then((connection) => ({ kind: 'ssh', connection: connection.connection, machineId: connection.machineId }));
    sshTargets.set(desc.machineId, target);
    target.catch(() => sshTargets.delete(desc.machineId));
  }
  return target;
}

function meter(value: any, id: string, label: string): LimitWindow | null {
  if (!value || typeof value.percent !== 'number' || !Number.isFinite(value.percent)) return null;
  return {
    id,
    label,
    usedPercent: Math.max(0, Math.min(100, value.percent)),
    resetsAt: typeof value.resetsAt === 'number' && Number.isFinite(value.resetsAt) ? value.resetsAt : null,
    resetsText: null,
  };
}

function parseLimitsText(text: string): LimitsSnapshot {
  const envelope = JSON.parse(text);
  const info = envelope?.data === undefined ? envelope : envelope.data;
  if (info === null) {
    return { provider: 'opencode', windows: [], plan: null, updatedAt: Date.now(), source: 'probe', error: 'Connect OpenCode Console to see plan usage' };
  }
  const go = info?.go;
  const windows = [
    meter(go?.rolling, 'five_hour', '5h'),
    meter(go?.weekly, 'seven_day', 'Wk'),
    meter(go?.monthly, 'monthly', 'Mo'),
  ].filter((value): value is LimitWindow => !!value);
  const workspace = typeof info?.workspace?.name === 'string' && info.workspace.name.trim()
    ? info.workspace.name.trim()
    : null;
  return {
    provider: 'opencode',
    windows,
    plan: workspace ? `${workspace} · OpenCode Go` : go ? 'OpenCode Go' : null,
    updatedAt: Date.now(),
    source: 'probe',
    error: windows.length ? null : 'No OpenCode Go allowance was reported for this workspace',
  };
}

function errorText(error: any): string {
  return error?.message || String(error);
}

const API_ARGS = ['api', 'experimental.usage.limits'];
const MISSING = /not found|no such file|ENOENT|cannot find|not recognized/i;
const FALLBACK_SCRIPT = [
  'export PATH="$HOME/.opencode/bin:$HOME/.bun/bin:$HOME/.local/bin:$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"',
  // Version managers are usually initialized only by interactive rc files.
  'if ! command -v opencode >/dev/null 2>&1; then P=$("${SHELL:-/bin/sh}" -ic \'printf "\\n__HATO_PATH__=%s\\n" "$PATH"\' </dev/null 2>/dev/null | sed -n "s/^__HATO_PATH__=//p" | tail -n 1); [ -n "$P" ] && export PATH="$P:$PATH"; fi',
  'if ! command -v opencode >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1; fi',
  'exec opencode "$@"',
].join('; ');

export default {
  id: 'opencode-provider',
  moduleApiVersion: 1,
  methods: {
    parseLimits: (_ctx, a) => parseLimitsText(a.text),
    sessionLimits: () => null,
    async limits(ctx, a) {
      const desc: WorkspaceDescriptor = await ctx.modules.call('workspace', 'resolve', { workspaceId: a.workspaceId });
      const target = await executionTarget(ctx, desc);
      const grant = await ctx.host.capabilities.request({ kind: 'process', root: desc.rootAbsolutePath, target });
      const executablePath = a.executablePath;
      const run = (executable: string, args: string[], loginShell: boolean) => ctx.host.process.run(grant.grant, {
        target,
        executable,
        args,
        cwd: a.cwd ?? desc.rootAbsolutePath,
        ...(a.env === undefined ? {} : { env: a.env }),
        envRemove: a.envRemove ?? [],
        loginShell,
      }, { timeoutMs: 30000, limitBytes: 1_000_000 });
      try {
        let result: any;
        try {
          // Windows: acp passes node.exe plus the npm shim's entry script as leading arguments.
          const leading: string[] = Array.isArray(a.executableArgs) ? a.executableArgs.filter((x: unknown) => typeof x === 'string') : [];
          result = await run(executablePath ?? 'opencode', [...leading, ...API_ARGS], desc.location !== 'local');
          if (result.code === 127) throw new Error(result.stderr);
        } catch (error) {
          // An explicit path identifies the same binary/account as chat; only discover PATH when absent.
          if (executablePath != null || !MISSING.test(errorText(error)) || (desc.location === 'local' && ctx.host?.env?.info?.().platform === 'windows')) throw error;
          // GUI and non-interactive shells often miss npm/bun/nvm bin directories.
          const retry = await run('sh', ['-c', FALLBACK_SCRIPT, 'sh', ...API_ARGS], desc.location !== 'local').catch((e) => e);
          if (retry instanceof Error || retry.code === 127) {
            throw new Error(`${errorText(error)} (PATH fallback failed: ${retry instanceof Error ? retry.message : retry.stderr.trim()})`);
          }
          result = retry;
        }
        if (result.code !== 0) throw new Error(result.stderr.trim() || `opencode api exited with code ${result.code}`);
        if (result.truncated) throw new Error('OpenCode usage response was truncated');
        return parseLimitsText(result.stdout);
      } catch (error) {
        throw new Error(`OpenCode plan usage is unavailable: ${errorText(error)}`);
      } finally {
        await ctx.host.capabilities.release(grant.grant).catch(() => {});
      }
    },
  },
} satisfies AppModule;
