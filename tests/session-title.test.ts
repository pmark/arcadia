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
      waiting: "🔍🟠 WD tidy-docs",
      blocked: "🔍🔴 WD tidy-docs",
      done: "🔍🟢 WD tidy-docs"
    });
  });

  it("falls back to the session kind when no Plan or Action resolved", () => {
    expect(formatSessionTitle({ kind: "repair", state: "waiting", plan: null, action: null })).toBe("🩹🟠 ? repair");
  });
});
