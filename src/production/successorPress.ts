import type { DayGrantPressKind } from "../operatorActions/startRunDayGrant.js";
import { DERIVED_CARD_MAX_ACTIONS, type DeriveResult, type DerivedCard, type FailedBatchClearance } from "../operatorActions/startRunDerive.js";
import type { ReplayCheck } from "../operatorActions/startRunReplayReceipt.js";

/**
 * The successor-press step of the host timer. While a standing grant is open it mints, checks and presses the next START card
 * after each clean batch, so no card waits unpressed and no agent turn is needed between batches. It is a pure decision over
 * injected ports (`src/commands/productionSuccessor.ts` holds the real ones): it adds no authority. The card is the one
 * `deriveStartCard` returns, the press is the delegated press the /actions runner already records, and every check the executor
 * runs at the press still runs. A refusal is final for the grant until its recorded cause is cleared.
 */
export const SUCCESSOR_STATE_SCHEMA = "arcadia-successor-press-state-v1";
/** The only slug the step's own Off uses: the CLI composes the request id `rowan-off-<slug>`, which does not end a standing grant. */
export const SUCCESSOR_OFF_SLUG = "successor-press-scope-complete";

/** Why the step pressed nothing and stays quiet: recorded on the run, never pinged. */
export type SuccessorSkip =
  | "GRANT_NOT_OPEN" | "PRODUCTION_NOT_OFF" | "BATCH_NOT_CLEAN" | "MAIN_CHECKS_NOT_GREEN" | "CARD_HELD" | "NOTHING_READY" | "STEP_ENDED" | "ALREADY_PRESSED";

export interface SuccessorEnd { code: string; message: string; at: string; press: string | null; pingId: string | null }
export interface SuccessorState {
  schema: typeof SUCCESSOR_STATE_SCHEMA;
  /** `<approval card>/<approval run>` of the open standing grant the record belongs to; another grant starts a clean record. */
  grant: string | null;
  /** Set by a refusal: the step does nothing more for this grant until the recorded cause clears. */
  ended: SuccessorEnd | null;
  pressed: Array<{ card: string; runId: string; at: string }>;
  /** Policy revisions at which the step issued its scope-complete Off. */
  offs: number[];
}
export const emptySuccessorState = (): SuccessorState => ({ schema: SUCCESSOR_STATE_SCHEMA, grant: null, ended: null, pressed: [], offs: [] });

export interface SuccessorProduction {
  desiredState: "active" | "inactive" | "unknown";
  liveAdmissions: number;
  /** Active, nothing left in scope: the tick has recorded `managed_production.scope_complete` for the live policy revision. */
  scopeComplete: boolean;
  revision: number;
}
export interface SuccessorPorts {
  now: Date;
  grant(): { open: boolean; plan: string | null; approvalCard: string | null; approvalRun: string | null };
  production(): SuccessorProduction;
  /** The latest START press and how production's record reads it, or null before any. `unsettled` is a press whose batch has not ended. */
  batch(): { press: string; kind: DayGrantPressKind | "unsettled" } | null;
  mainChecks(): { green: boolean; detail: string };
  /** Governed START card holds that are not yet consumed. */
  holds(): string[];
  /** The recorded cause, pre-mortem pointer and merged fix for a failed press, or null. */
  clearance(press: string): FailedBatchClearance | null;
  derive(clearance: FailedBatchClearance | null): DeriveResult;
  /** Writes `<id>.json`, `<id>.sh` and `reviewed/<id>.json` exactly as derived. */
  mint(card: DerivedCard): void;
  /** Runs the replay for the minted card and returns the check the press reads. */
  replay(card: DerivedCard): ReplayCheck;
  /** Records the card's pre-press check on its reviewed manifest as `premortem`. */
  recordPrePress(card: DerivedCard, pointer: string): void;
  /** The card's own `preflight` phases (P0 to P2, no mutation): the press needs a passing one from the last 2 hours. */
  preflight(card: string): { ok: true } | { ok: false; code: string; message: string };
  /** The delegated press through the /actions runner. */
  press(card: string): { ok: true; runId: string } | { ok: false; code: string; message: string };
  /** Removes a minted card that was not pressed, so the library never holds an unpressed delegated card. */
  retire(card: string): void;
  /** Queues one operator ping under an episode key; returns its id. */
  ping(input: { message: string; key: string }): string;
  /** `arcadia production deactivate --rowan-off <slug>`: Rowan's own Off, which does not end a standing grant. */
  off(slug: string): void;
}

export type SuccessorOutcome =
  | { kind: "pressed"; card: string; runId: string; actions: string[]; offIssued: boolean }
  | { kind: "skipped"; reason: SuccessorSkip; detail: string; offIssued: boolean }
  | { kind: "refused"; code: string; message: string; pingId: string | null; offIssued: boolean };
export interface SuccessorResult { state: SuccessorState; outcome: SuccessorOutcome }

/** Derivation refusals that mean "nothing to press yet" rather than "something is wrong". */
const QUIET_DERIVATIONS = new Set(["NO_READY_ACTIONS", "OPERATOR_ITEM_FIRST", "PRODUCTION_NOT_INACTIVE", "GRANT_NOT_OPEN"]);

const refusalPing = (code: string, message: string, grant: string): string =>
  `🚨 Successor press refused (${code}): ${message.slice(0, 300)} The step is ended for standing grant ${grant}; nothing was pressed.`;

