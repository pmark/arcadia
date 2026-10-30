import { NextResponse } from "next/server";
import { readSessionObservation } from "../../../../../lib/session-observation";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await context.params;
  const params = new URL(request.url).searchParams;
  const plan = params.get("plan"), action = params.get("action");
  if (![projectId, plan, action].every(v => typeof v === "string" && v.trim().length > 0 && v.length <= 200)) {
    return NextResponse.json({ error: "The exact Project, Plan and Action are required." }, { status: 400 });
  }
  try {
    return NextResponse.json(await readSessionObservation({ projectId, plan: plan!, action: action! }), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 503 });
  }
}
