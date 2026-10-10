import { assertOperatorSettlementContract } from "../operatorActions/operatorExecution.js";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { agentAskFingerprint, normalizeAgentAsk, setTopLevelAskScalar, type AgentAskProposal, type NormalizedAgentAsk, type NormalizedAgentAskAction, type NormalizedAgentAskEvidence, type NormalizedAgentAskOption } from "./agentAsk.js";
import { validationError } from "../cli/errors.js";
import { writeTransaction } from "../db/connection.js";
import { createArtifactRecord, getProjectBySlug, getProjectMetadata } from "../db/repositories.js";
import { discoverDocs } from "../docs/discover.js";
import { deferringDecisionFor, isDispatchable, resolveActionReadiness, resolveDispatch } from "../docs/dispatch.js";
import { yamlScalar } from "../docs/frontmatter.js";
import { parseDoc } from "../docs/parse.js";
import { syncProjectDocs } from "../docs/sync.js";
import type { ArcadiaDoc, DecisionDoc, LogDoc, PlanActionDoc, PlanDoc, ProjectDoc } from "../docs/types.js";
import { buildAgentQueue, unpositionedEntriesForPlan, type AgentQueue } from "../dispatch/queue.js";
import { arrangeActionOrder, loadActionOrder } from "../dispatch/order.js";
import { resolvePlanActivation } from "../dispatch/planActivation.js";
import { writePointerPairWithCompareAndSet } from "../dispatch/pointer.js";
import type { GateQuestion, WorkClassification } from "../domain/constants.js";
import { assertClean, commitOnlyPaths, git, projectCheckoutFor, tryGit, untrackedDraftAskPaths } from "../git/worktrees.js";
import {
  assertActionClaimGeneration,
  getActiveWorktreeReservation,
  type ActionClaimFence
} from "../sessions/index.js";
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
/** Non-path markers that contain no whitespace but are not a repo-relative
 * path either: a URL (which has its own `/` separators) or a placeholder. */
const NON_PATH_ARTIFACT_PATTERN = /^(?:[a-z][a-z0-9+.-]*:\/\/|n\/a$|tbd(?:\/none)?$)/i;

/**
 * Whether a Plan's `expected_artifact` reads as a repo-relative path rather
 * than prose. Prose ("First proof", "Evidence satisfying Agent Ask X")
 * always contains a space; a path never does and either has a directory
 * separator or a file extension. A URL or a placeholder like `N/A` also has
 * no whitespace and may contain a `/`, so those are excluded explicitly
 * rather than mistaken for a path this repository could ever contain.
 */
function looksLikeArtifactPath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed) || NON_PATH_ARTIFACT_PATTERN.test(trimmed)) return false;
  return trimmed.includes("/") || /\.[A-Za-z0-9]+$/.test(trimmed);
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
  retransform?: (current: string, planCurrent?: string) => string;
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
  /** Exact fingerprint-bound effects for non-apply consumers; never inferred from prose. */
  review?: {
    documents: { path: string; before: string | null; after: string | null }[];
    queueBefore: string[];
    queueAfter: string[];
  };
  queueActionKey: string | null;
  queueActionKeys: string[];
  queuePosition: number | null;
  nextActionKey: string | null;
  previewFingerprint: string;
  /**
   * The Action queue revision this settlement was resolved against — the same
   * value `previewFingerprint` binds — so a caller that wants to pass
   * `--revision` can copy it instead of re-deriving it (Issue #296). Absent on
   * receipts from before this field existed.
   */
  queueRevision?: number;
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
  /**
   * The commit that recorded this settlement's managed documents, on the
   * branch it was settled from. Absent when nothing was written or the commit
   * failed, and on receipts from before this field existed.
   */
  documentsCommit?: string | null;
  /**
   * Non-fatal findings the settlement did not act on, e.g. a file at the
   * Ask's canonical draft path whose content is not this Ask (Issue #981).
   * Absent when there are none.
   */
  warnings?: string[];
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

/** One upcoming Action from the Ready lane, as shown in a settlement notification's queue preview. */
export interface AgentAskNotificationUpcomingAction {
  key: string;
  title: string | null;
}

