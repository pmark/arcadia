import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runReviewWeeklyCommand } from "../src/commands/review.js";
import { withDatabase } from "../src/db/connection.js";
import {
  buildWeeklyReviewData,
  createArtifactRecord,
  createMissionLog,
  createWorkItemWithOptionalArtifact,
  upsertProject
} from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const WINDOW = { since: "2026-06-03", until: "2026-06-09" };

/**
 * Two Projects with comparable work, plus one Action belonging to neither.
 * The unowned Action is the point: pooling hides it, and a scoped review must
 * not adopt it just because it has nowhere else to go.
 */
function twoProjectWorkspace(): { workspace: string; alphaId: string; betaId: string } {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-progress-"));
  roots.push(workspace);
  initWorkspace(workspace);

  const ids = withDatabase(workspace, (db) => {
    const alpha = upsertProject(db, {
      name: "Alpha",
      mission: "Ship Alpha.",
      status: "active",
      currentMilestone: "First",
      nextAction: "Start",
      workClassification: "codex"
    });
    const beta = upsertProject(db, {
      name: "Beta",
      mission: "Ship Beta.",
      status: "active",
      currentMilestone: "First",
      nextAction: "Start",
      workClassification: "codex"
    });

    for (const [project, label] of [
      [alpha, "Alpha"],
      [beta, "Beta"]
    ] as const) {
      const done = createWorkItemWithOptionalArtifact(db, {
        projectId: project.id,
        title: `${label} completed work`,
        rawInput: `${label} completed work`,
        queue: "work_queue",
        workClassification: "codex",
        nextAction: "Done already",
        status: "done"
      }).workItem;
      db.prepare("UPDATE work_items SET updated_at = ? WHERE id = ?").run(
        "2026-06-05T12:00:00.000Z",
        done.id
      );

      createWorkItemWithOptionalArtifact(db, {
        projectId: project.id,
        title: `${label} blocked work`,
        rawInput: `${label} blocked work`,
        queue: "blocked",
        workClassification: "blocked",
        nextAction: "Wait"
      });

      // A `planned` Artifact matches the report's status branch regardless of
      // date, which is exactly the clause a mis-parenthesized project scope
      // would let through.
      createArtifactRecord(db, {
        projectId: project.id,
        title: `${label} planned artifact`,
        artifactType: "expected_artifact",
        status: "planned"
      });

      const log = createMissionLog(db, {
        projectId: project.id,
        workPerformed: `${label} work happened.`,
        result: `${label} moved.`,
        nextAction: "Continue.",
        markdownPath: `mission_logs/${label.toLowerCase()}.md`
      });
      db.prepare("UPDATE mission_logs SET created_at = ?, updated_at = ? WHERE id = ?").run(
        "2026-06-05T12:00:00.000Z",
        "2026-06-05T12:00:00.000Z",
        log.id
      );
    }

    createWorkItemWithOptionalArtifact(db, {
      title: "Orphan work with no project",
      rawInput: "Orphan work with no project",
      queue: "blocked",
      workClassification: "blocked",
      nextAction: "Wait"
    });

    return { alphaId: alpha.id, betaId: beta.id };
  });

  return { workspace, ...ids };
}

describe("per-Project progress review", () => {
  it("pools everything when no Project is named", () => {
    const { workspace } = twoProjectWorkspace();

    const data = withDatabase(workspace, (db) => buildWeeklyReviewData(db, workspace, WINDOW));

    expect(data.project).toBeNull();
    expect(data.completedWorkItems.map((item) => item.title).sort()).toEqual([
      "Alpha completed work",
      "Beta completed work"
    ]);
    expect(data.missionLogs).toHaveLength(2);
    expect(data.blockedItems.map((item) => item.title)).toContain("Orphan work with no project");
  });

  it("narrows every section to the named Project", () => {
    const { workspace, alphaId } = twoProjectWorkspace();

    const data = withDatabase(workspace, (db) => buildWeeklyReviewData(db, workspace, WINDOW, alphaId));

    expect(data.project).toMatchObject({ name: "Alpha", slug: "alpha" });
    expect(data.completedWorkItems.map((item) => item.title)).toEqual(["Alpha completed work"]);
    expect(data.missionLogs).toHaveLength(1);
    expect(data.missionLogs[0].work_performed).toContain("Alpha");
    expect(data.blockedItems.map((item) => item.title)).toEqual(["Alpha blocked work"]);
  });

  it("keeps another Project's planned Artifacts out of a scoped report", () => {
    const { workspace, alphaId } = twoProjectWorkspace();

    const data = withDatabase(workspace, (db) => buildWeeklyReviewData(db, workspace, WINDOW, alphaId));

    const titles = data.artifactItems.map((artifact) => artifact.title);
    expect(titles).toContain("Alpha planned artifact");
    expect(titles).not.toContain("Beta planned artifact");
  });

  it("never adopts work that belongs to no Project", () => {
    const { workspace, alphaId } = twoProjectWorkspace();

    const data = withDatabase(workspace, (db) => buildWeeklyReviewData(db, workspace, WINDOW, alphaId));

    expect(data.blockedItems.map((item) => item.title)).not.toContain("Orphan work with no project");
  });

  it("drops the portfolio-level section, which says nothing about one Project", () => {
    const { workspace, alphaId } = twoProjectWorkspace();

    const data = withDatabase(workspace, (db) => buildWeeklyReviewData(db, workspace, WINDOW, alphaId));

    expect(data.projectsWithoutOpenNextActions).toEqual([]);
  });

  it("writes a scoped report beside the workspace one instead of over it", () => {
    const { workspace } = twoProjectWorkspace();

    const pooled = runReviewWeeklyCommand({ workspace, ...WINDOW });
    const scoped = runReviewWeeklyCommand({ workspace, ...WINDOW, project: "alpha" });

    expect(pooled.data.reportPath).toBe(path.join(workspace, "reports", "weekly", "2026-06-09.md"));
    expect(scoped.data.reportPath).toBe(
      path.join(workspace, "reports", "weekly", "alpha", "2026-06-09.md")
    );

    const scopedReport = readFileSync(scoped.data.reportPath, "utf8");
    expect(scopedReport).toContain("# Alpha Progress Review");
    expect(scopedReport).toContain("Project: Alpha (alpha)");
    expect(scopedReport).not.toContain("Beta");

    // The pooled report must survive a scoped run for the same date.
    expect(readFileSync(pooled.data.reportPath, "utf8")).toContain("Beta");
  });

  it("names an unknown Project instead of reporting an empty week", () => {
    const { workspace } = twoProjectWorkspace();

    expect(() => runReviewWeeklyCommand({ workspace, ...WINDOW, project: "ghost" })).toThrow(
      /not found/i
    );
  });
});
