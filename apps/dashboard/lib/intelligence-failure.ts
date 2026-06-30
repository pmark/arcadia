export type IntelligenceFailureCategory =
  | "unavailable_route"
  | "policy_rejection"
  | "configuration_failure"
  | "executor_failure"
  | "timeout"
  | "output_schema_validation_failure"
  | "artifact_validation_failure"
  | "unknown";

const CATEGORY_LABELS: Record<IntelligenceFailureCategory, string> = {
  unavailable_route: "Unavailable route",
  policy_rejection: "Policy rejection",
  configuration_failure: "Configuration failure",
  executor_failure: "Executor failure",
  timeout: "Timeout",
  output_schema_validation_failure: "Output-schema validation failure",
  artifact_validation_failure: "Artifact validation/persistence failure",
  unknown: "Unknown failure",
};

const CODE_TO_CATEGORY: Record<string, IntelligenceFailureCategory> = {
  ROUTE_NOT_CONFIGURED: "unavailable_route",
  ROUTE_DISABLED: "unavailable_route",
  LOCAL_ROUTE_UNAVAILABLE: "unavailable_route",
  CLOUD_ROUTE_UNAVAILABLE: "unavailable_route",
  PAID_USAGE_NOT_ALLOWED: "policy_rejection",
  LITELLM_UNAVAILABLE: "configuration_failure",
  CODEX_CLI_UNAVAILABLE: "configuration_failure",
  CODEX_CLI_TIMEOUT: "timeout",
  CODEX_CLI_NONZERO_EXIT: "executor_failure",
  CODEX_MISSING_MANIFEST: "artifact_validation_failure",
  CODEX_MANIFEST_VALIDATION_FAILED: "artifact_validation_failure",
  CODEX_MISSING_IMAGE_FILE: "artifact_validation_failure",
  CODEX_INVALID_IMAGE: "artifact_validation_failure",
  VALIDATION_FAILED: "output_schema_validation_failure",
  EXECUTION_ERROR: "executor_failure",
};

export function categorizeFailure(errorCode: string | undefined): IntelligenceFailureCategory {
  if (!errorCode) return "unknown";
  return CODE_TO_CATEGORY[errorCode] ?? "unknown";
}

export function failureCategoryLabel(category: IntelligenceFailureCategory): string {
  return CATEGORY_LABELS[category];
}
