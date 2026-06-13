import path from "node:path";
import { createCodexPacket, selectAgentProfile } from "../codex/packets.js";
import { milestoneNotFound, projectNotFound, validationError, workItemNotFound } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import {
  createApprovalGate,
  createArtifactRecord,
  createAskRequest,
  createBackBurnerItem,
  createCodexInvocation,
  createExecutionPlan,
  createMilestoneForProject,
  createReviewItem,
  createWorkItemWithOptionalArtifact,
  getActiveMilestoneForProject,
  getProjectMetadata,
  getMilestone,
  getProject,
  getProjectContext,
  getWorkItem,
  listProjects,
  listProjectSummaries,
  listWorkItems,
  listApprovalGatesForWorkItem,
  listCodexInvocationsForWorkItem,
  resolveProjectContextFromRequest,
  updateProject,
  updateWorkItem
} from "../db/repositories.js";
import type {
  ApprovalGate,
  AskRequestSummary,
  CodexInvocation,
  ExecutionPlanSummary,
  ExecutionRunSummary,
  Project,
  ProjectSummary,
  ProjectContext,
  WorkItemSummary
} from "../domain/types.js";
import type { ProjectStatus } from "../domain/constants.js";
import { ensureBuiltInSkills } from "../execution/skills.js";
import { executePlan } from "../execution/runner.js";
import { loadPhase3Registries, validatePhase3Registries } from "../intent/registries.js";
import type { ResolvedIntent } from "../intent/resolver.js";
import type { IntakeProjectAttribute, IntakeProjectContext, IntakeResult, IntakeWorkspaceContext } from "../intake/index.js";
import { resolveIntake } from "../intake/index.js";
import type { ReviewRequiredCommandData } from "./review.js";
import { runReviewRequiredCommand, runReviewResolveReplyCommand } from "./review.js";
import type { StatusCommandData } from "./status.js";
import { runStatusCommand } from "./status.js";
import { createProjectWithDefaults } from "./project.js";

export interface AskOptions {
  workspace: string;
  request: string;
  project?: string;
  milestone?: string;
  runSafe?: boolean;
  approvedReviewItemId?: string;
  sourceIngress?: string;
}

export interface AskCommandData {
  ask: AskRequestSummary;
  intake: IntakeResult;
  resolvedIntent: ResolvedIntent;
  result: {
    status: "acted" | "queued" | "requires_review" | "captured";
    summary: string;
  };
  workItem: WorkItemSummary | null;
  plan: ExecutionPlanSummary | null;
  approvalGates: ApprovalGate[];
  codexInvocations: CodexInvocation[];
  run: ExecutionRunSummary | null;
  project: Project | null;
  projectSummary: ProjectSummary | null;
  projects: ProjectSummary[] | null;
  status: StatusCommandData | null;
  review: ReviewRequiredCommandData | null;
  reviewItemId: string | null;
  backBurnerItemId: string | null;
}

