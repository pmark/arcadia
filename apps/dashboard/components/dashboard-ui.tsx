import {
  AlertTriangle,
  Archive,
  BookOpenText,
  CheckCircle2,
  Circle,
  Clock3,
  FileText,
  History,
  PauseCircle,
  Play,
  Radio,
  Sparkles
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useState } from "react";
import type {
  DashboardArtifact,
  DashboardAttentionItem,
  DashboardActivityEvent,
  DashboardBackBurnerItem,
  DashboardBloggingSnapshot,
  DashboardDailyAdvantage,
  DashboardMilestone,
  DashboardProject,
  DashboardRebusterSnapshot,
  DashboardReviewItem,
  DashboardRun
} from "../lib/types";

interface MetricProps {
  label: string;
  value: number;
  tone: "green" | "gold" | "clay" | "steel" | "neutral";
}

export function Metric({ label, value, tone }: MetricProps) {
  const toneClass = {
    green: "border-moss text-moss",
    gold: "border-gold text-gold",
    clay: "border-clay text-clay",
    steel: "border-steel text-steel",
    neutral: "border-line text-ink"
  }[tone];

  return (
    <div className={`min-w-0 rounded-md border bg-panel p-3 shadow-soft ${toneClass}`}>
      <div className="min-w-0 text-2xl font-semibold leading-none">{value}</div>
      <div className="mt-1 min-w-0 break-words text-xs font-medium uppercase leading-4 tracking-wide text-muted">
        {label}
      </div>
    </div>
  );
}

export function StatusBadge({ status, label }: { status: string; label: string }) {
  const className = statusClass(status);
  return (
    <span className={`inline-flex h-7 items-center rounded-md border px-2 text-xs font-semibold ${className}`}>
      {label}
    </span>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed border-line bg-panel px-4 py-8 text-center text-sm text-muted">
      {text}
    </div>
  );
}

export function ErrorState({ message, title = "Snapshot unavailable" }: { message: string; title?: string }) {
  return (
    <div className="rounded-md border border-clay bg-panel p-4 text-sm text-clay">
      <div className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        {title}
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words text-ink">{message}</p>
    </div>
  );
}

export function LoadingState() {
  return (
    <div className="grid gap-3">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="h-24 animate-pulse rounded-md border border-line bg-panel" />
      ))}
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid min-w-0 gap-3">
      <h2 className="min-w-0 text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function DailyAdvantageCard({
  advantage,
  pending,
  onPrepare
}: {
  advantage: DashboardDailyAdvantage;
  pending: boolean;
  onPrepare: (advantage: DashboardDailyAdvantage) => void;
}) {
  return (
    <article className="min-w-0 rounded-md border border-moss/40 bg-panel p-4 shadow-soft sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-moss">{advantage.projectName}</p>
          <h3 className="mt-1 break-words text-lg font-semibold leading-6">{advantage.actionTitle}</h3>
        </div>
        <StatusBadge status={advantage.status === "prepared" ? "open" : "ready"} label={advantage.statusLabel} />
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <Field label="Milestone" value={advantage.milestoneTitle} />
        <Field label="Expected Artifact" value={advantage.expectedArtifact} />
        <div className="sm:col-span-2"><Field label="Why It Matters" value={advantage.whyItMatters} /></div>
        <div className="sm:col-span-2"><Field label="Why Now" value={advantage.whyNow} /></div>
      </dl>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {advantage.status === "prepared" ? (
          <Link
            href="/review"
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-moss/30 bg-moss/10 px-4 text-sm font-semibold text-moss transition hover:border-moss"
          >
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            Open Review
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => onPrepare(advantage)}
            disabled={pending}
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-moss/30 bg-moss/10 px-4 text-sm font-semibold text-moss transition hover:border-moss disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            {pending ? "Preparing…" : "Prepare Planning Decision"}
          </button>
        )}
        <Link
          href={`/projects/${encodeURIComponent(advantage.projectId)}`}
          className="inline-flex min-h-11 items-center rounded-md border border-line px-4 text-sm font-semibold text-muted transition hover:border-steel hover:text-steel"
        >
          View Project
        </Link>
      </div>
    </article>
  );
}

