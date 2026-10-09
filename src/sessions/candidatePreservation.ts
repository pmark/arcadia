import { boundedExec, gitProcessesInWorktree, preservationIndexLocked, preservationIndexLockMalformed, preservationStage } from "./preservationStages.js";
import { existsSync, lstatSync, realpathSync, rmSync, type Stats } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { ArcadiaError, validationError } from "../cli/errors.js";
import { git, isAncestor, isPatchEquivalent, listWorktrees, mergesCleanly, refExists, resolveBaseBranch, SAFE_TASK_BRANCH, tryGit } from "../git/worktrees.js";
import { commitTreeAt, snapshotCandidate } from "./candidateSnapshot.js";
import { createId } from "../utils/id.js";
import { getActiveWorktreeReservation, getRepositoryLease, getSession } from "./index.js";
import { findAcceptedTerminalCompletion } from "./reconciliation.js";
import { fileIsHeldOpen } from "./worktreeLiveness.js";
import {
  refusedOperatorQaPlan,
  renderOperatorQaPlan,
  type ChangedFile,
  type OperatorQaPlanResult,
  type OperatorQaPlanSource
} from "./operatorQaPlan.js";
import {
  COMPLETION_SETTLEMENT_LINE,
  composePreservedPullRequestBody,
  readValidationEvidence,
  unavailableValidationEvidence
} from "./validationEvidence.js";

/**
 * Preserve a completed candidate worktree without ever handing the coding agent
 * write access to shared Git metadata.
 *
 * The problem this exists for: an agent runs inside a sandbox that intentionally
 * protects the Git common directory (`.git`). It can edit files, but it cannot
 * commit, push, or open a pull request — those all write refs and objects the
 * sandbox denies. Rather than punch a hole in the sandbox (make `.git` writable)
 * or escalate approvals ad hoc, preservation runs *outside* the sandbox, on the
 * host controller, and stages exactly one registered candidate worktree into one
 * recoverable commit on its own agent-owned branch.
 *
 * Every consequential input is bound into a receipt keyed by `requestId`, so a
 * lost response or a retry returns the same result instead of a second commit.
 * The commit itself carries the `requestId` and staged-tree fingerprint as
 * trailers, which is the durable idempotency key that survives a crash between
 * committing and persisting the receipt: a retry finds the existing commit by
 * trailer and never creates a duplicate.
 */

export type RemotePreservationAuthorization =
  | { authorized: false; reason: string }
  /**
   * `qaPlan` is the pull-request body: literal text, or the governed source of
   * an Operator QA plan rendered after the candidate commit exists (see
   * operatorQaPlan.ts). A refused rendering still preserves; the body says
   * "QA plan unavailable" and the receipt records `qaPlanRefusal`. A governed
   * source's body also carries the Validation evidence section and the
   * completion-settlement line (validationEvidence.ts); literal text does not.
   */
  | { authorized: true; qaPlan: string | OperatorQaPlanSource }
  /**
   * An operator-launched Session's exit before its outcome is known (Decision
   * 0096): the commit is pushed and recorded `PUSHED`, and no pull request is
   * opened. The draft PR follows only an accepted completion.
   */
  | { authorized: true; pushOnly: true };

export interface CandidatePreservationRequest {
  requestId: string;
  /** The control worktree that owns the shared Git common directory. */
  repositoryPath: string;
  /** The registered candidate worktree whose changes are being preserved. */
  candidateWorktreePath: string;
  /** Short agent-owned branch name checked out in the candidate worktree. */
  branch: string;
  baseBranch: string;
  /** Base revision this candidate was launched from; changed base history refuses. */
  baseRevision: string;
  actionId: string;
  /** Immutable managed packet hash, or manual handoff binding hash. */
  packetSha256: string;
  authorityKind?: "manual_handoff";
  /** Exact accepted worker exit authorizing recovery after its lease ended. */
  terminalSessionId?: string;
  policyEpoch: number;
  policyRevision: number;
  /** Proven validation of the candidate. Absent or failed validation refuses. */
  validation: { passed: boolean; evidenceRef: string; candidateFingerprint: string };
  remotePreservation: RemotePreservationAuthorization;
  now?: Date;
}

/** Deterministic fault-injection boundaries, one per irreversible step. */
export interface CandidatePreservationHooks {
  /** Stage observer used by the protected host transport for bounded failure
   * handoff. It is observational only and cannot affect authorization. */
  onStage?(stage: string): void;
  beforeStage?(): void;
  afterStage?(): void;
  beforeCommit?(): void;
  afterCommit?(): void;
  beforePush?(): void;
  afterPush?(): void;
  beforePullRequestReceipt?(): void;
  afterPullRequestReceipt?(): void;
}

/** The network half, injected so the local path is proven without a real remote. */
export interface CandidatePreservationRemote {
  hasRemote(repositoryPath: string): boolean;
  /**
   * Push the exact agent branch. Returns the remote name used. With
   * `commitSha`, push exactly that commit to the branch (never whatever the
   * local tip became in the meantime).
   */
  push(input: { repositoryPath: string; branch: string; commitSha?: string }): { remote: string };
  /**
   * Every branch tip on the remote `push` publishes to, as
   * `git ls-remote --heads` reports it: read-only, used only to choose the
   * draft PR's base ({@link selectPullRequestBase}). Optional: an adapter
   * without it opens every PR on the Project base, as before stacked bases
   * existed (only test doubles omit it; the system adapter implements it).
   */
  listBranchTips?(input: { repositoryPath: string }): Array<{ branch: string; sha: string }>;
  /**
   * The open (or most recent) PR for the branch; `baseRefName` and `state`
   * when the adapter can read them. A PR whose `state` is not OPEN is treated
   * as no PR (preservation opens a new one).
   */
  findPullRequest(input: { repositoryPath: string; branch: string }): { number: number; url: string; baseRefName?: string; state?: string } | null;
  upsertDraftPullRequest(input: {
    repositoryPath: string;
    branch: string;
    baseBranch: string;
    title: string;
    body: string;
    existing: { number: number; url: string } | null;
  }): { number: number; url: string };
}

export interface CandidatePreservationDeps {
  hooks?: CandidatePreservationHooks;
  remote?: CandidatePreservationRemote;
}

export type PreservationState = "LOCAL ONLY" | "PUSHED" | "IN PR";

export interface CandidatePreservationReceipt {
  id: string;
  requestId: string;
  repositoryPath: string;
  candidateWorktreePath: string;
  branch: string;
  baseBranch: string;
  baseRevision: string;
  actionId: string;
  /** Immutable managed packet hash, or manual handoff binding hash. */
  packetSha256: string;
  authorityKind?: "manual_handoff";
  terminalSessionId?: string;
  policyEpoch: number;
  policyRevision: number;
  candidateFingerprint: string;
  validationEvidenceRef: string;
  commitSha: string;
  preservationState: PreservationState;
  pushedRemote: string | null;
  pullRequestNumber: number | null;
  pullRequestUrl: string | null;
  /** Set only for LOCAL ONLY: the exact next step that makes the work remote-recoverable. */
  retryAction: string | null;
  /** Set only when the Operator QA plan refused; the pull-request body then states why. */
  qaPlanRefusal?: string;
  /**
   * The branch the draft PR was opened against and why (IN PR receipts whose
   * remote adapter reports branch tips). `baseBranch` above stays the
   * Project's base branch, which integration fast-forwards locally.
   */
  prBase?: PullRequestBase;
  createdAt: string;
  replayed: boolean;
}

