import { describe, expect, it } from "vitest";
import {
  BREAKER_LANE_INPUT_TOKEN_CEILING,
  HOUR_MS,
  PARK_NIGHT_MS,
  admitNextIndependent,
  cancelAction,
  decideParkedMerge,
  evaluateNightBreaker,
  mergeVetoed,
  recordFailedCondition,
  type AdmissionAction,
  type BreakerInput,
  type ParkReceipt,
  type ParkState
} from "../src/production/parkAndContinue.js";

const NOW = Date.parse("2026-11-23T06:00:00Z");
const empty: ParkState = { parks: [] };

const park = (key: string, cause: string, ageMs = 0, lane = "autonomous"): ParkReceipt => ({
  actionKey: key, condition: "C4", cause, causeKind: "condition-failed", project: "arcadia", lane, parkedAt: NOW - ageMs, head: "aaa"
});

const breaker = (over: Partial<BreakerInput> = {}): BreakerInput => ({
  project: "arcadia", lane: "autonomous", now: NOW, parks: [], merges: [], laneFirstAdmissionAt: NOW - 48 * HOUR_MS,
  usage: { inputTokens: 0, claudeWindows: [] }, ...over
});

describe("park and continue", () => {
  it("records (action, condition, cause), leaves the Action open, and admission skips dependents for the next independent Action", () => {
    const out = recordFailedCondition(empty, { actionKey: "a", condition: "C4", cause: "touches gate set", project: "arcadia", lane: "autonomous", now: NOW, head: "abc" });
    expect(out.kind).toBe("park");
    if (out.kind !== "park") return;
    expect(out.receipt).toMatchObject({ actionKey: "a", condition: "C4", cause: "touches gate set" });
    const actions: AdmissionAction[] = [
      { key: "a", status: "open", dependsOn: [] },
      { key: "b", status: "open", dependsOn: ["a"] },
      { key: "c", status: "open", dependsOn: ["b"] },
      { key: "d", status: "open", dependsOn: [] }
    ];
    expect(actions[0].status).toBe("open");
    const result = admitNextIndependent(actions, out.state.parks);
    expect(result.admit).toBe("d");
    expect(result.skipped.map((s) => s.key)).toEqual(["a", "b", "c"]);
    expect(admitNextIndependent(actions, []).admit).toBe("a");
  });

  it("treats sign-in, capacity and outage as holds, not parks", () => {
    for (const hold of ["sign-in", "capacity", "outage"] as const) {
      const out = recordFailedCondition(empty, { actionKey: "a", condition: "x", cause: hold, project: "arcadia", lane: "autonomous", now: NOW, hold });
      expect(out.kind).toBe("hold");
    }
  });

  it("stops production on a second park with the same cause, and on main going red", () => {
    const first = recordFailedCondition(empty, { actionKey: "a", condition: "C4", cause: "same", project: "arcadia", lane: "autonomous", now: NOW });
    if (first.kind !== "park") throw new Error("expected park");
    expect(first.stopProduction).toBe(false);
    const second = recordFailedCondition(first.state, { actionKey: "b", condition: "C2", cause: "same", project: "arcadia", lane: "autonomous", now: NOW + 1000 });
    expect(second).toMatchObject({ kind: "park", stopProduction: true });
    expect(recordFailedCondition(empty, { actionKey: "a", condition: "x", cause: "y", project: "arcadia", lane: "l", now: NOW, mainRed: true })).toMatchObject({ kind: "stop" });
    expect(evaluateNightBreaker(breaker({ mainRed: true }))).toMatchObject({ pause: "production", page: true });
    expect(evaluateNightBreaker(breaker({ parks: [park("a", "same"), park("b", "same", HOUR_MS)] }))).toMatchObject({ pause: "production", page: true });
  });

  describe("night breaker", () => {
    it("trips at 3 parks in 24 hours for the lane and pages; older or other-lane parks do not count", () => {
      const three = [park("a", "c1"), park("b", "c2"), park("c", "c3")];
      expect(evaluateNightBreaker(breaker({ parks: three }))).toMatchObject({ pause: "lane", page: true, trips: ["parks"] });
      expect(evaluateNightBreaker(breaker({ parks: [park("a", "c1"), park("b", "c2")] })).pause).toBe("none");
      expect(evaluateNightBreaker(breaker({ parks: [park("a", "c1"), park("b", "c2"), park("c", "c3", 25 * HOUR_MS)] })).pause).toBe("none");
      expect(evaluateNightBreaker(breaker({ parks: [park("a", "c1"), park("b", "c2"), park("c", "c3", 0, "operator")] })).pause).toBe("none");
    });

    it("trips at 3 merges in a lane's first 24 hours and at 6 after", () => {
      const merges = (n: number) => Array.from({ length: n }, (_, i) => NOW - i * HOUR_MS);
      const fresh = { laneFirstAdmissionAt: NOW - 10 * HOUR_MS };
      expect(evaluateNightBreaker(breaker({ ...fresh, merges: merges(3) }))).toMatchObject({ pause: "lane", page: true, trips: ["merges"] });
      expect(evaluateNightBreaker(breaker({ ...fresh, merges: merges(2) })).pause).toBe("none");
      expect(evaluateNightBreaker(breaker({ merges: merges(5) })).pause).toBe("none");
      expect(evaluateNightBreaker(breaker({ merges: merges(6) }))).toMatchObject({ pause: "lane", trips: ["merges"] });
    });

    it("trips at the 40M lane token ceiling and at the Claude 5-hour window at 70%", () => {
      expect(evaluateNightBreaker(breaker({ usage: { inputTokens: BREAKER_LANE_INPUT_TOKEN_CEILING, claudeWindows: [] } }))).toMatchObject({ pause: "lane", trips: ["tokens"] });
      expect(evaluateNightBreaker(breaker({ usage: { inputTokens: BREAKER_LANE_INPUT_TOKEN_CEILING - 1, claudeWindows: [] } })).pause).toBe("none");
      const win = (pct: number) => [{ label: "5-hour", usedPercentage: pct, remainingPercentage: 100 - pct, resetsAt: null }, { label: "7-day", usedPercentage: 99, remainingPercentage: 1, resetsAt: null }];
      expect(evaluateNightBreaker(breaker({ usage: { inputTokens: 0, claudeWindows: win(70) } }))).toMatchObject({ pause: "lane", page: true, trips: ["claude-window"] });
      expect(evaluateNightBreaker(breaker({ usage: { inputTokens: 0, claudeWindows: win(69) } })).pause).toBe("none");
    });
  });

  it("re-reviews a park older than one night at its current head and never merges it as recorded", () => {
    const old = park("a", "c", PARK_NIGHT_MS + HOUR_MS);
    expect(decideParkedMerge(old, "bbb", NOW)).toMatchObject({ mergeAsRecorded: false, rereview: true, reviewHead: "bbb" });
    expect(decideParkedMerge(park("a", "c", HOUR_MS), "aaa", NOW)).toMatchObject({ mergeAsRecorded: false, rereview: false });
  });

  it("operator-cancel stops admission, vetoes a pending merge, preserves a draft and records the reason", () => {
    const actions: AdmissionAction[] = [{ key: "a", status: "open", dependsOn: [] }, { key: "b", status: "open", dependsOn: [] }];
    const result = cancelAction(empty, { actionKey: "a", project: "arcadia", lane: "autonomous", reason: "operator changed plan", now: NOW, head: "abc" });
    if ("error" in result) throw new Error(result.error);
    expect(result).toMatchObject({ stopAdmission: true, vetoPendingMerge: true, preserveAs: "draft" });
    expect(result.receipt).toMatchObject({ causeKind: "operator-cancel", reason: "operator changed plan", preservedAs: "draft" });
    expect(admitNextIndependent(actions, result.state.parks).admit).toBe("b");
    expect(mergeVetoed(result.state, "a")).toBe(true);
    expect(mergeVetoed(result.state, "b")).toBe(false);
    expect(decideParkedMerge(result.receipt, "abc", NOW).rereview).toBe(false);
    expect(cancelAction(empty, { actionKey: "a", project: "arcadia", lane: "l", reason: " ", now: NOW })).toHaveProperty("error");
    // a cancel is not a condition park: two cancels never trip the same-cause stop
    const second = cancelAction(result.state, { actionKey: "b", project: "arcadia", lane: "autonomous", reason: "operator changed plan", now: NOW });
    if ("error" in second) throw new Error(second.error);
    expect(evaluateNightBreaker(breaker({ parks: second.state.parks })).pause).toBe("none");
  });
});
