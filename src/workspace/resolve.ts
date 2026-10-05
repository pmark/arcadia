import { existsSync } from "node:fs";
import path from "node:path";
import { ArcadiaError, usageError } from "../cli/errors.js";
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

/**
 * The opt-in "inline workspace required" mode. With it on, resolution accepts
 * only a workspace the command itself names -- `--workspace`, an
 * `ARCADIA_WORKSPACE` value, or an initialized workspace at or above the
 * working directory -- and refuses the two silent fallbacks: the user config
 * `defaultWorkspace` and the repo-local `.arcadia-workspace` marker. A coding
 * agent working beside the live workspace turns it on for its own shell, so a
 * command it forgot to inline fails by name instead of resolving the live
 * default and writing there (pmark/arcadia#947).
 *
 * It cannot tell an inline `ARCADIA_WORKSPACE=<path> arcadia …` from an
 * exported one: both are an environment variable by the time Node reads it.
 * Exporting stays discouraged, and the operator scripts that resolve from the
 * user config still refuse an exported value themselves.
 */
export const REQUIRE_INLINE_WORKSPACE_VARIABLE = "ARCADIA_REQUIRE_INLINE_WORKSPACE";

const TRUTHY = new Set(["1", "true", "yes", "on"]);

/** Whether the mode is on: `1`, `true`, `yes` or `on`, in any case. Anything else, including unset or empty, is off. */
export function inlineWorkspaceRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return TRUTHY.has(env[REQUIRE_INLINE_WORKSPACE_VARIABLE]?.trim().toLowerCase() ?? "");
}

export const INLINE_WORKSPACE_REMEDY =
  "Name the workspace on this command: pass --workspace <path>, or set it inline as ARCADIA_WORKSPACE=<path> arcadia <command> " +
  "(never exported), or run from inside an initialized workspace.";

/** The refusal the mode raises in place of a fallback; `details` carries `code` and `remedy` like other refusals. */
export function inlineWorkspaceRequiredError(fallback: WorkspaceResolution): ArcadiaError {
  const what = fallback.source === "user config" ? "the user config defaultWorkspace" : "the repo-local .arcadia-workspace marker";
  return new ArcadiaError(
    "INLINE_WORKSPACE_REQUIRED",
    `${REQUIRE_INLINE_WORKSPACE_VARIABLE} is on, so Arcadia will not fall back to ${what} (${fallback.workspacePath}). ` +
      "Pass --workspace <path> or set ARCADIA_WORKSPACE=<path> inline on this command.",
    2,
    {
      code: "INLINE_WORKSPACE_REQUIRED",
      variable: REQUIRE_INLINE_WORKSPACE_VARIABLE,
      refusedSource: fallback.source,
      refusedWorkspace: fallback.workspacePath,
      refusedDetail: fallback.detail,
      remedy: INLINE_WORKSPACE_REMEDY
    }
  );
}

/**
 * Resolves the workspace a command targets. This is the one resolver every
 * caller uses (the CLI, the activity recorder, the experiment guard, the
 * broker and session transports), so the inline mode is enforced here and
 * nowhere else: with it on, a resolution that would come from the user config
 * default or the dogfood marker throws `INLINE_WORKSPACE_REQUIRED` instead.
 * With it off this returns exactly what it always has.
 */
export function resolveWorkspace(input: WorkspaceResolutionInput = {}): WorkspaceResolution {
  const env = input.env ?? process.env;
  const { resolution, fallback } = resolveWorkspaceSource(input, env);
  if (fallback && inlineWorkspaceRequired(env)) {
    throw inlineWorkspaceRequiredError(resolution);
  }
  return resolution;
}

function resolveWorkspaceSource(
  input: WorkspaceResolutionInput,
  env: NodeJS.ProcessEnv
): { resolution: WorkspaceResolution; fallback: boolean } {
  const explicit = (resolution: WorkspaceResolution) => ({ resolution, fallback: false });
  const cwd = path.resolve(input.cwd ?? invocationCwd(env));

  if (input.workspace?.trim()) {
    return explicit({
      source: "flag",
      workspacePath: resolveWorkspacePath(input.workspace)
    });
  }

  if (env.ARCADIA_WORKSPACE?.trim()) {
    return explicit({
      source: "environment variable",
      workspacePath: resolveWorkspacePath(env.ARCADIA_WORKSPACE),
      detail: "ARCADIA_WORKSPACE"
    });
  }

  // An explicit workspace at or above `cwd` -- the operator is standing
  // inside a real, initialized workspace -- always wins. It is checked in a
  // full walk to the filesystem root before anything else, including the
  // user's configured default, because it is the strongest possible signal:
  // nobody ends up inside a workspace directory by accident.
  const directWorkspace = findDirectWorkspace(cwd);
  if (directWorkspace) {
    return explicit({
      source: "local marker",
      workspacePath: directWorkspace.workspacePath,
      detail: directWorkspace.marker
    });
  }

  const defaultWorkspace = loadUserConfig(env).defaultWorkspace;
  if (defaultWorkspace?.trim()) {
    return {
      fallback: true,
      resolution: {
        source: "user config",
        workspacePath: resolveWorkspacePath(defaultWorkspace),
        detail: "defaultWorkspace"
      }
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
      fallback: true,
      resolution: {
        source: "local marker",
        workspacePath: dogfoodWorkspace.workspacePath,
        detail: dogfoodWorkspace.marker,
        warning:
          `Using repo-local dogfood workspace at ${dogfoodWorkspace.workspacePath} because no ` +
          "--workspace flag, ARCADIA_WORKSPACE, or defaultWorkspace is configured. This workspace " +
          "is separate from any shared or long-running workspace and may hold stub data -- run " +
          "`arcadia config set defaultWorkspace <path>` if that was not intended."
      }
    };
  }

  return explicit({
    source: "missing",
    workspacePath: null,
    detail: "No --workspace flag, ARCADIA_WORKSPACE, local workspace marker, or user default configured."
  });
}

/**
 * What `arcadia workspace resolve` reports: the resolution, whether the
 * inline mode is on, and -- when the mode refused a fallback -- the refusal
 * in place of a workspace. It never throws for the mode, so the diagnostic
 * stays usable while the mode is on.
 */
export interface WorkspaceResolutionReport extends WorkspaceResolution {
  inlineWorkspaceRequired: boolean;
  refused?: { code: "INLINE_WORKSPACE_REQUIRED"; message: string; source: WorkspaceResolutionSource; workspacePath: string | null; remedy: string };
}

export function reportWorkspaceResolution(input: WorkspaceResolutionInput = {}): WorkspaceResolutionReport {
  const env = input.env ?? process.env;
  const required = inlineWorkspaceRequired(env);
  const { resolution, fallback } = resolveWorkspaceSource(input, env);
  if (!(fallback && required)) return { ...resolution, inlineWorkspaceRequired: required };
  const error = inlineWorkspaceRequiredError(resolution);
  return {
    source: "missing",
    workspacePath: null,
    detail: error.message,
    inlineWorkspaceRequired: true,
    refused: {
      code: "INLINE_WORKSPACE_REQUIRED",
      message: error.message,
      source: resolution.source,
      workspacePath: resolution.workspacePath,
      remedy: INLINE_WORKSPACE_REMEDY
    }
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
