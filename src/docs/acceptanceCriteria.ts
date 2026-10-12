/** Deterministic minimum checks; review still judges coverage and the evidence. */
export interface AcceptanceCriterionProblem { index: number | null; message: string; }

// An assertion must name an inspectable result or constraint. This grammar is
// deliberately a minimum, not a claim to prove arbitrary English or its truth.
const OBSERVABLE_ASSERTION = /\b(?:marks?|places?|succeeds?|documents?|document|treats?|counts?|describes?|bumps?|recognizes?|recognises?|tells?|points?|surfaces?|ships?|ship|permits?|shelves?|shelve|removes?|reproduces?|is|are|has|have|can|cannot|must|will|does|no|neither|nothing|raises?|routes?|hits?|emits?|commits?|selects?|maps?|gathers?|explains?|explain|yields?|offers?|holds?|finds?|sees?|timed|classified|exists?|contains?|includes?|shows?|rejects?|refuses?|returns?|reports?|records?|requires?|exits?|pass(?:es)?|fails?|remains?|leaves?|preserves?|produces?|creates?|adds?|writes?|retains?|resolves?|names?|lists?|defines?|declares?|supports?|runs?|covers?|accepts?|enforces?|displays?|exposes?|matches?|equals?|stops?|starts?|renders?|reads?|prints?|keeps?|satisf(?:y|ies)|links?|verif(?:y|ies)|prov(?:e|es)|receives?|uses?|shares?|appears?|agrees?|closes?|opens?|carries?|continues?|extends?|extend|binds?|bind|fences?|revalidates?|revalidate|provides?|provide|completes?|complete|presents?|present|reuses?|reuse|validates?|validate|normalizes?|distinguishes?|stays?|survives?|states?|searches?|filters?|updates?|posts?|asserts?|round-trip|persist(?:s)?|demonstrated|recorded|documented|reachable|visible|unchanged|byte-stable|idempotent|zero|non-zero|without|cannot|never)\b|(?:<=|>=|=|<|>)\s*\d/i;

export function validateAcceptanceCriteria(raw: unknown): AcceptanceCriterionProblem[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [{ index: null, message: "Every Plan Action must define a non-empty acceptance_criteria list of precise, checkable conditions, regardless of status or current_action." }];
  }
  const problems: AcceptanceCriterionProblem[] = [];
  const seen = new Set<string>();
  raw.forEach((criterion: unknown, index: number) => {
    if (typeof criterion !== "string" || !criterion.trim()) {
      problems.push({ index, message: "An acceptance criterion must be a non-empty string; name the observable result and how it will be checked." });
      return;
    }
    const text = criterion.trim();
    const normalized = text.toLowerCase().replace(/\s+/g, " ").replace(/[.!]+$/, "");
    if (seen.has(normalized)) problems.push({ index, message: "Duplicate acceptance criterion; each condition must add a distinct check." });
    seen.add(normalized);
    if (/\b(?:TODO|TBD|TBC|FIXME)\b|<REPLACE:/.test(text) || /\[(?:insert|fill in)[^\]]*\]/i.test(text)) {
      problems.push({ index, message: "Unresolved placeholder in acceptance criterion; supply the concrete condition before validation." });
    }
    if (/^(?:it |the (?:product|feature|implementation) )?(?:works(?: correctly| properly| as expected)?|is (?:done|complete|high[- ]quality)|looks good|meets expectations|tests pass)[.!]?$/i.test(text) ||
        /\b(?:high[- ]quality|works correctly|works properly|works as expected|user[- ]friendly)\b/i.test(text) ||
        /\b(?:is|are|will be|should be|looks?|feels?) (?:good|great|fine|excellent|awesome|amazing|correct|robust|efficient|fast|secure|accessible|intuitive|production[- ]ready)\b/i.test(text)) {
      problems.push({ index, message: "Subjective acceptance criterion; replace the quality claim with an observable pass/fail result and a verification method." });
    }
    if (/^(?:implement|build|improve|ensure|optimize|fix|outline|make)\b/i.test(text) && text.split(/\s+/).length < 6) {
      problems.push({ index, message: "Acceptance criteria describe a result, not an implementation instruction; name what must be observed and how to verify it." });
    }
    if (!OBSERVABLE_ASSERTION.test(text)) {
      problems.push({ index, message: "Acceptance criterion has no observable assertion; name a concrete result, refusal, recorded field or numeric comparison and its verification method." });
    }
    // Budget references must identify a reproducible value, not an unnamed promise.
    if (/\b(?:probe token budget|fixed token bound|bounded token cost|bounded, recorded token cost)\b/i.test(text) &&
        !/\b\d[\d,_]*(?:\.\d+)?\s*(?:input[- ]|cached[- ]|uncached[- ])?tokens?\b/i.test(text)) {
      problems.push({ index, message: "Unspecified token threshold; state the numeric token limit and the fixture or command that verifies it." });
    }
  });
  return problems;
}
