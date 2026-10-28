import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { runGoBroker } from "../src/goBroker.js";
import type { NextCommandData } from "../src/commands/next.js";
import { renderStateSignalInstructions } from "../src/sessions/sessionTitle.js";

// Reviewed rendered examples are source-only fixtures, never evidence of live provider support.
const fixtures = JSON.parse(readFileSync(new URL("./fixtures/go-state-signals.json", import.meta.url), "utf8")) as Array<{
  agent: "codex" | "claude" | "opencode";
  scenario: string;
  next: NextCommandData;
  sessionTitles: Record<"working" | "pr" | "ci" | "waiting" | "blocked" | "done" | "parked", string>;
  opening: string;
}>;

describe("rendered native Go state signals (local fixtures only)", () => {
  it.each(fixtures)("$agent: $scenario", fixture => {
    const result = runGoBroker(
      { source: "/fixture/candidate", agent: fixture.agent, operation: "brief" },
      vi.fn() as never,
      vi.fn(() => ({ data: { transition: null, session: null } })) as never,
      vi.fn(() => ({ data: { snapshot: {}, attentionLines: [] } })) as never,
      () => "/fixture/unavailable-workspace",
      vi.fn(() => ({ ok: true, data: fixture.next })) as never,
      () => "fixture"
    );
    if (!("dispatchBrief" in result.data)) throw new Error("Expected brief");
    expect(result.data.sessionTitles).toEqual(fixture.sessionTitles);
    expect(result.data.dispatchBrief.startsWith(fixture.opening + "\n\n")).toBe(true);
    expect(fixture.opening).toContain("no active workers verified");
    expect(fixture.opening).toContain("Title tool unavailable; suggested title:");
    expect(fixture.opening).toContain("Native activity does not prove governed Session admission");
    if (fixture.scenario.startsWith("selected-a-assigned-b")) {
      expect(fixture.opening).toContain("assigned assigned-plan#assigned-b; selected selected-plan#selected-a");
      expect(Object.values(fixture.sessionTitles).every(title => title.includes("AP assigned-b") && !title.includes("selected-a"))).toBe(true);
      if (fixture.scenario.endsWith("-blocked")) {
        expect(fixture.opening).toContain("fixture-session [running] (stored observation)");
        expect(fixture.opening).toContain("Next: Wait for external dependency.");
        expect(fixture.sessionTitles.blocked).toBe("🔨🔴 AP assigned-b");
      }
    } else {
      expect(fixture.opening).toContain("assigned none");
      expect(fixture.opening).toContain("no active Session evidence");
      expect(Object.values(fixture.sessionTitles).every(title => title.endsWith("selected; unassigned") && !title.startsWith("↳"))).toBe(true);
    }
  });

  it("instructs all runtimes to require observed transitions and verified parentage", () => {
    for (const fixture of fixtures) {
      const instructions = renderStateSignalInstructions(fixture.agent, fixture.sessionTitles).join("\n");
      expect(instructions).toContain("helper arrow only for a verified named parent");
      expect(instructions).toContain("Idle, silence and end-of-turn alone never imply pause, completion or custody release");
      expect(instructions).toContain("ci = independent review cleared and required checks remain");
      expect(instructions).toContain("parked = deliberate hold/handoff");
      expect(instructions).toContain("Never assert a title update without a successful tool result");
    }
  });
});