export function runAskCommand(options: AskOptions): CommandSuccess<AskCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const registries = loadPhase3Registries(workspacePath);
  validatePhase3Registries(registries);
  const intake = withDatabase(workspacePath, (db) => resolveIntake(options.request, buildIntakeContext(db)));
  const approvedFromReview = Boolean(options.approvedReviewItemId);
  const resolved = resolvedIntentFromIntake(intake, approvedFromReview);
  let run: ExecutionRunSummary | null = null;

  if (intake.action.kind === "show_status" && intake.confidenceLabel === "high") {
    const status = runStatusCommand({ workspace: workspacePath });
    const ask = withDatabase(workspacePath, (db) =>
      createAskRequest(db, {
        rawRequest: options.request,
        resolvedIntent: resolved.intentId,
        registryVersion: registries.intents.version,
        outputKind: resolved.outputKind,
        status: "planned"
      })
    );
    return createSuccess({
      command: "ask",
      workspace: workspacePath,
      data: {
        ask,
        intake,
        resolvedIntent: resolved,
        result: {
          status: "acted",
          summary: "Status shown."
        },
        workItem: null,
        plan: null,
        approvalGates: [],
        codexInvocations: [],
        run: null,
        project: null,
        projectSummary: null,
        projects: null,
        status: status.data,
        review: null,
        reviewItemId: null,
        backBurnerItemId: null
      },
      artifacts: status.artifacts
    });
  }

  if (intake.action.kind === "show_review" && intake.confidenceLabel === "high") {
    const review = runReviewRequiredCommand({ workspace: workspacePath });
    const ask = withDatabase(workspacePath, (db) =>
      createAskRequest(db, {
        rawRequest: options.request,
        resolvedIntent: resolved.intentId,
        registryVersion: registries.intents.version,
        outputKind: resolved.outputKind,
        status: "planned"
      })
    );
    return createSuccess({
      command: "ask",
      workspace: workspacePath,
      data: {
        ask,
        intake,
        resolvedIntent: resolved,
        result: {
          status: "acted",
          summary: "Requires Review items shown."
        },
        workItem: null,
        plan: null,
        approvalGates: [],
        codexInvocations: [],
        run: null,
        project: null,
        projectSummary: null,
        projects: null,
        status: null,
        review: review.data,
        reviewItemId: null,
        backBurnerItemId: null
      }
    });
  }

  if (intake.classification === "ReviewResponse" && explicitReviewSlugFromInput(options.request)) {
    const reviewResolution = runReviewResolveReplyCommand({
      workspace: workspacePath,
      reply: options.request
    });
    const ask = withDatabase(workspacePath, (db) =>
      createAskRequest(db, {
        rawRequest: options.request,
        resolvedIntent: resolved.intentId,
        registryVersion: registries.intents.version,
        outputKind: "review_response",
        status: "planned"
      })
    );

    return createSuccess({
      command: "ask",
      workspace: workspacePath,
      data: {
        ask,
        intake,
        resolvedIntent: resolved,
        result: {
          status: "acted",
          summary: reviewResolution.data.confirmation
        },
        workItem: null,
        plan: null,
        approvalGates: [],
        codexInvocations: [],
        run: null,
        project: null,
        projectSummary: null,
        projects: null,
        status: null,
        review: null,
        reviewItemId: null,
        backBurnerItemId: null
      },
      artifacts: reviewResolution.artifacts
    });
  }

  if (
    (intake.confidenceLabel === "high" || approvedFromReview) &&
    intake.action.kind === "create_project" &&
    intake.action.projectName
  ) {
    const created = createProjectWithDefaults({
      workspace: workspacePath,
      name: intake.action.projectName
    });
    const ask = withDatabase(workspacePath, (db) =>
      createAskRequest(db, {
        rawRequest: options.request,
        resolvedIntent: resolved.intentId,
        registryVersion: registries.intents.version,
        outputKind: resolved.outputKind,
        status: "planned"
      })
    );
    const workItem = withDatabase(workspacePath, (db) => getWorkItem(db, created.data.workItem.id));
    if (!workItem) {
      throw workItemNotFound(created.data.workItem.id);
    }

    return createSuccess({
      command: "ask",
      workspace: workspacePath,
      data: {
        ask,
        intake,
        resolvedIntent: resolved,
        result: {
          status: "acted",
          summary: `Created project ${created.data.project.name}.`
        },
        workItem,
        plan: null,
        approvalGates: [],
        codexInvocations: [],
        run: null,
        project: created.data.project,
        projectSummary: null,
        projects: null,
        status: null,
        review: null,
        reviewItemId: null,
        backBurnerItemId: null
      },
      artifacts: created.artifacts
    });
  }

  if (
    (intake.confidenceLabel === "high" || approvedFromReview) &&
    intake.action.kind === "update_entity_attribute" &&
    intake.action.entityType === "project" &&
    intake.action.entityId &&
    intake.action.attribute &&
    intake.action.value &&
    !intake.action.invalidReason
  ) {
    const action = intake.action;
    const { ask, project } = withDatabase(workspacePath, (db) => {
      const project = applyProjectAttributeUpdate(db, action);

      const ask = createAskRequest(db, {
        rawRequest: options.request,
        resolvedIntent: resolved.intentId,
        registryVersion: registries.intents.version,
        outputKind: resolved.outputKind,
        status: "planned"
      });
      return { ask, project };
    });

    return actedProjectUpdate({
      workspacePath,
      ask,
      intake,
      resolved,
      project,
      summary: `Updated ${renderResolvedAttribute(intake)} for ${project.name}.`
    });
  }

  if (
    (intake.confidenceLabel === "high" || approvedFromReview) &&
    intake.action.kind === "show_project" &&
    intake.action.projectId
  ) {
    const projectId = intake.action.projectId;
    const { ask, projectSummary } = withDatabase(workspacePath, (db) => {
      const projectSummary = listProjectSummaries(db).find((candidate) => candidate.id === projectId) ?? null;
      if (!projectSummary) {
        throw projectNotFound(projectId);
      }

      const ask = createAskRequest(db, {
        rawRequest: options.request,
        resolvedIntent: resolved.intentId,
        registryVersion: registries.intents.version,
        outputKind: resolved.outputKind,
        status: "planned"
      });
      return { ask, projectSummary };
    });

    return createSuccess({
      command: "ask",
      workspace: workspacePath,
      data: {
        ask,
        intake,
        resolvedIntent: resolved,
        result: { status: "acted", summary: `Shown project ${projectSummary.name}.` },
        workItem: null,
        plan: null,
        approvalGates: [],
        codexInvocations: [],
        run: null,
        project: null,
        projectSummary,
        projects: null,
        status: null,
        review: null,
        reviewItemId: null,
        backBurnerItemId: null
      }
    });
  }

  if ((intake.confidenceLabel === "high" || approvedFromReview) && intake.action.kind === "list_projects") {
    const { ask, projects } = withDatabase(workspacePath, (db) => {
      const ask = createAskRequest(db, {
        rawRequest: options.request,
        resolvedIntent: resolved.intentId,
        registryVersion: registries.intents.version,
        outputKind: resolved.outputKind,
        status: "planned"
      });
      return { ask, projects: listProjectSummaries(db) };
    });

    return createSuccess({
      command: "ask",
      workspace: workspacePath,
      data: {
        ask,
        intake,
        resolvedIntent: resolved,
        result: { status: "acted", summary: "Projects listed." },
        workItem: null,
        plan: null,
        approvalGates: [],
        codexInvocations: [],
        run: null,
        project: null,
        projectSummary: null,
        projects,
        status: null,
        review: null,
        reviewItemId: null,
        backBurnerItemId: null
      }
    });
  }

  if (shouldCaptureInBackBurner(intake) && !options.approvedReviewItemId) {
    const { ask, backBurnerItem } = withDatabase(workspacePath, (db) => {
      const ask = createAskRequest(db, {
        rawRequest: options.request,
        resolvedIntent: resolved.intentId,
        registryVersion: registries.intents.version,
        outputKind: "back_burner",
        status: "planned"
      });
      const backBurnerItem = createBackBurnerItem(db, {
        originalInput: intake.rawInput,
        ingressSource: options.sourceIngress ?? "cli.ask",
        classification: intake.classification,
        confidence: intake.confidence,
        reason: intake.classificationReason || intake.explanation,
        status: intake.classification === "Idea" ? "opportunistic" : "incubating",
        suggestedNextStep: intake.suggestedNextStep
      });
      return { ask, backBurnerItem };
    });

    return createSuccess({
      command: "ask",
      workspace: workspacePath,
      data: {
        ask,
        intake,
        resolvedIntent: resolved,
        result: {
          status: "captured",
          summary: "Captured in Back Burner."
        },
        workItem: null,
        plan: null,
        approvalGates: [],
        codexInvocations: [],
        run: null,
        project: null,
        projectSummary: null,
        projects: null,
        status: null,
        review: null,
        reviewItemId: null,
        backBurnerItemId: backBurnerItem.id
      }
    });
  }

  if (intake.reviewRequired && !options.approvedReviewItemId) {
    const { ask, reviewItem } = withDatabase(workspacePath, (db) => {
      const ask = createAskRequest(db, {
        rawRequest: options.request,
        resolvedIntent: resolved.intentId,
        registryVersion: registries.intents.version,
        outputKind: "requires_review",
        status: "needs_mark"
      });
      const reviewItem = createReviewItem(db, {
        askRequestId: ask.id,
        projectId: projectIdFromIntake(intake) ?? intake.project?.id ?? null,
        decisionNeeded: decisionNeededForIntake(intake),
        recommendation: recommendationForIntake(intake),
        sourceInput: intake.rawInput,
        proposedAction: intake.proposedAction,
        resolvedIntent: intake.resolvedIntent,
        confidenceLabel: intake.confidenceLabel,
        confidence: intake.confidence,
        missingFields: intake.missingFields,
        context: {
          extractedFields: intake.extractedFields,
          explanation: intake.explanation,
          action: intake.action,
          project: intake.project,
          template: intake.template
        }
      });
      return { ask, reviewItem };
    });

    return createSuccess({
      command: "ask",
      workspace: workspacePath,
      data: {
        ask,
        intake,
        resolvedIntent: resolved,
        result: {
          status: "requires_review",
          summary: "Requires Review item created."
        },
        workItem: null,
        plan: null,
        approvalGates: [],
        codexInvocations: [],
        run: null,
        project: null,
        projectSummary: null,
        projects: null,
        status: null,
        review: null,
        reviewItemId: reviewItem.id,
        backBurnerItemId: null
      }
    });
  }

  const initial = withDatabase(workspacePath, (db) => {
    ensureBuiltInSkills(db);
    const context = resolveAskContext(db, {
      ...options,
      project: projectIdFromIntake(intake) ?? options.project
    });
    const created = createWorkItemWithOptionalArtifact(db, {
      projectId: context.projectId,
      milestoneId: context.milestoneId,
      title: resolved.title,
      rawInput: options.request,
      queue: resolved.queue,
      workClassification: resolved.workClassification,
      nextAction: resolved.nextAction,
      expectedArtifact: resolved.expectedArtifact ?? undefined
    });
    const workItem = getWorkItem(db, created.workItem.id);
    if (!workItem) {
      throw workItemNotFound(created.workItem.id);
    }

    const plan = createExecutionPlan(db, {
      workItemId: workItem.id,
      summary: `Intent plan for "${workItem.title}" (${resolved.intentId}).`,
      steps: resolved.skillSequence
    });
    if (!plan) {
      throw workItemNotFound(workItem.id);
    }

    for (const gate of resolved.approvalGates) {
      createApprovalGate(db, {
        gateType: gate.gateType,
        reason: gate.reason,
        workItemId: workItem.id,
        planId: plan.id
      });
    }

    return { workItem, plan, projectContext: context.projectContext };
  });

  const codexPacket = resolved.codexPurpose
    ? createCodexPacket({
        workspace: workspacePath,
        request: options.request,
        resolved,
        workItem: initial.workItem,
        planId: initial.plan.id,
        projectContext: initial.projectContext,
        agentProfile: selectAgentProfile(registries.codingAgents.profiles, resolved.codexPurpose)
      })
    : null;

  const data = withDatabase(workspacePath, (db) => {
    if (codexPacket) {
      createCodexInvocation(db, {
        id: codexPacket.invocationId,
        purpose: codexPacket.purpose,
        agentProfile: codexPacket.agentProfile.name,
        workspaceScope: codexPacket.workspaceScope,
        command: codexPacket.command,
        promptPath: codexPacket.relativePromptPath,
        jsonlOutputPath: codexPacket.relativeJsonlOutputPath,
        finalMessagePath: codexPacket.relativeFinalMessagePath,
        status: "packet_created",
        workItemId: initial.workItem.id,
        planId: initial.plan.id
      });
      createArtifactRecord(db, {
        projectId: initial.workItem.project_id,
        workItemId: initial.workItem.id,
        title: `Codex ${codexPacket.purpose} packet: ${initial.workItem.title}`,
        artifactType: "codex_prompt_packet",
        status: "drafted",
        path: codexPacket.relativePromptPath
      });
    }

    const ask = createAskRequest(db, {
      rawRequest: options.request,
      resolvedIntent: resolved.intentId,
      registryVersion: registries.intents.version,
      outputKind: resolved.outputKind,
      workItemId: initial.workItem.id,
      planId: initial.plan.id,
      promptPacketPath: codexPacket?.relativePromptPath ?? null,
      status: resolved.workClassification === "needs_mark" ? "needs_mark" : "planned"
    });

    return {
      ask,
      workItem: getWorkItem(db, initial.workItem.id) as WorkItemSummary,
      plan: initial.plan,
      approvalGates: listApprovalGatesForWorkItem(db, initial.workItem.id),
      codexInvocations: listCodexInvocationsForWorkItem(db, initial.workItem.id)
    };
  });

  if (options.runSafe) {
    const result = withDatabase(workspacePath, (db) => executePlan(db, workspacePath, data.plan));
    run = result.run;
  }

  return createSuccess({
    command: "ask",
    workspace: workspacePath,
    data: {
      ask: data.ask,
      intake,
      resolvedIntent: resolved,
      result: {
        status: resolved.workClassification === "needs_mark" ? "requires_review" : "queued",
        summary: resolved.workClassification === "needs_mark" ? "Requires Review item created." : "Work item created."
      },
      workItem: data.workItem,
      plan: data.plan,
      approvalGates: data.approvalGates,
      codexInvocations: data.codexInvocations,
      run,
      project: null,
      projectSummary: null,
      projects: null,
      status: null,
      review: null,
      reviewItemId: null,
      backBurnerItemId: null
    },
    artifacts: [
      ...(codexPacket
        ? [
            codexPacket.promptPath,
            codexPacket.jsonlOutputPath,
            codexPacket.finalMessagePath,
            codexPacket.metadataPath
          ]
        : []),
      ...(run?.mission_log_path ? [path.join(workspacePath, run.mission_log_path)] : []),
      ...(run?.artifacts.flatMap((artifact) => artifact.path ? [path.join(workspacePath, artifact.path)] : []) ?? [])
    ]
  });
}

