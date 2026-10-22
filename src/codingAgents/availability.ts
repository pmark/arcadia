import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { observeCodexTasks } from "../codex/observer.js";
import type { CodingAgentProfile } from "../intent/registries.js";
import { codingAgentLabel } from "./adapters.js";

const execFileAsync = promisify(execFile);
const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_USAGE_REFRESH_COOLDOWN_MS = 5 * 60_000;
const CLAUDE_KEYCHAIN_SERVICES = ["Claude Code-credentials"];

export type CodingAgentAvailability = "available" | "unknown" | "usage_limited" | "budget_limited";

/**
 * Why the last Claude usage refresh did or did not update the snapshot. Without
 * this a failed refresh is invisible: the snapshot keeps its old numbers, and a
 * caller cannot tell a quiet account from a missing credential.
 */
export type ClaudeUsageRefreshState =
  | "ok"
  | "no_credentials"
  | "unauthorized"
  | "unreachable"
  | "not_reported";

export interface CodingAgentRateLimit {
  label: string;
  usedPercentage: number;
  resetsAt: string | null;
}

/** Purchased credit state, kept separate from included plan allowance. */
export interface CodingAgentCreditState {
  hasCredits: boolean;
  unlimited: boolean;
  balance: string | null;
}

/** A banked reset the provider is holding. Reported, never redeemed. */
export interface CodingAgentBankedReset {
  id: string;
  status: string;
  title: string | null;
  expiresAt: string | null;
}

export interface CodingAgentContextUsage {
  inputTokens: number;
  outputTokens: number;
  windowSize: number;
  usedPercentage: number;
  remainingPercentage: number;
}

export interface CodingAgentAvailabilityRecord {
  /** Display label, e.g. "Claude Code". Not a stable identifier. */
  provider: string;
  /** Registry provider id, e.g. "claude-code-cli". Stable across labels. */
  providerId: string;
  profiles: string[];
  availability: CodingAgentAvailability;
  observedTasks: number;
  usageLimitedTasks: number;
  budgetLimitedTasks: number;
  remainingTokens: null;
  resetAt: string | null;
  context: CodingAgentContextUsage | null;
  rateLimits: CodingAgentRateLimit[];
  /** Purchased credits, when the provider reports them. Never plan allowance. */
  credits: CodingAgentCreditState | null;
  /** Banked resets the provider is holding, for visibility only. */
  bankedResets: CodingAgentBankedReset[];
  /** The account's plan or tier, when the provider names one. */
  planScope: string | null;
  capturedAt: string | null;
  telemetry: string;
}

export interface CodingAgentAvailabilitySnapshot {
  generatedAt: string;
  agents: CodingAgentAvailabilityRecord[];
}

/**
 * Only the access token is read (Decision 0130). The refresh token is never
 * read, exchanged or written: an exchange spends the single-use refresh token
 * and, unpersisted, signs the host out (issue #1559).
 */
export interface ClaudeOAuthCredentials {
  accessToken: string;
  source?: "environment" | "file" | "keychain";
  expiresAt?: string | null;
}

export interface ClaudeUsageResponse {
  five_hour?: ClaudeUsageWindow | null;
  seven_day?: ClaudeUsageWindow | null;
}

interface ClaudeUsageWindow {
  utilization?: number;
  resets_at?: string | null;
}

/** One provider's last-read account telemetry, as cached and as injected by a caller that read it live. */
export interface ProviderTelemetry {
  availability: CodingAgentAvailability;
  context: CodingAgentContextUsage | null;
  rateLimits: CodingAgentRateLimit[];
  credits: CodingAgentCreditState | null;
  bankedResets: CodingAgentBankedReset[];
  planScope: string | null;
  capturedAt: string | null;
  telemetry: string;
}

interface CodingAgentTelemetryCache {
  version: 1;
  providers: Record<string, ProviderTelemetry>;
}

/**
 * Read locally observable provider state once and expose it to routing and UI
 * callers through one provider-neutral shape. Unknown remains eligible to try;
 * it does not mean that account quota was verified.
 */
