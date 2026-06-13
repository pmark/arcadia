import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { ArcadiaJsonSuccess, DashboardSnapshotResponse } from "./types";

const execFileAsync = promisify(execFile);

export async function loadDashboardSnapshot(): Promise<ArcadiaJsonSuccess<DashboardSnapshotResponse>> {
  return runArcadiaCliJson<DashboardSnapshotResponse>(["dashboard", "snapshot"]);
}

export interface ReviewActionResponse {
  item: {
    id: string;
    slug: string;
  };
  result: {
    status: "approved" | "rejected" | "deferred";
    summary: string;
  };
  approval: unknown | null;
}

export interface ReviewResolveReplyResponse {
  item: {
    id: string;
    slug: string;
  };
  action: "approved" | "rejected" | "deferred" | "feedback_captured";
  selectedOption: string | null;
  feedback: unknown | null;
  result: ReviewActionResponse["result"] | null;
  approval: unknown | null;
  confirmation: string;
}

export async function runReviewAction(input: {
  id: string;
  action: "approve" | "reject" | "defer";
}): Promise<ArcadiaJsonSuccess<ReviewActionResponse>> {
  return runArcadiaCliJson<ReviewActionResponse>(["review", input.action, input.id]);
}

export async function resolveReviewReply(input: {
  id: string;
  reply: string;
}): Promise<ArcadiaJsonSuccess<ReviewResolveReplyResponse>> {
  return runArcadiaCliJson<ReviewResolveReplyResponse>([
    "review",
    "resolve-reply",
    input.reply,
    "--id",
    input.id
  ]);
}

export interface BackBurnerActionResponse {
  item: {
    id: string;
    status: string;
  };
  workItem?: unknown;
  result: {
    status: "promoted" | "archived";
    summary: string;
  };
}

export async function runBackBurnerAction(input: {
  id: string;
  action: "promote" | "archive";
}): Promise<ArcadiaJsonSuccess<BackBurnerActionResponse>> {
  return runArcadiaCliJson<BackBurnerActionResponse>(["back-burner", input.action, input.id]);
}

export class ArcadiaCliError extends Error {
  readonly statusCode: number;
  readonly details: unknown;

  constructor(message: string, statusCode: number, details: unknown = null) {
    super(message);
    this.name = "ArcadiaCliError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

async function runArcadiaCliJson<TData>(args: string[]): Promise<ArcadiaJsonSuccess<TData>> {
  const repoRoot = findRepoRoot(process.cwd());
  const sourceCli = path.join(repoRoot, "src", "cli.ts");
  const tsxBin = path.join(repoRoot, "node_modules", ".bin", "tsx");
  const builtCli = path.join(repoRoot, "dist", "src", "cli.js");

  const command = existsSync(sourceCli) ? (existsSync(tsxBin) ? tsxBin : "tsx") : process.execPath;
  const cliArgs = existsSync(sourceCli)
    ? [sourceCli, ...args, "--json"]
    : [builtCli, ...args, "--json"];

  try {
    const result = await execFileAsync(command, cliArgs, {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024
    });

    const parsed = parseArcadiaJson<TData>(result.stdout);
    if (!parsed.ok) {
      throw failureFromParsed(parsed);
    }

    return parsed;
  } catch (error) {
    if (error instanceof ArcadiaCliError) {
      throw error;
    }
    throw failureFromExecError(error);
  }
}

function findRepoRoot(start: string): string {
  let current = path.resolve(start);

  while (true) {
    if (existsSync(path.join(current, "src", "cli.ts")) && existsSync(path.join(current, "package.json"))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error("Unable to locate Arcadia repository root.");
    }

    current = parent;
  }
}

type ArcadiaJsonResult<TData> =
  | ArcadiaJsonSuccess<TData>
  | {
      ok: false;
      command: string;
      workspace?: string;
      error: {
        code: string;
        message: string;
        details: unknown;
      };
    };

function parseArcadiaJson<TData>(raw: string): ArcadiaJsonResult<TData> {
  return JSON.parse(raw) as ArcadiaJsonResult<TData>;
}

function failureFromParsed(parsed: ArcadiaJsonResult<unknown>): ArcadiaCliError {
  if (parsed.ok) {
    return new ArcadiaCliError("Arcadia CLI returned an unexpected successful response.", 500);
  }

  return new ArcadiaCliError(
    `${parsed.error.code}: ${parsed.error.message}`,
    statusForArcadiaError(parsed.error.code),
    parsed.error.details
  );
}

function failureFromExecError(error: unknown): ArcadiaCliError {
  const execError = error as { stdout?: string; stderr?: string; message?: string; code?: unknown };
  const raw = [execError.stderr, execError.stdout].find((value) => value?.trim());
  if (raw) {
    try {
      return failureFromParsed(parseArcadiaJson<unknown>(raw));
    } catch {
      return new ArcadiaCliError(raw.trim(), 500, {
        commandFailed: true,
        exitCode: execError.code ?? null
      });
    }
  }

  return new ArcadiaCliError(execError.message ?? String(error), 500, {
    commandFailed: true,
    exitCode: execError.code ?? null
  });
}

function statusForArcadiaError(code: string): number {
  if (code === "USAGE_ERROR" || code === "VALIDATION_ERROR") {
    return 400;
  }

  if (code === "WORKSPACE_NOT_FOUND" || code === "DATABASE_NOT_INITIALIZED") {
    return 503;
  }

  return 500;
}