export function ProjectCard({ project }: { project: DashboardProject }) {
  return (
    <article className="min-w-0 rounded-md border border-line bg-panel p-4 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold leading-6">
            <Link href={`/projects/${encodeURIComponent(project.id)}`} className="transition hover:text-steel">
              {project.name}
            </Link>
          </h3>
          <p className="mt-1 text-sm leading-5 text-muted">{project.mission}</p>
        </div>
        <StatusBadge status={project.status} label={project.statusLabel} />
      </div>
      {project.setupWarnings.length > 0 ? (
        <div className="mt-4 rounded-md border border-clay/30 bg-clay/10 px-3 py-2 text-sm font-medium text-clay">
          {project.setupWarnings[0]}
        </div>
      ) : null}
      <dl className="mt-4 grid gap-3 text-sm">
        <Field label="Repository" value={project.repoPath ?? "Not configured"} />
        <Field label="Outcome" value={project.outcome ?? project.goal ?? "None"} />
        <Field label="Current Milestone" value={project.currentMilestone ?? "None"} />
        <Field label="Next Action" value={project.nextAction ?? "None"} />
        <Field label="Last Artifact" value={project.lastArtifact?.title ?? "None"} />
      </dl>
      <div className="mt-4">
        <Link
          href={`/projects/${encodeURIComponent(project.id)}`}
          className="inline-flex min-h-10 items-center rounded-md border border-steel/30 bg-steel/10 px-3 text-sm font-semibold text-steel transition hover:border-steel"
        >
          {project.repoPath ? "View Details" : "Set Repository Path"}
        </Link>
      </div>
    </article>
  );
}

