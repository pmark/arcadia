"use client";

import { useState } from "react";
import { CircleAlert, Clock3, GitPullRequest } from "lucide-react";
import { PullRequestLinkAudio } from "../../../components/pull-request-link-audio";
import { PullRequestAudio } from "../../../components/pull-request-audio";
import { PullRequestInventorySkeleton } from "../../../components/pull-request-inventory-skeleton";
import { PullRequestDetailsPanel } from "../../../components/pull-request-details";
import { DashboardChrome } from "../../../components/chrome";
import { EmptyState, ErrorState, Metric, Section } from "../../../components/dashboard-ui";
import { sortPullRequestsNewestFirst } from "../../../lib/pull-request-order";
import { usePullRequestInventory } from "../../../hooks/use-pull-request-inventory";
import type {
  DashboardOutstandingPullRequest,
  DashboardOutstandingPullRequests,
  PullRequestReadiness
} from "../../../lib/types";

export default function AdminPullRequestsPage() {
  const [readerRevision, setReaderRevision] = useState(0);
  const { data, checkedAt, error, loading, refreshing, stale, incomplete, retainedProjectIds, refresh } = usePullRequestInventory();

  return (
    <DashboardChrome
      title="Outstanding PRs"
      subtitle={data ? `${data.counts.total} open across ${data.projectsScanned} Projects` : "Across every configured Project repository."}
      refreshing={refreshing}
      lastLoadedAt={checkedAt ? new Date(checkedAt) : null}
      onRefresh={() => { setReaderRevision(value => value + 1); void refresh(); }}
    >
      <InventoryStatus checkedAt={checkedAt} stale={stale} incomplete={incomplete} refreshing={refreshing} />
      {error ? (
        <div className="grid gap-3">
          <ErrorState
            title={data ? "Inventory refresh failed" : "Outstanding PRs unavailable"}
            message={data ? `${error} Showing the last successful inventory.` : error}
          />
          <button type="button" onClick={() => { void refresh(); }} className="min-h-11 justify-self-start rounded-md border border-line bg-panel px-4 py-2 text-sm font-semibold">
            Retry inventory refresh
          </button>
        </div>
      ) : null}
      {loading && !data ? <PullRequestInventorySkeleton /> : null}
      <PullRequestLinkAudio refreshToken={readerRevision} />
      {data ? <PullRequestBody data={data} retainedProjectIds={retainedProjectIds} /> : null}
    </DashboardChrome>
  );
}

function InventoryStatus({ checkedAt, stale, incomplete, refreshing }: { checkedAt: string | null; stale: boolean; incomplete: boolean; refreshing: boolean }) {
  if (!checkedAt) return null;
  const label = refreshing
    ? `Showing the ${incomplete ? "incomplete " : ""}inventory checked ${formatDate(checkedAt)} while a refresh runs.`
    : incomplete
      ? `Inventory checked ${formatDate(checkedAt)}; one or more Project scans were incomplete.`
      : stale
      ? `Showing stale inventory checked ${formatDate(checkedAt)}.`
      : `Inventory checked ${formatDate(checkedAt)}.`;
  return <p className={`text-xs ${stale ? "text-gold" : "text-muted"}`} role="status" aria-live="polite">{label}</p>;
}

function PullRequestBody({ data, retainedProjectIds }: { data: DashboardOutstandingPullRequests; retainedProjectIds: string[] }) {
  return (
    <div className="grid min-w-0 gap-6">
      <section className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Pull-request CI inventory">
        <Metric label="Open" value={data.counts.total} tone="steel" />
        <Metric label="Drafts" value={data.counts.drafts} tone="gold" />
        <Metric label="Checks need attention" value={data.counts.checksFailing + data.counts.checksPending} tone="gold" />
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
                {retainedProjectIds.includes(entry.projectId)
                  ? " Showing last-known cards for this Project. Repository details were not fully reverified; these cards are incomplete display data and not merge authority."
                  : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Section title="Open pull requests">
        {data.pullRequests.length === 0 ? (
          <EmptyState text={data.errors.length > 0
            ? `No open pull requests found in the repositories scanned successfully. ${data.errors.length} Project scan${data.errors.length === 1 ? " was" : "s were"} incomplete.`
            : "No open pull requests found across the configured Project repositories."} />
        ) : (
          <div className="grid min-w-0 gap-3">
            {sortPullRequestsNewestFirst(data.pullRequests).map((pullRequest) => (
              <PullRequestCard key={`${pullRequest.repository}:${pullRequest.number}`} pullRequest={pullRequest} />
            ))}
          </div>
        )}
      </Section>

      <p className="text-xs text-muted">
        Read-only CI inventory, refreshed about once a minute while visible. Load PR details or its TLDR when needed. CI status does not verify merge authority or approve, merge, or modify a PR.
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
          <p className="mt-3 text-sm">CI: {checkCounts}</p>
          <PullRequestDetailsPanel key={`details:${pullRequest.repository}:${pullRequest.number}:${pullRequest.updatedAt}`} repository={pullRequest.repository} number={pullRequest.number} />
          <PullRequestAudio key={`audio:${pullRequest.repository}:${pullRequest.number}:${pullRequest.updatedAt}`} repository={pullRequest.repository} number={pullRequest.number} />
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted">
            {pullRequest.isDraft ? <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" aria-hidden="true" /> Draft</span> : null}

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

function summarizeChecks(pullRequest: DashboardOutstandingPullRequest): string {
  if (pullRequest.checks.length === 0) return "No checks reported";
  const passing = pullRequest.checks.filter((check) => check.conclusion?.toUpperCase() === "SUCCESS").length;
  const failing = pullRequest.checks.length - passing;
  return failing > 0 ? `${passing} passing · ${failing} need attention` : `${passing} passing`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
