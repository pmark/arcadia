import type { PlanningArtifactValidationIssueSeverity } from "../src/stewardship/artifactValidator.js";

export interface PlanningArtifactValidationFixture {
  name: string;
  packetText: string;
  artifactText: string;
  expect: {
    passed: boolean;
    failures: string[];
    warnings: string[];
    warningOnly?: boolean;
  };
}

export const completePlanningPacket = [
  "# Arcadia Codex Planning Packet",
  "",
  "## Goal",
  "Create a practical plan for deterministic Stewardship Artifact Validation for Arcadia.",
  "",
  "## Acceptance Criteria",
  "- Deliver the expected planning artifact: Deterministic planning artifact validation plan.",
  "- Include ordered phases, concrete expected artifacts, repository impact assessment, approval needs, validation strategy, risks/open questions, and the smallest useful follow-up Codex implementation goal.",
  "- Do not require tests, lint, deployment, credentials, publishing, spending, production access, or outbound actions unless files are changed while preparing the plan.",
  "",
  "## Approval Boundaries",
  "- Do not publish, deploy, merge, delete, spend money, use credentials, access production data, or send messages.",
  "- Planning is safe to perform now; implementation, credential setup, publishing, deployment, spending, production access, and outbound actions are future phases that require separate approval before execution.",
  "",
  "## Approval Gates",
  "- None required for planning-only packet creation.",
  "- Future implementation approval required before execution: credentials_required: credentials or external-service access require explicit approval.",
  "- Future implementation approval required before execution: publication: publishing or posting requires explicit approval.",
  "",
  "## Expected Artifact",
  "Deterministic planning artifact validation plan with phases, risks, approvals, repository impact, validation strategy, and smallest follow-up Codex goal.",
  "",
  "## Repository Impact Assessment",
  "- Target repository/path: /Users/pmark/Dev/MR/Arcadia/arcadia.",
  "- Likely future implementation area: src/stewardship artifact validation.",
  "",
  "## Smallest Useful Follow-up Codex Goal",
  "After this plan is reviewed, open the smallest useful Codex implementation goal: implement deterministic planning artifact validation and fixture tests only, with no external services.",
  "",
  "## Execution Instruction",
  "Plan only. Do not make implementation changes. Preserve the original implementation intent by describing implementation as a future phase that requires a separate approved Codex implementation goal.",
  "",
  "## Discovery And Validation",
  "- Validation strategy: identify deterministic fixture tests for future implementation, likely `pnpm test`.",
  "- Do not run tests or lint for this planning-only packet unless files change while preparing the plan.",
  "",
  "## Final Reporting Requirements",
  "- Summarize the planning outcome only.",
  "- List the concrete planning artifacts produced.",
  "- Identify future approval needs, open questions, and blockers before implementation."
].join("\n");

export const completePlanningArtifact = [
  "# Deterministic Stewardship Artifact Validation Plan",
  "",
  "## Ordered Phases",
  "1. Contract extraction: parse the originating planning packet sections that define artifact expectations, approval boundaries, validation guidance, and follow-up goal requirements.",
  "2. Artifact completeness checks: validate the planning artifact includes ordered phases, risks or open questions, approval requirements, repository impact, validation strategy, recommended next action, and the required follow-up goal.",
  "3. Consistency checks: reject claims of implementation, unsupported validation execution claims, and approval boundary contradictions.",
  "4. Workflow integration: expose a read-only validation result before the artifact is promoted for operator review.",
  "",
  "## Repository Impact Assessment",
  "- Primary area: `src/stewardship` deterministic validation module.",
  "- CLI area: artifact validation command wiring only.",
  "- Regression area: fixture-driven Vitest coverage.",
  "- Existing ask, review, Back Burner, dashboard, Discord, mission logs, and packet generation remain compatible because validation is read-only.",
  "",
  "## Approval Requirements",
  "- Planning only: no implementation changes are authorized by the originating packet.",
  "- Future implementation requires a separate approved Codex goal before repository changes.",
  "- Credentials, publishing, deployment, spending, production data, outbound messages, deletion, merge, and external services remain blocked without explicit approval.",
  "",
  "## Validation Strategy",
  "- Use deterministic fixtures for pass, failure, and warning cases.",
  "- Future implementation should run the existing test suite plus the new artifact validation tests.",
  "- This planning artifact did not execute validation commands because the packet only asked for a validation strategy.",
  "",
  "## Risks And Open Questions",
  "- Risk: regex checks may be too permissive or too strict, so fixtures should cover known false-positive surfaces.",
  "- Open question: whether future workflows should store validation summaries in artifact metadata or keep them command-only.",
  "",
  "## Recommended Next Action",
  "Approve the first repository-only implementation slice for the deterministic planning artifact validator and its fixture tests.",
  "",
  "## Smallest Useful Follow-up Codex Goal",
  "Implement the deterministic planning artifact validator module, read-only artifact validation command, and fixture-driven tests only, with no dashboard or Discord redesign."
].join("\n");

