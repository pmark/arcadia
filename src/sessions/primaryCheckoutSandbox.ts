import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { validationError } from "../cli/errors.js";

/** The macOS host primitive used to keep a managed agent out of primary. */
export const PRIMARY_CHECKOUT_SANDBOX_EXEC = "/usr/bin/sandbox-exec";

export interface LaunchCommand {
  command: string;
  args: string[];
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function contains(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

/**
 * A deliberately narrow host boundary: the provider retains its normal
 * sandbox and runtime environment, but cannot write the primary checkout.
 * Seatbelt resolves filesystem paths after symlinks, so a candidate symlink
 * into primary is denied by the same rule.
 */
export function primaryCheckoutSandboxProfile(repositoryPath: string, worktreePath: string): string {
  const repository = realpathSync(repositoryPath);
  const worktree = realpathSync(worktreePath);
  if (contains(repository, worktree) || contains(worktree, repository)) {
    throw validationError("The primary checkout and Session candidate must be separate paths for protected launch.", {
      code: "primary_checkout_guard_invalid_paths", repositoryPath: repository, worktreePath: worktree
    });
  }
  // Do not grant any Git path. The candidate's linked gitdir normally resolves
  // under the primary checkout and is therefore denied with the primary.
  return `(version 1)\n(allow default)\n(deny file-write* (subpath ${quote(repository)}))`;
}

/** Wrap a real provider command; fixture Sessions never represent an agent. */
export function guardPrimaryCheckoutLaunch(input: {
  repositoryPath: string;
  worktreePath: string;
  launch: LaunchCommand;
  platform?: NodeJS.Platform;
  sandboxExecutable?: string;
}): LaunchCommand {
  const platform = input.platform ?? process.platform;
  const sandboxExecutable = input.sandboxExecutable ?? PRIMARY_CHECKOUT_SANDBOX_EXEC;
  if (platform !== "darwin" || !existsSync(sandboxExecutable)) {
    throw validationError("Protected Session launch is unavailable: the macOS Seatbelt boundary is required.", {
      code: "primary_checkout_guard_unavailable", platform, sandboxExecutable
    });
  }
  return {
    command: sandboxExecutable,
    args: ["-p", primaryCheckoutSandboxProfile(input.repositoryPath, input.worktreePath), input.launch.command, ...input.launch.args]
  };
}
