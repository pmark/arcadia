import type { Artifact } from "../domain/types.js";

export const DIGEST_PERIODS = ["day", "week", "month"] as const;
export type DigestPeriod = (typeof DIGEST_PERIODS)[number];

export interface DigestWindow {
  period: DigestPeriod;
  /** Inclusive ISO-8601 instant. */
  start: string;
  /** Exclusive ISO-8601 instant. */
  end: string;
}

export type DigestFactKind = "mission_log" | "dispatch" | "decision";

export interface DigestFact {
  id: string;
  kind: DigestFactKind;
  occurredAt: string;
  summary: string;
  detail: Record<string, string | number | boolean | null>;
}

export interface DigestNarration {
  narrative: string;
  jobId: string | null;
}

export type DigestNarrator = (input: {
  projectId: string;
  projectName: string;
  window: DigestWindow;
  facts: DigestFact[];
}) => Promise<DigestNarration>;

export interface NarrativeDigestRecord {
  id: string;
  project_id: string;
  artifact_id: string;
  period: DigestPeriod;
  window_start: string;
  window_end: string;
  intelligence_job_id: string | null;
  facts_json: string;
  created_at: string;
  updated_at: string;
}

export interface ComposedProjectDigest {
  digest: NarrativeDigestRecord;
  artifact: Artifact;
  facts: DigestFact[];
  narrative: string;
  created: boolean;
}
