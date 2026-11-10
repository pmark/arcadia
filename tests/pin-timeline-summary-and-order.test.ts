import { describe, expect, it } from "vitest";
import { boundSummary, compareText } from "../src/timeline/schema.js";

describe("timeline compareText", () => {
  it("orders by code unit, not locale", () => {
    expect(compareText("B", "a")).toBe(-1);
    expect(compareText("a", "a")).toBe(0);
    expect(compareText("b", "a")).toBe(1);
  });
});

describe("timeline boundSummary", () => {
  it("flattens whitespace and trims", () => {
    expect(boundSummary("  a\n\n b  ")).toBe("a b");
  });

  it("returns a 240-character string unchanged", () => {
    const text = "x".repeat(240);
    expect(boundSummary(text)).toBe(text);
  });

  it("cuts a 241-character string to 239 characters plus an ellipsis", () => {
    const out = boundSummary("y".repeat(241));
    expect(out).toHaveLength(240);
    expect(out).toBe("y".repeat(239) + "…");
  });
});
