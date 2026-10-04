import type { ProviderCapacityReceipt } from "../codingAgents/capacity.js";
import {
  PEER_WATCH_CONTRACT_VERSION,
  PEER_WATCH_WINDOWS,
  bindCommentEvidence,
  bindCommitEvidence,
  normalizeBranch,
  parseActionRef,
  parseAgentRef,
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
 * Session its `agent_sessions` status plus its `session_exit_receipts` row.
 * Everything fails closed: when the rows do not affirmatively show a release
 * or a resumable terminal handoff, ownership is `held` or `unknown`, never
 * `released`. A `stalled` owner still owns its work; a watcher escalates, it
 * never takes over.
 */

export type Readable<T> = { readable: true; value: T } | { readable: false; reason: string };

export const PEER_WATCH_STATES = ["healthy", "idle", "stalled", "exhausted", "unknown"] as const;
export type PeerWatchState = (typeof PEER_WATCH_STATES)[number];

export type OwnershipState =
  /** A principal owns the work (with or without a readable Action claim). */
  | "held"
  /**
   * The claim's managed Session is terminal with an unsuperseded, real
   * `incomplete_resumable` lease handoff: the exact receipt `arcadia go`
   * resumes from (`getResumableLeaseHandoff`, Decision 0051).
   */
  | "principal_terminal"
  /** No claim, and the caller affirmed no live Session, no reservation and no manual handoff for this Action. */
  | "released"
  | "unknown";

export const WATCHER_ACTIONS = ["observe", "offer_help", "escalate_to_operator", "continue_released_work"] as const;
export type WatcherAction = (typeof WATCHER_ACTIONS)[number];

export type SessionStatus = "prepared" | "running" | "completed" | "failed" | "needs_input";
const LIVE_SESSION_STATUSES: readonly SessionStatus[] = ["prepared", "running"];
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

/** The `session_exit_receipts` row for a Session, present only once its exit was reconciled. */
export interface ExitReceiptObservation {
  id: string;
  outcome: "successful_exit" | "failed_execution" | "missing_evidence" | "needs_input" | "incomplete_resumable" | "accepted_completion";
  leaseHandoff: boolean;
  supersededBySessionId: string | null;
  /** A fixture receipt is never live proof. */
  isSimulated: boolean;
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
  exitReceipt: ExitReceiptObservation | null;
}

/** Who holds the work, in the vocabulary of `EnrollmentReceipt.principal`; `none` means the caller observed no principal. */
export type PrincipalObservation =
  | { kind: "managed-session"; session: SessionObservation }
  | { kind: "native-runtime" | "prepared"; agent: WatchedAgent | null; id: string | null }
  | { kind: "none" }
  | { kind: "unknown" };

/**
 * Facts a caller must read and affirm before an absent claim can mean
 * released. `getActiveActionClaim` returns null in cases where an owner still
 * exists (a reservation without claim columns, a claim whose worktree is gone,
 * a manual or native handoff), so null alone proves nothing.
 */
export interface ReleaseFacts {
  /** A `prepared` or `running` `agent_sessions` row for this Action or its candidate. */
  liveSession: boolean;
  /** Any `agent_worktree_reservations` row for this Action or its candidate, with or without claim columns. */
  reservation: boolean;
  /** A manual or native handoff, or a pending enrollment, for this Action. */
  manualHandoff: boolean;
  /** An identity for the release (a settlement or release receipt id), when one exists; it fences takeover requests across re-claims. */
  releaseRef: string | null;
}

export interface OwnershipObservation {
  claim: ClaimObservation | null;
  principal: PrincipalObservation;
  /** Required for `released`; null means not read, which fails closed. */
  releaseFacts: ReleaseFacts | null;
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

export interface OwnershipResult {
  state: OwnershipState;
  reason: string;
  claimGeneration: string | null;
  branch: string | null;
  sessionId: string | null;
  exitReceiptId: string | null;
  releaseRef: string | null;
}

export interface PeerWatchClassification {
  contractVersion: typeof PEER_WATCH_CONTRACT_VERSION;
  classifiedAt: string;
  subject: PeerWatchInput["subject"];
  state: PeerWatchState;
  reason: string;
  ownership: OwnershipResult;
  latestActivity: EvidenceItem | null;
  evidence: EvidenceItem[];
  unreadable: Array<PeerWatchChannel | "ownership">;
  nonProof: NonProofItem[];
  takeover: { eligible: boolean; basis: TakeoverBasis | null };
  permittedActions: WatcherAction[];
  /** The remedy an operator escalation names, when one is warranted. */
  escalation: string | null;
}

export type TakeoverBasis = "claim_released" | "principal_proven_terminal";

/** Provider ids as `agent_sessions.provider` and capacity receipts name them. */
export const PEER_WATCH_PROVIDER_IDS: Record<WatchedAgent, string> = {
  claude: "claude-code-cli",
  codex: "codex-cli",
  opencode: "opencode-cli"
};

/**
 * The existing recovery a takeover relies on. `arcadia go` without `--apply`
 * is a preview and changes nothing; with `--apply` it dispatches (or, for a
 * resumable handoff, resumes) the Action the Project pointer names, not the
 * watched one, so a takeover is valid only while the pointer names it.
 */
export function takeoverRecovery(requester: WatchedAgent): { preview: string; apply: string } {
  return { preview: `arcadia go --agent ${requester}`, apply: `arcadia go --agent ${requester} --apply` };
}

export const PEER_WATCH_ESCALATIONS = {
  reconcile: "arcadia session reconcile <session-id>",
  ownerRelease: "the owner or its orchestrator releases or settles its own claim through its governed path and records a handoff receipt"
} as const;

/**
 * The classification table, as data. The procedure's table is this table, a
 * test holds them equal, and a test realizes every row with a fixture.
 */
export const PEER_WATCH_CLASSIFICATION_TABLE = [
  { id: "ownership-unreadable", evidence: "Ownership rows unreadable", state: "unknown", ownership: "unknown", watcher: "observe, escalate" },
  { id: "principal-mismatch", evidence: "Principal agent unknown or a different agent than the watched one (any claim state)", state: "unknown", ownership: "unknown", watcher: "observe, escalate" },
  { id: "no-claim-unaffirmed", evidence: "No claim; release facts not read, or principal unknown", state: "unknown", ownership: "unknown", watcher: "observe, escalate" },
  { id: "no-claim-owner-exists", evidence: "No claim; a prepared or running Session, a reservation, a manual handoff or a native/prepared principal exists", state: "unknown", ownership: "held", watcher: "observe, escalate" },
  { id: "released", evidence: "No claim; no principal; caller affirms no live Session, no reservation and no manual handoff", state: "idle", ownership: "released", watcher: "observe, continue released work (pointer must name the Action)" },
  { id: "principal-terminal", evidence: "Claim held; its managed Session is terminal with a real, unsuperseded `incomplete_resumable` lease handoff on this candidate", state: "idle", ownership: "principal_terminal", watcher: "observe, continue released work (pointer must name the Action)" },
  { id: "exited-not-resumable", evidence: "Claim held; its Session exited but is unreconciled, `needs_input`, simulated, superseded or reconciled with any other outcome", state: "by activity", ownership: "held", watcher: "the activity row's actions, plus escalate" },
  { id: "exhausted", evidence: "Claim held; fresh `real` capacity evidence of a spent window, `usage_limited` or `budget_limited`", state: "exhausted", ownership: "held", watcher: "observe, offer help, escalate" },
  { id: "healthy", evidence: "Claim held; latest counted activity within `activityFreshMs`", state: "healthy", ownership: "held", watcher: "observe" },
  { id: "idle", evidence: "Claim held; latest counted activity within `stallAfterMs`", state: "idle", ownership: "held", watcher: "observe, offer help" },
  { id: "silence-unproven", evidence: "Claim held; nothing counted within `stallAfterMs`; some channel unreadable", state: "unknown", ownership: "held", watcher: "observe, escalate" },
  { id: "stalled", evidence: "Claim held; nothing counted within `stallAfterMs`; every channel read", state: "stalled", ownership: "held", watcher: "observe, offer help, escalate" }
] as const;

const NON_PROOF_KEYS: Array<keyof NonProofObservations> = ["codingTurnEnded", "processInCandidate", "localHeadPreserved", "pullRequestOpen", "ownerRequestedRelease"];

interface OwnershipDerivation { result: OwnershipResult; principalAgent: WatchedAgent | null; escalation: string | null }

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
  let ownershipEscalation: string | null = null;
  const result = (state: PeerWatchState, reason: string, ownership: OwnershipResult, latestActivity: EvidenceItem | null, escalation: string | null): PeerWatchClassification => {
    const basis: TakeoverBasis | null = ownership.state === "released" ? "claim_released" : ownership.state === "principal_terminal" ? "principal_proven_terminal" : null;
    const combined = [escalation, ownershipEscalation].filter((text): text is string => !!text);
    const actions = permittedActions(state, ownership.state);
    if (combined.length && !actions.includes("escalate_to_operator")) actions.push("escalate_to_operator");
    return {
      contractVersion: PEER_WATCH_CONTRACT_VERSION,
      classifiedAt: input.now.toISOString(),
      subject: input.subject,
      state, reason, ownership, latestActivity, evidence, unreadable, nonProof,
      takeover: { eligible: basis !== null, basis },
      permittedActions: actions,
      escalation: combined.length ? [...new Set(combined)].join(" ") : null
    };
  };

  for (const [channel, value] of [["commits", input.commits], ["issue_comments", input.comments], ["capacity", input.capacity]] as const) {
    if (!value.readable) unreadable.push(channel);
  }

  if (!input.ownership.readable) {
    unreadable.push("ownership");
    return result("unknown", `Ownership is unreadable (${input.ownership.reason}); nothing can be concluded about release or stall.`,
      emptyOwnership("unknown", input.ownership.reason), null,
      "Restore read access to the workspace claim and session rows, then watch again.");
  }

  const derived = deriveOwnership(input.ownership.value, input.subject);
  const ownership = derived.result;
  ownershipEscalation = derived.escalation;
  const { claim, principal } = input.ownership.value;
  const session = principal.kind === "managed-session" ? principal.session : null;

  // Capacity: only fresh, real evidence for the owner's own provider can show exhaustion.
  const capacity = input.capacity.readable ? capacityEvidence(input.capacity.value, input.subject.agent, now) : null;
  if (capacity) evidence.push(capacity.item);

  if (ownership.state === "unknown") {
    return result("unknown", ownership.reason, ownership, null, "Resolve the durable Action, reservation and principal before reading activity.");
  }
  if (ownership.state === "released" || ownership.state === "principal_terminal") {
    if (capacity?.exhausted) return result("exhausted", `${capacity.item.reason}; ${ownership.reason}`, ownership, null, null);
    return result("idle", ownership.reason, ownership, null, null);
  }
  if (!claim) {
    return result("unknown", `${ownership.reason} Without a claim, activity cannot be bound to a candidate.`, ownership, null,
      `An owner exists without an Action claim; report it to the operator. Only ${PEER_WATCH_ESCALATIONS.ownerRelease} hands it over.`);
  }

  // Held with a claim: gather activity across every channel.
  const expected: BindingExpectation = {
    agent: input.subject.agent, project: input.subject.project, actionId: input.subject.actionId,
    branch: claim.branch, claimGeneration: claim.generation
  };
  const claimAt = parseIsoInstant(claim.createdAt);
  evidence.push(item({ channel: "claim", ref: `claim:${claim.reservationId}`, at: claimAt, counted: claimAt !== null && claimAt <= now + PEER_WATCH_WINDOWS.clockSkewMs, reason: "claim acquired" }));
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

  // Exhausted takes precedence over healthy even when the owner committed
  // seconds ago: fresh capacity evidence predicts no further progress.
  // `latestActivity` still reports that commit.
  if (capacity?.exhausted) {
    return result("exhausted", `${capacity.item.reason}; the owner still holds the claim.`, ownership, latest,
      `Owner is out of capacity until ${capacity.retryAfter ?? "a fresh observation"}; wait for the reset, or ${PEER_WATCH_ESCALATIONS.ownerRelease}.`);
  }
  if (age <= PEER_WATCH_WINDOWS.activityFreshMs) return result("healthy", `Fresh owner activity (${latest!.reason}).`, ownership, latest, null);
  if (age <= PEER_WATCH_WINDOWS.stallAfterMs) return result("idle", `Owner is quiet but within the stall window (latest: ${latest?.reason ?? "none"}); waiting for review, QA or a procedure is normal.`, ownership, latest, null);
  const missing = (["commits", "issue_comments", "capacity"] as const).filter((channel) => unreadable.includes(channel));
  if (missing.length) {
    return result("unknown", `No fresh activity on the readable channels, but ${missing.join(", ")} could not be read, so silence across all channels is unproven.`, ownership, latest,
      `Restore ${missing.join(", ")} and watch again.`);
  }
  return result("stalled", `No fresh owner activity on any channel for more than ${PEER_WATCH_WINDOWS.stallAfterMs / 60_000} minutes; the owner still holds the claim.`, ownership, latest,
    `Ask the owner's orchestrator or the operator; only ${PEER_WATCH_ESCALATIONS.ownerRelease} hands the work over.`);
}

function emptyOwnership(state: OwnershipState, reason: string): OwnershipResult {
  return { state, reason, claimGeneration: null, branch: null, sessionId: null, exitReceiptId: null, releaseRef: null };
}

function principalAgentOf(principal: PrincipalObservation): WatchedAgent | null {
  if (principal.kind === "managed-session") return principal.session.agent;
  if (principal.kind === "native-runtime" || principal.kind === "prepared") return principal.agent;
  return null;
}

function deriveOwnership(observed: OwnershipObservation, subject: PeerWatchInput["subject"]): OwnershipDerivation {
  const { claim, principal, releaseFacts } = observed;
  const session = principal.kind === "managed-session" ? principal.session : null;
  const principalAgent = principalAgentOf(principal);
  const base: OwnershipResult = {
    ...emptyOwnership("unknown", ""),
    claimGeneration: claim?.generation ?? null,
    branch: normalizeBranch(claim?.branch ?? session?.branch ?? null),
    sessionId: session?.id ?? null
  };
  const unknown = (reason: string): OwnershipDerivation => ({ result: { ...base, state: "unknown", reason }, principalAgent, escalation: null });
  const held = (reason: string, escalation: string | null = null): OwnershipDerivation => {
    // B3: a held work unit can only be bound to the watched agent when its principal is that agent.
    if (principalAgent !== subject.agent) {
      return unknown(principalAgent === null
        ? `${reason} Its principal agent cannot be established, so no evidence can be bound to it.`
        : `${reason} It is held by ${principalAgent}, not the watched ${subject.agent}.`);
    }
    return { result: { ...base, state: "held", reason }, principalAgent, escalation };
  };

  if (claim && (claim.project !== subject.project || claim.actionId !== subject.actionId)) return unknown("The claim read for this watch names a different Action.");

  if (!claim) {
    const liveSession = session !== null && LIVE_SESSION_STATUSES.includes(session.status);
    const ownerSignals = [
      liveSession ? `Session ${session.id} is ${session.status}` : null,
      releaseFacts?.liveSession ? "a prepared or running Session row exists" : null,
      releaseFacts?.reservation ? "a worktree reservation exists" : null,
      releaseFacts?.manualHandoff ? "a manual or native handoff exists" : null,
      principal.kind === "native-runtime" || principal.kind === "prepared" ? `a ${principal.kind} principal exists` : null
    ].filter((signal): signal is string => !!signal);
    if (ownerSignals.length) return held(`No Action claim, but ${ownerSignals.join("; ")}: an absent claim does not prove release.`);
    if (principal.kind === "unknown") return unknown("No Action claim, and the principal is unknown; an absent claim alone does not prove release.");
    if (!releaseFacts) return unknown("No Action claim, but the release facts (no live Session, no reservation, no manual handoff) were not read.");
    if (principal.kind === "managed-session" && !(session && TERMINAL_SESSION_STATUSES.includes(session.status))) return unknown("No Action claim, and the Session's status is not terminal.");
    return {
      result: { ...base, state: "released", releaseRef: releaseFacts.releaseRef, reason: "No active claim, no principal, no live Session, no reservation and no manual handoff for this Action." },
      principalAgent, escalation: null
    };
  }

  if (principal.kind === "unknown" || principal.kind === "none") return unknown("The claim's principal cannot be established.");
  if (principal.kind !== "managed-session") {
    return held(`The claim's ${principal.kind} principal has no Session row that could prove it terminal; only its own or its orchestrator's explicit release counts.`);
  }
  const live = principal.session;
  if (LIVE_SESSION_STATUSES.includes(live.status)) return held(`Session ${live.id} is ${live.status}.`);
  const receipt = live.exitReceipt;
  const reconcile = PEER_WATCH_ESCALATIONS.reconcile.replace("<session-id>", live.id);
  if (!receipt) return held(`Session ${live.id} is ${live.status} but not reconciled; exited is not proven terminal.`, `Session ${live.id} exited but is not reconciled; the operator may judge it and run ${reconcile}.`);
  if (live.status === "needs_input" || receipt.outcome === "needs_input") {
    return held(`Session ${live.id} is waiting on an operator question (needs_input).`, `Session ${live.id} is waiting on an operator question; answer it through the operator surface and the owner resumes.`);
  }
  if (receipt.isSimulated) return held(`Session ${live.id}'s exit receipt ${receipt.id} is a fixture receipt, never live proof.`, `Exit receipt ${receipt.id} is simulated; the operator judges the real Session state.`);
  if (receipt.outcome !== "incomplete_resumable" || !receipt.leaseHandoff) {
    return held(`Session ${live.id} reconciled as ${receipt.outcome}${receipt.leaseHandoff ? "" : " without a lease handoff"}, which is not a resumable handoff.`,
      `Session ${live.id} reconciled as ${receipt.outcome}; it is not a resumable lease handoff, so the operator judges the next move.`);
  }
  if (receipt.supersededBySessionId) return held(`Session ${live.id}'s handoff was already taken by Session ${receipt.supersededBySessionId}.`, `The handoff from ${live.id} is superseded by ${receipt.supersededBySessionId}; watch that Session instead.`);
  if (live.worktreePath !== claim.worktreePath || normalizeBranch(live.branch) !== normalizeBranch(claim.branch)) {
    return held(`Session ${live.id}'s handoff is not bound to this claim's candidate.`, `Session ${live.id}'s handoff names a different candidate than the claim; the operator reconciles them.`);
  }
  const terminal = held(`Session ${live.id} is ${live.status} with an unsuperseded incomplete_resumable lease handoff (exit receipt ${receipt.id}); the same Action resumes its candidate (Decision 0051).`);
  if (terminal.result.state !== "held") return terminal;
  return { ...terminal, result: { ...terminal.result, state: "principal_terminal", exitReceiptId: receipt.id } };
}

function capacityEvidence(receipt: ProviderCapacityReceipt | null, agent: WatchedAgent, now: number): { item: EvidenceItem; exhausted: boolean; retryAfter: string | null } | null {
  if (!receipt) return null;
  const observedAt = parseIsoInstant(receipt.observedAt);
  const ageMs = observedAt === null ? null : Math.max(0, now - observedAt);
  const make = (counted: boolean, reason: string): EvidenceItem => ({
    channel: "capacity", ref: `capacity:${receipt.providerId}:${receipt.source}:${receipt.evidence}`,
    at: observedAt === null ? null : new Date(observedAt).toISOString(), ageMs, counted, reason
  });
  const none = (reason: string) => ({ item: make(false, reason), exhausted: false, retryAfter: null });
  if (receipt.providerId !== PEER_WATCH_PROVIDER_IDS[agent]) return none(`capacity receipt is for ${receipt.providerId}, not ${PEER_WATCH_PROVIDER_IDS[agent]}`);
  if (receipt.evidence !== "real") return none(`capacity evidence is ${String(receipt.evidence)}, never live proof`);
  if (receipt.source === "none" || receipt.source === "operator_config" || receipt.confidence === "unknown") return none(`no capacity observation (${receipt.source})`);
  if (observedAt === null || ageMs === null || receipt.freshness !== "fresh" || ageMs > PEER_WATCH_WINDOWS.capacityFreshMs || observedAt > now + PEER_WATCH_WINDOWS.clockSkewMs) {
    return none("capacity evidence is not fresh, so it cannot show exhaustion");
  }
  const spent = receipt.windows.filter((window) => {
    const resetsAt = parseIsoInstant(window.resetsAt);
    return window.usedPercentage >= 100 && !(resetsAt !== null && resetsAt <= now);
  });
  const limited = receipt.availability === "usage_limited" || receipt.availability === "budget_limited";
  if (!spent.length && !limited) return { item: make(true, `capacity available (${receipt.availability})`), exhausted: false, retryAfter: null };
  const reason = spent.length
    ? `${receipt.providerLabel}'s ${spent[0].label} window is spent (${spent[0].usedPercentage}% used)`
    : `${receipt.providerLabel} reports ${receipt.availability}`;
  return { item: make(true, reason), exhausted: true, retryAfter: spent[0]?.resetsAt ?? receipt.nextResetAt };
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
  /** The Action `arcadia go --apply` must start; valid only while the Project pointer names it. */
  target: { project: string; actionId: string };
  claim: { generation: string | null; branch: string | null };
  basis: TakeoverBasis;
  proof: { sessionId: string | null; exitReceiptId: string | null; releaseRef: string | null };
  observed: { state: PeerWatchState; classifiedAt: string; evidenceRefs: string[] };
  /** The existing governed command it relies on; this contract adds no new release path. */
  recovery: { preview: string; apply: string };
}

export type TakeoverDecision = { ok: true; request: PeerTakeoverRequest } | { ok: false; reasons: string[] };

/** Build a takeover request from a classification, refusing unless ownership was released or its principal proven terminal. */
export function buildTakeoverRequest(classification: PeerWatchClassification, requester: AgentRef): TakeoverDecision {
  const { takeover, ownership } = classification;
  if (!takeover.eligible || !takeover.basis) {
    return { ok: false, reasons: [`Ownership is ${ownership.state}: ${ownership.reason} A watcher may only ${classification.permittedActions.join(", ")}.`] };
  }
  return {
    ok: true,
    request: {
      schema: PEER_TAKEOVER_REQUEST_SCHEMA,
      requester,
      subject: classification.subject,
      target: { project: classification.subject.project, actionId: classification.subject.actionId },
      claim: { generation: ownership.claimGeneration, branch: ownership.branch },
      basis: takeover.basis,
      proof: { sessionId: ownership.sessionId, exitReceiptId: ownership.exitReceiptId, releaseRef: ownership.releaseRef },
      observed: { state: classification.state, classifiedAt: classification.classifiedAt, evidenceRefs: classification.evidence.filter((entry) => entry.counted).map((entry) => entry.ref) },
      recovery: takeoverRecovery(requester.agent)
    }
  };
}

export interface TakeoverValidationContext {
  now: Date;
  /** The Project pointer's current Action, read immediately before acting; null when unreadable. */
  pointer: { project: string; actionId: string } | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isStringOrNull = (value: unknown): value is string | null => value === null || typeof value === "string";

/**
 * Re-validate a request (untrusted input: it may have travelled through a
 * comment or a file) against a classification re-read immediately before
 * acting. The claim generation, terminal Session and release identity are the
 * fence, exactly as `assertActionClaimGeneration` uses the generation; both
 * the request and the classification must be recent and in order; the
 * recovery must be exactly the governed command for the requester; and the
 * Project pointer must name the target Action, because `arcadia go` starts
 * the pointer's Action. Malformed input is refused, never thrown on.
 *
 * Residual risk: a `claim_released` request whose release has no `releaseRef`
 * (both sides null) cannot tell one release from a later re-claim and
 * re-release; the `takeoverMaxAgeMs` bound on the request limits that window.
 */
export function validateTakeoverRequest(request: unknown, current: PeerWatchClassification, context: TakeoverValidationContext): TakeoverDecision {
  const shape = takeoverShape(request);
  if (shape.length) return { ok: false, reasons: shape };
  const valid = request as PeerTakeoverRequest;
  const reasons: string[] = [];
  const now = context.now.getTime();
  const requester = parseAgentRef(`${valid.requester.agent}/${valid.requester.tier}`);
  if (!requester) reasons.push("requester is not a supported agent and tier");
  if (valid.subject.project !== current.subject.project || valid.subject.actionId !== current.subject.actionId || valid.subject.agent !== current.subject.agent) reasons.push("request names a different subject");
  if (valid.target.project !== valid.subject.project || valid.target.actionId !== valid.subject.actionId) reasons.push("target Action differs from the watched Action");
  if (!context.pointer || context.pointer.project !== valid.target.project || context.pointer.actionId !== valid.target.actionId) reasons.push("the Project pointer does not name the target Action, so arcadia go would start different work");
  if (!current.takeover.eligible || current.takeover.basis !== valid.basis) reasons.push(`ownership is now ${current.ownership.state}, not ${valid.basis}`);
  if (valid.claim.generation !== current.ownership.claimGeneration) reasons.push("claim generation moved since the request was built");
  if (valid.claim.branch !== current.ownership.branch) reasons.push("candidate branch changed since the request was built");
  if (valid.proof.sessionId !== current.ownership.sessionId || valid.proof.exitReceiptId !== current.ownership.exitReceiptId) reasons.push("terminal principal changed since the request was built");
  if (valid.proof.releaseRef !== current.ownership.releaseRef) reasons.push("release identity changed since the request was built (re-claimed and released again)");
  if (requester) {
    const expected = takeoverRecovery(requester.agent);
    if (valid.recovery.preview !== expected.preview || valid.recovery.apply !== expected.apply) reasons.push("recovery is not the governed command for this requester");
  }
  const observedAt = parseIsoInstant(valid.observed.classifiedAt);
  const currentAt = parseIsoInstant(current.classifiedAt);
  if (observedAt === null || currentAt === null) reasons.push("classification time unreadable");
  else {
    if (currentAt < observedAt) reasons.push("current classification is older than the request");
    if (now - currentAt > PEER_WATCH_WINDOWS.takeoverMaxAgeMs || currentAt > now + PEER_WATCH_WINDOWS.clockSkewMs) reasons.push("current classification is not fresh");
    if (now - observedAt > PEER_WATCH_WINDOWS.takeoverMaxAgeMs || observedAt > now + PEER_WATCH_WINDOWS.clockSkewMs) reasons.push("request is not fresh");
  }
  return reasons.length ? { ok: false, reasons } : { ok: true, request: valid };
}

function takeoverShape(request: unknown): string[] {
  if (!isRecord(request)) return ["request is not an object"];
  const reasons: string[] = [];
  if (request.schema !== PEER_TAKEOVER_REQUEST_SCHEMA) reasons.push("unknown takeover request schema");
  const { requester, subject, target, claim, proof, observed, recovery } = request;
  if (!isRecord(requester) || typeof requester.agent !== "string" || typeof requester.tier !== "string") reasons.push("requester is malformed");
  if (!isRecord(subject) || typeof subject.agent !== "string" || typeof subject.project !== "string" || typeof subject.actionId !== "string") reasons.push("subject is malformed");
  if (!isRecord(target) || typeof target.project !== "string" || typeof target.actionId !== "string" || !parseActionRef(`${String(target.project)}/${String(target.actionId)}`)) reasons.push("target is malformed");
  if (!isRecord(claim) || !isStringOrNull(claim.generation) || !isStringOrNull(claim.branch)) reasons.push("claim is malformed");
  if (request.basis !== "claim_released" && request.basis !== "principal_proven_terminal") reasons.push("basis is malformed");
  if (!isRecord(proof) || !isStringOrNull(proof.sessionId) || !isStringOrNull(proof.exitReceiptId) || !isStringOrNull(proof.releaseRef)) reasons.push("proof is malformed");
  if (!isRecord(observed) || typeof observed.state !== "string" || typeof observed.classifiedAt !== "string" || !Array.isArray(observed.evidenceRefs)) reasons.push("observed is malformed");
  if (!isRecord(recovery) || typeof recovery.preview !== "string" || typeof recovery.apply !== "string") reasons.push("recovery is malformed");
  return reasons;
}