export function observeCodingAgentAvailability(
  profiles: CodingAgentProfile[],
  now = new Date(),
  options: {
    /**
     * Telemetry a caller already read live (for example with a retry and a
     * named failure), used in place of this function's own single live read
     * for that provider and written to the cache like one.
     */
    providerTelemetry?: Readonly<Record<string, ProviderTelemetry>>;
  } = {},
): CodingAgentAvailabilitySnapshot {
  const localCodexTasks = observeCodexTasks({ includeCloud: false });
  const cachedTelemetry = readTelemetryCache();
  let cacheChanged = false;
  const groups = new Map<string, CodingAgentProfile[]>();
  for (const profile of profiles) {
    const group = groups.get(profile.provider) ?? [];
    group.push(profile);
    groups.set(profile.provider, group);
  }

  const snapshot: CodingAgentAvailabilitySnapshot = {
    generatedAt: now.toISOString(),
    agents: [...groups.values()].map((profilesForProvider) => {
      const representative = profilesForProvider[0];
      const statuses = representative.provider === "codex-cli"
        ? localCodexTasks.map((task) => task.status.toLowerCase())
        : [];
      const usageLimitedTasks = statuses.filter((status) => status === "usage_limited").length;
      const budgetLimitedTasks = statuses.filter((status) => status === "budget_limited").length;
      const liveTelemetry = options.providerTelemetry?.[representative.provider] ?? readProviderTelemetry(representative.provider, now);
      if (liveTelemetry) {
        cachedTelemetry.providers[representative.provider] = liveTelemetry;
        cacheChanged = true;
      }
      const providerTelemetry = liveTelemetry ?? cachedTelemetry.providers[representative.provider] ?? null;
      const fallbackAvailability: CodingAgentAvailability = budgetLimitedTasks > 0
        ? "budget_limited"
        : usageLimitedTasks > 0
          ? "usage_limited"
          : "unknown";

      return {
        provider: codingAgentLabel(representative),
        providerId: representative.provider,
        profiles: profilesForProvider.map((profile) => profile.name),
        availability: providerTelemetry?.availability ?? fallbackAvailability,
        observedTasks: statuses.length,
        usageLimitedTasks,
        budgetLimitedTasks,
        remainingTokens: null,
        resetAt: providerTelemetry?.rateLimits.find((limit) => limit.resetsAt)?.resetsAt ?? null,
        context: providerTelemetry?.context ?? null,
        rateLimits: providerTelemetry?.rateLimits ?? [],
        credits: providerTelemetry?.credits ?? null,
        bankedResets: providerTelemetry?.bankedResets ?? [],
        planScope: providerTelemetry?.planScope ?? null,
        capturedAt: providerTelemetry?.capturedAt ?? null,
        telemetry: liveTelemetry
          ? liveTelemetry.telemetry
          : providerTelemetry
            ? `Last reported snapshot: ${providerTelemetry.telemetry}`
            : fallbackTelemetry(representative.provider, statuses.length),
      };
    }),
  };
  if (cacheChanged) {
    writeTelemetryCache(cachedTelemetry);
  }
  return snapshot;
}

/**
 * Ask Claude's own usage service for a current account snapshot before the
 * Intelligence usage command observes provider state. The endpoint is
 * deliberately polled slowly because it has a much tighter request budget
 * than the local status-line file. Failures leave the last reported snapshot
 * intact.
 */
export interface ClaudeUsageRefreshDependencies {
  /** Read the Claude Code credential; defaults to the host environment, file and keychain. */
  loadCredentials?: () => Promise<ClaudeOAuthCredentials | null>;
  /** Call the usage endpoint with an access token; defaults to the live service. */
  requestUsage?: (accessToken: string) => Promise<{ status: number; body: ClaudeUsageResponse | null }>;
  /** Snapshot file to read and write; defaults to the host telemetry path. */
  snapshotPath?: string;
}

