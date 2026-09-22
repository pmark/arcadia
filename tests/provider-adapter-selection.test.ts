import { describe, expect, it } from "vitest";
import type { CodingAgentAvailabilitySnapshot } from "../src/codingAgents/availability.js";
import {
  detectHardProviderEvidence,
  ExecutionProfileUnsatisfiedError,
  HARD_PROVIDER_EVIDENCE_CODES,
  selectCompliantCodingAgent,
  selectDefaultCodingAgentConfiguration,
  selectProviderWithHardEvidenceSubstitution,
  validateProviderAdapterRegistry,
  type HardProviderEvidence,
  type HardProviderEvidenceCode,
  type ProviderAdapterRegistry
} from "../src/codingAgents/providerAdapters.js";
import { parseExecutionRequirement } from "../src/execution/profiles.js";
import type { CodingAgentProfile } from "../src/intent/registries.js";
import adapters from "../config/defaults/provider-adapters.json";

const profiles: CodingAgentProfile[] = [
  profile("codex_planning", "codex-cli", "planning", "read-only"),
  profile("codex_build", "codex-cli", "build", "workspace-write"),
  profile("claude_planning", "claude-code-cli", "planning", "read-only"),
  profile("claude_build", "claude-code-cli", "build", "workspace-write"),
  profile("opencode_build", "opencode-cli", "build", "workspace-write")
];

const availability: CodingAgentAvailabilitySnapshot = {
  generatedAt: "2026-07-25T00:00:00.000Z",
  agents: profiles.map((profile) => ({
    provider: profile.provider,
    providerId: profile.provider,
    profiles: [profile.name],
    availability: "available",
    observedTasks: 0,
    usageLimitedTasks: 0,
    budgetLimitedTasks: 0,
    remainingTokens: null,
    resetAt: null,
    context: null,
    rateLimits: [],
    capturedAt: null,
    telemetry: "test"
  }))
};

describe("provider-adapter selection", () => {
  it("validates the bundled immutable mapping", () => {
    expect(() => validateProviderAdapterRegistry(adapters as never, profiles)).not.toThrow();
  });

  it("selects the least costly exact-capability configuration", () => {
    const requirement = resolved("routine_implementation");
    const selected = selectCompliantCodingAgent({
      profiles,
      adapters: adapters as never,
      requirement,
      purpose: "build",
      availability
    });

    expect(selected).toMatchObject({
      mappingId: "bundled-2026-07-25.1",
      bindingId: "codex-terra",
      capability: "c2_integrated",
      effort: "e2_standard",
      profile: { name: "codex_build" }
    });
    expect(selected.args).toEqual([
      "--model",
      "gpt-5.6-terra",
      "--config",
      "model_reasoning_effort=\"medium\""
    ]);
  });

  it("selects the least-cost default binding before comparing capability", () => {
    const selected = selectDefaultCodingAgentConfiguration({
      mappingId: "test-map",
      version: 1,
      observedAt: "2026-07-25T00:00:00.000Z",
      providers: [
        { id: "codex-cli", enabled: true }
      ],
      bindings: [
        {
          id: "higher-capability-expensive",
          provider: "codex-cli",
          model: "expensive",
          capability: "c3_systems",
          agentProfiles: ["codex_build"],
          enabled: true,
          costRank: 2,
          modelArgs: [],
          effortArgs: { e2_standard: [] },
          tools: true,
          contextScopes: ["project"],
          locality: "local"
        },
        {
          id: "lower-capability-cheap",
          provider: "codex-cli",
          model: "cheap",
          capability: "c2_integrated",
          agentProfiles: ["codex_build"],
          enabled: true,
          costRank: 1,
          modelArgs: [],
          effortArgs: { e2_standard: [] },
          tools: true,
          contextScopes: ["project"],
          locality: "local"
        }
      ]
    }, profiles[1]);

    expect(selected?.bindingId).toBe("lower-capability-cheap");
  });

  it("uses a systems-capable binding for a systems Action", () => {
    const selected = selectCompliantCodingAgent({
      profiles,
      adapters: adapters as never,
      requirement: resolved("systems_change"),
      phase: "planning",
      purpose: "planning",
      availability
    });

    expect(selected).toMatchObject({
      bindingId: "codex-sol",
      capability: "c3_systems",
      effort: "e3_deep",
      profile: { name: "codex_planning" }
    });
  });

  it("honors an explicit provider-profile request without weakening requirements", () => {
    const selected = selectCompliantCodingAgent({
      profiles,
      adapters: adapters as never,
      requirement: resolved("systems_change"),
      purpose: "build",
      availability,
      requestedProfile: "claude_build"
    });

    expect(selected.bindingId).toBe("claude-opus");
    expect(selected.capability).toBe("c3_systems");
  });

  it("falls back to an equivalent provider when the lowest-cost provider is limited", () => {
    const limited: CodingAgentAvailabilitySnapshot = {
      ...availability,
      agents: availability.agents.map((agent) =>
        agent.profiles[0]?.startsWith("codex_")
          ? { ...agent, availability: "usage_limited" }
          : agent
      )
    };
    const selected = selectCompliantCodingAgent({
      profiles,
      adapters: adapters as never,
      requirement: resolved("routine_implementation"),
      purpose: "build",
      availability: limited
    });

    expect(selected.bindingId).toBe("claude-sonnet");
    expect(selected.capability).toBe("c2_integrated");
  });

  it("falls back to the opencode binding when Codex and Claude are both limited", () => {
    const limited: CodingAgentAvailabilitySnapshot = {
      ...availability,
      agents: availability.agents.map((agent) =>
        agent.profiles[0]?.startsWith("opencode_")
          ? agent
          : { ...agent, availability: "usage_limited" }
      )
    };
    const selected = selectCompliantCodingAgent({
      profiles,
      adapters: adapters as never,
      requirement: resolved("routine_implementation"),
      purpose: "build",
      availability: limited
    });

    expect(selected).toMatchObject({
      bindingId: "opencode-zen",
      provider: "opencode-cli",
      capability: "c2_integrated",
      effort: "e2_standard",
      profile: { name: "opencode_build" }
    });
    expect(selected.args).toEqual([
      "--model",
      "opencode-go/deepseek-v4.1-flash",
      "--variant",
      "low"
    ]);
  });

  it("reports an unsatisfied requirement instead of choosing a weaker model", () => {
    expect(() => selectCompliantCodingAgent({
      profiles,
      adapters: adapters as never,
      requirement: resolved("sensitive_change"),
      purpose: "build",
      availability
    })).toThrowError(ExecutionProfileUnsatisfiedError);

    try {
      selectCompliantCodingAgent({
        profiles,
        adapters: adapters as never,
        requirement: resolved("sensitive_change"),
        purpose: "build",
        availability
      });
    } catch (error) {
      expect(error).toMatchObject({
        code: "EXECUTION_PROFILE_UNSATISFIED",
        details: {
          capability: "c4_critical",
          effort: "e4_rigorous",
          dataLocality: "local_only"
        }
      });
    }
  });
});

