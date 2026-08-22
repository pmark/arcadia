import { NextResponse } from "next/server";
import { ArcadiaCliError, loadNowBrief } from "../../../lib/arcadia-cli";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const narrate = new URL(request.url).searchParams.get("narrate") === "1";
  try {
    const response = await loadNowBrief({ narrate });
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
