import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import type { AgentAskProposal, NormalizedAgentAsk, NormalizedAgentAskAction, NormalizedAgentAskOption } from "./agentAsk.js";
import { validationError } from "../cli/errors.js";
import { writeTransaction } from "../db/connection.js";
import { createArtifactRecord, getProjectBySlug, getProjectMetadata } from "../db/repositories.js";
import { discoverDocs } from "../docs/discover.js";
import { resolveActionReadiness } from "../docs/dispatch.js";
import { yamlScalar } from "../docs/frontmatter.js";
import { syncProjectDocs } from "../docs/sync.js";
import type { DecisionDoc, LogDoc, PlanDoc, ProjectDoc } from "../docs/types.js";
import { buildAgentQueue, unpositionedCountForProject } from "../dispatch/queue.js";
import { arrangeActionOrder } from "../dispatch/order.js";
import { assertClean, git } from "../git/worktrees.js";
import { slugify } from "../utils/slug.js";

export type AgentAskDisposition = "accepted" | "rejected";
export type AgentAskResponsibility = "autonomous" | "agent";
export type AgentAskPlacement = "top" | "before" | "after";

interface FileMutation { path: string; before: string | null; after: string; }

export interface AgentAskSettlementReceipt {
  id: string;
  proposalId: string;
  proposalRequestId: string;
  settlementRequestId: string;
  disposition: AgentAskDisposition;
  projectSlug: string;
  intent: string;
  effects: string[];
  queueActionKey: string | null;
  queueActionKeys: string[];
  queuePosition: number | null;
  nextActionKey: string | null;
  previewFingerprint: string;
  applied: boolean;
  authority: { kind: "operator_acceptance"; requestedAuthority: string; boundedPolicyDecision: null };
  notificationStatus: "withheld_until_apply" | "pending" | "sent";
  createdAt: string;
}

export interface PendingAgentAskNotification {
  settlementId: string;
  projectSlug: string;
  disposition: AgentAskDisposition;
  intent: string;
  effects: string[];
  queueActionKey: string | null;
  queueActionKeys: string[];
  queuePosition: number | null;
  nextActionKey: string | null;
  createdAt: string;
}

