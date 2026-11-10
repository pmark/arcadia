import { describe, expect, it } from "vitest";
import {
  STEP_REASON_MAX_LENGTH,
  completesGate,
  oneLineReason,
  remainderOf,
} from "../src/northStar/stepReason.js";

describe("North Star step reasons", () => {
  it("prefixes a gate title and a split parent title", () => {
    expect(completesGate("G1 ready")).toBe("Completes gate: G1 ready");
    expect(remainderOf("Build it")).toBe("Remainder of Build it");
  });

  it("collapses whitespace into one trimmed line", () => {
    expect(oneLineReason("  first\n  second\t\tthird  ")).toBe("first second third");
  });

  it("leaves a reason of exactly the maximum length unchanged", () => {
    const exact = "a".repeat(STEP_REASON_MAX_LENGTH);
    expect(oneLineReason(exact)).toBe(exact);
  });

  it("cuts a longer reason to the maximum length ending in an ellipsis", () => {
    const cut = oneLineReason("a".repeat(STEP_REASON_MAX_LENGTH + 1));
    expect(cut).toHaveLength(STEP_REASON_MAX_LENGTH);
    expect(cut.endsWith("…")).toBe(true);
  });
});
