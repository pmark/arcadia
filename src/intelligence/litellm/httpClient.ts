import type { IntelligenceRequest, IntelligenceUsage, JsonValue } from "../types.js";
import type { LiteLlmClient, LiteLlmExecutionResult } from "./client.js";

/**
 * Thrown when the configured LiteLLM proxy cannot be reached or returns an
 * error response. The worker maps this to the "blocked" job status.
 */
export class LiteLlmUnavailableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "LiteLlmUnavailableError";
  }
}

export interface LiteLlmHttpClientOptions {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface LiteLlmChatCompletionResponse {
  model?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Generic LiteLLM transport over the OpenAI-compatible chat completions
 * endpoint. This module has no knowledge of companion-app domains and does
 * not depend on any provider SDK; LiteLLM owns provider routing and
 * credentials.
 */
export function createLiteLlmHttpClient(options: LiteLlmHttpClientOptions): LiteLlmClient {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 60_000;

  return {
    async generateStructured(
      request: IntelligenceRequest,
      route: string,
    ): Promise<LiteLlmExecutionResult> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: route,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content:
                  "Respond with a single JSON object only, matching the provided JSON Schema. " +
                  "Do not include explanations, markdown, or code fences.",
              },
              {
                role: "user",
                content: JSON.stringify({
                  input: request.input,
                  jsonSchema: request.outputContract.jsonSchema,
                }),
              },
            ],
          }),
          signal: controller.signal,
        });
      } catch (error) {
        throw new LiteLlmUnavailableError(
          `Arcadia Intelligence could not reach the configured LiteLLM route "${route}" at ${baseUrl}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new LiteLlmUnavailableError(
          `LiteLLM route "${route}" responded with ${response.status} ${response.statusText}. ${text}`.trim(),
        );
      }

      const body = (await response.json()) as LiteLlmChatCompletionResponse;
      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new Error("LiteLLM response did not include message content.");
      }

      let output: JsonValue;
      try {
        output = JSON.parse(content) as JsonValue;
      } catch {
        throw new Error("LiteLLM response content was not valid JSON.");
      }

      const usage: IntelligenceUsage | undefined = body.usage
        ? {
            model: body.model,
            inputTokens: body.usage.prompt_tokens,
            outputTokens: body.usage.completion_tokens,
          }
        : undefined;

      return { output, usage };
    },
  };
}
