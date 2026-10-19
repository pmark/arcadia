import type { CSSProperties, ReactNode } from "react";
import {
  CROSS,
  type Glyph,
  type Orientation,
  type Scene,
  layoutJourney,
  pathData,
  placeLabels,
  project
} from "../lib/journey-layout";
import type { Journey, JourneyEvent } from "../lib/journey-types";

/**
 * The rover journey map, in the agreed glyph vocabulary: solid line =
 * travelled; dashed = uncertain ahead (fainter for the repair branch); haloed
 * dot = the rover now; green diamond = victory; hollow rock with the path
 * arcing over it = cleared obstacle; solid amber rock on the path = open
 * obstacle; small circle = review gate; pips = budget; target ring =
 * destination. No hooks, so it renders on the server: the map is complete
 * with JavaScript off.
 */

const C = {
  bg: "rgb(var(--color-canvas))",
  ink: "rgb(var(--color-ink))",
  muted: "rgb(var(--color-muted))",
  rover: "rgb(var(--color-steel))",
  win: "rgb(var(--color-moss))",
  open: "rgb(var(--color-gold))"
};

export const JOURNEY_STYLES = `
.journey-v { display: none; }
.journey-anchor { position: absolute; pointer-events: none; left: var(--hx); top: var(--hy); width: var(--hw); height: var(--hh); }
@media (max-width: 591px) {
  .journey-h { display: none; }
  .journey-v { display: block; }
  .journey-anchor { left: var(--vx); top: var(--vy); width: var(--vw); height: var(--vh); }
}
.journey-map text { font-size: 12px; fill: ${C.muted}; }
.journey-map text.strong { fill: ${C.ink}; font-weight: 600; }
.journey-halo { transform-box: fill-box; transform-origin: center; animation: journey-pulse 2.8s ease-in-out infinite; }
@keyframes journey-pulse { 0%,100% { opacity: .28; transform: scale(1); } 50% { opacity: .1; transform: scale(1.35); } }
@media (prefers-reduced-motion: reduce) { .journey-halo { animation: none; } }
`;

export function JourneyMap({ journey }: { journey: Journey }) {
  const scene = layoutJourney(journey);
  return (
    <div className="journey-scroll w-full overflow-x-auto overflow-y-hidden" role="img" aria-label={describe(journey)}>
      <div className="relative" style={{ width: "max-content" }}>
        <MapSvg scene={scene} orientation="h" />
        <MapSvg scene={scene} orientation="v" />
        {scene.now ? <span id="now" className="journey-anchor" style={anchorStyle(scene)} aria-hidden="true" /> : null}
      </div>
    </div>
  );
}

/**
 * The `#now` fragment target: a box around the rover, positioned per
 * orientation by CSS. Fragment navigation aligns its corner (rover a third
 * of the way in); the live script centers it.
 */
function anchorStyle(scene: Scene): CSSProperties {
  const now = scene.now ?? { s: 0, o: 0 };
  const h = project("h", now.s, now.o);
  const v = project("v", now.s, now.o);
  const hx = Math.max(0, h.x - 120);
  const vy = Math.max(0, v.y - 200);
  return {
    ["--hx" as string]: `${hx}px`,
    ["--hy" as string]: "0px",
    ["--hw" as string]: `${Math.min(240, scene.length - hx)}px`,
    ["--hh" as string]: `${CROSS.h}px`,
    ["--vx" as string]: "0px",
    ["--vy" as string]: `${vy}px`,
    ["--vw" as string]: `${CROSS.v}px`,
    ["--vh" as string]: `${Math.min(400, scene.length - vy)}px`
  };
}

