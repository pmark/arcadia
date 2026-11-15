import { describe, expect, it } from "vitest";

import { safeText } from "../src/decisions/nextSteps.js";

describe("safeText", () => {
  it("reads non-strings as empty", () => {
    expect(safeText(42, 80)).toBe("");
    expect(safeText(null, 80)).toBe("");
  });

  it("collapses whitespace runs and trims the ends", () => {
    expect(safeText("  alpha \t  beta    gamma  ", 80)).toBe("alpha beta gamma");
  });

  it("truncates to the limit", () => {
    const out = safeText("abcdefghijklmnop", 5);
    expect(out).toHaveLength(5);
    expect(out.startsWith("abcd")).toBe(true);
  });
});
