import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { withDatabase } from "../src/db/connection.js";
import {
  buildStatusReportData,
  createMissionLog,
  createProjectWithInitialWork,
  createWorkItemWithOptionalArtifact
} from "../src/db/repositories.js";
import { buildMissionLogRelativePath, writeMissionLogMarkdown } from "../src/markdown/missionLog.js";
import { writeStatusReport } from "../src/markdown/statusReport.js";
import { createId } from "../src/utils/id.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { getWorkspacePaths } from "../src/workspace/paths.js";

const workspace = path.resolve("tmp", "demo-workspace");

rmSync(workspace, { recursive: true, force: true });
initWorkspace(workspace);

const created = withDatabase(workspace, (db) =>
  createProjectWithInitialWork(db, {
    name: "Example Project",
    mission: "Verify the Phase 0 CLI smoke path.",
    status: "active",
    currentMilestone: "Prove the core loop works",
    nextAction: "Generate a status report",
    expectedArtifact: "Smoke test report",
    workClassification: "codex"
  })
);

withDatabase(workspace, (db) =>
  createWorkItemWithOptionalArtifact(db, {
    projectId: created.project.id,
    milestoneId: created.milestone.id,
    title: "Review the generated report",
    rawInput: "Review the generated report",
    queue: "needs_mark",
    workClassification: "needs_mark",
    nextAction: "Confirm the report has the expected sections",
    expectedArtifact: "Review note"
  })
);

const logId = createId("missionLog");
const markdownPath = buildMissionLogRelativePath(workspace, created.project.name, logId);
const missionLog = withDatabase(workspace, (db) =>
  createMissionLog(db, {
    id: logId,
    projectId: created.project.id,
    milestoneId: created.milestone.id,
    workPerformed: "Ran the Phase 0 smoke test.",
    result: "Workspace, project, queue, mission log, and status report were generated.",
    blockers: "",
    nextAction: "Use the CLI manually against a private workspace.",
    artifactImpact: "Created demo status and mission log artifacts.",
    markdownPath
  })
);
writeMissionLogMarkdown(workspace, { missionLog, project: created.project, milestone: created.milestone });

const reportPath = withDatabase(workspace, (db) => writeStatusReport(workspace, buildStatusReportData(db, workspace)));
const paths = getWorkspacePaths(workspace);

const expectedFiles = [paths.configFile, paths.databaseFile, reportPath, path.join(paths.root, markdownPath)];
for (const file of expectedFiles) {
  if (!existsSync(file)) {
    throw new Error(`Smoke test expected file does not exist: ${file}`);
  }
}

console.log(`Smoke test passed: ${workspace}`);
