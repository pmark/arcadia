import { afterEach, describe, expect, it } from "vitest";
import { runIntelligenceListJobsCommand } from "../../src/commands/intelligence.js";
import { openDatabase } from "../../src/db/connection.js";
import { createSqliteIntelligenceJobRepository } from "../../src/intelligence/db/sqliteRepository.js";
import { submitIntelligenceRequest } from "../../src/intelligence/service/jobService.js";
import { buildIntelligenceRequest, createTempWorkspace, removeWorkspace } from "./testSupport.js";

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    removeWorkspace(workspace);
  }
});

describe("intelligence list-jobs command", () => {
  it("returns jobs filtered by clientApp via the CLI command layer", async () => {
    const workspace = createTempWorkspace();
    workspaces.push(workspace);

    const db = openDatabase(workspace);
    try {
      const repository = createSqliteIntelligenceJobRepository(db);
      await submitIntelligenceRequest(
        repository,
        buildIntelligenceRequest({ clientApp: "arcadia-admin", idempotencyKey: "idem-cli-1" }),
      );
      await submitIntelligenceRequest(
        repository,
        buildIntelligenceRequest({ clientApp: "someone-else", idempotencyKey: "idem-cli-2" }),
      );
    } finally {
      db.close();
    }

    const response = await runIntelligenceListJobsCommand({
      workspace,
      clientApp: "arcadia-admin",
    });

    expect(response.ok).toBe(true);
    expect(response.data.jobs).toHaveLength(1);
    expect(response.data.jobs[0]?.request.clientApp).toBe("arcadia-admin");
  });
});