/** The Off is issued at most once per policy revision, and only for a finished scope with no live admissions. */
function offAtScopeComplete(ports: SuccessorPorts, state: SuccessorState): { issued: boolean; production: SuccessorProduction } {
  const production = ports.production();
  if (production.desiredState !== "active" || production.liveAdmissions !== 0 || !production.scopeComplete || state.offs.includes(production.revision)) return { issued: false, production };
  state.offs.push(production.revision);
  ports.off(SUCCESSOR_OFF_SLUG);
  return { issued: true, production: ports.production() };
}

/**
 * One timer run. `prior` is the state read from disk; the returned state is what to write back. The step never throws for a
 * refusal: it records it, pings once, and ends for the grant.
 */
export function runSuccessorPressStep(ports: SuccessorPorts, prior: SuccessorState): SuccessorResult {
  const grant = ports.grant();
  const grantKey = grant.open && grant.approvalCard && grant.approvalRun ? `${grant.approvalCard}/${grant.approvalRun}` : null;
  let state: SuccessorState = grantKey !== null && prior.grant === grantKey ? { ...prior, pressed: [...prior.pressed], offs: [...prior.offs] } : { ...emptySuccessorState(), grant: grantKey };
  const skip = (reason: SuccessorSkip, detail: string, offIssued = false): SuccessorResult => ({ state, outcome: { kind: "skipped", reason, detail, offIssued } });
  if (grantKey === null) return skip("GRANT_NOT_OPEN", "no standing grant is open");

  // An ended step retries only its own undelivered ping, and resumes only when a failed batch's recorded clearance now exists.
  if (state.ended) {
    const ended = state.ended;
    const clearedNow = ended.code === "FAILED_BATCH_NEEDS_FIX" && ended.press !== null && ports.clearance(ended.press) !== null;
    if (!clearedNow) {
      if (ended.pingId === null) {
        const pingId = ports.ping({ message: refusalPing(ended.code, ended.message, grantKey), key: `successor-press-refused-${grantKey}-${ended.code}` });
        state = { ...state, ended: { ...ended, pingId } };
      }
      return skip("STEP_ENDED", `${ended.code}: ${ended.message}`);
    }
    state = { ...state, ended: null };
  }

  const { issued: offIssued, production } = offAtScopeComplete(ports, state);
  const refuse = (code: string, message: string, press: string | null, minted: DerivedCard | null = null): SuccessorResult => {
    if (minted) ports.retire(minted.id);
    // The end is recorded before the page is queued, so a failed queue is retried next run under the same key.
    const ended: SuccessorEnd = { code, message, at: ports.now.toISOString(), press, pingId: null };
    state = { ...state, ended };
    let pingId: string | null = null;
    try {
      pingId = ports.ping({ message: refusalPing(code, message, grantKey), key: `successor-press-refused-${grantKey}-${code}` });
      state = { ...state, ended: { ...ended, pingId } };
    } catch { /* the next run finds the undelivered ping on the ended record and queues it again */ }
    return { state, outcome: { kind: "refused", code, message, pingId, offIssued } };
  };

  if (production.desiredState !== "inactive") return skip("PRODUCTION_NOT_OFF", `production is ${production.desiredState}${production.scopeComplete ? "" : "; its scope is not complete"}`, offIssued);
  const batch = ports.batch();
  const failed = batch?.kind === "failed-attempt";
  if (batch?.kind === "unsettled") return skip("BATCH_NOT_CLEAN", `the latest press ${batch.press} has not finished`, offIssued);
  let clearance: FailedBatchClearance | null = null;
  if (failed) {
    clearance = ports.clearance(batch!.press);
    if (!clearance) return refuse("FAILED_BATCH_NEEDS_FIX", `the latest press ${batch!.press} failed; the press waits for an independent pre-mortem pointer and a merged fix for the named cause`, batch!.press);
  }
  const checks = ports.mainChecks();
  if (!checks.green) return skip("MAIN_CHECKS_NOT_GREEN", checks.detail, offIssued);
  const holds = ports.holds();
  if (holds.length > 0) return skip("CARD_HELD", holds.join("; "), offIssued);

  const derived = ports.derive(clearance);
  if (!derived.ok) {
    if (QUIET_DERIVATIONS.has(derived.reason)) return skip("NOTHING_READY", `${derived.reason}: ${derived.message}`, offIssued);
    return refuse(derived.reason, derived.message, batch?.press ?? null);
  }
  const { card } = derived;
  if (card.actions.length === 0 || card.actions.length > DERIVED_CARD_MAX_ACTIONS) return refuse("CARD_INVALID", `the derived card pins ${card.actions.length} Actions, outside 1 to ${DERIVED_CARD_MAX_ACTIONS}`, batch?.press ?? null);
  if (state.pressed.some((entry) => entry.card === card.id)) return skip("ALREADY_PRESSED", `card ${card.id} was already pressed`, offIssued);

  // Mint, check and press in this one run: a failed check retires the card, so the library never holds an unpressed one past
  // its 10-minute lifetime.
  ports.mint(card);
  const replay = ports.replay(card);
  if (!replay.ok) return refuse(replay.code ?? "REPLAY_REQUIRED", replay.detail, batch?.press ?? null, card);
  ports.recordPrePress(card, failed ? clearance!.premortem : `replays/${card.id}.json`);
  const preflight = ports.preflight(card.id);
  if (!preflight.ok) return refuse(preflight.code, preflight.message, batch?.press ?? null, card);
  const pressed = ports.press(card.id);
  if (!pressed.ok) return refuse(pressed.code, pressed.message, batch?.press ?? null, card);
  state = { ...state, pressed: [...state.pressed, { card: card.id, runId: pressed.runId, at: ports.now.toISOString() }] };
  return { state, outcome: { kind: "pressed", card: card.id, runId: pressed.runId, actions: card.actions, offIssued } };
}
