import type { IntelligenceJob } from "@pmark/arcadia/intelligence/contracts";

export function safeIntelligenceJob(job: IntelligenceJob): IntelligenceJob {
  if (!job.error) return job;
  const code = safeIntelligenceErrorCode(job.error.code);
  const stage = job.status === "blocked" ? "blocked" : "failed";
  return { ...job, error: { code, message: `Job ${job.id} ${stage} during generation (${code}).` } };
}

export function safeIntelligenceErrorCode(value: unknown): string {
  return typeof value === "string" && /^[A-Z][A-Z0-9_:-]{0,63}$/.test(value) ? value : "INTELLIGENCE_ERROR";
}
