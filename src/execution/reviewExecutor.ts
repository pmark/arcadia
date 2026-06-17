import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import {
  createArtifactRecord,
  createReviewItem,
  getExecutionPlan,
  getProject,
  getProjectMetadata,
  getReviewItem,
  getReviewItemBySlug,
  getWorkItem,
  updateReviewItemStatus
} from "../db/repositories.js";
import type { ProjectMetadata, ReviewItemSummary, WorkItemSummary } from "../domain/types.js";
import { createId } from "../utils/id.js";
import { getWorkspacePaths, toWorkspaceRelativePath } from "../workspace/paths.js";

export type ExecutorName = "codex" | "claude-code" | "gemini" | string;
export type PromptMode = "stdin" | "prompt-file";
export type WorkingDirectoryMode = "repo" | "workspace" | "cwd";
export type OutputCaptureMode = "combined" | "split" | "none";

export interface ReviewExecutionOptions {
  workspace: string;
  reviewId: string;
  executorName?: ExecutorName;
}

export interface ReviewExecutionResult {
  review: ReviewItemSummary;
  followUpReview: ReviewItemSummary;
  executor: string;
  command: string[];
  repoPath: string;
  workItemId: string | null;
  startedAt: string;
  endedAt: string;
  exitStatus: number | null;
  signal: NodeJS.Signals | null;
  changedFiles: string[];
  validation: ValidationCommandResult[];
  finalOutput: string | null;
  artifactPaths: string[];
  metadataPath: string;
}

export interface ExecutorAdapterConfig {
  name: string;
  commandTemplate: string;
  args?: string[];
  promptMode?: PromptMode;
  workingDirectory?: WorkingDirectoryMode;
  outputCapture?: OutputCaptureMode;
  finalOutputFilePath?: string | null;
  timeoutMs?: number;
  environmentAllowlist?: string[];
}

interface ResolvedExecutorAdapter extends Required<Omit<ExecutorAdapterConfig, "finalOutputFilePath">> {
  finalOutputFilePath: string | null;
}

export interface ValidationCommandResult {
  command: string;
  exitStatus: number | null;
  signal: NodeJS.Signals | null;
  output: string;
  error: string | null;
}

const DEFAULT_EXECUTOR = "codex";
const SAFE_IMPLEMENTATION_MODE = [
  "Safe implementation mode:",
  "- Change only files inside the resolved repository path.",
  "- Avoid credentials, deployment, publishing, spending, destructive actions, production data, generated media, and broad scans unless explicitly approved.",
  "- Leave work Requires Review. Do not mark implementation completed automatically.",
  "- Report changed files, validation commands run, failures, and any follow-up needed."
].join("\n");

const BUILT_IN_EXECUTORS: Record<string, ResolvedExecutorAdapter> = {
  codex: {
    name: "codex",
    commandTemplate: "codex",
    args: ["exec", "--sandbox", "workspace-write", "--cd", "{repoPath}", "--skip-git-repo-check", "-"],
    promptMode: "stdin",
    workingDirectory: "repo",
    outputCapture: "combined",
    finalOutputFilePath: null,
    timeoutMs: 30 * 60 * 1000,
    environmentAllowlist: ["PATH", "HOME", "SHELL", "TERM", "TMPDIR"]
  },
  "claude-code": {
    name: "claude-code",
    commandTemplate: "claude",
    args: ["--print"],
    promptMode: "stdin",
    workingDirectory: "repo",
    outputCapture: "combined",
    finalOutputFilePath: null,
    timeoutMs: 30 * 60 * 1000,
    environmentAllowlist: ["PATH", "HOME", "SHELL", "TERM", "TMPDIR"]
  },
  gemini: {
    name: "gemini",
    commandTemplate: "gemini",
    args: ["--prompt", "{prompt}"],
    promptMode: "stdin",
    workingDirectory: "repo",
    outputCapture: "combined",
    finalOutputFilePath: null,
    timeoutMs: 30 * 60 * 1000,
    environmentAllowlist: ["PATH", "HOME", "SHELL", "TERM", "TMPDIR"]
  }
};

