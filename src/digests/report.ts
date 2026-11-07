import type Database from "better-sqlite3";
import type { TodoData, TodoItem } from "../commands/todo.js";
import { gatherOperatorInteractions } from "./operatorInteractions.js";
import { describeWindow } from "./schedule.js";
import type {
  DigestActivityShare,
  DigestFact,
  DigestGoalProgress,
  DigestNeedsYou,
  DigestNeedsYouItem,
  DigestOperatorInteractions,
  DigestReport,
  DigestRisk,
  DigestSubject,
  DigestSummary,
  DigestSummaryFacts,
  DigestWindow
} from "./types.js";

/**
 * The operator digest, computed.
 *
 * The operator's words, 2026-11-07: "show me what matters, not just more
 * data". So the page answers four questions in order — did we get closer to
 * the goals, does anything need me, where did the work happen, and is
 * anything stuck — and every answer is computed here from records. The only
 * model-written text is the headline, and it is built from `summaryFacts` of
 * this report, never from the raw records.
 */

const DAY_MS = 86_400_000;
const PACE_LOOKBACK_DAYS: Record<DigestWindow["period"], number> = { day: 7, week: 28, month: 90 };
/** A pace from a single completion is noise, not a pace. */
const MIN_PACE_COMPLETIONS = 2;

export const GOALS_SHOWN = 4;
export const NEEDS_YOU_SHOWN = 3;
export const ACTIVITY_AREAS_SHOWN = 5;
const STALLS_SHOWN = 2;
const INTERACTIONS_SHOWN = 2;
const MAX_SUMMARY_CHARS = 600;
const BAR_CELLS = 10;

/** Marks where the delivered page ends and the stored detail begins. */
export const DIGEST_DETAIL_MARKER = "<!-- arcadia-digest-detail -->";

export interface DigestProjectRef {
  id: string;
  name: string;
  slug: string;
}

interface MilestoneRow {
  id: string;
  title: string;
  status: "active" | "paused" | "completed";
  doc_ref: string | null;
  updated_at: string;
  project_id: string;
  total: number;
  done: number;
  done_in_lookback: number;
  last_done_at: string | null;
}

