import { describe, expect, it } from "vitest";
import { normalizeDefectSummary } from "../src/defect/signal.js";

describe("normalizeDefectSummary", () => {
  it("collapses whitespace runs, trims and lowercases", () => {
    expect(normalizeDefectSummary("  Login\tFAILS\n on  Retry ")).toBe(
      "login fails on retry",
    );
  });

  it("returns an already normalized summary unchanged", () => {
    expect(normalizeDefectSummary("login fails on retry")).toBe(
      "login fails on retry",
    );
  });

  it("returns an empty string for whitespace only", () => {
    expect(normalizeDefectSummary("   ")).toBe("");
  });
});
