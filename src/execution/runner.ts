import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import type Database from "better-sqlite3";
import {
  attachMissionLogToExecutionRun,
  buildStatusReportData,
  buildWeeklyReviewData,
  createArtifactRecord,
  createExecutionRun,
  createMissionLog,
  createReviewItem,
  getCodexInvocationForPlan,
  getExecutionPlan,
  getMilestone,
  getProject,
  getWorkItem,
  updateCodexInvocationStatus,
  updateWorkItem
} from "../db/repositories.js";
import { isRequiresReviewValue, type CodexInvocationPurpose } from "../domain/constants.js";
import type {
  Artifact,
  CodexInvocation,
  ExecutionPlanSummary,
  ExecutionRunSummary,
  ExecutionRunStep,
  WorkItemSummary
} from "../domain/types.js";
import type { CodingAgentProfile } from "../intent/registries.js";
import { writeMissionLogMarkdown, buildMissionLogRelativePath } from "../markdown/missionLog.js";
import { renderRunSummary, writePublicationPacket, writeSpecificationArtifact } from "../markdown/executionArtifacts.js";
import { writeStatusReport } from "../markdown/statusReport.js";
import { writeWeeklyReviewReport } from "../markdown/weeklyReview.js";
import {
  validatePlanningArtifact,
  type PlanningArtifactValidationIssue,
  type PlanningArtifactValidationResult
} from "../stewardship/artifactValidator.js";
import { createId } from "../utils/id.js";
import { localDateStamp } from "../utils/time.js";
import { getWorkspacePaths, toWorkspaceRelativePath } from "../workspace/paths.js";

export interface ExecutionResult {
  run: ExecutionRunSummary;
  missionLogPath: string | null;
}

export interface ExecutePlanOptions {
  allowCodexPlanning?: boolean;
  allowCodexBuild?: boolean;
  agentProfile?: string;
  codingAgentProfiles?: CodingAgentProfile[];
}

type RunStepInput = Parameters<typeof createExecutionRun>[1]["steps"][number];
type CodexStepStatus = "completed" | "requires_review" | "failed";

interface ExecutedCodexStep {
  invocationId: string;
  status: CodexStepStatus;
  command: string;
  output: string | null;
  error: string | null;
  artifactPath: string | null;
  artifact: Artifact | null;
}

interface PlanningValidationSidecar {
  validator: "deterministic_planning_artifact_validator";
  artifactKind: "planning_artifact";
  status: "passed" | "failed" | "not_run";
  summary: string;
  packetPath: string;
  artifactPath: string;
  validation: PlanningArtifactValidationResult | null;
}

interface PlanningValidationOutcome {
  status: "passed" | "failed" | "not_run";
  summary: string;
  validation: PlanningArtifactValidationResult | null;
  sidecarRelativePath: string;
  artifact: Artifact;
}

