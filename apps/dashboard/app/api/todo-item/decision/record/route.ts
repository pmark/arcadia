import { NextResponse } from "next/server";
import { loadDecisionRecord } from "../../../../../lib/decision-record-server";
import { isSameOriginRequest } from "../../../../../lib/originGuard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** One open Decision's document, fetched only when the operator taps "Read the full record". Reads; writes nothing. */
export async function GET(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Cross-origin record requests are refused." }, { status: 403 });
  }
  const params = new URL(request.url).searchParams;
  const project = params.get("project")?.trim() ?? "";
  const id = params.get("id")?.trim() ?? "";
  if (project === "" || id === "") return NextResponse.json({ error: "project and id are required." }, { status: 400 });
  try {
    const result = await loadDecisionRecord(project, id);
    return result.ok ? NextResponse.json(result.record) : NextResponse.json({ error: result.error }, { status: result.status });
  } catch {
    // Fixed text: a read failure can carry absolute paths.
    return NextResponse.json({ error: "The full record could not be read." }, { status: 503 });
  }
}
