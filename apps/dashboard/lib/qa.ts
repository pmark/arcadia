import type { ProofTargetCheckResponse, QaCandidate } from "./types";

export type QaReachability = {
  state: "ready" | "unreachable" | "access-protected";
  label: string;
};

/** Keep an access gate distinct from a failed service. */
export function reachabilityFromCheck(
  candidate: Pick<QaCandidate, "accessState">,
  response: ProofTargetCheckResponse,
  formatCheckedAt = (value: string) => new Date(value).toLocaleString()
): QaReachability {
  const { check } = response;
  if (candidate.accessState === "access-protected" && check.http_status === 403) {
    return { state: "access-protected", label: `Access protected · HTTP 403 · checked ${formatCheckedAt(check.checked_at)}` };
  }
  if (check.health_state === "healthy") {
    return { state: "ready", label: `Ready${check.http_status ? ` · HTTP ${check.http_status}` : ""} · checked ${formatCheckedAt(check.checked_at)}` };
  }
  return { state: "unreachable", label: `Unreachable · ${check.error_message ?? "probe failed"} · checked ${formatCheckedAt(check.checked_at)}` };
}

export function initialTargetStateLabel(candidate: Pick<QaCandidate, "targetState" | "accessState">): string {
  if (candidate.targetState === "unverified" && candidate.accessState === "access-protected") {
    return "Unverified from here · access protected";
  }
  return candidate.targetState;
}
