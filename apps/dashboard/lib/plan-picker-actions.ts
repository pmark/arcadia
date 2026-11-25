/**
 * The picker's per-Plan actions: what each one does, in one sentence, before it runs. Client-safe (no server
 * imports). Every action that exists composes a governed Agent Ask preview; none settles its own Ask.
 */

export type PlanActionKind = "queue-next" | "archive" | "annotate" | "request-change";
export type PlanAskKind = Extract<PlanActionKind, "annotate" | "request-change">;

export interface PlanActionSpec {
  kind: PlanActionKind;
  label: string;
  /** Null when the action has a governed path; otherwise why it is withheld. */
  unavailable: string | null;
}

/** Order as the Action names them. Queue next and Archive stay visible but withheld until their governed Ask exists. */
export const PLAN_ACTIONS: readonly PlanActionSpec[] = [
  { kind: "queue-next", label: "Queue next", unavailable: "Not available yet: the Plan-queue Ask (Plan F, queue-approved-plans-and-start-the-next) is not built, so there is no governed Ask to compose." },
  { kind: "archive", label: "Archive", unavailable: "Not available yet: no Agent Ask can change a Plan's status, and a hand edit is not allowed." },
  { kind: "annotate", label: "Annotate", unavailable: null },
  { kind: "request-change", label: "Request change", unavailable: null }
];

/** The one-sentence consequence shown before the action runs. */
export function planActionConsequence(kind: PlanActionKind, planName: string): string {
  switch (kind) {
    case "annotate": return `Records your note on ${planName} as an Agent Ask receipt; it changes no Plan, queue or status.`;
    case "request-change": return `Submits your words as a change request for ${planName}; nothing changes until the operator settles it, and accepting it unchanged would set the Plan's milestone to these words.`;
    case "queue-next":
    case "archive": return PLAN_ACTIONS.find(a => a.kind === kind)!.unavailable!;
  }
}

/** A request id unique to this tap: `workspace-<kind>-<plan>-<UTC stamp>-<nonce>`, all lowercase. */
export function planAskRequestId(kind: PlanAskKind, plan: string, now: Date = new Date(), nonce: string = Math.random().toString(36).slice(2, 6)): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z").toLowerCase();
  return `workspace-${kind}-${plan.slice(0, 48).replace(/-+$/, "")}-${stamp}-${nonce}`;
}

/** One Agent Ask effect in a line, as `agent-ask pending` renders it. */
export function effectLine(effect: { operation: string; targetKind: string; targetRef: string | null }): string {
  return `${effect.operation} ${effect.targetKind}${effect.targetRef ? ` ${effect.targetRef}` : ""}`;
}

/** `/api/plans/<project>/<plan>/asks` POST body. `check` derives the preview without recording; `submit` records it. */
export interface PlanAskRequest { mode: "check" | "submit"; kind: PlanAskKind; text: string; requestId: string }

export interface PlanAskCheckResponse {
  mode: "check";
  consequence: string;
  ask: Record<string, unknown>;
  effects: string[];
  requiredDecisions: string[];
}
export interface PlanAskSubmitResponse {
  mode: "submit";
  consequence: string;
  proposalId: string;
  requestId: string;
  replayed: boolean;
  effects: string[];
}

/** Mirrors `PlanAsk` in `src/plans/planAsks.ts`. */
export interface PlanAskRow {
  proposalId: string;
  requestId: string;
  intent: string;
  targetRef: string | null;
  desiredResult: string;
  rationale: string | null;
  createdAt: string;
  state: "previewed" | "pending" | "settled";
  disposition: "accepted" | "rejected" | null;
  settledAt: string | null;
}
export interface PlanAsksResponse { project: string; plan: string; asks: PlanAskRow[] }
