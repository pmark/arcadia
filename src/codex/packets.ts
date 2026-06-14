import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CodexInvocationPurpose } from "../domain/constants.js";
import type { ProjectContext, WorkItemSummary } from "../domain/types.js";
import type { CodingAgentProfile, TemplateDefinition } from "../intent/registries.js";
import type { ResolvedIntent } from "../intent/resolver.js";
import {
  createStewardshipCritic,
  renderCritiqueMarkdown,
  type StewardshipCritiqueResult
} from "../stewardship/critic.js";
import type { GoalStewardshipResult } from "../stewardship/index.js";
import { createId } from "../utils/id.js";
import { nowIso } from "../utils/time.js";
import { getWorkspacePaths, toWorkspaceRelativePath } from "../workspace/paths.js";

export interface CodexPacket {
  invocationId: string;
  purpose: CodexInvocationPurpose;
  agentProfile: CodingAgentProfile;
  command: string;
  workspaceScope: string;
  promptPath: string;
  jsonlOutputPath: string;
  finalMessagePath: string;
  metadataPath: string;
  critiquePath: string;
  relativePromptPath: string;
  relativeJsonlOutputPath: string;
  relativeFinalMessagePath: string;
  relativeCritiquePath: string;
  critique: StewardshipCritiqueResult;
}

