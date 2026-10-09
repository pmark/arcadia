import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getWorkspacePaths } from "../workspace/paths.js";

/**
 * Where a Session's complete record lives, and the shell wrapper that writes
 * it.
 *
 * Every headless Session's combined stdout and stderr is appended to one
 * per-Session log under the WORKSPACE (never the repository, so a candidate
 * can never commit it), and the provider process's exit code is written to
 * `agent_sessions.exit_status`. Both survive the tmux Session: a crash is
 * distinguishable from a clean exit without a live pane.
 */

/** Everything the wrapper needs to record one Session. */
export interface SessionRecording {
  sessionId: string;
  /** Append-only combined output of the provider process. */
  logFile: string;
  /** The workspace SQLite database that holds `agent_sessions`. */
  databaseFile: string;
}

/** The directory (under the workspace's runtime `.arcadia` directory, beside `worker.log`) that holds Session records. */
export function sessionRecordDirectory(workspace: string): string {
  return path.join(getWorkspacePaths(workspace).root, ".arcadia", "sessions");
}

/** `<workspace>/.arcadia/sessions/<session id>.log` */
export function sessionLogPath(workspace: string, sessionId: string): string {
  return path.join(sessionRecordDirectory(workspace), `${sessionId}.log`);
}

/** `<workspace>/.arcadia/sessions/<session id>.settings.json`: the headless permission allow list for one Session. */
export function sessionSettingsPath(workspace: string, sessionId: string): string {
  return path.join(sessionRecordDirectory(workspace), `${sessionId}.settings.json`);
}

export function sessionRecordingFor(workspace: string, sessionId: string): SessionRecording {
  return {
    sessionId,
    logFile: sessionLogPath(workspace, sessionId),
    databaseFile: getWorkspacePaths(workspace).databaseFile
  };
}

/**
 * Resolved only relative to this compiled module, exactly like the fixture
 * agent script: the build copies `scripts/record-session-exit.mjs` to
 * `dist/scripts/`, so this resolves identically under `tsx` and under the
 * compiled CLI.
 */
export function recordExitScriptPath(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const fromModule = path.resolve(moduleDir, "..", "..", "scripts", "record-session-exit.mjs");
  if (existsSync(fromModule)) return fromModule;
  throw new Error(`Could not find the bundled record-session-exit.mjs script at ${fromModule}.`);
}

/**
 * The POSIX `sh` program that runs a provider command, tees its combined
 * output to the Session log and the tmux pane, and records the provider's own
 * exit code. It uses only POSIX features (no pipefail, PIPESTATUS, process
 * substitution or arrays), so it runs under macOS's /bin/sh (bash 3.2 in
 * POSIX mode), dash and zsh's sh emulation alike.
 *
 * The provider runs in a subshell whose last act is to write `$?` to a status
 * file, because a pipeline's own status is `tee`'s. The wrapper then reads the
 * status file, appends a final line to the log, records the exit code, and
 * exits with it. Positional parameters: log file, database file, session id,
 * node executable, record script, then the provider command and its arguments.
 */
const RECORDING_SCRIPT = [
  'log=$1; db=$2; sid=$3; node=$4; rec=$5; shift 5',
  'statusfile="$log.status"',
  'if mkdir -p "$(dirname "$log")" && : >> "$log"; then',
  '  rm -f "$statusfile"',
  '  ( "$@" 2>&1; echo "$?" > "$statusfile" ) | tee -a "$log"',
  '  rc=$(cat "$statusfile" 2>/dev/null)',
  '  case "$rc" in ""|*[!0-9]*) rc=1 ;; esac',
  '  rm -f "$statusfile"',
  '  printf \'arcadia: provider exited with status %s\\n\' "$rc" | tee -a "$log"',
  'else',
  '  rc=73',
  '  printf \'arcadia: cannot append to the session log %s\\n\' "$log" >&2',
  'fi',
  '"$node" "$rec" --db "$db" --session-id "$sid" --exit-status "$rc" || printf \'arcadia: could not record exit status %s for %s\\n\' "$rc" "$sid" >&2',
  'exit "$rc"'
].join("\n");

/** Wrap `launch` so tmux runs it through the recording shell program. */
export function wrapRecordedLaunch(
  launch: { command: string; args: string[] },
  recording: SessionRecording,
  nodeExecutable: string = process.execPath
): { command: string; args: string[] } {
  return {
    command: "sh",
    args: [
      "-c", RECORDING_SCRIPT, "arcadia-session",
      recording.logFile, recording.databaseFile, recording.sessionId, nodeExecutable, recordExitScriptPath(),
      launch.command, ...launch.args
    ]
  };
}
