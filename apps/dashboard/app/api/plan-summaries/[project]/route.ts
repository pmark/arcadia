import { NextResponse } from "next/server";
import { loadPlanSummaries, PlanNotFound } from "../../../../lib/plans-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Read-only: one Project's Plan summaries and their freshness. No model calls and no writes. */
export async function GET(_request: Request, context: { params: Promise<{ project: string }> }) {
  const { project } = await context.params;
  try {
    return NextResponse.json(await loadPlanSummaries(project));
  } catch (error) {
    const status = error instanceof PlanNotFound ? 404 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error), details: { project } }, { status });
  }
}
