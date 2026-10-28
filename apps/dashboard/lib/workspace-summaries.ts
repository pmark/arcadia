import type { PlanSummariesResponse } from "./plans-types";

/**
 * What the workspace shows from a Plan summary. Summaries are reading aids written by Clara or a lightweight model;
 * the Plan record governs, so a missing or invalid summary yields null and the view falls back to the record.
 */
export interface PlanSummaryView { title: string; purpose: string; serves: string | null; doneWhen: string; readingNote: string | null; stale: boolean }
export interface ActionSummaryView { title: string; why: string; doneWhen: string; note: string | null; stale: boolean }

export function planSummaryView(summaries: PlanSummariesResponse | null, plan: string | undefined): PlanSummaryView | null {
  const entry = plan ? summaries?.plans[plan] : undefined;
  const s = entry?.summary;
  if (!entry || !s) return null;
  return { title: s.title, purpose: s.purpose, serves: s.serves || null, doneWhen: s.done_when, readingNote: s.reading_note ?? null, stale: !entry.planFresh };
}

export function actionSummaryView(summaries: PlanSummariesResponse | null, plan: string | undefined, action: string | undefined): ActionSummaryView | null {
  const entry = plan ? summaries?.plans[plan] : undefined;
  const a = action ? entry?.summary?.actions.find(x => x.id === action) : undefined;
  if (!entry || !a || !action) return null;
  return { title: a.title, why: a.why, doneWhen: a.done_when, note: a.note ?? null, stale: entry.actions[action] !== "fresh" };
}
