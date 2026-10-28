"use client";

import Link from "next/link";
import { useState } from "react";
import { useRead } from "./use-read";
import { WorkspaceAsk } from "./workspace-ask";
import { GoSource, WorkspaceNextMove, useGoRead, type GoRead } from "./workspace-next-move";
import type { AllPlansResponse, PlanDetailResponse, PlanRow, PlanSummariesResponse } from "../../lib/plans-types";
import { actionSummaryView, planSummaryView, type ActionSummaryView, type PlanSummaryView } from "../../lib/workspace-summaries";
import { groupPlans, planProgress } from "../../lib/workspace-plans";
import { goRelation } from "../../lib/workspace-go";
import { parseWorkspaceScope, workspaceActionId, workspaceHref } from "../../lib/workspace-scope";

/** Go's recorded details for the selected Action, shown only when it is Go's current Action. */
function GoActionDetails({ go }: { go: GoRead }) {
  const move = go.last?.move;
  if (!move || move.kind === "none") return null;
  const { action } = move;
  return <section className="workspace-go-work" aria-labelledby="workspace-go-work-title">
    <h2 id="workspace-go-work-title">What Go has for this Action</h2>
    <GoSource go={go} />
    <dl className="workspace-facts">
      <dt>Next</dt><dd>{action.next ?? "None recorded"}</dd>
      <dt>Expected result</dt><dd>{action.artifact ?? "None recorded"}</dd>
    </dl>
    {action.decisions.length > 0 && <><h3>Decisions it needs</h3><ul>{action.decisions.map((d, i) => <li key={i}>{d.question} · {d.resolved ? "answered" : "open"}</li>)}</ul></>}
    {action.acceptance.length > 0 && <details><summary>Acceptance criteria ({action.acceptance.length})</summary><ol>{action.acceptance.map((c, i) => <li key={i}>{c}</li>)}</ol></details>}
  </section>;
}

/** A summary is a reading aid; this says so, and says when it was written before the record changed. */
function SummaryNote({ stale }: { stale: boolean }) {
  return <p className={`workspace-summary-note${stale ? " stale" : ""}`}>{stale ? "Plain-language summary, written before this record last changed. The record governs." : "Plain-language summary. The record governs."}</p>;
}

function PlanLink({ project, plan, current = false, summaries }: { project: string; plan: PlanRow; current?: boolean; summaries: PlanSummariesResponse | null }) {
  const progress = planProgress(plan);
  const view = planSummaryView(summaries, plan.slug);
  return <li><Link href={workspaceHref({ project, plan: plan.slug })} className={current ? "workspace-current" : undefined}>
    <span className="workspace-entity-kind">Plan · {plan.status}{plan.isActivePlan ? " · active" : ""}</span>
    <strong>{view?.title ?? plan.slug}</strong>{view ? <span>{view.purpose}</span> : plan.milestone && <span>{plan.milestone}</span>}{progress && <span>{progress}</span>}
    {view && <span className="workspace-slug">{plan.slug}{view.stale ? " · summary may be out of date" : ""}</span>}
  </Link></li>;
}

/** Why the selected Plan exists, from its summary, with the recorded milestone kept beside it. */
function PlanPurpose({ view, milestone }: { view: PlanSummaryView | null; milestone: string | null }) {
  if (!view) return milestone ? <dl className="workspace-facts"><dt>Milestone</dt><dd>{milestone}</dd></dl> : null;
  return <section className="workspace-summary" aria-label="Why this Plan exists">
    <SummaryNote stale={view.stale} />
    <dl className="workspace-facts">
      <dt>Why this Plan exists</dt><dd>{view.purpose}</dd>
      {view.serves && <><dt>What it serves</dt><dd>{view.serves}</dd></>}
      <dt>Done when</dt><dd>{view.doneWhen}</dd>
      {milestone && <><dt>Recorded milestone</dt><dd>{milestone}</dd></>}
    </dl>
    {view.readingNote && <p className="workspace-reading-note">{view.readingNote}</p>}
  </section>;
}

