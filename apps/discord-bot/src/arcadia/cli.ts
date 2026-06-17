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
  ReviewDecisionData,
  ReviewData,
  ReviewResolveReplyData,
  ReviewShowData,
  RunListData,
  RunShowData,
  StatusData
} from "./types.js";

const execFileAsync = promisify(execFile);

export interface ArcadiaCliOptions {
  workspace: string | null;
  cliPath: string | null;
  timeoutMs?: number;
}

export interface CliInvocation {
  command: string;
  args: string[];
}

export interface AskCliOptions {
  runSafe?: boolean;
  sourceIngress?: string;
  replyReviewId?: string | null;
}

export class ArcadiaCli {
  constructor(private readonly options: ArcadiaCliOptions) {}

  status(): Promise<ArcadiaJsonSuccess<StatusData>> {
    return this.runJson<StatusData>(this.withWorkspace(["status", "--json"]));
  }

  queue(): Promise<ArcadiaJsonSuccess<QueueData>> {
    return this.runJson<QueueData>(this.withWorkspace(["queue", "--json"]));
  }

  review(): Promise<ArcadiaJsonSuccess<ReviewData>> {
    return this.runJson<ReviewData>(this.withWorkspace(["review", "--json"]));
  }

  reviewShow(id: string): Promise<ArcadiaJsonSuccess<ReviewShowData>> {
    return this.runJson<ReviewShowData>(this.withWorkspace(["review", "show", id, "--json"]));
  }

  reviewApprove(id: string): Promise<ArcadiaJsonSuccess<ReviewDecisionData>> {
    return this.runJson<ReviewDecisionData>(this.withWorkspace(["review", "approve", id, "--json"]));
  }

  reviewApproveWithExecute(id: string, executor = "codex"): Promise<ArcadiaJsonSuccess<ReviewDecisionData>> {
    return this.runJson<ReviewDecisionData>(
      this.withWorkspace(["review", "approve", id, "--execute", "--executor", executor, "--json"]),
      { timeoutMs: 35 * 60 * 1000 }
    );
  }

  reviewReject(id: string): Promise<ArcadiaJsonSuccess<ReviewDecisionData>> {
    return this.runJson<ReviewDecisionData>(this.withWorkspace(["review", "reject", id, "--json"]));
  }

  reviewDefer(id: string): Promise<ArcadiaJsonSuccess<ReviewDecisionData>> {
    return this.runJson<ReviewDecisionData>(this.withWorkspace(["review", "defer", id, "--json"]));
  }

  reviewResolveReply(reply: string, id?: string | null): Promise<ArcadiaJsonSuccess<ReviewResolveReplyData>> {
    return this.runJson<ReviewResolveReplyData>(this.withWorkspace([
      "review",
      "resolve-reply",
      reply,
      ...(id ? ["--id", id] : []),
      "--json"
    ]));
  }

  ask(request: string, askOptions: AskCliOptions = {}): Promise<ArcadiaJsonSuccess<AskData>> {
    return this.runJson<AskData>(this.withWorkspaceAfter(1, [
      "ask",
      request,
      ...(askOptions.sourceIngress ? ["--source-ingress", askOptions.sourceIngress] : []),
      ...(askOptions.replyReviewId ? ["--reply-review-id", askOptions.replyReviewId] : []),
      ...(askOptions.runSafe ? ["--run-safe"] : []),
      "--json"
    ]));
  }

  runs(limit = 10): Promise<ArcadiaJsonSuccess<RunListData>> {
    return this.runJson<RunListData>(this.withWorkspace([
      "run",
      "list",
      "--limit",
      String(limit),
      "--json"
    ]));
  }

  run(runId: string): Promise<ArcadiaJsonSuccess<RunShowData>> {
    return this.runJson<RunShowData>(this.withWorkspace(["run", "show", runId, "--json"]));
  }

  codexTasks(activeOnly = true): Promise<ArcadiaJsonSuccess<CodexListData>> {
    return this.runJson<CodexListData>(this.withWorkspaceAfter(2, [
      "codex",
      "list",
      ...(activeOnly ? ["--active-only"] : []),
      "--json"
    ]));
  }

  milestones(status = "completed", limit = 20): Promise<ArcadiaJsonSuccess<MilestoneListData>> {
    return this.runJson<MilestoneListData>(this.withWorkspaceAfter(2, [
      "milestone",
      "list",
      "--status",
      status,
      "--limit",
      String(limit),
      "--json"
    ]));
  }

  buildInvocation(args: string[]): CliInvocation {
    return buildCliInvocation(args, this.options.cliPath);
  }

  private async runJson<TData>(args: string[], options: { timeoutMs?: number } = {}): Promise<ArcadiaJsonSuccess<TData>> {
    const invocation = this.buildInvocation(args);
    try {
      const result = await execFileAsync(invocation.command, invocation.args, {
        cwd: repoRoot(),
        encoding: "utf8",
        timeout: options.timeoutMs ?? this.options.timeoutMs ?? 30_000,
        maxBuffer: 16 * 1024 * 1024
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

  private withWorkspace(args: string[]): string[] {
    if (!this.options.workspace) {
      return args;
    }

    const jsonIndex = args.lastIndexOf("--json");
    if (jsonIndex === -1) {
      return [...args, "--workspace", this.options.workspace];
    }

    return [...args.slice(0, jsonIndex), "--workspace", this.options.workspace, ...args.slice(jsonIndex)];
  }

  private withWorkspaceAfter(index: number, args: string[]): string[] {
    return this.options.workspace
      ? [...args.slice(0, index), "--workspace", this.options.workspace, ...args.slice(index)]
      : args;
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