export function executeApprovedReview(
  db: Database.Database,
  options: ReviewExecutionOptions
): ReviewExecutionResult {
  const triggerReview = getReviewItem(db, options.reviewId) ?? getReviewItemBySlug(db, options.reviewId);
  if (!triggerReview) {
    throw validationError("Requires Review item was not found.", { id: options.reviewId });
  }
  const review = executionReviewForTrigger(db, triggerReview);
  if (!canExecuteReview(triggerReview, review)) {
    throw validationError("Requires Review item is already decided.", { id: triggerReview.id, status: triggerReview.status });
  }

  const workItem = review.work_item_id ? getWorkItem(db, review.work_item_id) : null;
  const projectId = review.project_id ?? workItem?.project_id ?? null;
  if (!projectId) {
    throw validationError("Review execution requires a project with a repository path.", { reviewId: review.id });
  }
  const project = getProject(db, projectId);
  const metadata = getProjectMetadata(db, projectId);
  const repoPath = resolveValidRepoPath(metadata, review.id);
  const executor = resolveExecutorAdapter(options.workspace, repoPath, options.executorName ?? DEFAULT_EXECUTOR);
  const plan = review.plan_id ? getExecutionPlan(db, review.plan_id) : null;
  const validationCommands = parseStringArray(metadata?.validation_commands);

  const runId = createId("executionRun");
  const startedAt = new Date().toISOString();
  const artifactRoot = path.join(getWorkspacePaths(options.workspace).artifacts, "review-executions", runId);
  mkdirSync(artifactRoot, { recursive: true });

  const packet = buildImplementationPacket({
    review,
    workItem,
    projectName: project?.name ?? null,
    repoPath,
    planSummary: plan?.summary ?? review.plan_summary,
    validationCommands,
    contextGuidance: readRepoContextGuidance(repoPath)
  });
  const promptPath = path.join(artifactRoot, "prompt.md");
  writeFileSync(promptPath, packet, "utf8");

  const preGitStatus = runGit(["status", "--short"], repoPath);
  const command = resolveCommandInvocation(executor, {
    prompt: packet,
    promptFile: promptPath,
    repoPath,
    workspacePath: options.workspace,
    reviewId: review.id,
    workItemId: workItem?.id ?? ""
  });

  const run = spawnSync(command[0] ?? "", command.slice(1), {
    cwd: cwdForExecutor(executor, repoPath, options.workspace),
    input: executor.promptMode === "stdin" ? packet : undefined,
    env: buildAllowedEnvironment(executor.environmentAllowlist),
    encoding: "utf8",
    timeout: executor.timeoutMs,
    maxBuffer: 20 * 1024 * 1024
  });
  const endedAt = new Date().toISOString();
  const output = captureOutput(executor.outputCapture, run.stdout ?? "", run.stderr ?? "");
  const outputPath = path.join(artifactRoot, "executor-output.txt");
  writeFileSync(outputPath, output, "utf8");

  const finalOutput = readFinalOutput(executor.finalOutputFilePath, repoPath, output);
  const finalOutputPath = path.join(artifactRoot, "final-output.md");
  writeFileSync(finalOutputPath, finalOutput ?? "", "utf8");

  const changedFiles = runGit(["diff", "--name-only"], repoPath).stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const validation = validationCommands.map((commandText) => runValidationCommand(commandText, repoPath));
  const validationPath = path.join(artifactRoot, "validation.json");
  writeFileSync(validationPath, `${JSON.stringify(validation, null, 2)}\n`, "utf8");

  const metadataPath = path.join(artifactRoot, "metadata.json");
  const artifactPaths = [promptPath, outputPath, finalOutputPath, validationPath, metadataPath];
  const metadataJson = {
    runId,
    reviewId: review.id,
    workItemId: workItem?.id ?? null,
    executor: executor.name,
    command,
    repoPath,
    startedAt,
    endedAt,
    exitStatus: run.status,
    signal: run.signal,
    timedOut: Boolean(run.error && run.error.message.includes("ETIMEDOUT")),
    error: run.error?.message ?? null,
    preGitStatus: preGitStatus.stdout,
    changedFiles,
    validation,
    finalOutput,
    artifacts: artifactPaths.map((artifactPath) => toWorkspaceRelativePath(options.workspace, artifactPath))
  };
  writeFileSync(metadataPath, `${JSON.stringify(metadataJson, null, 2)}\n`, "utf8");

  createArtifactRecord(db, {
    projectId,
    workItemId: workItem?.id ?? null,
    title: `Review execution ${review.slug ?? review.id}`,
    artifactType: "review_execution",
    status: run.status === 0 ? "ready" : "drafted",
    path: toWorkspaceRelativePath(options.workspace, metadataPath)
  });

  const updatedReview = updateReviewItemStatus(db, review.id, {
    status: "approved",
    decisionNote: `Approved and executed with ${executor.name}. Implementation remains Requires Review.`
  });
  if (!updatedReview) {
    throw validationError("Requires Review item was not found.", { id: review.id });
  }
  if (triggerReview.id !== review.id) {
    updateReviewItemStatus(db, triggerReview.id, {
      status: "approved",
      decisionNote: `Triggered execution for approved review ${review.slug ?? review.id}.`
    });
  }

  const followUp = createReviewItem(db, {
    workItemId: workItem?.id ?? null,
    planId: review.plan_id,
    projectId,
    decisionNeeded: "Review executor implementation output before completion.",
    recommendation: run.status === 0 ? "Inspect changed files and validation output before accepting." : "Review the failed executor run and decide the next action.",
    sourceInput: review.source_input,
    proposedAction: buildFollowUpProposedAction(executor.name, changedFiles, validation, finalOutput, run.status),
    resolvedIntent: "ReviewExecutionResult",
    confidenceLabel: "high",
    confidence: 0.95,
    missingFields: [],
    context: {
      originalReviewId: review.id,
      executor: executor.name,
      repoPath,
      command,
      exitStatus: run.status,
      signal: run.signal,
      changedFiles,
      validation,
      artifactPaths: artifactPaths.map((artifactPath) => toWorkspaceRelativePath(options.workspace, artifactPath)),
      finalOutput
    }
  });

  return {
    review: updatedReview,
    followUpReview: followUp,
    executor: executor.name,
    command,
    repoPath,
    workItemId: workItem?.id ?? null,
    startedAt,
    endedAt,
    exitStatus: run.status,
    signal: run.signal,
    changedFiles,
    validation,
    finalOutput,
    artifactPaths,
    metadataPath
  };
}

