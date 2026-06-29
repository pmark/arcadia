import type { IntelligenceRequest, IntelligenceUsage, JsonValue } from "../types.js";
import type {
  GeneratedImage,
  LiteLlmClient,
  LiteLlmExecutionResult,
  LiteLlmImageGenerationResult,
} from "./client.js";

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

interface LiteLlmImageGenerationResponse {
  data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string; seed?: number }>;
}

/**
 * Generic LiteLLM transport over the OpenAI-compatible chat completions and
 * image generation endpoints. This module has no knowledge of companion-app
 * domains and does not depend on any provider SDK; LiteLLM owns provider
 * routing and credentials.
 */
export function createLiteLlmHttpClient(options: LiteLlmHttpClientOptions): LiteLlmClient {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 60_000;

  async function postJson(path: string, route: string, body: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
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

    return response.json();
  }

  async function downloadImageBytes(url: string): Promise<Buffer> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { signal: controller.signal });
      if (!response.ok) {
        throw new LiteLlmUnavailableError(
          `Could not download generated image (${response.status} ${response.statusText}).`,
        );
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (error instanceof LiteLlmUnavailableError) {
        throw error;
      }
      throw new LiteLlmUnavailableError(
        `Could not download generated image: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    async generateStructured(
      request: IntelligenceRequest,
      route: string,
    ): Promise<LiteLlmExecutionResult> {
      const body = await postJson("/chat/completions", route, {
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
      }) as LiteLlmChatCompletionResponse;

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

    async generateImage(
      request: IntelligenceRequest,
      route: string,
    ): Promise<LiteLlmImageGenerationResult> {
      const input = request.input as Record<string, unknown> | null;
      const prompt = input && typeof input.prompt === "string" ? input.prompt.trim() : "";
      if (!prompt) {
        throw new Error('Image generation requires a non-empty string "prompt" in input.');
      }
      const n = typeof input?.n === "number" && Number.isInteger(input.n) ? input.n : undefined;
      const size = typeof input?.size === "string" ? input.size : undefined;

      const body = (await postJson("/images/generations", route, {
        model: route,
        prompt,
        response_format: "b64_json",
        ...(n ? { n } : {}),
        ...(size ? { size } : {}),
      })) as LiteLlmImageGenerationResponse;

      const entries = body.data ?? [];
      const images: GeneratedImage[] = [];
      for (const entry of entries) {
        const bytes = entry.b64_json
          ? Buffer.from(entry.b64_json, "base64")
          : entry.url
            ? await downloadImageBytes(entry.url)
            : undefined;
        if (!bytes) {
          continue;
        }
        images.push({ bytes, seed: entry.seed, revisedPrompt: entry.revised_prompt });
      }

      if (images.length === 0) {
        throw new Error("LiteLLM image generation response did not include any image data.");
      }

      return { images };
    },
  };
}
