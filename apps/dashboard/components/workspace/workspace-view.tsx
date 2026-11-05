"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useRead } from "./use-read";
import { WorkspaceAskTarget } from "./workspace-ask";
import { GO_STATE, WorkspaceNextMove, goReadTime, useGoRead, type GoRead } from "./workspace-next-move";
import { RouteBones, RouteLink, RouteReading } from "./routes/route-parts";
import { ActionRecord, PlanRecord, ProjectRecord, RouteRecord } from "./routes/route-record";
import { ActionRouteView, PlanRouteView, PortfolioRoutes, ProjectRoutes } from "./routes/route-views";
import "./routes/routes.css";
import type { AllPlansResponse, PlanDetailResponse, PlanSummariesResponse } from "../../lib/plans-types";
import { actionSummaryView, planSummaryView } from "../../lib/workspace-summaries";
import { goRelation } from "../../lib/workspace-go";
import { actionWords, crumbName, humanizeSlug, planRoute, planWords, shortText, statusWord, workspaceParts, type RouteLevel, type RouteWords } from "../../lib/workspace-routes";
import { parseWorkspaceScope, workspaceActionId, workspaceHref } from "../../lib/workspace-scope";

/** Go's next move in one line, so the view can leave its read until it's asked for. An earlier read says when it was. */
function nextMoveLine(go: GoRead): { state: string; word: string } {
  const move = go.last?.move;
  if (go.status === "error") return { state: "failed", word: go.last ? "Couldn't read Go again" : "Couldn't read Go" };
  if (go.status === "loading") return { state: "reading", word: go.last ? "Asking Go again..." : "Asking Go..." };
  if (!move || !go.last) return { state: "unread", word: "Ask Go" };
  return { state: move.kind, word: `${GO_STATE[move.kind]} · read at ${goReadTime(go.last.at)}` };
}

const SOURCE_NOTE: Partial<Record<RouteWords["source"], string>> = { summary: "Plain-language summary. The record governs.", shortened: "Shortened from the record." };

