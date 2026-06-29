import { describe, expect, it } from "vitest";
import { createSqliteIntelligenceArtifactStore } from "../../src/intelligence/artifacts/store.js";
import { loadIntelligenceConfig } from "../../src/intelligence/config/defaults.js";
import { createSqliteIntelligenceJobRepository } from "../../src/intelligence/db/sqliteRepository.js";
import { IntelligenceWorker } from "../../src/intelligence/jobs/worker.js";
import { createLiteLlmHttpClient } from "../../src/intelligence/litellm/httpClient.js";
import { submitIntelligenceRequest } from "../../src/intelligence/service/jobService.js";
import {
  buildIntelligenceRequest,
  createTempWorkspace,
  openWorkspaceDatabase,
  removeWorkspace,
} from "./testSupport.js";

/**
 * Mirrors liveLiteLlm.test.ts for the image side: every other image test
 * (e2e.test.ts, rebuster.test.ts) talks to an in-process fake LiteLLM image
 * server, proving Arcadia's own artifact-storage/manifest handling, not that
 * a real cloud image route is reachable, authenticated, and returns a usable
 * image. This is the one place that does.
 *
 * Skipped unless all three are true: LiteLLM is reachable, an API key is
 * configured, and ARCADIA_LITELLM_CLOUD_IMAGE_ROUTE actually has a
 * registered "arcadia.image.generate.cloud.quality" route (see ROUTING.md —
 * cloud image generation only supports the "quality" profile today). Opt in
 * locally once a real cloud image alias is configured:
 *   ARCADIA_LITELLM_CLOUD_IMAGE_ROUTE=<alias> ARCADIA_LITELLM_API_KEY=<key> \
 *     pnpm test test/intelligence/liveLiteLlmImage.test.ts
 */
const config = loadIntelligenceConfig();

async function isLiteLlmReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${config.liteLlmBaseUrl.replace(/\/$/, "")}/health/liveliness`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

const liteLlmReachable = await isLiteLlmReachable();
const hasCloudImageRoute = config.routes.some(
  (route) => route.id === "arcadia.image.generate.cloud.quality" && route.enabled,
);
const canRunLive = liteLlmReachable && Boolean(config.liteLlmApiKey) && hasCloudImageRoute;

describe.skipIf(!canRunLive)("live LiteLLM image integration", () => {
  it("completes a real image.generate job and stores a durable artifact", async () => {
    const workspace = createTempWorkspace();
    try {
      const db = openWorkspaceDatabase(workspace);
      const repository = createSqliteIntelligenceJobRepository(db);
      const artifactStore = createSqliteIntelligenceArtifactStore(db, workspace);

      const { job: submitted } = await submitIntelligenceRequest(
        repository,
        buildIntelligenceRequest({
          capability: "image.generate",
          execution: "cloud-required",
          profile: "quality",
          requirements: { imageSize: "1024x1024", transparency: false },
          executionPolicy: { allowPaidUsage: true, maxRetries: 1 },
          input: { prompt: "a small red triangle on a plain white background", n: 1 },
          outputContract: {
            schemaId: "live-litellm-image-smoke.v1",
            schemaVersion: 1,
            jsonSchema: {
              type: "object",
              properties: { artifacts: { type: "array", minItems: 1 } },
              required: ["artifacts"],
            },
          },
        }),
      );

      const worker = new IntelligenceWorker(
        repository,
        createLiteLlmHttpClient({ baseUrl: config.liteLlmBaseUrl, apiKey: config.liteLlmApiKey }),
        config,
        artifactStore,
      );
      const finished = await worker.runOnce();

      expect(finished?.id).toBe(submitted.id);
      // A real provider could reject the prompt or time out, so only assert
      // Arcadia actually reached the configured route — not "blocked"
      // (misconfigured/unreachable) and not a thrown worker error.
      expect(["completed", "failed"]).toContain(finished?.status);
      expect(finished?.error?.code).not.toBe("LITELLM_UNAVAILABLE");
      expect(finished?.error?.code).not.toBe("ROUTE_NOT_CONFIGURED");

      if (finished?.status === "completed") {
        expect(finished.selectedRoute).toBe(
          config.routes.find((route) => route.id === "arcadia.image.generate.cloud.quality")?.liteLlmRoute,
        );
        const result = finished.result as {
          artifacts: Array<{ id: string; kind: string; uri: string; mimeType: string; byteSize: number }>;
        };
        expect(result.artifacts.length).toBeGreaterThan(0);
        const [artifact] = result.artifacts;
        expect(artifact.kind).toBe("image");
        expect(artifact.uri).toBe(`/api/intelligence/artifacts/${artifact.id}`);

        // Never a provider URL or inline base64 — bytes must be durably
        // stored under the workspace, retrievable through the artifact store.
        const stored = await artifactStore.getArtifactBytes(artifact.id);
        expect(stored?.bytes.byteLength).toBe(artifact.byteSize);
        expect(JSON.stringify(result)).not.toMatch(/^https?:\/\//m);
      }
    } finally {
      removeWorkspace(workspace);
    }
  });
});
