/**
 * Deterministic next-Plan selector and preflight (Action next-plan-selector, Issue #1284).
 *
 * Pure and preview-only: every input is injected plain data, nothing is read, written, activated or
 * clocked here. It imports only node:crypto and the pure decision-card contract, so no commander,
 * database or container transport enters a dashboard import graph.
 *
 * Authority it follows:
 * - Decision 0116 (answered "Run the same Project's next Plan"): a Project whose active Plan waits on
 *   the operator may still run that Project's NEXT Plan. The Project is never skipped for waiting.
 * - Decision 0122 (answered): admission follows the operator-owned per-Project preference record
 *   (included Projects, shares, each Project's chosen Plan). Queue positions order Actions only
 *   WITHIN a Plan, so nothing here reads a position to choose a Plan.
 *
 * Gap (stated, not papered over): the repository has no Project preference store yet (it is the
 * `record-production-project-preferences` Action of a draft Plan), so `preferences` is an injected
 * input of the same shape and this module invents no store.
 */
import { createHash } from "node:crypto";
import {
  DECISION_CARD_SCHEMA,
  validateDecisionCard,
  type DecisionCard
} from "../decisions/card.js";

export const SELECTOR_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BLOB = "https://github.com/pmark/arcadia/blob/main/";
export const DECISION_0116_PATH =
  "docs/decisions/0116-decide-what-production-runs-when-a-project-s-active-plan-waits-on-the-operator.md";
export const DECISION_0122_PATH =
  "docs/decisions/0122-decide-whether-production-admission-follows-an-operator-owned-project.md";

export const REFUSAL_CODES = [
  "plan_authored_in_this_run",
  "plan_not_approved",
  "plan_not_in_project_preference",
  "project_not_included",
  "no_candidate_plan"
] as const;
export type RefusalCode = (typeof REFUSAL_CODES)[number];

export const PREFLIGHT_CHECKS = [
  "queue_order_valid",
  "no_open_red_alert",
  "previous_plan_closed_out",
  "pointer_free",
  "authorship_known"
] as const;
export type PreflightCheckName = (typeof PREFLIGHT_CHECKS)[number];

export interface ProjectPreference {
  project: string;
  included: boolean;
  /** The Project's chosen Plan slug under Decision 0122, or null when none is chosen. */
  chosenPlan: string | null;
}

export interface PlanSummary {
  project: string;
  slug: string;
  /** draft | active | complete | superseded (parsed Plan status). */
  status: string;
  /**
   * Operator approval receipt for this Plan (an activation settlement id, or the Plan's own `active`
   * status). null means the operator has not approved it. Only an explicit non-empty string counts.
   */
  approvalReceipt: string | null;
  /** Agent Ask request ids the Plan records as its source (Plan and Action `source:` fields). */
  sourceAsks: string[];
  /** Session that authored the Plan, when a ledger row or log entry records it. */
  authoringSession: string | null;
}

export interface QueueSummary {
  project: string;
  orderValid: boolean;
  unpositionedCount: number;
  /** Action keys of this Project that are running now. */
  runningActions: string[];
  /** The Project's active Plan slug, and whether it is waiting on the operator (Decision 0116). */
  activePlan: string | null;
  activePlanWaitsOnOperator: boolean;
}

export interface CloseOutSummary {
  project: string;
  plan: string;
  closed: boolean;
  openRemainders: { id: string; status: string }[];
  /** none means UNKNOWN, never clean. */
  evidence: "none" | "partial" | "complete";
}

export interface RedAlertSummary {
  id: string;
  project: string;
  /** Red Alert trigger (src/production/redAlerts.ts), when known; picks the honest remedy. */
  trigger?: string | null;
}

/** The global queue verdict `arcadia advance queue` reports; the global flag blocks dispatch for every Project. */
export interface QueueGlobal {
  orderValid: boolean;
  unpositionedCount: number;
  /** Project slugs owning at least one unpositioned Action (sorted). */
  unpositionedProjects: string[];
}

