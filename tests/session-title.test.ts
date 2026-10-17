import { describe, expect, it } from "vitest";
import { formatSessionTitle, planAcronym, sessionTitlesByState } from "../src/sessions/sessionTitle.js";

describe("session titles", () => {
  it("abbreviates a Plan slug to at most four significant initials", () => {
    expect(planAcronym("bootstrap-managed-production-to-build-flight-deck")).toBe("BMPB");
    expect(planAcronym("way-delivery")).toBe("WD");
    expect(planAcronym("mission-control-view")).toBe("MCV");
    expect(planAcronym("the-to-of")).toBe("TTO");
  });

  it("keeps three letters of a one-word Plan slug", () => {
    expect(planAcronym("playground")).toBe("PLA");
  });

  it("puts the Action id within the first twenty characters", () => {
    const title = formatSessionTitle({
      kind: "build",
      state: "working",
      plan: "bootstrap-managed-production-to-build-flight-deck",
      action: "stop-dumping-rationale-into-recommendation"
    });
    expect(title).toBe("🔨🔵 BMPB stop-dumping-rationale-into-recommendation");
    expect(Array.from(title).slice(0, 20).join("")).toContain("stop-dump");
  });

  it("changes only the state glyph between states", () => {
    const titles = sessionTitlesByState({ kind: "review", plan: "way-delivery", action: "tidy-docs" });
    expect(titles).toEqual({
      working: "🔍🔵 WD tidy-docs",
      pr: "🔍🟣 WD tidy-docs",
      ci: "🔍🟡 WD tidy-docs",
      waiting: "🔍🟠 WD tidy-docs",
      blocked: "🔍🔴 WD tidy-docs",
      done: "🔍🟢 WD tidy-docs",
      parked: "🔍⏸ WD tidy-docs"
    });
  });

  it("omits the acronym when no Plan resolved", () => {
    expect(formatSessionTitle({ kind: "build", state: "pr", plan: null, action: "scannable-session-titles" })).toBe("🔨🟣 scannable-session-titles");
  });

  it("falls back to the session kind when no Plan or Action resolved", () => {
    expect(formatSessionTitle({ kind: "repair", state: "waiting", plan: null, action: null })).toBe("🩹🟠 repair");
  });

  it("leads a coordinator with the stoplight and a helper with the arrow (chat-titles.md)", () => {
    expect(formatSessionTitle({
      kind: "build", state: "waiting", plan: null, action: null, relation: "coordinator",
      workstream: "Lead trials", details: ["approve pilot budget"]
    })).toBe("🚦🟠 Lead trials · approve pilot budget");
    expect(formatSessionTitle({
      kind: "plan", state: "working", plan: null, action: null, relation: "helper",
      workstream: "Lead trials", details: ["planner"]
    })).toBe("↳ 🧭🔵 Lead trials · planner");
    expect(formatSessionTitle({
      kind: "build", state: "blocked", plan: null, action: null, relation: "helper",
      workstream: "Production", details: ["implementer", "blocked: host permission"]
    })).toBe("↳ 🔨🔴 Production · implementer · blocked: host permission");
    expect(formatSessionTitle({
      kind: "build", state: "parked", plan: null, action: null, relation: "coordinator",
      workstream: "Lead trials", details: ["former coordinator"]
    })).toBe("🚦⏸ Lead trials · former coordinator");
  });

  it("keeps the Plan acronym and Action for a helper without a workstream label", () => {
    expect(formatSessionTitle({ kind: "review", state: "pr", plan: "way-delivery", action: "tidy-docs", relation: "helper" }))
      .toBe("↳ 🔍🟣 WD tidy-docs");
  });
});
