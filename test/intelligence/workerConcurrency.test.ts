import { afterEach, describe, expect, it } from "vitest";
import { buildDefaultRoutes } from "../../src/intelligence/config/defaults.js";
import type { IntelligenceV01Config } from "../../src/intelligence/config/types.js";
import { createSqliteIntelligenceJobRepository } from "../../src/intelligence/db/sqliteRepository.js";
import { IntelligenceWorker } from "../../src/intelligence/jobs/worker.js";
import type { LiteLlmClient } from "../../src/intelligence/litellm/client.js";
import { submitIntelligenceRequest } from "../../src/intelligence/service/jobService.js";
import {
  buildIntelligenceRequest,
  createTempWorkspace,
  openWorkspaceDatabase,
  removeWorkspace,
} from "./testSupport.js";

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) removeWorkspace(workspace);
});

describe("IntelligenceWorker bounded parallel scheduling", () => {
  it("runs separate cloud and Codex pools simultaneously", async () => {
    const workspace = createTempWorkspace();
    workspaces.push(workspace);
    const db = openWorkspaceDatabase(workspace);
    const durableRepository = createSqliteIntelligenceJobRepository(db);
    let renewalCount = 0;
    const repository = {
      ...durableRepository,
      async renewJobLease(...args: Parameters<typeof durableRepository.renewJobLease>) {
        renewalCount += 1;
        return durableRepository.renewJobLease(...args);
      },
    };
    const cloudGate = deferred<void>();
    const codexGate = deferred<void>();
    let cloudStarted = false;
    let codexStarted = false;

    const liteLlmClient: LiteLlmClient = {
      async generateStructured() {
        cloudStarted = true;
        await cloudGate.promise;
        return { output: { greeting: "cloud" } };
      },
      async generateImage() {
        return { images: [] };
      },
    };
    const codexTextExecutor = {
      async execute() {
        codexStarted = true;
        await codexGate.promise;
        return { output: { greeting: "codex" } };
      },
    };
    const config = schedulerConfig({
      routes: buildDefaultRoutes({
        cloudTextRoute: "cloud-text",
        codexTextRoute: "codex-cli",
      }),
    });

    await submitIntelligenceRequest(repository, buildIntelligenceRequest({
      idempotencyKey: "parallel-cloud",
      execution: "cloud-required",
      executionPolicy: { allowPaidUsage: true, maxRetries: 1 },
    }));
    await submitIntelligenceRequest(repository, buildIntelligenceRequest({
      idempotencyKey: "parallel-codex",
      execution: "local-required",
      executionTarget: "codex",
    }));

    const worker = new IntelligenceWorker(
      repository,
      liteLlmClient,
      config,
      undefined,
      undefined,
      codexTextExecutor,
    );
    const stop = worker.start();
    try {
      await waitFor(() => cloudStarted && codexStarted);
      await waitFor(() => renewalCount > 0);
      expect(worker.getSchedulerSummary().pools["litellm-cloud-text"]?.active).toBe(1);
      expect(worker.getSchedulerSummary().pools["codex-cli"]?.active).toBe(1);
      cloudGate.resolve();
      codexGate.resolve();
      await worker.onIdle();
    } finally {
      stop();
      cloudGate.resolve();
      codexGate.resolve();
      await worker.onIdle();
      db.close();
    }

    const statuses = await readStatuses(workspace);
    expect(statuses).toEqual(["completed", "completed"]);
  });

  it("never exceeds a pool's configured concurrency", async () => {
    const workspace = createTempWorkspace();
    workspaces.push(workspace);
    const db = openWorkspaceDatabase(workspace);
    const repository = createSqliteIntelligenceJobRepository(db);
    const gate = deferred<void>();
    let active = 0;
    let maxActive = 0;

    const liteLlmClient: LiteLlmClient = {
      async generateStructured() {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await gate.promise;
        active -= 1;
        return { output: { greeting: "local" } };
      },
      async generateImage() {
        return { images: [] };
      },
    };
    const config = schedulerConfig({
      routes: buildDefaultRoutes({ localTextRoute: "local-text" }),
      scheduler: { pools: { "litellm-local": { concurrency: 2 } } },
    });

    for (let index = 0; index < 3; index += 1) {
      await submitIntelligenceRequest(repository, buildIntelligenceRequest({
        idempotencyKey: `bounded-local-${index}`,
      }));
    }

    const worker = new IntelligenceWorker(repository, liteLlmClient, config);
    const stop = worker.start();
    try {
      await waitFor(() => active === 2);
      expect(maxActive).toBe(2);
      expect((await repository.getOperationalSummary?.())?.queuedCount).toBe(1);
      gate.resolve();
      await waitFor(async () => (await repository.getOperationalSummary?.())?.queuedCount === 0);
      await worker.onIdle();
      expect(maxActive).toBe(2);
    } finally {
      stop();
      gate.resolve();
      await worker.onIdle();
      db.close();
    }
  });
});

function schedulerConfig(
  overrides: Partial<IntelligenceV01Config>,
): IntelligenceV01Config {
  return {
    routes: buildDefaultRoutes({ localTextRoute: "local-text" }),
    liteLlmBaseUrl: "http://127.0.0.1:1",
    maxRetries: 1,
    workerPollIntervalMs: 5,
    leaseDurationMs: 100,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for worker state.");
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

async function readStatuses(workspace: string): Promise<string[]> {
  const db = openWorkspaceDatabase(workspace);
  try {
    return (db.prepare("SELECT status FROM intelligence_jobs ORDER BY created_at, rowid").all() as Array<{ status: string }>).map(
      (row) => row.status,
    );
  } finally {
    db.close();
  }
}
