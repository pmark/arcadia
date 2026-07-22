import { afterEach, describe, expect, it } from "vitest";
import { IntelligenceJobLeaseLostError } from "../../src/intelligence/db/repository.js";
import { createSqliteIntelligenceJobRepository } from "../../src/intelligence/db/sqliteRepository.js";
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

describe("durable Intelligence job leases", () => {
  it("renews a live lease so another worker cannot reclaim it", async () => {
    const { repository, close } = setup();
    try {
      await submitIntelligenceRequest(repository, buildIntelligenceRequest());
      const first = await repository.claimNextQueuedJob("worker-a", iso(0), 100);
      expect(first).toBeDefined();
      expect(await repository.renewJobLease(first!.job.id, first!.lease, iso(80), 100)).toBe(true);
      expect(await repository.claimNextQueuedJob("worker-b", iso(120), 100)).toBeUndefined();
    } finally {
      close();
    }
  });

  it("fences a stale attempt after the job is reclaimed", async () => {
    const { repository, close } = setup();
    try {
      await submitIntelligenceRequest(repository, buildIntelligenceRequest());
      const first = await repository.claimNextQueuedJob("worker-a", iso(0), 100);
      const second = await repository.claimNextQueuedJob("worker-b", iso(101), 100);
      expect(first).toBeDefined();
      expect(second).toBeDefined();

      await expect(repository.completeJob(first!.job.id, completion("stale"), first!.lease))
        .rejects.toBeInstanceOf(IntelligenceJobLeaseLostError);
      const completed = await repository.completeJob(
        second!.job.id,
        completion("winner"),
        second!.lease,
      );
      expect(completed.status).toBe("completed");
      expect(completed.result).toEqual({ greeting: "winner" });
    } finally {
      close();
    }
  });
});

function setup() {
  const workspace = createTempWorkspace();
  workspaces.push(workspace);
  const db = openWorkspaceDatabase(workspace);
  return {
    repository: createSqliteIntelligenceJobRepository(db),
    close: () => db.close(),
  };
}

function iso(offsetMs: number): string {
  return new Date(Date.UTC(2026, 0, 1) + offsetMs).toISOString();
}

function completion(greeting: string) {
  return {
    result: { greeting },
    validation: { passed: true },
    usage: {},
    selectedRoute: "test-route",
    completedAt: iso(500),
  };
}
