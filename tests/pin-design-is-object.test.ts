import { describe, expect, it } from "vitest";

import { isObj } from "../src/design/common.js";

describe("isObj", () => {
  it("accepts a plain object", () => {
    expect(isObj({ a: 1 })).toBe(true);
  });

  it("rejects null, undefined, arrays and scalars", () => {
    expect(isObj(null)).toBe(false);
    expect(isObj(undefined)).toBe(false);
    expect(isObj([])).toBe(false);
    expect(isObj(["a"])).toBe(false);
    expect(isObj("a")).toBe(false);
    expect(isObj(1)).toBe(false);
    expect(isObj(true)).toBe(false);
  });
});
