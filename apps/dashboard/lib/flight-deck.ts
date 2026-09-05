import type { DashboardArtifact, DashboardReviewItem, DashboardSnapshot } from "./types";
import type { WorkQueue, WorkQueueEntry } from "./work-queue-types";

export const FLIGHT_DECK_COLUMNS = ["needs-you", "ready", "running", "proving", "landed"] as const;
export type FlightDeckColumn = typeof FLIGHT_DECK_COLUMNS[number];
export type FlightDeckCardKind = "action" | "decision" | "run" | "artifact";
type Relation = "structural" | "named-in-prose" | "unattached" | "direct";
export interface FlightDeckCard {
  id: string;
  kind: FlightDeckCardKind;
  column: FlightDeckColumn;
  title: string;
  detail: string;
  stateLabel: string;
  projectId: string | null;
  projectName: string;
  planSlug: string | null;
  milestone: string | null;
  relation: Relation;
}
export interface FlightDeckLane {
  projectId: string | null;
  projectName: string;
  planSlug: string | null;
  milestone: string | null;
  cards: FlightDeckCard[];
}
type Link = Pick<FlightDeckCard, "planSlug" | "milestone" | "relation">;
const actionKey = (project: string | null, plan: string | null, action: string) => JSON.stringify([project, plan, action]);

