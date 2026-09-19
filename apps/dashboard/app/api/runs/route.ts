import { NextResponse } from "next/server";
import { ArcadiaCliError, loadRunsSnapshot } from "../../../lib/arcadia-cli";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const recent = Number(new URL(request.url).searchParams.get("recent") ?? "0");
    const response = await loadRunsSnapshot(Number.isInteger(recent) ? recent : 0);
    return NextResponse.json(response.data.runs);
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
