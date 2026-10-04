import { createHash } from "node:crypto";
import { AGENT_GIT_EMAIL_DOMAIN, agentIdentityEmail, agentIdentityName } from "../codingAgents/agentIdentity.js";
import { CAPACITY_ADMISSION_LIMITS } from "../codingAgents/capacity.js";
import { MODEL_TIERS, TIER_AGENTS, type ModelTier, type TierAgent } from "../codingAgents/modelTiers.js";

/**
 * The agent peer-watch contract: the evidence a coding agent publishes and a
 * peer watcher reads, and nothing else. The procedure is
 * `docs/agent-guidance/agent-peer-watch.md`; this module is its typed schema.
 *
 * Everything here is pure. It parses text a caller already holds (a commit
 * message, an issue comment body) and never reads Git, GitHub, the workspace
 * database or the host. Every parsed value is untrusted input: a trailer or a
 * comment block is a claim made by whoever wrote it, never proof of identity
 * by itself. Evidence only counts after it is bound to something the watcher
 * observed independently (the commit author identity and the candidate branch
 * of the governed claim, or a trusted comment author and the current claim
 * generation), and even bound evidence can only show activity. No evidence in
 * this contract can release ownership; release is a governed state change made
 * through the existing claim/session recovery paths.
 */

export const PEER_WATCH_CONTRACT_VERSION = 1 as const;
export const PEER_WATCH_COMMENT_SCHEMA = "arcadia-peer-watch-v1" as const;
export const PEER_WATCH_COMMENT_FENCE_INFO = "arcadia-peer-watch" as const;

/**
 * Freshness windows. `docs/agent-guidance/agent-peer-watch.md` states the same
 * numbers and a test holds the two in agreement.
 */
export const PEER_WATCH_WINDOWS = {
  /** Latest bound activity at most this old: the owner is healthy. */
  activityFreshMs: 20 * 60_000,
  /** Quiet for longer than activityFresh but at most this long: idle, never stalled. */
  stallAfterMs: 2 * 60 * 60_000,
  /** Tolerated disagreement between a claimed timestamp and the observed one. */
  clockSkewMs: 5 * 60_000,
  /** Capacity evidence older than this cannot classify an agent exhausted. */
  capacityFreshMs: CAPACITY_ADMISSION_LIMITS.observationFreshnessMs,
  /** A publisher's heartbeat interval may not exceed this (half the fresh window). */
  heartbeatMaxIntervalMs: 10 * 60_000,
  /** A takeover request, and the classification it is revalidated against, may be at most this old. */
  takeoverMaxAgeMs: 5 * 60_000
} as const;

export const PEER_WATCH_LIMITS = {
  /** A commit message larger than this is not parsed for trailers at all. */
  commitMessageMaxBytes: 64 * 1024,
  /** One trailer value. */
  trailerValueMaxBytes: 128,
  /** One fenced comment block, fences included. */
  commentBlockMaxBytes: 2048,
  /** One issue comment body. */
  commentBodyMaxBytes: 64 * 1024,
  /** Lines inside one comment block. */
  commentBlockMaxLines: 16,
  /** Evidence references in one comment block. */
  evidenceRefsMax: 8
} as const;

export const PEER_WATCH_TRAILERS = {
  agent: "Arcadia-Agent",
  action: "Arcadia-Action",
  heartbeat: "Arcadia-Heartbeat",
  claim: "Arcadia-Claim"
} as const;

const TRAILER_KEYS = Object.values(PEER_WATCH_TRAILERS) as string[];

/** The channels a watcher reads. Every supported agent already has each one, or the table says it does not. */
export const PEER_WATCH_CHANNELS = ["commits", "issue_comments", "session_rows", "capacity"] as const;
export type PeerWatchChannel = (typeof PEER_WATCH_CHANNELS)[number];

export type ChannelSupport = "yes" | "no" | "unknown";

export interface AgentChannelSupport {
  /** Commits authored under its semantic identity on its candidate branch. */
  identityCommits: ChannelSupport;
  /** Commits that carry the contract trailers today. No launcher or agent adds them yet; any agent that commits could. */
  contractTrailersToday: ChannelSupport;
  /** Issue comments posted through the GitHub CLI. */
  issueComments: ChannelSupport;
  /** `agent_sessions` rows (and with them the repository lease) when Arcadia launches it. */
  sessionRows: ChannelSupport;
  /** Real (unattended) capacity telemetry. */
  capacityTelemetry: ChannelSupport;
}

