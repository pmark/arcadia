import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { loadNorthStar, NorthStarParseError } from "../northStar/document.js";
import { parseDoc } from "../docs/parse.js";
import type { PlanDoc, ProjectDoc } from "../docs/types.js";

/**
 * The Roadmap: a read-only, derived view of a Project's route to its North Star.
 *
 * It reads checked-in files only (PROJECT.md, NORTH_STAR.md, docs/roadmap.md and the Plans that roadmap names)
 * and stores nothing. No function here writes, spawns or opens a database; `tests/roadmap-derive.test.ts`
 * proves the repository is byte-identical afterwards. Every source that cannot be read becomes a `warnings[]`
 * entry and a drawn gap, never a guessed value.
 *
 * What it deliberately does not know yet (each is a governed change, not a code gap):
 * - Milestones: no checked-in Milestone record exists, so `milestones.recorded` is false and the page draws fog.
 * - Action size: no per-Action `small` flag exists, so every open Action is "not small".
 * - Checkpoints: a Plan's `milestone:` string is exposed as `checkpoint` (the operator's decided word); the
 *   record field keeps its name until a Decision renames it.
 * - Plan order: only `docs/roadmap.md`'s "Plan order" list records it (operator direction, not a Decision).
 */
export const ROADMAP_SCHEMA = "arcadia-roadmap-v1";

export interface RoadmapWarning {
  /** Repository-relative path of the source that could not be used. */
  source: string;
  message: string;
}

export interface RoadmapCounts {
  done: number;
  open: number;
  inProgress: number;
  blocked: number;
  deferred: number;
  total: number;
}

export interface RoadmapNorthStar {
  target: string;
  why: string;
  looksLike: string;
  updated: string | null;
  gates: Array<{ id: string; title: string; status: string; basis: string }>;
}

export interface RoadmapPlanStop {
  kind: "plan";
  order: number;
  /** The roadmap's own letter for the Plan (F, G, H). */
  letter: string;
  slug: string;
  /** Roadmap.md's one-line description, text only. */
  description: string;
  status: string;
  /** The Plan's `milestone:` string, shown as a Checkpoint. */
  checkpoint: string | null;
  counts: RoadmapCounts;
  /** Open Actions whose size is unknown. Every open Action counts, because the size flag does not exist yet. */
  notSmall: number;
  /** The Plan record's own `updated:` date: the date its counts were last written. */
  countsAsOf: string;
  isActive: boolean;
}

export interface RoadmapGapStop {
  kind: "unreadable";
  order: number;
  letter: string;
  slug: string;
  description: string;
  reason: string;
}

export type RoadmapStop = RoadmapPlanStop | RoadmapGapStop;

export interface RoadmapView {
  schema: typeof ROADMAP_SCHEMA;
  /** When this derivation ran. */
  generatedAt: string;
  /** Newest modification time among the sources read, so a reader can tell how old the record is. */
  sourcesNewestAt: string | null;
  project: { slug: string; name: string; activePlan: string | null; currentAction: string | null } | null;
  northStar: RoadmapNorthStar | null;
  milestones: { recorded: false; note: string };
  /** Plans in the order `docs/roadmap.md` lists them, earliest first. */
  sequence: RoadmapStop[];
  /** Roadmap.md's "Later" items: named work with no Plan, drawn as fog. */
  later: Array<{ text: string }>;
  /** True when the active Plan is not named by the roadmap's order, so the route cannot place the rover. */
  activePlanOffRoute: boolean;
  warnings: RoadmapWarning[];
}

const PROJECT_FILE = "PROJECT.md";
const NORTH_STAR_FILE = "NORTH_STAR.md";
const ROADMAP_FILE = "docs/roadmap.md";
const PLANS_DIR = "docs/plans";

const MILESTONES_NOTE = "No Milestones are recorded yet. The operator's list is not a checked-in record, so the route beyond the Plans is fog.";

/**
 * A cheap fingerprint of exactly what `deriveRoadmap` reads: equal strings mean an equal answer. One stat per
 * source and per Plan file, no parsing.
 */
export function roadmapFingerprint(repoRoot: string): string {
  const parts: string[] = [];
  const stamp = (relative: string): void => {
    try {
      const stats = statSync(path.join(repoRoot, relative));
      parts.push(`${relative}:${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}`);
    } catch {
      parts.push(`${relative}:!`);
    }
  };
  [PROJECT_FILE, NORTH_STAR_FILE, ROADMAP_FILE].forEach(stamp);
  let plans: string[] = [];
  try {
    plans = readdirSync(path.join(repoRoot, PLANS_DIR)).filter((name) => name.endsWith(".md")).sort();
  } catch {
    parts.push(`${PLANS_DIR}:!`);
  }
  plans.forEach((name) => stamp(`${PLANS_DIR}/${name}`));
  return parts.join("|");
}

