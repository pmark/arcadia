import { NextResponse } from "next/server";
import { GoContinueConflict, previewGoContinue } from "../../../../../lib/go-continue";
import { isSameOriginRequest } from "../../../../../lib/originGuard";
import { POST as protectedLaunch } from "../session-launch/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error),
    details: error instanceof GoContinueConflict ? { conflict: true, changedFacts: error.facts, freshRead: true } : null },
  { status: error instanceof GoContinueConflict ? 409 : 500 });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const query = new URL(request.url).searchParams;
    const plan = query.get("plan"), action = query.get("action"), resolutionId = query.get("resolutionId");
    if (!plan || !action || !resolutionId) return NextResponse.json({ error: "The shown Plan, Action and Go resolution identity are required." }, { status: 400 });
    return NextResponse.json(await previewGoContinue(id, { plan, action, resolutionId }));
  } catch (error) { return failure(error); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Cross-origin Continue requests are refused." }, { status: 403 });
  try {
    const { id } = await context.params;
    let body: unknown;
    try { body = await request.clone().json(); } catch {
      return NextResponse.json({ error: "A valid JSON Continue preview is required." }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "A Continue preview is required." }, { status: 400 });
    const b = body as Record<string, unknown>;
    if (![b.plan, b.action, b.resolutionId, b.requestId, b.previewFingerprint].every(v => typeof v === "string" && v.length > 0)) {
      return NextResponse.json({ error: "The complete Continue preview is required." }, { status: 400 });
    }
    if (b.confirmOperatorLaunch !== true) return NextResponse.json({ error: "Explicit confirmation of this one Action is required." }, { status: 400 });
    const fresh = await previewGoContinue(id, { plan: b.plan as string, action: b.action as string, resolutionId: b.resolutionId as string });
    if (fresh.requestId !== b.requestId || fresh.previewFingerprint !== b.previewFingerprint) {
      throw new GoContinueConflict({ expected: { requestId: b.requestId, previewFingerprint: b.previewFingerprint }, actual: fresh });
    }
    // Carry the original browser headers and confirmation unchanged. This wrapper
    // cannot manufacture Decision 0096 authorization or replace the launch fences.
    const response = await protectedLaunch(request, context);
    if (response.status !== 409) return response;
    // The protected launcher rechecks after this wrapper's read too. Preserve
    // that refusal and show fresh facts; never retry a launch automatically.
    const refused = await response.json() as { error: string; details: unknown };
    let actual: unknown;
    try { actual = await previewGoContinue(id); } catch (error) {
      actual = error instanceof GoContinueConflict ? error.facts : { observation: "unknown", error: String(error) };
    }
    return NextResponse.json({ ...refused, details: { launch: refused.details, changedFacts: actual, freshRead: true, conflict: true } }, { status: 409 });
  } catch (error) { return failure(error); }
}
