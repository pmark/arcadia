import { existsSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { createCodexPacket, selectAgentProfileForWorkItem } from "../codex/packets.js";
import { codingAgentLabel } from "../codingAgents/adapters.js";
import { executionPlanNotFound, validationError, workItemNotFound } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import {
  completeWorkItem,
  createArtifactRecord,
  createCodexInvocation,
  createWorkItemWithOptionalArtifact,
  createExecutionPlan,
  getArtifact,
  getCodexInvocation,
  getCodexInvocationForPlan,
  getExecutionPlan,
  getLatestExecutionPlanForWorkItem,
  getProjectContext,
  getReviewItemForInvocation,
  getWorkItem,
  listReviewItems,
  listWorkItems,
  updateWorkItem
} from "../db/repositories.js";
import {
  QUEUES,
  QUEUE_LABELS,
  WORK_CLASSIFICATIONS,
  WORK_CLASSIFICATION_LABELS,
  queueForWorkClassification,
  type QueueName,
  type WorkClassification
} from "../domain/constants.js";
import type {
  ArtifactSummary,
  CodexInvocation,
  ExecutionPlanSummary,
  ExecutionRunSummary,
  ReviewItemSummary,
  WorkItemSummary
} from "../domain/types.js";
import { orderByParent } from "../domain/workTree.js";
import { resolveActionReadiness, type DispatchBlocker } from "../docs/dispatch.js";
import { recordDispatchEvent } from "../docs/journal.js";
import { ensureBuiltInSkills, planStepsForWorkItem } from "../execution/skills.js";
import { executePlan, resolvePlanForRun } from "../execution/runner.js";
import {
  packetSha256,
  parseDecisionContext,
  queueApprovedPlanningRun
} from "../execution/planningAuthorization.js";
import {
  createPlanningApprovalDecision,
  persistCodexPacketRecords
} from "../execution/planningPreparation.js";
import { recordExecutionProfileEvent } from "../execution/profileEvents.js";
import type { Phase3Registries } from "../intent/registries.js";
import { loadPhase3Registries, validatePhase3Registries } from "../intent/registries.js";
import type { ResolvedIntent } from "../intent/resolver.js";

export interface WorkListCommandData {
  workItems: WorkItemSummary[];
}

export interface WorkUpdateOptions {
  workspace: string;
  workId: string;
  queue?: string;
  classification?: string;
  nextAction?: string;
  status?: string;
  effort?: string | null;
  expectedArtifact?: string | null;
  clarificationStatus?: string | null;
  gapType?: string | null;
  openQuestion?: string | null;
  clarificationSource?: string | null;
  confidence?: string | null;
  parentWorkItemId?: string | null;
}

export interface WorkAddSubtaskOptions {
  workspace: string;
  parentId: string;
  title: string;
  nextAction?: string;
  queue?: string;
  classification?: string;
  expectedArtifact?: string;
}

export interface WorkAddSubtaskCommandData {
  workItem: WorkItemSummary;
  parent: WorkItemSummary;
}

export interface WorkUpdateCommandData {
  workItem: WorkItemSummary;
  updated: string[];
}

export interface WorkDoneCommandData {
  workItem: WorkItemSummary;
}

export interface WorkPlanCommandData {
  plan: ExecutionPlanSummary;
  planningDecision: ReviewItemSummary | null;
  codexInvocation: CodexInvocation | null;
  packetArtifact: ArtifactSummary | null;
  reused: boolean;
}

export interface WorkRunCommandData {
  run: ExecutionRunSummary;
  missionLogPath: string | null;
}

export function runWorkListCommand(options: { workspace: string }): CommandSuccess<WorkListCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const workItems = withDatabase(workspacePath, listWorkItems);

  return createSuccess({
    command: "work.list",
    workspace: workspacePath,
    data: { workItems }
  });
}

export function runWorkUpdateCommand(options: WorkUpdateOptions): CommandSuccess<WorkUpdateCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const updated = updatedFields(options);

  if (updated.length === 0) {
    throw validationError("At least one Action field is required.", { fields: updateableFields });
  }

  const workItem = withDatabase(workspacePath, (db) =>
    updateWorkItem(db, options.workId, {
      queue: options.queue,
      workClassification: options.classification,
      nextAction: options.nextAction,
      status: options.status,
      effort: options.effort,
      expectedArtifact: options.expectedArtifact,
      clarificationStatus: options.clarificationStatus,
      gapType: options.gapType,
      openQuestion: options.openQuestion,
      clarificationSource: options.clarificationSource,
      confidence: options.confidence,
      parentWorkItemId: options.parentWorkItemId
    })
  );

  if (!workItem) {
    throw workItemNotFound(options.workId);
  }

  return createSuccess({
    command: "work.update",
    workspace: workspacePath,
    data: { workItem, updated }
  });
}

