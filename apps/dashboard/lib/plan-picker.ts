import type { AllPlansResponse, PlanRow } from "./plans-types";

/**
 * Read-only view logic for the Workspace Plan picker. Everything here is computed from the one
 * `/api/plans` answer: no model, no CLI call per Plan, nothing written.
 */

export const PLAN_STATUSES = ["draft", "proposed", "active", "complete", "superseded"] as const;
export type PlanStatusFilter = (typeof PLAN_STATUSES)[number];
export type PlanSort = "updated" | "progress" | "queue";
export type PlanGroup = "none" | "status" | "project" | "stale";
export type ProgressFilter = "any" | "none" | "partial" | "done";

export interface PickerPlan {
  project: { id: string; slug: string; name: string };
  row: PlanRow;
  /** Plain-language title: the Plan's milestone, else its humanized slug. */
  title: string;
  /** Fraction of Actions done or deferred; null when the document is not governed or states no Actions. */
  progress: number | null;
  doneButNotClosed: boolean;
  /** Whole days since the Plan's own `updated:` date; null when it states none. */
  ageDays: number | null;
}

export interface PickerFilters { status: PlanStatusFilter | "all"; project: string; progress: ProgressFilter }

export const DEFAULT_FILTERS: PickerFilters = { status: "all", project: "all", progress: "any" };

/** A Plan untouched for this many days is "stale" in the picker's grouping. */
export const STALE_AFTER_DAYS = 14;

export function planTitle(row: Pick<PlanRow, "slug" | "milestone">): string {
  const text = (row.milestone ?? "").trim();
  if (text) return text;
  const words = row.slug.replace(/-/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : row.slug;
}

function actionTotal(row: PlanRow): number {
  const c = row.actionCounts;
  return c ? c.open + c.in_progress + c.done + c.blocked + (c.deferred ?? 0) : 0;
}

/** Fraction of Actions finished (done or deferred), or null without a count. */
export function planProgress(row: PlanRow): number | null {
  const total = actionTotal(row);
  if (!row.actionCounts || total === 0) return null;
  return (row.actionCounts.done + (row.actionCounts.deferred ?? 0)) / total;
}

/** Every Action is done or deferred while the Plan's own status is still draft or proposed. */
export function isDoneButNotClosed(row: PlanRow): boolean {
  if (row.status !== "draft" && row.status !== "proposed") return false;
  const total = actionTotal(row);
  return total > 0 && planProgress(row) === 1;
}

export function ageInDays(updated: string | null | undefined, now: Date): number | null {
  if (!updated) return null;
  const time = Date.parse(updated);
  return Number.isNaN(time) ? null : Math.max(0, Math.floor((now.getTime() - time) / 86_400_000));
}

export function toPickerPlans(response: AllPlansResponse, now: Date = new Date()): PickerPlan[] {
  const out: PickerPlan[] = [];
  for (const project of response.projects) {
    for (const row of project.plans ?? []) {
      out.push({
        project: { id: project.id, slug: project.slug, name: project.name },
        row,
        title: planTitle(row),
        progress: planProgress(row),
        doneButNotClosed: isDoneButNotClosed(row),
        ageDays: ageInDays(row.updated, now)
      });
    }
  }
  return out;
}

// ---- Likely duplicates ------------------------------------------------------------------------

/** A pair is flagged when this share of the smaller word set is common to both... */
export const DUPLICATE_OVERLAP_THRESHOLD = 0.4;
/** ...or, for longer milestones, when at least this many words are shared at this lower share. */
export const DUPLICATE_SHARED_WORDS_MIN = 3;
export const DUPLICATE_LOOSE_OVERLAP_THRESHOLD = 0.15;

const STOP_WORDS = new Set("the and for with from that this are its into than then not can will every each one only per who what which when while their there see add missing draft inactive plan three batch".split(" "));

/** Lower-cased, singularized words of at least three letters, without stop words or bare numbers. */
export function duplicateWords(text: string): Set<string> {
  const words = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || /^\d+$/.test(raw) || STOP_WORDS.has(raw)) continue;
    words.add(raw.replace(/(es|s)$/, ""));
  }
  return words;
}

/** The deterministic text-similarity score of two Plans' title and milestone: shared words over the smaller set. */
export function planSimilarity(a: Pick<PlanRow, "slug" | "milestone">, b: Pick<PlanRow, "slug" | "milestone">): { score: number; shared: number } {
  const left = duplicateWords(planTitle(a));
  const right = duplicateWords(planTitle(b));
  if (left.size === 0 || right.size === 0) return { score: 0, shared: 0 };
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return { score: shared / Math.min(left.size, right.size), shared };
}

