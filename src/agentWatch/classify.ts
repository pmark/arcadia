import type { ProviderCapacityReceipt } from "../codingAgents/capacity.js";
import {
  PEER_WATCH_CONTRACT_VERSION,
  PEER_WATCH_WINDOWS,
  bindCommentEvidence,
  bindCommitEvidence,
  parseIsoInstant,
  type AgentRef,
  type BindingExpectation,
  type BoundEvidence,
  type CommitObservation,
  type IssueCommentObservation,
  type PeerWatchChannel,
  type WatchedAgent
} from "./contract.js";

/**
 * Pure peer-watch classification. Given evidence a watcher already gathered,
 * say what state the owner of one governed Action is in, which evidence that
 * rests on and how old it is, and what a watcher may do about it.
 *
 * The rule this module exists to enforce: **a coding turn ending, a missing
 * process, a preserved local head, an absent pull request, or silence is never
 * proof that ownership was released.** Those observations are carried through
 * as `nonProof` and never change `ownership`. Ownership comes only from the
 * governed rows: the Action claim (`agent_worktree_reservations`, as
 * `getActiveActionClaim` reads it), the claim's principal, and for a managed
 * Session its `agent_sessions` status plus a `session_exit_receipts` row
 * (reconciled, not merely exited: Decision 0051's "proven terminal"). A
 * `stalled` owner still owns its work; a watcher escalates, it never takes over.
 */

export type Readable<T> = { readable: true; value: T } | { readable: false; reason: string };

export const PEER_WATCH_STATES = ["healthy", "idle", "stalled", "exhausted", "unknown"] as const;
export type PeerWatchState = (typeof PEER_WATCH_STATES)[number];

export type OwnershipState =
  /** An active claim with a principal that is not proven terminal. The owner owns the work. */
  | "held"
  /** Active claim, but its managed Session is terminal and reconciled; the Action resumes through `arcadia go` (Decision 0051). */
  | "principal_terminal"
  /** No active claim for the Action: it was settled, released, or its worktree retired. */
  | "released"
  | "unknown";

export const WATCHER_ACTIONS = ["observe", "offer_help", "escalate_to_operator", "continue_released_work"] as const;
export type WatcherAction = (typeof WATCHER_ACTIONS)[number];

export type SessionStatus = "prepared" | "running" | "completed" | "failed" | "needs_input";
const TERMINAL_SESSION_STATUSES: readonly SessionStatus[] = ["completed", "failed", "needs_input"];

/** The claim as `getActiveActionClaim` returned it (null: no active claim). */
export interface ClaimObservation {
  reservationId: string;
  project: string;
  actionId: string;
  generation: string;
  branch: string;
  worktreePath: string;
  createdAt: string;
}

export interface SessionObservation {
  id: string;
  agent: WatchedAgent;
  status: SessionStatus;
  branch: string;
  worktreePath: string;
  startedAt: string | null;
  lastActivityAt: string | null;
  stallFlaggedAt: string | null;
  /** The `session_exit_receipts` row, present only once the exit was reconciled. */
  exitReceipt: { id: string; outcome: string } | null;
}

/** Who holds the claim, in the vocabulary of `EnrollmentReceipt.principal`. */
export type PrincipalObservation =
  | { kind: "managed-session"; session: SessionObservation }
  | { kind: "native-runtime" | "prepared"; agent: WatchedAgent | null; id: string | null }
  | { kind: "unknown" };

export interface OwnershipObservation {
  claim: ClaimObservation | null;
  principal: PrincipalObservation;
}

/** Host and runtime observations that are recorded but can never prove release (or activity). */
export interface NonProofObservations {
  codingTurnEnded?: boolean;
  processInCandidate?: boolean | null;
  localHeadPreserved?: boolean;
  pullRequestOpen?: boolean | null;
  /** The owner posted `release_requested`; a request is not a release. */
  ownerRequestedRelease?: boolean;
}

export interface PeerWatchInput {
  now: Date;
  subject: { agent: WatchedAgent; project: string; actionId: string };
  ownership: Readable<OwnershipObservation>;
  commits: Readable<CommitObservation[]>;
  comments: Readable<IssueCommentObservation[]>;
  /** Null when the host has no receipt for this provider at all. */
  capacity: Readable<ProviderCapacityReceipt | null>;
  /** Comment author logins an operator Decision trusts; empty means comments never count. */
  trustedCommentAuthors: readonly string[];
  nonProof?: NonProofObservations;
}

