import { describe, expect, it } from "vitest";
import { claudeReasoningEffort, codexReasoningEffort } from "../src/codingAgents/reasoningEffort.js";

describe("reasoning effort mapping", () => {
  const mappings: Array<[string, string]> = [
    ["e1_brief", "low"],
    ["e2_standard", "medium"],
    ["e3_deep", "high"],
    ["e4_rigorous", "xhigh"]
  ];

  it.each(mappings)("maps stored key %s to native %s for Claude and Codex", (key, native) => {
    expect(claudeReasoningEffort(key)).toBe(native);
    expect(codexReasoningEffort(key)).toBe(native);
  });

  it("passes unknown keys through unchanged", () => {
    expect(claudeReasoningEffort("custom")).toBe("custom");
    expect(codexReasoningEffort("custom")).toBe("custom");
  });

  it("returns the empty string unchanged", () => {
    expect(claudeReasoningEffort("")).toBe("");
  });
});