/**
 * The base a candidate's draft PR is opened against (Issue #987, Decision:
 * stacked PRs). `project`: the Project's base branch, exactly as before.
 * `stacked`: the remote agent candidate branch whose tip is the candidate's
 * base revision -- the previous serial Action's branch, after that Action
 * integrated by local fast-forward while the remote base, which the worker
 * never pushes, stayed behind. GitHub then diffs the PR from exactly the
 * candidate's base revision, as the host Operator QA plan does.
 */
export interface PullRequestBase {
  kind: "project" | "stacked";
  branch: string;
  /** The remote tip of `branch` when it was chosen; null when the adapter reports no tips or the remote lacks it. */
  tip: string | null;
  reason: string;
}

export type PullRequestBaseSelection =
  | { ok: true; base: PullRequestBase }
  | { ok: false; reason: string; remedy: string };

/** Marks the refusal so callers and the escalation can recognize it. */
export const STACKED_BASE_UNAVAILABLE = "stacked_pull_request_base_unavailable";

const PRESERVATION_TRAILER = "Arcadia-Preservation-Request";
const FINGERPRINT_TRAILER = "Arcadia-Candidate-Fingerprint";

export function ensureCandidatePreservationTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS candidate_preservation_receipts (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE,
      repository_path TEXT NOT NULL,
      candidate_worktree_path TEXT NOT NULL,
      branch TEXT NOT NULL,
      base_branch TEXT NOT NULL,
      base_revision TEXT NOT NULL,
      action_id TEXT NOT NULL,
      packet_sha256 TEXT NOT NULL,
      policy_epoch INTEGER NOT NULL,
      policy_revision INTEGER NOT NULL,
      candidate_fingerprint TEXT NOT NULL,
      commit_sha TEXT NOT NULL,
      preservation_state TEXT NOT NULL CHECK (preservation_state IN ('LOCAL ONLY', 'PUSHED', 'IN PR')),
      pushed_remote TEXT,
      pull_request_number INTEGER,
      pull_request_url TEXT,
      retry_action TEXT,
      receipt_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS candidate_preservation_claims (
      session_id TEXT PRIMARY KEY, pid INTEGER NOT NULL, token TEXT NOT NULL,
      claimed_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_candidate_preservation_branch
      ON candidate_preservation_receipts(repository_path, branch);
  `);
  const claimColumns = db.pragma("table_info(candidate_preservation_claims)") as Array<{ name: string }>;
  if (!claimColumns.some(column => column.name === "claimed_at")) {
    db.exec("ALTER TABLE candidate_preservation_claims ADD COLUMN claimed_at INTEGER NOT NULL DEFAULT 0");
  }
}

function canonical(value: string): string {
  const resolved = path.resolve(value);
  return existsSync(resolved) ? realpathSync(resolved) : resolved;
}

/** No legitimate `read-tree` holds the index lock anywhere near this long; an
 * older lock was left by a killed one (its own timeout or the watchdog's
 * process-group kill) after the commit was already durable -- unless some
 * other Git process (a `git commit` waiting on an editor) still runs in the
 * candidate or a process holds the lock open, which are checked separately. */
const STALE_INDEX_LOCK_MS = 5 * 60 * 1000;

let beforeIndexLockRemoval: ((lockPath: string) => void) | null = null;

/** Test-only: run `hook` after the lock's holder probes and before it is
 * re-checked and removed (the window two `lsof` calls can stretch to ~15s);
 * pass null to restore. */
export function setBeforeIndexLockRemovalForTests(hook: ((lockPath: string) => void) | null): void {
  beforeIndexLockRemoval = hook;
}

/**
 * Point this worktree's real index at the preserved tree, so the candidate
 * reads clean against its preserved commit. Runs only once that commit is
 * durable on the branch: every refusal or failure before it leaves the
 * candidate's index bytes, `git status` and lock files exactly as they were.
 * A stale regular-file lock from a killed earlier sync is removed so the retry
 * can finish, but only when it is older than the threshold, no Git process runs
 * in the candidate and no process holds the lock open; a fresh or possibly live
 * one refuses as retryable `PRESERVATION_INDEX_LOCKED`, and a lock path that is not a
 * regular file (directory, symlink) refuses typed and is never touched.
 * Immediately before removal the lock is `lstat`ed again: if its device, inode
 * or mtime changed while the probes ran (another preservation's fresh live
 * lock replaced the stale one), it is kept and the attempt refuses the same
 * retryable way. A lock that vanished meanwhile needs no removal.
 */
function syncIndexToPreservedTree(candidateWorktreePath: string, tree: string): void {
  preservationStage("preserve.index-sync");
  const lock = path.resolve(candidateWorktreePath, git(candidateWorktreePath, ["rev-parse", "--git-path", "index.lock"]).trim());
  let stats: Stats | null = null;
  try {
    stats = lstatSync(lock);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw preservationIndexLockMalformed(lock, "unreadable", { errorCode: code ?? null, error: String(error) });
  }
  if (stats) {
    const lockAgeMs = Date.now() - stats.mtimeMs;
    if (!stats.isFile()) {
      const lockKind = stats.isDirectory() ? "directory" : stats.isSymbolicLink() ? "symlink" : "other";
      throw preservationIndexLockMalformed(lock, lockKind, { lockAgeMs });
    }
    // An unreadable (non-finite) or future mtime proves nothing about age: refuse.
    if (!Number.isFinite(lockAgeMs) || lockAgeMs < STALE_INDEX_LOCK_MS) throw preservationIndexLocked(lock, lockAgeMs);
    const holders = gitProcessesInWorktree(candidateWorktreePath);
    if (holders.status === "live") throw preservationIndexLocked(lock, lockAgeMs, { liveness: "live", liveGitPids: holders.pids });
    if (holders.status === "unknown") throw preservationIndexLocked(lock, lockAgeMs, { liveness: "unknown", livenessError: holders.error });
    // Age is only a hint: any process still holding the lock file open owns it,
    // however old its mtime. A probe that cannot tell refuses the same way.
    const opened = fileIsHeldOpen(lock);
    if (opened.status === "held") throw preservationIndexLocked(lock, lockAgeMs, { liveness: "held", holderPids: opened.pids });
    if (opened.status === "unknown") {
      throw preservationIndexLocked(lock, lockAgeMs, {
        liveness: "unknown",
        livenessError: `file-holder probe: ${opened.error}`,
        ...(opened.warning ? { holderProbeWarning: opened.warning } : {})
      });
    }
    beforeIndexLockRemoval?.(lock);
    let current: Stats | null = null;
    try {
      current = lstatSync(lock);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw preservationIndexLockMalformed(lock, "unreadable", { lockAgeMs, errorCode: code ?? null, error: String(error) });
    }
    if (current) {
      if (current.dev !== stats.dev || current.ino !== stats.ino || current.mtimeMs !== stats.mtimeMs) {
        const identity = (s: Stats) => ({ dev: s.dev, ino: s.ino, mtimeMs: s.mtimeMs });
        throw preservationIndexLocked(lock, lockAgeMs, { liveness: "changed", probed: identity(stats), observed: identity(current) });
      }
      try {
        rmSync(lock);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") throw preservationIndexLockMalformed(lock, "unremovable", { lockAgeMs, errorCode: code ?? null, error: String(error) });
      }
    }
  }
  git(candidateWorktreePath, ["read-tree", tree]);
}

function headTree(candidateWorktreePath: string): string | null {
  return tryGit(candidateWorktreePath, ["rev-parse", "HEAD^{tree}"]);
}

function findPreservationCommit(
  candidateWorktreePath: string,
  baseBranch: string,
  branch: string,
  requestId: string
): string | null {
  const found = tryGit(candidateWorktreePath, [
    "log",
    "--format=%H",
    `--grep=${PRESERVATION_TRAILER}: ${requestId}$`,
    "--extended-regexp",
    `${baseBranch}..${branch}`
  ]);
  if (!found) return null;
  return found.split("\n").map((line) => line.trim()).filter(Boolean)[0] ?? null;
}

function commitCandidate(input: {
  candidateWorktreePath: string;
  actionId: string;
  requestId: string;
  fingerprint: string;
  branch: string;
  now: Date;
  /** The parent HEAD a base-advance merge check already validated, when one ran.
   *  A caller-injected `beforeCommit` hook runs before this, so re-resolving
   *  HEAD here without checking it against that parent could commit on top of
   *  a branch tip the merge check never actually saw. */
  expectedParent: string | null;
}): string {
  const message =
    `chore(candidate): preserve ${input.actionId} candidate for handoff\n\n` +
    `${PRESERVATION_TRAILER}: ${input.requestId}\n` +
    `${FINGERPRINT_TRAILER}: ${input.fingerprint}\n`;
  const stamp = input.now.toISOString();
  const parent = git(input.candidateWorktreePath, ["rev-parse", "HEAD"]).trim();
  if (input.expectedParent && parent !== input.expectedParent) {
    throw validationError("The candidate branch advanced past the parent its base-advance check validated; retry preservation.", {
      expected: input.expectedParent,
      observed: parent
    });
  }
  const branch = `refs/heads/${input.branch}`;
  if (git(input.candidateWorktreePath, ["symbolic-ref", "HEAD"]).trim() !== branch) throw validationError("Candidate branch changed before commit.");
  const commit = commitTreeAt(input.candidateWorktreePath, input.fingerprint, parent, {
    message,
    env: { GIT_AUTHOR_DATE: stamp, GIT_COMMITTER_DATE: stamp }
  });
  git(input.candidateWorktreePath, ["-c", "core.hooksPath=/dev/null", "update-ref", branch, commit, parent]);
  syncIndexToPreservedTree(input.candidateWorktreePath, input.fingerprint);
  return commit;
}

function loadReceipt(db: Database.Database, requestId: string): CandidatePreservationReceipt | null {
  const row = db
    .prepare("SELECT receipt_json FROM candidate_preservation_receipts WHERE request_id = ?")
    .get(requestId) as { receipt_json: string } | undefined;
  return row ? (JSON.parse(row.receipt_json) as CandidatePreservationReceipt) : null;
}

function persistReceipt(db: Database.Database, receipt: CandidatePreservationReceipt): CandidatePreservationReceipt {
  const stored: CandidatePreservationReceipt = { ...receipt, replayed: false };
  try {
    db.prepare(
      `INSERT INTO candidate_preservation_receipts (
        id, request_id, repository_path, candidate_worktree_path, branch, base_branch,
        base_revision, action_id, packet_sha256, policy_epoch, policy_revision,
        candidate_fingerprint, commit_sha, preservation_state, pushed_remote,
        pull_request_number, pull_request_url, retry_action, receipt_json, created_at
      ) VALUES (
        @id, @request_id, @repository_path, @candidate_worktree_path, @branch, @base_branch,
        @base_revision, @action_id, @packet_sha256, @policy_epoch, @policy_revision,
        @candidate_fingerprint, @commit_sha, @preservation_state, @pushed_remote,
        @pull_request_number, @pull_request_url, @retry_action, @receipt_json, @created_at
      )`
    ).run({
      id: stored.id,
      request_id: stored.requestId,
      repository_path: stored.repositoryPath,
      candidate_worktree_path: stored.candidateWorktreePath,
      branch: stored.branch,
      base_branch: stored.baseBranch,
      base_revision: stored.baseRevision,
      action_id: stored.actionId,
      packet_sha256: stored.packetSha256,
      policy_epoch: stored.policyEpoch,
      policy_revision: stored.policyRevision,
      candidate_fingerprint: stored.candidateFingerprint,
      commit_sha: stored.commitSha,
      preservation_state: stored.preservationState,
      pushed_remote: stored.pushedRemote,
      pull_request_number: stored.pullRequestNumber,
      pull_request_url: stored.pullRequestUrl,
      retry_action: stored.retryAction,
      receipt_json: JSON.stringify(stored),
      created_at: stored.createdAt
    });
    return stored;
  } catch (error) {
    // A concurrent writer won the UNIQUE(request_id) race. The commit is
    // already durable and its trailer prevented a duplicate; return the
    // canonical stored receipt rather than the one we were about to write.
    const existing = loadReceipt(db, stored.requestId);
    if (existing) return { ...existing, replayed: true };
    throw error;
  }
}

/**
 * The binding set that must be identical for a replay to be honored. A retry
 * carrying the same `requestId` but any changed input is refused, never
 * silently re-preserved against the new state.
 */
function assertReplayBindingsMatch(
  receipt: CandidatePreservationReceipt,
  request: CandidatePreservationRequest,
  candidateFingerprint: string
): void {
  const mismatches: Record<string, [unknown, unknown]> = {};
  const check = (field: string, stored: unknown, incoming: unknown) => {
    if (stored !== incoming) mismatches[field] = [stored, incoming];
  };
  check("branch", receipt.branch, request.branch);
  check("baseBranch", receipt.baseBranch, request.baseBranch);
  check("baseRevision", receipt.baseRevision, request.baseRevision);
  check("actionId", receipt.actionId, request.actionId);
  check("packetSha256", receipt.packetSha256, request.packetSha256);
  check("authorityKind", receipt.authorityKind, request.authorityKind);
  check("terminalSessionId", receipt.terminalSessionId, request.terminalSessionId);
  check("policyEpoch", receipt.policyEpoch, request.policyEpoch);
  check("policyRevision", receipt.policyRevision, request.policyRevision);
  check("candidateFingerprint", receipt.candidateFingerprint, candidateFingerprint);
  if (Object.keys(mismatches).length > 0) {
    throw validationError("A preservation request id was replayed with changed inputs.", {
      requestId: request.requestId,
      mismatches,
      remedy: "Use a fresh request id for a changed candidate, or retry with the exact original inputs."
    });
  }
}

export function preserveCandidate(
  db: Database.Database,
  request: CandidatePreservationRequest,
  deps: CandidatePreservationDeps = {}
): CandidatePreservationReceipt {
  const hooks = deps.hooks ?? {};
  const now = request.now ?? new Date();
  preservationStage("preserve.preconditions", { evidenceRef: request.validation?.evidenceRef });
  const repositoryPath = canonical(request.repositoryPath);
  const candidateWorktreePath = canonical(request.candidateWorktreePath);
  hooks.onStage?.("preservation-authority-check");

  // --- Refusals that need no staging (AC6) ---------------------------------
  if (!request.validation?.passed || !request.validation.candidateFingerprint) {
    throw validationError("The candidate has no passing validation evidence; it will not be preserved.", {
      actionId: request.actionId,
      evidenceRef: request.validation?.evidenceRef ?? null
    });
  }

  const worktrees = listWorktrees(repositoryPath);
  const record = worktrees.find((entry) => canonical(entry.path) === candidateWorktreePath);
  if (!record) {
    throw validationError("The candidate path is not a registered worktree for this repository.", {
      candidateWorktreePath,
      remedy: "Preserve only a worktree Arcadia prepared for this repository."
    });
  }
  if (!record.branch) {
    throw validationError("The candidate worktree is detached; it has no branch to preserve.", { candidateWorktreePath });
  }
  const shortBranch = record.branch.replace(/^refs\/heads\//, "");
  if (shortBranch !== request.branch) {
    throw validationError("The candidate worktree is on an unexpected branch.", {
      expected: request.branch,
      observed: shortBranch,
      remedy: "Preserve the exact agent-owned branch the Session reserved."
    });
  }

  // --- Authorization before any Git object-store mutation (AC6) ------------
  // The base-advance merge check below writes real, if unreferenced, tree and
  // commit objects (commitTreeAt, mergesCleanly's merge-tree --write-tree).
  // Confirm the candidate is actually reserved and not conflicting with a
  // managed Session's lease first, so a stale or unauthorized request never
  // reaches that mutating work.
  const terminal = request.terminalSessionId ? getSession(db, request.terminalSessionId) : null;
  const acceptedTerminal = terminal ? findAcceptedTerminalCompletion(db, terminal) : null;
  if (request.terminalSessionId && (!terminal || !acceptedTerminal
    || canonical(terminal.repository_path) !== repositoryPath
    || canonical(terminal.worktree_path) !== candidateWorktreePath
    || terminal.branch !== request.branch || terminal.base_revision !== request.baseRevision
    || terminal.action_id !== request.actionId || terminal.packet_sha256 !== request.packetSha256
    || tryGit(candidateWorktreePath, ["rev-parse", "HEAD"])?.trim() !== acceptedTerminal.candidateHead)) {
    throw validationError("The terminal preservation request lacks an unchanged accepted completion binding.");
  }
  const reservation = request.terminalSessionId ? null : getActiveWorktreeReservation(db, repositoryPath, candidateWorktreePath, now);
  if (!request.terminalSessionId && !reservation) {
    throw validationError("The candidate worktree has no active reservation; refusing a stale preservation.", {
      candidateWorktreePath,
      remedy: "Preserve within the reservation window, or re-prepare the worktree."
    });
  }
  if (reservation && reservation.branch !== request.branch) {
    throw validationError("The candidate reservation names a different branch.", {
      reservedBranch: reservation.branch,
      requestedBranch: request.branch
    });
  }

  const lease = getRepositoryLease(db, repositoryPath);
  if (lease && (request.terminalSessionId || canonical(lease.worktree_path) !== candidateWorktreePath)) {
    throw validationError("Another Session holds this repository's lease; refusing a conflicting preservation.", {
      conflictingSessionId: lease.id,
      conflictingWorktree: lease.worktree_path,
      candidateWorktreePath
    });
  }

  const baseHead = tryGit(repositoryPath, ["rev-parse", request.baseBranch]);
  if (baseHead === null) {
    throw validationError("The base branch could not be resolved on the host controller.", { baseBranch: request.baseBranch });
  }
  // Set only when the base-advance merge check below actually runs, so
  // commitCandidate can refuse if anything moved the candidate branch past
  // the exact parent that check validated.
  let baseAdvanceCheckedParent: string | null = null;
  if (baseHead !== request.baseRevision) {
    if (!isAncestor(repositoryPath, request.baseRevision, baseHead)) {
      throw validationError(
        `The base branch ${request.baseBranch} changed from ${request.baseRevision} to ${baseHead}, which is not a forward advance; reconcile the candidate onto the current base in a fresh worktree before preserving.`,
        { baseBranch: request.baseBranch, oldBase: request.baseRevision, newBase: baseHead }
      );
    }
    const candidateHead = tryGit(candidateWorktreePath, ["rev-parse", "HEAD"]);
    if (!candidateHead) {
      throw validationError("The candidate worktree has no resolvable HEAD to check against the advanced base.", { candidateWorktreePath });
    }
    // Reuse the already-validated fingerprint rather than taking a fresh
    // snapshot here: a second independent snapshot could observe different
    // on-disk content than the one `stageAndFingerprint` commits below.
    const syntheticCommit = commitTreeAt(repositoryPath, request.validation.candidateFingerprint, candidateHead);
    if (!mergesCleanly(repositoryPath, syntheticCommit, baseHead)) {
      throw validationError(
        `The base branch ${request.baseBranch} advanced from ${request.baseRevision} to ${baseHead} and the candidate no longer merges cleanly with it; reconcile the candidate onto the current base in a fresh worktree before preserving.`,
        { baseBranch: request.baseBranch, oldBase: request.baseRevision, newBase: baseHead }
      );
    }
    baseAdvanceCheckedParent = candidateHead;
  }

  // --- Fingerprint exactly this candidate (AC2, AC3) ------------------------
  // The snapshot uses a scratch index; the real index changes only after commit.
  hooks.onStage?.("candidate-stage-and-fingerprint");
  preservationStage("preserve.snapshot");
  hooks.beforeStage?.();
  const candidateFingerprint = snapshotCandidate(candidateWorktreePath, request.baseRevision);
  hooks.afterStage?.();
  if (candidateFingerprint !== request.validation.candidateFingerprint) {
    throw validationError("Candidate content differs from the validated snapshot.", { evidenceRef: request.validation.evidenceRef });
  }
  if (acceptedTerminal && tryGit(candidateWorktreePath, ["rev-parse", "HEAD"])?.trim() !== acceptedTerminal.candidateHead) {
    throw validationError("The terminal candidate HEAD changed after its completion settlement was bound.");
  }
  if (acceptedTerminal && headTree(candidateWorktreePath) !== candidateFingerprint) {
    throw validationError("Terminal preservation must retain the exact completion settlement tree.");
  }

  // --- Idempotent replay by request id (AC3) -------------------------------
  preservationStage("preserve.replay");
  const priorReceipt = loadReceipt(db, request.requestId);
  if (priorReceipt) {
    assertReplayBindingsMatch(priorReceipt, request, candidateFingerprint);
    syncIndexToPreservedTree(candidateWorktreePath, candidateFingerprint);
    return { ...priorReceipt, replayed: true };
  }

  // --- One recoverable commit, crash-safe by trailer (AC3, AC7) ------------
  // A crash after committing but before the receipt persisted leaves the commit
  // on the branch. A retry finds it by its request-id trailer and reuses it
  // rather than committing a second time.
  let commitSha = findPreservationCommit(candidateWorktreePath, request.baseBranch, request.branch, request.requestId);
  if (commitSha) {
    const existingTree = tryGit(candidateWorktreePath, ["rev-parse", `${commitSha}^{tree}`]);
    if (existingTree !== candidateFingerprint) {
      throw validationError("A preservation commit for this request exists but the candidate content has since changed.", {
        requestId: request.requestId,
        remedy: "Use a fresh request id for the changed candidate."
      });
    }
    syncIndexToPreservedTree(candidateWorktreePath, candidateFingerprint);
  } else if (headTree(candidateWorktreePath) === candidateFingerprint) {
    // Nothing new to commit — the candidate content already matches HEAD.
    // Preserve the existing commit rather than creating an empty one.
    commitSha = git(candidateWorktreePath, ["rev-parse", "HEAD"]).trim();
    syncIndexToPreservedTree(candidateWorktreePath, candidateFingerprint);
  } else {
    preservationStage("preserve.recheck-snapshot");
    if (snapshotCandidate(candidateWorktreePath, request.baseRevision) !== candidateFingerprint) {
      throw validationError("Candidate changed between validation and preservation.");
    }
    preservationStage("preserve.recheck-binding");
    hooks.onStage?.("candidate-commit");
    hooks.beforeCommit?.();
    preservationStage("preserve.commit");
    commitSha = commitCandidate({
      candidateWorktreePath,
      actionId: request.actionId,
      requestId: request.requestId,
      fingerprint: candidateFingerprint,
      branch: request.branch,
      now,
      expectedParent: baseAdvanceCheckedParent
    });
    hooks.afterCommit?.();
  }
  if (acceptedTerminal && commitSha !== acceptedTerminal.candidateHead) {
    throw validationError("Terminal preservation must retain the exact completion settlement commit.");
  }

  const base: Omit<CandidatePreservationReceipt, "preservationState" | "pushedRemote" | "pullRequestNumber" | "pullRequestUrl" | "retryAction"> = {
    id: createId("preservationReceipt"),
    requestId: request.requestId,
    repositoryPath,
    candidateWorktreePath,
    branch: request.branch,
    baseBranch: request.baseBranch,
    baseRevision: request.baseRevision,
    actionId: request.actionId,
    packetSha256: request.packetSha256,
    ...(request.authorityKind ? { authorityKind: request.authorityKind } : {}),
    ...(request.terminalSessionId ? { terminalSessionId: request.terminalSessionId } : {}),
    policyEpoch: request.policyEpoch,
    policyRevision: request.policyRevision,
    candidateFingerprint,
    validationEvidenceRef: request.validation.evidenceRef,
    commitSha,
    createdAt: now.toISOString(),
    replayed: false
  };

  // --- Local-only fallback (AC5) -------------------------------------------
  const localOnly = (reason: string): CandidatePreservationReceipt => {
    hooks.onStage?.("preservation-receipt");
    return persistReceipt(db, {
      ...base,
      preservationState: "LOCAL ONLY",
      pushedRemote: null,
      pullRequestNumber: null,
      pullRequestUrl: null,
      retryAction:
        `Commit ${commitSha.slice(0, 12)} is preserved only on this machine (${reason}). ` +
        `Push branch ${request.branch} and open a draft pull request to make it remote-recoverable.`
    });
  };

  if (!request.remotePreservation.authorized) {
    preservationStage("preserve.receipt");
    return localOnly(`remote preservation not authorized: ${request.remotePreservation.reason}`);
  }

  const remote = deps.remote;
  if (!remote || !remote.hasRemote(repositoryPath)) {
    return localOnly("no reachable remote is configured");
  }

  if ("pushOnly" in request.remotePreservation) {
    preservationStage("preserve.push");
    hooks.beforePush?.();
    const { remote: remoteName } = remote.push({ repositoryPath, branch: request.branch });
    hooks.afterPush?.();
    return persistReceipt(db, {
      ...base,
      preservationState: "PUSHED",
      pushedRemote: remoteName,
      pullRequestNumber: null,
      pullRequestUrl: null,
      retryAction: `Branch ${request.branch} is pushed; open a draft pull request once the Session's outcome is accepted.`
    });
  }

  // --- Remote preservation (AC4) -------------------------------------------
  // The PR's base is chosen before anything is pushed: a candidate whose base
  // revision no remote branch carries is refused here, with the commit kept
  // on its local branch (a retry reuses it by trailer) and nothing pushed.
  preservationStage("preserve.pull-request-base");
  const resolved = resolvePullRequestBase(db, {
    repositoryPath, baseBranch: request.baseBranch, baseRevision: request.baseRevision, branch: request.branch
  }, remote);
  if (!resolved.ok) throw resolved.error;
  const { base: chosen, existing, tips } = resolved;
  const prBase = tips ? chosen : null;
  // Rendered before the push so a refusal or a Git read never lands between
  // the push and the pull request.
  const pullRequestBody = resolvePullRequestBody(request.remotePreservation.qaPlan, request, repositoryPath, commitSha, chosen);
  preservationStage("preserve.push");
  hooks.beforePush?.();
  const { remote: remoteName } = remote.push({ repositoryPath, branch: request.branch });
  hooks.afterPush?.();

  preservationStage("preserve.pull-request");
  hooks.beforePullRequestReceipt?.();
  const pullRequest = remote.upsertDraftPullRequest({
    repositoryPath,
    branch: request.branch,
    baseBranch: chosen.branch,
    title: `Candidate: ${request.actionId}`,
    body: pullRequestBody.body,
    existing: existing ? { number: existing.number, url: existing.url } : null
  });
  hooks.afterPullRequestReceipt?.();

  return persistReceipt(db, {
    ...base,
    preservationState: "IN PR",
    pushedRemote: remoteName,
    pullRequestNumber: pullRequest.number,
    pullRequestUrl: pullRequest.url,
    retryAction: null,
    ...(pullRequestBody.refusal ? { qaPlanRefusal: pullRequestBody.refusal } : {}),
    ...(prBase ? { prBase } : {})
  });
}

