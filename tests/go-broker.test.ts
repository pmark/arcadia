import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ArcadiaError } from "../src/cli/errors.js";
import { permissionSnippets } from "../src/commands/goBrokerInstall.js";
import { parseGoBrokerArguments, runGoBroker } from "../src/goBroker.js";

describe("protected Arcadia go broker", () => {
  it("derives the source from cwd and accepts only its fixed launcher agent", () => {
    expect(parseGoBrokerArguments(["codex"], "./finished")).toEqual({
      source: path.resolve("./finished"),
      agent: "codex"
    });
    expect(parseGoBrokerArguments(["claude"], "/tmp/finished").agent).toBe("claude");
  });

  it.each([
    { argv: [] },
    { argv: ["codex", "--launch"] },
    { argv: ["claude", "anything"] }
  ])("rejects any arity that could carry extra authority: $argv", ({ argv }) => {
    expectValidation(() => parseGoBrokerArguments(argv), "accepts no public arguments");
  });

  it("rejects an invalid fixed launcher agent", () => {
    expectValidation(() => parseGoBrokerArguments(["other"]), "invalid fixed agent");
  });

  it("previews and then applies the same fixed options without launch authority", () => {
    const response = {
      ok: true as const,
      command: "go",
      data: { applied: true },
      artifacts: [],
      warnings: []
    };
    const runner = vi.fn().mockReturnValue(response);

    const result = runGoBroker({ source: "/tmp/finished", agent: "codex" }, runner as never);

    expect(runner).toHaveBeenNthCalledWith(1, {
      repo: "/tmp/finished",
      source: "/tmp/finished",
      agent: "codex"
    });
    expect(runner).toHaveBeenNthCalledWith(2, {
      repo: "/tmp/finished",
      source: "/tmp/finished",
      agent: "codex",
      apply: true
    });
    expect(runner.mock.calls.flatMap(([options]) => Object.keys(options))).not.toContain("launch");
    expect(result.command).toBe("go-broker");
  });

  it("stops after a refused preview", () => {
    const runner = vi.fn(() => {
      throw new ArcadiaError("VALIDATION_ERROR", "unsafe source", 2);
    });

    expect(() => runGoBroker({ source: "/tmp/finished", agent: "claude" }, runner as never)).toThrow("unsafe source");
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("generates rules for only the protected executable", () => {
    const executables = {
      codex: "/Users/operator/.local/bin/arcadia-go-broker-codex",
      claude: "/Users/operator/.local/bin/arcadia-go-broker-claude"
    };
    expect(permissionSnippets(executables)).toEqual({
      codexRules: [
        'prefix_rule(pattern=["/Users/operator/.local/bin/arcadia-go-broker-codex"], decision="allow")'
      ],
      claudePermissions: [
        "Bash(/Users/operator/.local/bin/arcadia-go-broker-claude)"
      ]
    });
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
