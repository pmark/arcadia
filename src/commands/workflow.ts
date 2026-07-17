import path from "node:path";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import {
  getWorkflowDefinition,
  installWorkflowDefinition,
  loadWorkflowDefinitions,
  matchWorkflowDefinition,
  readWorkflowDefinition,
  setWorkflowEnabled,
  validateWorkflowDefinition
} from "../workflows/config.js";
import { getWorkflowRun, listWorkflowRuns, runWorkflow } from "../workflows/runner.js";
import { recordWorkflowRunArtifacts } from "../workflows/artifacts.js";
import type { WorkflowDefinition, WorkflowRunRecord, WorkflowValidationResult } from "../workflows/types.js";

export function runWorkflowListCommand(options: { workspace: string }): CommandSuccess<{ workflows: WorkflowDefinition[] }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  return createSuccess({
    command: "workflow.list",
    workspace: workspacePath,
    data: { workflows: loadWorkflowDefinitions(workspacePath) }
  });
}

export function runWorkflowShowCommand(options: { workspace: string; workflowId: string }): CommandSuccess<{ workflow: WorkflowDefinition }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  return createSuccess({
    command: "workflow.show",
    workspace: workspacePath,
    data: { workflow: getWorkflowDefinition(workspacePath, options.workflowId) }
  });
}

export function runWorkflowMatchCommand(options: {
  workspace: string;
  inputPath: string;
  source?: string;
}): CommandSuccess<{ inputPath: string; source: string | null; workflow: WorkflowDefinition | null }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const inputPath = path.resolve(options.inputPath);
  return createSuccess({
    command: "workflow.match",
    workspace: workspacePath,
    data: {
      inputPath,
      source: options.source ?? null,
      workflow: matchWorkflowDefinition(workspacePath, inputPath, options.source)
    }
  });
}

export function runWorkflowValidateCommand(options: {
  workspace: string;
  workflowId?: string;
  filePath?: string;
}): CommandSuccess<{ workflow: WorkflowDefinition; validation: WorkflowValidationResult }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const workflow = options.filePath
    ? readWorkflowDefinition(path.resolve(options.filePath))
    : getWorkflowDefinition(workspacePath, options.workflowId ?? "");
  return createSuccess({
    command: "workflow.validate",
    workspace: workspacePath,
    data: { workflow, validation: validateWorkflowDefinition(workflow) }
  });
}

export function runWorkflowAddCommand(options: {
  workspace: string;
  filePath: string;
  force?: boolean;
}): CommandSuccess<{ workflow: WorkflowDefinition }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const workflow = installWorkflowDefinition(workspacePath, options.filePath, Boolean(options.force));
  const artifactPath = path.join(workspacePath, "config", "workflows", `${workflow.id}.json`);
  return createSuccess({
    command: "workflow.add",
    workspace: workspacePath,
    data: { workflow },
    artifacts: [artifactPath]
  });
}

export function runWorkflowSetEnabledCommand(options: {
  workspace: string;
  workflowId: string;
  enabled: boolean;
}): CommandSuccess<{ workflow: WorkflowDefinition }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const workflow = setWorkflowEnabled(workspacePath, options.workflowId, options.enabled);
  return createSuccess({
    command: options.enabled ? "workflow.enable" : "workflow.disable",
    workspace: workspacePath,
    data: { workflow },
    artifacts: [path.join(workspacePath, "config", "workflows", `${workflow.id}.json`)]
  });
}

