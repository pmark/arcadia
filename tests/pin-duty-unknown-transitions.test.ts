import { describe, expect, it } from "vitest";
import { decideUnknown, type UnknownEpisode } from "../src/production/dutyAlarms.js";

const N = Date.UTC(2026, 10, 26, 3, 0, 0);
const ISO = new Date(N).toISOString();
const delivered: UnknownEpisode = {
  startedAt: "2026-11-25T00:00:00.000Z",
  key: "duty_unknown since 2026-11-25T00:00:00.000Z",
  reasons: ["old"],
  delivery: { pingId: "p1", queuedAt: "2026-11-25T00:00:01.000Z" }
};
const undelivered: UnknownEpisode = { ...delivered, delivery: null };

describe("decideUnknown transitions", () => {
  it("opens a new episode when none exists and a count is unknown", () => {
    expect(decideUnknown(null, true, ["a"], N)).toEqual({
      transition: "open",
      next: { startedAt: ISO, key: `duty_unknown since ${ISO}`, reasons: ["a"], delivery: null },
      cleared: false
    });
  });

  it("keeps a delivered episode quiet and replaces only its reasons", () => {
    expect(decideUnknown(delivered, true, ["b"], N)).toEqual({
      transition: "none",
      next: { ...delivered, reasons: ["b"] },
      cleared: false
    });
  });

  it("closes a delivered episode once nothing is unknown, and stays quiet with no episode", () => {
    expect(decideUnknown(delivered, true, [], N)).toEqual({ transition: "close", next: null, cleared: false });
    expect(decideUnknown(null, true, [], N)).toEqual({ transition: "none", next: null, cleared: false });
  });

  it("keeps an undelivered episode open, with cleared set only once unknowns are gone", () => {
    expect(decideUnknown(undelivered, true, ["b"], N)).toEqual({
      transition: "open",
      next: { ...undelivered, reasons: ["b"] },
      cleared: false
    });
    expect(decideUnknown(undelivered, true, [], N)).toEqual({ transition: "open", next: undelivered, cleared: true });
  });

  it("holds a delivered episode unchanged while not judged, and does nothing without one", () => {
    expect(decideUnknown(delivered, false, ["x"], N)).toEqual({ transition: "hold", next: delivered, cleared: false });
    expect(decideUnknown(null, false, ["x"], N)).toEqual({ transition: "none", next: null, cleared: false });
  });
});
