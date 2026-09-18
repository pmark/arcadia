import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { createReviewItem, getProjectBySlug } from "../db/repositories.js";
import { appendPlanAction } from "../ask/settlement.js";
import { syncProjectDocs } from "../docs/sync.js";
import { assertClean, commitOnlyPaths } from "../git/worktrees.js";
import { slugify } from "../utils/slug.js";
import { TIER_RANK } from "./order.js";
import { buildProjectSchedule, writeProjectOrder, type ProjectSchedule } from "./schedule.js";
import {
  actionKeyOf,
  getSchedulingAction,
  listSchedulingActions,
  parseActionKey,
  recordSchedulingLog,
  replaySchedulingResult,
  upsertSchedulingAction
} from "./store.js";

/**
 * What a coding Run does when it finds work it was not sent to do.
 *
 * A **blocker** stops the current Action from validating: it is written into
 * the active Plan, the current Action is made to depend on it, and it takes the
 * current Action's place at the head of the queue. A **corrective** does not
 * stop the current Action but the Milestone cannot validate without it: it is
 * written into the Plan and queued ahead of remaining planned work, in
 * discovery order behind any earlier corrective. A **follow-up** is recorded
 * in the Plan as backlog and touches the queue not at all.
 *
 * Three fixed limits keep automatic discovery from expanding forever. Crossing
 * one records the discovery as an operator Decision instead of an Action, and
 * the queue is left alone.
 */

export type DiscoveryKind = "blocker" | "corrective" | "follow_up";

export const DISCOVERY_LIMITS = {
  maxDepth: 2,
  maxCorrectiveDescendantsPerRoot: 3,
  maxCorrectivesPerMilestone: 8
} as const;

export interface DiscoveryInput {
  originActionKey: string;
  kind: DiscoveryKind;
  title: string;
  acceptance: string[];
  requestId: string;
  /** Free text preserved as the Action's source. */
  evidence?: string;
}

export interface DiscoveryResult {
  outcome: "queued" | "backlogged" | "needs_operator";
  kind: DiscoveryKind;
  originActionKey: string;
  actionKey: string | null;
  actionId: string | null;
  planPath: string | null;
  decisionId: string | null;
  reason: string;
  queueBefore: string[];
  queueAfter: string[];
  commitError: string | null;
}

