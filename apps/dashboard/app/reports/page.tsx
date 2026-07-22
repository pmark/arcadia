"use client";

import { useCallback, useEffect, useState } from "react";
import { MobileShell } from "../../components/mobile-shell";
import { EmptyState, ErrorState, LoadingState, Section } from "../../components/dashboard-ui";
import type { ActivityReportResponse } from "../../lib/arcadia-cli";

type ReportKind = "daily" | "weekly";

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = Math.round(minutes % 60);
  return remainder === 0 ? `${hours}h` : `${hours}h${remainder}m`;
}

/**
 * Logging time from the UI. Two fields and a Log button, because anything
 * heavier and it will not get used on the days it matters most — which are
 * exactly the days worth recording.
 */
function LogTimeBox({ onLogged }: { onLogged: () => void }) {
  const [description, setDescription] = useState("");
  const [minutes, setMinutes] = useState("");
  const [at, setAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/time-log", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ minutes: Number(minutes), description, at: at || undefined })
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error ?? "Could not log that.");
        return;
      }
      setNote(`Logged ${formatMinutes(body.timeEntry.minutes)}.`);
      setDescription("");
      setMinutes("");
      setAt("");
      onLogged();
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      setBusy(false);
    }
  }, [minutes, description, at, onLogged]);

  const ready = description.trim().length > 0 && Number(minutes) > 0;

  return (
    <div className="grid min-w-0 gap-2 rounded-md border border-line bg-panel p-4 shadow-soft">
      <h2 className="text-sm font-semibold text-ink">Log some time</h2>
      <input
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="What did you do?"
        className="w-full min-w-0 rounded-md border border-line bg-panel p-2 text-sm text-ink"
      />
      <div className="flex gap-2">
        <input
          value={minutes}
          onChange={(event) => setMinutes(event.target.value)}
          inputMode="numeric"
          placeholder="Minutes"
          className="w-28 min-w-0 rounded-md border border-line bg-panel p-2 text-sm text-ink"
        />
        <input
          value={at}
          onChange={(event) => setAt(event.target.value)}
          placeholder="Started (09:00)"
          className="w-36 min-w-0 rounded-md border border-line bg-panel p-2 text-sm text-ink"
        />
        <button
          type="button"
          onClick={submit}
          disabled={busy || !ready}
          className="h-9 flex-1 rounded-md border border-moss bg-moss/10 text-sm font-semibold text-moss disabled:opacity-50"
        >
          {busy ? "Logging…" : "Log"}
        </button>
      </div>
      {note ? <p className="text-sm text-moss">✅ {note}</p> : null}
      {error ? <p className="text-sm text-clay">🚫 {error}</p> : null}
    </div>
  );
}

function ItemList({ items }: { items: Array<{ title: string; why: string; what?: string }> }) {
  return (
    <ul className="grid gap-1.5">
      {items.map((item, index) => (
        <li key={`${item.title}-${index}`} className="rounded-md border border-line bg-panel p-3 shadow-soft">
          <span className="block text-sm font-medium text-ink">{item.title}</span>
          <span className="block text-xs text-muted">{item.what ? `${item.what} — ${item.why}` : item.why}</span>
        </li>
      ))}
    </ul>
  );
}

export default function ReportsPage() {
  const [kind, setKind] = useState<ReportKind>("daily");
  const [report, setReport] = useState<ActivityReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((which: ReportKind) => {
    setLoading(true);
    setError(null);
    fetch(`/api/report?kind=${which}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((body) => {
        if (body?.error) setError(body.error);
        else setReport(body as ActivityReportResponse);
      })
      .catch((fetchError) => setError(fetchError instanceof Error ? fetchError.message : String(fetchError)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load(kind);
  }, [kind, load]);

  return (
    <MobileShell>
      <h1 className="mb-4 text-lg font-semibold">Reports</h1>

      <div className="mb-4 flex gap-2">
        {(["daily", "weekly"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setKind(option)}
            className={`h-8 rounded-md border px-3 text-xs font-semibold capitalize ${
              kind === option ? "border-moss text-moss" : "border-line text-ink"
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      <div className="grid min-w-0 gap-6">
        <LogTimeBox onLogged={() => load(kind)} />

        {error ? <ErrorState message={error} /> : null}
        {loading && !report ? <LoadingState /> : null}

        {report ? (
          <>
            <div className="rounded-md border border-line bg-panel p-4 shadow-soft">
              <p className="text-sm font-semibold text-ink">{report.headline}</p>
              <p className="mt-1 text-xs text-muted">
                {report.kind === "daily"
                  ? report.endLocalDate
                  : `${report.startLocalDate} → ${report.endLocalDate}`}
              </p>
            </div>

            <Section title="What moved">
              {report.progressed.length === 0 ? (
                <EmptyState text="Nothing recorded as moving yet." />
              ) : (
                <ItemList items={report.progressed} />
              )}
            </Section>

            {report.logged.byFocus.length > 0 ? (
              <Section title={`Where the time went (${formatMinutes(report.logged.totalMinutes)})`}>
                <div className="grid gap-1.5">
                  {report.logged.byFocus.map((total) => (
                    <div
                      key={total.focus}
                      className="flex items-center justify-between gap-3 rounded-md border border-line bg-panel p-3 shadow-soft"
                    >
                      <span className="min-w-0 truncate text-sm text-ink">{total.focus}</span>
                      <span className="shrink-0 text-sm tabular-nums text-muted">{formatMinutes(total.minutes)}</span>
                    </div>
                  ))}
                </div>
              </Section>
            ) : null}

            {report.urgent.length > 0 ? (
              <Section title="Urgent now">
                <ItemList items={report.urgent} />
              </Section>
            ) : null}

            {report.becomingUrgent.length > 0 ? (
              <Section title="Becoming urgent">
                <ItemList items={report.becomingUrgent} />
              </Section>
            ) : null}

            {report.backlog ? (
              <Section title="The shape of what's left">
                <p className="rounded-md border border-line bg-panel p-3 text-sm text-ink shadow-soft">
                  {formatMinutes(report.backlog.totalMinutes)} of sized work outstanding
                  {report.backlog.daysAtCapacity !== null
                    ? ` — about ${Math.round(report.backlog.daysAtCapacity * 2) / 2} days at your stated capacity.`
                    : "."}
                </p>
              </Section>
            ) : null}

            <p className="rounded-md border border-line bg-canvas p-4 text-sm italic text-ink">
              {report.encouragement.attribution
                ? `“${report.encouragement.line}” — ${report.encouragement.attribution}`
                : report.encouragement.line}
            </p>
          </>
        ) : null}
      </div>
    </MobileShell>
  );
}
