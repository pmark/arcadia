import type { Approval } from "./approvals";
import type { NextStepsResponse } from "./next-steps-server";
import type { DashboardOutstandingPullRequests } from "./types";

/**
 * The /workspace/feed message feed: what Arcadia would say to the operator,
 * built from the existing read-only sources. Every item links to the control
 * that already answers it; the feed itself changes nothing.
 */
export type FeedKind = "action" | "decision" | "todo" | "pr";
export type FeedSection = "Your move" | "Waiting on you" | "Waiting on others" | "Pull requests";

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
}

const SECTIONS: FeedSection[] = ["Your move", "Waiting on you", "Waiting on others", "Pull requests"];
const time = (at: string | null) => (at ? Date.parse(at) || 0 : 0);
/** A card step links to its card on /todo (`#card-<id>`), which is where that anchor exists. */
const stepHref = (href: string | null) => (href?.startsWith("#") ? `/todo${href}` : href);

export function buildFeed({ approvals, nextSteps, pullRequests }: FeedSources): FeedItem[] {
  const items: FeedItem[] = [];
  const steps = nextSteps ? [...(nextSteps.nowStep ? [nextSteps.nowStep] : []), ...nextSteps.steps.filter(s => s.id !== nextSteps.nowStep?.id)] : [];
  steps.forEach((step, index) => {
    // A wait step has nothing for the operator to press: it names what the work is waiting on.
    const wait = step.kind === "wait";
    const href = wait ? null : stepHref(step.href);
    const now = index === 0 && Boolean(nextSteps?.nowStep) && !wait;
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
  return items;
}

export function feedSections(items: FeedItem[]): Array<{ section: FeedSection; items: FeedItem[] }> {
  return SECTIONS.map(section => ({ section, items: items.filter(i => i.section === section) })).filter(s => s.items.length);
}
