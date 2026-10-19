import type Database from "better-sqlite3";
import {
  markClaudeUnauthorizedEpisodeSignalled,
  refreshClaudeCodeUsageTelemetry,
  unsignalledClaudeUnauthorizedEpisode,
  type ClaudeUsageRefreshDependencies,
} from "../codingAgents/availability.js";
import type { CodingAgentProfile } from "../intent/registries.js";
import { queueOperatorPing } from "../ping/operatorPing.js";
import { loadWorkspaceConfig, unmeteredProviderSelector } from "../workspace/config.js";
import { getWorkspacePaths } from "../workspace/paths.js";
import { readProductionPolicySafely } from "./policy.js";

export const CLAUDE_PROVIDER_ID = "claude-code-cli";

export interface PreAdmissionRefreshInput {
  db: Database.Database;
  workspacePath: string;
  profiles: CodingAgentProfile[];
  now?: Date;
  /** Injected collaborators for hermetic tests; never set by the worker. */
  deps?: ClaudeUsageRefreshDependencies;
  /** Test override for the workspace's unmetered-provider selection. */
  unmeteredProvider?: "all" | readonly string[] | null;
}

/**
 * Decision 0130: before an unattended launch the worker refreshes the Claude
 * usage snapshot with a READ-ONLY check. It reads the Claude Code access token
 * and calls only the usage endpoint; a 401 is recorded as `unauthorized` and
 * the OAuth token endpoint is never contacted (no caller can exchange the
 * refresh token, issue #1559), so the operator's sign-in is never rotated.
 *
 * Early warning: the first time the reading turns `unauthorized` after a good
 * (or no) reading, one attention ping names the sign-in remedy. The episode is
 * marked signalled in the snapshot, so later ticks stay quiet until a good
 * reading closes it.
 *
 * Bounded: the refresher's own 5-minute cooldown caps the call rate and the
 * attempt is held to `CAPACITY_ADMISSION_LIMITS.refreshDeadlineMs`. A failure
 * leaves the stale snapshot in place, which admission then refuses (fail
 * closed). Returns whether a refresh was attempted.
 */
export async function refreshClaudeCapacityBeforeAdmission(
  input: PreAdmissionRefreshInput,
  deadlineMs: number,
): Promise<boolean> {
  if (!input.profiles.some((profile) => profile.provider === CLAUDE_PROVIDER_ID)) return false;
  const policy = readProductionPolicySafely(input.db);
  if (policy.status !== "ok" || policy.policy.desiredState !== "active") return false;

  const unmetered = input.unmeteredProvider !== undefined
    ? input.unmeteredProvider
    : unmeteredProviderSelector(loadWorkspaceConfig(getWorkspacePaths(input.workspacePath).configFile).codingAgent);
  if (unmetered === "all" || (Array.isArray(unmetered) && unmetered.includes(CLAUDE_PROVIDER_ID))) return false;

  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<void>((resolve) => { timer = setTimeout(resolve, deadlineMs); });
  try {
    await Promise.race([
      refreshClaudeCodeUsageTelemetry(input.now ?? new Date(), input.deps ? { deps: input.deps } : {}),
      deadline,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  signalClaudeUnauthorizedOnce(input);
  return true;
}

export const CLAUDE_UNAUTHORIZED_PING =
  "Claude sign-in on the worker host needs renewing: Claude's usage service rejected the stored access token, so unattended Claude launches are refused. Sign in to Claude Code once on the host; Arcadia only reads the access token and never refreshes it.";

function signalClaudeUnauthorizedOnce(input: PreAdmissionRefreshInput): void {
  const snapshotPath = input.deps?.snapshotPath;
  const episode = unsignalledClaudeUnauthorizedEpisode(snapshotPath);
  if (!episode) return;
  try {
    queueOperatorPing(input.db, {
      message: CLAUDE_UNAUTHORIZED_PING,
      kind: "attention",
      agent: "production-worker",
      ...(input.now ? { now: input.now } : {}),
    });
  } catch {
    // The hourly cap or an unready table must not block admission; the tick's
    // launch-refusal ping still names the remedy. Retry on the next pass.
    return;
  }
  markClaudeUnauthorizedEpisodeSignalled(episode.since, snapshotPath);
}