export interface PendingAgentAskNotification {
  settlementId: string;
  /** The Ask's own id, so the notification names what was asked. */
  requestId: string | null;
  /** The Ask's `desired_result`, so a notification carries its substance — a
   * `log` Ask reporting a CI blocker is otherwise only "Appended one Project
   * Log entry". Null only when the proposal row is unreadable. */
  desiredResult: string | null;
  projectSlug: string;
  disposition: AgentAskDisposition;
  intent: string;
  effects: string[];
  queueActionKey: string | null;
  queueActionKeys: string[];
  queuePosition: number | null;
  nextActionKey: string | null;
  /**
   * The Ready lane's current front, up to 5 entries, read live at notification
   * time rather than frozen at settlement time — the queue can move between a
   * `complete` settlement and its Discord delivery. Computed for every
   * settlement (cheap, already-built queue snapshot) so `intent: "complete"`
   * notifications can show what arcadia-go will pick up next.
   */
  nextActions: AgentAskNotificationUpcomingAction[];
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
  /** Optional caller authority fence, rechecked under the workspace write interlock. */
  beforeGovernanceWrite?: (db: Database.Database) => void;
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
  const proposalRow = db.prepare(`SELECT proposal_json FROM agent_ask_proposals
    WHERE id = ? OR request_id = ?`).get(input.proposalRef, input.proposalRef) as { proposal_json: string } | undefined;
  if (!proposalRow) throw validationError("Agent Ask proposal was not found.", { proposal: input.proposalRef });
  const proposal = JSON.parse(proposalRow.proposal_json) as AgentAskProposal;
  // A proposal recorded before `omittedLists` existed cannot say which lists
  // its Ask left out, so recover that from the stored request text (Issue #1079).
  const legacyListFallback = hydrateOmittedLists(db, proposal);
  assertOperatorSettlementContract(proposal.normalized);
  const existingByRequest = db.prepare("SELECT operation_json, receipt_json FROM agent_ask_settlements WHERE request_id = ?")
    .get(input.settlementRequestId) as { operation_json: string; receipt_json: string } | undefined;
  if (existingByRequest) {
    if (existingByRequest.operation_json !== JSON.stringify(operation)) {
      throw validationError("Agent Ask settlement request id was already used for a different operation.");
    }
    return JSON.parse(existingByRequest.receipt_json) as AgentAskSettlementReceipt;
  }

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
  const controlRepoPath = path.resolve(metadata.repo_path);
  const repoRoot = projectCheckoutFor(controlRepoPath, input.cwd ?? process.cwd());
  // The Action claim this settling worktree holds, when it holds one. A
  // worktree `go` dispatched carries its Action's claim and its generation, and
  // that claim is what makes this settlement *this worktree's* settlement: a
  // completion written from here must be about the Action this worktree was
  // given, and must still hold the same generation at the moment it writes.
  //
  // Null in the main checkout and in any worktree with no live claim, where
  // settlement behaves exactly as it did before claims existed.
  const settlingReservation = getActiveWorktreeReservation(db, controlRepoPath, repoRoot);
  const settlingClaim = settlingReservation?.action_id && settlingReservation.project && settlingReservation.claim_generation
    ? {
        repositoryPath: settlingReservation.repository_path,
        project: settlingReservation.project,
        actionId: settlingReservation.action_id,
        generation: settlingReservation.claim_generation
      } satisfies ActionClaimFence
    : null;
  // Verified inside the same
  // transaction as this settlement's document writes -- never as a check before
  // it, which would leave exactly the window the generation exists to close.
  //
  // Set for *every* accepted settlement that writes, not only the two intents
  // that resolve or retarget the pointer: `outcome`, `milestone` and
  // `project_update` all write the same PROJECT.md fields through the same
  // helpers, so fencing only one of them would leave a superseded worktree free
  // to write the same state by naming a different intent.
  let claimFence: ActionClaimFence | null = null;
  const queue = buildAgentQueue(db);
  // The preview fingerprint already hashes `queue.revision`, so an apply that
  // carries one is refused below whenever the queue genuinely moved. A second,
  // hand-copied `--revision` beside it only ever added a way to fail on a
  // mistyped literal after the settlement it guards had already been
  // previewed correctly (Issue #296). It stays a guard for a preview-only
  // call, the one place it is the sole binding.
  if (input.expectedQueueRevision !== undefined && input.previewFingerprint === undefined &&
      queue.revision !== input.expectedQueueRevision) {
    throw validationError("Action queue revision changed; refresh the Agent Ask settlement preview.", {
      expectedRevision: input.expectedQueueRevision,
      actualRevision: queue.revision
    });
  }
  // Unpositioned Actions stay out of the arranged order, so an anchor among
  // them would vanish from the order it was supposed to place work beside.
  if (input.anchor && queue.ordered.some((entry) => entry.orderKey === input.anchor && entry.orderStatus === "unpositioned")) {
    throw validationError(`Queue anchor ${input.anchor} has no queue position yet; anchor on a positioned Action or use --top.`, { anchor: input.anchor });
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
  // The Candidate revision a `complete` or `split` settlement bound its
  // evidence to -- the full sha the Mission Log records. The archived Ask
  // carries the same value (Issue #321).
  let boundCandidateRevision: string | null = null;
  // The pointer a completion wrote, read back from the PROJECT.md content
  // actually written, so the receipt's next Action names what landed rather
  // than a queue snapshot that can lag it (Issue #507).
  let pointerProjectSlug: string | null = null;
  const effects: string[] = [];

  if (input.disposition === "rejected") {
    effects.push("Preserved the proposal and created no Project or queue changes.");
  } else {
    // A rejection writes nothing about the work -- it only archives the Ask
    // file -- so it is not fenced; every accepted settlement is.
    if (settlingClaim) claimFence = { ...settlingClaim };
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
          const omitted = proposal.normalized.omittedLists ?? [];
          const amendedDependencies = omitted.includes("dependencies") ? null : dependencies;
          const amendedReferences = omitted.includes("references") ? null : proposal.normalized.references;
          fileMutations.push({
            path: activePlanPath,
            before: planBefore,
            after: withPlanUpdated(amendAction(planBefore, actionId, proposal.normalized.desiredResult, proposal.normalized.acceptance,
              amendedDependencies, amendedReferences, proposal.normalized.requestId, input.responsibility, proposal.normalized.why))
          });
          effects.push(`Amended Action ${queueActionKey} in active Plan ${plan.slug}.`);
          effects.push(`Field changes for ${queueActionKey}: ${describeActionAmendment(plan.actions.find((action) => action.id === actionId)!, {
            desiredResult: proposal.normalized.desiredResult, acceptance: proposal.normalized.acceptance,
            dependencies: amendedDependencies, references: amendedReferences, why: proposal.normalized.why
          })}.`);
          if (legacyListFallback) effects.push(LEGACY_LIST_FALLBACK_EFFECT);
          if (input.responsibility) {
            effects.push(`Set Responsibility to ${input.responsibility} on the operator's explicit direction, per Decision 0045.`);
          } else {
            effects.push("Preserved the Action's existing Responsibility and queue position.");
          }
        } else {
          const proposedActions = (proposal.normalized.actions ?? []).length > 0
            ? proposal.normalized.actions
            : [{ id: null, desiredResult: proposal.normalized.desiredResult, acceptance: proposal.normalized.acceptance,
              dependencies: proposal.normalized.dependencies, references: proposal.normalized.references, targetRef: null,
              omittedLists: proposal.normalized.omittedLists ?? [],
              ...(proposal.normalized.why ? { why: proposal.normalized.why } : {}) }];
          if (proposedActions.some((action) => action.acceptance.length === 0)) {
            throw validationError("Every accepted Action requires at least one observable acceptance criterion in the proposal.");
          }
          // A child carrying its own `target_ref` amends that existing Action
          // instead of creating a duplicate with an id derived from its
          // desired_result -- matching what `plan` intent amendments already
          // do, and what this Ask's own preview reports (Issue #654).
          const existingIds = new Set(plan.actions.map((action) => action.id));
          const takenIds = new Set(existingIds);
          const actionIds = proposedActions.map((action) => (action.targetRef
            ? resolveManagedTargetRef(action.targetRef, "action", project.slug)
            : action.id
              ? claimExplicitActionId(takenIds, action.id)
              : allocateUniqueActionId(takenIds, deriveActionId(action.desiredResult))));
          const duplicateTargets = actionIds.filter((id, index) => actionIds.indexOf(id) !== index);
          if (duplicateTargets.length > 0) throw validationError("An Agent Ask cannot amend the same Action more than once.", { actions: [...new Set(duplicateTargets)] });
          const availableIds = new Set([...takenIds, ...actionIds]);
          const normalizedActions = proposedActions.map((action, index) => {
            const id = actionIds[index];
            const existing = action.targetRef !== null;
            if (existing && !existingIds.has(id)) throw validationError("Agent Ask Action amendment target was not found.", { targetRef: action.targetRef });
            const dependencies = normalizeDependencies(action.dependencies, project.slug);
            const unknownDependencies = dependencies.filter((dependency) => !availableIds.has(dependency));
            if (unknownDependencies.length > 0) {
              throw validationError("Agent Ask names dependencies outside the active Plan or proposed Action bundle.", {
                action: id, dependencies: unknownDependencies
              });
            }
            // An omitted list keeps the Action's existing edges, which the
            // cycle check below must still see.
            const effectiveDependencies = existing && (action.omittedLists ?? []).includes("dependencies")
              ? plan.actions.find((candidate) => candidate.id === id)!.dependsOn
              : dependencies;
            return { ...action, id, existing, dependencies, effectiveDependencies };
          });
          const createsActions = normalizedActions.some((action) => !action.existing);
          if (createsActions && !input.responsibility) throw validationError("Accepted Action settlement requires --responsibility autonomous or agent.");
          if (!createsActions && input.responsibility) throw validationError("Action amendments preserve existing Responsibilities.");
          if (createsActions) {
            requirePlanPositioned(queue, project.slug, plan.slug, "accepting another into the queue");
            if (!input.placement) throw validationError("Accepted Action settlement requires --top, --before, or --after.");
          } else if (input.placement) {
            throw validationError("Action amendments preserve their existing queue position.");
          }
          // A cycle inside the bundle would leave every Action in it waiting on
          // another forever — permanently ineligible, with no event that could
          // ever free them. The Plan paths already refuse one; so does this.
          dependencyOrderedActionIds(normalizedActions.map((action) => ({ id: action.id, dependencies: action.effectiveDependencies })));
          assertNoDependencyCycleThrough([
            ...plan.actions.filter((action) => !actionIds.includes(action.id)).map((action) => ({ id: action.id, dependencies: action.dependsOn })),
            ...normalizedActions.map((action) => ({ id: action.id, dependencies: action.effectiveDependencies }))
          ], actionIds);
          queueActionKeys = actionIds.map((actionId) => `${project.slug}/${actionId}`);
          queueActionKey = queueActionKeys[0]!;
          actionIdsToValidate.push(...actionIds);
          let planAfter = planBefore;
          for (const action of normalizedActions) {
            if (action.existing) {
              const amendedDependencies = (action.omittedLists ?? []).includes("dependencies") ? null : action.dependencies;
              const amendedReferences = (action.omittedLists ?? []).includes("references") ? null : action.references;
              planAfter = amendAction(planAfter, action.id, action.desiredResult, action.acceptance, amendedDependencies,
                amendedReferences, proposal.normalized.requestId, undefined, action.why);
              effects.push(`Amended Action ${project.slug}/${action.id} in active Plan ${plan.slug}.`);
              effects.push(`Field changes for ${project.slug}/${action.id}: ${describeActionAmendment(plan.actions.find((candidate) => candidate.id === action.id)!, {
                desiredResult: action.desiredResult, acceptance: action.acceptance,
                dependencies: amendedDependencies, references: amendedReferences, why: action.why
              })}.`);
              if (legacyListFallback && !effects.includes(LEGACY_LIST_FALLBACK_EFFECT)) effects.push(LEGACY_LIST_FALLBACK_EFFECT);
            } else {
              planAfter = appendPlanAction(planAfter, {
                id: action.id, title: action.desiredResult, responsibility: input.responsibility!,
                acceptance: action.acceptance, dependencies: action.dependencies, references: action.references,
                source: `Agent Ask ${proposal.normalized.requestId}`,
                why: action.why
              });
              effects.push(`Created Action ${project.slug}/${action.id} in active Plan ${plan.slug} with Responsibility ${input.responsibility}.`);
            }
          }
          fileMutations.push({
            path: activePlanPath,
            before: planBefore,
            after: withPlanUpdated(planAfter)
          });
          if (createsActions) {
            arrangeQueue = true;
            queueAfter = insertQueueKeys(queueAfter, queueActionKeys, input.placement!, input.anchor);
            effects.push(`Inserted the Action${queueActionKeys.length === 1 ? "" : " bundle"} starting at queue position ${queueAfter.indexOf(queueActionKey) + 1}.`);
          } else {
            effects.push("Preserved every amended Action's existing Responsibility and queue position.");
          }
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
        } else if (targetRef === "status") {
          const before = readFileSync(projectPath, "utf8");
          fileMutations.push({ path: projectPath, before, after: replaceTopLevelField(before, "status", proposal.normalized.desiredResult) });
          effects.push(`Updated Project ${project.slug} Status to ${proposal.normalized.desiredResult}.`);
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
              supported: ["outcome", "milestone", "status"],
              remedy: "Use target_ref: outcome, milestone, or status, or choose the intent that owns the field — `action` or `plan` for Plan work, `decision` to ask the operator a question."
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
              requirePlanPositioned(queue, project.slug, target.slug, "reprioritizing it");
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
              fileMutations.push({ path: targetPath, before, after: withPlanUpdated(replaceTopLevelField(before, "milestone", proposal.normalized.desiredResult)) });
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
            // The Ask-level references apply to every child; they only count as
            // a statement about an amended child when they name something.
            const references = uniqueStrings([...proposal.normalized.references, ...action.references]);
            const omitted = action.omittedLists ?? [];
            const omitsDependencies = existing && omitted.includes("dependencies");
            return {
              ...action, id, existing, dependencies, references,
              effectiveDependencies: omitsDependencies ? target.actions.find((candidate) => candidate.id === id)!.dependsOn : dependencies,
              amendedDependencies: omitted.includes("dependencies") ? null : dependencies,
              amendedReferences: omitted.includes("references") && proposal.normalized.references.length === 0 ? null : references
            };
          });
          const createsActions = normalizedActions.some((action) => !action.existing);
          if (createsActions && !input.responsibility) throw validationError("Creating Actions in a Plan requires --responsibility autonomous or agent.");
          if (!createsActions && input.responsibility) throw validationError("Plan Action amendments preserve existing Responsibilities.");

          // Retained edges of an Action whose dependencies were omitted still
          // count: a cycle through them would strand every Action in it.
          assertNoDependencyCycleThrough([
            ...target.actions.filter((action) => !newActionIds.includes(action.id)).map((action) => ({ id: action.id, dependencies: action.dependsOn })),
            ...normalizedActions.map((action) => ({ id: action.id, dependencies: action.effectiveDependencies }))
          ], newActionIds);

          const isActivePlan = target.status === "active" && target.slug === plan.slug;
          if (!isActivePlan && input.placement) {
            throw validationError("Only the active Plan can be placed in the execution queue; draft Plans remain inactive.", { targetRef });
          }
          if (isActivePlan && createsActions && !input.placement) {
            throw validationError("Adding Actions to the active Plan requires --top, --before, or --after so no approved work is left unpositioned.");
          }
          if (input.anchor && !input.placement) throw validationError("A queue anchor requires --before or --after.");
          if (input.placement) {
            requirePlanPositioned(queue, project.slug, target.slug, "reprioritizing it");
          }

          let after = before;
          for (const action of normalizedActions) {
            if (action.existing) {
              after = amendAction(after, action.id, action.desiredResult, action.acceptance, action.amendedDependencies,
                action.amendedReferences, proposal.normalized.requestId, undefined, action.why);
              effects.push(`Amended Action ${project.slug}/${action.id} in Plan ${target.slug}.`);
              effects.push(`Field changes for ${project.slug}/${action.id}: ${describeActionAmendment(target.actions.find((candidate) => candidate.id === action.id)!, {
                desiredResult: action.desiredResult, acceptance: action.acceptance,
                dependencies: action.amendedDependencies, references: action.amendedReferences, why: action.why
              })}.`);
              if (legacyListFallback && !effects.includes(LEGACY_LIST_FALLBACK_EFFECT)) effects.push(LEGACY_LIST_FALLBACK_EFFECT);
              actionIdsToValidate.push(action.id);
            } else {
              after = appendPlanAction(after, {
                id: action.id, title: action.desiredResult, responsibility: input.responsibility!,
                acceptance: action.acceptance, dependencies: action.dependencies, references: action.references,
                source: `Agent Ask ${proposal.normalized.requestId}`,
                why: action.why
              });
              effects.push(`Created Action ${project.slug}/${action.id} in Plan ${target.slug} with Responsibility ${input.responsibility}.`);
              actionIdsToValidate.push(action.id);
            }
          }
          fileMutations.push({ path: targetPath, before, after: withPlanUpdated(after) });

