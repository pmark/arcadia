"use client";

import type { IntelligenceJob } from "@pmark/arcadia/intelligence/contracts";

const STATUS_CLASS: Record<string, string> = {
  queued: "text-gold",
  running: "text-gold",
  completed: "text-moss",
  failed: "text-clay",
  blocked: "text-clay",
};

export function RecentHistory({
  jobs,
  loading,
  error,
  onSelect,
}: {
  jobs: IntelligenceJob[];
  loading: boolean;
  error: string | null;
  onSelect: (jobId: string) => void;
}) {
  return (
    <section className="rounded-md border border-line bg-panel p-4 shadow-soft">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Recent test runs</h2>
      {error ? <p className="mt-2 text-sm text-clay">{error}</p> : null}
      {loading ? <p className="mt-2 text-sm text-muted">Loading…</p> : null}
      {!loading && jobs.length === 0 ? <p className="mt-2 text-sm text-muted">No admin test runs yet.</p> : null}
      <ul className="mt-2 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5">
        {jobs.map((job) => (
          <li key={job.id}>
            <button
              type="button"
              onClick={() => onSelect(job.id)}
              className="flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-line px-3 py-2 text-left text-sm transition hover:border-steel"
            >
              <span className="min-w-0 truncate">
                <span className="font-mono text-xs text-muted">{formatClock(job.createdAt)}</span>{" "}
                {job.request.capability} · {previewLabel(job)}
              </span>
              <span className={`shrink-0 text-xs font-semibold ${STATUS_CLASS[job.status] ?? ""}`}>{job.status}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function previewLabel(job: IntelligenceJob): string {
  const input = job.request.input as { prompt?: string } | null;
  const prompt = typeof input?.prompt === "string" ? input.prompt : "";
  return prompt.length > 60 ? `${prompt.slice(0, 60)}…` : prompt || job.selectedRoute || job.request.profile;
}

function formatClock(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
