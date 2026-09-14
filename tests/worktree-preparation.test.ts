import { describe, expect, it } from "vitest";
import { buildAgentLaunchCommand, isPlausibleClaudeModel } from "../src/sessions/worktreePreparation.js";

describe("prepared Codex worktree launch", () => {
  it("selects the restricted unattended profile for governed work", () => {
    const command = buildAgentLaunchCommand("codex", "/tmp/candidate", "gpt-test", "high");
    expect(command).toContain('-c default_permissions="arcadia-unattended"');
    expect(command).toContain("--ask-for-approval never");
  });
});

describe("isPlausibleClaudeModel", () => {
  it("accepts a claude-prefixed model", () => {
    expect(isPlausibleClaudeModel("claude-sonnet-5")).toBe(true);
  });

  it("accepts the short Claude Code aliases, case-insensitively", () => {
    expect(isPlausibleClaudeModel("opus")).toBe(true);
    expect(isPlausibleClaudeModel("Sonnet")).toBe(true);
    expect(isPlausibleClaudeModel("HAIKU")).toBe(true);
    expect(isPlausibleClaudeModel(" fable ")).toBe(true);
  });

  it("rejects a model built for a different agent", () => {
    expect(isPlausibleClaudeModel("gpt-5.6-terra")).toBe(false);
    expect(isPlausibleClaudeModel("gpt-6-astra")).toBe(false);
  });

  it("rejects an empty or unrecognized value", () => {
    expect(isPlausibleClaudeModel("")).toBe(false);
    expect(isPlausibleClaudeModel("not-a-model")).toBe(false);
  });
});