function stackedBaseUnavailable(selection: { reason: string; remedy: string }, input: { branch: string; baseBranch: string; baseRevision: string }): ArcadiaError {
  return validationError(`${selection.reason} Remedy: ${selection.remedy}`, {
    code: STACKED_BASE_UNAVAILABLE,
    branch: input.branch,
    baseBranch: input.baseBranch,
    baseRevision: input.baseRevision,
    remedy: selection.remedy
  });
}

/**
 * The base a candidate's draft PR is opened (or kept) on, with the open PR
 * already on the branch, or the refusal preservation raises before anything
 * is pushed: no remote branch can be the base ({@link STACKED_BASE_UNAVAILABLE}),
 * or an open PR already sits on a base that is no longer a valid choice
 * (`pull_request_base_mismatch`). Read-only (`ls-remote`, `gh pr view`); the
 * managed tick's pre-check calls it too, so neither refusal re-runs host
 * validation while it holds.
 *
 * An existing PR keeps its base (a body edit never retargets it): a base still
 * valid for this base revision is kept; any other is refused, since a body
 * describing another base than the PR's would reproduce Issue #987. A closed
 * or merged PR for the branch is no PR at all: a new one is opened.
 */
export function resolvePullRequestBase(
  db: Database.Database | null,
  input: { repositoryPath: string; baseBranch: string; baseRevision: string; branch: string },
  remote: Pick<CandidatePreservationRemote, "listBranchTips" | "findPullRequest">
):
  | { ok: true; base: PullRequestBase; existing: { number: number; url: string; baseRefName?: string } | null; tips: Array<{ branch: string; sha: string }> | null }
  | { ok: false; error: ArcadiaError } {
  const tips = remote.listBranchTips ? remote.listBranchTips({ repositoryPath: input.repositoryPath }) : null;
  const selection = tips ? selectPullRequestBaseFromTips(db, input, tips) : selectPullRequestBase(db, input, remote);
  if (!selection.ok) return { ok: false, error: stackedBaseUnavailable(selection, input) };
  const found = remote.findPullRequest({ repositoryPath: input.repositoryPath, branch: input.branch });
  const existing = found && (found.state === undefined || found.state.toUpperCase() === "OPEN") ? found : null;
  let chosen = selection.base;
  if (existing?.baseRefName && existing.baseRefName !== chosen.branch) {
    const kept = tips ? existingPullRequestBase(input, existing.baseRefName, tips) : null;
    if (!kept) {
      return {
        ok: false,
        error: validationError(
          `Pull request ${existing.url} for ${input.branch} is opened against ${existing.baseRefName}, but this candidate's base revision ${input.baseRevision} `
            + `selects ${chosen.branch} (${chosen.reason}); its Operator QA plan would describe a different base than the PR, so nothing is pushed. `
            + `Remedy: retarget it with \`gh pr edit ${existing.number} --base ${chosen.branch}\` after checking that is right; the next preservation then updates its body.`,
          { code: "pull_request_base_mismatch", pullRequest: existing.url, prBase: chosen, existingBase: existing.baseRefName }
        )
      };
    }
    chosen = kept;
  }
  return { ok: true, base: chosen, existing, tips };
}