          if (input.placement) {
            const changes = new Map(normalizedActions.map((action) => [action.id, action.effectiveDependencies] as const));
            const finalActions = target.actions.map((action) => ({
              id: action.id,
              dependencies: changes.get(action.id) ?? action.dependsOn,
              status: action.status
            }));
            for (const action of normalizedActions.filter((candidate) => !candidate.existing)) {
              finalActions.push({ id: action.id, dependencies: action.effectiveDependencies, status: "open" });
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
        // A claimed worktree may only complete the Action it was dispatched to.
        // Completing a different one would mark work done from a checkout that
        // was never given it.
        if (settlingClaim && settlingClaim.actionId !== actionId) {
          throw validationError(
            "This worktree's Action claim does not name the Action this settlement completes.",
            {
              claimedActionId: settlingClaim.actionId,
              completingActionId: actionId,
              worktreePath: repoRoot,
              remedy: `Settle ${settlingClaim.actionId}'s completion from this worktree, or complete ${actionId} from the worktree that claims it.`
            }
          );
        }
        // Completion does not release the claim (Issue #538). A claimed
        // worktree is always a candidate, so this completion lands on the
        // candidate branch while the base checkout's pointer still names the
        // Action until the pull request merges. Releasing here let the next
        // `arcadia go` read that pointer, find no claim, and dispatch the same
        // Action to a second worktree. The claim now ends when the candidate is
        // retired or its TTL lapses. The TTL can lapse before the candidate
        // merges; that is a separate gap, tracked as Issue #549.
        const head = git(repoRoot, ["rev-parse", "HEAD"]).trim();
        const candidateRevision = proposal.normalized.candidateRevision!;
        if (head !== candidateRevision && !head.startsWith(candidateRevision)) {
          throw validationError(
            `Completion Candidate revision ${candidateRevision} does not match ${repoRoot}'s current HEAD ${head}.`,
            { expectedHead: head, receivedRevision: candidateRevision, repoRoot }
          );
        }
        boundCandidateRevision = head;
        // `expected_artifact` is free text in most Plans ("First proof",
        // "Evidence satisfying Agent Ask X") but a real repo-relative path in
        // others (session-reconciliation's `docs/contract.md`). Only the path
        // shape is checkable, so only that shape is checked: prose never
        // refuses a completion it was never meant to gate.
        if (action.expectedArtifact && looksLikeArtifactPath(action.expectedArtifact)) {
          const resolvedArtifact = path.resolve(repoRoot, action.expectedArtifact);
          const withinRepo = resolvedArtifact === repoRoot || resolvedArtifact.startsWith(`${repoRoot}${path.sep}`);
          if (withinRepo && !existsSync(resolvedArtifact)) {
            throw validationError("Completion refused: the declared expected Artifact was not produced.", {
              actionId, expectedArtifact: action.expectedArtifact, resolvedPath: resolvedArtifact
            });
          }
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
        // Only the active Plan carries a `current_action` (docs/managed-documents.md:
        // "omit unless this is the active plan"), so completing an Action in any
        // other Plan records its progress and leaves that Plan's pointer field
        // exactly as it was (Issue #1061).
        const planTransform = (current: string): string => setTopLevelFields(markActionDone(current, actionId, proposal.normalized.requestId),
          planComplete
            ? { status: "complete", current_action: null, updated }
            : completingActivePlan ? { current_action: nextResolution.actionId, updated } : { updated });
        const projectTransform = (current: string): string => setTopLevelFields(current,
          activatedNext
            ? { active_plan: activatedNext.planSlug, current_action: activatedNext.actionId, updated }
            : { current_action: planComplete ? null : nextResolution.actionId, updated });
        effects.push(`Marked Action ${project.slug}/${actionId} done with accepted evidence for all ${declared.length} criteria.`);
        if (activatedNext) {
          effects.push(`Plan ${targetPlan.slug} is complete; activated Plan ${activatedNext.planSlug} from the explicit queue at ${activatedNext.actionKey}.`);
        } else if (planComplete) {
          effects.push(`Plan ${targetPlan.slug} is complete; every Action is done.${completingActivePlan ? " Select a new active Plan when ready." : ""}`);
        } else if (completingActivePlan) {
          effects.push(`${nextResolution.note} Pointer: ${project.slug}/${nextResolution.actionId}.`);
        } else {
          effects.push(`Next ready Action in this inactive Plan: ${project.slug}/${nextResolution.actionId}. No pointer written; ${targetPlan.slug} is not the active Plan.`);
        }
        if (completingActivePlan) {
          pointerProjectSlug = project.slug;
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
            : nextResolution.kind === "planComplete" ? "Plan complete; every Action is done."
              : completingActivePlan ? nextResolution.note : `Next ready Action in this inactive Plan: ${nextResolution.actionId}.`
        });
        fileMutations.push({ path: completionLogPath, before: completionLogBefore, after: appendCompletion(completionLogBefore), reappend: appendCompletion });
        completionActionId = actionId;
        completionPlanSlug = targetPlan.slug;
        break;
      }
      case "split": {
        requireNoQueueOptions(input);
        if (!targetRef) throw validationError("Agent Ask split requires target_ref naming the Action to narrow.");
        const scoped = splitPlanScopedActionRef(targetRef);
        const targetPlan = scoped
          ? discovered.docs.find((doc): doc is PlanDoc => doc.type === "plan" && doc.project === project.slug
            && doc.slug === resolveManagedTargetRef(scoped.planRef, "plan", project.slug))
          : plan;
        if (!targetPlan) throw validationError("Agent Ask split names a Plan that was not found in this Project.", { targetRef });
        const completingActivePlan = targetPlan.slug === plan.slug;
        const targetPlanPath = path.join(repoRoot, targetPlan.relativePath);
        const planBefore = readFileSync(targetPlanPath, "utf8");
        const projectBefore = readFileSync(projectPath, "utf8");
        const actionId = resolveManagedTargetRef(scoped?.actionRef ?? targetRef, "action", project.slug);
        const action = targetPlan.actions.find((candidate) => candidate.id === actionId);
        if (!action) throw validationError("Agent Ask split target Action was not found.", { targetRef });
        const plansHoldingActionId = discovered.docs.filter((doc): doc is PlanDoc =>
          doc.type === "plan" && doc.project === project.slug && doc.actions.some((candidate) => candidate.id === actionId));
        if (plansHoldingActionId.length !== 1) {
          throw validationError("Agent Ask split target Action id is not unique across this Project's Plans.", {
            actionId, plans: plansHoldingActionId.map((doc) => doc.slug)
          });
        }
        if (action.status === "done") throw validationError("Action is already done.", { actionId });
        if (action.responsibility !== "agent" && action.responsibility !== "autonomous") {
          throw validationError("Only an agent or autonomous Action can be split through this routine.", {
            actionId, responsibility: action.responsibility
          });
        }
        // A claimed worktree may only split the Action it was dispatched to,
        // the same fence `complete` applies (Issue #538's reasoning holds here
        // too: completion does not release the claim).
        if (settlingClaim && settlingClaim.actionId !== actionId) {
          throw validationError(
            "This worktree's Action claim does not name the Action this settlement splits.",
            {
              claimedActionId: settlingClaim.actionId,
              splittingActionId: actionId,
              worktreePath: repoRoot,
              remedy: `Settle ${settlingClaim.actionId}'s split from this worktree, or split ${actionId} from the worktree that claims it.`
            }
          );
        }
        const head = git(repoRoot, ["rev-parse", "HEAD"]).trim();
        const candidateRevision = proposal.normalized.candidateRevision!;
        if (head !== candidateRevision && !head.startsWith(candidateRevision)) {
          throw validationError(
            `Split Candidate revision ${candidateRevision} does not match ${repoRoot}'s current HEAD ${head}.`,
            { expectedHead: head, receivedRevision: candidateRevision, repoRoot }
          );
        }
        boundCandidateRevision = head;
        const declared = action.acceptanceCriteria;
        if (declared.length === 0) throw validationError("Action declares no acceptance criteria to bind a split to.", { actionId });
        const narrowed = proposal.normalized.acceptance;
        // The finished slice must be a real, order-preserving subset of what
        // the Action already declared -- never reworded, reordered, or padded
        // with criteria it never declared. A full match leaves nothing to
        // split off; that is `complete`, not `split`.
        const declaredIndexOf = new Map(declared.map((criterion, index) => [criterion, index]));
        let cursor = -1;
        for (const criterion of narrowed) {
          const index = declaredIndexOf.get(criterion);
          if (index === undefined) {
            throw validationError("Split acceptance must be drawn verbatim from the Action's declared acceptance criteria.", { actionId, criterion, declared });
          }
          if (index <= cursor) {
            throw validationError("Split acceptance must preserve the declared criteria's order with no repeats.", { actionId, criterion, declared });
          }
          cursor = index;
        }
        if (narrowed.length >= declared.length) {
          throw validationError("Split acceptance must be a strict subset of the declared criteria; a full match is a complete, not a split.", { actionId, declared, narrowed });
        }
        const evidence = proposal.normalized.evidence;
        if (evidence.length !== narrowed.length || evidence.some((entry, index) => entry.criterion !== narrowed[index])) {
          throw validationError("Split evidence must cover every narrowed acceptance criterion, verbatim and in order.", {
            narrowed, provided: evidence.map((entry) => entry.criterion)
          });
        }
        const unmet = evidence.filter((entry) => entry.status !== "met");
        if (unmet.length > 0) {
          throw validationError("Split refused: not every narrowed acceptance criterion is met.", {
            unmet: unmet.map((entry) => ({ criterion: entry.criterion, status: entry.status, note: entry.note }))
          });
        }
        const readiness = resolveActionReadiness(repoRoot, project.slug, actionId);
        const unresolvedDecisions = readiness.requiredDecisions.filter((decision) => !decision.resolved);
        if (unresolvedDecisions.length > 0) {
          throw validationError("Split refused: Action has unresolved required review Decisions.", {
            unresolvedDecisions: unresolvedDecisions.map((decision) => decision.id)
          });
        }
        // Every criterion the finished slice does not cover must reappear,
        // verbatim, in some remainder Action -- so a split can narrow an
        // Action's scope but never quietly drop part of what the operator
        // asked for (Truth: "Uncertainty stays visible").
        const remainder = declared.filter((criterion) => !narrowed.includes(criterion));
        const proposedActions = proposal.normalized.actions;
        const coveredRemainder = new Set(proposedActions.flatMap((remainderAction) => remainderAction.acceptance));
        const uncovered = remainder.filter((criterion) => !coveredRemainder.has(criterion));
        if (uncovered.length > 0) {
          throw validationError("Split refused: every criterion left off the finished slice must reappear verbatim in a remainder Action.", {
            actionId, uncovered
          });
        }
        if (proposedActions.some((remainderAction) => remainderAction.acceptance.length === 0)) {
          throw validationError("Every remainder Action requires at least one observable acceptance criterion.");
        }
        // Placing the remainder in the queue needs it on the base branch, the
        // same constraint `action` intent's queue placement enforces; the
        // generic `arrangeQueue` guard below refuses this from a candidate
        // worktree before anything is written.
        requirePlanPositioned(queue, project.slug, targetPlan.slug, "queuing its remainder Actions");
        // The queue key is `${project.slug}/${id}` with no Plan segment, so an
        // id must be unique across every Plan in the Project, not only the
        // target Plan -- otherwise a remainder id could collide with another
        // Plan's Action and queue selection or readiness lookup could resolve
        // the wrong one.
        const takenIds = new Set(discovered.docs
          .filter((doc): doc is PlanDoc => doc.type === "plan" && doc.project === project.slug)
          .flatMap((doc) => doc.actions.map((candidate) => candidate.id)));
        const remainderIds = proposedActions.map((remainderAction) => (remainderAction.id
          ? claimExplicitActionId(takenIds, remainderAction.id)
          : allocateUniqueActionId(takenIds, deriveActionId(remainderAction.desiredResult))));
        const availableIds = new Set([...takenIds, ...remainderIds]);
        const normalizedRemainder = proposedActions.map((remainderAction, index) => {
          const dependencies = normalizeDependencies(remainderAction.dependencies, project.slug);
          const unknownDependencies = dependencies.filter((dependency) => !availableIds.has(dependency));
          if (unknownDependencies.length > 0) {
            throw validationError("Agent Ask names dependencies outside the active Plan or proposed remainder bundle.", {
              action: remainderIds[index], dependencies: unknownDependencies
            });
          }
          return { ...remainderAction, id: remainderIds[index], dependencies };
        });
        dependencyOrderedActionIds(normalizedRemainder.map((remainderAction) => ({ id: remainderAction.id, dependencies: remainderAction.dependencies })));

        const remainderActionKeys = remainderIds.map((id) => `${project.slug}/${id}`);
        const targetActionKey = `${project.slug}/${actionId}`;
        queueAfter = insertQueueKeys(queueAfter, remainderActionKeys, "after", targetActionKey)
          // The narrowed Action is done once this settlement applies, so it
          // drops out of the active order the same way `complete` lets it drop
          // out by never touching the queue at all; arranging with it still
          // present would ask the order table to place a done Action.
          .filter((key) => key !== targetActionKey);
        arrangeQueue = true;
        queueActionKeys = remainderActionKeys;
        queueActionKey = remainderActionKeys[0]!;
        actionIdsToValidate.push(...remainderIds);

        // A split narrows and completes `actionId`, but anything that named it
        // in `depends_on` was waiting on the WHOLE declared scope, not just the
        // finished slice. Gaining the remainder ids too keeps such a dependent
        // blocked until the remainder is done as well -- both here, so the
        // pointer resolver below sees it, and in the written Plan, so every
        // later reader (dispatch's dependency walk, `arcadia advance`) does.
        const dependentIds = targetPlan.actions
          .filter((candidate) => candidate.id !== actionId && candidate.dependsOn.includes(actionId))
          .map((candidate) => candidate.id);

        // Cycle safety for the reverse edges added below: a dependent (or,
        // through a chain of existing dependents, some other already-declared
        // Action) may already be a prerequisite of a remainder, and a remainder
        // is free to declare a dependency on the target it is being added onto
        // -- both close a same-Plan cycle if the edge is added anyway. Built
        // from the actions this settlement is about to write plus every
        // remainder's own declared dependencies, so the check sees a path
        // through an existing Action, not only through other remainders.
        const cycleGraph = new Map<string, string[]>(targetPlan.actions.map((candidate) => [candidate.id, candidate.dependsOn]));
        for (const remainderAction of normalizedRemainder) cycleGraph.set(remainderAction.id, remainderAction.dependencies);
        const reachabilityCache = new Map<string, Set<string>>();
        const reachableFrom = (start: string): Set<string> => {
          const cached = reachabilityCache.get(start);
          if (cached) return cached;
          const seen = new Set<string>();
          const stack = [start];
          while (stack.length > 0) {
            const current = stack.pop()!;
            if (seen.has(current)) continue;
            seen.add(current);
            for (const dependency of cycleGraph.get(current) ?? []) stack.push(dependency);
          }
          reachabilityCache.set(start, seen);
          return seen;
        };
        const safeRemainderIdsFor = (targetId: string): string[] =>
          remainderIds.filter((id) => !reachableFrom(id).has(targetId));
        const withRemainderAdded = (dependencies: string[], safeIds: string[]): string[] =>
          [...dependencies, ...safeIds.filter((id) => !dependencies.includes(id))];

        // Resolve the next pointer exactly as `complete` does (Decision 0048's
        // total resolver), as though the narrowed slice were already done and
        // its remainder Actions already existed in the Plan.
        const syntheticBundle: QueueableActionBundle = {
          actions: [
            ...targetPlan.actions.map((candidate) =>
              dependentIds.includes(candidate.id)
                ? { ...candidate, dependsOn: withRemainderAdded(candidate.dependsOn, safeRemainderIdsFor(candidate.id)) }
                : candidate
            ),
            ...normalizedRemainder.map((remainderAction) => ({
              id: remainderAction.id, status: "open" as const, dependsOn: remainderAction.dependencies,
              decisions: [], clarification: "clarified" as const, responsibility: action.responsibility
            }))
          ]
        };
        const decisionDocsForPlan = discovered.docs.filter((doc): doc is DecisionDoc => doc.type === "decision" && doc.project === project.slug);
        const nextResolution = selectNextAfterCompletion(syntheticBundle, actionId, decisionDocsForPlan, queueAfter, project.slug);
        // The preview-time resolution above only feeds the effect note. What is
        // WRITTEN is re-resolved from the Plan content each compare-and-set
        // retry actually read, so a concurrent edit to the dependent set or to
        // Action statuses cannot leave the pointer chosen from a stale snapshot.
        const resolveNextFromPlan = (planContent: string): NextAfterCompletion => {
          const freshPlan = parseFreshPlanDoc(planContent, targetPlan.relativePath, targetPlanPath, actionId);
          const freshDependents = freshPlan.actions
            .filter((candidate) => candidate.id !== actionId && candidate.dependsOn.includes(actionId))
            .map((candidate) => candidate.id);
          const freshGraph = new Map<string, string[]>(freshPlan.actions.map((candidate) => [candidate.id, candidate.dependsOn]));
          for (const remainderAction of normalizedRemainder) freshGraph.set(remainderAction.id, remainderAction.dependencies);
          const reaches = (start: string, goal: string): boolean => {
            const seen = new Set<string>();
            const stack = [start];
            while (stack.length > 0) {
              const current = stack.pop()!;
              if (current === goal) return true;
              if (seen.has(current)) continue;
              seen.add(current);
              for (const dependency of freshGraph.get(current) ?? []) stack.push(dependency);
            }
            return false;
          };
          const freshBundle: QueueableActionBundle = {
            actions: [
              ...freshPlan.actions.map((candidate) => {
                if (!freshDependents.includes(candidate.id)) return candidate;
                const safeIds = remainderIds.filter((id) => !reaches(id, candidate.id));
                return { ...candidate, dependsOn: [...candidate.dependsOn, ...safeIds.filter((id) => !candidate.dependsOn.includes(id))] };
              }),
              ...normalizedRemainder.map((remainderAction) => ({
                id: remainderAction.id, status: "open" as const, dependsOn: remainderAction.dependencies,
                decisions: [], clarification: "clarified" as const, responsibility: action.responsibility
              }))
            ]
          };
          return selectNextAfterCompletion(freshBundle, actionId, decisionDocsForPlan, queueAfter, project.slug);
        };
        const updated = today();
        const narrowedTitle = proposal.normalized.desiredResult;
        const planTransform = (current: string): string => {
          // Re-parse `current` -- the content this compare-and-set retry
          // actually read, not the preview-time snapshot -- so a concurrent
          // edit to some other Action's `depends_on` (this settling worktree
          // is not the only writer) is seen and preserved rather than
          // silently dropped by writing back a stale list.
          const freshPlan = parseFreshPlanDoc(current, targetPlan.relativePath, targetPlanPath, actionId);
          const freshAction = freshPlan.actions.find((candidate) => candidate.id === actionId)!;
          const freshDependentIds = freshPlan.actions
            .filter((candidate) => candidate.id !== actionId && candidate.dependsOn.includes(actionId))
            .map((candidate) => candidate.id);

          // The cycle-safety check for the reverse edges added below must see
          // the graph this retry is actually about to write, not the
          // preview-time snapshot captured before `planTransform` ever ran.
          // A concurrent settlement can change some other Action's
          // `depends_on` between preview and this retry such that a
          // fresh-only path (remainder -> X -> dependent) now exists; the
          // stale preview-time graph would miss it and write a cycle that
          // the real parser then rejects. Built fresh on every retry from
          // `freshPlan.actions`, which `parseFreshPlanDoc` just re-parsed.
          const freshCycleGraph = new Map<string, string[]>(freshPlan.actions.map((candidate) => [candidate.id, candidate.dependsOn]));
          for (const remainderAction of normalizedRemainder) freshCycleGraph.set(remainderAction.id, remainderAction.dependencies);
          const freshReachabilityCache = new Map<string, Set<string>>();
          const freshReachableFrom = (start: string): Set<string> => {
            const cached = freshReachabilityCache.get(start);
            if (cached) return cached;
            const seen = new Set<string>();
            const stack = [start];
            while (stack.length > 0) {
              const current = stack.pop()!;
              if (seen.has(current)) continue;
              seen.add(current);
              for (const dependency of freshCycleGraph.get(current) ?? []) stack.push(dependency);
            }
            freshReachabilityCache.set(start, seen);
            return seen;
          };
          const freshSafeRemainderIdsFor = (targetId: string): string[] =>
            remainderIds.filter((id) => !freshReachableFrom(id).has(targetId));

          let next = amendAction(current, actionId, narrowedTitle, narrowed, freshAction.dependsOn, action.references, proposal.normalized.requestId);
          next = markActionDone(next, actionId, proposal.normalized.requestId);
          for (const remainderAction of normalizedRemainder) {
            next = appendPlanAction(next, {
              id: remainderAction.id, title: remainderAction.desiredResult, responsibility: action.responsibility,
              acceptance: remainderAction.acceptance, dependencies: remainderAction.dependencies, references: remainderAction.references,
              source: `Agent Ask ${proposal.normalized.requestId}`,
              why: remainderAction.why
            });
          }
          // The narrowed Action's own `split_into` names the remainder for any
          // reader that must treat its scope as truly finished only once the
          // remainder is too -- the concurrency gate (`src/production/policy.ts`)
          // is the first such reader. A dedicated field rather than a reverse
          // `depends_on` edge, because it is always safe to add: nothing else
          // ever writes it, so it can never itself close a cycle, even when a
          // remainder legitimately depends on the Action it was split from.
          next = recordSplitInto(next, actionId, remainderIds);
          for (const dependentId of freshDependentIds) {
            const freshDependent = freshPlan.actions.find((candidate) => candidate.id === dependentId)!;
            next = setActionDependsOn(next, dependentId, withRemainderAdded(freshDependent.dependsOn, freshSafeRemainderIdsFor(dependentId)));
          }
          // A non-active Plan carries no `current_action` (Issue #1061).
          return setTopLevelFields(next, completingActivePlan ? { current_action: resolveNextFromPlan(current).actionId, updated } : { updated });
        };
        const projectTransform = (current: string, planCurrent: string = planBefore): string =>
          setTopLevelFields(current, { current_action: resolveNextFromPlan(planCurrent).actionId, updated });

        effects.push(`Narrowed Action ${targetActionKey} to ${narrowed.length} of ${declared.length} declared criteria and marked it done with accepted evidence.`);
        effects.push(`Created ${remainderIds.length} remainder Action${remainderIds.length === 1 ? "" : "s"} for the unfinished criteria: ${remainderActionKeys.join(", ")}.`);
        effects.push(`Queued the remainder immediately after ${targetActionKey}, starting at position ${queueAfter.indexOf(queueActionKey) + 1}.`);
        if (dependentIds.length > 0) {
          effects.push(`Rewired ${dependentIds.length} dependent Action${dependentIds.length === 1 ? "" : "s"} in ${targetPlan.slug} to also depend on the remainder: ${dependentIds.join(", ")}.`);
        }
        effects.push(completingActivePlan
          ? `${nextResolution.note} Pointer: ${project.slug}/${nextResolution.actionId}.`
          : `Next ready Action in this inactive Plan: ${project.slug}/${nextResolution.actionId}. No pointer written; ${targetPlan.slug} is not the active Plan.`);

        if (completingActivePlan) {
          pointerProjectSlug = project.slug;
          fileMutations.push(
            { path: targetPlanPath, before: planBefore, after: planTransform(planBefore), retransform: planTransform, pair: "plan" },
            { path: projectPath, before: projectBefore, after: projectTransform(projectBefore, planBefore), retransform: projectTransform, pair: "project" }
          );
        } else {
          fileMutations.push({ path: targetPlanPath, before: planBefore, after: planTransform(planBefore), retransform: planTransform });
          effects.push(`Left Project pointer ${project.slug}/${projectDoc.currentAction ?? "none"} and the active Plan ${plan.slug} untouched; ${targetPlan.slug} is not the active Plan.`);
        }

        const splitLog = discovered.docs.find((doc): doc is LogDoc => doc.type === "log" && doc.project === project.slug);
        const splitLogPath = path.join(repoRoot, splitLog?.relativePath ?? "MISSION_LOG.md");
        const splitLogBefore = existsSync(splitLogPath) ? readFileSync(splitLogPath, "utf8") : null;
        const appendSplit = (current: string | null): string => appendCompletionLog(current, project.slug, {
          actionId, candidateRevision: head, evidence, requestId: proposal.normalized.requestId,
          note: `Split: narrowed to the finished slice and queued ${remainderActionKeys.join(", ")} immediately after. ${nextResolution.note}`
        });
        fileMutations.push({ path: splitLogPath, before: splitLogBefore, after: appendSplit(splitLogBefore), reappend: appendSplit });
        completionActionId = actionId;
        completionPlanSlug = targetPlan.slug;
        break;
      }
      case "decision": {
        requireNoQueueOptions(input);
        const gateQuestion = resolveDecisionGateQuestion(proposal.normalized);
        addDecisionMutation(fileMutations, discovered.docs.filter((doc): doc is DecisionDoc => doc.type === "decision"), repoRoot,
          project.slug, plan.slug, null, proposal.normalized.desiredResult, proposal.normalized.rationale, proposal.normalized.requestId,
          proposal.normalized.options, gateQuestion);
        effects.push(`Created one open Decision (gate: ${gateQuestion}); agent input did not answer it.`);
        break;
      }
      case "auto": {
        requireNoQueueOptions(input);
        // Arcadia could not determine the requested structure at all, which is
        // itself a case a reasonable person could resolve differently — the
        // gate always fires here, so this intent carries no triage.
        const resolvedEffect = proposal.effects[0];
        const resolvedLabel = resolvedEffect && resolvedEffect.targetKind !== "interpretation"
          ? (resolvedEffect.fields.resolvedLabel as string | undefined) ?? null
          : null;
        if (resolvedEffect && resolvedLabel && resolvedEffect.targetRef) {
          // The natural text named an identifier that already resolves against
          // a checked-in Plan, Action, or Decision (`resolveNaturalAgentAskTarget`
          // in `../ask/agentAsk.js`). Nothing is applied automatically — this
          // still opens a Decision, per the Constitution's approval boundary —
          // but the question names the concrete resolved target instead of
          // asking the operator to interpret the raw request from scratch.
          const scopedAction = resolvedEffect.targetKind === "action" ? splitPlanScopedActionRef(resolvedEffect.targetRef) : null;
          const decisionDocs = discovered.docs.filter((doc): doc is DecisionDoc => doc.type === "decision");
          const targetDecisionDoc = resolvedEffect.targetKind === "decision"
            ? decisionDocs.find((doc) => doc.project === project.slug && doc.id === resolvedEffect.targetRef)
            : undefined;
          const decisionPlanSlug = resolvedEffect.targetKind === "plan"
            ? resolveManagedTargetRef(resolvedEffect.targetRef, "plan", project.slug)
            : scopedAction
              ? resolveManagedTargetRef(scopedAction.planRef, "plan", project.slug)
              // A resolved Decision reference keeps its own Plan (it may not be
              // the active one); an unscoped Decision falls back to the active
              // Plan, same as the generic interpretation path always has.
              : (targetDecisionDoc?.plan ?? plan.slug);
          addDecisionMutation(fileMutations, decisionDocs, repoRoot,
            project.slug, decisionPlanSlug, scopedAction?.actionRef ?? null,
            `Confirm the proposed effect against ${resolvedLabel}: ${proposal.normalized.desiredResult}`,
            proposal.normalized.rationale, proposal.normalized.requestId, [], "reasonable_disagreement");
          effects.push(`Created one focused Decision naming ${resolvedLabel} as the resolved target; agent input did not answer it.`);
        } else {
          addDecisionMutation(fileMutations, discovered.docs.filter((doc): doc is DecisionDoc => doc.type === "decision"), repoRoot,
            project.slug, plan.slug, null, `How should Arcadia structure this request: ${proposal.normalized.desiredResult}`, proposal.normalized.rationale, proposal.normalized.requestId,
            [], "reasonable_disagreement");
          effects.push("Created one open interpretation Decision; no Project structure was guessed.");
        }
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

  const settlementWarnings: string[] = [];
  const archivedSource = archiveSettledAskFile(fileMutations, effects, repoRoot, proposal.sourcePath ?? null, boundCandidateRevision);
  // Also check the canonical draft name when the recorded source was some
  // other file, so an identical drafted copy cannot stay behind untracked.
  // Compared case-insensitively: on a case-insensitive filesystem a
  // differently cased source is the same file and must not move twice.
  const canonicalDraft = path.join(".arcadia", "asks", `agent-ask-${proposal.normalized.requestId}.yaml`);
  if (archivedSource === null || archivedSource.toLowerCase() !== canonicalDraft.toLowerCase()) {
    archiveCanonicalDraftAskFile(fileMutations, effects, settlementWarnings, repoRoot, proposal, boundCandidateRevision);
  }

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
      receivedPreviewFingerprint: input.previewFingerprint ?? null,
      remedy: `Run the same settle command without --apply to get a fresh preview fingerprint, then rerun it with the identical flags plus: --apply --preview ${previewFingerprint}`
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
    nextActionKey: queue.nextActionKey,
    previewFingerprint,
    queueRevision: queue.revision,
    applied: input.apply === true,
    authority: {
      kind: proposal.normalized.intent === "complete" && !input.operator
        ? "deterministic_proof"
        : "operator_acceptance",
      requestedAuthority: proposal.normalized.requestedAuthority,
      boundedPolicyDecision: null
    },
    notificationStatus: input.apply ? "pending" : "withheld_until_apply",
    createdAt: now,
    ...(settlementWarnings.length > 0 ? { warnings: settlementWarnings } : {})
  };
  if (!input.apply) return {
    ...baseReceipt,
    review: {
      documents: fileMutations.map(({ path: filePath, before, after }) => ({ path: path.relative(repoRoot, filePath), before, after })),
      queueBefore: queue.ordered.flatMap((entry) => entry.orderKey ? [entry.orderKey] : []),
      queueAfter
    }
  };

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

  // Undefined until a completion's pointer write lands; then the pointer that
  // write actually left in PROJECT.md, or null when it left none.
  let writtenNextActionKey: string | null | undefined;
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
      // First inside the transaction, before anything is written: a settlement
      // whose claim has been superseded writes nothing at all.
      if (claimFence) assertActionClaimGeneration(db, claimFence);
      input.beforeGovernanceWrite?.(db);
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
        if (pointerProjectSlug) {
          const written = frontmatterScalar(receipt.projectAfter, "current_action");
          writtenNextActionKey = written ? `${pointerProjectSlug}/${written}` : null;
        }
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
    else baseReceipt.documentsCommit = tryGit(repoRoot, ["rev-parse", "HEAD"])?.trim() ?? null;
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
        // Arranging rewrites every position, so an Action that was unpositioned
        // before this settlement — in another Plan or Project — would otherwise
        // be ranked without anyone choosing its place. Leave it unpositioned.
        const previouslyUnpositioned = new Set(queue.ordered.flatMap((entry) =>
          entry.orderStatus === "unpositioned" && entry.orderKey ? [entry.orderKey] : []));
        const arranged = (key: string): boolean => !previouslyUnpositioned.has(key) || queueActionKeys.includes(key);
        const currentKeys = buildAgentQueue(db).ordered.flatMap((entry) => entry.orderKey ? [entry.orderKey] : []).filter(arranged);
        arrangeActionOrder(db, {
          currentKeys,
          order: queueAfter.filter(arranged),
          requestId: `agent-ask:${input.settlementRequestId}`,
          expectedRevision: queue.revision,
          apply: true
        });
      }
      // A completion's next Action is the pointer it wrote. The global queue's
      // front can name something else entirely: a settlement from a candidate
      // worktree leaves the base checkout's pointer on the Action it just
      // completed until the pull request merges, and a concurrent settlement
      // can move the queue between the write and this read (Issue #507).
      const nextActionKey = writtenNextActionKey !== undefined ? writtenNextActionKey : buildAgentQueue(db).nextActionKey;
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
      nextActionKey: writtenNextActionKey ?? null,
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
 * Record the settlement of a pending `complete` Agent Ask whose documents an
 * earlier `settle --apply` already committed in a candidate checkout, when
 * that process ended after its Phase 2 commit and before Phase 3 recorded the
 * receipt (the `beforeOperationalProjection` window; Issue #995). The
 * proposal then stays pending, and a pending completion gates its Action
 * (resolveProjectTransition answers `decision`) although the work and its
 * settlement are both committed.
 *
 * Nothing is trusted from the commit itself. The settlement is derived again:
 * `settleAgentAsk` previews this exact proposal (every refusal it applies:
 * evidence, required review Decisions, expected Artifact, unique Action id,
 * pointer resolution) in a temporary detached checkout of the proposal's
 * `candidate_revision`, and HEAD must be one commit on top of that revision
 * whose files are exactly the preview's documents (dates aside: the preview
 * runs on a later day than the commit may have, so only the replay's own
 * day may differ, by one consistent day) plus `.arcadia/asks/` intake files,
 * which the settlement archives and which are not compared. The evidence must also verbatim-cover
 * `acceptanceCriteria` (the Action as the caller admitted it), every entry
 * `met`. Then Phase 3 (the projection and the receipt) runs as the
 * interrupted call would have. `dryRun` stops before writing anything durable
 * (the replay checkout is registered and removed again).
 * Authority (production scope) is the caller's to check.
 */
export function recordCommittedCompletionSettlement(db: Database.Database, input: {
  proposalRef: string;
  settlementRequestId: string;
  /** Any directory inside the checkout that holds the committed settlement. */
  cwd: string;
  /** The Action's declared acceptance criteria, as the caller admitted it. */
  acceptanceCriteria: string[];
  dryRun?: boolean;
}): AgentAskSettlementReceipt {
  const proposalRow = db.prepare("SELECT proposal_json FROM agent_ask_proposals WHERE id = ? OR request_id = ?")
    .get(input.proposalRef, input.proposalRef) as { proposal_json: string } | undefined;
  if (!proposalRow) throw validationError("Agent Ask proposal was not found.", { proposal: input.proposalRef });
  const proposal = JSON.parse(proposalRow.proposal_json) as AgentAskProposal;
  const normalized = proposal.normalized;
  if (normalized.intent !== "complete" || !normalized.targetRef || !normalized.candidateRevision) {
    throw validationError("Only a complete Agent Ask with a target and a Candidate revision has a committed completion settlement to record.");
  }
  if (db.prepare("SELECT 1 FROM agent_ask_settlements WHERE proposal_id = ? OR request_id = ?").get(proposal.id, input.settlementRequestId)) {
    throw validationError("Agent Ask proposal is already settled, or the settlement request id was already used.");
  }
  const declared = input.acceptanceCriteria;
  if (declared.length === 0 || normalized.evidence.length !== declared.length
    || normalized.evidence.some((entry, index) => entry.criterion !== declared[index] || entry.status !== "met")) {
    throw validationError("Completion evidence does not verbatim-cover every declared acceptance criterion with every entry met.");
  }
  const project = getProjectBySlug(db, normalized.project);
  const metadata = project ? getProjectMetadata(db, project.id) : null;
  if (!project || !metadata?.repo_path) throw validationError("Agent Ask Project repository is not configured.");
  const controlRepoPath = path.resolve(metadata.repo_path);
  const repoRoot = projectCheckoutFor(controlRepoPath, input.cwd);
  if (repoRoot === controlRepoPath) throw validationError("A committed completion settlement is recorded only from a candidate worktree.", { cwd: input.cwd });

  if ((tryGit(repoRoot, ["status", "--porcelain", "--untracked-files=all"]) ?? "x").trim()) {
    throw validationError("The checkout holding the committed settlement is missing or not clean.", { repoRoot });
  }
  const [head, ...parents] = git(repoRoot, ["rev-list", "--parents", "-n", "1", "HEAD"]).trim().split(/\s+/);
  const bound = tryGit(repoRoot, ["rev-parse", "--verify", "--quiet", `${normalized.candidateRevision}^{commit}`])?.trim();
  if (parents.length !== 1 || !bound || parents[0] !== bound) {
    throw validationError("HEAD is not a single settlement commit on top of the Ask's Candidate revision.", { head, candidateRevision: normalized.candidateRevision });
  }

  // Derive the settlement again at `bound`, in a throwaway detached checkout
  // (hooks off), and compare it with what HEAD actually committed.
  const scratch = mkdtempSync(path.join(tmpdir(), "arcadia-settlement-replay-"));
  const checkout = path.join(scratch, "checkout");
  let expected: Map<string, string | null>;
  let preview: AgentAskSettlementReceipt;
  // The day the replay writes into `updated:` and the Log heading; the commit
  // may carry an earlier day there, and only there.
  const replayDay = today();
  try {
    git(repoRoot, ["-c", "core.hooksPath=/dev/null", "worktree", "add", "--detach", "--quiet", checkout, bound]);
    // No worktree reservation covers this checkout, so the claim fence does
    // not apply here; both callers only pass proposals for the Session's own
    // Action, which the dead Session's claim already named.
    preview = settleAgentAsk(db, { proposalRef: proposal.id, settlementRequestId: input.settlementRequestId, disposition: "accepted", cwd: checkout });
    expected = new Map((preview.review?.documents ?? []).map((document) => [document.path, document.after]));
  } finally {
    tryGit(repoRoot, ["worktree", "remove", "--force", checkout]);
    rmSync(scratch, { recursive: true, force: true });
  }
  const intake = (file: string) => file.startsWith(".arcadia/asks/");
  // Line by line; a line may differ only where the replay wrote its own day,
  // and then by one settlement day used consistently across every file.
  // (`tryGit` trims its output, so both sides compare trimmed.)
  let settledDay: string | null = null;
  const sameSettlement = (committed: string | null, derived: string | null): boolean => {
    if (committed === null || derived === null) return committed === derived;
    const lines = committed.trim().split("\n");
    const derivedLines = derived.trim().split("\n");
    return lines.length === derivedLines.length && lines.every((line, index) => {
      const want = derivedLines[index];
      if (line === want) return true;
      if (!want.includes(replayDay)) return false;
      const pattern = new RegExp(`^${want.split(replayDay).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("(\\d{4}-\\d{2}-\\d{2})")}$`);
      const days = new Set(pattern.exec(line)?.slice(1) ?? []);
      if (days.size !== 1) return false;
      const [day] = [...days];
      settledDay ??= day;
      return day === settledDay;
    });
  };
  const changed = git(repoRoot, ["diff", "--name-only", bound, head]).split("\n").map((line) => line.trim()).filter(Boolean);
  const governed = changed.filter((file) => !intake(file));
  const expectedPaths = [...expected.keys()].filter((file) => !intake(file));
  const differing = [...new Set([...governed, ...expectedPaths])].filter((file) =>
    !expected.has(file) || !sameSettlement(tryGit(repoRoot, ["show", `${head}:${file}`]), expected.get(file) ?? null));
  if (expectedPaths.length === 0 || differing.length > 0) {
    throw validationError("HEAD is not this Ask's own canonical completion settlement: its files differ from the settlement derived at the Candidate revision.", { differing });
  }

  const operation = { proposalRef: input.proposalRef, disposition: "accepted", responsibility: null, placement: null, anchor: null };
  const effects = [
    ...preview.effects,
    `Recorded from commit ${head}, which had already applied these effects: the settling process ended after committing it and before recording it, so no document was rewritten.`
  ];
  // As settleAgentAsk reports it: the pointer the completion wrote, not the queue's front.
  const pointer = discoverDocs(repoRoot).docs.find((doc): doc is ProjectDoc => doc.type === "project" && doc.slug === project.slug)?.currentAction ?? null;
  const now = new Date().toISOString();
  const receipt: AgentAskSettlementReceipt = {
    ...preview,
    id: `asksettle_${randomUUID().replaceAll("-", "").slice(0, 18)}`,
    effects,
    nextActionKey: pointer ? `${project.slug}/${pointer}` : null,
    previewFingerprint: sha256(JSON.stringify({ proposalFingerprint: proposal.fingerprint, operation, documentsCommit: head })),
    applied: true,
    notificationStatus: "pending",
    createdAt: now,
    documentsCommit: head
  };
  delete receipt.review;
  delete receipt.warnings;
  if (input.dryRun) return receipt;
  // Phase 3 exactly as settleAgentAsk runs it after its commit: project the
  // committed documents, then record the receipt, in one transaction.
  writeTransaction(db, () => {
    const sync = syncProjectDocs(db, project, { apply: true, repoRoot });
    const blocking = sync.errors.filter((error) => changed.includes(error.relativePath));
    if (blocking.length > 0) throw validationError("The committed completion records failed operational sync.", { errors: blocking });
    insertSettlementRow(db, receipt, {
      proposalId: proposal.id, settlementRequestId: input.settlementRequestId, operation,
      previewFingerprint: receipt.previewFingerprint, effects, queueActionKey: receipt.queueActionKey, projectSlug: project.slug, now
    });
  });
  return receipt;
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
export function insertSettlementRow(
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
  const candidates = allPaths.filter((entry) => !entry.deleted || tracked.has(entry.relative)).map((entry) => entry.relative);
  // A Project may gitignore its `.arcadia/asks/` directory. The archived Ask is
  // bookkeeping for a file that Project chose not to track, so staging it made
  // `git add` refuse the whole commit — every settlement's managed documents
  // included (Issue #512). `git check-ignore` reports only untracked ignored
  // paths, so a tracked file is always still committed. It exits 1 when
  // nothing matches, which `tryGit` reports as null.
  // (`-z` is accepted only together with `--stdin`; these paths are
  // repository-relative names Arcadia chose, so newline splitting is safe.)
  const ignored = new Set((candidates.length > 0 ? tryGit(repoRoot, ["check-ignore", "--", ...candidates]) ?? "" : "")
    .split("\n").map((line) => line.trim()).filter(Boolean));
  const paths = candidates.filter((relative) => !ignored.has(relative));
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

const NOTIFICATION_UPCOMING_ACTION_LIMIT = 5;

export function listPendingAgentAskNotifications(db: Database.Database): PendingAgentAskNotification[] {
  const rows = db.prepare(`SELECT s.id, s.project_slug, s.disposition, s.effects_json, s.queue_action_key,
      s.queue_position, s.next_action_key, s.receipt_json, s.created_at, p.proposal_json
    FROM agent_ask_settlements s
    LEFT JOIN agent_ask_proposals p ON p.id = s.proposal_id
    WHERE s.notification_status = 'pending' ORDER BY s.created_at, s.id`)
    .all();
  if (rows.length === 0) return [];
  // Read live, not frozen at settlement time: the Ready lane can move between
  // when an Action was completed and when its Discord notification sends.
  // One queue build serves every pending row in this batch.
  const nextActions: AgentAskNotificationUpcomingAction[] = buildAgentQueue(db).ready
    .slice(0, NOTIFICATION_UPCOMING_ACTION_LIMIT)
    .map((entry) => ({ key: entry.orderKey ?? `${entry.projectSlug}/${entry.actionId}`, title: entry.actionTitle }));
  return rows
    .map((row) => {
      const value = row as Record<string, unknown>;
      const receipt = JSON.parse(String(value.receipt_json)) as AgentAskSettlementReceipt;
      const asked = notificationAskSummary(value.proposal_json);
      return {
        settlementId: String(value.id),
        requestId: asked.requestId ?? receipt.proposalRequestId ?? null,
        desiredResult: asked.desiredResult,
        projectSlug: String(value.project_slug),
        disposition: value.disposition as AgentAskDisposition,
        intent: receipt.intent,
        effects: JSON.parse(String(value.effects_json)) as string[],
        queueActionKey: value.queue_action_key === null ? null : String(value.queue_action_key),
        queueActionKeys: receipt.queueActionKeys ?? (value.queue_action_key === null ? [] : [String(value.queue_action_key)]),
        queuePosition: value.queue_position === null ? null : Number(value.queue_position),
        nextActionKey: value.next_action_key === null ? null : String(value.next_action_key),
        nextActions,
        createdAt: String(value.created_at),
        recovery: receipt.recovery ?? null
      };
    });
}

function notificationAskSummary(proposalJson: unknown): { requestId: string | null; desiredResult: string | null } {
  if (typeof proposalJson !== "string") return { requestId: null, desiredResult: null };
  try {
    const normalized = (JSON.parse(proposalJson) as { normalized?: { requestId?: unknown; desiredResult?: unknown } }).normalized;
    return {
      requestId: typeof normalized?.requestId === "string" ? normalized.requestId : null,
      desiredResult: typeof normalized?.desiredResult === "string" ? normalized.desiredResult : null
    };
  } catch {
    return { requestId: null, desiredResult: null };
  }
}

export interface UnsettledAgentAskProposal { id: string; requestId: string; proposal: AgentAskProposal; createdAt: string; }

/**
 * Every Agent Ask proposal previewed or drafted but never settled — the
 * terminal-approval surface `/runs` reads (surface-terminal-operator-approvals-in-runs).
 * A row here means a coding agent stopped short of `settle --apply`, which is
 * exactly the situation `apply_if_approved` authority or a genuinely stuck
 * intent produces; ordinary auto-settled Asks never appear, since a
 * settlement row exists for them the moment `settleAgentAsk` applies.
 */
export function listUnsettledAgentAskProposals(db: Database.Database): UnsettledAgentAskProposal[] {
  return db.prepare(`SELECT p.id, p.request_id, p.proposal_json, p.created_at
      FROM agent_ask_proposals p
      LEFT JOIN agent_ask_settlements s ON s.proposal_id = p.id
      WHERE s.id IS NULL
      ORDER BY p.created_at ASC, p.id ASC`)
    .all()
    .map((row) => {
      const value = row as { id: string; request_id: string; proposal_json: string; created_at: string };
      return {
        id: value.id,
        requestId: value.request_id,
        proposal: JSON.parse(value.proposal_json) as AgentAskProposal,
        createdAt: value.created_at
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

/**
 * `why` is prose, so it is always written as a double-quoted scalar. A bare
 * `yamlScalar` leaves `[x] done`, `{a}`, `true`, `null` or `123` unquoted, and
 * those re-parse as a list, mapping, boolean, null or number, so the settled
 * `why` would silently disappear.
 */
function quotedWhy(why: string): string {
  return JSON.stringify(why.trim());
}

/** Append one Action block to a managed Plan's block-form `actions:` list. Shared with production scheduling's discovery path. */
export function appendPlanAction(content: string, action: {
  id: string; title: string; responsibility: AgentAskResponsibility; acceptance: string[]; dependencies: string[]; references: string[]; source: string;
  /** One sentence on why the Action matters; omitted from the block when absent. */
  why?: string | null;
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
    ...(action.why ? [`    why: ${quotedWhy(action.why)}`] : []),
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

/** Refuse queue placement while this Plan's own Actions are unpositioned, naming them and the remedy. */
function requirePlanPositioned(queue: AgentQueue, projectSlug: string, planSlug: string, purpose: string): void {
  const unpositioned = unpositionedEntriesForPlan(queue, projectSlug, planSlug).map((entry) => entry.orderKey!);
  if (unpositioned.length === 0) return;
  throw validationError(
    `Position every existing approved Action in Plan ${planSlug} before ${purpose}: ${unpositioned.join(", ")}. ` +
      "Run `arcadia advance queue reorder --move <project/action> --top|--before|--after` for each.",
    { plan: planSlug, unpositionedCount: unpositioned.length, unpositioned }
  );
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
  // A callback, not a string: the frontmatter block for a Plan document
  // embeds the `actions:` list, so `lines` can carry an untouched Action
  // field's literal text (for example `markActionDone`'s own completed
  // next_action line, which may itself contain `$&`/`$1`/etc. from a
  // caller-supplied Agent Ask request_id). A string replacement here would
  // reinterpret those patterns against `match[0]`'s own match.
  const newFrontmatter = `---\n${lines.join("\n")}\n---`;
  return content.replace(match[0], () => newFrontmatter);
}

/** One top-level frontmatter scalar, unquoted; null when absent or empty. */
function frontmatterScalar(content: string, field: string): string | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const line = match?.[1].split(/\r?\n/).find((candidate) => candidate.startsWith(`${field}:`));
  if (!line) return null;
  const value = line.slice(field.length + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
  return value && value !== "null" && value !== "~" ? value : null;
}

/**
 * Stamp a Plan's `updated` with the settlement date. Every settlement that
 * changes a Plan document's content goes through here, so the field keeps
 * describing the Plan's last real change instead of its creation (Issue #598).
 */
function withPlanUpdated(content: string): string {
  return setTopLevelFields(content, { updated: today() });
}

function addMilestoneMutations(mutations: FileMutation[], projectPath: string, planPath: string, milestone: string): void {
  const projectBefore = readFileSync(projectPath, "utf8");
  const planBefore = readFileSync(planPath, "utf8");
  const transform = (current: string): string => replaceTopLevelField(current, "milestone", milestone);
  const planTransform = (current: string): string => withPlanUpdated(transform(current));
  mutations.push(
    { path: projectPath, before: projectBefore, after: transform(projectBefore), retransform: transform, pair: "project" },
    { path: planPath, before: planBefore, after: planTransform(planBefore), retransform: planTransform, pair: "plan" }
  );
}

/**
 * Approval boundaries named in CONSTITUTION.md's Authority section: merge,
 * deploy, publish, spend, credentials, production access, and messaging.
 * A `decision` Ask naming one of these always opens a Decision, regardless of
 * the filer's own gate-question triage.
 */
const APPROVAL_BOUNDARY_PATTERN = /\b(merg\w*|deploy\w*|publish\w*|spend\w*|credentials?|production|messag\w*)\b/i;

/**
 * Which Constitution gate question justifies opening a Decision for a
 * `decision`-intent Ask, per the triage this Action introduced (Agent Ask
 * `one-session-completes-one-action-2026-09-13`, `triage-decisions-before-
 * opening`): a Decision shaped like 0052 — an agent-answerable scope call
 * with a recommendation, no reasonable disagreement, and no approval boundary
 * — should never have reached the operator. Refuses (rather than silently
 * downgrading) when neither gate fires, so the filer applies its own
 * recommendation and reports it in the PR instead.
 */
function resolveDecisionGateQuestion(normalized: NormalizedAgentAsk): GateQuestion {
  const boundaryText = [normalized.desiredResult, normalized.rationale, ...normalized.options.flatMap((option) => [option.label, option.consequence])]
    .filter((text): text is string => text !== null);
  if (boundaryText.some((text) => APPROVAL_BOUNDARY_PATTERN.test(text))) return "approval_boundary";
  if (normalized.gateQuestion) return normalized.gateQuestion;
  throw validationError(
    "Agent Ask decision intent refused: neither Constitution gate question fires and no approval boundary is named, so this is not a Decision.",
    {
      requestId: normalized.requestId,
      gateQuestions: ["reasonable_disagreement", "resists_reversal"],
      remedy: "Apply the recommended option yourself and report the assumption in the pull request (intent: log), or set gate_question when a reasonable person could choose differently or the move resists reversal or reaches outside the work."
    }
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
  options: NormalizedAgentAskOption[],
  gateQuestion: GateQuestion
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
    `gate_question: ${gateQuestion}`,
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
    ...(action.why ? [`    why: ${quotedWhy(action.why)}`] : []),
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

/**
 * Field-level account of what amending an existing Action will change, so a
 * destructive amendment is visible in the settle preview before it is applied
 * (Issue #1079). A `null` list was omitted by the Ask and is left unchanged.
 */
function describeActionAmendment(
  existing: PlanActionDoc,
  next: { desiredResult: string; acceptance: string[]; dependencies: string[] | null; references: string[] | null; why?: string | null }
): string {
  const fields: string[] = [];
  const list = (items: string[]): string => `[${items.join(", ")}]`;
  if (next.desiredResult !== (existing.nextAction ?? existing.title)) fields.push("next_action changed");
  if (next.acceptance.length === 0) fields.push("acceptance unchanged");
  else if (JSON.stringify(next.acceptance) !== JSON.stringify(existing.acceptanceCriteria)) {
    fields.push(`acceptance changed (${next.acceptance.length} criteri${next.acceptance.length === 1 ? "on" : "a"})`);
  } else fields.push("acceptance unchanged");
  if (next.dependencies === null) fields.push("depends_on unchanged (omitted)");
  else if (JSON.stringify(next.dependencies) === JSON.stringify(existing.dependsOn)) fields.push("depends_on unchanged");
  else fields.push(`depends_on: ${list(existing.dependsOn)} \u2192 ${list(next.dependencies)}`);
  if (next.references === null) fields.push("references unchanged (omitted)");
  else if (JSON.stringify(next.references) === JSON.stringify(existing.references)) fields.push("references unchanged");
  else if (next.references.length === 0) fields.push("references cleared");
  else fields.push(`references: ${list(existing.references)} \u2192 ${list(next.references)}`);
  if (next.why && next.why !== existing.why) fields.push("why changed");
  return fields.join("; ");
}

const LEGACY_LIST_FALLBACK_EFFECT =
  "The Ask's original request text is unavailable or does not reproduce the recorded fingerprint, so omitted dependencies/references could not be told from explicit empty lists and are treated as explicit empty lists (legacy replace behavior).";

/**
 * Fill in `omittedLists` on a stored proposal that predates it by re-parsing
 * the request text captured with it, exactly as normalization does. A new
 * proposal always carries the key (an empty list when nothing was omitted), so
 * only a true legacy proposal is re-parsed. The re-parse is trusted only when
 * it reproduces the proposal's recorded fingerprint, so it is provably the
 * same Ask. Returns true when the text could not be used, so settlement falls
 * back to the old replace behavior and says so in the preview Effects.
 */
function hydrateOmittedLists(db: Database.Database, proposal: AgentAskProposal): boolean {
  const normalized = proposal.normalized;
  if (normalized.format !== "strict" || Object.hasOwn(normalized, "omittedLists")) return false;
  const row = db.prepare("SELECT original_text FROM ask_capture_envelopes WHERE id = ?")
    .get(proposal.captureId) as { original_text: string } | undefined;
  if (!row) return true;
  const parsed = reparseAskMatchingProposal(row.original_text, proposal);
  if (!parsed || parsed.format !== "strict" || parsed.actions.length !== normalized.actions.length) return true;
  if (parsed.omittedLists) normalized.omittedLists = parsed.omittedLists;
  parsed.actions.forEach((action, index) => {
    if (action.omittedLists) normalized.actions[index].omittedLists = action.omittedLists;
  });
  return false;
}

/** Refuse a dependency cycle that runs through any touched Action, retained edges included. */
function assertNoDependencyCycleThrough(actions: Array<{ id: string; dependencies: string[] }>, touched: string[]): void {
  const graph = new Map(actions.map((action) => [action.id, action.dependencies]));
  for (const start of touched) {
    const seen = new Set<string>();
    const stack = [...(graph.get(start) ?? [])];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current === start) throw validationError("Agent Ask Plan Actions contain a dependency cycle.", { actions: [start] });
      if (seen.has(current)) continue;
      seen.add(current);
      stack.push(...(graph.get(current) ?? []));
    }
  }
}

function amendAction(
  content: string,
  actionId: string,
  nextAction: string,
  acceptance: string[],
  dependencies: string[] | null,
  references: string[] | null,
  requestId: string,
  responsibility?: AgentAskResponsibility,
  why?: string | null
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
  // sequence the YAML parser rejects. A `null` list was omitted by the Ask and
  // leaves the existing value alone; only an explicit `[]` clears (Issue #1079).
  if (dependencies !== null) {
    block = block.replace(/^ {4}depends_on:.*(?:\r?\n {6}- .*)*/m,
      dependencies.length > 0 ? `    depends_on: [${dependencies.join(", ")}]` : "    depends_on: []");
  }
  if (references !== null) {
    block = block.replace(/^ {4}references:.*(?:\r?\n {6}- .*)*/m,
      references.length > 0 ? `    references: [${references.map((reference) => JSON.stringify(reference)).join(", ")}]` : "    references: []");
  }
  // An amendment that declares a `why` sets it; one that omits it leaves the
  // checked-in value alone. Function replacers keep `$` in prose literal.
  if (why) {
    const whyLine = `    why: ${quotedWhy(why)}`;
    block = /^ {4}why:/m.test(block)
      ? block.replace(/^ {4}why:.*$/m, () => whyLine)
      : block.replace(/^ {4}clarification:.*$/m, (line) => `${line}\n${whyLine}`);
  }
  block = /^ {4}source:/m.test(block)
    ? block.replace(/^ {4}source:.*$/m, `    source: ${yamlScalar(`Agent Ask ${requestId}`)}`)
    : block.replace(/^ {4}clarification:.*$/m, `$&\n    source: ${yamlScalar(`Agent Ask ${requestId}`)}`);
  return content.replace(pattern, block);
}

function markActionDone(content: string, actionId: string, requestId: string): string {
  const pattern = new RegExp(`(^  - id: ${escapeRegex(actionId)}\\r?$[\\s\\S]*?)(?=^  - id: |^---\\r?$)`, "m");
  const match = content.match(pattern);
  if (!match) throw validationError("Managed Plan Action block was not found.", { actionId });
  let block = match[1];
  if (!/^ {4}status:/m.test(block)) throw validationError("Managed Plan Action has no status field to amend.", { actionId });
  block = block.replace(/^ {4}status:.*$/m, "    status: done");
  // `next_action` is optional in `src/docs/parse.ts` unless `clarification`
  // is "clarified" (required) or this is the current pointer Action
  // (clarification itself required); `complete` can target an otherwise
  // valid legacy or non-active-Plan Action that never declared either. Rewrite
  // the field only when it is present — there is no stale instruction to make
  // unambiguous when it was never there, and the completion is still named by
  // the canonical Log entry and settlement receipt either way. Leaving it
  // absent preserves behavior the old writer already had for this shape.
  if (/^ {4}next_action:/m.test(block)) {
    // `next_action` is free text and may already be written as a YAML block
    // scalar (`|`/`>`) spanning several more-indented lines; a header-only
    // replace leaves those continuation lines behind, where they silently fold
    // into the new plain scalar instead of being discarded. Consumed the same
    // way `depends_on`/`references` consume their own continuation lines.
    // The replacement is a callback, not a string: `requestId` is a caller-
    // supplied Agent Ask request_id (normalized by `requiredText` only, so a
    // literal `$&`/`$1`/etc is legal input), and `String.replace` expands those
    // patterns in a string replacement. A callback returns it literally.
    const newNextActionLine = `    next_action: ${yamlScalar(`Completed via Agent Ask ${requestId}; no further action.`)}`;
    block = block.replace(/^ {4}next_action:.*(?:\r?\n(?! {4}\S).*)*/m, () => newNextActionLine);
  }
  // `block` now carries that same literal requestId text, so this final
  // reinsertion into `content` must also use a callback: a string replacement
  // here would reinterpret any `$&`/`$1`/etc. inside `block` against
  // `pattern`'s own match in `content`, not keep `block` literal.
  return content.replace(pattern, () => block);
}

/**
 * Overwrite one Action's `depends_on` field with `dependencies`, leaving
 * every other field untouched. Used by `split` to add remainder ids onto an
 * existing dependent's own dependency list, and onto the narrowed Action's
 * own list, without disturbing anything else the block declares.
 */
function setActionDependsOn(content: string, actionId: string, dependencies: string[]): string {
  const pattern = new RegExp(`(^  - id: ${escapeRegex(actionId)}\\r?$[\\s\\S]*?)(?=^  - id: |^---\\r?$)`, "m");
  const match = content.match(pattern);
  if (!match) throw validationError("Managed Plan Action block was not found.", { actionId });
  let block = match[1];
  if (!/^ {4}depends_on:/m.test(block)) throw validationError("Managed Plan Action has no depends_on field to amend.", { actionId });
  block = block.replace(/^ {4}depends_on:.*(?:\r?\n {6}- .*)*/m,
    dependencies.length > 0 ? `    depends_on: [${dependencies.join(", ")}]` : "    depends_on: []");
  return content.replace(pattern, block);
}

/**
 * Insert `split_into: [...]` right after `depends_on` in one Action's block.
 * Only ever called once per Action, immediately after {@link markActionDone}
 * marks it `done` from a `split`, so no existing `split_into` field to merge.
 */
function recordSplitInto(content: string, actionId: string, remainderIds: string[]): string {
  const pattern = new RegExp(`(^  - id: ${escapeRegex(actionId)}\\r?$[\\s\\S]*?)(?=^  - id: |^---\\r?$)`, "m");
  const match = content.match(pattern);
  if (!match) throw validationError("Managed Plan Action block was not found.", { actionId });
  const block = match[1];
  if (/^ {4}split_into:/m.test(block)) throw validationError("Managed Plan Action already carries a split_into field.", { actionId });
  const dependsOnField = /^ {4}depends_on:.*(?:\r?\n {6}- .*)*/m.exec(block);
  if (!dependsOnField) throw validationError("Managed Plan Action has no depends_on field to anchor split_into after.", { actionId });
  const insertAt = dependsOnField.index + dependsOnField[0].length;
  const updatedBlock = `${block.slice(0, insertAt)}\n    split_into: [${remainderIds.join(", ")}]${block.slice(insertAt)}`;
  return content.replace(pattern, updatedBlock);
}

/**
 * Re-parse a Plan's block-form Actions straight off `content` -- the raw text
 * a compare-and-set retry actually read -- through the same YAML-aware parser
 * `discoverDocs` uses, rather than a hand-rolled regex reader: it already
 * handles both `depends_on` spellings, block-list and inline forms, and
 * trailing YAML comments correctly, and it is what every other reader of this
 * Plan will see. Refuses if the fresh content fails to parse as this Plan.
 */
function parseFreshPlanDoc(content: string, relativePath: string, absolutePath: string, actionId: string): PlanDoc {
  const { doc, errors } = parseDoc(relativePath, absolutePath, content);
  if (!doc || doc.type !== "plan") {
    throw validationError("Could not re-parse the Plan being transformed.", { actionId, errors });
  }
  return doc;
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
/**
 * The slice of a Plan's Action bundle the pointer resolver actually reads.
 * `complete` passes a real `PlanDoc`; `split` passes a synthetic bundle that
 * also carries its not-yet-written remainder Actions, so the resolver can
 * consider them eligible without a disk read mid-mutation.
 */
interface QueueableActionBundle {
  actions: Array<Pick<PlanActionDoc, "id" | "status" | "dependsOn" | "decisions" | "clarification" | "responsibility">>;
}

function selectNextAfterCompletion(
  plan: QueueableActionBundle,
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
function deferredActionIdsFromDecisions(plan: { actions: Array<Pick<PlanActionDoc, "id">> }, decisionDocs: DecisionDoc[]): Set<string> {
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
function archiveSettledAskFile(
  fileMutations: FileMutation[],
  effects: string[],
  repoRoot: string,
  sourcePath: string | null,
  boundCandidateRevision: string | null
): string | null {
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
  return pushAskArchiveMutations(fileMutations, effects, repoRoot, resolved, readFileSync(resolved, "utf8"), boundCandidateRevision);
}

/** The request ids whose canonical draft name `agent-ask draft` writes and `untrackedDraftAskPaths` recognizes. */
const CANONICAL_DRAFT_REQUEST_ID = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Fallback for a proposal whose recorded `sourcePath` did not archive the
 * canonical draft (none was recorded, as for an Ask previewed from inline
 * text, or it named another file): archive the canonical drafted
 * file `.arcadia/asks/agent-ask-<request_id>.yaml` of the repository being
 * settled, in the same settlement commit (Issue #981). Without it, a drafted
 * Ask stayed untracked beside its own settlement commit, a later preservation
 * committed it, and the candidate could never integrate.
 *
 * It moves only that one exact path, and only when the file is a regular file
 * (never a symlink) whose directory resolves to this repository's own
 * `.arcadia/asks/` (no symlinked segment can redirect it elsewhere), and whose
 * content is this proposal itself: the same request id and the same preview
 * fingerprint `agentAskFingerprint` recorded. A file under that name that is
 * not this Ask is left in place and reported as a warning; the settlement
 * proceeds. No canonical file at all is a silent no-op, exactly as before.
 */
function archiveCanonicalDraftAskFile(
  fileMutations: FileMutation[],
  effects: string[],
  warnings: string[],
  repoRoot: string,
  proposal: AgentAskProposal,
  boundCandidateRevision: string | null
): string | null {
  const requestId = proposal.normalized.requestId;
  if (!CANONICAL_DRAFT_REQUEST_ID.test(requestId)) return null;
  const asksDir = path.join(repoRoot, ".arcadia", "asks");
  const canonical = path.join(asksDir, `agent-ask-${requestId}.yaml`);
  const relative = path.relative(repoRoot, canonical);
  let entry: ReturnType<typeof lstatSync>;
  try { entry = lstatSync(canonical); } catch { return null; }
  if (!entry.isFile()) {
    warnings.push(`Left ${relative} in place: it is not a regular file, so it is never archived as the settled Ask.`);
    return null;
  }
  let asksReal: string;
  let repoReal: string;
  try { asksReal = realpathSync(asksDir); repoReal = realpathSync(repoRoot); } catch { return null; }
  if (asksReal !== path.join(repoReal, ".arcadia", "asks")) {
    warnings.push(`Left ${relative} in place: its directory resolves outside this repository's own .arcadia/asks/.`);
    return null;
  }
  const archiveDir = path.join(asksDir, "archive");
  let archiveEntry: ReturnType<typeof lstatSync> | null;
  try { archiveEntry = lstatSync(archiveDir); } catch { archiveEntry = null; }
  if (archiveEntry && !archiveEntry.isDirectory()) {
    warnings.push(`Left ${relative} in place: ${path.relative(repoRoot, archiveDir)} is not a plain directory.`);
    return null;
  }
  const content = readFileSync(canonical, "utf8");
  if (!askFileMatchesProposal(content, proposal)) {
    warnings.push(`Left ${relative} in place: its content does not match settled proposal ${requestId} (request id or fingerprint differs), so it was not archived. `
      + "Review it; delete it if it is a stale copy, or re-draft it under a new request id.");
    return null;
  }
  return pushAskArchiveMutations(fileMutations, effects, repoRoot, canonical, content, boundCandidateRevision);
}

/**
 * Whether `content` is exactly the Ask this proposal recorded: it normalizes
 * to the same request id and reproduces the proposal's own preview
 * fingerprint. The fingerprint hashes the raw request text, so the only
 * latitude is surrounding whitespace, which `normalizeAgentAsk` discards and
 * `agent-ask draft` itself rewrites (it stores `trim()` plus one newline) — an
 * inline preview of the same JSON therefore still matches its drafted file.
 * The Project is the proposal's resolved slug, as preview hashed it.
 */
function askFileMatchesProposal(content: string, proposal: AgentAskProposal): boolean {
  return reparseAskMatchingProposal(content, proposal) !== null;
}

/**
 * The normalization of `content` when it is provably the Ask this proposal
 * recorded (same request id, same preview fingerprint); null otherwise. Shared
 * by the draft-file check and the legacy `omittedLists` re-derivation so both
 * trust a re-parse only when it reproduces the recorded fingerprint.
 */
function reparseAskMatchingProposal(content: string, proposal: AgentAskProposal): NormalizedAgentAsk | null {
  for (const request of new Set([content, content.trim(), `${content.trim()}\n`])) {
    let parsed: NormalizedAgentAsk;
    try {
      parsed = normalizeAgentAsk({ request, requestId: proposal.normalized.requestId, project: proposal.normalized.project });
    } catch {
      return null;
    }
    if (parsed.requestId !== proposal.normalized.requestId) return null;
    if (agentAskFingerprint(request, { ...parsed, project: proposal.normalized.project }) === proposal.fingerprint) return parsed;
  }
  return null;
}

/** Register the move of one settled Ask file into `.arcadia/asks/archive/`; returns its repository-relative source path. */
function pushAskArchiveMutations(
  fileMutations: FileMutation[],
  effects: string[],
  repoRoot: string,
  resolved: string,
  content: string,
  boundCandidateRevision: string | null
): string {
  const asksDir = path.dirname(resolved);
  const archivePath = path.join(asksDir, "archive", path.basename(resolved));
  // The draft may name its Candidate by an abbreviated sha, or by a revision a
  // pre-dispatch auto-settle refreshed in memory before settling it. Archive
  // the revision the settlement actually bound and the Mission Log records,
  // never the draft's own spelling and never the settlement commit, so the two
  // governance records of one completion cannot name different Candidates.
  const archived = boundCandidateRevision ? setTopLevelAskScalar(content, "candidate_revision", boundCandidateRevision) : content;
  fileMutations.push({ path: resolved, before: content, after: null });
  fileMutations.push({ path: archivePath, before: existsSync(archivePath) ? readFileSync(archivePath, "utf8") : null, after: archived });
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
