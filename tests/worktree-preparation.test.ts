import { describe, expect, it } from "vitest";
import { buildAgentLaunchCommand } from "../src/sessions/worktreePreparation.js";

describe("prepared Codex worktree launch", () => {
  it("selects the restricted unattended profile for governed work", () => {
    expect(buildAgentLaunchCommand("codex", "/tmp/candidate", "gpt-test", "high")).toContain("codex --profile arcadia-unattended");
  });
});
