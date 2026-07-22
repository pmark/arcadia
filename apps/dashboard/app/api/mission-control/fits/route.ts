import { NextResponse } from "next/server";
import { ArcadiaCliError, loadMissionControlFits } from "../../../../lib/arcadia-cli";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const minutes = Number(url.searchParams.get("minutes"));
  const limitParam = url.searchParams.get("limit");

  if (!Number.isFinite(minutes) || minutes <= 0) {
    return NextResponse.json({ error: "A positive ?minutes value is required." }, { status: 400 });
  }

  try {
    const response = await loadMissionControlFits(minutes, limitParam ? Number(limitParam) : undefined);
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
