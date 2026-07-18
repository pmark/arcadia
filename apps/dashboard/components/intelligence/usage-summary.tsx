import type { CodingAgentAvailability, IntelligenceUsageSummary } from "../../lib/intelligence-types";

const AVAILABILITY: Record<CodingAgentAvailability, { label: string; className: string }> = {
  unknown: { label: "Quota unknown", className: "border-gold/30 bg-gold/10 text-gold" },
  usage_limited: { label: "Usage limited", className: "border-clay/30 bg-clay/10 text-clay" },
  budget_limited: { label: "Budget limited", className: "border-clay/30 bg-clay/10 text-clay" },
};

export function UsageSummary({
  summary,
  loading,
  error,
}: {
  summary: IntelligenceUsageSummary | null;
  loading: boolean;
  error: string | null;
}) {
  return (
    <section className="grid gap-4 rounded-md border border-line bg-panel p-4 shadow-soft">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Usage & availability</h2>
        <p className="mt-1 text-sm text-muted">
          Reported current-day Intelligence usage and local coding-agent availability. Provider account quotas are shown only when reported.
        </p>
      </div>

      {loading ? <p className="text-sm text-muted">Loading usage…</p> : null}
      {error ? <p className="text-sm text-clay">{error}</p> : null}
      {summary ? <UsageDetails summary={summary} /> : null}
    </section>
  );
}

function UsageDetails({ summary }: { summary: IntelligenceUsageSummary }) {
  return (
    <>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Jobs today" value={String(summary.jobs.total)} detail={`${summary.jobs.completed} completed`} />
        <Metric label="Reported tokens" value={`${formatCount(summary.usage.inputTokens)} in · ${formatCount(summary.usage.outputTokens)} out`} detail={`${summary.jobs.withReportedUsage} of ${summary.jobs.total} jobs reported usage`} />
        <Metric label="Measured cost" value={formatUsd(summary.usage.measuredCostUsd)} detail={`Estimated ${formatUsd(summary.usage.estimatedCostUsd)}`} />
        <Metric label="Reported run time" value={formatDuration(summary.usage.durationMs)} detail={formatDateTime(summary.generatedAt)} />
      </dl>

      <div className="grid gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Coding-agent availability</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {summary.codingAgents.map((agent) => {
            const availability = AVAILABILITY[agent.availability];
            return (
              <div key={agent.provider} className="rounded-md border border-line bg-canvas p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-ink">{agent.provider}</p>
                    <p className="mt-0.5 font-mono text-xs text-muted">{agent.profiles.join(" · ")}</p>
                  </div>
                  <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${availability.className}`}>{availability.label}</span>
                </div>
                <p className="mt-2 text-xs text-muted">{agent.telemetry}</p>
              </div>
            );
          })}
        </div>
      </div>

      {summary.providers.length > 0 ? (
        <p className="text-xs text-muted">
          Reported providers: {summary.providers.map((provider) => `${provider.provider} (${provider.jobs} job${provider.jobs === 1 ? "" : "s"})`).join(", ")}.
        </p>
      ) : null}
    </>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-ink">{value}</dd>
      <p className="mt-0.5 text-xs text-muted">{detail}</p>
    </div>
  );
}

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(value);
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  const seconds = Math.round(milliseconds / 1_000);
  return seconds < 60 ? `${seconds} sec` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function formatDateTime(value: string): string {
  return `Updated ${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value))}`;
}