export interface EvidenceItem {
  channel: PeerWatchChannel | "claim";
  ref: string;
  at: string | null;
  ageMs: number | null;
  counted: boolean;
  reason: string;
}

export interface NonProofItem { observation: keyof NonProofObservations; value: boolean | null; provesRelease: false }

export interface PeerWatchClassification {
  contractVersion: typeof PEER_WATCH_CONTRACT_VERSION;
  classifiedAt: string;
  subject: PeerWatchInput["subject"];
  state: PeerWatchState;
  reason: string;
  ownership: { state: OwnershipState; reason: string; claimGeneration: string | null; branch: string | null; sessionId: string | null };
  latestActivity: EvidenceItem | null;
  evidence: EvidenceItem[];
  unreadable: Array<PeerWatchChannel | "ownership">;
  nonProof: NonProofItem[];
  takeover: { eligible: boolean; basis: "claim_released" | "principal_proven_terminal" | null; recovery: string | null };
  permittedActions: WatcherAction[];
  /** The remedy an operator escalation names, when one is warranted. */
  escalation: string | null;
}

/** Provider ids as `agent_sessions.provider` and capacity receipts name them. */
export const PEER_WATCH_PROVIDER_IDS: Record<WatchedAgent, string> = {
  claude: "claude-code-cli",
  codex: "codex-cli",
  opencode: "opencode-cli"
};

/** The existing recovery each ownership outcome relies on. Nothing here runs them. */
export const PEER_WATCH_RECOVERY = {
  dispatchReleased: "arcadia go --agent <agent>",
  resumeAfterTerminal: "arcadia go --agent <agent>",
  reconcileExitedSession: "arcadia session reconcile <session-id>",
  ownerRelease: "the owner or its orchestrator releases or settles its own claim through its governed path and records a handoff receipt"
} as const;

const NON_PROOF_KEYS: Array<keyof NonProofObservations> = ["codingTurnEnded", "processInCandidate", "localHeadPreserved", "pullRequestOpen", "ownerRequestedRelease"];

