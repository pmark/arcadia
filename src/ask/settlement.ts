import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import type { AgentAskProposal, NormalizedAgentAsk, NormalizedAgentAskAction, NormalizedAgentAskEvidence, NormalizedAgentAskOption } from "./agentAsk.js";
import { validationError } from "../cli/errors.js";
import { writeTransaction } from "../db/connection.js";
import { createArtifactRecord, getProjectBySlug, getProjectMetadata } from "../db/repositories.js";
import { discoverDocs } from "../docs/discover.js";
import { deferringDecisionFor, isDispatchable, resolveActionReadiness, resolveDispatch } from "../docs/dispatch.js";
import { yamlScalar } from "../docs/frontmatter.js";
import { syncProjectDocs } from "../docs/sync.js";
import type { ArcadiaDoc, DecisionDoc, LogDoc, PlanDoc, ProjectDoc } from "../docs/types.js";
import { buildAgentQueue, unpositionedCountForProject } from "../dispatch/queue.js";
import { arrangeActionOrder, loadActionOrder } from "../dispatch/order.js";
import { resolvePlanActivation } from "../dispatch/planActivation.js";
import { writePointerPairWithCompareAndSet } from "../dispatch/pointer.js";
import type { WorkClassification } from "../domain/constants.js";
import { assertClean, commitOnlyPaths, git, projectCheckoutFor } from "../git/worktrees.js";
import { slugify, SLUG_MAX_LENGTH } from "../utils/slug.js";

export type AgentAskDisposition = "accepted" | "rejected";
export type AgentAskResponsibility = WorkClassification;
export type AgentAskPlacement = "top" | "before" | "after";

/**
 * How long the operational projection may wait for the workspace write lock
 * before it is declared stalled. The documents are already committed by then,
 * so this is a side-effect budget, not the settlement's durability window.
 */
const DEFAULT_PROJECTION_BUSY_TIMEOUT_MS = 15_000;

/**
 * Draft Ask files are deliberate, disposable intake: `draft` creates them in
 * the candidate worktree and a later settlement may archive one of them. They
 * must not make a settlement refuse merely because another pending Ask was
 * drafted in the same checkout. All other dirt remains fail-closed.
 */
function untrackedDraftAskPaths(repoRoot: string): string[] {
  const directory = path.join(repoRoot, ".arcadia", "asks");
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^agent-ask-[a-z0-9][a-z0-9-]*\.ya?ml$/.test(entry.name))
      .map((entry) => path.join(".arcadia", "asks", entry.name));
  } catch {
    return [];
  }
}

/** `after: null` means this mutation deletes `path` (used to archive a settled Ask's source file). */
interface FileMutation {
  path: string;
  before: string | null;
  after: string | null;
  /**
   * The settlement's pinned change as an idempotent transform of whatever
   * content is on disk. Present on the PROJECT.md + Plan pair, where a
   * compare-and-set failure re-reads the base and re-applies the same resolved
   * target instead of overwriting a concurrent writer with a stale `after`.
   */
  retransform?: (current: string) => string;
  /**
   * Recompute an append-only shared document (MISSION_LOG.md) from fresh
   * content. Recomputed under the write interlock, so a concurrent settlement's
   * entry is preserved instead of being replaced by a stale resolution-time
   * `after`. `current` is null when the document does not exist yet.
   */
  reappend?: (current: string | null) => string;
  /** Which half of the atomic PROJECT.md + Plan pair this mutation is. */
  pair?: "project" | "plan";
}

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
  authority: {
    kind: "operator_acceptance" | "deterministic_proof";
    requestedAuthority: string;
    boundedPolicyDecision: null;
  };
  notificationStatus: "withheld_until_apply" | "pending" | "sent";
  createdAt: string;
  /**
   * Present only when the settlement did not finish every durable step: the
   * managed documents could not be committed, the operational projection did
   * not complete, or both. Describes exactly what is safe and what to do.
   */
  recovery?: AgentAskSettlementRecovery | null;
}

export interface AgentAskSettlementRecovery {
  /** False when the documents were written but their Git commit failed. */
  documentsCommitted: boolean;
  /** "pending" when review items, queue placement, or the receipt are behind. */
  operationalSync: "complete" | "pending";
  reason: string;
  remedy: string;
}

/**
 * Injection points for the deterministic regression tests around Issue #270.
 * Production callers pass none.
 */
