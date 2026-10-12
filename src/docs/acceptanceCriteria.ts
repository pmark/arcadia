/** Deterministic minimum checks; review still judges coverage and the evidence. */
export interface AcceptanceCriterionProblem { index: number | null; message: string; }

// An assertion must name an inspectable result or constraint. This grammar is
// deliberately a minimum, not a claim to prove arbitrary English or its truth.
const OBSERVABLE_ASSERTION = /\b(?:confirms?|cleared|refresh|readmit|prepares?|prepare|invoke|identif(?:y|ies)|computes?|built|defined|tested|expires?|expire|mutates?|mutate|re-derive|wired|performs?|labels?|suggests?|left|answers?|approves?|defers?|feeds?|overrides?|submits?|grants?|switch|serves?|spawns?|spawn|admitted|queued|promoted|declined|surfaced|required|completed|tears?|tear|times? out|timeouts?|marks?|places?|succeeds?|documents?|document|treats?|counts?|describes?|bumps?|recognizes?|recognises?|tells?|points?|surfaces?|ships?|ship|permits?|shelves?|shelve|removes?|reproduces?|raises?|routes?|hits?|emits?|commits?|selects?|maps?|gathers?|explains?|explain|yields?|offers?|holds?|finds?|sees?|timed|classified|exists?|contains?|includes?|shows?|rejects?|refuses?|returns?|reports?|records?|requires?|exits?|pass(?:es)?|fails?|remains?|leaves?|preserves?|produces?|creates?|adds?|writes?|retains?|resolves?|names?|lists?|defines?|declares?|supports?|runs?|covers?|accepts?|enforces?|displays?|exposes?|matches?|equals?|stops?|starts?|renders?|reads?|prints?|keeps?|satisf(?:y|ies)|links?|verif(?:y|ies)|prov(?:e|es)|receives?|uses?|shares?|appears?|agrees?|closes?|opens?|carries?|continues?|extends?|extend|binds?|bind|fences?|revalidates?|revalidate|provides?|provide|completes?|complete|presents?|present|reuses?|reuse|validates?|validate|normalizes?|distinguishes?|stays?|survives?|states?|searches?|filters?|updates?|posts?|asserts?|round-trip|persist(?:s)?|reported|written|created|recorded|refused|rejected|returned|stored|staged|committed|pushed|published|renamed|rewritten|preserved|released|flagged|logged|retried|removed|named|signed|validated|checked|selected|expanded|collapsed|registered|classified|referenced|attached|computed|bound|reviewed|covered|introduced|modified|resolved|dispatched|counted|stated|revalidated|journalled|exported|posted|enabled|disabled|accessible|copied|divided|forecast|listed|labeled|scoped|normalized|overwritten|accepted|updated|re-verif(?:y|ied)|compares?|delivers?|advances?|gains?|embeds?|issues?|allows?|skips?|changes?|executes?|says?|blocks?|resends?|resend|authorizes?|recommends?|coexists?|demonstrated|documented|reachable|visible|unchanged|byte-stable|idempotent|zero|non-zero)\b|(?:<=|>=|=|<|>)\s*\d/i;

// Field/value enumerations and explicit comparisons are inspectable even when
// the sentence uses a copula. A copula/modal by itself is never an assertion.
const ENUMERATED_FIELDS = /\b(?:has|have) (?:exactly )?(?:one|two|three|\d+) (?:[a-z-]+ ){0,4}(?:actions?|controls?|buttons?|entries|rows?|columns?|fields?)\b|\b(?:has|have) [^.!?]+`[^`]+`[^.!?]*[,;][^.!?]+|\b(?:columns|fields|keys|states|statuses|values|roles|types|labels|options) (?:are|include|have|has) [^.!?]+[,;][^.!?]+/i;
const NUMERIC_COMPARISON = /(?:<=|>=|=|<|>|≤|≥)\s*\d|\b(?:at most|at least|less than|fewer than|exactly|within|under) \d[\d,.]*\s*(?:tokens?|seconds?|minutes?|ms|clicks?|interactions?|rows?|entries|calls?|launches?|columns?)\b/i;

const OBSERVABLE_STATE = /\b(?:is|are) (?:a |an |the |hard |not |no longer |still )*(?:refusal|failure|success|empty)\b|\b(?:predicate|result|flag|status) (?:is )?(?:true|false)\b|\bnot part of\b|\bworks (?:on|with|when|without)\b/i;

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
    if (!OBSERVABLE_ASSERTION.test(text) && !ENUMERATED_FIELDS.test(text) && !NUMERIC_COMPARISON.test(text) && !OBSERVABLE_STATE.test(text)) {
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
