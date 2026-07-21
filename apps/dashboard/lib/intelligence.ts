import { randomUUID } from "node:crypto";
import { ArcadiaIntelligenceClient } from "@pmark/arcadia/intelligence/client";
import type { IntelligenceRequest } from "@pmark/arcadia/intelligence/contracts";
import { findPreset, PLAIN_TEXT_SCHEMA } from "./intelligence-presets";
import {
  ADMIN_INTELLIGENCE_CLIENT_APP,
  type AdminImageSubmission,
  type AdminSpeechSubmission,
  type AdminSubmission,
  type AdminTextSubmission,
  type IntelligenceCapabilitiesResponse,
  type IntelligenceOffering,
} from "./intelligence-types";

export const INTELLIGENCE_BASE_URL =
  process.env.ARCADIA_INTELLIGENCE_BASE_URL?.trim() || "http://127.0.0.1:4710";

export function getIntelligenceClient(): ArcadiaIntelligenceClient {
  return new ArcadiaIntelligenceClient({ baseUrl: INTELLIGENCE_BASE_URL });
}

interface HealthRoute {
  id: string;
  capability: string;
  location: "local" | "cloud";
  profile: string;
  executor: "litellm" | "codex-cli" | "comfyui" | "speech";
  requiresPaidUsage: boolean;
}

interface HealthResponse {
  ok: boolean;
  liteLlm: {
    baseUrl: string;
    reachable: boolean;
    routes: HealthRoute[];
  };
}

/**
 * Fetches the live capability/route registry from the real Arcadia
 * Intelligence service (the same service path companion apps use), and
 * shapes it for the admin test bench. Never fabricates an offering that
 * isn't present in the live response.
 */
