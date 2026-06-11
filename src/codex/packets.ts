import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CodexInvocationPurpose } from "../domain/constants.js";
import type { ProjectContext, WorkItemSummary } from "../domain/types.js";
import type { CodingAgentProfile, TemplateDefinition } from "../intent/registries.js";
import type { ResolvedIntent } from "../intent/resolver.js";
import { createId } from "../utils/id.js";
import { nowIso } from "../utils/time.js";
import { toWorkspaceRelativePath } from "../workspace/paths.js";

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
  relativePromptPath: string;
  relativeJsonlOutputPath: string;
  relativeFinalMessagePath: string;
}

export function createCodexPacket(input: {
  workspace: string;
  request: string;
  resolved: ResolvedIntent;
  workItem: WorkItemSummary;
  planId: string;
  projectContext: ProjectContext | null;
  agentProfile: CodingAgentProfile;
}): CodexPacket {
  const invocationId = createId("codexInvocation");
  const packetDir = path.join(input.workspace, "prompts", "codex", invocationId);
  mkdirSync(packetDir, { recursive: true });

  const promptPath = path.join(packetDir, "prompt.md");
  const jsonlOutputPath = path.join(packetDir, "output.jsonl");
  const finalMessagePath = path.join(packetDir, "final.md");
  const metadataPath = path.join(packetDir, "metadata.json");
  const workspaceScope = input.projectContext?.metadata?.repo_path ?? input.workspace;
  const command = buildCommand(input.agentProfile, workspaceScope, finalMessagePath);

  writeFileSync(promptPath, renderPrompt(input), "utf8");
  writeFileSync(jsonlOutputPath, "", "utf8");
  writeFileSync(finalMessagePath, "Codex has not been invoked yet.\n", "utf8");
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
        promptPath: toWorkspaceRelativePath(input.workspace, promptPath),
        jsonlOutputPath: toWorkspaceRelativePath(input.workspace, jsonlOutputPath),
        finalMessagePath: toWorkspaceRelativePath(input.workspace, finalMessagePath)
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
    relativePromptPath: toWorkspaceRelativePath(input.workspace, promptPath),
    relativeJsonlOutputPath: toWorkspaceRelativePath(input.workspace, jsonlOutputPath),
    relativeFinalMessagePath: toWorkspaceRelativePath(input.workspace, finalMessagePath)
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
  request: string;
  resolved: ResolvedIntent;
  workItem: WorkItemSummary;
  planId: string;
  projectContext: ProjectContext | null;
  agentProfile: CodingAgentProfile;
}): string {
  const templates = input.resolved.templates.map(renderTemplate).join("\n\n") || "None";
  const gates = input.resolved.approvalGates
    .map((gate) => `- ${gate.gateType}: ${gate.reason}`)
    .join("\n") || "None";
  const slots = Object.entries(input.resolved.slots)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join("\n") || "None";
  const projectContext = renderProjectContext(input.projectContext, input.workItem);

  return `# Arcadia Codex ${input.agentProfile.purpose === "build" ? "Build" : "Planning"} Packet

## Request
${input.request}

## Resolved Intent
- Intent: ${input.resolved.intentId}
- Output kind: ${input.resolved.outputKind}
- Work item: ${input.workItem.id}
- Plan: ${input.planId}
- Work classification: ${input.workItem.work_classification}

## Target Project Context
${projectContext}

## Slots
${slots}

## Templates
${templates}

## Approval Gates
${gates}

## Boundaries
- Do not publish, deploy, merge, delete, spend money, use credentials, access production data, or send messages.
- Keep all behavior explicit and inspectable.
- If implementation is required, produce a clear plan or patch summary only after Mark approves Codex build execution.
- Use the selected repository or workspace scope only.

## Discovery And Validation
- Start by inspecting the target repository/project context above.
- Prefer deterministic local scripts and existing project conventions before adding new tooling.
- Report changed files, validation commands run, and any commands that could not be run.

## Final Response Requirements
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
    `- Active milestone: ${projectContext.activeMilestone?.title ?? "None"} (${projectContext.activeMilestone?.id ?? "none"})`,
    `- Work item milestone: ${workItem.milestone_title ?? "None"} (${workItem.milestone_id ?? "none"})`,
    `- Target repository: ${metadata?.repo_path ?? "Workspace scope"}`,
    `- Project status summary: ${metadata?.status_summary ?? "None"}`,
    `- Validation commands: ${validationCommands.length > 0 ? validationCommands.join(" && ") : "Use existing project validation scripts"}`
  ].join("\n");
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

function renderTemplate(template: TemplateDefinition): string {
  return [
    `### ${template.title}`,
    `- ID: ${template.id}`,
    `- Project type: ${template.projectType}`,
    `- Description: ${template.description}`,
    ...Object.entries(template.defaults).map(([key, value]) => `- ${key}: ${value}`)
  ].join("\n");
}
