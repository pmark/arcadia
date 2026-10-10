"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { DashboardChrome } from "../../../../components/chrome";
import { ErrorState, LoadingState } from "../../../../components/dashboard-ui";
import type { PlanDetailResponse, PlanProgressAction } from "../../../../lib/plans-types";

const STATUS_TONE: Record<string, string> = {
  done: "border-moss/40 bg-moss/10 text-moss",
  in_progress: "border-steel/40 bg-steel/10 text-steel",
  blocked: "border-clay/40 bg-clay/5 text-clay",
  deferred: "border-line bg-canvas text-muted",
  open: "border-line bg-panel text-ink"
};

function actionId(key: string): string {
  return key.split("/").slice(1).join("/");
}

/**
 * One Plan: its Milestone, progress, the Action Arcadia would take next and
 * every Action in document order. A linkable, read-only view; the Plan changes
 * through Agent Asks.
 */
export default function PlanDetailPage() {
  const params = useParams<{ project: string; plan: string }>();
  const [data, setData] = useState<PlanDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/plans/${encodeURIComponent(params.project)}/${encodeURIComponent(params.plan)}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "This Plan could not be loaded.");
        setData(body as PlanDetailResponse);
        setLastLoadedAt(new Date());
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : String(loadError)))
      .finally(() => setLoading(false));
  }, [params.project, params.plan]);

  useEffect(() => {
    load();
  }, [load]);

  const progress = data?.progress ?? null;
  const counts = progress?.counts;
  const donePercent = counts && counts.total > 0 ? Math.round((100 * counts.done) / counts.total) : 0;
  const currentKey = progress?.current?.key ?? null;
  const blockedReason = new Map((progress?.blocked ?? []).map((entry) => [entry.key, entry.reason]));

  return (
    <DashboardChrome
      title={params.plan}
      subtitle={data ? `${data.project.name}${progress?.isActivePlan ? " · active plan" : ""}` : undefined}
      refreshing={loading}
      lastLoadedAt={lastLoadedAt}
      onRefresh={load}
    >
      <div className="mb-4">
        <Link href="/plans" className="inline-flex min-h-9 items-center gap-2 rounded-md border border-line bg-panel px-3 text-sm font-semibold text-muted transition hover:border-steel hover:text-steel">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Plans
        </Link>
      </div>
      {error ? <ErrorState title="Plan unavailable" message={error} /> : null}
      {loading && !data ? (
        <LoadingState />
      ) : data && progress && counts ? (
        <div className="grid min-w-0 gap-4">
          <section aria-label="Summary" className="grid min-w-0 gap-2 rounded-md border border-line bg-panel p-3 text-sm">
            {data.plan?.milestone ? <p className="break-words"><span className="text-muted">Milestone: </span>{data.plan.milestone}</p> : null}
            <p className="text-muted">
              {data.plan ? `${data.plan.status} · ` : ""}
              {counts.done} of {counts.total} done · {counts.open} open · {counts.in_progress} in progress · {counts.blocked} blocked{counts.deferred ? ` · ${counts.deferred} deferred` : ""}
            </p>
            <div className="h-1.5 overflow-hidden rounded bg-line" aria-hidden="true">
              <div className="h-full bg-moss" style={{ width: `${donePercent}%` }} />
            </div>
            <p className="break-words">
              <span className="text-muted">Next: </span>
              {progress.current ? progress.current.title : progress.currentNote ?? "Nothing is ready."}
            </p>
            <p className="truncate text-xs text-muted">{progress.source.planPath} · updated {progress.source.updated}</p>
          </section>
          <section aria-label="Actions" className="min-w-0">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.14em] text-muted">Actions ({progress.actions.length})</h2>
            <ol className="grid min-w-0 gap-2">
              {progress.actions.map((action: PlanProgressAction, index) => (
                <li key={action.key} className={`grid min-w-0 gap-1 rounded-md border bg-panel p-3 text-sm ${action.key === currentKey ? "border-moss" : "border-line"}`}>
                  <div className="flex min-w-0 items-start gap-2">
                    <span className="w-6 shrink-0 text-xs text-muted">{index + 1}</span>
                    <p className="min-w-0 flex-1 break-words">{action.title}</p>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[action.status] ?? STATUS_TONE.open}`}>
                      {action.key === currentKey ? "next" : action.status.replace("_", " ")}
                    </span>
                  </div>
                  <p className="ml-8 break-words text-xs text-muted">
                    {actionId(action.key)}
                    {action.dependsOn.length > 0 ? ` · after ${action.dependsOn.join(", ")}` : ""}
                  </p>
                  {blockedReason.get(action.key) ? <p className="ml-8 break-words text-xs text-clay">{blockedReason.get(action.key)}</p> : null}
                </li>
              ))}
            </ol>
          </section>
          <p className="text-xs text-muted">{progress.note}</p>
        </div>
      ) : null}
    </DashboardChrome>
  );
}