/**
 * Choose the draft PR's base so GitHub diffs it from exactly the candidate's
 * base revision, the revision the host Operator QA plan diffs from. Read-only:
 * one `git ls-remote --heads` through the adapter plus local Git reads.
 *
 * In order:
 * - The remote's Project base tip is the base revision: the Project base,
 *   unchanged (the first Action, and every candidate launched from the
 *   published base).
 * - A remote agent candidate branch (SAFE_TASK_BRANCH naming, never the
 *   Project base or the candidate's own branch) whose tip IS the base
 *   revision: the PR is stacked on it. This is the previous serial Action's
 *   branch after that Action integrated by local fast-forward and the remote
 *   base, never pushed by the worker, stayed behind. Because its tip is the
 *   base revision itself, GitHub's diff is exactly the candidate's own change
 *   and can hide none of it. Several such branches all give the identical
 *   diff, so the choice only names the base: the one most recently preserved
 *   in this repository wins, then the greatest full name (deterministic; the
 *   prefix compares first, then the UTC timestamp agent branch names end in).
 * - The remote base already contains the base revision (it advanced on its
 *   own, for example the previous PR was merged on GitHub and its branch
 *   deleted): the Project base, unchanged; GitHub's three-dot diff starts at
 *   the base revision.
 * - Otherwise (the previous candidate's branch deleted or never pushed):
 *   refused, never the Project base, whose diff would show earlier Actions'
 *   changes as this one's.
 *
 * Unchanged where it cannot know better: no tip listing, a remote without the
 * Project base, or a remote base tip this repository has never fetched with
 * no candidate branch matching -- the Project base, as before.
 */
