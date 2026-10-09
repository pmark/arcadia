"use client";

import { Gauge, TerminalSquare } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ApprovalQueue } from "../../components/approval-queue";
import { DashboardChrome } from "../../components/chrome";
import { EmptyState, ErrorState, RunCard, SessionCard } from "../../components/dashboard-ui";
import { ProductionControlPanel } from "../../components/production-control-panel";
import { useProductionControl } from "../../hooks/use-production-control";
import { useRuns } from "../../hooks/use-runs";

function CardSkeletons() {
  return <div className="grid min-w-0 gap-3 md:grid-cols-2" aria-hidden="true">{Array.from({ length: 2 }).map((_, index) => <div key={index} className="h-28 animate-pulse rounded-md border border-line bg-panel" />)}</div>;
}

/** Runs owns active work, production control and judgment; scripts live at /actions. */
export default function RunsPage() {
  const [approvalRefreshSignal, setApprovalRefreshSignal] = useState(0);
  return (
    <DashboardChrome title="Runs" refreshing={false} lastLoadedAt={null} onRefresh={() => setApprovalRefreshSignal((signal) => signal + 1)}>
      <ApprovalQueue refreshSignal={approvalRefreshSignal} />
      <Link href="/production" className="mb-3 flex items-center justify-between rounded-md border border-line bg-panel p-4 shadow-soft transition hover:border-steel">
        <span><span className="block font-semibold">Production</span><span className="mt-1 block text-sm text-muted">Production switch, the queue in batches, Launch, and live Session logs on one page.</span></span>
        <Gauge className="h-5 w-5 shrink-0 text-steel" aria-hidden="true" />
      </Link>
      <Link href="/actions" className="mb-6 flex items-center justify-between rounded-md border border-line bg-panel p-4 shadow-soft transition hover:border-steel">
        <span><span className="block font-semibold">Operator actions</span><span className="mt-1 block text-sm text-muted">Run a bounded script and stay on its result page.</span></span>
        <TerminalSquare className="h-5 w-5 shrink-0 text-steel" aria-hidden="true" />
      </Link>
      <OnDemandSection label="Production control"><ProductionControlSection /></OnDemandSection>
      <OnDemandSection label="Sessions and runs"><SessionsAndRunsSection /></OnDemandSection>
    </DashboardChrome>
  );
}

function OnDemandSection({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <section aria-label={label} className="mb-6"><button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="mb-3 inline-flex min-h-11 items-center text-sm font-semibold uppercase tracking-[0.14em] text-muted hover:text-ink">{open ? "▾" : "▸"} {label}</button>{open ? children : null}</section>;
}

function ProductionControlSection() {
  const control = useProductionControl();
  const [nextPushOpen, setNextPushOpen] = useState(false);
  return <ProductionControlPanel core={control.core} queue={control.queue} alerts={control.alerts} error={control.error} queueError={control.queueError} alertsError={control.alertsError} toggling={control.toggling} onToggle={control.toggle} nextPushOpen={nextPushOpen} onToggleNextPush={() => setNextPushOpen((open) => !open)} />;
}

function SessionsAndRunsSection() {
  const [historyOpen, setHistoryOpen] = useState(false);
  const runs = useRuns(historyOpen);
  const activeSessions = runs.data?.activeAgentSessions ?? [];
  const activeRuns = runs.data?.activeExecutionRuns ?? [];
  return <>
    {runs.error ? <ErrorState title="Runs unavailable" message={runs.stale ? `${runs.error} Showing the last known state.` : runs.error} /> : null}
    <div aria-label="Active now" aria-busy={runs.loading} className="mb-6">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-muted">Active now</h3>
      {runs.loading && !runs.data ? <CardSkeletons /> : activeSessions.length === 0 && activeRuns.length === 0 ? <EmptyState text="Nothing is currently prepared or running." /> : <div className="grid min-w-0 gap-3 md:grid-cols-2">{activeSessions.map((session) => <SessionCard key={session.id} session={session} />)}{activeRuns.filter((run) => !activeSessions.some((session) => session.actionId === run.workItemId)).map((run) => <RunCard key={run.id} run={run} />)}</div>}
    </div>
    <div aria-label="Recent history">
      <button type="button" aria-expanded={historyOpen} onClick={() => setHistoryOpen((open) => !open)} className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-muted hover:text-ink">{historyOpen ? "▾" : "▸"} Recent history</button>
      {historyOpen ? !runs.historyLoaded ? <CardSkeletons /> : runs.data && runs.data.recentRuns.length > 0 ? <div className="grid min-w-0 gap-3 md:grid-cols-2">{runs.data.recentRuns.map((run) => <RunCard key={run.id} run={run} />)}</div> : <EmptyState text="No runs yet." /> : null}
    </div>
  </>;
}
