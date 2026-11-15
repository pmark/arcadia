import { describe, expect, it } from "vitest";

import { daysUntilDue } from "../src/orientation/staleness.js";

type Entry = Parameters<typeof daysUntilDue>[0];

function entryDue(dueAt: string | null): Entry {
  return {
    id: "entry-1",
    entryType: "task",
    title: "Pinned entry",
    detail: null,
    area: null,
    projectId: null,
    priority: "normal",
    horizon: "soon",
    dueAt,
    effort: null,
    status: "active",
    lastConfirmedAt: "2026-11-01T00:00:00.000Z",
    assertedAt: "2026-11-01T00:00:00.000Z",
    source: "manual",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z"
  } as Entry;
}

describe("daysUntilDue", () => {
  it("returns positive days before the due instant", () => {
    expect(
      daysUntilDue(entryDue("2026-11-10T00:00:00.000Z"), new Date("2026-11-07T00:00:00.000Z"))
    ).toBe(3);
  });

  it("returns negative days after the due instant", () => {
    expect(
      daysUntilDue(entryDue("2026-11-07T00:00:00.000Z"), new Date("2026-11-09T00:00:00.000Z"))
    ).toBe(-2);
  });

  it("returns undefined without a due instant", () => {
    expect(daysUntilDue(entryDue(null), new Date("2026-11-07T00:00:00.000Z"))).toBeUndefined();
  });
});
