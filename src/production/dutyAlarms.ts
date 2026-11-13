import { closingKey, fitPing, formatAge } from "./momentumWatch.js";

/**
 * Duty alarms (housekeeping A8; Issue #2231 family, Momentum Keeper rules 1, 8, 9, 10).
 *
 * Three supply and custody conditions page once per root idle episode, on the
 * existing momentum timer (`productionMomentum.ts`, which reads the idle-front
 * row and the readiness read model):
 *
 * - `no_custodian`: no coordinator custodian has been live for 10 minutes.
 * - `off_nothing_eligible`: production is Off and no startable Action is eligible.
 * - `ready_below_floor`: the startable count is below the floor.
 *
 * While production is Off, every condition is "not judged" unless the Off alarm is on.
 * "Not judged" never opens or closes an episode: an open one is carried.
 *
 * A condition that cannot be judged because a count cannot be read is an unknown. It
 * pages once per unknown episode (`duty_unknown`) and closes when judgement resumes.
 *
 * Pure: every input is passed in; it reads nothing, queues nothing and grants nothing.
 * The caller queues the one ping a transition asks for and records the outbox id as
 * delivery. Acknowledgment is a separate field that only a later operator acknowledgment
 * may set; nothing here sets it.
 */

/** Uncalibrated (rule 1): a target the operator may change with `--ready-floor`, not a guarantee. */
export const DUTY_READY_FLOOR_DEFAULT = 6;
export const DUTY_READY_FLOOR_MAX = 100;
/** The alarm's silence threshold for the custodian (rule 8, "10 minutes"). */
export const CUSTODIAN_SILENCE_MINUTES = 10;
/**
 * The cap on the healthy-window suppression. The read model carries only a live-admission
 * COUNT, so "healthy" is read as: the critical path says moving, with live admissions, and
 * the count changed within this many minutes. A swap of one admission for another keeps the
 * clock running. The cap stops a stuck moving admission from silencing the floor forever.
 */
export const HEALTHY_MAX_SILENCE_MINUTES = 120;
/** The readiness walk reads many documents, so its result is reused for this long. */
export const STARTABLE_CACHE_MINUTES = 5;
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
  /** Startable Actions across accepted Plans (readiness `readyTotal`); null when that count cannot be read. */
  readyCount: number | null;
  /** Why `readyCount` is null, when it is: named in the unknown, never dropped. */
  readyUnknownReason: string | null;
  floor: number;
  production: "active" | "off" | "unknown";
  /** Eligible Actions to start now; null when unknown. The caller passes the same startable count as `readyCount`. */
  eligibleCount: number | null;
  /** Off with nothing eligible pages only when this is on (`--duty-off-alarm`); off by default. */
  offNothingAlarm: boolean;
  custodian: CustodianLiveness;
  /** Running Actions (live admission count), and when that count last changed (epoch ms; null when not moving). */
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

/** A cannot-judge episode: a count that could not be read, while judgement was possible. */
export interface UnknownEpisode {
  startedAt: string;
  key: string;
  /** The unknown reasons as of the last run that saw them. */
  reasons: string[];
  delivery: { pingId: string; queuedAt: string } | null;
}

export interface StartableCache {
  count: number;
  readAt: string;
}

export interface DutySlot {
  open: DutyEpisodeRecord | null;
  /** When the last duty episode closed (ISO); an outbox row at or before it belongs to another episode. */
  closedAt: string | null;
  /** The live-admission count, and when that count last changed (ISO), for the healthy-window cap. Null `changedAt` means no change seen yet. */
  admissions: { count: number; changedAt: string | null } | null;
  /** The open cannot-judge episode, if any. */
  unknown: UnknownEpisode | null;
  /** When the last cannot-judge episode closed (ISO). */
  unknownClosedAt: string | null;
  /** The last successful startable read, reused for STARTABLE_CACHE_MINUTES. */
  startable: StartableCache | null;
}

export function emptyDutySlot(): DutySlot {
  return { open: null, closedAt: null, admissions: null, unknown: null, unknownClosedAt: null, startable: null };
}

