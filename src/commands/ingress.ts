import {
  existsSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { validationError, normalizeError } from "../cli/errors.js";
import type { CommandFailure, CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { withDatabase } from "../db/connection.js";
import { createArtifactRecord, createMissionLog, getMilestone, getProject } from "../db/repositories.js";
import type { AskCommandData, AskOptions } from "./ask.js";
import { runAskCommand } from "./ask.js";
import { buildMissionLogRelativePath, writeMissionLogMarkdown } from "../markdown/missionLog.js";
import { createId } from "../utils/id.js";
import { nowIso } from "../utils/time.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { matchWorkflowDefinition } from "../workflows/config.js";
import { listWorkflowRuns, runWorkflow } from "../workflows/runner.js";
import type { WorkflowDefinition } from "../workflows/types.js";
import { recordWorkflowRunArtifacts } from "../workflows/artifacts.js";
import { writeIngressMemoryNote } from "../memory/obsidian.js";

export const DEFAULT_INGRESS_SOURCE = "iCloudIdeas";

export interface IngressProcessOptions {
  workspace: string;
  source?: string;
  runSafe?: boolean;
  dryRun?: boolean;
  ingressRoot?: string;
  stableSeconds?: number;
  askRunner?: (options: AskOptions) => CommandSuccess<AskCommandData>;
}

export interface IngressFileResult {
  file: string;
  status: "would_process" | "pending" | "processed" | "preserved" | "skipped_empty" | "failed";
  requestPreview?: string;
  finalPath?: string;
  sidecarPath?: string;
  askId?: string;
  workItemId?: string;
  planId?: string;
  runId?: string;
  artifacts: string[];
  failureReason?: string;
  workflowId?: string;
}

export interface IngressProcessData {
  source: string;
  root: string;
  directories: {
    in: string;
    processing: string;
    done: string;
    failed: string;
    attachments: string;
  };
  executionMode: "planned" | "run-safe";
  dryRun: boolean;
  files: IngressFileResult[];
  counts: {
    discovered: number;
    processed: number;
    succeeded: number;
    failed: number;
    skipped: number;
    pending: number;
  };
}

export interface IngressListFile {
  name: string;
  relativePath: string;
  file: string;
  kind: "image" | "video" | "audio" | "document" | "other";
  mimeType: string;
  size: number;
  modifiedAt: string;
  downloadState: "downloaded" | "not_downloaded" | "downloading" | "unknown";
}

export interface IngressListData {
  source: string;
  root: string;
  directories: IngressProcessData["directories"];
  files: IngressListFile[];
}

export type IngressActivityStatus = "pending" | "processing" | "completed" | "failed" | "preserved" | "skipped";

export interface IngressActivityItem {
  id: string;
  fileName: string;
  status: IngressActivityStatus;
  location: "root" | "in" | "processing" | "done" | "failed";
  timestamp: string;
  path: string;
  summary: string;
  workflowId: string | null;
  runId: string | null;
  runManifestPath: string | null;
  artifactCount: number;
  failureReason: string | null;
}

export interface IngressActivityRun {
  id: string;
  workflowId: string;
  status: string;
  currentStep: string;
  inputPath: string;
  startedAt: string;
  statusMessage: string;
  mostRecentOutput: string | null;
  failureReason: string | null;
  runManifestPath: string | null;
}

export interface IngressActivityData {
  source: string;
  root: string;
  generatedAt: string;
  directories: IngressProcessData["directories"];
  service: {
    healthStatePath: string;
    healthy: boolean | null;
    checkedAt: string | null;
    counts: { observed: number; discovered: number; processed: number; failed: number } | null;
    error: string | null;
  };
  current: IngressActivityItem[];
  activeRuns: IngressActivityRun[];
  recent: IngressActivityItem[];
  counts: {
    pending: number;
    processing: number;
    activeRuns: number;
    failed: number;
    recent: number;
  };
}

export interface IngressDescribeData {
  source: string;
  root: string;
  requestFile: string;
  selectedFiles: string[];
  attachmentFiles: string[];
  description: string;
}

export interface IngressCaptureOptions {
  workspace: string;
  source?: string;
  ingressRoot?: string;
  files: string[];
  description?: string;
}

interface IngressDirectories {
  in: string;
  processing: string;
  done: string;
  failed: string;
  attachments: string;
}

interface CandidateFile {
  absolutePath: string;
  fileName: string;
  mtimeMs: number;
  sharedArtifactPaths: string[];
  workflow: WorkflowDefinition | null;
  kind: "request" | "workflow" | "unclassified";
  stable: boolean;
}

interface StabilityObservation {
  size: number;
  mtimeMs: number;
  observedAtMs: number;
}

export function runIngressListCommand(options: {
  workspace: string;
  source?: string;
  ingressRoot?: string;
}): CommandSuccess<IngressListData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const source = options.source?.trim() || DEFAULT_INGRESS_SOURCE;
  validateSourceName(source);
  const root = path.resolve(options.ingressRoot ?? defaultIngressRoot());
  const directories = ingressDirectories(root, source);
  const files = existsSync(directories.in)
    ? readdirSync(directories.in, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
      .map((entry) => {
        const file = path.join(directories.in, entry.name);
        const stats = statSync(file);
        return {
          name: entry.name,
          relativePath: entry.name,
          file,
          kind: ingressFileKind(entry.name),
          mimeType: ingressMimeType(entry.name),
          size: stats.size,
          modifiedAt: new Date(stats.mtimeMs).toISOString(),
          downloadState: ingressDownloadState(file, stats)
        } satisfies IngressListFile;
      })
      .sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt) || left.name.localeCompare(right.name))
    : [];

  return createSuccess({
    command: "ingress.list",
    workspace: workspacePath,
    data: {
      source,
      root,
      directories: {
        in: directories.in,
        processing: directories.processing,
        done: directories.done,
        failed: directories.failed,
        attachments: directories.attachments
      },
      files
    },
    artifacts: files.map((file) => file.file)
  });
}

