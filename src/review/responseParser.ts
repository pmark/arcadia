export const REVIEW_FEEDBACK_TYPES = [
  "misunderstood",
  "wrong project",
  "wrong intent",
  "should not review",
  "intent failed",
  "missing option",
  "confusing"
] as const;

export type ReviewFeedbackType = typeof REVIEW_FEEDBACK_TYPES[number];

export type ReviewDecisionToken = "approve" | "reject" | "defer";

export interface ReviewResponseParseContext {
  reviewId?: string | null;
  reviewSlug?: string | null;
}

export interface ParsedReviewResponse {
  reviewId: string | null;
  reviewSlug: string | null;
  /** A Decision number (`0132`) that preceded a lettered answer (`0132 A`), when the reply named one. */
  decisionNumber: string | null;
  value: string;
  decisionToken: ReviewDecisionToken | null;
  optionLetter: string | null;
  feedbackType: ReviewFeedbackType | null;
  hasReviewReference: boolean;
  hasResponse: boolean;
}

const REVIEW_ID_PATTERN = /^review_[A-Za-z0-9_-]+$/i;
const REVIEW_SLUG_PATTERN = /^R\d+$/i;

export function parseReviewResponse(
  input: string,
  context: ReviewResponseParseContext = {}
): ParsedReviewResponse {
  const trimmed = input.trim();
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const numbered = tokens.length === 2 && /^\d{3,5}$/.test(tokens[0]) && /^[a-z][.,:;!?]?$/i.test(tokens[1]);
  if (numbered) {
    const letter = tokens[1].slice(0, 1).toUpperCase();
    return {
      reviewId: context.reviewId?.trim() || null,
      reviewSlug: context.reviewSlug?.trim().toUpperCase() || null,
      decisionNumber: tokens[0].padStart(4, "0"),
      value: letter,
      decisionToken: null,
      optionLetter: letter,
      feedbackType: null,
      hasReviewReference: true,
      hasResponse: true
    };
  }
  const leading = extractReference(tokens[0], 0);
  const trailing = extractReference(tokens[tokens.length - 1], tokens.length - 1);
  const reference = leading ?? trailing;
  const value = reference
    ? tokens.filter((_, index) => index !== reference.index).join(" ").trim()
    : trimmed;
  const normalized = normalizeReviewResponseValue(value);
  const optionLetter = /^[a-z]$/i.test(normalized) ? normalized.toUpperCase() : null;
  const decisionToken = decisionTokenFor(normalized);
  const feedbackType = REVIEW_FEEDBACK_TYPES.find((type) => normalized === normalizeReviewResponseValue(type)) ?? null;
  const reviewId = context.reviewId?.trim() || reference?.id || null;
  const reviewSlug = (context.reviewSlug?.trim() || reference?.slug || null)?.toUpperCase() ?? null;

  return {
    reviewId,
    reviewSlug,
    decisionNumber: null,
    value,
    decisionToken,
    optionLetter,
    feedbackType,
    hasReviewReference: Boolean(reviewId || reviewSlug),
    hasResponse: Boolean(decisionToken || optionLetter || feedbackType)
  };
}

export function normalizeReviewResponseValue(value: string): string {
  return value.trim().toLowerCase().replaceAll(/\s+/g, " ");
}

function extractReference(
  token: string | undefined,
  index: number
): { id: string | null; slug: string | null; index: number } | null {
  if (!token) {
    return null;
  }
  const cleaned = token.replace(/[.,:;!?]$/g, "");
  if (REVIEW_ID_PATTERN.test(cleaned)) {
    return { id: cleaned, slug: null, index };
  }
  if (REVIEW_SLUG_PATTERN.test(cleaned)) {
    return { id: null, slug: cleaned.toUpperCase(), index };
  }
  return null;
}

function decisionTokenFor(normalized: string): ReviewDecisionToken | null {
  if (["yes", "approve", "approved"].includes(normalized)) {
    return "approve";
  }
  if (["no", "reject", "rejected"].includes(normalized)) {
    return "reject";
  }
  if (["defer", "deferred", "later"].includes(normalized)) {
    return "defer";
  }
  return null;
}
