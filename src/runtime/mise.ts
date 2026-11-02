import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parse } from "smol-toml";

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

/**
 * The exact Node version `directory`'s `mise.toml` declares under `[tools]`, or
 * null for anything else. It parses the file as data and never lets mise evaluate
 * it: a candidate's `mise.toml` is Session-editable, and evaluating its templates
 * would run them on the host, outside the Session's sandbox.
 */
export function declaredMiseNodeVersion(directory: string): string | null {
  try {
    const file = path.join(directory, "mise.toml");
    if (!lstatSync(file).isFile()) return null;
    const tools = parse(readFileSync(file, "utf8")).tools as { node?: unknown } | undefined;
    return typeof tools?.node === "string" && /^\d+(?:\.\d+){0,2}$/.test(tools.node) ? tools.node : null;
  } catch {
    return null;
  }
}

/**
 * The directory of the installed Node that `directory`'s mise config pins, or
 * null when it has no plain pin or that version is not installed. A Session for
 * any Project gets that Project's pin; null leaves its PATH as it was. mise runs
 * from a neutral directory, so it loads no config from the candidate.
 */
export function miseNodeDirectory(directory: string, miseBin = resolveMiseExecutable()): string | null {
  const version = declaredMiseNodeVersion(directory);
  if (!version) return null;
  try {
    const install = execFileSync(miseBin, ["where", `node@${version}`], {
      cwd: "/",
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000
    }).trim();
    const bin = path.join(install, "bin");
    return path.isAbsolute(install) && existsSync(path.join(bin, "node")) ? bin : null;
  } catch {
    return null;
  }
}
