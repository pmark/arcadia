"use client";

import { useState } from "react";
import Link from "next/link";
import type { JourneyProgress } from "../lib/journey-types";

/** Counts describe evidence, not a productivity score or remaining distance. */
export function JourneyProgressPanel({ progress, project }: { progress: JourneyProgress; project: string }) {
  const [days, setDays] = useState(7);
  const period = progress.periods.find(p => p.days === days) ?? progress.periods[0];
  if (!period) return null;
  const { current: w, previous } = period;
  const number = (value: number | null) => value === null ? "unknown" : value.toFixed(2);
  return <section className="mb-4 rounded-md border border-line bg-panel p-3" aria-labelledby="journey-progress-title">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 id="journey-progress-title" className="font-semibold">Travel recorded along the way</h2>
      <label className="text-sm">Window <select className="rounded border border-line bg-panel p-1" value={days} onChange={e => setDays(Number(e.target.value))}>
        {progress.periods.map(p => <option key={p.days} value={p.days}>Last {p.days} elapsed day{p.days === 1 ? "" : "s"}</option>)}
      </select></label>
    </div>
    <p className="mt-2 break-words text-xs text-muted">UTC · {w.start} inclusive → {w.end} exclusive · denominator {w.elapsedDays} × 24 hours.</p>
    <p className="break-words text-xs text-muted">Compared with {previous.start} inclusive → {previous.end} exclusive. Evidence read {progress.generatedAt}.</p>
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Evidence in the selected and preceding equal windows</caption>
        <thead><tr><th scope="col" className="pr-3">Recorded evidence</th><th scope="col" className="pr-3">This window</th><th scope="col">Previous</th></tr></thead>
        <tbody>
          <tr><th scope="row" className="pr-3 font-normal">Delivered heads</th><td>{w.delivered} · {number(w.deliveredPerDay)}/day</td><td>{previous.delivered} · {number(previous.deliveredPerDay)}/day</td></tr>
          <tr><th scope="row" className="pr-3 font-normal">Dated alert clears</th><td>{w.cleared} · {number(w.clearedPerDay)}/day</td><td>{previous.cleared} · {number(previous.clearedPerDay)}/day</td></tr>
          <tr><th scope="row" className="pr-3 font-normal">Unaccepted Session exits</th><td>{w.failed}</td><td>{previous.failed}</td></tr>
          <tr><th scope="row" className="pr-3 font-normal">Session elapsed hours (sum)</th><td>{number(w.sessionHours)}</td><td>{number(previous.sessionHours)}</td></tr>
          <tr><th scope="row" className="pr-3 font-normal">Occupied hours (overlap once)</th><td>{number(w.occupiedHours)}</td><td>{number(previous.occupiedHours)}</td></tr>
        </tbody>
      </table>
    </div>
    <p className="mt-2 text-xs text-muted">Active effort unknown. {w.sessionsWithoutBounds} Sessions lack valid closed time bounds across this Plan's recorded history.</p>
    <p className="mt-1 text-xs text-muted">Alert clears without a real Session binding are excluded; unattributed coverage is unknown.</p>
    <details className="mt-2 text-xs"><summary className="cursor-pointer">Service, model and effort evidence</summary>
      <p className="mt-2">Launch configuration is recorded below. Runtime model/effort, active effort and per-Session token usage are unknown. Outcomes belong to their originating Session; these small, different samples do not rank effectiveness.</p>
      {[{ label: "This window", value: w }, { label: "Previous window", value: previous }].map(({label,value}) => <div key={label} className="mt-2">
        <h3 className="font-semibold">{label}</h3>
        {value.services.length ? <ul className="space-y-2">{value.services.map(g => <li key={JSON.stringify([g.service,g.configuredModel,g.configuredEffort])} className="break-words">
          {g.service} · configured model {g.configuredModel ?? "unknown"} · configured effort {g.configuredEffort ?? "unknown"} · {g.workType}<br />
          {g.sessions} Sessions · {g.closedSpans} closed spans · {number(g.sessionHours)} elapsed hours · {g.delivered} delivered heads · {g.cleared ?? "unknown"} dated alert clears · {g.failed} unaccepted exits<br />
          Source {g.source}: {g.sessionIds.join(", ")}
        </li>)}</ul> : <p>No qualifying Sessions.</p>}
      </div>)}
    </details>
    <details className="mt-2 text-xs"><summary className="cursor-pointer">What these numbers can and cannot tell you</summary>
      <ul className="mt-2 list-disc space-y-1 pl-4">{progress.limitations.map(text => <li key={text}>{text}</li>)}</ul>
    </details>
    <details className="mt-2 text-xs"><summary className="cursor-pointer">Inspect evidence ({w.evidence.length} records)</summary>
      {w.evidence.length ? <ul className="mt-2 space-y-2">{w.evidence.map(e => <li className="break-words" key={`${e.kind}:${e.id}`}>
        <Link className="text-steel underline" href={`/journey/${encodeURIComponent(project)}/${encodeURIComponent(e.action)}`}>{e.action}</Link>
        {` · ${e.kind} · ${e.at} · ${e.source} / ${e.id}`}
        {e.url && /^https:\/\/github\.com\//.test(e.url) ? <> · <a className="text-steel underline" href={e.url}>PR evidence</a></> : null}
      </li>)}</ul> : <p className="mt-2">No qualifying evidence in this window. Historical coverage is unknown.</p>}
    </details>
  </section>;
}
