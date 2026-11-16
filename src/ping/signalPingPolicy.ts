/**
 * Which events Signal may send the operator as a real-time ping (Decision 0241). The seven causes are the whole list in
 * `.agents/skills/arcadia-signal/SKILL.md`; every other event is recorded for the morning and evening digest. Pure: it sends,
 * records and grants nothing.
 */
export const REAL_TIME_PING_CAUSES = [
  "decision-to-answer",
  "plan-to-choose",
  "merge-carries-decision-or-authority",
  "spend-or-credential-step",
  "second-failed-batch-same-cause",
  "refused-press",
  "grant-ended"
] as const;

export type RealTimePingCause = typeof REAL_TIME_PING_CAUSES[number];

/** Events Signal sees that are not ping causes. Under an open standing grant they never interrupt the operator. */
export const DIGEST_EVENTS = ["events-card-ready", "batch-complete", "successor-pressed", "pr-opened", "ci-update", "progress"] as const;

export type DigestEvent = typeof DIGEST_EVENTS[number];
export type SignalEvent = RealTimePingCause | DigestEvent;

export interface SignalPingDecision { ping: boolean; cause: RealTimePingCause | null }

const CAUSES: ReadonlySet<string> = new Set(REAL_TIME_PING_CAUSES);

export function signalPingDecision(event: SignalEvent): SignalPingDecision {
  return CAUSES.has(event) ? { ping: true, cause: event as RealTimePingCause } : { ping: false, cause: null };
}