/**
 * What each supported agent can produce today, read from code and history, not
 * promised. The procedure's table mirrors this and a test holds them equal.
 * `unknown` stays unknown: a watcher degrades to the `unknown` state, never to
 * `healthy`, where a channel is unknown or unreadable.
 */
export const AGENT_CHANNEL_SUPPORT: Record<TierAgent, AgentChannelSupport> = {
  claude: { identityCommits: "yes", contractTrailersToday: "no", issueComments: "yes", sessionRows: "yes", capacityTelemetry: "yes" },
  codex: { identityCommits: "yes", contractTrailersToday: "no", issueComments: "yes", sessionRows: "yes", capacityTelemetry: "yes" },
  opencode: { identityCommits: "yes", contractTrailersToday: "no", issueComments: "unknown", sessionRows: "yes", capacityTelemetry: "no" }
};

export const WATCHED_AGENTS = TIER_AGENTS;
export type WatchedAgent = TierAgent;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const GENERATION = /^[A-Za-z0-9_-]{4,64}$/;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const SHA = /^[0-9a-f]{40}$/;
// eslint-disable-next-line no-control-regex
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-￿]/;

export interface AgentRef { agent: WatchedAgent; tier: ModelTier }
export interface ActionRef { project: string; actionId: string }

export function parseAgentRef(value: string): AgentRef | null {
  const match = /^([a-z]+)\/([a-z]+)$/.exec(value);
  if (!match) return null;
  const [, agent, tier] = match;
  if (!(TIER_AGENTS as readonly string[]).includes(agent) || !(MODEL_TIERS as readonly string[]).includes(tier)) return null;
  return { agent: agent as WatchedAgent, tier: tier as ModelTier };
}

export function parseActionRef(value: string): ActionRef | null {
  const parts = value.split("/");
  if (parts.length !== 2 || !SLUG.test(parts[0]) || !SLUG.test(parts[1]) || value.length > 160) return null;
  return { project: parts[0], actionId: parts[1] };
}

/** A strict UTC instant; anything else (offsets, dates alone, impossible dates) is null. */
export function parseUtcTimestamp(value: string): number | null {
  return UTC_TIMESTAMP.test(value) ? parseIsoInstant(value) : null;
}

/**
 * Builder-role identity emails for one platform, at every tier. Only builder
 * commits count as an owner's activity: a critic identity is a reviewer, a
 * different principal, even on the same platform.
 */
export function builderIdentityEmails(agent: WatchedAgent): string[] {
  return MODEL_TIERS.map((tier) => agentIdentityEmail(agentIdentityName(agent, tier, "builder")));
}

export function builderIdentityEmail(ref: AgentRef): string {
  return agentIdentityEmail(agentIdentityName(ref.agent, ref.tier, "builder"));
}

// ---------------------------------------------------------------------------
// Commit trailers
// ---------------------------------------------------------------------------

export interface PeerWatchTrailers {
  agent: AgentRef;
  action: ActionRef;
  heartbeatAt: number | null;
  claimGeneration: string | null;
}

export type TrailerParse =
  /** No contract trailer at all. Not an error: today no launcher adds them. */
  | { status: "absent" }
  | { status: "ok"; trailers: PeerWatchTrailers }
  | { status: "rejected"; reasons: string[] };

/**
 * Parse the contract trailers from a raw commit message.
 *
 * Git's trailer block is the last paragraph of the message, so only that
 * paragraph is read; a lookalike line earlier in the body is prose. Inside it
 * the whole set is rejected (never partially accepted) on any of: a contract
 * key spelled in another case (Git compares trailer keys case-insensitively,
 * so that is a second value), a duplicate key, a value over the byte limit,
 * control or non-ASCII characters, a value outside its grammar, or a heartbeat
 * or claim trailer without the agent and action it belongs to. Other
 * `Arcadia-*` trailers (preservation, recovery) belong to other contracts and
 * are left alone.
 */
