interface DecisionDisplaySource {
  id: string;
  slug: string;
  sourceInput: string;
}

/**
 * Document-backed Decisions carry a governed numeric id in their filename,
 * while database-native Decisions have an R-prefixed review slug. The
 * dashboard should prefer the governed id without making the database slug
 * unusable as a fallback.
 */
export function decisionDisplayId(source: DecisionDisplaySource): string {
  const documentId = /(?:^|[\\/])docs[\\/]decisions[\\/](\d+)(?:[-.])/i.exec(source.sourceInput)?.[1];
  return documentId ?? source.slug ?? source.id;
}
