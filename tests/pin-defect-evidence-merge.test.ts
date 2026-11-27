import { describe, expect, it } from "vitest";
import { mergeEvidence, normalizeEvidence, summaryTokens } from "../src/defect/signal.js";

describe("defect evidence merge", () => {
  it("trims, drops blanks and de-duplicates evidence in first-seen order", () => {
    expect(normalizeEvidence([" a ", "b", "a", "", "  ", "b "])).toEqual(["a", "b"]);
  });

  it("keeps existing evidence first and appends only new incoming items", () => {
    expect(mergeEvidence(["x", "y"], ["y", " z ", "x"])).toEqual(["x", "y", "z"]);
  });

  it("trims existing evidence when nothing new arrives", () => {
    expect(mergeEvidence([" x "], [])).toEqual(["x"]);
  });
});

describe("summary tokens for duplicate detection", () => {
  it("keeps significant lowercase words and drops stop words and short words", () => {
    expect([...summaryTokens("The Dispatch tick FAILS when the queue is empty, again and again")])
      .toEqual(["dispatch", "tick", "fails", "queue", "empty"]);
  });

  it("splits on punctuation and underscores and drops short fragments", () => {
    expect([...summaryTokens("CI-red on main: build_2 broke")]).toEqual(["red", "main", "build", "broke"]);
  });

  it("yields no tokens for a summary made only of short words", () => {
    expect(summaryTokens("a an to of").size).toBe(0);
  });
});