/**
 * Create one child Action under an existing one.
 *
 * Deliberately one subtask per call rather than a batch: a `missing-definition`
 * decomposition is a *proposal* until the operator approves it, and creating
 * children one at a time keeps that approval boundary in the operator's hands
 * instead of letting a decomposition materialize wholesale.
 *
 * A subtask inherits the parent's Project and Milestone — a child that drifted
 * to another Project would break the rollups the Dashboard builds — and starts
 * `unclarified`, because naming a subtask is not the same as deciding how to do
 * it.
 */
export function runWorkAddSubtaskCommand(
  options: WorkAddSubtaskOptions
): CommandSuccess<WorkAddSubtaskCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);

  const created = withDatabase(workspacePath, (db) => {
    const parent = getWorkItem(db, options.parentId);
    if (!parent) {
      throw workItemNotFound(options.parentId);
    }

    const title = options.title?.trim();
    if (!title) {
      throw validationError("Subtask title is required.", { parentId: options.parentId });
    }

    // A subtask defaults to the parent's Responsibility: a decomposition of
    // operator work is operator work until someone says otherwise.
    const workClassification = options.classification ?? parent.work_classification;
    if (!(WORK_CLASSIFICATIONS as readonly string[]).includes(workClassification)) {
      throw validationError(`Responsibility must be one of: ${WORK_CLASSIFICATIONS.join(", ")}`, {
        responsibility: workClassification
      });
    }

    if (options.queue && !(QUEUES as readonly string[]).includes(options.queue)) {
      throw validationError(`Queue must be one of: ${QUEUES.join(", ")}`, { queue: options.queue });
    }

    const result = createWorkItemWithOptionalArtifact(db, {
      projectId: parent.project_id,
      milestoneId: parent.milestone_id,
      title,
      rawInput: title,
      queue: (options.queue as QueueName | undefined) ?? queueForWorkClassification(workClassification as WorkClassification),
      workClassification: workClassification as WorkClassification,
      nextAction: options.nextAction ?? title,
      expectedArtifact: options.expectedArtifact,
      clarificationStatus: options.nextAction ? undefined : "unclarified",
      parentWorkItemId: parent.id
    });

    const workItem = getWorkItem(db, result.workItem.id);
    if (!workItem) {
      throw workItemNotFound(result.workItem.id);
    }

    return { workItem, parent };
  });

  return createSuccess({
    command: "work.add-subtask",
    workspace: workspacePath,
    data: created
  });
}

export function runWorkDoneCommand(options: { workspace: string; workId: string }): CommandSuccess<WorkDoneCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const workItem = withDatabase(workspacePath, (db) => completeWorkItem(db, options.workId));

  if (!workItem) {
    throw workItemNotFound(options.workId);
  }

  return createSuccess({
    command: "work.done",
    workspace: workspacePath,
    data: { workItem }
  });
}

