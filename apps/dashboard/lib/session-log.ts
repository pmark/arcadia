import { lstat, open } from "node:fs/promises";
import path from "node:path";

/** First read without an offset: the last 64 KiB is plenty for a live tail. */
export const INITIAL_TAIL_BYTES = 64 * 1024;
/** Never send more than this in one poll, even after a long gap. */
export const MAX_CHUNK_BYTES = 256 * 1024;

const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;

export interface SessionLogTail {
  available: boolean;
  /** Workspace-relative path that was read (or would be). */
  path: string;
  /** File size when read; pass it back as the next `offset`. */
  size: number;
  /** Byte offset `text` starts at. */
  from: number;
  text: string;
  /** True when earlier output exists that this response skipped. */
  truncated: boolean;
  /** True when the requested offset was past the end (the file was replaced), so the client must discard what it holds. */
  reset: boolean;
}

export function sessionLogRelativePath(sessionId: string): string {
  return path.posix.join(".arcadia", "sessions", `${sessionId}.log`);
}

/**
 * Read the tail of one Session's log, or what was appended after `offset`.
 * The id is validated against a strict pattern, so the path can never leave
 * `<workspace>/.arcadia/sessions/`.
 */
export async function readSessionLogTail(
  workspace: string,
  sessionId: string,
  offset: number | null
): Promise<{ ok: true; value: SessionLogTail } | { ok: false; error: string }> {
  if (!SESSION_ID.test(sessionId)) return { ok: false, error: "Invalid Session id." };
  const relative = sessionLogRelativePath(sessionId);
  const absolute = path.join(workspace, relative);
  let size: number;
  try {
    const info = await lstat(absolute);
    if (!info.isFile()) return { ok: true, value: missing(relative) };
    size = info.size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ok: true, value: missing(relative) };
    throw error;
  }

  const reset = offset !== null && offset > size;
  let from = offset === null || reset ? Math.max(0, size - INITIAL_TAIL_BYTES) : offset;
  if (size - from > MAX_CHUNK_BYTES) from = size - MAX_CHUNK_BYTES;
  const truncated = from > (offset === null || reset ? 0 : offset);

  const length = size - from;
  let text = "";
  if (length > 0) {
    const handle = await open(absolute, "r");
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, from);
      text = buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close();
    }
  }
  return { ok: true, value: { available: true, path: relative, size, from, text, truncated, reset } };
}

function missing(relative: string): SessionLogTail {
  return { available: false, path: relative, size: 0, from: 0, text: "", truncated: false, reset: false };
}
