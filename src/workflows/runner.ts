import {
  copyFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync
} from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { validationError } from "../cli/errors.js";
import { createId } from "../utils/id.js";
import { nowIso } from "../utils/time.js";
import type { WorkflowDefinition, WorkflowPublishedFile, WorkflowRunRecord } from "./types.js";

export interface RunWorkflowOptions {
  workspace: string;
  workflow: WorkflowDefinition;
  inputPath: string;
  dryRun?: boolean;
  destinationRoot?: string;
}

export function runWorkflow(options: RunWorkflowOptions): WorkflowRunRecord {
  const workspace = path.resolve(options.workspace);
  const inputPath = path.resolve(options.inputPath);
  assertInput(options.workflow, inputPath);
  const inputSha256 = sha256File(inputPath);
  const recordingDate = recordingDateFor(inputPath);
  const templateValues = buildTemplateValues(inputPath, recordingDate);
  const destinationRoot = expandHome(options.destinationRoot ?? options.workflow.publication.destinationRoot);
  const destinationDirectory = path.join(
    destinationRoot,
    expandTemplate(options.workflow.publication.directoryTemplate, templateValues)
  );
  const command = {
    executable: expandHome(options.workflow.action.executable),
    arguments: options.workflow.action.arguments.map((argument) => expandTemplate(argument, templateValues)),
    workingDirectory: expandTemplate(options.workflow.action.workingDirectory, templateValues)
  };
  const startedAt = nowIso();

  if (options.dryRun) {
    return {
      schemaVersion: 1,
      id: "dry-run",
      workflowId: options.workflow.id,
      workflowName: options.workflow.name,
      status: "would_run",
      inputPath,
      inputSha256,
      recordingDate,
      currentStep: "planned",
      startedAt,
      completedAt: startedAt,
      durationMs: 0,
      command,
      exitStatus: null,
      signal: null,
      stdoutLogPath: null,
      stderrLogPath: null,
      runManifestPath: null,
      sourceOutputDirectory: expandTemplate(options.workflow.output.directory, templateValues),
      destinationDirectory,
      files: [],
      statusMessage: "Workflow validated; no executable was invoked and no files were written.",
      mostRecentOutput: null,
      failureReason: null,
      recommendedRecoveryAction: null,
      retryable: false
    };
  }

  const priorRuns = listWorkflowRuns(workspace, options.workflow.id).filter((record) => record.inputSha256 === inputSha256);
  const existing = priorRuns.find((record) => record.status === "completed") ?? null;
  if (existing) {
    return {
      ...existing,
      status: "already_completed",
      statusMessage: `Recording already completed in Run ${existing.id}; no files were copied.`,
      retryable: false
    };
  }
  const priorAttempts = priorRuns.filter((record) => record.status === "failed").length;
  if (priorAttempts >= options.workflow.retry.maxAttempts) {
    throw validationError("Workflow retry limit has been reached for this recording.", {
      workflowId: options.workflow.id,
      inputSha256,
      priorAttempts,
      maxAttempts: options.workflow.retry.maxAttempts,
      recoveryAction: "Inspect prior Run Logs and intentionally change the workflow retry policy after correcting the failure."
    });
  }

  if (!existsSync(command.executable)) {
    throw validationError("Workflow executable does not exist.", { executable: command.executable });
  }
  if (!existsSync(command.workingDirectory)) {
    throw validationError("Workflow working directory does not exist.", { workingDirectory: command.workingDirectory });
  }

  const id = createId("executionRun");
  const artifactDirectory = path.join(workspace, "artifacts", "workflow-runs", id);
  const stdoutLogPath = path.join(artifactDirectory, "stdout.log");
  const stderrLogPath = path.join(artifactDirectory, "stderr.log");
  const runManifestPath = path.join(artifactDirectory, "run.json");
  mkdirSync(artifactDirectory, { recursive: true });

  let record: WorkflowRunRecord = {
    schemaVersion: 1,
    id,
    workflowId: options.workflow.id,
    workflowName: options.workflow.name,
    status: "running",
    inputPath,
    inputSha256,
    recordingDate,
    currentStep: "extracting",
    startedAt,
    completedAt: null,
    durationMs: null,
    command,
    exitStatus: null,
    signal: null,
    stdoutLogPath,
    stderrLogPath,
    runManifestPath,
    sourceOutputDirectory: null,
    destinationDirectory,
    files: [],
    statusMessage: "Running configured extraction Action.",
    mostRecentOutput: null,
    failureReason: null,
    recommendedRecoveryAction: null,
    retryable: false
  };
  writeRunRecord(runManifestPath, record);

  try {
    const result = spawnSync(command.executable, command.arguments, {
      cwd: command.workingDirectory,
      encoding: "utf8",
      timeout: options.workflow.action.timeoutSeconds * 1000,
      maxBuffer: 32 * 1024 * 1024,
      shell: false
    });
    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";
    writeFileSync(stdoutLogPath, stdout, "utf8");
    writeFileSync(stderrLogPath, stderr, "utf8");
    record.exitStatus = result.status;
    record.signal = result.signal;
    record.mostRecentOutput = latestUsefulOutput(stdout, stderr);

    if (result.error || result.status !== 0) {
      const reason = result.error?.message ?? `Extraction Action exited with status ${result.status ?? "unknown"}.`;
      throw new WorkflowRunFailure(reason);
    }

    record.currentStep = "publishing";
    record.statusMessage = "Extraction completed; verifying and publishing MP3 Artifacts.";
    writeRunRecord(runManifestPath, record);

    const sourceOutputDirectory = findCollectedDirectory(
      stdout,
      options.workflow,
      templateValues,
      command.workingDirectory
    );
    record.sourceOutputDirectory = sourceOutputDirectory;
    const sourceFiles = listMp3Files(sourceOutputDirectory);
    if (sourceFiles.length === 0) {
      throw new WorkflowRunFailure(`No MP3 files matched ${options.workflow.output.expectedPattern}.`);
    }
    if (!existsSync(destinationRoot)) {
      throw new WorkflowRunFailure(`Google Drive Desktop root is unavailable: ${destinationRoot}`);
    }
    mkdirSync(destinationDirectory, { recursive: true });
    record.files = sourceFiles.map((sourcePath) => publishFile(
      sourcePath,
      destinationDirectory,
      options.workflow,
      templateValues,
      id
    ));

    const completedAt = nowIso();
    record = {
      ...record,
      status: "completed",
      currentStep: "completed",
      completedAt,
      durationMs: new Date(completedAt).getTime() - new Date(startedAt).getTime(),
      statusMessage: `Published ${record.files.length} MP3 Artifacts to ${destinationDirectory}.`,
      failureReason: null,
      recommendedRecoveryAction: null,
      retryable: false
    };
    writeRunRecord(runManifestPath, record);
    return record;
  } catch (error) {
    const completedAt = nowIso();
    const reason = error instanceof Error ? error.message : String(error);
    record = {
      ...record,
      status: "failed",
      currentStep: "failed",
      completedAt,
      durationMs: new Date(completedAt).getTime() - new Date(startedAt).getTime(),
      statusMessage: `Workflow failed: ${reason}`,
      failureReason: reason,
      recommendedRecoveryAction: "Inspect the raw stdout/stderr Logs, correct the failure, then run the same workflow again.",
      retryable: true
    };
    writeRunRecord(runManifestPath, record);
    return record;
  }
}

