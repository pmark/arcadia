import type { Approval } from "./approvals";
import type { NextStepsResponse } from "./next-steps-server";
import type { ConsoleCoreData } from "./production-console";
import { productionFacts, readFreshness, skyCounts, type ProductionFacts, type SkyCounts, type SkySources } from "./system-sky";
import type { DashboardOutstandingPullRequests } from "./types";
import { buildFeed } from "./workspace-feed";

/**
 * The small read behind the workspace sky: counts and timestamps, never the
 * lists themselves. The server keeps each source's last good answer and
 * refreshes it behind the request, so this answers at once however slow a
 * source is, and any number of open windows share one set of refreshes.
 */
export const STATUS_SOURCES = ["To-do list", "next steps", "pull requests", "production"] as const;
export type StatusSource = (typeof STATUS_SOURCES)[number];

export interface WorkspaceStatus {
  generatedAt: string;
  counts: SkyCounts;
  /** When each source's data was really read, and whether its latest attempt failed. */
  sources: Record<StatusSource, { asOf: number | null; failed: boolean }>;
  production: ProductionFacts | null;
}

export interface StatusLoaders {
  approvals: () => Promise<Approval[]>;
  nextSteps: () => Promise<NextStepsResponse>;
  /** Null while the inventory is still warming, which isn't a failure. */
  pullRequests: () => Promise<{ snapshot: DashboardOutstandingPullRequests; checkedAt: number } | null>;
  production: () => Promise<ConsoleCoreData>;
}

/** How often each source may be refreshed. Slower sources cost more, and none of them change by the second. */
const REFRESH_MS: Record<StatusSource, number> = { "To-do list": 60_000, "next steps": 120_000, "pull requests": 60_000, production: 30_000 };
/** A read that never answers counts as failed, so a source can't sit on "Reading" forever. Longer than the slowest read seen under load. */
export const STATUS_READ_DEADLINE_MS = 180_000;

interface Slot<T> { value: T | null; asOf: number | null; failed: boolean; pending: boolean; startedAt: number }
const slot = <T>(): Slot<T> => ({ value: null, asOf: null, failed: false, pending: false, startedAt: -Infinity });

export function createWorkspaceStatus(loaders: StatusLoaders, now: () => number = Date.now): () => WorkspaceStatus {
  const approvals = slot<Approval[]>();
  const nextSteps = slot<NextStepsResponse>();
  const pullRequests = slot<DashboardOutstandingPullRequests>();
  const production = slot<ConsoleCoreData>();

  // A failed refresh keeps the last good answer and its real age, so old data ages into Signal loss.
  function refresh<T>(name: StatusSource, target: Slot<T>, load: () => Promise<{ value: T; asOf: number } | null>) {
    if (target.pending || now() - target.startedAt < REFRESH_MS[name]) return;
    target.pending = true;
    target.startedAt = now();
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${name} read timed out.`)), STATUS_READ_DEADLINE_MS); });
    void Promise.race([load(), deadline]).then(result => {
      if (result) { target.value = result.value; target.asOf = result.asOf; }
      target.failed = false;
    }).catch(() => { target.failed = true; }).finally(() => { clearTimeout(timer); target.pending = false; });
  }

  return () => {
    refresh("To-do list", approvals, async () => ({ value: await loaders.approvals(), asOf: now() }));
    refresh("next steps", nextSteps, async () => ({ value: await loaders.nextSteps(), asOf: now() }));
    refresh("pull requests", pullRequests, async () => {
      const read = await loaders.pullRequests();
      return read && { value: read.snapshot, asOf: read.checkedAt };
    });
    // The core read is itself cached, and it says when it was really made.
    refresh("production", production, async () => {
      const value = await loaders.production();
      return { value, asOf: Date.parse(value.generatedAt) || now() };
    });
    const report = (s: Slot<unknown>) => ({ asOf: s.asOf, failed: s.failed });
    return {
      generatedAt: new Date(now()).toISOString(),
      counts: skyCounts(buildFeed({ approvals: approvals.value, nextSteps: nextSteps.value, pullRequests: pullRequests.value })),
      sources: { "To-do list": report(approvals), "next steps": report(nextSteps), "pull requests": report(pullRequests), production: report(production) },
      production: production.value && productionFacts(production.value)
    };
  };
}

/**
 * Turns the status read into what the sky needs. A failed production read means production's state is unknown, even with an
 * older answer to hand. `unreachable` means the status read itself failed, which says nothing about production.
 */
export function skySourcesFrom(status: WorkspaceStatus | null, unreachable: boolean, resumedAt: number, now: number): SkySources {
  if (!status) return { counts: skyCounts([]), problems: unreachable ? ["Arcadia's status"] : [], loading: !unreachable };
  const landed = STATUS_SOURCES.every(name => status.sources[name].asOf !== null || status.sources[name].failed);
  const asOf = Object.fromEntries(STATUS_SOURCES.flatMap(name => { const at = status.sources[name].asOf; return at === null ? [] : [[name, at]]; }));
  const { stale, resuming } = readFreshness(asOf, resumedAt, now);
  const failed = STATUS_SOURCES.filter(name => name !== "production" && status.sources[name].failed);
  const productionRead = status.sources.production;
  return {
    counts: status.counts,
    problems: [...failed, ...(unreachable ? ["Arcadia's status"] : [])],
    stale,
    resuming,
    loading: !landed,
    production: productionRead.failed ? null : productionRead.asOf === null ? undefined : status.production
  };
}