function actedProjectUpdate(input: {
  workspacePath: string;
  ask: AskRequestSummary;
  intake: IntakeResult;
  resolved: ResolvedIntent;
  project: Project;
  summary: string;
}): CommandSuccess<AskCommandData> {
  return createSuccess({
    command: "ask",
    workspace: input.workspacePath,
    data: {
      ask: input.ask,
      intake: input.intake,
      resolvedIntent: input.resolved,
      result: {
        status: "acted",
        summary: input.summary
      },
      workItem: null,
      plan: null,
      approvalGates: [],
      codexInvocations: [],
      run: null,
      project: input.project,
      projectSummary: null,
      projects: null,
      status: null,
      review: null,
      reviewItemId: null,
      backBurnerItemId: null
    }
  });
}

type UpdateEntityAttributeAction = Extract<IntakeResult["action"], { kind: "update_entity_attribute" }>;
type ProjectAttributeUpdateHandler = (
  db: Parameters<typeof getProject>[0],
  action: UpdateEntityAttributeAction
) => Project;

const PROJECT_ATTRIBUTE_UPDATE_HANDLERS: Record<IntakeProjectAttribute, ProjectAttributeUpdateHandler> = {
  goal: (db, action) => {
    const project = updateProject(db, requireEntityId(action), { goal: requireAttributeValue(action) });
    if (!project) {
      throw projectNotFound(requireEntityId(action));
    }
    return project;
  },
  mission: (db, action) => {
    const project = updateProject(db, requireEntityId(action), { mission: requireAttributeValue(action) });
    if (!project) {
      throw projectNotFound(requireEntityId(action));
    }
    return project;
  },
  status: (db, action) => {
    const project = updateProject(db, requireEntityId(action), { status: requireAttributeValue(action) as ProjectStatus });
    if (!project) {
      throw projectNotFound(requireEntityId(action));
    }
    return project;
  },
  current_milestone: (db, action) => {
    const projectId = requireEntityId(action);
    const project = getProject(db, projectId);
    if (!project) {
      throw projectNotFound(projectId);
    }

    const milestone = createMilestoneForProject(db, projectId, requireAttributeValue(action), "active");
    if (!milestone) {
      throw projectNotFound(projectId);
    }
    return project;
  },
  next_action: (db, action) => {
    const projectId = requireEntityId(action);
    const project = getProject(db, projectId);
    if (!project) {
      throw projectNotFound(projectId);
    }

    const target = listWorkItems(db).find((item) => item.project_id === projectId && item.status !== "done");
    if (!target) {
      throw validationError("Project has no open work item to hold next action.", { projectId });
    }

    const updated = updateWorkItem(db, target.id, { nextAction: requireAttributeValue(action) });
    if (!updated) {
      throw workItemNotFound(target.id);
    }
    return project;
  }
};