/** The subset of AgentQueueEntry the adapter reads (same field names as `advance queue --json`). */
export interface LiveQueueEntry {
  projectSlug: string | null;
  actionId: string | null;
  state: string;
  attentionKind?: string | null;
  orderStatus?: string;
  position?: number | null;
  selected?: boolean;
}
/** The subset of AgentQueue the adapter reads. */
export interface LiveQueue {
  orderValid: boolean;
  unpositionedCount: number;
  nextActionKey: string | null;
  ordered: LiveQueueEntry[];
  ready?: LiveQueueEntry[];
  running?: LiveQueueEntry[];
  flagged?: LiveQueueEntry[];
  attention?: LiveQueueEntry[];
}

/**
 * Pure adapter from the live Agent Queue to the selector's queue input.
 * Rule chosen: a Project's `orderValid` is false when ANY of its entries is unpositioned OR the global
 * flag is false (an invalid global order blocks dispatch for every Project). The global verdict is also
 * returned so the preflight can name the unpositioned count and Projects. `activePlans` supplies each
 * Project's active Plan slug (the queue does not carry it). A Project's active Plan "waits on the
 * operator" when it has an attention entry of kind decision, packet or responsibility.
 */
export function adaptQueue(
  queue: LiveQueue,
  activePlans: Readonly<Record<string, string | null>> = {}
): { queues: QueueSummary[]; global: QueueGlobal } {
  const all = [
    ...queue.ordered, ...(queue.ready ?? []), ...(queue.running ?? []), ...(queue.flagged ?? []), ...(queue.attention ?? [])
  ];
  const projects = new Set<string>();
  for (const entry of all) if (typeof entry.projectSlug === "string" && entry.projectSlug !== "") projects.add(entry.projectSlug);
  for (const slug of Object.keys(activePlans)) projects.add(slug);
  const unpositioned = queue.ordered.filter(entry => entry.orderStatus === "unpositioned");
  const unpositionedProjects = [...new Set(unpositioned.map(e => e.projectSlug).filter((s): s is string => typeof s === "string"))].sort(cmp);
  const waitingKinds = new Set(["decision", "packet", "responsibility"]);
  const queues = [...projects].sort(cmp).map(project => {
    const mine = unpositioned.filter(entry => entry.projectSlug === project).length;
    const running = (queue.running ?? []).filter(e => e.projectSlug === project && e.state === "running")
      .map(e => `${project}/${e.actionId ?? "unknown"}`);
    const waits = (queue.attention ?? []).some(e => e.projectSlug === project && e.attentionKind != null && waitingKinds.has(e.attentionKind));
    return {
      project,
      orderValid: queue.orderValid === true && mine === 0,
      unpositionedCount: mine,
      runningActions: running,
      activePlan: activePlans[project] ?? null,
      activePlanWaitsOnOperator: waits
    };
  });
  return { queues, global: { orderValid: queue.orderValid === true, unpositionedCount: queue.unpositionedCount, unpositionedProjects } };
}

/** Pure adapter from `listOpenRedAlerts` rows to the selector's alert input. */
export function adaptRedAlerts(rows: ReadonlyArray<{ id: string; projectSlug: string; trigger?: string }>): RedAlertSummary[] {
  return rows.map(row => ({ id: row.id, project: row.projectSlug, trigger: row.trigger ?? null }));
}

export interface SelectorInput {
  /** Operator-owned preference record, in the operator's own order (that order is the tie-break). */
  preferences: ProjectPreference[];
  plans: PlanSummary[];
  /** null when the queue could not be read: the queue check is then unknown, never a pass. */
  queues: QueueSummary[] | null;
  closeOuts: CloseOutSummary[];
  /** null when the alerts could not be read: the alert check is then unknown, never a pass. */
  redAlerts: RedAlertSummary[] | null;
  /** The global queue verdict, or null when unknown. */
  queueGlobal?: QueueGlobal | null;
  /** Error class names of live readers that failed (named in unknown blockers). */
  liveErrors?: { queue?: string | null; redAlerts?: string | null };
  currentRunId: string | null;
  currentSessionId: string | null;
  /** Agent Ask ids submitted by the current run or session. */
  currentRunAsks: string[];
  /** Restrict the selection to one Project. */
  onlyProject: string | null;
  /** Repository head sha, a card pin. */
  headSha: string | null;
  /** Clock values are injected; they never enter the state hash. */
  now: string;
  expires: string;
}

