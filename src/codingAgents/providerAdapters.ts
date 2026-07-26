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
  const candidates: SelectedCodingAgentConfiguration[] = [];
  const rejected: Array<{ binding: string; reason: string }> = [];

  for (const binding of input.adapters.bindings) {
    const provider = providerStates.get(binding.provider);
    if (!binding.enabled || !provider?.enabled) {
      rejected.push({ binding: binding.id, reason: provider?.unavailableReason ?? "disabled" });
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
      rejected
    }
  );
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