function applyProjectAttributeUpdate(
  db: Parameters<typeof getProject>[0],
  action: UpdateEntityAttributeAction
): Project {
  if (action.entityType !== "project") {
    throw validationError("Only project entity updates are supported.", { entityType: action.entityType });
  }

  if (!action.attribute) {
    throw validationError("Project attribute is required.");
  }

  const handler = PROJECT_ATTRIBUTE_UPDATE_HANDLERS[action.attribute];
  return handler(db, action);
}

function requireEntityId(action: UpdateEntityAttributeAction): string {
  if (!action.entityId) {
    throw validationError("Project is required.");
  }
  return action.entityId;
}

function requireAttributeValue(action: UpdateEntityAttributeAction): string {
  if (!action.value?.trim()) {
    throw validationError("Attribute value is required.");
  }
  return action.value;
}

export function renderAskSuccess(response: CommandSuccess<AskCommandData>): string[] {
  const lines = [
    `Ask: ${response.data.ask.id}`,
    `Interpreted as: ${response.data.intake.resolvedIntent}`,
    `Confidence: ${response.data.intake.confidenceLabel} (${response.data.intake.confidence.toFixed(2)})`,
    `Project: ${response.data.intake.project?.name ?? response.data.workItem?.project_name ?? response.data.project?.name ?? response.data.projectSummary?.name ?? "None"}`,
    `Attribute: ${renderResolvedAttribute(response.data.intake)}`,
    `Value: ${renderResolvedAttributeValue(response.data.intake)}`,
    `Goal: ${response.data.project?.goal ?? "None"}`,
    `Action: ${response.data.intake.proposedAction}`,
    `Result: ${response.data.result.summary}`
  ];

  if (response.data.workItem) {
    lines.push(`Work item: ${response.data.workItem.id}`);
    lines.push(`Plan: ${response.data.plan?.id ?? "None"}`);
    lines.push(`Queue: ${response.data.workItem.queue === "needs_mark" ? "requires_review" : response.data.workItem.queue}`);
    lines.push(`Work classification: ${labelWorkClassification(response.data.workItem.work_classification)}`);
  }

  if (response.data.reviewItemId) {
    lines.push(`Requires Review: ${response.data.reviewItemId}`);
  }

  if (response.data.backBurnerItemId) {
    lines.push(`Back Burner: ${response.data.backBurnerItemId}`);
  }

  if (response.data.projectSummary) {
    lines.push(`Status: ${response.data.projectSummary.status}`);
    lines.push(`Mission: ${response.data.projectSummary.mission}`);
    lines.push(`Current milestone: ${response.data.projectSummary.current_milestone ?? "None"}`);
    lines.push(`Next action: ${response.data.projectSummary.next_action ?? "None"}`);
  }

  if (response.data.projects) {
    lines.push(`Projects: ${response.data.projects.length}`);
    lines.push(...response.data.projects.map((project) => `- ${project.name} (${project.status})`));
  }

  lines.push(
    `Approval gates: ${response.data.approvalGates.length}`,
    `Codex packets: ${response.data.codexInvocations.length}`,
    `Run: ${response.data.run?.id ?? "Not run"}`
  );

  return lines;
}

