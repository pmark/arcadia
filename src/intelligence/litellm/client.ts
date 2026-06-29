import type {
  IntelligenceRequest,
  IntelligenceUsage,
  JsonValue,
} from "../types.js";

export type LiteLlmExecutionResult = {
  output: JsonValue;
  usage?: IntelligenceUsage;
};

/**
 * One generated image's raw bytes plus whatever safe, non-credential
 * metadata the provider returned. Never a provider URL — by the time this
 * leaves the LiteLLM client, the bytes have already been fetched or decoded.
 */
export type GeneratedImage = {
  bytes: Buffer;
  seed?: number;
  revisedPrompt?: string;
};

export type LiteLlmImageGenerationResult = {
  images: GeneratedImage[];
  usage?: IntelligenceUsage;
};

/**
 * Generic LiteLLM transport seam.
 *
 * This module must not know about companion-app domains, individual providers,
 * or provider SDKs. It should call the configured LiteLLM localhost endpoint.
 */
export interface LiteLlmClient {
  generateStructured(
    request: IntelligenceRequest,
    route: string,
  ): Promise<LiteLlmExecutionResult>;

  generateImage(
    request: IntelligenceRequest,
    route: string,
  ): Promise<LiteLlmImageGenerationResult>;
}
