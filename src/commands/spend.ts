import { validationError } from "../cli/errors.js";
import { createSuccess, type CommandSuccess } from "../cli/response.js";
import { collectHostProbes, type HostProbeDependencies } from "../spend/hostProbes.js";
import { assessSpendRisk, stripBillingEnv, SPEND_PROVIDERS, type SpendProviderId, type SpendReport } from "../spend/spendCheck.js";

export interface SpendCheckOptions {
  provider?: string;
  launchEnv?: string;
  model?: string;
}

export interface SpendCheckDependencies extends HostProbeDependencies {
  env?: NodeJS.ProcessEnv;
  now?: Date;
}

export function runSpendCheckCommand(options: SpendCheckOptions, deps: SpendCheckDependencies = {}): CommandSuccess<SpendReport> {
  const provider = options.provider ?? "all";
  if (provider !== "all" && !(SPEND_PROVIDERS as readonly string[]).includes(provider)) {
    throw validationError("--provider must be claude, codex, opencode or all.");
  }
  const launchEnv = options.launchEnv ?? "current";
  if (launchEnv !== "current" && launchEnv !== "stripped") throw validationError("--launch-env must be current or stripped.");
  const providers: SpendProviderId[] = provider === "all" ? [...SPEND_PROVIDERS] : [provider as SpendProviderId];
  const base = deps.env ?? process.env;
  // Stripped is applied before any probe runs, so the sign-in commands and the
  // environment tests all see what a stripped child would get.
  const env = launchEnv === "stripped" ? stripBillingEnv(base) : base;
  const report = assessSpendRisk(env, collectHostProbes(env, providers, deps), { providers, model: options.model, now: deps.now });
  return createSuccess({ command: "spend.check", data: report });
}
