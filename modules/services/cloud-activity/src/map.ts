/** Agent-runner session fields this module reads. Anything else is ignored. */
export interface RunnerSession {
  id: string;
  name?: string;
  status: "starting" | "ready" | "busy" | "waiting" | "stopped" | "interrupted" | "error";
  createdAt?: string;
  updatedAt?: string;
  error?: string | null;
  workspaceId?: string;
  profile?: { name?: string; provider?: string; label?: string } | null;
  workflow?: unknown;
}

export type ActivityState = "running" | "attention" | "completed" | "failed" | "cancelled";

export interface ActivityItem {
  id: string;
  kind: "agent" | "workflow";
  title: string;
  state: ActivityState;
  detail: string | null;
  source: string | null;
  startedAt: string;
  updatedAt: string;
}

/** Last exported state per session, so "busy → ready" can be reported as completed. */
export interface Remembered { state: ActivityState; worked: boolean; at: string }

const MAX_FINISHED = 100;
const SAFE = /[^\p{L}\p{N} ._\-·:()/#+&]/gu;

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(SAFE, "").replace(/\s+/g, " ").trim().slice(0, max);
  return text || null;
}

function stateOf(status: RunnerSession["status"], previous: Remembered | undefined): { state: ActivityState; worked: boolean } {
  switch (status) {
    case "starting": return { state: "running", worked: false };
    case "busy": return { state: "running", worked: true };
    case "waiting": return { state: "attention", worked: true };
    case "error": return { state: "failed", worked: false };
    case "stopped":
    case "interrupted": return { state: "cancelled", worked: false };
    case "ready":
    default:
      return { state: "completed", worked: previous?.worked ?? false };
  }
}

/** Map runner sessions to allowlisted activity items. Idle sessions that never ran are omitted. */
export function activityItems(sessions: RunnerSession[], remembered: Map<string, Remembered>, now: string): ActivityItem[] {
  const items: ActivityItem[] = [];
  const seen = new Set<string>();
  for (const session of sessions) {
    if (!session || typeof session.id !== "string") continue;
    const id = session.id.slice(0, 120);
    seen.add(id);
    const previous = remembered.get(id);
    // A provider can fail a turn while leaving its ACP session ready for another prompt.
    const status = session.status === "ready" && session.error ? "error" : session.status;
    const { state, worked } = stateOf(status, previous);
    // Never-used idle sessions are noise on the overview.
    if (status === "ready" && !worked) continue;
    const at = state === previous?.state ? previous.at : (session.updatedAt ?? now);
    remembered.set(id, { state, worked, at });
    items.push({
      id,
      kind: session.workflow ? "workflow" : "agent",
      title: clean(session.name, 120) ?? "Agent",
      state,
      detail: state === "attention" ? "Waiting for you" : state === "failed" ? "Stopped with an error" : null,
      source: clean(session.profile?.label ?? session.profile?.name ?? session.profile?.provider, 40),
      startedAt: session.createdAt ?? at,
      updatedAt: at,
    });
  }
  for (const id of [...remembered.keys()]) if (!seen.has(id)) remembered.delete(id);
  const live = items.filter((item) => item.state === "running" || item.state === "attention");
  const finished = items
    .filter((item) => item.state !== "running" && item.state !== "attention")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, MAX_FINISHED);
  return [...live, ...finished];
}
