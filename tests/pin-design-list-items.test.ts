import { describe, expect, it } from "vitest";

import { items } from "../src/design/common.js";

describe("items", () => {
  it("returns the same array object it was given", () => {
    const list = ["a", 1, null];
    expect(items(list)).toBe(list);
  });

  it("returns an empty array for non-arrays", () => {
    expect(items(null)).toEqual([]);
    expect(items(undefined)).toEqual([]);
    expect(items("text")).toEqual([]);
    expect(items(4)).toEqual([]);
    expect(items({ length: 2 })).toEqual([]);
  });
});
