import { NextResponse } from "next/server";
import {
  ArcadiaCliError,
  fetchQaProject,
  listQaProjects,
  pullQaProject,
  restartQaProject
} from "../../../../lib/arcadia-cli";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Project-level update actions, kept apart from `/api/qa`.
 *
 * `/api/qa` is about targets — one row per testable URL. Pulling and restarting
 * are about projects, and Private Practice Now has seven targets sharing one
 * checkout, so putting them on the same route made the same button appear seven
 * times over. Different noun, different route.
 */
export async function GET() {
  try {
    return NextResponse.json((await listQaProjects()).data);
  } catch (error) {
    return failure(error);
  }
}

const ACTIONS = ["fetch", "pull", "restart"] as const;
type Action = (typeof ACTIONS)[number];

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: unknown; project?: unknown };
    const project = typeof body.project === "string" ? body.project.trim() : "";
    const action = typeof body.action === "string" ? body.action : "";

    if (!project) {
      return NextResponse.json({ error: "A configured project slug is required." }, { status: 400 });
    }
    if (!ACTIONS.includes(action as Action)) {
      return NextResponse.json(
        { error: `Action must be one of ${ACTIONS.join(", ")}.` },
        { status: 400 }
      );
    }

    if (action === "fetch") return NextResponse.json((await fetchQaProject(project)).data);
    if (action === "pull") return NextResponse.json((await pullQaProject(project)).data);
    return NextResponse.json((await restartQaProject(project)).data);
  } catch (error) {
    return failure(error);
  }
}

function failure(error: unknown) {
  return NextResponse.json(
    {
      error: error instanceof Error ? error.message : String(error),
      details: error instanceof ArcadiaCliError ? error.details : null
    },
    { status: error instanceof ArcadiaCliError ? error.statusCode : 500 }
  );
}
