import type Database from "better-sqlite3";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { buildAdminIntelligenceRequest } from "../../apps/dashboard/lib/intelligence.js";
import { createSqliteIntelligenceArtifactStore } from "../../src/intelligence/artifacts/store.js";
import { createSqliteIntelligenceJobRepository } from "../../src/intelligence/db/sqliteRepository.js";
import { IntelligenceWorker } from "../../src/intelligence/jobs/worker.js";
import { createLiteLlmHttpClient } from "../../src/intelligence/litellm/httpClient.js";
import { submitIntelligenceRequest } from "../../src/intelligence/service/jobService.js";
import {
  closeServer,
  createTempWorkspace,
  openWorkspaceDatabase,
  removeWorkspace,
  startFakeLiteLlm,
  startFakeLiteLlmImages,
  testIntelligenceConfig,
} from "./testSupport.js";

const workspaces: string[] = [];
const databases: Database.Database[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => closeServer(server)));
  for (const db of databases.splice(0)) {
    db.close();
  }
  for (const workspace of workspaces.splice(0)) {
    removeWorkspace(workspace);
  }
});

/**
 * Proves the admin Intelligence test bench's request builder (used by
 * apps/dashboard/app/admin/intelligence) is not a parallel execution path:
 * a request it builds runs through the exact same submitIntelligenceRequest
 * + IntelligenceWorker pipeline a companion app uses, including route
 * resolution, output-schema validation, and (for images) artifact
 * persistence.
 */
describe("admin Intelligence test bench — real job pipeline", () => {
  it("completes a structured text request built by the admin bench", async () => {
    const workspace = createTempWorkspace();
    workspaces.push(workspace);
    const db = openWorkspaceDatabase(workspace);
    databases.push(db);
    const repository = createSqliteIntelligenceJobRepository(db);

    const { server, baseUrl } = await startFakeLiteLlm({
      content: { title: "Hello", summary: "A short summary." },
    });
    servers.push(server);

    const request = buildAdminIntelligenceRequest({
      capability: "text.generate",
      offeringId: "arcadia.text.generate.local.fast",
      execution: "local-required",
      profile: "fast",
      prompt: "Summarize Arcadia in one sentence.",
      outputMode: "structured",
      presetId: "simple-object",
      allowPaidUsage: false,
    });

    const { job: submitted, created } = await submitIntelligenceRequest(repository, request);
    expect(created).toBe(true);
    expect(submitted.request.clientApp).toBe("arcadia-admin");

    const worker = new IntelligenceWorker(
      repository,
      createLiteLlmHttpClient({ baseUrl }),
      testIntelligenceConfig(baseUrl),
    );
    const finished = await worker.runOnce();

    expect(finished?.status).toBe("completed");
    expect(finished?.validation?.passed).toBe(true);
    expect(finished?.result).toMatchObject({ title: "Hello", summary: "A short summary." });

    const recent = await repository.listRecentByClientApp("arcadia-admin", 10);
    expect(recent.map((job) => job.id)).toContain(submitted.id);
  });

  it("completes an image-generation request built by the admin bench and persists an artifact", async () => {
    const workspace = createTempWorkspace();
    workspaces.push(workspace);
    const db = openWorkspaceDatabase(workspace);
    databases.push(db);
    const repository = createSqliteIntelligenceJobRepository(db);
    const artifactStore = createSqliteIntelligenceArtifactStore(db, workspace);

    const { server, baseUrl } = await startFakeLiteLlmImages({});
    servers.push(server);

    const request = buildAdminIntelligenceRequest({
      capability: "image.generate",
      offeringId: "arcadia.image.generate.cloud.quality",
      execution: "cloud-required",
      profile: "quality",
      prompt: "a simple red circle on white",
      count: 1,
      allowPaidUsage: true,
    });

    const { job: submitted } = await submitIntelligenceRequest(repository, request);
    expect(submitted.request.executionPolicy.allowPaidUsage).toBe(true);

    const worker = new IntelligenceWorker(
      repository,
      createLiteLlmHttpClient({ baseUrl }),
      testIntelligenceConfig(baseUrl, {
        routes: testIntelligenceConfig(baseUrl).routes.concat([
          {
            id: "arcadia.image.generate.cloud.quality",
            capability: "image.generate",
            location: "cloud",
            profile: "quality",
            liteLlmRoute: "cloud-image",
            enabled: true,
            requiresPaidUsage: true,
          },
        ]),
      }),
      artifactStore,
    );
    const finished = await worker.runOnce();

    expect(finished?.status).toBe("completed");
    const result = finished?.result as { artifacts: Array<{ id: string; mimeType: string }> };
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]?.mimeType).toBe("image/png");

    const bytes = await artifactStore.getArtifactBytes(result.artifacts[0]!.id);
    expect(bytes).toBeDefined();
  });
});
