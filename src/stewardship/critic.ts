import type { CodexInvocationPurpose } from "../domain/constants.js";
import type { GoalStewardshipResult, StewardshipExecutionPath } from "./index.js";

export const STEWARDSHIP_CRITIC_TYPES = [
  "deterministic_critic",
  "local_llm_critic",
  "disabled_critic"
] as const;

export type StewardshipCriticType = (typeof STEWARDSHIP_CRITIC_TYPES)[number];

export const CRITIQUE_TARGET_KINDS = [
  "codex_build_packet",
  "codex_planning_packet",
  "stewardship_decision",
  "goal_definition",
  "clarification_prompt",
  "generated_summary"
] as const;

export type CritiqueTargetKind = (typeof CRITIQUE_TARGET_KINDS)[number];

export const CRITIQUE_STATUSES = [
  "approved",
  "revision_recommended",
  "clarification_recommended",
  "requires_review_recommended"
] as const;

export type CritiqueStatus = (typeof CRITIQUE_STATUSES)[number];
export type CritiqueConfidence = "high" | "medium" | "low";
export type CritiqueFindingSeverity = "info" | "warning" | "blocker";
export type CritiquePolicy = "always" | "optional" | "never";
export type CritiqueSource = "generated_artifact" | "historical_artifact" | "operator_approval";

export interface CritiqueFinding {
  check: string;
  severity: CritiqueFindingSeverity;
  message: string;
  evidence: string[];
  recommendation: string;
}

export interface StewardshipCritiqueResult {
  critic: StewardshipCriticType;
  targetKind: CritiqueTargetKind;
  status: CritiqueStatus;
  confidence: CritiqueConfidence;
  findings: CritiqueFinding[];
  recommendations: string[];
  rationale: string;
}

export interface StewardshipCritiqueInput {
  targetKind: CritiqueTargetKind;
  originalInput?: string | null;
  artifactText?: string | null;
  goalText?: string | null;
  acceptanceCriteria?: string | null;
  expectedArtifact?: string | null;
  executionPath?: StewardshipExecutionPath | null;
  rationale?: string | null;
  confidenceLabel?: CritiqueConfidence | null;
  clarificationRequired?: boolean | null;
  reviewRequired?: boolean | null;
  projectName?: string | null;
  platformName?: string | null;
  approvalBoundaries?: string[] | null;
  validationCommands?: string[] | null;
  metadata?: Record<string, unknown> | null;
  stewardship?: GoalStewardshipResult | null;
  purpose?: CodexInvocationPurpose | null;
}

export interface StewardshipCritic {
  readonly type: StewardshipCriticType;
  critique(input: StewardshipCritiqueInput): StewardshipCritiqueResult;
}

export interface LocalLlmCriticAdapter {
  critique(input: StewardshipCritiqueInput): StewardshipCritiqueResult;
}

export class LocalLlmStewardshipCritic implements StewardshipCritic {
  readonly type = "local_llm_critic" as const;

  constructor(private readonly adapter: LocalLlmCriticAdapter) {}

  critique(input: StewardshipCritiqueInput): StewardshipCritiqueResult {
    return this.adapter.critique(input);
  }
}

export class DisabledStewardshipCritic implements StewardshipCritic {
  readonly type = "disabled_critic" as const;

  critique(input: StewardshipCritiqueInput): StewardshipCritiqueResult {
    return {
      critic: this.type,
      targetKind: input.targetKind,
      status: "approved",
      confidence: "low",
      findings: [],
      recommendations: ["Critique disabled; no stewardship validation was performed."],
      rationale: "The disabled critic intentionally passes artifacts without review."
    };
  }
}

export class DeterministicStewardshipCritic implements StewardshipCritic {
  readonly type = "deterministic_critic" as const;

