import type { ApprovalGateType, QueueName, WorkClassification } from "../domain/constants.js";
import { queueForWorkClassification } from "../domain/constants.js";
import type { PlannedSkillStep } from "../execution/skills.js";
import type { IntentDefinition, Phase3Registries, TemplateDefinition } from "./registries.js";

export interface ResolvedIntent {
  intentId: string;
  matched: boolean;
  title: string;
  outputKind: string;
  queue: QueueName;
  workClassification: WorkClassification;
  nextAction: string;
  expectedArtifact: string | null;
  skillSequence: PlannedSkillStep[];
  approvalGates: Array<{
    gateType: ApprovalGateType;
    reason: string;
  }>;
  templates: TemplateDefinition[];
  slots: Record<string, string>;
  codexPurpose: "planning" | "build" | null;
}

export function resolveIntent(request: string, registries: Phase3Registries): ResolvedIntent {
  const normalized = normalize(request);
  const intent = registries.intents.intents.find((candidate) => matchesIntent(normalized, candidate));

  if (!intent) {
    return unknownIntent(request);
  }

  const templates = (intent.templateRefs ?? []).flatMap((templateId) =>
    registries.templates.templates.filter((template) => template.id === templateId)
  );
  const slots = extractSlots(request);
  const approvalGates = uniqueGateReasons([
    ...(intent.approvalGates ?? []),
    ...templates.flatMap((template) => template.approvalGates ?? [])
  ]);
  const codexPurpose = purposeFromSteps(intent.skillSequence);

  return {
    intentId: intent.id,
    matched: true,
    title: titleForIntent(intent, request, slots),
    outputKind: intent.outputKind,
    queue: queueForWorkClassification(intent.workClassification),
    workClassification: intent.workClassification,
    nextAction: intent.nextAction,
    expectedArtifact: intent.expectedArtifact ?? null,
    skillSequence: intent.skillSequence,
    approvalGates,
    templates,
    slots,
    codexPurpose
  };
}

function unknownIntent(request: string): ResolvedIntent {
  return {
    intentId: "codex_plan",
    matched: false,
    title: titleFromRequest(request),
    outputKind: "codex_planning_packet",
    queue: "work_queue",
    workClassification: "codex",
    nextAction: "Review the Codex planning packet for this request.",
    expectedArtifact: "Codex planning packet",
    skillSequence: [
      {
        skillName: "codex_planning",
        title: "Prepare Codex planning packet",
        command: null,
        executorType: "codex_planning",
        safeToRun: false,
        needsMark: "Codex planning requires explicit review before execution."
      }
    ],
    approvalGates: [],
    templates: [],
    slots: extractSlots(request),
    codexPurpose: "planning"
  };
}

function matchesIntent(normalizedRequest: string, intent: IntentDefinition): boolean {
  const candidates = [...intent.aliases, ...intent.examples].map(normalize);
  return candidates.some((candidate) => normalizedRequest === candidate || normalizedRequest.includes(candidate));
}

function extractSlots(request: string): Record<string, string> {
  const slots: Record<string, string> = {};
  const named = /\bnamed\s+["“]?([^"”]+?)["”]?[.!?]*$/i.exec(request.trim());
  if (named?.[1]) {
    slots.projectName = named[1].trim();
  }

  if (/field notes/i.test(request)) {
    slots.templateName = "Field Notes";
  }

  if (/cloudflare/i.test(request)) {
    slots.deploymentTarget = "Cloudflare";
  }

  return slots;
}

function titleForIntent(intent: IntentDefinition, request: string, slots: Record<string, string>): string {
  if (intent.id === "create_astro_blog" && slots.projectName) {
    return `Create Astro blog: ${slots.projectName}`;
  }

  if (intent.id === "prepare_blog_update") {
    return "Prepare weekly Martian Rover Labs update";
  }

  if (intent.id === "process_analytics_data") {
    return "Plan MIDI Opener analytics data pipeline";
  }

  return titleFromRequest(request);
}

function titleFromRequest(request: string): string {
  return request.trim().split(/\r?\n/)[0]?.trim().slice(0, 120) || "Natural language request";
}

function purposeFromSteps(steps: PlannedSkillStep[]): "planning" | "build" | null {
  if (steps.some((step) => step.executorType === "codex_build")) {
    return "build";
  }

  if (steps.some((step) => step.executorType === "codex_planning")) {
    return "planning";
  }

  return null;
}

function uniqueGateReasons(gates: ApprovalGateType[]): Array<{ gateType: ApprovalGateType; reason: string }> {
  return [...new Set(gates)].map((gateType) => ({
    gateType,
    reason: reasonForGate(gateType)
  }));
}

function reasonForGate(gateType: ApprovalGateType): string {
  switch (gateType) {
    case "credentials_required":
      return "Credentials are required before this work can access external services.";
    case "external_deployment":
      return "External deployment requires explicit approval.";
    case "publication":
      return "Publication requires explicit approval.";
    case "destructive_filesystem_changes":
      return "Potentially destructive filesystem changes require explicit approval.";
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

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}