export function runWorkPlanCommand(options: { workspace: string; workId: string; agentProfile?: string }): CommandSuccess<WorkPlanCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const prepared = withDatabase(workspacePath, (db) => {
    // Checked before the transaction opens, because this one writes a journal
    // row and then usually throws. Inside the transaction the refusal would
    // roll back the record of itself, and a journal that only remembers the
    // permitted dispatches answers none of the questions it exists for.
    const candidate = getWorkItem(db, options.workId);
    if (candidate) {
      assertActionCanBePlanned(candidate);
      assertManagedDocumentReadiness(db, candidate);
    }

    const transaction = db.transaction(() => {
      ensureBuiltInSkills(db);
      const workItem = getWorkItem(db, options.workId);
      if (!workItem) {
        return null;
      }
      assertActionCanBePlanned(workItem);
      assertNoManagedPlanningRun(db, workItem.id);

      const active = existingActivePlanningPreparation(db, workspacePath, workItem);
      if (active) {
        if (options.agentProfile && active.codexInvocation?.agent_profile !== options.agentProfile) {
          throw validationError("Active planning Decision is bound to a different coding agent profile.", {
            requestedProfile: options.agentProfile,
            packetProfile: active.codexInvocation?.agent_profile
          });
        }
        return { ...active, reused: true };
      }

      const steps = planStepsForWorkItem(workItem);
      const isManagedPlanning = steps.length === 1 && steps[0]?.executorType === "codex_planning";
      if (!isManagedPlanning) {
        const plan = createExecutionPlan(db, {
          workItemId: workItem.id,
          summary: `Execution plan for "${workItem.title}".`,
          steps
        });
        return plan
          ? { plan, planningDecision: null, codexInvocation: null, packetArtifact: null, reused: false }
          : null;
      }

      assertPlanningPreparationEligibility(db, workItem);
      const existingPlan = getLatestExecutionPlanForWorkItem(db, workItem.id);
      const plan = reusableUnpreparedPlanningPlan(db, workItem, existingPlan)
        ?? createExecutionPlan(db, {
          workItemId: workItem.id,
          summary: `Execution plan for "${workItem.title}".`,
          steps
        });
      if (!plan) {
        return null;
      }

      const registries = loadPhase3Registries(workspacePath);
      validatePhase3Registries(registries);
      const projectContext = getProjectContext(db, workItem.project_id as string);
      const agentSelection = selectAgentProfileForWorkItem({
        profiles: registries.codingAgents.profiles,
        adapters: registries.providerAdapters,
        workItem,
        purpose: "planning",
        requestedName: options.agentProfile,
        defaults: registries.codingAgents.defaults
      });
      const packet = createCodexPacket({
        workspace: workspacePath,
        request: workItem.raw_input,
        resolved: resolvedIntentForWorkPlan(workItem, plan, "planning"),
        workItem,
        planId: plan.id,
        projectContext,
        agentProfile: agentSelection.profile,
        agentConfiguration: agentSelection.configuration,
        executionRequirement: agentSelection.executionRequirement
      });
      const persisted = persistCodexPacketRecords(db, {
        packet,
        workItem,
        plan,
        planStepId: plan.steps[0]?.id ?? null
      });
      const planningDecision = createPlanningApprovalDecision(db, {
        workItem,
        plan,
        packet,
        packetArtifact: persisted.packetArtifact,
        sourceInput: workItem.raw_input,
        proposedAction: `Prepare the expected planning Artifact for existing Action "${workItem.title}".`,
        expectedArtifact: workItem.expected_artifact as string,
        existingAction: true
      });
      return {
        plan,
        planningDecision,
        codexInvocation: persisted.invocation,
        packetArtifact: getArtifact(db, persisted.packetArtifact.id),
        reused: false
      };
    });
    return transaction();
  });

  if (!prepared) {
    throw workItemNotFound(options.workId);
  }

  return createSuccess({
    command: "work.plan",
    workspace: workspacePath,
    data: prepared,
    artifacts: prepared.packetArtifact?.path
      ? [path.join(workspacePath, prepared.packetArtifact.path)]
      : []
  });
}

function assertActionCanBePlanned(workItem: WorkItemSummary): void {
  if (workItem.status === "done") {
    throw validationError("Completed Action cannot be prepared for planning.", {
      actionId: workItem.id,
      status: workItem.status
    });
  }
  if (
    workItem.status === "blocked" ||
    workItem.queue === "blocked" ||
    workItem.work_classification === "blocked"
  ) {
    throw validationError("Blocked Action cannot be prepared for planning.", {
      actionId: workItem.id,
      status: workItem.status,
      queue: workItem.queue,
      responsibility: workItem.work_classification
    });
  }
}

/**
 * Hold an Action that came from a managed plan to what its plan actually says.
 *
 * `arcadia next` refuses a dispatch whose prerequisites are unfinished or whose
 * required Decisions are unanswered, but preparing a Run went around it
 * entirely: the pointer was advisory, and the looser path was the one real work
 * travelled. Same rules, both paths, so the documents mean something.
 *
 * Applies only to doc-backed Actions. Everything Arcadia captured itself has no
 * plan to be checked against, and inventing rules for those would turn a
 * consistency fix into a new restriction on ordinary capture.
 */
