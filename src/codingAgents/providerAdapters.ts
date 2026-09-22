import type {
  AutonomyLevel,
  CapabilityTier,
  ContextScope,
  DataLocalityRequirement,
  ExecutionPhase,
  ReasoningEffort,
  ResolvedExecutionProfile,
  ResolvedExecutionRequirement
} from "../execution/profiles.js";
import {
  AUTONOMY_LEVELS,
  CAPABILITY_TIERS,
  CONTEXT_SCOPES,
  REASONING_EFFORTS
} from "../execution/profiles.js";
import type { CodingAgentProfile } from "../intent/registries.js";
import type { CodingAgentAvailabilitySnapshot } from "./availability.js";
import { isCodingAgentAvailable } from "./availability.js";

export interface ProviderAdapterRegistry {
  version: number;
  mappingId: string;
  observedAt: string;
  providers: ProviderAdapterProvider[];
  bindings: ProviderAdapterBinding[];
}

export interface ProviderAdapterProvider {
  id: string;
  enabled: boolean;
  unavailableReason?: string;
}

export interface ProviderAdapterBinding {
  id: string;
  provider: string;
  agentProfiles: string[];
  capability: CapabilityTier;
  model: string;
  modelArgs: string[];
  effortArgs: Partial<Record<ReasoningEffort, string[]>>;
  tools: boolean;
  contextScopes: ContextScope[];
  locality: "local" | "remote";
  costRank: number;
  enabled: boolean;
}

export interface SelectedCodingAgentConfiguration {
  mappingId: string;
  bindingId: string;
  profile: CodingAgentProfile;
  provider: string;
  model: string;
  capability: CapabilityTier;
  effort: ReasoningEffort;
  args: string[];
  costRank: number;
}

export interface CodingAgentSelectionInput {
  profiles: CodingAgentProfile[];
  adapters: ProviderAdapterRegistry;
  requirement: ResolvedExecutionRequirement;
  phase?: ExecutionPhase;
  purpose: "planning" | "build";
  availability: CodingAgentAvailabilitySnapshot;
  requestedProfile?: string;
  excludeProvider?: string;
  /**
   * Provider id to visible refusal reason, from capacity admission. Selection
   * filters these out *before* ranking, so a limited provider yields a different
   * eligible configured provider rather than a weaker substitution — the
   * capability floors below still apply to whatever remains.
   */
  capacityRefusals?: Record<string, string>;
  /**
   * Deterministic, named reasons a specific provider cannot execute the work
   * right now — never an advisory capacity estimate. Selection excludes a
   * provider named here from candidates, exactly like `capacityRefusals`, but
   * the reason is carried through as a closed, typed code so a caller can
   * record *why* a substitution happened. See {@link HardProviderEvidenceCode}.
   */
  hardEvidence?: HardProviderEvidence[];
}

/**
 * The closed set of deterministic, launch-precluding facts that justify
 * substituting a different permitted provider before a packet binds (Decision
 * 0063). Nothing advisory belongs here: an unadmitted, stale, reserve-margin
 * or exhausted capacity *estimate* (src/codingAgents/capacity.ts) is never
 * hard evidence, because capacity attestation is deliberately non-gating.
 * Adding or removing a value here is a deliberate change to what may trigger
 * substitution — `providerAdapters.test.ts` pins this exact list so that
 * change cannot happen silently.
 */
export const HARD_PROVIDER_EVIDENCE_CODES = [
  "provider_unavailable",
  "model_unavailable",
  "authentication_failure",
  "quota_or_rate_limit_rejected",
  "launch_precluded"
] as const;

export type HardProviderEvidenceCode = (typeof HARD_PROVIDER_EVIDENCE_CODES)[number];

/** One deterministic, named reason a provider cannot run the work right now. */
export interface HardProviderEvidence {
  providerId: string;
  code: HardProviderEvidenceCode;
  reason: string;
}

export class ExecutionProfileUnsatisfiedError extends Error {
  public readonly code = "EXECUTION_PROFILE_UNSATISFIED";

  public constructor(
    message: string,
    public readonly details: Record<string, unknown>
  ) {
    super(message);
    this.name = "ExecutionProfileUnsatisfiedError";
  }
}

