import { describe, expect, it } from "vitest";
import { parseCardExpiry } from "../src/decisions/card.js";

describe("parseCardExpiry", () => {
  it.each(["2026-11-08T03:34:16.000Z", "2026-11-08T03:34:16+05:30"])(
    "accepts strict ISO instant %s",
    (value) => {
      expect(parseCardExpiry(value)).toBe(Date.parse(value));
    },
  );

  it.each<[string, unknown]>([
    ["calendar overflow", "2026-02-30T00:00:00Z"],
    ["hour 24", "2026-11-08T24:00:00Z"],
    ["offset hour 25", "2026-11-08T03:34:16+25:00"],
    ["date only", "2026-11-08"],
    ["number", 123],
    ["null", null],
    ["over-long input", `2026-11-08T03:34:16Z${" ".repeat(21)}`],
  ])("rejects %s", (_label, value) => {
    expect(parseCardExpiry(value)).toBeNull();
  });
});
