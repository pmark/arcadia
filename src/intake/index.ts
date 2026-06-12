import type { ProjectStatus, WorkClassification } from "../domain/constants.js";

export type IntakeIntent =
  | "CaptureThought"
  | "InstantiateProject"
  | "UpdateGoal"
  | "CreateWork"
  | "ReviewRequired"
  | "ShowStatus"
  | "PauseProject"
  | "ResumeProject";

export type IntakeConfidenceLabel = "high" | "medium" | "low";

export interface IntakeProjectContext {
  id: string;
  name: string;
  goal: string | null;
  aliases: string[];
  activeMilestoneId: string | null;
  activeMilestoneTitle: string | null;
}

export interface IntakeWorkspaceContext {
  projects: IntakeProjectContext[];
}

export interface IntakeResolvedReference {
  id: string;
  name: string;
  matched: string;
  score: number;
  ambiguous: boolean;
}

export interface IntakeTemplateDefinition {
  id: string;
  name: string;
  aliases: string[];
  workClassification: WorkClassification;
  expectedArtifact: string;
}

export type IntakeAction =
  | {
      kind: "capture_thought";
      title: string;
    }
  | {
      kind: "instantiate_project";
      projectName: string | null;
      template: IntakeTemplateDefinition | null;
    }
  | {
      kind: "update_project_goal";
      projectId: string | null;
      goal: string | null;
    }
  | {
      kind: "update_project_status";
      projectId: string | null;
      status: ProjectStatus;
    }
  | {
      kind: "create_work";
      title: string;
      projectId: string | null;
      workClassification: WorkClassification;
    }
  | {
      kind: "show_review";
    }
  | {
      kind: "show_status";
    };

export interface IntakeResult {
  rawInput: string;
  resolvedIntent: IntakeIntent;
  confidence: number;
  confidenceLabel: IntakeConfidenceLabel;
  extractedFields: Record<string, string>;
  missingFields: string[];
  proposedAction: string;
  safeToExecute: boolean;
  reviewRequired: boolean;
  explanation: string;
  action: IntakeAction;
  project: IntakeResolvedReference | null;
  template: IntakeResolvedReference | null;
}

const HIGH_CONFIDENCE = 0.8;
const MEDIUM_CONFIDENCE = 0.5;
const GENERIC_REFERENCE_TOKENS = new Set(["app", "project", "site", "website", "tool"]);

export const INTAKE_TEMPLATES: IntakeTemplateDefinition[] = [
  {
    id: "astro_website_blog",
    name: "Astro website/blog",
    aliases: ["astro", "astro site", "astro website", "astro blog", "blog", "blog site", "website", "website blog"],
    workClassification: "codex",
    expectedArtifact: "Astro website/blog Codex build packet"
  },
  {
    id: "phaser_game",
    name: "Phaser game",
    aliases: ["phaser", "phaser game", "2d game", "browser game"],
    workClassification: "codex",
    expectedArtifact: "Phaser game Codex build packet"
  },
  {
    id: "threejs_game_experiment",
    name: "Three.js game/experiment",
    aliases: ["threejs", "three js", "three.js", "three.js game", "threejs game", "3d experiment", "3d game"],
    workClassification: "codex",
    expectedArtifact: "Three.js game or experiment Codex build packet"
  },
  {
    id: "nextjs_web_app",
    name: "NextJS web app",
    aliases: ["nextjs", "next js", "next.js", "nextjs app", "nextjs web app", "next app", "web app"],
    workClassification: "codex",
    expectedArtifact: "NextJS web app Codex build packet"
  },
  {
    id: "serverless_api",
    name: "serverless API",
    aliases: ["serverless", "serverless api", "api", "serverless service"],
    workClassification: "codex",
    expectedArtifact: "Serverless API Codex build packet"
  },
  {
    id: "nodejs_utility_app",
    name: "NodeJS utility app",
    aliases: ["nodejs", "node js", "node.js", "node utility", "nodejs utility", "utility app", "cli utility"],
    workClassification: "codex",
    expectedArtifact: "NodeJS utility app Codex build packet"
  }
];