export function settleAgentAsk(db: Database.Database, input: {
  proposalRef: string;
  settlementRequestId: string;
  disposition: AgentAskDisposition;
  responsibility?: AgentAskResponsibility;
  placement?: AgentAskPlacement;
  anchor?: string;
  expectedQueueRevision?: number;
  previewFingerprint?: string;
  apply?: boolean;
}): AgentAskSettlementReceipt {
  const operation = {
    proposalRef: input.proposalRef,
    disposition: input.disposition,
    responsibility: input.responsibility ?? null,
    placement: input.placement ?? null,
    anchor: input.anchor ?? null
  };
  const existingByRequest = db.prepare("SELECT operation_json, receipt_json FROM agent_ask_settlements WHERE request_id = ?")
    .get(input.settlementRequestId) as { operation_json: string; receipt_json: string } | undefined;
  if (existingByRequest) {
    if (existingByRequest.operation_json !== JSON.stringify(operation)) {
      throw validationError("Agent Ask settlement request id was already used for a different operation.");
    }
    return JSON.parse(existingByRequest.receipt_json) as AgentAskSettlementReceipt;
  }

  const proposalRow = db.prepare(`SELECT proposal_json FROM agent_ask_proposals
    WHERE id = ? OR request_id = ?`).get(input.proposalRef, input.proposalRef) as { proposal_json: string } | undefined;
  if (!proposalRow) throw validationError("Agent Ask proposal was not found.", { proposal: input.proposalRef });
  const proposal = JSON.parse(proposalRow.proposal_json) as AgentAskProposal;
  const existingSettlement = db.prepare("SELECT receipt_json FROM agent_ask_settlements WHERE proposal_id = ?").get(proposal.id) as { receipt_json: string } | undefined;
  if (existingSettlement) {
    throw validationError("Agent Ask proposal is already settled.", {
      settlement: (JSON.parse(existingSettlement.receipt_json) as AgentAskSettlementReceipt).id
    });
  }
  if (proposal.normalized.project === "unknown") {
    throw validationError("Agent Ask must resolve an explicit Project before settlement.");
  }
  const project = getProjectBySlug(db, proposal.normalized.project);
  const metadata = project ? getProjectMetadata(db, project.id) : null;
  if (!project || !metadata?.repo_path) throw validationError("Agent Ask Project repository is not configured.");
  const repoRoot = path.resolve(metadata.repo_path);
  const queue = buildAgentQueue(db);
  if (input.expectedQueueRevision !== undefined && queue.revision !== input.expectedQueueRevision) {
    throw validationError("Action queue revision changed; refresh the Agent Ask settlement preview.", {
      expectedRevision: input.expectedQueueRevision,
      actualRevision: queue.revision
    });
  }

  const fileMutations: FileMutation[] = [];
  let queueActionKey: string | null = null;
  let queueActionKeys: string[] = [];
  let queueAfter = queue.ordered.flatMap((entry) => entry.orderKey ? [entry.orderKey] : []);
  const actionIdsToValidate: string[] = [];
  let arrangeQueue = false;
  let artifactInput: { title: string; path?: string } | null = null;
  const effects: string[] = [];

  if (input.disposition === "rejected") {
    effects.push("Preserved the proposal and created no Project or queue changes.");
  } else {
    const discovered = discoverDocs(repoRoot);
    const projectDoc = discovered.docs.find((doc): doc is ProjectDoc => doc.type === "project" && doc.slug === project.slug);
    const plan = discovered.docs.find(
      (doc): doc is PlanDoc => doc.type === "plan" && doc.project === project.slug && doc.slug === projectDoc?.activePlan
    );
    if (!projectDoc || !plan) throw validationError("Agent Ask Project has no resolvable active managed Plan.");
    const projectPath = path.join(repoRoot, projectDoc.relativePath);
    const activePlanPath = path.join(repoRoot, plan.relativePath);
    const targetRef = proposal.normalized.targetRef;

    switch (proposal.normalized.intent) {
      case "action": {
        const planBefore = readFileSync(activePlanPath, "utf8");
        if (targetRef) {
          if (proposal.normalized.acceptance.length === 0) {
            throw validationError("Accepted Action settlement requires at least one observable acceptance criterion in the proposal.");
          }
          const dependencies = normalizeDependencies(proposal.normalized.dependencies, project.slug);
          const unknownDependencies = dependencies.filter((dependency) => !plan.actions.some((action) => action.id === dependency));
          if (unknownDependencies.length > 0) throw validationError("Agent Ask names dependencies outside the active Plan.", { dependencies: unknownDependencies });
          if (input.placement) throw validationError("Action amendment preserves its existing queue position.");
          const actionId = resolveManagedTargetRef(targetRef, "action", project.slug);
          if (!plan.actions.some((action) => action.id === actionId)) throw validationError("Agent Ask Action amendment target was not found.", { targetRef });
          queueActionKey = `${project.slug}/${actionId}`;
          queueActionKeys = [queueActionKey];
          actionIdsToValidate.push(actionId);
          fileMutations.push({
            path: activePlanPath,
            before: planBefore,
            after: amendAction(planBefore, actionId, proposal.normalized.desiredResult, proposal.normalized.acceptance,
              dependencies, proposal.normalized.references, proposal.normalized.requestId, input.responsibility)
          });
          effects.push(`Amended Action ${queueActionKey} in active Plan ${plan.slug}.`);
          if (input.responsibility) {
            effects.push(`Set Responsibility to ${input.responsibility} on the operator's explicit direction, per Decision 0045.`);
          } else {
            effects.push("Preserved the Action's existing Responsibility and queue position.");
          }
        } else {
          if (!input.responsibility) throw validationError("Accepted Action settlement requires --responsibility autonomous or agent.");
          const unpositionedInProject = unpositionedCountForProject(queue, project.slug);
          if (unpositionedInProject > 0) throw validationError("Position every existing approved Action in this Plan before accepting another into the queue.", { unpositionedCount: unpositionedInProject });
          if (!input.placement) throw validationError("Accepted Action settlement requires --top, --before, or --after.");
          const proposedActions = (proposal.normalized.actions ?? []).length > 0
            ? proposal.normalized.actions
            : [{ id: null, desiredResult: proposal.normalized.desiredResult, acceptance: proposal.normalized.acceptance,
              dependencies: proposal.normalized.dependencies, references: proposal.normalized.references, targetRef: null }];
          if (proposedActions.some((action) => action.acceptance.length === 0)) {
            throw validationError("Every accepted Action requires at least one observable acceptance criterion in the proposal.");
          }
          const takenIds = new Set(plan.actions.map((action) => action.id));
          const actionIds = proposedActions.map((action) => (action.id
            ? claimExplicitActionId(takenIds, action.id)
            : allocateUniqueActionId(takenIds, deriveActionId(action.desiredResult))));
          const availableIds = new Set([...takenIds, ...actionIds]);
          const normalizedActions = proposedActions.map((action, index) => {
            const dependencies = normalizeDependencies(action.dependencies, project.slug);
            const unknownDependencies = dependencies.filter((dependency) => !availableIds.has(dependency));
            if (unknownDependencies.length > 0) {
              throw validationError("Agent Ask names dependencies outside the active Plan or proposed Action bundle.", {
                action: actionIds[index], dependencies: unknownDependencies
              });
            }
            return { ...action, id: actionIds[index]!, dependencies };
          });
          // A cycle inside the bundle would leave every Action in it waiting on
          // another forever — permanently ineligible, with no event that could
          // ever free them. The Plan paths already refuse one; so does this.
          dependencyOrderedActionIds(normalizedActions.map((action) => ({ id: action.id, dependencies: action.dependencies })));
          queueActionKeys = actionIds.map((actionId) => `${project.slug}/${actionId}`);
          queueActionKey = queueActionKeys[0]!;
          actionIdsToValidate.push(...actionIds);
          arrangeQueue = true;
          let planAfter = planBefore;
          for (const action of normalizedActions) {
            planAfter = appendAction(planAfter, {
              id: action.id, title: action.desiredResult, responsibility: input.responsibility,
              acceptance: action.acceptance, dependencies: action.dependencies, references: action.references,
              source: `Agent Ask ${proposal.normalized.requestId}`
            });
          }
          fileMutations.push({
            path: activePlanPath,
            before: planBefore,
            after: planAfter
          });
          queueAfter = insertQueueKeys(queueAfter, queueActionKeys, input.placement, input.anchor);
          effects.push(`Created ${queueActionKeys.length} Action${queueActionKeys.length === 1 ? "" : "s"} in active Plan ${plan.slug}: ${queueActionKeys.join(", ")}.`);
          effects.push(`Assigned Responsibility ${input.responsibility} to the accepted Action${queueActionKeys.length === 1 ? "" : "s"}.`);
          effects.push(`Inserted the Action${queueActionKeys.length === 1 ? "" : " bundle"} starting at queue position ${queueAfter.indexOf(queueActionKey) + 1}.`);
        }
        break;
      }
      case "outcome": {
        requireNoQueueOptions(input);
        const before = readFileSync(projectPath, "utf8");
        fileMutations.push({ path: projectPath, before, after: replaceTopLevelField(before, "goal", proposal.normalized.desiredResult) });
        effects.push(`Updated Project ${project.slug} Outcome.`);
        break;
      }
      case "project_update": {
        requireNoQueueOptions(input);
        if (targetRef === "outcome" || targetRef === "goal") {
          const before = readFileSync(projectPath, "utf8");
          fileMutations.push({ path: projectPath, before, after: replaceTopLevelField(before, "goal", proposal.normalized.desiredResult) });
          effects.push(`Updated Project ${project.slug} Outcome.`);
        } else if (targetRef === "milestone") {
          addMilestoneMutations(fileMutations, projectPath, activePlanPath, proposal.normalized.desiredResult);
          effects.push(`Updated Project ${project.slug} and active Plan ${plan.slug} Milestone.`);
        } else {
          addDecisionMutation(fileMutations, discovered.docs.filter((doc): doc is DecisionDoc => doc.type === "decision"), repoRoot, project.slug,
            plan.slug, null, `How should this Project update be applied: ${proposal.normalized.desiredResult}`, proposal.normalized.rationale, proposal.normalized.requestId);
          effects.push("Created one open Decision because the Project update target was not explicit.");
        }
        break;
      }
      case "milestone": {
        requireNoQueueOptions(input);
        addMilestoneMutations(fileMutations, projectPath, activePlanPath, proposal.normalized.desiredResult);
        effects.push(`Updated Project ${project.slug} and active Plan ${plan.slug} Milestone.`);
        break;
      }
      case "plan": {
        if (targetRef) {
          const targetSlug = resolveManagedTargetRef(targetRef, "plan", project.slug);
          const target = discovered.docs.find((doc): doc is PlanDoc => doc.type === "plan" && doc.project === project.slug && doc.slug === targetSlug);
          if (!target) throw validationError("Agent Ask Plan amendment target was not found.", { targetRef });
          const targetPath = path.join(repoRoot, target.relativePath);
          const before = readFileSync(targetPath, "utf8");
          const proposedActions = proposal.normalized.actions;
          if (proposedActions.length === 0) {
            if (input.placement) {
              if (input.responsibility) throw validationError("Plan reprioritization preserves existing Action Responsibilities.");
              if (target.status !== "active" || target.slug !== plan.slug) {
                throw validationError("Only the active Plan can be placed in the execution queue; draft Plans remain inactive.", { targetRef });
              }
              const unpositionedInProject = unpositionedCountForProject(queue, project.slug);
              if (unpositionedInProject > 0) throw validationError("Position every existing approved Action in this Plan before reprioritizing it.", { unpositionedCount: unpositionedInProject });
              queueActionKeys = dependencyOrderedActionIds(target.actions
                .filter((action) => action.status !== "done")
                .map((action) => ({ id: action.id, dependencies: action.dependsOn })))
                .map((actionId) => `${project.slug}/${actionId}`);
              if (queueActionKeys.length === 0) throw validationError("A complete Plan has no unfinished Actions to reprioritize.", { targetRef });
              queueActionKey = queueActionKeys[0]!;
              queueAfter = insertQueueKeys(queueAfter, queueActionKeys, input.placement, input.anchor);
              arrangeQueue = true;
              effects.push(`Reprioritized active Plan ${target.slug} as one dependency-safe queue segment: ${queueActionKeys.join(", ")}.`);
              effects.push(`Moved the Plan segment to start at queue position ${queueAfter.indexOf(queueActionKey) + 1}.`);
            } else {
              requireNoQueueOptions(input);
              fileMutations.push({ path: targetPath, before, after: replaceTopLevelField(before, "milestone", proposal.normalized.desiredResult) });
              effects.push(`Amended Plan ${target.slug} Milestone.`);
            }
            break;
          }

          const takenIds = new Set(target.actions.map((action) => action.id));
          const newActionIds = proposedActions.map((action) => action.targetRef
            ? resolveManagedTargetRef(action.targetRef, "action", project.slug)
            : action.id
              ? claimExplicitActionId(takenIds, action.id)
              : allocateUniqueActionId(takenIds, deriveActionId(action.desiredResult)));
          const duplicateTargets = newActionIds.filter((id, index) => newActionIds.indexOf(id) !== index);
          if (duplicateTargets.length > 0) throw validationError("A Plan Ask cannot amend the same Action more than once.", { actions: [...new Set(duplicateTargets)] });
          const existingIds = new Set(target.actions.map((action) => action.id));
          const availableIds = new Set([...existingIds, ...newActionIds]);
          const normalizedActions = proposedActions.map((action, index) => {
            const id = newActionIds[index]!;
            const existing = action.targetRef !== null;
            if (existing && !existingIds.has(id)) throw validationError("Agent Ask Plan Action amendment target was not found.", { targetRef: action.targetRef });
            if (action.acceptance.length === 0) throw validationError("Every created or amended Plan Action requires at least one observable acceptance criterion.", { action: id });
            const dependencies = normalizeDependencies(action.dependencies, project.slug);
            const unknownDependencies = dependencies.filter((dependency) => !availableIds.has(dependency));
            if (unknownDependencies.length > 0) {
              throw validationError("Agent Ask names dependencies outside the target Plan or proposed Action set.", { action: id, dependencies: unknownDependencies });
            }
            return { ...action, id, existing, dependencies, references: uniqueStrings([...proposal.normalized.references, ...action.references]) };
          });
          const createsActions = normalizedActions.some((action) => !action.existing);
          if (createsActions && !input.responsibility) throw validationError("Creating Actions in a Plan requires --responsibility autonomous or agent.");
          if (!createsActions && input.responsibility) throw validationError("Plan Action amendments preserve existing Responsibilities.");

          const isActivePlan = target.status === "active" && target.slug === plan.slug;
          if (!isActivePlan && input.placement) {
            throw validationError("Only the active Plan can be placed in the execution queue; draft Plans remain inactive.", { targetRef });
          }
          if (isActivePlan && createsActions && !input.placement) {
            throw validationError("Adding Actions to the active Plan requires --top, --before, or --after so no approved work is left unpositioned.");
          }
          if (input.anchor && !input.placement) throw validationError("A queue anchor requires --before or --after.");
          if (input.placement) {
            const unpositionedInProject = unpositionedCountForProject(queue, project.slug);
            if (unpositionedInProject > 0) throw validationError("Position every existing approved Action in this Plan before reprioritizing it.", { unpositionedCount: unpositionedInProject });
          }

          let after = before;
          for (const action of normalizedActions) {
            if (action.existing) {
              after = amendAction(after, action.id, action.desiredResult, action.acceptance, action.dependencies,
                action.references, proposal.normalized.requestId);
              effects.push(`Amended Action ${project.slug}/${action.id} in Plan ${target.slug}.`);
              actionIdsToValidate.push(action.id);
            } else {
              after = appendAction(after, {
                id: action.id, title: action.desiredResult, responsibility: input.responsibility!,
                acceptance: action.acceptance, dependencies: action.dependencies, references: action.references,
                source: `Agent Ask ${proposal.normalized.requestId}`
              });
              effects.push(`Created Action ${project.slug}/${action.id} in Plan ${target.slug} with Responsibility ${input.responsibility}.`);
              actionIdsToValidate.push(action.id);
            }
          }
          fileMutations.push({ path: targetPath, before, after });

          if (input.placement) {
            const changes = new Map(normalizedActions.map((action) => [action.id, action.dependencies]));
            const finalActions = target.actions.map((action) => ({
              id: action.id,
              dependencies: changes.get(action.id) ?? action.dependsOn,
              status: action.status
            }));
            for (const action of normalizedActions.filter((candidate) => !candidate.existing)) {
              finalActions.push({ id: action.id, dependencies: action.dependencies, status: "open" });
            }
            queueActionKeys = dependencyOrderedActionIds(finalActions
              .filter((action) => action.status !== "done")
              .map(({ id, dependencies }) => ({ id, dependencies })))
              .map((actionId) => `${project.slug}/${actionId}`);
            queueActionKey = queueActionKeys[0] ?? null;
            if (!queueActionKey) throw validationError("A complete Plan has no unfinished Actions to reprioritize.", { targetRef });
            queueAfter = insertQueueKeys(queueAfter, queueActionKeys, input.placement, input.anchor);
            arrangeQueue = true;
            effects.push(`Reprioritized active Plan ${target.slug} as one dependency-safe queue segment: ${queueActionKeys.join(", ")}.`);
            effects.push(`Moved the Plan segment to start at queue position ${queueAfter.indexOf(queueActionKey) + 1}.`);
          } else {
            effects.push(`Preserved Plan ${target.slug} activation, pointer, and queue position.`);
          }
        } else {
          if (input.placement || input.anchor) throw validationError("A draft Plan cannot be placed in the execution queue before activation.");
          const proposedActions = proposal.normalized.actions;
          if (proposedActions.length > 0 && !input.responsibility) {
            throw validationError("Creating Actions in a draft Plan requires --responsibility autonomous or agent.");
          }
          if (proposedActions.length === 0 && input.responsibility) {
            throw validationError("Responsibility applies only when the Plan Ask creates Actions.");
          }
          if (proposedActions.some((action) => action.targetRef)) {
            throw validationError("A new draft Plan cannot amend an existing Action target_ref.");
          }
          if (proposedActions.some((action) => action.acceptance.length === 0)) {
            throw validationError("Every draft Plan Action requires at least one observable acceptance criterion.");
          }
          const planSlug = uniquePlanSlug(discovered.docs.filter((doc): doc is PlanDoc => doc.type === "plan" && doc.project === project.slug), slugify(proposal.normalized.desiredResult));
          const targetPath = path.join(repoRoot, "docs", "plans", `${planSlug}.md`);
          const takenIds = new Set<string>();
          const actionIds = proposedActions.map((action) => (action.id
            ? claimExplicitActionId(takenIds, action.id)
            : allocateUniqueActionId(takenIds, deriveActionId(action.desiredResult))));
          const availableIds = new Set(actionIds);
          const actions = proposedActions.map((action, index) => {
            const dependencies = normalizeDependencies(action.dependencies, project.slug);
            const unknownDependencies = dependencies.filter((dependency) => !availableIds.has(dependency));
            if (unknownDependencies.length > 0) {
              throw validationError("Draft Plan Action dependencies must name another Action in the same Ask.", { action: actionIds[index], dependencies: unknownDependencies });
            }
            return { ...action, id: actionIds[index]!, dependencies, references: uniqueStrings([...proposal.normalized.references, ...action.references]) };
          });
          const orderedIds = dependencyOrderedActionIds(actions.map((action) => ({ id: action.id, dependencies: action.dependencies })));
          const orderedActions = orderedIds.map((id) => actions.find((action) => action.id === id)!);
          fileMutations.push({ path: targetPath, before: null, after: newDraftPlan(project.slug, planSlug,
            proposal.normalized.desiredResult, proposal.normalized.requestId, input.responsibility, orderedActions) });
          effects.push(`Created draft Plan ${planSlug} with ${orderedActions.length} governed Action${orderedActions.length === 1 ? "" : "s"}: ${orderedActions.map((action) => `${project.slug}/${action.id}`).join(", ") || "none"}.`);
          effects.push("Kept the draft inactive; active Plan, Project pointer, dispatch authority, and execution queue are unchanged.");
        }
        break;
      }
      case "decision": {
        requireNoQueueOptions(input);
        addDecisionMutation(fileMutations, discovered.docs.filter((doc): doc is DecisionDoc => doc.type === "decision"), repoRoot,
          project.slug, plan.slug, null, proposal.normalized.desiredResult, proposal.normalized.rationale, proposal.normalized.requestId,
          proposal.normalized.options);
        effects.push("Created one open Decision; agent input did not answer it.");
        break;
      }
      case "auto": {
        requireNoQueueOptions(input);
        addDecisionMutation(fileMutations, discovered.docs.filter((doc): doc is DecisionDoc => doc.type === "decision"), repoRoot,
          project.slug, plan.slug, null, `How should Arcadia structure this request: ${proposal.normalized.desiredResult}`, proposal.normalized.rationale, proposal.normalized.requestId);
        effects.push("Created one open interpretation Decision; no Project structure was guessed.");
        break;
      }
      case "log": {
        requireNoQueueOptions(input);
        const log = discovered.docs.find((doc): doc is LogDoc => doc.type === "log" && doc.project === project.slug);
        const logPath = path.join(repoRoot, log?.relativePath ?? "MISSION_LOG.md");
        const before = existsSync(logPath) ? readFileSync(logPath, "utf8") : null;
        fileMutations.push({ path: logPath, before, after: appendLog(before, project.slug, proposal.normalized) });
        effects.push(`Appended one Project Log entry for Agent Ask ${proposal.normalized.requestId}.`);
        break;
      }
      case "artifact": {
        requireNoQueueOptions(input);
        artifactInput = { title: proposal.normalized.desiredResult, path: targetRef ?? undefined };
        effects.push("Created one planned Artifact reference linked to the Project and settlement receipt.");
        break;
      }
      case "proposal": {
        requireNoQueueOptions(input);
        effects.push("Accepted the proposal as preserved evidence; created no executable Action or parallel Project record.");
        break;
      }
    }
  }

  const previewFingerprint = sha256(JSON.stringify({
    proposalFingerprint: proposal.fingerprint,
    operation,
    queueRevision: queue.revision,
    fileMutations: fileMutations.map((mutation) => ({ path: mutation.path, before: mutation.before ? sha256(mutation.before) : null, after: sha256(mutation.after) })),
    queueAfter
  }));
  if (input.apply && input.previewFingerprint !== previewFingerprint) {
    throw validationError("Agent Ask settlement apply does not match the current preview.", {
      expectedPreviewFingerprint: previewFingerprint,
      receivedPreviewFingerprint: input.previewFingerprint ?? null
    });
  }

  const now = new Date().toISOString();
  const baseReceipt: AgentAskSettlementReceipt = {
    id: `asksettle_${randomUUID().replaceAll("-", "").slice(0, 18)}`,
    proposalId: proposal.id,
    proposalRequestId: proposal.normalized.requestId,
    settlementRequestId: input.settlementRequestId,
    disposition: input.disposition,
    projectSlug: project.slug,
    intent: proposal.normalized.intent,
    effects,
    queueActionKey,
    queueActionKeys,
    queuePosition: queueActionKey ? queueAfter.indexOf(queueActionKey) : null,
    nextActionKey: input.disposition === "accepted" ? queue.nextActionKey : queue.nextActionKey,
    previewFingerprint,
    applied: input.apply === true,
    authority: {
      kind: "operator_acceptance",
      requestedAuthority: proposal.normalized.requestedAuthority,
      boundedPolicyDecision: null
    },
    notificationStatus: input.apply ? "pending" : "withheld_until_apply",
    createdAt: now
  };
  if (!input.apply) return baseReceipt;

  if (fileMutations.length > 0) assertClean(repoRoot, "Agent Ask Project repository");
  try {
    const settled = writeTransaction(db, () => {
      for (const mutation of fileMutations) writeAtomically(mutation.path, mutation.after);
      for (const actionId of actionIdsToValidate) {
        const readiness = resolveActionReadiness(repoRoot, project.slug, actionId);
        const structuralBlockers = readiness.blockers.filter((blocker) => !blocker.field.endsWith(".depends_on"));
        if (!readiness.found || structuralBlockers.length > 0 || readiness.operatorQuestion) {
          throw validationError("Accepted Agent Ask did not produce a ready canonical Action.", {
            actionId,
            blockers: structuralBlockers,
            operatorQuestion: readiness.operatorQuestion
          });
        }
      }
      if (fileMutations.length > 0) {
        const sync = syncProjectDocs(db, project, { apply: true });
        // A settlement answers for the documents it wrote, and for nothing
        // else. Decision 0044: this check used to refuse on any error anywhere
        // in the corpus, so one stale document from weeks ago permanently
        // blocked every future settlement in that repository — and, because no
        // intent can amend an existing document, blocked the very Ask that
        // would have cleared it. An adopting project hit exactly that on its
        // first real use, with 49 pre-existing errors it had not introduced.
        //
        // The crawl still covers everything, because cross-document checks and
        // ingestion need the whole graph; only the refusal narrows. Unrelated
        // corpus errors remain real and remain reportable — `arcadia docs` is
        // where the operator asks that question deliberately, rather than
        // discovering it as a refusal of unrelated work.
        const written = new Set(
          fileMutations.map((mutation) => path.relative(repoRoot, mutation.path)),
        );
        const blocking = sync.errors.filter((error) => written.has(error.relativePath));
        if (blocking.length > 0) {
          throw validationError("Accepted Agent Ask managed documents failed operational sync.", {
            errors: blocking,
            unrelatedCorpusErrors: sync.errors.length - blocking.length,
          });
        }
      }
      if (artifactInput) {
        const artifact = createArtifactRecord(db, {
          projectId: project.id,
          title: artifactInput.title,
          artifactType: "reference",
          status: "planned",
          path: artifactInput.path
        });
        effects.push(`Artifact receipt: ${artifact.id}.`);
      }
      if (arrangeQueue && queueActionKeys.length > 0) {
        const currentKeys = buildAgentQueue(db).ordered.flatMap((entry) => entry.orderKey ? [entry.orderKey] : []);
        arrangeActionOrder(db, {
          currentKeys,
          order: queueAfter,
          requestId: `agent-ask:${input.settlementRequestId}`,
          expectedRevision: queue.revision,
          apply: true
        });
      }
      const nextActionKey = buildAgentQueue(db).nextActionKey;
      const receipt: AgentAskSettlementReceipt = { ...baseReceipt, nextActionKey };
      db.prepare(`INSERT INTO agent_ask_settlements
        (id, proposal_id, request_id, operation_json, fingerprint, disposition, project_slug,
         effects_json, queue_action_key, queue_position, next_action_key, notification_status,
         receipt_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
        .run(receipt.id, proposal.id, input.settlementRequestId, JSON.stringify(operation), previewFingerprint,
          input.disposition, project.slug, JSON.stringify(effects), queueActionKey, receipt.queuePosition,
          nextActionKey, JSON.stringify(receipt), now);
      return receipt;
    });
    // Settlement lands what it writes. Decision 0044: `assertClean` above
    // refuses a dirty repository, but settlement used to leave its own output
    // uncommitted — so settlement N+1 was refused by settlement N, and two
    // settlements could not run without a person committing in between. That
    // is not a workflow, it is a deadlock with a manual override.
    //
    // Deliberately after the transaction, never inside it: a git failure must
    // not roll back a settlement that genuinely happened, and the restore path
    // below must never run against files already committed. If the commit
    // fails — unconfigured identity, a hook, a detached state — the settlement
    // still stands and the tree is simply left dirty, which is exactly the old
    // behaviour, and the next `assertClean` explains it with its own remedy.
    if (fileMutations.length > 0) {
      commitSettlementOutput(repoRoot, fileMutations, settled);
    }
    return settled;
  } catch (error) {
    for (const mutation of [...fileMutations].reverse()) restoreMutation(mutation);
    throw error;
  }
}

/**
 * Commit the managed documents one settlement wrote, on whatever branch the
 * repository is currently on. Never pushes: landing a record locally is
 * Arcadia's job, publishing it is the operator's.
 *
 * Paths are passed explicitly to `add` and `commit` so that nothing outside
 * this settlement can be swept into the commit, even though `assertClean`
 * already established there was nothing else to sweep.
 */
function commitSettlementOutput(
  repoRoot: string,
  fileMutations: FileMutation[],
  receipt: AgentAskSettlementReceipt
): void {
  const paths = fileMutations.map((mutation) => path.relative(repoRoot, mutation.path));
  const message = [
    `chore(arcadia): settle ${receipt.proposalRequestId}`,
    "",
    ...receipt.effects.map((effect) => `- ${effect}`),
    "",
    `Written by \`arcadia agent-ask settle --apply\` (${receipt.id}).`,
    "Arcadia writes and lands its own managed documents; it did not author the",
    "decision they record."
  ].join("\n");
  try {
    git(repoRoot, ["add", "--", ...paths]);
    git(repoRoot, ["commit", "-m", message, "--", ...paths]);
  } catch {
    // Intentionally swallowed — see the call site. The settlement is already
    // durable in both the database and the working tree; only the convenience
    // of landing it failed, and the next command to touch this repository
    // reports the dirty tree far more clearly than a rethrow here would.
  }
}

export function listPendingAgentAskNotifications(db: Database.Database): PendingAgentAskNotification[] {
  return db.prepare(`SELECT id, project_slug, disposition, effects_json, queue_action_key,
      queue_position, next_action_key, receipt_json, created_at
    FROM agent_ask_settlements WHERE notification_status = 'pending' ORDER BY created_at, id`)
    .all()
    .map((row) => {
      const value = row as Record<string, unknown>;
      const receipt = JSON.parse(String(value.receipt_json)) as AgentAskSettlementReceipt;
      return {
        settlementId: String(value.id),
        projectSlug: String(value.project_slug),
        disposition: value.disposition as AgentAskDisposition,
        intent: receipt.intent,
        effects: JSON.parse(String(value.effects_json)) as string[],
        queueActionKey: value.queue_action_key === null ? null : String(value.queue_action_key),
        queueActionKeys: receipt.queueActionKeys ?? (value.queue_action_key === null ? [] : [String(value.queue_action_key)]),
        queuePosition: value.queue_position === null ? null : Number(value.queue_position),
        nextActionKey: value.next_action_key === null ? null : String(value.next_action_key),
        createdAt: String(value.created_at)
      };
    });
}

export function markAgentAskNotificationSent(db: Database.Database, settlementId: string, messageId: string): void {
  const result = db.prepare(`UPDATE agent_ask_settlements
    SET notification_status = 'sent', discord_message_id = ?, notified_at = ?
    WHERE id = ? AND notification_status = 'pending'`).run(messageId, new Date().toISOString(), settlementId);
  if (result.changes === 0) {
    const existing = db.prepare("SELECT notification_status, discord_message_id FROM agent_ask_settlements WHERE id = ?")
      .get(settlementId) as { notification_status: string; discord_message_id: string | null } | undefined;
    if (!existing) throw validationError("Agent Ask settlement was not found.", { settlementId });
    if (existing.notification_status === "sent" && existing.discord_message_id === messageId) return;
    throw validationError("Agent Ask settlement notification is already resolved with different evidence.", { settlementId });
  }
}

function appendAction(content: string, action: {
  id: string; title: string; responsibility: AgentAskResponsibility; acceptance: string[]; dependencies: string[]; references: string[]; source: string;
}): string {
  const end = content.indexOf("\n---", 4);
  if (end < 0) throw validationError("Managed Plan has no closing frontmatter marker.");
  const frontmatter = content.slice(0, end);
  const actions = /^actions:\s*$/m.exec(frontmatter);
  if (!actions || actions.index === undefined) {
    throw validationError("Managed Plan has no block-form actions list.");
  }
  const actionsEnd = actions.index + actions[0].length;
  const nextTopLevelField = /\n(?=[a-z_][a-z0-9_]*:\s*)/i.exec(frontmatter.slice(actionsEnd));
  const insertAt = nextTopLevelField
    ? actionsEnd + nextTopLevelField.index
    : end;
  const lines = [
    `  - id: ${action.id}`,
    `    title: ${yamlScalar(action.title)}`,
    "    status: open",
    `    responsibility: ${action.responsibility}`,
    "    effort: session",
    `    next_action: ${yamlScalar(action.title)}`,
    `    expected_artifact: ${yamlScalar(`Evidence satisfying Agent Ask ${action.id}`)}`,
    "    clarification: clarified",
    "    confidence: high",
    `    source: ${yamlScalar(action.source)}`,
    "    acceptance_criteria:",
    ...action.acceptance.map((criterion) => `      - ${yamlScalar(criterion)}`),
    `    depends_on: [${action.dependencies.join(", ")}]`,
    "    decisions: []",
    `    references: [${action.references.map(yamlScalar).join(", ")}]`
  ];
  return `${content.slice(0, insertAt)}\n${lines.join("\n")}${content.slice(insertAt)}`;
}

// The derived id is the handle an operator types into `advance queue reorder`,
// `--before`, `--after`, and `depends_on`, so it is built to be short and
// pronounceable rather than to reproduce the sentence it came from. Slugifying
// a whole `desired_result` produced ids like
// `reconcile-open-operator-questions-against-answers-the-checked-in-documents-alrea`,
// truncated mid-word by the slug length cap and unusable as a handle.
const DERIVED_ID_MAX_WORDS = 6;
const DERIVED_ID_MAX_CHARS = 48;

function deriveActionId(desiredResult: string): string {
  const clause = desiredResult.split(/[.;:!?]|,\s|\s[\u2014\u2013-]\s/)[0] ?? desiredResult;
  const words = clause
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .slice(0, DERIVED_ID_MAX_WORDS);
  const chosen: string[] = [];
  for (const word of words) {
    const candidate = chosen.length === 0 ? word : `${chosen.join("-")}-${word}`;
    // Stop on a whole-word boundary. A first word longer than the cap is kept
    // intact: an over-long id is still typeable, a half-word one is not.
    if (candidate.length > DERIVED_ID_MAX_CHARS && chosen.length > 0) break;
    chosen.push(word);
    if (candidate.length >= DERIVED_ID_MAX_CHARS) break;
  }
  return chosen.join("-") || "agent-ask-action";
}

// An explicit id is the agent's own commitment to a handle. Silently renaming
// it would break the `depends_on` entries written against it, so a collision
// is refused rather than suffixed.
function claimExplicitActionId(taken: Set<string>, id: string): string {
  if (taken.has(id)) throw validationError("Agent Ask action id is already used in the active Plan.", { id });
  taken.add(id);
  return id;
}

function allocateUniqueActionId(taken: Set<string>, base: string): string {
  const stem = base || "agent-ask-action";
  if (!taken.has(stem)) {
    taken.add(stem);
    return stem;
  }
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${stem}-${index}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
  throw validationError("Agent Ask could not allocate a unique Action id.");
}

function insertQueueKeys(current: string[], keys: string[], placement: AgentAskPlacement, anchor?: string): string[] {
  const keySet = new Set(keys);
  const next = current.filter((item) => !keySet.has(item));
  if (placement === "top") return [...keys, ...next];
  if (!anchor || !next.includes(anchor)) throw validationError("Agent Ask queue anchor was not found.", { anchor: anchor ?? null });
  const index = next.indexOf(anchor) + (placement === "after" ? 1 : 0);
  next.splice(index, 0, ...keys);
  return next;
}

function normalizeDependencies(dependencies: string[], projectSlug: string): string[] {
  return dependencies.map((dependency) => {
    const parts = dependency.split("/").filter(Boolean);
    if (parts.length > 1 && parts[0] !== projectSlug) {
      throw validationError("Agent Ask cannot mutate or depend on another Project without explicit governed authority.", {
        destinationProject: projectSlug,
        reference: dependency
      });
    }
    return parts.at(-1)!;
  }).filter(Boolean);
}

function dependencyOrderedActionIds(actions: Array<{ id: string; dependencies: string[] }>): string[] {
  const ids = new Set(actions.map((action) => action.id));
  const remaining = [...actions];
  const ordered: string[] = [];
  const resolved = new Set<string>();
  while (remaining.length > 0) {
    const index = remaining.findIndex((action) => action.dependencies.every((dependency) => !ids.has(dependency) || resolved.has(dependency)));
    if (index < 0) {
      throw validationError("Agent Ask Plan Actions contain a dependency cycle.", { actions: remaining.map((action) => action.id) });
    }
    const [next] = remaining.splice(index, 1);
    ordered.push(next!.id);
    resolved.add(next!.id);
  }
  return ordered;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function resolveManagedTargetRef(targetRef: string, kind: "action" | "plan", projectSlug: string): string {
  const parts = targetRef.split("/").filter(Boolean);
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2 && (parts[0] === kind || parts[0] === projectSlug)) return parts[1]!;
  throw validationError("Agent Ask cannot mutate another Project without explicit governed authority.", {
    destinationProject: projectSlug,
    targetRef
  });
}

function requireNoQueueOptions(input: { responsibility?: AgentAskResponsibility; placement?: AgentAskPlacement; anchor?: string }): void {
  if (input.responsibility || input.placement || input.anchor) {
    throw validationError("This Agent Ask effect creates no Action; Responsibility and queue placement do not apply.");
  }
}

function replaceTopLevelField(content: string, field: string, value: string): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw validationError("Managed document has no YAML frontmatter block to update.");
  const lines = match[1].split(/\r?\n/);
  const index = lines.findIndex((line) => new RegExp(`^${escapeRegex(field)}\\s*:`).test(line));
  if (index < 0) throw validationError(`Managed document has no ${field} field to update.`);
  lines[index] = `${field}: ${yamlScalar(value)}`;
  return content.replace(match[0], `---\n${lines.join("\n")}\n---`);
}

function addMilestoneMutations(mutations: FileMutation[], projectPath: string, planPath: string, milestone: string): void {
  const projectBefore = readFileSync(projectPath, "utf8");
  const planBefore = readFileSync(planPath, "utf8");
  mutations.push(
    { path: projectPath, before: projectBefore, after: replaceTopLevelField(projectBefore, "milestone", milestone) },
    { path: planPath, before: planBefore, after: replaceTopLevelField(planBefore, "milestone", milestone) }
  );
}

function addDecisionMutation(
  mutations: FileMutation[],
  decisions: DecisionDoc[],
  repoRoot: string,
  projectSlug: string,
  planSlug: string,
  actionId: string | null,
  question: string,
  rationale: string | null,
  requestId: string,
  options: NormalizedAgentAskOption[] = []
): void {
  const nextNumber = decisions.reduce((highest, decision) => Math.max(highest, Number.parseInt(decision.id, 10) || 0), 0) + 1;
  const id = String(nextNumber).padStart(4, "0");
  const slug = uniqueDecisionSlug(decisions, slugify(question) || `agent-ask-${id}`);
  const targetPath = path.join(repoRoot, "docs", "decisions", `${id}-${slug}.md`);
  // `recommendation` holds only the recommended course of action, read from
  // the options list an Ask can supply — never the filing Ask's rationale.
  const recommendation = options.find((option) => option.recommended)?.label ?? null;
  const optionsFrontmatter =
    options.length === 0
      ? []
      : [
          "options:",
          ...options.flatMap((option) => [
            `  - label: ${yamlScalar(option.label)}`,
            `    consequence: ${yamlScalar(option.consequence)}`,
            `    recommended: ${option.recommended ? "true" : "false"}`
          ])
        ];
  // An operator answering this Decision should see its choices before its
  // rationale, so the options list opens the body rather than trailing it.
  const optionsBody =
    options.length === 0
      ? []
      : [
          "## Options",
          "",
          ...options.map((option) => `- **${option.label}**${option.recommended ? " (recommended)" : ""}: ${option.consequence}`),
          ""
        ];
  const rationaleBody = rationale ? ["## Rationale", "", rationale, ""] : [];
  const frontmatter = [
    "---", "arcadia: v1", "type: decision", `id: ${JSON.stringify(id)}`, `slug: ${slug}`,
    `project: ${projectSlug}`, "status: open", `question: ${yamlScalar(question)}`, "gap_type: missing-decision",
    ...(recommendation ? [`recommendation: ${yamlScalar(recommendation)}`] : []),
    ...optionsFrontmatter,
    "confidence: high", `plan: ${planSlug}`, ...(actionId ? [`action: ${actionId}`] : []),
    `updated: ${today()}`, "---", "", `# Decision ${id}: ${question}`, "",
    ...optionsBody,
    ...rationaleBody,
    `Proposed by Agent Ask ${requestId}. This Decision remains open until the operator answers it.`, ""
  ].join("\n");
  mutations.push({ path: targetPath, before: null, after: frontmatter });
}

function uniqueDecisionSlug(decisions: DecisionDoc[], base: string): string {
  if (!decisions.some((decision) => decision.slug === base)) return base;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!decisions.some((decision) => decision.slug === candidate)) return candidate;
  }
  throw validationError("Agent Ask could not allocate a unique Decision slug.");
}