export function selectPullRequestBase(
  db: Database.Database | null,
  input: { repositoryPath: string; baseBranch: string; baseRevision: string; branch: string },
  remote: Pick<CandidatePreservationRemote, "listBranchTips">
): PullRequestBaseSelection {
  if (!remote.listBranchTips) {
    return { ok: true, base: { kind: "project", branch: input.baseBranch, tip: null, reason: "The remote adapter reports no branch tips, so the PR opens on the Project base." } };
  }
  return selectPullRequestBaseFromTips(db, input, remote.listBranchTips({ repositoryPath: input.repositoryPath }));
}

/** {@link selectPullRequestBase} over an already-read tip listing. */
function selectPullRequestBaseFromTips(
  db: Database.Database | null,
  input: { repositoryPath: string; baseBranch: string; baseRevision: string; branch: string },
  tips: Array<{ branch: string; sha: string }>
): PullRequestBaseSelection {
  const { repositoryPath, baseBranch, baseRevision, branch } = input;
  const project = (tip: string | null, reason: string): PullRequestBaseSelection => ({ ok: true, base: { kind: "project", branch: baseBranch, tip, reason } });
  const remoteBase = tips.find((entry) => entry.branch === baseBranch)?.sha ?? null;
  const short = baseRevision.slice(0, 12);
  if (remoteBase === baseRevision) return project(remoteBase, `The candidate's base revision ${short} is the tip of ${baseBranch} on the remote.`);
  const matches = tips
    .filter((entry) => entry.sha === baseRevision && entry.branch !== baseBranch && entry.branch !== branch && SAFE_TASK_BRANCH.test(entry.branch))
    .map((entry) => entry.branch);
  const remoteState = remoteBase === null ? `the remote has no ${baseBranch}` : `the remote ${baseBranch} is at ${remoteBase.slice(0, 12)}`;
  if (matches.length > 0) {
    const ranked = rankByLatestPreservation(db, repositoryPath, matches);
    const others = ranked.slice(1);
    return {
      ok: true,
      base: {
        kind: "stacked",
        branch: ranked[0],
        tip: baseRevision,
        reason: `The candidate's base revision ${short} is not the tip of the remote ${baseBranch} (${remoteState}; the worker never pushes the base), `
          + `and ${ranked[0]} is the remote candidate branch whose tip is ${short}, so the PR is stacked on it`
          + `${others.length > 0 ? ` (also at ${short}: ${others.join(", ")}; the most recently preserved wins)` : ""}.`
      }
    };
  }
  const known = remoteBase !== null && tryGit(repositoryPath, ["cat-file", "-e", `${remoteBase}^{commit}`]) !== null;
  if (known && isAncestor(repositoryPath, baseRevision, remoteBase)) {
    return project(remoteBase, `The remote ${baseBranch} (${remoteBase.slice(0, 12)}) already contains the candidate's base revision ${short}.`);
  }
  if (remoteBase === null || !known) {
    return project(remoteBase, `${remoteState[0].toUpperCase()}${remoteState.slice(1)}${remoteBase !== null ? " (not fetched here)" : ""} and no remote candidate branch has its tip at ${short}, so the PR opens on the Project base.`);
  }
  const local = (tryGit(repositoryPath, ["for-each-ref", "--points-at", baseRevision, "--format=%(refname:short)", "refs/heads"]) ?? "")
    .split("\n").map((line) => line.trim()).filter((name) => name && name !== baseBranch && name !== branch && SAFE_TASK_BRANCH.test(name)).sort();
  // A fresh agent branch at exactly the base revision always works (and never
  // needs a force push, even where the old remote branch moved on).
  const fresh = `\`git -C ${repositoryPath} push origin ${baseRevision}:refs/heads/agent/stack-base-${baseRevision.slice(0, 12)}\``;
  const restore = local.length > 0
    ? `push the previous candidate's branch again (\`git -C ${repositoryPath} push origin ${local[0]}\`; if the remote refuses it as a non-fast-forward, push a fresh branch at that revision instead: ${fresh})`
    : `push a branch at that revision (${fresh})`;
  return {
    ok: false,
    reason: `No remote branch can be this candidate's pull-request base: its base revision ${baseRevision} is not on the remote ${baseBranch} (${remoteState}; `
      + `an earlier Action integrated by local fast-forward), and no remote candidate branch has its tip there (the previous candidate's branch was deleted or never pushed). `
      + `A PR on ${baseBranch} would show the earlier Actions' changes as this one's (Issue #987), so nothing is pushed and no PR is opened; the candidate stays preserved locally on ${branch}.`,
    remedy: `${restore}, or publish the integrated base yourself (\`git -C ${repositoryPath} push origin ${baseBranch}\`: an operator decision; the worker never pushes the base). `
      + "The next preservation attempt then opens the PR."
  };
}

