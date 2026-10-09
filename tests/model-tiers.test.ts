import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArcadiaError } from "../src/cli/errors.js";
import {
  BUNDLED_MODEL_TIERS,
  MODEL_TIERS,
  TIER_AGENTS,
  isModelTier,
  isPlausibleAgentModel,
  loadModelTierRegistry,
  mergeModelTiers,
  describeSessionStart,
  resolveEscalationTarget,
  resolveHandoffModel,
  resolveSessionStart,
  type ModelTierRegistry
} from "../src/codingAgents/modelTiers.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const EXPECTED: Record<string, string> = {
  "light:codex": "gpt-6-luna",
  "light:claude": "haiku",
  "light:opencode": "opencode-go/glm-5.3-flash",
  "standard:codex": "gpt-5.6-terra",
  "standard:claude": "sonnet",
  "standard:opencode": "opencode-go/deepseek-v4.1-flash",
  "heavy:codex": "gpt-6.1-sol",
  "heavy:claude": "opus",
  "heavy:opencode": "opencode-go/gpt-5.6-luna"
};

describe("model tier resolution", () => {
  it("resolves every tier for every agent from the bundled registry", () => {
    for (const tier of MODEL_TIERS) {
      for (const agent of TIER_AGENTS) {
        const resolved = resolveHandoffModel({ agent, recommendedModel: tier });
        expect(resolved.model).toBe(EXPECTED[`${tier}:${agent}`]);
        expect(resolved).toMatchObject({ tier, source: "tier" });
      }
    }
  });

  it("uses a concrete model as-is when the agent plausibly owns it", () => {
    expect(resolveHandoffModel({ agent: "claude", recommendedModel: "claude-sonnet-5" }).model).toBe("claude-sonnet-5");
    expect(resolveHandoffModel({ agent: "claude", recommendedModel: "opus" }).source).toBe("concrete");
    expect(resolveHandoffModel({ agent: "codex", recommendedModel: "gpt-5.6-sol" }).model).toBe("gpt-5.6-sol");
    expect(resolveHandoffModel({ agent: "opencode", recommendedModel: "opencode-go/qwen3.8-flash" }).source).toBe("concrete");
  });

  it("falls back to the standard tier, with a visible note, when the model belongs to another agent", () => {
    const claudePlan = resolveHandoffModel({ agent: "opencode", recommendedModel: "claude-sonnet-5" });
    expect(claudePlan).toMatchObject({ model: "opencode-go/deepseek-v4.1-flash", tier: "standard", source: "fallback" });
    expect(claudePlan.note).toContain("claude-sonnet-5");
    expect(claudePlan.note).toContain("opencode");

    const codexPlan = resolveHandoffModel({ agent: "claude", recommendedModel: "gpt-5.6-terra" });
    expect(codexPlan).toMatchObject({ model: "sonnet", tier: "standard", source: "fallback" });
    expect(codexPlan.note).toContain("gpt-5.6-terra");
  });

  it("refuses a recommended_model that is neither a known tier nor recognizable for any agent", () => {
    expectValidation(
      () => resolveHandoffModel({ agent: "claude", recommendedModel: "medium" }),
      "neither a known tier nor a model recognized"
    );
    expectValidation(
      () => resolveHandoffModel({ agent: "opencode", recommendedModel: "not a model" }),
      "neither a known tier nor a model recognized"
    );
  });

  it("refuses legibly when the registry has no binding for the agent", () => {
    const empty: ModelTierRegistry = {
      version: 1,
      sessionStartTier: "light",
      tiers: {
        light: { codex: null, claude: null, opencode: null },
        standard: { codex: null, claude: null, opencode: null },
        heavy: { codex: null, claude: null, opencode: null }
      }
    };
    expectValidation(
      () => resolveHandoffModel({ agent: "opencode", recommendedModel: "heavy", registry: empty }),
      "No heavy tier model is registered for opencode"
    );
  });

  it("trusts an explicit model untouched and never re-resolves it", () => {
    const resolved = resolveHandoffModel({
      agent: "opencode",
      recommendedModel: "heavy",
      explicitModel: "gpt-5.6-terra"
    });
    expect(resolved).toMatchObject({ model: "gpt-5.6-terra", tier: null, source: "explicit", note: null });
  });

  it("resolves effort independently: explicit, then plan, then the tier default", () => {
    expect(resolveHandoffModel({ agent: "claude", recommendedModel: "heavy" }).effort).toBe("e3_deep");
    expect(resolveHandoffModel({ agent: "claude", recommendedModel: "heavy", planEffort: "high" }).effort).toBe("high");
    expect(
      resolveHandoffModel({ agent: "claude", recommendedModel: "heavy", planEffort: "high", explicitEffort: "low" }).effort
    ).toBe("low");
    // A concrete model carries no tier default, so effort stays absent.
    expect(resolveHandoffModel({ agent: "claude", recommendedModel: "opus" }).effort).toBeNull();
  });

  it("classifies provider shapes and tier names", () => {
    expect(MODEL_TIERS.every((tier) => isModelTier(tier))).toBe(true);
    expect(isModelTier("medium")).toBe(false);
    expect(isPlausibleAgentModel("gpt-5.6-terra", "codex")).toBe(true);
    expect(isPlausibleAgentModel("claude-sonnet-5", "codex")).toBe(false);
    expect(isPlausibleAgentModel("opencode-go/deepseek-v4.1-flash", "opencode")).toBe(true);
    expect(isPlausibleAgentModel("deepseek-v4.1-flash", "opencode")).toBe(false);
  });
});

