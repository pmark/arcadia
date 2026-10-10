"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { DashboardChrome } from "../../components/chrome";
import { EmptyState, ErrorState, LoadingState } from "../../components/dashboard-ui";
import { isFinishedPlan, PlanListRow, orderPlans, planHref } from "../../components/plans-list";
import type { AllPlansResponse } from "../../lib/plans-types";

/**
 * Plans: every Project's plans, grouped by Project, each linking to its own
 * page with every Action. Read-only; plans change through Agent Asks.
 */
export default function PlansPage() {
  const [data, setData] = useState<AllPlansResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const [showFinished, setShowFinished] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch("/api/plans", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "Plans could not be loaded.");
        setData(body as AllPlansResponse);
        setLastLoadedAt(new Date());
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : String(loadError)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const finishedCount = data?.projects.reduce((sum, project) => sum + (project.plans?.filter(isFinishedPlan).length ?? 0), 0) ?? 0;

  return (
    <DashboardChrome title="Plans" subtitle="Every Project's plans" refreshing={loading} lastLoadedAt={lastLoadedAt} onRefresh={load}>
      {error ? <ErrorState title="Plans unavailable" message={error} /> : null}
      {loading && !data ? (
        <LoadingState />
      ) : !data || data.projects.length === 0 ? (
        <EmptyState text="No Projects are in this workspace." />
      ) : (
        <div className="grid min-w-0 gap-6">
          {finishedCount > 0 ? (
            <label className="flex min-h-9 items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={showFinished} onChange={(event) => setShowFinished(event.target.checked)} />
              Show finished and replaced plans ({finishedCount})
            </label>
          ) : null}
          {data.projects.map((project) => {
            const plans = orderPlans(project.plans ?? []).filter((plan) => showFinished || !isFinishedPlan(plan));
            return (
              <section key={project.id} aria-label={project.name} className="grid min-w-0 gap-2">
                <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
                  <h2 className="min-w-0 break-words text-base font-semibold">
                    <Link href={`/projects/${encodeURIComponent(project.id)}`} className="hover:underline">{project.name}</Link>
                  </h2>
                  <span className="text-xs text-muted">{project.status}{project.activePlan ? ` · active plan ${project.activePlan}` : ""}</span>
                </div>
                {project.error ? (
                  <p className="rounded-md border border-gold/50 bg-gold/10 p-3 text-sm text-ink">{project.error}</p>
                ) : plans.length === 0 ? (
                  <p className="text-sm text-muted">{project.plans?.length ? "Only finished plans." : "No plan documents."}</p>
                ) : (
                  plans.map((plan) => <PlanListRow key={plan.slug} plan={plan} detailed={false} href={plan.governed ? planHref(project.slug, plan.slug) : undefined} />)
                )}
              </section>
            );
          })}
        </div>
      )}
    </DashboardChrome>
  );
}
