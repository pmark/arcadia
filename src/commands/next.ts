import { projectNotFound, validationError } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import { getProject, getProjectBySlug, getProjectMetadata, listBackBurnerItems, listProjects } from "../db/repositories.js";
import {
  isDispatchable,
  resolveDispatch,
  resolveReadySet,
  type DispatchResolution,
  type ReadySetResolution
} from "../docs/dispatch.js";
import {
  listDispatchEvents,
  recordDispatchEvent,
  summarizeDispatchEvents,
  type DispatchEvent,
  type DispatchJournalSummary
} from "../docs/journal.js";

export interface NextCommandOptions {
  workspace: string;
  /** Project id or slug. Omitted means the single active Project, if there is one. */
  project?: string;
}

export interface NextCommandData extends DispatchResolution {
  dispatchable: boolean;
  projectId: string;
  repoRoot: string;
  firedBackBurnerCount?: number;
}

/**
 * Resolve the authoritative work pointer: the one action a dispatched agent
 * should advance.
 *
 * This is the continuation contract's startup procedure as a command. It exists
 * so "Get to work" has a single, checkable answer instead of being inferred
 * from commits, an ordered backlog, or whichever task looks easiest — the four
 * things the contract explicitly forbids reading priority from.
 */
export function runNextCommand(options: NextCommandOptions): CommandSuccess<NextCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const { project, repoRoot, firedBackBurnerCount } = withDatabase(workspacePath, (db) => {
    const resolved = resolveProjectAndRepo(db, options);
    return {
      ...resolved,
      firedBackBurnerCount: listBackBurnerItems(db, "opportunistic", { fired: true })
        .filter((item) => item.project_id === null || item.project_id === resolved.project.id).length
    };
  });

  const resolution = resolveDispatch(repoRoot, project.slug);
  const dispatchable = isDispatchable(resolution);

  withDatabase(workspacePath, (db) =>
    recordDispatchEvent(db, {
      command: "next",
      projectId: project.id,
      projectSlug: project.slug,
      planSlug: resolution.context?.activePlan ?? null,
      actionId: resolution.context?.action.id ?? null,
      dispatchable,
      blockers: resolution.blockers,
      operatorQuestion: resolution.operatorQuestion
    })
  );

  return createSuccess({
    command: "next",
    workspace: workspacePath,
    data: {
      ...resolution,
      dispatchable,
      projectId: project.id,
      repoRoot,
      ...(firedBackBurnerCount > 0 ? { firedBackBurnerCount } : {})
    }
  });
}

function pickSoleActiveProject(db: Parameters<typeof listProjects>[0]) {
  const active = listProjects(db).filter((project) => project.status === "active");
  return active.length === 1 ? active[0] : null;
}

/**
 * The Project and repository both `next` and `next --ready` resolve from,
 * shared so the two commands can never disagree about which repository they
 * are reading documents from.
 */
function resolveProjectAndRepo(db: Parameters<typeof listProjects>[0], options: NextCommandOptions) {
  const resolved = options.project
    ? getProject(db, options.project) ?? getProjectBySlug(db, options.project)
    : pickSoleActiveProject(db);

  if (!resolved) {
    if (options.project) {
      throw projectNotFound(options.project);
    }
    // Say which of the two situations this is. "Pick one" is unhelpful advice
    // when the real problem is that nothing is active.
    const active = listProjects(db).filter((candidate) => candidate.status === "active");
    throw validationError(
      active.length === 0
        ? "No Project is active, so there is no current action. Set one active, or name it with --project."
        : "More than one Project is active, so there is no single current action. Name one with --project.",
      { active: active.map((candidate) => candidate.slug), all: listProjects(db).map((c) => c.slug) }
    );
  }

  const metadata = getProjectMetadata(db, resolved.id);
  const path = metadata?.repo_path?.trim();
  if (!path) {
    throw validationError("Project has no repo_path, so its documentation cannot be read.", {
      project: resolved.slug,
      remedy: `arcadia project metadata ${resolved.id} --repo-path <path>`
    });
  }

  return { project: resolved, repoRoot: path };
}

/**
 * Everything a dispatch brief says about one resolution, with no reference to
 * a workspace or a database.
 *
 * `next` and `docket` answer the same question from the same repository
 * documents and differ only in how they were pointed at the repository. Both
 * render through here so the two can never describe the same state
 * differently — a divergence an agent would have no way to detect.
 */