export function executePlan(
  db: Database.Database,
  workspace: string,
  plan: ExecutionPlanSummary,
  options: ExecutePlanOptions = {}
): ExecutionResult {
  const workItem = getWorkItem(db, plan.work_item_id);
  if (!workItem) {
    throw new Error(`Work item is required: ${plan.work_item_id}`);
  }

  const stepResults: RunStepInput[] = [];
  const artifacts: Artifact[] = [];
  const completedCodexInvocationIds: string[] = [];
  let runStatus: "completed" | "requires_review" | "failed" = "completed";

  for (const step of plan.steps) {
    if (step.executor_type === "codex_planning" || step.executor_type === "codex_build") {
      const allowed = step.executor_type === "codex_planning" ? options.allowCodexPlanning : options.allowCodexBuild;
      if (!allowed) {
        stepResults.push({
          planStepId: step.id,
          status: "requires_review",
          command: step.command,
          output: step.needs_mark ?? "This Codex step requires explicit approval.",
          error: step.needs_mark ?? "Execution paused for explicit Codex approval.",
          artifactPath: null
        });
        runStatus = "requires_review";
        break;
      }

      try {
        const executed = executeCodexStep(db, workspace, workItem, plan, step.id, step.executor_type, options);
        if (executed.artifact) {
          artifacts.push(executed.artifact);
        }
        stepResults.push({
          planStepId: step.id,
          status: executed.status,
          command: executed.command,
          output: executed.output,
          error: executed.error,
          artifactPath: executed.artifactPath
        });
        completedCodexInvocationIds.push(executed.invocationId);
        if (executed.status === "completed") {
          continue;
        }
        runStatus = executed.status;
        break;
      } catch (error) {
        stepResults.push({
          planStepId: step.id,
          status: "failed",
          command: step.command,
          output: null,
          error: error instanceof Error ? error.message : String(error),
          artifactPath: null
        });
        runStatus = "failed";
        break;
      }
    }

    if (step.executor_type !== "deterministic" || step.safe_to_run !== 1) {
      stepResults.push({
        planStepId: step.id,
        status: "requires_review",
        command: step.command,
        output: step.needs_mark ?? "This step requires review or Codex.",
        error: step.needs_mark ?? "Execution paused for explicit input.",
        artifactPath: null
      });
      runStatus = "requires_review";
      break;
    }

    try {
      const executed = executeDeterministicStep(db, workspace, workItem, step.skill_name);
      if (executed.artifact) {
        artifacts.push(executed.artifact);
      }
      stepResults.push({
        planStepId: step.id,
        status: "completed",
        command: step.command,
        output: executed.output,
        error: null,
        artifactPath: executed.artifact?.path ?? null
      });
    } catch (error) {
      stepResults.push({
        planStepId: step.id,
        status: "failed",
        command: step.command,
        output: null,
        error: error instanceof Error ? error.message : String(error),
        artifactPath: null
      });
      runStatus = "failed";
      break;
    }
  }

  const run = createExecutionRun(db, {
    workItemId: workItem.id,
    planId: plan.id,
    status: runStatus,
    summary: summaryForRunStatus(runStatus, workItem),
    steps: stepResults,
    artifactIds: artifacts.map((artifact) => artifact.id)
  });

  if (!run) {
    throw new Error("Execution run could not be created.");
  }

  for (const invocationId of completedCodexInvocationIds) {
    db.prepare("UPDATE codex_invocations SET run_id = ?, updated_at = ? WHERE id = ?").run(
      run.id,
      new Date().toISOString(),
      invocationId
    );
  }

  const missionLog = createRunMissionLog(db, workspace, workItem, run, runStatus, artifacts);
  const updatedRun = attachMissionLogToExecutionRun(db, run.id, missionLog.id);

  if (runStatus === "completed") {
    updateWorkItem(db, workItem.id, { status: "done" });
  } else if (runStatus === "requires_review") {
    updateWorkItem(db, workItem.id, {
      queue: "requires_review",
      workClassification: "requires_review",
      nextAction: "Review the execution run and provide the required input."
    });
  } else {
    updateWorkItem(db, workItem.id, {
      queue: "blocked",
      workClassification: "blocked",
      status: "blocked",
      nextAction: "Review the failed execution run."
    });
  }

  return {
    run: updatedRun ?? run,
    missionLogPath: missionLog.markdown_path
  };
}

