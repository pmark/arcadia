import type Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runIntelligenceImageSmokeCommand } from "../../src/commands/intelligence.js";
import { createSqliteIntelligenceArtifactStore } from "../../src/intelligence/artifacts/store.js";
import { createCodexCliImageExecutor } from "../../src/intelligence/codex/imageExecutor.js";
import { buildDefaultRoutes } from "../../src/intelligence/config/defaults.js";
import type { IntelligenceV01Config } from "../../src/intelligence/config/types.js";
import { createSqliteIntelligenceJobRepository } from "../../src/intelligence/db/sqliteRepository.js";
import { IntelligenceWorker } from "../../src/intelligence/jobs/worker.js";
import { createLiteLlmHttpClient } from "../../src/intelligence/litellm/httpClient.js";
import type { IntelligenceImageGenerationResult } from "../../src/intelligence/types.js";
import { submitIntelligenceRequest } from "../../src/intelligence/service/jobService.js";
import {
  ONE_PIXEL_PNG_BASE64,
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

describe("Codex CLI image executor", () => {
  it("completes an image job, persists artifacts, and returns the standard result shape", async () => {
    const finished = await runCodexImageScenario("success");

    expect(finished.status).toBe("completed");
    expect(finished.selectedRoute).toBe("codex-cli");
    expect(finished.usage?.routeId).toBe("arcadia.image.generate.local.quality");
    expect(finished.usage?.provider).toBe("codex-cli");

    const result = finished.result as unknown as IntelligenceImageGenerationResult;
    expect(result.artifacts).toHaveLength(1);
    expect(result.generation).toEqual({ requestedCount: 1, returnedCount: 1 });

    const artifact = result.artifacts[0]!;
    expect(artifact.kind).toBe("image");
    expect(artifact.mimeType).toBe("image/png");
    expect(artifact.dimensions).toEqual({ width: 1, height: 1 });
    expect(artifact.uri).toBe(`/api/intelligence/artifacts/${artifact.id}`);
    expect(artifact.metadata).toEqual({ prompt: "test prompt", seed: 123, version: "fake-codex" });
    expect(JSON.stringify(result)).not.toContain(ONE_PIXEL_PNG_BASE64);

    const stored = await finished.artifactStore.getArtifactBytes(artifact.id);
    expect(stored?.mimeType).toBe("image/png");
    expect(stored?.bytes.toString("base64")).toBe(ONE_PIXEL_PNG_BASE64);
  });

  it("fails clearly when Codex does not produce a manifest", async () => {
    const finished = await runCodexImageScenario("missing-manifest");

    expect(finished.status).toBe("failed");
    expect(finished.error?.code).toBe("CODEX_MISSING_MANIFEST");
  });

  it("fails clearly when the manifest declares a missing image file", async () => {
    const finished = await runCodexImageScenario("missing-file");

    expect(finished.status).toBe("failed");
    expect(finished.error?.code).toBe("CODEX_MISSING_IMAGE_FILE");
  });

  it("fails clearly when Codex writes an invalid image", async () => {
    const finished = await runCodexImageScenario("invalid-image");

    expect(finished.status).toBe("failed");
    expect(finished.error?.code).toBe("CODEX_INVALID_IMAGE");
  });

  it("blocks clearly when the Codex CLI command is unavailable", async () => {
    const finished = await runCodexImageScenario("success", {
      command: "arcadia-codex-command-that-does-not-exist",
    });

    expect(finished.status).toBe("blocked");
    expect(finished.error?.code).toBe("CODEX_CLI_UNAVAILABLE");
  });

  it("runs the command-level image smoke path through a normal Intelligence job", async () => {
    const workspace = createTempWorkspace();
    workspaces.push(workspace);
    const fakeCommand = createFakeCodexCommand();
    const previousCommand = process.env.ARCADIA_CODEX_CLI_COMMAND;
    const previousArgs = process.env.ARCADIA_CODEX_CLI_ARGS;

    process.env.ARCADIA_CODEX_CLI_COMMAND = process.execPath;
    process.env.ARCADIA_CODEX_CLI_ARGS = JSON.stringify([fakeCommand, "{workspace}", "success"]);

    try {
      const response = await runIntelligenceImageSmokeCommand({
        workspace,
        prompt: "test prompt",
        idempotencyKey: "arcadia-command-smoke-test",
      });

      expect(response.command).toBe("intelligence.smoke-image");
      expect(response.data.job.status).toBe("completed");
      expect(response.data.artifactCount).toBe(1);
      expect(response.data.artifactUris[0]).toMatch(/^\/api\/intelligence\/artifacts\/iart_/);
      expect(response.data.job.usage?.routeId).toBe("arcadia.image.generate.local.quality");
    } finally {
      if (previousCommand === undefined) {
        delete process.env.ARCADIA_CODEX_CLI_COMMAND;
      } else {
        process.env.ARCADIA_CODEX_CLI_COMMAND = previousCommand;
      }
      if (previousArgs === undefined) {
        delete process.env.ARCADIA_CODEX_CLI_ARGS;
      } else {
        process.env.ARCADIA_CODEX_CLI_ARGS = previousArgs;
      }
    }
  });
});

async function runCodexImageScenario(
  scenario: "success" | "missing-manifest" | "missing-file" | "invalid-image",
  overrides: { command?: string } = {},
) {
  const workspace = createTempWorkspace();
  workspaces.push(workspace);
  const db = openWorkspaceDatabase(workspace);
  databases.push(db);
  const repository = createSqliteIntelligenceJobRepository(db);
  const artifactStore = createSqliteIntelligenceArtifactStore(db, workspace);
  const fakeCommand = createFakeCodexCommand();
  const baseUrl = await unavailableLiteLlmBaseUrl();

  await submitIntelligenceRequest(
    repository,
    buildIntelligenceRequest({
      capability: "image.generate",
      execution: "local-required",
      profile: "quality",
      operationId: "example-app.generate-local-image",
      input: { prompt: "test prompt", n: 1 },
      requirements: { imageSize: "1024x1024", transparency: false },
      outputContract: {
        schemaId: "example-app.local-image.v1",
        schemaVersion: 1,
        jsonSchema: {
          type: "object",
          properties: {
            artifacts: { type: "array", minItems: 1 },
            generation: { type: "object" },
          },
          required: ["artifacts"],
        },
      },
    }),
  );

  const config: IntelligenceV01Config = {
    routes: buildDefaultRoutes({ localTextRoute: "arcadia-default", codexImageRoute: "codex-cli" }),
    liteLlmBaseUrl: baseUrl,
    maxRetries: 1,
    workerPollIntervalMs: 25,
    leaseDurationMs: 30_000,
    codexCli: {
      command: overrides.command ?? process.execPath,
      args: [fakeCommand, "{workspace}", scenario],
      timeoutMs: 5_000,
    },
  };
  const codexImageExecutor = createCodexCliImageExecutor({ workspaceRoot: workspace, artifactStore, config });
  const worker = new IntelligenceWorker(
    repository,
    createLiteLlmHttpClient({ baseUrl }),
    config,
    artifactStore,
    codexImageExecutor,
  );

  const finished = await worker.runOnce();
  if (!finished) {
    throw new Error("Expected worker to process a queued job.");
  }
  return Object.assign(finished, { artifactStore });
}

function createFakeCodexCommand(): string {
  const tempDir = mkdtempSync(path.join(tmpdir(), "arcadia-fake-codex-"));
  tempDirs.push(tempDir);
  const commandPath = path.join(tempDir, "fake-codex.cjs");
  writeFileSync(
    commandPath,
    `
const fs = require("node:fs");
const path = require("node:path");

const workspace = process.argv[2];
const scenario = process.argv[3];
const outputDir = path.join(workspace, "output");
fs.mkdirSync(outputDir, { recursive: true });
fs.readFileSync(0, "utf8");
process.stdout.write("fake codex stdout\\n");
process.stderr.write("fake codex stderr\\n");

if (scenario === "missing-manifest") {
  fs.writeFileSync(path.join(outputDir, "image-01.png"), Buffer.from("${ONE_PIXEL_PNG_BASE64}", "base64"));
  process.exit(0);
}

if (scenario === "missing-file") {
  fs.writeFileSync(path.join(outputDir, "manifest.json"), JSON.stringify({
    status: "completed",
    artifacts: [{ kind: "image", path: "output/missing.png", mimeType: "image/png", width: 1, height: 1 }]
  }));
  process.exit(0);
}

if (scenario === "invalid-image") {
  fs.writeFileSync(path.join(outputDir, "image-01.png"), "not an image");
  fs.writeFileSync(path.join(outputDir, "manifest.json"), JSON.stringify({
    status: "completed",
    artifacts: [{ kind: "image", path: "output/image-01.png", mimeType: "image/png", width: 1, height: 1 }]
  }));
  process.exit(0);
}

fs.writeFileSync(path.join(outputDir, "image-01.png"), Buffer.from("${ONE_PIXEL_PNG_BASE64}", "base64"));
fs.writeFileSync(path.join(outputDir, "manifest.json"), JSON.stringify({
  status: "completed",
  artifacts: [{
    kind: "image",
    path: "output/image-01.png",
    mimeType: "image/png",
    width: 1,
    height: 1,
    metadata: { prompt: "test prompt", seed: 123, version: "fake-codex" }
  }],
  warnings: []
}));
`,
  );
  return commandPath;
}
