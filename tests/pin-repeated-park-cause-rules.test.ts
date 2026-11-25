import { describe, expect, it } from "vitest";
import { BREAKER_WINDOW_MS, findRepeatedCause, type ParkReceipt } from "../src/production/parkAndContinue.js";

const NOW = 1_000_000_000_000;

function park(actionKey: string, over: Partial<ParkReceipt> = {}): ParkReceipt {
  return { actionKey, condition: "C4", cause: "same", causeKind: "condition-failed", project: "p", lane: "l", parkedAt: NOW, head: null, ...over };
}

describe("findRepeatedCause", () => {
  it("returns the cause when two different Actions park on it inside the window", () => {
    expect(findRepeatedCause([park("a"), park("b")], NOW)).toBe("same");
  });

  it("returns null when the same Action parks twice on the cause", () => {
    expect(findRepeatedCause([park("a"), park("a")], NOW)).toBeNull();
  });

  it("never pairs an operator-cancel park", () => {
    const cancel = (key: string) => park(key, { causeKind: "operator-cancel", reason: "stop", preservedAs: "draft" });
    expect(findRepeatedCause([cancel("a"), cancel("b")], NOW)).toBeNull();
    expect(findRepeatedCause([park("a"), cancel("b")], NOW)).toBeNull();
  });

  it("excludes a park exactly BREAKER_WINDOW_MS old and keeps one a millisecond younger", () => {
    expect(findRepeatedCause([park("a"), park("b", { parkedAt: NOW - BREAKER_WINDOW_MS })], NOW)).toBeNull();
    expect(findRepeatedCause([park("a"), park("b", { parkedAt: NOW - (BREAKER_WINDOW_MS - 1) })], NOW)).toBe("same");
  });
});
