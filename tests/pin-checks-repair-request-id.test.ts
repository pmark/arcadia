import { describe, expect, it } from "vitest";
import { requiredChecksRepairRequestId } from "../src/sessions/reviewRepair.js";

describe("requiredChecksRepairRequestId", () => {
  it("combines the failed Session id and head under a fixed prefix", () => {
    expect(requiredChecksRepairRequestId("session-1", "abc123")).toBe("worker-tick-checks-repair-session-1-abc123");
  });

  it("differs when either the Session id or the head differs", () => {
    const base = requiredChecksRepairRequestId("s", "h1");
    expect(requiredChecksRepairRequestId("s", "h2")).not.toBe(base);
    expect(requiredChecksRepairRequestId("t", "h1")).not.toBe(base);
  });
});
