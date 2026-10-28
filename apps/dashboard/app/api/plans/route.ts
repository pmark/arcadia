import { NextResponse } from "next/server";
import { loadAllPlans } from "../../../lib/plans-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Read-only: every Project's plans. `?fresh=1` (Refresh) checks the documents before answering. */
export async function GET(request: Request) {
  try {
    return NextResponse.json(await loadAllPlans({ fresh: new URL(request.url).searchParams.has("fresh") }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error), details: null }, { status: 500 });
  }
}