export function buildDigestReport(input: {
  db: Database.Database;
  subject: DigestSubject;
  projects: DigestProjectRef[];
  window: DigestWindow;
  facts: DigestFact[];
  needsYou: DigestNeedsYou;
  now: Date;
}): DigestReport {
  const { db, subject, projects, window, facts, needsYou, now } = input;
  const byProjectId = new Map(projects.map((project) => [project.id, project]));
  const lookbackDays = PACE_LOOKBACK_DAYS[window.period];
  const lookbackStart = new Date(Date.parse(window.end) - lookbackDays * DAY_MS).toISOString();

  const milestones = projects.length === 0 ? [] : db.prepare(
    `SELECT m.id, m.title, m.status, m.doc_ref, m.updated_at, m.project_id,
       COUNT(w.id) AS total,
       COALESCE(SUM(w.status = 'done'), 0) AS done,
       COALESCE(SUM(w.status = 'done' AND w.updated_at >= @lookbackStart AND w.updated_at < @end), 0) AS done_in_lookback,
       MAX(CASE WHEN w.status = 'done' AND w.updated_at < @end THEN w.updated_at END) AS last_done_at
     FROM milestones m
     LEFT JOIN work_items w ON w.milestone_id = m.id AND w.archived_at IS NULL
     WHERE m.project_id IN (SELECT value FROM json_each(@projectIds))
     GROUP BY m.id`
  ).all({
    projectIds: JSON.stringify(projects.map((project) => project.id)),
    lookbackStart,
    end: window.end
  }) as MilestoneRow[];

  const completedBy = countBy(facts.filter((fact) => fact.kind === "completed_action"), (fact) => stringDetail(fact, "milestoneId"));
  const mergedBy = countBy(facts.filter((fact) => fact.kind === "merged"), (fact) => stringDetail(fact, "milestoneId"));

  const allGoals: DigestGoalProgress[] = milestones.map((row) => {
    const project = byProjectId.get(row.project_id)!;
    const remaining = Math.max(0, row.total - row.done);
    const pacePerDay = row.status === "active" && row.done_in_lookback >= MIN_PACE_COMPLETIONS
      ? row.done_in_lookback / lookbackDays
      : null;
    return {
      milestoneId: row.id,
      title: row.title,
      project: project.name,
      projectSlug: project.slug,
      plan: row.doc_ref?.startsWith("plan/") ? row.doc_ref : null,
      status: row.status,
      done: row.done,
      total: row.total,
      completedInWindow: completedBy.get(row.id) ?? 0,
      mergedInWindow: mergedBy.get(row.id) ?? 0,
      reachedInWindow: row.status === "completed" && row.updated_at >= window.start && row.updated_at < window.end,
      pacePerDay,
      paceLookbackDays: lookbackDays,
      daysLeftAtPace: pacePerDay && remaining > 0 ? Math.ceil(remaining / pacePerDay) : null,
      lastCompletedAt: row.last_done_at
    };
  });

  const moved = allGoals
    .filter((goal) => goal.completedInWindow > 0 || goal.mergedInWindow > 0 || goal.reachedInWindow)
    .sort((a, b) =>
      (b.completedInWindow + b.mergedInWindow) - (a.completedInWindow + a.mergedInWindow)
      || Number(b.reachedInWindow) - Number(a.reachedInWindow)
      || a.title.localeCompare(b.title));
  const quiet = allGoals.filter((goal) => goal.status === "active" && goal.done < goal.total && !moved.includes(goal));

  const risks: DigestRisk[] = [
    ...redAlertRisks(db, projects, now),
    ...stoppedOnOperatorRisks(needsYou, now),
    ...stalledGoalRisks(quiet, window),
    ...refusedDispatchRisks(facts)
  ];

  const merged = facts.filter((fact) => fact.kind === "merged").length;
  return {
    subject,
    window,
    totals: {
      events: facts.length,
      completed: facts.filter((fact) => fact.kind === "completed_action").length,
      merged,
      decisions: facts.filter((fact) => fact.kind === "decision").length,
      goalsReached: moved.filter((goal) => goal.reachedInWindow).length
    },
    goals: moved,
    quietActiveGoals: quiet.length,
    needsYou,
    operatorInteractions: gatherOperatorInteractions({ db, scope: subject.scope, projects, window, now, merged }),
    activity: activityShares(subject, facts, allGoals),
    risks
  };
}

/** Relative activity: by Project for the portfolio, by goal inside one Project. */
function activityShares(subject: DigestSubject, facts: DigestFact[], goals: DigestGoalProgress[]): DigestActivityShare[] {
  if (facts.length === 0) return [];
  const goalByPlan = new Map(goals.filter((goal) => goal.plan).map((goal) => [goal.plan!.slice("plan/".length), goal.title]));
  const goalById = new Map(goals.map((goal) => [goal.milestoneId, goal.title]));
  const areaOf = (fact: DigestFact): string => {
    if (subject.scope === "portfolio") return stringDetail(fact, "projectSlug") ?? "unattributed";
    const milestoneId = stringDetail(fact, "milestoneId");
    if (milestoneId && goalById.has(milestoneId)) return goalById.get(milestoneId)!;
    const plan = stringDetail(fact, "plan");
    if (plan && goalByPlan.has(plan)) return goalByPlan.get(plan)!;
    return "Other";
  };
  const areas = new Map<string, DigestActivityShare>();
  for (const fact of facts) {
    const area = areaOf(fact);
    const share = areas.get(area) ?? { area, events: 0, percent: 0, completed: 0, merged: 0 };
    share.events += 1;
    if (fact.kind === "completed_action") share.completed += 1;
    if (fact.kind === "merged") share.merged += 1;
    areas.set(area, share);
  }
  return [...areas.values()]
    .map((share) => ({ ...share, percent: Math.round((share.events / facts.length) * 100) }))
    .sort((a, b) => b.events - a.events || a.area.localeCompare(b.area));
}

