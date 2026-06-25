import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { runArtifactUpdateCommand } from "../src/commands/artifact.js";
import { runAskCommand } from "../src/commands/ask.js";
import { runCaptureCommand } from "../src/commands/capture.js";
import { runInboxImportCommand } from "../src/commands/inbox.js";
import { runMilestoneCompleteCommand, runMilestoneCreateCommand } from "../src/commands/milestone.js";
import { runProjectUpdateCommand } from "../src/commands/project.js";
import { runReviewApproveCommand, runReviewWeeklyCommand } from "../src/commands/review.js";
import { runWorkDoneCommand, runWorkPlanCommand, runWorkRunCommand, runWorkUpdateCommand } from "../src/commands/work.js";
import { runRunShowCommand } from "../src/commands/run.js";
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
  queue: "requires_review",
  classification: "requires_review",
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
const captured = runCaptureCommand({
  workspace,
  text: "Generate status report"
});
const executionPlan = runWorkPlanCommand({
  workspace,
  workId: captured.data.workItem.id
});
const executionRun = runWorkRunCommand({
  workspace,
  workId: captured.data.workItem.id,
  plan: executionPlan.data.plan.id
});
const shownRun = runRunShowCommand({
  workspace,
  runId: executionRun.data.run.id
});
if (shownRun.data.run.status !== "completed") {
  throw new Error("Smoke test expected deterministic execution run to complete.");
}

const asked = runAskCommand({
  workspace,
  request: "Prepare a weekly Martian Rover Labs update from recent mission logs.",
  runSafe: true
});
if (asked.data.resolvedIntent.intentId !== "prepare_blog_update" || asked.data.run?.status !== "completed") {
  throw new Error("Smoke test expected Phase 3 ask run-safe flow to complete.");
}

const codexAsk = runAskCommand({
  workspace,
  request: "Create a new blog site named MartianRover Field Notes."
});
if (!codexAsk.data.reviewItemId) {
  throw new Error("Smoke test expected Phase 3 ask to create a Requires Review item.");
}
const approvedCodexAsk = runReviewApproveCommand({
  workspace,
  id: codexAsk.data.reviewItemId,
  execute: false
});
if ((approvedCodexAsk.data.approval?.codexInvocations.length ?? 0) !== 1) {
  throw new Error("Smoke test expected Phase 3 ask to create a Codex packet.");
}
const paths = getWorkspacePaths(workspace);

const expectedFiles = [
  paths.configFile,
  paths.intentRegistry,
  paths.templateRegistry,
  paths.codingAgentProfiles,
  paths.databaseFile,
  reportPath,
  weeklyReview.data.reportPath,
  path.join(paths.root, executionRun.data.missionLogPath ?? ""),
  path.join(paths.root, asked.data.run?.mission_log_path ?? ""),
  path.join(paths.root, codexAsk.data.codexInvocations[0]?.prompt_path ?? ""),
  path.join(paths.root, markdownPath)
];
for (const file of expectedFiles) {
  if (!existsSync(file)) {
    throw new Error(`Smoke test expected file does not exist: ${file}`);
  }
}

console.log(`Smoke test passed: ${workspace}`);
