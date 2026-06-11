import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type {
  AskData,
  ArcadiaJsonSuccess,
  CodexListData,
  MilestoneListData,
  QueueData,
  RunListData,
  RunShowData,
  StatusData
} from "./types.js";

const execFileAsync = promisify(execFile);

export interface ArcadiaCliOptions {
  workspace: string;
  cliPath: string | null;
  timeoutMs?: number;
}

export interface CliInvocation {
  command: string;
  args: string[];
}

export interface AskCliOptions {
  runSafe?: boolean;
}

export class ArcadiaCli {
  constructor(private readonly options: ArcadiaCliOptions) {}

  status(): Promise<ArcadiaJsonSuccess<StatusData>> {
    return this.runJson<StatusData>(["status", "--workspace", this.options.workspace, "--json"]);
  }

  queue(): Promise<ArcadiaJsonSuccess<QueueData>> {
    return this.runJson<QueueData>(["queue", "--workspace", this.options.workspace, "--json"]);
  }

  ask(request: string, askOptions: AskCliOptions = {}): Promise<ArcadiaJsonSuccess<AskData>> {
    return this.runJson<AskData>([
      "ask",
      "--workspace",
      this.options.workspace,
      request,
      ...(askOptions.runSafe ? ["--run-safe"] : []),
      "--json"
    ]);
  }

  runs(limit = 10): Promise<ArcadiaJsonSuccess<RunListData>> {
    return this.runJson<RunListData>([
      "run",
      "list",
      "--workspace",
      this.options.workspace,
      "--limit",
      String(limit),
      "--json"
    ]);
  }

  run(runId: string): Promise<ArcadiaJsonSuccess<RunShowData>> {
    return this.runJson<RunShowData>(["run", "show", runId, "--workspace", this.options.workspace, "--json"]);
  }

  codexTasks(activeOnly = true): Promise<ArcadiaJsonSuccess<CodexListData>> {
    return this.runJson<CodexListData>([
      "codex",
      "list",
      "--workspace",
      this.options.workspace,
      ...(activeOnly ? ["--active-only"] : []),
      "--json"
    ]);
  }

  milestones(status = "completed", limit = 20): Promise<ArcadiaJsonSuccess<MilestoneListData>> {
    return this.runJson<MilestoneListData>([
      "milestone",
      "list",
      "--workspace",
      this.options.workspace,
      "--status",
      status,
      "--limit",
      String(limit),
      "--json"
    ]);
  }

  buildInvocation(args: string[]): CliInvocation {
    return buildCliInvocation(args, this.options.cliPath);
  }

  private async runJson<TData>(args: string[]): Promise<ArcadiaJsonSuccess<TData>> {
    const invocation = this.buildInvocation(args);
    try {
      const result = await execFileAsync(invocation.command, invocation.args, {
        cwd: repoRoot(),
        encoding: "utf8",
        timeout: this.options.timeoutMs ?? 30_000,
        maxBuffer: 4 * 1024 * 1024
      });
      return parseJsonResponse<TData>(result.stdout);
    } catch (error) {
      if (isExecError(error)) {
        const detail = error.stderr?.trim() || error.stdout?.trim() || error.message;
        throw new Error(`Arcadia CLI failed: ${detail}`);
      }
      throw error;
    }
  }
}

export function buildCliInvocation(args: string[], cliPath: string | null): CliInvocation {
  if (cliPath) {
    return { command: cliPath, args };
  }

  const sourceCli = findExisting([
    path.resolve(import.meta.dirname, "../../../src/cli.ts"),
    path.resolve(import.meta.dirname, "../../../../src/cli.ts"),
    path.resolve(process.cwd(), "src/cli.ts")
  ]);

  if (sourceCli) {
    return { command: findTsx(), args: [sourceCli, ...args] };
  }

  const builtCli = findExisting([
    path.resolve(import.meta.dirname, "../../../dist/src/cli.js"),
    path.resolve(import.meta.dirname, "../../../../dist/src/cli.js"),
    path.resolve(process.cwd(), "dist/src/cli.js")
  ]);

  if (builtCli) {
    return { command: process.execPath, args: [builtCli, ...args] };
  }

  throw new Error("Unable to locate Arcadia CLI. Set ARCADIA_CLI_PATH.");
}

function parseJsonResponse<TData>(stdout: string): ArcadiaJsonSuccess<TData> {
  const parsed = JSON.parse(stdout) as ArcadiaJsonSuccess<TData>;
  if (!parsed.ok) {
    throw new Error("Arcadia CLI returned a failure response.");
  }
  return parsed;
}

function findExisting(paths: string[]): string | null {
  return paths.find((candidate) => existsSync(candidate)) ?? null;
}

function findTsx(): string {
  return findExisting([
    path.resolve(repoRoot(), "node_modules", ".bin", "tsx"),
    path.resolve(import.meta.dirname, "../../node_modules/.bin/tsx")
  ]) ?? "tsx";
}

function repoRoot(): string {
  return path.resolve(import.meta.dirname, "../../..");
}

function isExecError(error: unknown): error is Error & { stdout?: string; stderr?: string } {
  return error instanceof Error && ("stdout" in error || "stderr" in error);
}
