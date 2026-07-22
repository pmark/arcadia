import { NextResponse } from "next/server";
import { ArcadiaCliError, loadReport } from "../../../lib/arcadia-cli";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const kind = new URL(request.url).searchParams.get("kind") === "weekly" ? "weekly" : "daily";
  try {
    const response = await loadReport(kind);
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
