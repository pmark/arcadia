import type { CapacityWindow } from "../codingAgents/capacity.js";

/**
 * Park and continue (Decisions 0181 and 0187). A leaf module: no database, no
 * model, no GitHub or Git write, no ping of its own. A failed condition parks
 * only that Action with a receipt; admission continues with the next Action
 * that does not depend on it; a night breaker pauses the affected lane or
 * project and says it must page. The caller owns persistence, delivery and
 * the pause itself.
 */

export const HOUR_MS = 3_600_000;
/** Every breaker count is over this rolling window, per project and lane. */
export const BREAKER_WINDOW_MS = 24 * HOUR_MS;
/** A park older than this is re-reviewed at its current head, never merged as recorded. */
export const PARK_NIGHT_MS = 12 * HOUR_MS;
export const BREAKER_PARK_LIMIT = 3;
/** Merges a lane may land in its first 24 hours; after that the limit is the second value. */
export const BREAKER_FIRST_DAY_MERGE_LIMIT = 3;
export const BREAKER_LATER_MERGE_LIMIT = 6;
/** Input tokens summed over a lane's Sessions in the window. */
export const BREAKER_LANE_INPUT_TOKEN_CEILING = 40_000_000;
/** Percent of the Claude 5-hour window at which the breaker trips. */
export const BREAKER_CLAUDE_FIVE_HOUR_PERCENT = 70;

/** Conditions that hold production; none of them is a park. */
export type HoldKind = "sign-in" | "capacity" | "outage";
export const HOLD_KINDS: readonly HoldKind[] = ["sign-in", "capacity", "outage"];

/** Why an Action was parked. `operator-cancel` is the operator's own stop. */
export type ParkCauseKind = "condition-failed" | "operator-cancel";

export interface ParkReceipt {
  actionKey: string;
  /** The failed condition, e.g. `C4` or `required-check:lint`. */
  condition: string;
  /** The cause; compared by equality for the same-cause-twice rule. */
  cause: string;
  causeKind: ParkCauseKind;
  project: string;
  lane: string;
  parkedAt: number;
  /** The candidate head at the park; null when no candidate existed. */
  head: string | null;
  /** Operator-cancel only: the reason the operator gave. */
  reason?: string;
  /** Operator-cancel only: the work is kept as a draft, never discarded. */
  preservedAs?: "draft";
}

/** The Action stays open: a park records, it never closes. */
export interface ParkState {
  parks: ParkReceipt[];
}

export type FailureOutcome =
  | { kind: "hold"; hold: HoldKind; reason: string }
  | { kind: "park"; state: ParkState; receipt: ParkReceipt; stopProduction: false }
  | { kind: "park"; state: ParkState; receipt: ParkReceipt; stopProduction: true; stopReason: string };

export interface FailedCondition {
  actionKey: string;
  condition: string;
  cause: string;
  project: string;
  lane: string;
  now: number;
  head?: string | null;
  /** Set when the failure is a sign-in, capacity or outage condition. */
  hold?: HoldKind;
  /** Main went red; stops production, never a single-Action park. */
  mainRed?: boolean;
}

/**
 * Decide what one failed condition does. Sign-in, capacity and outage are
 * holds (no receipt, no park count). Main going red stops production. A park
 * whose cause equals an earlier park's stops production too (same cause twice).
 */
export function recordFailedCondition(state: ParkState, failure: FailedCondition): FailureOutcome | { kind: "stop"; reason: string } {
  if (failure.mainRed) return { kind: "stop", reason: "main went red" };
  if (failure.hold) return { kind: "hold", hold: failure.hold, reason: `${failure.hold} hold on ${failure.actionKey}: ${failure.cause}` };
  const receipt: ParkReceipt = {
    actionKey: failure.actionKey,
    condition: failure.condition,
    cause: failure.cause,
    causeKind: "condition-failed",
    project: failure.project,
    lane: failure.lane,
    parkedAt: failure.now,
    head: failure.head ?? null
  };
  const repeated = state.parks.find((p) => p.causeKind === "condition-failed" && p.cause === failure.cause && p.actionKey !== failure.actionKey && failure.now - p.parkedAt < BREAKER_WINDOW_MS);
  const next: ParkState = { parks: [...state.parks.filter((p) => p.actionKey !== failure.actionKey), receipt] };
  if (repeated) return { kind: "park", state: next, receipt, stopProduction: true, stopReason: `the same cause twice (${failure.cause}): ${repeated.actionKey} then ${failure.actionKey}` };
  return { kind: "park", state: next, receipt, stopProduction: false };
}

