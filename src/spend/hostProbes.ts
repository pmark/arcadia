import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { classifyClaudeAuthStatus } from "../qa/reviewerReplay.js";
import { loadIntelligenceConfig } from "../intelligence/config/defaults.js";
import { SPEND_PROVIDERS, type Probe, type SpendProbes, type SpendProviderId, type UnavailableReason } from "./spendCheck.js";

export interface SpendCommandResult { status: number | null; stdout: string; stderr: string; error: string | null }
export type SpendRunner = (input: { command: string; args: string[]; env: NodeJS.ProcessEnv; timeoutMs: number }) => SpendCommandResult;
/** Returns the file text, or null when the file does not exist; throws on any other failure. */
export type SpendFileReader = (file: string) => string | null;

export interface HostProbeDependencies {
  runner?: SpendRunner;
  readText?: SpendFileReader;
  homeDir?: string;
  cwd?: string;
}

const PROBE_TIMEOUT_MS = 15_000;
const MANAGED_SETTINGS = "/Library/Application Support/ClaudeCode/managed-settings.json";

export const defaultRunner: SpendRunner = ({ command, args, env, timeoutMs }) => {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: timeoutMs, env, stdio: ["ignore", "pipe", "pipe"] });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error ? (result.error as NodeJS.ErrnoException).code ?? "error" : null };
};

export const defaultReadText: SpendFileReader = (file) => {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
};

function unavailable(reason: UnavailableReason): Probe<never> {
  return { status: "unavailable", reason };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function runProbe(runner: SpendRunner, command: string, args: string[], env: NodeJS.ProcessEnv): SpendCommandResult | Probe<never> {
  const result = runner({ command, args, env, timeoutMs: PROBE_TIMEOUT_MS });
  if (result.error !== null && result.status === null) return unavailable(result.error === "ENOENT" ? "binary_missing" : "probe_failed");
  return result;
}

function isProbe(value: SpendCommandResult | Probe<never>): value is Probe<never> {
  return "reason" in value;
}

function claudeProbes(env: NodeJS.ProcessEnv, deps: Required<Pick<HostProbeDependencies, "runner" | "readText" | "homeDir" | "cwd">>): NonNullable<SpendProbes["claude"]> {
  const ran = runProbe(deps.runner, "claude", ["auth", "status", "--json"], env);
  let auth: Probe<{ kind: "subscription" | "not_subscription" | "signed_out" }>;
  if (isProbe(ran)) auth = ran;
  else {
    const proof = classifyClaudeAuthStatus(ran.stdout);
    auth = proof.kind === "unreadable" ? unavailable("unreadable") : { status: "ok", value: { kind: proof.kind } };
  }

  let apiKeyHelper: Probe<boolean>;
  try {
    const files = [path.join(deps.homeDir, ".claude", "settings.json"), path.join(deps.cwd, ".claude", "settings.json"), path.join(deps.cwd, ".claude", "settings.local.json"), MANAGED_SETTINGS];
    let found = false;
    let broken = false;
    for (const file of files) {
      const text = deps.readText(file);
      if (text === null) continue;
      const settings = record(parseJson(text));
      if (settings === null) { broken = true; continue; }
      if (typeof settings.apiKeyHelper === "string" && settings.apiKeyHelper.trim() !== "") found = true;
    }
    apiKeyHelper = found ? { status: "ok", value: true } : broken ? unavailable("unreadable") : { status: "ok", value: false };
  } catch {
    apiKeyHelper = unavailable("unreadable");
  }

  let extraUsage: Probe<{ enabled: boolean; profileFetchedAt: string | null }>;
  let customApiKeyApproved: Probe<boolean>;
  try {
    const text = deps.readText(path.join(deps.homeDir, ".claude.json"));
    if (text === null) {
      extraUsage = unavailable("source_missing");
      customApiKeyApproved = unavailable("source_missing");
    } else {
      const config = record(parseJson(text));
      const account = record(config?.oauthAccount);
      const enabled = account?.hasExtraUsageEnabled;
      extraUsage = typeof enabled === "boolean"
        ? { status: "ok", value: { enabled, profileFetchedAt: typeof account?.profileFetchedAt === "string" ? account.profileFetchedAt : null } }
        : unavailable("unreadable");
      const approved = record(config?.customApiKeyResponses)?.approved;
      customApiKeyApproved = config === null ? unavailable("unreadable") : { status: "ok", value: Array.isArray(approved) && approved.length > 0 };
    }
  } catch {
    extraUsage = unavailable("unreadable");
    customApiKeyApproved = unavailable("unreadable");
  }
  return { auth, apiKeyHelper, extraUsage, customApiKeyApproved };
}

function codexProbes(env: NodeJS.ProcessEnv, deps: Required<Pick<HostProbeDependencies, "runner" | "readText" | "homeDir" | "cwd">>): NonNullable<SpendProbes["codex"]> {
  const ran = runProbe(deps.runner, "codex", ["login", "status"], env);
  const loginStatus: Probe<string> = isProbe(ran) ? ran : { status: "ok", value: `${ran.stdout}\n${ran.stderr}`.trim() };
  let credits: Probe<boolean>;
  try {
    const text = deps.readText(path.join(deps.homeDir, ".arcadia", "telemetry", "coding-agent-usage.json"));
    if (text === null) credits = unavailable("source_missing");
    else {
      const flag = record(record(record(record(parseJson(text))?.providers)?.["codex-cli"])?.credits)?.hasCredits;
      credits = typeof flag === "boolean" ? { status: "ok", value: flag } : unavailable("unreadable");
    }
  } catch {
    credits = unavailable("unreadable");
  }
  return { loginStatus, credits };
}

/**
 * Collects only the probes the requested providers need. Local and read-only:
 * the two sign-in commands run through `runner` in `env`, so they see the
 * launch environment; everything else is a file read.
 */
export function collectHostProbes(env: NodeJS.ProcessEnv, providers: readonly SpendProviderId[] = SPEND_PROVIDERS, deps: HostProbeDependencies = {}): SpendProbes {
  const resolved = { runner: deps.runner ?? defaultRunner, readText: deps.readText ?? defaultReadText, homeDir: deps.homeDir ?? os.homedir(), cwd: deps.cwd ?? process.cwd() };
  const probes: SpendProbes = {};
  if (providers.includes("claude")) probes.claude = claudeProbes(env, resolved);
  if (providers.includes("codex")) probes.codex = codexProbes(env, resolved);
  if (providers.includes("opencode")) {
    probes.opencode = { paidIntelligenceRoute: { status: "ok", value: loadIntelligenceConfig(env).routes.some((route) => route.enabled && route.requiresPaidUsage) } };
  }
  return probes;
}
