"use client";

import { AlertTriangle, ExternalLink } from "lucide-react";
import { StatusBadge } from "./dashboard-ui";
import type { ProductionAlertsData, ProductionCoreData, ProductionQueueData } from "../hooks/use-production-control";
import type { ScheduleBatchLane, ScheduleBatchStop } from "../lib/arcadia-cli";

interface ProductionControlPanelProps {
  core: ProductionCoreData | null;
  queue: ProductionQueueData | null;
  alerts: ProductionAlertsData | null;
  error: string | null;
  queueError: string | null;
  alertsError: string | null;
  toggling: boolean;
  onToggle: (action: "activate" | "deactivate") => Promise<{ ok: boolean; error?: string }>;
  /** The Next push disclosure, owned by the page so it lives beside the
   *  Recent history disclosure it mirrors. */
  nextPushOpen: boolean;
  onToggleNextPush: () => void;
}

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-line/60 ${className}`} aria-hidden="true" />;
}

export function ProductionControlPanel({
  core,
  queue,
  alerts,
  error,
  queueError,
  alertsError,
  toggling,
  onToggle,
  nextPushOpen,
  onToggleNextPush
}: ProductionControlPanelProps) {
  const policy = core?.production.read.policy;
  const active = policy?.desiredState === "active";
  const providers = policy?.scope?.providers ?? [];
  const project = queue?.schedule?.projects[0] ?? null;
  const boardUrl = project?.github ? githubProjectUrl(project.github.owner, project.github.number) : null;
  const alertCount = alerts ? alerts.alerts.capacityRefusals.length + alerts.alerts.blockedDispatches.length : 0;
  const batch = queue?.schedule?.batch ?? null;
  const lanes = batch?.lanes ?? [];
  const nextPush = lanes.flatMap((lane) => lane.nextPush.map((action) => ({ ...action, laneLabel: lane.laneLabel })));

  return (
    <section
      aria-label="Production control"
      aria-busy={!core || !queue || !alerts}
      className="mb-6 grid min-w-0 gap-3 rounded-md border border-line bg-panel p-4 shadow-soft"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {core ? (
            <>
              <ToggleSwitch
                checked={active}
                disabled={toggling}
                onChange={(next) => void onToggle(next ? "activate" : "deactivate")}
                label="Managed production"
              />
              <span className="text-sm font-semibold text-ink">
                {active ? "Active" : "Inactive"}
                {active && core.production.liveAdmissions > 0 ? ` · ${core.production.liveAdmissions} admitted` : ""}
              </span>
            </>
          ) : (
            <>
              <Skeleton className="h-6 w-11 rounded-full" />
              <Skeleton className="h-4 w-20" />
            </>
          )}
        </div>
        {error ? <span className="text-xs text-clay">{error}</span> : null}
      </div>

      <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <PanelStat label="Worker">
          {core ? (
            <>
              <StatusBadge status={core.worker.running ? "active" : "blocked"} label={core.worker.running ? "Running" : "Stopped"} />
              {core.worker.running && core.worker.heartbeat.available ? (
                <span className="mt-1 block text-xs text-muted">
                  {core.worker.heartbeat.fresh ? "Heartbeat fresh" : "Heartbeat stale"}
                </span>
              ) : null}
            </>
          ) : (
            <Skeleton className="h-6 w-16" />
          )}
        </PanelStat>

        <PanelStat label="Provider">
          {core ? (
            providers.length > 0 ? (
              <span className="text-sm font-medium text-ink">{providers.join(", ")}</span>
            ) : (
              <span className="text-sm text-muted">None selected</span>
            )
          ) : (
            <Skeleton className="h-4 w-24" />
          )}
        </PanelStat>

        <PanelStat label="GitHub board">
          {queue ? (
            boardUrl ? (
              <a
                href={boardUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm font-medium text-steel hover:underline"
              >
                {project?.github?.repository} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            ) : (
              <span className="text-sm text-muted">Not linked</span>
            )
          ) : queueError ? (
            <span className="text-sm text-clay">Unavailable</span>
          ) : (
            <Skeleton className="h-4 w-28" />
          )}
        </PanelStat>

        <PanelStat label="Alerts">
          {alerts ? (
            alertCount === 0 ? (
              <span className="text-sm text-muted">None</span>
            ) : (
              <span className="inline-flex items-center gap-1 text-sm font-medium text-clay">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                {alertCount}
              </span>
            )
          ) : alertsError ? (
            <span className="text-sm text-clay">Unavailable</span>
          ) : (
            <Skeleton className="h-4 w-10" />
          )}
        </PanelStat>
      </div>

      {alertsError ? <p className="text-xs text-clay">Alerts unavailable: {alertsError}</p> : null}
      {alerts && alertCount > 0 ? (
        <div className="grid min-w-0 gap-1.5 rounded-md border border-clay/30 bg-clay/5 p-3 text-xs text-ink">
          {alerts.alerts.capacityRefusals.map((refusal) => (
            <div key={refusal.providerId}>
              <span className="font-semibold">{refusal.label}:</span> {refusal.reason}
            </div>
          ))}
          {alerts.alerts.blockedDispatches.slice(0, 3).map((event) => (
            <div key={event.id}>
              <span className="font-semibold">{event.projectSlug ?? "dispatch"}:</span>{" "}
              {event.blockerFields.length > 0 ? event.blockerFields.join(", ") : "refused"}
            </div>
          ))}
        </div>
      ) : null}

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
          This push
          {batch && batch.lanes.length > 0
            ? ` — ${batch.lanes.length} lane${batch.lanes.length === 1 ? "" : "s"} · ${batch.token.points} token points`
            : ""}
        </h3>
        {!queue && queueError ? (
          <p className="text-sm text-clay">Queue unavailable: {queueError}</p>
        ) : !queue ? (
          <div className="grid gap-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-5 w-full" />
            ))}
          </div>
        ) : lanes.length === 0 ? (
          <p className="text-sm text-muted">Nothing ready right now.</p>
        ) : (
          <div className="grid min-w-0 gap-3">
            {lanes.map((lane) => (
              <PushLane key={lane.laneId} lane={lane} />
            ))}
          </div>
        )}

        {nextPush.length > 0 ? (
          <div className="mt-3">
            <button
              type="button"
              aria-expanded={nextPushOpen}
              onClick={() => onToggleNextPush()}
              className="text-xs font-semibold uppercase tracking-[0.14em] text-muted hover:text-ink"
            >
              {nextPushOpen ? "▾" : "▸"} Next push ({nextPush.length})
            </button>
            {nextPushOpen ? (
              <ul className="mt-2 grid min-w-0 gap-1.5">
                {nextPush.map((action) => (
                  <li key={`${action.projectSlug}:${action.actionId}`} className="flex min-w-0 items-center gap-2 text-sm">
                    <span className="truncate text-ink">{action.title}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted">{action.laneLabel}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function PushLane({ lane }: { lane: ScheduleBatchLane }) {
  // Compared by action id, not by object identity: these arrive as separately
  // parsed JSON objects, so the boundary is never the same reference as its
  // entry in `stops`.
  const waiting = lane.stops.filter((stop) => stop.actionId !== lane.boundary?.actionId);
  return (
    <div className="min-w-0 rounded-md border border-line bg-canvas p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className="font-semibold uppercase tracking-[0.1em] text-ink">{lane.laneLabel}</span>
        {lane.sequenceAdvised ? <span>sequence advised</span> : null}
        <span className="ml-auto shrink-0">
          {lane.token.points} token point{lane.token.points === 1 ? "" : "s"}
        </span>
      </div>
      {lane.actions.length > 0 ? (
        <ol className="mt-2 grid min-w-0 gap-1.5">
          {lane.actions.map((action) => (
            <li key={action.actionId} className="flex min-w-0 items-center gap-2 text-sm">
              <span className="shrink-0 text-xs text-muted">{action.position}.</span>
              <span className="truncate text-ink">{action.title}</span>
              <span className="ml-auto shrink-0 text-xs text-muted">{action.tokenImpact ?? "unset"}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {lane.boundary ? <BoundaryPrompt stop={lane.boundary} /> : null}
      {waiting.map((stop) => (
        <p key={stop.actionId} className="mt-2 text-xs text-muted">
          <span className="font-semibold">Waiting:</span> {stop.prompt}
        </p>
      ))}
    </div>
  );
}

/**
 * The boundary is a prompt, not prose: it names the operator action it needs,
 * and links straight to the Decision when one is the gate.
 */
function BoundaryPrompt({ stop }: { stop: ScheduleBatchStop }) {
  return (
    <div className="mt-2 rounded-md border border-clay/30 bg-clay/5 p-2 text-xs text-ink">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status="blocked" label={boundaryLabel(stop)} />
        <span className="min-w-0">{stop.prompt}</span>
      </div>
      {stop.decisionId ? (
        <a href="/review" className="mt-1 inline-flex items-center gap-1 font-semibold text-steel hover:underline">
          Answer Decision {stop.decisionId} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      ) : null}
    </div>
  );
}

function boundaryLabel(stop: ScheduleBatchStop): string {
  switch (stop.kind) {
    case "decision": return "Decision needed";
    case "deferred": return "Deferred";
    case "question_open": return "Question open";
    case "capacity_proof_run": return "Review needed";
    case "dependency": return "Blocked";
    case "unavailable": return "Not ready";
  }
}

function PanelStat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-md border border-line bg-canvas p-3">
      <div className="text-xs font-semibold uppercase tracking-[0.1em] text-muted">{label}</div>
      <div className="mt-1 min-w-0 truncate">{children}</div>
    </div>
  );
}

function ToggleSwitch({
  checked,
  disabled,
  onChange,
  label
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors disabled:opacity-50 ${
        checked ? "border-moss bg-moss/80" : "border-line bg-canvas"
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-[22px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function githubProjectUrl(owner: string, number: number): string {
  return `https://github.com/users/${owner}/projects/${number}`;
}
