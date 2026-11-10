import { describe, expect, it } from "vitest";
import { parseTriggers } from "../src/way/lookup.js";

describe("parseTriggers", () => {
  it("returns no entries for missing or malformed input", () => {
    expect(parseTriggers(null)).toEqual([]);
    expect(parseTriggers("not json")).toEqual([]);
    expect(parseTriggers("{}")).toEqual([]);
  });

  it("skips incomplete entries and drops empty phrases", () => {
    const result = parseTriggers(
      JSON.stringify({
        entries: [{ path: "a.md", trigger: "alpha beta, , gamma" }, { path: 3, trigger: "x" }, { path: "b.md" }],
      }),
    );
    expect(result.map((entry) => entry.path)).toEqual(["a.md"]);
    expect(result[0].triggers).toHaveLength(2);
  });
});
