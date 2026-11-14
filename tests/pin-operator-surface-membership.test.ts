import { describe, expect, it } from "vitest";
import { isOperatorSurface } from "../src/activity/types.js";

describe("isOperatorSurface", () => {
  it("counts cli, dashboard and discord as operator-touched surfaces", () => {
    expect(isOperatorSurface("cli")).toBe(true);
    expect(isOperatorSurface("dashboard")).toBe(true);
    expect(isOperatorSurface("discord")).toBe(true);
  });

  it("does not count claude or automation as operator-touched surfaces", () => {
    expect(isOperatorSurface("claude")).toBe(false);
    expect(isOperatorSurface("automation")).toBe(false);
  });
});