export interface Refusal {
  project: string | null;
  plan: string | null;
  code: RefusalCode;
  message: string;
}

export interface PreflightResult {
  check: PreflightCheckName;
  ok: boolean;
  status: "pass" | "fail" | "unknown";
  blocker: string | null;
  remedy: string | null;
}

export interface Selection {
  chosen: { project: string; plan: string } | null;
  reasons: string[];
  refusals: Refusal[];
  preflight: PreflightResult[];
  /** Every preflight check passed; the selection is returned either way (preview). */
  ready: boolean;
  card: DecisionCard | null;
  cardErrors: string[];
  stateHash: string;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort(cmp).filter(key => object[key] !== undefined)
      .map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}
const sha = (value: unknown): string => createHash("sha256").update(canonical(value)).digest("hex");

/**
 * Only the declared fields of each record are read; unknown keys (a forged `approved: true`) are
 * never consulted, and approval needs a non-empty receipt string.
 */
function normalise(input: SelectorInput): SelectorInput {
  const arr = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
  const str = (value: unknown): string | null => (typeof value === "string" ? value : null);
  return {
    preferences: arr<Record<string, unknown>>(input.preferences).map(p => ({
      project: String(p.project ?? ""), included: p.included === true, chosenPlan: str(p.chosenPlan)
    })),
    plans: arr<Record<string, unknown>>(input.plans).map(p => ({
      project: String(p.project ?? ""), slug: String(p.slug ?? ""), status: String(p.status ?? ""),
      approvalReceipt: nonEmpty(p.approvalReceipt) ? p.approvalReceipt : null,
      sourceAsks: arr<string>(p.sourceAsks).map(String).sort(cmp), authoringSession: str(p.authoringSession)
    })),
    queues: input.queues === null ? null : arr<Record<string, unknown>>(input.queues).map(q => ({
      project: String(q.project ?? ""), orderValid: q.orderValid === true,
      unpositionedCount: typeof q.unpositionedCount === "number" ? q.unpositionedCount : Number.POSITIVE_INFINITY,
      runningActions: arr<string>(q.runningActions).map(String),
      activePlan: str(q.activePlan), activePlanWaitsOnOperator: q.activePlanWaitsOnOperator === true
    })),
    closeOuts: arr<Record<string, unknown>>(input.closeOuts).map(c => ({
      project: String(c.project ?? ""), plan: String(c.plan ?? ""), closed: c.closed === true,
      openRemainders: arr<Record<string, unknown>>(c.openRemainders).map(r => ({ id: String(r.id ?? ""), status: String(r.status ?? "") })),
      evidence: c.evidence === "partial" || c.evidence === "complete" ? c.evidence : "none"
    })),
    redAlerts: input.redAlerts === null ? null : arr<Record<string, unknown>>(input.redAlerts)
      .map(a => ({ id: String(a.id ?? ""), project: String(a.project ?? ""), trigger: str(a.trigger) })),
    queueGlobal: input.queueGlobal == null ? null : {
      orderValid: input.queueGlobal.orderValid === true,
      unpositionedCount: Number(input.queueGlobal.unpositionedCount),
      unpositionedProjects: arr<string>(input.queueGlobal.unpositionedProjects).map(String).sort(cmp)
    },
    liveErrors: { queue: str(input.liveErrors?.queue), redAlerts: str(input.liveErrors?.redAlerts) },
    currentRunId: str(input.currentRunId),
    currentSessionId: str(input.currentSessionId),
    currentRunAsks: arr<string>(input.currentRunAsks).map(String),
    onlyProject: str(input.onlyProject),
    headSha: str(input.headSha),
    now: input.now,
    expires: input.expires
  };
}