export function parsePeerWatchTrailers(message: string): TrailerParse {
  if (Buffer.byteLength(message) > PEER_WATCH_LIMITS.commitMessageMaxBytes) {
    return { status: "rejected", reasons: [`commit message exceeds ${PEER_WATCH_LIMITS.commitMessageMaxBytes} bytes`] };
  }
  const paragraphs = message.replace(/\r\n/g, "\n").trim().split(/\n[ \t]*\n/);
  const block = paragraphs.length > 1 ? paragraphs[paragraphs.length - 1] : "";
  const values = new Map<string, string>();
  const reasons: string[] = [];
  for (const line of block.split("\n")) {
    const match = /^([A-Za-z0-9-]+):(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1];
    const canonical = TRAILER_KEYS.find((known) => known.toLowerCase() === key.toLowerCase());
    if (!canonical) continue;
    if (key !== canonical) { reasons.push(`trailer key "${key}" is not spelled exactly ${canonical}`); continue; }
    if (values.has(key)) { reasons.push(`duplicate ${key} trailer`); continue; }
    if (!match[2].startsWith(" ") || match[2].startsWith("  ")) { reasons.push(`${key} must be followed by exactly one space`); continue; }
    const value = match[2].slice(1);
    if (Buffer.byteLength(value) > PEER_WATCH_LIMITS.trailerValueMaxBytes) { reasons.push(`${key} value exceeds ${PEER_WATCH_LIMITS.trailerValueMaxBytes} bytes`); continue; }
    if (UNSAFE_TEXT.test(value) || value !== value.trim() || !value) { reasons.push(`${key} value contains unsafe or empty text`); continue; }
    values.set(key, value);
  }
  if (values.size === 0 && reasons.length === 0) return { status: "absent" };
  const agentText = values.get(PEER_WATCH_TRAILERS.agent);
  const actionText = values.get(PEER_WATCH_TRAILERS.action);
  const heartbeatText = values.get(PEER_WATCH_TRAILERS.heartbeat);
  const claimText = values.get(PEER_WATCH_TRAILERS.claim);
  const agent = agentText === undefined ? null : parseAgentRef(agentText);
  const action = actionText === undefined ? null : parseActionRef(actionText);
  if (agentText === undefined) reasons.push(`${PEER_WATCH_TRAILERS.agent} is required with any contract trailer`);
  else if (!agent) reasons.push(`${PEER_WATCH_TRAILERS.agent} must be <agent>/<tier> with a supported agent and tier`);
  if (actionText === undefined) reasons.push(`${PEER_WATCH_TRAILERS.action} is required with any contract trailer`);
  else if (!action) reasons.push(`${PEER_WATCH_TRAILERS.action} must be <project-slug>/<action-id>`);
  let heartbeatAt: number | null = null;
  if (heartbeatText !== undefined) {
    heartbeatAt = parseUtcTimestamp(heartbeatText);
    if (heartbeatAt === null) reasons.push(`${PEER_WATCH_TRAILERS.heartbeat} must be a UTC timestamp like 2026-10-04T20:33:12Z`);
  }
  if (claimText !== undefined && !GENERATION.test(claimText)) reasons.push(`${PEER_WATCH_TRAILERS.claim} must be a claim generation id`);
  if (reasons.length || !agent || !action) return { status: "rejected", reasons };
  return { status: "ok", trailers: { agent, action, heartbeatAt, claimGeneration: claimText ?? null } };
}

