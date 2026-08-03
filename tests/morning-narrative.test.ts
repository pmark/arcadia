import { describe, expect, it } from "vitest";
import { composeMorningNarrative, type MorningNarrativeSnapshot } from "../src/orientation/morningNarrative.js";

function snapshot(overrides: Partial<MorningNarrativeSnapshot> = {}): MorningNarrativeSnapshot {
  return {
    recentLogs: [{
      project_name: "Arcadia",
      work_performed: "Added narrative digests.",
      result: "Morning updates now tell a coherent story.",
      blockers: null,
      next_action: "Delegate the ready scheduler Action.",
      created_at: "2026-08-02T18:00:00.000Z"
    }],
    completedActions7d: 6,
    completedActionsPrevious7d: 4,
    readyArtifacts7d: 3,
    pendingDecisions: 0,
    blockedActions: 0,
    ...overrides
  };
}

describe("morning narrative", () => {
  it("connects recent change, velocity, friction, and delegation opportunity", () => {
    const narrative = composeMorningNarrative(snapshot());

    expect(narrative).toContain("Recent changes: Arcadia: Morning updates now tell a coherent story.");
    expect(narrative).toContain("Velocity: 6 completed Actions and 3 ready Artifacts");
    expect(narrative).toContain("up by 2 from the preceding week");
    expect(narrative).toContain("No explicit blocked Actions or pending Decisions");
    expect(narrative).toContain("strong candidate for direct coding-agent delegation");
  });

  it("names accumulated friction without inventing a diagnosis", () => {
    const narrative = composeMorningNarrative(snapshot({
      pendingDecisions: 2,
      blockedActions: 1,
      recentLogs: [{
        ...snapshot().recentLogs[0],
        blockers: "The local model is unavailable."
      }]
    }));

    expect(narrative).toContain("2 pending Decisions");
    expect(narrative).toContain("1 blocked Action");
    expect(narrative).toContain("Arcadia: The local model is unavailable.");
  });

  it("is honest when there is no recent Log activity", () => {
    expect(composeMorningNarrative(snapshot({ recentLogs: [] }))).toContain("no new Log entries");
  });
});
