import { RefreshCw } from "lucide-react";
import type { CodingAgentAvailability, IntelligenceUsageSummary } from "../../lib/intelligence-types";

const AVAILABILITY: Record<CodingAgentAvailability, { label: string; className: string }> = {
  available: { label: "Available", className: "border-moss/30 bg-moss/10 text-moss" },
  unknown: { label: "Quota unknown", className: "border-gold/30 bg-gold/10 text-gold" },
  usage_limited: { label: "Usage limited", className: "border-clay/30 bg-clay/10 text-clay" },
  budget_limited: { label: "Budget limited", className: "border-clay/30 bg-clay/10 text-clay" },
};

export function UsageSummary({
  summary,
  loading,
  refreshing,
  error,
  onRefresh,
}: {
  summary: IntelligenceUsageSummary | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  return (
    <section className="grid min-w-0 gap-4 rounded-md border border-line bg-panel p-4 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Usage & availability</h2>
          <p className="mt-1 text-sm text-muted">
            Reported current-day Intelligence usage and local coding-agent availability. Provider account quotas are shown only when reported.
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading || refreshing}
          className="inline-flex min-h-10 items-center gap-2 rounded-md border border-line bg-canvas px-3 text-sm font-medium text-ink shadow-soft transition hover:border-steel hover:text-steel disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={refreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden="true" />
          {refreshing ? "Refreshing…" : "Refresh usage"}
        </button>
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
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">{agent.provider}</p>
                    <p className="mt-0.5 break-words font-mono text-xs text-muted">{agent.profiles.join(" · ")}</p>
                  </div>
                  <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${availability.className}`}>{availability.label}</span>
                </div>
                {agent.context ? (
                  <div className="mt-3 grid gap-1 text-xs text-muted">
                    <p><span className="font-semibold text-ink">Context:</span> {formatCount(agent.context.inputTokens)} in · {formatCount(agent.context.outputTokens)} out · {formatPercent(agent.context.usedPercentage)} used</p>
                    <UsageBar usedPercentage={agent.context.usedPercentage} />
                  </div>
                ) : null}
                {agent.rateLimits.length > 0 ? (
                  <div className="mt-3 grid gap-2">
                    {agent.rateLimits.map((limit) => (
                      <div key={limit.label} className="grid gap-1">
                        <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-muted">
                          <span>{limit.label} limit: {formatPercent(limit.usedPercentage)} used</span>
                          <span>{limit.resetsAt ? `Resets ${formatReset(limit.resetsAt)}` : "Reset unknown"}</span>
                        </div>
                        <UsageBar usedPercentage={limit.usedPercentage} />
                      </div>
                    ))}
                  </div>
                ) : null}
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

function UsageBar({ usedPercentage }: { usedPercentage: number }) {
  const width = Math.max(0, Math.min(100, usedPercentage));
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-line" aria-label={`${formatPercent(usedPercentage)} used`}>
      <div className={`h-full rounded-full ${width >= 90 ? "bg-clay" : "bg-moss"}`} style={{ width: `${width}%` }} />
    </div>
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

function formatPercent(value: number): string {
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)}%`;
}

function formatReset(value: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(value));
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
