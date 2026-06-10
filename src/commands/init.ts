import { initWorkspace } from "../workspace/initWorkspace.js";

export function runInitCommand(workspace: string): void {
  const result = initWorkspace(workspace);
  console.log(`Initialized Arcadia workspace: ${result.workspacePath}`);
  console.log(`Database: ${result.databasePath}`);
  console.log(`Config: ${result.configPath}`);
}
