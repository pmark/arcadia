import { NextResponse } from "next/server";
import { ArcadiaCliError, getIntelligenceUsage } from "../../../../lib/arcadia-cli";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    const response = await getIntelligenceUsage({ refresh });
    return NextResponse.json(response.data);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to load Intelligence usage.",
        details: error instanceof ArcadiaCliError ? error.details : null,
      },
      { status: error instanceof ArcadiaCliError ? error.statusCode : 500 },
    );
  }
}
