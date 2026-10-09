"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GlobalStrip, QueueSection, SessionsSection } from "../../components/production-console";
import { Sidebar } from "../../components/sidebar";
import { assembleQueue, type ConsoleCoreData, type ConsoleQueuePart } from "../../lib/production-console";

/** Sessions and production state: fast while anything is live. */
const CORE_POLL_LIVE_MS = 4_000;
const CORE_POLL_IDLE_MS = 15_000;
/** The queue moves slowly and is expensive to compute. */
const QUEUE_POLL_MS = 30_000;

/**
 * Production — drive and monitor production from one page.
 *
 * It consolidates what /runs, /work-queue, /flight-deck and Mission Control's
 * agent queue each show part of: production state and its switch, the queue
 * grouped into batches that can run side by side, a Launch for each ready
 * Action, and every live or recent Session with its log. Operator to-dos live
 * on their own pages (/runs, /review), not here: this page is production only.
 * It reads only what Arcadia already records, and every state change goes
 * through an existing preview-then-confirm route.
 */
export default function ProductionPage() {
  const [core, setCore] = useState<ConsoleCoreData | null>(null);
  const [coreError, setCoreError] = useState<string | null>(null);
  const [queuePart, setQueuePart] = useState<ConsoleQueuePart | null>(null);
  const [queueFetchError, setQueueFetchError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [refreshing, setRefreshing] = useState(false);
  const liveRef = useRef(false);
  // Polls, focus and post-toggle refreshes overlap; only the newest request may update the page.
  const coreSeq = useRef(0);
  const queueSeq = useRef(0);

  // `fresh` skips the server's short cache: after a state change or a manual Refresh.
  const loadCore = useCallback(async (fresh = false) => {
    const sequence = ++coreSeq.current;
    try {
      const response = await fetch(`/api/production-console?part=core${fresh ? "&fresh=1" : ""}`, { cache: "no-store" });
      const body = (await response.json()) as ConsoleCoreData & { error?: string };
      if (sequence !== coreSeq.current) return;
      if (!response.ok) throw new Error(body.error ?? "Could not read production state.");
      setCore(body);
      setCoreError(null);
      liveRef.current = (body.sessions?.active.length ?? 0) > 0;
    } catch (cause) {
      if (sequence === coreSeq.current) setCoreError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const loadQueue = useCallback(async (fresh = false) => {
    const sequence = ++queueSeq.current;
    try {
      const response = await fetch(`/api/production-console?part=queue${fresh ? "&fresh=1" : ""}`, { cache: "no-store" });
      const body = (await response.json()) as ConsoleQueuePart & { error?: string };
      if (sequence !== queueSeq.current) return;
      if (!response.ok) throw new Error(body.error ?? "Could not read the queue.");
      setQueuePart(body);
      setQueueFetchError(null);
    } catch (cause) {
      if (sequence === queueSeq.current) setQueueFetchError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadCore(true), loadQueue(true)]);
    setRefreshing(false);
  }, [loadCore, loadQueue]);

  useEffect(() => {
    void loadCore();
    void loadQueue();
  }, [loadCore, loadQueue]);

  // Self-scheduling polls: faster while a Session is live, paused while the tab is hidden.
  useEffect(() => {
    let timer: number | null = null;
    let disposed = false;
    const schedule = () => {
      timer = window.setTimeout(() => {
        const tick = document.visibilityState === "visible" ? loadCore() : Promise.resolve();
        void tick.then(() => {
          if (!disposed) schedule();
        });
      }, liveRef.current ? CORE_POLL_LIVE_MS : CORE_POLL_IDLE_MS);
    };
    schedule();
    const queueTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadQueue();
    }, QUEUE_POLL_MS);
    const clock = window.setInterval(() => setNow(new Date()), 1_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void loadCore();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      if (timer !== null) window.clearTimeout(timer);
      window.clearInterval(queueTimer);
      window.clearInterval(clock);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loadCore, loadQueue]);

  const assembled = useMemo(
    () => (queuePart?.queue ? assembleQueue(queuePart.queue, queuePart.batch, core?.sessions?.active ?? []) : null),
    [queuePart, core]
  );
  const queueView: ConsoleQueuePart | null = queuePart ?? (queueFetchError ? { generatedAt: "", queue: null, queueError: queueFetchError, batch: null, batchError: null } : null);

  return (
    <div data-theme-scope="auto" className="min-h-dvh w-full min-w-0 bg-canvas text-ink">
      <header className="sticky top-0 z-20 border-b border-line bg-panel/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-3">
          <Sidebar />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold leading-5">Production</h1>
            <p className="truncate text-xs text-muted">
              {core ? `Updated ${new Date(core.generatedAt).toLocaleTimeString()}` : "Reading Arcadia…"}
              {coreError && core ? " · last refresh failed, showing the last known state" : ""}
            </p>
          </div>
          <button
            type="button"
            aria-label="Refresh everything"
            onClick={() => void refreshAll()}
            disabled={refreshing}
            className="grid h-11 w-11 place-items-center rounded-md border border-line bg-panel text-ink disabled:opacity-60"
          >
            <RefreshCw className={refreshing ? "h-5 w-5 animate-spin" : "h-5 w-5"} aria-hidden="true" />
          </button>
        </div>
      </header>
      <main className="mx-auto grid w-full min-w-0 max-w-6xl gap-6 px-4 pb-16 pt-4">
        <GlobalStrip core={core} error={coreError} now={now} onChanged={() => void loadCore(true)} />
        <div className="grid min-w-0 content-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <SessionsSection core={core} now={now} />
          <QueueSection part={queueView} assembled={assembled} now={now} onLaunched={() => void refreshAll()} />
        </div>
        <nav aria-label="Related pages" className="border-t border-line pt-4 text-xs text-muted">
          Older partial views, kept while this page settles in:{" "}
          <Link className="text-steel underline" href="/work-queue">Work Queue</Link> (reorder),{" "}
          <Link className="text-steel underline" href="/runs">Runs</Link> (Run history),{" "}
          <Link className="text-steel underline" href="/flight-deck">Flight Deck</Link>,{" "}
          <Link className="text-steel underline" href="/path">Path</Link> (route to the target),{" "}
          <Link className="text-steel underline" href="/actions">Operator actions</Link>.
        </nav>
      </main>
    </div>
  );
}
