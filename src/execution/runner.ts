import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import type Database from "better-sqlite3";
import {
  buildCodingAgentCommand,
  codingAgentLabel,
  finalMessageFromExecution,
  isUninvokedFinalMessage
} from "../codingAgents/adapters.js";
import {
  attachMissionLogToExecutionRun,
  attachArtifactToExecutionRun,
  buildStatusReportData,
  buildWeeklyReviewData,
  createArtifactRecord,
  createExecutionRun,
  createMissionLog,
  createReviewItem,
  getCodexInvocationForPlan,
  getCodexInvocation,
  getExecutionPlan,
  getExecutionRun,
  getMilestone,
  getProject,
  getProjectMetadata,
  getWorkItem,
  updateExecutionRunStatus,
  updateExecutionRunStep,
  upsertProducedArtifact,
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
import { CODEX_REPO_PATH_REQUIRED_MESSAGE } from "../projects/setup.js";
import {
  validatePlanningArtifact,
  type PlanningArtifactValidationIssue,
  type PlanningArtifactValidationResult
} from "../stewardship/artifactValidator.js";
import { createId } from "../utils/id.js";
import { localDateStamp } from "../utils/time.js";
import { getWorkspacePaths, toWorkspaceRelativePath } from "../workspace/paths.js";
import { authorizePlanningRunFromRepository } from "./planningAuthorization.js";

export interface ExecutionResult {
  run: ExecutionRunSummary;
  missionLogPath: string | null;
}

export interface ExecutePlanOptions {
  allowCodexPlanning?: boolean;
  allowCodexBuild?: boolean;
  agentProfile?: string;
  codingAgentProfiles?: CodingAgentProfile[];
  runId?: string;
  decisionId?: string;
  invocationId?: string;
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
  additionalArtifacts: Artifact[];
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
    throw new Error(`Action is required: ${plan.work_item_id}`);
  }
  const protectedPlanning = plan.steps.some((step) => step.executor_type === "codex_planning");
  if (protectedPlanning && (!options.runId || !options.decisionId || !options.invocationId)) {
    throw new Error("Planning execution requires an approved Decision for this Action, plan, and packet.");
  }
  const existingRun = options.runId ? getExecutionRun(db, options.runId) : null;
  if (options.runId && (!existingRun || existingRun.plan_id !== plan.id || existingRun.work_item_id !== workItem.id)) {
    throw new Error("Queued planning Run does not match the Action and plan.");
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
          output: step.needs_operator ?? "This Codex step requires explicit approval.",
          error: step.needs_operator ?? "Execution paused for explicit Codex approval.",
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
        artifacts.push(...executed.additionalArtifacts);
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
        output: step.needs_operator ?? "This step requires review or Codex.",
        error: step.needs_operator ?? "Execution paused for explicit input.",
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

  const run = existingRun ?? createExecutionRun(db, {
      workItemId: workItem.id,
      planId: plan.id,
      status: runStatus,
      summary: summaryForRunStatus(runStatus, workItem),
      steps: stepResults,
      artifactIds: artifacts.map((artifact) => artifact.id)
    });

  if (!run) {
    throw new Error("Run could not be created.");
  }

  if (existingRun) {
    for (const step of stepResults) {
      updateExecutionRunStep(db, existingRun.id, step.planStepId, step);
    }
    for (const artifact of artifacts) {
      attachArtifactToExecutionRun(db, existingRun.id, artifact.id);
    }
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
  if (existingRun) {
    updateExecutionRunStatus(db, run.id, runStatus, {
      pid: null,
      summary: summaryForRunStatus(runStatus, workItem)
    });
    db.prepare("UPDATE execution_plans SET status = ?, updated_at = ? WHERE id = ?")
      .run(runStatus, new Date().toISOString(), plan.id);
  }

  if (runStatus === "completed") {
    if (protectedPlanning) {
      updateWorkItem(db, workItem.id, {
        queue: "requires_review",
        workClassification: "requires_review",
        status: "in_progress",
        nextAction: "Review Validation and accept or reject the final planning Artifact."
      });
    } else {
      updateWorkItem(db, workItem.id, { status: "done" });
    }
  } else if (runStatus === "requires_review") {
    updateWorkItem(db, workItem.id, {
      queue: "requires_review",
      workClassification: "requires_review",
      nextAction: "Review the failed Validation and request a revised planning Run."
    });
  } else {
    updateWorkItem(db, workItem.id, {
      queue: "blocked",
      workClassification: "blocked",
      status: "blocked",
      nextAction: "Review the failed run."
    });
  }

  return {
    run: getExecutionRun(db, run.id) ?? updatedRun ?? run,
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
  const invocation = options.invocationId
    ? getCodexInvocation(db, options.invocationId)
    : getCodexInvocationForPlan(db, {
        workItemId: workItem.id,
        planId: plan.id,
        purpose
      });
  if (!invocation) {
    throw new Error("Codex invocation packet is required before execution.");
  }
  if (options.agentProfile && options.agentProfile !== invocation.agent_profile) {
    throw new Error(`Coding agent profile ${options.agentProfile} does not match packet profile ${invocation.agent_profile}.`);
  }
  const profile = selectExecutionProfile({
    ...options,
    agentProfile: invocation.agent_profile
  }, purpose);
  if (profile.sandbox === "danger-full-access") {
    throw new Error("Arcadia-managed coding-agent execution refuses danger-full-access profiles.");
  }

  const promptPath = path.join(workspace, invocation.prompt_path);
  const jsonlOutputPath = path.join(workspace, invocation.jsonl_output_path);
  const finalMessagePath = path.join(workspace, invocation.final_message_path);
  const projectRepositoryPath = workItem.project_id ? getProjectMetadata(db, workItem.project_id)?.repo_path : null;
  if (workItem.project_id && !projectRepositoryPath) {
    const message = CODEX_REPO_PATH_REQUIRED_MESSAGE;
    updateCodexInvocationStatus(db, invocation.id, "failed");
    createReviewItem(db, {
      workItemId: workItem.id,
      planId: plan.id,
      projectId: workItem.project_id,
      decisionNeeded: `Requires Review: ${message}`,
      recommendation: "Set project_metadata.repo_path for this project, then regenerate the Codex packet.",
      sourceInput: workItem.raw_input,
      proposedAction: message,
      resolvedIntent: `codex_${purpose}`,
      confidenceLabel: "high",
      confidence: 1,
      missingFields: ["repository path"],
      context: {
        workItemId: workItem.id,
        planId: plan.id,
        invocationId: invocation.id,
        reason: message
      }
    });
    return {
      invocationId: invocation.id,
      status: "requires_review",
      command: invocation.command,
      output: message,
      error: message,
      artifactPath: invocation.prompt_path,
      artifact: null,
      additionalArtifacts: []
    };
  }
  const executionScope = projectRepositoryPath ?? invocation.workspace_scope;
  const preparedCommand = buildCodingAgentCommand(profile, executionScope, finalMessagePath);
  const args = preparedCommand.args;
  const command = preparedCommand.displayCommand;

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
        artifact: validation.artifact,
        additionalArtifacts: []
      };
    }
    throw new Error(`Coding-agent invocation packet file is missing: ${invocation.prompt_path}`);
  }

  const prompt = readFileSync(promptPath, "utf8");

  if (purpose === "planning") {
    const authorization = authorizePlanningRunFromRepository(db, workspace, {
      runId: options.runId ?? "",
      planId: plan.id,
      decisionId: options.decisionId ?? "",
      invocationId: invocation.id
    });
    if (!authorization.authorized) {
      updateCodexInvocationStatus(db, invocation.id, "failed");
      const validation = recordPlanningArtifactValidationNotRun(
        db,
        workspace,
        workItem,
        invocation,
        `Planning Validation not run: ${authorization.reason}`
      );
      return {
        invocationId: invocation.id,
        status: "failed",
        command,
        output: validation.summary,
        error: validation.summary,
        artifactPath: validation.sidecarRelativePath,
        artifact: validation.artifact,
        additionalArtifacts: []
      };
    }
  }

  updateCodexInvocationStatus(db, invocation.id, "running");
  const result = spawnSync(profile.command, args, {
    cwd: executionScope,
    input: prompt,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 30 * 60 * 1000,
    killSignal: "SIGTERM"
  });

  writeFileSync(
    jsonlOutputPath,
    [result.stdout ?? "", result.stderr ?? ""].filter(Boolean).join("\n"),
    "utf8"
  );
  if (isUninvokedFinalMessage(finalMessagePath)) {
    writeFileSync(finalMessagePath, finalMessageFromExecution({
      profile,
      finalMessagePath,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? ""
    }), "utf8");
  }

  if (result.error || result.status !== 0) {
    updateCodexInvocationStatus(db, invocation.id, "failed");
    const diagnostic = createArtifactRecord(db, {
      projectId: workItem.project_id,
      workItemId: workItem.id,
      title: `Planning executor diagnostic: ${workItem.title}`,
      artifactType: "planning_executor_diagnostic",
      status: "drafted",
      path: invocation.jsonl_output_path
    });
    const partial = existsSync(finalMessagePath) && statSync(finalMessagePath).size > 0
      ? upsertProducedArtifact(db, {
          projectId: workItem.project_id,
          workItemId: workItem.id,
          title: `Partial planning Artifact: ${workItem.title}`,
          artifactType: "planning_partial_artifact",
          status: "drafted",
          path: invocation.final_message_path,
          convertPathlessExpected: false
        })
      : null;
    const validation = purpose === "planning"
      ? recordPlanningArtifactValidationNotRun(
          db,
          workspace,
          workItem,
          invocation,
          `Planning Validation not run: executor exited with status ${result.status ?? "unknown"}.`
        )
      : null;
    return {
      invocationId: invocation.id,
      status: "failed",
      command,
      output: result.stdout || null,
      error: result.error?.message ?? result.stderr ?? `${codingAgentLabel(profile)} command failed with status ${result.status}`,
      artifactPath: partial?.path ?? diagnostic.path,
      artifact: validation?.artifact ?? diagnostic,
      additionalArtifacts: [diagnostic, ...(partial ? [partial] : [])]
    };
  }

  let validationOutput: string | null = null;
  let validationArtifact: Artifact | null = null;
  let status: CodexStepStatus = "completed";
  let error: string | null = null;

  if (purpose === "planning") {
    const planningArtifact = upsertProducedArtifact(db, {
      projectId: workItem.project_id,
      workItemId: workItem.id,
      title: `Planning Artifact: ${workItem.title}`,
      artifactType: "planning_artifact",
      status: "drafted",
      path: invocation.final_message_path,
      convertPathlessExpected: true
    });
    const validation = recordPlanningArtifactValidation(db, workspace, workItem, plan, invocation);
    validationOutput = validation.summary;
    validationArtifact = validation.artifact;
    if (validation.status === "failed") {
      status = "requires_review";
      error = validation.summary;
      createPlanningValidationReviewItem(
        db,
        workItem,
        plan,
        invocation,
        validation.validation!,
        validation.summary,
        validation.sidecarRelativePath,
        planningArtifact,
        options.runId ?? null
      );
    } else if (validation.status === "passed") {
      createPlanningAcceptanceDecision(db, workItem, plan, invocation, planningArtifact, options.runId ?? null);
    } else {
      status = "failed";
      error = validation.summary;
    }
    validationArtifact = validation.artifact;
    updateCodexInvocationStatus(db, invocation.id, status === "failed" ? "failed" : "completed");
    db.prepare("UPDATE codex_invocations SET plan_step_id = ?, run_id = ?, updated_at = ? WHERE id = ?").run(
      planStepId,
      options.runId ?? null,
      new Date().toISOString(),
      invocation.id
    );
    return {
      invocationId: invocation.id,
      status,
      command,
      output: [
        `${codingAgentLabel(profile)} ${purpose} output captured: ${invocation.jsonl_output_path}`,
        validationOutput
      ].filter(Boolean).join("\n"),
      error,
      artifactPath: invocation.final_message_path,
      artifact: validationArtifact,
      additionalArtifacts: [planningArtifact]
    };
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
      `${codingAgentLabel(profile)} ${purpose} output captured: ${invocation.jsonl_output_path}`,
      validationOutput
    ].filter(Boolean).join("\n"),
    error,
    artifactPath: invocation.final_message_path,
    artifact: validationArtifact,
    additionalArtifacts: []
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
  sidecarRelativePath: string,
  planningArtifact: Artifact,
  runId: string | null
): void {
  const existing = db.prepare(
    `SELECT id FROM review_items
     WHERE resolved_intent = 'codex_planning_artifact_validation'
       AND codex_invocation_id = ?
     LIMIT 1`
  ).get(invocation.id) as { id: string } | undefined;
  if (existing) {
    return;
  }
  createReviewItem(db, {
    workItemId: workItem.id,
    planId: plan.id,
    projectId: workItem.project_id,
    artifactId: planningArtifact.id,
    codexInvocationId: invocation.id,
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
      runId,
      validation
    }
  });
}