export function runWorkflowRunCommand(options: {
  workspace: string;
  workflowId: string;
  inputPath: string;
  dryRun?: boolean;
  destinationRoot?: string;
}): CommandSuccess<{ run: WorkflowRunRecord }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const workflow = getWorkflowDefinition(workspacePath, options.workflowId);
  const run = runWorkflow({
    workspace: workspacePath,
    workflow,
    inputPath: options.inputPath,
    dryRun: options.dryRun,
    destinationRoot: options.destinationRoot
  });
  if (["completed", "already_completed"].includes(run.status)) {
    recordWorkflowRunArtifacts(workspacePath, workflow, run);
  }
  const artifacts = run.status === "would_run" ? [] : [
    run.runManifestPath,
    run.stdoutLogPath,
    run.stderrLogPath,
    run.destinationDirectory,
    ...run.files.map((file) => file.destinationPath)
  ].filter((value): value is string => Boolean(value));
  return createSuccess({ command: "workflow.run", workspace: workspacePath, data: { run }, artifacts });
}

export function runWorkflowRunsCommand(options: {
  workspace: string;
  workflowId?: string;
}): CommandSuccess<{ runs: WorkflowRunRecord[] }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  return createSuccess({
    command: "workflow.runs",
    workspace: workspacePath,
    data: { runs: listWorkflowRuns(workspacePath, options.workflowId) }
  });
}

export function runWorkflowRunShowCommand(options: {
  workspace: string;
  runId: string;
}): CommandSuccess<{ run: WorkflowRunRecord }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const run = getWorkflowRun(workspacePath, options.runId);
  return createSuccess({
    command: "workflow.run.show",
    workspace: workspacePath,
    data: { run },
    artifacts: [run.runManifestPath, run.stdoutLogPath, run.stderrLogPath, ...run.files.map((file) => file.destinationPath)]
      .filter((value): value is string => Boolean(value))
  });
}

export function renderWorkflowListSuccess(response: CommandSuccess<{ workflows: WorkflowDefinition[] }>): string[] {
  if (response.data.workflows.length === 0) return ["No workflows configured."];
  return response.data.workflows.map((workflow) =>
    `${workflow.id}: ${workflow.enabled ? "enabled" : "disabled"} - ${workflow.name}`
  );
}

export function renderWorkflowShowSuccess(response: CommandSuccess<{ workflow: WorkflowDefinition }>): string[] {
  const workflow = response.data.workflow;
  return [
    `Workflow: ${workflow.id}`,
    `Name: ${workflow.name}`,
    `Status: ${workflow.enabled ? "enabled" : "disabled"}`,
    `Executable: ${workflow.action.executable}`,
    `Destination: ${workflow.publication.destinationRoot}/${workflow.publication.directoryTemplate}`
  ];
}

export function renderWorkflowMatchSuccess(response: CommandSuccess<{ workflow: WorkflowDefinition | null }>): string[] {
  return [response.data.workflow
    ? `Matched workflow: ${response.data.workflow.id} - ${response.data.workflow.name}`
    : "No enabled workflow matched the file."];
}

export function renderWorkflowValidateSuccess(response: CommandSuccess<{ workflow: WorkflowDefinition; validation: WorkflowValidationResult }>): string[] {
  return [
    `Workflow: ${response.data.workflow.id}`,
    `Validation: ${response.data.validation.valid ? "passed" : "failed"}`,
    ...response.data.validation.errors.map((error) => `Error: ${error}`),
    ...response.data.validation.warnings.map((warning) => `Warning: ${warning}`)
  ];
}

export function renderWorkflowRunSuccess(response: CommandSuccess<{ run: WorkflowRunRecord }>): string[] {
  const run = response.data.run;
  return [
    `Run: ${run.id}`,
    `Workflow: ${run.workflowId}`,
    `Status: ${run.status}`,
    `Practice date: ${run.recordingDate}`,
    `Destination: ${run.destinationDirectory}`,
    `MP3 Artifacts: ${run.files.length}`,
    run.statusMessage
  ];
}

export function renderWorkflowRunsSuccess(response: CommandSuccess<{ runs: WorkflowRunRecord[] }>): string[] {
  if (response.data.runs.length === 0) return ["No workflow Runs yet."];
  return response.data.runs.map((run) => `${run.id}: ${run.status} - ${run.workflowId} - ${run.inputPath}`);
}
