import { Ajv, type ValidateFunction } from "ajv";
import type {
  JsonValue,
  OutputContract,
  ValidationResult,
} from "../types.js";

/**
 * Generic validation seam.
 *
 * Validates model output against the companion-app-supplied JSON Schema using
 * ajv. Arcadia does not interpret the schema's domain meaning; it only checks
 * that the value conforms to the shape the companion app asked for.
 */
const ajv = new Ajv({ strict: false, allErrors: true });
const compiledSchemas = new Map<string, ValidateFunction>();

export async function validateOutput(
  value: JsonValue,
  contract: OutputContract,
): Promise<ValidationResult> {
  const validate = compileSchema(contract);

  const passed = validate(value);
  if (passed) {
    return { passed: true };
  }

  return {
    passed: false,
    errors: (validate.errors ?? []).map(
      (error) => `${error.instancePath || "(root)"} ${error.message ?? "is invalid"}`,
    ),
  };
}

function compileSchema(contract: OutputContract): ValidateFunction {
  const cacheKey = `${contract.schemaId}@${contract.schemaVersion}:${contract.schemaHash ?? ""}`;
  const cached = compiledSchemas.get(cacheKey);
  if (cached) {
    return cached;
  }

  const validate = ajv.compile(contract.jsonSchema as object);
  compiledSchemas.set(cacheKey, validate);
  return validate;
}