export function classifyPeer(input: PeerWatchInput): PeerWatchClassification {
  const now = input.now.getTime();
  const evidence: EvidenceItem[] = [];
  const unreadable: PeerWatchClassification["unreadable"] = [];
  const item = (bound: Omit<BoundEvidence, "channel"> & { channel: EvidenceItem["channel"] }): EvidenceItem => ({
    channel: bound.channel, ref: bound.ref, counted: bound.counted, reason: bound.reason,
    at: bound.at === null ? null : new Date(bound.at).toISOString(),
    ageMs: bound.at === null ? null : Math.max(0, now - bound.at)
  });
  const nonProof: NonProofItem[] = NON_PROOF_KEYS
    .filter((key) => input.nonProof && key in input.nonProof)
    .map((key) => ({ observation: key, value: input.nonProof?.[key] ?? null, provesRelease: false }));
  const result = (
    state: PeerWatchState,
    reason: string,
    ownership: PeerWatchClassification["ownership"],
    latestActivity: EvidenceItem | null,
    escalation: string | null
  ): PeerWatchClassification => {
    const takeover = takeoverFor(ownership.state);
    return {
      contractVersion: PEER_WATCH_CONTRACT_VERSION,
      classifiedAt: input.now.toISOString(),
      subject: input.subject,
      state, reason, ownership, latestActivity, evidence, unreadable, nonProof, takeover,
      permittedActions: permittedActions(state, ownership.state),
      escalation
    };
  };

  for (const [channel, value] of [["commits", input.commits], ["issue_comments", input.comments], ["capacity", input.capacity]] as const) {
    if (!value.readable) unreadable.push(channel);
  }

  if (!input.ownership.readable) {
    unreadable.push("ownership");
    return result("unknown", `Ownership is unreadable (${input.ownership.reason}); nothing can be concluded about release or stall.`,
      { state: "unknown", reason: input.ownership.reason, claimGeneration: null, branch: null, sessionId: null }, null,
      "Restore read access to the workspace claim and session rows, then watch again.");
  }

  const { claim, principal } = input.ownership.value;
  const session = principal.kind === "managed-session" ? principal.session : null;
  const principalAgent = principal.kind === "managed-session" ? principal.session.agent : principal.kind === "unknown" ? null : principal.agent;
  const ownership = ownershipFor(claim, principal);

  if (claim && (claim.project !== input.subject.project || claim.actionId !== input.subject.actionId)) {
    return result("unknown", "The claim read for this watch names a different Action.", { ...ownership, state: "unknown" }, null, "Re-read the claim for the watched Action.");
  }
  if (ownership.state === "held" && principalAgent !== input.subject.agent) {
    return result("unknown", principalAgent === null
      ? "The claim's principal agent cannot be established, so no evidence can be bound to it."
      : `The claim is held by ${principalAgent}, not the watched ${input.subject.agent}.`,
    ownership, null, "Resolve the durable Action, reservation and principal before reading activity.");
  }

  // Capacity first: fresh evidence of a spent window or a usage/budget limit.
  const capacity = input.capacity.readable ? capacityEvidence(input.capacity.value, input.subject.agent, now) : null;
  if (capacity) evidence.push(capacity.item);

  if (ownership.state !== "held") {
    if (capacity?.exhausted) return result("exhausted", `${capacity.item.reason}; the agent holds no active owned work.`, ownership, null, null);
    return result("idle", ownership.reason, ownership, null, null);
  }

  // Held: gather activity across every channel.
  const expected: BindingExpectation = {
    agent: input.subject.agent, project: input.subject.project, actionId: input.subject.actionId,
    branch: claim?.branch ?? null, claimGeneration: claim?.generation ?? null
  };
  const claimAt = parseIsoInstant(claim?.createdAt);
  evidence.push(item({ channel: "claim", ref: `claim:${claim?.reservationId ?? "?"}`, at: claimAt, counted: claimAt !== null && claimAt <= now + PEER_WATCH_WINDOWS.clockSkewMs, reason: "claim acquired" }));
  if (session) {
    for (const [field, value] of [["startedAt", session.startedAt], ["lastActivityAt", session.lastActivityAt]] as const) {
      const at = parseIsoInstant(value);
      if (at !== null) evidence.push(item({ channel: "session_rows", ref: `session:${session.id}#${field}`, at, counted: at <= now + PEER_WATCH_WINDOWS.clockSkewMs, reason: `session ${field}` }));
    }
    if (session.stallFlaggedAt) evidence.push(item({ channel: "session_rows", ref: `session:${session.id}#stallFlaggedAt`, at: parseIsoInstant(session.stallFlaggedAt), counted: false, reason: "managed stall flag set (lease preserved)" }));
  }
  if (input.commits.readable) for (const commit of input.commits.value) evidence.push(item(bindCommitEvidence(commit, expected, now)));
  if (input.comments.readable) for (const bound of bindCommentEvidence(input.comments.value, expected, input.trustedCommentAuthors, now)) evidence.push(item(bound));

  const counted = evidence.filter((entry) => entry.counted && entry.at !== null && entry.channel !== "capacity");
  const latest = counted.reduce<EvidenceItem | null>((best, entry) => (!best || Date.parse(entry.at!) > Date.parse(best.at!) ? entry : best), null);
  const age = latest?.ageMs ?? Number.POSITIVE_INFINITY;

  if (capacity?.exhausted) {
    return result("exhausted", `${capacity.item.reason}; the owner still holds the claim.`, ownership, latest,
      `Owner is out of capacity until ${capacity.retryAfter ?? "a fresh observation"}; ask the owner or operator to release through ${PEER_WATCH_RECOVERY.ownerRelease}, or wait for the reset.`);
  }
  if (age <= PEER_WATCH_WINDOWS.activityFreshMs) return result("healthy", `Fresh owner activity (${latest!.reason}).`, ownership, latest, null);
  if (age <= PEER_WATCH_WINDOWS.stallAfterMs) return result("idle", `Owner is quiet but within the stall window (latest: ${latest?.reason ?? "none"}); waiting for review, QA or a procedure is normal.`, ownership, latest, null);
  const missing = (["commits", "issue_comments", "capacity"] as const).filter((channel) => unreadable.includes(channel));
  if (missing.length) {
    return result("unknown", `No fresh activity on the readable channels, but ${missing.join(", ")} could not be read, so silence across all channels is unproven.`, ownership, latest,
      `Restore ${missing.join(", ")} and watch again.`);
  }
  const remedy = session && TERMINAL_SESSION_STATUSES.includes(session.status) && !session.exitReceipt
    ? `The Session exited but is not reconciled; the operator may judge it and run ${PEER_WATCH_RECOVERY.reconcileExitedSession.replace("<session-id>", session.id)}.`
    : `Ask the owner's orchestrator or the operator; only ${PEER_WATCH_RECOVERY.ownerRelease} hands the work over.`;
  return result("stalled", `No fresh owner activity on any channel for more than ${PEER_WATCH_WINDOWS.stallAfterMs / 60_000} minutes; the owner still holds the claim.`, ownership, latest, remedy);
}

