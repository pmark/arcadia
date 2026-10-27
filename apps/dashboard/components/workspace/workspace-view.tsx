"use client";

import Link from "next/link";
import { useState } from "react";
import { useRead } from "./use-read";
import { WorkspaceAsk } from "./workspace-ask";
import { GoSource, WorkspaceNextMove, useGoRead, type GoRead } from "./workspace-next-move";
import type { AllPlansResponse, PlanDetailResponse, PlanRow } from "../../lib/plans-types";
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

function PlanLink({ project, plan, current = false }: { project: string; plan: PlanRow; current?: boolean }) {
  const progress = planProgress(plan);
  return <li><Link href={workspaceHref({ project, plan: plan.slug })} className={current ? "workspace-current" : undefined}>
    <span className="workspace-entity-kind">Plan · {plan.status}{plan.isActivePlan ? " · active" : ""}</span>
    <strong>{plan.slug}</strong>{plan.milestone && <span>{plan.milestone}</span>}{progress && <span>{progress}</span>}
  </Link></li>;
}

/** Go's current Plan leads; other active Plans follow; drafts and finished Plans wait behind a disclosure. */
function ProjectPlans({ project, plans, goPlan }: { project: string; plans: PlanRow[]; goPlan: string | null }) {
  const groups = groupPlans(plans, goPlan);
  const list = (rows: PlanRow[]) => <ul className="workspace-entities">{rows.map(p => <PlanLink key={p.slug} project={project} plan={p} />)}</ul>;
  return <>
    {groups.current ? <><h3 className="workspace-group">{goPlan ? "Go's current Plan" : "Recorded active Plan"}</h3><ul className="workspace-entities"><PlanLink project={project} plan={groups.current} current /></ul></> : <p>No Plan is active for this Project.</p>}
    {groups.otherActive.length > 0 && <><h3 className="workspace-group">Also marked active ({groups.otherActive.length})</h3><p className="workspace-muted">Their status says active, but Go is not working on them.</p>{list(groups.otherActive)}</>}
    {groups.upcoming.length > 0 && <details className="workspace-group-more"><summary>Drafts and proposals ({groups.upcoming.length})</summary>{list(groups.upcoming)}</details>}
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
  const level = scope?.action ? "Action" : scope?.plan ? "Plan" : scope?.project ? "Project" : "Portfolio";
  const title = scope?.action ? action?.title ?? scope.action : scope?.plan ? plan?.slug ?? scope.plan : scope?.project ? project?.name ?? scope.project : "Your work, in view";
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
  const goPlan = go.status !== "error" && move && move.kind !== "none" ? move.plan : null;
  const goActionId = goPlan && move && move.kind !== "none" && plan?.slug === goPlan ? move.action.id : null;
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
          {level === "Plan" && plan?.milestone && <dl className="workspace-facts"><dt>Milestone</dt><dd>{plan.milestone}</dd></dl>}
          {level === "Action" && action && <dl className="workspace-facts"><dt>Recorded status</dt><dd>{action.status}</dd><dt>Dependencies</dt><dd>{action.dependsOn.length ? action.dependsOn.join(", ") : "None recorded"}</dd></dl>}
          {level === "Action" && action && relation === "here" && <GoActionDetails go={go} />}
        </div>
      </section>
      <section className="workspace-direction workspace-panel" aria-label="Direction">
        <WorkspaceNextMove go={go} project={goProject} relation={relation} />
        <WorkspaceAsk available={Boolean(scope && !loading && !failure && !missing)} target={{ projectId: project?.id, label: project?.name ?? "Portfolio", context: [project?.name, scope?.plan, action?.title].filter(Boolean).join(" / ") || "Portfolio" }} />
      </section>
      <aside className="workspace-context-panel workspace-panel" aria-label="Context">
        <div className="workspace-section-heading"><h2>In this {listed.toLowerCase()}</h2><button type="button" onClick={() => setRevision(v => v + 1)}>Refresh</button></div>
        {!scope || missing ? <div role="status"><h3>Context not found</h3><p>{missing}</p><Link href="/workspace">Return to portfolio</Link></div> : failure ? <div role="alert"><h3>Context unavailable</h3><p>{failure}</p><p>Refresh to try the read again.</p></div> : loading ? <p role="status">Reading your work…</p> : <>
          {level === "Portfolio" && (portfolio.kind === "ready" && portfolio.data.projects.length ? <ul className="workspace-entities">{portfolio.data.projects.map(p => <li key={p.slug}><Link href={workspaceHref({ project: p.slug })}><span className="workspace-entity-kind">Project · {p.status}</span><strong>{p.name}</strong><span>{p.error ? "Plans unavailable" : `${p.plans?.length ?? 0} Plans`} <span aria-hidden="true">↗</span></span></Link></li>)}</ul> : <p>No Projects are in this workspace yet.</p>)}
          {level === "Project" && project && (project.plans?.length ? <ProjectPlans project={project.slug} plans={project.plans} goPlan={goPlan} /> : <p>No Plan documents are available for this Project.</p>)}
          {(level === "Plan" || level === "Action") && detail.kind === "ready" && <>{plan?.milestone && <p>{plan.milestone}</p>}{detail.data.progress.actions.length ? <ul className="workspace-entities">{detail.data.progress.actions.map(a => {
            const id = workspaceActionId(a.key);
            return <li key={a.key}><Link href={workspaceHref({ ...scope, action: id })} aria-current={id === scope.action ? "true" : undefined}><span className="workspace-entity-kind">Action · {a.status}{id === goActionId ? " · Go's current Action" : ""}</span><strong>{a.title}</strong></Link></li>;
          })}</ul> : <p>No Actions are recorded in this Plan.</p>}</>}
        </>}
      </aside>
    </div>
    <footer className="workspace-footer">Explore the context. Keep the thread.</footer>
  </main>;
}
