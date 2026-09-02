import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import {
  getProjectMetadata,
  listAgentReviewFlaggedItems,
  listActionableReviewItems,
  listExecutionRuns,
  listProjects
} from "../db/repositories.js";
import { isDispatchable, resolveActionReadiness, resolveReadySet, type DispatchBlocker } from "../docs/dispatch.js";
import { discoverDocs } from "../docs/discover.js";
import type { PlanActionDoc, PlanDoc, ProjectDoc } from "../docs/types.js";
import type { ExecutionRunSummary, Project } from "../domain/types.js";
import { nowIso } from "../utils/time.js";
import { getSession, resolveProjectTransition } from "../sessions/index.js";
import { loadActionOrder, loadLatestApplicableActionOrderReceipt, type ActionOrderReceipt } from "./order.js";

export type AgentQueueEntryState = "ready" | "running" | "flagged" | "attention";

export type AgentQueueAttentionKind =
  | "document"
  | "repository"
  | "decision"
  | "packet"
  | "run"
  | "session"
  | "responsibility";

export interface AgentQueueBlocker {
  relativePath: string;
  field: string;
  message: string;
  remedy: string;
}

export interface AgentQueueEntry {
  id: string;
  state: AgentQueueEntryState;
  attentionKind: AgentQueueAttentionKind | null;
  selected: boolean;
  pointerAuthorized?: boolean;
  projectId: string | null;
  projectName: string | null;
  projectSlug: string | null;
  repositoryRoot: string | null;
  planSlug: string | null;
  planPath: string | null;
  actionId: string | null;
  actionTitle: string | null;
  responsibility: string | null;
  expectedArtifact: string | null;
  tokenImpact: string | null;
  tokenBudget: string | null;
  outcome?: string | null;
  milestone?: string | null;
  effort?: string | null;
  acceptanceCriteria?: string[];
  dependencies?: string[];
  decisions?: string[];
  status: string;
  reason: string;
  nextAction: string;
  blockers: AgentQueueBlocker[];
  runId: string | null;
  decisionId: string | null;
  updatedAt: string;
  orderKey?: string | null;
  position?: number | null;
  orderStatus?: "explicit" | "unpositioned" | "not_applicable";
}

export interface AgentQueue {
  generatedAt: string;
  revision: number;
  ordered: AgentQueueEntry[];
  nextActionKey: string | null;
  unpositionedCount: number;
  orderValid: boolean;
  undoReceipt: ActionOrderReceipt | null;
  ready: AgentQueueEntry[];
  running: AgentQueueEntry[];
  flagged: AgentQueueEntry[];
  attention: AgentQueueEntry[];
  counts: {
    ready: number;
    running: number;
    flagged: number;
    attention: number;
  };
}

export interface AgentQueueOptions {
  runLimit?: number;
  now?: Date;
}

