/**
 * Issue #2890: a drafted completion Ask marked a criterion `met` while that
 * criterion's own evidence note said the work was NOT done, not run, or
 * deferred; it auto-settled, independent review failed it at the settlement
 * commit, and the lane idled. Evidence is checked for verbatim coverage and
 * `met`, never for truth. This is the host's deterministic check of one
 * self-contradiction, run (like the scope and claimed-change checks) before a
 * drafted completion settles.
 *
 * Deliberately narrow, because a false refusal is worse than a missed case:
 * only the `note` of an evidence entry whose status is `met` is judged (a
 * `failed` or `skipped` entry that says "not done" is already honest), one
 * sentence at a time, and only for an explicit statement that the criterion's
 * own work is not done: "not done|run|executed|verified|completed",
 * "not yet done|run|merged|closed", "deferred to|until|pending|for|post ...",
 * "pending the merge|PR|review", and "will be done|run|closed|merged
 * after|once|when|upon ...". An all-caps "NOT" is an emphatic admission and is
 * always judged. A match inside a sentence that is about another state of the
 * code or a hypothetical (before, previously, old, baseline, unfixed, original, would,
 * could, if, unless, whether, because, "so that", should, must, "without the
 * fix") is not judged: "the old behavior was not run" is a comparison, not an
 * admission.
 * Known limitation: a sentence that legitimately says some unrelated step was
 * "not run" with none of those words (e.g. "pnpm build not run, unaffected")
 * is still refused, and a contradiction phrased in words outside the list
 * above is missed; the Session restates the note or marks the criterion
 * honestly.
 */

export interface ContradictedCriterion {
  criterion: string;
  /** The text that contradicts `met`. */
  phrase: string;
}

type EvidenceEntry = { criterion: string; status: string; note: string | null };

// Global so every match in a sentence is judged, not only the first. `negatable` patterns state a deferral
// or a pending step, which "no work is deferred until the PR merges" denies.
const CONTRADICTIONS: ReadonlyArray<{ pattern: RegExp; negatable: boolean }> = [
  { pattern: /\bnot\s+(?:done|run|executed|verified|completed)\b/gi, negatable: false },
  { pattern: /\bnot\s+yet\s+(?:done|run|merged|closed)\b/gi, negatable: false },
  { pattern: /\bdeferred\s+(?:to|until|till|pending|for|post)\b[^.;\n]*/gi, negatable: true },
  { pattern: /\bpending\s+(?:the\s+)?(?:(?:PR|pull\s+request)\b|merge[ds]?\b|review\b)[^.;\n]*/gi, negatable: true },
  // Issue #2905: a test the Session could not run (sandbox refusal) is not a pass.
  { pattern: /\bunrun\b/gi, negatable: true },
  { pattern: /\bunable\s+to\s+(?:run|execute|verify)\b/gi, negatable: true },
  // Only a command, permission or sandbox refusal; "asserts the merge was refused: 4 passed" is an honest test description.
  { pattern: /\b(?:command|pnpm|vitest|tsc|permission|sandbox)\b(?:\s+(?:exec|run|command|check|invocation))*\s+(?:was|were)\s+(?:refused|denied)\b[^.;\n]*/gi, negatable: true },
  { pattern: /\b(?:refused|denied|blocked)\s+by\s+(?:the\s+)?(?:sandbox|permission)[^.;\n]*/gi, negatable: true },
  { pattern: /\bwill\s+(?:be\s+)?(?:done|run|closed|merged|verified)\s+(?:after|once|when|upon)\b[^.;\n]*/gi, negatable: true }
];

