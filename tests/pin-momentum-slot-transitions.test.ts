import { describe, expect, it } from "vitest";
import { decideSlot, idleSignal, keeperSignal, type AlertSlot } from "../src/production/momentumWatch.js";

const closed: AlertSlot = { open: null, closedAt: null };
const open: AlertSlot = { open: { alertedAt: "2026-11-25T00:00:00.000Z", pingId: "ping-1", key: "k" }, closedAt: null };
const heartbeat = { session: null, armedAt: null, armedUntil: "2026-11-25T00:00:00.000Z", evidence: "e" };

describe("momentum alarm slot transitions", () => {
  it("pages on an alarm for a closed slot and closes on a clear for an open slot", () => {
    expect(decideSlot(closed, "alarm")).toBe("alert");
    expect(decideSlot(open, "clear")).toBe("close");
  });

  it("stays silent for a repeat alarm, a clear with nothing open, and any hold", () => {
    expect(decideSlot(open, "alarm")).toBeNull();
    expect(decideSlot(closed, "clear")).toBeNull();
    expect(decideSlot(open, "hold")).toBeNull();
    expect(decideSlot(closed, "hold")).toBeNull();
  });

  it("maps idle observations to a signal", () => {
    expect(idleSignal({ kind: "idle", minutes: 30 })).toBe("alarm");
    expect(idleSignal({ kind: "clear", reason: "window_closed" })).toBe("clear");
    expect(idleSignal({ kind: "unknown", reason: "x" })).toBe("hold");
  });

  it("maps keeper observations to a signal", () => {
    expect(keeperSignal({ kind: "stale", heartbeat: null, staleSince: null })).toBe("alarm");
    expect(keeperSignal({ kind: "not_required", reason: "x" })).toBe("clear");
    expect(keeperSignal({ kind: "fresh", heartbeat })).toBe("clear");
    expect(keeperSignal({ kind: "unknown", reason: "x" })).toBe("hold");
  });
});
