import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
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

export const DEFAULT_INGRESS_SOURCE = "iCloudIdeas";

export interface IngressProcessOptions {
  workspace: string;
  source?: string;
  runSafe?: boolean;
  dryRun?: boolean;
  ingressRoot?: string;
  askRunner?: (options: AskOptions) => CommandSuccess<AskCommandData>;
}

export interface IngressFileResult {
  file: string;
  status: "would_process" | "processed" | "skipped_empty" | "failed";
  requestPreview?: string;
  finalPath?: string;
  sidecarPath?: string;
  askId?: string;
  workItemId?: string;
  planId?: string;
  runId?: string;
  artifacts: string[];
  failureReason?: string;
}

export interface IngressProcessData {
  source: string;
  root: string;
  directories: {
    in: string;
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
  };
}

interface IngressDirectories {
  in: string;
  done: string;
  failed: string;
  attachments: string;
}

interface CandidateFile {
  absolutePath: string;
  fileName: string;
  mtimeMs: number;
  sharedArtifactPaths: string[];
}

export function runIngressProcessCommand(options: IngressProcessOptions): CommandSuccess<IngressProcessData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const source = options.source?.trim() || DEFAULT_INGRESS_SOURCE;
  validateSourceName(source);

  const root = path.resolve(options.ingressRoot ?? path.join(homedir(), "ArcadiaIngress"));
  const directories = ingressDirectories(root, source);
  const dryRun = Boolean(options.dryRun);
  const executionMode = options.runSafe ? "run-safe" : "planned";

  if (!dryRun) {
    ensureIngressDirectories(directories);
  }

  const candidates = listCandidates(directories.in);
  const askRunner = options.askRunner ?? runAskCommand;
  const files = dryRun
    ? candidates.map((candidate) => dryRunResult(candidate))
    : candidates.map((candidate) =>
        processCandidate({
          candidate,
          workspacePath,
          directories,
          source,
          executionMode,
          runSafe: Boolean(options.runSafe),
          askRunner
        })
      );

  return createSuccess({
    command: "ingress.process",
    workspace: workspacePath,
    data: {
      source,
      root,
      directories: {
        in: directories.in,
        done: directories.done,
        failed: directories.failed,
        attachments: directories.attachments
      },
      executionMode,
      dryRun,
      files,
      counts: {
        discovered: candidates.length,
        processed: files.filter((file) => file.status !== "would_process").length,
        succeeded: files.filter((file) => file.status === "processed").length,
        failed: files.filter((file) => file.status === "failed").length,
        skipped: files.filter((file) => file.status === "skipped_empty").length
      }
    },
    artifacts: files.flatMap((file) => [file.finalPath, file.sidecarPath, ...file.artifacts].filter(isString))
  });
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
  const processingPath = path.join(
    directories.in,
    `.processing-${path.parse(candidate.fileName).name}-${Date.now()}-${process.pid}.txt`
  );
  renameSync(originalPath, processingPath);
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
      }
    });
    const sharedArtifactPaths = recordSharedArtifacts(workspacePath, candidate.sharedArtifactPaths, response);
    const runStatus = response.data.run?.status ?? null;
    const failedRun = runStatus === "failed";
    const finalPath = moveToUnique(
      currentPath,
      path.join(failedRun ? directories.failed : directories.done, candidate.fileName)
    );
    currentPath = finalPath;
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
      artifacts: [...response.artifacts, ...sharedArtifactPaths, path.join(workspacePath, missionLogPath)],
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
  const request = readFileSync(candidate.absolutePath, "utf8").trim();
  return {
    file: candidate.absolutePath,
    status: "would_process",
    requestPreview: preview(request),
    artifacts: candidate.sharedArtifactPaths
  };
}

function listCandidates(inboxPath: string): CandidateFile[] {
  if (!existsSync(inboxPath)) {
    return [];
  }

  return readdirSync(inboxPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".txt") && !entry.name.startsWith(".processing-"))
    .map((entry) => {
      const absolutePath = path.join(inboxPath, entry.name);
      return {
        absolutePath,
        fileName: entry.name,
        mtimeMs: statSync(absolutePath).mtimeMs,
        sharedArtifactPaths: listSharedArtifactPaths(inboxPath, entry.name)
      };
    })
    .sort((left, right) => left.mtimeMs - right.mtimeMs || left.fileName.localeCompare(right.fileName));
}

function ingressDirectories(root: string, source: string): IngressDirectories {
  const sourceRoot = path.join(root, source);
  return {
    in: path.join(sourceRoot, "In"),
    done: path.join(sourceRoot, "Done"),
    failed: path.join(sourceRoot, "Failed"),
    attachments: path.join(sourceRoot, "Attachments")
  };
}

function ensureIngressDirectories(directories: IngressDirectories): void {
  mkdirSync(directories.in, { recursive: true });
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
