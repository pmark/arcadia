import { createHash } from "node:crypto";
import { loadGoContext, previewGuardedSessionLaunch, type ProjectContinuationResponse } from "./arcadia-cli";

/** Stable across observer timestamps and browser tabs; changed governed facts get a new identity. */
export function goResolutionIdentity(projectId: string, resolution: ProjectContinuationResponse): string {
  return createHash("sha256").update(JSON.stringify({ projectId, repoRoot: resolution.repoRoot,
    context: resolution.context, dispatchable: resolution.dispatchable,
    blockers: resolution.blockers, operatorQuestion: resolution.operatorQuestion })).digest("hex");
}

export class GoContinueConflict extends Error {
  constructor(public facts: unknown, message = "Go's resolution changed. Read again before continuing.") { super(message); }
}

/** Observer + existing protected preview only. This creates no candidate, claim or Session. */
export async function previewGoContinue(projectId: string, expected?: { plan: string; action: string; resolutionId?: string }) {
  const observation = (await loadGoContext(projectId)).data.projects[0];
  const resolution = observation?.resolution;
  const actual = { plan: resolution?.context?.activePlan ?? null, action: resolution?.context?.action.id ?? null,
    owner: resolution?.context?.action.responsibility ?? null, nextAction: resolution?.context?.action.nextAction ?? null,
    acceptance: resolution?.context?.action.acceptanceCriteria ?? [], limits: resolution?.context?.planTokenBudget ?? null,
    authorization: resolution?.context?.authorization ?? null, decisions: resolution?.context?.requiredDecisions ?? [],
    dispatchable: resolution?.dispatchable ?? false, blockers: resolution?.blockers ?? [], error: observation?.error ?? null };
  if (!resolution?.dispatchable || !resolution.context || observation.error || observation.discoveryErrors.length) {
    throw new GoContinueConflict(actual, "Go cannot dispatch this Action. Read again for its current gates.");
  }
  const resolutionId = goResolutionIdentity(projectId, resolution);
  if (expected && (actual.plan !== expected.plan || actual.action !== expected.action ||
    (expected.resolutionId !== undefined && resolutionId !== expected.resolutionId))) {
    throw new GoContinueConflict({ expected, actual });
  }
  const requestId = `workspace-continue:${resolutionId}`;
  const preview = (await previewGuardedSessionLaunch(resolution.repoRoot, requestId)).data;
  const target = `plan/${actual.plan}#${actual.action}`;
  if (preview.actionDocRef !== target) throw new GoContinueConflict({ expected: target, actual: preview.actionDocRef });
  return { ...preview, resolutionId, target: { projectId, plan: actual.plan!, action: actual.action! },
    owner: resolution.context.action.responsibility,
    limits: { actions: 1, sessions: 1, automaticNextAction: false, authorizationHours: 24,
      timeLimit: "No per-launch time limit override; existing Session and provider limits apply.",
      tokenBudget: resolution.context.planTokenBudget },
    repoRoot: resolution.repoRoot };
}
