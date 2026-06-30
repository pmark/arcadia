import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getWorkspacePaths } from "../../workspace/paths.js";
import type { IntelligenceV01Config } from "../config/types.js";
import type { IntelligenceJob, IntelligenceUsage, JsonValue } from "../types.js";

export class CodexTextExecutionBlockedError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CodexTextExecutionBlockedError";
  }
}

export class CodexTextExecutionFailedError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CodexTextExecutionFailedError";
  }
}

export interface CodexTextExecutor {
  execute(job: IntelligenceJob): Promise<{ output: JsonValue; usage?: IntelligenceUsage }>;
}

export interface CodexCliTextExecutorOptions {
  workspaceRoot: string;
  config: IntelligenceV01Config;
}

type CodexTextManifest = {
  status?: unknown;
  result?: unknown;
};

export function createCodexCliTextExecutor(
  options: CodexCliTextExecutorOptions,
): CodexTextExecutor {
  const workspacePaths = getWorkspacePaths(options.workspaceRoot);
  const cli = options.config.codexCli;

  return {
    async execute(job: IntelligenceJob): Promise<{ output: JsonValue; usage?: IntelligenceUsage }> {
      if (!cli) {
        throw new CodexTextExecutionBlockedError(
          "CODEX_CLI_UNAVAILABLE",
          "Codex CLI execution is not configured for Arcadia Intelligence.",
        );
      }

      const startedAt = Date.now();
      const jobWorkspace = path.join(
        workspacePaths.root,
        ".arcadia",
        "intelligence",
        "jobs",
        job.id,
      );
      const logsDir = path.join(jobWorkspace, "logs");
      const outputDir = path.join(jobWorkspace, "output");
      mkdirSync(logsDir, { recursive: true });
      mkdirSync(outputDir, { recursive: true });

      writeFileSync(
        path.join(jobWorkspace, "request.json"),
        `${JSON.stringify(job.request, null, 2)}\n`,
      );

      const instructions = buildInstructions(job);
      writeFileSync(path.join(jobWorkspace, "instructions.md"), instructions);

      const execution = await runCodexCli({
        command: cli.command,
        args: cli.args.map((arg) => arg.replaceAll("{workspace}", jobWorkspace)),
        input: instructions,
        timeoutMs: cli.timeoutMs,
      });
      writeFileSync(path.join(logsDir, "codex.stdout.log"), execution.stdout);
      writeFileSync(path.join(logsDir, "codex.stderr.log"), execution.stderr);

      const resultPath = path.join(outputDir, "result.json");

      if (execution.timedOut) {
        // The Codex CLI process can linger past task completion and get
        // SIGTERM'd. Recover any completed manifest that was already written.
        const recovered = tryReadCompletedManifest(resultPath);
        if (!recovered) {
          throw new CodexTextExecutionFailedError(
            "CODEX_CLI_TIMEOUT",
            `Codex CLI timed out after ${cli.timeoutMs}ms without producing output/result.json.`,
          );
        }
        return {
          output: recovered.result as JsonValue,
          usage: { provider: "codex-cli", durationMs: Date.now() - startedAt },
        };
      }

      if (execution.spawnErrorCode === "ENOENT") {
        throw new CodexTextExecutionBlockedError(
          "CODEX_CLI_UNAVAILABLE",
          `Codex CLI command "${cli.command}" was not found.`,
        );
      }
      if (execution.spawnError) {
        throw new CodexTextExecutionFailedError("CODEX_CLI_ERROR", execution.spawnError);
      }
      if (execution.exitCode !== 0) {
        throw new CodexTextExecutionFailedError(
          "CODEX_CLI_NONZERO_EXIT",
          `Codex CLI exited with status ${execution.exitCode}.`,
        );
      }

      if (!existsSync(resultPath)) {
        throw new CodexTextExecutionFailedError(
          "CODEX_MISSING_RESULT",
          `Codex text run did not produce output/result.json in ${path.relative(workspacePaths.root, jobWorkspace)}.`,
        );
      }

      const manifest = readManifest(resultPath);
      if (manifest.status !== "completed") {
        throw new CodexTextExecutionFailedError(
          "CODEX_RESULT_FAILED",
          `Codex text result.json status was "${String(manifest.status)}", expected "completed".`,
        );
      }
      if (manifest.result === undefined || manifest.result === null) {
        throw new CodexTextExecutionFailedError(
          "CODEX_MISSING_RESULT_FIELD",
          'Codex text result.json is missing the required "result" field.',
        );
      }

      return {
        output: manifest.result as JsonValue,
        usage: { provider: "codex-cli", durationMs: Date.now() - startedAt },
      };
    },
  };
}

function tryReadCompletedManifest(resultPath: string): CodexTextManifest | undefined {
  if (!existsSync(resultPath)) {
    return undefined;
  }
  try {
    const manifest = JSON.parse(readFileSync(resultPath, "utf8")) as CodexTextManifest;
    if (
      manifest.status === "completed" &&
      manifest.result !== undefined &&
      manifest.result !== null
    ) {
      return manifest;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function readManifest(resultPath: string): CodexTextManifest {
  try {
    return JSON.parse(readFileSync(resultPath, "utf8")) as CodexTextManifest;
  } catch (error) {
    throw new CodexTextExecutionFailedError(
      "CODEX_RESULT_INVALID_JSON",
      `Codex text result.json was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function buildInstructions(job: IntelligenceJob): string {
  return `# Arcadia Intelligence text generation job

You are running inside an isolated Arcadia Intelligence job workspace.

Read request.json, fulfill the request, and write output only to output/.

Required output:

- output/result.json must be valid JSON.
- The result field must conform to the JSON Schema in request.json's outputContract.jsonSchema.
- The file must have this exact shape:

\`\`\`json
{
  "status": "completed",
  "result": { ... your JSON payload matching the output contract ... }
}
\`\`\`

Do not include metadata, usage, or token count fields — only "status" and "result".

Request:

- operationId: ${job.request.operationId}
- capability: ${job.request.capability}
- profile: ${job.request.profile}
- input: ${JSON.stringify(job.request.input)}
`;
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
