import Link from "next/link";
import type { JourneyPhase, PlanJourney } from "../lib/journey-types";
import type { PathBrief } from "../lib/path-types";

const PHASE_DOT: Record<JourneyPhase, string> = {
  arrived: "bg-moss", driving: "bg-steel", launching: "bg-steel", repairing: "bg-gold",
  "in-review": "bg-ink", blocked: "bg-clay", waiting: "bg-muted", parked: "bg-muted"
};

/**
 * A Plan's journey as a compact list: one row per Action in Plan order, a
 * phase dot, the headline with its start time, a "Your move" chip when a
 * person is needed, and a link to that Action's own journey. No hooks, so it
 * renders on the server; `formatTime` lets the live wrapper switch to local time.
 */
export function PlanJourneyList({ journey, path = null, formatTime }: { journey: PlanJourney; path?: PathBrief | null; formatTime: (iso: string) => string }) {
  const { context } = journey;
  const done = journey.actions.filter((action) => action.journey.destination.reached).length;
  return (
    <>
      {path?.target.declared ? (
        <p className="mb-3 rounded-md border border-line bg-panel px-3 py-2 text-sm">
          <span className="mr-2 text-xs uppercase tracking-wide text-muted">North Star</span>
          <span className="break-words font-semibold">{path.target.text}</span>
          <span className="ml-1.5 text-xs text-muted">
            {path.totals.gatesDone}/{path.totals.gates} gates · <Link className="text-steel underline" href="/path">path</Link>
          </span>
        </p>
      ) : null}
      {context.project ? (
        <p className="mb-3 line-clamp-2 break-words text-[13px] text-muted">{journey.plan.milestone ?? context.project.milestone ?? context.project.goal}</p>
      ) : null}
      <ul className="divide-y divide-line rounded-md border border-line bg-panel" aria-label="Actions in this Plan">
        {journey.actions.map((action) => {
          const { activity } = action.journey;
          return (
            <li key={action.id} className={action.current ? "bg-steel/10" : undefined} aria-current={action.current ? "step" : undefined}>
              <Link href={`/journey/${encodeURIComponent(journey.project)}/${encodeURIComponent(action.id)}#now`} className="block px-3 py-2.5">
                <span className="flex items-start gap-2">
                  <span className={`mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${PHASE_DOT[activity.phase]}`} data-phase={activity.phase} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className={`block break-words text-sm ${action.current ? "font-semibold" : "font-medium"} text-ink`}>{action.title}</span>
                    <span className="block break-words text-xs text-muted">
                      {activity.headline}
                      {activity.since ? <span> · since {formatTime(activity.since)}</span> : null}
                      {action.journey.counts.victories > 0 ? <span> · {action.journey.counts.victories} PR{action.journey.counts.victories === 1 ? "" : "s"}</span> : null}
                      {action.journey.counts.open > 0 ? <span className="text-gold"> · {action.journey.counts.open} open obstacle{action.journey.counts.open === 1 ? "" : "s"}</span> : null}
                    </span>
                    {activity.yourMove ? (
                      <span className="mt-1 block break-words rounded bg-clay/10 px-2 py-1 text-xs text-clay"><span className="font-semibold">Your move: </span>{activity.yourMove}</span>
                    ) : null}
                  </span>
                  {action.current ? <span className="shrink-0 rounded bg-steel/15 px-1.5 text-[11px] text-steel">current</span> : null}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-muted">{done} of {journey.actions.length} Actions done</p>
    </>
  );
}
