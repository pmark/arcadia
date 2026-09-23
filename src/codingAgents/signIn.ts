import { execFileSync } from "node:child_process";

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
 */
export function checkProviderSignIn(provider: string): ProviderSignInStatus | null {
  if (provider === "claude-code-cli") return checkClaudeCodeSignIn();
  return null;
}

/**
 * `claude auth status --json` reads the same credential sources a launched
 * Session would (the `CLAUDE_CODE_OAUTH_TOKEN` environment variable, the
 * on-disk credentials file, and the macOS keychain) and reports `loggedIn`
 * without a network round trip, so this is a fast, local, worker-context
 * check rather than a guess from cached telemetry.
 */
function checkClaudeCodeSignIn(): ProviderSignInStatus | null {
  // Tests must not depend on this host's real Claude Code sign-in state.
  // A test that specifically exercises the preflight injects an explicit
  // `providerSignIn` override instead of relying on this default.
  if (process.env.VITEST) return null;

  const remedy = 'Sign in to Claude Code on this worker host: run "claude auth login" interactively, or "claude setup-token" for an unattended worker, then retry.';

  let raw: string;
  try {
    raw = execFileSync("claude", ["auth", "status", "--json"], {
      encoding: "utf8",
      timeout: SIGN_IN_CHECK_TIMEOUT_MS,
      maxBuffer: 1024 * 1024
    });
  } catch (error) {
    throw new Error(
      `Could not check Claude Code sign-in on this worker (${describeProbeFailure(error)}). ` +
      "This is a worker environment problem, not a confirmed sign-out, so it will not resolve on its own.",
      { cause: error }
    );
  }

  let parsed: { loggedIn?: unknown };
  try {
    parsed = JSON.parse(raw) as { loggedIn?: unknown };
  } catch (error) {
    throw new Error(
      `"claude auth status --json" produced output this worker could not parse: ${(error as Error).message}.`,
      { cause: error }
    );
  }

  return { signedIn: parsed.loggedIn === true, remedy };
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