export async function refreshClaudeCodeUsageTelemetry(
  now = new Date(),
  options: {
    force?: boolean;
    /** Injected collaborators. Supplying any bypasses the VITEST early return. */
    deps?: ClaudeUsageRefreshDependencies;
  } = {},
): Promise<void> {
  const deps = options.deps;
  if (process.env.VITEST && !deps) return;

  const snapshotPath = deps?.snapshotPath ?? claudeStatusLinePath();
  const existing = readJsonRecord(snapshotPath);
  const lastCheckedAt = stringValue(existing?.arcadia_usage_checked_at);
  if (!options.force && lastCheckedAt && Date.now() - Date.parse(lastCheckedAt) < CLAUDE_USAGE_REFRESH_COOLDOWN_MS) {
    return;
  }

  writeClaudeSnapshot(snapshotPath, {
    ...(existing ?? {}),
    arcadia_usage_checked_at: now.toISOString(),
  });

  const credentials = await (deps?.loadCredentials ?? loadClaudeOAuthCredentials)().catch(() => null);
  if (!credentials) {
    recordClaudeRefreshState(snapshotPath, "no_credentials", now);
    return;
  }

  // Read-only for every caller (Decision 0130, issue #1559): a 401 is recorded
  // as `unauthorized`; the OAuth token endpoint is never contacted.
  const requestUsage = deps?.requestUsage ?? requestClaudeUsage;
  const response = await requestUsage(credentials.accessToken);

  if (!response.body || (!response.body.five_hour && !response.body.seven_day)) {
    recordClaudeRefreshState(
      snapshotPath,
      response.status === 0 ? "unreachable" : response.status === 401 ? "unauthorized" : "not_reported",
      now,
      response.status,
    );
    return;
  }

  const current = readJsonRecord(snapshotPath) ?? existing ?? {};
  const currentRateLimits = objectValue(current.rate_limits);
  writeClaudeSnapshot(snapshotPath, {
    ...current,
    arcadia_captured_at: now.toISOString(),
    arcadia_usage_checked_at: now.toISOString(),
    arcadia_usage_refresh_state: "ok" satisfies ClaudeUsageRefreshState,
    arcadia_usage_refresh_http_status: normalizeHttpStatus(response.status),
    arcadia_usage_unauthorized_since: null,
    arcadia_usage_unauthorized_signalled: null,
    rate_limits: {
      ...(currentRateLimits ?? {}),
      five_hour: mergeClaudeUsageWindow(
        objectValue(currentRateLimits?.five_hour),
        response.body.five_hour,
      ),
      seven_day: mergeClaudeUsageWindow(
        objectValue(currentRateLimits?.seven_day),
        response.body.seven_day,
      ),
    },
  });
}

export function isCodingAgentAvailable(
  profile: CodingAgentProfile,
  snapshot: CodingAgentAvailabilitySnapshot,
): boolean {
  const provider = snapshot.agents.find((agent) => agent.profiles.includes(profile.name));
  return !provider || provider.availability === "available" || provider.availability === "unknown";
}

function readProviderTelemetry(provider: string, now: Date): ProviderTelemetry | null {
  if (provider === "claude-code-cli") {
    return readClaudeStatusLineTelemetry(now);
  }
  if (provider === "codex-cli") {
    return readCodexRateLimitTelemetry(now);
  }
  return null;
}

export type ClaudeCredentialSource = "auto" | "environment" | "file" | "keychain";

export async function loadClaudeOAuthCredentials(source: ClaudeCredentialSource = "auto"): Promise<ClaudeOAuthCredentials | null> {
  const environmentToken = stringValue(process.env.CLAUDE_CODE_OAUTH_TOKEN);
  if ((source === "auto" || source === "environment") && environmentToken) return { accessToken: environmentToken, source: "environment", expiresAt: null };
  if (source === "environment") return null;

  const credentialsPath = process.env.ARCADIA_CLAUDE_CREDENTIALS_PATH
    ?? path.join(os.homedir(), ".claude", ".credentials.json");
  if (source === "auto" || source === "file") {
    const fromFile = credentialsFromRecord(readJsonRecord(credentialsPath));
    if (fromFile) return { ...fromFile, source: "file" };
    if (source === "file") return null;
  }

  if (process.platform !== "darwin") return null;
  for (const service of CLAUDE_KEYCHAIN_SERVICES) {
    try {
      const result = await execFileAsync("security", ["find-generic-password", "-s", service, "-w"], {
        encoding: "utf8",
        timeout: 2_000,
        maxBuffer: 1024 * 1024,
      });
      const fromKeychain = credentialsFromRecord(JSON.parse(result.stdout) as Record<string, unknown>);
      if (fromKeychain) return { ...fromKeychain, source: "keychain" };
    } catch {
      // Try the next credential source, then retain the snapshot fallback.
    }
  }
  return null;
}

function credentialsFromRecord(record: Record<string, unknown> | null): ClaudeOAuthCredentials | null {
  const oauth = objectValue(record?.claudeAiOauth);
  const accessToken = stringValue(oauth?.accessToken);
  if (!accessToken) return null;
  const expiry = oauth?.expiresAt;
  const parsed = typeof expiry === "number" ? new Date(expiry) : null;
  return { accessToken, expiresAt: parsed && Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null };
}

