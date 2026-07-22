import { describe, expect, it } from "vitest";
import { EFFORT_CEILING_MINUTES, effortFitsWithin, formatMinutes, largestEffortFitting } from "../src/orientation/effort.js";
import { buildDaySlate, parseAvailableMinutesRequest, selectFittingEntries } from "../src/orientation/fit.js";
import type { DailyCapacity, OrientationEntry } from "../src/orientation/types.js";

const NOW = new Date("2026-07-21T12:00:00Z");

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
    localDate: "2026-07-21",
    note: "one client session + ~1h of fragments; evening gone",
    sessionBlocks: 1,
    fragmentMinutes: 60,
    source: "cli",
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides
  };
}

describe("effort vocabulary", () => {
  it("orders the four sizes by the time they claim", () => {
    expect(EFFORT_CEILING_MINUTES.quick).toBeLessThan(EFFORT_CEILING_MINUTES.short);
    expect(EFFORT_CEILING_MINUTES.short).toBeLessThan(EFFORT_CEILING_MINUTES.session);
    expect(EFFORT_CEILING_MINUTES.session).toBeLessThan(EFFORT_CEILING_MINUTES.project);
  });

  it("never lets a project-sized item fit any window", () => {
    expect(effortFitsWithin("project", 15)).toBe(false);
    expect(effortFitsWithin("project", 10_000)).toBe(false);
    expect(largestEffortFitting(10_000)).toBe("session");
  });

  it("fits a size only when the whole ceiling is available", () => {
    expect(effortFitsWithin("quick", 15)).toBe(true);
    expect(effortFitsWithin("quick", 14)).toBe(false);
    expect(effortFitsWithin("short", 60)).toBe(true);
    expect(largestEffortFitting(20)).toBe("quick");
    expect(largestEffortFitting(10)).toBeUndefined();
  });

  it("formats windows for humans", () => {
    expect(formatMinutes(20)).toBe("20m");
    expect(formatMinutes(60)).toBe("1h");
    expect(formatMinutes(90)).toBe("1h30m");
  });
});

describe("fit-to-gap", () => {
  it("returns only the items that fit the window, most urgent first", () => {
    const baseball = entry({ title: "Register kids for baseball", effort: "quick", priority: "high" });
    const mirror = entry({ title: "Fix car mirror", effort: "quick", priority: "normal" });
    const disposal = entry({ title: "Fix garbage disposal", effort: "session", priority: "high" });

    const result = selectFittingEntries([baseball, mirror, disposal], 20, NOW);

    expect(result.fits.map((item) => item.entry.title)).toEqual([
      "Register kids for baseball",
      "Fix car mirror"
    ]);
    expect(result.tooBig.map((item) => item.entry.title)).toEqual(["Fix garbage disposal"]);
  });

  it("is a pure function of stored data — same inputs, same answer, no model", () => {
    const entries = [
      entry({ title: "a", effort: "quick", priority: "high" }),
      entry({ title: "b", effort: "quick", priority: "critical" })
    ];
    const first = selectFittingEntries(entries, 15, NOW);
    const second = selectFittingEntries(entries, 15, NOW);
    expect(first.fits.map((item) => item.entry.title)).toEqual(second.fits.map((item) => item.entry.title));
    expect(first.fits[0].entry.title).toBe("b");
  });

  it("ignores un-sized entries but says how many it skipped", () => {
    const result = selectFittingEntries(
      [entry({ title: "sized", effort: "quick" }), entry({ title: "unsized" }), entry({ title: "also unsized" })],
      30,
      NOW
    );
    expect(result.fits.map((item) => item.entry.title)).toEqual(["sized"]);
    expect(result.unsizedCount).toBe(2);
  });

  it("never proposes completed or dropped entries", () => {
    const result = selectFittingEntries(
      [
        entry({ title: "done", effort: "quick", status: "completed" }),
        entry({ title: "gone", effort: "quick", status: "dropped" }),
        entry({ title: "live", effort: "quick", status: "confirmed" })
      ],
      15,
      NOW
    );
    expect(result.fits.map((item) => item.entry.title)).toEqual(["live"]);
  });

  it("surfaces an unconfirmed item rather than hiding it, flagged as stale", () => {
    const old = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const result = selectFittingEntries([entry({ title: "old", effort: "quick", lastConfirmedAt: old })], 15, NOW);
    expect(result.fits[0].stale).toBe(true);
  });

  it("caps the answer so a 20-minute gap gets a choice, not the whole list", () => {
    const many = Array.from({ length: 8 }, (_, index) => entry({ title: `q${index}`, effort: "quick" }));
    expect(selectFittingEntries(many, 15, NOW).fits).toHaveLength(3);
    expect(selectFittingEntries(many, 15, NOW, { limit: 5 }).fits).toHaveLength(5);
  });
});

