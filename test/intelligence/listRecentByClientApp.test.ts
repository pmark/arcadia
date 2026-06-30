import type Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteIntelligenceJobRepository } from "../../src/intelligence/db/sqliteRepository.js";
import { submitIntelligenceRequest } from "../../src/intelligence/service/jobService.js";
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

describe("listRecentByClientApp", () => {
  it("returns only jobs for the given clientApp, newest first", async () => {
    const workspace = createTempWorkspace();
    workspaces.push(workspace);
    const db = openWorkspaceDatabase(workspace);
    databases.push(db);
    const repository = createSqliteIntelligenceJobRepository(db);

    await submitIntelligenceRequest(
      repository,
      buildIntelligenceRequest({ clientApp: "other-app", idempotencyKey: "idem-other" }),
    );
    const { job: first } = await submitIntelligenceRequest(
      repository,
      buildIntelligenceRequest({ clientApp: "arcadia-admin", idempotencyKey: "idem-admin-1" }),
    );
    const { job: second } = await submitIntelligenceRequest(
      repository,
      buildIntelligenceRequest({ clientApp: "arcadia-admin", idempotencyKey: "idem-admin-2" }),
    );

    const jobs = await repository.listRecentByClientApp("arcadia-admin", 20);

    expect(jobs.map((job) => job.id)).toEqual([second.id, first.id]);
    expect(jobs.every((job) => job.request.clientApp === "arcadia-admin")).toBe(true);
  });

  it("respects the limit", async () => {
    const workspace = createTempWorkspace();
    workspaces.push(workspace);
    const db = openWorkspaceDatabase(workspace);
    databases.push(db);
    const repository = createSqliteIntelligenceJobRepository(db);

    for (let i = 0; i < 5; i += 1) {
      await submitIntelligenceRequest(
        repository,
        buildIntelligenceRequest({ clientApp: "arcadia-admin", idempotencyKey: `idem-${i}` }),
      );
    }

    const jobs = await repository.listRecentByClientApp("arcadia-admin", 2);
    expect(jobs).toHaveLength(2);
  });
});