export function buildIntakeContext(db: Parameters<typeof listProjects>[0]): IntakeWorkspaceContext {
  const projects: IntakeProjectContext[] = listProjects(db).map((project) => {
    const metadata = getProjectMetadata(db, project.id);
    const activeMilestone = getActiveMilestoneForProject(db, project.id);
    return {
      id: project.id,
      name: project.name,
      goal: project.goal,
      aliases: decodeStringArray(metadata?.aliases),
      activeMilestoneId: activeMilestone?.id ?? null,
      activeMilestoneTitle: activeMilestone?.title ?? null
    };
  });

  return { projects };
}

function resolvedIntentFromIntake(intake: IntakeResult, approvedFromReview = false): ResolvedIntent {
  if ((!approvedFromReview && intake.confidenceLabel !== "high") || intake.resolvedIntent === "CaptureThought") {
    return {
      intentId: intake.resolvedIntent,
      matched: false,
      title: `Requires Review: ${titleFromRequest(intake.rawInput)}`,
      outputKind: "requires_review",
      queue: "needs_mark",
      workClassification: "needs_mark",
      nextAction: reviewNextAction(intake),
      expectedArtifact: "Clarified Arcadia request",
      skillSequence: [
        {
          skillName: "needs_mark_decision",
          title: "Review intake interpretation",
          command: null,
          executorType: "mark",
          safeToRun: false,
          needsMark: reviewNextAction(intake)
        }
      ],
      approvalGates: [],
      templates: [],
      slots: intake.extractedFields,
      codexPurpose: null
    };
  }

  if (intake.action.kind === "instantiate_project") {
    const templateName = intake.action.template?.name ?? intake.extractedFields.template ?? "templated project";
    const projectName = intake.action.projectName ?? "Untitled project";
    return {
      intentId: intake.resolvedIntent,
      matched: true,
      title: `Create ${templateName}: ${projectName}`,
      outputKind: "codex_build_packet",
      queue: "work_queue",
      workClassification: intake.action.template?.workClassification ?? "codex",
      nextAction: `Review the ${templateName} build packet and approve Codex build if appropriate.`,
      expectedArtifact: intake.action.template?.expectedArtifact ?? "Templated project Codex build packet",
      skillSequence: [
        {
          skillName: "codex_build",
          title: `Prepare Codex build packet for ${templateName}`,
          command: null,
          executorType: "codex_build",
          safeToRun: false,
          needsMark: "Codex build requires explicit review before repository changes."
        }
      ],
      approvalGates: approvalGatesForIntake(intake).map((gateType) => ({
        gateType,
        reason: reasonForGate(gateType)
      })),
      templates: [],
      slots: intake.extractedFields,
      codexPurpose: "build"
    };
  }

  if (intake.action.kind === "create_project") {
    const projectName = intake.action.projectName ?? "Untitled project";
    return {
      intentId: intake.resolvedIntent,
      matched: true,
      title: `Create project: ${projectName}`,
      outputKind: "project_created",
      queue: "work_queue",
      workClassification: "autonomous",
      nextAction: `Clarify the project mission and first concrete next action for ${projectName}.`,
      expectedArtifact: "Arcadia project record",
      skillSequence: [],
      approvalGates: [],
      templates: [],
      slots: intake.extractedFields,
      codexPurpose: null
    };
  }

  if (intake.action.kind === "create_work") {
    return {
      intentId: intake.resolvedIntent,
      matched: true,
      title: intake.action.title,
      outputKind: "codex_build_packet",
      queue: "work_queue",
      workClassification: intake.action.workClassification,
      nextAction: `Review the Codex build packet for: ${intake.action.title}.`,
      expectedArtifact: "Codex build packet",
      skillSequence: [
        {
          skillName: "codex_build",
          title: "Prepare Codex build packet",
          command: null,
          executorType: "codex_build",
          safeToRun: false,
          needsMark: "Codex build requires explicit review before repository changes."
        }
      ],
      approvalGates: approvalGatesForIntake(intake).map((gateType) => ({
        gateType,
        reason: reasonForGate(gateType)
      })),
      templates: [],
      slots: intake.extractedFields,
      codexPurpose: "build"
    };
  }

  return {
    intentId: intake.resolvedIntent,
    matched: true,
    title: titleFromRequest(intake.rawInput),
    outputKind: outputKindForIntake(intake),
    queue: "work_queue",
    workClassification: "autonomous",
    nextAction: intake.proposedAction,
    expectedArtifact: null,
    skillSequence: [],
    approvalGates: [],
    templates: [],
    slots: intake.extractedFields,
    codexPurpose: null
  };
}

