import type { EnrichmentKind } from "./registry";

/**
 * The response the dashboard's /api/enrich route returns, and the shape the
 * `useEnrichment` hook consumes. Enrichment is always optional decoration, so
 * every non-ready state is explicit and non-fatal:
 *
 * - "ready":       an enrichment value is available.
 * - "pending":     the job is queued/running; poll again shortly.
 * - "skipped":     the input didn't warrant enrichment (e.g. too short).
 * - "unavailable": the Intelligence service or route couldn't produce a value.
 */
export type EnrichmentStatus = "ready" | "pending" | "skipped" | "unavailable";

export interface EnrichmentResponse {
  status: EnrichmentStatus;
  /** Present only when status === "ready". */
  value?: string;
  /** Human-readable reason for "unavailable"/"skipped"; for diagnostics only. */
  detail?: string;
}

export interface EnrichmentRequestBody {
  kind: EnrichmentKind;
  text: string;
}
