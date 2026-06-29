import { describe, expect, it } from "vitest";
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
 * Every other intelligence test talks to an in-process fake LiteLLM server
 * (see startFakeLiteLlm in testSupport.ts) — they prove Arcadia's own
 * request/response handling, not that the real LiteLLM proxy is reachable,
 * authenticated correctly, and returns a usable chat-completion. This test
 * is the one place that does. It is skipped unless a real LiteLLM is
 * actually reachable, so `pnpm test` stays hermetic in CI/sandboxes with no
 * proxy running — opt in locally by having LiteLLM up at the configured
 * ARCADIA_LITELLM_BASE_URL (default http://127.0.0.1:4000) before running
 * `pnpm test test/intelligence/liveLiteLlm.test.ts`.
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
// Reachability alone isn't enough to exercise the real path: an
// unauthenticated request to a key-protected LiteLLM proxy comes back as a
// "blocked" job (LITELLM_UNAVAILABLE-shaped 401), not a meaningful pass/fail
// of the integration this test targets. Require an explicit key too.
const canRunLive = liteLlmReachable && Boolean(config.liteLlmApiKey);

describe.skipIf(!canRunLive)("live LiteLLM integration", () => {
  it("completes a real text.generate job through the configured local route", async () => {
    const workspace = createTempWorkspace();
    try {
      const db = openWorkspaceDatabase(workspace);
      const repository = createSqliteIntelligenceJobRepository(db);

      const { job: submitted } = await submitIntelligenceRequest(
        repository,
        buildIntelligenceRequest({
          execution: "local-required",
          profile: "standard",
          input: { instruction: 'Respond with exactly the JSON object {"acknowledged": true}.' },
          outputContract: {
            schemaId: "live-litellm-smoke.v1",
            schemaVersion: 1,
            jsonSchema: {
              type: "object",
              properties: { acknowledged: { type: "boolean" } },
              required: ["acknowledged"],
            },
          },
        }),
      );

      const worker = new IntelligenceWorker(
        repository,
        createLiteLlmHttpClient({ baseUrl: config.liteLlmBaseUrl, apiKey: config.liteLlmApiKey }),
        config,
      );
      const finished = await worker.runOnce();

      expect(finished?.id).toBe(submitted.id);
      // A real model may not follow the instruction exactly, so only assert
      // that Arcadia actually reached LiteLLM and got a parseable response —
      // not "blocked" (unreachable/misconfigured) and not a thrown error.
      expect(["completed", "failed"]).toContain(finished?.status);
      expect(finished?.error?.code).not.toBe("LITELLM_UNAVAILABLE");
      if (finished?.status === "completed") {
        expect(finished.usage?.modelRoute).toBe(
          config.routes.find((route) => route.id === "arcadia.text.generate.local.standard")?.liteLlmRoute,
        );
      }
    } finally {
      removeWorkspace(workspace);
    }
  });
});