function ownershipFor(claim: ClaimObservation | null, principal: PrincipalObservation): PeerWatchClassification["ownership"] {
  const session = principal.kind === "managed-session" ? principal.session : null;
  const base = { claimGeneration: claim?.generation ?? null, branch: claim?.branch ?? null, sessionId: session?.id ?? null };
  if (!claim) return { ...base, state: "released", reason: "No active claim for this Action: it was settled, released, or its worktree retired." };
  if (session && TERMINAL_SESSION_STATUSES.includes(session.status) && session.exitReceipt
    && session.worktreePath === claim.worktreePath && session.branch === claim.branch) {
    return { ...base, state: "principal_terminal", reason: `Session ${session.id} is ${session.status} and reconciled (exit receipt ${session.exitReceipt.id}, ${session.exitReceipt.outcome}); the claim continues for the same Action (Decision 0051).` };
  }
  if (session && TERMINAL_SESSION_STATUSES.includes(session.status)) {
    return { ...base, state: "held", reason: `Session ${session.id} is ${session.status} but not reconciled, or not bound to this candidate; exited is not proven terminal.` };
  }
  if (principal.kind === "native-runtime" || principal.kind === "prepared") {
    return { ...base, state: "held", reason: `The claim's ${principal.kind} principal has no Session row that could prove it terminal; only its own or its orchestrator's explicit release counts.` };
  }
  return { ...base, state: "held", reason: "An active claim with a live or unproven principal." };
}

function capacityEvidence(receipt: ProviderCapacityReceipt | null, agent: WatchedAgent, now: number): { item: EvidenceItem; exhausted: boolean; retryAfter: string | null } | null {
  if (!receipt) return null;
  const observedAt = parseIsoInstant(receipt.observedAt);
  const ageMs = observedAt === null ? null : Math.max(0, now - observedAt);
  const make = (counted: boolean, reason: string): EvidenceItem => ({
    channel: "capacity", ref: `capacity:${receipt.providerId}:${receipt.source}:${receipt.evidence}`,
    at: observedAt === null ? null : new Date(observedAt).toISOString(), ageMs, counted, reason
  });
  if (receipt.providerId !== PEER_WATCH_PROVIDER_IDS[agent]) return { item: make(false, `capacity receipt is for ${receipt.providerId}, not ${PEER_WATCH_PROVIDER_IDS[agent]}`), exhausted: false, retryAfter: null };
  if (receipt.source === "none" || receipt.source === "operator_config" || receipt.confidence === "unknown") return { item: make(false, `no capacity observation (${receipt.source})`), exhausted: false, retryAfter: null };
  if (observedAt === null || ageMs === null || receipt.freshness !== "fresh" || ageMs > PEER_WATCH_WINDOWS.capacityFreshMs || observedAt > now + PEER_WATCH_WINDOWS.clockSkewMs) {
    return { item: make(false, "capacity evidence is not fresh, so it cannot show exhaustion"), exhausted: false, retryAfter: null };
  }
  const spent = receipt.windows.filter((window) => window.usedPercentage >= 100 && !(window.resetsAt && Date.parse(window.resetsAt) <= now));
  const limited = receipt.availability === "usage_limited" || receipt.availability === "budget_limited";
  if (!spent.length && !limited) return { item: make(true, `capacity available (${receipt.availability})`), exhausted: false, retryAfter: null };
  const reason = spent.length
    ? `${receipt.providerLabel}'s ${spent[0].label} window is spent (${spent[0].usedPercentage}% used, ${receipt.evidence} evidence)`
    : `${receipt.providerLabel} reports ${receipt.availability} (${receipt.evidence} evidence)`;
  return { item: make(true, reason), exhausted: true, retryAfter: spent[0]?.resetsAt ?? receipt.nextResetAt };
}