  critique(input: StewardshipCritiqueInput): StewardshipCritiqueResult {
    const findings: CritiqueFinding[] = [];
    const artifactText = text(input.artifactText);
    const originalInput = text(input.originalInput ?? input.stewardship?.originalInput);
    const goalText = text(input.goalText ?? input.stewardship?.generatedCodexGoalText);
    const acceptanceCriteria = text(input.acceptanceCriteria);
    const expectedArtifact = text(input.expectedArtifact);
    const executionPath = input.executionPath ?? input.stewardship?.recommendedExecutionPath ?? null;
    const rationale = text(input.rationale ?? input.stewardship?.classificationReason);
    const projectName = text(input.projectName ?? input.stewardship?.relatedProject?.name);
    const platformName = text(input.platformName);
    const confidenceLabel = input.confidenceLabel;
    const clarificationRequired = input.clarificationRequired ?? input.stewardship?.clarificationRequired ?? false;

    if (!artifactText && packetKind(input.targetKind)) {
      findings.push(finding(
        "artifact_text_present",
        "blocker",
        "Codex packets must be critiqued from visible packet text before execution.",
        [],
        "Render the packet text before critique and do not execute until critique can inspect it."
      ));
    }

    this.checkImportantNouns(findings, originalInput, [artifactText, goalText, expectedArtifact].join("\n"));
    this.checkGenericWording(findings, [artifactText, goalText, expectedArtifact, rationale].join("\n"));
    this.checkExpectedArtifact(findings, expectedArtifact);
    this.checkAcceptanceCriteria(findings, goalText || originalInput, acceptanceCriteria || artifactText);
    this.checkExecutionPathRationale(findings, executionPath, rationale);
    this.checkConfidence(findings, confidenceLabel, executionPath, clarificationRequired, originalInput, projectName);
    this.checkClarification(findings, originalInput, confidenceLabel, clarificationRequired, executionPath, projectName);
    this.checkApprovalBoundaries(findings, input.targetKind, artifactText, input.approvalBoundaries);
    this.checkValidationCommands(findings, input.targetKind, artifactText, input.validationCommands);
    this.checkProjectPlatform(findings, originalInput, artifactText, projectName, platformName);
    this.checkMetadata(findings, input.metadata);

    const status = statusForFindings(findings);
    const confidence = confidenceForFindings(findings, artifactText);
    const recommendations = recommendationsForFindings(findings, status);

    return {
      critic: this.type,
      targetKind: input.targetKind,
      status,
      confidence,
      findings,
      recommendations,
      rationale: rationaleForStatus(status, findings)
    };
  }

  private checkImportantNouns(findings: CritiqueFinding[], originalInput: string, artifactText: string): void {
    if (!originalInput || !artifactText) {
      return;
    }

    const nouns = importantNouns(originalInput);
    const missing = nouns.filter((noun) => !containsLoose(artifactText, noun));
    if (missing.length > 0) {
      findings.push(finding(
        "important_noun_preservation",
        "warning",
        "Important nouns from the operator input are missing from the stewarded artifact.",
        missing,
        "Preserve named projects, platforms, features, and concrete subjects from the original input."
      ));
    }
  }

  private checkGenericWording(findings: CritiqueFinding[], value: string): void {
    const generic = [
      "the relevant project",
      "the appropriate project",
      "the selected thing",
      "the thing",
      "requested work artifact"
    ].filter((phrase) => containsLoose(value, phrase));

    if (generic.length > 0) {
      findings.push(finding(
        "generic_wording",
        "warning",
        "Generic wording would force the operator or Codex to infer the target.",
        generic,
        "Replace generic placeholders with the resolved project, platform, feature, or outcome."
      ));
    }
  }

  private checkExpectedArtifact(findings: CritiqueFinding[], expectedArtifact: string): void {
    if (!expectedArtifact) {
      return;
    }

    const internalTerms = [
      "codex build packet",
      "codex planning packet",
      "codex prompt packet",
      "requires review item",
      "arcadia internals",
      "stewardship json"
    ].filter((term) => containsLoose(expectedArtifact, term));

    if (internalTerms.length > 0) {
      findings.push(finding(
        "expected_artifact_outcome",
        "warning",
        "Expected artifacts should describe the operator-visible outcome, not Arcadia internals.",
        internalTerms,
        "Name the deliverable or decision outcome the work should produce."
      ));
    }
  }

  private checkAcceptanceCriteria(findings: CritiqueFinding[], goalText: string, acceptanceCriteria: string): void {
    if (!goalText || !acceptanceCriteria) {
      return;
    }

    const goalNouns = importantNouns(goalText).slice(0, 5);
    if (goalNouns.length === 0) {
      return;
    }

    const missing = goalNouns.filter((noun) => !containsLoose(acceptanceCriteria, noun));
    if (missing.length >= Math.max(2, Math.ceil(goalNouns.length / 2))) {
      findings.push(finding(
        "acceptance_criteria_alignment",
        "warning",
        "Acceptance criteria do not preserve enough of the goal subject to guide validation.",
        missing,
        "Align acceptance criteria with the goal's project, platform, feature, and expected outcome."
      ));
    }
  }

