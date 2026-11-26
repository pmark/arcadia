import { describe, expect, it } from "vitest";
import { NOTE_MAX_CHARS, normalizeNoteText, parsePrNumbers } from "../src/coordinator/state.js";

describe("normalizeNoteText", () => {
  it("caps notes at 500 characters", () => {
    expect(NOTE_MAX_CHARS).toBe(500);
  });

  it("collapses whitespace and accepts exactly 500 characters", () => {
    expect(normalizeNoteText("  waiting \n on\t#3073  ")).toBe("waiting on #3073");
    expect(normalizeNoteText("a".repeat(500))).toHaveLength(500);
  });

  it("rejects whitespace only and 501 characters", () => {
    expect(() => normalizeNoteText(" \n\t ")).toThrow("A coordinator note needs text.");
    expect(() => normalizeNoteText("a".repeat(501))).toThrow(
      "A coordinator note is at most 500 characters; put detail in a PR or Issue and reference it.",
    );
  });
});

describe("parsePrNumbers", () => {
  it("reads plain and hash-prefixed numbers, and no values as empty", () => {
    expect(parsePrNumbers(["3073", "#3076"])).toEqual([3073, 3076]);
    expect(parsePrNumbers()).toEqual([]);
  });

  it.each(["0", "-1", "1.5", "abc", "##7"])("rejects %s", (value) => {
    expect(() => parsePrNumbers([value])).toThrow(`--pr must be a pull request number, not "${value}".`);
  });
});
