import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withDatabase } from "../src/db/connection.js";
import {
  buildStatusReportData,
  buildWeeklyReviewData,
  completeMilestone,
  completeWorkItem,
  countRows,
  createMilestoneForProject,
  createMissionLog,
  createProjectWithInitialWork,
  createWorkItemWithOptionalArtifact,
  createExecutionPlan,
  createExecutionRun,
  getArtifact,
  getExecutionPlan,
  getExecutionRun,
  getMilestone,
  getProject,
  getWorkItem,
  listArtifacts,
  listWorkItems,
  listMilestonesForProject,
  listQueueGroups,
  updateArtifact,
  updateMilestoneStatus,
  updateProjectStatus,
  updateWorkItem
} from "../src/db/repositories.js";
import { ensureBuiltInSkills, planStepsForWorkItem } from "../src/execution/skills.js";
import { buildMissionLogRelativePath, writeMissionLogMarkdown } from "../src/markdown/missionLog.js";
import { writeStatusReport } from "../src/markdown/statusReport.js";
import { writeWeeklyReviewReport } from "../src/markdown/weeklyReview.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { getWorkspacePaths } from "../src/workspace/paths.js";

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("Phase 0 workspace initialization", () => {
  it("creates all workspace folders, config, database, and schema", () => {
    const workspace = createTempWorkspace();
    const result = initWorkspace(workspace);
    const paths = getWorkspacePaths(workspace);

    expect(result.workspacePath).toBe(paths.root);
    expect(existsSync(paths.projects)).toBe(true);
    expect(existsSync(paths.missionLogs)).toBe(true);
    expect(existsSync(paths.artifacts)).toBe(true);
    expect(existsSync(paths.skills)).toBe(true);
    expect(existsSync(paths.prompts)).toBe(true);
    expect(existsSync(paths.config)).toBe(true);
    expect(existsSync(paths.database)).toBe(true);
    expect(existsSync(paths.reports)).toBe(true);
    expect(existsSync(paths.inbox)).toBe(true);
    expect(existsSync(paths.configFile)).toBe(true);
    expect(existsSync(paths.databaseFile)).toBe(true);

    withDatabase(workspace, (db) => {
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'projects'")
        .get() as { name: string } | undefined;
      expect(row?.name).toBe("projects");
      expect(countRows(db, "projects")).toBe(0);
    });
  });
});

