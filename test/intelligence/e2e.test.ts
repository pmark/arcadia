import type Database from "better-sqlite3";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createIntelligenceServer } from "../../src/intelligence/api/server.js";
import { createSqliteIntelligenceArtifactStore } from "../../src/intelligence/artifacts/store.js";
import type { IntelligenceArtifactStore } from "../../src/intelligence/artifacts/store.js";
import { ArcadiaIntelligenceClient } from "../../src/intelligence/client/client.js";
import { buildDefaultRoutes } from "../../src/intelligence/config/defaults.js";
import { createSqliteIntelligenceJobRepository } from "../../src/intelligence/db/sqliteRepository.js";
import { IntelligenceWorker } from "../../src/intelligence/jobs/worker.js";
import { createLiteLlmHttpClient } from "../../src/intelligence/litellm/httpClient.js";
import {
  RetryNotAllowedError,
  retryIntelligenceJob,
  submitIntelligenceRequest,
} from "../../src/intelligence/service/jobService.js";
import type { IntelligenceJobRepository } from "../../src/intelligence/db/repository.js";
import {
  ONE_PIXEL_PNG_BASE64,
  buildIntelligenceRequest,
  closeServer,
  createTempWorkspace,
  delay,
  openWorkspaceDatabase,
  removeWorkspace,
  startFakeLiteLlm,
  startFakeLiteLlmImages,
  testIntelligenceConfig,
  unavailableLiteLlmBaseUrl,
} from "./testSupport.js";

const workspaces: string[] = [];
const databases: Database.Database[] = [];
const servers: Server[] = [];
const stopFns: Array<() => void> = [];

afterEach(async () => {
  for (const stop of stopFns.splice(0)) {
    stop();
  }
  await Promise.all(servers.splice(0).map((server) => closeServer(server)));
  for (const db of databases.splice(0)) {
    db.close();
  }
  for (const workspace of workspaces.splice(0)) {
    removeWorkspace(workspace);
  }
});

function setupRepository(): IntelligenceJobRepository {
  const workspace = createTempWorkspace();
  workspaces.push(workspace);
  const db = openWorkspaceDatabase(workspace);
  databases.push(db);
  return createSqliteIntelligenceJobRepository(db);
}

function setupIntelligence(): {
  repository: IntelligenceJobRepository;
  artifactStore: IntelligenceArtifactStore;
} {
  const workspace = createTempWorkspace();
  workspaces.push(workspace);
  const db = openWorkspaceDatabase(workspace);
  databases.push(db);
  return {
    repository: createSqliteIntelligenceJobRepository(db),
    artifactStore: createSqliteIntelligenceArtifactStore(db, workspace),
  };
}