export function WorkspaceView({ parts }: { parts: string[] }) {
  // The address itself decides, so a tap and Back or Forward change the screen without waiting for a page.
  const pathname = usePathname();
  const scope = parseWorkspaceScope(pathname ? workspaceParts(pathname) : parts);
  const [revision, setRevision] = useState(0);
  const scoped = Boolean(scope);
  const detail = useRead<PlanDetailResponse>(scope?.project && scope.plan ? `/api/plans/${encodeURIComponent(scope.project)}/${encodeURIComponent(scope.plan)}` : null, revision);
  // A Plan's own read names its Project, so the whole portfolio is read for a Plan or Action only to explain a refused read.
  const portfolio = useRead<AllPlansResponse>(scoped && (!scope?.plan || detail.kind === "error") ? "/api/plans" : null, revision);
  const portfolioAsked = scoped && (!scope?.plan || detail.kind === "error");
  const listedProject = portfolio.kind === "ready" ? portfolio.data.projects.find(p => p.slug === scope?.project) : undefined;
  const planDetail = detail.kind === "ready" ? detail.data : null;
  const project = planDetail?.project ?? listedProject;
  const plan = planDetail?.plan ?? listedProject?.plans?.find(p => p.slug === scope?.plan) ?? null;
  const action = planDetail ? planDetail.progress.actions.find(a => workspaceActionId(a.key) === scope?.action) : undefined;
  // Summaries are optional reading aids, and a Project's whole answer is 300 KB, so each view asks only for what it names.
  const summaryRead = useRead<PlanSummariesResponse>(scope?.project ? `/api/plan-summaries/${encodeURIComponent(scope.project)}?${scope.plan ? `plan=${encodeURIComponent(scope.plan)}` : "brief=1"}` : null, revision);
  const summaries = summaryRead.kind === "ready" ? summaryRead.data : null;
  // A summary only names what the record still has; an orphaned entry never relabels a missing Plan or Action.
  const planView = plan ? planSummaryView(summaries, scope?.plan) : null;
  const actionView = action ? actionSummaryView(summaries, scope?.plan, scope?.action) : null;
  const level: RouteLevel = scope?.action ? "Action" : scope?.plan ? "Plan" : scope?.project ? "Project" : "Portfolio";
  const loading = scope?.plan ? detail.kind === "loading" || (detail.kind === "error" && portfolio.kind === "loading") : portfolio.kind === "loading";
  const failure = scope?.plan ? (detail.kind === "error" && !loading ? (portfolio.kind === "error" ? detail.message : listedProject?.error ?? detail.message) : undefined) : portfolio.kind === "error" ? portfolio.message : listedProject?.error ?? undefined;
  // Successful parent membership is decisive even if the concurrent detail read refuses.
  const missing = !scope ? "This workspace address is not recognized."
    : portfolioAsked && portfolio.kind === "ready" && scope.project && !listedProject ? "This Project is not in the workspace."
    : portfolioAsked && portfolio.kind === "ready" && scope.plan && listedProject?.plans && !listedProject.error && !listedProject.plans.some(p => p.slug === scope.plan) ? "This Plan is not in the selected Project."
    : !loading && !failure && scope.action && !action ? "This Action is not in the selected Plan." : null;

  const goProject = project && !missing ? { id: project.id, slug: project.slug } : null;
  const scopeKey = pathname ?? "";
  const here = planDetail?.progress.current && scope?.action && workspaceActionId(planDetail.progress.current.key) === scope.action && planDetail.progress.current.basis === "project_current_action";
  // Go's next move is one line until it's asked for, because its read is the slowest thing here. On the Action the
  // record says is current, Go is asked at once, and the line opens by itself only when Go says it's ready to continue.
  const [nextChoice, setNextChoice] = useState<{ key: string; open: boolean } | null>(null);
  const chosen = nextChoice?.key === scopeKey ? nextChoice.open : null;
  const go = useGoRead(goProject?.id, chosen === true || Boolean(here), scopeKey);
  const move = go.last?.move ?? null;
  const relation = move && scope ? goRelation(move, scope) : null;
  const nextOpen = chosen ?? Boolean(here && move?.kind === "ready" && relation === "here");
  // Mounted fresh for each address, so returning to an Action reads its Sessions again and can't offer a second launch.
  const [nextMountedAt, setNextMountedAt] = useState<string | null>(null);
  if (nextOpen && nextMountedAt !== scopeKey) setNextMountedAt(scopeKey);
  // The marker is a navigation aid, so it is withheld while Go's last read is known to have failed since.
  const goPlan = move && move.kind !== "none" ? move.plan : null;
  const goActionId = go.status !== "error" && goPlan && move && move.kind !== "none" && scope?.plan === goPlan ? move.action.id : null;

  const route = planDetail && scope?.plan ? planRoute(planDetail.progress, scope.plan, summaries, goActionId) : null;
  const planName = scope?.plan ? planWords(plan, scope.plan, summaries) : null;
  const words: RouteWords | null = scope?.action
    ? (action ? actionWords(action.title, scope.action, scope.plan, summaries) : { name: shortText(humanizeSlug(scope.action)), sentence: null, source: "record" })
    : planName;
  const title = words?.name ?? (scope?.project ? project?.name ?? shortText(humanizeSlug(scope.project)) : "Your work, in view");
  const recordedStatus = action?.status ?? (scope?.plan ? plan?.status : scope?.project ? listedProject?.status : undefined);
  const kind = [level, recordedStatus && statusWord(recordedStatus), scope?.action && here ? "Current Action" : null].filter(Boolean).join(" · ");
  const freshness = (read: { kind: string; freshness?: string }) => read.kind === "ready" ? read.freshness : undefined;
  const primary = scope?.plan ? detail : portfolio;
  const reading = loading || freshness(primary) === "reading";
  const lastGood = freshness(primary) === "last-good";
  const note = words && !failure && !missing && !loading ? SOURCE_NOTE[words.source] : undefined;
  const line = nextMoveLine(go);

  return <main className="workspace-main route-main">
    <nav aria-label="Selected context" className="workspace-breadcrumbs route-crumbs">
      <RouteLink href="/workspace" aria-current={scope && !scope.project ? "page" : undefined}>Portfolio</RouteLink>
      {scope?.project && <><span aria-hidden="true">/</span><RouteLink href={workspaceHref({ project: scope.project })} aria-current={!scope.plan ? "page" : undefined}>{crumbName(project?.name ?? humanizeSlug(scope.project))}</RouteLink></>}
      {scope?.plan && <><span aria-hidden="true">/</span><RouteLink href={workspaceHref({ project: scope.project, plan: scope.plan })} aria-current={!scope.action ? "page" : undefined}>{crumbName(planName?.name)}</RouteLink></>}
      {scope?.action && <><span aria-hidden="true">/</span><span aria-current="page">{crumbName(title)}</span></>}
    </nav>
    <div className="route-layout">
      <section className="route-subject" aria-labelledby="workspace-title">
        <div className="route-card" id="workspace-context" tabIndex={-1}>
          <button type="button" className="route-refresh" onClick={() => setRevision(v => v + 1)}>Refresh</button>
          <p className="route-kind">{kind}</p>
          <h1 id="workspace-title" className="route-title">{title}</h1>
          {note && <p className="route-source">{note}</p>}
          <RouteReading level={level} reading={reading && !missing} />
          {lastGood && <p className="route-note" role="status">Couldn&apos;t read this again, so this is the last good read.</p>}
          {!scope || missing ? <div className="route-problem" role="status"><h2>Context not found</h2><p>{missing}</p><Link href="/workspace">Return to portfolio</Link></div>
            : failure ? <div className="route-problem" role="alert"><h2>Context unavailable</h2><p>{shortText(failure, 200)}</p><p>Refresh to try the read again.</p></div>
            : loading ? <RouteBones />
            : level === "Plan" && route && scope.project && scope.plan ? <PlanRouteView project={scope.project} plan={scope.plan} route={route} words={words!} />
            : level === "Action" && scope.action && action ? <ActionRouteView actionId={scope.action} route={route} words={words!} />
            : level === "Project" && listedProject && !listedProject.plans?.length ? <p className="route-empty">No Plan documents are available for this Project.</p>
            : null}
          {scope && !missing && !failure && !loading && level !== "Portfolio" && <div className="route-card-foot">
            {!failure && !loading && level === "Project" && listedProject && <RouteRecord key={listedProject.slug}>{() => <ProjectRecord projectId={listedProject.id} status={listedProject.status} lead={listedProject.activePlan} plansCount={listedProject.plans?.length ?? 0} go={go} />}</RouteRecord>}
            {!failure && !loading && level === "Plan" && planDetail && route && scope.project && scope.plan && <RouteRecord key={scope.plan}>{() => <PlanRecord project={scope.project!} planSlug={scope.plan!} plan={plan} detail={planDetail} route={route} view={planView} />}</RouteRecord>}
            {!failure && !loading && level === "Action" && planDetail && action && scope.project && scope.plan && <RouteRecord key={scope.action}>{() => <ActionRecord project={scope.project!} plan={scope.plan!} actionKey={action.key} detail={planDetail} view={actionView} title={action.title} status={action.status} dependsOn={action.dependsOn} go={go} isGoCurrent={relation === "here"} />}</RouteRecord>}
          </div>}
        </div>
        {!failure && !missing && !loading && level === "Portfolio" && portfolio.kind === "ready" && <PortfolioRoutes projects={portfolio.data.projects} />}
        {!failure && !missing && !loading && level === "Project" && listedProject && (listedProject.plans?.length ?? 0) > 0 && <div className="route-project"><ProjectRoutes project={listedProject.slug} plans={listedProject.plans ?? []} goPlan={goPlan} goNamedNone={move?.kind === "none"} stale={go.status === "error"} summaries={summaries} /></div>}
      </section>
      <section className="workspace-direction workspace-panel route-direction" aria-label="Direction">
        {goProject && <details className="route-next" open={nextOpen} onToggle={event => { const open = event.currentTarget.open; if (open !== nextOpen) setNextChoice({ key: scopeKey, open }); }}>
          <summary><span>Next move</span><span className={`route-next-state ${line.state}`}>{line.word}</span></summary>
          {nextMountedAt === scopeKey && <WorkspaceNextMove key={scopeKey} go={go} project={goProject} relation={relation} selectedAction={scope?.plan && scope.action && action ? { plan: scope.plan, action: scope.action } : undefined} />}
        </details>}
        <WorkspaceAskTarget available={Boolean(scope && !loading && !failure && !missing)} reading={loading} target={{ projectId: project?.id, ...(scope?.plan ? { plan: scope.plan } : {}), ...(scope?.action ? { action: scope.action } : {}), label: project?.name ?? "Portfolio", context: [project?.name, scope?.plan, action?.title].filter(Boolean).join(" / ") || "Portfolio" }} />
      </section>
    </div>
  </main>;
}
