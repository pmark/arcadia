"use client";

import type { AllPlansResponse, PlanRow, PlanSummariesResponse } from "../../../lib/plans-types";
import { groupPlans } from "../../../lib/workspace-plans";
import { namesNote, planWords, portfolioRoutes, shapeFromCounts, statusWord, stopShape, type PlanRoute, type ProjectRoute, type RouteStop, type RouteWords } from "../../../lib/workspace-routes";
import { workspaceHref } from "../../../lib/workspace-scope";
import { RouteLine, RouteLink } from "./route-parts";

function ProjectRow({ route }: { route: ProjectRoute }) {
  const words = route.problem ?? route.shape?.label ?? "No active Plan recorded";
  return <li><RouteLink href={workspaceHref({ project: route.slug })} className="route-row" aria-label={`${route.name}: Project, ${statusWord(route.status)}. ${words}.`}>
    <span className="route-row-name"><strong>{route.name}</strong>{route.status !== "active" && <span className="route-tag">{statusWord(route.status)}</span>}</span>
    <RouteLine shape={route.shape && { ...route.shape, tone: route.tone }} />
    <span className="route-row-words">{words}</span>
  </RouteLink></li>;
}

/** A portfolio is a few routes. Every other Project waits one tap away. */
export function PortfolioRoutes({ projects }: { projects: AllPlansResponse["projects"] }) {
  if (!projects.length) return <p className="route-empty">No Projects are in this workspace yet.</p>;
  const { lead, rest } = portfolioRoutes(projects);
  return <>
    {lead.length > 0 && <ul className="route-rows">{lead.map(r => <ProjectRow key={r.slug} route={r} />)}</ul>}
    {rest.length > 0 && <details className="route-more" open={!lead.length}><summary>{lead.length ? "All other Projects" : "All Projects"} ({rest.length})</summary><ul className="route-rows">{rest.map(r => <ProjectRow key={r.slug} route={r} />)}</ul></details>}
  </>;
}

function PlanRow({ project, plan, summaries }: { project: string; plan: PlanRow; summaries: PlanSummariesResponse | null }) {
  const words = planWords(plan, plan.slug, summaries);
  const shape = shapeFromCounts(plan.actionCounts);
  const label = shape?.label ?? "No Actions counted";
  return <li><RouteLink href={workspaceHref({ project, plan: plan.slug })} className="route-row" aria-label={`${words.name}: Plan, ${statusWord(plan.status)}. ${label}.`}>
    <span className="route-row-name"><strong>{words.name}</strong>{plan.status !== "active" && <span className="route-tag">{statusWord(plan.status)}</span>}</span>
    <RouteLine shape={shape} />
    <span className="route-row-words">{label}</span>
  </RouteLink></li>;
}

/** Go's current Plan leads, or the recorded active Plan until Go has been asked. A label never claims Go named a Plan it didn't. */
export function ProjectRoutes({ project, plans, goPlan, goNamedNone, stale, summaries }: { project: string; plans: PlanRow[]; goPlan: string | null; goNamedNone: boolean; stale: boolean; summaries: PlanSummariesResponse | null }) {
  const groups = groupPlans(plans, goPlan);
  const list = (rows: PlanRow[]) => <ul className="route-rows">{rows.map(p => <PlanRow key={p.slug} project={project} plan={p} summaries={summaries} />)}</ul>;
  const note = namesNote(plans.map(p => planWords(p, p.slug, summaries).source));
  return <>
    {groups.missingGoPlan && <p className="route-note">Go{stale ? "'s last good read" : ""} names Plan {groups.missingGoPlan}, which this list does not include yet. Refresh to read the list again.</p>}
    {groups.current ? <><h2 className="route-group">{groups.source === "go" ? `Go's current Plan${stale ? " · last good read" : ""}` : "Recorded active Plan"}</h2>{list([groups.current])}</>
      : <p className="route-empty">No active Plan is recorded{goNamedNone ? ", and Go names none" : ""}.</p>}
    {groups.otherActive.length > 0 && <details className="route-more"><summary>{groups.current ? "Also marked active" : "Marked active"} ({groups.otherActive.length})</summary>{groups.source === "go" && <p className="route-note">Their status says active, but Go is not working on them.</p>}{list(groups.otherActive)}</details>}
    {groups.upcoming.length > 0 && <details className="route-more"><summary>Not yet active ({groups.upcoming.length})</summary>{list(groups.upcoming)}</details>}
    {groups.finished.length > 0 && <details className="route-more"><summary>Finished ({groups.finished.length})</summary>{list(groups.finished)}</details>}
    {note && <p className="route-note">{note}</p>}
  </>;
}

