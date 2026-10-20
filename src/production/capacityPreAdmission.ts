import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import {
  lastClaudeCliSelfRefreshAt,
  markClaudeUnauthorizedEpisodeSignalled,
  readClaudeUsageRefreshState,
  recordClaudeCliSelfRefresh,
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
  /** Injected Claude CLI runner for hermetic tests; under the test runner nothing runs without one. */
  runClaudeCli?: ClaudeCliRunner;
}

/** Runs the Claude CLI with these arguments within the bound; `ok` only on a clean exit. */
export type ClaudeCliRunner = (args: readonly string[], timeoutMs: number) => Promise<{ ok: boolean; detail: string }>;

/** At most one Claude CLI self-refresh per this interval, whatever its outcome. */
export const CLAUDE_CLI_SELF_REFRESH_INTERVAL_MS = 30 * 60_000;
export const CLAUDE_CLI_SELF_REFRESH_TIMEOUT_MS = 60_000;
/** The whole call: the smallest model, one turn, no tools. Its only purpose is the CLI's own token refresh. */
/**
 * Only project settings load, from an empty private cwd, so user hooks, an
 * apiKeyHelper and user MCP servers never run; no slash commands, MCP or
 * transcript either.
 */
export const CLAUDE_CLI_SELF_REFRESH_ARGS: readonly string[] = [
  "-p", "Reply with the single word ok.", "--model", "haiku", "--max-turns", "1", "--tools", "",
  "--setting-sources", "project", "--strict-mcp-config", "--no-session-persistence", "--disable-slash-commands"
];
/**
 * The only environment the call receives. Everything else -- an API key or
 * auth token (which would bill it), an injected OAuth token (which would bypass
 * the CLI's own stored sign-in), a base URL, Bedrock/Vertex or cloud
 * credentials -- never reaches it.
 */
export const CLAUDE_CLI_SELF_REFRESH_ENV_ALLOWLIST: readonly string[] = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL"];
const MAX_SELF_REFRESH_DETAIL_CHARS = 300;

/**
 * Decision 0130: before an unattended launch the worker refreshes the Claude
 * usage snapshot with a READ-ONLY check (and, on a 401, lets the Claude CLI
 * refresh its own sign-in: `selfRefreshClaudeSignIn`, issue #1616). It reads the Claude Code access token
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
  await selfRefreshClaudeSignIn(input, deadlineMs);
  signalClaudeUnauthorizedOnce(input);
  return true;
}

/**
 * Issue #1616: only the Claude CLI refreshes and stores its OAuth tokens, and
 * only when it makes an API call, so a host idle past the access token's life
 * reads 401 until someone uses Claude Code there. On a recorded 401 the worker
 * runs the CLI's own minimal call -- the CLI, which owns the credential,
 * refreshes and stores its rotated tokens itself, so the operator is never
 * signed out and Arcadia still never exchanges or writes a token -- then
 * re-reads usage once. At most once per CLAUDE_CLI_SELF_REFRESH_INTERVAL_MS
 * (recorded before the call); a failure leaves the refusal and its ping as
 * before.
 */
async function selfRefreshClaudeSignIn(input: PreAdmissionRefreshInput, deadlineMs: number): Promise<void> {
  const snapshotPath = input.deps?.snapshotPath;
  if (readClaudeUsageRefreshState(snapshotPath) !== "unauthorized") return;
  const runner = input.runClaudeCli ?? (process.env.VITEST ? null : runClaudeCliHeadless);
  if (!runner) return;
  const now = input.now ?? new Date();
  const last = lastClaudeCliSelfRefreshAt(snapshotPath);
  if (last && now.getTime() - Date.parse(last) < CLAUDE_CLI_SELF_REFRESH_INTERVAL_MS) return;
  recordClaudeCliSelfRefresh(now, "started", snapshotPath);
  const result = await runner(CLAUDE_CLI_SELF_REFRESH_ARGS, CLAUDE_CLI_SELF_REFRESH_TIMEOUT_MS).catch(() => ({ ok: false, detail: "spawn failed" }));
  recordClaudeCliSelfRefresh(now, result.ok ? "ok" : "failed", snapshotPath, result.detail);
  if (!result.ok) return;
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<void>((resolve) => { timer = setTimeout(resolve, deadlineMs); });
  try {
    await Promise.race([
      refreshClaudeCodeUsageTelemetry(input.now ?? new Date(), { force: true, ...(input.deps ? { deps: input.deps } : {}) }),
      deadline,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The worker's runner: the installed `claude`, stdin closed, a private cwd, killed at the bound. */
export const runClaudeCliHeadless: ClaudeCliRunner = (args, timeoutMs) => new Promise((resolve) => {
  const env: NodeJS.ProcessEnv = {};
  for (const name of CLAUDE_CLI_SELF_REFRESH_ENV_ALLOWLIST) if (process.env[name] !== undefined) env[name] = process.env[name];
  let cwd: string;
  try {
    cwd = mkdtempSync(path.join(os.tmpdir(), "arcadia-claude-refresh-"));
  } catch (error) {
    resolve({ ok: false, detail: `no private cwd: ${error instanceof Error ? error.message : String(error)}` });
    return;
  }
  // The kill timer exists only once the child does; finish may run before that.
  const kill: { timer?: NodeJS.Timeout } = {};
  const finish = (result: { ok: boolean; detail: string }) => {
    if (kill.timer) clearTimeout(kill.timer);
    rmSync(cwd, { recursive: true, force: true });
    resolve(result);
  };
  let stderr = "";
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn("claude", [...args], { cwd, env, stdio: ["ignore", "ignore", "pipe"] });
  } catch (error) {
    // A synchronous spawn failure (EINVAL, E2BIG) still removes the private cwd.
    finish({ ok: false, detail: `spawn failed: ${error instanceof Error ? error.message : String(error)}` });
    return;
  }
  child.stderr?.on("data", (chunk: Buffer) => { if (stderr.length < MAX_SELF_REFRESH_DETAIL_CHARS) stderr += chunk.toString("utf8"); });
  kill.timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
  child.once("error", (error) => finish({ ok: false, detail: error.message }));
  child.once("exit", (code, signal) => {
    const why = signal ? `signal ${signal}` : `exit ${String(code)}`;
    finish({ ok: code === 0, detail: code === 0 ? why : `${why}${stderr.trim() ? `: ${stderr.trim()}` : ""}` });
  });
});

export const CLAUDE_UNAUTHORIZED_PING =
  "Claude sign-in on the worker host needs renewing: Claude's usage service rejected the stored access token, so unattended Claude launches are refused. The worker asks the Claude CLI to refresh its own sign-in at most every 30 minutes; if this persists, sign in to Claude Code once on the host.";

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