function decisionNeededForIntake(intake: IntakeResult): string {
  if (intake.missingFields.length > 0) {
    if (intake.missingFields.includes("project")) {
      return "Requires Review: project ambiguous or missing.";
    }

    if (intake.missingFields.includes("attribute")) {
      return "Requires Review: attribute ambiguous or missing.";
    }

    if (intake.action.kind === "update_entity_attribute" && intake.action.invalidReason) {
      return `Requires Review: invalid attribute value (${intake.action.invalidReason}).`;
    }

    if (intake.missingFields.includes("attributeValue")) {
      return "Requires Review: missing attribute value.";
    }

    return `Confirm missing fields: ${intake.missingFields.join(", ")}.`;
  }

  if (!intake.safeToExecute) {
    return `Approve or reject this proposed Arcadia action: ${intake.proposedAction}`;
  }

  return reviewNextAction(intake);
}

function shouldCaptureInBackBurner(intake: IntakeResult): boolean {
  if (intake.action.kind === "capture_thought") {
    return true;
  }

  if (["ArcadiaFeedback", "BugReport", "Idea", "Question", "IncubatingThought"].includes(intake.classification)) {
    return !hasConcreteReviewDecision(intake);
  }

  return false;
}

function explicitReviewSlugFromInput(value: string): string | null {
  const match = /^\s*(R\d+)\b/i.exec(value);
  return match?.[1]?.toUpperCase() ?? null;
}

