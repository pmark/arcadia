import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readSync, type Stats } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { parse as parseYaml } from "yaml";
import { validationError } from "../cli/errors.js";
import { countCommits, git, parseWorktrees, tryGit, uncommittedChanges } from "../git/worktrees.js";
import { PRESERVATION_REQUEST_FILE } from "./candidateSnapshot.js";
import { GO_REQUEST_FILE } from "./goRequestProtocol.js";
import { canonicalPath, getActiveActionClaim } from "./index.js";

/**
 * Issue #884: a candidate `arcadia go` prepared but nobody ever launched, whose
 * only dirt is pending Agent Ask drafts, used to be refused exactly like one
 * holding real code -- stranding the Action. This module recognizes that one
 * narrow shape, receipts every draft by exact bytes before anything else, and
 * lets the same worktree and branch resume. It never settles, copies, moves or
 * deletes a draft, and it deliberately leaves the shared `uncommittedChanges`
 * helper untouched: every other caller (tidy, claim release) must keep
 * treating a draft as dirt, or a retirement could silently discard one.
 */

/** Exactly the isolated draft name `agent-ask draft` writes; nothing under `archive/`. */
const DRAFT_ASK_PATH = /^\.arcadia\/asks\/agent-ask-[a-z0-9][a-z0-9-]*\.ya?ml$/;
/** A draft is a short YAML document; anything larger is not one. */
export const DRAFT_ASK_MAX_BYTES = 1024 * 1024;

export type CandidateKind = "draft_only" | "code_bearing" | "unknown";

export interface CapturedDraft {
  path: string;
  sha256: string;
  bytes: number;
  content: Buffer;
}

export interface CandidateDirt {
  kind: CandidateKind;
  /** Every draft, sorted by path; set only for `draft_only`. */
  drafts: CapturedDraft[];
  /** Why the worktree is not `draft_only`; null when it is. */
  reason: string | null;
}

export interface DraftRecoveryEntry {
  path: string;
  sha256: string;
  bytes: number;
  origin: { worktree: string; branch: string };
  /** Parsed for information only; never used to decide ownership. */
  project: string | null;
  /** Parsed for information only; never used to decide ownership. */
  requestId: string | null;
  relevance: "current_action" | "other_project" | "unparseable";
}

export interface DraftRecoveryReceipt {
  requestId: string;
  repository: string;
  worktree: string;
  branch: string;
  projectSlug: string;
  actionId: string;
  /** The branch tip, equal to the base it was prepared from: no commits were made. */
  baseSha: string;
  drafts: DraftRecoveryEntry[];
}

export type DraftCandidateDecision =
  | { kind: "none" }
  | { kind: "resume"; path: string; branch: string; receipt: DraftRecoveryReceipt }
  | { kind: "refuse"; reason: string; details: Record<string, unknown> };

export const ORPHAN_CANDIDATE_REASON = "A prepared worktree for this Action already holds uncommitted changes; Arcadia go will not prepare a second one.";
export const ORPHAN_CANDIDATE_REMEDY = "This worktree was never launched through Arcadia, so its exit cannot be proven terminal. Preserve it (commit and push its work, or resume it by hand) or discard it (remove the worktree and branch) before retrying.";
export const UNSAFE_DRAFT_CANDIDATE_REASON = "A prepared worktree for this Action holds only Agent Ask drafts, but Arcadia cannot prove it is safe to resume; every draft is receipted in place and untouched.";

/**
 * Classify a candidate's uncommitted state from Git's NUL-delimited status --
 * never the line format, which C-quotes unusual paths and prints renames as
 * `old -> new` -- cross-checked against a direct listing of `.arcadia/asks`,
 * since an ignored file is invisible to status. Anything not provably a
 * regular, small, UTF-8 draft file at the exact draft path fails closed.
 */
