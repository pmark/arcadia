import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CodexInvocationPurpose } from "../domain/constants.js";
import type { WorkItemSummary } from "../domain/types.js";
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
  agentProfile: CodingAgentProfile;
}): CodexPacket {
  const invocationId = createId("codexInvocation");
  const packetDir = path.join(input.workspace, "prompts", "codex", invocationId);
  mkdirSync(packetDir, { recursive: true });

  const promptPath = path.join(packetDir, "prompt.md");
  const jsonlOutputPath = path.join(packetDir, "output.jsonl");
  const finalMessagePath = path.join(packetDir, "final.md");
  const metadataPath = path.join(packetDir, "metadata.json");
  const command = buildCommand(input.agentProfile, promptPath, finalMessagePath);

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
        workItemId: input.workItem.id,
        planId: input.planId,
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

function buildCommand(profile: CodingAgentProfile, promptPath: string, finalMessagePath: string): string {
  const args = [
    ...profile.args,
    "--cd",
    "<workspace>",
    "--output-last-message",
    finalMessagePath,
    "-"
  ];
  return [profile.command, ...args].join(" ").replace(promptPath, "<prompt>");
}

function renderPrompt(input: {
  request: string;
  resolved: ResolvedIntent;
  workItem: WorkItemSummary;
  planId: string;
  agentProfile: CodingAgentProfile;
}): string {
  const templates = input.resolved.templates.map(renderTemplate).join("\n\n") || "None";
  const gates = input.resolved.approvalGates
    .map((gate) => `- ${gate.gateType}: ${gate.reason}`)
    .join("\n") || "None";
  const slots = Object.entries(input.resolved.slots)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join("\n") || "None";

  return `# Arcadia Codex ${input.agentProfile.purpose === "build" ? "Build" : "Planning"} Packet

## Request
${input.request}

## Resolved Intent
- Intent: ${input.resolved.intentId}
- Output kind: ${input.resolved.outputKind}
- Work item: ${input.workItem.id}
- Plan: ${input.planId}
- Work classification: ${input.workItem.work_classification}

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
`;
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
