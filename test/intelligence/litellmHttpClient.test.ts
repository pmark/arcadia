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

  it("accepts a Rebuster-style content object without an outer result wrapper", async () => {
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

  it("rejects extra fields in an unwrapped Rebuster-style object", async () => {
    await expect(clientFor({ content: "ANSWER Wheelhouse", extra: true }).generateStructured(specRequest, "test-route"))
      .rejects.toThrow("did not match the output contract");
  });

  it("accepts schema-valid unwrapped string and array roots", async () => {
    const stringRequest = buildIntelligenceRequest({
      outputContract: { schemaId: "test.string-root.v1", schemaVersion: 1, jsonSchema: { type: "string" } },
    });
    const arrayRequest = buildIntelligenceRequest({
      outputContract: { schemaId: "test.array-root.v1", schemaVersion: 1, jsonSchema: { type: "array", items: { type: "string" } } },
    });
    expect((await clientFor("ANSWER Wheelhouse").generateStructured(stringRequest, "test-route")).output)
      .toBe("ANSWER Wheelhouse");
    expect((await clientFor(["ANSWER", "Wheelhouse"]).generateStructured(arrayRequest, "test-route")).output)
      .toEqual(["ANSWER", "Wheelhouse"]);
  });
});