export function selectCompliantCodingAgent(
  input: CodingAgentSelectionInput
): SelectedCodingAgentConfiguration {
  const requirement = input.phase
    ? input.requirement.phases[input.phase] ?? input.requirement.baseline
    : input.requirement.baseline;
  const providerStates = new Map(
    input.adapters.providers.map((provider) => [provider.id, provider])
  );
  const hardEvidenceByProvider = new Map(
    (input.hardEvidence ?? []).map((evidence) => [evidence.providerId, evidence])
  );
  const candidates: SelectedCodingAgentConfiguration[] = [];
  const rejected: Array<{ binding: string; reason: string }> = [];

  for (const binding of input.adapters.bindings) {
    const provider = providerStates.get(binding.provider);
    if (!binding.enabled || !provider?.enabled) {
      rejected.push({ binding: binding.id, reason: provider?.unavailableReason ?? "disabled" });
      continue;
    }
    const hardEvidence = hardEvidenceByProvider.get(binding.provider);
    if (hardEvidence) {
      rejected.push({ binding: binding.id, reason: `${hardEvidence.code}: ${hardEvidence.reason}` });
      continue;
    }
    const capacityRefusal = input.capacityRefusals?.[binding.provider];
    if (capacityRefusal) {
      rejected.push({ binding: binding.id, reason: capacityRefusal });
      continue;
    }
    if (input.excludeProvider && binding.provider === input.excludeProvider) {
      rejected.push({ binding: binding.id, reason: "provider excluded by review-independence requirement" });
      continue;
    }
    if (capabilityRank(binding.capability) < capabilityRank(requirement.capability)) {
      rejected.push({ binding: binding.id, reason: `capability ${binding.capability} is below ${requirement.capability}` });
      continue;
    }
    if (requirement.tools === "required" && !binding.tools) {
      rejected.push({ binding: binding.id, reason: "required tools are unavailable" });
      continue;
    }
    if (!binding.contextScopes.includes(requirement.context.scope)) {
      rejected.push({ binding: binding.id, reason: `context scope ${requirement.context.scope} is unsupported` });
      continue;
    }
    if (requirement.dataLocality === "local_only" && binding.locality !== "local") {
      rejected.push({ binding: binding.id, reason: "local-only data policy excludes this provider" });
      continue;
    }

    const effort = leastSupportedEffort(binding, requirement.effort);
    if (!effort) {
      rejected.push({ binding: binding.id, reason: `effort ${requirement.effort} is unsupported` });
      continue;
    }

    for (const profileName of binding.agentProfiles) {
      const profile = input.profiles.find((candidate) => candidate.name === profileName);
      if (!profile || profile.purpose !== input.purpose) continue;
      if (input.requestedProfile && profile.name !== input.requestedProfile) continue;
      if (!isCodingAgentAvailable(profile, input.availability)) {
        rejected.push({ binding: binding.id, reason: `profile ${profile.name} is unavailable` });
        continue;
      }
      if (!sandboxAllows(profile.sandbox, requirement.autonomy)) {
        rejected.push({
          binding: binding.id,
          reason: `sandbox ${profile.sandbox} cannot satisfy autonomy ${requirement.autonomy}`
        });
        continue;
      }
      candidates.push({
        mappingId: input.adapters.mappingId,
        bindingId: binding.id,
        profile,
        provider: binding.provider,
        model: binding.model,
        capability: binding.capability,
        effort,
        args: [...binding.modelArgs, ...(binding.effortArgs[effort] ?? [])],
        costRank: binding.costRank
      });
    }
  }

  candidates.sort((left, right) =>
    capabilityRank(left.capability) - capabilityRank(right.capability) ||
    effortRank(left.effort) - effortRank(right.effort) ||
    left.costRank - right.costRank ||
    left.profile.name.localeCompare(right.profile.name)
  );
  const selected = candidates[0];
  if (selected) return selected;

  throw new ExecutionProfileUnsatisfiedError(
    `No ${input.purpose} coding-agent configuration satisfies ` +
      `${requirement.capability}/${requirement.effort}. ` +
      `No weaker substitution was made. ` +
      `Rejected mappings: ${rejected.map((entry) => `${entry.binding} (${entry.reason})`).join(", ") || "none configured"}.`,
    {
      phase: input.phase ?? null,
      capability: requirement.capability,
      effort: requirement.effort,
      tools: requirement.tools,
      contextScope: requirement.context.scope,
      dataLocality: requirement.dataLocality,
      requestedProfile: input.requestedProfile ?? null,
      capacityRefusals: input.capacityRefusals ?? {},
      hardEvidence: input.hardEvidence ?? [],
      rejected
    }
  );
}

