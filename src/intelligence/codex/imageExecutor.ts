import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getWorkspacePaths } from "../../workspace/paths.js";
import type { IntelligenceArtifactStore } from "../artifacts/store.js";
import { parseImageDimensions, sniffImageMimeType } from "../artifacts/imageMeta.js";
import type { IntelligenceV01Config } from "../config/types.js";
import type {
  IntelligenceArtifactRecord,
  IntelligenceJob,
  IntelligenceUsage,
  JsonValue,
} from "../types.js";

export class CodexImageExecutionBlockedError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CodexImageExecutionBlockedError";
  }
}

export class CodexImageExecutionFailedError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CodexImageExecutionFailedError";
  }
}

export interface CodexImageExecutor {
  execute(job: IntelligenceJob): Promise<{ output: JsonValue; usage?: IntelligenceUsage }>;
}

export interface CodexCliImageExecutorOptions {
  workspaceRoot: string;
  artifactStore: IntelligenceArtifactStore;
  config: IntelligenceV01Config;
}

type CodexImageManifest = {
  status?: unknown;
  artifacts?: unknown;
  warnings?: unknown;
};

type CodexImageManifestArtifact = {
  kind?: unknown;
  path?: unknown;
  mimeType?: unknown;
  width?: unknown;
  height?: unknown;
  prompt?: unknown;
  version?: unknown;
  seed?: unknown;
  metadata?: unknown;
};

const SUPPORTED_CODEX_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg"]);

export function createCodexCliImageExecutor(
  options: CodexCliImageExecutorOptions,
): CodexImageExecutor {
  const workspacePaths = getWorkspacePaths(options.workspaceRoot);
  const cli = options.config.codexCli;

  return {
    async execute(job: IntelligenceJob): Promise<{ output: JsonValue; usage?: IntelligenceUsage }> {
      if (!cli) {
        throw new CodexImageExecutionBlockedError(
          "CODEX_CLI_UNAVAILABLE",
          "Codex CLI execution is not configured for Arcadia Intelligence.",
        );
      }

      const startedAt = Date.now();
      const jobWorkspace = path.join(workspacePaths.root, ".arcadia", "intelligence", "jobs", job.id);
      const logsDir = path.join(jobWorkspace, "logs");
      const outputDir = path.join(jobWorkspace, "output");
      const referenceImagesDir = path.join(jobWorkspace, "reference-images");
      mkdirSync(logsDir, { recursive: true });
      mkdirSync(outputDir, { recursive: true });
      mkdirSync(referenceImagesDir, { recursive: true });

      writeFileSync(
        path.join(jobWorkspace, "request.json"),
        `${JSON.stringify(job.request, null, 2)}\n`,
      );
      stageReferenceImages(job, referenceImagesDir);

      const instructions = buildInstructions(job);
      writeFileSync(path.join(jobWorkspace, "instructions.md"), instructions);

      const stdoutPath = path.join(logsDir, "codex.stdout.log");
      const stderrPath = path.join(logsDir, "codex.stderr.log");
      const execution = await runCodexCli({
        command: cli.command,
        args: cli.args.map((arg) => arg.replaceAll("{workspace}", jobWorkspace)),
        input: instructions,
        timeoutMs: cli.timeoutMs,
      });
      writeFileSync(stdoutPath, execution.stdout);
      writeFileSync(stderrPath, execution.stderr);

      const manifestPath = path.join(outputDir, "manifest.json");

      if (execution.timedOut) {
        // The Codex CLI process can keep running past task completion (e.g.
        // a trailing self-review step) and get SIGTERM'd by our timeout
        // after it has already written a complete, valid manifest. Recover
        // that output instead of discarding finished work — only fall
        // through to a hard timeout failure if no valid manifest exists.
        const recovered = tryReadCompletedManifest(manifestPath);
        if (!recovered) {
          throw new CodexImageExecutionFailedError(
            "CODEX_CLI_TIMEOUT",
            `Codex CLI timed out after ${cli.timeoutMs}ms. Logs are preserved in ${path.relative(workspacePaths.root, logsDir)}.`,
          );
        }
        return buildResultFromManifest(recovered, job, jobWorkspace, options.artifactStore, startedAt, [
          `Codex CLI process did not exit within ${cli.timeoutMs}ms, but had already written a completed manifest before being stopped.`,
        ]);
      }
      if (execution.spawnErrorCode === "ENOENT") {
        throw new CodexImageExecutionBlockedError(
          "CODEX_CLI_UNAVAILABLE",
          `Codex CLI command "${cli.command}" was not found.`,
        );
      }
      if (execution.spawnError) {
        throw new CodexImageExecutionFailedError("CODEX_CLI_ERROR", execution.spawnError);
      }
      if (execution.exitCode !== 0) {
        throw new CodexImageExecutionFailedError(
          "CODEX_CLI_NONZERO_EXIT",
          `Codex CLI exited with status ${execution.exitCode}. Logs are preserved in ${path.relative(workspacePaths.root, logsDir)}.`,
        );
      }

      if (!existsSync(manifestPath)) {
        throw new CodexImageExecutionFailedError(
          "CODEX_MISSING_MANIFEST",
          `Codex image run did not produce output/manifest.json in ${path.relative(workspacePaths.root, jobWorkspace)}.`,
        );
      }

      const manifest = readManifest(manifestPath);
      if (manifest.status !== "completed") {
        throw new CodexImageExecutionFailedError(
          "CODEX_MANIFEST_VALIDATION_FAILED",
          'Codex image manifest status must be "completed".',
        );
      }
      if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
        throw new CodexImageExecutionFailedError(
          "CODEX_MANIFEST_VALIDATION_FAILED",
          "Codex image manifest must include at least one artifact.",
        );
      }

      return buildResultFromManifest(manifest, job, jobWorkspace, options.artifactStore, startedAt);
    },
  };
}