describe("session start tier (smallest model first)", () => {
  const START: Record<string, string> = { codex: "gpt-6-luna", claude: "haiku", opencode: "opencode-go/glm-5.3-flash" };

  it("starts every agent on its light model whatever the plan tier, naming the plan tier as escalation", () => {
    for (const agent of TIER_AGENTS) {
      for (const tier of ["standard", "heavy"] as const) {
        const resolved = resolveSessionStart({ agent, recommendedModel: tier });
        expect(resolved).toMatchObject({ model: START[agent], tier: "light", source: "tier", effort: "e1_brief" });
        expect(resolved.escalation).toEqual({ model: EXPECTED[`${tier}:${agent}`], effort: tier === "heavy" ? "e3_deep" : "e2_standard", tier });
      }
      const light = resolveSessionStart({ agent, recommendedModel: "light" });
      expect(light.model).toBe(START[agent]);
      expect(light.escalation).toBeNull();
    }
  });

  it("lets an explicit --model win and never re-resolves it", () => {
    const resolved = resolveSessionStart({ agent: "claude", recommendedModel: "heavy", explicitModel: "opus", explicitEffort: "high" });
    expect(resolved).toMatchObject({ model: "opus", source: "explicit", effort: "high", escalation: null });
  });

  it("keeps resolving a concrete plan model as the escalation target", () => {
    expect(resolveSessionStart({ agent: "codex", recommendedModel: "gpt-5.6-terra" })).toMatchObject({
      model: "gpt-6-luna",
      escalation: { model: "gpt-5.6-terra", tier: null }
    });
  });

  it("still refuses an unpinned or unrecognizable plan model", () => {
    expectValidation(() => resolveSessionStart({ agent: "claude", recommendedModel: null }), "will not launch one unpinned");
    expectValidation(() => resolveSessionStart({ agent: "claude", recommendedModel: "medium" }), "neither a known tier");
  });

  it("is a checked-in setting a workspace can change through config/coding-agent-models.json", () => {
    expect(BUNDLED_MODEL_TIERS.sessionStartTier).toBe("light");
    const standardStart = mergeModelTiers(BUNDLED_MODEL_TIERS, { sessionStartTier: "standard" });
    expect(resolveSessionStart({ agent: "claude", recommendedModel: "heavy", registry: standardStart })).toMatchObject({
      model: "sonnet",
      escalation: { model: "opus" }
    });
    const planStart = mergeModelTiers(BUNDLED_MODEL_TIERS, { sessionStartTier: "plan" });
    expect(resolveSessionStart({ agent: "claude", recommendedModel: "heavy", registry: planStart })).toMatchObject({
      model: "opus",
      escalation: null
    });
    expectValidation(() => mergeModelTiers(BUNDLED_MODEL_TIERS, { sessionStartTier: "tiny" }), "sessionStartTier");

    const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-model-tiers-"));
    roots.push(workspace);
    mkdirSync(path.join(workspace, "config"), { recursive: true });
    writeFileSync(path.join(workspace, "config", "coding-agent-models.json"), JSON.stringify({ sessionStartTier: "plan" }));
    expect(loadModelTierRegistry(workspace).sessionStartTier).toBe("plan");
  });

  it("omits escalation when the workspace starts at or above the plan's tier", () => {
    const heavyStart = mergeModelTiers(BUNDLED_MODEL_TIERS, { sessionStartTier: "heavy" });
    expect(resolveSessionStart({ agent: "claude", recommendedModel: "standard", registry: heavyStart })).toMatchObject({
      model: "opus",
      escalation: null
    });
    expect(
      resolveEscalationTarget({ agent: "claude", recommendedModel: "light", currentModel: "sonnet" })
    ).toBeNull();
  });

  it("describes the start model for a packet-bound selection", () => {
    expect(describeSessionStart("claude", "sonnet")).toBe(
      "The Session will start on haiku (light tier, effort e1_brief); sonnet is its escalation target."
    );
    expect(describeSessionStart("claude", "haiku")).toBeNull();
    expect(describeSessionStart("claude", "sonnet", mergeModelTiers(BUNDLED_MODEL_TIERS, { sessionStartTier: "plan" }))).toBeNull();
  });

  it("names no escalation target when the Session already runs the plan's model", () => {
    expect(resolveEscalationTarget({ agent: "claude", recommendedModel: "standard", currentModel: "sonnet" })).toBeNull();
    expect(resolveEscalationTarget({ agent: "claude", recommendedModel: "standard", currentModel: "haiku" })).toMatchObject({ model: "sonnet" });
  });
});

