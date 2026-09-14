import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { git, listWorktrees, tryGit } from "../git/worktrees.js";
import { snapshotCandidate } from "./candidateSnapshot.js";
import { createId } from "../utils/id.js";
import { getActiveWorktreeReservation, getRepositoryLease } from "./index.js";

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
  | { authorized: true; qaPlan: string };

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
  packetSha256: string;
  policyEpoch: number;
  policyRevision: number;
  /** Proven validation of the candidate. Absent or failed validation refuses. */
  validation: { passed: boolean; evidenceRef: string; candidateFingerprint: string };
  remotePreservation: RemotePreservationAuthorization;
  now?: Date;
}

/** Deterministic fault-injection boundaries, one per irreversible step. */
export interface CandidatePreservationHooks {
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
  /** Push the exact agent branch. Returns the remote name used. */
  push(input: { repositoryPath: string; branch: string }): { remote: string };
  findPullRequest(input: { repositoryPath: string; branch: string }): { number: number; url: string } | null;
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
  packetSha256: string;
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
  createdAt: string;
  replayed: boolean;
}

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
      session_id TEXT PRIMARY KEY, pid INTEGER NOT NULL, token TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_candidate_preservation_branch
      ON candidate_preservation_receipts(repository_path, branch);
  `);
}

function canonical(value: string): string {
  const resolved = path.resolve(value);
  return existsSync(resolved) ? realpathSync(resolved) : resolved;
}

/** Capture raw candidate bytes with Git's object store, then set only this
 * worktree's index to the captured tree. Filters/hooks never run as host code. */
function stageAndFingerprint(candidateWorktreePath: string): string {
  const tree = snapshotCandidate(candidateWorktreePath);
  git(candidateWorktreePath, ["read-tree", tree]);
  return tree;
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
}): string {
  const message =
    `chore(candidate): preserve ${input.actionId} candidate for handoff\n\n` +
    `${PRESERVATION_TRAILER}: ${input.requestId}\n` +
    `${FINGERPRINT_TRAILER}: ${input.fingerprint}\n`;
  const stamp = input.now.toISOString();
  const parent = git(input.candidateWorktreePath, ["rev-parse", "HEAD"]).trim();
  const branch = `refs/heads/${input.branch}`;
  if (git(input.candidateWorktreePath, ["symbolic-ref", "HEAD"]).trim() !== branch) throw validationError("Candidate branch changed before commit.");
  const commit = execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgSign=false", "commit-tree", input.fingerprint, "-p", parent, "-m", message], {
    cwd: input.candidateWorktreePath,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Arcadia Controller",
      GIT_AUTHOR_EMAIL: "controller@arcadia.local",
      GIT_COMMITTER_NAME: "Arcadia Controller",
      GIT_COMMITTER_EMAIL: "controller@arcadia.local",
      GIT_AUTHOR_DATE: stamp,
      GIT_COMMITTER_DATE: stamp
    }
  }).trim();
  git(input.candidateWorktreePath, ["-c", "core.hooksPath=/dev/null", "update-ref", branch, commit, parent]);
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
  const repositoryPath = canonical(request.repositoryPath);
  const candidateWorktreePath = canonical(request.candidateWorktreePath);

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

  const baseHead = tryGit(repositoryPath, ["rev-parse", request.baseBranch]);
  if (baseHead === null) {
    throw validationError("The base branch could not be resolved on the host controller.", { baseBranch: request.baseBranch });
  }
  if (baseHead !== request.baseRevision) {
    throw validationError("The base branch history changed since this candidate was launched.", {
      baseBranch: request.baseBranch,
      expected: request.baseRevision,
      observed: baseHead,
      remedy: "Reconcile the candidate onto the current base in a fresh worktree before preserving."
    });
  }

  const reservation = getActiveWorktreeReservation(db, repositoryPath, candidateWorktreePath, now);
  if (!reservation) {
    throw validationError("The candidate worktree has no active reservation; refusing a stale preservation.", {
      candidateWorktreePath,
      remedy: "Preserve within the reservation window, or re-prepare the worktree."
    });
  }
  if (reservation.branch !== request.branch) {
    throw validationError("The candidate reservation names a different branch.", {
      reservedBranch: reservation.branch,
      requestedBranch: request.branch
    });
  }

  const lease = getRepositoryLease(db, repositoryPath);
  if (lease && canonical(lease.worktree_path) !== candidateWorktreePath) {
    throw validationError("Another Session holds this repository's lease; refusing a conflicting preservation.", {
      conflictingSessionId: lease.id,
      conflictingWorktree: lease.worktree_path,
      candidateWorktreePath
    });
  }

  // --- Stage exactly this candidate and fingerprint it (AC2, AC3) ----------
  hooks.beforeStage?.();
  const candidateFingerprint = stageAndFingerprint(candidateWorktreePath);
  hooks.afterStage?.();
  if (candidateFingerprint !== request.validation.candidateFingerprint) {
    throw validationError("Candidate content differs from the validated snapshot.", { evidenceRef: request.validation.evidenceRef });
  }

  // --- Idempotent replay by request id (AC3) -------------------------------
  const priorReceipt = loadReceipt(db, request.requestId);
  if (priorReceipt) {
    assertReplayBindingsMatch(priorReceipt, request, candidateFingerprint);
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
  } else if (headTree(candidateWorktreePath) === candidateFingerprint) {
    // Nothing new to commit — the candidate content already matches HEAD.
    // Preserve the existing commit rather than creating an empty one.
    commitSha = git(candidateWorktreePath, ["rev-parse", "HEAD"]).trim();
  } else {
    if (snapshotCandidate(candidateWorktreePath) !== candidateFingerprint) {
      throw validationError("Candidate changed between validation and preservation.");
    }
    hooks.beforeCommit?.();
    commitSha = commitCandidate({
      candidateWorktreePath,
      actionId: request.actionId,
      requestId: request.requestId,
      fingerprint: candidateFingerprint,
      branch: request.branch,
      now
    });
    hooks.afterCommit?.();
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
    policyEpoch: request.policyEpoch,
    policyRevision: request.policyRevision,
    candidateFingerprint,
    validationEvidenceRef: request.validation.evidenceRef,
    commitSha,
    createdAt: now.toISOString(),
    replayed: false
  };

  // --- Local-only fallback (AC5) -------------------------------------------
  const localOnly = (reason: string): CandidatePreservationReceipt =>
    persistReceipt(db, {
      ...base,
      preservationState: "LOCAL ONLY",
      pushedRemote: null,
      pullRequestNumber: null,
      pullRequestUrl: null,
      retryAction:
        `Commit ${commitSha.slice(0, 12)} is preserved only on this machine (${reason}). ` +
        `Push branch ${request.branch} and open a draft pull request to make it remote-recoverable.`
    });

  if (!request.remotePreservation.authorized) {
    return localOnly(`remote preservation not authorized: ${request.remotePreservation.reason}`);
  }

  const remote = deps.remote;
  if (!remote || !remote.hasRemote(repositoryPath)) {
    return localOnly("no reachable remote is configured");
  }

  // --- Remote preservation (AC4) -------------------------------------------
  hooks.beforePush?.();
  const { remote: remoteName } = remote.push({ repositoryPath, branch: request.branch });
  hooks.afterPush?.();

  const existing = remote.findPullRequest({ repositoryPath, branch: request.branch });
  hooks.beforePullRequestReceipt?.();
  const pullRequest = remote.upsertDraftPullRequest({
    repositoryPath,
    branch: request.branch,
    baseBranch: request.baseBranch,
    title: `Candidate: ${request.actionId}`,
    body: request.remotePreservation.qaPlan,
    existing
  });
  hooks.afterPullRequestReceipt?.();

  return persistReceipt(db, {
    ...base,
    preservationState: "IN PR",
    pushedRemote: remoteName,
    pullRequestNumber: pullRequest.number,
    pullRequestUrl: pullRequest.url,
    retryAction: null
  });
}

/** Real network adapter: `git push` plus the `gh` CLI for the draft pull request. */
export const systemPreservationRemote: CandidatePreservationRemote = {
  hasRemote(repositoryPath) {
    return tryGit(repositoryPath, ["remote", "get-url", "origin"]) !== null;
  },
  push({ repositoryPath, branch }) {
    git(repositoryPath, ["push", "--set-upstream", "origin", branch]);
    return { remote: "origin" };
  },
  findPullRequest({ repositoryPath, branch }) {
    try {
      const output = execFileSync("gh", ["pr", "view", branch, "--json", "number,url"], {
        cwd: repositoryPath,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      });
      const parsed = JSON.parse(output) as { number: number; url: string };
      return { number: parsed.number, url: parsed.url };
    } catch {
      return null;
    }
  },
  upsertDraftPullRequest({ repositoryPath, branch, baseBranch, title, body, existing }) {
    if (existing) {
      execFileSync("gh", ["pr", "edit", String(existing.number), "--body", body], {
        cwd: repositoryPath,
        stdio: ["ignore", "ignore", "pipe"]
      });
      return existing;
    }
    const output = execFileSync(
      "gh",
      ["pr", "create", "--draft", "--base", baseBranch, "--head", branch, "--title", title, "--body", body],
      { cwd: repositoryPath, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    ).trim();
    const number = Number.parseInt(output.match(/\/pull\/(\d+)/)?.[1] ?? "0", 10);
    return { number, url: output };
  }
};
