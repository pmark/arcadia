import type { PullRequestInventoryState } from "./pull-request-inventory-cache";

export const INVENTORY_REQUEST_TIMEOUT_MS = 65_000;

export type InventoryRequestResult =
  | { status: "success"; inventory: PullRequestInventoryState }
  | { status: "error"; message: string }
  | { status: "superseded" };

interface InventoryRequestCoordinatorOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function createInventoryRequestCoordinator({
  fetchImpl = fetch,
  timeoutMs = INVENTORY_REQUEST_TIMEOUT_MS
}: InventoryRequestCoordinatorOptions = {}) {
  let generation = 0;
  let activeController: AbortController | null = null;

  async function request(refresh: boolean): Promise<InventoryRequestResult> {
    const requestGeneration = ++generation;
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const operation = (async () => {
      const response = await fetchImpl(`/api/pull-requests${refresh ? "?refresh=1" : ""}`, {
        cache: "no-store",
        signal: controller.signal
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(errorMessage(body, "Outstanding pull requests are unavailable."));
      return body as PullRequestInventoryState;
    })();
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new Error(`The inventory request took longer than ${Math.ceil(timeoutMs / 1_000)} seconds. Try again.`));
      }, timeoutMs);
    });
    const cancelled = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });

    try {
      const inventory = await Promise.race([operation, deadline, cancelled]);
      if (requestGeneration !== generation) return { status: "superseded" };
      return { status: "success", inventory };
    } catch (requestError) {
      if (requestGeneration !== generation) return { status: "superseded" };
      const message = timedOut
        ? `The inventory request took longer than ${Math.ceil(timeoutMs / 1_000)} seconds. Try again.`
        : requestError instanceof Error ? requestError.message : String(requestError);
      return { status: "error", message };
    } finally {
      if (timeout) clearTimeout(timeout);
      if (requestGeneration === generation) activeController = null;
    }
  }

  function cancel(): void {
    generation += 1;
    activeController?.abort();
    activeController = null;
  }

  return { request, cancel };
}

function errorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  return "error" in body && typeof body.error === "string" ? body.error : fallback;
}

const REMEMBERED_INVENTORY_KEY = "arcadia.pr-inventory.lightweight.v2";
const REMEMBERED_INVENTORY_MAX_AGE_MS = 24 * 60 * 60_000;

/** Browser-session cards are display evidence only; every revisit checks the server. */
export function readRememberedInventory(storage: Pick<Storage, "getItem">, now = Date.now()): PullRequestInventoryState | null {
  try {
    const raw = storage.getItem(REMEMBERED_INVENTORY_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!isInventoryState(value)) return null;
    const checkedAt = Date.parse(value.checkedAt);
    if (checkedAt > now || now - checkedAt > REMEMBERED_INVENTORY_MAX_AGE_MS) return null;
    return { ...value, stale: true, refreshing: true, refreshError: null };
  } catch { return null; }
}

export function rememberInventory(storage: Pick<Storage, "setItem">, inventory: PullRequestInventoryState): void {
  try { storage.setItem(REMEMBERED_INVENTORY_KEY, JSON.stringify(inventory)); }
  catch { /* Storage may be disabled or full; the live inventory remains usable. */ }
}


// Storage is untrusted. Validate the Dashboard contract before any card reaches JSX.
function isInventoryState(value: unknown): value is PullRequestInventoryState {
  if (!isRecord(value) || !isDate(value.checkedAt) || !isStrings(value.retainedProjectIds)
    || typeof value.incomplete !== "boolean" || typeof value.stale !== "boolean"
    || typeof value.refreshing !== "boolean" || !isNullableString(value.refreshError)) return false;
  const snapshot = value.snapshot;
  if (!isRecord(snapshot) || !isDate(snapshot.generatedAt) || !isCount(snapshot.projectsScanned)
    || !isRecord(snapshot.counts)) return false;
  const counts = snapshot.counts;
  if (!["total", "blocked", "checksFailing", "checksPending", "drafts", "ready", "mergeReady", "unknown"]
    .every(key => isCount(counts[key]))) return false;
  return Array.isArray(snapshot.pullRequests) && snapshot.pullRequests.every(isPullRequest)
    && Array.isArray(snapshot.errors) && snapshot.errors.every(error => isRecord(error)
      && [error.projectId, error.projectName, error.message].every(value => typeof value === "string")
      && isNullableString(error.repositoryPath))
    && (snapshot.repositories === undefined || (Array.isArray(snapshot.repositories)
      && snapshot.repositories.every(repository => isRecord(repository)
        && [repository.projectId, repository.projectName, repository.repository, repository.repositoryPath]
          .every(value => typeof value === "string"))));
}

function isPullRequest(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return [value.projectId, value.projectName, value.repositoryPath, value.repository, value.title, value.url,
    value.headBranch, value.baseBranch, value.readinessLabel, value.summary].every(value => typeof value === "string")
    && isCount(value.number) && value.number > 0 && value.state === "OPEN" && typeof value.isDraft === "boolean"
    && [value.author, value.reviewDecision, value.mergeStateStatus].every(isNullableString)
    && [value.createdAt, value.updatedAt].every(date => date === null || isDate(date))
    && typeof value.readiness === "string"
    && ["blocked", "checks_failing", "checks_pending", "draft", "ready", "merge_ready", "unknown"].includes(value.readiness)
    && Array.isArray(value.checks) && value.checks.every(check => isRecord(check)
      && typeof check.name === "string" && [check.status, check.conclusion, check.url].every(isNullableString))
    && (value.detailsLoaded === undefined || typeof value.detailsLoaded === "boolean")
    && isBriefing(value.briefing);
}

function isBriefing(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value) || ![value.changedFiles, value.unmentionedFiles, value.decisionFiles, value.materialFacts].every(isStrings)) return false;
  const base = value.basePullRequest;
  return base === null || (isRecord(base) && isCount(base.number) && base.number > 0
    && typeof base.title === "string" && typeof base.headBranch === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(entry => typeof entry === "string");
}

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
