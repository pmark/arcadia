import { describe, expect, it } from "vitest";
import { lessonKeywords } from "../src/learning/lessons.js";

describe("lessonKeywords", () => {
  it("lowercases, splits on non-alphanumerics and drops words shorter than three characters", () => {
    expect(lessonKeywords("Fix the CLI-Retry, a b of 42!")).toEqual(["fix", "the", "cli", "retry"]);
  });

  it("de-duplicates case-insensitively, keeping first-seen order", () => {
    expect(lessonKeywords("beta alpha beta ALPHA gamma")).toEqual(["beta", "alpha", "gamma"]);
  });

  it("caps the result at 32 keywords", () => {
    const text = Array.from({ length: 40 }, (_, index) => `word${index}`).join(" ");
    const keywords = lessonKeywords(text);
    expect(keywords).toHaveLength(32);
    expect(keywords[0]).toBe("word0");
    expect(keywords[31]).toBe("word31");
  });

  it("returns an empty list when no word is long enough", () => {
    expect(lessonKeywords("a b -- !")).toEqual([]);
  });
});
