import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import path from "node:path";

export type ClaudeCodeTokenFileResult =
  | { status: "absent" }
  | { status: "ok"; token: string }
  | { status: "refused"; reason: string; remedy: string };

/**
 * Generous enough for any real OAuth token, small enough that a worker never
 * buffers something else entirely if the documented path is misconfigured.
 */
const MAX_TOKEN_FILE_BYTES = 8192;

/**
 * Reads the operator's `CLAUDE_CODE_OAUTH_TOKEN` value from the one documented
 * file under the workspace config directory, refusing (never silently
 * ignoring) a file that cannot be trusted as a plain, private secret: a
 * symlink that escapes `configDir`, anything readable by group or others, or
 * an empty file. Returns `absent` only when nothing exists at `filePath` at
 * all, so callers can fall back to another sign-in source.
 */
export function readClaudeCodeTokenFile(filePath: string, configDir: string): ClaudeCodeTokenFileResult {
  let lstat;
  try {
    lstat = lstatSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "absent" };
    throw error;
  }

  let targetPath = filePath;
  if (lstat.isSymbolicLink()) {
    let real: string;
    try {
      real = realpathSync(filePath);
    } catch {
      return {
        status: "refused",
        reason: "is a symlink whose target could not be resolved",
        remedy: `Replace the symlink at ${filePath} with the token file itself.`
      };
    }
    const realConfigDir = realpathSync(configDir);
    const withinConfigDir = real === realConfigDir || real.startsWith(realConfigDir + path.sep);
    if (!withinConfigDir) {
      return {
        status: "refused",
        reason: "is a symlink pointing outside the workspace config directory",
        remedy: `Replace the symlink at ${filePath} with the token file itself, or point it at a file inside ${configDir}.`
      };
    }
    targetPath = real;
  }

  let fd: number;
  try {
    fd = openSync(targetPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "absent" };
    throw error;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) {
      return {
        status: "refused",
        reason: "is not a regular file",
        remedy: `Write the token as plain text to ${filePath}.`
      };
    }
    if ((stat.mode & 0o077) !== 0) {
      return {
        status: "refused",
        reason: "is readable or writable by group or others",
        remedy: `Run "chmod 600 ${filePath}" and retry.`
      };
    }
    if (stat.size === 0) {
      return {
        status: "refused",
        reason: "is empty",
        remedy: `Run "claude setup-token", write the printed token to ${filePath}, then "chmod 600 ${filePath}".`
      };
    }
    if (stat.size > MAX_TOKEN_FILE_BYTES) {
      return {
        status: "refused",
        reason: `is larger than the ${MAX_TOKEN_FILE_BYTES}-byte limit for a token file`,
        remedy: `Confirm ${filePath} contains only the token printed by "claude setup-token", then retry.`
      };
    }
    const buffer = Buffer.alloc(stat.size);
    readSync(fd, buffer, 0, stat.size, 0);
    const token = buffer.toString("utf8").trim();
    if (!token) {
      return {
        status: "refused",
        reason: "is empty",
        remedy: `Run "claude setup-token", write the printed token to ${filePath}, then "chmod 600 ${filePath}".`
      };
    }
    return { status: "ok", token };
  } finally {
    closeSync(fd);
  }
}
