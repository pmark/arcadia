import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";

/**
 * The claim an approval of a Decision holds while it makes the Action the Decision was about (#1115).
 *
 * `review approve` makes the Action in `runAskCommand` and decides the Decision in a later transaction. Two things
 * could go wrong between them: two concurrent approvals each made an Action, and an attempt that failed in the gap
 * left an Action no Decision knew about, which a retry then duplicated.
 *
 * The claim closes both. The Action, its plan, its gates and the claim commit in ONE write transaction, with the
 * Decision's status re-read under the write lock, so a concurrent loser sees the claim (or the decision) and creates
 * nothing. A retry after a failure finds the claim and resumes the Action it names instead of creating another. The
 * lease only bounds a process that died without releasing: while it is held nobody else may take the claim.
 */
export const APPROVAL_CLAIM_LEASE_MS = 10 * 60 * 1000;

export type ApprovalClaim =
  /** Nothing was made for this Decision yet: the caller creates the Action, then calls `recordApprovalClaim`. */
  | { kind: "create" }
  /** An earlier attempt made this Action and failed before the approval committed: the caller reuses it. */
  | { kind: "resume"; workItemId: string; planId: string };

interface ClaimRow {
  owner: string;
  work_item_id: string;
  plan_id: string;
  lease_expires_at: string;
}

/**
 * Whether the Action an earlier approval attempt made can still be approved. An Action that was archived, closed,
 * deferred or superseded (`ask correct`) since then is the operator's decision to retire it; approving it again would
 * resurrect work they set aside, so the approval fails closed instead of reusing it or making a duplicate.
 */
export function assertReusableApprovalAction(db: Database.Database, workItemId: string | null, askRequestId?: string | null): void {
  const refuse = (state: string): never => {
    throw validationError(`The Action made by an earlier attempt to approve this Decision is ${state}, so it was not reused.`, {
      workItemId,
      remedy: "Nothing was created. Reject this Decision and send the request again if the work is still wanted."
    });
  };
  if (!workItemId) return refuse("missing");
  const item = db.prepare("SELECT status, archived_at FROM work_items WHERE id = ?").get(workItemId) as
    | { status: string; archived_at: string | null }
    | undefined;
  if (!item) return refuse("missing");
  if (item.archived_at) return refuse("archived");
  if (item.status === "done") return refuse("closed");
  if (item.status === "deferred") return refuse("deferred");
  if (askRequestId) {
    const superseded = db.prepare("SELECT 1 FROM ask_supersessions WHERE old_ask_request_id = ?").get(askRequestId);
    if (superseded) return refuse("superseded");
  }
}

/**
 * Called inside the write transaction that would create the Action. Throws, creating nothing, when the Decision is no
 * longer open, when another attempt holds the claim, or when an Action an earlier attempt linked already exists.
 */
export function claimApprovalForAction(
  db: Database.Database,
  input: { reviewItemId: string; owner: string; now?: Date }
): ApprovalClaim {
  const now = input.now ?? new Date();
  const review = db
    .prepare("SELECT status, resulting_ask_request_id FROM review_items WHERE id = ?")
    .get(input.reviewItemId) as { status: string; resulting_ask_request_id: string | null } | undefined;
  if (!review || (review.status !== "open" && review.status !== "deferred")) {
    throw validationError("Requires Review Decision is already decided.", { id: input.reviewItemId, status: review?.status ?? null });
  }
  if (review.resulting_ask_request_id) {
    throw validationError("An earlier approval attempt already made the Action for this Decision.", {
      id: input.reviewItemId,
      remedy: "Run the approval again; it reuses that Action."
    });
  }
  const claim = db.prepare("SELECT owner, work_item_id, plan_id, lease_expires_at FROM review_approval_claims WHERE review_item_id = ?").get(
    input.reviewItemId
  ) as ClaimRow | undefined;
  if (!claim) return { kind: "create" };
  if (claim.owner !== input.owner && claim.lease_expires_at > now.toISOString()) {
    throw validationError("Another approval of this Decision is in progress, so nothing was created.", {
      id: input.reviewItemId,
      remedy: "Wait for it to finish, or run the approval again after it ends."
    });
  }
  assertReusableApprovalAction(db, claim.work_item_id);
  return { kind: "resume", workItemId: claim.work_item_id, planId: claim.plan_id };
}

/** Writes (or renews) the claim for the Action just made. Same transaction as the Action. */
export function recordApprovalClaim(
  db: Database.Database,
  input: { reviewItemId: string; owner: string; workItemId: string; planId: string; now?: Date }
): void {
  const now = input.now ?? new Date();
  const at = now.toISOString();
  db.prepare(
    `INSERT INTO review_approval_claims (review_item_id, owner, work_item_id, plan_id, lease_expires_at, created_at, updated_at)
     VALUES (@reviewItemId, @owner, @workItemId, @planId, @lease, @at, @at)
     ON CONFLICT(review_item_id) DO UPDATE SET
       owner = excluded.owner,
       work_item_id = excluded.work_item_id,
       plan_id = excluded.plan_id,
       lease_expires_at = excluded.lease_expires_at,
       updated_at = excluded.updated_at`
  ).run({
    reviewItemId: input.reviewItemId,
    owner: input.owner,
    workItemId: input.workItemId,
    planId: input.planId,
    lease: new Date(now.getTime() + APPROVAL_CLAIM_LEASE_MS).toISOString(),
    at
  });
}

/** Ends this attempt's lease after a failure so an immediate retry resumes the Action. Only the holder may release. */
export function releaseApprovalClaim(db: Database.Database, reviewItemId: string, owner: string): void {
  db.prepare("UPDATE review_approval_claims SET lease_expires_at = ? WHERE review_item_id = ? AND owner = ?").run(
    new Date(0).toISOString(),
    reviewItemId,
    owner
  );
}

/** The Decision is decided; the claim has done its job. Same transaction as the decision. */
export function deleteApprovalClaim(db: Database.Database, reviewItemId: string): void {
  db.prepare("DELETE FROM review_approval_claims WHERE review_item_id = ?").run(reviewItemId);
}
