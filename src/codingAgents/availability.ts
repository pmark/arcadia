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
const CLAUDE_OAUTH_TOKEN_URL = "https://api.anthropic.com/v1/oauth/token";
const CLAUDE_OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const CLAUDE_USAGE_REFRESH_COOLDOWN_MS = 5 * 60_000;
const CLAUDE_KEYCHAIN_SERVICES = ["Claude Code-credentials"];

export type CodingAgentAvailability = "available" | "unknown" | "usage_limited" | "budget_limited";

export interface CodingAgentRateLimit {
  label: string;
  usedPercentage: number;
  resetsAt: string | null;
}

export interface CodingAgentContextUsage {
  inputTokens: number;
  outputTokens: number;
  windowSize: number;
  usedPercentage: number;
  remainingPercentage: number;
}

export interface CodingAgentAvailabilityRecord {
  provider: string;
  profiles: string[];
  availability: CodingAgentAvailability;
  observedTasks: number;
  usageLimitedTasks: number;
  budgetLimitedTasks: number;
  remainingTokens: null;
  resetAt: string | null;
  context: CodingAgentContextUsage | null;
  rateLimits: CodingAgentRateLimit[];
  capturedAt: string | null;
  telemetry: string;
}

export interface CodingAgentAvailabilitySnapshot {
  generatedAt: string;
  agents: CodingAgentAvailabilityRecord[];
}

interface ClaudeOAuthCredentials {
  accessToken: string;
  refreshToken: string | null;
}

interface ClaudeUsageResponse {
  five_hour?: ClaudeUsageWindow | null;
  seven_day?: ClaudeUsageWindow | null;
}

interface ClaudeUsageWindow {
  utilization?: number;
  resets_at?: string | null;
}

