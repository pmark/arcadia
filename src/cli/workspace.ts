import { assertWorkspaceReady } from "./errors.js";
import { getWorkspacePaths, resolveWorkspacePath } from "../workspace/paths.js";

export function resolveReadyWorkspace(workspace: string): { workspacePath: string; databasePath: string } {
  const workspacePath = resolveWorkspacePath(workspace);
  const databasePath = getWorkspacePaths(workspacePath).databaseFile;
  assertWorkspaceReady(workspacePath, databasePath);
  return { workspacePath, databasePath };
}