interface PendingPacketRow {
  id: string;
  purpose: "planning" | "build";
  prompt_path: string;
  work_item_id: string | null;
  work_item_title: string | null;
  project_id: string | null;
  project_name: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Compose the one read-only view the feeder and operator both need:
 * document-ready Actions, active Runs, and every known stop that needs a
 * human or a repair before another Run can start.
 *
 * This deliberately does not create queue rows. Existing managed documents,
 * Decisions, packets, and Runs remain operational truth; this is their shared
 * projection. That keeps the first feeder slice observable and idempotent.
 */
export function buildAgentQueue(
  db: Database.Database,
  options: AgentQueueOptions = {}
): AgentQueue {
  const ready: AgentQueueEntry[] = [];
  const running: AgentQueueEntry[] = [];
  const flagged: AgentQueueEntry[] = [];
  const attention: AgentQueueEntry[] = [];
  const generatedAt = (options.now ?? new Date()).toISOString();

  for (const project of listProjects(db).filter((candidate) => candidate.status === "active")) {
    inspectProject(db, project, ready, running, attention);
  }

  const runs = listExecutionRuns(db, options.runLimit ?? 100);
  for (const run of runs) {
    if (run.status === "pending_execution" || run.status === "running") {
      running.push(runEntry(run));
    } else if (run.status === "failed" || run.status === "requires_review") {
      attention.push(runAttentionEntry(run));
    }
  }

  for (const decision of listActionableReviewItems(db)) {
    attention.push({
      id: `decision:${decision.id}`,
      state: "attention",
      attentionKind: "decision",
      selected: false,
      projectId: decision.project_id,
      projectName: decision.project_name,
      projectSlug: null,
      repositoryRoot: null,
      planSlug: null,
      planPath: null,
      actionId: decision.work_item_id,
      actionTitle: decision.work_item_title,
      responsibility: "requires_review",
      expectedArtifact: null,
      tokenImpact: null,
      tokenBudget: null,
      status: decision.status,
      reason: decision.decision_needed,
      nextAction: decision.recommendation ?? "Open the Decision and choose the appropriate resolution.",
      blockers: [],
      runId: null,
      decisionId: decision.id,
      updatedAt: decision.updated_at
    });
  }

  for (const decision of listAgentReviewFlaggedItems(db)) {
    flagged.push({
      id: `agent-review:${decision.id}`,
      state: "flagged",
      attentionKind: "decision",
      selected: false,
      projectId: decision.project_id,
      projectName: decision.project_name,
      projectSlug: null,
      repositoryRoot: null,
      planSlug: null,
      planPath: null,
      actionId: decision.work_item_id,
      actionTitle: decision.work_item_title,
      responsibility: "codex",
      expectedArtifact: "Coding-agent applicability assessment",
      tokenImpact: null,
      tokenBudget: null,
      status: "agent_review_flagged",
      reason: decision.decision_needed,
      nextAction: "Start a coding-agent applicability review when this question becomes a priority.",
      blockers: [],
      runId: null,
      decisionId: decision.id,
      updatedAt: decision.updated_at
    });
  }

  for (const packet of listPendingPackets(db)) {
    attention.push({
      id: `packet:${packet.id}`,
      state: "attention",
      attentionKind: "packet",
      selected: false,
      projectId: packet.project_id,
      projectName: packet.project_name,
      projectSlug: null,
      repositoryRoot: null,
      planSlug: null,
      planPath: null,
      actionId: packet.work_item_id,
      actionTitle: packet.work_item_title,
      responsibility: "codex",
      expectedArtifact: null,
      tokenImpact: null,
      tokenBudget: null,
      status: "packet_created",
      reason: `Coding-agent ${packet.purpose} packet is waiting before execution.`,
      nextAction: `Open ${packet.prompt_path} and resolve the packet's Decision before running it.`,
      blockers: [],
      runId: null,
      decisionId: null,
      updatedAt: packet.updated_at || packet.created_at
    });
  }

  const order = loadActionOrder(db);
  const actionEntries = dedupeActionEntries([...running, ...ready, ...attention]);
  for (const entry of [...ready, ...running, ...flagged, ...attention]) {
    const orderKey = entry.projectSlug && entry.actionId ? `${entry.projectSlug}/${entry.actionId}` : null;
    entry.orderKey = orderKey;
    entry.position = orderKey ? order.positions.get(orderKey) ?? null : null;
    entry.orderStatus = orderKey ? (entry.position === null ? "unpositioned" : "explicit") : "not_applicable";
  }
  const discoveredPosition = new Map(actionEntries.map((entry, index) => [`${entry.projectSlug}/${entry.actionId}`, index]));
  const ordered = actionEntries.sort((left, right) =>
    compareOptionalPosition(left.position ?? null, right.position ?? null) ||
    (discoveredPosition.get(`${left.projectSlug}/${left.actionId}`) ?? 0) - (discoveredPosition.get(`${right.projectSlug}/${right.actionId}`) ?? 0) ||
    left.id.localeCompare(right.id)
  );
  const unpositionedCount = ordered.filter((entry) => entry.orderStatus === "unpositioned").length;
  const orderValid = unpositionedCount === 0;
  const nextActionKey = orderValid
    ? ordered.find((entry) => entry.state === "ready" && entry.pointerAuthorized)?.orderKey ?? null
    : null;
  const sortEntries = (left: AgentQueueEntry, right: AgentQueueEntry): number =>
    compareOptionalPosition(left.position ?? null, right.position ?? null) || Number(right.selected) - Number(left.selected) ||
    right.updatedAt.localeCompare(left.updatedAt) ||
    left.id.localeCompare(right.id);

  ready.sort(sortEntries);
  running.sort(sortEntries);
  flagged.sort(sortEntries);
  attention.sort(sortEntries);

  return {
    generatedAt,
    revision: order.revision,
    ordered,
    nextActionKey,
    unpositionedCount,
    orderValid,
    undoReceipt: loadLatestApplicableActionOrderReceipt(db, order.revision),
    ready,
    running,
    flagged,
    attention,
    counts: {
      ready: ready.length,
      running: running.length,
      flagged: flagged.length,
      attention: attention.length
    }
  };
}

function dedupeActionEntries(entries: AgentQueueEntry[]): AgentQueueEntry[] {
  const byKey = new Map<string, AgentQueueEntry>();
  for (const entry of entries) {
    if (!entry.projectSlug || !entry.actionId) continue;
    const key = `${entry.projectSlug}/${entry.actionId}`;
    if (!byKey.has(key)) byKey.set(key, entry);
  }
  return [...byKey.values()];
}

function compareOptionalPosition(left: number | null, right: number | null): number {
  if (left !== null && right !== null) return left - right;
  if (left !== null) return -1;
  if (right !== null) return 1;
  return 0;
}

function inspectProject(
  db: Database.Database,
  project: Project,
  ready: AgentQueueEntry[],
  running: AgentQueueEntry[],
  attention: AgentQueueEntry[]
): void {
  const metadata = getProjectMetadata(db, project.id);
  const configuredPath = metadata?.repo_path?.trim() ?? null;

  if (!configuredPath) {
    attention.push(repositoryAttention(project, null, "Project has no repository path configured.", "Set the Project repository path before dispatching an Action."));
    return;
  }

  const repositoryRoot = path.resolve(configuredPath);
  try {
    if (!existsSync(repositoryRoot) || !statSync(repositoryRoot).isDirectory()) {
      attention.push(repositoryAttention(
        project,
        repositoryRoot,
        "Project repository path is missing or not a directory.",
        "Repair the Project repository path before dispatching an Action."
      ));
      return;
    }

    const resolvedRoot = realpathSync(repositoryRoot);
    const transition = resolveProjectTransition({ repoRoot: resolvedRoot, projectSlug: project.slug, db });
    const dispatch = transition.dispatch;
    const readySet = resolveReadySet(resolvedRoot, project.slug);
    const discovered = discoverDocs(resolvedRoot);
    const projectDoc = discovered.docs.find(
      (doc): doc is ProjectDoc => doc.type === "project" && doc.slug === project.slug
    ) ?? null;
    const activePlan = discovered.docs.find(
      (doc): doc is PlanDoc => doc.type === "plan" && doc.slug === readySet.planSlug && doc.project === project.slug
    ) ?? null;
    let activeSessionActionId: string | null = null;

    if (transition.sessionId) {
      const session = getSession(db, transition.sessionId);
      activeSessionActionId = session?.action_id ?? dispatch.context?.action.id ?? null;
      const entry: AgentQueueEntry = {
        id: `session:${transition.sessionId}`,
        state: transition.kind === "wait" ? "running" : "attention",
        attentionKind: "session",
        selected: true,
        projectId: project.id,
        projectName: project.name,
        projectSlug: project.slug,
        repositoryRoot: resolvedRoot,
        planSlug: session?.plan_slug ?? dispatch.context?.activePlan ?? null,
        planPath: session?.plan_path ?? dispatch.context?.planPath ?? null,
        actionId: activeSessionActionId,
        actionTitle: dispatch.context?.action.title ?? null,
        responsibility: dispatch.context?.action.responsibility ?? "codex",
        expectedArtifact: dispatch.context?.action.expectedArtifact ?? null,
        tokenImpact: dispatch.context?.planTokenImpact ?? null,
        tokenBudget: dispatch.context?.planTokenBudget ?? null,
        ...actionContext(projectDoc, activePlan, dispatch.context?.action ?? null),
        status: session?.status ?? transition.kind,
        reason: transition.reason,
        nextAction: transition.nextAction,
        blockers: [],
        runId: null,
        decisionId: null,
        updatedAt: session?.updated_at ?? project.updated_at
      };
      (transition.kind === "wait" ? running : attention).push(entry);
    }

    if (readySet.blockers.length > 0) {
      attention.push(documentAttention(
        project,
        resolvedRoot,
        null,
        readySet.planSlug,
        readySet.planPath,
        readySet.blockers,
        "Repair the managed document blockers before Arcadia can feed an Action."
      ));
      return;
    }

    for (const candidate of readySet.ready) {
      if (candidate.actionId === activeSessionActionId) continue;
      const action = activePlan?.actions.find((entry) => entry.id === candidate.actionId) ?? null;
      const pointerAuthorized = dispatch.context?.action.id === candidate.actionId && isDispatchable(dispatch);
      ready.push({
        id: `ready:${project.id}:${candidate.actionId}`,
        state: "ready",
        attentionKind: null,
        selected: pointerAuthorized,
        pointerAuthorized,
        projectId: project.id,
        projectName: project.name,
        projectSlug: project.slug,
        repositoryRoot: resolvedRoot,
        planSlug: readySet.planSlug,
        planPath: readySet.planPath,
        actionId: candidate.actionId,
        actionTitle: candidate.title,
        responsibility: candidate.responsibility,
        expectedArtifact: action?.expectedArtifact ?? null,
        tokenImpact: readySet.planTokenImpact,
        tokenBudget: readySet.planTokenBudget,
        ...actionContext(projectDoc, activePlan, action),
        status: "ready",
        reason: pointerAuthorized
          ? "The checked-in Project pointer authorizes this ready Action."
          : "Action is ready but waiting_for_pointer; queue order alone does not authorize dispatch.",
        nextAction: action?.nextAction ?? `Prepare the plan for ${candidate.title}.`,
        blockers: [],
        runId: null,
        decisionId: null,
        updatedAt: readySet.planPath ? project.updated_at : nowIso()
      });
    }

    const readyIds = new Set(readySet.ready.map((candidate) => candidate.actionId));
    for (const action of activePlan?.actions.filter((candidate) => candidate.status !== "done") ?? []) {
      if (readyIds.has(action.id) || action.id === activeSessionActionId) continue;
      const readiness = resolveActionReadiness(resolvedRoot, project.slug, action.id);
      const responsibilityReason = action.responsibility === "requires_review"
        ? "Action requires operator review and remains ordered but ineligible."
        : action.responsibility === "blocked"
          ? "Action is externally blocked and remains ordered but ineligible."
          : readiness.operatorQuestion
            ? "Action has an open clarification question and remains ordered but ineligible."
            : readiness.blockers[0]?.message ?? "Action is not yet eligible for dispatch.";
      const nextAction = readiness.operatorQuestion
        ? readiness.operatorQuestion
        : readiness.blockers[0]?.remedy
          ?? action.nextAction
          ?? "Resolve the Action's eligibility before dispatching it.";
      attention.push({
        id: `action:${project.id}:${action.id}`,
        state: "attention",
        attentionKind: action.responsibility === "requires_review" || action.responsibility === "blocked" ? "responsibility" : "document",
        selected: dispatch.context?.action.id === action.id,
        pointerAuthorized: false,
        projectId: project.id,
        projectName: project.name,
        projectSlug: project.slug,
        repositoryRoot: resolvedRoot,
        planSlug: activePlan?.slug ?? readySet.planSlug,
        planPath: activePlan?.relativePath ?? readySet.planPath,
        actionId: action.id,
        actionTitle: action.title,
        responsibility: action.responsibility,
        expectedArtifact: action.expectedArtifact,
        tokenImpact: activePlan?.tokenImpact ?? readySet.planTokenImpact,
        tokenBudget: activePlan?.tokenBudget ?? readySet.planTokenBudget,
        ...actionContext(projectDoc, activePlan, action),
        status: action.status,
        reason: responsibilityReason,
        nextAction,
        blockers: dedupeBlockers(readiness.blockers),
        runId: null,
        decisionId: null,
        updatedAt: project.updated_at
      });
    }

    if (!isDispatchable(dispatch)) {
      const context = dispatch.context;
      const blockers = dispatch.blockers;
      const reason = transition.reason;
      const nextAction = transition.nextAction;

      if (!context?.action.id || ![...running, ...attention].some(
        (entry) => entry.projectId === project.id && entry.actionId === context.action.id
      )) {
        attention.push(documentAttention(
          project,
          resolvedRoot,
          context?.action.id ?? null,
          context?.activePlan ?? readySet.planSlug,
          context?.planPath ?? readySet.planPath,
          blockers,
          nextAction,
          reason,
          context?.action.title ?? null,
          context?.action.responsibility === "requires_review" || context?.action.responsibility === "blocked"
            ? "responsibility"
            : "document",
          context?.planTokenImpact ?? readySet.planTokenImpact,
          context?.planTokenBudget ?? readySet.planTokenBudget,
        ));
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    attention.push(documentAttention(
      project,
      repositoryRoot,
      null,
      null,
      null,
      [{
        relativePath: "repository",
        field: "dispatch",
        message,
        remedy: "Repair the repository's managed documents before dispatching an Action."
      }],
      "Repair the repository's managed documents before dispatching an Action."
    ));
  }
}

function actionContext(project: ProjectDoc | null, plan: PlanDoc | null, action: PlanActionDoc | null): Pick<
  AgentQueueEntry,
  "outcome" | "milestone" | "effort" | "acceptanceCriteria" | "dependencies" | "decisions"
> {
  return {
    outcome: project?.outcome ?? project?.goal ?? null,
    milestone: action?.milestone ?? plan?.milestone ?? project?.milestone ?? null,
    effort: action?.effort ?? null,
    acceptanceCriteria: action?.acceptanceCriteria ?? [],
    dependencies: action?.dependsOn ?? [],
    decisions: action?.decisions ?? []
  };
}

function repositoryAttention(
  project: Project,
  repositoryRoot: string | null,
  message: string,
  remedy: string
): AgentQueueEntry {
  return {
    id: `repository:${project.id}`,
    state: "attention",
    attentionKind: "repository",
    selected: false,
    projectId: project.id,
    projectName: project.name,
    projectSlug: project.slug,
    repositoryRoot,
    planSlug: null,
    planPath: null,
    actionId: null,
    actionTitle: null,
    responsibility: null,
    expectedArtifact: null,
    tokenImpact: null,
    tokenBudget: null,
    status: "blocked",
    reason: message,
    nextAction: remedy,
    blockers: [{ relativePath: "project_metadata", field: "repo_path", message, remedy }],
    runId: null,
    decisionId: null,
    updatedAt: project.updated_at
  };
}

function documentAttention(
  project: Project,
  repositoryRoot: string,
  actionId: string | null,
  planSlug: string | null,
  planPath: string | null,
  rawBlockers: DispatchBlocker[],
  nextAction: string,
  reason?: string,
  actionTitle?: string | null,
  attentionKind: AgentQueueAttentionKind = "document",
  tokenImpact: string | null = null,
  tokenBudget: string | null = null
): AgentQueueEntry {
  const blockers = dedupeBlockers(rawBlockers);
  return {
    id: `document:${project.id}:${actionId ?? planSlug ?? "project"}`,
    state: "attention",
    attentionKind,
    selected: false,
    projectId: project.id,
    projectName: project.name,
    projectSlug: project.slug,
    repositoryRoot,
    planSlug,
    planPath,
    actionId,
    actionTitle: actionTitle ?? actionId,
    responsibility: null,
    expectedArtifact: null,
    tokenImpact,
    tokenBudget,
    status: "blocked",
    reason: reason ?? blockers[0]?.message ?? "Managed documents need attention before dispatch.",
    nextAction,
    blockers,
    runId: null,
    decisionId: null,
    updatedAt: project.updated_at
  };
}

function runEntry(run: ExecutionRunSummary): AgentQueueEntry {
  return {
    id: `run:${run.id}`,
    state: "running",
    attentionKind: null,
    selected: false,
    projectId: run.project_id,
    projectName: run.project_name,
    projectSlug: null,
    repositoryRoot: null,
    planSlug: null,
    planPath: null,
    actionId: run.work_item_id,
    actionTitle: run.work_item_title,
    responsibility: run.executor_name,
    expectedArtifact: null,
    tokenImpact: null,
    tokenBudget: null,
    status: run.status,
    reason: run.status === "pending_execution" ? "Run is queued for the worker." : "Run is in progress.",
    nextAction: "Wait for the Run to finish, then inspect Validation and the resulting Artifact.",
    blockers: [],
    runId: run.id,
    decisionId: run.review_item_id,
    updatedAt: run.updated_at
  };
}

function runAttentionEntry(run: ExecutionRunSummary): AgentQueueEntry {
  return {
    ...runEntry(run),
    state: "attention",
    attentionKind: "run",
    reason: run.status === "failed" ? "Run failed." : "Run requires review before continuation.",
    nextAction: run.status === "failed"
      ? "Inspect the Run evidence and decide whether to repair, retry, or change the Action."
      : "Inspect the Run evidence and resolve its Decision before continuation."
  };
}

function dedupeBlockers(blockers: DispatchBlocker[]): AgentQueueBlocker[] {
  const seen = new Set<string>();
  return blockers.filter((blocker) => {
    const key = `${blocker.relativePath}:${blocker.field}:${blocker.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function listPendingPackets(db: Database.Database): PendingPacketRow[] {
  return db.prepare(
    `SELECT
       ci.id,
       ci.purpose,
       ci.prompt_path,
       ci.work_item_id,
       wi.title AS work_item_title,
       p.id AS project_id,
       p.name AS project_name,
       ci.created_at,
       ci.updated_at
     FROM codex_invocations ci
     LEFT JOIN work_items wi ON wi.id = ci.work_item_id
     LEFT JOIN projects p ON p.id = wi.project_id
     WHERE ci.status = 'packet_created'
       AND NOT EXISTS (
         SELECT 1 FROM review_items ri
         WHERE ri.codex_invocation_id = ci.id
           AND ri.resolved_intent IN ('CodexPlanningRunApproval', 'CodexPlanningRetryApproval')
       )
     ORDER BY ci.updated_at DESC, ci.created_at DESC`
  ).all() as PendingPacketRow[];
}
