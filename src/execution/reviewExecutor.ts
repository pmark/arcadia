import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import {
  createArtifactRecord,
  createReviewItem,
  getExecutionRun,
  getExecutionPlan,
  getProject,
  getProjectMetadata,
  getReviewItem,
  getReviewItemBySlug,
  getWorkItem,
  updateReviewItemStatus
} from "../db/repositories.js";
import type { Artifact, ProjectMetadata, ReviewItemSummary, WorkItemSummary } from "../domain/types.js";
import { createId } from "../utils/id.js";
import { getWorkspacePaths, toWorkspaceRelativePath } from "../workspace/paths.js";
import { readExperimentWorkspace } from "../workspace/config.js";
import { isInside, assertRepoPathAllowed } from "../workspace/experimentGuard.js";
import { cloudflareWorkerName } from "../projects/stagingDeployment.js";
import {
  APPROVED_SCOPE_CONTEXT_KEY,
  approvedReviewScopeSha256,
  approvedRunScopeMatches
} from "./approvedReviewScope.js";
import { assertScoutSource, consumeScoutReservation, remainingScoutInvocationMs, type ScoutReservation, type AdmissionScope } from "../scout/runAdmission.js";
import { readProductionPolicy } from "../production/policy.js";
import { classifyScoutFailure, type ScoutExecutionFailure } from "../scout/executionFailure.js";

export type ExecutorName = "codex" | "claude-code" | "gemini" | (string & {});
export type PromptMode = "stdin" | "prompt-file";
export type WorkingDirectoryMode = "repo" | "workspace" | "cwd";
export type OutputCaptureMode = "combined" | "split" | "none";

