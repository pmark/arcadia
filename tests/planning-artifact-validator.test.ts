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
    "Implementation needs no approval for a separate approved goal."
  ])("fails closed on an adversarial pairing: %s", (line) => {
    expect(failureCodes(line)).toContain("approval_boundary_contradiction");
  });
});