/**
 * An existing PR's base, kept when it is still a valid choice for this base
 * revision: an agent candidate branch whose remote tip is the base revision,
 * or the Project base whose remote tip is, or already contains, it.
 */
function existingPullRequestBase(
  input: { repositoryPath: string; baseBranch: string; baseRevision: string },
  existingBase: string,
  tips: Array<{ branch: string; sha: string }>
): PullRequestBase | null {
  const tip = tips.find((entry) => entry.branch === existingBase)?.sha ?? null;
  if (!tip) return null;
  const short = input.baseRevision.slice(0, 12);
  if (existingBase === input.baseBranch) {
    const contains = tip === input.baseRevision || (tryGit(input.repositoryPath, ["cat-file", "-e", `${tip}^{commit}`]) !== null
      && isAncestor(input.repositoryPath, input.baseRevision, tip));
    return contains ? { kind: "project", branch: existingBase, tip, reason: `The existing PR's base ${existingBase} (${tip.slice(0, 12)}) contains the candidate's base revision ${short}; kept.` } : null;
  }
  return tip === input.baseRevision && SAFE_TASK_BRANCH.test(existingBase)
    ? { kind: "stacked", branch: existingBase, tip, reason: `The existing PR's base ${existingBase} is the remote candidate branch whose tip is the candidate's base revision ${short}; kept.` }
    : null;
}

