import { describe, expect, it } from "vitest";
import { normalizeReviewResponseValue } from "../src/review/responseParser.js";

describe("normalizeReviewResponseValue", () => {
  it("trims, lowercases and collapses whitespace", () => {
    expect(normalizeReviewResponseValue("  Needs   CHANGES\n now ")).toBe("needs changes now");
    expect(normalizeReviewResponseValue("approved")).toBe("approved");
  });

  it("returns an empty string for whitespace-only input", () => {
    expect(normalizeReviewResponseValue(" \t\n ")).toBe("");
  });
});
