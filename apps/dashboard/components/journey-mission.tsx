import Link from "next/link";
import { missionSummary } from "../lib/journey-context";
import type { Journey } from "../lib/journey-types";
import type { PathBrief } from "../lib/path-types";

/**
 * The trip in context, top down: the North Star (with its gates' progress),
 * the Project's milestone, and this Action's place in its Plan. Long text
 * folds behind a disclosure so the map stays the first thing on the page.
 */
export function JourneyMission({ journey, path }: { journey: Journey; path: PathBrief | null }) {
  const mission = missionSummary(path, journey);
  const { context } = journey;
  const row = (label: string, body: React.ReactNode) => (
    <div className="flex gap-2">
      <dt className="w-20 shrink-0 text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="min-w-0 text-sm text-ink">{body}</dd>
    </div>
  );
  const more = (summary: string, text: string | null | undefined) =>
    text ? (
      <details className="mt-0.5 text-xs text-muted">
        <summary className="cursor-pointer select-none">{summary}</summary>
        <p className="mt-1 break-words">{text}</p>
      </details>
    ) : null;
  const planLine = context?.plan
    ? `Step ${context.plan.position ?? "?"} of ${context.plan.total} in ${context.plan.active ? "the active" : "its"} Plan · ${context.plan.done} done`
    : null;

  if (!mission.northStar && !context) return null;
  return (
    <dl className="mb-4 space-y-2 rounded-md border border-line bg-panel px-3 py-2.5">
      {mission.northStar
        ? row("North Star", (
            <>
              <span className="font-semibold">{mission.northStar.text}</span>
              {mission.progress ? (
                <span className="ml-1.5 text-xs text-muted">
                  {mission.progress.gatesDone}/{mission.progress.gates} gates · {mission.progress.stepsDone}/{mission.progress.steps} steps ·{" "}
                  <Link className="text-steel underline" href="/path">path</Link>
                </span>
              ) : null}
              {mission.currentGate ? <span className="block text-xs text-muted">Gate in progress: {mission.currentGate}</span> : null}
              {more("Done when, and why", `${mission.northStar.looksLike}${mission.northStar.why ? ` Why: ${mission.northStar.why}` : ""}`)}
            </>
          ))
        : null}
      {context?.project
        ? row("Milestone", (
            <>
              <span className="line-clamp-2">{context.plan?.milestone ?? context.project.milestone ?? context.project.goal}</span>
              {more(`${context.project.name}: goal and outcome`, `${context.project.goal}${context.project.outcome ? ` Outcome: ${context.project.outcome}` : ""}`)}
            </>
          ))
        : null}
      {context?.action || planLine
        ? row("This trip", (
            <>
              {context?.action ? <span className="line-clamp-2">{context.action.title}</span> : null}
              <span className="block text-xs text-muted">
                {planLine}
                {mission.onPath ? ` · a step on the North Star path (${mission.onPath.gateTitle})` : mission.northStar ? " · serves the milestone, not a North Star gate" : ""}
              </span>
              {more("Why", context?.action?.why)}
            </>
          ))
        : null}
    </dl>
  );
}
