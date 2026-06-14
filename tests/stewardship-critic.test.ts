import { describe, expect, it } from "vitest";
import {
  createStewardshipCritic,
  critiquePolicyForTarget,
  DisabledStewardshipCritic,
  LocalLlmStewardshipCritic
} from "../src/stewardship/critic.js";
import { stewardshipCriticFixtures } from "./stewardshipCriticFixtures.js";

describe("stewardship critic fixtures", () => {
  const critic = createStewardshipCritic("deterministic_critic");

  for (const fixture of stewardshipCriticFixtures) {
    it(fixture.name, () => {
      const result = critic.critique(fixture.input);

      expect(result.status).toBe(fixture.expect.status);
      if (fixture.expect.confidence) {
        expect(result.confidence).toBe(fixture.expect.confidence);
      }

      const checks = result.findings.map((finding) => finding.check);
      for (const check of fixture.expect.checks) {
        expect(checks, fixture.name).toContain(check);
      }

      expect(result.rationale).toBeTruthy();
      expect(result.recommendations.length).toBeGreaterThan(0);
    });
  }
});

describe("stewardship critic implementations", () => {
  it("encodes the review policy for generated and protected sources", () => {
    expect(critiquePolicyForTarget("codex_build_packet")).toBe("always");
    expect(critiquePolicyForTarget("codex_planning_packet")).toBe("always");
    expect(critiquePolicyForTarget("goal_definition")).toBe("optional");
    expect(critiquePolicyForTarget("generated_summary")).toBe("optional");
    expect(critiquePolicyForTarget("stewardship_decision", "historical_artifact")).toBe("never");
    expect(critiquePolicyForTarget("codex_build_packet", "operator_approval")).toBe("never");
  });

  it("supports a disabled critic", () => {
    const result = new DisabledStewardshipCritic().critique({
      targetKind: "generated_summary",
      artifactText: "Summary"
    });

    expect(result.status).toBe("approved");
    expect(result.confidence).toBe("low");
    expect(result.critic).toBe("disabled_critic");
  });

  it("exposes a local LLM critic interface without adding an API dependency", () => {
    const critic = new LocalLlmStewardshipCritic({
      critique(input) {
        return {
          critic: "local_llm_critic",
          targetKind: input.targetKind,
          status: "approved",
          confidence: "medium",
          findings: [],
          recommendations: ["Local adapter reviewed the artifact."],
          rationale: "Adapter-provided result."
        };
      }
    });

    const result = critic.critique({
      targetKind: "generated_summary",
      artifactText: "Summary"
    });

    expect(result.critic).toBe("local_llm_critic");
    expect(result.status).toBe("approved");
  });
});
