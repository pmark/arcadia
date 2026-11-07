import { describe, expect, it } from "vitest";
import { normalizeLessonScope } from "../src/learning/lessons.js";

describe("normalizeLessonScope", () => {
  it("trims and accepts arcadia or project:<slug>", () => {
    expect(normalizeLessonScope(" arcadia ")).toBe("arcadia");
    expect(normalizeLessonScope(" project:x ")).toBe("project:x");
    expect(normalizeLessonScope("project:arcadia")).toBe("project:arcadia");
  });

  it("requires a scope", () => {
    expect(() => normalizeLessonScope(undefined)).toThrow(/A lesson scope is required/);
  });

  it.each(["project:../x", "project:a..b", "Arcadia", "project:"])("refuses %s", (scope) => {
    expect(() => normalizeLessonScope(scope)).toThrow(/Lesson scope must be/);
  });
});
