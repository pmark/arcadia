import { projectNotFound } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import { getProject, getProjectBySlug, listProjects } from "../db/repositories.js";
import { syncProjectDocs, type DocChange, type ProjectSyncResult } from "../docs/sync.js";

export interface DocsSyncOptions {
  workspace: string;
  /** Project id or slug. Omitted means the whole portfolio. */
  project?: string;
  apply?: boolean;
}

export interface DocsSyncCommandData {
  applied: boolean;
  projects: ProjectSyncResult[];
  totals: Record<DocChange["action"], number>;
  errorCount: number;
}

/**
 * Ingest every managed document across the portfolio.
 *
 * Dry-run by default, matching `clarify`: a sync rewrites the Actions and
 * Decisions the operator plans against, and a batch job that silently rewrote
 * a queue from a file someone edited would be exactly the unobservable
 * automation this system avoids. The dry run runs the identical code path with
 * writes withheld, so the preview cannot drift from what `--apply` does.
 */
export function runDocsSyncCommand(options: DocsSyncOptions): CommandSuccess<DocsSyncCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);

  const results = withDatabase(workspacePath, (db) => {
    const targets = options.project
      ? [getProject(db, options.project) ?? getProjectBySlug(db, options.project)]
      : listProjects(db);

    if (options.project && !targets[0]) {
      throw projectNotFound(options.project);
    }

    // One transaction per project rather than one for the whole portfolio: a
    // malformed document in one repository must not roll back a clean
    // ingestion of another.
    return targets
      .filter((project): project is NonNullable<typeof project> => Boolean(project))
      .map((project) =>
        options.apply
          ? db.transaction(() => syncProjectDocs(db, project, { apply: true }))()
          : syncProjectDocs(db, project, { apply: false })
      );
  });

  const totals: Record<DocChange["action"], number> = {
    create: 0,
    update: 0,
    unchanged: 0,
    skipped: 0
  };
  let errorCount = 0;
  for (const result of results) {
    for (const change of result.changes) {
      totals[change.action] += 1;
    }
    errorCount += result.errors.length;
  }

  return createSuccess({
    command: "docs.sync",
    workspace: workspacePath,
    data: { applied: Boolean(options.apply), projects: results, totals, errorCount }
  });
}

export function renderDocsSyncSuccess(response: CommandSuccess<DocsSyncCommandData>): string[] {
  const { applied, projects, totals, errorCount } = response.data;
  const lines: string[] = [];

  const scanned = projects.filter((project) => project.repoRoot);
  if (scanned.length === 0) {
    return ["No Projects have a repo_path recorded, so there is nothing to crawl."];
  }

  for (const project of projects) {
    const interesting = project.changes.filter((change) => change.action !== "unchanged");
    const unchanged = project.changes.length - interesting.length;

    if (!project.repoRoot) {
      continue;
    }

    lines.push(`${project.projectSlug} — ${project.repoRoot}`);

    if (interesting.length === 0 && project.errors.length === 0) {
      lines.push(`  Up to date (${unchanged} record${unchanged === 1 ? "" : "s"} already match).`);
    }

    for (const change of interesting) {
      const verb = change.action === "create" ? "+" : change.action === "update" ? "~" : "·";
      lines.push(`  ${verb} ${change.entity}: ${change.title}`);
      lines.push(`      ${change.ref}  (${change.relativePath})`);
      if (change.reason) {
        lines.push(`      ${change.reason}`);
      }
    }

    if (unchanged > 0 && interesting.length > 0) {
      lines.push(`  ${unchanged} record${unchanged === 1 ? "" : "s"} already up to date.`);
    }

    for (const error of project.errors) {
      lines.push(`  ! ${error.relativePath} [${error.field}]: ${error.message}`);
    }

    for (const foreign of project.foreign) {
      lines.push(`  · ignored, belongs to another Project: ${foreign}`);
    }

    lines.push("");
  }

  lines.push(
    `${applied ? "Applied" : "Would apply"}: ${totals.create} created, ${totals.update} updated, ` +
      `${totals.unchanged} unchanged, ${totals.skipped} skipped.`
  );

  if (errorCount > 0) {
    lines.push(`${errorCount} validation error${errorCount === 1 ? "" : "s"} — those files were not ingested.`);
  }

  if (!applied && (totals.create > 0 || totals.update > 0)) {
    lines.push("", "Re-run with --apply to write these changes.");
  }

  return lines;
}