export function runIngressActivityCommand(options: {
  workspace: string;
  source?: string;
  ingressRoot?: string;
  limit?: number;
}): CommandSuccess<IngressActivityData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const source = options.source?.trim() || DEFAULT_INGRESS_SOURCE;
  validateSourceName(source);
  const limit = options.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw validationError("Activity limit must be an integer between 1 and 100.", { limit });
  }

  const root = path.resolve(options.ingressRoot ?? defaultIngressRoot());
  const directories = ingressDirectories(root, source);
  const current = [
    ...listCurrentActivityFiles(root, "root", workspacePath, source),
    ...listCurrentActivityFiles(directories.in, "in", workspacePath, source),
    ...listCurrentActivityFiles(directories.processing, "processing", workspacePath, source)
  ].sort((left, right) => right.timestamp.localeCompare(left.timestamp) || left.fileName.localeCompare(right.fileName));
  const activeRuns = listWorkflowRuns(workspacePath)
    .filter((run) => run.status === "running" && isIngressPath(run.inputPath, root, directories))
    .map((run) => ({
      id: run.id,
      workflowId: run.workflowId,
      status: run.status,
      currentStep: run.currentStep,
      inputPath: run.inputPath,
      startedAt: run.startedAt,
      statusMessage: run.statusMessage,
      mostRecentOutput: run.mostRecentOutput,
      failureReason: run.failureReason,
      runManifestPath: run.runManifestPath
    } satisfies IngressActivityRun));
  const recent = listIngressSidecars(directories.done, "done")
    .concat(listIngressSidecars(directories.failed, "failed"))
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp) || left.fileName.localeCompare(right.fileName))
    .slice(0, limit);
  const service = readIngressActivityHealth(source);

  return createSuccess({
    command: "ingress.activity",
    workspace: workspacePath,
    data: {
      source,
      root,
      generatedAt: new Date().toISOString(),
      directories: {
        in: directories.in,
        processing: directories.processing,
        done: directories.done,
        failed: directories.failed,
        attachments: directories.attachments
      },
      service,
      current,
      activeRuns,
      recent,
      counts: {
        pending: current.filter((item) => item.status === "pending").length,
        processing: current.filter((item) => item.status === "processing").length,
        activeRuns: activeRuns.length,
        failed: recent.filter((item) => item.status === "failed").length,
        recent: recent.length
      }
    },
    artifacts: [
      ...current.map((item) => item.path),
      ...activeRuns.map((run) => run.runManifestPath),
      ...recent.map((item) => item.id),
      service.healthStatePath
    ].filter(isString)
  });
}

export function renderIngressActivitySuccess(response: CommandSuccess<IngressActivityData>): string[] {
  const { data } = response;
  const serviceLabel = data.service.healthy === null ? "unknown" : data.service.healthy ? "healthy" : "needs attention";
  return [
    `Ingress activity: ${serviceLabel}`,
    `Pending: ${data.counts.pending}`,
    `Processing: ${data.counts.processing}`,
    `Active Runs: ${data.counts.activeRuns}`,
    `Recent: ${data.counts.recent}`,
    ...data.current.map((item) => `- ${item.fileName}: ${item.status} (${item.summary})`),
    ...data.recent.map((item) => `- ${item.fileName}: ${item.status} (${item.summary})`)
  ];
}

function listCurrentActivityFiles(
  directory: string,
  location: IngressActivityItem["location"],
  workspace: string,
  source: string
): IngressActivityItem[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
    .map((entry) => {
      const filePath = path.join(directory, entry.name);
      const stats = statSync(filePath);
      const workflow = matchWorkflowDefinition(workspace, filePath, source);
      const status: IngressActivityStatus = location === "processing" ? "processing" : "pending";
      return {
        id: filePath,
        fileName: entry.name,
        status,
        location,
        timestamp: new Date(stats.mtimeMs).toISOString(),
        path: filePath,
        summary: location === "processing"
          ? workflow ? `Running ${workflow.name}.` : "Being processed."
          : workflow ? `Waiting for ${workflow.name}.` : "Waiting for ingress processing.",
        workflowId: workflow?.id ?? null,
        runId: null,
        runManifestPath: null,
        artifactCount: 0,
        failureReason: null
      } satisfies IngressActivityItem;
    });
}

function listIngressSidecars(directory: string, location: "done" | "failed"): IngressActivityItem[] {
  if (!existsSync(directory)) return [];
  const sidecars: IngressActivityItem[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      sidecars.push(...listIngressSidecars(filePath, location));
      continue;
    }
    if (!entry.isFile() || (!entry.name.endsWith(".response.json") && !entry.name.endsWith(".error.json"))) continue;
    const record = readJsonRecord(filePath);
    const stats = statSync(filePath);
    const run = isRecord(record?.run) ? record.run : null;
    const files = Array.isArray(run?.files) ? run.files : [];
    const status = record?.status === "failed"
      ? "failed"
      : record?.status === "preserved_unclassified"
      ? "preserved"
      : record?.status === "skipped_empty"
      ? "skipped"
      : "completed";
    const failureReason = status === "failed"
      ? stringValue(record?.failureReason) ?? stringValue(run?.failureReason) ?? nestedErrorMessage(record?.error)
      : null;
    const runId = stringValue(record?.runId) ?? stringValue(run?.id);
    sidecars.push({
      id: filePath,
      fileName: stringValue(record?.finalPath)
        ? path.basename(stringValue(record?.finalPath)!)
        : stringValue(record?.sourcePath)
        ? path.basename(stringValue(record?.sourcePath)!)
        : sidecarFileName(entry.name),
      status,
      location,
      timestamp: stringValue(record?.processedAt) ?? stats.mtime.toISOString(),
      path: stringValue(record?.finalPath) ?? stringValue(record?.sourcePath) ?? filePath,
      summary: status === "failed"
        ? failureReason ?? "Ingress processing failed."
        : status === "preserved"
        ? stringValue(record?.reason) ?? "Preserved as an unclassified Artifact."
        : status === "skipped"
        ? "Skipped because the request was empty."
        : files.length > 0
        ? `Published ${files.length} extracted Artifact${files.length === 1 ? "" : "s"}.`
        : "Ingress processing completed.",
      workflowId: stringValue(record?.workflowId),
      runId,
      runManifestPath: stringValue(run?.runManifestPath),
      artifactCount: files.length,
      failureReason
    });
  }
  return sidecars;
}

