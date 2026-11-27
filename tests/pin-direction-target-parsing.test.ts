import { describe, expect, it } from "vitest";
import { parseDirectionCorrelation, parseDirectionTarget } from "../src/ask/directions.js";

const notObject = "Direction target must be an object.";
const badTarget = "Direction target requires an explicit Project and, for an Action, its Plan.";
const badCorrelation = "Direction correlation must pin request, fingerprint, message and receiver receipt IDs.";
const correlation = {
  requestId: "r1", fingerprint: "a".repeat(64), messageId: "m1",
  consumptionReceiptId: "c1", acknowledgmentReceiptId: "k1",
};

describe("direction target parsing", () => {
  it("accepts a trimmed Project and a full Plan/Action target", () => {
    expect(parseDirectionTarget({ projectId: " arcadia " })).toEqual({ projectId: "arcadia" });
    const full = { projectId: "arcadia", plan: "track-6", action: "pin-x1" };
    expect(parseDirectionTarget(full)).toEqual(full);
  });

  // Each case is wrapped so it.each does not spread [] into zero arguments.
  it.each([[null], [[]], ["arcadia"]])("rejects non-object target %j", (value) => {
    expect(() => parseDirectionTarget(value)).toThrow(notObject);
  });

  it.each([
    { projectId: "a", action: "x" }, { projectId: "  " },
    { projectId: "a", plan: "Bad_Plan" }, { projectId: "a", extra: 1 },
  ])("rejects target %j", (value) => {
    expect(() => parseDirectionTarget(value)).toThrow(badTarget);
  });
});

describe("direction correlation parsing", () => {
  it("accepts a fully pinned correlation", () => {
    expect(parseDirectionCorrelation({ ...correlation })).toEqual(correlation);
  });

  it.each([
    { ...correlation, fingerprint: "A".repeat(64) },
    { ...correlation, extra: "x" },
    { ...correlation, messageId: " " },
    null,
  ])("rejects correlation %j", (value) => {
    expect(() => parseDirectionCorrelation(value)).toThrow(badCorrelation);
  });
});