/** Render the trailer block a publisher appends (the later publishing Action uses this; nothing here commits). */
export function renderPeerWatchTrailers(input: { agent: AgentRef; action: ActionRef; heartbeatAt?: Date; claimGeneration?: string }): string {
  const lines = [
    `${PEER_WATCH_TRAILERS.agent}: ${input.agent.agent}/${input.agent.tier}`,
    `${PEER_WATCH_TRAILERS.action}: ${input.action.project}/${input.action.actionId}`
  ];
  if (input.claimGeneration) lines.push(`${PEER_WATCH_TRAILERS.claim}: ${input.claimGeneration}`);
  if (input.heartbeatAt) lines.push(`${PEER_WATCH_TRAILERS.heartbeat}: ${input.heartbeatAt.toISOString().replace(/\.\d{3}Z$/, "Z")}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Issue-comment blocks
// ---------------------------------------------------------------------------

export const PEER_WATCH_COMMENT_STATES = ["working", "waiting", "release_requested", "offer_help", "escalated"] as const;
export type PeerWatchCommentState = (typeof PEER_WATCH_COMMENT_STATES)[number];

export interface PeerWatchCommentBlock {
  schema: typeof PEER_WATCH_COMMENT_SCHEMA;
  agent: AgentRef;
  action: ActionRef;
  claimGeneration: string | null;
  state: PeerWatchCommentState;
  evidence: string[];
  issuedAt: number;
  /** sha256 of the normalized block body, the replay key. */
  digest: string;
}

export type CommentBlockParse =
  | { status: "absent" }
  | { status: "ok"; block: PeerWatchCommentBlock }
  /** A well-formed block of a version this reader does not know: ignored, not an error. */
  | { status: "unsupported_version"; schema: string }
  | { status: "rejected"; reasons: string[] };

const COMMENT_FIELDS = ["schema", "agent", "action", "claim", "state", "evidence", "issued_at"] as const;
const EVIDENCE_REF = /^(?:commit:[0-9a-f]{40}|pr:[1-9]\d{0,7}|issue:[1-9]\d{0,7}|session:[A-Za-z0-9_-]{4,64}|receipt:[A-Za-z0-9_.-]{4,96})$/;

interface Fence { char: "`" | "~"; length: number; info: string; start: number; end: number | null; body: string[] }

/** Top-level fenced code blocks, CommonMark-style: a fence closes only on the same character, at least as long. */
function topLevelFences(lines: string[]): Fence[] {
  const fences: Fence[] = [];
  let open: Fence | null = null;
  lines.forEach((line, index) => {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (open) {
      if (match && match[1][0] === open.char && match[1].length >= open.length && !match[2].trim()) { open.end = index; fences.push(open); open = null; }
      else open.body.push(line);
      return;
    }
    if (match) open = { char: match[1][0] as "`" | "~", length: match[1].length, info: match[2].trim(), start: index, end: null, body: [] };
  });
  if (open) fences.push(open);
  return fences;
}

/**
 * Parse the single contract block of one issue comment.
 *
 * A block is a top-level fence whose info string is exactly
 * `arcadia-peer-watch`. A block quoted inside another fence, or inside a
 * blockquote, is someone else's text and is not this comment's block. More
 * than one top-level block makes the comment ambiguous and rejects it, as does
 * an unterminated fence, an oversized block or body, an unknown or repeated
 * field, or a value outside its grammar. A block whose `schema` names another
 * version is ignored. No field in the block (including any self-declared
 * author) identifies who posted it: binding uses the comment's server-side
 * author and timestamps, see `bindCommentEvidence`.
 */
export function parsePeerWatchCommentBlock(body: string): CommentBlockParse {
  if (Buffer.byteLength(body) > PEER_WATCH_LIMITS.commentBodyMaxBytes) return { status: "rejected", reasons: [`comment body exceeds ${PEER_WATCH_LIMITS.commentBodyMaxBytes} bytes`] };
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const blocks = topLevelFences(lines).filter((fence) => fence.info === PEER_WATCH_COMMENT_FENCE_INFO);
  if (blocks.length === 0) return { status: "absent" };
  if (blocks.length > 1) return { status: "rejected", reasons: ["more than one arcadia-peer-watch block in one comment"] };
  const [fence] = blocks;
  if (fence.end === null) return { status: "rejected", reasons: ["unterminated arcadia-peer-watch block"] };
  const raw = lines.slice(fence.start, fence.end + 1).join("\n");
  if (Buffer.byteLength(raw) > PEER_WATCH_LIMITS.commentBlockMaxBytes) return { status: "rejected", reasons: [`block exceeds ${PEER_WATCH_LIMITS.commentBlockMaxBytes} bytes`] };
  const content = fence.body.filter((line) => line.trim());
  if (content.length > PEER_WATCH_LIMITS.commentBlockMaxLines) return { status: "rejected", reasons: [`block exceeds ${PEER_WATCH_LIMITS.commentBlockMaxLines} lines`] };
  const reasons: string[] = [];
  const fields = new Map<string, string>();
  for (const line of content) {
    const match = /^([a-z_]+): (.*)$/.exec(line);
    if (!match) { reasons.push(`unparseable line "${line.slice(0, 40)}"`); continue; }
    const [, key, value] = match;
    if (!(COMMENT_FIELDS as readonly string[]).includes(key)) { reasons.push(`unknown field ${key}`); continue; }
    if (fields.has(key)) { reasons.push(`duplicate field ${key}`); continue; }
    if (UNSAFE_TEXT.test(value) || value !== value.trim()) { reasons.push(`field ${key} contains unsafe text`); continue; }
    fields.set(key, value);
  }
  const schema = fields.get("schema");
  if (schema === undefined) return { status: "rejected", reasons: ["missing schema field", ...reasons] };
  if (schema !== PEER_WATCH_COMMENT_SCHEMA) {
    return /^arcadia-peer-watch-v\d{1,4}$/.test(schema) ? { status: "unsupported_version", schema } : { status: "rejected", reasons: [`unrecognized schema ${schema.slice(0, 40)}`] };
  }
  if (reasons.length) return { status: "rejected", reasons };
  for (const key of ["agent", "action", "state", "issued_at"]) if (!fields.has(key)) reasons.push(`missing field ${key}`);
  const agent = parseAgentRef(fields.get("agent") ?? "");
  const action = parseActionRef(fields.get("action") ?? "");
  const state = fields.get("state") ?? "";
  const issuedAt = parseUtcTimestamp(fields.get("issued_at") ?? "");
  const claim = fields.get("claim");
  const evidenceText = fields.get("evidence");
  const evidence = evidenceText ? evidenceText.split(",").map((ref) => ref.trim()) : [];
  if (fields.has("agent") && !agent) reasons.push("agent must be <agent>/<tier>");
  if (fields.has("action") && !action) reasons.push("action must be <project-slug>/<action-id>");
  if (fields.has("state") && !(PEER_WATCH_COMMENT_STATES as readonly string[]).includes(state)) reasons.push(`unknown state ${state.slice(0, 40)}`);
  if (fields.has("issued_at") && issuedAt === null) reasons.push("issued_at must be a UTC timestamp");
  if (claim !== undefined && !GENERATION.test(claim)) reasons.push("claim must be a claim generation id");
  if (evidence.length > PEER_WATCH_LIMITS.evidenceRefsMax) reasons.push(`more than ${PEER_WATCH_LIMITS.evidenceRefsMax} evidence refs`);
  for (const ref of evidence) if (!EVIDENCE_REF.test(ref)) reasons.push(`invalid evidence ref ${ref.slice(0, 40)}`);
  if (reasons.length || !agent || !action || issuedAt === null) return { status: "rejected", reasons };
  const normalized = content.map((line) => line.trim()).join("\n");
  return {
    status: "ok",
    block: {
      schema: PEER_WATCH_COMMENT_SCHEMA, agent, action, claimGeneration: claim ?? null,
      state: state as PeerWatchCommentState, evidence, issuedAt,
      digest: createHash("sha256").update(normalized).digest("hex")
    }
  };
}

export function renderPeerWatchCommentBlock(input: {
  agent: AgentRef; action: ActionRef; claimGeneration?: string; state: PeerWatchCommentState; evidence?: string[]; issuedAt: Date;
}): string {
  const lines = [
    "```" + PEER_WATCH_COMMENT_FENCE_INFO,
    `schema: ${PEER_WATCH_COMMENT_SCHEMA}`,
    `agent: ${input.agent.agent}/${input.agent.tier}`,
    `action: ${input.action.project}/${input.action.actionId}`,
    ...(input.claimGeneration ? [`claim: ${input.claimGeneration}`] : []),
    `state: ${input.state}`,
    ...(input.evidence?.length ? [`evidence: ${input.evidence.join(", ")}`] : []),
    `issued_at: ${input.issuedAt.toISOString().replace(/\.\d{3}Z$/, "Z")}`,
    "```"
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Binding parsed evidence to what the watcher observed independently
// ---------------------------------------------------------------------------

/** One commit as a watcher read it from the candidate branch (beyond the base). */
export interface CommitObservation {
  sha: string;
  /** The branch the watcher listed this commit from. */
  branch: string;
  authorEmail: string;
  committerEmail: string;
  /** Committer date as Git's `%cI` reports it (strict ISO 8601 with zone). Forgeable; bounded by clock skew against the watcher's clock. */
  committedAt: string;
  message: string;
}

/** One issue comment as the GitHub API reported it. Author and timestamps are server-side facts. */
export interface IssueCommentObservation {
  id: string;
  authorLogin: string;
  createdAt: string;
  /** Null or equal to createdAt when never edited. */
  updatedAt: string | null;
  body: string;
}

/** What the governed claim says, which a commit or comment must agree with. */
export interface BindingExpectation {
  agent: WatchedAgent;
  project: string;
  actionId: string;
  branch: string | null;
  claimGeneration: string | null;
}

export interface BoundEvidence {
  channel: PeerWatchChannel;
  ref: string;
  /** Observed instant in epoch ms, or null when it could not be established. */
  at: number | null;
  counted: boolean;
  reason: string;
}

/**
 * Whether one commit counts as the expected owner's activity. It counts only
 * when it is on the claim's candidate branch, author and committer are both a
 * builder identity of the owner's platform, its timestamp is not in the
 * future, and any contract trailers parse and agree with the claim (agent and
 * tier matching the author identity, action, claim generation, and a
 * heartbeat within clock skew of the commit time, so an old heartbeat value
 * replayed onto a new commit is refused). An owner commit with no contract
 * trailers still counts, since no launcher adds them yet; a commit with
 * broken or disagreeing trailers does not.
 */
export function bindCommitEvidence(commit: CommitObservation, expected: BindingExpectation, now: number): BoundEvidence {
  const ref = SHA.test(commit.sha) ? `commit:${commit.sha}` : `commit:${commit.sha.slice(0, 40)}`;
  const at = parseIsoInstant(commit.committedAt);
  const refuse = (reason: string): BoundEvidence => ({ channel: "commits", ref, at, counted: false, reason });
  if (!SHA.test(commit.sha)) return refuse("not a full commit sha");
  const expectedBranch = normalizeBranch(expected.branch);
  if (!expectedBranch || normalizeBranch(commit.branch) !== expectedBranch) return refuse("not on the claim's candidate branch");
  const owners = builderIdentityEmails(expected.agent);
  const author = commit.authorEmail.trim().toLowerCase();
  const committer = commit.committerEmail.trim().toLowerCase();
  if (!owners.includes(author) || !owners.includes(committer)) {
    return refuse(author.endsWith(`@${AGENT_GIT_EMAIL_DOMAIN}`) ? "authored by a different agent identity than the owner" : "not authored by an agent identity");
  }
  if (at === null) return refuse("commit time unreadable");
  if (at > now + PEER_WATCH_WINDOWS.clockSkewMs) return refuse("commit time is in the future");
  const parsed = parsePeerWatchTrailers(commit.message);
  if (parsed.status === "rejected") return refuse(`trailers rejected: ${parsed.reasons.join("; ")}`);
  if (parsed.status === "ok") {
    const t = parsed.trailers;
    if (t.agent.agent !== expected.agent || builderIdentityEmail(t.agent) !== author) return refuse("Arcadia-Agent disagrees with the commit author identity");
    if (t.action.project !== expected.project || t.action.actionId !== expected.actionId) return refuse("Arcadia-Action names a different Action");
    if (t.claimGeneration !== null && t.claimGeneration !== expected.claimGeneration) return refuse("Arcadia-Claim names a different claim generation");
    if (t.heartbeatAt !== null && Math.abs(t.heartbeatAt - at) > PEER_WATCH_WINDOWS.clockSkewMs) return refuse("Arcadia-Heartbeat disagrees with the commit time (replayed or forged)");
    return { channel: "commits", ref, at, counted: true, reason: t.heartbeatAt !== null ? "owner heartbeat commit" : "owner commit with contract trailers" };
  }
  return { channel: "commits", ref, at, counted: true, reason: "owner commit without contract trailers" };
}

export interface CommentBinding extends BoundEvidence { block: PeerWatchCommentBlock | null }

/**
 * Bind every comment on the coordination issue. A block counts as the owner's
 * activity only when the comment author is in `trustedAuthors` (the logins
 * the operator's Decision names), the comment was never edited, its block is
 * valid for this version, names the owner's platform and the claimed Action
 * and current claim generation, and its `issued_at` is within clock skew of
 * the server's `createdAt`. Ordering and age use the server
 * timestamp, never `issued_at`. An identical block posted again is a replay
 * and only its first appearance counts.
 */
export function bindCommentEvidence(comments: IssueCommentObservation[], expected: BindingExpectation, trustedAuthors: readonly string[], now: number): CommentBinding[] {
  const seen = new Set<string>();
  const ordered = [...comments].sort((a, b) => (parseIsoInstant(a.createdAt) ?? 0) - (parseIsoInstant(b.createdAt) ?? 0));
  const results: CommentBinding[] = [];
  for (const comment of ordered) {
    const ref = `comment:${comment.id}`;
    const at = parseIsoInstant(comment.createdAt);
    const refuse = (reason: string, block: PeerWatchCommentBlock | null = null): CommentBinding => ({ channel: "issue_comments", ref, at, counted: false, reason, block });
    const parsed = parsePeerWatchCommentBlock(comment.body);
    if (parsed.status === "absent") continue;
    if (parsed.status === "unsupported_version") { results.push(refuse(`ignored unsupported schema ${parsed.schema}`)); continue; }
    if (parsed.status === "rejected") { results.push(refuse(`block rejected: ${parsed.reasons.join("; ")}`)); continue; }
    const block = parsed.block;
    if (!trustedAuthors.includes(comment.authorLogin)) { results.push(refuse("comment author is not a trusted poster", block)); continue; }
    if (comment.updatedAt && comment.updatedAt !== comment.createdAt) { results.push(refuse("edited comment", block)); continue; }
    if (at === null || at > now + PEER_WATCH_WINDOWS.clockSkewMs) { results.push(refuse("comment time unreadable or in the future", block)); continue; }
    if (seen.has(block.digest)) { results.push(refuse("replay of an earlier block", block)); continue; }
    seen.add(block.digest);
    if (Math.abs(block.issuedAt - at) > PEER_WATCH_WINDOWS.clockSkewMs) { results.push(refuse("issued_at disagrees with when the comment was created (replayed or forged)", block)); continue; }
    if (block.agent.agent !== expected.agent) { results.push(refuse("block names a different agent than the owner", block)); continue; }
    if (block.action.project !== expected.project || block.action.actionId !== expected.actionId) { results.push(refuse("block names a different Action", block)); continue; }
    if (block.claimGeneration === null || block.claimGeneration !== expected.claimGeneration) { results.push(refuse("block does not name the current claim generation", block)); continue; }
    results.push({ channel: "issue_comments", ref, at, counted: true, reason: `owner comment (${block.state})`, block });
  }
  return results;
}

const STRICT_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/;

/**
 * A strict ISO 8601 / RFC 3339 instant with an explicit zone, the shape Git's
 * `%cI` and the GitHub API emit. `Date.parse` is not used to accept input: it
 * takes many other shapes and rolls an impossible date such as 2026-02-31 over
 * into March. Anything else is null, which callers treat as unreadable.
 */
export function parseIsoInstant(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const match = STRICT_INSTANT.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const offsetHours = match[10] === undefined ? 0 : Number(match[10]);
  const offsetMinutes = match[11] === undefined ? 0 : Number(match[11]);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59 || offsetHours > 23 || offsetMinutes > 59) return null;
  const local = Date.UTC(year, month - 1, day, hour, minute, second);
  if (new Date(local).getUTCDate() !== day) return null;
  const millis = match[7] ? Number(match[7].slice(0, 3).padEnd(3, "0")) : 0;
  const sign = match[9] === "-" ? -1 : 1;
  return local + millis - sign * (offsetHours * 60 + offsetMinutes) * 60_000;
}

/** Git and the GitHub API name the same branch with or without `refs/heads/`. */
export function normalizeBranch(branch: string | null | undefined): string | null {
  if (typeof branch !== "string" || !branch.trim()) return null;
  return branch.trim().replace(/^refs\/heads\//, "");
}
