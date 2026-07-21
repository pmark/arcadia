import { describe, expect, it } from "vitest";
import { composePacket } from "../src/orientation/composer.js";
import type { OrientationEntry } from "../src/orientation/types.js";

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
