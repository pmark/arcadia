import { describe, expect, it } from "vitest";

import { computeOrientationUrgencyScore } from "../src/orientation/urgency.js";

type Entry = Parameters<typeof computeOrientationUrgencyScore>[0];

const now = new Date("2026-11-27T12:00:00.000Z");

function entry(priority: Entry["priority"], dueAt: string | null): Entry {
  const at = "2026-11-20T12:00:00.000Z";
  return {
    id: "e1", entryType: "time_bound", title: "t", detail: null, area: null, projectId: null,
    priority, horizon: "soon", dueAt, effort: null, status: "active",
    lastConfirmedAt: at, assertedAt: at, source: "cli", createdAt: at, updatedAt: at
  };
}

describe("computeOrientationUrgencyScore", () => {
  it.each([
    ["critical", 0.75],
    ["high", 0.55],
    ["normal", 0.35],
    ["low", 0.15]
  ] as const)("scores an undated %s entry at its base %j", (priority, score) => {
    expect(computeOrientationUrgencyScore(entry(priority, null), now)).toBe(score);
  });

  it("adds no bonus at or beyond the priority's lead window", () => {
    expect(computeOrientationUrgencyScore(entry("normal", "2026-12-07T12:00:00.000Z"), now)).toBe(0.35);
    expect(computeOrientationUrgencyScore(entry("high", "2026-12-04T12:00:00.000Z"), now)).toBe(0.55);
  });

  it.each([
    ["high", "2026-12-01T00:00:00.000Z", 0.675],
    ["critical", "2026-12-04T12:00:00.000Z", 0.875],
    ["low", "2026-11-28T00:00:00.000Z", 0.275]
  ] as const)("adds a proximity bonus for a %s entry due %s", (priority, dueAt, score) => {
    expect(computeOrientationUrgencyScore(entry(priority, dueAt), now)).toBeCloseTo(score, 10);
  });

  it("scores an entry due now or overdue at exactly 1", () => {
    expect(computeOrientationUrgencyScore(entry("normal", now.toISOString()), now)).toBe(1);
    expect(computeOrientationUrgencyScore(entry("low", "2026-11-01T00:00:00.000Z"), now)).toBe(1);
  });
});
