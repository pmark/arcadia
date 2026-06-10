import path from "node:path";
import { createCodexPacket, selectAgentProfile } from "../codex/packets.js";
import { milestoneNotFound, projectNotFound, workItemNotFound } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import {
  createApprovalGate,
  createArtifactRecord,
  createAskRequest,
  createCodexInvocation,
  createExecutionPlan,
  createWorkItemWithOptionalArtifact,
  getMilestone,
  getProject,
  getWorkItem,
  listApprovalGatesForWorkItem,
  listCodexInvocationsForWorkItem
} from "../db/repositories.js";
import type {
  ApprovalGate,
  AskRequestSummary,
  CodexInvocation,
  ExecutionPlanSummary,
  ExecutionRunSummary,
  WorkItemSummary
} from "../domain/types.js";
import { ensureBuiltInSkills } from "../execution/skills.js";
import { executePlan } from "../execution/runner.js";
import { loadPhase3Registries, validatePhase3Registries } from "../intent/registries.js";
import type { ResolvedIntent } from "../intent/resolver.js";
import { resolveIntent } from "../intent/resolver.js";

export interface AskOptions {
  workspace: string;
  request: string;
  project?: string;
  milestone?: string;
  runSafe?: boolean;
}

export interface AskCommandData {
  ask: AskRequestSummary;
  resolvedIntent: ResolvedIntent;
  workItem: WorkItemSummary;
  plan: ExecutionPlanSummary;
  approvalGates: ApprovalGate[];
  codexInvocations: CodexInvocation[];
  run: ExecutionRunSummary | null;
}

export function runAskCommand(options: AskOptions): CommandSuccess<AskCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const registries = loadPhase3Registries(workspacePath);
  validatePhase3Registries(registries);
  const resolved = resolveIntent(options.request, registries);
  let run: ExecutionRunSummary | null = null;

  const initial = withDatabase(workspacePath, (db) => {
    ensureBuiltInSkills(db);
    validateContext(db, options);
    const created = createWorkItemWithOptionalArtifact(db, {
      projectId: options.project ?? null,
      milestoneId: options.milestone ?? null,
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

    return { workItem, plan };
  });

  const codexPacket = resolved.codexPurpose
    ? createCodexPacket({
        workspace: workspacePath,
        request: options.request,
        resolved,
        workItem: initial.workItem,
        planId: initial.plan.id,
        agentProfile: selectAgentProfile(registries.codingAgents.profiles, resolved.codexPurpose)
      })
    : null;

  const data = withDatabase(workspacePath, (db) => {
    if (codexPacket) {
      createCodexInvocation(db, {
        id: codexPacket.invocationId,
        purpose: codexPacket.purpose,
        agentProfile: codexPacket.agentProfile.name,
        workspaceScope: workspacePath,
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
      resolvedIntent: resolved,
      workItem: data.workItem,
      plan: data.plan,
      approvalGates: data.approvalGates,
      codexInvocations: data.codexInvocations,
      run
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

export function renderAskSuccess(response: CommandSuccess<AskCommandData>): string[] {
  return [
    `Ask: ${response.data.ask.id}`,
    `Intent: ${response.data.resolvedIntent.intentId}${response.data.resolvedIntent.matched ? "" : " (fallback)"}`,
    `Work item: ${response.data.workItem.id}`,
    `Plan: ${response.data.plan.id}`,
    `Queue: ${response.data.workItem.queue}`,
    `Work classification: ${response.data.workItem.work_classification}`,
    `Approval gates: ${response.data.approvalGates.length}`,
    `Codex packets: ${response.data.codexInvocations.length}`,
    `Run: ${response.data.run?.id ?? "Not run"}`
  ];
}

function validateContext(db: Parameters<typeof getProject>[0], options: AskOptions): void {
  if (options.project && !getProject(db, options.project)) {
    throw projectNotFound(options.project);
  }

  if (options.milestone) {
    const milestone = getMilestone(db, options.milestone);
    if (!milestone) {
      throw milestoneNotFound(options.milestone);
    }

    if (options.project && milestone.project_id !== options.project) {
      throw milestoneNotFound(options.milestone);
    }
  }
}
