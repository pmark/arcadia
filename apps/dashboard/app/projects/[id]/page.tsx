"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, FileText, Play, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DashboardChrome } from "../../../components/chrome";
import {
  ActivityRow,
  ArtifactRow,
  AttentionCard,
  EmptyState,
  ErrorState,
  LoadingState,
  ReviewCard,
  RunCard,
  Section,
  StatusBadge
} from "../../../components/dashboard-ui";
import { useArcadiaSnapshot } from "../../../hooks/use-arcadia-snapshot";
import { ProofHero } from "../../../components/proof-hero";
import { PlanListRow, orderPlans } from "../../../components/plans-list";
import type { DashboardProject, DashboardReviewItem, ProjectContinuation } from "../../../lib/types";
import type { PlanRow, ProjectPlansResponse } from "../../../lib/plans-types";

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
  const [continuation, setContinuation] = useState<ProjectContinuation | null>(null);
  const [projectReviews, setProjectReviews] = useState<DashboardReviewItem[]>([]);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  const [workPending, setWorkPending] = useState(false);
  const [workMessage, setWorkMessage] = useState<string | null>(null);
  const [workError, setWorkError] = useState<string | null>(null);
  const [reviewPending, setReviewPending] = useState<string | null>(null);
  const [adopting, setAdopting] = useState(false);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [plansError, setPlansError] = useState<string | null>(null);

  useEffect(() => {
    if (project) {
      setForm(formFromProject(project));
    }
  }, [project]);

  useEffect(() => {
    let cancelled = false;
    setContextLoading(true);
    setContextError(null);
    fetch(`/api/projects/${encodeURIComponent(projectId)}/continuation`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) {
          throw new Error(errorMessageFromBody(body, "Project continuation could not be loaded."));
        }
        return body as { continuation: ProjectContinuation; reviewItems: DashboardReviewItem[] };
      })
      .then((body) => {
        if (!cancelled) {
          setContinuation(body.continuation);
          setProjectReviews(body.reviewItems);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setContextError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      })
      .finally(() => {
        if (!cancelled) setContextLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    setPlansLoading(true);
    setPlansError(null);
    fetch(`/api/projects/${encodeURIComponent(projectId)}/plans`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) {
          throw new Error(errorMessageFromBody(body, "Plans could not be loaded."));
        }
        if (!cancelled) {
          setPlans((body as ProjectPlansResponse).plans);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setPlansError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      })
      .finally(() => {
        if (!cancelled) setPlansLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

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
          repositoryUrl: form.repositoryUrl,
          buildAgent: form.buildAgent,
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
        form.repositoryUrl.trim()
          ? "Project proposal settings saved. The scoped staging Decision is ready for approval."
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

  async function getToWork() {
    const actionId = continuation?.context?.action.id;
    if (!actionId) return;
    setWorkPending(true);
    setWorkMessage(null);
    setWorkError(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/continuation`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(errorMessageFromBody(body, "Arcadia could not prepare this Action."));
      setWorkMessage(typeof body.message === "string" ? body.message : "Planning Decision prepared in Review.");
      await loadContinuation();
      await refresh();
    } catch (error) {
      setWorkError(error instanceof Error ? error.message : String(error));
    } finally {
      setWorkPending(false);
    }
  }

  /**
   * Write the Arcadia control documents this repository is missing.
   *
   * Offered next to the blockers rather than in the setup form, because the
   * blockers are where the absence is actually read: a repository with no
   * PROJECT.md reports a refusal here and nowhere else.
   */
  async function adoptRepository() {
    setAdopting(true);
    setWorkMessage(null);
    setWorkError(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/setup-context`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(errorMessageFromBody(body, "Arcadia could not adopt this repository."));
      const skipped: string[] = Array.isArray(body.skipped) ? body.skipped : [];
      setWorkMessage([typeof body.message === "string" ? body.message : "Repository adopted.", ...skipped].join(" "));
      await loadContinuation();
      await refresh();
    } catch (error) {
      setWorkError(error instanceof Error ? error.message : String(error));
    } finally {
      setAdopting(false);
    }
  }

  async function loadContinuation() {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/continuation`);
    const body = await response.json();
    if (!response.ok) throw new Error(errorMessageFromBody(body, "Project continuation could not be loaded."));
    setContinuation(body.continuation as ProjectContinuation);
    setProjectReviews(body.reviewItems as DashboardReviewItem[]);
  }

  async function submitReviewAction(
    item: DashboardReviewItem,
    action: "approve" | "reject" | "defer" | "resolve",
    reply?: string,
    trigger?: string,
    feedback?: string
  ) {
    const key = action === "resolve" ? `${item.id}:resolve` : `${item.id}:${action}`;
    setReviewPending(key);
    setWorkError(null);
    try {
      const response = await fetch("/api/review-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, action, reply, trigger, feedback, requireTrigger: action === "defer" })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(errorMessageFromBody(body, "Review action failed."));
      setWorkMessage(typeof body.message === "string" ? body.message : "Review response recorded.");
      await loadContinuation();
      await refresh();
    } catch (error) {
      setWorkError(error instanceof Error ? error.message : String(error));
    } finally {
      setReviewPending(null);
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
      {contextError ? <ErrorState title="Continuation unavailable" message={contextError} /> : null}
      {workError ? <ErrorState title="Get to work failed" message={workError} /> : null}
      {saveMessage ? (
        <div className="mb-4 rounded-md border border-moss/30 bg-moss/10 px-4 py-3 text-sm font-semibold text-moss">
          {saveMessage}
        </div>
      ) : null}
      {workMessage ? (
        <div className="mb-4 rounded-md border border-moss/30 bg-moss/10 px-4 py-3 text-sm font-semibold text-moss">
          {workMessage} <Link className="ml-2 underline" href="/review">Open Review</Link>
        </div>
      ) : null}

      {loading && !snapshot ? (
        <LoadingState />
      ) : !project ? (
        <EmptyState text="Project not found." />
      ) : (
        <div className="grid min-w-0 gap-6">
          <ProofHero projectId={project.id} />

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
              <ReadOnlyField label="GitHub Repository" value={project.repositoryUrl ?? "Enter before approval"} />
              <ReadOnlyField label="Project Template" value={project.projectTemplate ?? "None"} />
              <ReadOnlyField label="Generator Skill" value={project.generatorSkill ? `$${project.generatorSkill}` : "None"} />
              <ReadOnlyField label="Build Agent" value={project.buildAgent ?? "None"} />
              <ReadOnlyField label="Deployment Target" value={project.deploymentTarget ?? "None"} />
              <ReadOnlyField label="Staging URL" value={project.stagingUrl ?? "Pending approval and successful build"} />
              <ReadOnlyField label="Current Milestone" value={project.currentMilestone ?? "None"} />
              <ReadOnlyField label="Next Action" value={project.nextAction ?? "None"} />
              <ReadOnlyField label="Responsibility" value={project.responsibilityLabel ?? project.workClassificationLabel ?? "None"} />
              <ReadOnlyField label="Outcome" value={project.outcome ?? project.goal ?? "None"} />
              <ReadOnlyField label="Last Artifact" value={project.lastArtifact?.title ?? "None"} />
            </dl>
          </section>

          <section id="get-to-work" className="grid min-w-0 gap-4 rounded-md border border-steel/30 bg-panel p-4 shadow-soft">
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-steel">Continuation</p>
                <h2 className="mt-1 text-xl font-semibold">Get to work</h2>
                <p className="mt-1 max-w-3xl text-sm text-muted">The checked-in project documents below determine whether Arcadia can prepare meaningful work.</p>
              </div>
              <StatusBadge
                status={readinessStatus(continuation)}
                label={readinessLabel(continuation, contextLoading)}
              />
            </div>

            {continuation?.context ? (
              <>
                <dl className="grid gap-3 text-sm md:grid-cols-2">
                  <ReadOnlyField label="Current Milestone" value={continuation.context.milestone ?? "None"} />
                  <ReadOnlyField label="Current Action" value={continuation.context.action.title} />
                  <ReadOnlyField label="Responsibility" value={continuation.context.action.responsibility} />
                  <ReadOnlyField label="Expected Artifact" value={continuation.context.action.expectedArtifact ?? "Missing"} />
                  <ReadOnlyField label="Execution Profile" value={executionProfile(continuation.context.action.resolvedExecution)} />
                  <ReadOnlyField label="Plan Token Impact" value={labelStatus(continuation.context.planTokenImpact)} />
                  <ReadOnlyField label="Documentation Source" value={`${continuation.context.actionPath} · ${continuation.context.activePlan}`} />
                </dl>
                <ReadOnlyField label="Token Budget" value={continuation.context.planTokenBudget} />
                {continuation.context.action.nextAction ? <ReadOnlyField label="Next Action" value={continuation.context.action.nextAction} /> : null}
                {continuation.context.action.source ? <ReadOnlyField label="Why This Action" value={continuation.context.action.source} /> : null}
                {continuation.context.action.acceptanceCriteria.length > 0 ? (
                  <div className="rounded-md border border-line bg-canvas p-3 text-sm">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted">Required Artifact evidence</div>
                    <ul className="mt-2 grid gap-1 pl-5 text-muted">
                      {continuation.context.action.acceptanceCriteria.map((criterion) => <li key={criterion} className="list-disc">{criterion}</li>)}
                    </ul>
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void getToWork()}
                    disabled={!continuation.dispatchable || workPending}
                    className="inline-flex min-h-11 items-center gap-2 rounded-md border border-moss/30 bg-moss/10 px-4 text-sm font-semibold text-moss transition hover:border-moss disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Play className="h-4 w-4" aria-hidden="true" />
                    {workPending ? "Preparing..." : "Get to work"}
                  </button>
                  <span className="text-xs text-muted">Prepares a planning Decision; it does not run code or deploy.</span>
                </div>
              </>
            ) : null}

            {continuation?.operatorQuestion ? (
              <div className="rounded-md border border-gold/40 bg-gold/10 p-3 text-sm">
                <div className="font-semibold text-gold">Your answer is needed</div>
                <p className="mt-1 break-words">{continuation.operatorQuestion}</p>
                <Link href="/review" className="mt-3 inline-flex min-h-10 items-center rounded-md border border-gold/40 bg-panel px-3 text-sm font-semibold text-gold">Resolve in Review</Link>
              </div>
            ) : null}
            {continuation && continuation.blockers.length > 0 ? (
              <div className="grid gap-2">
                <div className="text-sm font-semibold text-clay">What is preventing progress</div>
                {continuation.blockers.map((blocker) => (
                  <div key={`${blocker.relativePath}:${blocker.field}`} className="rounded-md border border-clay/30 bg-clay/10 p-3 text-sm">
                    <div className="font-semibold">{blocker.message}</div>
                    <div className="mt-1 text-muted">{blocker.relativePath} · {blocker.field}</div>
                    <div className="mt-2">Next: {blocker.remedy}</div>
                  </div>
                ))}
                {continuation.blockers.some((blocker) => blocker.relativePath === "PROJECT.md") ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => void adoptRepository()}
                      disabled={adopting || !project?.repoPath}
                      className="inline-flex min-h-11 items-center gap-2 rounded-md border border-steel/30 bg-steel/10 px-4 text-sm font-semibold text-steel transition hover:border-steel disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <FileText className="h-4 w-4" aria-hidden="true" />
                      {adopting ? "Writing..." : "Write the missing documents"}
                    </button>
                    <span className="text-xs text-muted">
                      {project?.repoPath
                        ? "Seeds PROJECT.md and a first plan from this Project's own record. Never overwrites a document you wrote."
                        : "Set this Project's repository path first."}
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}
            {!contextLoading && continuation?.context === null && continuation?.blockers.length === 0 ? <EmptyState text="No current Action could be resolved from the project documents." /> : null}
          </section>

          <Section title="Plans">
            {plansError ? <ErrorState title="Plans unavailable" message={plansError} /> : null}
            {plansLoading && plans.length === 0 && !plansError ? (
              <p className="text-sm text-muted">Loading...</p>
            ) : plans.length === 0 && !plansError ? (
              <EmptyState text="No plan documents found for this project." />
            ) : (
              <div className="grid min-w-0 gap-2">
                {orderPlans(plans).slice(0, 4).map((plan) => (
                  <PlanListRow key={plan.slug} plan={plan} detailed={false} />
                ))}
              </div>
            )}
            <Link
              href={`/projects/${encodeURIComponent(projectId)}/plans`}
              className="inline-flex min-h-9 w-fit items-center gap-1 text-sm font-semibold text-steel transition hover:underline"
            >
              {plans.length > 4 ? `View all ${plans.length} plans` : "View plans"} →
            </Link>
          </Section>

          {projectReviews.length > 0 ? (
            <Section title="Resolve open questions for this project">
              <div className="grid min-w-0 gap-3">
                {projectReviews.map((item) => (
                  <ReviewCard
                    key={item.id}
                    item={item}
                    pendingAction={reviewPending?.startsWith(`${item.id}:`) ? reviewPending.slice(item.id.length + 1) : null}
                    onAction={(reviewItem, action) => void submitReviewAction(reviewItem, action)}
                    onDefer={(reviewItem, trigger) => void submitReviewAction(reviewItem, "defer", undefined, trigger)}
                    onRefine={(reviewItem, feedback) => void submitReviewAction(reviewItem, "reject", undefined, undefined, feedback)}
                    onResolveOption={(reviewItem, option) => void submitReviewAction(reviewItem, "resolve", option)}
                    onResolveReply={(reviewItem, reply) => void submitReviewAction(reviewItem, "resolve", reply)}
                  />
                ))}
              </div>
            </Section>
          ) : null}

          <section id="project-setup" className="grid min-w-0 gap-3">
            <h2 className="text-base font-semibold">Project Setup</h2>
            <form onSubmit={(event) => void submitProjectSetup(event)} className="grid min-w-0 gap-4 rounded-md border border-line bg-panel p-4 shadow-soft">
              {project.projectTemplate ? (
                <div className="rounded-md border border-steel/30 bg-steel/10 p-3 text-sm">
                  <div className="font-semibold text-steel">Proposed automated staging build</div>
                  <p className="mt-1 text-muted">Save the empty GitHub repository URL and coding agent here, then approve the Project proposal Decision above. Approval covers repository initialization, scaffold generation, build validation, one Cloudflare Workers Static Assets deployment to the staging environment, and Discord notification. It does not cover production, a custom domain, or Git push.</p>
                </div>
              ) : null}

              <label className="grid min-w-0 gap-1 text-sm font-semibold">
                Empty GitHub Repository URL
                <input
                  value={form.repositoryUrl}
                  onChange={(event) => setForm((current) => ({ ...current, repositoryUrl: event.target.value }))}
                  placeholder="https://github.com/owner/repository"
                  className="min-h-11 min-w-0 rounded-md border border-line bg-canvas px-3 font-mono text-sm font-normal text-ink outline-none transition focus:border-steel"
                />
              </label>

              <label className="grid min-w-0 gap-1 text-sm font-semibold">
                Coding Agent
                <select
                  value={form.buildAgent}
                  onChange={(event) => setForm((current) => ({ ...current, buildAgent: event.target.value as ProjectSetupForm["buildAgent"] }))}
                  className="min-h-11 min-w-0 rounded-md border border-line bg-canvas px-3 text-sm font-normal text-ink outline-none transition focus:border-steel"
                >
                  <option value="codex">Codex</option>
                  <option value="claude-code">Claude Code</option>
                </select>
              </label>

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
  repositoryUrl: string;
  buildAgent: "codex" | "claude-code";
  validationCommands: string;
  mission: string;
  status: string;
}

function emptyForm(): ProjectSetupForm {
  return {
    repoPath: "",
    repositoryUrl: "",
    buildAgent: "codex",
    validationCommands: "",
    mission: "",
    status: "active"
  };
}

function formFromProject(project: DashboardProject): ProjectSetupForm {
  return {
    repoPath: project.repoPath ?? "",
    repositoryUrl: project.repositoryUrl ?? "",
    buildAgent: project.buildAgent === "claude-code" ? "claude-code" : "codex",
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

function readinessStatus(continuation: ProjectContinuation | null): string {
  if (!continuation) return "pending";
  if (continuation.blockers.length > 0) return "blocked";
  if (continuation.operatorQuestion) return "question_open";
  if (continuation.dispatchable) return "ready";
  return "requires_review";
}

function readinessLabel(continuation: ProjectContinuation | null, loading: boolean): string {
  if (loading) return "Checking documents";
  if (!continuation) return "Unavailable";
  if (continuation.blockers.length > 0) return "Blocked by documentation";
  if (continuation.operatorQuestion) return "Waiting for your answer";
  if (continuation.dispatchable) return "Ready to prepare";
  return "Requires review";
}

function executionProfile(value: unknown): string {
  if (!value || typeof value !== "object") return "Not resolved";
  const profile = "profile" in value && typeof value.profile === "string" ? value.profile : null;
  if (profile) return profile;
  const schema = "schema" in value && typeof value.schema === "string" ? value.schema : null;
  return schema ?? "Resolved (profile not named)";
}
