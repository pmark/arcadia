/**
 * Public Arcadia Intelligence contracts surface.
 *
 * This is the only contracts entry point companion apps (e.g. Rebuster) should
 * import. It re-exports the generic, domain-neutral request/job/result types
 * from the internal contracts module without exposing the internal file path.
 */
export type {
  ExecutionPolicy,
  IntelligenceJob,
  IntelligenceJobStatus,
  IntelligenceRequest,
  IntelligenceUsage,
  JsonPrimitive,
  JsonValue,
  OutputContract,
  PromptTemplateRef,
  RetryIntelligenceJobResponse,
  SubmitIntelligenceRequestResponse,
  ValidationResult,
} from "./types.js";
