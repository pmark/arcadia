import { spawnSync } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";
import { validationError } from "../cli/errors.js";
import { providerLabel } from "../codingAgents/adapters.js";
import type { ProviderSignInStatus } from "../codingAgents/signIn.js";

/**
 * Refusals a launch makes BEFORE it reserves anything (admission, worktree,
 * claim, lease), so a missing prerequisite costs nothing and an unattended
 * tick that retries it every few seconds accumulates no worktrees.
 *
 * Each refusal is a `conflict` error with a named `code`:
 *
 *   provider_binary_missing      the provider executable is not on PATH
 *   provider_not_signed_in       the provider has no usable credential
 *   permission_posture_missing   a headless launch cannot apply its permission
 *                                posture (the installed provider lacks the
 *                                flags that carry it)
 *
 * Tests run against stubbed providers: with no `env` given the checks are
 * skipped under Vitest (exactly like the existing sign-in probe, which must
 * not depend on this host's real installation), and an explicit `env`
 * (`{ PATH: <stub dir> }`) forces them on against that environment.
 */

interface ProviderRequirements {
  executable: string;
  /** Arguments that print the help text a headless launch's flags must appear in. */
  helpArgs: string[];
  /** The flags a headless launch passes, so the installed provider must know them. */
  headlessFlags: string[];
}

const PROVIDER_REQUIREMENTS: Record<string, ProviderRequirements> = {
  "claude-code-cli": {
    executable: "claude",
    helpArgs: ["--help"],
    headlessFlags: ["--print", "--output-format", "--permission-mode", "--settings", "--setting-sources", "--verbose"]
  },
  "codex-cli": {
    executable: "codex",
    helpArgs: ["exec", "--help"],
    headlessFlags: ["--json", "--sandbox"]
  },
  // `opencode run` is headless by nature and takes its permission posture from
  // its ambient configuration, which Arcadia does not manage.
  "opencode-cli": { executable: "opencode", helpArgs: [], headlessFlags: [] }
};

const HELP_PROBE_TIMEOUT_MS = 15_000;

/** The first executable named `name` on `env.PATH`, or null. */
export function findExecutable(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  for (const directory of (env.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, name);
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not here; keep looking.
    }
  }
  return null;
}

export interface LaunchPrerequisiteInput {
  provider: string;
  /** False for an operator-attended interactive launch, which applies no headless posture. */
  headless: boolean;
  /** Environment to check against; omitted, the check is skipped under Vitest. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Refuse unless the provider binary exists and, for a headless launch, can
 * carry the permission posture. Returns silently for a provider with no
 * requirements (the fixture).
 */
export function checkLaunchPrerequisites(input: LaunchPrerequisiteInput): void {
  if (!input.env && process.env.VITEST) return;
  const requirements = PROVIDER_REQUIREMENTS[input.provider];
  if (!requirements) return;
  const env = input.env ?? process.env;
  const label = providerLabel(input.provider);

  const binary = findExecutable(requirements.executable, env);
  if (!binary) {
    throw validationError(
      `Provider "${label}" cannot launch: the "${requirements.executable}" executable was not found on this worker's PATH.`,
      {
        code: "provider_binary_missing", conflict: true, provider: input.provider, executable: requirements.executable,
        remedy: `Install ${label} on this worker, or add its directory to the worker's PATH, then retry.`
      }
    );
  }
  if (!input.headless || requirements.headlessFlags.length === 0) return;

  const probe = spawnSync(binary, requirements.helpArgs, { encoding: "utf8", timeout: HELP_PROBE_TIMEOUT_MS, env });
  const help = `${probe.stdout ?? ""}\n${probe.stderr ?? ""}`;
  const unsupported = requirements.headlessFlags.filter((flag) => !help.includes(flag));
  if (probe.error || unsupported.length > 0) {
    throw validationError(
      `Provider "${label}" cannot launch headless: its permission posture is missing because the installed "${requirements.executable}" ` +
        (probe.error
          ? `could not report its options (${probe.error.message}).`
          : `does not support ${unsupported.join(", ")}.`),
      {
        code: "permission_posture_missing", conflict: true, provider: input.provider, unsupportedFlags: unsupported,
        remedy: `Upgrade ${label} on this worker to a version that supports the headless flags, then retry.`
      }
    );
  }
}

/** Throw the named `provider_not_signed_in` refusal unless `signIn` confirms (or cannot dispute) sign-in. */
export function refuseUnlessSignedIn(
  provider: string,
  signIn: ProviderSignInStatus | null,
  onConfirmed?: (provider: string) => void
): void {
  if (!signIn) return;
  if (!signIn.signedIn) {
    throw validationError(
      `Provider "${providerLabel(provider)}" is not signed in for this worker. ${signIn.remedy}`,
      { code: "provider_not_signed_in", conflict: true, provider }
    );
  }
  onConfirmed?.(provider);
}
