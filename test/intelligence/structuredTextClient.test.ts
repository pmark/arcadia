import { describe, expect, it } from "vitest";
import {
  ArcadiaExecutionPolicyError,
  ArcadiaIntelligenceClient,
} from "../../src/intelligence/client/client.js";
import type { IntelligenceRequest } from "../../src/intelligence/types.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("structured text client", () => {
  it("runs a typed Codex operation through submit and wait", async () => {
    let submitted: IntelligenceRequest | undefined;
    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (init?.method === "POST") {
        submitted = JSON.parse(String(init.body)) as IntelligenceRequest;
        return jsonResponse({
          created: true,
          job: { id: "job-1", status: "queued" },
        }, 201);
      }
      if (url.pathname.endsWith("/job-1")) {
        return jsonResponse({
          id: "job-1",
          status: "completed",
          result: { candidates: ["Toe Truck"] },
        });
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    }) as typeof fetch;
    const client = new ArcadiaIntelligenceClient({
      baseUrl: "http://arcadia.test",
      fetchImpl,
    });
    const operation = client.text.defineStructuredOperation<
      { topic: string; count: number },
      { candidates: string[] }
    >({
      operationId: "rebuster.generate-idea-candidates",
      clientApp: "rebuster",
      profile: "fast",
      template: { id: "prompts/idea-candidates.md", version: "1" },
      outputContract: {
        schemaId: "rebuster.idea-candidates.v1",
        schemaVersion: 1,
        jsonSchema: { type: "object" },
      },
    });

    const result = await operation.run(
      { topic: "vehicles", count: 1 },
      { idempotencyKey: "ideas-1", execution: "codex" },
    );

    expect(result).toEqual({
      jobId: "job-1",
      result: { candidates: ["Toe Truck"] },
    });
    expect(submitted).toMatchObject({
      execution: "local-required",
      executionTarget: "codex",
      executionPolicy: { allowPaidUsage: false, maxRetries: 1 },
    });
  });

  it("requires explicit paid-usage authorization for cloud execution", async () => {
    const client = new ArcadiaIntelligenceClient({
      baseUrl: "http://arcadia.test",
      fetchImpl: (() => {
        throw new Error("fetch should not be called");
      }) as typeof fetch,
    });
    const operation = client.text.defineStructuredOperation<
      { prompt: string },
      { value: string }
    >({
      operationId: "test.generate",
      clientApp: "test",
      profile: "fast",
      template: { id: "test", version: "1" },
      outputContract: {
        schemaId: "test.v1",
        schemaVersion: 1,
        jsonSchema: { type: "object" },
      },
    });

    await expect(operation.run(
      { prompt: "hello" },
      { idempotencyKey: "cloud-1", execution: "cloud" },
    )).rejects.toBeInstanceOf(ArcadiaExecutionPolicyError);
  });

  it("reports configured execution targets without exposing route aliases", async () => {
    const fetchImpl = (async () => jsonResponse({
      liteLlm: {
        routes: [
          {
            capability: "text.generate",
            location: "local",
            profile: "fast",
            executor: "litellm",
          },
          {
            capability: "text.generate",
            location: "local",
            profile: "fast",
            executor: "codex-cli",
          },
          {
            capability: "text.generate",
            location: "cloud",
            profile: "fast",
            executor: "litellm",
          },
        ],
      },
    })) as typeof fetch;
    const client = new ArcadiaIntelligenceClient({
      baseUrl: "http://arcadia.test",
      fetchImpl,
    });

    await expect(
      client.availableExecutions("text.generate", "fast"),
    ).resolves.toEqual(["local", "cloud", "codex"]);
  });
});
