import { describe, expect, it } from "vitest";
import { unverifiableReason, type LeakSnapshot } from "../src/workspace/leakCheck.js";

function snapshot(path: string | null, error: string | null): LeakSnapshot {
  return { liveWorkspace: { path, error } } as unknown as LeakSnapshot;
}

describe("unverifiableReason", () => {
  it("is null with no snapshots", () => {
    expect(unverifiableReason()).toBeNull();
  });

  it("is null when no snapshot records a live workspace error", () => {
    expect(unverifiableReason(snapshot("/w/live", null), snapshot("/w/live", null))).toBeNull();
  });

  it("names the path and error of the first errored snapshot", () => {
    expect(unverifiableReason(snapshot("/w/live", null), snapshot("/w/live", "boom"), snapshot("/w/live", "late")))
      .toBe("live workspace /w/live was not observed: boom");
  });

  it("names an unset path as (none)", () => {
    expect(unverifiableReason(snapshot(null, "boom"))).toBe("live workspace (none) was not observed: boom");
  });
});
