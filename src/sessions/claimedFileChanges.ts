import { git } from "../git/worktrees.js";

/**
 * Issue #2261: a repair round's `complete` Ask said, in a criterion note, that
 * `tests/pin-ci-text-neutralization.test.ts` was "modified" and that a literal
 * in it was replaced, and it settled -- but the candidate's commit changed only
 * the Ask file. Evidence is checked for verbatim coverage and `met`, never for
 * truth. This is the host's deterministic check of one claim shape against the
 * candidate's own diff, run (like the scope check) before a drafted completion
 * settles.
 *
 * Deliberately narrow, because a false refusal is worse than a missed case:
 * only a path under `tests/` or `src/` counts, and only when a single sentence
 * of a note says that very path was replaced, changed, added, edited, created,
 * updated or modified -- the verb directly before it ("edited the test in
 * tests/x.test.ts") or directly after it ("tests/x.test.ts modified"). A path
 * that is merely mentioned, run, or named as an import is not a claim, and a
 * sentence that negates, qualifies, plans or dates the change ("not changed",
 * "will add", "added earlier") is not judged at all.
 */

const CHANGE_VERB = String.raw`(?:replaced|changed|added|edited|created|updated|modified)`;
const PATH_MENTION = /(?<![\w./-])((?:tests|src)\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*\.[A-Za-z0-9]+)(?![\w/-])/g;
// Words that may stand between the verb and the path ("added a new test file tests/x.test.ts", "updated the test in tests/x.test.ts").
const VERB_THEN_PATH = new RegExp(String.raw`\b${CHANGE_VERB}:?\s+(?:(?:the|a|an|new|existing|test|tests|file|files|source|module|only|in|to|of|into)\s+){0,6}[\x60'"(]*$`, "i");
// "tests/x.test.ts modified", "tests/x.test.ts was updated", "only tests/x.test.ts is now changed".
const PATH_THEN_VERB = new RegExp(String.raw`^[\x60'")]*\s+(?:(?:is|was|are|were|has\s+been|have\s+been|been|now|also|only|then)\s+)*${CHANGE_VERB}\b`, "i");
// Two or more paths joined by commas or "and": a claim about the first covers the list.
const PRECEDING_PATH = /(?<![\w./-])(?:tests|src)\/[A-Za-z0-9._/-]*[A-Za-z0-9_-][\x60'")]*(?:\s*,\s*(?:and\s+)?|\s+and\s+)$/;
// A sentence that negates, plans, qualifies or dates a change is not a claim that it was made now.
const NOT_A_CLAIM = /\b(?:not|never|no|nothing|none|without|unchanged|untouched|will|would|should|shall|must|might|could|can|may|needs?|to\s+be|plan(?:s|ned)?|todo|later|next|future|follow-?up|previous(?:ly)?|earlier|already|original(?:ly)?|prior|before|once|if|unless|whether|when|instead)\b|\w+n['’]t\b/i;
const MAX_LISTED = 5;

/** Repository paths under `tests/` or `src/` that the evidence notes say were changed, sorted. */
export function claimedChangedFiles(evidence: ReadonlyArray<{ note: string | null }>): string[] {
  const claimed = new Set<string>();
  for (const entry of evidence) {
    if (!entry.note) continue;
    for (const sentence of entry.note.split(/(?<=[.!?;])\s+|\n+/)) {
      if (NOT_A_CLAIM.test(sentence)) continue;
      for (const match of sentence.matchAll(PATH_MENTION)) {
        let before = sentence.slice(0, match.index);
        while (PRECEDING_PATH.test(before)) before = before.replace(PRECEDING_PATH, "");
        if (VERB_THEN_PATH.test(before) || PATH_THEN_VERB.test(sentence.slice(match.index + match[1].length))) claimed.add(match[1]);
      }
    }
  }
  return [...claimed].sort();
}

/**
 * Null when no evidence note claims a change to a `tests/` or `src/` file that
 * the candidate lacks; otherwise the refusal reason. `from` is the revision the
 * claim is measured from: the Session's base, or a review repair's start
 * revision (a repair claims what it changed, not what the failed candidate
 * already had). The reason names only files and the fixed remedy -- never the
 * agent's own note text or a revision -- so a repeat is an identical refusal
 * for the identical-refusal hold.
 */
export function claimedFileChangeRefusal(repoRoot: string, from: string, revision: string, evidence: ReadonlyArray<{ note: string | null }>, fromLabel: string): string | null {
  const claimed = claimedChangedFiles(evidence);
  if (claimed.length === 0) return null;
  let changed: Set<string>;
  try {
    changed = new Set(git(repoRoot, ["-c", "core.quotepath=false", "diff", "-z", "--no-renames", "--name-only", `${from}...${revision}`]).split("\0").filter(Boolean));
  } catch {
    return `Claimed-change check refused the completion: the candidate's diff against ${fromLabel} could not be read, so the evidence note's claim that ${claimed.slice(0, MAX_LISTED).join(", ")} changed could not be checked.`;
  }
  const missing = claimed.filter((file) => !changed.has(file));
  if (missing.length === 0) return null;
  const listed = missing.slice(0, MAX_LISTED).join(", ");
  const more = missing.length > MAX_LISTED ? ` (and ${missing.length - MAX_LISTED} more)` : "";
  return `Claimed-change check refused the completion: an evidence note says ${listed}${more} was changed, but the candidate does not change ${missing.length > 1 ? "them" : "it"} since ${fromLabel}. Make and commit that change, or correct the note to say what was actually done; a draft cannot be accepted on a change the diff does not contain.`;
}
