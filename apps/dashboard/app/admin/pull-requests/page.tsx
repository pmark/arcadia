"use client";

import { useCallback, useEffect, useState } from "react";
import { CircleAlert, Clock3, GitMerge, GitPullRequest, RefreshCw } from "lucide-react";
import { DashboardChrome } from "../../../components/chrome";
import { EmptyState, ErrorState, LoadingState, Metric, Section } from "../../../components/dashboard-ui";
import type {
  DashboardOutstandingPullRequest,
  DashboardOutstandingPullRequests,
  PullRequestReadiness
} from "../../../lib/types";

export default function AdminPullRequestsPage() {
  const [data, setData] = useState<DashboardOutstandingPullRequests | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/pull-requests", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(errorMessage(body, "Outstanding pull requests are unavailable."));
      setData(body as DashboardOutstandingPullRequests);
      setError(null);
      setLastLoadedAt(new Date());
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <DashboardChrome
      title="Outstanding PRs"
      subtitle={data ? `${data.counts.total} open across ${data.projectsScanned} Projects` : "Across every configured Project repository."}
      refreshing={refreshing}
      lastLoadedAt={lastLoadedAt}
      onRefresh={() => void refresh()}
    >
      {error ? <ErrorState title="Outstanding PRs unavailable" message={error} /> : null}
      {loading && !data ? <LoadingState /> : null}
      {data ? <PullRequestBody data={data} /> : null}
    </DashboardChrome>
  );
}

function PullRequestBody({ data }: { data: DashboardOutstandingPullRequests }) {
  return (
    <div className="grid min-w-0 gap-6">
      <section className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-5" aria-label="Pull-request readiness">
        <Metric label="Open" value={data.counts.total} tone="steel" />
        <Metric label="Merge-ready" value={data.counts.mergeReady} tone="green" />
        <Metric label="Ready for review" value={data.counts.ready} tone="neutral" />
        <Metric label="Drafts" value={data.counts.drafts} tone="gold" />
        <Metric label="Blocked / checks" value={data.counts.blocked + data.counts.checksFailing + data.counts.checksPending} tone={data.counts.blocked + data.counts.checksFailing > 0 ? "clay" : "gold"} />
      </section>

      {data.errors.length > 0 ? (
        <section className="grid min-w-0 gap-3 rounded-md border border-gold/40 bg-gold/5 p-4" aria-labelledby="pr-project-exceptions">
          <div className="flex items-center gap-2">
            <CircleAlert className="h-4 w-4 text-gold" aria-hidden="true" />
            <h2 id="pr-project-exceptions" className="text-base font-semibold">Project exceptions</h2>
          </div>
          <ul className="grid gap-2 text-sm text-ink">
            {data.errors.map((entry) => (
              <li key={`${entry.projectId}:${entry.message}`}>
                <span className="font-semibold">{entry.projectName}:</span> {entry.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Section title="Open pull requests">
        {data.pullRequests.length === 0 ? (
          <EmptyState text="No open pull requests found across the configured Project repositories." />
        ) : (
          <div className="grid min-w-0 gap-3">
            {data.pullRequests.map((pullRequest) => (
              <PullRequestCard key={`${pullRequest.repository}:${pullRequest.number}`} pullRequest={pullRequest} />
            ))}
          </div>
        )}
      </Section>

      <p className="text-xs text-muted">
        Read-only GitHub view. Readiness combines draft state, mergeability, review state, and reported checks; it does not approve, merge, or modify a PR.
      </p>
    </div>
  );
}

function PullRequestCard({ pullRequest }: { pullRequest: DashboardOutstandingPullRequest }) {
  const checkCounts = summarizeChecks(pullRequest);
  return (
    <article className="min-w-0 rounded-md border border-line bg-panel p-4 shadow-soft sm:p-5">
      <div className="flex min-w-0 items-start gap-3">
        <GitPullRequest className="mt-1 h-5 w-5 shrink-0 text-steel" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-moss">{pullRequest.projectName} · {pullRequest.repository}</p>
              <h3 className="mt-1 break-words text-base font-semibold leading-6">
                <a href={pullRequest.url} target="_blank" rel="noreferrer" className="transition hover:text-steel">
                  #{pullRequest.number} {pullRequest.title}
                </a>
              </h3>
            </div>
            <ReadinessBadge readiness={pullRequest.readiness} label={pullRequest.readinessLabel} />
          </div>
          <dl className="mt-4 grid min-w-0 gap-3 text-sm sm:grid-cols-2">
            <Detail label="Branch" value={`${pullRequest.headBranch} → ${pullRequest.baseBranch}`} />
            <Detail label="Author" value={pullRequest.author ?? "Unknown"} />
            <Detail label="Review" value={pullRequest.reviewDecision ? labelValue(pullRequest.reviewDecision) : "Not requested"} />
            <Detail label="Checks" value={checkCounts} />
            <div className="sm:col-span-2"><Detail label="Readiness" value={pullRequest.summary} /></div>
          </dl>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted">
            {pullRequest.isDraft ? <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" aria-hidden="true" /> Draft</span> : null}
            {pullRequest.readiness === "merge_ready" ? <span className="inline-flex items-center gap-1 text-moss"><GitMerge className="h-3.5 w-3.5" aria-hidden="true" /> Approved and merge-ready</span> : null}
            {pullRequest.updatedAt ? <span>Updated {formatDate(pullRequest.updatedAt)}</span> : null}
          </div>
        </div>
      </div>
    </article>
  );
}

function ReadinessBadge({ readiness, label }: { readiness: PullRequestReadiness; label: string }) {
  const className = {
    blocked: "border-clay/30 bg-clay/10 text-clay",
    checks_failing: "border-clay/30 bg-clay/10 text-clay",
    checks_pending: "border-gold/30 bg-gold/10 text-gold",
    draft: "border-gold/30 bg-gold/10 text-gold",
    ready: "border-steel/30 bg-steel/10 text-steel",
    merge_ready: "border-moss/30 bg-moss/10 text-moss",
    unknown: "border-line bg-canvas text-muted"
  }[readiness];
  return <span className={`inline-flex h-7 items-center rounded-md border px-2 text-xs font-semibold ${className}`}>{label}</span>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-1 min-w-0 break-words leading-5">{value}</dd>
    </div>
  );
}

function summarizeChecks(pullRequest: DashboardOutstandingPullRequest): string {
  if (pullRequest.checks.length === 0) return "No checks reported";
  const passing = pullRequest.checks.filter((check) => check.conclusion?.toUpperCase() === "SUCCESS").length;
  const failing = pullRequest.checks.length - passing;
  return failing > 0 ? `${passing} passing · ${failing} need attention` : `${passing} passing`;
}

function labelValue(value: string): string {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function errorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  return "error" in body && typeof body.error === "string" ? body.error : fallback;
}