export function resolveIntake(rawInput: string, context: IntakeWorkspaceContext): IntakeResult {
  const raw = rawInput.trim();
  const normalized = normalizeText(raw);

  if (isReviewRequest(normalized)) {
    return highResult({
      raw,
      resolvedIntent: "ReviewRequired",
      extractedFields: {},
      proposedAction: "Show Requires Review items.",
      safeToExecute: true,
      reviewRequired: false,
      explanation: "The request asks for pending decisions or review items.",
      action: { kind: "show_review" },
      project: null,
      template: null
    });
  }

  if (isStatusRequest(normalized)) {
    return highResult({
      raw,
      resolvedIntent: "ShowStatus",
      extractedFields: {},
      proposedAction: "Show current status and focus recommendations.",
      safeToExecute: true,
      reviewRequired: false,
      explanation: "The request asks what matters now.",
      action: { kind: "show_status" },
      project: null,
      template: null
    });
  }

  const goal = parseGoalUpdate(raw);
  if (goal) {
    const project = resolveProjectReference(goal.projectReference, context);
    return resultFromProjectIntent({
      raw,
      resolvedIntent: "UpdateGoal",
      extractedFields: {
        project: goal.projectReference,
        goal: goal.goal
      },
      missingFields: [
        ...missingProjectFields(project),
        ...(goal.goal ? [] : ["goal"])
      ],
      proposedAction: project.reference
        ? `Update ${project.reference.name} goal to "${goal.goal}".`
        : `Update a project goal to "${goal.goal}".`,
      safeToExecute: true,
      explanation: project.reference
        ? "The request clearly changes a project goal."
        : "The request changes a project goal, but the project needs confirmation.",
      action: {
        kind: "update_project_goal",
        projectId: project.reference?.id ?? null,
        goal: goal.goal || null
      },
      project: project.reference,
      template: null,
      baseConfidence: 0.92
    });
  }

  const projectStatus = parseProjectStatus(raw);
  if (projectStatus) {
    const project = resolveProjectReference(projectStatus.projectReference, context);
    const resolvedIntent = projectStatus.status === "paused" ? "PauseProject" : "ResumeProject";
    return resultFromProjectIntent({
      raw,
      resolvedIntent,
      extractedFields: {
        project: projectStatus.projectReference,
        status: projectStatus.status
      },
      missingFields: missingProjectFields(project),
      proposedAction: project.reference
        ? `${projectStatus.status === "paused" ? "Pause" : "Resume"} ${project.reference.name}.`
        : `${projectStatus.status === "paused" ? "Pause" : "Resume"} the referenced project.`,
      safeToExecute: true,
      explanation: project.reference
        ? "The request clearly changes a project status."
        : "The request changes a project status, but the project needs confirmation.",
      action: {
        kind: "update_project_status",
        projectId: project.reference?.id ?? null,
        status: projectStatus.status
      },
      project: project.reference,
      template: null,
      baseConfidence: 0.9
    });
  }

  const instantiate = parseInstantiateProject(raw);
  if (instantiate) {
    const template = resolveTemplateReference(instantiate.templateReference);
    const missingFields = [
      ...(instantiate.projectName ? [] : ["projectName"]),
      ...(!template.reference || template.reference.ambiguous ? ["template"] : [])
    ];
    const confidence = confidenceFor({
      base: 0.9,
      missingFields,
      references: [template.reference]
    });
    const confidenceLabel = labelForConfidence(confidence);
    const reviewRequired = true;
    return {
      rawInput: raw,
      resolvedIntent: "InstantiateProject",
      confidence,
      confidenceLabel,
      extractedFields: compactFields({
        projectName: instantiate.projectName,
        template: instantiate.templateReference
      }),
      missingFields,
      proposedAction: template.definition && instantiate.projectName
        ? `Create a ${template.definition.name} named ${instantiate.projectName}.`
        : "Create a templated project after the missing fields are confirmed.",
      safeToExecute: false,
      reviewRequired,
      explanation: confidenceLabel === "high"
        ? "The request names both a supported project template and a project name."
        : "The request looks like project creation, but one or more fields need confirmation.",
      action: {
        kind: "instantiate_project",
        projectName: instantiate.projectName || null,
        template: template.definition
      },
      project: null,
      template: template.reference
    };
  }

  const work = parseCreateWork(raw);
  if (work) {
    const project = resolveProjectReference(work.projectReference, context);
    return resultFromProjectIntent({
      raw,
      resolvedIntent: "CreateWork",
      extractedFields: {
        project: work.projectReference,
        action: work.action
      },
      missingFields: [
        ...missingProjectFields(project),
        ...(work.action ? [] : ["action"])
      ],
      proposedAction: project.reference
        ? `${capitalize(work.action)} for ${project.reference.name}.`
        : `${capitalize(work.action)} for the referenced project.`,
      safeToExecute: false,
      explanation: project.reference
        ? "The request clearly creates actionable project work."
        : "The request creates work, but the project needs confirmation.",
      action: {
        kind: "create_work",
        title: capitalize(work.action),
        projectId: project.reference?.id ?? null,
        workClassification: "codex"
      },
      project: project.reference,
      template: null,
      baseConfidence: 0.88
    });
  }

  const project = resolveProjectReference(raw, context);
  return {
    rawInput: raw,
    resolvedIntent: "CaptureThought",
    confidence: project.reference ? 0.35 : 0.25,
    confidenceLabel: "low",
    extractedFields: compactFields({
      project: project.reference?.name ?? null
    }),
    missingFields: ["intent"],
    proposedAction: "Capture the thought and ask for clarification before creating work.",
    safeToExecute: false,
    reviewRequired: true,
    explanation: "No high-confidence deterministic intent matched, so the input is preserved for review.",
    action: {
      kind: "capture_thought",
      title: titleFromRaw(raw)
    },
    project: project.reference,
    template: null
  };
}

