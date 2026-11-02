import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/**
 * The directory that holds the host's `arcadia` command, for a Session whose
 * allow list permits `arcadia ...` (headless Sessions lack the interactive
 * shell PATH that reaches it).
 *
 * Only the host decides this: it searches the host process's own PATH, then the
 * user-level `~/.local/bin`, and never reads a file from the Session's
 * checkout. A directory is refused when it is relative, contains a PATH
 * separator, or resolves inside the Session's worktree, since a Session could
 * write there and replace `arcadia`. Returns null when nothing safe is found,
 * which leaves the launcher exactly as it was.
 */
export function resolveHostArcadiaDirectory(
  worktree: string,
  hostPath = process.env.PATH ?? "",
  home = homedir()
): string | null {
  let root: string;
  try {
    root = realpathSync(worktree);
  } catch {
    return null;
  }
  for (const entry of [...hostPath.split(":"), path.join(home, ".local", "bin")]) {
    if (!entry || !path.isAbsolute(entry)) continue;
    try {
      const directory = realpathSync(entry);
      const candidate = path.join(directory, "arcadia");
      if (directory.includes(":") || !statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
      const relative = path.relative(root, directory);
      if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) continue;
      return directory;
    } catch {
      continue;
    }
  }
  return null;
}
