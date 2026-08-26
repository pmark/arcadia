import { NextResponse } from "next/server";
import { resolveReadyWorkspace } from "../../../../../../../src/cli/workspace";
import { withDatabase } from "../../../../../../../src/db/connection";
import { getProject, getProjectMetadata } from "../../../../../../../src/db/repositories";
import { ArcadiaCliError, loadProjectPlans } from "../../../../../lib/arcadia-cli";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const { workspacePath } = resolveReadyWorkspace();
  const { project, repoPath } = withDatabase(workspacePath, (db) => ({
    project: getProject(db, id),
    repoPath: getProjectMetadata(db, id)?.repo_path ?? null
  }));

  if (!project) {
    return NextResponse.json({ error: "Project was not found.", details: { projectId: id } }, { status: 404 });
  }
  if (!repoPath) {
    return NextResponse.json(
      { error: "This Project has no repository path configured, so its plans cannot be read.", details: { projectId: id } },
      { status: 409 }
    );
  }

  try {
    const plans = await loadProjectPlans(repoPath, project.slug);
    return NextResponse.json(plans.data);
  } catch (error) {
    const details = error instanceof ArcadiaCliError ? error.details : null;
    const cause = details && typeof details === "object" && "cause" in details && typeof details.cause === "string"
      ? details.cause
      : null;
    return NextResponse.json(
      {
        error: cause ?? (error instanceof Error ? error.message : String(error)),
        details
      },
      { status: cause ? 409 : error instanceof ArcadiaCliError ? error.statusCode : 500 }
    );
  }
}