describe("Phase 0 data operations", () => {
  it("stores a project, milestone, work item, and optional artifact", () => {
    const workspace = initializedWorkspace();

    const created = withDatabase(workspace, (db) =>
      createProjectWithInitialWork(db, {
        name: "Example Project",
        mission: "Demonstrate Phase 0",
        status: "active",
        currentMilestone: "Create a working CLI",
        nextAction: "Run the first smoke test",
        expectedArtifact: "Implementation summary",
        workClassification: "codex"
      })
    );

    expect(created.project.id).toMatch(/^proj_/);
    expect(created.milestone.id).toMatch(/^ms_/);
    expect(created.workItem.id).toMatch(/^work_/);
    expect(created.artifact?.id).toMatch(/^art_/);

    withDatabase(workspace, (db) => {
      expect(countRows(db, "projects")).toBe(1);
      expect(countRows(db, "milestones")).toBe(1);
      expect(countRows(db, "work_items")).toBe(1);
      expect(countRows(db, "artifacts")).toBe(1);
    });
  });

  it("stores a manually classified inbox item", () => {
    const workspace = initializedWorkspace();

    const result = withDatabase(workspace, (db) =>
      createWorkItemWithOptionalArtifact(db, {
        title: "Review a decision",
        rawInput: "Review a decision",
        queue: "needs_mark",
        workClassification: "needs_mark",
        nextAction: "Decide whether to proceed",
        expectedArtifact: "Decision note"
      })
    );

    expect(result.workItem.queue).toBe("needs_mark");
    expect(result.workItem.work_classification).toBe("needs_mark");
    expect(result.artifact?.title).toBe("Decision note");
  });

  it("groups queue items correctly", () => {
    const workspace = initializedWorkspace();

    withDatabase(workspace, (db) => {
      createWorkItemWithOptionalArtifact(db, {
        title: "Capture idea",
        rawInput: "Capture idea",
        queue: "inbox",
        workClassification: "autonomous",
        nextAction: "Clarify the idea"
      });
      createWorkItemWithOptionalArtifact(db, {
        title: "Run script",
        rawInput: "Run script",
        queue: "work_queue",
        workClassification: "autonomous",
        nextAction: "Run the local script"
      });
      createWorkItemWithOptionalArtifact(db, {
        title: "Make decision",
        rawInput: "Make decision",
        queue: "needs_mark",
        workClassification: "needs_mark",
        nextAction: "Choose an option"
      });
      createWorkItemWithOptionalArtifact(db, {
        title: "Wait on dependency",
        rawInput: "Wait on dependency",
        queue: "blocked",
        workClassification: "blocked",
        nextAction: "Wait for dependency"
      });

      const groups = listQueueGroups(db);
      expect(groups.inbox).toHaveLength(1);
      expect(groups.work_queue).toHaveLength(1);
      expect(groups.needs_mark).toHaveLength(1);
      expect(groups.blocked).toHaveLength(1);
    });
  });

  it("lists, updates, and completes work items", () => {
    const workspace = initializedWorkspace();

    withDatabase(workspace, (db) => {
      const created = createWorkItemWithOptionalArtifact(db, {
        title: "Move work forward",
        rawInput: "Move work forward",
        queue: "inbox",
        workClassification: "autonomous",
        nextAction: "Clarify the task"
      });

      expect(listWorkItems(db)).toHaveLength(1);

      const updated = updateWorkItem(db, created.workItem.id, {
        queue: "work_queue",
        workClassification: "codex",
        nextAction: "Implement the task",
        status: "in_progress"
      });

      expect(updated?.queue).toBe("work_queue");
      expect(updated?.work_classification).toBe("codex");
      expect(updated?.next_action).toBe("Implement the task");
      expect(updated?.status).toBe("in_progress");

      const completed = completeWorkItem(db, created.workItem.id);
      expect(completed?.status).toBe("done");
      expect(getWorkItem(db, created.workItem.id)?.status).toBe("done");
    });
  });

  it("returns null when updating or completing a missing work item", () => {
    const workspace = initializedWorkspace();

    withDatabase(workspace, (db) => {
      expect(updateWorkItem(db, "work_missing", { status: "in_progress" })).toBeNull();
      expect(completeWorkItem(db, "work_missing")).toBeNull();
    });
  });

  it("rejects invalid work item updates before writing", () => {
    const workspace = initializedWorkspace();

    withDatabase(workspace, (db) => {
      const created = createWorkItemWithOptionalArtifact(db, {
        title: "Keep valid state",
        rawInput: "Keep valid state",
        queue: "work_queue",
        workClassification: "codex",
        nextAction: "Stay valid"
      });

      expect(() => updateWorkItem(db, created.workItem.id, { status: "invalid_status" })).toThrow(
        "Work item status must be one of"
      );
      expect(getWorkItem(db, created.workItem.id)?.status).toBe("open");
    });
  });

  it("stores execution skills, plans, runs, and run artifacts", () => {
    const workspace = initializedWorkspace();

    withDatabase(workspace, (db) => {
      ensureBuiltInSkills(db);
      const created = createWorkItemWithOptionalArtifact(db, {
        title: "Generate status report",
        rawInput: "Generate status report",
        queue: "work_queue",
        workClassification: "autonomous",
        nextAction: "Generate the deterministic status report."
      });
      const workItem = getWorkItem(db, created.workItem.id);
      expect(workItem).not.toBeNull();

      const plan = createExecutionPlan(db, {
        workItemId: created.workItem.id,
        summary: "Plan status report generation.",
        steps: planStepsForWorkItem(workItem!)
      });

      expect(plan?.id).toMatch(/^plan_/);
      expect(plan?.steps).toHaveLength(2);
      expect(getExecutionPlan(db, plan!.id)?.steps[0].skill_name).toBe("generate_status_report");

      const run = createExecutionRun(db, {
        workItemId: created.workItem.id,
        planId: plan!.id,
        status: "completed",
        summary: "Completed deterministic execution.",
        steps: [
          {
            planStepId: plan!.steps[0].id,
            status: "completed",
            command: plan!.steps[0].command,
            output: "Status report written.",
            error: null,
            artifactPath: null
          }
        ]
      });

      expect(run?.id).toMatch(/^run_/);
      expect(getExecutionRun(db, run!.id)?.steps[0].status).toBe("completed");
      expect(countRows(db, "execution_plans")).toBe(1);
      expect(countRows(db, "execution_runs")).toBe(1);
    });
  });

  it("updates project status and creates and completes milestones", () => {
    const workspace = initializedWorkspace();

    withDatabase(workspace, (db) => {
      const created = createProjectWithInitialWork(db, {
        name: "Stateful Project",
        mission: "Exercise project lifecycle.",
        status: "active",
        currentMilestone: "Start",
        nextAction: "Move project",
        workClassification: "codex"
      });

      const updatedProject = updateProjectStatus(db, created.project.id, "paused");
      expect(updatedProject?.status).toBe("paused");
      expect(getProject(db, created.project.id)?.status).toBe("paused");

      const milestone = createMilestoneForProject(db, created.project.id, "Second milestone");
      expect(milestone?.id).toMatch(/^ms_/);
      expect(milestone?.status).toBe("active");

      const completedMilestone = completeMilestone(db, milestone?.id ?? "");
      expect(completedMilestone?.status).toBe("completed");
      expect(getMilestone(db, milestone?.id ?? "")?.status).toBe("completed");
    });
  });

  it("returns null for missing project and milestone lifecycle targets", () => {
    const workspace = initializedWorkspace();

    withDatabase(workspace, (db) => {
      expect(updateProjectStatus(db, "proj_missing", "paused")).toBeNull();
      expect(createMilestoneForProject(db, "proj_missing", "Missing project milestone")).toBeNull();
      expect(updateMilestoneStatus(db, "ms_missing", "completed")).toBeNull();
      expect(completeMilestone(db, "ms_missing")).toBeNull();
    });
  });

  it("rejects invalid project and milestone status before writing", () => {
    const workspace = initializedWorkspace();

    withDatabase(workspace, (db) => {
      const created = createProjectWithInitialWork(db, {
        name: "Validation Project",
        mission: "Keep statuses valid.",
        status: "active",
        currentMilestone: "Start",
        nextAction: "Validate statuses",
        workClassification: "codex"
      });

      expect(() => updateProjectStatus(db, created.project.id, "invalid_status")).toThrow(
        "Project status must be one of"
      );
      expect(() => updateMilestoneStatus(db, created.milestone.id, "invalid_status")).toThrow(
        "Milestone status must be one of"
      );
      expect(getProject(db, created.project.id)?.status).toBe("active");
      expect(getMilestone(db, created.milestone.id)?.status).toBe("active");
    });
  });

  it("lists and updates artifacts", () => {
    const workspace = initializedWorkspace();

    withDatabase(workspace, (db) => {
      const created = createProjectWithInitialWork(db, {
        name: "Artifact Project",
        mission: "Exercise artifact lifecycle.",
        status: "active",
        currentMilestone: "Start",
        nextAction: "Create an artifact",
        expectedArtifact: "Artifact draft",
        workClassification: "codex"
      });

      expect(listArtifacts(db)).toHaveLength(1);

      const artifactId = created.artifact?.id ?? "";
      const updated = updateArtifact(db, artifactId, {
        status: "ready",
        path: "artifacts/artifact-draft.md"
      });

      expect(updated?.status).toBe("ready");
      expect(updated?.path).toBe("artifacts/artifact-draft.md");
      expect(getArtifact(db, artifactId)?.status).toBe("ready");
    });
  });

  it("returns null for missing artifact updates", () => {
    const workspace = initializedWorkspace();

    withDatabase(workspace, (db) => {
      expect(updateArtifact(db, "art_missing", { status: "ready" })).toBeNull();
    });
  });

  it("rejects invalid artifact status before writing", () => {
    const workspace = initializedWorkspace();

    withDatabase(workspace, (db) => {
      const created = createProjectWithInitialWork(db, {
        name: "Artifact Validation Project",
        mission: "Keep artifact statuses valid.",
        status: "active",
        currentMilestone: "Start",
        nextAction: "Validate artifact",
        expectedArtifact: "Validated artifact",
        workClassification: "codex"
      });

      const artifactId = created.artifact?.id ?? "";
      expect(() => updateArtifact(db, artifactId, { status: "invalid_status" })).toThrow(
        "Artifact status must be one of"
      );
      expect(getArtifact(db, artifactId)?.status).toBe("planned");
    });
  });

  it("stores a mission log and writes Markdown", () => {
    const workspace = initializedWorkspace();
    const created = createExampleProject(workspace);
    const logId = "log_testmission000001";
    const markdownPath = buildMissionLogRelativePath(workspace, created.project.name, logId);

    const missionLog = withDatabase(workspace, (db) =>
      createMissionLog(db, {
        id: logId,
        projectId: created.project.id,
        milestoneId: created.milestone.id,
        workPerformed: "Implemented the CLI foundation.",
        result: "The database stores Phase 0 records.",
        blockers: "",
        nextAction: "Generate the status report.",
        artifactImpact: "Creates a mission log artifact.",
        markdownPath
      })
    );

    const absolutePath = writeMissionLogMarkdown(workspace, {
      missionLog,
      project: created.project,
      milestone: created.milestone
    });

    expect(existsSync(absolutePath)).toBe(true);
    expect(readFileSync(absolutePath, "utf8")).toContain("Implemented the CLI foundation.");

    withDatabase(workspace, (db) => {
      expect(countRows(db, "mission_logs")).toBe(1);
    });
  });

  it("adds a stable suffix for duplicate same-day mission log paths", () => {
    const workspace = initializedWorkspace();
    const created = createExampleProject(workspace);
    const firstPath = buildMissionLogRelativePath(workspace, created.project.name, "log_first0000000000");
    const firstLog = withDatabase(workspace, (db) =>
      createMissionLog(db, {
        id: "log_first0000000000",
        projectId: created.project.id,
        milestoneId: created.milestone.id,
        workPerformed: "First log.",
        result: "First result.",
        nextAction: "Write another log.",
        markdownPath: firstPath
      })
    );
    writeMissionLogMarkdown(workspace, { missionLog: firstLog, project: created.project, milestone: created.milestone });

    const duplicatePath = buildMissionLogRelativePath(workspace, created.project.name, "log_second000000000");
    expect(path.basename(duplicatePath)).toContain("second00");
  });

  it("writes a status report from real database rows", () => {
    const workspace = initializedWorkspace();
    createExampleProject(workspace);

    const reportPath = withDatabase(workspace, (db) => {
      const data = buildStatusReportData(db, workspace);
      return writeStatusReport(workspace, data);
    });

    expect(existsSync(reportPath)).toBe(true);
    const report = readFileSync(reportPath, "utf8");
    expect(report).toContain("Example Project");
    expect(report).toContain("Run the first smoke test");
    expect(report).toContain("Codex Work");
  });

  it("writes expanded status report sections from SQLite state", () => {
    const workspace = initializedWorkspace();
    const created = createExampleProject(workspace);

    withDatabase(workspace, (db) => {
      completeWorkItem(db, created.workItem.id);
      updateArtifact(db, created.artifact?.id ?? "", {
        status: "ready",
        path: "artifacts/implementation-summary.md"
      });
      createWorkItemWithOptionalArtifact(db, {
        title: "Blocked dependency",
        rawInput: "Blocked dependency waiting on an external decision",
        queue: "blocked",
        workClassification: "blocked",
        nextAction: "Wait for the external decision"
      });
    });

    const reportPath = withDatabase(workspace, (db) => writeStatusReport(workspace, buildStatusReportData(db, workspace)));
    const report = readFileSync(reportPath, "utf8");

    expect(report).toContain("## Work By Queue");
    expect(report).toContain("### Blocked");
    expect(report).toContain("## Work By Classification");
    expect(report).toContain("## Projects Without Open Next Action");
    expect(report).toContain("Example Project");
    expect(report).toContain("## Recently Completed Work");
    expect(report).toContain("Run the first smoke test");
    expect(report).toContain("## Artifacts By Status");
    expect(report).toContain("### Ready");
    expect(report).toContain("artifacts/implementation-summary.md");
    expect(report).toContain("Context: Blocked dependency waiting on an external decision.");
  });

  it("builds and writes a deterministic weekly review from SQLite state", () => {
    const workspace = initializedWorkspace();
    const created = createExampleProject(workspace);

    withDatabase(workspace, (db) => {
      completeWorkItem(db, created.workItem.id);
      db.prepare("UPDATE work_items SET updated_at = ? WHERE id = ?").run(
        "2026-06-07T12:00:00.000Z",
        created.workItem.id
      );
      db.prepare("UPDATE artifacts SET updated_at = ?, status = ?, path = ? WHERE id = ?").run(
        "2026-06-08T12:00:00.000Z",
        "ready",
        "artifacts/implementation-summary.md",
        created.artifact?.id
      );

      const oldWork = createWorkItemWithOptionalArtifact(db, {
        title: "Old completed work",
        rawInput: "Old completed work",
        queue: "work_queue",
        workClassification: "codex",
        nextAction: "This should stay outside the weekly review"
      });
      completeWorkItem(db, oldWork.workItem.id);
      db.prepare("UPDATE work_items SET updated_at = ? WHERE id = ?").run(
        "2026-05-01T12:00:00.000Z",
        oldWork.workItem.id
      );

      createWorkItemWithOptionalArtifact(db, {
        title: "Needs a Mark decision",
        rawInput: "Needs a Mark decision",
        queue: "needs_mark",
        workClassification: "needs_mark",
        nextAction: "Choose whether to proceed"
      });
      createWorkItemWithOptionalArtifact(db, {
        title: "Blocked dependency",
        rawInput: "Blocked dependency waiting on an external decision",
        queue: "blocked",
        workClassification: "blocked",
        nextAction: "Wait for the external decision"
      });
      createWorkItemWithOptionalArtifact(db, {
        title: "Autonomous local script",
        rawInput: "Autonomous local script",
        queue: "work_queue",
        workClassification: "autonomous",
        nextAction: "Run the local script"
      });
      createWorkItemWithOptionalArtifact(db, {
        title: "Codex implementation",
        rawInput: "Codex implementation",
        queue: "work_queue",
        workClassification: "codex",
        nextAction: "Implement the CLI slice"
      });

      const log = createMissionLog(db, {
        id: "log_weeklyreview00001",
        projectId: created.project.id,
        milestoneId: created.milestone.id,
        workPerformed: "Implemented weekly review.",
        result: "Weekly review report is generated.",
        nextAction: "Run smoke coverage.",
        artifactImpact: "Created reports/weekly/2026-06-09.md.",
        markdownPath: "mission_logs/2026/06/2026-06-07-example-project.md"
      });
      db.prepare("UPDATE mission_logs SET created_at = ?, updated_at = ? WHERE id = ?").run(
        "2026-06-07T13:00:00.000Z",
        "2026-06-07T13:00:00.000Z",
        log.id
      );
    });

    const reportPath = withDatabase(workspace, (db) => {
      const data = buildWeeklyReviewData(db, workspace, { since: "2026-06-03", until: "2026-06-09" });
      expect(data.completedWorkItems.map((item) => item.title)).toContain("Run the first smoke test");
      expect(data.completedWorkItems.map((item) => item.title)).not.toContain("Old completed work");
      expect(data.missionLogs).toHaveLength(1);
      expect(data.needsMarkItems.map((item) => item.title)).toContain("Needs a Mark decision");
      expect(data.blockedItems.map((item) => item.title)).toContain("Blocked dependency");
      expect(data.autonomousItems.map((item) => item.title)).toContain("Autonomous local script");
      expect(data.codexItems.map((item) => item.title)).toContain("Codex implementation");
      expect(data.artifactItems.map((item) => item.title)).toContain("Implementation summary");
      expect(data.projectsWithoutOpenNextActions.map((project) => project.name)).toContain("Example Project");
      expect(data.suggestedNextActions.length).toBeGreaterThan(0);
      return writeWeeklyReviewReport(workspace, data);
    });

    expect(reportPath).toBe(path.join(workspace, "reports", "weekly", "2026-06-09.md"));
    const report = readFileSync(reportPath, "utf8");
    expect(report).toContain("# Arcadia Weekly Review");
    expect(report).toContain("Review window: 2026-06-03 to 2026-06-09");
    expect(report).toContain("## Completed Work");
    expect(report).toContain("Run the first smoke test");
    expect(report).not.toContain("Old completed work");
    expect(report).toContain("## Mission Logs Created");
    expect(report).toContain("Weekly review report is generated.");
    expect(report).toContain("## Needs Mark Items");
    expect(report).toContain("## Active Codex/Autonomous Work");
    expect(report).toContain("## Artifact Changes Or Upcoming Artifacts");
    expect(report).toContain("artifacts/implementation-summary.md");
    expect(report).toContain("## Projects Without Open Next Actions");
    expect(report).toContain("## Suggested Next Actions");
  });

  it("rejects invalid enum values before writing", () => {
    const workspace = initializedWorkspace();

    expect(() =>
      withDatabase(workspace, (db) =>
        createWorkItemWithOptionalArtifact(db, {
          title: "Bad queue",
          rawInput: "Bad queue",
          queue: "not_a_queue" as never,
          workClassification: "codex",
          nextAction: "Do not store this"
        })
      )
    ).toThrow("Queue must be one of");
  });
});

function createTempWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-test-"));
  workspaces.push(workspace);
  return workspace;
}

function initializedWorkspace(): string {
  const workspace = createTempWorkspace();
  initWorkspace(workspace);
  return workspace;
}

function createExampleProject(workspace: string) {
  return withDatabase(workspace, (db) =>
    createProjectWithInitialWork(db, {
      name: "Example Project",
      mission: "Demonstrate Phase 0",
      status: "active",
      currentMilestone: "Create a working CLI",
      nextAction: "Run the first smoke test",
      expectedArtifact: "Implementation summary",
      workClassification: "codex"
    })
  );
}
