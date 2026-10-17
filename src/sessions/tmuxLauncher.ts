import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * A Session's provider command, written to a private launcher file so the tmux
 * command line stays bounded.
 *
 * tmux sends `new-session`'s whole command to its server as one client
 * message and refuses a command larger than that message limit ("command too
 * long"). The provider argv carries the full Action brief, so a realistic
 * brief made every launch fail (the 2026-10-17 supervised Claude run; very
 * likely the 2026-10-11 Codex run's "tmux could not start" too). tmux now runs
 * only `sh <launcher>`; the launcher removes itself (it holds the brief) and
 * `exec`s the exact provider argv, so the recording wrapper, its exit-status
 * record and an interactive TUI's terminal are unchanged. Provider-neutral: no
 * adapter's prompt delivery changes, and the provider argv stays within the
 * operating system's exec limit, far above tmux's.
 */
export interface SessionLauncher {
  /** The launcher file tmux runs with `sh`. */
  file: string;
  /** Remove the launcher (and its private directory, when it made one); for a launch tmux refused. */
  discard(): void;
}

/** POSIX single-quote escaping: safe for any byte a shell word can contain. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * Write `run` as a launcher (0600) in `directory` (created 0700 when missing;
 * a recorded Session passes its own run directory beside its log), or in a
 * fresh private temporary directory that the launcher removes with itself.
 */
export function writeSessionLauncher(
  run: { command: string; args: string[] },
  directory?: string
): SessionLauncher {
  let dir: string;
  let ownsDirectory: boolean;
  if (directory) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    dir = directory;
    ownsDirectory = false;
  } else {
    dir = mkdtempSync(path.join(tmpdir(), "arcadia-launch-"));
    ownsDirectory = true;
  }
  const file = path.join(dir, `launch-${randomUUID()}.sh`);
  // `sh` has already opened the file, so removing it first is safe; the
  // provider never sees it, and nothing holding the brief outlives the start.
  const cleanup = ownsDirectory ? `rm -rf -- ${shellQuote(dir)}` : `rm -f -- ${shellQuote(file)}`;
  const script = `${cleanup}\nexec ${[run.command, ...run.args].map(shellQuote).join(" ")}\n`;
  writeFileSync(file, script, { mode: 0o600, flag: "wx" });
  chmodSync(file, 0o600);
  return {
    file,
    discard() {
      rmSync(ownsDirectory ? dir : file, { recursive: true, force: true });
    }
  };
}

/** The bounded `tmux new-session` argv: name, working directory and launcher path only. */
export function tmuxNewSessionArgs(name: string, cwd: string, launcherFile: string): string[] {
  return ["new-session", "-d", "-s", name, "-c", cwd, "sh", launcherFile];
}