function readIngressActivityHealth(source: string): IngressActivityData["service"] {
  const healthStatePath = path.join(
    homedir(),
    "Library",
    "Application Support",
    "Arcadia",
    "ingress-services",
    `${source}.json`
  );
  const record = readJsonRecord(healthStatePath);
  const counts = isRecord(record?.counts)
    ? {
        observed: numberValue(record.counts.observed) ?? 0,
        discovered: numberValue(record.counts.discovered) ?? 0,
        processed: numberValue(record.counts.processed) ?? 0,
        failed: numberValue(record.counts.failed) ?? 0
      }
    : null;
  return {
    healthStatePath,
    healthy: typeof record?.healthy === "boolean" ? record.healthy : null,
    checkedAt: stringValue(record?.checkedAt),
    counts,
    error: stringValue(record?.error)
  };
}

function readJsonRecord(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null;
  try {
    const value: unknown = JSON.parse(readFileSync(filePath, "utf8"));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function sidecarFileName(fileName: string): string {
  return fileName.replace(/\.(response|error)\.json$/, "");
}

function isIngressPath(inputPath: string, root: string, directories: IngressDirectories): boolean {
  const resolvedInput = path.resolve(inputPath);
  return [root, directories.in, directories.processing, directories.done, directories.failed]
    .some((directory) => resolvedInput === path.resolve(directory) || resolvedInput.startsWith(`${path.resolve(directory)}${path.sep}`));
}

function nestedErrorMessage(value: unknown): string | null {
  return isRecord(value) ? stringValue(value.message) : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ingressDownloadState(file: string, stats: { size: number; blocks: number }): IngressListFile["downloadState"] {
  if (process.platform !== "darwin") return "downloaded";

  const xattr = spawnSync("/usr/bin/xattr", ["-p", "com.apple.icloud.itemIsDownloaded", file], {
    encoding: "utf8"
  });
  if (xattr.status === 0) {
    const value = xattr.stdout.trim().toLowerCase();
    if (value === "1" || value === "true") return "downloaded";
    if (value === "0" || value === "false") return "not_downloaded";
  }

  const status = spawnSync("/usr/bin/brctl", ["status", file], { encoding: "utf8" });
  const output = `${status.stdout}\n${status.stderr}`.toLowerCase();
  if (/not downloaded|cloud only|evicted|download pending|downloading/.test(output)) {
    return /downloading|download pending/.test(output) ? "downloading" : "not_downloaded";
  }
  if (/downloaded|materialized|local/.test(output)) return "downloaded";

  // File Provider placeholders can retain their logical size while having no
  // local blocks. For a non-empty file, local blocks are therefore the useful
  // final fallback when the provider exposes no status metadata.
  if (stats.size === 0) return "unknown";
  return stats.blocks === 0 ? "not_downloaded" : "downloaded";
}

export function runIngressDescribeCommand(options: {
  workspace: string;
  source?: string;
  ingressRoot?: string;
  files: string[];
  description: string;
}): CommandSuccess<IngressDescribeData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const source = options.source?.trim() || DEFAULT_INGRESS_SOURCE;
  validateSourceName(source);
  const description = options.description.trim();
  if (!description) {
    throw validationError("A description is required for selected ingress files.");
  }
  const selectedFiles = [...new Set(options.files.map((file) => file.trim()).filter(Boolean))];
  if (selectedFiles.length === 0) {
    throw validationError("Select at least one ingress file.");
  }
  if (selectedFiles.some((file) => file !== path.basename(file) || file.startsWith("."))) {
    throw validationError("Ingress files must be names from the In folder.", { files: selectedFiles });
  }

  const root = path.resolve(options.ingressRoot ?? defaultIngressRoot());
  const directories = ingressDirectories(root, source);
  ensureIngressDirectories(directories);
  const missing = selectedFiles.filter((file) => !existsSync(path.join(directories.in, file)));
  if (missing.length > 0) {
    throw validationError("One or more selected ingress files are no longer present.", { missing });
  }

  const requestFile = path.join(directories.in, `arcadia-${createId("event")}.txt`);
  const attachmentDirectory = path.join(directories.attachments, path.parse(requestFile).name);
  mkdirSync(attachmentDirectory, { recursive: true });
  const attachmentFiles = selectedFiles.map((file) => {
    const destination = path.join(attachmentDirectory, file);
    copyFileSync(path.join(directories.in, file), destination);
    return destination;
  });
  writeFileSync(
    requestFile,
    `${description}\n\nSelected ingress Artifacts:\n${selectedFiles.map((file) => `- ${file}`).join("\n")}\n`,
    "utf8"
  );

  return createSuccess({
    command: "ingress.describe",
    workspace: workspacePath,
    data: {
      source,
      root,
      requestFile,
      selectedFiles,
      attachmentFiles,
      description
    },
    artifacts: [requestFile, ...attachmentFiles]
  });
}

export function runIngressCaptureCommand(options: IngressCaptureOptions): CommandSuccess<IngressDescribeData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const source = options.source?.trim() || DEFAULT_INGRESS_SOURCE;
  validateSourceName(source);
  const description = options.description?.trim() || "Process these captured files through Arcadia's default ingress handling.";
  const files = [...new Set(options.files.map((file) => path.resolve(file)))];
  if (files.length === 0) throw validationError("At least one local file is required for ingress capture.");
  if (files.some((file) => !existsSync(file) || !statSync(file).isFile())) {
    throw validationError("Every ingress capture file must exist and be a regular file.", { files });
  }

  const root = path.resolve(options.ingressRoot ?? defaultIngressRoot());
  const directories = ingressDirectories(root, source);
  ensureIngressDirectories(directories);
  const requestFile = path.join(directories.in, `arcadia-${createId("event")}.txt`);
  const attachmentDirectory = path.join(directories.attachments, path.parse(requestFile).name);
  mkdirSync(attachmentDirectory, { recursive: true });
  const selectedFiles = files.map((file) => path.basename(file));
  const attachmentFiles = files.map((file, index) => {
    const destination = path.join(attachmentDirectory, selectedFiles[index]!);
    copyFileSync(file, destination);
    return destination;
  });
  const textualContents = files
    .filter((file) => [".txt", ".md", ".markdown"].includes(path.extname(file).toLowerCase()))
    .map((file) => `\n\nCaptured file: ${path.basename(file)}\n\n${readFileSync(file, "utf8")}`)
    .join("");
  writeFileSync(
    requestFile,
    `${description}\n\nCaptured ingress Artifacts:\n${selectedFiles.map((file) => `- ${file}`).join("\n")}${textualContents}\n`,
    "utf8"
  );

  return createSuccess({
    command: "ingress.capture",
    workspace: workspacePath,
    data: { source, root, requestFile, selectedFiles, attachmentFiles, description },
    artifacts: [requestFile, ...attachmentFiles]
  });
}

export function runIngressProcessCommand(options: IngressProcessOptions): CommandSuccess<IngressProcessData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const source = options.source?.trim() || DEFAULT_INGRESS_SOURCE;
  validateSourceName(source);

  const root = path.resolve(options.ingressRoot ?? defaultIngressRoot());
  const directories = ingressDirectories(root, source);
  const dryRun = Boolean(options.dryRun);
  const executionMode = options.runSafe ? "run-safe" : "planned";
  const stableSeconds = options.stableSeconds ?? 30;
  if (!Number.isFinite(stableSeconds) || stableSeconds < 0) {
    throw validationError("Stable seconds must be a non-negative number.", { stableSeconds });
  }

  if (!dryRun) {
    ensureIngressDirectories(directories);
    stageRootIngressFiles(root, directories.in);
  }

  const candidates = listCandidates(
    directories.in,
    workspacePath,
    source,
    stableSeconds,
    !dryRun
  );
  const askRunner = options.askRunner ?? runAskCommand;
  const files = dryRun
    ? candidates.map((candidate) => dryRunResult(candidate))
    : candidates.map((candidate) => candidate.workflow
      ? processWorkflowCandidate({
          candidate,
          workspacePath,
          directories,
          source,
          runSafe: Boolean(options.runSafe)
        })
      : candidate.kind === "request"
      ? processCandidate({
          candidate,
          workspacePath,
          directories,
          source,
          executionMode,
          runSafe: Boolean(options.runSafe),
          askRunner
        })
      : processUnclassifiedCandidate({ candidate, directories, source, workspacePath })
      );

  return createSuccess({
    command: "ingress.process",
    workspace: workspacePath,
    data: {
      source,
      root,
      directories: {
        in: directories.in,
        processing: directories.processing,
        done: directories.done,
        failed: directories.failed,
        attachments: directories.attachments
      },
      executionMode,
      dryRun,
      files,
      counts: {
        discovered: candidates.length,
        processed: files.filter((file) => !["would_process", "pending"].includes(file.status)).length,
        succeeded: files.filter((file) => ["processed", "preserved"].includes(file.status)).length,
        failed: files.filter((file) => file.status === "failed").length,
        skipped: files.filter((file) => file.status === "skipped_empty").length,
        pending: files.filter((file) => file.status === "pending").length
      }
    },
    artifacts: files.flatMap((file) => [file.finalPath, file.sidecarPath, ...file.artifacts].filter(isString))
  });
}

