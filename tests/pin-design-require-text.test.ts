import { describe, expect, it } from "vitest";

import { Findings, requireText } from "../src/design/common.js";

describe("requireText", () => {
  it("returns non-blank text unchanged and records no problem", () => {
    const findings = new Findings();
    expect(requireText(findings, "plan", "  x ", "title")).toBe("  x ");
    expect(findings.problems).toEqual([]);
  });

  it("returns null and records one problem for whitespace-only text", () => {
    const findings = new Findings();
    expect(requireText(findings, "plan", "   ", "title")).toBeNull();
    expect(findings.problems).toEqual(["plan: title is required and must not be blank."]);
  });

  it("returns null and records one problem for a non-string value", () => {
    const findings = new Findings();
    expect(requireText(findings, "plan", 5, "title")).toBeNull();
    expect(findings.problems).toHaveLength(1);
  });
});