describe("hard-evidence provider substitution (Decision 0063)", () => {
  it("pins the exact closed set of hard-evidence codes", () => {
    // A deliberate change to this list must change this assertion too — that
    // is what makes the enum closed rather than merely documented as closed.
    expect(HARD_PROVIDER_EVIDENCE_CODES).toEqual([
      "provider_unavailable",
      "model_unavailable",
      "authentication_failure",
      "quota_or_rate_limit_rejected",
      "launch_precluded"
    ] satisfies readonly HardProviderEvidenceCode[]);
  });

  for (const code of HARD_PROVIDER_EVIDENCE_CODES) {
    it(`substitutes to a different equivalent-or-stronger provider on ${code}`, () => {
      const evidence: HardProviderEvidence[] = [
        { providerId: "codex-cli", code, reason: `synthetic ${code} for codex-cli` }
      ];

      const selection = selectProviderWithHardEvidenceSubstitution({
        profiles,
        adapters: adapters as never,
        requirement: resolved("routine_implementation"),
        purpose: "build",
        availability,
        hardEvidence: evidence
      });

      expect(selection.configuration.provider).not.toBe("codex-cli");
      expect(selection.configuration.capability).toBe("c2_integrated");
      expect(selection.substitution).toMatchObject({
        intendedProvider: "codex-cli",
        code,
        reason: `synthetic ${code} for codex-cli`
      });
      expect(selection.substitution?.resumeGuidance).toContain("must not be replayed");
      expect(selection.excluded["codex-cli"]).toMatchObject({ code });
    });
  }

  it("reports no substitution when there is no hard evidence at all", () => {
    const selection = selectProviderWithHardEvidenceSubstitution({
      profiles,
      adapters: adapters as never,
      requirement: resolved("routine_implementation"),
      purpose: "build",
      availability
    });

    expect(selection.configuration.provider).toBe("codex-cli");
    expect(selection.substitution).toBeNull();
  });

  it("never treats an advisory capacity refusal alone as a substitution", () => {
    // capacityRefusals is the advisory-estimate channel (capacity.ts). Passing
    // it without hardEvidence must move the selection without ever recording
    // that move as a hard-evidence substitution.
    const selection = selectProviderWithHardEvidenceSubstitution({
      profiles,
      adapters: adapters as never,
      requirement: resolved("routine_implementation"),
      purpose: "build",
      availability,
      capacityRefusals: { "codex-cli": "advisory: reserve margin (not hard evidence)" }
    });

    expect(selection.configuration.provider).not.toBe("codex-cli");
    expect(selection.substitution).toBeNull();
  });

  it("surfaces incapacity normally rather than lowering a capability floor", () => {
    const evidence: HardProviderEvidence[] = [
      { providerId: "codex-cli", code: "provider_unavailable", reason: "synthetic: codex-cli down" },
      { providerId: "claude-code-cli", code: "provider_unavailable", reason: "synthetic: claude-code-cli down" },
      { providerId: "opencode-cli", code: "provider_unavailable", reason: "synthetic: opencode-cli down" }
    ];

    expect(() => selectProviderWithHardEvidenceSubstitution({
      profiles,
      adapters: adapters as never,
      requirement: resolved("routine_implementation"),
      purpose: "build",
      availability,
      hardEvidence: evidence
    })).toThrowError(ExecutionProfileUnsatisfiedError);
  });

  it("excludes a hard-evidence provider from ordinary selectCompliantCodingAgent candidates", () => {
    const selected = selectCompliantCodingAgent({
      profiles,
      adapters: adapters as never,
      requirement: resolved("routine_implementation"),
      purpose: "build",
      availability,
      hardEvidence: [{ providerId: "codex-cli", code: "authentication_failure", reason: "synthetic" }]
    });

    expect(selected.provider).not.toBe("codex-cli");
  });
});