function takeoverFor(state: OwnershipState): PeerWatchClassification["takeover"] {
  if (state === "released") return { eligible: true, basis: "claim_released", recovery: PEER_WATCH_RECOVERY.dispatchReleased };
  if (state === "principal_terminal") return { eligible: true, basis: "principal_proven_terminal", recovery: PEER_WATCH_RECOVERY.resumeAfterTerminal };
  return { eligible: false, basis: null, recovery: null };
}

function permittedActions(state: PeerWatchState, ownership: OwnershipState): WatcherAction[] {
  if (ownership === "released" || ownership === "principal_terminal") return ["observe", "continue_released_work"];
  if (ownership === "unknown" || state === "unknown") return ["observe", "escalate_to_operator"];
  if (state === "healthy") return ["observe"];
  if (state === "idle") return ["observe", "offer_help"];
  return ["observe", "offer_help", "escalate_to_operator"];
}

// ---------------------------------------------------------------------------
// Takeover requests
// ---------------------------------------------------------------------------

export const PEER_TAKEOVER_REQUEST_SCHEMA = "arcadia-peer-takeover-request-v1" as const;

/** What a peer must present before continuing another agent's Action. */
export interface PeerTakeoverRequest {
  schema: typeof PEER_TAKEOVER_REQUEST_SCHEMA;
  requester: AgentRef;
  subject: PeerWatchInput["subject"];
  claim: { generation: string | null; branch: string | null };
  basis: "claim_released" | "principal_proven_terminal";
  proof: { sessionId: string | null };
  observed: { state: PeerWatchState; classifiedAt: string; evidenceRefs: string[] };
  /** The existing governed command it relies on; this contract adds no new release path. */
  recovery: string;
}

export type TakeoverDecision = { ok: true; request: PeerTakeoverRequest } | { ok: false; reasons: string[] };

/** Build a takeover request from a classification, refusing unless ownership was released or its principal proven terminal. */
export function buildTakeoverRequest(classification: PeerWatchClassification, requester: AgentRef): TakeoverDecision {
  const { takeover, ownership } = classification;
  if (!takeover.eligible || !takeover.basis || !takeover.recovery) {
    return { ok: false, reasons: [`Ownership is ${ownership.state}: ${ownership.reason} A watcher may only ${classification.permittedActions.join(", ")}.`] };
  }
  return {
    ok: true,
    request: {
      schema: PEER_TAKEOVER_REQUEST_SCHEMA,
      requester,
      subject: classification.subject,
      claim: { generation: ownership.claimGeneration, branch: ownership.branch },
      basis: takeover.basis,
      proof: { sessionId: ownership.sessionId },
      observed: { state: classification.state, classifiedAt: classification.classifiedAt, evidenceRefs: classification.evidence.filter((entry) => entry.counted).map((entry) => entry.ref) },
      recovery: takeover.recovery.replace("<agent>", requester.agent)
    }
  };
}

/**
 * Re-validate a request against a classification re-read immediately before
 * acting. Ownership can move between the two reads; the claim generation is
 * the fence, exactly as `assertActionClaimGeneration` uses it.
 */
export function validateTakeoverRequest(request: PeerTakeoverRequest, current: PeerWatchClassification): TakeoverDecision {
  const reasons: string[] = [];
  if (request.schema !== PEER_TAKEOVER_REQUEST_SCHEMA) reasons.push("unknown takeover request schema");
  if (request.subject.project !== current.subject.project || request.subject.actionId !== current.subject.actionId || request.subject.agent !== current.subject.agent) reasons.push("request names a different subject");
  if (!current.takeover.eligible || current.takeover.basis !== request.basis) reasons.push(`ownership is now ${current.ownership.state}, not ${request.basis}`);
  if (request.claim.generation !== current.ownership.claimGeneration) reasons.push("claim generation moved since the request was built");
  if (request.proof.sessionId !== current.ownership.sessionId) reasons.push("terminal principal changed since the request was built");
  return reasons.length ? { ok: false, reasons } : { ok: true, request };
}
