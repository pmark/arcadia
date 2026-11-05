import { NextResponse } from "next/server";
import { loadPlanSummaries, PlanNotFound } from "../../../../lib/plans-server";
import { narrowPlanSummaries } from "../../../../lib/workspace-routes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Read-only: one Project's Plan summaries and their freshness. No model calls and no writes. `?fresh=1` checks first.
 * A Project's whole answer can be 300 KB, so a default view asks for less: `?plan=<slug>` keeps one Plan and `?brief=1` drops the per-Action text.
 */
export async function GET(request: Request, context: { params: Promise<{ project: string }> }) {
  const { project } = await context.params;
  try {
    const { searchParams } = new URL(request.url);
    const summaries = await loadPlanSummaries(project, { fresh: searchParams.has("fresh") });
    return NextResponse.json(narrowPlanSummaries(summaries, { plan: searchParams.get("plan"), brief: searchParams.has("brief") }));
  } catch (error) {
    const status = error instanceof PlanNotFound ? 404 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error), details: { project } }, { status });
  }
}