export async function requestClaudeUsage(accessToken: string): Promise<{
  status: number;
  body: ClaudeUsageResponse | null;
  failure?: "transport" | "parse";
}> {
  try {
    const response = await fetch(CLAUDE_USAGE_URL, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "claude-code/2.1.205",
        Authorization: `Bearer ${accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return { status: response.status, body: null };
    try {
      return { status: response.status, body: await response.json() as ClaudeUsageResponse };
    } catch {
      return { status: response.status, body: null, failure: "parse" };
    }
  } catch {
    return { status: 0, body: null, failure: "transport" };
  }
}

function mergeClaudeUsageWindow(
  current: Record<string, unknown> | null,
  latest: ClaudeUsageWindow | null | undefined,
): Record<string, unknown> | null {
  if (!latest || typeof latest.utilization !== "number") return current;
  return {
    ...(current ?? {}),
    // Issue #1620: the usage service reports a percentage (live: 59 for 59%,
    // 1.0 for 1%); reading <= 1 as a fraction showed a fresh window as spent.
    used_percentage: latest.utilization,
    ...(latest.resets_at ? { resets_at: latest.resets_at } : {}),
  };
}

function telemetryCachePath(): string {
  return process.env.ARCADIA_CODING_AGENT_USAGE_CACHE_PATH
    ?? path.join(os.homedir(), ".arcadia", "telemetry", "coding-agent-usage.json");
}

/**
 * Leave the stale numbers alone — they are still the last thing actually
 * observed — but say next to them why they were not replaced.
 */
function recordClaudeRefreshState(
  snapshotPath: string,
  state: ClaudeUsageRefreshState,
  now: Date,
  httpStatus: number | null = null,
): void {
  const current = readJsonRecord(snapshotPath) ?? {};
  // An unauthorized episode starts on the first 401 after a good (or no)
  // reading and lasts until the next good reading, so a flap between
  // `unauthorized` and `unreachable` stays one episode and one signal.
  const since = stringValue(current.arcadia_usage_unauthorized_since)
    ?? (state === "unauthorized" ? now.toISOString() : null);
  writeClaudeSnapshot(snapshotPath, {
    ...current,
    arcadia_usage_checked_at: now.toISOString(),
    arcadia_usage_refresh_state: state,
    arcadia_usage_refresh_http_status: normalizeHttpStatus(httpStatus),
    arcadia_usage_unauthorized_since: since,
  });
}

/**
 * The open unauthorized episode, when its operator signal has not yet been
 * raised. Returns null when there is no episode or it was already signalled.
 */
export function unsignalledClaudeUnauthorizedEpisode(snapshotPath = claudeStatusLinePath()): { since: string } | null {
  const record = readJsonRecord(snapshotPath);
  const since = stringValue(record?.arcadia_usage_unauthorized_since);
  if (!since || stringValue(record?.arcadia_usage_unauthorized_signalled) === since) return null;
  return { since };
}

/** Record that the operator signal for this unauthorized episode was raised. */
export function markClaudeUnauthorizedEpisodeSignalled(since: string, snapshotPath = claudeStatusLinePath()): void {
  const current = readJsonRecord(snapshotPath) ?? {};
  if (stringValue(current.arcadia_usage_unauthorized_since) !== since) return;
  writeClaudeSnapshot(snapshotPath, { ...current, arcadia_usage_unauthorized_signalled: since });
}

/**
 * When the worker last asked the Claude CLI to refresh its own sign-in
 * (issue #1616), recorded before the call so a crash mid-call cannot repeat it.
 */
export function lastClaudeCliSelfRefreshAt(snapshotPath = claudeStatusLinePath()): string | null {
  return stringValue(readJsonRecord(snapshotPath)?.arcadia_cli_self_refresh_at);
}

/** Record a Claude CLI self-refresh attempt and, once known, its outcome. */
export function recordClaudeCliSelfRefresh(at: Date, outcome: "started" | "ok" | "failed", snapshotPath = claudeStatusLinePath(), detail?: string): void {
  const current = readJsonRecord(snapshotPath) ?? {};
  writeClaudeSnapshot(snapshotPath, {
    ...current,
    arcadia_cli_self_refresh_at: at.toISOString(),
    arcadia_cli_self_refresh_outcome: outcome,
    // The CLI's own words, bounded and plain: the only diagnosis a failed refresh leaves.
    arcadia_cli_self_refresh_detail: detail === undefined ? null : detail.replace(/[^\x20-\x7e]/g, " ").slice(0, 300),
  });
}

/** The last recorded outcome of a Claude usage refresh, or null when none is recorded. */
export function readClaudeUsageRefreshState(snapshotPath = claudeStatusLinePath()): ClaudeUsageRefreshState | null {
  return stringValue(readJsonRecord(snapshotPath)?.arcadia_usage_refresh_state) as ClaudeUsageRefreshState | null;
}

export function describeClaudeUsageRefreshState(state: ClaudeUsageRefreshState): string {
  return describeClaudeRefreshState(state);
}

function claudeStatusLinePath(): string {
  return process.env.ARCADIA_CLAUDE_USAGE_PATH
    ?? path.join(os.homedir(), ".arcadia", "telemetry", "claude-code.json");
}

function readJsonRecord(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function writeClaudeSnapshot(filePath: string, snapshot: Record<string, unknown>): void {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.tmp-${process.pid}`;
    writeFileSync(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    renameSync(temporaryPath, filePath);
  } catch {
    // Preserve the existing snapshot when the telemetry path is unavailable.
  }
}

function readTelemetryCache(): CodingAgentTelemetryCache {
  // Tests must not inherit a developer's real local provider state. Tests that
  // exercise persistence set an explicit isolated cache path.
  if (process.env.VITEST && !process.env.ARCADIA_CODING_AGENT_USAGE_CACHE_PATH) {
    return { version: 1, providers: {} };
  }
  const filePath = telemetryCachePath();
  if (!existsSync(filePath)) return { version: 1, providers: {} };
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<CodingAgentTelemetryCache>;
    return parsed.version === 1 && parsed.providers && typeof parsed.providers === "object"
      ? { version: 1, providers: parsed.providers }
      : { version: 1, providers: {} };
  } catch {
    return { version: 1, providers: {} };
  }
}

function writeTelemetryCache(cache: CodingAgentTelemetryCache): void {
  if (process.env.VITEST && !process.env.ARCADIA_CODING_AGENT_USAGE_CACHE_PATH) return;
  const filePath = telemetryCachePath();
  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.tmp-${process.pid}`;
    writeFileSync(temporaryPath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
    renameSync(temporaryPath, filePath);
  } catch {
    // Availability remains read-only from the caller's perspective if a local
    // cache cannot be written (for example, a restricted home directory).
  }
}

export function readClaudeStatusLineTelemetry(now: Date, filePath = claudeStatusLinePath()): ProviderTelemetry | null {
  if (!existsSync(filePath)) return null;

  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
    const context = objectValue(raw.context_window);
    const limits = objectValue(raw.rate_limits);
    const rateLimits = [
      claudeRateLimit("5h", objectValue(limits?.five_hour)),
      claudeRateLimit("7d", objectValue(limits?.seven_day)),
    ].filter((value): value is CodingAgentRateLimit => Boolean(value));
    const capturedAt = stringValue(raw.arcadia_captured_at)
      ?? statSync(filePath).mtime.toISOString();
    // Claude can report the context window shape while withholding its live
    // percentage (`null`). Keep that state unknown instead of displaying a
    // misleading 0% context reading.
    const contextUsage = context && typeof context.used_percentage === "number" ? {
      inputTokens: numberValue(context.total_input_tokens),
      outputTokens: numberValue(context.total_output_tokens),
      windowSize: numberValue(context.context_window_size),
      usedPercentage: numberValue(context.used_percentage),
      remainingPercentage: numberValue(context.remaining_percentage),
    } : null;

    const refreshState = stringValue(raw.arcadia_usage_refresh_state) as ClaudeUsageRefreshState | null;
    const refreshNote = refreshState && refreshState !== "ok"
      ? ` The last refresh did not update it: ${describeClaudeRefreshState(refreshState, raw.arcadia_usage_refresh_http_status)}`
      : "";

    return {
      availability: availabilityFromRateLimits(rateLimits),
      context: contextUsage,
      rateLimits,
      credits: null,
      bankedResets: [],
      planScope: null,
      capturedAt,
      telemetry: (rateLimits.length > 0
        ? `Claude Code status-line telemetry captured ${relativeAge(capturedAt, now)}.`
        : `Claude Code context telemetry captured ${relativeAge(capturedAt, now)}; subscription rate limits were not reported.`)
        + refreshNote,
    };
  } catch {
    return null;
  }
}

function readCodexRateLimitTelemetry(now: Date): ProviderTelemetry | null {
  const fixture = process.env.ARCADIA_CODEX_RATE_LIMIT_FIXTURE;
  if (process.env.VITEST && !fixture) return null;
  const read = readCodexRateLimitsLive(now, { run: fixture === undefined ? undefined : () => fixture });
  return read.ok ? read.telemetry : null;
}

/** Why one live `account/rateLimits/read` produced no usable telemetry; named so a caller never judges a stale cache silently. */
export interface CodexRateLimitReadFailure {
  kind: "timeout" | "exit" | "no_response" | "unparseable" | "no_rate_limits";
  /** The query's exit status; null when it was killed (a timeout) or never started. */
  exitStatus: number | null;
  signal: string | null;
  detail: string;
}
export type CodexRateLimitRead =
  | { ok: true; telemetry: ProviderTelemetry }
  | { ok: false; failure: CodexRateLimitReadFailure };

/**
 * One live read of the Codex app server's `account/rateLimits/read`, bounded
 * by `deadlineMs` (default 8 s), that reports a failure instead of collapsing
 * it into "no telemetry". `run` replaces the query for tests.
 */
export function readCodexRateLimitsLive(
  now: Date,
  options: { deadlineMs?: number; run?: (deadlineMs: number) => string } = {},
): CodexRateLimitRead {
  const deadlineMs = options.deadlineMs ?? CODEX_RATE_LIMIT_DEADLINE_MS;
  let output: string;
  try {
    output = (options.run ?? runCodexRateLimitQuery)(deadlineMs);
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { status?: number | null; signal?: string | null };
    const timedOut = failure.code === "ETIMEDOUT";
    const exitStatus = typeof failure.status === "number" ? failure.status : null;
    return {
      ok: false,
      failure: {
        kind: timedOut ? "timeout" : "exit",
        exitStatus,
        signal: failure.signal ?? null,
        detail: timedOut
          ? `the Codex app-server query did not answer within ${deadlineMs} ms`
          : `the Codex app-server query failed${exitStatus === null ? "" : ` with exit status ${exitStatus}`}: ${failure.message}`
      }
    };
  }
  const fail = (kind: CodexRateLimitReadFailure["kind"], detail: string): CodexRateLimitRead =>
    ({ ok: false, failure: { kind, exitStatus: 0, signal: null, detail } });
  let response: Record<string, unknown> | undefined;
  try {
    response = output.split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((line) => line.id === 2);
  } catch {
    return fail("unparseable", "the Codex app-server query printed output that is not JSON lines");
  }
  if (!response) return fail("no_response", "the Codex app-server query exited without answering account/rateLimits/read (no response with id 2)");
  const result = objectValue(response.result);
  const snapshot = objectValue(result?.rateLimits);
  if (!snapshot) return fail("no_rate_limits", "the Codex app server answered account/rateLimits/read without a rateLimits snapshot");

  const rateLimits = [
    codexRateLimit(objectValue(snapshot.primary)),
    codexRateLimit(objectValue(snapshot.secondary)),
  ].filter((value): value is CodingAgentRateLimit => Boolean(value));
  const reached = typeof snapshot.rateLimitReachedType === "string";
  return {
    ok: true,
    telemetry: {
      availability: reached ? "usage_limited" : availabilityFromRateLimits(rateLimits),
      context: null,
      rateLimits,
      credits: codexCredits(objectValue(snapshot.credits)),
      bankedResets: codexBankedResets(objectValue(result?.rateLimitResetCredits)),
      planScope: stringValue(snapshot.planType),
      capturedAt: now.toISOString(),
      telemetry: "Codex account rate limits reported by the local app server.",
    },
  };
}

function runCodexRateLimitQuery(deadlineMs: number): string {
  return execFileSync("sh", ["-c", CODEX_RATE_LIMIT_QUERY], {
    encoding: "utf8",
    timeout: deadlineMs,
    maxBuffer: 1024 * 1024,
  });
}

/**
 * Purchased credits are reported separately from plan allowance and stay
 * separate here: a credit balance is not remaining included capacity, and
 * nothing in Arcadia may spend it without an explicit Decision.
 */
function codexCredits(value: Record<string, unknown> | null): CodingAgentCreditState | null {
  if (!value) return null;
  return {
    hasCredits: value.hasCredits === true,
    unlimited: value.unlimited === true,
    balance: stringValue(value.balance) ?? (typeof value.balance === "number" ? String(value.balance) : null),
  };
}

/**
 * Banked resets are surfaced so a person can see one exists, and for no other
 * reason. Contract 17 forbids redeeming one to keep busy, so nothing downstream
 * treats an available reset as capacity.
 */
function codexBankedResets(value: Record<string, unknown> | null): CodingAgentBankedReset[] {
  const credits = Array.isArray(value?.credits) ? value.credits : [];
  return credits
    .map((entry) => objectValue(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => ({
      id: stringValue(entry.id) ?? "unknown",
      status: stringValue(entry.status) ?? "unknown",
      title: stringValue(entry.title),
      expiresAt: epochToIso(entry.expiresAt),
    }));
}

/** Retain only a standard numeric HTTP outcome, never provider response text. */
function normalizeHttpStatus(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}

function describeClaudeRefreshState(state: ClaudeUsageRefreshState, httpStatus?: unknown): string {
  const status = normalizeHttpStatus(httpStatus);
  if (state === "not_reported" && status !== null && (status < 200 || status >= 300)) {
    return `Claude's usage service returned HTTP ${status}; no fresh allowance window was obtained.`;
  }
  switch (state) {
    case "no_credentials":
      return "no Claude Code OAuth credential was readable on this host, so subscription usage cannot be refreshed automatically.";
    case "unauthorized":
      return "Claude sign-in on the worker host needs renewing; the usage service rejected the stored token.";
    case "unreachable":
      return "Claude's usage service could not be reached.";
    default:
      return "Claude's usage service reported no allowance window.";
  }
}

