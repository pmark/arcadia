"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DashboardChrome } from "../../../components/chrome";
import {
  ActivityRow,
  ArtifactRow,
  AttentionCard,
  EmptyState,
  ErrorState,
  LoadingState,
  RunCard,
  Section,
  StatusBadge
} from "../../../components/dashboard-ui";
import { useArcadiaSnapshot } from "../../../hooks/use-arcadia-snapshot";
import type { DashboardProject } from "../../../lib/types";

const PROJECT_STATUSES = ["active", "paused", "incubating", "completed"] as const;

export default function ProjectDetailsPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const { snapshot, error, loading, refreshing, lastLoadedAt, refresh } = useArcadiaSnapshot();
  const project = snapshot?.projects.find((candidate) => candidate.id === projectId) ?? null;
  const [form, setForm] = useState<ProjectSetupForm>(() => emptyForm());
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (project) {
      setForm(formFromProject(project));
    }
  }, [project]);

  const related = useMemo(() => {
    if (!snapshot) {
      return null;
    }

    return {
      attentionItems: snapshot.attentionItems.filter((item) => item.projectId === projectId),
      reviewItems: snapshot.requiresReviewItems.filter((item) => item.projectId === projectId),
      runs: snapshot.recentRuns.filter((run) => run.projectId === projectId),
      artifacts: snapshot.recentArtifacts.filter((artifact) => artifact.projectId === projectId),
      activityEvents: snapshot.activityEvents.filter((event) => event.projectId === projectId)
    };
  }, [projectId, snapshot]);

  async function submitProjectSetup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setSaveMessage(null);
    setSaveError(null);

    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoPath: form.repoPath,
          validationCommands: linesFromTextArea(form.validationCommands),
          mission: form.mission,
          status: form.status
        })
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(errorMessageFromBody(body, "Project setup save failed."));
      }

      setSaveMessage(
        form.repoPath.trim()
          ? "Repository path saved. Codex work can now be prepared for this project."
          : typeof body.message === "string"
            ? body.message
            : "Project setup saved."
      );
      await refresh();
    } catch (submitError) {
      setSaveError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <DashboardChrome
      title={project?.name ?? "Project"}
      subtitle={project?.repoPath ?? "Repository not configured"}
      refreshing={refreshing}
      lastLoadedAt={lastLoadedAt}
      onRefresh={() => void refresh()}
    >
      <div className="mb-4">
        <Link
          href="/projects"
          className="inline-flex min-h-9 items-center gap-2 rounded-md border border-line bg-panel px-3 text-sm font-semibold text-muted transition hover:border-steel hover:text-steel"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Projects
        </Link>
      </div>

      {error ? <ErrorState message={error} /> : null}
      {saveError ? <ErrorState title="Save failed" message={saveError} /> : null}
      {saveMessage ? (
        <div className="mb-4 rounded-md border border-moss/30 bg-moss/10 px-4 py-3 text-sm font-semibold text-moss">
          {saveMessage}
        </div>
      ) : null}

      {loading && !snapshot ? (
        <LoadingState />
      ) : !project ? (
        <EmptyState text="Project not found." />
      ) : (
        <div className="grid min-w-0 gap-6">
          <section className="grid min-w-0 gap-4 rounded-md border border-line bg-panel p-4 shadow-soft">
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="break-words text-xl font-semibold leading-7">{project.name}</h2>
                <p className="mt-1 break-words text-sm text-muted">{project.mission}</p>
              </div>
              <StatusBadge status={project.status} label={project.statusLabel} />
            </div>

            {project.setupWarnings.length > 0 ? (
              <div className="rounded-md border border-clay/30 bg-clay/10 p-3 text-sm text-clay">
                <div className="flex min-w-0 items-start gap-2 font-semibold">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{project.setupWarnings[0]}</span>
                </div>
                <a
                  href="#project-setup"
                  className="mt-3 inline-flex min-h-10 items-center rounded-md border border-clay/30 bg-panel px-3 text-sm font-semibold text-clay transition hover:border-clay"
                >
                  Set Repository Path
                </a>
              </div>
            ) : null}

            <dl className="grid gap-3 text-sm md:grid-cols-2">
              <ReadOnlyField label="Repository" value={project.repoPath ?? "Not configured"} />
              <ReadOnlyField label="Current Milestone" value={project.currentMilestone ?? "None"} />
              <ReadOnlyField label="Next Action" value={project.nextAction ?? "None"} />
              <ReadOnlyField label="Responsibility" value={project.responsibilityLabel ?? project.workClassificationLabel ?? "None"} />
              <ReadOnlyField label="Outcome" value={project.outcome ?? project.goal ?? "None"} />
              <ReadOnlyField label="Last Artifact" value={project.lastArtifact?.title ?? "None"} />
            </dl>
          </section>

          <section id="project-setup" className="grid min-w-0 gap-3">
            <h2 className="text-base font-semibold">Project Setup</h2>
            <form onSubmit={(event) => void submitProjectSetup(event)} className="grid min-w-0 gap-4 rounded-md border border-line bg-panel p-4 shadow-soft">
              <label className="grid min-w-0 gap-1 text-sm font-semibold">
                Repository Path
                <input
                  value={form.repoPath}
                  onChange={(event) => setForm((current) => ({ ...current, repoPath: event.target.value }))}
                  className="min-h-11 min-w-0 rounded-md border border-line bg-canvas px-3 font-mono text-sm font-normal text-ink outline-none transition focus:border-steel"
                />
              </label>

              <label className="grid min-w-0 gap-1 text-sm font-semibold">
                Mission
                <textarea
                  value={form.mission}
                  onChange={(event) => setForm((current) => ({ ...current, mission: event.target.value }))}
                  rows={3}
                  className="min-w-0 resize-y rounded-md border border-line bg-canvas px-3 py-2 text-sm font-normal leading-5 text-ink outline-none transition focus:border-steel"
                />
              </label>

              <label className="grid min-w-0 gap-1 text-sm font-semibold">
                Status
                <select
                  value={form.status}
                  onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}
                  className="min-h-11 min-w-0 rounded-md border border-line bg-canvas px-3 text-sm font-normal text-ink outline-none transition focus:border-steel"
                >
                  {PROJECT_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {labelStatus(status)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid min-w-0 gap-1 text-sm font-semibold">
                Validation Commands
                <textarea
                  value={form.validationCommands}
                  onChange={(event) => setForm((current) => ({ ...current, validationCommands: event.target.value }))}
                  rows={4}
                  className="min-w-0 resize-y rounded-md border border-line bg-canvas px-3 py-2 font-mono text-sm font-normal leading-5 text-ink outline-none transition focus:border-steel"
                />
                <span className="text-xs font-normal text-muted">Saved as project configuration only. Dashboard does not execute validation commands.</span>
              </label>

              <button
                type="submit"
                disabled={saving || !form.mission.trim()}
                className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md border border-moss/30 bg-moss/10 px-4 text-sm font-semibold text-moss transition hover:border-moss disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Save className="h-4 w-4" aria-hidden="true" />
                {saving ? "Saving..." : "Save Project Setup"}
              </button>
            </form>
          </section>

          {related ? (
            <>
              <Section title="Active Work And Attention">
                {related.attentionItems.length > 0 ? (
                  <div className="grid min-w-0 gap-3">
                    {related.attentionItems.map((item) => (
                      <AttentionCard key={item.id} item={item} />
                    ))}
                  </div>
                ) : (
                  <EmptyState text="No active project attention items." />
                )}
              </Section>

              <Section title="Requires Review">
                {related.reviewItems.length > 0 ? (
                  <div className="grid min-w-0 gap-3">
                    {related.reviewItems.map((item) => (
                      <div key={item.id} className="rounded-md border border-line bg-panel p-4 shadow-soft">
                        <div className="text-sm font-semibold">{item.displayId}</div>
                        <div className="mt-1 break-words text-sm text-muted">{item.decisionNeeded}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState text="No project Requires Review Decisions." />
                )}
              </Section>

              <Section title="Related Runs">
                {related.runs.length > 0 ? (
                  <div className="grid min-w-0 gap-3 md:grid-cols-2">
                    {related.runs.map((run) => (
                      <RunCard key={run.id} run={run} />
                    ))}
                  </div>
                ) : (
                  <EmptyState text="No recent project runs." />
                )}
              </Section>

              <Section title="Recent Artifacts">
                {related.artifacts.length > 0 ? (
                  <div className="grid min-w-0 gap-3 md:grid-cols-2">
                    {related.artifacts.map((artifact) => (
                      <ArtifactRow key={artifact.id} artifact={artifact} />
                    ))}
                  </div>
                ) : (
                  <EmptyState text="No recent project artifacts." />
                )}
              </Section>

              <Section title="Recent Activity">
                {related.activityEvents.length > 0 ? (
                  <div className="grid min-w-0 gap-3">
                    {related.activityEvents.map((event) => (
                      <ActivityRow key={event.id} event={event} />
                    ))}
                  </div>
                ) : (
                  <EmptyState text="No recent project activity." />
                )}
              </Section>
            </>
          ) : null}
        </div>
      )}
    </DashboardChrome>
  );
}

interface ProjectSetupForm {
  repoPath: string;
  validationCommands: string;
  mission: string;
  status: string;
}

function emptyForm(): ProjectSetupForm {
  return {
    repoPath: "",
    validationCommands: "",
    mission: "",
    status: "active"
  };
}

function formFromProject(project: DashboardProject): ProjectSetupForm {
  return {
    repoPath: project.repoPath ?? "",
    validationCommands: project.validationCommands.join("\n"),
    mission: project.mission,
    status: project.status
  };
}

function linesFromTextArea(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-1 break-words leading-5">{value}</dd>
    </div>
  );
}

function labelStatus(status: string): string {
  return status
    .split("_")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function errorMessageFromBody(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") {
    return fallback;
  }

  const error = "error" in body && typeof body.error === "string" ? body.error : fallback;
  const details = "details" in body ? body.details : null;
  if (!details) {
    return error;
  }

  return `${error}\n${JSON.stringify(details, null, 2)}`;
}
