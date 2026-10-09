import {
  loadProductionStatus,
  loadRunsSnapshot,
  loadScheduleSummary,
  loadWorkQueue,
  resolveDashboardWorkspace
} from "./arcadia-cli";
import {
  PAUSE_CAPABILITY,
  summarizeProduction,
  trimBatch,
  trimWorkQueue,
  type ConsoleCoreData,
  type ConsoleQueuePart
} from "./production-console";
import { cachedStale } from "./swr-cache";
import { readManagedRunWorker } from "./system-status";

/** Finished Sessions shown under the live ones. */
const RECENT_SESSIONS = 8;
/** The queue and schedule projections take seconds; serve the last result and refresh behind it. */
const QUEUE_TTL_MS = 15_000;

/**
 * Server-side loaders for /api/production-console. Every source settles on
 * its own, so one failing CLI read shows as that section's error rather than
 * blanking the page.
 */
export async function loadCorePart(): Promise<ConsoleCoreData> {
  const [production, worker, runs] = await Promise.allSettled([
    loadProductionStatus(),
    resolveDashboardWorkspace().then((workspace) => readManagedRunWorker(workspace)),
    loadRunsSnapshot(0, RECENT_SESSIONS)
  ]);
  return {
    generatedAt: new Date().toISOString(),
    production: production.status === "fulfilled" ? summarizeProduction(production.value.data) : null,
    productionError: production.status === "rejected" ? describe(production.reason) : null,
    worker: worker.status === "fulfilled" ? worker.value : null,
    sessions:
      runs.status === "fulfilled"
        ? { active: runs.value.data.runs.activeAgentSessions, recent: runs.value.data.runs.recentAgentSessions ?? [] }
        : null,
    sessionsError: runs.status === "rejected" ? describe(runs.reason) : null,
    pause: PAUSE_CAPABILITY
  };
}

export async function loadQueuePart(): Promise<ConsoleQueuePart> {
  const [queue, schedule] = await Promise.allSettled([
    cachedStale("production-console:queue", QUEUE_TTL_MS, () => loadWorkQueue()),
    cachedStale("production-console:schedule", QUEUE_TTL_MS, () => loadScheduleSummary())
  ]);
  const batch = schedule.status === "fulfilled" ? schedule.value.data.batch : null;
  return {
    generatedAt: new Date().toISOString(),
    queue: queue.status === "fulfilled" ? trimWorkQueue(queue.value.data) : null,
    queueError: queue.status === "rejected" ? describe(queue.reason) : null,
    batch: batch ? trimBatch(batch) : null,
    batchError: schedule.status === "rejected" ? describe(schedule.reason) : null
  };
}

function describe(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
