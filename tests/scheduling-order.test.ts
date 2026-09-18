import { describe, expect, it } from "vitest";
import { applyOperatorOrder, canonicalOrder, minimalMoves, type OrderCandidate } from "../src/scheduling/order.js";

function candidate(key: string, overrides: Partial<OrderCandidate> = {}): OrderCandidate {
  return { key, schedulingClass: "planned", position: null, dependsOn: [], done: false, index: 0, ...overrides };
}

describe("canonicalOrder", () => {
  it("orders by tier first, then queue position, then declaration order", () => {
    const order = canonicalOrder([
      candidate("p/a", { position: 0, index: 0 }),
      candidate("p/b", { position: 1, index: 1 }),
      candidate("p/x", { schedulingClass: "corrective", position: 5, index: 2 }),
      candidate("p/i", { schedulingClass: "interrupt", position: 9, index: 3 }),
      candidate("p/k", { schedulingClass: "blocker", position: 7, index: 4 }),
      candidate("p/c", { index: 5 })
    ]);
    expect(order).toEqual(["p/i", "p/k", "p/x", "p/a", "p/b", "p/c"]);
  });

  it("holds an Action behind its unfinished dependencies whatever its position or tier", () => {
    const order = canonicalOrder([
      candidate("p/a", { position: 1 }),
      candidate("p/b", { position: 0, dependsOn: ["p/a"] }),
      candidate("p/fix", { schedulingClass: "blocker", position: 2, dependsOn: ["p/b"] })
    ]);
    expect(order).toEqual(["p/a", "p/b", "p/fix"]);
  });

  it("ignores done dependencies, unknown dependencies, done Actions and follow-ups", () => {
    const order = canonicalOrder([
      candidate("p/done", { done: true, position: 0 }),
      candidate("p/a", { position: 1, dependsOn: ["p/done", "p/elsewhere"] }),
      candidate("p/later", { schedulingClass: "follow_up", position: 0 })
    ]);
    expect(order).toEqual(["p/a"]);
  });
});

describe("applyOperatorOrder", () => {
  const base = [
    candidate("p/x", { schedulingClass: "corrective", position: 0, index: 0 }),
    candidate("p/a", { position: 1, index: 1 }),
    candidate("p/b", { position: 2, index: 2 }),
    candidate("p/c", { position: 3, index: 3 })
  ];

  it("accepts a reorder within one tier exactly as dragged", () => {
    const result = applyOperatorOrder(base, ["p/x", "p/c", "p/a", "p/b"]);
    expect(result.operatorMoved).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.normalized).toBe(false);
    expect(result.canonical).toEqual(["p/x", "p/c", "p/a", "p/b"]);
  });

  it("keeps the intra-tier intent but refuses a planned card dragged above a corrective, with a reason", () => {
    const result = applyOperatorOrder(base, ["p/c", "p/x", "p/a", "p/b"]);
    expect(result.operatorMoved).toBe(true);
    expect(result.canonical).toEqual(["p/x", "p/c", "p/a", "p/b"]);
    expect(result.normalized).toBe(true);
    expect(result.normalizationReasons).toEqual(["p/c (planned) cannot move ahead of p/x (corrective)."]);
  });

  it("refuses a dependent dragged above its dependency and says why", () => {
    const candidates = [candidate("p/a", { position: 0, index: 0 }), candidate("p/b", { position: 1, index: 1, dependsOn: ["p/a"] })];
    const result = applyOperatorOrder(candidates, ["p/b", "p/a"]);
    expect(result.canonical).toEqual(["p/a", "p/b"]);
    expect(result.changed).toBe(false);
    expect(result.normalized).toBe(true);
    expect(result.normalizationReasons).toEqual(["p/b depends on p/a, so it stays behind it."]);
  });

  it("reports no operator move when the board matches canonical, and tolerates unknown or missing cards", () => {
    const result = applyOperatorOrder(base, ["other/z", "p/x", "p/a", "p/b"]);
    expect(result.operatorMoved).toBe(false);
    expect(result.changed).toBe(false);
    expect(result.requested).toEqual(["p/x", "p/a", "p/b", "p/c"]);
  });
});

function applyMoves(order: string[], moves: Array<{ key: string; after: string | null }>): string[] {
  let current = [...order];
  for (const move of moves) {
    current = current.filter((key) => key !== move.key);
    current.splice(move.after === null ? 0 : current.indexOf(move.after) + 1, 0, move.key);
  }
  return current;
}

describe("minimalMoves", () => {
  it("moves only the cards that are out of relative order", () => {
    const swap = minimalMoves(["a", "b", "c", "d"], ["a", "c", "b", "d"]);
    expect(swap).toHaveLength(1);
    expect(applyMoves(["a", "b", "c", "d"], swap)).toEqual(["a", "c", "b", "d"]);
    expect(applyMoves(["d", "c", "b", "a"], minimalMoves(["d", "c", "b", "a"], ["a", "b", "c", "d"]))).toEqual(["a", "b", "c", "d"]);
    expect(minimalMoves(["a", "b", "c"], ["a", "b", "c"])).toEqual([]);
    expect(minimalMoves(["b", "c"], ["a", "b", "c"])).toEqual([{ key: "a", after: null }]);
  });
});
