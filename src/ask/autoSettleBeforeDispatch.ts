import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { normalizeError } from "../cli/errors.js";
import { git, tryGit } from "../git/worktrees.js";
import { evidenceHasPlaceholder, normalizeAgentAsk, setTopLevelAskScalar, type NormalizedAgentAsk } from "./agentAsk.js";
import { previewAgentAskRequest } from "./preview.js";
import { settleAgentAsk } from "./settlement.js";

/** Matches `AGENT_ASK_ASKS_DIR` in `ask/discovery.ts`, duplicated as a literal
 * for the same reason that module documents: this is a plain filesystem scan
 * with no Git dependency of its own. */
const AGENT_ASK_ASKS_DIR = ".arcadia/asks";

export interface AutoSettlePendingCompletionInput {
  repoRoot: string;
  projectSlug: string;
  activePlanSlug: string;
  action: { id: string; acceptanceCriteria: string[] };
  /**
   * The revision whose tree is exactly what a Session left at exit, when the
   * host preserved that tree into a commit on the Session's behalf (session
   * reconciliation). A sandboxed Session cannot commit, so it drafts its
   * evidence against the working tree it is leaving; commits up to this
   * revision are that Session's own evidenced work. Only commits after it must
   * be governance-only. Omitted everywhere else, where the draft's own
   * `candidate_revision` is the only evidenced tree.
   */
  evidencedRevision?: string | null;
}

export interface AutoSettlePendingCompletionResult {
  settled: boolean;
  /** Machine-checkable reason code; see the constants this module exports. */
  reason: string;
  askPath?: string;
  receiptId?: string;
  nextActionKey?: string | null;
}

export const AUTO_SETTLE_NO_DRAFT = "no_drafted_complete_ask_for_current_pointer";
export const AUTO_SETTLE_EVIDENCE_INCOMPLETE = "evidence_does_not_verbatim_cover_declared_criteria";
export const AUTO_SETTLE_STALE_REVISION = "candidate_revision_is_stale_and_not_an_ancestor_of_head";
export const AUTO_SETTLE_REVISION_CHANGED = "candidate_revision_is_stale_and_later_commits_changed_more_than_governance_records";
export const AUTO_SETTLE_SETTLED = "settled_from_drafted_complete_ask";

/**
 * Paths a later commit may touch without invalidating completion evidence
 * recorded at an earlier revision: the governance records settlement itself
 * and other Asks write. A commit touching anything else may have changed what
 * the evidence validated, so it is never refreshed past (Issue #639).
 */
const GOVERNANCE_RECORD_PATHS = [/^\.arcadia\//, /^PROJECT\.md$/, /^MISSION_LOG\.md$/, /^docs\/plans\//, /^docs\/decisions\//];

interface DraftedCompleteAsk {
  path: string;
  content: string;
  normalized: NormalizedAgentAsk;
}

/**
 * Every `.arcadia/asks/` draft targeting this Action, in filename order --
 * not just the first one found. More than one can legitimately exist (a
 * stale draft left behind by an earlier, abandoned attempt alongside a
 * later, correct one), and the first match is not necessarily the one whose
 * evidence and revision are actually eligible to settle.
 */
function findMatchingCompleteAskDrafts(
  repoRoot: string,
  projectSlug: string,
  activePlanSlug: string,
  actionId: string
): DraftedCompleteAsk[] {
  const dir = path.join(repoRoot, AGENT_ASK_ASKS_DIR);
  if (!existsSync(dir)) return [];
  const targetRefs = new Set([`action/${actionId}`, `plan/${activePlanSlug}#${actionId}`]);
  const files = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => path.join(dir, entry.name))
    .sort();
  const matches: DraftedCompleteAsk[] = [];
  for (const filePath of files) {
    let content: string;
    let normalized: NormalizedAgentAsk;
    try {
      content = readFileSync(filePath, "utf8");
      normalized = normalizeAgentAsk({ request: content });
    } catch {
      // A malformed or unrelated draft never blocks or crashes ordinary
      // dispatch; it simply is not a match.
      continue;
    }
    if (normalized.intent !== "complete") continue;
    if (!normalized.targetRef || !targetRefs.has(normalized.targetRef)) continue;
    if (normalized.project !== "unknown" && normalized.project !== projectSlug) continue;
    matches.push({ path: filePath, content, normalized });
  }
  return matches;
}