describe("the day slate", () => {
  it("protects session work, packs the gaps, and defers the rest with a reason", () => {
    const website = entry({ title: "Private practice website work", effort: "session", priority: "high" });
    const baseball = entry({ title: "Register kids for baseball", effort: "quick", priority: "high" });
    const disposal = entry({ title: "Fix garbage disposal", effort: "session", priority: "normal" });
    const party = entry({ title: "Prepare for MacKaylee's party", effort: "project", priority: "high" });

    const slate = buildDaySlate([website, baseball, disposal, party], capacity(), NOW);

    expect(slate.protect.map((item) => item.entry.title)).toEqual(["Private practice website work"]);
    expect(slate.fitsToday.map((item) => item.entry.title)).toEqual(["Register kids for baseball"]);
    expect(slate.notToday.map((item) => item.entry.title)).toEqual([
      "Prepare for MacKaylee's party",
      "Fix garbage disposal"
    ]);
    expect(slate.notToday.find((item) => item.entry.title === "Fix garbage disposal")?.reason).toContain("session");
  });

  it("never proposes a session into a day that has none", () => {
    const disposal = entry({ title: "Fix garbage disposal", effort: "session", priority: "critical" });
    const slate = buildDaySlate([disposal], capacity({ sessionBlocks: 0 }), NOW);

    expect(slate.protect).toHaveLength(0);
    expect(slate.fitsToday).toHaveLength(0);
    expect(slate.notToday[0].reason).toBe("needs a 1–3h session; today has none");
  });

  it("stops packing gaps once the stated minutes run out", () => {
    const entries = [
      entry({ title: "quick a", effort: "quick", priority: "critical" }),
      entry({ title: "quick b", effort: "quick", priority: "high" }),
      entry({ title: "quick c", effort: "quick", priority: "normal" })
    ];
    const slate = buildDaySlate(entries, capacity({ sessionBlocks: 0, fragmentMinutes: 30 }), NOW);

    expect(slate.fitsToday.map((item) => item.entry.title)).toEqual(["quick a", "quick b"]);
    expect(slate.remainingFragmentMinutes).toBe(0);
    expect(slate.notToday.map((item) => item.entry.title)).toEqual(["quick c"]);
  });

  it("lets the smallest work claim the gaps, so one hour-long item can't swallow the day's slack", () => {
    const taxes = entry({ title: "File quarterly estimated taxes", effort: "short", priority: "high" });
    const baseball = entry({ title: "Register kids for baseball", effort: "quick", priority: "high" });
    const slate = buildDaySlate([taxes, baseball], capacity({ sessionBlocks: 0, fragmentMinutes: 60 }), NOW);

    expect(slate.fitsToday.map((item) => item.entry.title)).toEqual(["Register kids for baseball"]);
    expect(slate.notToday.map((item) => item.entry.title)).toEqual(["File quarterly estimated taxes"]);
    expect(slate.remainingFragmentMinutes).toBe(45);
  });

  it("gives the protected block to the nearer-horizon work when urgency ties", () => {
    const website = entry({ title: "Private practice website work", effort: "session", priority: "high", horizon: "now" });
    const disposal = entry({ title: "Fix garbage disposal", effort: "session", priority: "high", horizon: "soon" });

    // Order of arrival must not decide which one gets the day's only session.
    for (const entries of [[disposal, website], [website, disposal]]) {
      const slate = buildDaySlate(entries, capacity({ sessionBlocks: 1 }), NOW);
      expect(slate.protect.map((item) => item.entry.title)).toEqual(["Private practice website work"]);
    }
  });

  it("treats an unstated number as unknown, not zero — nothing is deferred on a number never given", () => {
    const disposal = entry({ title: "Fix garbage disposal", effort: "session" });
    const baseball = entry({ title: "Register kids for baseball", effort: "quick" });
    const slate = buildDaySlate([disposal, baseball], capacity({ sessionBlocks: null, fragmentMinutes: null }), NOW);

    expect(slate.protect).toHaveLength(0);
    expect(slate.fitsToday).toHaveLength(0);
    expect(slate.notToday).toHaveLength(0);
    expect(slate.unsized.map((item) => item.title).sort()).toEqual([
      "Fix garbage disposal",
      "Register kids for baseball"
    ]);
  });

  it("leaves un-sized entries entirely alone", () => {
    const unsized = entry({ title: "Clean the house" });
    const slate = buildDaySlate([unsized], capacity(), NOW);
    expect(slate.unsized.map((item) => item.title)).toEqual(["Clean the house"]);
    expect([...slate.protect, ...slate.fitsToday, ...slate.notToday]).toHaveLength(0);
  });
});

describe("recognizing a \"what fits?\" question deterministically", () => {
  it("reads the windows a person actually types", () => {
    expect(parseAvailableMinutesRequest("I have 20 minutes")).toBe(20);
    expect(parseAvailableMinutesRequest("what fits in 45 min?")).toBe(45);
    expect(parseAvailableMinutesRequest("I've got an hour")).toBe(60);
    expect(parseAvailableMinutesRequest("I have half an hour")).toBe(30);
    expect(parseAvailableMinutesRequest("I have 2 hours")).toBe(120);
    expect(parseAvailableMinutesRequest("20 minutes")).toBe(20);
    expect(parseAvailableMinutesRequest("1h?")).toBe(60);
  });

  it("still reads it as a question when the ask is explicit", () => {
    expect(parseAvailableMinutesRequest("I've got 20 minutes free, what should I do?")).toBe(20);
    expect(parseAvailableMinutesRequest("anything I can do in 15 min?")).toBe(15);
  });

  it("does not hijack a statement of fact that happens to mention a duration", () => {
    expect(parseAvailableMinutesRequest("the plumber comes in 20 minutes")).toBeNull();
    expect(parseAvailableMinutesRequest("register the kids for baseball, quick")).toBeNull();
    expect(parseAvailableMinutesRequest("taxes are filed")).toBeNull();
    expect(parseAvailableMinutesRequest("")).toBeNull();
  });

  it("leaves a capacity statement to the interpreter rather than answering it as a question", () => {
    expect(
      parseAvailableMinutesRequest("today I've got one client session and about an hour of gaps; the evening is gone")
    ).toBeNull();
    expect(parseAvailableMinutesRequest("I have an hour of fragments today and no session")).toBeNull();
  });
});
