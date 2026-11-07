import { describe, expect, it } from "vitest";
import { parseActionDocRef } from "../src/docs/types.js";

describe("parseActionDocRef", () => {
  it("splits a plan ref into plan slug and action id", () => {
    expect(parseActionDocRef("plan/my-plan#do-thing")).toEqual({
      planSlug: "my-plan",
      actionId: "do-thing",
    });
  });

  it("splits on the first # so the action id keeps later #", () => {
    expect(parseActionDocRef("plan/a#b#c")).toEqual({ planSlug: "a", actionId: "b#c" });
  });

  it("returns null when there is no action id", () => {
    expect(parseActionDocRef("plan/my-plan")).toBeNull();
  });

  it("returns null for a non-plan ref", () => {
    expect(parseActionDocRef("decision/x#y")).toBeNull();
  });
});
