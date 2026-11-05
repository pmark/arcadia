import { NextResponse } from "next/server";
import { toCardViews } from "../../../../lib/decision-cards";
import { loadCurrentDecisionCard } from "../../../../lib/decision-cards-server";
import { isSameOriginRequest } from "../../../../lib/originGuard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * One Decision's pinned card and its record's fields, in the shape GET /api/decision-card uses. A read only: a press
 * still goes to POST /api/decision-card, which regenerates the card and refuses any fingerprint that no longer matches.
 */
export async function GET(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Cross-origin decision-card requests are refused.", reason: "cross_origin" }, { status: 403 });
  }
  const params = new URL(request.url).searchParams;
  const project = params.get("project")?.trim() ?? "";
  const id = params.get("id")?.trim() ?? "";
  if (project === "" || id === "") return NextResponse.json({ error: "project and id are required.", reason: "bad_request" }, { status: 400 });
  try {
    const loaded = await loadCurrentDecisionCard(project, id);
    return NextResponse.json({ cards: toCardViews(loaded.cards, loaded.targets), refused: loaded.refused, decision: loaded.decision });
  } catch {
    return NextResponse.json({ error: "This Decision could not be read.", reason: "decision_unreadable" }, { status: 503 });
  }
}