function uniquePlanSlug(plans: PlanDoc[], base: string): string {
  const stem = base || "agent-ask-plan";
  if (!plans.some((plan) => plan.slug === stem)) return stem;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${stem}-${index}`;
    if (!plans.some((plan) => plan.slug === candidate)) return candidate;
  }
  throw validationError("Agent Ask could not allocate a unique Plan slug.");
}

function newDraftPlan(
  projectSlug: string,
  planSlug: string,
  milestone: string,
  requestId: string,
  responsibility?: AgentAskResponsibility,
  actions: Array<NormalizedAgentAskAction & { id: string }> = []
): string {
  const actionLines = actions.flatMap((action) => [
    `  - id: ${action.id}`,
    `    title: ${yamlScalar(action.desiredResult)}`,
    "    status: open",
    `    responsibility: ${responsibility}`,
    "    effort: session",
    `    next_action: ${yamlScalar(action.desiredResult)}`,
    `    expected_artifact: ${yamlScalar(`Evidence satisfying Agent Ask ${action.id}`)}`,
    "    clarification: clarified",
    "    confidence: high",
    `    source: ${yamlScalar(`Agent Ask ${requestId}`)}`,
    "    acceptance_criteria:",
    ...action.acceptance.map((criterion) => `      - ${yamlScalar(criterion)}`),
    `    depends_on: [${action.dependencies.join(", ")}]`,
    "    decisions: []",
    `    references: [${action.references.map(yamlScalar).join(", ")}]`
  ]);
  return [
    "---", "arcadia: v1", "type: plan", `slug: ${planSlug}`, `project: ${projectSlug}`, "status: draft",
    `milestone: ${yamlScalar(milestone)}`, "token_impact: medium",
    `token_budget: ${yamlScalar("Deterministic management; one bounded coding-agent implementation pass after activation.")}`,
    `updated: ${today()}`, ...(actionLines.length > 0 ? ["actions:", ...actionLines] : ["actions: []"]),
    "questions: []", "decisions: []", "---", "",
    `# ${milestone}`, "", `Created from accepted Agent Ask ${requestId}. This draft is not active and changes no pointer.`, ""
  ].join("\n");
}

