// Per-machine limits for what the desktop sends to and keeps on a machine's daemon. Stored in the
// `machine:<id>` settings scope, so it syncs to the daemon with the other machine settings.
// These rules are applied by this module (what it pushes, what it cleans up); they are not a
// sandbox the daemon enforces on plugins that are already running there.

import { NO_AGENT_LIMITS, normalizeAgentLimits, type AgentLimits } from "@hato/sdk/persistent-agents";
import type { DaemonPolicy } from "@hato/sdk/types";

export const POLICY_KEY = "remote-runtime.policy";
/** Infrastructure every SSH daemon needs (machine-setting sync); never blocked by the allow list. */
export const ALWAYS_ALLOWED = new Set(["persistence"]);
export const IDLE_CHOICES = [0, 15, 60, 240, 1440];

export interface MachinePolicy {
  /** false ("Unlimited", the default): every limit below is ignored but kept for later. */
  limited: boolean;
  /** The daemon-enforced limits to restore when `limited` is turned on again. */
  enforced: DaemonPolicy | null;
  /** Which workspace plugins may run on this machine. */
  plugins: "all" | "selected" | "none";
  /** Plugin ids allowed when `plugins` is "selected". */
  allowed: string[];
  /** Nothing new is sent to the daemon; viewing and stopping still work. */
  readOnly: boolean;
  /** Stop terminals that stayed detached this long (minutes); 0 keeps them. */
  idleTerminalMinutes: number;
  /** Overrides the global "start the daemon" / "run workspace plugins" settings; null follows them. */
  autoStart: boolean | null;
  autoPush: boolean | null;
  /** Limits for persistent agents, applied by the agent runtime on the machine. */
  agents: AgentLimits;
}

export const NO_DAEMON_LIMITS: DaemonPolicy = { capabilityDeny: [], fsRoots: [], maxProcesses: 0, maxTerminals: 0, processMemoryMb: 0 };
export const DEFAULT_POLICY: MachinePolicy = { limited: false, enforced: null, plugins: "all", allowed: [], readOnly: false, idleTerminalMinutes: 0, autoStart: null, autoPush: null, agents: NO_AGENT_LIMITS };

export function normalizePolicy(value: unknown): MachinePolicy {
  const v: any = value && typeof value === "object" ? value : {};
  const e: any = v.enforced && typeof v.enforced === "object" ? v.enforced : null;
  const ids = (x: unknown) => Array.isArray(x) ? x.filter((i): i is string => typeof i === "string") : [];
  const count = (x: unknown) => Number.isInteger(x) && (x as number) > 0 ? x as number : 0;
  return {
    limited: v.limited === true,
    enforced: e ? { capabilityDeny: ids(e.capabilityDeny), fsRoots: ids(e.fsRoots), maxProcesses: count(e.maxProcesses), maxTerminals: count(e.maxTerminals), processMemoryMb: count(e.processMemoryMb) } : null,
    plugins: v.plugins === "selected" || v.plugins === "none" ? v.plugins : "all",
    allowed: Array.isArray(v.allowed) ? [...new Set(v.allowed.filter((id: unknown) => typeof id === "string" && id))] as string[] : [],
    readOnly: v.readOnly === true,
    idleTerminalMinutes: IDLE_CHOICES.includes(v.idleTerminalMinutes) ? v.idleTerminalMinutes : 0,
    autoStart: typeof v.autoStart === "boolean" ? v.autoStart : null,
    autoPush: typeof v.autoPush === "boolean" ? v.autoPush : null,
    agents: normalizeAgentLimits(v.agents),
  };
}

export function pluginAllowed(policy: MachinePolicy, id: string): boolean {
  if (ALWAYS_ALLOWED.has(id)) return true;
  return policy.plugins === "all" || (policy.plugins === "selected" && policy.allowed.includes(id));
}

/** Why a push of `id` is refused on this machine, or null when it may go. */
export function pushBlocked(policy: MachinePolicy, id: string): string | null {
  if (ALWAYS_ALLOWED.has(id)) return null;
  if (policy.readOnly) return "this machine is read-only";
  return pluginAllowed(policy, id) ? null : "not allowed on this machine";
}

/** Tracks how long each terminal has been seen detached and returns the keys past the limit.
 *  `seen` maps terminal key → first time it was observed detached; it is updated in place. */
export function expiredTerminals(
  ptys: { key: string; attached?: boolean }[], seen: Map<string, number>, now: number, minutes: number,
): string[] {
  const present = new Set(ptys.map(p => p.key));
  for (const key of [...seen.keys()]) if (!present.has(key)) seen.delete(key);
  const expired: string[] = [];
  for (const p of ptys) {
    if (p.attached) { seen.delete(p.key); continue; }
    const since = seen.get(p.key) ?? now;
    seen.set(p.key, since);
    if (minutes > 0 && now - since >= minutes * 60_000) expired.push(p.key);
  }
  return expired;
}

/** The rules actually applied: an unlimited machine allows everything. The daemon overrides
 *  (auto-start / auto-push) are preferences, not limits, so they apply either way. */
export function effectivePolicy(policy: MachinePolicy): MachinePolicy {
  return policy.limited ? policy : { ...DEFAULT_POLICY, autoStart: policy.autoStart, autoPush: policy.autoPush };
}
