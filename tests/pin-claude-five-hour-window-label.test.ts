import { describe, expect, it } from "vitest";
import { claudeFiveHourPercent } from "../src/production/parkAndContinue.js";

type Windows = NonNullable<Parameters<typeof claudeFiveHourPercent>[0]>;
const win = (label: string, usedPercentage: number) => ({ label, usedPercentage }) as Windows[number];

describe("claudeFiveHourPercent window labels", () => {
  it.each(["5-hour", "5h", "5 hour", "Five hour", "five-hour session", "5hour"])(
    "reads %j beside a 7-day window",
    (label) => {
      expect(claudeFiveHourPercent([win("7-day", 10), win(label, 42)])).toBe(42);
    },
  );

  it("returns the first of two matching windows", () => {
    expect(claudeFiveHourPercent([win("5h", 11), win("five-hour", 99)])).toBe(11);
  });

  it("returns null for null, an empty list, and only non-five-hour windows", () => {
    expect(claudeFiveHourPercent(null)).toBeNull();
    expect(claudeFiveHourPercent([])).toBeNull();
    expect(claudeFiveHourPercent([win("7-day", 5), win("weekly", 6)])).toBeNull();
  });
});
