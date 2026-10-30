import { describe, expect, it } from "vitest";
import { createLiteLlmHttpClient } from "../../src/intelligence/litellm/httpClient.js";
import { buildIntelligenceRequest } from "./testSupport.js";

function clientFor(content: unknown) {
  const fetchImpl = async () => new Response(JSON.stringify({
    model: "test-route",
    choices: [{ message: { content: JSON.stringify(content) } }],
  }), { status: 200, headers: { "content-type": "application/json" } });
  return createLiteLlmHttpClient({ baseUrl: "http://localhost", fetchImpl });
}

describe("LiteLLM structured response", () => {
  const request = buildIntelligenceRequest();

  it("accepts a Rebuster-style content object without an outer result wrapper", async () => {
    const specRequest = buildIntelligenceRequest({
      outputContract: {
        schemaId: "rebuster.rebus-spec.v1",
        schemaVersion: 2,
        jsonSchema: {
          type: "object",
          properties: { content: { type: "string" } },
          required: ["content"],
          additionalProperties: false,
        },
      },
    });
    const response = await clientFor({ content: "ANSWER Wheelhouse" }).generateStructured(specRequest, "test-route");
    expect(response.output).toEqual({ content: "ANSWER Wheelhouse" });
  });

  it("continues to unwrap result", async () => {
    const response = await clientFor({ result: { greeting: "Hello" } }).generateStructured(request, "test-route");
    expect(response.output).toEqual({ greeting: "Hello" });
  });

  it("rejects unwrapped content outside the requested schema", async () => {
    await expect(clientFor({ greeting: 123 }).generateStructured(request, "test-route"))
      .rejects.toThrow("did not match the output contract");
  });
});
