import { describe, expect, it } from "vitest";
import { createSuccess } from "../src/cli/response.js";
import { renderScheduleReconcileSuccess, type ScheduleReconcileData } from "../src/commands/schedule.js";
import type { SchedulingPassResult, SchedulingProjectPass } from "../src/scheduling/scheduler.js";

function projectPass(overrides: Partial<SchedulingProjectPass>): SchedulingProjectPass {
  return {
    projectSlug: "alpha",
    next: null,
    currentAction: null,
    reconcile: null,
    reconcileError: null,
    boardSkipped: null,
    pointer: { moved: false, from: null, to: null, reason: "unchanged" },
    paused: null,
    ...overrides
  };
}

function passResult(projects: SchedulingProjectPass[]): SchedulingPassResult {
  return { generatedAt: new Date().toISOString(), projects, selection: null };
}

function render(pass: SchedulingPassResult): string[] {
  const data: ScheduleReconcileData = { pass, reconciles: [], preview: false };
  return renderScheduleReconcileSuccess(createSuccess({ command: "schedule.reconcile", data }));
}

describe("renderScheduleReconcileSuccess", () => {
  it("reports the GitHub error without also claiming no board is linked when reconcileBoard threw", () => {
    const lines = render(passResult([
      projectPass({ reconcileError: "GitHub item-add failed: GraphQL: Content already exists in this project (addProjectV2ItemById)" })
    ]));
    expect(lines.some((line) => line.includes("No Project is linked to a GitHub board."))).toBe(false);
    expect(lines.some((line) => line.includes("GitHub error: GitHub item-add failed"))).toBe(true);
  });

  it("still reports no board linked when nothing in the pass touched a board", () => {
    const lines = render(passResult([]));
    expect(lines.some((line) => line.includes("No Project is linked to a GitHub board."))).toBe(true);
  });

  it("does not claim no board is linked when a board was merely skipped", () => {
    const lines = render(passResult([
      projectPass({ boardSkipped: "No GitHub board is linked to this Project." })
    ]));
    expect(lines.some((line) => line.includes("No Project is linked to a GitHub board."))).toBe(false);
    expect(lines.some((line) => line.includes("board not read — No GitHub board is linked to this Project."))).toBe(true);
  });
});
