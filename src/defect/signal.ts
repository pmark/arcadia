import { createHash } from "node:crypto";

/**
 * Deterministic helpers for the defect intake.
 *
 * Nothing here calls a model, and nothing here reaches a database. The intake
 * has to be cheap and replay-safe, so its identity is a pure function of the
 * report's own content: normalize the text, hash it with the Project and source
 * it was filed under, and that hash is the record's fingerprint. An exact retry
 * therefore resolves to the same signal instead of minting a second one, and
 * two genuinely different reports never collide.
 */

/**
 * Case, surrounding space, and runs of whitespace are not part of a report's
 * identity. Two spellings of the same sentence are the same defect.
 */
export function normalizeDefectSummary(summary: string): string {
  return summary.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * The stable identity of a report. Deliberately excludes time, revision, and
 * evidence: those describe one observation of a defect, not the defect, so a
 * retry that adds evidence still lands on the record already filed.
 */
export function defectFingerprint(summary: string, projectId: string | null, source: string): string {
  return createHash("sha256")
    .update(JSON.stringify({
      summary: normalizeDefectSummary(summary),
      project: projectId ?? null,
      source
    }))
    .digest("hex");
}

/** Trimmed, non-empty, de-duplicated evidence, preserving first-seen order. */
export function normalizeEvidence(evidence: readonly string[]): string[] {
  return mergeEvidence([], evidence);
}

/** Union of two evidence lists: the existing order first, then anything new. */
export function mergeEvidence(existing: readonly string[], incoming: readonly string[]): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const value of [...existing, ...incoming]) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    merged.push(trimmed);
  }
  return merged;
}

/**
 * A report is "likely a duplicate" of another when their summaries share most
 * of their significant words. This is a signal for a human or the triage loop
 * to look at, never an automatic merge: a distinct report that happens to read
 * like an earlier one is preserved, and its candidate is reported alongside it.
 */
export const LIKELY_DUPLICATE_THRESHOLD = 0.7;

/** Common words carry no defect identity, so similarity ignores them. */
const STOP_WORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "any", "can", "her",
  "was", "one", "our", "out", "day", "get", "has", "him", "his", "how", "its",
  "new", "now", "old", "see", "two", "way", "who", "boy", "did", "does", "doing",
  "done", "with", "when", "that", "this", "from", "have", "into", "than", "then",
  "them", "they", "were", "what", "will", "your", "about", "after", "again",
  "been", "before", "being", "below", "between", "both", "each", "few", "more",
  "most", "other", "over", "same", "some", "such", "only", "own", "should",
  "because", "while", "where", "which"
]);

export function summaryTokens(summary: string): Set<string> {
  return new Set(
    normalizeDefectSummary(summary)
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token))
  );
}

/** Jaccard similarity over significant words; 0 when either side has none. */
export function summarySimilarity(left: string, right: string): number {
  const a = summaryTokens(left);
  const b = summaryTokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  return intersection / (a.size + b.size - intersection);
}
