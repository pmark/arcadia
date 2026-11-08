import { describe, expect, it } from "vitest";
import { canonicalJson } from "../src/plans/closeOut.js";

describe("close-out canonicalJson", () => {
  it("sorts keys, drops undefined values and keeps array order", () => {
    expect(canonicalJson({ b: 1, a: [{ d: undefined, c: null }] })).toBe('{"a":[{"c":null}],"b":1}');
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });

  it("sorts keys by code unit, so uppercase precedes lowercase", () => {
    expect(canonicalJson({ B: 1, a: 2 })).toBe('{"B":1,"a":2}');
  });

  it("is independent of key insertion order", () => {
    expect(canonicalJson({ y: 2, x: 1 })).toBe(canonicalJson({ x: 1, y: 2 }));
  });
});
