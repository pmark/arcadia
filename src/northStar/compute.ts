import type Database from "better-sqlite3";
import {
  getProjectBySlug,
  getProjectMetadata,
  getWorkItemByDocRef,
  listProjects,
  listReviewItems
} from "../db/repositories.js";
import type { ReviewItemSummary, WorkItemSummary } from "../domain/types.js";
import { daysSinceLastCommit, readRepositoryActivity } from "./attention.js";
import type {
  AttentionSlice,
  DriftLevel,
  GateStatus,
  NorthStarDocument,
  NowBrief,
  ResolvedGate,
  TheOneThing
} from "./types.js";

export const ATTENTION_WINDOW_DAYS = 7;

/**
 * Thresholds for the drift verdict, as a share of the window's commits landing
 * in the target Project. They are deliberately generous. A screen that calls a
 * good week a failure gets ignored within days, and an ignored screen measures
 * nothing — so "on target" starts at a plain majority, and everything below it
 * is described rather than scolded.
 */
const ON_TARGET_SHARE = 0.5;
const DRIFTING_SHARE = 0.25;

export interface ComputeNowOptions {
  now?: Date;
  windowDays?: number;
}

export function computeNowBrief(
  db: Database.Database,
  northStar: NorthStarDocument | null,
  options: ComputeNowOptions = {}
): NowBrief {
  const now = options.now ?? new Date();
  const windowDays = options.windowDays ?? ATTENTION_WINDOW_DAYS;
  const warnings: string[] = [];

  const targetProject = northStar ? getProjectBySlug(db, northStar.projectSlug) : null;
  if (northStar && !targetProject) {
    warnings.push(
      `NORTH_STAR.md points at project \`${northStar.projectSlug}\`, which is not in this workspace.`
    );
  }

  const gates = northStar ? resolveGates(db, northStar, warnings) : [];
  const done = gates.filter((gate) => gate.status === "done").length;
  const remaining = gates.length - done;

  const attention = measureAttention(db, targetProject?.id ?? null, windowDays, now);
  const openReviews = targetProject
    ? listReviewItems(db, "open").filter((item) => item.project_id === targetProject.id)
    : [];
  const elsewhereReviews = listReviewItems(db, "open").length - openReviews.length;

  const theOneThing = selectTheOneThing({ northStar, gates, openReviews, targetProjectName: targetProject?.name ?? null });
  const fifteenMinutes = selectFifteenMinutes({ openReviews, gates, chosen: theOneThing, targetProjectName: targetProject?.name ?? null });

  return {
    generatedAt: now.toISOString(),
    target: {
      declared: Boolean(northStar),
      text: northStar?.target ?? "No target declared.",
      why: northStar?.why ?? "",
      looksLike: northStar?.looksLike ?? "",
      qaUrl: northStar?.qaUrl ?? null,
      projectName: targetProject?.name ?? null,
      documentPath: northStar?.path ?? null
    },
    distance: {
      total: gates.length,
      done,
      remaining,
      // Half credit for a gate already underway. Endowed progress: a bar that
      // reads zero on a day real work happened teaches the operator to ignore
      // the bar, and `done` above stays the honest integer for anyone counting.
      fraction:
        gates.length === 0
          ? 0
          : (done + gates.filter((gate) => gate.status === "in_progress").length * 0.5) / gates.length
    },
    gates,
    theOneThing,
    fifteenMinutes,
    attention,
    owed: {
      onTarget: openReviews.slice(0, 5).map((item) => ({
        slug: item.slug ?? item.id,
        question: item.decision_needed
      })),
      elsewhere: elsewhereReviews
    },
    drift: describeDrift(attention, targetProject?.name ?? null),
    reality: null,
    warnings
  };
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

function resolveGates(db: Database.Database, northStar: NorthStarDocument, warnings: string[]): ResolvedGate[] {
  return northStar.gates.map((gate) => {
    if (!gate.actionRef) {
      return {
        ...gate,
        status: gate.declaredStatus ?? "open",
        workItemId: null,
        nextAction: null,
        clarification: null,
        derived: false
      };
    }

    const item = getWorkItemByDocRef(db, gate.actionRef);
    if (!item) {
      warnings.push(`Gate \`${gate.id}\` tracks \`${gate.actionRef}\`, which no Action carries.`);
      return {
        ...gate,
        status: gate.declaredStatus ?? "unknown",
        workItemId: null,
        nextAction: null,
        clarification: null,
        derived: false
      };
    }

    return {
      ...gate,
      status: statusOf(item),
      workItemId: item.id,
      nextAction: item.next_action,
      clarification: item.clarification_status,
      derived: true
    };
  });
}

function statusOf(item: WorkItemSummary): GateStatus {
  switch (item.status) {
    case "done":
      return "done";
    case "in_progress":
      return "in_progress";
    case "blocked":
      return "blocked";
    default:
      return "open";
  }
}

// ---------------------------------------------------------------------------
// The one thing
// ---------------------------------------------------------------------------

/**
 * Choosing exactly one next step, in an order that follows how avoidance
 * actually works rather than how a backlog is usually sorted.
 *
 * 1. No declared target beats everything: distance is undefined without one,
 *    and every other number on the screen would be theatre.
 * 2. Work already started, before work not started. Interrupted tasks carry
 *    their own pull (the Zeigarnik effect); a screen that keeps proposing
 *    fresh starts manufactures abandoned ones.
 * 3. An unblocked, clarified gate Action next — the case where the next
 *    physical move is already written down and can simply be done.
 * 4. Then an owed Decision, because an unanswered question is the cheapest
 *    thing on the list and the only kind of item where the operator is
 *    personally the bottleneck.
 * 5. Then clarification, because an Action whose next move is undefined is the
 *    single most reliable cause of avoidance, and clarifying it *is* the work.
 */
function selectTheOneThing(input: {
  northStar: NorthStarDocument | null;
  gates: ResolvedGate[];
  openReviews: ReviewItemSummary[];
  targetProjectName: string | null;
}): TheOneThing {
  const { northStar, gates, openReviews, targetProjectName } = input;

  if (!northStar) {
    return {
      kind: "declare_target",
      id: null,
      title: "Declare the one thing that matters",
      doThis: "Write NORTH_STAR.md in the workspace: the target, the project that owns it, and what done looks like.",
      unlocks: "Everything else on this screen becomes measurable.",
      projectName: null,
      onTarget: true
    };
  }

  const open = gates.filter((gate) => gate.status !== "done");

  const inProgress = open.find((gate) => gate.status === "in_progress" && gate.nextAction);
  if (inProgress) {
    return gateAsOneThing(inProgress, open, targetProjectName, "Already underway — finish it before starting anything else.");
  }

  const ready = open.find(
    (gate) => gate.status === "open" && gate.clarification === "clarified" && gate.nextAction
  );
  if (ready) {
    return gateAsOneThing(ready, open, targetProjectName, null);
  }

  const decision = openReviews[0];
  if (decision) {
    return {
      kind: "decision",
      id: decision.slug ?? decision.id,
      title: decision.decision_needed,
      doThis: `Answer ${decision.slug ?? decision.id}: ${decision.decision_needed}`,
      unlocks:
        openReviews.length > 1
          ? `One of ${openReviews.length} answers ${targetProjectName ?? "the target"} is waiting on.`
          : `${targetProjectName ?? "The target"} cannot move until this is answered.`,
      projectName: targetProjectName,
      onTarget: true
    };
  }

  const needsClarity = open.find((gate) => gate.clarification !== "clarified");
  if (needsClarity) {
    return {
      kind: "clarify",
      id: needsClarity.workItemId,
      title: needsClarity.title,
      doThis: `Clarify "${needsClarity.title}" until it names one concrete next move.`,
      unlocks: `${remainingLine(open)} — this one has no defined next step, which is why it keeps getting skipped.`,
      projectName: targetProjectName,
      onTarget: true
    };
  }

  const anyOpen = open[0];
  if (anyOpen) {
    return gateAsOneThing(anyOpen, open, targetProjectName, null);
  }

  return {
    kind: "action",
    id: null,
    title: northStar.target,
    doThis: northStar.looksLike || `Confirm the target is reached: ${northStar.target}`,
    unlocks: "Every declared gate is done. Verify the finish line, then declare the next target.",
    projectName: targetProjectName,
    onTarget: true
  };
}

function gateAsOneThing(
  gate: ResolvedGate,
  open: ResolvedGate[],
  projectName: string | null,
  prefix: string | null
): TheOneThing {
  return {
    kind: "action",
    id: gate.workItemId,
    title: gate.title,
    doThis: gate.nextAction ?? gate.title,
    unlocks: prefix ? `${prefix} ${remainingLine(open)}.` : `${remainingLine(open)}.`,
    projectName,
    onTarget: true
  };
}

function remainingLine(open: ResolvedGate[]): string {
  const after = Math.max(0, open.length - 1);
  return after === 0 ? "The last gate between you and the target" : `${after} gate${after === 1 ? "" : "s"} left after this`;
}

/**
 * The escape hatch, and the reason it exists.
 *
 * On the days the main step feels too big, the operator does not stop working
 * — they go and do something easy in another Project. That impulse is not
 * going away and is not worth fighting; it is worth aiming. So the screen
 * always offers a second option that is genuinely small and still on target,
 * which converts a detour into progress. It is deliberately never a task from
 * a different Project.
 */
function selectFifteenMinutes(input: {
  openReviews: ReviewItemSummary[];
  gates: ResolvedGate[];
  chosen: TheOneThing;
  targetProjectName: string | null;
}): TheOneThing | null {
  const { openReviews, chosen, targetProjectName } = input;

  const decision = openReviews.find((item) => (item.slug ?? item.id) !== chosen.id);
  if (!decision) {
    return null;
  }

  return {
    kind: "decision",
    id: decision.slug ?? decision.id,
    title: decision.decision_needed,
    doThis: `Answer ${decision.slug ?? decision.id}: ${decision.decision_needed}`,
    unlocks: `${openReviews.length} answer${openReviews.length === 1 ? "" : "s"} owed — each one frees work already written.`,
    projectName: targetProjectName,
    onTarget: true
  };
}

// ---------------------------------------------------------------------------
// Attention and drift
// ---------------------------------------------------------------------------

function measureAttention(
  db: Database.Database,
  targetProjectId: string | null,
  windowDays: number,
  now: Date
): NowBrief["attention"] {
  const slices: AttentionSlice[] = [];
  let daysSinceTargetCommit: number | null = null;

  for (const project of listProjects(db)) {
    const repositoryPath = getProjectMetadata(db, project.id)?.repo_path ?? null;
    const activity = readRepositoryActivity(repositoryPath, windowDays);
    const isTarget = targetProjectId !== null && project.id === targetProjectId;
    if (isTarget) {
      daysSinceTargetCommit = daysSinceLastCommit(repositoryPath, now);
    }
    slices.push({
      projectName: project.name,
      projectSlug: project.slug ?? null,
      commits: activity.commits,
      share: 0,
      isTarget
    });
  }

  const totalCommits = slices.reduce((sum, slice) => sum + slice.commits, 0);
  for (const slice of slices) {
    slice.share = totalCommits === 0 ? 0 : slice.commits / totalCommits;
  }
  slices.sort((a, b) => b.commits - a.commits);

  return {
    windowDays,
    slices,
    targetShare: slices.find((slice) => slice.isTarget)?.share ?? 0,
    totalCommits,
    daysSinceTargetCommit
  };
}

/**
 * The drift line is written as an observation, never an accusation.
 *
 * Shame reliably increases avoidance rather than reducing it, so the sentence
 * states two facts — where the work went, and where it did not — and stops.
 * It never uses "should", and it never implies the other work was wasted,
 * because it usually was not.
 */
function describeDrift(attention: NowBrief["attention"], targetName: string | null): { level: DriftLevel; line: string } {
  if (!targetName || attention.totalCommits === 0) {
    return { level: "unknown", line: "No commits in the window, so there is nothing to measure yet." };
  }

  const share = Math.round(attention.targetShare * 100);
  const biggest = attention.slices[0];
  const elsewhere =
    biggest && !biggest.isTarget
      ? ` ${biggest.projectName} took ${Math.round(biggest.share * 100)}%.`
      : "";
  const stale =
    attention.daysSinceTargetCommit !== null && attention.daysSinceTargetCommit > 0
      ? ` ${targetName} last moved ${attention.daysSinceTargetCommit} day${attention.daysSinceTargetCommit === 1 ? "" : "s"} ago.`
      : "";

  const level: DriftLevel =
    attention.targetShare >= ON_TARGET_SHARE
      ? "on_target"
      : attention.targetShare >= DRIFTING_SHARE
        ? "drifting"
        : "off_target";

  const opening =
    level === "on_target"
      ? `${share}% of the last ${attention.windowDays} days went to ${targetName}. That is the target getting closer.`
      : level === "drifting"
        ? `${share}% of the last ${attention.windowDays} days went to ${targetName}.${elsewhere}`
        : `${share}% of the last ${attention.windowDays} days went to ${targetName}.${elsewhere} That work was real; the target did not move much.`;

  return { level, line: `${opening}${stale}`.trim() };
}
