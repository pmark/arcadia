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
  /**
   * Set when the resolution is trustworthy but worth a second look -- today,
   * only when a repo-local `.arcadia-workspace` dogfood marker was used
   * because nothing more authoritative was configured. Callers that print
   * resolution results to the operator should surface this.
   */
  warning?: string;
}

export interface WorkspaceResolutionInput {
  workspace?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export function resolveWorkspace(input: WorkspaceResolutionInput = {}): WorkspaceResolution {
  const env = input.env ?? process.env;
  const cwd = path.resolve(input.cwd ?? invocationCwd(env));

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

  // An explicit workspace at or above `cwd` -- the operator is standing
  // inside a real, initialized workspace -- always wins. It is checked in a
  // full walk to the filesystem root before anything else, including the
  // user's configured default, because it is the strongest possible signal:
  // nobody ends up inside a workspace directory by accident.
  const directWorkspace = findDirectWorkspace(cwd);
  if (directWorkspace) {
    return {
      source: "local marker",
      workspacePath: directWorkspace.workspacePath,
      detail: directWorkspace.marker
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

  // The `.arcadia-workspace` dogfood marker is a repo-local convenience (see
  // docs/dogfooding.md) that a handful of commands create automatically. It
  // is intentionally checked last, after the user's configured default: a
  // fresh, disconnected dogfood workspace living inside this checkout must
  // never silently outrank a real, long-running default workspace just
  // because this command happened to run from inside the Arcadia repo.
  const dogfoodWorkspace = findDogfoodWorkspace(cwd);
  if (dogfoodWorkspace) {
    return {
      source: "local marker",
      workspacePath: dogfoodWorkspace.workspacePath,
      detail: dogfoodWorkspace.marker,
      warning:
        `Using repo-local dogfood workspace at ${dogfoodWorkspace.workspacePath} because no ` +
        "--workspace flag, ARCADIA_WORKSPACE, or defaultWorkspace is configured. This workspace " +
        "is separate from any shared or long-running workspace and may hold stub data -- run " +
        "`arcadia config set defaultWorkspace <path>` if that was not intended."
    };
  }

  return {
    source: "missing",
    workspacePath: null,
    detail: "No --workspace flag, ARCADIA_WORKSPACE, local workspace marker, or user default configured."
  };
}

/**
 * The directory a command should search from when nothing more specific was
 * given. `scripts/arcadia` changes directory into Arcadia's own checkout
 * before running the CLI, so `process.cwd()` answers for the runtime rather
 * than the operator; it records the real directory in `ARCADIA_INVOKED_FROM`
 * first (see `src/cli/invocation.ts`, which does the same for document
 * resolution). A stale or deleted directory falls back to `process.cwd()`
 * rather than silently redirecting the search somewhere else.
 */
function invocationCwd(env: NodeJS.ProcessEnv): string {
  const declared = env.ARCADIA_INVOKED_FROM?.trim();
  if (!declared) return process.cwd();
  return existsSync(declared) ? declared : process.cwd();
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

  if (resolution.warning) {
    process.stderr.write(`Warning: ${resolution.warning}\n`);
  }

  return resolution.workspacePath;
}

function findDirectWorkspace(cwd: string): { workspacePath: string; marker: string } | null {
  let current = cwd;

  while (true) {
    const paths = getWorkspacePaths(current);
    if (existsSync(paths.configFile)) {
      return { workspacePath: current, marker: paths.configFile };
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function findDogfoodWorkspace(cwd: string): { workspacePath: string; marker: string } | null {
  let current = cwd;

  while (true) {
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
