import { existsSync } from "node:fs";
import path from "node:path";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { validationError } from "../cli/errors.js";
import { withDatabase } from "../db/connection.js";
import type { ArcadiaProjectSeedResult } from "../workspace/arcadiaProject.js";
import { seedArcadiaProject } from "../workspace/arcadiaProject.js";
import { EXPERIMENT_ALLOWED_REPO_ROOT } from "../workspace/config.js";
import { initWorkspace } from "../workspace/initWorkspace.js";
import { getWorkspacePaths } from "../workspace/paths.js";

export interface InitCommandData {
  workspacePath: string;
  databasePath: string;
  configPath: string;
  createdConfig: boolean;
  profile: WorkspaceProfile | null;
  seed: ArcadiaProjectSeedResult | null;
}

export type WorkspaceProfile = "arcadia" | "experiment";

const SUPPORTED_PROFILES: readonly WorkspaceProfile[] = ["arcadia", "experiment"];

/** The live workspace's name; the rehearsal scripts identify it by this basename. */
const LIVE_WORKSPACE_NAME = "martianrover";

export function runInitCommand(
  workspace: string,
  options: { profile?: string } = {}
): CommandSuccess<InitCommandData> {
  const profile = normalizeWorkspaceProfile(options.profile);
  if (profile === "experiment") assertExperimentTargetAvailable(workspace);
  const result = initWorkspace(workspace, profile === "experiment"
    ? { experiment: { enabled: true, allowedRepoRoot: EXPERIMENT_ALLOWED_REPO_ROOT, decision: "0082" } }
    : {});
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
  if (response.data.profile === "experiment") {
    lines.push("Profile: experiment (Decision 0082)");
    lines.push(`Fixture repositories go under: ${path.join(response.data.workspacePath, EXPERIMENT_ALLOWED_REPO_ROOT)}`);
    lines.push(`Address it inline only: ARCADIA_WORKSPACE=${response.data.workspacePath} arcadia <command>`);
  }
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
  if ((SUPPORTED_PROFILES as readonly string[]).includes(profile)) {
    return profile as WorkspaceProfile;
  }
  throw validationError("Workspace profile is not supported.", { profile, supportedProfiles: SUPPORTED_PROFILES });
}

/**
 * An experiment workspace is always brand new (Decision 0082): it can never
 * take the live workspace's name, which the rehearsal scripts trust, and never
 * reuse an existing workspace, whose data and Projects it would inherit.
 */
function assertExperimentTargetAvailable(workspace: string): void {
  const paths = getWorkspacePaths(workspace);
  if (path.basename(paths.root).toLowerCase() === LIVE_WORKSPACE_NAME) {
    throw validationError(`An experiment workspace can never be named ${LIVE_WORKSPACE_NAME}.`, {
      workspace: paths.root,
      alternative: "Choose a disposable name such as exp-<agent>-<yyyymmdd>."
    });
  }
  // Nested inside another workspace, the experiment would be shadowed by (or
  // shadow) that workspace in cwd-based resolution, and could sit inside the
  // live one.
  for (let ancestor = path.dirname(paths.root); ; ancestor = path.dirname(ancestor)) {
    const ancestorConfig = getWorkspacePaths(ancestor).configFile;
    if (existsSync(ancestorConfig)) {
      throw validationError("An experiment workspace cannot be created inside another workspace.", {
        workspace: paths.root,
        enclosingWorkspace: ancestor,
        alternative: "Choose a directory outside every existing workspace, such as /Users/pmark/Dev/MR/Arcadia/workspaces/exp-<agent>-<yyyymmdd>."
      });
    }
    if (path.dirname(ancestor) === ancestor) break;
  }
  for (const existing of [paths.databaseFile, paths.configFile]) {
    if (existsSync(existing)) {
      throw validationError("An experiment workspace must be created fresh; this path already holds a workspace.", {
        workspace: paths.root,
        existing,
        alternative: "Choose a new, empty directory."
      });
    }
  }
}

function pathInWorkspace(workspace: string, relativePath: string): string {
  return path.join(workspace, relativePath);
}