export interface DispatchRenderInput {
  context: DispatchResolution["context"];
  blockers: DispatchResolution["blockers"];
  operatorQuestion: DispatchResolution["operatorQuestion"];
  dispatchable: boolean;
  repoRoot: string;
}

export function renderDispatchResolution(data: DispatchRenderInput): string[] {
  const { context, blockers, operatorQuestion, dispatchable, repoRoot } = data;

  if (!context) {
    return [
      "No current action could be resolved.",
      "",
      ...renderBlockers(blockers),
      "",
      "Repairing the control documentation is the immediate work."
    ];
  }

  const { action } = context;
  const lines: string[] = [
    `Project: ${context.projectName} (${context.projectSlug}) — ${context.projectStatus}`,
    `Repository: ${repoRoot}`,
    `Active plan: ${context.activePlan} [${context.planStatus}] — ${context.planPath}`,
    `Token impact: ${context.planTokenImpact} — ${context.planTokenBudget}`,
    `Milestone: ${context.milestone ?? "none"}`,
    "",
    `Current action: ${action.id}`,
    `  ${action.title}`,
    `  Status: ${action.status} · Responsibility: ${action.responsibility}` +
      (action.effort ? ` · Effort: ${action.effort}` : "")
  ];

  if (action.clarification === "question_open") {
    lines.push(
      `  Clarification: question_open (${action.gapType ?? "no gap type"})`,
      `  Question: ${action.question ?? "(missing)"}`
    );
  } else {
    lines.push(`  Clarification: ${action.clarification ?? "not evaluated"}`);
    if (action.nextAction) {
      lines.push(`  Next action: ${action.nextAction}`);
    }
    if (action.source) {
      lines.push(`  Source: ${action.source}`);
    }
  }

  if (action.acceptanceCriteria.length > 0) {
    lines.push("  Acceptance criteria:");
    lines.push(...action.acceptanceCriteria.map((criterion) => `    - ${criterion}`));
  }

  if (action.references.length > 0) {
    lines.push("  References:");
    lines.push(...action.references.map((reference) => `    - ${reference}`));
  }

  if (context.requiredDecisions.length > 0) {
    lines.push("  Required decisions:");
    lines.push(
      ...context.requiredDecisions.map(
        (decision) => `    - ${decision.id} [${decision.status}] ${decision.question}`.trimEnd()
      )
    );
  }

  lines.push("", `Authorization: ${context.authorization}`);

  // The Constitution binds every action this brief dispatches, so it belongs
  // beside the authorization line rather than behind a link the agent has to
  // choose to follow. Printed whatever the outcome: repairing a blocker is
  // agent work under the same constraints as implementing an action.
  if (context.standingConstraints.length > 0) {
    lines.push("", "Standing constraints (CONSTITUTION.md) — these bind this action:");
    lines.push(...context.standingConstraints.map((line) => (line ? `  ${line}` : "")));
  }

  if (blockers.length > 0) {
    lines.push("", "Blockers:", ...renderBlockers(blockers));
  }

  lines.push("");
  if (operatorQuestion) {
    // The contract's required return shape: one precise question, not a
    // request for direction.
    lines.push("This action is blocked on one question for the operator:", `  ${operatorQuestion}`);
  } else if (dispatchable) {
    lines.push("Dispatchable: a coding agent may begin this action now.");
  } else if (blockers.length > 0) {
    lines.push("Not dispatchable: repair the blockers above first.");
  } else {
    lines.push(`Not dispatchable: responsibility is "${action.responsibility}".`);
  }

  return lines;
}

export function renderNextSuccess(response: CommandSuccess<NextCommandData>): string[] {
  const lines = renderDispatchResolution(response.data);
  appendFiredBackBurnerHint(lines, response.data.firedBackBurnerCount);
  return lines;
}

function appendFiredBackBurnerHint(lines: string[], count: number | undefined): void {
  if (!count) return;
  lines.push("", `Back Burner: ${count} fired condition${count === 1 ? "" : "s"}. See: arcadia back-burner list --fired yes`);
}

function renderBlockers(blockers: DispatchResolution["blockers"]): string[] {
  return blockers.flatMap((blocker) => [
    `  ! ${blocker.relativePath} [${blocker.field}]: ${blocker.message}`,
    `      ${blocker.remedy}`
  ]);
}

export interface NextReadyCommandData extends ReadySetResolution {
  projectId: string | null;
}

/**
 * List every Action in the active plan a coding agent could dispatch now,
 * instead of only refusing a bad pointer.
 *
 * Not journaled: unlike `next` and `work plan`, this reports a whole set of
 * Actions rather than resolving one dispatch attempt, and journalling every
 * Action it inspects on every invocation would swamp the dispatch journal's
 * actual purpose — tracking real dispatch attempts — with exploratory
 * queries that never tried to dispatch anything.
 */
