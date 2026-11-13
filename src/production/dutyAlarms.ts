import { closingKey, fitPing, formatAge } from "./momentumWatch.js";

/**
 * Duty alarms (housekeeping A8; Issue #2231 family, Momentum Keeper rules 1, 9, 10).
 *
 * Three supply and custody conditions page once per root idle episode, on the
 * existing momentum timer (`productionMomentum.ts`, which reads the idle-front
 * row):
 *
 * - `no_custodian`: no coordinator custodian has been live for 10 minutes.
 * - `off_nothing_eligible`: production is Off and no scope Action is eligible.
 * - `ready_below_floor`: the ready-Action count is below the floor.
 *
 * Pure: every input is passed in; it reads nothing, queues nothing and grants
 * nothing. The caller queues the one ping a transition asks for and records the
 * outbox id as delivery. Acknowledgment is a separate field that only a later
 * operator acknowledgment may set; nothing here sets it.
 */

/** Uncalibrated (rule 1): a target the operator may change with `--ready-floor`, not a guarantee. */
export const DUTY_READY_FLOOR_DEFAULT = 6;
export const DUTY_READY_FLOOR_MAX = 100;
/** The alarm's silence threshold for the custodian (rule 8, "10 minutes"). */
export const CUSTODIAN_SILENCE_MINUTES = 10;
/** A running Action whose last activity is this recent is healthy, however long it has run (rule 9). */
export const HEALTHY_ACTIVITY_MINUTES = 20;
/** The coordinator role whose custodian transcript is the liveness signal. */
export const CUSTODIAN_ROLE = "rowan" as const;

export type DutyCause = "no_custodian" | "off_nothing_eligible" | "ready_below_floor";

/** Root precedence: when several conditions hold, the first one names the episode. */
const PRECEDENCE: readonly DutyCause[] = ["no_custodian", "off_nothing_eligible", "ready_below_floor"];

const LABEL: Record<DutyCause, string> = {
  no_custodian: "no custodian live",
  off_nothing_eligible: "production Off with nothing eligible",
  ready_below_floor: "ready Actions below the floor"
};

const OWNER: Record<DutyCause, string> = {
  no_custodian: "Rowan or the operator: start or accept the coordinator custodian",
  off_nothing_eligible: "the operator: accept an Action or Plan, or press START under a granted scope",
  ready_below_floor: "Rowan or the Momentum Keeper: restock ready Actions through Asks"
};

const NEXT_EVENT: Record<DutyCause, string> = {
  no_custodian: "a custodian transcript is written again (live within 10 minutes)",
  off_nothing_eligible: "an eligible Action is accepted, or a run window opens",
  ready_below_floor: "the ready count reaches the floor"
};

export interface CustodianLiveness {
  /** False when the custodian record or transcripts could not be read: unknown, never silent. */
  readable: boolean;
  /** Newest custodian transcript write (epoch ms); null when no custodian has ever been recorded. */
  lastLiveAt: number | null;
  reason: string | null;
}

export interface DutyInput {
  now: number;
  /** Scope Actions not yet merged (`ready_actions`); null when no scope is known. */
  readyCount: number | null;
  floor: number;
  production: "active" | "off" | "unknown";
  /** Eligible Actions to start now; null when unknown. The read model has no grant check, so the caller passes the ready count. */
  eligibleCount: number | null;
  custodian: CustodianLiveness;
  /** Running Actions (live admissions) and when any of them last showed activity (epoch ms), null when unknown. */
  running: { count: number; lastActivityAt: number | null };
}

/** The open episode, as recorded in the momentum state. */
export interface DutyEpisodeRecord {
  /** The root cause; it names the episode and never changes while the episode is open. */
  cause: DutyCause;
  /** Every condition that held in any run of this episode, root first. */
  contributing: DutyCause[];
  /** When the root condition began: the silence start for a custodian, else the first run that saw it (ISO). */
  startedAt: string;
  /** The episode key the outbox dedupes on. */
  key: string;
  owner: string;
  nextEvent: string;
  /** Delivery: the outbox row that queued the alert, and when it was queued. Null until queued. */
  delivery: { pingId: string; queuedAt: string } | null;
  /** Acknowledgment is recorded separately from delivery; only an operator acknowledgment sets it. */
  acknowledgment: { acknowledgedAt: string; by: string } | null;
}

export interface DutySlot {
  open: DutyEpisodeRecord | null;
  /** When the last episode closed (ISO); an outbox row at or before it belongs to another episode. */
  closedAt: string | null;
}

export function emptyDutySlot(): DutySlot {
  return { open: null, closedAt: null };
}

export interface DutyEvaluation {
  /** Conditions that hold now, in precedence order. */
  active: DutyCause[];
  /** Conditions that cannot be judged this run. An unknown never closes an episode. */
  unknown: string[];
}

