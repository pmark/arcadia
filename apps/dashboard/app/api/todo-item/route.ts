import { NextResponse } from "next/server";
import { ArcadiaCliError } from "../../../lib/arcadia-cli";
import { getApprovals } from "../../../lib/approvals-feed";
import { matchesTodoTarget, parseTodoPath } from "../../../lib/approvals";
import { isSameOriginRequest } from "../../../lib/originGuard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * One to-do's row, for its own page, so that page never downloads the whole list to find it. A read only: it shares
 * the cached list behind GET /api/approvals and keeps that list's `note` and `source`, which decide whether an absent
 * row may be called done. Answering stays where it was, on POST /api/approvals and POST /api/decision-card.
 */
export async function GET(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Cross-origin to-do requests are refused." }, { status: 403 });
  }
  const params = new URL(request.url).searchParams;
  // parseTodoPath takes URL path segments, so encode what the query string has already decoded.
  const target = parseTodoPath(encodeURIComponent(params.get("kind") ?? ""), [params.get("project") ?? "", params.get("id") ?? ""].map(encodeURIComponent));
  if (target === null) return NextResponse.json({ error: "kind, project and id must name one to-do." }, { status: 400 });
  try {
    const list = await getApprovals();
    return NextResponse.json({ approvals: list.approvals.filter((approval) => matchesTodoTarget(approval, target)), note: list.note, source: list.source });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof ArcadiaCliError ? error.statusCode : 500 });
  }
}
