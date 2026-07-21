import { NextResponse } from "next/server";
import { ArcadiaCliError, loadMissionControlOverview } from "../../../lib/arcadia-cli";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const response = await loadMissionControlOverview();
    return NextResponse.json(response.data);
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
