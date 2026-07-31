import { NextResponse } from "next/server";
import { ArcadiaCliError, loadDispatchJournal } from "../../../../lib/arcadia-cli";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const requested = Number(new URL(request.url).searchParams.get("limit") ?? 25);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), 100) : 25;

  try {
    const response = await loadDispatchJournal(limit);
    return NextResponse.json(response.data);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to load the dispatch journal.",
        details: error instanceof ArcadiaCliError ? error.details : null,
      },
      { status: error instanceof ArcadiaCliError ? error.statusCode : 500 },
    );
  }
}
