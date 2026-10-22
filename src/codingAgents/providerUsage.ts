import { readOpenCodeUsage, type OpenCodeUsageDependencies, type OpenCodeSessionUsage } from "./opencodeUsage.js";
import {
  loadClaudeOAuthCredentials, readClaudeStatusLineTelemetry, readCodexRateLimitsLive,
  requestClaudeUsage,
  type ClaudeCredentialSource, type ClaudeOAuthCredentials, type CodingAgentRateLimit,
} from "./availability.js";

export interface ProviderUsageOptions {
  refresh?: boolean;
  claudeSource?: ClaudeCredentialSource;
  now?: Date;
  opencodeSession?: string;
  opencodeExport?: string;
}

export interface ProviderUsageReading {
  provider: "codex" | "claude" | "opencode";
  observation: "live" | "cached_unverified" | "not_requested" | "unavailable" | "unsupported";
  credentialSource: string;
  credentialExpiresAt: string | null;
  requestAttempted: boolean;
  outcome: string;
  httpStatus: number | null;
  observedAt: string | null;
  windows: CodingAgentRateLimit[];
  sessionUsage?: OpenCodeSessionUsage;
}

export interface ProviderUsageDependencies {
  /** Deliberate live-clock injection; options.now alone remains a fixed snapshot. */
  clock?: () => Date;
  loadClaude?: (source: ClaudeCredentialSource) => Promise<ClaudeOAuthCredentials | null>;
  requestClaude?: typeof requestClaudeUsage;
  readClaudeCache?: typeof readClaudeStatusLineTelemetry;
  readCodex?: typeof readCodexRateLimitsLive;
  opencode?: OpenCodeUsageDependencies;
}

/** Diagnostic only: no admission, shared cache writes, token exchange or model call. */
export async function readProviderUsage(options: ProviderUsageOptions = {}, deps: ProviderUsageDependencies = {}) {
  const clock = deps.clock ?? (() => options.now ?? new Date());
  const now = clock();
  const reading = (provider: ProviderUsageReading["provider"]): ProviderUsageReading => ({
    provider, observation: "not_requested", credentialSource: "unknown",
    credentialExpiresAt: null, requestAttempted: false, outcome: "refresh_not_requested",
    httpStatus: null, observedAt: null, windows: [],
  });
  const claude = reading("claude");
  const codex = reading("codex");
  const opencode = reading("opencode");
  opencode.observation = "unsupported";
  opencode.outcome = "OpenCode account allowance is unknown; local session usage does not establish remaining quota.";
  const sessionUsage = readOpenCodeUsage({ session: options.opencodeSession, exportFile: options.opencodeExport }, clock, deps.opencode);
  if (sessionUsage) opencode.sessionUsage = sessionUsage;
  if (!options.refresh) {
    const cached = (deps.readClaudeCache ?? readClaudeStatusLineTelemetry)(now);
    if (cached) {
      claude.observation = "cached_unverified";
      claude.outcome = "Cached credential context is unverified; refresh explicitly before relying on these windows.";
      claude.windows = cached.rateLimits;
      claude.observedAt = cached.capturedAt;
    }
    return { generatedAt: now.toISOString(), providers: [codex, claude, opencode] };
  }

  claude.observation = "unavailable";
  codex.observation = "unavailable";
  // A separate read has no cached cooldown or windows to inherit from another account.
  // Explicit sources never fall through to another credential after denial or absence.
  const credential = await (deps.loadClaude ?? loadClaudeOAuthCredentials)(options.claudeSource ?? "auto").catch(() => null);
  claude.credentialSource = credential?.source ?? options.claudeSource ?? "auto";
  claude.credentialExpiresAt = credential?.expiresAt ?? null;
  if (!credential) {
    claude.outcome = "no_credentials";
  } else if (credential.expiresAt && Date.parse(credential.expiresAt) <= now.getTime()) {
    claude.outcome = "credential_expired";
  } else {
    claude.requestAttempted = true;
    const response = await (deps.requestClaude ?? requestClaudeUsage)(credential.accessToken)
      .catch(() => ({ status: 0, body: null, failure: "transport" as const }));
    claude.httpStatus = response.status || null;
    claude.outcome = response.failure ?? (response.status < 200 || response.status >= 300 ? "http_error" : "not_reported");
    if (response.status >= 200 && response.status < 300 && response.body) {
      for (const [label, window] of [["5h", response.body.five_hour], ["7d", response.body.seven_day]] as const) {
        if (typeof window?.utilization === "number" && Number.isFinite(window.utilization)
          && window.utilization >= 0 && window.utilization <= 100) {
          claude.windows.push({ label, usedPercentage: window.utilization,
            resetsAt: typeof window.resets_at === "string" && Number.isFinite(Date.parse(window.resets_at)) ? window.resets_at : null });
        }
      }
      if (claude.windows.length) {
        claude.observation = "live";
        claude.observedAt = now.toISOString();
        claude.outcome = "ok";
      }
    }
  }
  codex.credentialSource = "codex-app-server";
  codex.requestAttempted = true;
  const result = (deps.readCodex ?? readCodexRateLimitsLive)(now);
  codex.outcome = result.ok ? "ok" : result.failure.kind;
  if (result.ok) {
    codex.observation = "live";
    codex.observedAt = result.telemetry.capturedAt;
    codex.windows = result.telemetry.rateLimits;
  }
  return { generatedAt: now.toISOString(), providers: [codex, claude, opencode] };
}
