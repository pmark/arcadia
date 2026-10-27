import type { ProjectContinuationResponse } from "./arcadia-cli";
import type { WorkspaceScope } from "./workspace-scope";

/**
 * What Go says about one Project, read through the existing continuation route. The workspace renders this
 * resolution; it never selects work, reorders it or keeps its own copy of execution state.
 */
export interface GoAction {
  id: string;
  title: string;
  next: string | null;
  artifact: string | null;
  acceptance: string[];
  decisions: Array<{ slug: string; question: string; resolved: boolean }>;
}
export type GoMove =
  | { kind: "ready"; plan: string; milestone: string | null; action: GoAction }
  | { kind: "gated"; plan: string; milestone: string | null; action: GoAction; reason: string; remedy: string | null }
  | { kind: "none"; reason: string; remedy: string | null };

/** The body of GET /api/projects/{id}/continuation. */
export interface ContinuationBody { continuation: ProjectContinuationResponse }

export function goMove(c: ProjectContinuationResponse): GoMove {
  const blocker = c.blockers[0] ?? null;
  const reason = c.operatorQuestion ?? blocker?.message ?? null;
  const remedy = blocker?.remedy ?? null;
  if (!c.context) return { kind: "none", reason: reason ?? "Go found no current Action for this Project.", remedy };
  const { action: a, activePlan: plan, milestone } = c.context;
  const action: GoAction = {
    id: a.id,
    title: a.title,
    next: a.nextAction,
    artifact: a.expectedArtifact,
    acceptance: a.acceptanceCriteria,
    decisions: c.context.requiredDecisions.map(d => ({ slug: d.slug, question: d.question, resolved: d.resolved }))
  };
  // Go's own dispatchable verdict decides; the workspace never re-derives readiness.
  if (c.dispatchable) return { kind: "ready", plan, milestone, action };
  return { kind: "gated", plan, milestone, action, reason: reason ?? "Go reports this Action is not ready to dispatch.", remedy };
}

/** Where the selected record sits relative to Go's current work, so a selection is never mistaken for it. */
export type GoRelation = "project" | "plan" | "here" | "same-plan" | "other-plan";
export function goRelation(move: GoMove, scope: WorkspaceScope): GoRelation {
  if (move.kind === "none" || !scope.plan) return "project";
  if (scope.plan !== move.plan) return "other-plan";
  if (!scope.action) return "plan";
  return scope.action === move.action.id ? "here" : "same-plan";
}
