import { describe, expect, it } from "vitest";

import { renderMissionLogMarkdown, type MissionLogMarkdownInput } from "../src/markdown/missionLog.js";

function render(log: Record<string, string | null>, project: { name: string } | null, milestone: { title: string } | null): string {
  return renderMissionLogMarkdown({ missionLog: log, project, milestone } as unknown as MissionLogMarkdownInput);
}

const LOG = {
  created_at: "2026-11-27T10:00:00.000Z",
  work_performed: "Did A",
  result: "Done",
  next_action: "Next B",
  blockers: null,
  artifact_impact: null
};

describe("renderMissionLogMarkdown", () => {
  it("renders the fixed sections with None fallbacks for a named project", () => {
    const output = render(LOG, { name: "Arcadia" }, null);
    expect(output.startsWith(
      "# Mission Log: Arcadia\n\nDate: 2026-11-27T10:00:00.000Z\nProject: Arcadia\nMilestone: None\n"
    )).toBe(true);
    expect(output).toContain("## Blockers\n\nNone\n");
    expect(output.endsWith("## Artifact Impact\n\nNone\n\n")).toBe(true);
    expect(output).toHaveLength(201);
  });

  it("reads Unassigned in the heading when there is no project", () => {
    expect(render(LOG, null, null).split("\n")[0]).toBe("# Mission Log: Unassigned");
  });

  it("pins the first and last five lines with every field present", () => {
    const lines = render(
      { created_at: "c", work_performed: "w", result: "r", blockers: "bl", next_action: "n", artifact_impact: "ai" },
      null,
      { title: "M1" }
    ).split("\n");
    expect(lines.slice(0, 5)).toEqual(["# Mission Log: Unassigned", "", "Date: c", "Project: Unassigned", "Milestone: M1"]);
    expect(lines.slice(-5)).toEqual(["## Artifact Impact", "", "ai", "", ""]);
  });
});