export function runNextReadyCommand(options: NextCommandOptions): CommandSuccess<NextReadyCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const { project, repoRoot } = withDatabase(workspacePath, (db) => resolveProjectAndRepo(db, options));

  const resolution = resolveReadySet(repoRoot, project.slug);

  return createSuccess({
    command: "next.ready",
    workspace: workspacePath,
    data: { ...resolution, projectId: project.id }
  });
}

export function renderNextReadySuccess(response: CommandSuccess<NextReadyCommandData>): string[] {
  const { planSlug, planPath, blockers, ready, suggestedCurrentAction, nearest } = response.data;

  if (blockers.length > 0) {
    return [
      "No ready set could be computed.",
      "",
      ...renderBlockers(blockers),
      "",
      "Repairing the control documentation is the immediate work."
    ];
  }

  const lines = [`Active plan: ${planSlug} — ${planPath}`, ""];

  if (ready.length === 0) {
    lines.push("Ready set: empty. No unfinished Action is fully ready.");
    if (nearest) {
      lines.push(
        "",
        `Nearest to ready: ${nearest.actionId}`,
        `  ${nearest.title}`,
        `  Responsibility: ${nearest.responsibility}`
      );
      if (nearest.operatorQuestion) {
        lines.push(`  Open question: ${nearest.operatorQuestion}`);
      }
      if (nearest.blockers.length > 0) {
        lines.push("  Blockers:", ...renderBlockers(nearest.blockers));
      }
    }
    return lines;
  }

  lines.push(`Ready set (${ready.length}):`);
  for (const entry of ready) {
    const marker = entry.actionId === suggestedCurrentAction ? "*" : " ";
    lines.push(`  ${marker} ${entry.actionId} — ${entry.title} [${entry.responsibility}]`);
  }

  lines.push(
    "",
    suggestedCurrentAction
      ? `Suggested current_action: ${suggestedCurrentAction} (the operator still decides; nothing was written).`
      : "No suggestion could be made."
  );

  return lines;
}

export interface NextHistoryCommandData {
  events: DispatchEvent[];
  summary: DispatchJournalSummary;
}

/**
 * Read the dispatch journal.
 *
 * The control documents earn their overhead only if refusals are rare and for
 * good reasons. This is where that is checked: a field that blocks most
 * resolutions is either a rule worth relaxing or a habit worth fixing, and
 * nobody can tell which from memory.
 */
export function runNextHistoryCommand(options: {
  workspace: string;
  limit?: number;
}): CommandSuccess<NextHistoryCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const limit = options.limit ?? 20;

  const data = withDatabase(workspacePath, (db) => ({
    events: listDispatchEvents(db, limit),
    // Summarized over a wider window than is listed: the tally is about the
    // trend, and twenty rows is too few to see one.
    summary: summarizeDispatchEvents(db, Math.max(limit, 200))
  }));

  return createSuccess({ command: "next.history", workspace: workspacePath, data });
}

export function renderNextHistorySuccess(response: CommandSuccess<NextHistoryCommandData>): string[] {
  const { events, summary } = response.data;

  if (summary.total === 0) {
    return ["No dispatch resolutions recorded yet.", "", "Run `arcadia next` to start the journal."];
  }

  const lines = [
    `Dispatch resolutions: ${summary.total} · dispatchable ${summary.dispatchable} · blocked ${summary.blocked}`,
    ""
  ];

  if (summary.byField.length > 0) {
    lines.push("Blocked on:");
    for (const entry of summary.byField) {
      const share = Math.round((entry.resolutions / summary.total) * 100);
      lines.push(`  ${entry.field} — ${entry.resolutions} of ${summary.total} resolutions (${share}%)`);
    }
    lines.push("");
  }

  lines.push("Recent:");
  for (const event of events) {
    const verdict = event.operatorQuestion
      ? "question"
      : event.dispatchable
        ? "dispatchable"
        : `blocked (${event.blockerCount})`;
    const subject = [event.projectSlug, event.planSlug, event.actionId].filter(Boolean).join(" / ") || "unresolved";
    lines.push(`  ${event.occurredAt} ${event.command} ${subject} — ${verdict}`);
    if (event.blockerFields.length > 0) {
      lines.push(`      ${event.blockerFields.join(", ")}`);
    }
  }

  return lines;
}