function authoredHere(plan: PlanSummary, input: SelectorInput): string | null {
  const hit = plan.sourceAsks.find(ask => input.currentRunAsks.includes(ask));
  if (hit !== undefined) return `its source Agent Ask ${hit} was submitted by this run`;
  if (input.currentRunId !== null && plan.sourceAsks.includes(input.currentRunId)) {
    return "its source Agent Ask equals the current run id";
  }
  if (plan.authoringSession !== null && input.currentSessionId !== null && plan.authoringSession === input.currentSessionId) {
    return `its authoring session ${plan.authoringSession} is this session`;
  }
  return null;
}

function preflightFor(project: string, plan: string, input: SelectorInput, planDoc: PlanSummary | null): PreflightResult[] {
  const out: PreflightResult[] = [];
  const queue = input.queues === null ? null : input.queues.find(q => q.project === project) ?? null;

  const global = input.queueGlobal ?? null;
  const placeRemedy = "Open /work-queue and place each unpositioned Action (one previewed move per Action).";
  if (queue === null && global === null) {
    const why = input.liveErrors?.queue ? ` (live reader failed: ${input.liveErrors.queue})` : "";
    out.push({
      check: "queue_order_valid", ok: false, status: "unknown",
      blocker: `The queue could not be read, so its order is unknown${why}.`,
      remedy: "No one-click control exists yet: the queue reader failed; open /work-queue to see the queue, then re-run the preview."
    });
  } else if (global !== null && (!global.orderValid || global.unpositionedCount !== 0)) {
    out.push({
      check: "queue_order_valid", ok: false, status: "fail",
      blocker: `The global queue order is invalid with ${global.unpositionedCount} unpositioned Action(s) in Project(s): ${global.unpositionedProjects.join(", ") || "none named"}; dispatch is blocked for every Project.`,
      remedy: placeRemedy
    });
  } else if (queue === null) {
    out.push({
      check: "queue_order_valid", ok: false, status: "unknown",
      blocker: `The queue holds no entry for ${project}, so its order is unknown.`,
      remedy: "No one-click control exists yet: a Project with no queue entry has nothing to place; open /work-queue to confirm."
    });
  } else if (!queue.orderValid || queue.unpositionedCount !== 0) {
    out.push({
      check: "queue_order_valid", ok: false, status: "fail",
      blocker: `Queue order for ${project} is ${queue.orderValid ? "valid" : "invalid"} with ${queue.unpositionedCount} unpositioned Action(s).`,
      remedy: placeRemedy
    });
  } else out.push({ check: "queue_order_valid", ok: true, status: "pass", blocker: null, remedy: null });

  if (input.redAlerts === null) {
    const why = input.liveErrors?.redAlerts ? ` (live reader failed: ${input.liveErrors.redAlerts})` : "";
    out.push({
      check: "no_open_red_alert", ok: false, status: "unknown",
      blocker: `Open red alerts could not be read${why}.`,
      remedy: "No one-click control exists yet: the alert reader failed; open /production to see the alerts, then re-run the preview."
    });
  } else {
    const mine = input.redAlerts.filter(a => a.project === project).sort((a, b) => cmp(a.id, b.id));
    if (mine.length === 0) out.push({ check: "no_open_red_alert", ok: true, status: "pass", blocker: null, remedy: null });
    else {
      // scope_* alerts have a pinned turn-production-off control on /production; the rest clear on the worker tick.
      const scoped = mine.some(a => a.trigger === "scope_pointer_mismatch" || a.trigger === "scope_successor_held");
      out.push({
        check: "no_open_red_alert", ok: false, status: "fail",
        blocker: `Open red alert(s) on ${project}: ${mine.map(a => a.id).join(", ")}.`,
        remedy: scoped
          ? "Open /production and use the turn-production-off control."
          : "No one-click control exists yet: the worker tick re-evaluates and clears this alert itself; nothing to press."
      });
    }
  }

  // Previous Plan: the Project's active Plan, when it is a different Plan from the chosen one.
  const previous = queue?.activePlan ?? null;
  if (previous === null || previous === plan) {
    out.push({ check: "previous_plan_closed_out", ok: true, status: "pass", blocker: null, remedy: null });
  } else if (queue !== null && queue.activePlanWaitsOnOperator) {
    // Decision 0116 answered "Run the same Project's next Plan": a waiting active Plan does not block.
    out.push({ check: "previous_plan_closed_out", ok: true, status: "pass", blocker: null, remedy: null });
  } else {
    const record = input.closeOuts.find(c => c.project === project && c.plan === previous) ?? null;
    if (record === null) {
      out.push({
        check: "previous_plan_closed_out", ok: false, status: "fail",
        blocker: `Plan ${previous} has no close-out record.`,
        remedy: "No one-click control exists yet: plan close-out has no button; it is `arcadia plan close-out <slug> --write` (gap: no /todo close-out card)."
      });
    } else if (!record.closed) {
      const ids = record.openRemainders.map(r => r.id).sort(cmp);
      out.push({
        check: "previous_plan_closed_out", ok: false, status: "fail",
        blocker: `Plan ${previous} has ${ids.length} open remainder(s): ${ids.join(", ") || "none listed"}.`,
        remedy: "No one-click control exists yet: open remainders have no placement card (gap: split-remainder-placement is a card kind with no control)."
      });
    } else if (record.evidence === "none") {
      out.push({
        check: "previous_plan_closed_out", ok: false, status: "unknown",
        blocker: `Plan ${previous} is closed but its ledger evidence is none, so its completeness is unknown.`,
        remedy: "No one-click control exists yet: no card records close-out evidence for a Plan."
      });
    } else out.push({ check: "previous_plan_closed_out", ok: true, status: "pass", blocker: null, remedy: null });
  }

  const running = queue === null ? null : [...queue.runningActions].sort(cmp);
  if (running === null) {
    out.push({
      check: "pointer_free", ok: false, status: "unknown",
      blocker: `Running Actions of ${project} are unknown because the queue could not be read.`,
      remedy: "No one-click control exists yet: the queue reader failed; open /actions to see running Actions, then re-run the preview."
    });
  } else if (running.length > 0) {
    out.push({
      check: "pointer_free", ok: false, status: "fail",
      blocker: `Action(s) of ${project} are running now: ${running.join(", ")}.`,
      remedy: "Open /actions; the running Action ends on its own or is stopped from its Session card."
    });
  } else out.push({ check: "pointer_free", ok: true, status: "pass", blocker: null, remedy: null });

  const known = planDoc !== null && (planDoc.sourceAsks.length > 0 || planDoc.authoringSession !== null);
  const runKnown = input.currentRunId !== null || input.currentSessionId !== null || input.currentRunAsks.length > 0;
  out.push(known && runKnown
    ? { check: "authorship_known", ok: true, status: "pass", blocker: null, remedy: null }
    : {
        check: "authorship_known", ok: false, status: "unknown",
        blocker: !known
          ? `Plan ${plan} records no source Agent Ask or authoring session, so "authored in this run" cannot be ruled out.`
          : "The current run and session ids were not supplied, so same-run authorship cannot be ruled out.",
        remedy: "No one-click control exists yet: pass --session-id, --run-ask or --run-id (or set ARCADIA_SESSION_ID); no card records Plan authorship."
      });
  return out;
}

