import { describe, expect, it } from "vitest";
import { deriveEngagementBlocks, totalEngagementMinutes } from "../src/activity/blocks.js";
import { selectEncouragement, selectMood } from "../src/activity/encouragement.js";
import { currentSurface } from "../src/activity/recorder.js";
import type { ActivityEvent } from "../src/activity/types.js";
import { buildTimeline, capacityMinutes } from "../src/orientation/timeline.js";
import type { DailyCapacity, OrientationEntry } from "../src/orientation/types.js";

const NOW = new Date("2026-07-22T12:00:00Z");

function event(overrides: Partial<ActivityEvent> & { occurredAt: string }): ActivityEvent {
  return {
    id: `aevt_${Math.random().toString(36).slice(2, 10)}`,
    localDate: "2026-07-22",
    surface: "cli",
    command: "orientation.reply",
    focus: null,
    entryId: null,
    projectId: null,
    outcome: "ok",
    durationMs: 10,
    ...overrides
  };
}

function entry(overrides: Partial<OrientationEntry>): OrientationEntry {
  return {
    id: `oentry_${Math.random().toString(36).slice(2, 10)}`,
    entryType: "standing_responsibility",
    title: "untitled",
    detail: null,
    area: null,
    projectId: null,
    priority: "normal",
    horizon: "soon",
    dueAt: null,
    effort: null,
    status: "active",
    lastConfirmedAt: NOW.toISOString(),
    assertedAt: NOW.toISOString(),
    source: "cli",
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides
  };
}

function capacity(overrides: Partial<DailyCapacity> = {}): DailyCapacity {
  return {
    localDate: "2026-07-22",
    note: "one client session + ~1h of fragments",
    sessionBlocks: 1,
    fragmentMinutes: 60,
    source: "cli",
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides
  };
}

describe("engagement blocks", () => {
  it("collapses nearby interactions into one stretch", () => {
    const blocks = deriveEngagementBlocks([
      event({ occurredAt: "2026-07-22T09:00:00Z" }),
      event({ occurredAt: "2026-07-22T09:05:00Z" }),
      event({ occurredAt: "2026-07-22T09:20:00Z" })
    ]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].minutes).toBe(20);
    expect(blocks[0].interactionCount).toBe(3);
  });

  it("splits when the operator has clearly walked away", () => {
    const blocks = deriveEngagementBlocks([
      event({ occurredAt: "2026-07-22T09:00:00Z" }),
      event({ occurredAt: "2026-07-22T09:10:00Z" }),
      event({ occurredAt: "2026-07-22T14:00:00Z" })
    ]);

    expect(blocks).toHaveLength(2);
    expect(totalEngagementMinutes(blocks)).toBe(11);
  });

  it("gives a lone interaction an honest floor rather than zero", () => {
    const blocks = deriveEngagementBlocks([event({ occurredAt: "2026-07-22T09:00:00Z" })]);
    expect(blocks[0].minutes).toBe(1);
  });

  it("never counts background automation as the operator being present", () => {
    const blocks = deriveEngagementBlocks([
      event({ occurredAt: "2026-07-22T03:00:00Z", surface: "automation" }),
      event({ occurredAt: "2026-07-22T04:00:00Z", surface: "automation" })
    ]);
    expect(blocks).toHaveLength(0);

    // ...but it is recorded, not hidden, and can still be inspected.
    expect(
      deriveEngagementBlocks(
        [
          event({ occurredAt: "2026-07-22T03:00:00Z", surface: "automation" }),
          event({ occurredAt: "2026-07-22T04:00:00Z", surface: "automation" })
        ],
        { includeAutomation: true }
      )
    ).toHaveLength(2);
  });

  it("reports what a stretch was mostly about, most-touched first", () => {
    const blocks = deriveEngagementBlocks([
      event({ occurredAt: "2026-07-22T09:00:00Z", focus: "Fix garbage disposal" }),
      event({ occurredAt: "2026-07-22T09:02:00Z", focus: "Register kids for baseball" }),
      event({ occurredAt: "2026-07-22T09:04:00Z", focus: "Fix garbage disposal" })
    ]);
    expect(blocks[0].focuses).toEqual(["Fix garbage disposal", "Register kids for baseball"]);
  });

  it("records every surface the stretch touched", () => {
    const blocks = deriveEngagementBlocks([
      event({ occurredAt: "2026-07-22T09:00:00Z", surface: "discord" }),
      event({ occurredAt: "2026-07-22T09:02:00Z", surface: "dashboard" })
    ]);
    expect(blocks[0].surfaces.sort()).toEqual(["dashboard", "discord"]);
  });
});

