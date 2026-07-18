import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