/** Most recently preserved branch (in this repository) first, then the greatest name (by full name, prefix first). */
function rankByLatestPreservation(db: Database.Database | null, repositoryPath: string, branches: string[]): string[] {
  const latest = new Map<string, string>();
  try {
    const rows = db?.prepare(`SELECT branch, repository_path, created_at FROM candidate_preservation_receipts WHERE branch IN (${branches.map(() => "?").join(", ")})`)
      .all(...branches) as Array<{ branch: string; repository_path: string; created_at: string }> | undefined;
    const repository = canonical(repositoryPath);
    for (const row of rows ?? []) {
      if (canonical(row.repository_path) !== repository) continue;
      if ((latest.get(row.branch) ?? "") < row.created_at) latest.set(row.branch, row.created_at);
    }
  } catch { /* no receipts table: names alone decide */ }
  return [...branches].sort((a, b) => (latest.get(b) ?? "").localeCompare(latest.get(a) ?? "") || (a < b ? 1 : a > b ? -1 : 0));
}

/** The pull-request body: literal text, or the Operator QA plan rendered from its governed source. */
function resolvePullRequestBody(
  plan: string | OperatorQaPlanSource,
  request: CandidatePreservationRequest,
  repositoryPath: string,
  commitSha: string,
  prBase: PullRequestBase
): { body: string; refusal: string | null } {
  if (typeof plan === "string") return { body: plan, refusal: null };
  // The plan names the branch the PR is opened against. A stacked base's tip
  // is the candidate's base revision itself, so the diff it lists is the
  // same diff GitHub shows; the Project base renders exactly as before.
  const result = renderPreservedOperatorQaPlan(plan, {
    repositoryPath,
    branch: request.branch,
    baseBranch: prBase.branch,
    baseRevision: request.baseRevision,
    commitSha
  });
  return { body: withValidationEvidence(result.body, plan, request, repositoryPath, commitSha), refusal: result.status === "refused" ? result.reason : null };
}

/**
 * The Operator QA plan exactly as host preservation renders it into a
 * preserved candidate's pull-request body, from the candidate's Git facts in
 * `repositoryPath` (changed files against the launch base revision, and which
 * named paths exist at the commit). `baseBranch` is the branch the PR is
 * opened against: the Project base, or a stacked base whose tip is
 * `baseRevision` ({@link selectPullRequestBase}). Exported so the read-only checkpoint
 * replay (scripts/qa-plan-consistency.ts) re-renders a preserved candidate's
 * plan through this same path rather than a copy of it.
 */
export function renderPreservedOperatorQaPlan(
  plan: OperatorQaPlanSource,
  input: { repositoryPath: string; branch: string; baseBranch: string; baseRevision: string; commitSha: string }
): OperatorQaPlanResult {
  const { repositoryPath, commitSha } = input;
  const facts = { branch: input.branch, baseBranch: input.baseBranch, baseRevision: input.baseRevision, commitSha };
  // A rendering failure of any kind (a Git read, a timeout, a renderer defect)
  // becomes an explicit refusal body: it must never stop the push.
  try {
    return renderOperatorQaPlan(plan, {
      ...facts,
      changedFiles: readChangedFiles(repositoryPath, input.baseRevision, commitSha),
      pathExists: (candidate) => !candidate.startsWith("-") && tryGit(repositoryPath, ["cat-file", "-e", `${commitSha}:${candidate}`]) !== null
    });
  } catch (error) {
    return refusedOperatorQaPlan(plan, facts,
      `the Operator QA plan could not be rendered (${error instanceof Error ? error.message : String(error)}).`);
  }
}

/**
 * The plan, then the Validation evidence the receipt's host record holds and
 * the completion-settlement line. Like the plan, a rendering failure becomes
 * an explicit status and never stops the push.
 */
