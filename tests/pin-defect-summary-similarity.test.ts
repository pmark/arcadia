import { describe, expect, it } from "vitest";
import { summarySimilarity } from "../src/defect/signal.js";

describe("summarySimilarity", () => {
  it("is the Jaccard ratio of significant words", () => {
    expect(summarySimilarity("Login FAILS on retry", "login  fails retry")).toBe(1);
    expect(summarySimilarity("alpha beta gamma", "alpha beta delta")).toBe(0.5);
    expect(summarySimilarity("alpha beta", "gamma delta")).toBe(0);
  });

  it("is 0 when either side has no significant words", () => {
    expect(summarySimilarity("the and", "alpha")).toBe(0);
    expect(summarySimilarity("alpha", "")).toBe(0);
    expect(summarySimilarity("", "")).toBe(0);
  });
});