function executionReviewForTrigger(db: Database.Database, triggerReview: ReviewItemSummary): ReviewItemSummary {
  const context = parseContextJson(triggerReview.context_json);
  const originalReviewId = typeof context.originalReviewId === "string" ? context.originalReviewId : null;
  if (triggerReview.resolved_intent === "ReviewExecutionPending" && originalReviewId) {
    const original = getReviewItem(db, originalReviewId);
    if (!original) {
      throw validationError("Original approved review item was not found.", {
        reviewId: triggerReview.id,
        originalReviewId
      });
    }
    return original;
  }
  return triggerReview;
}

function canExecuteReview(triggerReview: ReviewItemSummary, executionReview: ReviewItemSummary): boolean {
  if (triggerReview.status === "open" || triggerReview.status === "deferred") {
    return true;
  }
  if (triggerReview.resolved_intent === "ReviewExecutionPending" && triggerReview.status === "approved") {
    return false;
  }
  return executionReview.status === "approved" && isExecutionPending(executionReview);
}

function isExecutionPending(review: ReviewItemSummary): boolean {
  return /execution pending/i.test(review.decision_note ?? "");
}

function resolveValidRepoPath(metadata: ProjectMetadata | null, reviewId: string): string {
  const repoPath = metadata?.repo_path?.trim();
  if (!repoPath) {
    throw validationError("Review execution requires project repository metadata.", { reviewId, field: "repo_path" });
  }
  const absolute = path.resolve(repoPath);
  if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
    throw validationError("Review execution refused because the project repository path is missing or invalid.", {
      reviewId,
      repoPath: absolute
    });
  }
  return realpathSync(absolute);
}