export function selectNextPlan(rawInput: SelectorInput): Selection {
  const input = normalise(rawInput);
  const reasons: string[] = [];
  const refusals: Refusal[] = [];
  const eligible: { project: string; plan: PlanSummary; order: number }[] = [];

  if (input.preferences.length === 0) {
    refusals.push({
      project: null, plan: null, code: "no_candidate_plan",
      message: "No Project preference record was supplied (Decision 0122 gap: the repository has no preference store yet)."
    });
  }

  const seen = new Set<string>();
  input.preferences.forEach((pref, order) => {
    if (input.onlyProject !== null && pref.project !== input.onlyProject) return;
    if (seen.has(pref.project)) {
      refusals.push({ project: pref.project, plan: null, code: "no_candidate_plan", message: `Project ${pref.project} appears twice in the preference record; the first entry governs.` });
      return;
    }
    seen.add(pref.project);
    if (!SELECTOR_SLUG.test(pref.project)) {
      refusals.push({ project: null, plan: null, code: "no_candidate_plan", message: "A Project slug in the preference record is not a valid slug and was refused." });
      return;
    }
    if (!pref.included) {
      refusals.push({ project: pref.project, plan: null, code: "project_not_included", message: `Project ${pref.project} is not included in the preference record (Decision 0122).` });
      return;
    }
    const projectPlans = input.plans.filter(p => p.project === pref.project);
    const live = projectPlans.filter(p => p.status !== "complete" && p.status !== "superseded");
    // Decision 0122: only the chosen Plan is admissible; every other live Plan is explained, not chosen.
    for (const other of live.filter(p => p.slug !== pref.chosenPlan).sort((a, b) => cmp(a.slug, b.slug))) {
      if (!SELECTOR_SLUG.test(other.slug)) continue;
      refusals.push({ project: pref.project, plan: other.slug, code: "plan_not_in_project_preference", message: `Plan ${other.slug} is not ${pref.project}'s chosen Plan (Decision 0122).` });
    }
    if (pref.chosenPlan === null) {
      refusals.push({ project: pref.project, plan: null, code: "no_candidate_plan", message: `Project ${pref.project} has no chosen Plan in the preference record.` });
      return;
    }
    if (!SELECTOR_SLUG.test(pref.chosenPlan)) {
      refusals.push({ project: pref.project, plan: null, code: "no_candidate_plan", message: `Chosen Plan ${JSON.stringify(pref.chosenPlan)} is not a valid Plan slug and was refused.` });
      return;
    }
    const plan = projectPlans.find(p => p.slug === pref.chosenPlan) ?? null;
    if (plan === null || plan.status === "complete" || plan.status === "superseded") {
      refusals.push({ project: pref.project, plan: pref.chosenPlan, code: "no_candidate_plan", message: `Chosen Plan ${pref.chosenPlan} is missing or finished in ${pref.project}.` });
      return;
    }
    const here = authoredHere(plan, input);
    if (here !== null) {
      refusals.push({ project: pref.project, plan: plan.slug, code: "plan_authored_in_this_run", message: `Plan ${plan.slug} was authored in this run: ${here}.` });
      return;
    }
    if (plan.approvalReceipt === null) {
      refusals.push({ project: pref.project, plan: plan.slug, code: "plan_not_approved", message: `Plan ${plan.slug} has no operator approval receipt.` });
      return;
    }
    // Cycle: a previous Plan listed as its own successor is not a next Plan.
    const closing = input.closeOuts.find(c => c.project === pref.project && c.plan === plan.slug);
    if (closing !== undefined && closing.closed) {
      refusals.push({ project: pref.project, plan: plan.slug, code: "no_candidate_plan", message: `Plan ${plan.slug} is already closed out; it cannot be its own successor.` });
      return;
    }
    eligible.push({ project: pref.project, plan, order });
  });

  eligible.sort((a, b) => a.order - b.order || cmp(a.project, b.project) || cmp(a.plan.slug, b.plan.slug));
  const winner = eligible[0] ?? null;
  const chosen = winner === null ? null : { project: winner.project, plan: winner.plan.slug };

  if (winner !== null) {
    reasons.push(`Plan ${winner.plan.slug} is ${winner.project}'s chosen Plan in the operator preference record (Decision 0122).`);
    reasons.push(`It carries operator approval receipt ${winner.plan.approvalReceipt}.`);
    const queue = input.queues?.find(q => q.project === winner.project) ?? null;
    if (queue !== null && queue.activePlan !== null && queue.activePlan !== winner.plan.slug && queue.activePlanWaitsOnOperator) {
      reasons.push(`${winner.project}'s active Plan ${queue.activePlan} waits on the operator; Decision 0116 answered "Run the same Project's next Plan", so the Project is not skipped.`);
    }
    if (eligible.length > 1) {
      reasons.push(`${eligible.length} Projects were eligible; ties break by the preference record order, then Project slug, then Plan slug (code-unit order).`);
    }
  } else {
    reasons.push("No Plan is eligible; see the refusals.");
  }

  // With no chosen Plan only the global queue verdict is reportable, so the invalid live queue is still surfaced.
  const preflight = chosen === null || winner === null
    ? preflightFor("", "", input, null).filter(check => check.check === "queue_order_valid")
    : preflightFor(chosen.project, chosen.plan, input, winner.plan);
  const ready = chosen !== null && preflight.every(check => check.ok);

  const { now: _now, expires: _expires, ...stateInputs } = input;
  const stateHash = sha(stateInputs);
  const outcome = { chosen, reasons, refusals, preflight, ready };
  const previewFingerprint = sha(outcome);

  const cardId = chosen === null ? `next-plan-none-${stateHash.slice(0, 12)}` : `next-plan-${chosen.project}-${chosen.plan}`.slice(0, 120);
  const blockers = preflight.filter(check => !check.ok);
  const candidate = {
    schema: DECISION_CARD_SCHEMA,
    id: cardId,
    kind: "next-plan-selection",
    what: chosen === null
      ? "No next Plan can be chosen under the operator's Project preferences."
      : `Run ${chosen.project}'s next Plan ${chosen.plan}${blockers.length > 0 ? `; ${blockers.length} preflight check(s) are not passing` : ""}.`,
    options: chosen === null
      ? [
          { id: "record-preference", label: "Record a Project preference", consequence: "Nothing runs. The operator chooses a Project's Plan and inclusion in the preference record, then the selector is re-run." },
          { id: "hold", label: "Leave production without a next Plan", consequence: "Nothing changes. No Plan is activated and no Session starts for lack of a chosen Plan." }
        ]
      : [
          {
            id: "run-plan",
            label: `Run ${chosen.plan}`,
            consequence: `Would make ${chosen.plan} ${chosen.project}'s Plan for the next Session start and let production take its first eligible Action; changes no Action status or queue position. This preview changed nothing.`
          },
          { id: "hold", label: "Hold this Plan", consequence: `Nothing changes; ${chosen.plan} stays unstarted and ${chosen.project} keeps its current Plan.` }
        ],
    evidence: [
      { label: "Decision 0116: run the same Project's next Plan", url: BLOB + DECISION_0116_PATH },
      { label: "Decision 0122: admission follows the Project preference record", url: BLOB + DECISION_0122_PATH },
      ...(chosen === null ? [] : [{ label: `Plan ${chosen.plan}`, url: `${BLOB}docs/plans/${chosen.plan}.md` }])
    ],
    verb: chosen === null ? "answer" : "run",
    pins: {
      stateHash,
      ...(input.headSha !== null && /^[0-9a-f]{7,64}$/.test(input.headSha) ? { headSha: input.headSha } : {}),
      previewFingerprint
    },
    expires: input.expires,
    policy_match: null,
    receipt: null
  };
  const validated = validateDecisionCard(candidate, { now: new Date(input.now) });
  return {
    chosen, reasons, refusals, preflight, ready,
    card: validated.ok ? validated.card : null,
    cardErrors: validated.ok ? [] : validated.errors.map(error => `${error.code} ${error.path}: ${error.message}`),
    stateHash
  };
}