describe("detectHardProviderEvidence", () => {
  const baseRegistry = adapters as unknown as ProviderAdapterRegistry;

  it("detects a provider disabled in the registry", () => {
    const evidence = detectHardProviderEvidence(baseRegistry);
    expect(evidence).toContainEqual(
      expect.objectContaining({ providerId: "gemini-cli", code: "provider_unavailable" })
    );
  });

  it("detects a provider with no supported Session launch adapter", () => {
    const registry: ProviderAdapterRegistry = {
      ...baseRegistry,
      providers: [...baseRegistry.providers, { id: "no-launch-adapter", enabled: true }],
      bindings: [
        ...baseRegistry.bindings,
        {
          id: "no-launch-adapter-binding",
          provider: "no-launch-adapter",
          agentProfiles: [],
          capability: "c2_integrated",
          model: "test",
          modelArgs: ["--model", "test"],
          effortArgs: { e2_standard: [] },
          tools: true,
          contextScopes: ["project"],
          locality: "local",
          costRank: 0,
          enabled: true
        }
      ]
    };

    const evidence = detectHardProviderEvidence(registry);
    expect(evidence).toContainEqual(
      expect.objectContaining({ providerId: "no-launch-adapter", code: "launch_precluded" })
    );
  });

  it("detects every binding disabled for an otherwise-enabled provider", () => {
    const registry: ProviderAdapterRegistry = {
      ...baseRegistry,
      bindings: baseRegistry.bindings.map((binding) =>
        binding.provider === "codex-cli" ? { ...binding, enabled: false } : binding)
    };

    const evidence = detectHardProviderEvidence(registry);
    expect(evidence).toContainEqual(
      expect.objectContaining({ providerId: "codex-cli", code: "model_unavailable" })
    );
  });

  it("reports no evidence for a fully healthy registry", () => {
    const registry: ProviderAdapterRegistry = {
      ...baseRegistry,
      providers: baseRegistry.providers.filter((provider) => provider.id !== "gemini-cli")
    };

    expect(detectHardProviderEvidence(registry)).toEqual([]);
  });
});

function resolved(profileName: string) {
  const result = parseExecutionRequirement({
    schema: "arcadia.execution/v1",
    profile: profileName
  }, "codex");
  if (!result.resolved) throw new Error(JSON.stringify(result.issues));
  return result.resolved;
}

function profile(
  name: string,
  provider: string,
  purpose: "planning" | "build",
  sandbox: CodingAgentProfile["sandbox"]
): CodingAgentProfile {
  return {
    name,
    provider,
    package: "test",
    command: provider === "codex-cli" ? "codex" : provider === "opencode-cli" ? "opencode" : "claude",
    purpose,
    sandbox,
    args: []
  };
}
