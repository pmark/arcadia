import { describe, expect, it } from "vitest";

import { text } from "../src/design/common.js";

describe("text", () => {
  it("returns a string with content unchanged, including surrounding spaces", () => {
    expect(text("hello")).toBe("hello");
    expect(text("  padded value  ")).toBe("  padded value  ");
  });

  it("returns null for blank strings and non-strings", () => {
    expect(text("")).toBeNull();
    expect(text("   \t\n")).toBeNull();
    expect(text(null)).toBeNull();
    expect(text(undefined)).toBeNull();
    expect(text(3)).toBeNull();
  });
});
