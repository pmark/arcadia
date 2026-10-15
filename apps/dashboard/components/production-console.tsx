"use client";

import Link from "next/link";
import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink, Loader2, Pause, Play, Rocket, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ProductionReactivationPreviewResponse } from "../lib/arcadia-cli";
import {
  beginLaunch,
  confirmLaunch,
  confirmMakeNext,
  type LaunchStep,
  type LaunchTarget
} from "../lib/launch-flow";
import { decideLaunchLink } from "../lib/launch-link";
import {
  assembleProjects,
  CHIP_LABEL,
  formatElapsed,
  PROJECT_CHIP_LABEL,
  outcomeLabel,
  summarizeSession,
  type ActionChip,
  type AssembledQueue,
  type ConsoleAction,
  type ConsoleCoreData,
  type ConsoleProduction,
  type ConsoleQueuePart,
  type PauseCapability,
  type ProjectCard,
  type ProjectChip,
  type SessionChip
} from "../lib/production-console";
import type { SessionLogTail } from "../lib/session-log";
import type { DashboardAgentSession } from "../lib/types";
import { SessionCard } from "./dashboard-ui";
import { planHref } from "./plans-list";

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

const CHIP_TONE: Record<ActionChip | SessionChip, string> = {
  launching: "border-steel/40 bg-steel/10 text-steel",
  running: "border-steel/40 bg-steel/10 text-steel",
  stalled: "border-gold/50 bg-gold/10 text-gold",
  ready: "border-moss/40 bg-moss/10 text-moss",
  make_next: "border-moss/40 bg-moss/5 text-moss",
  repo_busy: "border-line bg-canvas text-muted",
  waiting: "border-line bg-canvas text-muted",
  needs_you: "border-gold/50 bg-gold/10 text-gold",
  blocked: "border-clay/40 bg-clay/10 text-clay",
  not_ready: "border-line bg-canvas text-muted",
  unreconciled: "border-gold/50 bg-gold/10 text-gold",
  exited: "border-line bg-canvas text-ink",
  failed: "border-clay/40 bg-clay/10 text-clay",
  pr_open: "border-moss/40 bg-moss/10 text-moss",
  done: "border-moss/40 bg-moss/10 text-moss"
};

export function Chip({ tone, children }: { tone: ActionChip | SessionChip; children: ReactNode }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${CHIP_TONE[tone]}`}>
      {children}
    </span>
  );
}

function SectionHeading({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex min-w-0 flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted">{title}</h2>
      {aside ? <div className="text-xs text-muted">{aside}</div> : null}
    </div>
  );
}

function PartError({ title, message }: { title: string; message: string }) {
  return (
    <div role="alert" className="rounded-md border border-clay/40 bg-clay/5 p-3 text-sm text-clay">
      <p className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        {title}
      </p>
      <p className="mt-1 break-words text-ink">{message}</p>
    </div>
  );
}

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-line/60 ${className}`} aria-hidden="true" />;
}

const primaryButton =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-moss px-4 text-sm font-semibold text-panel transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-line bg-panel px-4 text-sm font-medium text-ink transition hover:border-steel disabled:cursor-not-allowed disabled:opacity-50";
const dangerButton =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-clay px-4 text-sm font-semibold text-panel transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50";

