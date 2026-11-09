import { describe, expect, it } from "vitest";
import { logEntryDocRef, planMilestoneDocRef } from "../src/docs/types.js";

describe("plan milestone document reference", () => {
  it("slugifies the milestone title into a milestone query", () => {
    expect(planMilestoneDocRef("my-plan", "Ship It: v2!")).toBe("plan/my-plan?milestone=ship-it-v2");
  });

  it("falls back to a generic milestone slug when the title has no usable characters", () => {
    expect(planMilestoneDocRef("my-plan", "!!!")).toBe("plan/my-plan?milestone=milestone");
  });
});

describe("log entry document reference", () => {
  it("combines log slug, date and slugified title", () => {
    expect(logEntryDocRef("mission", "2026-07-25", "Hello, World")).toBe("log/mission#2026-07-25--hello-world");
  });

  it("differs for entries with different titles on the same date", () => {
    expect(logEntryDocRef("mission", "2026-07-25", "First")).not.toBe(
      logEntryDocRef("mission", "2026-07-25", "Second"),
    );
  });
});
