import { ACTIVITY_SLOW_MS } from "./workspace-activity";
import type { AllPlansResponse, PlanProgressData, PlanRow, PlanSummariesResponse } from "./plans-types";
import { workspaceActionId } from "./workspace-scope";

/**
 * Each piece of work is a route: where it's been, where it is, what's ahead. Everything here is derived from the
 * record with no model call. Words are only ever a prefix of what the record says, marked with an ellipsis when
 * shortened, so a short name can't claim more than its source. The full text stays behind "Read the full record".
 */

const ABBREVIATION = /\b(?:e\.g|i\.e|etc|vs|cf|no)\.$/i;
/** A shortened name doesn't end on a word that only makes sense with what was cut. */
const DANGLING = new Set(["a", "an", "the", "of", "to", "for", "with", "and", "or", "but", "nor", "in", "on", "at", "by", "from", "into", "that", "which", "who", "when", "while", "if", "as", "is", "are", "was", "be", "not", "no", "never", "unless", "only", "except", "until", "before", "after", "without", "so", "its", "their", "this", "these", "those"]);

/** The record's text with Markdown marks and repeated whitespace removed. Words stay in order; none are added. */
export function plainText(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*]+/g, "")
    .replace(/^#+\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function trimDangling(text: string): string {
  let out = text.replace(/[\s.!?,;:(—–-]+$/u, "");
  for (;;) {
    const space = out.lastIndexOf(" ");
    if (space < 0) return out;
    const word = out.slice(space + 1).toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
    if (!DANGLING.has(word)) return out;
    out = out.slice(0, space).replace(/[\s.!?,;:(—–-]+$/u, "");
  }
}

/**
 * At most `max` characters from the start of the text, cut at a sentence or clause when one keeps at least half the
 * room, otherwise at a word. Anything cut is marked with an ellipsis. The result is always a prefix of `plainText`.
 */
export function shortText(text: string | null | undefined, max = 72): string {
  const plain = plainText(text);
  if (plain.length <= max) return plain;
  const room = max - 1;
  const head = plain.slice(0, room + 1);
  let cut = -1;
  for (const match of head.matchAll(/[.;:!?,)](?=\s)|\s[—–-](?=\s)/gu)) {
    const end = match.index + match[0].length;
    if (end < room / 2 || end > room) continue;
    if (match[0] === "." && ABBREVIATION.test(head.slice(0, end))) continue;
    cut = end;
  }
  const atWord = head.lastIndexOf(" ");
  const kept = cut > 0 ? head.slice(0, cut) : atWord >= room / 2 ? head.slice(0, atWord) : head.slice(0, room);
  const clean = trimDangling(kept);
  return `${clean.length ? clean : kept.trimEnd()}…`;
}

/** "first-website" to "First website". Only for a record with no better name, and shown as a name, not a claim. */
export function humanizeSlug(slug: string | null | undefined): string {
  if (!slug) return "";
  const words = slug.replace(/[-_]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "";
}

const STATUS_WORD: Record<string, string> = { done: "Done", open: "Open", in_progress: "In progress", blocked: "Blocked", deferred: "Deferred", active: "Active", complete: "Complete", completed: "Complete", draft: "Draft", proposed: "Proposed", dormant: "Dormant", superseded: "Superseded", archived: "Archived", paused: "Paused", unknown: "Status not recorded" };
/** The record's status in the operator's words. A status this doesn't know is shown as recorded, never mapped. */
export const statusWord = (status: string): string => STATUS_WORD[status] ?? humanizeSlug(status);

/** What the route's color and rover say. Only what the record's counts support: "open" never claims movement. */
export type RouteTone = "blocked" | "moving" | "open" | "arrived" | "empty" | "unread";
export interface RouteShape {
  done: number;
  total: number;
  tone: RouteTone;
  /** "29 of 33 done · 1 blocked", which is also the words for anyone who can't see the line. */
  label: string;
  /** One mark per stop, in route order, for the line. */
  marks: StopMark[];
  /** Index of the rover in `marks`, or null with no stops. */
  position: number | null;
}
export type StopMark = "done" | "here" | "blocked" | "deferred" | "ahead";

function countLabel(done: number, total: number, extra: Array<[number, string]>): string {
  if (total === 0) return "No Actions recorded";
  return [`${done} of ${total} done`, ...extra.filter(([n]) => n > 0).map(([n, word]) => `${n} ${word}`)].join(" · ");
}

/** The route from a Plan's counts alone, stops in no recorded order, so done ones come first. Null when uncounted. */
export function shapeFromCounts(counts: PlanRow["actionCounts"]): RouteShape | null {
  if (!counts) return null;
  const deferred = (counts as { deferred?: number }).deferred ?? 0;
  const total = counts.done + counts.open + counts.in_progress + counts.blocked + deferred;
  const tone: RouteTone = total === 0 ? "empty" : counts.blocked ? "blocked" : counts.in_progress ? "moving" : counts.open ? "open" : "arrived";
  const marks: StopMark[] = [
    ...Array<StopMark>(counts.done).fill("done"),
    ...Array<StopMark>(counts.in_progress).fill("here"),
    ...Array<StopMark>(counts.blocked).fill("blocked"),
    ...Array<StopMark>(counts.open).fill("ahead"),
    ...Array<StopMark>(deferred).fill("deferred")
  ];
  const label = countLabel(counts.done, total, [[counts.in_progress, "in progress"], [counts.blocked, "blocked"], [deferred, "deferred"]]);
  return { done: counts.done, total, tone, label, marks, position: rover(marks) };
}

/** The rover sits at the marked stop, else the first unfinished one, else the end of the route. */
function rover(marks: StopMark[]): number | null {
  if (!marks.length) return null;
  const here = marks.indexOf("here");
  if (here >= 0) return here;
  const next = marks.findIndex(m => m === "blocked" || m === "ahead");
  return next >= 0 ? next : marks.length - 1;
}

export interface ProjectRoute {
  slug: string;
  name: string;
  status: string;
  /** The Plan this route is, when the record names one this read could see. */
  plan: string | null;
  shape: RouteShape | null;
  tone: RouteTone;
  /** The record could not be read, in words. */
  problem: string | null;
}

const TONE_ORDER: RouteTone[] = ["blocked", "unread", "moving", "open", "empty", "arrived"];
/** How many routes the portfolio leads with. The rest wait behind one disclosure. */
export const PORTFOLIO_LEAD = 5;

function projectRoute(project: AllPlansResponse["projects"][number]): ProjectRoute {
  const plan = project.plans?.find(p => p.slug === project.activePlan) ?? project.plans?.find(p => p.isActivePlan) ?? null;
  const shape = plan ? shapeFromCounts(plan.actionCounts) : null;
  return { slug: project.slug, name: project.name, status: project.status, plan: plan?.slug ?? null, shape, tone: project.error ? "unread" : shape?.tone ?? "empty", problem: project.error ? "Can't read its Plans" : null };
}

/** A portfolio is a few routes: active Projects, the ones that need a look first. Nothing is dropped, only held back. */
export function portfolioRoutes(projects: AllPlansResponse["projects"], lead = PORTFOLIO_LEAD): { lead: ProjectRoute[]; rest: ProjectRoute[] } {
  const routes = projects.map(projectRoute);
  const rank = (r: ProjectRoute) => TONE_ORDER.indexOf(r.tone);
  const active = routes.filter(r => r.status === "active").map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map(({ r }) => r);
  return { lead: active.slice(0, lead), rest: [...active.slice(lead), ...routes.filter(r => r.status !== "active")] };
}

/** Summaries are reading aids. Only a fresh one names a stop; a stale one waits in the full record, labelled as stale. */
function freshPlanSummary(summaries: PlanSummariesResponse | null, plan: string | null | undefined) {
  const entry = plan ? summaries?.plans[plan] : undefined;
  return entry?.summary && entry.planFresh ? entry.summary : null;
}

const NAME_MAX = 72;
const STOP_MAX = 60;
const CRUMB_MAX = 26;
const SENTENCE_MAX = 150;

export const crumbName = (name: string | null | undefined): string => shortText(name, CRUMB_MAX);

export interface RouteWords {
  name: string;
  /** One sentence beside the name, when the record or a fresh summary has one. */
  sentence: string | null;
  /** Where the words came from, so a reading aid is never mistaken for the record. */
  source: "summary" | "shortened" | "record";
}

/** A Plan's name: a fresh summary's title, else its milestone, else its slug. */
export function planWords(plan: Pick<PlanRow, "slug" | "milestone"> | null, slug: string, summaries: PlanSummariesResponse | null): RouteWords {
  const summary = freshPlanSummary(summaries, slug);
  if (summary) return { name: shortText(summary.title, NAME_MAX), sentence: shortText(summary.purpose, SENTENCE_MAX) || null, source: "summary" };
  const recorded = plainText(plan?.milestone);
  if (recorded) { const name = shortText(recorded, NAME_MAX); return { name, sentence: null, source: name === recorded ? "record" : "shortened" }; }
  return { name: shortText(humanizeSlug(slug), NAME_MAX), sentence: null, source: "record" };
}

/** An Action's name and sentence: a fresh summary's, else the recorded title, shortened. */
export function actionWords(title: string, id: string, plan: string | null | undefined, summaries: PlanSummariesResponse | null, max = NAME_MAX): RouteWords {
  const entry = plan ? summaries?.plans[plan] : undefined;
  const summary = entry?.actions[id] === "fresh" ? entry.summary?.actions.find(a => a.id === id) : undefined;
  if (summary) return { name: shortText(summary.title, max), sentence: shortText(summary.why, SENTENCE_MAX) || null, source: "summary" };
  const recorded = plainText(title);
  const name = shortText(recorded, max);
  return { name, sentence: null, source: name === recorded ? "record" : "shortened" };
}

export interface RouteStop {
  id: string;
  key: string;
  /** Short, for the route. */
  name: string;
  /** Exactly as recorded, for depth. */
  title: string;
  status: string;
  mark: StopMark;
  /** Why this stop leads, in the record's own terms: PROJECT.md's current Action, or the first ready one. */
  role: "current" | "next-ready" | null;
  /** Go named this as its current Action on its last good read. */
  go: boolean;
}

export interface PlanRoute {
  stops: RouteStop[];
  shape: RouteShape;
  /** Where it's been. */
  been: RouteStop[];
  /** Where it is. */
  here: RouteStop | null;
  /** The next few named stops, with anything blocked first. */
  ahead: RouteStop[];
  /** The rest of what's ahead, behind a disclosure. */
  later: RouteStop[];
  /** Deferred stops are off the route for now, and counted. */
  aside: RouteStop[];
}

/** How many stops ahead are named by default. */
export const AHEAD_NAMED = 2;

const markOf = (status: string): StopMark => status === "done" ? "done" : status === "blocked" ? "blocked" : status === "deferred" ? "deferred" : status === "in_progress" ? "here" : "ahead";

/** A Plan is one route with named stops, in the Plan's own order. Every Action stays on it, named or behind a disclosure. */
export function planRoute(progress: PlanProgressData, plan: string | null | undefined, summaries: PlanSummariesResponse | null, goActionId: string | null = null): PlanRoute {
  const stops: RouteStop[] = progress.actions.map(action => {
    const id = workspaceActionId(action.key);
    const isHere = progress.current?.key === action.key;
    return {
      id, key: action.key, title: action.title, status: action.status,
      name: actionWords(action.title, id, plan, summaries, STOP_MAX).name,
      mark: isHere ? "here" : markOf(action.status),
      role: !isHere ? null : progress.current?.basis === "project_current_action" ? "current" : "next-ready",
      go: id === goActionId
    };
  });
  const here = stops.find(s => s.role) ?? stops.find(s => s.mark === "here") ?? null;
  const open = stops.filter(s => s !== here && (s.mark === "ahead" || s.mark === "blocked" || s.mark === "here"));
  const ordered = [...open.filter(s => s.mark === "blocked"), ...open.filter(s => s.mark !== "blocked")];
  const marks = stops.map(s => s.mark);
  const done = progress.actions.filter(a => a.status === "done").length;
  const blocked = stops.filter(s => s.mark === "blocked").length;
  const inProgress = stops.filter(s => s.status === "in_progress").length;
  const deferred = stops.filter(s => s.mark === "deferred").length;
  const total = stops.length;
  const tone: RouteTone = total === 0 ? "empty" : blocked ? "blocked" : inProgress ? "moving" : open.length || here ? "open" : "arrived";
  const shape: RouteShape = { done, total, tone, label: countLabel(done, total, [[inProgress, "in progress"], [blocked, "blocked"], [deferred, "deferred"]]), marks, position: rover(marks) };
  return {
    stops, shape, here,
    been: stops.filter(s => s.mark === "done" && s !== here),
    ahead: ordered.slice(0, AHEAD_NAMED),
    later: ordered.slice(AHEAD_NAMED),
    aside: stops.filter(s => s.mark === "deferred" && s !== here)
  };
}

/** One Action's place on its Plan's route: the line with the rover on this stop. */
export function stopShape(route: PlanRoute, id: string): RouteShape | null {
  const index = route.stops.findIndex(s => s.id === id);
  if (index < 0) return null;
  const marks = route.stops.map(s => s.mark === "here" ? "ahead" as const : s.mark);
  return { ...route.shape, marks, position: index, tone: route.stops[index].mark === "done" ? "arrived" : route.stops[index].mark === "blocked" ? "blocked" : route.stops[index].status === "in_progress" ? "moving" : "open", label: `Stop ${index + 1} of ${route.stops.length}` };
}

export type RouteLevel = "Portfolio" | "Project" | "Plan" | "Action";
const READING: Record<RouteLevel, [string, string]> = {
  Portfolio: ["your Projects", "Reading your Projects"],
  Project: ["this Project's Plans", "Reading this Project's Plans"],
  Plan: ["this Plan", "Reading this Plan"],
  Action: ["this Action", "Reading this Action"]
};
/** The line that says what's being read. Slow reads are allowed, and silent waiting isn't. */
export function readingLine(level: RouteLevel, slow: boolean): string {
  return slow ? `Still reading ${READING[level][0]}. This read is slow, and your tap was received.` : `${READING[level][1]}...`;
}
export const READING_SLOW_MS = ACTIVITY_SLOW_MS;

/** What a tap on a route link does: move in place, do nothing because it's already here, or leave it to the browser. */
export function routeTap(
  anchor: { href: string; target?: string },
  click: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean },
  here: { origin: string; pathname: string }
): "move" | "stay" | "browser" {
  if (click.button !== 0 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return "browser";
  if (anchor.target && anchor.target !== "_self") return "browser";
  let url: URL;
  try { url = new URL(anchor.href); } catch { return "browser"; }
  if (url.origin !== here.origin) return "browser";
  return url.pathname === here.pathname ? "stay" : "move";
}

/** The workspace address's parts, read from the path so a tap and Back or Forward change the view at once. */
export function workspaceParts(pathname: string | null | undefined): string[] {
  const parts = (pathname ?? "").split("/").filter(Boolean).slice(1);
  return parts.map(part => { try { return decodeURIComponent(part); } catch { return part; } });
}

/** A smaller summaries answer: `plan` keeps one Plan, `brief` drops the per-Action text. The record is untouched. */
export function narrowPlanSummaries(response: PlanSummariesResponse, narrow: { plan?: string | null; brief?: boolean }): PlanSummariesResponse {
  let plans = response.plans;
  if (narrow.plan) plans = Object.hasOwn(plans, narrow.plan) ? { [narrow.plan]: plans[narrow.plan] } : {};
  if (narrow.brief) plans = Object.fromEntries(Object.entries(plans).map(([slug, entry]) => [slug, { ...entry, actions: {}, summary: entry.summary ? { ...entry.summary, actions: [] } : null }]));
  return { ...response, plans };
}