interface ProviderTelemetry {
  availability: CodingAgentAvailability;
  context: CodingAgentContextUsage | null;
  rateLimits: CodingAgentRateLimit[];
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
      const representative = profilesForProvider[0]!;
      const statuses = representative.provider === "codex-cli"
        ? localCodexTasks.map((task) => task.status.toLowerCase())
        : [];
      const usageLimitedTasks = statuses.filter((status) => status === "usage_limited").length;
      const budgetLimitedTasks = statuses.filter((status) => status === "budget_limited").length;
      const liveTelemetry = readProviderTelemetry(representative.provider, now);
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
        profiles: profilesForProvider.map((profile) => profile.name),
        availability: providerTelemetry?.availability ?? fallbackAvailability,
        observedTasks: statuses.length,
        usageLimitedTasks,
        budgetLimitedTasks,
        remainingTokens: null,
        resetAt: providerTelemetry?.rateLimits.find((limit) => limit.resetsAt)?.resetsAt ?? null,
        context: providerTelemetry?.context ?? null,
        rateLimits: providerTelemetry?.rateLimits ?? [],
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
export async function refreshClaudeCodeUsageTelemetry(
  now = new Date(),
  options: { force?: boolean } = {},
): Promise<void> {
  if (process.env.VITEST) return;

  const snapshotPath = claudeStatusLinePath();
  const existing = readJsonRecord(snapshotPath);
  const lastCheckedAt = stringValue(existing?.arcadia_usage_checked_at);
  if (!options.force && lastCheckedAt && Date.now() - Date.parse(lastCheckedAt) < CLAUDE_USAGE_REFRESH_COOLDOWN_MS) {
    return;
  }

  writeClaudeSnapshot(snapshotPath, {
    ...(existing ?? {}),
    arcadia_usage_checked_at: now.toISOString(),
  });

  const credentials = await loadClaudeOAuthCredentials();
  if (!credentials) return;

  let response = await requestClaudeUsage(credentials.accessToken);
  if (response.status === 401 && credentials.refreshToken) {
    const refreshed = await refreshClaudeOAuthToken(credentials.refreshToken);
    if (refreshed) response = await requestClaudeUsage(refreshed.accessToken);
  }

  if (!response.body || (!response.body.five_hour && !response.body.seven_day)) return;

  const current = readJsonRecord(snapshotPath) ?? existing ?? {};
  const currentRateLimits = objectValue(current.rate_limits);
  writeClaudeSnapshot(snapshotPath, {
    ...current,
    arcadia_captured_at: now.toISOString(),
    arcadia_usage_checked_at: now.toISOString(),
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

async function loadClaudeOAuthCredentials(): Promise<ClaudeOAuthCredentials | null> {
  const environmentToken = stringValue(process.env.CLAUDE_CODE_OAUTH_TOKEN);
  if (environmentToken) return { accessToken: environmentToken, refreshToken: null };

  const credentialsPath = process.env.ARCADIA_CLAUDE_CREDENTIALS_PATH
    ?? path.join(os.homedir(), ".claude", ".credentials.json");
  const fromFile = credentialsFromRecord(readJsonRecord(credentialsPath));
  if (fromFile) return fromFile;

  if (process.platform !== "darwin") return null;
  for (const service of CLAUDE_KEYCHAIN_SERVICES) {
    try {
      const result = await execFileAsync("security", ["find-generic-password", "-s", service, "-w"], {
        encoding: "utf8",
        timeout: 2_000,
        maxBuffer: 1024 * 1024,
      });
      const fromKeychain = credentialsFromRecord(JSON.parse(result.stdout) as Record<string, unknown>);
      if (fromKeychain) return fromKeychain;
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
  return {
    accessToken,
    refreshToken: stringValue(oauth?.refreshToken),
  };
}

async function requestClaudeUsage(accessToken: string): Promise<{
  status: number;
  body: ClaudeUsageResponse | null;
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
    return { status: response.status, body: await response.json() as ClaudeUsageResponse };
  } catch {
    return { status: 0, body: null };
  }
}

async function refreshClaudeOAuthToken(refreshToken: string): Promise<{ accessToken: string } | null> {
  try {
    const response = await fetch(CLAUDE_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: process.env.ARCADIA_CLAUDE_OAUTH_CLIENT_ID ?? CLAUDE_OAUTH_CLIENT_ID,
        refresh_token: refreshToken,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const body = await response.json() as { access_token?: unknown };
    const accessToken = stringValue(body.access_token);
    return accessToken ? { accessToken } : null;
  } catch {
    return null;
  }
}

function mergeClaudeUsageWindow(
  current: Record<string, unknown> | null,
  latest: ClaudeUsageWindow | null | undefined,
): Record<string, unknown> | null {
  if (!latest || typeof latest.utilization !== "number") return current;
  return {
    ...(current ?? {}),
    used_percentage: latest.utilization <= 1 ? latest.utilization * 100 : latest.utilization,
    ...(latest.resets_at ? { resets_at: latest.resets_at } : {}),
  };
}

function telemetryCachePath(): string {
  return process.env.ARCADIA_CODING_AGENT_USAGE_CACHE_PATH
    ?? path.join(os.homedir(), ".arcadia", "telemetry", "coding-agent-usage.json");
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

function readClaudeStatusLineTelemetry(now: Date): ProviderTelemetry | null {
  const filePath = claudeStatusLinePath();
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

    return {
      availability: availabilityFromRateLimits(rateLimits),
      context: contextUsage,
      rateLimits,
      capturedAt,
      telemetry: rateLimits.length > 0
        ? `Claude Code status-line telemetry captured ${relativeAge(capturedAt, now)}.`
        : `Claude Code context telemetry captured ${relativeAge(capturedAt, now)}; subscription rate limits were not reported.`,
    };
  } catch {
    return null;
  }
}

function readCodexRateLimitTelemetry(now: Date): ProviderTelemetry | null {
  const fixture = process.env.ARCADIA_CODEX_RATE_LIMIT_FIXTURE;
  if (process.env.VITEST && !fixture) return null;

  try {
    const output = fixture ?? execFileSync("sh", ["-c", CODEX_RATE_LIMIT_QUERY], {
      encoding: "utf8",
      timeout: 3_000,
      maxBuffer: 1024 * 1024,
    });
    const response = output.split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((line) => line.id === 2);
    const result = objectValue(response?.result);
    const snapshot = objectValue(result?.rateLimits);
    if (!snapshot) return null;

    const rateLimits = [
      codexRateLimit(objectValue(snapshot.primary)),
      codexRateLimit(objectValue(snapshot.secondary)),
    ].filter((value): value is CodingAgentRateLimit => Boolean(value));
    const reached = typeof snapshot.rateLimitReachedType === "string";

    return {
      availability: reached ? "usage_limited" : availabilityFromRateLimits(rateLimits),
      context: null,
      rateLimits,
      capturedAt: now.toISOString(),
      telemetry: "Codex account rate limits reported by the local app server.",
    };
  } catch {
    return null;
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

const CODEX_RATE_LIMIT_QUERY = `
(printf '%s\\n' '{"id":1,"method":"initialize","params":{"clientInfo":{"name":"arcadia","version":"0.1.0"},"capabilities":{"experimentalApi":true}}}';
sleep 0.2;
printf '%s\\n%s\\n' '{"method":"initialized"}' '{"id":2,"method":"account/rateLimits/read"}';
sleep 0.5) | codex app-server --listen stdio:// 2>/dev/null
`;
