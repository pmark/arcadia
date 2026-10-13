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
