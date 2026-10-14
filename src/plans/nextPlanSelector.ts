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
  "no_candidate_plan",
  "project_has_active_plan"
] as const;
export type RefusalCode = (typeof REFUSAL_CODES)[number];

export const PREFLIGHT_CHECKS = [
  "queue_order_valid",
  "no_open_red_alert",
  "previous_plan_closed_out",
  "pointer_free",
  "authorship_known",
  "active_plan_known"
] as const;
export type PreflightCheckName = (typeof PREFLIGHT_CHECKS)[number];

export interface ProjectPreference {
  project: string;
  included: boolean;
  /** The Project's chosen Plan slug under Decision 0122, or null when none is chosen. */
  chosenPlan: string | null;
  /**
   * The operator's approval receipt (record id or hash) for this choice. A Plan is approved under
   * Decision 0122 only when the operator-owned record names it WITH a non-empty receipt; a Plan's own
   * `active` status proves a settlement landed, not operator approval.
   */
  receipt: string | null;
}

export interface PlanSummary {
  project: string;
  slug: string;
  /** draft | active | complete | superseded (parsed Plan status). */
  status: string;
  /** True when the Plan file exists on main (injected), so a repository URL would not 404. */
  onMain: boolean;
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
  /** true/false when tied to the active Plan; null when it cannot be tied (unknown, never a bypass). */
  activePlanWaitsOnOperator: boolean | null;
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
  /** The Plan the entry belongs to; waiting is tied to the active Plan by this slug. */
  planSlug?: string | null;
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
    // Waiting is about the ACTIVE Plan, not the Project: only an attention entry whose planSlug equals the
    // active Plan's slug counts. Waiting-kind entries with no planSlug cannot be tied, so waiting is unknown.
    const activeSlug = activePlans[project] ?? null;
    const waitingEntries = (queue.attention ?? []).filter(e => e.projectSlug === project && e.attentionKind != null && waitingKinds.has(e.attentionKind));
    let waits: boolean | null;
    if (activeSlug === null) waits = null;
    else if (waitingEntries.some(e => e.planSlug === activeSlug)) waits = true;
    else if (waitingEntries.some(e => typeof e.planSlug !== "string" || e.planSlug === "")) waits = null;
    else waits = false;
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
  /**
   * Each Project's active Plan slug from the checked-in pointer (PROJECT.md `active_plan`); null means the
   * Project has none. A Project absent from this record has an UNKNOWN active Plan.
   */
  activePlans?: Record<string, string | null>;
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
  /** Where each caller-relevant input came from. Anything not marked "live" is treated as caller-supplied. */
  inputSources?: Partial<Record<InputName, "live" | "caller">>;
  /** Clock values are injected; they never enter the state hash. `expires` is derived from `now`. */
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

export const INPUT_NAMES = ["preferences", "queue", "redAlerts", "runId", "sessionId", "runAsks"] as const;
export type InputName = (typeof INPUT_NAMES)[number];

export interface Selection {
  /** Provenance of every caller-relevant input; caller-supplied inputs are pinned into stateHash. */
  inputs: { name: InputName; source: "live" | "caller" }[];
  /** Honest gaps, including every caller-supplied (unverified) input. */
  gaps: string[];
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
      project: String(p.project ?? ""), included: p.included === true, chosenPlan: str(p.chosenPlan),
      receipt: nonEmpty(p.receipt) ? p.receipt : null
    })),
    plans: arr<Record<string, unknown>>(input.plans).map(p => ({
      project: String(p.project ?? ""), slug: String(p.slug ?? ""), status: String(p.status ?? ""),
      onMain: p.onMain === true,
      sourceAsks: arr<string>(p.sourceAsks).map(String).sort(cmp), authoringSession: str(p.authoringSession)
    })),
    queues: input.queues === null ? null : arr<Record<string, unknown>>(input.queues).map(q => ({
      project: String(q.project ?? ""), orderValid: q.orderValid === true,
      unpositionedCount: typeof q.unpositionedCount === "number" ? q.unpositionedCount : Number.POSITIVE_INFINITY,
      runningActions: arr<string>(q.runningActions).map(String),
      activePlan: str(q.activePlan),
      activePlanWaitsOnOperator: typeof q.activePlanWaitsOnOperator === "boolean" ? q.activePlanWaitsOnOperator : null
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
    activePlans: Object.fromEntries(Object.entries(input.activePlans ?? {})
      .map(([project, slug]) => [project, typeof slug === "string" ? slug : null])),
    inputSources: Object.fromEntries(INPUT_NAMES.map(name => [name, input.inputSources?.[name] === "live" ? "live" : "caller"])),
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

/** The Project's active Plan: queue first, then the PROJECT.md pointer. undefined = unknown, null = none. */
function activeSlugOf(project: string, input: SelectorInput): string | null | undefined {
  const queue = input.queues?.find(q => q.project === project) ?? null;
  if (queue !== null && queue.activePlan !== null) return queue.activePlan;
  const pointers = input.activePlans ?? {};
  if (Object.prototype.hasOwnProperty.call(pointers, project)) return pointers[project];
  if (queue !== null) return null;
  return undefined;
}

/** Receipt text for display: control and format characters stripped, at most 80 characters. */
function displayReceipt(receipt: string): string {
  const cleaned = receipt.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "");
  return cleaned.length > 80 ? `${cleaned.slice(0, 80)}...` : cleaned;
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

  const activeKnown = activeSlugOf(project, input);
  out.push(activeKnown === undefined
    ? {
        check: "active_plan_known", ok: false, status: "unknown",
        blocker: `The active Plan of ${project} is unknown: the queue is unreadable and PROJECT.md was not read.`,
        remedy: "No one-click control exists yet: re-run once the queue or PROJECT.md active_plan can be read."
      }
    : { check: "active_plan_known", ok: true, status: "pass", blocker: null, remedy: null });

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
  const eligible: { project: string; plan: PlanSummary; order: number; receipt: string }[] = [];

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
    if (pref.receipt === null) {
      refusals.push({ project: pref.project, plan: plan.slug, code: "plan_not_approved", message: `Plan ${plan.slug} is named in the preference record without an operator approval receipt (Decision 0122).` });
      return;
    }
    // Decision 0116 allows the Project's NEXT Plan only while its active Plan waits on the operator.
    const queueOf = input.queues?.find(q => q.project === pref.project) ?? null;
    const activeSlug = activeSlugOf(pref.project, input) ?? null;
    const activeDoc = activeSlug === null ? null : projectPlans.find(p => p.slug === activeSlug) ?? null;
    const activeIsLive = activeSlug !== null && (activeDoc === null || (activeDoc.status !== "complete" && activeDoc.status !== "superseded"));
    if (activeIsLive && activeSlug !== plan.slug && queueOf?.activePlanWaitsOnOperator !== true) {
      const unknownWait = queueOf === null || queueOf.activePlanWaitsOnOperator === null;
      refusals.push({
        project: pref.project, plan: plan.slug, code: "project_has_active_plan",
        message: `Project ${pref.project} already has active Plan ${activeSlug} that ${unknownWait ? "is not known to be waiting" : "is not waiting"} on the operator; Decision 0116 allows the next Plan only while the active one waits.`
      });
      return;
    }
    // Cycle: a previous Plan listed as its own successor is not a next Plan.
    const closing = input.closeOuts.find(c => c.project === pref.project && c.plan === plan.slug);
    if (closing !== undefined && closing.closed) {
      refusals.push({ project: pref.project, plan: plan.slug, code: "no_candidate_plan", message: `Plan ${plan.slug} is already closed out; it cannot be its own successor.` });
      return;
    }
    eligible.push({ project: pref.project, plan, order, receipt: pref.receipt });
  });

  eligible.sort((a, b) => a.order - b.order || cmp(a.project, b.project) || cmp(a.plan.slug, b.plan.slug));
  const winner = eligible[0] ?? null;
  const chosen = winner === null ? null : { project: winner.project, plan: winner.plan.slug };

  if (winner !== null) {
    reasons.push(`Plan ${winner.plan.slug} is ${winner.project}'s chosen Plan in the operator preference record (Decision 0122).`);
    reasons.push(`receipt claimed (caller-supplied, unverified): ${displayReceipt(winner.receipt)}`);
    const queue = input.queues?.find(q => q.project === winner.project) ?? null;
    if (queue !== null && queue.activePlan !== null && queue.activePlan !== winner.plan.slug && queue.activePlanWaitsOnOperator === true) {
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

  const inputs = INPUT_NAMES.map(name => ({ name, source: input.inputSources?.[name] ?? "caller" }));
  const callerInputs = inputs.filter(item => item.source === "caller").map(item => item.name);
  const gaps: string[] = [];
  if (callerInputs.includes("preferences")) {
    gaps.push("preferences are caller-supplied and unverified: no operator preference store exists yet (Decision 0122; Action record-production-project-preferences).");
  }
  const otherCaller = callerInputs.filter(name => name !== "preferences");
  if (otherCaller.length > 0) gaps.push(`caller-supplied and unverified inputs: ${otherCaller.join(", ")}.`);

  const { now: _now, expires: _expires, ...stateInputs } = input;
  // The pinned state includes ready, the blocker codes and every preflight status, so a card cannot be
  // separated from the preflight it was issued with. `expires` is derived from the injected `now` and
  // is deliberately outside the hash.
  const stateHash = sha({
    inputs: stateInputs,
    ready,
    preflight: preflight.map(check => `${check.check}:${check.status}`)
  });
  const outcome = { chosen, reasons, refusals, preflight, ready, inputs };
  const previewFingerprint = sha(outcome);

  const blockers = preflight.filter(check => !check.ok);
  const blockerCodes = blockers.map(check => `${check.check}:${check.status}`);
  const cardId = chosen === null ? `next-plan-none-${stateHash.slice(0, 12)}` : `next-plan-${chosen.project}-${chosen.plan}`.slice(0, 120);
  const planPath = chosen === null ? null : `docs/plans/${chosen.plan}.md`;
  const BLOCKED_LABEL = "Resolve the named blockers first";
  const provenance = callerInputs.length > 0 ? ` Caller-supplied, unverified inputs: ${callerInputs.join(", ")}.` : "";
  const callerNote = callerInputs.includes("preferences") ? ", based on a caller-supplied, unverified preference record" : "";
  let options;
  let what: string;
  let verb: "run" | "answer";
  if (chosen === null) {
    verb = "answer";
    what = "Advisory only: no next Plan can be chosen under the operator's Project preferences.";
    options = [{
      id: "resolve-blockers", label: BLOCKED_LABEL,
      consequence: `No change: ${refusals.map(r => r.code).sort(cmp).filter((c, i, all) => all.indexOf(c) === i).join(", ") || "no_candidate_plan"}; remedy: record the Project's chosen Plan and its approval receipt in the operator preference record (no one-click control exists yet; Action record-production-project-preferences).${provenance}`.slice(0, 1000)
    }];
  } else if (!ready) {
    verb = "answer";
    what = `Advisory only: ${chosen.project}'s next Plan ${chosen.plan} is selected but not ready; ${blockers.length} preflight check(s) are not passing${callerNote}.`;
    const first = blockers[0];
    options = [{
      id: "resolve-blockers", label: BLOCKED_LABEL,
      consequence: `No change: ${blockerCodes.join(", ")}; remedy: ${first.remedy ?? "none named"}${blockers.length > 1 ? ` (further remedies are in the preflight output)` : ""}.${provenance}`.slice(0, 1000)
    }];
  } else {
    verb = "run";
    what = `Advisory only: ${chosen.project}'s next Plan ${chosen.plan} is ready to be activated${callerNote}.`;
    options = [{
      id: "run-plan", label: `Run ${chosen.plan}`,
      consequence: `Preview only: pressing grants nothing and starts nothing; activating Plan ${chosen.plan} is the governed Agent Ask settlement \`arcadia agent-ask settle --activate\` (src/ask/settlement.ts), which changes PROJECT.md active_plan and which the operator merges.${provenance}`.slice(0, 1000)
    }];
  }
  const evidence: { label: string; url?: string; fingerprint?: string }[] = [
    { label: "Decision 0116: run the same Project's next Plan", url: BLOB + DECISION_0116_PATH },
    { label: "Decision 0122: admission follows the Project preference record", url: BLOB + DECISION_0122_PATH }
  ];
  if (chosen !== null && winner !== null && planPath !== null) {
    // A URL only when the Plan file exists on main; an unmerged Plan would 404.
    evidence.push(winner.plan.onMain
      ? { label: `Plan ${planPath}`, url: `${BLOB}${planPath}` }
      : { label: `Plan ${planPath} (not on main; no link)` });
  }
  evidence.push({ label: `Ready: ${ready}`, fingerprint: stateHash });
  for (const check of preflight) evidence.push({ label: `Preflight ${check.check}: ${check.status}` });
  if (callerInputs.length > 0) evidence.push({ label: `Caller-supplied inputs (unverified): ${callerInputs.join(", ")}` });

  const candidate = {
    schema: DECISION_CARD_SCHEMA,
    id: cardId,
    kind: "advisory-next-plan-selection",
    what,
    options,
    evidence,
    verb,
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
    inputs, gaps, chosen, reasons, refusals, preflight, ready,
    card: validated.ok ? validated.card : null,
    cardErrors: validated.ok ? [] : validated.errors.map(error => `${error.code} ${error.path}: ${error.message}`),
    stateHash
  };
}
