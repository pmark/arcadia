"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { DashboardChrome } from "../../../components/chrome";
import { ErrorState, LoadingState } from "../../../components/dashboard-ui";
import { JobPanel } from "../../../components/intelligence/job-panel";
import { OfferingsPanel } from "../../../components/intelligence/offerings-panel";
import { RecentHistory } from "../../../components/intelligence/recent-history";
import { RequestForm } from "../../../components/intelligence/request-form";
import { useIntelligenceCapabilities } from "../../../hooks/use-intelligence-capabilities";
import { useIntelligenceJob } from "../../../hooks/use-intelligence-job";
import { useIntelligenceRecent } from "../../../hooks/use-intelligence-recent";
import type { AdminSubmission } from "../../../lib/intelligence-types";

export default function AdminIntelligencePage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <AdminIntelligencePageInner />
    </Suspense>
  );
}

function AdminIntelligencePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const jobIdParam = searchParams.get("job");

  const { data: capabilities, loading: capabilitiesLoading, error: capabilitiesError, refresh: refreshCapabilities } =
    useIntelligenceCapabilities();
  const { job, submit, submitting, error: jobError, pollingStopped, refresh: refreshJob } = useIntelligenceJob(jobIdParam);
  const { jobs: recentJobs, loading: recentLoading, error: recentError, refresh: refreshRecent } = useIntelligenceRecent();

  const selectJob = useCallback(
    (jobId: string) => {
      router.push(`/admin/intelligence?job=${encodeURIComponent(jobId)}`);
    },
    [router],
  );

  useEffect(() => {
    if (job && job.id !== jobIdParam) {
      router.replace(`/admin/intelligence?job=${encodeURIComponent(job.id)}`);
    }
  }, [job, jobIdParam, router]);

  useEffect(() => {
    if (job && (job.status === "completed" || job.status === "failed" || job.status === "blocked")) {
      void refreshRecent();
    }
  }, [job?.status, job?.id, refreshRecent]);

  async function handleSubmit(submission: AdminSubmission) {
    await submit(submission);
  }

  const activeJobBlocking = submitting || (job ? job.status === "queued" || job.status === "running" : false);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!capabilitiesLoading) {
      setLastLoadedAt(new Date());
    }
  }, [capabilitiesLoading, capabilities]);

  async function handleRefresh() {
    setRefreshing(true);
    await Promise.all([refreshCapabilities(), refreshRecent()]);
    setRefreshing(false);
  }

  return (
    <DashboardChrome
      title="Intelligence test bench"
      subtitle="Submits real Arcadia Intelligence jobs through the same service path companion apps use."
      refreshing={refreshing}
      lastLoadedAt={lastLoadedAt}
      onRefresh={() => void handleRefresh()}
    >
      <div className="grid gap-5">
        {capabilitiesError ? <ErrorState title="Arcadia Intelligence unavailable" message={capabilitiesError} /> : null}

        {capabilitiesLoading && !capabilities ? (
          <LoadingState />
        ) : capabilities ? (
          <>
            <OfferingsPanel textOfferings={capabilities.textOfferings} imageOfferings={capabilities.imageOfferings} />

            <RequestForm
              textOfferings={capabilities.textOfferings}
              imageOfferings={capabilities.imageOfferings}
              disabled={activeJobBlocking}
              onSubmit={handleSubmit}
            />

            {jobError ? <ErrorState title="Job request failed" message={jobError} /> : null}
            {job ? <JobPanel job={job} pollingStopped={pollingStopped} onRefresh={() => void refreshJob()} /> : null}

            <RecentHistory jobs={recentJobs} loading={recentLoading} error={recentError} onSelect={selectJob} />
          </>
        ) : null}
      </div>
    </DashboardChrome>
  );
}