/** Why the selected Action exists, from its summary; the recorded title stays available. */
function ActionPurpose({ view, recordedTitle }: { view: ActionSummaryView | null; recordedTitle: string }) {
  if (!view) return null;
  return <section className="workspace-summary" aria-label="Why this Action exists">
    <SummaryNote stale={view.stale} />
    <dl className="workspace-facts">
      <dt>Why it exists</dt><dd>{view.why}</dd>
      <dt>Done when</dt><dd>{view.doneWhen}</dd>
    </dl>
    {view.note && <p className="workspace-reading-note">{view.note}</p>}
    {view.title !== recordedTitle && <details><summary>Recorded title</summary><p>{recordedTitle}</p></details>}
  </section>;
}

/**
 * Go's current Plan leads (from Go's last good read, labelled when a later read failed); other active Plans
 * follow; not-yet-active and finished Plans wait behind disclosures. A label never claims Go named a Plan it did not.
 */
function ProjectPlans({ project, plans, goPlan, goNamedNone, stale, summaries }: { project: string; plans: PlanRow[]; goPlan: string | null; goNamedNone: boolean; stale: boolean; summaries: PlanSummariesResponse | null }) {
  const groups = groupPlans(plans, goPlan);
  const list = (rows: PlanRow[]) => <ul className="workspace-entities">{rows.map(p => <PlanLink key={p.slug} project={project} plan={p} summaries={summaries} />)}</ul>;
  const heading = groups.source === "go" ? `Go's current Plan${stale ? " · last good read" : ""}` : "Recorded active Plan";
  return <>
    {groups.missingGoPlan && <p className="workspace-muted">Go{stale ? "'s last good read" : ""} names Plan {groups.missingGoPlan}, which this list does not include yet. Refresh to read the list again.</p>}
    {groups.current ? <><h3 className="workspace-group">{heading}</h3><ul className="workspace-entities"><PlanLink project={project} plan={groups.current} current summaries={summaries} /></ul></>
      : <p>No active Plan is recorded{goNamedNone ? ", and Go names none" : ""}.</p>}
    {groups.otherActive.length > 0 && <><h3 className="workspace-group">{groups.current ? "Also marked active" : "Marked active"} ({groups.otherActive.length})</h3>
      {groups.source === "go" && <p className="workspace-muted">Their status says active, but Go is not working on them.</p>}{list(groups.otherActive)}</>}
    {groups.upcoming.length > 0 && <details className="workspace-group-more"><summary>Not yet active ({groups.upcoming.length})</summary>{list(groups.upcoming)}</details>}
    {groups.finished.length > 0 && <details className="workspace-group-more"><summary>Finished ({groups.finished.length})</summary>{list(groups.finished)}</details>}
  </>;
}

