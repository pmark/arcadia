import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import type {
  IntelligenceJob,
  IntelligenceRequest,
} from "@pmark/arcadia/intelligence/contracts";
import { getIntelligenceClient } from "../../../lib/intelligence";
import {
  getEnrichment,
  isEnrichmentKind,
  type EnrichmentDefinition,
} from "../../../lib/enrichment/registry";
import type {
  EnrichmentRequestBody,
  EnrichmentResponse,
} from "../../../lib/enrichment/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ADMIN_ENRICH_CLIENT_APP = "arcadia-admin";

/**
 * Generalized async-enrichment endpoint. Given a `kind` + source `text`, it
 * resolves the enrichment definition, submits (idempotently) to the Arcadia
 * Intelligence service, and reports the current state without ever blocking on
 * a long generation. The client polls by re-POSTing the same body; because the
 * idempotency key is derived from the content hash, the Intelligence job store
 * itself serves as the durable cache — a completed job is returned unchanged.
 */
export async function POST(request: Request): Promise<NextResponse<EnrichmentResponse>> {
  let body: EnrichmentRequestBody;
  try {
    body = (await request.json()) as EnrichmentRequestBody;
  } catch {
    return NextResponse.json(
      { status: "unavailable", detail: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  if (!isEnrichmentKind(body.kind)) {
    return NextResponse.json(
      { status: "unavailable", detail: `Unknown enrichment kind "${String(body.kind)}".` },
      { status: 400 },
    );
  }

  const text = typeof body.text === "string" ? body.text : "";
  const definition = getEnrichment(body.kind);

  if (text.trim().length < definition.minInputChars) {
    return NextResponse.json({ status: "skipped", detail: "Input below enrichment threshold." });
  }

  const intelligenceRequest = buildEnrichmentRequest(definition, text);

  let job: IntelligenceJob;
  try {
    const client = getIntelligenceClient();
    const submitted = await client.submit(intelligenceRequest);
    job = submitted.job;
  } catch (error) {
    // The Intelligence service being down must never break the page — the
    // deterministic UI stands alone.
    return NextResponse.json({
      status: "unavailable",
      detail: error instanceof Error ? error.message : "Arcadia Intelligence is unavailable.",
    });
  }

  if (job.status === "queued" || job.status === "running") {
    return NextResponse.json({ status: "pending" });
  }

  if (job.status === "completed") {
    const value = job.result === undefined || job.result === null
      ? null
      : definition.parse(job.result);
    if (value) {
      return NextResponse.json({ status: "ready", value });
    }
    return NextResponse.json({ status: "unavailable", detail: "Enrichment produced no usable value." });
  }

  // "failed" | "blocked"
  return NextResponse.json({
    status: "unavailable",
    detail: job.error?.message ?? `Enrichment job ${job.status}.`,
  });
}

function buildEnrichmentRequest(
  definition: EnrichmentDefinition,
  text: string,
): IntelligenceRequest {
  const contentHash = createHash("sha256").update(text).digest("hex").slice(0, 24);
  return {
    idempotencyKey: `enrich:${definition.id}:${contentHash}`,
    operationId: definition.operationId,
    clientApp: ADMIN_ENRICH_CLIENT_APP,
    capability: "text.generate",
    execution: definition.execution === "cloud" ? "cloud-required" : "local-required",
    executionTarget: definition.execution,
    profile: definition.profile,
    input: { prompt: definition.buildPrompt(text) },
    requirements: { structuredOutput: true },
    outputContract: definition.outputContract,
    template: { id: definition.operationId, version: "1" },
    executionPolicy: { allowPaidUsage: definition.allowPaidUsage ?? false, maxRetries: 1 },
  };
}
