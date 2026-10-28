import { NextResponse } from "next/server";
import { ArcadiaCliError, loadGoContext } from "../../../lib/arcadia-cli";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json((await loadGoContext()).data);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error),
      details: error instanceof ArcadiaCliError ? error.details : null },
    { status: error instanceof ArcadiaCliError ? error.statusCode : 500 });
  }
}
