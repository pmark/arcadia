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

export const DIGEST_SCOPES = ["project", "portfolio"] as const;
export type DigestScope = (typeof DIGEST_SCOPES)[number];

/** The deduplication identity of the collective roll-up, which has no Project. */
export const PORTFOLIO_SCOPE_KEY = "portfolio";

/** The subject a digest narrates: one Project, or the portfolio as a whole. */
export interface DigestSubject {
  scope: DigestScope;
  /** Unique per subject: the Project id, or PORTFOLIO_SCOPE_KEY. */
  scopeKey: string;
  /** Null for the portfolio roll-up. */
  projectId: string | null;
  name: string;
  slug: string;
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
  subject: DigestSubject;
  window: DigestWindow;
  facts: DigestFact[];
}) => Promise<DigestNarration>;

export interface NarrativeDigestRecord {
  id: string;
  scope: DigestScope;
  scope_key: string;
  project_id: string | null;
  artifact_id: string;
  period: DigestPeriod;
  window_start: string;
  window_end: string;
  intelligence_job_id: string | null;
  facts_json: string;
  posted_message_id: string | null;
  posted_at: string | null;
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