/**
 * Accept files saved directly into ArcadiaIngress as an alternate mobile
 * handoff. The normal source inbox remains the single processing queue.
 */
export function stageRootIngressFiles(root: string, inboxPath: string): string[] {
  if (!existsSync(root)) return [];
  const staged: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name.startsWith(".")) continue;
    const sourcePath = path.join(root, entry.name);
    staged.push(moveToUnique(sourcePath, path.join(inboxPath, entry.name)));
  }
  return staged;
}

export function renderIngressProcessSuccess(response: CommandSuccess<IngressProcessData>): string[] {
  const { data } = response;
  const lines = [
    `Ingress source: ${data.source}`,
    `Input: ${data.directories.in}`,
    `Mode: ${data.executionMode}`,
    `Dry run: ${data.dryRun ? "yes" : "no"}`,
    `Discovered: ${data.counts.discovered}`,
    `Processed: ${data.counts.processed}`,
    `Pending: ${data.counts.pending}`,
    `Skipped: ${data.counts.skipped}`,
    `Failed: ${data.counts.failed}`
  ];

  for (const file of data.files) {
    lines.push(`- ${path.basename(file.file)}: ${file.status}${file.failureReason ? ` (${file.failureReason})` : ""}`);
  }

  return lines;
}

function processCandidate(input: {
  candidate: CandidateFile;
  workspacePath: string;
  directories: IngressDirectories;
  source: string;
  executionMode: "planned" | "run-safe";
  runSafe: boolean;
  askRunner: (options: AskOptions) => CommandSuccess<AskCommandData>;
}): IngressFileResult {
  const { candidate, workspacePath, directories, source, executionMode, runSafe, askRunner } = input;
  const originalPath = candidate.absolutePath;
  const processingPath = moveToUnique(originalPath, path.join(directories.processing, candidate.fileName));
  let currentPath = processingPath;

  const request = readFileSync(currentPath, "utf8").trim();
  if (!request) {
    const finalPath = moveToUnique(currentPath, path.join(directories.done, candidate.fileName));
    currentPath = finalPath;
    const sidecarPath = sidecarPathFor(finalPath, "response");
    writeJson(sidecarPath, {
      status: "skipped_empty",
      source,
      sourcePath: originalPath,
      finalPath,
      processedAt: nowIso(),
      executionMode,
      requestText: "",
      artifacts: []
    });
    return {
      file: originalPath,
      status: "skipped_empty",
      finalPath,
      sidecarPath,
      artifacts: []
    };
  }

  try {
    const response = askRunner({
      workspace: workspacePath,
      request,
      runSafe,
      sourceIngress: `ingress:${source}`,
      adapterMetadata: {
        ingressSource: source,
        fileName: candidate.fileName,
        sourcePath: originalPath,
        sharedArtifactPaths: candidate.sharedArtifactPaths
      },
      captureAsIdea: isIdeaMarkdownCandidate(candidate, request)
    });
    const sharedArtifactPaths = recordSharedArtifacts(workspacePath, candidate.sharedArtifactPaths, response);
    const runStatus = response.data.run?.status ?? null;
    const failedRun = runStatus === "failed";
    const destinationRoot = failedRun
      ? directories.failed
      : (response.data.backBurnerItemId || isMarkdownCandidate(candidate))
      ? path.join(directories.done, "Ideas")
      : directories.done;
    const finalPath = moveToUnique(
      currentPath,
      path.join(destinationRoot, candidate.fileName)
    );
    currentPath = finalPath;
    const curated = failedRun ? null : curateIngressMemory({
      workspacePath,
      source,
      sourcePath: originalPath,
      finalPath,
      request,
      candidate,
      response
    });
    const sidecarPath = sidecarPathFor(finalPath, failedRun ? "error" : "response");
    const failureReason = failedRun ? `Run failed: ${response.data.run?.summary ?? response.data.run?.id}` : undefined;
    const missionLogPath = writeIngressMissionLog(workspacePath, {
      sourcePath: originalPath,
      request,
      executionMode,
      response,
      sharedArtifactPaths,
      status: failedRun ? "failed" : "processed",
      failureReason,
      sidecarPath
    });

    writeJson(sidecarPath, {
      status: failedRun ? "failed" : "processed",
      source,
      sourcePath: originalPath,
      finalPath,
      processedAt: nowIso(),
      executionMode,
      requestText: request,
      response,
      runId: response.data.run?.id ?? null,
      artifacts: [...response.artifacts, ...sharedArtifactPaths],
      missionLogPath,
      memoryNotePath: curated?.notePath ?? null,
      failureReason: failureReason ?? null
    });

    return {
      file: originalPath,
      status: failedRun ? "failed" : "processed",
      requestPreview: preview(request),
      finalPath,
      sidecarPath,
      askId: response.data.ask?.id,
      workItemId: response.data.workItem?.id,
      planId: response.data.plan?.id,
      runId: response.data.run?.id,
      artifacts: [...response.artifacts, ...sharedArtifactPaths, path.join(workspacePath, missionLogPath), ...(curated ? [curated.notePath] : [])],
      failureReason
    };
  } catch (error) {
    const normalized = normalizeError(error);
    const sharedArtifactPaths = recordSharedArtifacts(workspacePath, candidate.sharedArtifactPaths);
    const finalPath = existsSync(currentPath)
      ? moveToUnique(currentPath, path.join(directories.failed, candidate.fileName))
      : path.join(directories.failed, candidate.fileName);
    currentPath = finalPath;
    const sidecarPath = sidecarPathFor(finalPath, "error");
    const failure: CommandFailure = {
      ok: false,
      command: "ingress.process",
      workspace: workspacePath,
      error: {
        code: normalized.code,
        message: normalized.message,
        details: normalized.details
      }
    };
    const missionLogPath = writeIngressMissionLog(workspacePath, {
      sourcePath: originalPath,
      request,
      executionMode,
      sharedArtifactPaths,
      status: "failed",
      failureReason: normalized.message,
      sidecarPath
    });

    writeJson(sidecarPath, {
      status: "failed",
      source,
      sourcePath: originalPath,
      finalPath,
      processedAt: nowIso(),
      executionMode,
      requestText: request,
      error: failure.error,
      artifacts: [...sharedArtifactPaths, path.join(workspacePath, missionLogPath)],
      missionLogPath
    });

    return {
      file: originalPath,
      status: "failed",
      requestPreview: preview(request),
      finalPath,
      sidecarPath,
      artifacts: [...sharedArtifactPaths, path.join(workspacePath, missionLogPath)],
      failureReason: normalized.message
    };
  }
}