export function AttentionCard({
  item,
  pendingAction,
  onReviewAction
}: {
  item: DashboardAttentionItem;
  pendingAction?: string | null;
  onReviewAction?: (item: DashboardAttentionItem, action: "approve" | "reject" | "defer") => void;
}) {
  const Icon = item.severity === "blocked" ? AlertTriangle : Radio;

  return (
    <article className="min-w-0 rounded-md border border-line bg-panel p-4 shadow-soft">
      <div className="flex min-w-0 items-start gap-3">
        <Icon className={`mt-1 h-4 w-4 shrink-0 ${item.severity === "blocked" ? "text-clay" : "text-gold"}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="break-words text-base font-semibold leading-6">{item.reason}</h3>
              <p className="mt-1 break-words text-sm text-muted">{item.projectName ?? "Unassigned"}</p>
            </div>
            <StatusBadge status={item.status} label={item.kind === "codex_packet" ? item.statusLabel : labelAttentionKind(item.kind)} />
          </div>
          <dl className="mt-4 grid gap-3 text-sm">
            {item.interpretation ? <Field label="Interpretation" value={item.interpretation} /> : null}
            {item.milestone ? <Field label="Milestone" value={item.milestone} /> : null}
            {item.outcome ? <Field label="Outcome" value={item.outcome} /> : null}
            {item.targetRepositoryRoot ? <Field label="Target Repository Root" value={item.targetRepositoryRoot} /> : null}
            {item.expectedArtifact ? <Field label="Expected Artifact" value={item.expectedArtifact} /> : null}
            <Field label="Related Action" value={item.actionTitle ?? item.workItemTitle ?? item.actionId ?? item.workItemId ?? "None"} />
            <Field label="Related Artifact" value={item.relatedArtifactPath ?? item.relatedArtifactTitle ?? "None"} />
            {item.finalArtifactPath ? <Field label="Final Artifact" value={item.finalArtifactPath} /> : null}
            {item.validationPath ? <Field label="Validation" value={item.validationPath} /> : null}
            {item.safetyBoundaries.length > 0 ? <Field label="Safety Boundaries" value={item.safetyBoundaries.join(" · ")} /> : null}
            {item.responsibility ? <Field label="Responsibility" value={labelStatus(item.responsibility)} /> : null}
            <Field label="Next Action" value={item.nextAction} />
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            {item.primaryActions.map((action) => {
              if (action.reviewAction) {
                const pending = pendingAction === action.reviewAction;
                return (
                  <button
                    key={action.label}
                    type="button"
                    disabled={!onReviewAction || Boolean(pendingAction)}
                    onClick={() => onReviewAction?.(item, action.reviewAction!)}
                    className={`min-h-10 rounded-md border px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${reviewActionClass(action.reviewAction)}`}
                  >
                    {pending ? "Working..." : action.label}
                  </button>
                );
              }

              if (action.href) {
                return (
                  <a
                    key={action.label}
                    href={action.href}
                    className="inline-flex min-h-10 items-center rounded-md border border-steel/30 bg-steel/10 px-3 text-sm font-semibold text-steel transition hover:border-steel"
                  >
                    {action.label}
                  </a>
                );
              }

              return action.command ? (
                <code
                  key={action.label}
                  className="min-w-0 break-all rounded-md border border-line bg-canvas px-3 py-2 text-xs text-muted"
                >
                  {action.label}: {action.command}
                </code>
              ) : null;
            })}
          </div>
        </div>
      </div>
    </article>
  );
}

export function ReviewCard({
  item,
  pendingAction,
  onAction,
  onApproveAndExecute,
  onResolveOption
}: {
  item: DashboardReviewItem;
  pendingAction?: string | null;
  onAction?: (item: DashboardReviewItem, action: "approve" | "reject" | "defer") => void;
  onApproveAndExecute?: (item: DashboardReviewItem) => void;
  onResolveOption?: (item: DashboardReviewItem, option: string) => void;
}) {
  const primaryActions = ["approve", "reject", "defer"] as const;
  const isPlanning = item.resolvedIntent === "CodexPlanningRunApproval" || item.resolvedIntent === "CodexPlanningRetryApproval";
  const isAcceptance = item.resolvedIntent === "CodexPlanningArtifactAcceptance";
  const extraOptions = item.options.filter((option) => !primaryActions.includes(option as (typeof primaryActions)[number]));

  return (
    <article className="min-w-0 rounded-md border border-line bg-panel p-4 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words text-base font-semibold leading-6">{item.displayId || item.id}</h3>
          <p className="mt-1 break-words text-sm text-muted">{item.project ?? "Unassigned"}</p>
        </div>
        <StatusBadge status={item.status} label={item.statusLabel} />
      </div>
      <dl className="mt-4 grid gap-3 text-sm">
        <Field label="Category" value={item.category} />
        <Field label="Original Request" value={item.sourceInput} />
        <Field
          label={item.missingFields.length > 0 ? "Missing Fields" : "Blocking Question"}
          value={item.missingFields.length > 0 ? item.missingFields.join(", ") : item.decisionNeeded}
        />
        <TruncatedField label="Proposed Action" value={item.proposedAction || item.recommendation || "None"} />
        <Field label="Choices" value={item.options.join(", ")} />
        <Field label="Created" value={`${formatDateTime(item.createdAt)} · ${item.statusLabel}`} />
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        {item.promptPath ? (
          <a href={dashboardFileHref(item.promptPath)} className="inline-flex min-h-10 items-center rounded-md border border-steel/30 bg-steel/10 px-3 text-sm font-semibold text-steel">
            View Packet
          </a>
        ) : null}
        {item.resolvedIntent === "CodexPlanningArtifactAcceptance" && item.artifactPath ? (
          <a href={dashboardFileHref(item.artifactPath)} className="inline-flex min-h-10 items-center rounded-md border border-steel/30 bg-steel/10 px-3 text-sm font-semibold text-steel">
            View Plan
          </a>
        ) : null}
        {item.validationPath && item.resolvedIntent !== "CodexPlanningRunApproval" ? (
          <a href={dashboardFileHref(item.validationPath)} className="inline-flex min-h-10 items-center rounded-md border border-steel/30 bg-steel/10 px-3 text-sm font-semibold text-steel">
            View Validation
          </a>
        ) : null}
        {onApproveAndExecute ? (
          <button
            type="button"
            onClick={() => onApproveAndExecute(item)}
            disabled={Boolean(pendingAction)}
            className="inline-flex min-h-10 items-center gap-2 rounded-md border border-moss/30 bg-moss/10 px-3 text-sm font-semibold text-moss transition hover:border-moss disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
            {pendingAction === "approve-execute"
              ? "Working…"
              : isAcceptance
                ? "Accept Plan"
                : isPlanning
                  ? "Approve & Run"
                  : "Approve & Execute"}
          </button>
        ) : null}
        {primaryActions.filter((action) => action !== "approve" || !onApproveAndExecute).map((action) => {
          const pending = pendingAction === action;
          const disabled = Boolean(pendingAction);
          return (
            <button
              key={action}
              type="button"
              onClick={() => onAction?.(item, action)}
              disabled={!onAction || disabled}
              className={`min-h-10 rounded-md border px-3 text-sm font-semibold capitalize transition disabled:cursor-not-allowed disabled:opacity-60 ${reviewActionClass(action)}`}
            >
              {pending ? "Working..." : action}
            </button>
          );
        })}
        {extraOptions.map((option) => {
          const pending = pendingAction === `resolve:${option}`;
          return (
            <button
              key={option}
              type="button"
              onClick={() => onResolveOption?.(item, option)}
              disabled={!onResolveOption || Boolean(pendingAction)}
              className="min-h-10 rounded-md border border-steel/30 bg-steel/10 px-3 text-sm font-semibold text-steel transition hover:border-steel disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? "Working..." : option}
            </button>
          );
        })}
      </div>
    </article>
  );
}

export function BackBurnerCard({
  item,
  pendingAction,
  onPromote,
  onArchive
}: {
  item: DashboardBackBurnerItem;
  pendingAction?: string | null;
  onPromote?: (item: DashboardBackBurnerItem) => void;
  onArchive?: (item: DashboardBackBurnerItem) => void;
}) {
  return (
    <article className="min-w-0 rounded-md border border-line bg-panel p-4 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words text-base font-semibold leading-6">{item.classification}</h3>
          <p className="mt-1 break-words text-sm text-muted">{item.ingressSource}</p>
        </div>
        <StatusBadge status={item.status} label={item.statusLabel} />
      </div>
      <dl className="mt-4 grid gap-3 text-sm">
        <Field label="Original Input" value={item.originalInput} />
        <Field label="Reason" value={item.reason} />
        <Field label="Suggested Next Step" value={item.suggestedNextStep ?? "None"} />
        <Field label="Captured" value={formatDateTime(item.createdAt)} />
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          title="Promote to Action"
          aria-label="Promote to Action"
          onClick={() => onPromote?.(item)}
          disabled={!onPromote || Boolean(pendingAction)}
          className="inline-flex min-h-10 items-center gap-2 rounded-md border border-moss/30 bg-moss/10 px-3 text-sm font-semibold text-moss transition hover:border-moss disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          {pendingAction === "promote" ? "Working..." : "Promote"}
        </button>
        <button
          type="button"
          title="Archive"
          aria-label="Archive"
          onClick={() => onArchive?.(item)}
          disabled={!onArchive || Boolean(pendingAction)}
          className="inline-flex min-h-10 items-center gap-2 rounded-md border border-steel/30 bg-steel/10 px-3 text-sm font-semibold text-steel transition hover:border-steel disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Archive className="h-4 w-4" aria-hidden="true" />
          {pendingAction === "archive" ? "Working..." : "Archive"}
        </button>
      </div>
    </article>
  );
}

export function BloggingPanel({ blogging }: { blogging: DashboardBloggingSnapshot }) {
  return (
    <div className="grid min-w-0 gap-3">
      {blogging.sites.length === 0 ? (
        <EmptyState text="No blog sites configured." />
      ) : (
        <div className="grid min-w-0 gap-3 md:grid-cols-2">
          {blogging.sites.slice(0, 4).map((site) => (
            <article key={site.id} className="min-w-0 rounded-md border border-line bg-panel p-4 shadow-soft">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="break-words text-base font-semibold leading-6">{site.name}</h3>
                  <p className="mt-1 break-words text-sm text-muted">{site.projectName}</p>
                </div>
                <StatusBadge status={site.status} label={site.statusLabel} />
              </div>
              <dl className="mt-4 grid gap-3 text-sm">
                <Field label="Stream" value={site.streamKey} />
                <Field label="Next Scheduled" value={site.nextScheduledTitle ?? "None"} />
        <Field label="Needs Decision" value={String(site.draftsNeedingReview)} />
                <Field label="Ideas" value={String(site.ideasCount)} />
                <Field label="Posts" value={String(site.postsCount)} />
                <Field label="Latest Artifact" value={site.latestArtifactPath ?? "None"} />
              </dl>
            </article>
          ))}
        </div>
      )}
      {blogging.reviewItems.length > 0 ? (
        <div className="grid min-w-0 gap-3">
          {blogging.reviewItems.slice(0, 4).map((item) => (
            <div key={`${item.kind}:${item.id}`} className="flex min-w-0 items-start gap-3 rounded-md border border-line bg-panel p-3 shadow-soft">
              <BookOpenText className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{item.title}</div>
                <div className="mt-1 truncate text-xs text-muted">
                  {item.siteName} · {item.reviewSlug ?? item.reviewItemId}
                </div>
                {item.artifactPath ? <div className="mt-1 truncate font-mono text-xs text-muted">{item.artifactPath}</div> : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function RebusterPanel({ rebuster }: { rebuster: DashboardRebusterSnapshot }) {
  return (
    <div className="grid min-w-0 gap-3">
      <article className="min-w-0 rounded-md border border-line bg-panel p-4 shadow-soft">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="break-words text-base font-semibold leading-6">
              {rebuster.connection.projectName ?? "Rebuster Studio"}
            </h3>
            <p className="mt-1 break-words text-sm text-muted">{rebuster.status.summary}</p>
          </div>
          <StatusBadge status={rebuster.connection.status} label={rebuster.connection.statusLabel} />
        </div>
        <dl className="mt-4 grid gap-3 text-sm">
          <Field label="Repository" value={rebuster.connection.repoPath ?? "Not configured"} />
          <Field label="Dashboard" value={rebuster.connection.dashboardUrl ?? "Not configured"} />
          <Field label="Open Decisions" value={String(rebuster.status.openDecisionCount)} />
          <Field label="Recent Events" value={String(rebuster.status.recentEventCount)} />
          <Field label="Last Sync" value={rebuster.connection.lastSyncAt ?? "Never"} />
        </dl>
      </article>
      {rebuster.decisions.length > 0 ? (
        <div className="grid min-w-0 gap-3">
          {rebuster.decisions.slice(0, 4).map((decision) => (
            <div key={decision.id} className="flex min-w-0 items-start gap-3 rounded-md border border-line bg-panel p-3 shadow-soft">
              <Radio className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{decision.answer}</div>
                <div className="mt-1 truncate text-xs text-muted">
                  {decision.reviewSlug ?? decision.reviewItemId} · {decision.statusLabel}
                </div>
                <div className="mt-1 truncate text-xs text-muted">{decision.summary}</div>
                <a
                  href={decision.rebusterUrl}
                  className="mt-2 inline-flex min-h-9 items-center rounded-md border border-steel/30 bg-steel/10 px-3 text-xs font-semibold text-steel transition hover:border-steel"
                >
                  Open Rebuster
                </a>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {rebuster.recentEvents.length > 0 ? (
        <div className="grid min-w-0 gap-3">
          {rebuster.recentEvents.slice(0, 4).map((event) => (
            <div key={event.id} className="flex min-w-0 items-start gap-3 rounded-md border border-line bg-panel p-3 shadow-soft">
              <History className="mt-0.5 h-4 w-4 shrink-0 text-steel" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{event.answer}</div>
                <div className="mt-1 truncate text-xs text-muted">
                  {event.eventLabel} · {event.statusLabel}
                </div>
                <div className="mt-1 truncate text-xs text-muted">{event.summary}</div>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function RunCard({ run }: { run: DashboardRun }) {
  return (
    <article className="min-w-0 rounded-md border border-line bg-panel p-4 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold leading-6">
            <Link href={`/runs/${encodeURIComponent(run.id)}`} className="transition hover:text-steel">
              {run.workItemTitle}
            </Link>
          </h3>
          <p className="mt-1 font-mono text-xs text-muted">{run.id}</p>
        </div>
        <StatusBadge status={run.status} label={run.statusLabel} />
      </div>
      <dl className="mt-4 grid gap-3 text-sm">
        <Field label="Project" value={run.projectName ?? "Unassigned"} />
        <Field label="Current Step" value={run.currentStep ?? "None"} />
        <Field label="Latest Message" value={run.latestMessage} />
        <Field label="Started" value={formatDateTime(run.startedAt)} />
        <Field label="Updated" value={formatDateTime(run.updatedAt)} />
        <Field label="Completed" value={run.completedAt ? formatDateTime(run.completedAt) : "Running"} />
        <Field label="Mission Log" value={run.missionLogPath ?? "None"} />
        <Field
          label="Artifacts Produced"
          value={
            run.artifactsProduced.length > 0
              ? run.artifactsProduced.map((artifact) => artifact.path ?? artifact.title).join(", ")
              : "None"
          }
        />
        {run.failureReason ? <Field label="Failure Reason" value={run.failureReason} /> : null}
        {run.reviewReason ? <Field label="Decision Reason" value={run.reviewReason} /> : null}
      </dl>
    </article>
  );
}

export function ArtifactRow({ artifact }: { artifact: DashboardArtifact }) {
  return (
    <div className="flex w-full min-w-0 items-start gap-3 rounded-md border border-line bg-panel p-3 shadow-soft">
      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-steel" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">
          {artifact.path ? (
            <a href={dashboardFileHref(artifact.path)} className="transition hover:text-steel">
              {artifact.title}
            </a>
          ) : artifact.title}
        </div>
        <div className="mt-1 truncate text-xs text-muted">
          {artifact.projectName ?? "Unassigned"} · {artifact.statusLabel}
        </div>
        {artifact.path ? <div className="mt-1 break-all font-mono text-xs text-muted">{artifact.path}</div> : null}
      </div>
    </div>
  );
}

export function MilestoneRow({ milestone }: { milestone: DashboardMilestone }) {
  return (
    <div className="flex w-full min-w-0 items-start gap-3 rounded-md border border-line bg-panel p-3 shadow-soft">
      <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{milestone.title}</div>
        <div className="mt-1 truncate text-xs text-muted">{milestone.projectName}</div>
      </div>
    </div>
  );
}

export function SmallRunRow({ run }: { run: DashboardRun }) {
  const Icon = iconForStatus(run.status);

  return (
    <div className="flex w-full min-w-0 items-start gap-3 rounded-md border border-line bg-panel p-3 shadow-soft">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconClass(run.status)}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{run.workItemTitle}</div>
        <div className="mt-1 truncate text-xs text-muted">
          {run.statusLabel} · {run.currentStep ?? "No current step"} · {formatDateTime(run.updatedAt)}
        </div>
      </div>
    </div>
  );
}

export function ActivityRow({ event }: { event: DashboardActivityEvent }) {
  return (
    <div className="flex w-full min-w-0 items-start gap-3 rounded-md border border-line bg-panel p-3 shadow-soft">
      <History className="mt-0.5 h-4 w-4 shrink-0 text-steel" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <div className="text-sm font-semibold">{event.eventLabel}</div>
          <div className="text-xs text-muted">{formatDateTime(event.occurredAt)}</div>
        </div>
        <div className="mt-1 break-words text-sm text-muted">{event.summary}</div>
        <div className="mt-1 truncate text-xs text-muted">
          {event.projectName ?? event.workItemTitle ?? event.artifactPath ?? event.reviewSlug ?? "Workspace"}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {event.reviewId ? <ActivityLink href="/review" label={event.reviewSlug ?? "Review"} /> : null}
          {event.runId ? <ActivityLink href="/runs" label={event.runId} /> : null}
          {event.workItemId ? (
            <ActivityLink href={event.projectId ? `/projects/${encodeURIComponent(event.projectId)}` : "/projects"} label="Work" />
          ) : null}
          {event.backBurnerItemId ? <ActivityLink href="/back-burner" label="Back Burner" /> : null}
          {event.artifactPath ? <ActivityLink href={event.artifactPath} label="Artifact" /> : null}
        </div>
      </div>
    </div>
  );
}

function ActivityLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={dashboardFileHref(href)}
      className="inline-flex min-h-8 items-center rounded-md border border-steel/30 bg-steel/10 px-2 text-xs font-semibold text-steel transition hover:border-steel"
    >
      {label}
    </a>
  );
}

function dashboardFileHref(href: string): string {
  if (href.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(href)) {
    return href;
  }

  return `/api/file/${href.split("/").map(encodeURIComponent).join("/")}`;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-1 min-w-0 [overflow-wrap:anywhere] leading-5">{value}</dd>
    </div>
  );
}

const TRUNCATED_FIELD_LIMIT = 280;

function TruncatedField({ label, value }: { label: string; value: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = value.length > TRUNCATED_FIELD_LIMIT;
  const shown = expanded || !isLong ? value : `${value.slice(0, TRUNCATED_FIELD_LIMIT)}…`;

  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-1 min-w-0 [overflow-wrap:anywhere] leading-5">
        {shown}
        {isLong ? (
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="ml-2 inline text-xs font-semibold text-steel underline underline-offset-2"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        ) : null}
      </dd>
    </div>
  );
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function statusClass(status: string): string {
  if (status === "active" || status === "completed" || status === "ready" || status === "published") {
    return "border-moss/30 bg-moss/10 text-moss";
  }

  if (status === "open") {
    return "border-clay/30 bg-clay/10 text-clay";
  }

  if (status === "paused" || status === "drafted" || status === "planned" || status === "running" || status === "deferred") {
    return "border-gold/30 bg-gold/10 text-gold";
  }

  if (isRequiresReviewStatus(status) || status === "failed" || status === "blocked") {
    return "border-clay/30 bg-clay/10 text-clay";
  }

  return "border-line bg-canvas text-muted";
}

function reviewActionClass(action: "approve" | "reject" | "defer"): string {
  if (action === "approve") {
    return "border-moss/30 bg-moss/10 text-moss hover:border-moss";
  }

  if (action === "reject") {
    return "border-clay/30 bg-clay/10 text-clay hover:border-clay";
  }

  return "border-gold/30 bg-gold/10 text-gold hover:border-gold";
}

function iconForStatus(status: string) {
  if (status === "completed") {
    return CheckCircle2;
  }

  if (status === "failed") {
    return AlertTriangle;
  }

  if (isRequiresReviewStatus(status)) {
    return Radio;
  }

  if (status === "running") {
    return Clock3;
  }

  if (status === "paused") {
    return PauseCircle;
  }

  if (status === "archived") {
    return Archive;
  }

  return Circle;
}

function iconClass(status: string): string {
  if (status === "completed") {
    return "text-moss";
  }

  if (status === "failed" || isRequiresReviewStatus(status)) {
    return "text-clay";
  }

  if (status === "running") {
    return "text-gold";
  }

  return "text-muted";
}

function isRequiresReviewStatus(value: string | null | undefined): boolean {
  return value === "requires_review" || value === "needs_mark";
}

function labelAttentionKind(kind: DashboardAttentionItem["kind"]): string {
  if (kind === "codex_packet") {
    return "Codex Packet";
  }

  if (kind === "blocked_work") {
    return "Blocked Work";
  }

  return labelStatus(kind);
}

function labelStatus(status: string): string {
  return status
    .split("_")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}
