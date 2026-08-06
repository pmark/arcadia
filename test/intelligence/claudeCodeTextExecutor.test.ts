import type Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createClaudeCodeCliTextExecutor } from "../../src/intelligence/claudeCode/textExecutor.js";
import { buildDefaultRoutes } from "../../src/intelligence/config/defaults.js";
import type { IntelligenceV01Config } from "../../src/intelligence/config/types.js";
import { createSqliteIntelligenceJobRepository } from "../../src/intelligence/db/sqliteRepository.js";
import { IntelligenceWorker } from "../../src/intelligence/jobs/worker.js";
import { createLiteLlmHttpClient } from "../../src/intelligence/litellm/httpClient.js";
import { submitIntelligenceRequest } from "../../src/intelligence/service/jobService.js";
import {
  buildIntelligenceRequest,
  createTempWorkspace,
  openWorkspaceDatabase,
  removeWorkspace,
  unavailableLiteLlmBaseUrl,
} from "./testSupport.js";

const workspaces: string[] = [];
const databases: Database.Database[] = [];
const tempDirs: string[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) {
    db.close();
  }
  for (const workspace of workspaces.splice(0)) {
    removeWorkspace(workspace);
  }
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

const SUCCESS_RESULT = {
  candidates: [
    "Sunrise Hike",
    "Mountain Dawn",
    "Trail Breeze",
    "Peak Morning",
    "Daybreak Ridge",
  ],
};

describe("Claude Code CLI text executor", () => {
  it("completes a text job and returns the validated structured result", async () => {
    const finished = await runClaudeCodeTextScenario("success");

    expect(finished.status).toBe("completed");
    expect(finished.selectedRoute).toBe("claude-code-cli");
    expect(finished.usage?.routeId).toBe("arcadia.text.generate.local.fast.claude-code");
    expect(finished.usage?.provider).toBe("claude-code-cli");
    expect(finished.result).toEqual(SUCCESS_RESULT);
    expect(finished.validation?.passed).toBe(true);
  });

  it("fails clearly when Claude Code does not produce a result file", async () => {
    const finished = await runClaudeCodeTextScenario("missing-result");

    expect(finished.status).toBe("failed");
    expect(finished.error?.code).toBe("CLAUDE_CODE_MISSING_RESULT");
  });

  it("fails clearly when result.json is not valid JSON", async () => {
    const finished = await runClaudeCodeTextScenario("invalid-json");

    expect(finished.status).toBe("failed");
    expect(finished.error?.code).toBe("CLAUDE_CODE_RESULT_INVALID_JSON");
  });

  it("fails clearly when Claude Code reports a non-completed status", async () => {
    const finished = await runClaudeCodeTextScenario("failed-status");

    expect(finished.status).toBe("failed");
    expect(finished.error?.code).toBe("CLAUDE_CODE_RESULT_FAILED");
  });

  it("recovers a completed result when the Claude Code CLI process lingers past the timeout", async () => {
    const finished = await runClaudeCodeTextScenario("lingers", { timeoutMs: 1_000 });

    expect(finished.status).toBe("completed");
    expect(finished.result).toEqual(SUCCESS_RESULT);
    expect(finished.error).toBeUndefined();
  });

  it("fails with CLAUDE_CODE_CLI_TIMEOUT when no result was written before the kill", async () => {
    const finished = await runClaudeCodeTextScenario("lingers-no-output", { timeoutMs: 1_000 });

    expect(finished.status).toBe("failed");
    expect(finished.error?.code).toBe("CLAUDE_CODE_CLI_TIMEOUT");
  });

  it("blocks clearly when the Claude Code CLI command is unavailable", async () => {
    const finished = await runClaudeCodeTextScenario("success", {
      command: "arcadia-claude-code-command-that-does-not-exist",
    });

    expect(finished.status).toBe("blocked");
    expect(finished.error?.code).toBe("CLAUDE_CODE_CLI_UNAVAILABLE");
  });
});