function amendAction(
  content: string,
  actionId: string,
  nextAction: string,
  acceptance: string[],
  dependencies: string[],
  references: string[],
  requestId: string,
  responsibility?: AgentAskResponsibility
): string {
  const pattern = new RegExp(`(^  - id: ${escapeRegex(actionId)}\\r?$[\\s\\S]*?)(?=^  - id: |^---\\r?$)`, "m");
  const match = content.match(pattern);
  if (!match) throw validationError("Managed Plan Action block was not found.", { actionId });
  let block = match[1];
  if (!/^    next_action:/m.test(block)) throw validationError("Managed Plan Action has no next_action field to amend.", { actionId });
  block = block.replace(/^    next_action:.*$/m, `    next_action: ${yamlScalar(nextAction)}`);
  if (responsibility) {
    if (!/^    responsibility:/m.test(block)) throw validationError("Managed Plan Action has no responsibility field to amend.", { actionId });
    block = block.replace(/^    responsibility:.*$/m, `    responsibility: ${responsibility}`);
  }
  if (acceptance.length > 0) {
    const replacement = ["    acceptance_criteria:", ...acceptance.map((criterion) => `      - ${yamlScalar(criterion)}`)].join("\n");
    block = block.replace(/^    acceptance_criteria:\r?\n(?:      - .*\r?\n?)*/m, `${replacement}\n`);
  }
  block = block.replace(/^    depends_on:.*$/m,
    dependencies.length > 0 ? `    depends_on: [${dependencies.join(", ")}]` : "    depends_on: []");
  block = block.replace(/^    references:.*$/m,
    references.length > 0 ? `    references: [${references.map(yamlScalar).join(", ")}]` : "    references: []");
  block = /^    source:/m.test(block)
    ? block.replace(/^    source:.*$/m, `    source: ${yamlScalar(`Agent Ask ${requestId}`)}`)
    : block.replace(/^    clarification:.*$/m, `$&\n    source: ${yamlScalar(`Agent Ask ${requestId}`)}`);
  return content.replace(pattern, block);
}

