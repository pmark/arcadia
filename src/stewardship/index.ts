import type { IntakeResult, IntakeWorkspaceContext } from "../intake/index.js";
import type { ResolvedIntent } from "../intent/resolver.js";

export const STEWARDSHIP_INTENT_TYPES = [
  "New Goal",
  "Goal Refinement",
  "Project Work",
  "Planning Request",
  "Research Request",
  "Back Burner Idea",
  "Status Request",
  "Review Response"
] as const;

export type StewardshipIntentType = (typeof STEWARDSHIP_INTENT_TYPES)[number];

export const STEWARDSHIP_EXECUTION_PATHS = [
  "Execute Directly",
  "Plan First",
  "Clarify First",
  "Requires Review",
  "Back Burner",
  "Blocked"
] as const;

export type StewardshipExecutionPath = (typeof STEWARDSHIP_EXECUTION_PATHS)[number];

export interface StewardshipRelatedProject {
  id: string;
  name: string;
}

export interface GoalStewardshipResult {
  originalInput: string;
  interpretedIntent: string;
  intentType: StewardshipIntentType;
  relatedProject: StewardshipRelatedProject | null;
  relatedGoal: string | null;
  recommendedExecutionPath: StewardshipExecutionPath;
  planningRecommended: boolean;
  clarificationRequired: boolean;
  reviewRequired: boolean;
  generatedCodexGoalText: string | null;
  classificationReason: string;
}

export interface StewardIntentInput {
  rawInput: string;
  intake: IntakeResult;
  resolved: ResolvedIntent;
  workspaceContext: IntakeWorkspaceContext;
  approvedFromReview?: boolean;
  reviewResponseHasReference?: boolean;
  reviewResponseHasResponse?: boolean;
}

export function stewardIntent(input: StewardIntentInput): GoalStewardshipResult {
  const raw = input.rawInput.trim();
  const normalized = normalize(raw);
  const relatedProject = relatedProjectFromIntake(input.intake);
  const relatedGoal = relatedGoalForProject(relatedProject?.id ?? null, input.workspaceContext);
  const intentType = intentTypeForInput(input, normalized);
  const planningRecommended = planningRecommendedForInput(input, normalized, intentType);
  const executionPath = executionPathForInput(input, normalized, intentType, planningRecommended);
  const generatedCodexGoalText = codexGoalTextForInput({
    ...input,
    intentType,
    relatedProject,
    relatedGoal,
    planningRecommended
  });

  return {
    originalInput: input.rawInput,
    interpretedIntent: interpretedIntentForInput(input, intentType),
    intentType,
    relatedProject,
    relatedGoal,
    recommendedExecutionPath: executionPath,
    planningRecommended,
    clarificationRequired: executionPath === "Clarify First",
    reviewRequired: executionPath === "Requires Review",
    generatedCodexGoalText,
    classificationReason: classificationReasonForInput(input, intentType, executionPath, planningRecommended)
  };
}

export function isPlanningOrResearchStewardship(stewardship: GoalStewardshipResult): boolean {
  return stewardship.intentType === "Planning Request" || stewardship.intentType === "Research Request";
}

function intentTypeForInput(
  input: StewardIntentInput,
  normalized: string
): StewardshipIntentType {
  if (input.reviewResponseHasResponse || input.intake.classification === "ReviewResponse") {
    return "Review Response";
  }

  if (isResearchRequest(normalized)) {
    return "Research Request";
  }

  if (isPlanningRequest(normalized)) {
    return "Planning Request";
  }

  switch (input.intake.resolvedIntent) {
    case "CreateProject":
    case "InstantiateProject":
      return "New Goal";
    case "UpdateEntityAttribute":
      return input.intake.action.kind === "update_entity_attribute" && input.intake.action.attribute === "goal"
        ? "Goal Refinement"
        : "Project Work";
    case "CreateWork":
      return "Project Work";
    case "ShowProject":
    case "ListProjects":
    case "ShowStatus":
    case "ReviewRequired":
      return "Status Request";
    case "CaptureThought":
      return commandShapedMissingTarget(normalized, input.intake) ? "Project Work" : "Back Burner Idea";
  }
}