export interface ReviewExecutionOptions {
  workspace: string;
  reviewId: string;
  executorName?: ExecutorName;
  runId?: string;
  fixtureScript?: string;
  scoutReservation?: ScoutReservation;
  scoutScope?: AdmissionScope;
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
  error: string | null;
  timedOut: boolean;
  scoutFailure?: ScoutExecutionFailure | null;
  changedFiles: string[];
  validation: ValidationCommandResult[];
  finalOutput: string | null;
  artifactPaths: string[];
  metadataPath: string;
  artifact: Artifact;
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
    args: ["--print", "--permission-mode", "acceptEdits", "--no-session-persistence"],
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

export const SCRIPTED_FIXTURE_PENDING_SUMMARY = "Scripted fixture claim is unresolved; review execution evidence before any retry. No product completion is accepted.";

function fixtureExecutor(workspace: string, review: ReviewItemSummary, db: Database.Database, scriptPath: string): ResolvedExecutorAdapter {
  const experiment = readExperimentWorkspace(workspace);
  const script = realpathSync(scriptPath);
  const metadata = review.project_id ? getProjectMetadata(db, review.project_id) : null;
  if (!experiment || !metadata?.repo_path || !isInside(experiment.workspacePath, script) || !script.endsWith(".mjs") || !statSync(script).isFile()) {
    throw validationError("Scripted execution requires a fixture script and repository in an experiment workspace.");
  }
  assertRepoPathAllowed(workspace, metadata.repo_path);
  if (!isInside(experiment.allowedRepoRoot, realpathSync(metadata.repo_path))) throw validationError("Non-fixture repository refused.");
  return normalizeExecutorConfig({ name: "scripted-fixture", commandTemplate: process.execPath, args: [script], promptMode: "stdin", workingDirectory: "repo", timeoutMs: 5000, environmentAllowlist: [], outputCapture: "combined" });
}

/** Read-only approval check, shared by bounded admission and execution. */
export function assertApprovedReview(db: Database.Database, options: ReviewExecutionOptions, inspectBoundedAdmission = false) {
  const triggerReview = getReviewItem(db, options.reviewId) ?? getReviewItemBySlug(db, options.reviewId);
  if (!triggerReview) {
    throw validationError("Requires Review Decision was not found.", { id: options.reviewId });
  }
  const review = executionReviewForTrigger(db, triggerReview);
  const approvalRun = options.runId ? getExecutionRun(db, options.runId) : null;
  const fixture = options.fixtureScript ? fixtureExecutor(options.workspace, review, db, options.fixtureScript) : null;
  if (!canExecuteReview(triggerReview, review, approvalRun, fixture !== null || inspectBoundedAdmission || options.scoutReservation !== undefined)) {
    throw validationError("Execution requires a current approved Run receipt for this Review and Action.", {
      id: triggerReview.id,
      status: triggerReview.status,
      runId: options.runId ?? null
    });
  }

  const context = parseContextJson(review.context_json);
  const approvedScopeSha256 = context[APPROVED_SCOPE_CONTEXT_KEY];
  if (
    typeof approvedScopeSha256 !== "string"
    || approvedScopeSha256 !== approvedReviewScopeSha256(db, review)
    || !approvalRun
    || !approvedRunScopeMatches(review, approvalRun.id, approvedReviewScopeSha256(db, review, approvalRun.id))
  ) {
    throw validationError("Execution approval is stale or missing its approved scope fingerprint.", {
      reviewId: review.id,
      runId: options.runId ?? null
    });
  }

  return { review, approvalRun, triggerReview, fixture };
}

export function executeApprovedReview(
  db: Database.Database,
  options: ReviewExecutionOptions
): ReviewExecutionResult {
  const { review, approvalRun, triggerReview, fixture } = assertApprovedReview(db, options);
  const workItem = review.work_item_id ? getWorkItem(db, review.work_item_id) : null;
  const isProjectProposal = review.resolved_intent === "ProjectProposalApproval";
  if (!isProjectProposal && !workItem) {
    throw validationError("Approved execution requires its governed Action; a missing Action is not permission.", { reviewId: review.id });
  }
  const projectId = review.project_id ?? workItem?.project_id ?? null;
  if (!projectId) {
    throw validationError("Review execution requires a project with a repository path.", { reviewId: review.id });
  }
  const project = getProject(db, projectId);
  const metadata = getProjectMetadata(db, projectId);
  const repoPath = resolveValidRepoPath(metadata, review.id);
  if (isProjectProposal) {
    prepareProjectProposalRepository(repoPath, metadata, review.id);
  }
  const boundedAsk = review.ask_request_id !== null && review.decision_note === "Approved from Ask. Execution queued.";
  // Every caller, including the ordinary worker, reaches this boundary. A JSON
  // receipt or widened approval inspection can never stand in for reservation.
  const admissionRequired = !!options.scoutReservation || boundedAsk;
  if (admissionRequired) {
    if (!options.scoutScope || options.scoutScope.runId !== options.runId || options.scoutScope.repo !== repoPath
      || options.scoutScope.workspace !== options.workspace || options.scoutScope.askId !== review.ask_request_id) {
      throw validationError("Exact-scope durable Scout admission is required.");
    }
  }
  const boundedExecutor = !admissionRequired || fixture ? null : normalizeExecutorConfig({
    name: "codex", commandTemplate: "codex", args: ["exec", "--model", "gpt-6-luna", "-c", 'model_reasoning_effort="low"',
      "-c", 'forced_login_method="chatgpt"', "-c", 'model_provider="openai"',
      "--sandbox", "workspace-write", "--cd", "{repoPath}", "--skip-git-repo-check", "-"],
    promptMode: "stdin", workingDirectory: "repo", outputCapture: "combined", timeoutMs: 90_000,
    environmentAllowlist: ["PATH", "HOME", "SHELL", "TERM", "TMPDIR"]
  });
  const executor = withProjectProposalNetwork(
    fixture ?? boundedExecutor ?? resolveExecutorAdapter(options.workspace, repoPath, options.executorName ?? DEFAULT_EXECUTOR),
    isProjectProposal
  );
  const plan = review.plan_id ? getExecutionPlan(db, review.plan_id) : null;
  // Scripted fixture execution uses its caller's fixed exact-product oracle.
  // Never let fixture metadata select shell commands or configured providers.
  const validationCommands = fixture || admissionRequired ? [] : parseStringArray(metadata?.validation_commands);

  const runId = options.runId ?? createId("executionRun");
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
    contextGuidance: readRepoContextGuidance(repoPath),
    approvalRunId: approvalRun?.id ?? "",
    projectProposal: isProjectProposal ? {
      generatorSkill: metadata?.generator_skill ?? "create-astro-site",
      projectTemplate: metadata?.project_template ?? "astro_field_notes_cloudflare",
      deploymentTarget: metadata?.deployment_target ?? "Cloudflare Workers staging environment",
      workerName: cloudflareWorkerName(project?.slug ?? projectId)
    } : null
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

  const executionCwd = cwdForExecutor(executor, repoPath, options.workspace);
  const executionEnv = buildAllowedEnvironment(executor.environmentAllowlist);

  // Consume at the last synchronous boundary, after packet preparation. The
  // remaining reservation includes that preparation and all prior waits.
  if (admissionRequired) {
    if (readProductionPolicy(db).desiredState !== "inactive") throw validationError("Production must remain Off at invocation.");
    assertScoutSource(options.scoutScope!.sourceHead);
    // GNU timeout is an existing host utility, not a worker/harness. Its
    // separate process survives consumer SIGKILL and kills the executor group.
    // A missing/unsupported utility fails closed; never install one here.
    const found = spawnSync("which", ["timeout"], { encoding: "utf8", timeout: 1000, env: buildAllowedEnvironment(["PATH"]) });
    const timeoutPath = found.stdout?.trim() ?? "";
    if (found.status !== 0 || !path.isAbsolute(timeoutPath)) throw validationError("Durable execution requires the existing GNU timeout utility.");
    const deadline = spawnSync(timeoutPath, ["--version"], { encoding: "utf8", timeout: 1000, env: buildAllowedEnvironment(["PATH"]) });
    if (deadline.status !== 0 || !deadline.stdout?.includes("GNU coreutils")) throw validationError("Durable execution requires the existing GNU timeout utility.");
    assertApprovedReview(db, options);
    consumeScoutReservation(options.scoutReservation, options.scoutScope!, fixture ? "scripted-fixture" : "live");
    executor.timeoutMs = Math.min(executor.timeoutMs, remainingScoutInvocationMs(options.scoutReservation));
    command.unshift(timeoutPath, "--signal=KILL", `${Math.max(1, Math.floor(executor.timeoutMs)) / 1000}s`);
  }
  const run = spawnSync(command[0] ?? "", command.slice(1), {
    cwd: executionCwd,
    input: executor.promptMode === "stdin" ? packet : undefined,
    env: executionEnv,
    encoding: "utf8",
    timeout: executor.timeoutMs + (admissionRequired ? 1000 : 0),
    killSignal: "SIGKILL",
    maxBuffer: 20 * 1024 * 1024
  });
  const endedAt = new Date().toISOString();
  const timedOut = Boolean(run.error && "code" in run.error && run.error.code === "ETIMEDOUT")
    || (admissionRequired && (run.status === 124 || run.status === 137 || run.signal === "SIGKILL"));
  let executionError = run.error?.message ?? (timedOut ? "ETIMEDOUT: bounded executor deadline exceeded" : null);
  const output = captureOutput(executor.outputCapture, run.stdout ?? "", run.stderr ?? "");
  const classified = admissionRequired ? classifyScoutFailure({ diagnostic: [executionError, run.stdout, run.stderr].filter(Boolean).join("\n"),
    runtime: timedOut || run.signal !== null }) : null;
  const terminal = classified && ["auth_failure", "provider_limit", "isolation", "authority"].includes(classified.kind);
  const scoutFailure = admissionRequired && (run.status !== 0 || executionError || run.signal || terminal) ? classified : null;
  if (terminal) executionError ??= `${classified.kind}: ${classified.diagnostic}`;
  const outputPath = path.join(artifactRoot, "executor-output.txt");
  writeFileSync(outputPath, output, "utf8");

  const finalOutput = readFinalOutput(executor.finalOutputFilePath, repoPath, output);
  const finalOutputPath = path.join(artifactRoot, "final-output.md");
  writeFileSync(finalOutputPath, finalOutput ?? "", "utf8");

  const changedFiles = changedFilesFromGitStatus(runGit(["status", "--short"], repoPath).stdout);
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
    timedOut,
    error: executionError,
    scoutFailure,
    preGitStatus: preGitStatus.stdout,
    changedFiles,
    validation,
    finalOutput,
    artifacts: artifactPaths.map((artifactPath) => toWorkspaceRelativePath(options.workspace, artifactPath))
  };
  writeFileSync(metadataPath, `${JSON.stringify(metadataJson, null, 2)}\n`, "utf8");

