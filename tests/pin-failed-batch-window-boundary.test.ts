import { describe, expect, it } from "vitest";
import { failedBatchesInWindow } from "../src/operatorActions/startRunDayGrant.js";

const opens = Date.parse("2026-11-24T12:00:00.000Z");
const activation = (requestId: string, endedAt: string | null, admitted = 1, scopeComplete: { merged: number; escalated: number } | null = null) =>
  ({ requestId, revisionAfter: 1, at: "2026-11-24T11:00:00.000Z", admitted, endedAt, scopeComplete });

describe("failedBatchesInWindow", () => {
  it("keeps failed batches that ended at the opening, after it, or not at all, in order", () => {
    const atOpen = activation("a", "2026-11-24T12:00:00.000Z");
    const after = activation("b", "2026-11-24T12:00:00.001Z");
    const open = activation("c", null);
    expect(failedBatchesInWindow({ transitions: [], activations: [atOpen, after, open] }, opens)).toEqual([atOpen, after, open]);
  });

  it("leaves out a batch that ended a millisecond early, a clean batch and an activation with no Session", () => {
    const early = activation("d", "2026-11-24T11:59:59.999Z");
    const clean = activation("e", null, 1, { merged: 2, escalated: 0 });
    const none = activation("f", null, 0);
    expect(failedBatchesInWindow({ transitions: [], activations: [early, clean, none] }, opens)).toEqual([]);
  });
});
