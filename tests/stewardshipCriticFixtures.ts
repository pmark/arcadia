import type {
  CritiqueConfidence,
  CritiqueStatus,
  StewardshipCritiqueInput
} from "../src/stewardship/critic.js";

export interface StewardshipCriticFixture {
  name: string;
  input: StewardshipCritiqueInput;
  expect: {
    status: CritiqueStatus;
    confidence?: CritiqueConfidence;
    checks: string[];
  };
}

const boundedPacket = [
  "## Goal",
  "Implement Pinterest publishing support for Rebuster.",
  "## Acceptance Criteria",
  "- Deliver Pinterest publishing support for Rebuster.",
  "- Preserve existing behavior outside the requested scope.",
  "## Approval Boundaries",
  "- Do not publish, deploy, merge, delete, spend money, use credentials, access production data, or send messages.",
  "## Expected Artifact",
  "Pinterest publishing implementation for Rebuster with tests.",
  "## Discovery And Validation",
  "- Validation commands: pnpm test",
  "- Run validation command: pnpm test"
].join("\n");

const boundedPlanningPacket = [
  "## Goal",
  "Create a practical plan for Pinterest publishing support for Rebuster.",
  "## Acceptance Criteria",
  "- Deliver the expected planning artifact: Pinterest publishing plan for Rebuster with ordered phases, risks/open questions, approval requirements, and recommended next action.",
  "- Preserve implementation intent by framing implementation as a future phase, not work authorized by this packet.",
  "## Approval Boundaries",
  "- Do not publish, deploy, merge, delete, spend money, use credentials, access production data, or send messages.",
  "- Planning is safe to perform now; implementation, credential setup, publishing, deployment, spending, production access, and outbound actions are future phases that require separate approval before execution.",
  "## Approval Gates",
  "- None required for planning-only packet creation.",
  "- Future implementation approval required before execution: credentials_required: credentials or external-service access require explicit approval.",
  "- Future implementation approval required before execution: publication: publishing or posting requires explicit approval.",
  "## Expected Artifact",
  "Pinterest publishing plan for Rebuster with ordered phases, risks/open questions, approval requirements, and recommended next action.",
  "## Repository Impact Assessment",
  "- Likely future implementation area: publishing/social integration modules.",
  "- Likely future implementation area: tests or fixtures covering outbound-action boundaries.",
  "## Smallest Useful Follow-up Codex Goal",
  "After this plan is reviewed, open the smallest useful Codex implementation goal: implement the first repository-only slice of Pinterest publishing support for Rebuster, with no credentials, publishing, deployment, spending, production access, or outbound actions.",
  "## Execution Instruction",
  "Plan only. Do not make implementation changes. Preserve the original implementation intent by describing implementation as a future phase that requires a separate approved Codex implementation goal.",
  "## Discovery And Validation",
  "- Validation strategy: identify the relevant validation path for future implementation, likely `pnpm test`.",
  "- Do not run tests or lint for this planning-only packet unless files change while preparing the plan.",
  "## Final Reporting Requirements",
  "- Summarize the planning outcome only.",
  "- List the concrete planning artifacts produced.",
  "- Identify future approval needs, open questions, and blockers before implementation."
].join("\n");