export interface AdmissionAction {
  key: string;
  status: "open" | "done";
  dependsOn: readonly string[];
}

export interface AdmissionResult {
  /** The next Action to admit, or null when none is independent of every park. */
  admit: string | null;
  /** Open Actions skipped because they are parked or depend, transitively, on a parked Action. */
  skipped: Array<{ key: string; reason: string }>;
}

/** Admit the first open, unparked Action that does not depend on a parked or unfinished one. */
export function admitNextIndependent(actions: readonly AdmissionAction[], parks: readonly ParkReceipt[], running: readonly string[] = []): AdmissionResult {
  const parked = new Set(parks.map((p) => p.actionKey));
  const byKey = new Map(actions.map((a) => [a.key, a]));
  const skipped: Array<{ key: string; reason: string }> = [];
  const blockedBy = (key: string, seen = new Set<string>()): string | null => {
    if (seen.has(key)) return null;
    seen.add(key);
    for (const dep of byKey.get(key)?.dependsOn ?? []) {
      if (parked.has(dep)) return dep;
      const upstream = blockedBy(dep, seen);
      if (upstream) return upstream;
    }
    return null;
  };
  let admit: string | null = null;
  for (const action of actions) {
    if (action.status !== "open") continue;
    if (parked.has(action.key)) { skipped.push({ key: action.key, reason: "parked" }); continue; }
    const root = blockedBy(action.key);
    if (root) { skipped.push({ key: action.key, reason: `depends on parked ${root}` }); continue; }
    const unfinished = action.dependsOn.find((d) => byKey.get(d)?.status === "open");
    if (unfinished) { skipped.push({ key: action.key, reason: `waits for ${unfinished}` }); continue; }
    if (running.includes(action.key)) continue;
    if (admit === null) admit = action.key;
  }
  return { admit, skipped };
}

export interface LaneUsage {
  /** Input tokens summed over the lane's Sessions in the window; null when unreadable. */
  inputTokens: number | null;
  /** Windows read through capacityPreAdmission's receipt; null when unreadable. */
  claudeWindows: readonly CapacityWindow[] | null;
}

export interface BreakerInput {
  project: string;
  lane: string;
  now: number;
  parks: readonly ParkReceipt[];
  /** Merge times (epoch ms) of this project and lane. */
  merges: readonly number[];
  /** When the lane first admitted work; null when it has not. */
  laneFirstAdmissionAt: number | null;
  usage: LaneUsage;
  mainRed?: boolean;
}

export type BreakerTrip = "parks" | "merges" | "tokens" | "claude-window";

export interface BreakerVerdict {
  /** `lane` pauses the affected lane or project; `production` is Off. */
  pause: "none" | "lane" | "production";
  page: boolean;
  trips: BreakerTrip[];
  reasons: string[];
}

const FIVE_HOUR = /5.?h(?:our)?|five.?hour/i;

/** The Claude 5-hour window's used percentage, or null when no such window is listed. */
export function claudeFiveHourPercent(windows: readonly CapacityWindow[] | null): number | null {
  const w = windows?.find((x) => FIVE_HOUR.test(x.label));
  return w ? w.usedPercentage : null;
}

