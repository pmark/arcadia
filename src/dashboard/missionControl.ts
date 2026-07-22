import type Database from "better-sqlite3";
import { listLiveOrientationEntries } from "../orientation/repository.js";
import { isStale } from "../orientation/staleness.js";
import type { OrientationEntry } from "../orientation/types.js";
import { computeOrientationUrgencyScore, urgencyLevelForScore } from "../orientation/urgency.js";
import { buildDashboardSnapshot, type DashboardProject, type DashboardReviewItem } from "./snapshot.js";

export type MissionControlUrgencyLevel = "critical" | "attention" | "quiet";

export interface MissionControlUrgency {
  level: MissionControlUrgencyLevel;
  score: number;
  reason: string;
}

export interface MissionControlActionItemData {
  id: string;
  title: string;
  urgency: MissionControlUrgency;
  dueAt?: string;
  updatedAt: string;
}

export interface MissionControlNodeSummaryData {
  id: string;
  kind: string;
  label: string;
  statusHeadline: string;
  urgency: MissionControlUrgency;
  childCount: number;
  updatedAt: string;
}

export interface MissionControlContextChannelData {
  placeholder: string;
  routesTo: { feature: "orientation" | "project" | "none"; entityId: string };
}

export interface MissionControlNodeDetailData extends MissionControlNodeSummaryData {
  status: { headline: string; detail?: string };
  actionItems: MissionControlActionItemData[];
  contextChannel: MissionControlContextChannelData;
  children: MissionControlNodeSummaryData[];
  /** Present only for life_entry nodes. */
  orientationEntry?: OrientationEntry & { stale: boolean };
  /** Present only for project nodes. */
  project?: DashboardProject;
  /** Present only for decision nodes. */
  decision?: DashboardReviewItem;
}

export interface MissionControlOverviewData {
  generatedAt: string;
  headline: string;
  needsYouNow: MissionControlActionItemData[];
  recentlyUpdated: MissionControlActionItemData[];
  towers: MissionControlNodeSummaryData[];
}

const TOWER_IDS = {
  life: "tower:life",
  projects: "tower:projects",
  decisions: "tower:decisions"
} as const;

function urgency(score: number, reason: string): MissionControlUrgency {
  return { level: urgencyLevelForScore(score), score: clamp01(score), reason };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function orientationEntryToActionItem(entry: OrientationEntry, now: Date): MissionControlActionItemData {
  const score = computeOrientationUrgencyScore(entry, now);
  const reason = entry.dueAt
    ? `Due ${entry.dueAt}`
    : `${entry.priority} priority, ${entry.horizon}`;
  return {
    id: entry.id,
    title: entry.title,
    urgency: urgency(score, reason),
    dueAt: entry.dueAt ?? undefined,
    updatedAt: entry.updatedAt
  };
}

function projectUrgencyScore(project: DashboardProject, hasOpenDecision: boolean, isDailyAdvantage: boolean): number {
  let score = project.status === "active" ? 0.3 : 0.1;
  if (hasOpenDecision) score += 0.35;
  if (isDailyAdvantage) score += 0.2;
  return clamp01(score);
}

export function buildMissionControlOverview(db: Database.Database, workspace: string): MissionControlOverviewData {
  const now = new Date();
  const snapshot = buildDashboardSnapshot({ workspace });
  const liveEntries = listLiveOrientationEntries(db);

  const lifeActionItems = liveEntries.map((entry) => orientationEntryToActionItem(entry, now));
  const projectIdsWithOpenDecisions = new Set(
    snapshot.requiresReviewItems.map((item) => item.projectId).filter((id): id is string => Boolean(id))
  );
  const projectActionItems: MissionControlActionItemData[] = snapshot.projects.map((project) => {
    const hasOpenDecision = projectIdsWithOpenDecisions.has(project.id);
    const isDailyAdvantage = snapshot.dailyAdvantage?.projectId === project.id;
    const score = projectUrgencyScore(project, hasOpenDecision, isDailyAdvantage);
    const reason = hasOpenDecision
      ? "Has an open Decision"
      : isDailyAdvantage
        ? "Today's Daily Advantage"
        : `${project.statusLabel}`;
    return { id: project.id, title: project.name, urgency: urgency(score, reason), updatedAt: project.updatedAt };
  });
  const decisionActionItems: MissionControlActionItemData[] = snapshot.requiresReviewItems.map((item) => ({
    id: item.id,
    title: item.decisionNeeded,
    urgency: urgency(0.6, "Awaiting your decision"),
    updatedAt: item.updatedAt
  }));

  const allActionItems = [...lifeActionItems, ...projectActionItems, ...decisionActionItems];

  const needsYouNow = [...allActionItems].sort((a, b) => b.urgency.score - a.urgency.score).slice(0, 5);

  const recentlyUpdated = [...allActionItems]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5);

  const towers: MissionControlNodeSummaryData[] = [
    {
      id: TOWER_IDS.life,
      kind: "life_tower",
      label: "Life",
      statusHeadline: summarizeCount(lifeActionItems.filter((item) => item.urgency.level !== "quiet").length, "needs attention"),
      urgency: maxUrgency(lifeActionItems, "Nothing pressing"),
      childCount: liveEntries.length,
      updatedAt: now.toISOString()
    },
    {
      id: TOWER_IDS.projects,
      kind: "projects_tower",
      label: "Projects",
      statusHeadline: summarizeCount(projectActionItems.filter((item) => item.urgency.level !== "quiet").length, "need attention"),
      urgency: maxUrgency(projectActionItems, "All quiet"),
      childCount: snapshot.projects.length,
      updatedAt: now.toISOString()
    },
    {
      id: TOWER_IDS.decisions,
      kind: "decisions_tower",
      label: "Decisions",
      statusHeadline: summarizeCount(decisionActionItems.length, "awaiting you"),
      urgency: maxUrgency(decisionActionItems, "Nothing waiting"),
      childCount: decisionActionItems.length,
      updatedAt: now.toISOString()
    }
  ];

  return {
    generatedAt: now.toISOString(),
    headline: needsYouNow.length > 0 ? `${needsYouNow.length} thing(s) need you` : "Nothing pressing",
    needsYouNow,
    recentlyUpdated,
    towers
  };
}

