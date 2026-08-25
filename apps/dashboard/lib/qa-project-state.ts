import type { ProjectVerdict, QaProjectRow, RestartVerdict } from "./types";

/**
 * Which single action a project strip should offer, and what to call it.
 *
 * Pure and separate from the component because the interesting part is the
 * decision, not the markup: the phone shows one primary button, so choosing
 * which one is the whole design. Keeping it here means it can be tested
 * without rendering anything.
 */

export type StripPhase =
  /** Nothing done to this project in this session yet. */
  | "idle"
  /** A pull landed in this session; the verdict is now about what arrived. */
  | "pulled"
  /** Services were restarted in this session. */
  | "restarted";

export type StripAction = "fetch" | "pull" | "restart" | "switch" | "none";

export interface StripState {
  /** What the primary button does. `none` means there is nothing safe to offer. */
  action: StripAction;
  label: string;
  /** Drives the button's colour: go = safe/done, act = the thing to do now, stop = refused. */
  tone: "go" | "act" | "stop" | "quiet";
  /** One line under the button explaining the state. */
  detail: string;
  /** Fetch is safe in almost every state, so it is offered alongside. */
  offerFetch: boolean;
  /** Shown as a secondary "Restart anyway" when a restart is possible but unneeded. */
  offerRestartAnyway: boolean;
  blocked: boolean;
}

/** Refs older than this are treated as not yet answering "did my merge land?". */
export const STALE_REFS_MS = 2 * 60 * 1000;

const RESTART_WORTHY: RestartVerdict[] = ["install-and-restart", "restart", "unknown"];

export function needsRestart(verdict: ProjectVerdict | null): boolean {
  return verdict !== null && RESTART_WORTHY.includes(verdict.verdict);
}

export function refsAreStale(fetchedAt: string | null, now: Date = new Date()): boolean {
  if (!fetchedAt) return true;
  const at = Date.parse(fetchedAt);
  return Number.isNaN(at) || now.getTime() - at > STALE_REFS_MS;
}

/** "3 hours ago", "just now" — never a bare zero with no age attached. */
export function describeAge(fetchedAt: string | null, now: Date = new Date()): string {
  if (!fetchedAt) return "never checked";
  const at = Date.parse(fetchedAt);
  if (Number.isNaN(at)) return "never checked";
  const seconds = Math.max(0, Math.round((now.getTime() - at) / 1000));
  if (seconds < 45) return "checked just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `checked ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `checked ${hours}h ago`;
  return `checked ${Math.round(hours / 24)}d ago`;
}

export function stripState(
  row: QaProjectRow,
  phase: StripPhase,
  now: Date = new Date()
): StripState {
  const age = describeAge(row.fetchedAt, now);
  const behind = row.behind ?? 0;
  const ahead = row.ahead ?? 0;

  // Unreadable checkout: nothing here is safe or meaningful, not even a fetch.
  if (row.error && !row.head) {
    return blockedState(row.error, false);
  }

  // Dirt comes first now that a switch is on offer: it is the one state with
  // something to lose, and it blocks every write here, so it is the most
  // actionable thing to say regardless of which branch you are on.
  if (row.dirty) {
    return blockedState("Uncommitted changes. Commit or set them aside before pulling or switching.", true);
  }

  // Off the base branch, with a clean tree, the whole answer is one button.
  // Checkout destroys nothing — the branch left behind keeps its ref — so this
  // is offered rather than refused, unlike picking some arbitrary branch.
  if (row.branch === "HEAD") {
    return {
      action: "switch",
      label: `Switch to ${row.baseBranch}`,
      tone: "act",
      detail: `Detached HEAD. Switching to ${row.baseBranch} leaves the commits reachable and deletes nothing.`,
      offerFetch: true,
      offerRestartAnyway: false,
      blocked: false
    };
  }
  if (row.branch && !row.onBaseBranch) {
    return {
      action: "switch",
      label: `Switch to ${row.baseBranch}`,
      tone: "act",
      detail: `On \`${row.branch}\`. Switching leaves that branch exactly where it is — nothing is deleted or rewritten.`,
      offerFetch: true,
      offerRestartAnyway: false,
      blocked: false
    };
  }

  if (ahead > 0) {
    return blockedState(
      `${ahead} local commit${ahead === 1 ? "" : "s"} origin does not have. Push or reconcile before pulling.`,
      true
    );
  }

  // A pull landed this session and the services still need bouncing.
  if (phase === "pulled" && needsRestart(row.verdict)) {
    return {
      action: "restart",
      label: "Restart services",
      tone: "act",
      detail: row.verdict?.headline ?? "Restart needed.",
      offerFetch: false,
      offerRestartAnyway: false,
      blocked: false
    };
  }

  if (phase === "restarted") {
    return {
      action: "none",
      label: "Ready to test",
      tone: "go",
      detail: "Services restarted from the current checkout.",
      offerFetch: true,
      offerRestartAnyway: false,
      blocked: false
    };
  }

  if (phase === "pulled") {
    return {
      action: "none",
      label: "Ready to test",
      tone: "go",
      // Never "no restart needed" — HMR does miss things, which is why this exists.
      detail: row.verdict?.headline ?? "Pulled. HMR should cover this.",
      offerFetch: true,
      offerRestartAnyway: row.controllable,
      blocked: false
    };
  }

  if (behind > 0) {
    return {
      action: "pull",
      label: `Pull ${behind} commit${behind === 1 ? "" : "s"}`,
      tone: "act",
      detail: row.verdict?.headline ?? `${behind} waiting on origin/${row.baseBranch}.`,
      offerFetch: true,
      offerRestartAnyway: false,
      blocked: false
    };
  }

  if (refsAreStale(row.fetchedAt, now)) {
    return {
      action: "fetch",
      label: "Check for updates",
      tone: "act",
      detail: `Up to date with what we last saw — ${age}.`,
      offerFetch: false,
      offerRestartAnyway: row.controllable,
      blocked: false
    };
  }

  return {
    action: "none",
    label: `Up to date · ${age}`,
    tone: "quiet",
    detail: `Nothing waiting on origin/${row.baseBranch}.`,
    offerFetch: true,
    offerRestartAnyway: row.controllable,
    blocked: false
  };
}

function blockedState(detail: string, offerFetch: boolean): StripState {
  return { action: "none", label: "Cannot pull", tone: "stop", detail, offerFetch, offerRestartAnyway: false, blocked: true };
}
