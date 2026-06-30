import { describe, expect, it } from "vitest";
import { categorizeFailure, failureCategoryLabel } from "./intelligence-failure";

describe("categorizeFailure", () => {
  it.each([
    ["ROUTE_NOT_CONFIGURED", "unavailable_route"],
    ["LOCAL_ROUTE_UNAVAILABLE", "unavailable_route"],
    ["PAID_USAGE_NOT_ALLOWED", "policy_rejection"],
    ["LITELLM_UNAVAILABLE", "configuration_failure"],
    ["CODEX_CLI_UNAVAILABLE", "configuration_failure"],
    ["CODEX_CLI_TIMEOUT", "timeout"],
    ["CODEX_CLI_NONZERO_EXIT", "executor_failure"],
    ["CODEX_MANIFEST_VALIDATION_FAILED", "artifact_validation_failure"],
    ["VALIDATION_FAILED", "output_schema_validation_failure"],
    ["EXECUTION_ERROR", "executor_failure"],
    ["SOMETHING_NEW", "unknown"],
    [undefined, "unknown"],
  ] as const)("maps %s to %s", (code, expected) => {
    expect(categorizeFailure(code)).toBe(expected);
  });

  it("has a human label for every category", () => {
    expect(failureCategoryLabel(categorizeFailure("VALIDATION_FAILED"))).toBe(
      "Output-schema validation failure",
    );
  });
});