export function classifyCandidateDirt(worktreePath: string): CandidateDirt {
  const unknown = (reason: string): CandidateDirt => ({ kind: "unknown", drafts: [], reason });
  // Untrimmed: a leading status column can be a space.
  const status = rawGit(worktreePath, ["--no-optional-locks", "status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (status === null) return unknown("Git status could not be read.");
  const fields = status.split("\0");
  const draftPaths: string[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const entry = fields[index];
    if (!entry) continue;
    const code = entry.slice(0, 2);
    const file = entry.slice(3);
    if (code !== "??") {
      return { kind: "code_bearing", drafts: [], reason: `Tracked change ${JSON.stringify(code)} at ${file}.` };
    }
    if (file === GO_REQUEST_FILE || file === PRESERVATION_REQUEST_FILE) continue;
    if (!file.startsWith(".arcadia/")) {
      return { kind: "code_bearing", drafts: [], reason: `Untracked non-Ask file ${file}.` };
    }
    if (!DRAFT_ASK_PATH.test(file)) return unknown(`Untracked file ${file} is not an isolated Agent Ask draft.`);
    draftPaths.push(file);
  }
  if (draftPaths.length === 0) return unknown("No Agent Ask draft was found.");

  const root = path.resolve(worktreePath);
  for (const directory of [".arcadia", path.join(".arcadia", "asks")]) {
    const stat = lstatOrNull(path.join(root, directory));
    if (!stat?.isDirectory() || stat.isSymbolicLink()) return unknown(`${directory} is not a real directory.`);
  }

  // Ignored files never appear in status: an unlisted, untracked entry is one.
  const tracked = rawGit(worktreePath, ["ls-files", "-z", "--", ".arcadia/asks"]);
  if (tracked === null) return unknown("Tracked Agent Asks could not be listed.");
  const trackedNames = new Set(tracked.split("\0").filter(Boolean).map((file) => file.slice(".arcadia/asks/".length).split("/")[0]));
  const listed = new Set(draftPaths.map((file) => path.basename(file)));
  let names: string[];
  try {
    names = readdirSync(path.join(root, ".arcadia", "asks"));
  } catch {
    return unknown(".arcadia/asks could not be listed.");
  }
  for (const name of names) {
    if (trackedNames.has(name) || listed.has(name)) continue;
    return unknown(`.arcadia/asks/${name} is untracked but not reported by Git status (ignored or not a draft).`);
  }

  const drafts: CapturedDraft[] = [];
  for (const file of [...draftPaths].sort()) {
    const captured = captureDraft(root, file);
    if (typeof captured === "string") return unknown(captured);
    drafts.push(captured);
  }
  return { kind: "draft_only", drafts, reason: null };
}

function rawGit(cwd: string, args: string[]): string | null {
  try {
    return git(cwd, args);
  } catch {
    return null;
  }
}

function lstatOrNull(target: string): Stats | null {
  try {
    return lstatSync(target);
  } catch {
    return null;
  }
}

/** Raw bytes through a no-follow descriptor, capped, hashed before any decoding. */
function captureDraft(root: string, file: string): CapturedDraft | string {
  const absolute = path.join(root, file);
  const before = lstatOrNull(absolute);
  if (!before?.isFile()) return `${file} is not a regular file.`;
  if (before.size > DRAFT_ASK_MAX_BYTES) return `${file} exceeds the ${DRAFT_ASK_MAX_BYTES}-byte draft limit.`;
  let descriptor: number;
  try {
    descriptor = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return `${file} could not be opened without following a symlink.`;
  }
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.ino !== before.ino || stat.dev !== before.dev) return `${file} changed while it was being read.`;
    const buffer = Buffer.alloc(DRAFT_ASK_MAX_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = readSync(descriptor, buffer, length, buffer.length - length, null);
      if (read === 0) break;
      length += read;
    }
    if (length > DRAFT_ASK_MAX_BYTES) return `${file} exceeds the ${DRAFT_ASK_MAX_BYTES}-byte draft limit.`;
    const content = Buffer.from(buffer.subarray(0, length));
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(content);
    } catch {
      return `${file} is not valid UTF-8.`;
    }
    return { path: file, sha256: createHash("sha256").update(content).digest("hex"), bytes: length, content };
  } finally {
    closeSync(descriptor);
  }
}

function describeDraft(draft: CapturedDraft, origin: { worktree: string; branch: string }, projectSlug: string): DraftRecoveryEntry {
  let parsed: unknown;
  try {
    parsed = parseYaml(draft.content.toString("utf8"));
  } catch {
    parsed = null;
  }
  const record = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  const project = typeof record?.project === "string" ? record.project : null;
  const requestId = typeof record?.request_id === "string" ? record.request_id : null;
  return {
    path: draft.path,
    sha256: draft.sha256,
    bytes: draft.bytes,
    origin,
    project,
    requestId,
    relevance: project === null ? "unparseable" : project === projectSlug ? "current_action" : "other_project"
  };
}