function processUnclassifiedCandidate(input: {
  candidate: CandidateFile;
  workspacePath: string;
  directories: IngressDirectories;
  source: string;
}): IngressFileResult {
  const { candidate, directories, source } = input;
  const originalPath = candidate.absolutePath;
  if (!candidate.stable) {
    return {
      file: originalPath,
      status: "pending",
      artifacts: [],
      failureReason: "Waiting for the file size and modification time to settle."
    };
  }
  try {
    const processingPath = moveToUnique(originalPath, path.join(directories.processing, candidate.fileName));
    const finalPath = moveToUnique(processingPath, path.join(directories.done, "Unclassified", candidate.fileName));
    const sidecarPath = sidecarPathFor(finalPath, "response");
    const reason = "No deterministic text or configured Workflow handler matched this file; preserved as an unclassified Artifact.";
    writeJson(sidecarPath, {
      status: "preserved_unclassified",
      source,
      sourcePath: originalPath,
      finalPath,
      processedAt: nowIso(),
      kind: ingressFileKind(candidate.fileName),
      mimeType: ingressMimeType(candidate.fileName),
      reason,
      artifacts: []
    });
    withDatabase(input.workspacePath, (db) => {
      createArtifactRecord(db, {
        projectId: null,
        workItemId: null,
        title: candidate.fileName,
        artifactType: statSync(finalPath).isDirectory() ? "shared_folder" : "shared_file",
        status: "ready",
        path: finalPath
      });
    });
    return {
      file: originalPath,
      status: "preserved",
      finalPath,
      sidecarPath,
      artifacts: [finalPath]
    };
  } catch (error) {
    const normalized = normalizeError(error);
    const finalPath = existsSync(originalPath)
      ? moveToUnique(originalPath, path.join(directories.failed, candidate.fileName))
      : path.join(directories.failed, candidate.fileName);
    const sidecarPath = sidecarPathFor(finalPath, "error");
    writeJson(sidecarPath, {
      status: "failed",
      source,
      sourcePath: originalPath,
      finalPath,
      processedAt: nowIso(),
      error: normalized,
      artifacts: []
    });
    return {
      file: originalPath,
      status: "failed",
      finalPath,
      sidecarPath,
      artifacts: [],
      failureReason: normalized.message
    };
  }
}