/** Pure: the night breaker over a rolling 24 hours per project and lane. */
export function evaluateNightBreaker(input: BreakerInput): BreakerVerdict {
  const since = input.now - BREAKER_WINDOW_MS;
  const trips: BreakerTrip[] = [];
  const reasons: string[] = [];
  const parks = input.parks.filter((p) => p.project === input.project && p.lane === input.lane && p.parkedAt > since && p.causeKind === "condition-failed").length;
  if (parks >= BREAKER_PARK_LIMIT) { trips.push("parks"); reasons.push(`${parks} parks in 24 hours on ${input.project}/${input.lane}`); }
  const merges = input.merges.filter((m) => m > since).length;
  const firstDay = input.laneFirstAdmissionAt !== null && input.now - input.laneFirstAdmissionAt < BREAKER_WINDOW_MS;
  const mergeLimit = firstDay ? BREAKER_FIRST_DAY_MERGE_LIMIT : BREAKER_LATER_MERGE_LIMIT;
  if (merges >= mergeLimit) { trips.push("merges"); reasons.push(`${merges} merges in 24 hours on ${input.project}/${input.lane} (limit ${mergeLimit}${firstDay ? ", the lane's first 24 hours" : ""})`); }
  const tokens = input.usage.inputTokens;
  if (tokens !== null && tokens >= BREAKER_LANE_INPUT_TOKEN_CEILING) { trips.push("tokens"); reasons.push(`${tokens} input tokens over the lane's Sessions, at or over ${BREAKER_LANE_INPUT_TOKEN_CEILING}`); }
  const percent = claudeFiveHourPercent(input.usage.claudeWindows);
  if (percent !== null && percent >= BREAKER_CLAUDE_FIVE_HOUR_PERCENT) { trips.push("claude-window"); reasons.push(`the Claude 5-hour window is at ${percent}%, at or over ${BREAKER_CLAUDE_FIVE_HOUR_PERCENT}%`); }
  const sameCause = findRepeatedCause(input.parks, input.now);
  if (input.mainRed) return { pause: "production", page: true, trips, reasons: ["main is red", ...reasons] };
  if (sameCause) return { pause: "production", page: true, trips, reasons: [`the same cause twice: ${sameCause}`, ...reasons] };
  if (trips.length > 0) return { pause: "lane", page: true, trips, reasons };
  return { pause: "none", page: false, trips, reasons };
}

/** The cause shared by two parks of different Actions inside the window, or null. */
export function findRepeatedCause(parks: readonly ParkReceipt[], now: number): string | null {
  const seen = new Map<string, string>();
  for (const p of parks) {
    if (p.causeKind !== "condition-failed" || now - p.parkedAt >= BREAKER_WINDOW_MS) continue;
    const prior = seen.get(p.cause);
    if (prior !== undefined && prior !== p.actionKey) return p.cause;
    seen.set(p.cause, p.actionKey);
  }
  return null;
}

export interface ParkMergeDecision {
  /** A park is never merged as recorded once it is older than a night. */
  mergeAsRecorded: false;
  rereview: boolean;
  /** The head the re-review must read: the current head, not the recorded one. */
  reviewHead: string;
  reason: string;
}

/** A park is re-reviewed at its current head when older than one night; no park is ever merged as recorded. */
export function decideParkedMerge(park: ParkReceipt, currentHead: string, now: number): ParkMergeDecision {
  const old = now - park.parkedAt > PARK_NIGHT_MS;
  const moved = park.head !== null && park.head !== currentHead;
  if (park.causeKind === "operator-cancel") return { mergeAsRecorded: false, rereview: false, reviewHead: currentHead, reason: "operator cancel vetoes the merge" };
  return {
    mergeAsRecorded: false,
    rereview: old || moved,
    reviewHead: currentHead,
    reason: old ? `parked over a night ago (${park.parkedAt}); re-review at ${currentHead}` : moved ? `head moved since the park; re-review at ${currentHead}` : "parked within the night at the same head; still never merged as recorded"
  };
}

export interface CancelInput {
  actionKey: string;
  project: string;
  lane: string;
  reason: string;
  now: number;
  head?: string | null;
}

export interface CancelResult {
  state: ParkState;
  receipt: ParkReceipt;
  /** Admission of this Action stops now. */
  stopAdmission: true;
  /** Any pending merge of this Action is vetoed. */
  vetoPendingMerge: true;
  /** The work is preserved as a draft. */
  preserveAs: "draft";
}

/** The operator-cancel cause: a park that also vetoes the merge and keeps the work as a draft. */
export function cancelAction(state: ParkState, input: CancelInput): CancelResult | { error: string } {
  const reason = input.reason.trim();
  if (!reason) return { error: "an operator cancel records its reason" };
  const receipt: ParkReceipt = {
    actionKey: input.actionKey,
    condition: "operator-cancel",
    cause: reason,
    causeKind: "operator-cancel",
    project: input.project,
    lane: input.lane,
    parkedAt: input.now,
    head: input.head ?? null,
    reason,
    preservedAs: "draft"
  };
  return {
    state: { parks: [...state.parks.filter((p) => p.actionKey !== input.actionKey), receipt] },
    receipt,
    stopAdmission: true,
    vetoPendingMerge: true,
    preserveAs: "draft"
  };
}

/** True when a pending merge of this Action is vetoed by a cancel. */
export function mergeVetoed(state: ParkState, actionKey: string): boolean {
  return state.parks.some((p) => p.actionKey === actionKey && p.causeKind === "operator-cancel");
}
