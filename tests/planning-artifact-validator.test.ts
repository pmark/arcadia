import { describe, expect, it } from "vitest";
import { validatePlanningArtifact } from "../src/stewardship/artifactValidator.js";
import {
  completePlanningArtifact,
  completePlanningPacket,
  issueCodesBySeverity,
  planningArtifactValidationFixtures
} from "./planningArtifactValidationFixtures.js";

describe("planning artifact validator fixtures", () => {
  for (const fixture of planningArtifactValidationFixtures) {
    it(fixture.name, () => {
      const result = validatePlanningArtifact({
        packetText: fixture.packetText,
        artifactText: fixture.artifactText
      });

      expect(result.validator).toBe("deterministic_planning_artifact_validator");
      expect(result.artifactKind).toBe("planning_artifact");
      expect(result.passed).toBe(fixture.expect.passed);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);

      const failureCodes = issueCodesBySeverity(result.failures, "failure");
      const warningCodes = issueCodesBySeverity(result.warnings, "warning");

      for (const failure of fixture.expect.failures) {
        expect(failureCodes, fixture.name).toContain(failure);
      }
      for (const warning of fixture.expect.warnings) {
        expect(warningCodes, fixture.name).toContain(warning);
      }

      if (fixture.expect.failures.length === 0) {
        expect(result.failures, fixture.name).toHaveLength(0);
      }
      if (fixture.expect.warnings.length === 0) {
        expect(result.warnings, fixture.name).toHaveLength(0);
      }

      if (fixture.expect.warningOnly) {
        expect(result.passed).toBe(true);
        expect(result.failures).toHaveLength(0);
        expect(result.warnings.length).toBeGreaterThan(0);
      }
    });
  }

  it("returns a machine-readable contract derived from the originating packet", () => {
    const result = validatePlanningArtifact({
      packetText: planningArtifactValidationFixtures[0].packetText,
      artifactText: planningArtifactValidationFixtures[0].artifactText
    });

    expect(result.contract).toMatchObject({
      planningOnly: true,
      repositoryImpactRequired: true,
      smallestFollowUpGoalRequired: true,
      validationExecutionRequired: false
    });
    expect(result.contract.expectedArtifact).toContain("Deterministic planning artifact validation plan");
    expect(result.contract.approvalGateTypes).toContain("credentials_required");
    expect(result.contract.approvalBoundaryKeywords).toContain("credentials");
  });
});

describe("validation-execution claim detection", () => {
  const complete = planningArtifactValidationFixtures.find((fixture) => fixture.name === "passes complete planning artifact")!;
  const codesFor = (extraLine: string): string[] =>
    issueCodesBySeverity(
      validatePlanningArtifact({
        packetText: complete.packetText,
        artifactText: `${complete.artifactText}\n${extraLine}\n`
      }).failures,
      "failure"
    );

  it.each([
    "- No files changed this session, so no validation ran in this planning packet.",
    "Nothing was run: no tests passed or failed because none were executed.",
    "We did not run pnpm test; the checks were not run."
  ])("does not treat a disclaimer as a claim: %s", (line) => {
    expect(codesFor(line)).not.toContain("validation_execution_claim_not_required");
  });

  it.each([
    "Tests passed locally.",
    "I ran `pnpm test` and lint completed.",
    "No validation ran locally, but tests passed in CI."
  ])(
    "still flags an affirmative claim: %s",
    (line) => {
      expect(codesFor(line)).toContain("validation_execution_claim_not_required");
    }
  );
});

describe("implementation claim detection ignores disclaimers and plan-file writes (R494)", () => {
  const codesFor = (extraLine: string): string[] =>
    issueCodesBySeverity(
      validatePlanningArtifact({
        packetText: completePlanningPacket,
        artifactText: `${completePlanningArtifact}\n${extraLine}\n`
      }).failures,
      "failure"
    );

  it.each([
    // The exact live line from review item R494.
    "I changed no repository files, only the plan file. That's why I didn't run tests or lint, as the packet allows.",
    "I changed nothing in the repository.",
    "We modified no source files; no changes were made to tests.",
    "No implementation changes made.",
    "We have not modified files outside the plan.",
    "I have never modified files in src/.",
    "I updated only the plan file.",
    "I created the plan file at docs/plans/example.md.",
    "I wrote the planning artifact.",
    "I changed no files except the plan file.",
    "I changed no repository files other than the plan file at docs/plans/example.md.",
    "I changed no repository files and updated the plan file.",
    "I read the launcher, then wrote the plan file.",
    "Phase 2, then add the assertion and replace the stale comment.",
    // Participles used as adjectives after a split are not claims (live planning artifacts).
    "- Reject changed request content and changed resolution; display current facts.",
    "- Any change to authority: a versioned decision, updated constitution and migration notes."
  ])("does not treat a disclaimer or plan-file write as a claim: %s", (line) => {
    expect(codesFor(line)).not.toContain("implementation_claim_in_planning_artifact");
  });

  it.each([
    "Codex implemented src/stewardship/artifactValidator.ts and updated tests.",
    "I changed no repository files, but I modified src/cli.ts.",
    "I changed no other files and modified src/cli.ts.",
    // R1 review: each passed on the first fix but fails on main.
    "I changed no files except src/cli.ts",
    "I modified no fewer than three files in src/",
    "I fixed nothing less than the parser in src/parser.ts",
    "I updated none of the docs; I rewrote src/cli.ts",
    "I modified the plan file at src/cli.ts",
    "I updated the planning doc in src/planner.ts",
    "I changed nothing other than tests/system-tmux-long-command.test.ts.",
    "I edited the launcher.",
    "Then fixed src/cli.ts and fixed tests/cli.test.ts.",
    "I updated only the plan file and then modified src/cli.ts.",
    "I updated only the plan file and modified the launcher in src/sessions/tmuxLauncher.ts.",
    "I updated only the plan file and fixed the launcher in src/sessions/tmuxLauncher.ts.",
    "I updated only the plan file and changed the launcher in src/sessions/tmuxLauncher.ts.",
    "I updated only the plan file and implemented the launcher in src/sessions/tmuxLauncher.ts.",
    "I updated only the plan file and added the launcher in src/sessions/tmuxLauncher.ts.",
    "I updated only the plan file and updated the launcher in src/sessions/tmuxLauncher.ts.",
    "I updated only the plan file and edited the launcher in src/sessions/tmuxLauncher.ts.",
    "I updated only the plan file and wrote the launcher in src/sessions/tmuxLauncher.ts.",
    "I updated only the plan file and refactored the launcher in src/sessions/tmuxLauncher.ts.",
    "I updated only the plan file and removed the launcher in src/sessions/tmuxLauncher.ts.",
    "I updated only the plan file and deleted the launcher in src/sessions/tmuxLauncher.ts.",
    "I updated only the plan file and created the launcher in src/sessions/tmuxLauncher.ts.",
    "I updated only the plan file and patched the launcher in src/sessions/tmuxLauncher.ts.",
    "I updated only the plan file, then I fixed the launcher in src/sessions/tmuxLauncher.ts.",
    "I changed the launcher to remove its temporary directory.",
    "I fixed no-op handling in the worker.",
    "Implementation completed.",
    "Modified tests/system-tmux-long-command.test.ts.",
    "## Files Changed"
  ])("still flags an affirmative claim: %s", (line) => {
    expect(codesFor(line)).toContain("implementation_claim_in_planning_artifact");
  });
});

