"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DashboardChrome } from "../../../components/chrome";
import { OperatorActionCard, type OperatorScript } from "../../../components/operator-action-card";
import { resolveOffPathConfirmation } from "../../../lib/offPathCheck";
import { singleFlight } from "../../../lib/singleFlight";

/**
 * One operator action on its own page. It reads exactly that action (GET /api/operator-script/<id>)
 * and polls it only while it is running; the library, decision cards and production status are not
 * touched until the operator presses Run, and then only to run the same off-path check as the list.
 */
export default function OperatorActionPage() {
  const params = useParams<{ id: string }>();
  // Keyed by id so navigating between actions never shows the previous action's state.
  return <OperatorActionView key={params.id} id={params.id} />;
}

function OperatorActionView({ id }: { id: string }) {
  const [script, setScript] = useState<OperatorScript | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [launching, setLaunching] = useState(false);

  const refresh = useMemo(() => singleFlight(async () => {
    try {
      const response = await fetch(`/api/operator-script/${encodeURIComponent(id)}`, { cache: "no-store" });
      const body = await response.json() as { script?: OperatorScript; error?: string };
      if (response.status === 404 || response.status === 400) {
        setMissing(true);
        setScript(null);
        return;
      }
      if (!response.ok || !body.script) throw new Error(body.error ?? "This operator action is unavailable.");
      setMissing(false);
      setScript(body.script);
      setError(null);
      setLoadedAt(new Date());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }), [id]);

  useEffect(() => { void refresh(); }, [refresh]);
  const running = script?.state.status === "running";
  useEffect(() => {
    if (!running) return undefined;
    const interval = setInterval(() => void refresh(), 2_000);
    return () => clearInterval(interval);
  }, [running, refresh]);

  const launch = useCallback(async () => {
    setLaunching(true);
    setError(null);
    try {
      const response = await fetch("/api/operator-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
      });
      const body = await response.json() as { runId?: string; error?: string };
      if (!response.ok || !body.runId) throw new Error(body.error ?? "The operator action could not be started.");
      window.location.assign(`/actions/${encodeURIComponent(id)}/runs/${encodeURIComponent(body.runId)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setLaunching(false);
    }
  }, [id]);

  return (
    <DashboardChrome title="Operator action" subtitle="One action, on its own page." refreshing={false} lastLoadedAt={loadedAt} onRefresh={() => void refresh()}>
      <p className="mb-4 text-sm"><Link href="/actions" className="font-semibold text-steel">All operator actions</Link></p>
      {error ? <p className="mb-4 rounded-md border border-clay/30 bg-clay/5 p-3 text-sm text-clay" role="alert">{error}</p> : null}
      {missing ? <p className="rounded-md border border-dashed border-line p-8 text-center text-sm text-muted">No operator action has the id <span className="break-all font-mono">{id}</span>; it may be retired. <Link href="/actions" className="font-semibold text-steel">Browse all actions</Link>.</p> : null}
      {loading ? <div className="h-64 animate-pulse rounded-md border border-line bg-panel" aria-hidden="true" /> : null}
      {script && !missing ? (
        <div className="max-w-3xl">
          <OperatorActionCard
            script={script}
            primary
            launching={launching}
            onLaunch={() => void launch()}
            resolveConfirmation={() => resolveOffPathConfirmation(script)}
          />
        </div>
      ) : null}
    </DashboardChrome>
  );
}