  private checkExecutionPathRationale(
    findings: CritiqueFinding[],
    executionPath: StewardshipExecutionPath | null,
    rationale: string
  ): void {
    if (!executionPath || !rationale) {
      return;
    }

    const normalized = normalize(rationale);
    const consistent =
      executionPath === "Clarify First"
        ? /\b(?:missing|clarify|ambiguous|required context|target)\b/.test(normalized)
        : executionPath === "Requires Review"
          ? /\b(?:approval|review|boundary|safely|risk|credentials|publish|deploy)\b/.test(normalized)
          : executionPath === "Plan First"
            ? /\b(?:plan|planning|research|scope|risk|uncertainty|before execution)\b/.test(normalized)
            : executionPath === "Back Burner"
              ? /\b(?:preserved|exploratory|not yet concrete|without guessing|back burner)\b/.test(normalized)
              : executionPath === "Execute Directly"
                ? !/\b(?:missing|ambiguous|requires review|approval boundary|cannot be safely)\b/.test(normalized)
                : /\b(?:no input|blocked)\b/.test(normalized);

    if (!consistent) {
      findings.push(finding(
        "execution_path_rationale_consistency",
        "warning",
        "The execution path and rationale point in different directions.",
        [executionPath, rationale],
        "Revise the classification reason so it supports the selected execution path."
      ));
    }
  }

  private checkConfidence(
    findings: CritiqueFinding[],
    confidenceLabel: CritiqueConfidence | null | undefined,
    executionPath: StewardshipExecutionPath | null,
    clarificationRequired: boolean,
    originalInput: string,
    projectName: string
  ): void {
    if (!confidenceLabel) {
      return;
    }

    const vague = highAmbiguity(originalInput, projectName);
    if (confidenceLabel === "high" && vague) {
      findings.push(finding(
        "confidence_assignment",
        "blocker",
        "High confidence is inappropriate for an ambiguous target.",
        [originalInput],
        "Lower confidence and ask for clarification before producing execution work."
      ));
    }

    if (confidenceLabel === "low" && executionPath === "Execute Directly" && !clarificationRequired) {
      findings.push(finding(
        "confidence_assignment",
        "blocker",
        "Low-confidence stewardship cannot execute directly.",
        [executionPath],
        "Clarify or escalate to Requires Review before any execution path is approved."
      ));
    }
  }

  private checkClarification(
    findings: CritiqueFinding[],
    originalInput: string,
    confidenceLabel: CritiqueConfidence | null | undefined,
    clarificationRequired: boolean,
    executionPath: StewardshipExecutionPath | null,
    projectName: string
  ): void {
    if (!originalInput) {
      return;
    }

    if (
      highAmbiguity(originalInput, projectName) &&
      !clarificationRequired &&
      executionPath !== "Clarify First" &&
      confidenceLabel !== "high"
    ) {
      findings.push(finding(
        "ambiguity_clarification",
        "blocker",
        "Ambiguous stewardship should ask for clarification instead of guessing.",
        [originalInput],
        "Ask the operator to identify the project, target, or desired outcome."
      ));
    }
  }

  private checkApprovalBoundaries(
    findings: CritiqueFinding[],
    targetKind: CritiqueTargetKind,
    artifactText: string,
    approvalBoundaries: string[] | null | undefined
  ): void {
    if (!packetKind(targetKind) && targetKind !== "stewardship_decision") {
      return;
    }

    const boundaryText = [artifactText, ...(approvalBoundaries ?? [])].join("\n");
    const hasBoundary = /\bdo not\b/i.test(boundaryText) &&
      /\b(?:publish|deploy|merge|delete|credentials|production data|send messages|spend money)\b/i.test(boundaryText);

    if (!hasBoundary) {
      findings.push(finding(
        "approval_boundaries_present",
        "blocker",
        "Approval boundaries are missing or too weak for a packet that may precede Codex work.",
        [],
        "State concrete hard stops such as publishing, deployment, credentials, production data, messaging, deletion, and spending."
      ));
    }
  }

  private checkValidationCommands(
    findings: CritiqueFinding[],
    targetKind: CritiqueTargetKind,
    artifactText: string,
    validationCommands: string[] | null | undefined
  ): void {
    if (!packetKind(targetKind)) {
      return;
    }

    const commands = (validationCommands ?? []).map((command) => command.trim()).filter(Boolean);
    const hasFallbackGuidance = /\b(?:validation commands|determine validation|existing project validation|run validation command)\b/i.test(artifactText);
    const missing = commands.filter((command) => !artifactText.includes(command));

    if (!hasFallbackGuidance || missing.length > 0) {
      findings.push(finding(
        "validation_commands_included",
        "warning",
        "Validation guidance is missing or does not include the resolved project commands.",
        missing,
        "Include resolved validation commands or explicit guidance to discover and report the validation path."
      ));
    }
  }

