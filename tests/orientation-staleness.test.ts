import { describe, expect, it } from "vitest";
import {
  ageInDays,
  isApproaching,
  isDueOrUrgent,
  isNeglected,
  isStale
} from "../src/orientation/staleness.js";
import type { OrientationEntry } from "../src/orientation/types.js";

function baseEntry(overrides: Partial<OrientationEntry> = {}): OrientationEntry {
  return {
    id: "oentry_test",
    entryType: "active_concern",
    title: "test entry",
    detail: null,
    area: null,
    projectId: null,
    priority: "normal",
    horizon: "soon",
    dueAt: null,
    effort: null,
    status: "active",
    lastConfirmedAt: new Date().toISOString(),
    assertedAt: new Date().toISOString(),
    source: "cli",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

function daysAgo(days: number, from: Date): string {
  return new Date(from.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe("orientation staleness", () => {
  const now = new Date("2026-07-21T12:00:00Z");

  it("treats a same-day 'now' confirmation as fresh", () => {
    const entry = baseEntry({ horizon: "now", lastConfirmedAt: daysAgo(1, now) });
    expect(isStale(entry, now)).toBe(false);
  });

  it("treats a 'now' entry confirmed 3 days ago as stale (threshold 2)", () => {
    const entry = baseEntry({ horizon: "now", lastConfirmedAt: daysAgo(3, now) });
    expect(isStale(entry, now)).toBe(true);
  });

  it("distinguishes 'confirmed yesterday' from 'asserted three weeks ago' at 'soon' horizon", () => {
    const confirmedYesterday = baseEntry({ horizon: "soon", lastConfirmedAt: daysAgo(1, now) });
    const assertedThreeWeeksAgo = baseEntry({ horizon: "soon", lastConfirmedAt: daysAgo(21, now) });
    expect(isStale(confirmedYesterday, now)).toBe(false);
    expect(isStale(assertedThreeWeeksAgo, now)).toBe(true);
  });

  it("is neglected only at 2x the staleness threshold", () => {
    const barelyStale = baseEntry({ horizon: "now", lastConfirmedAt: daysAgo(3, now) }); // > 2, < 4
    const neglected = baseEntry({ horizon: "now", lastConfirmedAt: daysAgo(5, now) }); // >= 4
    expect(isNeglected(barelyStale, now)).toBe(false);
    expect(isNeglected(neglected, now)).toBe(true);
  });

  it("computes age in days", () => {
    expect(ageInDays(daysAgo(10, now), now)).toBeCloseTo(10, 5);
  });

  it("flags critical entries as due/urgent regardless of due date", () => {
    const entry = baseEntry({ priority: "critical", dueAt: undefined as unknown as null });
    expect(isDueOrUrgent(entry, now)).toBe(true);
  });

  it("flags an overdue time_bound entry as due/urgent", () => {
    const entry = baseEntry({ priority: "normal", dueAt: daysAgo(1, now) });
    expect(isDueOrUrgent(entry, now)).toBe(true);
  });

  it("surfaces a high-priority item within its 7-day lead window as approaching", () => {
    const dueIn5Days = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString();
    const entry = baseEntry({ priority: "high", entryType: "time_bound", dueAt: dueIn5Days });
    expect(isApproaching(entry, now)).toBe(true);
  });

  it("does not surface a low-priority item due in 5 days as approaching (1-day lead)", () => {
    const dueIn5Days = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString();
    const entry = baseEntry({ priority: "low", entryType: "time_bound", dueAt: dueIn5Days });
    expect(isApproaching(entry, now)).toBe(false);
  });
});
