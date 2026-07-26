import { describe, expect, it } from "vitest";
import {
  NAMED_EXECUTION_PROFILES,
  parseExecutionRequirement
} from "../src/execution/profiles.js";

describe("execution profiles", () => {
  it("expands a concise named profile and phase override", () => {
    const result = parseExecutionRequirement({
      schema: "arcadia.execution/v1",
      profile: "routine_implementation",
      context: {
        required: ["AGENTS.md", "src/contracts.ts"]
      },
      phases: {
        review: {
          capability: "c3_systems",
          effort: "e3_deep",
          review_independence: "separate_run"
        }
      }
    }, "codex");

    expect(result.issues).toEqual([]);
    expect(result.resolved?.baseline).toMatchObject({
      capability: "c2_integrated",
      effort: "e2_standard",
      context: {
        scope: "project",
        required: ["AGENTS.md", "src/contracts.ts"]
      }
    });
    expect(result.resolved?.phases.review).toMatchObject({
      capability: "c3_systems",
      effort: "e3_deep",
      reviewIndependence: "separate_run"
    });
  });

  it("keeps capability and reasoning effort independent", () => {
    const result = parseExecutionRequirement({
      schema: "arcadia.execution/v1",
      profile: "localized_edit",
      phases: {
        verification: {
          capability: "c2_integrated",
          effort: "e3_deep"
        }
      }
    }, "codex");

    expect(result.issues).toEqual([]);
    expect(result.resolved?.phases.verification).toMatchObject({
      capability: "c2_integrated",
      effort: "e3_deep"
    });
  });

  it("rejects a phase that weakens the action minimum", () => {
    const result = parseExecutionRequirement({
      schema: "arcadia.execution/v1",
      profile: "systems_change",
      phases: {
        implementation: {
          capability: "c2_integrated",
          effort: "e2_standard",
          context: { scope: "local" },
          review_independence: "not_required"
        }
      }
    }, "codex");

    expect(result.resolved).toBeNull();
    expect(result.issues.map((issue) => issue.field)).toEqual([
      "execution.phases.implementation.capability",
      "execution.phases.implementation.effort",
      "execution.phases.implementation.context.scope",
      "execution.phases.implementation.review_independence"
    ]);
  });

  it("rejects provider and model identifiers in authoritative requirements", () => {
    const result = parseExecutionRequirement({
      schema: "arcadia.execution/v1",
      profile: "routine_implementation",
      provider: "some-provider",
      phases: {
        review: { model_id: "some-model" }
      }
    }, "codex");

    expect(result.issues.map((issue) => issue.field)).toEqual([
      "execution.provider",
      "execution.phases.review.model_id"
    ]);
  });

  it("keeps model capability separate from operator authority", () => {
    const result = parseExecutionRequirement({
      schema: "arcadia.execution/v1",
      profile: "sensitive_change"
    }, "requires_review");

    expect(result.resolved).toBeNull();
    expect(result.issues).toContainEqual({
      field: "execution.autonomy",
      message: expect.stringContaining('Responsibility "requires_review"')
    });
    expect(NAMED_EXECUTION_PROFILES.sensitive_change.capability).toBe("c4_critical");
  });

  it("allows a review-owned Action to frame an operator Decision", () => {
    const result = parseExecutionRequirement({
      schema: "arcadia.execution/v1",
      profile: "operator_decision_framing"
    }, "requires_review");

    expect(result.issues).toEqual([]);
    expect(result.resolved?.baseline.autonomy).toBe("advise");
  });
});