function redAlertRisks(db: Database.Database, projects: DigestProjectRef[], now: Date): DigestRisk[] {
  if (projects.length === 0 || !hasTable(db, "production_red_alerts")) return [];
  const open = db.prepare(
    `SELECT trigger, action_key, first_seen_at FROM production_red_alerts
     WHERE status = 'open' AND project_slug IN (SELECT value FROM json_each(?))
     ORDER BY first_seen_at`
  ).all(JSON.stringify(projects.map((project) => project.slug))) as Array<{ trigger: string; action_key: string | null; first_seen_at: string }>;
  if (open.length === 0) return [];
  const oldest = open[0];
  return [{
    kind: "red_alert",
    text: `${plural(open.length, "red alert")} open. Oldest: ${oldest.trigger}${oldest.action_key ? ` on ${oldest.action_key}` : ""}, ${age(oldest.first_seen_at, now)} old.`
  }];
}

function stoppedOnOperatorRisks(needsYou: DigestNeedsYou, now: Date): DigestRisk[] {
  const stopped = needsYou.items.filter((item) => item.stopped);
  if (stopped.length === 0) return [];
  const oldest = [...stopped].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  const waited = Number.isFinite(Date.parse(oldest.createdAt)) ? ` The oldest has waited ${age(oldest.createdAt, now)}.` : "";
  return [{
    kind: "stopped_on_operator",
    text: `Production is stopped on ${plural(stopped.length, "item")} until you act.${waited}`
  }];
}

/** A goal that was moving before the window and did not move in it. */
function stalledGoalRisks(quiet: DigestGoalProgress[], window: DigestWindow): DigestRisk[] {
  const recentStart = new Date(Date.parse(window.start) - PACE_LOOKBACK_DAYS[window.period] * DAY_MS).toISOString();
  const stalled = quiet
    .filter((goal) => goal.lastCompletedAt && goal.lastCompletedAt >= recentStart && goal.lastCompletedAt < window.start)
    .sort((a, b) => b.lastCompletedAt!.localeCompare(a.lastCompletedAt!));
  const shown: DigestRisk[] = stalled.slice(0, STALLS_SHOWN).map((goal) => ({
    kind: "stalled_goal",
    text: `Stalled: ${clip(goal.title, 60)}. ${goal.total - goal.done} left; the last Action finished ${goal.lastCompletedAt!.slice(0, 10)}.`
  }));
  if (stalled.length > STALLS_SHOWN) {
    shown.push({ kind: "stalled_goal", text: `${plural(stalled.length - STALLS_SHOWN, "more goal")} stopped moving.` });
  }
  return shown;
}