function claudeRateLimit(label: string, value: Record<string, unknown> | null): CodingAgentRateLimit | null {
  if (!value || typeof value.used_percentage !== "number") return null;
  return {
    label,
    usedPercentage: value.used_percentage,
    resetsAt: epochToIso(value.resets_at),
  };
}

function codexRateLimit(value: Record<string, unknown> | null): CodingAgentRateLimit | null {
  if (!value || typeof value.usedPercent !== "number") return null;
  const minutes = numberValue(value.windowDurationMins);
  return {
    label: minutes === 300 ? "5h" : minutes === 10_080 ? "7d" : minutes > 0 ? `${minutes}m` : "limit",
    usedPercentage: value.usedPercent,
    resetsAt: epochToIso(value.resetsAt),
  };
}

function availabilityFromRateLimits(rateLimits: CodingAgentRateLimit[]): CodingAgentAvailability {
  if (rateLimits.some((limit) => limit.usedPercentage >= 100)) return "usage_limited";
  return rateLimits.length > 0 ? "available" : "unknown";
}

function fallbackTelemetry(provider: string, observedTasks: number): string {
  if (provider === "codex-cli") {
    return observedTasks > 0
      ? "Local Codex task state is available; account rate limits were not reported."
      : "No local Codex account or task telemetry is available.";
  }
  if (provider === "claude-code-cli") {
    return "No Claude Code status-line telemetry has been captured yet.";
  }
  return "No local provider quota telemetry is configured.";
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function epochToIso(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value * 1_000).toISOString();
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  return null;
}

function relativeAge(capturedAt: string, now: Date): string {
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(capturedAt).getTime()) / 1_000));
  if (seconds < 60) return "just now";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3_600)}h ago`;
}

/**
 * The app server answers `account/rateLimits/read` a moment after the request,
 * and closing the pipe early makes it exit before replying — which looked
 * exactly like "this host reports nothing" and silently pinned Codex capacity to
 * a week-old cache. The trailing sleep is that response window; the deadline
 * below bounds the whole read.
 */
const CODEX_RATE_LIMIT_DEADLINE_MS = 8_000;

const CODEX_RATE_LIMIT_QUERY = `
(printf '%s\\n' '{"id":1,"method":"initialize","params":{"clientInfo":{"name":"arcadia","version":"0.1.0"},"capabilities":{"experimentalApi":true}}}';
sleep 0.2;
printf '%s\\n%s\\n' '{"method":"initialized"}' '{"id":2,"method":"account/rateLimits/read"}';
sleep 2) | codex app-server --listen stdio:// 2>/dev/null
`;
