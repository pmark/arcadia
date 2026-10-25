import { NextResponse } from "next/server";
import { ArcadiaCliError, loadPlanJourney } from "../../../../../../lib/arcadia-cli";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** A Plan's rover journey as JSON, for the page's 30-second poll. Read-only. */
export async function GET(_request: Request, { params }: { params: Promise<{ project: string; plan: string }> }) {
  const { project, plan } = await params;
  try {
    return NextResponse.json((await loadPlanJourney(project, plan)).data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : String(error),
        details: error instanceof ArcadiaCliError ? error.details : null
      },
      { status: error instanceof ArcadiaCliError ? error.statusCode : 500 }
    );
  }
}