function appendLog(before: string | null, projectSlug: string, normalized: NormalizedAgentAsk): string {
  const base = before ?? [
    "---", "arcadia: v1", "type: log", `slug: ${projectSlug}-mission-log`, `project: ${projectSlug}`,
    `updated: ${today()}`, "---", "", `# Mission Log: ${projectSlug}`, ""
  ].join("\n");
  const updated = replaceTopLevelField(base, "updated", today()).trimEnd();
  return `${updated}\n\n## ${today()} — Agent Ask ${normalized.requestId}\n\n` + [
    `- **Did:** ${normalized.desiredResult}`,
    `- **Result:** ${normalized.rationale ?? "Recorded the accepted Agent Ask as Project history."}`,
    "- **Next:** Continue from the governed Project pointer and execution queue.",
    "- **Blockers:** None recorded by this settlement."
  ].join("\n") + "\n";
}

function restoreMutation(mutation: FileMutation): void {
  if (mutation.before === null) {
    try { unlinkSync(mutation.path); } catch {}
  } else {
    writeAtomically(mutation.path, mutation.before);
  }
}

function writeAtomically(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.arcadia-${process.pid}-${randomUUID()}`;
  writeFileSync(temporary, content, "utf8");
  try { renameSync(temporary, filePath); } finally { try { unlinkSync(temporary); } catch {} }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
