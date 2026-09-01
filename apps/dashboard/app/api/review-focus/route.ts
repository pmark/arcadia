import { NextResponse } from "next/server";
import { resolveReadyWorkspace } from "../../../../../src/cli/workspace";
import { withReadOnlyDatabase } from "../../../../../src/db/connection";
import { listProjects } from "../../../../../src/db/repositories";
import { saveReviewFocus } from "../../../../../src/dashboard/reviewFocus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ReviewFocusRequest {
  projectOrder?: unknown;
  excludedProjects?: unknown;
  maxItems?: unknown;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ReviewFocusRequest;
    if (!Array.isArray(body.projectOrder) || !Array.isArray(body.excludedProjects)) {
      throw new Error("Review focus requires priority and parked Project lists.");
    }

    const { workspacePath } = resolveReadyWorkspace();
    const availableProjects = withReadOnlyDatabase(workspacePath, (db) => listProjects(db).map((project) => project.name));
    const focus = saveReviewFocus(workspacePath, {
      projectOrder: body.projectOrder.filter((value): value is string => typeof value === "string"),
      excludedProjects: body.excludedProjects.filter((value): value is string => typeof value === "string"),
      maxItems: typeof body.maxItems === "number" ? body.maxItems : 5
    }, availableProjects);

    return NextResponse.json({ message: "Review focus saved to this Arcadia workspace.", focus });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error), details: null },
      { status: 400 }
    );
  }
}