export function evidenceCoversCriteriaVerbatim(evidence: NormalizedAgentAsk["evidence"], declared: string[]): boolean {
  if (declared.length === 0 || evidence.length !== declared.length) return false;
  if (evidenceHasPlaceholder(evidence)) return false;
  return evidence.every((entry, index) => entry.criterion === declared[index] && entry.status === "met");
}

/** Rewrites only the top-level `candidate_revision:` scalar; every other line
 * (including the evidence block, which may itself mention a revision in free
 * text) is left untouched. */
function refreshCandidateRevision(content: string, head: string): string {
  return setTopLevelAskScalar(content, "candidate_revision", head);
}

/** Rewrites only the top-level `request_id:` scalar. A strict-format Agent
 * Ask's request id comes from this field, not from any id a caller passes to
 * `normalizeAgentAsk` -- so replaying the original draft's own request id
 * here would look up (and be refused by) whatever proposal that id was
 * already recorded under, rather than this auto-settle attempt's own. */
function withRequestId(content: string, requestId: string): string {
  return setTopLevelAskScalar(content, "request_id", requestId);
}

/**
 * Before dispatching a coding-agent Session for an Action, check whether the
 * current pointer already has a drafted `complete` Agent Ask sitting in
 * `.arcadia/asks/` whose evidence verbatim-covers every declared acceptance
 * criterion — the ordinary shape of a session that did the work, drafted its
 * completion, and ended (or was interrupted) before settling it. When one
 * exists, settle it deterministically here (no coding-agent process, no LLM
 * call) instead of launching a redundant Session for work that is already
 * done.
 *
 * `candidate_revision` in that draft is very often stale by the time this
 * runs, because later commits landed on the branch afterward. That is
 * refreshed to the repository's current HEAD only when HEAD is a strict
 * descendant of the draft's revision *and* every commit since touched only
 * governance records (another settlement, a Log entry, a Plan or Decision
 * edit) — so the evidence, which must still verbatim-cover every declared
 * criterion, describes exactly the code at HEAD. A later code change (even a
 * CodeRabbit-loop fix) falls through to an ordinary dispatch that re-validates
 * the work (Issue #639). Any
 * other reason preview or settlement is not clean (a conflict, an unresolved
 * required review Decision, a genuinely divergent revision, evidence that
 * does not match) falls through untouched, exactly as `settleAgentAsk` would
 * refuse it for a human running the same two commands by hand — this
 * composes those existing routines rather than reimplementing their checks,
 * so it cannot drift from the canonical writer.
 */
export function attemptAutoSettlePendingCompletion(
  db: Database.Database,
  input: AutoSettlePendingCompletionInput
): AutoSettlePendingCompletionResult {
  const candidates = findMatchingCompleteAskDrafts(input.repoRoot, input.projectSlug, input.activePlanSlug, input.action.id);
  if (candidates.length === 0) return { settled: false, reason: AUTO_SETTLE_NO_DRAFT };

  // Try every matching draft in order rather than stopping at the first: an
  // earlier, abandoned attempt can leave a draft with incomplete evidence or
  // a genuinely divergent revision sitting alongside a later, correct one.
  // Only report the first candidate's ineligibility if none of them settle.
  let lastResult: AutoSettlePendingCompletionResult = { settled: false, reason: AUTO_SETTLE_NO_DRAFT };
  for (const draft of candidates) {
    const attempt = attemptSettleOneDraft(db, input, draft);
    if (attempt.settled) return attempt;
    lastResult = attempt;
  }
  return lastResult;
}

