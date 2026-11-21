import { NextResponse } from "next/server";
import { cliMessage } from "../../../../lib/plans-server";
import { loadRoadmap, RoadmapProjectNotFound } from "../../../../lib/roadmap-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Read-only: a Project's Roadmap, derived from its checked-in records. `?fresh=1` (Refresh) checks the sources first. */
export async function GET(request: Request, context: { params: Promise<{ project: string }> }) {
  const { project } = await context.params;
  try {
    return NextResponse.json(await loadRoadmap(project, { fresh: new URL(request.url).searchParams.has("fresh") }));
  } catch (error) {
    if (error instanceof RoadmapProjectNotFound) return NextResponse.json({ error: error.message, details: { project } }, { status: 404 });
    return NextResponse.json({ error: cliMessage(error), details: { project } }, { status: 500 });
  }
}
