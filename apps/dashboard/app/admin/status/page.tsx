"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Gauge,
  Server,
  WifiOff,
  XCircle,
} from "lucide-react";
import { DashboardChrome } from "../../../components/chrome";
import { ErrorState, LoadingState, Section } from "../../../components/dashboard-ui";
import { useSystemStatus } from "../../../hooks/use-system-status";
import type { StatusCapability, StatusDependency, SystemStatus } from "../../../lib/system-status";

export default function AdminStatusPage() {
  const { data, loading, refreshing, error, lastLoadedAt, refresh } = useSystemStatus();

  return (
    <DashboardChrome
      title="System Status"
      subtitle="Readiness for normal operation, image generation, and background processing."
      refreshing={refreshing}
      lastLoadedAt={lastLoadedAt}
      onRefresh={() => void refresh()}
    >
      {error ? <ErrorState title="System Status unavailable" message={error} /> : null}
      {loading && !data ? <LoadingState /> : null}
      {data ? (
        <div className="grid min-w-0 gap-6">
          <OverallStatus status={data.overall.status} summary={data.overall.summary} />

          <section className="grid min-w-0 gap-3 sm:grid-cols-3" aria-label="Capability readiness">
            {data.capabilities.map((capability) => <CapabilityCard key={capability.id} capability={capability} />)}
          </section>

          <Section title="Dependencies">
            <div className="grid min-w-0 gap-3 lg:grid-cols-2">
              {data.dependencies.map((dependency) => <DependencyCard key={dependency.id} dependency={dependency} />)}
            </div>
          </Section>

          <p className="text-xs text-muted">
            Checked {formatTimestamp(data.checkedAt)}. Status is collected from local reachability probes, worker heartbeats, and durable Intelligence job records.
          </p>
        </div>
      ) : null}
    </DashboardChrome>
  );
}

function OverallStatus({ status, summary }: { status: SystemStatus; summary: string }) {
  const Icon = statusIcon(status);
  return (
    <section className={`rounded-md border p-5 shadow-soft sm:p-6 ${statusPanelClass(status)}`} aria-labelledby="overall-status-heading">
      <div className="flex min-w-0 items-start gap-4">
        <Icon className="mt-1 h-8 w-8 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide">Overall Status</p>
          <h2 id="overall-status-heading" className="mt-1 text-3xl font-semibold leading-9">{labelFor(status)}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6">{summary}</p>
        </div>
      </div>
    </section>
  );
}

function CapabilityCard({ capability }: { capability: StatusCapability }) {
  return (
    <article className="min-w-0 rounded-md border border-line bg-panel p-4 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Gauge className={`h-4 w-4 shrink-0 ${statusTextClass(capability.status)}`} aria-hidden="true" />
          <h3 className="min-w-0 break-words text-sm font-semibold">{capability.label}</h3>
        </div>
        <StatusChip status={capability.status} />
      </div>
      <p className="mt-3 text-sm leading-5 text-muted">{capability.summary}</p>
    </article>
  );
}

function DependencyCard({ dependency }: { dependency: StatusDependency }) {
  return (
    <article className="min-w-0 rounded-md border border-line bg-panel p-4 shadow-soft sm:p-5">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Server className={`mt-1 h-5 w-5 shrink-0 ${statusTextClass(dependency.status)}`} aria-hidden="true" />
          <div className="min-w-0">
            <h3 className="break-words text-base font-semibold">{dependency.name}</h3>
            <p className="mt-1 text-xs font-medium uppercase tracking-wide text-muted">
              {dependency.required ? "Required dependency" : "Optional dependency"}
            </p>
          </div>
        </div>
        <StatusChip status={dependency.status} />
      </div>
      <p className="mt-4 text-sm leading-5 text-muted">{dependency.summary}</p>
      <dl className="mt-4 grid min-w-0 gap-3 text-sm sm:grid-cols-2">
        {dependency.port !== null ? <Detail label="Port" value={String(dependency.port)} /> : null}
        {dependency.url ? <Detail label="URL" value={dependency.url} breakAll /> : null}
        {dependency.reachability !== "not-applicable" ? <Detail label="Reachability" value={labelFor(dependency.reachability)} /> : null}
        {dependency.latencyMs !== null ? <Detail label="Response latency" value={`${dependency.latencyMs} ms`} /> : null}
        {dependency.version ? <Detail label="Version / build" value={dependency.version} /> : null}
        {dependency.running !== null ? <Detail label="State" value={dependency.running ? "Running" : "Stopped"} /> : null}
        {dependency.connectionState ? <Detail label="Connection" value={labelFor(dependency.connectionState)} /> : null}
        {dependency.lastHeartbeat ? <Detail label="Last heartbeat" value={formatTimestamp(dependency.lastHeartbeat)} /> : null}
        {dependency.lastSuccessfulRequest ? <Detail label="Last successful request" value={formatTimestamp(dependency.lastSuccessfulRequest)} /> : null}
        {dependency.lastEvent ? <Detail label="Last event" value={formatTimestamp(dependency.lastEvent)} /> : null}
        {dependency.queueCount !== null ? <Detail label="Queued jobs" value={String(dependency.queueCount)} /> : null}
        {dependency.activeJobCount !== null ? <Detail label="Active jobs" value={String(dependency.activeJobCount)} /> : null}
        {dependency.failedJobCount !== null ? <Detail label="Failed jobs" value={String(dependency.failedJobCount)} /> : null}
      </dl>
    </article>
  );
}

function Detail({ label, value, breakAll = false }: { label: string; value: string; breakAll?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className={`mt-1 min-w-0 text-sm text-ink ${breakAll ? "break-all" : "break-words"}`}>{value}</dd>
    </div>
  );
}

function StatusChip({ status }: { status: SystemStatus }) {
  return <span className={`inline-flex h-7 shrink-0 items-center rounded-md border px-2 text-xs font-semibold ${statusChipClass(status)}`}>{labelFor(status)}</span>;
}

function statusIcon(status: SystemStatus) {
  if (status === "healthy") return CheckCircle2;
  if (status === "offline") return WifiOff;
  if (status === "blocked") return XCircle;
  return AlertTriangle;
}

function statusPanelClass(status: SystemStatus): string {
  if (status === "healthy") return "border-moss/40 bg-moss/10 text-moss";
  if (status === "offline" || status === "blocked") return "border-clay/40 bg-clay/10 text-clay";
  return "border-gold/40 bg-gold/10 text-gold";
}

function statusChipClass(status: SystemStatus): string {
  if (status === "healthy") return "border-moss/30 bg-moss/10 text-moss";
  if (status === "offline" || status === "blocked") return "border-clay/30 bg-clay/10 text-clay";
  return "border-gold/30 bg-gold/10 text-gold";
}

function statusTextClass(status: SystemStatus): string {
  if (status === "healthy") return "text-moss";
  if (status === "offline" || status === "blocked") return "text-clay";
  return "text-gold";
}

function labelFor(value: string): string {
  return value.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" }).format(date);
}
