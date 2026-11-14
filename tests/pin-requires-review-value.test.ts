import { describe, expect, it } from "vitest";
import { isRequiresReviewValue } from "../src/domain/constants.js";

describe("isRequiresReviewValue", () => {
  it("accepts only the exact requires_review value", () => {
    expect(isRequiresReviewValue("requires_review")).toBe(true);
  });

  it("rejects case variants, spaced variants, other values and empty input", () => {
    expect(isRequiresReviewValue("Requires_Review")).toBe(false);
    expect(isRequiresReviewValue("requires review")).toBe(false);
    expect(isRequiresReviewValue("work_queue")).toBe(false);
    expect(isRequiresReviewValue("")).toBe(false);
  });

  it("rejects null and undefined", () => {
    expect(isRequiresReviewValue(null)).toBe(false);
    expect(isRequiresReviewValue(undefined)).toBe(false);
  });
});
