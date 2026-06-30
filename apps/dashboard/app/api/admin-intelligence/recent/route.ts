import { NextResponse } from "next/server";
import { ArcadiaCliError, listIntelligenceTestJobs } from "../../../../lib/arcadia-cli";
import { ADMIN_INTELLIGENCE_CLIENT_APP } from "../../../../lib/intelligence-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const response = await listIntelligenceTestJobs(ADMIN_INTELLIGENCE_CLIENT_APP, 20);
    return NextResponse.json({ jobs: response.data.jobs });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load recent jobs.", details: error instanceof ArcadiaCliError ? error.details : null },
      { status: error instanceof ArcadiaCliError ? error.statusCode : 500 },
    );
  }
}
