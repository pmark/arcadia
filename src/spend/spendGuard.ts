/**
 * The enforcement half of `arcadia spend check`: every launcher asks this one
 * module whether a launch may proceed, so none of them re-derives the rule.
 *
 * - The verdict is computed for the child's real environment: launches add
 *   `env -u <name>` for every billing variable, so the check runs on the
 *   stripped environment (`--launch-env stripped` semantics).
 * - `risk` and `unknown` both refuse. Only `clear` launches.
 * - A refusal names provider, codes and probe ids only. No environment value,
 *   URL, model id or command output is ever copied into a message.
 */
import { validationError } from "../cli/errors.js";
export { hasBillingVariable } from "./billingEnv.js";
import { collectHostProbes, type HostProbeDependencies } from "./hostProbes.js";
import { assessSpendRisk, BILLING_ENV_NAMES, stripBillingEnv, type SpendProviderId, type SpendReport, type SpendVerdict } from "./spendCheck.js";

/** Adapter provider ids to the spend check's provider ids. */
const SPEND_PROVIDER_FOR_ADAPTER: Record<string, SpendProviderId> = {
  "claude-code-cli": "claude",
  "codex-cli": "codex",
  "opencode-cli": "opencode",
  claude: "claude",
  codex: "codex",
  opencode: "opencode"
};

export function spendProviderFor(provider: string): SpendProviderId | null {
  return SPEND_PROVIDER_FOR_ADAPTER[provider] ?? null;
}

/**
 * `env -u` arguments for every billing variable: the canonical names plus any
 * differently cased spelling actually present in `env`, because `env -u` is
 * case sensitive and a lowercase variable would otherwise survive.
 */
export function billingUnsetArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  const names = new Set<string>(BILLING_ENV_NAMES);
  const billing = new Set(BILLING_ENV_NAMES);
  for (const key of Object.keys(env)) if (billing.has(key.toUpperCase())) names.add(key);
  return [...names].flatMap((name) => ["-u", name]);
}

export interface LaunchSpendDeps extends HostProbeDependencies {
  /** The launcher's own environment; the check runs on a stripped copy. */
  env?: NodeJS.ProcessEnv;
  /** Test seam: replaces the whole check with a fixed report. */
  report?: (provider: SpendProviderId) => SpendReport;
}

export interface LaunchSpendResult {
  provider: SpendProviderId | null;
  verdict: SpendVerdict;
  codes: string[];
  /** Probe ids that were `unknown`, with their enumerated reasons. */
  unknown: string[];
}

/** Evaluates a launch of `provider`; a provider the check does not cover is `clear` (nothing documented to refuse on). */
export function evaluateLaunchSpend(provider: string, model: string | undefined, deps: LaunchSpendDeps = {}): LaunchSpendResult {
  const id = spendProviderFor(provider);
  if (id === null) return { provider: null, verdict: "clear", codes: [], unknown: [] };
  const env = stripBillingEnv(deps.env ?? process.env);
  const report = deps.report
    ? deps.report(id)
    : assessSpendRisk(env, collectHostProbes(env, [id], deps), { providers: [id], model, now: deps.now });
  const entry = report.providers.find((item) => item.id === id);
  const unknown = (entry?.probes ?? []).filter((probe) => probe.status === "unknown").map((probe) => `${probe.id}:${probe.reason ?? "unknown"}`);
  return { provider: id, verdict: report.verdict, codes: entry?.codes ?? [], unknown };
}

/** The one-sentence refusal; `null` for a clear verdict. Never carries a value. */
export function spendRefusalMessage(result: LaunchSpendResult, subject = "This launch"): string | null {
  if (result.verdict === "clear") return null;
  const detail = result.verdict === "risk"
    ? `could spend money (${result.codes.join(", ") || "risk"})`
    : `could not be proven free of spend (unknown: ${result.unknown.join(", ") || "no probe result"})`;
  return `${subject} is refused: the spend check for ${result.provider ?? "this provider"} ${detail}. ` +
    "Run \"arcadia spend check --launch-env stripped\" and fix what it names; a risk or unknown verdict never launches.";
}

/** Throws the named refusal (`spend_risk` or `spend_unknown`) unless the verdict is clear. */
export function refuseUnlessSpendClear(result: LaunchSpendResult, subject?: string): void {
  const message = spendRefusalMessage(result, subject);
  if (message === null) return;
  throw validationError(message, {
    code: result.verdict === "risk" ? "spend_risk" : "spend_unknown",
    conflict: true,
    provider: result.provider,
    codes: result.codes,
    unknown: result.unknown
  });
}

/**
 * For the Intelligence CLI executors: the refusal `[code, message]` for this
 * provider's spend verdict, or null when clear. Under Vitest the real host
 * probes never run unless a test passes seams.
 */
export function executorSpendRefusal(provider: string, deps: LaunchSpendDeps | undefined): [string, string] | null {
  if (process.env.VITEST && !deps) return null;
  const result = evaluateLaunchSpend(provider, undefined, deps ?? {});
  const message = spendRefusalMessage(result, "This Intelligence CLI run");
  return message === null ? null : [result.verdict === "risk" ? "SPEND_RISK" : "SPEND_UNKNOWN", message];
}