  const artifact = createArtifactRecord(db, {
    projectId,
    workItemId: workItem?.id ?? null,
    title: `Review execution ${review.slug ?? review.id}`,
    artifactType: "review_execution",
    status: run.status === 0 && !executionError && !run.signal && !timedOut && validation.every((result) => result.exitStatus === 0) ? "ready" : "drafted",
    path: toWorkspaceRelativePath(options.workspace, metadataPath)
  });

  const updatedReview = updateReviewItemStatus(db, review.id, {
    status: "approved",
    decisionNote: isProjectProposal
      ? `Approved scaffold executed with ${executor.name}; deterministic staging deployment pending.`
      : `Approved and executed with ${executor.name}. Implementation remains Requires Review.`
  });
  if (!updatedReview) {
    throw validationError("Requires Review Decision was not found.", { id: review.id });
  }
  if (triggerReview.id !== review.id) {
    updateReviewItemStatus(db, triggerReview.id, {
      status: "approved",
      decisionNote: `Triggered execution for approved review ${review.slug ?? review.id}.`
    });
  }

  let followUp = createReviewItem(db, {
    workItemId: workItem?.id ?? null,
    planId: review.plan_id,
    projectId,
    decisionNeeded: "Review executor implementation output before completion.",
    recommendation: run.status === 0 && !executionError && !run.signal && !timedOut ? "Inspect changed files and validation output before accepting." : "Review the failed executor run and decide the next action.",
    sourceInput: review.source_input,
    proposedAction: buildFollowUpProposedAction(executor.name, changedFiles, validation, finalOutput, run.status),
    resolvedIntent: "ReviewExecutionResult",
    confidenceLabel: "high",
    confidence: 0.95,
    missingFields: [],
    context: {
      originalReviewId: review.id,
      runId,
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
  if (isProjectProposal) {
    followUp = updateReviewItemStatus(db, followUp.id, {
      status: "approved",
      decisionNote: "Scaffold evidence is governed by the original Project proposal approval; no second operator approval is required before staging."
    }) as ReviewItemSummary;
  }

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
    error: executionError,
    scoutFailure,
    timedOut,
    changedFiles,
    validation,
    finalOutput,
    artifactPaths,
    metadataPath,
    artifact
  };
}

function executionReviewForTrigger(db: Database.Database, triggerReview: ReviewItemSummary): ReviewItemSummary {
  const context = parseContextJson(triggerReview.context_json);
  const originalReviewId = typeof context.originalReviewId === "string" ? context.originalReviewId : null;
  if (triggerReview.resolved_intent === "ReviewExecutionPending" && originalReviewId) {
    const original = getReviewItem(db, originalReviewId);
    if (!original) {
      throw validationError("Original approved Decision was not found.", {
        reviewId: triggerReview.id,
        originalReviewId
      });
    }
    return original;
  }
  return triggerReview;
}

function canExecuteReview(
  triggerReview: ReviewItemSummary,
  executionReview: ReviewItemSummary,
  run: ReturnType<typeof getExecutionRun>,
  scriptedFixture: boolean
): boolean {
  if (!run || !run.review_item_id) return false;
  const unresolvedOwnedFixture = scriptedFixture && run.status === "requires_review" && run.pid === process.pid && run.summary === SCRIPTED_FIXTURE_PENDING_SUMMARY;
  if (!["pending_execution", "running"].includes(run.status) && !unresolvedOwnedFixture) return false;
  if (run.review_item_id !== triggerReview.id || run.work_item_id !== executionReview.work_item_id || run.plan_id !== executionReview.plan_id) return false;
  const projectProposalPending = triggerReview.resolved_intent === "ProjectProposalApproval"
    && triggerReview.status === "approved"
    && /execution pending/i.test(triggerReview.decision_note ?? "");
  const askQueued = scriptedFixture && triggerReview.id === executionReview.id
    && triggerReview.status === "approved"
    && triggerReview.ask_request_id !== null
    && triggerReview.resulting_ask_request_id !== null
    && triggerReview.decision_note === "Approved from Ask. Execution queued.";
  if (triggerReview.status !== "open" && triggerReview.status !== "deferred" && !projectProposalPending && !askQueued) return false;
  if (triggerReview.id === executionReview.id) {
    if (projectProposalPending || askQueued) return true;
    return executionReview.status === "open" || executionReview.status === "deferred";
  }
  return executionReview.status === "approved" && /execution pending/i.test(executionReview.decision_note ?? "");
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

function withProjectProposalNetwork(
  executor: ResolvedExecutorAdapter,
  enabled: boolean
): ResolvedExecutorAdapter {
  if (!enabled || executor.name !== "codex") {
    return executor;
  }
  const execIndex = executor.args.indexOf("exec");
  const insertAt = execIndex >= 0 ? execIndex + 1 : 0;
  return {
    ...executor,
    args: [
      ...executor.args.slice(0, insertAt),
      "-c",
      "sandbox_workspace_write.network_access=true",
      ...executor.args.slice(insertAt)
    ]
  };
}

function prepareProjectProposalRepository(
  repoPath: string,
  metadata: ProjectMetadata | null,
  reviewId: string
): void {
  const repositoryUrl = metadata?.repository_url?.trim();
  if (!repositoryUrl) {
    throw validationError("Approved Project proposal is missing its GitHub repository URL.", {
      reviewId,
      field: "repository_url"
    });
  }
  const inside = runGit(["rev-parse", "--is-inside-work-tree"], repoPath);
  if (inside.status !== 0) {
    const initialized = runGit(["init", "-b", "main"], repoPath);
    if (initialized.status !== 0) {
      throw validationError("Could not initialize the approved Project repository.", {
        reviewId,
        detail: initialized.stderr.trim()
      });
    }
  }
  const origin = runGit(["remote", "get-url", "origin"], repoPath);
  if (origin.status === 0 && origin.stdout.trim() !== repositoryUrl) {
    throw validationError("The local Project repository already has a different origin.", {
      reviewId,
      configured: repositoryUrl,
      existing: origin.stdout.trim()
    });
  }
  if (origin.status !== 0) {
    const attached = runGit(["remote", "add", "origin", repositoryUrl], repoPath);
    if (attached.status !== 0) {
      throw validationError("Could not attach the approved GitHub origin.", {
        reviewId,
        detail: attached.stderr.trim()
      });
    }
  }
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
  approvalRunId: string;
  projectProposal: {
    generatorSkill: string;
    projectTemplate: string;
    deploymentTarget: string;
    workerName: string;
  } | null;
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
    `Approval receipt: ${input.approvalRunId}`,
    "Bounded authority: execute the approved Action and its recorded artifact scope only.",
    "",
    "## Original Action Context",
    `Action ID: ${input.workItem?.id ?? input.review.work_item_id ?? "None"}`,
    `Action title: ${input.workItem?.title ?? input.review.work_item_title ?? "None"}`,
    `Approved artifact scope: ${input.workItem?.expected_artifact ?? "None"}`,
    `Original request: ${input.review.source_input}`,
    `Proposed action: ${input.review.proposed_action}`,
    `Plan summary: ${input.planSummary ?? "None"}`,
    "",
    ...(input.projectProposal ? [
      "## Approved Project Scaffold Contract",
      `- Invoke the $${input.projectProposal.generatorSkill} skill and follow it faithfully.`,
      `- Create the ${input.projectProposal.projectTemplate} static Astro Field Notes blog in the current repository.`,
      "- Use pnpm and install Wrangler as a development dependency.",
      `- Configure the smallest Cloudflare Workers Static Assets surface in wrangler.jsonc: top-level name ${input.projectProposal.workerName}, today's compatibility_date, assets.directory ./dist, no main entry point, and env.staging.workers_dev true.`,
      "- Include useful starter Field Notes content and a clear README with local commands.",
      "- Run pnpm run build and fix common-path failures.",
      `- Prepare for ${input.projectProposal.deploymentTarget}, but do not deploy, push, open a pull request, configure production, or add a custom domain. Arcadia runs wrangler deploy --env staging after Validation, which creates only ${input.projectProposal.workerName}-staging.`,
      ""
    ] : []),
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

function changedFilesFromGitStatus(output: string): string[] {
  return Array.from(new Set(output.split(/\r?\n/).flatMap((line) => {
    if (line.length < 4) return [];
    const value = line.slice(3).trim();
    if (!value) return [];
    const renameTarget = value.includes(" -> ") ? value.split(" -> ").at(-1)?.trim() : value;
    return renameTarget ? [renameTarget] : [];
  })));
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
