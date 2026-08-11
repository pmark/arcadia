import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { applyInitialSchema } from "../src/db/schema.js";
import { createMissionLog, createWorkItemRecord, upsertProject } from "../src/db/repositories.js";
import type { WorkMonitorSnapshot } from "../src/workMonitoring/types.js";
import {
  composeMorningNarrative,
  gatherMorningNarrativeSnapshot,
  type MorningNarrativeSnapshot
} from "../src/orientation/morningNarrative.js";

function snapshot(overrides: Partial<MorningNarrativeSnapshot> = {}): MorningNarrativeSnapshot {
  return {
    recentLogs: [{
      project_id: "project_arcadia",
      project_name: "Arcadia",
      work_performed: "Added narrative digests.",
      result: "Morning updates now tell a coherent story.",
      blockers: null,
      next_action: "Delegate the ready scheduler Action.",
      created_at: "2026-08-02T18:00:00.000Z"
    }],
    projectStandups: [{
      projectId: "project_arcadia",
      projectName: "Arcadia",
      yesterday: ["Added narrative digests"],
      today: ["Delegate the ready scheduler Action"],
      blockers: []
    }],
    ...overrides
  };
}

describe("morning narrative", () => {
  it("leads with a portfolio summary and renders the stand-up headings for each active Project", () => {
    const narrative = composeMorningNarrative(snapshot());

    expect(narrative).toMatch(/^1 recently active Project on the docket:/);
    expect(narrative).toContain("**Arcadia**");
    expect(narrative).toContain("Yesterday: Added narrative digests.");
    expect(narrative).toContain("Today: Delegate the ready scheduler Action.");
    expect(narrative).toContain("Blockers: None recorded.");
  });

  it("names recorded blockers without inventing a diagnosis", () => {
    const narrative = composeMorningNarrative(snapshot({
      projectStandups: [{
        ...snapshot().projectStandups[0],
        blockers: ["The local model is unavailable"]
      }]
    }));

    expect(narrative).toContain("1 blocker");
    expect(narrative).toContain("Blockers: The local model is unavailable.");
  });

  it("is honest when there is no recent Log activity", () => {
    expect(composeMorningNarrative(snapshot({ recentLogs: [], projectStandups: [] }))).toContain("no active portfolio docket");
  });

  it("uses recent Log attention instead of lifecycle status and keeps yesterday on local-day boundaries", () => {
    const db = new Database(":memory:");
    applyInitialSchema(db);
    const now = new Date(2026, 7, 10, 8);
    const recent = upsertProject(db, {
      name: "Recently Touched",
      mission: "Prove recent attention wins.",
      status: "paused",
      currentMilestone: "Unused",
      nextAction: "Unused",
      workClassification: "codex"
    });
    const old = upsertProject(db, {
      name: "Lifecycle Active",
      mission: "Prove lifecycle status alone is insufficient.",
      status: "active",
      currentMilestone: "Unused",
      nextAction: "Unused",
      workClassification: "codex"
    });

    const yesterday = createMissionLog(db, {
      projectId: recent.id,
      workPerformed: "Finished the portfolio query",
      result: "The docket is now bounded.",
      blockers: "Waiting for the fixture",
      nextAction: "Verify the output",
      markdownPath: "recent-yesterday.md"
    });
    db.prepare("UPDATE mission_logs SET created_at = ?, updated_at = ? WHERE id = ?").run(
      new Date(2026, 7, 9, 12).toISOString(),
      new Date(2026, 7, 9, 12).toISOString(),
      yesterday.id
    );
    const today = createMissionLog(db, {
      projectId: recent.id,
      workPerformed: "Started verification",
      result: "The report is under test.",
      nextAction: "Ship the stand-up",
      markdownPath: "recent-today.md"
    });
    db.prepare("UPDATE mission_logs SET created_at = ?, updated_at = ? WHERE id = ?").run(
      new Date(2026, 7, 10, 7).toISOString(),
      new Date(2026, 7, 10, 7).toISOString(),
      today.id
    );
    const oldLog = createMissionLog(db, {
      projectId: old.id,
      workPerformed: "Old work",
      result: "No longer recent.",
      nextAction: "Someday",
      markdownPath: "old.md"
    });
    db.prepare("UPDATE mission_logs SET created_at = ?, updated_at = ? WHERE id = ?").run(
      new Date(2026, 7, 2, 7).toISOString(),
      new Date(2026, 7, 2, 7).toISOString(),
      oldLog.id
    );
    createWorkItemRecord(db, {
      projectId: recent.id,
      title: "Resolve the blocked Action",
      rawInput: "Resolve the blocked Action",
      queue: "blocked",
      workClassification: "blocked",
      nextAction: "Get the missing input",
      status: "blocked"
    });

    const gathered = gatherMorningNarrativeSnapshot(db, now);
    expect(gathered.projectStandups).toEqual([{
      projectId: recent.id,
      projectName: "Recently Touched",
      yesterday: ["Finished the portfolio query"],
      today: ["Ship the stand-up"],
      blockers: ["Resolve the blocked Action", "Waiting for the fixture"]
    }]);
    db.close();
  });

  it("includes current repository attention even when no recent Log exists and falls back to an open Action for today", () => {
    const db = new Database(":memory:");
    applyInitialSchema(db);
    const now = new Date(2026, 7, 11, 8);
    const current = upsertProject(db, {
      name: "Repository Attention",
      mission: "Make working-copy activity visible.",
      status: "paused",
      currentMilestone: "Unused",
      nextAction: "Unused",
      workClassification: "codex"
    });
    const stale = upsertProject(db, {
      name: "Old Branch",
      mission: "Ensure old work does not look current.",
      status: "active",
      currentMilestone: "Unused",
      nextAction: "Unused",
      workClassification: "codex"
    });
    createWorkItemRecord(db, {
      projectId: current.id,
      title: "Finish the stand-up",
      rawInput: "Finish the stand-up",
      queue: "work_queue",
      workClassification: "codex",
      nextAction: "Verify the Morning Packet",
      status: "open"
    });

    const workSnapshot = monitorSnapshot([
      workingCopy(current.id, current.name, { total: 2, lastCommitAt: null }),
      workingCopy(stale.id, stale.name, { total: 0, lastCommitAt: new Date(2026, 7, 3, 7).toISOString() })
    ]);
    const gathered = gatherMorningNarrativeSnapshot(db, now, workSnapshot);

    expect(gathered.recentLogs).toEqual([]);
    expect(gathered.projectStandups).toEqual([{
      projectId: current.id,
      projectName: "Repository Attention",
      yesterday: [],
      today: ["Verify the Morning Packet"],
      blockers: []
    }]);
    expect(composeMorningNarrative(gathered)).toContain("1 recently active Project on the docket");
    db.close();
  });
});

