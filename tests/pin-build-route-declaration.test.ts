import { describe, expect, it } from "vitest";
import { declaresBuildRoute } from "../src/sessions/packetLifecycle.js";

describe("build route declaration", () => {
  it.each(["agent", "autonomous"] as const)("honours execution: build for %s work", (work_classification) => {
    expect(declaresBuildRoute({ execution_route: "build", work_classification })).toBe(true);
  });

  it.each(["requires_review", "blocked"] as const)("ignores execution: build for %s work", (work_classification) => {
    expect(declaresBuildRoute({ execution_route: "build", work_classification })).toBe(false);
  });

  it("does not treat a plan-run route as a build declaration", () => {
    expect(declaresBuildRoute({ execution_route: "plan-run", work_classification: "agent" })).toBe(false);
  });

  it("does not treat a null route as a build declaration", () => {
    expect(declaresBuildRoute({ execution_route: null, work_classification: "agent" })).toBe(false);
  });

  it("does not treat a missing route as a build declaration", () => {
    expect(declaresBuildRoute({ work_classification: "autonomous" })).toBe(false);
  });
});
