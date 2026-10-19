import type { Journey, JourneyBudget, JourneyEvent } from "./journey-types";

/**
 * Pure geometry for the rover journey. The scene is laid out once along the
 * path (`s`, distance travelled; `o`, offset across it, negative = above or
 * right of the path) and projected twice: a horizontal map for wide screens
 * and a vertical one for phones, exactly as the agreed prototype does.
 */

export type Orientation = "h" | "v";

export type PathCmd =
  | { op: "M" | "L"; s: number; o: number }
  | { op: "Q"; cs: number; co: number; s: number; o: number }
  | { op: "C"; c1s: number; c1o: number; c2s: number; c2o: number; s: number; o: number };

export type GlyphType = "launch" | "victory" | "cleared" | "obstacle" | "gate" | "pip" | "destination" | "rover";

export interface Glyph {
  type: GlyphType;
  s: number;
  o: number;
  title: string;
  /** Pips only: spent, in use (the attempt running now) or left. */
  pip?: "spent" | "live" | "left";
  /** Pips only: the larger repair-round pips or the smaller review-attempt pips. */
  size?: "small" | "large";
  reached?: boolean;
}

export interface Label {
  s: number;
  text: string;
  prefer: "a" | "b";
  strong: boolean;
}

export interface Branch {
  id: "pass" | "repair";
  cmds: PathCmd[];
  likely: boolean;
  available: boolean;
  title: string;
}

export interface Scene {
  length: number;
  travelled: PathCmd[];
  ahead: PathCmd[];
  branches: Branch[];
  glyphs: Glyph[];
  labels: Label[];
  now: { s: number; o: number } | null;
}

const START = 30;
const STEP = 40;
const BUMP = 13;
const BUMP_HEIGHT = 30;
const TO_ROVER = 70;
const TO_GATE = 75;
const BRANCH = 170;
const TAIL = 45;

export function layoutJourney(journey: Journey): Scene {
  const travelled: PathCmd[] = [{ op: "M", s: START, o: 0 }];
  const glyphs: Glyph[] = [];
  const labels: Label[] = [];
  const past = journey.events.filter((event) => event.kind === "launch" || event.kind === "victory" || event.kind === "cleared");
  const open = journey.events.filter((event) => event.kind === "obstacle");

  let s = START;
  past.forEach((event, index) => {
    if (index > 0) s += STEP;
    if (event.kind === "cleared") {
      travelled.push({ op: "L", s: s - BUMP, o: 0 }, { op: "Q", cs: s, co: -BUMP_HEIGHT, s: s + BUMP, o: 0 });
      glyphs.push({ type: "cleared", s, o: 0, title: titleOf(event) });
      return;
    }
    travelled.push({ op: "L", s, o: 0 });
    if (event.kind === "launch") {
      glyphs.push({ type: "launch", s, o: 0, title: titleOf(event) });
      labels.push({ s, text: event.label, prefer: "b", strong: false });
    } else {
      glyphs.push({ type: "victory", s, o: 0, title: titleOf(event) });
      labels.push({ s, text: event.label, prefer: "a", strong: false });
    }
  });

  if (journey.destination.reached) {
    const dest = (past.length > 0 ? s : START) + TO_ROVER;
    travelled.push({ op: "L", s: dest, o: 0 });
    glyphs.push({ type: "destination", s: dest, o: 0, title: `Destination reached: ${journey.destination.label}`, reached: true });
    labels.unshift({ s: dest, text: journey.destination.label, prefer: "a", strong: true });
    return { length: dest + TAIL, travelled, ahead: [], branches: [], glyphs, labels, now: null };
  }

  const nowS = past.length > 0 ? s + TO_ROVER : START;
  if (past.length > 0) travelled.push({ op: "L", s: nowS, o: 0 });
  const nowEvent = journey.now;
  if (nowEvent) labels.unshift({ s: nowS, text: nowEvent.label, prefer: "a", strong: true });

  let cursor = nowS;
  for (const event of open) {
    cursor += STEP;
    glyphs.push({ type: "obstacle", s: cursor, o: 0, title: titleOf(event) });
    labels.push({ s: cursor, text: event.label, prefer: "b", strong: false });
  }

  const forkS = journey.gate ? cursor + TO_GATE : cursor;
  const ahead: PathCmd[] = forkS > nowS ? [{ op: "M", s: nowS, o: 0 }, { op: "L", s: forkS, o: 0 }] : [];
  if (journey.gate) {
    glyphs.push({ type: "gate", s: forkS, o: 0, title: titleOf(journey.gate) });
    glyphs.push(...pips(journey.budget.reviewAttempts, "small", "Review attempts", (index, count) => ({ s: forkS + (index - (count - 1) / 2) * 6.6, o: 14 })));
  }

  const dest = forkS + BRANCH;
  const branches: Branch[] = journey.ahead.map((branch) => {
    const sign = branch.id === "pass" ? -1 : 1;
    const cmds: PathCmd[] = [
      { op: "M", s: forkS, o: 0 },
      { op: "C", c1s: forkS + 40, c1o: sign * 40, c2s: dest - 45, c2o: sign * 40, s: dest, o: 0 }
    ];
    return { id: branch.id, cmds, likely: branch.likely, available: branch.available, title: branch.label };
  });
  const repair = branches.find((branch) => branch.id === "repair");
  if (repair) {
    const curve = repair.cmds[1] as Extract<PathCmd, { op: "C" }>;
    glyphs.push(...pips(journey.budget.repairRounds, "large", "Repair rounds", (index, count) => cubicPoint(forkS, curve, (index + 1) / (count + 1))));
  }
  glyphs.push({ type: "destination", s: dest, o: 0, title: `Destination: ${journey.destination.label}` });
  labels.push({ s: dest, text: journey.destination.label, prefer: "a", strong: true });
  if (nowEvent) glyphs.push({ type: "rover", s: nowS, o: 0, title: titleOf(nowEvent) });

  return { length: dest + TAIL, travelled, ahead, branches, glyphs, labels, now: { s: nowS, o: 0 } };
}