describe("surface attribution", () => {
  it("defaults to the terminal and honors a declared surface", () => {
    expect(currentSurface({})).toBe("cli");
    expect(currentSurface({ ARCADIA_SURFACE: "dashboard" })).toBe("dashboard");
    expect(currentSurface({ ARCADIA_SURFACE: "AUTOMATION" })).toBe("automation");
  });

  it("falls back rather than storing a surface it does not recognize", () => {
    expect(currentSurface({ ARCADIA_SURFACE: "carrier-pigeon" })).toBe("cli");
  });
});

describe("the timeline's sense of scale", () => {
  it("totals sized work and measures it against the day", () => {
    const timeline = buildTimeline(
      [
        entry({ title: "baseball", effort: "quick" }),
        entry({ title: "taxes", effort: "short" }),
        entry({ title: "disposal", effort: "session" })
      ],
      NOW,
      { capacity: capacity() }
    );

    expect(timeline.totalMinutes).toBe(15 + 60 + 180);
    expect(capacityMinutes(capacity())).toBe(180);
    expect(timeline.daysAtCurrentCapacity).toBeCloseTo(255 / 180, 5);
  });

  it("holds multi-session work off the scale instead of inventing a length", () => {
    const timeline = buildTimeline(
      [entry({ title: "party prep", effort: "project" }), entry({ title: "baseball", effort: "quick" })],
      NOW,
      { capacity: capacity() }
    );

    expect(timeline.items.map((item) => item.title)).toEqual(["baseball"]);
    expect(timeline.unbounded.map((item) => item.title)).toEqual(["party prep"]);
    expect(timeline.totalMinutes).toBe(15);
  });

  it("reports the total as a floor by counting what is not sized", () => {
    const timeline = buildTimeline([entry({ title: "sized", effort: "quick" }), entry({ title: "unsized" })], NOW);
    expect(timeline.unsizedCount).toBe(1);
    expect(timeline.daysAtCurrentCapacity).toBeNull();
  });

  it("lays items out cheapest first, with running start positions", () => {
    const timeline = buildTimeline(
      [entry({ title: "big", effort: "session" }), entry({ title: "small", effort: "quick" })],
      NOW
    );
    expect(timeline.items.map((item) => item.title)).toEqual(["small", "big"]);
    expect(timeline.items.map((item) => item.startMinute)).toEqual([0, 15]);
  });

  it("treats an unknown capacity dimension as contributing nothing", () => {
    expect(capacityMinutes(capacity({ sessionBlocks: null }))).toBe(60);
    expect(capacityMinutes(capacity({ fragmentMinutes: null }))).toBe(120);
  });
});

describe("encouragement", () => {
  const baseSignals = {
    daysOfBacklog: 1,
    itemsProgressed: 0,
    minutesLogged: 0,
    engagementBlocks: 1,
    deferredCount: 0,
    urgentCount: 0
  };

  it("reads an overloaded day before anything else", () => {
    expect(selectMood({ ...baseSignals, daysOfBacklog: 4, itemsProgressed: 5 })).toBe("overloaded");
    expect(selectMood({ ...baseSignals, urgentCount: 6 })).toBe("overloaded");
  });

  it("recognizes real movement", () => {
    expect(selectMood({ ...baseSignals, itemsProgressed: 2 })).toBe("momentum");
    expect(selectMood({ ...baseSignals, minutesLogged: 180 })).toBe("momentum");
  });

  it("distinguishes a quiet day from a scattered one", () => {
    expect(selectMood({ ...baseSignals, engagementBlocks: 0 })).toBe("quiet");
    expect(selectMood({ ...baseSignals, engagementBlocks: 5 })).toBe("scattered");
  });

  it("is stable for a given day but varies across a week", () => {
    const first = selectEncouragement(baseSignals, "2026-07-22");
    expect(selectEncouragement(baseSignals, "2026-07-22").line).toBe(first.line);

    const week = new Set(
      ["2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23"].map(
        (date) => selectEncouragement(baseSignals, date).line
      )
    );
    expect(week.size).toBeGreaterThan(1);
  });
});