describe("approval contradiction is judged per sentence (Issue #1277)", () => {
  const failureCodes = (extraLine: string): string[] =>
    validatePlanningArtifact({
      packetText: completePlanningPacket,
      artifactText: `${completePlanningArtifact}\n${extraLine}`
    }).failures.map((failure) => failure.code);

  it("passes the planner's standard phrasing: the run needs no approval, the implementation needs a separate one", () => {
    expect(
      failureCodes(
        "Planning requires no approval. Implementation requires a **separate approved Codex implementation goal** covering this repository change."
      )
    ).not.toContain("approval_boundary_contradiction");
  });

  it.each([
    "Planning requires no approval, and implementation requires a separate approved Codex goal.",
    "The run itself needs no approval. The later implementation needs a separate approved goal.",
    "Implementation requires a separate approved goal; planning itself needs no approval."
  ])("passes a benign variant of the standard phrasing: %s", (line) => {
    expect(failureCodes(line)).not.toContain("approval_boundary_contradiction");
  });

  it("still fails a sentence saying the implementation needs no approval", () => {
    expect(failureCodes("Implementation requires no approval.")).toContain("approval_boundary_contradiction");
    expect(failureCodes("Planning requires no approval. Implementation requires no approval.")).toContain(
      "approval_boundary_contradiction"
    );
  });

  it.each([
    "Implementation requires no approval, but a separate approval is nice to have.",
    "Implementation needs no approval; it requires a separate approval for nothing.",
    "Implementation requires no approval, whereas planning needs a separate approval gate.",
    "Implementation, i.e. the code change, needs no approval.",
    "Implementation can proceed directly; planning requires a separate approved goal.",
    "Implementation needs no approval for a separate approved goal.",
    // cross-sentence anaphora
    "Implementation follows. It needs no approval.",
    "Implementation needs a separate approved goal. It does not need approval from anyone else.",
    // negation forms, straight and curly apostrophes
    "Implementation does not need an approved goal.",
    "Implementation does not require approval.",
    "Implementation doesn't need approval.",
    "Implementation doesn’t need approval.",
    // pre-granted
    "Implementation is pre-approved.",
    "Implementation is already approved.",
    "Implementation may proceed without further approval.",
    // gate stated, then withdrawn
    "Implementation requires a separate approved goal, and needs no approval.",
    "Implementation needs separate approval; no further approval is needed.",
    // the separate approved goal itself denied
    "Implementation requires no separate approved goal.",
    "A separate approved goal is not required for implementation.",
    "Implementation does not need a separate approved goal.",
    "Implementation is not subject to approval.",
    // synonyms for the implementation
    "Building the change needs no approval.",
    "The patch ships with no approval.",
    "The pull request needs no approval.",
    "Coding needs no approval."
  ])("fails closed on an adversarial pairing: %s", (line) => {
    expect(failureCodes(line)).toContain("approval_boundary_contradiction");
  });

  it.each([
    "Planning needs no approval; implementation requires a separate approved goal.",
    "Planning requires no approval, whereas implementation, deployment and merge each need a separate approved goal.",
    "No approval is needed to run this plan. Implementation requires a separate approved goal.",
    "No approval is needed to produce this implementation plan.",
    "Implementation must not begin without a separate approved goal.",
    "Implementation requires a separate approved goal before any code change.",
    "This run requires no approval, and the later implementation needs a separate approved Codex goal covering this change.",
    "Implementation requires approval via a separate approved goal (no approval is needed to run this plan)."
  ])("passes a realistic planner phrasing: %s", (line) => {
    expect(failureCodes(line)).not.toContain("approval_boundary_contradiction");
  });
});
