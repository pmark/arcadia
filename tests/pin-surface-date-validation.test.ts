import { describe, expect, it } from "vitest";
import { isValidSurfaceDate } from "../src/backBurner/surfacing.js";

describe("isValidSurfaceDate", () => {
  it.each(["2026-11-07", "2028-02-29"])("accepts the real calendar date %s", (value) => {
    expect(isValidSurfaceDate(value)).toBe(true);
  });

  it.each(["2026-02-29", "2026-04-31", "2026-13-01", "2026-1-01", "2026-11-07T00:00:00Z"])(
    "rejects %s",
    (value) => {
      expect(isValidSurfaceDate(value)).toBe(false);
    },
  );
});
