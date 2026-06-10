import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { initWorkspace } from "../workspace/initWorkspace.js";

export interface InitCommandData {
  workspacePath: string;
  databasePath: string;
  configPath: string;
  createdConfig: boolean;
}

export function runInitCommand(workspace: string): CommandSuccess<InitCommandData> {
  const result = initWorkspace(workspace);
  return createSuccess({
    command: "init",
    workspace: result.workspacePath,
    data: result,
    artifacts: [result.databasePath, result.configPath]
  });
}

export function renderInitSuccess(response: CommandSuccess<InitCommandData>): string[] {
  return [
    `Initialized Arcadia workspace: ${response.data.workspacePath}`,
    `Database: ${response.data.databasePath}`,
    `Config: ${response.data.configPath}`
  ];
}