async function runClaudeCodeTextScenario(
  scenario:
    | "success"
    | "missing-result"
    | "invalid-json"
    | "failed-status"
    | "lingers"
    | "lingers-no-output",
  overrides: { command?: string; timeoutMs?: number } = {},
) {
  const workspace = createTempWorkspace();
  workspaces.push(workspace);
  const db = openWorkspaceDatabase(workspace);
  databases.push(db);
  const repository = createSqliteIntelligenceJobRepository(db);
  const fakeCommand = createFakeClaudeCodeTextCommand();
  const baseUrl = await unavailableLiteLlmBaseUrl();

  await submitIntelligenceRequest(
    repository,
    buildIntelligenceRequest({
      capability: "text.generate",
      execution: "local-required",
      profile: "fast",
      operationId: "rebuster.generate-candidate-list",
      input: { topic: "weekend hiking trip names", count: 5 },
      outputContract: {
        schemaId: "rebuster.candidate-list.v1",
        schemaVersion: 1,
        jsonSchema: {
          type: "object",
          properties: {
            candidates: { type: "array", items: { type: "string" } },
          },
          required: ["candidates"],
          additionalProperties: false,
        },
      },
    }),
  );

  const config: IntelligenceV01Config = {
    routes: buildDefaultRoutes({ claudeCodeTextRoute: "claude-code-cli" }),
    liteLlmBaseUrl: baseUrl,
    maxRetries: 1,
    workerPollIntervalMs: 25,
    leaseDurationMs: 30_000,
    claudeCodeCli: {
      command: overrides.command ?? process.execPath,
      args: [fakeCommand, "{workspace}", scenario],
      timeoutMs: overrides.timeoutMs ?? 5_000,
    },
  };
  const claudeCodeTextExecutor = createClaudeCodeCliTextExecutor({
    workspaceRoot: workspace,
    config,
  });
  const worker = new IntelligenceWorker(
    repository,
    createLiteLlmHttpClient({ baseUrl }),
    config,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    claudeCodeTextExecutor,
  );

  const finished = await worker.runOnce();
  if (!finished) {
    throw new Error("Expected worker to process a queued job.");
  }
  return finished;
}

function createFakeClaudeCodeTextCommand(): string {
  const tempDir = mkdtempSync(path.join(tmpdir(), "arcadia-fake-claude-code-text-"));
  tempDirs.push(tempDir);
  const commandPath = path.join(tempDir, "fake-claude-code-text.cjs");

  const successJson = JSON.stringify({ status: "completed", result: SUCCESS_RESULT });

  writeFileSync(
    commandPath,
    `
const fs = require("node:fs");
const path = require("node:path");

const workspace = process.argv[2];
const scenario = process.argv[3];
const outputDir = path.join(workspace, "output");
fs.mkdirSync(outputDir, { recursive: true });
fs.readFileSync(0, "utf8"); // drain stdin
process.stdout.write("fake claude code text stdout\\n");
process.stderr.write("fake claude code text stderr\\n");

if (scenario === "missing-result") {
  process.exit(0);
}

if (scenario === "invalid-json") {
  fs.writeFileSync(path.join(outputDir, "result.json"), "not valid json {{{");
  process.exit(0);
}

if (scenario === "failed-status") {
  fs.writeFileSync(path.join(outputDir, "result.json"), JSON.stringify({
    status: "failed",
    error: "The model refused to generate this content."
  }));
  process.exit(0);
}

if (scenario === "lingers") {
  fs.writeFileSync(path.join(outputDir, "result.json"), ${JSON.stringify(successJson)});
  setTimeout(() => process.exit(0), 30000);
  return;
}

if (scenario === "lingers-no-output") {
  setTimeout(() => process.exit(0), 30000);
  return;
}

// success
fs.writeFileSync(path.join(outputDir, "result.json"), ${JSON.stringify(successJson)});
`,
  );
  return commandPath;
}
