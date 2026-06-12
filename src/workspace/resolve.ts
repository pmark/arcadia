import { existsSync } from "node:fs";
import path from "node:path";
import { usageError } from "../cli/errors.js";
import { loadUserConfig } from "./config.js";
import { getWorkspacePaths, resolveWorkspacePath } from "./paths.js";

export type WorkspaceResolutionSource = "flag" | "environment variable" | "local marker" | "user config" | "missing";

export interface WorkspaceResolution {
  source: WorkspaceResolutionSource;
  workspacePath: string | null;
  detail?: string;
}

export interface WorkspaceResolutionInput {
  workspace?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export function resolveWorkspace(input: WorkspaceResolutionInput = {}): WorkspaceResolution {
  const env = input.env ?? process.env;
  const cwd = path.resolve(input.cwd ?? process.cwd());

  if (input.workspace?.trim()) {
    return {
      source: "flag",
      workspacePath: resolveWorkspacePath(input.workspace)
    };
  }

  if (env.ARCADIA_WORKSPACE?.trim()) {
    return {
      source: "environment variable",
      workspacePath: resolveWorkspacePath(env.ARCADIA_WORKSPACE),
      detail: "ARCADIA_WORKSPACE"
    };
  }

  const localWorkspace = findLocalWorkspace(cwd);
  if (localWorkspace) {
    return {
      source: "local marker",
      workspacePath: localWorkspace.workspacePath,
      detail: localWorkspace.marker
    };
  }

  const defaultWorkspace = loadUserConfig(env).defaultWorkspace;
  if (defaultWorkspace?.trim()) {
    return {
      source: "user config",
      workspacePath: resolveWorkspacePath(defaultWorkspace),
      detail: "defaultWorkspace"
    };
  }

  return {
    source: "missing",
    workspacePath: null,
    detail: "No --workspace flag, ARCADIA_WORKSPACE, local workspace marker, or user default configured."
  };
}

export function requireResolvedWorkspace(input: WorkspaceResolutionInput = {}): string {
  const resolution = resolveWorkspace(input);
  if (!resolution.workspacePath) {
    throw usageError([
      "Arcadia workspace is not configured.",
      "Fix it with one of:",
      "  arcadia <command> --workspace <path>",
      "  export ARCADIA_WORKSPACE=<path>",
      "  run from inside an initialized Arcadia workspace",
      "  arcadia config set defaultWorkspace <path>"
    ].join("\n"), { source: resolution.source });
  }

  return resolution.workspacePath;
}

function findLocalWorkspace(cwd: string): { workspacePath: string; marker: string } | null {
  let current = cwd;

  while (true) {
    const paths = getWorkspacePaths(current);
    if (existsSync(paths.configFile)) {
      return { workspacePath: current, marker: paths.configFile };
    }

    const dogfoodWorkspace = path.join(current, ".arcadia-workspace");
    if (existsSync(getWorkspacePaths(dogfoodWorkspace).configFile)) {
      return {
        workspacePath: dogfoodWorkspace,
        marker: path.join(dogfoodWorkspace, "config", "arcadia.json")
      };
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}
