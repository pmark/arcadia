import type Database from "better-sqlite3";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createIntelligenceServer } from "../../src/intelligence/api/server.js";
import { ArcadiaIntelligenceClient } from "../../src/intelligence/client/client.js";
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
  buildIntelligenceRequest,
  closeServer,
  createTempWorkspace,
  delay,
  openWorkspaceDatabase,
  removeWorkspace,
  startFakeLiteLlm,
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
      capability: "another-app.poem-rating.v1",
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

  it("never escalates to a different route even when a request allows paid usage", async () => {
    const repository = setupRepository();
    const { server, baseUrl } = await startFakeLiteLlm({ content: { greeting: "hi" } });
    servers.push(server);

    await submitIntelligenceRequest(
      repository,
      buildIntelligenceRequest({
        executionPolicy: { allowPaidUsage: true, maxRetries: 1, allowedRoutes: ["some-other-route"] },
      }),
    );
    const config = testIntelligenceConfig(baseUrl, { defaultLiteLlmRoute: "arcadia-default" });
    const worker = new IntelligenceWorker(
      repository,
      createLiteLlmHttpClient({ baseUrl }),
      config,
    );
    const finished = await worker.runOnce();

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
});
