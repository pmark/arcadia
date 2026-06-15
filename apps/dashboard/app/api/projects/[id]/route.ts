import { NextResponse } from "next/server";
import { resolveReadyWorkspace } from "../../../../../../src/cli/workspace";
import { withDatabase } from "../../../../../../src/db/connection";
import { updateProjectSetup } from "../../../../../../src/projects/setup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PROJECT_STATUSES = new Set(["active", "paused", "incubating", "completed"]);

interface ProjectUpdateRequest {
  repoPath?: unknown;
  validationCommands?: unknown;
  mission?: unknown;
  status?: unknown;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as ProjectUpdateRequest;
    const input = parseProjectUpdateRequest(body);
    const { workspacePath } = resolveReadyWorkspace();
    const result = withDatabase(workspacePath, (db) =>
      updateProjectSetup(db, {
        projectId: id,
        ...input
      })
    );

    if (!result) {
      return NextResponse.json({ error: "Project was not found.", details: { projectId: id } }, { status: 404 });
    }

    return NextResponse.json({
      message: input.repoPath ? "Repository path saved. Codex work can now be prepared for this project." : "Project setup saved.",
      result: {
        project: result.project,
        metadata: result.metadata,
        updated: result.updated
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : String(error),
        details: null
      },
      { status: 400 }
    );
  }
}

function parseProjectUpdateRequest(body: ProjectUpdateRequest) {
  const input: {
    repoPath?: string | null;
    validationCommands?: string[];
    mission?: string;
    status?: string;
  } = {};

  if ("repoPath" in body) {
    input.repoPath = typeof body.repoPath === "string" ? body.repoPath.trim() : null;
  }

  if ("validationCommands" in body) {
    if (!Array.isArray(body.validationCommands)) {
      throw new Error("Validation commands must be an array of strings.");
    }
    input.validationCommands = body.validationCommands
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean);
  }

  if ("mission" in body) {
    if (typeof body.mission !== "string" || !body.mission.trim()) {
      throw new Error("Mission is required.");
    }
    input.mission = body.mission.trim();
  }

  if ("status" in body) {
    if (typeof body.status !== "string" || !PROJECT_STATUSES.has(body.status)) {
      throw new Error("Status must be one of: active, paused, incubating, completed.");
    }
    input.status = body.status;
  }

  if (Object.keys(input).length === 0) {
    throw new Error("At least one project setup field is required.");
  }

  return input;
}
