import { afterEach, describe, expect, it } from "vitest";
import { runIntelligenceListJobsCommand, runIntelligenceUsageCommand } from "../../src/commands/intelligence.js";
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

  it("aggregates current-day recorded usage without inventing provider quota", async () => {
    const workspace = createTempWorkspace();
    workspaces.push(workspace);
    const priorCodexHome = process.env.ARCADIA_CODEX_HOME;
    process.env.ARCADIA_CODEX_HOME = `${workspace}/no-codex-state`;

    try {
      const db = openDatabase(workspace);
      try {
        const repository = createSqliteIntelligenceJobRepository(db);
        const completed = await submitIntelligenceRequest(
          repository,
          buildIntelligenceRequest({ idempotencyKey: "idem-usage-completed" }),
        );
        await repository.completeJob(completed.job.id, {
          result: { greeting: "hello" },
          validation: { passed: true },
          usage: {
            provider: "fake-lab",
            inputTokens: 120,
            outputTokens: 45,
            estimatedCostUsd: 0.012,
            measuredCostUsd: 0.01,
            durationMs: 250,
          },
          selectedRoute: "arcadia.text.generate.local.standard",
          completedAt: new Date().toISOString(),
        });
        await submitIntelligenceRequest(
          repository,
          buildIntelligenceRequest({ idempotencyKey: "idem-usage-queued" }),
        );
      } finally {
        db.close();
      }

      const response = await runIntelligenceUsageCommand({ workspace });

      expect(response.ok).toBe(true);
      expect(response.data.summary.jobs).toMatchObject({
        total: 2,
        completed: 1,
        queued: 1,
        withReportedUsage: 1,
        withoutReportedUsage: 1,
      });
      expect(response.data.summary.usage).toMatchObject({
        inputTokens: 120,
        outputTokens: 45,
        estimatedCostUsd: 0.012,
        measuredCostUsd: 0.01,
        durationMs: 250,
      });
      expect(response.data.summary.providers).toContainEqual(expect.objectContaining({
        provider: "fake-lab",
        jobs: 1,
        inputTokens: 120,
        outputTokens: 45,
      }));
      expect(response.data.summary.codingAgents).toEqual(expect.arrayContaining([
        expect.objectContaining({
          provider: "Codex",
          availability: "unknown",
          remainingTokens: null,
          resetAt: null,
        }),
      ]));
    } finally {
      if (priorCodexHome === undefined) {
        delete process.env.ARCADIA_CODEX_HOME;
      } else {
        process.env.ARCADIA_CODEX_HOME = priorCodexHome;
      }
    }
  });
});
