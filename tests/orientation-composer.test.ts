import { describe, expect, it } from "vitest";
import { composePacket } from "../src/orientation/composer.js";
import type { DailyCapacity, OrientationEntry } from "../src/orientation/types.js";

function entry(overrides: Partial<OrientationEntry>): OrientationEntry {
  return {
    id: `oentry_${Math.random().toString(36).slice(2, 8)}`,
    entryType: "active_concern",
    title: "untitled",
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

describe("orientation packet composition", () => {
  const now = new Date("2026-07-21T12:00:00Z");

  it("says nothing is pressing when the ledger is empty", () => {
    const { body } = composePacket([], now);
    expect(body).toContain("Nothing pressing");
  });

  it("puts a critical entry in Due / urgent, not Approaching", () => {
    const critical = entry({ title: "Ship the release", priority: "critical", entryType: "time_bound" });
    const { body } = composePacket([critical], now);
    expect(body).toContain("Due / urgent");
    expect(body).toContain("Ship the release");
  });

  it("surfaces a time_bound item within its lead window under Approaching, before it is due", () => {
    const dueIn5Days = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString();
    const approaching = entry({ title: "Renew passport", priority: "high", entryType: "time_bound", dueAt: dueIn5Days });
    const { body } = composePacket([approaching], now);
    expect(body).toContain("Approaching");
    expect(body).toContain("Renew passport");
  });

  it("never asserts a stale entry as fact — renders it as a question instead", () => {
    const staleEntry = entry({
      title: "Old assumption",
      horizon: "soon",
      lastConfirmedAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
    });
    const { body } = composePacket([staleEntry], now);
    expect(body).toContain("Still true?");
    expect(body).toContain("Old assumption?");
    // Must not appear as a flat assertion outside the question section.
    expect(body.split("Still true?")[0]).not.toContain("Old assumption");
  });

  it("caps confirmation questions and surfaces at most one neglect flag", () => {
    const entries: OrientationEntry[] = [];
    for (let i = 0; i < 6; i += 1) {
      entries.push(
        entry({
          title: `stale-${i}`,
          horizon: "now",
          lastConfirmedAt: new Date(now.getTime() - (5 + i) * 24 * 60 * 60 * 1000).toISOString()
        })
      );
    }
    const { body } = composePacket(entries, now);
    const questionLines = body.split("\n").filter((line) => line.startsWith("- ") && line.endsWith("?"));
    expect(questionLines.length).toBeLessThanOrEqual(3);
    const neglectFlags = body.split("\n").filter((line) => line.startsWith("⚠️"));
    expect(neglectFlags.length).toBeLessThanOrEqual(1);
  });

  it("groups fresh entries by area, one line per area", () => {
    const workEntry = entry({ title: "Ship feature", area: "work" });
    const artEntry = entry({ title: "Finish painting", area: "art" });
    const { body } = composePacket([workEntry, artEntry], now);
    expect(body).toContain("work: Ship feature");
    expect(body).toContain("art: Finish painting");
  });

  it("includes an optional daily-advantage line when provided", () => {
    const { body } = composePacket([], now, { dailyAdvantageLine: "Do the thing (Project X)" });
    expect(body).toContain("Project work: Do the thing (Project X)");
  });

  it("annotates a line with its size, and leaves un-sized lines exactly as before", () => {
    const sized = entry({ title: "Register kids for baseball", area: "family", effort: "quick" });
    const unsized = entry({ title: "Clean the house", area: "home" });
    const { body } = composePacket([sized, unsized], now);
    expect(body).toContain("family: Register kids for baseball (≤15m)");
    expect(body).toContain("home: Clean the house");
    expect(body).not.toContain("Clean the house (");
  });

  it("returns an entry snapshot with stale flags for provenance", () => {
    const fresh = entry({ title: "fresh" });
    const stale = entry({
      title: "stale",
      lastConfirmedAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
    });
    const { entrySnapshot } = composePacket([fresh, stale], now);
    const snapshotById = new Map(entrySnapshot.map((item) => [item.title, item.stale]));
    expect(snapshotById.get("fresh")).toBe(false);
    expect(snapshotById.get("stale")).toBe(true);
  });
});

describe("orientation packet composition with a capacity note", () => {
  const now = new Date("2026-07-21T12:00:00Z");

  function capacity(overrides: Partial<DailyCapacity> = {}): DailyCapacity {
    return {
      localDate: "2026-07-21",
      note: "one client session + ~1h of fragments; evening gone",
      sessionBlocks: 1,
      fragmentMinutes: 60,
      source: "cli",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      ...overrides
    };
  }

  const website = entry({ title: "Private practice website work", area: "work", priority: "high", effort: "session" });
  const baseball = entry({ title: "Register kids for baseball", area: "family", priority: "high", effort: "quick" });
  const disposal = entry({ title: "Fix garbage disposal", area: "home", priority: "normal", effort: "session" });
  const party = entry({ title: "Prepare for MacKaylee's party", area: "family", priority: "high", effort: "project" });

  it("reads the operator's own capacity words back to them", () => {
    const { body } = composePacket([baseball], now, { capacity: capacity() });
    expect(body).toContain("**Today** — one client session + ~1h of fragments; evening gone");
  });

  it("separates protected work, what fits today, and honest deferral", () => {
    const { body } = composePacket([website, baseball, disposal, party], now, { capacity: capacity() });

    expect(body).toContain("**Protect**");
    expect(body).toContain("Private practice website work");
    expect(body).toContain("**Fits today**");
    expect(body).toContain("Register kids for baseball");
    expect(body).toContain("**Not today**");

    const protectIndex = body.indexOf("**Protect**");
    const fitsIndex = body.indexOf("**Fits today**");
    const notTodayIndex = body.indexOf("**Not today**");
    expect(protectIndex).toBeLessThan(fitsIndex);
    expect(fitsIndex).toBeLessThan(notTodayIndex);
  });

  it("never proposes a session into a day with none, and says why out loud", () => {
    const { body } = composePacket([disposal], now, { capacity: capacity({ sessionBlocks: 0 }) });
    expect(body).not.toContain("**Protect**");
    expect(body).toContain("Fix garbage disposal — needs a 1–3h session; today has none");
  });

  it("plans each sized entry exactly once — never in both the plan and the classic sections", () => {
    const { body } = composePacket([website, baseball, disposal, party], now, { capacity: capacity() });
    const occurrences = body.split("Register kids for baseball").length - 1;
    expect(occurrences).toBe(1);
  });

  it("still routes un-sized entries through the classic importance/urgency sections", () => {
    const unsizedCritical = entry({ title: "Ship the release", priority: "critical", entryType: "time_bound" });
    const { body } = composePacket([baseball, unsizedCritical], now, { capacity: capacity() });
    expect(body).toContain("**Fits today**");
    expect(body).toContain("**Due / urgent**");
    expect(body).toContain("Ship the release (critical)");
  });

  it("still asks about a stale entry instead of planning the day around it", () => {
    const staleSized = entry({
      title: "Old assumption",
      effort: "quick",
      lastConfirmedAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
    });
    const { body } = composePacket([staleSized], now, { capacity: capacity() });
    expect(body).toContain("Still true?");
    expect(body).toContain("Old assumption?");
    expect(body).not.toContain("**Fits today**");
  });

  it("degrades to exactly the pre-capacity packet when no capacity is stated", () => {
    const withCapacity = composePacket([website, baseball, disposal, party], now, { capacity: null }).body;
    const before = composePacket([website, baseball, disposal, party], now).body;
    expect(withCapacity).toBe(before);
    expect(withCapacity).not.toContain("**Today**");
    expect(withCapacity).not.toContain("**Protect**");
  });

  it("says so plainly when capacity is stated but nothing is sized yet", () => {
    const unsized = entry({ title: "Clean the house", area: "home" });
    const { body } = composePacket([unsized], now, { capacity: capacity() });
    expect(body).toContain("No sized work to plan today");
    expect(body).toContain("home: Clean the house");
  });
});
