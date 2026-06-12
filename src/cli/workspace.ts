import { assertWorkspaceReady } from "./errors.js";
import { getWorkspacePaths } from "../workspace/paths.js";
import { requireResolvedWorkspace } from "../workspace/resolve.js";

export function resolveReadyWorkspace(workspace?: string): { workspacePath: string; databasePath: string } {
  const workspacePath = requireResolvedWorkspace({ workspace });
  const databasePath = getWorkspacePaths(workspacePath).databaseFile;
  assertWorkspaceReady(workspacePath, databasePath);
  return { workspacePath, databasePath };
}
