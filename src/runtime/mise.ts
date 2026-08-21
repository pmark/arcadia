import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Where mise lives, and the PATH a launch agent needs so that mise's runtime
 * wins.
 *
 * Every generated launch agent and helper script goes through here. The point
 * is that there is exactly one answer to "which Node does background Arcadia
 * run under", and it is always "whatever mise.toml pins" -- never whatever
 * happened to be on PATH when someone ran the installer. A plist is written
 * once and read for months; the environment it was written in is not a fact
 * worth preserving.
 */
export function resolveMiseExecutable(home = homedir()): string {
  const configured = process.env.ARCADIA_MISE_BIN?.trim();
  if (configured) return path.resolve(configured);

  const candidates = process.arch === "arm64"
    ? ["/opt/homebrew/bin/mise", "/usr/local/bin/mise", path.join(home, ".local", "bin", "mise")]
    : ["/usr/local/bin/mise", "/opt/homebrew/bin/mise", path.join(home, ".local", "bin", "mise")];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

/**
 * A PATH led by mise's own directory.
 *
 * `mise exec -- node` still resolves `node` through PATH, so a PATH inherited
 * from an nvm or Homebrew shell shadows the runtime mise just selected. Leading
 * with mise's directory and then a short, predictable tail keeps that from
 * happening, and keeps the plist independent of the installing shell.
 */
export function miseLeadingPath(miseBin: string, home = homedir()): string {
  return [...new Set([
    path.dirname(miseBin),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(home, "Library", "pnpm", "bin"),
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin"
  ])].join(":");
}

/**
 * The argv prefix that runs a Node entrypoint under the pinned runtime,
 * resolved from `repositoryRoot` so mise reads that repository's `mise.toml`
 * rather than the caller's working directory.
 */
export function miseNodeArgv(miseBin: string, repositoryRoot: string): string[] {
  return [miseBin, "-C", repositoryRoot, "exec", "--", "node"];
}
