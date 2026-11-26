import { describe, expect, it } from "vitest";
import { fitPing, formatAge } from "../src/production/momentumWatch.js";

const MIN = 60_000;

describe("formatAge", () => {
  it("rounds to the nearest minute and switches to hours at 60", () => {
    expect(formatAge(0)).toBe("0 min");
    expect(formatAge(29_999)).toBe("0 min");
    expect(formatAge(30_000)).toBe("1 min");
    expect(formatAge(59 * MIN)).toBe("59 min");
    expect(formatAge(60 * MIN)).toBe("1 h 0 min");
    expect(formatAge(125 * MIN)).toBe("2 h 5 min");
  });

  it("clamps a negative age to zero", () => {
    expect(formatAge(-5 * MIN)).toBe("0 min");
  });
});

describe("fitPing", () => {
  it("returns the ping whole when it fits the limit", () => {
    expect(fitPing("H", "-detail-", "T")).toBe("H-detail-T");
    expect(fitPing("HH", "dddddd", "TT", 10)).toBe("HHddddddTT");
  });

  it("cuts only the detail and marks the cut with an ellipsis", () => {
    const out = fitPing("HEAD", "d".repeat(600), "TAIL");
    expect(out).toHaveLength(500);
    expect(out).toBe("HEAD" + "d".repeat(491) + "\u2026" + "TAIL");
    expect(fitPing("HH", "dddddddd", "TT", 10)).toBe("HH" + "d".repeat(5) + "\u2026" + "TT");
  });
});
