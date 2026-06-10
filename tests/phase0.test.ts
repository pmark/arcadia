import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withDatabase } from "../src/db/connection.js";
import {
  buildStatusReportData,
  countRows,
  createMissionLog,
  createProjectWithInitialWork,
  createWorkItemWithOptionalArtifact,
  getProject,
  listMilestonesForProject,
  listQueueGroups
} from "../src/db/repositories.js";
import { buildMissionLogRelativePath, writeMissionLogMarkdown } from "../src/markdown/missionLog.js";
import { writeStatusReport } from "../src/markdown/statusReport.js";
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
