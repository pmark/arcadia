import { NextResponse } from "next/server";
import { cliMessage, loadPlanDetail, PlanNotFound } from "../../../../../lib/plans-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Read-only: one Plan with every Action. `?fresh=1` (Refresh) checks the documents before answering. */
export async function GET(request: Request, context: { params: Promise<{ project: string; plan: string }> }) {
  const { project, plan } = await context.params;
  try {
    return NextResponse.json(await loadPlanDetail(project, plan, { fresh: new URL(request.url).searchParams.has("fresh") }));
  } catch (error) {
    if (error instanceof PlanNotFound) return NextResponse.json({ error: error.message, details: { project, plan } }, { status: 404 });
    // An unknown or ungoverned Plan slug is already PlanNotFound; anything else is the server's failure.
    const status = 500;
    return NextResponse.json({ error: cliMessage(error), details: { project, plan } }, { status });
  }
}