function resolveExecutorAdapter(workspace: string, repoPath: string, name: string): ResolvedExecutorAdapter {
  const configured = [...loadWorkspaceExecutorConfigs(workspace), ...loadRepoExecutorConfigs(repoPath)];
  const custom = configured.find((executor) => executor.name === name);
  const base = custom ?? BUILT_IN_EXECUTORS[name];
  if (!base) {
    throw validationError("Unknown review executor.", {
      executor: name,
      availableExecutors: [...Object.keys(BUILT_IN_EXECUTORS), ...configured.map((executor) => executor.name)]
    });
  }
  return normalizeExecutorConfig(base);
}

function normalizeExecutorConfig(config: ExecutorAdapterConfig): ResolvedExecutorAdapter {
  return {
    name: config.name,
    commandTemplate: config.commandTemplate,
    args: config.args ?? [],
    promptMode: config.promptMode ?? "stdin",
    workingDirectory: config.workingDirectory ?? "repo",
    outputCapture: config.outputCapture ?? "combined",
    finalOutputFilePath: config.finalOutputFilePath ?? null,
    timeoutMs: config.timeoutMs ?? 30 * 60 * 1000,
    environmentAllowlist: config.environmentAllowlist ?? []
  };
}

function loadWorkspaceExecutorConfigs(workspace: string): ExecutorAdapterConfig[] {
  const configPath = getWorkspacePaths(workspace).configFile;
  return loadExecutorConfigsFromJson(configPath);
}

function loadRepoExecutorConfigs(repoPath: string): ExecutorAdapterConfig[] {
  return [
    ...loadExecutorConfigsFromJson(path.join(repoPath, ".arcadia", "executors.json")),
    ...loadExecutorConfigsFromJson(path.join(repoPath, ".arcadia", "executor-config.json"))
  ];
}

function loadExecutorConfigsFromJson(configPath: string): ExecutorAdapterConfig[] {
  if (!existsSync(configPath)) {
    return [];
  }
  const parsed = JSON.parse(readFileSync(configPath, "utf8")) as {
    executors?: unknown;
    customExecutors?: unknown;
    executorAdapters?: unknown;
  };
  const raw = parsed.executors ?? parsed.customExecutors ?? parsed.executorAdapters ?? [];
  if (Array.isArray(raw)) {
    return raw.filter(isExecutorAdapterConfig);
  }
  if (raw && typeof raw === "object") {
    return Object.entries(raw).flatMap(([name, value]) => {
      if (value && typeof value === "object") {
        const candidate = { name, ...(value as Record<string, unknown>) };
        return isExecutorAdapterConfig(candidate) ? [candidate] : [];
      }
      return [];
    });
  }
  return [];
}

function isExecutorAdapterConfig(value: unknown): value is ExecutorAdapterConfig {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { name?: unknown }).name === "string" &&
      typeof (value as { commandTemplate?: unknown }).commandTemplate === "string"
  );
}

function buildImplementationPacket(input: {
  review: ReviewItemSummary;
  workItem: WorkItemSummary | null;
  projectName: string | null;
  repoPath: string;
  planSummary: string | null;
  validationCommands: string[];
  contextGuidance: string[];
}): string {
  return [
    "# Arcadia Approved Review Implementation Packet",
    "",
    SAFE_IMPLEMENTATION_MODE,
    "",
    "## Review",
    `Review ID: ${input.review.id}`,
    `Review slug: ${input.review.slug ?? input.review.id}`,
    `Project: ${input.projectName ?? input.review.project_name ?? "None"}`,
    `Repository path: ${input.repoPath}`,
    `Decision needed: ${input.review.decision_needed}`,
    `Recommendation: ${input.review.recommendation ?? "None"}`,
    "",
    "## Original Work Context",
    `Work item ID: ${input.workItem?.id ?? input.review.work_item_id ?? "None"}`,
    `Work item title: ${input.workItem?.title ?? input.review.work_item_title ?? "None"}`,
    `Original request: ${input.review.source_input}`,
    `Proposed action: ${input.review.proposed_action}`,
    `Plan summary: ${input.planSummary ?? "None"}`,
    "",
    "## Validation",
    ...(input.validationCommands.length > 0
      ? input.validationCommands.map((command) => `- ${command}`)
      : ["- No validation commands are configured. Record that validation was not available."]),
    "",
    ...input.contextGuidance,
    "",
    "## Required Final Message",
    "Summarize files changed, validation run, failures, and remaining review needs. Leave the work Requires Review."
  ].join("\n");
}

