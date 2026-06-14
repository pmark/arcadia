export type PlanningArtifactValidationIssueSeverity = "failure" | "warning";

export interface PlanningArtifactValidationIssue {
  code: string;
  severity: PlanningArtifactValidationIssueSeverity;
  message: string;
  evidence: string[];
}

export interface PlanningArtifactValidationContract {
  planningOnly: boolean;
  repositoryImpactRequired: boolean;
  smallestFollowUpGoalRequired: boolean;
  validationExecutionRequired: boolean;
  expectedArtifact: string | null;
  approvalGateTypes: string[];
  approvalBoundaryKeywords: string[];
}

export interface PlanningArtifactValidationResult {
  validator: "deterministic_planning_artifact_validator";
  artifactKind: "planning_artifact";
  passed: boolean;
  score: number;
  contract: PlanningArtifactValidationContract;
  failures: PlanningArtifactValidationIssue[];
  warnings: PlanningArtifactValidationIssue[];
}

interface MarkdownSection {
  title: string;
  normalizedTitle: string;
  content: string;
}

const APPROVAL_BOUNDARY_KEYWORDS: Array<{ keyword: string; pattern: RegExp }> = [
  { keyword: "publishing", pattern: /\b(?:publish|publishing|publication|post|posting)\b/i },
  { keyword: "deployment", pattern: /\b(?:deploy|deployment|production release)\b/i },
  { keyword: "merge", pattern: /\bmerge\b/i },
  { keyword: "destructive filesystem changes", pattern: /\b(?:delete|deletion|destructive|remove files?)\b/i },
  { keyword: "spending", pattern: /\b(?:spend|spending|money|paid|purchase|financial)\b/i },
  { keyword: "credentials", pattern: /\b(?:credential|credentials|secret|api key|token|oauth)\b/i },
  { keyword: "production data", pattern: /\b(?:production data|production access|customer data|live data)\b/i },
  { keyword: "outbound messages", pattern: /\b(?:send messages|outbound|message|email|notification)\b/i }
];

