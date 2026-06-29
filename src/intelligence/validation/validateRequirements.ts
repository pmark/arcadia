import type { IntelligenceRequest } from "../types.js";

/**
 * The only image size Arcadia's configured image transport supports today.
 * Keep this in lockstep with what `httpClient.ts` actually sends to LiteLLM
 * — there is exactly one supported value, not a generic size negotiation.
 */
const SUPPORTED_IMAGE_SIZES = ["1024x1024"];

/**
 * Validates request.requirements against what Arcadia can actually honor
 * today, before the job is queued. Capability/execution/profile shape
 * validation happens separately (see api/server.ts); this only checks
 * requirement/capability compatibility and the narrow set of requirement
 * values Arcadia's transports support. Returns an error message, or
 * undefined when requirements are absent or all valid.
 */
export function validateRequirements(request: IntelligenceRequest): string | undefined {
  const requirements = request.requirements;
  if (!requirements) {
    return undefined;
  }

  const isImageCapability =
    request.capability === "image.generate" || request.capability === "image.edit";

  if (requirements.structuredOutput !== undefined && requirements.structuredOutput && isImageCapability) {
    return `requirements.structuredOutput is not supported for capability "${request.capability}".`;
  }

  if (requirements.imageSize !== undefined) {
    if (!isImageCapability) {
      return `requirements.imageSize is only supported for image capabilities, not "${request.capability}".`;
    }
    if (!SUPPORTED_IMAGE_SIZES.includes(requirements.imageSize)) {
      return `requirements.imageSize "${requirements.imageSize}" is not supported. Supported sizes: ${SUPPORTED_IMAGE_SIZES.join(", ")}.`;
    }
  }

  if (requirements.transparency !== undefined) {
    if (!isImageCapability) {
      return `requirements.transparency is only supported for image capabilities, not "${request.capability}".`;
    }
    if (requirements.transparency !== false) {
      return 'requirements.transparency: true is not supported yet. Only "false" is accepted.';
    }
  }

  return undefined;
}
