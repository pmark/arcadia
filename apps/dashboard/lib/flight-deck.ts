import type { DashboardArtifact, DashboardReviewItem, DashboardRun, DashboardSnapshot } from "./types";
import type { WorkQueue, WorkQueueEntry } from "./work-queue-types";

export const FLIGHT_DECK_COLUMNS = ["needs-you", "ready", "running", "proving", "landed"] as const;
export type FlightDeckColumn = typeof FLIGHT_DECK_COLUMNS[number];
export type FlightDeckCardKind = "action" | "decision" | "run" | "artifact";

export interface FlightDeckCard {
  id: string;
  kind: FlightDeckCardKind;
  column: FlightDeckColumn;
  title: string;
  detail: string;
  projectId: string | null;
  projectName: string;
  planSlug: string | null;
  milestone: string | null;
  relation: "structural" | "named-in-prose" | "unattached" | "direct";
}

export interface FlightDeckLane { projectId: string | null; projectName: string; planSlug: string | null; milestone: string | null; cards: FlightDeckCard[]; }

/** Pure projection of the two existing read endpoints. It never changes queue state. */
export function buildFlightDeck(queue: WorkQueue, snapshot: DashboardSnapshot): FlightDeckLane[] {
  const actions = queue.ordered.filter((entry) => entry.actionId).map((entry) => actionCard(entry));
  const actionById = new Map(actions.map((card) => [card.id.replace("action:", ""), card]));
  const queueByActionId = new Map(queue.ordered.filter((entry) => entry.actionId).map((entry) => [entry.actionId as string, entry]));
  const plans = new Set(actions.map((card) => card.planSlug).filter((slug): slug is string => Boolean(slug)));
  const cards: FlightDeckCard[] = [...actions];

  for (const decision of snapshot.requiresReviewItems) cards.push(decisionCard(decision, actionById, queueByActionId, plans));
  for (const run of snapshot.recentRuns) cards.push(runCard(run, actionById));
  for (const artifact of snapshot.recentArtifacts) cards.push(artifactCard(artifact, actionById));

  const lanes = new Map<string, FlightDeckLane>();
  for (const card of cards) {
    const key = `${card.projectId ?? card.projectName}::${card.planSlug ?? "unattached"}`;
    const existing = lanes.get(key) ?? { projectId: card.projectId, projectName: card.projectName, planSlug: card.planSlug, milestone: card.milestone, cards: [] };
    existing.cards.push(card);
    lanes.set(key, existing);
  }
  return [...lanes.values()].sort((a, b) => a.projectName.localeCompare(b.projectName) || Number(a.planSlug === null) - Number(b.planSlug === null) || (a.planSlug ?? "").localeCompare(b.planSlug ?? ""));
}

function actionCard(entry: WorkQueueEntry): FlightDeckCard {
  return { id: `action:${entry.actionId}`, kind: "action", column: entry.blockers.length || entry.state === "attention" ? "needs-you" : entry.state === "running" ? "running" : "ready", title: entry.actionTitle ?? entry.actionId ?? "Unnamed Action", detail: entry.nextAction, projectId: entry.projectId, projectName: entry.projectName ?? "Unassigned Project", planSlug: entry.planSlug, milestone: entry.milestone ?? null, relation: entry.planSlug ? "direct" : "unattached" };
}

function decisionCard(decision: DashboardReviewItem, actions: Map<string, FlightDeckCard>, queue: Map<string, WorkQueueEntry>, plans: Set<string>): FlightDeckCard {
  const linked = decision.actionId ? actions.get(decision.actionId) : undefined;
  const prose = [decision.context, decision.proposedAction, decision.decisionNeeded].join(" ").toLowerCase();
  const prosePlan = [...plans].find((plan) => prose.includes(plan.toLowerCase())) ?? null;
  const planSlug = linked?.planSlug ?? prosePlan;
  const source = linked ? queue.get(decision.actionId ?? "") : undefined;
  return { id: `decision:${decision.id}`, kind: "decision", column: /qa|signoff|validation/i.test(`${decision.category} ${decision.resolvedIntent}`) ? "proving" : "needs-you", title: decision.decisionNeeded, detail: decision.recommendation ?? decision.proposedAction ?? "Decision required.", projectId: decision.projectId, projectName: decision.project ?? "Unassigned Project", planSlug, milestone: linked?.milestone ?? source?.milestone ?? null, relation: linked ? "structural" : prosePlan ? "named-in-prose" : "unattached" };
}

function runCard(run: DashboardRun, actions: Map<string, FlightDeckCard>): FlightDeckCard {
  const linked = [...actions.values()].find((card) => card.title === run.actionTitle);
  return { id: `run:${run.id}`, kind: "run", column: run.status === "failed" ? "needs-you" : /review|qa|validat/i.test(`${run.status} ${run.reviewReason ?? ""}`) ? "proving" : "running", title: run.actionTitle || run.workItemTitle || run.summary, detail: run.failureReason ?? run.latestMessage ?? run.summary, projectId: run.projectId, projectName: run.projectName ?? "Unassigned Project", planSlug: linked?.planSlug ?? null, milestone: linked?.milestone ?? null, relation: linked ? "structural" : "unattached" };
}

function artifactCard(artifact: DashboardArtifact, actions: Map<string, FlightDeckCard>): FlightDeckCard {
  const linked = [...actions.values()].find((card) => card.title === artifact.actionTitle);
  return { id: `artifact:${artifact.id}`, kind: "artifact", column: "landed", title: artifact.title, detail: artifact.path ?? artifact.statusLabel, projectId: artifact.projectId, projectName: artifact.projectName ?? "Unassigned Project", planSlug: linked?.planSlug ?? null, milestone: linked?.milestone ?? null, relation: linked ? "structural" : "unattached" };
}
