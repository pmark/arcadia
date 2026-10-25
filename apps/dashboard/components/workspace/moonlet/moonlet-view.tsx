"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApprovals } from "../../../hooks/use-approvals";
import { useNextSteps } from "../../../hooks/use-next-steps";
import { usePullRequestInventory } from "../../../hooks/use-pull-request-inventory";
import { JOURNEY_FIXTURE, missionPhase } from "../../../lib/journey-fixture";
import type { JourneyPhase } from "../../../lib/journey-types";
import { buildFeed, feedSections, type FeedItem } from "../../../lib/moonlet-feed";
import { atmosphereOf, defaultMood, loadMood, remaining, saveMood, setAtmosphere, setMomentary, settle, snapshot, type MoodState } from "../../../lib/operator-mood";
import { Moonlet } from "./moonlet";
import { mountWeather } from "./weather";
import "./moonlet.css";

const PHASE_LABEL: Record<JourneyPhase, string> = {
  parked: "Parked", waiting: "Waiting", launching: "Launching", driving: "Driving", repairing: "Repairing", "in-review": "In review", blocked: "Blocked", arrived: "Arrived"
};

function storage(): Storage | null { try { return window.localStorage; } catch { return null; } }

function FeedMessage({ item }: { item: FeedItem }) {
  const body = <><span className={`moonlet-chip-label kind-${item.kind}${item.urgent ? " urgent" : ""}`}>{item.chip}</span><strong>{item.title}</strong>{item.detail && <span className="moonlet-detail">{item.detail}</span>}</>;
  return <li className="moonlet-msg"><span className="moonlet-dot" aria-hidden="true" />
    {item.href ? (item.external
      ? <a className="moonlet-bubble" href={item.href} target="_blank" rel="noreferrer">{body}<span className="moonlet-go" aria-hidden="true">↗</span></a>
      : <Link className="moonlet-bubble" href={item.href}>{body}<span className="moonlet-go" aria-hidden="true">→</span></Link>)
      : <div className="moonlet-bubble">{body}</div>}
  </li>;
}

function Missions() {
  return <aside className="moonlet-missions" aria-labelledby="moonlet-missions-title">
    <div className="moonlet-missions-head"><h2 id="moonlet-missions-title">Missions</h2><span className="moonlet-fixture">Sample data</span></div>
    <ul>{JOURNEY_FIXTURE.map(journey => {
      const phase = missionPhase(journey);
      const done = journey.actions.filter(a => a.journey.destination.reached).length;
      const move = journey.actions.find(a => a.journey.activity.yourMove)?.journey.activity.yourMove;
      return <li key={`${journey.project}/${journey.plan.slug}`}>
        <details>
          <summary>
            <span className="moonlet-mission-title"><span className={`moonlet-phase phase-${phase}`}>{PHASE_LABEL[phase]}</span><strong>{journey.plan.slug}</strong><span className="moonlet-mission-project">{journey.project}{journey.plan.active ? " · active" : ""}</span></span>
            <span className="moonlet-track" aria-label={`${done} of ${journey.actions.length} Actions arrived`}>
              {journey.actions.map(a => <i key={a.id} className={`leg phase-${a.journey.activity.phase}${a.current ? " current" : ""}`} title={`${a.title}: ${PHASE_LABEL[a.journey.activity.phase]}`} />)}
            </span>
            {move && <span className="moonlet-your-move">Your move: {move}</span>}
          </summary>
          <p className="moonlet-milestone">{journey.plan.milestone}</p>
          <ol className="moonlet-legs">{journey.actions.map(a => <li key={a.id} className={a.current ? "current" : undefined}>
            <span className={`moonlet-phase phase-${a.journey.activity.phase}`}>{PHASE_LABEL[a.journey.activity.phase]}</span>
            <span><strong>{a.title}</strong><span className="moonlet-detail">{a.journey.activity.headline}</span>
              {(a.journey.counts.victories > 0 || a.journey.counts.cleared > 0 || a.journey.counts.open > 0) && <span className="moonlet-counts">{a.journey.counts.victories} landed · {a.journey.counts.cleared} cleared · {a.journey.counts.open} open</span>}</span>
          </li>)}</ol>
        </details>
      </li>;
    })}</ul>
    <p className="moonlet-note">Mission data is a fixture in the <code>arcadia-plan-journey-v1</code> shape. Live missions are on <Link href="/journey">Journey</Link>.</p>
  </aside>;
}

