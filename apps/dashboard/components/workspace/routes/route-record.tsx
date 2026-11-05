"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { PHASE_LABEL } from "../../../lib/journey-fleet";
import type { Journey, PlanJourney } from "../../../lib/journey-types";
import type { PlanDetailResponse, PlanRow } from "../../../lib/plans-types";
import { statusWord, type PlanRoute } from "../../../lib/workspace-routes";
import { workspaceActionId, workspaceHref } from "../../../lib/workspace-scope";
import type { ActionSummaryView, PlanSummaryView } from "../../../lib/workspace-summaries";
import { useRead } from "../use-read";
import { GoSource, type GoRead } from "../workspace-next-move";
import { RouteLink } from "./route-parts";

/** Depth on request: nothing in here is drawn or read until the operator asks. It stays read once opened. */
export function RouteRecord({ children, label = "Read the full record" }: { children: () => ReactNode; label?: string }) {
  const [asked, setAsked] = useState(false);
  return <details className="route-record" onToggle={event => { if (event.currentTarget.open) setAsked(true); }}>
    <summary>{label}</summary>
    {asked && <div className="route-record-body">{children()}</div>}
  </details>;
}

/** A summary is a reading aid; this says so, and says when it was written before the record changed. */
function SummaryNote({ stale }: { stale: boolean }) {
  return <p className={`workspace-summary-note${stale ? " stale" : ""}`}>{stale ? "Plain-language summary, written before this record last changed. The record governs." : "Plain-language summary. The record governs."}</p>;
}

/** Go's recorded details for the selected Action, shown only when it is Go's current Action. */
function GoActionDetails({ go }: { go: GoRead }) {
  const move = go.last?.move;
  if (!move || move.kind === "none") return null;
  const { action } = move;
  return <section className="workspace-go-work" aria-labelledby="workspace-go-work-title">
    <h3 id="workspace-go-work-title">What Go has for this Action</h3>
    <GoSource go={go} />
    <dl className="workspace-facts">
      <dt>Next</dt><dd>{action.next ?? "None recorded"}</dd>
      <dt>Expected result</dt><dd>{action.artifact ?? "None recorded"}</dd>
    </dl>
    {action.decisions.length > 0 && <><h4>Decisions it needs</h4><ul>{action.decisions.map((d, i) => <li key={i}>{d.question} · {d.resolved ? "answered" : "open"}</li>)}</ul></>}
    {action.acceptance.length > 0 && <details><summary>Acceptance criteria ({action.acceptance.length})</summary><ol>{action.acceptance.map((c, i) => <li key={i}>{c}</li>)}</ol></details>}
  </section>;
}

function JourneyRead({ url, children }: { url: string; children: (journey: unknown) => ReactNode }) {
  const read = useRead<unknown>(url, 0);
  if (read.kind === "loading") return <p className="route-reading" role="status"><span className="workspace-activity-spinner" aria-hidden="true" />Reading the Journey...</p>;
  if (read.kind === "error") return <p className="route-note" role="status">Couldn&apos;t read the Journey: {read.message}</p>;
  return <>{children(read.data)}</>;
}

function JourneyLeg({ phase, headline, yourMove }: { phase: keyof typeof PHASE_LABEL; headline: string; yourMove?: string | null }) {
  return <><span className="route-tag">{PHASE_LABEL[phase] ?? phase}</span> {headline}{yourMove && <p><strong>Your move:</strong> {yourMove}</p>}</>;
}

const JOURNEY_UNREADABLE = <p className="route-note" role="status">The Journey&apos;s answer couldn&apos;t be read.</p>;

/** Depth can't take the view down: a reply in another shape is reported, never half-drawn. */
function PlanJourneyLines({ journey }: { journey: PlanJourney }) {
  if (!Array.isArray(journey?.actions) || !journey.actions.every(a => a?.journey?.activity && a.journey.destination)) return JOURNEY_UNREADABLE;
  const unfinished = journey.actions.filter(a => !a.journey.destination.reached);
  if (!unfinished.length) return <p>Every Action on this route has arrived.</p>;
  return <ul>{unfinished.map(a => <li key={a.id}><strong>{a.title}</strong><br /><JourneyLeg phase={a.journey.activity.phase} headline={a.journey.activity.headline} yourMove={a.journey.activity.yourMove} /></li>)}</ul>;
}

/** Where the work stands from the Journey's own reading. Its 6 s, 30 KB read happens only here. */
function PlanJourneySection({ project, plan }: { project: string; plan: string }) {
  const encoded = `${encodeURIComponent(project)}/plan/${encodeURIComponent(plan)}`;
  return <section aria-label="Journey"><h3>Journey</h3>
    <JourneyRead url={`/api/journey/${encoded}`}>{data => <PlanJourneyLines journey={data as PlanJourney} />}</JourneyRead>
    <p><Link href={`/journey/${encoded}`} prefetch={false}>Open the whole Journey</Link></p>
  </section>;
}

function ActionJourneySection({ project, action }: { project: string; action: string }) {
  const encoded = `${encodeURIComponent(project)}/${encodeURIComponent(action)}`;
  return <section aria-label="Journey"><h3>Journey</h3>
    <JourneyRead url={`/api/journey/${encoded}`}>{data => { const j = data as Journey; if (!j?.activity) return JOURNEY_UNREADABLE; return <><JourneyLeg phase={j.activity.phase} headline={j.activity.headline} yourMove={j.activity.yourMove} />{j.activity.detail && <p>{j.activity.detail}</p>}</>; }}</JourneyRead>
    <p><Link href={`/journey/${encoded}#now`} prefetch={false}>Open the whole Journey</Link></p>
  </section>;
}