/** Returns a manifest only if it parses and its status is already "completed"; never throws. */
function tryReadCompletedManifest(manifestPath: string): CodexImageManifest | undefined {
  if (!existsSync(manifestPath)) {
    return undefined;
  }
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as CodexImageManifest;
    if (
      manifest.status === "completed" &&
      Array.isArray(manifest.artifacts) &&
      manifest.artifacts.length > 0
    ) {
      return manifest;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

async function buildResultFromManifest(
  manifest: CodexImageManifest,
  job: IntelligenceJob,
  jobWorkspace: string,
  artifactStore: IntelligenceArtifactStore,
  startedAt: number,
  extraWarnings: string[] = [],
): Promise<{ output: JsonValue; usage?: IntelligenceUsage }> {
  const artifacts: IntelligenceArtifactRecord[] = [];
  for (const rawArtifact of manifest.artifacts as unknown[]) {
    artifacts.push(await validateAndPersistArtifact(rawArtifact, jobWorkspace, job.id, artifactStore));
  }

  const manifestWarnings = Array.isArray(manifest.warnings)
    ? manifest.warnings.filter((warning): warning is string => typeof warning === "string")
    : [];
  const warnings = [...manifestWarnings, ...extraWarnings];

  return {
    output: {
      artifacts: artifacts as unknown as JsonValue,
      ...(warnings.length > 0 ? { warnings } : {}),
      generation: {
        requestedCount: requestedImageCount(job.request.input) ?? artifacts.length,
        returnedCount: artifacts.length,
      },
    },
    usage: {
      provider: "codex-cli",
      durationMs: Date.now() - startedAt,
    },
  };
}

function buildInstructions(job: IntelligenceJob): string {
  return `# Arcadia Intelligence image generation job

You are running inside an isolated Arcadia Intelligence job workspace.

Read request.json, generate the requested image artifact(s), and write files only under output/.
If reference images are present, they are staged under reference-images/.

Required output contract:

- output/manifest.json must be valid JSON.
- Each generated image file must live under output/.
- The manifest must have this shape:

\`\`\`json
{
  "status": "completed",
  "artifacts": [
    {
      "kind": "image",
      "path": "output/image-01.png",
      "mimeType": "image/png",
      "width": 1024,
      "height": 1024,
      "metadata": {
        "prompt": "optional prompt text",
        "version": "optional generator version",
        "seed": 123
      }
    }
  ],
  "warnings": []
}
\`\`\`

Arcadia will validate the manifest and image bytes independently. Do not return base64 or provider URLs.

Prompt:

${extractPrompt(job.request.input)}
`;
}

function extractPrompt(input: JsonValue): string {
  if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    const prompt = (input as Record<string, JsonValue>).prompt;
    if (typeof prompt === "string") {
      return prompt;
    }
  }
  return "";
}

function stageReferenceImages(job: IntelligenceJob, referenceImagesDir: string): void {
  if (typeof job.request.input !== "object" || job.request.input === null || Array.isArray(job.request.input)) {
    return;
  }

  const referenceImages = (job.request.input as Record<string, JsonValue>).referenceImages;
  if (!Array.isArray(referenceImages)) {
    return;
  }

  referenceImages.forEach((entry, index) => {
    const source =
      typeof entry === "string"
        ? entry
        : typeof entry === "object" && entry !== null && !Array.isArray(entry)
          ? (entry as Record<string, JsonValue>).path
          : undefined;
    if (typeof source !== "string" || !existsSync(source)) {
      return;
    }
    const extension = path.extname(source) || ".img";
    copyFileSync(source, path.join(referenceImagesDir, `reference-${String(index + 1).padStart(2, "0")}${extension}`));
  });
}

function readManifest(manifestPath: string): CodexImageManifest {
  try {
    return JSON.parse(readFileSync(manifestPath, "utf8")) as CodexImageManifest;
  } catch (error) {
    throw new CodexImageExecutionFailedError(
      "CODEX_MANIFEST_VALIDATION_FAILED",
      `Codex image manifest was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function validateAndPersistArtifact(
  rawArtifact: unknown,
  jobWorkspace: string,
  jobId: string,
  artifactStore: IntelligenceArtifactStore,
): Promise<IntelligenceArtifactRecord> {
  if (typeof rawArtifact !== "object" || rawArtifact === null || Array.isArray(rawArtifact)) {
    throw new CodexImageExecutionFailedError(
      "CODEX_MANIFEST_VALIDATION_FAILED",
      "Codex image manifest artifact entries must be objects.",
    );
  }

  const artifact = rawArtifact as CodexImageManifestArtifact;
  if (artifact.kind !== "image") {
    throw new CodexImageExecutionFailedError(
      "CODEX_MANIFEST_VALIDATION_FAILED",
      'Codex image manifest artifacts must use kind "image".',
    );
  }
  if (typeof artifact.path !== "string" || !artifact.path.startsWith("output/")) {
    throw new CodexImageExecutionFailedError(
      "CODEX_MANIFEST_VALIDATION_FAILED",
      'Codex image manifest artifact path must be a relative "output/..." path.',
    );
  }

  const absolutePath = path.resolve(jobWorkspace, artifact.path);
  if (!absolutePath.startsWith(path.join(jobWorkspace, "output") + path.sep)) {
    throw new CodexImageExecutionFailedError(
      "CODEX_MANIFEST_VALIDATION_FAILED",
      "Codex image manifest artifact path escaped the output directory.",
    );
  }
  if (!existsSync(absolutePath)) {
    throw new CodexImageExecutionFailedError(
      "CODEX_MISSING_IMAGE_FILE",
      `Codex image manifest declared missing file ${artifact.path}.`,
    );
  }

  const bytes = readFileSync(absolutePath);
  const actualMimeType = sniffImageMimeType(bytes);
  if (!SUPPORTED_CODEX_IMAGE_MIME_TYPES.has(actualMimeType)) {
    throw new CodexImageExecutionFailedError(
      "CODEX_INVALID_IMAGE",
      `Codex image artifact ${artifact.path} has unsupported MIME type ${actualMimeType}.`,
    );
  }

  const dimensions = parseImageDimensions(bytes);
  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
    throw new CodexImageExecutionFailedError(
      "CODEX_INVALID_IMAGE",
      `Codex image artifact ${artifact.path} is corrupt or has unreadable dimensions.`,
    );
  }
  if (typeof artifact.mimeType === "string" && artifact.mimeType !== actualMimeType) {
    throw new CodexImageExecutionFailedError(
      "CODEX_MANIFEST_VALIDATION_FAILED",
      `Codex image artifact ${artifact.path} declared MIME type ${artifact.mimeType}, but bytes are ${actualMimeType}.`,
    );
  }
  if (typeof artifact.width === "number" && artifact.width !== dimensions.width) {
    throw new CodexImageExecutionFailedError(
      "CODEX_MANIFEST_VALIDATION_FAILED",
      `Codex image artifact ${artifact.path} declared width ${artifact.width}, but bytes are ${dimensions.width}.`,
    );
  }
  if (typeof artifact.height === "number" && artifact.height !== dimensions.height) {
    throw new CodexImageExecutionFailedError(
      "CODEX_MANIFEST_VALIDATION_FAILED",
      `Codex image artifact ${artifact.path} declared height ${artifact.height}, but bytes are ${dimensions.height}.`,
    );
  }

  return artifactStore.saveImageBytes({
    jobId,
    bytes,
    metadata: buildArtifactMetadata(artifact),
  });
}

function buildArtifactMetadata(artifact: CodexImageManifestArtifact): JsonValue | undefined {
  const metadata: Record<string, JsonValue> = {};
  if (typeof artifact.prompt === "string") {
    metadata.prompt = artifact.prompt;
  }
  if (typeof artifact.version === "string") {
    metadata.version = artifact.version;
  }
  if (typeof artifact.seed === "number" && Number.isFinite(artifact.seed)) {
    metadata.seed = artifact.seed;
  }
  if (typeof artifact.metadata === "object" && artifact.metadata !== null && !Array.isArray(artifact.metadata)) {
    for (const [key, value] of Object.entries(artifact.metadata as Record<string, JsonValue>)) {
      metadata[key] = value;
    }
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function requestedImageCount(input: JsonValue): number | undefined {
  if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    const n = (input as Record<string, JsonValue>).n;
    if (typeof n === "number" && Number.isInteger(n)) {
      return n;
    }
  }
  return undefined;
}

function runCodexCli(input: {
  command: string;
  args: string[];
  input: string;
  timeoutMs: number;
}): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  spawnError?: string;
  spawnErrorCode?: string;
}> {
  return new Promise((resolve) => {
    const child = spawn(input.command, input.args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let spawnError: string | undefined;
    let spawnErrorCode: string | undefined;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, input.timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      spawnError = error.message;
      spawnErrorCode = error.code;
    });
    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({ stdout, stderr, exitCode, timedOut, spawnError, spawnErrorCode });
    });
    child.stdin.end(input.input);
  });
}
