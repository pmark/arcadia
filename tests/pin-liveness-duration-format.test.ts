import { describe, expect, it } from "vitest";
import { formatDuration, staleEpisodeKey } from "../src/commands/productionLiveness.js";

describe("formatDuration", () => {
  it("formats seconds, rounding to the nearest second", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(1499)).toBe("1s");
    expect(formatDuration(59000)).toBe("59s");
  });

  it("formats minutes with remaining seconds", () => {
    expect(formatDuration(60000)).toBe("1m 0s");
    expect(formatDuration(125000)).toBe("2m 5s");
    expect(formatDuration(3599000)).toBe("59m 59s");
  });

  it("formats hours with remaining minutes", () => {
    expect(formatDuration(3600000)).toBe("1h 0m");
    expect(formatDuration(3725000)).toBe("1h 2m");
  });
});

describe("staleEpisodeKey", () => {
  it("keys the episode by the ISO time progress last moved", () => {
    expect(staleEpisodeKey(Date.UTC(2026, 10, 7, 12, 30, 0))).toBe("since 2026-11-07T12:30:00.000Z");
  });
});
