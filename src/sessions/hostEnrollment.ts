import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { renderNextSuccess, runNextReadOnlyCommand } from "../commands/next.js";
import { runGoCommand } from "../commands/go.js";
import { withDatabase } from "../db/connection.js";
import { discoverDocs } from "../docs/discover.js";
import { runGoBroker, type GoBrokerAgent } from "../goBroker.js";
import { readProductionPolicySafely } from "../production/policy.js";
import { requireResolvedWorkspace } from "../workspace/resolve.js";
import { enrollGovernedSession, type EnrollmentReceipt } from "./enrollment.js";
import type { EnrollmentRequest, GovernedEnrollmentContext } from "./enrollment.js";
import { getActiveActionClaim } from "./index.js";
import { launchGuardedHostSession, type GuardedLaunchInput } from "./launch.js";

/**
 * Managed-production enrollment has exactly one executable path: the existing
 * guarded launcher. Its admission issue/commit, Off recheck, claim fencing and
 * cleanup therefore remain authoritative; enrollment adds replay identity but
 * cannot substitute a command or weaker launch implementation.
 */
export function enrollManagedHostSession(input: {
  db: Database.Database;
  request: EnrollmentRequest & { mode: "managed-launch" };
  context: GovernedEnrollmentContext;
  launch: GuardedLaunchInput;
}): EnrollmentReceipt {
  if (input.launch.db !== input.db || input.launch.requestId !== input.request.requestId ||
      input.launch.projectSlug !== input.request.projectSlug) {
    throw validationError("Managed enrollment and guarded launch identities do not match.", { code: "enrollment_launch_identity_changed" });
  }
  return enrollGovernedSession(input.db, input.request, {
    resolve: () => input.context,
    prepare: () => { throw validationError("Managed enrollment cannot use the preparation adapter."); },
    launch: () => {
      const result = launchGuardedHostSession(input.launch);
      return { id: result.session.id, worktree: result.session.worktree_path };
    }
  });
}

/**
 * Canonical fixed prepare-mode enrollment used by the protected transport.
 * The request carries only its nonce and launcher-fixed provider; all governed
 * identity, execution metadata, gates and claims are derived on the host.
 */
export function executeHostEnrollment(source: string, agent: GoBrokerAgent, requestId: string, callerId: string): EnrollmentReceipt {
  if (process.env.CODEX_SANDBOX) throw validationError("Enrollment must run on the host.");
  const workspace = requireResolvedWorkspace({ cwd: source });
  const project = discoverDocs(source).docs.find(doc => doc.type === "project");
  if (!project || project.type !== "project") throw validationError("Enrollment source has no managed Project document.");
  const next = runNextReadOnlyCommand({ workspace, project: project.slug });
  const dispatch = next.data.context;
  if (!next.data.dispatchable || !dispatch) {
    throw validationError("The configured Project has no dispatchable Action to enroll.", { blockers: next.data.blockers });
  }
  const requirementId = `${dispatch.projectSlug}/${dispatch.activePlan}/${dispatch.action.id}`;
  const inputRevision = createHash("sha256").update(JSON.stringify({
    nextAction: dispatch.action.nextAction,
    acceptanceCriteria: dispatch.action.acceptanceCriteria,
    responsibility: dispatch.action.responsibility,
    execution: dispatch.action.resolvedExecution ?? dispatch.action.execution ?? null
  })).digest("hex");

  const enrollmentRequest = {
    requestId,
    source,
    agent,
    callerId,
    mode: "prepare",
    projectSlug: dispatch.projectSlug,
    planSlug: dispatch.activePlan,
    actionId: dispatch.action.id,
    requirementId,
    inputRevision
  } as const;

  return withDatabase(workspace, db => enrollGovernedSession(db, enrollmentRequest, {
    resolve: () => {
      const policy = readProductionPolicySafely(db);
      const claim = getActiveActionClaim(db, next.data.repoRoot, dispatch.projectSlug, dispatch.action.id);
      return {
        projectSlug: dispatch.projectSlug,
        planSlug: dispatch.activePlan,
        actionId: dispatch.action.id,
        canonicalBrief: renderNextSuccess(next).join("\n"),
        operatorGates: next.data.operatorAlerts.map(item => `${item.kind}:${item.id}`),
        provider: agent,
        model: dispatch.planRecommendedModel ?? "configured-default",
        effort: dispatch.planRecommendedReasoningEffort,
        policyState: policy.status === "ok" && policy.policy.desiredState === "active" ? "active" : "off",
        policyEpoch: policy.status === "ok" ? policy.policy.epoch : 0,
        packetApproved: dispatch.action.resolvedExecution !== null,
        capacityAvailable: true,
        existingClaim: claim ? { id: claim.id, worktree: claim.worktree_path, generation: claim.claim_generation! } : null
      };
    },
    prepare: ({ context }) => {
      if (context.existingClaim) return { id: context.existingClaim.id, worktree: context.existingClaim.worktree };
      const response = runGoBroker(
        { source, agent, operation: "go" },
        options => runGoCommand({ ...options, strictAction: true })
      );
      const data = response.data as { nextWorktree?: { path: string } | null };
      if (!data.nextWorktree) throw validationError("Protected enrollment did not produce a candidate.");
      const claim = getActiveActionClaim(db, next.data.repoRoot, dispatch.projectSlug, dispatch.action.id);
      if (!claim || claim.worktree_path !== data.nextWorktree.path) {
        throw validationError("Protected enrollment could not verify the candidate's fenced Action claim.");
      }
      return { id: claim.id, worktree: claim.worktree_path };
    },
    launch: () => { throw validationError("Prepare-mode enrollment cannot launch a Session."); },
    recover: ({ request, context }) => context.existingClaim ? {
      enrollmentId: `enrollment_recovered_${createHash("sha256").update(request.requestId).digest("hex").slice(0, 24)}`,
      requestId: request.requestId,
      mode: request.mode,
      projectSlug: context.projectSlug,
      planSlug: context.planSlug,
      actionId: context.actionId,
      callerId: request.callerId,
      canonicalBrief: context.canonicalBrief,
      operatorGates: [...context.operatorGates],
      execution: { provider: context.provider, model: context.model, effort: context.effort },
      requirementId: request.requirementId,
      inputRevision: request.inputRevision,
      claim: context.existingClaim,
      principal: { kind: "prepared", id: context.existingClaim.id, worktree: context.existingClaim.worktree },
      createdAt: new Date().toISOString()
    } : null
  }));
}
