"use client";

import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { READING_SLOW_MS, readingLine, routeTap, type RouteLevel, type RouteShape } from "../../../lib/workspace-routes";

/**
 * A tap on a route changes the address and the screen at once. This uses the browser's history directly, which Next
 * keeps in step with the router, so no page request sits between the tap and the screen. Back and Forward still work,
 * and a tap with a modifier still opens a new tab, because this is an ordinary link.
 */
export function RouteLink({ href, children, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) {
  const tap = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    const move = routeTap(event.currentTarget, event, window.location);
    if (move === "browser") return;
    event.preventDefault();
    if (move === "stay") return;
    window.history.pushState(null, "", href);
    window.scrollTo(0, 0);
    document.getElementById("workspace-context")?.focus({ preventScroll: true });
  };
  return <a href={href} onClick={tap} {...rest}>{children}</a>;
}

const WIDTH = 300;
const MANY = 60;

/** The shape of a piece of work: the solid line is where it's been, the rover is where it is, the dots are what's ahead. */
export function RouteLine({ shape, big = false }: { shape: RouteShape | null; big?: boolean }) {
  const height = big ? 44 : 24;
  const y = height / 2;
  const marks = shape?.marks ?? [];
  const x = (i: number) => (marks.length < 2 ? 8 : 8 + (i * (WIDTH - 16)) / (marks.length - 1));
  const position = shape?.position ?? null;
  return <svg className={`route-line tone-${shape?.tone ?? "empty"}`} viewBox={`0 0 ${WIDTH} ${height}`} aria-hidden="true" focusable="false">
    <line className="route-ahead" x1={8} y1={y} x2={WIDTH - 8} y2={y} />
    {position !== null && position > 0 && <line className="route-been" x1={8} y1={y} x2={x(position)} y2={y} />}
    {marks.length <= MANY && marks.map((mark, i) => i === position ? null : <circle key={i} className={`route-stop stop-${mark}`} cx={x(i)} cy={y} r={mark === "done" ? 2.4 : 2} />)}
    {position !== null && <circle className="route-rover" cx={x(position)} cy={y} r={big ? 6.5 : 5} />}
  </svg>;
}

/** What's being read, as soon as the screen changes. After a few seconds it also says the tap was received. */
export function RouteReading({ level, reading }: { level: RouteLevel; reading: boolean }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!reading) return;
    const timer = setTimeout(() => setSlow(true), READING_SLOW_MS);
    return () => clearTimeout(timer);
  }, [reading, level]);
  return <p className="route-reading" role="status" aria-live="polite">{reading && <><span className="workspace-activity-spinner" aria-hidden="true" />{readingLine(level, slow)}</>}</p>;
}

/** Holds a route's place until its record arrives, so the layout doesn't jump. */
export const RouteBones = () => <div className="route-bones" aria-hidden="true"><i /><i className="short" /></div>;
