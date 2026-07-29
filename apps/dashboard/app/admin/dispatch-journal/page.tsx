"use client";

import { CheckCircle2, CircleSlash, HelpCircle } from "lucide-react";
import { DashboardChrome } from "../../../components/chrome";
import { EmptyState, ErrorState, LoadingState, Metric, Section } from "../../../components/dashboard-ui";
import { useDispatchJournal } from "../../../hooks/use-dispatch-journal";
import type { DispatchJournalEvent, DispatchJournalResponse } from "../../../lib/arcadia-cli";

export default function AdminDispatchJournalPage() {
  const { data, loading, refreshing, error, lastLoadedAt, refresh } = useDispatchJournal();

  return (
    <DashboardChrome
      title="Dispatch Journal"
      subtitle="How often work was refused by the managed documents, and on which field."
      refreshing={refreshing}
      lastLoadedAt={lastLoadedAt}
      onRefresh={() => void refresh()}
    >
      {error ? <ErrorState title="Dispatch journal unavailable" message={error} /> : null}
      {loading && !data ? <LoadingState /> : null}
      {data ? <JournalBody data={data} /> : null}
    </DashboardChrome>
  );
}

function JournalBody({ data }: { data: DispatchJournalResponse }) {
  const { summary, events } = data;

  if (summary.total === 0) {
    return <EmptyState text="No dispatch resolutions recorded yet. Run arcadia next to start the journal." />;
  }

  return (
    <div className="grid min-w-0 gap-6">
      <section className="grid min-w-0 gap-3 sm:grid-cols-3" aria-label="Dispatch outcomes">
        <Metric label="Resolutions" value={summary.total} tone="steel" />
        <Metric label="Dispatchable" value={summary.dispatchable} tone="green" />
        <Metric label="Blocked" value={summary.blocked} tone={summary.blocked > 0 ? "clay" : "neutral"} />
      </section>

      <Section title="Blocked on">
        {summary.byField.length === 0 ? (
          <EmptyState text="Nothing has blocked a dispatch." />
        ) : (
          <ul className="grid min-w-0 gap-2">
            {summary.byField.map((entry) => (
              <li
                key={entry.field}
                className="flex min-w-0 flex-wrap items-baseline justify-between gap-2 rounded-md border border-line bg-panel px-3 py-2 shadow-soft"
              >
                <code className="min-w-0 break-all text-sm text-ink">{entry.field}</code>
                <span className="text-sm text-muted">
                  {entry.resolutions} of {summary.total} (
                  {Math.round((entry.resolutions / summary.total) * 100)}%)
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Recent resolutions">
        <ul className="grid min-w-0 gap-2">
          {events.map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
        </ul>
      </Section>

      <p className="text-xs text-muted">
        A field that blocks a large share of resolutions is either a rule worth relaxing or a habit worth
        fixing. Fields are counted once per resolution, so a plan with many dependencies does not outrank a
        rule that quietly blocks everything.
      </p>
    </div>
  );
}

function EventRow({ event }: { event: DispatchJournalEvent }) {
  const verdict = event.operatorQuestion
    ? { label: "Question", Icon: HelpCircle, tone: "text-gold" }
    : event.dispatchable
      ? { label: "Dispatchable", Icon: CheckCircle2, tone: "text-moss" }
      : { label: `Blocked (${event.blockerCount})`, Icon: CircleSlash, tone: "text-clay" };
  const subject =
    [event.projectSlug, event.planSlug, event.actionId].filter(Boolean).join(" / ") || "unresolved";

  return (
    <li className="grid min-w-0 gap-1 rounded-md border border-line bg-panel px-3 py-2 shadow-soft">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <verdict.Icon className={`h-4 w-4 shrink-0 ${verdict.tone}`} aria-hidden="true" />
        <span className={`text-sm font-semibold ${verdict.tone}`}>{verdict.label}</span>
        <code className="text-xs text-muted">{event.command}</code>
      </div>
      <div className="min-w-0 break-words text-sm text-ink">{subject}</div>
      {event.blockerFields.length > 0 ? (
        <div className="min-w-0 break-all text-xs text-muted">{event.blockerFields.join(", ")}</div>
      ) : null}
      <time className="text-xs text-muted" dateTime={event.occurredAt}>
        {new Date(event.occurredAt).toLocaleString()}
      </time>
    </li>
  );
}
