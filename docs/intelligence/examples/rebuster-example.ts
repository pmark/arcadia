/**
 * Rebuster's three current Arcadia Intelligence workflows, in one place.
 *
 * This is not a copy of Rebuster's app — it's the minimum shape Rebuster
 * sends for each workflow, plus how to handle the typed failures Arcadia
 * can return. See ROUTING.md for what each field means and the currently
 * supported route matrix.
 *
 * Run the real service first (then `tsx docs/intelligence/examples/rebuster-example.ts`):
 *   pnpm arcadia intelligence serve --workspace ./tmp/demo-workspace --port 4710
 */
import { ArcadiaIntelligenceClient } from "@pmark/arcadia/intelligence/client";
import type {
  IntelligenceJob,
  IntelligenceRequest,
} from "@pmark/arcadia/intelligence/contracts";

const client = new ArcadiaIntelligenceClient({
  baseUrl: process.env.ARCADIA_INTELLIGENCE_BASE_URL ?? "http://127.0.0.1:4710",
});

// A. Rebus idea candidate generation.
//
// "local-preferred" + "fast" never escalates to cloud on its own — if no
// local route is configured, this fails with a typed error instead of
// spending money. Rebuster can use that failure to surface its own
// deliberate "generate with cloud instead" action later.
const ideaCandidatesRequest: IntelligenceRequest = {
  idempotencyKey: `rebuster-idea-candidates-${Date.now()}`,
  operationId: "rebuster.generate-idea-candidates",
  clientApp: "rebuster",
  capability: "text.generate",
  execution: "local-preferred",
  profile: "fast",
  requirements: { structuredOutput: true },
  input: { topic: "rebus puzzles about kitchen tools" },
  outputContract: {
    schemaId: "rebuster.idea-candidates.v1",
    schemaVersion: 1,
    jsonSchema: {
      type: "object",
      properties: { candidates: { type: "array", items: { type: "string" } } },
      required: ["candidates"],
    },
  },
  template: { id: "rebuster.idea-candidates-prompt", version: "1" },
  executionPolicy: { allowPaidUsage: false, maxRetries: 1 },
};

// B. Strict Rebuster spec generation.
//
// "cloud-required" + "quality" + allowPaidUsage: true. Fails predictably
// with PAID_USAGE_NOT_ALLOWED if paid usage isn't authorized — it never
// falls back to local or a cheaper cloud profile.
const strictSpecRequest: IntelligenceRequest = {
  idempotencyKey: `rebuster-strict-spec-${Date.now()}`,
  operationId: "rebuster.generate-strict-spec",
  clientApp: "rebuster",
  capability: "text.generate",
  execution: "cloud-required",
  profile: "quality",
  requirements: { structuredOutput: true },
  input: { brief: "a rebus where ICE + CREAM resolves visually" },
  outputContract: {
    schemaId: "rebuster.strict-spec.v1",
    schemaVersion: 1,
    jsonSchema: {
      type: "object",
      properties: { spec: { type: "string" } },
      required: ["spec"],
    },
  },
  template: { id: "rebuster.strict-spec-prompt", version: "1" },
  executionPolicy: { allowPaidUsage: true, maxRetries: 1 },
};

// C. Rebus image candidate generation through the local Codex image route.
//
// `requirements.imageSize`/`transparency` are validated against what
// Arcadia's image transport actually supports; unsupported values are
// rejected up front rather than silently ignored.
const imageCandidatesRequest: IntelligenceRequest = {
  idempotencyKey: `rebuster-image-candidates-${Date.now()}`,
  operationId: "rebuster.generate-image-candidates",
  clientApp: "rebuster",
  capability: "image.generate",
  execution: "local-required",
  profile: "quality",
  requirements: { imageSize: "1024x1024", transparency: false },
  input: { prompt: "a rebus tile for ICE + CREAM, flat illustration style" },
  outputContract: {
    schemaId: "rebuster.generated-image.v1",
    schemaVersion: 1,
    jsonSchema: {
      type: "object",
      properties: { artifacts: { type: "array", minItems: 1 } },
      required: ["artifacts"],
    },
  },
  template: { id: "rebuster.image-candidates-prompt", version: "1" },
  executionPolicy: { allowPaidUsage: false, maxRetries: 1 },
};

async function submitAndReport(label: string, request: IntelligenceRequest): Promise<void> {
  try {
    const { job: submitted } = await client.submit(request);
    const job: IntelligenceJob = await client.waitForCompletion(submitted.id, {
      timeoutMs: 60_000,
    });

    switch (job.status) {
      case "completed":
        console.log(`[${label}] completed:`, job.result);
        break;
      case "failed":
        console.error(`[${label}] failed:`, job.error);
        break;
      case "blocked":
        // job.error.code is one of ROUTE_NOT_CONFIGURED, ROUTE_DISABLED,
        // PAID_USAGE_NOT_ALLOWED, LOCAL_ROUTE_UNAVAILABLE,
        // CLOUD_ROUTE_UNAVAILABLE, or LITELLM_UNAVAILABLE. job.error.message
        // never contains a provider/model/LiteLLM route name.
        console.error(`[${label}] blocked:`, job.error);
        break;
      default:
        console.error(`[${label}] unexpected terminal status: ${job.status}`);
    }
  } catch (error) {
    // A 400 from submit() means the request shape itself was invalid —
    // e.g. an unsupported `requirements` combination. Also safe to log.
    console.error(`[${label}] request rejected:`, error instanceof Error ? error.message : error);
  }
}

async function main(): Promise<void> {
  await submitAndReport("idea-candidates", ideaCandidatesRequest);
  await submitAndReport("strict-spec", strictSpecRequest);
  await submitAndReport("image-candidates", imageCandidatesRequest);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
