import type { Approval } from "./approvals";
import { CARD_STATE_LABEL, cardStepId, formatCardTime, type CardClassification } from "./operator-card-state";
import type { NextStepsResponse } from "./next-steps-server";
import type { DashboardOutstandingPullRequests } from "./types";

/**
 * The /workspace/feed message feed: what Arcadia would say to the operator,
 * built from the existing read-only sources. Every item links to the control
 * that already answers it; the feed itself changes nothing.
 */
export type FeedKind = "action" | "decision" | "todo" | "pr";
export type FeedSection = "Your move" | "Waiting on you" | "Waiting on others" | "Pull requests" | "History";

export interface FeedItem {
  key: string;
  kind: FeedKind;
  section: FeedSection;
  title: string;
  detail: string | null;
  /** A short state word or two: "now", "blocking", the PR readiness label. */
  chip: string;
  href: string | null;
  /** True for a link that leaves the dashboard (a GitHub PR). */
  external: boolean;
  at: string | null;
  urgent: boolean;
}

export interface FeedSources {
  approvals: Approval[] | null;
  nextSteps: NextStepsResponse | null;
  pullRequests: DashboardOutstandingPullRequests | null;
  /** Operator-script cards that have ended; they leave "Your move" and are listed under "History". Absent: nothing is hidden. */
  endedCards?: ReadonlyArray<CardClassification> | null;
}

const SECTIONS: FeedSection[] = ["Your move", "Waiting on you", "Waiting on others", "Pull requests"];
/** Shown only when the history filter is on. */
const HISTORY: FeedSection = "History";
const time = (at: string | null) => (at ? Date.parse(at) || 0 : 0);
/** A card step links to its card on /todo (`#card-<id>`), which is where that anchor exists. */
const stepHref = (href: string | null) => (href?.startsWith("#") ? `/todo${href}` : href);

export function buildFeed({ approvals, nextSteps, pullRequests, endedCards }: FeedSources): FeedItem[] {
  const items: FeedItem[] = [];
  const ended = new Map((endedCards ?? []).filter(c => c.state !== "actionable").map(c => [cardStepId(c.id), c]));
  const allSteps = nextSteps ? [...(nextSteps.nowStep ? [nextSteps.nowStep] : []), ...nextSteps.steps.filter(s => s.id !== nextSteps.nowStep?.id)] : [];
  const steps = allSteps.filter(s => !ended.has(s.id));
  steps.forEach(step => {
    // A wait step has nothing for the operator to press: it names what the work is waiting on.
    const wait = step.kind === "wait";
    const href = wait ? null : stepHref(step.href);
    const now = Boolean(nextSteps?.nowStep) && step.id === nextSteps?.nowStep?.id && !wait;
    items.push({
      key: `action:${step.id}`,
      kind: "action",
      section: wait ? "Waiting on others" : "Your move",
      title: step.title,
      detail: wait ? step.waitingFor : step.unblocks || null,
      chip: now ? "now" : wait ? "waiting" : step.kind,
      href,
      external: Boolean(href && /^https?:/.test(href)),
      at: null,
      urgent: now
    });
  });
  const waiting = (approvals ?? []).filter(a => !a.staleReason);
  waiting.sort((a, b) => Number(b.blocking) - Number(a.blocking) || Number(b.kind === "decision") - Number(a.kind === "decision") || time(b.createdAt) - time(a.createdAt));
  for (const a of waiting) items.push({
    key: `${a.kind}:${a.todoKey}`,
    kind: a.kind === "decision" ? "decision" : "todo",
    section: "Waiting on you",
    title: a.title,
    detail: a.gateQuestion ?? a.detail,
    chip: `${a.kind === "decision" ? "Decision" : a.kind === "agent_ask" ? "Agent Ask" : "Review"}${a.blocking ? " · blocking" : ""}`,
    href: a.href,
    external: false,
    at: a.createdAt,
    urgent: a.blocking
  });
  const prs = [...(pullRequests?.pullRequests ?? [])].sort((a, b) => time(b.updatedAt) - time(a.updatedAt));
  for (const pr of prs) items.push({
    key: `pr:${pr.repository}#${pr.number}`,
    kind: "pr",
    section: "Pull requests",
    title: `#${pr.number} ${pr.title}`,
    detail: pr.summary || null,
    chip: pr.readinessLabel,
    href: pr.url,
    external: true,
    at: pr.updatedAt,
    urgent: pr.readiness === "checks_failing" || pr.readiness === "blocked"
  });
  // Ended cards: newest end first. Each links to its card's page and never offers a press.
  const history = [...ended.values()].sort((a, b) => time(b.at) - time(a.at));
  for (const card of history) {
    items.push({ key: `history:${card.id}`, kind: "action", section: HISTORY, title: card.title, detail: formatCardTime(card.at) || null, chip: CARD_STATE_LABEL[card.state], href: `/actions/${encodeURIComponent(card.id)}`, external: false, at: card.at, urgent: false });
  }
  return items;
}

/** The items that are live work: History is a filtered view, never a reason the feed is non-empty. */
export const liveItems = (items: FeedItem[]) => items.filter(i => i.section !== HISTORY);

export function feedSections(items: FeedItem[], includeHistory = false): Array<{ section: FeedSection; items: FeedItem[] }> {
  return (includeHistory ? [...SECTIONS, HISTORY] : SECTIONS).map(section => ({ section, items: items.filter(i => i.section === section) })).filter(s => s.items.length);
}
