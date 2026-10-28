export type DirectionState = "submitted" | "delivered" | "acknowledged" | "continued" | "verified" | "unknown" | "held" | "refused";
export interface DirectionEvidence {
  state: DirectionState; artifact: string; source: string; observedAt: string; provenance: string;
  revision?: string; result?: string; current?: boolean;
}
export interface DirectionView {
  fingerprint: string | null;
  requestId: string; content: string; target: unknown; disposition: "accepted" | "refused" | "unknown";
  state: DirectionState; lastSupportedState: DirectionState | null; reason: string | null; evidence: DirectionEvidence[];
}
