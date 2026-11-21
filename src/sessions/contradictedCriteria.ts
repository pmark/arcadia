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
  { pattern: /\bunrun\b/gi, negatable: false },
  { pattern: /\bunable\s+to\s+(?:run|execute|verify)\b/gi, negatable: true },
  { pattern: /\b(?:was|were)\s+(?:refused|denied)\b[^.;\n]*/gi, negatable: true },
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
  return `Contradicted-criterion check refused the completion: ${described.join("; ")}${more}. Do the work and say so in the note, or mark the criterion skipped or failed; a completion cannot mark met what its own evidence says is not done.`;
}
