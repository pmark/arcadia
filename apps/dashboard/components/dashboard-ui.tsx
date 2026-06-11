import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Circle,
  Clock3,
  FileText,
  PauseCircle,
  Radio,
  Sparkles
} from "lucide-react";
import type { ReactNode } from "react";
import type {
  DashboardArtifact,
  DashboardMilestone,
  DashboardProject,
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

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-clay bg-panel p-4 text-sm text-clay">
      <div className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        Snapshot unavailable
      </div>
      <p className="mt-2 break-words text-ink">{message}</p>
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

export function ProjectCard({ project }: { project: DashboardProject }) {
  return (
    <article className="min-w-0 rounded-md border border-line bg-panel p-4 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold leading-6">{project.name}</h3>
          <p className="mt-1 text-sm leading-5 text-muted">{project.mission}</p>
        </div>
        <StatusBadge status={project.status} label={project.statusLabel} />
      </div>
      <dl className="mt-4 grid gap-3 text-sm">
        <Field label="Goal" value={project.goal ?? "None"} />
        <Field label="Current Milestone" value={project.currentMilestone ?? "None"} />
        <Field label="Next Action" value={project.nextAction ?? "None"} />
        <Field label="Last Artifact" value={project.lastArtifact?.title ?? "None"} />
      </dl>
    </article>
  );
}

export function ReviewCard({ item }: { item: DashboardReviewItem }) {
  return (
    <article className="min-w-0 rounded-md border border-line bg-panel p-4 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold leading-6">{item.title}</h3>
          <p className="mt-1 text-sm text-muted">{item.projectName ?? "Unassigned"}</p>
        </div>
        <StatusBadge status="needs_mark" label="Requires Review" />
      </div>
      <dl className="mt-4 grid gap-3 text-sm">
        <Field label="Milestone" value={item.milestoneTitle ?? "None"} />
        <Field label="Next Action" value={item.nextAction} />
        <Field label="Expected Artifact" value={item.expectedArtifact ?? "None"} />
      </dl>
    </article>
  );
}

export function RunCard({ run }: { run: DashboardRun }) {
  return (
    <article className="min-w-0 rounded-md border border-line bg-panel p-4 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold leading-6">{run.workItemTitle}</h3>
          <p className="mt-1 font-mono text-xs text-muted">{run.id}</p>
        </div>
        <StatusBadge status={run.status} label={run.statusLabel} />
      </div>
      <dl className="mt-4 grid gap-3 text-sm">
        <Field label="Started" value={formatDateTime(run.startedAt)} />
        <Field label="Completed" value={run.completedAt ? formatDateTime(run.completedAt) : "Running"} />
        <Field
          label="Artifacts Produced"
          value={
            run.artifactsProduced.length > 0
              ? run.artifactsProduced.map((artifact) => artifact.title).join(", ")
              : "None"
          }
        />
        {run.failureReason ? <Field label="Failure Reason" value={run.failureReason} /> : null}
        {run.reviewReason ? <Field label="Review Reason" value={run.reviewReason} /> : null}
      </dl>
    </article>
  );
}

export function ArtifactRow({ artifact }: { artifact: DashboardArtifact }) {
  return (
    <div className="flex w-full min-w-0 items-start gap-3 rounded-md border border-line bg-panel p-3 shadow-soft">
      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-steel" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{artifact.title}</div>
        <div className="mt-1 truncate text-xs text-muted">
          {artifact.projectName ?? "Unassigned"} · {artifact.statusLabel}
        </div>
        {artifact.path ? <div className="mt-1 truncate font-mono text-xs text-muted">{artifact.path}</div> : null}
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
          {run.statusLabel} · {formatDateTime(run.startedAt)}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-1 break-words leading-5">{value}</dd>
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

  if (status === "paused" || status === "drafted" || status === "planned" || status === "running") {
    return "border-gold/30 bg-gold/10 text-gold";
  }

  if (status === "needs_mark" || status === "failed" || status === "blocked") {
    return "border-clay/30 bg-clay/10 text-clay";
  }

  return "border-line bg-canvas text-muted";
}

function iconForStatus(status: string) {
  if (status === "completed") {
    return CheckCircle2;
  }

  if (status === "failed") {
    return AlertTriangle;
  }

  if (status === "needs_mark") {
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

  if (status === "failed" || status === "needs_mark") {
    return "text-clay";
  }

  if (status === "running") {
    return "text-gold";
  }

  return "text-muted";
}