/** Everything a Project's route leaves out. */
export function ProjectRecord({ projectId, status, lead, plansCount, go }: { projectId: string; status: string; lead: string | null; plansCount: number; go: GoRead }) {
  const move = go.last?.move;
  return <>
    {move && move.kind !== "none" && <GoSource go={go} />}
    <dl className="workspace-facts">
      <dt>Recorded status</dt><dd>{statusWord(status)}</dd>
      <dt>Plan documents</dt><dd>{plansCount}</dd>
      {lead && <><dt>Recorded active Plan</dt><dd>{lead}</dd></>}
      {move && move.kind !== "none" && <><dt>Go is working toward</dt><dd>{move.milestone ?? "No milestone recorded"}</dd><dt>Go&apos;s current Plan</dt><dd>{move.plan}</dd></>}
    </dl>
    <p><Link href={`/projects/${encodeURIComponent(projectId)}`} prefetch={false}>This Project&apos;s page</Link> · <Link href="/journey" prefetch={false}>All Journeys</Link></p>
  </>;
}

/** Everything a Plan's route leaves out: why it exists, the agents' own text, every Action, and the Journey. */
export function PlanRecord({ project, planSlug, plan, detail, route, view }: { project: string; planSlug: string; plan: PlanRow | null; detail: PlanDetailResponse; route: PlanRoute; view: PlanSummaryView | null }) {
  const { progress } = detail;
  return <>
    {view && <section className="workspace-summary" aria-label="Why this Plan exists">
      <SummaryNote stale={view.stale} />
      <dl className="workspace-facts">
        <dt>Why this Plan exists</dt><dd>{view.purpose}</dd>
        {view.serves && <><dt>What it serves</dt><dd>{view.serves}</dd></>}
        <dt>Done when</dt><dd>{view.doneWhen}</dd>
      </dl>
      {view.readingNote && <p className="workspace-reading-note">{view.readingNote}</p>}
    </section>}
    <dl className="workspace-facts">
      {plan?.milestone && <><dt>Recorded milestone</dt><dd>{plan.milestone}</dd></>}
      <dt>Recorded status</dt><dd>{statusWord(plan?.status ?? "unknown")}{plan?.isActivePlan ? " · the Project's active Plan" : ""}</dd>
      <dt>Plan</dt><dd>{planSlug}</dd>
      {plan?.relativePath && <><dt>Document</dt><dd>{plan.relativePath}</dd></>}
      {progress.source?.updated && <><dt>Last updated</dt><dd>{progress.source.updated}</dd></>}
      {progress.currentNote && <><dt>Current Action</dt><dd>{progress.currentNote}</dd></>}
      {plan?.activationNote && <><dt>What would activate it</dt><dd>{plan.activationNote}</dd></>}
    </dl>
    {progress.blocked?.length > 0 && <section aria-label="Blocked Actions"><h3>Blocked</h3><ul>{progress.blocked.map(b => <li key={b.key}><strong>{b.title}</strong>: {b.reason}</li>)}</ul></section>}
    <section aria-label="Every Action"><h3>Every Action ({route.stops.length})</h3>
      {route.stops.length ? <ol className="route-record-actions">{route.stops.map(s => <li key={s.key}><RouteLink href={workspaceHref({ project, plan: planSlug, action: s.id })}><span className="route-tag">{statusWord(s.status)}</span> {s.title}</RouteLink></li>)}</ol> : <p>No Actions are recorded in this Plan.</p>}
    </section>
    <PlanJourneySection project={project} plan={planSlug} />
  </>;
}

/** Everything an Action's sentence leaves out. */
export function ActionRecord({ project, plan, actionKey, detail, view, title, status, dependsOn, go, isGoCurrent }: { project: string; plan: string; actionKey: string; detail: PlanDetailResponse; view: ActionSummaryView | null; title: string; status: string; dependsOn: string[]; go: GoRead; isGoCurrent: boolean }) {
  const { progress } = detail;
  const entry = [progress.current, ...(progress.next ?? []), ...(progress.blocked ?? [])].find(e => e?.key === actionKey);
  const reason = progress.blocked?.find(b => b.key === actionKey)?.reason;
  return <>
    {view && <section className="workspace-summary" aria-label="Why this Action exists">
      <SummaryNote stale={view.stale} />
      <dl className="workspace-facts">
        <dt>Why it exists</dt><dd>{view.why}</dd>
        <dt>Done when</dt><dd>{view.doneWhen}</dd>
      </dl>
      {view.note && <p className="workspace-reading-note">{view.note}</p>}
    </section>}
    <dl className="workspace-facts">
      <dt>Recorded title</dt><dd>{title}</dd>
      <dt>Recorded status</dt><dd>{statusWord(status)}</dd>
      <dt>Action</dt><dd>{workspaceActionId(actionKey)}</dd>
      <dt>Dependencies</dt><dd>{dependsOn.length ? dependsOn.join(", ") : "None recorded"}</dd>
      {entry?.waitingOn?.length ? <><dt>Waiting on</dt><dd>{entry.waitingOn.join(", ")}</dd></> : null}
      {reason && <><dt>Why it&apos;s blocked</dt><dd>{reason}</dd></>}
    </dl>
    {isGoCurrent && <GoActionDetails go={go} />}
    <ActionJourneySection project={project} action={workspaceActionId(actionKey)} />
    <p><Link href={workspaceHref({ project, plan })} prefetch={false}>The whole Plan</Link></p>
  </>;
}
