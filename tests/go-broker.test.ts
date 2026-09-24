import { lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ArcadiaError } from "../src/cli/errors.js";
import { permissionSnippets, renderGoBrokerLauncher, stageGoBrokerDatabaseSchema, stageGoBrokerDependencies } from "../src/commands/goBrokerInstall.js";
import { assertGoBrokerHostController, parseGoBrokerArguments, runGoBroker } from "../src/goBroker.js";
import * as broker from "../src/goBroker.js";

describe("protected Arcadia go broker", () => {
  it("derives the source from cwd and accepts only fixed launcher inputs", () => {
    expect(parseGoBrokerArguments(["codex", "go"], "./finished")).toEqual({
      source: path.resolve("./finished"),
      agent: "codex",
      operation: "go"
    });
    expect(parseGoBrokerArguments(["claude", "advance"], "/tmp/finished").agent).toBe("claude");
    expect(parseGoBrokerArguments(["opencode", "go"], "/tmp/finished").agent).toBe("opencode");
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

  it("accepts brief as a fixed launcher operation", () => {
    expect(parseGoBrokerArguments(["codex", "brief"], "/tmp/finished").operation).toBe("brief");
  });

  it("routes the actual sandboxed launcher through preservation transport", async () => {
    const response = { ok: true, command: "preserve", data: { receipt: { commit: "candidate" } } };
    const requestCandidatePreservation = vi.fn().mockResolvedValue(response);
    vi.doMock("../src/sessions/preservationTransport.js", () => ({ requestAgentGo: vi.fn(), requestCandidatePreservation }));
    const directBroker = vi.spyOn(broker, "runGoBroker");
    const output = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const errors = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const argv = process.argv;
    const exitCode = process.exitCode;
    vi.stubEnv("CODEX_SANDBOX", "seatbelt");
    process.argv = ["node", "arcadia-go-broker", "codex", "preserve"];
    try {
      await import("../scripts/arcadia-go-broker.js");
      expect(requestCandidatePreservation).toHaveBeenCalledExactlyOnceWith(process.cwd());
      expect(directBroker).not.toHaveBeenCalled();
      expect(output).toHaveBeenCalledWith(`${JSON.stringify(response, null, 2)}\n`);
      expect(errors).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(exitCode);
    } finally {
      process.argv = argv;
      process.exitCode = exitCode;
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
      vi.doUnmock("../src/sessions/preservationTransport.js");
    }
  });

  it.each([
    { agent: "codex", sandbox: "seatbelt" },
    { agent: "claude", sandbox: "" },
    { agent: "codex", sandbox: "" }
  ])("routes $agent go through transport with sandbox signal '$sandbox'", async ({ agent, sandbox }) => {
    const response = { ok: true, command: "go-broker", data: { nextWorktree: { path: "/tmp/next" } } };
    const requestAgentGo = vi.fn().mockResolvedValue(response);
    vi.doMock("../src/sessions/preservationTransport.js", () => ({ requestAgentGo, requestCandidatePreservation: vi.fn() }));
    const directBroker = vi.spyOn(broker, "runGoBroker");
    const output = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const errors = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const argv = process.argv;
    const exitCode = process.exitCode;
    vi.stubEnv("CODEX_SANDBOX", sandbox);
    process.argv = ["node", "arcadia-go-broker", agent, "go"];
    try {
      if (agent === "claude") await import("../scripts/arcadia-go-broker.js?claude-go-request");
      else if (sandbox) await import("../scripts/arcadia-go-broker.js?go-request");
      else await import("../scripts/arcadia-go-broker.js?host-go-request");
      expect(requestAgentGo).toHaveBeenCalledExactlyOnceWith(process.cwd(), agent);
      expect(directBroker).not.toHaveBeenCalled();
      expect(output).toHaveBeenCalledWith(`${JSON.stringify(response, null, 2)}\n`);
      expect(errors).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(exitCode);
    } finally {
      process.argv = argv;
      process.exitCode = exitCode;
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
      vi.doUnmock("../src/sessions/preservationTransport.js");
    }
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

    expect(workMonitorRunner).toHaveBeenCalledWith({ workspace: "/tmp/arcadia-workspace", includePullRequests: false, repositoryPath: "/tmp/prepared" });
    expect(result.command).toBe("work-monitor-broker");
  });

  describe("the combined brief operation", () => {
    const advanceResponse = { ok: true as const, command: "advance", data: { transition: null, session: null }, artifacts: [], warnings: [] };
    const workMonitorResponse = { ok: true as const, command: "work.monitor", data: { snapshot: {}, attentionLines: [] }, artifacts: [], warnings: [] };
    const nextResponse = {
      ok: true as const,
      command: "next",
      data: {
        context: null,
        blockers: [],
        operatorQuestion: null,
        dispatchable: false,
        projectId: "proj_1",
        repoRoot: "/tmp/prepared"
      },
      artifacts: [],
      warnings: []
    };

    it("runs advance, work-monitor, and next once each and returns their combined data plus the rendered brief", () => {
      const advanceRunner = vi.fn().mockReturnValue(advanceResponse);
      const workMonitorRunner = vi.fn().mockReturnValue(workMonitorResponse);
      const nextRunner = vi.fn().mockReturnValue(nextResponse);
      const resolveProjectSlug = vi.fn().mockReturnValue("arcadia");

      const result = runGoBroker(
        { source: "/tmp/prepared", agent: "claude", operation: "brief" },
        vi.fn() as never,
        advanceRunner as never,
        workMonitorRunner as never,
        () => "/tmp/arcadia-workspace",
        nextRunner as never,
        resolveProjectSlug as never
      );

      expect(advanceRunner).toHaveBeenCalledExactlyOnceWith({ workspace: "/tmp/arcadia-workspace", repo: "/tmp/prepared" });
      expect(workMonitorRunner).toHaveBeenCalledExactlyOnceWith({ workspace: "/tmp/arcadia-workspace", includePullRequests: false, repositoryPath: "/tmp/prepared" });
      expect(resolveProjectSlug).toHaveBeenCalledExactlyOnceWith("/tmp/prepared");
      expect(nextRunner).toHaveBeenCalledExactlyOnceWith({ workspace: "/tmp/arcadia-workspace", project: "arcadia" });
      expect(result.command).toBe("brief-broker");
      expect(result.data).toEqual({
        advance: advanceResponse.data,
        workMonitor: workMonitorResponse.data,
        next: nextResponse.data,
        dispatchBrief: "No current action could be resolved.\n\n\nRepairing the control documentation is the immediate work.",
        sessionTitles: {
          working: "🩹🔵 ? repair",
          pr: "🩹🟣 ? repair",
          waiting: "🩹🟠 ? repair",
          blocked: "🩹🔴 ? repair",
          done: "🩹🟢 ? repair"
        }
      });
    });

    it.each([
      ["advance", (advanceRunner: () => void, _workMonitorRunner: () => void, _nextRunner: () => void) => advanceRunner],
      ["work-monitor", (_advanceRunner: () => void, workMonitorRunner: () => void, _nextRunner: () => void) => workMonitorRunner]
    ] as const)("stops after a refused %s stage and tags the failure with its stage", (stage, pickFailing) => {
      const advanceRunner = vi.fn().mockReturnValue(advanceResponse);
      const workMonitorRunner = vi.fn().mockReturnValue(workMonitorResponse);
      const nextRunner = vi.fn().mockReturnValue(nextResponse);
      const failing = pickFailing(advanceRunner, workMonitorRunner, nextRunner);
      failing.mockImplementation(() => {
        throw new ArcadiaError("VALIDATION_ERROR", `${stage} refused`, 2, { detail: "original" });
      });

      try {
        runGoBroker(
          { source: "/tmp/prepared", agent: "claude", operation: "brief" },
          vi.fn() as never,
          advanceRunner as never,
          workMonitorRunner as never,
          () => "/tmp/arcadia-workspace",
          nextRunner as never,
          vi.fn().mockReturnValue("arcadia") as never
        );
        expect.unreachable("expected runGoBroker to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(ArcadiaError);
        expect((error as ArcadiaError).message).toBe(`${stage} refused`);
        expect((error as ArcadiaError).details).toEqual({ detail: "original", stage });
      }
      expect(nextRunner).not.toHaveBeenCalled();
    });

    it("tags a plain (non-ArcadiaError) stage failure with its stage instead of losing the tag", () => {
      const advanceRunner = vi.fn(() => {
        throw new Error("Arcadia advance requires one managed Project document.");
      });
      const workMonitorRunner = vi.fn().mockReturnValue(workMonitorResponse);
      const nextRunner = vi.fn().mockReturnValue(nextResponse);

      try {
        runGoBroker(
          { source: "/tmp/prepared", agent: "claude", operation: "brief" },
          vi.fn() as never,
          advanceRunner,
          workMonitorRunner as never,
          () => "/tmp/arcadia-workspace",
          nextRunner as never,
          vi.fn().mockReturnValue("arcadia") as never
        );
        expect.unreachable("expected runGoBroker to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(ArcadiaError);
        // The same normalization a plain Error would get at the standalone
        // command's own CLI entrypoint, with the stage tag added.
        expect((error as ArcadiaError).details).toMatchObject({ stage: "advance" });
      }
      expect(workMonitorRunner).not.toHaveBeenCalled();
      expect(nextRunner).not.toHaveBeenCalled();
    });

    it("stops before calling next when the project slug cannot be resolved, tagged as the next stage", () => {
      const advanceRunner = vi.fn().mockReturnValue(advanceResponse);
      const workMonitorRunner = vi.fn().mockReturnValue(workMonitorResponse);
      const nextRunner = vi.fn().mockReturnValue(nextResponse);
      const resolveProjectSlug = vi.fn(() => {
        throw new ArcadiaError("VALIDATION_ERROR", "Arcadia brief requires one managed Project document.", 2, { repository: "/tmp/prepared" });
      });

      try {
        runGoBroker(
          { source: "/tmp/prepared", agent: "claude", operation: "brief" },
          vi.fn() as never,
          advanceRunner as never,
          workMonitorRunner as never,
          () => "/tmp/arcadia-workspace",
          nextRunner as never,
          resolveProjectSlug
        );
        expect.unreachable("expected runGoBroker to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(ArcadiaError);
        expect((error as ArcadiaError).details).toEqual({ repository: "/tmp/prepared", stage: "next" });
      }
      expect(nextRunner).not.toHaveBeenCalled();
    });
  });

  it("allows fixed request and prepared-worktree brokers", () => {
    const bin = "/Users/operator/.local/bin";
    const executables = {
      preserve: {
        codex: `${bin}/arcadia-preserve-broker-codex`,
        claude: `${bin}/arcadia-preserve-broker-claude`,
        opencode: `${bin}/arcadia-preserve-broker-opencode`
      },
      go: {
        codex: `${bin}/arcadia-go-broker-codex`,
        claude: `${bin}/arcadia-go-broker-claude`,
        opencode: `${bin}/arcadia-go-broker-opencode`
      },
      advance: {
        codex: `${bin}/arcadia-advance-broker-codex`,
        claude: `${bin}/arcadia-advance-broker-claude`,
        opencode: `${bin}/arcadia-advance-broker-opencode`
      },
      workMonitor: {
        codex: `${bin}/arcadia-work-monitor-broker-codex`,
        claude: `${bin}/arcadia-work-monitor-broker-claude`,
        opencode: `${bin}/arcadia-work-monitor-broker-opencode`
      },
      brief: {
        codex: `${bin}/arcadia-brief-broker-codex`,
        claude: `${bin}/arcadia-brief-broker-claude`,
        opencode: `${bin}/arcadia-brief-broker-opencode`
      }
    };
    // Every fixed request launcher is request-only, so each is granted to
    // Codex rules and the Claude allowlist alike.
    const launchers = ["go", "advance", "preserve", "work-monitor", "brief"].map(
      (operation) => `${bin}/arcadia-${operation}-broker`
    );
    expect(permissionSnippets(executables)).toEqual({
      codexRules: launchers.flatMap((launcher) =>
        ["codex", "claude", "opencode"].map(
          (agent) => `prefix_rule(pattern=["${launcher}-${agent}"], decision="allow")`
        )
      ),
      claudePermissions: launchers.flatMap((launcher) =>
        ["codex", "claude", "opencode"].map((agent) => `Bash(${launcher}-${agent})`)
      )
    });
  });

  it("renders the opencode launcher exactly like the Codex and Claude launchers", () => {
    const codex = renderGoBrokerLauncher("/release/arcadia-go-broker.js", "codex", "go");
    const claude = renderGoBrokerLauncher("/release/arcadia-go-broker.js", "claude", "go");
    const opencode = renderGoBrokerLauncher("/release/arcadia-go-broker.js", "opencode", "go");

    expect(opencode).toBe(codex.replace("codex go", "opencode go"));
    expect(opencode).toContain('opencode go "$@"');
    // The fixed agent and operation are the only argument the launcher carries.
    expect(opencode.split("\n")[1]).toContain("/release/arcadia-go-broker.js");
    expect(claude).toContain('claude go "$@"');
  });

  it("renders the brief launcher the same way as every other operation", () => {
    const claude = renderGoBrokerLauncher("/release/arcadia-go-broker.js", "claude", "brief");
    expect(claude).toContain('claude brief "$@"');
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

  it.each(["directory", "entries"])("copies %s-bridged dependencies into an independent release", (bridge) => {
    const root = mkdtempSync(path.join(os.tmpdir(), "arcadia-go-broker-dependencies-"));
    const repository = path.join(root, "repository");
    const sharedNodeModules = path.join(root, "shared-node-modules");
    const release = path.join(root, "release");

    try {
      mkdirSync(path.join(sharedNodeModules, ".pnpm", "runtime"), { recursive: true });
      writeFileSync(path.join(sharedNodeModules, ".pnpm", "runtime", "index.js"), "export default 'ready';\n");
      symlinkSync(".pnpm/runtime", path.join(sharedNodeModules, "runtime"));
      mkdirSync(repository, { recursive: true });
      if (bridge === "directory") {
        symlinkSync(sharedNodeModules, path.join(repository, "node_modules"));
      } else {
        mkdirSync(path.join(repository, "node_modules"));
        symlinkSync(path.join(sharedNodeModules, ".pnpm"), path.join(repository, "node_modules", ".pnpm"));
        symlinkSync(path.join(sharedNodeModules, "runtime"), path.join(repository, "node_modules", "runtime"));
      }

      const destination = stageGoBrokerDependencies(repository, release);

      expect(destination).toBe(path.join(release, "node_modules"));
      expect(lstatSync(destination).isSymbolicLink()).toBe(false);
      // Installation renames staging; neither staging nor the source checkout
      // may be needed to load the installed runtime.
      const installed = path.join(root, "installed");
      renameSync(release, installed);
      rmSync(sharedNodeModules, { recursive: true });
      expect(readFileSync(path.join(installed, "node_modules", "runtime", "index.js"), "utf8")).toBe("export default 'ready';\n");
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
