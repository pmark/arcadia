import { describe, expect, it } from "vitest";

import { oneOf } from "../src/design/common.js";

describe("oneOf", () => {
  const allowed = ["a", "b"] as const;

  it("accepts a string from the allowed list", () => {
    expect(oneOf("b", allowed)).toBe(true);
  });

  it("rejects strings outside the list, including case and empty variants", () => {
    expect(oneOf("c", allowed)).toBe(false);
    expect(oneOf("B", allowed)).toBe(false);
    expect(oneOf("", allowed)).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(oneOf(1, allowed)).toBe(false);
    expect(oneOf(undefined, allowed)).toBe(false);
  });
});
