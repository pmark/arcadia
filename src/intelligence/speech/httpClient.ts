import {
  SpeechGenerationError,
  SpeechUnavailableError,
  type SpeechClient,
  type SpeechGenerationOutput,
  type SpeechRequest,
} from "./client.js";

/**
 * OpenAI-compatible speech transport over the `/v1/audio/speech` endpoint.
 *
 * This is provider-neutral: it works against a local MLX-Audio/Kokoro server or
 * a LiteLLM proxy alike, since both speak the OpenAI audio-speech contract
 * (`{ model, input, voice, response_format, speed }` -> raw audio bytes). It has
 * no provider SDK dependency and no companion-app domain knowledge.
 *
 * Unlike image generation (which returns JSON with base64/URLs),
 * `/v1/audio/speech` returns the audio bytes directly with an audio
 * Content-Type, so this reads the response body as an ArrayBuffer and validates
 * the Content-Type before handing bytes back.
 */
export interface OpenAiSpeechClientOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Bounded transport retries for transient failures (network/timeout/5xx/429). */
  maxRetries?: number;
  /** Provider label recorded in usage/result metadata. */
  provider?: string;
  /** Endpoint path appended to the base URL. Defaults to "/v1/audio/speech". */
  speechPath?: string;
}

const AUDIO_CONTENT_TYPE = /^audio\//i;

export function createOpenAiSpeechClient(options: OpenAiSpeechClientOptions = {}): SpeechClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const maxRetries = Math.max(0, options.maxRetries ?? 1);
  const provider = options.provider ?? "openai-compatible";
  const speechPath = options.speechPath ?? "/v1/audio/speech";

  async function attempt(
    url: string,
    request: SpeechRequest,
    route: string,
  ): Promise<SpeechGenerationOutput> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: route,
          input: request.text,
          voice: request.voice,
          response_format: request.format,
          ...(request.speed !== undefined ? { speed: request.speed } : {}),
          ...(request.language !== undefined ? { language: request.language } : {}),
          ...(request.instructions !== undefined ? { instructions: request.instructions } : {}),
        }),
        signal: controller.signal,
      });
    } catch (error) {
      // Network failure or timeout — transient/availability, retryable.
      throw new SpeechUnavailableError(
        `Arcadia Intelligence could not reach the speech route "${route}" at ${url}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      if (response.status >= 500 || response.status === 429) {
        // Server-side/transient — retryable, maps to "blocked".
        throw new SpeechUnavailableError(
          `Speech route "${route}" responded with ${response.status} ${response.statusText}. ${text}`.trim(),
        );
      }
      // 4xx — deterministic client error (e.g. unknown provider voice, bad
      // model). A blind retry will not fix it; maps to "failed".
      throw new SpeechGenerationError(
        "SPEECH_PROVIDER_REJECTED",
        `Speech route "${route}" rejected the request with ${response.status} ${response.statusText}. ${text}`.trim(),
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    const bytes = Buffer.from(await response.arrayBuffer());

    if (!AUDIO_CONTENT_TYPE.test(contentType)) {
      throw new SpeechGenerationError(
        "SPEECH_INVALID_CONTENT_TYPE",
        `Speech route "${route}" returned a non-audio Content-Type "${contentType || "(none)"}". ` +
          "Arcadia expects raw audio bytes from /v1/audio/speech.",
      );
    }
    if (bytes.byteLength === 0) {
      throw new SpeechGenerationError(
        "SPEECH_EMPTY_RESPONSE",
        `Speech route "${route}" returned an empty audio body.`,
      );
    }

    return { bytes, contentType, provider, model: route };
  }

  return {
    async generateSpeech(
      request: SpeechRequest,
      route: string,
      baseUrl: string,
    ): Promise<SpeechGenerationOutput> {
      const url = `${baseUrl.replace(/\/$/, "")}${speechPath}`;
      let lastError: unknown;
      // 1 initial try + up to `maxRetries` retries, but only transient
      // (SpeechUnavailableError) failures are retried. Deterministic failures
      // (SpeechGenerationError) fail fast.
      for (let attemptNo = 0; attemptNo <= maxRetries; attemptNo += 1) {
        try {
          return await attempt(url, request, route);
        } catch (error) {
          if (error instanceof SpeechGenerationError) {
            throw error;
          }
          lastError = error;
        }
      }
      throw lastError instanceof Error
        ? lastError
        : new SpeechUnavailableError(String(lastError));
    },
  };
}
