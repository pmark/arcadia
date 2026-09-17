import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { ArcadiaError } from "../src/cli/errors.js";
import {
  AGENT_GIT_EMAIL_DOMAIN,
  agentIdentityEmail,
  agentIdentityEnvironment,
  agentIdentityEnvironmentArgs,
  agentIdentityName,
  resolveAgentIdentity,
  resolveSessionAgentIdentity,
  tierForAgentModel,
  tierForReasoningEffort
} from "../src/codingAgents/agentIdentity.js";
import { BUNDLED_MODEL_TIERS, MODEL_TIERS, mergeModelTiers } from "../src/codingAgents/modelTiers.js";

describe("agent Git identity table", () => {
  const expected: Record<string, Record<string, [string, string]>> = {
    codex: {
      light: ["Cody Swift", "cody.swift@agents.arcadia.local"],
      standard: ["Cody Mason", "cody.mason@agents.arcadia.local"],
      heavy: ["Cody Atlas", "cody.atlas@agents.arcadia.local"]
    },
    claude: {
      light: ["Claudia Swift", "claudia.swift@agents.arcadia.local"],
      standard: ["Claudia Mason", "claudia.mason@agents.arcadia.local"],
      heavy: ["Claudia Atlas", "claudia.atlas@agents.arcadia.local"]
    },
    opencode: {
      light: ["Owen Swift", "owen.swift@agents.arcadia.local"],
      standard: ["Owen Mason", "owen.mason@agents.arcadia.local"],
      heavy: ["Owen Atlas", "owen.atlas@agents.arcadia.local"]
    }
  };

  it("resolves every platform and tier to its canonical name and email", () => {
    for (const agent of ["codex", "claude", "opencode"] as const) {
      for (const tier of MODEL_TIERS) {
        expect(resolveAgentIdentity(agent, tier)).toEqual({
          agent,
          tier,
          name: expected[agent][tier][0],
          email: expected[agent][tier][1]
        });
      }
    }
  });

  it("derives the email from the name on the agents.arcadia.local domain", () => {
    expect(agentIdentityEmail("Owen Mason")).toBe(`owen.mason@${AGENT_GIT_EMAIL_DOMAIN}`);
    expect(agentIdentityName("codex", "heavy")).toBe("Cody Atlas");
  });

  it("refuses an unsupported platform or tier instead of returning a fallback", () => {
    expect(() => resolveAgentIdentity("gemini", "standard")).toThrow(ArcadiaError);
    expect(() => resolveAgentIdentity("codex", "gigantic")).toThrow(ArcadiaError);
    expect(() => resolveAgentIdentity("", "")).toThrow(ArcadiaError);
  });

  it("sets both author and committer environment variables", () => {
    const identity = resolveAgentIdentity("opencode", "light");
    expect(agentIdentityEnvironment(identity)).toEqual({
      GIT_AUTHOR_NAME: "Owen Swift",
      GIT_AUTHOR_EMAIL: "owen.swift@agents.arcadia.local",
      GIT_COMMITTER_NAME: "Owen Swift",
      GIT_COMMITTER_EMAIL: "owen.swift@agents.arcadia.local"
    });
    expect(agentIdentityEnvironmentArgs(identity)).toEqual([
      "GIT_AUTHOR_NAME=Owen Swift",
      "GIT_AUTHOR_EMAIL=owen.swift@agents.arcadia.local",
      "GIT_COMMITTER_NAME=Owen Swift",
      "GIT_COMMITTER_EMAIL=owen.swift@agents.arcadia.local"
    ]);
  });

  it("delivers each assignment to a child process intact, space and all", () => {
    // The launch path prefixes the provider command with these exact entries
    // through `env`. Executing `env` here with the same array proves the name's
    // space is one argv element, not two, so a launched agent really does
    // commit as "Owen Mason" rather than "Owen".
    const identity = resolveAgentIdentity("opencode", "standard");
    const env = (key: string) =>
      execFileSync("env", [...agentIdentityEnvironmentArgs(identity), "printenv", key], { encoding: "utf8" }).trim();
    expect(env("GIT_AUTHOR_NAME")).toBe("Owen Mason");
    expect(env("GIT_COMMITTER_NAME")).toBe("Owen Mason");
    expect(env("GIT_AUTHOR_EMAIL")).toBe("owen.mason@agents.arcadia.local");
    expect(env("GIT_COMMITTER_EMAIL")).toBe("owen.mason@agents.arcadia.local");
  });
});

describe("tier resolution", () => {
  it("reverse-maps each agent's bound models to their tier", () => {
    expect(tierForAgentModel("codex", "gpt-5.6-luna")).toBe("light");
    expect(tierForAgentModel("codex", "gpt-5.6-terra")).toBe("standard");
    expect(tierForAgentModel("codex", "gpt-5.6-sol")).toBe("heavy");
    expect(tierForAgentModel("claude", "haiku")).toBe("light");
    expect(tierForAgentModel("claude", "sonnet")).toBe("standard");
    expect(tierForAgentModel("claude", "opus")).toBe("heavy");
    expect(tierForAgentModel("opencode", "opencode-go/glm-5.3-flash")).toBe("light");
    expect(tierForAgentModel("opencode", "opencode-go/deepseek-v4.1-flash")).toBe("standard");
    expect(tierForAgentModel("opencode", "opencode-go/gpt-5.6-luna")).toBe("heavy");
  });

  it("returns null for a model bound to no tier and refuses an ambiguous one", () => {
    expect(tierForAgentModel("claude", "claude-sonnet-5")).toBeNull();

    const ambiguous = mergeModelTiers(BUNDLED_MODEL_TIERS, {
      tiers: { heavy: { claude: { model: "sonnet", effort: "e3_deep" } } }
    });
    expect(() => tierForAgentModel("claude", "sonnet", ambiguous)).toThrow(/ambiguous/i);
  });

  it("reads a provider-native effort back to a tier", () => {
    expect(tierForReasoningEffort("e1_brief")).toBe("light");
    expect(tierForReasoningEffort("medium")).toBe("standard");
    expect(tierForReasoningEffort("high")).toBe("heavy");
    expect(tierForReasoningEffort(null)).toBeNull();
    expect(tierForReasoningEffort("e9_unknown")).toBeNull();
  });
});

describe("session identity resolution", () => {
  it("prefers the model's tier over the effort", () => {
    expect(resolveSessionAgentIdentity({ agent: "claude", model: "sonnet", effort: "e3_deep" })).toMatchObject({
      tier: "standard",
      name: "Claudia Mason"
    });
  });

  it("falls back to the reasoning effort for an unbound model", () => {
    expect(resolveSessionAgentIdentity({ agent: "codex", model: "gpt-6-astra", effort: "e1_brief" })).toMatchObject({
      tier: "light",
      name: "Cody Swift"
    });
  });

  it("refuses a model and effort that resolve to no tier", () => {
    expect(() => resolveSessionAgentIdentity({ agent: "opencode", model: "mystery-model", effort: "e9_unknown" })).toThrow(
      /cannot determine the model tier/i
    );
    expect(() => resolveSessionAgentIdentity({ agent: "opencode", model: "mystery-model" })).toThrow(ArcadiaError);
  });
});
