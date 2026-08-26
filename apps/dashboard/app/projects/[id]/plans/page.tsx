"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { DashboardChrome } from "../../../../components/chrome";
import { EmptyState, ErrorState, LoadingState } from "../../../../components/dashboard-ui";
import { PlanListRow, orderPlans } from "../../../../components/plans-list";
import type { ProjectPlansResponse } from "../../../../lib/plans-types";

export default function ProjectPlansPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const [data, setData] = useState<ProjectPlansResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/projects/${encodeURIComponent(projectId)}/plans`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) {
          throw new Error(typeof body?.error === "string" ? body.error : "Plans could not be loaded.");
        }
        setData(body as ProjectPlansResponse);
        setLastLoadedAt(new Date());
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const plans = data ? orderPlans(data.plans) : [];

  return (
    <DashboardChrome
      title={data?.project?.name ?? "Plans"}
      subtitle={data?.project?.activePlan ? `Active plan: ${data.project.activePlan}` : undefined}
      refreshing={loading}
      lastLoadedAt={lastLoadedAt}
      onRefresh={load}
    >
      <div className="mb-4">
        <Link
          href={`/projects/${encodeURIComponent(projectId)}`}
          className="inline-flex min-h-9 items-center gap-2 rounded-md border border-line bg-panel px-3 text-sm font-semibold text-muted transition hover:border-steel hover:text-steel"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Project
        </Link>
      </div>

      {error ? <ErrorState title="Plans unavailable" message={error} /> : null}

      {loading && !data ? (
        <LoadingState />
      ) : plans.length === 0 ? (
        <EmptyState text="No plan documents found for this project." />
      ) : (
        <div className="grid min-w-0 gap-3">
          {plans.map((plan) => (
            <PlanListRow key={plan.slug} plan={plan} detailed />
          ))}
        </div>
      )}
    </DashboardChrome>
  );
}
