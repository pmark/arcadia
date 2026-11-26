import { describe, expect, it } from "vitest";
import { asksToStopProduction } from "../src/way/lookup.js";

describe("asksToStopProduction", () => {
  it.each([
    "How do I stop production?",
    "stop everything",
    "Please HALT the production run",
    "turn the production off",
    "turn off production",
    "shut off the production",
    "shut everything off",
    "where is the off button"
  ])("reads %j as asking to stop production", (question) => {
    expect(asksToStopProduction(question)).toBe(true);
  });

  it.each([
    "turn off notifications",
    "switch production off",
    "shut down production",
    "halt everything",
    "how do I start production",
    "stop the timer"
  ])("does not read %j as asking to stop production", (question) => {
    expect(asksToStopProduction(question)).toBe(false);
  });
});