describe("model tier registry loading", () => {
  it("returns the bundled defaults without a workspace", () => {
    expect(loadModelTierRegistry(null)).toBe(BUNDLED_MODEL_TIERS);
    expect(loadModelTierRegistry(undefined)).toBe(BUNDLED_MODEL_TIERS);
  });

  it("merges a workspace override without dropping the rest of the table", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-model-tiers-"));
    roots.push(workspace);
    mkdirSync(path.join(workspace, "config"), { recursive: true });
    writeFileSync(
      path.join(workspace, "config", "coding-agent-models.json"),
      JSON.stringify({ tiers: { heavy: { opencode: { model: "opencode-go/custom-heavy", effort: "e4_rigorous" } } } })
    );

    const registry = loadModelTierRegistry(workspace);

    expect(registry.tiers.heavy.opencode).toEqual({ model: "opencode-go/custom-heavy", effort: "e4_rigorous" });
    expect(registry.tiers.heavy.codex).toEqual(BUNDLED_MODEL_TIERS.tiers.heavy.codex);
    expect(registry.tiers.light.opencode).toEqual(BUNDLED_MODEL_TIERS.tiers.light.opencode);
  });

  it("refuses a malformed override rather than silently ignoring it", () => {
    expectValidation(() => mergeModelTiers(BUNDLED_MODEL_TIERS, { tiers: { huge: {} } }), "unknown tier");
    expectValidation(
      () => mergeModelTiers(BUNDLED_MODEL_TIERS, { tiers: { heavy: { gemini: "x" } } }),
      "unknown agent"
    );
    expectValidation(
      () => mergeModelTiers(BUNDLED_MODEL_TIERS, { tiers: { heavy: { opencode: { model: "x", effort: "sometimes" } } } }),
      "known reasoning effort"
    );
    expectValidation(
      () => mergeModelTiers(BUNDLED_MODEL_TIERS, { tiers: { heavy: { opencode: { effort: "e1_brief" } } } }),
      "nonblank model"
    );
  });
});

function expectValidation(fn: () => unknown, message: string): void {
  try {
    fn();
    throw new Error("Expected validation error");
  } catch (error) {
    expect(error).toBeInstanceOf(ArcadiaError);
    expect((error as Error).message).toContain(message);
  }
}