function curateIngressMemory(input: {
  workspacePath: string;
  source: string;
  sourcePath: string;
  finalPath: string;
  request: string;
  candidate: CandidateFile;
  response: CommandSuccess<AskCommandData>;
}): { notePath: string } | null {
  const { response } = input;
  const projectId = response.data.workItem?.project_id ?? response.data.project?.id ?? null;
  const project = projectId ? withDatabase(input.workspacePath, (db) => getProject(db, projectId)) : null;
  const title = ingressTitle(input.request, input.candidate.fileName);
  const classification = response.data.intake?.classification ?? "CapturedThought";
  const status = response.data.backBurnerItemId ? "back_burner" : response.data.result?.status ?? "captured";
  const tags = ingressTags(`${title}\n${input.request}`, project?.name ?? null, Boolean(response.data.backBurnerItemId));
  const note = writeIngressMemoryNote(input.workspacePath, {
    title,
    content: input.request,
    source: input.source,
    sourcePath: input.sourcePath,
    finalPath: input.finalPath,
    capturedAt: nowIso(),
    classification,
    status,
    tags,
    askId: response.data.ask?.id ?? null,
    backBurnerItemId: response.data.backBurnerItemId ?? null,
    projectId,
    projectName: project?.name ?? response.data.project?.name ?? null,
    actionId: response.data.workItem?.id ?? null,
    actionTitle: response.data.workItem?.title ?? null,
    nextAction: response.data.workItem?.next_action ?? response.data.intake?.suggestedNextStep ?? null
  });
  return note ? { notePath: note.notePath } : null;
}

function ingressTitle(content: string, fileName: string): string {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading.replace(/^app idea:\s*/i, "").trim();
  const firstLine = content.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  return firstLine ? preview(firstLine) : path.parse(fileName).name;
}

function ingressTags(content: string, projectName: string | null, isIdea: boolean): string[] {
  const lower = content.toLowerCase();
  const tags = ["arcadia/ingress", isIdea ? "arcadia/idea" : "arcadia/capture"];
  if (/\b(guitar|music|song|songs|repertoire|chord|melody|practice)\b/.test(lower)) tags.push("domain/music");
  if (/\b(guitar)\b/.test(lower)) tags.push("topic/guitar");
  if (/\b(repertoire|song|songs|songbook)\b/.test(lower)) tags.push("topic/repertoire");
  if (/\b(app|ipad|iphone|software|product|platform)\b/.test(lower)) tags.push("topic/app-idea");
  if (projectName) tags.push(`project/${projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`);
  return [...new Set(tags)];
}

function isMarkdownCandidate(candidate: CandidateFile): boolean {
  return [".md", ".markdown"].includes(path.extname(candidate.fileName).toLowerCase());
}

function isIdeaMarkdownCandidate(candidate: CandidateFile, content: string): boolean {
  if (!isMarkdownCandidate(candidate) && candidate.kind !== "request") return false;
  return /^#\s+app idea:/im.test(content) || (/^##\s+metadata/im.test(content) && /working name/i.test(content));
}

