import { describe, expect, it } from "vitest";

import { estimateTokens } from "../src/production/redAlertDiagnosis.js";

describe("red-alert diagnosis token estimate", () => {
  it("rounds characters divided by four up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abc")).toBe(1);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });
});
