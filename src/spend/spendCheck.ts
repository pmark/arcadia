/**
 * `arcadia spend check`, the pure half: given the launch environment and the
 * results of read-only probes, say whether a launch could spend money.
 *
 * Rules this file keeps:
 * - Nothing here reads the host. The caller collects probes (hostProbes.ts) and
 *   tests hand in fixtures.
 * - Only names, booleans and enumerated codes leave. No environment value, URL,
 *   model id, command output or error text is ever copied into the report.
 * - Banners, `/cost` and model names are not evidence. Every risk code names a
 *   mechanism.
 *
 * Decisions, stated once:
 * - Environment variable names match case-insensitively (a lowercase
 *   `anthropic_api_key` is still a billing variable to a case-insensitive shell
 *   or Windows host, so it is counted).
 * - An empty or whitespace-only value is absent: it cannot authenticate, and
 *   the CLIs treat it as unset.
 * - `CLAUDE_CODE_USE_*` is on for any value except 0, false, no and off.
 * - `ANTHROPIC_BASE_URL` is first party only when it parses as https, host
 *   api.anthropic.com, default port, root path and no credentials, query or
 *   fragment. A trailing slash is fine; anything else is a third party.
 */

export const SPEND_PROVIDERS = ["claude", "codex", "opencode"] as const;
export type SpendProviderId = (typeof SPEND_PROVIDERS)[number];
export type SpendVerdict = "clear" | "risk" | "unknown";

export const SPEND_RISK_CODES = [
  "api_key_in_launch_env",
  "third_party_provider",
  "api_key_helper",
  "not_subscription_auth",
  "extra_usage_enabled",
  "purchased_credits_available",
  "paid_model_route"
] as const;
export type SpendRiskCode = (typeof SPEND_RISK_CODES)[number];
export type SpendWarningCode = "approved_custom_api_key" | "notional_cost_only";

/** Why a probe could not run. Enumerated so no error text, which may carry a secret, is ever echoed. */
export type UnavailableReason = "binary_missing" | "probe_failed" | "unreadable" | "source_missing" | "not_collected";
export type Probe<T> = { status: "ok"; value: T } | { status: "unavailable"; reason: UnavailableReason };

export type ClaudeAuthProbe =
  | { kind: "subscription" }
  | { kind: "not_subscription" }
  | { kind: "signed_out" };

export interface SpendProbes {
  claude?: {
    auth: Probe<ClaudeAuthProbe>;
    apiKeyHelper: Probe<boolean>;
    extraUsage: Probe<{ enabled: boolean; profileFetchedAt: string | null }>;
    customApiKeyApproved: Probe<boolean>;
  };
  codex?: {
    /** Raw `codex login status` text; compared, never echoed. */
    loginStatus: Probe<string>;
    credits: Probe<boolean>;
  };
  opencode?: {
    paidIntelligenceRoute: Probe<boolean>;
  };
}

export interface SpendProbeEntry {
  id: string;
  status: "clear" | "risk" | "unknown" | "skipped";
  /** Set on unknown probes. */
  reason?: UnavailableReason;
  /** Set on `extra_usage_enabled`: how old the cached profile is. */
  profileAgeHours?: number | null;
}

export interface SpendProviderReport {
  id: SpendProviderId;
  verdict: SpendVerdict;
  codes: SpendRiskCode[];
  probes: SpendProbeEntry[];
}

export interface SpendReport {
  verdict: SpendVerdict;
  providers: SpendProviderReport[];
  warnings: SpendWarningCode[];
  checkedAt: string;
}

export interface AssessOptions {
  providers?: readonly SpendProviderId[];
  /** OpenCode model id to route-check; names the prefix test only and is never echoed. */
  model?: string;
  now?: Date;
}

const CLAUDE_KEYS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];
const OPENAI_KEYS = ["OPENAI_API_KEY", "CODEX_API_KEY"];
const PROVIDER_SWITCHES = ["CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"];
const BASE_URL = "ANTHROPIC_BASE_URL";
const FIRST_PARTY_HOST = "api.anthropic.com";
const OPENCODE_GO_PREFIX = "opencode-go/";
const CODEX_SUBSCRIPTION_LOGIN = "logged in using chatgpt";

/** Every variable that can route a launch to paid usage; `--launch-env stripped` removes exactly these. */
export const BILLING_ENV_NAMES: readonly string[] = [...CLAUDE_KEYS, ...OPENAI_KEYS, ...PROVIDER_SWITCHES, BASE_URL];

