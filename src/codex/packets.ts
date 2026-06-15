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
import { CODEX_REPO_PATH_REQUIRED_MESSAGE } from "../projects/setup.js";
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
  if (input.projectContext && !input.projectContext.metadata?.repo_path) {
    throw new Error(CODEX_REPO_PATH_REQUIRED_MESSAGE);
  }

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
  const slots = Object.entries(input.resolved.slots)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join("\n") || "None";
  const projectContext = renderProjectContext(input.projectContext, input.workItem);
  const milestoneContext = renderCurrentMilestone(input.projectContext, input.workItem);
  const pathContext = renderPathContext(input.projectContext, input.workspace);
  const operatorContext = readOperatorContext(input.workspace);
  const isPlanningPacket = input.agentProfile.purpose === "planning";
  const validationGuidance = renderValidationGuidance(input.projectContext, isPlanningPacket);
  const executionInstruction = renderExecutionInstruction(input.agentProfile.purpose, stewardship);
  const expectedArtifact = input.resolved.expectedArtifact ?? input.workItem.expected_artifact ?? expectedArtifactFallback(isPlanningPacket);
  const approvalGateText = renderApprovalGates(input.resolved.approvalGates, input.request, isPlanningPacket);
  const repositoryImpact = renderRepositoryImpactAssessment(input);
  const followUpGoal = renderSmallestFollowUpGoal(input, expectedArtifact);
  const finalReportingRequirements = renderFinalReportingRequirements(isPlanningPacket);

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
${isPlanningPacket ? "- Planning is safe to perform now; implementation, credential setup, publishing, deployment, spending, production access, and outbound actions are future phases that require separate approval before execution." : ""}

## Approval Gates
${approvalGateText}

## Expected Artifact
${expectedArtifact}

## Repository Impact Assessment
${repositoryImpact}

## Smallest Useful Follow-up Codex Goal
${followUpGoal}

## Execution Instruction
${executionInstruction}

## Discovery And Validation
- Start by inspecting the target repository/project context above.
- Prefer deterministic local scripts and existing project conventions before adding new tooling.
${validationGuidance}

## Final Reporting Requirements
${finalReportingRequirements}
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
  if (input.agentProfile.purpose === "planning") {
    return [
      `- Deliver the expected planning artifact: ${trimTerminalPunctuation(artifact)}.`,
      `- Keep the plan aligned with ${project}${projectGoal}.`,
      "- Preserve implementation intent by framing implementation as a future phase, not work authorized by this packet.",
      "- Include ordered phases, concrete expected artifacts, repository impact assessment, approval needs, validation strategy, risks/open questions, and the smallest useful follow-up Codex implementation goal.",
      "- Do not require tests, lint, deployment, credentials, publishing, spending, production access, or outbound actions unless files are changed while preparing the plan."
    ].join("\n");
  }

  const criteria = [
    `- Deliver the expected artifact: ${trimTerminalPunctuation(artifact)}.`,
    `- Keep the work aligned with ${project}${projectGoal}.`,
    "- Preserve existing behavior outside the requested scope.",
    "- Run relevant local validation or explain why validation could not run."
  ];

  if (stewardship.planningRecommended) {
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
  if (purpose === "planning") {
    return "Plan only. Do not make implementation changes. Preserve the original implementation intent by describing implementation as a future phase that requires a separate approved Codex implementation goal.";
  }

  return "Execute directly after local inspection. Stay inside the approval boundaries and stop if the work requires a blocked action.";
}

