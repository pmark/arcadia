import { describe, expect, it } from "vitest";

import { urgencyLevelForScore } from "../src/orientation/urgency.js";

describe("urgencyLevelForScore thresholds", () => {
  it.each([0.75, 1])("labels %j critical", (score) => {
    expect(urgencyLevelForScore(score)).toBe("critical");
  });

  it.each([0.74, 0.4])("labels %j attention", (score) => {
    expect(urgencyLevelForScore(score)).toBe("attention");
  });

  it.each([0.39, 0])("labels %j quiet", (score) => {
    expect(urgencyLevelForScore(score)).toBe("quiet");
  });
});
