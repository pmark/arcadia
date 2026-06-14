import { describe, expect, it } from "vitest";
import { validatePlanningArtifact } from "../src/stewardship/artifactValidator.js";
import {
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