function hasConcreteReviewDecision(intake: IntakeResult): boolean {
  if (!intake.reviewRequired) {
    return false;
  }

  const concreteMissingFields = new Set(["project", "attribute", "attributeValue", "template", "projectName"]);
  if (intake.missingFields.some((field) => concreteMissingFields.has(field))) {
    return true;
  }

  return !intake.safeToExecute && intake.action.kind !== "capture_thought";
}

function renderResolvedAttribute(intake: IntakeResult): string {
  if (intake.action.kind === "update_entity_attribute") {
    return intake.action.attributeName ?? intake.extractedFields.attribute ?? "None";
  }

  return "None";
}

function renderResolvedAttributeValue(intake: IntakeResult): string {
  if (intake.action.kind === "update_entity_attribute") {
    return intake.action.value ?? "None";
  }

  return "None";
}

function recommendationForIntake(intake: IntakeResult): string {
  if (intake.confidenceLabel === "low") {
    return "Defer or clarify before creating work.";
  }

  if (intake.missingFields.length > 0) {
    return "Provide the missing fields, then approve only if the proposed action is correct.";
  }

  if (!intake.safeToExecute) {
    return "Approve only if the project, goal, and action match your intent.";
  }

  return "Review the proposed action before execution.";
}

function projectIdFromIntake(intake: IntakeResult): string | null {
  switch (intake.action.kind) {
    case "create_work":
      return intake.action.projectId;
    case "update_entity_attribute":
      return intake.action.entityId;
    case "show_project":
      return intake.action.projectId;
    default:
      return null;
  }
}