export function buildMissionControlNodeDetail(
  db: Database.Database,
  workspace: string,
  nodeId: string
): MissionControlNodeDetailData | null {
  const now = new Date();
  const snapshot = buildDashboardSnapshot({ workspace });

  if (nodeId === TOWER_IDS.life) {
    const entries = listLiveOrientationEntries(db);
    const actionItems = entries.map((entry) => orientationEntryToActionItem(entry, now));
    return {
      id: nodeId,
      kind: "life_tower",
      label: "Life",
      statusHeadline: summarizeCount(actionItems.filter((item) => item.urgency.level !== "quiet").length, "needs attention"),
      urgency: maxUrgency(actionItems, "Nothing pressing"),
      childCount: entries.length,
      updatedAt: now.toISOString(),
      status: { headline: `${entries.length} live entries` },
      actionItems,
      contextChannel: {
        placeholder: "Add a new life item, or tell Arcadia what's true",
        routesTo: { feature: "orientation", entityId: "ledger" }
      },
      children: entries.map((entry) => entryToSummary(entry, now))
    };
  }

  if (nodeId === TOWER_IDS.projects) {
    const actionItems = snapshot.projects.map((project) => ({
      id: project.id,
      title: project.name,
      urgency: urgency(0.4, project.statusLabel),
      updatedAt: project.updatedAt
    }));
    return {
      id: nodeId,
      kind: "projects_tower",
      label: "Projects",
      statusHeadline: `${snapshot.projects.length} project(s)`,
      urgency: maxUrgency(actionItems, "All quiet"),
      childCount: snapshot.projects.length,
      updatedAt: now.toISOString(),
      status: { headline: `${snapshot.projects.length} tracked project(s)` },
      actionItems,
      contextChannel: { placeholder: "Ask Arcadia about your projects", routesTo: { feature: "none", entityId: "" } },
      children: snapshot.projects.map((project) => projectToSummary(project))
    };
  }

  if (nodeId === TOWER_IDS.decisions) {
    const actionItems = snapshot.requiresReviewItems.map((item) => ({
      id: item.id,
      title: item.decisionNeeded,
      urgency: urgency(0.6, "Awaiting your decision"),
      updatedAt: item.updatedAt
    }));
    return {
      id: nodeId,
      kind: "decisions_tower",
      label: "Decisions",
      statusHeadline: summarizeCount(actionItems.length, "awaiting you"),
      urgency: maxUrgency(actionItems, "Nothing waiting"),
      childCount: actionItems.length,
      updatedAt: now.toISOString(),
      status: { headline: `${actionItems.length} decision(s) waiting` },
      actionItems,
      contextChannel: { placeholder: "", routesTo: { feature: "none", entityId: "" } },
      children: snapshot.requiresReviewItems.map((item) => decisionToSummary(item))
    };
  }

  const entry = listLiveOrientationEntries(db).find((candidate) => candidate.id === nodeId);
  if (entry) {
    return {
      id: entry.id,
      kind: "life_entry",
      label: entry.title,
      statusHeadline: `${entry.priority}/${entry.horizon}`,
      urgency: urgency(computeOrientationUrgencyScore(entry, now), entry.dueAt ? `Due ${entry.dueAt}` : entry.priority),
      childCount: 0,
      updatedAt: entry.updatedAt,
      status: {
        headline: entry.status,
        detail: isStale(entry, now)
          ? `Unconfirmed since ${entry.lastConfirmedAt}`
          : `Confirmed ${entry.lastConfirmedAt}`
      },
      actionItems: [],
      contextChannel: {
        placeholder: "Tell Arcadia what's true, ask a question, or give an update",
        routesTo: { feature: "orientation", entityId: entry.id }
      },
      children: [],
      orientationEntry: { ...entry, stale: isStale(entry, now) }
    };
  }

  const project = snapshot.projects.find((candidate) => candidate.id === nodeId);
  if (project) {
    return {
      id: project.id,
      kind: "project",
      label: project.name,
      statusHeadline: project.statusLabel,
      urgency: urgency(0.4, project.statusLabel),
      childCount: 0,
      updatedAt: project.updatedAt,
      status: { headline: project.statusSummary ?? project.mission, detail: project.nextAction ?? undefined },
      actionItems: [],
      contextChannel: {
        placeholder: "Tell Arcadia what's true about this project, or ask a question",
        routesTo: { feature: "project", entityId: project.id }
      },
      children: [],
      project
    };
  }

  const decision = snapshot.requiresReviewItems.find((candidate) => candidate.id === nodeId);
  if (decision) {
    return {
      id: decision.id,
      kind: "decision",
      label: decision.decisionNeeded,
      statusHeadline: decision.statusLabel,
      urgency: urgency(0.6, "Awaiting your decision"),
      childCount: 0,
      updatedAt: decision.updatedAt,
      status: { headline: decision.proposedAction },
      actionItems: [],
      contextChannel: { placeholder: "", routesTo: { feature: "none", entityId: "" } },
      children: [],
      decision
    };
  }

  return null;
}