export function MoonletView() {
  const [mood, setMood] = useState<MoodState>(() => defaultMood(0));
  const [clock, setClock] = useState(0);
  const [saveFailed, setSaveFailed] = useState(false);
  const moodRef = useRef(mood);
  const canvas = useRef<HTMLCanvasElement>(null);
  const approvals = useApprovals();
  const nextSteps = useNextSteps();
  const prs = usePullRequestInventory();

  const commit = useCallback((next: MoodState) => {
    moodRef.current = next; setMood(next);
    setSaveFailed(!saveMood(storage(), next));
  }, []);

  useEffect(() => { const loaded = loadMood(storage(), Date.now()); moodRef.current = loaded; setMood(loaded); setClock(Date.now()); }, []);
  useEffect(() => {
    const id = setInterval(() => {
      const at = Date.now(); setClock(at);
      const settled = settle(moodRef.current, at);
      if (settled !== moodRef.current) commit(settled);
    }, 500);
    return () => clearInterval(id);
  }, [commit]);
  useEffect(() => {
    const surface = canvas.current?.closest<HTMLElement>(".workspace-shell");
    if (!canvas.current || !surface) return;
    return mountWeather(canvas.current, surface, () => moodRef.current);
  }, []);

  const items = useMemo(() => buildFeed({ approvals: approvals.hasLoaded ? approvals.approvals : null, nextSteps: nextSteps.data, pullRequests: prs.data }), [approvals.hasLoaded, approvals.approvals, nextSteps.data, prs.data]);
  const sections = feedSections(items);
  const loading = !approvals.hasLoaded || (!nextSteps.data && !nextSteps.failed) || prs.loading;
  const problems = [approvals.error && "To-do list", nextSteps.failed && "next steps", prs.error && !prs.data && "pull requests"].filter(Boolean);
  const atmosphere = atmosphereOf(mood.atmosphere);
  const left = remaining(mood, clock);

  return <main className="moonlet-main">
    <canvas ref={canvas} className="moonlet-weather" aria-hidden="true" />
    <div className="moonlet-telemetry" aria-label="Operator telemetry">
      <span className="k">Atmosphere</span><b>{atmosphere.label}</b><span className="sep" />
      <span className="k">Now</span><b>{mood.now?.label ?? "—"}</b>
      <details><summary>Signal</summary><pre>{JSON.stringify(snapshot(mood), null, 2)}</pre><p>Display only. Nothing outside this page reads it.</p></details>
    </div>
    <div className="moonlet-grid">
      <section className="moonlet-feed" aria-labelledby="moonlet-feed-title">
        <h1 id="moonlet-feed-title" className="moonlet-sr">Messages from Arcadia</h1>
        {problems.length > 0 && <p role="alert" className="moonlet-problem">Could not read {problems.join(", ")}. What is shown is the last good read.</p>}
        {loading && !items.length ? <p role="status" className="moonlet-quiet">Reading your work…</p>
          : !items.length ? <p className="moonlet-quiet">Nothing is waiting on you. Arcadia will say so here when something is.</p>
          : sections.map(s => <section key={s.section} aria-label={s.section}><h2 className="moonlet-section">{s.section}</h2><ul className="moonlet-thread">{s.items.map(item => <FeedMessage key={item.key} item={item} />)}</ul></section>)}
      </section>
      <Missions />
    </div>
    <footer className="moonlet-dock">
      <Moonlet mood={mood} left={left}
        onMomentary={state => commit(setMomentary(moodRef.current, state, Date.now()))}
        onAtmosphere={id => commit(setAtmosphere(moodRef.current, id))} />
      <p className="moonlet-caption-line" aria-live="polite">
        {mood.now ? <>Feeling <b>{mood.now.image ? "" : `${mood.now.glyph} `}{mood.now.label}</b> · </> : null}atmosphere {atmosphere.label.toLowerCase()}, {atmosphere.note}
        {saveFailed && <> · not saved in this browser</>} · <Link href="/workspace">Ask from the workspace</Link>
      </p>
    </footer>
  </main>;
}
