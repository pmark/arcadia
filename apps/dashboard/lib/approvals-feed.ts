import {
  loadOpenDecisions,
  loadOperatorTodo,
  loadPendingAgentAsks,
  peekAgentAskEligibility
} from "./arcadia-cli";
import { buildApprovals, type ApprovalList } from "./approvals";
import { createSharedCache, type SharedCache } from "./shared-cache";

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
  const list = buildApprovals({
    eligibility,
    asks: pendingAsks,
    decisions: decisions.status === "fulfilled" ? decisions.value.data.decisions : null,
    todo: todo.status === "fulfilled" ? { items: todo.value.data.items, unavailable: todo.value.data.unavailable ?? [] } : null,
    loadError: loaderFailure ? describeFailure(loaderFailure.reason) : undefined,
    todoError: todo.status === "rejected" ? describeFailure(todo.reason) : undefined
  });
  if (loaderFailure || todo.status === "rejected") degradedLists.add(list);
  return list;
}

/** Lists built while a loader failed: served once, never cached. */
const degradedLists = new WeakSet<ApprovalList>();

/** Rebuilding spawns three CLI processes (seconds on a large backlog), so every poll and tab shares one cached copy. */
export const APPROVALS_CACHE_TTL_MS = 10_000;
/** Past this age a copy is rebuilt before it is served, so a tab reopened after a long idle never shows settled items as live. */
export const APPROVALS_CACHE_MAX_STALE_MS = 60_000;

// Anchored on globalThis: the route handlers and instrumentation can be separate bundles, and a write in one must invalidate the copy the others serve.
const CACHE_KEY = Symbol.for("arcadia.dashboard.approvalsCache");
const cacheHost = globalThis as typeof globalThis & { [CACHE_KEY]?: SharedCache<ApprovalList> };
const approvalsCache = (cacheHost[CACHE_KEY] ??= createSharedCache<ApprovalList>({
  ttlMs: APPROVALS_CACHE_TTL_MS,
  maxStaleMs: APPROVALS_CACHE_MAX_STALE_MS,
  load: buildList,
  // A degraded list (a loader failed) is served once but never cached.
  cacheable: (list) => !degradedLists.has(list)
}));

/** Drop the cached list so the next GET rebuilds it (called after any write that changes it). */
export function invalidateApprovalsCache(): void {
  approvalsCache.invalidate();
}

export function getApprovals(): Promise<ApprovalList> {
  return approvalsCache.get();
}
