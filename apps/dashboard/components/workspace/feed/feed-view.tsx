"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useApprovals } from "../../../hooks/use-approvals";
import { useNextSteps } from "../../../hooks/use-next-steps";
import { usePullRequestInventory } from "../../../hooks/use-pull-request-inventory";
import { JOURNEY_FIXTURE } from "../../../lib/journey-fixture";
import { fleet, fleetPhrase, loadScreen, saveScreen, urgentRovers, type JourneyScreen, type Rover } from "../../../lib/journey-fleet";
import type { JourneyPhase } from "../../../lib/journey-types";
import { readSky, type SkyReading } from "../../../lib/system-sky";
import { buildFeed, feedSections, type FeedItem } from "../../../lib/workspace-feed";
import { mountWeather } from "./weather";
import "./feed.css";

const PHASE_LABEL: Record<JourneyPhase, string> = {
  parked: "Parked", waiting: "Waiting", launching: "Launching", driving: "Driving", repairing: "Repairing", "in-review": "In review", blocked: "Blocked", arrived: "Arrived"
};
const RING = 2 * Math.PI * 20;
const FLEET: JourneyScreen = { kind: "fleet" };

function storage(): Storage | null { try { return window.localStorage; } catch { return null; } }

function FeedMessage({ item }: { item: FeedItem }) {
  const body = <><span className={`feed-chip kind-${item.kind}${item.urgent ? " urgent" : ""}`}>{item.chip}</span><strong>{item.title}</strong>{item.detail && <span className="feed-detail">{item.detail}</span>}</>;
  return <li className="feed-msg"><span className="feed-dot" aria-hidden="true" />
    {item.href ? (item.external
      ? <a className="feed-bubble" href={item.href} target="_blank" rel="noreferrer">{body}<span className="feed-go" aria-hidden="true">↗</span></a>
      : <Link className="feed-bubble" href={item.href}>{body}<span className="feed-go" aria-hidden="true">→</span></Link>)
      : <div className="feed-bubble">{body}</div>}
  </li>;
}

/** The sky's reading in words, so the weather is never the only way to know. */
function SkyStatus({ sky }: { sky: SkyReading }) {
  return <details className="feed-sky">
    <summary><span className={`feed-sky-dot sky-${sky.id}`} aria-hidden="true" /><span className="k">System</span><b aria-live="polite">{sky.label}</b><span className="feed-sky-weather">{sky.weather}</span></summary>
    <div>
      {sky.reasons.length ? <ul>{sky.reasons.map(r => <li key={r}>{r}</li>)}</ul> : <p>Nothing is moving or waiting.</p>}
      <p className="feed-note">The weather shows system status from the feed&apos;s live reads. The sol sky keeps the time of day, and sample missions never change it.</p>
    </div>
  </details>;
}

function Track({ rover }: { rover: Rover }) {
  const { actions } = rover.journey;
  const done = actions.filter(a => a.journey.destination.reached).length;
  return <span className="feed-track" role="img" aria-label={`${done} of ${actions.length} Actions arrived`}>
    {actions.map(a => <i key={a.id} className={`leg phase-${a.journey.activity.phase}${a.current ? " current" : ""}`} />)}
  </span>;
}

function FleetScreen({ rovers, onOpen }: { rovers: Rover[]; onOpen: (id: string) => void }) {
  return <ul className="feed-fleet">{rovers.map(r => <li key={r.id}>
    <button type="button" className="feed-rover" onClick={() => onOpen(r.id)}>
      <span className="feed-rover-title"><span className={`feed-phase phase-${r.phase}`}>{PHASE_LABEL[r.phase]}</span><strong>{r.journey.plan.slug}</strong><span className="feed-rover-project">{r.journey.project}{r.journey.plan.active ? " · active" : ""}</span></span>
      <Track rover={r} />
      {r.yourMove && <span className="feed-your-move">Your move: {r.yourMove}</span>}
    </button>
  </li>)}</ul>;
}

function MissionScreen({ rover }: { rover: Rover }) {
  return <>
    <p className="feed-milestone"><span className={`feed-phase phase-${rover.phase}`}>{PHASE_LABEL[rover.phase]}</span> {rover.journey.project} · {rover.journey.plan.milestone}</p>
    <Track rover={rover} />
    {rover.yourMove && <p className="feed-your-move">Your move: {rover.yourMove}</p>}
    <ol className="feed-legs">{rover.journey.actions.map(a => <li key={a.id} className={a.current ? "current" : undefined}>
      <span className={`feed-phase phase-${a.journey.activity.phase}`}>{PHASE_LABEL[a.journey.activity.phase]}</span>
      <span><strong>{a.title}</strong><span className="feed-detail">{a.journey.activity.headline}</span>
        {(a.journey.counts.victories > 0 || a.journey.counts.cleared > 0 || a.journey.counts.open > 0) && <span className="feed-counts">{a.journey.counts.victories} landed · {a.journey.counts.cleared} cleared · {a.journey.counts.open} open</span>}</span>
    </li>)}</ol>
  </>;
}