// ---------------------------------------------------------------------------
// Hard-evidence substitution (Decision 0063)
// ---------------------------------------------------------------------------

/** Visible record of a provider substitution driven by hard evidence. */
export interface HardEvidenceSubstitution {
  /** The provider that would have run this work absent the hard evidence. */
  intendedProvider: string;
  /** Which closed hard-evidence value caused the substitution. */
  code: HardProviderEvidenceCode;
  /** The visible reason the intended provider could not run the work. */
  reason: string;
  /**
   * Substitution changes who runs the work, never what was already applied.
   * Carried on the result so a caller cannot quietly restart a partial Run on
   * the substitute.
   */
  resumeGuidance: string;
}

export interface HardEvidenceAdmittedSelection {
  configuration: SelectedCodingAgentConfiguration;
  substitution: HardEvidenceSubstitution | null;
  /** Every provider hard evidence excluded, for the record. */
  excluded: Record<string, HardProviderEvidence>;
}

/**
 * Select a compliant provider, substituting away from a provider named by
 * hard evidence before this work's packet binds. The order matters: hard
 * evidence removes providers from the pool, and `selectCompliantCodingAgent`
 * then applies the same capability, tools, context, locality and sandbox
 * floors it always does to whatever is left — a limited provider therefore
 * yields a *different eligible configured provider* or nothing at all, never
 * a weaker one. `capacityRefusals` (advisory) is applied identically to both
 * the "intended" and the "actual" selection below, so an advisory-only
 * difference can never be recorded as a substitution — only a difference hard
 * evidence caused can be.
 *
 * "Intended" is computed against a registry where only the exact provider and
 * bindings the hard evidence names are treated as available again — not by
 * merely dropping the `hardEvidence` list. Some hard evidence (a disabled
 * registry provider, every binding for it disabled, no launch adapter) is
 * *also* what a disabled `providers`/`bindings` entry already excludes
 * structurally, so dropping only `hardEvidence` would leave that provider
 * excluded either way and silently produce `intended === actual` — losing the
 * substitution record for exactly the evidence this function exists to prove.
 *
 * This function makes no call itself once a packet exists: it is meant to run
 * only at the moment a new packet is about to bind, never again for an
 * existing one (see selectAgentProfileForWorkItem in src/codex/packets.ts).
 */
export function selectProviderWithHardEvidenceSubstitution(
  input: CodingAgentSelectionInput
): HardEvidenceAdmittedSelection {
  const excluded: Record<string, HardProviderEvidence> = {};
  for (const evidence of input.hardEvidence ?? []) {
    excluded[evidence.providerId] = evidence;
  }

  const adaptersWithoutHardEvidence = bypassHardEvidenceRestriction(input.adapters, excluded);
  const intended = ((): SelectedCodingAgentConfiguration | null => {
    try {
      return selectCompliantCodingAgent({
        ...input,
        adapters: adaptersWithoutHardEvidence,
        hardEvidence: undefined
      });
    } catch (error) {
      if (!(error instanceof ExecutionProfileUnsatisfiedError)) throw error;
      return null;
    }
  })();

  const configuration = selectCompliantCodingAgent(input);

  const intendedEvidence = intended ? excluded[intended.provider] : undefined;
  const substitution =
    intended && intendedEvidence && intended.provider !== configuration.provider
      ? {
          intendedProvider: intended.provider,
          code: intendedEvidence.code,
          reason: intendedEvidence.reason,
          resumeGuidance:
            `Resume this Action from its recorded checkpoint on ${configuration.provider}. ` +
            `Work already applied by ${intended.provider} must not be replayed.`
        }
      : null;

  return { configuration, substitution, excluded };
}

/**
 * Rebuild a registry as if the providers named in `excluded` were never
 * restricted, so an "intended" selection can be computed as a true
 * counterfactual of the hard evidence — not merely of the `hardEvidence`
 * input field, which by itself cannot undo a structurally disabled provider
 * or binding. Only the exact providers named are touched; every other
 * capability, tools, context, locality, sandbox and capacity constraint is
 * untouched, so this never widens what an evidenced provider is eligible for
 * beyond "as if this one restriction did not apply".
 */