function whyThisMatters(stewardship: GoalStewardshipResult, projectContext: ProjectContext | null): string {
  if (projectContext?.project.goal) {
    return `This advances ${projectContext.project.name} toward its goal: ${trimTerminalPunctuation(projectContext.project.goal)}.`;
  }

  if (stewardship.relatedProject && stewardship.relatedGoal) {
    return `This advances ${stewardship.relatedProject.name} toward its goal: ${trimTerminalPunctuation(stewardship.relatedGoal)}.`;
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

function renderApprovalGates(
  gates: ResolvedIntent["approvalGates"],
  request: string,
  isPlanningPacket: boolean
): string {
  const renderedGates = gates.map((gate) => `- ${gate.gateType}: ${gate.reason}`);
  if (!isPlanningPacket) {
    return renderedGates.join("\n") || "None";
  }

  const futureNeeds = inferFutureApprovalNeeds(request, gates);
  return [
    "- None required for planning-only packet creation.",
    ...futureNeeds.map((need) => `- Future implementation approval required before execution: ${need}`)
  ].join("\n");
}

function renderRepositoryImpactAssessment(input: {
  request: string;
  resolved: ResolvedIntent;
  projectContext: ProjectContext | null;
  workItem: WorkItemSummary;
  agentProfile: CodingAgentProfile;
}): string {
  const project = input.projectContext?.project.name ?? input.workItem.project_name ?? "selected project";
  const repo = input.projectContext?.metadata?.repo_path ?? "workspace scope";
  const normalized = normalizeForPacket(`${input.request} ${Object.values(input.resolved.slots).join(" ")}`);
  const likelyAreas = new Set<string>();

  if (/\b(?:pinterest|social|post|posting|publish|publication|platform)\b/.test(normalized)) {
    likelyAreas.add("publishing/social integration modules");
    likelyAreas.add("platform adapter or service layer");
    likelyAreas.add("configuration and environment documentation");
    likelyAreas.add("tests or fixtures covering outbound-action boundaries");
  }
  if (/\b(?:credential|oauth|api key|token|secret)\b/.test(normalized)) {
    likelyAreas.add("credential configuration paths and setup documentation");
  }
  if (/\b(?:deploy|deployment|release|production)\b/.test(normalized)) {
    likelyAreas.add("deployment scripts, release configuration, and operational docs");
  }
  if (/\b(?:back burner|fixture|regression|cleanup|stale)\b/.test(normalized)) {
    likelyAreas.add("Arcadia intake/back-burner logic");
    likelyAreas.add("deterministic fixtures and regression tests");
  }
  if (/\b(?:paid|scheduler|spend|buy|purchase|budget)\b/.test(normalized)) {
    likelyAreas.add("vendor evaluation notes and spending approval records");
  }

  if (likelyAreas.size === 0) {
    likelyAreas.add("request-specific source modules discovered during repository inspection");
    likelyAreas.add("nearest docs and tests for the planned change");
  }

  return [
    `- Target repository/path: ${repo}.`,
    `- Project affected: ${project}.`,
    ...[...likelyAreas].map((area) => `- Likely future implementation area: ${area}.`),
    input.agentProfile.purpose === "planning"
      ? "- Planning packet may inspect repository structure, but it must not edit implementation files."
      : "- Build packet may edit repository files only after approval and must stay inside approval boundaries."
  ].join("\n");
}

function renderSmallestFollowUpGoal(input: {
  request: string;
  resolved: ResolvedIntent;
  projectContext: ProjectContext | null;
  workItem: WorkItemSummary;
  agentProfile: CodingAgentProfile;
}, expectedArtifact: string): string {
  const project = input.projectContext?.project.name ?? input.workItem.project_name ?? "the selected project";
  const subject = canonicalFollowUpSubject(input.resolved, input.workItem.title, expectedArtifact);
  if (input.agentProfile.purpose === "planning") {
    return `After this plan is reviewed, open the smallest useful Codex implementation goal: implement the first repository-only slice of ${subject} for ${project}, with no credentials, publishing, deployment, spending, production access, or outbound actions.`;
  }

  return `If this build packet is approved, implement the smallest repository-only slice of ${subject} for ${project} and stop before any gated external action.`;
}

function renderFinalReportingRequirements(isPlanningPacket: boolean): string {
  if (isPlanningPacket) {
    return [
      "- Summarize project, milestone, and repository scope.",
      "- Summarize the planning outcome only.",
      "- List the concrete planning artifacts produced.",
      "- Describe validation strategy and note that tests/lint were not required unless files changed.",
      "- Identify future approval needs, open questions, and blockers before implementation."
    ].join("\n");
  }

  return [
    "- Summarize project, milestone, and repository scope.",
    "- Summarize implementation outcome.",
    "- List changed files, validation commands run, and any commands that could not be run.",
    "- Identify remaining approval gates or blockers."
  ].join("\n");
}

function renderValidationGuidance(projectContext: ProjectContext | null, isPlanningPacket: boolean): string {
  const validationCommands = decodeStringArray(projectContext?.metadata?.validation_commands);
  if (isPlanningPacket) {
    const commands = validationCommands.length > 0
      ? validationCommands.map((command) => `\`${command}\``).join(", ")
      : "the repository's existing validation scripts";
    return [
      `- Validation strategy: identify the relevant validation path for future implementation, likely ${commands}.`,
      "- Do not run tests or lint for this planning-only packet unless files change while preparing the plan.",
      "- If files do change while preparing the plan, run the narrowest relevant validation command and report it."
    ].join("\n");
  }

  if (validationCommands.length === 0) {
    return "- Determine validation commands from the target repository and report any missing validation path.";
  }

  return validationCommands.map((command) => `- Run validation command: ${command}`).join("\n");
}

function inferFutureApprovalNeeds(
  request: string,
  gates: ResolvedIntent["approvalGates"]
): string[] {
  const normalized = normalizeForPacket(request);
  const needs = new Set<string>();
  for (const gate of gates) {
    needs.add(`${gate.gateType}: ${gate.reason}`);
  }

  if (/\b(?:credential|oauth|api key|token|secret|pinterest|external service)\b/.test(normalized)) {
    needs.add("credentials_required: credentials or external-service access require explicit approval.");
  }
  if (/\b(?:publish|publication|post|posting|social|everywhere|video|pinterest|youtube|instagram|tiktok|mastodon|bluesky)\b/.test(normalized)) {
    needs.add("publication: publishing or posting requires explicit approval.");
    needs.add("send_email_or_messages: outbound posts, messages, or notifications require explicit approval.");
  }
  if (/\b(?:deploy|deployment|production release)\b/.test(normalized)) {
    needs.add("external_deployment: deployment requires explicit approval.");
  }
  if (/\b(?:production data|prod data|customer data|live data|production credentials)\b/.test(normalized)) {
    needs.add("production_data_access: production access requires explicit approval.");
  }
  if (/\b(?:paid|scheduler|spend|buy|purchase|budget|ad campaign|ads?\b|money)\b/.test(normalized)) {
    needs.add("financial_action: spending or paid vendor selection requires explicit approval.");
  }

  if (needs.size === 0) {
    return ["normal repository-change approval only; no credential, publishing, deployment, spending, production-access, or outbound-action approval identified."];
  }
  return [...needs];
}

function canonicalFollowUpSubject(resolved: ResolvedIntent, title: string, expectedArtifact: string): string {
  const platform = resolved.slots.platform;
  const purpose = resolved.slots.purpose ?? resolved.slots.action ?? resolved.slots.requestedAction;
  if (platform && purpose && !normalizeForPacket(purpose).includes(normalizeForPacket(platform))) {
    return `${platform} ${decapitalize(trimTerminalPunctuation(purpose.replace(/^plan\s+/i, "")))}`;
  }
  if (purpose) {
    const cleaned = trimTerminalPunctuation(purpose.replace(/^(?:plan|build|implement|add|set up|deploy|post)\s+/i, ""));
    return platform ? restoreKnownCasing(cleaned, platform) : cleaned;
  }

  const cleanedArtifact = expectedArtifact
    .replace(new RegExp(`\\s+for\\s+${escapeRegExp(resolved.slots.project ?? "")}\\b`, "i"), "")
    .replace(/\bplan\b.*$/i, "")
    .replace(/\bimplementation plan\b.*$/i, "")
    .replace(/\bsafe repository changes\b.*$/i, "")
    .trim();
  return trimTerminalPunctuation(cleanedArtifact || title);
}

function expectedArtifactFallback(isPlanningPacket: boolean): string {
  return isPlanningPacket
    ? "Concrete planning brief with ordered phases, repository impact assessment, approval needs, validation strategy, and recommended next action"
    : "Concrete implementation artifact with changed files and validation results";
}

function normalizeForPacket(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function restoreKnownCasing(value: string, knownValue: string): string {
  return value.replace(new RegExp(`\\b${escapeRegExp(knownValue)}\\b`, "i"), knownValue);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function decapitalize(value: string): string {
  const trimmed = value.trim();
  return trimmed ? `${trimmed[0].toLowerCase()}${trimmed.slice(1)}` : trimmed;
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
