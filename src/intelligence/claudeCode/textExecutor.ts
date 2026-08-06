import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getWorkspacePaths } from "../../workspace/paths.js";
import type { IntelligenceV01Config } from "../config/types.js";
import type { IntelligenceJob, IntelligenceUsage, JsonValue } from "../types.js";

export class ClaudeCodeTextExecutionBlockedError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ClaudeCodeTextExecutionBlockedError";
  }
}

export class ClaudeCodeTextExecutionFailedError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ClaudeCodeTextExecutionFailedError";
  }
}

export interface ClaudeCodeTextExecutor {
  execute(job: IntelligenceJob): Promise<{ output: JsonValue; usage?: IntelligenceUsage }>;
}

export interface ClaudeCodeCliTextExecutorOptions {
  workspaceRoot: string;
  config: IntelligenceV01Config;
}

type ClaudeCodeTextManifest = {
  status?: unknown;
  result?: unknown;
};

/**
 * Text executor backed by the Claude Code CLI, using the identical
 * request/response contract as `createCodexCliTextExecutor`
 * (../codex/textExecutor.js): same job workspace layout, same
 * instructions.md, same output/result.json manifest shape. The only
 * difference is which CLI is spawned and, per the coding-agent adapters'
 * existing conventions (see src/codingAgents/adapters.ts), that Claude Code
 * takes its working directory from the spawned process's cwd rather than a
 * `--cd`/`-C` flag.
 */
export function createClaudeCodeCliTextExecutor(
  options: ClaudeCodeCliTextExecutorOptions,
): ClaudeCodeTextExecutor {
  const workspacePaths = getWorkspacePaths(options.workspaceRoot);
  const cli = options.config.claudeCodeCli;

  return {
    async execute(job: IntelligenceJob): Promise<{ output: JsonValue; usage?: IntelligenceUsage }> {
      if (!cli) {
        throw new ClaudeCodeTextExecutionBlockedError(
          "CLAUDE_CODE_CLI_UNAVAILABLE",
          "Claude Code CLI execution is not configured for Arcadia Intelligence.",
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

      const execution = await runClaudeCodeCli({
        command: cli.command,
        args: cli.args.map((arg) => arg.replaceAll("{workspace}", jobWorkspace)),
        cwd: jobWorkspace,
        input: instructions,
        timeoutMs: cli.timeoutMs,
      });
      writeFileSync(path.join(logsDir, "claude-code.stdout.log"), execution.stdout);
      writeFileSync(path.join(logsDir, "claude-code.stderr.log"), execution.stderr);

      const resultPath = path.join(outputDir, "result.json");

      if (execution.timedOut) {
        // The Claude Code CLI process can linger past task completion and
        // get SIGTERM'd. Recover any completed manifest that was already
        // written.
        const recovered = tryReadCompletedManifest(resultPath);
        if (!recovered) {
          throw new ClaudeCodeTextExecutionFailedError(
            "CLAUDE_CODE_CLI_TIMEOUT",
            `Claude Code CLI timed out after ${cli.timeoutMs}ms without producing output/result.json.`,
          );
        }
        return {
          output: recovered.result as JsonValue,
          usage: { provider: "claude-code-cli", durationMs: Date.now() - startedAt },
        };
      }

      if (execution.spawnErrorCode === "ENOENT") {
        throw new ClaudeCodeTextExecutionBlockedError(
          "CLAUDE_CODE_CLI_UNAVAILABLE",
          `Claude Code CLI command "${cli.command}" was not found.`,
        );
      }
      if (execution.spawnError) {
        throw new ClaudeCodeTextExecutionFailedError("CLAUDE_CODE_CLI_ERROR", execution.spawnError);
      }
      if (execution.exitCode !== 0) {
        throw new ClaudeCodeTextExecutionFailedError(
          "CLAUDE_CODE_CLI_NONZERO_EXIT",
          `Claude Code CLI exited with status ${execution.exitCode}.`,
        );
      }

      if (!existsSync(resultPath)) {
        throw new ClaudeCodeTextExecutionFailedError(
          "CLAUDE_CODE_MISSING_RESULT",
          `Claude Code text run did not produce output/result.json in ${path.relative(workspacePaths.root, jobWorkspace)}.`,
        );
      }

      const manifest = readManifest(resultPath);
      if (manifest.status !== "completed") {
        throw new ClaudeCodeTextExecutionFailedError(
          "CLAUDE_CODE_RESULT_FAILED",
          `Claude Code text result.json status was "${String(manifest.status)}", expected "completed".`,
        );
      }
      if (manifest.result === undefined || manifest.result === null) {
        throw new ClaudeCodeTextExecutionFailedError(
          "CLAUDE_CODE_MISSING_RESULT_FIELD",
          'Claude Code text result.json is missing the required "result" field.',
        );
      }

      return {
        output: manifest.result as JsonValue,
        usage: { provider: "claude-code-cli", durationMs: Date.now() - startedAt },
      };
    },
  };
}

function tryReadCompletedManifest(resultPath: string): ClaudeCodeTextManifest | undefined {
  if (!existsSync(resultPath)) {
    return undefined;
  }
  try {
    const manifest = JSON.parse(readFileSync(resultPath, "utf8")) as ClaudeCodeTextManifest;
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

function readManifest(resultPath: string): ClaudeCodeTextManifest {
  try {
    return JSON.parse(readFileSync(resultPath, "utf8")) as ClaudeCodeTextManifest;
  } catch (error) {
    throw new ClaudeCodeTextExecutionFailedError(
      "CLAUDE_CODE_RESULT_INVALID_JSON",
      `Claude Code text result.json was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
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

function runClaudeCodeCli(input: {
  command: string;
  args: string[];
  cwd: string;
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
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
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