function executeCodexStep(
  db: Database.Database,
  workspace: string,
  workItem: WorkItemSummary,
  plan: ExecutionPlanSummary,
  planStepId: string,
  executorType: "codex_planning" | "codex_build",
  options: ExecutePlanOptions
): ExecutedCodexStep {
  const purpose: CodexInvocationPurpose = executorType === "codex_build" ? "build" : "planning";
  const profile = selectExecutionProfile(options, purpose);
  if (profile.sandbox === "danger-full-access") {
    throw new Error("Arcadia-managed Codex execution refuses danger-full-access profiles.");
  }

  const invocation = getCodexInvocationForPlan(db, {
    workItemId: workItem.id,
    planId: plan.id,
    purpose
  });
  if (!invocation) {
    throw new Error("Codex invocation packet is required before execution.");
  }

  const promptPath = path.join(workspace, invocation.prompt_path);
  const jsonlOutputPath = path.join(workspace, invocation.jsonl_output_path);
  const finalMessagePath = path.join(workspace, invocation.final_message_path);
  const args = argsForProfile(profile, workspace, finalMessagePath);
  const command = [profile.command, ...args].join(" ");

  if (!existsSync(promptPath)) {
    updateCodexInvocationStatus(db, invocation.id, "failed");
    const summary = `Planning artifact validation not run: packet file is missing: ${invocation.prompt_path}`;
    if (purpose === "planning") {
      const validation = recordPlanningArtifactValidationNotRun(db, workspace, workItem, invocation, summary);
      return {
        invocationId: invocation.id,
        status: "failed",
        command,
        output: validation.summary,
        error: validation.summary,
        artifactPath: validation.sidecarRelativePath,
        artifact: validation.artifact
      };
    }
    throw new Error(`Codex invocation packet file is missing: ${invocation.prompt_path}`);
  }

  const prompt = readFileSync(promptPath, "utf8");

  updateCodexInvocationStatus(db, invocation.id, "running");
  const result = spawnSync(profile.command, args, {
    cwd: workspace,
    input: prompt,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024
  });

  writeFileSync(jsonlOutputPath, result.stdout ?? "", "utf8");
  if (shouldOverwriteFinalMessage(finalMessagePath)) {
    writeFileSync(finalMessagePath, result.stdout || result.stderr || "Codex execution produced no output.\n", "utf8");
  }

  if (result.error || result.status !== 0) {
    updateCodexInvocationStatus(db, invocation.id, "failed");
    throw new Error(result.error?.message ?? result.stderr ?? `Codex command failed with status ${result.status}`);
  }

  let validationOutput: string | null = null;
  let validationArtifact: Artifact | null = null;
  let status: CodexStepStatus = "completed";
  let error: string | null = null;

  if (purpose === "planning") {
    const validation = recordPlanningArtifactValidation(db, workspace, workItem, plan, invocation);
    validationOutput = validation.summary;
    validationArtifact = validation.artifact;
    if (validation.status === "failed") {
      status = "requires_review";
      error = validation.summary;
    }
  }

  updateCodexInvocationStatus(db, invocation.id, "completed");
  db.prepare("UPDATE codex_invocations SET plan_step_id = ?, updated_at = ? WHERE id = ?").run(
    planStepId,
    new Date().toISOString(),
    invocation.id
  );

  return {
    invocationId: invocation.id,
    status,
    command,
    output: [
      `Codex ${purpose} output captured: ${invocation.jsonl_output_path}`,
      validationOutput
    ].filter(Boolean).join("\n"),
    error,
    artifactPath: invocation.final_message_path,
    artifact: validationArtifact
  };
}

function recordPlanningArtifactValidation(
  db: Database.Database,
  workspace: string,
  workItem: WorkItemSummary,
  plan: ExecutionPlanSummary,
  invocation: CodexInvocation
): PlanningValidationOutcome {
  const packetPath = path.join(workspace, invocation.prompt_path);
  const artifactPath = path.join(workspace, invocation.final_message_path);

  if (!existsSync(packetPath)) {
    return recordPlanningArtifactValidationNotRun(
      db,
      workspace,
      workItem,
      invocation,
      `Planning artifact validation not run: packet file is missing: ${invocation.prompt_path}`
    );
  }

  if (!existsSync(artifactPath)) {
    return recordPlanningArtifactValidationNotRun(
      db,
      workspace,
      workItem,
      invocation,
      `Planning artifact validation not run: artifact file is missing: ${invocation.final_message_path}`
    );
  }

  const validation = validatePlanningArtifact({
    packetText: readFileSync(packetPath, "utf8"),
    artifactText: readFileSync(artifactPath, "utf8")
  });
  const status = validation.passed ? "passed" : "failed";
  const summary = summarizePlanningValidation(status, validation);
  const sidecar = writePlanningValidationSidecar(workspace, invocation, {
    validator: "deterministic_planning_artifact_validator",
    artifactKind: "planning_artifact",
    status,
    summary,
    packetPath: invocation.prompt_path,
    artifactPath: invocation.final_message_path,
    validation
  });
  const artifact = createPlanningValidationArtifact(db, workItem, sidecar, status);

  if (!validation.passed) {
    createPlanningValidationReviewItem(db, workItem, plan, invocation, validation, summary, sidecar);
  }

  return { status, summary, validation, sidecarRelativePath: sidecar, artifact };
}