function processWorkflowCandidate(input: {
  candidate: CandidateFile;
  workspacePath: string;
  directories: IngressDirectories;
  source: string;
  runSafe: boolean;
}): IngressFileResult {
  const { candidate, workspacePath, directories, source, runSafe } = input;
  const workflow = candidate.workflow as WorkflowDefinition;
  if (!candidate.stable) {
    return {
      file: candidate.absolutePath,
      status: "pending",
      workflowId: workflow.id,
      artifacts: [],
      failureReason: "Waiting for the recording size and modification time to settle."
    };
  }
  if (!runSafe || !workflow.action.safeToRunAutomatically) {
    return {
      file: candidate.absolutePath,
      status: "pending",
      workflowId: workflow.id,
      artifacts: [],
      failureReason: runSafe
        ? "The matched workflow is not marked safe to run automatically."
        : "Matched workflow is ready; pass --run-safe to execute it."
    };
  }

  const claimPath = path.join(directories.in, `.processing-${candidate.fileName}.lock`);
  try {
    writeFileSync(claimPath, `${JSON.stringify({ pid: process.pid, claimedAt: nowIso(), workflowId: workflow.id })}\n`, {
      encoding: "utf8",
      flag: "wx"
    });
  } catch {
    return {
      file: candidate.absolutePath,
      status: "pending",
      workflowId: workflow.id,
      artifacts: [],
      failureReason: "Recording is already claimed by another Arcadia worker."
    };
  }

  let currentPath = candidate.absolutePath;
  try {
    currentPath = moveToUnique(currentPath, path.join(directories.processing, candidate.fileName));
    const run = runWorkflow({ workspace: workspacePath, workflow, inputPath: currentPath });
    const succeeded = run.status === "completed" || run.status === "already_completed";
    const finalPath = moveToUnique(
      currentPath,
      path.join(succeeded ? directories.done : directories.failed, candidate.fileName)
    );
    currentPath = finalPath;
    const sidecarPath = sidecarPathFor(finalPath, succeeded ? "response" : "error");
    const artifacts = [
      run.runManifestPath,
      run.stdoutLogPath,
      run.stderrLogPath,
      run.destinationDirectory,
      ...run.files.map((file) => file.destinationPath)
    ].filter(isString);
    writeJson(sidecarPath, {
      status: succeeded ? "processed" : "failed",
      source,
      sourcePath: candidate.absolutePath,
      finalPath,
      processedAt: nowIso(),
      workflowId: workflow.id,
      runId: run.id,
      run,
      artifacts,
      failureReason: run.failureReason
    });
    if (succeeded) {
      recordWorkflowRunArtifacts(workspacePath, workflow, run, finalPath);
    }
    return {
      file: candidate.absolutePath,
      status: succeeded ? "processed" : "failed",
      finalPath,
      sidecarPath,
      runId: run.id,
      workflowId: workflow.id,
      artifacts,
      failureReason: run.failureReason ?? undefined
    };
  } catch (error) {
    const normalized = normalizeError(error);
    const finalPath = existsSync(currentPath)
      ? moveToUnique(currentPath, path.join(directories.failed, candidate.fileName))
      : path.join(directories.failed, candidate.fileName);
    const sidecarPath = sidecarPathFor(finalPath, "error");
    writeJson(sidecarPath, {
      status: "failed",
      source,
      sourcePath: candidate.absolutePath,
      finalPath,
      processedAt: nowIso(),
      workflowId: workflow.id,
      error: normalized,
      artifacts: []
    });
    return {
      file: candidate.absolutePath,
      status: "failed",
      finalPath,
      sidecarPath,
      workflowId: workflow.id,
      artifacts: [],
      failureReason: normalized.message
    };
  } finally {
    if (existsSync(claimPath)) unlinkSync(claimPath);
  }
}

function writeIngressMissionLog(
  workspacePath: string,
  input: {
    sourcePath: string;
    request: string;
    executionMode: "planned" | "run-safe";
    status: "processed" | "failed";
    sidecarPath: string;
    sharedArtifactPaths?: string[];
    failureReason?: string;
    response?: CommandSuccess<AskCommandData>;
  }
): string {
  const projectId = input.response?.data.workItem?.project_id ?? input.response?.data.project?.id ?? null;
  const milestoneId = input.response?.data.workItem?.milestone_id ?? null;
  const project = projectId ? withDatabase(workspacePath, (db) => getProject(db, projectId)) : null;
  const milestone = milestoneId ? withDatabase(workspacePath, (db) => getMilestone(db, milestoneId)) : null;
  const logId = createId("missionLog");
  const markdownPath = buildMissionLogRelativePath(workspacePath, project?.name ?? "ingress", logId);
  const artifacts = [
    ...(input.response?.artifacts ?? []),
    ...(input.sharedArtifactPaths ?? []),
    input.sidecarPath
  ];
  const missionLog = withDatabase(workspacePath, (db) =>
    createMissionLog(db, {
      id: logId,
      projectId,
      milestoneId,
      workPerformed: [
        `Ingested local request file: ${input.sourcePath}`,
        "",
        "Request:",
        input.request,
        "",
        `Execution mode: ${input.executionMode}`,
        `Ask id: ${input.response?.data.ask?.id ?? "None"}`,
        `Action id: ${input.response?.data.workItem?.id ?? "None"}`,
        `Plan id: ${input.response?.data.plan?.id ?? "None"}`,
        `Run id: ${input.response?.data.run?.id ?? "None"}`
      ].join("\n"),
      result: input.status === "processed"
        ? "Ingress request processed through arcadia ask."
        : `Ingress request failed: ${input.failureReason ?? "Unknown failure."}`,
      blockers: input.status === "failed" ? input.failureReason ?? "Review the failed ingress sidecar." : "",
      nextAction: input.status === "failed"
        ? "Review the failed ingress sidecar and source file."
        : input.response?.data.workItem?.next_action ?? input.response?.data.result.summary ?? "Review the Arcadia ask result.",
      artifactImpact: artifacts.join(", "),
      markdownPath
    })
  );
  writeMissionLogMarkdown(workspacePath, { missionLog, project, milestone });
  return missionLog.markdown_path;
}

function dryRunResult(candidate: CandidateFile): IngressFileResult {
  if (candidate.workflow) {
    return {
      file: candidate.absolutePath,
      status: "would_process",
      requestPreview: `Run workflow ${candidate.workflow.id}`,
      workflowId: candidate.workflow.id,
      artifacts: []
    };
  }
  const request = candidate.kind === "unclassified"
    ? `Preserve as unclassified Artifact (${ingressMimeType(candidate.fileName)}).`
    : readFileSync(candidate.absolutePath, "utf8").trim();
  return {
    file: candidate.absolutePath,
    status: "would_process",
    requestPreview: preview(request),
    artifacts: candidate.sharedArtifactPaths
  };
}