export function listWorkflowRuns(workspace: string, workflowId?: string): WorkflowRunRecord[] {
  const root = path.join(path.resolve(workspace), "artifacts", "workflow-runs");
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readRunRecord(path.join(root, entry.name, "run.json")))
    .filter((record): record is WorkflowRunRecord => Boolean(record))
    .filter((record) => !workflowId || record.workflowId === workflowId)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

export function getWorkflowRun(workspace: string, runId: string): WorkflowRunRecord {
  const runPath = path.join(path.resolve(workspace), "artifacts", "workflow-runs", runId, "run.json");
  const record = readRunRecord(runPath);
  if (!record) throw validationError("Workflow Run was not found.", { runId });
  return record;
}

function assertInput(workflow: WorkflowDefinition, inputPath: string): void {
  if (!existsSync(inputPath) || !statSync(inputPath).isFile()) {
    throw validationError("Workflow input file does not exist.", { inputPath });
  }
  const extension = path.extname(inputPath).toLowerCase();
  if (!workflow.match.extensions.map((value) => value.toLowerCase()).includes(extension)) {
    throw validationError("Workflow does not accept this input extension.", {
      inputPath,
      extension,
      acceptedExtensions: workflow.match.extensions
    });
  }
}

function readRunRecord(filePath: string): WorkflowRunRecord | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as WorkflowRunRecord;
  } catch {
    return null;
  }
}

function writeRunRecord(filePath: string, record: WorkflowRunRecord): void {
  writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

function findCollectedDirectory(
  stdout: string,
  workflow: WorkflowDefinition,
  values: Record<string, string>,
  workingDirectory: string
): string {
  const prefix = workflow.output.collectedPathPrefix;
  for (const line of stdout.split(/\r?\n/).reverse()) {
    const index = line.indexOf(prefix);
    if (index === -1) continue;
    const rest = line.slice(index + prefix.length).trim();
    const arrowIndex = rest.indexOf("→");
    const reported = (arrowIndex === -1 ? rest : rest.slice(arrowIndex + 1)).trim();
    if (!reported) continue;
    const resolved = path.resolve(workingDirectory, expandHome(reported));
    if (existsSync(resolved) && statSync(resolved).isDirectory()) return resolved;
  }

  const outputRoot = path.resolve(expandTemplate(workflow.output.directory, values));
  const collected = findDirectoriesNamed(outputRoot, "collected");
  const matching = collected.filter((directory) => listMp3Files(directory).length > 0);
  if (matching.length === 0) {
    throw new WorkflowRunFailure(`Expected collected output directory was not found below ${outputRoot}.`);
  }
  matching.sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  return matching[0];
}

function findDirectoriesNamed(root: string, name: string): string[] {
  if (!existsSync(root) || !statSync(root).isDirectory()) return [];
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const child = path.join(root, entry.name);
    if (entry.name === name) found.push(child);
    else found.push(...findDirectoriesNamed(child, name));
  }
  return found;
}

