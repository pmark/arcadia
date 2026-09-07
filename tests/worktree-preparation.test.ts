import { describe, expect, it } from "vitest";
import { buildAgentLaunchCommand } from "../src/sessions/worktreePreparation.js";

describe("prepared Codex worktree launch", () => {
  it("selects the restricted unattended profile for governed work", () => {
    const command = buildAgentLaunchCommand("codex", "/tmp/candidate", "gpt-test", "high");
    expect(command).toContain('-c default_permissions="arcadia-unattended"');
    expect(command).toContain("--ask-for-approval never");
  });
});
