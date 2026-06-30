"use client";

import type { IntelligenceArtifactRecord, IntelligenceJob } from "@pmark/arcadia/intelligence/contracts";
import { categorizeFailure, failureCategoryLabel } from "../../lib/intelligence-failure";

const STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  blocked: "Blocked",
};

const STATUS_CLASS: Record<string, string> = {
  queued: "border-gold/30 bg-gold/10 text-gold",
  running: "border-gold/30 bg-gold/10 text-gold",
  completed: "border-moss/30 bg-moss/10 text-moss",
  failed: "border-clay/30 bg-clay/10 text-clay",
  blocked: "border-clay/30 bg-clay/10 text-clay",
};

export function JobPanel({
  job,
  pollingStopped,
  onRefresh,
}: {
  job: IntelligenceJob;
  pollingStopped: boolean;
  onRefresh: () => void;
}) {
  const elapsedMs = elapsed(job);

  return (
    <section className="grid gap-3 rounded-md border border-line bg-panel p-4 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs text-muted">{job.id}</p>
          <p className="mt-1 text-sm text-ink">{job.request.capability} · {job.request.execution} · {job.request.profile}</p>
        </div>
        <span className={`rounded-md border px-3 py-1 text-sm font-semibold ${STATUS_CLASS[job.status] ?? ""}`}>
          {STATUS_LABEL[job.status] ?? job.status}
          {elapsedMs !== null ? <span className="ml-2 text-xs font-normal opacity-80">({formatElapsed(elapsedMs)})</span> : null}
        </span>
      </div>

      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <Field label="Submitted">{formatDateTime(job.createdAt)}</Field>
        <Field label="Resolved route">{job.selectedRoute ?? job.usage?.routeId ?? "Not yet resolved"}</Field>
        {job.usage?.durationMs !== undefined ? <Field label="Execution time">{job.usage.durationMs} ms</Field> : null}
        {job.retryCount > 0 ? <Field label="Retries">{job.retryCount}</Field> : null}
      </dl>

      {pollingStopped ? (
        <div className="rounded-md border border-gold/30 bg-gold/10 p-3 text-sm text-gold">
          Stopped auto-refreshing after 10 minutes.{" "}
          <button type="button" onClick={onRefresh} className="font-semibold underline">
            Refresh now
          </button>
        </div>
      ) : null}

      {job.status === "failed" || job.status === "blocked" ? <FailurePanel job={job} /> : null}
      {job.status === "completed" ? <ResultPanel job={job} /> : null}
    </section>
  );
}

function FailurePanel({ job }: { job: IntelligenceJob }) {
  const category = categorizeFailure(job.error?.code);
  return (
    <div className="rounded-md border border-clay/30 bg-clay/10 p-3 text-sm text-clay">
      <p className="font-semibold">{failureCategoryLabel(category)}</p>
      <p className="mt-1">{job.error?.message ?? "No error message recorded."}</p>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide opacity-80">Diagnostic details</summary>
        <pre className="mt-2 overflow-auto rounded-md border border-clay/20 bg-canvas p-2 text-xs text-ink">
          {JSON.stringify({ error: job.error, status: job.status }, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function ResultPanel({ job }: { job: IntelligenceJob }) {
  if (job.request.capability === "image.generate") {
    return <ImageResult job={job} />;
  }
  return <TextResult job={job} />;
}

function TextResult({ job }: { job: IntelligenceJob }) {
  const result = job.result as Record<string, unknown> | null;
  const text = typeof result?.text === "string" ? result.text : JSON.stringify(result, null, 2);

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">
          Result {job.validation ? `· schema ${job.request.outputContract.schemaId} (${job.validation.passed ? "valid" : "invalid"})` : ""}
        </span>
        <button
          type="button"
          onClick={() => void navigator.clipboard.writeText(text)}
          className="rounded-md border border-steel/30 bg-steel/10 px-2 py-1 text-xs font-semibold text-steel"
        >
          Copy
        </button>
      </div>
      <pre className="max-h-72 overflow-auto rounded-md border border-line bg-canvas p-3 text-xs text-ink">{text}</pre>
    </div>
  );
}

function ImageResult({ job }: { job: IntelligenceJob }) {
  const result = job.result as { artifacts?: IntelligenceArtifactRecord[]; warnings?: string[] } | null;
  const artifacts = result?.artifacts ?? [];

  return (
    <div className="grid gap-3">
      {result?.warnings?.length ? (
        <div className="rounded-md border border-gold/30 bg-gold/10 p-2 text-xs text-gold">{result.warnings.join("; ")}</div>
      ) : null}
      {artifacts.length === 0 ? (
        <p className="text-sm text-muted">Job completed but returned no artifacts.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {artifacts.map((artifact) => (
            <figure key={artifact.id} className="rounded-md border border-line p-2">
              <img
                src={`/api/admin-intelligence/artifacts/${encodeURIComponent(artifact.id)}`}
                alt={`Generated artifact ${artifact.id}`}
                className="w-full rounded-md"
              />
              <figcaption className="mt-2 grid gap-0.5 text-xs text-muted">
                <span className="font-mono">{artifact.id}</span>
                <span>{artifact.mimeType}{artifact.dimensions ? ` · ${artifact.dimensions.width}×${artifact.dimensions.height}` : ""}</span>
                <span>sha256 {artifact.sha256.slice(0, 12)}…</span>
                <span>{job.completedAt ? formatDateTime(job.completedAt) : ""}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 break-words font-mono text-xs text-ink">{children}</dd>
    </div>
  );
}

function elapsed(job: IntelligenceJob): number | null {
  if (job.status !== "queued" && job.status !== "running") return null;
  const start = job.startedAt ?? job.createdAt;
  return Date.now() - Date.parse(start);
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}
