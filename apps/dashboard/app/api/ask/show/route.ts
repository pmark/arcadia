import { NextResponse } from "next/server";
import { ArcadiaCliError, showAsk } from "../../../../lib/arcadia-cli";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Exposes the same read-only receipt lookup as `arcadia ask show` to the dashboard. */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "An Ask capture, request, or Ask id is required.", details: null }, { status: 400 });
  try {
    const response = await showAsk({ id });
    return NextResponse.json(response.data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error), details: error instanceof ArcadiaCliError ? error.details : null },
      { status: error instanceof ArcadiaCliError ? error.statusCode : 500 }
    );
  }
}
