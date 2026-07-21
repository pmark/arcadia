import { NextResponse } from "next/server";
import { loadSystemStatus } from "../../../../lib/system-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await loadSystemStatus());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to collect Arcadia system status." },
      { status: 500 },
    );
  }
}
