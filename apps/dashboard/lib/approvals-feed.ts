import {
  loadOpenDecisions,
  loadOperatorTodo,
  loadPendingAgentAsks,
  peekAgentAskEligibility
} from "./arcadia-cli";
import { buildApprovals, type ApprovalList } from "./approvals";
import { createSharedCache } from "./shared-cache";

function describeFailure(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/**
 * The operator's one list — a cheap, deterministic read, no model call.
 * `arcadia todo --json --all` supplies the list; the Decision and Agent Ask
 * loaders that predate it still supply each row's options, rationale, effects
 * and settle controls (the to-do rows do not carry those), so those rows keep
 * settling through their existing canonical writer (`agent-ask settle --apply`
 * or `decision approve`) exactly as before. Review items and any other kind are
 * read-only. If the to-do call fails the old loaders stand alone with a note.
 */
async function buildList(): Promise<ApprovalList> {
  const [asks, decisions, todo] = await Promise.allSettled([loadPendingAgentAsks(), loadOpenDecisions(), loadOperatorTodo()]);
  const loaderFailure = [asks, decisions].find((result) => result.status === "rejected");
  if (loaderFailure && todo.status === "rejected") throw loaderFailure.reason;
  const pendingAsks = asks.status === "fulfilled" ? asks.value.data.pending : null;
  // Whether Accept would apply is read here, server-side, so the page never offers a button the data does not support.
  // It never waits: cached verdicts only, previews run in the background (unknown until one lands).
  const eligibility = pendingAsks ? peekAgentAskEligibility(pendingAsks) : undefined;
  return buildApprovals({
    eligibility,
    asks: pendingAsks,
    decisions: decisions.status === "fulfilled" ? decisions.value.data.decisions : null,
    todo: todo.status === "fulfilled" ? { items: todo.value.data.items, unavailable: todo.value.data.unavailable ?? [] } : null,
    loadError: loaderFailure ? describeFailure(loaderFailure.reason) : undefined,
    todoError: todo.status === "rejected" ? describeFailure(todo.reason) : undefined
  });
}

/** Rebuilding spawns three CLI processes (seconds on a large backlog), so every poll and tab shares one cached copy. */
export const APPROVALS_CACHE_TTL_MS = 10_000;
const approvalsCache = createSharedCache<ApprovalList>({ ttlMs: APPROVALS_CACHE_TTL_MS, load: buildList });

/** Drop the cached list so the next GET rebuilds it (called after any write that changes it). */
export function invalidateApprovalsCache(): void {
  approvalsCache.invalidate();
}

export function getApprovals(): Promise<ApprovalList> {
  return approvalsCache.get();
}
