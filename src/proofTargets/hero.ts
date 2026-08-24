import type { ProofTargetCheck } from "../db/repositories.js";
import type { ProofTargetConfig } from "./targets.js";

export type ProofHeroState =
  | "failure"
  | "ready_for_operator_demo"
  | "qa_failed"
  | "release_decision_needed"
  | "stable_only"
  | "proof_unavailable";

export interface ProofHeroAction {
  label: string;
  targetId: string | null;
  url: string | null;
}

export interface ProofHeroResolution {
  state: ProofHeroState;
  headline: string;
  detail: string;
  primaryAction: ProofHeroAction | null;
}

export type ProofQaDecision = "pass" | "fail" | "needs-follow-up" | null;

export interface ProofHeroInput {
  stable: ProofTargetConfig | null;
  candidate: ProofTargetConfig | null;
  stableCheck: ProofTargetCheck | null;
  candidateCheck: ProofTargetCheck | null;
  candidateQaDecision: ProofQaDecision;
}

/**
 * The state resolver behind `docs/operator-demo-and-release-contract.md`'s
 * "What the Project Detail hero should say" priority order. It always
 * resolves to exactly one of the six named states so the hero never shows two
 * competing primary next actions, and it only ever claims health or QA
 * outcomes that were actually observed — never inferred from configuration
 * alone.
 */
export function resolveProofHeroState(input: ProofHeroInput): ProofHeroResolution {
  const { stable, candidate, stableCheck, candidateCheck, candidateQaDecision } = input;

  if (!stable && !candidate) {
    return {
      state: "proof_unavailable",
      headline: "No proof target is configured",
      detail: "Add a Stable or Candidate target to the workspace's config/qa-targets.json before this Project can show a demo state.",
      primaryAction: null
    };
  }

  if (candidate) {
    if (!candidateCheck) {
      return {
        state: "proof_unavailable",
        headline: `${candidate.label} has never been health-checked`,
        detail: "Run a proof-target check before Arcadia can claim the Candidate is reachable.",
        primaryAction: { label: "Check Candidate", targetId: candidate.id, url: candidate.url }
      };
    }

    if (candidateCheck.health_state === "unhealthy") {
      return {
        state: "failure",
        headline: `${candidate.label} is unreachable`,
        detail: candidateCheck.error_message ?? `Last check failed at ${candidateCheck.checked_at}.`,
        primaryAction: { label: "Inspect failure", targetId: candidate.id, url: candidate.url }
      };
    }

    if (candidateQaDecision === "fail" || candidateQaDecision === "needs-follow-up") {
      return {
        state: "qa_failed",
        headline: `${candidate.label} QA found a problem`,
        detail:
          candidateQaDecision === "fail"
            ? "Arcadia QA recorded fail for this Candidate revision."
            : "Arcadia QA recorded needs-follow-up for this Candidate revision.",
        primaryAction: { label: "Review QA", targetId: candidate.id, url: null }
      };
    }

    if (candidateQaDecision === "pass") {
      return {
        state: "release_decision_needed",
        headline: `${candidate.label} passed QA`,
        detail: "QA passed for this revision. A release Decision is needed before this becomes Stable.",
        primaryAction: { label: "Review release", targetId: candidate.id, url: null }
      };
    }

    return {
      state: "ready_for_operator_demo",
      headline: `${candidate.label} is ready for your judgment`,
      detail: `Reachable as of ${candidateCheck.checked_at}. No QA has run yet.`,
      primaryAction: { label: "Test Candidate", targetId: candidate.id, url: candidate.url }
    };
  }

  if (stable && stableCheck?.health_state === "healthy") {
    return {
      state: "stable_only",
      headline: `${stable.label} is the current Stable target`,
      detail: `Reachable as of ${stableCheck.checked_at}. No Candidate is active.`,
      primaryAction: { label: "Show Stable", targetId: stable.id, url: stable.url }
    };
  }

  return {
    state: "proof_unavailable",
    headline: "No usable proof exists",
    detail: stable ? "The Stable target has not been proven healthy yet." : "No Stable target is configured.",
    primaryAction: stable ? { label: "Check Stable", targetId: stable.id, url: stable.url } : null
  };
}