export interface DutyEvaluation {
  /** Conditions that hold now, in precedence order. */
  active: DutyCause[];
  /** Conditions that cannot be judged this run, with reasons. An unknown never closes an episode. */
  unknown: string[];
  /** False while production is Off with the Off alarm off: nothing is judged, and no episode may open or close. */
  judged: boolean;
}

export function evaluateDuty(input: DutyInput): DutyEvaluation {
  const now = input.now;
  // While Off, every condition is not judged unless the Off alarm is on (`--duty-off-alarm`). Not judged is not
  // "clear": it never opens or closes an episode. Not Off (Active, or unreadable) is judged by default.
  if (input.production === "off" && !input.offNothingAlarm) return { active: [], unknown: [], judged: false };

  const active: DutyCause[] = [];
  const unknown: string[] = [];
  const withReason = (text: string) => (input.readyUnknownReason ? `${text}: ${input.readyUnknownReason}` : text);

  // Custodian: silent only from a readable record with a known last-live time.
  if (!input.custodian.readable) unknown.push(`custodian liveness unreadable${input.custodian.reason ? `: ${input.custodian.reason}` : ""}`);
  else if (input.custodian.lastLiveAt === null) unknown.push("no custodian has been recorded yet");
  else if (now - input.custodian.lastLiveAt >= CUSTODIAN_SILENCE_MINUTES * 60_000) active.push("no_custodian");

  // Off with nothing eligible: opt-in only.
  if (input.offNothingAlarm) {
    if (input.production === "unknown") unknown.push("production state is unreadable");
    else if (input.production === "off") {
      if (input.eligibleCount === null) unknown.push(withReason("eligible Action count is unknown"));
      else if (input.eligibleCount === 0) active.push("off_nothing_eligible");
    }
  }

  // Ready floor: a healthy running Action means the critical path is moving, so it is not idle supply.
  if (input.readyCount === null) unknown.push(withReason("ready Action count is unknown"));
  else if (input.readyCount < input.floor && !isHealthyRunning(input.running, now)) active.push("ready_below_floor");

  return { active: PRECEDENCE.filter((cause) => active.includes(cause)), unknown, judged: true };
}

/** A running Action is healthy while the live-admission count changed within the cap (see HEALTHY_MAX_SILENCE_MINUTES). */
export function isHealthyRunning(running: DutyInput["running"], now: number): boolean {
  return running.count > 0 && running.lastActivityAt !== null && now - running.lastActivityAt < HEALTHY_MAX_SILENCE_MINUTES * 60_000;
}

export type DutyTransition =
  /** A new root episode, or a recorded one still to be queued: queue one alert and record its delivery. */
  | "open"
  /** The open episode continues, or nothing is open and nothing holds: nothing is queued. */
  | "none"
  /** Not judged or not readable: the episode is carried exactly as it is, and nothing is queued. */
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
  /** True on an `open` for an episode whose condition has already cleared: its page says so, and it is closed at once. */
  cleared: boolean;
} {
  const evaluation = evaluateDuty(input);
  // Not judged never changes an episode, open or not: the episode is carried, and nothing closes or opens.
  if (!evaluation.judged) return { transition: prior ? "hold" : "none", evaluation, next: prior, cleared: false };
  const { active, unknown } = evaluation;
  const now = new Date(input.now).toISOString();

  if (active.length > 0) {
    if (prior && prior.delivery !== null) {
      const contributing = [...new Set<DutyCause>([...prior.contributing, ...active])];
      const changed = contributing.length !== prior.contributing.length;
      return { transition: "none", evaluation, next: changed ? { ...prior, contributing } : prior, cleared: false };
    }
    if (prior) {
      // Recorded but never queued (the queue or the delivery write failed): queue it again under the same key,
      // so the outbox recognises the retry and no second episode is minted.
      const contributing = [...new Set<DutyCause>([...prior.contributing, ...active])];
      return { transition: "open", evaluation, next: { ...prior, contributing }, cleared: false };
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
      },
      cleared: false
    };
  }
  // A condition that cannot be judged waits: a recorded, undelivered episode is not paged until it can be.
  if (unknown.length > 0) return { transition: prior ? "hold" : "none", evaluation, next: prior, cleared: false };
  if (prior && prior.delivery !== null) return { transition: "close", evaluation, next: null, cleared: false };
  // A recorded episode that was never queued is still paged once, even if its condition has already cleared (for
  // example after a crash between the state write and the queue), so the start is never silently lost. The page says so.
  if (prior) return { transition: "open", evaluation, next: prior, cleared: true };
  return { transition: "none", evaluation, next: null, cleared: false };
}