/** Emit each identity once. Titles never establish structural relationships. */
export function buildFlightDeck(queue: WorkQueue, snapshot: DashboardSnapshot): FlightDeckLane[] {
  const cards = new Map<string, FlightDeckCard>();
  const actions = new Map<string, FlightDeckCard>();
  for (const entry of queue.ordered) {
    if (!entry.actionId) continue;
    const card = actionCard(entry, queue.orderValid);
    actions.set(actionKey(entry.projectId, entry.planSlug, entry.actionId), card);
    cards.set(card.id, card);
  }
  const refs = new Map((snapshot.managedActions ?? []).map((ref) => [ref.workItemId, ref]));
  function relationship(projectId: string | null, workItemId: string | null | undefined): Link {
    const ref = workItemId ? refs.get(workItemId) : undefined;
    if (!ref || ref.projectId !== projectId) return { planSlug: null, milestone: null, relation: "unattached" };
    const linked = actions.get(actionKey(projectId, ref.planSlug, ref.actionId));
    return { planSlug: ref.planSlug, milestone: linked?.milestone ?? null, relation: "structural" };
  }
  for (const decision of snapshot.requiresReviewItems) {
    const attention = snapshot.attentionItems.find((item) => item.relatedReviewId === decision.id && item.projectId === decision.projectId);
    let link = relationship(decision.projectId, decision.actionId ?? attention?.actionId);
    if (!link.planSlug) {
      const projectActions = [...actions.values()].filter((card) => card.projectId === decision.projectId);
      const plans = [...new Set(projectActions.flatMap((card) => card.planSlug ? [card.planSlug] : []))];
      const words = [decision.context, decision.proposedAction, decision.decisionNeeded].join(" ").toLowerCase().split(/[^a-z0-9-]+/);
      const mentions = plans.filter((plan) => words.includes(plan.toLowerCase()));
      if (mentions.length === 1) link = {
        planSlug: mentions[0]!, milestone: projectActions.find((card) => card.planSlug === mentions[0])?.milestone ?? null,
        relation: "named-in-prose"
      };
    }
    const card: FlightDeckCard = {
      id: `decision:${decision.id}`, kind: "decision", ...decisionState(decision),
      title: decision.decisionNeeded, detail: decision.recommendation || decision.proposedAction || "Decision required.",
      projectId: decision.projectId, projectName: decision.project ?? "Unassigned Project", ...link
    };
    cards.set(card.id, card);
  }
  for (const run of snapshot.recentRuns) {
    const card: FlightDeckCard = {
      id: `run:${run.id}`, kind: "run", ...runState(run.status),
      title: run.actionTitle || run.workItemTitle || run.summary, detail: run.failureReason || run.latestMessage || run.summary,
      projectId: run.projectId, projectName: run.projectName ?? "Unassigned Project",
      ...relationship(run.projectId, run.workItemId)
    };
    cards.set(card.id, card);
  }
  // Active Runs can outlive the snapshot's recent-history window.
  for (const entry of [...(queue.running ?? []), ...(queue.attention ?? []), ...(queue.flagged ?? [])]) {
    const kind = entry.runId ? "run" : entry.decisionId ? "decision" : null;
    const id = kind === "run" ? entry.runId : entry.decisionId;
    if (!kind || !id || cards.has(`${kind}:${id}`)) continue;
    cards.set(`${kind}:${id}`, {
      id: `${kind}:${id}`, kind,
      ...(kind === "run" ? runState(entry.status) : { column: "needs-you" as const, stateLabel: entry.state === "flagged" ? "Agent review requested" : "Operator Decision" }),
      title: entry.actionTitle || entry.reason, detail: entry.nextAction,
      projectId: entry.projectId, projectName: entry.projectName ?? "Unassigned Project",
      ...relationship(entry.projectId, entry.actionId)
    });
  }
  for (const artifact of [...snapshot.recentArtifacts, ...snapshot.recentRuns.flatMap((run) => run.artifactsProduced)]) {
    if (cards.has(`artifact:${artifact.id}`)) continue;
    cards.set(`artifact:${artifact.id}`, {
      id: `artifact:${artifact.id}`, kind: "artifact", ...artifactState(artifact),
      title: artifact.title, detail: artifact.path || artifact.statusLabel,
      projectId: artifact.projectId, projectName: artifact.projectName ?? "Unassigned Project",
      ...relationship(artifact.projectId, artifact.workItemId)
    });
  }
  const lanes = new Map<string, FlightDeckLane>();
  for (const card of cards.values()) {
    const key = JSON.stringify([card.projectId ?? card.projectName, card.planSlug]);
    const lane = lanes.get(key) ?? { projectId: card.projectId, projectName: card.projectName, planSlug: card.planSlug, milestone: card.milestone, cards: [] };
    lane.cards.push(card);
    lane.milestone ??= card.milestone;
    lanes.set(key, lane);
  }
  return [...lanes.values()].sort((a, b) => a.projectName.localeCompare(b.projectName) || Number(a.planSlug === null) - Number(b.planSlug === null) || (a.planSlug ?? "").localeCompare(b.planSlug ?? ""));
}
type Placement = Pick<FlightDeckCard, "column" | "stateLabel">;
function actionCard(entry: WorkQueueEntry, orderValid: boolean): FlightDeckCard {
  let state: Placement;
  if (entry.state === "running") state = { column: "running", stateLabel: "Active" };
  else if (entry.state === "ready" && entry.pointerAuthorized === true && orderValid && !entry.blockers.length) state = { column: "ready", stateLabel: "Pointer authorized" };
  else if (entry.state === "ready" && !entry.blockers.length) state = { column: "needs-you", stateLabel: orderValid ? "Waiting for pointer" : "Queue order needs repair" };
  else state = { column: "needs-you", stateLabel: entry.responsibility === "agent" || entry.responsibility === "autonomous" ? "Agent repair needed" : entry.responsibility === "blocked" ? "External blocker" : "Operator Decision" };
  return {
    id: `action:${actionKey(entry.projectId, entry.planSlug, entry.actionId!)}`, kind: "action", ...state,
    title: entry.actionTitle || entry.actionId || "Unnamed Action", detail: entry.reason || entry.nextAction,
    projectId: entry.projectId, projectName: entry.projectName ?? "Unassigned Project",
    planSlug: entry.planSlug, milestone: entry.milestone ?? null, relation: entry.planSlug ? "direct" : "unattached"
  };
}
function decisionState(decision: DashboardReviewItem): Placement {
  const proving = ["CandidateQaSignoff", "IndependentPullRequestQa", "CodexPlanningArtifactAcceptance"].includes(decision.resolvedIntent)
    || ["qa", "codex_planning_artifact_validation"].includes(decision.category);
  return { column: proving ? "proving" : "needs-you", stateLabel: proving ? "Operator evidence review" : "Operator Decision" };
}
function runState(status: string): Placement {
  switch (status) {
    case "pending_execution": return { column: "running", stateLabel: "Queued for worker" };
    case "running": return { column: "running", stateLabel: "Running" };
    case "failed": return { column: "needs-you", stateLabel: "Run failed" };
    case "requires_review": return { column: "proving", stateLabel: "Run requires review" };
    case "completed": return { column: "proving", stateLabel: "Run completed; acceptance separate" };
    default: return { column: "needs-you", stateLabel: `Unknown Run state: ${status}` };
  }
}
function artifactState(artifact: DashboardArtifact): Placement {
  switch (artifact.status) {
    case "planned": return { column: "proving", stateLabel: "Planned output; no completion proof" };
    case "drafted": return { column: "proving", stateLabel: "Draft; not accepted" };
    case "ready":
    case "published":
      return artifact.path
        ? { column: "landed", stateLabel: artifact.status === "published" ? "Published Artifact" : "Ready Artifact; Action acceptance separate" }
        : { column: "proving", stateLabel: "Artifact location missing" };
    default: return { column: "needs-you", stateLabel: `Unknown Artifact state: ${artifact.status}` };
  }
}
