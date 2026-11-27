import { describe, expect, it } from "vitest";
import { parseUtcTimestamp } from "../src/agentWatch/contract.js";

describe("strict UTC timestamp parsing", () => {
  it.each([
    ["2026-11-26T17:36:45Z", 1795714605000],
    ["2026-11-26T17:36:45.287Z", 1795714605287],
    ["2026-11-26T17:36:45.2Z", 1795714605200],
    ["2024-02-29T00:00:00Z", 1709164800000],
  ])("accepts %s as a strict UTC instant", (value, expected) => {
    expect(parseUtcTimestamp(value)).toBe(expected);
  });

  it.each([
    "2026-11-26T17:36:45.1234Z",
    "2026-11-26T09:36:45-08:00",
    "2026-11-26",
    "2026-11-26 17:36:45Z",
    "2026-11-26T17:36:45z",
    "2026-02-31T00:00:00Z",
    "2026-13-01T00:00:00Z",
    "2026-11-26T24:00:00Z",
    "",
  ])("rejects %j", (value) => {
    expect(parseUtcTimestamp(value)).toBeNull();
  });
});