export const stewardshipCriticFixtures: StewardshipCriticFixture[] = [
  {
    name: "approves bounded Codex packet",
    input: {
      targetKind: "codex_build_packet",
      originalInput: "Implement Pinterest publishing support for Rebuster",
      artifactText: boundedPacket,
      goalText: "Implement Pinterest publishing support for Rebuster.",
      acceptanceCriteria: "Deliver Pinterest publishing support for Rebuster.",
      expectedArtifact: "Pinterest publishing implementation for Rebuster with tests.",
      executionPath: "Requires Review",
      rationale: "The intent is concrete, but execution crosses an approval boundary.",
      confidenceLabel: "high",
      projectName: "Rebuster",
      platformName: "Pinterest",
      approvalBoundaries: ["Do not publish, deploy, merge, delete, spend money, use credentials, access production data, or send messages."],
      validationCommands: ["pnpm test"],
      metadata: {
        project: { name: "Rebuster", mission: "Help users make better shipping decisions." },
        slots: { project: "Rebuster", platform: "Pinterest" }
      }
    },
    expect: {
      status: "approved",
      confidence: "high",
      checks: []
    }
  },
  {
    name: "approves bounded Codex planning packet",
    input: {
      targetKind: "codex_planning_packet",
      originalInput: "Plan Pinterest publishing support for Rebuster",
      artifactText: boundedPlanningPacket,
      goalText: "Plan Pinterest publishing support for Rebuster.",
      acceptanceCriteria: "Deliver Pinterest publishing plan for Rebuster.",
      expectedArtifact: "Pinterest publishing plan for Rebuster with ordered phases, risks/open questions, approval requirements, and recommended next action.",
      executionPath: "Plan First",
      rationale: "The request involves planning, scope, and risk, so a plan should precede execution.",
      confidenceLabel: "high",
      projectName: "Rebuster",
      platformName: "Pinterest",
      approvalBoundaries: ["Do not publish, deploy, merge, delete, spend money, use credentials, access production data, or send messages."],
      validationCommands: ["pnpm test"],
      metadata: {
        project: { name: "Rebuster", mission: "Help users make better shipping decisions." },
        slots: { project: "Rebuster", platform: "Pinterest" }
      }
    },
    expect: {
      status: "approved",
      confidence: "high",
      checks: []
    }
  },
  {
    name: "catches missing important nouns",
    input: {
      targetKind: "codex_build_packet",
      originalInput: "Implement Pinterest publishing support for Rebuster",
      artifactText: boundedPacket.replaceAll("Pinterest", "social").replaceAll("Rebuster", "the product"),
      goalText: "Implement publishing support.",
      acceptanceCriteria: "Deliver publishing support.",
      expectedArtifact: "Publishing implementation with tests.",
      executionPath: "Requires Review",
      rationale: "The intent is concrete, but execution crosses an approval boundary.",
      confidenceLabel: "high",
      approvalBoundaries: ["Do not publish, deploy, merge, delete, spend money, use credentials, access production data, or send messages."],
      validationCommands: ["pnpm test"]
    },
    expect: {
      status: "revision_recommended",
      confidence: "medium",
      checks: ["important_noun_preservation"]
    }
  },
  {
    name: "catches expected artifact describing Arcadia internals",
    input: {
      targetKind: "codex_build_packet",
      originalInput: "Build candidate review flow for Rebuster",
      artifactText: boundedPacket.replaceAll("Pinterest publishing", "candidate review"),
      goalText: "Build candidate review flow for Rebuster.",
      acceptanceCriteria: "Deliver candidate review flow for Rebuster.",
      expectedArtifact: "Codex build packet",
      executionPath: "Requires Review",
      rationale: "The intent is concrete, but execution crosses an approval boundary.",
      confidenceLabel: "high",
      projectName: "Rebuster",
      approvalBoundaries: ["Do not publish, deploy, merge, delete, spend money, use credentials, access production data, or send messages."],
      validationCommands: ["pnpm test"]
    },
    expect: {
      status: "revision_recommended",
      checks: ["expected_artifact_outcome"]
    }
  },
  {
    name: "catches execution path and rationale mismatch",
    input: {
      targetKind: "stewardship_decision",
      originalInput: "Fix the broken thing",
      artifactText: "Execution path: Execute Directly\nWhy: The project is missing and ambiguous.\nDo not publish, deploy, merge, delete, spend money, use credentials, access production data, or send messages.",
      executionPath: "Execute Directly",
      rationale: "The project is missing and ambiguous.",
      confidenceLabel: "medium",
      clarificationRequired: false
    },
    expect: {
      status: "clarification_recommended",
      checks: ["execution_path_rationale_consistency", "ambiguity_clarification"]
    }
  },
  {
    name: "catches project and platform collapsed together",
    input: {
      targetKind: "codex_build_packet",
      originalInput: "Implement Rebuster publishing support for Pinterest",
      artifactText: boundedPacket.replaceAll("Rebuster", "Pinterest"),
      goalText: "Implement publishing support for Pinterest.",
      acceptanceCriteria: "Deliver publishing support for Pinterest.",
      expectedArtifact: "Pinterest publishing implementation with tests.",
      executionPath: "Requires Review",
      rationale: "The intent is concrete, but execution crosses an approval boundary.",
      confidenceLabel: "high",
      projectName: "Pinterest",
      platformName: "Pinterest",
      approvalBoundaries: ["Do not publish, deploy, merge, delete, spend money, use credentials, access production data, or send messages."],
      validationCommands: ["pnpm test"]
    },
    expect: {
      status: "requires_review_recommended",
      checks: ["project_platform_resolution"]
    }
  },
  {
    name: "catches metadata command contamination",
    input: {
      targetKind: "goal_definition",
      originalInput: "Change Rebuster mission to Help creators publish evidence-backed posts.",
      artifactText: "Goal definition: Help creators publish evidence-backed posts.",
      expectedArtifact: "Project mission update",
      metadata: {
        project: {
          name: "Rebuster",
          mission: "Change Rebuster mission to Help creators publish evidence-backed posts."
        }
      }
    },
    expect: {
      status: "requires_review_recommended",
      checks: ["metadata_command_contamination"]
    }
  },
  {
    name: "catches high confidence assigned to ambiguous request",
    input: {
      targetKind: "stewardship_decision",
      originalInput: "Keep going on the thing",
      artifactText: "Execution path: Execute Directly\nWhy: Continue safely.\nDo not publish, deploy, merge, delete, spend money, use credentials, access production data, or send messages.",
      executionPath: "Execute Directly",
      rationale: "Continue safely.",
      confidenceLabel: "high",
      clarificationRequired: false
    },
    expect: {
      status: "requires_review_recommended",
      checks: ["confidence_assignment"]
    }
  },
  {
    name: "escalates missing approval boundaries",
    input: {
      targetKind: "codex_build_packet",
      originalInput: "Publish Rebuster posts to Pinterest using production credentials",
      artifactText: [
        "## Goal",
        "Publish Rebuster posts to Pinterest using production credentials.",
        "## Acceptance Criteria",
        "- Publish Rebuster posts to Pinterest.",
        "## Discovery And Validation",
        "- Validation commands: pnpm test"
      ].join("\n"),
      goalText: "Publish Rebuster posts to Pinterest using production credentials.",
      acceptanceCriteria: "Publish Rebuster posts to Pinterest.",
      expectedArtifact: "Pinterest publishing outcome for Rebuster.",
      executionPath: "Requires Review",
      rationale: "The intent is concrete, but execution crosses an approval boundary.",
      confidenceLabel: "high",
      projectName: "Rebuster",
      platformName: "Pinterest",
      validationCommands: ["pnpm test"]
    },
    expect: {
      status: "requires_review_recommended",
      checks: ["approval_boundaries_present"]
    }
  },
  {
    name: "catches planning packet that authorizes implementation work",
    input: {
      targetKind: "codex_planning_packet",
      originalInput: "Plan Pinterest publishing support for Rebuster",
      artifactText: [
        "## Goal",
        "Plan Pinterest publishing support for Rebuster.",
        "## Approval Boundaries",
        "- Do not publish, deploy, merge, delete, spend money, use credentials, access production data, or send messages.",
        "## Approval Gates",
        "None",
        "## Expected Artifact",
        "project execution plan",
        "## Execution Instruction",
        "Execute directly after local inspection.",
        "## Discovery And Validation",
        "- Run validation command: pnpm test",
        "- Report changed files, validation commands run, and any commands that could not be run.",
        "## Final Reporting Requirements",
        "- Summarize implementation or planning outcome."
      ].join("\n"),
      goalText: "Plan Pinterest publishing support for Rebuster.",
      acceptanceCriteria: "Deliver a project execution plan.",
      expectedArtifact: "project execution plan",
      executionPath: "Plan First",
      rationale: "The request involves planning, scope, and risk, so a plan should precede execution.",
      confidenceLabel: "high",
      projectName: "Rebuster",
      platformName: "Pinterest",
      approvalBoundaries: ["Do not publish, deploy, merge, delete, spend money, use credentials, access production data, or send messages."],
      validationCommands: ["pnpm test"]
    },
    expect: {
      status: "revision_recommended",
      checks: [
        "expected_artifact_concrete",
        "planning_packet_no_implementation_authorization",
        "planning_packet_required_sections",
        "planning_packet_conditional_validation",
        "planning_expected_artifact_specific"
      ]
    }
  },
  {
    name: "catches planning packet missing future approval visibility",
    input: {
      targetKind: "codex_planning_packet",
      originalInput: "Plan Pinterest publishing support for Rebuster",
      artifactText: boundedPlanningPacket
        .replace("- None required for planning-only packet creation.\n", "")
        .replaceAll(/- Future implementation approval required before execution:[^\n]+\n?/g, ""),
      goalText: "Plan Pinterest publishing support for Rebuster.",
      acceptanceCriteria: "Deliver Pinterest publishing plan for Rebuster.",
      expectedArtifact: "Pinterest publishing plan for Rebuster with ordered phases, risks/open questions, approval requirements, and recommended next action.",
      executionPath: "Plan First",
      rationale: "The request involves planning, scope, and risk, so a plan should precede execution.",
      confidenceLabel: "high",
      projectName: "Rebuster",
      platformName: "Pinterest",
      approvalBoundaries: ["Do not publish, deploy, merge, delete, spend money, use credentials, access production data, or send messages."],
      validationCommands: ["pnpm test"]
    },
    expect: {
      status: "revision_recommended",
      checks: ["planning_packet_required_sections"]
    }
  },
  {
    name: "recommends clarification under ambiguity",
    input: {
      targetKind: "clarification_prompt",
      originalInput: "Keep going on the thing",
      artifactText: "Continue current work.",
      executionPath: "Execute Directly",
      rationale: "The deterministic resolver found a safe, concrete action.",
      confidenceLabel: "medium",
      clarificationRequired: false
    },
    expect: {
      status: "clarification_recommended",
      checks: ["ambiguity_clarification"]
    }
  },
  {
    name: "catches generic generated summary",
    input: {
      targetKind: "generated_summary",
      originalInput: "Summarize Rebuster Pinterest publishing progress",
      artifactText: "The relevant project made useful progress on the requested work.",
      expectedArtifact: "Progress summary",
      confidenceLabel: "medium"
    },
    expect: {
      status: "revision_recommended",
      checks: ["important_noun_preservation", "generic_wording"]
    }
  }
];
