import { describe, expect, it } from "vitest";
import type { CodingAgentAvailabilitySnapshot } from "../src/codingAgents/availability.js";
import {
  ExecutionProfileUnsatisfiedError,
  selectCompliantCodingAgent,
  validateProviderAdapterRegistry
} from "../src/codingAgents/providerAdapters.js";
import { parseExecutionRequirement } from "../src/execution/profiles.js";
import type { CodingAgentProfile } from "../src/intent/registries.js";
import adapters from "../config/defaults/provider-adapters.json";

const profiles: CodingAgentProfile[] = [
  profile("codex_planning", "codex-cli", "planning", "read-only"),
  profile("codex_build", "codex-cli", "build", "workspace-write"),
  profile("claude_planning", "claude-code-cli", "planning", "read-only"),
  profile("claude_build", "claude-code-cli", "build", "workspace-write")
];

const availability: CodingAgentAvailabilitySnapshot = {
  generatedAt: "2026-07-25T00:00:00.000Z",
  agents: profiles.map((profile) => ({
    provider: profile.provider,
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
    command: provider === "codex-cli" ? "codex" : "claude",
    purpose,
    sandbox,
    args: []
  };
}
