import { NextResponse } from "next/server";
import { LIBRARY_PATH } from "../../operator-script/route";
import { readCardStates } from "../../../../lib/operator-card-state-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Operator-script cards that have ended (pressed, superseded, voided or expired). Read-only; changes nothing in the library. */
export async function GET() {
  try {
    const cards = (await readCardStates(LIBRARY_PATH)).filter(card => card.state !== "actionable");
    return NextResponse.json({ cards });
  } catch {
    return NextResponse.json({ error: "The operator-script library could not be read." }, { status: 500 });
  }
}
