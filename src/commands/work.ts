import { existsSync } from "node:fs";
import path from "node:path";
import { createCodexPacket, selectAgentProfile } from "../codex/packets.js";
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
  QUEUE_LABELS,
  WORK_CLASSIFICATION_LABELS
} from "../domain/constants.js";
import type {
  ArtifactSummary,
  CodexInvocation,
  ExecutionPlanSummary,
  ExecutionRunSummary,
  ReviewItemSummary,
  WorkItemSummary
} from "../domain/types.js";
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
      effort: options.effort
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
      const packet = createCodexPacket({
        workspace: workspacePath,
        request: workItem.raw_input,
        resolved: resolvedIntentForWorkPlan(workItem, plan, "planning"),
        workItem,
        planId: plan.id,
        projectContext,
        agentProfile: selectAgentProfile(
          registries.codingAgents.profiles,
          "planning",
          options.agentProfile,
          registries.codingAgents.defaults
        )
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

  return response.data.workItems.flatMap((item) => renderWorkItem(item));
}

export function renderWorkUpdateSuccess(response: CommandSuccess<WorkUpdateCommandData>): string[] {
  return [
    `Updated Action: ${response.data.workItem.title}`,
    `ID: ${response.data.workItem.id}`,
    `Updated fields: ${response.data.updated.join(", ")}`,
    `Queue: ${response.data.workItem.queue}`,
    `Responsibility: ${WORK_CLASSIFICATION_LABELS[response.data.workItem.work_classification]}`,
    `Status: ${response.data.workItem.status}`,
    `Next action: ${response.data.workItem.next_action}`
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

const updateableFields = ["queue", "classification", "nextAction", "status", "effort"] as const;

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

    const agentProfile = selectAgentProfile(
      registries.codingAgents.profiles,
      purpose,
      permissions.agentProfile,
      registries.codingAgents.defaults
    );
    const packet = createCodexPacket({
      workspace: workspacePath,
      request: workItem.raw_input,
      resolved: resolvedIntentForWorkPlan(workItem, plan, purpose),
      workItem,
      planId: plan.id,
      projectContext: workItem.project_id ? getProjectContext(db, workItem.project_id) : null,
      agentProfile
    });

    createCodexInvocation(db, {
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
      planStepId: step.id
    });

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
      needsMark: step.needs_mark
    })),
    approvalGates: [],
    templates: [],
    slots: {},
    codexPurpose: purpose
  };
}

function renderWorkItem(item: WorkItemSummary): string[] {
  const project = item.project_name ? ` [${item.project_name}]` : "";
  const milestone = item.milestone_title ? ` (${item.milestone_title})` : "";

  return [
    `${item.title}${project}${milestone}`,
    `  ID: ${item.id}`,
    `  Queue: ${QUEUE_LABELS[item.queue]}`,
    `  Responsibility: ${WORK_CLASSIFICATION_LABELS[item.work_classification]}`,
    `  Status: ${item.status}`,
    `  Next action: ${item.next_action}`
  ];
}
