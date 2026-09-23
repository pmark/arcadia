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
function checkClaudeCodeSignIn(): ProviderSignInStatus {
  const remedy = 'Sign in to Claude Code on this worker host: run "claude auth login" interactively, or "claude setup-token" for an unattended worker, then retry.';
  try {
    const raw = execFileSync("claude", ["auth", "status", "--json"], {
      encoding: "utf8",
      timeout: SIGN_IN_CHECK_TIMEOUT_MS,
      maxBuffer: 1024 * 1024
    });
    const parsed = JSON.parse(raw) as { loggedIn?: unknown };
    return { signedIn: parsed.loggedIn === true, remedy };
  } catch {
    return { signedIn: false, remedy };
  }
}