export function validatePlanningArtifact(input: {
  packetText: string;
  artifactText: string;
}): PlanningArtifactValidationResult {
  const packetSections = parseMarkdownSections(input.packetText);
  const artifactSections = parseMarkdownSections(input.artifactText);
  const contract = derivePlanningArtifactContract(input.packetText, packetSections);
  const failures: PlanningArtifactValidationIssue[] = [];
  const warnings: PlanningArtifactValidationIssue[] = [];

  if (!contract.planningOnly) {
    failures.push(issue(
      "packet_not_planning_only",
      "failure",
      "Originating packet does not declare a planning-only contract.",
      []
    ));
  }

  if (!hasOrderedPhases(input.artifactText, artifactSections)) {
    failures.push(issue(
      "missing_ordered_phases",
      "failure",
      "Planning artifact must include ordered phases.",
      []
    ));
  }

  const riskSection = findSection(artifactSections, [/risks?/, /open questions?/, /unknowns?/, /blockers?/]);
  if (!riskSection) {
    failures.push(issue(
      "missing_risks_or_open_questions",
      "failure",
      "Planning artifact must include risks and/or open questions.",
      []
    ));
  } else if (effectivelyEmptySection(riskSection.content)) {
    warnings.push(issue(
      "empty_risks_or_open_questions",
      "warning",
      "Risks or open questions section is present but effectively empty.",
      [riskSection.title]
    ));
  }

  if (!hasSubstantiveSection(artifactSections, [/approval/])) {
    failures.push(issue(
      "missing_approval_requirements",
      "failure",
      "Planning artifact must include approval requirements.",
      []
    ));
  }

  if (
    contract.repositoryImpactRequired &&
    !hasSubstantiveSection(artifactSections, [/repository impact/, /repo impact/, /affected (?:files|areas|modules)/])
  ) {
    failures.push(issue(
      "missing_repository_impact_assessment",
      "failure",
      "Planning artifact must include a repository impact assessment required by the packet.",
      []
    ));
  }

  if (!hasValidationStrategy(artifactSections, input.artifactText)) {
    failures.push(issue(
      "missing_validation_strategy",
      "failure",
      "Planning artifact must include a validation strategy.",
      []
    ));
  }

  const nextAction = extractRecommendedNextAction(artifactSections, input.artifactText);
  if (!nextAction) {
    failures.push(issue(
      "missing_recommended_next_action",
      "failure",
      "Planning artifact must include a recommended next action.",
      []
    ));
  } else if (vagueNextAction(nextAction)) {
    warnings.push(issue(
      "vague_recommended_next_action",
      "warning",
      "Recommended next action is too vague to preserve operator momentum.",
      [nextAction]
    ));
  }

  const followUpGoal = extractSmallestFollowUpGoal(artifactSections, input.artifactText);
  if (contract.smallestFollowUpGoalRequired && !followUpGoal) {
    failures.push(issue(
      "missing_smallest_follow_up_goal",
      "failure",
      "Planning artifact must include the smallest useful follow-up Codex goal required by the packet.",
      []
    ));
  } else if (followUpGoal && overbroadFollowUpGoal(followUpGoal)) {
    warnings.push(issue(
      "overbroad_follow_up_goal",
      "warning",
      "Smallest follow-up Codex goal appears broader than the packet asks for.",
      [followUpGoal]
    ));
  }

  if (contract.planningOnly && claimsImplementationOccurred(input.artifactText)) {
    failures.push(issue(
      "implementation_claim_in_planning_artifact",
      "failure",
      "Planning artifact claims implementation changes occurred under a planning-only packet.",
      implementationClaimEvidence(input.artifactText)
    ));
  }

  if (!contract.validationExecutionRequired && claimsValidationCommandsExecuted(input.artifactText)) {
    failures.push(issue(
      "validation_execution_claim_not_required",
      "failure",
      "Planning artifact claims validation commands were executed even though the packet only required a validation strategy.",
      validationClaimEvidence(input.artifactText)
    ));
  }

  const approvalContradictions = approvalContradictionEvidence(input.artifactText, contract);
  if (approvalContradictions.length > 0) {
    failures.push(issue(
      "approval_boundary_contradiction",
      "failure",
      "Planning artifact contradicts approval boundaries or approval gates declared by the packet.",
      approvalContradictions
    ));
  }

  const score = Math.max(0, 100 - failures.length * 12 - warnings.length * 4);
  return {
    validator: "deterministic_planning_artifact_validator",
    artifactKind: "planning_artifact",
    passed: failures.length === 0,
    score,
    contract,
    failures,
    warnings
  };
}

function derivePlanningArtifactContract(
  packetText: string,
  sections: MarkdownSection[]
): PlanningArtifactValidationContract {
  const acceptanceCriteria = findSection(sections, [/acceptance criteria/])?.content ?? "";
  const executionInstruction = findSection(sections, [/execution instruction/])?.content ?? "";
  const approvalText = [
    findSection(sections, [/approval boundaries/])?.content ?? "",
    findSection(sections, [/approval gates/])?.content ?? ""
  ].join("\n");
  const discoveryAndValidation = findSection(sections, [/discovery and validation/, /validation/])?.content ?? "";
  const expectedArtifact = cleanSectionValue(findSection(sections, [/expected artifact/])?.content ?? "");
  const packetContractText = [packetText, executionInstruction].join("\n");

  return {
    planningOnly: /Arcadia Codex Planning Packet/i.test(packetText) ||
      /\bPlan only\b/i.test(executionInstruction) ||
      /\bplanning-only packet\b/i.test(packetContractText),
    repositoryImpactRequired: hasSection(sections, [/repository impact assessment/]) ||
      /\brepository impact assessment\b/i.test(acceptanceCriteria),
    smallestFollowUpGoalRequired: hasSection(sections, [/smallest useful follow-up codex goal/]) ||
      /\bsmallest useful follow-up\b/i.test(acceptanceCriteria),
    validationExecutionRequired: /\bRun validation command:/i.test(discoveryAndValidation) &&
      !/\bDo not run tests or lint\b[\s\S]*?\bunless files? change/i.test(discoveryAndValidation),
    expectedArtifact: expectedArtifact || null,
    approvalGateTypes: approvalGateTypes(approvalText),
    approvalBoundaryKeywords: approvalBoundaryKeywords(approvalText)
  };
}