function recordPlanningArtifactValidationNotRun(
  db: Database.Database,
  workspace: string,
  workItem: WorkItemSummary,
  invocation: CodexInvocation,
  summary: string
): PlanningValidationOutcome {
  const sidecar = writePlanningValidationSidecar(workspace, invocation, {
    validator: "deterministic_planning_artifact_validator",
    artifactKind: "planning_artifact",
    status: "not_run",
    summary,
    packetPath: invocation.prompt_path,
    artifactPath: invocation.final_message_path,
    validation: null
  });
  const artifact = createPlanningValidationArtifact(db, workItem, sidecar, "not_run");
  return { status: "not_run", summary, validation: null, sidecarRelativePath: sidecar, artifact };
}

function writePlanningValidationSidecar(
  workspace: string,
  invocation: CodexInvocation,
  sidecar: PlanningValidationSidecar
): string {
  const relativePath = path.join(path.dirname(invocation.final_message_path), "planning-validation.json");
  const absolutePath = path.join(workspace, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(sidecar, null, 2)}\n`, "utf8");
  return toWorkspaceRelativePath(workspace, absolutePath);
}

function createPlanningValidationArtifact(
  db: Database.Database,
  workItem: WorkItemSummary,
  sidecarRelativePath: string,
  status: PlanningValidationOutcome["status"]
): Artifact {
  return createArtifactRecord(db, {
    projectId: workItem.project_id,
    workItemId: workItem.id,
    title: `Planning artifact validation: ${workItem.title}`,
    artifactType: "planning_artifact_validation",
    status: status === "passed" ? "ready" : "drafted",
    path: sidecarRelativePath
  });
}

function createPlanningValidationReviewItem(
  db: Database.Database,
  workItem: WorkItemSummary,
  plan: ExecutionPlanSummary,
  invocation: CodexInvocation,
  validation: PlanningArtifactValidationResult,
  summary: string,
  sidecarRelativePath: string
): void {
  createReviewItem(db, {
    workItemId: workItem.id,
    planId: plan.id,
    projectId: workItem.project_id,
    decisionNeeded: [
      `Planning artifact validation failed for "${workItem.title}".`,
      renderIssuesForOperator("Failures", validation.failures),
      renderIssuesForOperator("Warnings", validation.warnings)
    ].filter(Boolean).join("\n"),
    recommendation: [
      summary,
      `Review ${invocation.final_message_path} against ${invocation.prompt_path}.`,
      `Validation result: ${sidecarRelativePath}`
    ].join("\n"),
    sourceInput: workItem.raw_input,
    proposedAction: "Revise the Codex planning artifact before treating it as ready for operator review.",
    resolvedIntent: "codex_planning_artifact_validation",
    confidenceLabel: "high",
    confidence: 1,
    missingFields: validation.failures.map((failure) => failure.code),
    context: {
      codexInvocationId: invocation.id,
      packetPath: invocation.prompt_path,
      artifactPath: invocation.final_message_path,
      validationResultPath: sidecarRelativePath,
      validation
    }
  });
}

function summarizePlanningValidation(
  status: "passed" | "failed",
  validation: PlanningArtifactValidationResult
): string {
  const base = `Planning artifact validation ${status === "passed" ? "passed" : "failed"}: score ${validation.score}, ${validation.failures.length} failures, ${validation.warnings.length} warnings.`;
  const failures = validation.failures.length > 0 ? ` Failures: ${inlineIssueSummary(validation.failures)}.` : "";
  const warnings = validation.warnings.length > 0 ? ` Warnings: ${inlineIssueSummary(validation.warnings)}.` : "";
  return `${base}${failures}${warnings}`;
}

function inlineIssueSummary(issues: PlanningArtifactValidationIssue[]): string {
  return issues.map((issue) => `${issue.code}: ${issue.message}`).join("; ");
}

function renderIssuesForOperator(label: string, issues: PlanningArtifactValidationIssue[]): string {
  if (issues.length === 0) {
    return `${label}: none.`;
  }

  return [
    `${label}:`,
    ...issues.map((issue) => `- ${issue.code}: ${issue.message}`)
  ].join("\n");
}

function selectExecutionProfile(options: ExecutePlanOptions, purpose: CodexInvocationPurpose): CodingAgentProfile {
  const profiles = options.codingAgentProfiles ?? [];
  const profile = options.agentProfile
    ? profiles.find((candidate) => candidate.name === options.agentProfile)
    : profiles.find((candidate) => candidate.purpose === purpose);

  if (!profile) {
    throw new Error(`Coding agent profile is required for Codex ${purpose}.`);
  }

  if (profile.purpose !== purpose) {
    throw new Error(`Coding agent profile ${profile.name} is not configured for Codex ${purpose}.`);
  }

  return profile;
}

function argsForProfile(profile: CodingAgentProfile, workspace: string, finalMessagePath: string): string[] {
  if (profile.provider !== "codex-cli") {
    return profile.args;
  }

  return [...profile.args, "--cd", workspace, "--output-last-message", finalMessagePath, "-"];
}

function shouldOverwriteFinalMessage(finalMessagePath: string): boolean {
  if (!existsSync(finalMessagePath)) {
    return true;
  }

  if (statSync(finalMessagePath).size === 0) {
    return true;
  }

  return readFileSync(finalMessagePath, "utf8").trim() === "Codex has not been invoked yet.";
}

export function resolvePlanForRun(
  db: Database.Database,
  workItemId: string,
  planId: string | undefined
): ExecutionPlanSummary | null {
  if (planId) {
    const plan = getExecutionPlan(db, planId);
    return plan?.work_item_id === workItemId ? plan : null;
  }

  const row = db
    .prepare("SELECT id FROM execution_plans WHERE work_item_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(workItemId) as { id: string } | undefined;

  return row ? getExecutionPlan(db, row.id) : null;
}

function executeDeterministicStep(
  db: Database.Database,
  workspace: string,
  workItem: WorkItemSummary,
  skillName: string
): { output: string; artifact: Artifact | null } {
  switch (skillName) {
    case "validate_workspace_repository":
      return { output: validateWorkspace(workspace), artifact: null };
    case "generate_status_report": {
      const reportPath = writeStatusReport(workspace, buildStatusReportData(db, workspace));
      return { output: `Status report written: ${reportPath}`, artifact: null };
    }
    case "generate_weekly_review": {
      const until = localDateStamp();
      const since = localDateStamp(addDays(new Date(), -6));
      const reportPath = writeWeeklyReviewReport(workspace, buildWeeklyReviewData(db, workspace, { since, until }));
      return { output: `Weekly review written: ${reportPath}`, artifact: null };
    }
    case "prepare_publication_packet": {
      const absolutePath = writePublicationPacket(workspace, workItem);
      const artifact = createArtifactRecord(db, {
        projectId: workItem.project_id,
        workItemId: workItem.id,
        title: `Publication packet: ${workItem.title}`,
        artifactType: "publication_packet",
        status: "drafted",
        path: toWorkspaceRelativePath(workspace, absolutePath)
      });
      return { output: `Publication packet written: ${absolutePath}`, artifact };
    }
    case "prepare_weekly_update_draft": {
      const until = localDateStamp();
      const since = localDateStamp(addDays(new Date(), -6));
      const absolutePath = writeWeeklyReviewReport(workspace, buildWeeklyReviewData(db, workspace, { since, until }));
      const artifact = createArtifactRecord(db, {
        projectId: workItem.project_id,
        workItemId: workItem.id,
        title: `Weekly update draft: ${workItem.title}`,
        artifactType: "weekly_update_draft",
        status: "drafted",
        path: toWorkspaceRelativePath(workspace, absolutePath)
      });
      return { output: `Weekly update draft written: ${absolutePath}`, artifact };
    }
    case "generate_specification_artifact": {
      const absolutePath = writeSpecificationArtifact(workspace, workItem);
      const artifact = createArtifactRecord(db, {
        projectId: workItem.project_id,
        workItemId: workItem.id,
        title: `Specification: ${workItem.title}`,
        artifactType: "specification",
        status: "drafted",
        path: toWorkspaceRelativePath(workspace, absolutePath)
      });
      return { output: `Specification written: ${absolutePath}`, artifact };
    }
    case "create_mission_log_from_run":
      return { output: "Mission log will be written from the final run outcome.", artifact: null };
    default:
      throw new Error(`Unsupported deterministic skill: ${skillName}`);
  }
}

function createRunMissionLog(
  db: Database.Database,
  workspace: string,
  workItem: WorkItemSummary,
  run: ExecutionRunSummary,
  runStatus: "completed" | "requires_review" | "failed",
  artifacts: Artifact[]
) {
  const project = workItem.project_id ? getProject(db, workItem.project_id) : null;
  const milestone = workItem.milestone_id ? getMilestone(db, workItem.milestone_id) : null;
  const logId = createId("missionLog");
  const markdownPath = buildMissionLogRelativePath(workspace, project?.name ?? "execution", logId);
  const missionLog = createMissionLog(db, {
    id: logId,
    projectId: workItem.project_id,
    milestoneId: workItem.milestone_id,
    workPerformed: renderRunSummary(run),
    result: summaryForRunStatus(runStatus, workItem),
    blockers: runStatus === "completed" ? "" : "Execution requires review before it can continue.",
    nextAction: nextActionForRunStatus(runStatus),
    artifactImpact: artifacts.length > 0
      ? artifacts.map((artifact) => artifact.path ?? artifact.title).join(", ")
      : "Execution run recorded.",
    markdownPath
  });
  writeMissionLogMarkdown(workspace, { missionLog, project, milestone });
  return missionLog;
}

function validateWorkspace(workspace: string): string {
  const paths = getWorkspacePaths(workspace);
  const requiredPaths = [paths.configFile, paths.databaseFile, paths.projects, paths.artifacts, paths.missionLogs];
  const missing = requiredPaths.filter((requiredPath) => !existsSync(requiredPath));

  if (missing.length > 0) {
    throw new Error(`Workspace validation failed. Missing: ${missing.join(", ")}`);
  }

  return "Workspace validation passed.";
}

function summaryForRunStatus(status: "completed" | "requires_review" | "failed", workItem: WorkItemSummary): string {
  if (status === "completed") {
    return `Completed deterministic execution for "${workItem.title}".`;
  }

  if (isRequiresReviewValue(status)) {
    return `Paused execution for "${workItem.title}" because review input is required.`;
  }

  return `Execution failed for "${workItem.title}".`;
}

function nextActionForRunStatus(status: "completed" | "requires_review" | "failed"): string {
  if (status === "completed") {
    return "Review the generated run record and artifacts.";
  }

  if (isRequiresReviewValue(status)) {
    return "Review the run and provide the required input.";
  }

  return "Inspect the failed run record and decide whether to retry or revise the work item.";
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}
