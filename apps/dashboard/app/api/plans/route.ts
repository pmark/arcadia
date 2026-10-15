import { NextResponse } from "next/server";
import { loadAllPlans } from "../../../lib/plans-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Read-only: every Project's plans. */
export async function GET() {
  try {
    return NextResponse.json(await loadAllPlans());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error), details: null }, { status: 500 });
  }
}