function highResult(input: {
  raw: string;
  resolvedIntent: IntakeIntent;
  extractedFields: Record<string, string>;
  proposedAction: string;
  safeToExecute: boolean;
  reviewRequired: boolean;
  explanation: string;
  action: IntakeAction;
  project: IntakeResolvedReference | null;
  template: IntakeResolvedReference | null;
}): IntakeResult {
  return {
    rawInput: input.raw,
    resolvedIntent: input.resolvedIntent,
    confidence: 0.96,
    confidenceLabel: "high",
    extractedFields: input.extractedFields,
    missingFields: [],
    proposedAction: input.proposedAction,
    safeToExecute: input.safeToExecute,
    reviewRequired: input.reviewRequired,
    explanation: input.explanation,
    action: input.action,
    project: input.project,
    template: input.template
  };
}

function resultFromProjectIntent(input: {
  raw: string;
  resolvedIntent: IntakeIntent;
  extractedFields: Record<string, string>;
  missingFields: string[];
  proposedAction: string;
  safeToExecute: boolean;
  explanation: string;
  action: IntakeAction;
  project: IntakeResolvedReference | null;
  template: IntakeResolvedReference | null;
  baseConfidence: number;
}): IntakeResult {
  const confidence = confidenceFor({
    base: input.baseConfidence,
    missingFields: input.missingFields,
    references: [input.project]
  });
  const confidenceLabel = labelForConfidence(confidence);
  return {
    rawInput: input.raw,
    resolvedIntent: input.resolvedIntent,
    confidence,
    confidenceLabel,
    extractedFields: input.extractedFields,
    missingFields: input.missingFields,
    proposedAction: input.proposedAction,
    safeToExecute: input.safeToExecute,
    reviewRequired: confidenceLabel !== "high" || !input.safeToExecute,
    explanation: input.explanation,
    action: input.action,
    project: input.project,
    template: input.template
  };
}

function parseInstantiateProject(raw: string): { templateReference: string; projectName: string } | null {
  const match = /^\s*(?:please\s+)?create\s+(?:a|an)?\s*(.+?)\s+(?:called|named)\s+(.+?)\s*[.!?]?\s*$/i.exec(raw);
  if (!match?.[1] || !match[2]) {
    return null;
  }

  return {
    templateReference: match[1].replace(/^new\s+/i, "").trim(),
    projectName: cleanTrailingPunctuation(match[2])
  };
}

function parseGoalUpdate(raw: string): { projectReference: string; goal: string } | null {
  const match = /^\s*(?:the\s+)?goal\s+for\s+(.+?)\s+is\s+(.+?)\s*[.!?]?\s*$/i.exec(raw);
  if (!match?.[1] || !match[2]) {
    return null;
  }

  return {
    projectReference: match[1].trim(),
    goal: cleanTrailingPunctuation(match[2]).replace(/^to\s+/i, "")
  };
}

function parseProjectStatus(raw: string): { projectReference: string; status: "active" | "paused" } | null {
  const pause = /^\s*pause\s+(.+?)\s*[.!?]?\s*$/i.exec(raw);
  if (pause?.[1]) {
    return { projectReference: cleanTrailingPunctuation(pause[1]), status: "paused" };
  }

  const resume = /^\s*resume\s+(.+?)\s*[.!?]?\s*$/i.exec(raw);
  if (resume?.[1]) {
    return { projectReference: cleanTrailingPunctuation(resume[1]), status: "active" };
  }

  return null;
}

function parseCreateWork(raw: string): { action: string; projectReference: string } | null {
  const match = /^\s*(?:please\s+)?(?:add|build|implement)\s+(.+?)\s+(?:for|to|in)\s+(.+?)\s*[.!?]?\s*$/i.exec(raw);
  if (!match?.[1] || !match[2]) {
    return null;
  }

  return {
    action: cleanTrailingPunctuation(match[1]),
    projectReference: cleanTrailingPunctuation(match[2])
  };
}

function isReviewRequest(normalized: string): boolean {
  return normalized === "what needs review" ||
    normalized === "needs review" ||
    normalized === "requires review" ||
    normalized === "what requires review" ||
    normalized.includes("what needs review");
}

