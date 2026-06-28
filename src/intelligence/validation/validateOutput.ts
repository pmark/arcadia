import type {
  JsonValue,
  OutputContract,
  ValidationResult,
} from "../types.js";

/**
 * Generic validation seam.
 *
 * v0.1 should validate model output against the companion-app-supplied JSON
 * Schema. Codex should select the smallest compatible JSON Schema validator
 * already used by Arcadia, or add one only if necessary.
 */
export async function validateOutput(
  _value: JsonValue,
  _contract: OutputContract,
): Promise<ValidationResult> {
  throw new Error(
    "Arcadia Intelligence output validation is not implemented yet. " +
      "Codex should wire this to a generic JSON Schema validator.",
  );
}
