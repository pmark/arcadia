import type { RoadmapPlanStop, RoadmapStop, RoadmapView } from "../../../../../src/roadmap/derive";

/** Pixels of Plan column per Action: space is proportional to Action counts and to nothing else. */
export const PX_PER_ACTION = 6;

function CountsLine({ stop }: { stop: RoadmapPlanStop }) {
  const { counts } = stop;
  const parts = [`${counts.done} done`, `${counts.open + counts.inProgress + counts.blocked} open`, `${counts.deferred} deferred`];
  return <>{parts.join(" · ")}</>;
}

/** A Plan's column: solid = done, hatched = open and not small (size unknown), dashed = deferred. Heights are Action counts. */
function PlanColumn({ stop }: { stop: RoadmapPlanStop }) {
  const { counts } = stop;
  const open = counts.open + counts.inProgress + counts.blocked;
  const segment = (kind: string, n: number) => n > 0 ? <div className={`rm-seg rm-${kind}`} style={{ height: n * PX_PER_ACTION }} /> : null;
  return <div className="rm-col" aria-hidden="true">
    {segment("deferred", counts.deferred)}
    {segment("open", open)}
    {segment("done", counts.done)}
  </div>;
}

function PlanStopView({ stop, currentAction }: { stop: RoadmapPlanStop; currentAction: string | null }) {
  const open = stop.counts.open + stop.counts.inProgress + stop.counts.blocked;
  return <li className={`rm-plan${stop.isActive ? " rm-active" : ""}`} aria-label={`Plan ${stop.letter}`}>
    <PlanColumn stop={stop} />
    <div className="rm-plan-text">
      <b>Plan {stop.letter}</b>
      <span className="rm-status">{stop.status}</span>
      {stop.description && <span className="rm-desc">{stop.description}</span>}
      {stop.checkpoint && <span className="rm-checkpoint"><i>Checkpoint:</i> {stop.checkpoint}</span>}
      <small><CountsLine stop={stop} /> of {stop.counts.total} Actions</small>
      <small>{stop.notSmall > 0 ? `${stop.notSmall} open Actions are not small (size is not recorded yet), so their length is unknown.` : "No open Actions."}{open === 0 && stop.counts.total > 0 ? "" : ""}</small>
      <small className="rm-dated">Counts as recorded in the Plan on {stop.countsAsOf}.</small>
      {stop.isActive && <span className="rm-here" role="note">● you are here{currentAction ? <> · current Action <code>{currentAction}</code></> : null}</span>}
    </div>
  </li>;
}

function UnreadableStop({ stop }: { stop: Extract<RoadmapStop, { kind: "unreadable" }> }) {
  return <li className="rm-plan rm-gap" aria-label={`Plan ${stop.letter}, unreadable`}>
    <div className="rm-col rm-gapcol" aria-hidden="true" />
    <div className="rm-plan-text">
      <b>Plan {stop.letter}: could not be read</b>
      {stop.description && <span className="rm-desc">{stop.description}</span>}
      <small>{stop.reason}</small>
    </div>
  </li>;
}

/**
 * The Roadmap as one vertical stack, the North Star at the top and the Project's present at the bottom. Pure and
 * stateless: every title and sentence is a React text node, so a hostile Plan title can never become markup.
 */
export function RoadmapStack({ view }: { view: RoadmapView }) {
  // Roadmap order runs earliest first; the stack draws the route upward, so the earliest Plan sits at the bottom.
  const plans = [...view.sequence].reverse();
  const unreadable = view.sequence.filter(s => s.kind === "unreadable").length;
  return <div className="rm-stack">
    <section className="rm-ns" aria-label="North Star">
      <b>★ North Star</b>
      {view.northStar ? <>
        <p className="rm-target">{view.northStar.target}</p>
        {view.northStar.why && <p className="rm-why">{view.northStar.why}</p>}
        {view.northStar.looksLike && <details><summary>What it looks like</summary><p className="rm-why">{view.northStar.looksLike}</p></details>}
        {view.northStar.gates.length > 0 && <ul className="rm-gates" aria-label="North Star gates">
          {view.northStar.gates.map(g => <li key={g.id}><span className={`rm-gate rm-gate-${g.status}`}>{g.status.replace("_", " ")}</span> {g.title}<small>{g.basis}</small></li>)}
        </ul>}
        <small>Read from NORTH_STAR.md{view.northStar.updated ? `, updated ${view.northStar.updated}` : ""}. Shown as written.</small>
      </> : <p className="rm-fogtext">The North Star could not be read, so the route has no target.</p>}
    </section>

    <div className="rm-fog" role="note">
      <b>Milestones: none recorded</b>
      <span>{view.milestones.note}</span>
    </div>

    {view.later.length > 0 && <div className="rm-fog" role="note">
      <b>Later: named work with no Plan yet</b>
      <ul>{view.later.map((l, i) => <li key={i}>{l.text}</li>)}</ul>
      <span>Unknown beyond here: no criteria are listed, so this part of the route has no length.</span>
    </div>}
    {view.later.length === 0 && <div className="rm-fog" role="note"><b>Unknown beyond the last Plan</b><span>Nothing is recorded past the Plans below.</span></div>}

    {plans.length > 0 ? <ol className="rm-plans" aria-label="Plans, latest first">
      {plans.map(stop => stop.kind === "plan"
        ? <PlanStopView key={stop.slug} stop={stop} currentAction={view.project?.currentAction ?? null} />
        : <UnreadableStop key={stop.slug} stop={stop} />)}
    </ol> : <div className="rm-fog" role="note"><b>No Plans can be sequenced</b><span>docs/roadmap.md lists no readable Plan order.</span></div>}

    {view.activePlanOffRoute && view.project?.activePlan && <p className="rm-here rm-off" role="status">● you are here, but the active Plan ({view.project.activePlan}) is not on this route.</p>}
    {unreadable > 0 && <p className="rm-note" role="status">{unreadable} Plan{unreadable === 1 ? "" : "s"} could not be read and {unreadable === 1 ? "is" : "are"} drawn as a gap.</p>}

    <p className="rm-legend">solid = done · hatched = open, not small (size unknown) · dashed = deferred · dotted = fog. Height is Action count only. Nothing here is a forecast, and nothing is declared reached: only the operator declares a Milestone.</p>
  </div>;
}
