import path from "node:path";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { validationError } from "../cli/errors.js";
import { withDatabase } from "../db/connection.js";
import type { ArcadiaProjectSeedResult } from "../workspace/arcadiaProject.js";
import { seedArcadiaProject } from "../workspace/arcadiaProject.js";
import { initWorkspace } from "../workspace/initWorkspace.js";

export interface InitCommandData {
  workspacePath: string;
  databasePath: string;
  configPath: string;
  createdConfig: boolean;
  profile: WorkspaceProfile | null;
  seed: ArcadiaProjectSeedResult | null;
}

export type WorkspaceProfile = "arcadia";

export function runInitCommand(
  workspace: string,
  options: { profile?: string } = {}
): CommandSuccess<InitCommandData> {
  const profile = normalizeWorkspaceProfile(options.profile);
  const result = initWorkspace(workspace);
  const seed = profile === "arcadia"
    ? withDatabase(result.workspacePath, (db) => seedArcadiaProject(db, result.workspacePath))
    : null;

  return createSuccess({
    command: "init",
    workspace: result.workspacePath,
    data: {
      ...result,
      profile,
      seed
    },
    artifacts: [
      result.databasePath,
      result.configPath,
      ...(seed ? [pathInWorkspace(result.workspacePath, seed.missionLog.markdown_path)] : [])
    ]
  });
}

export function renderInitSuccess(response: CommandSuccess<InitCommandData>): string[] {
  const lines = [
    `Initialized Arcadia workspace: ${response.data.workspacePath}`,
    `Database: ${response.data.databasePath}`,
    `Config: ${response.data.configPath}`
  ];
  if (response.data.seed) {
    lines.push(`Profile: ${response.data.profile}`);
    lines.push(`Project: ${response.data.seed.project.name} (${response.data.seed.project.status})`);
    lines.push(`Milestone: ${response.data.seed.milestone.title}`);
    lines.push(`Next action: ${response.data.seed.workItem.next_action}`);
    lines.push(`Mission log: ${response.data.seed.missionLog.markdown_path}`);
  }
  return lines;
}

function normalizeWorkspaceProfile(profile: string | undefined): WorkspaceProfile | null {
  if (!profile) {
    return null;
  }
  if (profile === "arcadia") {
    return profile;
  }
  throw validationError("Workspace profile is not supported.", { profile, supportedProfiles: ["arcadia"] });
}

function pathInWorkspace(workspace: string, relativePath: string): string {
  return path.join(workspace, relativePath);
}
