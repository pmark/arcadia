"use client";

import { useCallback, useEffect, useState } from "react";
import { CircleAlert, CircleCheck, CircleHelp, ExternalLink, GitPullRequest, Settings2 } from "lucide-react";
import { DashboardChrome } from "../../components/chrome";
import { EmptyState, ErrorState, LoadingState, Metric, Section } from "../../components/dashboard-ui";
import type { QaPrimaryAction, QaQueueRow, QaQueueSnapshot } from "../../lib/types";

export default function QaPage() {
  const [data, setData] = useState<QaQueueSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/qa", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error ?? "The QA queue is unavailable.");
      setData(body as QaQueueSnapshot);
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
      title="Arcadia QA"
      subtitle={
        data
          ? `${data.counts.candidates} Candidate${data.counts.candidates === 1 ? "" : "s"}, ${data.counts.awaitingSignOff} awaiting your judgement`
          : "Every Candidate waiting on operator judgement."
      }
      refreshing={refreshing}
      lastLoadedAt={lastLoadedAt}
      onRefresh={() => void refresh()}
    >
      {error ? <ErrorState title="QA queue unavailable" message={error} /> : null}
      {loading && !data ? <LoadingState /> : null}
      {data ? <QaBody data={data} onChanged={() => void refresh()} /> : null}
    </DashboardChrome>
  );
}

function QaBody({ data, onChanged }: { data: QaQueueSnapshot; onChanged: () => void }) {
  if (data.projects.length === 0) {
    return (
      <EmptyState text="No Project declares a proof target yet. Declare one with `arcadia qa target set` and it appears here." />
    );
  }

  return (
    <div className="grid min-w-0 gap-6">
      <section className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-5" aria-label="QA queue totals">
        <Metric label="Candidates" value={data.counts.candidates} tone="steel" />
        <Metric label="Awaiting judgement" value={data.counts.awaitingSignOff} tone="steel" />
        <Metric label="Failing" value={data.counts.failing} tone="steel" />
        <Metric label="Unconfigured" value={data.counts.unconfigured} tone="steel" />
        <Metric label="Stable" value={data.counts.stable} tone="steel" />
      </section>

      {data.projects.map((group) => (
        <Section key={group.projectId} title={group.projectName}>
          <div className="grid min-w-0 gap-3">
            {group.candidates.map((row) => (
              <TargetCard key={row.targetId} row={row} onChanged={onChanged} />
            ))}
            {group.stable.map((row) => (
              <TargetCard key={row.targetId} row={row} onChanged={onChanged} />
            ))}
          </div>
        </Section>
      ))}
    </div>
  );
}

const ACTION_LABEL: Record<QaPrimaryAction, string> = {
  "configure-target": "Configure target",
  "test-candidate": "Test Candidate",
  "signed-off": "Signed off",
  "show-stable": "Show Stable",
  "inspect-failure": "Inspect failure",
  "follow-up": "Follow up"
};

function TargetCard({ row, onChanged }: { row: QaQueueRow; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const candidate = row.kind === "candidate";

  const signOff = async (verdict: "pass" | "fail" | "follow-up") => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/qa-sign-off", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targetId: row.targetId,
          verdict,
          revision: row.sourceRevision,
          note: note.trim() || null
        })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error ?? "Recording the verdict failed.");
      setMessage(body.message as string);
      setNote("");
      onChanged();
    } catch (signOffError) {
      setMessage(signOffError instanceof Error ? signOffError.message : String(signOffError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="min-w-0 rounded-lg border border-line bg-panel p-4">
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {/* Candidate and Stable must never be mistaken for each other; the
                whole contract rests on a broken Candidate not taking Stable away. */}
            <span
              className={`rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                candidate ? "bg-amber-500/15 text-amber-300" : "bg-emerald-500/15 text-emerald-300"
              }`}
            >
              {candidate ? "Candidate" : "Stable"}
            </span>
            <h3 className="truncate text-sm font-semibold text-ink">{row.label}</h3>
          </div>
          <p className="mt-1 text-xs text-ink/70">{row.statusLine}</p>
        </div>
        <span className="shrink-0 rounded border border-line px-2 py-1 text-[11px] text-ink/70">
          {ACTION_LABEL[row.primaryAction]}
        </span>
      </header>

      <dl className="mt-3 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
        <Field label="Revision" value={row.sourceRevision ?? "Unknown"} />
        <Field label="Evidence" value={FRESHNESS_LABEL[row.evidenceFreshness]} />
        <Field label="Reachability" value={HEALTH_LABEL[row.healthState]} />
        <Field
          label="Last verified"
          value={row.healthCheckedAt ?? "Never recorded"}
        />
      </dl>

      {row.changeSummary ? <p className="mt-3 text-xs text-ink/80">{row.changeSummary}</p> : null}
      {row.testProcedure ? (
        <p className="mt-2 text-xs text-ink/70">
          <span className="font-semibold text-ink/80">How to test: </span>
          {row.testProcedure}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/* One primary action. When no URL is configured we say so rather than
            rendering a link that would imply a demo exists. */}
        {row.testable ? (
          <a
            href={row.url!}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-xs font-semibold text-canvas"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            {candidate ? "Test Candidate" : "Show Stable"}
          </a>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-line px-3 py-1.5 text-xs text-ink/60">
            <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
            No target configured
          </span>
        )}
        {row.pullRequestUrl ? (
          <a
            href={row.pullRequestUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs text-ink/80"
          >
            <GitPullRequest className="h-3.5 w-3.5" aria-hidden="true" />
            Pull request
          </a>
        ) : null}
      </div>

      {candidate ? (
        <div className="mt-4 border-t border-line pt-3">
          <label className="block text-xs text-ink/70" htmlFor={`note-${row.targetId}`}>
            Optional note
          </label>
          <input
            id={`note-${row.targetId}`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="What you saw, in a sentence"
            className="mt-1 w-full rounded-md border border-line bg-canvas px-2 py-1.5 text-xs text-ink"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <VerdictButton icon={CircleCheck} label="Pass" disabled={busy} onClick={() => void signOff("pass")} />
            <VerdictButton icon={CircleAlert} label="Fail" disabled={busy} onClick={() => void signOff("fail")} />
            <VerdictButton icon={CircleHelp} label="Needs follow-up" disabled={busy} onClick={() => void signOff("follow-up")} />
          </div>
          <p className="mt-2 text-[11px] text-ink/50">
            A verdict is evidence, not authorization. Recording one never merges, deploys, promotes this Candidate to
            Stable, or marks anything delivered.
          </p>
          {message ? <p className="mt-2 text-xs text-ink/80">{message}</p> : null}
        </div>
      ) : null}
    </article>
  );
}

const FRESHNESS_LABEL: Record<QaQueueRow["evidenceFreshness"], string> = {
  current: "Matches this revision",
  stale: "Older revision only",
  none: "None recorded",
  "revision-unknown": "Cannot be tied to a revision"
};

const HEALTH_LABEL: Record<QaQueueRow["healthState"], string> = {
  unverified: "Not verified",
  reachable: "Recorded reachable",
  unreachable: "Recorded unreachable"
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="inline text-ink/50">{label}: </dt>
      <dd className="inline break-words text-ink/80">{value}</dd>
    </div>
  );
}

function VerdictButton({
  icon: Icon,
  label,
  disabled,
  onClick
}: {
  icon: typeof CircleCheck;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs text-ink/80 disabled:opacity-50"
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </button>
  );
}
