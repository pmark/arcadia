import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildCodingAgentCommand,
  finalMessageFromExecution,
  isUninvokedFinalMessage
} from "../src/codingAgents/adapters.js";
import type { CodingAgentProfile } from "../src/intent/registries.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("coding-agent CLI adapters", () => {
  it("adds Codex-specific workspace and final-message arguments only for Codex", () => {
    const root = createRoot();
    const finalPath = path.join(root, "final.md");
    const codex = buildCodingAgentCommand(profile({ provider: "codex-cli", command: "codex" }), root, finalPath);
    const claude = buildCodingAgentCommand(profile({ provider: "claude-code-cli", command: "claude" }), root, finalPath);

    expect(codex.args).toEqual(expect.arrayContaining(["--cd", root, "--output-last-message", finalPath, "-"]));
    expect(claude.args).toEqual(["--print", "--output-format", "json"]);
    expect(claude.displayCommand).toBe("claude --print --output-format json");
  });

  it("applies provider-adapter model and effort arguments to the exact invocation", () => {
    const root = createRoot();
    const finalPath = path.join(root, "final.md");
    const command = buildCodingAgentCommand(
      profile({ provider: "codex-cli", command: "codex" }),
      root,
      finalPath,
      ["--model", "configured-model", "--config", "model_reasoning_effort=\"high\""]
    );

    expect(command.args).toEqual(expect.arrayContaining([
      "--model",
      "configured-model",
      "--config",
      "model_reasoning_effort=\"high\""
    ]));
  });

  it("extracts Claude's final result while retaining raw JSON for the execution log", () => {
    const root = createRoot();
    const finalPath = path.join(root, "final.md");
    writeFileSync(finalPath, "Claude Code has not been invoked yet.\n", "utf8");

    expect(isUninvokedFinalMessage(finalPath)).toBe(true);
    expect(finalMessageFromExecution({
      profile: profile({ provider: "claude-code-cli", command: "claude" }),
      finalMessagePath: finalPath,
      stdout: JSON.stringify({ type: "result", subtype: "success", result: "Finished the bounded plan." }),
      stderr: ""
    })).toBe("Finished the bounded plan.\n");
  });

  describe("Claude plan-mode plan files", () => {
    function claudeResult(root: string, plansDir: string, result: string): string {
      const finalPath = path.join(root, "final.md");
      writeFileSync(finalPath, "Claude Code has not been invoked yet.\n", "utf8");
      return finalMessageFromExecution({
        profile: profile({ provider: "claude-code-cli", command: "claude" }),
        finalMessagePath: finalPath,
        stdout: JSON.stringify({ type: "result", subtype: "success", result }),
        stderr: "",
        claudePlansDir: plansDir
      });
    }

    it("appends the plan file the summary names so validation sees the real plan", () => {
      const root = createRoot();
      const plans = path.join(root, "plans");
      mkdirSync(plans);
      const planFile = path.join(plans, "quiet-otter.md");
      writeFileSync(planFile, "## Ordered Phases\n1. Do it.\n", "utf8");

      const message = claudeResult(root, plans, `The plan is written to \`${planFile}\`. Summary: fix it.`);

      expect(message).toContain("Summary: fix it.");
      expect(message).toContain("## Ordered Phases");
    });

    it("leaves the message alone when no plan file is named", () => {
      const root = createRoot();
      const plans = path.join(root, "plans");
      mkdirSync(plans);

      expect(claudeResult(root, plans, "Just a summary.")).toBe("Just a summary.\n");
    });

    it("never reads a file outside the plans directory, even via a symlink", () => {
      const root = createRoot();
      const plans = path.join(root, "plans");
      mkdirSync(plans);
      const secret = path.join(root, "secret.md");
      writeFileSync(secret, "TOP SECRET", "utf8");
      const link = path.join(plans, "link.md");
      symlinkSync(secret, link);

      expect(claudeResult(root, plans, `See ${secret} and ${link}`)).not.toContain("TOP SECRET");
    });
  });
});

function createRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-coding-agent-test-"));
  roots.push(root);
  mkdirSync(root, { recursive: true });
  return root;
}

function profile(overrides: Pick<CodingAgentProfile, "provider" | "command">): CodingAgentProfile {
  return {
    name: `${overrides.provider}_planning`,
    provider: overrides.provider,
    package: "test",
    command: overrides.command,
    purpose: "planning",
    sandbox: "read-only",
    args: ["--print", "--output-format", "json"]
  };
}
