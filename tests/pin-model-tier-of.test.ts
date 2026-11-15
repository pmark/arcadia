import { describe, expect, it } from "vitest";
import { tierOfModel, type ModelTierRegistry } from "../src/codingAgents/modelTiers.js";

const registry: ModelTierRegistry = {
  version: 1,
  sessionStartTier: "light",
  tiers: {
    light: { codex: null, claude: { model: "model-light", effort: null }, opencode: null },
    standard: { codex: null, claude: { model: "model-standard", effort: null }, opencode: null },
    heavy: { codex: null, claude: { model: "model-heavy", effort: null }, opencode: null }
  }
};

describe("tierOfModel", () => {
  it("maps a model back to the tier whose binding for the agent names it", () => {
    expect(tierOfModel("claude", "model-standard", registry)).toBe("standard");
  });

  it("returns null for a model no tier binds for the agent", () => {
    expect(tierOfModel("claude", "model-unknown", registry)).toBeNull();
  });

  it("returns null when the model is bound only for another agent", () => {
    expect(tierOfModel("codex", "model-light", registry)).toBeNull();
  });
});
