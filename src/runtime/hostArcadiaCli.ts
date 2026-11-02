import { accessSync, constants, lstatSync, mkdirSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/**
 * The host's own `arcadia` command for a Session whose allow list permits
 * `arcadia ...`. Only the host decides this: it searches the host process's
 * PATH, then `~/.local/bin`, and never reads a file from the Session's
 * checkout. Relative entries, anything that resolves inside the worktree, and
 * a target that is not a regular executable file or is group- or
 * world-writable are refused.
 */
export function findHostArcadia(worktree: string, hostPath = process.env.PATH ?? "", home = homedir()): string | null {
  let root: string;
  try {
    root = realpathSync(worktree);
  } catch {
    return null;
  }
  for (const entry of [...hostPath.split(":"), path.join(home, ".local", "bin")]) {
    if (!entry || !path.isAbsolute(entry)) continue;
    try {
      const target = realpathSync(path.join(entry, "arcadia"));
      const stat = statSync(target);
      if (!stat.isFile() || (stat.mode & 0o022) !== 0) continue;
      accessSync(target, constants.X_OK);
      const relative = path.relative(root, target);
      if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) continue;
      return target;
    } catch {
      continue;
    }
  }
  return null;
}

export interface HostArcadiaOptions {
  /** Test seam: the owner uid the directory must have (default: this process). */
  uid?: number;
  /** Called with the reason when a CLI was found but its directory could not be prepared. */
  onFailure?: (message: string) => void;
}

/**
 * A host-owned directory holding only an `arcadia` link to the host-resolved
 * command, under `~/.local/share/arcadia/session-bin` (outside every
 * worktree), created or refreshed atomically at each launch. A launcher that
 * names it can resolve `arcadia` independent of the worker's own PATH. It
 * removes no other PATH entry and is not a security boundary: the launcher
 * keeps the inherited `"$PATH"`. Returns null, leaving the launcher unchanged,
 * when no CLI resolves or the directory cannot be prepared safely.
 */
export function resolveHostArcadiaDirectory(
  worktree: string,
  hostPath = process.env.PATH ?? "",
  home = homedir(),
  options: HostArcadiaOptions = {}
): string | null {
  const target = findHostArcadia(worktree, hostPath, home);
  if (!target) return null;
  const directory = path.join(home, ".local", "share", "arcadia", "session-bin");
  const link = path.join(directory, "arcadia");
  const staging = `${link}.${process.pid}.tmp`;
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.uid !== (options.uid ?? process.getuid?.()) || (stat.mode & 0o022) !== 0) {
      options.onFailure?.(`${directory} is not a directory owned by this user and closed to group and world writes`);
      return null;
    }
    let current: string | null = null;
    try { current = readlinkSync(link); } catch { current = null; }
    if (current !== target) {
      rmSync(staging, { force: true });
      try {
        symlinkSync(target, staging);
        renameSync(staging, link);
      } finally {
        rmSync(staging, { force: true });
      }
    }
    return realpathSync(directory);
  } catch (error) {
    options.onFailure?.(`could not prepare ${directory}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
