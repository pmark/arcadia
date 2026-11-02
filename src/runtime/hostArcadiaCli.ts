import { accessSync, constants, lstatSync, mkdirSync, readlinkSync, realpathSync, renameSync, statSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/**
 * The host's own `arcadia` command for a Session whose allow list permits
 * `arcadia ...` (a headless Session lacks the interactive shell PATH that
 * reaches it). Only the host decides this: it searches the host process's PATH,
 * then `~/.local/bin`, and never reads a file from the Session's checkout.
 * Relative entries and anything that resolves inside the worktree are refused,
 * since a Session could write there and replace `arcadia`.
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
      if (!statSync(target).isFile()) continue;
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

/**
 * A host-owned directory holding only an `arcadia` link to the host-resolved
 * command, so a Session's PATH reaches `arcadia` and nothing else that lives
 * beside it (`~/.local/bin` also holds other coding agents and model tools).
 * It sits under `~/.local/share/arcadia`, outside every worktree, and is
 * created or refreshed (atomically) at each launch. Returns null, leaving the
 * launcher unchanged, when no CLI resolves or the directory cannot be made.
 */
export function resolveHostArcadiaDirectory(
  worktree: string,
  hostPath = process.env.PATH ?? "",
  home = homedir()
): string | null {
  const target = findHostArcadia(worktree, hostPath, home);
  if (!target) return null;
  try {
    const directory = path.join(home, ".local", "share", "arcadia", "session-bin");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o022) !== 0) return null;
    const link = path.join(directory, "arcadia");
    let current: string | null = null;
    try { current = readlinkSync(link); } catch { current = null; }
    if (current !== target) {
      const staging = `${link}.${process.pid}.tmp`;
      try { lstatSync(staging); } catch { /* absent */ }
      symlinkSync(target, staging);
      renameSync(staging, link);
    }
    return realpathSync(directory);
  } catch {
    return null;
  }
}