function refusedDispatchRisks(facts: DigestFact[]): DigestRisk[] {
  const refused = facts.filter((fact) => fact.kind === "dispatch" && fact.detail.dispatchable === false);
  if (refused.length === 0) return [];
  const fields = countBy(refused.flatMap((fact) =>
    String(fact.detail.blockerFields ?? "").split(",").map((field) => field.trim()).filter(Boolean)
  ).map((field) => ({ field })), (entry) => entry.field);
  const top = [...fields.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return [{
    kind: "refused_dispatch",
    text: `${plural(refused.length, "dispatch attempt")} refused${top ? `; most often on ${top[0]}` : ""}.`
  }];
}

// ---------------------------------------------------------------------------
// Operator items
// ---------------------------------------------------------------------------

/**
 * Ranked operator items from the same read-only to-do builder `arcadia todo`
 * uses: stopped production first, then every other blocking item oldest
 * first. Non-blocking and stale items are left to `arcadia todo`, so this
 * section lists only what holds work up.
 */
export function needsYouFromTodo(
  todo: TodoData,
  options: { dashboardUrl?: string | null; projectSlug?: string } = {}
): DigestNeedsYou {
  const base = dashboardBase(options.dashboardUrl);
  const blocking = todo.items.filter((item) =>
    item.blocking && !item.staleReason
    && (!options.projectSlug || item.project.toLowerCase() === options.projectSlug.toLowerCase()));
  const ranked = [...blocking.filter(isEscalation), ...blocking.filter((item) => !isEscalation(item))];
  const unreadable = todo.unavailable.length > 0 && todo.items.length === 0 && todo.counts.blocking === 0;
  return {
    items: ranked.map((item) => toNeedsYouItem(item, base)),
    unavailable: unreadable ? todo.unavailable[0] ?? "no source could be read" : null,
    listLink: base ? `${base}/todo` : null
  };
}

export function needsYouUnavailable(reason: string): DigestNeedsYou {
  return { items: [], unavailable: reason.replace(/\s+/g, " ").trim() || "unknown error", listLink: null };
}

function toNeedsYouItem(item: TodoItem, base: string | null): DigestNeedsYouItem {
  const stopped = isEscalation(item);
  // An escalation's own message is generic ("The previewed Action is not
  // ready to launch."); the Action it stopped is in its key, so name it.
  const action = stopped && item.key.includes("/") ? item.key.slice(item.key.indexOf("/") + 1) : null;
  return {
    key: item.key,
    kind: String(item.kind),
    project: item.project,
    title: action ? `${action}: ${item.title}` : item.title,
    action: item.answer,
    link: base ? todoItemLink(base, item.key) : null,
    consequence: consequenceOf(item),
    stopped,
    createdAt: item.createdAt
  };
}

/** What waiting costs, from what each kind of item is known to hold. Never a guess about one item. */
function consequenceOf(item: TodoItem): string {
  const kind = String(item.kind);
  if (kind === "escalation:build_packet_approval_pending") return "the Action cannot launch until you approve.";
  if (kind.startsWith("escalation:")) return "production on this Action stays stopped.";
  switch (item.kind) {
    case "decision": return "the work this Decision gates stays held.";
    case "agent_ask": return "the proposed change stays unsettled.";
    case "review_item": return "the item it gates stays held.";
    case "operator_task": return "the step it names stays undone.";
    case "clarify": return "the captured request stays out of the queue.";
    case "plan_action": return "the Action stays waiting.";
    default: return "the work it gates stays held.";
  }
}

function isEscalation(item: TodoItem): boolean {
  return String(item.kind).startsWith("escalation:");
}

/** `${base}/todo/<kind>/<project>/<id>`, the same deep link the Discord bot builds from a to-do key. */
function todoItemLink(base: string, key: string): string | null {
  const slash = key.indexOf("/");
  if (slash < 0) return null;
  const head = key.slice(0, slash);
  const colon = head.lastIndexOf(":");
  if (colon <= 0) return null;
  const parts = [head.slice(0, colon), head.slice(colon + 1), key.slice(slash + 1)];
  if (parts.some((part) => !part)) return null;
  return `${base}/todo/${parts.map(encodeURIComponent).join("/")}`;
}

export function dashboardBase(value: string | null | undefined): string | null {
  const trimmed = value?.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  try {
    const { protocol } = new URL(trimmed);
    return protocol === "http:" || protocol === "https:" ? trimmed : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Summary: the AI input, the deterministic fallback, and the output guard
// ---------------------------------------------------------------------------

/** The only thing the AI summary sees. Every value is also rendered on the page. */
export function summaryFacts(report: DigestReport): DigestSummaryFacts {
  return {
    subject: report.subject.name,
    scope: report.subject.scope,
    period: report.window.period,
    windowLabel: describeWindow(report.window),
    totals: { ...report.totals },
    goals: report.goals.slice(0, GOALS_SHOWN).map((goal) => ({
      goal: goal.title,
      project: goal.project,
      done: goal.done,
      total: goal.total,
      completedInWindow: goal.completedInWindow,
      mergedInWindow: goal.mergedInWindow,
      reached: goal.reachedInWindow,
      daysLeftAtPace: goal.daysLeftAtPace
    })),
    quietActiveGoals: report.quietActiveGoals,
    needsYou: {
      count: report.needsYou.items.length,
      stopped: report.needsYou.items.filter((item) => item.stopped).length,
      top: report.needsYou.items.slice(0, NEEDS_YOU_SHOWN).map((item) => item.title),
      unavailable: report.needsYou.unavailable !== null
    },
    operatorInteractions: {
      count: report.operatorInteractions.count,
      required: report.operatorInteractions.required,
      avoidable: report.operatorInteractions.avoidable,
      perMergedAction: report.operatorInteractions.perMerged,
      waitedMinutes: report.operatorInteractions.waitedMinutes
    },
    activity: report.activity.slice(0, ACTIVITY_AREAS_SHOWN).map((share) => ({ area: share.area, percent: share.percent })),
    risks: report.risks.map((risk) => risk.text)
  };
}

/** True when there is nothing for a model to say beyond "nothing happened". */
export function reportIsEmpty(report: DigestReport): boolean {
  return report.totals.events === 0 && report.needsYou.items.length === 0 && report.risks.length === 0;
}

export function deterministicSummary(report: DigestReport): string {
  const { totals, goals, needsYou } = report;
  const sentences: string[] = [];
  if (totals.completed === 0 && totals.merged === 0 && totals.goalsReached === 0) {
    sentences.push(totals.events === 0 ? "Nothing was recorded in this window." : "No goal moved in this window.");
  } else {
    const parts = [
      totals.completed > 0 ? `${plural(totals.completed, "Action")} finished` : null,
      totals.merged > 0 ? `${totals.merged} merged` : null
    ].filter(Boolean).join(" and ");
    sentences.push(`${parts || "Progress was recorded"} across ${plural(goals.length, "goal")}.`);
    const top = goals[0];
    if (top) sentences.push(`Most progress: ${clip(top.title, 70)}, now ${top.done} of ${top.total} done.`);
    if (totals.goalsReached > 0) sentences.push(`${plural(totals.goalsReached, "goal")} reached.`);
  }
  if (needsYou.items.length > 0) {
    const stopped = needsYou.items.filter((item) => item.stopped).length;
    sentences.push(`${plural(needsYou.items.length, "item")} ${needsYou.items.length === 1 ? "waits" : "wait"} on you${stopped > 0 ? `, ${stopped} stopping production` : ""}.`);
  }
  return sentences.slice(0, 3).join(" ");
}

/**
 * Refuse a model headline that states a number the facts do not contain. Not a
 * proof of faithfulness, but it catches the commonest invention cheaply and
 * deterministically; anything it rejects falls back to the computed summary.
 */
export function checkAiSummary(raw: string, facts: DigestSummaryFacts): { ok: true; text: string } | { ok: false; reason: string } {
  // One to three sentences, as asked; dropping extra sentences adds nothing the model did not say.
  const text = (raw.replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) ?? [])
    .slice(0, 3).map((sentence) => sentence.trim()).join(" ");
  if (!text) return { ok: false, reason: "the AI summary was empty" };
  if (text.length > MAX_SUMMARY_CHARS) return { ok: false, reason: `the AI summary was longer than ${MAX_SUMMARY_CHARS} characters` };
  const allowed = new Set(JSON.stringify(facts).match(/\d+(?:\.\d+)?/g) ?? []);
  const unsupported = (text.match(/\d+(?:\.\d+)?/g) ?? []).find((number) => !allowed.has(number));
  if (unsupported !== undefined) return { ok: false, reason: `the AI summary stated ${unsupported}, which is not in the computed facts` };
  return { ok: true, text };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** The delivered page, without its header or footer. Short lines and air between sections. */
export function renderDigestSections(report: DigestReport, summary: DigestSummary): string {
  const sections = [
    renderSummary(summary),
    renderGoals(report),
    renderNeedsYou(report.needsYou),
    renderOperatorInteractions(report.operatorInteractions),
    renderActivity(report),
    ...(report.risks.length > 0 ? [renderRisks(report.risks)] : [])
  ];
  return sections.join("\n\n");
}

function renderSummary(summary: DigestSummary): string {
  const label = summary.source === "ai"
    ? "_AI-written from the computed facts below_"
    : summary.fallbackReason
      ? "_Computed; AI summary unavailable_"
      : "_Computed_";
  return [`**Summary** · ${label}`, summary.text].join("\n");
}

function renderGoals(report: DigestReport): string {
  const lines = ["**Progress by goal**"];
  if (report.goals.length === 0) {
    lines.push("", "No goal moved in this window.");
  }
  for (const goal of report.goals.slice(0, GOALS_SHOWN)) {
    const change = [
      goal.completedInWindow > 0 ? `+${goal.completedInWindow} done` : null,
      goal.mergedInWindow > 0 ? `${goal.mergedInWindow} merged` : null
    ].filter(Boolean).join(", ");
    const where = report.subject.scope === "portfolio" ? `${goal.project} · ` : "";
    lines.push(
      "",
      `**${clip(goal.title, 70)}**${goal.reachedInWindow ? " · reached" : ""}`,
      `${where}${bar(goal.total === 0 ? 0 : (goal.done / goal.total) * 100)} ${goal.done}/${goal.total} done${change ? ` · ${change}` : ""}`
    );
    const left = goal.total - goal.done;
    if (goal.daysLeftAtPace !== null && goal.pacePerDay !== null) {
      lines.push(`${left} left · about ${plural(goal.daysLeftAtPace, "day")} at the ${goal.paceLookbackDays}-day pace`);
    } else if (left > 0 && goal.status === "active") {
      lines.push(`${left} left · too few recent completions for a pace`);
    }
  }
  const unshown = report.goals.length - GOALS_SHOWN;
  if (unshown > 0) lines.push("", `_${plural(unshown, "more goal")} moved; see detail._`);
  if (report.quietActiveGoals > 0) {
    lines.push("", `_${plural(report.quietActiveGoals, "other active goal")} did not move._`);
  }
  return lines.join("\n");
}

function renderNeedsYou(needsYou: DigestNeedsYou): string {
  if (needsYou.unavailable) return ["**Needs you**", `Could not read the to-do list: ${clip(needsYou.unavailable, 120)}`].join("\n");
  if (needsYou.items.length === 0) return ["**Needs you**", "Nothing."].join("\n");
  const lines = [`**Needs you** · ${needsYou.items.length}`];
  needsYou.items.slice(0, NEEDS_YOU_SHOWN).forEach((item, index) => {
    lines.push(
      "",
      `${index + 1}. ${item.stopped ? "STOPPED: " : ""}${clip(item.title, 70)}`,
      `   → ${item.link ?? `\`${clip(item.action, 110)}\``}`,
      `   If it waits, ${item.consequence}`
    );
  });
  const unshown = needsYou.items.length - NEEDS_YOU_SHOWN;
  if (unshown > 0) lines.push("", `${plural(unshown, "more item")}: ${needsYou.listLink ?? "`arcadia todo`"}`);
  return lines.join("\n");
}

/** The goal is a low number: each line says what the touch bought and whether it was needed. */
function renderOperatorInteractions(interactions: DigestOperatorInteractions): string {
  if (interactions.count === 0) {
    return ["**Operator interactions** · 0", "None were needed in this window."].join("\n");
  }
  const ratio = interactions.perMerged !== null ? `${interactions.perMerged} per merged Action` : "nothing merged";
  const lines = [
    `**Operator interactions** · ${interactions.count} (${interactions.required} required, ${interactions.avoidable} avoidable)`,
    `${ratio} · work waited on you ${minutes(interactions.waitedMinutes)} in total`
  ];
  for (const item of interactions.items.slice(0, INTERACTIONS_SHOWN)) {
    lines.push(`• ${item.at.slice(5, 16).replace("T", " ")}Z ${clip(item.what, 40)} → ${clip(item.unlocked, 60)}${item.necessity === "avoidable" ? " (avoidable)" : ""}`);
  }
  const unshown = interactions.items.length - INTERACTIONS_SHOWN;
  if (unshown > 0) lines.push(`• ${unshown} more; see detail.`);
  return lines.join("\n");
}

function minutes(total: number): string {
  if (total < 60) return `${total}m`;
  const hours = total / 60;
  return hours < 48 ? `${Math.round(hours * 10) / 10}h` : `${Math.round(hours / 24)}d`;
}

function renderActivity(report: DigestReport): string {
  const heading = `**Where activity happened** · ${plural(report.totals.events, "recorded event")}`;
  if (report.activity.length === 0) return [heading, "No recorded activity."].join("\n");
  const shown = report.activity.slice(0, ACTIVITY_AREAS_SHOWN);
  const rest = report.activity.slice(ACTIVITY_AREAS_SHOWN);
  const rows = rest.length > 0
    ? [...shown, {
        area: `${rest.length} other${rest.length === 1 ? "" : "s"}`,
        events: rest.reduce((sum, share) => sum + share.events, 0),
        percent: rest.reduce((sum, share) => sum + share.percent, 0),
        completed: 0,
        merged: 0
      }]
    : shown;
  const labels = rows.map((row) => clip(row.area, 24));
  const width = Math.max(...labels.map((label) => label.length));
  return [
    heading,
    "```",
    ...rows.map((row, index) => `${labels[index].padEnd(width)}  ${bar(row.percent)} ${String(row.percent).padStart(3)}%`),
    "```"
  ].join("\n");
}

function renderRisks(risks: DigestRisk[]): string {
  return ["**Risks and stalls**", ...risks.map((risk) => `• ${risk.text}`)].join("\n");
}

/** Every recorded fact behind the page, for `digest show --detail` and the vault. */
export function renderDigestDetail(facts: DigestFact[], interactions?: DigestOperatorInteractions): string {
  const lines = ["## Detail", ""];
  if (interactions && interactions.items.length > 0) {
    lines.push(`### Operator interactions (${interactions.items.length})`, "");
    for (const item of interactions.items) {
      lines.push(`- ${item.at.slice(0, 16).replace("T", " ")}Z · ${item.necessity} · ${item.what.replace(/\s+/g, " ")} → ${item.unlocked}${item.ref ? ` (${item.ref})` : ""}${item.waitedMinutes !== null ? ` · waited ${item.waitedMinutes}m` : ""}`);
    }
    lines.push("", ...interactions.limitations.map((line) => `_${line}_`), "");
  }
  if (facts.length === 0) {
    lines.push("No recorded facts in this window.");
    return lines.join("\n");
  }
  const groups: Array<[DigestFact["kind"], string]> = [
    ["completed_action", "Completed Actions"],
    ["merged", "Merged"],
    ["decision", "Decisions"],
    ["mission_log", "Mission Log"],
    ["dispatch", "Dispatch"]
  ];
  for (const [kind, title] of groups) {
    const ofKind = facts.filter((fact) => fact.kind === kind);
    if (ofKind.length === 0) continue;
    lines.push(`### ${title} (${ofKind.length})`, "");
    for (const fact of ofKind) {
      const url = stringDetail(fact, "url");
      lines.push(`- ${fact.occurredAt.slice(0, 16).replace("T", " ")}Z · ${fact.summary.replace(/\s+/g, " ").trim()}${url ? ` (${url})` : ""}`);
    }
    lines.push("");
  }
  lines.push("Completion times use each Action's last update while done; a later edit moves an Action into a newer window.");
  return lines.join("\n").trimEnd();
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function bar(percent: number): string {
  const bounded = Math.max(0, Math.min(100, percent));
  const filled = bounded > 0 ? Math.max(1, Math.round((bounded / 100) * BAR_CELLS)) : 0;
  return `${"█".repeat(filled)}${"░".repeat(BAR_CELLS - filled)}`;
}

function age(isoInstant: string, now: Date): string {
  const ms = Math.max(0, now.getTime() - Date.parse(isoInstant));
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function stringDetail(fact: DigestFact, key: string): string | null {
  const value = fact.detail[key];
  return typeof value === "string" && value ? value : null;
}

function countBy<T>(items: T[], keyOf: (item: T) => string | null): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function hasTable(db: Database.Database, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}
