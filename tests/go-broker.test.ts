import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ArcadiaError } from "../src/cli/errors.js";
import { permissionSnippets, stageGoBrokerDatabaseSchema, stageGoBrokerDependencies } from "../src/commands/goBrokerInstall.js";
import { assertGoBrokerHostController, parseGoBrokerArguments, runGoBroker } from "../src/goBroker.js";

describe("protected Arcadia go broker", () => {
  it("derives the source from cwd and accepts only fixed launcher inputs", () => {
    expect(parseGoBrokerArguments(["codex", "go"], "./finished")).toEqual({
      source: path.resolve("./finished"),
      agent: "codex",
      operation: "go"
    });
    expect(parseGoBrokerArguments(["claude", "advance"], "/tmp/finished").agent).toBe("claude");
  });

  it.each([
    { argv: [] },
    { argv: ["codex", "go", "--launch"] },
    { argv: ["claude"] }
  ])("rejects any arity that could carry extra authority: $argv", ({ argv }) => {
    expectValidation(() => parseGoBrokerArguments(argv), "accepts no public arguments");
  });

  it("rejects an invalid fixed launcher agent", () => {
    expectValidation(() => parseGoBrokerArguments(["other", "go"]), "invalid fixed agent");
  });

  it("refuses Git-mutating reconciliation before entering a Codex sandbox", () => {
    expectValidation(
      () => assertGoBrokerHostController(
        { source: "/tmp/finished", agent: "codex", operation: "go" },
        { CODEX_SANDBOX: "seatbelt" }
      ),
      "host controller"
    );
    expect(() => assertGoBrokerHostController(
      { source: "/tmp/prepared", agent: "codex", operation: "advance" },
      { CODEX_SANDBOX: "seatbelt" }
    )).not.toThrow();
  });

  it("accepts preserve as a fixed launcher operation", () => {
    expect(parseGoBrokerArguments(["codex", "preserve"], "/tmp/finished").operation).toBe("preserve");
  });

  it("refuses candidate preservation inside a Codex sandbox", () => {
    expectValidation(
      () => assertGoBrokerHostController(
        { source: "/tmp/finished", agent: "codex", operation: "preserve" },
        { CODEX_SANDBOX: "seatbelt" }
      ),
      "host controller"
    );
  });

  it("runs preserve with the launcher's source and resolved workspace", () => {
    const response = { ok: true as const, command: "preserve", data: { receipt: {} }, artifacts: [], warnings: [] };
    const preserveRunner = vi.fn().mockReturnValue(response);

    const result = runGoBroker(
      { source: "/tmp/finished", agent: "codex", operation: "preserve" },
      vi.fn() as never,
      vi.fn() as never,
      vi.fn() as never,
      () => "/tmp/arcadia-workspace",
      preserveRunner as never
    );

    expect(preserveRunner).toHaveBeenCalledWith({ workspace: "/tmp/arcadia-workspace", source: "/tmp/finished" });
    expect(result.command).toBe("preserve-broker");
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

    const result = runGoBroker({ source: "/tmp/finished", agent: "codex", operation: "go" }, runner as never);

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

    expect(() => runGoBroker({ source: "/tmp/finished", agent: "claude", operation: "go" }, runner as never)).toThrow("unsafe source");
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("runs advance only with the launcher's source repository and resolved workspace", () => {
    const response = { ok: true as const, command: "advance", data: { transition: null, session: null }, artifacts: [], warnings: [] };
    const advanceRunner = vi.fn().mockReturnValue(response);

    const result = runGoBroker(
      { source: "/tmp/prepared", agent: "codex", operation: "advance" },
      vi.fn() as never,
      advanceRunner as never,
      vi.fn() as never,
      () => "/tmp/arcadia-workspace"
    );

    expect(advanceRunner).toHaveBeenCalledWith({ workspace: "/tmp/arcadia-workspace", repo: "/tmp/prepared" });
    expect(result.command).toBe("advance-broker");
  });

  it("runs work monitor locally without pull-request network access", () => {
    const response = { ok: true as const, command: "work.monitor", data: { snapshot: {}, attentionLines: [] }, artifacts: [], warnings: [] };
    const workMonitorRunner = vi.fn().mockReturnValue(response);

    const result = runGoBroker(
      { source: "/tmp/prepared", agent: "claude", operation: "work-monitor" },
      vi.fn() as never,
      vi.fn() as never,
      workMonitorRunner as never,
      () => "/tmp/arcadia-workspace"
    );

    expect(workMonitorRunner).toHaveBeenCalledWith({ workspace: "/tmp/arcadia-workspace", includePullRequests: false });
    expect(result.command).toBe("work-monitor-broker");
  });

  it("allows agents to call only the read-only prepared-worktree brokers", () => {
    const executables = {
      go: {
        codex: "/Users/operator/.local/bin/arcadia-go-broker-codex",
        claude: "/Users/operator/.local/bin/arcadia-go-broker-claude"
      },
      advance: {
        codex: "/Users/operator/.local/bin/arcadia-advance-broker-codex",
        claude: "/Users/operator/.local/bin/arcadia-advance-broker-claude"
      },
      workMonitor: {
        codex: "/Users/operator/.local/bin/arcadia-work-monitor-broker-codex",
        claude: "/Users/operator/.local/bin/arcadia-work-monitor-broker-claude"
      }
    };
    expect(permissionSnippets(executables)).toEqual({
      codexRules: [
        'prefix_rule(pattern=["/Users/operator/.local/bin/arcadia-advance-broker-codex"], decision="allow")',
        'prefix_rule(pattern=["/Users/operator/.local/bin/arcadia-work-monitor-broker-codex"], decision="allow")'
      ],
      claudePermissions: [
        "Bash(/Users/operator/.local/bin/arcadia-advance-broker-claude)",
        "Bash(/Users/operator/.local/bin/arcadia-work-monitor-broker-claude)"
      ]
    });
  });

  it("stages the database schema needed when the broker runs outside Arcadia", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "arcadia-go-broker-schema-"));
    const repository = path.join(root, "repository");
    const release = path.join(root, "release");
    const schema = "CREATE TABLE projects (id TEXT PRIMARY KEY);\n";

    try {
      mkdirSync(path.join(repository, "database"), { recursive: true });
      writeFileSync(path.join(repository, "database", "schema.sql"), schema);

      const stagedPath = stageGoBrokerDatabaseSchema(repository, release);

      expect(stagedPath).toBe(path.join(release, "dist", "database", "schema.sql"));
      expect(readFileSync(stagedPath, "utf8")).toBe(schema);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("copies bridged local dependencies into a release without a registry deploy", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "arcadia-go-broker-dependencies-"));
    const repository = path.join(root, "repository");
    const sharedNodeModules = path.join(root, "shared-node-modules");
    const release = path.join(root, "release");

    try {
      mkdirSync(path.join(sharedNodeModules, ".pnpm", "runtime"), { recursive: true });
      writeFileSync(path.join(sharedNodeModules, ".pnpm", "runtime", "index.js"), "export default 'ready';\n");
      symlinkSync(".pnpm/runtime", path.join(sharedNodeModules, "runtime"));
      mkdirSync(repository, { recursive: true });
      symlinkSync(sharedNodeModules, path.join(repository, "node_modules"));

      const destination = stageGoBrokerDependencies(repository, release);

      expect(destination).toBe(path.join(release, "node_modules"));
      expect(lstatSync(destination).isSymbolicLink()).toBe(false);
      expect(readFileSync(path.join(destination, "runtime", "index.js"), "utf8")).toBe("export default 'ready';\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
