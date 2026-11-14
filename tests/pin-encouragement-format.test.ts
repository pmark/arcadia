import { describe, expect, it } from "vitest";
import { formatEncouragement } from "../src/activity/encouragement.js";

describe("formatEncouragement", () => {
  it("shows a line with no attribution bare", () => {
    expect(formatEncouragement({ mood: "steady", line: "Pick one thing." })).toBe("Pick one thing.");
  });

  it("quotes a line and follows it with an em dash and its attribution", () => {
    expect(formatEncouragement({ mood: "steady", line: "Keep going.", attribution: "Seneca" })).toBe(
      '"Keep going." — Seneca'
    );
  });
});