export function evaluateDuty(input: DutyInput): DutyEvaluation {
  const active: DutyCause[] = [];
  const unknown: string[] = [];
  const now = input.now;

  // Custodian: silent only from a readable record with a known last-live time.
  if (!input.custodian.readable) unknown.push(`custodian liveness unreadable${input.custodian.reason ? `: ${input.custodian.reason}` : ""}`);
  else if (input.custodian.lastLiveAt === null) unknown.push("no custodian has been recorded yet");
  else if (now - input.custodian.lastLiveAt >= CUSTODIAN_SILENCE_MINUTES * 60_000) active.push("no_custodian");

  // Off with nothing eligible: Off is known, and the eligible count is known and zero.
  if (input.production === "unknown") unknown.push("production state is unreadable");
  else if (input.production === "off") {
    if (input.eligibleCount === null) unknown.push("eligible Action count is unknown");
    else if (input.eligibleCount === 0) active.push("off_nothing_eligible");
  }

  // Ready floor: a healthy running Action means the critical path is moving, so it is not idle supply.
  if (input.readyCount === null) unknown.push("ready Action count is unknown");
  else if (input.readyCount < input.floor && !isHealthyRunning(input.running, now)) active.push("ready_below_floor");

  return { active: PRECEDENCE.filter((cause) => active.includes(cause)), unknown };
}

/** A running Action whose last activity is recent is healthy, however long it has been running. */
export function isHealthyRunning(running: DutyInput["running"], now: number): boolean {
  return running.count > 0 && running.lastActivityAt !== null && now - running.lastActivityAt < HEALTHY_ACTIVITY_MINUTES * 60_000;
}

export type DutyTransition =
  /** A new root episode: queue one alert and record its delivery. */
  | "open"
  /** The open episode continues (or none is open and none holds): nothing is queued. */
  | "none"
  /** Something cannot be judged: the open episode stays open and silent. */
  | "hold"
  /** Every condition has cleared: queue one closing line. */
  | "close";

/**
 * The state table. `prior` is the open episode, or null. The returned `next`
 * is the episode to store: a new record on `open`, the same record with any new
 * contributing conditions on `none`, unchanged on `hold`, and null on `close`.
 */
export function decideDuty(prior: DutyEpisodeRecord | null, input: DutyInput): {
  transition: DutyTransition;
  evaluation: DutyEvaluation;
  next: DutyEpisodeRecord | null;
} {
  const evaluation = evaluateDuty(input);
  const { active, unknown } = evaluation;
  const now = new Date(input.now).toISOString();

  if (active.length > 0) {
    if (prior) {
      const contributing = [...new Set<DutyCause>([...prior.contributing, ...active])];
      const changed = contributing.length !== prior.contributing.length;
      return { transition: "none", evaluation, next: changed ? { ...prior, contributing } : prior };
    }
    const root = active[0];
    const startedAt = root === "no_custodian" && input.custodian.lastLiveAt !== null
      ? new Date(input.custodian.lastLiveAt + CUSTODIAN_SILENCE_MINUTES * 60_000).toISOString()
      : now;
    return {
      transition: "open",
      evaluation,
      next: {
        cause: root,
        contributing: [...active],
        startedAt,
        key: `duty ${root} since ${startedAt}`,
        owner: OWNER[root],
        nextEvent: NEXT_EVENT[root],
        delivery: null,
        acknowledgment: null
      }
    };
  }
  if (unknown.length > 0) return { transition: prior ? "hold" : "none", evaluation, next: prior };
  return prior
    ? { transition: "close", evaluation, next: null }
    : { transition: "none", evaluation, next: null };
}

export function dutyLabel(cause: DutyCause): string {
  return LABEL[cause];
}

/** Fixed for the whole episode (the key carries the root start), so the outbox recognises a retry. */
export function dutyAlertMessage(record: DutyEpisodeRecord, now: Date): string {
  const since = formatAge(now.getTime() - Date.parse(record.startedAt));
  const others = record.contributing.filter((cause) => cause !== record.cause).map(dutyLabel);
  return fitPing(
    `🚨🚨🚨 DUTY: ${dutyLabel(record.cause)} for ${since} — owner: ${record.owner} — next event: ${record.nextEvent}.`,
    others.length > 0 ? ` Also holding: ${others.join(", ")}.` : "",
    ` Since ${record.startedAt}; ${record.key}. Nothing was started.`
  );
}

export function dutyCloseMessage(open: DutyEpisodeRecord, pingId: string, now: Date): string {
  const after = formatAge(now.getTime() - Date.parse(open.startedAt));
  return `✅ DUTY cleared: ${dutyLabel(open.cause)}, ${after} after the duty alarm ${closingKey(pingId)}.`;
}
