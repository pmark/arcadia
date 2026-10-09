import type Database from "better-sqlite3";
import { getWorkItemByDocRef } from "../db/repositories.js";
import type { WorkItemSummary } from "../domain/types.js";
import { actionDocRef, parseActionDocRef } from "./types.js";

/**
 * Split-aware reading of a work item, shared by every reader that must treat a
 * narrowed, `done` Action as finished only once its remainders are too.
 *
 * A split narrows an Action to its finished slice and marks it `done`; the rest
 * of its declared scope lives in the Actions named by its own `split_into`
 * (mirrored onto the work item by `docs sync`). `split_into` is deliberately not
 * a `depends_on` edge -- see `src/ask/settlement.ts` -- so a reader that follows
 * only `depends_on` or only `status` sees the narrowed Action as satisfied. The
 * production concurrency gate (`src/production/policy.ts`), the North Star gates
 * and the path (`src/northStar`) all read it through here so there is one
 * implementation of the ref resolution and the walk.
 */

export interface SplitRemainder {
  /** The remainder's `doc_ref`, resolved against its parent's plan. */
  ref: string;
  /** `null` when no work item carries `ref` -- a remainder nobody ingested. */
  item: WorkItemSummary | null;
}

/** The remainders `item` names in its own `split_into`, one level, in declared order. */
export function listSplitRemainders(
  db: Database.Database,
  item: Pick<WorkItemSummary, "doc_ref" | "split_into_json">
): SplitRemainder[] {
  if (!item.split_into_json) return [];
  const remainderIds = JSON.parse(item.split_into_json) as string[];
  const parsed = item.doc_ref ? parseActionDocRef(item.doc_ref) : null;
  return remainderIds.map((remainderId) => {
    const ref = parsed ? actionDocRef(parsed.planSlug, remainderId) : remainderId;
    return { ref, item: getWorkItemByDocRef(db, ref) };
  });
}

/**
 * The first remainder, depth-first and in declared order, that is not settled,
 * following a remainder's own `split_into` in case it was itself later split.
 * `null` when every remainder in the chain is settled.
 *
 * `isSettled` defaults to `status === "done"`; the concurrency gate passes a
 * stricter test that also requires the remainder's own prerequisites to be done.
 * `seen` guards a cycle -- settlement only ever writes `split_into` once, onto a
 * freshly narrowed Action, so none should exist, but this walk must not assume it.
 */
export function findUnfinishedSplitRemainder(
  db: Database.Database,
  item: Pick<WorkItemSummary, "doc_ref" | "split_into_json">,
  isSettled: (remainder: WorkItemSummary) => boolean = (remainder) => remainder.status === "done",
  seen: Set<string> = new Set()
): SplitRemainder | null {
  for (const remainder of listSplitRemainders(db, item)) {
    if (seen.has(remainder.ref)) continue;
    seen.add(remainder.ref);
    if (!remainder.item || !isSettled(remainder.item)) return remainder;
    const nested = findUnfinishedSplitRemainder(db, remainder.item, isSettled, seen);
    if (nested) return nested;
  }
  return null;
}
