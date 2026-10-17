import type Database from "better-sqlite3";
import {
  refreshClaudeCodeUsageTelemetry,
  type ClaudeUsageRefreshDependencies,
} from "../codingAgents/availability.js";
import type { CodingAgentProfile } from "../intent/registries.js";
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
 * and calls only the usage endpoint; `allowTokenRefresh: false` means a 401 is
 * recorded as `unauthorized` and the OAuth token endpoint is never contacted,
 * so the operator's refresh token is never exchanged or rotated.
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
      refreshClaudeCodeUsageTelemetry(input.now ?? new Date(), {
        allowTokenRefresh: false,
        ...(input.deps ? { deps: input.deps } : {}),
      }),
      deadline,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  return true;
}