function monitorSnapshot(copies: Array<Record<string, unknown>>): WorkMonitorSnapshot {
  return {
    scannedAt: "2026-08-11T15:00:00.000Z",
    repositories: copies.map((copy) => ({
      projectId: copy.projectId,
      projectName: copy.projectName,
      repositoryPath: `/tmp/${String(copy.projectId)}`,
      baseRef: "main",
      workingCopies: [copy],
      error: null
    })),
    totals: {
      projects: copies.length,
      workingCopies: copies.length,
      unsaved: copies.filter((copy) => copy.preservation === "unsaved").length,
      localOnly: 0,
      pushedWithoutPr: 0,
      pullRequestUnknown: 0,
      inPr: 0,
      landed: 0,
      configurationErrors: 0
    }
  } as WorkMonitorSnapshot;
}

function workingCopy(projectId: string, projectName: string, options: { total: number; lastCommitAt: string | null }): Record<string, unknown> {
  return {
    projectId,
    projectName,
    repositoryPath: `/tmp/${projectId}`,
    worktreePath: `/tmp/${projectId}`,
    branch: "codex/test",
    detached: false,
    head: "deadbeef",
    baseRef: "main",
    upstream: null,
    aheadOfUpstream: null,
    behindUpstream: null,
    commitsNotInBase: 1,
    remoteBranchExists: true,
    changes: { total: options.total, staged: 0, unstaged: options.total, untracked: 0, paths: [], areas: [] },
    pullRequest: null,
    pullRequestLookup: "disabled",
    preservation: options.total > 0 ? "unsaved" : "pushed",
    delivery: options.total > 0 ? "working" : "needs_pr",
    summary: "Fixture work.",
    recommendedAction: null,
    lastCommitSubject: "Fixture commit",
    lastCommitAt: options.lastCommitAt
  };
}
