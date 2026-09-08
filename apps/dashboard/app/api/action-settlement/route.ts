import { NextResponse } from "next/server";
import { ArcadiaCliError, previewActionSettlement, settleActionComplete } from "../../../lib/arcadia-cli";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Action settlement for the Needs You board.
 *
 * GET  ?project=<slug> — dry-run: the current Action's declared criteria and the
 *                        candidate revision, with nothing settled.
 * POST { project, note? } — complete the current Action with operator authority.
 *
 * Both delegate to `arcadia action settle`, which owns the canonical
 * preview → settle flow; this route never reconstructs settlement itself.
 */
export async function GET(request: Request) {
  const project = new URL(request.url).searchParams.get("project")?.trim() ?? "";
  if (!project) {
    return NextResponse.json({ error: "A project is required.", details: null }, { status: 400 });
  }
  try {
    const response = await previewActionSettlement(project);
    return NextResponse.json({ plan: response.data.plan });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { project?: unknown; note?: unknown };
    const project = typeof body.project === "string" ? body.project.trim() : "";
    const note = typeof body.note === "string" ? body.note.trim() : undefined;
    if (!project) {
      return NextResponse.json({ error: "A project is required.", details: null }, { status: 400 });
    }

    const response = await settleActionComplete({ project, note });
    const { plan, nextActionKey } = response.data;
    return NextResponse.json({
      message: `Settled ${plan.projectSlug}/${plan.actionId} — done.`,
      nextActionKey,
      plan
    });
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown) {
  return NextResponse.json(
    {
      error: error instanceof Error ? error.message : String(error),
      details: error instanceof ArcadiaCliError ? error.details : null
    },
    { status: error instanceof ArcadiaCliError ? error.statusCode : 500 }
  );
}