function isStatusRequest(normalized: string): boolean {
  return normalized === "status" ||
    normalized === "show status" ||
    normalized === "what should i focus on" ||
    normalized === "what should i focus on today" ||
    normalized.includes("what matters now");
}

function resolveProjectReference(
  reference: string,
  context: IntakeWorkspaceContext
): { reference: IntakeResolvedReference | null } {
  return {
    reference: resolveReference(
      reference,
      context.projects.map((project) => ({
        id: project.id,
        name: project.name,
        aliases: project.aliases
      }))
    )
  };
}

function resolveTemplateReference(
  reference: string
): { reference: IntakeResolvedReference | null; definition: IntakeTemplateDefinition | null } {
  const resolved = resolveReference(
    reference,
    INTAKE_TEMPLATES.map((template) => ({
      id: template.id,
      name: template.name,
      aliases: template.aliases
    }))
  );

  return {
    reference: resolved,
    definition: resolved ? INTAKE_TEMPLATES.find((template) => template.id === resolved.id) ?? null : null
  };
}

function resolveReference(
  reference: string,
  candidates: Array<{ id: string; name: string; aliases: string[] }>
): IntakeResolvedReference | null {
  const scored = candidates.flatMap((candidate) =>
    [candidate.name, ...candidate.aliases].map((name) => ({
      id: candidate.id,
      name: candidate.name,
      matched: name,
      score: scoreReference(reference, name)
    }))
  ).filter((candidate) => candidate.score >= 0.55);

  scored.sort((left, right) =>
    right.score - left.score ||
    right.matched.length - left.matched.length ||
    left.name.localeCompare(right.name)
  );

  const best = scored[0];
  if (!best) {
    return null;
  }

  const ambiguous = scored.some((candidate) =>
    candidate.id !== best.id && Math.abs(candidate.score - best.score) < 0.05
  );

  return { ...best, ambiguous };
}

function scoreReference(reference: string, candidate: string): number {
  const normalizedReference = normalizeText(reference);
  const normalizedCandidate = normalizeText(candidate);
  if (!normalizedReference || !normalizedCandidate) {
    return 0;
  }

  if (normalizedReference === normalizedCandidate) {
    return 1;
  }

  if (normalizedReference.includes(normalizedCandidate)) {
    return normalizedCandidate.length >= 4 ? 0.96 : 0.82;
  }

  if (normalizedCandidate.includes(normalizedReference)) {
    return normalizedReference.length >= 4 ? 0.9 : 0.72;
  }

  const referenceTokens = new Set(
    normalizedReference.split(" ").filter((token) => !GENERIC_REFERENCE_TOKENS.has(token))
  );
  const candidateTokens = normalizedCandidate.split(" ").filter((token) => !GENERIC_REFERENCE_TOKENS.has(token));
  if (referenceTokens.size === 0 || candidateTokens.length === 0) {
    return 0;
  }
  const overlap = candidateTokens.filter((token) => referenceTokens.has(token)).length;
  if (overlap === 0) {
    return 0;
  }

  return Math.min(0.88, overlap / candidateTokens.length);
}

function confidenceFor(input: {
  base: number;
  missingFields: string[];
  references: Array<IntakeResolvedReference | null>;
}): number {
  if (input.missingFields.length > 0) {
    return 0.58;
  }

  const references = input.references.filter((reference): reference is IntakeResolvedReference => Boolean(reference));
  if (references.some((reference) => reference.ambiguous)) {
    return 0.6;
  }

  const weakestReference = references.reduce((score, reference) => Math.min(score, reference.score), 1);
  if (weakestReference < HIGH_CONFIDENCE) {
    return 0.65;
  }

  return Math.min(input.base, weakestReference ? Math.max(0.82, weakestReference) : input.base);
}

function labelForConfidence(confidence: number): IntakeConfidenceLabel {
  if (confidence >= HIGH_CONFIDENCE) {
    return "high";
  }

  if (confidence >= MEDIUM_CONFIDENCE) {
    return "medium";
  }

  return "low";
}

function missingProjectFields(project: { reference: IntakeResolvedReference | null }): string[] {
  if (!project.reference || project.reference.ambiguous) {
    return ["project"];
  }

  return [];
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function cleanTrailingPunctuation(value: string): string {
  return value.trim().replace(/[.!?]+$/g, "").trim();
}

function compactFields(fields: Record<string, string | null | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fields).filter((entry): entry is [string, string] => Boolean(entry[1]?.trim()))
  );
}

function titleFromRaw(raw: string): string {
  return raw.trim().split(/\r?\n/)[0]?.trim().slice(0, 120) || "Captured thought";
}

function capitalize(value: string): string {
  const trimmed = value.trim();
  return trimmed ? `${trimmed[0].toUpperCase()}${trimmed.slice(1)}` : trimmed;
}
