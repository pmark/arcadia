import type Database from "better-sqlite3";
import type { CodexPacket } from "../codex/packets.js";
import {
  createArtifactRecord,
  createCodexInvocation,
  createReviewItem,
  updateWorkItem
} from "../db/repositories.js";
import type {
  Artifact,
  CodexInvocation,
  ExecutionPlanSummary,
  ReviewItemSummary,
  WorkItemSummary
} from "../domain/types.js";
import { packetSha256 } from "./planningAuthorization.js";

export const PLANNING_SAFETY_BOUNDARIES = [
  "No implementation or repository writes",
  "No publishing",
  "No deployment",
  "No credential use",
  "No spending",
  "No messaging",
  "No merging",
  "No destructive actions"
] as const;

export interface PersistedCodexPacket {
  invocation: CodexInvocation;
  packetArtifact: Artifact;
  critiqueArtifact: Artifact;
}

export function persistCodexPacketRecords(
  db: Database.Database,
  input: {
    packet: CodexPacket;
    workItem: WorkItemSummary;
    plan: ExecutionPlanSummary;
    planStepId?: string | null;
  }
): PersistedCodexPacket {
  const invocation = createCodexInvocation(db, {
    id: input.packet.invocationId,
    purpose: input.packet.purpose,
    agentProfile: input.packet.agentProfile.name,
    workspaceScope: input.packet.workspaceScope,
    command: input.packet.command,
    promptPath: input.packet.relativePromptPath,
    jsonlOutputPath: input.packet.relativeJsonlOutputPath,
    finalMessagePath: input.packet.relativeFinalMessagePath,
    status: "packet_created",
    workItemId: input.workItem.id,
    planId: input.plan.id,
    planStepId: input.planStepId ?? null
  });
  const packetArtifact = createArtifactRecord(db, {
    projectId: input.workItem.project_id,
    workItemId: input.workItem.id,
    title: `Codex ${input.packet.purpose} packet: ${input.workItem.title}`,
    artifactType: "codex_prompt_packet",
    status: "drafted",
    path: input.packet.relativePromptPath
  });
  const critiqueArtifact = createArtifactRecord(db, {
    projectId: input.workItem.project_id,
    workItemId: input.workItem.id,
    title: `Stewardship critique: ${input.workItem.title}`,
    artifactType: "stewardship_critique",
    status: input.packet.critique.status === "approved" ? "ready" : "drafted",
    path: input.packet.relativeCritiquePath
  });
  return { invocation, packetArtifact, critiqueArtifact };
}

export function createPlanningApprovalDecision(
  db: Database.Database,
  input: {
    workItem: WorkItemSummary;
    plan: ExecutionPlanSummary;
    packet: CodexPacket;
    packetArtifact: Artifact;
    sourceInput: string;
    proposedAction: string;
    expectedArtifact: string;
    askRequestId?: string | null;
    existingAction?: boolean;
  }
): ReviewItemSummary {
  const existingAction = input.existingAction === true;
  const decision = createReviewItem(db, {
    askRequestId: input.askRequestId ?? null,
    workItemId: input.workItem.id,
    planId: input.plan.id,
    projectId: input.workItem.project_id,
    artifactId: input.packetArtifact.id,
    codexInvocationId: input.packet.invocationId,
    decisionNeeded: existingAction
      ? `Approve the exact planning packet for existing Action "${input.workItem.title}".`
      : `Approve the exact planning packet for "${input.workItem.title}".`,
    recommendation: existingAction
      ? "Approval authorizes one managed read-only planning Run. It does not authorize implementation or any prohibited external action."
      : "Inspect the packet, then approve and queue one managed planning Run.",
    sourceInput: input.sourceInput,
    proposedAction: input.proposedAction,
    resolvedIntent: "CodexPlanningRunApproval",
    confidenceLabel: "high",
    confidence: 1,
    missingFields: [],
    context: {
      schemaVersion: 1,
      packetSha256: packetSha256(input.packet.promptPath),
      interpretation: input.proposedAction,
      expectedArtifact: input.expectedArtifact,
      originatingActionId: input.workItem.id,
      approvalAuthorizes: "One managed read-only Codex planning Run for this exact packet.",
      preparationSource: existingAction ? "existing_action" : "ask",
      safetyBoundaries: [...PLANNING_SAFETY_BOUNDARIES],
      responsibility: "needs_mark"
    }
  });
  updateWorkItem(db, input.workItem.id, {
    queue: "needs_mark",
    workClassification: "needs_mark",
    status: "open",
    nextAction: "Review the planning packet and approve, reject, or defer its Decision."
  });
  return decision;
}