function parseMarkdownSections(markdown: string): MarkdownSection[] {
  const headings = [...markdown.matchAll(/^(#{1,6})\s+(.+?)\s*$/gm)].map((match) => ({
    index: match.index ?? 0,
    title: match[2].trim()
  }));
  const sections: MarkdownSection[] = [];

  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const next = headings[index + 1];
    const contentStart = heading.index + markdown.slice(heading.index).indexOf("\n") + 1;
    const contentEnd = next?.index ?? markdown.length;
    sections.push({
      title: heading.title,
      normalizedTitle: normalize(heading.title),
      content: markdown.slice(contentStart, contentEnd).trim()
    });
  }

  return sections;
}

function hasOrderedPhases(markdown: string, sections: MarkdownSection[]): boolean {
  const phaseMarkers = [...markdown.matchAll(/(?:^|\n)\s*(?:#{1,6}\s*)?Phase\s+(\d+)\b/gim)]
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);
  if (hasIncreasingPair(phaseMarkers)) {
    return true;
  }

  const planSection = findSection(sections, [/ordered phases?/, /\bphases?\b/, /roadmap/, /implementation plan/]);
  if (!planSection) {
    return false;
  }

  const orderedItems = [...planSection.content.matchAll(/^\s*(\d+)\.\s+\S/gm)]
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);
  return hasIncreasingPair(orderedItems);
}

function hasIncreasingPair(values: number[]): boolean {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] > values[index - 1]) {
      return true;
    }
  }
  return false;
}

function hasValidationStrategy(sections: MarkdownSection[], artifactText: string): boolean {
  const section = findSection(sections, [/validation strategy/, /verification strategy/, /test strategy/]);
  const value = section?.content ?? artifactText;
  return Boolean(section) &&
    /\b(?:strategy|validate|validation|test|lint|fixture|manual|not required|future implementation)\b/i.test(value) &&
    !effectivelyEmptySection(value);
}

function extractRecommendedNextAction(sections: MarkdownSection[], artifactText: string): string | null {
  const section = findSection(sections, [/recommended next action/, /^next action$/]);
  if (section && !effectivelyEmptySection(section.content)) {
    return cleanSectionValue(section.content);
  }

  const inline = /(?:^|\n)\s*(?:[-*]\s*)?(?:Recommended\s+)?Next Action:\s*(.+)$/im.exec(artifactText);
  return inline?.[1]?.trim() || null;
}

function extractSmallestFollowUpGoal(sections: MarkdownSection[], artifactText: string): string | null {
  const section = findSection(sections, [/smallest.*follow.*goal/, /follow-up codex goal/]);
  if (section && !effectivelyEmptySection(section.content)) {
    return cleanSectionValue(section.content);
  }

  const inline = /(?:^|\n)\s*(?:[-*]\s*)?(?:Smallest Useful Follow-up Codex Goal|Follow-up Codex Goal):\s*(.+)$/im.exec(artifactText);
  return inline?.[1]?.trim() || null;
}

function findSection(sections: MarkdownSection[], patterns: RegExp[]): MarkdownSection | null {
  return sections.find((section) => patterns.some((pattern) => pattern.test(section.normalizedTitle))) ?? null;
}

function hasSection(sections: MarkdownSection[], patterns: RegExp[]): boolean {
  return Boolean(findSection(sections, patterns));
}

function hasSubstantiveSection(sections: MarkdownSection[], patterns: RegExp[]): boolean {
  const section = findSection(sections, patterns);
  return Boolean(section && !effectivelyEmptySection(section.content));
}

function effectivelyEmptySection(content: string): boolean {
  const cleaned = cleanSectionValue(content).replace(/[.!?]+$/g, "").trim();
  return !cleaned ||
    /^(?:none|n\/a|na|tbd|to be determined|unknown|not applicable|no risks?|no known risks?|no open questions?|nothing)$/i.test(cleaned);
}