function listMp3Files(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".mp3")
    .map((entry) => path.join(directory, entry.name))
    .sort((left, right) => path.basename(left).localeCompare(path.basename(right), undefined, { numeric: true }));
}

function publishFile(
  sourcePath: string,
  destinationDirectory: string,
  workflow: WorkflowDefinition,
  baseValues: Record<string, string>,
  runId: string
): WorkflowPublishedFile {
  const parsed = path.parse(sourcePath);
  const values = {
    ...baseValues,
    sourceName: parsed.base,
    sourceStem: parsed.name,
    extension: parsed.ext
  };
  const expandedFileName = expandTemplate(workflow.publication.fileNameTemplate, values);
  const fileName = workflow.publication.fileNameTemplate === "{sourceName}"
    ? expandedFileName
    : sanitizeFileName(expandedFileName);
  const destinationPath = path.join(destinationDirectory, fileName);
  const sourceHash = sha256File(sourcePath);
  const size = statSync(sourcePath).size;
  if (existsSync(destinationPath)) {
    const matches = workflow.publication.verify === "sha256"
      ? sha256File(destinationPath) === sourceHash
      : statSync(destinationPath).size === size;
    if (!matches) {
      throw new WorkflowRunFailure(`Publication collision has different content: ${destinationPath}`);
    }
    return { sourcePath, destinationPath, size, sha256: sourceHash, copied: false };
  }
  const temporaryPath = path.join(destinationDirectory, `.arcadia-${runId}-${fileName}.tmp`);
  copyFileSync(sourcePath, temporaryPath);
  const verified = workflow.publication.verify === "sha256"
    ? sha256File(temporaryPath) === sourceHash
    : statSync(temporaryPath).size === size;
  if (!verified) throw new WorkflowRunFailure(`Copied file failed ${workflow.publication.verify} verification: ${fileName}`);
  renameSync(temporaryPath, destinationPath);
  return { sourcePath, destinationPath, size, sha256: sourceHash, copied: true };
}

function recordingDateFor(inputPath: string): string {
  const name = path.parse(inputPath).name;
  const monthPattern = "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec";
  let match = name.match(new RegExp(`\\b(20\\d{2})[ _-]+(${monthPattern})[ _-]+(\\d{1,2})\\b`, "i"));
  if (match) return validDate(Number(match[1]), monthNumber(match[2]), Number(match[3]), inputPath);
  match = name.match(new RegExp(`\\b(\\d{1,2})[ _-]+(${monthPattern})[ _-]+(20\\d{2})\\b`, "i"));
  if (match) return validDate(Number(match[3]), monthNumber(match[2]), Number(match[1]), inputPath);
  match = name.match(/\b(20\d{2})[-_](\d{1,2})[-_](\d{1,2})\b/);
  if (match) return validDate(Number(match[1]), Number(match[2]), Number(match[3]), inputPath);
  const modified = new Date(statSync(inputPath).mtimeMs);
  return `${modified.getFullYear()}-${String(modified.getMonth() + 1).padStart(2, "0")}-${String(modified.getDate()).padStart(2, "0")}`;
}

function validDate(year: number, month: number, day: number, inputPath: string): string {
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw validationError("Recording filename contains an invalid date.", { inputPath, year, month, day });
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function monthNumber(value: string): number {
  const normalized = value.toLowerCase().slice(0, 3);
  return ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(normalized) + 1;
}

function buildTemplateValues(inputPath: string, date: string): Record<string, string> {
  const [yyyy, mm, dd] = date.split("-");
  const parsed = path.parse(inputPath);
  return {
    input: inputPath,
    inputDir: parsed.dir,
    inputName: parsed.base,
    inputStem: parsed.name,
    yyyy,
    mm,
    dd,
    mmdd: `${mm}${dd}`
  };
}

function expandTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (token, key: string) => values[key] ?? token);
}

function expandHome(value: string): string {
  return value === "~" ? homedir() : value.startsWith("~/") ? path.join(homedir(), value.slice(2)) : value;
}

function sanitizeFileName(value: string): string {
  return value.replace(/[/:\\]/g, "-").replace(/[\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim();
}

function sha256File(filePath: string): string {
  const hash = createHash("sha256");
  const descriptor = openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    closeSync(descriptor);
  }
  return hash.digest("hex");
}

function latestUsefulOutput(stdout: string, stderr: string): string | null {
  const lines = `${stdout}\n${stderr}`.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.at(-1) ?? null;
}

class WorkflowRunFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowRunFailure";
  }
}