function presentValue(env: NodeJS.ProcessEnv, names: readonly string[]): string | null {
  const wanted = new Set(names);
  for (const [key, value] of Object.entries(env)) {
    if (wanted.has(key.toUpperCase()) && typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

function anyPresent(env: NodeJS.ProcessEnv, names: readonly string[]): boolean {
  return presentValue(env, names) !== null;
}

/** A copy of `env` without any billing variable, whatever the case of its name. */
export function stripBillingEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const billing = new Set(BILLING_ENV_NAMES);
  const kept: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (!billing.has(key.toUpperCase())) kept[key] = value;
  }
  return kept;
}

function isOff(value: string): boolean {
  return ["0", "false", "no", "off"].includes(value.toLowerCase());
}

function baseUrlIsFirstParty(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "https:" && url.hostname === FIRST_PARTY_HOST && url.port === "" && url.pathname.replace(/\/+$/, "") === ""
    && url.username === "" && url.password === "" && url.search === "" && url.hash === "";
}

function thirdPartyProvider(env: NodeJS.ProcessEnv): boolean {
  const switches = new Set(PROVIDER_SWITCHES);
  for (const [key, value] of Object.entries(env)) {
    if (switches.has(key.toUpperCase()) && typeof value === "string" && value.trim() !== "" && !isOff(value.trim())) return true;
  }
  const base = presentValue(env, [BASE_URL]);
  return base !== null && !baseUrlIsFirstParty(base);
}

function fromProbe<T>(probe: Probe<T> | undefined, id: string, test: (value: T) => boolean, extra?: (value: T) => Partial<SpendProbeEntry>): SpendProbeEntry {
  const resolved: Probe<T> = probe ?? { status: "unavailable", reason: "not_collected" };
  if (resolved.status === "unavailable") return { id, status: "unknown", reason: resolved.reason };
  return { id, status: test(resolved.value) ? "risk" : "clear", ...(extra ? extra(resolved.value) : {}) };
}

function ageHours(fetchedAt: string | null, now: Date): number | null {
  if (fetchedAt === null) return null;
  const at = Date.parse(fetchedAt);
  return Number.isNaN(at) ? null : Math.max(0, Math.round((now.getTime() - at) / 3_600_000));
}

function envEntry(id: string, risk: boolean): SpendProbeEntry {
  return { id, status: risk ? "risk" : "clear" };
}

function finish(id: SpendProviderId, entries: Array<{ code?: SpendRiskCode; entry: SpendProbeEntry }>): SpendProviderReport {
  const codes = entries.filter((item) => item.code !== undefined && item.entry.status === "risk").map((item) => item.code!);
  const probes = entries.map((item) => item.entry);
  const verdict: SpendVerdict = codes.length > 0 ? "risk" : probes.some((probe) => probe.status === "unknown") ? "unknown" : "clear";
  return { id, verdict, codes, probes };
}

function assessClaude(env: NodeJS.ProcessEnv, probes: SpendProbes["claude"], now: Date): SpendProviderReport {
  const auth = fromProbe(probes?.auth, "not_subscription_auth", (value) => value.kind !== "subscription");
  const extra = fromProbe(probes?.extraUsage, "extra_usage_enabled", (value) => value.enabled, (value) => ({ profileAgeHours: ageHours(value.profileFetchedAt, now) }));
  return finish("claude", [
    { code: "api_key_in_launch_env", entry: envEntry("api_key_in_launch_env", anyPresent(env, CLAUDE_KEYS)) },
    { code: "third_party_provider", entry: envEntry("third_party_provider", thirdPartyProvider(env)) },
    { code: "api_key_helper", entry: fromProbe(probes?.apiKeyHelper, "api_key_helper", (value) => value) },
    { code: "not_subscription_auth", entry: auth },
    { code: "extra_usage_enabled", entry: extra }
  ]);
}

function assessCodex(env: NodeJS.ProcessEnv, probes: SpendProbes["codex"]): SpendProviderReport {
  return finish("codex", [
    { code: "api_key_in_launch_env", entry: envEntry("api_key_in_launch_env", anyPresent(env, OPENAI_KEYS)) },
    { code: "not_subscription_auth", entry: fromProbe(probes?.loginStatus, "not_subscription_auth", (value) => !value.trim().toLowerCase().startsWith(CODEX_SUBSCRIPTION_LOGIN)) },
    { code: "purchased_credits_available", entry: fromProbe(probes?.credits, "purchased_credits_available", (value) => value) }
  ]);
}

function assessOpenCode(env: NodeJS.ProcessEnv, probes: SpendProbes["opencode"], model: string | undefined): SpendProviderReport {
  const modelEntry: SpendProbeEntry = model === undefined || model.trim() === ""
    ? { id: "paid_model_route.model", status: "skipped" }
    : { id: "paid_model_route.model", status: model.trim().startsWith(OPENCODE_GO_PREFIX) ? "clear" : "risk" };
  const routeEntry = fromProbe(probes?.paidIntelligenceRoute, "paid_model_route.intelligence", (value) => value);
  return finish("opencode", [
    { code: "api_key_in_launch_env", entry: envEntry("api_key_in_launch_env", anyPresent(env, [...CLAUDE_KEYS, ...OPENAI_KEYS])) },
    { code: "paid_model_route", entry: modelEntry },
    { code: "paid_model_route", entry: routeEntry }
  ]);
}

export function assessSpendRisk(env: NodeJS.ProcessEnv, probes: SpendProbes, options: AssessOptions = {}): SpendReport {
  const now = options.now ?? new Date();
  const requested = options.providers ?? SPEND_PROVIDERS;
  const providers = SPEND_PROVIDERS.filter((id) => requested.includes(id)).map((id): SpendProviderReport => {
    if (id === "claude") return assessClaude(env, probes.claude, now);
    if (id === "codex") return assessCodex(env, probes.codex);
    return assessOpenCode(env, probes.opencode, options.model);
  });
  const verdict: SpendVerdict = providers.some((provider) => provider.verdict === "risk") ? "risk"
    : providers.some((provider) => provider.verdict === "unknown") || providers.length === 0 ? "unknown" : "clear";
  const warnings: SpendWarningCode[] = ["notional_cost_only"];
  if (requested.includes("claude") && probes.claude?.customApiKeyApproved.status === "ok" && probes.claude.customApiKeyApproved.value) {
    warnings.unshift("approved_custom_api_key");
  }
  return { verdict, providers, warnings, checkedAt: now.toISOString() };
}

export function spendExitCode(verdict: SpendVerdict): 0 | 3 | 4 {
  return verdict === "clear" ? 0 : verdict === "risk" ? 3 : 4;
}
