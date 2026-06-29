import type Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteIntelligenceJobRepository } from "../../src/intelligence/db/sqliteRepository.js";
import {
  RetryNotAllowedError,
  retryIntelligenceJob,
  submitIntelligenceRequest,
} from "../../src/intelligence/service/jobService.js";
import type { IntelligenceJobStatus } from "../../src/intelligence/types.js";
import {
  buildIntelligenceRequest,
  createTempWorkspace,
  openWorkspaceDatabase,
  removeWorkspace,
} from "./testSupport.js";

const workspaces: string[] = [];
const databases: Database.Database[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) {
    db.close();
  }
  for (const workspace of workspaces.splice(0)) {
    removeWorkspace(workspace);
  }
});

function setupRepository() {
  const workspace = createTempWorkspace();
  workspaces.push(workspace);
  const db = openWorkspaceDatabase(workspace);
  databases.push(db);
  return createSqliteIntelligenceJobRepository(db);
}

describe("Arcadia Intelligence v0.1 contracts", () => {
  it("submit creates one queued job", async () => {
    const repository = setupRepository();
    const request = buildIntelligenceRequest();

    const response = await submitIntelligenceRequest(repository, request);

    expect(response.created).toBe(true);
    expect(response.job.status).toBe("queued");
    expect(response.job.retryCount).toBe(0);
    expect(response.job.request).toEqual(request);
  });

  it("duplicate idempotency key returns the same job", async () => {
    const repository = setupRepository();
    const request = buildIntelligenceRequest({ idempotencyKey: "fixed-key-1" });

    const first = await submitIntelligenceRequest(repository, request);
    const second = await submitIntelligenceRequest(repository, request);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
  });

  it("accepts arbitrary app-defined capability names and JSON input without interpreting them", async () => {
    const repository = setupRepository();
    const request = buildIntelligenceRequest({
      capabilityId: "totally-unrelated-app.some-other-capability.v7",
      clientApp: "totally-unrelated-app",
      input: { nested: { whatever: [1, 2, { ok: true }] }, freeform: "anything" },
    });

    const response = await submitIntelligenceRequest(repository, request);

    expect(response.job.request.capabilityId).toBe(
      "totally-unrelated-app.some-other-capability.v7",
    );
    expect(response.job.request.input).toEqual(request.input);
  });

  it("keeps the five status values stable", async () => {
    const repository = setupRepository();
    const request = buildIntelligenceRequest();
    const { job } = await submitIntelligenceRequest(repository, request);

    const statuses: IntelligenceJobStatus[] = [
      "queued",
      "running",
      "completed",
      "failed",
      "blocked",
    ];
    expect(statuses).toContain(job.status);
  });

  it("execution policy defaults reject paid fallback", async () => {
    const repository = setupRepository();
    const request = buildIntelligenceRequest();

    expect(request.executionPolicy.allowPaidUsage).toBe(false);

    const { job } = await submitIntelligenceRequest(repository, request);
    expect(job.request.executionPolicy.allowPaidUsage).toBe(false);
  });

  it("rejects retrying a job that is not failed or blocked", async () => {
    const repository = setupRepository();
    const request = buildIntelligenceRequest();
    const { job } = await submitIntelligenceRequest(repository, request);

    await expect(retryIntelligenceJob(repository, job.id, 1)).rejects.toThrow(
      RetryNotAllowedError,
    );
  });
});