function bypassHardEvidenceRestriction(
  adapters: ProviderAdapterRegistry,
  excluded: Record<string, HardProviderEvidence>
): ProviderAdapterRegistry {
  if (Object.keys(excluded).length === 0) return adapters;
  return {
    ...adapters,
    providers: adapters.providers.map((provider) =>
      excluded[provider.id] ? { ...provider, enabled: true, unavailableReason: undefined } : provider),
    bindings: adapters.bindings.map((binding) =>
      excluded[binding.provider] ? { ...binding, enabled: true } : binding)
  };
}

/**
 * Providers the canonical Session subsystem can actually spawn today. Mirrors
 * the hardcoded check in prepareSession (sessions/index.ts) — kept as an
 * explicit, named table here so this table's callers (launch preview and
 * packet binding) and prepareSession's launch-time refusal can never silently
 * drift apart from being the same fact stated twice with different wording.
 */
export const LAUNCH_ADAPTER_SUPPORT: Record<string, boolean> = {
  "codex-cli": true,
  "claude-code-cli": true,
  "opencode-cli": true
};

/**
 * Detect the deterministic, non-advisory facts this host already knows about
 * each configured provider: disabled in the registry, every model binding for
 * it disabled, or no supported Session launch adapter exists for it yet.
 * `authentication_failure` and `quota_or_rate_limit_rejected` are valid, typed
 * members of {@link HardProviderEvidenceCode} that a caller may populate from
 * its own explicit rejection (a real 401, a provider's own "rate limit
 * reached" flag) — this detector does not emit them, because no such
 * structured, non-advisory signal exists on this host yet without reusing the
 * percentage-based capacity estimates Decision 0063 made deliberately
 * non-gating.
 */
export function detectHardProviderEvidence(
  adapters: ProviderAdapterRegistry
): HardProviderEvidence[] {
  const evidence: HardProviderEvidence[] = [];
  for (const provider of adapters.providers) {
    if (!provider.enabled) {
      evidence.push({
        providerId: provider.id,
        code: "provider_unavailable",
        reason: provider.unavailableReason ?? `Provider ${provider.id} is disabled in the provider-adapter registry.`
      });
      continue;
    }
    if (!LAUNCH_ADAPTER_SUPPORT[provider.id]) {
      evidence.push({
        providerId: provider.id,
        code: "launch_precluded",
        reason: `Provider ${provider.id} has no supported Session launch adapter yet.`
      });
      continue;
    }
    const providerBindings = adapters.bindings.filter((binding) => binding.provider === provider.id);
    if (providerBindings.length > 0 && providerBindings.every((binding) => !binding.enabled)) {
      evidence.push({
        providerId: provider.id,
        code: "model_unavailable",
        reason: `Every provider-adapter binding for ${provider.id} is disabled; no model is currently offered.`
      });
    }
  }
  return evidence;
}

/**
 * Bind an Action that predates execution requirements to the configured
 * default profile's least-cost enabled mapping. The default profile is already
 * the operator's choice; recording its binding makes the immutable packet
 * launchable and auditable instead of silently leaving it unbound.
 */
export function selectDefaultCodingAgentConfiguration(
  adapters: ProviderAdapterRegistry,
  profile: CodingAgentProfile
): SelectedCodingAgentConfiguration | null {
  const providers = new Map(adapters.providers.map((provider) => [provider.id, provider]));
  const candidates = adapters.bindings.flatMap((binding) => {
    const provider = providers.get(binding.provider);
    if (!binding.enabled || !provider?.enabled || !binding.agentProfiles.includes(profile.name)) {
      return [];
    }
    const effort = leastSupportedEffort(binding, "e2_standard");
    if (!effort) return [];
    return [{
      mappingId: adapters.mappingId,
      bindingId: binding.id,
      profile,
      provider: binding.provider,
      model: binding.model,
      capability: binding.capability,
      effort,
      args: [...binding.modelArgs, ...(binding.effortArgs[effort] ?? [])],
      costRank: binding.costRank
    }];
  });
  candidates.sort((left, right) =>
    left.costRank - right.costRank ||
    capabilityRank(left.capability) - capabilityRank(right.capability) ||
    left.bindingId.localeCompare(right.bindingId)
  );
  return candidates[0] ?? null;
}