function attemptSettleOneDraft(
  db: Database.Database,
  input: AutoSettlePendingCompletionInput,
  draft: DraftedCompleteAsk
): AutoSettlePendingCompletionResult {
  if (!evidenceCoversCriteriaVerbatim(draft.normalized.evidence, input.action.acceptanceCriteria)) {
    return { settled: false, reason: AUTO_SETTLE_EVIDENCE_INCOMPLETE, askPath: draft.path };
  }

  let head: string;
  try {
    head = git(input.repoRoot, ["rev-parse", "HEAD"]).trim();
  } catch (error) {
    return { settled: false, reason: normalizeError(error).message, askPath: draft.path };
  }

  const candidateRevision = draft.normalized.candidateRevision;
  let effectiveContent = draft.content;
  if (candidateRevision && head !== candidateRevision && !head.startsWith(candidateRevision)) {
    const isAncestor = tryGit(input.repoRoot, ["merge-base", "--is-ancestor", candidateRevision, "HEAD"]) !== null;
    if (!isAncestor) {
      return { settled: false, reason: AUTO_SETTLE_STALE_REVISION, askPath: draft.path };
    }
    // Ancestry alone proves only that the evidenced commit is still reachable,
    // not that the commits since left what it validated alone. Refresh only
    // when every file those commits changed is a governance record, so the
    // code the evidence covers is byte-identical at HEAD and the evidence --
    // already checked above to verbatim-cover every criterion the Action
    // declares at HEAD -- still describes it. Anything else falls through to an
    // ordinary dispatch that re-validates the work.
    const evidencedFrom = input.evidencedRevision &&
      tryGit(input.repoRoot, ["merge-base", "--is-ancestor", candidateRevision, input.evidencedRevision]) !== null &&
      tryGit(input.repoRoot, ["merge-base", "--is-ancestor", input.evidencedRevision, "HEAD"]) !== null
      ? input.evidencedRevision
      : candidateRevision;
    const changed = tryGit(input.repoRoot, ["diff", "--name-only", `${evidencedFrom}..HEAD`]);
    const onlyGovernance = changed !== null && changed.split("\n").map((line) => line.trim()).filter(Boolean)
      .every((changedPath) => GOVERNANCE_RECORD_PATHS.some((pattern) => pattern.test(changedPath)));
    if (!onlyGovernance) {
      return { settled: false, reason: AUTO_SETTLE_REVISION_CHANGED, askPath: draft.path };
    }
    effectiveContent = refreshCandidateRevision(draft.content, head);
  }

  // Content-addressed and distinct from the draft's own request_id: replaying
  // the original id would look up (and be refused by) whatever proposal it
  // was already recorded under -- this auto-settle attempt needs its own.
  const contentHash = createHash("sha256").update(effectiveContent).digest("hex").slice(0, 12);
  const requestId = `auto-settle-${input.projectSlug}-${input.action.id}-${contentHash}`.slice(0, 120);
  effectiveContent = withRequestId(effectiveContent, requestId);

  const settlementRequestId = `settle-${requestId}`.slice(0, 120);
  try {
    previewAgentAskRequest(db, { request: effectiveContent, requestId, sourcePath: draft.path });
    // Two-phase, exactly like a human's `preview` then `settle --apply`: the
    // settlement's own preview fingerprint (over the actual file mutations it
    // is about to make) is distinct from the Ask proposal's fingerprint above,
    // and `apply` refuses unless it is given back verbatim.
    const settlementPreview = settleAgentAsk(db, {
      proposalRef: requestId,
      settlementRequestId,
      disposition: "accepted",
      cwd: input.repoRoot
    });
    const settlement = settleAgentAsk(db, {
      proposalRef: requestId,
      settlementRequestId,
      disposition: "accepted",
      previewFingerprint: settlementPreview.previewFingerprint,
      apply: true,
      // Bind and archive against the exact checkout the caller resolved
      // dispatch from -- never `process.cwd()`, which for a host worker or a
      // managed-production tick is the Arcadia runtime, not the Project.
      cwd: input.repoRoot
    });
    return {
      settled: true,
      reason: AUTO_SETTLE_SETTLED,
      askPath: draft.path,
      receiptId: settlement.id,
      nextActionKey: settlement.nextActionKey ?? null
    };
  } catch (error) {
    return { settled: false, reason: normalizeError(error).message, askPath: draft.path };
  }
}
