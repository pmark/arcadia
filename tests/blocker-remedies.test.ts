import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ESCALATION_REMEDIES,
  RED_ALERT_REMEDIES,
  blockerRemedyFor,
  isOneClickBlockerKind
} from "../src/production/blockerRemedies.js";
import { RED_ALERT_TRIGGERS } from "../src/production/redAlerts.js";
import { BUDGET_EXHAUSTED_ESCALATION_KIND } from "../src/production/sessionTokenCeiling.js";
import { ENVIRONMENT_WALL_ESCALATION_KIND } from "../src/production/sessionCapability.js";
import { EMITTED_ESCALATION_KINDS } from "../src/production/tick.js";

describe("blocker-kind remedy registry (#1284)", () => {
  it("(#1615) names a refused self-settled completion as a scope or validation failure, not a missing settlement commit", () => {
    const text = JSON.stringify(blockerRemedyFor("self_settled_completion_refused"));
    expect(text).toMatch(/scope or validation/);
    expect(text).not.toMatch(/does not carry its settlement commit/);
  });

  it("registers a remedy for every escalation kind the tick code constants can emit", () => {
    const missing = EMITTED_ESCALATION_KINDS.filter((kind) => !ESCALATION_REMEDIES[kind]);
    expect(missing).toEqual([]);
  });

  it("registers a remedy for every escalation kind literal passed to recordOperatorEscalation", () => {
    // A new `kind: "..."` literal at a recording site without a registered remedy fails the build.
    const source = readFileSync(path.join(__dirname, "..", "src/production/tick.ts"), "utf8");
    const literals = new Set<string>();
    for (const call of source.matchAll(/recordOperatorEscalation\(db, \{([^}]*)\}/g)) {
      const literal = /kind:\s*"([a-z_]+)"/.exec(call[1]);
      if (literal) literals.add(literal[1]);
    }
    expect([...literals].length).toBeGreaterThan(0);
    expect([...literals].filter((kind) => !blockerRemedyFor(kind))).toEqual([]);
  });

  it("registers a remedy for every Red Alert trigger", () => {
    expect(RED_ALERT_TRIGGERS.filter((trigger) => !RED_ALERT_REMEDIES[trigger])).toEqual([]);
  });

  it("registers the four named platform stops, with the one-click clears pinned to the reset semantics", () => {
    for (const kind of [ENVIRONMENT_WALL_ESCALATION_KIND, BUDGET_EXHAUSTED_ESCALATION_KIND]) {
      expect(blockerRemedyFor(kind)).toMatchObject({ remedyActionId: "reset-repair-budget", surface: "todo", oneClick: true });
      expect(isOneClickBlockerKind(kind)).toBe(true);
    }
    for (const kind of ["scope_successor_held", "scope_pointer_mismatch"]) {
      expect(blockerRemedyFor(kind)).toMatchObject({ label: "Turn production Off", remedyActionId: "turn-production-off", surface: "production", href: "/production", oneClick: false });
    }
  });

  it("gives every entry a label, a consequence and a consistent control, and grants nothing", () => {
    for (const remedy of [...Object.values(ESCALATION_REMEDIES), ...Object.values(RED_ALERT_REMEDIES)]) {
      expect(remedy.label.length).toBeGreaterThan(0);
      expect(remedy.consequence.length).toBeGreaterThan(20);
      expect(remedy.oneClick).toBe(remedy.remedyActionId === "reset-repair-budget");
      if (remedy.surface === "production") expect(remedy.href).toMatch(/^\/production/);
    }
    expect(Object.values(ESCALATION_REMEDIES).filter((entry) => entry.oneClick).map((entry) => entry.kind).sort()).toEqual(["budget_exhausted", "environment_wall"]);
  });
});