describe("Arcadia Intelligence v0.1 end-to-end", () => {
  it("moves a job queued -> running -> completed with valid fake LiteLLM output", async () => {
    const repository = setupRepository();
    const { server, baseUrl } = await startFakeLiteLlm({
      content: { greeting: "Hello, Ada!" },
      delayMs: 80,
    });
    servers.push(server);

    const { job: submitted } = await submitIntelligenceRequest(
      repository,
      buildIntelligenceRequest(),
    );
    expect(submitted.status).toBe("queued");

    const worker = new IntelligenceWorker(
      repository,
      createLiteLlmHttpClient({ baseUrl }),
      testIntelligenceConfig(baseUrl),
    );

    const runPromise = worker.runOnce();
    await delay(20);
    const midFlight = await repository.findById(submitted.id);
    expect(midFlight?.status).toBe("running");

    const finished = await runPromise;
    expect(finished?.status).toBe("completed");
    expect(finished?.result).toEqual({ greeting: "Hello, Ada!" });
    expect(finished?.validation?.passed).toBe(true);
    expect(finished?.selectedRoute).toBe("arcadia-default");
    expect(finished?.usage?.modelRoute).toBe("arcadia-default");
    expect(typeof finished?.usage?.durationMs).toBe("number");
    expect(finished?.completedAt).toBeTruthy();
  });

  it("fails the job when LiteLLM output does not match the app-supplied JSON Schema", async () => {
    const repository = setupRepository();
    const { server, baseUrl } = await startFakeLiteLlm({
      content: { greeting: 12345 },
    });
    servers.push(server);

    await submitIntelligenceRequest(repository, buildIntelligenceRequest());

    const worker = new IntelligenceWorker(
      repository,
      createLiteLlmHttpClient({ baseUrl }),
      testIntelligenceConfig(baseUrl),
    );
    const finished = await worker.runOnce();

    expect(finished?.status).toBe("failed");
    expect(finished?.error?.code).toBe("VALIDATION_FAILED");
  });

  it("blocks the job clearly when LiteLLM is unavailable", async () => {
    const repository = setupRepository();
    const baseUrl = await unavailableLiteLlmBaseUrl();

    await submitIntelligenceRequest(repository, buildIntelligenceRequest());

    const worker = new IntelligenceWorker(
      repository,
      createLiteLlmHttpClient({ baseUrl, timeoutMs: 1_000 }),
      testIntelligenceConfig(baseUrl),
    );
    const finished = await worker.runOnce();

    expect(finished?.status).toBe("blocked");
    expect(finished?.error?.code).toBe("LITELLM_UNAVAILABLE");
  });

  it("allows exactly one retry and rejects further retries", async () => {
    const repository = setupRepository();
    const { server, baseUrl } = await startFakeLiteLlm({ content: { greeting: 999 } });
    servers.push(server);

    const { job } = await submitIntelligenceRequest(repository, buildIntelligenceRequest());
    const worker = new IntelligenceWorker(
      repository,
      createLiteLlmHttpClient({ baseUrl }),
      testIntelligenceConfig(baseUrl),
    );

    const firstAttempt = await worker.runOnce();
    expect(firstAttempt?.status).toBe("failed");

    const retried = await retryIntelligenceJob(repository, job.id, 1);
    expect(retried.status).toBe("queued");
    expect(retried.retryCount).toBe(1);

    const secondAttempt = await worker.runOnce();
    expect(secondAttempt?.status).toBe("failed");

    await expect(retryIntelligenceJob(repository, job.id, 1)).rejects.toThrow(
      RetryNotAllowedError,
    );
  });

  it("processes a synthetic second companion app with an unrelated capability and schema unchanged", async () => {
    const repository = setupRepository();
    const { server, baseUrl } = await startFakeLiteLlm({
      content: { score: 8.5, tags: ["witty", "concise"] },
    });
    servers.push(server);

    const secondAppRequest = buildIntelligenceRequest({
      idempotencyKey: "second-app-key-1",
      operationId: "another-app.poem-rating",
      clientApp: "another-app",
      input: { poem: "Roses are red..." },
      outputContract: {
        schemaId: "another-app.poem-rating.v1",
        schemaVersion: 1,
        jsonSchema: {
          type: "object",
          properties: {
            score: { type: "number" },
            tags: { type: "array", items: { type: "string" } },
          },
          required: ["score", "tags"],
          additionalProperties: false,
        },
      },
      template: { id: "another-app.poem-rating-template", version: "1" },
    });

    await submitIntelligenceRequest(repository, secondAppRequest);
    const worker = new IntelligenceWorker(
      repository,
      createLiteLlmHttpClient({ baseUrl }),
      testIntelligenceConfig(baseUrl),
    );
    const finished = await worker.runOnce();

    expect(finished?.status).toBe("completed");
    expect(finished?.result).toEqual({ score: 8.5, tags: ["witty", "concise"] });
  });

  it("never escalates a local-preferred request to cloud, even when paid usage is allowed and a cloud route is configured", async () => {
    const repository = setupRepository();
    const { server, baseUrl } = await startFakeLiteLlm({ content: { greeting: "hi" } });
    servers.push(server);

    await submitIntelligenceRequest(
      repository,
      buildIntelligenceRequest({
        execution: "local-preferred",
        executionPolicy: { allowPaidUsage: true, maxRetries: 1 },
      }),
    );
    const config = testIntelligenceConfig(baseUrl, {
      routes: buildDefaultRoutes({ localTextRoute: "arcadia-default", cloudTextRoute: "arcadia-cloud" }),
    });
    const worker = new IntelligenceWorker(
      repository,
      createLiteLlmHttpClient({ baseUrl }),
      config,
    );
    const finished = await worker.runOnce();

    expect(finished?.status).toBe("completed");
    expect(finished?.selectedRoute).toBe("arcadia-default");
    expect(finished?.usage?.routeId).toBe("arcadia.text.generate.local.standard");
  });

  it("blocks a cloud-required request with a typed error when paid usage is not allowed", async () => {
    const repository = setupRepository();
    const { server, baseUrl } = await startFakeLiteLlm({ content: { greeting: "hi" } });
    servers.push(server);

    await submitIntelligenceRequest(
      repository,
      buildIntelligenceRequest({
        execution: "cloud-required",
        executionPolicy: { allowPaidUsage: false, maxRetries: 1 },
      }),
    );
    const config = testIntelligenceConfig(baseUrl, {
      routes: buildDefaultRoutes({ localTextRoute: "arcadia-default", cloudTextRoute: "arcadia-cloud" }),
    });
    const worker = new IntelligenceWorker(
      repository,
      createLiteLlmHttpClient({ baseUrl }),
      config,
    );
    const finished = await worker.runOnce();

    expect(finished?.status).toBe("blocked");
    expect(finished?.error?.code).toBe("PAID_USAGE_NOT_ALLOWED");
  });

  it("ignores a raw LiteLLM route/model field smuggled into the request and still resolves via the registry", async () => {
    const repository = setupRepository();
    const { server, baseUrl } = await startFakeLiteLlm({ content: { greeting: "hi" } });
    servers.push(server);

    const request = {
      ...buildIntelligenceRequest(),
      // Not part of IntelligenceRequest's public type; simulates a client
      // that ignores the contract or a hand-built JSON payload.
      route: "some-other-route",
      model: "gpt-4o",
    };
    await submitIntelligenceRequest(repository, request as unknown as Parameters<typeof submitIntelligenceRequest>[1]);

    const config = testIntelligenceConfig(baseUrl);
    const worker = new IntelligenceWorker(repository, createLiteLlmHttpClient({ baseUrl }), config);
    const finished = await worker.runOnce();

    expect(finished?.status).toBe("completed");
    expect(finished?.selectedRoute).toBe("arcadia-default");
  });

  it("lets the client submit, poll, and retrieve a job over real HTTP until it reaches a terminal status", async () => {
    const repository = setupRepository();
    const { server: liteLlmServer, baseUrl: liteLlmBaseUrl } = await startFakeLiteLlm({
      content: { greeting: "Hello from HTTP!" },
      delayMs: 30,
    });
    servers.push(liteLlmServer);

    const config = testIntelligenceConfig(liteLlmBaseUrl);
    const worker = new IntelligenceWorker(repository, createLiteLlmHttpClient({ baseUrl: liteLlmBaseUrl }), config);
    stopFns.push(worker.start());

    const apiServer = createIntelligenceServer({ repository, config });
    await new Promise<void>((resolve) => apiServer.listen(0, "127.0.0.1", resolve));
    servers.push(apiServer);
    const { port } = apiServer.address() as { port: number };

    const client = new ArcadiaIntelligenceClient({ baseUrl: `http://127.0.0.1:${port}` });
    const { job, created } = await client.submit(buildIntelligenceRequest());
    expect(created).toBe(true);

    const completed = await client.waitForCompletion(job.id, {
      pollIntervalMs: 20,
      timeoutMs: 5_000,
    });

    expect(completed.status).toBe("completed");
    expect(completed.result).toEqual({ greeting: "Hello from HTTP!" });

    const fetched = await client.getJob(job.id);
    expect(fetched.status).toBe("completed");

    await expect(client.retry(job.id)).rejects.toThrow();
  });

  it("reports health with LiteLLM reachability", async () => {
    const repository = setupRepository();
    const { server: liteLlmServer, baseUrl: liteLlmBaseUrl } = await startFakeLiteLlm({
      content: { greeting: "hi" },
    });
    servers.push(liteLlmServer);

    const config = testIntelligenceConfig(liteLlmBaseUrl);
    const apiServer = createIntelligenceServer({ repository, config });
    await new Promise<void>((resolve) => apiServer.listen(0, "127.0.0.1", resolve));
    servers.push(apiServer);
    const { port } = apiServer.address() as { port: number };

    const response = await fetch(`http://127.0.0.1:${port}/api/intelligence/health`);
    expect(response.ok).toBe(true);
    const body = (await response.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("completes an image generation job with a durable artifact manifest, not a provider URL or base64", async () => {
    const { repository, artifactStore } = setupIntelligence();
    const { server, baseUrl } = await startFakeLiteLlmImages({ seed: 42 });
    servers.push(server);

    const imageRequest = buildIntelligenceRequest({
      capability: "image.generate",
      execution: "cloud-required",
      profile: "quality",
      executionPolicy: { allowPaidUsage: true, maxRetries: 1 },
      operationId: "demo-app.generate-image",
      input: { prompt: "a friendly robot", n: 1 },
      outputContract: {
        schemaId: "demo-app.image-manifest.v1",
        schemaVersion: 1,
        jsonSchema: {
          type: "object",
          properties: {
            artifacts: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  kind: { type: "string" },
                  uri: { type: "string" },
                  mimeType: { type: "string" },
                  sha256: { type: "string" },
                  byteSize: { type: "number" },
                },
                required: ["id", "kind", "uri", "mimeType", "sha256", "byteSize"],
              },
            },
          },
          required: ["artifacts"],
        },
      },
    });
    await submitIntelligenceRequest(repository, imageRequest);

    const config = testIntelligenceConfig(baseUrl, {
      routes: buildDefaultRoutes({ localTextRoute: "arcadia-default", cloudImageRoute: "arcadia-image" }),
    });
    const worker = new IntelligenceWorker(
      repository,
      createLiteLlmHttpClient({ baseUrl }),
      config,
      artifactStore,
    );
    const finished = await worker.runOnce();

    expect(finished?.status).toBe("completed");
    expect(finished?.selectedRoute).toBe("arcadia-image");
    const result = finished?.result as {
      artifacts: Array<{
        id: string;
        kind: string;
        uri: string;
        mimeType: string;
        sha256: string;
        byteSize: number;
        dimensions?: { width: number; height: number };
        metadata?: { seed?: number };
      }>;
      generation?: { requestedCount: number; returnedCount: number };
    };

    expect(result.artifacts).toHaveLength(1);
    const [artifact] = result.artifacts;
    expect(artifact.kind).toBe("image");
    expect(artifact.mimeType).toBe("image/png");
    expect(artifact.uri).toBe(`/api/intelligence/artifacts/${artifact.id}`);
    expect(artifact.dimensions).toEqual({ width: 1, height: 1 });
    expect(artifact.metadata).toEqual({ seed: 42 });
    expect(JSON.stringify(result)).not.toContain(ONE_PIXEL_PNG_BASE64);
    expect(result.generation).toEqual({ requestedCount: 1, returnedCount: 1 });

    const stored = await artifactStore.getArtifactBytes(artifact.id);
    expect(stored?.mimeType).toBe("image/png");
    expect(stored?.bytes.byteLength).toBe(artifact.byteSize);
    expect(stored?.bytes.toString("base64")).toBe(ONE_PIXEL_PNG_BASE64);
  });

  it("retrieves image artifact bytes over HTTP via the client", async () => {
    const { repository, artifactStore } = setupIntelligence();
    const { server: liteLlmServer, baseUrl: liteLlmBaseUrl } = await startFakeLiteLlmImages({});
    servers.push(liteLlmServer);

    const config = testIntelligenceConfig(liteLlmBaseUrl, {
      routes: buildDefaultRoutes({ localTextRoute: "arcadia-default", cloudImageRoute: "arcadia-image" }),
    });
    const worker = new IntelligenceWorker(
      repository,
      createLiteLlmHttpClient({ baseUrl: liteLlmBaseUrl }),
      config,
      artifactStore,
    );
    stopFns.push(worker.start());

    const apiServer = createIntelligenceServer({ repository, config, artifactStore });
    await new Promise<void>((resolve) => apiServer.listen(0, "127.0.0.1", resolve));
    servers.push(apiServer);
    const { port } = apiServer.address() as { port: number };

    const client = new ArcadiaIntelligenceClient({ baseUrl: `http://127.0.0.1:${port}` });
    const { job } = await client.submit(
      buildIntelligenceRequest({
        capability: "image.generate",
        execution: "cloud-required",
        profile: "quality",
        executionPolicy: { allowPaidUsage: true, maxRetries: 1 },
        input: { prompt: "a quiet harbor at dawn" },
        outputContract: {
          schemaId: "demo-app.image-manifest.v1",
          schemaVersion: 1,
          jsonSchema: {
            type: "object",
            properties: { artifacts: { type: "array" } },
            required: ["artifacts"],
          },
        },
      }),
    );

    const completed = await client.waitForCompletion(job.id, { pollIntervalMs: 20, timeoutMs: 5_000 });
    expect(completed.status).toBe("completed");
    const [artifact] = (completed.result as { artifacts: Array<{ uri: string }> }).artifacts;

    const fetched = await client.getArtifact(artifact.uri);
    expect(fetched.contentType).toBe("image/png");
    expect(Buffer.from(fetched.bytes).toString("base64")).toBe(ONE_PIXEL_PNG_BASE64);
  });

  it("blocks an image job clearly when no LiteLLM image route is configured", async () => {
    const { repository, artifactStore } = setupIntelligence();
    const { server, baseUrl } = await startFakeLiteLlmImages({});
    servers.push(server);

    await submitIntelligenceRequest(
      repository,
      buildIntelligenceRequest({
        capability: "image.generate",
        execution: "cloud-required",
        profile: "quality",
        executionPolicy: { allowPaidUsage: true, maxRetries: 1 },
        input: { prompt: "anything" },
      }),
    );

    const config = testIntelligenceConfig(baseUrl); // no cloudImageRoute configured
    const worker = new IntelligenceWorker(
      repository,
      createLiteLlmHttpClient({ baseUrl }),
      config,
      artifactStore,
    );
    const finished = await worker.runOnce();

    expect(finished?.status).toBe("blocked");
    expect(finished?.error?.code).toBe("ROUTE_NOT_CONFIGURED");
    expect(finished?.error?.message).toMatch(/image\.generate/i);
  });

  it("processes a synthetic second app's image-generation request unchanged", async () => {
    const { repository, artifactStore } = setupIntelligence();
    const { server, baseUrl } = await startFakeLiteLlmImages({ revisedPrompt: "a cozier harbor scene" });
    servers.push(server);

    const secondAppRequest = buildIntelligenceRequest({
      idempotencyKey: "second-app-image-key-1",
      operationId: "another-app.generate-mood-board-image",
      clientApp: "another-app",
      capability: "image.generate",
      execution: "cloud-required",
      profile: "quality",
      executionPolicy: { allowPaidUsage: true, maxRetries: 1 },
      input: { prompt: "a cozy harbor", size: "512x512" },
      outputContract: {
        schemaId: "another-app.mood-board-image.v1",
        schemaVersion: 1,
        jsonSchema: {
          type: "object",
          properties: { artifacts: { type: "array", minItems: 1 } },
          required: ["artifacts"],
        },
      },
      template: { id: "another-app.mood-board-template", version: "1" },
    });

    await submitIntelligenceRequest(repository, secondAppRequest);
    const config = testIntelligenceConfig(baseUrl, {
      routes: buildDefaultRoutes({ localTextRoute: "arcadia-default", cloudImageRoute: "arcadia-image" }),
    });
    const worker = new IntelligenceWorker(
      repository,
      createLiteLlmHttpClient({ baseUrl }),
      config,
      artifactStore,
    );
    const finished = await worker.runOnce();

    expect(finished?.status).toBe("completed");
    const result = finished?.result as { artifacts: Array<{ metadata?: { revisedPrompt?: string } }> };
    expect(result.artifacts[0]?.metadata?.revisedPrompt).toBe("a cozier harbor scene");
  });
});