// A sentence about another state of the code or a hypothetical is not an admission about this criterion.
const OTHER_CONTEXT = /\b(?:before|previous(?:ly)?|prior|old|baseline|unfixed|pre-fix|original(?:ly)?|would|could|if|unless|whether|because|so\s+that|should|must|without\s+the\s+(?:fix|change))\b/i;
// A negation earlier in the clause ("no work is deferred", "isn't deferred", "none deferred").
const NEGATED_BEFORE = /(?:\b(?:no|not|nothing|never|none)\b|\w+n['\u2019]t\b)[^.;\n]*$/i;

/** The criteria marked met whose own note says the work was not done, with the phrase that says so. */
export function contradictedMetCriteria(evidence: ReadonlyArray<EvidenceEntry>): ContradictedCriterion[] {
  const found: ContradictedCriterion[] = [];
  for (const entry of evidence) {
    if (entry.status !== "met" || !entry.note) continue;
    for (const sentence of entry.note.split(/(?<=[.!?;])\s+|\n+/)) {
      const phrase = firstContradiction(sentence);
      if (phrase) { found.push({ criterion: entry.criterion, phrase }); break; }
    }
  }
  return found;
}

function firstContradiction(sentence: string): string | null {
  const otherContext = OTHER_CONTEXT.test(sentence);
  for (const { pattern, negatable } of CONTRADICTIONS) {
    for (const match of sentence.matchAll(pattern)) {
      // An all-caps NOT is an emphatic admission, always judged.
      const emphatic = /^NOT\b/.test(match[0]);
      if (!emphatic && otherContext) continue;
      if (negatable && NEGATED_BEFORE.test(sentence.slice(0, match.index))) continue;
      return match[0].trim().slice(0, 80);
    }
  }
  return null;
}

const MAX_CRITERION_CHARS = 160;
const MAX_LISTED = 5;

/** Null when no `met` criterion's own note contradicts it; otherwise the refusal reason. */
export function contradictedCriteriaRefusal(evidence: ReadonlyArray<EvidenceEntry>): string | null {
  const contradicted = contradictedMetCriteria(evidence);
  if (contradicted.length === 0) return null;
  const described = contradicted.slice(0, MAX_LISTED).map(({ criterion, phrase }) => {
    const shown = criterion.length > MAX_CRITERION_CHARS ? `${criterion.slice(0, MAX_CRITERION_CHARS - 1)}…` : criterion;
    return `"${shown}" is marked met but its own note says "${phrase}"`;
  });
  const more = contradicted.length > MAX_LISTED ? ` (and ${contradicted.length - MAX_LISTED} more)` : "";
  return `Contradicted-criterion check refused the completion: ${described.join("; ")}${more}. Do the work and say so in the note, or mark the criterion skipped or failed; a completion cannot mark met what its own evidence says is not done. If the check is one the host runs for you (pnpm pre-pr, lint, tsc, build, or a test you added or changed), delete the words "not run" from the note and write exactly the words the brief gives for checks the host runs.`;
}

// ---------------------------------------------------------------------------------------------------------
/**
 * PRs #2948 and #2950: a worker's completion Ask marked every criterion `met` and the settlement marked the Action
 * `done` and moved the pointer, although nothing called the new module (#2948) or nothing scheduled the new script
 * (#2950). The #2950 note even said "Not done here: scheduling the script on the host timer ..." and the #2948 notes
 * said only "I inspected the code". `contradictedCriteria` missed the first because the sentence also said "must"
 * and the second because it states no contradiction at all.
 *
 * This is the host's deterministic tightening of what a `met` note must be, run (with the contradicted-criterion
 * check) before a drafted completion auto-settles. It only adds refusals; it never accepts what another check
 * refuses. Two checks, no model call:
 *
 * 1. A `met` note that says its own deliverable is incomplete ("Not done here", "nothing schedules", "not wired",
 *    "no caller" and close variants) is refused, with the exact phrase and the criterion.
 * 2. A `met` note that describes itself as inspection (inspected, read the code, reviewed the diff) and names no
 *    concrete proof is refused (except a note that only defers a lint, tsc, build or pre-pr check to the host with the
 *    brief's own words and claims no test). A proof is one of: a test file plus the quoted title of a test in it (the title must
 *    appear in the file when the file can be read), a command result such as `3 passed`, a receipt id, a commit id or
 *    a pull request number. This reuses the wording of the Plan Action `require-proof-for-every-met-criterion`
 *    ("a test name and file, a receipt path or a commit").
 *
 * Deliberately narrow, because a false refusal stalls a lane (the same trade as `contradictedCriteria`): a note that
 * is empty or that is not inspection prose and names no proof (for example "Verified in the candidate worktree.") is
 * NOT judged and still settles as it does today, because many callers and fixtures settle with such notes and the
 * check cannot tell a true one from a false one. "Follow-up" is deliberately NOT a marker: it is an ordinary Issue or PR
 * cross-reference ("Follow-up Issue #2999 tracks the unrelated docs cleanup", or adjacent work a criterion expressly
 * leaves out), and refusing it would have rejected real merged completions; #2950 is caught by "Not done here". Known limits: a module with no caller whose note says nothing about
 * it is not detected (that needs the Action's separate importer check), and a marker phrased outside the list below
 * is missed.
 */

export interface MetCriterionProblem {
  criterion: string;
  kind: "incomplete" | "unproved";
  /** The not-done phrase (`incomplete`) or the inspection phrase (`unproved`). */
  phrase: string;
}

export interface MetCriteriaProofOptions {
  /**
   * The text of a repository-relative file at the revision being settled, or null when it does not exist there.
   * Omitted (or throwing) means the check cannot read files: a named test is then judged by its shape only.
   */
  readFileAtRevision?: (repoRelativePath: string) => string | null;
}

// "Not done here" is an explicit statement about this very criterion: always judged.
const EMPHATIC_NOT_DONE = /\bnot\s+done\s+here\b/gi;
// Other markers: judged unless the sentence compares with another state of the code or describes what a check does.
const NOT_DONE_MARKERS: ReadonlyArray<RegExp> = [
  /\bnothing\s+(?:schedules|calls|invokes|imports|uses|runs|wires|references)\b/gi,
  /\bno\s+(?:callers?|importers?|call\s+sites?)\b/gi,
  /\bnot\s+(?:yet\s+)?(?:wired|hooked\s+up|plugged\s+in|integrated|scheduled)\b/gi,
  /\bunwired\b/gi,
  /\bnot\s+(?:yet\s+)?(?:called|invoked|imported)\s+(?:by|from|anywhere|in)\b/gi
];
const COMPARISON_OR_DESCRIPTION = /\b(?:before|previous(?:ly)?|prior|old|baseline|unfixed|pre-fix|original(?:ly)?|would|could|if|unless|whether|remain(?:s|ed)?|other\s+than|anymore|longer|fail(?:s|ed|ing)?|refus(?:es|ed|ing)|reject(?:s|ed)|flag(?:s|ged)?|detect(?:s|ed)|assert(?:s|ed)?|report(?:s|ed)|throws?)\b/i;
// "no caller is needed", "without a caller", "nothing ... no callers" are denials.
const NEGATED_BEFORE_MARKER = /(?:\b(?:no|not|nothing|never|none|without)\b|\w+n['’]t\b)[^.;\n]*$/i;

const INSPECTION = /\b(?:inspect(?:ed|ion)|by\s+reading|read\s+(?:through\s+)?(?:the\s+)?(?:code|diff|source)|reviewed\s+(?:the\s+)?(?:code|diff|source)|looked\s+at|examined|eyeballed)\b/i;

const TEST_FILE = /(?<![\w./-])((?:[\w-]+\/)*[\w.-]+\.(?:test|spec)\.[cm]?[jt]sx?)\b/g;
const QUOTED = /"([^"\n]{6,})"|'([^'\n]{6,})'|`([^`\n]{6,})`|“([^”\n]{6,})”/g;
const COMMAND_RESULT = /\b\d+\s+(?:tests?\s+)?(?:passed|passing)\b|\bexit(?:ed)?\s+(?:code\s+)?0\b/i;
const RECEIPT_ID = /\b[a-z]{3,}_[0-9a-f]{12,}\b/;
const PULL_REQUEST = /\b(?:PR|pull\s+request)\s*#?\d+\b|\/pull\/\d+\b/i;
const COMMIT_ID = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/;

const NOTE_SENTENCES = /(?<=[.!?;])\s+|\n+/;

/** What a `met` note must name instead of inspection prose; shown verbatim in the refusal. */
export const MET_PROOF_REQUIRED = "name one concrete proof in the note: a test file plus the quoted title of the test in it that proves this criterion, a command you ran with its result (for example `3 passed`), a receipt id, a commit id, or a pull request number";

/** Every `met` criterion whose own note says it is incomplete, or is inspection prose with no proof. */
export function metCriteriaProblems(evidence: ReadonlyArray<EvidenceEntry>, options: MetCriteriaProofOptions = {}): MetCriterionProblem[] {
  const found: MetCriterionProblem[] = [];
  for (const entry of evidence) {
    if (entry.status !== "met" || !entry.note?.trim()) continue;
    const incomplete = firstIncompleteMarker(entry.note);
    if (incomplete) { found.push({ criterion: entry.criterion, kind: "incomplete", phrase: incomplete }); continue; }
    const inspection = INSPECTION.exec(entry.note);
    if (inspection && !namesConcreteProof(entry.note, options) && !isHostRunCheckNote(entry.note)) {
      found.push({ criterion: entry.criterion, kind: "unproved", phrase: inspection[0] });
    }
  }
  return found;
}

function firstIncompleteMarker(note: string): string | null {
  for (const sentence of note.split(NOTE_SENTENCES)) {
    EMPHATIC_NOT_DONE.lastIndex = 0;
    const emphatic = EMPHATIC_NOT_DONE.exec(sentence);
    if (emphatic) return emphatic[0];
    if (COMPARISON_OR_DESCRIPTION.test(sentence)) continue;
    for (const pattern of NOT_DONE_MARKERS) {
      for (const match of sentence.matchAll(pattern)) {
        if (NEGATED_BEFORE_MARKER.test(sentence.slice(0, match.index))) continue;
        return match[0].trim();
      }
    }
  }
  return null;
}

/**
 * The words the Action brief gives for a check only the host or CI runs (`pnpm pre-pr`, lint, tsc, build): "the host
 * runs this check, not this Session: ...". Such a note is not inspection-only prose, because no Session can name a
 * proof for it, and it still settles as today, unless it also claims a test: a test claim must name its proof, since
 * the host runs only the tests it is told about.
 */
const HOST_RUNS_CHECK = /the host runs this check, not this Session:[^.]*\.?/i;
const CLAIMS_A_TEST = /\btests?\b|\.(?:test|spec)\.[cm]?[jt]sx?\b/i;

function isHostRunCheckNote(note: string): boolean {
  return HOST_RUNS_CHECK.test(note) && !CLAIMS_A_TEST.test(note.replace(HOST_RUNS_CHECK, " "));
}

function namesConcreteProof(note: string, options: MetCriteriaProofOptions): boolean {
  if (COMMAND_RESULT.test(note) || RECEIPT_ID.test(note) || PULL_REQUEST.test(note) || COMMIT_ID.test(note)) return true;
  const titles = [...note.matchAll(QUOTED)].map((match) => (match[1] ?? match[2] ?? match[3] ?? match[4] ?? "").trim()).filter(Boolean);
  if (titles.length === 0) return false;
  for (const match of note.matchAll(TEST_FILE)) {
    const file = match[1];
    if (!file || file.startsWith("/") || file.split("/").includes("..")) continue;
    if (!options.readFileAtRevision) return true;
    let text: string | null;
    try { text = options.readFileAtRevision(file); } catch { return true; }
    if (text === null) continue;
    const haystack = normalize(text);
    if (titles.some((title) => haystack.includes(normalize(title)))) return true;
  }
  return false;
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").toLowerCase();
}

/** Null when no `met` criterion is self-declared incomplete or unproved; otherwise the refusal reason. */
export function metCriteriaProofRefusal(evidence: ReadonlyArray<EvidenceEntry>, options: MetCriteriaProofOptions = {}): string | null {
  const problems = metCriteriaProblems(evidence, options);
  if (problems.length === 0) return null;
  const described = problems.slice(0, MAX_LISTED).map(({ criterion, kind, phrase }) => {
    const shown = criterion.length > MAX_CRITERION_CHARS ? `${criterion.slice(0, MAX_CRITERION_CHARS - 1)}…` : criterion;
    return kind === "incomplete"
      ? `"${shown}" is marked met but its own note says "${phrase}"`
      : `"${shown}" is marked met on inspection ("${phrase}") but its note names no proof`;
  });
  const more = problems.length > MAX_LISTED ? ` (and ${problems.length - MAX_LISTED} more)` : "";
  const supply = [
    problems.some((problem) => problem.kind === "incomplete")
      ? "For a criterion whose own note says part of it is not done, or not wired: do that work and say so, or mark the criterion skipped or failed; a completion cannot mark met what its own note says is incomplete. A deliverable that nothing calls or schedules is not met."
      : null,
    problems.some((problem) => problem.kind === "unproved")
      ? `For a criterion marked met on inspection: ${MET_PROOF_REQUIRED}. A test file you added is a proof only with a quoted title that appears in it. A check only the host or CI runs (pnpm pre-pr, lint, tsc, build) may instead use the words the brief gives for checks the host runs, in a note that cites no test.`
      : null
  ].filter(Boolean).join(" ");
  return `Met-criterion proof check refused the completion: ${described.join("; ")}${more}. ${supply}`;
}