  private checkProjectPlatform(
    findings: CritiqueFinding[],
    originalInput: string,
    artifactText: string,
    projectName: string,
    platformName: string
  ): void {
    if (!originalInput || !artifactText) {
      return;
    }

    if (projectName && platformName && normalize(projectName) === normalize(platformName)) {
      findings.push(finding(
        "project_platform_resolution",
        "blocker",
        "Project and platform resolved to the same value.",
        [projectName],
        "Resolve the durable Arcadia project separately from the external platform or channel."
      ));
      return;
    }

    if (projectName && platformName) {
      const missing = [projectName, platformName].filter((value) => !containsLoose(artifactText, value));
      if (missing.length > 0) {
        findings.push(finding(
          "project_platform_resolution",
          "blocker",
          "The artifact does not preserve both the resolved project and platform.",
          missing,
          "Revise the artifact so Codex sees the project as the workspace target and the platform as the feature or integration target."
        ));
      }
    }
  }

  private checkMetadata(findings: CritiqueFinding[], metadata: Record<string, unknown> | null | undefined): void {
    if (!metadata) {
      return;
    }

    const contaminated = semanticMetadataValues(metadata).filter(({ value }) => commandPhrased(value));
    if (contaminated.length > 0) {
      findings.push(finding(
        "metadata_command_contamination",
        "blocker",
        "Semantic metadata contains command phrasing instead of clean values.",
        contaminated.map(({ path, value }) => `${path}: ${value}`),
        "Store clean project, platform, mission, goal, status, and artifact values without leading command verbs."
      ));
    }
  }
}

export function createStewardshipCritic(type: StewardshipCriticType = "deterministic_critic"): StewardshipCritic {
  if (type === "disabled_critic") {
    return new DisabledStewardshipCritic();
  }

  if (type === "local_llm_critic") {
    return new LocalLlmStewardshipCritic({
      critique(input) {
        return {
          critic: "local_llm_critic",
          targetKind: input.targetKind,
          status: "revision_recommended",
          confidence: "low",
          findings: [finding(
            "local_llm_critic_unconfigured",
            "warning",
            "The local LLM critic interface is available but no local adapter is configured.",
            [],
            "Configure a local adapter before selecting local_llm_critic."
          )],
          recommendations: ["Use deterministic_critic until a local LLM adapter is configured."],
          rationale: "No external API dependency is available or required for the local LLM critic interface."
        };
      }
    });
  }

  return new DeterministicStewardshipCritic();
}

export function critiquePolicyForTarget(
  targetKind: CritiqueTargetKind,
  source: CritiqueSource = "generated_artifact"
): CritiquePolicy {
  if (source === "historical_artifact" || source === "operator_approval") {
    return "never";
  }

  if (targetKind === "codex_build_packet" || targetKind === "codex_planning_packet") {
    return "always";
  }

  if (targetKind === "goal_definition" || targetKind === "generated_summary") {
    return "optional";
  }

  return "optional";
}

export function renderCritiqueMarkdown(result: StewardshipCritiqueResult): string {
  const findings = result.findings.length > 0
    ? result.findings.map((item) => [
        `### ${item.check}`,
        `- Severity: ${item.severity}`,
        `- Message: ${item.message}`,
        `- Evidence: ${item.evidence.length > 0 ? item.evidence.join("; ") : "None"}`,
        `- Recommendation: ${item.recommendation}`
      ].join("\n")).join("\n\n")
    : "None";

  return [
    "# Stewardship Critique",
    "",
    `- Critic: ${result.critic}`,
    `- Target: ${result.targetKind}`,
    `- Status: ${result.status}`,
    `- Confidence: ${result.confidence}`,
    "",
    "## Rationale",
    result.rationale,
    "",
    "## Findings",
    findings,
    "",
    "## Recommendations",
    ...result.recommendations.map((item) => `- ${item}`)
  ].join("\n");
}

function packetKind(kind: CritiqueTargetKind): boolean {
  return kind === "codex_build_packet" || kind === "codex_planning_packet";
}

function statusForFindings(findings: CritiqueFinding[]): CritiqueStatus {
  if (findings.some((item) => item.check === "ambiguity_clarification")) {
    return "clarification_recommended";
  }

  if (findings.some((item) =>
    item.severity === "blocker" &&
    [
      "approval_boundaries_present",
      "project_platform_resolution",
      "metadata_command_contamination",
      "confidence_assignment",
      "artifact_text_present"
    ].includes(item.check)
  )) {
    return "requires_review_recommended";
  }

  if (findings.length > 0) {
    return "revision_recommended";
  }

  return "approved";
}

