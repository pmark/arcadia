import { describe, expect, it } from "vitest";
import { buildFlightDeck } from "./flight-deck";
import type { DashboardSnapshot } from "./types";
import type { WorkQueue } from "./work-queue-types";

const queue = (): WorkQueue => ({ generatedAt: "", revision: 1, nextActionKey: null, unpositionedCount: 0, orderValid: true, undoReceipt: null, counts: { ready: 1, running: 0, flagged: 0, attention: 0 }, ordered: [{ id: "a", state: "ready", attentionKind: null, selected: true, projectId: "p", projectName: "Arcadia", projectSlug: "arcadia", planSlug: "deck", actionId: "build", actionTitle: "Build board", responsibility: "agent", expectedArtifact: null, tokenImpact: null, tokenBudget: null, milestone: "Flight", status: "open", reason: "", nextAction: "Build it", blockers: [], runId: null, decisionId: null, updatedAt: "" }] });
const snapshot = (): DashboardSnapshot => ({ generatedAt: "", workspace: "", counts: {} as DashboardSnapshot["counts"], dailyAdvantage: null, reviewFocus: null, agentQueue: {} as DashboardSnapshot["agentQueue"], projects: [], attentionItems: [], activityEvents: [], capabilities: [], blogging: {} as DashboardSnapshot["blogging"], rebuster: {} as DashboardSnapshot["rebuster"], currentMilestones: [], backBurnerItems: [], recentRuns: [{ id: "r", status: "failed", statusLabel: "Failed", projectId: "p", projectName: "Arcadia", startedAt: "", updatedAt: "", completedAt: null, workItemTitle: "", actionTitle: "Build board", summary: "", planSummary: "", currentStep: null, latestMessage: "failed", artifactsProduced: [], failureReason: "bad", reviewReason: null, missionLogPath: null }], recentArtifacts: [{ id: "x", title: "Evidence", artifactType: "report", status: "ready", statusLabel: "Ready", path: "proof.md", projectId: "p", projectName: "Arcadia", workItemTitle: null, actionTitle: "Build board", updatedAt: "" }], requiresReviewItems: [{ id: "structural", slug: "", decisionId: "", decisionSlug: "", displayId: "", workItemId: null, actionId: "build", projectId: "p", project: "Arcadia", goal: null, outcome: null, status: "", statusLabel: "", category: "decision", decisionNeeded: "Choose", context: "", recommendation: null, proposedAction: "", missingFields: [], options: [], sourceInput: "", createdAt: "", updatedAt: "", resultingAskRequestId: null, contextJson: null, resolvedIntent: "ActionClarification", packetArtifactId: null, codexInvocationId: null, artifactPath: null, promptPath: null, finalMessagePath: null, validationPath: null, planningArtifact: null }, { id: "loose", slug: "", decisionId: "", decisionSlug: "", displayId: "", workItemId: null, actionId: null, projectId: "p", project: "Arcadia", goal: null, outcome: null, status: "", statusLabel: "", category: "decision", decisionNeeded: "Loose", context: "", recommendation: null, proposedAction: "", missingFields: [], options: [], sourceInput: "", createdAt: "", updatedAt: "", resultingAskRequestId: null, contextJson: null, resolvedIntent: "ActionClarification", packetArtifactId: null, codexInvocationId: null, artifactPath: null, promptPath: null, finalMessagePath: null, validationPath: null, planningArtifact: null }] });

function productionSnapshot() {
  const data = snapshot();
  data.requiresReviewItems[0]!.actionId = "work_123";
  data.recentRuns[0]!.workItemId = "work_123";
  data.recentArtifacts[0]!.workItemId = "work_123";
  data.managedActions = [{ workItemId: "work_123", projectId: "p", planSlug: "deck", actionId: "build" }];
  return data;
}

