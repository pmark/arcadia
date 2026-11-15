import { describe, expect, it } from "vitest";

import { Findings, requireEnum } from "../src/design/common.js";

describe("requireEnum", () => {
  it("returns an allowed value unchanged and records no problem", () => {
    const findings = new Findings();
    expect(requireEnum(findings, "plan", "b", "status", ["a", "b"])).toBe("b");
    expect(findings.problems).toEqual([]);
  });

  it("returns null and records one problem for a value outside the list", () => {
    const findings = new Findings();
    expect(requireEnum(findings, "plan", "c", "status", ["a", "b"])).toBeNull();
    expect(findings.problems).toEqual(["plan: status must be one of a, b."]);
  });

  it("returns null and marks the problem (missing) for undefined", () => {
    const findings = new Findings();
    expect(requireEnum(findings, "plan", undefined, "status", ["a", "b"])).toBeNull();
    expect(findings.problems).toEqual(["plan: status must be one of a, b (missing)."]);
  });
});
