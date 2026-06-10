import { existsSync } from "node:fs";
import { CommanderError } from "commander";

export type ArcadiaErrorCode =
  | "USAGE_ERROR"
  | "VALIDATION_ERROR"
  | "WORKSPACE_NOT_FOUND"
  | "DATABASE_NOT_INITIALIZED"
  | "PROJECT_NOT_FOUND"
  | "MILESTONE_NOT_FOUND"
  | "WORK_ITEM_NOT_FOUND"
  | "ARTIFACT_NOT_FOUND"
  | "SQLITE_ERROR"
  | "UNEXPECTED_ERROR";

export type ArcadiaExitCode = 1 | 2 | 3;

export interface ArcadiaErrorDetails {
  [key: string]: unknown;
}

export class ArcadiaError extends Error {
  readonly code: ArcadiaErrorCode;
  readonly exitCode: ArcadiaExitCode;
  readonly details: ArcadiaErrorDetails;

  constructor(code: ArcadiaErrorCode, message: string, exitCode: ArcadiaExitCode, details: ArcadiaErrorDetails = {}) {
    super(message);
    this.name = "ArcadiaError";
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

export function usageError(message: string, details: ArcadiaErrorDetails = {}): ArcadiaError {
  return new ArcadiaError("USAGE_ERROR", message, 2, details);
}

export function validationError(message: string, details: ArcadiaErrorDetails = {}): ArcadiaError {
  return new ArcadiaError("VALIDATION_ERROR", message, 2, details);
}

export function workspaceNotFound(workspace: string): ArcadiaError {
  return new ArcadiaError("WORKSPACE_NOT_FOUND", "Workspace not found.", 3, { workspace });
}

export function databaseNotInitialized(databasePath: string): ArcadiaError {
  return new ArcadiaError("DATABASE_NOT_INITIALIZED", "Arcadia database is not initialized.", 3, {
    databasePath
  });
}

export function projectNotFound(projectId: string): ArcadiaError {
  return new ArcadiaError("PROJECT_NOT_FOUND", "Project not found.", 3, { projectId });
}

export function milestoneNotFound(milestoneId: string): ArcadiaError {
  return new ArcadiaError("MILESTONE_NOT_FOUND", "Milestone not found.", 3, { milestoneId });
}

export function workItemNotFound(workItemId: string): ArcadiaError {
  return new ArcadiaError("WORK_ITEM_NOT_FOUND", "Work item not found.", 3, { workItemId });
}

export function normalizeError(error: unknown): ArcadiaError {
  if (error instanceof ArcadiaError) {
    return error;
  }

  if (error instanceof CommanderError) {
    return usageError(error.message, {
      code: error.code,
      exitCode: error.exitCode
    });
  }

  if (error instanceof Error) {
    if (isSqliteError(error)) {
      return new ArcadiaError("SQLITE_ERROR", "SQLite operation failed.", 1, {
        cause: error.message
      });
    }

    if (looksLikeValidationError(error.message)) {
      return validationError(error.message);
    }

    return new ArcadiaError("UNEXPECTED_ERROR", "Unexpected error.", 1, {
      cause: error.message
    });
  }

  return new ArcadiaError("UNEXPECTED_ERROR", "Unexpected error.", 1, {
    cause: String(error)
  });
}

export function assertWorkspaceReady(workspacePath: string, databasePath: string): void {
  if (!existsSync(workspacePath)) {
    throw workspaceNotFound(workspacePath);
  }

  if (!existsSync(databasePath)) {
    throw databaseNotInitialized(databasePath);
  }
}

function isSqliteError(error: Error): boolean {
  return (
    error.name === "SqliteError" ||
    "code" in error && typeof (error as { code?: unknown }).code === "string" && String((error as { code: string }).code).startsWith("SQLITE_")
  );
}

function looksLikeValidationError(message: string): boolean {
  return message.includes(" must be one of: ") || message.endsWith(" is required");
}