function MapSvg({ scene, orientation }: { scene: Scene; orientation: Orientation }) {
  const width = orientation === "h" ? scene.length : CROSS.v;
  const height = orientation === "h" ? CROSS.h : scene.length;
  const dashed = { fill: "none", strokeDasharray: "2 6", strokeLinecap: "round" } as const;
  return (
    <svg
      className={`journey-map journey-${orientation}`}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      style={orientation === "v" ? { maxWidth: "100%", height: "auto" } : undefined}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {scene.ahead.length > 0 ? (
        <path d={pathData(orientation, scene.ahead)} {...dashed} stroke={C.ink} strokeWidth={2}><title>Ahead: uncertain terrain</title></path>
      ) : null}
      {scene.branches.map((branch) => (
        <path
          key={branch.id}
          d={pathData(orientation, branch.cmds)}
          {...dashed}
          stroke={branch.likely ? C.ink : C.muted}
          strokeWidth={branch.likely ? 2 : 1.5}
          opacity={branch.available ? (branch.likely ? 1 : 0.8) : 0.35}
        >
          <title>{branch.title}</title>
        </path>
      ))}
      <path d={pathData(orientation, scene.travelled)} fill="none" stroke={C.ink} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
        <title>Travelled: known terrain</title>
      </path>
      {scene.glyphs.filter((glyph) => glyph.type !== "rover").map((glyph, index) => <GlyphMark key={index} glyph={glyph} orientation={orientation} />)}
      {placeLabels(orientation, scene.labels).map((label, index) => (
        <text key={index} x={label.x} y={label.y} textAnchor={label.anchor} className={label.strong ? "strong" : undefined}>{label.text}</text>
      ))}
      {scene.glyphs.filter((glyph) => glyph.type === "rover").map((glyph, index) => <GlyphMark key={`rover-${index}`} glyph={glyph} orientation={orientation} />)}
    </svg>
  );
}

function GlyphMark({ glyph, orientation }: { glyph: Glyph; orientation: Orientation }): ReactNode {
  const at = (s: number, o: number) => project(orientation, glyph.s + s, glyph.o + o);
  const poly = (points: Array<[number, number]>) =>
    points.map(([s, o], index) => {
      const { x, y } = at(s, o);
      return `${index === 0 ? "M" : "L"}${Math.round(x * 10) / 10} ${Math.round(y * 10) / 10}`;
    }).join(" ") + " Z";
  const { x, y } = at(0, 0);
  const title = <title>{glyph.title}</title>;
  switch (glyph.type) {
    case "launch":
      return <circle cx={x} cy={y} r={3.5} fill={C.ink}>{title}</circle>;
    case "victory":
      return <path d={poly([[0, -7], [7, 0], [0, 7], [-7, 0]])} fill={C.win}>{title}</path>;
    case "cleared":
      return <path d={poly([[-6, 5.8], [6, 5.8], [0, -5]])} fill={C.bg} stroke={C.muted} strokeWidth={1.3} strokeLinejoin="round">{title}</path>;
    case "obstacle":
      return <path d={poly([[-6.5, 6], [6.5, 6], [0, -6]])} fill={C.open} strokeLinejoin="round">{title}</path>;
    case "gate":
      return <circle cx={x} cy={y} r={5} fill={C.bg} stroke={C.ink} strokeWidth={1.6}>{title}</circle>;
    case "pip": {
      const r = glyph.size === "large" ? 3.2 : 2.2;
      const fill = glyph.pip === "spent" ? C.muted : C.bg;
      const stroke = glyph.pip === "live" ? C.rover : C.muted;
      return <circle cx={x} cy={y} r={r} fill={fill} stroke={stroke} strokeWidth={glyph.pip === "live" ? 1.5 : 1.2}>{title}</circle>;
    }
    case "destination":
      return (
        <g>
          <circle cx={x} cy={y} r={11} fill={glyph.reached ? C.ink : C.bg} stroke={C.ink} strokeWidth={1.8}>{title}</circle>
          <circle cx={x} cy={y} r={3} fill={glyph.reached ? C.bg : C.ink}>{title}</circle>
        </g>
      );
    case "rover":
      return (
        <g>
          <circle cx={x} cy={y} r={13} fill={C.rover} className="journey-halo" />
          <circle cx={x} cy={y} r={7} fill={C.rover} stroke={C.bg} strokeWidth={2}>{title}</circle>
        </g>
      );
  }
}

