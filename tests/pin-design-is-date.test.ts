import { describe, expect, it } from "vitest";

import { isDate } from "../src/design/common.js";

describe("isDate", () => {
  it("accepts real calendar dates written as YYYY-MM-DD", () => {
    expect(isDate("2026-11-07")).toBe(true);
    expect(isDate("2028-02-29")).toBe(true);
  });

  it("rejects impossible, malformed, timestamped and non-string values", () => {
    expect(isDate("2026-02-29")).toBe(false);
    expect(isDate("2026-11-7")).toBe(false);
    expect(isDate("2026-11-07T00:00:00Z")).toBe(false);
    expect(isDate("2026-13-01")).toBe(false);
    expect(isDate(20261107)).toBe(false);
  });
});
