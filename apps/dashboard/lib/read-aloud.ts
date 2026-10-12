import { createHash } from "node:crypto";
import type { IntelligenceRequest } from "@pmark/arcadia/intelligence/contracts";
import { getIntelligenceClient } from "./intelligence";

export function buildReadAloudRequest(text: string): IntelligenceRequest {
  const normalized = text.trim();
  if (!normalized || normalized.length > 100_000) throw new Error("Read-aloud text must contain 1–100000 characters.");
  const fingerprint = createHash("sha256").update(JSON.stringify({ text: normalized, voiceId: "arcadia.narrator", format: "mp3", version: 1 })).digest("hex");
  return {
    idempotencyKey: `read-aloud-v1-${fingerprint}`, operationId: "arcadia.dashboard.read-aloud", clientApp: "arcadia-dashboard",
    capability: "audio.speech.generate", execution: "local-required", profile: "standard",
    input: { text: normalized, voiceId: "arcadia.narrator", format: "mp3" },
    outputContract: { schemaId: "arcadia.read-aloud", schemaVersion: 1, jsonSchema: {
      type: "object", properties: { artifact: { type: "object", properties: { id: { type: "string" }, format: { const: "mp3" }, mimeType: { const: "audio/mpeg" } }, required: ["id", "format", "mimeType"] } }, required: ["artifact"],
    } },
    template: { id: "arcadia.read-aloud", version: "1" }, executionPolicy: { allowPaidUsage: false, maxRetries: 1 },
  };
}

export async function submitReadAloud(text: string) {
  const client = getIntelligenceClient();
  const { job } = await client.submit(buildReadAloudRequest(text));
  // Repeated Play is an explicit user retry of a prior failed request, bounded
  // by Intelligence's existing single-retry gate. Completed jobs stay cached.
  if ((job.status === "blocked" || job.status === "failed") && job.retryCount < 1) return (await client.retry(job.id)).job;
  return job;
}
