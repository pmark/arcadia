import { describe, expect, it } from "vitest";
import { initialTargetStateLabel, reachabilityFromCheck } from "./qa";
import type { ProofTargetCheckResponse } from "./types";

const checkedAt = "2026-08-25T00:00:00.000Z";

function response(httpStatus: number | null, healthState: "healthy" | "unhealthy"): ProofTargetCheckResponse {
  return {
    project: { id: "project-1", slug: "sample", name: "Sample" },
    target: {
      id: "target-1",
      project: "sample",
      environment: "Candidate",
      label: "Sample Candidate",
      url: "http://sample.test",
      environmentKind: "lan",
      accessState: "access-protected",
      sourceRevision: null
    },
    check: {
      id: "check-1",
      target_id: "target-1",
      project_id: "project-1",
      url: "http://sample.test",
      health_state: healthState,
      http_status: httpStatus,
      latency_ms: 10,
      error_message: healthState === "healthy" ? null : `HTTP ${httpStatus}`,
      checked_at: checkedAt,
      created_at: checkedAt
    },
    hero: {
      state: "proof_unavailable",
      headline: "Proof unavailable",
      detail: "Fixture",
      primaryAction: null
    }
  };
}

describe("QA reachability labels", () => {
  it("treats a protected target's 403 as unverifiable, not unhealthy", () => {
    expect(reachabilityFromCheck(
      { accessState: "access-protected" },
      response(403, "unhealthy"),
      () => "just now"
    )).toEqual({ state: "access-protected", label: "Access protected · HTTP 403 · checked just now" });
  });

  it("labels a protected target honestly before its first asynchronous check", () => {
    expect(initialTargetStateLabel({ targetState: "unverified", accessState: "access-protected" }))
      .toBe("Unverified from here · access protected");
  });
});
