/**
 * Provider-neutral speech transport seam.
 *
 * A SpeechClient sends a normalized speech request to an OpenAI-compatible
 * `/v1/audio/speech` endpoint and returns the raw audio bytes it received. It
 * knows nothing about Arcadia semantic voice ids, MLX-Audio, Kokoro, LiteLLM,
 * artifact storage, or companion-app domains — the worker maps the semantic
 * voiceId to a provider voice, and persists/inspects the bytes. This mirrors
 * the litellm/client.ts LiteLlmClient seam, but for binary audio output.
 */

/** A normalized, provider-voice-resolved speech request (no Arcadia semantics). */
export type SpeechRequest = {
  /** The text to synthesize. */
  text: string;
  /** The concrete provider voice name (already mapped from the semantic voiceId). */
  voice: string;
  /** OpenAI `response_format`, e.g. "wav". */
  format: string;
  speed?: number;
  language?: string;
  instructions?: string;
};

/** Raw audio bytes plus safe provider metadata. Never a provider URL or credential. */
export type SpeechGenerationOutput = {
  bytes: Buffer;
  /** The provider's response Content-Type, e.g. "audio/wav". */
  contentType: string;
  provider: string;
  model?: string;
};

export interface SpeechClient {
  /**
   * Sends `request` to the resolved `route` (model/alias) at `baseUrl` and
   * returns the received audio bytes. Throws SpeechUnavailableError for
   * transport/availability problems (mapped to a "blocked" job) and
   * SpeechGenerationError for bad/invalid provider responses (mapped to a
   * "failed" job).
   */
  generateSpeech(
    request: SpeechRequest,
    route: string,
    baseUrl: string,
  ): Promise<SpeechGenerationOutput>;
}

/**
 * Thrown when the configured speech endpoint cannot be reached or returns a
 * transient/availability error (network failure, timeout, 5xx, 429). The worker
 * maps this to the "blocked" job status — a retryable, non-fatal condition.
 */
export class SpeechUnavailableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SpeechUnavailableError";
  }
}

/**
 * Thrown when the speech endpoint responds but the response is unusable: a 4xx
 * client error, a non-audio Content-Type, or an empty body. The worker maps
 * this to the "failed" job status — a deterministic failure that a blind retry
 * will not fix.
 */
export class SpeechGenerationError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SpeechGenerationError";
  }
}
