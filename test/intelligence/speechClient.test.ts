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

describe("speech generation client", () => {
  it("submits an audio.speech.generate job and returns the parsed speech result", async () => {
    let submitted: IntelligenceRequest | undefined;
    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (init?.method === "POST") {
        submitted = JSON.parse(String(init.body)) as IntelligenceRequest;
        return jsonResponse({ created: true, job: { id: "job-speech-1", status: "queued" } }, 201);
      }
      if (url.pathname.endsWith("/job-speech-1")) {
        return jsonResponse({
          id: "job-speech-1",
          status: "completed",
          result: {
            artifact: {
              id: "iart_abc",
              kind: "audio",
              uri: "/api/intelligence/artifacts/iart_abc",
              mimeType: "audio/wav",
              format: "wav",
              sha256: "deadbeef",
              byteSize: 1234,
              durationSeconds: 1.5,
            },
            voiceId: "arcadia.narrator",
            routeId: "arcadia.audio.speech.generate.local.standard",
            provider: "openai-compatible",
          },
        });
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    }) as typeof fetch;

    const client = new ArcadiaIntelligenceClient({ baseUrl: "http://arcadia.test", fetchImpl });
    const operation = client.audio.defineSpeechOperation<
      { text: string; voiceId: string; format: string },
      { artifact: { id: string; durationSeconds: number }; voiceId: string }
    >({
      operationId: "rebuster.generate-narration",
      clientApp: "rebuster",
      profile: "standard",
      template: { id: "prompts/narration.md", version: "1" },
      outputContract: {
        schemaId: "rebuster.narration.v1",
        schemaVersion: 1,
        jsonSchema: { type: "object" },
      },
    });

    const { result, jobId } = await operation.run(
      { text: "Can you solve this rebus?", voiceId: "arcadia.narrator", format: "wav" },
      { idempotencyKey: "narration-1", execution: "local" },
    );

    expect(jobId).toBe("job-speech-1");
    expect(result.artifact.id).toBe("iart_abc");
    expect(result.artifact.durationSeconds).toBe(1.5);
    expect(result.voiceId).toBe("arcadia.narrator");

    // The public op resolves the semantic capability + execution preference for
    // the caller — they never name a provider, model, or route.
    expect(submitted?.capability).toBe("audio.speech.generate");
    expect(submitted?.execution).toBe("local-required");
    expect(submitted?.executionTarget).toBe("local");
    expect((submitted?.input as { voiceId: string }).voiceId).toBe("arcadia.narrator");
  });

  it("refuses cloud speech execution without allowPaidUsage", async () => {
    const client = new ArcadiaIntelligenceClient({
      baseUrl: "http://arcadia.test",
      fetchImpl: (async () => {
        throw new Error("should not be called");
      }) as typeof fetch,
    });
    const operation = client.audio.defineSpeechOperation<{ text: string; voiceId: string }, unknown>({
      operationId: "rebuster.generate-narration",
      clientApp: "rebuster",
      profile: "standard",
      template: { id: "prompts/narration.md", version: "1" },
      outputContract: { schemaId: "rebuster.narration.v1", schemaVersion: 1, jsonSchema: { type: "object" } },
    });

    await expect(
      operation.run(
        { text: "hello", voiceId: "arcadia.narrator" },
        { idempotencyKey: "narration-cloud-1", execution: "cloud" },
      ),
    ).rejects.toThrow(ArcadiaExecutionPolicyError);
  });
});