export function JourneyLegend() {
  const item = (svg: ReactNode, text: string) => (
    <li className="flex items-center gap-1.5">
      <svg viewBox="0 0 26 14" width={26} height={14} style={{ overflow: "visible" }} aria-hidden="true">{svg}</svg>
      {text}
    </li>
  );
  return (
    <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted" aria-hidden="true">
      {item(<><circle cx={13} cy={7} r={6} fill={C.rover} opacity={0.25} /><circle cx={13} cy={7} r={3.5} fill={C.rover} /></>, "now")}
      {item(<line x1={1} y1={7} x2={25} y2={7} stroke={C.ink} strokeWidth={2.5} strokeLinecap="round" />, "travelled")}
      {item(<line x1={1} y1={7} x2={25} y2={7} stroke={C.ink} strokeWidth={2} strokeDasharray="2 5" strokeLinecap="round" />, "ahead, uncertain")}
      {item(<path d="M13 1 L19 7 L13 13 L7 7 Z" fill={C.win} />, "victory")}
      {item(<><path d="M1 12 L6 12 Q13 -4 20 12 L25 12" fill="none" stroke={C.ink} strokeWidth={2} /><path d="M9 13 L17 13 L13 7 Z" fill="none" stroke={C.muted} strokeWidth={1.3} /></>, "obstacle cleared")}
      {item(<><line x1={1} y1={11} x2={25} y2={11} stroke={C.ink} strokeWidth={2} strokeDasharray="2 5" /><path d="M7 13 L19 13 L13 2 Z" fill={C.open} /></>, "obstacle open")}
      {item(<><circle cx={13} cy={7} r={5} fill="none" stroke={C.ink} strokeWidth={1.6} /></>, "review gate")}
      {item(<><circle cx={13} cy={7} r={6} fill="none" stroke={C.ink} strokeWidth={1.6} /><circle cx={13} cy={7} r={2} fill={C.ink} /></>, "destination")}
      {item(<><circle cx={5} cy={7} r={3} fill={C.muted} /><circle cx={13} cy={7} r={3} fill="none" stroke={C.muted} strokeWidth={1.2} /><circle cx={21} cy={7} r={3} fill="none" stroke={C.muted} strokeWidth={1.2} /></>, "budget left")}
    </ul>
  );
}

const LOG_MARK: Record<JourneyEvent["kind"], string> = { launch: "•", victory: "◆", cleared: "△", obstacle: "▲", gate: "○", now: "◉" };
const LOG_COLOR: Record<JourneyEvent["kind"], string> = { launch: "text-ink", victory: "text-moss", cleared: "text-muted", obstacle: "text-gold", gate: "text-ink", now: "text-steel" };

/** The same events as text, newest first: what a phone tap cannot get from a hover title. */
export function JourneyLog({ journey }: { journey: Journey }) {
  const rows = [...journey.events];
  if (journey.now) rows.push(journey.now);
  rows.reverse();
  if (journey.gate) rows.unshift(journey.gate);
  return (
    <ol className="mt-6 space-y-2 text-sm">
      {rows.map((event, index) => (
        <li key={index} className="flex gap-2">
          <span className={`w-4 shrink-0 text-center ${LOG_COLOR[event.kind]}`} aria-hidden="true">{LOG_MARK[event.kind]}</span>
          <span className="min-w-0">
            <span className={event.kind === "now" ? "font-semibold text-ink" : "text-ink"}>{event.label}</span>
            {event.class ? <span className="ml-1.5 rounded bg-line/60 px-1 text-xs text-muted">{event.class}</span> : null}
            <span className="ml-1.5 text-xs text-muted">{event.kind === "gate" ? "ahead" : `${event.at.slice(5, 16).replace("T", " ")} UTC`}</span>
            {event.ref?.url ? <a className="ml-1.5 text-xs text-steel underline" href={event.ref.url}>#{event.ref.id}</a> : null}
            <span className="block break-words text-xs text-muted">{event.detail}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** One sentence for screen readers, built from the same data. */
export function describe(journey: Journey): string {
  const count = (kind: JourneyEvent["kind"]) => journey.events.filter((event) => event.kind === kind).length;
  const parts = [`Journey of ${journey.action.id}: ${count("victory")} victories, ${count("cleared")} obstacles cleared`];
  const open = count("obstacle");
  if (open > 0) parts.push(`${open} obstacle${open === 1 ? "" : "s"} open`);
  if (journey.destination.reached) parts.push(`destination reached: ${journey.destination.label}`);
  else if (journey.now) parts.push(`now: ${journey.now.label}`);
  parts.push(...journey.ahead.map((branch) => `ahead: ${branch.label}`));
  return `${parts.join("; ")}.`;
}
