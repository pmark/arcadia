import { NextResponse } from "next/server";
import { ArcadiaCliError } from "../../../../../lib/arcadia-cli";
import { cliMessage, loadPlanDetail, PlanNotFound } from "../../../../../lib/plans-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Read-only: one Plan with every Action. */
export async function GET(_request: Request, context: { params: Promise<{ project: string; plan: string }> }) {
  const { project, plan } = await context.params;
  try {
    return NextResponse.json(await loadPlanDetail(project, plan));
  } catch (error) {
    if (error instanceof PlanNotFound) return NextResponse.json({ error: error.message, details: { project, plan } }, { status: 404 });
    // The CLI refuses an unknown or ungoverned Plan slug with a validation error.
    const status = error instanceof ArcadiaCliError && error.statusCode < 500 ? 404 : 500;
    return NextResponse.json({ error: cliMessage(error), details: { project, plan } }, { status });
  }
}
