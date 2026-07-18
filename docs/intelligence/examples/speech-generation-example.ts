/**
 * Sample consumer script for text-to-speech via
 * @pmark/arcadia/intelligence/client.
 *
 * Same submit/poll shape as image-generation-example.ts, but with
 * `capability: "audio.speech.generate"`. It routes to the configured local
 * speech route (an OpenAI-compatible /v1/audio/speech server such as MLX-Audio
 * with Kokoro). The job result is never inline base64 — Arcadia receives the
 * audio bytes, hashes and stores them under the workspace's artifacts directory,
 * inspects the WAV for duration/sample-rate/channels, and returns a durable
 * artifact-reference manifest. This script submits a short speech request, waits
 * for it, verifies the artifact, and downloads the bytes for downstream video.
 *
 * Run the real service first, with a local speech route configured:
 *   ARCADIA_SPEECH_LOCAL_BASE_URL=http://127.0.0.1:8000 \
 *   ARCADIA_SPEECH_LOCAL_ROUTE=kokoro \
 *     pnpm arcadia intelligence serve --workspace ./tmp/demo-workspace --port 4710
 *
 * Then run this script against it (after `pnpm link --global @pmark/arcadia`
 * in the consumer repo):
 *   tsx docs/intelligence/examples/speech-generation-example.ts
 */
import { writeFile } from "node:fs/promises";
import { ArcadiaIntelligenceClient } from "@pmark/arcadia/intelligence/client";
import type {
  ExecutionPolicy,
  IntelligenceJob,
  IntelligenceRequest,
  IntelligenceSpeechGenerationResult,
  OutputContract,
  PromptTemplateRef,
} from "@pmark/arcadia/intelligence/contracts";

// 1. Configure the client. The base URL is owned by the consumer app's config.
const client = new ArcadiaIntelligenceClient({
  baseUrl: process.env.ARCADIA_INTELLIGENCE_BASE_URL ?? "http://127.0.0.1:4710",
});

// 2. Describe the result shape you require. For "audio.speech.generate",
//    Arcadia's manifest is `{ artifact, voiceId, routeId, provider, ... }`
//    (see IntelligenceSpeechGenerationResult) — require only what you use.
const outputContract: OutputContract = {
  schemaId: "example-app.generated-speech.v1",
  schemaVersion: 1,
  jsonSchema: {
    type: "object",
    properties: {
      artifact: {
        type: "object",
        properties: {
          id: { type: "string" },
          kind: { type: "string", const: "audio" },
          uri: { type: "string" },
          mimeType: { type: "string" },
          format: { type: "string" },
          sha256: { type: "string" },
          byteSize: { type: "number" },
          durationSeconds: { type: "number" },
        },
        required: ["id", "kind", "uri", "mimeType", "sha256", "byteSize", "durationSeconds"],
      },
      voiceId: { type: "string" },
      routeId: { type: "string" },
      provider: { type: "string" },
    },
    required: ["artifact", "voiceId", "routeId", "provider"],
  },
};

const template: PromptTemplateRef = {
  id: "example-app.speech-template",
  version: "1",
};

// 3. Local speech does not require paid-usage authorization.
const executionPolicy: ExecutionPolicy = { allowPaidUsage: false, maxRetries: 1 };

// 4. Build the request. `execution: "local-required"` routes to the configured
//    local speech route. `input.voiceId` is a semantic Arcadia voice id, never a
//    provider voice name. `input.format` is "wav" this milestone.
const request: IntelligenceRequest = {
  idempotencyKey: `example-app-speech-${Date.now()}`,
  operationId: "example-app.generate-narration",
  clientApp: "example-app",
  projectId: "proj_example",
  capability: "audio.speech.generate",
  execution: "local-required",
  profile: "standard",
  input: {
    text: "Can you solve this rebus?",
    voiceId: "arcadia.narrator",
    format: "wav",
  },
  outputContract,
  template,
  executionPolicy,
};

async function main() {
  // 5. Submit. `created` is false if this idempotencyKey already exists.
  const { job: submittedJob, created } = await client.submit(request);
  console.log(`submitted job ${submittedJob.id} (created=${created})`);

  // 6. Poll until terminal (completed, failed, or blocked).
  let job: IntelligenceJob = await client.waitForCompletion(submittedJob.id, {
    pollIntervalMs: 500,
    timeoutMs: 60_000,
  });

  // 7. A failed/blocked job can be retried once. Blocked commonly means the
  //    local speech endpoint isn't configured/reachable (error.code
  //    "SPEECH_UNAVAILABLE" / "ROUTE_NOT_CONFIGURED").
  if (job.status === "failed" || job.status === "blocked") {
    console.log(`job ${job.id} ${job.status}, retrying once`);
    const { job: retriedJob } = await client.retry(job.id);
    job = await client.waitForCompletion(retriedJob.id, { timeoutMs: 60_000 });
  }

  // 8. Read the outcome and download the audio through its durable reference.
  switch (job.status) {
    case "completed": {
      const result = job.result as unknown as IntelligenceSpeechGenerationResult;
      const { artifact } = result;
      console.log(
        `generated ${artifact.durationSeconds?.toFixed(2)}s of ${artifact.format} ` +
          `(${artifact.byteSize} bytes, sha256 ${artifact.sha256}) via route ${result.routeId} ` +
          `(provider ${result.provider}, voice ${result.voiceId})`,
      );

      const { bytes, contentType } = await client.getArtifact(artifact.uri);
      const localPath = `./tmp/${artifact.id}.${artifact.format ?? "wav"}`;
      await writeFile(localPath, Buffer.from(bytes));
      console.log(`saved ${contentType} -> ${localPath}`);
      break;
    }
    case "failed":
      console.error("job failed:", job.error);
      break;
    case "blocked":
      console.error("job blocked (e.g. no local speech endpoint configured):", job.error);
      break;
    default:
      console.error(`unexpected terminal status: ${job.status}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
