import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { runArtifactUpdateCommand } from "../src/commands/artifact.js";
import { runInboxImportCommand } from "../src/commands/inbox.js";
import { runMilestoneCompleteCommand, runMilestoneCreateCommand } from "../src/commands/milestone.js";
import { runProjectUpdateCommand } from "../src/commands/project.js";
import { runReviewWeeklyCommand } from "../src/commands/review.js";
import { runWorkDoneCommand, runWorkUpdateCommand } from "../src/commands/work.js";
import { withDatabase } from "../src/db/connection.js";
import {
  buildStatusReportData,
  createMissionLog,
  createProjectWithInitialWork
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

const projectUpdate = runProjectUpdateCommand({
  workspace,
  projectId: created.project.id,
  status: "paused"
});

if (projectUpdate.data.project.status !== "paused") {
  throw new Error("Smoke test expected project status to be updated.");
}

const nextMilestone = runMilestoneCreateCommand({
  workspace,
  projectId: created.project.id,
  title: "Review lifecycle commands"
});

const completedMilestone = runMilestoneCompleteCommand({
  workspace,
  milestoneId: nextMilestone.data.milestone.id
});

if (completedMilestone.data.milestone.status !== "completed") {
  throw new Error("Smoke test expected milestone to be completed.");
}

if (!created.artifact) {
  throw new Error("Smoke test expected initial project artifact.");
}

const updatedArtifact = runArtifactUpdateCommand({
  workspace,
  artifactId: created.artifact.id,
  status: "ready",
  path: "artifacts/smoke-test-report.md"
});

if (updatedArtifact.data.artifact.status !== "ready" || updatedArtifact.data.artifact.path !== "artifacts/smoke-test-report.md") {
  throw new Error("Smoke test expected artifact to be updated.");
}

const imported = runInboxImportCommand({
  workspace,
  project: created.project.id,
  milestone: created.milestone.id,
  title: "Review the generated report",
  input: "Review the generated report",
  queue: "needs_mark",
  classification: "needs_mark",
  nextAction: "Confirm the report has the expected sections",
  expectedArtifact: "Review note"
});

const updated = runWorkUpdateCommand({
  workspace,
  workId: imported.data.workItem.id,
  queue: "work_queue",
  classification: "codex",
  nextAction: "Implement the report review follow-up",
  status: "in_progress"
});

if (updated.data.workItem.status !== "in_progress" || updated.data.workItem.queue !== "work_queue") {
  throw new Error("Smoke test expected imported work item to be updated.");
}

const completed = runWorkDoneCommand({
  workspace,
  workId: imported.data.workItem.id
});

if (completed.data.workItem.status !== "done") {
  throw new Error("Smoke test expected imported work item to be completed.");
}

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
const weeklyReview = runReviewWeeklyCommand({ workspace });
const paths = getWorkspacePaths(workspace);

const expectedFiles = [
  paths.configFile,
  paths.databaseFile,
  reportPath,
  weeklyReview.data.reportPath,
  path.join(paths.root, markdownPath)
];
for (const file of expectedFiles) {
  if (!existsSync(file)) {
    throw new Error(`Smoke test expected file does not exist: ${file}`);
  }
}

console.log(`Smoke test passed: ${workspace}`);
