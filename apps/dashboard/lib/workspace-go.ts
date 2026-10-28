import type { ProjectContinuationResponse } from "./arcadia-cli";
import type { WorkspaceScope } from "./workspace-scope";

/**
 * What Go says about one Project, read through the journal-free Go context route. The workspace renders this
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
export interface GoBlocker { message: string; remedy: string | null }
interface Placed { plan: string; milestone: string | null; action: GoAction }
export type GoMove =
  | ({ kind: "ready" } & Placed)
  /** Go names the question and every blocker separately; a remedy belongs only to its own blocker. */
  | ({ kind: "gated"; question: string | null; blockers: GoBlocker[] } & Placed)
  /** Nothing blocks it, but the Action is not an agent's to take: Go's authorization says whose it is. */
  | ({ kind: "not-agent"; responsibility: string; authorization: string } & Placed)
  | { kind: "none"; question: string | null; blockers: GoBlocker[] };

const isText = (value: unknown): value is string => typeof value === "string";
const isTextOrNull = (value: unknown) => value === null || isText(value);
/** Only a reply with Go's resolution shape is rendered; anything else is refused rather than half-shown. */
export function isContinuation(value: unknown): value is ProjectContinuationResponse {
  if (!value || typeof value !== "object") return false;
  const c = value as Partial<ProjectContinuationResponse>;
  if (typeof c.dispatchable !== "boolean" || !isTextOrNull(c.operatorQuestion ?? null) || !Array.isArray(c.blockers)) return false;
  if (!c.blockers.every(b => b && typeof b === "object" && isText(b.message))) return false;
  if (c.context === null) return true;
  const context = c.context;
  if (!context || typeof context !== "object" || !isText(context.activePlan) || !Array.isArray(context.requiredDecisions)) return false;
  const a = context.action;
  return Boolean(a) && isText(a.id) && isText(a.title) && isText(a.responsibility) && Array.isArray(a.acceptanceCriteria);
}

export function goMove(c: ProjectContinuationResponse): GoMove {
  const question = c.operatorQuestion ?? null;
  const blockers = c.blockers.map(b => ({ message: b.message, remedy: b.remedy || null }));
  if (!c.context) return { kind: "none", question, blockers };
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
  if (question || blockers.length) return { kind: "gated", plan, milestone, action, question, blockers };
  return { kind: "not-agent", plan, milestone, action, responsibility: a.responsibility, authorization: c.context.authorization };
}

/** Where the selected record sits relative to Go's current work, so a selection is never mistaken for it. */
export type GoRelation = "project" | "plan" | "here" | "same-plan" | "other-plan";
export function goRelation(move: GoMove, scope: WorkspaceScope): GoRelation {
  if (move.kind === "none" || !scope.plan) return "project";
  if (scope.plan !== move.plan) return "other-plan";
  if (!scope.action) return "plan";
  return scope.action === move.action.id ? "here" : "same-plan";
}

/** A read older than this is repeated the next time the workspace asks for that Project. */
export const GO_REREAD_AFTER_MS = 5 * 60_000;
/**
 * Decides synchronously whether to read Go, so a repeated mount (React StrictMode runs effects twice in
 * development) cannot start a duplicate observer read. One read per Project is in flight at a time.
 */
export function createGoReadGate(freshMs = GO_REREAD_AFTER_MS) {
  const inFlight = new Set<string>();
  const attemptedAt = new Map<string, number>();
  return {
    /** True when a read should start now; `force` (Read again) skips only the freshness check. */
    begin(projectId: string, now: number, force = false): boolean {
      if (inFlight.has(projectId)) return false;
      const at = attemptedAt.get(projectId);
      if (!force && at !== undefined && now - at < freshMs) return false;
      inFlight.add(projectId);
      return true;
    },
    end(projectId: string, now: number) {
      inFlight.delete(projectId);
      attemptedAt.set(projectId, now);
    }
  };
}
