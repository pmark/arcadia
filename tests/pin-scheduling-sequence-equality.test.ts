import { describe, expect, it } from "vitest";

import { SCHEDULING_CLASSES, isQueuedClass, sameSequence } from "../src/scheduling/order.js";

describe("scheduling sequence equality", () => {
  it("is true for identical sequences, including two empty ones", () => {
    expect(sameSequence(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameSequence([], [])).toBe(true);
  });

  it("respects order and length", () => {
    expect(sameSequence(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameSequence(["a"], ["a", "b"])).toBe(false);
  });
});

describe("queued scheduling classes", () => {
  it("treats only follow_up as unqueued", () => {
    expect(SCHEDULING_CLASSES.filter((schedulingClass) => !isQueuedClass(schedulingClass))).toEqual(["follow_up"]);
    for (const schedulingClass of ["interrupt", "blocker", "corrective", "planned"] as const) {
      expect(isQueuedClass(schedulingClass)).toBe(true);
    }
  });
});