function JourneyPanel({ rovers, screen, onScreen }: { rovers: Rover[]; screen: JourneyScreen; onScreen: (screen: JourneyScreen) => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const current = screen.kind === "mission" ? rovers.find(r => r.id === screen.id) ?? null : null;
  // Urgent missions stay one tap away from any other screen, without switching for the operator.
  const pinned = current ? urgentRovers(rovers).filter(r => r.id !== current.id) : [];
  useEffect(() => { heading.current?.focus(); }, [screen]);
  return <section id="feed-journey" className="feed-journey" aria-labelledby="feed-journey-title">
    <div className="feed-journey-head">
      {current && <button type="button" className="feed-back" onClick={() => onScreen(FLEET)}>← All missions</button>}
      <h2 id="feed-journey-title" ref={heading} tabIndex={-1}>{current ? current.journey.plan.slug : "Journey"}</h2>
      <span className="feed-fixture">Sample data</span>
    </div>
    {!current && <p className="feed-fleet-phrase">{fleetPhrase(rovers)}</p>}
    {pinned.length > 0 && <div className="feed-pinned" role="note" aria-label="Needs you">{pinned.map(r =>
      <button key={r.id} type="button" onClick={() => onScreen({ kind: "mission", id: r.id })}>
        <span className={`feed-phase phase-${r.phase}`}>{PHASE_LABEL[r.phase]}</span><span>{r.journey.plan.slug}{r.yourMove ? `: ${r.yourMove}` : ""}</span><span aria-hidden="true">→</span>
      </button>)}</div>}
    {current ? <MissionScreen rover={current} /> : <FleetScreen rovers={rovers} onOpen={id => onScreen({ kind: "mission", id })} />}
    <p className="feed-note">Mission data is a fixture in the <code>arcadia-plan-journey-v1</code> shape. Live missions are on <Link href="/journey">Journey</Link>.</p>
  </section>;
}

/** One ring segment per rover, colored by what it needs; the count is what waits on the operator. */
function JourneyButton({ rovers, needsYou, alert, open, onToggle }: { rovers: Rover[]; needsYou: number; alert: boolean; open: boolean; onToggle: () => void }) {
  const phrase = fleetPhrase(rovers);
  const waiting = `${needsYou} ${needsYou === 1 ? "item needs" : "items need"} you`;
  const label = open ? `Back to the feed. ${phrase}. ${waiting}.` : `Journey: ${phrase}. ${waiting}.`;
  const slot = rovers.length ? RING / rovers.length : RING;
  const gap = rovers.length > 1 ? 3 : 0;
  return <button type="button" className={`feed-fab${open ? " open" : ""}${alert ? " alert" : ""}`} aria-expanded={open} aria-controls={open ? "feed-journey" : undefined} aria-label={label} title={label} onClick={onToggle}>
    <span className="feed-fab-ring" aria-hidden="true">
      <svg viewBox="0 0 48 48">
        <circle className="track" cx="24" cy="24" r="20" />
        {rovers.map((r, i) => <circle key={r.id} className={`seg group-${r.group}`} cx="24" cy="24" r="20" strokeDasharray={`${slot - gap} ${RING - slot + gap}`} strokeDashoffset={-(i * slot + gap / 2)} />)}
      </svg>
      <span className="feed-fab-count">{needsYou}</span>
    </span>
    <span className="feed-fab-label" aria-hidden="true">{open ? "Feed" : "Journey"}</span>
  </button>;
}

export function FeedView() {
  const [view, setView] = useState<"feed" | "journey">("feed");
  const [screen, setScreen] = useState<JourneyScreen>(FLEET);
  const canvas = useRef<HTMLCanvasElement>(null);
  const skyId = useRef<SkyReading["id"]>("clear");
  const approvals = useApprovals();
  const nextSteps = useNextSteps();
  const prs = usePullRequestInventory();
  const rovers = useMemo(() => fleet(JOURNEY_FIXTURE), []);

  const items = useMemo(() => buildFeed({ approvals: approvals.hasLoaded ? approvals.approvals : null, nextSteps: nextSteps.data, pullRequests: prs.data }), [approvals.hasLoaded, approvals.approvals, nextSteps.data, prs.data]);
  const sections = feedSections(items);
  // A failed read is a finished read: the alert says so instead of an endless "Reading…".
  const loading = (!approvals.hasLoaded && !approvals.error) || (!nextSteps.data && !nextSteps.failed) || prs.loading;
  const problems = [approvals.error && "To-do list", nextSteps.failed && "next steps", prs.error && !prs.data && "pull requests"].filter((p): p is string => Boolean(p));
  const sky = readSky({ items, problems, loading });
  const needsYou = items.filter(i => i.section === "Your move" || i.section === "Waiting on you").length;
  const alert = items.some(i => i.urgent && i.kind !== "pr");

  useEffect(() => { skyId.current = sky.id; }, [sky.id]);
  useEffect(() => { setScreen(loadScreen(storage(), rovers)); }, [rovers]);
  useEffect(() => {
    if (!canvas.current) return;
    return mountWeather(canvas.current, () => skyId.current);
  }, []);

  function show(next: JourneyScreen) { setScreen(next); saveScreen(storage(), next); }

  return <main className={`feed-main view-${view}`}>
    <canvas ref={canvas} className="feed-weather" aria-hidden="true" />
    <SkyStatus sky={sky} />
    <div className="feed-grid">
      <section className="feed-feed" aria-labelledby="feed-title">
        <h1 id="feed-title" className="feed-sr">Messages from Arcadia</h1>
        {problems.length > 0 && <p role="alert" className="feed-problem">Could not read {problems.join(", ")}. What is shown is the last good read.</p>}
        {loading && !items.length ? <p role="status" className="feed-quiet">Reading your work…</p>
          : !items.length && !problems.length ? <p className="feed-quiet">Nothing is waiting on you. Arcadia will say so here when something is.</p>
          : sections.map(s => <section key={s.section} aria-label={s.section}><h2 className="feed-section">{s.section}</h2><ul className="feed-thread">{s.items.map(item => <FeedMessage key={item.key} item={item} />)}</ul></section>)}
      </section>
      {view === "journey" && <JourneyPanel rovers={rovers} screen={screen} onScreen={show} />}
    </div>
    <JourneyButton rovers={rovers} needsYou={needsYou} alert={alert} open={view === "journey"} onToggle={() => setView(v => (v === "feed" ? "journey" : "feed"))} />
  </main>;
}
