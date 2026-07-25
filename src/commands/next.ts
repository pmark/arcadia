import { projectNotFound, validationError } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import { getProject, getProjectBySlug, getProjectMetadata, listProjects } from "../db/repositories.js";
import { isDispatchable, resolveDispatch, type DispatchResolution } from "../docs/dispatch.js";

export interface NextCommandOptions {
  workspace: string;
  /** Project id or slug. Omitted means the single active Project, if there is one. */
  project?: string;
}

export interface NextCommandData extends DispatchResolution {
  dispatchable: boolean;
  projectId: string;
  repoRoot: string;
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

  const { project, repoRoot } = withDatabase(workspacePath, (db) => {
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
  });

  const resolution = resolveDispatch(repoRoot, project.slug);

  return createSuccess({
    command: "next",
    workspace: workspacePath,
    data: {
      ...resolution,
      dispatchable: isDispatchable(resolution),
      projectId: project.id,
      repoRoot
    }
  });
}

function pickSoleActiveProject(db: Parameters<typeof listProjects>[0]) {
  const active = listProjects(db).filter((project) => project.status === "active");
  return active.length === 1 ? active[0] : null;
}

export function renderNextSuccess(response: CommandSuccess<NextCommandData>): string[] {
  const { context, blockers, operatorQuestion, dispatchable, repoRoot } = response.data;

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

function renderBlockers(blockers: DispatchResolution["blockers"]): string[] {
  return blockers.flatMap((blocker) => [
    `  ! ${blocker.relativePath} [${blocker.field}]: ${blocker.message}`,
    `      ${blocker.remedy}`
  ]);
}