function withValidationEvidence(
  planBody: string,
  plan: OperatorQaPlanSource,
  request: CandidatePreservationRequest,
  repositoryPath: string,
  commitSha: string
): string {
  // A failed or timed-out Git read only drops the commit relation, never the evidence.
  let commitTree: string | null;
  try {
    commitTree = tryGit(repositoryPath, ["rev-parse", "--verify", `${commitSha}^{tree}`]) || null;
  } catch {
    commitTree = null;
  }
  try {
    return composePreservedPullRequestBody(planBody, {
      evidenceRef: request.validation.evidenceRef,
      evidence: readValidationEvidence(request.validation.evidenceRef),
      declaredCommands: plan.validationCommands,
      candidateFingerprint: request.validation.candidateFingerprint,
      candidateCommit: { sha: commitSha, tree: commitTree }
    });
  } catch {
    return `${planBody}\n\n${unavailableValidationEvidence("the validation evidence could not be rendered (renderer defect).")}\n\n${COMPLETION_SETTLEMENT_LINE}`;
  }
}

/** Files the candidate commit changes against its launch base, or null when Git cannot say. */
function readChangedFiles(repositoryPath: string, baseRevision: string, commitSha: string): ChangedFile[] | null {
  const output = tryGit(repositoryPath, ["-c", "core.quotePath=false", "diff", "--name-status", "--no-renames", "-z", baseRevision, commitSha]);
  if (output === null) return null;
  const fields = output.split("\0").filter((field) => field.length > 0);
  if (fields.length % 2 !== 0) return null;
  const files: ChangedFile[] = [];
  for (let index = 0; index < fields.length; index += 2) files.push({ status: fields[index], path: fields[index + 1] });
  return files;
}

/** A killed `gh pr create`/`edit` may already have taken effect remotely. */
function pullRequestWriteRemedy(branch: string): string {
  return `The preservation commit is durable and pushed, but the pull request may or may not have been created or updated before the timeout. ` +
    `Check for an existing pull request first (\`gh pr view ${branch}\`); a retry of the same fixed protected launcher reuses the same request id and commit and updates an existing pull request rather than creating another, but confirm none was opened twice.`;
}

/** Real network adapter: `git push` plus the `gh` CLI for the draft pull request. */
export const systemPreservationRemote: CandidatePreservationRemote = {
  hasRemote(repositoryPath) {
    return tryGit(repositoryPath, ["remote", "get-url", "origin"]) !== null;
  },
  push({ repositoryPath, branch, commitSha }) {
    git(repositoryPath, commitSha
      ? ["push", "origin", `${commitSha}:refs/heads/${branch}`]
      : ["push", "--set-upstream", "origin", branch]);
    return { remote: "origin" };
  },
  listBranchTips({ repositoryPath }) {
    return git(repositoryPath, ["ls-remote", "--heads", "origin"]).split("\n").flatMap((line) => {
      const match = /^([0-9a-f]{40,64})\trefs\/heads\/(.+)$/.exec(line.trim());
      return match ? [{ branch: match[2], sha: match[1] }] : [];
    });
  },
  findPullRequest({ repositoryPath, branch }) {
    try {
      const output = boundedExec("gh", ["pr", "view", branch, "--json", "number,url,baseRefName,state"], {
        cwd: repositoryPath,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      }).toString();
      const parsed = JSON.parse(output) as { number: number; url: string; baseRefName?: unknown; state?: unknown };
      return {
        number: parsed.number,
        url: parsed.url,
        ...(typeof parsed.baseRefName === "string" && parsed.baseRefName ? { baseRefName: parsed.baseRefName } : {}),
        ...(typeof parsed.state === "string" && parsed.state ? { state: parsed.state } : {})
      };
    } catch (error) {
      // A timeout is not "no pull request"; that answer would open a duplicate.
      if (error instanceof ArcadiaError && error.code === "PRESERVATION_GIT_TIMEOUT") throw error;
      return null;
    }
  },
  upsertDraftPullRequest({ repositoryPath, branch, baseBranch, title, body, existing }) {
    if (existing) {
      boundedExec("gh", ["pr", "edit", String(existing.number), "--body", body], {
        cwd: repositoryPath,
        stdio: ["ignore", "ignore", "pipe"]
      }, { remedy: pullRequestWriteRemedy(branch) });
      return existing;
    }
    const output = boundedExec(
      "gh",
      ["pr", "create", "--draft", "--base", baseBranch, "--head", branch, "--title", title, "--body", body],
      { cwd: repositoryPath, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      { remedy: pullRequestWriteRemedy(branch) }
    ).toString().trim();
    const number = Number.parseInt(output.match(/\/pull\/(\d+)/)?.[1] ?? "0", 10);
    return { number, url: output };
  }
};

export interface OutstandingCandidate {
  actionId: string;
  branch: string;
  commitSha: string;
  preservationState: CandidatePreservationReceipt["preservationState"];
  pullRequestNumber: number | null;
  pullRequestUrl: string | null;
}

/**
 * The preserved candidate for one Action that has not landed on the base
 * branch yet, or null when none is outstanding.
 *
 * A finished Session leaves its work on a candidate branch, usually behind a
 * pull request. Until that merges, the Action reads as unfinished in the base
 * checkout while a completion settlement for it already exists on the
 * candidate. Anything in the base checkout that writes the same governed
 * documents during that window collides with the settlement at merge, so
 * callers use this to hold off rather than to decide anything about the work
 * itself.
 *
 * "Landed" is the same test `arcadia go` uses to call a branch integrated:
 * an ancestor of the base branch, or patch-equivalent to it, so a squash or
 * rebase merge counts. When the branch ref is gone the commit alone is
 * checked, and an unreadable repository reports nothing outstanding rather
 * than blocking the caller forever.
 */
export function findOutstandingCandidate(
  db: Database.Database,
  input: { repositoryPath: string; actionId: string; baseBranch?: string }
): OutstandingCandidate | null {
  ensureCandidatePreservationTable(db);
  const repositoryPath = canonical(input.repositoryPath);
  const rows = db
    .prepare(
      `SELECT repository_path, branch, commit_sha, preservation_state, pull_request_number, pull_request_url
         FROM candidate_preservation_receipts
        WHERE action_id = ?
        ORDER BY created_at DESC, rowid DESC`
    )
    .all(input.actionId) as Array<{
      repository_path: string;
      branch: string;
      commit_sha: string;
      preservation_state: CandidatePreservationReceipt["preservationState"];
      pull_request_number: number | null;
      pull_request_url: string | null;
    }>;
  const row = rows.find((candidate) => canonical(candidate.repository_path) === repositoryPath);
  if (!row) return null;

  let baseBranch: string;
  try {
    baseBranch = input.baseBranch ?? resolveBaseBranch(repositoryPath);
  } catch {
    return null;
  }
  try {
    const landed = refExists(repositoryPath, row.branch)
      ? isAncestor(repositoryPath, row.branch, baseBranch) || isPatchEquivalent(repositoryPath, baseBranch, row.branch)
      : isAncestor(repositoryPath, row.commit_sha, baseBranch);
    if (landed) return null;
  } catch {
    return null;
  }

  return {
    actionId: input.actionId,
    branch: row.branch,
    commitSha: row.commit_sha,
    preservationState: row.preservation_state,
    pullRequestNumber: row.pull_request_number,
    pullRequestUrl: row.pull_request_url
  };
}