export function WorkspaceView({ parts }: { parts: string[] }) {
  const scope = parseWorkspaceScope(parts);
  const [revision, setRevision] = useState(0);
  const portfolio = useRead<AllPlansResponse>(scope ? "/api/plans" : null, revision);
  const detail = useRead<PlanDetailResponse>(scope?.project && scope.plan ? `/api/plans/${encodeURIComponent(scope.project)}/${encodeURIComponent(scope.plan)}` : null, revision);
  const project = portfolio.kind === "ready" ? portfolio.data.projects.find(p => p.slug === scope?.project) : undefined;
  const plan = project?.plans?.find(p => p.slug === scope?.plan);
  const action = detail.kind === "ready" ? detail.data.progress.actions.find(a => workspaceActionId(a.key) === scope?.action) : undefined;
  // Summaries are optional reading aids: a failed or empty read leaves every view on the record.
  const summaryRead = useRead<PlanSummariesResponse>(scope?.project ? `/api/plan-summaries/${encodeURIComponent(scope.project)}` : null, revision);
  const summaries = summaryRead.kind === "ready" ? summaryRead.data : null;
  // A summary only names what the record still has; an orphaned entry never relabels a missing Plan or Action.
  const planView = plan ? planSummaryView(summaries, scope?.plan) : null;
  const actionView = action ? actionSummaryView(summaries, scope?.plan, scope?.action) : null;
  const level = scope?.action ? "Action" : scope?.plan ? "Plan" : scope?.project ? "Project" : "Portfolio";
  const title = scope?.action ? actionView?.title ?? action?.title ?? scope.action : scope?.plan ? planView?.title ?? plan?.slug ?? scope.plan : scope?.project ? project?.name ?? scope.project : "Your work, in view";
  const failure = portfolio.kind === "error" ? portfolio.message : scope?.plan && detail.kind === "error" ? detail.message : project?.error;
  const loading = portfolio.kind === "loading" || Boolean(scope?.plan && detail.kind === "loading");
  // Successful parent membership is decisive even if the concurrent detail read refuses.
  const missing = !scope ? "This workspace address is not recognized."
    : portfolio.kind === "ready" && scope.project && !project ? "This Project is not in the workspace."
    : portfolio.kind === "ready" && scope.plan && project?.plans && !project.error && !plan ? "This Plan is not in the selected Project."
    : !loading && !failure && scope.action && !action ? "This Action is not in the selected Plan." : null;
  const up = scope?.action ? { project: scope.project, plan: scope.plan } : scope?.plan ? { project: scope.project } : {};
  // Go is asked only about a Project the portfolio read verified; an unknown address never reaches it.
  const goProject = project && !missing ? { id: project.id, slug: project.slug } : null;
  const go = useGoRead(goProject?.id);
  const move = go.last?.move ?? null;
  const relation = move && scope ? goRelation(move, scope) : null;
  // The marker is a navigation aid, so it is withheld while Go's last read is known to have failed since.
  const goPlan = move && move.kind !== "none" ? move.plan : null;
  const goActionId = go.status !== "error" && goPlan && move && move.kind !== "none" && plan?.slug === goPlan ? move.action.id : null;
  const listed = level === "Action" ? "Plan" : level;
  // DOM order is Work, Direction, Context, so reading and focus order match the phone layout; CSS places Context first on desktop.
  return <main className="workspace-main">
    <nav aria-label="Selected context" className="workspace-breadcrumbs">
      <Link href="/workspace" aria-current={scope && !scope.project ? "page" : undefined}>Portfolio</Link>
      {scope?.project && <><span aria-hidden="true">/</span><Link href={workspaceHref({ project: scope.project })} aria-current={!scope.plan ? "page" : undefined}>{project?.name ?? scope.project}</Link></>}
      {scope?.plan && <><span aria-hidden="true">/</span><Link href={workspaceHref({ project: scope.project, plan: scope.plan })} aria-current={!scope.action ? "page" : undefined}>{scope.plan}</Link></>}
      {scope?.action && <><span aria-hidden="true">/</span><span aria-current="page">{action?.title ?? scope.action}</span></>}
    </nav>
    <div className="workspace-grid">
      <section className="workspace-work workspace-panel" aria-labelledby="workspace-title">
        <div className="workspace-context" id="workspace-context" tabIndex={-1}>
          <p className="workspace-eyebrow">Selected context · {level}</p><h1 id="workspace-title">{title}</h1>
          {scope?.project && <Link href={workspaceHref(up)} className="workspace-up">← Up to {scope.action ? "Plan" : scope.plan ? "Project" : "portfolio"}</Link>}
          <a href="#workspace-go-title" className="workspace-jump">Go&apos;s next move and your Ask ↓</a>
        </div>
        <div className="workspace-work-body">
          {level === "Portfolio" && <p>Choose a Project under Context. Go&apos;s next move for it appears under Direction. Your Ask keeps the target you chose.</p>}
          {level === "Project" && move && move.kind !== "none" && <><GoSource go={go} /><dl className="workspace-facts"><dt>Go is working toward</dt><dd>{move.milestone ?? "No milestone recorded"}</dd><dt>Go&apos;s current Plan</dt><dd><Link href={workspaceHref({ project: scope?.project, plan: move.plan })}>{move.plan}</Link></dd></dl></>}
          {level === "Plan" && plan && <PlanPurpose view={planView} milestone={plan.milestone} />}
          {level === "Action" && action && <ActionPurpose view={actionView} recordedTitle={action.title} />}
          {level === "Action" && action && <dl className="workspace-facts"><dt>Recorded status</dt><dd>{action.status}</dd><dt>Dependencies</dt><dd>{action.dependsOn.length ? action.dependsOn.join(", ") : "None recorded"}</dd></dl>}
          {level === "Action" && action && relation === "here" && <GoActionDetails go={go} />}
        </div>
      </section>
      <section className="workspace-direction workspace-panel" aria-label="Direction">
        <WorkspaceNextMove go={go} project={goProject} relation={relation} />
        <WorkspaceAsk available={Boolean(scope && !loading && !failure && !missing)} target={{ projectId: project?.id, ...(scope?.plan ? { plan: scope.plan } : {}), ...(scope?.action ? { action: scope.action } : {}), label: project?.name ?? "Portfolio", context: [project?.name, scope?.plan, action?.title].filter(Boolean).join(" / ") || "Portfolio" }} />
      </section>
      <aside className="workspace-context-panel workspace-panel" aria-label="Context">
        <div className="workspace-section-heading"><h2>In this {listed.toLowerCase()}</h2><button type="button" onClick={() => setRevision(v => v + 1)}>Refresh</button></div>
        {!scope || missing ? <div role="status"><h3>Context not found</h3><p>{missing}</p><Link href="/workspace">Return to portfolio</Link></div> : failure ? <div role="alert"><h3>Context unavailable</h3><p>{failure}</p><p>Refresh to try the read again.</p></div> : loading ? <p role="status">Reading your work…</p> : <>
          {level === "Portfolio" && (portfolio.kind === "ready" && portfolio.data.projects.length ? <ul className="workspace-entities">{portfolio.data.projects.map(p => <li key={p.slug}><Link href={workspaceHref({ project: p.slug })}><span className="workspace-entity-kind">Project · {p.status}</span><strong>{p.name}</strong><span>{p.error ? "Plans unavailable" : `${p.plans?.length ?? 0} Plans`} <span aria-hidden="true">↗</span></span></Link></li>)}</ul> : <p>No Projects are in this workspace yet.</p>)}
          {level === "Project" && project && (project.plans?.length ? <ProjectPlans project={project.slug} plans={project.plans} goPlan={goPlan} goNamedNone={move?.kind === "none"} stale={go.status === "error"} summaries={summaries} /> : <p>No Plan documents are available for this Project.</p>)}
          {(level === "Plan" || level === "Action") && detail.kind === "ready" && <>{plan?.milestone && <p>{plan.milestone}</p>}{detail.data.progress.actions.length ? <ul className="workspace-entities">{detail.data.progress.actions.map(a => {
            const id = workspaceActionId(a.key);
            const view = actionSummaryView(summaries, scope.plan, id);
            return <li key={a.key}><Link href={workspaceHref({ ...scope, action: id })} aria-current={id === scope.action ? "true" : undefined}><span className="workspace-entity-kind">Action · {a.status}{id === goActionId ? " · Go's current Action" : ""}</span><strong>{view?.title ?? a.title}</strong>{view && <span>{view.why}</span>}</Link></li>;
          })}</ul> : <p>No Actions are recorded in this Plan.</p>}</>}
        </>}
      </aside>
    </div>
    <footer className="workspace-footer">Explore the context. Keep the thread.</footer>
  </main>;
}
