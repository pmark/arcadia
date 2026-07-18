/**
 * Public Arcadia Intelligence contracts surface.
 *
 * This is the only contracts entry point companion apps (e.g. Rebuster) should
 * import. It re-exports the generic, domain-neutral request/job/result types
 * from the internal contracts module without exposing the internal file path.
 */
export type {
  ExecutionPolicy,
  ExecutionPreference,
  IntelligenceArtifactRecord,
  IntelligenceCapability,
  IntelligenceExecutionTarget,
  IntelligenceImageGenerationResult,
  IntelligenceJob,
  IntelligenceJobStatus,
  IntelligenceProfile,
  IntelligenceRequest,
  IntelligenceRequirements,
  IntelligenceSpeechGenerationResult,
  IntelligenceUsage,
  JsonPrimitive,
  JsonValue,
  OutputContract,
  PromptTemplateRef,
  RetryIntelligenceJobResponse,
  SubmitIntelligenceRequestResponse,
  ValidationResult,
} from "./types.js";

/**
 * The enumerable value sets behind IntelligenceCapability / ExecutionPreference
 * / IntelligenceProfile, re-exported as values (not just types) so a caller
 * can render selectable options without duplicating this list.
 */
export {
  EXECUTION_PREFERENCES,
  INTELLIGENCE_EXECUTION_TARGETS,
  INTELLIGENCE_CAPABILITIES,
  INTELLIGENCE_PROFILES,
} from "./types.js";
