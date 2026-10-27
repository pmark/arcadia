import { describe, expect, it } from "vitest";
import { JOURNEY_FIXTURE } from "./journey-fixture";
import { JOURNEY_STORAGE_KEY, fleet, fleetCounts, fleetPhrase, loadScreen, saveScreen, urgentRovers } from "./journey-fleet";

function memory(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v; } };
}

describe("journey fleet", () => {
  const rovers = fleet(JOURNEY_FIXTURE);

  it("puts blocked rovers first and keeps fixture order within a group", () => {
    expect(rovers.map(r => `${r.group}:${r.id}`)).toEqual([
      "blocked:mission-control-site/field-notes",
      "moving:arcadia/unattended-production",
      "moving:arcadia/operator-presence",
      "arrived:moon-garden/first-website"
    ]);
    expect(rovers[0].yourMove).toBe("Answer Decision 0017: publish now or after review");
  });

  it("counts and describes the fleet without relying on color", () => {
    expect(fleetCounts(rovers)).toEqual({ blocked: 1, moving: 2, waiting: 0, arrived: 1 });
    expect(fleetPhrase(rovers)).toBe("4 rovers: 1 blocked, 2 moving, 1 arrived");
    expect(fleetPhrase([])).toBe("0 rovers");
    expect(urgentRovers(rovers).map(r => r.id)).toEqual(["mission-control-site/field-notes"]);
  });

  it("brings back the last screen, and the fleet when that mission is gone or storage is unreadable", () => {
    const store = memory();
    expect(loadScreen(store, rovers)).toEqual({ kind: "fleet" });
    saveScreen(store, { kind: "mission", id: "arcadia/operator-presence" });
    expect(loadScreen(store, rovers)).toEqual({ kind: "mission", id: "arcadia/operator-presence" });
    expect(loadScreen(memory({ [JOURNEY_STORAGE_KEY]: "mission:gone/away" }), rovers)).toEqual({ kind: "fleet" });
    const blocked = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("QuotaExceededError"); } };
    expect(loadScreen(blocked, rovers)).toEqual({ kind: "fleet" });
    expect(() => saveScreen(blocked, { kind: "fleet" })).not.toThrow();
  });
});