function cleanSectionValue(content: string): string {
  return content
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*]|\d+\.)\s*/, "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

function vagueNextAction(value: string): boolean {
  const normalized = normalize(value);
  return normalized.split(" ").length < 4 ||
    /^(?:review|continue|proceed|do it|next|decide|move forward|review the plan|operator review)$/i.test(normalized) ||
    /\b(?:tbd|to be determined|as appropriate|when ready)\b/i.test(value);
}

function overbroadFollowUpGoal(value: string): boolean {
  return /\b(?:implement everything|everything|entire|all remaining|end to end|full implementation|complete implementation|whole system|production rollout)\b/i.test(value) &&
    !/\bfirst repository-only slice\b/i.test(value);
}

function claimsImplementationOccurred(artifactText: string): boolean {
  return implementationClaimEvidence(artifactText).length > 0;
}

function implementationClaimEvidence(artifactText: string): string[] {
  return matchingLines(artifactText, [
    /\b(?:I|we|Codex)\s+(?:implemented|changed|modified|updated|created|added|removed|deleted|refactored|fixed)\b/i,
    /\b(?:implementation|changes?)\s+(?:completed|made|landed|finished)\b/i,
    /\b(?:implemented|added|modified|updated|created|removed|deleted)\s+(?:src\/|tests?\/|the code|code|files?|implementation)\b/i,
    /^#{1,6}\s+(?:Files Changed|Changed Files)\b/i,
    /\bFiles changed:\s*(?!none\b|n\/a\b|not applicable\b)/i
  ]);
}

function claimsValidationCommandsExecuted(artifactText: string): boolean {
  return validationClaimEvidence(artifactText).length > 0;
}

function validationClaimEvidence(artifactText: string): string[] {
  return matchingLines(artifactText, [
    /\b(?:tests?|lint|validation|checks?)\s+(?:passed|completed|succeeded|ran|were run)\b/i,
    /\b(?:ran|executed|completed)\s+`?(?:pnpm|npm|yarn|bun|vitest|pytest|cargo|go test|swift test|xcodebuild|make)\b/i
  ]);
}

function approvalContradictionEvidence(
  artifactText: string,
  contract: PlanningArtifactValidationContract
): string[] {
  const lines = artifactText.split("\n").map((line) => line.trim()).filter(Boolean);
  const keywords = new Set([...contract.approvalBoundaryKeywords, ...contract.approvalGateTypes.map(humanizeGateType)]);
  if (contract.planningOnly) {
    keywords.add("implementation");
  }

  return lines.filter((line) => {
    const normalizedLine = normalize(line);
    if (!/\bapproval\b/.test(normalizedLine) && !/\bwithout\b/.test(normalizedLine)) {
      return false;
    }

    const contradictsApproval = /\b(?:no approval|approval is not required|approval not required|without approval|approved to|approval unnecessary|can proceed directly)\b/i.test(line);
    if (!contradictsApproval) {
      return false;
    }

    return [...keywords].some((keyword) => normalize(keyword).split(" ").some((token) => normalizedLine.includes(token)));
  });
}

function approvalGateTypes(approvalText: string): string[] {
  const matches = [
    ...approvalText.matchAll(/(?:^|\n)\s*-\s*(?:Future implementation approval required before execution:\s*)?([a-z_]+):/g)
  ];
  return [...new Set(matches.map((match) => match[1]))];
}

function approvalBoundaryKeywords(approvalText: string): string[] {
  return APPROVAL_BOUNDARY_KEYWORDS
    .filter((item) => item.pattern.test(approvalText))
    .map((item) => item.keyword);
}

function humanizeGateType(value: string): string {
  return value.replaceAll("_", " ");
}

function matchingLines(text: string, patterns: RegExp[]): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && patterns.some((pattern) => pattern.test(line)));
}

function issue(
  code: string,
  severity: PlanningArtifactValidationIssueSeverity,
  message: string,
  evidence: string[]
): PlanningArtifactValidationIssue {
  return { code, severity, message, evidence };
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}