function executionPathForInput(
  input: StewardIntentInput,
  normalized: string,
  intentType: StewardshipIntentType,
  planningRecommended: boolean
): StewardshipExecutionPath {
  if (!input.rawInput.trim()) {
    return "Blocked";
  }

  if (intentType === "Review Response") {
    return input.reviewResponseHasReference ? "Execute Directly" : "Back Burner";
  }

  if (input.approvedFromReview) {
    return planningRecommended ? "Plan First" : "Execute Directly";
  }

  if (input.intake.missingFields.length > 0 && commandShapedMissingTarget(normalized, input.intake)) {
    return "Clarify First";
  }

  if (intentType === "Planning Request" || intentType === "Research Request") {
    return input.intake.project || !requiresProjectForPlan(normalized) ? "Plan First" : "Clarify First";
  }

  if (input.intake.action.kind === "capture_thought") {
    return commandShapedMissingTarget(normalized, input.intake) ? "Clarify First" : "Back Burner";
  }

  if (input.intake.missingFields.length > 0) {
    return "Clarify First";
  }

  if (input.intake.reviewRequired && !input.intake.safeToExecute) {
    return "Requires Review";
  }

  if (planningRecommended && input.resolved.codexPurpose === "planning") {
    return "Plan First";
  }

  return "Execute Directly";
}

function planningRecommendedForInput(
  input: StewardIntentInput,
  normalized: string,
  intentType: StewardshipIntentType
): boolean {
  if (intentType === "Planning Request" || intentType === "Research Request") {
    return true;
  }

  if (input.intake.action.kind !== "create_work" && input.intake.action.kind !== "instantiate_project") {
    return false;
  }

  if (input.intake.missingFields.length > 0) {
    return false;
  }

  return /\b(?:architecture|architect|migration|redesign|roadmap|strategy|workflow|integration|publishing|posting|publish|automation|release|multi[- ]step|end[- ]to[- ]end)\b/.test(normalized) ||
    input.resolved.approvalGates.length > 1;
}

function codexGoalTextForInput(input: StewardIntentInput & {
  intentType: StewardshipIntentType;
  relatedProject: StewardshipRelatedProject | null;
  relatedGoal: string | null;
  planningRecommended: boolean;
}): string | null {
  if (
    input.resolved.codexPurpose === null &&
    input.intentType !== "Planning Request" &&
    input.intentType !== "Research Request"
  ) {
    return null;
  }

  const project = input.relatedProject?.name ?? "the relevant project";
  const goal = input.relatedGoal ? ` toward its goal: ${input.relatedGoal}` : "";
  const request = stripTerminalPunctuation(input.rawInput.trim());
  const subject = canonicalSubjectForInput(input);

  if (input.intentType === "Planning Request") {
    if (subject && input.relatedProject?.name) {
      return `Create a practical plan for ${subject} for ${input.relatedProject.name} with ordered phases, risks, approval requirements, and recommended next action${goal}.`;
    }
    return `Create a practical plan for ${project} that turns "${request}" into sequenced, reviewable progress${goal}.`;
  }

  if (input.intentType === "Research Request") {
    return `Research "${request}" for ${project} and produce a decision-ready brief with recommended next action${goal}.`;
  }

  if (input.intake.action.kind === "instantiate_project") {
    const template = input.intake.action.template?.name ?? input.intake.extractedFields.template ?? "project";
    const projectName = input.intake.action.projectName ?? input.intake.extractedFields.projectName ?? "the new project";
    return `Create ${projectName} as a ${template} with local, inspectable setup and validation.`;
  }

  if (input.intake.action.kind === "create_work") {
    const action = subject ?? input.intake.action.title;
    return `${input.planningRecommended ? "Plan and implement" : "Implement"} ${action} for ${project}${goal}.`;
  }

  if (input.intake.action.kind === "update_entity_attribute" && input.intake.action.attributeName && input.intake.action.value) {
    return `Update ${project} ${input.intake.action.attributeName} to "${input.intake.action.value}".`;
  }

  return `Advance ${project} by completing: ${request}.`;
}

function interpretedIntentForInput(input: StewardIntentInput, intentType: StewardshipIntentType): string {
  if (intentType === "Planning Request") {
    return `Plan: ${stripTerminalPunctuation(input.rawInput.trim())}`;
  }

  if (intentType === "Research Request") {
    return `Research: ${stripTerminalPunctuation(input.rawInput.trim())}`;
  }

  return input.intake.proposedAction || input.resolved.title;
}