function readRepoContextGuidance(repoPath: string): string[] {
  const policyPath = path.join(repoPath, ".arcadia", "context-policy.json");
  const contextPath = path.join(repoPath, ".arcadia", "repo-context.md");
  const sections: string[] = [];
  if (existsSync(policyPath)) {
    sections.push("## Arcadia Context Policy (.arcadia/context-policy.json)", "```json", readFileSync(policyPath, "utf8").trim(), "```");
  }
  if (existsSync(contextPath)) {
    sections.push("## Arcadia Repo Context (.arcadia/repo-context.md)", readFileSync(contextPath, "utf8").trim());
  }
  return sections;
}

function resolveCommandInvocation(
  executor: ResolvedExecutorAdapter,
  values: Record<string, string>
): string[] {
  const commandParts = splitCommandTemplate(replacePlaceholders(executor.commandTemplate, values));
  const args = executor.args.map((arg) => replacePlaceholders(arg, values));
  return [...commandParts, ...args];
}

function splitCommandTemplate(commandTemplate: string): string[] {
  const matches = commandTemplate.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  return matches.map((part) => part.replace(/^['"]|['"]$/g, ""));
}

function replacePlaceholders(value: string, values: Record<string, string>): string {
  return value.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key: string) => values[key] ?? "");
}

function cwdForExecutor(executor: ResolvedExecutorAdapter, repoPath: string, workspace: string): string {
  if (executor.workingDirectory === "workspace") {
    return workspace;
  }
  if (executor.workingDirectory === "cwd") {
    return process.cwd();
  }
  return repoPath;
}

function buildAllowedEnvironment(allowlist: string[]): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of allowlist) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
  }
  return env;
}

function captureOutput(mode: OutputCaptureMode, stdout: string, stderr: string): string {
  if (mode === "none") {
    return "";
  }
  if (mode === "split") {
    return [`[stdout]\n${stdout.trimEnd()}`, `[stderr]\n${stderr.trimEnd()}`].join("\n\n").trim();
  }
  return [stdout, stderr].filter(Boolean).join("\n").trim();
}

function readFinalOutput(finalOutputFilePath: string | null, repoPath: string, fallback: string): string | null {
  if (!finalOutputFilePath) {
    return fallback || null;
  }
  const resolved = path.isAbsolute(finalOutputFilePath)
    ? finalOutputFilePath
    : path.join(repoPath, finalOutputFilePath);
  if (!existsSync(resolved)) {
    return fallback || null;
  }
  return readFileSync(resolved, "utf8");
}

function runGit(args: string[], cwd: string): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 30_000 });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status
  };
}

function runValidationCommand(command: string, cwd: string): ValidationCommandResult {
  const result = spawnSync(command, {
    cwd,
    shell: true,
    encoding: "utf8",
    timeout: 10 * 60 * 1000,
    maxBuffer: 20 * 1024 * 1024
  });
  return {
    command,
    exitStatus: result.status,
    signal: result.signal,
    output: captureOutput("combined", result.stdout ?? "", result.stderr ?? ""),
    error: result.error?.message ?? null
  };
}

function buildFollowUpProposedAction(
  executor: string,
  changedFiles: string[],
  validation: ValidationCommandResult[],
  finalOutput: string | null,
  exitStatus: number | null
): string {
  const validationSummary = validation.length > 0
    ? validation.map((result) => `${result.command}: ${result.exitStatus === 0 ? "passed" : `failed (${result.exitStatus ?? result.signal ?? "unknown"})`}`).join("; ")
    : "No validation commands configured.";
  return [
    `Executor ${executor} finished with exit status ${exitStatus ?? "unknown"}.`,
    `Changed files: ${changedFiles.length > 0 ? changedFiles.join(", ") : "None detected by git diff --name-only."}`,
    `Validation: ${validationSummary}`,
    `Final output: ${finalOutput?.trim() || "No final output captured."}`,
    "Review the implementation before any completion decision."
  ].join("\n");
}

function parseStringArray(raw: string | null | undefined): string[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string" && value.trim().length > 0) : [];
  } catch {
    return [];
  }
}

function parseContextJson(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