export function recordDiscovery(db: Database.Database, input: DiscoveryInput): DiscoveryResult {
  const replay = replaySchedulingResult<DiscoveryResult>(db, input.requestId);
  if (replay) return replay;

  const origin = parseActionKey(input.originActionKey);
  if (!origin) throw validationError("Discovery origin must be a <project>/<action> key.", { originActionKey: input.originActionKey });
  const title = input.title.trim();
  if (!title) throw validationError("Discovery needs a title.");
  if (input.kind !== "follow_up" && input.acceptance.filter((criterion) => criterion.trim()).length === 0) {
    throw validationError("A blocker or corrective needs at least one acceptance criterion so its completion is observable.");
  }
  const project = getProjectBySlug(db, origin.projectSlug);
  if (!project) throw validationError("Discovery origin names an unknown Project.", { projectSlug: origin.projectSlug });
  const schedule = buildProjectSchedule(db, project);
  if (schedule.blockers.length > 0 || !schedule.repositoryRoot || !schedule.planPath || !schedule.planSlug) {
    throw validationError("The origin Project cannot be scheduled.", { blockers: schedule.blockers });
  }
  const originAction = schedule.actions.find((action) => action.actionId === origin.actionId);
  if (!originAction) throw validationError("Discovery origin is not an Action in the active Plan.", { originActionKey: input.originActionKey });

  const breaker = input.kind === "follow_up" ? null : circuitBreaker(db, schedule, originAction.key);
  if (breaker) {
    const decision = createReviewItem(db, {
      projectId: project.id,
      decisionNeeded: `Discovery circuit breaker: ${breaker}`,
      recommendation: `Decide whether "${title}" (a ${input.kind} discovered by ${input.originActionKey}) should become a governed Action, and whether the discovery branch under it should continue.`,
      sourceInput: input.evidence ?? title,
      proposedAction: `Record "${title}" as a ${input.kind} of ${input.originActionKey} with acceptance: ${input.acceptance.join("; ") || "none"}`,
      resolvedIntent: "SchedulingCircuitBreaker",
      confidenceLabel: "high",
      confidence: 1,
      context: { schemaVersion: 1, originActionKey: input.originActionKey, kind: input.kind, title, acceptance: input.acceptance }
    });
    const result: DiscoveryResult = {
      outcome: "needs_operator",
      kind: input.kind,
      originActionKey: input.originActionKey,
      actionKey: null,
      actionId: null,
      planPath: schedule.planPath,
      decisionId: decision.id,
      reason: breaker,
      queueBefore: schedule.queue,
      queueAfter: schedule.queue,
      commitError: null
    };
    recordSchedulingLog(db, {
      projectSlug: project.slug,
      actionKey: input.originActionKey,
      source: "coding_run",
      reason: `Discovery of ${input.kind} "${title}" stopped by circuit breaker: ${breaker} Decision ${decision.id} opened; queue unchanged.`,
      requestId: input.requestId,
      result
    });
    return result;
  }

  const actionId = uniqueActionId(schedule, title);
  const actionKey = actionKeyOf(project.slug, actionId);
  const absolutePlanPath = path.join(schedule.repositoryRoot, schedule.planPath);
  assertClean(schedule.repositoryRoot, "Project repository");
  const before = readFileSync(absolutePlanPath, "utf8");
  let after = appendPlanAction(before, {
    id: actionId,
    title,
    responsibility: "agent",
    acceptance: input.acceptance.length > 0 ? input.acceptance : [`${title} is recorded and triaged.`],
    dependencies: [],
    references: [],
    source: `Discovered as ${input.kind} by ${input.originActionKey}${input.evidence ? `: ${input.evidence}` : ""}`
  });
  if (input.kind === "blocker") after = addDependency(after, origin.actionId, actionId);
  writeFileSync(absolutePlanPath, after, "utf8");

  let sync;
  try {
    sync = syncProjectDocs(db, project, { apply: true, repoRoot: schedule.repositoryRoot });
  } catch (error) {
    writeFileSync(absolutePlanPath, before, "utf8");
    throw error;
  }
  if (sync.errors.length > 0) {
    writeFileSync(absolutePlanPath, before, "utf8");
    throw validationError("The discovered Action could not be written into the Plan.", { errors: sync.errors });
  }
  const commitError = commitOnlyPaths(schedule.repositoryRoot, [schedule.planPath], [
    `chore(arcadia): record ${input.kind} ${actionId}`,
    "",
    `Discovered by ${input.originActionKey} (${input.requestId}).`
  ].join("\n"));

  const originRow = getSchedulingAction(db, originAction.key);
  upsertSchedulingAction(db, actionKey, {
    schedulingClass: input.kind,
    discoveredByActionKey: originAction.key,
    discoveryDepth: (originRow?.discoveryDepth ?? 0) + 1
  });

  const refreshed = buildProjectSchedule(db, project);
  let queueAfter = refreshed.queue;
  if (input.kind !== "follow_up") {
    const desired = placeDiscovered(refreshed, actionKey, originAction.key, input.kind);
    const write = writeProjectOrder(db, project.slug, desired, {
      requestId: `${input.requestId}:order`,
      source: "coding_run",
      actionKey,
      reason: input.kind === "blocker"
        ? `Blocker ${actionKey} inserted ahead of ${originAction.key}, which now depends on it.`
        : `Corrective ${actionKey} inserted ahead of remaining planned work after the current Run.`
    });
    queueAfter = write.after;
  }

  const result: DiscoveryResult = {
    outcome: input.kind === "follow_up" ? "backlogged" : "queued",
    kind: input.kind,
    originActionKey: input.originActionKey,
    actionKey,
    actionId,
    planPath: schedule.planPath,
    decisionId: null,
    reason: input.kind === "follow_up"
      ? "Follow-up recorded in the Plan as backlog; the active queue is unchanged."
      : input.kind === "blocker"
        ? "Blocker recorded; the origin Action is blocked until it completes."
        : "Corrective recorded and queued ahead of remaining planned work.",
    queueBefore: schedule.queue,
    queueAfter,
    commitError
  };
  recordSchedulingLog(db, {
    projectSlug: project.slug,
    actionKey,
    source: "coding_run",
    reason: `${capitalize(input.kind)} "${title}" discovered by ${input.originActionKey}: ${result.reason}`,
    previous: { queue: schedule.queue },
    next: { queue: queueAfter },
    requestId: input.requestId,
    result
  });
  return result;
}

