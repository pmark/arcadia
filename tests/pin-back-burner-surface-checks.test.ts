import { describe, expect, it } from "vitest";

import { evaluateBackBurnerSurface } from "../src/backBurner/surfacing.js";

type Db = Parameters<typeof evaluateBackBurnerSurface>[0];
type Item = Parameters<typeof evaluateBackBurnerSurface>[1];

const NOW = new Date("2026-11-27T12:00:00.000Z");

// None of these cases reads the database, so an empty object stands in for it.
function evaluate(fields: Partial<Item>) {
  const item = { surface_kind: null, surface_date: null, surface_predicate: null, ...fields } as Item;
  return evaluateBackBurnerSurface({} as Db, item, NOW);
}

describe("evaluateBackBurnerSurface without a database read", () => {
  it.each([null, "manual"] as const)("treats surface_kind %j as manual and never fires", (kind) => {
    expect(evaluate({ surface_kind: kind })).toEqual({ condition: { kind: "manual" }, fired: false, warning: null });
  });

  it.each([
    ["2026-11-20", true],
    ["2026-12-05", false]
  ])("fires a date condition on %s only once it has passed: %j", (date, fired) => {
    expect(evaluate({ surface_kind: "date", surface_date: date })).toEqual({
      condition: { kind: "date", date },
      fired,
      warning: null
    });
  });

  it.each([
    ["2026-02-30", "2026-02-30"],
    [null, ""]
  ])("warns on an invalid surface date %j", (surfaceDate, date) => {
    expect(evaluate({ surface_kind: "date", surface_date: surfaceDate })).toEqual({
      condition: { kind: "date", date },
      fired: false,
      warning: `Invalid surface date: ${date}`
    });
  });

  it("warns on an unknown surface predicate", () => {
    expect(evaluate({ surface_kind: "predicate", surface_predicate: "no-such-check" })).toEqual({
      condition: { kind: "predicate", name: "no-such-check" },
      fired: false,
      warning: "Unknown surface predicate: no-such-check"
    });
  });
});
