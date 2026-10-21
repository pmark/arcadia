/**
 * The lettered answer menu of a Decision (A, B, C...), and whether it can be answered at all.
 *
 * One definition serves every surface (dashboard /review, Discord, `arcadia review answer`): the operator chooses a
 * letter and never types a Decision's wording. The letters come from the Decision document's own options, in order;
 * a Decision with none gets the standard Approve / Reject / Defer menu.
 *
 * A Decision is answerable only when its document is on the Project's checkout, because the answer is written to and
 * committed in that document. A settlement run from a candidate worktree opens its Decisions before the candidate
 * is merged; until it is, the menu says so (`blocked`) and names the remedy instead of offering an answer that would
 * fail. It needs no sync: the check reads the checkout each time, so the Decision becomes answerable by itself as
 * soon as the document is on the main branch.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { findDecisionFile, resolveProjectRepoFromDb } from "../commands/decision.js";
import { parseDoc } from "../docs/parse.js";
import type { ReviewItemSummary } from "../domain/types.js";
import { tryGit } from "../git/worktrees.js";

export interface AnswerOption {
  letter: string;
  label: string;
  consequence: string | null;
  recommended: boolean;
}

export interface AnswerBlocked {
  reason: "decision_document_not_on_base";
  /** Operator-facing: what is wrong and the one thing to do. Never a path on disk. */
  message: string;
  branch: string | null;
  /** The pull requests of the candidate branch that carries the document, when it is known. */
  pullRequestsUrl: string | null;
}

export interface ReviewAnswerMenu {
  /** `decision_options`: the document's own options. `standard`: the document offers none, so Approve / Reject / Defer. */
  source: "decision_options" | "standard";
  answerable: boolean;
  options: AnswerOption[];
  blocked: AnswerBlocked | null;
}

const STANDARD: Array<{ label: string; consequence: string }> = [
  { label: "Approve", consequence: "Records the Decision as approved." },
  { label: "Reject", consequence: "Closes the Decision without approving it." },
  { label: "Defer", consequence: "Keeps the Decision open for later." }
];

export function letterFor(index: number): string {
  return String.fromCharCode("A".charCodeAt(0) + index);
}

export function optionForLetter(menu: ReviewAnswerMenu, letter: string): AnswerOption | null {
  const wanted = letter.trim().toUpperCase();
  return menu.options.find((option) => option.letter === wanted) ?? null;
}

/** `decision/<slug>` -> slug; null for any other doc_ref. */
export function decisionSlugOfDocRef(docRef: string | null | undefined): string | null {
  const match = /^decision\/(.+)$/.exec(docRef?.trim() ?? "");
  return match ? match[1].trim() || null : null;
}

/**
 * The menu for a review item raised from a Decision document, or null for any other review item (which keeps its own
 * controls). Reads the Project's checkout; writes nothing.
 */
export function buildAnswerMenu(db: Database.Database, item: ReviewItemSummary): ReviewAnswerMenu | null {
  const slug = decisionSlugOfDocRef(item.doc_ref);
  if (!slug || !item.project_id) return null;

  let repoRoot: string | null;
  try {
    repoRoot = resolveProjectRepoFromDb(db, item.project_id);
  } catch {
    repoRoot = null;
  }
  const absolutePath = repoRoot ? findDecisionFile(path.join(repoRoot, "docs", "decisions"), slug) : null;
  if (!repoRoot || !absolutePath || !existsSync(absolutePath) || !committedOnBase(repoRoot, path.relative(repoRoot, absolutePath))) {
    return { source: "standard", answerable: false, options: [], blocked: blockedFor(item, repoRoot) };
  }

  const relativePath = path.relative(repoRoot, absolutePath);
  const { doc } = parseDoc(relativePath, absolutePath, readFileSync(absolutePath, "utf8"));
  const options = doc && doc.type === "decision" ? doc.options : [];
  if (options.length > 0) {
    return {
      source: "decision_options",
      answerable: true,
      options: options.map((option, index) => ({
        letter: letterFor(index),
        label: option.label,
        consequence: option.consequence || null,
        recommended: option.recommended
      })),
      blocked: null
    };
  }
  return {
    source: "standard",
    answerable: true,
    options: STANDARD.map((option, index) => ({ letter: letterFor(index), label: option.label, consequence: option.consequence, recommended: false })),
    blocked: null
  };
}

/** True when the document is committed on the Project's base branch, not merely present in the working tree. */
function committedOnBase(repoRoot: string, relativePath: string): boolean {
  const head = tryGit(repoRoot, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  const base = head ? head.replace(/^origin\//, "") : "main";
  return tryGit(repoRoot, ["cat-file", "-e", `${base}:${relativePath}`]) !== null;
}

function blockedFor(item: ReviewItemSummary, repoRoot: string | null): AnswerBlocked {
  const candidate = candidateOf(item);
  const url = candidate.branch && repoRoot ? pullRequestsUrlFor(repoRoot, candidate.branch) : null;
  // A settlement commit that was never pushed has no pull request to merge: say that, not "merge the PR".
  const published = candidate.branch && repoRoot
    ? tryGit(repoRoot, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${candidate.branch}`]) !== null
    : false;
  const where = candidate.branch ? `the pull request for branch ${candidate.branch}` : "the pull request that adds it";
  const message = candidate.branch && !published
    ? `Not answerable yet: the settlement commit that adds this Decision is not published (branch ${candidate.branch} is not on the remote). ` +
      "It becomes answerable by itself once the commit is pushed, its pull request is merged and the document is on the main branch."
    : `Not answerable yet: this Decision's document is not on the main branch. Merge ${where}${url ? ` (${url})` : ""}; ` +
      "it becomes answerable by itself once it is merged.";
  return { reason: "decision_document_not_on_base", message, branch: candidate.branch, pullRequestsUrl: url };
}

/** The candidate branch a settlement recorded on the item (`docs sync` from a worktree), when there was one. */
function candidateOf(item: ReviewItemSummary): { branch: string | null } {
  try {
    const context = JSON.parse(item.context_json ?? "{}") as { candidateBranch?: unknown };
    return { branch: typeof context.candidateBranch === "string" && context.candidateBranch ? context.candidateBranch : null };
  } catch {
    return { branch: null };
  }
}

function pullRequestsUrlFor(repoRoot: string, branch: string): string | null {
  const remote = tryGit(repoRoot, ["remote", "get-url", "origin"]);
  const match = remote ? /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(remote) : null;
  return match ? `https://github.com/${match[1]}/${match[2]}/pulls?q=${encodeURIComponent(`is:pr head:${branch}`)}` : null;
}

/** The open review item of the Decision with this number (`0132`), when exactly one Project's document carries it. */
export function reviewItemIdForDecisionNumber(db: Database.Database, number: string): string[] {
  const rows = db
    .prepare("SELECT id FROM review_items WHERE doc_ref LIKE 'decision/%' AND source_input LIKE ? AND status IN ('open','deferred')")
    .all(`%docs/decisions/${number.padStart(4, "0")}-%`) as Array<{ id: string }>;
  return rows.map((row) => row.id);
}
