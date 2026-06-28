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
}
