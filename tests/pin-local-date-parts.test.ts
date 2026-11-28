import { describe, expect, it } from "vitest";

import { localDateParts } from "../src/utils/time.js";

describe("localDateParts", () => {
  it("zero-pads a single-digit local day", () => {
    expect(localDateParts(new Date(2026, 10, 7, 9, 5))).toEqual({ year: "2026", month: "11", day: "07" });
  });

  it("zero-pads a single-digit local month late in the day", () => {
    expect(localDateParts(new Date(2026, 0, 31, 23, 59))).toEqual({ year: "2026", month: "01", day: "31" });
  });

  it("reports the last local day of the year", () => {
    expect(localDateParts(new Date(2026, 11, 31, 12))).toEqual({ year: "2026", month: "12", day: "31" });
  });
});