export const planningArtifactValidationFixtures: PlanningArtifactValidationFixture[] = [
  {
    name: "passes complete planning artifact",
    packetText: completePlanningPacket,
    artifactText: completePlanningArtifact,
    expect: {
      passed: true,
      failures: [],
      warnings: []
    }
  },
  failureFixture("fails missing ordered phases", omitSection(completePlanningArtifact, "Ordered Phases"), "missing_ordered_phases"),
  failureFixture(
    "fails missing risks or open questions",
    omitSection(completePlanningArtifact, "Risks And Open Questions"),
    "missing_risks_or_open_questions"
  ),
  failureFixture(
    "fails missing approval requirements",
    omitSection(completePlanningArtifact, "Approval Requirements"),
    "missing_approval_requirements"
  ),
  failureFixture(
    "fails missing repository impact assessment",
    omitSection(completePlanningArtifact, "Repository Impact Assessment"),
    "missing_repository_impact_assessment"
  ),
  failureFixture(
    "fails missing validation strategy",
    omitSection(completePlanningArtifact, "Validation Strategy"),
    "missing_validation_strategy"
  ),
  failureFixture(
    "fails missing recommended next action",
    omitSection(completePlanningArtifact, "Recommended Next Action"),
    "missing_recommended_next_action"
  ),
  failureFixture(
    "fails missing smallest follow-up Codex goal",
    omitSection(completePlanningArtifact, "Smallest Useful Follow-up Codex Goal"),
    "missing_smallest_follow_up_goal"
  ),
  failureFixture(
    "fails planning artifact claiming implementation occurred",
    [
      completePlanningArtifact,
      "",
      "## Implementation Outcome",
      "Codex implemented src/stewardship/artifactValidator.ts and updated tests."
    ].join("\n"),
    "implementation_claim_in_planning_artifact"
  ),
  failureFixture(
    "fails planning artifact claiming validation commands executed",
    replaceSection(
      completePlanningArtifact,
      "Validation Strategy",
      [
        "## Validation Strategy",
        "- Ran `pnpm test` and tests passed.",
        "- This confirms the implementation is complete."
      ].join("\n")
    ),
    "validation_execution_claim_not_required"
  ),
  failureFixture(
    "fails planning artifact contradicting approval boundaries",
    replaceSection(
      completePlanningArtifact,
      "Approval Requirements",
      [
        "## Approval Requirements",
        "- No approval is required for implementation or credentials.",
        "- Publishing can proceed directly without approval after the plan."
      ].join("\n")
    ),
    "approval_boundary_contradiction"
  ),
  warningFixture(
    "warns for vague next action",
    replaceSection(
      completePlanningArtifact,
      "Recommended Next Action",
      ["## Recommended Next Action", "Review."].join("\n")
    ),
    "vague_recommended_next_action"
  ),
  warningFixture(
    "warns for overbroad follow-up goal",
    replaceSection(
      completePlanningArtifact,
      "Smallest Useful Follow-up Codex Goal",
      [
        "## Smallest Useful Follow-up Codex Goal",
        "Implement the full end-to-end production rollout for all remaining Arcadia stewardship work."
      ].join("\n")
    ),
    "overbroad_follow_up_goal"
  ),
  warningFixture(
    "warns for effectively empty risks section",
    replaceSection(
      completePlanningArtifact,
      "Risks And Open Questions",
      ["## Risks And Open Questions", "None."].join("\n")
    ),
    "empty_risks_or_open_questions"
  )
];

function failureFixture(name: string, artifactText: string, failure: string): PlanningArtifactValidationFixture {
  return {
    name,
    packetText: completePlanningPacket,
    artifactText,
    expect: {
      passed: false,
      failures: [failure],
      warnings: []
    }
  };
}

function warningFixture(name: string, artifactText: string, warning: string): PlanningArtifactValidationFixture {
  return {
    name,
    packetText: completePlanningPacket,
    artifactText,
    expect: {
      passed: true,
      failures: [],
      warnings: [warning],
      warningOnly: true
    }
  };
}

function omitSection(markdown: string, title: string): string {
  return replaceSection(markdown, title, "");
}

function replaceSection(markdown: string, title: string, replacement: string): string {
  const pattern = new RegExp(`(^|\\n)## ${escapeRegExp(title)}\\n[\\s\\S]*?(?=\\n## |$)`);
  return markdown.replace(pattern, replacement ? `$1${replacement}` : "$1").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function issueCodesBySeverity(
  issues: Array<{ code: string; severity: PlanningArtifactValidationIssueSeverity }>,
  severity: PlanningArtifactValidationIssueSeverity
): string[] {
  return issues.filter((issue) => issue.severity === severity).map((issue) => issue.code);
}
