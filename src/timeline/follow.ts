import type { TimelineEvent, TimelineWindow } from "./schema.js";

/**
 * `--follow`: poll, and stream each event once as it appears.
 *
 * Every poll re-collects from a little before the previous poll's end (the
 * overlap), so a record written while the last poll ran is not missed; ids
 * already streamed are skipped. A fact whose own time is older than the
 * overlap when it first becomes visible (a commit fetched from elsewhere with
 * an old committer date) is not streamed; a fresh `arcadia timeline` shows it.
 */

/** Default polling interval: frequent enough to feel live, light enough for a laptop. */
export const DEFAULT_FOLLOW_INTERVAL_MS = 15_000;
/** How far back each poll re-reads before the previous poll's end. */
export const FOLLOW_OVERLAP_MS = 10 * 60_000;
/** Streamed ids remembered for de-duplication; older ones are pruned by time. */
const MAX_REMEMBERED = 50_000;

export interface FollowInput {
  /** Collect the merged, filtered stream for one window. */
  collect: (window: TimelineWindow) => Promise<TimelineEvent[]>;
  emit: (event: TimelineEvent) => void;
  /** First window's start: the backlog shown before live events. */
  since: Date;
  now?: () => Date;
  intervalMs?: number;
  overlapMs?: number;
  signal?: AbortSignal;
  /** At most this many backlog events on the first poll (newest kept). */
  backlogLimit?: number;
  /** Stop after this many polls; for tests. */
  maxPolls?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function followTimeline(input: FollowInput): Promise<{ polls: number; emitted: number }> {
  const now = input.now ?? (() => new Date());
  const intervalMs = input.intervalMs ?? DEFAULT_FOLLOW_INTERVAL_MS;
  const overlapMs = input.overlapMs ?? FOLLOW_OVERLAP_MS;
  const sleep = input.sleep ?? abortableSleep;
  const seen = new Map<string, number>();
  let since = input.since;
  let polls = 0;
  let emitted = 0;

  while (!input.signal?.aborted) {
    const until = now();
    let events = await input.collect({ since, until });
    if (polls === 0 && input.backlogLimit !== undefined && events.length > input.backlogLimit) {
      events = events.slice(events.length - input.backlogLimit);
    }
    for (const event of events) {
      // A fact is one event even when a later poll merges in a record that changes which record leads.
      const ids = [event.id, ...event.alsoSeenAs.map((alias) => alias.id)];
      const already = ids.some((id) => seen.has(id));
      const time = new Date(event.time).getTime();
      for (const id of ids) seen.set(id, Math.max(seen.get(id) ?? 0, time));
      if (already) continue;
      input.emit(event);
      emitted += 1;
    }
    polls += 1;
    since = new Date(Math.max(input.since.getTime(), until.getTime() - overlapMs));
    const horizon = since.getTime() - overlapMs;
    if (seen.size > MAX_REMEMBERED || polls % 20 === 0) {
      for (const [id, time] of seen) if (time < horizon) seen.delete(id);
    }
    if (input.maxPolls !== undefined && polls >= input.maxPolls) break;
    await sleep(intervalMs, input.signal);
  }
  return { polls, emitted };
}