function relativeTime(iso: string | null, now: Date): string {
  if (!iso) return "never";
  const seconds = Math.round((now.getTime() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(seconds)) return "unknown";
  if (seconds < 60) return `${Math.max(0, seconds)}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// ---------------------------------------------------------------------------
// Global strip: production state, worker, pause
// ---------------------------------------------------------------------------

type SwitchStep =
  | { kind: "idle" }
  | { kind: "confirm-off" }
  | { kind: "loading-on" }
  | { kind: "confirm-on"; preview: ProductionReactivationPreviewResponse["preview"] }
  | { kind: "busy" }
  | { kind: "error"; message: string };

export function GlobalStrip({
  core,
  error,
  now,
  onChanged
}: {
  core: ConsoleCoreData | null;
  error: string | null;
  now: Date;
  onChanged: () => void;
}) {
  const [step, setStep] = useState<SwitchStep>({ kind: "idle" });
  const [escalationsOpen, setEscalationsOpen] = useState(false);
  const production = core?.production ?? null;
  const active = production?.desiredState === "active";

  const startOn = useCallback(async () => {
    setStep({ kind: "loading-on" });
    try {
      const response = await fetch("/api/production-control?part=reactivate-preview", { cache: "no-store" });
      const body = (await response.json()) as ProductionReactivationPreviewResponse & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not preview turning production On.");
      setStep({ kind: "confirm-on", preview: body.preview });
    } catch (cause) {
      setStep({ kind: "error", message: cause instanceof Error ? cause.message : String(cause) });
    }
  }, []);

  const send = useCallback(
    async (action: "activate" | "deactivate", expected?: ProductionReactivationPreviewResponse["preview"]["expected"]) => {
      setStep({ kind: "busy" });
      try {
        // On carries the exact preview the operator confirmed; the route refuses it if anything moved.
        const response = await fetch("/api/production-control", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(expected ? { action, expected } : { action })
        });
        const body = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(body.error ?? `Could not ${action === "activate" ? "turn production On" : "turn production Off"}.`);
        setStep({ kind: "idle" });
        onChanged();
      } catch (cause) {
        setStep({ kind: "error", message: cause instanceof Error ? cause.message : String(cause) });
      }
    },
    [onChanged]
  );

  return (
    <section aria-label="Production state" className="grid min-w-0 gap-3 rounded-md border border-line bg-panel p-4 shadow-soft">
      {error && !core ? <PartError title="Production state unavailable" message={error} /> : null}
      <div className="grid min-w-0 gap-3 sm:grid-cols-[1fr_auto] sm:items-start">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Managed production</p>
          {production ? (
            <>
              <p className="mt-1 text-lg font-semibold leading-6 text-ink">{production.label}</p>
              <p className="mt-1 text-xs text-muted">
                Desired {production.desiredState ?? "unknown"}
                {production.revision !== null ? ` · revision ${production.revision}` : ""}
                {production.epoch !== null ? ` · epoch ${production.epoch}` : ""}
                {production.maxConcurrentSessions !== null ? ` · up to ${production.maxConcurrentSessions} Session${production.maxConcurrentSessions === 1 ? "" : "s"} at once` : ""}
                {production.providers.length > 0 ? ` · ${production.providers.join(", ")}` : ""}
              </p>
            </>
          ) : core?.productionError ? (
            <p className="mt-1 text-sm text-clay">Unavailable: {core.productionError}. This is not a confirmed Off.</p>
          ) : (
            <Skeleton className="mt-2 h-5 w-48" />
          )}
        </div>
        {production ? (
          <div className="flex flex-wrap gap-2">
            {active ? (
              <button type="button" className={secondaryButton} disabled={step.kind !== "idle" && step.kind !== "error"} onClick={() => setStep({ kind: "confirm-off" })}>
                Turn production Off…
              </button>
            ) : (
              <button
                type="button"
                className={secondaryButton}
                disabled={!production.canReactivate || (step.kind !== "idle" && step.kind !== "error")}
                title={production.canReactivate ? undefined : "No saved configuration to replay; activate from the CLI with arcadia production preview/activate."}
                onClick={() => void startOn()}
              >
                {step.kind === "loading-on" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                Turn production On…
              </button>
            )}
          </div>
        ) : null}
      </div>

      {step.kind === "confirm-off" ? (
        <ConfirmBox
          title="Turn managed production Off?"
          consequence={[
            "Arcadia stops admitting new unattended work at once and fences any admission not yet committed to a launch.",
            `Work already committed${production && production.liveAdmissions > 0 ? ` (${production.liveAdmissions} now)` : ""} keeps running and is reconciled; nothing is killed.`,
            "The reviewed configuration is kept, so On can replay it later (it may refuse if the queue or policy changed)."
          ]}
          confirmLabel="Turn Off"
          danger
          onConfirm={() => void send("deactivate")}
          onCancel={() => setStep({ kind: "idle" })}
        />
      ) : null}
      {step.kind === "confirm-on" ? (
        <ConfirmBox
          title="Turn managed production On?"
          consequence={
            step.preview.ready && step.preview.configuration
              ? [
                  "Arcadia may admit and launch unattended Sessions on this Mac, within exactly this saved scope:",
                  `Projects: ${step.preview.configuration.scope.projects.join(", ") || "none"} · Plans: ${step.preview.configuration.scope.plans.length} · Actions: ${step.preview.configuration.scope.actions.length || "all eligible"}`,
                  `Providers: ${step.preview.configuration.scope.providers.join(", ") || "none"} · up to ${step.preview.configuration.scope.maxConcurrentSessions} Session(s) at once`,
                  ...(step.preview.configuration.notCarried.length > 0 ? [`Not carried over: ${step.preview.configuration.notCarried.join("; ")}`] : []),
                  "If anything changes before you confirm, the switch refuses with the exact reason instead of widening the scope."
                ]
              : step.preview.refusals.map((refusal) => `${refusal.reason} ${refusal.remedy}`)
          }
          confirmLabel="Turn On"
          disabled={!step.preview.ready || !step.preview.expected}
          onConfirm={() => void send("activate", step.preview.expected)}
          onCancel={() => setStep({ kind: "idle" })}
        />
      ) : null}
      {step.kind === "busy" ? (
        <p className="flex items-center gap-2 text-sm text-muted" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Applying…
        </p>
      ) : null}
      {step.kind === "error" ? <PartError title="The switch did not change" message={step.message} /> : null}

      <div className="grid min-w-0 gap-2 sm:grid-cols-3">
        <StripCell label="Worker">
          {core?.worker ? (
            <span className={core.worker.running ? "text-ink" : "text-clay"}>
              {core.worker.running ? "Running" : "Stopped"}
              {core.worker.heartbeat.available
                ? ` · heartbeat ${core.worker.heartbeat.fresh ? "fresh" : "stale"} ${relativeTime(core.worker.heartbeat.timestamp, now)}`
                : " · no heartbeat"}
            </span>
          ) : core ? (
            <span className="text-clay">Unavailable</span>
          ) : (
            <Skeleton className="h-4 w-24" />
          )}
        </StripCell>
        <StripCell label="Escalations">
          {production ? (
            production.escalations.length === 0 ? (
              <span className="text-muted">None</span>
            ) : (
              <button type="button" className="inline-flex items-center gap-1 font-semibold text-gold" aria-expanded={escalationsOpen} onClick={() => setEscalationsOpen((open) => !open)}>
                {escalationsOpen ? <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
                {production.escalations.length} waiting
              </button>
            )
          ) : (
            <Skeleton className="h-4 w-16" />
          )}
        </StripCell>
        <StripCell label="Pause all">
          {core ? <DisabledControl icon={<Pause className="h-3.5 w-3.5" aria-hidden="true" />} label="Pause all" reason={core.pause.all.reason} /> : <Skeleton className="h-4 w-20" />}
        </StripCell>
      </div>
      {escalationsOpen && production ? (
        <ul className="grid gap-1.5 rounded-md border border-gold/40 bg-gold/5 p-3 text-xs text-ink">
          {production.escalations.map((escalation) => (
            <li key={escalation.actionKey} className="break-words">
              <span className="font-semibold">{escalation.actionKey}:</span> {escalation.message}
              {escalation.remedy ? <span className="block text-muted">Fix: {escalation.remedy}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function StripCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-md border border-line bg-canvas p-2.5 text-sm">
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{label}</p>
      <div className="mt-0.5 min-w-0 break-words">{children}</div>
    </div>
  );
}

/** A control that exists in the layout but has no safe backend yet: disabled, with the reason one tap away. */
export function DisabledControl({ icon, label, reason }: { icon: ReactNode; label: string; reason: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="block">
      <span className="flex flex-wrap items-center gap-2">
        <button type="button" disabled aria-disabled="true" className="inline-flex min-h-8 items-center gap-1 rounded-md border border-line px-2 text-xs font-medium text-muted opacity-60">
          {icon} {label}
        </button>
        <button type="button" className="text-xs font-medium text-steel underline-offset-2 hover:underline" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          not available yet
        </button>
      </span>
      {open ? <span className="mt-1 block text-xs text-muted">{reason}</span> : null}
    </span>
  );
}

function ConfirmBox({
  title,
  consequence,
  confirmLabel,
  danger = false,
  disabled = false,
  onConfirm,
  onCancel
}: {
  title: string;
  consequence: string[];
  confirmLabel: string;
  danger?: boolean;
  disabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  return (
    <div role="group" aria-label={title} className="rounded-md border border-steel/40 bg-steel/5 p-3 text-sm">
      <h3 ref={headingRef} tabIndex={-1} className="font-semibold text-ink outline-none">{title}</h3>
      <ul className="mt-2 grid gap-1 text-ink">
        {consequence.map((line, index) => (
          <li key={index} className="break-words">{line}</li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={danger ? dangerButton : primaryButton} disabled={disabled} onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" className={secondaryButton} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export function SessionsSection({
  core,
  now
}: {
  core: ConsoleCoreData | null;
  now: Date;
}) {
  const sessions = core?.sessions ?? null;
  const active = sessions?.active ?? [];
  const recent = sessions?.recent ?? [];
  return (
    <section aria-label="Sessions" className="min-w-0">
      <SectionHeading title={`Sessions${sessions ? ` · ${active.length} live` : ""}`} aside={sessions && recent.length > 0 ? `${recent.length} recent` : null} />
      {!core ? (
        <div className="grid gap-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : core.sessionsError ? (
        <PartError title="Sessions unavailable" message={core.sessionsError} />
      ) : active.length === 0 && recent.length === 0 ? (
        <p className="rounded-md border border-dashed border-line bg-panel px-4 py-6 text-center text-sm text-muted">
          No Session is running and none has finished recently. Launch a ready Action from the queue below.
        </p>
      ) : (
        <div className="grid min-w-0 gap-2">
          {active.map((session, index) => (
            <SessionRow key={session.id} session={session} now={now} pause={core.pause} defaultOpen={index === 0} />
          ))}
          {recent.length > 0 ? (
            <RecentSessions recent={recent} now={now} pause={core.pause} defaultOpen={active.length === 0} />
          ) : null}
        </div>
      )}
    </section>
  );
}

/** Open state is decided once, when Sessions first load, so a poll never overrides the operator's own toggle. */
function RecentSessions({
  recent,
  now,
  pause,
  defaultOpen
}: {
  recent: DashboardAgentSession[];
  now: Date;
  pause: PauseCapability;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex min-h-11 items-center gap-1 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
        Recently finished ({recent.length})
      </button>
      {open ? (
        <div className="grid min-w-0 gap-2">
          {recent.map((session) => (
            <SessionRow key={session.id} session={session} now={now} pause={pause} defaultOpen={false} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SessionRow({
  session,
  now,
  pause,
  defaultOpen
}: {
  session: DashboardAgentSession;
  now: Date;
  pause: PauseCapability;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const summary = summarizeSession(session, now);
  const live = summary.chip === "running" || summary.chip === "stalled" || summary.chip === "launching";
  return (
    <article className="min-w-0 rounded-md border border-line bg-panel shadow-soft">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full min-w-0 items-start gap-2 p-3 text-left"
      >
        {open ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />}
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <Chip tone={summary.chip}>{summary.label}</Chip>
            <span className="text-xs tabular-nums text-muted">{formatElapsed(summary.elapsedSeconds)}</span>
            {summary.exitLine ? <span className="text-xs text-muted">{summary.exitLine}</span> : null}
          </span>
          <span className="mt-1 block break-words text-sm font-semibold text-ink">{session.actionTitle ?? session.actionId}</span>
          <span className="mt-0.5 block break-words text-xs text-muted">
            {session.actionTitle && session.actionTitle !== session.actionId ? `${session.actionId} · ` : ""}
            {session.projectName ?? "Unassigned"} · {session.provider} {session.model}
            {session.effort ? ` · ${session.effort}` : ""}
          </span>
        </span>
      </button>
      {open ? (
        <div className="grid min-w-0 gap-3 border-t border-line p-3">
          <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
            <Fact label="Session" value={session.id} mono />
            <Fact label="Branch" value={session.branch} mono />
            <Fact label="Exit code" value={session.exitStatus === null || session.exitStatus === undefined ? "—" : String(session.exitStatus)} />
            <Fact label="Outcome" value={session.exitOutcome ? outcomeLabel(session.exitOutcome) : live ? "Still running" : "Not reconciled yet"} />
            {session.exitReason ? <Fact label="Why" value={session.exitReason} /> : null}
          </dl>
          <div className="flex flex-wrap items-center gap-2">
            {session.pullRequestUrl ? (
              <a href={session.pullRequestUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-1 rounded-md border border-moss/40 bg-moss/10 px-3 text-sm font-semibold text-moss">
                Pull request <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            ) : null}
            {live ? (
              <DisabledControl icon={<Pause className="h-3.5 w-3.5" aria-hidden="true" />} label="Pause" reason={pause.session.reason} />
            ) : null}
            {summary.chip === "unreconciled" ? (
              <code className="rounded border border-line bg-canvas px-2 py-1 text-xs">arcadia session reconcile {session.id}</code>
            ) : null}
          </div>
          <SessionLog sessionId={session.id} live={live} />
          {live ? (
            <details className="min-w-0">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.12em] text-muted">Reattach and details</summary>
              <div className="mt-2">
                <SessionCard session={session} />
              </div>
            </details>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="inline font-semibold text-muted">{label}: </dt>
      <dd className={`inline break-all text-ink ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}

/** Polled often enough for the ≤4 s acceptance, cheap because each poll asks only for new bytes. */
export const LOG_POLL_MS = 3_000;
const LOG_KEEP_CHARS = 200_000;

export function SessionLog({ sessionId, live }: { sessionId: string; live: boolean }) {
  const [text, setText] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const offsetRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const preRef = useRef<HTMLPreElement>(null);
  const followRef = useRef(true);

  const poll = useCallback(async () => {
    // One request at a time: two polls carrying the same offset would append the same bytes twice.
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const query = offsetRef.current === null ? "" : `?offset=${offsetRef.current}`;
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/log${query}`, { cache: "no-store" });
      const body = (await response.json()) as SessionLogTail & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Log unavailable.");
      if (!body.available) {
        setState("missing");
        return;
      }
      const fresh = offsetRef.current === null || body.reset;
      offsetRef.current = body.size;
      if (fresh) setTruncated(body.truncated);
      setText((current) => {
        const next = fresh ? body.text : current + body.text;
        return next.length > LOG_KEEP_CHARS ? next.slice(-LOG_KEEP_CHARS) : next;
      });
      setState("ready");
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setState((current) => (current === "loading" ? "error" : current));
    } finally {
      inFlightRef.current = false;
    }
  }, [sessionId]);

  useEffect(() => {
    void poll();
    if (!live) return undefined;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void poll();
    }, LOG_POLL_MS);
    return () => window.clearInterval(interval);
  }, [live, poll]);

  useEffect(() => {
    const element = preRef.current;
    if (element && followRef.current) element.scrollTop = element.scrollHeight;
  }, [text]);

  if (state === "missing") {
    return (
      <p className="rounded-md border border-dashed border-line bg-canvas p-3 text-xs text-muted">
        No Session log recorded at <code>.arcadia/sessions/{sessionId}.log</code>. Sessions launched before headless recording
        (PR #1131) write none; use Copy Reattach on the Mac to watch one.
      </p>
    );
  }
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted">
        <span>{live ? "Live log · updates every 3 s" : "Log"}{truncated ? " · showing the end" : ""}</span>
        {error ? <span className="text-clay">Last poll failed: {error}</span> : null}
      </div>
      <pre
        ref={preRef}
        tabIndex={0}
        aria-label={`Log for Session ${sessionId}`}
        onScroll={(event) => {
          const element = event.currentTarget;
          followRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
        }}
        className="h-64 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-canvas p-3 font-mono text-[11px] leading-4 text-ink"
      >
        {state === "loading" ? "Loading log…" : state === "error" ? `Log unavailable: ${error ?? "unknown error"}` : text || "(empty so far)"}
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Queue: batches (waves) and queue order
// ---------------------------------------------------------------------------

type QueueView = "projects" | "batches" | "order";
type QueueFilter = "all" | "launchable" | "active" | "waiting" | "attention";

/** The first queue read after a dashboard restart is cold (about 15 s); past this, say so plainly. */
const QUEUE_SLOW_MS = 60_000;

export function QueueSection({
  part,
  assembled,
  now,
  onLaunched,
  launchKey = null,
  queueFresh = false,
  onRequestFresh,
  production = null
}: {
  part: ConsoleQueuePart | null;
  assembled: AssembledQueue | null;
  now: Date;
  /** Production state, for the scope and escalations the Projects view shows. */
  production?: ConsoleProduction | null;
  onLaunched: () => void;
  /** From `/production?launch=<project>/<actionId>`: open that Action's Launch dialog once the queue loads. */
  launchKey?: string | null;
  /** True when `part` came from a fresh read, not the server's short-cached copy. */
  queueFresh?: boolean;
  /** Asks the page for one fresh queue read. */
  onRequestFresh?: () => void;
}) {
  const [mountedAt] = useState(() => Date.now());
  const [view, setView] = useState<QueueView>("projects");
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [launching, setLaunching] = useState<ConsoleAction | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const handledLink = useRef<string | null>(null);

  const askedFresh = useRef<string | null>(null);

  // A cold deep link: act once per key. It only opens the dialog; the operator confirms there.
  useEffect(() => {
    const decision = decideLaunchLink({
      key: launchKey,
      handledKey: handledLink.current,
      actions: part?.queue && assembled ? assembled.actions : null,
      queueFresh,
      askedFresh: askedFresh.current === launchKey
    });
    if (decision.kind === "open") {
      handledLink.current = launchKey;
      setWarning(null);
      setLaunching(decision.action);
    } else if (decision.kind === "warn") {
      handledLink.current = launchKey;
      setWarning(decision.message);
    } else if (decision.kind === "refresh") {
      askedFresh.current = launchKey;
      onRequestFresh?.();
    }
  }, [launchKey, assembled, part, queueFresh, onRequestFresh]);

  const launchable = assembled?.actions.filter((action) => action.launch.allowed).length ?? 0;
  return (
    <section aria-label="Queue" className="min-w-0">
      <SectionHeading
        title="Queue"
        aside={
          assembled && part?.queue
            ? `${part.queue.entries.length} planned · ${launchable} launchable · revision ${part.queue.revision}`
            : null
        }
      />
      {warning ? (
        <p role="alert" className="mb-3 rounded-md border border-gold/50 bg-gold/10 p-3 text-sm text-ink">
          {warning}{" "}
          <button type="button" className="font-semibold text-steel underline" onClick={() => setWarning(null)}>Dismiss</button>
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mb-3 rounded-md border border-moss/40 bg-moss/5 p-3 text-sm text-ink">
          {notice}
        </p>
      ) : null}
      {!part ? (
        <QueueLoading waitedMs={now.getTime() - mountedAt} />
      ) : part.queueError || !part.queue || !assembled ? (
        <PartError title="Queue unavailable" message={part.queueError ?? "The work queue could not be read."} />
      ) : (
        <>
          {!part.queue.orderValid ? (
            <p className="mb-3 rounded-md border border-gold/50 bg-gold/10 p-3 text-sm text-ink">
              {part.queue.unpositionedCount} approved Action(s) are unpositioned, so Arcadia will not pick a next priority. Arrange them on{" "}
              <a className="font-semibold text-steel underline" href="/work-queue">Work Queue</a>.
            </p>
          ) : null}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div role="tablist" aria-label="Queue view" className="inline-flex rounded-md border border-line bg-panel p-0.5">
              {(["projects", "batches", "order"] as const).map((option) => (
                <button
                  key={option}
                  role="tab"
                  type="button"
                  aria-selected={view === option}
                  onClick={() => setView(option)}
                  className={`min-h-9 rounded px-3 text-sm font-medium ${view === option ? "bg-steel/10 text-steel" : "text-muted"}`}
                >
                  {option === "projects" ? "Projects" : option === "batches" ? "Batches" : "Queue order"}
                </button>
              ))}
            </div>
            {view === "order" ? (
              <label className="flex items-center gap-2 text-sm text-muted">
                Show
                <select value={filter} onChange={(event) => setFilter(event.target.value as QueueFilter)} className="min-h-9 rounded-md border border-line bg-panel px-2 text-sm text-ink">
                  <option value="all">All ({assembled.actions.length})</option>
                  <option value="launchable">Launchable ({launchable})</option>
                  <option value="active">Running ({assembled.counts.running + assembled.counts.launching + assembled.counts.stalled})</option>
                  <option value="waiting">Waiting ({assembled.counts.waiting + assembled.counts.not_ready + assembled.counts.repo_busy})</option>
                  <option value="attention">Needs you / blocked ({assembled.counts.needs_you + assembled.counts.blocked})</option>
                </select>
              </label>
            ) : null}
          </div>
          {view === "projects" ? (
            <ProjectsView assembled={assembled} production={production} onLaunch={setLaunching} />
          ) : view === "batches" ? (
            <BatchesView part={part} assembled={assembled} onLaunch={setLaunching} />
          ) : (
            <OrderView actions={assembled.actions.filter((action) => matches(action, filter))} onLaunch={setLaunching} />
          )}
        </>
      )}
      {launching && part?.queue ? (
        <LaunchDialog
          action={launching}
          revision={part.queue.revision}
          onClose={() => setLaunching(null)}
          onLaunched={(message) => {
            setLaunching(null);
            setNotice(message);
            onLaunched();
          }}
        />
      ) : null}
    </section>
  );
}

function ProjectsView({
  assembled,
  production,
  onLaunch
}: {
  assembled: AssembledQueue;
  production: ConsoleProduction | null;
  onLaunch: (action: ConsoleAction) => void;
}) {
  const [showOut, setShowOut] = useState(false);
  const cards = assembleProjects(assembled, production);
  const inScope = cards.filter((card) => card.inScope !== false);
  const outOfScope = cards.filter((card) => card.inScope === false);
  // With nothing in scope the fold would leave the view empty, so it starts open.
  const outOpen = showOut || inScope.length === 0;
  if (cards.length === 0) return <p className="text-sm text-muted">No Project has an Action in the queue.</p>;
  return (
    <div className="grid min-w-0 gap-2">
      <p className="text-xs text-muted">
        Ordered by each Project&apos;s first Action in today&apos;s queue. Choosing Project order yourself is pending Decision 0115. Arcadia sequences the Actions inside each Plan.
      </p>
      {production?.scopeProjects && inScope.length === 0 ? (
        <p className="rounded-md border border-gold/50 bg-gold/10 p-3 text-sm text-ink">
          The production scope admits none of these Projects ({production.scopeProjects.join(", ")}), so turning production On would run none of them.
        </p>
      ) : null}
      {inScope.length > 0 ? <ol className="grid min-w-0 gap-2" aria-label="Projects in the production scope">
        {inScope.map((card) => <ProjectCardRow key={card.slug} card={card} onLaunch={onLaunch} />)}
      </ol> : null}
      {outOfScope.length > 0 ? (
        <div className="mt-2">
          {inScope.length === 0 ? (
            <p className="text-sm font-medium text-muted">Not in the production scope ({outOfScope.length})</p>
          ) : (
            <button type="button" onClick={() => setShowOut((value) => !value)} aria-expanded={outOpen} className="flex min-h-9 items-center gap-1 text-sm font-medium text-muted">
              {outOpen ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
              Not in the production scope ({outOfScope.length})
            </button>
          )}
          {outOpen ? (
            <ol className="mt-2 grid min-w-0 gap-2" aria-label="Projects outside the production scope">
              {outOfScope.map((card) => <ProjectCardRow key={card.slug} card={card} onLaunch={onLaunch} />)}
            </ol>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const PROJECT_CHIP_TONE: Record<ProjectChip, string> = {
  running: "border-steel/40 bg-steel/10 text-steel",
  next_up: "border-moss/40 bg-moss/10 text-moss",
  ready: "border-moss/30 bg-moss/5 text-moss",
  needs_you: "border-gold/50 bg-gold/10 text-ink",
  repo_busy: "border-line bg-canvas text-muted",
  waiting: "border-line bg-canvas text-muted",
  blocked: "border-clay/40 bg-clay/5 text-clay",
  nothing_ready: "border-line bg-canvas text-muted"
};

function humanizeSlug(slug: string): string {
  const words = slug.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function ProjectCardRow({ card, onLaunch }: { card: ProjectCard; onLaunch: (action: ConsoleAction) => void }) {
  const next = card.next;
  return (
    <li className="grid min-w-0 gap-1.5 rounded-md border border-line bg-panel p-3">
      <div className="flex min-w-0 items-start gap-2">
        {card.projectId ? (
          <Link href={`/projects/${encodeURIComponent(card.projectId)}/plans`} className="min-w-0 flex-1 break-words font-semibold text-steel underline-offset-2 hover:underline">
            {card.name}
          </Link>
        ) : (
          <p className="min-w-0 flex-1 break-words font-semibold">{card.name}</p>
        )}
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${PROJECT_CHIP_TONE[card.chip]}`}>{PROJECT_CHIP_LABEL[card.chip]}</span>
      </div>
      {card.planSlug ? (
        <p className="min-w-0 break-words text-sm">
          <Link href={planHref(card.slug, card.planSlug)} className="text-steel underline-offset-2 hover:underline">
            {humanizeSlug(card.planSlug)}
          </Link>
          <span className="text-muted"> · {card.planOpen} open · {card.planReady} ready</span>
        </p>
      ) : null}
      {next ? (
        <p className="min-w-0 break-words text-sm">
          <span className="text-muted">{card.chip === "running" ? "Running: " : "Would pick now: "}</span>
          {next.title}
        </p>
      ) : null}
      {card.reason ? <p className="min-w-0 break-words text-xs text-muted">{card.reason}</p> : null}
      {card.needs.map((need) => (
        <p key={need.actionKey} className="min-w-0 break-words rounded border border-gold/50 bg-gold/10 px-2 py-1 text-xs text-ink">
          <span className="font-semibold">Needs you · {need.actionKey.split("/").slice(1).join("/")}:</span> {need.message}
          {need.remedy ? <span className="block text-muted">{need.remedy}</span> : null}
        </p>
      ))}
      {card.otherPlans.length > 0 ? (
        <p className="text-xs text-muted">
          {card.otherPlans.length} other active Plan{card.otherPlans.length === 1 ? "" : "s"}:{" "}
          {card.otherPlans.map((plan, index) => (
            <span key={plan.slug}>
              {index > 0 ? ", " : ""}
              <Link href={planHref(card.slug, plan.slug)} className="text-steel underline-offset-2 hover:underline">{humanizeSlug(plan.slug)}</Link> ({plan.open})
            </span>
          ))}
        </p>
      ) : null}
      {next?.launch.allowed ? (
        <div>
          <button type="button" className={secondaryButton} onClick={() => onLaunch(next)}>
            <Rocket className="h-4 w-4" aria-hidden="true" /> Launch…
          </button>
        </div>
      ) : null}
    </li>
  );
}

function QueueLoading({ waitedMs }: { waitedMs: number }) {
  const seconds = Math.max(0, Math.floor(waitedMs / 1000));
  // The live region's text stays put; only the visual counter ticks, so a screen reader is not told every second.
  if (waitedMs > QUEUE_SLOW_MS) {
    return (
      <p role="status" className="rounded-md border border-gold/50 bg-gold/10 p-3 text-sm text-ink">
        Still reading the queue after more than a minute. Arcadia may be busy; it keeps trying, and Refresh at the top asks again now.
      </p>
    );
  }
  return (
    <p role="status" className="flex items-center gap-2 rounded-md border border-line bg-panel p-3 text-sm text-muted">
      <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
      <span>
        Reading the queue…<span aria-hidden="true"> {seconds} s.</span> The first read after a restart can take about 15 s.
      </span>
    </p>
  );
}

function matches(action: ConsoleAction, filter: QueueFilter): boolean {
  switch (filter) {
    case "all": return true;
    case "launchable": return action.launch.allowed;
    case "active": return action.chip === "running" || action.chip === "launching" || action.chip === "stalled";
    case "waiting": return action.chip === "waiting" || action.chip === "not_ready" || action.chip === "repo_busy";
    case "attention": return action.chip === "needs_you" || action.chip === "blocked";
  }
}

const EXPANDED_WAVES = 2;

function BatchesView({
  part,
  assembled,
  onLaunch
}: {
  part: ConsoleQueuePart;
  assembled: AssembledQueue;
  onLaunch: (action: ConsoleAction) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  if (part.batchError) return <PartError title="Batches unavailable" message={part.batchError} />;
  if (assembled.waves.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-line bg-panel px-4 py-6 text-center text-sm text-muted">
        Nothing is ready to run. Switch to Queue order to see what each Action waits on.
      </p>
    );
  }
  const waves = showAll ? assembled.waves : assembled.waves.slice(0, EXPANDED_WAVES);
  const later = assembled.waves.slice(EXPANDED_WAVES).reduce((sum, wave) => sum + wave.actions.length, 0);
  const stopped = assembled.lanes.flatMap((lane) => lane.stops.map((stop) => ({ lane, stop })));
  return (
    <div className="grid min-w-0 gap-3">
      <p className="text-xs text-muted">
        A batch holds at most one ready Action per repository, so its Actions can run side by side: Arcadia allows one Session
        lease per repository. Within a repository, Actions run one after another, in queue order.
      </p>
      {waves.map((wave) => (
        <div key={wave.wave} className="min-w-0 rounded-md border border-line bg-panel p-3 shadow-soft">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
            Batch {wave.wave} · {wave.actions.length} Action{wave.actions.length === 1 ? "" : "s"}
            {wave.wave === 1 ? " · first in each repository" : ` · after batch ${wave.wave - 1} in each repository`}
          </p>
          <ul className="grid min-w-0 gap-2">
            {wave.actions.map((action) => (
              <ActionRow key={action.key} action={action} onLaunch={onLaunch} showLane />
            ))}
          </ul>
        </div>
      ))}
      {later > 0 && !showAll ? (
        <button type="button" className={secondaryButton} onClick={() => setShowAll(true)}>
          Show {assembled.waves.length - EXPANDED_WAVES} later batches ({later} Actions)
        </button>
      ) : null}
      {stopped.length > 0 ? (
        <details className="min-w-0 rounded-md border border-line bg-panel p-3">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.12em] text-muted">
            Stopped before a batch ({stopped.length})
          </summary>
          <ul className="mt-2 grid gap-1.5 text-sm">
            {stopped.map(({ lane, stop }) => (
              <li key={`${lane.laneId}:${stop.key}`} className="min-w-0 break-words">
                <span className="font-medium text-ink">{stop.title}</span>{" "}
                <span className="text-xs text-muted">({lane.label}{lane.boundary?.key === stop.key ? " · unattended push stops here" : ""})</span>
                <span className="block text-xs text-muted">{stop.prompt}</span>
                {stop.decisionId ? (
                  <a href="/review" className="text-xs font-semibold text-steel underline">Answer Decision {stop.decisionId}</a>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function OrderView({ actions, onLaunch }: { actions: ConsoleAction[]; onLaunch: (action: ConsoleAction) => void }) {
  if (actions.length === 0) {
    return <p className="rounded-md border border-dashed border-line bg-panel px-4 py-6 text-center text-sm text-muted">No Action matches this filter. The order itself is unchanged.</p>;
  }
  return (
    <ol className="grid min-w-0 gap-2" aria-label="Planned Actions in queue order">
      {actions.map((action) => (
        <ActionRow key={action.key} action={action} onLaunch={onLaunch} showPosition showLane />
      ))}
    </ol>
  );
}

function ActionRow({
  action,
  onLaunch,
  showPosition = false,
  showLane = false
}: {
  action: ConsoleAction;
  onLaunch: (action: ConsoleAction) => void;
  showPosition?: boolean;
  showLane?: boolean;
}) {
  return (
    <li className="flex min-w-0 items-start gap-3 rounded-md border border-line bg-panel p-3">
      {showPosition ? <span className="w-7 shrink-0 pt-0.5 text-right text-xs tabular-nums text-muted">{action.position}.</span> : null}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Chip tone={action.chip}>{CHIP_LABEL[action.chip]}</Chip>
          {action.wave !== null ? <span className="text-xs text-muted">batch {action.wave}</span> : null}
          {showLane && action.laneLabel ? <span className="text-xs text-muted">repo {action.laneLabel}</span> : null}
        </div>
        <p className="mt-1 break-words text-sm font-semibold text-ink">{action.title}</p>
        <p className="mt-0.5 break-words text-xs text-muted">
          {action.projectName ?? action.projectSlug ?? "Unassigned"} · {action.planSlug ?? "no Plan"}
          {action.tokenImpact ? ` · ${action.tokenImpact} token impact` : ""}
        </p>
        {action.why ? <p className="mt-1 break-words text-xs text-muted">{action.why}</p> : null}
      </div>
      {action.launch.allowed ? (
        <button type="button" className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md border border-moss/50 bg-moss/10 px-3 text-sm font-semibold text-moss" onClick={() => onLaunch(action)}>
          <Rocket className="h-4 w-4" aria-hidden="true" /> Launch…
        </button>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Launch: preview, consequence, confirmation
// ---------------------------------------------------------------------------

function LaunchDialog({
  action,
  revision,
  onClose,
  onLaunched
}: {
  action: ConsoleAction;
  revision: number;
  onClose: () => void;
  onLaunched: (message: string) => void;
}) {
  // Frozen when the dialog opens: the pointer-move preview and its apply must name the same revision.
  const [frozenRevision] = useState(revision);
  const target: LaunchTarget = {
    projectId: action.projectId ?? "",
    planSlug: action.planSlug ?? "",
    actionId: action.actionId,
    actionKey: action.key,
    title: action.title,
    needsMakeNext: action.launch.needsMakeNext,
    queueRevision: frozenRevision
  };
  const [step, setStep] = useState<LaunchStep | null>(null);
  const [busy, setBusy] = useState(true);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    headingRef.current?.focus();
    void beginLaunch(target, fetch.bind(window)).then((next) => {
      setStep(next);
      setBusy(false);
    });
    // The target is fixed for the dialog's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const run = async (work: () => Promise<LaunchStep>) => {
    setBusy(true);
    const next = await work();
    setBusy(false);
    if (next.kind === "launched") onLaunched(`${next.message} It appears under Sessions within a few seconds.`);
    else setStep(next);
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="launch-title" className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-lg border border-line bg-panel p-4 text-ink shadow-soft sm:rounded-lg">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Launch one Action as a Session</p>
            <h2 id="launch-title" ref={headingRef} tabIndex={-1} className="mt-1 break-words text-base font-semibold outline-none">{action.title}</h2>
            <p className="mt-0.5 break-words text-xs text-muted">{action.projectName ?? action.projectSlug} · {action.planSlug} · repo {action.laneLabel ?? "unknown"}</p>
          </div>
          <button type="button" aria-label="Close" className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-line" disabled={busy} onClick={onClose}>
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-4 grid gap-3 text-sm">
          {busy ? (
            <p className="flex items-center gap-2 text-muted" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Asking Arcadia…</p>
          ) : !step ? null : step.kind === "make-next" ? (
            <>
              <p className="font-semibold">Step 1 of 2: make it this Project&apos;s next Action</p>
              <ul className="grid gap-1">
                <li>Moves the governed pointer in PROJECT.md and the Plan from <strong>{step.previousAction ?? "none"}</strong> to <strong>{step.nextAction}</strong>.</li>
                <li>Starts nothing. You see the launch preview next and confirm that separately.</li>
                <li>Undo by making the previous Action next again from Work Queue.</li>
              </ul>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={primaryButton} onClick={() => void run(() => confirmMakeNext(target, step, fetch.bind(window)))}>Make next</button>
                <button type="button" className={secondaryButton} onClick={onClose}>Cancel</button>
              </div>
            </>
          ) : step.kind === "preview" ? (
            <>
              <p className="font-semibold">{action.launch.needsMakeNext ? "Step 2 of 2: launch" : "Launch preview"}</p>
              <ul className="grid gap-1">
                <li>Starts one coding-agent Session on this Mac in a new worktree, working {step.preview.actionDocRef ?? "an unknown Action"}.</li>
                {step.preview.selection ? (
                  <li>Agent: {step.preview.selection.provider} · {step.preview.selection.model} · effort {step.preview.selection.effort}.</li>
                ) : null}
                <li>Holds the repository until it exits: nothing else launches there meanwhile.</li>
                <li>Also authorizes, once and for this one Action: when the Session exits Arcadia validates, commits and pushes its branch and, only if the work is accepted as complete, opens a <strong>draft</strong> pull request. It never merges or turns production on, and the authorization expires after 24 hours.</li>
                <li>Uses provider tokens ({action.tokenImpact ?? "unknown"} token impact). Pausing is not available yet; stopping it means reattaching on the Mac.</li>
              </ul>
              {step.refusal ? <PartError title="Launch withheld" message={step.refusal} /> : null}
              <p className="text-xs text-muted">Fingerprint {(step.preview.previewFingerprint ?? "none").slice(0, 16)}… · request {step.requestId}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={primaryButton}
                  disabled={Boolean(step.refusal)}
                  onClick={() => void run(() => confirmLaunch(target, step, fetch.bind(window)))}
                >
                  <Play className="h-4 w-4" aria-hidden="true" /> Launch Session
                </button>
                <button type="button" className={secondaryButton} onClick={onClose}>Cancel</button>
              </div>
            </>
          ) : step.kind === "error" ? (
            <>
              <PartError title="Nothing was launched" message={step.message} />
              <button type="button" className={secondaryButton} onClick={onClose}>Close</button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