function circuitBreaker(db: Database.Database, schedule: ProjectSchedule, originKey: string): string | null {
  const rows = listSchedulingActions(db, schedule.projectSlug);
  const byKey = new Map(rows.map((row) => [row.actionKey, row]));
  const originDepth = byKey.get(originKey)?.discoveryDepth ?? 0;
  if (originDepth + 1 > DISCOVERY_LIMITS.maxDepth) {
    return `discovery depth would reach ${originDepth + 1}, above the limit of ${DISCOVERY_LIMITS.maxDepth}.`;
  }
  let root = originKey;
  const seen = new Set<string>();
  while (byKey.get(root)?.discoveredByActionKey && !seen.has(root)) {
    seen.add(root);
    root = byKey.get(root)!.discoveredByActionKey!;
  }
  const descendants = rows.filter((row) => row.schedulingClass === "corrective" && rootOf(byKey, row.actionKey) === root).length;
  if (descendants + 1 > DISCOVERY_LIMITS.maxCorrectiveDescendantsPerRoot) {
    return `root Action ${root} already has ${descendants} discovered corrective descendant(s), the limit of ${DISCOVERY_LIMITS.maxCorrectiveDescendantsPerRoot}.`;
  }
  const activeKeys = new Set(schedule.actions.map((action) => action.key));
  const correctives = rows.filter((row) => row.schedulingClass === "corrective" && activeKeys.has(row.actionKey)).length;
  if (correctives + 1 > DISCOVERY_LIMITS.maxCorrectivesPerMilestone) {
    return `the active Milestone already carries ${correctives} discovered corrective Action(s), the limit of ${DISCOVERY_LIMITS.maxCorrectivesPerMilestone}.`;
  }
  return null;
}

function rootOf(byKey: Map<string, { discoveredByActionKey: string | null }>, key: string): string {
  let cursor = key;
  const seen = new Set<string>();
  while (byKey.get(cursor)?.discoveredByActionKey && !seen.has(cursor)) {
    seen.add(cursor);
    cursor = byKey.get(cursor)!.discoveredByActionKey!;
  }
  return cursor;
}

/**
 * The Project order after inserting a discovered Action. A blocker takes the
 * origin's slot so it precedes it; a corrective goes behind every earlier
 * blocker/corrective (FIFO) and ahead of the first planned Action. The
 * canonical rule then settles tiers and dependencies on top.
 */
function placeDiscovered(schedule: ProjectSchedule, actionKey: string, originKey: string, kind: "blocker" | "corrective"): string[] {
  const byKey = new Map(schedule.actions.map((action) => [action.key, action]));
  const queue = schedule.queue.filter((key) => key !== actionKey);
  if (kind === "blocker") {
    const originIndex = queue.indexOf(originKey);
    const insertAt = originIndex < 0 ? 0 : originIndex;
    return [...queue.slice(0, insertAt), actionKey, ...queue.slice(insertAt)];
  }
  const firstPlanned = queue.findIndex((key) => TIER_RANK[byKey.get(key)?.schedulingClass ?? "planned"] >= TIER_RANK.planned);
  const insertAt = firstPlanned < 0 ? queue.length : firstPlanned;
  return [...queue.slice(0, insertAt), actionKey, ...queue.slice(insertAt)];
}

function uniqueActionId(schedule: ProjectSchedule, title: string): string {
  const taken = new Set(schedule.actions.map((action) => action.actionId));
  const words = title.split(/[.;:!?]|,\s/)[0].split(/\s+/).slice(0, 6).join(" ");
  const base = slugify(words).slice(0, 48).replace(/-+$/, "") || "discovered-action";
  if (!taken.has(base)) return base;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base.slice(0, 48 - `-${index}`.length)}-${index}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw validationError("Could not allocate a unique Action id for the discovery.");
}

function addDependency(content: string, actionId: string, dependencyId: string): string {
  const pattern = new RegExp(`(^  - id: ${escapeRegex(actionId)}\\r?$[\\s\\S]*?)(?=^  - id: |^---\\r?$)`, "m");
  const match = content.match(pattern);
  if (!match) throw validationError("Origin Action block was not found in the Plan.", { actionId });
  let block = match[1];
  const inline = /^ {4}depends_on:[ \t]*\[([^\]]*)\][ \t]*$/m.exec(block);
  const blockList = /^ {4}depends_on:[ \t]*\r?\n((?: {6}- .*\r?\n?)*)/m.exec(block);
  let existing: string[] = [];
  if (inline) existing = inline[1].split(",").map((value) => value.trim()).filter(Boolean);
  else if (blockList) existing = blockList[1].split(/\r?\n/).map((line) => line.replace(/^ {6}- /, "").trim()).filter(Boolean);
  const next = [...new Set([...existing, dependencyId])];
  const replacement = `    depends_on: [${next.join(", ")}]`;
  if (inline) block = block.replace(inline[0], replacement);
  else if (blockList) block = block.replace(blockList[0], `${replacement}\n`);
  else if (/^ {4}depends_on:.*$/m.test(block)) block = block.replace(/^ {4}depends_on:.*$/m, replacement);
  else block = block.replace(/^ {4}acceptance_criteria:\r?\n(?: {6}- .*\r?\n?)*/m, (found) => `${found.replace(/\r?\n$/, "")}\n${replacement}\n`);
  if (!block.includes(replacement)) throw validationError("Origin Action has no depends_on field to amend.", { actionId });
  return content.replace(pattern, block);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function capitalize(value: string): string {
  return value.replace(/_/g, "-").replace(/^./, (letter) => letter.toUpperCase());
}