interface RoadmapOrder {
  order: Array<{ order: number; letter: string; slug: string; description: string }>;
  later: string[];
}

/** Parse `docs/roadmap.md`'s "Plan order" list. Exported for tests. */
export function parseRoadmapOrder(markdown: string): RoadmapOrder {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+Plan order\b/i.test(line));
  const result: RoadmapOrder = { order: [], later: [] };
  if (start < 0) return result;
  let inLater = false;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^##\s/.test(line)) break;
    const planned = /^(\d+)\.\s+\*\*([^*]+)\*\*,\s*`([^`]+)`\s*:?\s*(.*)$/.exec(line);
    if (planned) {
      inLater = false;
      result.order.push({ order: Number(planned[1]), letter: planned[2].trim(), slug: planned[3].trim(), description: planned[4].trim() });
      continue;
    }
    if (/^\d+\.\s+\*\*Later\.?\*\*/.test(line)) {
      inLater = true;
      continue;
    }
    if (/^\d+\.\s/.test(line)) inLater = false;
    const bullet = /^\s+[-*]\s+(.*\S)\s*$/.exec(line);
    if (inLater && bullet) result.later.push(bullet[1]);
  }
  return result;
}

function newest(times: number[]): string | null {
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

function readText(repoRoot: string, relative: string, warnings: RoadmapWarning[], times: number[]): string | null {
  try {
    const absolute = path.join(repoRoot, relative);
    const text = readFileSync(absolute, "utf8");
    times.push(statSync(absolute).mtimeMs);
    return text;
  } catch (error) {
    warnings.push({ source: relative, message: `Could not be read: ${error instanceof Error ? error.message : String(error)}` });
    return null;
  }
}

function countActions(plan: PlanDoc): RoadmapCounts {
  const counts: RoadmapCounts = { done: 0, open: 0, inProgress: 0, blocked: 0, deferred: 0, total: plan.actions.length };
  for (const action of plan.actions) {
    if (action.status === "done") counts.done += 1;
    else if (action.status === "deferred") counts.deferred += 1;
    else if (action.status === "in_progress") counts.inProgress += 1;
    else if (action.status === "blocked") counts.blocked += 1;
    else counts.open += 1;
  }
  return counts;
}

interface LoadedPlan {
  plan: PlanDoc | null;
  reason: string | null;
  mtime: number | null;
}

/** A Plan slug is lowercase words joined by hyphens, as every file in docs/plans is named. Anything else is never a path. */
const PLAN_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isPlanSlug(slug: string): boolean {
  return PLAN_SLUG.test(slug);
}

function loadPlan(repoRoot: string, slug: string): LoadedPlan {
  // Slugs come from checked-in prose (docs/roadmap.md, NORTH_STAR.md), so they are data: never join one into a path
  // unless it is a plain slug that resolves inside docs/plans.
  const plansRoot = path.resolve(repoRoot, PLANS_DIR);
  const relative = `${PLANS_DIR}/${slug}.md`;
  const absolute = path.resolve(plansRoot, `${slug}.md`);
  if (!isPlanSlug(slug) || path.dirname(absolute) !== plansRoot) {
    return { plan: null, reason: "Its Plan name is not a plain slug, so no file was opened. Its counts are unknown.", mtime: null };
  }
  let content: string;
  let mtime: number;
  try {
    content = readFileSync(absolute, "utf8");
    mtime = statSync(absolute).mtimeMs;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { plan: null, reason: code === "ENOENT" ? `${relative} does not exist.` : `${relative} could not be read: ${error instanceof Error ? error.message : String(error)}`, mtime: null };
  }
  const parsed = parseDoc(relative, absolute, content);
  if (!parsed.doc || parsed.doc.type !== "plan") {
    const first = parsed.errors[0];
    return { plan: null, reason: `${relative} is not a readable Plan${first ? `: ${first.field}: ${first.message}` : "."}`, mtime };
  }
  return { plan: parsed.doc, reason: null, mtime };
}

/** `plan/<slug>#<action-id>` references, the spelling NORTH_STAR.md gates use. */
const GATE_ACTION_REF = /^plan\/([^#]+)#(.+)$/;

function deriveGates(
  repoRoot: string,
  gates: Array<{ id: string; title: string; actionRef: string | null; declaredStatus: string | null }>,
  cache: Map<string, LoadedPlan>
): RoadmapNorthStar["gates"] {
  return gates.map((gate) => {
    const ref = gate.actionRef ? GATE_ACTION_REF.exec(gate.actionRef) : null;
    if (!ref) {
      return gate.declaredStatus
        ? { id: gate.id, title: gate.title, status: gate.declaredStatus, basis: "declared in NORTH_STAR.md" }
        : { id: gate.id, title: gate.title, status: "unknown", basis: "names no Action" };
    }
    let loaded = cache.get(ref[1]);
    if (!loaded) {
      loaded = loadPlan(repoRoot, ref[1]);
      cache.set(ref[1], loaded);
    }
    const action = loaded.plan?.actions.find((candidate) => candidate.id === ref[2]);
    if (!action) return { id: gate.id, title: gate.title, status: "unknown", basis: loaded.plan ? `${ref[2]} is not in its Plan` : "its Plan could not be read" };
    return { id: gate.id, title: gate.title, status: action.status, basis: `Action ${ref[2]} in its Plan record` };
  });
}

/** Derive the Roadmap for the Project whose repository is `repoRoot`. Never throws for a missing or malformed source. */
export function deriveRoadmap(repoRoot: string, options: { now?: () => Date } = {}): RoadmapView {
  const now = (options.now ?? (() => new Date()))();
  const warnings: RoadmapWarning[] = [];
  const times: number[] = [];
  const planCache = new Map<string, LoadedPlan>();

  // Project pointer.
  let project: RoadmapView["project"] = null;
  const projectText = readText(repoRoot, PROJECT_FILE, warnings, times);
  if (projectText !== null) {
    const parsed = parseDoc(PROJECT_FILE, path.join(repoRoot, PROJECT_FILE), projectText);
    if (parsed.doc && parsed.doc.type === "project") {
      const doc: ProjectDoc = parsed.doc;
      project = { slug: doc.slug, name: doc.name, activePlan: doc.activePlan, currentAction: doc.currentAction };
    } else {
      const first = parsed.errors[0];
      warnings.push({ source: PROJECT_FILE, message: `Is not a readable Project record${first ? `: ${first.field}: ${first.message}` : "."}` });
    }
  }

  // Plan order.
  let order: RoadmapOrder = { order: [], later: [] };
  const roadmapText = readText(repoRoot, ROADMAP_FILE, warnings, times);
  if (roadmapText !== null) {
    order = parseRoadmapOrder(roadmapText);
    if (!order.order.length) warnings.push({ source: ROADMAP_FILE, message: 'Has no readable "Plan order" list, so the Plans cannot be sequenced.' });
  }

  const sequence: RoadmapStop[] = order.order.map((entry) => {
    const loaded = loadPlan(repoRoot, entry.slug);
    planCache.set(entry.slug, loaded);
    if (loaded.mtime !== null) times.push(loaded.mtime);
    if (!loaded.plan) {
      warnings.push({ source: isPlanSlug(entry.slug) ? `${PLANS_DIR}/${entry.slug}.md` : ROADMAP_FILE, message: loaded.reason ?? "Could not be read." });
      return { kind: "unreadable", order: entry.order, letter: entry.letter, slug: entry.slug, description: entry.description, reason: loaded.reason ?? "Could not be read. Its counts are unknown." };
    }
    const counts = countActions(loaded.plan);
    return {
      kind: "plan",
      order: entry.order,
      letter: entry.letter,
      slug: entry.slug,
      description: entry.description,
      status: loaded.plan.status,
      checkpoint: loaded.plan.milestone,
      counts,
      notSmall: counts.open + counts.inProgress + counts.blocked,
      countsAsOf: loaded.plan.updated,
      isActive: project?.activePlan === entry.slug
    };
  });

  const activePlanOffRoute = Boolean(project?.activePlan) && !sequence.some((stop) => stop.slug === project?.activePlan);
  if (activePlanOffRoute) {
    warnings.push({ source: ROADMAP_FILE, message: `The active Plan (${project?.activePlan}) is not in the Plan order, so the route cannot show where the rover is.` });
  }

  // North Star, read from the file as written.
  let northStar: RoadmapNorthStar | null = null;
  try {
    const star = loadNorthStar(repoRoot);
    if (star) {
      try {
        times.push(statSync(star.path).mtimeMs);
      } catch {
        // The stat is only for the age line.
      }
      northStar = { target: star.target, why: star.why, looksLike: star.looksLike, updated: star.updated, gates: deriveGates(repoRoot, star.gates, planCache) };
    } else {
      warnings.push({ source: NORTH_STAR_FILE, message: "Does not exist, so the route has no target." });
    }
  } catch (error) {
    warnings.push({ source: NORTH_STAR_FILE, message: error instanceof NorthStarParseError || error instanceof Error ? error.message : String(error) });
  }

  return {
    schema: ROADMAP_SCHEMA,
    generatedAt: now.toISOString(),
    sourcesNewestAt: newest(times),
    project,
    northStar,
    milestones: { recorded: false, note: MILESTONES_NOTE },
    sequence,
    later: order.later.map((text) => ({ text })),
    activePlanOffRoute,
    warnings
  };
}
