import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import {
  listPortfolioOpenDecisions,
  listPortfolioOpenProposals,
  listPortfolioProjects,
  type PortfolioDecisionRow,
  type PortfolioProjectRow
} from "../db/repositories.js";

export interface PortfolioCommandData {
  projects: PortfolioProjectRow[];
  openDecisions: PortfolioDecisionRow[];
  /** Way-change requests filed by adopting projects, awaiting a Decision. */
  openProposals: PortfolioDecisionRow[];
  totals: {
    projects: number;
    activeProjects: number;
    openActions: number;
    clarified: number;
    unclarified: number;
    questionOpen: number;
    unevaluated: number;
    openDecisions: number;
    openProposals: number;
  };
}

/**
 * The executive view over the whole portfolio.
 *
 * Reads the database, not the documents: by the time this runs, `docs sync` has
 * already turned intent into rows, and the queue that gets worked is the one
 * that matters. Counting Actions alone would flatter the portfolio, so the
 * clarity breakdown is carried alongside — "12 open" means something very
 * different when 9 of them are still unclarified.
 */
export function runPortfolioCommand(options: {
  workspace: string;
}): CommandSuccess<PortfolioCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);

  const { projects, openDecisions, openProposals } = withDatabase(workspacePath, (db) => ({
    projects: listPortfolioProjects(db),
    openDecisions: listPortfolioOpenDecisions(db),
    openProposals: listPortfolioOpenProposals(db)
  }));

  const totals = {
    projects: projects.length,
    activeProjects: projects.filter((project) => project.status === "active").length,
    openActions: sum(projects, (p) => p.open_actions + p.in_progress_actions),
    clarified: sum(projects, (p) => p.clarified),
    unclarified: sum(projects, (p) => p.unclarified),
    questionOpen: sum(projects, (p) => p.question_open),
    unevaluated: sum(projects, (p) => p.unevaluated),
    openDecisions: openDecisions.length,
    openProposals: openProposals.length
  };

  return createSuccess({
    command: "portfolio",
    workspace: workspacePath,
    data: { projects, openDecisions, openProposals, totals }
  });
}

export function renderPortfolioSuccess(response: CommandSuccess<PortfolioCommandData>): string[] {
  const { projects, openDecisions, openProposals, totals } = response.data;

  if (projects.length === 0) {
    return ["No Projects yet."];
  }

  const lines: string[] = [
    `Portfolio — ${totals.projects} Project${totals.projects === 1 ? "" : "s"} (${totals.activeProjects} active)`,
    ""
  ];

  for (const project of projects) {
    lines.push(`${project.name}  [${project.status}]`);
    if (project.goal) {
      lines.push(`  Goal: ${project.goal}`);
    }
    lines.push(`  Milestone: ${project.current_milestone ?? "none"}`);
    lines.push(
      `  Actions: ${project.open_actions} open · ${project.in_progress_actions} in progress · ` +
        `${project.blocked_actions} blocked · ${project.done_actions} done`
    );
    lines.push(`  Clarity: ${clarityLine(project)}`);

    if (project.open_decisions > 0) {
      lines.push(`  Decisions waiting: ${project.open_decisions}`);
    }
    if (project.doc_backed_actions > 0) {
      lines.push(`  Document-backed Actions: ${project.doc_backed_actions}`);
    }
    lines.push("");
  }

  if (openDecisions.length > 0 || openProposals.length > 0) {
    lines.push("Waiting on you:");
    for (const decision of openDecisions) {
      lines.push(`  ${waitingLine(decision)}`);
    }
    // A proposal is a project asking for a capability the Way does not have, so
    // it is marked: the operator answers it with a Decision in the Arcadia
    // repository, not by deciding something inside the asking project.
    for (const proposal of openProposals) {
      lines.push(`  ${waitingLine(proposal)}  (proposal)`);
    }
    lines.push("");
  }

  const unready = totals.unclarified + totals.questionOpen + totals.unevaluated;
  lines.push(
    `${totals.openActions} Action${totals.openActions === 1 ? "" : "s"} in flight; ` +
      `${totals.clarified} ready to work, ${unready} not yet.`
  );

  if (totals.unclarified > 0) {
    lines.push(`Run \`arcadia clarify\` to work through ${totals.unclarified} unclarified Action(s).`);
  }
  if (totals.openDecisions > 0) {
    lines.push(`${totals.openDecisions} Decision(s) need an answer before their work can move.`);
  }
  if (totals.openProposals > 0) {
    lines.push(
      `${totals.openProposals} Way-change request(s) filed by adopting projects await a Decision here.`
    );
  }

  return lines;
}

function waitingLine(row: PortfolioDecisionRow): string {
  const label = row.slug ?? row.id;
  const project = row.project_name ? ` [${row.project_name}]` : "";
  return `${label}${project} — ${row.decision_needed}`;
}

/** Zero-count states are omitted so the line reads as a finding, not a form. */
function clarityLine(project: PortfolioProjectRow): string {
  const parts: string[] = [];
  if (project.clarified > 0) {
    parts.push(`${project.clarified} ready`);
  }
  if (project.unclarified > 0) {
    parts.push(`${project.unclarified} unclarified`);
  }
  if (project.question_open > 0) {
    parts.push(`${project.question_open} awaiting an answer`);
  }
  if (project.unevaluated > 0) {
    parts.push(`${project.unevaluated} never evaluated`);
  }
  return parts.length > 0 ? parts.join(" · ") : "no open Actions";
}

function sum(rows: PortfolioProjectRow[], pick: (row: PortfolioProjectRow) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}