function assertManagedDocumentReadiness(db: Database.Database, workItem: WorkItemSummary): void {
  const docRef = workItem.doc_ref?.trim();
  if (!docRef || !workItem.project_id) {
    return;
  }

  const parsed = parseActionDocRef(docRef);
  if (!parsed) {
    return;
  }

  const context = getProjectContext(db, workItem.project_id);
  const repoRoot = context?.metadata?.repo_path?.trim();
  const projectSlug = context?.project.slug;
  // Without a repository there are no documents to consult. `work plan` already
  // refuses later for the same reason, with a message about the repo path.
  if (!repoRoot || !projectSlug || !existsSync(repoRoot)) {
    return;
  }

  const readiness = resolveActionReadiness(repoRoot, projectSlug, parsed.actionId);
  // The plan may have been deleted or the action removed since ingestion. That
  // is a real drift worth surfacing, but `docs sync` is where it gets reported;
  // blocking planning on it would strand an Action with no way to repair it.
  if (!readiness.found) {
    return;
  }

  const blocked = readiness.blockers.length > 0 || readiness.operatorQuestion !== null;

  recordDispatchEvent(db, {
    command: "work.plan",
    projectId: workItem.project_id,
    projectSlug,
    planSlug: readiness.planSlug,
    actionId: parsed.actionId,
    dispatchable: !blocked,
    blockers: readiness.blockers,
    operatorQuestion: readiness.operatorQuestion
  });

  if (readiness.operatorQuestion) {
    throw validationError(
      "Action has an open clarification question in its plan; answer it before preparing a Run.",
      {
        actionId: workItem.id,
        docRef,
        plan: readiness.planPath,
        question: readiness.operatorQuestion
      }
    );
  }

  if (readiness.blockers.length > 0) {
    throw validationError("Action is not ready in its managed plan.", {
      actionId: workItem.id,
      docRef,
      plan: readiness.planPath,
      blockers: readiness.blockers.map((blocker: DispatchBlocker) => ({
        field: blocker.field,
        message: blocker.message,
        remedy: blocker.remedy
      }))
    });
  }
}

