import { describe, expect, it } from "vitest";

import { splitNarrationText } from "../src/intelligence/speech/narration.js";

describe("splitNarrationText", () => {
  it("returns no chunks for empty text", () => {
    expect(splitNarrationText("")).toEqual([]);
  });

  it("packs sentences up to the chunk size", () => {
    expect(splitNarrationText("One. Two. Three.", 9)).toEqual(["One. Two.", "Three."]);
  });

  it("keeps paragraphs in separate chunks", () => {
    expect(splitNarrationText("A.\n\nB.")).toEqual(["A.", "B."]);
  });

  it("hard-wraps a token longer than the chunk size", () => {
    expect(splitNarrationText("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
  });

  it("refuses a chunk size that is not a positive integer", () => {
    expect(() => splitNarrationText("x", 0)).toThrow("positive integer");
    expect(() => splitNarrationText("x", 1.5)).toThrow("positive integer");
  });
});