/**
 * Content-addressed, so a restart or a concurrent Go converges on one receipt:
 * the same candidate holding the same exact bytes always yields the same id. It
 * is not keyed on the reservation id, which every resume refreshes.
 */
function draftRecoveryRequestId(identity: Omit<DraftRecoveryReceipt, "requestId" | "drafts">, drafts: CapturedDraft[]): string {
  const material = JSON.stringify({
    repository: identity.repository,
    worktree: identity.worktree,
    branch: identity.branch,
    projectSlug: identity.projectSlug,
    actionId: identity.actionId,
    baseSha: identity.baseSha,
    drafts: drafts.map((draft) => [draft.path, draft.sha256])
  });
  return `draft-recovery:${createHash("sha256").update(material).digest("hex")}`;
}

export function ensureDraftRecoveryTable(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS candidate_draft_recoveries (
    request_id TEXT NOT NULL UNIQUE,
    repository TEXT NOT NULL,
    worktree TEXT NOT NULL,
    branch TEXT NOT NULL,
    action_id TEXT NOT NULL,
    base_sha TEXT NOT NULL,
    receipt_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
}

/** Insert once; a replay must match byte for byte or it is refused. */
export function recordDraftRecoveryReceipt(db: Database.Database, receipt: DraftRecoveryReceipt, now: Date): DraftRecoveryReceipt {
  ensureDraftRecoveryTable(db);
  const json = JSON.stringify(receipt);
  const existing = db.prepare("SELECT receipt_json FROM candidate_draft_recoveries WHERE request_id = ?")
    .get(receipt.requestId) as { receipt_json: string } | undefined;
  if (existing) {
    if (existing.receipt_json !== json) {
      throw validationError("A draft recovery receipt with this id already records different content.", { receiptId: receipt.requestId });
    }
    return JSON.parse(existing.receipt_json) as DraftRecoveryReceipt;
  }
  db.prepare(`INSERT INTO candidate_draft_recoveries
    (request_id, repository, worktree, branch, action_id, base_sha, receipt_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(receipt.requestId, receipt.repository, receipt.worktree, receipt.branch, receipt.actionId, receipt.baseSha, json, now.toISOString());
  return receipt;
}

export function getDraftRecoveryReceipt(db: Database.Database, requestId: string): DraftRecoveryReceipt | null {
  ensureDraftRecoveryTable(db);
  const row = db.prepare("SELECT receipt_json FROM candidate_draft_recoveries WHERE request_id = ?")
    .get(requestId) as { receipt_json: string } | undefined;
  return row ? JSON.parse(row.receipt_json) as DraftRecoveryReceipt : null;
}

function earlierDifferingReceipt(db: Database.Database, current: DraftRecoveryReceipt): DraftRecoveryReceipt | null {
  ensureDraftRecoveryTable(db);
  const row = db.prepare(`SELECT receipt_json FROM candidate_draft_recoveries
    WHERE worktree = ? AND branch = ? AND request_id != ?
    ORDER BY created_at DESC, rowid DESC LIMIT 1`)
    .get(current.worktree, current.branch, current.requestId) as { receipt_json: string } | undefined;
  return row ? JSON.parse(row.receipt_json) as DraftRecoveryReceipt : null;
}

/** Null when the worktree still holds exactly the receipted drafts and nothing else. */
export function draftRecoveryMismatch(receipt: DraftRecoveryReceipt): string | null {
  const current = classifyCandidateDirt(receipt.worktree);
  if (current.kind !== "draft_only") return current.reason ?? "The candidate no longer holds only Agent Ask drafts.";
  const now = JSON.stringify(current.drafts.map((draft) => [draft.path, draft.sha256]));
  const then = JSON.stringify(receipt.drafts.map((draft) => [draft.path, draft.sha256]));
  if (now !== then) return "An Agent Ask draft changed, appeared or disappeared since it was receipted.";
  const head = tryGit(receipt.worktree, ["rev-parse", "HEAD"])?.trim();
  if (head !== receipt.baseSha) return "The candidate's HEAD moved since its drafts were receipted.";
  return null;
}

/** Throw the structured disposition refusal when a receipted candidate changed. */
export function assertDraftRecoveryUnchanged(receipt: DraftRecoveryReceipt): void {
  const mismatch = draftRecoveryMismatch(receipt);
  if (mismatch) {
    const refusal = unsafeRefusal(receipt, mismatch);
    throw validationError(refusal.reason, refusal.details);
  }
}

interface CandidateLookup {
  repositoryPath: string;
  projectSlug: string;
  actionId: string;
  agent: string;
  baseBranch: string;
  now: Date;
}

/**
 * Every worktree `prepareAgentWorktree` named for this exact Action and agent
 * (`<agent>/<slugified-action-id>-<timestamp>`) that is still on disk and holds
 * uncommitted changes -- the manual-handoff case no Session row can describe.
 */
function dirtyPreparedCandidates(input: Pick<CandidateLookup, "repositoryPath" | "actionId" | "agent">): Array<{ path: string; branch: string }> {
  const listing = tryGit(input.repositoryPath, ["worktree", "list", "--porcelain"]);
  if (listing === null) return [];
  const safeAction = input.actionId.replaceAll(/[^a-z0-9-]/gi, "-").toLowerCase().slice(0, 72);
  const prefix = `refs/heads/${input.agent}/${safeAction}-`;
  const found: Array<{ path: string; branch: string }> = [];
  for (const record of parseWorktrees(listing)) {
    if (!record.branch?.startsWith(prefix)) continue;
    if (lstatOrNull(record.path) === null) continue;
    if (uncommittedChanges(record.path).length === 0) continue;
    found.push({ path: record.path, branch: record.branch.replace(/^refs\/heads\//, "") });
  }
  return found;
}

function buildReceipt(input: CandidateLookup, candidate: { path: string; branch: string }, drafts: CapturedDraft[]): DraftRecoveryReceipt | null {
  const tip = tryGit(input.repositoryPath, ["rev-parse", "--verify", "--quiet", `refs/heads/${candidate.branch}^{commit}`])?.trim();
  if (!tip) return null;
  const identity = {
    repository: canonicalPath(input.repositoryPath),
    worktree: canonicalPath(candidate.path),
    branch: candidate.branch,
    projectSlug: input.projectSlug,
    actionId: input.actionId,
    baseSha: tip
  };
  const origin = { worktree: identity.worktree, branch: identity.branch };
  return {
    requestId: draftRecoveryRequestId(identity, drafts),
    ...identity,
    drafts: drafts.map((draft) => describeDraft(draft, origin, input.projectSlug))
  };
}

/**
 * Receipt the drafts of this Action's single draft-only prepared candidate, in
 * its own committed transaction, before Go or the managed tick decides anything
 * about it -- so a refusal that rolls back the dispatch transaction can never
 * take the receipt with it. Records only; never touches a file.
 */
export function receiptDraftOnlyCandidate(db: Database.Database, input: CandidateLookup): DraftRecoveryReceipt | null {
  let candidates: Array<{ path: string; branch: string }>;
  try {
    candidates = dirtyPreparedCandidates(input);
  } catch {
    // Best effort: an unreadable worktree is the authoritative evaluation's to
    // refuse, after a resumable handoff or live lease has had its say first.
    return null;
  }
  if (candidates.length !== 1) return null;
  const dirt = classifyCandidateDirt(candidates[0].path);
  if (dirt.kind !== "draft_only") return null;
  const receipt = buildReceipt(input, candidates[0], dirt.drafts);
  return receipt ? recordDraftRecoveryReceipt(db, receipt, input.now) : null;
}

/**
 * Decide, inside the caller's dispatch transaction, what to do about a dirty
 * prepared candidate for this Action that no Session row describes.
 *
 * Resume only when the candidate holds nothing but receipted drafts and every
 * piece of "never launched" evidence holds: no Session row of any status names
 * its path or branch, its branch carries no commits beyond the base, and the
 * live claim on this Action is this exact worktree and branch. A human terminal
 * still open in the worktree cannot be detected, which is why the hashes are
 * re-verified immediately before resuming (and again before any launch) and why
 * every unsafe case returns one structured disposition instead.
 */
export function evaluateDraftOnlyCandidate(db: Database.Database, input: CandidateLookup & {
  /** The receipt the pre-pass committed for this Action, when it ran. */
  expectedReceipt?: DraftRecoveryReceipt | null;
  /** Deterministic fault injection between receipt and final hash verification. */
  beforeResumeVerification?: () => void;
}): DraftCandidateDecision {
  const candidates = dirtyPreparedCandidates(input);
  if (candidates.length === 0) return { kind: "none" };
  const [candidate] = candidates;
  const ordinaryRefusal = (candidateKind: CandidateKind): DraftCandidateDecision => ({
    kind: "refuse",
    reason: ORPHAN_CANDIDATE_REASON,
    details: { worktreePath: candidate.path, branch: candidate.branch, candidateKind, remedy: ORPHAN_CANDIDATE_REMEDY }
  });
  if (candidates.length > 1) return ordinaryRefusal("unknown");
  const dirt = classifyCandidateDirt(candidate.path);
  if (dirt.kind !== "draft_only") return ordinaryRefusal(dirt.kind);
  const built = buildReceipt(input, candidate, dirt.drafts);
  if (!built) return ordinaryRefusal("unknown");

  if (input.expectedReceipt && input.expectedReceipt.requestId !== built.requestId) {
    // The drafts changed after the pre-pass receipted them. Its committed
    // receipt stands; the changed state is not safe to resume blind.
    return unsafeRefusal(input.expectedReceipt, "An Agent Ask draft changed, appeared or disappeared since it was receipted.");
  }
  // A draft that changed since an earlier Go or tick receipted this candidate
  // is the one observable sign that a terminal may still be working in it.
  const earlier = earlierDifferingReceipt(db, built);
  if (earlier) return unsafeRefusal(earlier, "An Agent Ask draft changed, appeared or disappeared since an earlier receipt of this candidate.");
  const receipt = recordDraftRecoveryReceipt(db, built, input.now);

  const blocker = neverLaunchedBlocker(db, input, receipt);
  if (blocker) return unsafeRefusal(receipt, blocker);

  input.beforeResumeVerification?.();
  const mismatch = draftRecoveryMismatch(receipt);
  if (mismatch) return unsafeRefusal(receipt, mismatch);
  return { kind: "resume", path: candidate.path, branch: candidate.branch, receipt };
}

function neverLaunchedBlocker(db: Database.Database, input: CandidateLookup, receipt: DraftRecoveryReceipt): string | null {
  const hasSessions = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'agent_sessions'").get();
  if (hasSessions) {
    const session = db.prepare("SELECT id FROM agent_sessions WHERE worktree_path = ? OR branch IN (?, ?) LIMIT 1")
      .get(receipt.worktree, receipt.branch, `refs/heads/${receipt.branch}`) as { id: string } | undefined;
    if (session) return `Session ${session.id} already references this candidate, so it was launched.`;
  }
  let commits: number;
  try {
    commits = countCommits(input.repositoryPath, input.baseBranch, receipt.branch);
  } catch {
    return "The candidate's commits relative to the base could not be counted.";
  }
  if (commits !== 0) return `The candidate branch carries ${commits} commit(s) beyond ${input.baseBranch}.`;
  let head: string;
  try {
    head = git(receipt.worktree, ["rev-parse", "HEAD"]).trim();
  } catch {
    return "The candidate's HEAD could not be read.";
  }
  if (head !== receipt.baseSha) return "The candidate's HEAD is not its branch tip.";
  const claim = getActiveActionClaim(db, input.repositoryPath, input.projectSlug, input.actionId, input.now);
  if (!claim) return "No live claim on this Action names the candidate.";
  if (canonicalPath(claim.worktree_path) !== receipt.worktree || claim.branch.replace(/^refs\/heads\//, "") !== receipt.branch) {
    return `The live claim on this Action names ${claim.worktree_path}, not this candidate.`;
  }
  return null;
}

/** The one narrow operator disposition, offered only when resuming is unsafe. */
function unsafeRefusal(receipt: DraftRecoveryReceipt, blocker: string): { kind: "refuse"; reason: string; details: Record<string, unknown> } {
  return {
    kind: "refuse",
    reason: UNSAFE_DRAFT_CANDIDATE_REASON,
    details: {
      worktreePath: receipt.worktree,
      branch: receipt.branch,
      candidateKind: "draft_only",
      disposition: {
        receiptId: receipt.requestId,
        blocker,
        drafts: receipt.drafts.map((draft) => ({ path: draft.path, sha256: draft.sha256 })),
        nextStep: `Confirm no terminal is still using ${receipt.worktree}; then settle each receipted draft from there with arcadia agent-ask settle (or keep its exact bytes elsewhere) and retire the candidate (remove its worktree and branch) before rerunning arcadia go. Arcadia has not settled, copied, moved or deleted any draft.`
      },
      remedy: ORPHAN_CANDIDATE_REMEDY
    }
  };
}
