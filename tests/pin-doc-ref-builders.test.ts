import { describe, expect, it } from "vitest";
import { planDocRef, planQuestionDocRef, proposalDocRef } from "../src/docs/types.js";

describe("document reference builders", () => {
  it("builds a plan ref from the plan slug", () => {
    expect(planDocRef("my-plan")).toBe("plan/my-plan");
  });

  it("builds a proposal ref from the proposal slug", () => {
    expect(proposalDocRef("my-proposal")).toBe("proposal/my-proposal");
  });

  it("builds a plan question ref with a question query", () => {
    expect(planQuestionDocRef("my-plan", "q1")).toBe("plan/my-plan?question=q1");
  });
});