function classificationReasonForInput(
  input: StewardIntentInput,
  intentType: StewardshipIntentType,
  executionPath: StewardshipExecutionPath,
  planningRecommended: boolean
): string {
  if (executionPath === "Clarify First") {
    return `The input is action-shaped but missing required context: ${input.intake.missingFields.join(", ") || "target"}.`;
  }

  if (executionPath === "Requires Review") {
    return "The intent is concrete, but execution crosses an approval boundary or cannot be safely run without review.";
  }

  if (executionPath === "Plan First") {
    return planningRecommended
      ? "The request involves planning, research, scope, uncertainty, or approval risk, so a plan should precede execution."
      : "The request is best handled as a planning packet before any implementation.";
  }

  if (executionPath === "Back Burner") {
    return intentType === "Review Response"
      ? "The input looks like a review reply but has no review reference, so it is preserved without guessing."
      : input.intake.classificationReason || "The input is exploratory or not yet concrete enough for execution.";
  }

  if (executionPath === "Blocked") {
    return "There is no input to steward.";
  }

  return input.intake.explanation || "The deterministic resolver found a safe, concrete action.";
}

function relatedProjectFromIntake(intake: IntakeResult): StewardshipRelatedProject | null {
  if (intake.project) {
    return { id: intake.project.id, name: intake.project.name };
  }

  switch (intake.action.kind) {
    case "create_work":
      return intake.action.projectId ? { id: intake.action.projectId, name: intake.extractedFields.project ?? intake.action.projectId } : null;
    case "update_entity_attribute":
      return intake.action.entityId ? { id: intake.action.entityId, name: intake.action.entityName ?? intake.action.entityId } : null;
    case "show_project":
      return intake.action.projectId ? { id: intake.action.projectId, name: intake.extractedFields.project ?? intake.action.projectId } : null;
    default:
      return null;
  }
}

function relatedGoalForProject(projectId: string | null, context: IntakeWorkspaceContext): string | null {
  if (!projectId) {
    return null;
  }

  return context.projects.find((project) => project.id === projectId)?.goal ?? null;
}

function isPlanningRequest(normalized: string): boolean {
  return /\b(?:plan|planning|roadmap|strategy|scope|break down|sequence|milestone plan|implementation plan)\b/.test(normalized);
}

function isResearchRequest(normalized: string): boolean {
  return /\b(?:research|investigate|compare|evaluate|look into|find out|survey)\b/.test(normalized);
}

function requiresProjectForPlan(normalized: string): boolean {
  return /\b(?:for|in|on)\s+(?:the\s+)?project\b/.test(normalized) || /\b(?:implement|build|fix|ship|release)\b/.test(normalized);
}

function commandShapedMissingTarget(normalized: string, intake: IntakeResult): boolean {
  if (intake.project) {
    return false;
  }

  return /^(?:please\s+)?(?:add|build|implement|prepare|fix|create|write|ship|update|change|set|plan|research|investigate|publish|keep|continue|work)\b/.test(normalized);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function stripTerminalPunctuation(value: string): string {
  return value.replace(/[.!?]+$/g, "").trim();
}

function canonicalSubjectForInput(input: StewardIntentInput): string | null {
  const platform = input.intake.extractedFields.platform;
  const purpose = input.intake.extractedFields.purpose;
  const action = input.intake.extractedFields.action;
  const requestedAction = input.intake.extractedFields.requestedAction;

  const base = purpose || action || requestedAction;
  if (!base && !platform) {
    return null;
  }

  const withoutPlatform = platform
    ? cleanSubject(base.replace(new RegExp(`\\b(?:for|to|in)\\s+${escapeRegExp(platform)}\\b.*$`, "i"), ""))
    : cleanSubject(base);
  if (platform && withoutPlatform && !normalize(withoutPlatform).includes(normalize(platform))) {
    return `${platform} ${decapitalize(withoutPlatform)}`;
  }

  return withoutPlatform || platform || null;
}

function cleanSubject(value: string): string {
  return stripTerminalPunctuation(value)
    .replace(/^(?:plan\s+and\s+implement|implement|plan|build|add|create|prepare|fix|publish|improve)\s+/i, "")
    .trim();
}

function decapitalize(value: string): string {
  const trimmed = value.trim();
  return trimmed ? `${trimmed[0].toLowerCase()}${trimmed.slice(1)}` : trimmed;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