function pips(
  budget: JourneyBudget,
  size: "small" | "large",
  name: string,
  place: (index: number, count: number) => { s: number; o: number }
): Glyph[] {
  const title = `${name}: ${budget.spent} spent${budget.inUse > 0 ? `, ${budget.inUse} in progress` : ""}, of ${budget.limit}`;
  return Array.from({ length: budget.limit }, (_, index) => ({
    type: "pip" as const,
    ...place(index, budget.limit),
    title,
    size,
    pip: index < budget.spent ? ("spent" as const) : index < budget.spent + budget.inUse ? ("live" as const) : ("left" as const)
  }));
}

function cubicPoint(startS: number, curve: Extract<PathCmd, { op: "C" }>, t: number): { s: number; o: number } {
  const u = 1 - t;
  const s = u ** 3 * startS + 3 * u * u * t * curve.c1s + 3 * u * t * t * curve.c2s + t ** 3 * curve.s;
  const o = 3 * u * u * t * curve.c1o + 3 * u * t * t * curve.c2o;
  return { s: Math.round(s * 10) / 10, o: Math.round(o * 10) / 10 };
}

function titleOf(event: JourneyEvent): string {
  const when = event.at.slice(0, 16).replace("T", " ");
  return `${event.label} (${when} UTC): ${event.detail}`;
}

/* ---- projection ---------------------------------------------------- */

export const CENTER = { h: 100, v: 160 } as const;
export const CROSS = { h: 200, v: 340 } as const;

export function project(orientation: Orientation, s: number, o: number): { x: number; y: number } {
  return orientation === "h" ? { x: s, y: CENTER.h + o } : { x: CENTER.v - o, y: s };
}

export function pathData(orientation: Orientation, cmds: PathCmd[]): string {
  const pt = (s: number, o: number) => {
    const { x, y } = project(orientation, s, o);
    return `${round(x)} ${round(y)}`;
  };
  return cmds
    .map((cmd) => {
      if (cmd.op === "Q") return `Q${pt(cmd.cs, cmd.co)} ${pt(cmd.s, cmd.o)}`;
      if (cmd.op === "C") return `C${pt(cmd.c1s, cmd.c1o)} ${pt(cmd.c2s, cmd.c2o)} ${pt(cmd.s, cmd.o)}`;
      return `${cmd.op}${pt(cmd.s, cmd.o)}`;
    })
    .join(" ");
}

export interface PlacedLabel {
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
  text: string;
  strong: boolean;
}

/**
 * Labels in the order given (strong ones first), each on its preferred side,
 * else the other side, else dropped: the glyph keeps its title either way.
 */
export function placeLabels(orientation: Orientation, labels: Label[]): PlacedLabel[] {
  const taken: Record<"a" | "b", Array<[number, number]>> = { a: [], b: [] };
  const ordered = [...labels.filter((label) => label.strong), ...labels.filter((label) => !label.strong)];
  const placed: PlacedLabel[] = [];
  for (const label of ordered) {
    const half = orientation === "h" ? (label.text.length * 6.6 + 8) / 2 : 9;
    const span: [number, number] = [label.s - half, label.s + half];
    const free = (side: "a" | "b") => taken[side].every(([lo, hi]) => span[1] <= lo || span[0] >= hi);
    const other = label.prefer === "a" ? "b" : "a";
    const side = free(label.prefer) ? label.prefer : free(other) ? other : null;
    if (!side) continue;
    taken[side].push(span);
    if (orientation === "h") {
      // A label wider than the room left of its glyph starts at the edge instead of running off it.
      const clipped = label.s - half < EDGE;
      placed.push({ x: clipped ? EDGE : label.s, y: side === "a" ? 78 : 131, anchor: clipped ? "start" : "middle", text: label.text, strong: label.strong });
    } else {
      // Beside a vertical path there is room for about 22 characters; the glyph's title and the log keep the rest.
      const text = label.text.length > 22 ? `${label.text.slice(0, 21)}…` : label.text;
      placed.push({ x: side === "a" ? 182 : 138, y: label.s + 4, anchor: side === "a" ? "start" : "end", text, strong: label.strong });
    }
  }
  return placed;
}

const EDGE = 4;

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