function outputKindForIntake(intake: IntakeResult): string {
  switch (intake.resolvedIntent) {
    case "ShowStatus":
      return "status_summary";
    case "ReviewRequired":
      return "review_packets";
    case "ShowProject":
      return "project_summary";
    case "ListProjects":
      return "project_list";
    case "UpdateEntityAttribute":
      return "project_update";
    default:
      return "intake_result";
  }
}

function approvalGatesForIntake(intake: IntakeResult): ResolvedIntent["approvalGates"][number]["gateType"][] {
  const normalized = intake.rawInput.toLowerCase();
  const gates = new Set<ResolvedIntent["approvalGates"][number]["gateType"]>();

  if (intake.action.kind === "instantiate_project") {
    gates.add("destructive_filesystem_changes");
    if (/astro|blog|site|next|website|web app|serverless|api/.test(normalized)) {
      gates.add("external_deployment");
    }
  }

  if (intake.action.kind === "create_work") {
    gates.add("destructive_filesystem_changes");
    if (/pinterest|social|post|publish/.test(normalized)) {
      gates.add("credentials_required");
      gates.add("publication");
      gates.add("send_email_or_messages");
    }
  }

  return [...gates];
}

function reasonForGate(gateType: ResolvedIntent["approvalGates"][number]["gateType"]): string {
  switch (gateType) {
    case "credentials_required":
      return "Credentials are required before this work can access external services.";
    case "external_deployment":
      return "External deployment requires explicit approval.";
    case "publication":
      return "Publication requires explicit approval.";
    case "destructive_filesystem_changes":
      return "Repository or filesystem changes require explicit review.";
    case "production_data_access":
      return "Production data access requires explicit approval.";
    case "financial_action":
      return "Financial actions require explicit approval.";
    case "merge_to_main":
      return "Merging to main requires explicit approval.";
    case "send_email_or_messages":
      return "Sending email or messages requires explicit approval.";
  }
}

function reviewNextAction(intake: IntakeResult): string {
  if (intake.missingFields.length > 0) {
    return `Clarify missing intake fields: ${intake.missingFields.join(", ")}.`;
  }

  return "Clarify the desired Arcadia action before execution.";
}

function titleFromRequest(request: string): string {
  return request.trim().split(/\r?\n/)[0]?.trim().slice(0, 120) || "Natural language request";
}

function decodeStringArray(raw: string | null | undefined): string[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function labelWorkClassification(value: string): string {
  return value === "needs_mark" ? "Requires Review" : value;
}

interface ResolvedAskContext {
  projectId: string | null;
  milestoneId: string | null;
  projectContext: ProjectContext | null;
}

function resolveAskContext(db: Parameters<typeof getProject>[0], options: AskOptions): ResolvedAskContext {
  let projectId = options.project ?? null;
  let milestoneId = options.milestone ?? null;

  if (projectId && !getProject(db, projectId)) {
    throw projectNotFound(projectId);
  }

  if (milestoneId) {
    const milestone = getMilestone(db, milestoneId);
    if (!milestone) {
      throw milestoneNotFound(milestoneId);
    }

    if (projectId && milestone.project_id !== projectId) {
      throw milestoneNotFound(milestoneId);
    }

    projectId ??= milestone.project_id;
  }

  if (!projectId) {
    const resolvedProject = resolveProjectContextFromRequest(db, options.request);
    const defaultProject = resolvedProject ?? resolveOnlyActiveProjectContext(db);
    projectId = defaultProject?.project.id ?? null;
    milestoneId ??= defaultProject?.activeMilestone?.id ?? null;
    return {
      projectId,
      milestoneId,
      projectContext: defaultProject
    };
  }

  milestoneId ??= getActiveMilestoneForProject(db, projectId)?.id ?? null;
  const projectContext = getProjectContext(db, projectId);
  if (!projectContext) {
    throw validationError("Project context could not be resolved.", { projectId });
  }

  return {
    projectId,
    milestoneId,
    projectContext
  };
}

function resolveOnlyActiveProjectContext(db: Parameters<typeof getProject>[0]): ProjectContext | null {
  const activeProjects = listProjects(db).filter((project) => project.status === "active");
  if (activeProjects.length !== 1) {
    return null;
  }

  return getProjectContext(db, activeProjects[0].id);
}