/** The one named rule that decides "likely duplicate". It needs no model and its thresholds are the constants above. */
export function isLikelyDuplicate(a: Pick<PlanRow, "slug" | "milestone">, b: Pick<PlanRow, "slug" | "milestone">): { duplicate: boolean; score: number } {
  const { score, shared } = planSimilarity(a, b);
  const duplicate = score >= DUPLICATE_OVERLAP_THRESHOLD || (shared >= DUPLICATE_SHARED_WORDS_MIN && score >= DUPLICATE_LOOSE_OVERLAP_THRESHOLD);
  return { duplicate, score };
}

export interface DuplicatePair { a: string; b: string; score: number }

const FINISHED = new Set(["complete", "superseded"]);

/**
 * Likely duplicate pairs among Plans that are still open to be chosen (a finished Plan duplicating
 * another is history, not clutter). Plans are compared only within the same Project.
 */
export function likelyDuplicatePairs(plans: PickerPlan[]): DuplicatePair[] {
  const live = plans.filter(p => !FINISHED.has(p.row.status));
  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < live.length; i += 1) {
    for (let j = i + 1; j < live.length; j += 1) {
      if (live[i].project.slug !== live[j].project.slug) continue;
      const verdict = isLikelyDuplicate(live[i].row, live[j].row);
      if (verdict.duplicate) pairs.push({ a: live[i].row.slug, b: live[j].row.slug, score: verdict.score });
    }
  }
  return pairs.sort((x, y) => y.score - x.score || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
}

/** Per Plan (project/slug), its best few duplicate matches, so a card can name them. */
export function duplicatesByPlan(plans: PickerPlan[], limit = 2): Map<string, DuplicatePair[]> {
  const byKey = new Map<string, DuplicatePair[]>();
  const project = new Map<string, string>();
  for (const p of plans) project.set(p.row.slug, p.project.slug);
  const add = (slug: string, pair: DuplicatePair) => {
    const key = `${project.get(slug)}/${slug}`;
    const list = byKey.get(key) ?? [];
    list.push(pair);
    byKey.set(key, list);
  };
  for (const pair of likelyDuplicatePairs(plans)) { add(pair.a, pair); add(pair.b, pair); }
  for (const [key, list] of byKey) byKey.set(key, list.slice(0, limit));
  return byKey;
}

// ---- Filter, sort, group ----------------------------------------------------------------------

export function filterPlans(plans: PickerPlan[], filters: PickerFilters): PickerPlan[] {
  return plans.filter(p => {
    if (filters.status !== "all" && p.row.status !== filters.status) return false;
    if (filters.project !== "all" && p.project.slug !== filters.project) return false;
    if (filters.progress === "none" && !(p.progress === 0)) return false;
    if (filters.progress === "partial" && !(p.progress !== null && p.progress > 0 && p.progress < 1)) return false;
    if (filters.progress === "done" && p.progress !== 1) return false;
    return true;
  });
}

const bySlug = (a: PickerPlan, b: PickerPlan) => a.project.slug.localeCompare(b.project.slug) || a.row.slug.localeCompare(b.row.slug);

/**
 * `updated`: newest first, Plans without a date last. `progress`: furthest along first, Plans with no
 * count last. `queue`: the Project's active Plan first, then the rest in Plan-document (slug) order. The
 * dispatch queue orders Actions, not Plans, so this is a reading aid and never the queue itself.
 */
export function sortPlans(plans: PickerPlan[], sort: PlanSort): PickerPlan[] {
  const list = [...plans];
  if (sort === "updated") return list.sort((a, b) => (a.ageDays ?? Infinity) - (b.ageDays ?? Infinity) || bySlug(a, b));
  if (sort === "progress") return list.sort((a, b) => (b.progress ?? -1) - (a.progress ?? -1) || bySlug(a, b));
  return list.sort((a, b) => Number(b.row.isActivePlan) - Number(a.row.isActivePlan) || bySlug(a, b));
}

export interface PlanGroupBlock { key: string; label: string; plans: PickerPlan[] }

export function groupPlans(plans: PickerPlan[], group: PlanGroup): PlanGroupBlock[] {
  if (group === "none") return [{ key: "all", label: "All Plans", plans }];
  const blocks = new Map<string, PlanGroupBlock>();
  for (const p of plans) {
    const [key, label] = group === "status" ? [p.row.status, p.row.status]
      : group === "project" ? [p.project.slug, p.project.name]
      : p.ageDays === null ? ["unknown", "No update date"]
      : p.ageDays > STALE_AFTER_DAYS ? ["stale", `Stale (over ${STALE_AFTER_DAYS} days)`]
      : ["fresh", "Recently updated"];
    const block = blocks.get(key) ?? { key, label, plans: [] };
    block.plans.push(p);
    blocks.set(key, block);
  }
  const order = group === "status" ? [...PLAN_STATUSES] : group === "stale" ? ["fresh", "stale", "unknown"] : null;
  return [...blocks.values()].sort((x, y) => order ? (order.indexOf(x.key) + 1 || 99) - (order.indexOf(y.key) + 1 || 99) : x.label.localeCompare(y.label));
}
