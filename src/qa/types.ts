export const PROOF_TARGET_KINDS = ["stable", "candidate"] as const;
export type ProofTargetKind = (typeof PROOF_TARGET_KINDS)[number];

export const PROOF_HEALTH_STATES = ["unverified", "reachable", "unreachable"] as const;
export type ProofHealthState = (typeof PROOF_HEALTH_STATES)[number];

export const QA_VERDICTS = ["pass", "fail", "follow_up"] as const;
export type QaVerdict = (typeof QA_VERDICTS)[number];

export interface ProofTargetRecord {
  id: string;
  project_id: string;
  kind: ProofTargetKind;
  label: string;
  url: string | null;
  source_revision: string | null;
  pull_request_url: string | null;
  test_procedure: string | null;
  change_summary: string | null;
  health_state: ProofHealthState;
  health_checked_at: string | null;
  retired_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface QaSignOffRecord {
  id: string;
  proof_target_id: string;
  project_id: string;
  source_revision: string | null;
  verdict: QaVerdict;
  note: string | null;
  review_item_id: string | null;
  signed_off_at: string;
  created_at: string;
}

/**
 * How the newest sign-off relates to the revision the target points at *now*.
 *
 * `stale` is the state worth having a name for: QA passed, but against an
 * older revision, so the queue must not present the current Candidate as
 * verified. Collapsing it into `none` would hide real evidence; collapsing it
 * into `current` would claim evidence that does not exist for this revision.
 */
export type QaEvidenceFreshness = "current" | "stale" | "none" | "revision-unknown";

/** The single next thing the operator should do with one Candidate. */
export type QaPrimaryAction =
  | "configure-target"
  | "test-candidate"
  | "signed-off"
  | "inspect-failure"
  | "follow-up"
  /** Stable only. Stable is the known-good thing to show, never a thing awaiting judgement. */
  | "show-stable";

export interface QaQueueRow {
  targetId: string;
  projectId: string;
  projectName: string;
  projectSlug: string;
  kind: ProofTargetKind;
  label: string;
  url: string | null;
  sourceRevision: string | null;
  pullRequestUrl: string | null;
  testProcedure: string | null;
  changeSummary: string | null;
  healthState: ProofHealthState;
  healthCheckedAt: string | null;
  /** True only when a URL is configured. Never a claim that it responded. */
  testable: boolean;
  latestSignOff: {
    id: string;
    verdict: QaVerdict;
    note: string | null;
    sourceRevision: string | null;
    signedOffAt: string;
    reviewItemId: string | null;
  } | null;
  evidenceFreshness: QaEvidenceFreshness;
  primaryAction: QaPrimaryAction;
  /** Plain sentence naming what is missing or what to do. Always populated. */
  statusLine: string;
}

export interface QaQueueProjectGroup {
  projectId: string;
  projectName: string;
  projectSlug: string;
  candidates: QaQueueRow[];
  stable: QaQueueRow[];
}

export interface QaQueueSnapshot {
  generatedAt: string;
  projects: QaQueueProjectGroup[];
  counts: {
    candidates: number;
    stable: number;
    awaitingSignOff: number;
    failing: number;
    unconfigured: number;
  };
}