export async function loadIntelligenceCapabilities(): Promise<IntelligenceCapabilitiesResponse> {
  try {
    const response = await fetch(`${INTELLIGENCE_BASE_URL}/api/intelligence/health`, {
      cache: "no-store",
    });
    if (!response.ok) {
      return unreachable(`Arcadia Intelligence health check failed: ${response.status} ${response.statusText}`);
    }
    const body = (await response.json()) as HealthResponse;
    const routes = body.liteLlm.routes as unknown as IntelligenceOffering[];
    return {
      reachable: true,
      liteLlmBaseUrl: body.liteLlm.baseUrl,
      liteLlmReachable: body.liteLlm.reachable,
      textOfferings: routes.filter((route) => route.capability === "text.generate"),
      imageOfferings: routes.filter((route) => route.capability === "image.generate"),
      speechOfferings: routes.filter((route) => route.capability === "audio.speech.generate"),
    };
  } catch (error) {
    return unreachable(
      `Could not reach Arcadia Intelligence at ${INTELLIGENCE_BASE_URL}. Is "arcadia intelligence serve" running? (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
  }
}

function unreachable(error: string): IntelligenceCapabilitiesResponse {
  return {
    reachable: false,
    liteLlmBaseUrl: INTELLIGENCE_BASE_URL,
    liteLlmReachable: false,
    textOfferings: [],
    imageOfferings: [],
    speechOfferings: [],
    error,
  };
}

export class AdminSubmissionError extends Error {}

/**
 * Builds a generic IntelligenceRequest from the admin test bench's compact
 * form input. This is the only place the admin page constructs a request —
 * it is submitted through ArcadiaIntelligenceClient.submit(), the same
 * service path companion apps use. operationId/clientApp mark the run as an
 * admin capability test for the recent-history view; neither field
 * participates in route resolution or policy (see resolveIntelligenceRoute,
 * which only reads capability/execution/profile).
 */
export function buildAdminIntelligenceRequest(submission: AdminSubmission): IntelligenceRequest {
  const idempotencyKey = `admin-${randomUUID()}`;
  const executionPolicy = { allowPaidUsage: submission.allowPaidUsage, maxRetries: 1 };

  if (submission.capability === "text.generate") {
    return buildTextRequest(submission, idempotencyKey, executionPolicy);
  }
  if (submission.capability === "audio.speech.generate") {
    return buildSpeechRequest(submission, idempotencyKey, executionPolicy);
  }
  return buildImageRequest(submission, idempotencyKey, executionPolicy);
}

function buildTextRequest(
  submission: AdminTextSubmission,
  idempotencyKey: string,
  executionPolicy: { allowPaidUsage: boolean; maxRetries: number },
): IntelligenceRequest {
  if (!submission.prompt.trim()) {
    throw new AdminSubmissionError("Prompt is required.");
  }

  const jsonSchema =
    submission.outputMode === "structured"
      ? (() => {
          const preset = submission.presetId ? findPreset(submission.presetId) : undefined;
          if (!preset) {
            throw new AdminSubmissionError("A structured-output preset is required.");
          }
          return preset.jsonSchema;
        })()
      : PLAIN_TEXT_SCHEMA;

  return {
    idempotencyKey,
    operationId: "arcadia-admin.intelligence-bench.text",
    clientApp: ADMIN_INTELLIGENCE_CLIENT_APP,
    capability: "text.generate",
    execution: submission.execution,
    profile: submission.profile,
    input: { prompt: submission.prompt },
    requirements: { structuredOutput: true },
    outputContract: {
      schemaId:
        submission.outputMode === "structured"
          ? `arcadia-admin.${submission.presetId}`
          : "arcadia-admin.plain-text",
      schemaVersion: 1,
      jsonSchema,
    },
    template: { id: "arcadia-admin.intelligence-bench", version: "1" },
    executionPolicy,
  };
}

function buildSpeechRequest(
  submission: AdminSpeechSubmission,
  idempotencyKey: string,
  executionPolicy: { allowPaidUsage: boolean; maxRetries: number },
): IntelligenceRequest {
  if (!submission.text.trim()) {
    throw new AdminSubmissionError("Text is required.");
  }
  if (!submission.voiceId.trim()) {
    throw new AdminSubmissionError("A voice is required.");
  }

  return {
    idempotencyKey,
    operationId: "arcadia-admin.intelligence-bench.speech",
    clientApp: ADMIN_INTELLIGENCE_CLIENT_APP,
    capability: "audio.speech.generate",
    execution: submission.execution,
    profile: submission.profile,
    input: { text: submission.text, voiceId: submission.voiceId, format: "wav" },
    outputContract: {
      schemaId: "arcadia-admin.speech-bench",
      schemaVersion: 1,
      jsonSchema: {
        type: "object",
        properties: {
          artifact: { type: "object" },
          voiceId: { type: "string" },
          routeId: { type: "string" },
          provider: { type: "string" },
        },
        required: ["artifact", "voiceId", "routeId", "provider"],
      },
    },
    template: { id: "arcadia-admin.intelligence-bench", version: "1" },
    executionPolicy,
  };
}

function buildImageRequest(
  submission: AdminImageSubmission,
  idempotencyKey: string,
  executionPolicy: { allowPaidUsage: boolean; maxRetries: number },
): IntelligenceRequest {
  if (!submission.prompt.trim()) {
    throw new AdminSubmissionError("Image prompt is required.");
  }
  const count = Math.min(Math.max(1, Math.trunc(submission.count)), 4);

  return {
    idempotencyKey,
    operationId: "arcadia-admin.intelligence-bench.image",
    clientApp: ADMIN_INTELLIGENCE_CLIENT_APP,
    capability: "image.generate",
    execution: submission.execution,
    profile: submission.profile,
    input: { prompt: submission.prompt, n: count },
    requirements: { imageSize: "1024x1024", transparency: false },
    outputContract: {
      schemaId: "arcadia-admin.image-bench",
      schemaVersion: 1,
      jsonSchema: {
        type: "object",
        properties: {
          artifacts: { type: "array", minItems: 1 },
          generation: { type: "object" },
        },
        required: ["artifacts"],
      },
    },
    template: { id: "arcadia-admin.intelligence-bench", version: "1" },
    executionPolicy,
  };
}