describe("buildFlightDeck", () => {
  it("places each identity once and resolves database IDs through managed references", () => {
    const lanes = buildFlightDeck(queue(), productionSnapshot());
    const cards = lanes.flatMap((lane) => lane.cards);
    expect(cards).toHaveLength(5);
    expect(new Set(cards.map((card) => card.id)).size).toBe(5);
    expect(lanes.find((lane) => lane.planSlug === "deck")?.cards.map((card) => card.kind)).toEqual(["action", "decision", "run", "artifact"]);
    expect(cards.find((card) => card.id === "decision:structural")).toMatchObject({ planSlug: "deck", relation: "structural" });
    expect(lanes.find((lane) => lane.planSlug === null)?.cards[0]).toMatchObject({ id: "decision:loose", relation: "unattached" });
  });

  it.each([
    ["pending_execution", "running"], ["running", "running"], ["failed", "needs-you"],
    ["requires_review", "proving"], ["completed", "proving"], ["future-status", "needs-you"]
  ])("places Run %s in %s", (status, column) => {
    const data = productionSnapshot();
    data.recentRuns[0]!.status = status;
    expect(buildFlightDeck(queue(), data).flatMap((lane) => lane.cards).find((card) => card.id === "run:r")?.column).toBe(column);
  });

  it.each([
    ["planned", "proving"], ["drafted", "proving"], ["ready", "landed"],
    ["published", "landed"], ["future-status", "needs-you"]
  ])("places Artifact %s in %s", (status, column) => {
    const data = productionSnapshot();
    data.recentArtifacts[0]!.status = status;
    expect(buildFlightDeck(queue(), data).flatMap((lane) => lane.cards).find((card) => card.id === "artifact:x")?.column).toBe(column);
  });

  it("keeps an Artifact with no location in Proving", () => {
    const data = productionSnapshot();
    data.recentArtifacts[0]!.path = null;
    expect(buildFlightDeck(queue(), data).flatMap((lane) => lane.cards).find((card) => card.id === "artifact:x")?.column).toBe("proving");
  });

  it("distinguishes dispatch authority, repair ownership, and external blockers", () => {
    const q = queue();
    const card = () => buildFlightDeck(q, productionSnapshot()).flatMap((lane) => lane.cards).find((card) => card.kind === "action");
    expect(card()).toMatchObject({ column: "needs-you", stateLabel: "Waiting for pointer" });
    q.ordered[0]!.pointerAuthorized = true;
    expect(card()?.column).toBe("ready");
    q.orderValid = false;
    expect(card()).toMatchObject({ column: "needs-you", stateLabel: "Queue order needs repair" });
    q.ordered[0]!.state = "attention";
    expect(card()?.stateLabel).toBe("Agent repair needed");
    q.ordered[0]!.responsibility = "blocked";
    expect(card()?.stateLabel).toBe("External blocker");
    q.ordered[0]!.state = "running";
    expect(card()?.column).toBe("running");
  });

  it("does not link duplicate titles or slugs across Projects", () => {
    const q = queue();
    q.ordered.push({ ...q.ordered[0]!, projectId: "other", projectName: "Other", planSlug: "other-plan" });
    const data = productionSnapshot();
    data.recentRuns[0]!.projectId = "other";
    const cards = buildFlightDeck(q, data).flatMap((lane) => lane.cards);
    expect(new Set(cards.map((card) => card.id)).size).toBe(cards.length);
    expect(cards.find((card) => card.id === "run:r")).toMatchObject({ planSlug: null, relation: "unattached" });
    expect(cards.find((card) => card.id === "decision:structural")?.planSlug).toBe("deck");
  });

  it("deduplicates overlapping evidence and includes queue-only Runs and nested Artifacts", () => {
    const data = productionSnapshot();
    data.recentRuns[0]!.artifactsProduced = [data.recentArtifacts[0]!, { ...data.recentArtifacts[0]!, id: "nested" }];
    const q = queue();
    q.running = [{ ...q.ordered[0]!, runId: "old-active", status: "running" }];
    const cards = buildFlightDeck(q, data).flatMap((lane) => lane.cards);
    expect(cards.filter((card) => card.id === "artifact:x")).toHaveLength(1);
    expect(cards.find((card) => card.id === "artifact:nested")).toBeDefined();
    expect(cards.find((card) => card.id === "run:old-active")?.column).toBe("running");
  });

  it("retains a structural Plan when its Action is no longer in the active queue", () => {
    const q = queue();
    q.ordered = [];
    expect(buildFlightDeck(q, productionSnapshot()).find((lane) => lane.planSlug === "deck")?.cards).toHaveLength(3);
  });

  it.each(["other-deck", "decks", "deck other-plan"])("does not invent a prose link from %s", (context) => {
    const q = queue();
    q.ordered.push({ ...q.ordered[0]!, actionId: "other", planSlug: "other-plan" });
    const data = snapshot();
    data.requiresReviewItems[1]!.context = context;
    expect(buildFlightDeck(q, data).flatMap((lane) => lane.cards).find((card) => card.id === "decision:loose")?.planSlug).toBeNull();
  });

  it("does not infer a Plan mentioned only in another Project", () => {
    const data = snapshot();
    data.requiresReviewItems[1] = { ...data.requiresReviewItems[1]!, context: "deck", projectId: "other" };
    expect(buildFlightDeck(queue(), data).flatMap((lane) => lane.cards).find((card) => card.id === "decision:loose")?.planSlug).toBeNull();
  });
});

it("uses a named Plan only as a prose link and puts QA Decisions in Proving", () => {
  const data = snapshot();
  data.requiresReviewItems[1] = { ...data.requiresReviewItems[1]!, context: "Review deck evidence", category: "qa" };
  const card = buildFlightDeck(queue(), data).flatMap((lane) => lane.cards).find((item) => item.id === "decision:loose");
  expect(card).toMatchObject({ planSlug: "deck", relation: "named-in-prose", column: "proving" });
});
