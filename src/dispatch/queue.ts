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
import { isDispatchable, resolveReadySet, type DispatchBlocker } from "../docs/dispatch.js";
import type { ExecutionRunSummary, Project } from "../domain/types.js";
import { nowIso } from "../utils/time.js";
import { getSession, resolveProjectTransition } from "../sessions/index.js";

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
  status: string;
  reason: string;
  nextAction: string;
  blockers: AgentQueueBlocker[];
  runId: string | null;
  decisionId: string | null;
  updatedAt: string;
}

export interface AgentQueue {
  generatedAt: string;
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

  const sortEntries = (left: AgentQueueEntry, right: AgentQueueEntry): number =>
    Number(right.selected) - Number(left.selected) ||
    right.updatedAt.localeCompare(left.updatedAt) ||
    left.id.localeCompare(right.id);

  ready.sort(sortEntries);
  running.sort(sortEntries);
  flagged.sort(sortEntries);
  attention.sort(sortEntries);

  return {
    generatedAt,
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

    if (transition.sessionId) {
      const session = getSession(db, transition.sessionId);
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
        actionId: session?.action_id ?? dispatch.context?.action.id ?? null,
        actionTitle: dispatch.context?.action.title ?? null,
        responsibility: dispatch.context?.action.responsibility ?? "codex",
        expectedArtifact: dispatch.context?.action.expectedArtifact ?? null,
        tokenImpact: dispatch.context?.planTokenImpact ?? null,
        tokenBudget: dispatch.context?.planTokenBudget ?? null,
        status: session?.status ?? transition.kind,
        reason: transition.reason,
        nextAction: transition.nextAction,
        blockers: [],
        runId: null,
        decisionId: null,
        updatedAt: session?.updated_at ?? project.updated_at
      };
      (transition.kind === "wait" ? running : attention).push(entry);
      return;
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
      const action = dispatch.context?.action.id === candidate.actionId
        ? dispatch.context.action
        : null;
      ready.push({
        id: `ready:${project.id}:${candidate.actionId}`,
        state: "ready",
        attentionKind: null,
        selected: candidate.actionId === readySet.suggestedCurrentAction,
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
        status: "ready",
        reason: candidate.actionId === readySet.suggestedCurrentAction
          ? "Selected current Action is ready for a coding agent."
          : "Action is ready by its plan and waiting behind the selected current Action.",
        nextAction: action?.nextAction ?? `Prepare the plan for ${candidate.title}.`,
        blockers: [],
        runId: null,
        decisionId: null,
        updatedAt: readySet.planPath ? project.updated_at : nowIso()
      });
    }

    if (!isDispatchable(dispatch)) {
      const context = dispatch.context;
      const blockers = dispatch.blockers;
      const reason = transition.reason;
      const nextAction = transition.nextAction;

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