function entryToSummary(entry: OrientationEntry, now: Date): MissionControlNodeSummaryData {
  return {
    id: entry.id,
    kind: "life_entry",
    label: entry.title,
    statusHeadline: `${entry.priority}/${entry.horizon}`,
    urgency: urgency(computeOrientationUrgencyScore(entry, now), entry.dueAt ? `Due ${entry.dueAt}` : entry.priority),
    childCount: 0,
    updatedAt: entry.updatedAt
  };
}

function projectToSummary(project: DashboardProject): MissionControlNodeSummaryData {
  return {
    id: project.id,
    kind: "project",
    label: project.name,
    statusHeadline: project.statusLabel,
    urgency: urgency(0.4, project.statusLabel),
    childCount: 0,
    updatedAt: project.updatedAt
  };
}

function decisionToSummary(item: DashboardReviewItem): MissionControlNodeSummaryData {
  return {
    id: item.id,
    kind: "decision",
    label: item.decisionNeeded,
    statusHeadline: item.statusLabel,
    urgency: urgency(0.6, "Awaiting your decision"),
    childCount: 0,
    updatedAt: item.updatedAt
  };
}

function maxUrgency(items: MissionControlActionItemData[], quietReason: string): MissionControlUrgency {
  if (items.length === 0) {
    return urgency(0, quietReason);
  }
  return items.reduce((max, item) => (item.urgency.score > max.score ? item.urgency : max), items[0].urgency);
}

function summarizeCount(count: number, suffix: string): string {
  if (count === 0) {
    return "All clear";
  }
  return `${count} ${suffix}`;
}