export interface AgentAskSettlementTestHooks {
  /**
   * Runs after the settlement resolves its document mutations and passes the
   * preview check, before it writes anything. A test uses it to land a
   * concurrent settlement's change in that window and prove the pointer pair's
   * compare-and-set re-reads and re-applies rather than overwriting it.
   */
  beforeDocumentWrite?: () => void;
  /** Runs inside the operational-projection transaction, before the sync. */
  beforeOperationalSync?: () => void;
  /**
   * Runs after the documents are committed and before the projection acquires
   * the workspace write lock. A test uses it to take that lock first, so the
   * projection deadline is exercised against a real lock.
   */
  beforeOperationalProjection?: () => void;
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
  /** Present when the settlement's durable steps did not all complete. */
  recovery: AgentAskSettlementRecovery | null;
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
  activate?: boolean;
  action?: string;
  model?: string;
  effort?: string;
  /** Retained for CLI compatibility; deterministic completion evidence no longer needs it. */
  operator?: boolean;
  /** Where the command ran. Inside a worktree of the Project's repository,
   * settlement writes and commits there, on that worktree's branch. */
  cwd?: string;
  /**
   * Deadline, in milliseconds, for the operational projection to acquire the
   * workspace write lock. Defaults to 15 s, the connection's own busy timeout.
   * Tests set it low to exercise a real held lock without a 15-second wait.
   */
  projectionBusyTimeoutMs?: number;
}, hooks?: AgentAskSettlementTestHooks): AgentAskSettlementReceipt {
  if (input.projectionBusyTimeoutMs !== undefined &&
      (!Number.isInteger(input.projectionBusyTimeoutMs) || input.projectionBusyTimeoutMs < 1)) {
    throw validationError("Agent Ask projection deadline must be a positive integer number of milliseconds.");
  }
  const operation = {
    proposalRef: input.proposalRef,
    disposition: input.disposition,
    responsibility: input.responsibility ?? null,
    placement: input.placement ?? null,
    anchor: input.anchor ?? null,
    ...(input.activate || input.action || input.model || input.effort
      ? { activate: input.activate ?? false, action: input.action ?? null, model: input.model ?? null, effort: input.effort ?? null }
      : {})
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
  if ((input.activate || input.action || input.model || input.effort) &&
      (input.disposition !== "accepted" || proposal.normalized.intent !== "plan" || !proposal.normalized.targetRef || !input.activate)) {
    throw validationError("Activation options require an accepted Plan target and --activate.");
  }
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
  const repoRoot = projectCheckoutFor(path.resolve(metadata.repo_path), input.cwd ?? process.cwd());
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
  let completionActionId: string | null = null;
  let completionPlanSlug: string | null = null;
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
            return { ...action, id: actionIds[index], dependencies };
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
            planAfter = appendPlanAction(planAfter, {
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
        if (targetRef === "outcome") {
          const before = readFileSync(projectPath, "utf8");
          fileMutations.push({ path: projectPath, before, after: replaceTopLevelField(before, "goal", proposal.normalized.desiredResult) });
          effects.push(`Updated Project ${project.slug} Outcome.`);
        } else if (targetRef === "milestone") {
          addMilestoneMutations(fileMutations, projectPath, activePlanPath, proposal.normalized.desiredResult);
          effects.push(`Updated Project ${project.slug} and active Plan ${plan.slug} Milestone.`);
        } else {
          // Opening a Decision here produced a question no command could act
          // on: `review approve` has no apply path for an unnamed Project
          // field, so answering it changed nothing and the Decision sat open
          // (R183 / Decision 0046, Issue #351). A target Arcadia cannot apply
          // is refused at preview, before anything is written, where the
          // message can name the supported fields.
          throw validationError(
            "Agent Ask project_update names a Project field Arcadia has no apply path for, so settling it could not change anything.",
            {
              targetRef: targetRef ?? null,
              supported: ["outcome", "milestone"],
              remedy: "Use target_ref: outcome or milestone, or choose the intent that owns the field — `action` or `plan` for Plan work, `decision` to ask the operator a question."
            }
          );
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
          if (input.activate) {
            if (proposedActions.length || input.responsibility) throw validationError("Activate an existing Plan separately from Action amendments.");
            if (target.slug === plan.slug || target.status !== "draft") throw validationError("Activation requires a different draft Plan.");
            if (!input.action || !input.model || !input.placement) throw validationError("Activation requires --action, --model and an explicit queue placement.");
            if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(input.model)) throw validationError("Activation model must be a CLI model identifier.");
            if (input.effort && !["low", "medium", "high", "xhigh", "max", "ultra"].includes(input.effort)) throw validationError("Activation effort is unsupported.");
            const activeRun = db.prepare(`SELECT er.id FROM execution_runs er JOIN work_items wi ON wi.id = er.work_item_id
              WHERE wi.project_id = ? AND er.status IN ('pending_execution', 'running') LIMIT 1`).get(project.id);
            const activeSession = db.prepare(`SELECT id FROM agent_sessions
              WHERE project_id = ? AND status IN ('prepared', 'running', 'needs_input') LIMIT 1`).get(project.id);
            if (activeRun || activeSession || queue.running.some((entry) => entry.projectId === project.id) ||
                queue.attention.some((entry) => entry.projectId === project.id && entry.attentionKind === "session")) {
              throw validationError("Reconcile the Project's existing Session or Run before activating another Plan.");
            }
            const selected = target.actions.find((action) => action.id === input.action);
            const matches = discovered.docs.filter((doc): doc is PlanDoc => doc.type === "plan" && doc.project === project.slug)
              .flatMap((doc) => doc.actions.filter((action) => action.id === input.action));
            const readiness = resolveActionReadiness(repoRoot, project.slug, input.action);
            if (!selected || matches.length !== 1 || selected.status === "done" ||
                !["agent", "autonomous"].includes(selected.responsibility) || selected.clarification !== "clarified" ||
                readiness.blockers.length || readiness.operatorQuestion) {
              throw validationError("Activation requires one unambiguous, eligible first Action.", { action: input.action, blockers: readiness.blockers });
            }
            const projectBefore = readFileSync(projectPath, "utf8");
            const previousBefore = readFileSync(activePlanPath, "utf8");
            const updated = today();
            fileMutations.push(
              { path: projectPath, before: projectBefore, after: setTopLevelFields(projectBefore, {
                active_plan: target.slug, current_action: selected.id, milestone: target.milestone ?? proposal.normalized.desiredResult, updated
              }) },
              { path: activePlanPath, before: previousBefore, after: setTopLevelFields(previousBefore, { status: "draft", current_action: null, updated }) },
              { path: targetPath, before, after: setTopLevelFields(before, {
                status: "active", current_action: selected.id, recommended_model: input.model,
                recommended_reasoning_effort: input.effort ?? null, updated
              }) }
            );
            queueActionKeys = dependencyOrderedActionIds(target.actions.filter((action) => action.status !== "done")
              .map((action) => ({ id: action.id, dependencies: action.dependsOn })))
              .map((id) => `${project.slug}/${id}`);
            queueActionKey = `${project.slug}/${selected.id}`;
            // Only active-plan Actions belong to the order; preserve every other Project's order.
            queueAfter = insertQueueKeys(queueAfter.filter((key) => !key.startsWith(`${project.slug}/`)), queueActionKeys, input.placement, input.anchor);
            arrangeQueue = true;
            actionIdsToValidate.push(selected.id);
            effects.push(`Activated Plan ${target.slug}; selected ${queueActionKey} with ${input.model}${input.effort ? ` / ${input.effort}` : ""}.`);
            effects.push(`Returned Plan ${plan.slug} to draft without changing any Action completion state.`);
            effects.push("Replaced this Project's queue segment; preserved every other Project's relative order. Started no process.");
            const log = discovered.docs.find((doc): doc is LogDoc => doc.type === "log" && doc.project === project.slug);
            const logPath = path.join(repoRoot, log?.relativePath ?? "MISSION_LOG.md");
            const logBefore = existsSync(logPath) ? readFileSync(logPath, "utf8") : null;
            const appendActivation = (current: string | null): string => appendLog(current, project.slug, {
              ...proposal.normalized,
              desiredResult: `Activated ${target.slug} at ${selected.id}.`,
              rationale: `Operator-settled Plan transition. Previous Plan ${plan.slug} remains draft with completion state preserved. ${proposal.normalized.rationale ?? ""}`
            });
            fileMutations.push({ path: logPath, before: logBefore, after: appendActivation(logBefore), reappend: appendActivation });
            break;
          }
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
            const id = newActionIds[index];
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
              after = appendPlanAction(after, {
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
            return { ...action, id: actionIds[index], dependencies, references: uniqueStrings([...proposal.normalized.references, ...action.references]) };
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
      case "complete": {
        requireNoQueueOptions(input);
        if (!targetRef) throw validationError("Agent Ask complete requires target_ref naming the Action.");
        // `plan/<plan-slug>#<action-id>` names an Action in one specific Plan,
        // which may be an inactive one. A session can finish an Action the
        // pointer is not on — the Project supports one `active_plan`, not one
        // piece of work in flight — and the completion record has to be able
        // to land where the work happened. Plain `action/<id>` keeps meaning
        // the active Plan's Action, so nothing about the default path moves.
        const scoped = splitPlanScopedActionRef(targetRef);
        const targetPlan = scoped
          ? discovered.docs.find((doc): doc is PlanDoc => doc.type === "plan" && doc.project === project.slug
            && doc.slug === resolveManagedTargetRef(scoped.planRef, "plan", project.slug))
          : plan;
        if (!targetPlan) throw validationError("Agent Ask complete names a Plan that was not found in this Project.", { targetRef });
        const completingActivePlan = targetPlan.slug === plan.slug;
        const targetPlanPath = path.join(repoRoot, targetPlan.relativePath);
        const planBefore = readFileSync(targetPlanPath, "utf8");
        const projectBefore = readFileSync(projectPath, "utf8");
        const actionId = resolveManagedTargetRef(scoped?.actionRef ?? targetRef, "action", project.slug);
        const action = targetPlan.actions.find((candidate) => candidate.id === actionId);
        if (!action) throw validationError("Agent Ask complete target Action was not found.", { targetRef });
        // Readiness and Decision resolution search every Plan by Action id, so
        // a duplicated id would let them answer about the wrong Plan's Action.
        // Activation already refuses an ambiguous id for the same reason.
        const plansHoldingActionId = discovered.docs.filter((doc): doc is PlanDoc =>
          doc.type === "plan" && doc.project === project.slug && doc.actions.some((candidate) => candidate.id === actionId));
        if (plansHoldingActionId.length !== 1) {
          throw validationError("Agent Ask complete target Action id is not unique across this Project's Plans.", {
            actionId, plans: plansHoldingActionId.map((doc) => doc.slug)
          });
        }
        if (action.status === "done") throw validationError("Action is already done.", { actionId });
        if (action.responsibility !== "agent" && action.responsibility !== "autonomous") {
          throw validationError("Only an agent or autonomous Action can be completed through this routine.", {
            actionId, responsibility: action.responsibility
          });
        }
        const head = git(repoRoot, ["rev-parse", "HEAD"]).trim();
        const candidateRevision = proposal.normalized.candidateRevision!;
        if (head !== candidateRevision && !head.startsWith(candidateRevision)) {
          throw validationError(
            `Completion Candidate revision ${candidateRevision} does not match ${repoRoot}'s current HEAD ${head}.`,
            { expectedHead: head, receivedRevision: candidateRevision, repoRoot }
          );
        }
        const declared = action.acceptanceCriteria;
        if (declared.length === 0) throw validationError("Action declares no acceptance criteria to bind completion evidence to.", { actionId });
        const evidence = proposal.normalized.evidence;
        if (evidence.length !== declared.length || evidence.some((entry, index) => entry.criterion !== declared[index])) {
          throw validationError("Completion evidence must cover every declared acceptance criterion, verbatim and in the plan's own order.", {
            declared, provided: evidence.map((entry) => entry.criterion)
          });
        }
        const unmet = evidence.filter((entry) => entry.status !== "met");
        if (unmet.length > 0) {
          throw validationError("Completion refused: not every acceptance criterion is met.", {
            unmet: unmet.map((entry) => ({ criterion: entry.criterion, status: entry.status, note: entry.note }))
          });
        }
        const readiness = resolveActionReadiness(repoRoot, project.slug, actionId);
        const unresolvedDecisions = readiness.requiredDecisions.filter((decision) => !decision.resolved);
        if (unresolvedDecisions.length > 0) {
          throw validationError("Completion refused: Action has unresolved required review Decisions.", {
            unresolvedDecisions: unresolvedDecisions.map((decision) => decision.id)
          });
        }

        const decisionDocsForPlan = discovered.docs.filter((doc): doc is DecisionDoc => doc.type === "decision" && doc.project === project.slug);
        const nextResolution = selectNextAfterCompletion(targetPlan, actionId, decisionDocsForPlan, queueAfter, project.slug);
        const updated = today();
        const planComplete = nextResolution.kind === "planComplete";
        // Decision 0048: an Action completion uses the same total transition
        // resolver as Arcadia Go. When the active Plan is now complete, the
        // explicit queue may name exactly one approved successor Plan; activate
        // it here rather than leaving the pointer on a finished Plan. The Action
        // being completed is ignored so it is never offered as its own successor.
        const activation = planComplete && completingActivePlan
          ? resolvePlanActivation({
              repoRoot,
              projectSlug: project.slug,
              positions: loadActionOrder(db).positions,
              ignoredActionKeys: new Set([`${project.slug}/${actionId}`])
            })
          : null;
        const activatedNext = activation?.status === "candidate" ? activation.candidate : null;
        const activatedPlanDoc = activatedNext
          ? discovered.docs.find((doc): doc is PlanDoc => doc.type === "plan" && doc.project === project.slug && doc.slug === activatedNext.planSlug) ?? null
          : null;
        // Resolve the pointer target once and pin it. A compare-and-set retry
        // re-applies these transforms to fresh base content; it never re-derives
        // current_action from fresh queue state, which could silently retarget a
        // different Action than the one this settlement resolved and previewed.
        const planTransform = (current: string): string => setTopLevelFields(markActionDone(current, actionId),
          planComplete ? { status: "complete", current_action: null, updated } : { current_action: nextResolution.actionId, updated });
        const projectTransform = (current: string): string => setTopLevelFields(current,
          activatedNext
            ? { active_plan: activatedNext.planSlug, current_action: activatedNext.actionId, updated }
            : { current_action: planComplete ? null : nextResolution.actionId, updated });
        effects.push(`Marked Action ${project.slug}/${actionId} done with accepted evidence for all ${declared.length} criteria.`);
        if (activatedNext) {
          effects.push(`Plan ${targetPlan.slug} is complete; activated Plan ${activatedNext.planSlug} from the explicit queue at ${activatedNext.actionKey}.`);
        } else if (planComplete) {
          effects.push(`Plan ${targetPlan.slug} is complete; every Action is done.${completingActivePlan ? " Select a new active Plan when ready." : ""}`);
        } else {
          effects.push(`${nextResolution.note} Pointer: ${project.slug}/${nextResolution.actionId}.`);
        }
        if (completingActivePlan) {
          // The Project pointer belongs to the active Plan, so PROJECT.md and the
          // Plan are written and compared as one atomic pair.
          fileMutations.push(
            { path: targetPlanPath, before: planBefore, after: planTransform(planBefore), retransform: planTransform, pair: "plan" },
            { path: projectPath, before: projectBefore, after: projectTransform(projectBefore), retransform: projectTransform, pair: "project" }
          );
          if (activatedNext && activatedPlanDoc) {
            const activatedPlanPath = path.join(repoRoot, activatedPlanDoc.relativePath);
            const activatedPlanBefore = readFileSync(activatedPlanPath, "utf8");
            const activatedPlanTransform = (current: string): string => setTopLevelFields(current, {
              status: "active",
              current_action: activatedNext.actionId,
              updated
            });
            fileMutations.push({
              path: activatedPlanPath,
              before: activatedPlanBefore,
              after: activatedPlanTransform(activatedPlanBefore),
              retransform: activatedPlanTransform
            });
          }
        } else {
          // Completing an Action in another Plan records that Plan's own progress
          // and leaves `active_plan`, `current_action`, and the execution queue
          // untouched, so nothing about automatic dispatch changes for anyone
          // else (issue #502).
          fileMutations.push({ path: targetPlanPath, before: planBefore, after: planTransform(planBefore), retransform: planTransform });
          effects.push(`Left Project pointer ${project.slug}/${projectDoc.currentAction ?? "none"} and the active Plan ${plan.slug} untouched; ${targetPlan.slug} is not the active Plan.`);
        }
        const completionLog = discovered.docs.find((doc): doc is LogDoc => doc.type === "log" && doc.project === project.slug);
        const completionLogPath = path.join(repoRoot, completionLog?.relativePath ?? "MISSION_LOG.md");
        const completionLogBefore = existsSync(completionLogPath) ? readFileSync(completionLogPath, "utf8") : null;
        const appendCompletion = (current: string | null): string => appendCompletionLog(current, project.slug, {
          actionId, candidateRevision: head, evidence, requestId: proposal.normalized.requestId,
          note: activatedNext
            ? `Plan complete; activated Plan ${activatedNext.planSlug} from the explicit queue at ${activatedNext.actionKey}.`
            : nextResolution.kind === "planComplete" ? "Plan complete; every Action is done." : nextResolution.note
        });
        fileMutations.push({ path: completionLogPath, before: completionLogBefore, after: appendCompletion(completionLogBefore), reappend: appendCompletion });
        completionActionId = actionId;
        completionPlanSlug = targetPlan.slug;
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
        const append = (current: string | null): string => appendLog(current, project.slug, proposal.normalized);
        fileMutations.push({ path: logPath, before, after: append(before), reappend: append });
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

  // The queue reads Actions from the configured checkout, so it cannot yet
  // position Actions that exist only on an unmerged candidate branch.
  if (arrangeQueue && repoRoot !== path.resolve(metadata.repo_path)) {
    throw validationError("This settlement places Actions in the queue, which needs them on the base branch.", {
      candidate: repoRoot,
      remedy: "Settle it from the Project's main checkout, or after the candidate merges."
    });
  }

  archiveSettledAskFile(fileMutations, effects, repoRoot, proposal.sourcePath ?? null);

  const previewFingerprint = sha256(JSON.stringify({
    proposalFingerprint: proposal.fingerprint,
    operation,
    queueRevision: queue.revision,
    fileMutations: fileMutations.map((mutation) => ({ path: mutation.path, before: mutation.before ? sha256(mutation.before) : null, after: mutation.after ? sha256(mutation.after) : null })),
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
      kind: proposal.normalized.intent === "complete" && !input.operator
        ? "deterministic_proof"
        : "operator_acceptance",
      requestedAuthority: proposal.normalized.requestedAuthority,
      boundedPolicyDecision: null
    },
    notificationStatus: input.apply ? "pending" : "withheld_until_apply",
    createdAt: now
  };
  if (!input.apply) return baseReceipt;

  if (fileMutations.length > 0) {
    // Draft Ask files are bounded intake, not incidental dirt. A complete
    // settlement consumes one of them, while other pending drafts must remain
    // available for their own future settlement. Nothing else in the working
    // tree is exempted.
    assertClean(repoRoot, "Agent Ask Project repository", untrackedDraftAskPaths(repoRoot));
  }

  // A settlement's durable record is the committed managed document, not the
  // database row (Issue #270). The projection transaction that writes the
  // receipt can fail — a held workspace write lock is exactly that trigger —
  // and then no `agent_ask_settlements` row exists. Both database guards
  // (`request_id` and `proposal_id`) would pass on a later attempt, and a
  // caller retrying with a fresh settlement request id would re-append a record
  // that is already committed. Detect it from the documents themselves: every
  // derived-document writer stamps the Ask's request id into a stable field
  // (`source:` on a Plan Action, the Log entry heading, the Decision body), so
  // the marker's presence is proof the settlement already landed, database or
  // no database.
  const committedDoc = findCommittedSettlement(discoverDocs(repoRoot).docs, project.slug, proposal.normalized.requestId);
  if (committedDoc) {
    throw validationError(
      `Agent Ask ${proposal.normalized.requestId} already wrote ${committedDoc}; a previous apply committed its documents without recording its receipt. Run \`arcadia docs sync\` to reconcile the Project projection instead of re-applying.`,
      { requestId: proposal.normalized.requestId, path: committedDoc }
    );
  }

  hooks?.beforeDocumentWrite?.();
  // Phase 1 — write the managed documents and prove the canonical truth they
  // are supposed to produce, all inside the workspace database's immediate
  // transaction — the same interlock `arcadia tidy` uses. Two concurrent
  // settlements serialize here and each re-reads the other's change instead of
  // overwriting it. A refusal rolls back exactly the mutations this attempt
  // wrote, before the interlock is released, so it can never restore stale
  // content over a concurrent writer.
  if (fileMutations.length > 0) writeTransaction(db, () => {
    const applied: FileMutation[] = [];
    try {
      // The PROJECT.md + Plan pair is written through the same fingerprint-checked
      // compare-and-set `arcadia advance queue make-next` uses: a concurrent
      // settlement that moved the pointer between this settlement's resolution and
      // now is re-read, and this settlement's pinned change is re-applied on top
      // of it rather than overwriting it with a stale computed result.
      const pointerPair = selectPointerPair(fileMutations);
      if (pointerPair) {
        const receipt = writePointerPairWithCompareAndSet({
          repoRoot,
          projectPath: pointerPair.project.path,
          planPath: pointerPair.plan.path,
          projectBefore: pointerPair.project.before!,
          planBefore: pointerPair.plan.before!,
          projectAfter: pointerPair.project.retransform!,
          planAfter: pointerPair.plan.retransform!
        });
        // Anchor the rollback on the pre-transform content the writer read, not
        // on its output, so a later refusal undoes exactly this settlement's move.
        pointerPair.project.before = receipt.projectBefore;
        pointerPair.project.after = receipt.projectAfter;
        pointerPair.plan.before = receipt.planBefore;
        pointerPair.plan.after = receipt.planAfter;
        applied.push(pointerPair.project, pointerPair.plan);
        if (receipt.retried) {
          effects.push("Re-read PROJECT.md and the Plan after a concurrent pointer write and re-applied this settlement's change on top.");
        }
      }
      for (const mutation of fileMutations) {
        if (mutation.pair) continue;
        // A shared document is recomputed from fresh content under the interlock,
        // so a concurrent settlement's change or log entry is preserved rather
        // than replaced by a stale resolution-time `after`.
        if (mutation.reappend) {
          const current = existsSync(mutation.path) ? readFileSync(mutation.path, "utf8") : null;
          mutation.before = current;
          mutation.after = mutation.reappend(current);
        } else if (mutation.retransform) {
          const current = readFileSync(mutation.path, "utf8");
          mutation.before = current;
          mutation.after = mutation.retransform(current);
        }
        if (mutation.after === null) { try { unlinkSync(mutation.path); } catch {} }
        else writeAtomically(mutation.path, mutation.after);
        applied.push(mutation);
      }
      if (input.activate) {
        const dispatch = resolveDispatch(repoRoot, project.slug);
        if (!isDispatchable(dispatch) || dispatch.context?.action.id !== input.action) {
          throw validationError("Plan activation did not produce dispatchable canonical truth.", { blockers: dispatch.blockers, question: dispatch.operatorQuestion });
        }
      }
      if (completionActionId) {
        const verified = discoverDocs(repoRoot);
        const verifiedPlan = verified.docs.find((doc): doc is PlanDoc => doc.type === "plan" && doc.project === project.slug && doc.slug === completionPlanSlug);
        const verifiedAction = verifiedPlan?.actions.find((candidate) => candidate.id === completionActionId);
        if (!verifiedAction || verifiedAction.status !== "done") {
          throw validationError("Completion did not produce a done canonical Action.", { actionId: completionActionId });
        }
      }
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
      // A settlement answers for the documents it wrote, and for nothing else.
      // Decision 0044: this check used to refuse on any error anywhere in the
      // corpus, so one stale document from weeks ago permanently blocked every
      // future settlement in that repository — and, because no intent can amend
      // an existing document, blocked the very Ask that would have cleared it.
      // An adopting project hit exactly that on its first real use, with 49
      // pre-existing errors it had not introduced.
      //
      // The crawl still covers everything, because cross-document checks and
      // ingestion need the whole graph; only the refusal narrows. Unrelated
      // corpus errors remain real and remain reportable — `arcadia docs` is
      // where the operator asks that question deliberately, rather than
      // discovering it as a refusal of unrelated work.
      //
      // Run read-only here, before the commit, so a malformed derived document
      // is still refused with the working tree untouched (Issue #270 moved the
      // commit ahead of the operational sync; this keeps the old refusal
      // semantics without letting the sync gate the commit).
      const validation = syncProjectDocs(db, project, { apply: false, repoRoot });
      const written = new Set(
        fileMutations.map((mutation) => path.relative(repoRoot, mutation.path)),
      );
      const blocking = validation.errors.filter((error) => written.has(error.relativePath));
      if (blocking.length > 0) {
        throw validationError("Accepted Agent Ask managed documents failed operational sync.", {
          errors: blocking,
          unrelatedCorpusErrors: validation.errors.length - blocking.length,
        });
      }
    } catch (error) {
      // Roll back exactly what this attempt wrote, inside the interlock, so a
      // mutation the loop never reached cannot be reverted over a concurrent
      // writer's content.
      for (const mutation of [...applied].reverse()) restoreMutation(mutation);
      throw error;
    }
  });

  // Phase 2 — commit the authoritative documents before any side effect can run.
  // A settlement's durable output is checked-in managed documents; the database
  // is a projection. Issue #270: the commit used to wait on an operational sync
  // inside one database transaction, so a stall there (a held workspace write
  // lock, a worker mid-tick) left the record written but uncommitted and its
  // review item missing, and a human had to commit by hand. The commit is
  // local, cheap, and deterministic, so it now happens first and nothing can
  // gate it.
  //
  // A Git failure must leave the settled documents intact for recovery, and its
  // message must reach the operator now rather than at the next refused
  // command — so it does not refuse: the projection still runs, the settlement
  // is recorded, and the working tree is reported as the recoverable part.
  let commitError: string | null = null;
  if (fileMutations.length > 0) {
    commitError = commitSettlementOutput(repoRoot, fileMutations, baseReceipt);
    if (commitError) process.stderr.write(`The settled managed documents were written but could not be committed: ${commitError}\n`);
  }

  // Phase 3 — bounded operational projection. Review items, queue placement,
  // and the settlement receipt are all derived from documents that are already
  // on disk, so a failure here is recoverable with `arcadia docs sync` and must
  // never hide or undo the record.
  //
  // The bound is explicit and testable. better-sqlite3 is synchronous, so
  // SQLite's own busy handler is the only place a lock wait can be bounded;
  // scoping it here keeps it a projection budget rather than a settlement one.
  hooks?.beforeOperationalProjection?.();
  db.pragma(`busy_timeout = ${input.projectionBusyTimeoutMs ?? DEFAULT_PROJECTION_BUSY_TIMEOUT_MS}`);
  let settled: AgentAskSettlementReceipt;
  try {
    settled = writeTransaction(db, () => {
      hooks?.beforeOperationalSync?.();
      if (fileMutations.length > 0) {
        const sync = syncProjectDocs(db, project, { apply: true, repoRoot });
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
      insertSettlementRow(db, receipt, {
        proposalId: proposal.id, settlementRequestId: input.settlementRequestId, operation,
        previewFingerprint, effects, queueActionKey, projectSlug: project.slug, now
      });
      return receipt;
    });
  } catch (error) {
    // The record is on disk; only its projection is behind. Return a receipt
    // the operator can act on rather than an opaque failure, and say exactly
    // how to finish the projection.
    const reason = error instanceof Error ? error.message : String(error);
    const syncRemedy = "Run `arcadia docs sync` to reconcile this Project's review items and queue projection.";
    process.stderr.write(`The settled managed documents were written, but the operational sync did not complete: ${reason}\n${syncRemedy}\n`);
    const recoveryReceipt: AgentAskSettlementReceipt = {
      ...baseReceipt,
      nextActionKey: null,
      recovery: {
        documentsCommitted: commitError === null,
        operationalSync: "pending",
        reason,
        remedy: syncRemedy
      }
    };
    // Record the settlement in its own bounded transaction so a retry is
    // refused rather than silently duplicating the committed record. The
    // pending notification still describes a settlement that did happen; only
    // the projection it points at is behind.
    let recorded = false;
    try {
      writeTransaction(db, () => {
        insertSettlementRow(db, recoveryReceipt, {
          proposalId: proposal.id, settlementRequestId: input.settlementRequestId, operation,
          previewFingerprint, effects, queueActionKey, projectSlug: project.slug, now
        });
      });
      recorded = true;
    } catch {
      // The projection is unavailable too; the stderr note already says so.
    }
    settled = recorded ? recoveryReceipt : { ...recoveryReceipt, notificationStatus: "withheld_until_apply" };
  }
  if (commitError) {
    settled = {
      ...settled,
      recovery: settled.recovery
        ? { ...settled.recovery, documentsCommitted: false, remedy: `${settled.recovery.remedy} Commit the settled documents in ${repoRoot} by hand; they are present in the working tree.` }
        : {
            documentsCommitted: false,
            operationalSync: "complete",
            reason: commitError,
            remedy: `Commit the settled documents in ${repoRoot} by hand; the settlement is recorded and its files are present in the working tree.`
          }
    };
    // Keep the recorded receipt truthful too. The recovery is what the operator
    // reads on the channel they actually monitor, not the settling shell's
    // stderr, so it belongs in the row `notifications` projects from.
    try {
      db.prepare("UPDATE agent_ask_settlements SET receipt_json = ?, notification_status = ? WHERE id = ?")
        .run(JSON.stringify(settled), settled.notificationStatus, settled.id);
    } catch {
      // The projection is unavailable as well; the returned receipt still carries it.
    }
  }
  return settled;
}

/**
 * The managed document a previous apply of this Ask already wrote, or null.
 *
 * The database receipt can be missing while the documents are committed (Issue
 * #270's write-lock stall), so this is the durable, database-independent guard
 * against re-applying a settled Ask. It matches only the exact fields the
 * settlement writers stamp, never free prose, so a Log entry that merely
 * mentions an Ask id does not register as that Ask's record.
 */
function findCommittedSettlement(docs: ArcadiaDoc[], projectSlug: string, requestId: string): string | null {
  const marker = `Agent Ask ${requestId}`;
  for (const doc of docs) {
    // A Plan Action created or amended by this Ask carries it as `source`.
    if (doc.type === "plan" && doc.project === projectSlug && doc.actions.some((action) => action.source === marker)) {
      return doc.relativePath;
    }
    // A Log entry this Ask appended is headed with it.
    if (doc.type === "log" && doc.project === projectSlug && doc.entries.some((entry) => entry.title === marker)) {
      return doc.relativePath;
    }
    // A Decision this Ask filed names it as its proposer.
    if (doc.type === "decision" && doc.project === projectSlug && doc.body.includes(marker)) {
      return doc.relativePath;
    }
  }
  return null;
}

/**
 * Persist one settlement receipt row. Shared by the happy path (inside the
 * operational-projection transaction) and the recovery path (#270), which
 * records the settlement even when the projection could not be rebuilt.
 */
function insertSettlementRow(
  db: Database.Database,
  receipt: AgentAskSettlementReceipt,
  context: {
    proposalId: string;
    settlementRequestId: string;
    operation: unknown;
    previewFingerprint: string;
    effects: string[];
    queueActionKey: string | null;
    projectSlug: string;
    now: string;
  }
): void {
  db.prepare(`INSERT INTO agent_ask_settlements
    (id, proposal_id, request_id, operation_json, fingerprint, disposition, project_slug,
     effects_json, queue_action_key, queue_position, next_action_key, notification_status,
     receipt_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
    .run(receipt.id, context.proposalId, context.settlementRequestId, JSON.stringify(context.operation),
      context.previewFingerprint, receipt.disposition, context.projectSlug, JSON.stringify(context.effects),
      context.queueActionKey, receipt.queuePosition, receipt.nextActionKey, JSON.stringify(receipt), context.now);
}

/**
 * Commit the managed documents one settlement wrote, on whatever branch the
 * settling checkout is on — the candidate branch when settlement ran from a
 * candidate worktree, so the record ships in that pull request. Never pushes: landing a record locally is
 * Arcadia's job, publishing it is the operator's.
 *
 * Paths are passed explicitly so that nothing outside this settlement can be
 * swept into the commit, even though `assertClean` already established there
 * was nothing else to sweep. Returns null on success or a message on failure;
 * the caller surfaces it instead of silently reporting success over a dirty
 * tree.
 */
function commitSettlementOutput(
  repoRoot: string,
  fileMutations: FileMutation[],
  receipt: AgentAskSettlementReceipt
): string | null {
  const allPaths = fileMutations.map((mutation) => ({ relative: path.relative(repoRoot, mutation.path), deleted: mutation.after === null }));
  // A deletion mutation whose file was never tracked — the drafted Ask file
  // this settlement consumed and archived, when the operator never committed
  // the draft first — has nothing for `git add`/`git commit` to stage: the
  // file is already gone from disk, and it was never in the index either.
  // Naming it in either pathspec fails the whole command with "did not match
  // any files", which used to be swallowed here and left the entire
  // settlement (every other file it wrote) sitting uncommitted. `git ls-files`
  // reports what the index has regardless of the working tree, so it still
  // finds a genuinely tracked-then-deleted path even after the unlink above.
  const deletionPaths = allPaths.filter((entry) => entry.deleted).map((entry) => entry.relative);
  const tracked = deletionPaths.length > 0
    ? new Set(git(repoRoot, ["ls-files", "-z", "--", ...deletionPaths]).split("\0").filter(Boolean))
    : new Set<string>();
  const paths = allPaths.filter((entry) => !entry.deleted || tracked.has(entry.relative)).map((entry) => entry.relative);
  const message = [
    `chore(arcadia): settle ${receipt.proposalRequestId}`,
    "",
    ...receipt.effects.map((effect) => `- ${effect}`),
    "",
    `Written by \`arcadia agent-ask settle --apply\` (${receipt.id}).`,
    "Arcadia writes and lands its own managed documents; it did not author the",
    "decision they record."
  ].join("\n");
  if (paths.length === 0) return null;
  return commitOnlyPaths(repoRoot, paths, message);
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
        createdAt: String(value.created_at),
        recovery: receipt.recovery ?? null
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

/** Append one Action block to a managed Plan's block-form `actions:` list. Shared with production scheduling's discovery path. */
export function appendPlanAction(content: string, action: {
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
    `    references: [${action.references.map((reference) => JSON.stringify(reference)).join(", ")}]`
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
    ordered.push(next.id);
    resolved.add(next.id);
  }
  return ordered;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function resolveManagedTargetRef(targetRef: string, kind: "action" | "plan", projectSlug: string): string {
  const parts = targetRef.split("/").filter(Boolean);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2 && (parts[0] === kind || parts[0] === projectSlug)) return parts[1];
  throw validationError("Agent Ask cannot mutate another Project without explicit governed authority.", {
    destinationProject: projectSlug,
    targetRef
  });
}

/**
 * Split `plan/<plan-slug>#<action-id>` into its two halves.
 *
 * Returns null for every other shape, which is how `action/<id>` keeps
 * resolving against the active Plan exactly as before.
 */
function splitPlanScopedActionRef(targetRef: string): { planRef: string; actionRef: string } | null {
  const separator = targetRef.indexOf("#");
  if (separator < 0) return null;
  const planRef = targetRef.slice(0, separator).trim();
  const actionRef = targetRef.slice(separator + 1).trim();
  if (!planRef || !actionRef || actionRef.includes("#")) {
    throw validationError("A Plan-scoped target_ref must read plan/<plan-slug>#<action-id>.", { targetRef });
  }
  return { planRef, actionRef };
}

function requireNoQueueOptions(input: { responsibility?: AgentAskResponsibility; placement?: AgentAskPlacement; anchor?: string }): void {
  if (input.responsibility || input.placement || input.anchor) {
    throw validationError("This Agent Ask effect creates no Action; Responsibility and queue placement do not apply.");
  }
}

export function replaceTopLevelField(content: string, field: string, value: string): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw validationError("Managed document has no YAML frontmatter block to update.");
  const lines = match[1].split(/\r?\n/);
  const index = lines.findIndex((line) => new RegExp(`^${escapeRegex(field)}\\s*:`).test(line));
  if (index < 0) throw validationError(`Managed document has no ${field} field to update.`);
  lines[index] = `${field}: ${yamlScalar(value)}`;
  return content.replace(match[0], `---\n${lines.join("\n")}\n---`);
}

/** Update only the frontmatter's top level, preserving Action state and narrative. */
function setTopLevelFields(content: string, fields: Record<string, string | null>): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw validationError("Managed document has no YAML frontmatter block to update.");
  const lines = match[1].split(/\r?\n/);
  for (const [field, value] of Object.entries(fields)) {
    const index = lines.findIndex((line) => line.startsWith(`${field}:`));
    if (value === null) { if (index >= 0) lines.splice(index, 1); }
    else if (index >= 0) lines[index] = `${field}: ${yamlScalar(value)}`;
    else lines.push(`${field}: ${yamlScalar(value)}`);
  }
  return content.replace(match[0], `---\n${lines.join("\n")}\n---`);
}

function addMilestoneMutations(mutations: FileMutation[], projectPath: string, planPath: string, milestone: string): void {
  const projectBefore = readFileSync(projectPath, "utf8");
  const planBefore = readFileSync(planPath, "utf8");
  const transform = (current: string): string => replaceTopLevelField(current, "milestone", milestone);
  mutations.push(
    { path: projectPath, before: projectBefore, after: transform(projectBefore), retransform: transform, pair: "project" },
    { path: planPath, before: planBefore, after: transform(planBefore), retransform: transform, pair: "plan" }
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
    `Proposed by Agent Ask ${requestId}.`, ""
  ].join("\n");
  mutations.push({ path: targetPath, before: null, after: frontmatter });
}

function uniqueDecisionSlug(decisions: DecisionDoc[], base: string): string {
  if (!decisions.some((decision) => decision.slug === base)) return base;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = boundedSuffixedSlug(base, `-${index}`);
    if (!decisions.some((decision) => decision.slug === candidate)) return candidate;
  }
  throw validationError("Agent Ask could not allocate a unique Decision slug.");
}

function uniquePlanSlug(plans: PlanDoc[], base: string): string {
  const stem = base || "agent-ask-plan";
  if (!plans.some((plan) => plan.slug === stem)) return stem;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = boundedSuffixedSlug(stem, `-${index}`);
    if (!plans.some((plan) => plan.slug === candidate)) return candidate;
  }
  throw validationError("Agent Ask could not allocate a unique Plan slug.");
}

/**
 * Append a uniqueness suffix without breaking the slug length cap. The base is
 * already at the cap when a long question collided, so the suffix is carved out
 * of the base rather than added past 80 characters.
 */
function boundedSuffixedSlug(base: string, suffix: string): string {
  const room = SLUG_MAX_LENGTH - suffix.length;
  const stem = base.length > room ? base.slice(0, room).replace(/-+$/, "") : base;
  return `${stem || "item"}${suffix}`;
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
    `    references: [${action.references.map((reference) => JSON.stringify(reference)).join(", ")}]`
  ]);
  return [
    "---", "arcadia: v1", "type: plan", `slug: ${planSlug}`, `project: ${projectSlug}`, "status: draft",
    `milestone: ${yamlScalar(milestone)}`, "token_impact: medium",
    `token_budget: ${yamlScalar("Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.")}`,
    `updated: ${today()}`, ...(actionLines.length > 0 ? ["actions:", ...actionLines] : ["actions: []"]),
    "questions: []", "decisions: []", "---", "",
    `# ${milestone}`, "", `Created as an inactive draft from accepted Agent Ask ${requestId}; creation changed no pointer. Current activation is recorded in frontmatter.`, ""
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
  if (!/^ {4}next_action:/m.test(block)) throw validationError("Managed Plan Action has no next_action field to amend.", { actionId });
  block = block.replace(/^ {4}next_action:.*$/m, `    next_action: ${yamlScalar(nextAction)}`);
  if (responsibility) {
    if (!/^ {4}responsibility:/m.test(block)) throw validationError("Managed Plan Action has no responsibility field to amend.", { actionId });
    block = block.replace(/^ {4}responsibility:.*$/m, `    responsibility: ${responsibility}`);
  }
  if (acceptance.length > 0) {
    const replacement = ["    acceptance_criteria:", ...acceptance.map((criterion) => `      - ${yamlScalar(criterion)}`)].join("\n");
    block = block.replace(/^ {4}acceptance_criteria:\r?\n(?: {6}- .*\r?\n?)*/m, `${replacement}\n`);
  }
  // depends_on/references may already be written as a multi-line block list
  // (each item on its own "      - " line) rather than an inline [a, b]; the
  // continuation lines must be consumed too, or they survive as an orphaned
  // sequence the YAML parser rejects.
  block = block.replace(/^ {4}depends_on:.*(?:\r?\n {6}- .*)*/m,
    dependencies.length > 0 ? `    depends_on: [${dependencies.join(", ")}]` : "    depends_on: []");
  block = block.replace(/^ {4}references:.*(?:\r?\n {6}- .*)*/m,
    references.length > 0 ? `    references: [${references.map((reference) => JSON.stringify(reference)).join(", ")}]` : "    references: []");
  block = /^ {4}source:/m.test(block)
    ? block.replace(/^ {4}source:.*$/m, `    source: ${yamlScalar(`Agent Ask ${requestId}`)}`)
    : block.replace(/^ {4}clarification:.*$/m, `$&\n    source: ${yamlScalar(`Agent Ask ${requestId}`)}`);
  return content.replace(pattern, block);
}

function markActionDone(content: string, actionId: string): string {
  const pattern = new RegExp(`(^  - id: ${escapeRegex(actionId)}\\r?$[\\s\\S]*?)(?=^  - id: |^---\\r?$)`, "m");
  const match = content.match(pattern);
  if (!match) throw validationError("Managed Plan Action block was not found.", { actionId });
  let block = match[1];
  if (!/^ {4}status:/m.test(block)) throw validationError("Managed Plan Action has no status field to amend.", { actionId });
  block = block.replace(/^ {4}status:.*$/m, "    status: done");
  return content.replace(pattern, block);
}

interface NextAfterCompletion {
  kind: "next" | "planComplete";
  actionId: string | null;
  note: string;
}

/**
 * Resolve the pointer's next value from documents already loaded in memory,
 * as though `completedActionId` were already marked done — never by reading
 * disk mid-mutation, and never by choosing a different Plan: Decision 0042's
 * "no inactive Plan is inferred from queue order" applies here exactly as it
 * does to the rest of dispatch. When nothing in this Plan is fully eligible,
 * the pointer still moves to the nearest Action so dispatch can report
 * exactly what it needs, rather than leaving a done Action as current_action.
 */
function selectNextAfterCompletion(
  plan: PlanDoc,
  completedActionId: string,
  decisionDocs: DecisionDoc[],
  queueOrderKeys: string[],
  projectSlug: string
): NextAfterCompletion {
  const statusOf = new Map(plan.actions.map((action) => [action.id, action.id === completedActionId ? "done" : action.status]));
  // An Action is parked either because its Plan record says so (the deferral
  // was applied) or because an approved Decision with a `defer` effect names it
  // and the apply path has not run yet. Both must stop the pointer advancing
  // onto work the operator parked (Issue #310).
  const deferredByDecision = deferredActionIdsFromDecisions(plan, decisionDocs);
  const parked = (actionId: string): boolean =>
    statusOf.get(actionId) === "deferred" || deferredByDecision.has(actionId);

  const remaining = plan.actions.filter(
    (action) => action.id !== completedActionId && statusOf.get(action.id) !== "done" && !parked(action.id)
  );
  if (remaining.length === 0) {
    return { kind: "planComplete", actionId: null, note: "Every Action in this Plan is now done or deferred." };
  }
  const evaluated = remaining.map((action) => {
    const unmetDependencies = action.dependsOn.filter((dependency) => statusOf.has(dependency) && statusOf.get(dependency) !== "done");
    const unresolvedDecisions = action.decisions.filter((id) => {
      const found = decisionDocs.find((decision) => decision.id === id || decision.slug === id);
      return !found || (found.status !== "approved" && found.status !== "rejected");
    });
    const hasQuestion = action.clarification === "question_open";
    const authorized = action.responsibility === "agent" || action.responsibility === "autonomous";
    const blockerCount = unmetDependencies.length + unresolvedDecisions.length + (hasQuestion ? 1 : 0) + (authorized ? 0 : 1);
    return { action, blockerCount };
  });
  // Decision 0054: the explicit queue is the source of priority. The pointer
  // follows it rather than the Plan document's declaration order; an
  // unpositioned Action keeps document order after positioned ones.
  const rankOf = buildQueueRank(queueOrderKeys, projectSlug, plan.actions.map((action) => action.id));
  const eligible = evaluated
    .filter((entry) => entry.blockerCount === 0)
    .sort((left, right) => rankOf(left.action.id) - rankOf(right.action.id))[0];
  if (eligible) {
    return { kind: "next", actionId: eligible.action.id, note: "Advanced to the next eligible Action in the explicit queue order." };
  }
  const nearest = evaluated.reduce((closest, entry) => (entry.blockerCount < closest.blockerCount ? entry : closest));
  return {
    kind: "next",
    actionId: nearest.action.id,
    note: "No fully eligible Action remains in this Plan; pointer moved to the nearest Action, which needs attention before it can dispatch."
  };
}

/**
 * The Action ids an approved Decision with a `defer` effect names. A Decision
 * governs an Action only when it carries `action:`, and only the option the
 * operator actually recorded (`answer:`) counts.
 */
function deferredActionIdsFromDecisions(plan: PlanDoc, decisionDocs: DecisionDoc[]): Set<string> {
  const deferred = new Set<string>();
  for (const action of plan.actions) {
    if (deferringDecisionFor(action.id, decisionDocs)) deferred.add(action.id);
  }
  return deferred;
}

/** Position of each Action in the explicit queue; unpositioned Actions sort last, in declaration order. */
function buildQueueRank(queueOrderKeys: string[], projectSlug: string, actionIdsInDocumentOrder: string[]): (actionId: string) => number {
  const positionById = new Map<string, number>();
  queueOrderKeys.forEach((key, index) => {
    const separator = key.indexOf("/");
    if (separator < 0) return;
    if (key.slice(0, separator) !== projectSlug) return;
    positionById.set(key.slice(separator + 1), index);
  });
  const fallbackBase = queueOrderKeys.length;
  const documentRank = new Map(actionIdsInDocumentOrder.map((id, index) => [id, index]));
  return (actionId: string) => positionById.get(actionId) ?? fallbackBase + (documentRank.get(actionId) ?? 0);
}

function appendCompletionLog(before: string | null, projectSlug: string, input: {
  actionId: string;
  candidateRevision: string;
  evidence: NormalizedAgentAskEvidence[];
  requestId: string;
  note: string;
}): string {
  const base = before ?? [
    "---", "arcadia: v1", "type: log", `slug: ${projectSlug}-mission-log`, `project: ${projectSlug}`,
    `updated: ${today()}`, "---", "", `# Mission Log: ${projectSlug}`, ""
  ].join("\n");
  const updated = replaceTopLevelField(base, "updated", today()).trimEnd();
  return `${updated}\n\n## ${today()} — Completed ${projectSlug}/${input.actionId}\n\n` + [
    `- **Did:** Completed Action ${projectSlug}/${input.actionId} from accepted evidence (Candidate ${input.candidateRevision}).`,
    `- **Result:** Every declared acceptance criterion was accepted as met: ${input.evidence.map((entry) => `"${entry.criterion}"`).join("; ")}.`,
    `- **Next:** ${input.note}`,
    `- **Blockers:** None recorded by this settlement (Agent Ask ${input.requestId}).`
  ].join("\n") + "\n";
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

/**
 * Archive a terminally settled Ask's source `.arcadia/asks/` file into
 * `.arcadia/asks/archive/`, in the same commit as the settlement effects
 * themselves. Filing is disposable input, not governance state — the
 * decision this file requested is already fully recorded by the mutations
 * above (or, for a rejection, by the settlement receipt alone) — so nothing
 * here is a judgment call, and it fires for both `accepted` and `rejected`.
 *
 * Only acts when `sourcePath` resolves to a direct child of this Project
 * repository's own `.arcadia/asks/` directory, so an Ask previewed from
 * somewhere else entirely (e.g. a recovered file inspected from `/tmp`, per
 * the isolate-agent-asks recovery flow) is never touched. A missing or
 * already-archived source file is a silent no-op, not an error, so retried
 * or manually-cleaned-up settlements stay idempotent.
 */
/** Returns the archived source file's path relative to `repoRoot`, or null when
 * nothing was archived (no source, outside `.arcadia/asks/`, or already gone). */
function archiveSettledAskFile(fileMutations: FileMutation[], effects: string[], repoRoot: string, sourcePath: string | null): string | null {
  if (!sourcePath) return null;
  const requested = path.resolve(sourcePath);
  if (!existsSync(requested)) return null;
  const asksDir = path.join(repoRoot, ".arcadia", "asks");
  if (!existsSync(asksDir)) return null;
  // Compare directories through realpath — `repoRoot` for a candidate
  // worktree comes from `projectCheckoutFor`'s realpath'd `--show-toplevel`,
  // while `sourcePath` (e.g. from a freshly drafted file) is typically a
  // plain `path.resolve`. A symlinked path segment (common for a system's
  // temp directory) would otherwise make an identical directory compare
  // unequal and silently skip archiving. Once matched, rebuild the path from
  // `repoRoot`'s own (possibly non-realpath) spelling rather than keeping the
  // realpath'd one: every other path this settlement writes, commits, and
  // relativizes is expressed in terms of `repoRoot` as given, and mixing the
  // two spellings turns `path.relative` into a `../../..` traversal that
  // neither `git add` nor `git status` recognizes.
  if (realpathSync(path.dirname(requested)) !== realpathSync(asksDir)) return null;
  const resolved = path.join(asksDir, path.basename(requested));
  const content = readFileSync(resolved, "utf8");
  const archivePath = path.join(asksDir, "archive", path.basename(resolved));
  fileMutations.push({ path: resolved, before: content, after: null });
  fileMutations.push({ path: archivePath, before: existsSync(archivePath) ? readFileSync(archivePath, "utf8") : null, after: content });
  effects.push(`Archived the settled Ask file to ${path.relative(repoRoot, archivePath)}.`);
  return path.relative(repoRoot, resolved);
}

/**
 * The PROJECT.md + Plan pair a settlement is writing, if any. Both halves are
 * registered together by the writers that produce one, so finding only one is a
 * programming error rather than a state to guess about.
 */
function selectPointerPair(mutations: FileMutation[]): { project: FileMutation; plan: FileMutation } | null {
  const project = mutations.find((mutation) => mutation.pair === "project");
  const plan = mutations.find((mutation) => mutation.pair === "plan");
  if (!project && !plan) return null;
  if (!project || !plan || project.before === null || plan.before === null || !project.retransform || !plan.retransform) {
    throw validationError("Settlement registered an incomplete PROJECT.md + Plan pointer pair.");
  }
  return { project, plan };
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