/**
 * The cannot-judge state table: one page per unknown episode, while judgement is possible. Not judged (Off with
 * the Off alarm off) carries an open unknown episode and never opens or closes one.
 */
export function decideUnknown(prior: UnknownEpisode | null, judged: boolean, unknown: string[], now: number): {
  transition: DutyTransition;
  next: UnknownEpisode | null;
  cleared: boolean;
} {
  if (!judged) return { transition: prior ? "hold" : "none", next: prior, cleared: false };
  const nowIso = new Date(now).toISOString();
  if (unknown.length > 0) {
    if (prior && prior.delivery !== null) return { transition: "none", next: { ...prior, reasons: unknown }, cleared: false };
    if (prior) return { transition: "open", next: { ...prior, reasons: unknown }, cleared: false };
    return {
      transition: "open",
      next: { startedAt: nowIso, key: `duty_unknown since ${nowIso}`, reasons: unknown, delivery: null },
      cleared: false
    };
  }
  if (prior && prior.delivery !== null) return { transition: "close", next: null, cleared: false };
  if (prior) return { transition: "open", next: prior, cleared: true };
  return { transition: "none", next: null, cleared: false };
}

export function dutyLabel(cause: DutyCause): string {
  return LABEL[cause];
}

/** Fixed for the whole episode (the key carries the root start), so the outbox recognises a retry. */
export function dutyAlertMessage(record: DutyEpisodeRecord, now: Date, clearedBeforeDelivery = false): string {
  const since = formatAge(now.getTime() - Date.parse(record.startedAt));
  const others = record.contributing.filter((cause) => cause !== record.cause).map(dutyLabel);
  return fitPing(
    `🚨🚨🚨 DUTY: ${dutyLabel(record.cause)} for ${since} — owner: ${record.owner} — next event: ${record.nextEvent}.`,
    others.length > 0 ? ` Also holding: ${others.join(", ")}.` : "",
    clearedBeforeDelivery
      ? ` Cleared before this page was sent; ${record.key}. Nothing was started.`
      : ` Since ${record.startedAt}; ${record.key}. Nothing was started.`
  );
}

export function dutyCloseMessage(open: DutyEpisodeRecord, pingId: string, now: Date): string {
  const after = formatAge(now.getTime() - Date.parse(open.startedAt));
  return `✅ DUTY cleared: ${dutyLabel(open.cause)}, ${after} after the duty alarm ${closingKey(pingId)}.`;
}

export function dutyUnknownMessage(record: UnknownEpisode, now: Date, clearedBeforeDelivery = false): string {
  const since = formatAge(now.getTime() - Date.parse(record.startedAt));
  return fitPing(
    `🚨🚨🚨 DUTY CANNOT JUDGE for ${since}: ${record.reasons.join("; ")}`,
    " The duty alarm holds its conditions until they can be read.",
    clearedBeforeDelivery ? ` Cleared before this page was sent; ${record.key}. Nothing was started.` : ` ${record.key}. Nothing was started.`
  );
}

export function dutyUnknownCloseMessage(open: UnknownEpisode, pingId: string, now: Date): string {
  const after = formatAge(now.getTime() - Date.parse(open.startedAt));
  return `✅ DUTY can judge again, ${after} after the cannot-judge alert ${closingKey(pingId)}.`;
}