function confidenceForFindings(findings: CritiqueFinding[], artifactText: string): CritiqueConfidence {
  if (!artifactText) {
    return "low";
  }

  if (findings.some((item) => item.check === "important_noun_preservation" || item.check === "acceptance_criteria_alignment")) {
    return "medium";
  }

  return "high";
}

function recommendationsForFindings(findings: CritiqueFinding[], status: CritiqueStatus): string[] {
  if (findings.length === 0) {
    return ["Artifact is ready for the next bounded Arcadia step."];
  }

  const unique = [...new Set(findings.map((item) => item.recommendation))];
  if (status === "requires_review_recommended") {
    return ["Escalate to Requires Review before any execution.", ...unique];
  }
  if (status === "clarification_recommended") {
    return ["Ask for clarification before creating or executing work.", ...unique];
  }
  return unique;
}

function rationaleForStatus(status: CritiqueStatus, findings: CritiqueFinding[]): string {
  if (status === "approved") {
    return "Deterministic checks found preserved context, explicit boundaries, validation guidance, and aligned stewardship metadata.";
  }

  const checks = findings.map((item) => item.check).join(", ");
  if (status === "requires_review_recommended") {
    return `Deterministic checks found a blocker requiring operator judgment: ${checks}.`;
  }
  if (status === "clarification_recommended") {
    return `Deterministic checks found ambiguity that should be clarified before work is created: ${checks}.`;
  }
  return `Deterministic checks found fixable stewardship quality issues: ${checks}.`;
}

function finding(
  check: string,
  severity: CritiqueFindingSeverity,
  message: string,
  evidence: string[],
  recommendation: string
): CritiqueFinding {
  return { check, severity, message, evidence, recommendation };
}

function importantNouns(value: string): string[] {
  const phrases = value.match(/\b[A-Z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9]*)*\b/g) ?? [];
  const quoted = [...value.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  const tokens = value
    .split(/[^A-Za-z0-9]+/g)
    .filter((token) => token.length >= 5 && !STOP_WORDS.has(token.toLowerCase()) && !COMMAND_WORDS.has(token.toLowerCase()));
  return [...new Set([...phrases, ...quoted, ...tokens].map((item) => stripPossessive(item.trim())).filter((item) => item.length >= 3))];
}

function containsLoose(haystack: string, needle: string): boolean {
  return normalize(haystack).includes(normalize(needle));
}

function highAmbiguity(originalInput: string, projectName: string): boolean {
  const normalized = normalize(originalInput);
  if (!normalized) {
    return false;
  }

  const vagueReference = /\b(?:thing|stuff|it|this|that|keep going|continue)\b/.test(normalized);
  const actionShaped = /^(?:please\s+)?(?:add|build|implement|prepare|fix|create|write|ship|update|change|set|plan|research|investigate|publish|keep|continue|work)\b/.test(normalized);
  return actionShaped && vagueReference && !projectName;
}

function semanticMetadataValues(metadata: Record<string, unknown>): Array<{ path: string; value: string }> {
  const values: Array<{ path: string; value: string }> = [];
  const visit = (value: unknown, segments: string[]): void => {
    const key = segments.at(-1) ?? "";
    if (skipMetadataKey(key)) {
      return;
    }

    if (typeof value === "string") {
      values.push({ path: segments.join("."), value });
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...segments, String(index)]));
      return;
    }

    if (value && typeof value === "object") {
      for (const [childKey, childValue] of Object.entries(value)) {
        visit(childValue, [...segments, childKey]);
      }
    }
  };

  visit(metadata, []);
  return values;
}

function skipMetadataKey(key: string): boolean {
  return /(?:^id$|Id$|Path$|path$|command|Command|createdAt|updatedAt|agentProfile|workspaceScope|outputKind|purpose|^action$|requestedAction)/.test(key);
}

function commandPhrased(value: string): boolean {
  return /^(?:please\s+)?(?:change|set|update|make|implement|build|add|fix|ship|publish|create)\b/i.test(value.trim());
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function text(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function stripPossessive(value: string): string {
  return value.replace(/[’']s$/i, "");
}

const COMMAND_WORDS = new Set([
  "add",
  "build",
  "change",
  "continue",
  "create",
  "fix",
  "implement",
  "improve",
  "keep",
  "make",
  "plan",
  "prepare",
  "publish",
  "research",
  "set",
  "ship",
  "update",
  "write"
]);

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "before",
  "clear",
  "going",
  "local",
  "project",
  "review",
  "support",
  "thing",
  "using",
  "with",
  "without"
]);