export function validateProviderAdapterRegistry(
  registry: ProviderAdapterRegistry,
  profiles: CodingAgentProfile[]
): void {
  if (!Number.isInteger(registry.version) || registry.version < 1) {
    throw new Error("Provider adapter registry version must be a positive integer.");
  }
  if (!registry.mappingId?.trim()) {
    throw new Error("Provider adapter registry mappingId is required.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(registry.observedAt)) {
    throw new Error("Provider adapter registry observedAt must be an ISO date.");
  }
  const providerIds = new Set<string>();
  for (const provider of registry.providers) {
    if (!provider.id?.trim() || providerIds.has(provider.id)) {
      throw new Error(`Provider adapter id must be present and unique: ${provider.id}`);
    }
    providerIds.add(provider.id);
  }
  const bindingIds = new Set<string>();
  for (const binding of registry.bindings) {
    if (!binding.id?.trim() || bindingIds.has(binding.id)) {
      throw new Error(`Provider adapter binding id must be present and unique: ${binding.id}`);
    }
    bindingIds.add(binding.id);
    if (!providerIds.has(binding.provider)) {
      throw new Error(`Provider adapter binding ${binding.id} references unknown provider ${binding.provider}.`);
    }
    if (!CAPABILITY_TIERS.includes(binding.capability)) {
      throw new Error(`Provider adapter binding ${binding.id} has invalid capability ${binding.capability}.`);
    }
    if (!binding.model?.trim() || binding.modelArgs.length === 0) {
      throw new Error(`Provider adapter binding ${binding.id} must enforce a model.`);
    }
    if (!Number.isInteger(binding.costRank) || binding.costRank < 0) {
      throw new Error(`Provider adapter binding ${binding.id} costRank must be a non-negative integer.`);
    }
    for (const profileName of binding.agentProfiles) {
      const profile = profiles.find((candidate) => candidate.name === profileName);
      // Workspace registries may intentionally replace all bundled profiles
      // (for example, with a deterministic test or local agent). A binding for
      // a profile absent from that workspace is simply ineligible at selection
      // time; it is not evidence that the immutable mapping itself is malformed.
      if (!profile) continue;
      if (profile.provider !== binding.provider) {
        throw new Error(
          `Provider adapter binding ${binding.id} provider ${binding.provider} ` +
            `does not match profile ${profileName} provider ${profile.provider}.`
        );
      }
    }
    for (const effort of Object.keys(binding.effortArgs)) {
      if (!REASONING_EFFORTS.includes(effort as ReasoningEffort)) {
        throw new Error(`Provider adapter binding ${binding.id} has invalid effort ${effort}.`);
      }
    }
    for (const scope of binding.contextScopes) {
      if (!CONTEXT_SCOPES.includes(scope)) {
        throw new Error(`Provider adapter binding ${binding.id} has invalid context scope ${scope}.`);
      }
    }
  }
}

function leastSupportedEffort(
  binding: ProviderAdapterBinding,
  minimum: ReasoningEffort
): ReasoningEffort | null {
  return REASONING_EFFORTS
    .filter((effort) => binding.effortArgs[effort])
    .find((effort) => effortRank(effort) >= effortRank(minimum)) ?? null;
}

function sandboxAllows(
  sandbox: CodingAgentProfile["sandbox"],
  autonomy: AutonomyLevel
): boolean {
  if (!AUTONOMY_LEVELS.includes(autonomy)) return false;
  if (autonomy === "advise" || autonomy === "draft") return true;
  return sandbox === "workspace-write" || sandbox === "danger-full-access";
}

function capabilityRank(value: CapabilityTier): number {
  return CAPABILITY_TIERS.indexOf(value);
}

function effortRank(value: ReasoningEffort): number {
  return REASONING_EFFORTS.indexOf(value);
}

export function localitySatisfies(
  binding: ProviderAdapterBinding,
  requirement: DataLocalityRequirement
): boolean {
  return requirement === "any" || binding.locality === "local";
}

export function profileForPhase(
  requirement: ResolvedExecutionRequirement,
  phase?: ExecutionPhase
): ResolvedExecutionProfile {
  return phase ? requirement.phases[phase] ?? requirement.baseline : requirement.baseline;
}
