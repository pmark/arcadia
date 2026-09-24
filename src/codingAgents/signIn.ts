import { execFileSync } from "node:child_process";
import { readClaudeCodeTokenFile } from "./claudeCodeToken.js";
import { getWorkspacePaths } from "../workspace/paths.js";

export interface ProviderSignInStatus {
  signedIn: boolean;
  /** What the operator or worker owner must do to restore sign-in, in one sentence. */
  remedy: string;
}

const SIGN_IN_CHECK_TIMEOUT_MS = 5_000;

/**
 * Checks whether `provider` is signed in from this worker process's own
 * environment -- the same process `launchGuardedHostSession` runs in --
 * synchronously and without spawning a launch. Returns `null` when no check
 * is documented for `provider` yet: launch proceeds exactly as it did before
 * this preflight existed, rather than refusing on an unverifiable guess.
 *
 * Throws when the probe itself could not run to a confirmed answer (the
 * executable is missing, times out, or returns something unparsable): that is
 * a broken worker environment, not a confirmed sign-out, and must be reported
 * and repaired rather than retried for free forever under the sign-in remedy.
 *
 * `workspace`, when given, lets the claude-code-cli check short-circuit to a
 * confirmed sign-in from the documented workspace token file instead of
 * shelling out -- see `readClaudeCodeTokenFile`. A refused file (wrong
 * permissions, empty, a symlink escaping the config directory) throws rather
 * than falling back silently, so a misconfigured file is never mistaken for
 * "no file present."
 */
export function checkProviderSignIn(provider: string, workspace?: string): ProviderSignInStatus | null {
  if (provider === "claude-code-cli") return checkClaudeCodeSignIn(workspace);
  return null;
}

/**
 * `claude auth status --json` reads the same credential sources a launched
 * Session would (the `CLAUDE_CODE_OAUTH_TOKEN` environment variable, the
 * on-disk credentials file, and the macOS keychain) and reports `loggedIn`
 * without a network round trip, so this is a fast, local, worker-context
 * check rather than a guess from cached telemetry.
 *
 * The CLI exits nonzero when it finds no sign-in, so `execFileSync` throws
 * even on a clean, confirmed "signed out" result -- but the thrown error
 * still carries the JSON verdict on its `stdout`. A confirmed verdict is
 * read from `stdout` whether or not the process exited zero; only when no
 * verdict can be read at all is this treated as a probe failure.
 */
function checkClaudeCodeSignIn(workspace?: string): ProviderSignInStatus | null {
  // Tests must not depend on this host's real Claude Code sign-in state.
  // A test that specifically exercises the preflight injects an explicit
  // `providerSignIn` override instead of relying on this default.
  if (process.env.VITEST) return null;

  const remedy = 'Sign in to Claude Code on this worker host: run "claude auth login" interactively, or for an unattended worker run "claude setup-token" and write its printed token to the workspace\'s documented Claude Code token file (setup-token only prints the token; it does not save it), then retry.';

  if (workspace) {
    const paths = getWorkspacePaths(workspace);
    const tokenFile = readClaudeCodeTokenFile(paths.claudeCodeTokenFile, paths.config);
    if (tokenFile.status === "refused") {
      throw new Error(
        `The Claude Code token file at ${paths.claudeCodeTokenFile} ${tokenFile.reason}. ${tokenFile.remedy}`
      );
    }
    if (tokenFile.status === "ok") {
      return { signedIn: true, remedy };
    }
    // "absent": no documented token file, fall through to the CLI probe below.
  }

  try {
    const raw = execFileSync("claude", ["auth", "status", "--json"], {
      encoding: "utf8",
      timeout: SIGN_IN_CHECK_TIMEOUT_MS,
      maxBuffer: 1024 * 1024
    });
    const confirmed = readLoggedInVerdict(raw);
    if (confirmed === null) {
      throw new Error('"claude auth status --json" produced output this worker could not parse.');
    }
    return { signedIn: confirmed, remedy };
  } catch (error) {
    const stdout = readStdout(error);
    const confirmed = stdout !== null ? readLoggedInVerdict(stdout) : null;
    if (confirmed !== null) return { signedIn: confirmed, remedy };

    throw new Error(
      `Could not check Claude Code sign-in on this worker (${describeProbeFailure(error)}). ` +
      "This is a worker environment problem, not a confirmed sign-out, so it will not resolve on its own.",
      { cause: error }
    );
  }
}

/** Extracts a confirmed `loggedIn` verdict from `claude auth status --json` output, or `null` if it cannot be read. */
function readLoggedInVerdict(raw: string): boolean | null {
  try {
    const parsed = JSON.parse(raw) as { loggedIn?: unknown };
    return typeof parsed.loggedIn === "boolean" ? parsed.loggedIn : null;
  } catch {
    return null;
  }
}

/** `execFileSync`'s thrown error on a nonzero exit still carries the process's captured stdout. */
function readStdout(error: unknown): string | null {
  const stdout = (error as { stdout?: string | Buffer | null } | null)?.stdout;
  if (!stdout) return null;
  return typeof stdout === "string" ? stdout : stdout.toString("utf8");
}

/** Distinguishes why the sign-in probe itself failed to run, for a diagnosable failure message. */
function describeProbeFailure(error: unknown): string {
  const err = error as NodeJS.ErrnoException & { status?: number | null; signal?: string | null };
  if (err?.code === "ENOENT") return 'the "claude" executable was not found on this worker\'s PATH';
  if (err?.code === "EACCES" || err?.code === "EPERM") return `permission denied launching "claude" (${err.code})`;
  if (err?.signal) return `the probe was killed by signal ${err.signal}, likely a timeout`;
  if (typeof err?.status === "number") return `"claude auth status" exited with status ${err.status}`;
  return err instanceof Error ? err.message : String(error);
}