export function createCodexPacket(input: {
  workspace: string;
  request: string;
  resolved: ResolvedIntent;
  workItem: WorkItemSummary;
  planId: string;
  projectContext: ProjectContext | null;
  agentProfile: CodingAgentProfile;
  stewardship?: GoalStewardshipResult | null;
}): CodexPacket {
  const invocationId = createId("codexInvocation");
  const packetDir = path.join(input.workspace, "prompts", "codex", invocationId);
  mkdirSync(packetDir, { recursive: true });

  const promptPath = path.join(packetDir, "prompt.md");
  const jsonlOutputPath = path.join(packetDir, "output.jsonl");
  const finalMessagePath = path.join(packetDir, "final.md");
  const metadataPath = path.join(packetDir, "metadata.json");
  const critiquePath = path.join(packetDir, "critique.md");
  const workspaceScope = input.projectContext?.metadata?.repo_path ?? input.workspace;
  const command = buildCommand(input.agentProfile, workspaceScope, finalMessagePath);
  const promptText = renderPrompt(input);
  const stewardship = input.stewardship ?? defaultStewardshipForPacket(input);
  const validationCommands = decodeStringArray(input.projectContext?.metadata?.validation_commands);
  const critique = createStewardshipCritic("deterministic_critic").critique({
    targetKind: input.agentProfile.purpose === "build" ? "codex_build_packet" : "codex_planning_packet",
    originalInput: input.request,
    artifactText: promptText,
    goalText: stewardship.generatedCodexGoalText ?? goalFromResolved(input),
    acceptanceCriteria: renderAcceptanceCriteria(input, stewardship),
    expectedArtifact: input.resolved.expectedArtifact ?? input.workItem.expected_artifact,
    executionPath: stewardship.recommendedExecutionPath,
    rationale: stewardship.classificationReason,
    confidenceLabel: confidenceFromResolved(input.resolved.matched),
    clarificationRequired: stewardship.clarificationRequired,
    reviewRequired: stewardship.reviewRequired,
    projectName: input.projectContext?.project.name ?? input.workItem.project_name,
    platformName: input.resolved.slots.platform,
    approvalBoundaries: [
      "Do not publish, deploy, merge, delete, spend money, use credentials, access production data, or send messages.",
      "Treat approval gates as hard stops; credential access, publication, and social posting/messaging require explicit approval before use."
    ],
    validationCommands,
    metadata: {
      expectedArtifact: input.resolved.expectedArtifact ?? input.workItem.expected_artifact ?? null,
      slots: input.resolved.slots,
      project: input.projectContext
        ? {
            name: input.projectContext.project.name,
            mission: input.projectContext.project.mission,
            status: input.projectContext.project.status,
            repoPath: input.projectContext.metadata?.repo_path ?? null
          }
        : null
    },
    stewardship,
    purpose: input.agentProfile.purpose
  });

  writeFileSync(promptPath, promptText, "utf8");
  writeFileSync(jsonlOutputPath, "", "utf8");
  writeFileSync(finalMessagePath, "Codex has not been invoked yet.\n", "utf8");
  writeFileSync(critiquePath, `${renderCritiqueMarkdown(critique)}\n`, "utf8");
  writeFileSync(
    metadataPath,
    `${JSON.stringify(
      {
        invocationId,
        createdAt: nowIso(),
        purpose: input.agentProfile.purpose,
        agentProfile: input.agentProfile.name,
        command,
        workspaceScope,
        workItemId: input.workItem.id,
        planId: input.planId,
        project: input.projectContext
          ? {
              id: input.projectContext.project.id,
              name: input.projectContext.project.name,
              status: input.projectContext.project.status,
              goal: input.projectContext.project.goal,
              repoPath: input.projectContext.metadata?.repo_path ?? null,
              activeMilestone: input.projectContext.activeMilestone
                ? {
                    id: input.projectContext.activeMilestone.id,
                    title: input.projectContext.activeMilestone.title
                  }
                : null
            }
          : null,
        resolvedIntent: input.resolved.intentId,
        outputKind: input.resolved.outputKind,
        stewardship: input.stewardship ?? null,
        critique,
        promptPath: toWorkspaceRelativePath(input.workspace, promptPath),
        jsonlOutputPath: toWorkspaceRelativePath(input.workspace, jsonlOutputPath),
        finalMessagePath: toWorkspaceRelativePath(input.workspace, finalMessagePath),
        critiquePath: toWorkspaceRelativePath(input.workspace, critiquePath)
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  return {
    invocationId,
    purpose: input.agentProfile.purpose,
    agentProfile: input.agentProfile,
    command,
    workspaceScope,
    promptPath,
    jsonlOutputPath,
    finalMessagePath,
    metadataPath,
    critiquePath,
    relativePromptPath: toWorkspaceRelativePath(input.workspace, promptPath),
    relativeJsonlOutputPath: toWorkspaceRelativePath(input.workspace, jsonlOutputPath),
    relativeFinalMessagePath: toWorkspaceRelativePath(input.workspace, finalMessagePath),
    relativeCritiquePath: toWorkspaceRelativePath(input.workspace, critiquePath),
    critique
  };
}

export function selectAgentProfile(
  profiles: CodingAgentProfile[],
  purpose: CodexInvocationPurpose
): CodingAgentProfile {
  const profile = profiles.find((candidate) => candidate.purpose === purpose);
  if (!profile) {
    throw new Error(`Coding agent profile is required for purpose: ${purpose}`);
  }

  return profile;
}

function buildCommand(profile: CodingAgentProfile, workspaceScope: string, finalMessagePath: string): string {
  const args = [
    ...profile.args,
    "--cd",
    workspaceScope,
    "--output-last-message",
    finalMessagePath,
    "-"
  ];
  return [profile.command, ...args].join(" ");
}

function renderPrompt(input: {
  workspace: string;
  request: string;
  resolved: ResolvedIntent;
  workItem: WorkItemSummary;
  planId: string;
  projectContext: ProjectContext | null;
  agentProfile: CodingAgentProfile;
  stewardship?: GoalStewardshipResult | null;
}): string {
  const stewardship = input.stewardship ?? defaultStewardshipForPacket(input);
  const templates = input.resolved.templates.map(renderTemplate).join("\n\n") || "None";
  const gates = input.resolved.approvalGates
    .map((gate) => `- ${gate.gateType}: ${gate.reason}`)
    .join("\n") || "None";
  const slots = Object.entries(input.resolved.slots)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join("\n") || "None";
  const projectContext = renderProjectContext(input.projectContext, input.workItem);
  const milestoneContext = renderCurrentMilestone(input.projectContext, input.workItem);
  const pathContext = renderPathContext(input.projectContext, input.workspace);
  const operatorContext = readOperatorContext(input.workspace);
  const validationGuidance = renderValidationGuidance(input.projectContext);
  const executionInstruction = renderExecutionInstruction(input.agentProfile.purpose, stewardship);

  return `# Arcadia Codex ${input.agentProfile.purpose === "build" ? "Build" : "Planning"} Packet

## Goal
${stewardship.generatedCodexGoalText ?? goalFromResolved(input)}

## Why This Matters
${whyThisMatters(stewardship, input.projectContext)}

## Original Input
${input.request}

## Stewardship Decision
- Intent type: ${stewardship.intentType}
- Execution path: ${stewardship.recommendedExecutionPath}
- Planning recommended: ${stewardship.planningRecommended ? "yes" : "no"}
- Clarification required: ${stewardship.clarificationRequired ? "yes" : "no"}
- Review required: ${stewardship.reviewRequired ? "yes" : "no"}
- Why: ${stewardship.classificationReason}

## Resolved Intent
- Intent: ${input.resolved.intentId}
- Output kind: ${input.resolved.outputKind}
- Work item: ${input.workItem.id}
- Plan: ${input.planId}
- Work classification: ${input.workItem.work_classification}

## Target Project Context
${projectContext}

## Current Milestone
${milestoneContext}

## Repository / Path Context
${pathContext}

## Operator Context
${operatorContext}

## Slots
${slots}

## Templates
${templates}

## Constraints
- Preserve the existing architecture and local project conventions.
- Prefer deterministic local scripts and existing tooling before adding new automation.
- Keep the change scoped to the stated goal and expected artifact.
- Use the selected repository or workspace scope only.

## Acceptance Criteria
${renderAcceptanceCriteria(input, stewardship)}

## Approval Boundaries
- Do not publish, deploy, merge, delete, spend money, use credentials, access production data, or send messages.
- Treat approval gates as hard stops; credential access, publication, and social posting/messaging require explicit approval before use.
- If a boundary is needed to complete the goal, stop and report the exact approval needed.

## Approval Gates
${gates}

## Expected Artifact
${input.resolved.expectedArtifact ?? input.workItem.expected_artifact ?? "Clear implementation or planning artifact"}

## Execution Instruction
${executionInstruction}

## Discovery And Validation
- Start by inspecting the target repository/project context above.
- Prefer deterministic local scripts and existing project conventions before adding new tooling.
${validationGuidance}
- Report changed files, validation commands run, and any commands that could not be run.

## Final Reporting Requirements
- Summarize project, milestone, and repository scope.
- Summarize implementation or planning outcome.
- List validation results.
- Identify remaining approval gates or blockers.
`;
}

function renderProjectContext(projectContext: ProjectContext | null, workItem: WorkItemSummary): string {
  if (!projectContext) {
    return [
      "- Project: Unresolved",
      `- Work item project: ${workItem.project_id ?? "None"}`,
      `- Milestone: ${workItem.milestone_title ?? "None"}`,
      "- Repository: Workspace scope"
    ].join("\n");
  }

  const metadata = projectContext.metadata;
  const validationCommands = decodeStringArray(metadata?.validation_commands);
  return [
    `- Project: ${projectContext.project.name} (${projectContext.project.id})`,
    `- Project status: ${projectContext.project.status}`,
    `- Mission: ${projectContext.project.mission}`,
    `- Goal: ${projectContext.project.goal ?? "None"}`,
    `- Active milestone: ${projectContext.activeMilestone?.title ?? "None"} (${projectContext.activeMilestone?.id ?? "none"})`,
    `- Work item milestone: ${workItem.milestone_title ?? "None"} (${workItem.milestone_id ?? "none"})`,
    `- Target repository: ${metadata?.repo_path ?? "Workspace scope"}`,
    `- Project status summary: ${metadata?.status_summary ?? "None"}`,
    `- Validation commands: ${validationCommands.length > 0 ? validationCommands.join(" && ") : "Use existing project validation scripts"}`
  ].join("\n");
}

function renderCurrentMilestone(projectContext: ProjectContext | null, workItem: WorkItemSummary): string {
  if (projectContext?.activeMilestone) {
    return [
      `- Active milestone: ${projectContext.activeMilestone.title} (${projectContext.activeMilestone.id})`,
      `- Work item milestone: ${workItem.milestone_title ?? "None"} (${workItem.milestone_id ?? "none"})`
    ].join("\n");
  }

  return `- Current milestone: ${workItem.milestone_title ?? "Unknown"} (${workItem.milestone_id ?? "none"})`;
}

function renderPathContext(projectContext: ProjectContext | null, workspace: string): string {
  const validationCommands = decodeStringArray(projectContext?.metadata?.validation_commands);
  return [
    `- Workspace: ${workspace}`,
    `- Target repository/path: ${projectContext?.metadata?.repo_path ?? "Workspace scope"}`,
    `- Validation commands: ${validationCommands.length > 0 ? validationCommands.join(" && ") : "Use existing project validation scripts"}`
  ].join("\n");
}

function readOperatorContext(workspace: string): string {
  const operatorContext = getWorkspacePaths(workspace).operatorContext;
  if (existsSync(operatorContext)) {
    return readFileSync(operatorContext, "utf8").trim();
  }

  return [
    "- Stable value: maintain momentum across creative and software projects with low cognitive overhead.",
    "- Execution preference: deterministic local scripts first, local automation second, Codex only for code changes or reviewable plans.",
    "- Approval boundaries: do not publish, deploy, merge, delete, spend money, use credentials, access production data, or send messages without explicit approval.",
    "- Reporting preference: identify current milestone, next action, work classification, and required artifact."
  ].join("\n");
}

function renderAcceptanceCriteria(input: {
  resolved: ResolvedIntent;
  workItem: WorkItemSummary;
  projectContext: ProjectContext | null;
  agentProfile: CodingAgentProfile;
}, stewardship: GoalStewardshipResult): string {
  const artifact = input.resolved.expectedArtifact ?? input.workItem.expected_artifact ?? "requested artifact";
  const project = input.projectContext?.project.name ?? input.workItem.project_name ?? "the selected project";
  const projectGoal = input.projectContext?.project.goal ? ` goal: ${trimTerminalPunctuation(input.projectContext.project.goal)}` : "";
  const criteria = [
    `- Deliver the expected artifact: ${trimTerminalPunctuation(artifact)}.`,
    `- Keep the work aligned with ${project}${projectGoal}.`,
    "- Preserve existing behavior outside the requested scope.",
    "- Run relevant local validation or explain why validation could not run."
  ];

  if (stewardship.planningRecommended || input.agentProfile.purpose === "planning") {
    criteria.push("- Produce a concrete plan with ordered steps, risks, open questions, and recommended next action before implementation.");
  } else {
    criteria.push("- Execute directly within the approval boundaries and report changed files plus validation results.");
  }

  return criteria.join("\n");
}

function renderExecutionInstruction(
  purpose: CodexInvocationPurpose,
  stewardship: GoalStewardshipResult
): string {
  if (stewardship.planningRecommended || purpose === "planning") {
    return "Plan first. Do not make implementation changes until the plan, risks, approval boundaries, and expected artifact are clear.";
  }

  return "Execute directly after local inspection. Stay inside the approval boundaries and stop if the work requires a blocked action.";
}

function whyThisMatters(stewardship: GoalStewardshipResult, projectContext: ProjectContext | null): string {
  if (projectContext?.project.goal) {
    return `This advances ${projectContext.project.name} toward its goal: ${projectContext.project.goal}.`;
  }

  if (stewardship.relatedProject && stewardship.relatedGoal) {
    return `This advances ${stewardship.relatedProject.name} toward its goal: ${stewardship.relatedGoal}.`;
  }

  return "This turns the operator's input into visible progress while preserving local-first, reviewable execution.";
}

function goalFromResolved(input: {
  resolved: ResolvedIntent;
  workItem: WorkItemSummary;
  projectContext: ProjectContext | null;
}): string {
  const project = input.projectContext?.project.name ?? input.workItem.project_name ?? "the selected project";
  return `${input.resolved.title} for ${project}.`;
}

function defaultStewardshipForPacket(input: {
  request: string;
  resolved: ResolvedIntent;
  workItem: WorkItemSummary;
  projectContext: ProjectContext | null;
  agentProfile: CodingAgentProfile;
}): GoalStewardshipResult {
  const planning = input.agentProfile.purpose === "planning";
  const relatedProject = input.projectContext
    ? { id: input.projectContext.project.id, name: input.projectContext.project.name }
    : input.workItem.project_id && input.workItem.project_name
      ? { id: input.workItem.project_id, name: input.workItem.project_name }
      : null;

  return {
    originalInput: input.request,
    interpretedIntent: input.resolved.nextAction,
    intentType: planning ? "Planning Request" : "Project Work",
    relatedProject,
    relatedGoal: input.projectContext?.project.goal ?? null,
    recommendedExecutionPath: planning ? "Plan First" : "Execute Directly",
    planningRecommended: planning,
    clarificationRequired: false,
    reviewRequired: false,
    generatedCodexGoalText: input.resolved.expectedArtifact
      ? `${planning ? "Plan" : "Complete"} ${input.resolved.title} and produce ${input.resolved.expectedArtifact}.`
      : `${planning ? "Plan" : "Complete"} ${input.resolved.title}.`,
    classificationReason: "Generated from an existing execution plan that requires a Codex packet."
  };
}

function renderValidationGuidance(projectContext: ProjectContext | null): string {
  const validationCommands = decodeStringArray(projectContext?.metadata?.validation_commands);
  if (validationCommands.length === 0) {
    return "- Determine validation commands from the target repository and report any missing validation path.";
  }

  return validationCommands.map((command) => `- Run validation command: ${command}`).join("\n");
}

function decodeStringArray(raw: string | null | undefined): string[] {
  if (!raw) {
    return [];
  }

  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean);
}

function confidenceFromResolved(matched: boolean): "high" | "medium" {
  return matched ? "high" : "medium";
}

function trimTerminalPunctuation(value: string): string {
  return value.trim().replace(/[.!?]+$/g, "");
}

function renderTemplate(template: TemplateDefinition): string {
  return [
    `### ${template.title}`,
    `- ID: ${template.id}`,
    `- Project type: ${template.projectType}`,
    `- Description: ${template.description}`,
    ...Object.entries(template.defaults).map(([key, value]) => `- ${key}: ${value}`)
  ].join("\n");
}