/** `plan/<plan-slug>#<action-id>` — the shape `docs sync` writes for an Action. */
function parseActionDocRef(docRef: string): { planSlug: string; actionId: string } | null {
  const match = /^plan\/([^#]+)#(.+)$/.exec(docRef);
  return match ? { planSlug: match[1], actionId: match[2] } : null;
}

function assertNoManagedPlanningRun(
  db: Parameters<typeof getWorkItem>[0],
  workItemId: string
): void {
  const activeRun = db.prepare(
    `SELECT id, status FROM execution_runs
     WHERE work_item_id = ? AND status IN ('pending_execution', 'running')
     ORDER BY created_at DESC LIMIT 1`
  ).get(workItemId) as { id: string; status: string } | undefined;
  if (activeRun) {
    throw validationError("Action already has managed planning execution underway.", {
      actionId: workItemId,
      runId: activeRun.id,
      status: activeRun.status
    });
  }
}

function existingActivePlanningPreparation(
  db: Parameters<typeof getWorkItem>[0],
  workspacePath: string,
  workItem: WorkItemSummary
): Omit<WorkPlanCommandData, "reused"> | null {
  const decisions = listReviewItems(db, "all").filter((item) =>
    item.work_item_id === workItem.id &&
    item.resolved_intent === "CodexPlanningRunApproval" &&
    (item.status === "open" || item.status === "deferred")
  );
  if (decisions.length === 0) {
    return null;
  }
  if (decisions.length !== 1) {
    throw validationError("Action has multiple active planning Decisions and requires repair before preparation.", {
      actionId: workItem.id,
      decisionIds: decisions.map((item) => item.id)
    });
  }

  assertRequiredPlanningContext(db, workItem);
  const planningDecision = decisions[0] as ReviewItemSummary;
  const plan = planningDecision.plan_id ? getExecutionPlan(db, planningDecision.plan_id) : null;
  const codexInvocation = planningDecision.codex_invocation_id
    ? getCodexInvocation(db, planningDecision.codex_invocation_id)
    : null;
  const packetArtifact = planningDecision.artifact_id ? getArtifact(db, planningDecision.artifact_id) : null;
  if (
    !plan ||
    !codexInvocation ||
    !packetArtifact ||
    plan.work_item_id !== workItem.id ||
    planningDecision.project_id !== workItem.project_id ||
    codexInvocation.work_item_id !== workItem.id ||
    codexInvocation.plan_id !== plan.id ||
    codexInvocation.purpose !== "planning" ||
    codexInvocation.status !== "packet_created" ||
    packetArtifact.work_item_id !== workItem.id ||
    packetArtifact.path !== codexInvocation.prompt_path
  ) {
    throw validationError("Active planning Decision has inconsistent Action, plan, packet, or invocation links.", {
      actionId: workItem.id,
      decisionId: planningDecision.id
    });
  }

  const promptPath = path.join(workspacePath, codexInvocation.prompt_path);
  const context = parseDecisionContext(planningDecision);
  if (!existsSync(promptPath) || !context.packetSha256 || packetSha256(promptPath) !== context.packetSha256) {
    throw validationError("Active planning packet is missing or changed; resolve the Decision before preparing again.", {
      actionId: workItem.id,
      decisionId: planningDecision.id,
      promptPath: codexInvocation.prompt_path
    });
  }

  return { plan, planningDecision, codexInvocation, packetArtifact };
}

function assertPlanningPreparationEligibility(
  db: Parameters<typeof getWorkItem>[0],
  workItem: WorkItemSummary
): void {
  if (workItem.status !== "open") {
    throw validationError("Action must be open and not already in progress before planning preparation.", {
      actionId: workItem.id,
      status: workItem.status
    });
  }
  if (workItem.work_classification !== "codex" || workItem.queue !== "work_queue") {
    throw validationError("Action must have Codex Responsibility in the Work Queue before planning preparation.", {
      actionId: workItem.id,
      queue: workItem.queue,
      responsibility: workItem.work_classification
    });
  }
  assertRequiredPlanningContext(db, workItem);

  const unreviewedInvocation = db.prepare(
    `SELECT ci.id, ci.status
     FROM codex_invocations ci
     WHERE ci.work_item_id = ?
       AND ci.purpose = 'planning'
       AND ci.status IN ('packet_created', 'running')
     ORDER BY ci.created_at DESC LIMIT 1`
  ).get(workItem.id) as { id: string; status: string } | undefined;
  if (unreviewedInvocation) {
    throw validationError("Action already has an active planning packet without an actionable preparation Decision.", {
      actionId: workItem.id,
      codexInvocationId: unreviewedInvocation.id,
      status: unreviewedInvocation.status
    });
  }
}

function assertRequiredPlanningContext(
  db: Parameters<typeof getWorkItem>[0],
  workItem: WorkItemSummary
): void {
  if (!workItem.project_id) {
    throw validationError("Action must belong to a Project before planning preparation.", {
      actionId: workItem.id
    });
  }
  const projectContext = getProjectContext(db, workItem.project_id);
  if (!projectContext) {
    throw validationError("Action Project context is missing.", {
      actionId: workItem.id,
      projectId: workItem.project_id
    });
  }
  if (!projectContext.metadata?.repo_path) {
    throw validationError("Action Project repository path is required before planning preparation.", {
      actionId: workItem.id,
      projectId: workItem.project_id
    });
  }
  if (!workItem.expected_artifact?.trim()) {
    throw validationError("Action expected planning Artifact is required before planning preparation.", {
      actionId: workItem.id
    });
  }
}

function reusableUnpreparedPlanningPlan(
  db: Parameters<typeof getWorkItem>[0],
  workItem: WorkItemSummary,
  plan: ExecutionPlanSummary | null
): ExecutionPlanSummary | null {
  if (!plan || plan.status !== "planned") {
    return null;
  }
  const invocation = getCodexInvocationForPlan(db, {
    workItemId: workItem.id,
    planId: plan.id,
    purpose: "planning"
  });
  if (invocation) {
    throw validationError("Planned Action already has a planning packet that is not safely reusable.", {
      actionId: workItem.id,
      planId: plan.id,
      codexInvocationId: invocation.id
    });
  }
  if (plan.steps.length !== 1 || plan.steps[0]?.executor_type !== "codex_planning") {
    throw validationError("Existing planned workflow is not a single managed Codex planning step.", {
      actionId: workItem.id,
      planId: plan.id
    });
  }
  return plan;
}

export function runWorkRunCommand(options: {
  workspace: string;
  workId: string;
  plan?: string;
  allowCodexPlanning?: boolean;
  allowCodexBuild?: boolean;
  agentProfile?: string;
}): CommandSuccess<WorkRunCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const registries = options.allowCodexPlanning || options.allowCodexBuild
    ? loadPhase3Registries(workspacePath)
    : null;
  if (registries) {
    validatePhase3Registries(registries);
  }
  const result = withDatabase(workspacePath, (db) => {
    ensureBuiltInSkills(db);
    const workItem = getWorkItem(db, options.workId);
    if (!workItem) {
      return { missingWorkItem: true as const };
    }

    let plan = resolvePlanForRun(db, options.workId, options.plan);
    if (!plan && !options.plan) {
      plan = createExecutionPlan(db, {
        workItemId: workItem.id,
        summary: `Execution plan for "${workItem.title}".`,
        steps: planStepsForWorkItem(workItem)
      });
    }

    if (!plan) {
      return { missingPlan: true as const };
    }

    if (plan.steps.some((step) => step.executor_type === "codex_planning")) {
      if (!options.allowCodexPlanning) {
        throw validationError("Planning execution requires an approved Decision for this Action, plan, and packet.");
      }
      const invocation = getCodexInvocationForPlan(db, {
        workItemId: workItem.id,
        planId: plan.id,
        purpose: "planning"
      });
      if (options.agentProfile && invocation?.agent_profile !== options.agentProfile) {
        throw validationError("Approved planning packet is bound to a different coding agent profile.", {
          requestedProfile: options.agentProfile,
          packetProfile: invocation?.agent_profile
        });
      }
      const decision = invocation
        ? getReviewItemForInvocation(db, invocation.id, ["CodexPlanningRunApproval", "CodexPlanningRetryApproval"])
        : null;
      if (!decision || decision.status !== "approved") {
        throw validationError("Planning execution requires an approved Decision for this Action, plan, and packet.", {
          workItemId: workItem.id,
          planId: plan.id
        });
      }
      const queued = queueApprovedPlanningRun(db, workspacePath, {
        decisionId: decision.id,
        execute: true,
        executorName: invocation?.agent_profile
      });
      if (!queued.run) {
        throw validationError("Approved planning Run could not be queued.");
      }
      return { run: queued.run, missionLogPath: queued.run.mission_log_path };
    }

    if (registries) {
      ensureCodexPacketsForPlan(db, workspacePath, workItem, plan, registries, {
        allowCodexPlanning: options.allowCodexPlanning,
        allowCodexBuild: options.allowCodexBuild,
        agentProfile: options.agentProfile
      });
    }

    return executePlan(db, workspacePath, plan, {
      allowCodexPlanning: options.allowCodexPlanning,
      allowCodexBuild: options.allowCodexBuild,
      agentProfile: options.agentProfile,
      codingAgentProfiles: registries?.codingAgents.profiles
    });
  });

  if ("missingWorkItem" in result) {
    throw workItemNotFound(options.workId);
  }

  if ("missingPlan" in result) {
    throw executionPlanNotFound(options.plan ?? "");
  }

  return createSuccess({
    command: "work.run",
    workspace: workspacePath,
    data: {
      run: result.run,
      missionLogPath: result.missionLogPath
    },
    artifacts: [
      ...(result.missionLogPath ? [path.join(workspacePath, result.missionLogPath)] : []),
      ...result.run.artifacts.flatMap((artifact) => artifact.path ? [path.join(workspacePath, artifact.path)] : [])
    ]
  });
}

export function renderWorkListSuccess(response: CommandSuccess<WorkListCommandData>): string[] {
  if (response.data.workItems.length === 0) {
    return ["No Actions yet."];
  }

  return orderByParent(response.data.workItems).flatMap(({ item, depth }) => renderWorkItem(item, depth));
}

export function renderWorkAddSubtaskSuccess(response: CommandSuccess<WorkAddSubtaskCommandData>): string[] {
  return [
    `Added subtask: ${response.data.workItem.title}`,
    `ID: ${response.data.workItem.id}`,
    `Parent: ${response.data.parent.title} (${response.data.parent.id})`,
    `Queue: ${QUEUE_LABELS[response.data.workItem.queue]}`,
    `Responsibility: ${WORK_CLASSIFICATION_LABELS[response.data.workItem.work_classification]}`,
    `Next action: ${response.data.workItem.next_action}`
  ];
}

export function renderWorkUpdateSuccess(response: CommandSuccess<WorkUpdateCommandData>): string[] {
  return [
    `Updated Action: ${response.data.workItem.title}`,
    `ID: ${response.data.workItem.id}`,
    `Updated fields: ${response.data.updated.join(", ")}`,
    `Queue: ${response.data.workItem.queue}`,
    `Responsibility: ${WORK_CLASSIFICATION_LABELS[response.data.workItem.work_classification]}`,
    `Status: ${response.data.workItem.status}`,
    `Next action: ${response.data.workItem.next_action}`,
    `Expected artifact: ${response.data.workItem.expected_artifact ?? "None"}`,
    ...renderClarification(response.data.workItem, "")
  ];
}

export function renderWorkDoneSuccess(response: CommandSuccess<WorkDoneCommandData>): string[] {
  return [
    `Completed Action: ${response.data.workItem.title}`,
    `ID: ${response.data.workItem.id}`,
    `Status: ${response.data.workItem.status}`
  ];
}

export function renderWorkPlanSuccess(response: CommandSuccess<WorkPlanCommandData>): string[] {
  const lines = [
    `${response.data.reused ? "Reused" : "Created"} workflow plan: ${response.data.plan.id}`,
    `Action: ${response.data.plan.work_item_id}`,
    `Status: ${response.data.plan.status}`,
    "Steps:",
    ...response.data.plan.steps.map((step) =>
      `  ${step.position}. ${step.title} (${step.executor_type}, safe: ${step.safe_to_run === 1 ? "yes" : "no"})`
    )
  ];
  if (response.data.planningDecision) {
    lines.push(`Planning Decision: ${response.data.planningDecision.slug ?? response.data.planningDecision.id}`);
    lines.push(`Packet: ${response.data.packetArtifact?.path ?? "Unavailable"}`);
    lines.push("No Run was queued and Codex was not invoked.");
  }
  return lines;
}

export function renderWorkRunSuccess(response: CommandSuccess<WorkRunCommandData>): string[] {
  return [
    `Created run: ${response.data.run.id}`,
    `Status: ${response.data.run.status}`,
    `Mission log: ${response.data.missionLogPath ?? "None"}`,
    "Steps:",
    ...response.data.run.steps.map((step) => `  ${step.status}: ${step.plan_step_title}`)
  ];
}

const updateableFields = [
  "queue",
  "classification",
  "nextAction",
  "status",
  "effort",
  "expectedArtifact",
  "clarificationStatus",
  "gapType",
  "openQuestion",
  "clarificationSource",
  "confidence",
  "parentWorkItemId"
] as const;

function updatedFields(options: WorkUpdateOptions): string[] {
  const fields: string[] = [];

  if (options.queue !== undefined) {
    fields.push("queue");
  }

  if (options.classification !== undefined) {
    fields.push("classification");
  }

  if (options.nextAction !== undefined) {
    fields.push("nextAction");
  }

  if (options.status !== undefined) {
    fields.push("status");
  }

  if (options.effort !== undefined) {
    fields.push("effort");
  }

  if (options.expectedArtifact !== undefined) {
    fields.push("expectedArtifact");
  }

  if (options.clarificationStatus !== undefined) {
    fields.push("clarificationStatus");
  }

  if (options.gapType !== undefined) {
    fields.push("gapType");
  }

  if (options.openQuestion !== undefined) {
    fields.push("openQuestion");
  }

  if (options.clarificationSource !== undefined) {
    fields.push("clarificationSource");
  }

  if (options.confidence !== undefined) {
    fields.push("confidence");
  }

  if (options.parentWorkItemId !== undefined) {
    fields.push("parentWorkItemId");
  }

  return fields;
}

function ensureCodexPacketsForPlan(
  db: Parameters<typeof getWorkItem>[0],
  workspacePath: string,
  workItem: WorkItemSummary,
  plan: ExecutionPlanSummary,
  registries: Phase3Registries,
  permissions: { allowCodexPlanning?: boolean; allowCodexBuild?: boolean; agentProfile?: string }
): void {
  for (const step of plan.steps) {
    const purpose = step.executor_type === "codex_build"
      ? "build"
      : step.executor_type === "codex_planning"
        ? "planning"
        : null;

    if (!purpose) {
      continue;
    }

    const allowed = purpose === "build" ? permissions.allowCodexBuild : permissions.allowCodexPlanning;
    const existing = getCodexInvocationForPlan(db, { workItemId: workItem.id, planId: plan.id, purpose });
    if (!allowed) {
      continue;
    }
    if (existing) {
      if (permissions.agentProfile && existing.agent_profile !== permissions.agentProfile) {
        throw validationError("Existing packet is bound to a different coding agent profile.", {
          requestedProfile: permissions.agentProfile,
          packetProfile: existing.agent_profile
        });
      }
      continue;
    }

    const agentSelection = selectAgentProfileForWorkItem({
      profiles: registries.codingAgents.profiles,
      adapters: registries.providerAdapters,
      workItem,
      purpose,
      requestedName: permissions.agentProfile,
      defaults: registries.codingAgents.defaults
    });
    const packet = createCodexPacket({
      workspace: workspacePath,
      request: workItem.raw_input,
      resolved: resolvedIntentForWorkPlan(workItem, plan, purpose),
      workItem,
      planId: plan.id,
      projectContext: workItem.project_id ? getProjectContext(db, workItem.project_id) : null,
      agentProfile: agentSelection.profile,
      agentConfiguration: agentSelection.configuration,
      executionRequirement: agentSelection.executionRequirement
    });

    const invocation = createCodexInvocation(db, {
      id: packet.invocationId,
      purpose: packet.purpose,
      agentProfile: packet.agentProfile.name,
      workspaceScope: packet.workspaceScope,
      command: packet.command,
      promptPath: packet.relativePromptPath,
      jsonlOutputPath: packet.relativeJsonlOutputPath,
      finalMessagePath: packet.relativeFinalMessagePath,
      status: "packet_created",
      workItemId: workItem.id,
      planId: plan.id,
      planStepId: step.id,
      executionProfileJson: packet.executionRequirement
        ? JSON.stringify(packet.executionRequirement)
        : null,
      providerMappingId: packet.agentConfiguration?.mappingId ?? null,
      providerBindingId: packet.agentConfiguration?.bindingId ?? null
    });
    if (packet.agentConfiguration && packet.executionRequirement) {
      const phase = purpose === "planning" ? "planning" : "implementation";
      recordExecutionProfileEvent(db, {
        eventType: "coding_agent.profile_selected",
        workItemId: workItem.id,
        invocationId: invocation.id,
        phase,
        reason: "Least-cost compliant provider-adapter binding selected.",
        to: packet.executionRequirement.phases[phase] ?? packet.executionRequirement.baseline,
        mappingId: packet.agentConfiguration.mappingId,
        bindingId: packet.agentConfiguration.bindingId
      });
    }

    createArtifactRecord(db, {
      projectId: workItem.project_id,
      workItemId: workItem.id,
      title: `${codingAgentLabel(packet.agentProfile)} ${packet.purpose} packet: ${workItem.title}`,
      artifactType: "codex_prompt_packet",
      status: "drafted",
      path: packet.relativePromptPath
    });
  }
}

function resolvedIntentForWorkPlan(
  workItem: WorkItemSummary,
  plan: ExecutionPlanSummary,
  purpose: "planning" | "build"
): ResolvedIntent {
  return {
    intentId: purpose === "build" ? "codex_build" : "codex_plan",
    matched: false,
    title: workItem.title,
    outputKind: purpose === "build" ? "codex_build_packet" : "codex_planning_packet",
    queue: workItem.queue,
    workClassification: workItem.work_classification,
    nextAction: workItem.next_action,
    expectedArtifact: workItem.expected_artifact,
    skillSequence: plan.steps.map((step) => ({
      skillName: step.skill_name,
      title: step.title,
      command: step.command,
      executorType: step.executor_type,
      safeToRun: step.safe_to_run === 1,
      needsOperator: step.needs_operator
    })),
    approvalGates: [],
    templates: [],
    slots: {},
    codexPurpose: purpose
  };
}

function renderWorkItem(item: WorkItemSummary, depth = 0): string[] {
  const project = item.project_name ? ` [${item.project_name}]` : "";
  const milestone = item.milestone_title ? ` (${item.milestone_title})` : "";
  // Subtasks are indented under their parent and bulleted, so a decomposition
  // reads as one piece of work rather than as several unrelated Actions.
  const pad = "  ".repeat(depth);
  const bullet = depth > 0 ? "- " : "";
  const detail = `${pad}  `;

  return [
    `${pad}${bullet}${item.title}${project}${milestone}`,
    `${detail}ID: ${item.id}`,
    `${detail}Queue: ${QUEUE_LABELS[item.queue]}`,
    `${detail}Responsibility: ${WORK_CLASSIFICATION_LABELS[item.work_classification]}`,
    `${detail}Status: ${item.status}`,
    `${detail}Next action: ${item.next_action}${pendingClarificationSuffix(item)}`,
    ...renderClarification(item, detail)
  ];
}

/**
 * An un-clarified Action's `next_action` is a placeholder, not a commitment.
 * Saying so inline stops a listing from reading like the work is decided.
 */
function pendingClarificationSuffix(item: WorkItemSummary): string {
  return item.clarification_status === "unclarified" ? " — (pending clarification)" : "";
}

/**
 * Only surface clarification detail that exists. A NULL `clarification_status`
 * means the Action predates clarification or was never evaluated, and padding
 * every listing with "Gap: none" lines would bury the Actions that do carry a
 * real open question.
 */
function renderClarification(item: WorkItemSummary, indent: string): string[] {
  const lines: string[] = [];

  if (item.clarification_status) {
    lines.push(`${indent}Clarification: ${item.clarification_status}`);
  }

  if (item.gap_type) {
    lines.push(`${indent}Gap: ${item.gap_type}`);
  }

  if (item.open_question) {
    lines.push(`${indent}Open question: ${item.open_question}`);
  }

  if (item.clarification_source) {
    lines.push(`${indent}Source: ${item.clarification_source}`);
  }

  if (item.confidence) {
    lines.push(`${indent}Confidence: ${item.confidence}`);
  }

  return lines;
}