function createPlanningAcceptanceDecision(
  db: Database.Database,
  workItem: WorkItemSummary,
  plan: ExecutionPlanSummary,
  invocation: CodexInvocation,
  planningArtifact: Artifact,
  runId: string | null
): void {
  const existing = db.prepare(
    `SELECT id FROM review_items
     WHERE resolved_intent = 'CodexPlanningArtifactAcceptance'
       AND artifact_id = ?
       AND json_extract(context_json, '$.runId') IS ?
     LIMIT 1`
  ).get(planningArtifact.id, runId) as { id: string } | undefined;
  if (existing) {
    return;
  }
  createReviewItem(db, {
    workItemId: workItem.id,
    planId: plan.id,
    projectId: workItem.project_id,
    artifactId: planningArtifact.id,
    codexInvocationId: invocation.id,
    decisionNeeded: `Accept the validated planning Artifact for "${workItem.title}".`,
    recommendation: "Review the plan and Validation evidence, then accept, reject, or defer it.",
    sourceInput: workItem.raw_input,
    proposedAction: "Accept the validated plan as the ready planning Artifact.",
    resolvedIntent: "CodexPlanningArtifactAcceptance",
    confidenceLabel: "high",
    confidence: 1,
    missingFields: [],
    context: {
      schemaVersion: 1,
      runId,
      artifactPath: planningArtifact.path,
      validationResultPath: path.join(path.dirname(invocation.final_message_path), "planning-validation.json"),
      responsibility: "requires_review"
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
    throw new Error(`Coding agent profile is required for ${purpose}.`);
  }

  if (profile.purpose !== purpose) {
    throw new Error(`Coding agent profile ${profile.name} is not configured for ${purpose}.`);
  }

  return profile;
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
      const relativePath = toWorkspaceRelativePath(workspace, reportPath);
      const artifact = upsertProducedArtifact(db, {
        projectId: workItem.project_id,
        workItemId: workItem.id,
        title: `Status report: ${workItem.title}`,
        artifactType: "status_report",
        status: "ready",
        path: relativePath,
        convertPathlessExpected: true
      });
      return { output: `Status report written: ${reportPath}`, artifact };
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
      : "Run recorded.",
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

  return "Inspect the failed run record and decide whether to retry or revise the Action.";
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}
