"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { AllPlansResponse, PlanDetailResponse } from "../../lib/plans-types";
import { parseWorkspaceScope, workspaceActionId, workspaceHref } from "../../lib/workspace-scope";

type ReadState<T> = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: T };
function useRead<T>(url: string | null, revision: number): ReadState<T> {
  const [result, setResult] = useState<{ url: string; revision: number; state: ReadState<T> } | null>(null);
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    fetch(url, { cache: "no-store", signal: controller.signal }).then(async response => {
      const body = await response.json() as T & { error?: string };
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(body.error ?? "Arcadia could not read this context.");
      setResult({ url, revision, state: { kind: "ready", data: body } });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setResult({ url, revision, state: { kind: "error", message: error instanceof Error ? error.message : String(error) } });
    });
    return () => controller.abort();
  }, [url, revision]);
  return result?.url === url && result.revision === revision ? result.state : { kind: "loading" };
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
  return <main className="workspace-main">
    <nav aria-label="Selected context" className="workspace-breadcrumbs">
      <Link href="/workspace" aria-current={scope && !scope.project ? "page" : undefined}>Portfolio</Link>
      {scope?.project && <><span aria-hidden="true">/</span><Link href={workspaceHref({ project: scope.project })} aria-current={!scope.plan ? "page" : undefined}>{project?.name ?? scope.project}</Link></>}
      {scope?.plan && <><span aria-hidden="true">/</span><Link href={workspaceHref({ project: scope.project, plan: scope.plan })} aria-current={!scope.action ? "page" : undefined}>{scope.plan}</Link></>}
      {scope?.action && <><span aria-hidden="true">/</span><span aria-current="page">{action?.title ?? scope.action}</span></>}
    </nav>
    <div className="workspace-grid">
      <section className="workspace-conversation workspace-panel" aria-labelledby="workspace-title">
        <div className="workspace-context" id="workspace-context" tabIndex={-1}>
          <p className="workspace-eyebrow">Selected context · {level}</p><h1 id="workspace-title">{title}</h1>
          {scope?.project && <Link href={workspaceHref(up)} className="workspace-up">← Up to {scope.action ? "Plan" : scope.plan ? "Project" : "portfolio"}</Link>}
        </div>
        <div className="workspace-conversation-slot" aria-label="Conversation extension region">
          <span className="workspace-spark" aria-hidden="true">✦</span>
          <h2>A little room to think.</h2>
          <p>This is where the conversation will live, alongside the work you select.</p>
          <p className="workspace-muted">Conversation capture is not connected yet. Explore the records here, or <Link href="/capture">open Capture</Link> to use Arcadia Ask.</p>
        </div>
        <details className="workspace-history"><summary>History</summary><p>Conversation history is not connected to this workspace yet. Selecting work does not create a new conversation.</p></details>
      </section>
      <aside className="workspace-context-panel workspace-panel" aria-label="Work overview">
        <div className="workspace-section-heading"><h2>In this {level.toLowerCase()}</h2><button type="button" onClick={() => setRevision(v => v + 1)}>Refresh</button></div>
        {!scope || missing ? <div role="status"><h3>Context not found</h3><p>{missing}</p><Link href="/workspace">Return to portfolio</Link></div> : failure ? <div role="alert"><h3>Context unavailable</h3><p>{failure}</p><p>Refresh to try the read again.</p></div> : loading ? <p role="status">Reading your work…</p> : <>
          {level === "Portfolio" && (portfolio.kind === "ready" && portfolio.data.projects.length ? <ul className="workspace-entities">{portfolio.data.projects.map(p => <li key={p.slug}><Link href={workspaceHref({ project: p.slug })}><span className="workspace-entity-kind">Project · {p.status}</span><strong>{p.name}</strong><span>{p.error ? "Plans unavailable" : `${p.plans?.length ?? 0} Plans`} <span aria-hidden="true">↗</span></span></Link></li>)}</ul> : <p>No Projects are in this workspace yet.</p>)}
          {level === "Project" && (project?.plans?.length ? <ul className="workspace-entities">{project.plans.map(p => <li key={p.slug}><Link href={workspaceHref({ project: project.slug, plan: p.slug })}><span className="workspace-entity-kind">Plan · {p.status}{p.isActivePlan ? " · active" : ""}</span><strong>{p.slug}</strong>{p.milestone && <span>{p.milestone}</span>}</Link></li>)}</ul> : <p>No Plan documents are available for this Project.</p>)}
          {level === "Plan" && detail.kind === "ready" && <>{plan?.milestone && <p>{plan.milestone}</p>}{detail.data.progress.actions.length ? <ul className="workspace-entities">{detail.data.progress.actions.map(a => <li key={a.key}><Link href={workspaceHref({ ...scope, action: workspaceActionId(a.key) })}><span className="workspace-entity-kind">Action · {a.status}</span><strong>{a.title}</strong></Link></li>)}</ul> : <p>No Actions are recorded in this Plan.</p>}</>}
          {level === "Action" && action && <dl className="workspace-facts"><dt>Recorded status</dt><dd>{action.status}</dd><dt>Dependencies</dt><dd>{action.dependsOn.length ? action.dependsOn.join(", ") : "None recorded"}</dd></dl>}
        </>}
        <section className="workspace-result-slot" aria-label="Results extension region"><h3>Results & previews</h3><p>Artifact previews and Ask result cards will appear here when connected to their records.</p></section>
      </aside>
    </div>
    <footer className="workspace-footer">Explore the context. Keep the thread.</footer>
  </main>;
}