function listCandidates(
  inboxPath: string,
  workspacePath: string,
  source: string,
  stableSeconds: number,
  persistObservations: boolean
): CandidateFile[] {
  if (!existsSync(inboxPath)) {
    return [];
  }

  const statePath = path.join(path.dirname(inboxPath), ".workflow-stability.json");
  const observations = readStabilityObservations(statePath);
  const nextObservations: Record<string, StabilityObservation> = {};
  const now = Date.now();
  const candidates = readdirSync(inboxPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith(".processing-"))
    .map((entry) => {
      const absolutePath = path.join(inboxPath, entry.name);
      const isRequest = [".txt", ".md", ".markdown"].includes(path.extname(entry.name).toLowerCase());
      const workflow = isRequest
        ? null
        : matchWorkflowDefinition(workspacePath, absolutePath, source);
      const stats = statSync(absolutePath);
      const previous = observations[entry.name];
      const unchanged = Boolean(previous && previous.size === stats.size && previous.mtimeMs === stats.mtimeMs);
      const observation = unchanged
        ? previous
        : { size: stats.size, mtimeMs: stats.mtimeMs, observedAtMs: now };
      nextObservations[entry.name] = observation as StabilityObservation;
      return {
        absolutePath,
        fileName: entry.name,
        mtimeMs: stats.mtimeMs,
        sharedArtifactPaths: isRequest && path.extname(entry.name).toLowerCase() === ".txt"
          ? listSharedArtifactPaths(inboxPath, entry.name)
          : [],
        workflow,
        kind: workflow ? "workflow" : isRequest ? "request" : "unclassified",
        stable: isRequest || stableSeconds === 0 || Boolean(unchanged && now - observation!.observedAtMs >= stableSeconds * 1000)
      };
    })
    .filter((candidate): candidate is CandidateFile => Boolean(candidate))
    .sort((left, right) => left.mtimeMs - right.mtimeMs || left.fileName.localeCompare(right.fileName));
  if (persistObservations) writeJson(statePath, nextObservations);
  return candidates;
}

function readStabilityObservations(filePath: string): Record<string, StabilityObservation> {
  if (!existsSync(filePath)) return {};
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as Record<string, StabilityObservation>;
  } catch {
    return {};
  }
}

function ingressDirectories(root: string, source: string): IngressDirectories {
  const sourceRoot = path.join(root, source);
  return {
    in: path.join(sourceRoot, "In"),
    processing: path.join(sourceRoot, "Processing"),
    done: path.join(sourceRoot, "Done"),
    failed: path.join(sourceRoot, "Failed"),
    attachments: path.join(sourceRoot, "Attachments")
  };
}

export function defaultIngressRoot(home = homedir()): string {
  return path.join(home, "Library", "Mobile Documents", "com~apple~CloudDocs", "ArcadiaIngress");
}

function ingressFileKind(fileName: string): IngressListFile["kind"] {
  const extension = path.extname(fileName).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic", ".heif", ".tif", ".tiff", ".bmp"].includes(extension)) {
    return "image";
  }
  if ([".mp4", ".mov", ".m4v", ".webm", ".avi"].includes(extension)) {
    return "video";
  }
  if ([".mp3", ".m4a", ".wav", ".aac", ".flac", ".ogg"].includes(extension)) {
    return "audio";
  }
  if ([".txt", ".md", ".json", ".yaml", ".yml", ".pdf", ".doc", ".docx"].includes(extension)) {
    return "document";
  }
  return "other";
}

function ingressMimeType(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();
  const types: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".m4v": "video/x-m4v",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".wav": "audio/wav",
    ".pdf": "application/pdf",
    ".json": "application/json",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8"
  };
  return types[extension] ?? "application/octet-stream";
}

function ensureIngressDirectories(directories: IngressDirectories): void {
  mkdirSync(directories.in, { recursive: true });
  mkdirSync(directories.processing, { recursive: true });
  mkdirSync(directories.done, { recursive: true });
  mkdirSync(directories.failed, { recursive: true });
  mkdirSync(directories.attachments, { recursive: true });
}

function listSharedArtifactPaths(inboxPath: string, requestFileName: string): string[] {
  const sourceRoot = path.dirname(inboxPath);
  const attachmentDirectory = path.join(sourceRoot, "Attachments", path.parse(requestFileName).name);
  if (!existsSync(attachmentDirectory) || !statSync(attachmentDirectory).isDirectory()) {
    return [];
  }
  return readdirSync(attachmentDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() || entry.isDirectory())
    .map((entry) => path.join(attachmentDirectory, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function recordSharedArtifacts(
  workspacePath: string,
  sharedArtifactPaths: string[],
  response?: CommandSuccess<AskCommandData>
): string[] {
  if (sharedArtifactPaths.length === 0) {
    return [];
  }
  const projectId = response?.data.workItem?.project_id ?? response?.data.project?.id ?? null;
  const workItemId = response?.data.workItem?.id ?? null;
  withDatabase(workspacePath, (db) => {
    for (const artifactPath of sharedArtifactPaths) {
      createArtifactRecord(db, {
        projectId,
        workItemId,
        title: path.basename(artifactPath),
        artifactType: statSync(artifactPath).isDirectory() ? "shared_folder" : "shared_file",
        status: "ready",
        path: artifactPath
      });
    }
  });
  return sharedArtifactPaths;
}

function validateSourceName(source: string): void {
  if (source.includes("/") || source.includes("\\") || source === "." || source === "..") {
    throw validationError("Ingress source must be a simple folder name.", { source });
  }
}

function moveToUnique(fromPath: string, desiredPath: string): string {
  mkdirSync(path.dirname(desiredPath), { recursive: true });
  const destination = uniquePath(desiredPath);
  renameSync(fromPath, destination);
  return destination;
}

function uniquePath(desiredPath: string): string {
  if (!existsSync(desiredPath)) {
    return desiredPath;
  }

  const parsed = path.parse(desiredPath);
  for (let index = 1; ; index += 1) {
    const candidate = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
    if (!existsSync(candidate)) {
      return candidate;
    }
  }
}

function sidecarPathFor(finalPath: string, kind: "response" | "error"): string {
  const parsed = path.parse(finalPath);
  return path.join(parsed.dir, `${parsed.name}.${kind}.json`);
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function preview(value: string): string {
  return value.length > 120 ? `${value.slice(0, 117)}...` : value;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
