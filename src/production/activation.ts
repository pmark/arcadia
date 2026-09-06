import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { buildAgentQueue, type AgentQueueEntry } from "../dispatch/queue.js";
import {
  MECHANICAL_TRANSITIONS,
  PRODUCTION_CONTROL_DEADLINES,
  fingerprintProductionScope,
  normalizeProductionScope,
  readProductionPolicySafely,
  type MechanicalTransition,
  type ProductionPolicyRead,
  type ProductionScope
} from "./policy.js";

/**
 * The activation preview is the whole authorization the operator is granting,
 * written down before they grant it. Contract 17 requires it to show the
 * included Projects and Plans, the resulting ordered Action scope, providers,
 * concurrency and exactly which mechanical transitions are delegated — and,
 * just as importantly, what activation does *not* buy.
 *
 * It writes nothing.
 */

export interface ProductionActivationPreviewInput {
  projects: string[];
  providers: string[];
  plans?: string[];
  maxConcurrentSessions?: number;
  mechanicalTransitions?: MechanicalTransition[];
  intent: string;
  now?: Date;
}

export interface PreviewedAction {
  actionKey: string;
  projectSlug: string;
  planSlug: string;
  title: string;
  state: AgentQueueEntry["state"];
  position: number | null;
  dependencies: string[];
}

export interface ProductionActivationPreview {
  generatedAt: string;
  scope: ProductionScope;
  scopeFingerprint: string;
  queueRevision: number;
  currentPolicy: ProductionPolicyRead;
  /** Revision to pass back to `activate --expect-revision`. */
  expectedRevision: number | null;
  includedProjects: string[];
  includedPlans: string[];
  orderedActions: PreviewedAction[];
  /** Requested Projects or Plans the queue does not currently offer. */
  unmatched: { projects: string[]; plans: string[] };
  /** Things activation deliberately does not authorize. */
  explicitStops: string[];
  controlDeadlines: typeof PRODUCTION_CONTROL_DEADLINES;
  offConsequence: string;
}

/**
 * The exact sentence shown beside the switch, so the operator never has to
 * infer what Off does. Contract 17's working default, stated plainly.
 */
export const PRODUCTION_OFF_CONSEQUENCE =
  "Off stops new admissions immediately and fences every reserved-but-unlaunched Action. " +
  "Work already committed to a launch keeps running and is reconciled; nothing is killed and nothing is deleted.";

const EXPLICIT_STOPS: readonly string[] = [
  "Merging, deploying, publishing, deleting, spending, using credentials, reaching production, or sending messages still needs its own Decision.",
  "A Plan not listed here is never activated automatically, even when it is next in the queue.",
  "Expanded scope, a new draft Plan, or changed consequential authority ends this authorization and needs a fresh grant.",
  "Product and UX judgment stays with the operator; only the listed mechanical transitions are delegated.",
  "Provider capacity is not granted here: unknown or stale capacity refuses admission rather than assuming free."
];

export function buildProductionActivationPreview(
  db: Database.Database,
  input: ProductionActivationPreviewInput
): ProductionActivationPreview {
  const generatedAt = (input.now ?? new Date()).toISOString();
  const requestedProjects = clean(input.projects);
  const requestedPlans = clean(input.plans ?? []);

  if (requestedProjects.length === 0) {
    throw validationError("Name at least one Project to include in managed production.", {
      field: "projects"
    });
  }

  const queue = buildAgentQueue(db, { now: input.now });
  const candidates = queue.ordered.filter(
    (entry) => entry.projectSlug !== null && entry.actionId !== null && entry.planSlug !== null
  );

  const matched = candidates.filter((entry) => {
    if (!requestedProjects.includes(entry.projectSlug!)) return false;
    if (requestedPlans.length === 0) return true;
    return requestedPlans.includes(`${entry.projectSlug}/${entry.planSlug}`);
  });

  const orderedActions: PreviewedAction[] = matched.map((entry) => ({
    actionKey: entry.orderKey ?? `${entry.projectSlug}/${entry.actionId}`,
    projectSlug: entry.projectSlug!,
    planSlug: entry.planSlug!,
    title: entry.actionTitle ?? entry.nextAction,
    state: entry.state,
    position: entry.position ?? null,
    dependencies: entry.dependencies ?? []
  }));

  const includedProjects = [...new Set(orderedActions.map((action) => action.projectSlug))].sort();
  const includedPlans = [
    ...new Set(orderedActions.map((action) => `${action.projectSlug}/${action.planSlug}`))
  ].sort();

  const scope = normalizeProductionScope({
    intent: input.intent,
    projects: includedProjects.length > 0 ? includedProjects : requestedProjects,
    plans: includedPlans.length > 0 ? includedPlans : requestedPlans,
    actions: orderedActions.map((action) => action.actionKey),
    providers: input.providers,
    maxConcurrentSessions: input.maxConcurrentSessions ?? 1,
    mechanicalTransitions: input.mechanicalTransitions ?? [...MECHANICAL_TRANSITIONS]
  });

  const currentPolicy = readProductionPolicySafely(db);

  return {
    generatedAt,
    scope,
    scopeFingerprint: fingerprintProductionScope(scope),
    queueRevision: queue.revision,
    currentPolicy,
    expectedRevision: currentPolicy.status === "ok" ? currentPolicy.policy.revision : null,
    includedProjects,
    includedPlans,
    orderedActions,
    unmatched: {
      projects: requestedProjects.filter((slug) => !includedProjects.includes(slug)),
      plans: requestedPlans.filter((key) => !includedPlans.includes(key))
    },
    explicitStops: [...EXPLICIT_STOPS],
    controlDeadlines: PRODUCTION_CONTROL_DEADLINES,
    offConsequence: PRODUCTION_OFF_CONSEQUENCE
  };
}

/**
 * Desired state and observed activity are different facts, so they are
 * reported as different fields. An unreadable store is its own status; it is
 * never rendered as Inactive.
 */
export type ProductionDisplayState =
  | "active_building"
  | "active_idle"
  | "inactive_finishing"
  | "inactive_idle"
  | "observation_unavailable";

export function describeProductionState(
  read: ProductionPolicyRead,
  liveAdmissions: number
): { state: ProductionDisplayState; label: string; observedAt: string } {
  if (read.status !== "ok") {
    return {
      state: "observation_unavailable",
      label: `Observation unavailable — ${read.reason}. This is not a confirmed Off.`,
      observedAt: read.observedAt
    };
  }
  if (read.policy.desiredState === "active") {
    return liveAdmissions > 0
      ? { state: "active_building", label: `Active · Building (${liveAdmissions} admitted)`, observedAt: read.observedAt }
      : { state: "active_idle", label: "Active · No admitted work", observedAt: read.observedAt };
  }
  return liveAdmissions > 0
    ? { state: "inactive_finishing", label: `Inactive · ${liveAdmissions} committed Action(s) finishing`, observedAt: read.observedAt }
    : { state: "inactive_idle", label: "Inactive · Idle", observedAt: read.observedAt };
}

function clean(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