function stopTags(stop: RouteStop): string[] {
  const tags = stop.role === "current" ? ["Current Action"] : stop.role === "next-ready" ? ["Next ready"] : [];
  if (stop.status === "blocked" || stop.status === "in_progress" || stop.status === "deferred" || (stop.role && stop.status === "done")) tags.push(statusWord(stop.status));
  if (stop.go) tags.push("Go's current Action");
  return tags;
}

function Stop({ scope, stop, selected }: { scope: { project: string; plan: string }; stop: RouteStop; selected?: boolean }) {
  const tags = stopTags(stop);
  return <li className={`route-stop-row mark-${stop.mark}`}>
    <span className="route-stop-mark" aria-hidden="true" />
    <RouteLink href={workspaceHref({ ...scope, action: stop.id })} aria-current={selected ? "true" : undefined} aria-label={`${[statusWord(stop.status), ...tags.filter(t => t !== statusWord(stop.status))].join(", ")}: ${stop.name}`}>
      <span>{stop.name}</span>{tags.length > 0 && <span className="route-stop-tags">{tags.join(" · ")}</span>}
    </RouteLink>
  </li>;
}

/** A disclosure on the route itself: the count stands in for the stops until they're asked for. */
function CollapsedStops({ scope, stops, word, mark }: { scope: { project: string; plan: string }; stops: RouteStop[]; word: string; mark: string }) {
  if (!stops.length) return null;
  return <li className={`route-stop-row mark-${mark}`}>
    <span className="route-stop-mark" aria-hidden="true" />
    <details className="route-stops-more"><summary>{stops.length} {word}</summary><ol>{stops.map(s => <Stop key={s.key} scope={scope} stop={s} />)}</ol></details>
  </li>;
}

/** A Plan is one route with named stops: where it's been, where it is, the next few, and the rest behind a count. */
export function PlanRouteView({ project, plan, route, words }: { project: string; plan: string; route: PlanRoute; words: RouteWords }) {
  const scope = { project, plan };
  return <>
    {words.sentence && <p className="route-sentence">{words.sentence}</p>}
    <figure className="route-figure" role="img" aria-label={`Route of this Plan: ${route.shape.label}.`}>
      <RouteLine shape={route.shape} big />
      <figcaption aria-hidden="true">{route.shape.label}</figcaption>
    </figure>
    {route.stops.length > 0 && <ol className="route-stops" aria-label="Stops on this route">
      <CollapsedStops scope={scope} stops={route.been} word="done" mark="done" />
      {route.here && <Stop scope={scope} stop={route.here} />}
      {route.ahead.map(s => <Stop key={s.key} scope={scope} stop={s} />)}
      <CollapsedStops scope={scope} stops={route.later} word="more ahead" mark="ahead" />
      <CollapsedStops scope={scope} stops={route.aside} word="deferred" mark="deferred" />
    </ol>}
    {namesNote(route.stops.map(s => s.source)) && <p className="route-source">{namesNote(route.stops.map(s => s.source))}</p>}
  </>;
}

/** An Action is one sentence, and its place on the Plan's route. */
export function ActionRouteView({ actionId, route, words }: { actionId: string; route: PlanRoute | null; words: RouteWords }) {
  const shape = route && stopShape(route, actionId);
  return <>
    {words.sentence && <p className="route-sentence">{words.sentence}</p>}
    {shape && <figure className="route-figure" role="img" aria-label={`${shape.label} on this Plan's route. ${route.shape.label}.`}>
      <RouteLine shape={shape} big />
      <figcaption aria-hidden="true">{shape.label}</figcaption>
    </figure>}
  </>;
}
